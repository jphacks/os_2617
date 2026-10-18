/**
 * サンプルの店舗データ（大阪・京都 125件．店名・データはすべて架空）．
 *
 * ホットペッパーのAPIキーがないとき（ローカル開発・テスト・確認用ページ）に使う．
 * ホットペッパーの検索APIと「同じ形の応答」を返す mockSearch() を用意しているので，
 * 場所の推定・候補の取得・正規化・ジャンル判定・ランキングは実データと同じ処理を通る．
 */

const { RULES } = require('./genreMap');

// エリア（以前の「場所を選ぶ」形式で作られたルームの読み込みと，サンプル店舗の配置に使う）
// prettier-ignore
const AREAS = [
  { id: 'umeda',          name: '梅田',     city: '大阪', lat: 34.7025, lng: 135.4959, address: '大阪府大阪市北区梅田1丁目',       station: '梅田' },
  { id: 'namba',          name: '難波',     city: '大阪', lat: 34.6665, lng: 135.501,  address: '大阪府大阪市中央区難波3丁目',     station: 'なんば' },
  { id: 'shinsaibashi',   name: '心斎橋',   city: '大阪', lat: 34.6748, lng: 135.5012, address: '大阪府大阪市中央区心斎橋筋2丁目', station: '心斎橋' },
  { id: 'tennoji',        name: '天王寺',   city: '大阪', lat: 34.6466, lng: 135.5133, address: '大阪府大阪市阿倍野区阿倍野筋1丁目', station: '天王寺' },
  { id: 'kyobashi',       name: '京橋',     city: '大阪', lat: 34.6966, lng: 135.5337, address: '大阪府大阪市都島区東野田町3丁目', station: '京橋' },
  { id: 'kyoto-station',  name: '京都駅',   city: '京都', lat: 34.9858, lng: 135.7588, address: '京都府京都市下京区東塩小路町',     station: '京都' },
  { id: 'shijo-karasuma', name: '四条烏丸', city: '京都', lat: 35.0038, lng: 135.7597, address: '京都府京都市下京区四条通烏丸東入', station: '四条' },
  { id: 'kawaramachi',    name: '河原町',   city: '京都', lat: 35.0037, lng: 135.769,  address: '京都府京都市中京区河原町通四条上ル', station: '京都河原町' },
  { id: 'gion',           name: '祇園',     city: '京都', lat: 35.0037, lng: 135.7757, address: '京都府京都市東山区祇園町南側',     station: '祇園四条' },
];

