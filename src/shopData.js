/**
 * ホットペッパーの店舗データ → このアプリの内部形式 への変換
 * ===========================================================================
 *
 * ホットペッパーの項目の多くは文章（例：営業時間 "月～金: 17:00～翌0:00 （料理L.O. 23:00）"）なので，
 * 採点や足切りに使えるよう数値・真偽値に読み替える．読み取れないものは null（＝不明）にして，
 * 不明な項目では店を除外も減点もしない（「分からない」を「ない」と扱わない）．
 *
 *   予算     budget.average（"ディナー3000円 ランチ1000円" など）→ 円．なければ予算コードの中央値
 *   営業時間 open  → 曜日ごとの営業時間帯       定休日 close → 曜日（第2火曜などの不定期は数えない）
 *   禁煙     non_smoking "全面禁煙" / "一部禁煙" / "禁煙席なし" → none / separated / allowed
 *   個室 private_room，座敷 tatami・horigotatsu，飲み放題 free_drink："あり" / "なし" → true / false
 *   テイクアウト ホットペッパーに項目がないため，店名・キャッチ・備考に「テイクアウト」等があれば対応とみなす
 */

const DAY_CHARS = '日月火水木金土'; // index = 曜日（0=日）

// 予算コード（検索用ディナー予算マスタ）→ 目安（帯の中央）
const BUDGET_CODE_YEN = {
  B009: 500, B010: 750, B011: 1250, B001: 1750, B002: 2500, B003: 3500, B008: 4500,
  B004: 6000, B005: 8500, B006: 12500, B012: 17500, B013: 25000, B014: 30000,
};

/** 全角数字・記号をそろえる（"１７：００〜" → "17:00～"） */
function toHalf(s) {
  return String(s || '')
    .replace(/[０-９Ａ-Ｚａ-ｚ：／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[〜~]/g, '～');
}

/** "月～金、土" → [1,2,3,4,5,6]（範囲は曜日をまたいでもよい："金～月"） */
function expandDays(spec) {
  const days = [];
  let prev = null;
  let ranging = false;
  for (const ch of spec) {
    const d = DAY_CHARS.indexOf(ch);
    if (d >= 0) {
      if (ranging && prev !== null) {
        for (let x = (prev + 1) % 7; ; x = (x + 1) % 7) { days.push(x); if (x === d) break; }
      } else days.push(d);
      prev = d;
      ranging = false;
    } else if (ch === '～') ranging = true;
  }
  return [...new Set(days)];
}

// 曜日として読まない言葉（「休業日」「元日」「月末」「1月1日」「祝日」など．曜日の漢字を含むので先に消す）
const NOT_DAY_WORDS = /(?<![\d:])\d{1,2}\s*[月/]\s*\d{1,2}\s*日?|(?<![\d:])\d{1,2}\s*日(?!曜)|(?<![\d:])\d{1,2}\s*月(?!曜)|(?:不定|臨時)?休業?日|定休日|元日|元旦|正月|毎月|月末|月初|月\d+回|月に|祝前日|祝後日|祝祭日|祝日|祝|年末年始|お盆|ゴールデンウィーク|GW|夏季|冬季|営業日|翌日|前日|当日|日中|日替わり|本日|土曜夜|日曜夜/g;
// 曜日の並び（"月～金"・"土、日"・"月曜日～土曜日"）
const DAY_RUN = /[日月火水木金土](?:曜日?)?(?:\s*[・、,～]?\s*[日月火水木金土](?:曜日?)?)*/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** かっこ書き（L.O. など）を消し，曜日の言い方をそろえる */
function normalizeDayWords(s, { openText } = {}) {
  let t = s.replace(/[（(][^）)]*[）)]/g, ' ');
  if (openText) t = t.replace(/毎日|年中無休|無休/g, '月～日');
  return t.replace(/平日/g, '月～金').replace(/週末/g, '土・日').replace(NOT_DAY_WORDS, ' ');
}

/**
 * 文章から曜日の指定を順に取り出す → [{ days, index, end }]
 * 単語の一部（「昨日」など）は除く．定休日では「土曜ランチ」「日曜の夜」のように時間帯がつくものも除く
 */
