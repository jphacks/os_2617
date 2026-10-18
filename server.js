/**
 * MealManager - API サーバー
 *
 *   npm install
 *   npm start                      → http://localhost:3000（データはメモリ）
 *   DATABASE_URL=... npm start     → PostgreSQL に保存（本番は Neon）
 *
 * 環境変数
 *   PORT               待ち受けポート（Render が自動で設定）
 *   DATABASE_URL       PostgreSQL の接続文字列（未設定ならメモリ保存）
 *   HOTPEPPER_API_KEY  ホットペッパーのAPIキー（未設定なら架空のサンプル店舗で動く）
 *   DEMO_TOOLS         "false" でホスト画面の「サンプル回答を追加」を隠す（既定は表示）
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OPTIONS = require('./src/options');
const { AREAS } = require('./src/mockRestaurants');
const { generateRanking } = require('./src/ranking');
const { createStore } = require('./src/store');
const { createShopClient, createSampleClient, ShopApiError } = require('./src/hotpepper');
const { createShopSource } = require('./src/shopSource');
const { normalizeShop } = require('./src/shopData');
const { scopeOf, extraQueries } = require('./src/genreMap');
const { FOOD_IMAGES } = require('./src/foodImages');

const DEMO_TOOLS = process.env.DEMO_TOOLS !== 'false';

// アンケートのカードの画像：小カテゴリ名 → URL（public/food/ に実際にあるものだけ）
const FOOD_IMAGE_URLS = Object.fromEntries(
  Object.entries(FOOD_IMAGES)
    .filter(([, file]) => fs.existsSync(path.join(__dirname, 'public', 'food', file)))
    .map(([label, file]) => [label, `/assets/food/${encodeURIComponent(file)}`]),
);

/**
 * @param store       保存先（src/store.js）
 * @param shopClient  お店の検索（src/hotpepper.js．省略時は環境変数で ホットペッパー / サンプル を選ぶ）
 */