// ---------------------------------------------------------------------------
// 店舗データ（表形式．下の toHotpepperShop() でホットペッパーの shop 要素の形にする）
//   大/小     : 大カテゴリ / 小カテゴリ（options.js の CATEGORIES の value）
//   昼/夜     : 1人あたりの目安予算（円）．昼 null = ランチ営業なし
//   開/閉     : 営業時間（時．24以上は深夜 例: 26 = 翌2時）
//   定休      : 曜日（0=日 … 6=土）
//   雰/コ/評価: 使わない（以前の版の名残）
//   飲/持     : 飲み放題 / テイクアウト（1 or 0）
//   席        : T=テーブル, C=カウンター, P=個室（→ 個室あり）  最大: 受け入れ可能な最大人数
//   煙        : N=全面禁煙, S=分煙, Y=喫煙可
// ---------------------------------------------------------------------------
// prettier-ignore
const ROWS = [
  // id      店名                              エリア            大         小           昼    夜     開    閉   定休 雰 コ 評価 飲 持 席     最大 煙
  // ---- 梅田 ----
  ['u01', '炭火と地酒 うめ灯',              'umeda',          'izakaya', 'taishu',    null, 3500,  17,   24,  [],   3, 4, 3.6, 1, 0, 'TCP', 30, 'S'],
  ['u02', '焼鳥 とりまさ 梅田',             'umeda',          'izakaya', 'yakitori',  null, 3200,  17,   24,  [0],  3, 4, 3.9, 1, 1, 'TC',  12, 'S'],
  ['u03', '北新地 BAR 月光',                'umeda',          'izakaya', 'bar',       null, 5500,  19,   27,  [0],  5, 2, 4.1, 0, 0, 'CP',  8,  'Y'],
  ['u11', '肉バル GRILL&CO 梅田',           'umeda',          'izakaya', 'wine',      1200, 3800,  11.5, 23,  [],   4, 4, 3.8, 1, 0, 'TCP', 25, 'N'],
  ['u13', '焼肉酒場 炎丸 梅田',             'umeda',          'izakaya', 'yakiniku',  null, 3500,  17,   24,  [],   3, 4, 3.8, 1, 0, 'TP',  30, 'S'],
  ['u04', '梅田珈琲 ひだまり',              'umeda',          'cafe',    'kissa',     900,  1000,  8,    21,  [],   4, 4, 3.8, 0, 1, 'TC',  6,  'S'],
  ['u05', 'WORK CAFE NODE 梅田',            'umeda',          'cafe',    'work',      1000, 1200,  8,    23,  [],   3, 4, 3.9, 0, 1, 'TC',  4,  'N'],
  ['u06', 'パフェ専門 梅田フルーツ堂',      'umeda',          'cafe',    'parfait',   1600, 1800,  11,   23,  [2],  5, 3, 4.2, 0, 0, 'T',   6,  'N'],
  ['u14', '韓国カフェ ハル 梅田',           'umeda',          'cafe',    'korean',    1200, 1300,  11,   20,  [2],  4, 3, 3.9, 0, 1, 'T',   6,  'N'],
  ['u07', 'Trattoria Luce 梅田',            'umeda',          'meal',    'yoshoku',   1500, 4500,  11,   23,  [2],  5, 3, 4.1, 0, 1, 'TC',  12, 'N'],
  ['u08', '北新地 割烹 しずく',             'umeda',          'meal',    'washoku',   null, 9000,  17.5, 23,  [0],  5, 3, 4.4, 0, 0, 'CP',  8,  'N'],
  ['u09', '点心酒場 梅龍',                  'umeda',          'meal',    'chuka',     900,  2500,  11,   23,  [],   2, 5, 3.5, 1, 1, 'T',   20, 'N'],
  ['u10', 'お好み焼 梅田ぼてこ',            'umeda',          'meal',    'konamon',   1000, 1800,  11,   23,  [],   3, 5, 3.8, 1, 1, 'TC',  16, 'S'],
  ['u12', '手打ちそば 更科 梅田',           'umeda',          'meal',    'udon-soba', 1000, 2500,  11,   22,  [3],  4, 4, 4.0, 0, 0, 'TC',  10, 'N'],
  // ---- 難波 ----
  ['n01', '大衆酒場 なんば屋',              'namba',          'izakaya', 'taishu',    null, 2000,  15,   24,  [],   2, 5, 3.4, 1, 0, 'TC',  25, 'Y'],
  ['n02', '魚河岸酒場 なんば浜',            'namba',          'izakaya', 'kaisen',    null, 4000,  16,   23,  [],   3, 4, 3.9, 1, 0, 'TCP', 30, 'S'],
  ['n03', 'スペインバル Sol なんば',        'namba',          'izakaya', 'wine',      1200, 3500,  11.5, 24,  [],   4, 4, 3.8, 1, 0, 'TC',  20, 'N'],
  ['n14', 'なんば 串かつ 二度づけ屋',       'namba',          'izakaya', 'kushiage',  1000, 2200,  11,   23,  [],   2, 5, 3.7, 1, 1, 'TC',  10, 'S'],
  ['n04', '喫茶 マロン なんば',             'namba',          'cafe',    'kissa',     800,  900,   7,    19,  [],   3, 4, 3.7, 0, 1, 'TC',  8,  'Y'],
  ['n05', 'なんばベーカリー 麦の音',        'namba',          'cafe',    'bakery',    700,  800,   7,    20,  [],   3, 5, 3.9, 0, 1, 'T',   6,  'N'],
  ['n06', '夜パフェ 星のしずく',            'namba',          'cafe',    'parfait',   null, 1800,  18,   25,  [1],  5, 3, 4.1, 0, 0, 'TC',  6,  'N'],
  ['n15', 'ランチカフェ ひより なんば',     'namba',          'cafe',    'lunch',     1100, 1300,  11,   18,  [],   4, 4, 3.8, 0, 1, 'T',   10, 'N'],
  ['n07', '難波 焼肉 炎々',                 'namba',          'meal',    'yakiniku',  1300, 4500,  11.5, 24,  [],   3, 4, 3.9, 1, 0, 'TP',  30, 'S'],
  ['n08', '上海小籠包 南華楼',              'namba',          'meal',    'chuka',     950,  2800,  11,   22,  [],   3, 4, 3.6, 1, 1, 'TP',  40, 'S'],
  ['n09', 'たこ焼き道楽 なにわ',            'namba',          'meal',    'konamon',   700,  900,   10,   22,  [],   2, 5, 4.0, 0, 1, 'C',   6,  'S'],
  ['n10', 'Bistro Petit なんば',            'namba',          'meal',    'yoshoku',   1400, 4200,  11.5, 22,  [1],  5, 3, 4.0, 0, 0, 'TC',  8,  'N'],
  ['n11', 'らーめん 難波麺道',              'namba',          'meal',    'ramen',     950,  1000,  11,   26,  [],   1, 5, 3.8, 0, 0, 'C',   4,  'N'],
  ['n12', 'うどん 釜たけ なんば',           'namba',          'meal',    'udon-soba', 900,  1100,  11,   22,  [],   2, 5, 3.9, 0, 1, 'TC',  8,  'N'],
  ['n13', 'ベトナム食堂 フォーなんば',      'namba',          'meal',    'ethnic',    1000, 2200,  11,   22,  [3],  3, 4, 3.7, 0, 1, 'T',   12, 'N'],
  // ---- 心斎橋 ----
  ['s01', '海鮮居酒屋 月あかり',            'shinsaibashi',   'izakaya', 'kaisen',    null, 4500,  17,   24,  [],   4, 3, 3.9, 1, 0, 'TP',  40, 'N'],
  ['s02', '心斎橋 焼き鳥 ひのとり',         'shinsaibashi',   'izakaya', 'yakitori',  null, 3800,  17,   24,  [3],  4, 3, 4.1, 1, 0, 'CP',  10, 'S'],
  ['s03', 'Bar Ambre 心斎橋',               'shinsaibashi',   'izakaya', 'bar',       null, 4500,  19,   28,  [],   5, 3, 4.3, 0, 0, 'C',   6,  'S'],
  ['s13', '韓国酒場 ポチャ 心斎橋',         'shinsaibashi',   'izakaya', 'korean',    null, 3000,  17,   25,  [],   3, 4, 3.8, 1, 0, 'TP',  30, 'S'],
  ['s04', 'CAFE AOI 心斎橋',                'shinsaibashi',   'cafe',    'cafe',      1200, 1300,  10,   22,  [],   5, 3, 4.0, 0, 1, 'TC',  8,  'N'],
  ['s05', 'パフェテリア ミエル',            'shinsaibashi',   'cafe',    'parfait',   1700, 1900,  12,   22,  [3],  5, 3, 4.2, 0, 0, 'T',   6,  'N'],
  ['s06', '作業カフェ デスク心斎橋',        'shinsaibashi',   'cafe',    'work',      900,  1000,  9,    22,  [],   3, 4, 3.7, 0, 1, 'TC',  4,  'N'],
  ['s14', '韓国カフェ ソウルムード 心斎橋', 'shinsaibashi',   'cafe',    'korean',    1300, 1400,  11,   21,  [],   5, 3, 4.0, 0, 1, 'T',   6,  'N'],
  ['s07', '心斎橋 鮨 たちばな',             'shinsaibashi',   'meal',    'washoku',   2500, 8000,  12,   22,  [3],  5, 3, 4.3, 0, 1, 'CP',  6,  'N'],
  ['s08', 'Osteria Mare 心斎橋',            'shinsaibashi',   'meal',    'yoshoku',   1600, 5000,  11.5, 23,  [],   5, 3, 4.2, 1, 0, 'TP',  20, 'N'],
  ['s09', '四川麻辣 紅天',                  'shinsaibashi',   'meal',    'chuka',     1000, 3000,  11,   23,  [2],  3, 4, 3.9, 1, 1, 'T',   16, 'S'],
  ['s10', 'カレー食堂 スパイス堂',          'shinsaibashi',   'meal',    'curry',     900,  1100,  11,   21,  [],   2, 5, 3.8, 0, 1, 'TC',  6,  'N'],
  ['s11', 'BURGER STAND 心斎橋',            'shinsaibashi',   'meal',    'fastfood',  1000, 1200,  10,   23,  [],   3, 4, 3.7, 0, 1, 'TC',  12, 'N'],
  ['s12', '韓国料理 ソウル食堂 心斎橋',     'shinsaibashi',   'meal',    'korean',    1000, 3000,  11,   23,  [],   3, 4, 3.8, 1, 1, 'TP',  24, 'N'],
  // ---- 天王寺 ----
  ['t01', '大衆酒場 てんのじ',              'tennoji',        'izakaya', 'taishu',    1500, 2200,  12,   23,  [],   2, 5, 3.7, 1, 0, 'TC',  30, 'Y'],
  ['t02', 'Rooftop Dining SORA',            'tennoji',        'izakaya', 'wine',      null, 5500,  17,   24,  [],   5, 2, 4.0, 1, 0, 'TCP', 40, 'N'],
  ['t03', 'あべの 海鮮処 浜よし',           'tennoji',        'izakaya', 'kaisen',    1300, 3800,  11,   22,  [],   4, 4, 3.8, 1, 1, 'TP',  24, 'N'],
  ['t13', '串揚げ 新世界かつ 天王寺',       'tennoji',        'izakaya', 'kushiage',  1200, 2500,  11,   23,  [],   2, 5, 3.8, 1, 1, 'TC',  20, 'Y'],
  ['t14', 'ホルモン酒場 てっちゃん 天王寺', 'tennoji',        'izakaya', 'yakiniku',  null, 2800,  16,   24,  [],   2, 5, 3.7, 1, 0, 'TC',  24, 'Y'],
  ['t04', 'あべの 純喫茶 ローレル',         'tennoji',        'cafe',    'kissa',     800,  900,   8,    20,  [4],  4, 4, 3.9, 0, 1, 'TC',  10, 'Y'],
  ['t05', 'ブーランジェリー ル・ブレ',      'tennoji',        'cafe',    'bakery',    600,  700,   7,    19,  [1],  3, 5, 4.0, 0, 1, 'T',   4,  'N'],
  ['t06', '公園前カフェ green',             'tennoji',        'cafe',    'cafe',      1100, 1200,  9,    21,  [],   4, 4, 3.7, 0, 1, 'T',   12, 'N'],
  ['t07', '天王寺 ホルモン 太陽',           'tennoji',        'meal',    'yakiniku',  null, 3000,  17,   24,  [3],  2, 5, 3.7, 1, 0, 'TC',  20, 'S'],
  ['t08', '洋食屋 グリル朝日',              'tennoji',        'meal',    'yoshoku',   1000, 1800,  11,   21,  [4],  3, 5, 3.9, 0, 1, 'TC',  10, 'N'],
  ['t09', '飲茶酒家 天香',                  'tennoji',        'meal',    'chuka',     1200, 3800,  11,   22.5, [],   4, 3, 3.7, 1, 1, 'TP',  30, 'N'],
  ['t10', '天王寺 ラーメン 汐',             'tennoji',        'meal',    'ramen',     900,  950,   11,   24,  [],   2, 4, 3.8, 0, 0, 'C',   6,  'N'],
  ['t11', 'あべの 和食処 こよみ',           'tennoji',        'meal',    'washoku',   1100, 3500,  11,   22,  [],   4, 4, 3.8, 1, 1, 'TP',  24, 'N'],
  ['t12', '韓国家庭料理 オンマ 天王寺',     'tennoji',        'meal',    'korean',    900,  2800,  11,   22,  [2],  3, 5, 3.9, 1, 1, 'T',   16, 'N'],
  // ---- 京橋 ----
  ['k01', '立ち呑み ちょい呑み 京橋',       'kyobashi',       'izakaya', 'taishu',    null, 1200,  14,   23,  [0],  1, 5, 3.5, 0, 0, 'C',   6,  'Y'],
  ['k02', '京橋 やきとり 鳥福',             'kyobashi',       'izakaya', 'yakitori',  null, 2800,  16,   24,  [],   3, 5, 3.8, 1, 1, 'TCP', 30, 'S'],
  ['k03', '京橋 魚市場酒場',                'kyobashi',       'izakaya', 'kaisen',    null, 3200,  16,   24,  [],   3, 4, 3.7, 1, 0, 'TP',  40, 'N'],
  ['k13', '韓国屋台 ハヌル 京橋',           'kyobashi',       'izakaya', 'korean',    null, 2800,  17,   24,  [],   3, 5, 3.7, 1, 0, 'T',   20, 'Y'],
  ['k04', '自家焙煎 喫茶ポプラ',            'kyobashi',       'cafe',    'kissa',     750,  850,   8,    19,  [0],  3, 4, 3.7, 0, 1, 'TC',  8,  'Y'],
  ['k05', 'COWORK CAFE 京橋',               'kyobashi',       'cafe',    'work',      1000, 1100,  8,    22,  [],   3, 4, 3.8, 0, 1, 'TC',  6,  'N'],
  ['k06', 'ベーカリーカフェ こむぎ畑',      'kyobashi',       'cafe',    'bakery',    800,  900,   7,    18,  [],   3, 4, 3.8, 0, 1, 'T',   6,  'N'],
  ['k14', 'カフェごはん もぐ 京橋',         'kyobashi',       'cafe',    'lunch',     1000, 1200,  11,   19,  [0],  3, 4, 3.7, 0, 1, 'TC',  8,  'N'],
  ['k07', '京橋 もつ鍋 ぐつぐつ',           'kyobashi',       'meal',    'washoku',   null, 3200,  17,   24,  [],   3, 4, 3.8, 1, 1, 'TP',  30, 'N'],
  ['k08', '餃子酒場 京橋飯店',              'kyobashi',       'meal',    'chuka',     800,  1800,  11,   24,  [],   2, 5, 3.6, 1, 1, 'TC',  20, 'S'],
  ['k09', 'Pizzeria Forno 京橋',            'kyobashi',       'meal',    'yoshoku',   1200, 2800,  11,   22,  [1],  4, 4, 3.9, 1, 1, 'T',   16, 'N'],
  ['k10', 'お好み焼き まる 京橋',           'kyobashi',       'meal',    'konamon',   900,  1700,  11,   23,  [],   3, 4, 3.7, 1, 1, 'T',   20, 'S'],
  ['k11', 'チキンバーガー Hop 京橋',        'kyobashi',       'meal',    'fastfood',  800,  900,   10,   22,  [],   2, 4, 3.5, 0, 1, 'TC',  10, 'N'],
  ['k12', 'タイ料理 バーンスワン 京橋',     'kyobashi',       'meal',    'ethnic',    1000, 2600,  11,   22,  [],   3, 4, 3.6, 1, 1, 'T',   14, 'N'],
  // ---- 京都駅 ----
  ['ks01', 'おばんざい酒場 いろは',          'kyoto-station',  'izakaya', 'taishu',    1300, 3800,  11.5, 22,  [],   4, 4, 3.9, 1, 0, 'TCP', 20, 'S'],
  ['ks02', '炉端と海鮮 えびす 京都駅前',     'kyoto-station',  'izakaya', 'kaisen',    null, 4200,  17,   23,  [],   4, 3, 3.9, 1, 0, 'TP',  30, 'N'],
  ['ks03', '八条口 BAR 灯',                  'kyoto-station',  'izakaya', 'bar',       null, 4000,  18,   25,  [0],  4, 3, 4.0, 0, 0, 'C',   8,  'Y'],
  ['ks13', '韓国酒場 ソジュ 京都駅',         'kyoto-station',  'izakaya', 'korean',    null, 3200,  17,   24,  [],   3, 4, 3.7, 1, 0, 'TP',  24, 'S'],
  ['ks04', '京都駅 喫茶 ツバメ',             'kyoto-station',  'cafe',    'kissa',     800,  900,   7,    20,  [],   3, 4, 3.7, 0, 1, 'TC',  8,  'S'],
  ['ks05', 'STATION WORK CAFE 京都',         'kyoto-station',  'cafe',    'work',      1000, 1100,  7,    23,  [],   3, 4, 3.8, 0, 1, 'TC',  4,  'N'],
  ['ks06', 'パン工房 ルヴァン 京都駅',       'kyoto-station',  'cafe',    'bakery',    600,  700,   7,    20,  [],   3, 5, 3.9, 0, 1, 'T',   6,  'N'],
  ['ks07', '中華そば 麺屋 しらかわ',         'kyoto-station',  'meal',    'ramen',     950,  1000,  11,   24,  [],   1, 5, 3.7, 0, 0, 'C',   4,  'N'],
  ['ks08', '八条口 肉割烹 たかせ',           'kyoto-station',  'meal',    'washoku',   null, 7000,  17,   23,  [2],  5, 3, 4.2, 0, 0, 'CP',  10, 'N'],
  ['ks09', 'Cucina 京都ステーション',        'kyoto-station',  'meal',    'yoshoku',   1500, 4000,  11,   23,  [],   4, 3, 3.7, 1, 1, 'TP',  35, 'N'],
  ['ks10', '中華酒場 龍門 京都駅店',         'kyoto-station',  'meal',    'chuka',     900,  2600,  11,   23,  [],   2, 4, 3.5, 1, 1, 'T',   40, 'S'],
  ['ks11', '京都駅 焼肉 牛若',               'kyoto-station',  'meal',    'yakiniku',  1200, 4500,  11.5, 23,  [],   3, 4, 3.8, 1, 0, 'TP',  30, 'S'],
  ['ks12', 'インド料理 ガネーシャ 京都駅',   'kyoto-station',  'meal',    'ethnic',    1000, 2500,  11,   22.5, [],   3, 5, 3.8, 1, 1, 'T',   20, 'N'],
  // ---- 四条烏丸 ----
  ['sk01', 'ワインバル Vino 烏丸',           'shijo-karasuma', 'izakaya', 'wine',      null, 4000,  17,   24,  [0],  4, 4, 3.9, 1, 0, 'TC',  12, 'N'],
  ['sk02', '烏丸 焼鳥 つくし',               'shijo-karasuma', 'izakaya', 'yakitori',  null, 3500,  17,   24,  [],   3, 4, 4.0, 1, 0, 'TCP', 20, 'S'],
  ['sk03', '烏丸 大衆酒場 まんぷく',         'shijo-karasuma', 'izakaya', 'taishu',    null, 2300,  16,   24,  [],   2, 5, 3.6, 1, 0, 'TC',  30, 'Y'],
  ['sk13', '揚げ処 みや 烏丸',               'shijo-karasuma', 'izakaya', 'kushiage',  null, 4000,  17,   23,  [0],  4, 3, 4.0, 1, 0, 'CP',  12, 'S'],
  ['sk04', '町家カフェ 和音',                'shijo-karasuma', 'cafe',    'cafe',      1300, 1400,  10,   20,  [3],  5, 3, 4.2, 0, 1, 'TP',  8,  'N'],
  ['sk05', '烏丸 喫茶 カナリア',             'shijo-karasuma', 'cafe',    'kissa',     900,  1000,  8,    20,  [],   4, 4, 3.9, 0, 1, 'TC',  10, 'N'],
  ['sk06', '烏丸 シェアラウンジカフェ',      'shijo-karasuma', 'cafe',    'work',      1100, 1200,  9,    22,  [],   3, 4, 3.8, 0, 1, 'TC',  6,  'N'],
  ['sk14', '町家ランチカフェ 縁',            'shijo-karasuma', 'cafe',    'lunch',     1200, 1400,  11,   18,  [3],  4, 4, 4.0, 0, 1, 'T',   10, 'N'],
  ['sk07', '京中華 柳華',                    'shijo-karasuma', 'meal',    'chuka',     1200, 3500,  11.5, 21.5, [1],  4, 4, 4.1, 0, 1, 'TP',  12, 'S'],
  ['sk08', '烏丸 定食 さわら',               'shijo-karasuma', 'meal',    'washoku',   900,  1300,  11,   21,  [0],  2, 5, 3.8, 0, 1, 'TC',  8,  'N'],
  ['sk09', '京の焼肉 錦',                    'shijo-karasuma', 'meal',    'yakiniku',  1500, 5500,  11.5, 23,  [],   4, 3, 4.0, 1, 0, 'TP',  24, 'S'],
  ['sk10', 'スープカレー ゆらり 烏丸',       'shijo-karasuma', 'meal',    'curry',     1100, 1300,  11,   22,  [],   3, 4, 3.8, 0, 1, 'T',   8,  'N'],
  ['sk11', 'お好み焼き 京ぼて',              'shijo-karasuma', 'meal',    'konamon',   900,  1800,  11,   22,  [2],  3, 4, 3.7, 1, 1, 'T',   16, 'S'],
  ['sk12', '京うどん 葵庵',                  'shijo-karasuma', 'meal',    'udon-soba', 900,  1200,  11,   21,  [],   3, 4, 3.9, 0, 1, 'TC',  10, 'N'],
  // ---- 河原町 ----
  ['kw01', '大衆居酒屋 ろっかく',            'kawaramachi',    'izakaya', 'taishu',    null, 2500,  16,   24,  [],   2, 5, 3.6, 1, 0, 'TCP', 40, 'Y'],
  ['kw02', '木屋町バル 川床テラス',          'kawaramachi',    'izakaya', 'wine',      1600, 4800,  11.5, 23,  [2],  5, 3, 4.1, 1, 0, 'TC',  14, 'N'],
  ['kw03', '先斗町 BAR 千鳥',                'kawaramachi',    'izakaya', 'bar',       null, 5000,  19,   26,  [],   5, 3, 4.3, 0, 0, 'C',   8,  'S'],
  ['kw13', '焼肉酒場 ジュウ 木屋町',         'kawaramachi',    'izakaya', 'yakiniku',  null, 3800,  17,   25,  [],   3, 4, 3.8, 1, 0, 'TP',  24, 'S'],
  ['kw04', '抹茶パフェ 茶々 河原町',         'kawaramachi',    'cafe',    'parfait',   1500, 1600,  11,   21,  [],   4, 3, 4.1, 0, 0, 'T',   6,  'N'],
  ['kw05', '河原町 純喫茶 ひかり',           'kawaramachi',    'cafe',    'kissa',     800,  900,   9,    22,  [],   4, 4, 3.9, 0, 1, 'TC',  10, 'Y'],
  ['kw06', '鴨川カフェ ナガレ',              'kawaramachi',    'cafe',    'cafe',      1200, 1300,  11,   23,  [],   5, 3, 4.0, 0, 1, 'TC',  10, 'N'],
  ['kw14', '韓国カフェ ダル 河原町',         'kawaramachi',    'cafe',    'korean',    1200, 1300,  11,   21,  [],   4, 3, 3.9, 0, 1, 'T',   8,  'N'],
  ['kw07', '中華そば 鶴麺',                  'kawaramachi',    'meal',    'ramen',     900,  950,   11,   23,  [],   1, 5, 3.9, 0, 0, 'C',   4,  'N'],
  ['kw08', '先斗町 京懐石 ほたる',           'kawaramachi',    'meal',    'washoku',   4000, 12000, 12,   22,  [3],  5, 2, 4.5, 0, 0, 'CP',  12, 'N'],
  ['kw09', 'ハンバーグ専門店 グリルK',       'kawaramachi',    'meal',    'yoshoku',   1200, 1800,  11,   22,  [],   3, 4, 3.8, 0, 1, 'T',   12, 'N'],
  ['kw10', 'バーガーキッチン 鴨 河原町',     'kawaramachi',    'meal',    'fastfood',  1000, 1200,  10,   22,  [],   3, 4, 3.6, 0, 1, 'TC',  14, 'N'],
  ['kw11', 'カレー 林檎堂',                  'kawaramachi',    'meal',    'curry',     1000, 1200,  11,   21,  [3],  3, 4, 3.9, 0, 1, 'TC',  8,  'N'],
  ['kw12', '韓国料理 ハンアリ 河原町',       'kawaramachi',    'meal',    'korean',    1100, 3200,  11.5, 23,  [],   3, 4, 3.8, 1, 1, 'TP',  20, 'N'],
  // ---- 祇園 ----
  ['g01', '祇園 割烹居酒屋 花灯',           'gion',           'izakaya', 'kaisen',    null, 4500,  17,   24,  [0],  4, 3, 4.0, 1, 0, 'CP',  10, 'N'],
  ['g02', '祇園 焼鳥 たまゆら',             'gion',           'izakaya', 'yakitori',  null, 4000,  17,   23,  [1],  4, 3, 4.1, 0, 0, 'CP',  8,  'S'],
  ['g03', '祇園 BAR 白川',                  'gion',           'izakaya', 'bar',       null, 6000,  19,   26,  [],   5, 2, 4.4, 0, 0, 'CP',  8,  'S'],
  ['g04', '甘味と軽食 ひなた',              'gion',           'cafe',    'parfait',   1100, 1200,  10,   18,  [],   4, 4, 3.8, 0, 1, 'T',   6,  'N'],
  ['g05', '祇園 喫茶 古都',                 'gion',           'cafe',    'kissa',     900,  1000,  9,    19,  [3],  5, 3, 4.0, 0, 1, 'TC',  8,  'Y'],
  ['g06', 'ベーカリー&カフェ 朝凪',         'gion',           'cafe',    'bakery',    700,  800,   8,    18,  [],   4, 4, 3.9, 0, 1, 'T',   8,  'N'],
  ['g13', 'おばんざいランチ 花 祇園',       'gion',           'cafe',    'lunch',     1400, 1500,  11,   17,  [1],  4, 3, 3.9, 0, 0, 'T',   8,  'N'],
  ['g07', 'Le Jardin 祇園',                 'gion',           'meal',    'yoshoku',   3500, 9000,  12,   22,  [1],  5, 3, 4.4, 0, 0, 'TP',  10, 'N'],
  ['g08', '祇園 四川 辛来',                 'gion',           'meal',    'chuka',     1300, 4000,  11.5, 22,  [],   4, 3, 3.9, 1, 1, 'TP',  20, 'N'],
  ['g09', '東山 京ちゃんこ 力',             'gion',           'meal',    'washoku',   null, 4200,  17,   23,  [],   3, 4, 3.8, 1, 0, 'TP',  30, 'N'],
  ['g10', '祇園 焼肉 円山',                 'gion',           'meal',    'yakiniku',  null, 6000,  17,   24,  [],   4, 3, 4.1, 1, 0, 'TP',  20, 'S'],
  ['g11', '祇園 ラーメン 白湯屋',           'gion',           'meal',    'ramen',     1000, 1000,  11,   24,  [],   2, 4, 3.7, 0, 0, 'TC',  8,  'N'],
  ['g12', 'にしんそば 東山庵',              'gion',           'meal',    'udon-soba', 1100, 1300,  10.5, 20,  [],   4, 4, 4.0, 0, 0, 'T',   8,  'N'],
];


