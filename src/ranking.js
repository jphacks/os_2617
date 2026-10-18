/**
 * ランキング生成ロジック
 * ===========================================================================
 *
 * ■ 誰が何を決めるか
 *   ホスト : 場所（自由記述）・人数・日時・予算（下限〜上限）・大カテゴリ・評価する小カテゴリ
 *            詳細設定：飲み放題・席の希望・禁煙/喫煙・テイクアウト（＝条件）
 *   参加者 : 小カテゴリの評価（◎〇×）（＝好み）
 *
 * ■ 全体の流れ
 *   0. 取得   shopSource.fetchShops() … 場所の周辺のお店をホットペッパーから取得（このファイルの外）
 *   1. 集計   summarizeAnswers()     … 参加者の回答を「グループの好み」に要約
 *   2. 足切り checkHardConstraints() … ジャンル外（どの小カテゴリにも当たらない・削除された小カテゴリ）・
 *                                      遠すぎる・定休日・営業時間外・人数オーバー・禁煙/喫煙の条件違い を除外
 *   3. 採点   scoreRestaurant()      … 項目ごとに 0〜1 で採点 → 重み付き平均で 0〜100 点
 *   4. 並べ替え                      … 上位5件
 *
 * ■ スコアリングの考え方（重み付き平均）
 *
 *     総合点 = Σ(重み_i × 項目スコア_i) / Σ(重み_i) × 100 × ペナルティ係数 ＋ 加点
 *
 *   - 項目スコア_i : その店が項目 i をどれだけ満たすか（0〜1）
 *   - 重み_i       : BASE_WEIGHTS の値．ホストが「こだわらない」を選んだ項目
 *                    （予算指定なし・飲み放題どちらでも・席こだわらない）は採点に入れない
 *   - お店の情報がない項目（例：個室の有無が未登録）は 0.5 点（あり=1 と なし=0 の中間）とし，除外もしない
 *   - 小カテゴリは全員が ◎(+1) 〇(0) ×(-2) で評価する（×1つが◎2つ分を打ち消す）．
 *     店の小カテゴリの1人あたり平均ポイント（-2〜+1）を，「どちらでもない(0)」が 0.5 に
 *     なるよう 0〜1 に換算する（全員◎=1，全員〇=0.5，全員×=0）．
 *     1つの店が複数の小カテゴリに当たるとき（例：焼き鳥と海鮮）は，それぞれの点の平均
 *   - ペナルティ係数（Must 条件は掛け算で効かせる）
 *       ホストが飲み放題「必須」なのに飲み放題なし … × 0.6
 *   - 加点
 *       ホストがテイクアウト「希望する」で，紹介文にテイクアウトの記載がある … ＋5点
 *       （ホットペッパーにテイクアウトの項目がないため，書いていない店は減点しない）
 */

const {
  SEATS, RATINGS, RATING_POINTS, DEFAULT_RATING, CATEGORY_LABELS, SHOP_SMOKING_LABELS,
  asksNomihodai, normalizeBudget, formatBudget,
} = require('./options');
const { matchSubs } = require('./genreMap');
const { isOpenAt } = require('./shopData');

const BASE_WEIGHTS = {
  location: 30, //        場所（ホスト）           … 常に有効
  budget: 25, //          予算（ホスト）           … 下限か上限を指定したときだけ有効
  subCategory: 25, //     小カテゴリの評価（参加者）… 常に有効（全員が◎〇×で評価するため）
  nomihodai: 10, //       飲み放題（ホスト）       … 「必須」のときだけ有効（カフェでは無効）
  seat: 10, //            席の希望（ホスト）       … 「こだわらない」以外のときだけ有効
};
const TAKEOUT_BONUS = 5; //       テイクアウト希望で紹介文に記載がある店への加点

