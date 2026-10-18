/**
 * ルーム作成・アンケートで使う「選択肢」の定義．
 * サーバーのバリデーションとフロントの表示（GET /api/options）で共有する．
 *
 * ホストが決める : 場所（自由記述）・人数・日時・予算（下限〜上限）・ジャンル（大カテゴリ）
 *                  そのルームで評価する小カテゴリ（既定から削除・自由入力で追加）
 *                  詳細設定：飲み放題・席の希望・禁煙/喫煙・テイクアウト
 * 参加者が答える : 小カテゴリの評価（〇 好き / ー どちらでもない / × 好みじゃない．スワイプでも答えられる）
 */

const LOCATION_MAX = 40; // 場所（自由記述）の最大文字数

// ---------------------------------------------------------------------------
// 予算：ホストが下限・上限を 500円刻みで選ぶ（どちらも「指定なし」可）
// ---------------------------------------------------------------------------
const BUDGET_STEP = 500;
const BUDGET_MAX_STEP = 10000;
const BUDGET_STEPS = Array.from({ length: BUDGET_MAX_STEP / BUDGET_STEP }, (_, i) => (i + 1) * BUDGET_STEP); // 500〜10,000
const DEFAULT_BUDGET = { min: 3000, max: 5000 };

// 以前の「予算帯」形式で作られたルームを読むための対応表
const LEGACY_BUDGETS = {
  under1000: { min: null, max: 1000 },
  '1000-3000': { min: 1000, max: 3000 },
  '3000-5000': { min: 3000, max: 5000 },
  over5000: { min: 5000, max: null },
};

/** {min, max} / 旧形式の文字列 → {min, max}（null は指定なし） */
function normalizeBudget(b) {
  if (typeof b === 'string') return LEGACY_BUDGETS[b] ? { ...LEGACY_BUDGETS[b] } : { min: null, max: null };
  const pick = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) > 0 ? Number(v) : null);
  return { min: pick(b && b.min), max: pick(b && b.max) };
}

/** {min, max} → "3,000〜5,000円" / "3,000円〜" / "〜5,000円" / "指定なし" */
function formatBudget(b) {
  const yen = (n) => n.toLocaleString('ja-JP');
  if (b.min && b.max) return `${yen(b.min)}〜${yen(b.max)}円`;
  if (b.min) return `${yen(b.min)}円〜`;
  if (b.max) return `〜${yen(b.max)}円`;
  return '指定なし';
}

// ---------------------------------------------------------------------------
// 料理のジャンル：大カテゴリ（ホストが1つ選ぶ）→ 小カテゴリ（参加者が 〇ー× で評価）
// 小カテゴリの value は大カテゴリの中で一意（「焼肉」「韓国系」は複数の大カテゴリにある）
// ---------------------------------------------------------------------------
const CATEGORIES = [
  {
    value: 'meal',
    label: 'ご飯',
    subs: [
      { value: 'washoku', label: '和食' },
      { value: 'yoshoku', label: '洋食' },
      { value: 'chuka', label: '中華' },
      { value: 'yakiniku', label: '焼肉' },
      { value: 'ramen', label: 'ラーメン' },
      { value: 'udon-soba', label: 'うどんそば' },
      { value: 'fastfood', label: 'ファストフード' },
      { value: 'konamon', label: '粉もの' },
      { value: 'curry', label: 'カレー' },
      { value: 'korean', label: '韓国料理' },
      { value: 'ethnic', label: 'エスニック' },
    ],
  },
  {
    value: 'izakaya',
    label: '居酒屋',
    subs: [
      { value: 'taishu', label: '大衆居酒屋' },
      { value: 'yakitori', label: '焼き鳥' },
      { value: 'kushiage', label: '串揚げ' },
      { value: 'yakiniku', label: '焼肉' },
      { value: 'kaisen', label: '海鮮' },
      { value: 'wine', label: 'ワインダイニング' },
      { value: 'korean', label: '韓国系' },
      { value: 'bar', label: 'バー' },
    ],
  },
  {
    value: 'cafe',
    label: 'カフェ',
    subs: [
      { value: 'cafe', label: 'カフェ' },
      { value: 'kissa', label: '喫茶店' },
      { value: 'parfait', label: 'パフェ' },
      { value: 'bakery', label: 'ベーカリー' },
      { value: 'korean', label: '韓国系' },
      { value: 'lunch', label: 'ランチ' },
      { value: 'work', label: '作業向け' },
    ],
  },
];

// ---------------------------------------------------------------------------
// 小カテゴリの評価：参加者が小カテゴリごとに 〇（好き）/ ー（どちらでもない）/ × を付ける
//   画面では 右スワイプ=〇，上下スワイプ=ー，左スワイプ=×（ボタンでも可）．未回答は ー
// 順位を決めるのは配点の比だけ：×1つが〇2つ分を打ち消す（λ=2）
// ---------------------------------------------------------------------------
const RATINGS = [
  { value: 'great', label: '〇', hint: '好き', points: 1 },
  { value: 'ok', label: 'ー', hint: 'どちらでもない', points: 0 },
  { value: 'ng', label: '×', hint: '好みじゃない', points: -2 },
];
const DEFAULT_RATING = 'ok';
const RATING_POINTS = Object.fromEntries(RATINGS.map((r) => [r.value, r.points]));

