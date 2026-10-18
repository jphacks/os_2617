/**
 * ホットペッパーのジャンル ⇔ このアプリの大カテゴリ・小カテゴリ の対応表
 * ===========================================================================
 *
 * ホットペッパーのジャンル（ジャンルマスタAPI）は17種類で，このアプリの小カテゴリ
 * （焼き鳥・串揚げ・カレー・パフェ…）より粗い．そこで2段階で判定する．
 *
 *   ① 対象ジャンル（SCOPE）: 大カテゴリごとに，候補として取ってくるジャンルコード
 *   ② 小カテゴリの判定（RULES）: 店名とジャンルキャッチ（「炭火焼鳥と九州料理」のような短い紹介）を見て
 *        1. キーワードに当たった小カテゴリ（具体的な判定）を採用（複数可）
 *        2. 当たらなければ，ジャンルコードで決まる小カテゴリ（大まかな判定）を採用
 *        3. 「ランチ」「作業向け」は店の種類ではなく特徴なので，1・2 に足す形で付ける
 *      例）居酒屋(G001)で「炭火焼き鳥」→ 焼き鳥 / 居酒屋(G001)で特徴なし → 大衆居酒屋
 *          カフェ(G014)で「Wi-Fi・電源あり」→ カフェ＋作業向け
 *      お店キャッチ（宣伝文：「生ビール・カクテルも豊富」など）は誤判定が多いので既定の判定には使わない
 *   ③ ホストが追加した小カテゴリ（自由入力）は，その言葉を含む店を「具体的な判定」で一致とする
 *      （対象ジャンルの外の店でも一致する．例：ご飯 に「もつ鍋」を追加 → 居酒屋のもつ鍋店も候補）
 *
 * どの小カテゴリにも当たらない店は「ジャンル外」として候補から外す．
 * ホストが削除した小カテゴリだけに当たる店も外す（例：焼き鳥を削除 → 焼き鳥の店は出ない）．
 *
 * queries は，その小カテゴリの店を取りこぼさないよう追加で検索するキーワード
 * （ホットペッパーの keyword 検索は部分一致．1語ずつ検索する）．
 */

// ホットペッパーのジャンルコード（ジャンルマスタAPI）
const HP_GENRES = {
  G001: '居酒屋',
  G002: 'ダイニングバー・バル',
  G003: '創作料理',
  G004: '和食',
  G005: '洋食',
  G006: 'イタリアン・フレンチ',
  G007: '中華',
  G008: '焼肉・ホルモン',
  G017: '韓国料理',
  G009: 'アジア・エスニック料理',
  G010: '各国料理',
  G011: 'カラオケ・パーティ',
  G012: 'バー・カクテル',
  G013: 'ラーメン',
  G016: 'お好み焼き・もんじゃ',
  G014: 'カフェ・スイーツ',
  G015: 'その他グルメ',
};

// ① 大カテゴリごとに候補として取ってくるジャンル
const SCOPE = {
  meal: ['G004', 'G005', 'G006', 'G007', 'G008', 'G017', 'G009', 'G010', 'G013', 'G016', 'G003', 'G015'],
  izakaya: ['G001', 'G002', 'G012', 'G008', 'G017'],
  cafe: ['G014'],
};

// ② 小カテゴリの判定ルール
//   genres   : このジャンルコードなら（キーワードに当たらなくても）この小カテゴリ
//   keywords : 店名・ジャンルキャッチにこれが含まれればこの小カテゴリ
//   skipGenres: このジャンルの店にはキーワード判定を使わない（例：ラーメン店の「中華そば」をそばにしない）
//   attribute: 店の種類でなく特徴（他の判定に足す）
//   queries  : 取りこぼし防止の追加検索キーワード
// prettier-ignore
const RULES = {
  meal: {
    washoku:     { genres: ['G004'] },
    yoshoku:     { genres: ['G005', 'G006'] },
    chuka:       { genres: ['G007'] },
    yakiniku:    { genres: ['G008'], keywords: /焼肉|ホルモン/ },
    ramen:       { genres: ['G013'], keywords: /ラーメン|らーめん|らぁ麺|らー麺|拉麺|中華そば|中華蕎麦|支那そば|まぜそば|油そば|鶏そば|つけ麺|担々麺|坦々麺/ },
    'udon-soba': { keywords: /うどん|饂飩|(?<!焼き?|中華|ソース|まぜ|油|鶏|の|すぐ|駅)そば(?!めし)|(?<!中華|支那)蕎麦|ソバ(?!ージュ)/, skipGenres: ['G013'], queries: ['うどん', 'そば'] },
    fastfood:    { keywords: /バーガー|ファストフード|ファーストフード|牛丼|ホットドッグ|フライドチキン/, queries: ['ハンバーガー'] },
    konamon:     { genres: ['G016'], keywords: /お好み焼|たこ焼|もんじゃ|明石焼|粉もん|粉もの/ },
    curry:       { keywords: /カレー|curry/i, queries: ['カレー'] },
    korean:      { genres: ['G017'], keywords: /韓国|サムギョプサル|タッカルビ|ビビンバ|チゲ/ },
    ethnic:      { genres: ['G009', 'G010'], keywords: /エスニック|タイ料理|ベトナム|インド料理|インドカレー|ネパール|メキシカン|トルコ料理|スリランカ|ガパオ/ },
  },
  izakaya: {
    taishu:   { genres: ['G001'], keywords: /大衆|立ち?飲み|立ち?呑み|角打ち|せんべろ/ },
    yakitori: { keywords: /焼き?鳥|やきとり|鶏料理|地鶏|串焼/, queries: ['焼き鳥', '焼鳥'] },
    kushiage: { keywords: /串カツ|串かつ|串揚|串あげ/, queries: ['串カツ', '串揚げ'] },
    yakiniku: { genres: ['G008'], keywords: /焼肉|ホルモン/ },
    kaisen:   { keywords: /海鮮|鮮魚|魚介|お魚|寿司|鮨|刺身|浜焼|炉端|牡蠣|かき小屋|蟹|ふぐ/, queries: ['海鮮'] },
    wine:     { genres: ['G002'], keywords: /ワイン(?:バー|バル|酒場|食堂|ダイニング|と)|バル(?!コニー|ーン)|ビストロ/ },
    korean:   { genres: ['G017'], keywords: /韓国|サムギョプサル|ポチャ|タッカルビ/ },
    bar:      { genres: ['G012'], keywords: /\bBAR\b|ショットバー|オーセンティックバー|カクテルバー/i },
  },
  cafe: {
    cafe:    { genres: ['G014'] },
    kissa:   { keywords: /喫茶|珈琲|コーヒー専門|自家焙煎/, queries: ['喫茶'] },
    parfait: { keywords: /パフェ|甘味|パーラー/, queries: ['パフェ'] },
    bakery:  { keywords: /ベーカリー|ブーランジェリー|(?<!ジャ|シャン|フライ|ス)パン(?!ケーキ|ナコッタ|ダ|ツ|プキン|ジー|チ|ナ)|bakery/i, queries: ['パン'] },
    korean:  { keywords: /韓国|ソウル|韓流/, queries: ['韓国'] },
    lunch:   { keywords: /ランチ|カフェごはん|カフェ飯|ごはんカフェ|定食|プレート/, attribute: true, queries: ['ランチ'] },
    work:    { keywords: /電源|Wi-?Fi|作業|ノマド|コワーキング|勉強/i, attribute: true, queries: ['電源'] },
  },
};

