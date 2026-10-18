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
  const extLink = (href, text, cls) => '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';

  /** ルームの小カテゴリが既定と違うとき「追加：もつ鍋／削除：バー」 */
  function subChanges(room) {
    const defaults = subsOf(room.category);
    const added = room.subs.filter((s) => s.custom).map((s) => s.label);
    const removed = defaults.filter((d) => !room.subs.some((s) => s.value === d.value)).map((d) => d.label);
    return [added.length ? '追加：' + added.join('・') : '', removed.length ? '削除：' + removed.join('・') : ''].filter(Boolean).join('／');
  }

  /** ルームの条件。詳細設定は「こだわらない」以外のものだけ表示する */
  function roomMeta(room) {
    const row = (k, v) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>';
    const changes = subChanges(room);
    return '<dl class="room-meta">' +
      '<div><dt>場所</dt><dd>' + esc(room.locationName) + (room.centerMapUrl ? ' ' + extLink(room.centerMapUrl, '地図', 'map-link') : '') + '</dd></div>' +
      row('人数', room.people + '人') + row('日時', fmtDatetime(room.datetime)) +
      row('予算', room.budgetLabel) + row('ジャンル', categoryOf(room.category).label) +
      (changes ? row('小カテゴリ', changes) : '') +
      (asksNomihodai(room.category) && room.nomihodai === 'required' ? row('飲み放題', '必須') : '') +
      (room.seat !== 'any' ? row('席', label(OPT.seats, room.seat)) : '') +
      (room.smoking !== 'any' ? row('喫煙', label(OPT.smoking, room.smoking)) : '') +
      (room.takeout === 'want' ? row('テイクアウト', '希望する') : '') + '</dl>';
  }

  /* =========================================================================
   * 予算スライダー：下限・上限の2つのつまみ＋数値欄（500円刻み）
   *   左端（0円）＝下限なし、右端（最大）＝上限なし。数値欄が空なら「指定なし」
   * ====================================================================== */
  function budgetSliderHtml(steps, def) {
    const max = steps[steps.length - 1];
    const step = steps[0];
    const ticks = [];
    for (let v = 0; v <= max; v += 1000) ticks.push(v);
    const tickLabel = (v) => (v === 0 ? '0' : v === max ? max.toLocaleString() + '+' : v % 2000 === 0 ? v.toLocaleString() : '');
    return `
      <div class="budget-slider" id="budget-slider" data-max="${max}" data-step="${step}">
        <div class="budget-inputs">
          <label class="budget-input"><input type="number" id="budget-min" inputmode="numeric" min="0" max="${max}" step="${step}" placeholder="下限なし" aria-label="予算の下限（円）"><span>円</span></label>
          <span class="budget-sep">〜</span>
          <label class="budget-input"><input type="number" id="budget-max" inputmode="numeric" min="0" max="${max}" step="${step}" placeholder="上限なし" aria-label="予算の上限（円）"><span>円</span></label>
        </div>
        <div class="dual-range">
          <div class="dual-track"><div class="dual-fill"></div></div>
          <input type="range" class="dual-min" min="0" max="${max}" step="${step}" value="${def.min || 0}" aria-label="予算の下限">
          <input type="range" class="dual-max" min="0" max="${max}" step="${step}" value="${def.max || max}" aria-label="予算の上限">
        </div>
        <div class="dual-ticks" aria-hidden="true">${ticks.map((v) => '<span style="left:' + (v / max) * 100 + '%"><i></i>' + tickLabel(v) + '</span>').join('')}</div>
      </div>`;
  }

  /** スライダーと数値欄を連動させる。get() で {min, max}（null は指定なし）を返す */
  function initBudgetSlider(root, onChange) {
    const max = Number(root.dataset.max);
    const step = Number(root.dataset.step);
    const rMin = root.querySelector('.dual-min');
    const rMax = root.querySelector('.dual-max');
    const nMin = root.querySelector('#budget-min');
    const nMax = root.querySelector('#budget-max');
    const fill = root.querySelector('.dual-fill');
    const snap = (v) => Math.min(max, Math.max(0, Math.round(v / step) * step));
    const yen = (v) => v.toLocaleString() + '円';

    function render(skip) {
      const a = Number(rMin.value);
      const b = Number(rMax.value);
      fill.style.left = (a / max) * 100 + '%';
      fill.style.right = 100 - (b / max) * 100 + '%';
      if (skip !== nMin) nMin.value = a > 0 ? a : '';
      if (skip !== nMax) nMax.value = b < max ? b : '';
      // 2つのつまみが重なったら、動かせる向きのつまみを上に重ねる
      const minOnTop = a === b && a > max / 2;
      rMin.style.zIndex = minOnTop ? 3 : 2;
      rMax.style.zIndex = minOnTop ? 2 : 3;
      rMin.setAttribute('aria-valuetext', a > 0 ? yen(a) : '下限なし');
      rMax.setAttribute('aria-valuetext', b < max ? yen(b) : '上限なし');
      if (onChange) onChange();
    }
    // つまみ：互いを追い越さない
    rMin.addEventListener('input', () => { if (Number(rMin.value) > Number(rMax.value)) rMin.value = rMax.value; render(); });
    rMax.addEventListener('input', () => { if (Number(rMax.value) < Number(rMin.value)) rMax.value = rMin.value; render(); });
    // 数値欄：入力中はつまみだけ動かし、確定時に500円単位へそろえる。逆転したら相手を押し上げる/下げる
    const fromInput = (input, isMin, commit) => {
      const raw = input.value.trim();
      if (raw !== '' && !Number.isFinite(Number(raw))) return;
      const v = raw === '' ? (isMin ? 0 : max) : snap(Number(raw));
      if (isMin) { rMin.value = v; if (v > Number(rMax.value)) rMax.value = v; }
      else { rMax.value = v; if (v < Number(rMin.value)) rMin.value = v; }
      render(commit ? null : input);
    };
    nMin.addEventListener('input', () => fromInput(nMin, true, false));
    nMax.addEventListener('input', () => fromInput(nMax, false, false));
    nMin.addEventListener('change', () => fromInput(nMin, true, true));
    nMax.addEventListener('change', () => fromInput(nMax, false, true));
    render();

    return {
      get() {
        const a = Number(rMin.value);
        const b = Number(rMax.value);
        return { min: a > 0 ? a : null, max: b < max ? b : null };
      },
    };
  }

  /* Blueskyで共有（認証不要：投稿画面を本文入りで開くだけ。投稿するかは本人が決める） */
  const BSKY_MAX = 300; // Blueskyの1投稿の上限（書記素単位）
  function graphemes(text) {
    if (window.Intl && Intl.Segmenter) return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map((x) => x.segment);
    return [...text];
  }
  /** lines を順に足していき、300文字を超える行は入れない（最後の行＝URLは必ず残す） */
  function bskyText(lines) {
    const url = lines[lines.length - 1];
    const body = [];
    for (const line of lines.slice(0, -1)) {
      if (graphemes([...body, line, url].join('\n')).length > BSKY_MAX) break;
      body.push(line);
    }
    return [...body, url].join('\n');
  }
  const bskyUrl = (lines) => 'https://bsky.app/intent/compose?text=' + encodeURIComponent(bskyText(lines));
  const bskyButton = (lines, text, cls) =>
    '<a class="btn ' + (cls || 'btn-ghost') + ' btn-block btn-bsky" href="' + esc(bskyUrl(lines)) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  const roomTitle = (room) => fmtDatetime(room.datetime) + ' ' + room.locationName + 'で' + categoryOf(room.category).label;
  /** 招待：アンケートへの共有リンク */
  const inviteLines = (room) => [
    '【みんなで店決め】' + roomTitle(room) + 'のお店をアンケートで決めます！',
    'ジャンルの好みをスワイプで 〇ー× 答えるだけ（30秒）',
    room.shareUrl,
  ];
  /** 結果：上位3件とランキングのページ */
  const resultLines = (room, ranking) => [
    '【みんなで店決め】' + roomTitle(room) + 'のお店、結果が出ました！',
    ...ranking.slice(0, 3).map((r) => r.rank + '位 ' + r.name + '（' + r.subLabel + '）'),
    location.origin + '/rooms/' + room.roomId + '/result',
  ];

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
    const sample = OPT.shopSource === 'sample';

    app.innerHTML = `
      <h1>グループのお店を、<br>アンケートで決めよう</h1>
      <p class="lead">条件を入れてルームを作成し、リンクを共有するだけ。全員が回答するとおすすめのお店 TOP5 が表示されます。</p>

      <section class="card join-card">
        <h2>ルームコードで参加</h2>
        <form class="share-box" id="join-form" novalidate>
          <input type="text" id="join-code" maxlength="8" placeholder="例：1f330b6c" autocomplete="off" aria-label="ルームコード">
          <button class="btn btn-secondary" type="submit">参加</button>
        </form>
        <p class="error" id="join-error" hidden></p>
      </section>

      <form class="card" id="create-form" novalidate>
        <h2>ルームを作成</h2>
        <label class="field"><span class="field-label">場所 <small>駅名・地名など</small></span>
          <input type="text" id="location" maxlength="${OPT.locationMax}" placeholder="例：梅田、渋谷駅、京都 河原町" autocomplete="off" required${sample ? ' list="sample-areas" value="梅田"' : ''}>
          ${sample ? '<datalist id="sample-areas">' + OPT.sampleAreas.map((a) => '<option value="' + esc(a) + '">').join('') + '</datalist><span class="muted field-hint">サンプルデータで動作中：' + esc(OPT.sampleAreas.join('・')) + ' などで試せます</span>' : '<span class="muted field-hint">ホットペッパーのキーワード検索で場所を探します</span>'}
        </label>
        <label class="field"><span class="field-label">人数 <small>ホストを含む</small></span>
          <div class="input-suffix"><input type="number" id="people" min="1" max="${OPT.maxPeople}" value="4" required><span>人</span></div>
        </label>
        <label class="field"><span class="field-label">日時</span>
          <input type="datetime-local" id="datetime" step="900" value="${defaultDt}" required>
        </label>
        <fieldset class="field"><legend class="field-label">予算 <small>1人あたり</small></legend>
          ${budgetSliderHtml(OPT.budgetSteps, OPT.defaultBudget)}
        </fieldset>
        <fieldset class="field"><legend class="field-label">ジャンル</legend>
          ${chips('category', OPT.categories, 'radio', 'izakaya')}
        </fieldset>
        <fieldset class="field sub-editor"><legend class="field-label">評価する小カテゴリ <small>このルームだけの設定</small></legend>
          <p class="muted" style="margin:0 0 8px">参加者はこれらをスワイプで 〇ー× 評価します。× で削除、下の欄から追加できます</p>
          <div class="sub-chips" id="sub-chips"></div>
          <div class="sub-removed" id="sub-removed" hidden></div>
          <div class="share-box sub-add">
            <input type="text" id="sub-add-input" maxlength="${OPT.subLabelMax}" placeholder="小カテゴリを追加（例：もつ鍋）" autocomplete="off" aria-label="追加する小カテゴリ">
            <button class="btn btn-ghost" type="button" id="sub-add-btn">追加</button>
          </div>
          <p class="error" id="sub-error" hidden></p>
        </fieldset>

        <div class="field">
          <button class="details-toggle" type="button" id="details-toggle" aria-expanded="false" aria-controls="details">
            <span>詳細設定</span><span class="muted" id="details-summary"></span><span class="chevron" aria-hidden="true"></span>
          </button>
          <div class="details-body" id="details" hidden>
            <fieldset class="field" id="nomihodai-field"><legend class="field-label">飲み放題</legend>${chips('nomihodai', OPT.nomihodai, 'radio', 'any')}</fieldset>
            <fieldset class="field"><legend class="field-label">席の希望</legend>${chips('seat', OPT.seats, 'radio', 'any')}</fieldset>
            <fieldset class="field"><legend class="field-label">禁煙・喫煙 <small>合わないお店は候補から外します</small></legend>${chips('smoking', OPT.smoking, 'radio', 'any')}</fieldset>
            <fieldset class="field" style="margin-bottom:0"><legend class="field-label">テイクアウト <small>紹介文に記載のあるお店を加点</small></legend>${chips('takeout', OPT.takeout, 'radio', 'no')}</fieldset>
          </div>
        </div>
        <p class="error" id="create-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="create-btn">ルームを作成する</button>
      </form>

      <section class="card" id="my-rooms" hidden>
        <h2>この端末で作成したルーム</h2>
        <ul class="room-list" id="my-room-list"></ul>
      </section>

      <ol class="steps">
        <li>ルームを作成して共有リンクを発行</li>
        <li>参加者がジャンルの好みをスワイプで 〇ー× 回答（約30秒）</li>
        <li>全員の回答が揃う、またはホストが締め切るとランキングを表示</li>
      </ol>`;

    const form = document.getElementById('create-form');
    // 詳細設定：閉じているときは「こだわらない」以外の設定を見出しの横に表示
    const showDetailsSummary = () => {
      const fd = new FormData(form);
      const cat = fd.get('category');
      const picks = [];
      if (asksNomihodai(cat) && fd.get('nomihodai') === 'required') picks.push('飲み放題必須');
      if (fd.get('seat') && fd.get('seat') !== 'any') picks.push(label(OPT.seats, fd.get('seat')));
      if (fd.get('smoking') && fd.get('smoking') !== 'any') picks.push(label(OPT.smoking, fd.get('smoking')));
      if (fd.get('takeout') === 'want') picks.push('テイクアウト希望');
      document.getElementById('details-summary').textContent = picks.length ? picks.join('・') : '飲み放題・席・禁煙喫煙・テイクアウト';
    };

    // 小カテゴリの編集：既定のものは削除・復元、自由入力で追加（大カテゴリを変えると既定は元に戻る。追加分は残す）
    const subEdit = { removed: new Set(), custom: [] };
    const subErr = document.getElementById('sub-error');
    const currentCat = () => new FormData(form).get('category');
    const activeSubs = () => [
      ...subsOf(currentCat()).filter((s) => !subEdit.removed.has(s.value)).map((s) => ({ value: s.value, label: s.label })),
      ...subEdit.custom.map((label) => ({ label, custom: true })),
    ];
    const showSubError = (msg) => { subErr.textContent = msg; subErr.hidden = !msg; };
    const renderSubs = () => {
      const defaults = subsOf(currentCat());
      document.getElementById('sub-chips').innerHTML =
        defaults.filter((s) => !subEdit.removed.has(s.value)).map((s) =>
          '<span class="sub-chip"><span>' + esc(s.label) + '</span><button type="button" class="sub-x" data-remove="' + esc(s.value) + '" aria-label="' + esc(s.label) + 'を削除">×</button></span>').join('') +
        subEdit.custom.map((label, i) =>
          '<span class="sub-chip custom"><span>' + esc(label) + '</span><button type="button" class="sub-x" data-remove-custom="' + i + '" aria-label="' + esc(label) + 'を削除">×</button></span>').join('');
      const removed = defaults.filter((s) => subEdit.removed.has(s.value));
      const box = document.getElementById('sub-removed');
      box.hidden = !removed.length;
      box.innerHTML = '<span class="muted">削除したもの：</span>' + removed.map((s) =>
        '<button type="button" class="sub-restore" data-restore="' + esc(s.value) + '" aria-label="' + esc(s.label) + 'を戻す">＋ ' + esc(s.label) + '</button>').join('');
    };
    const addSub = () => {
      const input = document.getElementById('sub-add-input');
      const label = input.value.replace(/\s+/g, ' ').trim();
      if (!label) return;
      const same = (a) => a.toLowerCase() === label.toLowerCase();
      const removedDefault = subsOf(currentCat()).find((s) => subEdit.removed.has(s.value) && same(s.label));
      if (removedDefault) subEdit.removed.delete(removedDefault.value); // 削除した既定と同じ名前なら戻す
      else if (activeSubs().some((s) => same(s.label))) return showSubError('「' + label + '」はすでにあります');
      else if (label.length > OPT.subLabelMax) return showSubError(OPT.subLabelMax + '文字以内で入力してください');
      else if (activeSubs().length >= OPT.maxSubs) return showSubError('小カテゴリは' + OPT.maxSubs + '個までです');
      else subEdit.custom.push(label);
      input.value = '';
      showSubError('');
      renderSubs();
    };
    form.querySelector('.sub-editor').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'sub-add-btn') return addSub();
      if ((b.dataset.remove || b.dataset.removeCustom !== undefined) && activeSubs().length <= 1) return showSubError('小カテゴリを1つ以上残してください');
      if (b.dataset.remove) subEdit.removed.add(b.dataset.remove);
      else if (b.dataset.removeCustom !== undefined) subEdit.custom.splice(Number(b.dataset.removeCustom), 1);
      else if (b.dataset.restore) subEdit.removed.delete(b.dataset.restore);
      else return;
      showSubError('');
      renderSubs();
    });
    document.getElementById('sub-add-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSub(); }
    });
    const toggle = document.getElementById('details-toggle');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      document.getElementById('details').hidden = !open;
    });
    const showSubs = () => {
      const cat = currentCat();
      subEdit.removed.clear();
      showSubError('');
      renderSubs();
      // カフェのときは飲み放題を出さない
      document.getElementById('nomihodai-field').hidden = !!cat && !asksNomihodai(cat);
      showDetailsSummary();
    };
    form.querySelectorAll('input[name=category]').forEach((el) => el.addEventListener('change', showSubs));
    form.querySelectorAll('#details input').forEach((el) => el.addEventListener('change', showDetailsSummary));
    const budgetSlider = initBudgetSlider(document.getElementById('budget-slider'), () => { document.getElementById('create-error').hidden = true; });
    showSubs();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('create-error');
      const btn = document.getElementById('create-btn');
      const fd = new FormData(form);
      const body = {
        location: document.getElementById('location').value.trim(),
        people: Number(document.getElementById('people').value),
        datetime: document.getElementById('datetime').value,
        budgetMin: budgetSlider.get().min,
        budgetMax: budgetSlider.get().max,
        category: fd.get('category'),
        subs: activeSubs().map((s) => (s.custom ? { label: s.label, custom: true } : { value: s.value })),
        nomihodai: fd.get('nomihodai') || 'any',
        seat: fd.get('seat') || 'any',
        smoking: fd.get('smoking') || 'any',
        takeout: fd.get('takeout') || 'no',
      };
      err.hidden = true;
      if (!body.location) { err.textContent = '場所を入力してください'; err.hidden = false; return; }
      if (!Number.isInteger(body.people) || body.people < 1 || body.people > OPT.maxPeople) { err.textContent = '人数は1〜' + OPT.maxPeople + 'の整数で入力してください'; err.hidden = false; return; }
      if (!DATETIME_RE.test(body.datetime)) { err.textContent = '日時を入力してください'; err.hidden = false; return; }
      if (body.budgetMin && body.budgetMax && body.budgetMin > body.budgetMax) { err.textContent = '予算の下限が上限より高くなっています'; err.hidden = false; return; }
      if (!body.category) { err.textContent = 'ジャンルを選択してください'; err.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = '場所を探しています…';
      try {
        const res = await api('/api/rooms', { method: 'POST', body });
        saveHost(res.roomId, res.hostToken);
        navigate('/rooms/' + res.roomId + '/host?token=' + encodeURIComponent(res.hostToken));
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'ルームを作成する';
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
          <p class="muted" style="margin:10px 0 12px">LINE やメールでリンクを送ってください。開くとアンケート画面が表示されます。</p>
          ${closed ? '' : bskyButton(inviteLines(room), 'Blueskyで共有', 'btn-secondary')}
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
   * スワイプ式アンケート：小カテゴリを1枚ずつカードで評価 → 最後に一覧で確認して送信
   *   右スワイプ / 〇 = 好き、上下スワイプ / ー = どちらでもない、左スワイプ / × = 好みじゃない
   *   キーボード：→ 〇 / ↑↓ ー / ← × / Backspace 1つ戻る
   * ====================================================================== */
  const SWIPE_COMMIT_PX = 80; // これ以上動かして離したら確定
  // ボタンの記号（参考デザインに合わせて線で描く）
  const RATE_ICONS = {
    ng: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 9l14 14M23 9L9 23" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>',
    ok: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 16h16" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg>',
    great: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9.5" fill="none" stroke="currentColor" stroke-width="3.4"/></svg>',
  };
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** 画像のない小カテゴリ（ホストが追加したものなど）は文字だけのカード。名前から色を決める */
  function textCardStyle(label) {
    let h = 0;
    for (const ch of label) h = (h * 31 + ch.codePointAt(0)) % 360;
    return 'background:linear-gradient(150deg,hsl(' + h + ' 70% 62%),hsl(' + ((h + 40) % 360) + ' 75% 45%))';
  }
  function cardVisual(sub, imageFor) {
    const src = imageFor(sub);
    return src
      ? '<img class="swipe-img" src="' + esc(src) + '" alt="" draggable="false">'
      : '<div class="swipe-text" style="' + textCardStyle(sub.label) + '"><span>' + esc(sub.label) + '</span></div>';
  }

  /**
   * @param root  描画先
   * @param opts  { subs, ratings, defaultRating, imageFor(sub), header(HTML), categoryLabel, onSubmit({name, ratings}) → Promise }
   * @returns 後片付け用の関数（キーボード操作の解除）
   */
  function runSwipeSurvey(root, opts) {
    const { subs, ratings, defaultRating, imageFor, onSubmit } = opts;
    const byValue = Object.fromEntries(ratings.map((r) => [r.value, r]));
    const answers = {};
    let stage = 'intro'; // intro → cards → confirm
    let index = 0;
    let name = '';
    let busy = false;
    let lastOkDir = -1; //  「どちらでもない」で飛ばす向き（上 -1 / 下 1）

    const btns = () => ratings.slice().sort((a, b) => ['ng', 'ok', 'great'].indexOf(a.value) - ['ng', 'ok', 'great'].indexOf(b.value));
    const legend = '<span><b class="c-great">' + esc(byValue.great.label) + '</b> 右スワイプ＝' + esc(byValue.great.hint) + '</span>' +
      '<span><b class="c-ok">' + esc(byValue.ok.label) + '</b> 上下スワイプ＝' + esc(byValue.ok.hint) + '</span>' +
      '<span><b class="c-ng">' + esc(byValue.ng.label) + '</b> 左スワイプ＝' + esc(byValue.ng.hint) + '</span>';

    function render() {
      if (stage === 'intro') return renderIntro();
      if (stage === 'cards') return renderCard();
      return renderConfirm();
    }

    function renderIntro() {
      root.innerHTML = opts.header + `
        <form class="card" id="intro-form" novalidate>
          <label class="field"><span class="field-label">ニックネーム</span>
            <input type="text" id="nickname" maxlength="20" placeholder="例：たなか" autocomplete="nickname" required value="${esc(name)}">
            <span class="muted" style="display:block;margin-top:4px">同じ名前で再回答すると上書きされます</span>
          </label>
          <p class="field-label" style="margin:0 0 6px">${esc(opts.categoryLabel)}の好みを ${subs.length}枚 のカードで答えます</p>
          <p class="muted swipe-legend">${legend}</p>
          <p class="error" id="intro-error" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">はじめる</button>
        </form>`;
      root.querySelector('#intro-form').addEventListener('submit', (e) => {
        e.preventDefault();
        name = root.querySelector('#nickname').value.trim();
        const err = root.querySelector('#intro-error');
        if (!name) { err.textContent = 'ニックネームを入力してください'; err.hidden = false; return; }
        stage = 'cards';
        index = 0;
        render();
      });
    }

    function renderCard() {
      window.scrollTo(0, 0);
      const sub = subs[index];
      const next = subs[index + 1];
      const prev = answers[sub.value];
      root.innerHTML = `
        <div class="swipe">
          <div class="swipe-top">
            <button class="swipe-back" type="button" id="swipe-back"${index === 0 ? ' disabled' : ''}>‹ 1つ戻る</button>
            <span class="swipe-count">${index + 1} / ${subs.length}</span>
          </div>
          <div class="progress swipe-progress"><div style="width:${(index / subs.length) * 100}%"></div></div>
          <p class="swipe-cat">${esc(opts.categoryLabel)}の好み</p>
          <h1 class="swipe-title" id="swipe-title">${esc(sub.label)}</h1>
          <div class="swipe-stage">
            ${next ? '<div class="swipe-card under" aria-hidden="true">' + cardVisual(next, imageFor) + '</div>' : ''}
            <div class="swipe-card" id="swipe-card" role="group" aria-labelledby="swipe-title" aria-describedby="swipe-help">
              ${cardVisual(sub, imageFor)}
              <span class="stamp stamp-great">${esc(byValue.great.label)} ${esc(byValue.great.hint)}</span>
              <span class="stamp stamp-ok">${esc(byValue.ok.label)} ${esc(byValue.ok.hint)}</span>
              <span class="stamp stamp-ng">${esc(byValue.ng.label)} ${esc(byValue.ng.hint)}</span>
            </div>
          </div>
          <div class="swipe-buttons">${btns().map((r) => `
            <button class="swipe-btn b-${esc(r.value)}${prev === r.value ? ' was' : ''}" type="button" data-rate="${esc(r.value)}" aria-label="${esc(sub.label)}：${esc(r.hint)}（${esc(r.label)}）">
              <span class="mark">${RATE_ICONS[r.value] || esc(r.label)}</span><small>${esc(r.hint)}</small></button>`).join('')}
          </div>
          <p class="muted swipe-legend" id="swipe-help">${legend}</p>
          <p class="visually-hidden" aria-live="polite" id="swipe-live"></p>
        </div>`;
      // 次の画像を先に読み込む
      const after = subs[index + 2];
      if (after && imageFor(after)) new Image().src = imageFor(after);

      const card = root.querySelector('#swipe-card');
      root.querySelector('#swipe-back').onclick = back;
      root.querySelectorAll('.swipe-btn').forEach((b) => { b.onclick = () => commit(b.dataset.rate, 0, -1); });
      attachDrag(card);
    }

    /** カードをドラッグ／スワイプで動かす。離したときの向きで評価を決める */
    function attachDrag(card) {
      let id = null;
      let sx = 0;
      let sy = 0;
      let dx = 0;
      let dy = 0;
      let t0 = 0;
      const intentOf = () => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'great' : 'ng') : 'ok');
      card.addEventListener('pointerdown', (e) => {
        if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
        id = e.pointerId;
        sx = e.clientX; sy = e.clientY; dx = 0; dy = 0; t0 = performance.now();
        card.setPointerCapture(id);
        card.classList.add('dragging');
      });
      card.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        dx = e.clientX - sx;
        dy = e.clientY - sy;
        card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + dx * 0.05 + 'deg)';
        const dist = Math.hypot(dx, dy);
        card.dataset.intent = dist > 12 ? intentOf() : '';
        card.style.setProperty('--stamp', Math.min(1, dist / SWIPE_COMMIT_PX).toFixed(2));
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        card.classList.remove('dragging');
        const dist = Math.hypot(dx, dy);
        const speed = dist / Math.max(1, performance.now() - t0); // px/ms
        if (dist > SWIPE_COMMIT_PX || (dist > 30 && speed > 0.5)) commit(intentOf(), dx, dy);
        else { card.style.transform = ''; card.dataset.intent = ''; }
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
    }

    /** 評価を記録してカードを飛ばし、次へ */
    function commit(value, dx, dy) {
      if (busy || stage !== 'cards') return;
      const sub = subs[index];
      answers[sub.value] = value;
      const live = root.querySelector('#swipe-live');
      if (live) live.textContent = sub.label + '：' + byValue[value].hint;
      const card = root.querySelector('#swipe-card');
      const go = () => { busy = false; index += 1; if (index >= subs.length) stage = 'confirm'; render(); };
      if (!card || reducedMotion()) return go();
      busy = true;
      if (value === 'ok') lastOkDir = dy > 0 ? 1 : -1;
      const x = value === 'great' ? 1 : value === 'ng' ? -1 : 0;
      const y = value === 'ok' ? lastOkDir : 0;
      card.dataset.intent = value;
      card.style.setProperty('--stamp', '1');
      card.style.transition = 'transform 0.28s ease-in, opacity 0.28s ease-in';
      card.style.transform = 'translate(' + (x * window.innerWidth * 1.1 + dx) + 'px,' + (y * window.innerHeight * 0.8 + dy) + 'px) rotate(' + x * 18 + 'deg)';
      card.style.opacity = '0';
      setTimeout(go, 260);
    }

    function back() {
      if (busy) return;
      if (stage === 'confirm') { stage = 'cards'; index = subs.length - 1; return render(); }
      if (index > 0) { index -= 1; render(); }
    }

    function renderConfirm() {
      window.scrollTo(0, 0);
      root.innerHTML = `
        <form class="card" id="confirm-form" novalidate>
          <h2>回答の確認</h2>
          <p class="muted" style="margin:0 0 8px">${esc(opts.categoryLabel)}の好み。変えたいものはここで選び直せます</p>
          <ul class="confirm-list">${subs.map((sub) => `
            <li class="confirm-row" role="radiogroup" aria-label="${esc(sub.label)}">
              <span class="confirm-thumb">${cardVisual(sub, imageFor)}</span>
              <span class="rating-name">${esc(sub.label)}</span>
              <span class="seg">${ratings.map((r) => `<label class="seg-${esc(r.value)}"><input type="radio" name="rate-${esc(sub.value)}" value="${esc(r.value)}"${(answers[sub.value] || defaultRating) === r.value ? ' checked' : ''} aria-label="${esc(sub.label)}：${esc(r.hint)}"><span>${esc(r.label)}</span></label>`).join('')}</span>
            </li>`).join('')}
          </ul>
          <label class="field" style="margin-top:16px"><span class="field-label">ニックネーム</span>
            <input type="text" id="nickname" maxlength="20" required value="${esc(name)}">
          </label>
          <p class="error" id="survey-error" hidden></p>
          <button class="btn btn-primary btn-block" type="submit" id="survey-btn">回答する</button>
          <button class="btn btn-ghost btn-block" type="button" id="redo" style="margin-top:10px">最初からカードで答え直す</button>
        </form>`;
      const form = root.querySelector('#confirm-form');
      form.querySelectorAll('input[type=radio]').forEach((el) => el.addEventListener('change', () => { answers[el.name.slice(5)] = el.value; }));
      root.querySelector('#redo').onclick = () => { stage = 'cards'; index = 0; render(); };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = root.querySelector('#survey-error');
        name = root.querySelector('#nickname').value.trim();
        err.hidden = true;
        if (!name) { err.textContent = 'ニックネームを入力してください'; err.hidden = false; return; }
        const btn = root.querySelector('#survey-btn');
        btn.disabled = true;
        try {
          await onSubmit({ name, ratings: Object.fromEntries(subs.map((s) => [s.value, answers[s.value] || defaultRating])) });
        } catch (ex) {
          err.textContent = ex.message || String(ex);
          err.hidden = false;
          btn.disabled = false;
        }
      });
    }

    // キーボード：→ 好き / ← 好みじゃない / ↑↓ どちらでもない / Backspace 戻る（入力欄では無効）
    const onKey = (e) => {
      if (stage !== 'cards' || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const map = { ArrowRight: 'great', ArrowLeft: 'ng', ArrowUp: 'ok', ArrowDown: 'ok' };
      if (map[e.key]) { e.preventDefault(); commit(map[e.key], 0, e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey);
    render();
    return () => document.removeEventListener('keydown', onKey);
  }

  /* =========================================================================
   * 画面3: アンケート回答（スワイプ式）
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
    // 予算・ジャンル・飲み放題・席・テイクアウトはホストが決定済み。参加者は小カテゴリの好みだけ答える
    stopPolling = runSwipeSurvey(app, {
      subs: room.subs,
      ratings: OPT.ratings,
      defaultRating: OPT.defaultRating,
      imageFor: (sub) => { const m = OPT.foodImages || {}; return m[room.category + '/' + sub.label] || m[sub.label] || null; },
      categoryLabel: categoryOf(room.category).label,
      header: '<h1>お店選びアンケート</h1><p class="lead">カードをスワイプして答えるだけ、約30秒で終わります（' + room.answerCount + '/' + room.people + '人回答済み）</p>' + roomMeta(room),
      onSubmit: async (body) => {
        await api('/api/rooms/' + roomId + '/answers', { method: 'POST', body });
        navigate('/rooms/' + roomId + '/result', { answered: true });
      },
    });
  }

  /* =========================================================================
   * 画面4: ランキング結果
   * ====================================================================== */
  const ariNashi = (v) => (v === true ? 'あり' : v === false ? 'なし' : '不明');

  function renderShop(r, showNomihodai) {
    const price = r.price ? yen(r.price) + (r.priceEstimated ? '前後' : '') : '不明';
    return `
      <article class="card rank-${r.rank}">
        <div class="rank-head">
          <div class="rank-badge">${r.rank}</div>
          <div class="rank-title"><h3>${esc(r.name)}</h3><div class="meta">${esc([r.areaName, r.genreName].filter(Boolean).join('・'))}${r.subLabel ? '<br>小カテゴリ：' + esc(r.subLabel) : ''}</div></div>
          <div class="rank-score"><strong>${r.score.toFixed(1)}</strong><br><span>/ 100点</span></div>
        </div>
        <div class="score-bar"><div style="width:${r.score}%"></div></div>
        <div class="shop-body">
        ${r.photo ? '<img class="shop-photo" src="' + esc(r.photo) + '" alt="" width="64" height="64" loading="lazy" referrerpolicy="no-referrer">' : ''}
        <div class="facts">
          <span>目安 <b>${price}</b>（${r.priceSlot === 'lunch' ? 'ランチ' : 'ディナー'}）</span>
          <span>距離 <b>${fmtDistance(r.distanceKm)}</b></span>
          <span>個室 <b>${ariNashi(r.privateRoom)}</b></span>
          <span>座敷 <b>${ariNashi(r.zashiki)}</b></span>
          ${showNomihodai ? '<span>飲み放題 <b>' + ariNashi(r.nomihodai) + '</b></span>' : ''}
          <span>喫煙 <b>${esc(r.smokingLabel)}</b></span>
          ${r.maxGroup ? '<span>席数 <b>' + r.maxGroup + '</b></span>' : ''}
        </div>
        </div>
        <div class="tags">
          ${r.highlights.good.map((t) => '<span class="tag good">' + esc(t) + '</span>').join('')}
          ${r.highlights.caution.map((t) => '<span class="tag caution">' + esc(t) + '</span>').join('')}
        </div>
        <div class="shop-links">
          ${extLink(r.mapUrl, r.sample ? '地図（サンプルの位置）' : 'Googleマップ', 'btn btn-secondary btn-small')}
          ${r.url ? extLink(r.url, 'ホットペッパー', 'btn btn-ghost btn-small') : ''}
        </div>
        <details class="breakdown">
          <summary>お店の情報・スコアの内訳</summary>
          <dl class="shop-info">
            ${r.openText ? '<div><dt>営業時間</dt><dd>' + esc(r.openText) + '</dd></div>' : ''}
            ${r.closeText ? '<div><dt>定休日</dt><dd>' + esc(r.closeText) + '</dd></div>' : ''}
            ${r.access ? '<div><dt>アクセス</dt><dd>' + esc(r.access) + '</dd></div>' : ''}
            ${r.address ? '<div><dt>住所</dt><dd>' + esc(r.address) + '</dd></div>' : ''}
            ${r.budgetName ? '<div><dt>予算帯</dt><dd>' + esc(r.budgetName) + '</dd></div>' : ''}
          </dl>
          <div class="table-scroll"><table>
            <thead><tr><th>項目</th><th class="num">重み</th><th>評価</th><th class="num">得点</th></tr></thead>
            <tbody>${r.breakdown.map((b) => `
              <tr><td>${esc(b.label)}<div class="note">${esc(b.note)}</div></td>
                <td class="num">${b.weightShare === null ? '加点' : b.weightShare + '%'}</td>
                <td class="bar"><span class="mini-bar"><i style="width:${b.score * 100}%"></i></span>${Math.round(b.score * 100)}%</td>
                <td class="num">${b.weightShare === null ? '+' : ''}${b.points.toFixed(1)}</td></tr>`).join('')}
            </tbody>
          </table></div>
          ${r.penalties.map((p) => '<div class="penalty">ペナルティ：' + esc(p) + '</div>').join('')}
        </details>
      </article>`;
  }

  function renderSummary(s, room) {
    const subs = room.subs.slice().sort((a, b) => s.subPoints[b.value] - s.subPoints[a.value]);
    return `
      <section class="card">
        <h2>みんなの回答まとめ <span class="muted" style="font-weight:400">${s.respondentCount}/${room.people}人・${room.closedReason === 'all_answered' ? '全員回答' : 'ホストが締切'}</span></h2>
        <div class="summary-grid">
          <div class="item wide"><div class="k">${esc(categoryOf(room.category).label)}の評価（${OPT.ratings.map((r) => esc(r.label) + signed(r.points)).join(' ')} の合計）</div>
            <ul class="pt-list">${subs.map((sub) => {
              const c = s.ratingCounts[sub.value];
              const pts = s.subPoints[sub.value];
              return '<li><span>' + esc(sub.label) + '</span><span class="muted">〇' + c.great + ' ー' + c.ok + ' ×' + c.ng + '</span><b class="' + (pts < 0 ? 'neg' : '') + '">' + signed(pts) + '</b></li>';
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
        if (ex.status === 404 || ex.status === 409 || ex.status === 502 || ex.status === 503) {
          showError(ex.message);
          if (ex.status >= 500) app.insertAdjacentHTML('beforeend', '<p><a class="btn btn-primary" href="/rooms/' + roomId + '/result" data-nav>もう一度読み込む</a></p>');
          return true;
        }
        return false; // 一時的な通信エラーは次の更新で再試行
      }
      if (myToken !== navToken) return true;

      // 受付中：待機画面（回答状況が変わったときだけ描き直す）
      if (data.pending) {
        const room = data.room;
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

      const { room, ranking, summary, candidateCount, excluded, source, rangeKm, generatedAt } = data;
      const excludedText = Object.entries(excluded).filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + v + '件').join('・');
      const fetchedAt = new Date(generatedAt);
      const credit = source === 'hotpepper'
        ? '店舗情報：ホットペッパーグルメ（' + (fetchedAt.getMonth() + 1) + '/' + fetchedAt.getDate() + ' ' + fetchedAt.getHours() + ':' + String(fetchedAt.getMinutes()).padStart(2, '0') + ' 時点。最新の情報はお店のページでご確認ください）<br>' +
          '<a class="hp-credit" href="https://webservice.recruit.co.jp/" target="_blank" rel="noopener noreferrer"><img src="https://webservice.recruit.co.jp/banner/hotpepper-s.gif" alt="ホットペッパーグルメ Webサービス" width="135" height="17" title="ホットペッパーグルメ Webサービス"></a><br>Powered by ホットペッパーグルメ Webサービス'
        : '店舗データはすべて架空のサンプルです（ホットペッパーのAPIキーを設定すると実在のお店になります）';
      app.innerHTML = `
        <h1>おすすめのお店 TOP${ranking.length}</h1>
        ${roomMeta(room)}
        ${ranking.length ? ranking.map((r) => renderShop(r, asksNomihodai(room.category))).join('') : '<p class="error">条件に合うお店が見つかりませんでした。場所・日時・人数や小カテゴリを変えて新しいルームを作成してください。</p>'}
        ${ranking.length && ranking.length < 5 ? '<p class="notice">条件に合うお店が5件未満でした。</p>' : ''}
        ${ranking.length ? '<div class="share-row">' + bskyButton(resultLines(room, ranking), '結果をBlueskyで共有', 'btn-secondary') + '</div>' : ''}
        ${renderSummary(summary, room)}
        <p class="footnote">${esc(room.locationName)}から半径${rangeKm}km・候補 ${candidateCount}件から算出${excludedText ? '（除外：' + excludedText + '）' : ''}<br>${credit}</p>
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
