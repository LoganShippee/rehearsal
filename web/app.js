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
const DEVICE = IS_NATIVE ? (window.__REHEARSAL_PLATFORM === 'windows' ? 'PC' : 'Mac') : /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : 'computer';
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
  for (const k of ['classes', 'templates', 'routines', 'events', 'recordings', 'pinnedApps']) if (!Array.isArray(d[k])) d[k] = [];
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
  if (!d) { try { d = JSON.parse(localStorage.getItem('rehearsal') || 'null'); } catch { } }
  S = migrate(d || sampleData());
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 350); }
async function saveNow() {
  if (window.__noSave) return;
  const body = JSON.stringify(S);
  try { localStorage.setItem('rehearsal', body); } catch { }
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
// PDF marks are kept per Library file (S.pdfInk[fileId] = { page: [strokes] }), so every tab or window of
// that PDF shows them. "Save copy" stores a new PDF with the marks burned in and opens it next to the original.
function pdfInkOpts(fid, where) {
  return {
    key: fid,
    ink: () => ((S.pdfInk ||= {})[fid] ||= {}),
    saveInk: () => { const m = S.pdfInk?.[fid]; if (m) for (const p of Object.keys(m)) if (!m[p]?.length) delete m[p]; if (m && !Object.keys(m).length) delete S.pdfInk[fid]; save(); },
    saveCopy: async blob => {
      const base = (S.files[fid]?.name || 'PDF').replace(/\.pdf$/i, '');
      const name = `${base} (annotated ${new Date().toLocaleDateString()}).pdf`.replace(/[\/\\:]/g, '-');
      const id = await storeFile(new File([blob], name, { type: 'application/pdf' }));
      if (where.res) {
        const cls = S.classes.find(c => c.resources.includes(where.res));
        if (cls) { const r = { ...JSON.parse(JSON.stringify(where.res)), id: uid(), fileId: id, title: (where.res.title || base) + ' (annotated)', pdf: {} }; cls.resources.splice(cls.resources.indexOf(where.res) + 1, 0, r); P.stageKey = ''; }
        toast(`Saved “${name}” to the Library and added it as a tab next to the original.`, 4500);
      } else { addWindow({ kind: 'file', fileId: id }); toast(`Saved “${name}” to the Library and opened it.`, 4000); }
      save();
    },
  };
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
  delete S.files[id]; if (S.pdfInk) delete S.pdfInk[id];
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
// Repeating events/announcements: e.repeat = '' | 'daily' (school days) | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly',
// from e.date until e.until (optional); e.skip lists days taken out of the series. Old events used e.yearly.
const REPEATS = [['', 'Once'], ['daily', 'Every school day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['yearly', 'Every year']];
const evRepeat = e => e.repeat != null ? e.repeat : (e.yearly ? 'yearly' : '');
const repeatSel = (e, attr) => `<select ${attr} title="Repeat">${REPEATS.map(([v, l]) => `<option value="${v}" ${evRepeat(e) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
function evOnDay(e, d, k) {
  if (!e.date || (e.skip || []).includes(k)) return false;
  if (e.date === k) return true;
  const r = evRepeat(e);
  if (r === 'yearly') return e.date.slice(5) === k.slice(5) && (!e.until || k <= e.until);   // birthdays: any year
  if (!r || k < e.date || (e.until && k > e.until)) return false;
  const s = parseKey(e.date);
  if (r === 'daily') return !!templateFor(d);
  if (r === 'weekdays') return d.getDay() > 0 && d.getDay() < 6;
  if (r === 'weekly') return d.getDay() === s.getDay();
  if (r === 'biweekly') return d.getDay() === s.getDay() && Math.round((parseKey(k) - s) / 864e5) % 14 === 0;
  if (r === 'monthly') return d.getDate() === s.getDate();
  return false;
}
function eventsOn(date, cls) {
  const k = dateKey(date);
  return S.events.filter(e => evOnDay(e, date, k)
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
  lastStageId: null,
  companion: null,
  tour: null,
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
    const cls = (P.pinned === '__tour_cls' && P.tourSampleCls) || S.classes.find(c => c.id === P.pinned);
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
// Metronome / count-in clicks have their own volume (0–200%), separate from the music, in every tool
// (Metronome, sight reading, score practice, grading count-ins, Recorder click). Kept per device.
// Every click is scheduled with metVol() as a multiplier, so a change applies from the next click.
const MET_VOL_KEY = 'rehearsal-metvol';
function metVol() { try { const s = localStorage.getItem(MET_VOL_KEY); if (s != null && s !== '' && isFinite(+s)) return Math.max(0, +s); } catch { } return 1; }
function setMetVol(v) {
  v = Math.max(0, Math.min(2, +v || 0)); try { localStorage.setItem(MET_VOL_KEY, String(v)); } catch { }
  document.querySelectorAll('input[data-metvol]').forEach(i => { if (+i.value !== v) i.value = v; const b = i.parentElement?.querySelector('.mv-v'); if (b) b.textContent = Math.round(v * 100) + '%'; });
}
// a small "Metronome volume" slider that any tool can drop into its settings
const metVolSlider = (label = 'Metronome volume') => `<label class="metvol" title="Volume of the metronome and count-in clicks only (the music keeps its own volume)">${label} <input type="range" min="0" max="2" step="0.05" value="${metVol()}" data-metvol><b class="mv-v">${Math.round(metVol() * 100)}%</b></label>`;
document.addEventListener('input', e => { if (e.target.matches?.('input[data-metvol]')) { e.stopPropagation(); setMetVol(e.target.value); } }, true);
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
  P.music = a; a.play().catch(() => { });
}
function stopMusic(immediate = false) {
  const a = P.music; if (!a) return; P.music = null;
  if (immediate) { a.pause(); return; }
  const v0 = a.volume; let i = 0;
  const iv = setInterval(() => { i++; a.volume = Math.max(0, v0 * (1 - i / 15)); if (i >= 15) { clearInterval(iv); a.pause(); } }, 100);
}
function showSoundChip() {
  // Removed: audio context auto-resumes silently on first click/keypress or playback action.
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
      if (!tm.muted) playSound(tm.sound);
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
  const hasFull = P.timers.some(t => t.full);
  el.classList.toggle('has-full', hasFull);
  el.innerHTML = P.timers.map(tm => {
    const isFull = !!tm.full;
    const isFloat = !isFull && tm.x != null && tm.y != null;
    const sty = isFloat
      ? `left:${Math.round(tm.x)}px;top:${Math.round(tm.y)}px;${tm.w ? `width:${Math.round(tm.w)}px;` : ''}${tm.h ? `height:${Math.round(tm.h)}px;` : ''}`
      : '';
    const paused = !tm.doneAt && tm.pausedLeft != null;
    const muted = tm.muted || tm.sound === 'none';
    return `<div class="p-timer ${paused ? 'paused' : ''} ${isFloat ? 'floating' : ''} ${isFull ? 'full' : ''}" data-tid="${tm.id}" data-tdrag="${tm.id}" style="${sty}">
      <div class="tm-bar">
        <div class="tm-title-col">
          <div class="tl"><span class="tl-txt">${esc(tm.label)}</span><span class="tl-paused" ${paused ? '' : 'hidden'}>Paused</span></div>
          <button class="tm-end" data-action="timer-x" data-id="${tm.id}" title="End timer" aria-label="End timer">End</button>
        </div>
        <div class="tm-win-acts">
          <button data-action="timer-full" data-id="${tm.id}" class="${isFull ? 'on' : ''}" title="${isFull ? 'Restore timer size' : 'Maximize timer'}" aria-label="${isFull ? 'Restore timer size' : 'Maximize timer'}">${IC(isFull ? 'ico:restore' : 'ico:maximize')}</button>
        </div>
      </div>
      <div class="tm-body">
        <span class="ringwrap"></span>
        <div class="tv"></div>
      </div>
      <div class="tm-ctrls">
        <button data-action="timer-pause" data-id="${tm.id}" class="${paused ? 'on' : ''}" title="${paused ? 'Resume timer' : 'Pause timer'}" aria-label="${paused ? 'Resume timer' : 'Pause timer'}">${IC(paused ? 'ico:play' : 'ico:pause')}${isFull ? `<span>${paused ? 'Resume' : 'Pause'}</span>` : ''}</button>
        <button data-action="timer-add" data-id="${tm.id}" title="Add a minute">${isFull ? '+1 min' : '+1'}</button>
        <button data-action="timer-mute" data-id="${tm.id}" class="${muted ? 'on' : ''}" title="${tm.muted ? 'Sound off: click to turn the end sound back on' : 'Mute the end sound'}" aria-label="Toggle timer sound">${IC(muted ? 'ico:mute' : 'ico:bell')}${isFull ? `<span>${muted ? 'Muted' : 'Sound'}</span>` : ''}</button>
      </div>
      ${isFull ? '' : `<div class="tm-rs" data-tresize="${tm.id}" title="Drag corner to resize timer"></div>`}
    </div>`;
  }).join('');
  updateTimers();
}
function updateTimers() {
  for (const tm of P.timers) {
    const el = $(`.p-timer[data-tid="${tm.id}"]`); if (!el) continue;
    const left = timerLeft(tm), paused = !tm.doneAt && tm.pausedLeft != null;
    el.querySelector('.tv').textContent = tm.doneAt ? "Time's up!" : fmtDur(left);
    el.querySelector('.ringwrap').innerHTML = ringSVG(tm.doneAt ? 0 : clamp(left / tm.total, 0, 1));
    el.classList.toggle('warn', !tm.doneAt && !paused && left < 10000);
    el.classList.toggle('done', !!tm.doneAt);
    el.classList.toggle('paused', paused);
    const pb = el.querySelector('[data-action="timer-pause"]');
    if (pb) {
      pb.classList.toggle('on', paused);
      pb.title = pb.ariaLabel = paused ? 'Resume timer' : 'Pause timer';
      const want = (paused ? 'ico:play' : 'ico:pause') + (tm.full ? ':full' : '');
      if (pb.dataset.ic !== want) {
        pb.dataset.ic = want;
        pb.innerHTML = IC(paused ? 'ico:play' : 'ico:pause') + (tm.full ? `<span>${paused ? 'Resume' : 'Pause'}</span>` : '');
      }
    }
    const pl = el.querySelector('.tl-paused'); if (pl) pl.hidden = !paused;
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
  return raw.replace(/\/(embed|preview|present)(\?.*)?$/, '/edit');
}
function slidesPresentURL(raw) {
  const m = String(raw || '').match(/docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([\w-]+)/);
  return m ? `https://docs.google.com/presentation/d/${m[1]}/preview?rm=minimal` : embedURL(raw);
}
function autoNativeWeb(raw) {
  if (!IS_NATIVE || !raw) return false;
  try {
    const u = new URL(raw), h = u.hostname.toLowerCase(), p = u.pathname.toLowerCase();
    // Simple lightweight embeds stay Embedded so drawing works immediately without switching:
    if (h === 'docs.google.com' && p.startsWith('/presentation/') && /\/(embed|preview)(\/|$)/.test(p)) return false;
    if ((h === 'www.youtube.com' || h === 'youtube.com' || h === 'www.youtube-nocookie.com') && p.startsWith('/embed/')) return false;
    if (h === 'player.vimeo.com') return false;
    // Google Workspace, Google Search, sign-in/SSO, classroom/music apps, and major sites default to Full browser:
    if (/(^|\.)(google\.com|youtube\.com|youtu\.be|microsoft\.com|office\.com|live\.com|onedrive\.live\.com|notion\.so|canva\.com|flat\.io|noteflight\.com|musescore\.com|sightreadingfactory\.com|smartmusic\.com|makemusic\.com|kahoot\.it|kahoot\.com|quizlet\.com|gimkit\.com|blooket\.com|instructure\.com|schoology\.com|clever\.com|classlink\.com|github\.com|spotify\.com|apple\.com)$/.test(h)) return true;
    return true;
  } catch {
    return true;
  }
}
function isNativeWeb(r) {
  if (!IS_NATIVE || !r) return false;
  if (r.markupMode) return false;
  if (resKind(r) === 'slides' && r.mode === 'present') return false;
  if (r.native != null) return !!r.native;
  return autoNativeWeb(r.url);
}
function resTargetURL(r, raw) {
  const u = raw ?? r?.url ?? '';
  if (!u) return '';
  if (resKind({ url: u }) === 'slides' && r?.mode === 'present') return slidesPresentURL(u);
  if (r?.mode === 'edit') return editURL(embedURL(u));
  if (isNativeWeb({ ...r, url: u })) return resKind({ url: u }) === 'slides' ? editURL(u) : u;
  return embedURL(u);
}
function kindIcon(k) { return icoCfg().kind?.[k] ?? KIND_ICON[k] ?? 'ico:attach'; }
function resIcon(r) { return r.icon || kindIcon(resKind(r)); }
function tabIcon(r) { return iconOn('tabs') ? icoSp(resIcon(r)) : ''; }
function resKind(r) {
  if (r.filesBrowser) return 'files';
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
const KIND_ICON = { files: 'ico:folder', cal: 'ico:events', prog: 'ico:gauge', tuner: 'ico:tuner', metro: 'ico:metro', sight: 'ico:sight', score: 'ico:score', slides: 'ico:slides', doc: 'ico:doc', sheet: 'ico:sheet', form: 'ico:form', drive: 'ico:folder', youtube: 'ico:youtube', canva: 'ico:look', web: 'ico:web', pdf: 'ico:file', image: 'ico:image', video: 'ico:video', audio: 'ico:audio', file: 'ico:attach', missing: 'ico:warn' };
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
function stopMusicHosts() {
  if (typeof srStop === 'function') srStop();
  if (typeof spStop === 'function') spStop();
  if (typeof GR !== 'undefined' && (GR.on || GR.starting) && typeof grStop === 'function') grStop(false);
}
function go(view) {
  if (view !== 'present') undockStageApp(false);
  VIEW = view; P.dockNear = Date.now(); P.winMenu = false; P.webModeMenu = null; $('#web-mode-menu')?.remove(); P.clipOpen = false; $('#clip-panel')?.remove(); P.iconsOpen = false; $('#icons-panel')?.remove();
  if (view === 'present') { P.layoutKey = P.sideKey = P.stageKey = ''; } else stopMusicHosts();
  render();
}

// ============================================================ PRESENT
function renderPresent() {
  app().innerHTML = `<div class="present" id="present">
    <div class="p-bg" id="p-bg"></div>
    <div class="p-companion" id="p-companion"></div>
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
  // The header's title and clock change width (Quick edit adds time fields, the class name changes…):
  // re-fit the toolbar so ⋯ never gets pushed out of reach
  let fitQueued = false;
  const refit = new ResizeObserver(() => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitDock(); }); });
  ['#p-title', '#p-clock'].forEach(s => { const el = $(s); if (el) refit.observe(el); });
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
  // side panel: its own text size and background strength, unless linked to the other panels
  if (th.sideLinked === false) {
    el.style.setProperty('--side-fs', (th.sideFont ?? 1) + 'em');
    el.style.setProperty('--side-card', hexA(th.bg, th.sidePanel ?? th.panel ?? 0.1));
  } else { el.style.removeProperty('--side-fs'); el.style.removeProperty('--side-card'); }
  el.style.setProperty('--bg', th.bg); el.style.setProperty('--accent', th.accent); el.style.setProperty('--text', th.text || '#fff');
  if (th.titleText) el.style.setProperty('--title-text', th.titleText); else el.style.removeProperty('--title-text');
  if (th.clockText) el.style.setProperty('--clock-text', th.clockText); else el.style.removeProperty('--clock-text');
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
  sight: { icon: 'ico:sight', label: 'Sight reading', act: 'wm-sight' },
  cal: { icon: 'ico:events', label: 'Calendar', act: 'wm-cal', on: () => winList().some(w => w.kind === 'cal') },
  prog: { icon: 'ico:gauge', label: 'Progress', act: 'wm-prog', on: () => winList().some(w => w.kind === 'prog') },
  yt: { icon: 'ico:youtube', label: 'YouTube', act: 'wm-yt', on: () => winList().some(w => w.kind === 'yt') },
  rec: { icon: 'ico:mic', label: 'Recorder', act: 'wm-rec', on: () => winList().some(w => w.kind === 'rec') || REC.state === 'rec' },
  piano: { icon: 'ico:piano', label: 'Piano', act: 'wm-piano', on: () => winList().some(w => w.kind === 'piano') },
  solboard: { icon: 'ico:ladder', label: 'Solfege board', act: 'wm-solboard', on: () => winList().some(w => w.kind === 'solboard') },
  score: { icon: 'ico:score', label: 'Score practice', act: 'wm-score', on: () => winList().some(w => w.kind === 'score') },
  clip: { icon: 'ico:clip', label: 'Copy/paste', act: 'clip-open', on: () => !!P.clipOpen },
  window: { icon: 'ico:plus', label: 'Open', act: 'win-menu', on: () => P.winMenu },
  tile: { icon: 'ico:tile', label: 'Tile', act: 'win-tile' },
  classpick: { icon: 'ico:pin', label: 'Class picker', special: 'classpick' },
  fullscreen: { icon: 'ico:fullscreen', label: 'Full screen', act: 'fullscreen' },
  editmode: { icon: 'ico:quickedit', label: 'Quick edit', act: 'edit-mode', on: () => !!P.editMode },
  edit: { icon: 'ico:edit', label: 'Setup', act: 'edit', locked: true },
  sep1: { sep: true, label: '— divider —' }, sep2: { sep: true, label: '— divider —' }, sep3: { sep: true, label: '— divider —' },
};
// Tools that ＋ Open always lists: on the bar or off, never repeated in ⋯ (unless they don't fit on the bar)
const DOCK_LAUNCHERS = ['sight', 'score', 'tuner', 'metro', 'cal', 'prog', 'rec', 'yt', 'piano', 'solboard'];
const DOCK_GROUP = { tile: 'screen', fullscreen: 'screen', classpick: 'screen', editmode: 'cls', clip: 'cls', edit: 'setup' };
const DOCK_DEFAULT = ['timer', 'annotate', 'board', 'sep1', 'tuner', 'metro', 'rec', 'piano', 'window', 'sep2', 'classpick', 'sep3', 'edit', 'editmode'];
function dockCfg() {
  const d = (S.settings.dock ||= {});
  d.order ||= [...DOCK_DEFAULT];
  for (const id of Object.keys(DOCK_ITEMS)) if (!d.order.includes(id) && ['cal', 'prog', 'rec', 'yt', 'piano', 'solboard'].includes(id) && d.menu && !d.menu.includes(id)) d.menu.push(id);   // new tools start in ＋ Open
  for (const id of Object.keys(DOCK_ITEMS)) if (!d.order.includes(id)) { const at = id === 'editmode' && d.order.includes('edit') ? d.order.indexOf('edit') : d.order.length; d.order.splice(at, 0, id); }   // new tools appear at the end
  d.hidden ||= ['sight'];
  d.menu ||= ['points', 'noise', 'random', 'signal', 'score', 'clip', 'tile', 'fullscreen', 'cal', 'prog', 'yt', 'solboard']; // shown in the ⋯ / ＋ Open menu instead of on the bar
  d.inOpen ||= [];                                                                 // extra toolbar buttons placed in ＋ Open
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
  const parts = cfg.order.filter(id => !cfg.hidden.includes(id) && !cfg.menu.includes(id) && !(cfg.inOpen || []).includes(id) && DOCK_ITEMS[id]).map(id => {
    const it = DOCK_ITEMS[id];
    if (it.sep) return '<span class="sep"></span>';
    if (it.special === 'classpick') return dockClassPick();
    return btn(id, it);
  });
  if (P.music) parts.push(btn('music', { icon: 'ico:stop', label: 'Music', act: 'music-stop' }));
  d.innerHTML = `<span class="dock-idle-ic" aria-hidden="true">${IC('ico:menu')}</span><span class="dock-grip" title="Drag to move the toolbar">⋮⋮</span>${parts.join('').replace(/^(<span class="sep"><\/span>)+|(<span class="sep"><\/span>)+$/g, '')}
    <button data-action="dock-more" class="dock-more ${P.dockCustom || P.dockMore ? 'on' : ''}" title="More tools and toolbar settings" aria-label="More tools and toolbar settings">⋯</button>`;
  d.classList.toggle('nolabels', !cfg.labels);
  applyDockLook();
  placeDock();
  fitDock();
  if (P.dockMore) renderDockMore();
}
function dockClassPick(id = 'classpick') {
  const list = P.tourSampleCls && !S.classes.some(c => c.id === P.tourSampleCls.id) ? [P.tourSampleCls, ...S.classes] : S.classes;
  return `<select ${id === 'classpick' ? 'id="p-cls" ' : ''}data-dock-id="${id}" data-action-change="pin" title="Show a class now, ignoring the schedule">
      <option value="">Follow schedule</option>
      ${list.map(c => `<option value="${c.id}" ${P.pinned === c.id ? 'selected' : ''}>${esc(c.name)}${c.subtitle ? ' · ' + esc(c.subtitle) : ''}</option>`).join('')}</select>`;
}
/** When the bar doesn't fit (small screens, iPad), tuck buttons from the end into the ⋯ menu. Setup is tucked away last, so ⋯ is always visible. */
function fitDock() {
  const d = $('#p-dock'); if (!d) return;
  P.dockOverflow = [];
  const kids = [...d.children];
  requestAnimationFrame(() => { d.style.setProperty('--dock-h', d.offsetHeight + 'px'); d.style.setProperty('--dock-w', d.offsetWidth + 'px'); });
  kids.forEach(k => { if (!k.classList.contains('dock-idle-ic')) k.style.display = ''; });
  const more = d.querySelector('.dock-more');
  const over = () => {
    if (d.classList.contains('vertical')) return d.scrollHeight > d.clientHeight + 1;
    if (d.scrollWidth > d.clientWidth + 1) return true;
    return !!(more && more.getBoundingClientRect().right > d.getBoundingClientRect().right + 1);
  };
  if (!over()) return;
  // Setup goes last: only when nothing else is left, so the ⋯ button itself always stays reachable
  // Buttons that are switched on (Quick edit, Annotate…) go after the others, so you can always switch them off
  const tuck = kids.filter(k => k.dataset.dockId && k.dataset.dockId !== 'edit').reverse();
  const items = [...tuck.filter(k => !k.classList.contains('on')), ...tuck.filter(k => k.classList.contains('on')), ...kids.filter(k => k.dataset.dockId === 'edit')];
  for (const k of items) {
    if (!over()) break;
    k.style.display = 'none'; P.dockOverflow.unshift(k.dataset.dockId);
  }
  // drop dividers that now sit next to each other or at an end
  let prevSep = true;
  for (const k of [...d.children]) {
    if (k.style.display === 'none' || k.classList.contains('dock-grip') || k.classList.contains('dock-idle-ic')) continue;
    if (k.classList.contains('sep')) { if (prevSep) k.style.display = 'none'; prevSep = true; } else prevSep = k.classList.contains('dock-more');
  }
}
/** The ⋯ menu: tools kept off the bar, ones that didn't fit, and the toolbar settings. */
function renderDockMore() {
  $('#dock-more-menu')?.remove();
  if (!P.dockMore) return;
  const cfg = dockCfg();
  const over = P.dockOverflow || [];
  // launchers are always in ＋ Open, so ⋯ only shows them when they were meant for the bar but didn't fit
  const ids = [...new Set([...cfg.order.filter(id => cfg.menu.includes(id) && !cfg.hidden.includes(id) && !DOCK_LAUNCHERS.includes(id)), ...over])].filter(id => DOCK_ITEMS[id] && !DOCK_ITEMS[id].sep);
  const m = document.createElement('div'); m.id = 'dock-more-menu'; m.className = 'dock-more-menu';
  const row = id => { const it = DOCK_ITEMS[id];
    if (it.special === 'classpick') return `<div class="dm-row">${IC('ico:pin')} <span class="dm-lbl">Showing</span> ${dockClassPick('classpick-menu')}</div>`;
    const on = it.tool ? !!P.tools[it.tool] : it.on?.();
    return `<button class="dm-item ${on ? 'on' : ''}" data-action="${it.act}" ${it.tool ? `data-tool="${it.tool}"` : ''} ${it.kind ? `data-kind="${it.kind}"` : ''}><span class="i">${IC(icoCfg().dock?.[id] && icoCfg().dock[id] !== '-' ? icoCfg().dock[id] : it.icon)}</span>${esc(it.label)}</button>`; };
  const groups = [['tools', over.length ? "Didn't fit on the bar" : 'More tools'], ['screen', 'Screen'], ['cls', 'This class'], ['setup', '']]
    .map(([g, title]) => [title, ids.filter(id => (DOCK_GROUP[id] || 'tools') === g)]).filter(([, list]) => list.length);
  m.innerHTML = groups.map(([title, list]) => `${title ? `<div class="dm-head">${title}</div>` : ''}${list.map(row).join('')}`).join('<div class="dm-sep"></div>')
    + `${groups.length ? '<div class="dm-sep"></div>' : ''}<button class="dm-item" data-action="dock-custom"><span class="i">⋯</span>Customize toolbar…</button>
    <button class="dm-item" data-action="help-open"><span class="i">${IC('ico:agenda')}</span>Help &amp; feature guide…</button>
    <button class="dm-item" data-action="bug-report"><span class="i">${IC('ico:warn')}</span>Report a bug (screenshot)…</button>`;
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
/** A labelled row of segmented buttons for the Customize toolbar panel. */
function dcSeg(label, key, opts, cur) {
  return `<div class="dc-lrow"><span>${label}</span><span class="dc-seg" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button type="button" data-dc-opt="${key}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</span></div>`;
}
function renderDockCustom() {
  $('#dock-custom')?.remove();
  if (!P.dockCustom) return;
  const cfg = dockCfg();
  const panel = document.createElement('div'); panel.id = 'dock-custom'; panel.className = 'dock-custom';
  panel.innerHTML = `<div class="dc-head"><b>Toolbar</b><span class="grow"></span><button data-action="dock-custom">Done</button></div>
    <div class="dc-note">Choose where each button goes: on the <b>Bar</b>, in <b>＋ Open</b>, in <b>⋯</b>, or <b>Off</b>. Drag ≡ to reorder.</div>
    <div class="dc-list">${cfg.order.filter(id => DOCK_ITEMS[id]).map(id => { const it = DOCK_ITEMS[id];
      const inOpen = (cfg.inOpen || []).includes(id);
      const launcher = DOCK_LAUNCHERS.includes(id);
      const place = cfg.hidden.includes(id) ? 'off' : inOpen ? 'open' : cfg.menu.includes(id) ? (launcher ? 'off' : 'menu') : 'bar';
      const canOpen = !it.locked && !it.sep && !launcher && id !== 'window' && !it.special;
      const opts = it.locked ? [['bar', 'Bar']] : launcher ? [['bar', 'Bar'], ['off', '＋ Open']] : it.sep ? [['bar', 'Bar'], ['off', 'Off']] : canOpen ? [['bar', 'Bar'], ['open', '＋'], ['menu', '⋯'], ['off', 'Off']] : [['bar', 'Bar'], ['menu', '⋯'], ['off', 'Off']];
      return `<div class="dc-row ${it.sep ? 'sep' : ''} ${place === 'off' && !launcher ? 'is-off' : ''}" draggable="true" data-id="${id}">
      <span class="dc-grip">≡</span>
      <span class="dc-ico">${it.sep ? '' : dockIcon(id, it) || ''}</span>
      <span class="dc-name">${esc(it.label)}</span>
      <span class="dc-seg" role="group" aria-label="Where ${esc(it.label)} goes">${opts.map(([v, l]) => `<button type="button" data-dock-place="${id}" data-v="${v}" aria-pressed="${place === v}" ${v === 'open' ? 'title="Show in ＋ Open menu"' : ''}>${l}</button>`).join('')}</span></div>`; }).join('')}</div>
    <div class="dc-look">
      ${dcSeg('Size', 'size', [['s', 'S'], ['m', 'M'], ['l', 'L']], cfg.size || 'm')}
      ${dcSeg('Colour', 'color', [['dark', 'Dark'], ['light', 'Light'], ['class', 'Class']], cfg.color || 'dark')}
      ${dcSeg('Shrink when idle', 'hide', (() => { const cur = Number(S.settings.hideDockAfter ?? 3), o = [[0, 'Never'], [3, '3 s'], [10, '10 s'], [30, '30 s']]; if (!o.some(([v]) => v === cur)) o.push([cur, `${cur} s`]); return o.sort((a, b) => a[0] - b[0]); })(), Number(S.settings.hideDockAfter ?? 3))}
      <div class="dc-lrow"><span>See-through</span><input type="range" min="25" max="100" step="5" data-dock-opt="alpha" value="${cfg.alpha ?? 82}"></div>
      <label class="dc-lrow"><span>Labels under icons</span><input type="checkbox" class="dc-sw" role="switch" data-dock-labels ${cfg.labels ? 'checked' : ''}></label>
      <label class="dc-lrow"><span>Emojis</span><input type="checkbox" class="dc-sw" role="switch" data-dock-emoji ${iconOn('dock') ? 'checked' : ''}></label>
      <div class="dc-lrow"><span>Icon for each button</span><button data-action="icons-open">${IC('ico:icons')} Icons…</button></div>
    </div>
    <div class="dc-spots"><span>Move to</span><button data-action="dock-spot" data-spot="top">Top (header)</button><button data-action="dock-spot" data-spot="bottom">Bottom</button><button data-action="dock-spot" data-spot="left">Left side</button><button data-action="dock-spot" data-spot="right">Right side</button></div>
    <div class="dc-btns"><button data-action="dock-home">Put toolbar back at the top</button><button data-action="dock-reset">Reset</button></div>`;
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
  // Bar / ⋯ / Off for each button, and the segmented look options
  panel.addEventListener('click', e => {
    const b = e.target.closest('button[data-dock-place], button[data-dc-opt]'); if (!b) return;
    if (b.dataset.dockPlace) {
      const id = b.dataset.dockPlace, v = b.dataset.v, hid = new Set(cfg.hidden), menu = new Set(cfg.menu), inOp = new Set(cfg.inOpen || []);
      hid.delete(id); menu.delete(id); inOp.delete(id);
      if (v === 'off') hid.add(id); if (v === 'menu') menu.add(id); if (v === 'open') inOp.add(id);
      cfg.hidden = [...hid]; cfg.menu = [...menu]; cfg.inOpen = [...inOp];
    } else if (b.dataset.dcOpt === 'hide') S.settings.hideDockAfter = Number(b.dataset.v);
    else cfg[b.dataset.dcOpt] = b.dataset.v;
    const keep = panel.querySelector('.dc-list')?.scrollTop || 0, keepP = panel.scrollTop;
    save(); renderDock(); renderDockCustom();
    const np = $('#dock-custom'); if (np) { np.scrollTop = keepP; const l = np.querySelector('.dc-list'); if (l) l.scrollTop = keep; }
  });
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

function compAppsCombined() {
  const live = P.lastApps || [], out = [], seen = new Set();
  for (const p of pinnedApps()) {
    const k = appKey(p); if (!k || seen.has(k)) continue;
    seen.add(k);
    const m = live.find(w => appKey(w) === k);
    out.push(m ? { ...p, ...m, appIcon: m.appIcon || p.appIcon, preview: m.preview || p.preview, pinned: true } : { ...p, pinned: true });
  }
  for (const w of live) {
    const k = appKey(w); if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...w, pinned: false });
  }
  return out;
}
function renderCompanionBar(ctx, t) {
  const el = $('#p-companion'); if (!el) return;
  const grip = '<div class="comp-grip" aria-hidden="true"></div>';
  if (P.compAppsOpen) {
    const items = compAppsCombined();
    const cur = P.companion?.appName ? { app: P.companion.appName, bundleId: P.companion.bundleId || '' } : null;
    const curPin = cur && isAppPinned(cur);
    const cards = items.length ? items.map(a => {
      const k = appKey(a), sub = a.title && a.title !== a.app ? a.title : '';
      return `<div class="comp-app-card ${a.pinned ? 'is-pinned' : ''}">
        <button class="comp-app-go" data-action="comp-app-switch" data-key="${esc(k)}" title="${esc(a.app + (sub ? ' — ' + sub : ''))}">
          ${a.preview ? `<div class="comp-app-thumb has-prev"><img src="${a.preview}" alt="">${a.appIcon ? `<img class="comp-app-badge" src="${a.appIcon}" alt="">` : ''}</div>`
            : `<div class="comp-app-thumb no-prev">${a.appIcon ? `<img class="comp-app-ic" src="${a.appIcon}" alt="">` : IC('ico:app')}</div>`}
          <span class="comp-app-name">${esc(a.app || 'App')}</span>
        </button>
        <button class="comp-app-pin ${a.pinned ? 'on' : ''}" data-action="comp-app-pin" data-key="${esc(k)}" title="${a.pinned ? 'Unpin app' : 'Pin app'}">${IC('ico:pin')}</button>
      </div>`;
    }).join('') : '<div class="comp-apps-empty">No other open apps found.</div>';
    const html = `<div class="comp-apps-panel">
      <div class="comp-apps-head">
        <button class="comp-back sm" data-action="companion-exit" title="Return to Rehearsal">↩ Rehearsal</button>
        <span class="comp-apps-title">Apps</span>
        ${cur ? `<button class="comp-cur-pin ${curPin ? 'on' : ''}" data-action="comp-pin-cur" title="${curPin ? 'Unpin current app' : 'Pin current app'}">${IC('ico:pin')} <span>${curPin ? 'Pinned' : 'Pin ' + esc(cur.app)}</span></button>` : ''}
        <span class="comp-spacer"></span>
        <button class="comp-icon-btn" data-action="comp-apps-refresh" title="Refresh previews">${IC('ico:reload')}</button>
        <button class="comp-icon-btn" data-action="comp-apps-close" title="Close">${IC('ico:close')}</button>
      </div>
      <div class="comp-apps-strip">${cards}</div>
    </div>${grip}`;
    setHTML('#p-companion', html);
    return;
  }
  let clsName = `${DAYS_SHORT[t.getDay()]}, ${MONTHS[t.getMonth()].slice(0, 3)} ${t.getDate()}`, leftTxt = '';
  let agItems = [], curStep = 0;
  if (ctx.mode === 'class' && ctx.cls) {
    clsName = ctx.cls.name || 'Class';
    curStep = agendaStep(ctx, t);
    const ag = ctx.cls.agenda || [];
    for (let i = curStep; i < Math.min(ag.length, curStep + 5); i++) {
      if (ag[i]?.text) agItems.push({ idx: i, text: ag[i].text, min: ag[i].min || 0, isNow: i === curStep, offset: i - curStep });
    }
    if (ctx.period) leftTxt = `${fmtDur(ctx.period.endAt - t)} left`;
  } else if (ctx.next) {
    clsName = ctx.next.cls.name || 'Next class';
    agItems.push({ idx: 0, text: `Starts ${fmtHM(ctx.next.start)}`, min: 0, isNow: true, offset: 0 });
    leftTxt = `in ${fmtDur(ctx.next.startAt - t)}`;
  }
  const timers = P.timers.filter(x => !x.doneAt).slice(0, 2).map((tm, idx) => {
    const rem = timerLeft(tm);
    return `<span class="comp-timer ${idx > 0 ? 'extra' : ''}">⏱ ${fmtDur(rem)}</span>`;
  }).join('');
  const sig = P.signal ? `<span class="comp-sig" style="background:${P.signal.color}">${esc(P.signal.text)}</span>` : '';
  const pins = pinnedApps();
  const hasAgendaNav = ctx.mode === 'class' && (ctx.cls?.agenda?.length || 0) > 1;
  const agendaHTML = agItems.length
    ? agItems.map(it => {
        const clsTier = it.offset === 0 ? 'comp-ag-now' : it.offset === 1 ? 'comp-ag-next1' : it.offset === 2 ? 'comp-ag-next2' : it.offset === 3 ? 'comp-ag-next3' : 'comp-ag-next4';
        const badge = it.offset === 0 ? '<span class="comp-now-tag">NOW</span>' : it.offset === 1 ? '<span class="comp-next-tag">NEXT</span>' : `<span class="comp-num-tag">${it.idx + 1}.</span>`;
        return `<div class="comp-ag-line ${clsTier}" title="${esc(it.text)}">${badge}<span class="comp-ag-txt">${it.offset <= 1 ? `${it.idx + 1}. ` : ''}${esc(it.text)}</span>${it.min ? `<span class="comp-ag-min">${it.min}m</span>` : ''}</div>`;
      }).join('')
    : `<div class="comp-ag-line comp-ag-now comp-ag-empty"><span class="comp-ag-txt">No agenda items for ${esc(clsName)}</span></div>`;
  const html = `<div class="comp-row1">
      <button class="comp-back" data-action="companion-exit" title="Return to Rehearsal">↩ <span class="comp-back-full">Rehearsal</span><span class="comp-back-short">Back</span></button>
      <button class="comp-apps-btn" data-action="comp-apps-toggle" title="Switch or pin External Apps">${IC('ico:app')}<span class="comp-apps-lbl">Apps</span>${pins.length ? `<span class="comp-cnt">${pins.length}</span>` : ''}</button>
      <span class="comp-cls" title="${esc(clsName)}">${esc(clsName)}</span>
      <div class="comp-meta">${timers}${sig}<span class="comp-clock">${fmtClock(t)}</span>${leftTxt ? `<span class="comp-left-t">${esc(leftTxt)}</span>` : ''}</div>
    </div>
    <div class="comp-agenda">
      <div class="comp-agenda-list">${agendaHTML}</div>
      ${hasAgendaNav ? `<div class="comp-ag-nav"><button data-action="agenda-prev" title="Previous agenda step">‹</button><button data-action="agenda-next" title="Next agenda step">›</button></div>` : ''}
    </div>${grip}`;
  setHTML('#p-companion', html);
}

function tick() {
  if (VIEW !== 'present' || !$('#present')) return;
  const t = now();
  runAutomations(t);
  const ctx = context(t);
  const root = $('#present');
  applyTheme(root, ctx.mode === 'class' ? ctx.cls.theme : (ctx.next?.cls?.theme || S.classes[0]?.theme));
  root.classList.toggle('companion', !!P.companion);
  if (P.companion) {
    renderCompanionBar(ctx, t);
    tickTimers(); tickNoise(); syncNative();
    return;
  }

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
  if (layoutKey !== P.layoutKey) { stopMusicHosts(); P.layoutKey = layoutKey; P.sideKey = P.stageKey = ''; P.lastStageId = null; buildLayout(ctx); }
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
  const anyTool = Object.keys(P.tools).length || P.ink.on || P.winMenu || WIN.drag || P.dockCustom || P.dockMore || DOCKDRAG || P.editMode || P.iconsOpen || P.tour != null;
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
      <main class="p-stage" id="p-stage"><div class="stage-tabs" id="stage-tabs"></div><div class="stage-webbar" id="stage-webbar" hidden></div><div class="stage-content" id="stage-content"></div></main>`;
    applySide(ctx.cls);
  } else {
    body.className = 'p-body full'; body.style.gridTemplateColumns = '';
    body.innerHTML = `<div class="p-stage" id="p-stage" style="background:transparent;border:none"><div class="center-screen" id="center" style="flex:1"></div></div>`;
  }
  saveInk(); P.inkKey = ctx.key; restoreInk();
}

// the class's Progress tracker as a small card in the side panel (click to open the full tracker)
// ▾ on the card expands it to show every step with its check box (click a box to tick it off).
function sideProgCard(cls) {
  const items = cls.progress || [], exp = !!cls.sideProgOpen;
  return `<div class="p-card side-prog ${exp ? 'exp' : ''}" data-action="wm-prog" title="Open the Progress tracker"><h4>Progress <span class="mini-btns"><button data-action="side-prog-exp" title="${exp ? 'Show less' : 'Show the steps and check boxes'}">${exp ? '▴' : '▾'}</button></span></h4>${items.length ? `<ul>${items.map(it => {
    const st = it.steps || [], d = st.filter(x => x.done).length;
    return `<li title="${esc(progLabel(cls, it.status))}"><div class="sp-row"><i class="light ${it.status}"></i><span class="sp-t">${esc(it.title || 'Untitled')}</span>${st.length ? `<span class="sp-bar" title="${d}/${st.length} steps"><i style="width:${Math.round(d / st.length * 100)}%"></i></span>` : ''}</div>${exp && st.length ? `<div class="sp-steps">${st.map(s => `<button class="sp-step ${s.done ? 'done' : ''}" data-action="side-prog-chk" data-iid="${it.id}" data-sid="${s.id}" title="${s.done ? 'Mark not done' : 'Mark done'}"><span class="sp-box">${s.done ? '✓' : ''}</span><span>${esc(s.text || 'Step')}</span></button>`).join('')}</div>` : ''}</li>`; }).join('')}</ul>` : '<div style="opacity:.7">Nothing yet. Click to add pieces.</div>'}</div>`;
}
function updateClassBody(ctx, t) {
  const cls = ctx.cls, step = agendaStep(ctx, t);
  const evs = eventsOn(t, ctx.cls);
  const pubNote = (cls.screenNotes || {})[dateKey(t)]?.trim() || '';
  const progSide = cls.sideProgress ? [!!cls.sideProgOpen, (cls.progress || []).map(i => [i.title, i.status, (i.steps || []).map(x => [x.text, !!x.done])])] : null;
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
  const isAppTab = IS_NATIVE && typeof sel === 'string' && sel.startsWith('app:');
  const activeAppKey = isAppTab ? sel.slice(4) : '';
  const activeExtApp = isAppTab ? findStageExternalApp(activeAppKey) : null;
  if (isAppTab && !activeExtApp) sel = 'warmup';
  // warm-up tab removed for this class: show the first tab instead
  if (!activeExtApp && cls.hideWarmup && !cls.resources.some(r => r.id === sel)) sel = cls.resources[0]?.id || 'warmup';
  const res = activeExtApp ? null : cls.resources.find(r => r.id === sel);
  const pinnedSig = IS_NATIVE ? pinnedApps().map(p => [appKey(p), p.app, !!p.appIcon]) : [];
  const dockSig = activeExtApp ? [activeAppKey, P.dockedApp?.status || '', P.dockedApp?.title || '', isAppPinned(activeExtApp)] : null;
  const stageKey = JSON.stringify([sel, res && [res.id, res.url, res.fileId, res.mode, !!res.sight, !!res.music, !!res.widget, !!res.filesBrowser, res.native, !!res.markupMode], cls.warmup, cls.resources.map(r => [r.id, r.title, r.group || '', r.icon || '']), (cls.groups || []).map(g => [g.id, g.name]), !!P.editMode, !!P.stageMax, !!cls.hideWarmup, pinnedSig, dockSig]);
  if (stageKey !== P.stageKey && !ieFocused('#stage-content')) {
    const prevStageId = P.lastStageId;
    P.lastStageId = sel;
    P.stageKey = stageKey;
    if (prevStageId && prevStageId !== sel) {
      stopMusicHosts();
      if (typeof prevStageId === 'string' && prevStageId.startsWith('app:') && !activeExtApp) {
        undockStageApp(true);
      }
    }
    const nat = res && res.url ? isNativeWeb(res) : false;
    const isSlides = res && res.url && resKind(res) === 'slides';
    const isPresenting = isSlides && res.mode === 'present';
    $('#stage-tabs').innerHTML = `
      <div class="stage-tabs-scroll">
        ${cls.hideWarmup ? '' : `<span class="tabwrap"><button class="${!res && !activeExtApp ? 'on' : ''}" data-action="stage" data-id="warmup">${iconOn('tabs') ? icoSp(icoCfg().kind?.warmup ?? 'ico:warmup') : ''}Warm-up</button><button class="tab-x" data-action="warmup-hide" title="Remove the warm-up tab from this class">${IC('ico:close')}</button></span>`}
        ${stageTabsHTML(cls, res)}
        ${IS_NATIVE ? stageExternalAppTabsHTML(activeAppKey) : ''}
      </div>
      <div class="stage-tabs-end">
        <button class="zoom-badge" data-action="stage-zoom-reset" title="Pinch to zoom · click to reset" hidden>100%</button>
        ${isPresenting ? `<button class="mode on" data-action="stage-slideshow" title="Exit Google Slides slideshow">Exit slideshow</button>` : ''}
        <button class="stage-max" data-action="stage-max" title="${P.stageMax ? 'Back to normal size' : 'Maximize (markup tools still work)'}">${IC(P.stageMax ? 'ico:restore' : 'ico:maximize')}</button>
      </div>`;
    const sc = $('#stage-content');
    const keepSight = prevStageId === sel && res && res.sight && sc.querySelector('.stage-sr');
    if (!keepSight) {
      if (sc.querySelector('.sr-host, .score-host')) stopMusicHosts();
      if (activeExtApp) {
        sc.innerHTML = dockedStageHTML(activeExtApp);
      } else if (res && res.filesBrowser) {
        sc.innerHTML = `<div class="files-host stage-files" data-files-win="res-${res.id}"></div>`;
      } else if (res && res.sight) {
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
        else if (k === 'audio') sc.innerHTML = `<div class="aud-host" data-aud-file="${res.fileId}"></div>`;
        else if (k === 'missing') sc.innerHTML = `<div class="res-fallback">This file is missing. Re-add it in Setup → Classes.</div>`;
        else if (k === 'pdf') sc.innerHTML = `<div class="pdf-host" data-pdf-res="${res.id}"></div>`;
        else sc.innerHTML = `<iframe src="${src}"></iframe>`;
      } else if (nat) {
        sc.innerHTML = `<div class="stage-native"></div>`;          // the real browser view shows through here
      } else {
        const src = resTargetURL(res);
        sc.innerHTML = `<iframe src="${esc(src)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        const ifr = sc.querySelector('iframe');
        if (ifr && IS_NATIVE && !res.markupMode) {
          ifr.addEventListener('error', () => {
            if (!isNativeWeb(res)) { res.native = true; P.forceStageUrl = res.id; save(); P.stageKey = ''; WIN.lastSync = ''; tick(); }
          }, { once: true });
        }
      }
      mountSightHosts(sc);
    }
    setTimeout(() => {
      applyStageZoom();
      if (activeExtApp) syncDockedApp(prevStageId !== sel);
    }, 20);
  }
  const wb = $('#stage-webbar');
  if (wb) {
    if (activeExtApp) {
      wb.hidden = false;
      const pinned = isAppPinned(activeExtApp);
      const subTitle = P.dockedApp?.title && P.dockedApp.title !== activeExtApp.app ? P.dockedApp.title : (activeExtApp.title && activeExtApp.title !== activeExtApp.app ? activeExtApp.title : '');
      const barHTML = `<div class="swb-app-info">${activeExtApp.appIcon ? `<img class="swb-app-ic" src="${activeExtApp.appIcon}" alt="">` : IC('ico:app')}<b>${esc(activeExtApp.app || 'External App')}</b>${subTitle ? `<span class="swb-app-sub">${esc(subTitle)}</span>` : ''}</div>
        <div class="swb-acts">
          <button class="mode" data-action="dock-realign" title="Snap this app window cleanly inside Rehearsal's stage">${IC('ico:maximize')} Re-align</button>
          <button class="mode" data-action="dock-float" title="Switch to full-screen app with Rehearsal floating Mini-HUD">${IC('ico:app')} Float Mini-HUD</button>
          <button class="mode ${pinned ? 'on' : ''}" data-action="dock-pin" data-key="${esc(activeAppKey)}" title="${pinned ? 'Unpin from workspace tabs' : 'Pin to workspace tabs'}">${IC('ico:pin')} ${pinned ? 'Pinned' : 'Pin tab'}</button>
        </div>`;
      if (wb._h !== barHTML) { wb.innerHTML = barHTML; wb._h = barHTML; }
    } else if (res && res.url && res.mode !== 'present') {
      wb.hidden = false;
      const nav = WIN.nav['stage-' + res.id] || {};
      const nat = isNativeWeb(res);
      const isSlides = resKind(res) === 'slides';
      const drawingOn = !!res.markupMode || (!nat && P.ink.on && !P.ink.interact);
      const drawBtn = IS_NATIVE
        ? `<button class="mode ${drawingOn ? 'on' : ''}" data-action="web-markup-toggle" data-target="stage" data-id="${res.id}" title="${drawingOn ? 'Exit drawing mode and return to crisp Full browser' : 'Switch to annotation mode so you can draw on top of this page'}">${IC('ico:pen')} ${drawingOn ? 'Done drawing' : 'Draw on page'}</button>`
        : '';
      const actsHTML = `${isSlides ? `<button class="mode" data-action="stage-slideshow" title="Play Google Slides as a live slideshow inside Rehearsal">Slideshow</button>` : ''}${drawBtn}<button data-action="stage-reload" title="Reload">${IC('ico:reload')}</button>${isGoogle(res) && IS_NATIVE ? `<button data-action="open-drive" data-url="${esc(res.url)}" title="Open in the Google Drive window">Drive window</button>` : ''}<button data-action="open-external" data-url="${esc(res.url)}" title="Open in your web browser">${IC('ico:external')}</button>`;
      const inp = wb.querySelector('.stage-url');
      if (!inp || inp.dataset.surl !== res.id) {
        wb._h = '';
        wb.innerHTML = `<button class="swb-nav" data-action="stage-back" ${nav.back ? '' : 'disabled'} title="Back">‹</button><button class="swb-nav" data-action="stage-fwd" ${nav.forward ? '' : 'disabled'} title="Forward">›</button><input class="stage-url" data-surl="${res.id}" placeholder="Search Google or enter a web address…" value="${esc(res.url)}" spellcheck="false"><div class="swb-acts">${actsHTML}</div>`;
        const a = wb.querySelector('.swb-acts'); if (a) a._h = actsHTML;
      } else {
        if (document.activeElement !== inp && inp.value !== res.url) inp.value = res.url;
        const b = wb.querySelector('[data-action="stage-back"]'), f = wb.querySelector('[data-action="stage-fwd"]');
        if (b) b.disabled = !nav.back;
        if (f) f.disabled = !nav.forward;
        const a = wb.querySelector('.swb-acts');
        if (a && a._h !== actsHTML) { a.innerHTML = actsHTML; a._h = actsHTML; }
      }
    } else {
      wb.hidden = true;
      wb.innerHTML = '';
      wb._h = '';
    }
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
const TOUR_SAMPLE_WIN = {
  id: '__tour_win', kind: 'tour', customTitle: 'Sample Window — Pin (📌) to Class or Tile (▦)',
  x: 0.34, y: 0.16, w: 0.48, h: 0.42, z: 999, __tourSample: true,
};
const winKeyOf = ctx => ctx.mode === 'class' ? ctx.cls.id : '_free';
function curWinKey() { return winKeyOf(context(now())); }
function winList(key = curWinKey()) { S.windows ||= {}; return (S.windows[key] ||= []); }
const findWin = id => (P.tourWin && id === '__tour_win') ? TOUR_SAMPLE_WIN : winList().find(w => w.id === id);
const topZ = list => list.reduce((m, w) => Math.max(m, w.z || 0), 0);
function winRes(w) { if (w.kind !== 'res') return null; for (const c of S.classes) { const r = c.resources.find(x => x.id === w.resId); if (r) return r; } return null; }
function winURL(w) { if (w.kind === 'web') return w.url || ''; const r = winRes(w); return r?.url || ''; }
function findRes(id) { if (P.tourSampleCls) { const r = (P.tourSampleCls.resources || []).find(x => x.id === id); if (r) return r; } for (const c of S.classes) { const r = c.resources.find(x => x.id === id); if (r) return r; } return null; }
function mountSightHosts(root = document) {
  if (typeof mountScore === 'function') {
    for (const h of root.querySelectorAll('[data-score-win]')) { const w = findWin(h.dataset.scoreWin); if (w?.score) mountScore(h, w.score, () => save(), 'w' + w.id); }
    for (const h of root.querySelectorAll('[data-score-res]')) { const r = findRes(h.dataset.scoreRes); if (r?.score) mountScore(h, r.score, () => save(), 'r' + r.id + (h.closest('#stage-content') ? 's' : 'w')); }
  }
  if (typeof mountSight !== 'function') return;
  for (const h of root.querySelectorAll('[data-sr-win]')) { const w = findWin(h.dataset.srWin); if (w) { w.sr ||= srDefaults(); mountSight(h, w.sr, () => save()); } }
  for (const h of root.querySelectorAll('[data-sr-res]')) { const r = findRes(h.dataset.srRes); if (r?.sight) mountSight(h, r.sight, () => save()); }
  if (typeof mountPdf === 'function') {
    for (const h of root.querySelectorAll('[data-pdf-res]')) { const r = findRes(h.dataset.pdfRes); if (r?.fileId) mountPdf(h, fileDirectURL(r.fileId), (r.pdf ||= {}), () => save(), pdfInkOpts(r.fileId, { res: r })); }
    for (const h of root.querySelectorAll('[data-pdf-win]')) {
      const w = findWin(h.dataset.pdfWin); if (!w) continue;
      const fid = w.kind === 'file' ? w.fileId : winRes(w)?.fileId; if (fid) mountPdf(h, fileDirectURL(fid), (w.pdf ||= {}), () => save(), pdfInkOpts(fid, { win: w }));
    }
  }
  mountWidgets(root);
  if (typeof mountFilesBrowser === 'function') for (const h of root.querySelectorAll('[data-files-win]')) mountFilesBrowser(h);
  if (typeof mountAudioPlayer === 'function') for (const h of root.querySelectorAll('[data-aud-file]')) mountAudioPlayer(h, h.dataset.audFile);
  if (typeof mountTuner === 'function') for (const h of root.querySelectorAll('[data-mu-win]')) {
    const id = h.dataset.muWin; let kind, st;
    if (h.dataset.muRes) { const r = findRes(h.dataset.muRes); if (!r?.music) continue; kind = r.music.kind; st = (r.music.mu ||= muDefaults(kind)); }   // pinned to a class
    else { const w = findWin(id); if (!w) continue; w.mu ||= muDefaults(w.kind); kind = w.kind; st = w.mu; }
    (kind === 'tuner' ? mountTuner : mountMetronome)(h, st, () => save(), id);
  }
}
// ============================================================ calendar & progress windows
const WIDGETS = { cal: { title: 'Calendar', icon: 'ico:events' }, prog: { title: 'Progress', icon: 'ico:gauge' }, rec: { title: 'Recorder', icon: 'ico:mic' }, yt: { title: 'YouTube', icon: 'ico:youtube' }, piano: { title: 'Piano & Warm-up', icon: 'ico:piano' }, solboard: { title: 'Solfege board', icon: 'ico:ladder' } };
const WG_RENDER = k => ({ cal: renderCal, prog: renderProg, rec: renderRec, yt: renderYt, piano: typeof renderPiano === 'function' ? renderPiano : null, solboard: typeof renderSolBoard === 'function' ? renderSolBoard : null })[k];
const widgetHost = (kind, cls = '') => `<div class="wg-host ${cls}" data-wg="${kind}"></div>`;
function mountWidgets(root = document) { for (const h of root.querySelectorAll('.wg-host')) WG_RENDER(h.dataset.wg)?.(h); }
// Re-render keeps each widget's scroll position (rebuilding the HTML would otherwise jump to the top).
function refreshWidgets(kind) { document.querySelectorAll(`.wg-host[data-wg="${kind}"]`).forEach(h => keepScroll(h, () => WG_RENDER(kind)(h))); }
function refreshRhythmCounts() {
  if (typeof SP_CACHE !== 'undefined') for (const c of Object.values(SP_CACHE)) c.drawLabels?.();
  if (typeof refreshWidgets === 'function') refreshWidgets('piano');
  if (typeof mountSightHosts === 'function') {
    for (const h of document.querySelectorAll('.sr-host')) {
      const sel = h.querySelector('select[data-k="rhythmSystem"]'); if (sel) sel.value = S.settings.rhythmSystem || 'numbers';
    }
    // re-render open sight-reading hosts cleanly
    for (const h of document.querySelectorAll('[data-sr-win]')) { const w = findWin(h.dataset.srWin); if (w?.sr) mountSight(h, w.sr, () => save()); }
    for (const h of document.querySelectorAll('[data-sr-res]')) { const r = findRes(h.dataset.srRes); if (r?.sight) mountSight(h, r.sight, () => save()); }
  }
}
function keepScroll(h, fn) {
  const inner = [...h.querySelectorAll('*')].filter(x => x.scrollTop > 0).map(x => [x.className, x.scrollTop]);
  const top = h.scrollTop, left = h.scrollLeft;
  fn();
  h.scrollTop = top; h.scrollLeft = left;
  for (const [c, t] of inner) { try { const x = c && typeof c === 'string' && h.querySelector('.' + c.trim().split(/\s+/).map(CSS.escape).join('.')); if (x) x.scrollTop = t; } catch { } }
}

// Re-render every open copy of a widget, keeping the cursor in the field you were typing in.
function refreshWidgetsKeep(kind) {
  const a = document.activeElement, host = a?.closest?.('.wg-host');
  const key = host && a.dataset?.f ? { f: a.dataset.f, id: a.closest('[data-id]')?.dataset.id, s: a.selectionStart } : null;
  refreshWidgets(kind);
  if (!key) return;
  const sel = `[data-f="${key.f}"]`, el = [...host.querySelectorAll(sel)].find(x => (x.closest('[data-id]')?.dataset.id) === key.id);
  if (el) { el.focus({ preventScroll: true }); try { if (key.s != null) el.setSelectionRange(key.s, key.s); } catch {} }
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
    const hide = S.settings.calHide || {};
    const evs = eventsOn(d, cls || undefined).filter(e => !hide[e.kind || 'event']), note = cls?.screenNotes?.[k]?.trim();
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
      <span class="grow"></span><span class="cal-show" title="Choose what shows on the month (the day panel still lists everything)">${[['announcement', 'Announcements'], ['event', 'Events'], ['birthday', 'Birthdays']].map(([kd, l]) => `<button data-calhide="${kd}" class="${(S.settings.calHide || {})[kd] ? '' : 'on'}">${IC(EVENT_ICON[kd])} ${l}</button>`).join('')}</span>${off ? '<button data-cal="0">Today</button>' : ''}</div>
    <div class="cal-grid" style="grid-template-rows: auto repeat(${weeks}, minmax(0, 1fr))">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="cal-w">${w}</div>`).join('')}${cells}</div>
    <div class="cal-key">Click a day to add events or change it. Grey days have no school.</div></div>
    ${sel ? calDayPanel(sel, cls) : ''}</div>`;

  h.onclick = e => {
    const hb = e.target.closest('[data-calhide]');
    if (hb) { e.stopPropagation(); const hd = (S.settings.calHide ||= {}), kd = hb.dataset.calhide; hd[kd] = !hd[kd]; save(); return refreshWidgetsKeep('cal'); }
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
    if (act === 'del') {
      const ev = S.events.find(x => x.id === id);
      if (ev && evRepeat(ev) && !confirm(`Remove “${ev.title || 'this'}” on every day it repeats? (Use “Skip this day” to remove just one day.)`)) return;
      S.events = S.events.filter(x => x.id !== id);
    }
    if (act === 'skip') { const ev = S.events.find(x => x.id === id); if (ev) (ev.skip ||= []).push(k); }
    calChanged(h);
  };
  h.onchange = e => {
    const el = e.target, f = el.dataset.f; if (!f) return;
    const k = h.__sel, ev = S.events.find(x => x.id === el.closest('[data-id]')?.dataset.id);
    if (f === 'tmpl') { if (el.value === '') delete S.overrides[k]; else S.overrides[k] = el.value; }
    else if (f === 'label') { const m = calDays()[k] ||= {}; m.label = el.value.trim(); if (!m.label) delete m.label; if (!m.color && !m.label) delete calDays()[k]; }
    else if (f === 'note') { if (!cls) return; const n = (cls.screenNotes ||= {}); if (el.value.trim()) n[k] = el.value; else delete n[k]; }
    else if (ev && f === 'who') ev.classes = el.value ? [el.value] : [];
    else if (ev && f === 'repeat') { ev.repeat = el.value; ev.yearly = el.value === 'yearly'; }
    else if (ev && f === 'until') { if (el.value) ev.until = el.value; else delete ev.until; }
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
      <div class="cal-er2">${kindSel(e)}<input type="time" data-f="time" value="${e.time || ''}" title="Time (optional)">${whoSel(e)}${repeatSel(e, 'data-f="repeat"')}</div>
      ${evRepeat(e) ? `<div class="cal-er2"><label title="Last day it repeats (empty = forever)">until <input type="date" data-f="until" value="${e.until || ''}"></label>${e.date !== k ? `<button data-cd="skip" title="Take only this day out of the series">Skip this day</button>` : ''}</div>` : ''}</div>`).join('')
      || '<div class="cal-none">Nothing on this day.</div>'}
    <div class="cal-adds"><button data-cd="add" data-kind="event">${IC('ico:plus')} Event</button><button data-cd="add" data-kind="announcement">${IC('ico:plus')} Announcement</button><button data-cd="add" data-kind="birthday">${IC('ico:plus')} Birthday</button></div>
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
  const keepTop = h.scrollTop;
  const lights = it => ['red', 'yellow', 'green'].map(k => `<button class="pick ${k} ${it.status === k ? 'on' : ''}" data-pg="set" data-s="${k}"><i class="light ${k}"></i>${L(k)}</button>`).join('');
  h.innerHTML = `<div class="prog">
    <div class="prog-top">${['green', 'yellow', 'red'].map(k => `<span class="prog-sum"><i class="light ${k}"></i>${L(k)} <b>${count(k)}</b></span>`).join('')}
      <span class="grow"></span><button data-pg="side" class="${cls.sideProgress ? 'on' : ''}" title="Show this list in the class's side panel">Side panel</button><button data-pg="labels" class="${h.__labels ? 'on' : ''}" title="Rename the three colours">Labels</button><button class="prog-add" data-pg="add">${IC('ico:plus')} Add</button></div>
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
          <button class="prog-addstep" data-pg="addstep">${IC('ico:plus')} Step</button></div>
          <textarea class="prog-notes" data-f="notes" rows="1" placeholder="Notes: what still needs to be done…">${esc(it.notes || '')}</textarea>` : ''}
        ${steps.length && done === steps.length && it.status !== 'green' ? `<div class="prog-hint">All steps are checked off. <button data-pg="set" data-s="green">Mark “${L('green')}”</button></div>` : ''}
      </div></div>`; }).join('')
      || `<div class="prog-empty">Nothing yet. Press ＋ Add for each piece you're working on, add the steps it needs and check them off as you go. Click the light to change its colour.</div>`}</div></div>`;
  h.querySelectorAll('.prog-notes').forEach(fitNotes);
  h.scrollTop = keepTop;
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
      save(); renderProg(h); h.querySelector(`[data-sid="${s.id}"] input`)?.focus({ preventScroll: true }); refreshOthers(h); return;
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
    h.innerHTML = `<div class="yt"><form class="yt-bar"><input data-yt-url placeholder="Search YouTube, or paste a link…" enterkeyhint="search"><button>${IC('ico:play')} Go</button><button type="button" data-yt="side" title="Search results, recent and playlists">${IC('ico:scroll')}</button></form>
      <div class="yt-main"><div class="yt-player"></div><div class="yt-side"></div></div></div>`;
    h.querySelector('form').onsubmit = e => {
      e.preventDefault(); const inp = h.querySelector('[data-yt-url]'), raw = inp.value.trim(); if (!raw) return;
      const v = ytParse(raw);
      if (v) { inp.value = ''; return ytPlay(h, v, null); }
      ytSearch(h, raw);
    };
    h.onclick = e => ytClick(h, e);
    h.onchange = e => {
      if (e.target.dataset.yt === 'pick') { h.__tab = 'list'; h.__showList = e.target.value; h.__sel = null; renderYtSide(h); }
      if (e.target.dataset.yt === 'auto') { h.__auto = e.target.checked; }
      if (e.target.dataset.yt === 'chk') { ytToggleSel(h, e.target.closest('[data-k]')?.dataset.k, e.target.checked); }
    };
    h.onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.yt === 'newname') { e.preventDefault(); h.querySelector('[data-yt="pnew"]')?.click(); } };
    if (d.last && !h.__cur) { h.__cur = { ...d.last }; const box = h.querySelector('.yt-player'); box.innerHTML = `<button class="yt-resume" data-yt="resume">${d.last.id ? `<img src="${ytThumb(d.last)}" alt="">` : ''}<span>${IC('ico:play')} ${esc(d.last.title || 'Play the last video')}</span></button>`; }
    else if (!d.last) h.querySelector('.yt-player').innerHTML = `<div class="yt-empty">${IC('ico:youtube')}<div>Search or paste a YouTube link above.<br><small>Videos you play are kept under Recent. Make playlists to switch between them in class.</small></div></div>`;
  }
  h.querySelector('.yt').classList.toggle('side-off', !!h.__sideOff);
  renderYtSide(h);
}
// Search YouTube from the window (Mac app: through Rehearsal's own helper; browser/iPad: opens YouTube's search)
async function ytSearch(h, q) {
  if (!HAS_SERVER) {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    native('openExternal', { url }) || window.open(url, '_blank');
    return toast('Search opened in YouTube. Copy the video’s link and paste it here.', 4000);
  }
  h.__tab = 'search'; h.__results = null; h.__q = q; h.__sel = null; h.__sideOff = false; renderYt(h);
  try {
    const r = await fetch('/api/ytsearch?q=' + encodeURIComponent(q), { headers: { 'X-Token': TOKEN } });
    const list = r.ok ? await r.json() : [];
    if (h.__q !== q) return;                                    // a newer search replaced this one
    h.__results = list.map(x => ({ id: x.id, title: x.title, len: x.len, ch: x.ch }));
  } catch { h.__results = []; }
  renderYtSide(h);
}
// the videos shown in the side panel's current tab
function ytTabItems(h) {
  const d = ytData(), tab = h.__tab || 'recent';
  if (tab === 'search') return h.__results || [];
  if (tab === 'recent') return d.recent;
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  return show ? show.items : [];
}
function ytToggleSel(h, k, on) {
  if (!k) return; const s = (h.__sel ||= new Set());
  if (on ?? !s.has(k)) s.add(k); else s.delete(k);
  renderYtSide(h);
}
function renderYtSide(h) {
  const side = h.querySelector('.yt-side'); if (!side) return;
  const d = ytData(), tab = h.__tab || 'recent', cur = h.__cur, curK = cur && ytKey(cur);
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  const sel = h.__sel, selMode = !!sel, inList = tab === 'list';
  const keepTop = side.querySelector('.yt-list')?.scrollTop || 0;
  const item = (v, i) => {
    const k = ytKey(v), on = sel?.has(k);
    return `<div class="yt-item ${k === curK && (!inList || h.__list === show?.id) ? 'cur' : ''} ${on ? 'sel' : ''}" data-k="${esc(k)}" data-i="${i}">
      ${selMode ? `<label class="yt-chk" title="Select"><input type="checkbox" data-yt="chk" ${on ? 'checked' : ''}></label>` : ''}
      <button class="yt-th" data-yt="${selMode ? 'tsel' : 'play'}">${v.id ? `<img src="${ytThumb(v)}" alt="" loading="lazy">` : IC('ico:youtube')}${v.len ? `<i class="yt-len">${esc(v.len)}</i>` : ''}</button>
      <button class="yt-t" data-yt="${selMode ? 'tsel' : 'play'}">${esc(v.title || (v.id ? 'Video ' + v.id : 'YouTube playlist'))}${v.ch ? `<small>${esc(v.ch)}</small>` : ''}</button>
      ${selMode ? '' : `<span class="yt-acts">${inList ? `<button data-yt="up" title="Move up" aria-label="Move up">${IC('ico:up')}</button><button data-yt="add1" title="Add to another playlist" aria-label="Add to another playlist">${IC('ico:plus')}</button><button data-yt="rm1" title="Remove from playlist" aria-label="Remove from playlist">${IC('ico:close')}</button>`
        : `<button data-yt="add1" title="Add to a playlist" aria-label="Add to a playlist">${IC('ico:plus')}</button>${tab === 'recent' ? `<button data-yt="rm1" title="Remove from Recent" aria-label="Remove from Recent">${IC('ico:close')}</button>` : ''}`}</span>`}</div>`;
  };
  const items = ytTabItems(h);
  const listBody = tab === 'search'
    ? (h.__results == null ? '<div class="yt-none">Searching…</div>' : items.map(item).join('') || '<div class="yt-none">No videos found. Try other words.</div>')
    : tab === 'recent' ? items.map(item).join('') || '<div class="yt-none">Nothing yet.</div>'
    : show ? items.map(item).join('') || '<div class="yt-none">Empty. Add videos with ＋ from Search or Recent.</div>' : '<div class="yt-none">No playlists yet. Press ＋ New.</div>';
  const n = sel?.size || 0;
  side.innerHTML = `
    <div class="yt-tabs">${h.__results || tab === 'search' ? `<button data-yt="tab" data-v="search" class="${tab === 'search' ? 'on' : ''}" title="${esc(h.__q || '')}">Search</button>` : ''}<button data-yt="tab" data-v="recent" class="${tab === 'recent' ? 'on' : ''}">Recent</button><button data-yt="tab" data-v="list" class="${tab === 'list' ? 'on' : ''}">Playlists</button></div>
    ${h.__list && cur ? `<div class="yt-now">${IC('ico:play')} <span>${esc(d.lists.find(l => l.id === h.__list)?.name || '')}</span><button data-yt="prev" title="Previous">${IC('ico:chevleft')}</button><button data-yt="next" title="Next">${IC('ico:chevright')}</button><label title="Play the next video when one ends"><input type="checkbox" data-yt="auto" ${h.__auto !== false ? 'checked' : ''}> auto</label></div>` : ''}
    ${cur && !selMode ? `<button class="yt-addcur" data-yt="addcur">${IC('ico:plus')} Add this video to a playlist</button>` : ''}
    ${inList ? `<div class="yt-lhead">${d.lists.length ? `<select data-yt="pick">${d.lists.map(l => `<option value="${l.id}" ${l === show ? 'selected' : ''}>${esc(l.name)} (${l.items.length})</option>`).join('')}</select>` : ''}<button data-yt="lnew">${IC('ico:plus')} New</button>${show ? `<button data-yt="lplayall" title="Play from the start">${IC('ico:play')}</button><button data-yt="lren" title="Rename">${IC('ico:edit')}</button><button data-yt="ldel" title="Delete playlist">${IC('ico:trash')}</button>` : ''}</div>` : ''}
    ${tab === 'search' && h.__q ? `<div class="yt-q">Results for “${esc(h.__q)}”</div>` : ''}
    ${items.length ? `<div class="yt-selbar">${selMode
      ? `<button data-yt="selall">${n === items.length ? 'None' : 'All'}</button><span class="grow">${n} selected</span><button data-yt="seladd" ${n ? '' : 'disabled'}>${IC('ico:plus')} Add to playlist</button>${tab !== 'search' ? `<button data-yt="selrm" ${n ? '' : 'disabled'} title="${inList ? 'Remove from this playlist' : 'Remove from Recent'}">${IC('ico:trash')}</button>` : ''}<button data-yt="seldone">Done</button>`
      : `<span class="grow"></span><button data-yt="selon" title="Select several videos to add or remove them together">${IC('ico:check')} Select</button>${tab === 'recent' ? '<button data-yt="rclear">Clear recent</button>' : ''}`}</div>` : ''}
    <div class="yt-list">${listBody}</div>
    ${h.__picker ? ytPickerHTML(h) : ''}`;
  const L = side.querySelector('.yt-list'); if (L) L.scrollTop = keepTop;
  if (h.__picker && h.__picker.focusNew) { h.__picker.focusNew = false; side.querySelector('[data-yt="newname"]')?.focus(); }
}
// "Add to playlist": pick an existing playlist (✓ = already has all of them) or type a name for a new one
function ytPickerHTML(h) {
  const d = ytData(), vs = h.__picker.items, ks = vs.map(ytKey);
  const has = l => ks.every(k => l.items.some(x => ytKey(x) === k));
  return `<div class="yt-picker"><div class="yt-pk-head"><b>Add ${vs.length === 1 ? 'this video' : vs.length + ' videos'} to…</b><button data-yt="pclose" title="Close">${IC('ico:close')}</button></div>
    <div class="yt-pk-list">${d.lists.map(l => `<button data-yt="padd" data-l="${l.id}" class="${has(l) ? 'has' : ''}"><span>${esc(l.name)}</span><small>${l.items.length}</small>${has(l) ? IC('ico:check') : ''}</button>`).join('') || '<div class="yt-none">No playlists yet: make one below.</div>'}</div>
    <div class="yt-pk-new"><input data-yt="newname" placeholder="New playlist name…"><button data-yt="pnew">${IC('ico:plus')} Create</button></div></div>`;
}
function ytAddTo(h, l, vs) {
  let added = 0;
  for (const v of vs) { if (l.items.some(x => ytKey(x) === ytKey(v))) continue; const n = { ...v }; delete n.at; l.items.push(n); added++; }
  for (const v of vs) if (!v.title) ytTitle(v).then(t => { if (!t) return; for (const x of l.items) if (ytKey(x) === ytKey(v)) x.title = t; save(); refreshWidgets('yt'); });
  h.__picker = null; h.__sel = null; save();
  toast(added ? `Added ${added === 1 ? '1 video' : added + ' videos'} to “${l.name}”.` : `Already in “${l.name}”.`);
  refreshWidgets('yt');
}
function ytClick(h, e) {
  const b = e.target.closest('[data-yt]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return; e.stopPropagation();
  const d = ytData(), act = b.dataset.yt, row = b.closest('[data-i]'), i = row ? +row.dataset.i : -1, tab = h.__tab || 'recent';
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  const items = ytTabItems(h), v = i >= 0 ? items[i] : null;
  const selected = () => items.filter(x => h.__sel?.has(ytKey(x)));
  if (act === 'side') { h.__sideOff = !h.__sideOff; return renderYt(h); }
  if (act === 'resume') return ytPlay(h, d.last, null);
  if (act === 'tab') { h.__tab = b.dataset.v; h.__sel = null; h.__picker = null; return renderYtSide(h); }
  if (act === 'play' && v) return ytPlay(h, v, tab === 'list' ? show.id : null);
  if (act === 'tsel' && v) return ytToggleSel(h, ytKey(v));
  if (act === 'lplayall' && show?.items.length) return ytPlay(h, show.items[0], show.id);
  if (act === 'prev' || act === 'next') return ytStep(h, act === 'next' ? 1 : -1);
  // selecting several
  if (act === 'selon') { h.__sel = new Set(); h.__picker = null; return renderYtSide(h); }
  if (act === 'seldone') { h.__sel = null; h.__picker = null; return renderYtSide(h); }
  if (act === 'selall') { h.__sel = h.__sel?.size === items.length ? new Set() : new Set(items.map(ytKey)); return renderYtSide(h); }
  // add to a playlist (one video, the playing one, or the selection)
  if (act === 'addcur' && h.__cur) { h.__picker = { items: [h.__cur] }; return renderYtSide(h); }
  if (act === 'add1' && v) { h.__picker = { items: [v] }; return renderYtSide(h); }
  if (act === 'seladd') { const vs = selected(); if (vs.length) h.__picker = { items: vs }; return renderYtSide(h); }
  if (act === 'pclose') { h.__picker = null; return renderYtSide(h); }
  if (act === 'padd' && h.__picker) { const l = d.lists.find(x => x.id === b.dataset.l); if (l) ytAddTo(h, l, h.__picker.items); return; }
  if (act === 'pnew' && h.__picker) {
    const inp = h.querySelector('[data-yt="newname"]'), name = inp?.value.trim();
    if (!name) { h.__picker.focusNew = true; renderYtSide(h); return toast('Type a name for the new playlist.'); }
    let l = d.lists.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) d.lists.push(l = { id: uid(), name, items: [] });
    return ytAddTo(h, l, h.__picker.items);
  }
  // remove
  if (act === 'rm1' && v) { if (tab === 'list' && show) show.items.splice(i, 1); else if (tab === 'recent') d.recent.splice(i, 1); }
  if (act === 'selrm') {
    const ks = new Set(selected().map(ytKey)); if (!ks.size) return;
    if (tab === 'list' && show) show.items = show.items.filter(x => !ks.has(ytKey(x)));
    else if (tab === 'recent') d.recent = d.recent.filter(x => !ks.has(ytKey(x)));
    h.__sel = new Set();
  }
  if (act === 'rclear' && confirm('Clear the recently watched list?')) d.recent = [];
  // playlists
  if (act === 'lnew') { h.__tab = 'list'; h.__picker = null; const n = prompt('Name for the new playlist:', ''); if (!n?.trim()) return renderYtSide(h); const l = { id: uid(), name: n.trim(), items: [] }; d.lists.push(l); h.__showList = l.id; }
  if (act === 'lren' && show) { const n = prompt('Rename the playlist:', show.name); if (n?.trim()) show.name = n.trim(); }
  if (act === 'ldel' && show && confirm(`Delete the playlist “${show.name}”? (The videos stay in Recent.)`)) { d.lists = d.lists.filter(l => l !== show); h.__showList = null; if (h.__list === show.id) h.__list = null; }
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
    REC.meter = { stream, an, openedAt: Date.now() }; refreshRec();
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
const REC_WARM_MS = 1200;   // how long a freshly opened microphone gets to reach its level before recording
async function recBegin() {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return toast('Recording is not supported here.');
  playAu().pause(); closePlayer();
  const o = recOpts();
  let stream, openedAt;
  // A microphone that has just been switched on starts quiet and takes a moment to reach its level
  // (the device and macOS settle its gain). Reuse the stream from "Check mic level" when we can, and
  // otherwise let a new one warm up before recording starts, so the first notes aren't too soft.
  if (REC.meter && !o.aec && REC.meter.stream.getAudioTracks().some(t => t.readyState === 'live')) { stream = REC.meter.stream; openedAt = REC.meter.openedAt || 0; REC.meter = null; }
  else {
    if (REC.meter) recMeter(false);
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: !!o.aec, noiseSuppression: false, autoGainControl: false } }); }
    catch { return toast('Rehearsal needs the microphone to record. Allow it and try again.'); }
    openedAt = Date.now();
  }
  if (ac().state === 'suspended') await ac().resume();
  REC.stream = stream;
  const warm = Math.max(0, openedAt + REC_WARM_MS - Date.now()) / 1000;   // seconds still needed
  if (o.count === 'none') {
    if (warm <= 0.05) return recGo();
    REC.state = 'countin'; REC.warm = true; refreshRec();
    REC.countT = setTimeout(() => { REC.warm = false; if (REC.state === 'countin') recGo(); }, warm * 1000);
    return;
  }
  // count-in: one bar of clicks, then recording starts (the click can keep going with "count + click");
  // if the mic still needs to warm up, the count-in starts a little later so recording begins after it
  const { tempo, beats } = recTempo(), c = ac(), beat = 60 / tempo, t0 = c.currentTime + Math.max(0.15, warm - beats * beat);
  REC.warm = false;
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
  if (st === 'countin') top = `<div class="rec-live rec-count"><div>${REC.warm ? 'Getting the microphone ready…' : 'Get ready…'}</div><b>${REC.warm ? '…' : 1}</b><button data-rc="stop">Cancel</button></div>`;
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
        ${o.count !== 'none' ? metVolSlider('Click volume') : ''}
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
  if (w.kind === 'piano') return 'Piano & Warm-up';
  if (w.kind === 'solboard') return 'Solfege board';
  if (w.kind === 'prog') { const c = currentClass(); return 'Progress' + (c ? ' — ' + c.name : ''); }
  if (w.kind === 'app') return (w.appName || 'App') + (w.title ? ' — ' + w.title : '');
  if (w.kind === 'warmup') return 'Warm-up';
  if (w.kind === 'files') return 'Files';
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
  if (w.kind === 'files') return 'ico:folder';
  if (w.kind === 'file') { const r = { fileId: w.fileId }; return kindIcon(resKind(r)); }
  if (w.kind === 'res') { const r = winRes(w); return r ? resIcon(r) : 'ico:warn'; }
  return 'ico:web';
}
function addWindow(w, size) {
  const list = winList();
  const front = list.length ? list.reduce((a, b) => (b.z || 0) > (a.z || 0) ? b : a) : null;
  const ww = size?.w || 0.56, hh = size?.h || 0.78;
  let x = 0.04, y = 0.03;
  if (front && !front.max) {
    x = front.x + 0.045; y = front.y + 0.05;
    if (x + ww > 0.98) x = 0.04;
    if (y + hh > 0.98) y = 0.03;
  } else if (list.length) {
    const n = list.length;
    x = 0.04 + 0.045 * (n % 5); y = 0.03 + 0.05 * (n % 5);
  }
  Object.assign(w, { id: uid(), x: clamp(x, 0.01, Math.max(0.01, 0.98 - ww)), y: clamp(y, 0.01, Math.max(0.01, 0.98 - hh)), w: ww, h: hh, z: topZ(list) + 1 });
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
function winIsNative(w) {
  if (!IS_NATIVE || !w) return false;
  const target = winRes(w) || w;
  if (target.markupMode) return false;
  const u = winURL(w);
  if (resKind({ url: u }) === 'slides' && target.mode === 'present') return false;
  if (w.native != null) return !!w.native;
  return !!u && autoNativeWeb(u);
}
function winTargetURL(w) {
  const r = winRes(w), u = winURL(w);
  if (!u) return '';
  const target = r || w;
  if (resKind({ url: u }) === 'slides' && target.mode === 'present') return slidesPresentURL(u);
  if (target.mode === 'edit') return editURL(embedURL(u));
  if (winIsNative(w)) return resKind({ url: u }) === 'slides' ? editURL(u) : u;
  return embedURL(u);
}
function winBodyHTML(w) {
  if (w.id === '__tour_win') return `<div class="win-start"><div><b>Floating Window Preview</b><br><span style="font-size:13px;color:#6b7385">Use <b>Pin</b> (${IC('ico:pin')}) in the top bar to save any tool or web page as a class tab, or <b>Tile</b> (${IC('ico:tile')}) to snap it to part of the screen.</span></div></div>`;
  if (winIsNative(w)) return '';
  if (w.kind === 'sight') return `<div class="sr-host" data-sr-win="${w.id}"></div>`;
  if (w.kind === 'score') return `<div class="score-host" data-score-win="${w.id}"></div>`;
  if (w.kind === 'res' && winRes(w)?.score) return `<div class="score-host" data-score-res="${w.resId}"></div>`;
  if (w.kind === 'tuner' || w.kind === 'metro') return `<div class="mu-host" data-mu-win="${w.id}"></div>`;
  if (WIDGETS[w.kind]) return widgetHost(w.kind);
  if (w.kind === 'res' && winRes(w)?.widget) return widgetHost(winRes(w).widget.kind);
  if (w.kind === 'res' && winRes(w)?.music) return `<div class="mu-host" data-mu-win="r-${w.resId}-w${w.id}" data-mu-res="${w.resId}"></div>`;
  if (w.kind === 'res' && winRes(w)?.sight) return `<div class="sr-host" data-sr-res="${w.resId}"></div>`;
  if (w.kind === 'warmup') { const cls = currentClass(); return `<div class="warmup"><div class="lbl">Warm-up question</div><div class="q">${esc(cls?.warmup || 'Welcome!')}</div></div>`; }
  if (w.kind === 'files') return `<div class="files-host" data-files-win="${w.id}"></div>`;
  if (w.kind === 'res' && winRes(w)?.filesBrowser) return `<div class="files-host" data-files-win="res-${w.resId}-w${w.id}"></div>`;
  if (w.kind === 'file' || (w.kind === 'res' && winRes(w)?.fileId)) {
    const fid = w.kind === 'file' ? w.fileId : winRes(w).fileId, k = resKind({ fileId: fid }), src = fileDirectURL(fid);
    if (k === 'image') return `<img src="${src}">`;
    if (k === 'video') return `<video src="${src}" controls style="background:#000"></video>`;
    if (k === 'audio') return `<div class="aud-host" data-aud-file="${fid}"></div>`;
    if (k === 'missing') return `<div class="win-start">This file is missing.</div>`;
    if (k === 'pdf') return `<div class="pdf-host" data-pdf-win="${w.id}"></div>`;
    return `<iframe src="${src}"></iframe>`;
  }
  const url = winURL(w);
  if (!url) return `<div class="win-start"><div>${IC('ico:web')}<br>Type a web address or a search above and press Return.${IS_NATIVE ? '<br><span style="font-size:13px;color:#888">Searches open in full browser mode.</span>' : ''}</div></div>`;
  const src = winTargetURL(w);
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
  const nat = winIsNative(w), isSlides = !!url && resKind({ url }) === 'slides', slideMode = (winRes(w) || w).mode;
  const pinned = ['res', 'warmup'].includes(w.kind);
  const nav = WIN.nav[w.id] || {};
  return `<div class="win ${nat ? 'native' : ''}" data-win="${w.id}">
    <div class="win-bar" data-wdrag="${w.id}">
      <span class="wi">${winIcon(w)}</span>
      ${nat ? `<button data-action="win-back" data-id="${w.id}" ${nav.back ? '' : 'disabled'} title="Back">‹</button><button data-action="win-fwd" data-id="${w.id}" ${nav.forward ? '' : 'disabled'} title="Forward">›</button>` : ''}
      ${w.kind === 'web' ? `<input class="win-url" data-wurl="${w.id}" value="${esc(w.url || '')}" placeholder="Search or type a web address" spellcheck="false">` : `<span class="win-title">${esc(winTitle(w))}</span>`}
      ${url || w.kind === 'file' ? `<button data-action="win-reload" data-id="${w.id}" title="Reload">${IC('ico:reload')}</button>` : ''}
      ${isSlides ? `<button class="mode ${slideMode === 'present' ? 'on' : ''}" data-action="win-slideshow" data-id="${w.id}" title="Play Google Slides as a live slideshow inside Rehearsal">${slideMode === 'present' ? 'Exit slideshow' : 'Slideshow'}</button>` : ''}
      ${canNative ? `<button class="mode ${(winRes(w) || w).markupMode ? 'on' : ''}" data-action="web-markup-toggle" data-target="win" data-id="${w.id}" title="${(winRes(w) || w).markupMode ? 'Exit drawing mode and return to crisp Full browser' : 'Draw on top of this page'}">${IC('ico:pen')} ${(winRes(w) || w).markupMode ? 'Done' : 'Draw'}</button>` : ''}
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
  const key = winKeyOf(ctx), baseList = winList(key);
  const list = P.tourWin ? [...baseList, TOUR_SAMPLE_WIN] : baseList;
  // re-render only when the set of windows or their content changes (keeps iframes alive)
  const sig = key + '|' + !!P.tourWin + '|' + JSON.stringify(S.bookmarks || []).length + '|' + JSON.stringify(list.map(w => [w.id, w.kind, winIsNative(w), winIsNative(w) ? '' : winURL(w), w.fileId, w.resId, w.kind === 'warmup' ? ctx.cls?.warmup : '', (winRes(w) || w).mode, winTitle(w)]));
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
  const baseList = winList(), list = P.tourWin ? [...baseList, TOUR_SAMPLE_WIN] : baseList, top = topZ(list);
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
  if (w.id === '__tour_win') return;
  if (w.kind === 'piano') window.__spaceTarget = 'piano';
  else if (w.kind === 'sight') window.__spaceTarget = 'sr';
  else if (w.kind === 'score') window.__spaceTarget = 'sp';
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
function openStageAddress(resId, raw) {
  const res = findRes(resId); if (!res) return;
  let q = String(raw || '').trim(); if (!q) return;
  const looksURL = /^https?:\/\//i.test(q) || (/^[^\s]+\.[a-z]{2,}([\/?#:].*)?$/i.test(q) && !q.includes(' '));
  let url;
  if (looksURL) url = /^https?:\/\//i.test(q) ? q : 'https://' + q;
  else { url = 'https://www.google.com/search?q=' + encodeURIComponent(q); if (IS_NATIVE && !res.native) res.native = true; }
  if (!IS_NATIVE && !looksURL) { native('openExternal', { url }) || window.open(url, '_blank'); return; }
  res.url = url;
  if (res.mode === 'present' && resKind(res) !== 'slides') res.mode = 'embed';
  P.forceStageUrl = res.id;
  const targetUrl = resTargetURL(res);
  if (isNativeWeb(res)) native('webCmd', { id: 'stage-' + res.id, action: 'load', url: targetUrl });
  save(); P.stageKey = ''; WIN.sig = ''; WIN.lastSync = ''; document.activeElement?.blur();
  const ifr = $('#stage-content iframe');
  if (ifr && !isNativeWeb(res)) ifr.src = targetUrl;
  tick();
}
function renderWebModeMenu() {
  $('#web-mode-menu')?.remove();
  const cfg = P.webModeMenu; if (!cfg || VIEW !== 'present') return;
  let nat = false, btn = null;
  if (cfg.target === 'stage') {
    const r = findRes(cfg.id); if (!r) { P.webModeMenu = null; return; }
    nat = isNativeWeb(r);
    btn = $(`#stage-webbar [data-action="web-mode-menu"][data-id="${cfg.id}"]`);
  } else {
    const w = findWin(cfg.id); if (!w) { P.webModeMenu = null; return; }
    nat = winIsNative(w);
    btn = $(`.win[data-win="${cfg.id}"] [data-action="web-mode-menu"]`);
  }
  if (!btn) { P.webModeMenu = null; return; }
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div');
  m.id = 'web-mode-menu';
  m.className = 'web-mode-menu';
  m.innerHTML = `<div class="wmm-head"><b>Display mode</b><button class="wmm-x" data-action="web-mode-close" title="Close">${IC('ico:close')}</button></div>
    <button class="wmm-opt ${!nat ? 'on' : ''}" data-action="web-mode-set" data-target="${cfg.target}" data-id="${cfg.id}" data-native="0">
      <div class="wmm-t"><b>Embedded</b>${!nat ? '<span class="wmm-badge">Active</span>' : ''}</div>
      <div class="wmm-d">Fast lightweight frame inside Rehearsal. Drawing &amp; markup tools work on top. Best for simple pages &amp; slide previews.</div>
    </button>
    <button class="wmm-opt ${nat ? 'on' : ''}" data-action="web-mode-set" data-target="${cfg.target}" data-id="${cfg.id}" data-native="1">
      <div class="wmm-t"><b>Full browser</b>${nat ? '<span class="wmm-badge">Active</span>' : ''}</div>
      <div class="wmm-d">Real browser window with full sign-in &amp; crisp zoom. Use for Google Docs/Sheets or sites that block embedding or look blurry. (Drawing overlay disabled.)</div>
    </button>`;
  $('#present').appendChild(m);
  m.style.left = clamp(r.right - m.offsetWidth, 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = clamp(r.bottom + 6 + m.offsetHeight < innerHeight - 8 ? r.bottom + 6 : r.top - m.offsetHeight - 6, 8, innerHeight - m.offsetHeight - 8) + 'px';
}
window.__webNav = ({ id, url, title, back, forward }) => {
  WIN.nav[id] = { back, forward };
  if (typeof id === 'string' && id.startsWith('stage-')) {
    const rid = id.slice(6), r = findRes(rid);
    const keepSlidesUrl = r && r.mode === 'present' && resKind(r) === 'slides' && (url === slidesPresentURL(r.url) || /\/(embed|present|preview)(\?|$)/.test(url || ''));
    if (r && url && url !== 'about:blank' && !keepSlidesUrl) { r.url = url; save(); }
    const wb = $('#stage-webbar');
    if (wb) {
      const inp = wb.querySelector(`.stage-url[data-surl="${rid}"]`);
      if (inp && document.activeElement !== inp && url && url !== 'about:blank') inp.value = keepSlidesUrl ? r.url : url;
      const b = wb.querySelector('[data-action="stage-back"]'), f = wb.querySelector('[data-action="stage-fwd"]');
      if (b) b.disabled = !back; if (f) f.disabled = !forward;
    }
    return;
  }
  const w = findWin(id); if (!w) return;
  const target = winRes(w) || w;
  const keepWinSlidesUrl = target.mode === 'present' && resKind({ url: winURL(w) }) === 'slides' && (url === slidesPresentURL(winURL(w)) || /\/(embed|present|preview)(\?|$)/.test(url || ''));
  if (url && url !== 'about:blank' && w.kind === 'web' && !keepWinSlidesUrl) w.url = url;
  if (title) w.title = title;
  save();
  const el = $(`.win[data-win="${id}"]`); if (!el) return;
  const inp = el.querySelector('.win-url'); if (inp && document.activeElement !== inp) inp.value = w.url || '';
  const b = el.querySelector('[data-action="win-back"]'), f = el.querySelector('[data-action="win-fwd"]');
  if (b) b.disabled = !back; if (f) f.disabled = !forward;
};
// ---------- other apps' windows & pinned apps with previews (done natively)
const pinnedApps = () => (S.pinnedApps ||= []);
const appKey = a => String(a?.bundleId || a?.app || '').trim().toLowerCase();
const isAppPinned = a => { const k = appKey(a); return !!k && pinnedApps().some(p => appKey(p) === k); };
function syncPinnedAppMeta(wins) {
  let changed = false;
  for (const p of pinnedApps()) {
    const k = appKey(p), live = (wins || []).find(w => appKey(w) === k);
    if (!live) continue;
    if (live.appIcon && live.appIcon !== p.appIcon) { p.appIcon = live.appIcon; changed = true; }
    if (live.preview && live.preview !== p.preview) { p.preview = live.preview; changed = true; }
    if (live.title && live.title !== p.title) { p.title = live.title; changed = true; }
    if (live.app && live.app !== p.app) { p.app = live.app; changed = true; }
  }
  if (changed) save();
}
function togglePinApp(a) {
  const k = appKey(a); if (!k) return;
  const list = pinnedApps(), idx = list.findIndex(p => appKey(p) === k);
  if (idx >= 0) { list.splice(idx, 1); toast(`Unpinned ${a.app || 'app'}`); }
  else {
    list.push({ app: a.app || '', bundleId: a.bundleId || '', title: a.title || '', appIcon: a.appIcon || '', preview: a.preview || '' });
    toast(`Pinned ${a.app || 'app'}`);
  }
  save();
  P.stageKey = '';
  if (P.winMenu) renderWinMenu();
  if (VIEW === 'present') tick();
}
function findStageExternalApp(key) {
  if (!key) return null;
  if (P.dockedApp && appKey(P.dockedApp) === key) {
    const live = (P.lastApps || []).find(w => appKey(w) === key);
    return live ? { ...P.dockedApp, ...live, appIcon: live.appIcon || P.dockedApp.appIcon, preview: live.preview || P.dockedApp.preview } : P.dockedApp;
  }
  const p = pinnedApps().find(x => appKey(x) === key);
  if (p) {
    const live = (P.lastApps || []).find(w => appKey(w) === key);
    return live ? { ...p, ...live, appIcon: live.appIcon || p.appIcon, preview: live.preview || p.preview } : p;
  }
  return (P.lastApps || []).find(w => appKey(w) === key) || null;
}
function stageExternalAppTabsHTML() {
  const seen = new Set(), items = [];
  for (const p of pinnedApps()) {
    const k = appKey(p); if (!k || seen.has(k)) continue;
    seen.add(k); items.push({ ...p, key: k });
  }
  return items.map(a => `<span class="tabwrap tab-ext-app"><button data-action="stage-app" data-key="${esc(a.key)}" title="Switch to ${esc(a.app)} with floating Agenda Mini-HUD">${a.appIcon ? `<img class="tab-app-ic" src="${a.appIcon}" alt="">` : IC('ico:app')}${esc(a.app || 'App')}</button><button class="tab-x" data-action="stage-app-close" data-key="${esc(a.key)}" title="Unpin app from workspace tabs">${IC('ico:close')}</button></span>`).join('');
}
function dockedStageHTML() { return ''; }
function dockStageApp(a) { launchCompanionApp(a); }
function syncDockedApp() { }
function undockStageApp() { }
window.__dockAppState = () => { };
function launchCompanionApp(a) {
  if (!a) return;
  const live = (P.lastApps || []).find(w => appKey(w) === appKey(a)) || a;
  const target = {
    app: live.app || a.app || '', bundleId: live.bundleId || a.bundleId || '',
    pid: live.pid || a.pid || 0, hwnd: live.hwnd || a.hwnd || 0,
    title: live.title || a.title || '', appIcon: live.appIcon || a.appIcon || '', preview: live.preview || a.preview || '',
  };
  if (!target.pid && !target.hwnd && target.bundleId) native('launchApp', { bundleId: target.bundleId });
  P.appPick = null; P.winMenu = false; P.compAppsOpen = false; P.compAppsHover = false;
  renderWinMenu(); renderDock();
  P.companion = { appName: target.app, bundleId: target.bundleId, title: target.title, appIcon: target.appIcon, preview: target.preview, pid: target.pid, hwnd: target.hwnd };
  native('companionStart', { app: target.app, bundleId: target.bundleId, pid: target.pid, hwnd: target.hwnd });
  native('listAppWindows');
  tick();
}
function appThumbHTML(a) {
  if (a.appIcon) return `<div class="app-thumb-sm"><img class="app-ic" src="${a.appIcon}" alt=""></div>`;
  if (a.preview) return `<div class="app-thumb-sm has-prev"><img class="app-prev" src="${a.preview}" alt=""></div>`;
  return `<div class="app-thumb-sm"><span class="app-ic-svg">${IC('ico:app')}</span></div>`;
}
function appCardHTML(a, idx, isPinnedList) {
  const pinned = isAppPinned(a), k = appKey(a), sub = a.title && a.title !== a.app ? a.title : '';
  const act = isPinnedList ? `data-action="wm-pin-app" data-key="${esc(k)}"` : `data-action="wm-app" data-i="${idx}"`;
  return `<div class="app-card ${pinned ? 'is-pinned' : ''}">
    <button class="app-card-go" ${act} title="Switch to ${esc(a.app)} with floating Agenda Mini-HUD${sub ? ' — ' + esc(sub) : ''}">
      ${appThumbHTML(a)}
      <div class="app-card-meta"><span class="app-card-name">${esc(a.app || 'App')}</span>${sub ? `<span class="app-card-sub">${esc(sub)}</span>` : ''}</div>
    </button>
    <button class="app-pin-btn ${pinned ? 'on' : ''}" data-action="app-pin" data-key="${esc(k)}" ${isPinnedList ? '' : `data-i="${idx}"`} title="${pinned ? 'Unpin from workspace tabs' : 'Pin to workspace tabs'}">${IC('ico:pin')}<span>${pinned ? 'Pinned' : 'Pin'}</span></button>
  </div>`;
}
function appPickerHTML() {
  const pins = pinnedApps(), a = P.appPick;
  const pinSec = pins.length ? `<div class="wm-h">Pinned External Apps (also in workspace tabs)</div><div class="app-cards">${pins.map((p, i) => appCardHTML(p, i, true)).join('')}</div>` : '';
  if (!a) return pinSec;
  if (a === 'loading') return `${pinSec}<div class="wm-h">Looking for External Apps…</div>`;
  const wins = a.windows || [];
  return `${pinSec}<div class="wm-h">External Apps — opens with floating Agenda Mini-HUD</div>${wins.length ? `<div class="app-cards">${wins.map((w, i) => appCardHTML(w, i, false)).join('')}</div>` : '<div class="wm-note">No other open apps found.</div>'}`;
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
    P.lastApps = data.windows;
    syncPinnedAppMeta(data.windows);
    if (P.companion?.appName) {
      const m = data.windows.find(w => appKey(w) === appKey({ app: P.companion.appName, bundleId: P.companion.bundleId }));
      if (m) {
        if (m.appIcon) P.companion.appIcon = m.appIcon;
        if (m.preview) P.companion.preview = m.preview;
        if (m.title) P.companion.title = m.title;
      }
    }
  }
  P.appPick = data;
  if (P.winMenu) renderWinMenu();
  if (P.companion) tick();
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
  if (box.querySelector('.sr-host, .sp-root')) { st.zoom = 1; st.zx = 0; st.zy = 0; }
  const z = st.zoom || 1, tf = z === 1 ? '' : `translate(${(st.zx || 0) * 100}%, ${(st.zy || 0) * 100}%) scale(${z})`;
  for (const m of box.querySelectorAll(':scope > iframe, :scope > img, :scope > video, :scope > img.res')) {
    if (z === 1) { m.style.transform = ''; m.style.transformOrigin = ''; }
    else { m.style.transformOrigin = '0 0'; m.style.transform = tf; }
  }
  for (const t of box.querySelectorAll('.warmup, .win-start')) t.style.zoom = z === 1 ? '' : z;
  for (const s of box.querySelectorAll('.sr-staff')) s.style.zoom = '';
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
  const el = $(`.win[data-win="${w.id}"]`); if (!el) return;
  if (winIsNative(w)) {
    native('webCmd', { id: w.id, action: 'zoom', zoom: w.zoom || 1 });
  } else {
    zoomApply(el.querySelector('.win-body'), w);
  }
  const badge = el.querySelector('.zoom-badge');
  if (badge) { badge.textContent = Math.round((w.zoom || 1) * 100) + '%'; badge.hidden = (w.zoom || 1) === 1; }
}
function applyStageZoom() {
  const box = $('#stage-content'); if (!box) return;
  const st = stageZoomState(), sr = stageNativeRes();
  if (sr) native('webCmd', { id: 'stage-' + sr.id, action: 'zoom', zoom: st.zoom || 1 });
  else zoomApply(box, st);
  const b = $('#stage-tabs .zoom-badge'); if (b) { b.textContent = Math.round((st.zoom || 1) * 100) + '%'; b.hidden = (st.zoom || 1) === 1; }
}
window.__pinch = (x, y, mag, phase) => {
  if (VIEW !== 'present') return;
  const hit = document.elementsFromPoint(x, y).find(el => el !== inkCanvas && el !== inkPrev && el.id !== 'ink' && !el.classList?.contains('ink-cursor'));
  const spRoot = hit?.closest('.sp-root');                // score practice zooms its own music (redrawn sharp)
  if (spRoot?.__zoomBy) { if (phase === 'toggle') spRoot.__zoomToggle?.(); else spRoot.__zoomBy(1 + mag, x, y); return; }
  const srHost = hit?.closest('.sr-host') || hit?.closest('.sr')?.parentElement;
  if (srHost?.__zoomBy) { if (phase === 'toggle') srHost.__zoomToggle?.(); else srHost.__zoomBy(1 + mag); return; }
  const pnHost = hit?.closest('.pn-seq') && hit?.closest('.wg-host');
  if (pnHost?.__pianoZoomBy) { if (phase === 'toggle') pnHost.__pianoZoomBy(1, true); else pnHost.__pianoZoomBy(1 + mag); return; }
  const winEl = hit?.closest('.win'), stageEl = hit?.closest('#stage-content');
  let st, box, after, nat = false;
  if (winEl) { const w = findWin(winEl.dataset.win); if (!w) return; st = w; box = winEl.querySelector('.win-body'); nat = winIsNative(w); after = () => { applyZoom(w); save(); }; }
  else if (stageEl) { st = stageZoomState(); box = stageEl; nat = !!stageNativeRes(); after = applyStageZoom; }
  else return;
  if (phase === 'toggle') { if ((st.zoom || 1) > 1.01) Object.assign(st, { zoom: 1, zx: 0, zy: 0 }); else if (nat) st.zoom = 1.5; else zoomAt(st, box, x, y, 2); }
  else if (nat) st.zoom = clamp((st.zoom || 1) * (1 + mag), 0.5, 3);
  else zoomAt(st, box, x, y, 1 + mag);
  if (Math.abs((st.zoom || 1) - 1) < 0.02 && phase !== 'change') Object.assign(st, { zoom: 1, zx: 0, zy: 0 });
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
      <button class="btn small ic-btn" data-action="bm-add">${IC('ico:plus')} Add</button>
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
      <div class="ag-top"><span class="n" data-action="ag-cur" data-i="${i}" title="Make this the current step">${i + 1}</span>
      <span class="ag-text" contenteditable="true" data-ie="agenda" data-i="${i}">${esc(a.text)}</span></div>
      <div class="ag-meta"><span class="ag-grip" data-ag-drag="${i}" title="Drag to reorder">≡</span>
      <label class="ag-minw"><input class="ag-min" type="number" min="0" max="240" data-ie-min="${i}" value="${a.min || ''}" placeholder="0" title="Minutes"><span>min</span></label>
      <button class="ag-x" data-action="ag-del" data-i="${i}" title="Remove step" aria-label="Remove step">${IC('ico:close')}</button></div></li>`).join('')}</ol>
    <button class="ie-add" data-action="ag-add">${IC('ico:plus')} Add step</button>`;
  const todays = evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ` <span style="opacity:.7">${fmtHM(e.time)}</span>` : ''} <span class="ev-where">${e.classes?.length ? '· this class' : '· all classes'}</span><button class="ag-x" data-action="ie-ev-del" data-id="${e.id}" title="Remove">${IC('ico:close')}</button></li>`).join('');
  return `
    <div class="p-card ie-card"><h4>${IC('ico:quickedit')} Editing ${esc(cls.name)} <button class="ie-done" data-action="edit-mode">Done</button></h4>
      <div class="ie-btns"><button data-action="look-open">${IC('ico:look')} Look & background</button><button data-action="auto-open">${IC('ico:auto')} Automations</button><button data-action="clip-open">${IC('ico:clip')} Copy / paste</button><button data-action="icons-open">${IC('ico:icons')} Icons</button>${ctx.cls.hideWarmup ? `<button data-action="warmup-show">${IC('ico:warmup')} Show warm-up tab</button>` : ''}</div>
      <div class="ie-tip">Click any text to change it.</div></div>
    <div class="p-card"><h4>Agenda <span class="mini-btns"><button data-action="agenda-prev">‹</button><button data-action="agenda-next">›</button></span></h4>${agenda}</div>
    <div class="p-card"><h4>Today</h4><ul class="ev-list">${todays || '<li style="opacity:.6">Nothing today.</li>'}</ul>
      <div class="ie-ev"><select data-ie-evkind><option value="announcement">Announcement</option><option value="birthday">Birthday</option><option value="event">Event</option></select>
        <input data-ie-evtext placeholder="Announcement or name…"><input type="time" data-ie-evtime title="Pop up at (optional)">
        <select data-ie-evwho title="Which classes see it"><option value="this">This class</option><option value="all">All classes</option></select>
        ${repeatSel({}, 'data-ie-evrep')}
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
// events: how often they repeat (Setup → Events)
document.addEventListener('change', e => {
  const id = e.target.dataset?.evRepeat; if (!id) return;
  const ev = S.events.find(x => x.id === id); if (!ev) return;
  ev.repeat = e.target.value; ev.yearly = ev.repeat === 'yearly'; save(); P.sideKey = ''; renderEditor();
});
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
// ---------- copy / paste class items between classes: pinned tabs (with their folders), agenda, warm-up,
// look, Progress tracker, notes on screen, automations and side panel settings. Lists can be added to or replace
// what the class already has.
const clipClass = () => VIEW === 'present' ? ieClass()?.cls : selClass();
// the things that can be copied, besides tabs; `list` ones can be added to the end or replace what's there
const CLIP_KINDS = [
  { k: 'agenda', label: 'Agenda', ico: 'ico:agenda', list: true, has: c => c.agenda.length, n: c => c.agenda.length, unit: 'step' },
  { k: 'warmup', label: 'Warm-up question', ico: 'ico:warmup', has: c => !!c.warmup },
  { k: 'progress', label: 'Progress tracker', ico: 'ico:check', list: true, has: c => (c.progress || []).length, n: c => (c.progress || []).length, unit: 'piece' },
  { k: 'screenNotes', label: 'Notes on screen', ico: 'ico:notes', list: true, has: c => Object.values(c.screenNotes || {}).some(v => v && v.trim()), n: c => Object.values(c.screenNotes || {}).filter(v => v && v.trim()).length, unit: 'day' },
  { k: 'automations', label: 'Automations', ico: 'ico:auto', list: true, has: c => (c.automations || []).length, n: c => (c.automations || []).length, unit: 'automation' },
  { k: 'side', label: 'Side panel settings (width, progress in side panel)', ico: 'ico:agenda', has: () => true },
  { k: 'look', label: 'Look (theme, colours, picture)', ico: 'ico:look', has: () => true },
];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function clipSel(cls) {
  if (!P.clipSel || P.clipSel.cls !== cls.id) {
    P.clipSel = { cls: cls.id, tabs: new Set(cls.resources.map(r => r.id)) };
    for (const d of CLIP_KINDS) P.clipSel[d.k] = d.k !== 'look' && d.k !== 'side' && !!d.has(cls);
  }
  return P.clipSel;
}
function clipSummary(c) {
  const p = [];
  if (c.tabs?.length) p.push(plural(c.tabs.length, 'tab'));
  if (c.agenda) p.push(`agenda (${plural(c.agenda.length, 'step')})`);
  if (c.warmup != null) p.push('warm-up');
  if (c.progress) p.push(`progress (${plural(c.progress.items.length, 'piece')})`);
  if (c.screenNotes) p.push(`notes on screen (${plural(Object.keys(c.screenNotes).length, 'day')})`);
  if (c.automations) p.push(plural(c.automations.length, 'automation'));
  if (c.side) p.push('side panel settings');
  if (c.theme) p.push('look');
  return p.join(', ');
}
// what the copied item conflicts with in this class (shown as Add / Replace choices)
function clipConflicts(cls, c) {
  const out = [];
  if (c.tabs?.length && cls.resources.length) out.push({ k: 'tabs', label: 'Pinned tabs', have: plural(cls.resources.length, 'tab') });
  if (c.agenda && cls.agenda.length) out.push({ k: 'agenda', label: 'Agenda', have: plural(cls.agenda.length, 'step') });
  if (c.progress && (cls.progress || []).length) out.push({ k: 'progress', label: 'Progress tracker', have: plural(cls.progress.length, 'piece') });
  if (c.screenNotes && Object.values(cls.screenNotes || {}).some(v => v && v.trim())) out.push({ k: 'screenNotes', label: 'Notes on screen', have: 'some days', addLabel: 'Keep both (copied days win)' });
  if (c.automations && (cls.automations || []).length) out.push({ k: 'automations', label: 'Automations', have: plural(cls.automations.length, 'automation') });
  return out;
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
  const modes = (P.clipMode ||= {});
  const conf = C ? clipConflicts(cls, C) : [];
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:clip')} Copy / paste — ${esc(cls.name)}</b><span class="grow"></span><button data-action="clip-open">Done</button></div>
    <div class="cp-h">Copy from this class</div>
    <div class="cp-list">
      ${cls.resources.map(r => chk('tab', `${icoSp(resIcon(r))}${esc(r.title || 'Tab')}`, s.tabs.has(r.id), `data-id="${r.id}"`)).join('') || '<div class="dc-note">No pinned tabs.</div>'}
      ${CLIP_KINDS.map(d => chk(d.k, `${IC(d.ico)} ${d.label}${d.n ? ` <span class="muted">(${plural(d.n(cls), d.unit)})</span>` : ''}`, s[d.k], d.has(cls) ? '' : 'disabled')).join('')}
    </div>
    <div class="lp-row"><button data-action="clip-all">Select all</button><button data-action="clip-none">None</button><span class="grow"></span><button class="cp-go" data-action="clip-copy">${IC('ico:clip')} Copy</button></div>
    <div class="cp-h">Paste into this class</div>
    ${C ? `<div class="dc-note">Copied from <b>${esc(C.from)}</b>: ${esc(clipSummary(C)) || 'nothing'}.${C.theme ? ' The look replaces this class’s look.' : ''}${C.warmup != null ? ' The warm-up replaces this class’s warm-up.' : ''}${C.side ? ' Side panel settings replace this class’s.' : ''}</div>
      ${conf.length ? `<div class="cp-modes">${conf.map(x => `<div class="cp-mode"><span><b>${x.label}</b> <span class="muted">(this class has ${x.have})</span></span>
        <label><input type="radio" name="cpm-${x.k}" data-clip-mode="${x.k}" value="add" ${modes[x.k] !== 'replace' ? 'checked' : ''}> ${x.addLabel || 'Add to the end'}</label>
        <label><input type="radio" name="cpm-${x.k}" data-clip-mode="${x.k}" value="replace" ${modes[x.k] === 'replace' ? 'checked' : ''}> Replace</label></div>`).join('')}</div>` : ''}
      <div class="lp-row"><button class="cp-go" data-action="clip-paste">${IC('ico:clip')} Paste</button></div>`
      : `<div class="dc-note">Nothing copied yet. Tick what you want above and press Copy, then switch to another class and paste.</div>`}`;
  document.body.appendChild(p);
  p.addEventListener('change', e => {
    const m = e.target.dataset.clipMode; if (m) { modes[m] = e.target.value; return; }
    const k = e.target.dataset.clip; if (!k) return;
    if (k === 'tab') e.target.checked ? s.tabs.add(e.target.dataset.id) : s.tabs.delete(e.target.dataset.id);
    else s[k] = e.target.checked;
  });
}
function clipSelectAll(on) {
  const c = clipClass(); if (!c) return;
  P.clipSel = { cls: c.id, tabs: new Set(on ? c.resources.map(r => r.id) : []) };
  for (const d of CLIP_KINDS) P.clipSel[d.k] = on && !!d.has(c);
  renderClip();
}
function clipCopy() {
  const cls = clipClass(); if (!cls) return;
  const s = clipSel(cls), clone = o => JSON.parse(JSON.stringify(o));
  const tabs = cls.resources.filter(r => s.tabs.has(r.id)).map(clone);
  const gids = new Set(tabs.map(r => r.group).filter(Boolean));
  const notes = Object.fromEntries(Object.entries(cls.screenNotes || {}).filter(([, v]) => v && v.trim()));
  const c = {
    from: cls.name,
    tabs, groups: (cls.groups || []).filter(g => gids.has(g.id)).map(clone),
    agenda: s.agenda && cls.agenda.length ? clone(cls.agenda) : null,
    warmup: s.warmup && cls.warmup ? cls.warmup : null,
    progress: s.progress && (cls.progress || []).length ? { items: clone(cls.progress), labels: cls.progLabels ? clone(cls.progLabels) : null } : null,
    screenNotes: s.screenNotes && Object.keys(notes).length ? notes : null,
    automations: s.automations && (cls.automations || []).length ? clone(cls.automations) : null,
    side: s.side ? { layout: cls.layout ? clone(cls.layout) : null, sideProgress: !!cls.sideProgress, sideProgOpen: !!cls.sideProgOpen } : null,
    theme: s.look ? clone(cls.theme) : null,
  };
  if (!clipSummary(c)) return toast('Tick at least one thing to copy.');
  S.clip = c; P.clipMode = {}; save(); renderClip();
  toast(`Copied ${clipSummary(c)} from ${cls.name}. Switch class and press Paste.`, 3500);
}
function clipPaste() {
  const cls = clipClass(), c = S.clip; if (!cls || !c) return;
  const clone = o => JSON.parse(JSON.stringify(o)), mode = k => (P.clipMode || {})[k] === 'replace' ? 'replace' : 'add';
  const resMap = {};
  if (c.tabs?.length) {
    // folders come along with their tabs (matched by name if this class already has one)
    const gmap = {};
    if (mode('tabs') === 'replace') { cls.resources = []; cls.groups = []; }
    for (const g of c.groups || []) {
      const have = (cls.groups ||= []).find(x => x.name === g.name);
      if (have) gmap[g.id] = have.id; else { const n = { ...clone(g), id: uid() }; cls.groups.push(n); gmap[g.id] = n.id; }
    }
    for (const r of c.tabs) {
      const n = { ...clone(r), id: uid() }; resMap[r.id] = n.id;
      if (n.group) { if (gmap[n.group]) n.group = gmap[n.group]; else delete n.group; }
      cls.resources.push(n);
    }
  }
  if (c.agenda) { const steps = clone(c.agenda).map(a => (a.id ? { ...a, id: uid() } : a)); cls.agenda = mode('agenda') === 'replace' ? steps : cls.agenda.concat(steps); }
  if (c.warmup != null) cls.warmup = c.warmup;
  if (c.progress) {
    const items = clone(c.progress.items).map(it => ({ ...it, id: uid(), steps: (it.steps || []).map(st => ({ ...st, id: uid() })) }));
    cls.progress = mode('progress') === 'replace' ? items : (cls.progress || []).concat(items);
    if (c.progress.labels) cls.progLabels = clone(c.progress.labels);
  }
  if (c.screenNotes) cls.screenNotes = mode('screenNotes') === 'replace' ? clone(c.screenNotes) : { ...(cls.screenNotes || {}), ...clone(c.screenNotes) };
  if (c.automations) {
    const autos = clone(c.automations).map(a => {
      const n = { ...a, id: uid() };
      if (n.resourceId) n.resourceId = resMap[n.resourceId] || (cls.resources.some(r => r.id === n.resourceId) ? n.resourceId : '');
      return n;
    });
    cls.automations = mode('automations') === 'replace' ? autos : (cls.automations || []).concat(autos);
  }
  if (c.side) {
    if (c.side.layout) cls.layout = clone(c.side.layout); else delete cls.layout;
    cls.sideProgress = c.side.sideProgress; cls.sideProgOpen = c.side.sideProgOpen;
  }
  if (c.theme) cls.theme = clone(c.theme);
  save(); P.stageKey = P.sideKey = P.layoutKey = ''; WIN.sig = '';
  if (VIEW !== 'present') renderEditor(); else applySide(cls);
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
    <div class="lp-row"><label>Class title <input type="color" data-look="titleText" value="${th.titleText || th.text || '#ffffff'}"></label><label>Clock <input type="color" data-look="clockText" value="${th.clockText || th.text || '#ffffff'}"></label>${th.titleText || th.clockText ? `<button type="button" data-action="look-text-reset">Match text</button>` : ''}</div>
    <div class="lp-row"><button data-action="look-pic">${IC('ico:image')} ${img ? 'Change picture…' : 'Use a picture…'}</button>${img ? `<button data-action="look-pic-clear">Remove picture</button>` : ''}</div>
    <label class="lp-dim">Dim background <input type="range" min="0" max="0.85" step="0.05" data-look="dim" value="${th.dim ?? 0.25}"><span>${Math.round((th.dim ?? 0.25) * 100)}%</span></label>
    <label class="lp-dim" data-for="panel">Panel background <input type="range" min="0" max="1" step="0.05" data-look="panel" value="${th.panel ?? 0.1}"><span>${Math.round((th.panel ?? 0.1) * 100)}%</span></label>
    <label class="chk lp-link"><input type="checkbox" data-look-link ${th.sideLinked !== false ? 'checked' : ''}> Side panel matches the other panels</label>
    ${th.sideLinked === false ? `<label class="lp-dim">Side panel text size <input type="range" min="0.6" max="2" step="0.05" data-look="sideFont" value="${th.sideFont ?? 1}"><span>${Math.round((th.sideFont ?? 1) * 100)}%</span></label>
    <label class="lp-dim">Side panel background <input type="range" min="0" max="1" step="0.05" data-look="sidePanel" value="${th.sidePanel ?? th.panel ?? 0.1}"><span>${Math.round((th.sidePanel ?? th.panel ?? 0.1) * 100)}%</span></label>` : ''}
    <div class="dc-note">Dimming darkens the picture; a more solid panel background makes the agenda, Today panel and tabs easier to read over a busy picture. Untick “Side panel matches” to give the side panel its own text size and background.</div>`;
  $('#present').appendChild(p);
  const host = p;
  const NUM = ['dim', 'panel', 'sideFont', 'sidePanel'];
  host.addEventListener('input', e => {
    const k = e.target.dataset.look; if (!k) return;
    th[k] = NUM.includes(k) ? Number(e.target.value) : e.target.value;
    if (NUM.includes(k)) e.target.nextElementSibling.textContent = Math.round(th[k] * 100) + '%';
    applyTheme($('#present'), th);
    save();
  });
  host.addEventListener('change', e => {
    if (!e.target.matches('[data-look-link]')) return;
    if (e.target.checked) delete th.sideLinked;
    else { th.sideLinked = false; th.sideFont ??= 1; th.sidePanel ??= th.panel ?? 0.1; }
    save(); renderLook();
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
  return r && r.url && (any || isNativeWeb(r)) ? r : null;
}
function syncNative() {
  const items = [];
  if (VIEW === 'present' && !P.companion) for (const el of $$('.win.native')) {
    const w = findWin(el.dataset.win); if (!w) continue;
    const r = rectOf(el.querySelector('.win-body'));
    if (r[2] > 0 && r[3] > 0) items.push(w.kind === 'app'
      ? { id: w.id, z: w.z || 0, kind: 'app', windowID: w.windowID || 0, bundleId: w.bundleId, title: w.title || '', rect: r }
      : { id: w.id, z: w.z || 0, url: winTargetURL(w) || 'about:blank', rect: r });
  }
  const sr = VIEW === 'present' && !P.companion ? stageNativeRes() : null, sce = sr && $('#stage-content .stage-native') && $('#stage-content');
  let stageRect = null;
  if (sce) {
    const r = rectOf(sce);
    if (r[2] > 0 && r[3] > 0) {
      stageRect = r;
      (P.keepNative ||= new Set()).add(sr.id);
      const item = { id: 'stage-' + sr.id, z: -1, url: resTargetURL(sr), rect: r };
      if (P.forceStageUrl === sr.id) { item.forceUrl = true; P.forceStageUrl = null; }
      items.push(item);
    }
  }
  // full-browser tabs you've opened stay alive (hidden) when you switch tabs, so videos keep playing
  if (VIEW === 'present' && !P.companion && P.keepNative) for (const id of [...P.keepNative]) {
    if (sr && id === sr.id && stageRect) continue;
    const r = findRes(id);
    if (!r || !isNativeWeb(r) || !r.url) { P.keepNative.delete(id); continue; }
    items.push({ id: 'stage-' + id, z: -2, url: resTargetURL(r), rect: stageRect || [0, 0, 10, 10], hidden: true });
  }
  items.sort((a, b) => a.z - b.z);   // the native side stacks its views in this order
  const drawing = P.ink.on && !P.ink.interact;
  const pass = !drawing && !P.overlay && !WIN.drag;
  const holes = pass ? items.filter(i => !i.hidden).map(i => [...i.rect, i.z]) : [];
  let blockers = [];
  if (pass && items.length) {
    const TOP = 1e9;
    blockers = $$('.tool, .p-timer, .p-dock:not(.hidden), .p-signal.on, .win-menu, .snap-menu, .bm-menu, .web-mode-menu, .dock-custom, .sound-chip, .toast, .group-menu, .look-panel, .auto-drawer, .rename-inline, .ink-bar').map(el => [...rectOf(el), TOP]);
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
  syncDockedApp(false);
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
  const targets = [
    [$('#p-bg'), -Infinity, ''],
    [$('#p-body'), -Infinity, ''],
    [$('#p-stage'), -Infinity, ''],
    [$('#stage-content'), -Infinity, ''],
    ...$$('#p-body .sp-paper, #p-body .sp-score, #p-body .sr-staff, #p-body .pdfv-pages, #p-body .p-side, #p-body iframe, #p-body video, #p-body img.res, #p-body .wg-host, #p-body .mu-host, #p-body .aud-host').map(el => [el, -Infinity, '']),
  ];
  for (const el of $$('.win')) {
    const w = findWin(el.dataset.win);
    if (w) {
      targets.push([el, w.z || 0, w.id]);
      for (const sub of el.querySelectorAll('iframe, video, .sp-paper, .sp-score, .sr-staff, .pdfv-pages')) targets.push([sub, w.z || 0, w.id]);
    }
  }
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
  const lib = Object.entries(S.files).filter(([, f]) => !f.hiddenScore);
  const list = winList();
  const tile = (act, icon, label, extra = '') => `<button class="wm-tile" data-action="${act}" ${extra}>${IC(icon)}<span>${label}</span></button>`;
  const item = (act, id, icon, name) => `<button data-action="${act}" data-id="${id}" data-q="${esc(name.toLowerCase())}">${icoSp(icon)}${esc(name)}</button>`;
  const open = (P.wmOpen ||= { cls: true, lib: false });
  const sec = (key, title, n, body) => `<details class="wm-sec" data-sec="${key}" ${open[key] ? 'open' : ''}><summary>${title}<span class="wm-n">${n}</span></summary><div class="wm-items">${body}</div></details>`;
  const many = (cls ? cls.resources.length + 1 : 0) + lib.length > 8;
  const openTools = (dockCfg().inOpen || []).map(id => [id, DOCK_ITEMS[id]]).filter(([, it]) => it && it.act);
  host.innerHTML = `<div class="win-menu">
    <div class="wm-head">Music</div>
    <div class="wm-grid wm-music">
      ${tile('wm-sight', 'ico:sight', 'Sight reading')}
      ${tile('wm-score', 'ico:score', 'Score practice', 'title="MusicXML / MuseScore"')}
      ${tile('wm-piano', 'ico:piano', 'Piano')}
      ${tile('wm-solboard', 'ico:ladder', 'Solfege board')}
      ${tile('open-music', 'ico:tuner', 'Tuner', 'data-kind="tuner"')}
      ${tile('open-music', 'ico:metro', 'Metronome', 'data-kind="metro"')}
      ${tile('wm-rec', 'ico:mic', 'Recorder')}
    </div>
    <div class="wm-head">Class</div>
    <div class="wm-grid">
      ${tile('wm-cal', 'ico:events', 'Calendar')}
      ${tile('wm-prog', 'ico:gauge', 'Progress')}
      ${tile('wm-yt', 'ico:youtube', 'YouTube')}
    </div>
    ${openTools.length ? `<div class="wm-head">Tools</div>
    <div class="wm-grid">
      ${openTools.map(([id, it]) => {
        const on = it.tool ? !!P.tools[it.tool] : !!it.on?.();
        return `<button class="wm-tile ${on ? 'on' : ''}" data-action="${it.act}" ${it.tool ? `data-tool="${it.tool}"` : ''} ${it.kind ? `data-kind="${it.kind}"` : ''}>${IC(icoCfg().dock?.[id] ?? it.icon)}<span>${esc(it.label)}</span></button>`;
      }).join('')}
    </div>` : ''}
    <div class="wm-head">Open</div>
    <div class="wm-grid">
      ${tile('wm-web', 'ico:web', 'Web page')}
      ${tile('wm-files', 'ico:folder', 'Files', 'title="Search and open any audio, PDF, score, image, or video — pin individual files anytime"')}
      ${tile('wm-file', 'ico:file', 'Import…', `title="Pick a new PDF, audio, score, picture or video from this ${DEVICE}"`)}
      ${IS_NATIVE ? tile('wm-apps', 'ico:app', 'External Apps', 'title="Switch to another app with Rehearsal floating on top"') : ''}
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
  const L = cls.layout || {}, collapsed = !!L.collapsed && P.tour == null;
  const frac = clamp(L.side ?? 0.22, 0.1, 0.6);
  body.classList.toggle('side-collapsed', collapsed);
  body.style.gridTemplateColumns = collapsed ? '0px 1.4em minmax(0, 1fr)' : `${(frac * 100).toFixed(2)}% 1.4em minmax(0, 1fr)`;
  const btn = $('#p-split .p-split-btn'); if (btn) btn.textContent = collapsed ? '›' : '‹';
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
let inkCanvas = null, inkCtx = null, inkDrawing = null, inkUndo = [];
function inkPushUndo() {
  if (!inkCanvas || !inkCanvas.width || !inkCanvas.height) return;
  const c = document.createElement('canvas'); c.width = inkCanvas.width; c.height = inkCanvas.height;
  c.getContext('2d').drawImage(inkCanvas, 0, 0);
  inkUndo.push(c); if (inkUndo.length > 20) inkUndo.shift();
  const ub = $('#ink-bar [data-action="ink-undo"]'); if (ub) ub.disabled = false;
}
function inkDoUndo() {
  if (!inkCanvas || !inkUndo.length) return;
  const prev = inkUndo.pop();
  inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0);
  inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
  inkCtx.drawImage(prev, 0, 0, inkCanvas.width, inkCanvas.height);
  inkCtx.restore(); saveInk();
  const ub = $('#ink-bar [data-action="ink-undo"]'); if (ub) ub.disabled = !inkUndo.length;
}
// Things the pen should never draw over — clicks there go to the control instead.
const INK_UI = 'button, a, input, select, textarea, label, [contenteditable="true"], [data-action], [data-sr], [data-mu], [data-pdf], .win-bar, .win-rs, .stage-tabs, .stage-webbar, .web-mode-menu, .tool, .pdfv-bar, .sr-top, .sr-sub, .sr-settings, .sp-top, .sp-sub, .me-controls, .p-dock, .ink-bar, .dock-custom, .look-panel, .win-menu, .snap-menu, .bm-menu, .win-bm, .p-signal.on, .p-timer, .sound-chip';
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
// The drawing layer steps aside (pointer-events: none) while the pointer is over a button, so it can be
// clicked. A fast move can leave a button and land on embedded slides or a web page before the next
// check runs; that page then gets every mouse event and the pen never came back. Two guards:
const inkArmed = () => VIEW === 'present' && P.ink.on && !P.ink.interact && inkCanvas && !inkDrawing;
const inkInside = e => { const r = $('#ink')?.getBoundingClientRect(); return r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
// 1) as soon as the pointer enters something that isn't a control (an iframe included), the pen is back
document.addEventListener('pointerover', e => {
  if (!inkArmed() || inkCanvas.style.pointerEvents !== 'none' || e.target === inkCanvas) return;
  if (!e.target.closest?.(INK_UI) && inkInside(e)) { inkCanvas.style.pointerEvents = ''; inkPreview(e); }
}, true);
// 2) a press that still slipped past the drawing layer onto the page below starts drawing anyway
document.addEventListener('pointerdown', e => {
  if (!inkArmed() || e.target === inkCanvas || e.button > 0 || !inkInside(e)) return;
  if (e.target.closest?.(INK_UI) || e.target.closest?.('#ink-bar')) return;
  e.preventDefault(); e.stopPropagation();
  inkCanvas.style.pointerEvents = '';
  inkDown(e);
}, true);
// 3) leaving the window / switching apps mid-stroke never leaves the pen stuck "off"
window.addEventListener('blur', () => { if (inkCanvas && P.ink.on && !P.ink.interact) inkCanvas.style.pointerEvents = ''; });
let inkWheelT = 0;
document.addEventListener('wheel', e => {
  if (!inkCanvas || e.target !== inkCanvas || !P.ink.on || P.ink.interact) return;
  inkCanvas.style.pointerEvents = 'none';               // let this scroll gesture reach the page/PDF below
  clearTimeout(inkWheelT); inkWheelT = setTimeout(() => { if (inkCanvas) inkCanvas.style.pointerEvents = ''; }, 350);
}, { capture: true, passive: true });
function setupInk() {
  const host = $('#ink'); if (!host) return;
  document.querySelectorAll('#ink-bar').forEach(b => b.remove());   // a moved (floating) bar from the last screen
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
// Clef outlines from the engraving font bundled in vendor/vexflow.js (y flipped for SVG).
// Units: 360 per staff space; each glyph's origin sits on its clef line (G line / F line).
const CLEF_G = 'M524 363C557 363 595 360 624 354C639 351 642 350 645 367C662 464 684 589 684 657C684 870 540 896 455 896C377 896 340 873 340 854C340 844 353 840 386 829C431 816 482 778 482 694C482 615 432 547 344 547C248 547 190 624 190 713C190 806 246 948 464 948C560 948 747 904 747 660C747 577 721 441 706 351C703 334 704 336 724 327C870 269 966 147 966 -16C966 -200 831 -363 619 -363C582 -363 582 -363 577 -389L541 -598C539 -615 541 -616 550 -625C706 -770 824 -953 824 -1174C824 -1299 789 -1423 730 -1509C708 -1541 671 -1581 655 -1581C635 -1581 590 -1544 562 -1512C455 -1394 420 -1214 420 -1064C420 -981 431 -887 441 -828C444 -811 445 -808 428 -793C220 -622 0 -416 0 -125C0 125 171 363 524 363ZM115 -29C115 -114 130 -228 249 -363C336 -459 402 -513 469 -567C484 -579 487 -577 490 -562L520 -377C524 -350 524 -351 498 -343C372 -300 289 -186 289 -63C289 66 357 158 455 192C467 196 484 200 494 200C505 200 511 193 511 184C511 174 500 170 490 166C429 140 386 78 386 12C386 -71 442 -132 530 -157C553 -163 556 -161 559 -145L631 284C634 300 632 300 611 304C588 308 559 311 530 311C278 311 115 171 115 -29ZM677 -1358C724 -1358 763 -1319 763 -1240C763 -1080 626 -950 513 -851C503 -842 497 -844 494 -863C488 -900 485 -949 485 -995C485 -1220 589 -1358 677 -1358ZM635 -168C752 -158 848 -60 848 66C848 157 793 230 713 271C696 279 693 279 690 262L619 -148C616 -166 618 -170 635 -168Z';
const CLEF_F = 'M12 914C19 914 27 912 36 907C390 734 765 478 765 40C765 -210 612 -377 363 -377C112 -377 0 -194 0 -56C0 59 60 158 177 158C268 158 330 95 330 6C330 -86 262 -144 192 -144C153 -144 138 -134 120 -134C101 -134 96 -145 96 -160C96 -217 183 -323 330 -323C482 -323 549 -173 549 53C549 455 350 680 14 871C1 878 -7 886 -7 897C-7 906 -1 914 12 914ZM906 -101C950 -101 985 -135 985 -180C985 -225 950 -259 906 -259C861 -259 827 -225 827 -180C827 -135 861 -101 906 -101ZM907 258C952 258 985 225 985 180C985 135 952 102 907 102C863 102 829 135 829 180C829 225 863 258 907 258Z';
// Board paper: staff lines (or a grid) drawn as a repeating background, so Clear never erases them.
// Returns the full CSS background. Grand staff adds a second layer (repeating down the left edge only)
// with a brace, the barline joining both staves, a treble clef and a bass clef.
function boardPaper(kind) {
  const svg = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;
  const lines = (ys, w = 10) => ys.map(y => `<rect x='0' y='${y}' width='${w}' height='1.6' fill='#6b7385'/>`).join('');
  const sp = 18;                                              // space between staff lines
  const tiled = url => `${url} 0 0 / auto repeat content-box, #ffffff`;
  if (kind === 'staff') return tiled(svg(10, 4 * sp + 96, lines([0, 1, 2, 3, 4].map(i => 40 + i * sp))));
  if (kind === 'grand') {
    // One wide tile repeated downward only (the right side is clipped at the paper's edge), so the
    // brace and clefs stay inside the paper and never peek out above the first system.
    const a = [0, 1, 2, 3, 4].map(i => 40 + i * sp), b = a.map(y => y + 4 * sp + 64), H = 2 * 4 * sp + 64 + 110, W = 6000;
    const top = a[0], bot = b[4] + 1.6, mid = (top + bot) / 2, h = bot - top;
    const L = 24;                                             // the left barline: where both staves start
    const s = sp / 360, ink = '#3d4452';
    // brace: two thick curves meeting in a point at the middle, thin at both ends
    const bx = 4, bw = 14, X = f => (bx + f * bw).toFixed(1), Y = v => v.toFixed(1);
    const brace = `<path fill='${ink}' d='M${X(1)} ${Y(top)}C${X(0.1)} ${Y(top + h * 0.05)} ${X(1.05)} ${Y(mid - h * 0.14)} ${X(0)} ${Y(mid)}C${X(1.05)} ${Y(mid + h * 0.14)} ${X(0.1)} ${Y(bot - h * 0.05)} ${X(1)} ${Y(bot)}C${X(0.55)} ${Y(bot - h * 0.07)} ${X(1.5)} ${Y(mid + h * 0.1)} ${X(0)} ${Y(mid)}C${X(1.5)} ${Y(mid - h * 0.1)} ${X(0.55)} ${Y(top + h * 0.07)} ${X(1)} ${Y(top)}Z'/>`;
    const bar = `<rect x='${L}' y='${top}' width='2' height='${bot - top}' fill='${ink}'/>`;
    const clefX = L + 12;
    const gClef = `<path fill='${ink}' transform='translate(${clefX} ${a[3] + 0.8}) scale(${s})' d='${CLEF_G}'/>`;   // curl on the G line
    const fClef = `<path fill='${ink}' transform='translate(${clefX} ${b[1] + 0.8}) scale(${s})' d='${CLEF_F}'/>`;   // dots either side of the F line
    const staffLines = [...a, ...b].map(y => `<rect x='${L}' y='${y}' width='${W - L}' height='1.6' fill='#6b7385'/>`).join('');
    return `${svg(W, H, staffLines + brace + bar + gClef + fClef)} 0 0 / auto repeat-y content-box, #ffffff`;
  }
  if (kind === 'grid') return tiled(svg(32, 32, `<path d='M32 0H0V32' fill='none' stroke='#c9ced8' stroke-width='1'/>`));
  return '';
}
// Keep the first staff clear of the drawing bar when the bar sits in its usual top-middle spot
function inkPaperTop() {
  const host = $('#ink'), bar = $('#ink-bar'); if (!host) return;
  host.style.paddingTop = '';
  if (!host.classList.contains('papered') || !bar || S.settings.inkBar?.mode === 'float') return;
  const below = bar.getBoundingClientRect().bottom - host.getBoundingClientRect().top + 16;
  if (below > 72) host.style.paddingTop = Math.ceil(below) + 'px';
}
function updateInkUI() {
  const host = $('#ink'); if (!host) return;
  host.classList.toggle('on', P.ink.on);
  if (P.ink.on) requestAnimationFrame(inkFit), setTimeout(inkFit, 50);
  host.classList.toggle('passive', P.ink.interact);
  const paper = P.ink.blank ? boardPaper(S.settings.boardPaper) : '';
  host.style.background = !P.ink.blank ? 'transparent' : paper || '#ffffff';
  host.classList.toggle('papered', P.ink.blank && !!S.settings.boardPaper && S.settings.boardPaper !== 'blank');
  const colors = [['#e63946', 'Red'], ['#1d3557', 'Navy'], ['#2a9d8f', 'Teal'], ['#f4a261', 'Orange'], ['#7b2cbf', 'Purple'], ['#111111', 'Black'], ['#ffffff', 'White'], ['#ffd60a', 'Yellow']];
  const tb = (t, label) => `<button class="${P.ink.tool === t ? 'on' : ''}" data-action="ink-tool" data-t="${t}">${label}</button>`;
  $('#ink-bar').innerHTML = `<span class="ink-grip" title="Drag to move this toolbar">⋮⋮</span>
    ${tb('pen', `${IC('ico:pen')} Pen`)}${tb('hl', `${IC('ico:highlight')} Highlight`)}${tb('line', `${IC('ico:line')} Line`)}${tb('arrow', `${IC('ico:arrow')} Arrow`)}${tb('rect', `${IC('ico:box')} Box`)}${tb('circle', `${IC('ico:circle')} Circle`)}${tb('text', 'T Text')}${tb('erase', `${IC('ico:erase')} Erase`)}
    <span style="width:6px"></span>
    ${colors.map(([c, nm]) => `<button class="dot ${P.ink.color === c ? 'on' : ''}" style="background:${c}" data-action="ink-color" data-c="${c}" title="${nm}" aria-label="${nm}"></button>`).join('')}
    <select data-action-change="ink-size" aria-label="Brush size" style="background:transparent;color:#fff;border:1px solid #555;border-radius:6px;padding:2px">
      ${[2, 4, 8, 14].map(s => `<option value="${s}" ${P.ink.size === s ? 'selected' : ''} style="color:#000">${s}px</option>`).join('')}</select>
    ${P.ink.blank ? `<select data-action-change="board-paper" title="Paper" aria-label="Board paper" style="background:transparent;color:#fff;border:1px solid #555;border-radius:6px;padding:2px">${[['blank', 'Blank'], ['staff', 'Music staff'], ['grand', 'Grand staff'], ['grid', 'Grid']].map(([v, l]) => `<option value="${v}" ${(S.settings.boardPaper || 'blank') === v ? 'selected' : ''} style="color:#000">${l}</option>`).join('')}</select>` : ''}
    ${P.ink.blank ? '' : `<button class="${P.ink.interact ? 'on' : ''}" data-action="ink-interact" title="Click through to the slide underneath; drawings stay visible">${IC('ico:pointer')} Click slides</button>`}
    <button data-action="ink-undo" title="Undo (⌘Z)" ${inkUndo.length ? '' : 'disabled'}>${IC('ico:undo')} Undo</button>
    <button data-action="ink-clear" title="Clear board (can be undone)">${IC('ico:trash')} Clear</button>
    <button data-action="ink-close" title="Close drawing (Esc)" aria-label="Close drawing">${IC('ico:close')}</button>`;
  placeInkBar();
  inkPaperTop();
}
// Same behaviour as the main toolbar: drag the grip anywhere; near a side it stands up; drop it at
// the top middle to put it back. Remembered.
function placeInkBar() {
  const b = $('#ink-bar'); if (!b) return;
  const pos = (S.settings.inkBar ||= { mode: 'home' });
  const float = pos.mode === 'float';
  // A moved bar lives on the Present screen itself, above the main toolbar: inside the drawing layer it
  // could never rise above the header (the layer is stacked under it), so the toolbar covered it.
  const home = $('#ink'), top = $('#present');
  if (float && top && b.parentElement !== top) top.appendChild(b);
  if (!float && home && b.parentElement !== home) home.appendChild(b);
  b.style.display = float && !P.ink.on ? 'none' : '';
  b.classList.toggle('floating', float); b.classList.toggle('vertical', float && !!pos.vertical);
  if (!float) { b.style.left = b.style.top = ''; return; }
  const w = b.offsetWidth, h = b.offsetHeight;
  let x = clamp(pos.x * innerWidth - w / 2, 4, innerWidth - w - 4), y = clamp(pos.y * innerHeight - h / 2, 4, innerHeight - h - 4);
  // left on top of the main toolbar? sit just below it (or above it, if there's no room below)
  const d = $('.p-dock'), dr = d && !INKDRAG ? d.getBoundingClientRect() : null;
  if (dr && dr.width && x < dr.right && x + w > dr.left && y < dr.bottom && y + h > dr.top) {
    y = dr.bottom + 8 + h <= innerHeight - 4 ? dr.bottom + 8 : Math.max(4, dr.top - 8 - h);
  }
  b.style.left = x + 'px'; b.style.top = y + 'px';
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
  b.classList.remove('snap-home'); placeInkBar(); inkPaperTop(); save();
});
window.addEventListener('resize', () => { placeInkBar(); inkPaperTop(); });
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
  inkPushUndo();
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
      inkPushUndo();
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
  inkUndo = [];
  const ub = $('#ink-bar [data-action="ink-undo"]'); if (ub) ub.disabled = true;
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
    case 'timer': {
      const T = (S.settings.timerTool ||= { min: 4, label: 'Work time', sound: 'bell' });
      return `<div class="tt">
      <div class="tt-presets">${[0.5, 1, 2, 3, 5, 10, 15].map(m => `<button data-action="quick-timer" data-m="${m}"><b>${m < 1 ? '30' : m}</b><small>${m < 1 ? 'sec' : 'min'}</small></button>`).join('')}</div>
      <div class="tt-custom">
        <div class="tt-step"><button data-action="tt-step" data-d="-1" title="1 minute less" aria-label="1 minute less">${IC('ico:minus')}</button><label><input id="tt-min" type="number" min="0.1" step="0.5" value="${T.min}" data-action-input="tt-field" data-k="min"><span>min</span></label><button data-action="tt-step" data-d="1" title="1 minute more" aria-label="1 minute more">${IC('ico:plus')}</button></div>
        <input id="tt-label" placeholder="Label" value="${esc(T.label)}" data-action-input="tt-field" data-k="label">
        <div class="tt-row"><button class="tt-snd ${T.sound === 'none' ? 'off' : ''}" data-action="tt-mute" title="${T.sound === 'none' ? 'Sound off: click to turn on' : 'Click for no sound at the end'}">${IC(T.sound === 'none' ? 'ico:mute' : 'ico:bell')}</button><select id="tt-sound" data-action-change="tt-sound">${soundOptions(T.sound === 'none' ? (T.lastSound || 'bell') : T.sound)}</select></div>
        <button class="tt-go" data-action="custom-timer">${IC('ico:play')} Start</button>
      </div></div>`;
    }
    case 'points': {
      if (!cls) return '<div class="muted">Points are kept per class. Show a class first.</div>';
      return cls.points.map((t, i) => `<div class="team"><input value="${esc(t.name)}" data-bind="${clsPath(cls)}.points.${i}.name"><button class="btn ic-btn" data-action="pt" data-i="${i}" data-d="-1" aria-label="Subtract point">${IC('ico:minus')}</button><span class="score">${t.score}</span><button class="btn primary ic-btn" data-action="pt" data-i="${i}" data-d="1" aria-label="Add point">${IC('ico:plus')}</button></div>`).join('') +
        `<div class="row"><button class="btn small ic-btn" data-action="pt-add">${IC('ico:plus')} Team</button><button class="btn small" data-action="pt-reset">Reset scores</button>${cls.points.length > 1 ? `<button class="btn small ic-btn" data-action="pt-del">${IC('ico:minus')} Team</button>` : ''}</div>`;
    }
    case 'noise': return `<div class="meter" id="nm"><div></div><span class="lim" style="left:${NOISE.limit}%"></span></div>
      ${S.settings.noiseDyn ? `<div class="dyn-scale">${DYNAMICS.map(d => `<span>${d}</span>`).join('')}</div>` : ''}
      <div class="meter-label" id="nm-label">${NOISE.stream ? '…' : 'Microphone off'}</div>
      <label class="fld"><span>Too-loud limit${S.settings.noiseDyn ? ` <b class="dyn" id="nm-limdyn">${dynOf(NOISE.limit)}</b>` : ''}</span><input type="range" min="10" max="100" value="${NOISE.limit}" data-action-input="noise-limit"></label>
      <label class="chk"><input type="checkbox" ${S.settings.noiseDyn ? 'checked' : ''} data-action-change="noise-dyn"> Show as dynamics (pp p mp mf f ff)</label>
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
// noise level (0–100) as a music dynamic, pp … ff, in six equal bands
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const dynOf = L => DYNAMICS[clamp(Math.floor(L / (100 / 6)), 0, 5)];
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
  const html = S.settings.noiseDyn
    ? `<span class="dyn">${dynOf(L)}</span>${L > lim ? ` <span class="dyn-warn">${IC('ico:loud')} Too loud (limit ${dynOf(lim)})</span>` : ''}`
    : L > lim ? IC('ico:loud') + ' Too loud!' : L > lim * 0.75 ? IC('ico:mid') + ' Getting loud' : L > lim * 0.4 ? IC('ico:good') + ' Good' : IC('ico:mute') + ' Quiet';
  if (lab.__h !== html) { lab.__h = html; lab.innerHTML = html; }
  if (L > lim && NOISE.beep && Date.now() - NOISE.warnAt > 5000) { NOISE.warnAt = Date.now(); playSound('ding'); }
}

// ============================================================ EDITOR
const TABS = [['classes', 'Classes'], ['schedule', 'Bell schedule'], ['routines', 'Daily routines'], ['notes', 'Notes & print'], ['events', 'Events'], ['library', 'Library'], ['tutorials', 'Tutorials'], ['settings', 'Settings']];
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
    case 'tutorials': return helpTutorialsCard();
    case 'settings': return settingsTab();
  }
  return '';
}

// ---------- classes
function classesTab() {
  if (!SEL_CLASS || !S.classes.find(c => c.id === SEL_CLASS)) SEL_CLASS = S.classes[0]?.id || null;
  const cls = S.classes.find(c => c.id === SEL_CLASS);
  const list = `<div class="card"><div class="card-head"><h3>Classes</h3><span class="grow"></span><button class="btn small ic-btn" data-action="class-add">${IC('ico:plus')} Add</button></div>
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
        <label class="fld"><span>Class title</span><input type="color" data-bind="${base}.theme.titleText" data-rerender value="${th.titleText || th.text || '#ffffff'}"></label>
        <label class="fld"><span>Clock</span><input type="color" data-bind="${base}.theme.clockText" data-rerender value="${th.clockText || th.text || '#ffffff'}"></label>
        ${th.titleText || th.clockText ? `<button class="btn small" data-action="theme-text-reset" style="align-self:flex-end">Match text</button>` : ''}
        <label class="fld grow"><span>Background image URL (optional)</span><input data-bind="${base}.theme.image" data-rerender value="${esc(th.image && !th.image.startsWith('file:') ? th.image : '')}" placeholder="https://…"></label>
        <button class="btn small" data-action="theme-image" style="align-self:flex-end">Use a picture…</button>
        ${th.image ? `<button class="btn small" data-action="theme-image-clear" style="align-self:flex-end">Remove picture</button>` : ''}
      </div>
      <div class="preview-strip" style="margin-top:12px;background-color:${th.bg};color:${th.text};${th.image ? `background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url('${th.image.startsWith('file:') ? fileDirectURL(th.image.slice(5)) : esc(th.image)}')` : ''}"><b style="font-size:20px;color:${th.titleText || th.text || '#fff'}">${esc(cls.name)}</b><span style="background:${th.accent};color:${th.bg};padding:3px 10px;border-radius:99px;font-weight:700;font-size:12px">Current step</span><b style="font-size:16px;color:${th.clockText || th.text || '#fff'}">10:15 AM</b></div>
    </div>
    <div class="card"><div class="card-head"><h2>Agenda</h2><span class="grow"></span><button class="btn small ic-btn" data-action="agenda-add">${IC('ico:plus')} Step</button></div>
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
        <button class="btn small ic-btn" data-action="res-add-url">${IC('ico:plus')} Link</button><button class="btn small ic-btn" data-action="res-add-file">${IC('ico:plus')} File (PDF, image, video, audio)</button></div>
      <p class="desc">Google Slides, Docs, Sheets, Forms, Drive files, YouTube, Canva or any web page, plus PDFs and images from your Mac. They appear as tabs on the Present screen.</p>
      ${cls.resources.map((r, k) => `<div class="res-item"><span class="res-ico" style="font-size:18px">${resIcon(r) === '-' ? '' : IC(resIcon(r))}</span>
        <div class="row" style="gap:6px"><input class="grow" data-bind="${base}.resources.${k}.title" value="${esc(r.title)}" placeholder="Title">
        ${r.widget ? `<span class="pill">${IC(WIDGETS[r.widget.kind].icon)} ${WIDGETS[r.widget.kind].title}</span>` : r.music ? `<span class="pill">${IC(kindIcon(r.music.kind))} ${r.music.kind === 'tuner' ? 'Tuner & drone' : 'Metronome'}</span>` : r.sight ? `<span class="pill">${IC('ico:sight')} Sight-reading (${r.sight.mode})</span>` : r.score ? `<span class="pill">${IC('ico:score')} ${esc(r.score.name || S.files[r.score.fileId]?.name || 'Score')}</span>` : r.url != null ? `<input class="grow" data-bind="${base}.resources.${k}.url" value="${esc(r.url)}" placeholder="https://…" style="flex:2">` : `<span class="pill">${esc(S.files[r.fileId]?.name || 'missing file')}</span>`}
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
      <button class="btn small ic-btn" data-action="ev-add" data-kind="birthday">${IC('ico:plus')} Birthday</button><button class="btn small ic-btn" data-action="ev-add" data-kind="announcement">${IC('ico:plus')} Announcement</button><button class="btn small ic-btn" data-action="ev-add" data-kind="event">${IC('ico:plus')} Event</button>
      <button class="btn small" data-action="ev-ics">Import calendar (.ics)…</button></div>
    <p class="desc">Today's events show on the Present screen — for all classes, or only the classes you tick under "Show in". Add a time to pop it up full-screen at that moment (birthdays get confetti). Tip: in Google Calendar, use Settings → Import & export → Export to get an .ics file.</p>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><tr><th style="width:130px">Type</th><th style="width:150px">Date</th><th>Title / name</th><th style="width:120px">Pop-up time</th><th style="width:170px">Repeats</th><th style="width:170px">Show in</th><th style="width:30px"></th></tr>
    ${list.map(e => { const k = S.events.indexOf(e); return `<tr><td><select data-bind="events.${k}.kind"><option value="birthday" ${e.kind === 'birthday' ? 'selected' : ''}>Birthday</option><option value="announcement" ${e.kind === 'announcement' ? 'selected' : ''}>Announcement</option><option value="event" ${e.kind === 'event' ? 'selected' : ''}>Event</option></select></td>
      <td><input type="date" data-bind="events.${k}.date" value="${e.date || ''}"></td><td><input data-ev-id="${e.id}" data-bind="events.${k}.title" value="${esc(e.title)}"></td>
      <td><input type="time" data-bind="events.${k}.time" value="${e.time || ''}"></td><td>${repeatSel(e, `data-ev-repeat="${e.id}"`)}${evRepeat(e) && evRepeat(e) !== 'yearly' ? `<div class="small muted" style="margin-top:3px">until <input type="date" data-bind="events.${k}.until" value="${e.until || ''}" title="Last day (empty = forever)"></div>` : ''}</td>
      <td><details class="ev-cls"><summary>${esc(evWhere(e))}</summary><label><input type="checkbox" data-ev-all="${e.id}" ${!e.classes?.length ? 'checked' : ''}> All classes</label>
        ${S.classes.map(c => `<label><input type="checkbox" data-ev-cls="${e.id}" data-c="${c.id}" ${e.classes?.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</details></td>
      <td><button class="iconbtn" data-action="ev-del" data-k="${k}">${IC('ico:close')}</button></td></tr>`; }).join('')}</table></div>` : '<div class="empty">No events yet.</div>'}
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

// ---------- Help & Tutorials feature guide (Settings + live interactive spotlight walkthroughs)
function tourEnsureTempWin(id, spec, sz = { x: 0.22, y: 0.08, w: 0.58, h: 0.78 }) {
  const list = winList();
  let w = list.find(x => x.id === id);
  if (!w) {
    w = { id, z: topZ(list) + 1, ...sz, ...spec, __tourTemp: true };
    list.push(w);
    WIN.sig = '';
    renderWins(context(now()), true);
  }
  return w;
}
function tourRemoveTempWins() {
  let changed = false;
  for (const k of Object.keys(S.windows || {})) {
    const before = S.windows[k].length;
    S.windows[k] = S.windows[k].filter(w => !w.__tourTemp);
    if (S.windows[k].length !== before) changed = true;
  }
  if (changed) { WIN.sig = ''; renderWins(context(now()), true); }
}
function tourFindOrOpenScore() {
  const cls = currentClass(), ctx = context(now());
  const scoreRes = cls?.resources?.find(r => r.score);
  if (scoreRes) {
    P.stageSel[ctx.key] = scoreRes.id; P.stageKey = ''; tick();
    return;
  }
  const scoreFile = Object.entries(S.files || {}).find(([id, f]) => f && !f.hiddenScore && typeof spIsScoreName === 'function' && spIsScoreName(f.name || ''));
  if (scoreFile) {
    const [fid, f] = scoreFile;
    const saved = S.scoreSettings?.[fid];
    tourEnsureTempWin('__tour_score', { kind: 'score', score: saved ? JSON.parse(JSON.stringify(saved)) : { fileId: fid, name: f.name } });
  } else {
    tourEnsureTempWin('__tour_score', { kind: 'score', score: { name: 'Score Practice' } });
  }
}
function tourClosePopovers() {
  if (P.winMenu) { P.winMenu = false; P.appPick = null; renderWinMenu(); }
  if (P.tools.timer) { delete P.tools.timer; renderTools(); }
  if (P.dockMore) { P.dockMore = false; renderDock(); }
  document.querySelectorAll('.sp-grmenu').forEach(el => el.remove());
  $('#bug-modal[data-tour-demo="1"]')?.remove();
}
const FEATURE_GUIDES = [
  {
    id: 'score',
    cat: 'Music',
    icon: 'ico:score',
    title: 'Score Practice, Voice Mixer & Vocal Recording',
    summary: 'Open MusicXML or MuseScore files, loop measures, play starting pitches for each part, record sung tracks, and grade parts note by note.',
    tips: [
      'Click a measure to start there, or drag across measures to set a loop.',
      'Click the bell icon next to any part for its starting pitch, or use Low → high and Chord.',
      'Click Record vocals to record a part either silently (no headphones) or with selected parts in headphones.',
    ],
    steps: [
      {
        setup: () => { tourClosePopovers(); tourFindOrOpenScore(); },
        delay: 140,
        sel: '.sp-top', fallback: '.score-host',
        title: 'Score Practice Bar',
        body: 'Pick a score, press Play, change tempo, or click a measure (or drag across measures) to set a start point or loop. Voices and Grade open from this bar too.',
      },
      {
        setup: () => {
          tourClosePopovers(); tourFindOrOpenScore();
          const voicesBtn = $('[data-sp="voices"]');
          if (voicesBtn && $('.sp-voices')?.hidden) voicesBtn.click();
        },
        delay: 120,
        sel: '.sp-voices:not([hidden])', fallback: '.sp-top',
        title: 'Voice Parts & Starting Pitches',
        body: 'Each part has a starting-pitch bell, volume slider, Focus, Solo, and a Sung/MIDI switch once recorded. Use All, Low → high, or Chord at the top to give pitches.',
      },
      {
        setup: () => {
          tourClosePopovers(); tourFindOrOpenScore();
          const voicesBtn = $('[data-sp="voices"]');
          if (voicesBtn && $('.sp-voices')?.hidden) voicesBtn.click();
          setTimeout(() => { const rb = $('[data-sp="rec-menu"]'); if (rb && !$('.sp-recmenu')) rb.click(); }, 60);
        },
        delay: 170,
        sel: '.sp-recmenu', fallback: '[data-sp="rec-menu"]',
        title: 'Record Vocals',
        body: 'Pick the part to record. Choose Silent Recording to mute playback after the count-in, or Headphones Recording and check whichever parts (including the part you are recording) and Click track you want to hear.',
      },
      {
        setup: () => {
          tourClosePopovers(); tourFindOrOpenScore();
          const gb = $('[data-sp="grade-menu"]');
          if (gb && !$('.sp-grmenu')) gb.click();
        },
        delay: 130,
        sel: '.sp-grmenu', fallback: '[data-sp="grade"]',
        title: 'Grading a Part',
        body: 'Choose which part to grade and your octave shift, then pick Microphone (Pitch & Rhythm), Microphone (Rhythm only), or Space bar (Tap rhythm). Results appear on the notes.',
      },
    ],
  },
  {
    id: 'sight',
    cat: 'Music',
    icon: 'ico:sight',
    title: 'Sight Reading & Grading',
    summary: 'Generate rhythm or solfege examples and grade them with the microphone or space bar.',
    tips: [
      'Click New to generate another example, or open Settings to change keys, rhythms, and range.',
      'After grading, click Listen back to hear your recording lined up with the example.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          const cls = currentClass(), ctx = context(now());
          const sr = cls?.resources?.find(r => r.sight);
          if (sr) { P.stageSel[ctx.key] = sr.id; P.stageKey = ''; tick(); }
          else tourEnsureTempWin('__tour_sr', { kind: 'sight', sr: srDefaults() });
        },
        delay: 140,
        sel: '.sr-top', fallback: '.sr-host',
        title: 'Sight Reading Controls',
        body: 'Switch between Rhythm and Solfege, adjust the tempo, click New for a fresh example, or press Play to hear it.',
      },
      {
        setup: () => {
          tourClosePopovers();
          if (!$('.sr-host')) tourEnsureTempWin('__tour_sr', { kind: 'sight', sr: srDefaults() });
        },
        delay: 90,
        sel: '[data-sr="grade"]', fallback: '.sr-host',
        title: 'Grade & Listen Back',
        body: 'Click Grade to sing, clap, or tap the space bar along with the example. When finished, use Listen back to review your take.',
      },
    ],
  },
  {
    id: 'extapps',
    cat: 'Workspace',
    icon: 'ico:app',
    title: 'External Apps & Floating Agenda Bar',
    summary: 'Switch to another app on your computer while Rehearsal stays on top as a small agenda bar, or pin apps as workspace tabs.',
    tips: [
      'Open ＋ Open and click External Apps to see other open apps on your computer.',
      'Click Pin on an app to keep a tab for it in your main tab bar.',
      'Drag the edges of the floating agenda bar to resize it, and click Rehearsal when you want to come back.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          P.winMenu = true;
          P.appPick = IS_NATIVE ? 'loading' : { windows: [] };
          renderWinMenu(); renderDock();
          if (IS_NATIVE) native('listAppWindows');
        },
        delay: 140,
        sel: '.win-menu', fallback: '[data-dock-id="window"]',
        title: 'Opening External Apps',
        body: 'Open ＋ Open and click External Apps to list other open apps. Click an app to switch to it with Rehearsal floating on top, or click Pin to add it to your tabs.',
      },
      {
        setup: () => { tourClosePopovers(); },
        delay: 80,
        sel: '.tab-ext-app', fallback: '#stage-tabs',
        title: 'Pinned App Tabs',
        body: 'Pinned apps show up in this tab bar alongside your class tabs. Click a pinned app tab anytime to switch straight to it.',
      },
    ],
  },
  {
    id: 'web',
    cat: 'Workspace',
    icon: 'ico:web',
    title: 'Web Pages, Google Slides & Drawing',
    summary: 'Open websites and Google files in class tabs, run Google Slides in slideshow mode, and draw on top of pages.',
    tips: [
      'Google Docs, Sheets, Drive, and Search open in full browser mode so signing in works normally.',
      'Click Draw on page in the URL bar when you want to write over a webpage.',
      'On Google Slides tabs, click Slideshow to present slides inside Rehearsal.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          const cls = currentClass(), ctx = context(now());
          const wr = cls?.resources?.find(r => r.url);
          if (wr) { P.stageSel[ctx.key] = wr.id; P.stageKey = ''; tick(); }
          else tourEnsureTempWin('__tour_web', { kind: 'web', url: 'https://www.google.com', native: false });
        },
        delay: 120,
        sel: '#stage-webbar:not([hidden])', fallback: '.win[data-win="__tour_web"] .win-bar',
        title: 'Address Bar & Draw on Page',
        body: 'Type a web address or Google search here. Slides tabs include a Slideshow button, and Draw on page lets you write over a webpage.',
      },
      {
        setup: () => {
          tourClosePopovers();
          P.ink.on = true; P.ink.blank = false; P.ink.interact = false;
          updateInkUI(); renderDock();
        },
        delay: 90,
        sel: '.ink-bar', fallback: '[data-dock-id="ink"]',
        title: 'Drawing Tools',
        body: 'Use Annotate in the toolbar to pick pen, highlighter, arrows, shapes, or eraser over anything on screen. Click the close button on this bar to stop drawing.',
      },
    ],
  },
  {
    id: 'timers',
    cat: 'Classroom',
    icon: 'ico:timer',
    title: 'Timers',
    summary: 'Start preset or custom timers, move and resize them on screen, or expand a timer to fill the workspace.',
    tips: [
      'Drag a running timer anywhere on screen, and drag the bottom-right corner to resize it.',
      'Click End under the timer name to stop and remove a timer.',
      'Click the maximize button in the top-right corner of a timer to fill the workspace while keeping the header and toolbar visible.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          P.timers = P.timers.filter(t => !t.__tourTemp); renderTimers();
          P.tools.timer = { x: 48, y: 112 };
          renderTools(); placeTool('timer', false); renderDock();
        },
        delay: 100,
        sel: '.tool[data-toolwin="timer"]', fallback: '[data-dock-id="timer"]',
        title: 'Starting a Timer',
        body: 'Click Timer in the toolbar to start a preset (30 sec, 1, 2, 3, 5, 10, or 15 min), or set a custom length, name, and sound and press Start.',
      },
      {
        setup: () => {
          tourClosePopovers();
          let tm = P.timers.find(t => t.id === '__tour_tm');
          if (!tm) {
            tm = { id: '__tour_tm', label: 'Demo Timer', total: 180000, endAt: Date.now() + 180000, pausedLeft: 180000, sound: 'bell', muted: true, full: false, __tourTemp: true };
            P.timers.push(tm);
          }
          tm.full = false;
          renderTimers();
        },
        delay: 100,
        sel: '.p-timer[data-tid="__tour_tm"]', fallback: '#p-timers',
        title: 'Moving & Resizing a Timer',
        body: 'Drag a running timer anywhere on screen, or drag its bottom-right corner to resize it. Use End under the timer name to stop it, or maximize in the top-right corner.',
      },
      {
        setup: () => {
          tourClosePopovers();
          let tm = P.timers.find(t => t.id === '__tour_tm');
          if (!tm) {
            tm = { id: '__tour_tm', label: 'Demo Timer', total: 180000, endAt: Date.now() + 180000, pausedLeft: 180000, sound: 'bell', muted: true, full: true, __tourTemp: true };
            P.timers.push(tm);
          } else tm.full = true;
          renderTimers();
        },
        delay: 100,
        sel: '.p-timer[data-tid="__tour_tm"] .tm-bar', fallback: '.p-timer[data-tid="__tour_tm"]',
        title: 'Full Workspace Timer',
        body: 'Maximizing fills the workspace area below the header so your class title, toolbar, and clock stay visible. Click the top-right restore button to shrink it back, or End to finish.',
      },
    ],
  },
  {
    id: 'files',
    cat: 'Workspace',
    icon: 'ico:folder',
    title: 'Files Browser & Pinning Files',
    summary: 'Search and filter your audio, PDFs, scores, images, and videos. Open files inside Files, pin the Files browser as a tab, or pin individual files as their own tabs.',
    tips: [
      'Click any file to open it inside the Files browser, then use ← Files to go back.',
      'Click Pin on a file (or Pin as own tab while viewing it) to give that file its own tab in the current class.',
      'Click the trash icon on any file to delete it from your library.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          tourEnsureTempWin('__tour_files', { kind: 'files' }, { x: 0.24, y: 0.08, w: 0.52, h: 0.78 });
        },
        delay: 120,
        sel: '.win[data-win="__tour_files"] .fb-top', fallback: '.win[data-win="__tour_files"]',
        title: 'Search & Filter Files',
        body: 'Type to search by file name, filter by Audio, PDF, Scores, Images, or Video, or click + Add files (or drag files in) to import new ones.',
      },
      {
        setup: () => {
          tourClosePopovers();
          tourEnsureTempWin('__tour_files', { kind: 'files' }, { x: 0.24, y: 0.08, w: 0.52, h: 0.78 });
        },
        delay: 90,
        sel: '.win[data-win="__tour_files"] .fb-list', fallback: '.win[data-win="__tour_files"]',
        title: 'Open, Pin, or Delete Files',
        body: 'Click a file to view or play it right inside Files. Use Pin to add a single file as its own class tab, or click the trash button to delete a file from your library.',
      },
      {
        setup: () => {
          tourClosePopovers();
          tourEnsureTempWin('__tour_files', { kind: 'files' }, { x: 0.24, y: 0.08, w: 0.52, h: 0.78 });
        },
        delay: 90,
        sel: '.win[data-win="__tour_files"] [data-action="win-pin"]', fallback: '.win[data-win="__tour_files"] .win-bar',
        title: 'Pin the Files Browser',
        body: 'Click the pin icon in the title bar (or Pin tab inside Files) to pin the Files browser itself as a tab in the current class.',
      },
    ],
  },
  {
    id: 'edit',
    cat: 'Classroom',
    icon: 'ico:edit',
    title: 'Quick Edit & Agenda',
    summary: 'Edit the class title, warm-up, and agenda right on the Present screen, and drag agenda items to reorder them.',
    tips: [
      'Click Quick edit in the toolbar to edit directly on screen without opening Setup.',
      'Use ‹ › on the Agenda card (or the Left/Right arrow keys) to move through steps.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          P.editMode = true; P.sideKey = ''; P.stageKey = '';
          renderDock(); tick();
        },
        delay: 120,
        sel: '#p-side', fallback: '[data-dock-id="editmode"]',
        title: 'Editing the Agenda on Screen',
        body: 'With Quick edit on, click agenda items to change the text or minutes, add or remove items, or drag them into a new order.',
      },
      {
        setup: () => {
          tourClosePopovers();
          P.editMode = true; P.sideKey = ''; P.stageKey = '';
          renderDock(); tick();
        },
        delay: 80,
        sel: '#p-title', fallback: '.p-head',
        title: 'Editing the Class Header',
        body: 'You can also edit the class name, subtitle, and warm-up right here. Click Quick edit again in the toolbar when you are done.',
      },
    ],
  },
  {
    id: 'bug',
    cat: 'Support',
    icon: 'ico:warn',
    title: 'Reporting a Bug',
    summary: 'Press ⌘⇧B (or open ⋯ → Report a bug) to capture a screenshot and explain what went wrong.',
    tips: [
      'Uncheck "Include screenshot" if student names are visible on screen.',
      'You can also save the report as an HTML file with Save File… if you are offline.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          window.__bugReportOpen({ screenshot: '', os: navigator.platform || 'Desktop', version: WEB_VERSION || '', logTail: '', tourDemo: true });
        },
        delay: 110,
        sel: '.bug-card', fallback: '#p-dock .dock-more',
        title: 'Report a Bug (⌘⇧B)',
        body: 'Open ⋯ → Report a bug or press ⌘⇧B (Ctrl+Shift+B) from any screen. Rehearsal takes a screenshot automatically, lets you write what happened, and attaches your app version and OS.',
      },
    ],
  },
];
function helpTutorialsCard() {
  const q = (P.helpSearch || '').trim().toLowerCase();
  const list = FEATURE_GUIDES.filter(g => !q || (g.title + ' ' + g.summary + ' ' + g.cat + ' ' + g.tips.join(' ')).toLowerCase().includes(q));
  return `<div class="card help-card" id="settings-help">
    <div class="card-head">
      <h2>Tutorials</h2>
      <span class="grow"></span>
      <button class="btn small" data-action="whats-new">${IC('ico:book')} What's New</button>
      <button class="btn small primary" data-action="tour-replay">${IC('ico:play')} Full Tour</button>
      <button class="btn small" data-action="bug-report">${IC('ico:warn')} Report a Bug</button>
    </div>
    <p class="desc">Pick a feature below for quick notes, or click <b>Show me</b> to open it on the Present screen and walk through the controls.</p>
    <input class="help-search" data-help-search placeholder="Search tutorials (timer, grading, files, vocals, slides)…" value="${esc(P.helpSearch || '')}">
    <div class="help-grid">
      ${list.length ? list.map(g => `<details class="help-item" ${q ? 'open' : ''}>
        <summary>
          <span class="help-ic">${IC(g.icon)}</span>
          <span class="help-meta"><b>${esc(g.title)}</b><small>${esc(g.summary)}</small></span>
          <span class="help-cat">${esc(g.cat)}</span>
        </summary>
        <div class="help-body">
          <ul>${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          <div class="help-acts">
            <button class="btn small primary" data-action="feature-tour" data-fid="${g.id}">Show me →</button>
          </div>
        </div>
      </details>`).join('') : '<div class="empty">No matching tutorials found.</div>'}
    </div>
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
      <span class="small muted">Toolbar size, labels and shrinking: ⋯ → Customize toolbar on the Present screen.</span></div></div>
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
    <div class="row" style="margin-top:8px"><span style="width:9em">Music volume</span><input type="range" min="0.5" max="3" step="0.1" value="${musicVol()}" data-action-input="music-vol" style="flex:1;max-width:320px"><b>${Math.round(musicVol() * 100)}%</b><button class="btn" data-action="vol-test">Test</button></div>
    <div class="row" style="margin-top:8px"><span style="width:9em">Metronome volume</span><input type="range" min="0" max="2" step="0.05" value="${metVol()}" data-metvol style="flex:1;max-width:320px"><b class="mv-v">${Math.round(metVol() * 100)}%</b></div>
    <div class="row" style="margin-top:8px"><span style="width:9em">Rhythm counts</span><select data-action-change="rhythm-sys">${(typeof RHYTHM_SYSTEMS !== 'undefined' ? RHYTHM_SYSTEMS : [['numbers', 'Numbers (1 e & a)']]).map(([v, l]) => `<option value="${v}" ${(S.settings.rhythmSystem || 'numbers') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="small muted">Used in Sight Reading, Score Practice, and Warm-up notation.</span></div></div>
  <div class="card"><h2>Backup</h2><p class="desc">Your classes and settings are saved on this ${DEVICE} automatically. Export a backup file to move them to another Mac or the web version in any browser (Import backup there). Library files (music, PDFs, pictures) aren't in the backup file, so add them again on the other device.</p>
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
  'quick-timer': el => { const m = Number(el.dataset.m), T = S.settings.timerTool || {}; startTimer({ label: m < 1 ? '30 seconds' : `${m} minute${m > 1 ? 's' : ''}`, minutes: m, sound: T.sound || 'bell' }); },
  'custom-timer': () => { const T = S.settings.timerTool || {}; startTimer({ label: $('#tt-label').value || 'Timer', minutes: Number($('#tt-min').value) || 1, sound: T.sound || $('#tt-sound').value }); },
  'tt-step': el => { const T = (S.settings.timerTool ||= {}), i = $('#tt-min'); T.min = Math.max(0.5, Math.round(((Number(i?.value) || 0) + Number(el.dataset.d)) * 2) / 2); if (i) i.value = T.min; save(); },
  'tt-mute': () => { const T = (S.settings.timerTool ||= {}); if (T.sound === 'none') T.sound = T.lastSound || 'bell'; else { T.lastSound = T.sound || 'bell'; T.sound = 'none'; } save(); rerenderTool('timer'); },
  'timer-mute': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm) return; if (tm.sound === 'none') { tm.sound = S.settings.timerTool?.lastSound || 'bell'; tm.muted = false; } else tm.muted = !tm.muted; renderTimers(); },
  'timer-pause': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm || tm.doneAt) return; if (tm.pausedLeft != null) { tm.endAt = onClockSecond(Date.now() + tm.pausedLeft); tm.pausedLeft = null; } else tm.pausedLeft = tm.endAt - Date.now(); updateTimers(); },
  'timer-add': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm) return; tm.doneAt = 0; if (tm.pausedLeft != null) tm.pausedLeft += 60000; else tm.endAt = Math.max(tm.endAt, Date.now()) + 60000; tm.total = Math.max(tm.total, timerLeft(tm)); updateTimers(); },
  'timer-full': el => {
    const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm) return;
    tm.full = !tm.full;
    if (tm.full) {
      P.timers.forEach(o => { if (o !== tm) o.full = false; });
      if (P.tools.timer) { delete P.tools.timer; renderTools(); renderDock(); }
    }
    renderTimers();
  },
  'timer-x': el => { P.timers = P.timers.filter(t => t.id !== el.dataset.id); renderTimers(); },
  'overlay-dismiss': () => { if (P.overlay) P.overlay.until = 0; },
  'music-stop': () => { stopMusic(); renderDock(); },
  'music-stop-ed': () => stopMusic(true),
  pt: el => { const c = currentClass(); if (!c) return; c.points[el.dataset.i].score += Number(el.dataset.d); save(); rerenderTool('points'); },
  'pt-add': () => { const c = currentClass(); if (!c) return; c.points.push({ name: `Team ${c.points.length + 1}`, score: 0 }); save(); rerenderTool('points'); },
  'pt-del': () => { const c = currentClass(); if (!c || c.points.length <= 1) return; const last = c.points[c.points.length - 1]; if (last.score && !confirm(`Remove “${last.name}” (${last.score} pts)?`)) return; c.points.pop(); save(); rerenderTool('points'); },
  'pt-reset': () => { const c = currentClass(); if (!c) return; if (c.points.some(p => p.score) && !confirm('Reset all team scores to 0?')) return; c.points.forEach(p => p.score = 0); save(); rerenderTool('points'); },
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
  stage: el => { const c = context(now()); if (c.cls) { if ((P.stageSel[c.key] || 'warmup') !== el.dataset.id) stopMusicHosts(); P.stageSel[c.key] = el.dataset.id; } P.stageKey = ''; if (P.groupMenu) { P.groupMenu = null; renderGroupMenu(); } },
  'stage-back': () => { const r = stageNativeRes(true); if (r) native('webCmd', { id: 'stage-' + r.id, action: 'back' }); },
  'stage-fwd': () => { const r = stageNativeRes(true); if (r) native('webCmd', { id: 'stage-' + r.id, action: 'forward' }); },
  'stage-reload': () => { const r = stageNativeRes(); if (r) native('webCmd', { id: 'stage-' + r.id, action: 'reload' }); P.stageKey = ''; tick(); },
  'stage-slideshow': () => {
    const r = stageNativeRes(true); if (!r) return;
    r.mode = r.mode === 'present' ? 'embed' : 'present';
    P.forceStageUrl = r.id;
    P.webModeMenu = null; renderWebModeMenu();
    save(); P.stageKey = ''; WIN.lastSync = '';
    tick();
    if (isNativeWeb(r)) native('webCmd', { id: 'stage-' + r.id, action: 'load', url: resTargetURL(r) });
  },
  'stage-native': () => {
    const r = stageNativeRes(true); if (!r) return;
    r.native = !isNativeWeb(r);
    if (r.native) P.forceStageUrl = r.id;
    save(); P.stageKey = ''; WIN.lastSync = '';
    tick();
  },
  'web-markup-toggle': el => {
    const target = el.dataset.target, id = el.dataset.id;
    if (target === 'stage') {
      const r = findRes(id); if (!r) return;
      const turningOn = !r.markupMode;
      r.markupMode = turningOn;
      if (!turningOn) P.forceStageUrl = r.id;
      if (turningOn) {
        P.ink.on = true; P.ink.interact = false;
      } else if (P.ink.on) {
        P.ink.on = false; P.ink.interact = false;
      }
      save(); P.stageKey = ''; WIN.lastSync = '';
      updateInkUI(); renderDock();
      tick();
    } else {
      const w = findWin(id); if (!w) return;
      const t = winRes(w) || w;
      const turningOn = !t.markupMode;
      t.markupMode = turningOn;
      if (turningOn) { P.ink.on = true; P.ink.interact = false; }
      else if (P.ink.on) { P.ink.on = false; P.ink.interact = false; }
      save(); WIN.sig = ''; WIN.lastSync = '';
      updateInkUI(); renderDock();
      renderWins(context(now()), true);
    }
  },
  'stage-app': el => {
    const a = findStageExternalApp(el.dataset.key);
    if (a) dockStageApp(a, true);
  },
  'stage-app-close': (el, e) => {
    e?.stopPropagation?.();
    const k = el.dataset.key;
    const list = pinnedApps(), idx = list.findIndex(p => appKey(p) === k);
    if (idx >= 0) list.splice(idx, 1);
    if (P.dockedApp && appKey(P.dockedApp) === k) {
      undockStageApp(true);
      P.dockedApp = null;
    }
    const ctx = context(now());
    if (ctx.mode === 'class' && P.stageSel[ctx.key] === 'app:' + k) {
      P.stageSel[ctx.key] = 'warmup';
    }
    save(); P.stageKey = ''; tick();
  },
  'dock-realign': () => {
    if (!P.dockedApp) return;
    P.lastDockRectSig = '';
    syncDockedApp(true);
  },
  'dock-float': () => {
    if (!P.dockedApp) return;
    launchCompanionApp(P.dockedApp);
  },
  'dock-pin': el => {
    const a = findStageExternalApp(el.dataset.key) || P.dockedApp;
    if (a) togglePinApp(a);
  },
  'dock-launch': el => {
    const a = findStageExternalApp(el.dataset.key) || P.dockedApp;
    if (!a) return;
    if (a.bundleId) native('launchApp', { bundleId: a.bundleId });
    toast(`Launching ${a.app || 'app'}…`);
    setTimeout(() => { native('listAppWindows'); P.lastDockRectSig = ''; syncDockedApp(true); }, 1800);
  },
  'web-mode-menu': el => {
    const target = el.dataset.target, id = el.dataset.id;
    const same = P.webModeMenu && P.webModeMenu.target === target && P.webModeMenu.id === id;
    P.webModeMenu = same ? null : { target, id };
    renderWebModeMenu();
    if (target === 'win') { WIN.sig = ''; renderWins(context(now()), true); if (P.webModeMenu) renderWebModeMenu(); }
    else tick();
  },
  'web-mode-close': () => {
    P.webModeMenu = null; renderWebModeMenu();
    WIN.sig = ''; renderWins(context(now()), true); tick();
  },
  'web-mode-set': el => {
    const target = el.dataset.target, id = el.dataset.id, wantNative = el.dataset.native === '1';
    P.webModeMenu = null; renderWebModeMenu();
    if (target === 'stage') {
      const r = findRes(id); if (!r) return;
      r.native = wantNative;
      if (r.native) P.forceStageUrl = r.id;
      save(); P.stageKey = ''; WIN.lastSync = '';
      tick();
    } else {
      const w = findWin(id); if (!w) return;
      w.native = wantNative;
      save(); WIN.sig = ''; WIN.lastSync = '';
      renderWins(context(now()), true);
    }
  },
  'open-external': el => { const u = el.dataset.url; if (!native('openExternal', { url: u })) window.open(u, '_blank'); },
  'open-drive': el => native('openDrive', { url: el.dataset.url }),
  // free windows
  'win-menu': () => { P.winMenu = !P.winMenu; renderWinMenu(); renderDock(); },
  'win-tile': () => { P.winMenu = false; renderWinMenu(); renderDock(); tileWindows(); },
  'wm-web': () => { const w = addWindow({ kind: 'web', url: '', native: false }); setTimeout(() => $(`[data-wurl="${w.id}"]`)?.focus(), 30); },
  'wm-files': () => {
    const ex = winList().find(w => w.kind === 'files');
    if (ex) { P.winMenu = false; renderWinMenu(); renderDock(); bringToFront(ex); setTimeout(() => $(`.win[data-win="${ex.id}"] .fb-search`)?.focus(), 30); return; }
    const w = addWindow({ kind: 'files' }, { w: 0.46, h: 0.72 });
    setTimeout(() => $(`.win[data-win="${w.id}"] .fb-search`)?.focus(), 40);
  },
  'wm-file': async () => { P.winMenu = false; renderWinMenu(); renderDock(); const fs = await pickFile('application/pdf,image/*,video/*,audio/*,.mxl,.musicxml,.mscz,.mscx', true); for (const f of fs) { const id = await storeFile(f); addWindow(spIsScoreName(f.name) ? { kind: 'score', score: { fileId: id, name: f.name } } : { kind: 'file', fileId: id }); } },
  'wm-score': async () => {
    P.winMenu = false; renderWinMenu(); renderDock();
    // reopen the score you used last (switch scores from the list inside the widget)
    const lib = typeof spLibrary === 'function' ? spLibrary() : [];
    const pick = lib.find(x => x.id === S.settings.lastScore) || lib[0];
    if (pick) { const saved = S.scoreSettings?.[pick.id]; addWindow({ kind: 'score', score: saved ? JSON.parse(JSON.stringify(saved)) : { fileId: pick.id, name: S.files[pick.id]?.name } }); return; }
    const fs = await pickFile('.mxl,.musicxml,.xml,.mscz,.mscx', true); for (const f of fs) { const id = await storeFile(f); addWindow({ kind: 'score', score: { fileId: id, name: f.name } }); } },
  'wm-apps': () => { P.appPick = 'loading'; renderWinMenu(); native('listAppWindows'); },
  'wm-app': el => {
    const a = P.appPick?.windows?.[+el.dataset.i]; if (!a) return;
    dockStageApp(a, true);
  },
  'wm-app-float': (el, e) => {
    e?.stopPropagation?.();
    const a = P.appPick?.windows?.[+el.dataset.i]; if (!a) return;
    launchCompanionApp(a);
  },
  'wm-pin-app': el => {
    const p = pinnedApps().find(x => appKey(x) === el.dataset.key); if (!p) return;
    dockStageApp(p, true);
  },
  'wm-pin-float': (el, e) => {
    e?.stopPropagation?.();
    const p = pinnedApps().find(x => appKey(x) === el.dataset.key); if (!p) return;
    launchCompanionApp(p);
  },
  'app-pin': (el, e) => {
    e?.stopPropagation?.();
    const k = el.dataset.key;
    const live = el.dataset.i != null ? P.appPick?.windows?.[+el.dataset.i] : null;
    const item = live || (P.lastApps || []).find(w => appKey(w) === k) || pinnedApps().find(p => appKey(p) === k);
    if (item) togglePinApp(item);
  },
  'comp-apps-toggle': () => {
    P.compAppsHover = false;
    P.compAppsOpen = !P.compAppsOpen;
    if (P.compAppsOpen) native('listAppWindows');
    tick();
  },
  'comp-apps-close': () => { P.compAppsOpen = false; P.compAppsHover = false; tick(); },
  'comp-apps-refresh': () => { native('listAppWindows'); },
  'comp-app-switch': el => {
    const k = el.dataset.key;
    const item = compAppsCombined().find(a => appKey(a) === k);
    if (item) launchCompanionApp(item);
  },
  'comp-app-pin': (el, e) => {
    e?.stopPropagation?.();
    const k = el.dataset.key;
    const item = compAppsCombined().find(a => appKey(a) === k);
    if (item) togglePinApp(item);
  },
  'comp-pin-cur': () => {
    if (!P.companion?.appName) return;
    togglePinApp({ app: P.companion.appName, bundleId: P.companion.bundleId || '', title: P.companion.title || '', appIcon: P.companion.appIcon || '', preview: P.companion.preview || '' });
  },
  'companion-exit': () => { P.companion = null; P.compAppsOpen = false; P.compAppsHover = false; native('companionExit'); tick(); },
  perm: el => native('requestPermission', { which: el.dataset.which }),
  'app-done': () => { /* clicking Rehearsal already ended editing; this just re-renders */ WIN.sig = ''; },
  'app-front': el => { const w = findWin(el.dataset.id); if (!w) return; if (w.status === 'not-running') native('launchApp', { bundleId: w.bundleId }); else native('webCmd', { id: w.id, action: 'front' }); },
  'wm-cal': () => { const w = addWindow({ kind: 'cal' }); w.w = 0.62; w.h = 0.8; save(); applyWinGeom(); },
  'av-cal': () => calibrateSync(),
  'vol-test': () => { const c = ac(); c.resume?.(); [60, 64, 67, 72].forEach((m, i) => { const t = c.currentTime + 0.05 + i * 0.25, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); o.connect(g).connect(musicOut()); o.start(t); o.stop(t + 0.55); }); },
  'wm-yt': () => { const w = addWindow({ kind: 'yt' }); w.w = 0.6; w.h = 0.7; save(); applyWinGeom(); },
  'wm-rec': () => { const ex = winList().find(w => w.kind === 'rec'); if (ex) return bringToFront(ex); addWindow({ kind: 'rec' }, { w: 0.42, h: 0.72 }); },
  'wm-piano': () => { window.__spaceTarget = 'piano'; const ex = winList().find(w => w.kind === 'piano'); if (ex) return bringToFront(ex); addWindow({ kind: 'piano' }, { w: 0.68, h: 0.74 }); },
  'wm-solboard': () => { const ex = winList().find(w => w.kind === 'solboard'); if (ex) return bringToFront(ex); addWindow({ kind: 'solboard' }, { w: 0.34, h: 0.84 }); },
  'side-prog-exp': () => { const c = context(now()).cls; if (!c) return; c.sideProgOpen = !c.sideProgOpen; save(); P.sideKey = ''; },
  'side-prog-chk': el => {
    const c = context(now()).cls, it = c?.progress?.find(i => i.id === el.dataset.iid), s = it?.steps?.find(x => x.id === el.dataset.sid); if (!s) return;
    s.done = !s.done; it.updated = Date.now(); if (s.done && it.status === 'red') it.status = 'yellow';
    save(); P.sideKey = ''; refreshWidgetsKeep('prog');
  },
  'wm-prog': () => { const ex = winList().find(w => w.kind === 'prog'); if (ex) return bringToFront(ex); const w = addWindow({ kind: 'prog' }); w.w = 0.5; w.h = 0.8; save(); applyWinGeom(); },
  'wm-sight': () => { const w = addWindow({ kind: 'sight', sr: srDefaults() }); w.w = 0.7; w.h = 0.85; save(); applyWinGeom(); },
  'wm-warmup': () => addWindow({ kind: 'warmup' }),
  'wm-res': el => addWindow({ kind: 'res', resId: el.dataset.id }),
  'wm-lib': el => { const id = el.dataset.id, n = S.files[id]?.name; addWindow(spIsScoreName(n) ? { kind: 'score', score: { fileId: id, name: n } } : { kind: 'file', fileId: id }); },
  'wm-closeall': () => { stopMusicHosts(); const k = curWinKey(); S.windows[k] = []; P.winMenu = false; save(); renderWinMenu(); renderDock(); renderWins(context(now()), true); },
  'win-close': el => {
    const closing = winList().find(w => w.id === el.dataset.id);
    if (closing?.kind === 'rec' && REC.state !== 'idle') {
      if (REC.state === 'rec' || REC.state === 'countin') { recStop(); return toast('Recording stopped. Save or delete it, then close the window.'); }
      if (REC.state === 'review') return toast('Save or delete the recording first.');
    }
    if (closing?.kind === 'rec') { closePlayer(); if (REC.meter) recMeter(false); }
    if (closing?.kind === 'piano' && typeof pianoSeqStop === 'function') pianoSeqStop();
    if (closing && ['score', 'sight', 'res'].includes(closing.kind)) stopMusicHosts();
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
    if (P.winMenu) { P.winMenu = false; renderWinMenu(); renderDock(); }
    const kind = el.dataset.kind, ex = winList().find(w => w.kind === kind);
    if (ex) { bringToFront(ex); return; }
    addWindow({ kind, mu: muDefaults(kind) }, kind === 'tuner' ? { w: 0.72, h: 0.78 } : { w: 0.46, h: 0.68 });
    renderDock();
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
    try { localStorage.removeItem('rehearsal'); } catch { }
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
    const rep = $('[data-ie-evrep]')?.value || (kind === 'birthday' ? 'yearly' : '');
    S.events.push({ id: uid(), kind, date: dateKey(now()), title, time, repeat: rep, yearly: rep === 'yearly', classes: who === 'this' && c ? [c.cls.id] : [] }); save(); P.sideKey = '';
  },
  'ie-ev-del': el => { document.activeElement?.blur?.(); S.events = S.events.filter(e => e.id !== el.dataset.id); save(); P.sideKey = ''; },
  'clip-open': () => { P.clipOpen = !P.clipOpen; P.clipSel = null; renderClip(); if (VIEW === 'present') renderDock(); },
  'clip-copy': () => clipCopy(),
  'clip-paste': () => clipPaste(),
  'clip-all': () => clipSelectAll(true),
  'clip-none': () => clipSelectAll(false),
  'icons-open': () => { P.iconsOpen = !P.iconsOpen; P.dockCustom = false; if (typeof renderDockCustom === 'function') renderDockCustom(); renderIcons(); },
  'icons-reset': () => { if (!confirm('Put every icon back to the default?')) return; S.settings.icons = {}; for (const c of S.classes) for (const r of c.resources) delete r.icon; save(); P.stageKey = ''; P.sideKey = ''; WIN.sig = ''; renderDock(); renderIcons(); },
  'look-open': () => { P.lookOpen = !P.lookOpen; P.autoDrawer = false; renderAutoDrawer(); renderLook(); },
  'look-theme': el => { const c = ieClass(); if (!c) return; const th = c.cls.theme; Object.assign(th, { ...THEMES[el.dataset.k], image: th.image || '', dim: th.dim }); delete th.titleText; delete th.clockText; save(); renderLook(); },
  'look-text-reset': () => { const c = ieClass(); if (!c) return; delete c.cls.theme.titleText; delete c.cls.theme.clockText; save(); renderLook(); },
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
  'win-slideshow': el => {
    const w = findWin(el.dataset.id); if (!w) return;
    const target = winRes(w) || w;
    target.mode = target.mode === 'present' ? 'embed' : 'present';
    save(); WIN.sig = ''; WIN.lastSync = '';
    if (winIsNative(w)) native('webCmd', { id: w.id, action: 'load', url: winTargetURL(w) });
    renderWins(context(now()), true);
  },
  'win-native': el => { const w = findWin(el.dataset.id); if (!w) return; w.native = !winIsNative(w); save(); renderWins(context(now()), true); },
  'win-pin': el => {
    const w = findWin(el.dataset.id), cls = currentClass(); if (!w) return;
    if (!cls) return toast('Show a class first (Class picker in the toolbar) to save this to it.');
    const r = w.kind === 'file' ? { id: uid(), title: winTitle(w).replace(/\.[^.]+$/, ''), fileId: w.fileId }
      : w.kind === 'files' ? { id: uid(), title: 'Files', filesBrowser: true }
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
  'ink-undo': () => inkDoUndo(),
  'ink-clear': () => { inkPushUndo(); inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0); inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height); inkCtx.restore(); saveInk(); toast('Drawing cleared — press Undo or ⌘Z to restore.'); },
  'ink-close': () => {
    P.ink.on = false;
    const sr = stageNativeRes(true);
    if (sr && sr.markupMode) { sr.markupMode = false; P.forceStageUrl = sr.id; P.stageKey = ''; WIN.lastSync = ''; }
    updateInkUI(); renderDock(); tick();
  },
  // classes
  'class-sel': el => { SEL_CLASS = el.dataset.id; renderEditor(); renderClip(); $('#e-main').scrollTop = 0; },
  'class-add': () => { const c = newClass('New class', S.classes.length); S.classes.push(c); SEL_CLASS = c.id; save(); renderEditor(); },
  'class-dup': () => { const c = S.classes.find(x => x.id === SEL_CLASS); const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.name += ' (copy)'; d.notes = {}; d.automations.forEach(a => a.id = uid()); S.classes.push(d); SEL_CLASS = d.id; save(); renderEditor(); },
  'class-del': () => {
    const c = S.classes.find(x => x.id === SEL_CLASS);
    if (!confirm(`Delete “${c.name}” and its notes? It will also be removed from bell schedules.`)) return;
    S.classes = S.classes.filter(x => x !== c); S.templates.forEach(t => t.periods = t.periods.filter(p => p.classId !== c.id)); save(); renderEditor();
  },
  'class-preview': () => { P.pinned = SEL_CLASS; S.settings.lastPinned = P.pinned || ''; save(); go('present'); },
  theme: el => { const c = selClass(); c.theme = { ...THEMES[el.dataset.k], image: c.theme.image || '' }; save(); renderEditor(); },
  'theme-text-reset': () => { const c = selClass(); if (!c) return; delete c.theme.titleText; delete c.theme.clockText; save(); renderEditor(); },
  'theme-image': async () => { const [f] = await pickFile('image/*'); if (!f) return; const id = await storeFile(f); selClass().theme.image = 'file:' + id; save(); renderEditor(); },
  'theme-image-clear': () => { selClass().theme.image = ''; save(); renderEditor(); },
  'agenda-add': () => { selClass().agenda.push({ text: '', min: 0 }); save(); renderEditor(); $$('.agenda-row input')[$$('.agenda-row').length * 2 - 2]?.focus(); },
  'agenda-del': el => { const c = VIEW === 'edit' ? selClass() : ieClass()?.cls; if (!c) return; c.agenda.splice(el.dataset.k, 1); TL_SEL = null; save(); tlRerender(); },
  'res-add-url': () => { const u = prompt('Paste a link (Google Slides/Docs/Drive, YouTube, Canva, any web page):'); if (!u) return; const url = /^https?:\/\//.test(u.trim()) ? u.trim() : 'https://' + u.trim(); selClass().resources.push({ id: uid(), title: guessTitle(url), url, mode: 'embed' }); save(); renderEditor(); },
  'res-add-file': async () => { const fs = await pickFile('application/pdf,image/*,video/*,audio/*', true); for (const f of fs) { const id = await storeFile(f); selClass().resources.push({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), fileId: id }); } save(); renderEditor(); },
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
  'ev-add': el => { const kind = el.dataset.kind, ev = { id: uid(), kind, date: dateKey(new Date()), title: '', time: '', yearly: kind === 'birthday' }; S.events.push(ev); save(); renderEditor(); const inp = $(`input[data-ev-id="${ev.id}"]`); if (inp) { inp.scrollIntoView({ block: 'nearest' }); inp.focus(); } },
  'ev-del': el => { S.events.splice(el.dataset.k, 1); save(); renderEditor(); },
  'ev-clear-past': () => { const k = dateKey(new Date()); S.events = S.events.filter(e => (evRepeat(e) && (!e.until || e.until >= k)) || !e.date || e.date >= k); save(); renderEditor(); },
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
  'tour-replay': () => { S.settings.tourDone = false; P.tourSteps = null; go('present'); setTimeout(() => startTour(), 120); },
  'feature-tour': el => {
    const g = FEATURE_GUIDES.find(x => x.id === el.dataset.fid);
    if (!g || !g.steps?.length) return;
    go('present');
    setTimeout(() => startTour(g.steps), 140);
  },
  'help-open': () => {
    TAB = 'tutorials'; go('edit');
    setTimeout(() => { $('.help-search')?.focus(); }, 80);
  },
  'whats-new': () => openWhatsNewModal(true),
  'bug-report': () => triggerBugReport(),
  'tour-prev': () => stepTour(-1),
  'tour-next': () => stepTour(1),
  'tour-skip': () => endTour(),
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
  const key = e => {
    if (!box.isConnected) return done(true);
    if (e.code === 'Space') { e.preventDefault(); tap(e); }
    if (e.key === 'Escape') { e.preventDefault(); done(true); }
  };
  let t1 = 0, t2 = 0, timer = 0;
  const done = cancel => {
    document.removeEventListener('keydown', key, true);
    clearTimeout(t1); clearTimeout(t2); clearTimeout(timer);
    if (cancel) return box.remove();
    if (diffs.length < 5) { st.textContent = 'Not enough taps. Try again.'; pad.disabled = true; box.querySelector('[data-av="close"]').textContent = 'Close'; return; }
    const m = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const ms = setAvDelay(m * 1000);
    st.innerHTML = `Done: <b>${ms} ms</b> on this ${DEVICE}.`; pad.disabled = true; box.querySelector('[data-av="close"]').textContent = 'Close';
    document.querySelectorAll('[data-action-input="av-delay"]').forEach(v => { v.value = ms; v.nextElementSibling.textContent = ms + ' ms'; });
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); tap(e); });
  box.querySelector('[data-av="close"]').onclick = () => done(true);
  document.addEventListener('keydown', key, true);
  t1 = setTimeout(() => { st.textContent = 'Get ready…'; }, 500);
  t2 = setTimeout(() => { st.textContent = 'Tap now!'; }, (t0 - c.currentTime + lead * beat - 0.2) * 1000);
  timer = setTimeout(() => done(false), (t0 - c.currentTime + (lead + n) * beat + 0.6) * 1000);
}
const CHANGE = {
  'board-paper': el => { S.settings.boardPaper = el.value; save(); updateInkUI(); },
  pin: el => { P.pinned = el.value || null; S.settings.lastPinned = P.pinned || ''; save(); P.layoutKey = ''; stopMusicHosts(); renderDock(); },
  'ink-size': el => { P.ink.size = Number(el.value); },
  'noise-beep': el => { NOISE.beep = el.checked; },
  'noise-dyn': el => { S.settings.noiseDyn = el.checked; save(); rerenderTool('noise'); },
  'tt-sound': el => { const T = (S.settings.timerTool ||= {}); T.sound = el.value; if (el.value !== 'none') T.lastSound = el.value; save(); rerenderTool('timer'); },
  'rand-norep': el => { R.noRepeat = el.checked; R.used.clear(); },
  'note-class': el => { NOTE_CLASS = el.value; renderEditor(); },
  'note-date': el => { if (el.value) { NOTE_DATE = el.value; renderEditor(); } },
  'grlog-toggle': el => {
    S.settings.saveGradeRecordings = el.checked; save();
    if (!el.checked && HAS_SERVER) fetch('/api/purge-grlogs?keep=0', { method: 'POST', headers: { 'X-Token': TOKEN } }).catch(() => { });
  },
  'rhythm-sys': el => { S.settings.rhythmSystem = el.value; save(); refreshRhythmCounts(); },
  'sim-on': el => { const s = S.settings.sim; s.on = el.checked; s.setAt = Date.now(); P.fired.clear(); save(); },
  'sim-time': el => { const s = S.settings.sim; s.time = el.value || s.time; s.setAt = Date.now(); P.fired.clear(); save(); },
};
const INPUT = {
  'music-vol': el => { setMusicVol(+el.value); el.nextElementSibling.textContent = Math.round(+el.value * 100) + '%'; },
  'av-delay': el => { const ms = setAvDelay(+el.value); el.nextElementSibling.textContent = ms + ' ms'; },
  'noise-limit': el => { NOISE.limit = Number(el.value); const l = $('#nm .lim'); if (l) l.style.left = NOISE.limit + '%'; const d = $('#nm-limdyn'); if (d) d.textContent = dynOf(NOISE.limit); },
  'rand-n': el => { R.groupN = clamp(Number(el.value) || 4, 2, 12); },
  'tt-field': el => { const T = (S.settings.timerTool ||= {}); T[el.dataset.k] = el.dataset.k === 'min' ? (Number(el.value) || T.min) : el.value; save(); },
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
  if (P.ink.on && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); inkDoUndo(); return; }
  if (e.key === 'ArrowRight') A['agenda-next']();
  else if (e.key === 'ArrowLeft') A['agenda-prev']();
  else if (e.key === 'Escape') {
    if (P.tour != null) endTour();
    else if (P.winMenu) { P.winMenu = false; renderWinMenu(); renderDock(); }
    else if (P.dockMore) { P.dockMore = false; renderDockMore(); renderDock(); }
    else if (P.dockCustom) { P.dockCustom = false; renderDockCustom(); renderDock(); }
    else if (P.iconsOpen) { P.iconsOpen = false; renderIcons(); }
    else if (P.clipOpen) { P.clipOpen = false; renderClip(); renderDock(); }
    else if (P.lookOpen) { P.lookOpen = false; renderLook(); }
    else if (P.autoDrawer) { P.autoDrawer = false; renderAutoDrawer(); }
    else if (P.groupMenu) { P.groupMenu = null; renderGroupMenu(); }
    else if (P.webModeMenu) { P.webModeMenu = null; renderWebModeMenu(); WIN.sig = ''; renderWins(context(now()), true); tick(); }
    else if (P.snapFor) { P.snapFor = null; renderSnapMenu(); }
    else if (BM.open) { BM.open = null; renderBmMenu(); }
    else if (P.editMode) A['edit-mode']();
    else if (typeof PDF_ACTIVE !== 'undefined' && PDF_ACTIVE?.isAnnot?.()) PDF_ACTIVE.closeAnnot();
    else if (P.stageMax) { P.stageMax = false; P.stageKey = ''; WIN.lastSync = ''; }
    else if (P.overlay) A['overlay-dismiss']();
    else if (P.ink.on) A['ink-close']();
    else P.signal = null;
  }
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
window.__companionState = on => { if (!on && P.companion) { P.companion = null; P.compAppsOpen = false; P.compAppsHover = false; tick(); } };
let compHoverT = 0;
document.addEventListener('pointerover', e => {
  if (!P.companion || P.compAppsOpen) return;
  if (e.target.closest?.('.comp-apps-btn')) {
    clearTimeout(compHoverT);
    compHoverT = setTimeout(() => {
      if (P.companion && !P.compAppsOpen && $('.comp-apps-btn:hover')) {
        P.compAppsOpen = true; P.compAppsHover = true; native('listAppWindows'); tick();
      }
    }, 240);
  }
});
document.addEventListener('pointerout', e => {
  if (e.target.closest?.('.comp-apps-btn')) clearTimeout(compHoverT);
  if (P.companion && P.compAppsOpen && P.compAppsHover && e.target.id === 'p-companion' && !e.relatedTarget) {
    P.compAppsOpen = false; P.compAppsHover = false; tick();
  }
});
document.addEventListener('mouseleave', () => {
  clearTimeout(compHoverT);
  if (P.companion && P.compAppsOpen && P.compAppsHover) { P.compAppsOpen = false; P.compAppsHover = false; tick(); }
});

const TOUR_STEPS = [
  { sel: '[data-dock-id="editmode"]', fallback: '#p-dock', title: '1. Edit the Page (Quick Edit)', body: 'Click Quick edit to change the class name, warm-up, agenda, or class colors right on the Present screen.' },
  { sel: '[data-dock-id="window"]', fallback: '#p-dock', title: '2. Open Windows (＋ Open)', body: 'Click ＋ Open to launch Sight Reading, Score Practice, the Files browser, web pages, Piano, Tuner, Metronome, or switch to External Apps.' },
  { sel: '.win[data-win="__tour_win"] .win-bar', fallback: '.win[data-win="__tour_win"]', sampleWin: true, title: '3. Pin & Arrange Windows', body: 'Every floating window has a Pin button to save it as a tab for this class, plus Tile and Maximize buttons to arrange your screen.' },
  { sel: '#p-dock .dock-more', fallback: '#p-dock', title: '4. Customize the Toolbar (⋯)', body: 'Click ⋯ → Customize toolbar to add, hide, or drag toolbar buttons into your own order, change the toolbar color, or open Report a Bug.' },
  { sel: '[data-dock-id="edit"]', fallback: '#p-dock', title: '5. Setup, Settings & Tutorials', body: 'Click Setup to edit your classes, bell schedules, files, and settings. If you want to learn more, check out Setup → Tutorials anytime, or just close this and explore!' },
];
function activeTourSteps() { return P.tourSteps || TOUR_STEPS; }
function startTour(customSteps = null, force = false) {
  if (VIEW !== 'present') return;
  if (!customSteps && !force && S.settings.tourDone) return;
  if (P.tour != null) endTour(true);
  P.tourSteps = Array.isArray(customSteps) && customSteps.length ? customSteps : null;
  P.tourPrevPinned = P.pinned;
  P.tourPrevEdit = !!P.editMode;
  P.tourPrevInk = !!P.ink.on;
  const ctx0 = context(now());
  P.tourPrevStageKey = ctx0.key;
  P.tourPrevStageSel = P.stageSel[ctx0.key];
  const cur = ctx0.cls;
  const withAg = (cur && cur.agenda?.length ? cur : null) || S.classes.find(c => c.agenda && c.agenda.length > 0);
  if (withAg) {
    P.pinned = withAg.id;
  } else {
    P.tourSampleCls = Object.assign(newClass('Concert Band', 0), {
      id: '__tour_cls', __tourSample: true, subtitle: 'Sample Class',
      warmup: 'Play a concert B♭ scale in whole notes, listening for balance across the ensemble.',
      agenda: [{ text: 'Warm-up & tuning', min: 8 }, { text: 'Sight-reading exercise', min: 10 }, { text: 'Rehearsal: m. 17–48', min: 25 }],
      resources: [
        { id: '__tour_r1', title: 'Warm-up Chorale', sight: { mode: 'solfege' } },
        { id: '__tour_r2', title: 'Rehearsal Slides', url: 'https://docs.google.com/presentation', mode: 'embed' },
      ],
    });
    P.pinned = '__tour_cls';
  }
  if (P.stageMax) P.stageMax = false;
  P.tour = 0;
  P.layoutKey = P.sideKey = P.stageKey = ''; WIN.sig = '';
  renderDock(); tick(); renderTour();
}
function endTour(silent = false) {
  const wasFull = !P.tourSteps;
  clearTimeout(P.tourDelayTimer);
  P.tour = null;
  P.tourSteps = null;
  P.tourWin = false;
  tourClosePopovers();
  tourRemoveTempWins();
  if (P.timers.some(t => t.__tourTemp)) {
    P.timers = P.timers.filter(t => !t.__tourTemp);
    renderTimers();
  }
  if ('tourPrevEdit' in P) { P.editMode = P.tourPrevEdit; delete P.tourPrevEdit; }
  if ('tourPrevInk' in P) {
    if (P.ink.on !== P.tourPrevInk) { P.ink.on = P.tourPrevInk; updateInkUI(); }
    delete P.tourPrevInk;
  }
  if (P.tourSampleCls) {
    S.classes = S.classes.filter(c => c.id !== '__tour_cls' && !c.__tourSample);
    P.tourSampleCls = null;
  }
  if ('tourPrevPinned' in P) {
    P.pinned = P.tourPrevPinned;
    delete P.tourPrevPinned;
  }
  if ('tourPrevStageKey' in P) {
    if (P.tourPrevStageSel !== undefined) P.stageSel[P.tourPrevStageKey] = P.tourPrevStageSel;
    delete P.tourPrevStageKey; delete P.tourPrevStageSel;
  }
  P.layoutKey = P.sideKey = P.stageKey = ''; WIN.sig = '';
  if (wasFull && !silent) { S.settings.tourDone = true; save(); }
  document.querySelectorAll('.tour-backdrop, .tour-ring, .tour-card').forEach(el => el.remove());
  renderDock(); tick();
}
function stepTour(d) {
  if (P.tour == null) return;
  const steps = activeTourSteps(), n = P.tour + d;
  if (n >= steps.length) return endTour();
  P.tour = Math.max(0, n);
  renderTour();
}
function renderTour() {
  clearTimeout(P.tourDelayTimer);
  document.querySelectorAll('.tour-backdrop, .tour-ring, .tour-card').forEach(el => el.remove());
  if (P.tour == null || VIEW !== 'present') return;
  const steps = activeTourSteps(), step = steps[P.tour]; if (!step) return endTour();
  const wantWin = !!step.sampleWin;
  if (!!P.tourWin !== wantWin) { P.tourWin = wantWin; renderWins(context(now()), true); }
  if (typeof step.setup === 'function') {
    try { step.setup(); } catch { }
  }
  const paintOverlay = () => {
    if (P.tour == null || VIEW !== 'present') return;
    document.querySelectorAll('.tour-backdrop, .tour-ring, .tour-card').forEach(el => el.remove());
    const target = (step.sel && $(step.sel)) || (step.fallback && $(step.fallback));
    const r = target && target.offsetWidth > 0 ? target.getBoundingClientRect() : null;
    const bd = document.createElement('div'); bd.className = 'tour-backdrop'; bd.onclick = () => endTour();
    document.body.appendChild(bd);
    if (r) {
      const pad = 6;
      const ring = document.createElement('div'); ring.className = 'tour-ring';
      Object.assign(ring.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
      document.body.appendChild(ring);
    }
    const card = document.createElement('div'); card.className = 'tour-card';
    card.innerHTML = `<div class="tour-top"><span>Step ${P.tour + 1} of ${steps.length}</span><button data-action="tour-skip">Close</button></div>
      <h3>${esc(step.title)}</h3><p>${esc(step.body)}</p>
      <div class="tour-foot"><button data-action="tour-prev" ${P.tour === 0 ? 'disabled' : ''}>← Back</button>
      <div class="tour-dots">${steps.map((_, i) => `<i class="${i === P.tour ? 'on' : ''}"></i>`).join('')}</div>
      <button class="primary" data-action="tour-next">${P.tour === steps.length - 1 ? 'Done' : 'Next →'}</button></div>`;
    document.body.appendChild(card);
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = (innerWidth - cw) / 2, top = (innerHeight - ch) / 2;
    if (r) {
      if (r.width > innerWidth * 0.72 && r.height > innerHeight * 0.65) {
        left = innerWidth - cw - 20;
        top = innerHeight - ch - 20;
      } else if (r.right + 16 + cw < innerWidth - 12 && r.height > 200) {
        left = r.right + 16;
        top = clamp(r.top + 12, 12, innerHeight - ch - 12);
      } else if (r.left - 16 - cw > 12 && r.height > 200) {
        left = r.left - cw - 16;
        top = clamp(r.top + 12, 12, innerHeight - ch - 12);
      } else {
        left = clamp(r.left + r.width / 2 - cw / 2, 12, innerWidth - cw - 12);
        top = r.bottom + 14 + ch < innerHeight - 12 ? r.bottom + 14 : Math.max(12, r.top - ch - 14);
      }
    }
    card.style.left = left + 'px'; card.style.top = top + 'px';
  };
  if (step.delay) P.tourDelayTimer = setTimeout(paintOverlay, step.delay);
  else paintOverlay();
}

// ---------- Searchable Files Window (Audio / PDF / Scores / Images / Video + single-file Pin)
let FB_AUDIO = null, FB_AUDIO_ID = null;
function fbStopAudio() {
  if (FB_AUDIO) { try { FB_AUDIO.pause(); } catch { } FB_AUDIO = null; FB_AUDIO_ID = null; }
}
function fbCategoryOf(id, f) {
  if (!f) return 'other';
  if (typeof spIsScoreName === 'function' && spIsScoreName(f.name || '')) return 'score';
  const m = (f.mime || '').toLowerCase(), n = (f.name || '').toLowerCase();
  if (m.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac|flac)$/.test(n)) return 'audio';
  if (m === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(n)) return 'video';
  return 'other';
}
function fbPinFileToClass(id) {
  const f = S.files[id]; if (!f) return;
  const cls = currentClass();
  if (!cls) return toast('Switch to a class first to pin a file as a tab.');
  const cat = fbCategoryOf(id, f);
  const existing = cls.resources.find(r => r.fileId === id || r.score?.fileId === id);
  if (existing) {
    P.stageSel[context(now()).key] = existing.id;
    P.stageKey = ''; tick();
    toast(`Switched to pinned tab “${existing.title}”`);
    return;
  }
  const cleanTitle = (f.name || 'File').replace(/\.[^.]+$/, '');
  const res = cat === 'score'
    ? { id: uid(), title: cleanTitle, score: { fileId: id, name: f.name } }
    : { id: uid(), title: cleanTitle, fileId: id };
  cls.resources.push(res);
  P.stageSel[context(now()).key] = res.id;
  save(); P.stageKey = ''; tick();
  toast(`Pinned “${cleanTitle}” to ${cls.name}`);
}
function fbOpenFileFloating(id) {
  const f = S.files[id]; if (!f) return;
  const cat = fbCategoryOf(id, f);
  if (cat === 'score') {
    const saved = S.scoreSettings?.[id];
    addWindow({ kind: 'score', score: saved ? JSON.parse(JSON.stringify(saved)) : { fileId: id, name: f.name } });
  } else {
    const sz = cat === 'audio' ? { w: 0.36, h: 0.24 } : { w: 0.58, h: 0.78 };
    addWindow({ kind: 'file', fileId: id }, sz);
  }
}
function fbDeleteFile(id) {
  const f = S.files[id]; if (!f) return false;
  const used = S.classes.filter(c => c.resources.some(r => r.fileId === id || r.score?.fileId === id)).map(c => c.name);
  const msg = used.length
    ? `Delete “${f.name}” from your library?\n\nIt is currently pinned in: ${used.join(', ')}. Removing it will also remove those tabs.`
    : `Delete “${f.name}” from your library? This cannot be undone.`;
  if (!confirm(msg)) return false;
  if (FB_AUDIO_ID === id) fbStopAudio();
  for (const c of S.classes) {
    c.resources = c.resources.filter(r => r.fileId !== id && r.score?.fileId !== id);
  }
  for (const k of Object.keys(S.windows || {})) {
    S.windows[k] = S.windows[k].filter(w => w.fileId !== id && w.score?.fileId !== id);
  }
  deleteFile(id);
  P.stageKey = ''; WIN.sig = '';
  toast(`Deleted “${f.name}”`);
  tick();
  return true;
}
function fbPinBrowserToClass() {
  const cls = currentClass();
  if (!cls) return toast('Switch to a class first to pin Files as a tab.');
  const existing = cls.resources.find(r => r.filesBrowser);
  if (existing) {
    P.stageSel[context(now()).key] = existing.id;
    P.stageKey = ''; tick();
    toast('Switched to pinned Files tab');
    return;
  }
  const res = { id: uid(), title: 'Files', filesBrowser: true };
  cls.resources.push(res);
  P.stageSel[context(now()).key] = res.id;
  save(); P.stageKey = ''; tick();
  toast(`Pinned Files browser to ${cls.name}`);
}
function mountFilesBrowser(host) {
  if (!host) return;
  if (!host._fbState) host._fbState = { q: '', cat: 'all', openId: null, pdfState: {}, scoreState: {} };
  const st = host._fbState;
  const hostKey = host.dataset.filesWin || 'fb';
  const icoOf = c => c === 'audio' ? 'ico:audio' : c === 'pdf' ? 'ico:file' : c === 'score' ? 'ico:score' : c === 'image' ? 'ico:image' : c === 'video' ? 'ico:video' : 'ico:attach';
  const render = () => {
    const cls = currentClass();
    const isPinned = id => !!cls?.resources.some(r => r.fileId === id || r.score?.fileId === id);
    const inStage = !!host.closest('#stage-content');
    const browserPinned = !!cls?.resources.some(r => r.filesBrowser);
    if (st.openId && S.files[st.openId]) {
      const id = st.openId, f = S.files[id], c = fbCategoryOf(id, f), pin = isPinned(id);
      const src = fileDirectURL(id);
      let bodyHTML = '';
      if (c === 'pdf') bodyHTML = `<div class="pdf-host" data-fb-pdf="${id}"></div>`;
      else if (c === 'score') bodyHTML = `<div class="score-host" data-fb-score="${id}"></div>`;
      else if (c === 'audio') bodyHTML = `<div class="aud-host" data-aud-file="${id}"></div>`;
      else if (c === 'image') bodyHTML = `<img class="fb-img" src="${src}" alt="${esc(f.name)}">`;
      else if (c === 'video') bodyHTML = `<video class="fb-vid" src="${src}" controls></video>`;
      else bodyHTML = `<iframe class="fb-ifr" src="${src}"></iframe>`;
      host.innerHTML = `<div class="fb-wrap fb-viewing">
        <div class="fb-vbar">
          <button class="fb-back" data-fb="back" title="Return to searchable Files list">${IC('ico:chevleft')} Files</button>
          <span class="fb-vtitle"><span class="fb-vic">${IC(icoOf(c))}</span><b>${esc(f.name)}</b></span>
          <button class="fb-btn ${pin ? 'on' : ''}" data-fb="pin-out" data-id="${id}" title="${pin ? 'Pinned as its own tab — click to jump to it' : 'Pin this single file outside as its own class tab'}">${IC('ico:pin')} <span>${pin ? 'Pinned tab' : 'Pin as own tab'}</span></button>
          <button class="fb-btn" data-fb="popout" data-id="${id}" title="Open this file in a separate floating window">${IC('ico:external')} <span>Pop out</span></button>
          <button class="fb-btn fb-del" data-fb="del" data-id="${id}" title="Delete this file from your library">${IC('ico:trash')}</button>
        </div>
        <div class="fb-vbody">${bodyHTML}</div>
      </div>`;
      const pdfEl = host.querySelector('[data-fb-pdf]');
      if (pdfEl && typeof mountPdf === 'function') {
        mountPdf(pdfEl, src, (st.pdfState[id] ||= {}), () => save(), pdfInkOpts(id, {}));
      }
      const scoreEl = host.querySelector('[data-fb-score]');
      if (scoreEl && typeof mountScore === 'function') {
        if (!st.scoreState[id]) {
          const saved = S.scoreSettings?.[id];
          st.scoreState[id] = saved ? JSON.parse(JSON.stringify(saved)) : { fileId: id, name: f.name };
        }
        mountScore(scoreEl, st.scoreState[id], () => save(), 'fb-' + hostKey + '-' + id);
      }
      const audEl = host.querySelector('[data-aud-file]');
      if (audEl && typeof mountAudioPlayer === 'function') mountAudioPlayer(audEl, id);
      return;
    }
    st.openId = null;
    const all = Object.entries(S.files || {}).filter(([, f]) => f && !f.hiddenScore);
    const counts = { all: all.length, audio: 0, pdf: 0, score: 0, image: 0, video: 0 };
    all.forEach(([id, f]) => { const c = fbCategoryOf(id, f); if (counts[c] != null) counts[c]++; });
    const q = (st.q || '').trim().toLowerCase();
    const list = all
      .filter(([id, f]) => {
        const c = fbCategoryOf(id, f);
        if (st.cat !== 'all' && c !== st.cat) return false;
        if (q && !(f.name || '').toLowerCase().includes(q) && !c.includes(q)) return false;
        return true;
      })
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    const cats = [
      ['all', 'All'], ['audio', 'Audio'], ['pdf', 'PDF'], ['score', 'Scores'], ['image', 'Images'], ['video', 'Video'],
    ];
    const prevVal = host.querySelector('.fb-search')?.value;
    const hadFocus = document.activeElement && host.contains(document.activeElement) && document.activeElement.classList.contains('fb-search');
    const selStart = hadFocus ? document.activeElement.selectionStart : null;
    host.innerHTML = `<div class="fb-wrap">
      <div class="fb-top">
        <input class="fb-search" placeholder="Search audio, PDFs, scores, images…" value="${esc(st.q)}">
        ${!inStage ? `<button class="fb-btn ${browserPinned ? 'on' : ''}" data-fb="pin-browser" title="${browserPinned ? 'Files browser is pinned to this class — click to view tab' : 'Pin this Files browser as a tab in the current class'}">${IC('ico:pin')} <span>${browserPinned ? 'Pinned' : 'Pin tab'}</span></button>` : ''}
        <button class="fb-add" data-fb="add" title="Import new files into your library">${IC('ico:plus')} Add files</button>
      </div>
      <div class="fb-cats">
        ${cats.map(([k, lbl]) => `<button class="fb-cat ${st.cat === k ? 'on' : ''}" data-fb="cat" data-v="${k}">${lbl} <span>${counts[k] || 0}</span></button>`).join('')}
      </div>
      <div class="fb-list">
        ${list.length ? list.map(([id, f]) => {
          const c = fbCategoryOf(id, f), pin = isPinned(id), playing = FB_AUDIO_ID === id;
          const sz = f.size ? (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') : '';
          return `<div class="fb-row ${playing ? 'playing' : ''}">
            <button class="fb-open" data-fb="open" data-id="${id}" title="Open ${esc(f.name)} inside this Files browser">
              <span class="fb-ic">${IC(icoOf(c))}</span>
              <span class="fb-meta"><b class="fb-name">${esc(f.name)}</b><small>${c.toUpperCase()}${sz ? ' · ' + sz : ''}</small></span>
            </button>
            ${c === 'audio' ? `<button class="fb-btn ${playing ? 'on' : ''}" data-fb="play" data-id="${id}" title="${playing ? 'Stop audio preview' : 'Play audio preview'}">${IC(playing ? 'ico:stop' : 'ico:play')}</button>` : ''}
            <button class="fb-btn ${pin ? 'on' : ''}" data-fb="pin" data-id="${id}" title="${pin ? 'Pinned as its own tab — click to view tab' : 'Pin this single file outside as its own tab'}">${IC('ico:pin')} <span>${pin ? 'Pinned' : 'Pin'}</span></button>
            <button class="fb-btn fb-del" data-fb="del" data-id="${id}" title="Delete ${esc(f.name)} from your library">${IC('ico:trash')}</button>
          </div>`;
        }).join('') : `<div class="fb-empty">${all.length ? 'No files match your search.' : 'No files in your library yet — click <b>+ Add files</b> or drag &amp; drop files here.'}</div>`}
      </div>
    </div>`;
    const inp = host.querySelector('.fb-search');
    if (inp) {
      if (hadFocus && prevVal != null) { inp.focus(); if (selStart != null) try { inp.setSelectionRange(selStart, selStart); } catch { } }
      inp.addEventListener('input', () => { st.q = inp.value; render(); });
    }
  };
  if (!host._fbBound) {
    host._fbBound = true;
    host.addEventListener('click', async e => {
      const b = e.target.closest('[data-fb]'); if (!b) return;
      const act = b.dataset.fb, id = b.dataset.id;
      if (act === 'cat') { st.cat = b.dataset.v; render(); }
      else if (act === 'open') { fbStopAudio(); st.openId = id; render(); }
      else if (act === 'back') {
        if (host.querySelector('.score-host')) stopMusicHosts();
        fbStopAudio();
        st.openId = null;
        render();
      }
      else if (act === 'popout') fbOpenFileFloating(id);
      else if (act === 'del') {
        if (st.openId === id && host.querySelector('.score-host')) stopMusicHosts();
        if (fbDeleteFile(id)) {
          if (st.openId === id) st.openId = null;
          render();
        }
      }
      else if (act === 'pin' || act === 'pin-out') { fbPinFileToClass(id); render(); }
      else if (act === 'pin-browser') { fbPinBrowserToClass(); render(); }
      else if (act === 'play') {
        if (FB_AUDIO_ID === id) { fbStopAudio(); render(); return; }
        fbStopAudio();
        try {
          const a = new Audio(await fileBlobURL(id));
          FB_AUDIO = a; FB_AUDIO_ID = id;
          a.onended = () => { if (FB_AUDIO === a) { fbStopAudio(); render(); } };
          a.play().catch(() => { });
        } catch { }
        render();
      } else if (act === 'add') {
        const fs = await pickFile('application/pdf,image/*,video/*,audio/*,.mxl,.musicxml,.mscz,.mscx', true);
        for (const f of fs) await storeFile(f);
        if (fs.length) { toast(`Added ${fs.length} file${fs.length > 1 ? 's' : ''} to library`); render(); }
      }
    });
    host.addEventListener('dragover', e => { e.preventDefault(); host.classList.add('fb-drop'); });
    host.addEventListener('dragleave', () => host.classList.remove('fb-drop'));
    host.addEventListener('drop', async e => {
      e.preventDefault(); host.classList.remove('fb-drop');
      const fs = [...(e.dataTransfer?.files || [])];
      for (const f of fs) await storeFile(f);
      if (fs.length) { toast(`Added ${fs.length} file${fs.length > 1 ? 's' : ''} to library`); render(); }
    });
  }
  render();
}

// ---------- 100% In-App Bug Report Modal (auto-screenshot + explanation -> private GitHub Inbox via Cloudflare Worker)
const BUG_REPORT_EMAIL = 'RehearsalApp@pm.me';
const BUG_REPORT_ENDPOINT = 'https://rehearsal-bugs.logan-shippee.workers.dev';
let BUG_STATE = null;
function triggerBugReport() {
  if (IS_NATIVE) {
    native('captureBugReport');
  } else {
    window.__bugReportOpen({ screenshot: '', os: navigator.platform || 'Web', version: WEB_VERSION || '', logTail: '' });
  }
}
window.__bugReportResult = res => {
  const m = $('#bug-modal');
  if (!m) {
    if (res?.ok) toast('Bug report sent — thank you!');
    return;
  }
  const stEl = m.querySelector('#bug-status');
  const sendBtn = m.querySelector('[data-bug="send"]');
  if (res?.ok) {
    if (stEl) {
      stEl.className = 'bug-status ok';
      stEl.innerHTML = `${IC('ico:check')} <span><b>Sent!</b> Your feedback${res.includedScreenshot ? ' and screenshot' : ''} has been sent. Thank you!</span>`;
      stEl.hidden = false;
    }
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sent ✓'; }
    toast('Feedback sent — thank you!');
    setTimeout(() => { $('#bug-modal')?.remove(); }, 1800);
  } else {
    if (stEl) {
      stEl.className = 'bug-status err';
      stEl.innerHTML = `${IC('ico:warn')} <span>Couldn’t send right now (${esc(res?.error || 'no internet connection')}).${res?.savedPath ? ' A backup copy was saved locally.' : ''} You can try again or click <b>Save Report File…</b></span>`;
      stEl.hidden = false;
    }
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Retry Send'; }
  }
};
window.__bugReportOpen = data => {
  $('#bug-modal')?.remove();
  BUG_STATE = {
    screenshot: data?.screenshot || '',
    includeShot: !!(data?.screenshot),
    cat: 'Bug',
    os: data?.os || navigator.platform || 'Unknown OS',
    version: data?.version || WEB_VERSION || 'local',
    logTail: data?.logTail || '',
    view: VIEW,
    tourDemo: !!data?.tourDemo,
  };
  const m = document.createElement('div');
  m.id = 'bug-modal';
  m.className = 'bug-backdrop';
  if (BUG_STATE.tourDemo) m.dataset.tourDemo = '1';
  const cats = [['Bug', 'Bug'], ['Confusing UI', 'Confusing UI'], ['Audio / Grading', 'Audio / Grading'], ['Idea', 'Feature idea']];
  m.innerHTML = `<div class="bug-card" role="dialog" aria-label="Report a bug">
    <div class="bug-head">
      <h3>${IC('ico:warn')} Report a Bug or Feedback</h3>
      <button class="bug-x" data-bug="close" title="Close">${IC('ico:close')}</button>
    </div>
    <div class="bug-cats">
      ${cats.map(([v, l]) => `<button type="button" class="bug-cat ${v === 'Bug' ? 'on' : ''}" data-bug="cat" data-v="${v}">${l}</button>`).join('')}
    </div>
    ${BUG_STATE.screenshot ? `<div class="bug-shot-wrap">
      <img class="bug-shot" src="${BUG_STATE.screenshot}" alt="Captured screen preview">
      <div class="bug-shot-bar">
        <label><input type="checkbox" id="bug-inc-shot" checked> Include screenshot (uncheck if student names are visible)</label>
        <button type="button" class="bug-sm-btn" data-bug="copy-shot">Copy Screenshot</button>
      </div>
    </div>` : ''}
    <label class="bug-fld"><span>What went wrong? (or what would make this better?)</span>
      <textarea id="bug-desc" rows="4" placeholder="Describe what you were doing and what happened…"></textarea>
    </label>
    <label class="bug-fld"><span>Your email (optional — only if you’d like a reply)</span>
      <input type="email" id="bug-reply" placeholder="name@school.edu">
    </label>
    <div class="bug-meta">Sent directly inside Rehearsal (no sign-in required) · Rehearsal ${esc(BUG_STATE.version)} · ${esc(BUG_STATE.os)}</div>
    <div id="bug-status" class="bug-status" hidden></div>
    <div class="bug-foot">
      <button type="button" class="bug-btn" data-bug="save">Save File…</button>
      <span class="grow"></span>
      <button type="button" class="bug-btn" data-bug="close">Cancel</button>
      <button type="button" class="bug-btn primary" data-bug="send">Send Report</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  if (!BUG_STATE.tourDemo) m.querySelector('#bug-desc')?.focus();
  m.addEventListener('click', async e => {
    if (e.target === m) { m.remove(); return; }
    const b = e.target.closest('[data-bug]'); if (!b) return;
    const act = b.dataset.bug;
    if (act === 'close') { m.remove(); return; }
    if (act === 'cat') {
      BUG_STATE.cat = b.dataset.v;
      m.querySelectorAll('.bug-cat').forEach(x => x.classList.toggle('on', x === b));
      return;
    }
    const incShot = m.querySelector('#bug-inc-shot') ? m.querySelector('#bug-inc-shot').checked : false;
    const desc = (m.querySelector('#bug-desc')?.value || '').trim();
    const replyEmail = (m.querySelector('#bug-reply')?.value || '').trim();
    if (act === 'copy-shot') {
      if (BUG_STATE.screenshot) {
        native('copyImage', { dataUrl: BUG_STATE.screenshot });
        toast('Screenshot copied — press ⌘V / Ctrl+V to paste anywhere.');
      }
      return;
    }
    if (act === 'save') {
      const reportHTML = `<!doctype html><html><head><meta charset="utf-8"><title>Rehearsal Bug Report</title><style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#111}pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto;font-size:12px}img{max-width:100%;border:1px solid #d1d5db;border-radius:8px;margin-top:8px}</style></head><body><h2>Rehearsal Feedback — ${esc(BUG_STATE.cat)}</h2><p><b>Date:</b> ${new Date().toISOString()}<br><b>Version:</b> ${esc(BUG_STATE.version)}<br><b>OS:</b> ${esc(BUG_STATE.os)}<br><b>View:</b> ${esc(BUG_STATE.view)}${replyEmail ? `<br><b>From:</b> ${esc(replyEmail)}` : ''}</p><h3>Description</h3><p style="white-space:pre-wrap">${esc(desc || '(No description entered)')}</p>${incShot && BUG_STATE.screenshot ? `<h3>Screenshot</h3><img src="${BUG_STATE.screenshot}">` : ''}${BUG_STATE.logTail ? `<h3>Recent Log</h3><pre>${esc(BUG_STATE.logTail)}</pre>` : ''}</body></html>`;
      const fname = `rehearsal-report-${new Date().toISOString().slice(0, 10)}.html`;
      if (!native('saveText', { name: fname, text: reportHTML })) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([reportHTML], { type: 'text/html' })); a.download = fname; a.click();
      }
      toast('Bug report saved!');
      m.remove();
      return;
    }
    if (act === 'send') {
      if (!desc) {
        const stEl = m.querySelector('#bug-status');
        if (stEl) { stEl.className = 'bug-status err'; stEl.textContent = 'Please add a short note describing what happened.'; stEl.hidden = false; }
        m.querySelector('#bug-desc')?.focus();
        return;
      }
      const sendBtn = m.querySelector('[data-bug="send"]');
      const stEl = m.querySelector('#bug-status');
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
      if (stEl) { stEl.className = 'bug-status info'; stEl.textContent = 'Sending report inside Rehearsal…'; stEl.hidden = false; }
      const payload = {
        to: BUG_REPORT_EMAIL,
        endpoint: BUG_REPORT_ENDPOINT,
        category: BUG_STATE.cat,
        description: desc,
        replyEmail,
        version: BUG_STATE.version,
        os: BUG_STATE.os,
        view: BUG_STATE.view,
        logTail: (BUG_STATE.logTail || '').slice(-2000),
        screenshot: incShot ? BUG_STATE.screenshot : '',
      };
      if (IS_NATIVE) {
        native('submitBugReport', payload);
      } else {
        try {
          const fd = new FormData();
          fd.append('_subject', `[Rehearsal ${payload.category}] ${desc.split('\n')[0].slice(0, 72)}`);
          fd.append('_captcha', 'false');
          fd.append('_template', 'table');
          if (replyEmail) fd.append('_replyto', replyEmail);
          fd.append('category', payload.category);
          fd.append('message', payload.description);
          fd.append('version', payload.version);
          fd.append('os', payload.os);
          fd.append('view', payload.view);
          if (payload.logTail) fd.append('log', payload.logTail);
          const r = await fetch(BUG_REPORT_ENDPOINT, { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
          window.__bugReportResult({ ok: r.ok, status: r.status, includedScreenshot: false });
        } catch (err) {
          window.__bugReportResult({ ok: false, error: err?.message || 'Network error' });
        }
      }
    }
  });
};

// ---------- What's New & Bug Report Welcome Pop-up (shown once on the first opening after each update)
// For each future release, bump `id` to the new version and update `featured` / `items` with what's new.
const WHATS_NEW = {
  id: '1.1.8',
  title: 'Welcome to Rehearsal',
  intro: 'Thanks for updating Rehearsal! Here is what is new in this release.',
  featured: [
    { icon: 'ico:sight', title: 'Sight Reading with Live Grading', body: 'Generate custom rhythm or solfege exercises at any difficulty and grade students live using a microphone or the space bar.' },
    { icon: 'ico:score', title: 'Score Playback, Vocal Recording & Grading', body: 'Play back MusicXML or MuseScore files with per-part mixing, record sung vocal tracks with custom headphone backing, and grade any voice part live.' },
  ],
  more: [
    'Files tab & built-in viewer',
    'Moveable & resizable timers',
    'Bell schedules & daily routines',
    'Pinned class tabs & folders',
    'Tuner, Metronome & Piano',
    'Voice Recorder & Solfege Board',
    'Annotate & Whiteboard',
    'Quick Edit & custom toolbar',
    'Step-by-step Tutorials tab',
  ],
};
function openWhatsNewModal(force = false) {
  if (!force && S.settings.seenWhatsNew === WHATS_NEW.id) return;
  $('#wn-modal')?.remove();
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
  const bugKey = isMac ? '⌘⇧B' : 'Ctrl+Shift+B';
  const rowHTML = it => `<li><span class="wn-ic">${IC(it.icon)}</span><div><b>${esc(it.title)}</b><span>${esc(it.body)}</span></div></li>`;
  const markSeen = () => {
    if (S.settings.seenWhatsNew !== WHATS_NEW.id) { S.settings.seenWhatsNew = WHATS_NEW.id; save(); }
  };
  const m = document.createElement('div');
  m.id = 'wn-modal';
  m.className = 'bug-backdrop';
  m.innerHTML = `<div class="bug-card wn-card" role="dialog" aria-label="${esc(WHATS_NEW.title)}">
    <div class="bug-head">
      <h3>${IC('ico:book')} ${esc(WHATS_NEW.title)}</h3>
      <button class="bug-x" data-wn="close" title="Close">${IC('ico:close')}</button>
    </div>
    <p class="wn-intro">${esc(WHATS_NEW.intro)}</p>
    ${WHATS_NEW.featured?.length ? `<div class="wn-sec">Featured Highlights</div><ul class="wn-list wn-featured">${WHATS_NEW.featured.map(rowHTML).join('')}</ul>` : ''}
    ${WHATS_NEW.more?.length ? `<div class="wn-sec">More Features</div><ul class="wn-compact">${WHATS_NEW.more.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="wn-more">Want to learn more? You can explore on your own, or check out the step-by-step walkthroughs anytime in <b>Setup → Tutorials</b>.</p>
    <div class="wn-bug">
      <span class="wn-ic">${IC('ico:warn')}</span>
      <div>
        <b>Spotted a bug or have an idea?</b>
        <p>Press <kbd>${bugKey}</kbd> or open <b>⋯ → Report a Bug</b> anytime. Rehearsal grabs a screenshot automatically (uncheck it if student names are visible) and sends your note straight from the app, with no sign-in needed.</p>
      </div>
    </div>
    <div class="bug-foot wn-foot">
      <button type="button" class="bug-btn" data-wn="tutorials">${IC('ico:book')} Tutorials</button>
      <button type="button" class="bug-btn" data-wn="bug">${IC('ico:warn')} Report a Bug</button>
      <span class="grow"></span>
      <button type="button" class="bug-btn primary" data-wn="close">Continue</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  const close = (allowTour = false) => {
    markSeen();
    m.remove();
    if (allowTour && VIEW === 'present' && !S.settings.seenBasicTour) {
      S.settings.seenBasicTour = true; save();
      setTimeout(() => startTour(null, true), 160);
    }
  };
  m.addEventListener('click', e => {
    if (e.target === m) { close(!force); return; }
    const b = e.target.closest('[data-wn]'); if (!b) return;
    const act = b.dataset.wn;
    if (act === 'tutorials') {
      close(false);
      TAB = 'tutorials'; go('edit');
      setTimeout(() => { $('.help-search')?.focus(); }, 80);
    } else if (act === 'bug') {
      close(false);
      triggerBugReport();
    } else {
      close(!force);
    }
  });
}

// Help search inside Setup → Tutorials
document.addEventListener('input', e => {
  if (e.target.matches('[data-help-search]')) {
    P.helpSearch = e.target.value;
    const pos = e.target.selectionStart;
    const card = $('#settings-help');
    if (card) {
      card.outerHTML = helpTutorialsCard();
      const inp = $('#settings-help [data-help-search]');
      if (inp) { inp.focus(); if (pos != null) try { inp.setSelectionRange(pos, pos); } catch { } }
    }
  }
});

// Global keyboard shortcut: Cmd/Ctrl + Shift + B opens the Subnautica-style Bug Report modal
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    triggerBugReport();
  }
});

// Active Timer dragging & corner resizing
let TM_DRAG = null;
document.addEventListener('pointerdown', e => {
  if (VIEW !== 'present') return;
  const rs = e.target.closest('[data-tresize]');
  const dr = e.target.closest('[data-tdrag]');
  if (!rs && !dr) return;
  if (!rs && e.target.closest('button')) return;
  const tid = (rs || dr).dataset[rs ? 'tresize' : 'tdrag'];
  const tm = P.timers.find(x => x.id === tid);
  if (!tm || tm.full) return;
  const el = $(`.p-timer[data-tid="${tid}"]`); if (!el) return;
  const r = el.getBoundingClientRect();
  if (tm.x == null || tm.y == null) {
    tm.x = r.left; tm.y = r.top; tm.w = Math.max(240, r.width); tm.h = Math.max(184, r.height);
    el.classList.add('floating');
    Object.assign(el.style, { left: tm.x + 'px', top: tm.y + 'px', width: tm.w + 'px', height: tm.h + 'px' });
  }
  e.preventDefault();
  TM_DRAG = { tm, el, mode: rs ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, ox: tm.x, oy: tm.y, ow: tm.w || r.width, oh: tm.h || r.height };
});
document.addEventListener('pointermove', e => {
  if (!TM_DRAG) return;
  const { tm, el, mode, sx, sy, ox, oy, ow, oh } = TM_DRAG;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (mode === 'move') {
    tm.x = clamp(ox + dx, 8, Math.max(8, innerWidth - (tm.w || 240) - 8));
    tm.y = clamp(oy + dy, 8, Math.max(8, innerHeight - (tm.h || 184) - 8));
    el.style.left = Math.round(tm.x) + 'px';
    el.style.top = Math.round(tm.y) + 'px';
  } else {
    tm.w = clamp(ow + dx, 240, Math.min(820, innerWidth - tm.x - 12));
    tm.h = clamp(oh + dy, 184, Math.min(540, innerHeight - tm.y - 12));
    el.style.width = Math.round(tm.w) + 'px';
    el.style.height = Math.round(tm.h) + 'px';
  }
});
document.addEventListener('pointerup', () => { TM_DRAG = null; });

(async function boot() {
  await loadData();
  if (S.settings.lastPinned && S.classes.some(c => c.id === S.settings.lastPinned)) P.pinned = S.settings.lastPinned;
  await loadBrowserFiles();
  // in a browser (iPad): an offline copy of the app, refreshed from the web whenever there's a connection
  if (!IS_NATIVE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
  native('hello');   // native replies with notch spacing if we're covering the screen
  native('updateStatus');
  // grading recordings are only kept on disk when troubleshooting is turned on (then the newest 20)
  if (HAS_SERVER) fetch(`/api/purge-grlogs?keep=${S.settings.saveGradeRecordings ? 20 : 0}`, { method: 'POST', headers: { 'X-Token': TOKEN } }).catch(() => { });
  if (S.settings.sim.on && !S.settings.sim.setAt) S.settings.sim.setAt = Date.now();
  render();
  if (VIEW === 'present') {
    if (S.settings.seenWhatsNew !== WHATS_NEW.id) setTimeout(() => openWhatsNewModal(), 550);
    else if (!S.settings.tourDone) setTimeout(startTour, 600);
  }
  // tick 4× a second, and right after each of the clock's whole seconds, so the clock and timers change together
  const loop = () => { tick(); const o = clockOff(), toNext = 1000 - ((Date.now() + o) % 1000 + 1000) % 1000; setTimeout(loop, Math.min(250, toNext + 8)); };
  loop();
})();

// ---------- free-window dragging, resizing, focus, address bar
document.addEventListener('pointerdown', e => {
  if (VIEW !== 'present') return;
  if (P.webModeMenu && !e.target.closest('.web-mode-menu, [data-action="web-mode-menu"]')) { P.webModeMenu = null; renderWebModeMenu(); WIN.sig = ''; renderWins(context(now()), true); tick(); }
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
  const id = e.target?.dataset?.wurl;
  if (id) {
    if (e.key === 'Enter') { const w = findWin(id); if (w) openWebAddress(w, e.target.value); }
    if (e.key === 'Escape') { e.target.value = findWin(id)?.url || ''; e.target.blur(); }
    return;
  }
  const sid = e.target?.dataset?.surl;
  if (sid) {
    if (e.key === 'Enter') { e.preventDefault(); openStageAddress(sid, e.target.value); }
    if (e.key === 'Escape') { e.preventDefault(); e.target.value = findRes(sid)?.url || ''; e.target.blur(); }
  }
});
// Double-click a window's title bar to maximize / restore it.
document.addEventListener('dblclick', e => {
  const bar = e.target.closest('[data-wdrag]');
  if (bar && !e.target.closest('button, input')) {
    const w = findWin(bar.dataset.wdrag); if (w) { w.max = !w.max; save(); applyWinGeom(); }
    return;
  }
  if (IS_NATIVE && e.target.closest('.p-head, .e-top') && !e.target.closest('button, a, input, select, textarea, label, [data-action], [role="button"], [contenteditable], .win, .win-menu, .dock-custom, .web-mode-menu, .snap-menu, .bm-menu')) {
    native('windowZoom');
  }
});

// Native macOS window dragging anywhere on the Present header, Setup top bar, or Companion Mini-HUD.
// (-webkit-app-region: drag is ignored by WKWebView, so we hand off to NSWindow.performDrag once dragged >= 3px.)
if (IS_NATIVE) {
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.detail > 1) return;
    const region = e.target.closest('.p-head, .e-top, .p-companion');
    if (!region) return;
    if (e.target.closest('button, a, input, select, textarea, label, [data-action], [role="button"], [contenteditable], .win, .win-menu, .dock-custom, .web-mode-menu, .snap-menu, .bm-menu, .comp-apps-panel, .comp-grip')) return;
    if (region.classList.contains('p-companion')) {
      const edge = 10, corner = 16;
      if (e.clientX <= edge || e.clientX >= innerWidth - edge || e.clientY <= edge || e.clientY >= innerHeight - edge || (e.clientX >= innerWidth - corner && e.clientY >= innerHeight - corner)) return;
    }
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', cleanup, true);
      window.removeEventListener('blur', cleanup);
    };
    const onMove = mv => {
      if (!(mv.buttons & 1)) { cleanup(); return; }
      if (Math.hypot(mv.clientX - sx, mv.clientY - sy) >= 3) {
        cleanup();
        native('windowDrag');
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', cleanup, true);
    window.addEventListener('blur', cleanup);
  });
}
