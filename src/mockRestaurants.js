/**
 * モックの店舗データ（大阪・京都 99件．店名・データはすべて架空）．
 * 本来はぐるなび / ホットペッパー等の外部APIから取得し，この形に正規化する部分．
 */

const { SUB_TO_CATEGORY } = require('./options');

// エリア定義（中心座標）．店舗との距離 → 場所スコアに使う
const AREAS = [
  { id: 'umeda', name: '梅田', city: '大阪', lat: 34.7025, lng: 135.4959 },
  { id: 'namba', name: '難波', city: '大阪', lat: 34.6665, lng: 135.501 },
  { id: 'shinsaibashi', name: '心斎橋', city: '大阪', lat: 34.6748, lng: 135.5012 },
  { id: 'tennoji', name: '天王寺', city: '大阪', lat: 34.6466, lng: 135.5133 },
  { id: 'kyobashi', name: '京橋', city: '大阪', lat: 34.6966, lng: 135.5337 },
  { id: 'kyoto-station', name: '京都駅', city: '京都', lat: 34.9858, lng: 135.7588 },
  { id: 'shijo-karasuma', name: '四条烏丸', city: '京都', lat: 35.0038, lng: 135.7597 },
  { id: 'kawaramachi', name: '河原町', city: '京都', lat: 35.0037, lng: 135.769 },
  { id: 'gion', name: '祇園', city: '京都', lat: 35.0037, lng: 135.7757 },
];

