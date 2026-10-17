/**
 * みんなで店決め - API サーバー
 *
 *   npm install
 *   npm start                      → http://localhost:3000（データはメモリ）
 *   DATABASE_URL=... npm start     → PostgreSQL に保存（本番は Neon）
 *
 * 環境変数
 *   PORT          待ち受けポート（Render が自動で設定）
 *   DATABASE_URL  PostgreSQL の接続文字列（未設定ならメモリ保存）
 *   DEMO_TOOLS    "false" でホスト画面の「サンプル回答を追加」を隠す（既定は表示）
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const OPTIONS = require('./src/options');
const { AREAS } = require('./src/mockRestaurants');
const { generateRanking } = require('./src/ranking');
const { createStore } = require('./src/store');

const DEMO_TOOLS = process.env.DEMO_TOOLS !== 'false';

function createApp(store) {
  const app = express();
  app.set('trust proxy', 1); // Render のロードバランサー越しに正しいプロトコル・IP を得る
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  // 基本的なセキュリティヘッダー（ホスト用URLのトークンが外部に漏れないよう Referrer も止める）
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });

  // -------------------------------------------------------------------------
  // 書き込み系の簡易レート制限（1つのIPから10分間に120回まで）
  // -------------------------------------------------------------------------
  const hits = new Map();
  const WINDOW_MS = 10 * 60 * 1000;
  const MAX_WRITES = 120;
  function rateLimit(req, res, next) {
    const now = Date.now();
    const rec = hits.get(req.ip) || { count: 0, start: now };
    if (now - rec.start > WINDOW_MS) Object.assign(rec, { count: 0, start: now });
    rec.count += 1;
    hits.set(req.ip, rec);
    if (hits.size > 10000) hits.clear();
    if (rec.count > MAX_WRITES) return res.status(429).json({ error: '操作が多すぎます。しばらく待ってからお試しください' });
    next();
  }

  // async ハンドラのエラーをまとめて 500 にする
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -------------------------------------------------------------------------
  // バリデーション
  // -------------------------------------------------------------------------
  const values = (list) => list.map((o) => o.value);
  const ROOM_ID_RE = /^[0-9a-f]{8}$/;
  const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  function validateRoomInput(b = {}) {
    const errors = [];
    if (!AREAS.some((a) => a.id === b.location)) errors.push('場所を選択してください');
    const people = Number(b.people);
    if (!Number.isInteger(people) || people < 1 || people > OPTIONS.MAX_PEOPLE) errors.push(`人数は1〜${OPTIONS.MAX_PEOPLE}の整数で入力してください`);
    if (typeof b.datetime !== 'string' || !DATETIME_RE.test(b.datetime) || Number.isNaN(Date.parse(b.datetime))) errors.push('日時を正しく入力してください');
    if (!values(OPTIONS.BUDGETS).includes(b.budget)) errors.push('予算を選択してください');
    if (!values(OPTIONS.CATEGORIES).includes(b.category)) errors.push('ジャンルを選択してください');
    if (!values(OPTIONS.TAKEOUT).includes(b.takeout)) errors.push('テイクアウトを選択してください');
    const seat = values(OPTIONS.SEATS).includes(b.seat) ? b.seat : 'any';
    // カフェでは飲み放題を条件にしない
    const nomihodai = OPTIONS.asksNomihodai(b.category) && b.nomihodai === 'required' ? 'required' : 'any';
    return {
      errors,
      value: { location: b.location, people, datetime: b.datetime, budget: b.budget, category: b.category, nomihodai, seat, takeout: b.takeout },
    };
  }

  function validateAnswer(b = {}, room) {
    const errors = [];
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 20) errors.push('ニックネームを20文字以内で入力してください');
    const src = b.ratings && typeof b.ratings === 'object' ? b.ratings : {};
    const ratings = Object.fromEntries(
      OPTIONS.subsOf(room.category).map((s) => [s.value, values(OPTIONS.RATINGS).includes(src[s.value]) ? src[s.value] : OPTIONS.DEFAULT_RATING]),
    );
    return { errors, value: { name, ratings } };
  }

  // -------------------------------------------------------------------------
  // 表示用の変換
  // -------------------------------------------------------------------------
  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

  function publicRoom(room, answers, req) {
    const area = AREAS.find((a) => a.id === room.location);
    return {
      roomId: room.id,
      location: room.location,
      locationName: area ? `${area.city}・${area.name}` : room.location,
      people: room.people,
      datetime: room.datetime,
      budget: room.budget,
      category: room.category,
      nomihodai: room.nomihodai,
      seat: room.seat,
      takeout: room.takeout,
      status: room.status,
      closedReason: room.closedReason,
      answerCount: answers.length,
      respondents: answers.map((a) => a.name),
      shareUrl: `${baseUrl(req)}/r/${room.id}`,
    };
  }

  async function loadRoom(req, res) {
    const id = req.params.roomId;
    const room = ROOM_ID_RE.test(id) ? await store.getRoom(id) : null;
    if (!room) res.status(404).json({ error: 'ルームが見つかりません。リンクやルームコードを確認してください' });
    return room;
  }

  function isHost(room, token) {
    if (typeof token !== 'string' || token.length !== room.hostToken.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(room.hostToken));
  }

  /** 回答を保存し，人数に達したら自動で締め切る */
  async function saveAnswer(room, answer) {
    const { updated } = await store.upsertAnswer(room.id, answer.name, { ...answer, answeredAt: new Date().toISOString() });
    const answers = await store.listAnswers(room.id);
    if (answers.length >= room.people) await store.closeRoom(room.id, 'all_answered', new Date().toISOString());
    return { updated };
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------
  app.get('/healthz', (req, res) => res.json({ ok: true, store: store.kind }));

  app.get('/api/options', (req, res) => {
    res.json({
      areas: AREAS.map(({ id, name, city }) => ({ id, name, city })),
      budgets: OPTIONS.BUDGETS,
      categories: OPTIONS.CATEGORIES,
      categoriesWithoutNomihodai: OPTIONS.CATEGORIES_WITHOUT_NOMIHODAI,
      ratings: OPTIONS.RATINGS,
      defaultRating: OPTIONS.DEFAULT_RATING,
      nomihodai: OPTIONS.NOMIHODAI,
      seats: OPTIONS.SEATS,
      takeout: OPTIONS.TAKEOUT,
      maxPeople: OPTIONS.MAX_PEOPLE,
      demoTools: DEMO_TOOLS,
    });
  });

  /** ルーム作成 → { roomId, hostToken, shareUrl, hostUrl, room } */
  app.post('/api/rooms', rateLimit, wrap(async (req, res) => {
    const { errors, value } = validateRoomInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' / ') });
    let id;
    do id = crypto.randomBytes(4).toString('hex');
    while (await store.getRoom(id));
    const room = {
      id,
      hostToken: crypto.randomUUID(), // 締め切り操作用．ホスト用URLにだけ含める
      ...value,
      status: 'open',
      closedReason: null,
      closedAt: null,
      createdAt: new Date().toISOString(),
    };
    await store.createRoom(room);
    res.status(201).json({
      roomId: id,
      hostToken: room.hostToken,
      shareUrl: `${baseUrl(req)}/r/${id}`,
      hostUrl: `${baseUrl(req)}/rooms/${id}/host?token=${room.hostToken}`,
      room: publicRoom(room, [], req),
    });
  }));

  /** ルーム情報と回答状況（画面のポーリング用） */
  app.get('/api/rooms/:roomId', wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    res.json(publicRoom(room, await store.listAnswers(room.id), req));
  }));

  /** 回答（同じニックネームなら上書き） */
  app.post('/api/rooms/:roomId/answers', rateLimit, wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    if (room.status !== 'open') return res.status(409).json({ error: 'このルームは締め切られています' });
    const { errors, value } = validateAnswer(req.body, room);
    if (errors.length) return res.status(400).json({ error: errors.join(' / ') });
    const { updated } = await saveAnswer(room, value);
    const latest = await store.getRoom(room.id);
    res.status(updated ? 200 : 201).json({ updated, room: publicRoom(latest, await store.listAnswers(room.id), req) });
  }));

  /** ホストによる締め切り */
  app.post('/api/rooms/:roomId/close', rateLimit, wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    if (!isHost(room, req.body && req.body.hostToken)) return res.status(403).json({ error: '締め切りはホストのみ操作できます' });
    const answers = await store.listAnswers(room.id);
    if (room.status === 'open') {
      if (!answers.length) return res.status(400).json({ error: '回答が1件以上必要です' });
      await store.closeRoom(room.id, 'host_closed', new Date().toISOString());
    }
    res.json({ room: publicRoom(await store.getRoom(room.id), answers, req) });
  }));

  /** 動作確認用：ランダムなサンプル回答を1件追加（ホストのみ） */
  app.post('/api/rooms/:roomId/sample-answer', rateLimit, wrap(async (req, res) => {
    if (!DEMO_TOOLS) return res.status(404).json({ error: 'この機能は無効です' });
    const room = await loadRoom(req, res);
    if (!room) return;
    if (!isHost(room, req.body && req.body.hostToken)) return res.status(403).json({ error: 'ホストのみ操作できます' });
    if (room.status !== 'open') return res.status(409).json({ error: 'このルームは締め切られています' });
    const names = (await store.listAnswers(room.id)).map((a) => a.name);
    let n = 1;
    while (names.includes(`サンプル${n}`)) n += 1;
    const subs = OPTIONS.subsOf(room.category).map((s) => s.value);
    // 先頭寄りの小カテゴリほど ◎ が付きやすい（好みが偏るように）
    const ratings = Object.fromEntries(subs.map((s, i) => {
      const r = Math.random();
      const great = 0.45 - (0.3 * i) / subs.length;
      return [s, r < great ? 'great' : r < 0.82 ? 'ok' : 'ng'];
    }));
    await saveAnswer(room, { name: `サンプル${n}`, ratings });
    res.status(201).json({ room: publicRoom(await store.getRoom(room.id), await store.listAnswers(room.id), req) });
  }));

  /** ランキング（受付中は 409）．締め切り時点までの回答で計算する */
  app.get('/api/rooms/:roomId/result', wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    const answers = await store.listAnswers(room.id);
    if (room.status !== 'closed') {
      return res.status(409).json({ error: 'まだ回答を受付中です', room: publicRoom(room, answers, req) });
    }
    const used = answers.filter((a) => !room.closedAt || a.answeredAt <= room.closedAt);
    if (!used.length) return res.status(409).json({ error: '回答がないためランキングを作れません', room: publicRoom(room, answers, req) });
    res.json({ room: publicRoom(room, used, req), ...generateRanking(room, used) });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // -------------------------------------------------------------------------
  // 画面（1ページのアプリ．URL ごとに表示を切り替える）
  // -------------------------------------------------------------------------
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  const sendIndex = (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html'));
  app.get(['/', '/r/:roomId', '/rooms/:roomId/host', '/rooms/:roomId/result'], sendIndex);
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

  // エラー（DB 接続失敗など）
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'サーバーでエラーが起きました。少し待ってからもう一度お試しください' });
  });

  return app;
}

async function main() {
  const store = createStore();
  await store.init();
  const app = createApp(store);
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`みんなで店決め: http://localhost:${port} (store: ${store.kind})`);
  });
  const shutdown = () => server.close(() => store.close().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('起動に失敗しました:', err);
    process.exit(1);
  });
}

module.exports = { createApp };