// 小カテゴリ → ホットペッパーのジャンルコードと，キャッチ文（ジャンル判定のキーワードを含める）
// prettier-ignore
const SAMPLE_GENRE = {
  'izakaya/taishu':   ['G001', '気軽に飲める大衆酒場'],
  'izakaya/yakitori': ['G001', '備長炭で焼く焼き鳥'],
  'izakaya/kushiage': ['G001', '揚げたての串カツ'],
  'izakaya/yakiniku': ['G008', '焼肉とホルモンで乾杯'],
  'izakaya/kaisen':   ['G001', '朝獲れ鮮魚と海鮮料理'],
  'izakaya/wine':     ['G002', 'ワインと肉料理のバル'],
  'izakaya/korean':   ['G017', '韓国料理とマッコリ'],
  'izakaya/bar':      ['G012', 'カクテルとウイスキーのBAR'],
  'meal/washoku':     ['G004', '旬の素材を味わう和食'],
  'meal/yoshoku':     ['G005', '本格洋食・イタリアン'],
  'meal/chuka':       ['G007', '本格中華料理'],
  'meal/yakiniku':    ['G008', '厳選和牛の焼肉'],
  'meal/ramen':       ['G013', '濃厚スープのラーメン'],
  'meal/udon-soba':   ['G004', '手打ちのうどん・そば'],
  'meal/fastfood':    ['G015', 'ハンバーガーとポテト'],
  'meal/konamon':     ['G016', 'ふわとろお好み焼き・たこ焼き'],
  'meal/curry':       ['G015', 'スパイス香るカレー'],
  'meal/korean':      ['G017', '本場の韓国料理'],
  'meal/ethnic':      ['G009', 'アジアのエスニック料理'],
  'cafe/cafe':        ['G014', 'ゆったり過ごせるカフェ'],
  'cafe/kissa':       ['G014', '自家焙煎珈琲の喫茶店'],
  'cafe/parfait':     ['G014', '季節のフルーツパフェ'],
  'cafe/bakery':      ['G014', '焼きたてパンのベーカリー'],
  'cafe/korean':      ['G014', '韓国風スイーツのカフェ'],
  'cafe/lunch':       ['G014', '日替わりランチのカフェごはん'],
  'cafe/work':        ['G014', '電源・Wi-Fi完備で作業もできる'],
};
const GENRE_NAMES = { G001: '居酒屋', G002: 'ダイニングバー・バル', G004: '和食', G005: '洋食', G007: '中華', G008: '焼肉・ホルモン', G009: 'アジア・エスニック料理', G012: 'バー・カクテル', G013: 'ラーメン', G014: 'カフェ・スイーツ', G015: 'その他グルメ', G016: 'お好み焼き・もんじゃ', G017: '韓国料理' };
const SMOKING_TEXT = { N: '全面禁煙', S: '一部禁煙', Y: '禁煙席なし' };
const DAY_NAMES = '日月火水木金土';

