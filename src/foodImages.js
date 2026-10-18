/**
 * 小カテゴリの名前 → 食べ物の画像（public/food/ に置いたファイル名）
 *
 * アンケートのカードに大きく表示する．名前で対応づけるので，
 *   - 同じ名前の小カテゴリ（「焼肉」はご飯と居酒屋の両方など）は同じ画像
 *   - ホストが追加した小カテゴリも，名前が一致すれば画像が出る（例：「アヒージョ」「パエリア」）
 *   - 大カテゴリによって画像を変えたいものは「大カテゴリ/名前」で書く（例：居酒屋とカフェの「韓国系」）
 * 画像のない小カテゴリ（カフェの「カフェ」など）は，名前を大きく書いた文字だけのカードになる．
 */
const FOOD_IMAGES = {
  // ご飯
  和食: 'washoku.webp',
  洋食: 'yoshoku.webp',
  中華: 'chuka.webp',
  中華料理: 'chuka.webp',
  焼肉: 'yakiniku.webp',
  ラーメン: 'ramen.webp',
  うどんそば: 'udon-soba.webp',
  ファストフード: 'fastfood.webp',
  粉もの: 'konamon.webp',
  カレー: 'curry.webp',
  韓国料理: 'korean.webp',
  エスニック: 'ethnic.webp',
  // 居酒屋
  大衆居酒屋: 'taishu.webp',
  焼き鳥: 'yakitori.webp',
  串揚げ: 'kushiage.webp',
  海鮮: 'kaisen.webp',
  ワインダイニング: 'wine.webp',
  'izakaya/韓国系': 'izakaya-korean.webp',
  バー: 'bar.webp',
  // カフェ
  喫茶店: 'kissa.webp',
  パフェ: 'parfait.webp',
  ベーカリー: 'bakery.webp',
  'cafe/韓国系': 'cafe-korean.webp',
  ランチ: 'lunch.webp',
  作業向け: 'work.webp',
  // ホストが追加したときに使える画像（スペインバル系など）
  韓国系: 'izakaya-korean.webp',
  アヒージョ: 'ajillo.webp',
  生ハム: 'jamon.webp',
  パエリア: 'paella.webp',
  タパス: 'tapas.webp',
  タパス盛り合わせ: 'tapas.webp',
  ピンチョス: 'pinchos.webp',
  お酒: 'sake-bar.webp',
  バル: 'sake-bar.webp',
  お酒とバル: 'sake-bar.webp',
};

/** 小カテゴリの画像のファイル名（大カテゴリ別の指定を優先） */
const foodImageFile = (category, label) => FOOD_IMAGES[`${category}/${label}`] || FOOD_IMAGES[label] || null;

module.exports = { FOOD_IMAGES, foodImageFile };