// ---------------------------------------------------------------------------
// 店舗データ（表形式）
//   大/小     : 大カテゴリ / 小カテゴリ（options.js の CATEGORIES の value）
//   昼/夜     : 1人あたりの目安予算（円）．昼 null = ランチ営業なし
//   開/閉     : 営業時間（時．24以上は深夜 例: 26 = 翌2時）
//   定休      : 曜日（0=日 … 6=土）
//   雰/コ     : 雰囲気・コスパ（1〜5）   評価: 3.0〜5.0
//   飲/持     : 飲み放題 / テイクアウト（1 or 0）
//   席        : T=テーブル, C=カウンター, P=個室    最大: 受け入れ可能な最大人数
// ---------------------------------------------------------------------------
// prettier-ignore
const ROWS = [
  // id      店名                              エリア            大         小          昼    夜     開    閉   定休  雰 コ 評価 飲 持 席     最大
  // ---- 梅田 ----
  ['u01',  '炭火と地酒 うめ灯',               'umeda',          'izakaya', 'taishu',   null, 3500,  17,   24, [],   3, 4, 3.6, 1, 0, 'TCP', 30],
  ['u02',  '焼鳥 とりまさ 梅田',              'umeda',          'izakaya', 'yakitori', null, 3200,  17,   24, [0],  3, 4, 3.9, 1, 1, 'TC',  12],
  ['u03',  '北新地 BAR 月光',                 'umeda',          'izakaya', 'bar',      null, 5500,  19,   27, [0],  5, 2, 4.1, 0, 0, 'CP',   8],
  ['u11',  '肉バル GRILL&CO 梅田',            'umeda',          'izakaya', 'bal',      1200, 3800,  11.5, 23, [],   4, 4, 3.8, 1, 0, 'TCP', 25],
  ['u04',  '梅田珈琲 ひだまり',               'umeda',          'cafe',    'kissa',    900,  1000,  8,    21, [],   4, 4, 3.8, 0, 1, 'TC',   6],
  ['u05',  'WORK CAFE NODE 梅田',             'umeda',          'cafe',    'work',     1000, 1200,  8,    23, [],   3, 4, 3.9, 0, 1, 'TC',   4],
  ['u06',  'パフェ専門 梅田フルーツ堂',       'umeda',          'cafe',    'parfait',  1600, 1800,  11,   23, [2],  5, 3, 4.2, 0, 0, 'T',    6],
  ['u07',  'Trattoria Luce 梅田',             'umeda',          'meal',    'yoshoku',  1500, 4500,  11,   23, [2],  5, 3, 4.1, 0, 1, 'TC',  12],
  ['u08',  '北新地 割烹 しずく',              'umeda',          'meal',    'washoku',  null, 9000,  17.5, 23, [0],  5, 3, 4.4, 0, 0, 'CP',   8],
  ['u09',  '点心酒場 梅龍',                   'umeda',          'meal',    'chuka',    900,  2500,  11,   23, [],   2, 5, 3.5, 1, 1, 'T',   20],
  ['u10',  'お好み焼 梅田ぼてこ',             'umeda',          'meal',    'konamon',  1000, 1800,  11,   23, [],   3, 5, 3.8, 1, 1, 'TC',  16],
  // ---- 難波 ----
  ['n01',  '大衆酒場 なんば屋',               'namba',          'izakaya', 'taishu',   null, 2000,  15,   24, [],   2, 5, 3.4, 1, 0, 'TC',  25],
  ['n02',  '魚河岸酒場 なんば浜',             'namba',          'izakaya', 'kaisen',   null, 4000,  16,   23, [],   3, 4, 3.9, 1, 0, 'TCP', 30],
  ['n03',  'スペインバル Sol なんば',         'namba',          'izakaya', 'bal',      1200, 3500,  11.5, 24, [],   4, 4, 3.8, 1, 0, 'TC',  20],
  ['n04',  '喫茶 マロン なんば',              'namba',          'cafe',    'kissa',    800,  900,   7,    19, [],   3, 4, 3.7, 0, 1, 'TC',   8],
  ['n05',  'なんばベーカリー 麦の音',         'namba',          'cafe',    'bakery',   700,  800,   7,    20, [],   3, 5, 3.9, 0, 1, 'T',    6],
  ['n06',  '夜パフェ 星のしずく',             'namba',          'cafe',    'parfait',  null, 1800,  18,   25, [1],  5, 3, 4.1, 0, 0, 'TC',   6],
  ['n07',  '難波 焼肉 炎々',                  'namba',          'meal',    'yakiniku', 1300, 4500,  11.5, 24, [],   3, 4, 3.9, 1, 0, 'TP',  30],
  ['n08',  '上海小籠包 南華楼',               'namba',          'meal',    'chuka',    950,  2800,  11,   22, [],   3, 4, 3.6, 1, 1, 'TP',  40],
  ['n09',  'たこ焼き道楽 なにわ',             'namba',          'meal',    'konamon',  700,  900,   10,   22, [],   2, 5, 4.0, 0, 1, 'C',    6],
  ['n10',  'Bistro Petit なんば',             'namba',          'meal',    'yoshoku',  1400, 4200,  11.5, 22, [1],  5, 3, 4.0, 0, 0, 'TC',   8],
  ['n11',  'らーめん 難波麺道',               'namba',          'meal',    'ramen',    950,  1000,  11,   26, [],   1, 5, 3.8, 0, 0, 'C',    4],
  // ---- 心斎橋 ----
  ['s01',  '海鮮居酒屋 月あかり',             'shinsaibashi',   'izakaya', 'kaisen',   null, 4500,  17,   24, [],   4, 3, 3.9, 1, 0, 'TP',  40],
  ['s02',  '心斎橋 焼き鳥 ひのとり',          'shinsaibashi',   'izakaya', 'yakitori', null, 3800,  17,   24, [3],  4, 3, 4.1, 1, 0, 'CP',  10],
  ['s03',  'Bar Ambre 心斎橋',                'shinsaibashi',   'izakaya', 'bar',      null, 4500,  19,   28, [],   5, 3, 4.3, 0, 0, 'C',    6],
  ['s04',  'CAFE AOI 心斎橋',                 'shinsaibashi',   'cafe',    'cafe',     1200, 1300,  10,   22, [],   5, 3, 4.0, 0, 1, 'TC',   8],
  ['s05',  'パフェテリア ミエル',             'shinsaibashi',   'cafe',    'parfait',  1700, 1900,  12,   22, [3],  5, 3, 4.2, 0, 0, 'T',    6],
  ['s06',  '作業カフェ デスク心斎橋',         'shinsaibashi',   'cafe',    'work',     900,  1000,  9,    22, [],   3, 4, 3.7, 0, 1, 'TC',   4],
  ['s07',  '心斎橋 鮨 たちばな',              'shinsaibashi',   'meal',    'washoku',  2500, 8000,  12,   22, [3],  5, 3, 4.3, 0, 1, 'CP',   6],
  ['s08',  'Osteria Mare 心斎橋',             'shinsaibashi',   'meal',    'yoshoku',  1600, 5000,  11.5, 23, [],   5, 3, 4.2, 1, 0, 'TP',  20],
  ['s09',  '四川麻辣 紅天',                   'shinsaibashi',   'meal',    'chuka',    1000, 3000,  11,   23, [2],  3, 4, 3.9, 1, 1, 'T',   16],
  ['s10',  'カレー食堂 スパイス堂',           'shinsaibashi',   'meal',    'curry',    900,  1100,  11,   21, [],   2, 5, 3.8, 0, 1, 'TC',   6],
  ['s11',  'BURGER STAND 心斎橋',             'shinsaibashi',   'meal',    'fastfood', 1000, 1200,  10,   23, [],   3, 4, 3.7, 0, 1, 'TC',  12],
  // ---- 天王寺 ----
  ['t01',  '大衆酒場 てんのじ',               'tennoji',        'izakaya', 'taishu',   1500, 2200,  12,   23, [],   2, 5, 3.7, 1, 0, 'TC',  30],
  ['t02',  'Rooftop Dining SORA',             'tennoji',        'izakaya', 'bal',      null, 5500,  17,   24, [],   5, 2, 4.0, 1, 0, 'TCP', 40],
  ['t03',  'あべの 海鮮処 浜よし',            'tennoji',        'izakaya', 'kaisen',   1300, 3800,  11,   22, [],   4, 4, 3.8, 1, 1, 'TP',  24],
  ['t04',  'あべの 純喫茶 ローレル',          'tennoji',        'cafe',    'kissa',    800,  900,   8,    20, [4],  4, 4, 3.9, 0, 1, 'TC',  10],
  ['t05',  'ブーランジェリー ル・ブレ',       'tennoji',        'cafe',    'bakery',   600,  700,   7,    19, [1],  3, 5, 4.0, 0, 1, 'T',    4],
  ['t06',  '公園前カフェ green',              'tennoji',        'cafe',    'cafe',     1100, 1200,  9,    21, [],   4, 4, 3.7, 0, 1, 'T',   12],
  ['t07',  '天王寺 ホルモン 太陽',            'tennoji',        'meal',    'yakiniku', null, 3000,  17,   24, [3],  2, 5, 3.7, 1, 0, 'TC',  20],
  ['t08',  '洋食屋 グリル朝日',               'tennoji',        'meal',    'yoshoku',  1000, 1800,  11,   21, [4],  3, 5, 3.9, 0, 1, 'TC',  10],
  ['t09',  '飲茶酒家 天香',                   'tennoji',        'meal',    'chuka',    1200, 3800,  11,   22.5, [], 4, 3, 3.7, 1, 1, 'TP',  30],
  ['t10',  '天王寺 ラーメン 汐',              'tennoji',        'meal',    'ramen',    900,  950,   11,   24, [],   2, 4, 3.8, 0, 0, 'C',    6],
  ['t11',  'あべの 和食処 こよみ',            'tennoji',        'meal',    'washoku',  1100, 3500,  11,   22, [],   4, 4, 3.8, 1, 1, 'TP',  24],
  // ---- 京橋 ----
  ['k01',  '立ち呑み ちょい呑み 京橋',        'kyobashi',       'izakaya', 'taishu',   null, 1200,  14,   23, [0],  1, 5, 3.5, 0, 0, 'C',    6],
  ['k02',  '京橋 やきとり 鳥福',              'kyobashi',       'izakaya', 'yakitori', null, 2800,  16,   24, [],   3, 5, 3.8, 1, 1, 'TCP', 30],
  ['k03',  '京橋 魚市場酒場',                 'kyobashi',       'izakaya', 'kaisen',   null, 3200,  16,   24, [],   3, 4, 3.7, 1, 0, 'TP',  40],
  ['k04',  '自家焙煎 喫茶ポプラ',             'kyobashi',       'cafe',    'kissa',    750,  850,   8,    19, [0],  3, 4, 3.7, 0, 1, 'TC',   8],
  ['k05',  'COWORK CAFE 京橋',                'kyobashi',       'cafe',    'work',     1000, 1100,  8,    22, [],   3, 4, 3.8, 0, 1, 'TC',   6],
  ['k06',  'ベーカリーカフェ こむぎ畑',       'kyobashi',       'cafe',    'bakery',   800,  900,   7,    18, [],   3, 4, 3.8, 0, 1, 'T',    6],
  ['k07',  '京橋 もつ鍋 ぐつぐつ',            'kyobashi',       'meal',    'washoku',  null, 3200,  17,   24, [],   3, 4, 3.8, 1, 1, 'TP',  30],
  ['k08',  '餃子酒場 京橋飯店',               'kyobashi',       'meal',    'chuka',    800,  1800,  11,   24, [],   2, 5, 3.6, 1, 1, 'TC',  20],
  ['k09',  'Pizzeria Forno 京橋',             'kyobashi',       'meal',    'yoshoku',  1200, 2800,  11,   22, [1],  4, 4, 3.9, 1, 1, 'T',   16],
  ['k10',  'お好み焼き まる 京橋',            'kyobashi',       'meal',    'konamon',  900,  1700,  11,   23, [],   3, 4, 3.7, 1, 1, 'T',   20],
  ['k11',  'チキンバーガー Hop 京橋',         'kyobashi',       'meal',    'fastfood', 800,  900,   10,   22, [],   2, 4, 3.5, 0, 1, 'TC',  10],
  // ---- 京都駅 ----
  ['ks01', 'おばんざい酒場 いろは',           'kyoto-station',  'izakaya', 'taishu',   1300, 3800,  11.5, 22, [],   4, 4, 3.9, 1, 0, 'TCP', 20],
  ['ks02', '炉端と海鮮 えびす 京都駅前',      'kyoto-station',  'izakaya', 'kaisen',   null, 4200,  17,   23, [],   4, 3, 3.9, 1, 0, 'TP',  30],
  ['ks03', '八条口 BAR 灯',                   'kyoto-station',  'izakaya', 'bar',      null, 4000,  18,   25, [0],  4, 3, 4.0, 0, 0, 'C',    8],
  ['ks04', '京都駅 喫茶 ツバメ',              'kyoto-station',  'cafe',    'kissa',    800,  900,   7,    20, [],   3, 4, 3.7, 0, 1, 'TC',   8],
  ['ks05', 'STATION WORK CAFE 京都',          'kyoto-station',  'cafe',    'work',     1000, 1100,  7,    23, [],   3, 4, 3.8, 0, 1, 'TC',   4],
  ['ks06', 'パン工房 ルヴァン 京都駅',        'kyoto-station',  'cafe',    'bakery',   600,  700,   7,    20, [],   3, 5, 3.9, 0, 1, 'T',    6],
  ['ks07', '中華そば 麺屋 しらかわ',          'kyoto-station',  'meal',    'ramen',    950,  1000,  11,   24, [],   1, 5, 3.7, 0, 0, 'C',    4],
  ['ks08', '八条口 肉割烹 たかせ',            'kyoto-station',  'meal',    'washoku',  null, 7000,  17,   23, [2],  5, 3, 4.2, 0, 0, 'CP',  10],
  ['ks09', 'Cucina 京都ステーション',         'kyoto-station',  'meal',    'yoshoku',  1500, 4000,  11,   23, [],   4, 3, 3.7, 1, 1, 'TP',  35],
  ['ks10', '中華酒場 龍門 京都駅店',          'kyoto-station',  'meal',    'chuka',    900,  2600,  11,   23, [],   2, 4, 3.5, 1, 1, 'T',   40],
  ['ks11', '京都駅 焼肉 牛若',                'kyoto-station',  'meal',    'yakiniku', 1200, 4500,  11.5, 23, [],   3, 4, 3.8, 1, 0, 'TP',  30],
  // ---- 四条烏丸 ----
  ['sk01', 'ワインバル Vino 烏丸',            'shijo-karasuma', 'izakaya', 'bal',      null, 4000,  17,   24, [0],  4, 4, 3.9, 1, 0, 'TC',  12],
  ['sk02', '烏丸 焼鳥 つくし',                'shijo-karasuma', 'izakaya', 'yakitori', null, 3500,  17,   24, [],   3, 4, 4.0, 1, 0, 'TCP', 20],
  ['sk03', '烏丸 大衆酒場 まんぷく',          'shijo-karasuma', 'izakaya', 'taishu',   null, 2300,  16,   24, [],   2, 5, 3.6, 1, 0, 'TC',  30],
  ['sk04', '町家カフェ 和音',                 'shijo-karasuma', 'cafe',    'cafe',     1300, 1400,  10,   20, [3],  5, 3, 4.2, 0, 1, 'TP',   8],
  ['sk05', '烏丸 喫茶 カナリア',              'shijo-karasuma', 'cafe',    'kissa',    900,  1000,  8,    20, [],   4, 4, 3.9, 0, 1, 'TC',  10],
  ['sk06', '烏丸 シェアラウンジカフェ',       'shijo-karasuma', 'cafe',    'work',     1100, 1200,  9,    22, [],   3, 4, 3.8, 0, 1, 'TC',   6],
  ['sk07', '京中華 柳華',                     'shijo-karasuma', 'meal',    'chuka',    1200, 3500,  11.5, 21.5, [1], 4, 4, 4.1, 0, 1, 'TP',  12],
  ['sk08', '烏丸 定食 さわら',                'shijo-karasuma', 'meal',    'washoku',  900,  1300,  11,   21, [0],  2, 5, 3.8, 0, 1, 'TC',   8],
  ['sk09', '京の焼肉 錦',                     'shijo-karasuma', 'meal',    'yakiniku', 1500, 5500,  11.5, 23, [],   4, 3, 4.0, 1, 0, 'TP',  24],
  ['sk10', 'スープカレー ゆらり 烏丸',        'shijo-karasuma', 'meal',    'curry',    1100, 1300,  11,   22, [],   3, 4, 3.8, 0, 1, 'T',    8],
  ['sk11', 'お好み焼き 京ぼて',               'shijo-karasuma', 'meal',    'konamon',  900,  1800,  11,   22, [2],  3, 4, 3.7, 1, 1, 'T',   16],
  // ---- 河原町 ----
  ['kw01', '大衆居酒屋 ろっかく',             'kawaramachi',    'izakaya', 'taishu',   null, 2500,  16,   24, [],   2, 5, 3.6, 1, 0, 'TCP', 40],
  ['kw02', '木屋町バル 川床テラス',           'kawaramachi',    'izakaya', 'bal',      1600, 4800,  11.5, 23, [2],  5, 3, 4.1, 1, 0, 'TC',  14],
  ['kw03', '先斗町 BAR 千鳥',                 'kawaramachi',    'izakaya', 'bar',      null, 5000,  19,   26, [],   5, 3, 4.3, 0, 0, 'C',    8],
  ['kw04', '抹茶パフェ 茶々 河原町',          'kawaramachi',    'cafe',    'parfait',  1500, 1600,  11,   21, [],   4, 3, 4.1, 0, 0, 'T',    6],
  ['kw05', '河原町 純喫茶 ひかり',            'kawaramachi',    'cafe',    'kissa',    800,  900,   9,    22, [],   4, 4, 3.9, 0, 1, 'TC',  10],
  ['kw06', '鴨川カフェ ナガレ',               'kawaramachi',    'cafe',    'cafe',     1200, 1300,  11,   23, [],   5, 3, 4.0, 0, 1, 'TC',  10],
  ['kw07', '中華そば 鶴麺',                   'kawaramachi',    'meal',    'ramen',    900,  950,   11,   23, [],   1, 5, 3.9, 0, 0, 'C',    4],
  ['kw08', '先斗町 京懐石 ほたる',            'kawaramachi',    'meal',    'washoku',  4000, 12000, 12,   22, [3],  5, 2, 4.5, 0, 0, 'CP',  12],
  ['kw09', 'ハンバーグ専門店 グリルK',        'kawaramachi',    'meal',    'yoshoku',  1200, 1800,  11,   22, [],   3, 4, 3.8, 0, 1, 'T',   12],
  ['kw10', 'バーガーキッチン 鴨 河原町',      'kawaramachi',    'meal',    'fastfood', 1000, 1200,  10,   22, [],   3, 4, 3.6, 0, 1, 'TC',  14],
  ['kw11', 'カレー 林檎堂',                   'kawaramachi',    'meal',    'curry',    1000, 1200,  11,   21, [3],  3, 4, 3.9, 0, 1, 'TC',   8],
  // ---- 祇園 ----
  ['g01',  '祇園 割烹居酒屋 花灯',            'gion',           'izakaya', 'kaisen',   null, 4500,  17,   24, [0],  4, 3, 4.0, 1, 0, 'CP',  10],
  ['g02',  '祇園 焼鳥 たまゆら',              'gion',           'izakaya', 'yakitori', null, 4000,  17,   23, [1],  4, 3, 4.1, 0, 0, 'CP',   8],
  ['g03',  '祇園 BAR 白川',                   'gion',           'izakaya', 'bar',      null, 6000,  19,   26, [],   5, 2, 4.4, 0, 0, 'CP',   8],
  ['g04',  '甘味と軽食 ひなた',               'gion',           'cafe',    'parfait',  1100, 1200,  10,   18, [],   4, 4, 3.8, 0, 1, 'T',    6],
  ['g05',  '祇園 喫茶 古都',                  'gion',           'cafe',    'kissa',    900,  1000,  9,    19, [3],  5, 3, 4.0, 0, 1, 'TC',   8],
  ['g06',  'ベーカリー&カフェ 朝凪',          'gion',           'cafe',    'bakery',   700,  800,   8,    18, [],   4, 4, 3.9, 0, 1, 'T',    8],
  ['g07',  'Le Jardin 祇園',                  'gion',           'meal',    'yoshoku',  3500, 9000,  12,   22, [1],  5, 3, 4.4, 0, 0, 'TP',  10],
  ['g08',  '祇園 四川 辛来',                  'gion',           'meal',    'chuka',    1300, 4000,  11.5, 22, [],   4, 3, 3.9, 1, 1, 'TP',  20],
  ['g09',  '東山 京ちゃんこ 力',              'gion',           'meal',    'washoku',  null, 4200,  17,   23, [],   3, 4, 3.8, 1, 0, 'TP',  30],
  ['g10',  '祇園 焼肉 円山',                  'gion',           'meal',    'yakiniku', null, 6000,  17,   24, [],   4, 3, 4.1, 1, 0, 'TP',  20],
  ['g11',  '祇園 ラーメン 白湯屋',            'gion',           'meal',    'ramen',    1000, 1000,  11,   24, [],   2, 4, 3.7, 0, 0, 'TC',   8],
];