function createApp(store, shopClient = createShopClient()) {
  // お店の取得．以前サンプルで作ったルームは，APIキーを設定した後もサンプルのまま計算する
  const helpers = { normalizeShop, scopeOf, extraQueries };
  const sources = {
    [shopClient.kind]: createShopSource(shopClient.search, helpers),
    sample: createShopSource(shopClient.kind === 'sample' ? shopClient.search : createSampleClient().search, helpers),
  };
  const sampleAreas = AREAS.map((a) => a.name).join('・');
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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

  /** 場所（自由記述）：前後の空白・制御文字を除き，連続する空白を1つに */
  const cleanLocation = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() : '');

  function validateRoomInput(b = {}) {
    const errors = [];
    const location = cleanLocation(b.location);
    if (!location) errors.push('場所を入力してください');
    else if (location.length > OPTIONS.LOCATION_MAX) errors.push(`場所は${OPTIONS.LOCATION_MAX}文字以内で入力してください`);
    const people = Number(b.people);
    if (!Number.isInteger(people) || people < 1 || people > OPTIONS.MAX_PEOPLE) errors.push(`人数は1〜${OPTIONS.MAX_PEOPLE}の整数で入力してください`);
    if (typeof b.datetime !== 'string' || !DATETIME_RE.test(b.datetime) || Number.isNaN(Date.parse(b.datetime))) errors.push('日時を正しく入力してください');
    // 予算：下限・上限は 500円刻みの選択肢か「指定なし」(null)
    const toYen = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const budget = { min: toYen(b.budgetMin), max: toYen(b.budgetMax) };
    if ([budget.min, budget.max].some((v) => v !== null && !OPTIONS.BUDGET_STEPS.includes(v))) errors.push('予算を選択してください');
    else if (budget.min && budget.max && budget.min > budget.max) errors.push('予算の下限が上限より高くなっています');
    if (!values(OPTIONS.CATEGORIES).includes(b.category)) errors.push('ジャンルを選択してください');
    // 詳細設定（未指定なら「こだわらない」）
    const takeout = b.takeout === 'want' ? 'want' : 'no';
    const seat = values(OPTIONS.SEATS).includes(b.seat) ? b.seat : 'any';
    const smoking = values(OPTIONS.SMOKING).includes(b.smoking) ? b.smoking : 'any';
    // カフェでは飲み放題を条件にしない
    const nomihodai = OPTIONS.asksNomihodai(b.category) && b.nomihodai === 'required' ? 'required' : 'any';
    // 小カテゴリ：既定から削除・自由入力で追加（このルームだけに効く）
    const { subs, error } = OPTIONS.buildRoomSubs(b.category, b.subs);
    if (error && !errors.some((e) => e.includes('ジャンル'))) errors.push(error);
    return {
      errors,
      value: { location, people, datetime: b.datetime, budget, category: b.category, subs, nomihodai, seat, smoking, takeout },
    };
  }

  function validateAnswer(b = {}, room) {
    const errors = [];
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 20) errors.push('ニックネームを20文字以内で入力してください');
    const src = b.ratings && typeof b.ratings === 'object' ? b.ratings : {};
    const ratings = Object.fromEntries(
      room.subs.map((s) => [s.value, values(OPTIONS.RATINGS).includes(src[s.value]) ? src[s.value] : OPTIONS.DEFAULT_RATING]),
    );
    return { errors, value: { name, ratings } };
  }

  // -------------------------------------------------------------------------
  // 表示用の変換
  // -------------------------------------------------------------------------
  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

  /** 保存されたルームを最新の形にそろえる（以前の形式で作られたルームも読めるように） */
  function normalizeRoom(room) {
    if (!room) return null;
    // 以前の「エリアを選ぶ」形式（location: 'umeda'）→ 地名と座標．店はサンプルのまま
    const area = !room.center && AREAS.find((a) => a.id === room.location);
    return {
      ...room,
      ...(area ? { location: area.name, center: { lat: area.lat, lng: area.lng }, areaLabel: area.name, source: 'sample' } : {}),
      source: room.source || 'sample',
      subs: Array.isArray(room.subs) && room.subs.length ? room.subs : OPTIONS.defaultSubs(room.category),
      budget: OPTIONS.normalizeBudget(room.budget),
      nomihodai: room.nomihodai || 'any',
      seat: values(OPTIONS.SEATS).includes(room.seat) ? room.seat : 'any', // 以前の「テーブル」「カウンター」はこだわらない扱い
      smoking: room.smoking || 'any',
      takeout: room.takeout || 'no',
    };
  }

  const mapUrlOf = (c) => (c ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}` : null);

  function publicRoom(room, answers, req) {
    return {
      roomId: room.id,
      location: room.location,
      locationName: room.location,
      areaLabel: room.areaLabel || '',
      centerMapUrl: mapUrlOf(room.center),
      source: room.source,
      people: room.people,
      datetime: room.datetime,
      budget: room.budget,
      budgetLabel: OPTIONS.formatBudget(room.budget),
      category: room.category,
      subs: room.subs,
      nomihodai: room.nomihodai,
      seat: room.seat,
      smoking: room.smoking,
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
    const room = ROOM_ID_RE.test(id) ? normalizeRoom(await store.getRoom(id)) : null;
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
  app.get('/healthz', (req, res) => res.json({ ok: true, store: store.kind, shops: shopClient.kind }));

  app.get('/api/options', (req, res) => {
    res.json({
      shopSource: shopClient.kind, // 'hotpepper' | 'sample'
      sampleAreas: shopClient.kind === 'sample' ? AREAS.map((a) => a.name) : [],
      locationMax: OPTIONS.LOCATION_MAX,
      maxSubs: OPTIONS.MAX_SUBS,
      subLabelMax: OPTIONS.SUB_LABEL_MAX,
      budgetSteps: OPTIONS.BUDGET_STEPS,
      defaultBudget: OPTIONS.DEFAULT_BUDGET,
      categories: OPTIONS.CATEGORIES,
      categoriesWithoutNomihodai: OPTIONS.CATEGORIES_WITHOUT_NOMIHODAI,
      ratings: OPTIONS.RATINGS,
      foodImages: FOOD_IMAGE_URLS,
      defaultRating: OPTIONS.DEFAULT_RATING,
      nomihodai: OPTIONS.NOMIHODAI,
      seats: OPTIONS.SEATS,
      smoking: OPTIONS.SMOKING,
      shopSmokingLabels: OPTIONS.SHOP_SMOKING_LABELS,
      takeout: OPTIONS.TAKEOUT,
      maxPeople: OPTIONS.MAX_PEOPLE,
      demoTools: DEMO_TOOLS,
    });
  });

  /** ルーム作成 → { roomId, hostToken, shareUrl, hostUrl, room }．場所の地名はここで座標にする */
  app.post('/api/rooms', rateLimit, wrap(async (req, res) => {
    const { errors, value } = validateRoomInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' / ') });
    const place = await sources[shopClient.kind].geocode(value.location);
    if (!place) {
      const hint = shopClient.kind === 'sample' ? `（サンプルデータでは ${sampleAreas} などの地名で試せます）` : '（駅名や地名で入力してください）';
      return res.status(400).json({ error: `「${value.location}」の場所が見つかりませんでした${hint}` });
    }
    let id;
    do id = crypto.randomBytes(4).toString('hex');
    while (await store.getRoom(id));
    const room = {
      id,
      hostToken: crypto.randomUUID(), // 締め切り操作用．ホスト用URLにだけ含める
      ...value,
      center: { lat: place.lat, lng: place.lng },
      areaLabel: place.areaLabel,
      source: shopClient.kind,
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
    const latest = normalizeRoom(await store.getRoom(room.id));
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
    res.json({ room: publicRoom(normalizeRoom(await store.getRoom(room.id)), answers, req) });
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
    const subs = room.subs.map((s) => s.value);
    // 先頭寄りの小カテゴリほど 〇（好き）が付きやすい（好みが偏るように）
    const ratings = Object.fromEntries(subs.map((s, i) => {
      const r = Math.random();
      const great = 0.45 - (0.3 * i) / subs.length;
      return [s, r < great ? 'great' : r < 0.82 ? 'ok' : 'ng'];
    }));
    await saveAnswer(room, { name: `サンプル${n}`, ratings });
    res.status(201).json({ room: publicRoom(normalizeRoom(await store.getRoom(room.id)), await store.listAnswers(room.id), req) });
  }));

  /** ランキング（受付中は { pending: true }）．締め切り時点までの回答で計算する */
  app.get('/api/rooms/:roomId/result', wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    const answers = await store.listAnswers(room.id);
    if (room.status !== 'closed') {
      return res.json({ pending: true, room: publicRoom(room, answers, req) });
    }
    const used = answers.filter((a) => !room.closedAt || a.answeredAt <= room.closedAt);
    if (!used.length) return res.status(409).json({ error: '回答がないためランキングを作れません', room: publicRoom(room, answers, req) });
    const source = sources[room.source];
    if (!source) return res.status(503).json({ error: 'お店の検索が設定されていません（HOTPEPPER_API_KEY）' });
    const { shops, rangeKm } = await source.fetchShops(room);
    res.json({
      room: publicRoom(room, used, req),
      ...generateRanking({ ...room, locationName: room.location }, used, shops),
      source: room.source,
      rangeKm,
    });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // -------------------------------------------------------------------------
  // 画面（1ページのアプリ．URL ごとに表示を切り替える）
  // -------------------------------------------------------------------------
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  const sendIndex = (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html'));
  app.get(['/', '/r/:roomId', '/rooms/:roomId/host', '/rooms/:roomId/result'], sendIndex);
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

  // エラー（DB 接続失敗・ホットペッパーの通信失敗など）
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ShopApiError) {
      console.error('[shops]', err.message);
      return res.status(502).json({ error: 'お店の情報を取得できませんでした。少し待ってからもう一度お試しください' });
    }
    console.error('[error]', err);
    res.status(500).json({ error: 'サーバーでエラーが起きました。少し待ってからもう一度お試しください' });
  });

  return app;
}

async function main() {
  const store = createStore();
  await store.init();
  const shopClient = createShopClient();
  const app = createApp(store, shopClient);
  if (shopClient.kind === 'hotpepper') shopClient.verifyGenres(); // ジャンル対応表の確認（ログのみ・待たない）
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`MealManager: http://localhost:${port} (store: ${store.kind}, shops: ${shopClient.kind})`);
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
