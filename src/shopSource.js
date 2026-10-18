/**
 * お店の取得：場所の推定（地名 → 座標）と，ランキング候補の取得
 * ===========================================================================
 *
 * search(params) はホットペッパーのグルメサーチAPIを呼ぶ関数（または同じ形で答えるサンプル検索）．
 * サーバーでもブラウザ（確認用ページ）でも同じ処理を使えるよう，通信部分は外から渡す．
 *
 * ■ 場所の推定 geocode("梅田")
 *   ホットペッパーの「キーワード」検索で，その地名を含むお店（店名・住所・駅名・キャッチ）を最大100件取り，
 *   その座標の中央値を中心にする．別の地域の同名店などの外れ値は，中央値から3km以上離れた店を除いて
 *   平均を取り直すことで影響を小さくする．
 *
 * ■ 候補の取得 fetchShops(room)
 *   1. 中心から半径1km → 足りなければ 2km → 3km と広げて，大カテゴリの対象ジャンルのお店を取る（最大200件）
 *   2. 小カテゴリごとの追加キーワード（焼き鳥・パフェ・ホストが追加した「もつ鍋」など）でも取り，取りこぼしを防ぐ
 *   3. 重複を除いて内部形式に変換
 */

const GEOCODE_INLIER_KM = 3; //   中心から これより離れた店は外れ値として扱う
const RANGES = [3, 4, 5]; //       ホットペッパーの range：3=1km, 4=2km, 5=3km
const RANGE_KM = { 1: 0.3, 2: 0.5, 3: 1, 4: 2, 5: 3 };
const ENOUGH_SHOPS = 30; //        この件数以上あれば検索範囲を広げない
const MAX_PAGES = 2; //            対象ジャンルの検索は 100件 × 2ページまで
const PARALLEL = 3; //             同時に投げる検索の数

function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
const median = (xs) => {
  const v = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const shopsOf = (data) => ((data && data.results && data.results.shop) || []);
const availableOf = (data) => Number((data && data.results && data.results.results_available) || 0);

/** 配列を n 件ずつ並列に処理 */
async function mapLimit(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

function createShopSource(search, { normalizeShop, scopeOf, extraQueries }) {
  /** "梅田" → { lat, lng, matched, areaLabel } / 見つからなければ null */
  async function geocode(text) {
    let data = await search({ keyword: text, count: 100 });
    // 駅名はホットペッパーでは「渋谷」のように「駅」なしで登録されているので，見つからなければ外して探し直す
    if (!shopsOf(data).length && /.駅$/.test(text)) data = await search({ keyword: text.replace(/駅$/, ''), count: 100 });
    const pts = shopsOf(data)
      .map((s) => ({ lat: Number(s.lat), lng: Number(s.lng), area: s.middle_area && s.middle_area.name }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0);
    if (!pts.length) return null;
    let center = { lat: median(pts.map((p) => p.lat)), lng: median(pts.map((p) => p.lng)) };
    const inliers = pts.filter((p) => kmBetween(center, p) <= GEOCODE_INLIER_KM);
    if (inliers.length) {
      center = { lat: inliers.reduce((s, p) => s + p.lat, 0) / inliers.length, lng: inliers.reduce((s, p) => s + p.lng, 0) / inliers.length };
    }
    // いちばん多いエリア名（例：「梅田・西梅田」）を目安として返す
    const counts = {};
    inliers.forEach((p) => { if (p.area) counts[p.area] = (counts[p.area] || 0) + 1; });
    const areaLabel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      lat: Math.round(center.lat * 1e6) / 1e6,
      lng: Math.round(center.lng * 1e6) / 1e6,
      matched: availableOf(data) || pts.length,
      areaLabel: areaLabel ? areaLabel[0] : '',
    };
  }

  /** ルームの条件で候補のお店を取る → { shops: 内部形式[], rangeKm } */
  async function fetchShops(room) {
    const base = { lat: room.center.lat, lng: room.center.lng, count: 100 };
    const genre = scopeOf(room.category).join(',');

    // 1. 対象ジャンル：件数が足りるまで範囲を広げる
    let range = RANGES[0];
    let first = null;
    for (range of RANGES) {
      first = await search({ ...base, range, genre });
      if (availableOf(first) >= ENOUGH_SHOPS) break;
    }
    const pages = [first];
    for (let p = 1; p < MAX_PAGES && availableOf(first) > p * 100; p += 1) {
      pages.push(await search({ ...base, range, genre, start: p * 100 + 1 }));
    }

    // 2. 小カテゴリごとの追加キーワード（同じ範囲で）．補助なので失敗しても結果は出す
    const extras = await mapLimit(extraQueries(room.category, room.subs), PARALLEL, (q) =>
      search({ ...base, range, keyword: q.keyword, ...(q.inScope ? { genre } : {}) }).catch(() => null));

    // 3. 重複を除いて内部形式へ
    const seen = new Map();
    for (const data of [...pages, ...extras]) {
      for (const hp of shopsOf(data)) if (hp && hp.id && !seen.has(hp.id)) seen.set(hp.id, normalizeShop(hp));
    }
    const shops = [...seen.values()].filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat !== 0);
    return { shops, rangeKm: RANGE_KM[range] };
  }

  return { geocode, fetchShops };
}

module.exports = { createShopSource, kmBetween, RANGE_KM };
