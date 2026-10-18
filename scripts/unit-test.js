/**
 * ホットペッパー連携まわりの単体テスト（npm test で smoke-test.js と一緒に実行）
 *   - 営業時間・定休日・予算・禁煙の読み取り
 *   - ジャンル対応表（サンプル125店がすべて元の小カテゴリに判定されるか．削除・追加の扱い）
 *   - APIクライアント（キャッシュ・エラー処理．通信は偽の fetch で代用）
 *   - 場所の推定（外れ値に強いか）
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const d = require('../src/shopData');
const g = require('../src/genreMap');
const o = require('../src/options');
const { SAMPLE_SHOPS, mockSearch } = require('../src/mockRestaurants');
const { createHotpepperClient, ShopApiError } = require('../src/hotpepper');
const { createShopSource } = require('../src/shopSource');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
test('営業時間の読み取り', () => {
  const h = d.parseOpenHours('月～金、祝前日: 17:00～翌0:00 （料理L.O. 23:00 ドリンクL.O. 23:30）土、日、祝日: 16:00～翌2:00');
  assert.deepEqual(h[1], [[17, 24]]);
  assert.deepEqual(h[6], [[16, 26]]);
  assert.deepEqual(d.parseOpenHours('11:30～14:00 17:00～23:00')[3], [[11.5, 14], [17, 23]]);
  assert.deepEqual(d.parseOpenHours('月～金／１１：３０～１４：００')[2], [[11.5, 14]]);
  assert.deepEqual(d.parseOpenHours('月曜日～土曜日 18:00-翌朝5:00')[6], [[18, 29]]);
  assert.deepEqual(d.parseOpenHours('土日祝: 11:00～23:00 月～金: 17:00～23:00')[1], [[17, 23]]); // "23:00 月" を日付と読まない
  assert.equal(d.parseOpenHours('詳しくはお問い合わせください'), null);
  // 一部しか読めない書き方は「不明」にして除外しない
  for (const t of ['17:00～23:00（金・土は翌2:00まで）', 'ランチ 11:30～14:00 ディナー 17時～23時', '11:30～14:00 17:00～LAST']) assert.equal(d.parseOpenHours(t), null, t);
  assert.equal(d.parseOpenHours(''), null);
});

test('営業中かの判定（深夜営業・不明）', () => {
  const h = d.parseOpenHours('月～金: 17:00～翌2:00 土: 17:00～23:00');
  assert.equal(d.isOpenAt(h, 1, 19, 1), true);
  assert.equal(d.isOpenAt(h, 1, 16, 1), false); //   開店前
  assert.equal(d.isOpenAt(h, 6, 22.5, 1), false); // 閉店まで1時間ない
  assert.equal(d.isOpenAt(h, 6, 1, 1), true); //     金曜の深夜営業
  assert.equal(d.isOpenAt(h, 0, 19, 1), null); //    日曜は書かれていない → 不明
  assert.equal(d.isOpenAt(null, 0, 19, 1), null);
});

test('定休日の読み取り', () => {
  assert.deepEqual(d.parseClosedDays('日'), [0]);
  assert.deepEqual(d.parseClosedDays('日曜日（祝日の場合は翌日）'), [0]);
  assert.deepEqual(d.parseClosedDays('月・火'), [1, 2]);
  assert.deepEqual(d.parseClosedDays('土日祝'), [6, 0]);
  assert.deepEqual(d.parseClosedDays('第2・4火曜日、水曜日'), [3]);
  assert.deepEqual(d.parseClosedDays('日曜・祝日 ※1月1日～3日休み'), [0]); // 日付の範囲を曜日の範囲と読まない
  assert.deepEqual(d.parseClosedDays('日曜日、土曜ランチ'), [0]); //          土曜は昼だけ休み
  assert.deepEqual(d.parseClosedDays('休業日：水曜'), [3]);
  assert.deepEqual(d.parseClosedDays('月曜～水曜'), [1, 2, 3]);
  for (const s of ['無休', '年中無休', '不定休', '年末年始', '', '不定休日あり', '臨時休業日あり', '元日のみ休み', '1月1日', '毎月第2火曜日', '月1回不定休', '月末', '土日祝のランチ']) {
    assert.deepEqual(d.parseClosedDays(s), [], s);
  }
});

test('予算の読み取り', () => {
  assert.deepEqual(d.parseBudget('ディナー：3000円 ランチ：1000円'), { dinner: 3000, lunch: 1000, estimated: false });
  assert.equal(d.parseBudget('通常平均:3500円 宴会平均:4000円 ランチ平均:1000円').dinner, 3500);
  assert.equal(d.parseBudget('宴会3500円').dinner, 3500);
  assert.equal(d.parseBudget('3,000～4,000円').dinner, 3500);
  assert.deepEqual(d.parseBudget('', 'B003'), { dinner: 3500, lunch: null, estimated: true });
  assert.equal(d.parseBudget('', '', '2001～3000円').dinner, 2501);
  assert.equal(d.parseBudget('', '').dinner, null);
  assert.deepEqual(d.parseBudget('1000円（ランチ）　3000円（ディナー）'), { dinner: 3000, lunch: 1000, estimated: false });
  assert.deepEqual(d.parseBudget('【ランチ】1,000円【ディナー】3,500円'), { dinner: 3500, lunch: 1000, estimated: false });
  assert.equal(d.parseBudget('お通し300円 ディナー3000円').dinner, 3000);
});

test('禁煙・あり/なし・テイクアウトの読み取り', () => {
  assert.equal(d.parseSmoking('全面禁煙'), 'none');
  assert.equal(d.parseSmoking('一部禁煙'), 'separated');
  assert.equal(d.parseSmoking('禁煙席なし'), 'allowed');
  assert.equal(d.parseSmoking('未確認'), 'unknown');
  assert.equal(d.flag('あり ：最大20名様'), true);
  assert.equal(d.flag('なし'), false);
  assert.equal(d.flag('未確認'), null);
  const shop = (memo) => d.normalizeShop({ id: 'J1', name: 'x', lat: 35, lng: 135, other_memo: memo });
  assert.equal(shop('テイクアウトOK').takeout, true);
  assert.equal(shop('お持ち帰りできます').takeout, true);
  assert.equal(shop('テイクアウト不可').takeout, false);
  assert.equal(shop('テイクアウトは行っておりません').takeout, false);
  assert.equal(shop('').takeout, false);
  // リンク・画像は http(s) のみ
  const linked = d.normalizeShop({ id: 'J2', name: 'x', lat: 35, lng: 135, urls: { pc: 'javascript:alert(1)' }, photo: { pc: { m: 'https://imgfp.hotp.jp/x.jpg' } } });
  assert.equal(linked.url, '');
  assert.equal(linked.photo, 'https://imgfp.hotp.jp/x.jpg');
});

// ---------------------------------------------------------------------------
test('ジャンル対応表：サンプル125店がすべて元の小カテゴリに判定される', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/mockRestaurants.js'), 'utf8');
  for (const hp of SAMPLE_SHOPS) {
    const [, cat, sub] = new RegExp(`\\['${hp.id}',\\s*'[^']*',\\s*'[^']*',\\s*'([^']*)',\\s*'([^']*)'`).exec(src);
    const r = g.matchSubs(d.normalizeShop(hp), cat, o.defaultSubs(cat));
    // ランチ・作業向けは特徴なので「カフェ」に足される
    assert.deepEqual(r.all, g.RULES[cat][sub].attribute ? ['cafe', sub] : [sub], `${hp.id} ${hp.name}`);
  }
});

test('ジャンル対応表：キーワード優先・ジャンルコード・対象外', () => {
  const shop = (genre, name, catchText = '') => d.normalizeShop({ id: name, name, lat: 35, lng: 135, genre: { code: genre, catch: catchText }, catch: '' });
  const subs = o.defaultSubs('izakaya');
  assert.deepEqual(g.matchSubs(shop('G001', '炭火 とりまる', '朝引き地鶏の焼鳥'), 'izakaya', subs).all, ['yakitori']);
  assert.deepEqual(g.matchSubs(shop('G001', '居酒屋 まる'), 'izakaya', subs).all, ['taishu']); // キーワードなし → ジャンルで判定
  assert.deepEqual(g.matchSubs(shop('G001', '焼き鳥と海鮮 まる'), 'izakaya', subs).all, ['yakitori', 'kaisen']);
  assert.deepEqual(g.matchSubs(shop('G013', 'らーめん まる'), 'izakaya', subs).all, []); // 居酒屋の対象ジャンル外
  assert.deepEqual(g.matchSubs(shop('G014', '韓国カフェ まる'), 'meal', o.defaultSubs('meal')).all, []); // カフェは「ご飯」の対象外
  assert.deepEqual(g.matchSubs(shop('G016', '焼きそば まる'), 'meal', o.defaultSubs('meal')).all, ['konamon']); // 焼きそば ≠ そば
  assert.deepEqual(g.matchSubs(shop('G014', 'パンケーキ まる'), 'cafe', o.defaultSubs('cafe')).all, ['cafe']); // パンケーキ ≠ パン
  assert.deepEqual(g.matchSubs(shop('G014', 'ジャパンカフェ'), 'cafe', o.defaultSubs('cafe')).all, ['cafe']);
  assert.deepEqual(g.matchSubs(shop('G013', '中華蕎麦 とみ田'), 'meal', o.defaultSubs('meal')).all, ['ramen']); // そばにしない
  assert.deepEqual(g.matchSubs(shop('G004', '和食処 まる', '駅のすぐそば'), 'meal', o.defaultSubs('meal')).all, ['washoku']);
  // 宣伝文（お店キャッチ）の「カクテル」でバーにしない
  const ad = d.normalizeShop({ id: 'a', name: '個室居酒屋 和楽', lat: 35, lng: 135, genre: { code: 'G001' }, catch: '生ビール・カクテル・サワーも' });
  assert.deepEqual(g.matchSubs(ad, 'izakaya', subs).all, ['taishu']);
  // ランチ・作業向けは特徴として足す（ランチを削除してもカフェとして残る）
  const cafe = shop('G014', 'カフェ まる', 'ランチもおすすめ・Wi-Fi完備');
  assert.deepEqual(g.matchSubs(cafe, 'cafe', o.defaultSubs('cafe')).all, ['cafe', 'lunch', 'work']);
});

test('ジャンル対応表：削除した小カテゴリ・追加した小カテゴリ', () => {
  const shop = (genre, name) => d.normalizeShop({ id: name, name, lat: 35, lng: 135, genre: { code: genre } });
  const { subs } = o.buildRoomSubs('izakaya', [{ value: 'taishu' }, { value: 'kaisen' }, { label: 'もつ鍋', custom: true }]);
  // 焼き鳥を削除 → 焼き鳥の店は有効な小カテゴリなし（＝候補外）．大衆居酒屋にはならない
  assert.deepEqual(g.matchSubs(shop('G001', '焼鳥 まる'), 'izakaya', subs), { all: ['yakitori'], active: [] });
  // 追加した「もつ鍋」は表記ゆれ（モツ鍋）も一致．対象ジャンル外（和食）でも一致する
  assert.deepEqual(g.matchSubs(shop('G004', '博多モツ鍋 まる'), 'izakaya', subs).active, ['c1']);
  assert.deepEqual(g.extraQueries('izakaya', subs), [{ keyword: '海鮮', inScope: true }, { keyword: 'もつ鍋', inScope: false }]);
});

// ---------------------------------------------------------------------------
/** 偽の fetch：URL の検索条件でサンプル検索を呼び，ホットペッパーと同じ JSON を返す */
function fakeFetch(calls, { fail } = {}) {
  return async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (fail === 'http') return { ok: false, status: 500, json: async () => ({}) };
    if (fail === 'api') return { ok: true, status: 200, json: async () => ({ results: { error: [{ code: 2000, message: 'APIキーまたはIPアドレスの認証エラーです' }] } }) };
    const params = Object.fromEntries(u.searchParams);
    if (u.pathname.includes('/genre/')) return { ok: true, status: 200, json: async () => ({ results: { genre: Object.entries(g.HP_GENRES).map(([code, name]) => ({ code, name })) } }) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(mockSearch(params))) };
  };
}