function dayTokens(s, { closed } = {}) {
  const out = [];
  DAY_RUN.lastIndex = 0;
  let m;
  while ((m = DAY_RUN.exec(s))) {
    const before = s.slice(0, m.index).slice(-1);
    const after = s.slice(m.index + m[0].length);
    if (before && WORD_CHAR.test(before) && !/[週はと及]/.test(before)) continue;
    if (!/曜/.test(m[0]) && after && WORD_CHAR.test(after[0]) && !/^[休定はとのも及]/.test(after)) continue;
    let run = m[0];
    if (closed && /^\s*の?\s*(ランチ|昼|夜|ディナー|午前|午後|朝|モーニング|営業)/.test(after)) {
      // "日曜日、土曜ランチ" → 日曜だけ定休．"土日祝のランチ" のように1まとまりなら全部除く
      if (!/、|,/.test(run)) continue;
      run = run.replace(/[、,]\s*[^、,]*$/, '');
    }
    out.push({ days: expandDays(run.replace(/曜日?/g, '')), index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * 営業時間 "月～金: 11:30～14:00 17:00～23:00 土、日: 11:00～翌1:00" →
 *   { 1: [[11.5,14],[17,23]], …, 6: [[11,25]], 0: [[11,25]] }（24以上は翌日．曜日の書かれていない時間は全曜日）
 * 読み取れない・一部しか読めない書き方（"17時～"・"17:00～LAST"・かっこ内の延長営業など）は null（不明）
 */
function parseOpenHours(raw) {
  if (!raw) return null;
  const half = toHalf(raw);
  if (/\d{1,2}\s*時/.test(half)) return null; //                                        "17時～23時"
  if (/\d{1,2}:\d{2}\s*[～\-－](?!\s*(?:翌|朝|深夜)*\s*\d{1,2}:\d{2})/.test(half)) return null; // "17:00～LAST"
  const parens = half.match(/[（(][^）)]*[）)]/g) || [];
  if (parens.some((p) => /\d{1,2}:\d{2}/.test(p) && !/L\.?\s?O|ラスト|オーダー/i.test(p))) return null; // "（金・土は翌2:00まで）"

  const s = normalizeDayWords(half, { openText: true });
  const times = [];
  const timeRe = /(\d{1,2}):(\d{2})\s*[～\-－]\s*(翌)?\s*(?:朝|深夜)*\s*(\d{1,2}):(\d{2})/g;
  let m;
  while ((m = timeRe.exec(s))) {
    const open = Number(m[1]) + Number(m[2]) / 60;
    let close = Number(m[4]) + Number(m[5]) / 60;
    if (m[3] || close <= open) close += 24; // 翌〇時・日付またぎ
    if (open < 30 && close <= 48) times.push({ index: m.index, open, close });
  }
  if (!times.length) return null;
  const tokens = [...dayTokens(s).map((d) => ({ ...d, kind: 'days' })), ...times.map((t) => ({ ...t, kind: 'time' }))].sort((a, b) => a.index - b.index);

  const byDay = {};
  let current = null; // 直前の曜日指定
  let lastWasTime = true;
  for (const t of tokens) {
    if (t.kind === 'days') {
      current = lastWasTime || !current ? t.days : [...new Set([...current, ...t.days])];
      lastWasTime = false;
      continue;
    }
    for (const d of current || [0, 1, 2, 3, 4, 5, 6]) (byDay[d] = byDay[d] || []).push([t.open, t.close]);
    lastWasTime = true;
  }
  return byDay;
}

/** 定休日 "日曜日（祝日の場合は翌日）" → [0]．"不定休"・"第2火曜"・"1月1日～3日" などは数えない */
function parseClosedDays(raw) {
  if (!raw) return [];
  let s = toHalf(raw);
  if (/無休|なし/.test(s)) return [];
  s = s.replace(/第\s*[\d・、,]+\s*[日月火水木金土]曜?日?/g, ' '); // 第2・4火曜 などは毎週ではない
  s = s.replace(/不定休/g, ' ');
  return [...new Set(dayTokens(normalizeDayWords(s), { closed: true }).flatMap((t) => t.days))];
}

/**
 * 営業しているか．入店 hour（時）から stay 時間いられるか
 * @returns true / false / null（その曜日の営業時間が書かれていない＝不明）
 */
function isOpenAt(byDay, weekday, hour, stay) {
  if (!byDay) return null;
  const today = byDay[weekday];
  const prev = byDay[(weekday + 6) % 7];
  if (today && today.some(([o, c]) => o <= hour && hour + stay <= c)) return true;
  if (prev && prev.some(([o, c]) => c > 24 && o <= hour + 24 && hour + 24 + stay <= c)) return true; // 前日の深夜営業
  return today ? false : null;
}

/** 平均予算 "ディナー：3000円 ランチ：1000円" → { dinner: 3000, lunch: 1000 }．金額の直前・直後のラベルで見分ける */
function parseBudget(average, code, name) {
  const s = toHalf(average).replace(/(\d),(?=\d{3})/g, '$1');
  const re = /(\d{3,6})\s*円?\s*～\s*(\d{3,6})\s*円|(\d{3,6})\s*円/g;
  let dinner = null;
  let lunch = null;
  let party = null;
  let prevEnd = 0;
  let m;
  while ((m = re.exec(s))) {
    const yenValue = m[3] ? Number(m[3]) : Math.round((Number(m[1]) + Number(m[2])) / 2);
    const before = s.slice(prevEnd, m.index);
    const after = s.slice(re.lastIndex, re.lastIndex + 10);
    prevEnd = re.lastIndex;
    if (yenValue < 300 || yenValue > 100000) continue;
    // "1000円（ランチ）" のように後ろに書くラベルを優先．お通し・チャージは予算ではない
    const label = (/^\s*[（(]\s*(ランチ|昼|ディナー|夜|宴会|コース|飲み放題|パーティ|お通し|チャージ|席料)/.exec(after) || [])[1] ||
      (/(ランチ|昼|lunch|ディナー|夜|宴会|コース|飲み放題|パーティ|お通し|チャージ|席料)[^ランチ昼ディナー夜宴会コース飲み放題パーティお通しチャージ席料]*$/i.exec(before) || [])[1] || '';
    if (/お通し|チャージ|席料/.test(label)) continue;
    if (/ランチ|昼|lunch/i.test(label)) lunch = lunch ?? yenValue;
    else if (/宴会|コース|飲み放題|パーティ/.test(label)) party = party ?? yenValue;
    else dinner = dinner ?? yenValue;
  }
  let fromCode = BUDGET_CODE_YEN[code] || null;
  if (!fromCode && name) {
    const r = /(\d{3,6})?\s*～\s*(\d{3,6})?/.exec(toHalf(name).replace(/,/g, ''));
    if (r && (r[1] || r[2])) fromCode = r[1] && r[2] ? Math.round((Number(r[1]) + Number(r[2])) / 2) : Number(r[1] || r[2]);
  }
  return { dinner: dinner ?? party ?? fromCode, lunch, estimated: dinner === null && party === null };
}

/** "あり" / "あり ：…" → true，"なし" → false，それ以外 → null */
function flag(v) {
  if (typeof v !== 'string') return null;
  if (/^\s*あり/.test(v)) return true;
  if (/^\s*なし/.test(v)) return false;
  return null;
}

function parseSmoking(v) {
  const s = String(v || '');
  if (/全面禁煙|全席禁煙/.test(s)) return 'none';
  if (/一部禁煙|分煙/.test(s)) return 'separated';
  if (/禁煙席なし|全席喫煙|喫煙可/.test(s)) return 'allowed';
  return 'unknown';
}

const TAKEOUT_RE = /(テイクアウト|持ち?帰り|takeout|take out)(?![^。、！!]{0,14}(不可|なし|できません|おりません|ていません|しません|NG|×|非対応))/i;

/** http(s) のURLだけを使う（画面のリンク・画像に入れるため） */
const safeUrl = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : '');

const toNum = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** ホットペッパーの shop 要素 → 内部形式 */
function normalizeShop(hp) {
  const budget = hp.budget || {};
  const price = parseBudget(budget.average, budget.code, budget.name);
  const tatami = flag(hp.tatami);
  const horigotatsu = flag(hp.horigotatsu);
  const takeoutText = [hp.name, hp.catch, hp.genre && hp.genre.catch, hp.other_memo, hp.shop_detail_memo].filter(Boolean).join(' ');
  const capacity = toNum(hp.capacity);
  const party = toNum(hp.party_capacity);
  return {
    id: String(hp.id),
    name: String(hp.name || ''),
    lat: Number(hp.lat),
    lng: Number(hp.lng),
    address: hp.address || '',
    access: hp.mobile_access || hp.access || '',
    stationName: hp.station_name || '',
    areaName: (hp.small_area && hp.small_area.name) || (hp.middle_area && hp.middle_area.name) || '',
    genreCode: (hp.genre && hp.genre.code) || '',
    genreName: (hp.genre && hp.genre.name) || '',
    genreCatch: (hp.genre && hp.genre.catch) || '',
    subGenreCode: (hp.sub_genre && hp.sub_genre.code) || '',
    catchText: hp.catch || '',
    price: { dinner: price.dinner, lunch: price.lunch },
    priceEstimated: price.estimated,
    budgetName: budget.name || '',
    openText: hp.open || '',
    closeText: hp.close || '',
    hours: parseOpenHours(hp.open),
    closedDays: parseClosedDays(hp.close),
    maxGroup: Math.max(capacity || 0, party || 0) || null,
    capacity,
    smoking: parseSmoking(hp.non_smoking),
    smokingText: hp.non_smoking || '',
    privateRoom: flag(hp.private_room),
    zashiki: tatami === true || horigotatsu === true ? true : tatami === false && horigotatsu === false ? false : null,
    nomihodai: flag(hp.free_drink),
    takeout: TAKEOUT_RE.test(takeoutText),
    url: safeUrl(hp.urls && hp.urls.pc),
    photo: safeUrl(hp.photo && hp.photo.pc && (hp.photo.pc.m || hp.photo.pc.l)),
    sample: Boolean(hp.sample), // サンプル店舗（架空）
  };
}

module.exports = { toHalf, expandDays, parseOpenHours, parseClosedDays, isOpenAt, parseBudget, parseSmoking, flag, normalizeShop, BUDGET_CODE_YEN };