/** id から決まる疑似乱数（0〜1）．毎回同じ座標になるように使う */
function hashToUnit(str, salt) {
  let h = 2166136261 ^ salt;
  for (const ch of str) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const hhmm = (h) => {
  const hh = Math.floor(h);
  const mm = String(Math.round((h - hh) * 60)).padStart(2, '0');
  return hh >= 24 ? `翌${hh - 24}:${mm}` : `${hh}:${mm}`;
};
const budgetCode = (yen) => (yen <= 500 ? 'B009' : yen <= 1000 ? 'B010' : yen <= 1500 ? 'B011' : yen <= 2000 ? 'B001' : yen <= 3000 ? 'B002' : yen <= 4000 ? 'B003' : yen <= 5000 ? 'B008' : yen <= 7000 ? 'B004' : yen <= 10000 ? 'B005' : 'B006');

/** 表の1行 → ホットペッパーの shop 要素と同じ形 */
function toHotpepperShop(row) {
  const [id, name, areaId, category, sub, lunch, dinner, open, close, closedDays, , , , nomihodai, takeout, seats, maxGroup, smoking] = row;
  const area = AREAS.find((a) => a.id === areaId);
  const genre = SAMPLE_GENRE[`${category}/${sub}`];
  if (!area || !genre || !RULES[category][sub]) throw new Error(`サンプル店舗の定義の不整合: ${id}`);
  const zashiki = ['washoku', 'taishu', 'kaisen', 'yakitori', 'udon-soba'].includes(sub) && seats.includes('T');
  return {
    id,
    name,
    address: `${area.address}${1 + Math.floor(hashToUnit(id, 3) * 20)}-${1 + Math.floor(hashToUnit(id, 4) * 15)}`,
    station_name: area.station,
    large_area: { name: area.city },
    middle_area: { name: area.name },
    small_area: { name: area.name },
    // 店の座標は「エリア中心 ± 約250m」に散らす
    lat: area.lat + (hashToUnit(id, 1) - 0.5) * 0.005,
    lng: area.lng + (hashToUnit(id, 2) - 0.5) * 0.005,
    genre: { code: genre[0], name: GENRE_NAMES[genre[0]], catch: genre[1] },
    sub_genre: null,
    catch: genre[1],
    budget: { code: budgetCode(dinner), name: '', average: lunch ? `ディナー：${dinner}円 ランチ：${lunch}円` : `${dinner}円` },
    capacity: maxGroup * 2,
    party_capacity: maxGroup,
    open: `月～日: ${hhmm(open)}～${hhmm(close)}`,
    close: closedDays.length ? closedDays.map((d) => DAY_NAMES[d]).join('・') : '無休',
    non_smoking: SMOKING_TEXT[smoking],
    private_room: seats.includes('P') ? 'あり' : 'なし',
    tatami: zashiki ? 'あり' : 'なし',
    horigotatsu: 'なし',
    free_drink: nomihodai ? 'あり' : 'なし',
    lunch: lunch ? 'あり' : 'なし',
    other_memo: takeout ? 'テイクアウト可' : '',
    urls: { pc: '' },
    photo: null,
    sample: true,
  };
}

const SAMPLE_SHOPS = ROWS.map(toHotpepperShop);

// ホットペッパーの range（1〜5）→ 半径
const RANGE_METERS = { 1: 300, 2: 500, 3: 1000, 4: 2000, 5: 3000 };

function meters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

/**
 * ホットペッパーのグルメサーチAPIと同じ形で答える（サンプル店舗から検索）
 *   keyword : 店名・住所・駅名・キャッチ・エリア名の部分一致（空白区切りはAND）
 *   lat/lng/range : 半径検索（距離の近い順）    genre : カンマ区切り    start/count : ページ
 */
function mockSearch(params = {}) {
  let list = SAMPLE_SHOPS;
  if (params.keyword) {
    const words = String(params.keyword).split(/\s+/).filter(Boolean);
    list = list.filter((s) => {
      const text = [s.name, s.address, s.station_name, s.genre.catch, s.catch, s.middle_area.name, s.large_area.name].join(' ');
      return words.every((w) => text.includes(w));
    });
  }
  if (params.genre) {
    const codes = String(params.genre).split(',');
    list = list.filter((s) => codes.includes(s.genre.code) || (s.sub_genre && codes.includes(s.sub_genre.code)));
  }
  if (params.lat !== undefined && params.lng !== undefined) {
    const center = { lat: Number(params.lat), lng: Number(params.lng) };
    const radius = RANGE_METERS[params.range || 3];
    list = list.map((s) => [meters(center, s), s]).filter(([m]) => m <= radius).sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  }
  const start = Math.max(1, Number(params.start) || 1);
  const count = Math.min(100, Math.max(1, Number(params.count) || 10));
  const page = list.slice(start - 1, start - 1 + count);
  return { results: { api_version: 'sample', results_available: list.length, results_returned: String(page.length), results_start: start, shop: page } };
}

module.exports = { AREAS, SAMPLE_SHOPS, mockSearch, RANGE_METERS };
