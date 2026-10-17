/**
 * ランキング生成ロジック
 * ===========================================================================
 *
 * ■ 誰が何を決めるか
 *   ホスト : 場所・人数・日時・予算帯・大カテゴリ・飲み放題・席の希望・テイクアウト（＝条件）
 *   参加者 : 小カテゴリの評価（◎〇×）（＝好み）
 *
 * ■ 全体の流れ
 *   1. 集計   summarizeAnswers()     … 参加者の回答を「グループの好み」に要約
 *   2. 足切り checkHardConstraints() … 大カテゴリ違い・エリア外・定休日・営業時間外・人数オーバーを除外
 *   3. 採点   scoreRestaurant()      … 項目ごとに 0〜1 で採点 → 重み付き平均で 0〜100 点
 *   4. 並べ替え                      … 上位5件
 *
 * ■ スコアリングの考え方（重み付き平均）
 *
 *     総合点 = Σ(重み_i × 項目スコア_i) / Σ(重み_i) × 100 × ペナルティ係数
 *
 *   - 項目スコア_i : その店が項目 i をどれだけ満たすか（0〜1）
 *   - 重み_i       : BASE_WEIGHTS の値．ホストが「こだわらない」を選んだ項目
 *                    （飲み放題どちらでも・席どこでも・テイクアウトしない）は採点に入れない
 *   - 小カテゴリは全員が ◎(+2) 〇(+1) ×(-2) で評価する．店の小カテゴリの
 *     1人あたり平均ポイント（-2〜+2）を 0〜1 に換算して項目スコアにする
 *   - ペナルティ係数（Must 条件は掛け算で効かせる）
 *       ホストが飲み放題「必須」なのに飲み放題なし   … × 0.6
 *       ホストがテイクアウト「希望する」なのに非対応 … × 0.6
 */

const { AREAS, fetchRestaurants } = require('./mockRestaurants');
const {
  BUDGETS, SEATS, RATING_POINTS, DEFAULT_RATING, CATEGORY_LABELS, SUB_LABELS, subsOf, asksNomihodai,
} = require('./options');

const BASE_WEIGHTS = {
  location: 30, //        場所（ホスト）           … 常に有効
  budget: 25, //          予算帯（ホスト）         … 常に有効
  subCategory: 20, //     小カテゴリの評価（参加者）… 常に有効（全員が◎〇×で評価するため）
  nomihodai: 10, //       飲み放題（ホスト）       … 「必須」のときだけ有効（カフェでは無効）
  seat: 10, //            席の希望（ホスト）       … 「どこでもよい」以外のときだけ有効
  takeout: 10, //         テイクアウト（ホスト）   … 「希望する」のときだけ有効
  rating: 5, //           店の総合評価             … 常に有効（同点の差をつける）
};

const MAX_DISTANCE_KM = 5; //     これより遠い店は候補から除外（隣の駅・エリアくらいまで）
const DISTANCE_DECAY_KM = 1.5; // 場所スコアの減衰の速さ（1.5km 離れると約0.37点）
const LUNCH_END_HOUR = 16; //     この時刻より前ならランチ価格で評価
const MIN_STAY_HOURS = 1; //      入店から最低1時間は営業している店のみ対象
const MUST_PENALTY = 0.6; //      Must 条件を満たさない店に掛ける係数
const TOP_N = 5;

const BUDGET_MAP = Object.fromEntries(BUDGETS.map((b) => [b.value, b]));
const SEAT_LABELS = Object.fromEntries(SEATS.map((s) => [s.value, s.label]));

// ---------------------------------------------------------------------------
// 1. 集計
// ---------------------------------------------------------------------------
/**
 * @param answers 参加者の回答 { name, ratings: {小カテゴリ: 'great'|'ok'|'ng'} }
 * @param room    ルーム（大カテゴリを使う）
 */
