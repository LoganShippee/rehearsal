'use strict';
/* Rehearsal — classroom display + automation. All data stays on this Mac. */

// ============================================================ helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const QS = new URLSearchParams(location.search);
const TOKEN = QS.get('t') || '';
const CLIENT = uid();
const HAS_SERVER = location.protocol.startsWith('http') && !!TOKEN;
function native(cmd, data = {}) {
  try { window.webkit.messageHandlers.native.postMessage({ cmd, ...data }); return true; } catch { return false; }
}
const IS_NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
// what to call this device in messages ("saved on this iPad")
const DEVICE = IS_NATIVE ? 'Mac' : /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : 'computer';
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
function atTime(date, hhmm) { const d = new Date(date); const [h, m] = (hhmm || '0:0').split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0); return d; }
function fmtHM(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (S.settings.use24h) return `${pad(h)}:${pad(m)}`;
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
function fmtClock(d) {
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  const sec = S.settings.showSeconds ? `:${pad(s)}` : '';
  if (S.settings.use24h) return `${pad(h)}:${pad(m)}${sec}`;
  return `${h % 12 || 12}:${pad(m)}${sec}`;
}
function fmtDur(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const longDate = d => `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.'); const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v;
}

// ============================================================ data
const THEMES = [
  { name: 'Ocean', bg: '#0b3954', accent: '#ffd166', text: '#ffffff' },
  { name: 'Forest', bg: '#1b4332', accent: '#95d5b2', text: '#ffffff' },
  { name: 'Berry', bg: '#6a1b3d', accent: '#ffb3c6', text: '#ffffff' },
  { name: 'Grape', bg: '#3c1f5c', accent: '#f4a261', text: '#ffffff' },
  { name: 'Chalk', bg: '#2f3e36', accent: '#f1fa8c', text: '#f4f4f0' },
  { name: 'Midnight', bg: '#111827', accent: '#60a5fa', text: '#f9fafb' },
  { name: 'Paper', bg: '#f6f1e7', accent: '#d1495b', text: '#1f1f1f' },
  { name: 'Sky', bg: '#e3f2fd', accent: '#1565c0', text: '#0d1b2a' },
  { name: 'Mint', bg: '#e8f8f0', accent: '#0f9d58', text: '#12301f' },
  { name: 'Sunshine', bg: '#fff4cc', accent: '#e76f51', text: '#2b2118' },
];
const SIGNALS = [
  { text: 'Silent', color: '#e63946' },
  { text: 'Whisper', color: '#f4a261' },
  { text: 'Partner talk', color: '#2a9d8f' },
  { text: 'Group work', color: '#3b6cf6' },
  { text: 'Eyes on me', color: '#7b2cbf' },
  { text: 'Raise your hand', color: '#0f9d58' },
];
const BUILTIN_SOUNDS = { chime: 'Chime', bell: 'School bell', ding: 'Ding', fanfare: 'Fanfare', alarm: 'Alarm', gong: 'Gong', none: 'No sound' };
const ACTION_TYPES = {
  message: 'Show a message', timer: 'Start a timer', sound: 'Play a sound',
  musicStart: 'Start music', musicStop: 'Stop music', resource: 'Show a resource',
  warmup: 'Show the warm-up', agenda: 'Go to agenda step', signal: 'Show a signal', clearSignal: 'Clear signal',
};

function newClass(name = 'New class', themeIdx = 0) {
  return {
    id: uid(), name, subtitle: '', theme: { ...THEMES[themeIdx % THEMES.length], image: '' },
    agenda: [], warmup: '', resources: [], roster: [], automations: [], points: [{ name: 'Team 1', score: 0 }, { name: 'Team 2', score: 0 }], notes: {},
  };
}
// What a new copy of Rehearsal starts with: a basic music-classroom template to edit or replace.
// No students, events or files: each teacher adds their own.
function sampleData() {
  const music = (name, period, themeIdx, warmup) => Object.assign(newClass(name, themeIdx), {
    subtitle: period,
    agenda: [{ text: 'Warm-up', min: 8 }, { text: 'Sight-reading', min: 10 }, { text: 'Rehearsal', min: 25 }, { text: 'Pack up', min: 5 }],
    warmup,
  });
  const p1 = music('Choir', 'Period 1', 0, 'Hum a comfortable note, then slide up and down an octave.\nWhat key signature has one sharp?');
  const p2 = music('Band', 'Period 2', 1, 'Assemble your instrument and play your concert B♭ scale.\nHow many beats does a dotted half note get in 4/4?');
  const p3 = music('Orchestra', 'Period 3', 3, 'Tune with the drone, then play a D major scale.\nName the notes of the open strings on your instrument.');
  const p4 = music('General Music', 'Period 4', 5, 'Clap the rhythm on the board.\nWhat is the difference between beat and rhythm?');
  const classes = [p1, p2, p3, p4];
  for (const c of classes) {
    c.automations = [
      { id: uid(), enabled: true, anchor: 'start', offset: 0, action: 'sound', sound: 'chime' },
      { id: uid(), enabled: true, anchor: 'start', offset: 0, action: 'message', text: `Welcome to ${c.name}! Get your music and start the warm-up.`, seconds: 8 },
      { id: uid(), enabled: true, anchor: 'end', offset: 5, action: 'timer', label: 'Pack up', minutes: 4, sound: 'bell', endMessage: 'Instruments and folders away. See you next time!' },
    ];
  }
  // a simple bell schedule: four 50-minute periods (and a shorter early-release day)
  const day = (name, times) => ({ id: uid(), name, periods: classes.map((c, i) => ({ id: uid(), classId: c.id, start: times[i][0], end: times[i][1] })) });
  const tRegular = day('Regular Day', [['08:00', '08:50'], ['08:55', '09:45'], ['09:50', '10:40'], ['10:45', '11:35']]);
  const tEarly = day('Early Release', [['08:00', '08:35'], ['08:40', '09:15'], ['09:20', '09:55'], ['10:00', '10:35']]);
  return {
    version: 1,
    settings: {
      welcome: "Good morning! Find your seat, get your music, and check today's agenda.",
      afterSchool: 'See you tomorrow!', use24h: false, showSeconds: true, hideDockAfter: 3,
      sim: { on: false, time: '08:58', setAt: 0 }, subInfo: '',
    },
    classes,
    templates: [tRegular, tEarly],
    weekdays: { 0: '', 1: tRegular.id, 2: tRegular.id, 3: tRegular.id, 4: tRegular.id, 5: tRegular.id, 6: '' },
    overrides: {}, calDays: {},
    routines: [],
    events: [],
    files: {},
  };
}
function migrate(d) {
  const base = sampleData();
  d.settings = { ...base.settings, ...(d.settings || {}) };
  d.settings.sim = { ...base.settings.sim, ...(d.settings.sim || {}) };
  for (const k of ['classes', 'templates', 'routines', 'events', 'recordings']) if (!Array.isArray(d[k])) d[k] = [];
  // repair: sight-reading windows pinned before the fix became empty web tabs
  for (const list of Object.values(d.windows || {})) for (const w of list || []) {
    if (w.kind !== 'res' || !w.sr) continue;
    for (const c of d.classes || []) { const r = (c.resources || []).find(x => x.id === w.resId); if (r && !r.url && !r.fileId && !r.sight) { r.sight = w.sr; delete r.url; r.title = (w.sr.mode === 'solfege' ? 'Solfege' : 'Rhythm') + ' reading'; } }
    delete w.sr;
  }
  for (const c of d.classes || []) c.resources = (c.resources || []).filter(r => r.url || r.fileId || r.sight || r.score || r.url === '');
  // live app-window status (editing etc.) never survives a restart
  for (const list of Object.values(d.windows || {})) for (const w of list || []) if (w.kind === 'app') delete w.status;
  // 1.0.8: emoji icons left over from older versions are replaced by the drawn icons (once; you can still type one back in)
  if (!d.settings.drawnIcons) {
    const EMO = /\p{Extended_Pictographic}/u, ic = d.settings.icons || {};
    for (const g of ['dock', 'kind', 'event']) for (const k in ic[g] || {}) if (EMO.test(ic[g][k])) delete ic[g][k];
    for (const c of d.classes || []) for (const r of c.resources || []) if (r.icon && EMO.test(r.icon)) delete r.icon;
    d.settings.drawnIcons = true;
  }
  for (const k of ['weekdays', 'overrides', 'files', 'windows', 'calDays']) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
  for (const c of d.classes) {
    c.theme ||= { ...THEMES[0] }; c.agenda ||= []; c.resources ||= []; c.roster ||= []; c.automations ||= [];
    c.points ||= [{ name: 'Team 1', score: 0 }, { name: 'Team 2', score: 0 }]; c.notes ||= {}; c.screenNotes ||= {}; c.progress ||= [];
  }
  return d;
}

let S = null;
async function loadData() {
  let d = null;
  if (HAS_SERVER) {
    try {
      const r = await fetch('/api/data', { headers: { 'X-Token': TOKEN } });
      if (r.ok) { const t = await r.text(); if (t.trim()) d = JSON.parse(t); }
    } catch (e) { console.warn(e); }
  }
  if (!d) { try { d = JSON.parse(localStorage.getItem('classpilot') || 'null'); } catch { } }
  S = migrate(d || sampleData());
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 350); }
async function saveNow() {
  if (window.__noSave) return;
  const body = JSON.stringify(S);
  try { localStorage.setItem('classpilot', body); } catch { }
  if (HAS_SERVER) {
    try { await fetch('/api/data', { method: 'POST', headers: { 'X-Token': TOKEN, 'X-Client': CLIENT, 'Content-Type': 'application/json' }, body }); }
    catch (e) { toast('Could not save — is the app still running?'); }
  }
}
window.__externalUpdate = async client => { if (client === CLIENT) return; await loadData(); render(); };

// ---------- files (PDFs, images, audio)
// In the Mac app they're stored by the app; in a browser (iPad) they're kept in the browser's own
// database (IndexedDB) on the device, and loaded into memBlobs when Rehearsal opens.
const memBlobs = {}; const blobUrls = {};
let IDB_DB = null;
function idbOpen() {
  return IDB_DB ||= new Promise((res, rej) => {
    const r = indexedDB.open('rehearsal-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', mode), req = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
async function loadBrowserFiles() {
  if (HAS_SERVER || !window.indexedDB) return;
  try {
    for (const id of Object.keys(S.files)) { const b = await idbDo('readonly', st => st.get(id)); if (b) memBlobs[id] = b; }
    navigator.storage?.persist?.();                            // ask the browser not to clear them when space is low
  } catch (e) { console.warn('files', e); }
}
async function storeFile(file) {
  const id = uid();
  if (HAS_SERVER) {
    const r = await fetch(`/api/file?id=${id}`, { method: 'POST', headers: { 'X-Token': TOKEN }, body: file });
    if (!r.ok) throw new Error('upload failed');
  } else {
    memBlobs[id] = file;
    try { await idbDo('readwrite', st => st.put(file, id)); } catch (e) { toast('Could not save the file on this device (storage may be full).'); throw e; }
  }
  S.files[id] = { name: file.name, mime: file.type || guessMime(file.name), size: file.size, added: Date.now() };
  save(); return id;
}
function guessMime(n) {
  const e = n.split('.').pop().toLowerCase();
  return { pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' }[e] || 'application/octet-stream';
}
function fileDirectURL(id) {
  const m = S.files[id]; if (!m) return '';
  if (!HAS_SERVER) return memBlobs[id] ? (blobUrls[id] ||= URL.createObjectURL(memBlobs[id])) : '';
  return `/files/${id}?t=${TOKEN}&m=${encodeURIComponent(m.mime)}`;
}
async function fileBlobURL(id) {
  if (blobUrls[id]) return blobUrls[id];
  const m = S.files[id]; if (!m) return '';
  let blob = memBlobs[id];
  if (!blob) { const r = await fetch(fileDirectURL(id)); blob = new Blob([await r.arrayBuffer()], { type: m.mime }); }
  return (blobUrls[id] = URL.createObjectURL(blob));
}
async function deleteFile(id) {
  delete S.files[id];
  if (HAS_SERVER) fetch(`/api/file?id=${id}`, { method: 'DELETE', headers: { 'X-Token': TOKEN } });
  else { delete memBlobs[id]; if (blobUrls[id]) URL.revokeObjectURL(blobUrls[id]); delete blobUrls[id]; idbDo('readwrite', st => st.delete(id)).catch(() => { }); }
  save();
}
const audioFiles = () => Object.entries(S.files).filter(([, f]) => f.mime.startsWith('audio/'));
function pickFile(accept, multiple = false) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...i.files]); i.click();
  });
}

// ============================================================ time & schedule
function now() {
  const sim = S.settings.sim;
  if (sim && sim.on && sim.setAt) {
    const base = atTime(new Date(sim.setAt), sim.time);
    return new Date(base.getTime() + (Date.now() - sim.setAt));
  }
  return new Date();
}
function templateFor(date) {
  const k = dateKey(date);
  if (k in S.overrides) { const v = S.overrides[k]; return v === 'none' ? null : S.templates.find(t => t.id === v) || null; }
  return S.templates.find(t => t.id === S.weekdays[date.getDay()]) || null;
}
function periodsFor(date) {
  const t = templateFor(date); if (!t) return [];
  return t.periods.filter(p => p.start && p.end && p.start < p.end).map(p => ({
    ...p, startAt: atTime(date, p.start), endAt: atTime(date, p.end), cls: S.classes.find(c => c.id === p.classId) || null,
  })).sort((a, b) => a.startAt - b.startAt);
}
// cls: the class showing (its events + school-wide ones); null = school-wide only; undefined = all
function eventsOn(date, cls) {
  const k = dateKey(date);
  return S.events.filter(e => (e.date === k || (e.yearly && e.date && e.date.slice(5) === k.slice(5)))
    && (cls === undefined || !e.classes?.length || (cls && e.classes.includes(cls.id))));
}
const evWhere = e => !e.classes?.length ? 'All classes' : e.classes.map(id => S.classes.find(c => c.id === id)?.name).filter(Boolean).join(', ') || 'All classes';
const EVENT_ICON = { birthday: 'ico:birthday', announcement: 'ico:announce', event: 'ico:events' };
const icoCfg = () => (S.settings.icons ||= {});
const iconOn = where => icoCfg().show?.[where] !== false;
const icoSp = v => v && v !== '-' ? IC(v) + ' ' : '';               // icon followed by a space, or nothing
const evIcon = k => iconOn('events') ? icoSp(icoCfg().event?.[k] ?? EVENT_ICON[k] ?? 'ico:events') : '';
const eventLabel = e => e.kind === 'birthday' ? `Happy Birthday, ${e.title}!` : `${e.title}`;   // plain text: this label is escaped in lists

// ============================================================ present-state
const P = {
  pinned: null,            // class id shown regardless of schedule
  agendaOverride: {},      // ctxKey -> step
  stageSel: {},            // ctxKey -> 'warmup' | resourceId
  fired: new Set(),
  timers: [],              // {id,label,total,endAt,pausedLeft,sound,endMessage,stopMusic,doneAt}
  overlayQ: [], overlay: null,
  signal: null,
  music: null,
  tools: {},               // name -> {x,y}
  ink: { on: false, tool: 'pen', color: '#e63946', size: 4, interact: false, blank: false },
  inkStore: {},            // ctxKey|stage -> dataURL (kept for the session)
  layoutKey: '', sideKey: '', stageKey: '',
  lastMove: Date.now(),
};

function context(t) {
  const periods = periodsFor(t);
  const cur = periods.find(p => t >= p.startAt && t < p.endAt && p.cls);
  const next = periods.find(p => p.startAt > t && p.cls);
  const prev = [...periods].reverse().find(p => p.endAt <= t);
  const template = templateFor(t);
  if (P.pinned) {
    const cls = S.classes.find(c => c.id === P.pinned);
    if (cls) return { mode: 'class', cls, period: cur && cur.cls === cls ? cur : null, next, periods, template, key: 'pin:' + cls.id, pinned: true };
  }
  if (cur) return { mode: 'class', cls: cur.cls, period: cur, next, periods, template, key: dateKey(t) + ':' + cur.id };
  if (next) return { mode: prev ? 'between' : 'before', next, prev, periods, template, key: 'between' };
  return { mode: periods.length ? 'after' : 'none', periods, template, key: 'off' };
}
/** Time left in the current step, when the agenda runs by the clock (not after ‹ › moved it by hand). */
function stepTiming(ctx, t, step) {
  const items = ctx.cls.agenda, cur = items[step];
  if (!ctx.period || !cur || !(Number(cur.min) > 0) || ctx.key in P.agendaOverride) return null;
  let before = 0; for (let i = 0; i < step; i++) before += Number(items[i].min) || 0;
  const start = +ctx.period.startAt + before * 60000, len = Number(cur.min) * 60000;
  return { left: Math.max(0, start + len - +t), frac: clamp((+t - start) / len, 0, 1) };
}
function tickStepLeft(ctx, t, step) {
  const li = $('#p-side .agenda li.cur'); if (!li || P.editMode) return;
  const m = li.querySelector('.m'), tm = stepTiming(ctx, t, step);
  if (!m || !tm) { li.querySelector('.ag-prog')?.remove(); return; }
  const sec = Math.ceil(tm.left / 1000);
  m.textContent = sec >= 60 ? `${Math.ceil(sec / 60)} min left` : `${sec} s left`;
  let bar = li.querySelector('.ag-prog');
  if (!bar) { bar = document.createElement('span'); bar.className = 'ag-prog'; bar.innerHTML = '<i></i>'; li.appendChild(bar); }
  bar.firstChild.style.width = (tm.frac * 100).toFixed(1) + '%';
}
function agendaStep(ctx, t) {
  const items = ctx.cls.agenda;
  if (!items.length) return -1;
  if (ctx.key in P.agendaOverride) return clamp(P.agendaOverride[ctx.key], 0, items.length - 1);
  if (ctx.period && items.some(i => i.min > 0)) {
    let el = (t - ctx.period.startAt) / 60000, acc = 0;
    for (let i = 0; i < items.length; i++) { acc += Number(items[i].min) || 0; if (el < acc) return i; }
    return items.length - 1;
  }
  return 0;
}

// ============================================================ sound & music
let AC = null;
function ac() { if (!AC) { audioSession('playback'); AC = new (window.AudioContext || window.webkitAudioContext)(); } return AC; }
// iPad / iPhone: Safari plays web audio in a quiet "ambient" mode, and after the microphone has been used
// it stays in a record mode that makes everything quieter. Ask for normal playback, switch to record mode
// only while a microphone is actually on, and switch back when the last one stops.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !window.webkit?.messageHandlers?.native);
function audioSession(type) { if (!IS_IOS) return; try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { } }
(() => {
  const md = navigator.mediaDevices; if (!md?.getUserMedia || !navigator.audioSession) return;
  const live = new Set(), gum = md.getUserMedia.bind(md);
  md.getUserMedia = async c => {
    if (c?.audio) audioSession('play-and-record');
    let s;
    try { s = await gum(c); }
    catch (e) {
      // "AudioSession category is not compatible with audio capture": the audio mode is stuck on playback
      // (it is shared by the whole app, so it can outlast a page reload). Ask for record mode and try again.
      if (!c?.audio || !/AudioSession|category/i.test(e?.message || '')) throw e;
      try { navigator.audioSession.type = 'play-and-record'; } catch { }
      s = await gum(c);
    }
    s.getAudioTracks().forEach(t => live.add(t));
    if (AC && AC.state !== 'running') AC.resume().catch(() => { });   // switching modes can pause the sound engine
    return s;
  };
  const stop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function () { stop.call(this); if (live.delete(this) && ![...live].some(t => t.readyState === 'live')) { live.clear(); setTimeout(() => { if (live.size) return; if (IS_IOS) audioSession('playback'); else try { if (navigator.audioSession.type !== 'auto') navigator.audioSession.type = 'auto'; } catch { } }, 50); } };
})();
document.addEventListener('pointerdown', () => audioSession(document.hidden ? 'auto' : (navigator.audioSession?.type === 'play-and-record' ? 'play-and-record' : 'playback')), { once: true, capture: true });
// Sound / playhead sync: extra delay (ms) between the audio clock and what you hear. Kept per device,
// because speakers, Bluetooth and the iPad all differ.
const AV_KEY = 'rehearsal-avdelay';
function avDelayMs() {
  try { const v = localStorage.getItem(AV_KEY); if (v != null && v !== '' && isFinite(+v)) return +v; } catch { }
  if (IS_NATIVE) { const s = Number(S?.settings?.avDelay); return isFinite(s) && S.settings.avDelay != null ? s : 150; }
  // browsers that report their own output delay (Chrome, Firefox) need little extra; Safari reports less
  return AC && AC.outputLatency > 0 ? 0 : 60;
}
// Music playback (sight reading, scores, grading) goes through one volume control with a limiter,
// so it can be turned up on quiet laptop / iPad speakers without distorting. Kept per device.
const VOL_KEY = 'rehearsal-volume';
function musicVol() { try { const v = +localStorage.getItem(VOL_KEY); if (v > 0) return v; } catch { } return IS_NATIVE ? 1 : 1.8; }
const MUSIC_OUTS = new Set();
function musicOut(c = ac()) {        // one per sound engine (grading has its own); nodes can't cross engines
  if (!c.__music) {
    const g = c.createGain(), lim = c.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.12;
    g.gain.value = musicVol(); g.connect(lim).connect(c.destination); c.__music = g; MUSIC_OUTS.add(g);
  }
  return c.__music;
}
function setMusicVol(v) { try { localStorage.setItem(VOL_KEY, String(v)); } catch { } for (const g of MUSIC_OUTS) try { g.gain.setTargetAtTime(v, g.context.currentTime, 0.03); } catch { } }
function setAvDelay(ms) { ms = Math.round(Math.max(-200, Math.min(600, ms)) / 10) * 10; try { localStorage.setItem(AV_KEY, String(ms)); } catch { } S.settings.avDelay = ms; save(); return ms; }
function tone(freq, start, dur, type = 'sine', gain = 0.2) {
  const c = ac(), t0 = c.currentTime + start;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
const SYNTH = {
  chime: () => [880, 1108.7, 1318.5].forEach((f, i) => tone(f, i * 0.18, 1.4, 'sine', 0.22)),
  bell: () => [0, 0.55, 1.1].forEach(t => { tone(740, t, 1.4, 'triangle', 0.3); tone(1480, t, 1.0, 'sine', 0.08); }),
  ding: () => { tone(1046.5, 0, 1.2, 'sine', 0.3); tone(2093, 0, 0.6, 'sine', 0.05); },
  fanfare: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.16, i === 3 ? 0.9 : 0.2, 'sawtooth', 0.07)),
  alarm: () => { for (let i = 0; i < 8; i++) tone(i % 2 ? 880 : 660, i * 0.22, 0.2, 'square', 0.07); },
  gong: () => { tone(98, 0, 4, 'sine', 0.4); tone(196.5, 0, 3, 'sine', 0.15); tone(294, 0, 2, 'triangle', 0.06); },
  none: () => { },
};
async function playSound(name) {
  if (!name || name === 'none') return;
  try {
    if (ac().state === 'suspended') await ac().resume();
    if (name.startsWith('file:')) {
      const a = new Audio(await fileBlobURL(name.slice(5))); a.play().catch(() => { });
    } else (SYNTH[name] || SYNTH.chime)();
  } catch (e) { console.warn(e); }
}
async function startMusic(fileId, volume = 0.7, loop = true) {
  stopMusic(true);
  if (!S.files[fileId]) return;
  const a = new Audio(await fileBlobURL(fileId)); a.loop = loop; a.volume = clamp(volume, 0, 1);
  P.music = a; a.play().catch(() => showSoundChip());
}
function stopMusic(immediate = false) {
  const a = P.music; if (!a) return; P.music = null;
  if (immediate) { a.pause(); return; }
  const v0 = a.volume; let i = 0;
  const iv = setInterval(() => { i++; a.volume = Math.max(0, v0 * (1 - i / 15)); if (i >= 15) { clearInterval(iv); a.pause(); } }, 100);
}
function showSoundChip() {
  if ($('.sound-chip') || !$('.present')) return;
  const b = document.createElement('button'); b.className = 'sound-chip'; b.innerHTML = IC('ico:mute') + ' Sound is off — click to enable';
  b.onclick = async () => { try { await ac().resume(); } catch { } if (P.music) P.music.play().catch(() => { }); b.remove(); };
  $('.present').appendChild(b);
}

// ============================================================ automation engine
function fire(a, cls) {
  switch (a.action) {
    case 'message': queueMessage(a.text || '', Number(a.seconds) || 8); break;
    case 'timer': startTimer({ label: a.label || 'Timer', minutes: Number(a.minutes) || 1, sound: a.sound || 'bell', endMessage: a.endMessage || '', stopMusic: !!a.stopMusic }); break;
    case 'sound': playSound(a.sound || 'chime'); break;
    case 'musicStart': if (a.fileId) {
      startMusic(a.fileId, (Number(a.volume) || 70) / 100, a.loop !== false);
      const tok = P.musicTok = uid();
      if (Number(a.minutes) > 0) setTimeout(() => { if (P.musicTok === tok) stopMusic(); }, a.minutes * 60000);
    } break;
    case 'musicStop': stopMusic(); break;
    case 'resource': if (cls && a.resourceId) { const ctx = context(now()); if (ctx.cls === cls) P.stageSel[ctx.key] = a.resourceId; } break;
    case 'warmup': { const ctx = context(now()); if (ctx.cls) P.stageSel[ctx.key] = 'warmup'; break; }
    case 'agenda': { const ctx = context(now()); if (ctx.cls) P.agendaOverride[ctx.key] = Number(a.step) || 0; break; }
    case 'signal': {
      P.signal = { text: a.text || 'Signal', color: a.color || '#e63946' };
      const tok = P.signalTok = uid();
      if (Number(a.minutes) > 0) setTimeout(() => { if (P.signalTok === tok) P.signal = null; }, a.minutes * 60000);
      break;
    }
    case 'clearSignal': P.signal = null; break;
  }
}
function runAutomations(t) {
  const day = dateKey(t), ms = t.getTime();
  const due = (key, at) => { const dt = ms - at; if (dt >= 0 && dt < 4000 && !P.fired.has(key)) { P.fired.add(key); return true; } return false; };
  for (const p of periodsFor(t)) {
    if (!p.cls) continue;
    for (const a of p.cls.automations) {
      if (a.enabled === false) continue;
      const off = (Number(a.offset) || 0) * 60000;
      const at = a.anchor === 'end' ? p.endAt.getTime() - off : p.startAt.getTime() + off;
      if (due(`${day}|${p.id}|${a.id}`, at)) fire(a, p.cls);
    }
  }
  const hasSchool = periodsFor(t).length > 0;
  for (const r of S.routines) {
    if (r.enabled === false || !r.time || !(r.days || []).includes(t.getDay())) continue;
    if (r.schoolDaysOnly && !hasSchool) continue;
    if (due(`${day}|r|${r.id}`, atTime(t, r.time).getTime())) fire(r, context(t).cls);
  }
  for (const e of eventsOn(t, context(t).cls || null)) {
    if (!e.time) continue;
    if (due(`${day}|e|${e.id}`, atTime(t, e.time).getTime())) {
      if (e.kind === 'birthday') { playSound('fanfare'); confetti(); }
      queueMessage(eventLabel(e), 12);
    }
  }
}

// ---------- timers
function startTimer({ label, minutes, sound = 'bell', endMessage = '', stopMusic: sm = false }) {
  const total = minutes * 60000;
  P.timers.push({ id: uid(), label, total, endAt: onClockSecond(Date.now() + total), pausedLeft: null, sound, endMessage, stopMusic: sm, doneAt: 0 });
  renderTimers();
}
// Timers end on one of the clock's whole seconds, so their countdown ticks over together with the clock.
const clockOff = () => now().getTime() - Date.now();
const onClockSecond = ms => { const o = clockOff(); return Math.round((ms + o) / 1000) * 1000 - o; };
function timerLeft(tm) { return tm.pausedLeft != null ? tm.pausedLeft : tm.endAt - Date.now(); }
function tickTimers() {
  for (const tm of P.timers) {
    if (!tm.doneAt && tm.pausedLeft == null && timerLeft(tm) <= 0) {
      tm.doneAt = Date.now();
      playSound(tm.sound);
      if (tm.stopMusic) stopMusic();
      if (tm.endMessage) queueMessage(tm.endMessage, 8);
    }
  }
  const before = P.timers.length;
  P.timers = P.timers.filter(tm => !tm.doneAt || Date.now() - tm.doneAt < 6000);
  if (before !== P.timers.length) renderTimers(); else updateTimers();
}
function ringSVG(frac) {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="7"/>
  <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 32 32)"/></svg>`;
}
function renderTimers() {
  const el = $('#p-timers'); if (!el) return;
  el.innerHTML = P.timers.map(tm => `<div class="p-timer" data-tid="${tm.id}">
    <span class="ringwrap"></span><div><div class="tl">${esc(tm.label)}</div><div class="tv"></div></div>
    <div class="tbtns"><button data-action="timer-pause" data-id="${tm.id}">${IC('ico:pause')}</button><button data-action="timer-add" data-id="${tm.id}">+1</button><button data-action="timer-x" data-id="${tm.id}">${IC('ico:close')}</button></div></div>`).join('');
  updateTimers();
}
function updateTimers() {
  for (const tm of P.timers) {
    const el = $(`.p-timer[data-tid="${tm.id}"]`); if (!el) continue;
    const left = timerLeft(tm);
    el.querySelector('.tv').textContent = tm.doneAt ? "Time's up!" : fmtDur(left);
    el.querySelector('.ringwrap').innerHTML = ringSVG(tm.doneAt ? 0 : clamp(left / tm.total, 0, 1));
    el.classList.toggle('warn', !tm.doneAt && left < 10000);
    el.classList.toggle('done', !!tm.doneAt);
  }
}

// ---------- overlay messages
function queueMessage(text, seconds = 8) { if (!text) return; P.overlayQ.push({ text, until: 0, seconds }); }
function tickOverlay() {
  const el = $('#p-overlay'); if (!el) return;
  if (P.overlay && Date.now() > P.overlay.until) { P.overlay = null; el.classList.remove('on'); el.innerHTML = ''; }
  if (!P.overlay && P.overlayQ.length) {
    P.overlay = P.overlayQ.shift(); P.overlay.until = Date.now() + P.overlay.seconds * 1000;
    el.innerHTML = `<div class="p-msg">${esc(P.overlay.text)}<div class="sub">click to dismiss</div></div>`;
    el.classList.add('on');
  }
}
function confetti() {
  const host = $('.present'); if (!host) return;
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff'];
  for (let i = 0; i < 120; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%'; p.style.background = colors[i % colors.length];
    p.style.animationDuration = 2.5 + Math.random() * 2.5 + 's'; p.style.animationDelay = Math.random() * 1.2 + 's';
    box.appendChild(p);
  }
  host.appendChild(box); setTimeout(() => box.remove(), 7000);
}

// ============================================================ embeds
function embedURL(raw) {
  let u; try { u = new URL(raw); } catch { return raw; }
  const h = u.hostname.replace(/^www\./, '');
  const m = (re) => u.pathname.match(re);
  if (h === 'youtube.com' || h === 'm.youtube.com') {
    const v = u.searchParams.get('v'); if (v) return `https://www.youtube.com/embed/${v}?rel=0`;
    const s = m(/^\/shorts\/([\w-]+)/); if (s) return `https://www.youtube.com/embed/${s[1]}?rel=0`;
  }
  if (h === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}?rel=0`;
  if (h === 'docs.google.com') {
    let r;
    if ((r = m(/^\/presentation\/(?:u\/\d+\/)?d\/([\w-]+)/))) return `https://docs.google.com/presentation/d/${r[1]}/embed?start=false&loop=false&rm=minimal`;
    if ((r = m(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)/))) return `https://docs.google.com/document/d/${r[1]}/preview`;
    if ((r = m(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/))) return `https://docs.google.com/spreadsheets/d/${r[1]}/preview`;
    if ((r = m(/^\/forms\/(?:u\/\d+\/)?d\/(e\/)?([\w-]+)/))) return `https://docs.google.com/forms/d/${r[1] || ''}${r[2]}/viewform?embedded=true`;
    if ((r = m(/^\/drawings\/(?:u\/\d+\/)?d\/([\w-]+)/))) return `https://docs.google.com/drawings/d/${r[1]}/preview`;
  }
  if (h === 'drive.google.com') {
    let r;
    if ((r = m(/\/file\/(?:u\/\d+\/)?d\/([\w-]+)/))) return `https://drive.google.com/file/d/${r[1]}/preview`;
    if ((r = m(/\/folders\/([\w-]+)/))) return `https://drive.google.com/embeddedfolderview?id=${r[1]}#grid`;
  }
  if (h === 'canva.com' && u.pathname.includes('/design/')) {
    const base = u.pathname.replace(/\/(edit|view|watch).*$/, '/view'); return `https://www.canva.com${base}?embed`;
  }
  if (h === 'vimeo.com') { const r = m(/^\/(\d+)/); if (r) return `https://player.vimeo.com/video/${r[1]}`; }
  return raw;
}
function editURL(raw) {
  // Slides/Docs in edit view (lets you present + click through) instead of the embed player
  return raw.replace(/\/(embed|preview)(\?.*)?$/, '/edit');
}
function kindIcon(k) { return icoCfg().kind?.[k] ?? KIND_ICON[k] ?? 'ico:attach'; }
function resIcon(r) { return r.icon || kindIcon(resKind(r)); }
function tabIcon(r) { return iconOn('tabs') ? icoSp(resIcon(r)) : ''; }
function resKind(r) {
  if (r.music) return r.music.kind;
  if (r.widget) return r.widget.kind;               // a pinned calendar / progress tracker              // a pinned tuner / metronome
  if (r.sight) return 'sight';
  if (r.score) return 'score';
  if (r.fileId) { const f = S.files[r.fileId]; return f ? (f.mime.startsWith('image/') ? 'image' : f.mime === 'application/pdf' ? 'pdf' : f.mime.startsWith('video/') ? 'video' : f.mime.startsWith('audio/') ? 'audio' : 'file') : 'missing'; }
  const u = r.url || '';
  if (/docs\.google\.com\/presentation/.test(u)) return 'slides';
  if (/docs\.google\.com\/document/.test(u)) return 'doc';
  if (/docs\.google\.com\/spreadsheets/.test(u)) return 'sheet';
  if (/docs\.google\.com\/forms/.test(u)) return 'form';
  if (/drive\.google\.com/.test(u)) return 'drive';
  if (/youtu/.test(u)) return 'youtube';
  if (/canva\.com/.test(u)) return 'canva';
  return 'web';
}
const KIND_ICON = { cal: 'ico:events', prog: 'ico:gauge', tuner: 'ico:tuner', metro: 'ico:metro', sight: 'ico:sight', score: 'ico:score', slides: 'ico:slides', doc: 'ico:doc', sheet: 'ico:sheet', form: 'ico:form', drive: 'ico:folder', youtube: 'ico:youtube', canva: 'ico:look', web: 'ico:web', pdf: 'ico:file', image: 'ico:image', video: 'ico:video', audio: 'ico:audio', file: 'ico:attach', missing: 'ico:warn' };
const isGoogle = r => /google\.com/.test(r.url || '');

// ============================================================ render root
let VIEW = QS.get('view') === 'edit' ? 'edit' : 'present';
let TAB = 'classes';
let SEL_CLASS = null;
const app = () => $('#app');
function render() {
  document.body.classList.toggle('presenting', VIEW === 'present');
  if (VIEW === 'present') renderPresent(); else { renderEditor(); syncNative(); }
}
function go(view) {
  VIEW = view; P.dockNear = Date.now(); P.winMenu = false; P.clipOpen = false; $('#clip-panel')?.remove(); P.iconsOpen = false; $('#icons-panel')?.remove();
  if (view === 'present') { P.layoutKey = P.sideKey = P.stageKey = ''; }
  render();
}

// ============================================================ PRESENT
function renderPresent() {
  app().innerHTML = `<div class="present" id="present">
    <div class="p-bg" id="p-bg"></div>
    <div class="p-signal" id="p-signal" data-action="signal-clear" title="Click to clear"></div>
    <header class="p-head"><div class="p-title" id="p-title"></div><nav class="p-dock" id="p-dock"></nav><div class="p-clock" id="p-clock"></div><div class="p-progress"><div id="p-bar"></div></div></header>
    <div class="p-body" id="p-body"></div>
    <div class="p-wins" id="p-wins"></div>
    <div class="ink" id="ink"></div>
    <div id="win-menu-host"></div>
    <div class="p-timers" id="p-timers"></div>
    <div class="p-overlay" id="p-overlay" data-action="overlay-dismiss"></div>
    <div id="p-tools"></div>
  </div>`;
  P.layoutKey = P.sideKey = P.stageKey = ''; WIN.key = null; WIN.sig = '';
  setupInk();
  renderDock(); renderTimers(); renderTools(); tick();
  if (AC && AC.state === 'suspended') showSoundChip();
  else if (!AC) { try { if (ac().state === 'suspended') showSoundChip(); } catch { } }
}
function hexA(hex, a) {
  const h = (hex || '#000000').replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function applyTheme(el, theme) {
  const th = theme || THEMES[0];
  // panel opacity: panels take the class background colour at the chosen strength (default = light tint)
  if (th.panel != null) { el.style.setProperty('--card', hexA(th.bg, th.panel)); el.style.setProperty('--panel-blur', th.panel > 0.4 ? '0px' : '8px'); }
  else { el.style.removeProperty('--card'); el.style.removeProperty('--panel-blur'); }
  el.classList.toggle('panel-blur', th.panel != null && th.panel <= 0.4);
  el.style.setProperty('--bg', th.bg); el.style.setProperty('--accent', th.accent); el.style.setProperty('--text', th.text || '#fff');
  if (!IS_NATIVE && el.id === 'present' && document.documentElement.dataset.bg !== th.bg) {   // browser: page edges and Safari's bar match the class
    document.documentElement.dataset.bg = th.bg; document.documentElement.style.backgroundColor = th.bg;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th.bg);
  }
  const bg = el.querySelector('#p-bg') || el;
  const dim = th.dim ?? 0.25;
  bg.style.backgroundImage = th.image ? `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})), url("${th.image.startsWith('file:') ? fileDirectURL(th.image.slice(5)) : th.image}")` : '';
}
// ============================================================ toolbar (dock): customizable + movable
const DOCK_ITEMS = {
  timer: { icon: 'ico:timer', label: 'Timer', act: 'tool', tool: 'timer' },
  points: { icon: 'ico:points', label: 'Points', act: 'tool', tool: 'points' },
  noise: { icon: 'ico:noise', label: 'Noise', act: 'tool', tool: 'noise' },
  random: { icon: 'ico:random', label: 'Random', act: 'tool', tool: 'random' },
  signal: { icon: 'ico:signal', label: 'Signal', act: 'tool', tool: 'signal' },
  annotate: { icon: 'ico:annotate', label: 'Annotate', act: 'ink-toggle', on: () => P.ink.on && !P.ink.blank },
  board: { icon: 'ico:board', label: 'Board', act: 'board-toggle', on: () => P.ink.on && P.ink.blank },
  tuner: { icon: 'ico:tuner', label: 'Tuner', act: 'open-music', kind: 'tuner', on: () => winList().some(w => w.kind === 'tuner') },
  metro: { icon: 'ico:metro', label: 'Metronome', act: 'open-music', kind: 'metro', on: () => winList().some(w => w.kind === 'metro') },
  sight: { icon: 'ico:sight', label: 'Sight read', act: 'wm-sight' },
  cal: { icon: 'ico:events', label: 'Calendar', act: 'wm-cal', on: () => winList().some(w => w.kind === 'cal') },
  prog: { icon: 'ico:gauge', label: 'Progress', act: 'wm-prog', on: () => winList().some(w => w.kind === 'prog') },
  yt: { icon: 'ico:youtube', label: 'YouTube', act: 'wm-yt', on: () => winList().some(w => w.kind === 'yt') },
  rec: { icon: 'ico:mic', label: 'Record', act: 'wm-rec', on: () => winList().some(w => w.kind === 'rec') || REC.state === 'rec' },
  score: { icon: 'ico:score', label: 'Scores', act: 'wm-score', on: () => winList().some(w => w.kind === 'score') },
  clip: { icon: 'ico:clip', label: 'Copy/paste', act: 'clip-open', on: () => !!P.clipOpen },
  window: { icon: '＋', label: 'Window', act: 'win-menu', on: () => P.winMenu },
  tile: { icon: 'ico:tile', label: 'Tile', act: 'win-tile' },
  classpick: { icon: 'ico:pin', label: 'Class picker', special: 'classpick' },
  fullscreen: { icon: 'ico:fullscreen', label: 'Full screen', act: 'fullscreen' },
  editmode: { icon: 'ico:annotate', label: 'Quick edit', act: 'edit-mode', on: () => !!P.editMode },
  edit: { icon: 'ico:edit', label: 'Setup', act: 'edit', locked: true },
  sep1: { sep: true, label: '— divider —' }, sep2: { sep: true, label: '— divider —' }, sep3: { sep: true, label: '— divider —' },
};
const DOCK_DEFAULT = ['timer', 'points', 'noise', 'random', 'signal', 'annotate', 'board', 'sep1', 'tuner', 'metro', 'window', 'tile', 'sep2', 'classpick', 'sep3', 'fullscreen', 'editmode', 'edit'];
function dockCfg() {
  const d = (S.settings.dock ||= {});
  d.order ||= [...DOCK_DEFAULT];
  for (const id of Object.keys(DOCK_ITEMS)) if (!d.order.includes(id) && ['cal', 'prog', 'rec', 'yt'].includes(id) && d.menu && !d.menu.includes(id)) d.menu.push(id);   // new tools start in ⋯
  for (const id of Object.keys(DOCK_ITEMS)) if (!d.order.includes(id)) { const at = id === 'editmode' && d.order.includes('edit') ? d.order.indexOf('edit') : d.order.length; d.order.splice(at, 0, id); }   // new tools appear at the end
  d.hidden ||= ['sight'];
  d.menu ||= ['score', 'clip', 'tile', 'cal', 'prog', 'rec', 'yt'];                // shown in the ⋯ menu instead of on the bar
  if (d.labels == null) d.labels = true;
  d.pos ||= { mode: 'header' };
  return d;
}
function dockIcon(id, it) { if (!iconOn('dock')) return ''; const v = icoCfg().dock?.[id] ?? it.icon; return v === '-' ? '' : IC(v); }
function renderDock() {
  const d = $('#p-dock'); if (!d) return;
  const cfg = dockCfg();
  const btn = (id, it) => `<button data-dock-id="${id}" data-action="${it.act}" ${it.tool ? `data-tool="${it.tool}"` : ''} ${it.kind ? `data-kind="${it.kind}"` : ''}
      class="${(it.tool ? !!P.tools[it.tool] : it.on?.()) ? 'on' : ''}" title="${esc(it.label)}">${dockIcon(id, it) ? `<span class="i">${dockIcon(id, it)}</span>` : ''}${cfg.labels || !dockIcon(id, it) ? it.label : ''}</button>`;
  const parts = cfg.order.filter(id => !cfg.hidden.includes(id) && !cfg.menu.includes(id) && DOCK_ITEMS[id]).map(id => {
    const it = DOCK_ITEMS[id];
    if (it.sep) return '<span class="sep"></span>';
    if (it.special === 'classpick') return dockClassPick();
    return btn(id, it);
  });
  if (P.music) parts.push(btn('music', { icon: 'ico:stop', label: 'Music', act: 'music-stop' }));
  d.innerHTML = `<span class="dock-grip" title="Drag to move the toolbar">⋮⋮</span>${parts.join('').replace(/^(<span class="sep"><\/span>)+|(<span class="sep"><\/span>)+$/g, '')}
    <button data-action="dock-more" class="dock-more ${P.dockCustom || P.dockMore ? 'on' : ''}" title="More tools and toolbar settings">⋯</button>`;
  d.classList.toggle('nolabels', !cfg.labels);
  applyDockLook();
  placeDock();
  fitDock();
  if (P.dockMore) renderDockMore();
}
function dockClassPick(id = 'classpick') {
  return `<select data-dock-id="${id}" data-action-change="pin" title="Show a class now, ignoring the schedule">
      <option value="">Follow schedule</option>
      ${S.classes.map(c => `<option value="${c.id}" ${P.pinned === c.id ? 'selected' : ''}>${esc(c.name)}${c.subtitle ? ' · ' + esc(c.subtitle) : ''}</option>`).join('')}</select>`;
}
/** When the bar doesn't fit (small screens, iPad), tuck buttons from the end into the ⋯ menu. Setup always stays. */
function fitDock() {
  const d = $('#p-dock'); if (!d) return;
  P.dockOverflow = [];
  const kids = [...d.children];
  requestAnimationFrame(() => { d.style.setProperty('--dock-h', d.offsetHeight + 'px'); d.style.setProperty('--dock-w', d.offsetWidth + 'px'); });
  kids.forEach(k => { k.style.display = ''; });
  const over = () => d.classList.contains('vertical') ? d.scrollHeight > d.clientHeight + 1 : d.scrollWidth > d.clientWidth + 1;
  if (!over()) return;
  const items = kids.filter(k => k.dataset.dockId && k.dataset.dockId !== 'edit').reverse();
  for (const k of items) {
    if (!over()) break;
    k.style.display = 'none'; P.dockOverflow.unshift(k.dataset.dockId);
  }
  // drop dividers that now sit next to each other or at an end
  let prevSep = true;
  for (const k of [...d.children]) {
    if (k.style.display === 'none' || k.classList.contains('dock-grip')) continue;
    if (k.classList.contains('sep')) { if (prevSep) k.style.display = 'none'; prevSep = true; } else prevSep = k.classList.contains('dock-more');
  }
}
/** The ⋯ menu: tools kept off the bar, ones that didn't fit, and the toolbar settings. */
function renderDockMore() {
  $('#dock-more-menu')?.remove();
  if (!P.dockMore) return;
  const cfg = dockCfg();
  const ids = [...new Set([...cfg.order.filter(id => cfg.menu.includes(id) && !cfg.hidden.includes(id)), ...(P.dockOverflow || [])])].filter(id => DOCK_ITEMS[id] && !DOCK_ITEMS[id].sep);
  const m = document.createElement('div'); m.id = 'dock-more-menu'; m.className = 'dock-more-menu';
  m.innerHTML = ids.map(id => { const it = DOCK_ITEMS[id];
    if (it.special === 'classpick') return `<div class="dm-row">${IC('ico:pin')} ${dockClassPick('classpick-menu')}</div>`;
    const on = it.tool ? !!P.tools[it.tool] : it.on?.();
    return `<button class="dm-item ${on ? 'on' : ''}" data-action="${it.act}" ${it.tool ? `data-tool="${it.tool}"` : ''} ${it.kind ? `data-kind="${it.kind}"` : ''}><span class="i">${IC(icoCfg().dock?.[id] && icoCfg().dock[id] !== '-' ? icoCfg().dock[id] : it.icon)}</span>${esc(it.label)}</button>`; }).join('')
    + `${ids.length ? '<div class="dm-sep"></div>' : ''}<button class="dm-item" data-action="dock-custom"><span class="i">⋯</span>Customize toolbar…</button>`;
  $('#present').appendChild(m);
  const r = $('#p-dock .dock-more').getBoundingClientRect();
  m.style.left = clamp(r.right - m.offsetWidth, 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = clamp(r.bottom + 8 < innerHeight - m.offsetHeight ? r.bottom + 8 : r.top - m.offsetHeight - 8, 8, innerHeight - m.offsetHeight - 8) + 'px';
  m.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(() => { P.dockMore = false; renderDockMore(); renderDock(); }); });
}
document.addEventListener('pointerdown', e => {
  if (P.dockMore && !e.target.closest('#dock-more-menu, #p-dock .dock-more')) { P.dockMore = false; renderDockMore(); renderDock(); }
});
/** Put the toolbar where it was left: tucked into the header, or floating (horizontal / vertical). */
function applyDockLook() {
  const d = $('#p-dock'); if (!d) return;
  const cfg = dockCfg();
  d.classList.toggle('dock-sm', cfg.size === 's'); d.classList.toggle('dock-lg', cfg.size === 'l');
  d.classList.toggle('dock-light', cfg.color === 'light'); d.classList.toggle('dock-class', cfg.color === 'class');
  d.style.setProperty('--dock-a', ((cfg.alpha ?? 82) / 100).toFixed(2));
}
function placeDock() {
  const d = $('#p-dock'); if (!d) return;
  const pos = dockCfg().pos;
  const float = pos.mode === 'float';
  d.classList.toggle('floating', float);
  d.classList.toggle('vertical', float && !!pos.vertical);
  if (!float) { d.style.left = d.style.top = ''; return; }
  const w = d.offsetWidth, h = d.offsetHeight;
  d.style.left = clamp(pos.x * innerWidth - w / 2, 4, innerWidth - w - 4) + 'px';
  d.style.top = clamp(pos.y * innerHeight - h / 2, 4, innerHeight - h - 4) + 'px';
}
window.addEventListener('resize', () => { placeDock(); fitDock(); });
let DOCKDRAG = null;
// Keep the grip handle exactly under the pointer, even when the toolbar flips between horizontal and vertical.
function dockFollow(px, py) {
  const d = $('#p-dock'), cfg = dockCfg();
  const vertical = px < 110 || px > innerWidth - 110;               // near a side edge → stand it up
  cfg.pos = { mode: 'float', x: cfg.pos.x ?? .5, y: cfg.pos.y ?? .1, vertical };
  placeDock();
  const g = d.querySelector('.dock-grip').getBoundingClientRect(), r = d.getBoundingClientRect();
  const nx = r.left + (px - (g.left + g.width / 2)), ny = r.top + (py - (g.top + g.height / 2));
  cfg.pos.x = (nx + r.width / 2) / innerWidth; cfg.pos.y = (ny + r.height / 2) / innerHeight;
  placeDock();
  d.classList.toggle('snap-home', py < 80 && Math.abs(px - innerWidth / 2) < innerWidth * 0.22);   // back into the header
}
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.dock-grip'); if (!g || VIEW !== 'present') return;
  e.preventDefault();
  DOCKDRAG = true; document.body.classList.add('dock-dragging');
  dockFollow(e.clientX, e.clientY);
});
document.addEventListener('pointermove', e => {
  if (!DOCKDRAG) return;
  P.lastMove = Date.now();
  dockFollow(e.clientX, e.clientY);
});
document.addEventListener('pointerup', () => {
  if (!DOCKDRAG) return;
  DOCKDRAG = null; document.body.classList.remove('dock-dragging');
  const d = $('#p-dock');
  if (d.classList.contains('snap-home')) dockCfg().pos = { mode: 'header' };
  d.classList.remove('snap-home');
  placeDock(); save();
});
// ---------- customize panel: checklist + drag to reorder
function renderDockCustom() {
  $('#dock-custom')?.remove();
  if (!P.dockCustom) return;
  const cfg = dockCfg();
  const panel = document.createElement('div'); panel.id = 'dock-custom'; panel.className = 'dock-custom';
  panel.innerHTML = `<div class="dc-head"><b>Toolbar</b><span class="grow"></span><button data-action="dock-custom">Done</button></div>
    <div class="dc-note">Tick what to show. "in ⋯" keeps a button in the ⋯ menu instead of on the bar. Drag ≡ to reorder.</div>
    <div class="dc-list">${cfg.order.filter(id => DOCK_ITEMS[id]).map(id => { const it = DOCK_ITEMS[id]; return `<div class="dc-row ${it.sep ? 'sep' : ''}" draggable="true" data-id="${id}">
      <span class="dc-grip">≡</span>
      <label><input type="checkbox" data-dock-show="${id}" ${cfg.hidden.includes(id) ? '' : 'checked'} ${it.locked ? 'disabled' : ''}> ${esc(it.label)}</label>
      ${it.sep || it.locked ? '<span class="dc-inmenu"></span>' : `<label class="dc-inmenu" title="Keep it in the ⋯ menu instead of on the bar"><input type="checkbox" data-dock-menu="${id}" ${cfg.menu.includes(id) ? 'checked' : ''}> in ⋯</label>`}
      ${it.sep ? '' : `<input class="dc-emoji" data-dock-icon="${id}" value="${esc(icoCfg().dock?.[id] ?? '')}" placeholder="${esc(ICL(it.icon))}" maxlength="8" title="Icon for this button: type an emoji to replace it, or leave empty for the default. - = no icon">`}</div>`; }).join('')}</div>
    <label class="dc-opt"><input type="checkbox" data-dock-labels ${cfg.labels ? 'checked' : ''}> Show labels under icons</label>
    <label class="dc-opt"><input type="checkbox" data-dock-emoji ${iconOn('dock') ? 'checked' : ''}> Show emojis</label>
    <div class="dc-look">
      <label>Size <select data-dock-opt="size">${[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([v, l]) => `<option value="${v}" ${(cfg.size || 'm') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Colour <select data-dock-opt="color">${[['dark', 'Dark'], ['light', 'Light'], ['class', 'Class colour']].map(([v, l]) => `<option value="${v}" ${(cfg.color || 'dark') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>See-through <input type="range" min="25" max="100" step="5" data-dock-opt="alpha" value="${cfg.alpha ?? 82}"></label>
      <label>Shrink when idle <select data-dock-hide>${[[0, 'Never'], [3, 'After 3 s'], [10, 'After 10 s'], [30, 'After 30 s']].map(([v, l]) => `<option value="${v}" ${(S.settings.hideDockAfter ?? 3) == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="dc-spots"><span>Move to</span><button data-action="dock-spot" data-spot="top">Top (header)</button><button data-action="dock-spot" data-spot="bottom">Bottom</button><button data-action="dock-spot" data-spot="left">Left side</button><button data-action="dock-spot" data-spot="right">Right side</button></div>
    <div class="dc-btns"><button data-action="dock-home">Put toolbar back at the top</button><button data-action="dock-reset">Reset</button><button data-action="icons-open">${IC('ico:icons')} Icons…</button></div>`;
  $('#present').appendChild(panel);
  const r = $('#p-dock').getBoundingClientRect();
  panel.style.left = clamp(r.left + r.width / 2 - panel.offsetWidth / 2, 8, innerWidth - panel.offsetWidth - 8) + 'px';
  panel.style.top = clamp(r.bottom + 8 < innerHeight - panel.offsetHeight ? r.bottom + 8 : r.top - panel.offsetHeight - 8, 8, innerHeight - panel.offsetHeight - 8) + 'px';
  // drag to reorder (native drag & drop)
  let dragId = null;
  panel.addEventListener('dragstart', e => { const row = e.target.closest('.dc-row'); dragId = row?.dataset.id; row?.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId || ''); });
  panel.addEventListener('dragend', () => { dragId = null; renderDockCustom(); });
  panel.addEventListener('dragover', e => {
    const row = e.target.closest('.dc-row'); if (!row || !dragId || row.dataset.id === dragId) return;
    e.preventDefault();
    const order = cfg.order, from = order.indexOf(dragId);
    const r2 = row.getBoundingClientRect(), after = e.clientY > r2.top + r2.height / 2;
    order.splice(from, 1);
    let to = order.indexOf(row.dataset.id) + (after ? 1 : 0);
    order.splice(to, 0, dragId);
    const list = panel.querySelector('.dc-list'), moving = list.querySelector(`[data-id="${dragId}"]`);
    after ? row.after(moving) : row.before(moving);
    save(); renderDock();
  });
  panel.addEventListener('input', e => { if (e.target.dataset.dockOpt === 'alpha') { cfg.alpha = Number(e.target.value); applyDockLook(); } });
  panel.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.dockShow) { const set = new Set(cfg.hidden); el.checked ? set.delete(el.dataset.dockShow) : set.add(el.dataset.dockShow); cfg.hidden = [...set]; }
    if (el.dataset.dockMenu) { const set = new Set(cfg.menu); el.checked ? set.add(el.dataset.dockMenu) : set.delete(el.dataset.dockMenu); cfg.menu = [...set]; }
    if (el.dataset.dockLabels !== undefined) cfg.labels = el.checked;
    if (el.dataset.dockEmoji !== undefined) (icoCfg().show ||= {}).dock = el.checked;
    if (el.dataset.dockIcon) { const g = (icoCfg().dock ||= {}), v = el.value.trim(); if (v) g[el.dataset.dockIcon] = v; else delete g[el.dataset.dockIcon]; }
    if (el.dataset.dockOpt) cfg[el.dataset.dockOpt] = el.dataset.dockOpt === 'alpha' ? Number(el.value) : el.value;
    if (el.dataset.dockHide !== undefined) S.settings.hideDockAfter = Number(el.value);
    save(); renderDock();
  });
}

function tick() {
  if (VIEW !== 'present' || !$('#present')) return;
  const t = now();
  runAutomations(t);
  const ctx = context(t);
  const root = $('#present');
  applyTheme(root, ctx.mode === 'class' ? ctx.cls.theme : (ctx.next?.cls?.theme || S.classes[0]?.theme));

  // header
  const tmplName = ctx.template ? esc(ctx.template.name) : '';
  const testChip = S.settings.sim.on ? '<span class="chip test">TEST TIME</span>' : '';
  let title = '', left = '', frac = 0;
  if (ctx.mode === 'class' && P.editMode) {
    title = ieTitle(ctx, tmplName, testChip);
    if (ctx.period) { left = `Ends in ${fmtDur(ctx.period.endAt - t)}`; frac = (t - ctx.period.startAt) / (ctx.period.endAt - ctx.period.startAt); }
  } else if (ctx.mode === 'class') {
    title = `<div class="t1">${esc(ctx.cls.name)}</div><div class="t2">${ctx.cls.subtitle ? esc(ctx.cls.subtitle) : ''}${testChip}</div>`;
    if (ctx.period) {
      left = `Ends in ${fmtDur(ctx.period.endAt - t)}`;
      frac = (t - ctx.period.startAt) / (ctx.period.endAt - ctx.period.startAt);
    }
  } else {
    title = `<div class="t1">${longDate(t)}</div><div class="t2">${tmplName ? '' : 'No classes scheduled'}${testChip}</div>`;
    if (ctx.next) left = `${esc(ctx.next.cls.name)} in ${fmtDur(ctx.next.startAt - t)}`;
  }
  if (!ieFocused('#p-title')) setHTML('#p-title', title);
  root.classList.toggle('editing', !!P.editMode);
  root.classList.toggle('stage-max', !!P.stageMax && ctx.mode === 'class');
  setHTML('#p-clock', `<div class="time">${fmtClock(t)}</div><div class="left">${left}</div>`);
  $('#p-bar').style.width = (clamp(frac, 0, 1) * 100).toFixed(2) + '%';

  // body
  const layoutKey = ctx.mode + '|' + (ctx.cls?.id || '') + '|' + ctx.key;
  if (layoutKey !== P.layoutKey) { P.layoutKey = layoutKey; P.sideKey = P.stageKey = ''; buildLayout(ctx); }
  if (ctx.mode === 'class') updateClassBody(ctx, t);
  else updateCenter(ctx, t);

  // signal
  const sg = $('#p-signal');
  if (P.signal) { sg.textContent = P.signal.text; sg.style.background = P.signal.color; sg.style.color = '#fff'; sg.classList.add('on'); }
  else sg.classList.remove('on');

  renderWins(ctx);
  tickTimers(); tickOverlay(); tickNoise(); syncNative();
  if (P.clipOpen && (clipClass()?.id || null) !== P.clipFor) renderClip();   // class changed (schedule / picker)
  // auto-hide dock & cursor
  const hideAfter = S.settings.hideDockAfter ?? 3, since = Date.now() - P.lastMove;
  const anyTool = Object.keys(P.tools).length || P.ink.on || P.winMenu || WIN.drag || P.dockCustom || P.dockMore || DOCKDRAG || P.editMode || P.iconsOpen;
  $('#p-dock').classList.toggle('hidden', hideAfter > 0 && Date.now() - (P.dockNear || 0) > hideAfter * 1000 && !anyTool);
  root.classList.toggle('hide-cursor', since > 3000 && !anyTool);
  if (!!P.music !== !!$('#p-dock [data-action="music-stop"]')) renderDock();
}
function setHTML(sel, html) { const el = $(sel); if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }

function buildLayout(ctx) {
  const body = $('#p-body');
  if (ctx.mode === 'class') {
    body.className = 'p-body';
    body.innerHTML = `<aside class="p-side" id="p-side"></aside>
      <div class="p-split" id="p-split" title="Drag to resize · double-click to hide or show the side panel"><button class="p-split-btn" data-action="side-toggle" title="Hide/show side panel"></button></div>
      <main class="p-stage" id="p-stage"><div class="stage-tabs" id="stage-tabs"></div><div class="stage-content" id="stage-content"></div></main>`;
    applySide(ctx.cls);
  } else {
    body.className = 'p-body full'; body.style.gridTemplateColumns = '';
    body.innerHTML = `<div class="p-stage" id="p-stage" style="background:transparent;border:none"><div class="center-screen" id="center" style="flex:1"></div></div>`;
  }
  saveInk(); P.inkKey = ctx.key; restoreInk();
}

// the class's Progress tracker as a small card in the side panel (click to open the full tracker)
function sideProgCard(cls) {
  const items = cls.progress || [];
  return `<div class="p-card side-prog" data-action="wm-prog" title="Open the Progress tracker"><h4>Progress</h4>${items.length ? `<ul>${items.map(it => {
    const st = it.steps || [], d = st.filter(x => x.done).length;
    return `<li title="${esc(progLabel(cls, it.status))}"><i class="light ${it.status}"></i><span class="sp-t">${esc(it.title || 'Untitled')}</span>${st.length ? `<span class="sp-bar" title="${d}/${st.length} steps"><i style="width:${Math.round(d / st.length * 100)}%"></i></span>` : ''}</li>`; }).join('')}</ul>` : '<div style="opacity:.7">Nothing yet. Click to add pieces.</div>'}</div>`;
}
function updateClassBody(ctx, t) {
  const cls = ctx.cls, step = agendaStep(ctx, t);
  const evs = eventsOn(t, ctx.cls);
  const pubNote = (cls.screenNotes || {})[dateKey(t)]?.trim() || '';
  const progSide = cls.sideProgress ? (cls.progress || []).map(i => [i.title, i.status, (i.steps || []).length, (i.steps || []).filter(x => x.done).length]) : null;
  const sideKey = JSON.stringify([step, cls.agenda, evs.map(e => e.id), ctx.next?.id, S.settings.use24h, !!P.editMode, cls.name, pubNote, progSide, cls.progLabels]);
  if (sideKey !== P.sideKey && !ieFocused('#p-side') && !AGDRAG) {
    P.sideKey = sideKey;
    const agenda = cls.agenda.length ? `<ol class="agenda">${cls.agenda.map((a, i) => `<li class="${i < step ? 'done' : i === step ? 'cur' : ''}"><span class="n">${i + 1}</span><span>${esc(a.text)}</span>${a.min ? `<span class="m">${a.min}m</span>` : ''}</li>`).join('')}</ol>` : '<div style="opacity:.7">No agenda yet.</div>';
    if (P.editMode) $('#p-side').innerHTML = ieSide(ctx, step, evs);
    else $('#p-side').innerHTML = `
      <div class="p-card"><h4>Agenda <span class="mini-btns"><button data-action="agenda-prev">‹</button><button data-action="agenda-next">›</button></span></h4>${agenda}</div>
      ${evs.length ? `<div class="p-card"><h4>Today</h4><ul class="ev-list">${evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ` <span style="opacity:.7">${fmtHM(e.time)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${pubNote ? `<div class="p-card"><h4>Notes</h4><div class="pub-note">${esc(pubNote)}</div></div>` : ''}
      ${progSide ? sideProgCard(cls) : ''}
      ${ctx.next && !ctx.pinned ? `<div class="p-card"><h4>Up next</h4><div>${esc(ctx.next.cls.name)} · ${fmtHM(ctx.next.start)}</div></div>` : ''}`;
  }
  tickStepLeft(ctx, t, step);
  let sel = P.stageSel[ctx.key] || 'warmup';
  // warm-up tab removed for this class: show the first tab instead
  if (cls.hideWarmup && !cls.resources.some(r => r.id === sel)) sel = cls.resources[0]?.id || 'warmup';
  const res = cls.resources.find(r => r.id === sel);
  const stageKey = JSON.stringify([sel, res && [res.id, res.url, res.fileId, res.mode, !!res.sight, !!res.music, !!res.widget, !!res.native], cls.warmup, cls.resources.map(r => [r.id, r.title, r.group || '', r.icon || '']), (cls.groups || []).map(g => [g.id, g.name]), !!P.editMode, !!P.stageMax, !!cls.hideWarmup]);
  if (stageKey !== P.stageKey && !ieFocused('#stage-content')) {
    P.stageKey = stageKey;
    $('#stage-tabs').innerHTML = `
      ${cls.hideWarmup ? '' : `<span class="tabwrap"><button class="${!res ? 'on' : ''}" data-action="stage" data-id="warmup">${iconOn('tabs') ? icoSp(icoCfg().kind?.warmup ?? 'ico:warmup') : ''}Warm-up</button><button class="tab-x" data-action="warmup-hide" title="Remove the warm-up tab from this class">${IC('ico:close')}</button></span>`}
      ${stageTabsHTML(cls, res)}
      <span class="sp"></span>
      <button class="zoom-badge" data-action="stage-zoom-reset" title="Pinch to zoom · click to reset" hidden>100%</button>
      <button class="stage-max" data-action="stage-max" title="${P.stageMax ? 'Back to normal size' : 'Maximize (markup tools still work)'}">${IC(P.stageMax ? 'ico:restore' : 'ico:maximize')}</button>
      ${res && res.url && IS_NATIVE ? `<button class="mode" data-action="stage-native" title="${res.native ? 'Switch back to embedded (drawing works on top)' : 'Page not showing? Show it as a full browser (every site works)'}">${res.native ? 'Embedded' : 'Full browser'}</button>` : ''}${res && res.url ? `<button data-action="stage-reload" title="Reload">${IC('ico:reload')}</button>${isGoogle(res) && IS_NATIVE ? `<button data-action="open-drive" data-url="${esc(res.url)}" title="Open in the Google Drive window">Drive window</button>` : ''}<button data-action="open-external" data-url="${esc(res.url)}" title="Open in your web browser">${IC('ico:external')}</button>` : ''}`;
    const sc = $('#stage-content');
    if (res && res.sight) {
      sc.innerHTML = `<div class="sr-host stage-sr" data-sr-res="${res.id}"></div>`; mountSightHosts(sc);
    } else if (res && res.widget) {
      sc.innerHTML = widgetHost(res.widget.kind, 'stage-wg'); mountWidgets(sc);
    } else if (res && res.music) {
      sc.innerHTML = `<div class="mu-host stage-mu" data-mu-win="r-${res.id}" data-mu-res="${res.id}"></div>`; mountSightHosts(sc);
    } else if (res && res.score) {
      sc.innerHTML = `<div class="score-host stage-sp" data-score-res="${res.id}"></div>`;
    } else if (!res) {
      sc.innerHTML = `<div class="warmup"><div class="lbl">Warm-up question</div><div class="q" ${P.editMode ? 'contenteditable="true" data-ie="warmup" data-ph="Type a warm-up question…"' : ''}>${esc(cls.warmup || (P.editMode ? '' : 'Welcome! Get ready to learn.'))}</div></div>`;
    } else if (res.fileId) {
      const k = resKind(res), src = fileDirectURL(res.fileId);
      if (k === 'image') sc.innerHTML = `<img class="res" src="${src}">`;
      else if (k === 'video') sc.innerHTML = `<video src="${src}" controls style="position:absolute;inset:0;width:100%;height:100%;background:#000"></video>`;
      else if (k === 'missing') sc.innerHTML = `<div class="res-fallback">This file is missing. Re-add it in Setup → Classes.</div>`;
      else if (k === 'pdf') sc.innerHTML = `<div class="pdf-host" data-pdf-res="${res.id}"></div>`;
      else sc.innerHTML = `<iframe src="${src}"></iframe>`;
    } else if (res.native && IS_NATIVE) {
      sc.innerHTML = `<div class="stage-native"></div>`;          // the real browser view shows through here
    } else {
      const src = res.mode === 'edit' ? editURL(embedURL(res.url)) : embedURL(res.url);
      sc.innerHTML = `<iframe src="${esc(src)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    }
    mountSightHosts(sc);
    setTimeout(applyStageZoom, 0);
  }
}

function updateCenter(ctx, t) {
  const evs = eventsOn(t, ctx.cls || null);
  let html = '';
  if (ctx.mode === 'before' || ctx.mode === 'between') {
    html = `<div class="big">${fmtClock(t)}</div>
      <div class="msg">${esc(ctx.mode === 'before' ? S.settings.welcome : 'Passing period')}</div>
      <div class="next">Next: <b>${esc(ctx.next.cls.name)}</b> at ${fmtHM(ctx.next.start)} · starts in ${fmtDur(ctx.next.startAt - t)}</div>`;
  } else if (ctx.mode === 'after') {
    html = `<div class="big">${fmtClock(t)}</div><div class="msg">${esc(S.settings.afterSchool)}</div>`;
  } else {
    html = `<div class="big">${fmtClock(t)}</div><div class="msg">${longDate(t)}</div><div class="next" style="opacity:.75">No classes on the schedule today. Use ${IC('ico:pin')} in the dock to show a class anyway.</div>`;
  }
  if (evs.length) html += `<div class="p-card"><h4>Today</h4><ul class="ev-list">${evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ` <span style="opacity:.7">${fmtHM(e.time)}</span>` : ''}</li>`).join('')}</ul></div>`;
  setHTML('#center', html);
}

// ============================================================ free windows
// Windows float over the Present screen: web pages, PDFs/pictures/videos, class resources, warm-up.
// Each class remembers its own arrangement (S.windows[classId]); outside class it's S.windows._free.
// Web windows can be "embedded" (an iframe: drawing/timers on top, but some sites refuse) or
// "full browser" (a real browser view under the page, shown through a hole — every site works).
const WIN = { key: null, sig: '', drag: null, nav: {}, lastSync: '', cutSig: '' };
const winKeyOf = ctx => ctx.mode === 'class' ? ctx.cls.id : '_free';
function curWinKey() { return winKeyOf(context(now())); }
function winList(key = curWinKey()) { S.windows ||= {}; return (S.windows[key] ||= []); }
const findWin = id => winList().find(w => w.id === id);
const topZ = list => list.reduce((m, w) => Math.max(m, w.z || 0), 0);
function winRes(w) { if (w.kind !== 'res') return null; for (const c of S.classes) { const r = c.resources.find(x => x.id === w.resId); if (r) return r; } return null; }
function winURL(w) { if (w.kind === 'web') return w.url || ''; const r = winRes(w); return r?.url || ''; }
function findRes(id) { for (const c of S.classes) { const r = c.resources.find(x => x.id === id); if (r) return r; } return null; }
function mountSightHosts(root = document) {
  if (typeof mountScore === 'function') {
    for (const h of root.querySelectorAll('[data-score-win]')) { const w = findWin(h.dataset.scoreWin); if (w?.score) mountScore(h, w.score, () => save(), 'w' + w.id); }
    for (const h of root.querySelectorAll('[data-score-res]')) { const r = findRes(h.dataset.scoreRes); if (r?.score) mountScore(h, r.score, () => save(), 'r' + r.id + (h.closest('#stage-content') ? 's' : 'w')); }
  }
  if (typeof mountSight !== 'function') return;
  for (const h of root.querySelectorAll('[data-sr-win]')) { const w = findWin(h.dataset.srWin); if (w) { w.sr ||= srDefaults(); mountSight(h, w.sr, () => save()); } }
  for (const h of root.querySelectorAll('[data-sr-res]')) { const r = findRes(h.dataset.srRes); if (r?.sight) mountSight(h, r.sight, () => save()); }
  if (typeof mountPdf === 'function') {
    for (const h of root.querySelectorAll('[data-pdf-res]')) { const r = findRes(h.dataset.pdfRes); if (r?.fileId) mountPdf(h, fileDirectURL(r.fileId), (r.pdf ||= {}), () => save()); }
    for (const h of root.querySelectorAll('[data-pdf-win]')) {
      const w = findWin(h.dataset.pdfWin); if (!w) continue;
      const fid = w.kind === 'file' ? w.fileId : winRes(w)?.fileId; if (fid) mountPdf(h, fileDirectURL(fid), (w.pdf ||= {}), () => save());
    }
  }
  mountWidgets(root);
  if (typeof mountTuner === 'function') for (const h of root.querySelectorAll('[data-mu-win]')) {
    const id = h.dataset.muWin; let kind, st;
    if (h.dataset.muRes) { const r = findRes(h.dataset.muRes); if (!r?.music) continue; kind = r.music.kind; st = (r.music.mu ||= muDefaults(kind)); }   // pinned to a class
    else { const w = findWin(id); if (!w) continue; w.mu ||= muDefaults(w.kind); kind = w.kind; st = w.mu; }
    (kind === 'tuner' ? mountTuner : mountMetronome)(h, st, () => save(), id);
  }
}
// ============================================================ calendar & progress windows
const WIDGETS = { cal: { title: 'Calendar', icon: 'ico:events' }, prog: { title: 'Progress', icon: 'ico:gauge' }, rec: { title: 'Recorder', icon: 'ico:mic' }, yt: { title: 'YouTube', icon: 'ico:youtube' } };
const WG_RENDER = k => ({ cal: renderCal, prog: renderProg, rec: renderRec, yt: renderYt })[k];
const widgetHost = (kind, cls = '') => `<div class="wg-host ${cls}" data-wg="${kind}"></div>`;
function mountWidgets(root = document) { for (const h of root.querySelectorAll('.wg-host')) WG_RENDER(h.dataset.wg)?.(h); }
const refreshWidgets = kind => document.querySelectorAll(`.wg-host[data-wg="${kind}"]`).forEach(h => WG_RENDER(kind)(h));

// Re-render every open copy of a widget, keeping the cursor in the field you were typing in.
function refreshWidgetsKeep(kind) {
  const a = document.activeElement, host = a?.closest?.('.wg-host');
  const key = host && a.dataset?.f ? { f: a.dataset.f, id: a.closest('[data-id]')?.dataset.id, s: a.selectionStart } : null;
  refreshWidgets(kind);
  if (!key) return;
  const sel = `[data-f="${key.f}"]`, el = [...host.querySelectorAll(sel)].find(x => (x.closest('[data-id]')?.dataset.id) === key.id);
  if (el) { el.focus(); try { if (key.s != null) el.setSelectionRange(key.s, key.s); } catch {} }
}
const CAL_COLORS = ['#e5484d', '#f2994a', '#f2c230', '#2fbf5b', '#3b9eff', '#a970ff', '#e05fae'];
const calDays = () => (S.calDays ||= {});
const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Month view: click a day to change its bell schedule, colour and label it, and add events, birthdays,
 *  announcements and the on-screen note. */
function renderCal(h) {
  const t = now(), off = h.__off || 0, cls = currentClass();
  const first = new Date(t.getFullYear(), t.getMonth() + off, 1), month = first.getMonth();
  const start = new Date(first); start.setDate(1 - first.getDay());
  const last = new Date(first.getFullYear(), month + 1, 0), weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  const todayK = dateKey(t), sel = h.__sel;
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dateKey(d), tmpl = templateFor(d), special = k in S.overrides, mark = calDays()[k];
    const evs = eventsOn(d, cls || undefined), note = cls?.screenNotes?.[k]?.trim();
    cells += `<div class="cal-d ${d.getMonth() !== month ? 'out' : ''} ${k === todayK ? 'today' : ''} ${tmpl ? '' : 'off'} ${k === sel ? 'sel' : ''}" data-day="${k}"
      ${mark?.color ? `style="--mark:${mark.color}"` : ''}>
      <div class="cal-n">${d.getDate()}</div>
      ${mark?.label ? `<div class="cal-lb">${esc(mark.label)}</div>` : ''}
      ${special ? `<div class="cal-sp">${esc(tmpl ? tmpl.name : 'No school')}</div>` : ''}
      ${evs.map(e => `<div class="cal-ev ${e.kind || ''}">${IC(EVENT_ICON[e.kind] || 'ico:events')}${esc(eventLabel(e) || '(untitled)')}${e.time ? ` <small>${fmtHM(e.time)}</small>` : ''}</div>`).join('')}
      ${note ? `<div class="cal-ev note">${IC('ico:notes')}${esc(note.split('\n')[0])}</div>` : ''}</div>`;
  }
  h.innerHTML = `<div class="cal ${sel ? 'has-day' : ''}"><div class="cal-month">
    <div class="cal-top"><button data-cal="-1" title="Previous month">‹</button><b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button data-cal="1" title="Next month">›</button>
      <span class="grow"></span>${off ? '<button data-cal="0">Today</button>' : ''}</div>
    <div class="cal-grid" style="grid-template-rows: auto repeat(${weeks}, minmax(0, 1fr))">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="cal-w">${w}</div>`).join('')}${cells}</div>
    <div class="cal-key">Click a day to add events or change it. Grey days have no school.</div></div>
    ${sel ? calDayPanel(sel, cls) : ''}</div>`;

  h.onclick = e => {
    const b = e.target.closest('[data-cal], [data-day], [data-cd]'); if (!b) return; e.stopPropagation();
    if (b.dataset.cal != null) { const v = Number(b.dataset.cal); h.__off = v ? off + v : 0; return renderCal(h); }
    if (b.dataset.day) { h.__sel = h.__sel === b.dataset.day ? null : b.dataset.day; return renderCal(h); }
    const k = h.__sel, act = b.dataset.cd, id = b.closest('[data-id]')?.dataset.id;
    if (act === 'close') { h.__sel = null; return renderCal(h); }
    if (act === 'step') { const d = parseKey(k); d.setDate(d.getDate() + Number(b.dataset.n)); h.__sel = dateKey(d); h.__off = (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth(); return renderCal(h); }
    if (act === 'color') { const m = calDays()[k] ||= {}; if (b.dataset.c) m.color = b.dataset.c; else delete m.color; if (!m.color && !m.label) delete calDays()[k]; }
    if (act === 'add') {
      const kind = b.dataset.kind;
      S.events.push({ id: uid(), kind, date: k, title: '', time: '', yearly: kind === 'birthday', classes: cls && kind !== 'birthday' ? [cls.id] : [] });
      const id2 = S.events.at(-1).id; calChanged(h); h.querySelector(`[data-id="${id2}"] [data-f="title"]`)?.focus(); return;
    }
    if (act === 'del') { S.events = S.events.filter(x => x.id !== id); }
    calChanged(h);
  };
  h.onchange = e => {
    const el = e.target, f = el.dataset.f; if (!f) return;
    const k = h.__sel, ev = S.events.find(x => x.id === el.closest('[data-id]')?.dataset.id);
    if (f === 'tmpl') { if (el.value === '') delete S.overrides[k]; else S.overrides[k] = el.value; }
    else if (f === 'label') { const m = calDays()[k] ||= {}; m.label = el.value.trim(); if (!m.label) delete m.label; if (!m.color && !m.label) delete calDays()[k]; }
    else if (f === 'note') { if (!cls) return; const n = (cls.screenNotes ||= {}); if (el.value.trim()) n[k] = el.value; else delete n[k]; }
    else if (ev && f === 'who') ev.classes = el.value ? [el.value] : [];
    else if (ev && f === 'yearly') ev.yearly = el.checked;
    else if (ev) ev[f] = el.value;
    calChanged(h);
  };
}
function calChanged(h) { save(); P.sideKey = P.stageKey = ''; $('#p-title') && ($('#p-title')._h = ''); refreshWidgetsKeep('cal'); }
function calDayPanel(k, cls) {
  const d = parseKey(k), usual = S.templates.find(x => x.id === S.weekdays[d.getDay()]);
  const cur = k in S.overrides ? S.overrides[k] : '', mark = calDays()[k] || {};
  const evs = eventsOn(d, cls || undefined);
  const kindSel = e => `<select data-f="kind">${[['event', 'Event'], ['announcement', 'Announcement'], ['birthday', 'Birthday']].map(([v, l]) => `<option value="${v}" ${e.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const whoSel = e => `<select data-f="who" title="Who sees it"><option value="">All classes</option>${S.classes.map(c => `<option value="${c.id}" ${e.classes?.[0] === c.id && e.classes.length === 1 ? 'selected' : ''}>${esc(c.name)} only</option>`).join('')}</select>`;
  return `<div class="cal-day">
    <div class="cal-dh"><button data-cd="step" data-n="-1" title="Previous day">‹</button><b>${DAYNAMES[d.getDay()]}, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><button data-cd="step" data-n="1" title="Next day">›</button>
      <span class="grow"></span><button data-cd="close" title="Close">${IC('ico:close')}</button></div>
    <label class="cal-f"><span>Bell schedule</span><select data-f="tmpl">
      <option value="" ${cur === '' ? 'selected' : ''}>Usual (${esc(usual ? usual.name : 'no school')})</option>
      ${S.templates.map(x => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      <option value="none" ${cur === 'none' ? 'selected' : ''}>No school</option></select></label>
    <label class="cal-f"><span>Label</span><input data-f="label" value="${esc(mark.label || '')}" placeholder="e.g. Concert, Field trip, Exam week"></label>
    <div class="cal-f"><span>Colour</span><div class="cal-sw"><button data-cd="color" data-c="" class="${mark.color ? '' : 'on'}" title="None">∅</button>${CAL_COLORS.map(c => `<button data-cd="color" data-c="${c}" style="background:${c}" class="${mark.color === c ? 'on' : ''}"></button>`).join('')}</div></div>
    <div class="cal-sec">Events</div>
    ${evs.map(e => `<div class="cal-evrow" data-id="${e.id}">
      <div class="cal-er1">${IC(EVENT_ICON[e.kind] || 'ico:events')}<input data-f="title" value="${esc(e.title)}" placeholder="${e.kind === 'birthday' ? 'Name' : 'What'}"><button data-cd="del" title="Remove">${IC('ico:trash')}</button></div>
      <div class="cal-er2">${kindSel(e)}<input type="time" data-f="time" value="${e.time || ''}" title="Time (optional)">${whoSel(e)}<label title="Every year on this date"><input type="checkbox" data-f="yearly" ${e.yearly ? 'checked' : ''}> yearly</label></div></div>`).join('')
      || '<div class="cal-none">Nothing on this day.</div>'}
    <div class="cal-adds"><button data-cd="add" data-kind="event">＋ Event</button><button data-cd="add" data-kind="announcement">＋ Announcement</button><button data-cd="add" data-kind="birthday">＋ Birthday</button></div>
    ${cls ? `<div class="cal-sec">Note on screen for ${esc(cls.name)}</div><textarea data-f="note" rows="2" placeholder="Shows under the announcement that day">${esc(cls.screenNotes?.[k] || '')}</textarea>` : ''}
  </div>`;
}

/** Pieces (or anything) with a traffic light, steps to check off and notes on what still needs doing. */
const PROG = { green: 'Concert ready', yellow: 'Still working', red: "Haven't started" };
const progLabel = (cls, k) => cls?.progLabels?.[k] || PROG[k];
const agoText = ts => { if (!ts) return ''; const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'updated today' : d === 1 ? 'updated yesterday' : `updated ${d} days ago`; };
function renderProg(h) {
  const cls = currentClass();
  if (!cls) { h.innerHTML = '<div class="prog"><div class="prog-empty">Progress is kept for each class. Show a class first (Class picker in the toolbar).</div></div>'; return; }
  const items = (cls.progress ||= []), count = k => items.filter(i => i.status === k).length, L = k => esc(progLabel(cls, k));
  const lights = it => ['red', 'yellow', 'green'].map(k => `<button class="pick ${k} ${it.status === k ? 'on' : ''}" data-pg="set" data-s="${k}"><i class="light ${k}"></i>${L(k)}</button>`).join('');
  h.innerHTML = `<div class="prog">
    <div class="prog-top">${['green', 'yellow', 'red'].map(k => `<span class="prog-sum"><i class="light ${k}"></i>${L(k)} <b>${count(k)}</b></span>`).join('')}
      <span class="grow"></span><button data-pg="side" class="${cls.sideProgress ? 'on' : ''}" title="Show this list in the class's side panel">Side panel</button><button data-pg="labels" class="${h.__labels ? 'on' : ''}" title="Rename the three colours">Labels</button><button class="prog-add" data-pg="add">＋ Add</button></div>
    ${h.__labels ? `<div class="prog-labels">${['red', 'yellow', 'green'].map(k => `<label><i class="light ${k}"></i><input data-f="lbl-${k}" value="${esc(cls.progLabels?.[k] || '')}" placeholder="${esc(PROG[k])}"></label>`).join('')}</div>` : ''}
    <div class="prog-list">${items.map((it, i) => {
      const steps = it.steps || [], done = steps.filter(s => s.done).length, open = it.open !== false;
      return `<div class="prog-item ${it.status}" data-id="${it.id}">
      <button class="light ${it.status}" data-pg="pick" title="Change colour"></button>
      <div class="prog-main">
        <div class="prog-row"><input class="prog-title" data-f="title" value="${esc(it.title)}" placeholder="Piece or task">
          <button class="prog-st ${it.status}" data-pg="pick" title="Change colour">${L(it.status)} ▾</button>
          <span class="prog-tools"><button data-pg="up" title="Move up" ${i ? '' : 'disabled'}>${IC('ico:up')}</button><button data-pg="down" title="Move down" ${i < items.length - 1 ? '' : 'disabled'}>${IC('ico:down')}</button><button data-pg="del" title="Remove">${IC('ico:trash')}</button></span></div>
        ${h.__pick === it.id ? `<div class="prog-pick">${lights(it)}</div>` : ''}
        <div class="prog-meta">${steps.length ? `<button class="prog-tog" data-pg="toggle">${open ? '▾' : '▸'} ${done}/${steps.length} steps</button><span class="prog-bar"><i style="width:${Math.round(done / steps.length * 100)}%"></i></span>` : ''}<span class="prog-ago">${agoText(it.updated)}</span></div>
        ${open ? `<div class="prog-steps">${steps.map(s => `<div class="prog-step ${s.done ? 'done' : ''}" data-sid="${s.id}">
            <button class="pg-chk ${s.done ? 'on' : ''}" data-pg="check" title="${s.done ? 'Mark not done' : 'Mark done'}">${s.done ? IC('ico:check') : ''}</button>
            <input data-f="step" data-sid="${s.id}" value="${esc(s.text)}" placeholder="Step, e.g. learn notes mm. 1–24"><button class="prog-sx" data-pg="sdel" title="Remove step">${IC('ico:close')}</button></div>`).join('')}
          <button class="prog-addstep" data-pg="addstep">＋ Step</button></div>
          <textarea class="prog-notes" data-f="notes" rows="1" placeholder="Notes: what still needs to be done…">${esc(it.notes || '')}</textarea>` : ''}
        ${steps.length && done === steps.length && it.status !== 'green' ? `<div class="prog-hint">All steps are checked off. <button data-pg="set" data-s="green">Mark “${L('green')}”</button></div>` : ''}
      </div></div>`; }).join('')
      || `<div class="prog-empty">Nothing yet. Press ＋ Add for each piece you're working on, add the steps it needs and check them off as you go. Click the light to change its colour.</div>`}</div></div>`;
  h.querySelectorAll('.prog-notes').forEach(fitNotes);
  const touch = it => { if (it) it.updated = Date.now(); };
  h.onclick = e => {
    const b = e.target.closest('[data-pg]'); if (!b) return; e.stopPropagation();
    const id = b.closest('[data-id]')?.dataset.id, it = items.find(i => i.id === id), sid = b.closest('[data-sid]')?.dataset.sid;
    const act = b.dataset.pg;
    if (act === 'add') { const n = { id: uid(), title: '', status: 'red', notes: '', steps: [], updated: Date.now() }; items.push(n); save(); renderProg(h); h.querySelector(`[data-id="${n.id}"] .prog-title`)?.focus(); refreshOthers(h); return; }
    if (act === 'labels') { h.__labels = !h.__labels; return renderProg(h); }
    if (act === 'side') { cls.sideProgress = !cls.sideProgress; save(); P.sideKey = ''; return refreshWidgets('prog'); }
    if (act === 'pick') { h.__pick = h.__pick === id ? null : id; return renderProg(h); }
    if (!it) return;
    if (act === 'set') { it.status = b.dataset.s; h.__pick = null; touch(it); }
    if (act === 'toggle') it.open = it.open === false;
    if (act === 'up' || act === 'down') { const i = items.indexOf(it), j = i + (act === 'up' ? -1 : 1); if (j >= 0 && j < items.length) [items[i], items[j]] = [items[j], items[i]]; }
    if (act === 'del' && !(!it.title && !it.notes && !it.steps?.length || confirm(`Remove “${it.title || 'this item'}”?`))) return;
    if (act === 'del') items.splice(items.indexOf(it), 1);
    if (act === 'addstep') {
      const s = { id: uid(), text: '', done: false }; (it.steps ||= []).push(s); it.open = true; touch(it);
      save(); renderProg(h); h.querySelector(`[data-sid="${s.id}"] input`)?.focus(); refreshOthers(h); return;
    }
    const st = it.steps?.find(s => s.id === sid);
    if (act === 'check' && st) { st.done = !st.done; touch(it); if (st.done && it.status === 'red') it.status = 'yellow'; }
    if (act === 'sdel' && st) it.steps.splice(it.steps.indexOf(st), 1);
    save(); refreshWidgetsKeep('prog');
  };
  h.oninput = e => {
    const f = e.target.dataset.f; if (!f) return;
    if (f.startsWith('lbl-')) { const k = f.slice(4), lb = (cls.progLabels ||= {}); if (e.target.value.trim()) lb[k] = e.target.value; else delete lb[k]; save(); return; }
    const it = items.find(i => i.id === e.target.closest('[data-id]')?.dataset.id); if (!it) return;
    if (f === 'step') { const s = it.steps?.find(x => x.id === e.target.dataset.sid); if (s) s.text = e.target.value; }
    else it[f] = e.target.value;
    if (f === 'notes') fitNotes(e.target);
    touch(it); save();
  };
  h.onchange = e => { if (e.target.dataset.f) refreshWidgetsKeep('prog'); };
  h.onkeydown = e => {
    if (e.key !== 'Enter' || e.target.dataset.f !== 'step') return;
    e.preventDefault(); e.target.closest('.prog-item')?.querySelector('[data-pg="addstep"]')?.click();
  };
}
// other open copies of the same widget (a pinned one and a window, say)
const refreshOthers = h => document.querySelectorAll(`.wg-host[data-wg="${h.dataset.wg}"]`).forEach(x => x !== h && WG_RENDER(x.dataset.wg)(x));
function fitNotes(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

// ---------- YouTube window: paste a link, keep recently watched videos, make playlists and switch between them
const ytData = () => (S.yt ||= { recent: [], lists: [], last: null });
function ytParse(raw) {
  const t = String(raw || '').trim(); if (!t) return null;
  if (/^[\w-]{11}$/.test(t)) return { id: t };
  let u; try { u = new URL(/^https?:/.test(t) ? t : 'https://' + t); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|music)\./, ''), start = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '0') || 0;
  if (h === 'youtu.be') return { id: u.pathname.slice(1, 12), start };
  if (h !== 'youtube.com' && h !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v'), sh = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/), list = u.searchParams.get('list');
  if (v || sh) return { id: v || sh[1], start };
  if (list) return { list };
  return null;
}
const ytKey = v => v.id || 'list:' + v.list;
const ytThumb = v => v.id ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : '';
async function ytTitle(v) {
  try { const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(v.id ? 'https://www.youtube.com/watch?v=' + v.id : 'https://www.youtube.com/playlist?list=' + v.list)}`); if (r.ok) return (await r.json()).title || ''; } catch { }
  return '';
}
function ytRemember(v) {
  const d = ytData(), k = ytKey(v);
  d.recent = [{ ...v, at: Date.now() }, ...d.recent.filter(x => ytKey(x) !== k)].slice(0, 30);
  d.last = { ...v };
  if (!v.title) ytTitle(v).then(t => { if (!t) return; for (const x of [...d.recent, ...d.lists.flatMap(l => l.items)]) if (ytKey(x) === k) x.title = t; if (d.last && ytKey(d.last) === k) d.last.title = t; save(); refreshWidgets('yt'); });
  save();
}
function ytPlay(h, v, listId = null) {
  h.__cur = { ...v }; h.__list = listId;
  ytRemember(v);
  const src = v.id ? `https://www.youtube.com/embed/${v.id}?rel=0&autoplay=1&enablejsapi=1&playsinline=1${v.start ? '&start=' + v.start : ''}` : `https://www.youtube.com/embed/videoseries?list=${v.list}&autoplay=1&enablejsapi=1`;
  const box = h.querySelector('.yt-player');
  if (box) { box.innerHTML = `<iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; ytListen(box.firstElementChild); }
  renderYtSide(h);
}
// ask the player to report its state, so a playlist moves on when a video ends
function ytListen(f) { f.addEventListener('load', () => { const ping = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch { } }; ping(); setTimeout(ping, 800); }); }
window.addEventListener('message', e => {
  if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin || 'http://x').hostname)) return;
  let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  const ended = (d?.event === 'onStateChange' && d.info === 0) || (d?.event === 'infoDelivery' && d.info?.playerState === 0);
  if (!ended) return;
  for (const h of document.querySelectorAll('.wg-host[data-wg="yt"]')) if (h.querySelector('.yt-player iframe')?.contentWindow === e.source && h.__list && h.__auto !== false) ytStep(h, 1);
});
function ytStep(h, dir) {
  const l = ytData().lists.find(x => x.id === h.__list); if (!l?.items.length) return;
  const i = l.items.findIndex(x => ytKey(x) === ytKey(h.__cur || {})), j = i + dir;
  if (j < 0 || j >= l.items.length) return toast(dir > 0 ? 'That was the last video in the playlist.' : 'This is the first video.');
  ytPlay(h, l.items[j], l.id);
}
function renderYt(h) {
  const d = ytData();
  if (!h.querySelector('.yt')) {
    h.innerHTML = `<div class="yt"><form class="yt-bar"><input data-yt-url placeholder="Paste a YouTube link (video or playlist)…"><button>${IC('ico:play')} Play</button><button type="button" data-yt="side" title="Recent and playlists">${IC('ico:scroll')}</button></form>
      <div class="yt-main"><div class="yt-player"></div><div class="yt-side"></div></div></div>`;
    h.querySelector('form').onsubmit = e => { e.preventDefault(); const inp = h.querySelector('[data-yt-url]'), v = ytParse(inp.value); if (!v) return toast('That doesn\'t look like a YouTube link.'); inp.value = ''; ytPlay(h, v, null); };
    h.onclick = e => ytClick(h, e);
    h.onchange = e => { if (e.target.dataset.yt === 'pick') { h.__tab = 'list'; h.__showList = e.target.value; renderYtSide(h); } if (e.target.dataset.yt === 'auto') { h.__auto = e.target.checked; } };
    if (d.last && !h.__cur) { h.__cur = { ...d.last }; const box = h.querySelector('.yt-player'); box.innerHTML = `<button class="yt-resume" data-yt="resume">${d.last.id ? `<img src="${ytThumb(d.last)}" alt="">` : ''}<span>${IC('ico:play')} ${esc(d.last.title || 'Play the last video')}</span></button>`; }
    else if (!d.last) h.querySelector('.yt-player').innerHTML = `<div class="yt-empty">${IC('ico:youtube')}<div>Paste a YouTube link above.<br><small>Videos you play are kept under Recent. Make playlists to switch between them in class.</small></div></div>`;
  }
  h.querySelector('.yt').classList.toggle('side-off', !!h.__sideOff);
  renderYtSide(h);
}
function renderYtSide(h) {
  const side = h.querySelector('.yt-side'); if (!side) return;
  const d = ytData(), tab = h.__tab || 'recent', cur = h.__cur, curK = cur && ytKey(cur);
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  const item = (v, i, list) => `<div class="yt-item ${ytKey(v) === curK && (!list || h.__list === list.id) ? 'cur' : ''}" data-k="${esc(ytKey(v))}" data-i="${i}">
      <button class="yt-th" data-yt="${list ? 'lplay' : 'rplay'}">${v.id ? `<img src="${ytThumb(v)}" alt="" loading="lazy">` : IC('ico:youtube')}</button>
      <button class="yt-t" data-yt="${list ? 'lplay' : 'rplay'}">${esc(v.title || (v.id ? 'Video ' + v.id : 'YouTube playlist'))}</button>
      <span class="yt-acts">${list ? `<button data-yt="up" title="Move up">${IC('ico:up')}</button><button data-yt="lrm" title="Remove from playlist">${IC('ico:close')}</button>` : `<button data-yt="radd" title="Add to a playlist">＋</button><button data-yt="rrm" title="Remove from Recent">${IC('ico:close')}</button>`}</span></div>`;
  side.innerHTML = `
    <div class="yt-tabs"><button data-yt="tab" data-v="recent" class="${tab === 'recent' ? 'on' : ''}">Recent</button><button data-yt="tab" data-v="list" class="${tab === 'list' ? 'on' : ''}">Playlists</button></div>
    ${h.__list && cur ? `<div class="yt-now">${IC('ico:play')} <span>${esc(d.lists.find(l => l.id === h.__list)?.name || '')}</span><button data-yt="prev" title="Previous">${IC('ico:chevleft')}</button><button data-yt="next" title="Next">${IC('ico:chevright')}</button><label title="Play the next video when one ends"><input type="checkbox" data-yt="auto" ${h.__auto !== false ? 'checked' : ''}> auto</label></div>` : ''}
    ${cur ? `<button class="yt-addcur" data-yt="addcur">＋ Add this video to a playlist</button>` : ''}
    ${tab === 'recent'
      ? `<div class="yt-list">${d.recent.map((v, i) => item(v, i)).join('') || '<div class="yt-none">Nothing yet.</div>'}</div>${d.recent.length ? '<button class="yt-clear" data-yt="rclear">Clear recent</button>' : ''}`
      : `<div class="yt-lhead">${d.lists.length ? `<select data-yt="pick">${d.lists.map(l => `<option value="${l.id}" ${l === show ? 'selected' : ''}>${esc(l.name)} (${l.items.length})</option>`).join('')}</select>` : ''}<button data-yt="lnew">＋ New</button>${show ? `<button data-yt="lplayall" title="Play from the start">${IC('ico:play')}</button><button data-yt="lren" title="Rename">${IC('ico:edit')}</button><button data-yt="ldel" title="Delete playlist">${IC('ico:trash')}</button>` : ''}</div>
         <div class="yt-list">${show ? show.items.map((v, i) => item(v, i, show)).join('') || '<div class="yt-none">Empty. Play a video, then “＋ Add this video”.</div>' : '<div class="yt-none">No playlists yet. Press ＋ New.</div>'}</div>`}`;
}
function ytPickList(h, v) {
  const d = ytData();
  let name = d.lists.length ? prompt(`Add to which playlist? Type its name (new name = new playlist):\n${d.lists.map(l => '• ' + l.name).join('\n')}`, h.__showList ? d.lists.find(l => l.id === h.__showList)?.name || '' : d.lists[0].name) : prompt('Name for the new playlist:', 'Concert pieces');
  name = name?.trim(); if (!name) return;
  let l = d.lists.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!l) d.lists.push(l = { id: uid(), name, items: [] });
  if (l.items.some(x => ytKey(x) === ytKey(v))) return toast(`Already in “${l.name}”.`);
  l.items.push({ ...v, at: undefined }); delete l.items.at(-1).at;
  h.__showList = l.id; save(); toast(`Added to “${l.name}”.`); refreshWidgets('yt');
}
function ytClick(h, e) {
  const b = e.target.closest('[data-yt]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return; e.stopPropagation();
  const d = ytData(), act = b.dataset.yt, row = b.closest('[data-i]'), i = row ? +row.dataset.i : -1;
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  if (act === 'side') { h.__sideOff = !h.__sideOff; return renderYt(h); }
  if (act === 'resume') return ytPlay(h, d.last, null);
  if (act === 'tab') { h.__tab = b.dataset.v; return renderYtSide(h); }
  if (act === 'rplay') return ytPlay(h, d.recent[i], null);
  if (act === 'lplay') return ytPlay(h, show.items[i], show.id);
  if (act === 'lplayall' && show?.items.length) return ytPlay(h, show.items[0], show.id);
  if (act === 'prev' || act === 'next') return ytStep(h, act === 'next' ? 1 : -1);
  if (act === 'addcur' && h.__cur) return ytPickList(h, h.__cur);
  if (act === 'radd') return ytPickList(h, d.recent[i]);
  if (act === 'rrm') d.recent.splice(i, 1);
  if (act === 'rclear' && confirm('Clear the recently watched list?')) d.recent = [];
  if (act === 'lnew') { const n = prompt('Name for the new playlist:', ''); if (!n?.trim()) return; const l = { id: uid(), name: n.trim(), items: [] }; d.lists.push(l); h.__showList = l.id; h.__tab = 'list'; }
  if (act === 'lren' && show) { const n = prompt('Rename the playlist:', show.name); if (n?.trim()) show.name = n.trim(); }
  if (act === 'ldel' && show && confirm(`Delete the playlist “${show.name}”? (The videos stay in Recent.)`)) { d.lists = d.lists.filter(l => l !== show); h.__showList = null; if (h.__list === show.id) h.__list = null; }
  if (act === 'lrm' && show) show.items.splice(i, 1);
  if (act === 'up' && show && i > 0) [show.items[i - 1], show.items[i]] = [show.items[i], show.items[i - 1]];
  save(); refreshWidgets('yt');
}

// ---------- recorder: record the group, listen back, then save it or delete it
// REC = the recording in progress; PLAY = what the player at the top of the window is showing.
const REC = { state: 'idle' };   // idle | countin | rec | stopping | review
const PLAY = { au: null, view: null };   // view: null | 'review' | 'saved' | 'compare'
const fmtSec = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const recMime = () => !window.MediaRecorder ? '' : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
const recElapsed = () => REC.state !== 'rec' ? 0 : (REC.acc || 0) + (REC.paused ? 0 : Date.now() - REC.t0);
const recDefaultName = () => { const c = currentClass(), d = now(); return `${c ? c.name + ' ' : ''}${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
const recOpts = () => (S.settings.rec ||= { count: 'none', tempo: 0, beats: 0, aec: false });
const refreshRec = () => document.querySelectorAll('.wg-host[data-wg="rec"]').forEach(renderRec);
const recHosts = () => [...document.querySelectorAll('.wg-host[data-wg="rec"]')];
const playAu = () => { if (!PLAY.au) { const a = PLAY.au = new Audio(); a.preservesPitch = a.webkitPreservesPitch = true; a.onplay = a.onpause = a.onended = () => recHosts().forEach(h => { const b = h.querySelector('[data-rc="pp"]'); if (b) b.innerHTML = IC(a.paused ? 'ico:play' : 'ico:pause'); }); } return PLAY.au; };
// tempo for the count-in: what you typed, else the open Metronome's, else 100 / 4
function recTempo() { const o = recOpts(), m = winList().find(w => w.kind === 'metro')?.mu; return { tempo: o.tempo || m?.tempo || 100, beats: o.beats || m?.beats || 4 }; }

// --- mic level check (before recording)
async function recMeter(on) {
  if (!on) { REC.meter?.stream.getTracks().forEach(t => t.stop()); REC.meter = null; return refreshRec(); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const an = ac().createAnalyser(); an.fftSize = 1024; ac().createMediaStreamSource(stream).connect(an); ac().resume();
    REC.meter = { stream, an }; refreshRec();
    const buf = new Float32Array(an.fftSize);
    const loop = () => {
      if (!REC.meter || REC.meter.an !== an) return;
      if (!recHosts().length) return recMeter(false);
      an.getFloatTimeDomainData(buf); let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
      const pct = Math.min(100, Math.round(Math.pow(pk, 0.6) * 100));
      recHosts().forEach(h => { const b = h.querySelector('.rec-lvl i'); if (b) { b.style.width = pct + '%'; b.className = pk > 0.95 ? 'clip' : pk > 0.5 ? 'hot' : ''; } const t = h.querySelector('.rec-lvl-t'); if (t) t.textContent = pk > 0.95 ? 'Too loud: move the device back' : pk < 0.02 ? 'Very quiet' : 'Good level'; });
      requestAnimationFrame(loop);
    };
    loop();
  } catch { toast('Rehearsal needs the microphone. Allow it and try again.'); }
}

// --- recording
async function recBegin() {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return toast('Recording is not supported here.');
  if (REC.meter) recMeter(false);
  playAu().pause(); closePlayer();
  const o = recOpts();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: !!o.aec, noiseSuppression: false, autoGainControl: false } }); }
  catch { return toast('Rehearsal needs the microphone to record. Allow it and try again.'); }
  if (ac().state === 'suspended') await ac().resume();
  REC.stream = stream;
  if (o.count === 'none') return recGo();
  // count-in: one bar of clicks, then recording starts (the click can keep going with "count + click")
  const { tempo, beats } = recTempo(), c = ac(), beat = 60 / tempo, t0 = c.currentTime + 0.15;
  for (let i = 0; i < beats; i++) metClick(t0 + i * beat, i === 0 ? 'down' : 'beat');
  REC.state = 'countin'; REC.count = beats; refreshRec();
  for (let i = 0; i < beats; i++) setTimeout(() => { REC.count = beats - i; recHosts().forEach(h => { const n = h.querySelector('.rec-count b'); if (n) { n.textContent = i + 1; n.classList.remove('hit'); void n.offsetWidth; n.classList.add('hit'); } }); }, (t0 - c.currentTime + i * beat) * 1000);
  REC.countT = setTimeout(() => { if (REC.state !== 'countin') return; recGo(); if (o.count === 'click') recClick(t0 + beats * beat, beat, beats); }, (t0 - c.currentTime + beats * beat) * 1000 - 30);
}
function recClick(next, beat, beats) {
  let i = 0; const c = ac();
  REC.clickT = setInterval(() => {
    if (REC.state !== 'rec') return clearInterval(REC.clickT);
    while (next < c.currentTime + 0.12) { if (!REC.paused) metClick(next, i % beats === 0 ? 'down' : 'beat'); next += beat; i++; }
  }, 25);
}
function recGo() {
  const stream = REC.stream, mime = recMime(), mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mr.onstop = () => recFinished(new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' }));
  const an = ac().createAnalyser(); an.fftSize = 2048; ac().createMediaStreamSource(stream).connect(an);
  Object.assign(REC, { state: 'rec', mr, an, live: [], marks: [], t0: Date.now(), acc: 0, paused: false, name: recDefaultName() });
  mr.start(1000); refreshRec(); recTick();
}
function recTick() {
  if (REC.state !== 'rec') return;
  if (!REC.paused) {
    const buf = new Float32Array(REC.an.fftSize); REC.an.getFloatTimeDomainData(buf);
    let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
    REC.live.push(pk); if (REC.live.length > 600) REC.live.shift();
  }
  recHosts().forEach(h => {
    const t = h.querySelector('.rec-time'); if (t) t.textContent = fmtSec(recElapsed() / 1000);
    const c = h.querySelector('canvas.rec-live-wave'); if (c) drawWave(c, REC.live, null, true);
  });
  requestAnimationFrame(recTick);
}
function recPause() {
  if (REC.state !== 'rec') return;
  if (REC.paused) { REC.mr.resume(); REC.t0 = Date.now(); REC.paused = false; }
  else { REC.mr.pause(); REC.acc += Date.now() - REC.t0; REC.paused = true; }
  refreshRec();
}
function recMark() { if (REC.state !== 'rec') return; REC.marks.push({ t: recElapsed() / 1000 }); refreshRec(); toast(`Marked ${fmtSec(recElapsed() / 1000)}`); }
function recStop() {
  if (REC.state === 'countin') { clearTimeout(REC.countT); REC.stream?.getTracks().forEach(t => t.stop()); REC.state = 'idle'; return refreshRec(); }
  if (REC.state !== 'rec') return;
  REC.dur = recElapsed() / 1000; REC.state = 'stopping'; clearInterval(REC.clickT);
  REC.mr.stop(); REC.stream.getTracks().forEach(t => t.stop()); refreshRec();
}
async function recFinished(blob) {
  REC.state = 'review'; REC.blob = blob;
  await openPlayer({ view: 'review', blob, dur: REC.dur, marks: REC.marks.slice(), name: REC.name });
}
function recDiscard() { for (const k of Object.keys(REC)) delete REC[k]; REC.state = 'idle'; closePlayer(); refreshRec(); }

// --- the player (review a new take, or open a saved recording)
async function decodePeaks(blob, n = 500) {
  const buf = await ac().decodeAudioData(await blob.arrayBuffer()), d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), peaks = [];
  for (let i = 0; i < n; i++) { let pk = 0; for (let j = i * step, e = Math.min(d.length, j + step); j < e; j++) pk = Math.max(pk, Math.abs(d[j])); peaks.push(pk); }
  return { buf, peaks, dur: buf.duration };
}
const miniPeaks = (peaks, n = 60) => Array.from({ length: n }, (_, i) => { const a = Math.floor(i * peaks.length / n), b = Math.max(a + 1, Math.floor((i + 1) * peaks.length / n)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, peaks[j] || 0); return Math.round(m * 100) / 100; });
async function recBlob(rec) { return memBlobs[rec.fileId] || new Blob([await (await fetch(fileDirectURL(rec.fileId))).arrayBuffer()], { type: S.files[rec.fileId]?.mime || 'audio/mp4' }); }
async function openPlayer(o) {
  const au = playAu(); au.pause();
  if (PLAY.url) URL.revokeObjectURL(PLAY.url);
  Object.assign(PLAY, { view: o.view, rec: o.rec || null, blob: o.blob, url: URL.createObjectURL(o.blob), dur: o.dur || 0, peaks: null, buf: null, loop: null, trim: null, marks: o.marks || [], name: o.name, sel: null });
  au.src = PLAY.url; au.playbackRate = PLAY.rate || 1;
  refreshRec();
  try { const r = await decodePeaks(o.blob); Object.assign(PLAY, { peaks: r.peaks, buf: r.buf, dur: r.dur }); if (o.rec && !o.rec.peaks) { o.rec.peaks = miniPeaks(r.peaks); o.rec.dur ||= r.dur; save(); } }
  catch { PLAY.peaks = REC.live?.slice() || []; }
  refreshRec(); playerTick();
}
function closePlayer() { PLAY.au?.pause(); if (PLAY.url) URL.revokeObjectURL(PLAY.url); Object.assign(PLAY, { view: null, url: null, blob: null, rec: null, cmp: null, buf: null }); }
async function openSaved(rec, play = true) {
  if (REC.state === 'review') return toast('Save or delete the new recording first.');
  try { await openPlayer({ view: 'saved', rec, blob: await recBlob(rec), dur: rec.dur, marks: (rec.marks || []).slice(), name: rec.name }); }
  catch { return toast('Could not open this recording.'); }
  if (play) playAu().play().catch(() => { });
}
// keep the waveform, time and A–B loop going while it plays
function playerTick() {
  const au = PLAY.au; if (!PLAY.view || !au) return;
  if (PLAY.loop && !au.paused && au.currentTime >= PLAY.loop[1]) au.currentTime = PLAY.loop[0];
  const tEnd = PLAY.trim ? PLAY.trim[1] : PLAY.dur;
  if (PLAY.trim && !au.paused && au.currentTime >= tEnd) { au.pause(); au.currentTime = PLAY.trim[0]; }
  recHosts().forEach(h => {
    const c = h.querySelector('canvas.rec-pwave'); if (c) drawPlayer(c);
    const t = h.querySelector('.rec-ptime'); if (t) t.textContent = `${fmtSec(au.currentTime)} / ${fmtSec(PLAY.dur || au.duration || 0)}`;
  });
  requestAnimationFrame(playerTick);
}
function drawPlayer(c) {
  const au = PLAY.au, d = PLAY.dur || 1;
  drawWave(c, PLAY.peaks || [], au ? au.currentTime / d : 0);
  const g = c.getContext('2d'), W = c.width, H = c.height, dpr = devicePixelRatio || 1, acc = getComputedStyle(c).getPropertyValue('--accent').trim() || '#f2c230';
  const shade = (a, b, col) => { g.globalAlpha = 1; g.fillStyle = col; g.fillRect(a / d * W, 0, (b - a) / d * W, H); };
  const sel = PLAY.sel || PLAY.loop;
  if (sel) { shade(sel[0], sel[1], 'rgba(255,255,255,.12)'); g.fillStyle = acc; g.fillRect(sel[0] / d * W - dpr, 0, 2 * dpr, H); g.fillRect(sel[1] / d * W - dpr, 0, 2 * dpr, H); }
  if (PLAY.trim) { shade(0, PLAY.trim[0], 'rgba(0,0,0,.45)'); shade(PLAY.trim[1], d, 'rgba(0,0,0,.45)'); }
  g.fillStyle = '#ff6b6b'; g.font = `700 ${10 * dpr}px system-ui`;
  PLAY.marks.forEach((m, i) => { const x = m.t / d * W; g.fillRect(x - dpr / 2, 0, dpr, H); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 9 * dpr, 4 * dpr); g.lineTo(x, 8 * dpr); g.fill(); g.fillText(String(i + 1), x + 3 * dpr, 18 * dpr); });
  if (au) { g.fillStyle = getComputedStyle(c).color; g.globalAlpha = .9; g.fillRect(au.currentTime / d * W - dpr, 0, 2 * dpr, H); g.globalAlpha = 1; }
}
/** peaks 0..1; live = newest on the right; prog = 0..1 played. */
function drawWave(c, peaks, prog, live) {
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (!r.width) return;
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const g = c.getContext('2d'), W = c.width, H = c.height, bw = 3 * dpr, gap = 2 * dpr, n = Math.floor(W / (bw + gap));
  g.clearRect(0, 0, W, H); g.globalAlpha = 1;
  const col = getComputedStyle(c).color, acc = getComputedStyle(c).getPropertyValue('--accent').trim() || '#f2c230';
  const src = peaks || [], data = live ? src.slice(-n) : Array.from({ length: n }, (_, i) => { const a = Math.floor(i * src.length / n), b = Math.max(a + 1, Math.floor((i + 1) * src.length / n)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, src[j] || 0); return m; });
  const max = live ? 0.5 : Math.max(0.05, ...data);
  data.forEach((v, i) => {
    const h = Math.max(2 * dpr, Math.min(1, v / max) * (H - 4 * dpr)), x = live ? W - (data.length - i) * (bw + gap) : i * (bw + gap);
    g.fillStyle = prog != null && i / n <= prog ? acc : col; g.globalAlpha = prog != null && i / n > prog ? 0.45 : 0.9;
    g.beginPath(); g.roundRect ? g.roundRect(x, (H - h) / 2, bw, h, bw / 2) : g.rect(x, (H - h) / 2, bw, h); g.fill();
  });
  g.globalAlpha = 1;
}
const miniWave = p => !p?.length ? '' : `<svg class="rec-mini" viewBox="0 0 ${p.length * 3} 20" preserveAspectRatio="none">${p.map((v, i) => { const h = Math.max(1.5, Math.min(1, v / Math.max(0.05, ...p)) * 18); return `<rect x="${i * 3}" y="${(20 - h) / 2}" width="2" height="${h}" rx="1"/>`; }).join('')}</svg>`;

// 16-bit mono WAV of part of a decoded recording (used when you trim before saving)
function encodeWav(buf, a, b) {
  const sr = buf.sampleRate, s0 = Math.floor(a * sr), s1 = Math.min(buf.length, Math.floor(b * sr)), n = Math.max(0, s1 - s0), ch = buf.numberOfChannels;
  const out = new DataView(new ArrayBuffer(44 + n * 2)), str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) { let v = 0; for (const c of chans) v += c[s0 + i]; v = Math.max(-1, Math.min(1, v / ch)); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}
async function recSave(name, addTab) {
  name = (name || '').trim() || recDefaultName();
  let blob = REC.blob, dur = PLAY.dur || REC.dur || 0, marks = PLAY.marks.slice(), peaks = PLAY.peaks || [];
  if (PLAY.trim && PLAY.buf) {
    const [a, b] = PLAY.trim; blob = encodeWav(PLAY.buf, a, b); dur = b - a;
    marks = marks.filter(m => m.t >= a && m.t <= b).map(m => ({ ...m, t: m.t - a }));
    const n = peaks.length; peaks = peaks.slice(Math.floor(a / PLAY.dur * n), Math.ceil(b / PLAY.dur * n));
  }
  const type = blob.type.split(';')[0], ext = /wav/.test(type) ? 'wav' : /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
  let fileId;
  try { fileId = await storeFile(new File([blob], `${name}.${ext}`, { type })); }
  catch { return toast('Could not save the recording.'); }
  const cls = currentClass();
  (S.recordings ||= []).unshift({ id: uid(), fileId, name, date: Date.now(), dur, classId: cls?.id || '', marks, peaks: miniPeaks(peaks) });
  if (addTab && cls) { cls.resources.push({ id: uid(), title: name, fileId }); P.stageKey = ''; }
  save(); toast(addTab && cls ? `Saved “${name}” and added it as a tab in ${cls.name}.` : `Saved “${name}”.`);
  recDiscard();
}
async function recExport(rec) {
  const m = S.files[rec.fileId]; if (!m) return toast('This recording is missing.');
  if (native('saveFile', { id: rec.fileId, name: m.name })) return;
  try {
    const blob = await recBlob(rec), file = new File([blob], m.name, { type: m.mime });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: rec.name });
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = m.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { if (e?.name !== 'AbortError') toast('Could not export the recording.'); }
}
// A/B compare: the same moment in two takes
async function cmpShow(which) {
  const c = PLAY.cmp; if (!c) return;
  const au = playAu(), t = au.currentTime, playing = !au.paused, rec = c[which];
  c.which = which;
  try { await openPlayer({ view: 'compare', rec, blob: await recBlob(rec), dur: rec.dur, marks: (rec.marks || []).slice(), name: rec.name }); } catch { return toast('Could not open the recording.'); }
  PLAY.cmp = c;
  const go = () => { au.currentTime = Math.min(t, (PLAY.dur || 1) - 0.05); if (playing) au.play().catch(() => { }); };
  if (au.readyState >= 1) go(); else au.addEventListener('loadedmetadata', go, { once: true });
  refreshRec();
}

function renderRec(h) {
  const cls = currentClass(), list = (S.recordings ||= []), st = REC.state, o = recOpts(), au = playAu();
  const isToday = r => dateKey(new Date(r.date)) === dateKey(new Date());
  const row = r => `<div class="rec-item ${PLAY.rec?.id === r.id ? 'cur' : ''} ${PLAY.cmpPick === r.id ? 'pick' : ''}" data-rid="${r.id}">
      <button class="rec-play" data-rc="open" title="Play">${IC(PLAY.rec?.id === r.id && !au.paused ? 'ico:pause' : 'ico:play')}</button>
      <div class="rec-info"><input data-rc-name value="${esc(r.name)}"><span>${new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${fmtSec(r.dur)}${r.marks?.length ? ` · ${r.marks.length} mark${r.marks.length > 1 ? 's' : ''}` : ''}${r.classId && r.classId !== cls?.id ? ' · ' + esc(S.classes.find(c => c.id === r.classId)?.name || '') : ''}</span></div>
      ${miniWave(r.peaks)}
      <span class="rec-acts"><button data-rc="cmp" title="Compare with another recording">A/B</button>
      <button data-rc="export" title="${IS_NATIVE ? 'Save a copy to your Mac' : 'Share or save a copy'}">${IC('ico:external')}</button>
      ${cls ? `<button data-rc="tab" title="Add as a tab in ${esc(cls.name)}">${IC('ico:pin')}</button>` : ''}
      <button data-rc="del" title="Delete">${IC('ico:trash')}</button></span></div>`;
  const today = list.filter(isToday), older = list.filter(r => !isToday(r));
  const player = () => {
    const c = PLAY.cmp;
    return `<div class="rec-player-card ${PLAY.view}">
      ${PLAY.view === 'review' ? '<div class="rec-q">Keep this recording?</div>' : PLAY.view === 'compare' ? `<div class="rec-cmp"><span class="me-seg"><button data-rc="cmpA" class="${c.which === 'a' ? 'on' : ''}">A · ${esc(c.a.name)}</button><button data-rc="cmpB" class="${c.which === 'b' ? 'on' : ''}">B · ${esc(c.b.name)}</button></span><span class="grow"></span><button data-rc="close" title="Close">${IC('ico:close')}</button></div>` : `<div class="rec-ph"><b>${esc(PLAY.name || '')}</b><span class="grow"></span><button data-rc="close" title="Close">${IC('ico:close')}</button></div>`}
      <div class="rec-player"><button class="rec-play big" data-rc="pp" title="Play / pause (Space)">${IC(au.paused ? 'ico:play' : 'ico:pause')}</button>
        <canvas class="rec-wave rec-pwave" title="Click to jump · drag to loop a section"></canvas></div>
      <div class="rec-ctl"><span class="rec-ptime">0:00 / ${fmtSec(PLAY.dur)}</span>
        <select data-rc-rate title="Playback speed">${[[0.5, '0.5×'], [0.75, '0.75×'], [1, '1×']].map(([v, l]) => `<option value="${v}" ${(PLAY.rate || 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button data-rc="markp" title="Add a marker here">${IC('ico:pin')} Mark</button>
        ${PLAY.loop ? `<button data-rc="unloop" class="on">${IC('ico:repeat')} ${fmtSec(PLAY.loop[0])}–${fmtSec(PLAY.loop[1])} ×</button>` : '<span class="rec-hint">Drag on the waveform to loop a section</span>'}
        ${PLAY.view === 'review' && PLAY.loop && PLAY.buf ? `<button data-rc="trim" title="Keep only the looped section when you save">Trim to this</button>` : ''}
        ${PLAY.trim ? `<button data-rc="untrim" class="on">Trimmed ${fmtSec(PLAY.trim[0])}–${fmtSec(PLAY.trim[1])} · undo</button>` : ''}</div>
      ${PLAY.marks.length ? `<div class="rec-marks">${PLAY.marks.map((m, i) => `<span class="rec-mk"><button data-rc="mjump" data-i="${i}">${i + 1} · ${fmtSec(m.t)}${m.label ? ' ' + esc(m.label) : ''}</button><button class="x" data-rc="mdel" data-i="${i}" title="Remove">${IC('ico:close')}</button></span>`).join('')}</div>` : ''}
      ${PLAY.view === 'review' ? `<label class="rec-name">Name <input data-rc-newname value="${esc(REC.name || '')}"></label>
        ${cls ? `<label class="rec-tab"><input type="checkbox" data-rc-addtab> Also add it as a tab in ${esc(cls.name)}</label>` : ''}
        <div class="rec-btns"><button class="danger" data-rc="discard">${IC('ico:trash')} Delete</button><button class="primary" data-rc="save">${IC('ico:check')} Save</button></div>` : ''}
    </div>`;
  };
  let top;
  if (st === 'countin') top = `<div class="rec-live rec-count"><div>Get ready…</div><b>1</b><button data-rc="stop">Cancel</button></div>`;
  else if (st === 'rec' || st === 'stopping') top = `<div class="rec-live ${REC.paused ? 'paused' : ''}">
      <div class="rec-status"><i class="rec-dot"></i>${REC.paused ? 'Paused' : 'Recording'}${REC.marks?.length ? ` <span class="rec-nm">${REC.marks.length} mark${REC.marks.length > 1 ? 's' : ''}</span>` : ''} <b class="rec-time">${fmtSec(recElapsed() / 1000)}</b></div>
      <canvas class="rec-wave rec-live-wave"></canvas>
      <div class="rec-btns"><button data-rc="mark" title="Drop a marker here to find it later (M)">${IC('ico:pin')} Mark</button><span class="grow"></span><button data-rc="pause">${IC(REC.paused ? 'ico:play' : 'ico:pause')} ${REC.paused ? 'Resume' : 'Pause'}</button><button class="rec-stop" data-rc="stop">${IC('ico:stop')} Stop</button></div></div>`;
  else if (PLAY.view) top = player();
  else {
    const { tempo, beats } = recTempo();
    top = `<div class="rec-idle"><button class="rec-big" data-rc="start" title="Start recording"><i></i></button>
      <div class="rec-opts">
        <label>Start <select data-rc-opt="count"><option value="none" ${o.count === 'none' ? 'selected' : ''}>Right away</option><option value="count" ${o.count === 'count' ? 'selected' : ''}>After a count-in</option><option value="click" ${o.count === 'click' ? 'selected' : ''}>Count-in + click</option></select></label>
        ${o.count !== 'none' ? `<label><input type="number" data-rc-opt="tempo" value="${tempo}" min="30" max="240"> BPM</label><label><input type="number" data-rc-opt="beats" value="${beats}" min="1" max="12"> beats</label>` : ''}
        ${o.count === 'click' ? `<label class="mu-chk" title="Uses echo cancellation to remove the click Rehearsal plays. It can make the music sound a little thinner."><input type="checkbox" data-rc-opt="aec" ${o.aec ? 'checked' : ''}> Keep the click out of the recording</label>` : ''}
      </div>
      <div class="rec-meter">${REC.meter ? `<span class="rec-lvl"><i></i></span><span class="rec-lvl-t"></span><button data-rc="meter" class="on">Stop check</button>` : `<button data-rc="meter">${IC('ico:mic')} Check mic level</button>`}</div></div>`;
  }
  h.innerHTML = `<div class="rec">${top}
    <div class="rec-list">${list.length ? '' : '<div class="rec-lh">Saved recordings</div><div class="rec-none">None yet.</div>'}
      ${today.length ? `<div class="rec-lh">Today</div>${today.map(row).join('')}` : ''}
      ${older.length ? `<div class="rec-lh">Earlier</div>${older.map(row).join('')}` : ''}</div></div>`;
  if (PLAY.view) requestAnimationFrame(() => { const c = h.querySelector('canvas.rec-pwave'); if (c) drawPlayer(c); });

  // drag on the waveform = loop that section; click = jump there
  const pw = h.querySelector('canvas.rec-pwave');
  if (pw) pw.onpointerdown = e => {
    const r = pw.getBoundingClientRect(), d = PLAY.dur || 0; if (!d) return;
    const at = x => Math.max(0, Math.min(d, (x - r.left) / r.width * d)), x0 = e.clientX, a = at(x0);
    pw.setPointerCapture(e.pointerId);
    pw.onpointermove = ev => { if (Math.abs(ev.clientX - x0) > 4) { const b = at(ev.clientX); PLAY.sel = [Math.min(a, b), Math.max(a, b)]; drawPlayer(pw); } };
    pw.onpointerup = ev => {
      pw.onpointermove = pw.onpointerup = null;
      if (PLAY.sel && PLAY.sel[1] - PLAY.sel[0] > 0.3) { PLAY.loop = PLAY.sel; au.currentTime = PLAY.loop[0]; au.play().catch(() => { }); }
      else au.currentTime = at(ev.clientX);
      PLAY.sel = null; refreshRec();
    };
  };
  h.onclick = async e => {
    const b = e.target.closest('[data-rc]'); if (!b) return; e.stopPropagation();
    const act = b.dataset.rc, rec = list.find(r => r.id === b.closest('[data-rid]')?.dataset.rid);
    if (act === 'start') return recBegin();
    if (act === 'meter') return recMeter(!REC.meter);
    if (act === 'pause') return recPause();
    if (act === 'stop') return recStop();
    if (act === 'mark') return recMark();
    if (act === 'pp') { au.paused ? au.play().catch(() => { }) : au.pause(); return; }
    if (act === 'close') { closePlayer(); return refreshRec(); }
    if (act === 'markp') { PLAY.marks.push({ t: au.currentTime }); PLAY.marks.sort((x, y) => x.t - y.t); }
    if (act === 'mjump') { au.currentTime = PLAY.marks[+b.dataset.i].t; au.play().catch(() => { }); return; }
    if (act === 'mdel') PLAY.marks.splice(+b.dataset.i, 1);
    if (act === 'unloop') PLAY.loop = null;
    if (act === 'trim') { PLAY.trim = PLAY.loop; PLAY.loop = null; au.currentTime = PLAY.trim[0]; }
    if (act === 'untrim') PLAY.trim = null;
    if (['markp', 'mdel'].includes(act) && PLAY.rec) { PLAY.rec.marks = PLAY.marks.slice(); save(); }
    if (['markp', 'mdel', 'unloop', 'trim', 'untrim'].includes(act)) return refreshRec();
    if (act === 'cmpA' || act === 'cmpB') return cmpShow(act === 'cmpA' ? 'a' : 'b');
    if (act === 'save') return recSave(h.querySelector('[data-rc-newname]')?.value, h.querySelector('[data-rc-addtab]')?.checked);
    if (act === 'discard') { if (confirm('Delete this recording? It can\'t be undone.')) recDiscard(); return; }
    if (!rec) return;
    if (act === 'open') { if (PLAY.rec?.id === rec.id) { au.paused ? au.play().catch(() => { }) : au.pause(); return refreshRec(); } return openSaved(rec); }
    if (act === 'export') return recExport(rec);
    if (act === 'cmp') {
      if (REC.state === 'review') return toast('Save or delete the new recording first.');
      if (!PLAY.cmpPick || PLAY.cmpPick === rec.id) { PLAY.cmpPick = PLAY.cmpPick === rec.id ? null : rec.id; if (PLAY.cmpPick) toast('Now press A/B on the recording to compare it with.'); return refreshRec(); }
      const a = list.find(r => r.id === PLAY.cmpPick); PLAY.cmpPick = null; if (!a) return;
      PLAY.cmp = { a, b: rec, which: 'a' }; au.currentTime = 0; return cmpShow('a');
    }
    if (act === 'tab' && cls) { if (cls.resources.some(r => r.fileId === rec.fileId)) return toast(`It's already a tab in ${cls.name}.`); cls.resources.push({ id: uid(), title: rec.name, fileId: rec.fileId }); P.stageKey = ''; save(); return toast(`Added “${rec.name}” as a tab in ${cls.name}.`); }
    if (act === 'del') {
      if (!confirm(`Delete “${rec.name}”? It can't be undone.`)) return;
      if (PLAY.rec?.id === rec.id || PLAY.cmp?.a === rec || PLAY.cmp?.b === rec) closePlayer();
      S.recordings = list.filter(r => r !== rec);
      if (!S.classes.some(c => c.resources.some(r => r.fileId === rec.fileId))) deleteFile(rec.fileId);
      save(); refreshRec();
    }
  };
  h.onchange = e => {
    const el = e.target;
    if (el.dataset.rcRate != null) { PLAY.rate = +el.value; au.playbackRate = PLAY.rate; return; }
    if (el.dataset.rcOpt) { const k = el.dataset.rcOpt; o[k] = el.type === 'checkbox' ? el.checked : k === 'count' ? el.value : Math.max(1, +el.value || 0); save(); return refreshRec(); }
    if (el.dataset.rcName == null) return;
    const rec = list.find(r => r.id === el.closest('[data-rid]')?.dataset.rid); if (rec) { rec.name = el.value.trim() || rec.name; save(); }
  };
  h.oninput = e => { if (e.target.dataset.rcNewname != null) REC.name = e.target.value; };
}
// keys while the Recorder is open: M = mark (while recording), Space = play / pause the player
document.addEventListener('keydown', e => {
  if (VIEW !== 'present' || !recHosts().length || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ((e.key === 'm' || e.key === 'M') && REC.state === 'rec') { e.preventDefault(); recMark(); }
  else if (e.key === ' ' && PLAY.view) { e.preventDefault(); const au = playAu(); au.paused ? au.play().catch(() => { }) : au.pause(); }
});

function winTitle(w) {
  if (w.customTitle) return w.customTitle;
  if (w.kind === 'sight') return 'Sight reading';
  if (w.kind === 'score') return (w.score?.name || S.files[w.score?.fileId]?.name || 'Score').replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '');
  if (w.kind === 'tuner') return 'Tuner & drone';
  if (w.kind === 'metro') return 'Metronome';
  if (w.kind === 'cal') return 'Calendar';
  if (w.kind === 'rec') return 'Recorder';
  if (w.kind === 'yt') return 'YouTube';
  if (w.kind === 'prog') { const c = currentClass(); return 'Progress' + (c ? ' — ' + c.name : ''); }
  if (w.kind === 'app') return (w.appName || 'App') + (w.title ? ' — ' + w.title : '');
  if (w.kind === 'warmup') return 'Warm-up';
  if (w.kind === 'file') return S.files[w.fileId]?.name || 'File';
  if (w.kind === 'res') return winRes(w)?.title || 'Resource';
  if (w.title) return w.title;
  try { return new URL(w.url).hostname.replace(/^www\./, ''); } catch { return 'New window'; }
}
function winIcon(w) {
  if (!iconOn('win')) return '';
  const v = winIcon0(w); return v === '-' ? '' : IC(v);
}
function winIcon0(w) {
  if (w.icon) return w.icon;
  if (w.kind === 'sight') return 'ico:sight';
  if (w.kind === 'score') return 'ico:score';
  if (w.kind === 'tuner') return 'ico:tuner';
  if (w.kind === 'metro') return 'ico:metro';
  if (WIDGETS[w.kind]) return WIDGETS[w.kind].icon;
  if (w.kind === 'app') return 'ico:app';
  if (w.kind === 'warmup') return 'ico:warmup';
  if (w.kind === 'file') { const r = { fileId: w.fileId }; return kindIcon(resKind(r)); }
  if (w.kind === 'res') { const r = winRes(w); return r ? resIcon(r) : 'ico:warn'; }
  return 'ico:web';
}
function addWindow(w) {
  const list = winList(), n = list.length;
  Object.assign(w, { id: uid(), x: 0.04 + 0.035 * (n % 6), y: 0.03 + 0.045 * (n % 6), w: 0.56, h: 0.78, z: topZ(list) + 1 });
  list.push(w); save(); P.winMenu = false; renderWinMenu(); renderDock(); WIN.sig = ''; renderWins(context(now()));
  return w;
}
function tileWindows() {
  const list = winList(); if (!list.length) return toast('No windows open. Use ＋ Window to open one.');
  const n = list.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), g = 0.01;
  list.forEach((w, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;  // last row stretches to fill
    const cw = (1 - g * (inRow - 1)) / inRow, rh = (1 - g * (rows - 1)) / rows;
    w.max = false; w.x = c * (cw + g); w.w = cw; w.y = r * (rh + g); w.h = rh;
  });
  save(); applyWinGeom();
}
function winBodyHTML(w) {
  if (w.native) return '';
  if (w.kind === 'sight') return `<div class="sr-host" data-sr-win="${w.id}"></div>`;
  if (w.kind === 'score') return `<div class="score-host" data-score-win="${w.id}"></div>`;
  if (w.kind === 'res' && winRes(w)?.score) return `<div class="score-host" data-score-res="${w.resId}"></div>`;
  if (w.kind === 'tuner' || w.kind === 'metro') return `<div class="mu-host" data-mu-win="${w.id}"></div>`;
  if (WIDGETS[w.kind]) return widgetHost(w.kind);
  if (w.kind === 'res' && winRes(w)?.widget) return widgetHost(winRes(w).widget.kind);
  if (w.kind === 'res' && winRes(w)?.music) return `<div class="mu-host" data-mu-win="r-${w.resId}-w${w.id}" data-mu-res="${w.resId}"></div>`;
  if (w.kind === 'res' && winRes(w)?.sight) return `<div class="sr-host" data-sr-res="${w.resId}"></div>`;
  if (w.kind === 'warmup') { const cls = currentClass(); return `<div class="warmup"><div class="lbl">Warm-up question</div><div class="q">${esc(cls?.warmup || 'Welcome!')}</div></div>`; }
  if (w.kind === 'file' || (w.kind === 'res' && winRes(w)?.fileId)) {
    const fid = w.kind === 'file' ? w.fileId : winRes(w).fileId, k = resKind({ fileId: fid }), src = fileDirectURL(fid);
    if (k === 'image') return `<img src="${src}">`;
    if (k === 'video') return `<video src="${src}" controls style="background:#000"></video>`;
    if (k === 'missing') return `<div class="win-start">This file is missing.</div>`;
    if (k === 'pdf') return `<div class="pdf-host" data-pdf-win="${w.id}"></div>`;
    return `<iframe src="${src}"></iframe>`;
  }
  const url = winURL(w);
  if (!url) return `<div class="win-start"><div>${IC('ico:web')}<br>Type a web address or a search above and press Return.${IS_NATIVE ? '<br><span style="font-size:13px;color:#888">Searches open in full browser mode.</span>' : ''}</div></div>`;
  const r = winRes(w);
  const src = r && r.mode === 'edit' ? editURL(embedURL(url)) : embedURL(url);
  return `<iframe src="${esc(src)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
function winHTML(w) {
  if (w.kind === 'app') return `<div class="win native" data-win="${w.id}">
    <div class="win-bar" data-wdrag="${w.id}"><span class="wi">${IC('ico:app')}</span><span class="win-title">${esc(winTitle(w))}</span>
      ${w.status === 'editing'
        ? `<button class="mode editing" data-action="app-done" title="Go back to Rehearsal">${IC('ico:annotate')} Editing — click to finish</button>`
        : `<span class="app-hint">Click inside to edit</span>`}
      <button data-action="win-reload" data-id="${w.id}" title="Reconnect">${IC('ico:reload')}</button>
      <button data-action="win-snap" data-id="${w.id}" title="Tile this window">${IC('ico:tile')}</button>
      <button data-action="win-close" data-id="${w.id}" title="Close">${IC('ico:close')}</button></div>
    <div class="win-body"></div></div>`;
  const url = winURL(w), canNative = IS_NATIVE && (w.kind === 'web' || (w.kind === 'res' && !!url));
  const pinned = ['res', 'warmup'].includes(w.kind);
  const nav = WIN.nav[w.id] || {};
  return `<div class="win ${w.native ? 'native' : ''}" data-win="${w.id}">
    <div class="win-bar" data-wdrag="${w.id}">
      <span class="wi">${winIcon(w)}</span>
      ${w.native ? `<button data-action="win-back" data-id="${w.id}" ${nav.back ? '' : 'disabled'} title="Back">‹</button><button data-action="win-fwd" data-id="${w.id}" ${nav.forward ? '' : 'disabled'} title="Forward">›</button>` : ''}
      ${w.kind === 'web' ? `<input class="win-url" data-wurl="${w.id}" value="${esc(w.url || '')}" placeholder="Search or type a web address" spellcheck="false">` : `<span class="win-title">${esc(winTitle(w))}</span>`}
      ${url || w.kind === 'file' ? `<button data-action="win-reload" data-id="${w.id}" title="Reload">${IC('ico:reload')}</button>` : ''}
      ${canNative ? `<button class="mode" data-action="win-native" data-id="${w.id}" title="${w.native ? 'Switch back to an embedded window (drawing works on top)' : 'Page not showing? Open it as a full browser (every site works)'}">${w.native ? 'Embedded' : 'Full browser'}</button>` : ''}
      ${w.kind === 'web' && w.url ? `<button data-action="bm-star" data-id="${w.id}" title="Bookmark this page">${IC('ico:star')}</button>` : ''}
      ${pinned ? '' : `<button data-action="win-pin" data-id="${w.id}" title="Save to this class's resources">${IC('ico:pin')}</button>`}
      ${url ? `<button data-action="open-external" data-url="${esc(url)}" title="Open in your web browser">${IC('ico:external')}</button>` : ''}
      <button class="zoom-badge" data-action="win-zoom-reset" data-id="${w.id}" title="Pinch to zoom · click to reset" hidden>100%</button>
      <button data-action="win-snap" data-id="${w.id}" title="Tile this window">${IC('ico:tile')}</button>
      <button class="max-btn ${w.max ? 'on' : ''}" data-action="win-max" data-id="${w.id}" title="${w.max ? 'Back to normal size' : 'Maximize'}">${IC(w.max ? 'ico:restore' : 'ico:maximize')}</button>
      <button data-action="win-close" data-id="${w.id}" title="Close">${IC('ico:close')}</button>
    </div>
    ${w.kind === 'web' ? bmBarHTML(w) : ''}
    <div class="win-body">${winBodyHTML(w)}</div>
    <div class="win-rs" data-wresize="${w.id}"></div></div>`;
}
function renderWins(ctx, force = false) {
  const host = $('#p-wins'); if (!host) return;
  const key = winKeyOf(ctx), list = winList(key);
  // re-render only when the set of windows or their content changes (keeps iframes alive)
  const sig = key + '|' + JSON.stringify(S.bookmarks || []).length + '|' + JSON.stringify(list.map(w => [w.id, w.kind, w.native, w.native ? '' : winURL(w), w.fileId, w.resId, w.kind === 'warmup' ? ctx.cls?.warmup : '', winRes(w)?.mode, winTitle(w)]));
  if (!force && sig === WIN.sig && key === WIN.key) return;
  // keep the URL box the teacher is typing in
  const typing = document.activeElement?.dataset?.wurl;
  if (typing && !force && key === WIN.key) return;
  WIN.sig = sig; WIN.key = key;
  host.innerHTML = list.map(winHTML).join('');
  applyWinGeom();
  mountSightHosts(host);
  for (const w of list) if ((w.zoom || 1) !== 1) applyZoom(w);
}
function applyWinGeom() {
  const list = winList(), top = topZ(list);
  for (const w of list) {
    const el = $(`.win[data-win="${w.id}"]`); if (!el) continue;
    const g = w.max ? { x: 0, y: 0, w: 1, h: 1 } : w;
    el.style.left = g.x * 100 + '%'; el.style.top = g.y * 100 + '%';
    el.style.width = g.w * 100 + '%'; el.style.height = g.h * 100 + '%';
    el.style.zIndex = w.z || 1;
    el.classList.toggle('front', w.z === top && list.length > 1);
    const mb = el.querySelector('.max-btn');
    if (mb && mb.classList.contains('on') !== !!w.max) { mb.classList.toggle('on', !!w.max); mb.title = w.max ? 'Back to normal size' : 'Maximize'; mb.innerHTML = IC(w.max ? 'ico:restore' : 'ico:maximize'); }
  }
  WIN.cutSig = '';
  // Move real browser/app views in the same frame as the page, not on the next 250 ms tick.
  if (VIEW === 'present') syncNative();
}
function bringToFront(w) {
  const list = winList(); const t = topZ(list);
  if (w.z === t) return;
  w.z = t + 1;
  save(); applyWinGeom();
}
function openWebAddress(w, raw) {
  let q = raw.trim(); if (!q) return;
  const looksURL = /^https?:\/\//i.test(q) || (/^[^\s]+\.[a-z]{2,}([\/?#:].*)?$/i.test(q) && !q.includes(' '));
  let url;
  if (looksURL) url = /^https?:\/\//i.test(q) ? q : 'https://' + q;
  else { url = 'https://www.google.com/search?q=' + encodeURIComponent(q); if (IS_NATIVE && !w.native) w.native = true; }
  if (!IS_NATIVE && !looksURL) { native('openExternal', { url }) || window.open(url, '_blank'); return; }
  w.url = url; w.title = '';
  if (w.native) native('webCmd', { id: w.id, action: 'load', url });
  save(); WIN.sig = ''; document.activeElement?.blur(); renderWins(context(now()), true);
}
window.__webNav = ({ id, url, title, back, forward }) => {
  WIN.nav[id] = { back, forward };
  const w = findWin(id); if (!w) return;
  if (url && w.kind === 'web') w.url = url;
  if (title) w.title = title;
  save();
  const el = $(`.win[data-win="${id}"]`); if (!el) return;
  const inp = el.querySelector('.win-url'); if (inp && document.activeElement !== inp) inp.value = w.url || '';
  const b = el.querySelector('[data-action="win-back"]'), f = el.querySelector('[data-action="win-fwd"]');
  if (b) b.disabled = !back; if (f) f.disabled = !forward;
};
// ---------- other apps' windows (live view + click-through, done natively)
function appPickerHTML() {
  const a = P.appPick; if (!a) return '';
  if (a === 'loading') return '<div class="wm-h">Looking for windows…</div>';
  if (!a.screen) return `<div class="wm-h">Permission needed</div><button data-action="perm" data-which="screen">${IC('ico:lock')} Allow Screen Recording for Rehearsal…</button>
    <div class="wm-note">Turn on Rehearsal in the list, then quit and reopen Rehearsal.</div>`;
  const wins = a.windows || [];
  return `<div class="wm-h">Pick a window</div>${wins.length ? wins.map((w, i) => `<button data-action="wm-app" data-i="${i}" title="${esc(w.app + (w.title ? ' — ' + w.title : ''))}">${IC('ico:app')} ${esc(w.app)}${w.title && w.title !== w.app ? `<span class="app-sub">${esc(w.title)}</span>` : ''}${w.onScreen ? '' : '<span class="app-sub">(hidden or minimized)</span>'}</button>`).join('') : '<div class="wm-note">No other app windows are open.</div>'}
    ${a.input ? '' : `<button data-action="perm" data-which="input">${IC('ico:mouse')} Allow clicks &amp; typing (Accessibility)…</button><div class="wm-note">Without it you can watch the window but not click in it.</div>`}`;
}
// Hide system helper windows, untitled background windows and exact duplicates.
const APP_SKIP = /^(loginwindow|universalAccessAuthWarn|AutoFill|Window Server|Wallpaper|Spotlight|Notification Center|Control Center|TextInputMenuAgent|CursorUIViewService|Open and Save Panel Service)/i;
window.__appWindows = data => {
  if (data && data.windows) {
    const seen = new Set();
    data.windows = data.windows.filter(w => {
      if (APP_SKIP.test(w.app || '')) return false;
      if (!w.onScreen && !w.title) return false;
      const k = w.app + '|' + w.title + '|' + w.onScreen;
      if (seen.has(k) && !w.title) return false;
      seen.add(k); return true;
    }).sort((a, b) => (b.onScreen - a.onScreen) || a.app.localeCompare(b.app) || a.title.localeCompare(b.title));
  }
  P.appPick = data; renderWinMenu();
};
// Size an app's frame so the real window fits 1:1 (scaled down only if it can't fit the screen).
function fitAppWindow(w) {
  const L = $('#p-wins')?.getBoundingClientRect(); if (!L || !w.realW) return;
  const bar = $(`.win[data-win="${w.id}"] .win-bar`)?.getBoundingClientRect().height || 33;
  let pw = w.realW + 4, ph = w.realH + bar + 4;
  const k = Math.min(1, L.width / pw, L.height / ph);   // too big for the screen → shrink to fit
  pw *= k; ph *= k;
  w.w = pw / L.width; w.h = ph / L.height; w.max = false;
  w.x = clamp(w.x, 0, Math.max(0, 1 - w.w)); w.y = clamp(w.y, 0, Math.max(0, 1 - w.h));
  applyWinGeom(); save();
}
window.addEventListener('resize', () => { for (const w of winList()) if (w.kind === 'app') fitAppWindow(w); });
window.__appWinState = ({ id, status, windowID, title, app, event, width, height }) => {
  for (const list of Object.values(S.windows || {})) {
    const w = list.find(x => x.id === id); if (!w) continue;
    if (event === 'size') { w.realW = width; w.realH = height; fitAppWindow(w); continue; }
    if (w.status !== status) { w.status = status; WIN.sig = ''; }
    if (status === 'ok') {
      const changed = w.windowID !== windowID || (title && w.title !== title);
      w.windowID = windowID; if (title) w.title = title; if (app) w.appName = app;
      if (changed) { save(); WIN.sig = ''; }
    }
    if (status === 'needs-input' && !WIN.inputWarned) { WIN.inputWarned = true; toast('To click and type in other apps, allow Rehearsal under Accessibility (opening Settings).', 6000); native('requestPermission', { which: 'input' }); }
  }
};

// ---------- pinch zoom: magnify around your fingers. Works on floating windows AND the class stage
// (pinned tabs, PDFs, slides, pictures, web pages). Two-finger double-tap toggles 2× / 1×.
// State: { zoom, zx, zy } — zx/zy are the pan offset as a fraction of the box size.
function zoomApply(box, st) {
  if (!box) return;
  const z = st.zoom || 1, tf = z === 1 ? '' : `translate(${(st.zx || 0) * 100}%, ${(st.zy || 0) * 100}%) scale(${z})`;
  for (const m of box.querySelectorAll(':scope > iframe, :scope > img, :scope > video, :scope > img.res')) { m.style.transformOrigin = '0 0'; m.style.transform = tf; }
  for (const t of box.querySelectorAll('.warmup, .win-start, .sr-staff')) t.style.zoom = z === 1 ? '' : z;
  const pages = box.querySelector('.pdfv-pages');
  if (pages) {
    const r = box.getBoundingClientRect();
    pages.style.transformOrigin = '0 0';
    pages.style.transform = z === 1 ? '' : `translate(${(st.zx || 0) * r.width}px, ${(st.zy || 0) * r.height}px) scale(${z})`;
    const ctl = box.querySelector('.pdf-host')?.__pdf;
    if (ctl) { clearTimeout(box._pdfRes); box._pdfRes = setTimeout(() => ctl.setRes(z), 250); }
  }
}
function zoomAt(st, box, sx, sy, factor) {
  const r = box.getBoundingClientRect(), z = st.zoom || 1;
  const px = sx - r.left, py = sy - r.top, tx = (st.zx || 0) * r.width, ty = (st.zy || 0) * r.height;
  const cx = (px - tx) / z, cy = (py - ty) / z;                 // content point under the fingers
  const nz = clamp(z * factor, 1, 6);
  let ntx = px - nz * cx, nty = py - nz * cy;                    // keep that point under the fingers
  ntx = clamp(ntx, r.width - nz * r.width, 0); nty = clamp(nty, r.height - nz * r.height, 0);
  Object.assign(st, { zoom: nz, zx: ntx / r.width, zy: nty / r.height });
}
const stageZoomState = () => { const c = context(now()); const k = c.key + '|' + (P.stageSel[c.key] || 'warmup'); return ((P.stageZoom ||= {})[k] ||= { zoom: 1 }); };
function applyZoom(w) {
  const el = $(`.win[data-win="${w.id}"]`); if (!el || w.native) return;
  zoomApply(el.querySelector('.win-body'), w);
  const badge = el.querySelector('.zoom-badge');
  if (badge) { badge.textContent = Math.round((w.zoom || 1) * 100) + '%'; badge.hidden = (w.zoom || 1) === 1; }
}
function applyStageZoom() {
  const box = $('#stage-content'); if (!box) return;
  const st = stageZoomState(); zoomApply(box, st);
  const b = $('#stage-tabs .zoom-badge'); if (b) { b.textContent = Math.round((st.zoom || 1) * 100) + '%'; b.hidden = (st.zoom || 1) === 1; }
}
window.__pinch = (x, y, mag, phase) => {
  if (VIEW !== 'present') return;
  const hit = document.elementsFromPoint(x, y).find(el => el !== inkCanvas && el !== inkPrev && el.id !== 'ink' && !el.classList?.contains('ink-cursor'));
  const winEl = hit?.closest('.win'), stageEl = hit?.closest('#stage-content');
  let st, box, after;
  if (winEl) { const w = findWin(winEl.dataset.win); if (!w || w.native) return; st = w; box = winEl.querySelector('.win-body'); after = () => { applyZoom(w); save(); }; }
  else if (stageEl) { st = stageZoomState(); box = stageEl; after = applyStageZoom; }
  else return;
  if (phase === 'toggle') { if ((st.zoom || 1) > 1.01) Object.assign(st, { zoom: 1, zx: 0, zy: 0 }); else zoomAt(st, box, x, y, 2); }
  else zoomAt(st, box, x, y, 1 + mag);
  if (st.zoom < 1.02 && phase !== 'change') Object.assign(st, { zoom: 1, zx: 0, zy: 0 });
  after();
};
// Two-finger scroll pans a zoomed picture/video (web pages & PDFs scroll themselves).
document.addEventListener('wheel', e => {
  if (VIEW !== 'present') return;
  const m = e.target.closest?.('.win-body img, .win-body video, #stage-content img, #stage-content video, .pdfv-view'); if (!m) return;
  const winEl = m.closest('.win'), st = winEl ? findWin(winEl.dataset.win) : stageZoomState();
  if (!st || (st.zoom || 1) === 1) return;
  e.preventDefault();
  const box = (m.closest('.win-body, #stage-content') || m.parentElement).getBoundingClientRect();
  st.zx = clamp((st.zx || 0) - e.deltaX / box.width, 1 - st.zoom, 0);
  st.zy = clamp((st.zy || 0) - e.deltaY / box.height, 1 - st.zoom, 0);
  winEl ? (applyZoom(st), save()) : applyStageZoom();
}, { passive: false });


// ---------- bookmarks (bar under the address bar of every web window)
// S.bookmarks: [{id, title, url} | {id, title, children:[...]}]
const BM = { profiles: null, open: null };   // open = {winId, folderId} for a folder dropdown
function bmFind(id, list = S.bookmarks || []) {
  for (const b of list) { if (b.id === id) return b; if (b.children) { const f = bmFind(id, b.children); if (f) return f; } }
  return null;
}
function bmBarHTML(w) {
  const list = S.bookmarks || [];
  if (!list.length) return `<div class="win-bm"><span class="bm-empty">No bookmarks yet. Click ${IC('ico:star')} to add this page, or import from Chrome in Setup → Settings.</span></div>`;
  return `<div class="win-bm">${list.map(b => b.children
    ? `<button class="bm folder" data-action="bm-folder" data-win="${w.id}" data-id="${b.id}" title="${esc(b.title)}">${IC('ico:folder')} ${esc(b.title)} ▾</button>`
    : `<button class="bm" data-action="bm-open" data-win="${w.id}" data-id="${b.id}" title="${esc(b.url)}">${esc(b.title || b.url)}</button>`).join('')}</div>`;
}
function renderBmMenu() {
  $('#bm-host')?.remove();
  if (!BM.open) return;
  const f = bmFind(BM.open.folderId), btn = $(`.win[data-win="${BM.open.winId}"] [data-action="bm-folder"][data-id="${BM.open.folderId}"]`);
  if (!f || !btn) { BM.open = null; return; }
  const r = btn.getBoundingClientRect();
  const host = document.createElement('div'); host.id = 'bm-host'; host.className = 'bm-menu';
  const items = (list, depth) => list.map(b => b.children
    ? `<div class="bm-sub" style="padding-left:${10 + depth * 12}px">${IC('ico:folder')} ${esc(b.title)}</div>${items(b.children, depth + 1)}`
    : `<button data-action="bm-open" data-win="${BM.open.winId}" data-id="${b.id}" style="padding-left:${10 + depth * 12}px" title="${esc(b.url)}">${esc(b.title || b.url)}</button>`).join('');
  host.innerHTML = items(f.children, 0) || '<div class="bm-sub">Empty folder</div>';
  $('#present').appendChild(host);
  host.style.left = clamp(r.left, 8, innerWidth - host.offsetWidth - 8) + 'px';
  host.style.top = r.bottom + 4 + 'px';
}
function chromeToOurs(node) {
  if (node.type === 'url') return { id: uid(), title: node.name || '', url: node.url };
  if (node.children) return { id: uid(), title: node.name || 'Folder', children: node.children.map(chromeToOurs).filter(Boolean) };
  return null;
}
window.__chromeBookmarks = ({ profiles }) => {
  BM.profiles = (profiles || []).map(p => {
    const bar = (p.roots?.bookmark_bar?.children || []).map(chromeToOurs).filter(Boolean);
    const other = (p.roots?.other?.children || []).map(chromeToOurs).filter(Boolean);
    const count = JSON.stringify([bar, other]).split('"url"').length - 1;
    return { name: p.name, dir: p.dir, bar, other, count };
  });
  if (VIEW === 'edit') renderEditor();
};
function bmCount(list = S.bookmarks || []) { return list.reduce((n, b) => n + (b.children ? bmCount(b.children) : 1), 0); }
function bookmarksCard() {
  const list = S.bookmarks || [];
  const prof = BM.profiles;
  const rows = (items, depth) => items.map(b => `<div class="bm-row" style="padding-left:${depth * 18}px">
      ${b.children ? `${IC('ico:folder')} <b>${esc(b.title)}</b>` : `<span class="grow">${esc(b.title || b.url)}</span><span class="small muted bm-url">${esc(b.url)}</span>`}
      <button class="iconbtn" data-action="bm-del" data-id="${b.id}" title="Remove">${IC('ico:close')}</button></div>${b.children ? rows(b.children, depth + 1) : ''}`).join('');
  return `<div class="card"><div class="card-head"><h2>Bookmarks</h2><span class="grow"></span>
      ${IS_NATIVE ? '<button class="btn small primary" data-action="bm-chrome">Import from Chrome…</button>' : ''}
      <button class="btn small" data-action="bm-add">+ Add</button>
      ${list.length ? '<button class="btn small danger" data-action="bm-clear">Remove all</button>' : ''}</div>
    <p class="desc">Shown as a bar in every web window on the Present screen. Click ${IC('ico:star')} in a web window to bookmark the page you're on. Sign in to Google once in any web window (or the Drive window) and every window stays signed in.</p>
    ${prof ? (prof.length ? `<div class="notice" style="margin-bottom:12px"><b>Choose a Chrome profile to import:</b>
        ${prof.map((p, i) => `<div class="row" style="margin-top:6px"><span class="grow">${esc(p.name)} <span class="muted small">(${p.count} bookmarks)</span></span><button class="btn small primary" data-action="bm-import" data-i="${i}">Import</button></div>`).join('')}
        <button class="btn small ghost" data-action="bm-cancel" style="margin-top:6px">Cancel</button></div>`
      : `<div class="notice" style="margin-bottom:12px">Couldn't find any Chrome bookmarks on this Mac. <button class="btn small ghost" data-action="bm-cancel">OK</button></div>`) : ''}
    ${list.length ? `<div class="bm-list">${rows(list, 0)}</div><div class="small muted" style="margin-top:6px">${bmCount()} bookmarks</div>` : '<div class="empty">No bookmarks yet.</div>'}
  </div>`;
}

// ============================================================ edit in place (Present screen)
// ✏ "Edit here" in the toolbar turns this on. Text commits when you click away or press Return
// (Shift+Return for a new line in the warm-up); Escape cancels.
const ieClass = () => { const c = context(now()); return c.mode === 'class' ? c : null; };
const ieFocused = sel => { const a = document.activeElement, el = $(sel); return !!(a && el && el.contains(a) && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))); };
function ieSide(ctx, step, evs) {
  const cls = ctx.cls, today = dateKey(now());
  const agenda = `<ol class="agenda editing">${cls.agenda.map((a, i) => `<li class="${i === step ? 'cur' : ''}" data-ag-row="${i}">
      <span class="ag-grip" data-ag-drag="${i}" title="Drag to reorder">≡</span>
      <span class="n" data-action="ag-cur" data-i="${i}" title="Make this the current step">${i + 1}</span>
      <span class="ag-text" contenteditable="true" data-ie="agenda" data-i="${i}">${esc(a.text)}</span>
      <input class="ag-min" type="number" min="0" max="240" data-ie-min="${i}" value="${a.min || ''}" placeholder="min" title="Minutes">
      <button class="ag-x" data-action="ag-del" data-i="${i}" title="Remove step">${IC('ico:close')}</button></li>`).join('')}</ol>
    <button class="ie-add" data-action="ag-add">＋ Add step</button>`;
  const todays = evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ` <span style="opacity:.7">${fmtHM(e.time)}</span>` : ''} <span class="ev-where">${e.classes?.length ? '· this class' : '· all classes'}</span><button class="ag-x" data-action="ie-ev-del" data-id="${e.id}" title="Remove">${IC('ico:close')}</button></li>`).join('');
  return `
    <div class="p-card ie-card"><h4>${IC('ico:annotate')} Editing ${esc(cls.name)} <button class="ie-done" data-action="edit-mode">Done</button></h4>
      <div class="ie-btns"><button data-action="look-open">${IC('ico:look')} Look & background</button><button data-action="auto-open">${IC('ico:auto')} Automations</button><button data-action="clip-open">${IC('ico:clip')} Copy / paste</button><button data-action="icons-open">${IC('ico:icons')} Icons</button>${ctx.cls.hideWarmup ? `<button data-action="warmup-show">${IC('ico:warmup')} Show warm-up tab</button>` : ''}</div>
      <div class="ie-tip">Click any text to change it.</div></div>
    <div class="p-card"><h4>Agenda <span class="mini-btns"><button data-action="agenda-prev">‹</button><button data-action="agenda-next">›</button></span></h4>${agenda}</div>
    <div class="p-card"><h4>Today</h4><ul class="ev-list">${todays || '<li style="opacity:.6">Nothing today.</li>'}</ul>
      <div class="ie-ev"><select data-ie-evkind><option value="announcement">Announcement</option><option value="birthday">Birthday</option><option value="event">Event</option></select>
        <input data-ie-evtext placeholder="Announcement or name…"><input type="time" data-ie-evtime title="Pop up at (optional)">
        <select data-ie-evwho title="Which classes see it"><option value="this">This class</option><option value="all">All classes</option></select>
        <button data-action="ie-ev-add">Add</button></div></div>
    <div class="p-card"><h4>${IC('ico:notes')} Notes on screen <span style="opacity:.6;text-transform:none;letter-spacing:0">(students see these, under Today)</span></h4>
      <textarea class="ie-notes" data-ie-pubnotes rows="3" placeholder="Reminders for students: bring your folder, concert dress, …">${esc((cls.screenNotes || {})[today] || '')}</textarea></div>
    <div class="p-card"><h4>${IC('ico:notes')} Today's notes <span style="opacity:.6;text-transform:none;letter-spacing:0">(private, only shown while editing)</span></h4>
      <textarea class="ie-notes" data-ie-notes rows="5" placeholder="What you covered, reminders for next time…">${esc(cls.notes[today] || '')}</textarea></div>`;
}
function ieTitle(ctx, tmplName, testChip) {
  const cls = ctx.cls, p = ctx.period;
  return `<div class="t1" contenteditable="true" data-ie="name">${esc(cls.name)}</div>
    <div class="t2"><span contenteditable="true" data-ie="subtitle" class="ie-sub" data-ph="Subtitle (period, room…)">${esc(cls.subtitle || '')}</span>
      ${testChip}
      ${p ? `<span class="ie-times" title="Changes this period on the ${tmplName} bell schedule"><input type="time" data-ie-time="start" value="${p.start}"> – <input type="time" data-ie-time="end" value="${p.end}"></span>` : ''}</div>`;
}
// events: which classes see them
document.addEventListener('change', e => {
  const el = e.target, id = el.dataset?.evCls || el.dataset?.evAll; if (!id) return;
  const ev = S.events.find(x => x.id === id); if (!ev) return;
  if (el.dataset.evAll) { if (el.checked) ev.classes = []; }
  else { const set = new Set(ev.classes || []); el.checked ? set.add(el.dataset.c) : set.delete(el.dataset.c); ev.classes = [...set]; }
  const box = el.closest('details'); save();
  box.querySelector('summary').textContent = evWhere(ev);
  box.querySelector('[data-ev-all]').checked = !ev.classes.length;
  if (!ev.classes.length) box.querySelectorAll('[data-ev-cls]').forEach(x => x.checked = false);
});
// ---------- double-click an agenda step (any time) to change its text
document.addEventListener('dblclick', e => {
  if (VIEW !== 'present' || P.editMode) return;
  const li = e.target.closest('#p-side ol.agenda:not(.editing) > li'); if (!li) return;
  const c = ieClass(); if (!c) return;
  const i = [...li.parentElement.children].indexOf(li), step = c.cls.agenda[i]; if (!step) return;
  const span = li.querySelector('span:not(.n):not(.m)'); if (!span) return;
  const before = step.text;
  span.contentEditable = 'true'; span.classList.add('ag-live'); span.focus();
  const r = document.createRange(); r.selectNodeContents(span); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const done = keep => {
    span.removeEventListener('keydown', key); span.removeEventListener('blur', blur);
    const t = span.textContent.trim();
    if (keep && t && t !== before) { step.text = t; save(); }
    span.contentEditable = 'false'; P.sideKey = '';
  };
  const key = ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); span.blur(); }
    if (ev.key === 'Escape') { ev.preventDefault(); span.textContent = before; done(false); span.blur(); }
  };
  const blur = () => done(true);
  span.addEventListener('keydown', key); span.addEventListener('blur', blur);
});
// ---------- commit edits
document.addEventListener('focusout', e => {
  const el = e.target; if (!el.dataset || !el.dataset.ie || VIEW !== 'present') return;
  const c = ieClass(); if (!c) return;
  const cls = c.cls, v = el.innerText.replace(/ /g, ' ').trim();
  if (el.dataset.ie === 'name') { if (v) cls.name = v; }
  else if (el.dataset.ie === 'subtitle') cls.subtitle = v;
  else if (el.dataset.ie === 'warmup') cls.warmup = el.innerText.trim();
  else if (el.dataset.ie === 'agenda') { const a = cls.agenda[+el.dataset.i]; if (a) a.text = v || a.text; }
  save(); P.sideKey = P.stageKey = ''; $('#p-title') && ($('#p-title')._h = '');
});
document.addEventListener('keydown', e => {
  const el = e.target; if (!el.dataset?.ie) return;
  if (e.key === 'Enter' && !(e.shiftKey && el.dataset.ie === 'warmup')) { e.preventDefault(); el.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); P.sideKey = P.stageKey = ''; $('#p-title')._h = ''; el.dataset.ie = ''; el.blur(); }
});
document.addEventListener('change', e => {
  const el = e.target, c = ieClass(); if (!c || VIEW !== 'present') return;
  if (el.dataset.ieMin != null) { const a = c.cls.agenda[+el.dataset.ieMin]; if (a) { a.min = Number(el.value) || 0; save(); P.sideKey = ''; } }
  if (el.dataset.ieTime && c.period && c.template) {
    const p = c.template.periods.find(x => x.id === c.period.id); if (!p || !el.value) return;
    const next = { ...p, [el.dataset.ieTime]: el.value };
    if (next.start >= next.end) { toast('The end time has to be after the start.'); P.sideKey = ''; $('#p-title')._h = ''; return; }
    Object.assign(p, next); save(); $('#p-title')._h = ''; toast(`Updated ${c.template.name}: ${fmtHM(p.start)}–${fmtHM(p.end)}`);
  }
});
let ieNotesT = null;
let iePubT = null;
document.addEventListener('input', e => {
  if (e.target.dataset?.iePubnotes == null) return;
  const c = ieClass(); if (!c) return;
  const k = dateKey(now()), v = e.target.value;
  clearTimeout(iePubT); iePubT = setTimeout(() => { const n = (c.cls.screenNotes ||= {}); if (v.trim()) n[k] = v; else delete n[k]; save(); }, 400);
});
document.addEventListener('input', e => {
  if (e.target.dataset?.ieNotes == null) return;
  const c = ieClass(); if (!c) return;
  const k = dateKey(now()), v = e.target.value;
  clearTimeout(ieNotesT); ieNotesT = setTimeout(() => { if (v.trim()) c.cls.notes[k] = v; else delete c.cls.notes[k]; save(); }, 400);
});
// ---------- drag agenda rows to reorder
let AGDRAG = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-ag-drag]'); if (!h || VIEW !== 'present') return;
  e.preventDefault();
  document.activeElement?.blur?.();   // finish any typing first so the list can refresh
  AGDRAG = { from: +h.dataset.agDrag, to: +h.dataset.agDrag, row: h.closest('li') };
  AGDRAG.row.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!AGDRAG) return;
  const rows = $$('[data-ag-row]');
  let to = rows.findIndex(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
  if (to < 0) to = rows.length - 1; else if (to > AGDRAG.from) to--;
  AGDRAG.to = to;
  rows.forEach((r, i) => r.classList.toggle('drop-before', i === (to >= AGDRAG.from ? to + 1 : to) && i !== AGDRAG.from));
});
document.addEventListener('pointerup', () => {
  if (!AGDRAG) return;
  const { from, to } = AGDRAG; AGDRAG = null;
  const c = ieClass();
  if (c && from !== to) { const a = c.cls.agenda; const [m] = a.splice(from, 1); a.splice(to, 0, m); save(); }
  P.sideKey = '';
});
// ---------- tab folders: a folder is one tab with a drop-down of its tabs
function stageTabsHTML(cls, res) {
  const out = [], seen = new Set(), groups = cls.groups || [];
  for (const r of cls.resources) {
    const g = r.group && groups.find(x => x.id === r.group);
    if (!g) {
      out.push(`<span class="tabwrap" draggable="true" data-tab-id="${r.id}"><button class="${res === r ? 'on' : ''}" data-action="stage" data-id="${r.id}" title="Double-click to rename · drag onto another tab to make a folder">${tabIcon(r)}${esc(r.title || 'Resource')}</button><button class="tab-x" data-action="res-remove" data-id="${r.id}" title="Remove from this class">${IC('ico:close')}</button></span>`);
      continue;
    }
    if (seen.has(g.id)) continue; seen.add(g.id);
    const cur = cls.resources.find(x => x.group === g.id && x === res);
    out.push(`<span class="tabwrap tabgroup" draggable="true" data-group-id="${g.id}"><button class="${cur ? 'on' : ''} ${P.groupMenu === g.id ? 'open' : ''}" data-action="tab-group" data-id="${g.id}" title="Folder — click to choose a tab · double-click to rename">${iconOn('tabs') ? icoSp(g.icon || 'ico:folder') : ''}${esc(g.name)}${cur ? `<span class="tg-cur"> · ${esc(cur.title || '')}</span>` : ''} <span class="tg-caret">▾</span></button></span>`);
  }
  return out.join('');
}
function renderGroupMenu() {
  $('#group-menu')?.remove();
  const c = ieClass(); if (!P.groupMenu || !c) return;
  const cls = c.cls, g = (cls.groups || []).find(x => x.id === P.groupMenu); if (!g) { P.groupMenu = null; return; }
  const btn = $(`.stage-tabs [data-action="tab-group"][data-id="${g.id}"]`); if (!btn) return;
  const sel = P.stageSel[c.key];
  const m = document.createElement('div'); m.id = 'group-menu'; m.className = 'group-menu';
  m.innerHTML = cls.resources.filter(r => r.group === g.id).map(r => `<div class="gm-row ${sel === r.id ? 'on' : ''}">
      <button class="gm-open" data-action="stage" data-id="${r.id}">${tabIcon(r)}${esc(r.title || 'Tab')}</button>
      <button class="gm-x" data-action="group-out" data-id="${r.id}" title="Take out of the folder">${IC('ico:out')}</button></div>`).join('')
    + `<hr><button class="gm-act" data-action="group-rename" data-id="${g.id}">${IC('ico:annotate')} Rename folder</button><button class="gm-act" data-action="group-dissolve" data-id="${g.id}">${IC('ico:folderOpen')} Unfold (keep the tabs)</button>`;
  $('#present').appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.left = clamp(r.left, 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = r.bottom + 6 + 'px';
}
document.addEventListener('pointerdown', e => {
  if (P.groupMenu && !e.target.closest?.('#group-menu, [data-action="tab-group"]')) { P.groupMenu = null; renderGroupMenu(); P.stageKey = ''; }
}, true);
function tidyGroups(cls) {
  cls.groups = (cls.groups || []).filter(g => cls.resources.filter(r => r.group === g.id).length >= 1);
  for (const r of cls.resources) if (r.group && !cls.groups.some(g => g.id === r.group)) delete r.group;
}
// ---------- drag class tabs: onto the middle of a tab = make a folder, onto a folder = put it in, near an edge = reorder
document.addEventListener('dragstart', e => {
  const t = e.target.closest?.('.stage-tabs .tabwrap[draggable="true"]'); if (!t) return;
  e.dataTransfer.setData('text/plain', t.dataset.tabId || 'g:' + t.dataset.groupId); e.dataTransfer.effectAllowed = 'move'; t.classList.add('dragging');
});
document.addEventListener('dragover', e => {
  const t = e.target.closest?.('.stage-tabs .tabwrap'); if (!t) return;
  e.preventDefault();
  const r = t.getBoundingClientRect(), mid = Math.abs(e.clientX - (r.left + r.width / 2)) < r.width * 0.28;
  $$('.stage-tabs .tabwrap.drop-in').forEach(x => x !== t && x.classList.remove('drop-in'));
  t.classList.toggle('drop-in', mid || !!t.dataset.groupId);
});
document.addEventListener('dragleave', e => { const t = e.target.closest?.('.stage-tabs .tabwrap'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-in'); });
document.addEventListener('drop', e => {
  const t = e.target.closest?.('.stage-tabs .tabwrap'); if (!t) return;
  e.preventDefault(); t.classList.remove('drop-in');
  const c = ieClass(); if (!c) return;
  const cls = c.cls, list = cls.resources, id = e.dataTransfer.getData('text/plain');
  const rect = t.getBoundingClientRect(), mid = Math.abs(e.clientX - (rect.left + rect.width / 2)) < rect.width * 0.28;
  const moveAfter = (items, anchorIdx) => { for (const it of items) list.splice(list.indexOf(it), 1); const at = Math.min(list.length, anchorIdx); list.splice(at, 0, ...items); };
  if (id.startsWith('g:')) {                                          // moving a whole folder
    const items = list.filter(r => r.group === id.slice(2)); if (!items.length) return;
    const targetFirst = t.dataset.groupId ? list.find(r => r.group === t.dataset.groupId) : list.find(r => r.id === t.dataset.tabId);
    if (!targetFirst || items.includes(targetFirst)) return;
    for (const it of items) list.splice(list.indexOf(it), 1);
    list.splice(list.indexOf(targetFirst), 0, ...items);
  } else {
    const r = list.find(x => x.id === id); if (!r) return;
    if (t.dataset.groupId) {                                          // into a folder
      r.group = t.dataset.groupId;
      const last = list.filter(x => x.group === r.group && x !== r).pop();
      list.splice(list.indexOf(r), 1); list.splice(last ? list.indexOf(last) + 1 : list.length, 0, r);
    } else {
      const target = list.find(x => x.id === t.dataset.tabId); if (!target || target === r) return;
      if (mid) {                                                      // onto a tab: make (or join) a folder
        let gid = target.group;
        if (!gid) {
          gid = uid();
          const k1 = resKind(target), k2 = resKind(r);
          const NAMES = { pdf: 'PDFs', youtube: 'Videos', video: 'Videos', image: 'Pictures', web: 'Links', score: 'Scores', sight: 'Sight reading', slides: 'Slides', doc: 'Docs', sheet: 'Sheets' };
          (cls.groups ||= []).push({ id: gid, name: k1 === k2 && NAMES[k1] ? NAMES[k1] : 'Folder' });
          target.group = gid;
        }
        r.group = gid;
        list.splice(list.indexOf(r), 1); list.splice(list.indexOf(target) + 1, 0, r);
      } else {                                                        // near an edge: just reorder (and leave a folder)
        delete r.group;
        list.splice(list.indexOf(r), 1); list.splice(list.indexOf(target) + (e.clientX > rect.left + rect.width / 2 ? 1 : 0), 0, r);
      }
    }
  }
  tidyGroups(cls); save(); P.stageKey = '';
});
document.addEventListener('dragend', () => $$('.tabwrap.dragging').forEach(x => x.classList.remove('dragging')));
// Double-click a pinned tab, or a window's title, to rename it right there (Enter saves, Esc cancels).
function renameInline(anchor, current, commit) {
  const r = anchor.getBoundingClientRect(), inp = document.createElement('input');
  inp.className = 'rename-inline'; inp.value = current;
  Object.assign(inp.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(140, r.width + 40) + 'px', height: r.height + 'px' });
  document.body.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = keep => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (keep && v && v !== current) commit(v); };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
document.addEventListener('dblclick', e => {
  if (VIEW !== 'present') return;
  const gb = e.target.closest('.stage-tabs [data-action="tab-group"]');
  if (gb) {
    const c = ieClass(), g = (c?.cls.groups || []).find(x => x.id === gb.dataset.id); if (!g) return;
    e.preventDefault(); P.groupMenu = null; renderGroupMenu();
    renameInline(gb, g.name, v => { g.name = v; save(); P.stageKey = ''; });
    return;
  }
  const b = e.target.closest('.stage-tabs [data-action="stage"]');
  if (b && b.dataset.id !== 'warmup') {
    const c = ieClass(), r = c?.cls.resources.find(x => x.id === b.dataset.id); if (!r) return;
    e.preventDefault();
    renameInline(b, r.title || '', v => { r.title = v; save(); P.stageKey = ''; WIN.sig = ''; });
    return;
  }
  const t = e.target.closest('.win-bar .win-title'); if (!t) return;
  const w = findWin(t.closest('.win')?.dataset.win); if (!w) return;
  e.preventDefault(); e.stopPropagation();
  const r = winRes(w);
  renameInline(t, winTitle(w), v => { if (r) { r.title = v; P.stageKey = ''; } else w.customTitle = v; save(); WIN.sig = ''; });
}, true);
// ---------- copy / paste class items (pinned tabs, agenda, warm-up, look) between classes
const clipClass = () => VIEW === 'present' ? ieClass()?.cls : selClass();
function clipSel(cls) {
  if (!P.clipSel || P.clipSel.cls !== cls.id) P.clipSel = { cls: cls.id, tabs: new Set(cls.resources.map(r => r.id)), agenda: cls.agenda.length > 0, warmup: !!cls.warmup, look: false };
  return P.clipSel;
}
function clipSummary(c) {
  const p = [];
  if (c.tabs.length) p.push(c.tabs.length + (c.tabs.length === 1 ? ' tab' : ' tabs'));
  if (c.agenda) p.push(`agenda (${c.agenda.length} step${c.agenda.length === 1 ? '' : 's'})`);
  if (c.warmup != null) p.push('warm-up');
  if (c.theme) p.push('look');
  return p.join(', ');
}
function renderClip() {
  $('#clip-panel')?.remove();
  if (!P.clipOpen) return;
  const cls = clipClass(); P.clipFor = cls?.id || null;
  const p = document.createElement('div'); p.id = 'clip-panel'; p.className = 'look-panel clip-panel';
  if (!cls) {
    p.innerHTML = `<div class="dc-head"><b>${IC('ico:clip')} Copy / paste</b><span class="grow"></span><button data-action="clip-open">Done</button></div><div class="dc-note">Show a class first (Class picker in the toolbar), then copy or paste its items.</div>`;
    document.body.appendChild(p); return;
  }
  const s = clipSel(cls), C = S.clip;
  const chk = (k, label, on, extra = '') => `<label class="cp-item"><input type="checkbox" data-clip="${k}" ${extra} ${on ? 'checked' : ''}> ${label}</label>`;
  const askAgenda = C && C.agenda && cls.agenda.length;
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:clip')} Copy / paste — ${esc(cls.name)}</b><span class="grow"></span><button data-action="clip-open">Done</button></div>
    <div class="cp-h">Copy from this class</div>
    <div class="cp-list">
      ${cls.resources.map(r => chk('tab', `${icoSp(resIcon(r))}${esc(r.title || 'Tab')}`, s.tabs.has(r.id), `data-id="${r.id}"`)).join('') || '<div class="dc-note">No pinned tabs.</div>'}
      ${chk('agenda', `${IC('ico:agenda')} Agenda <span class="muted">(${cls.agenda.length} step${cls.agenda.length === 1 ? '' : 's'})</span>`, s.agenda, cls.agenda.length ? '' : 'disabled')}
      ${chk('warmup', `${IC('ico:warmup')} Warm-up question`, s.warmup, cls.warmup ? '' : 'disabled')}
      ${chk('look', `${IC('ico:look')} Look (theme, colours, picture)`, s.look)}
    </div>
    <div class="lp-row"><button data-action="clip-all">Select all</button><button data-action="clip-none">None</button><span class="grow"></span><button class="cp-go" data-action="clip-copy">${IC('ico:clip')} Copy</button></div>
    <div class="cp-h">Paste into this class</div>
    ${C ? `<div class="dc-note">Copied from <b>${esc(C.from)}</b>: ${esc(clipSummary(C)) || 'nothing'}.${C.theme ? ' The look replaces this class’s look.' : ''}${C.warmup != null ? ' The warm-up replaces this class’s warm-up.' : ''}</div>
      <div class="lp-row">${askAgenda
        ? `<span>This class already has an agenda:</span><button class="cp-go" data-action="clip-paste" data-ag="add">Paste — add steps to the end</button><button class="cp-go" data-action="clip-paste" data-ag="replace">Paste — replace agenda</button>`
        : `<button class="cp-go" data-action="clip-paste" data-ag="add">${IC('ico:clip')} Paste</button>`}</div>`
      : `<div class="dc-note">Nothing copied yet. Tick what you want above and press Copy, then switch to another class and paste.</div>`}`;
  document.body.appendChild(p);
  p.addEventListener('change', e => {
    const k = e.target.dataset.clip; if (!k) return;
    if (k === 'tab') e.target.checked ? s.tabs.add(e.target.dataset.id) : s.tabs.delete(e.target.dataset.id);
    else s[k] = e.target.checked;
  });
}
function clipCopy() {
  const cls = clipClass(); if (!cls) return;
  const s = clipSel(cls), clone = o => JSON.parse(JSON.stringify(o));
  const c = {
    from: cls.name,
    tabs: cls.resources.filter(r => s.tabs.has(r.id)).map(clone),
    agenda: s.agenda && cls.agenda.length ? clone(cls.agenda) : null,
    warmup: s.warmup && cls.warmup ? cls.warmup : null,
    theme: s.look ? clone(cls.theme) : null,
  };
  if (!c.tabs.length && !c.agenda && c.warmup == null && !c.theme) return toast('Tick at least one thing to copy.');
  S.clip = c; save(); renderClip();
  toast(`Copied ${clipSummary(c)} from ${cls.name}. Switch class and press Paste.`, 3500);
}
function clipPaste(mode) {
  const cls = clipClass(), c = S.clip; if (!cls || !c) return;
  const clone = o => JSON.parse(JSON.stringify(o));
  for (const r of c.tabs) cls.resources.push({ ...clone(r), id: uid() });
  if (c.agenda) { const steps = clone(c.agenda).map(a => (a.id ? { ...a, id: uid() } : a)); cls.agenda = mode === 'replace' ? steps : cls.agenda.concat(steps); }
  if (c.warmup != null) cls.warmup = c.warmup;
  if (c.theme) cls.theme = clone(c.theme);
  save(); P.stageKey = P.sideKey = P.layoutKey = '';
  if (VIEW !== 'present') renderEditor();
  renderClip(); toast(`Pasted ${clipSummary(c)} into ${cls.name}.`, 3000);
}
// ---------- icons panel: which emojis show, and which ones
function renderIcons() {
  $('#icons-panel')?.remove();
  if (!P.iconsOpen) return;
  const ic = icoCfg(), cls = VIEW === 'present' ? ieClass()?.cls : selClass();
  const inp = (path, val, def) => `<input class="ic-in" data-ic="${path}" value="${esc(val ?? '')}" placeholder="${esc(ICL(def))}" maxlength="8" title="Type or pick an emoji (⌃⌘Space). Leave empty for the default; type - for none.">`;
  const KN = { slides: 'Google Slides', doc: 'Google Doc', sheet: 'Google Sheet', form: 'Google Form', drive: 'Drive file', youtube: 'YouTube', canva: 'Canva', web: 'Web page', pdf: 'PDF', image: 'Picture', video: 'Video', audio: 'Audio', file: 'Other file', sight: 'Sight reading', score: 'Score', warmup: 'Warm-up' };
  const sw = (k, l) => `<label><input type="checkbox" data-icshow="${k}" ${iconOn(k) ? 'checked' : ''}> ${l}</label>`;
  const p = document.createElement('div'); p.id = 'icons-panel'; p.className = 'look-panel icons-panel';
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:icons')} Icons</b><span class="grow"></span><button data-action="icons-reset">Reset all</button><button data-action="icons-open">Done</button></div>
    <div class="ic-sw"><b>Show emojis on</b> ${sw('tabs', 'Tabs')} ${sw('dock', 'Toolbar')} ${sw('win', 'Window titles')} ${sw('events', 'Announcements')}</div>
    <div class="dc-note">Click a box and type or pick an emoji (⌃⌘Space). Empty = the default shown in grey; type <b>-</b> for no icon.</div>
    <div class="ic-grid">
      ${cls && cls.resources.length ? `<div><h5>${esc(cls.name)}'s tabs</h5>${cls.resources.map(r => `<label>${inp('res.' + r.id, r.icon, kindIcon(resKind(r)))} ${esc(r.title || 'Tab')}</label>`).join('')}</div>` : ''}
      <div><h5>Tab types</h5>${Object.entries(KN).map(([k, l]) => `<label>${inp('kind.' + k, ic.kind?.[k], k === 'warmup' ? 'ico:warmup' : KIND_ICON[k])} ${l}</label>`).join('')}</div>
      <div><h5>Toolbar</h5>${Object.entries(DOCK_ITEMS).filter(([, it]) => !it.sep).map(([id, it]) => `<label>${inp('dock.' + id, ic.dock?.[id], it.icon)} ${esc(it.label)}</label>`).join('')}</div>
      <div><h5>Announcements</h5>${Object.entries({ announcement: 'Announcement', birthday: 'Birthday', event: 'Event' }).map(([k, l]) => `<label>${inp('event.' + k, ic.event?.[k], EVENT_ICON[k])} ${l}</label>`).join('')}</div>
    </div>`;
  (VIEW === 'present' ? $('#present') : document.body).appendChild(p);
  const apply = () => { save(); P.stageKey = ''; P.sideKey = ''; WIN.sig = ''; if (VIEW === 'present') { renderDock(); renderWins(context(now()), true); } else renderEditor(); };
  p.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.icshow) { (ic.show ||= {})[el.dataset.icshow] = el.checked; apply(); return; }
    const path = el.dataset.ic; if (!path) return;
    const [grp, key] = path.split('.'), v = el.value.trim();
    if (grp === 'res') { const r = findRes(key); if (r) { if (v) r.icon = v; else delete r.icon; } }
    else { const g = (ic[grp] ||= {}); if (v) g[key] = v; else delete g[key]; }
    apply();
  });
}
// ---------- look & background panel
function renderLook() {
  $('#look-panel')?.remove();
  const c = ieClass(); if (!P.lookOpen || !c) return;
  const th = c.cls.theme, img = th.image ? (th.image.startsWith('file:') ? S.files[th.image.slice(5)]?.name || 'picture' : 'web picture') : '';
  const p = document.createElement('div'); p.id = 'look-panel'; p.className = 'look-panel';
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:look')} Look — ${esc(c.cls.name)}</b><span class="grow"></span><button data-action="look-open">Done</button></div>
    <div class="lp-themes">${THEMES.map((t, k) => `<button class="lp-theme ${t.bg === th.bg && t.accent === th.accent ? 'on' : ''}" style="background:${t.bg};color:${t.text}" data-action="look-theme" data-k="${k}">${t.name} <span style="color:${t.accent}">●</span></button>`).join('')}</div>
    <div class="lp-row"><label>Background <input type="color" data-look="bg" value="${th.bg}"></label><label>Accent <input type="color" data-look="accent" value="${th.accent}"></label><label>Text <input type="color" data-look="text" value="${th.text || '#ffffff'}"></label></div>
    <div class="lp-row"><button data-action="look-pic">${IC('ico:image')} ${img ? 'Change picture…' : 'Use a picture…'}</button>${img ? `<button data-action="look-pic-clear">Remove picture</button>` : ''}</div>
    <label class="lp-dim">Dim background <input type="range" min="0" max="0.85" step="0.05" data-look="dim" value="${th.dim ?? 0.25}"><span>${Math.round((th.dim ?? 0.25) * 100)}%</span></label>
    <label class="lp-dim" data-for="panel">Panel background <input type="range" min="0" max="1" step="0.05" data-look="panel" value="${th.panel ?? 0.1}"><span>${Math.round((th.panel ?? 0.1) * 100)}%</span></label>
    <div class="dc-note">Dimming darkens the picture; a more solid panel background makes the agenda, Today panel and tabs easier to read over a busy picture.</div>`;
  $('#present').appendChild(p);
  const host = p;
  host.addEventListener('input', e => {
    const k = e.target.dataset.look; if (!k) return;
    th[k] = k === 'dim' || k === 'panel' ? Number(e.target.value) : e.target.value;
    if (k === 'dim' || k === 'panel') e.target.nextElementSibling.textContent = Math.round(th[k] * 100) + '%';
    save();
  });
}
function applyDim(el, th) {
  const bg = el.querySelector('#p-bg') || el, d = th.dim ?? 0.25;
  if (th.image) bg.style.backgroundImage = `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${th.image.startsWith('file:') ? fileDirectURL(th.image.slice(5)) : th.image}")`;
}
// ---------- automations drawer (reuses the Edit screen's timeline)
function renderAutoDrawer() {
  $('#auto-drawer')?.remove();
  const c = ieClass(); if (!P.autoDrawer || !c) return;
  const ci = S.classes.indexOf(c.cls); SEL_CLASS = c.cls.id;
  const d = document.createElement('div'); d.id = 'auto-drawer'; d.className = 'auto-drawer';
  d.innerHTML = `<div class="ad-head"><b>${IC('ico:auto')} Automations — ${esc(c.cls.name)}</b><span class="grow"></span><button class="btn small" data-action="auto-open">Close</button></div>${timelineCard(c.cls, ci)}`;
  $('#present').appendChild(d);
}
const tlRerender = () => { if (VIEW === 'edit') renderEditor(); else renderAutoDrawer(); };

// ---------- snap one window to part of the screen (▦ button on each window)
const SNAP_G = 0.006;   // small gap between snapped windows
const SNAPS = [
  ['Left half', 0, 0, .5, 1], ['Right half', .5, 0, .5, 1], ['Top half', 0, 0, 1, .5], ['Bottom half', 0, .5, 1, .5],
  ['Top left', 0, 0, .5, .5], ['Top right', .5, 0, .5, .5], ['Bottom left', 0, .5, .5, .5], ['Bottom right', .5, .5, .5, .5],
  ['Left third', 0, 0, 1 / 3, 1], ['Middle third', 1 / 3, 0, 1 / 3, 1], ['Right third', 2 / 3, 0, 1 / 3, 1], ['Fill', 0, 0, 1, 1],
  ['Left two-thirds', 0, 0, 2 / 3, 1], ['Right two-thirds', 1 / 3, 0, 2 / 3, 1],
];
function snapIcon([, x, y, w, h]) {
  return `<svg viewBox="0 0 30 20" width="30" height="20"><rect x=".5" y=".5" width="29" height="19" rx="3" fill="none" stroke="currentColor" opacity=".45"/>
    <rect x="${1.5 + x * 27}" y="${1.5 + y * 17}" width="${w * 27}" height="${h * 17}" rx="2" fill="currentColor"/></svg>`;
}
function renderSnapMenu() {
  $('#snap-host')?.remove();
  if (!P.snapFor) return;
  const btn = $(`.win[data-win="${P.snapFor}"] [data-action="win-snap"]`); if (!btn) { P.snapFor = null; return; }
  const r = btn.getBoundingClientRect();
  const host = document.createElement('div'); host.id = 'snap-host'; host.className = 'snap-menu';
  host.innerHTML = SNAPS.map((s, i) => `<button data-action="win-snap-to" data-i="${i}" title="${s[0]}">${snapIcon(s)}</button>`).join('');
  $('#present').appendChild(host);
  const hw = host.offsetWidth;
  host.style.left = clamp(r.right - hw, 8, innerWidth - hw - 8) + 'px';
  host.style.top = r.bottom + 6 + 'px';
}
function snapWindow(w, i) {
  const [, x, y, sw, sh] = SNAPS[i];
  const g = SNAP_G;
  w.max = false;
  w.x = x + (x > 0 ? g / 2 : 0); w.y = y + (y > 0 ? g / 2 : 0);
  w.w = sw - (x > 0 ? g / 2 : 0) - (x + sw < 0.999 ? g / 2 : 0);
  w.h = sh - (y > 0 ? g / 2 : 0) - (y + sh < 0.999 ? g / 2 : 0);
  bringToFront(w);
  if (w.kind === 'app') {
    // Resize the REAL app window to fit the spot (you asked for it), then the frame follows 1:1.
    const L = $('#p-wins').getBoundingClientRect();
    const bar = $(`.win[data-win="${w.id}"] .win-bar`)?.getBoundingClientRect().height || 33;
    native('webCmd', { id: w.id, action: 'resize', width: Math.round(w.w * L.width - 4), height: Math.round(w.h * L.height - bar - 4) });
  }
  save(); applyWinGeom();
}

// Tell the native side where full-browser windows are, and cut matching holes in the page.
const rectOf = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
// Real browser / app views live *under* the page. Each one shows through a hole cut only in the
// page layers that are BELOW it (background, stage, lower windows). Windows stacked above it stay
// solid and paint over it, so overlapping windows look and click like normal desktop windows.
// the pinned tab on the stage, when it's a web page (any = even if it isn't in full-browser mode)
function stageNativeRes(any) {
  const c = context(now()); if (c.mode !== 'class' || !c.cls) return null;
  const r = c.cls.resources.find(x => x.id === P.stageSel[c.key]);
  return r && r.url && (any || (r.native && IS_NATIVE)) ? r : null;
}
function syncNative() {
  const items = [];
  if (VIEW === 'present' && !P.stageMax) for (const el of $$('.win.native')) {
    const w = findWin(el.dataset.win); if (!w) continue;
    const r = rectOf(el.querySelector('.win-body'));
    if (r[2] > 0 && r[3] > 0) items.push(w.kind === 'app'
      ? { id: w.id, z: w.z || 0, kind: 'app', windowID: w.windowID || 0, bundleId: w.bundleId, title: w.title || '', rect: r }
      : { id: w.id, z: w.z || 0, url: winURL(w) || 'about:blank', rect: r });
  }
  const sr = VIEW === 'present' ? stageNativeRes() : null, sce = sr && $('#stage-content .stage-native') && $('#stage-content');
  let stageRect = null;
  if (sce) { const r = rectOf(sce); if (r[2] > 0 && r[3] > 0) { stageRect = r; (P.keepNative ||= new Set()).add(sr.id); items.push({ id: 'stage-' + sr.id, z: -1, url: sr.url, rect: r }); } }
  // full-browser tabs you've opened stay alive (hidden) when you switch tabs, so videos keep playing
  if (VIEW === 'present' && P.keepNative) for (const id of [...P.keepNative]) {
    if (sr && id === sr.id && stageRect) continue;
    const r = findRes(id);
    if (!r || !r.native || !r.url) { P.keepNative.delete(id); continue; }
    items.push({ id: 'stage-' + id, z: -2, url: r.url, rect: stageRect || [0, 0, 10, 10], hidden: true });
  }
  items.sort((a, b) => a.z - b.z);   // the native side stacks its views in this order
  const drawing = P.ink.on && !P.ink.interact;
  const pass = !drawing && !P.overlay && !WIN.drag;
  const holes = pass ? items.filter(i => !i.hidden).map(i => [...i.rect, i.z]) : [];
  let blockers = [];
  if (pass && items.length) {
    const TOP = 1e9;
    blockers = $$('.tool, .p-timer, .p-dock:not(.hidden), .p-signal.on, .win-menu, .snap-menu, .bm-menu, .dock-custom, .sound-chip, .toast, .group-menu, .look-panel, .auto-drawer, .rename-inline, .ink-bar').map(el => [...rectOf(el), TOP]);
    for (const el of $$('.win')) {
      const w = findWin(el.dataset.win); if (!w) continue;
      // an embedded window blocks with its whole frame; a native one only with its title bar
      const part = el.classList.contains('native') ? el.querySelector('.win-bar') : el;
      blockers.push([...rectOf(part), w.z || 0]);
    }
  }
  const msg = JSON.stringify({ items, holes, blockers });
  if (msg !== WIN.lastSync) { WIN.lastSync = msg; if (IS_NATIVE) native('webSync', JSON.parse(msg)); }
  const shown = items.filter(i => !i.hidden);
  $('#present')?.classList.toggle('has-native', shown.length > 0);
  cutHoles(shown);
}
// Split overlapping rectangles into non-overlapping strips so even-odd cutting never re-fills overlaps.
function disjointRects(rects) {
  if (rects.length < 2) return rects;
  const xs = [...new Set(rects.flatMap(r => [r[0], r[0] + r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap(r => [r[1], r[1] + r[3]]))].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j < ys.length - 1; j++) {
    let run = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      const hit = rects.some(r => cx > r[0] && cx < r[0] + r[2] && cy > r[1] && cy < r[1] + r[3]);
      if (hit) { if (run) run[2] = xs[i + 1] - run[0]; else run = [xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]]; }
      else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out;
}
function cutHoles(items) {
  const targets = [[$('#p-bg'), -Infinity, ''], [$('#p-body'), -Infinity, '']];
  for (const el of $$('.win')) { const w = findWin(el.dataset.win); if (w) targets.push([el, w.z || 0, w.id]); }
  const sig = JSON.stringify(items.map(i => [i.rect, i.z])) + targets.map(([el, z]) => el ? rectOf(el) + ':' + z : '').join(';');
  // redo it if anything changed, or if a layer was rebuilt (a fresh element has no cut-out yet)
  if (sig === WIN.cutSig && targets.every(([el]) => !el || el._cutSig === sig)) return; WIN.cutSig = sig;
  for (const [el, z, id] of targets) {
    if (!el) continue;
    el._cutSig = sig;
    const above = disjointRects(items.filter(i => i.z > z && i.id !== id).map(i => i.rect));
    // A window's drop shadow paints outside its own box, i.e. on top of a real browser/app view
    // stacked above it. Drop the shadow on any window that sits under one.
    if (el.classList.contains('win')) el.style.boxShadow = above.length ? 'none' : '';
    if (!above.length) { el.style.clipPath = ''; continue; }
    const e = el.getBoundingClientRect();
    let d = `M0 0 H${e.width} V${e.height} H0 Z`;
    for (const [x, y, w, h] of above) d += ` M${x - e.left} ${y - e.top} h${w} v${h} h${-w} Z`;
    el.style.clipPath = `path(evenodd, "${d}")`;
  }
}
function renderWinMenu() {
  const host = $('#win-menu-host'); if (!host) return;
  if (!P.winMenu) { host.innerHTML = ''; return; }
  const cls = currentClass();
  const lib = Object.entries(S.files).filter(([, f]) => !f.mime.startsWith('audio/'));
  const list = winList();
  const tile = (act, icon, label, extra = '') => `<button class="wm-tile" data-action="${act}" ${extra}>${IC(icon)}<span>${label}</span></button>`;
  const item = (act, id, icon, name) => `<button data-action="${act}" data-id="${id}" data-q="${esc(name.toLowerCase())}">${icoSp(icon)}${esc(name)}</button>`;
  const open = (P.wmOpen ||= { cls: true, lib: false });
  const sec = (key, title, n, body) => `<details class="wm-sec" data-sec="${key}" ${open[key] ? 'open' : ''}><summary>${title}<span class="wm-n">${n}</span></summary><div class="wm-items">${body}</div></details>`;
  const many = (cls ? cls.resources.length + 1 : 0) + lib.length > 8;
  host.innerHTML = `<div class="win-menu">
    <div class="wm-grid">
      ${tile('wm-web', 'ico:web', 'Web page')}
      ${tile('wm-file', 'ico:file', 'File…', `title="PDF, picture or video from this ${DEVICE}"`)}
      ${tile('wm-sight', 'ico:sight', 'Sight reading')}
      ${tile('wm-score', 'ico:score', 'Score', 'title="Score practice (MusicXML / MuseScore)"')}
      ${tile('wm-cal', 'ico:events', 'Calendar')}
      ${tile('wm-prog', 'ico:gauge', 'Progress')}
      ${tile('wm-rec', 'ico:mic', 'Recorder')}
      ${tile('wm-yt', 'ico:youtube', 'YouTube')}
      ${IS_NATIVE ? tile('wm-apps', 'ico:app', 'Other app', 'title="A window from another app (MuseScore…)"') : ''}
    </div>
    ${IS_NATIVE ? appPickerHTML() : ''}
    ${many ? `<input class="wm-search" placeholder="Search tabs and files…" data-wm-search>` : ''}
    ${cls ? sec('cls', esc(cls.name) + ' tabs', cls.resources.length + 1, `<button data-action="wm-warmup" data-q="warm-up">${icoSp('ico:warmup')}Warm-up question</button>${cls.resources.map(r => item('wm-res', r.id, resIcon(r), r.title || 'Resource')).join('')}`) : ''}
    ${lib.length ? sec('lib', 'Library', lib.length, lib.map(([id, f]) => item('wm-lib', id, KIND_ICON[resKind({ fileId: id })], f.name)).join('')) : ''}
    <div class="wm-none" hidden>Nothing matches.</div>
    ${list.length ? `<div class="wm-foot"><button data-action="win-tile">${IC('ico:tile')} Tile</button><button data-action="wm-closeall">${IC('ico:close')} Close all</button></div>` : ''}
  </div>`;
  const menu = host.firstElementChild;
  menu.querySelectorAll('details.wm-sec').forEach(d => d.addEventListener('toggle', () => { if (!menu.classList.contains('searching')) open[d.dataset.sec] = d.open; }));
  menu.querySelector('[data-wm-search]')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase(); menu.classList.toggle('searching', !!q); let hits = 0;
    menu.querySelectorAll('details.wm-sec').forEach(d => {
      let n = 0; d.querySelectorAll('[data-q]').forEach(b => { const ok = !q || b.dataset.q.includes(q); b.hidden = !ok; n += ok; });
      d.hidden = !!q && !n; d.open = q ? n > 0 : !!open[d.dataset.sec]; hits += n;
    });
    menu.querySelector('.wm-none').hidden = !q || hits > 0;
  });
  let btn = $('#p-dock [data-action="win-menu"]'); const m = host.firstElementChild;
  if (!btn || !btn.offsetWidth) btn = $('#p-dock .dock-more');     // the Window button is in the ⋯ menu: open under ⋯
  if (btn && m) {
    const r = btn.getBoundingClientRect(), vert = $('#p-dock')?.classList.contains('vertical');
    if (vert) {                                    // toolbar on a side: open beside it
      m.style.maxHeight = innerHeight - 16 + 'px';
      const right = r.left < innerWidth / 2;
      m.style.left = (right ? r.right + 8 : r.left - m.offsetWidth - 8) + 'px';
      m.style.top = clamp(r.top + r.height / 2 - m.offsetHeight / 2, 8, innerHeight - m.offsetHeight - 8) + 'px';
    } else {
      const below = r.top < innerHeight / 2;      // toolbar at the bottom: open upward
      m.style.maxHeight = (below ? innerHeight - r.bottom - 16 : r.top - 16) + 'px';
      m.style.top = (below ? r.bottom + 8 : r.top - 8 - m.offsetHeight) + 'px';
      m.style.left = clamp(r.left + r.width / 2 - m.offsetWidth / 2, 8, innerWidth - m.offsetWidth - 8) + 'px';
    }
  }
  if (m) for (const d of m.querySelectorAll('details.wm-sec')) d.addEventListener('toggle', () => renderWinMenuPos?.());
}
function renderWinMenuPos() { if (P.winMenu) { const m = $('#win-menu-host')?.firstElementChild; if (!m) return; const r = m.getBoundingClientRect(); if (r.bottom > innerHeight - 8) m.style.top = Math.max(8, innerHeight - 8 - m.offsetHeight) + 'px'; } }

// ---------- side panel ↔ stage divider (per class)
function applySide(cls) {
  const body = $('#p-body'); if (!body || !cls) return;
  const L = cls.layout || {};
  const frac = clamp(L.side ?? 0.22, 0.1, 0.6);
  body.classList.toggle('side-collapsed', !!L.collapsed);
  body.style.gridTemplateColumns = L.collapsed ? '0px 1.4em minmax(0, 1fr)' : `${(frac * 100).toFixed(2)}% 1.4em minmax(0, 1fr)`;
  const btn = $('#p-split .p-split-btn'); if (btn) btn.textContent = L.collapsed ? '›' : '‹';
  WIN.cutSig = '';
}
let SPLIT = null;
document.addEventListener('pointerdown', e => {
  const sp = e.target.closest('#p-split'); if (!sp || e.target.closest('button') || VIEW !== 'present') return;
  const cls = context(now()).cls; if (!cls) return;
  e.preventDefault();
  SPLIT = { cls, rect: $('#p-body').getBoundingClientRect() };
  $('#p-body').classList.add('resizing');
});
document.addEventListener('pointermove', e => {
  if (!SPLIT) return;
  const { cls, rect } = SPLIT;
  cls.layout = { ...(cls.layout || {}), collapsed: false, side: clamp((e.clientX - rect.left) / rect.width, 0.1, 0.6) };
  applySide(cls);
});
document.addEventListener('pointerup', () => {
  if (!SPLIT) return;
  SPLIT = null; $('#p-body')?.classList.remove('resizing'); save();
});
document.addEventListener('dblclick', e => {
  if (VIEW === 'present' && e.target.closest('#p-split')) A['side-toggle']();
});

// ============================================================ annotation (ink)
let inkCanvas = null, inkCtx = null, inkDrawing = null, inkSnapshot = null;
// Things the pen should never draw over — clicks there go to the control instead.
const INK_UI = 'button, a, input, select, textarea, label, [contenteditable="true"], [data-action], [data-sr], [data-mu], [data-pdf], .win-bar, .win-rs, .stage-tabs, .tool, .pdfv-bar, .sr-top, .sr-settings, .me-controls, .p-dock, .ink-bar, .dock-custom, .look-panel, .win-menu, .snap-menu, .bm-menu, .win-bm, .p-signal.on, .p-timer, .sound-chip';
function inkUnder(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === inkCanvas || el.id === 'ink' || el.classList.contains('ink-cursor')) continue;
    return el.closest(INK_UI);
  }
  return null;
}
function inkPreview(e) {
  const cur = $('#ink-cursor'); if (!cur || !inkCanvas) return;
  const host = $('#ink'), hr = host.getBoundingClientRect();
  const inside = e.clientX >= hr.left && e.clientX <= hr.right && e.clientY >= hr.top && e.clientY <= hr.bottom;
  const overUI = inside && !inkDrawing && !!inkUnder(e.clientX, e.clientY);
  inkCanvas.style.pointerEvents = overUI ? 'none' : '';
  const show = P.ink.on && !P.ink.interact && inside && !overUI;
  cur.hidden = !show; inkCanvas.style.cursor = show ? 'none' : '';
  if (!show) return;
  const k = P.ink, t = k.tool;
  const size = t === 'hl' ? k.size * 4 : t === 'erase' ? k.size * 5 : t === 'pen' ? k.size : 6;
  cur.className = 'ink-cursor t-' + t;
  cur.textContent = t === 'text' ? 'T' : t === 'line' || t === 'arrow' || t === 'rect' || t === 'circle' ? '+' : '';
  Object.assign(cur.style, {
    left: '0px', top: '0px', transform: `translate(${e.clientX - hr.left}px, ${e.clientY - hr.top}px) translate(-50%, -50%)`,
    width: Math.max(6, size) + 'px', height: Math.max(6, size) + 'px',
    fontSize: 14 + k.size * 2 + 'px',
  });
  cur.style.setProperty('--c', k.color);
}
let inkPrevRaf = 0, inkPrevEv = null;
document.addEventListener('pointermove', e => {
  if (VIEW !== 'present' || !P.ink.on) return;
  const cur = $('#ink-cursor');
  if (inkDrawing && cur && !cur.hidden) {           // while drawing just move the brush dot (cheap)
    const r = INKRECT || inkCanvas.getBoundingClientRect();
    cur.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px) translate(-50%, -50%)`;
    return;
  }
  inkPrevEv = e;
  if (!inkPrevRaf) inkPrevRaf = requestAnimationFrame(() => { inkPrevRaf = 0; if (inkPrevEv) inkPreview(inkPrevEv); });
}, true);
document.addEventListener('pointerdown', e => { if (VIEW === 'present' && P.ink.on) inkPreview(e); }, true);
let inkWheelT = 0;
document.addEventListener('wheel', e => {
  if (!inkCanvas || e.target !== inkCanvas || !P.ink.on || P.ink.interact) return;
  inkCanvas.style.pointerEvents = 'none';               // let this scroll gesture reach the page/PDF below
  clearTimeout(inkWheelT); inkWheelT = setTimeout(() => { if (inkCanvas) inkCanvas.style.pointerEvents = ''; }, 350);
}, { capture: true, passive: true });
function setupInk() {
  const host = $('#ink'); if (!host) return;
  host.innerHTML = `<canvas></canvas><div class="ink-cursor" id="ink-cursor" hidden></div><div class="ink-bar" id="ink-bar"></div>`;
  inkPrev = null; inkPrevCtx = null;
  inkCanvas = host.querySelector('canvas'); inkCtx = inkCanvas.getContext('2d');
  const ro = new ResizeObserver(() => resizeInk()); ro.observe(host);
  inkCanvas.addEventListener('pointerdown', inkDown);
  inkCanvas.addEventListener('pointermove', inkMove);
  window.addEventListener('pointerup', inkUp);
  updateInkUI();
}
// make sure the drawing layer's pixels match its on-screen size (cheap check; resizes only if needed)
function inkFit() {
  if (!inkCanvas) return;
  const r = inkCanvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (r.width && (Math.abs(inkCanvas.width - Math.round(r.width * dpr)) > 1 || Math.abs(inkCanvas.height - Math.round(r.height * dpr)) > 1)) resizeInk();
}
function resizeInk() {
  if (!inkCanvas) return;
  const r = inkCanvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!r.width) return;
  let copy = null, cw = 0, ch = 0;
  if (inkCanvas.width && inkCanvas.height) {
    copy = document.createElement('canvas'); copy.width = inkCanvas.width; copy.height = inkCanvas.height;
    copy.getContext('2d').drawImage(inkCanvas, 0, 0); cw = inkCanvas.width / dpr; ch = inkCanvas.height / dpr;
  }
  inkCanvas.width = Math.round(r.width * dpr); inkCanvas.height = Math.round(r.height * dpr);
  inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (copy) inkCtx.drawImage(copy, 0, 0, cw, ch);   // same size as before, anchored top-left — never stretched
}
// Board paper: staff lines (or a grid) drawn as a repeating background, so Clear never erases them
function boardPaper(kind) {
  const svg = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;
  const lines = (ys, w = 10) => ys.map(y => `<rect x='0' y='${y}' width='${w}' height='1.6' fill='#6b7385'/>`).join('');
  const sp = 18;                                              // space between staff lines
  if (kind === 'staff') return svg(10, 4 * sp + 96, lines([0, 1, 2, 3, 4].map(i => 40 + i * sp)));
  if (kind === 'grand') { const a = [0, 1, 2, 3, 4].map(i => 40 + i * sp), b = a.map(y => y + 4 * sp + 64); return svg(10, 2 * 4 * sp + 64 + 110, lines([...a, ...b])); }
  if (kind === 'grid') return svg(32, 32, `<path d='M32 0H0V32' fill='none' stroke='#c9ced8' stroke-width='1'/>`);
  return '';
}
function updateInkUI() {
  const host = $('#ink'); if (!host) return;
  host.classList.toggle('on', P.ink.on);
  if (P.ink.on) requestAnimationFrame(inkFit), setTimeout(inkFit, 50);
  host.classList.toggle('passive', P.ink.interact);
  const paper = P.ink.blank ? boardPaper(S.settings.boardPaper) : '';
  host.style.background = !P.ink.blank ? 'transparent' : paper ? `${paper} repeat content-box, #ffffff` : '#ffffff';
  host.classList.toggle('papered', P.ink.blank && !!S.settings.boardPaper && S.settings.boardPaper !== 'blank');
  const colors = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#7b2cbf', '#111111', '#ffffff', '#ffd60a'];
  const tb = (t, label) => `<button class="${P.ink.tool === t ? 'on' : ''}" data-action="ink-tool" data-t="${t}">${label}</button>`;
  $('#ink-bar').innerHTML = `<span class="ink-grip" title="Drag to move this toolbar">⋮⋮</span>
    ${tb('pen', `${IC('ico:pen')} Pen`)}${tb('hl', `${IC('ico:highlight')} Highlight`)}${tb('line', `${IC('ico:line')} Line`)}${tb('arrow', `${IC('ico:arrow')} Arrow`)}${tb('rect', `${IC('ico:box')} Box`)}${tb('circle', `${IC('ico:circle')} Circle`)}${tb('text', 'T Text')}${tb('erase', `${IC('ico:erase')} Erase`)}
    <span style="width:6px"></span>
    ${colors.map(c => `<button class="dot ${P.ink.color === c ? 'on' : ''}" style="background:${c}" data-action="ink-color" data-c="${c}"></button>`).join('')}
    <select data-action-change="ink-size" style="background:transparent;color:#fff;border:1px solid #555;border-radius:6px;padding:2px">
      ${[2, 4, 8, 14].map(s => `<option value="${s}" ${P.ink.size === s ? 'selected' : ''} style="color:#000">${s}px</option>`).join('')}</select>
    ${P.ink.blank ? `<select data-action-change="board-paper" title="Paper" style="background:transparent;color:#fff;border:1px solid #555;border-radius:6px;padding:2px">${[['blank', 'Blank'], ['staff', 'Music staff'], ['grand', 'Grand staff'], ['grid', 'Grid']].map(([v, l]) => `<option value="${v}" ${(S.settings.boardPaper || 'blank') === v ? 'selected' : ''} style="color:#000">${l}</option>`).join('')}</select>` : ''}
    ${P.ink.blank ? '' : `<button class="${P.ink.interact ? 'on' : ''}" data-action="ink-interact" title="Click through to the slide underneath; drawings stay visible">${IC('ico:pointer')} Click slides</button>`}
    <button data-action="ink-clear">${IC('ico:trash')} Clear</button>
    <button data-action="ink-close">${IC('ico:close')}</button>`;
  placeInkBar();
}
// Same behaviour as the main toolbar: drag the grip anywhere; near a side it stands up; drop it at
// the top middle to put it back. Remembered.
function placeInkBar() {
  const b = $('#ink-bar'); if (!b) return;
  const pos = (S.settings.inkBar ||= { mode: 'home' });
  const float = pos.mode === 'float';
  b.classList.toggle('floating', float); b.classList.toggle('vertical', float && !!pos.vertical);
  if (!float) { b.style.left = b.style.top = ''; return; }
  const w = b.offsetWidth, h = b.offsetHeight;
  b.style.left = clamp(pos.x * innerWidth - w / 2, 4, innerWidth - w - 4) + 'px';
  b.style.top = clamp(pos.y * innerHeight - h / 2, 4, innerHeight - h - 4) + 'px';
}
let INKDRAG = false;
function inkBarFollow(px, py) {
  const b = $('#ink-bar'), pos = S.settings.inkBar;
  const vertical = px < 110 || px > innerWidth - 110;
  Object.assign(pos, { mode: 'float', vertical, x: pos.x ?? .5, y: pos.y ?? .15 });
  placeInkBar();
  const g = b.querySelector('.ink-grip').getBoundingClientRect(), r = b.getBoundingClientRect();
  pos.x = (r.left + (px - (g.left + g.width / 2)) + r.width / 2) / innerWidth;
  pos.y = (r.top + (py - (g.top + g.height / 2)) + r.height / 2) / innerHeight;
  placeInkBar();
  const ink = $('#ink').getBoundingClientRect();
  b.classList.toggle('snap-home', py < ink.top + 70 && Math.abs(px - (ink.left + ink.width / 2)) < ink.width * 0.22);
}
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.ink-grip')) return;
  e.preventDefault(); e.stopPropagation(); INKDRAG = true; inkBarFollow(e.clientX, e.clientY);
}, true);
document.addEventListener('pointermove', e => { if (INKDRAG) { P.lastMove = Date.now(); inkBarFollow(e.clientX, e.clientY); } });
document.addEventListener('pointerup', () => {
  if (!INKDRAG) return; INKDRAG = false;
  const b = $('#ink-bar');
  if (b.classList.contains('snap-home')) S.settings.inkBar = { mode: 'home' };
  b.classList.remove('snap-home'); placeInkBar(); save();
});
window.addEventListener('resize', () => placeInkBar());
function inkPos(e) { const r = INKRECT || (INKRECT = inkCanvas.getBoundingClientRect()); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
let INKRECT = null;                       // cached during a stroke (reading layout every move is slow)
let inkPrev = null, inkPrevCtx = null;    // light preview layer for shapes / highlighter while dragging
function inkStyleOn(c) {
  const k = P.ink;
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.globalCompositeOperation = k.tool === 'erase' ? 'destination-out' : 'source-over';
  c.strokeStyle = k.color; c.fillStyle = k.color;
  c.globalAlpha = k.tool === 'hl' ? 0.35 : 1;
  c.lineWidth = k.tool === 'hl' ? k.size * 4 : k.tool === 'erase' ? k.size * 5 : k.size;
}
function inkStyle() { inkStyleOn(inkCtx); }
function inkEnsurePreview() {
  if (!inkPrev) {
    inkPrev = document.createElement('canvas'); inkPrev.className = 'ink-preview';
    inkCanvas.after(inkPrev); inkPrevCtx = inkPrev.getContext('2d');
  }
  const dpr = window.devicePixelRatio || 1;
  if (inkPrev.width !== inkCanvas.width || inkPrev.height !== inkCanvas.height) { inkPrev.width = inkCanvas.width; inkPrev.height = inkCanvas.height; }
  inkPrevCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function inkShape(c, t, s, p, pts) {
  inkStyleOn(c); c.beginPath();
  if (t === 'hl') { c.moveTo(pts[0].x, pts[0].y); for (const q of pts) c.lineTo(q.x, q.y); c.stroke(); }
  else if (t === 'line' || t === 'arrow') {
    c.moveTo(s.x, s.y); c.lineTo(p.x, p.y); c.stroke();
    if (t === 'arrow') {
      const a = Math.atan2(p.y - s.y, p.x - s.x), L = 14 + P.ink.size * 2;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - L * Math.cos(a - 0.45), p.y - L * Math.sin(a - 0.45));
      c.moveTo(p.x, p.y); c.lineTo(p.x - L * Math.cos(a + 0.45), p.y - L * Math.sin(a + 0.45)); c.stroke();
    }
  } else if (t === 'rect') c.strokeRect(s.x, s.y, p.x - s.x, p.y - s.y);
  else if (t === 'circle') { c.ellipse((s.x + p.x) / 2, (s.y + p.y) / 2, Math.abs(p.x - s.x) / 2, Math.abs(p.y - s.y) / 2, 0, 0, Math.PI * 2); c.stroke(); }
}
let INKTAP = null, inkRaf = 0, inkPending = null;
function inkDown(e) {
  if (!P.ink.on || P.ink.interact) return;
  const ui = inkUnder(e.clientX, e.clientY);
  if (ui) { INKTAP = { ui, x: e.clientX, y: e.clientY }; return; }
  INKRECT = inkCanvas.getBoundingClientRect();
  inkFit();                                             // never draw into a wrongly-sized layer (that stretches marks)
  const p = inkPos(e);
  if (P.ink.tool === 'text') return inkText(p);
  try { inkCanvas.setPointerCapture(e.pointerId); } catch { }
  inkDrawing = { start: p, last: p, pts: [p], tool: P.ink.tool, started: false, cx: e.clientX, cy: e.clientY, at: performance.now() };
  if (!['pen', 'erase'].includes(P.ink.tool)) inkEnsurePreview();
}
function inkBegin() {
  const d = inkDrawing; d.started = true;
  if (d.tool === 'pen' || d.tool === 'erase') { inkStyle(); inkCtx.beginPath(); inkCtx.moveTo(d.start.x, d.start.y); inkCtx.lineTo(d.start.x + 0.01, d.start.y); inkCtx.stroke(); }
}
// the element under the pen, ignoring the drawing layer itself
function inkTarget(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === inkCanvas || el === inkPrev || el.id === 'ink' || el.classList.contains('ink-cursor')) continue;
    return el;
  }
  return null;
}
function inkMove(e) {
  if (!inkDrawing) return;
  if (!inkDrawing.started) {
    if (Math.hypot(e.clientX - inkDrawing.cx, e.clientY - inkDrawing.cy) < 4) return;
    inkBegin();
  }
  const t = inkDrawing.tool;
  // use every intermediate point the trackpad/pen reported, so fast strokes stay smooth
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  if (t === 'pen' || t === 'erase') {
    // collect points; draw them together once per screen frame (much cheaper than per mouse event)
    (inkDrawing.q ||= []).push(...(evs.length ? evs : [e]).map(inkPos));
    if (!inkDrawing.raf) inkDrawing.raf = requestAnimationFrame(() => inkFlushPen(inkDrawing));
    return;
  }
  for (const ev of (evs.length ? evs : [e])) inkDrawing.pts.push(inkPos(ev));
  inkPending = inkPos(e);
  if (inkRaf) return;                                  // redraw the preview at most once per frame
  inkRaf = requestAnimationFrame(() => {
    inkRaf = 0; if (!inkDrawing || !inkPrevCtx) return;
    inkPrevCtx.save(); inkPrevCtx.setTransform(1, 0, 0, 1, 0, 0); inkPrevCtx.clearRect(0, 0, inkPrev.width, inkPrev.height); inkPrevCtx.restore();
    inkShape(inkPrevCtx, t, inkDrawing.start, inkPending, inkDrawing.pts);
  });
}
function inkFlushPen(d) {
  if (!d) return; d.raf = 0;
  const q = d.q; if (!q || !q.length) return; d.q = [];
  const c = inkCtx; inkStyleOn(c); c.beginPath(); c.moveTo(d.last.x, d.last.y);
  for (const p of q) c.lineTo(p.x, p.y);
  c.stroke(); d.last = q[q.length - 1];
}
function inkUp(e) {
  if (INKTAP) {
    const t = INKTAP; INKTAP = null;
    if (e && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8) { if (/INPUT|TEXTAREA|SELECT/.test(t.ui.tagName)) t.ui.focus(); else t.ui.click(); }
    return;
  }
  if (!inkDrawing) return;
  const d = inkDrawing; inkDrawing = null;
  if (d.raf) { cancelAnimationFrame(d.raf); inkFlushPen(d); }
  if (!d.started) {
    // a tap, not a stroke: click what's underneath (links, buttons, checkboxes, notes…)
    INKRECT = null;
    if (d.tool === 'pen' && performance.now() - d.at > 450) { inkDrawing = d; inkBegin(); inkDrawing = null; return; }   // long press = a dot
    const el = inkTarget(d.cx, d.cy);
    if (el && el.tagName !== 'IFRAME') { if (/INPUT|TEXTAREA|SELECT/.test(el.tagName)) el.focus(); else el.click(); }
    else if (el && el.tagName === 'IFRAME') toast('To click inside slides or web pages, use “Click slides” on the drawing toolbar (your drawings stay).', 3500);
    return;
  }
  if (d.tool !== 'pen' && d.tool !== 'erase') {
    // stamp the finished shape onto the drawing, then clear the preview layer
    const end = e ? inkPos(e) : (inkPending || d.start);
    if (d.tool === 'hl' && e) d.pts.push(end);
    inkShape(inkCtx, d.tool, d.start, end, d.pts);
    if (inkPrevCtx) { inkPrevCtx.save(); inkPrevCtx.setTransform(1, 0, 0, 1, 0, 0); inkPrevCtx.clearRect(0, 0, inkPrev.width, inkPrev.height); inkPrevCtx.restore(); }
  }
  INKRECT = null;
  // (the drawing is saved when you switch tab/class — not after every stroke, which caused hitches)
}
function inkText(p) {
  const host = $('#ink');
  const inp = document.createElement('input'); inp.className = 'ink-text';
  inp.style.left = p.x + 'px'; inp.style.top = p.y - 14 + 'px'; inp.style.color = P.ink.color;
  inp.style.fontSize = 14 + P.ink.size * 3 + 'px';
  host.appendChild(inp); setTimeout(() => inp.focus(), 0);
  const commit = () => {
    if (inp.value.trim()) {
      const c = inkCtx; c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.fillStyle = P.ink.color;
      c.font = `700 ${14 + P.ink.size * 3}px -apple-system, sans-serif`; c.textBaseline = 'middle'; c.fillText(inp.value, p.x, p.y);
      saveInk();
    }
    inp.remove();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = ''; inp.blur(); } });
  inp.addEventListener('blur', commit);
}
function saveInk() {
  if (!inkCanvas || !P.inkKey || !inkCanvas.width) return;
  const dpr = window.devicePixelRatio || 1;
  P.inkStore[P.inkKey] = { d: inkCanvas.toDataURL(), w: inkCanvas.width / dpr, h: inkCanvas.height / dpr };
}
function restoreInk() {
  if (!inkCanvas) return;
  inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0); inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height); inkCtx.restore();
  const st = P.inkStore[P.inkKey]; if (!st) return;
  const r = inkCanvas.getBoundingClientRect();
  const src = typeof st === 'string' ? st : st.d, w = st.w || r.width, h = st.h || r.height;
  const img = new Image(); img.onload = () => inkCtx.drawImage(img, 0, 0, w, h); img.src = src;
}

// ============================================================ floating tools
const TOOL_TITLES = { timer: `${IC('ico:timer')} Timer`, points: `${IC('ico:points')} Points`, noise: `${IC('ico:noise')} Noise meter`, random: `${IC('ico:random')} Randomizer`, signal: `${IC('ico:signal')} Signals` };
function currentClass() { const c = context(now()); return c.mode === 'class' ? c.cls : null; }
function renderTools() {
  const host = $('#p-tools'); if (!host) return;
  host.innerHTML = Object.entries(P.tools).map(([name, pos]) => `<div class="tool" data-toolwin="${name}" style="left:${pos.x}px;top:${pos.y}px">
    <div class="tool-head" data-drag="${name}">${TOOL_TITLES[name]}<button class="x" data-action="tool-close" data-tool="${name}">${IC('ico:close')}</button></div>
    <div class="tool-body">${toolBody(name)}</div></div>`).join('');
}
/** Put a tool where it was last left; if that's taken (or it's new), into the first free spot over the stage. */
function placeTool(n, fresh) {
  const el = $(`[data-toolwin="${n}"]`); if (!el) return;
  const w = el.offsetWidth, h = el.offsetHeight, gap = 12;
  const others = Object.keys(P.tools).filter(k => k !== n).map(k => $(`[data-toolwin="${k}"]`)?.getBoundingClientRect()).filter(Boolean);
  const hits = (x, y) => others.some(r => x < r.right + gap && x + w + gap > r.left && y < r.bottom + gap && y + h + gap > r.top);
  const fit = (x, y) => ({ x: clamp(x, 8, innerWidth - w - 8), y: clamp(y, 8, innerHeight - h - 8) });
  let p = fit(P.tools[n].x, P.tools[n].y);
  if (fresh || hits(p.x, p.y)) {
    const st = $('#p-stage')?.getBoundingClientRect() || $('.p-body')?.getBoundingClientRect() || { left: 40, top: 110, right: innerWidth, bottom: innerHeight };
    let found = null;
    // left to right, top to bottom over the stage, then anywhere on screen
    for (const area of [st, { left: 8, top: 80, right: innerWidth - 8, bottom: innerHeight - 8 }]) {
      for (let y = area.top + gap; !found && y + h <= area.bottom; y += 24)
        for (let x = area.left + gap; x + w <= area.right; x += 24) if (!hits(x, y)) { found = { x, y }; break; }
      if (found) break;
    }
    p = fit((found || p).x, (found || p).y);
  }
  P.tools[n] = p; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
}
function rerenderTool(name) { const el = $(`[data-toolwin="${name}"] .tool-body`); if (el) el.innerHTML = toolBody(name); }
const R = { last: '', used: new Set(), groups: null, groupN: 4 };
const NOISE = { stream: null, analyser: null, level: 0, limit: 60, warnAt: 0, beep: true };
function toolBody(name) {
  const cls = currentClass();
  switch (name) {
    case 'timer': return `<div class="presets">${[0.5, 1, 2, 3, 5, 10, 15].map(m => `<button class="btn" data-action="quick-timer" data-m="${m}">${m < 1 ? '30s' : m + 'm'}</button>`).join('')}</div>
      <div class="row"><input id="tt-min" type="number" min="0.1" step="0.5" value="4" style="width:70px"> min <input id="tt-label" placeholder="Label" class="grow" value="Work time"></div>
      <div class="row"><select id="tt-sound" class="grow">${soundOptions('bell')}</select><button class="btn primary" data-action="custom-timer">Start</button></div>`;
    case 'points': {
      if (!cls) return '<div class="muted">Points are kept per class. Show a class first.</div>';
      return cls.points.map((t, i) => `<div class="team"><input value="${esc(t.name)}" data-bind="${clsPath(cls)}.points.${i}.name"><button class="btn" data-action="pt" data-i="${i}" data-d="-1">−</button><span class="score">${t.score}</span><button class="btn primary" data-action="pt" data-i="${i}" data-d="1">+</button></div>`).join('') +
        `<div class="row"><button class="btn small" data-action="pt-add">+ Team</button><button class="btn small" data-action="pt-reset">Reset scores</button>${cls.points.length > 1 ? '<button class="btn small" data-action="pt-del">− Team</button>' : ''}</div>`;
    }
    case 'noise': return `<div class="meter" id="nm"><div></div><span class="lim" style="left:${NOISE.limit}%"></span></div>
      <div class="meter-label" id="nm-label">${NOISE.stream ? '…' : 'Microphone off'}</div>
      <label class="fld"><span>Too-loud limit</span><input type="range" min="10" max="100" value="${NOISE.limit}" data-action-input="noise-limit"></label>
      <label class="chk"><input type="checkbox" ${NOISE.beep ? 'checked' : ''} data-action-change="noise-beep"> Chime when too loud</label>
      ${NOISE.stream ? '<button class="btn" data-action="noise-stop">Stop microphone</button>' : '<button class="btn primary" data-action="noise-start">Start microphone</button>'}`;
    case 'random': {
      if (!cls) return '<div class="muted">Show a class to use its roster.</div>';
      if (!cls.roster.length) return '<div class="muted">This class has no roster yet. Add names in Setup → Classes.</div>';
      return `<div class="rand-out" id="rand-out">${esc(R.last || '—')}</div>
        <div class="row"><button class="btn primary grow" data-action="rand-pick">Pick a student</button><label class="chk small"><input type="checkbox" id="rand-norep" ${R.noRepeat ? 'checked' : ''} data-action-change="rand-norep"> No repeats</label></div>
        <div class="row"><span class="small muted">Groups of</span><input type="number" min="2" max="12" value="${R.groupN}" style="width:60px" data-action-input="rand-n"><button class="btn" data-action="rand-groups">Make groups</button></div>
        ${R.groups ? `<div class="groups">${R.groups.map((g, i) => `<div><b>Group ${i + 1}</b><br>${g.map(esc).join('<br>')}</div>`).join('')}</div>` : ''}`;
    }
    case 'signal': return `<div class="sig-grid">${SIGNALS.map((s, i) => `<button style="background:${s.color}" data-action="signal" data-i="${i}">${s.text}</button>`).join('')}</div>
      <div class="row"><input id="sig-custom" class="grow" placeholder="Custom signal…"><button class="btn" data-action="signal-custom">Show</button></div>
      <button class="btn" data-action="signal-clear">Clear signal</button>`;
  }
  return '';
}
const clsPath = cls => `classes.${S.classes.indexOf(cls)}`;
function soundOptions(sel) {
  return Object.entries(BUILTIN_SOUNDS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('') +
    audioFiles().map(([id, f]) => `<option value="file:${id}" ${sel === 'file:' + id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}
async function noiseStart() {
  try {
    NOISE.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const c = ac(); await c.resume();
    const src = c.createMediaStreamSource(NOISE.stream);
    NOISE.analyser = c.createAnalyser(); NOISE.analyser.fftSize = 1024; src.connect(NOISE.analyser);
    NOISE.buf = new Float32Array(NOISE.analyser.fftSize);
  } catch (e) { toast('Microphone not available: ' + e.message); NOISE.stream = null; }
  rerenderTool('noise');
}
function noiseStop() { NOISE.stream?.getTracks().forEach(t => t.stop()); NOISE.stream = null; NOISE.analyser = null; rerenderTool('noise'); }
function tickNoise() {
  if (!NOISE.analyser || !P.tools.noise) return;
  NOISE.analyser.getFloatTimeDomainData(NOISE.buf);
  let sum = 0; for (const v of NOISE.buf) sum += v * v;
  const db = 20 * Math.log10(Math.sqrt(sum / NOISE.buf.length) + 1e-6); // ~ -60 (quiet) .. 0 (loud)
  const lvl = clamp((db + 60) / 50 * 100, 0, 100);
  NOISE.level = NOISE.level * 0.7 + lvl * 0.3;
  const bar = $('#nm > div'), lab = $('#nm-label'); if (!bar) return;
  const L = NOISE.level, lim = NOISE.limit;
  bar.style.width = L + '%';
  bar.style.background = L > lim ? '#e63946' : L > lim * 0.75 ? '#f4a261' : '#2a9d8f';
  lab.innerHTML = L > lim ? IC('ico:loud') + ' Too loud!' : L > lim * 0.75 ? IC('ico:mid') + ' Getting loud' : L > lim * 0.4 ? IC('ico:good') + ' Good' : IC('ico:mute') + ' Quiet';
  if (L > lim && NOISE.beep && Date.now() - NOISE.warnAt > 5000) { NOISE.warnAt = Date.now(); playSound('ding'); }
}

// ============================================================ EDITOR
const TABS = [['classes', 'Classes'], ['schedule', 'Bell schedule'], ['routines', 'Daily routines'], ['notes', 'Notes & print'], ['events', 'Events'], ['library', 'Library'], ['settings', 'Settings']];
function renderEditor() {
  setTimeout(loadBackups, 0);                         // fills the backup list if Settings is showing
  const scroll = $('#e-main')?.scrollTop || 0;
  app().innerHTML = `<div class="editor">
    <header class="e-top"><div class="brand">${IC('ico:music')} Rehearsal <span class="ver" title="The version you're using (Settings → Updates)">${esc(WEB_VERSION)}</span></div>
      <nav class="tabs">${TABS.map(([k, v]) => `<button class="tab ${TAB === k ? 'on' : ''}" data-action="tab" data-tab="${k}">${v}</button>`).join('')}</nav>
      <button class="btn primary" data-action="present">${IC('ico:play')} Present</button></header>
    <div class="e-main" id="e-main"><div class="e-wrap">${tabHTML()}</div></div></div>`;
  $('#e-main').scrollTop = scroll;
}
function tabHTML() {
  switch (TAB) {
    case 'classes': return classesTab();
    case 'schedule': return scheduleTab();
    case 'routines': return routinesTab();
    case 'notes': return notesTab();
    case 'events': return eventsTab();
    case 'library': return libraryTab();
    case 'settings': return settingsTab();
  }
  return '';
}

// ---------- classes
function classesTab() {
  if (!SEL_CLASS || !S.classes.find(c => c.id === SEL_CLASS)) SEL_CLASS = S.classes[0]?.id || null;
  const cls = S.classes.find(c => c.id === SEL_CLASS);
  const list = `<div class="card"><div class="card-head"><h3>Classes</h3><span class="grow"></span><button class="btn small" data-action="class-add">+ Add</button></div>
    <div class="list">${S.classes.map(c => `<div class="list-item ${c.id === SEL_CLASS ? 'on' : ''}" data-action="class-sel" data-id="${c.id}"><span class="swatch" style="background:${c.theme.bg}"></span><span class="grow">${esc(c.name)}<br><span class="small muted">${esc(c.subtitle)}</span></span></div>`).join('') || '<div class="empty">No classes yet.</div>'}</div></div>`;
  if (!cls) return `<div class="split">${list}<div class="card"><div class="empty">Add a class to get started.</div></div></div>`;
  const i = S.classes.indexOf(cls), base = `classes.${i}`;
  const th = cls.theme;
  const detail = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="card">
      <div class="card-head"><h2>Class details</h2><span class="grow"></span><button class="btn small" data-action="class-preview">${IC('ico:play')} Preview on screen</button><button class="btn small" data-action="clip-open">${IC('ico:clip')} Copy / paste</button><button class="btn small" data-action="icons-open">${IC('ico:icons')} Icons</button><button class="btn small" data-action="class-dup">Duplicate</button><button class="btn small danger" data-action="class-del">Delete</button></div>
      <div class="row"><label class="fld grow"><span>Name</span><input data-bind="${base}.name" data-rerender-blur value="${esc(cls.name)}"></label>
      <label class="fld grow"><span>Subtitle (period, room…)</span><input data-bind="${base}.subtitle" value="${esc(cls.subtitle)}"></label></div>
    </div>
    <div class="card"><h2>Look</h2><p class="desc">Each class gets its own colors so students instantly know which class they're in.</p>
      <div class="themes">${THEMES.map((t, k) => `<span class="theme-chip ${t.bg === th.bg && t.accent === th.accent ? 'on' : ''}" style="background:${t.bg};color:${t.text}" data-action="theme" data-k="${k}">${t.name} <span style="color:${t.accent}">●</span></span>`).join('')}</div>
      <div class="row" style="margin-top:12px">
        <label class="fld"><span>Background</span><input type="color" data-bind="${base}.theme.bg" data-rerender value="${th.bg}"></label>
        <label class="fld"><span>Accent</span><input type="color" data-bind="${base}.theme.accent" data-rerender value="${th.accent}"></label>
        <label class="fld"><span>Text</span><input type="color" data-bind="${base}.theme.text" data-rerender value="${th.text || '#ffffff'}"></label>
        <label class="fld grow"><span>Background image URL (optional)</span><input data-bind="${base}.theme.image" data-rerender value="${esc(th.image && !th.image.startsWith('file:') ? th.image : '')}" placeholder="https://…"></label>
        <button class="btn small" data-action="theme-image" style="align-self:flex-end">Use a picture…</button>
        ${th.image ? `<button class="btn small" data-action="theme-image-clear" style="align-self:flex-end">Remove picture</button>` : ''}
      </div>
      <div class="preview-strip" style="margin-top:12px;background-color:${th.bg};color:${th.text};${th.image ? `background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url('${th.image.startsWith('file:') ? fileDirectURL(th.image.slice(5)) : esc(th.image)}')` : ''}"><b style="font-size:20px">${esc(cls.name)}</b><span style="background:${th.accent};color:${th.bg};padding:3px 10px;border-radius:99px;font-weight:700;font-size:12px">Current step</span></div>
    </div>
    <div class="card"><div class="card-head"><h2>Agenda</h2><span class="grow"></span><button class="btn small" data-action="agenda-add">+ Step</button></div>
      <p class="desc">Steps show on the side of the screen. Add minutes and the agenda moves forward on its own during class. Leave minutes blank to move it yourself (or with an automation).</p>
      ${cls.agenda.map((a, k) => `<div class="agenda-row"><span class="muted">${k + 1}.</span><input data-bind="${base}.agenda.${k}.text" value="${esc(a.text)}" placeholder="Step"><input type="number" min="0" data-type="num" data-bind="${base}.agenda.${k}.min" value="${a.min || ''}" placeholder="—"><span class="muted small">min</span><button class="iconbtn" data-action="agenda-del" data-k="${k}">${IC('ico:close')}</button></div>`).join('') || '<div class="empty">No steps yet.</div>'}
      ${cls.agenda.some(a => a.min) ? `<div class="small muted">Total: ${cls.agenda.reduce((s, a) => s + (Number(a.min) || 0), 0)} min</div>` : ''}
    </div>
    <div class="card"><h2>Warm-up question</h2><p class="desc">Shown big on the screen when no resource is selected.</p>
      <label class="chk" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input type="checkbox" data-bind="${base}.hideWarmup" ${cls.hideWarmup ? 'checked' : ''}> Hide the warm-up tab for this class</label>
      <label class="chk" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input type="checkbox" data-bind="${base}.sideProgress" ${cls.sideProgress ? 'checked' : ''}> Show the Progress tracker in the side panel</label>
      <textarea rows="3" data-bind="${base}.warmup" placeholder="What do you notice? What do you wonder?">${esc(cls.warmup)}</textarea></div>
    <div class="card"><div class="card-head"><h2>Resources</h2><span class="grow"></span>
        ${IS_NATIVE ? '<button class="btn small primary" data-action="drive-browse">Browse Google Drive…</button>' : ''}
        <button class="btn small" data-action="res-add-url">+ Link</button><button class="btn small" data-action="res-add-file">+ File (PDF, image, video)</button></div>
      <p class="desc">Google Slides, Docs, Sheets, Forms, Drive files, YouTube, Canva or any web page, plus PDFs and images from your Mac. They appear as tabs on the Present screen.</p>
      ${cls.resources.map((r, k) => `<div class="res-item"><span style="font-size:18px">${resIcon(r) === '-' ? '' : resIcon(r)}</span>
        <div class="row" style="gap:6px"><input class="grow" data-bind="${base}.resources.${k}.title" value="${esc(r.title)}" placeholder="Title">
        ${r.widget ? `<span class="pill">${IC(WIDGETS[r.widget.kind].icon)} ${WIDGETS[r.widget.kind].title}</span>` : r.music ? `<span class="pill">${IC(kindIcon(r.music.kind))} ${r.music.kind === 'tuner' ? 'Tuner & drone' : 'Metronome'}</span>` : r.sight ? `<span class="pill">${IC('ico:sight')} Sight-reading (${r.sight.mode})</span>` : r.url != null ? `<input class="grow" data-bind="${base}.resources.${k}.url" value="${esc(r.url)}" placeholder="https://…" style="flex:2">` : `<span class="pill">${esc(S.files[r.fileId]?.name || 'missing file')}</span>`}
        ${resKind(r) === 'slides' || resKind(r) === 'doc' ? `<select data-bind="${base}.resources.${k}.mode" title="How it appears"><option value="embed" ${r.mode !== 'edit' ? 'selected' : ''}>Presenter view</option><option value="edit" ${r.mode === 'edit' ? 'selected' : ''}>Editor view</option></select>` : ''}</div>
        <span class="row" style="gap:2px"><button class="iconbtn" data-action="res-move" data-k="${k}" data-d="-1">${IC('ico:up')}</button><button class="iconbtn" data-action="res-move" data-k="${k}" data-d="1">${IC('ico:down')}</button><button class="iconbtn" data-action="res-del" data-k="${k}">${IC('ico:close')}</button></span></div>`).join('') || '<div class="empty">No resources yet.</div>'}
    </div>
    ${timelineCard(cls, i)}
    <div class="card"><h2>Roster</h2><p class="desc">One name per line. Used by the randomizer and group maker.</p>
      <textarea rows="6" data-type="lines" data-bind="${base}.roster" placeholder="Avery&#10;Jordan&#10;…">${esc(cls.roster.join('\n'))}</textarea></div>
  </div>`;
  return `<div class="split">${list}${detail}</div>`;
}

function autoRow(a, path, cls, k, kind) {
  const when = kind === 'class'
    ? `<input type="number" min="0" step="0.5" data-type="num" data-bind="${path}.offset" value="${a.offset ?? 0}"> min
       <select data-bind="${path}.anchor"><option value="start" ${a.anchor !== 'end' ? 'selected' : ''}>after start</option><option value="end" ${a.anchor === 'end' ? 'selected' : ''}>before end</option></select>`
    : `<input type="time" data-bind="${path}.time" value="${a.time || ''}">
       <div class="row" style="gap:3px">${DAYS_SHORT.map((d, di) => `<button class="btn small ${(a.days || []).includes(di) ? 'primary' : ''}" data-action="routine-day" data-k="${k}" data-d="${di}" style="padding:2px 6px">${d[0]}</button>`).join('')}</div>`;
  return `<div class="auto-row">
    <input type="checkbox" ${a.enabled !== false ? 'checked' : ''} data-bind="${path}.enabled" title="On/off">
    <div class="auto-when">${when}</div>
    <div class="auto-fields"><label class="fld"><span>Do this</span><select data-bind="${path}.action" data-rerender>${Object.entries(ACTION_TYPES).map(([v, l]) => `<option value="${v}" ${a.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${actionFields(a, path, cls)}</div>
    <button class="iconbtn" data-action="${kind === 'class' ? 'auto-del' : 'routine-del'}" data-k="${k}">${IC('ico:close')}</button></div>`;
}
function actionFields(a, base, cls) {
  const f = (label, html, wide = false) => `<label class="fld ${wide ? 'wide' : ''}"><span>${label}</span>${html}</label>`;
  const txt = (k, ph = '') => `<input data-bind="${base}.${k}" value="${esc(a[k] ?? '')}" placeholder="${esc(ph)}">`;
  const num = (k, step = 1, w = 80) => `<input type="number" min="0" step="${step}" data-type="num" data-bind="${base}.${k}" value="${a[k] ?? ''}" style="width:${w}px">`;
  const snd = k => `<select data-bind="${base}.${k}">${soundOptions(a[k] || 'chime')}</select>`;
  switch (a.action) {
    case 'message': return f('Message', txt('text', 'What should the screen say?'), true) + f('Seconds', num('seconds'));
    case 'timer': return f('Label', txt('label', 'e.g. Warm-up')) + f('Minutes', num('minutes', 0.5)) + f('End sound', snd('sound')) + f('Then show', txt('endMessage', "Time's up!"), true) +
      `<label class="chk"><input type="checkbox" data-bind="${base}.stopMusic" ${a.stopMusic ? 'checked' : ''}> Stop music at end</label>`;
    case 'sound': return f('Sound', snd('sound')) + `<button class="btn small" data-action="test-sound" data-s="${esc(a.sound || 'chime')}" style="align-self:flex-end">${IC('ico:play')} Test</button>`;
    case 'musicStart': {
      const af = audioFiles();
      if (!af.length) return `<div class="small muted" style="align-self:center">Add music files in the Library tab first.</div>`;
      return f('Music', `<select data-bind="${base}.fileId"><option value="">Choose…</option>${af.map(([id, x]) => `<option value="${id}" ${a.fileId === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) + f('Volume %', num('volume', 5)) +
        `<label class="chk"><input type="checkbox" data-bind="${base}.loop" ${a.loop !== false ? 'checked' : ''}> Loop</label>`;
    }
    case 'resource': return cls ? f('Resource', `<select data-bind="${base}.resourceId"><option value="">Choose…</option>${cls.resources.map(r => `<option value="${r.id}" ${a.resourceId === r.id ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>`) : '<div class="small muted">Shows a resource of the current class.</div>';
    case 'agenda': return cls ? f('Step', `<select data-type="num" data-bind="${base}.step">${cls.agenda.map((x, i) => `<option value="${i}" ${Number(a.step) === i ? 'selected' : ''}>${i + 1}. ${esc(x.text)}</option>`).join('')}</select>`) : f('Step #', num('step'));
    case 'signal': return f('Text', txt('text', 'Silent'), true) + f('Color', `<input type="color" data-bind="${base}.color" value="${a.color || '#e63946'}">`);
    default: return '';
  }
}

// ---------- schedule
function scheduleTab() {
  const opts = (sel, extra = '') => `${extra}${S.templates.map(t => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
  const today = new Date();
  const days = [...Array(14)].map((_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return d; });
  const ovs = Object.entries(S.overrides).sort(([a], [b]) => a.localeCompare(b));
  return `
  <div class="card"><h2>Weekly pattern</h2><p class="desc">Which bell schedule runs on each day of the week.</p>
    <div class="week">${DAYS_SHORT.map((d, i) => `<label class="fld"><span>${d}</span><select data-bind="weekdays.${i}" data-rerender>${opts(S.weekdays[i], `<option value="">No school</option>`)}</select></label>`).join('')}</div></div>
  <div class="card"><div class="card-head"><h2>Special days</h2><span class="grow"></span><button class="btn small" data-action="ov-add">+ Add date</button></div>
    <p class="desc">Early release, assemblies, holidays — swap in a different bell schedule (or no school) for one date.</p>
    ${ovs.length ? `<table class="tbl"><tr><th>Date</th><th>Schedule</th><th></th></tr>${ovs.map(([k, v]) => `<tr><td>${longDate(parseKey(k))}, ${k.slice(0, 4)}</td><td><select data-bind="overrides.${k}" data-rerender>${opts(v, `<option value="none" ${v === 'none' ? 'selected' : ''}>No school</option>`)}</select></td><td style="width:30px"><button class="iconbtn" data-action="ov-del" data-k="${k}">${IC('ico:close')}</button></td></tr>`).join('')}</table>` : '<div class="empty">No special days.</div>'}
  </div>
  <div class="card"><h2>Next two weeks</h2>
    <div class="days14">${days.map(d => { const t = templateFor(d); return `<div class="day-cell ${dateKey(d) === dateKey(today) ? 'today' : ''}"><b>${DAYS_SHORT[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}</b>${t ? esc(t.name) : '<span class="muted">—</span>'}</div>`; }).join('')}</div></div>
  ${S.templates.map((t, ti) => `<div class="card">
    <div class="card-head"><input data-bind="templates.${ti}.name" value="${esc(t.name)}" style="font-weight:700;font-size:15px"><span class="grow"></span>
      <button class="btn small" data-action="tpl-dup" data-k="${ti}">Duplicate</button><button class="btn small danger" data-action="tpl-del" data-k="${ti}">Delete</button></div>
    <table class="tbl"><tr><th>Class</th><th style="width:150px">Starts</th><th style="width:150px">Ends</th><th style="width:30px"></th></tr>
    ${t.periods.map((p, pi) => `<tr><td><select data-bind="templates.${ti}.periods.${pi}.classId">${S.classes.map(c => `<option value="${c.id}" ${p.classId === c.id ? 'selected' : ''}>${esc(c.name)}${c.subtitle ? ' · ' + esc(c.subtitle) : ''}</option>`).join('')}</select></td>
      <td><input type="time" data-bind="templates.${ti}.periods.${pi}.start" value="${p.start}"></td><td><input type="time" data-bind="templates.${ti}.periods.${pi}.end" value="${p.end}"></td>
      <td><button class="iconbtn" data-action="per-del" data-k="${ti}" data-p="${pi}">${IC('ico:close')}</button></td></tr>`).join('')}</table>
    <button class="btn small" style="margin-top:8px" data-action="per-add" data-k="${ti}">+ Period</button></div>`).join('')}
  <button class="btn" data-action="tpl-add" style="align-self:flex-start">+ New bell schedule</button>`;
}

// ---------- routines
function routinesTab() {
  return `<div class="card"><div class="card-head"><h2>Daily routines</h2><span class="grow"></span><button class="btn small" data-action="routine-add">+ Add routine</button></div>
    <p class="desc">Things that happen at a set clock time, whatever class is on — morning music, lunch reminders, end-of-day announcements.</p>
    ${S.routines.map((r, k) => autoRow(r, `routines.${k}`, null, k, 'routine')).join('') || '<div class="empty">No routines yet.</div>'}
    <label class="chk" style="margin-top:10px"><span class="small muted">Routines only run on days that have a bell schedule if you tick “school days only” here:</span></label>
    ${S.routines.map((r, k) => `<label class="chk small" style="margin-right:12px"><input type="checkbox" data-bind="routines.${k}.schoolDaysOnly" ${r.schoolDaysOnly ? 'checked' : ''}> #${k + 1} school days only</label>`).join('')}
  </div>`;
}

// ============================================================ automation timeline (Classes tab)
// A class period laid out left→right. Lanes: Agenda, Messages, Timers, Sound & music, Screen.
// Drag an event to move it, drag its right-edge handle to change how long it lasts, drag a chip
// from the palette (or double-click a lane) to add one, click to select and edit details.
const TL_LANES = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'msg', label: 'Messages', types: ['message'], def: 'message' },
  { key: 'timer', label: 'Timers', types: ['timer'], def: 'timer' },
  { key: 'audio', label: 'Sound & music', types: ['sound', 'musicStart', 'musicStop'], def: 'sound' },
  { key: 'screen', label: 'Screen', types: ['resource', 'warmup', 'agenda', 'signal', 'clearSignal'], def: 'signal' },
];
const TL_PALETTE = [
  ['message', `${IC('ico:message')} Message`], ['timer', `${IC('ico:timer')} Timer`], ['sound', `${IC('ico:bell')} Sound`], ['musicStart', `${IC('ico:music')} Music`], ['musicStop', `${IC('ico:stop')} Stop music`],
  ['resource', `${IC('ico:image')} Resource`], ['warmup', `${IC('ico:warmup')} Warm-up`], ['agenda', `${IC('ico:agenda')} Agenda step`], ['signal', `${IC('ico:signal')} Signal`], ['clearSignal', `${IC('ico:close')} Clear signal`],
];
const TL_SNAP = 0.25;              // quarter-minute (15 s) steps
let TL_SEL = null;                 // automation id, or 'ag:<index>'
let TL = null;                     // active drag
const laneOf = type => TL_LANES.find(l => l.types && l.types.includes(type))?.key || 'screen';
const tlSnap = m => Math.round(m / TL_SNAP) * TL_SNAP;
const fmtMin = m => { const s = Math.round(m * 60), mm = Math.floor(s / 60), ss = s % 60; return ss ? `${mm}:${pad(ss)}` : `${mm} min`; };

/** How long this class's period is (longest on any bell schedule), plus a start time for clock labels. */
function classPeriod(cls) {
  let best = null;
  for (const t of S.templates) for (const p of t.periods) {
    if (p.classId !== cls.id || !p.start || !p.end) continue;
    const len = (atTime(new Date(), p.end) - atTime(new Date(), p.start)) / 60000;
    if (len > 0 && (!best || len > best.len)) best = { len, start: p.start };
  }
  return best || { len: 50, start: '' };
}
const tlDur = a => a.action === 'timer' ? (Number(a.minutes) || 1) : (a.action === 'musicStart' || a.action === 'signal') ? (Number(a.minutes) || 0) : 0;
const tlStart = (a, D) => a.anchor === 'end' ? D - (Number(a.offset) || 0) : (Number(a.offset) || 0);
function tlSetStart(a, t, D) { t = clamp(tlSnap(t), 0, D); a.offset = a.anchor === 'end' ? +(D - t).toFixed(2) : +t.toFixed(2); }
function tlLabel(a, cls) {
  switch (a.action) {
    case 'message': return (a.text || 'Message');
    case 'timer': return `${a.label || 'Timer'} · ${fmtMin(Number(a.minutes) || 1)}`;
    case 'sound': return (BUILTIN_SOUNDS[a.sound] || S.files[(a.sound || '').slice(5)]?.name || 'Sound');
    case 'musicStart': return (S.files[a.fileId]?.name || 'Music') + (a.minutes ? '' : ' →');
    case 'musicStop': return 'Stop music';
    case 'resource': return (cls.resources.find(r => r.id === a.resourceId)?.title || 'Resource');
    case 'warmup': return 'Warm-up';
    case 'agenda': return (cls.agenda[Number(a.step) || 0]?.text || `Step ${(Number(a.step) || 0) + 1}`);
    case 'signal': return (a.text || 'Signal');
    case 'clearSignal': return 'Clear signal';
  }
  return a.action;
}
/** Agenda steps as back-to-back blocks; steps without minutes share whatever time is left. */
function tlAgendaBlocks(cls, D) {
  const set = cls.agenda.reduce((s, x) => s + (Number(x.min) || 0), 0);
  const unset = cls.agenda.filter(x => !(Number(x.min) > 0)).length;
  const share = unset ? Math.max(1, (D - set) / unset) : 0;
  let t = 0;
  return cls.agenda.map((x, k) => { const len = Number(x.min) > 0 ? Number(x.min) : share; const b = { k, t, len, guess: !(Number(x.min) > 0), text: x.text }; t += len; return b; });
}
/** Put overlapping events of one lane on separate rows (markers count their label's width). */
function tlRows(items, D, cls) {
  const minPerPx = D / 760;   // approx. track width; good enough for spacing labels
  for (const it of items) {
    if (it.d > 0) { it.s = it.t; it.e = it.t + it.d; continue; }
    const w = Math.min(220, 7 * tlLabel(it.a, cls).length + 30) * minPerPx;
    it.flip = it.t > D * 0.7;
    it.s = it.flip ? it.t - w : it.t; it.e = it.flip ? it.t : it.t + w;
  }
  const rows = [];
  for (const it of [...items].sort((a, b) => a.s - b.s)) {
    let r = rows.findIndex(end => end <= it.s + 0.01);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = it.e; it.row = r;
  }
  return Math.max(1, rows.length);
}

function timelineCard(cls, ci) {
  const per = classPeriod(cls), D = per.len;
  const pct = m => (clamp(m, 0, D) / D * 100).toFixed(3) + '%';
  const step = D <= 30 ? 5 : D <= 70 ? 5 : D <= 120 ? 10 : 15;
  let ruler = '';
  for (let m = 0; m < D - step * 1.1; m += step) {
    const clock = per.start ? fmtHM(addMin(per.start, Math.round(m))) : '';
    ruler += `<div class="tl-tick" style="left:${pct(m)}"><span>${m === 0 ? 'Start' : m + 'm'}${clock ? `<em>${clock}</em>` : ''}</span></div>`;
  }
  ruler += `<div class="tl-tick end" style="left:100%"><span>End${per.start ? `<em>${fmtHM(addMin(per.start, Math.round(D)))}</em>` : ''}</span></div>`;

  const lanes = TL_LANES.map(L => {
    let body = '', rowsN = 1;
    if (L.key === 'agenda') {
      body = tlAgendaBlocks(cls, D).map(b => `<div class="tl-ev tl-ag ${b.guess ? 'guess' : ''} ${TL_SEL === 'ag:' + b.k ? 'sel' : ''}" data-tl-ag="${b.k}" style="left:${pct(b.t)};width:${pct(b.len)};top:4px"
          title="${esc(b.text)} — ${b.guess ? 'no length set (sharing leftover time)' : fmtMin(b.len)}"><span>${b.k + 1}. ${esc(b.text || 'Step')}</span><i class="tl-h" data-tl-handle="ag:${b.k}"></i></div>`).join('')
        || `<div class="tl-empty">Add agenda steps below to see them here.</div>`;
    } else {
      const items = cls.automations.map((a, k) => ({ a, k, t: tlStart(a, D), d: tlDur(a) })).filter(x => laneOf(x.a.action) === L.key);
      rowsN = tlRows(items, D, cls);
      body = items.map(({ a, t, d, row, flip }) => {
        const bar = d > 0, canGrow = ['timer', 'musicStart', 'signal'].includes(a.action);
        return `<div class="tl-ev ${bar ? 'bar' : 'mark'} ${!bar && flip ? 'flip' : ''} ${a.enabled === false ? 'off' : ''} ${TL_SEL === a.id ? 'sel' : ''} k-${a.action}" data-tl-id="${a.id}"
          style="left:${pct(t)};${bar ? `width:${pct(d)};` : ''}top:${4 + row * 30}px" title="${esc(tlLabel(a, cls))} — ${a.anchor === 'end' ? fmtMin(Number(a.offset) || 0) + ' before end' : fmtMin(Number(a.offset) || 0) + ' after start'}">
          <span>${esc(tlLabel(a, cls))}</span>${canGrow ? `<i class="tl-h" data-tl-handle="${a.id}" title="Drag to change how long it lasts"></i>` : ''}</div>`;
      }).join('');
    }
    return `<div class="tl-lane" data-tl-lane="${L.key}" style="height:${8 + rowsN * 30}px"><div class="tl-lane-label">${L.label}</div><div class="tl-track" data-tl-track="${L.key}">${body}</div></div>`;
  }).join('');

  return `<div class="card"><div class="card-head"><h2>Automations timeline</h2><span class="grow"></span><span class="small muted">${fmtMin(D)} period${per.start ? ' · starts ' + fmtHM(per.start) : ''}</span></div>
    <p class="desc">Drag an event to move it. Drag its right edge to make it longer or shorter. Drag a chip onto the timeline, or double-click a lane, to add one. Click an event to edit it, and press Delete to remove it.</p>
    <div class="tl-palette">${TL_PALETTE.map(([t, l]) => `<span class="tl-chip k-${t}" data-tl-new="${t}">${l}</span>`).join('')}</div>
    <div class="tl" data-tl-class="${ci}" data-tl-d="${D}" style="--tickw:${(step / D * 100).toFixed(4)}%">
      <div class="tl-ruler"><div class="tl-lane-label"></div><div class="tl-track">${ruler}</div></div>
      ${lanes}
    </div>
    ${tlDetails(cls, ci, D)}
  </div>`;
}

function tlDetails(cls, ci, D) {
  if (TL_SEL && TL_SEL.startsWith('ag:')) {
    const k = +TL_SEL.slice(3), st = cls.agenda[k]; if (!st) return '';
    return `<div class="tl-details"><b>Agenda step ${k + 1}</b>
      <label class="fld wide"><span>Step</span><input data-rerender-blur data-bind="classes.${ci}.agenda.${k}.text" value="${esc(st.text)}"></label>
      <label class="fld"><span>Minutes</span><input type="number" min="0" data-type="num" data-rerender-blur data-bind="classes.${ci}.agenda.${k}.min" value="${st.min || ''}" style="width:80px"></label>
      <button class="btn small danger" data-action="agenda-del" data-k="${k}">Remove step</button></div>`;
  }
  const k = cls.automations.findIndex(a => a.id === TL_SEL);
  if (k < 0) return `<div class="tl-details muted small">Select an event to edit its details.</div>`;
  const a = cls.automations[k], path = `classes.${ci}.automations.${k}`;
  const fields = actionFields(a, path, cls).replace(/data-bind=/g, 'data-rerender-blur data-bind=');
  const grow = ['musicStart', 'signal'].includes(a.action)
    ? `<label class="fld"><span>Lasts (min, 0 = until stopped)</span><input type="number" min="0" step="0.5" data-type="num" data-rerender-blur data-bind="${path}.minutes" value="${a.minutes || 0}" style="width:90px"></label>` : '';
  return `<div class="tl-details">
    <label class="chk"><input type="checkbox" data-rerender data-bind="${path}.enabled" ${a.enabled !== false ? 'checked' : ''}> On</label>
    <label class="fld"><span>Do this</span><select data-rerender data-bind="${path}.action">${Object.entries(ACTION_TYPES).map(([v, l]) => `<option value="${v}" ${a.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="fld"><span>When</span><span class="row" style="gap:4px"><input type="number" min="0" step="0.25" data-type="num" data-rerender-blur data-bind="${path}.offset" value="${a.offset ?? 0}" style="width:70px"> min
      <select data-rerender data-bind="${path}.anchor"><option value="start" ${a.anchor !== 'end' ? 'selected' : ''}>after start</option><option value="end" ${a.anchor === 'end' ? 'selected' : ''}>before end</option></select></span></label>
    ${fields}${grow}
    <span class="grow"></span>
    <button class="btn small" data-action="tl-dup">Duplicate</button><button class="btn small danger" data-action="tl-del">Delete</button>
  </div>`;
}

function tlNewEvent(type, t, cls, D) {
  const a = { id: uid(), enabled: true, action: type, anchor: t > D / 2 ? 'end' : 'start', offset: 0 };
  ({
    message: () => Object.assign(a, { text: 'New message', seconds: 8 }),
    timer: () => Object.assign(a, { label: 'Timer', minutes: 3, sound: 'bell', endMessage: '' }),
    sound: () => Object.assign(a, { sound: 'chime' }),
    musicStart: () => Object.assign(a, { fileId: audioFiles()[0]?.[0] || '', volume: 70, loop: true, minutes: 0 }),
    resource: () => Object.assign(a, { resourceId: cls.resources[0]?.id || '' }),
    agenda: () => Object.assign(a, { step: 0 }),
    signal: () => Object.assign(a, { text: 'Silent', color: '#e63946', minutes: 0 }),
  }[type] || (() => { }))();
  tlSetStart(a, t, D);
  cls.automations.push(a); TL_SEL = a.id; save(); tlRerender();
}

// ---------- pointer handling
function tlCtx(el) {
  const tl = el.closest('.tl'); if (!tl) return null;
  const cls = S.classes[+tl.dataset.tlClass], D = +tl.dataset.tlD;
  const track = tl.querySelector('.tl-lane .tl-track').getBoundingClientRect();
  return { tl, cls, D, x0: track.left, ppm: track.width / D };
}
document.addEventListener('pointerdown', e => {
  if ((VIEW !== 'edit' && !P.autoDrawer) || e.button !== 0) return;
  const chip = e.target.closest('[data-tl-new]');
  if (chip) {
    e.preventDefault();
    const ghost = chip.cloneNode(true); ghost.classList.add('tl-ghost'); document.body.appendChild(ghost);
    TL = { mode: 'new', type: chip.dataset.tlNew, ghost, ctx: tlCtx($('.tl')) };
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    return;
  }
  const h = e.target.closest('[data-tl-handle]'), ev = e.target.closest('[data-tl-id], [data-tl-ag]');
  if (!h && !ev) return;
  const ctx = tlCtx(e.target); if (!ctx) return;
  e.preventDefault();
  const el = (h || ev).closest('.tl-ev');
  if (h) {
    const id = h.dataset.tlHandle;
    if (id.startsWith('ag:')) {
      const b = tlAgendaBlocks(ctx.cls, ctx.D)[+id.slice(3)];
      TL = { mode: 'ag', k: b.k, len0: b.len, sx: e.clientX, el, ctx };
    } else {
      const a = ctx.cls.automations.find(x => x.id === id);
      TL = { mode: 'grow', a, d0: tlDur(a), t0: tlStart(a, ctx.D), sx: e.clientX, el, ctx };
    }
  } else if (ev.dataset.tlAg != null) {
    TL_SEL = 'ag:' + ev.dataset.tlAg; TL = { mode: 'click', el, ctx };
  } else {
    const a = ctx.cls.automations.find(x => x.id === ev.dataset.tlId);
    TL = { mode: 'move', a, t0: tlStart(a, ctx.D), sx: e.clientX, moved: false, el, ctx };
  }
  el.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!TL) return;
  const { ctx } = TL;
  if (TL.mode === 'new') {
    TL.ghost.style.left = e.clientX + 'px'; TL.ghost.style.top = e.clientY + 'px';
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl');
    TL.ghost.classList.toggle('ok', !!over);
    return;
  }
  const dm = (e.clientX - (TL.sx ?? e.clientX)) / ctx.ppm;
  const pct = m => (m / ctx.D * 100) + '%';
  if (TL.mode === 'move') {
    if (Math.abs(e.clientX - TL.sx) > 3) TL.moved = true;
    const t = clamp(tlSnap(TL.t0 + dm), 0, ctx.D - Math.min(tlDur(TL.a), ctx.D));
    TL.t = t; TL.el.style.left = pct(t);
    TL.el.dataset.tip = fmtMin(t);
  } else if (TL.mode === 'grow') {
    const d = clamp(tlSnap(TL.d0 + dm), TL.a.action === 'timer' ? TL_SNAP : 0, ctx.D - TL.t0);
    TL.d = d; TL.el.classList.toggle('bar', d > 0); TL.el.style.width = d > 0 ? pct(d) : '';
    TL.el.dataset.tip = d > 0 ? fmtMin(d) : 'until stopped';
  } else if (TL.mode === 'ag') {
    const len = Math.max(1, Math.round(TL.len0 + dm));
    TL.len = len; TL.el.style.width = pct(len); TL.el.dataset.tip = len + ' min';
  }
});
document.addEventListener('pointerup', e => {
  if (!TL) return;
  const d = TL; TL = null;
  d.el?.classList.remove('dragging');
  if (d.mode === 'new') {
    d.ghost.remove();
    const tl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl');
    if (tl && d.ctx) { const t = (e.clientX - d.ctx.x0) / d.ctx.ppm; tlNewEvent(d.type, clamp(t, 0, d.ctx.D), d.ctx.cls, d.ctx.D); }
    return;
  }
  if (d.mode === 'move') {
    TL_SEL = d.a.id;
    if (d.moved && d.t != null) tlSetStart(d.a, d.t, d.ctx.D);
  } else if (d.mode === 'grow' && d.d != null) {
    d.a.minutes = +d.d.toFixed(2); TL_SEL = d.a.id;
  } else if (d.mode === 'ag' && d.len != null) {
    d.ctx.cls.agenda[d.k].min = d.len; TL_SEL = 'ag:' + d.k;
  }
  save(); tlRerender();
});
document.addEventListener('dblclick', e => {
  if (VIEW !== 'edit' && !P.autoDrawer) return;
  const track = e.target.closest('[data-tl-track]'); if (!track || e.target.closest('.tl-ev')) return;
  const L = TL_LANES.find(l => l.key === track.dataset.tlTrack); if (!L?.def) return;
  const ctx = tlCtx(track); if (!ctx) return;
  tlNewEvent(L.def, (e.clientX - ctx.x0) / ctx.ppm, ctx.cls, ctx.D);
});
document.addEventListener('keydown', e => {
  if ((VIEW !== 'edit' || TAB !== 'classes') && !P.autoDrawer) return; if (!TL_SEL || TL_SEL.startsWith('ag:')) return;
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); A['tl-del'](); }
});

// ---------- notes & print
let NOTE_CLASS = null, NOTE_DATE = dateKey(new Date());
function notesTab() {
  if (!NOTE_CLASS || !S.classes.find(c => c.id === NOTE_CLASS)) NOTE_CLASS = S.classes[0]?.id;
  const cls = S.classes.find(c => c.id === NOTE_CLASS);
  if (!cls) return '<div class="card"><div class="empty">Add a class first.</div></div>';
  const i = S.classes.indexOf(cls);
  const dates = Object.keys(cls.notes).filter(k => cls.notes[k]?.trim()).sort().reverse();
  return `<div class="card"><h2>Class notes</h2><p class="desc">Lesson notes for each class and day. Print them, save as PDF, or make a sub plan.</p>
    <div class="row"><select data-action-change="note-class">${S.classes.map(c => `<option value="${c.id}" ${c.id === NOTE_CLASS ? 'selected' : ''}>${esc(c.name)}${c.subtitle ? ' · ' + esc(c.subtitle) : ''}</option>`).join('')}</select>
      <button class="btn small" data-action="note-shift" data-d="-1">‹</button><input type="date" value="${NOTE_DATE}" data-action-change="note-date"><button class="btn small" data-action="note-shift" data-d="1">›</button>
      <button class="btn small" data-action="note-today">Today</button><span class="grow"></span>
      <button class="btn small" data-action="print-note">${IC('ico:print')} Print this note</button></div>
    <div style="margin-top:6px" class="small muted">${longDate(parseKey(NOTE_DATE))}${templateFor(parseKey(NOTE_DATE)) ? ' · ' + esc(templateFor(parseKey(NOTE_DATE)).name) : ' · no school'}</div>
    <textarea class="notes-area" style="margin-top:8px" data-bind="classes.${i}.notes.${NOTE_DATE}" placeholder="Objectives, materials, what you covered, reminders for next time…">${esc(cls.notes[NOTE_DATE] || '')}</textarea>
    <label class="fld" style="margin-top:10px"><span>Notes on screen this day (students see these on the Present screen, under Today)</span><textarea rows="3" data-bind="classes.${i}.screenNotes.${NOTE_DATE}" placeholder="Bring your folder, concert dress, …">${esc((cls.screenNotes || {})[NOTE_DATE] || '')}</textarea></label>
    ${dates.length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:6px">Days with notes</div><div class="note-dates">${dates.slice(0, 40).map(d => `<button class="btn small ${d === NOTE_DATE ? 'primary' : ''}" data-action="note-go" data-d="${d}">${d}</button>`).join('')}</div></div>` : ''}
  </div>
  <div class="card"><h2>Print & export</h2>
    <div class="row" style="margin-bottom:12px"><span class="small">Notes for <b>${esc(cls.name)}</b> from</span><input type="date" id="pr-from" value="${dates[dates.length - 1] || NOTE_DATE}"><span class="small">to</span><input type="date" id="pr-to" value="${dates[0] || NOTE_DATE}"><button class="btn" data-action="print-range">${IC('ico:print')} Print notes</button></div>
    <div class="row"><span class="small">Sub plan for</span><input type="date" id="sub-date" value="${NOTE_DATE}"><button class="btn primary" data-action="print-sub">${IC('ico:print')} Print sub plan</button>
      <span class="small muted">Includes the bell schedule, every class's agenda, warm-up, notes and roster.</span></div>
    <label class="fld" style="margin-top:12px"><span>Standing info for subs (procedures, helpful students, where things are)</span><textarea rows="4" data-bind="settings.subInfo">${esc(S.settings.subInfo)}</textarea></label>
    <p class="small muted" style="margin-bottom:0">Tip: in the print window, choose “Save as PDF” to share it.</p>
  </div>`;
}
function printHTML(title, html) {
  $('#print-area').innerHTML = `<h1>${esc(title)}</h1>${html}`;
  if (!native('print')) window.print();
}
function noteBlock(cls, k) {
  return `<h2>${esc(cls.name)}${cls.subtitle ? ' · ' + esc(cls.subtitle) : ''} — ${longDate(parseKey(k))}</h2><div class="blk">${esc(cls.notes[k] || '(no notes)')}</div>`;
}
function printSub(k) {
  const d = parseKey(k), periods = periodsFor(d);
  let h = `<div class="meta">${longDate(d)}, ${d.getFullYear()} · ${esc(templateFor(d)?.name || 'No bell schedule')}</div>`;
  if (S.settings.subInfo) h += `<h2>Important info</h2><div class="blk">${esc(S.settings.subInfo)}</div>`;
  const evs = eventsOn(d); if (evs.length) h += `<h2>Today</h2><ul>${evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ' — ' + fmtHM(e.time) : ''}</li>`).join('')}</ul>`;
  h += `<h2>Schedule</h2><ul>${periods.map(p => `<li>${fmtHM(p.start)}–${fmtHM(p.end)}: ${esc(p.cls?.name || '?')}${p.cls?.subtitle ? ' (' + esc(p.cls.subtitle) + ')' : ''}</li>`).join('') || '<li>No classes</li>'}</ul>`;
  for (const p of periods) {
    const c = p.cls; if (!c) continue;
    h += `<h2>${fmtHM(p.start)} · ${esc(c.name)}${c.subtitle ? ' — ' + esc(c.subtitle) : ''}</h2>`;
    if (c.warmup) h += `<div class="blk"><b>Warm-up:</b> ${esc(c.warmup)}</div>`;
    if (c.agenda.length) h += `<div class="blk"><b>Agenda:</b><ol>${c.agenda.map(a => `<li>${esc(a.text)}${a.min ? ` (${a.min} min)` : ''}</li>`).join('')}</ol></div>`;
    h += `<div class="blk"><b>Plan / notes:</b>\n${esc(c.notes[k] || '(none)')}</div>`;
    if (c.roster.length) h += `<div class="blk"><b>Roster (${c.roster.length}):</b> ${c.roster.map(esc).join(', ')}</div>`;
  }
  printHTML('Substitute Plan', h);
}

// ---------- events
function eventsTab() {
  const list = [...S.events].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return `<div class="card"><div class="card-head"><h2>Events & birthdays</h2><span class="grow"></span>
      <button class="btn small" data-action="ev-add" data-kind="birthday">+ Birthday</button><button class="btn small" data-action="ev-add" data-kind="announcement">+ Announcement</button><button class="btn small" data-action="ev-add" data-kind="event">+ Event</button>
      <button class="btn small" data-action="ev-ics">Import calendar (.ics)…</button></div>
    <p class="desc">Today's events show on the Present screen — for all classes, or only the classes you tick under "Show in". Add a time to pop it up full-screen at that moment (birthdays get confetti). Tip: in Google Calendar, use Settings → Import & export → Export to get an .ics file.</p>
    ${list.length ? `<table class="tbl"><tr><th style="width:130px">Type</th><th style="width:150px">Date</th><th>Title / name</th><th style="width:120px">Pop-up time</th><th style="width:80px">Yearly</th><th style="width:170px">Show in</th><th style="width:30px"></th></tr>
    ${list.map(e => { const k = S.events.indexOf(e); return `<tr><td><select data-bind="events.${k}.kind"><option value="birthday" ${e.kind === 'birthday' ? 'selected' : ''}>Birthday</option><option value="announcement" ${e.kind === 'announcement' ? 'selected' : ''}>Announcement</option><option value="event" ${e.kind === 'event' ? 'selected' : ''}>Event</option></select></td>
      <td><input type="date" data-bind="events.${k}.date" value="${e.date || ''}"></td><td><input data-bind="events.${k}.title" value="${esc(e.title)}"></td>
      <td><input type="time" data-bind="events.${k}.time" value="${e.time || ''}"></td><td><input type="checkbox" data-bind="events.${k}.yearly" ${e.yearly ? 'checked' : ''}></td>
      <td><details class="ev-cls"><summary>${esc(evWhere(e))}</summary><label><input type="checkbox" data-ev-all="${e.id}" ${!e.classes?.length ? 'checked' : ''}> All classes</label>
        ${S.classes.map(c => `<label><input type="checkbox" data-ev-cls="${e.id}" data-c="${c.id}" ${e.classes?.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</details></td>
      <td><button class="iconbtn" data-action="ev-del" data-k="${k}">${IC('ico:close')}</button></td></tr>`; }).join('')}</table>` : '<div class="empty">No events yet.</div>'}
    ${S.events.length > 1 ? '<button class="btn small danger" style="margin-top:10px" data-action="ev-clear-past">Remove past one-time events</button>' : ''}
  </div>`;
}
function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT') { if (ev && ev.date && ev.title) out.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(':'); if (i < 0) continue;
      const key = l.slice(0, i).split(';')[0], val = l.slice(i + 1);
      if (key === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ');
      if (key === 'DTSTART') {
        const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/); if (!m) continue;
        if (m[4] && val.endsWith('Z')) { const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])); ev.date = dateKey(d); ev.time = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
        else { ev.date = `${m[1]}-${m[2]}-${m[3]}`; if (m[4]) ev.time = `${m[4]}:${m[5]}`; }
      }
    }
  }
  return out;
}

// ---------- library
function libraryTab() {
  const files = Object.entries(S.files).sort((a, b) => (b[1].added || 0) - (a[1].added || 0));
  const usedBy = id => S.classes.filter(c => c.resources.some(r => r.fileId === id) || c.theme.image === 'file:' + id || c.automations.some(a => a.fileId === id || a.sound === 'file:' + id)).map(c => c.name);
  return `<div class="card"><div class="card-head"><h2>Library</h2><span class="grow"></span><button class="btn small primary" data-action="lib-add">+ Add files…</button></div>
    <p class="desc">Music for transitions, sound effects, PDFs and pictures, stored on this ${DEVICE}. Music files can be used by “Start music” automations and as timer sounds.</p>
    ${files.length ? `<table class="tbl"><tr><th></th><th>Name</th><th>Type</th><th>Size</th><th>Used by</th><th></th></tr>${files.map(([id, f]) => `<tr><td style="width:30px">${f.mime.startsWith('audio/') ? IC('ico:audio') : f.mime === 'application/pdf' ? IC('ico:file') : f.mime.startsWith('image/') ? IC('ico:image') : f.mime.startsWith('video/') ? IC('ico:video') : IC('ico:attach')}</td>
      <td>${esc(f.name)}</td><td class="muted">${esc(f.mime)}</td><td class="muted">${(f.size / 1048576).toFixed(1)} MB</td><td class="muted small">${esc(usedBy(id).join(', ') || '—')}</td>
      <td style="width:110px">${f.mime.startsWith('audio/') ? `<button class="iconbtn" data-action="test-sound" data-s="file:${id}">${IC('ico:play')}</button><button class="iconbtn" data-action="music-stop-ed">${IC('ico:stop')}</button>` : ''}<button class="iconbtn" data-action="lib-del" data-id="${id}">${IC('ico:trash')}</button></td></tr>`).join('')}</table>` : '<div class="empty">Nothing here yet.</div>'}
  </div>`;
}

// ---------- settings
function settingsTab() {
  const sim = S.settings.sim;
  return `${COFFEE_URL ? `<div class="card coffee"><h2>Support Rehearsal</h2><p class="desc">Rehearsal is free. If it saves you time in class, you can buy me a coffee. Thank you!</p>
    <button class="btn coffee-btn" data-action="open-external" data-url="${COFFEE_URL}">${IC('ico:coffee')} Buy me a coffee</button></div>` : ''}
  ${updatesCard()}<div class="card"><h2>Present screen</h2>
    <label class="fld"><span>Before-school welcome message</span><textarea rows="2" data-bind="settings.welcome">${esc(S.settings.welcome)}</textarea></label>
    <label class="fld" style="margin-top:10px"><span>After-school message</span><input data-bind="settings.afterSchool" value="${esc(S.settings.afterSchool)}"></label>
    <div class="row" style="margin-top:12px"><label class="chk"><input type="checkbox" data-bind="settings.use24h" ${S.settings.use24h ? 'checked' : ''}> 24-hour clock</label>
      <label class="chk"><input type="checkbox" data-bind="settings.showSeconds" ${S.settings.showSeconds ? 'checked' : ''}> Show seconds</label>
      <label class="chk">Shrink the toolbar when idle after <input type="number" min="0" style="width:60px" data-type="num" data-bind="settings.hideDockAfter" value="${S.settings.hideDockAfter ?? 3}"> seconds (0 = never)</label></div></div>
  <div class="card"><h2>Test mode</h2><p class="desc">Pretend it's a different time so you can watch your automations run. The Present screen shows a red TEST TIME badge while this is on.</p>
    <div class="row"><label class="chk"><input type="checkbox" data-action-change="sim-on" ${sim.on ? 'checked' : ''}> Pretend the time is</label><input type="time" value="${sim.time}" data-action-change="sim-time">
    <span class="small muted">Tip: set it to a minute before a class starts.</span></div></div>
  ${IS_NATIVE ? `<div class="card"><h2>Google Drive</h2><p class="desc">“Browse Google Drive…” (in a class's Resources) opens Drive in its own window. Sign in there once with your school account, exactly like in Safari. Open a file, then click <b>Use this file</b>.</p>
    <button class="btn" data-action="drive-open">Open Google Drive window</button>
    <p class="small muted">If a Google file shows “You need access” or a sign-in page on the Present screen, use the <b>Drive window</b> button on that tab instead. It always works because it's the same as Drive itself.</p></div>` : ''}
  ${bookmarksCard()}
  <div class="card"><h2>Sight-reading grading</h2><p class="desc">While you grade, the take is kept in memory so you can listen back to it. It's thrown away when you make a new example or grade again.</p>
    ${HAS_SERVER ? `<label class="chk"><input type="checkbox" data-action-change="grlog-toggle" ${S.settings.saveGradeRecordings ? 'checked' : ''}> Also save the last 20 takes on this Mac for troubleshooting the grader</label>
    <p class="small muted">Off unless you turn it on. Turning it off deletes any saved takes.</p>` : ''}</div>
  ${HAS_SERVER ? `<div class="card"><h2>Automatic backups</h2><p class="desc">Each day you use Rehearsal it keeps a dated copy of your classes, tabs, agendas and settings (the newest 30). If something goes missing, restore an earlier day here. Restoring first saves what you have now, so you can always undo it.</p>
    <div class="row"><button class="btn" data-action="backup-now">Back up now</button><span class="grow"></span></div>
    <div id="backup-list" class="backup-list"><div class="small muted">Loading…</div></div></div>` : ''}
  <div class="card"><h2>Sound and playhead sync</h2><p class="desc">Music volume sets how loud sight reading and scores play. If the moving playhead (sight reading, scores) is ahead of or behind the sound on this ${DEVICE}, calibrate it: tap along with 8 clicks and Rehearsal measures the delay. Bluetooth speakers usually need more. Kept separately on each device.</p>
    <div class="row"><span style="width:9em">Playhead delay</span><input type="range" min="-200" max="600" step="10" value="${avDelayMs()}" data-action-input="av-delay" style="flex:1;max-width:320px"><b class="av-val">${avDelayMs()} ms</b><button class="btn" data-action="av-cal">Calibrate…</button></div>
    <div class="row" style="margin-top:8px"><span style="width:9em">Music volume</span><input type="range" min="0.5" max="3" step="0.1" value="${musicVol()}" data-action-input="music-vol" style="flex:1;max-width:320px"><b>${Math.round(musicVol() * 100)}%</b><button class="btn" data-action="vol-test">Test</button></div></div>
  <div class="card"><h2>Backup</h2><p class="desc">Your classes and settings are saved on this ${DEVICE} automatically. Export a backup file to move them to another Mac or iPad (Import backup there). Library files (music, PDFs, pictures) aren't in the backup file, so add them again on the other device.</p>
    <div class="row"><button class="btn" data-action="export">Export backup…</button><button class="btn" data-action="import">Import backup…</button><span class="grow"></span><button class="btn danger" data-action="reset">Start over with the template</button></div></div>`;
}
// your Buy Me a Coffee page (shown in Settings when set)
const COFFEE_URL = 'https://buymeacoffee.com/loganshippee';

// ---------- updates (the Mac app checks GitHub; see native/updater.swift)
let UPD = { state: 'idle' }, WEB_VERSION = '';
fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => { if (v) { WEB_VERSION = v.version; settleUpdate(); refreshUpdateUI(); noteUpdated(); document.querySelectorAll('.brand .ver').forEach(el => { el.textContent = WEB_VERSION; }); } }).catch(() => { });
// After an update (Mac restart, or the iPad loading a new release), say so once.
function noteUpdated() {
  let last = null; try { last = localStorage.getItem('rehearsal-version'); localStorage.setItem('rehearsal-version', WEB_VERSION); } catch { return; }
  if (!last || last === WEB_VERSION) return;
  const b = document.createElement('div'); b.className = 'upd-banner upd-done';
  b.innerHTML = `<span>${IC('ico:good')} Updated to Rehearsal <b>${esc(WEB_VERSION)}</b>.</span><button class="btn small" data-action="upd-done-close">OK</button>`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 12000);
}
function updateStatusText() {
  const u = UPD, v = u.version ? ` ${esc(u.version)}` : '';
  return {
    off: 'Automatic updates are not set up in this copy.',
    idle: IS_NATIVE ? 'Rehearsal checks for updates when it opens and every few hours.' : 'Rehearsal checks for updates when it opens and every few hours. Press Check for updates to look now.',
    checking: 'Checking for updates…',
    none: 'You have the newest version.',
    downloading: `Downloading version${v}…`,
    'web-ready': IS_NATIVE ? `Version${v} is ready. It's used the next time Rehearsal opens, or restart it now.` : `Version${v} is ready. Reload to start using it.`,
    app: u.manual ? `Version${v} is available. Rehearsal can't replace itself where it is, so the download page was opened: drag the new Rehearsal into Applications.` : `Version${v} is available. Installing it reopens Rehearsal.`,
    installing: `Installing version${v}… Rehearsal will reopen.`,
    error: esc(u.message || 'Something went wrong.'),
  }[u.state] || '';
}
// the status as a coloured badge: busy (spinner), up to date (green), restart / install needed (amber), problem (red)
function updateBadge() {
  const st = UPD.state, txt = updateStatusText(); if (!txt) return '';
  const kind = { checking: 'busy', downloading: 'busy', installing: 'busy', none: 'ok', 'web-ready': 'todo', app: 'todo', error: 'bad' }[st] || 'info';
  const icon = { busy: '<span class="upd-spin"></span>', ok: IC('ico:good'), todo: IC('ico:warn'), bad: IC('ico:warn'), info: '' }[kind];
  const head = { none: 'Up to date. ', 'web-ready': IS_NATIVE ? 'Restart needed. ' : 'Reload needed. ', app: 'Install needed. ' }[st] || '';
  return `<div class="upd-status upd-${kind}" id="upd-status">${icon}<span><b>${head}</b>${txt}</span></div>`;
}
function updatesCard() {
  const u = UPD;
  if (!IS_NATIVE) return `<div class="card" id="upd-card"><h2>Updates</h2>
    <p class="desc">Version <b>${esc(WEB_VERSION || '?')}</b>. The newest version loads whenever Rehearsal is opened with an internet connection. Your classes and files are never touched.</p>
    <div class="row"><button class="btn" data-action="upd-check" ${u.state === 'checking' ? 'disabled' : ''}>${u.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>
      ${u.state === 'web-ready' ? '<button class="btn primary" data-action="upd-apply">Reload now</button>' : ''}</div>
    ${updateBadge()}</div>`;
  return `<div class="card" id="upd-card"><h2>Updates</h2>
    <p class="desc">Version <b>${esc(WEB_VERSION || u.current || '?')}</b>. Updates are downloaded from GitHub and checked against Rehearsal's signature before they're used. Your classes and files are never touched.</p>
    <div class="row"><button class="btn" data-action="upd-check" ${['off', 'checking', 'downloading', 'installing'].includes(u.state) ? 'disabled' : ''}>${u.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>
      ${u.state === 'web-ready' ? '<button class="btn primary" data-action="upd-apply">Restart now</button>' : ''}
      ${u.state === 'app' && !u.manual ? '<button class="btn primary" data-action="upd-install">Install and reopen</button>' : ''}</div>
    ${updateBadge()}
    ${u.notes && (u.state === 'web-ready' || u.state === 'app') ? `<div class="small muted" style="margin-top:8px;white-space:pre-wrap">${esc(u.notes)}</div>` : ''}</div>`;
}
function refreshUpdateUI() {
  const card = document.getElementById('upd-card');
  if (card) card.outerHTML = updatesCard();
  // a small banner when an update is ready (once per version)
  document.querySelector('.upd-banner:not(.upd-done)')?.remove();
  if ((UPD.state === 'web-ready' || UPD.state === 'app') && UPD.version && UPD.dismissed !== UPD.version) {
    const b = document.createElement('div'); b.className = 'upd-banner';
    b.innerHTML = UPD.state === 'web-ready'
      ? `<span>Rehearsal <b>${esc(UPD.version)}</b> is ready.</span><button class="btn small primary" data-action="upd-apply">${IS_NATIVE ? 'Restart now' : 'Reload now'}</button><button class="btn small" data-action="upd-later">Later</button>`
      : `<span>Rehearsal <b>${esc(UPD.version)}</b> is available.</span><button class="btn small primary" data-action="upd-install">Install and reopen</button><button class="btn small" data-action="upd-later">Later</button>`;
    document.body.appendChild(b);
  }
}
// iPad / browser: compare the version online with the one running; the service worker fetches new files on reload
const verNewer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function webUpdateCheck(manual) {
  if (IS_NATIVE) return;
  if (!WEB_VERSION) { if (manual) { UPD = { ...UPD, state: 'error', message: "This copy has no version number (it wasn't built by release.sh)." }; refreshUpdateUI(); } return; }
  if (manual) { UPD = { ...UPD, state: 'checking' }; refreshUpdateUI(); }
  WEB_CHECKED = Date.now();
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0;
    const v = await r.json();
    if (verNewer(v.version, WEB_VERSION)) UPD = { ...UPD, state: 'web-ready', version: v.version };
    else if (manual) UPD = { ...UPD, state: 'none' };
  } catch { if (manual) UPD = { ...UPD, state: 'error', message: "Couldn't check for updates. Check the internet connection and try again." }; }
  refreshUpdateUI();
}
// A Home Screen app left open isn't reloaded when you switch back to it, so check when it comes back on screen
// (at most every 10 minutes) and every 4 hours while it stays open.
let WEB_CHECKED = Date.now();
if (!IS_NATIVE) {
  setInterval(() => webUpdateCheck(false), 4 * 3600 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - WEB_CHECKED > 10 * 60 * 1000) webUpdateCheck(false);
  });
}
window.__updateState = st => { const dismissed = UPD.dismissed; UPD = { ...st, dismissed }; settleUpdate(); refreshUpdateUI(); };
// The Mac app can still remember "ready, restart" after the page has already switched to that version: once the
// version running is the one that was waiting, it's done.
function settleUpdate() {
  if (UPD.state === 'web-ready' && UPD.version && WEB_VERSION && !verNewer(UPD.version, WEB_VERSION)) UPD = { ...UPD, state: 'none', version: '' };
}

function backupLabel(n) {
  const m = n.match(/data-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?(-manual)?/); if (!m) return n;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (m[4] ? ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '') + (m[7] ? ' (made by you / before a restore)' : ' (start of the day)');
}
async function loadBackups() {
  const box = $('#backup-list'); if (!box || !HAS_SERVER) return;
  try {
    const list = await (await fetch('/api/backups', { headers: { 'X-Token': TOKEN } })).json();
    box.innerHTML = list.length ? list.map(b => `<div class="backup-row"><span>${esc(backupLabel(b.name))}</span><span class="small muted">${Math.max(1, Math.round(b.size / 1024))} KB</span><button class="btn small" data-action="backup-restore" data-name="${esc(b.name)}">Restore</button></div>`).join('')
      : '<div class="small muted">No backups yet — the first one is made the next time you change something (or press Back up now).</div>';
  } catch { box.innerHTML = '<div class="small muted">Backups are only available in the Mac app.</div>'; }
}

// ============================================================ actions
const A = {
  tab: el => { TAB = el.dataset.tab; renderEditor(); },
  present: () => go('present'),
  edit: () => { exitFullscreen(); go('edit'); },
  fullscreen: () => { if (!native('fullscreen')) { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); } },
  // dock / tools
  tool: el => {
    const n = el.dataset.tool;
    if (P.tools[n]) { delete P.tools[n]; renderTools(); renderDock(); return; }
    const saved = S.settings.toolPos?.[n];
    P.tools[n] = saved ? { x: saved.x * innerWidth, y: saved.y * innerHeight } : { x: 40, y: 110 };
    renderTools(); placeTool(n, !saved); renderDock();
  },
  'tool-close': el => { const n = el.dataset.tool; delete P.tools[n]; if (n === 'noise') noiseStop(); renderTools(); renderDock(); },
  'quick-timer': el => { const m = Number(el.dataset.m); startTimer({ label: m < 1 ? '30 seconds' : `${m} minute${m > 1 ? 's' : ''}`, minutes: m, sound: 'bell' }); },
  'custom-timer': () => startTimer({ label: $('#tt-label').value || 'Timer', minutes: Number($('#tt-min').value) || 1, sound: $('#tt-sound').value }),
  'timer-pause': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm || tm.doneAt) return; if (tm.pausedLeft != null) { tm.endAt = onClockSecond(Date.now() + tm.pausedLeft); tm.pausedLeft = null; } else tm.pausedLeft = tm.endAt - Date.now(); },
  'timer-add': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm) return; tm.doneAt = 0; if (tm.pausedLeft != null) tm.pausedLeft += 60000; else tm.endAt = Math.max(tm.endAt, Date.now()) + 60000; tm.total = Math.max(tm.total, timerLeft(tm)); },
  'timer-x': el => { P.timers = P.timers.filter(t => t.id !== el.dataset.id); renderTimers(); },
  'overlay-dismiss': () => { if (P.overlay) P.overlay.until = 0; },
  'music-stop': () => { stopMusic(); renderDock(); },
  'music-stop-ed': () => stopMusic(true),
  pt: el => { const c = currentClass(); if (!c) return; c.points[el.dataset.i].score += Number(el.dataset.d); save(); rerenderTool('points'); },
  'pt-add': () => { const c = currentClass(); if (!c) return; c.points.push({ name: `Team ${c.points.length + 1}`, score: 0 }); save(); rerenderTool('points'); },
  'pt-del': () => { const c = currentClass(); if (!c) return; c.points.pop(); save(); rerenderTool('points'); },
  'pt-reset': () => { const c = currentClass(); if (!c) return; c.points.forEach(p => p.score = 0); save(); rerenderTool('points'); },
  'noise-start': () => noiseStart(),
  'noise-stop': () => noiseStop(),
  'rand-pick': () => {
    const c = currentClass(); if (!c?.roster.length) return;
    let pool = c.roster; if (R.noRepeat) { pool = c.roster.filter(n => !R.used.has(n)); if (!pool.length) { R.used.clear(); pool = c.roster; } }
    const out = $('#rand-out'); let n = 0;
    const iv = setInterval(() => { out.textContent = c.roster[Math.floor(Math.random() * c.roster.length)]; if (++n > 14) { clearInterval(iv); R.last = pool[Math.floor(Math.random() * pool.length)]; R.used.add(R.last); out.textContent = R.last; playSound('ding'); } }, 70);
  },
  'rand-groups': () => {
    const c = currentClass(); if (!c?.roster.length) return;
    const names = [...c.roster].sort(() => Math.random() - 0.5); const n = Math.max(1, Math.ceil(names.length / R.groupN));
    R.groups = [...Array(n)].map(() => []); names.forEach((x, i) => R.groups[i % n].push(x)); rerenderTool('random');
  },
  signal: el => { P.signal = { ...SIGNALS[el.dataset.i] }; },
  'signal-custom': () => { const v = $('#sig-custom').value.trim(); if (v) P.signal = { text: v, color: '#3b6cf6' }; },
  'signal-clear': () => { P.signal = null; },
  'agenda-prev': () => { const t = now(), c = context(t); if (c.cls) P.agendaOverride[c.key] = Math.max(0, agendaStep(c, t) - 1); },
  'agenda-next': () => { const t = now(), c = context(t); if (c.cls) P.agendaOverride[c.key] = Math.min(c.cls.agenda.length - 1, agendaStep(c, t) + 1); },
  stage: el => { const c = context(now()); if (c.cls) { P.stageSel[c.key] = el.dataset.id; } P.stageKey = ''; if (P.groupMenu) { P.groupMenu = null; renderGroupMenu(); } },
  'stage-reload': () => { const r = stageNativeRes(); if (r) native('webCmd', { id: 'stage-' + r.id, action: 'reload' }); P.stageKey = ''; },
  'stage-native': () => { const r = stageNativeRes(true); if (!r) return; r.native = !r.native; save(); P.stageKey = ''; WIN.lastSync = ''; },
  'open-external': el => { const u = el.dataset.url; if (!native('openExternal', { url: u })) window.open(u, '_blank'); },
  'open-drive': el => native('openDrive', { url: el.dataset.url }),
  // free windows
  'win-menu': () => { P.winMenu = !P.winMenu; renderWinMenu(); renderDock(); },
  'win-tile': () => { P.winMenu = false; renderWinMenu(); renderDock(); tileWindows(); },
  'wm-web': () => { const w = addWindow({ kind: 'web', url: '', native: false }); setTimeout(() => $(`[data-wurl="${w.id}"]`)?.focus(), 30); },
  'wm-file': async () => { P.winMenu = false; renderWinMenu(); renderDock(); const fs = await pickFile('application/pdf,image/*,video/*,.mxl,.musicxml,.mscz,.mscx', true); for (const f of fs) { const id = await storeFile(f); addWindow(spIsScoreName(f.name) ? { kind: 'score', score: { fileId: id, name: f.name } } : { kind: 'file', fileId: id }); } },
  'wm-score': async () => {
    P.winMenu = false; renderWinMenu(); renderDock();
    // reopen the score you used last (switch scores from the list inside the widget)
    const lib = typeof spLibrary === 'function' ? spLibrary() : [];
    const pick = lib.find(x => x.id === S.settings.lastScore) || lib[0];
    if (pick) { const saved = S.scoreSettings?.[pick.id]; addWindow({ kind: 'score', score: saved ? JSON.parse(JSON.stringify(saved)) : { fileId: pick.id, name: S.files[pick.id]?.name } }); return; }
    const fs = await pickFile('.mxl,.musicxml,.xml,.mscz,.mscx', true); for (const f of fs) { const id = await storeFile(f); addWindow({ kind: 'score', score: { fileId: id, name: f.name } }); } },
  'wm-apps': () => { P.appPick = 'loading'; renderWinMenu(); native('listAppWindows'); },
  'wm-app': el => { const a = P.appPick.windows[+el.dataset.i]; P.appPick = null; const w = addWindow({ kind: 'app', native: true, windowID: a.windowID, bundleId: a.bundleId, appName: a.app, title: a.title }); },
  perm: el => native('requestPermission', { which: el.dataset.which }),
  'app-done': () => { /* clicking Rehearsal already ended editing; this just re-renders */ WIN.sig = ''; },
  'app-front': el => { const w = findWin(el.dataset.id); if (!w) return; if (w.status === 'not-running') native('launchApp', { bundleId: w.bundleId }); else native('webCmd', { id: w.id, action: 'front' }); },
  'wm-cal': () => { const w = addWindow({ kind: 'cal' }); w.w = 0.62; w.h = 0.8; save(); applyWinGeom(); },
  'av-cal': () => calibrateSync(),
  'vol-test': () => { const c = ac(); c.resume?.(); [60, 64, 67, 72].forEach((m, i) => { const t = c.currentTime + 0.05 + i * 0.25, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); o.connect(g).connect(musicOut()); o.start(t); o.stop(t + 0.55); }); },
  'wm-yt': () => { const w = addWindow({ kind: 'yt' }); w.w = 0.6; w.h = 0.7; save(); applyWinGeom(); },
  'wm-rec': () => { const ex = winList().find(w => w.kind === 'rec'); if (ex) return bringToFront(ex); const w = addWindow({ kind: 'rec' }); w.w = 0.42; w.h = 0.7; save(); applyWinGeom(); },
  'wm-prog': () => { const ex = winList().find(w => w.kind === 'prog'); if (ex) return bringToFront(ex); const w = addWindow({ kind: 'prog' }); w.w = 0.5; w.h = 0.8; save(); applyWinGeom(); },
  'wm-sight': () => { const w = addWindow({ kind: 'sight', sr: srDefaults() }); w.w = 0.7; w.h = 0.85; save(); applyWinGeom(); },
  'wm-warmup': () => addWindow({ kind: 'warmup' }),
  'wm-res': el => addWindow({ kind: 'res', resId: el.dataset.id, native: false }),
  'wm-lib': el => { const id = el.dataset.id, n = S.files[id]?.name; addWindow(spIsScoreName(n) ? { kind: 'score', score: { fileId: id, name: n } } : { kind: 'file', fileId: id }); },
  'wm-closeall': () => { const k = curWinKey(); S.windows[k] = []; P.winMenu = false; save(); renderWinMenu(); renderDock(); renderWins(context(now()), true); },
  'win-close': el => {
    if (winList().find(w => w.id === el.dataset.id)?.kind === 'rec' && REC.state !== 'idle') {
      if (REC.state === 'rec' || REC.state === 'countin') { recStop(); return toast('Recording stopped. Save or delete it, then close the window.'); }
      if (REC.state === 'review') return toast('Save or delete the recording first.');
    }
    if (winList().find(w => w.id === el.dataset.id)?.kind === 'rec') { closePlayer(); if (REC.meter) recMeter(false); }
    const k = curWinKey(); S.windows[k] = winList(k).filter(w => w.id !== el.dataset.id); save(); renderWins(context(now()), true); },
  'win-zoom-reset': el => { const w = findWin(el.dataset.id); if (w) { w.zoom = 1; applyZoom(w); save(); } },
  'bm-open': el => {
    const b = bmFind(el.dataset.id), w = findWin(el.dataset.win); BM.open = null; renderBmMenu();
    if (b?.url && w) openWebAddress(w, b.url);
  },
  'bm-folder': el => { const o = BM.open; BM.open = o && o.folderId === el.dataset.id && o.winId === el.dataset.win ? null : { winId: el.dataset.win, folderId: el.dataset.id }; renderBmMenu(); },
  'bm-star': el => {
    const w = findWin(el.dataset.id); if (!w?.url) return;
    S.bookmarks ||= [];
    if (S.bookmarks.some(b => b.url === w.url)) return toast('Already bookmarked.');
    S.bookmarks.push({ id: uid(), title: (w.title || winTitle(w)).slice(0, 60), url: w.url }); save(); WIN.sig = ''; toast('Bookmarked.');
  },
  'bm-chrome': () => native('chromeBookmarks'),
  'bm-cancel': () => { BM.profiles = null; renderEditor(); },
  'bm-import': el => {
    const p = BM.profiles[+el.dataset.i]; if (!p) return;
    if ((S.bookmarks || []).length && !confirm(`Replace your ${bmCount()} Rehearsal bookmarks with ${p.count} from “${p.name}”?`)) return;
    S.bookmarks = [...p.bar, ...(p.other.length ? [{ id: uid(), title: 'Other bookmarks', children: p.other }] : [])];
    BM.profiles = null; save(); renderEditor(); toast(`Imported ${bmCount()} bookmarks.`);
  },
  'bm-add': () => { const u = prompt('Web address to bookmark:'); if (!u) return; const url = /^https?:\/\//.test(u.trim()) ? u.trim() : 'https://' + u.trim(); const t = prompt('Name:', guessTitle(url)) || url; (S.bookmarks ||= []).push({ id: uid(), title: t, url }); save(); renderEditor(); },
  'bm-del': el => { const strip = list => list.filter(b => b.id !== el.dataset.id).map(b => b.children ? { ...b, children: strip(b.children) } : b); S.bookmarks = strip(S.bookmarks || []); save(); renderEditor(); },
  'bm-clear': () => { if (!confirm('Remove all bookmarks from Rehearsal? (Chrome is not affected.)')) return; S.bookmarks = []; save(); renderEditor(); },
  'side-toggle': () => { const cls = context(now()).cls; if (!cls) return; cls.layout = { ...(cls.layout || {}), collapsed: !cls.layout?.collapsed }; applySide(cls); save(); },
  'open-music': el => {
    const kind = el.dataset.kind, ex = winList().find(w => w.kind === kind);
    if (ex) { bringToFront(ex); return; }
    const w = addWindow({ kind, mu: muDefaults(kind) });
    Object.assign(w, kind === 'tuner' ? { w: 0.58, h: 0.72 } : { w: 0.46, h: 0.66 }); save(); applyWinGeom(); renderDock();
  },
  'dock-custom': () => { P.dockCustom = !P.dockCustom; P.dockMore = false; renderDockCustom(); renderDock(); },
  'dock-more': () => { if (P.dockCustom) { P.dockCustom = false; renderDockCustom(); } else P.dockMore = !P.dockMore; renderDock(); renderDockMore(); },
  'dock-spot': el => {
    const cfg = dockCfg(), k = el.dataset.spot;
    cfg.pos = k === 'top' ? { mode: 'header' } : k === 'bottom' ? { mode: 'float', x: 0.5, y: 0.955 } : { mode: 'float', x: k === 'left' ? 0.03 : 0.97, y: 0.5, vertical: true };
    save(); renderDock(); renderDockCustom();
  },
  'dock-home': () => { dockCfg().pos = { mode: 'header' }; save(); renderDock(); renderDockCustom(); },
  'dock-reset': () => { S.settings.dock = {}; save(); renderDock(); renderDockCustom(); },
  'tab-group': el => { P.groupMenu = P.groupMenu === el.dataset.id ? null : el.dataset.id; renderGroupMenu(); },
  'group-out': el => {
    const c = ieClass(); if (!c) return; const r = c.cls.resources.find(x => x.id === el.dataset.id); if (!r) return;
    const members = c.cls.resources.filter(x => x.group === r.group); delete r.group;
    const list = c.cls.resources, last = members.filter(x => x !== r).pop();
    if (last) { list.splice(list.indexOf(r), 1); list.splice(list.indexOf(last) + 1, 0, r); }
    tidyGroups(c.cls); save(); P.stageKey = ''; renderGroupMenu();
  },
  'group-rename': el => {
    const c = ieClass(); if (!c) return; const g = (c.cls.groups || []).find(x => x.id === el.dataset.id); if (!g) return;
    const btn = $(`.stage-tabs [data-action="tab-group"][data-id="${g.id}"]`); P.groupMenu = null; renderGroupMenu();
    if (btn) renameInline(btn, g.name, v => { g.name = v; save(); P.stageKey = ''; });
  },
  'group-dissolve': el => {
    const c = ieClass(); if (!c) return;
    for (const r of c.cls.resources) if (r.group === el.dataset.id) delete r.group;
    tidyGroups(c.cls); P.groupMenu = null; renderGroupMenu(); save(); P.stageKey = '';
  },
  'backup-now': async () => { const r = await fetch('/api/backup-now', { method: 'POST', headers: { 'X-Token': TOKEN } }); toast(r.ok ? 'Backup saved.' : 'Could not make a backup.'); loadBackups(); },
  'backup-restore': async el => {
    const n = el.dataset.name; if (!confirm(`Restore the backup from ${backupLabel(n)}? What you have now is saved as a backup first.`)) return;
    clearTimeout(saveTimer); window.__noSave = true;
    const r = await fetch('/api/restore?name=' + encodeURIComponent(n), { method: 'POST', headers: { 'X-Token': TOKEN } });
    if (!r.ok) { window.__noSave = false; return toast('Could not restore that backup.'); }
    try { localStorage.removeItem('classpilot'); } catch { }
    location.reload();
  },
  'warmup-hide': () => {
    const c = context(now()), cls = c.cls; if (!cls) return;
    if (!confirm(`Remove the warm-up tab from ${cls.name}? (Bring it back in Setup → Classes or Quick edit.)`)) return;
    cls.hideWarmup = true; if (P.stageSel[c.key] === 'warmup') delete P.stageSel[c.key]; save(); P.stageKey = '';
  },
  'warmup-show': () => { const c = ieClass() || null, cls = c?.cls || selClass(); if (!cls) return; cls.hideWarmup = false; save(); P.stageKey = ''; if (VIEW !== 'present') renderEditor(); },
  'res-remove': el => {
    const c = context(now()), cls = c.cls; if (!cls) return;
    const r = cls.resources.find(x => x.id === el.dataset.id); if (!r) return;
    if (!confirm(`Remove “${r.title || 'this tab'}” from ${cls.name}?`)) return;
    cls.resources = cls.resources.filter(x => x !== r);
    for (const list of Object.values(S.windows || {})) for (let i = list.length - 1; i >= 0; i--) if (list[i].resId === r.id) list.splice(i, 1);
    if (P.stageSel[c.key] === r.id) P.stageSel[c.key] = 'warmup';
    P.stageKey = ''; WIN.sig = ''; save();
  },
  'edit-mode': () => {
    document.activeElement?.blur?.();
    P.editMode = !P.editMode; if (!P.editMode) { P.lookOpen = P.autoDrawer = false; renderLook(); renderAutoDrawer(); }
    P.sideKey = P.stageKey = ''; if ($('#p-title')) $('#p-title')._h = ''; renderDock();
    if (P.editMode && !ieClass()) toast('Show a class (Class picker) to edit its agenda, warm-up and look.');
  },
  'ag-add': () => { const c = ieClass(); if (!c) return; document.activeElement?.blur?.(); c.cls.agenda.push({ text: 'New step', min: 0 }); save(); P.sideKey = '';
    setTimeout(() => { const t = $$('[data-ie="agenda"]').pop(); if (t) { t.focus(); document.getSelection().selectAllChildren(t); } }, 300); },
  'ag-del': el => { const c = ieClass(); if (!c) return; document.activeElement?.blur?.(); c.cls.agenda.splice(+el.dataset.i, 1); save(); P.sideKey = ''; },
  'ag-cur': el => { const c = ieClass(); if (!c) return; document.activeElement?.blur?.(); P.agendaOverride[c.key] = +el.dataset.i; P.sideKey = ''; },
  'ie-ev-add': () => {
    const kind = $('[data-ie-evkind]').value, title = $('[data-ie-evtext]').value.trim(), time = $('[data-ie-evtime]').value;
    if (!title) return toast('Type the announcement or name first.');
    const who = $('[data-ie-evwho]')?.value, c = ieClass();
    S.events.push({ id: uid(), kind, date: dateKey(now()), title, time, yearly: kind === 'birthday', classes: who === 'this' && c ? [c.cls.id] : [] }); save(); P.sideKey = '';
  },
  'ie-ev-del': el => { document.activeElement?.blur?.(); S.events = S.events.filter(e => e.id !== el.dataset.id); save(); P.sideKey = ''; },
  'clip-open': () => { P.clipOpen = !P.clipOpen; P.clipSel = null; renderClip(); if (VIEW === 'present') renderDock(); },
  'clip-copy': () => clipCopy(),
  'clip-paste': el => clipPaste(el.dataset.ag),
  'clip-all': () => { const c = clipClass(); if (!c) return; P.clipSel = { cls: c.id, tabs: new Set(c.resources.map(r => r.id)), agenda: c.agenda.length > 0, warmup: !!c.warmup, look: true }; renderClip(); },
  'clip-none': () => { const c = clipClass(); if (!c) return; P.clipSel = { cls: c.id, tabs: new Set(), agenda: false, warmup: false, look: false }; renderClip(); },
  'icons-open': () => { P.iconsOpen = !P.iconsOpen; P.dockCustom = false; if (typeof renderDockCustom === 'function') renderDockCustom(); renderIcons(); },
  'icons-reset': () => { if (!confirm('Put every icon back to the default?')) return; S.settings.icons = {}; for (const c of S.classes) for (const r of c.resources) delete r.icon; save(); P.stageKey = ''; P.sideKey = ''; WIN.sig = ''; renderDock(); renderIcons(); },
  'look-open': () => { P.lookOpen = !P.lookOpen; P.autoDrawer = false; renderAutoDrawer(); renderLook(); },
  'look-theme': el => { const c = ieClass(); if (!c) return; const th = c.cls.theme; Object.assign(th, { ...THEMES[el.dataset.k], image: th.image || '', dim: th.dim }); save(); renderLook(); },
  'look-pic': async () => { const c = ieClass(); if (!c) return; const [f] = await pickFile('image/*'); if (!f) return; const id = await storeFile(f); c.cls.theme.image = 'file:' + id; save(); renderLook(); },
  'look-pic-clear': () => { const c = ieClass(); if (!c) return; c.cls.theme.image = ''; save(); renderLook(); },
  'auto-open': () => { P.autoDrawer = !P.autoDrawer; P.lookOpen = false; renderLook(); renderAutoDrawer(); },
  'stage-zoom-reset': () => { Object.assign(stageZoomState(), { zoom: 1, zx: 0, zy: 0 }); applyStageZoom(); },
  'stage-max': () => { P.stageMax = !P.stageMax; P.stageKey = ''; WIN.lastSync = ''; },
  'win-snap': el => { P.snapFor = P.snapFor === el.dataset.id ? null : el.dataset.id; renderSnapMenu(); },
  'win-snap-to': el => { const w = findWin(P.snapFor); P.snapFor = null; renderSnapMenu(); if (w) snapWindow(w, +el.dataset.i); },
  'win-max': el => { const w = findWin(el.dataset.id); if (!w) return; w.max = !w.max; bringToFront(w); save(); applyWinGeom(); },
  'win-reload': el => { const w = findWin(el.dataset.id); if (!w) return; if (w.native) native('webCmd', { id: w.id, action: 'reload' }); else renderWins(context(now()), true); },
  'win-back': el => native('webCmd', { id: el.dataset.id, action: 'back' }),
  'win-fwd': el => native('webCmd', { id: el.dataset.id, action: 'forward' }),
  'win-native': el => { const w = findWin(el.dataset.id); if (!w) return; w.native = !w.native; save(); renderWins(context(now()), true); },
  'win-pin': el => {
    const w = findWin(el.dataset.id), cls = currentClass(); if (!w) return;
    if (!cls) return toast('Show a class first (Class picker in the toolbar) to save this to it.');
    const r = w.kind === 'file' ? { id: uid(), title: winTitle(w).replace(/\.[^.]+$/, ''), fileId: w.fileId }
      : w.kind === 'sight' ? { id: uid(), title: (w.sr?.mode === 'solfege' ? 'Solfege' : 'Rhythm') + ' reading', sight: JSON.parse(JSON.stringify({ ...w.sr, settingsOpen: false })) }
      : w.kind === 'score' ? { id: uid(), title: winTitle(w), score: JSON.parse(JSON.stringify(w.score)) }
      : WIDGETS[w.kind] ? { id: uid(), title: WIDGETS[w.kind].title, widget: { kind: w.kind } }
      : w.kind === 'tuner' || w.kind === 'metro' ? { id: uid(), title: w.kind === 'tuner' ? 'Tuner' : 'Metronome', music: { kind: w.kind, mu: JSON.parse(JSON.stringify(w.mu || muDefaults(w.kind))) } }
      : { id: uid(), title: winTitle(w), url: w.url, mode: 'embed', native: !!(IS_NATIVE && w.native) };
    if (w.kind === 'web' && !w.url) return toast('Open a page first.');
    cls.resources.push(r); Object.assign(w, { kind: 'res', resId: r.id }); delete w.fileId; delete w.sr; delete w.score; delete w.mu;
    save(); P.stageKey = ''; renderWins(context(now()), true); toast(`Saved “${r.title}” to ${cls.name}`);
  },
  // ink
  'ink-toggle': () => { if (P.ink.on && !P.ink.blank) P.ink.on = false; else { P.ink.on = true; P.ink.blank = false; P.ink.interact = false; } updateInkUI(); renderDock(); },
  'board-toggle': () => { if (P.ink.on && P.ink.blank) P.ink.on = false; else { P.ink.on = true; P.ink.blank = true; P.ink.interact = false; if (P.ink.color === '#ffffff') P.ink.color = '#111111'; } updateInkUI(); renderDock(); },
  'ink-tool': el => { P.ink.tool = el.dataset.t; P.ink.interact = false; updateInkUI(); },
  'ink-color': el => { P.ink.color = el.dataset.c; if (P.ink.tool === 'erase') P.ink.tool = 'pen'; updateInkUI(); },
  'ink-interact': () => { P.ink.interact = !P.ink.interact; updateInkUI(); },
  'ink-clear': () => { inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0); inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height); inkCtx.restore(); saveInk(); },
  'ink-close': () => { P.ink.on = false; updateInkUI(); renderDock(); },
  // classes
  'class-sel': el => { SEL_CLASS = el.dataset.id; renderEditor(); renderClip(); $('#e-main').scrollTop = 0; },
  'class-add': () => { const c = newClass('New class', S.classes.length); S.classes.push(c); SEL_CLASS = c.id; save(); renderEditor(); },
  'class-dup': () => { const c = S.classes.find(x => x.id === SEL_CLASS); const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.name += ' (copy)'; d.notes = {}; d.automations.forEach(a => a.id = uid()); S.classes.push(d); SEL_CLASS = d.id; save(); renderEditor(); },
  'class-del': () => {
    const c = S.classes.find(x => x.id === SEL_CLASS);
    if (!confirm(`Delete “${c.name}” and its notes? It will also be removed from bell schedules.`)) return;
    S.classes = S.classes.filter(x => x !== c); S.templates.forEach(t => t.periods = t.periods.filter(p => p.classId !== c.id)); save(); renderEditor();
  },
  'class-preview': () => { P.pinned = SEL_CLASS; go('present'); },
  theme: el => { const c = selClass(); c.theme = { ...THEMES[el.dataset.k], image: c.theme.image || '' }; save(); renderEditor(); },
  'theme-image': async () => { const [f] = await pickFile('image/*'); if (!f) return; const id = await storeFile(f); selClass().theme.image = 'file:' + id; save(); renderEditor(); },
  'theme-image-clear': () => { selClass().theme.image = ''; save(); renderEditor(); },
  'agenda-add': () => { selClass().agenda.push({ text: '', min: 0 }); save(); renderEditor(); $$('.agenda-row input')[$$('.agenda-row').length * 2 - 2]?.focus(); },
  'agenda-del': el => { const c = VIEW === 'edit' ? selClass() : ieClass()?.cls; if (!c) return; c.agenda.splice(el.dataset.k, 1); TL_SEL = null; save(); tlRerender(); },
  'res-add-url': () => { const u = prompt('Paste a link (Google Slides/Docs/Drive, YouTube, Canva, any web page):'); if (!u) return; const url = /^https?:\/\//.test(u.trim()) ? u.trim() : 'https://' + u.trim(); selClass().resources.push({ id: uid(), title: guessTitle(url), url, mode: 'embed' }); save(); renderEditor(); },
  'res-add-file': async () => { const fs = await pickFile('application/pdf,image/*,video/*', true); for (const f of fs) { const id = await storeFile(f); selClass().resources.push({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), fileId: id }); } save(); renderEditor(); },
  'res-del': el => { selClass().resources.splice(el.dataset.k, 1); save(); renderEditor(); },
  'res-move': el => { const a = selClass().resources, k = +el.dataset.k, j = k + Number(el.dataset.d); if (j < 0 || j >= a.length) return; [a[k], a[j]] = [a[j], a[k]]; save(); renderEditor(); },
  'drive-browse': () => { DRIVE_TARGET = SEL_CLASS; native('openDrive', {}); },
  'drive-open': () => native('openDrive', {}),
  'tl-del': () => { const c = selClass(); if (!c) return; c.automations = c.automations.filter(a => a.id !== TL_SEL); TL_SEL = null; save(); tlRerender(); },
  'tl-dup': () => { const c = selClass(); const a = c?.automations.find(x => x.id === TL_SEL); if (!a) return; const b = { ...JSON.parse(JSON.stringify(a)), id: uid() }; b.offset = +((Number(a.offset) || 0) + 1).toFixed(2); c.automations.push(b); TL_SEL = b.id; save(); tlRerender(); },
  'auto-add': () => { selClass().automations.push({ id: uid(), enabled: true, anchor: 'start', offset: 0, action: 'message', text: '', seconds: 8 }); save(); renderEditor(); },
  'auto-del': el => { selClass().automations.splice(el.dataset.k, 1); save(); renderEditor(); },
  'test-sound': el => playSound(el.closest('.auto-row')?.querySelector('select[data-bind$=".sound"]')?.value || el.dataset.s),
  // schedule
  'tpl-add': () => { S.templates.push({ id: uid(), name: 'New schedule', periods: [] }); save(); renderEditor(); },
  'tpl-dup': el => { const t = JSON.parse(JSON.stringify(S.templates[el.dataset.k])); t.id = uid(); t.name += ' (copy)'; t.periods.forEach(p => p.id = uid()); S.templates.push(t); save(); renderEditor(); },
  'tpl-del': el => { const t = S.templates[el.dataset.k]; if (!confirm(`Delete the “${t.name}” bell schedule?`)) return; S.templates.splice(el.dataset.k, 1); for (const d in S.weekdays) if (S.weekdays[d] === t.id) S.weekdays[d] = ''; for (const k in S.overrides) if (S.overrides[k] === t.id) delete S.overrides[k]; save(); renderEditor(); },
  'per-add': el => { const t = S.templates[el.dataset.k]; const last = t.periods[t.periods.length - 1]; const start = last ? addMin(last.end, 5) : '08:00'; t.periods.push({ id: uid(), classId: S.classes[0]?.id || '', start, end: addMin(start, 50) }); save(); renderEditor(); },
  'per-del': el => { S.templates[el.dataset.k].periods.splice(el.dataset.p, 1); save(); renderEditor(); },
  'ov-add': () => { const d = new Date(); d.setDate(d.getDate() + 1); let k = dateKey(d); while (k in S.overrides) { d.setDate(d.getDate() + 1); k = dateKey(d); } S.overrides[k] = 'none'; save(); renderEditor(); },
  'ov-del': el => { delete S.overrides[el.dataset.k]; save(); renderEditor(); },
  // routines
  'routine-add': () => { S.routines.push({ id: uid(), enabled: true, time: '08:00', days: [1, 2, 3, 4, 5], action: 'message', text: '', seconds: 10 }); save(); renderEditor(); },
  'routine-del': el => { S.routines.splice(el.dataset.k, 1); save(); renderEditor(); },
  'routine-day': el => { const r = S.routines[el.dataset.k], d = +el.dataset.d; r.days = r.days?.includes(d) ? r.days.filter(x => x !== d) : [...(r.days || []), d]; save(); renderEditor(); },
  // notes
  'note-shift': el => { const d = parseKey(NOTE_DATE); d.setDate(d.getDate() + Number(el.dataset.d)); NOTE_DATE = dateKey(d); renderEditor(); },
  'note-today': () => { NOTE_DATE = dateKey(new Date()); renderEditor(); },
  'note-go': el => { NOTE_DATE = el.dataset.d; renderEditor(); },
  'print-note': () => { const c = S.classes.find(x => x.id === NOTE_CLASS); printHTML(`${c.name} — Lesson notes`, noteBlock(c, NOTE_DATE)); },
  'print-range': () => {
    const c = S.classes.find(x => x.id === NOTE_CLASS), a = $('#pr-from').value, b = $('#pr-to').value;
    const ks = Object.keys(c.notes).filter(k => k >= a && k <= b && c.notes[k]?.trim()).sort();
    if (!ks.length) return toast('No notes in that date range.');
    printHTML(`${c.name} — Lesson notes`, `<div class="meta">${a} to ${b}</div>` + ks.map(k => noteBlock(c, k)).join(''));
  },
  'print-sub': () => printSub($('#sub-date').value || NOTE_DATE),
  // events
  'ev-add': el => { const kind = el.dataset.kind; S.events.push({ id: uid(), kind, date: dateKey(new Date()), title: '', time: '', yearly: kind === 'birthday' }); save(); renderEditor(); const ins = $$('input[data-bind$=".title"]'); },
  'ev-del': el => { S.events.splice(el.dataset.k, 1); save(); renderEditor(); },
  'ev-clear-past': () => { const k = dateKey(new Date()); S.events = S.events.filter(e => e.yearly || !e.date || e.date >= k); save(); renderEditor(); },
  'ev-ics': async () => {
    const [f] = await pickFile('.ics,text/calendar'); if (!f) return;
    const evs = parseICS(await f.text()); const existing = new Set(S.events.map(e => e.date + '|' + e.title));
    let n = 0; for (const e of evs) { if (existing.has(e.date + '|' + e.title)) continue; S.events.push({ id: uid(), kind: 'event', date: e.date, title: e.title, time: '', yearly: false }); n++; }
    save(); renderEditor(); toast(`Imported ${n} event${n === 1 ? '' : 's'}.`);
  },
  // library
  'lib-add': async () => { const fs = await pickFile('audio/*,application/pdf,image/*,video/*', true); for (const f of fs) await storeFile(f); renderEditor(); if (fs.length) toast(`Added ${fs.length} file${fs.length > 1 ? 's' : ''}.`); },
  'lib-del': el => { const f = S.files[el.dataset.id]; if (!confirm(`Delete “${f.name}” from the library?`)) return; deleteFile(el.dataset.id); renderEditor(); },
  // settings
  export: () => { const text = JSON.stringify(S, null, 2), name = `rehearsal-backup-${dateKey(new Date())}.json`; if (!native('saveText', { name, text })) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); } },
  import: async () => { const [f] = await pickFile('.json,application/json'); if (!f) return; try { const d = JSON.parse(await f.text()); if (!d.classes) throw 0; if (!confirm('Replace all current data with this backup?')) return; S = migrate(d); save(); renderEditor(); toast('Backup imported.'); } catch { alert('That file is not a Rehearsal backup.'); } },
  reset: () => { if (!confirm('Erase everything and start over with the basic template (four music classes and a sample bell schedule)?')) return; S = sampleData(); save(); renderEditor(); },
  'upd-check': () => {
    UPD.dismissed = null;
    if (UPD.state === 'web-ready') { refreshUpdateUI(); const b = $('#upd-status'); b?.classList.add('flash'); return; }   // already downloaded: it just needs a restart
    if (!IS_NATIVE) return webUpdateCheck(true);
    UPD = { ...UPD, state: 'checking' }; refreshUpdateUI();     // show it's working right away
    native('updateCheck');
  },
  'upd-done-close': el => el.closest('.upd-banner')?.remove(),
  'upd-apply': async () => {
    if (IS_NATIVE) return native('updateApply');
    try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { }
    location.reload();
  },
  'upd-install': () => native('updateInstallApp'),
  'upd-later': () => { UPD.dismissed = UPD.version; refreshUpdateUI(); },
};
// tap along with clicks; the median gap between a click and your tap is the extra delay to allow for
function calibrateSync() {
  $('#av-cal')?.remove();
  const c = ac(); c.resume?.();
  const box = document.createElement('div'); box.id = 'av-cal'; box.className = 'av-cal';
  box.innerHTML = `<div class="av-card"><h3>Tap along with the clicks</h3><p>4 clicks to get ready, then tap the circle (or press Space) exactly on each of the next 8.</p>
    <button class="av-pad" data-av="tap"><span>Tap</span></button><div class="av-st">Starting…</div><button class="btn" data-av="close">Cancel</button></div>`;
  document.body.appendChild(box);
  const beat = 60 / 90, t0 = c.currentTime + 0.6, lead = 4, n = 8, clicks = [];
  for (let i = 0; i < lead + n; i++) { const t = t0 + i * beat; metClick(t, i % 4 === 0 ? 'down' : 'beat'); if (i >= lead) clicks.push(t); }
  const diffs = [], st = box.querySelector('.av-st'), pad = box.querySelector('.av-pad');
  const tap = e => {
    const t = typeof grTapTime === 'function' ? grTapTime(c, e) : c.currentTime;
    const k = clicks.reduce((b, x) => Math.abs(x - t) < Math.abs(b - t) ? x : b, Infinity);
    if (Math.abs(k - t) < beat / 2) diffs.push(t - k);
    pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
    st.textContent = `${diffs.length} of ${n}`;
  };
  const key = e => { if (e.code === 'Space') { e.preventDefault(); tap(e); } if (e.key === 'Escape') done(true); };
  const done = cancel => {
    document.removeEventListener('keydown', key, true); clearTimeout(timer);
    if (cancel) return box.remove();
    if (diffs.length < 5) { st.textContent = 'Not enough taps. Try again.'; pad.disabled = true; return; }
    const m = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const ms = setAvDelay(m * 1000);
    st.innerHTML = `Done: <b>${ms} ms</b> on this ${DEVICE}.`; pad.disabled = true; box.querySelector('[data-av="close"]').textContent = 'Close';
    document.querySelectorAll('[data-action-input="av-delay"]').forEach(v => { v.value = ms; v.nextElementSibling.textContent = ms + ' ms'; });
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); tap(e); });
  box.querySelector('[data-av="close"]').onclick = () => box.remove();
  document.addEventListener('keydown', key, true);
  setTimeout(() => { st.textContent = 'Get ready…'; }, 500);
  setTimeout(() => { st.textContent = 'Tap now!'; }, (t0 - c.currentTime + lead * beat - 0.2) * 1000);
  const timer = setTimeout(() => done(false), (t0 - c.currentTime + (lead + n) * beat + 0.6) * 1000);
}
const CHANGE = {
  'board-paper': el => { S.settings.boardPaper = el.value; save(); updateInkUI(); },
  pin: el => { P.pinned = el.value || null; P.layoutKey = ''; renderDock(); },
  'ink-size': el => { P.ink.size = Number(el.value); },
  'noise-beep': el => { NOISE.beep = el.checked; },
  'rand-norep': el => { R.noRepeat = el.checked; R.used.clear(); },
  'note-class': el => { NOTE_CLASS = el.value; renderEditor(); },
  'note-date': el => { if (el.value) { NOTE_DATE = el.value; renderEditor(); } },
  'grlog-toggle': el => {
    S.settings.saveGradeRecordings = el.checked; save();
    if (!el.checked && HAS_SERVER) fetch('/api/purge-grlogs?keep=0', { method: 'POST', headers: { 'X-Token': TOKEN } }).catch(() => { });
  },
  'sim-on': el => { const s = S.settings.sim; s.on = el.checked; s.setAt = Date.now(); P.fired.clear(); save(); },
  'sim-time': el => { const s = S.settings.sim; s.time = el.value || s.time; s.setAt = Date.now(); P.fired.clear(); save(); },
};
const INPUT = {
  'music-vol': el => { setMusicVol(+el.value); el.nextElementSibling.textContent = Math.round(+el.value * 100) + '%'; },
  'av-delay': el => { const ms = setAvDelay(+el.value); el.nextElementSibling.textContent = ms + ' ms'; },
  'noise-limit': el => { NOISE.limit = Number(el.value); const l = $('#nm .lim'); if (l) l.style.left = NOISE.limit + '%'; },
  'rand-n': el => { R.groupN = clamp(Number(el.value) || 4, 2, 12); },
};
let DRIVE_TARGET = null;
const selClass = () => S.classes.find(c => c.id === SEL_CLASS);
function addMin(hhmm, n) { const [h, m] = hhmm.split(':').map(Number); const t = (h * 60 + m + n) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; }
function guessTitle(url) {
  const k = resKind({ url });
  return { slides: 'Slides', doc: 'Doc', sheet: 'Sheet', form: 'Form', drive: 'Drive file', youtube: 'Video', canva: 'Canva' }[k] || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Link'; } })();
}
function exitFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.(); }

// Called by the native Drive window when the teacher clicks “Use this file”.
window.__drivePicked = ({ url, title }) => {
  const cls = S.classes.find(c => c.id === (DRIVE_TARGET || SEL_CLASS)) || S.classes[0];
  if (!cls) return;
  cls.resources.push({ id: uid(), title: title || guessTitle(url), url, mode: 'embed' });
  save(); toast(`Added “${title}” to ${cls.name}`);
  if (VIEW === 'edit') renderEditor(); else P.stageKey = '';
};

// ============================================================ global events
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT' && el.type !== 'button') return;
  const fn = A[el.dataset.action]; if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.actionInput && INPUT[el.dataset.actionInput]) return INPUT[el.dataset.actionInput](el);
  if (el.dataset.bind && el.type !== 'checkbox' && el.tagName !== 'SELECT') bindValue(el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.actionChange && CHANGE[el.dataset.actionChange]) return CHANGE[el.dataset.actionChange](el);
  if (el.dataset.bind) {
    bindValue(el);
    if (el.dataset.rerender !== undefined || el.dataset.rerenderBlur !== undefined) {
      if (VIEW === 'edit') renderEditor(); else if (P.autoDrawer && el.closest('#auto-drawer')) renderAutoDrawer();
    }
  }
});
function bindValue(el) {
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.dataset.type === 'num') v = el.value === '' ? 0 : Number(el.value);
  else if (el.dataset.type === 'lines') v = el.value.split('\n').map(s => s.trim()).filter(Boolean);
  else v = el.value;
  setPath(S, el.dataset.bind, v);
  if (el.dataset.bind.includes('.notes.') && v === '') { const p = el.dataset.bind.split('.'); delete getPath(S, p.slice(0, -1).join('.'))[p.at(-1)]; }
  save();
}
// dragging tool windows
let drag = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-drag]'); if (!h || e.target.closest('button')) return;
  const name = h.dataset.drag, win = h.parentElement;
  drag = { name, win, dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
});
document.addEventListener('pointermove', e => {
  P.lastMove = Date.now();
  if (!drag) return;
  const x = clamp(e.clientX - drag.dx, 0, innerWidth - 80), y = clamp(e.clientY - drag.dy, 0, innerHeight - 40);
  drag.win.style.left = x + 'px'; drag.win.style.top = y + 'px'; P.tools[drag.name] = { x, y };
});
document.addEventListener('pointerup', () => {
  if (drag && P.tools[drag.name]) { const p = P.tools[drag.name]; (S.settings.toolPos ||= {})[drag.name] = { x: p.x / innerWidth, y: p.y / innerHeight }; save(); }   // remember where you put it
  drag = null;
});
document.addEventListener('keydown', e => {
  P.lastMove = Date.now();
  if (VIEW !== 'present' || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (e.key === 'ArrowRight') A['agenda-next']();
  else if (e.key === 'ArrowLeft') A['agenda-prev']();
  else if (e.key === 'Escape' && P.stageMax) { P.stageMax = false; P.stageKey = ''; }
  else if (e.key === 'Escape') { if (P.overlay) A['overlay-dismiss'](); else if (P.ink.on) A['ink-close'](); else P.signal = null; }
  else if (e.key === 'e' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go('edit'); }
});
// The toolbar wakes only when the pointer comes near it (near the small square while it's shrunk), not on any
// mouse move or key press, and stays open while the pointer is over or near it.
function dockNearCheck(e) {
  const d = $('#p-dock'); if (!d || VIEW !== 'present') return;
  const r = d.getBoundingClientRect(), m = 40;
  let L = r.left, R = r.right, T = r.top, B = r.bottom;
  if (d.classList.contains('hidden')) {
    if (d.classList.contains('vertical')) { const c = (T + B) / 2, h = r.width / 2; T = c - h; B = c + h; }
    else { const c = (L + R) / 2, h = r.height / 2; L = c - h; R = c + h; }
  }
  if (e.clientX > L - m && e.clientX < R + m && e.clientY > T - m && e.clientY < B + m) P.dockNear = Date.now();
}
document.addEventListener('pointermove', dockNearCheck, true);
document.addEventListener('pointerdown', dockNearCheck, true);
document.addEventListener('pointerdown', () => { P.lastMove = Date.now(); if (AC && AC.state === 'suspended') AC.resume().then(() => $('.sound-chip')?.remove()); }, true);

// ============================================================ boot
(async function boot() {
  await loadData();
  await loadBrowserFiles();
  // in a browser (iPad): an offline copy of the app, refreshed from the web whenever there's a connection
  if (!IS_NATIVE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
  native('hello');   // native replies with notch spacing if we're covering the screen
  native('updateStatus');
  // grading recordings are only kept on disk when troubleshooting is turned on (then the newest 20)
  if (HAS_SERVER) fetch(`/api/purge-grlogs?keep=${S.settings.saveGradeRecordings ? 20 : 0}`, { method: 'POST', headers: { 'X-Token': TOKEN } }).catch(() => { });
  if (S.settings.sim.on && !S.settings.sim.setAt) S.settings.sim.setAt = Date.now();
  render();
  // tick 4× a second, and right after each of the clock's whole seconds, so the clock and timers change together
  const loop = () => { tick(); const o = clockOff(), toNext = 1000 - ((Date.now() + o) % 1000 + 1000) % 1000; setTimeout(loop, Math.min(250, toNext + 8)); };
  loop();
})();

// ---------- free-window dragging, resizing, focus, address bar
document.addEventListener('pointerdown', e => {
  if (VIEW !== 'present') return;
  if (P.snapFor && !e.target.closest('.snap-menu, [data-action="win-snap"]')) { P.snapFor = null; renderSnapMenu(); }
  if (BM.open && !e.target.closest('.bm-menu, [data-action="bm-folder"]')) { BM.open = null; renderBmMenu(); }
  if (P.dockCustom && !e.target.closest('.dock-custom, [data-action="dock-custom"]')) { P.dockCustom = false; renderDockCustom(); renderDock(); }
  if (P.winMenu && !e.target.closest('.win-menu, [data-action="win-menu"]')) { P.winMenu = false; P.appPick = null; renderWinMenu(); renderDock(); }
  const winEl = e.target.closest('.win'); if (!winEl) return;
  const w = findWin(winEl.dataset.win); if (!w) return;
  bringToFront(w);
  const bar = e.target.closest('[data-wdrag]'), rs = e.target.closest('[data-wresize]');
  if ((!bar && !rs) || e.target.closest('button, input')) return;
  e.preventDefault();
  if (w.max) { w.max = false; applyWinGeom(); }
  const L = $('#p-wins').getBoundingClientRect();
  WIN.drag = { w, mode: rs ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, ow: w.w, oh: w.h, L };
  $('#p-wins').classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  const d = WIN.drag; if (!d) return;
  const dx = (e.clientX - d.sx) / d.L.width, dy = (e.clientY - d.sy) / d.L.height, w = d.w;
  if (d.mode === 'move') { w.x = clamp(d.ox + dx, -w.w + 0.08, 0.95); w.y = clamp(d.oy + dy, 0, 0.95); }
  else { w.w = clamp(d.ow + dx, 0.15, 1.2 - w.x); w.h = clamp(d.oh + dy, 0.15, 1.05 - w.y); }
  applyWinGeom();
});
document.addEventListener('pointerup', () => {
  if (!WIN.drag) return;
  WIN.drag = null; $('#p-wins')?.classList.remove('dragging'); save();
});
document.addEventListener('keydown', e => {
  const id = e.target?.dataset?.wurl; if (!id) return;
  if (e.key === 'Enter') { const w = findWin(id); if (w) openWebAddress(w, e.target.value); }
  if (e.key === 'Escape') { e.target.value = findWin(id)?.url || ''; e.target.blur(); }
});
// Double-click a window's title bar to maximize / restore it.
document.addEventListener('dblclick', e => {
  const bar = e.target.closest('[data-wdrag]'); if (!bar || e.target.closest('button, input')) return;
  const w = findWin(bar.dataset.wdrag); if (w) { w.max = !w.max; save(); applyWinGeom(); }
});
