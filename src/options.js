/**
 * ルーム作成・アンケートで使う「選択肢」の定義．
 * サーバーのバリデーションとフロントの表示（GET /api/options）で共有する．
 *
 * ホストが決める : 場所・人数・日時・予算・大カテゴリ・飲み放題・席の希望・テイクアウト
 * 参加者が答える : 小カテゴリの評価（◎〇×）
 */

// 予算帯：ホストが1つ選ぶ．店の価格がこの範囲に入っていれば満点（max: null は上限なし）
const BUDGETS = [
  { value: 'under1000', label: '1,000円未満', min: 0, max: 999 },
  { value: '1000-3000', label: '1,000〜3,000円', min: 1000, max: 3000 },
  { value: '3000-5000', label: '3,000〜5,000円', min: 3000, max: 5000 },
  { value: 'over5000', label: '5,000円以上', min: 5000, max: null },
];

// 料理のジャンル：大カテゴリ（ホストが1つ選ぶ）→ 小カテゴリ（参加者が ◎〇× で評価）
const CATEGORIES = [
  {
    value: 'izakaya',
    label: '居酒屋',
    subs: [
      { value: 'taishu', label: '大衆居酒屋' },
      { value: 'yakitori', label: '焼き鳥' },
      { value: 'kaisen', label: '海鮮' },
      { value: 'bal', label: 'バル' },
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
      { value: 'work', label: '作業向け' },
    ],
  },
  {
    value: 'meal',
    label: 'ご飯',
    subs: [
      { value: 'washoku', label: '和食' },
      { value: 'yoshoku', label: '洋食' },
      { value: 'chuka', label: '中華' },
      { value: 'yakiniku', label: '焼肉' },
      { value: 'ramen', label: 'ラーメン' },
      { value: 'fastfood', label: 'ファストフード' },
      { value: 'konamon', label: '粉もの' },
      { value: 'curry', label: 'カレー' },
    ],
  },
];

// 小カテゴリの評価：参加者が小カテゴリごとに ◎ / 〇 / × を付ける（初期値は 〇）
const RATINGS = [
  { value: 'great', label: '◎', hint: '行きたい', points: 2 },
  { value: 'ok', label: '〇', hint: 'どちらでも', points: 1 },
  { value: 'ng', label: '×', hint: '避けたい', points: -2 },
];
const DEFAULT_RATING = 'ok';
const RATING_POINTS = Object.fromEntries(RATINGS.map((r) => [r.value, r.points]));

// 飲み放題：ホストが決める．カフェでは選択肢を出さない
const NOMIHODAI = [
  { value: 'required', label: '必須' },
  { value: 'any', label: 'どちらでもよい' },
];
const CATEGORIES_WITHOUT_NOMIHODAI = ['cafe'];

// テイクアウト：ホストが決める
const TAKEOUT = [
  { value: 'want', label: '希望する' },
  { value: 'no', label: 'しない' },
];

// 席の希望：ホストが決める
const SEATS = [
  { value: 'table', label: 'テーブル' },
  { value: 'counter', label: 'カウンター' },
  { value: 'private', label: '個室' },
  { value: 'any', label: 'どこでもよい' },
];

const MAX_PEOPLE = 30;

// --- helpers ---
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const SUB_LABELS = Object.fromEntries(CATEGORIES.flatMap((c) => c.subs.map((s) => [s.value, s.label])));
const SUB_TO_CATEGORY = Object.fromEntries(CATEGORIES.flatMap((c) => c.subs.map((s) => [s.value, c.value])));
const subsOf = (category) => (CATEGORIES.find((c) => c.value === category) || { subs: [] }).subs;
const asksNomihodai = (category) => !CATEGORIES_WITHOUT_NOMIHODAI.includes(category);

module.exports = {
  BUDGETS,
  CATEGORIES,
  RATINGS,
  DEFAULT_RATING,
  RATING_POINTS,
  NOMIHODAI,
  CATEGORIES_WITHOUT_NOMIHODAI,
  TAKEOUT,
  SEATS,
  MAX_PEOPLE,
  CATEGORY_LABELS,
  SUB_LABELS,
  SUB_TO_CATEGORY,
  subsOf,
  asksNomihodai,
};