function summarizeAnswers(answers, room) {
  const subs = subsOf(room.category).map((s) => s.value);

  // 小カテゴリ：◎〇× の人数と合計ポイント（◎=+2, 〇=+1, ×=-2）
  const ratingCounts = Object.fromEntries(subs.map((s) => [s, { great: 0, ok: 0, ng: 0 }]));
  const subPoints = Object.fromEntries(subs.map((s) => [s, 0]));
  answers.forEach((a) => {
    subs.forEach((s) => {
      const r = RATING_POINTS[a.ratings[s]] !== undefined ? a.ratings[s] : DEFAULT_RATING;
      ratingCounts[s][r] += 1;
      subPoints[s] += RATING_POINTS[r];
    });
  });
  const maxPoints = Math.max(...subs.map((s) => subPoints[s]));
  const topSubs = subs.filter((s) => subPoints[s] === maxPoints);

  return {
    respondentCount: answers.length,
    respondents: answers.map((a) => a.name),
    ratingCounts,
    subPoints,
    topSubs,
  };
}

// ---------------------------------------------------------------------------
// 2. 足切り
// ---------------------------------------------------------------------------
/** "2026-10-20T19:30" → { weekday: 2, hour: 19.5, slot: 'dinner' } */
function parseDatetime(datetime) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(datetime);
  if (!m) throw new Error(`日時の形式が不正です: ${datetime}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const hour = h + mi / 60;
  return { weekday, hour, slot: hour < LUNCH_END_HOUR ? 'lunch' : 'dinner' };
}

/** 2点間の距離（km）．ハーバーサイン公式 */
function distanceKm(a, b) {
  const R = 6371;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** @returns {string|null} 除外理由（null なら候補に残す） */
function checkHardConstraints(shop, ctx) {
  if (shop.category !== ctx.category) return 'カテゴリ外';
  if (ctx.distanceKm > MAX_DISTANCE_KM) return 'エリア外';
  if (shop.closedDays.includes(ctx.weekday)) return '定休日';
  const h = ctx.hour < 5 ? ctx.hour + 24 : ctx.hour; // 深夜0〜5時は前日の24〜29時として比較
  if (h < shop.hours.open || h + MIN_STAY_HOURS > shop.hours.close) return '営業時間外';
  if (ctx.people > shop.maxGroup) return '人数オーバー';
  return null;
}

// ---------------------------------------------------------------------------
// 3. 採点
// ---------------------------------------------------------------------------
function priceAt(shop, slot) {
  return shop.price[slot] ?? shop.price.dinner ?? shop.price.lunch;
}

/**
 * 予算スコア：ホストが選んだ予算帯に入っていれば満点．
 *   - 帯より安い : ゆるやかに減点（帯の下限の半額で 0.7 点）
 *   - 帯より高い : 急に減点（上限の 1.33 倍で 0.5 点，1.67 倍以上で 0 点）
 *   予算オーバーは不満につながりやすいので，上振れに厳しい非対称な形にしている．
 */
function budgetScore(price, band) {
  if (price < band.min) return 1 - 0.6 * (1 - price / band.min);
  if (band.max !== null && price > band.max) return Math.max(0, 1 - (price / band.max - 1) * 1.5);
  return 1;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function scoreRestaurant(shop, ctx, summary) {
  const n = summary.respondentCount;
  const price = priceAt(shop, ctx.slot);
  const items = []; // { key, label, weight, score, note }

  // (1) 場所：エリア中心からの距離で指数的に減衰
  items.push({
    key: 'location',
    label: '場所',
    weight: BASE_WEIGHTS.location,
    score: Math.exp(-ctx.distanceKm / DISTANCE_DECAY_KM),
    note: `${ctx.area.name}から約${formatDistance(ctx.distanceKm)}`,
  });

  // (2) 予算：ホスト指定の予算帯との比較
  items.push({
    key: 'budget',
    label: '予算',
    weight: BASE_WEIGHTS.budget,
    score: budgetScore(price, ctx.budget),
    note: `目安 ¥${price.toLocaleString()} / 予算 ${ctx.budget.label}`,
  });

  // (3) 小カテゴリ：その店の小カテゴリへの ◎〇× を合計し，1人あたり平均（-2〜+2）を 0〜1 に換算
  //     全員◎ → 1点 / 全員〇 → 0.75点 / 全員× → 0点．×(-2) は ◎(+2) を打ち消すほど強く効く
  {
    const pts = summary.subPoints[shop.sub];
    const c = summary.ratingCounts[shop.sub];
    items.push({
      key: 'subCategory',
      label: '小カテゴリ',
      weight: BASE_WEIGHTS.subCategory,
      score: clamp01((pts / n + 2) / 4),
      note: `${SUB_LABELS[shop.sub]}: 合計 ${signed(pts)}pt（◎${c.great} 〇${c.ok} ×${c.ng}）`,
    });
  }

  // (4) 飲み放題：ホストが「必須」のときだけ．あれば1点（なければペナルティも）
  if (ctx.nomihodai === 'required') {
    items.push({
      key: 'nomihodai',
      label: '飲み放題',
      weight: BASE_WEIGHTS.nomihodai,
      score: shop.nomihodai ? 1 : 0,
      note: `${shop.nomihodai ? 'あり' : 'なし'}（ホストが必須に設定）`,
    });
  }

  // (5) 席：ホストが席の種類を指定したときだけ．その席があれば1点
  if (ctx.seat !== 'any') {
    const ok = shop.seats.includes(ctx.seat);
    items.push({
      key: 'seat',
      label: '席',
      weight: BASE_WEIGHTS.seat,
      score: ok ? 1 : 0,
      note: `${SEAT_LABELS[ctx.seat]}席${ok ? 'あり' : 'なし'}（店: ${shop.seats.map((t) => SEAT_LABELS[t]).join('・')}）`,
    });
  }

  // (6) テイクアウト：ホストが「希望する」ときだけ有効
  if (ctx.takeout === 'want') {
    items.push({
      key: 'takeout',
      label: 'テイクアウト',
      weight: BASE_WEIGHTS.takeout,
      score: shop.takeout ? 1 : 0,
      note: `${shop.takeout ? '対応' : '非対応'}（ホストが希望）`,
    });
  }

  // (7) 店の総合評価：★3.0 → 0点，★4.5 以上 → 1点
  items.push({
    key: 'rating',
    label: '店の評価',
    weight: BASE_WEIGHTS.rating,
    score: clamp01((shop.rating - 3.0) / 1.5),
    note: `★${shop.rating.toFixed(1)}`,
  });

  // --- 重み付き平均 ---
  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  const weightedAvg = items.reduce((s, it) => s + it.weight * it.score, 0) / totalWeight;

  // --- Must 条件のペナルティ（掛け算） ---
  let penalty = 1;
  const penalties = [];
  if (ctx.nomihodai === 'required' && !shop.nomihodai) {
    penalty *= MUST_PENALTY;
    penalties.push(`ホストが飲み放題必須だが飲み放題なし（×${MUST_PENALTY}）`);
  }
  if (ctx.takeout === 'want' && !shop.takeout) {
    penalty *= MUST_PENALTY;
    penalties.push(`ホストがテイクアウト希望だが非対応（×${MUST_PENALTY}）`);
  }

  return {
    id: shop.id,
    name: shop.name,
    areaName: shop.areaName,
    category: shop.category,
    categoryLabel: CATEGORY_LABELS[shop.category],
    sub: shop.sub,
    subLabel: SUB_LABELS[shop.sub],
    price,
    priceSlot: ctx.slot,
    distanceKm: Math.round(ctx.distanceKm * 100) / 100,
    rating: shop.rating,
    nomihodai: shop.nomihodai,
    takeout: shop.takeout,
    seats: shop.seats,
    maxGroup: shop.maxGroup,
    hours: shop.hours,
    score: round1(weightedAvg * penalty * 100),
    breakdown: items.map((it) => ({
      key: it.key,
      label: it.label,
      weightShare: round1((it.weight / totalWeight) * 100),
      score: Math.round(it.score * 100) / 100,
      points: round1(((it.weight * it.score) / totalWeight) * 100 * penalty),
      note: it.note,
    })),
    penalties,
    highlights: buildHighlights(shop, ctx, summary, price),
  };
}

/** 結果画面に出す「おすすめポイント」「注意点」 */
function buildHighlights(shop, ctx, summary, price) {
  const good = [];
  const caution = [];

  if (ctx.distanceKm <= 0.5) good.push(`${ctx.area.name}エリア内`);
  else if (ctx.distanceKm > 1.5) caution.push(`${ctx.area.name}から約${formatDistance(ctx.distanceKm)}`);

  // 予算帯の上限を少し（5%）超える程度なら「予算内」，20%超えたら注意
  const max = ctx.budget.max === null ? Infinity : ctx.budget.max;
  if (price <= max * 1.05) good.push(`予算内（目安 ¥${price.toLocaleString()}）`);
  else if (price > max * 1.2) caution.push(`予算オーバー（目安 ¥${price.toLocaleString()}）`);

  {
    const label = SUB_LABELS[shop.sub];
    const pts = summary.subPoints[shop.sub];
    const c = summary.ratingCounts[shop.sub];
    const n = summary.respondentCount;
    if (summary.topSubs.length === 1 && summary.topSubs[0] === shop.sub) good.push(`${label}が最高評価（${signed(pts)}pt）`);
    else if (pts / n >= 1.5) good.push(`${label}が好評（${signed(pts)}pt）`);
    if (c.ng > 0) caution.push(`${label}に×が${c.ng}人`);
  }
  if (ctx.nomihodai === 'required') {
    if (shop.nomihodai) good.push('飲み放題あり');
    else caution.push('飲み放題なし');
  }
  if (ctx.seat !== 'any') {
    if (shop.seats.includes(ctx.seat)) good.push(`${SEAT_LABELS[ctx.seat]}席あり`);
    else caution.push(`${SEAT_LABELS[ctx.seat]}席なし`);
  }
  if (ctx.takeout === 'want') {
    if (shop.takeout) good.push('テイクアウト可');
    else caution.push('テイクアウト不可');
  }
  if (shop.rating >= 4.2) good.push(`高評価 ★${shop.rating.toFixed(1)}`);
  return { good, caution };
}

// ---------------------------------------------------------------------------
// 4. まとめ
// ---------------------------------------------------------------------------
/**
 * @param room    { location, people, datetime, budget, category, nomihodai, seat, takeout }
 * @param answers 参加者の回答
 */
function generateRanking(room, answers, restaurants = fetchRestaurants(room)) {
  if (!answers.length) throw new Error('回答が1件もありません');
  const area = AREAS.find((a) => a.id === room.location);
  if (!area) throw new Error(`未対応のエリアです: ${room.location}`);
  const budget = BUDGET_MAP[room.budget];
  if (!budget) throw new Error(`予算帯が不正です: ${room.budget}`);

  const summary = summarizeAnswers(answers, room);
  const baseCtx = {
    area,
    people: room.people,
    category: room.category,
    budget,
    // カフェでは飲み放題を条件にしない
    nomihodai: asksNomihodai(room.category) ? room.nomihodai || 'any' : 'any',
    seat: room.seat || 'any',
    takeout: room.takeout,
    ...parseDatetime(room.datetime),
  };

  const excluded = { カテゴリ外: 0, エリア外: 0, 定休日: 0, 営業時間外: 0, 人数オーバー: 0 };
  const scored = [];
  for (const shop of restaurants) {
    const ctx = { ...baseCtx, distanceKm: distanceKm(area, shop) };
    const reason = checkHardConstraints(shop, ctx);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    scored.push(scoreRestaurant(shop, ctx, summary));
  }

  // 点数 → 店の評価 → 距離 の順（同点時のタイブレーク）
  scored.sort((a, b) => b.score - a.score || b.rating - a.rating || a.distanceKm - b.distanceKm);

  return {
    generatedAt: new Date().toISOString(),
    conditions: {
      areaName: area.name,
      city: area.city,
      people: room.people,
      datetime: room.datetime,
      slot: baseCtx.slot,
      budgetLabel: budget.label,
      categoryLabel: CATEGORY_LABELS[room.category],
      nomihodai: baseCtx.nomihodai,
      seat: baseCtx.seat,
      takeout: room.takeout,
    },
    summary,
    candidateCount: scored.length,
    excluded,
    ranking: scored.slice(0, TOP_N).map((r, i) => ({ rank: i + 1, ...r })),
  };
}

function signed(v) {
  return v > 0 ? `+${v}` : `${v}`;
}
function round1(v) {
  return Math.round(v * 10) / 10;
}
function formatDistance(km) {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)}m` : `${km.toFixed(1)}km`;
}

module.exports = { generateRanking, summarizeAnswers, scoreRestaurant, budgetScore, parseDatetime, BASE_WEIGHTS };
