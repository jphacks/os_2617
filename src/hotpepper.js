/**
 * ホットペッパー グルメサーチAPI の呼び出し（サーバー専用）
 * ===========================================================================
 *
 *   環境変数 HOTPEPPER_API_KEY があれば実データ，なければサンプル店舗（mockRestaurants.js）を使う．
 *   APIキーはサーバーの中だけで使い，画面（ブラウザ）には出さない．
 *
 *   利用規約に合わせて，取得結果のキャッシュは1時間（規約：24時間以内に更新）．
 *   店舗情報はデータベースに保存しない．
 */

const { mockSearch } = require('./mockRestaurants');
const { HP_GENRES } = require('./genreMap');

const ENDPOINT = 'https://webservice.recruit.co.jp/hotpepper';
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const TIMEOUT_MS = 8000;

// キャッシュには使う項目だけ残す（メモリ節約．Render 無料プランは 512MB）
const SHOP_FIELDS = [
  'id', 'name', 'address', 'station_name', 'lat', 'lng', 'genre', 'sub_genre', 'catch', 'budget', 'capacity', 'party_capacity',
  'open', 'close', 'non_smoking', 'private_room', 'tatami', 'horigotatsu', 'free_drink', 'other_memo', 'shop_detail_memo',
  'urls', 'access', 'mobile_access', 'middle_area', 'small_area',
];
function trimResponse(data) {
  const r = data.results || {};
  const shop = (r.shop || []).map((s) => {
    const out = Object.fromEntries(SHOP_FIELDS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
    if (s.photo && s.photo.pc) out.photo = { pc: { m: s.photo.pc.m, l: s.photo.pc.l } };
    return out;
  });
  return { results: { results_available: r.results_available, results_returned: r.results_returned, results_start: r.results_start, shop } };
}

class ShopApiError extends Error {}

function createHotpepperClient({ apiKey, fetchImpl = globalThis.fetch, ttlMs = CACHE_TTL_MS, log = console } = {}) {
  const cache = new Map(); //    検索条件 → { at, data }
  const inflight = new Map(); // 同じ検索を同時に投げない

  async function call(path, params) {
    const query = new URLSearchParams({ ...params, key: apiKey, format: 'json' });
    let res;
    try {
      res = await fetchImpl(`${ENDPOINT}/${path}/v1/?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new ShopApiError(`ホットペッパーに接続できませんでした（${e.name}）`);
    }
    if (!res.ok) throw new ShopApiError(`ホットペッパーがエラーを返しました（HTTP ${res.status}）`);
    const data = await res.json().catch(() => null);
    const err = data && data.results && data.results.error;
    if (!data || err) {
      const e = Array.isArray(err) ? err[0] : err;
      throw new ShopApiError(`ホットペッパーがエラーを返しました（${(e && (e.code + ' ' + e.message)) || '応答が不正'}）`);
    }
    return data;
  }

  /** グルメサーチ（結果は1時間キャッシュ） */
  async function search(params) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
    const cacheKey = JSON.stringify(Object.entries(clean).sort());
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = call('gourmet', clean)
      .then((raw) => {
        const data = trimResponse(raw);
        const now = Date.now();
        for (const [k, v] of cache) if (now - v.at >= ttlMs) cache.delete(k); // 期限切れを捨てる
        while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { at: now, data });
        return data;
      })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  }

  /** 起動時の確認：ジャンルマスタが対応表（genreMap.js）とずれていないか（ログに出すだけ） */
  async function verifyGenres() {
    try {
      const data = await call('genre', {});
      const genres = (data.results && data.results.genre) || [];
      const missing = Object.keys(HP_GENRES).filter((code) => !genres.some((g) => g.code === code));
      const added = genres.filter((g) => !HP_GENRES[g.code]).map((g) => `${g.code}:${g.name}`);
      if (missing.length || added.length) log.warn(`[hotpepper] ジャンル対応表とマスタの差分 missing=${missing.join(',')} added=${added.join(',')}`);
      else log.log(`[hotpepper] ジャンルマスタOK（${genres.length}件）`);
      return { ok: true, missing, added };
    } catch (e) {
      log.warn('[hotpepper] ジャンルマスタの確認に失敗:', e.message);
      return { ok: false, error: e.message };
    }
  }

  return { kind: 'hotpepper', search, verifyGenres };
}

function createSampleClient() {
  return { kind: 'sample', search: async (params) => mockSearch(params), verifyGenres: async () => ({ ok: true }) };
}

/** 環境変数で切り替え */
function createShopClient(env = process.env) {
  const key = (env.HOTPEPPER_API_KEY || '').trim();
  return key ? createHotpepperClient({ apiKey: key }) : createSampleClient();
}

module.exports = { createShopClient, createHotpepperClient, createSampleClient, ShopApiError };
