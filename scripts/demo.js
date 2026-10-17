/**
 * サーバーを立てずにランキングロジックだけを試すデモ（npm run demo）．
 * 条件や回答を書き換えて，スコアがどう変わるか確認できる．
 */
const { generateRanking } = require('../src/ranking');

// ホストが決める条件
const room = {
  location: 'umeda', // 梅田
  people: 4,
  datetime: '2026-10-23T19:00', // 金曜 19時
  budget: '3000-5000',
  category: 'izakaya', // 居酒屋
  nomihodai: 'required', // 飲み放題必須
  seat: 'private', // 個室希望
  takeout: 'no',
};

// 参加者の回答（小カテゴリごとに ◎=great / 〇=ok / ×=ng。書かなかったものは 〇）
const answers = [
  { name: 'Aさん', ratings: { yakitori: 'great', kaisen: 'great', bar: 'ng' } },
  { name: 'Bさん', ratings: { yakitori: 'great', taishu: 'ng' } },
  { name: 'Cさん', ratings: { kaisen: 'great' } },
  { name: 'Dさん', ratings: { bal: 'great', yakitori: 'ng' } },
];

const result = generateRanking(room, answers);
console.log('■ 条件:', result.conditions);
console.log('■ 小カテゴリの合計ポイント:', result.summary.subPoints);
console.log('■ 候補:', result.candidateCount, '件 / 除外:', result.excluded, '\n');
for (const r of result.ranking) {
  console.log(`${r.rank}位 ${r.score.toFixed(1)}点  ${r.name}（${r.areaName}・${r.subLabel}・¥${r.price}）`);
  for (const b of r.breakdown) {
    console.log(`      ${b.label.padEnd(6, '　')} 重み${String(b.weightShare).padStart(5)}% × ${b.score.toFixed(2)} = ${b.points.toFixed(1)}点  ${b.note}`);
  }
  if (r.penalties.length) console.log('      ペナルティ:', r.penalties.join(' / '));
  console.log('');
}
