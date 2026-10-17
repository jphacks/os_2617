/**
 * API の一連の流れを確認するテスト（npm test）．
 * DATABASE_URL があれば PostgreSQL，なければメモリで実行する．
 */
const assert = require('assert/strict');
const { createApp } = require('../server');
const { createStore } = require('../src/store');

(async () => {
  const store = createStore();
  await store.init();
  const server = createApp(store).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    console.log('store:', store.kind);
    assert.equal((await call('GET', '/healthz')).body.ok, true);

    // 入力エラー
    assert.equal((await call('POST', '/api/rooms', { location: 'x' })).status, 400);

    // ルーム作成（居酒屋・飲み放題必須・個室）
    const created = await call('POST', '/api/rooms', {
      location: 'umeda', people: 3, datetime: '2026-10-23T19:00', budget: '3000-5000',
      category: 'izakaya', nomihodai: 'required', seat: 'private', takeout: 'no',
    });
    assert.equal(created.status, 201);
    const { roomId, hostToken } = created.body;
    assert.match(roomId, /^[0-9a-f]{8}$/);
    assert.equal(created.body.room.hostToken, undefined, 'hostToken は公開しない');

    // 回答（同じ名前は上書き）
    assert.equal((await call('POST', `/api/rooms/${roomId}/answers`, { name: 'A', ratings: { yakitori: 'great' } })).status, 201);
    const again = await call('POST', `/api/rooms/${roomId}/answers`, { name: 'A', ratings: { yakitori: 'great', kaisen: 'great', bar: 'ng' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.updated, true);
    assert.equal(again.body.room.answerCount, 1);

    // 受付中は結果なし / 締め切りはホストのみ
    assert.equal((await call('GET', `/api/rooms/${roomId}/result`)).status, 409);
    assert.equal((await call('POST', `/api/rooms/${roomId}/close`, { hostToken: 'wrong' })).status, 403);

    // サンプル回答 → 人数(3)に達したら自動締め切り
    assert.equal((await call('POST', `/api/rooms/${roomId}/sample-answer`, { hostToken })).status, 201);
    const last = await call('POST', `/api/rooms/${roomId}/sample-answer`, { hostToken });
    assert.equal(last.body.room.status, 'closed');
    assert.equal((await call('POST', `/api/rooms/${roomId}/answers`, { name: 'Z', ratings: {} })).status, 409);

    // ランキング
    const result = await call('GET', `/api/rooms/${roomId}/result`);
    assert.equal(result.status, 200);
    assert.equal(result.body.ranking.length, 5);
    assert.equal(result.body.summary.respondentCount, 3);
    assert.ok(result.body.ranking.every((r) => r.categoryLabel === '居酒屋'));
    console.log('ranking:', result.body.ranking.map((r) => `${r.rank}.${r.name}(${r.score})`).join(' '));
    console.log('points :', JSON.stringify(result.body.summary.subPoints));

    // カフェ：飲み放題は無視される
    const cafe = await call('POST', '/api/rooms', {
      location: 'gion', people: 1, datetime: '2026-10-24T14:00', budget: '1000-3000',
      category: 'cafe', nomihodai: 'required', seat: 'any', takeout: 'want',
    });
    assert.equal(cafe.body.room.nomihodai, 'any');
    await call('POST', `/api/rooms/${cafe.body.roomId}/answers`, { name: 'B', ratings: { parfait: 'great' } });
    const cafeResult = await call('GET', `/api/rooms/${cafe.body.roomId}/result`);
    assert.equal(cafeResult.status, 200);
    console.log('cafe   :', cafeResult.body.ranking.map((r) => `${r.rank}.${r.name}`).join(' '));

    // 画面のURL
    for (const p of ['/', `/r/${roomId}`, `/rooms/${roomId}/host`, `/rooms/${roomId}/result`]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
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
