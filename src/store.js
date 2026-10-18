/**
 * データの保存先．
 *   - 環境変数 DATABASE_URL があれば PostgreSQL（本番: Neon）
 *   - なければメモリ（ローカル開発用．再起動で消える）
 *
 * どちらも同じメソッドを持つので，server.js は保存先を意識しない．
 * ルームと回答は JSONB でそのまま保存する（項目を増やしてもテーブル変更が不要）．
 */
const clone = (v) => JSON.parse(JSON.stringify(v));
const byAnsweredAt = (a, b) => (a.answeredAt < b.answeredAt ? -1 : a.answeredAt > b.answeredAt ? 1 : 0);

function createMemoryStore() {
  const rooms = new Map(); // roomId -> room
  const answers = new Map(); // roomId -> Map(name -> answer)

  return {
    kind: 'memory',
    async init() {},
    async close() {},

    async createRoom(room) {
      rooms.set(room.id, clone(room));
      answers.set(room.id, new Map());
    },
    async getRoom(id) {
      const r = rooms.get(id);
      return r ? clone(r) : null;
    },
    /** @returns {{updated: boolean}} 同じ名前の回答があれば上書き */
    async upsertAnswer(roomId, key, answer) {
      const m = answers.get(roomId);
      const updated = m.has(key);
      m.set(key, clone(answer));
      return { updated };
    },
    async listAnswers(roomId) {
      return [...(answers.get(roomId) || new Map()).values()].map(clone).sort(byAnsweredAt);
    },
    /** 受付中のときだけ締め切る．締め切ったら true */
    async closeRoom(roomId, reason, closedAt) {
      const r = rooms.get(roomId);
      if (!r || r.status !== 'open') return false;
      Object.assign(r, { status: 'closed', closedReason: reason, closedAt });
      return true;
    },
  };
}

function createPostgresStore(databaseUrl) {
  const { Pool } = require('pg');

  // 接続文字列の sslmode / channel_binding は使わず，SSL 設定はここで明示する
  const url = new URL(databaseUrl);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000, // Neon の無料枠はスリープから起きるのに数秒かかることがある
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
          id         TEXT PRIMARY KEY,
          data       JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS answers (
          room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          answer_key  TEXT NOT NULL,
          data        JSONB NOT NULL,
          answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (room_id, answer_key)
        )`);
    },
    async close() {
      await pool.end();
    },

    async createRoom(room) {
      await pool.query('INSERT INTO rooms (id, data) VALUES ($1, $2)', [room.id, JSON.stringify(room)]);
    },
    async getRoom(id) {
      const { rows } = await pool.query('SELECT data FROM rooms WHERE id = $1', [id]);
      return rows[0] ? rows[0].data : null;
    },
    async upsertAnswer(roomId, key, answer) {
      const { rows } = await pool.query(
        `INSERT INTO answers (room_id, answer_key, data) VALUES ($1, $2, $3)
         ON CONFLICT (room_id, answer_key) DO UPDATE SET data = EXCLUDED.data, answered_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [roomId, key, JSON.stringify(answer)],
      );
      return { updated: !rows[0].inserted };
    },
    async listAnswers(roomId) {
      const { rows } = await pool.query('SELECT data FROM answers WHERE room_id = $1 ORDER BY answered_at', [roomId]);
      return rows.map((r) => r.data).sort(byAnsweredAt);
    },
    async closeRoom(roomId, reason, closedAt) {
      const { rowCount } = await pool.query(
        `UPDATE rooms SET data = data || $2::jsonb WHERE id = $1 AND data->>'status' = 'open'`,
        [roomId, JSON.stringify({ status: 'closed', closedReason: reason, closedAt })],
      );
      return rowCount > 0;
    },
  };
}

function createStore(env = process.env) {
  return env.DATABASE_URL ? createPostgresStore(env.DATABASE_URL) : createMemoryStore();
}

module.exports = { createStore, createMemoryStore, createPostgresStore };