const MAX_DISTANCE_KM = 3.5; //   これより遠い店は候補から除外（検索範囲は最大3km）
const DISTANCE_DECAY_KM = 1.5; // 場所スコアの減衰の速さ（1.5km 離れると約0.37点）
const LUNCH_END_HOUR = 16; //     この時刻より前ならランチ価格で評価
const MIN_STAY_HOURS = 1; //      入店から最低1時間は営業している店のみ対象
const MUST_PENALTY = 0.6; //      Must 条件を満たさない店に掛ける係数
const UNKNOWN_SCORE = 0.5; //     お店の情報がない項目の点
const TOP_N = 5;

const MAX_RATING_POINTS = Math.max(...RATINGS.map((r) => r.points)); //  ◎ = +1
const MIN_RATING_POINTS = Math.min(...RATINGS.map((r) => r.points)); //  × = -2
const SEAT_LABELS = Object.fromEntries(SEATS.map((s) => [s.value, s.label]));
const EXCLUDE_REASONS = ['ジャンル外', 'エリア外', '定休日', '営業時間外', '人数オーバー', '喫煙条件'];

// ---------------------------------------------------------------------------
// 1. 集計
// ---------------------------------------------------------------------------
/**
 * @param answers 参加者の回答 { name, ratings: {小カテゴリ: 'great'|'ok'|'ng'} }
 * @param room    ルーム（room.subs ＝ そのルームで評価する小カテゴリ）
 */
