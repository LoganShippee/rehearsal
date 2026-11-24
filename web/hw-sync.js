'use strict';
/* Rehearsal web sign-in gate + account backup.
   Only active in the BROWSER version (not the Mac/Windows apps). Teachers must sign in (Google or email code,
   the same Online Homework teacher account) and their settings, classes, schedules and events are backed up
   to that account. Library files (PDFs, audio, images) stay on this device and are never uploaded.
   Local-first: the app always works from the copy on this device, so it keeps working offline.
   Server contract: GET/PUT /api/teacher/data (see tools/hw-worker). Sign-in sends syncOnly:true so signing in here
   does not start the 30-day Online Homework trial (it starts the first time the teacher uses Online Homework).
   Skipped on localhost (so the recorder and local testing work) unless ?gate=1, and always skipped with ?demo=1.
   A ?t= token only skips the gate on localhost (the Mac app's own server), never on the public website. */
(function () {
  const api = window.HW_TEACHER_API;
  if (!api) return;

  const QS = new URLSearchParams(location.search);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const native = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
  const hasServer = isLocalHost && location.protocol.startsWith('http') && !!QS.get('t');
  const gateOn = !native && !hasServer && QS.get('demo') !== '1' && (!isLocalHost || QS.get('gate') === '1');
  if (!gateOn) return;

  const META_KEY = 'rehearsal-hw-sync';
  const DEMO_SERVER_KEY = 'rehearsal-hw-sync-demo-server';   // stands in for the server when no worker is reachable (?hwApi=demo)
  const MAX_BYTES = 1400000;
  const PUSH_DELAY = 4000;

  let state = 'checking';       // checking | signedout | ready
  let chipState = 'idle';       // idle | saving | saved | offline | error | toolarge
  let me = null, meta = loadMeta(), pushTimer = null, pushing = false, dirty = false;
  let restorePending = null;    // the open restore question (a promise), so only one is ever shown and no push runs meanwhile
  let overlay = null, chip = null, ui = { step: 'start', email: '', code: '', busy: false, error: '', notice: '', handoff: null };

  function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch { return {}; } }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { } }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- what gets backed up
  function snapshot() {
    if (typeof S === 'undefined' || !S) return null;
    const copy = JSON.parse(JSON.stringify(S));
    delete copy.files;                                  // library file info stays on this device
    return copy;
  }

  // ---------- server calls (real worker, or a local stand-in in preview mode)
  async function remote(method, body) {
    if (api.isDemoMode()) {
      let srv = {}; try { srv = JSON.parse(localStorage.getItem(DEMO_SERVER_KEY) || '{}') || {}; } catch { }
      if (method === 'GET') return { ok: true, status: 200, data: srv.data || null, rev: srv.rev || 0 };
      if ((srv.rev || 0) !== (body.baseRev || 0)) return { ok: false, status: 409, rev: srv.rev, data: srv.data };
      const next = { data: body.data, rev: (srv.rev || 0) + 1 };
      try { localStorage.setItem(DEMO_SERVER_KEY, JSON.stringify(next)); } catch { }
      return { ok: true, status: 200, rev: next.rev };
    }
    if (api.isOffline()) return { ok: false, offline: true, status: 0 };
    try {
      const res = await fetch(`${api.getApiBase()}/api/teacher/data`, {
        method,
        headers: { Authorization: `Bearer ${api.getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, ...j };
    } catch { return { ok: false, offline: true, status: 0 }; }
  }

  // ---------- push (debounced, called from saveNow)
  function changed() {
    if (state !== 'ready') return;
    dirty = true;
    if (restorePending) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
    setChip('saving');
  }

  async function push() {
    if (state !== 'ready' || pushing || restorePending) return;
    const data = snapshot(); if (!data) return;
    const json = JSON.stringify(data);
    if (json === meta.hash) { dirty = false; setChip('saved'); return; }
    if (json.length > MAX_BYTES) { setChip('toolarge'); return; }
    pushing = true;
    const r = await remote('PUT', { data, baseRev: meta.rev || 0 });
    pushing = false;
    if (r.ok) {
      meta.rev = r.rev; meta.hash = json; saveMeta();
      dirty = false; setChip('saved');
      if (JSON.stringify(snapshot()) !== json) changed();   // edited while we were saving
    } else if (r.status === 409) {
      await offerRestore(r.data, r.rev, true);
    } else if (r.status === 401) {
      signedOut('Your sign-in expired. Please sign in again.');
    } else {
      setChip(r.offline ? 'offline' : 'error');
      clearTimeout(pushTimer); pushTimer = setTimeout(push, 60000);   // try again in a minute
    }
  }

  // ---------- pull after sign-in / on load
  async function syncDown() {
    const r = await remote('GET');
    if (r.status === 401) return signedOut('Your sign-in expired. Please sign in again.');
    if (!r.ok) { setChip(r.offline ? 'offline' : 'error'); return; }
    const mine = JSON.stringify(snapshot());
    if (!r.data) { meta.rev = r.rev || 0; saveMeta(); return push(); }          // nothing on the account yet: back up this device
    if (JSON.stringify(r.data) === mine) { meta.rev = r.rev; meta.hash = mine; saveMeta(); return setChip('saved'); }
    const fresh = typeof IS_FRESH_INSTALL !== 'undefined' && IS_FRESH_INSTALL;
    if (fresh || (r.rev || 0) > (meta.rev || 0)) return offerRestore(r.data, r.rev, false);
    return push();
  }

  function offerRestore(serverData, rev, conflict) {
    if (restorePending) return restorePending;          // one question at a time
    // A copy that is not a real saved document must never replace what is on this device.
    const valid = serverData && typeof serverData === 'object' && !Array.isArray(serverData) && (serverData.classes || serverData.settings);
    if (!valid) { meta.rev = rev || 0; saveMeta(); return push(); }
    const fresh = typeof IS_FRESH_INSTALL !== 'undefined' && IS_FRESH_INSTALL;
    restorePending = new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'hws-modal';
      // On a brand-new install this device only holds sample data, so overwriting the account is never offered.
      m.innerHTML = `<div class="hws-card" role="dialog" aria-modal="true" aria-labelledby="hws-rt">
        <h2 id="hws-rt">Restore from your account?</h2>
        <p>${conflict ? 'Your account has a newer saved copy than this device.' : 'Your account has saved classes and schedules.'} Restoring replaces the classes, schedules and settings on this device. Your library files stay as they are.</p>
        <div class="hws-row"><button class="hws-btn hws-primary" data-a="restore">Restore from my account</button>
        ${fresh ? '' : '<button class="hws-btn" data-a="keep">Keep this device instead</button>'}</div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', async e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'keep' && !confirm('Replace the copy saved in your account with what is on this device? The saved copy in your account will be lost.')) return;
        m.remove();
        if (a === 'restore') {
          try { const cur = localStorage.getItem('rehearsal'); if (cur) localStorage.setItem('rehearsal-pre-restore', cur); } catch { }   // so a restore can be undone
          const d = JSON.parse(JSON.stringify(serverData));
          d.files = (typeof S !== 'undefined' && S && S.files) || {};
          try { localStorage.setItem('rehearsal', JSON.stringify(d)); } catch { }
          meta.rev = rev; meta.hash = JSON.stringify(serverData); saveMeta();
          window.__noSave = true;                       // don't overwrite the restored copy while reloading
          location.reload();
        } else {
          meta.rev = rev || 0; saveMeta();
          restorePending = null;
          await push();
        }
        restorePending = null;
        resolve();
      });
      m.querySelector('[data-a=restore]').focus();
    });
    return restorePending;
  }

  // ---------- sign-in gate
  function css() {
    if (document.getElementById('hws-css')) return;
    const st = document.createElement('style'); st.id = 'hws-css';
    st.textContent = `
    :root{--hws-bg:#f6f4ef;--hws-card:#fff;--hws-ink:#1c1b19;--hws-mut:#6b675f;--hws-line:#ddd8cc;--hws-acc:#2f5fd0;--hws-acc-ink:#fff;--hws-err:#b3261e}
    @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--hws-bg:#141413;--hws-card:#201f1d;--hws-ink:#f1eee8;--hws-mut:#a39e93;--hws-line:#3a3834;--hws-acc:#7ba0ff;--hws-acc-ink:#101010;--hws-err:#ff8a80}}
    :root[data-theme="dark"]{--hws-bg:#141413;--hws-card:#201f1d;--hws-ink:#f1eee8;--hws-mut:#a39e93;--hws-line:#3a3834;--hws-acc:#7ba0ff;--hws-acc-ink:#101010;--hws-err:#ff8a80}
    .hws-gate,.hws-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--hws-ink)}
    .hws-gate{background:var(--hws-bg)}
    .hws-modal{background:rgba(0,0,0,.5);z-index:2147483100}
    .hws-card{background:var(--hws-card);border:1px solid var(--hws-line);border-radius:16px;padding:28px;width:100%;max-width:400px;box-shadow:0 10px 40px rgba(0,0,0,.15)}
    .hws-card h1,.hws-card h2{margin:0 0 6px;font-size:22px}
    .hws-card p{margin:0 0 16px;color:var(--hws-mut)}
    .hws-card input{width:100%;box-sizing:border-box;padding:11px 12px;font:inherit;border:1px solid var(--hws-line);border-radius:10px;background:transparent;color:inherit;margin-bottom:10px}
    .hws-btn{font:inherit;padding:11px 14px;border-radius:10px;border:1px solid var(--hws-line);background:transparent;color:inherit;cursor:pointer;width:100%;margin-bottom:8px}
    .hws-primary{background:var(--hws-acc);color:var(--hws-acc-ink);border-color:var(--hws-acc)}
    .hws-btn:disabled{opacity:.6;cursor:default}
    .hws-or{text-align:center;color:var(--hws-mut);font-size:13px;margin:6px 0 10px}
    .hws-err{color:var(--hws-err);margin:0 0 10px;font-size:14px}.hws-note{color:var(--hws-mut);margin:0 0 10px;font-size:14px}
    .hws-chip{position:fixed;left:10px;bottom:10px;z-index:2147482000;font:12px system-ui,sans-serif;padding:5px 10px;border-radius:999px;border:1px solid var(--hws-line);background:var(--hws-card);color:var(--hws-mut);cursor:pointer;opacity:.85}
    .hws-chip:hover{opacity:1}
    .hws-menu{position:fixed;left:10px;bottom:44px;z-index:2147482000;background:var(--hws-card);color:var(--hws-ink);border:1px solid var(--hws-line);border-radius:12px;padding:12px;font:13px system-ui,sans-serif;min-width:200px}
    .hws-menu .hws-btn{margin:8px 0 0;padding:7px 10px;font-size:13px}`;
    document.head.appendChild(st);
  }

  function setInert(on) {
    for (const el of document.body.children) {
      if (el === overlay || el === chip || el.classList.contains('hws-modal') || el.classList.contains('hws-menu')) continue;
      try { on ? el.setAttribute('inert', '') : el.removeAttribute('inert'); } catch { }
    }
  }

  function render() {
    if (state === 'ready') { overlay?.remove(); overlay = null; setInert(false); return; }
    css();
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'hws-gate'; document.body.appendChild(overlay); }
    setInert(true);
    let body;
    if (state === 'checking') body = `<h1>Rehearsal</h1><p>Checking your sign-in…</p>`;
    else if (ui.step === 'code') body = `<h1>Check your email</h1><p>We sent a 6-digit code to ${esc(ui.email)}.</p>
      ${ui.notice ? `<p class="hws-note">${esc(ui.notice)}</p>` : ''}
      <input id="hws-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" value="${esc(ui.code)}">
      ${ui.error ? `<p class="hws-err">${esc(ui.error)}</p>` : ''}
      <button class="hws-btn hws-primary" data-a="verify" ${ui.busy ? 'disabled' : ''}>Sign in</button>
      <button class="hws-btn" data-a="back">Use a different email</button>`;
    else body = `<h1>Sign in to Rehearsal</h1><p>Teachers sign in so their classes and schedules are saved to their account and follow them to any computer.</p>
      ${ui.handoff ? `<p class="hws-note">Finish signing in with Google in the window that opened…</p><button class="hws-btn" data-a="cancelg">Cancel</button>` :
        `<button class="hws-btn hws-primary" data-a="google" ${ui.busy ? 'disabled' : ''}>Sign in with Google</button><div class="hws-or">or use an email code</div>`}
      <input id="hws-email" type="email" autocomplete="email" placeholder="you@school.org" value="${esc(ui.email)}">
      ${ui.error ? `<p class="hws-err">${esc(ui.error)}</p>` : ''}
      <button class="hws-btn" data-a="sendcode" ${ui.busy ? 'disabled' : ''}>Email me a code</button>`;
    overlay.innerHTML = `<div class="hws-card" role="dialog" aria-modal="true">${body}</div>`;
  }

  async function onClick(e) {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !overlay || !overlay.contains(e.target)) return;
    ui.error = '';
    const emailEl = overlay.querySelector('#hws-email'); if (emailEl) ui.email = emailEl.value.trim();
    const codeEl = overlay.querySelector('#hws-code'); if (codeEl) ui.code = codeEl.value.replace(/\s+/g, '');
    if (a === 'back') { ui.step = 'start'; ui.code = ''; return render(); }
    if (a === 'cancelg') { stopHandoff(); return render(); }
    if (a === 'sendcode') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ui.email)) { ui.error = 'Enter a valid email address.'; return render(); }
      ui.busy = true; render();
      const r = await api.emailStart({ email: ui.email });
      ui.busy = false;
      if (!r || !r.ok) { ui.error = r?.error || 'Could not send the code.'; return render(); }
      ui.step = 'code'; ui.notice = r.devCode ? `Preview mode: your code is ${r.devCode}.` : ''; return render();
    }
    if (a === 'verify') {
      if (!/^\d{6}$/.test(ui.code)) { ui.error = 'Enter the 6-digit code.'; return render(); }
      ui.busy = true; render();
      const r = await api.emailVerify({ email: ui.email, code: ui.code, ephemeral: false, syncOnly: true });
      ui.busy = false;
      if (!r || !r.ok) { ui.error = r?.error || 'Could not verify the code.'; return render(); }
      return signedIn();
    }
    if (a === 'google') return startGoogle();
  }

  function stopHandoff() {
    if (ui.handoff) { clearInterval(ui.handoff.timer); clearTimeout(ui.handoff.stop); ui.handoff = null; }
  }

  async function startGoogle() {
    const win = window.open('', '_blank');                 // opened now so the pop-up blocker allows it
    ui.busy = true; render();
    const caps = await api.getCapabilities().catch(() => ({}));
    const s = await api.oauthHandoffStart({ ephemeral: false, syncOnly: true });
    ui.busy = false;
    if (!s?.ok || !s.state || !s.pollSecret) {
      try { win && win.close(); } catch { }
      ui.error = s?.error || 'Could not start Google sign-in. Try the email code instead.'; return render();
    }
    const url = api.getOAuthHandoffUrl({ state: s.state, googleClientId: caps?.googleClientId || window.HW_GOOGLE_CLIENT_ID || '' });
    if (win) win.location.href = url; else window.open(url, '_blank');
    const h = ui.handoff = {};
    h.timer = setInterval(async () => {
      const r = await api.oauthHandoffPoll({ state: s.state, pollSecret: s.pollSecret, ephemeral: false });
      if (ui.handoff !== h) return;
      if (r?.ok && r.status === 'complete' && r.token) { stopHandoff(); signedIn(); }
      else if (r && r.status === 410) { stopHandoff(); ui.error = 'That sign-in link expired. Please try again.'; render(); }
    }, 1500);
    h.stop = setTimeout(() => { if (ui.handoff === h) { stopHandoff(); ui.error = 'That sign-in link expired. Please try again.'; render(); } }, 65000);
    render();
  }

  async function signedIn() {
    const r = await api.getMe();
    me = r?.teacher || null;
    const email = me?.email || '';
    if (meta.email && email && meta.email !== email) {
      // A different teacher on this browser: never carry the last teacher's classes into this account.
      meta = { email }; saveMeta();
      stashLocalData();
      window.__noSave = true;
      location.reload();
      return;
    }
    meta.email = email; saveMeta();
    state = 'ready'; ui = { step: 'start', email: '', code: '', busy: false, error: '', notice: '', handoff: null };
    render(); setChip('saving'); await syncDown();
  }

  // Keep a private copy aside and clear the live one, so the next person on this browser starts clean.
  function stashLocalData() {
    try {
      const cur = localStorage.getItem('rehearsal');
      if (cur) localStorage.setItem('rehearsal-prev-account', cur);
      localStorage.removeItem('rehearsal');
    } catch { }
  }

  function signedOut(msg) {
    api.clearSession();
    state = 'signedout'; me = null; ui.step = 'start'; ui.error = msg || '';
    render(); setChip('idle');
  }

  // ---------- status chip
  const CHIP = { idle: 'Backed up to your account', saved: 'Backed up to your account', saving: 'Saving…', offline: 'Offline: will back up later',
    error: 'Could not back up', toolarge: 'Too large to back up' };
  function setChip(s) {
    chipState = s;
    if (!chip) {
      css(); chip = document.createElement('button'); chip.className = 'hws-chip'; chip.type = 'button';
      chip.addEventListener('click', toggleMenu); document.body.appendChild(chip);
    }
    chip.hidden = false;
    chip.textContent = state === 'ready' ? CHIP[s] || CHIP.saved : 'Sign in to save';
  }

  function toggleMenu() {
    const old = document.querySelector('.hws-menu');
    if (old) return old.remove();
    if (state !== 'ready') { render(); return; }
    const m = document.createElement('div'); m.className = 'hws-menu';
    m.innerHTML = `<div>Signed in${me?.email ? ` as<br><strong>${esc(me.email)}</strong>` : ''}</div><button class="hws-btn" data-a="now">Back up now</button><button class="hws-btn" data-a="out">Sign out</button>`;
    m.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      m.remove();
      if (a === 'now') { clearTimeout(pushTimer); await push(); }
      if (a === 'out') { clearTimeout(pushTimer); if (dirty) await push(); state = 'signedout'; await api.logout(); me = null; meta = {}; saveMeta(); stashLocalData(); window.__noSave = true; location.reload(); }
    });
    document.body.appendChild(m);
  }

  // ---------- start
  async function start() {
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && overlay && e.target.matches('input')) overlay.querySelector('[data-a=verify],[data-a=sendcode]')?.click(); });
    window.addEventListener('online', () => { if (state === 'ready' && (dirty || chipState === 'offline' || chipState === 'error')) push(); });
    if (!api.getToken()) { state = 'signedout'; render(); setChip('idle'); return; }
    render();
    const r = await api.getMe();
    if (r?.ok) { me = r.teacher || null; state = 'ready'; meta.email = me?.email || meta.email; saveMeta(); render(); setChip('saving'); syncDown(); }
    else if (r && (r.status === 401 || r.status === 403)) signedOut('');
    else { state = 'ready'; render(); setChip('offline'); }   // offline or a server hiccup: keep the sign-in and work from the copy on this device
  }

  window.HWSYNC = { changed, push, active: true, get state() { return state; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