// ---------------------------------------------------------------------------
// 詳細設定（ホストが決める．既定はすべて「こだわらない」）
// ---------------------------------------------------------------------------
// 飲み放題：カフェでは選択肢を出さない
const NOMIHODAI = [
  { value: 'required', label: '必須' },
  { value: 'any', label: 'どちらでもよい' },
];
const CATEGORIES_WITHOUT_NOMIHODAI = ['cafe'];

// 席の希望（ホットペッパーで分かる「個室」「座敷・掘りごたつ」だけ）
const SEATS = [
  { value: 'private', label: '個室' },
  { value: 'zashiki', label: '座敷・掘りごたつ' },
  { value: 'any', label: 'こだわらない' },
];

// 禁煙・喫煙：条件に合わない店は候補から除外する
//   禁煙   → 店内どこでも喫煙できる店（allowed）を除外．分煙の店は禁煙席があるので残す
//   喫煙可 → 全面禁煙の店（none）を除外
const SMOKING = [
  { value: 'nonsmoking', label: '禁煙' },
  { value: 'smoking', label: '喫煙可' },
  { value: 'any', label: 'どちらでもよい' },
];
// 店舗側の区分（ホットペッパーの「全面禁煙 / 一部禁煙 / 禁煙席なし」に対応．情報なしは不明）
const SHOP_SMOKING_LABELS = { none: '全面禁煙', separated: '分煙', allowed: '喫煙可', unknown: '不明' };

// テイクアウト：ホットペッパーに項目がないため，紹介文に「テイクアウト」等がある店を加点する（減点はしない）
const TAKEOUT = [
  { value: 'want', label: '希望する' },
  { value: 'no', label: 'しない' },
];

const MAX_PEOPLE = 30;

// ---------------------------------------------------------------------------
// ルームごとの小カテゴリ：ホストが既定から削除・自由入力で追加できる（そのルームだけに効く）
//   room.subs = [{ value: 'yakitori', label: '焼き鳥' }, { value: 'c1', label: 'もつ鍋', custom: true }, …]
// ---------------------------------------------------------------------------
const MAX_SUBS = 15; //       1ルームの小カテゴリの上限
const SUB_LABEL_MAX = 15; //  追加する小カテゴリの最大文字数

// --- helpers ---
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const subsOf = (category) => (CATEGORIES.find((c) => c.value === category) || { subs: [] }).subs;
const subLabel = (category, sub) => (subsOf(category).find((s) => s.value === sub) || { label: sub }).label;
const isValidSub = (category, sub) => subsOf(category).some((s) => s.value === sub);
const asksNomihodai = (category) => !CATEGORIES_WITHOUT_NOMIHODAI.includes(category);
const defaultSubs = (category) => subsOf(category).map((s) => ({ value: s.value, label: s.label }));
/** 追加する小カテゴリの名前を整える（前後の空白・改行・記号の連続を除く） */
const cleanSubLabel = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
const sameLabel = (a, b) => cleanSubLabel(a).toLowerCase() === cleanSubLabel(b).toLowerCase();

/**
 * ホストが送ってきた小カテゴリ → ルームに保存する形．
 * input: [{ value: 'washoku' }（既定）| { label: 'もつ鍋', custom: true }（追加）]．未指定なら既定のすべて
 * @returns { subs, error }
 */
function buildRoomSubs(category, input) {
  if (input === undefined || input === null) return { subs: defaultSubs(category), error: null };
  if (!Array.isArray(input)) return { subs: [], error: '小カテゴリの形式が不正です' };
  const subs = [];
  let n = 0;
  for (const s of input.slice(0, MAX_SUBS * 2)) {
    if (!s || typeof s !== 'object') continue;
    if (!s.custom && isValidSub(category, s.value)) {
      if (!subs.some((x) => x.value === s.value)) subs.push({ value: s.value, label: subLabel(category, s.value) });
    } else if (s.custom) {
      const label = cleanSubLabel(s.label);
      if (!label) continue;
      if (label.length > SUB_LABEL_MAX) return { subs: [], error: `追加する小カテゴリは${SUB_LABEL_MAX}文字以内にしてください` };
      if (subs.some((x) => sameLabel(x.label, label))) continue;
      n += 1;
      subs.push({ value: `c${n}`, label, custom: true });
    }
  }
  if (!subs.length) return { subs, error: '小カテゴリを1つ以上残してください' };
  if (subs.length > MAX_SUBS) return { subs, error: `小カテゴリは${MAX_SUBS}個までです` };
  return { subs, error: null };
}

module.exports = {
  LOCATION_MAX,
  MAX_SUBS,
  SUB_LABEL_MAX,
  defaultSubs,
  cleanSubLabel,
  buildRoomSubs,
  BUDGET_STEPS,
  DEFAULT_BUDGET,
  normalizeBudget,
  formatBudget,
  CATEGORIES,
  RATINGS,
  DEFAULT_RATING,
  RATING_POINTS,
  NOMIHODAI,
  CATEGORIES_WITHOUT_NOMIHODAI,
  SEATS,
  SMOKING,
  SHOP_SMOKING_LABELS,
  TAKEOUT,
  MAX_PEOPLE,
  CATEGORY_LABELS,
  subsOf,
  subLabel,
  isValidSub,
  asksNomihodai,
};