function summarizeAnswers(answers, room) {
  const subs = room.subs.map((s) => s.value);

  // 小カテゴリ：◎〇× の人数と合計ポイント（◎=+1, 〇=0, ×=-2）
  const ratingCounts = Object.fromEntries(subs.map((s) => [s, { great: 0, ok: 0, ng: 0 }]));
  const subPoints = Object.fromEntries(subs.map((s) => [s, 0]));
  answers.forEach((a) => {
    subs.forEach((s) => {
      const r = RATING_POINTS[(a.ratings || {})[s]] !== undefined ? a.ratings[s] : DEFAULT_RATING;
      ratingCounts[s][r] += 1;
      subPoints[s] += RATING_POINTS[r];
    });
  });
  // 最高評価：合計がプラスで，単独トップの小カテゴリ（全員〇などで同点なら該当なし）
  const maxPoints = Math.max(...subs.map((s) => subPoints[s]));
  const topSubs = maxPoints > 0 ? subs.filter((s) => subPoints[s] === maxPoints) : [];

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

/** @returns {string|null} 除外理由（null なら候補に残す）．情報がない項目では除外しない */
function checkHardConstraints(shop, ctx) {
  if (!shop.matched.active.length) return 'ジャンル外';
  if (ctx.distanceKm > MAX_DISTANCE_KM) return 'エリア外';
  if (shop.closedDays.includes(ctx.weekday)) return '定休日';
  if (isOpenAt(shop.hours, ctx.weekday, ctx.hour, MIN_STAY_HOURS) === false) return '営業時間外';
  if (shop.maxGroup && ctx.people > shop.maxGroup) return '人数オーバー';
  // 禁煙/喫煙：禁煙希望なら「喫煙可」の店を，喫煙可希望なら「全面禁煙」の店を除外（分煙・不明は残す）
  if (ctx.smoking === 'nonsmoking' && shop.smoking === 'allowed') return '喫煙条件';
  if (ctx.smoking === 'smoking' && shop.smoking === 'none') return '喫煙条件';
  return null;
}

// ---------------------------------------------------------------------------
// 3. 採点
// ---------------------------------------------------------------------------
function priceAt(shop, slot) {
  return slot === 'lunch' ? shop.price.lunch ?? shop.price.dinner : shop.price.dinner ?? shop.price.lunch;
}

/**
 * 予算スコア：ホストが選んだ下限〜上限に入っていれば満点（null は指定なし）．
 *   - 下限より安い : ゆるやかに減点（下限の半額で 0.7 点）
 *   - 上限より高い : 急に減点（上限の 1.33 倍で 0.5 点，1.67 倍以上で 0 点）
 *   予算オーバーは不満につながりやすいので，上振れに厳しい非対称な形にしている．
 */
function budgetScore(price, budget) {
  if (budget.min && price < budget.min) return 1 - 0.6 * (1 - price / budget.min);
  if (budget.max && price > budget.max) return Math.max(0, 1 - (price / budget.max - 1) * 1.5);
  return 1;
}

/**
 * 小カテゴリのスコア：1人あたり平均ポイント（-2〜+1）を 0〜1 に換算．
 * 「どちらでもない(0)」を 0.5 に置き，プラス側は ◎，マイナス側は × の点で割る．
 */
function subCategoryScore(points, n) {
  const avg = points / n;
  return avg >= 0 ? clamp01(0.5 + (0.5 * avg) / MAX_RATING_POINTS) : clamp01(0.5 - (0.5 * avg) / MIN_RATING_POINTS);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** true → 1点，false → 0点，null（情報なし）→ 0.5点 */
const boolScore = (v) => (v === true ? 1 : v === false ? 0 : UNKNOWN_SCORE);
const ariNashi = (v, yes = 'あり', no = 'なし') => (v === true ? yes : v === false ? no : '情報なし');

function scoreRestaurant(shop, ctx, summary) {
  const n = summary.respondentCount;
  const price = priceAt(shop, ctx.slot);
  const subs = shop.matched.active;
  const items = []; // { key, label, weight, score, note }

  // (1) 場所：中心からの距離で指数的に減衰
  items.push({
    key: 'location',
    label: '場所',
    weight: BASE_WEIGHTS.location,
    score: Math.exp(-ctx.distanceKm / DISTANCE_DECAY_KM),
    note: `${ctx.locationName}から約${formatDistance(ctx.distanceKm)}`,
  });

  // (2) 予算：ホスト指定の下限〜上限との比較（指定なしなら採点しない．店の予算が不明なら 0.5点）
  if (ctx.budget.min || ctx.budget.max) {
    items.push({
      key: 'budget',
      label: '予算',
      weight: BASE_WEIGHTS.budget,
      score: price ? budgetScore(price, ctx.budget) : UNKNOWN_SCORE,
      note: price
        ? `目安 ¥${price.toLocaleString()}${shop.priceEstimated ? '（予算帯から推定）' : ''} / 予算 ${formatBudget(ctx.budget)}`
        : `予算の情報なし / 予算 ${formatBudget(ctx.budget)}`,
    });
  }

  // (3) 小カテゴリ：その店の小カテゴリへの ◎〇× を合計し，平均を 0〜1 に換算（複数当たれば平均）
  //     全員◎ → 1点 / 全員〇 → 0.5点 / 全員× → 0点．×(-2) は ◎(+1) 2つ分を打ち消す
  items.push({
    key: 'subCategory',
    label: '小カテゴリ',
    weight: BASE_WEIGHTS.subCategory,
    score: subs.reduce((s, v) => s + subCategoryScore(summary.subPoints[v], n), 0) / subs.length,
    note: subs.map((v) => {
      const c = summary.ratingCounts[v];
      return `${ctx.subLabels[v]}: 合計 ${signed(summary.subPoints[v])}pt（◎${c.great} 〇${c.ok} ×${c.ng}）`;
    }).join(' / '),
  });

  // (4) 飲み放題：ホストが「必須」のときだけ．あれば1点（なければペナルティも）
  if (ctx.nomihodai === 'required') {
    items.push({
      key: 'nomihodai',
      label: '飲み放題',
      weight: BASE_WEIGHTS.nomihodai,
      score: boolScore(shop.nomihodai),
      note: `${ariNashi(shop.nomihodai)}（ホストが必須に設定）`,
    });
  }

  // (5) 席：ホストが個室・座敷を希望したときだけ．あれば1点
  if (ctx.seat !== 'any') {
    const has = ctx.seat === 'private' ? shop.privateRoom : shop.zashiki;
    items.push({
      key: 'seat',
      label: '席',
      weight: BASE_WEIGHTS.seat,
      score: boolScore(has),
      note: `${SEAT_LABELS[ctx.seat]}${ariNashi(has)}（ホストが希望）`,
    });
  }

  // --- 重み付き平均 ---
  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  const weightedAvg = items.reduce((s, it) => s + it.weight * it.score, 0) / totalWeight;

  // --- Must 条件のペナルティ（掛け算） ---
  let penalty = 1;
  const penalties = [];
  if (ctx.nomihodai === 'required' && shop.nomihodai === false) {
    penalty *= MUST_PENALTY;
    penalties.push(`ホストが飲み放題必須だが飲み放題なし（×${MUST_PENALTY}）`);
  }

  // --- 加点：テイクアウト（紹介文に記載がある店だけ） ---
  const bonus = ctx.takeout === 'want' && shop.takeout ? TAKEOUT_BONUS : 0;
  const breakdown = items.map((it) => ({
    key: it.key,
    label: it.label,
    weightShare: round1((it.weight / totalWeight) * 100),
    score: Math.round(it.score * 100) / 100,
    points: round1(((it.weight * it.score) / totalWeight) * 100 * penalty),
    note: it.note,
  }));
  if (bonus) breakdown.push({ key: 'takeout', label: 'テイクアウト', weightShare: null, score: 1, points: bonus, note: '紹介文にテイクアウトの記載あり（加点）' });

  return {
    id: shop.id,
    name: shop.name,
    areaName: shop.stationName ? `${shop.stationName}駅` : shop.areaName,
    genreName: shop.genreName,
    subs,
    subLabel: subs.map((v) => ctx.subLabels[v]).join('・'),
    price,
    priceSlot: ctx.slot,
    priceEstimated: shop.priceEstimated,
    budgetName: shop.budgetName,
    distanceKm: Math.round(ctx.distanceKm * 100) / 100,
    nomihodai: shop.nomihodai,
    privateRoom: shop.privateRoom,
    zashiki: shop.zashiki,
    maxGroup: shop.maxGroup,
    smoking: shop.smoking,
    smokingLabel: SHOP_SMOKING_LABELS[shop.smoking],
    takeout: shop.takeout,
    openText: shop.openText,
    closeText: shop.closeText,
    address: shop.address,
    access: shop.access,
    url: shop.url,
    photo: shop.photo,
    sample: shop.sample,
    mapUrl: mapUrl(shop),
    score: round1(Math.min(100, weightedAvg * penalty * 100 + bonus)),
    breakdown,
    penalties,
    highlights: buildHighlights(shop, ctx, summary, price),
  };
}

/** Googleマップで開くURL（実在の店は「店名＋住所」で検索．サンプル店は座標を表示） */
function mapUrl(shop) {
  const query = shop.sample || !shop.address ? `${shop.lat.toFixed(6)},${shop.lng.toFixed(6)}` : `${shop.name} ${shop.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 結果画面に出す「おすすめポイント」「注意点」 */
function buildHighlights(shop, ctx, summary, price) {
  const good = [];
  const caution = [];

  if (ctx.distanceKm <= 0.5) good.push(`${ctx.locationName}から近い（約${formatDistance(ctx.distanceKm)}）`);
  else if (ctx.distanceKm > 1.5) caution.push(`${ctx.locationName}から約${formatDistance(ctx.distanceKm)}`);

  // 予算の上限を少し（5%）超える程度なら「予算内」，20%超えたら注意
  if ((ctx.budget.min || ctx.budget.max) && price) {
    const max = ctx.budget.max || Infinity;
    if (price <= max * 1.05) good.push(`予算内（目安 ¥${price.toLocaleString()}）`);
    else if (price > max * 1.2) caution.push(`予算オーバー（目安 ¥${price.toLocaleString()}）`);
  }

  const n = summary.respondentCount;
  for (const v of shop.matched.active) {
    const label = ctx.subLabels[v];
    const pts = summary.subPoints[v];
    const c = summary.ratingCounts[v];
    if (summary.topSubs.length === 1 && summary.topSubs[0] === v) good.push(`${label}が最高評価（${signed(pts)}pt）`);
    else if (pts / n >= 0.5) good.push(`${label}が好評（${signed(pts)}pt）`);
    if (c.ng > 0) caution.push(`${label}に×が${c.ng}人`);
  }
  if (ctx.nomihodai === 'required') {
    if (shop.nomihodai === true) good.push('飲み放題あり');
    else if (shop.nomihodai === false) caution.push('飲み放題なし');
    else caution.push('飲み放題は要確認');
  }
  if (ctx.seat !== 'any') {
    const has = ctx.seat === 'private' ? shop.privateRoom : shop.zashiki;
    const label = SEAT_LABELS[ctx.seat];
    if (has === true) good.push(`${label}あり`);
    else if (has === false) caution.push(`${label}なし`);
    else caution.push(`${label}は要確認`);
  }
  if (ctx.smoking === 'nonsmoking') {
    if (shop.smoking === 'unknown') caution.push('禁煙席は要確認');
    else good.push(shop.smoking === 'none' ? '全面禁煙' : '禁煙席あり（分煙）');
  }
  if (ctx.smoking === 'smoking') {
    if (shop.smoking === 'unknown') caution.push('喫煙できるかは要確認');
    else good.push(shop.smoking === 'allowed' ? '喫煙可' : '喫煙席あり（分煙）');
  }
  if (ctx.takeout === 'want' && shop.takeout) good.push('テイクアウトの記載あり');
  if (isOpenAt(shop.hours, ctx.weekday, ctx.hour, MIN_STAY_HOURS) === null) caution.push('営業時間は要確認');
  return { good, caution };
}

// ---------------------------------------------------------------------------
// 4. まとめ
// ---------------------------------------------------------------------------
/**
 * @param room    { locationName, center: {lat, lng}, people, datetime, budget, category, subs, nomihodai, seat, smoking, takeout }
 * @param answers 参加者の回答
 * @param shops   候補のお店（内部形式．shopSource.fetchShops() の結果）
 */
function generateRanking(room, answers, shops) {
  if (!answers.length) throw new Error('回答が1件もありません');
  if (!room.center) throw new Error('場所の座標がありません');
  const budget = normalizeBudget(room.budget);

  const summary = summarizeAnswers(answers, room);
  const baseCtx = {
    locationName: room.locationName,
    people: room.people,
    category: room.category,
    budget,
    subLabels: Object.fromEntries(room.subs.map((s) => [s.value, s.label])),
    // カフェでは飲み放題を条件にしない
    nomihodai: asksNomihodai(room.category) ? room.nomihodai || 'any' : 'any',
    seat: room.seat || 'any',
    smoking: room.smoking || 'any',
    takeout: room.takeout,
    ...parseDatetime(room.datetime),
  };

  const excluded = Object.fromEntries(EXCLUDE_REASONS.map((r) => [r, 0]));
  const scored = [];
  for (const raw of shops) {
    const shop = { ...raw, matched: matchSubs(raw, room.category, room.subs) };
    const ctx = { ...baseCtx, distanceKm: distanceKm(room.center, shop) };
    const reason = checkHardConstraints(shop, ctx);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    scored.push(scoreRestaurant(shop, ctx, summary));
  }

  // 点数 → 距離 の順（同点時のタイブレーク）
  scored.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

  return {
    generatedAt: new Date().toISOString(),
    conditions: {
      locationName: room.locationName,
      people: room.people,
      datetime: room.datetime,
      slot: baseCtx.slot,
      budgetLabel: formatBudget(budget),
      categoryLabel: CATEGORY_LABELS[room.category],
      nomihodai: baseCtx.nomihodai,
      seat: baseCtx.seat,
      smoking: baseCtx.smoking,
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

module.exports = { generateRanking, summarizeAnswers, scoreRestaurant, budgetScore, subCategoryScore, parseDatetime, BASE_WEIGHTS, TAKEOUT_BONUS };
