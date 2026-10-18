/**
 * API の一連の流れを確認するテスト（npm test）．
 * DATABASE_URL があれば PostgreSQL，なければメモリで実行する．
 * お店はサンプル店舗．最後にホットペッパーのクライアント経由（通信は偽の fetch）でも一通り確認する．
 */
const assert = require('assert/strict');
const { createApp } = require('../server');
const { createStore } = require('../src/store');
const { createSampleClient, createHotpepperClient } = require('../src/hotpepper');
const { mockSearch } = require('../src/mockRestaurants');

(async () => {
  const store = createStore();
  await store.init();
  const server = createApp(store, createSampleClient()).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, url = base) => {
    const res = await fetch(url + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    console.log('store:', store.kind);
    assert.equal((await call('GET', '/healthz')).body.shops, 'sample');

    // 入力エラー
    assert.equal((await call('POST', '/api/rooms', { location: 'x' })).status, 400);
    // 見つからない地名
    const nowhere = await call('POST', '/api/rooms', { location: 'どこにもない町', people: 2, datetime: '2026-10-23T19:00', category: 'izakaya' });
    assert.equal(nowhere.status, 400);
    assert.match(nowhere.body.error, /見つかりませんでした/);
    // 小カテゴリを全部消すとエラー
    assert.equal((await call('POST', '/api/rooms', { location: '梅田', people: 2, datetime: '2026-10-23T19:00', category: 'izakaya', subs: [] })).status, 400);

    // ルーム作成（居酒屋・飲み放題必須・個室）
    // 予算の下限 > 上限はエラー
    assert.equal((await call('POST', '/api/rooms', {
      location: '梅田', people: 3, datetime: '2026-10-23T19:00', budgetMin: 5000, budgetMax: 3000, category: 'izakaya',
    })).status, 400);

    // 小カテゴリ：バーを削除・「もつ鍋」を追加
    const izakayaSubs = ['taishu', 'yakitori', 'kushiage', 'yakiniku', 'kaisen', 'wine', 'korean'].map((value) => ({ value }));
    const created = await call('POST', '/api/rooms', {
      location: ' 難波 ', people: 3, datetime: '2026-10-23T19:00', budgetMin: 3000, budgetMax: 5000,
      category: 'izakaya', subs: [...izakayaSubs, { label: 'もつ鍋', custom: true }],
      nomihodai: 'required', seat: 'private', smoking: 'nonsmoking', takeout: 'no',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { roomId, hostToken } = created.body;
    assert.match(roomId, /^[0-9a-f]{8}$/);
    assert.equal(created.body.room.hostToken, undefined, 'hostToken は公開しない');
    assert.equal(created.body.room.budgetLabel, '3,000〜5,000円');
    assert.equal(created.body.room.locationName, '難波');
    assert.equal(created.body.room.source, 'sample');
    assert.match(created.body.room.centerMapUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=34\.6/);
    assert.deepEqual(created.body.room.subs.map((s) => s.label), ['大衆居酒屋', '焼き鳥', '串揚げ', '焼肉', '海鮮', 'ワインダイニング', '韓国系', 'もつ鍋']);

    // 回答（同じ名前は上書き）
    assert.equal((await call('POST', `/api/rooms/${roomId}/answers`, { name: 'A', ratings: { yakitori: 'great' } })).status, 201);
    const again = await call('POST', `/api/rooms/${roomId}/answers`, { name: 'A', ratings: { yakitori: 'great', kaisen: 'great', c1: 'great', bar: 'ng' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.updated, true);
    assert.equal(again.body.room.answerCount, 1);

    // 受付中は結果なし / 締め切りはホストのみ
    assert.equal((await call('GET', `/api/rooms/${roomId}/result`)).body.pending, true);
    assert.equal((await call('POST', `/api/rooms/${roomId}/close`, { hostToken: 'wrong' })).status, 403);

    // サンプル回答 → 人数(3)に達したら自動締め切り
    assert.equal((await call('POST', `/api/rooms/${roomId}/sample-answer`, { hostToken })).status, 201);
    const last = await call('POST', `/api/rooms/${roomId}/sample-answer`, { hostToken });
    assert.equal(last.body.room.status, 'closed');
    assert.equal((await call('POST', `/api/rooms/${roomId}/answers`, { name: 'Z', ratings: {} })).status, 409);

    // ランキング
    const result = await call('GET', `/api/rooms/${roomId}/result`);
    assert.equal(result.status, 200);
    const rk = result.body.ranking;
    assert.equal(rk.length, 5);
    assert.equal(result.body.summary.respondentCount, 3);
    assert.deepEqual(Object.keys(result.body.summary.subPoints), [...izakayaSubs.map((s) => s.value), 'c1']);
    assert.ok(result.body.summary.ratingCounts.c1.great >= 1, '追加した小カテゴリ（もつ鍋）への ◎ が集計される');
    assert.ok(rk.every((r) => r.smoking !== 'allowed'), '禁煙希望なら喫煙可の店は出ない');
    assert.ok(rk.every((r) => !r.subs.includes('bar')), '削除した小カテゴリ（バー）の店は出ない');
    assert.ok(result.body.excluded['喫煙条件'] > 0 && result.body.excluded['ジャンル外'] > 0);
    assert.ok(rk.every((r) => r.mapUrl.startsWith('https://www.google.com/maps/search/?api=1&query=')));
    assert.equal(result.body.source, 'sample');
    console.log('ranking:', rk.map((r) => `${r.rank}.${r.name}[${r.subLabel}](${r.score})`).join(' '));
    console.log('points :', JSON.stringify(result.body.summary.subPoints));

    // カフェ：飲み放題は無視される
    // カフェ：飲み放題は無視される．テイクアウトは紹介文に記載のある店に加点
    const cafe = await call('POST', '/api/rooms', {
      location: '祇園', people: 1, datetime: '2026-10-24T14:00', budgetMin: null, budgetMax: 3000,
      category: 'cafe', nomihodai: 'required', seat: 'zashiki', takeout: 'want',
    });
    assert.equal(cafe.status, 201);
    assert.equal(cafe.body.room.nomihodai, 'any');
    assert.equal(cafe.body.room.seat, 'zashiki');
    await call('POST', `/api/rooms/${cafe.body.roomId}/answers`, { name: 'B', ratings: { parfait: 'great' } });
    const cafeResult = await call('GET', `/api/rooms/${cafe.body.roomId}/result`);
    assert.equal(cafeResult.status, 200);
    const withTakeout = cafeResult.body.ranking.find((r) => r.takeout);
    assert.ok(withTakeout && withTakeout.breakdown.some((b) => b.key === 'takeout' && b.points === 5));
    console.log('cafe   :', cafeResult.body.ranking.map((r) => `${r.rank}.${r.name}`).join(' '));

    // 以前の形式（予算帯の文字列・喫煙なし）のルームも読める
    await store.createRoom({
      id: 'abcd0001', hostToken: 'x'.repeat(36), location: 'namba', people: 1, datetime: '2026-10-23T19:00',
      budget: '3000-5000', category: 'izakaya', nomihodai: 'any', seat: 'any', takeout: 'no',
      status: 'open', closedReason: null, closedAt: null, createdAt: new Date().toISOString(),
    });
    const legacy = await call('GET', '/api/rooms/abcd0001');
    assert.equal(legacy.body.budgetLabel, '3,000〜5,000円');
    assert.equal(legacy.body.smoking, 'any');
    assert.equal(legacy.body.locationName, '難波');
    assert.equal(legacy.body.subs.length, 8);
    await call('POST', '/api/rooms/abcd0001/answers', { name: 'L', ratings: { kushiage: 'great' } });
    const legacyResult = await call('GET', '/api/rooms/abcd0001/result');
    assert.equal(legacyResult.status, 200);
    console.log('legacy :', legacyResult.body.ranking.map((r) => `${r.rank}.${r.name}`).join(' '));

    // 画面のURL
    for (const p of ['/', `/r/${roomId}`, `/rooms/${roomId}/host`, `/rooms/${roomId}/result`]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
    }

    // ホットペッパーのクライアント経由（偽の fetch がサンプル検索を同じ JSON 形式で返す）
    const calls = [];
    let fail = false;
    const fakeFetch = async (url) => {
      const u = new URL(url);
      calls.push(u);
      if (fail) return { ok: true, status: 200, json: async () => ({ results: { error: [{ code: 3000, message: 'error' }] } }) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(mockSearch(Object.fromEntries(u.searchParams)))) };
    };
    const hpServer = createApp(store, createHotpepperClient({ apiKey: 'TESTKEY', fetchImpl: fakeFetch })).listen(0);
    const hpBase = `http://127.0.0.1:${hpServer.address().port}`;
    try {
      assert.equal((await call('GET', '/api/options', null, hpBase)).body.shopSource, 'hotpepper');
      const hpRoom = await call('POST', '/api/rooms', { location: '京都駅', people: 2, datetime: '2026-10-23T12:00', category: 'meal' }, hpBase);
      assert.equal(hpRoom.status, 201);
      assert.equal(hpRoom.body.room.source, 'hotpepper');
      assert.equal(calls[0].searchParams.get('keyword'), '京都駅');
      assert.equal(calls[0].searchParams.get('key'), 'TESTKEY');
      await call('POST', `/api/rooms/${hpRoom.body.roomId}/answers`, { name: 'H', ratings: { ramen: 'great' } }, hpBase);
      await call('POST', `/api/rooms/${hpRoom.body.roomId}/close`, { hostToken: hpRoom.body.hostToken }, hpBase);
      const hpResult = await call('GET', `/api/rooms/${hpRoom.body.roomId}/result`, null, hpBase);
      assert.equal(hpResult.status, 200);
      assert.equal(hpResult.body.source, 'hotpepper');
      assert.ok(calls.some((u) => u.searchParams.get('lat') && u.searchParams.get('genre')));
      console.log('hotpep :', hpResult.body.ranking.map((r) => `${r.rank}.${r.name}`).join(' '));
      // 以前サンプルで作ったルームは，APIキー設定後もサンプルで計算できる
      assert.equal((await call('GET', `/api/rooms/${roomId}/result`, null, hpBase)).body.source, 'sample');
      // ホットペッパーがエラー → 502（APIキーなどの詳細は返さない）
      fail = true;
      const down = await call('POST', '/api/rooms', { location: '別の場所', people: 2, datetime: '2026-10-23T12:00', category: 'meal' }, hpBase);
      assert.equal(down.status, 502);
      assert.doesNotMatch(down.body.error, /TESTKEY/);
    } finally {
      hpServer.close();
    }
    console.log('OK: all checks passed');
  } finally {
    server.close();
    await store.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