const scopeOf = (category) => SCOPE[category] || [];
const ruleOf = (category, sub) => (RULES[category] || {})[sub] || null;

// 自由入力の小カテゴリは表記ゆれを吸収して比べる（カタカナ→ひらがな，全角英数→半角，小文字）
function normalizeText(s) {
  return String(s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
}
/** 自由入力の小カテゴリ → 判定・検索に使う語（「もつ鍋・水炊き」なら2語） */
const customTerms = (label) => String(label || '').split(/[・、,，/／\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 3);

/** 既定の小カテゴリの判定に使う文章：店名＋ジャンルキャッチ（ジャンル名は「カフェ・スイーツ」のように全店共通なので使わない） */
const shopText = (shop) => [shop.name, shop.genreCatch].filter(Boolean).join(' ');
/** ホストが追加した小カテゴリは，お店キャッチ（宣伝文）まで含めて探す */
const shopTextWide = (shop) => [shop.name, shop.genreCatch, shop.catchText].filter(Boolean).join(' ');

/**
 * 店がどの小カテゴリに当たるか．
 * @param shop      正規化済みの店（shopData.normalizeShop の結果）
 * @param category  大カテゴリ
 * @param roomSubs  ルームの小カテゴリ [{ value, label, custom }]（ホストが削除したものは含まれない）
 * @returns { all: 当たった小カテゴリ（削除済みの既定も含む）, active: そのうちルームで有効なもの }
 */
function matchSubs(shop, category, roomSubs) {
  const text = shopText(shop);
  const codes = [shop.genreCode, shop.subGenreCode].filter(Boolean);
  const inScope = codes.some((c) => scopeOf(category).includes(c));
  const rules = RULES[category] || {};

  // 1. キーワード（具体的な判定）：既定の小カテゴリは対象ジャンル内の店だけ，追加分はどこでも
  const specific = [];
  const attributes = [];
  if (inScope) {
    for (const [sub, r] of Object.entries(rules)) {
      if (!r.keywords || !r.keywords.test(text) || (r.skipGenres || []).some((c) => codes.includes(c))) continue;
      (r.attribute ? attributes : specific).push(sub);
    }
  }
  const normalized = normalizeText(shopTextWide(shop));
  for (const s of roomSubs) {
    if (s.custom && customTerms(s.label).some((t) => normalized.includes(normalizeText(t)))) specific.push(s.value);
  }

  // 2. ジャンルコード（大まかな判定）：キーワードに当たらなかったときだけ．メインジャンルを優先
  let all = specific;
  if (!all.length && inScope) {
    for (const code of codes) {
      const hit = Object.entries(rules).find(([, r]) => (r.genres || []).includes(code));
      if (hit) { all = [hit[0]]; break; }
    }
  }
  // 3. 特徴（ランチ・作業向け）は種類の判定に足す
  all = [...all, ...attributes];
  const enabled = new Set(roomSubs.map((s) => s.value));
  return { all, active: all.filter((v) => enabled.has(v)) };
}

/** 取りこぼし防止の追加検索：[{ keyword, inScope }]（追加の小カテゴリはジャンルで絞らない） */
function extraQueries(category, roomSubs) {
  const out = [];
  for (const s of roomSubs) {
    const words = s.custom ? customTerms(s.label).slice(0, 2) : ((ruleOf(category, s.value) || {}).queries || []);
    for (const keyword of words) if (!out.some((q) => q.keyword === keyword)) out.push({ keyword, inScope: !s.custom });
  }
  return out;
}

module.exports = { HP_GENRES, SCOPE, RULES, scopeOf, ruleOf, normalizeText, customTerms, shopText, shopTextWide, matchSubs, extraQueries };
