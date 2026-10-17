/**
 * みんなで店決め - フロントエンド（1ページのアプリ）
 *
 *   /                       ルーム作成
 *   /rooms/:id/host?token=  共有リンク表示（ホスト用：回答状況・締め切り）
 *   /r/:id                  アンケート回答（参加者に共有するリンク）
 *   /rooms/:id/result       ランキング結果（受付中は待機表示）
 */
(() => {
  'use strict';

  const app = document.getElementById('app');
  let OPT = null; // GET /api/options の結果
  let stopPolling = null;
  let navToken = 0; // 画面遷移ごとに増える。古い非同期処理が新しい画面を上書きしないための目印

  /* =========================================================================
   * ヘルパー
   * ====================================================================== */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const yen = (n) => '¥' + Number(n).toLocaleString();
  const label = (list, v) => (list.find((o) => o.value === v) || {}).label || v;
  const hourLabel = (h) => Math.floor(h) + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
  const fmtDistance = (km) => (km < 1 ? Math.max(50, Math.round((km * 1000) / 50) * 50) + 'm' : km.toFixed(1) + 'km');
  const signed = (v) => (v > 0 ? '+' + v : String(v));
  const ROOM_ID_RE = /^[0-9a-f]{8}$/;
  const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  function fmtDatetime(s) {
    const [d, t] = s.split('T');
    const [y, m, day] = d.split('-').map(Number);
    return m + '月' + day + '日(' + '日月火水木金土'[new Date(Date.UTC(y, m - 1, day)).getUTCDay()] + ') ' + t;
  }
  const categoryOf = (v) => OPT.categories.find((c) => c.value === v) || { label: v, subs: [] };
  const subsOf = (v) => categoryOf(v).subs;
  const asksNomihodai = (v) => !OPT.categoriesWithoutNomihodai.includes(v);

  function roomMeta(room) {
    const row = (k, v) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>';
    return '<dl class="room-meta">' +
      row('場所', room.locationName) + row('人数', room.people + '人') + row('日時', fmtDatetime(room.datetime)) +
      row('予算', label(OPT.budgets, room.budget)) + row('ジャンル', categoryOf(room.category).label) +
      (asksNomihodai(room.category) ? row('飲み放題', label(OPT.nomihodai, room.nomihodai)) : '') +
      row('席', label(OPT.seats, room.seat)) +
      row('テイクアウト', room.takeout === 'want' ? '希望する' : 'しない') + '</dl>';
  }

  function chips(name, options, type, checked) {
    return '<div class="chips">' + options.map((o) =>
      '<label class="chip"><input type="' + (type || 'radio') + '" name="' + name + '" value="' + esc(o.value) + '"' +
      (o.value === checked ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>').join('') + '</div>';
  }

  async function copyText(input, btn) {
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = 'コピーしました';
    } catch (e) {
      input.focus();
      input.select();
      btn.textContent = '選択しました';
    }
    setTimeout(() => { btn.textContent = 'コピー'; }, 1600);
  }

  /** fn が true を返すまで interval ごとに実行（画面を離れると止まる） */
  function poll(fn, interval = 4000) {
    let timer = null;
    let stopped = false;
    const tick = async () => {
      let done = false;
      try { done = await fn(); } catch (e) { console.error(e); }
      if (!done && !stopped) timer = setTimeout(tick, interval);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }

  function showError(msg) {
    app.innerHTML = '<p class="error">' + esc(msg) + '</p><p><a class="btn btn-ghost" href="/" data-nav>トップへ戻る</a></p>';
  }

  /* =========================================================================
   * API
   * ====================================================================== */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || '通信エラーが起きました（' + res.status + '）');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ホスト用トークン（この端末で作成したルーム）。ブラウザに保存して締め切り操作に使う */
  const HOSTS_KEY = 'mise-kime-hosts';
  function loadHosts() {
    try { return JSON.parse(localStorage.getItem(HOSTS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveHost(roomId, token) {
    const hosts = loadHosts();
    hosts[roomId] = { token, savedAt: Date.now() };
    const recent = Object.entries(hosts).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 20);
    try { localStorage.setItem(HOSTS_KEY, JSON.stringify(Object.fromEntries(recent))); } catch (e) { /* 保存できなくても動く */ }
  }
  const hostTokenOf = (roomId) => (loadHosts()[roomId] || {}).token || null;
  const hostPath = (roomId) => '/rooms/' + roomId + '/host?token=' + encodeURIComponent(hostTokenOf(roomId) || '');

  /* =========================================================================
   * 画面遷移
   * ====================================================================== */
  function navigate(path, opts) {
    history.pushState(null, '', path);
    route(opts);
  }
  window.addEventListener('popstate', () => route());
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });

  function route(opts = {}) {
    if (stopPolling) { stopPolling(); stopPolling = null; }
    navToken += 1;
    window.scrollTo(0, 0);
    const p = location.pathname;
    let m;
    if ((m = /^\/r\/([0-9a-f]{8})\/?$/.exec(p))) return viewSurvey(m[1]);
    if ((m = /^\/rooms\/([0-9a-f]{8})\/host\/?$/.exec(p))) {
      const token = new URLSearchParams(location.search).get('token');
      if (token) saveHost(m[1], token);
      return viewHost(m[1]);
    }
    if ((m = /^\/rooms\/([0-9a-f]{8})\/result\/?$/.exec(p))) return viewResult(m[1], opts);
    if (p !== '/') history.replaceState(null, '', '/');
    return viewHome();
  }

  /* =========================================================================
   * 画面1: ルーム作成
   * ====================================================================== */
  function viewHome() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const defaultDt = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T19:00';
    const cities = [...new Set(OPT.areas.map((a) => a.city))];

    app.innerHTML = `
      <h1>グループのお店を、<br>アンケートで決めよう</h1>
      <p class="lead">条件を入れてルームを作成し、リンクを共有するだけ。全員が回答するとおすすめのお店 TOP5 が表示されます。</p>

      <form class="card" id="create-form" novalidate>
        <h2>ルームを作成</h2>
        <label class="field"><span class="field-label">場所</span>
          <select id="location" required>
            ${cities.map((c) => '<optgroup label="' + esc(c) + '">' + OPT.areas.filter((a) => a.city === c).map((a) => '<option value="' + esc(a.id) + '"' + (a.id === 'umeda' ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</optgroup>').join('')}
          </select>
        </label>
        <label class="field"><span class="field-label">人数 <small>ホストを含む</small></span>
          <div class="input-suffix"><input type="number" id="people" min="1" max="${OPT.maxPeople}" value="4" required><span>人</span></div>
        </label>
        <label class="field"><span class="field-label">日時</span>
          <input type="datetime-local" id="datetime" step="900" value="${defaultDt}" required>
        </label>
        <fieldset class="field"><legend class="field-label">予算 <small>1人あたり</small></legend>${chips('budget', OPT.budgets, 'radio', '3000-5000')}</fieldset>
        <fieldset class="field"><legend class="field-label">ジャンル</legend>
          ${chips('category', OPT.categories, 'radio', 'izakaya')}
          <p class="muted" id="sub-preview" style="margin:8px 0 0"></p>
        </fieldset>
        <fieldset class="field" id="nomihodai-field"><legend class="field-label">飲み放題</legend>${chips('nomihodai', OPT.nomihodai, 'radio', 'any')}</fieldset>
        <fieldset class="field"><legend class="field-label">席の希望</legend>${chips('seat', OPT.seats, 'radio', 'any')}</fieldset>
        <fieldset class="field"><legend class="field-label">テイクアウト</legend>${chips('takeout', OPT.takeout, 'radio', 'no')}</fieldset>
        <p class="error" id="create-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="create-btn">ルームを作成する</button>
      </form>

      <section class="card">
        <h2>ルームコードで参加</h2>
        <form class="share-box" id="join-form" novalidate>
          <input type="text" id="join-code" maxlength="8" placeholder="例：1f330b6c" autocomplete="off" aria-label="ルームコード">
          <button class="btn btn-secondary" type="submit">参加</button>
        </form>
        <p class="error" id="join-error" hidden></p>
      </section>

      <section class="card" id="my-rooms" hidden>
        <h2>この端末で作成したルーム</h2>
        <ul class="room-list" id="my-room-list"></ul>
      </section>

      <ol class="steps">
        <li>ルームを作成して共有リンクを発行</li>
        <li>参加者がジャンルの好みを ◎〇× で回答（約30秒）</li>
        <li>全員の回答が揃う、またはホストが締め切るとランキングを表示</li>
      </ol>`;

    const form = document.getElementById('create-form');
    const showSubs = () => {
      const cat = new FormData(form).get('category');
      document.getElementById('sub-preview').textContent = cat
        ? '参加者は「' + subsOf(cat).map((s) => s.label).join('・') + '」をそれぞれ ◎〇× で評価します'
        : '';
      // カフェのときは飲み放題を出さない
      document.getElementById('nomihodai-field').hidden = !!cat && !asksNomihodai(cat);
    };
    form.querySelectorAll('input[name=category]').forEach((el) => el.addEventListener('change', showSubs));
    showSubs();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('create-error');
      const btn = document.getElementById('create-btn');
      const fd = new FormData(form);
      const body = {
        location: document.getElementById('location').value,
        people: Number(document.getElementById('people').value),
        datetime: document.getElementById('datetime').value,
        budget: fd.get('budget'),
        category: fd.get('category'),
        nomihodai: fd.get('nomihodai') || 'any',
        seat: fd.get('seat') || 'any',
        takeout: fd.get('takeout'),
      };
      err.hidden = true;
      if (!Number.isInteger(body.people) || body.people < 1 || body.people > OPT.maxPeople) { err.textContent = '人数は1〜' + OPT.maxPeople + 'の整数で入力してください'; err.hidden = false; return; }
      if (!DATETIME_RE.test(body.datetime)) { err.textContent = '日時を入力してください'; err.hidden = false; return; }
      if (!body.budget || !body.category || !body.takeout) { err.textContent = '予算・ジャンル・テイクアウトを選択してください'; err.hidden = false; return; }
      btn.disabled = true;
      try {
        const res = await api('/api/rooms', { method: 'POST', body });
        saveHost(res.roomId, res.hostToken);
        navigate('/rooms/' + res.roomId + '/host?token=' + encodeURIComponent(res.hostToken));
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    });

    document.getElementById('join-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('join-code').value.trim().toLowerCase();
      const err = document.getElementById('join-error');
      err.hidden = true;
      if (!ROOM_ID_RE.test(code)) { err.textContent = 'ルームコードは英数字8文字です'; err.hidden = false; return; }
      try {
        const room = await api('/api/rooms/' + code);
        navigate(room.status === 'open' ? '/r/' + code : '/rooms/' + code + '/result');
      } catch (ex) {
        err.textContent = ex.status === 404 ? 'そのコードのルームは見つかりませんでした' : ex.message;
        err.hidden = false;
      }
    });

    renderMyRooms(navToken);
  }

  async function renderMyRooms(token) {
    const ids = Object.entries(loadHosts()).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 8).map(([id]) => id);
    const rooms = (await Promise.all(ids.map((id) => api('/api/rooms/' + id).catch(() => null)))).filter(Boolean);
    if (token !== navToken || !rooms.length) return;
    const list = document.getElementById('my-room-list');
    list.innerHTML = rooms.map((r) =>
      '<li><a class="room-row" href="' + esc(hostPath(r.roomId)) + '" data-nav><span>' + esc(r.locationName) + '・' + esc(categoryOf(r.category).label) + '・' + r.people + '人・' + fmtDatetime(r.datetime) + '</span>' +
      '<span class="pill ' + (r.status === 'open' ? 'open">受付中 ' + r.answerCount + '/' + r.people : 'closed">結果あり') + '</span></a></li>').join('');
    document.getElementById('my-rooms').hidden = false;
  }

  /* =========================================================================
   * 画面2: 共有リンク表示（ホスト用）
   * ====================================================================== */
  function viewHost(roomId) {
    app.innerHTML = '<p class="muted">読み込み中…</p>';
    const token = hostTokenOf(roomId);
    let latest = null;
    let confirming = false;
    let busy = false;
    let message = '';
    let lastKey = '';

    const render = () => {
      const room = latest;
      const closed = room.status === 'closed';
      const pct = Math.min(100, Math.round((room.answerCount / room.people) * 100));
      app.innerHTML = `
        <h1>${closed ? '締め切りました' : 'ルームを作成しました'}</h1>
        ${roomMeta(room)}
        <section class="card">
          <h2>参加者に共有する</h2>
          <div class="share-box"><input type="text" id="share-url" value="${esc(room.shareUrl)}" readonly aria-label="共有リンク"><button class="btn btn-primary" type="button" id="copy-url">コピー</button></div>
          <p class="muted" style="margin:10px 0 4px">ルームコード</p>
          <div class="share-box"><input type="text" id="room-code" class="code" value="${esc(room.roomId)}" readonly aria-label="ルームコード"><button class="btn btn-ghost" type="button" id="copy-code">コピー</button></div>
          <p class="muted" style="margin:10px 0 0">LINE やメールでリンクを送ってください。開くとアンケート画面が表示されます。</p>
        </section>

        <section class="card">
          <div class="progress-label"><h2 style="margin:0">回答状況</h2><div><strong>${room.answerCount}</strong> / ${room.people}人</div></div>
          <div class="progress"><div style="width:${pct}%"></div></div>
          <div class="name-list">${room.respondents.map((n) => '<span>' + esc(n) + '</span>').join('') || '<span class="muted">まだ回答はありません</span>'}</div>
          ${closed ? '' : '<p class="muted" style="margin:12px 0 0">全員が回答すると自動で締め切られます（自動更新中）</p>'}
        </section>

        <div class="btn-row">
          ${closed
            ? '<a class="btn btn-primary btn-block" href="/rooms/' + room.roomId + '/result" data-nav>ランキングを見る</a>'
            : '<a class="btn btn-secondary btn-block" href="/r/' + room.roomId + '" data-nav>自分もアンケートに回答する</a>' +
              (token
                ? (confirming
                  ? `<div class="card" style="margin:0"><p style="margin:0 0 12px">回答は${room.answerCount}/${room.people}人です。締め切ってランキングを出しますか？</p><div class="btn-pair"><button class="btn btn-ghost" type="button" id="cancel-close">戻る</button><button class="btn btn-primary" type="button" id="do-close" ${busy ? 'disabled' : ''}>締め切る</button></div></div>`
                  : `<button class="btn btn-primary btn-block" type="button" id="close" ${room.answerCount ? '' : 'disabled'}>締め切ってランキングを出す</button>`)
                : '')}
        </div>
        ${message ? '<p class="error">' + esc(message) + '</p>' : ''}
        ${token && !closed ? '<p class="notice" style="margin-top:16px">このページはホスト専用のURLです（締め切りボタン付き）。後から操作できるよう、ブックマークしておいてください。</p>' : ''}
        ${!token ? '<p class="notice" style="margin-top:16px">締め切りはルームを作成した人（ホスト）だけが操作できます。</p>' : ''}
        ${token && !closed && OPT.demoTools ? `
        <div class="demo-box">
          <h3>動作確認用</h3>
          <p class="muted" style="margin:0 0 10px">ランダムなサンプル回答を追加して、1人でも流れを試せます。</p>
          <button class="btn btn-ghost btn-small" type="button" id="add-sample" ${busy ? 'disabled' : ''}>サンプル回答を1件追加</button>
        </div>` : ''}`;

      const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
      on('copy-url', (e) => copyText(document.getElementById('share-url'), e.currentTarget));
      on('copy-code', (e) => copyText(document.getElementById('room-code'), e.currentTarget));
      on('close', () => { confirming = true; render(); });
      on('cancel-close', () => { confirming = false; render(); });
      on('do-close', async () => {
        busy = true; message = ''; render();
        try {
          await api('/api/rooms/' + roomId + '/close', { method: 'POST', body: { hostToken: token } });
          navigate('/rooms/' + roomId + '/result');
        } catch (ex) {
          busy = false; message = ex.message; render();
        }
      });
      on('add-sample', async () => {
        busy = true; message = ''; render();
        try {
          const res = await api('/api/rooms/' + roomId + '/sample-answer', { method: 'POST', body: { hostToken: token } });
          latest = res.room;
        } catch (ex) {
          message = ex.message;
        }
        busy = false;
        render();
      });
    };

    const myToken = navToken;
    stopPolling = poll(async () => {
      try {
        const room = await api('/api/rooms/' + roomId);
        if (myToken !== navToken) return true;
        latest = room;
        const key = JSON.stringify([room.status, room.respondents]);
        if (key !== lastKey && !busy) { lastKey = key; render(); }
        return room.status === 'closed';
      } catch (ex) {
        if (myToken !== navToken) return true;
        if (ex.status === 404) { showError(ex.message); return true; }
        return false; // 一時的な通信エラーは次の更新で再試行
      }
    });
  }

  /* =========================================================================
   * 画面3: アンケート回答
   * ====================================================================== */
  async function viewSurvey(roomId) {
    app.innerHTML = '<p class="muted">読み込み中…</p>';
    const myToken = navToken;
    let room;
    try {
      room = await api('/api/rooms/' + roomId);
    } catch (ex) {
      if (myToken === navToken) showError(ex.message);
      return;
    }
    if (myToken !== navToken) return;
    if (room.status !== 'open') {
      app.innerHTML = '<h1>アンケートは締め切られました</h1>' + roomMeta(room) + '<a class="btn btn-primary btn-block" href="/rooms/' + roomId + '/result" data-nav>ランキングを見る</a>';
      return;
    }
    const subs = subsOf(room.category);
    const catLabel = categoryOf(room.category).label;

    // 予算・ジャンル・飲み放題・席・テイクアウトはホストが決定済み。参加者は小カテゴリの好みだけ答える
    app.innerHTML = `
      <h1>お店選びアンケート</h1>
      <p class="lead">選ぶだけ、約30秒で終わります（${room.answerCount}/${room.people}人回答済み）</p>
      ${roomMeta(room)}
      <form class="card" id="survey-form" novalidate>
        <label class="field"><span class="field-label">ニックネーム</span>
          <input type="text" id="nickname" name="name" maxlength="20" placeholder="例：たなか" autocomplete="nickname" required>
          <span class="muted" style="display:block;margin-top:4px">同じ名前で再回答すると上書きされます</span>
        </label>
        <fieldset class="field"><legend class="field-label">${esc(catLabel)}の中の好み</legend>
          <p class="muted rating-legend">${OPT.ratings.map((r) => '<span>' + esc(r.label) + ' ' + esc(r.hint) + '（' + signed(r.points) + '）</span>').join('')}</p>
          <p class="muted" style="margin:0 0 8px">最初は全部 〇 です。変えたいものだけ選び直してください</p>
          <div class="rating-list">${subs.map((sub) => `
            <div class="rating-row" role="radiogroup" aria-label="${esc(sub.label)}">
              <span class="rating-name">${esc(sub.label)}</span>
              <span class="seg">${OPT.ratings.map((r) => `<label class="seg-${esc(r.value)}"><input type="radio" name="rate-${esc(sub.value)}" value="${esc(r.value)}"${r.value === OPT.defaultRating ? ' checked' : ''} aria-label="${esc(sub.label)}：${esc(r.label)} ${esc(r.hint)}"><span>${esc(r.label)}</span></label>`).join('')}</span>
            </div>`).join('')}
          </div>
        </fieldset>
        <p class="error" id="survey-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="survey-btn">回答する</button>
      </form>`;

    const form = document.getElementById('survey-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('survey-error');
      const fd = new FormData(form);
      const body = {
        name: String(fd.get('name') || '').trim(),
        ratings: Object.fromEntries(subs.map((s) => [s.value, fd.get('rate-' + s.value) || OPT.defaultRating])),
      };
      err.hidden = true;
      if (!body.name) { err.textContent = 'ニックネームを入力してください'; err.hidden = false; return; }
      const btn = document.getElementById('survey-btn');
      btn.disabled = true;
      try {
        await api('/api/rooms/' + roomId + '/answers', { method: 'POST', body });
        navigate('/rooms/' + roomId + '/result', { answered: true });
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    });
  }

  /* =========================================================================
   * 画面4: ランキング結果
   * ====================================================================== */
  function renderShop(r) {
    return `
      <article class="card rank-${r.rank}">
        <div class="rank-head">
          <div class="rank-badge">${r.rank}</div>
          <div class="rank-title"><h3>${esc(r.name)}</h3><div class="meta">${esc(r.areaName)}・${esc(r.subLabel)}（${esc(r.categoryLabel)}）</div></div>
          <div class="rank-score"><strong>${r.score.toFixed(1)}</strong><br><span>/ 100点</span></div>
        </div>
        <div class="score-bar"><div style="width:${r.score}%"></div></div>
        <div class="facts">
          <span>目安 <b>${yen(r.price)}</b>（${r.priceSlot === 'lunch' ? 'ランチ' : 'ディナー'}）</span>
          <span>距離 <b>${fmtDistance(r.distanceKm)}</b></span>
          <span>評価 <b>★${r.rating.toFixed(1)}</b></span>
          <span>営業 <b>${hourLabel(r.hours.open)}〜${hourLabel(r.hours.close)}</b></span>
          <span>席 <b>${r.seats.map((t) => esc(label(OPT.seats, t))).join('・')}</b></span>
          <span>最大 <b>${r.maxGroup}名</b></span>
        </div>
        <div class="tags">
          ${r.highlights.good.map((t) => '<span class="tag good">' + esc(t) + '</span>').join('')}
          ${r.highlights.caution.map((t) => '<span class="tag caution">' + esc(t) + '</span>').join('')}
        </div>
        <details class="breakdown">
          <summary>スコアの内訳を見る</summary>
          <div class="table-scroll"><table>
            <thead><tr><th>項目</th><th class="num">重み</th><th>評価</th><th class="num">得点</th></tr></thead>
            <tbody>${r.breakdown.map((b) => `
              <tr><td>${esc(b.label)}<div class="note">${esc(b.note)}</div></td>
                <td class="num">${b.weightShare}%</td>
                <td class="bar"><span class="mini-bar"><i style="width:${b.score * 100}%"></i></span>${Math.round(b.score * 100)}%</td>
                <td class="num">${b.points.toFixed(1)}</td></tr>`).join('')}
            </tbody>
          </table></div>
          ${r.penalties.map((p) => '<div class="penalty">ペナルティ：' + esc(p) + '</div>').join('')}
        </details>
      </article>`;
  }

  function renderSummary(s, room) {
    const subs = subsOf(room.category).slice().sort((a, b) => s.subPoints[b.value] - s.subPoints[a.value]);
    return `
      <section class="card">
        <h2>みんなの回答まとめ <span class="muted" style="font-weight:400">${s.respondentCount}/${room.people}人・${room.closedReason === 'all_answered' ? '全員回答' : 'ホストが締切'}</span></h2>
        <div class="summary-grid">
          <div class="item wide"><div class="k">${esc(categoryOf(room.category).label)}の評価（◎+2 〇+1 ×−2 の合計）</div>
            <ul class="pt-list">${subs.map((sub) => {
              const c = s.ratingCounts[sub.value];
              const pts = s.subPoints[sub.value];
              return '<li><span>' + esc(sub.label) + '</span><span class="muted">◎' + c.great + ' 〇' + c.ok + ' ×' + c.ng + '</span><b class="' + (pts < 0 ? 'neg' : '') + '">' + signed(pts) + '</b></li>';
            }).join('')}</ul></div>
        </div>
        <p class="muted" style="margin:12px 0 0">回答者：${s.respondents.map(esc).join('、')}</p>
      </section>`;
  }

  function viewResult(roomId, opts = {}) {
    app.innerHTML = '<p class="muted">読み込み中…</p>';
    const myToken = navToken;
    let lastKey = '';
    stopPolling = poll(async () => {
      let data;
      try {
        data = await api('/api/rooms/' + roomId + '/result');
      } catch (ex) {
        if (myToken !== navToken) return true;
        if (ex.status === 409 && ex.data && ex.data.room) {
          const room = ex.data.room;
          const key = room.respondents.join('|') + room.status;
          if (key !== lastKey) {
            lastKey = key;
            const pct = Math.min(100, Math.round((room.answerCount / room.people) * 100));
            const isHost = !!hostTokenOf(roomId);
            app.innerHTML = `
              ${opts.answered ? '<p class="notice">回答ありがとうございました！</p>' : ''}
              <section class="card waiting">
                <div class="spinner"></div>
                <h2>みんなの回答を待っています</h2>
                <p class="muted">全員が回答する、またはホストが締め切るとランキングが表示されます（自動更新）</p>
                <div class="progress-label" style="margin-top:16px"><span>回答状況</span><div><strong>${room.answerCount}</strong> / ${room.people}人</div></div>
                <div class="progress"><div style="width:${pct}%"></div></div>
                <div class="name-list" style="justify-content:center">${room.respondents.map((n) => '<span>' + esc(n) + '</span>').join('')}</div>
              </section>
              ${roomMeta(room)}
              <div class="btn-row">
                ${opts.answered ? '' : '<a class="btn btn-secondary btn-block" href="/r/' + roomId + '" data-nav>アンケートに回答する</a>'}
                ${isHost ? '<a class="btn btn-ghost btn-block" href="' + esc(hostPath(roomId)) + '" data-nav>ホスト画面へ（締め切り・共有）</a>' : ''}
              </div>`;
          }
          return false;
        }
        if (ex.status === 404) { showError(ex.message); return true; }
        return false;
      }
      if (myToken !== navToken) return true;

      const { room, ranking, summary, candidateCount, excluded } = data;
      const excludedText = Object.entries(excluded).filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + v + '件').join('・');
      app.innerHTML = `
        <h1>おすすめのお店 TOP${ranking.length}</h1>
        ${roomMeta(room)}
        ${ranking.length ? ranking.map(renderShop).join('') : '<p class="error">条件に合うお店が見つかりませんでした。日時や人数を変えて新しいルームを作成してください。</p>'}
        ${ranking.length && ranking.length < 5 ? '<p class="notice">条件に合うお店が5件未満でした。</p>' : ''}
        ${renderSummary(summary, room)}
        <p class="footnote">候補 ${candidateCount}件から算出${excludedText ? '（除外：' + excludedText + '）' : ''}<br>店舗データはすべて架空のモックデータです</p>
        <a class="btn btn-ghost btn-block" href="/" data-nav>新しいルームを作る</a>`;
      return true;
    });
  }

  /* =========================================================================
   * 起動
   * ====================================================================== */
  async function start() {
    for (let i = 0; i < 3; i += 1) {
      try {
        OPT = await api('/api/options');
        break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!OPT) {
      app.innerHTML = '<p class="error">サーバーに接続できませんでした。少し待ってから再読み込みしてください。</p>';
      return;
    }
    route();
  }
  start();
})();