test('APIクライアント：パラメータ・キャッシュ・エラー', async () => {
  const calls = [];
  const hp = createHotpepperClient({ apiKey: 'SECRET', fetchImpl: fakeFetch(calls) });
  const r1 = await hp.search({ keyword: '梅田', count: 100 });
  const r2 = await hp.search({ count: 100, keyword: '梅田' }); // 同じ条件 → キャッシュ
  assert.equal(calls.length, 1);
  assert.equal(r1, r2);
  assert.equal(calls[0].origin + calls[0].pathname, 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/');
  assert.equal(calls[0].searchParams.get('key'), 'SECRET');
  assert.equal(calls[0].searchParams.get('format'), 'json');
  assert.equal((await hp.verifyGenres()).ok, true);
  assert.equal(r1.results.shop[0].sample, undefined, 'キャッシュには使う項目だけ残す');
  assert.ok(r1.results.shop[0].genre && r1.results.shop[0].lat);

  for (const fail of ['http', 'api']) {
    const bad = createHotpepperClient({ apiKey: 'SECRET', fetchImpl: fakeFetch([], { fail }) });
    await assert.rejects(bad.search({ keyword: 'x' }), (e) => e instanceof ShopApiError && !e.message.includes('SECRET'));
  }
});

test('場所の推定：中央値で外れ値に強い', async () => {
  const shops = [...Array(9)].map((_, i) => ({ id: `a${i}`, lat: 34.70 + i * 0.0005, lng: 135.50, middle_area: { name: '梅田' } }));
  shops.push({ id: 'far', lat: 43.06, lng: 141.35, middle_area: { name: '札幌' } }); // 同じ名前の別の街のお店
  const source = createShopSource(async () => ({ results: { results_available: 10, shop: shops } }), { normalizeShop: d.normalizeShop, scopeOf: g.scopeOf, extraQueries: g.extraQueries });
  const p = await source.geocode('梅田');
  assert.ok(Math.abs(p.lat - 34.702) < 0.001 && Math.abs(p.lng - 135.5) < 0.001, JSON.stringify(p));
  assert.equal(p.areaLabel, '梅田');
  const none = createShopSource(async () => ({ results: { results_available: 0, shop: [] } }), { normalizeShop: d.normalizeShop, scopeOf: g.scopeOf, extraQueries: g.extraQueries });
  assert.equal(await none.geocode('どこでもない'), null);
  // 「〇〇駅」で見つからなければ「駅」を外して探し直す
  const sample = createShopSource(async (params) => mockSearch(params), { normalizeShop: d.normalizeShop, scopeOf: g.scopeOf, extraQueries: g.extraQueries });
  assert.equal(mockSearch({ keyword: 'なんば駅' }).results.results_available, 0);
  assert.ok(await sample.geocode('なんば駅'));
});

test('候補の取得：範囲を広げる・追加キーワード・重複除去', async () => {
  const calls = [];
  const search = async (params) => { calls.push(params); return mockSearch(params); };
  const source = createShopSource(search, { normalizeShop: d.normalizeShop, scopeOf: g.scopeOf, extraQueries: g.extraQueries });
  const room = { center: { lat: 34.7025, lng: 135.4959 }, category: 'izakaya', subs: o.buildRoomSubs('izakaya', [{ value: 'yakitori' }, { label: 'もつ鍋', custom: true }]).subs };
  const { shops, rangeKm } = await source.fetchShops(room);
  assert.deepEqual(calls.slice(0, 3).map((c) => c.range), [3, 4, 5]); // サンプルは件数が少ないので3kmまで広げる
  assert.equal(rangeKm, 3);
  assert.ok(calls.some((c) => c.keyword === '焼き鳥' && c.genre) && calls.some((c) => c.keyword === 'もつ鍋' && !c.genre));
  assert.equal(new Set(shops.map((s) => s.id)).size, shops.length);
  assert.ok(shops.length > 0);
});

// ---------------------------------------------------------------------------
(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('  ok  ', name);
    } catch (e) {
      failed += 1;
      console.log('  FAIL', name, '\n', e);
    }
  }
  if (failed) {
    console.error(`${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`OK: ${tests.length} unit tests passed`);
})();