const SEAT_CODES = { T: 'table', C: 'counter', P: 'private' };

/** id から決まる疑似乱数（0〜1）．毎回同じ座標になるように使う */
function hashToUnit(str, salt) {
  let h = 2166136261 ^ salt;
  for (const ch of str) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 表の1行 → 内部フォーマットの店舗オブジェクト */
function toRestaurant(row) {
  const [id, name, areaId, category, sub, lunch, dinner, open, close, closedDays,
    atmosphere, costPerformance, rating, nomihodai, takeout, seats, maxGroup] = row;
  const area = AREAS.find((a) => a.id === areaId);
  if (SUB_TO_CATEGORY[sub] !== category) throw new Error(`カテゴリ定義の不整合: ${id}`);
  // 店の座標は「エリア中心 ± 約250m」に散らす（モック用）
  return {
    id,
    name,
    areaId,
    areaName: area.name,
    city: area.city,
    lat: area.lat + (hashToUnit(id, 1) - 0.5) * 0.005,
    lng: area.lng + (hashToUnit(id, 2) - 0.5) * 0.005,
    category,
    sub,
    price: { lunch, dinner },
    hours: { open, close },
    closedDays,
    atmosphere,
    costPerformance,
    rating,
    nomihodai: Boolean(nomihodai),
    takeout: Boolean(takeout),
    seats: seats.split('').map((c) => SEAT_CODES[c]),
    maxGroup,
  };
}

const RESTAURANTS = ROWS.map(toRestaurant);

/** 店舗リストを取得（外部API連携時はここを差し替える） */
function fetchRestaurants(/* room */) {
  return RESTAURANTS;
}

module.exports = { AREAS, RESTAURANTS, fetchRestaurants };
