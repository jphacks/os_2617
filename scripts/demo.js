/**
 * サーバーを立てずにランキングロジックだけを試すデモ（npm run demo）．
 * 条件や回答を書き換えて，スコアがどう変わるか確認できる．
 * HOTPEPPER_API_KEY を設定して実行すると実データ，なければサンプル店舗で計算する．
 */
const { generateRanking } = require('../src/ranking');
const { createShopClient } = require('../src/hotpepper');
const { createShopSource } = require('../src/shopSource');
const { normalizeShop } = require('../src/shopData');
const { scopeOf, extraQueries } = require('../src/genreMap');
const { buildRoomSubs } = require('../src/options');

// ホストが決める条件
const room = {
  location: process.argv[2] || '梅田', // 場所（自由記述）．例：node scripts/demo.js 渋谷
  people: 4,
  datetime: '2026-10-23T19:00', // 金曜 19時
  budget: { min: 3000, max: 5000 }, // 予算 3,000〜5,000円（null は指定なし）
  category: 'izakaya', // 居酒屋
  // 小カテゴリ：バーを削除して「もつ鍋」を追加
  subs: buildRoomSubs('izakaya', [
    ...['taishu', 'yakitori', 'kushiage', 'yakiniku', 'kaisen', 'wine', 'korean'].map((value) => ({ value })),
    { label: 'もつ鍋', custom: true },
  ]).subs,
  nomihodai: 'required', // 飲み放題必須
  seat: 'private', // 個室希望
  smoking: 'nonsmoking', // 禁煙（喫煙可の店は除外）
  takeout: 'no',
};

// 参加者の回答（小カテゴリごとに ◎=great / 〇=ok / ×=ng。書かなかったものは 〇．c1 = 追加した「もつ鍋」）
const answers = [
  { name: 'Aさん', ratings: { yakitori: 'great', kaisen: 'great', c1: 'great' } },
  { name: 'Bさん', ratings: { yakitori: 'great', taishu: 'ng' } },
  { name: 'Cさん', ratings: { kaisen: 'great' } },
  { name: 'Dさん', ratings: { wine: 'great', yakitori: 'ng' } },
];

(async () => {
  const client = createShopClient();
  const source = createShopSource(client.search, { normalizeShop, scopeOf, extraQueries });
  const place = await source.geocode(room.location);
  if (!place) throw new Error(`「${room.location}」が見つかりませんでした`);
  const { shops, rangeKm } = await source.fetchShops({ ...room, center: place });
  const result = generateRanking({ ...room, locationName: room.location, center: place }, answers, shops);

  console.log(`■ お店のデータ: ${client.kind} / 場所: ${room.location} → (${place.lat}, ${place.lng}) ${place.areaLabel} / 半径 ${rangeKm}km で ${shops.length}件`);
  console.log('■ 条件:', result.conditions);
  console.log('■ 小カテゴリの合計ポイント:', result.summary.subPoints);
  console.log('■ 候補:', result.candidateCount, '件 / 除外:', result.excluded, '\n');
  for (const r of result.ranking) {
    console.log(`${r.rank}位 ${r.score.toFixed(1)}点  ${r.name}（${r.areaName}・${r.subLabel}・${r.price ? '¥' + r.price : '予算不明'}）`);
    for (const b of r.breakdown) {
      const share = b.weightShare === null ? '  加点' : `重み${String(b.weightShare).padStart(5)}%`;
      console.log(`      ${b.label.padEnd(6, '　')} ${share} × ${b.score.toFixed(2)} = ${b.points.toFixed(1)}点  ${b.note}`);
    }
    if (r.penalties.length) console.log('      ペナルティ:', r.penalties.join(' / '));
    console.log('      地図:', r.mapUrl, '\n');
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
