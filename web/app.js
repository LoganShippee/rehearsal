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
const IS_MAC_OS = /Mac/i.test(navigator.platform || navigator.userAgent || '') && !/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// what to call this device in messages ("saved on this iPad")
const DEVICE = IS_NATIVE ? (window.__REHEARSAL_PLATFORM === 'windows' ? 'PC' : 'Mac') : /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : 'computer';
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
  return t;
}
function undoToast(msg, onUndo, ms = 4500) {
  const el = toast(msg, ms);
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Undo';
  b.style.cssText = 'margin-left:10px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.15);color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-weight:700';
  b.onclick = () => { onUndo(); el.remove(); };
  el.appendChild(b);
  return el;
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

// Every new class starts with the same look: the Sky colours, the Waves background, 85% panels and 20% dimming.
// (Pick any other colours or background in Look. Classes that already exist are never changed.)
function newClass(name = 'New class') {
  return {
    id: uid(), name, subtitle: '', theme: { ...THEMES.find(t => t.name === 'Sky'), image: 'bg:waves', panel: 0.85, dim: 0.2, titleText: '#ffffff', clockText: '#ffffff' },
    agenda: [], warmup: '', resources: [], roster: [], automations: [], points: [{ name: 'Team 1', score: 0 }, { name: 'Team 2', score: 0 }], notes: {},
  };
}
// What a new copy of Rehearsal starts with: a basic music-classroom template to edit or replace.
// No students or files: each teacher adds their own.
function sampleData() {
  const today = dateKey(new Date());
  const music = (name, period, themeIdx, warmup) => Object.assign(newClass(name, themeIdx), {
    subtitle: period,
    hideWarmup: false,
    agenda: [{ text: 'Warm-up', min: 8 }, { text: 'Sight-reading', min: 10 }, { text: 'Rehearsal', min: 25 }, { text: 'Pack up', min: 5 }],
    warmup,
    resources: [
      { id: uid(), title: 'Sight Reading', sight: { mode: 'solfege' } },
      { id: uid(), title: 'Score Practice', score: {} },
      { id: uid(), title: 'Files', filesBrowser: true },
    ],
    screenNotes: { [today]: 'Click Quick edit to add your own notes here, or clear the text to hide this card.' },
  });
  const p1 = music('Choir', 'Period 1', 7, 'Hum a comfortable note, then slide up and down an octave.\nWhat key signature has one sharp?');
  const p2 = music('Band', 'Period 2', 1, 'Assemble your instrument and play your concert B♭ scale.\nHow many beats does a dotted half note get in 4/4?');
  const p3 = music('Orchestra', 'Period 3', 8, 'Tune with the drone, then play a D major scale.\nName the notes of the open strings on your instrument.');
  const p4 = music('General Music', 'Period 4', 6, 'Clap the rhythm on the board.\nWhat is the difference between beat and rhythm?');
  const classes = [p1, p2, p3, p4];
  for (const c of classes) {
    c.automations = [
      { id: uid(), enabled: false, anchor: 'start', offset: 0, action: 'sound', sound: 'chime' },
      { id: uid(), enabled: false, anchor: 'start', offset: 0, action: 'message', text: `Welcome to ${c.name}! Get your music and start the warm-up.`, seconds: 8 },
      { id: uid(), enabled: false, anchor: 'end', offset: 5, action: 'timer', label: 'Pack up', minutes: 4, sound: 'bell', endMessage: 'Instruments and folders away. See you next time!' },
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
      afterSchool: 'See you tomorrow!', use24h: false, showSeconds: false, hideDockAfter: 0,
      boardPaper: 'staff', rhythmSystem: 'numbers', lastPinned: p1.id,
      dock: { order: [...DOCK_DEFAULT], color: 'light', size: 'm', alpha: 90, labels: true, pos: { mode: 'header' } },
      sim: { on: false, time: '08:58', setAt: 0 }, subInfo: '',
    },
    classes,
    templates: [tRegular, tEarly],
    weekdays: { 0: '', 1: tRegular.id, 2: tRegular.id, 3: tRegular.id, 4: tRegular.id, 5: tRegular.id, 6: '' },
    overrides: {}, calDays: {},
    routines: [],
    events: [
      { id: uid(), kind: 'announcement', date: today, title: 'Click Quick edit to add announcements or remove this panel', time: '', yearly: false, classes: [] },
    ],
    files: {},
  };
}
function migrate(d) {
  const base = sampleData();
  d.settings = { ...base.settings, ...(d.settings || {}) };
  d.settings.sim = { ...base.settings.sim, ...(d.settings.sim || {}) };
  for (const k of ['classes', 'templates', 'routines', 'events', 'recordings', 'pinnedApps']) if (!Array.isArray(d[k])) d[k] = [];
  // a damaged file can hold blank or odd class entries; drop them so nothing below can throw
  d.classes = d.classes.filter(c => c && typeof c === 'object' && !Array.isArray(c));
  // repair: sight-reading windows pinned before the fix became empty web tabs
  for (const list of Object.values(d.windows || {})) for (const w of list || []) {
    if (w.kind !== 'res' || !w.sr) continue;
    for (const c of d.classes || []) { const r = (c.resources || []).find(x => x.id === w.resId); if (r && !r.url && !r.fileId && !r.sight) { r.sight = w.sr; delete r.url; r.title = (w.sr.mode === 'solfege' ? 'Solfege' : 'Rhythm') + ' reading'; } }
    delete w.sr;
  }
  for (const c of d.classes || []) c.resources = (c.resources || []).filter(r => r.url || r.fileId || r.sight || r.score || r.filesBrowser || r.widget || r.music || r.url === '');
  // live app-window status (editing etc.) never survives a restart
  for (const list of Object.values(d.windows || {})) for (const w of list || []) if (w.kind === 'app') delete w.status;
  // 1.0.8: emoji icons left over from older versions are replaced by the drawn icons (once; you can still type one back in)
  if (!d.settings.drawnIcons) {
    const EMO = /\p{Extended_Pictographic}/u, ic = d.settings.icons || {};
    for (const g of ['dock', 'kind', 'event']) for (const k in ic[g] || {}) if (EMO.test(ic[g][k])) delete ic[g][k];
    for (const c of d.classes || []) for (const r of c.resources || []) if (r.icon && EMO.test(r.icon)) delete r.icon;
    d.settings.drawnIcons = true;
  }
  // grading starts at strictness 25 (a saved overall level is kept for rhythm/pitch)
  d.settings.gradeStrictness ??= 25;
  d.settings.gradeStrictRhythm ??= d.settings.gradeStrictness;
  d.settings.gradeStrictPitch ??= d.settings.gradeStrictness;
  // the playhead now starts Off: switch saved sight-reading and score states that still have the old default (once)
  if (!d.settings.playheadOffDefault) {
    const off = o => { if (o && typeof o === 'object' && o.playhead === 'beat') o.playhead = 'off'; };
    for (const c of d.classes || []) for (const r of c.resources || []) { off(r.sight); off(r.score); }
    for (const list of Object.values(d.windows || {})) for (const w of list || []) { off(w.sight); off(w.score); off(w.sr); }
    d.settings.playheadOffDefault = true;
  }
  for (const k of ['weekdays', 'overrides', 'files', 'windows', 'calDays']) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
  if (d.settings.lastPinned && !d.classes.some(c => c.id === d.settings.lastPinned)) d.settings.lastPinned = '';
  for (const c of d.classes) {
    c.theme ||= { ...THEMES[7] }; c.agenda ||= []; c.resources ||= []; c.roster ||= []; c.automations ||= [];
    c.points ||= [{ name: 'Team 1', score: 0 }, { name: 'Team 2', score: 0 }]; c.notes ||= {}; c.screenNotes ||= {}; c.progress ||= [];
  }
  return d;
}

let S = null;
let IS_FRESH_INSTALL = false;
async function loadData() {
  let d = null;
  if (HAS_SERVER) {
    try {
      const r = await fetch('/api/data', { headers: { 'X-Token': TOKEN } });
      if (r.ok) { const t = await r.text(); if (t.trim()) d = JSON.parse(t); }
    } catch (e) { console.warn(e); }
  }
  if (!d) { try { d = JSON.parse(localStorage.getItem('rehearsal') || 'null'); } catch { } }
  IS_FRESH_INSTALL = !d;
  S = migrate(d || sampleData());
}
let saveTimer = null, savePending = false;
function save() { clearTimeout(saveTimer); savePending = true; saveTimer = setTimeout(saveNow, 350); }
async function saveNow() {
  clearTimeout(saveTimer); savePending = false;
  if (window.__noSave) return;
  const body = JSON.stringify(S);
  try { localStorage.setItem('rehearsal', body); } catch { }
  window.HWSYNC?.changed();   // browser version: back up to the teacher's account (hw-sync.js)
  if (HAS_SERVER) {
    try { await fetch('/api/data', { method: 'POST', keepalive: body.length < 60000, headers: { 'X-Token': TOKEN, 'X-Client': CLIENT, 'Content-Type': 'application/json' }, body }); }
    catch (e) { toast('Could not save — is the app still running?'); }
  }
}
window.__externalUpdate = async client => { if (client === CLIENT) return; await loadData(); render(); };
// Closing or switching away within 350 ms of an edit would lose it, so save right away.
function flushSave() { if (savePending) saveNow(); }
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
// Browser version: another tab saved. Take its copy first so this tab can't overwrite it with old data.
window.addEventListener('storage', e => {
  if (HAS_SERVER || e.key !== 'rehearsal' || !e.newValue || !S) return;
  try {
    const hadPending = savePending;
    clearTimeout(saveTimer); savePending = false;
    S = migrate(JSON.parse(e.newValue));
    render();
    if (hadPending) toast('Updated from another window.');
  } catch { }
});

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
    name: S.files[fid]?.name || 'PDF',
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
      } else if (where.inFiles) {
        toast(`Saved “${name}” to your Files library.`, 4000);
        if (where.onSaved) where.onSaved(id);
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
  searchNotice: {},        // winId | 'stage-' + resId -> last browser search query
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
let AC = null, AC_NEEDS_RESET = false, AC_LIVE_MICS = 0, AC_HIDDEN_AT = 0;
function ac() {
  if (!AC || AC.state === 'closed') {
    audioSession('playback');
    const c = new (window.AudioContext || window.webkitAudioContext)();
    c.onstatechange = () => { if (AC === c && c.state === 'closed') AC = null; };
    AC = c;
    AC_NEEDS_RESET = false;
  }
  return AC;
}
function resetAudioEngine() {
  try { if (typeof spHoldStop === 'function') spHoldStop(); } catch { }
  try { if (typeof muDroneStop === 'function') muDroneStop(0); } catch { }
  try { if (typeof GR !== 'undefined' && GR.mic && !GR.mic.own && typeof grMicClose === 'function') grMicClose(); } catch { }
  const old = AC;
  AC = null;
  AC_NEEDS_RESET = false;
  if (old) {
    if (old.__music) MUSIC_OUTS.delete(old.__music);
    try { if (old.state !== 'closed') old.close(); } catch { }
  }
  const fresh = ac();
  fresh.resume?.().catch(() => { });
  return fresh;
}
function acForPlayback() {
  const busyRec = (typeof GR !== 'undefined' && GR.on)
    || (typeof SP_VREC !== 'undefined' && SP_VREC.on)
    || (typeof REC !== 'undefined' && (REC.state === 'rec' || REC.state === 'countin'))
    || (typeof MU_TUNER !== 'undefined' && !!MU_TUNER.stream);
  const c = (AC_NEEDS_RESET && !busyRec) ? resetAudioEngine() : ac();
  if (!AC_LIVE_MICS) audioSession('playback');
  if (c.state !== 'running') c.resume?.().catch(() => { });
  return c;
}
// Detect a frozen or time-dilated AudioContext (common after OS sleep, HDMI/Bluetooth switch, or mic use)
// and automatically recreate AC so playback recovers without restarting the program.
function watchPlaybackClock(c, isAlive, onBroken) {
  const t0 = c.currentTime, p0 = performance.now();
  setTimeout(() => {
    if (!isAlive() || AC !== c) return;
    const dtWall = (performance.now() - p0) / 1000;
    const dtAudio = c.currentTime - t0;
    if (c.state !== 'running' || dtAudio < 0.05 || (dtWall > 0.25 && dtAudio > dtWall * 1.75)) {
      console.warn(`[audio] unhealthy AudioContext (state=${c.state}, dtAudio=${dtAudio.toFixed(3)}s / ${dtWall.toFixed(3)}s) — resetting`);
      resetAudioEngine();
      try { onBroken && onBroken(); } catch { }
    }
  }, 550);
}
window.resetAudioEngine = resetAudioEngine;
window.acForPlayback = acForPlayback;
window.watchPlaybackClock = watchPlaybackClock;
// iPad / iPhone: Safari plays web audio in a quiet "ambient" mode, and after the microphone has been used
// it stays in a record mode that makes everything quieter. Ask for normal playback, switch to record mode
// only while a microphone is actually on, and switch back when the last one stops.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !window.webkit?.messageHandlers?.native);
function audioSession(type) { if (!IS_IOS) return; try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { } }
(() => {
  const md = navigator.mediaDevices; if (!md) return;
  try { md.addEventListener?.('devicechange', () => { AC_NEEDS_RESET = true; }); } catch { }
  if (!md.getUserMedia) return;
  const live = new Set(), gum = md.getUserMedia.bind(md);
  md.getUserMedia = async c => {
    if (c?.audio) audioSession('play-and-record');
    let s;
    try { s = await gum(c); }
    catch (e) {
      // "AudioSession category is not compatible with audio capture": the audio mode is stuck on playback
      // (it is shared by the whole app, so it can outlast a page reload). Ask for record mode and try again.
      if (!c?.audio || !/AudioSession|category/i.test(e?.message || '')) throw e;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { }
      s = await gum(c);
    }
    s.getAudioTracks().forEach(t => live.add(t));
    AC_LIVE_MICS = live.size;
    if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => { });   // switching modes can pause the sound engine
    return s;
  };
  const stop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function () {
    stop.call(this);
    if (live.delete(this)) {
      AC_LIVE_MICS = live.size;
      if (![...live].some(t => t.readyState === 'live')) {
        live.clear(); AC_LIVE_MICS = 0;
        AC_NEEDS_RESET = true;   // OS audio hardware switches back from record/HFP mode; next Play gets a clean context
        setTimeout(() => {
          if (live.size) return;
          if (IS_IOS) audioSession('playback');
          else try { if (navigator.audioSession && navigator.audioSession.type !== 'auto') navigator.audioSession.type = 'auto'; } catch { }
          if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => { });
        }, 50);
      }
    }
  };
})();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { AC_HIDDEN_AT = Date.now(); return; }
  // Returning after sleep / app switch: mark idle AudioContext for clean rebuild, and resume if interrupted.
  if (AC_HIDDEN_AT && Date.now() - AC_HIDDEN_AT > 15000) AC_NEEDS_RESET = true;
  if (!AC_LIVE_MICS) audioSession('playback');
  if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => { });
});
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
    if (ac().state !== 'running') await ac().resume();
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
  const due = (key, at) => { const dt = ms - at; if (dt >= 0 && dt < 30000 && !P.fired.has(key)) { P.fired.add(key); return true; } return false; };
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
  let changed = false;
  for (const tm of P.timers) {
    if (!tm.doneAt && tm.pausedLeft == null && timerLeft(tm) <= 0) {
      tm.doneAt = Date.now();
      changed = true;
      if (!tm.muted) playSound(tm.sound);
      if (tm.stopMusic) stopMusic();
      if (tm.endMessage) queueMessage(tm.endMessage, 8);
    }
  }
  if (changed) renderTimers(); else updateTimers();
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
        ${tm.doneAt
          ? `<button data-action="timer-x" data-id="${tm.id}" class="on" title="Dismiss finished timer">${IC('ico:check')} Dismiss</button>
             <button data-action="timer-add" data-id="${tm.id}" title="Add a minute">${isFull ? '+1 min' : '+1'}</button>`
          : `<button data-action="timer-pause" data-id="${tm.id}" class="${paused ? 'on' : ''}" title="${paused ? 'Resume timer' : 'Pause timer'}" aria-label="${paused ? 'Resume timer' : 'Pause timer'}">${IC(paused ? 'ico:play' : 'ico:pause')}${isFull ? `<span>${paused ? 'Resume' : 'Pause'}</span>` : ''}</button>
             <button data-action="timer-add" data-id="${tm.id}" title="Add a minute">${isFull ? '+1 min' : '+1'}</button>
             <button data-action="timer-mute" data-id="${tm.id}" class="${muted ? 'on' : ''}" title="${tm.muted ? 'Sound off: click to turn the end sound back on' : 'Mute the end sound'}" aria-label="Toggle timer sound">${IC(muted ? 'ico:mute' : 'ico:bell')}${isFull ? `<span>${muted ? 'Muted' : 'Sound'}</span>` : ''}</button>`}
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
// A grade report left open for a window that is closing would point at music that is gone.
function dropGradeCard(winEl) {
  const card = document.getElementById('gr-card'); if (!card) return;
  const h = typeof GR !== 'undefined' ? GR.host : null;
  if (!h || !h.isConnected || (winEl && winEl.contains(h))) card.remove();
}
function stopAllPresentAudio(opts = {}) {
  const root = opts.root || document;
  if (opts.stageOnly) {
    stopMusicHosts();
    fbStopAudio();
    if (root && root !== document) {
      if (typeof MET !== 'undefined' && MET.id && root.querySelector(`[data-mu-win="${MET.id}"]`) && typeof metStop === 'function') metStop();
      if (typeof MU_TUNER !== 'undefined' && MU_TUNER.id && root.querySelector(`[data-mu-win="${MU_TUNER.id}"]`) && typeof muTunerStop === 'function') muTunerStop();
      if (typeof MU_DRONE !== 'undefined' && MU_DRONE.id && root.querySelector(`[data-mu-win="${MU_DRONE.id}"]`) && typeof muDroneStop === 'function') muDroneStop(0);
      if (typeof PIANO_SEQ !== 'undefined' && PIANO_SEQ.host && root.contains(PIANO_SEQ.host) && typeof pianoSeqStop === 'function') pianoSeqStop();
    }
  } else if (opts.closing) {
    const c = opts.closing, r = winRes(c);
    if (c.kind === 'rec') { closePlayer(); if (REC.meter) recMeter(false); }
    if (c.kind === 'files' || (c.kind === 'res' && r?.filesBrowser)) fbStopAudio();
    if ((c.kind === 'piano' || r?.widget?.kind === 'piano') && typeof pianoSeqStop === 'function') pianoSeqStop();
    if ((c.kind === 'metro' || r?.music?.kind === 'metro') && typeof metStop === 'function') metStop();
    if ((c.kind === 'tuner' || r?.music?.kind === 'tuner')) {
      if (typeof muTunerStop === 'function') muTunerStop();
      if (typeof muDroneStop === 'function') muDroneStop(0);
    }
    if (['score', 'sight', 'res', 'files', 'scan'].includes(c.kind)) { stopMusicHosts(); dropGradeCard(document.querySelector(`.win[data-win="${c.id}"]`)); }
  } else {
    stopMusicHosts();
    try { if (typeof metStop === 'function') metStop(); } catch { }
    try { if (typeof muTunerStop === 'function') muTunerStop(); } catch { }
    try { if (typeof muDroneStop === 'function') muDroneStop(0); } catch { }
    try { if (typeof pianoSeqStop === 'function') pianoSeqStop(); } catch { }
    if (typeof noiseStop === 'function') noiseStop();
    if (REC.state === 'rec' || REC.state === 'countin') recStop();
    if (REC.meter) recMeter(false);
    if (opts.keepReview && REC.state === 'review') PLAY.au?.pause();
    else closePlayer();
    fbStopAudio();
  }
  root?.querySelectorAll('.aud-host, .aud-player').forEach(el => { try { el.__audCleanup?.(); } catch { } });
}
function onClassSwitched() {
  stopAllPresentAudio({ stageOnly: true });
  if (P.tools.random) rerenderTool('random');
  if (P.tools.points) rerenderTool('points');
  refreshWidgets('cal');
  refreshWidgets('prog');
}
function go(view) {
  if (VIEW === 'present' && view !== 'present') { saveInk(); undockStageApp(false); stopAllPresentAudio({ keepReview: true }); }
  VIEW = view; P.dockNear = Date.now(); P.winMenu = false; P.webModeMenu = null; $('#web-mode-menu')?.remove(); P.clipOpen = false; $('#clip-panel')?.remove(); P.iconsOpen = false; $('#icons-panel')?.remove();
  if (view === 'present') { P.layoutKey = P.sideKey = P.stageKey = ''; } else { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff'); }
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
  renderTimers(); renderTools(); tick(); renderDock();
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
// Built-in backgrounds shipped with the app (web/backgrounds/*.svg). A class stores one as "bg:risers".
const BACKGROUNDS = [['risers', 'Risers'], ['keys', 'Piano keys'], ['staff', 'Staff'], ['spotlight', 'Spotlight'], ['waves', 'Waves'], ['sunset', 'Sunset'], ['notes', 'Notes']];
function themeImgURL(img) {
  if (!img) return '';
  if (img.startsWith('file:')) return fileDirectURL(img.slice(5));
  if (img.startsWith('bg:')) return `backgrounds/${img.slice(3).replace(/[^a-z]/g, '')}.svg`;
  return img;
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
  bg.style.backgroundImage = th.image ? `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})), url("${themeImgURL(th.image)}")` : '';
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
  tuner: { icon: 'ico:tuner', label: 'Tuner & drone', act: 'open-music', kind: 'tuner', on: () => winList().some(w => w.kind === 'tuner') },
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
  d.size ||= 'm';
  d.color ||= 'light';
  if (d.alpha == null) d.alpha = 90;
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
  if (FB_AUDIO) parts.push(btn('fb-audio', { icon: 'ico:stop', label: 'Preview', act: 'fb-audio-stop' }));
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
  if (!over()) { if (P.tour != null) positionTour(); return; }
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
  if (P.tour != null) positionTour();
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
  d.style.setProperty('--dock-a', ((cfg.alpha ?? 90) / 100).toFixed(2));
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
window.addEventListener('resize', () => { placeDock(); fitDock(); if (P.tour != null) positionTour(); });
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
  panel.innerHTML = `<div class="dc-head"><b>Toolbar</b><span class="grow"></span><button class="iconbtn pop-x" data-action="dock-custom" title="Close" aria-label="Close">${IC('ico:close')}</button></div>
    <div class="dc-note">Choose where each button goes: on the <b>Bar</b>, in <b>Open</b> (＋ Open menu), in <b>More</b> (⋯), or <b>Hidden</b>. Drag ≡ to reorder.</div>
    <div class="dc-list">${cfg.order.filter(id => DOCK_ITEMS[id]).map(id => { const it = DOCK_ITEMS[id];
      const inOpen = (cfg.inOpen || []).includes(id);
      const launcher = DOCK_LAUNCHERS.includes(id);
      const place = cfg.hidden.includes(id) ? 'off' : inOpen ? 'open' : cfg.menu.includes(id) ? (launcher ? 'off' : 'menu') : 'bar';
      const canOpen = !it.locked && !it.sep && !launcher && id !== 'window' && !it.special;
      const opts = it.locked ? [['bar', 'Bar']] : launcher ? [['bar', 'Bar'], ['off', 'Open']] : it.sep ? [['bar', 'Bar'], ['off', 'Hidden']] : canOpen ? [['bar', 'Bar'], ['open', 'Open'], ['menu', 'More'], ['off', 'Hidden']] : [['bar', 'Bar'], ['menu', 'More'], ['off', 'Hidden']];
      return `<div class="dc-row ${it.sep ? 'sep' : ''} ${place === 'off' && !launcher ? 'is-off' : ''}" draggable="true" data-id="${id}">
      <span class="dc-grip">≡</span>
      <span class="dc-ico">${it.sep ? '' : dockIcon(id, it) || ''}</span>
      <span class="dc-name" title="${esc(it.label)}">${esc(it.label)}</span>
      <span class="dc-seg" role="group" aria-label="Where ${esc(it.label)} goes">${opts.map(([v, l]) => `<button type="button" data-dock-place="${id}" data-v="${v}" aria-pressed="${place === v}" ${v === 'open' ? 'title="Show in ＋ Open menu"' : ''}>${l}</button>`).join('')}</span></div>`; }).join('')}</div>
    <div class="dc-look">
      ${dcSeg('Size', 'size', [['s', 'S'], ['m', 'M'], ['l', 'L']], cfg.size || 'm')}
      ${dcSeg('Colour', 'color', [['dark', 'Dark'], ['light', 'Light'], ['class', 'Class']], cfg.color || 'light')}
      ${dcSeg('Shrink when idle', 'hide', (() => { const cur = Number(S.settings.hideDockAfter ?? 0), o = [[0, 'Never'], [3, '3 s'], [10, '10 s'], [30, '30 s']]; if (!o.some(([v]) => v === cur)) o.push([cur, `${cur} s`]); return o.sort((a, b) => a[0] - b[0]); })(), Number(S.settings.hideDockAfter ?? 0))}
      <div class="dc-lrow"><span>See-through</span><input type="range" min="25" max="100" step="5" data-dock-opt="alpha" value="${cfg.alpha ?? 90}"></div>
      <label class="dc-lrow"><span>Labels under icons</span><input type="checkbox" class="dc-sw" role="switch" data-dock-labels ${cfg.labels ? 'checked' : ''}></label>
      <label class="dc-lrow"><span>Emojis</span><input type="checkbox" class="dc-sw" role="switch" data-dock-emoji ${iconOn('dock') ? 'checked' : ''}></label>
      <div class="dc-lrow"><span>Icon for each button</span><button data-action="icons-open">${IC('ico:icons')} Icons…</button></div>
      <div class="dc-lrow"><span>Position</span><span class="dc-seg" role="group" aria-label="Toolbar position">${[['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']].map(([v, l]) => `<button type="button" data-action="dock-spot" data-spot="${v}" aria-pressed="${(!S.settings.dockPos && v === 'top') || (S.settings.dockPos?.spot === v)}">${l}</button>`).join('')}</span></div>
    </div>
    <div class="dc-btns"><button data-action="dock-reset">Reset toolbar</button></div>`;
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
    const rem = timerLeft(tm), paused = tm.pausedLeft != null;
    return `<button type="button" class="comp-timer ${idx > 0 ? 'extra' : ''} ${paused ? 'paused' : ''}" data-action="timer-pause" data-id="${tm.id}" title="${paused ? 'Click to resume timer' : 'Click to pause timer'}">${paused ? '⏸' : '⏱'} ${fmtDur(rem)}</button>`;
  }).join('');
  const quickTimerBtn = !P.timers.some(x => !x.doneAt) ? `<button type="button" class="comp-timer-add" data-action="comp-quick-timer" title="Start a quick 2-minute timer">+2m</button>` : '';
  const sig = P.signal ? `<button type="button" class="comp-sig" data-action="signal-clear" style="background:${P.signal.color}" title="Click to clear signal">${esc(P.signal.text)} ×</button>` : '';
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
      <div class="comp-meta">${timers}${quickTimerBtn}${sig}<span class="comp-clock">${fmtClock(t)}</span>${leftTxt ? `<span class="comp-left-t">${esc(leftTxt)}</span>` : ''}</div>
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
  const hasSchedule = S.templates.some(x => x.periods?.length);
  const pinChip = ctx.pinned && hasSchedule && P.tour == null
    ? `<button type="button" class="chip pin-chip" data-action="unpin-schedule" title="Bell schedule switching is paused while pinned — click to follow your bell schedule">Pinned · Follow schedule</button>` : '';
  let title = '', left = '', frac = 0;
  if (ctx.mode === 'class' && P.editMode) {
    title = ieTitle(ctx, tmplName, testChip);
    if (ctx.period) { left = `Ends in ${fmtDur(ctx.period.endAt - t)}`; frac = (t - ctx.period.startAt) / (ctx.period.endAt - ctx.period.startAt); }
  } else if (ctx.mode === 'class') {
    title = `<div class="t1">${esc(ctx.cls.name)}</div><div class="t2">${ctx.cls.subtitle ? esc(ctx.cls.subtitle) : ''}${pinChip}${testChip}</div>`;
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
  const hideAfter = S.settings.hideDockAfter ?? 0, since = Date.now() - P.lastMove;
  const anyTool = Object.keys(P.tools).length || P.ink.on || P.winMenu || WIN.drag || P.dockCustom || P.dockMore || DOCKDRAG || P.editMode || P.iconsOpen || P.tour != null;
  $('#p-dock').classList.toggle('hidden', hideAfter > 0 && Date.now() - (P.dockNear || 0) > hideAfter * 1000 && !anyTool);
  root.classList.toggle('hide-cursor', since > 3000 && !anyTool);
  if (!!P.music !== !!$('#p-dock [data-action="music-stop"]') || !!FB_AUDIO !== !!$('#p-dock [data-action="fb-audio-stop"]')) renderDock();
}
function setHTML(sel, html) { const el = $(sel); if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }

function desiredInkKey(ctx = context(now())) {
  const base = ctx?.key || 'screen';
  if (P.ink.blank) return `${base}:board:${S.settings.boardPaper || 'staff'}`;
  const tab = P.stageSel[base] || 'warmup';
  return `${base}:annot:${tab}`;
}
function switchInkKey(nextKey = desiredInkKey()) {
  if (!inkCanvas) return;
  if (inkLoaded && P.inkKey && P.inkKey !== nextKey) saveInk();
  P.inkKey = nextKey;
  restoreInk();
}
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
  switchInkKey(desiredInkKey(ctx));
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
  const sn = cls.screenNotes || {};
  const pubNote = (sn[dateKey(t)] || sn._sticky || '').trim();
  const progSide = cls.sideProgress ? [!!cls.sideProgOpen, (cls.progress || []).map(i => [i.title, i.status, (i.steps || []).map(x => [x.text, !!x.done])])] : null;
  const sideKey = JSON.stringify([step, cls.agenda, evs.map(e => e.id), ctx.next?.id, S.settings.use24h, !!P.editMode, !!P.showPrivNotes, cls.name, pubNote, !!sn._sticky, progSide, cls.progLabels]);
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
      stopAllPresentAudio({ root: $('#stage-content'), stageOnly: true });
      if (typeof prevStageId === 'string' && prevStageId.startsWith('app:') && !activeExtApp) {
        undockStageApp(true);
      }
      if (!P.ink.blank) switchInkKey(desiredInkKey(ctx));
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
        sc.innerHTML = widgetHost(res.widget.kind, 'stage-wg', `data-wg-res="${res.id}"`); mountWidgets(sc);
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
      const modeBtn = IS_NATIVE
        ? `<button class="mode ${P.webModeMenu?.target === 'stage' && P.webModeMenu?.id === res.id ? 'on' : ''}" data-action="web-mode-menu" data-target="stage" data-id="${res.id}" title="Switch between Embedded frame and Full browser">${nat ? 'Full browser ▾' : 'Embedded ▾'}</button>`
        : `<span class="swb-hint" title="Some sites block embedded frames in browser mode">Blocked? Use ↗</span>`;
      const actsHTML = `${isSlides ? `<button class="mode" data-action="stage-slideshow" title="Play Google Slides as a live slideshow inside Rehearsal">Slideshow</button>` : ''}${modeBtn}${drawBtn}<button data-action="bm-star" data-target="stage" data-id="${esc(res.id)}" title="Bookmark this page">${IC('ico:star')}</button><button data-action="stage-reload" title="Reload">${IC('ico:reload')}</button>${isGoogle(res) && IS_NATIVE ? `<button data-action="open-drive" data-url="${esc(res.url)}" title="Open in the Google Drive window">Drive window</button>` : ''}<button data-action="open-external" data-url="${esc(res.url)}" title="Open in your web browser">${IC('ico:external')}</button>`;
      const searchHint = !IS_NATIVE && P.searchNotice?.['stage-' + res.id] ? `<span class="swb-hint">Opened Google search in a new tab</span>` : '';
      const inp = wb.querySelector('.stage-url');
      if (!inp || inp.dataset.surl !== res.id) {
        wb._h = '';
        wb.innerHTML = `${IS_NATIVE ? `<button class="swb-nav" data-action="stage-back" ${nav.back ? '' : 'disabled'} title="Back">‹</button><button class="swb-nav" data-action="stage-fwd" ${nav.forward ? '' : 'disabled'} title="Forward">›</button>` : ''}<input class="stage-url" data-surl="${res.id}" placeholder="Search Google or enter a web address…" value="${esc(res.url)}" spellcheck="false">${searchHint}<div class="swb-acts">${actsHTML}</div>`;
        const a = wb.querySelector('.swb-acts'); if (a) a._h = actsHTML + '|' + searchHint;
      } else {
        if (document.activeElement !== inp && inp.value !== res.url) inp.value = res.url;
        const b = wb.querySelector('[data-action="stage-back"]'), f = wb.querySelector('[data-action="stage-fwd"]');
        if (b) b.disabled = !nav.back;
        if (f) f.disabled = !nav.forward;
        const a = wb.querySelector('.swb-acts');
        if (a && a._h !== actsHTML + '|' + searchHint) {
          wb.querySelector('.swb-search-msg')?.remove();
          if (searchHint) { const sp = document.createElement('span'); sp.className = 'swb-hint swb-search-msg'; sp.textContent = 'Opened Google search in a new tab'; a.before(sp); }
          a.innerHTML = actsHTML; a._h = actsHTML + '|' + searchHint;
        }
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
    html = `<div class="big">${fmtClock(t)}</div><div class="msg">${longDate(t)}</div><div class="next" style="opacity:.75">No classes on the schedule today. Use ${IC('ico:pin')} in the toolbar to show a class anyway.</div>`;
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
  if (typeof mountScanFix === 'function') {
    for (const h of root.querySelectorAll('[data-scan-win]')) { const w = findWin(h.dataset.scanWin); if (w) mountScanFix(h, (w.scan ||= {}), () => save()); }
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
// ============================================================ calendar & progress windows (moved to web/widgets.js)

function winTitle(w) {
  if (w.customTitle) return w.customTitle;
  if (w.kind === 'sight') return 'Sight reading';
  if (w.kind === 'dash') return 'Rhythm Rush';
  if (w.kind === 'rocket') return 'Solfege Rocket';
  if (w.kind === 'score') return (w.score?.name || S.files[w.score?.fileId]?.name || 'Score').replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '');
  if (w.kind === 'scan') return 'Scan & fix';
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
  if (w.kind === 'dash') return 'ico:sight';
  if (w.kind === 'rocket') return 'ico:sight';
  if (w.kind === 'score') return 'ico:score';
  if (w.kind === 'scan') return 'ico:scan';
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
function setSpaceTargetForWin(w) {
  if (!w || w.id === '__tour_win') return;
  const r = winRes(w);
  const k = w.kind === 'res'
    ? (r?.sight ? 'sight' : r?.score ? 'score' : r?.widget?.kind || r?.music?.kind || (r?.fileId && resKind(r) === 'audio' ? 'aud' : ''))
    : (w.kind === 'file' && resKind({ fileId: w.fileId }) === 'audio' ? 'aud' : w.kind);
  if (k === 'piano') window.__spaceTarget = 'piano';
  else if (k === 'sight') window.__spaceTarget = 'sr';
  else if (k === 'score') window.__spaceTarget = 'sp';
  else if (k === 'rec') window.__spaceTarget = 'rec';
  else if (k === 'metro') window.__spaceTarget = 'met';
  else if (k === 'scan') window.__spaceTarget = 'sf';
  else if (k === 'aud') {
    window.__spaceTarget = 'aud';
    const audEl = $(`.win[data-win="${w.id}"] .aud-host`);
    if (audEl) window.__audActive = audEl;
  }
}
function addWindow(w, size) {
  const list = winList();
  const front = list.length ? list.reduce((a, b) => (b.z || 0) > (a.z || 0) ? b : a) : null;
  const ww = size?.w || 0.56, hh = size?.h || 0.78;
  const stepX = Math.max(0.022, 28 / Math.max(800, innerWidth));
  const stepY = Math.max(0.03, 28 / Math.max(600, innerHeight));
  const maxX = Math.max(0.01, 0.98 - ww), maxY = Math.max(0.01, 0.98 - hh);
  let x = 0.04, y = 0.03;
  if (front && !front.max) {
    x = front.x + stepX; y = front.y + stepY;
  } else if (list.length) {
    const n = list.length;
    x = 0.04 + stepX * (n % 6); y = 0.03 + stepY * (n % 6);
  }
  if (x > maxX) x = 0.02 + (x % Math.max(0.04, maxX));
  if (y > maxY) y = 0.02 + (y % Math.max(0.04, maxY));
  x = clamp(x, 0.01, maxX);
  y = clamp(y, 0.01, maxY);
  for (let tries = 0; tries < 8 && list.some(o => !o.max && Math.abs(o.x - x) < 0.015 && Math.abs(o.y - y) < 0.015); tries++) {
    x = clamp(x + stepX > maxX ? 0.02 + tries * 0.012 : x + stepX, 0.01, maxX);
    y = clamp(y + stepY > maxY ? 0.02 + tries * 0.015 : y + stepY, 0.01, maxY);
  }
  Object.assign(w, { id: uid(), x, y, w: ww, h: hh, z: topZ(list) + 1 });
  setSpaceTargetForWin(w);
  list.push(w); save(); P.winMenu = false; renderWinMenu(); renderDock(); WIN.sig = ''; renderWins(context(now()));
  setSpaceTargetForWin(w);
  return w;
}
function tileWindows() {
  const list = winList(); if (!list.length) return toast('No windows open. Use ＋ Open to open one.');
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
  if (w.kind === 'dash') return `<iframe class="dash-frame" src="rhythm-dash.html" style="width:100%;height:100%;border:0;display:block;background:#0d111d" allow="autoplay"></iframe>`;
  if (w.kind === 'rocket') return `<iframe class="rocket-frame" src="gate-singer.html" style="width:100%;height:100%;border:0;display:block;background:#0b1020" allow="microphone; autoplay"></iframe>`;
  if (w.kind === 'score') return `<div class="score-host" data-score-win="${w.id}"></div>`;
  if (w.kind === 'scan') return `<div class="sf-host" data-scan-win="${w.id}"></div>`;
  if (w.kind === 'res' && winRes(w)?.score) return `<div class="score-host" data-score-res="${w.resId}"></div>`;
  if (w.kind === 'tuner' || w.kind === 'metro') return `<div class="mu-host" data-mu-win="${w.id}"></div>`;
  if (WIDGETS[w.kind]) return widgetHost(w.kind, '', `data-wg-win="${w.id}"`);
  if (w.kind === 'res' && winRes(w)?.widget) return widgetHost(winRes(w).widget.kind, '', `data-wg-res="${w.resId}"`);
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
  if (!url) {
    const sq = P.searchNotice?.[w.id];
    if (sq) return `<div class="win-start"><div>${IC('ico:web')}<br><b>Opened Google search in a new tab</b><br><span style="font-size:13px;opacity:.75">Searched for “${esc(sq)}”. Type another web address or search above and press ${IS_MAC_OS ? 'Return' : 'Enter'}.</span></div></div>`;
    return `<div class="win-start"><div>${IC('ico:web')}<br>Type a web address or a search above and press ${IS_MAC_OS ? 'Return' : 'Enter'}.${IS_NATIVE ? '<br><span style="font-size:13px;color:#888">Searches open in full browser mode.</span>' : ''}</div></div>`;
  }
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
      ${canNative && url ? `<button class="mode ${P.webModeMenu?.target === 'win' && P.webModeMenu?.id === w.id ? 'on' : ''}" data-action="web-mode-menu" data-target="win" data-id="${w.id}" title="Switch between Embedded frame and Full browser">${nat ? 'Full browser ▾' : 'Embedded ▾'}</button>` : ''}
      ${!IS_NATIVE && w.kind === 'web' && url ? `<span class="swb-hint" title="Some sites block embedded frames in browser mode">Blocked? Use ↗</span>` : ''}
      ${canNative ? `<button class="mode ${(winRes(w) || w).markupMode ? 'on' : ''}" data-action="web-markup-toggle" data-target="win" data-id="${w.id}" title="${(winRes(w) || w).markupMode ? 'Exit drawing mode and return to crisp Full browser' : 'Draw on top of this page'}">${IC('ico:pen')} ${(winRes(w) || w).markupMode ? 'Done' : 'Draw'}</button>` : ''}
      ${w.kind === 'web' && w.url ? `<button data-action="bm-star" data-id="${w.id}" title="Bookmark this page">${IC('ico:star')}</button>` : ''}
      ${pinned ? `<span class="win-pinned-tag" title="Saved as a class tab">${IC('ico:pin')} Pinned</span>` : `<button data-action="win-pin" data-id="${w.id}" title="Save to this class's tabs">${IC('ico:pin')}</button>`}
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
  setSpaceTargetForWin(w);
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
  if (!IS_NATIVE && !looksURL) {
    native('openExternal', { url }) || window.open(url, '_blank');
    (P.searchNotice ||= {})[w.id] = q;
    document.activeElement?.blur(); WIN.sig = ''; renderWins(context(now()), true);
    toast('Opened Google search in a new tab.');
    return;
  }
  if (P.searchNotice) delete P.searchNotice[w.id];
  w.url = url; w.title = '';
  if (IS_NATIVE && w.native == null) { /* autoNativeWeb(url) decides */ }
  if (winIsNative(w)) native('webCmd', { id: w.id, action: 'load', url });
  save(); WIN.sig = ''; document.activeElement?.blur(); renderWins(context(now()), true);
}
function openStageAddress(resId, raw) {
  const res = findRes(resId); if (!res) return;
  let q = String(raw || '').trim(); if (!q) return;
  const looksURL = /^https?:\/\//i.test(q) || (/^[^\s]+\.[a-z]{2,}([\/?#:].*)?$/i.test(q) && !q.includes(' '));
  let url;
  if (looksURL) url = /^https?:\/\//i.test(q) ? q : 'https://' + q;
  else { url = 'https://www.google.com/search?q=' + encodeURIComponent(q); if (IS_NATIVE && !res.native) res.native = true; }
  if (!IS_NATIVE && !looksURL) {
    native('openExternal', { url }) || window.open(url, '_blank');
    (P.searchNotice ||= {})['stage-' + resId] = q;
    document.activeElement?.blur(); tick();
    toast('Opened Google search in a new tab.');
    return;
  }
  if (P.searchNotice) delete P.searchNotice['stage-' + resId];
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
  const pdfHost = hit?.closest('.pdf-host');
  if (pdfHost?.__zoomBy) { if (phase === 'toggle') pdfHost.__zoomToggle?.(x, y); else pdfHost.__zoomBy(1 + mag, x, y); return; }
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

// ============================================================ edit in place (Present screen) (moved to web/quick-edit.js)

// ============================================================ annotation (ink)
let inkCanvas = null, inkCtx = null, inkDrawing = null, inkUndo = [], inkLoaded = false;
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
  inkPrev = null; inkPrevCtx = null; inkLoaded = false;
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
  if (kind === 'treble' || kind === 'bass') {
    const a = [0, 1, 2, 3, 4].map(i => 40 + i * sp), H = 4 * sp + 96, W = 6000, L = 20, s = sp / 360, ink = '#3d4452';
    const bar = `<rect x='${L}' y='${a[0]}' width='2' height='${a[4] - a[0] + 1.6}' fill='${ink}'/>`;
    const clef = kind === 'treble'
      ? `<path fill='${ink}' transform='translate(${L + 12} ${a[3] + 0.8}) scale(${s})' d='${CLEF_G}'/>`
      : `<path fill='${ink}' transform='translate(${L + 12} ${a[1] + 0.8}) scale(${s})' d='${CLEF_F}'/>`;
    const staffLines = a.map(y => `<rect x='${L}' y='${y}' width='${W - L}' height='1.6' fill='#6b7385'/>`).join('');
    return `${svg(W, H, staffLines + bar + clef)} 0 0 / auto repeat-y content-box, #ffffff`;
  }
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
  const paperKind = S.settings.boardPaper || 'staff';
  const paper = P.ink.blank ? boardPaper(paperKind) : '';
  host.style.background = !P.ink.blank ? 'transparent' : paper || '#ffffff';
  host.classList.toggle('papered', P.ink.blank && paperKind !== 'blank');
  const colors = [['#e63946', 'Red'], ['#1d3557', 'Navy'], ['#2a9d8f', 'Teal'], ['#f4a261', 'Orange'], ['#7b2cbf', 'Purple'], ['#111111', 'Black'], ['#ffffff', 'White'], ['#ffd60a', 'Yellow']];
  const drawingActive = !P.ink.interact;
  const tb = (t, label) => `<button class="${drawingActive && P.ink.tool === t ? 'on' : ''}" data-action="ink-tool" data-t="${t}" style="${drawingActive ? '' : 'opacity:.5'}">${label}</button>`;
  $('#ink-bar').innerHTML = `<span class="ink-grip" title="Drag to move this toolbar">⋮⋮</span>
    ${P.ink.blank ? '' : `<span class="ink-mode-seg" role="group" aria-label="Drawing mode"><button class="${drawingActive ? 'on' : ''}" data-action="ink-mode" data-m="draw" title="Draw on top of the screen">${IC('ico:pen')} Draw</button><button class="${!drawingActive ? 'on' : ''}" data-action="ink-mode" data-m="interact" title="Interact with slides/tools underneath (drawings stay visible)">${IC('ico:pointer')} Interact</button></span>`}
    ${tb('pen', `${IC('ico:pen')} Pen`)}${tb('hl', `${IC('ico:highlight')} Highlight`)}${tb('line', `${IC('ico:line')} Line`)}${tb('arrow', `${IC('ico:arrow')} Arrow`)}${tb('rect', `${IC('ico:box')} Box`)}${tb('circle', `${IC('ico:circle')} Circle`)}${tb('text', 'T Text')}${tb('erase', `${IC('ico:erase')} Erase`)}
    <span style="width:6px"></span>
    ${colors.map(([c, nm]) => `<button class="dot ${P.ink.color === c ? 'on' : ''}" style="background:${c}" data-action="ink-color" data-c="${c}" title="${nm}" aria-label="${nm}"></button>`).join('')}
    <select data-action-change="ink-size" aria-label="Brush size" style="background:transparent;color:#fff;border:1px solid #555;border-radius:6px;padding:2px">
      ${[2, 4, 8, 14].map(s => `<option value="${s}" ${P.ink.size === s ? 'selected' : ''} style="color:#000">${s}px</option>`).join('')}</select>
    ${P.ink.blank ? `<select data-action-change="board-paper" title="Paper" aria-label="Board paper" style="background:transparent;color:#fff;border:1px solid #555;border-radius:6px;padding:2px">${[['blank', 'Blank'], ['staff', 'Music staff'], ['treble', 'Treble staff'], ['bass', 'Bass staff'], ['grand', 'Grand staff'], ['grid', 'Grid']].map(([v, l]) => `<option value="${v}" ${paperKind === v ? 'selected' : ''} style="color:#000">${l}</option>`).join('')}</select>` : ''}
    <button data-action="ink-undo" title="Undo (${IS_MAC_OS ? '⌘Z' : 'Ctrl+Z'})" ${inkUndo.length ? '' : 'disabled'}>${IC('ico:undo')} Undo</button>
    <button data-action="ink-clear" title="Clear board (can be undone)">${IC('ico:trash')} Clear</button>
    <button data-action="ink-close" title="Close drawing (Esc)" aria-label="Close drawing">${IC('ico:close')}</button>`;
  placeInkBar();
  host.querySelector('#ink-paused-pill')?.remove();
  if (P.ink.on && !P.ink.blank && P.ink.interact) {
    const pill = document.createElement('div');
    pill.id = 'ink-paused-pill';
    pill.className = 'ink-paused-pill';
    pill.innerHTML = `<span>Drawing paused</span><button type="button" data-action="ink-mode" data-m="draw">Resume</button>`;
    host.appendChild(pill);
  }
  inkPaperTop();
}
window.closeGlobalAnnotate = () => {
  if (!P.ink.on) return;
  saveInk();
  P.ink.on = false; P.ink.interact = false;
  updateInkUI(); renderDock();
};
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
  if (!inkCanvas || !P.inkKey || !inkCanvas.width || !inkLoaded) return;
  const dpr = window.devicePixelRatio || 1;
  P.inkStore[P.inkKey] = { d: inkCanvas.toDataURL(), w: inkCanvas.width / dpr, h: inkCanvas.height / dpr };
}
function restoreInk() {
  if (!inkCanvas) return;
  inkLoaded = true;
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
const R_MAP = {};
let R_TIMER = 0;
function randState(cls) {
  const k = cls?.id || '_';
  return (R_MAP[k] ||= { last: '', used: new Set(), groups: null, groupN: 4, noRepeat: false });
}
const NOISE = { stream: null, analyser: null, level: 0, limit: 60, warnAt: 0, holdUntil: 0, beep: true };
function noiseLimit() { return S?.settings?.noiseLimit ?? NOISE.limit; }
function noiseBeep() { return S?.settings?.noiseBeep ?? NOISE.beep; }
let SIG_COLOR = '#3b6cf6';
const SIG_COLORS = ['#3b6cf6', '#e63946', '#2a9d8f', '#e76f51', '#7b2cbf', '#1d3557'];
function toolBody(name) {
  const cls = currentClass();
  switch (name) {
    case 'timer': {
      const T = (S.settings.timerTool ||= { min: 4, label: 'Work time', sound: 'bell' });
      return `<div class="tt">
      <div class="tt-presets">${[0.5, 1, 2, 3, 5, 10, 15].map(m => `<button data-action="quick-timer" data-m="${m}"><b>${m < 1 ? '30' : m}</b><small>${m < 1 ? 'sec' : 'min'}</small></button>`).join('')}</div>
      <div class="tt-custom">
        <div class="tt-step"><button data-action="tt-step" data-d="-0.5" title="30 seconds less" aria-label="30 seconds less">${IC('ico:minus')}</button><label><input id="tt-min" type="number" min="0.5" step="0.5" value="${T.min}" data-action-input="tt-field" data-k="min"><span>min</span></label><button data-action="tt-step" data-d="0.5" title="30 seconds more" aria-label="30 seconds more">${IC('ico:plus')}</button></div>
        <input id="tt-label" placeholder="Label (optional)" value="${esc(T.label)}" data-action-input="tt-field" data-k="label">
        <div class="tt-row"><button class="tt-snd ${T.sound === 'none' ? 'off' : ''}" data-action="tt-mute" title="${T.sound === 'none' ? 'Sound off: click to turn on' : 'Click for no sound at the end'}">${IC(T.sound === 'none' ? 'ico:mute' : 'ico:bell')}</button><select id="tt-sound" data-action-change="tt-sound">${soundOptions(T.sound === 'none' ? (T.lastSound || 'bell') : T.sound)}</select></div>
        <button class="tt-go" data-action="custom-timer">${IC('ico:play')} Start</button>
      </div></div>`;
    }
    case 'points': {
      if (!cls) return '<div class="muted">Points are kept per class. Show a class first.</div>';
      return cls.points.map((t, i) => `<div class="team"><input value="${esc(t.name)}" data-bind="${clsPath(cls)}.points.${i}.name"><button class="btn ic-btn" data-action="pt" data-i="${i}" data-d="-1" aria-label="Subtract point">${IC('ico:minus')}</button><span class="score">${t.score}</span><button class="btn primary ic-btn" data-action="pt" data-i="${i}" data-d="1" aria-label="Add point">${IC('ico:plus')}</button>${cls.points.length > 1 ? `<button class="iconbtn" data-action="pt-del-row" data-i="${i}" title="Remove ${esc(t.name)}" aria-label="Remove team">${IC('ico:close')}</button>` : ''}</div>`).join('') +
        `<div class="row"><button class="btn small ic-btn" data-action="pt-add">${IC('ico:plus')} Team</button><button class="btn small" data-action="pt-reset">Reset scores</button></div>`;
    }
    case 'noise': {
      const lim = noiseLimit(), beepOn = noiseBeep();
      return `<div class="meter" id="nm"><div></div><span class="lim" style="left:${lim}%"></span></div>
      ${S.settings.noiseDyn ? `<div class="dyn-scale">${DYNAMICS.map(d => `<span>${d}</span>`).join('')}</div>` : ''}
      <div class="meter-label" id="nm-label">${NOISE.stream ? '…' : 'Microphone off'}</div>
      <label class="fld"><span>Too-loud limit${S.settings.noiseDyn ? ` <b class="dyn" id="nm-limdyn">${dynOf(lim)}</b>` : ''}</span><input type="range" min="10" max="100" value="${lim}" data-action-input="noise-limit"></label>
      <label class="chk"><input type="checkbox" ${S.settings.noiseDyn ? 'checked' : ''} data-action-change="noise-dyn"> Show as dynamics (pp p mp mf f ff)</label>
      <label class="chk"><input type="checkbox" ${beepOn ? 'checked' : ''} data-action-change="noise-beep"> Chime when too loud</label>
      ${NOISE.stream ? '<button class="btn" data-action="noise-stop">Stop microphone</button>' : '<button class="btn primary" data-action="noise-start">Start microphone</button>'}`;
    }
    case 'random': {
      if (!cls) return '<div class="muted">Show a class to use its roster.</div>';
      if (!cls.roster.length) return `<div class="muted" style="margin-bottom:6px">No student names in ${esc(cls.name)} yet. Paste one name per line below:</div>
        <textarea id="rand-quick-ta" rows="4" placeholder="Alex\nBrianna\nCarlos…"></textarea>
        <div class="row"><button class="btn primary grow" data-action="rand-quick-add">Add names</button><button class="btn" data-action="rand-open-roster">Open Setup</button></div>`;
      const rs = randState(cls);
      const left = cls.roster.filter(n => !rs.used.has(n)).length;
      return `<div class="rand-out" id="rand-out">${esc(rs.last || '—')}</div>
        <div class="row"><button class="btn primary grow" data-action="rand-pick">Pick a student</button><label class="chk small"><input type="checkbox" id="rand-norep" ${rs.noRepeat ? 'checked' : ''} data-action-change="rand-norep"> No repeats</label></div>
        ${rs.noRepeat ? `<div class="row small muted"><span>${left} of ${cls.roster.length} left</span><span class="grow"></span><button class="btn small" data-action="rand-reset">Reset</button></div>` : ''}
        <div class="row"><span class="small muted">Groups of</span><input type="number" min="2" max="12" value="${rs.groupN}" style="width:60px" data-action-input="rand-n"><button class="btn" data-action="rand-groups">Make groups</button></div>
        ${rs.groups ? `<div class="groups">${rs.groups.map((g, i) => `<div><b>Group ${i + 1}</b><br>${g.map(esc).join('<br>')}</div>`).join('')}</div>` : ''}`;
    }
    case 'signal': return `<div class="sig-grid">${SIGNALS.map((s, i) => `<button class="${P.signal?.text === s.text ? 'active' : ''}" style="background:${s.color}" data-action="signal" data-i="${i}">${s.text}</button>`).join('')}</div>
      <div class="sig-swatches">${SIG_COLORS.map(c => `<button type="button" class="sig-sw ${SIG_COLOR === c ? 'on' : ''}" style="background:${c}" data-action="sig-col" data-c="${c}" aria-label="Signal color"></button>`).join('')}</div>
      <div class="row"><input id="sig-custom" class="grow" placeholder="Custom signal…" onkeydown="if(event.key==='Enter'){event.preventDefault();A['signal-custom']();}"><button class="btn" data-action="signal-custom">Show</button></div>
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
    const c = ac(); c.resume().catch(() => {});
    NOISE.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    await c.resume();
    const src = c.createMediaStreamSource(NOISE.stream);
    NOISE.analyser = c.createAnalyser(); NOISE.analyser.fftSize = 1024; src.connect(NOISE.analyser);
    NOISE.buf = new Float32Array(NOISE.analyser.fftSize);
  } catch (e) {
    const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
    const msg = e?.name === 'NotAllowedError'
      ? (isMac ? 'Microphone blocked — allow Rehearsal in System Settings → Privacy & Security → Microphone.' : 'Microphone blocked — allow microphone access in your browser or system privacy settings.')
      : 'Microphone unavailable — check your mic connection and permissions.';
    toast(msg, 4500); NOISE.stream = null;
  }
  rerenderTool('noise');
}
function noiseStop() { NOISE.stream?.getTracks().forEach(t => t.stop()); NOISE.stream = null; NOISE.analyser = null; rerenderTool('noise'); }
// noise level (0–100) as a music dynamic, pp … ff, in six equal bands
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const dynOf = L => DYNAMICS[clamp(Math.floor(L / (100 / 6)), 0, 5)];
function tickNoise() {
  if (!NOISE.analyser || !P.tools.noise) return;
  if (Date.now() < NOISE.holdUntil) return; // pause briefly after our own warning chime so it doesn't self-trigger
  NOISE.analyser.getFloatTimeDomainData(NOISE.buf);
  let sum = 0; for (const v of NOISE.buf) sum += v * v;
  const db = 20 * Math.log10(Math.sqrt(sum / NOISE.buf.length) + 1e-6); // ~ -60 (quiet) .. 0 (loud)
  const lvl = clamp((db + 60) / 50 * 100, 0, 100);
  NOISE.level = NOISE.level * 0.7 + lvl * 0.3;
  const bar = $('#nm > div'), lab = $('#nm-label'); if (!bar) return;
  const L = NOISE.level, lim = noiseLimit();
  bar.style.width = L + '%';
  bar.style.background = L > lim ? '#e63946' : L > lim * 0.75 ? '#f4a261' : '#2a9d8f';
  const html = S.settings.noiseDyn
    ? `<span class="dyn">${dynOf(L)}</span>${L > lim ? ` <span class="dyn-warn">${IC('ico:loud')} Too loud (limit ${dynOf(lim)})</span>` : ''}`
    : L > lim ? IC('ico:loud') + ' Too loud!' : L > lim * 0.75 ? IC('ico:mid') + ' Getting loud' : L > lim * 0.4 ? IC('ico:good') + ' Good' : IC('ico:mute') + ' Quiet';
  if (lab.__h !== html) { lab.__h = html; lab.innerHTML = html; }
  if (L > lim && noiseBeep() && Date.now() - NOISE.warnAt > 5000) {
    NOISE.warnAt = Date.now();
    NOISE.holdUntil = Date.now() + 1300;
    playSound('ding');
  }
}

// ============================================================ EDITOR (moved to web/editor.js)


// ============================================================ actions
const A = {
  tab: el => { TAB = el.dataset.tab; renderEditor(); },
  'plan-sub': el => { PLAN_SUB = el.dataset.sub; try { localStorage.setItem('rehearsal-plan-tab', PLAN_SUB); } catch { } renderEditor(); },
  present: () => go('present'),
  edit: () => { exitFullscreen(); go('edit'); },
  fullscreen: () => { if (!native('fullscreen')) { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); } },
  // dock / tools
  tool: el => {
    const n = el.dataset.tool;
    if (P.tools[n]) { delete P.tools[n]; if (n === 'noise') noiseStop(); renderTools(); renderDock(); return; }
    const saved = S.settings.toolPos?.[n];
    P.tools[n] = saved ? { x: saved.x * innerWidth, y: saved.y * innerHeight } : { x: 40, y: 110 };
    renderTools(); placeTool(n, !saved); renderDock();
  },
  'tool-close': el => { const n = el.dataset.tool; delete P.tools[n]; if (n === 'noise') noiseStop(); renderTools(); renderDock(); },
  'quick-timer': el => {
    const m = Number(el.dataset.m), T = S.settings.timerTool || {};
    const typed = $('#tt-label')?.value?.trim();
    const defLbl = m < 1 ? '30 seconds' : `${m} minute${m > 1 ? 's' : ''}`;
    const label = typed && typed !== 'Work time' ? typed : defLbl;
    startTimer({ label, minutes: m, sound: T.sound || 'bell' });
    if (P.tools.timer) { delete P.tools.timer; renderTools(); renderDock(); }
  },
  'custom-timer': () => {
    const T = S.settings.timerTool || {};
    startTimer({ label: $('#tt-label').value || 'Timer', minutes: Number($('#tt-min').value) || 1, sound: T.sound || $('#tt-sound').value });
    if (P.tools.timer) { delete P.tools.timer; renderTools(); renderDock(); }
  },
  'comp-quick-timer': () => { startTimer({ label: '2 minutes', minutes: 2, sound: S.settings.timerTool?.sound || 'bell' }); tick(); },
  'unpin-schedule': () => { P.pinned = null; S.settings.lastPinned = ''; save(); P.layoutKey = ''; onClassSwitched(); renderDock(); tick(); toast('Following your bell schedule.'); },
  'fb-audio-stop': () => { fbStopAudio(); renderDock(); },
  'ie-priv-toggle': () => { P.showPrivNotes = !P.showPrivNotes; P.sideKey = ''; tick(); },
  'tl-enable-all': el => { const c = S.classes[+el.dataset.ci] || selClass(); if (!c) return; c.automations.forEach(a => a.enabled = true); save(); tlRerender(); toast(`Turned on ${c.automations.length} automations for ${c.name}.`); },
  'tt-step': el => { const T = (S.settings.timerTool ||= {}), i = $('#tt-min'); T.min = Math.max(0.5, Math.round(((Number(i?.value) || 0) + Number(el.dataset.d)) * 2) / 2); if (i) i.value = T.min; save(); },
  'tt-mute': () => { const T = (S.settings.timerTool ||= {}); if (T.sound === 'none') T.sound = T.lastSound || 'bell'; else { T.lastSound = T.sound || 'bell'; T.sound = 'none'; } save(); rerenderTool('timer'); },
  'timer-mute': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm) return; if (tm.sound === 'none') { tm.sound = S.settings.timerTool?.lastSound || 'bell'; tm.muted = false; } else tm.muted = !tm.muted; renderTimers(); },
  'timer-pause': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm || tm.doneAt) return; if (tm.pausedLeft != null) { tm.endAt = onClockSecond(Date.now() + tm.pausedLeft); tm.pausedLeft = null; } else tm.pausedLeft = tm.endAt - Date.now(); updateTimers(); if (P.companion) tick(); },
  'timer-add': el => { const tm = P.timers.find(t => t.id === el.dataset.id); if (!tm) return; tm.doneAt = 0; if (tm.pausedLeft != null) tm.pausedLeft += 60000; else tm.endAt = Math.max(tm.endAt, Date.now()) + 60000; tm.total = Math.max(tm.total, timerLeft(tm)); renderTimers(); },
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
  'pt-del-row': el => { const c = currentClass(), i = +el.dataset.i; if (!c || c.points.length <= 1 || !c.points[i]) return; const prev = JSON.parse(JSON.stringify(c.points)), name = c.points[i].name; c.points.splice(i, 1); save(); rerenderTool('points'); undoToast(`Removed “${name}”.`, () => { c.points = prev; save(); rerenderTool('points'); }); },
  'pt-del': () => { const c = currentClass(); if (!c || c.points.length <= 1) return; const prev = JSON.parse(JSON.stringify(c.points)), last = c.points.pop(); save(); rerenderTool('points'); undoToast(`Removed “${last.name}”.`, () => { c.points = prev; save(); rerenderTool('points'); }); },
  'pt-reset': () => { const c = currentClass(); if (!c || !c.points.some(p => p.score)) return; const prev = JSON.parse(JSON.stringify(c.points)); c.points.forEach(p => p.score = 0); save(); rerenderTool('points'); undoToast('Reset all team scores to 0.', () => { c.points = prev; save(); rerenderTool('points'); }); },
  'noise-start': () => noiseStart(),
  'noise-stop': () => noiseStop(),
  'rand-quick-add': () => {
    const c = currentClass(), raw = $('#rand-quick-ta')?.value || '';
    if (!c) return;
    const names = raw.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
    if (!names.length) return toast('Paste at least one student name first.');
    c.roster.push(...names); save(); rerenderTool('random');
    toast(`Added ${names.length} student${names.length === 1 ? '' : 's'} to ${c.name}.`);
  },
  'rand-open-roster': () => { const c = currentClass(); if (c) SEL_CLASS = c.id; TAB = 'classes'; go('edit'); },
  'rand-reset': () => { const c = currentClass(); if (!c) return; const rs = randState(c); rs.used.clear(); rerenderTool('random'); },
  'rand-pick': () => {
    const c = currentClass(); if (!c?.roster.length) return;
    const rs = randState(c);
    clearInterval(R_TIMER);
    let pool = c.roster; if (rs.noRepeat) { pool = c.roster.filter(n => !rs.used.has(n)); if (!pool.length) { rs.used.clear(); pool = c.roster; } }
    const out = $('#rand-out'); let n = 0;
    R_TIMER = setInterval(() => {
      if (out) out.textContent = c.roster[Math.floor(Math.random() * c.roster.length)];
      if (++n > 14) { clearInterval(R_TIMER); R_TIMER = 0; rs.last = pool[Math.floor(Math.random() * pool.length)]; rs.used.add(rs.last); rerenderTool('random'); playSound('ding'); }
    }, 65);
  },
  'rand-groups': () => {
    const c = currentClass(); if (!c?.roster.length) return;
    const rs = randState(c);
    const names = [...c.roster].sort(() => Math.random() - 0.5); const n = Math.max(1, Math.ceil(names.length / rs.groupN));
    rs.groups = [...Array(n)].map(() => []); names.forEach((x, i) => rs.groups[i % n].push(x)); rerenderTool('random');
  },
  'sig-col': el => { SIG_COLOR = el.dataset.c || '#3b6cf6'; rerenderTool('signal'); },
  signal: el => { P.signal = { ...SIGNALS[el.dataset.i] }; rerenderTool('signal'); },
  'signal-custom': () => { const v = $('#sig-custom')?.value.trim(); if (v) { P.signal = { text: v, color: SIG_COLOR }; rerenderTool('signal'); } },
  'signal-clear': () => { P.signal = null; rerenderTool('signal'); if (P.companion) tick(); },
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
        window.closeAllPdfAnnot?.();
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
      if (turningOn) { window.closeAllPdfAnnot?.(); P.ink.on = true; P.ink.interact = false; }
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
  'wm-web': () => { const w = addWindow({ kind: 'web', url: '' }); setTimeout(() => $(`[data-wurl="${w.id}"]`)?.focus(), 30); },
  'wm-files': () => {
    const ex = winList().find(w => w.kind === 'files');
    if (ex) { P.winMenu = false; renderWinMenu(); renderDock(); bringToFront(ex); setTimeout(() => $(`.win[data-win="${ex.id}"] .fb-search`)?.focus(), 30); return; }
    const w = addWindow({ kind: 'files' }, { w: 0.46, h: 0.72 });
    setTimeout(() => $(`.win[data-win="${w.id}"] .fb-search`)?.focus(), 40);
  },
  'wm-file': async () => { P.winMenu = false; renderWinMenu(); renderDock(); const fs = await pickFile('application/pdf,image/*,video/*,audio/*,.mxl,.musicxml,.mscz,.mscx', true); for (const f of fs) { const id = await storeFile(f); addWindow(spIsScoreName(f.name) ? { kind: 'score', score: { fileId: id, name: f.name } } : { kind: 'file', fileId: id }); } },
  'wm-score': async () => {
    P.winMenu = false; renderWinMenu(); renderDock();
    // reopen the score you used last, or open Score Practice with its friendly dropzone empty state
    const lib = typeof spLibrary === 'function' ? spLibrary() : [];
    const pick = lib.find(x => x.id === S.settings.lastScore) || lib[0];
    if (pick) { const saved = S.scoreSettings?.[pick.id]; addWindow({ kind: 'score', score: saved ? JSON.parse(JSON.stringify(saved)) : { fileId: pick.id, name: S.files[pick.id]?.name } }); return; }
    addWindow({ kind: 'score', score: { name: 'Score Practice' } }, { w: 0.68, h: 0.8 }); },
  'wm-scan': () => {
    P.winMenu = false; renderWinMenu(); renderDock();
    const ex = winList().find(w => w.kind === 'scan');
    if (ex) { bringToFront(ex); return; }
    addWindow({ kind: 'scan', scan: {} }, { w: 0.82, h: 0.86 });
  },
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
  'vol-test': () => { const c = acForPlayback(); [60, 64, 67, 72].forEach((m, i) => { const t = c.currentTime + 0.05 + i * 0.25, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); o.connect(g).connect(musicOut(c)); o.start(t); o.stop(t + 0.55); }); },
  'audio-reset': () => { stopMusicHosts(); resetAudioEngine(); toast('Sound engine reset.'); },
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
  'wm-rocket': () => {
    const w = addWindow({ kind: 'rocket' }); w.w = 0.82; w.h = 0.86; save(); applyWinGeom();
    setTimeout(() => { const f = document.querySelector(`.win[data-win="${w.id}"] .rocket-frame`); try { f?.focus(); f?.contentWindow?.focus(); } catch {} }, 120);
  },
  'wm-dash': () => {
    const w = addWindow({ kind: 'dash' }); w.w = 0.78; w.h = 0.84; save(); applyWinGeom();
    setTimeout(() => { const f = document.querySelector(`.win[data-win="${w.id}"] .dash-frame`); try { f?.focus(); f?.contentWindow?.focus(); } catch {} }, 120);
    if (!window.__appDashKeysWired) {
      window.__appDashKeysWired = true;
      const fwd = (action, e) => {
        if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (e.code !== 'Space' && e.key !== ' ' && e.code !== 'ArrowUp') return;
        const frames = document.querySelectorAll('.dash-frame');
        if (!frames.length) return;
        const topFrame = frames[frames.length - 1];
        if (action === 'down' && e.repeat) return;
        e.preventDefault();
        try { topFrame.contentWindow?.postMessage({ type: 'rd-key', action }, '*'); } catch {}
      };
      window.addEventListener('keydown', e => fwd('down', e), true);
      window.addEventListener('keyup', e => fwd('up', e), true);
    }
  },
  'wm-warmup': () => addWindow({ kind: 'warmup' }),
  'wm-res': el => addWindow({ kind: 'res', resId: el.dataset.id }),
  'wm-lib': el => { const id = el.dataset.id, n = S.files[id]?.name; addWindow(spIsScoreName(n) ? { kind: 'score', score: { fileId: id, name: n } } : { kind: 'file', fileId: id }); },
  'wm-closeall': () => { stopAllPresentAudio(); dropGradeCard($('#p-wins')); const k = curWinKey(); S.windows[k] = []; P.winMenu = false; save(); renderWinMenu(); renderDock(); renderWins(context(now()), true); },
  'win-close': el => {
    const closing = winList().find(w => w.id === el.dataset.id);
    if (closing?.kind === 'rec' && REC.state !== 'idle') {
      if (REC.state === 'rec' || REC.state === 'countin') { recStop(); return toast('Recording stopped. Save or delete it, then close the window.'); }
      if (REC.state === 'review') return toast('Save or delete the recording first.');
    }
    const finishClose = () => {
      if (closing) stopAllPresentAudio({ closing });
      const k = curWinKey(); S.windows[k] = winList(k).filter(w => w.id !== el.dataset.id); save(); renderWins(context(now()), true);
    };
    if (closing?.kind === 'scan') {
      const sfHost = document.querySelector(`.win[data-win="${closing.id}"] [data-scan-win]`);
      if (typeof sfHost?.__sfRequestClose === 'function') {
        sfHost.__sfRequestClose(finishClose);
        return;
      }
    }
    finishClose();
  },
  'win-zoom-reset': el => { const w = findWin(el.dataset.id); if (w) { w.zoom = 1; applyZoom(w); save(); } },
  'bm-open': el => {
    const b = bmFind(el.dataset.id), w = findWin(el.dataset.win); BM.open = null; renderBmMenu();
    if (b?.url && w) openWebAddress(w, b.url);
  },
  'bm-folder': el => { const o = BM.open; BM.open = o && o.folderId === el.dataset.id && o.winId === el.dataset.win ? null : { winId: el.dataset.win, folderId: el.dataset.id }; renderBmMenu(); },
  'bm-star': el => {
    const isStage = el.dataset.target === 'stage';
    const target = isStage ? findRes(el.dataset.id) : findWin(el.dataset.id);
    if (!target?.url) return;
    S.bookmarks ||= [];
    if (S.bookmarks.some(b => b.url === target.url)) return toast('Already bookmarked.');
    const title = (target.title || (isStage ? guessTitle(target.url) : winTitle(target))).slice(0, 60);
    S.bookmarks.push({ id: uid(), title, url: target.url }); save(); WIN.sig = ''; toast('Bookmarked.');
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
  'dock-reset': () => {
    const prevDock = JSON.parse(JSON.stringify(S.settings.dock || {})), prevHide = S.settings.hideDockAfter;
    S.settings.dock = {}; S.settings.hideDockAfter = 0; save(); renderDock(); renderDockCustom();
    undoToast('Toolbar reset to defaults.', () => { S.settings.dock = prevDock; S.settings.hideDockAfter = prevHide; save(); renderDock(); renderDockCustom(); });
  },
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
    const prevSel = P.stageSel[c.key];
    cls.hideWarmup = true; if (prevSel === 'warmup') delete P.stageSel[c.key]; save(); P.stageKey = '';
    undoToast(`Hid the warm-up tab from ${cls.name}.`, () => { cls.hideWarmup = false; if (prevSel === 'warmup') P.stageSel[c.key] = 'warmup'; save(); P.stageKey = ''; });
  },
  'warmup-show': () => { const c = ieClass() || null, cls = c?.cls || selClass(); if (!cls) return; cls.hideWarmup = false; save(); P.stageKey = ''; if (VIEW !== 'present') renderEditor(); },
  'res-remove': el => {
    const c = context(now()), cls = c.cls; if (!cls) return;
    const idx = cls.resources.findIndex(x => x.id === el.dataset.id), r = idx >= 0 ? cls.resources[idx] : null; if (!r) return;
    cls.resources.splice(idx, 1);
    const removedWins = [];
    for (const [wk, list] of Object.entries(S.windows || {})) for (let i = list.length - 1; i >= 0; i--) if (list[i].resId === r.id) removedWins.push([wk, list.splice(i, 1)[0]]);
    const prevSel = P.stageSel[c.key];
    if (prevSel === r.id) P.stageSel[c.key] = 'warmup';
    P.stageKey = ''; WIN.sig = ''; save();
    undoToast(`Removed “${r.title || 'tab'}” from ${cls.name}.`, () => {
      cls.resources.splice(Math.min(idx, cls.resources.length), 0, r);
      for (const [wk, w] of removedWins) (S.windows[wk] ||= []).push(w);
      if (prevSel === r.id) P.stageSel[c.key] = r.id;
      P.stageKey = ''; WIN.sig = ''; save();
    });
  },
  'edit-mode': () => {
    document.activeElement?.blur?.();
    P.editMode = !P.editMode; if (!P.editMode) { P.lookOpen = P.autoDrawer = P.showPrivNotes = false; renderLook(); renderAutoDrawer(); }
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
  'icons-reset': () => {
    const prevIcons = JSON.parse(JSON.stringify(S.settings.icons || {}));
    const prevRes = [];
    for (const c of S.classes) for (const r of c.resources) if (r.icon !== undefined) { prevRes.push([r, r.icon]); delete r.icon; }
    S.settings.icons = {}; save(); P.stageKey = ''; P.sideKey = ''; WIN.sig = ''; renderDock(); renderIcons();
    undoToast('Icons reset to defaults.', () => {
      S.settings.icons = prevIcons;
      for (const [r, ic] of prevRes) r.icon = ic;
      save(); P.stageKey = ''; P.sideKey = ''; WIN.sig = ''; renderDock(); renderIcons();
    });
  },
  'look-open': () => { P.lookOpen = !P.lookOpen; P.autoDrawer = false; renderAutoDrawer(); renderLook(); },
  'look-theme': el => { const c = ieClass(); if (!c) return; const th = c.cls.theme; Object.assign(th, { ...THEMES[el.dataset.k], image: th.image || '', dim: th.dim }); delete th.titleText; delete th.clockText; save(); renderLook(); },
  'look-text-reset': () => { const c = ieClass(); if (!c) return; delete c.cls.theme.titleText; delete c.cls.theme.clockText; save(); renderLook(); },
  'look-pic': async () => { const c = ieClass(); if (!c) return; const [f] = await pickFile('image/*'); if (!f) return; const id = await storeFile(f); c.cls.theme.image = 'file:' + id; save(); renderLook(); },
  'look-bg': el => { const c = ieClass(); if (!c) return; c.cls.theme.image = 'bg:' + el.dataset.bg; save(); renderLook(); },
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
  'ink-toggle': () => {
    if (P.ink.on && !P.ink.blank) { saveInk(); P.ink.on = false; }
    else {
      if (typeof window.closeAllPdfAnnot === 'function') window.closeAllPdfAnnot();
      saveInk(); P.ink.on = true; P.ink.blank = false; P.ink.interact = false;
      switchInkKey(desiredInkKey());
    }
    updateInkUI(); renderDock();
  },
  'board-toggle': () => {
    if (P.ink.on && P.ink.blank) { saveInk(); P.ink.on = false; }
    else {
      if (typeof window.closeAllPdfAnnot === 'function') window.closeAllPdfAnnot();
      saveInk(); P.ink.on = true; P.ink.blank = true; P.ink.interact = false;
      if (P.ink.color === '#ffffff') P.ink.color = '#111111';
      switchInkKey(desiredInkKey());
    }
    updateInkUI(); renderDock();
  },
  'ink-mode': el => { P.ink.interact = el.dataset.m === 'interact'; updateInkUI(); },
  'ink-tool': el => { P.ink.tool = el.dataset.t; P.ink.interact = false; updateInkUI(); },
  'ink-color': el => { P.ink.color = el.dataset.c; if (P.ink.tool === 'erase') P.ink.tool = 'pen'; P.ink.interact = false; updateInkUI(); },
  'ink-interact': () => { P.ink.interact = !P.ink.interact; updateInkUI(); },
  'ink-undo': () => inkDoUndo(),
  'ink-clear': () => {
    inkPushUndo(); inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0); inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height); inkCtx.restore(); saveInk();
    const t = toast('Drawing cleared.', 4500);
    const el = $('.toast');
    if (el) {
      const b = document.createElement('button');
      b.textContent = 'Undo'; b.style.cssText = 'margin-left:10px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.15);color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-weight:700';
      b.onclick = () => { inkDoUndo(); el.remove(); };
      el.appendChild(b);
    }
  },
  'ink-close': () => {
    saveInk();
    P.ink.on = false;
    const sr = stageNativeRes(true);
    if (sr && sr.markupMode) { sr.markupMode = false; P.forceStageUrl = sr.id; P.stageKey = ''; WIN.lastSync = ''; }
    updateInkUI(); renderDock(); tick();
  },
  // classes
  'class-sel': el => { SEL_CLASS = el.dataset.id; renderEditor(); renderClip(); $('#e-main').scrollTop = 0; },
  'class-add': () => { const c = newClass('New class'); S.classes.push(c); SEL_CLASS = c.id; save(); renderEditor(); },
  'class-dup': () => { const c = S.classes.find(x => x.id === SEL_CLASS); const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.name += ' (copy)'; d.notes = {}; for (const k of ['automations', 'resources', 'progress']) (d[k] || []).forEach(x => { if (x && x.id) x.id = uid(); }); S.classes.push(d); SEL_CLASS = d.id; save(); renderEditor(); },
  'class-del': () => {
    const c = S.classes.find(x => x.id === SEL_CLASS);
    if (!confirm(`Delete “${c.name}” and its notes? It will also be removed from bell schedules.`)) return;
    const idx = S.classes.indexOf(c), prevPeriods = S.templates.map(t => JSON.parse(JSON.stringify(t.periods)));
    S.classes = S.classes.filter(x => x !== c); S.templates.forEach(t => t.periods = t.periods.filter(p => p.classId !== c.id)); save(); renderEditor();
    undoToast(`Deleted “${c.name}”.`, () => {
      S.classes.splice(Math.min(idx, S.classes.length), 0, c); SEL_CLASS = c.id;
      S.templates.forEach((t, i) => { if (prevPeriods[i]) t.periods = prevPeriods[i]; });
      save(); renderEditor();
    });
  },
  'class-preview': () => { P.pinned = SEL_CLASS; go('present'); },
  theme: el => { const c = selClass(); c.theme = { ...THEMES[el.dataset.k], image: c.theme.image || '', ...(c.theme.panel != null ? { panel: c.theme.panel } : {}), ...(c.theme.dim != null ? { dim: c.theme.dim } : {}) }; save(); renderEditor(); },
  'theme-text-reset': () => { const c = selClass(); if (!c) return; delete c.theme.titleText; delete c.theme.clockText; save(); renderEditor(); },
  'theme-image': async () => { const [f] = await pickFile('image/*'); if (!f) return; const id = await storeFile(f); selClass().theme.image = 'file:' + id; save(); renderEditor(); },
  'theme-bg': el => { selClass().theme.image = 'bg:' + el.dataset.bg; save(); renderEditor(); },
  'theme-image-clear': () => { selClass().theme.image = ''; save(); renderEditor(); },
  'agenda-add': () => { selClass().agenda.push({ text: '', min: 0 }); save(); renderEditor(); $$('.agenda-row input')[$$('.agenda-row').length * 2 - 2]?.focus(); },
  'agenda-del': el => { const c = VIEW === 'edit' ? selClass() : ieClass()?.cls; if (!c) return; const k = +el.dataset.k, [st] = c.agenda.splice(k, 1); if (!st) return; TL_SEL = null; save(); tlRerender(); undoToast('Step removed.', () => { c.agenda.splice(Math.min(k, c.agenda.length), 0, st); TL_SEL = null; save(); tlRerender(); }); },
  'res-add-url': () => { const u = prompt('Paste a link (Google Slides/Docs/Drive, YouTube, Canva, any web page):'); if (!u) return; const url = /^https?:\/\//.test(u.trim()) ? u.trim() : 'https://' + u.trim(); selClass().resources.push({ id: uid(), title: guessTitle(url), url, mode: 'embed' }); save(); renderEditor(); },
  'res-add-file': async () => { const fs = await pickFile('application/pdf,image/*,video/*,audio/*', true); for (const f of fs) { const id = await storeFile(f); selClass().resources.push({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), fileId: id }); } save(); renderEditor(); },
  'res-del': el => { const c = selClass(), k = +el.dataset.k, [r] = c.resources.splice(k, 1); if (!r) return; save(); renderEditor(); undoToast('Resource removed.', () => { c.resources.splice(Math.min(k, c.resources.length), 0, r); save(); renderEditor(); }); },
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
  'tpl-del': el => { const t = S.templates[el.dataset.k]; if (!confirm(`Delete the “${t.name}” bell schedule?`)) return; const idx = +el.dataset.k, prevWeekdays = { ...S.weekdays }, prevOverrides = { ...S.overrides };
    S.templates.splice(idx, 1); for (const d in S.weekdays) if (S.weekdays[d] === t.id) S.weekdays[d] = ''; for (const k in S.overrides) if (S.overrides[k] === t.id) delete S.overrides[k]; save(); renderEditor();
    undoToast(`Deleted “${t.name}”.`, () => { S.templates.splice(Math.min(idx, S.templates.length), 0, t); S.weekdays = prevWeekdays; S.overrides = prevOverrides; save(); renderEditor(); }); },
  'per-add': el => { if (!S.classes.length) return toast('Add a class first.'); const t = S.templates[el.dataset.k]; const last = t.periods[t.periods.length - 1]; const start = last ? addMin(last.end, 5) : '08:00'; t.periods.push({ id: uid(), classId: S.classes[0]?.id || '', start, end: addMin(start, 50) }); save(); renderEditor(); },
  'per-del': el => { const ps = S.templates[el.dataset.k].periods, p = +el.dataset.p, [row] = ps.splice(p, 1); if (!row) return; save(); renderEditor(); undoToast('Period removed.', () => { ps.splice(Math.min(p, ps.length), 0, row); save(); renderEditor(); }); },
  'ov-add': () => { const d = new Date(); d.setDate(d.getDate() + 1); let k = dateKey(d); while (k in S.overrides) { d.setDate(d.getDate() + 1); k = dateKey(d); } S.overrides[k] = 'none'; save(); renderEditor(); },
  'ov-del': el => { const k = el.dataset.k, v = S.overrides[k]; delete S.overrides[k]; save(); renderEditor(); undoToast('Day override removed.', () => { S.overrides[k] = v; save(); renderEditor(); }); },
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
  'lib-del': el => { if (deleteLibraryFile(el.dataset.id)) renderEditor(); },
  // settings
  export: () => { const text = JSON.stringify(S, null, 2), name = `rehearsal-backup-${dateKey(new Date())}.json`; if (!native('saveText', { name, text })) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); } },
  import: async () => { const [f] = await pickFile('.json,application/json'); if (!f) return; try { const d = JSON.parse(await f.text()); if (!d || !Array.isArray(d.classes) || !d.classes.every(c => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string')) throw 0; if (!confirm('Replace all current data with this backup?')) return; const undo = keepOldData(); S = migrate(d); save(); renderEditor(); undoToast('Replaced.', undo); } catch { alert('That file is not a Rehearsal backup.'); } },
  reset: () => { if (!confirm('Erase everything and start over with the basic template (four music classes and a sample bell schedule)?')) return; const undo = keepOldData(); S = sampleData(); P.pinned = S.settings.lastPinned || null; save(); renderEditor(); undoToast('Replaced.', undo); },
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
  'board-paper': el => { saveInk(); S.settings.boardPaper = el.value; save(); switchInkKey(desiredInkKey()); updateInkUI(); },
  pin: el => { P.pinned = el.value || null; S.settings.lastPinned = P.pinned || ''; save(); P.layoutKey = ''; onClassSwitched(); renderDock(); },
  'ink-size': el => { P.ink.size = Number(el.value); },
  'noise-beep': el => { NOISE.beep = el.checked; S.settings.noiseBeep = el.checked; save(); },
  'noise-dyn': el => { S.settings.noiseDyn = el.checked; save(); rerenderTool('noise'); },
  'tt-sound': el => { const T = (S.settings.timerTool ||= {}); T.sound = el.value; if (el.value !== 'none') T.lastSound = el.value; save(); rerenderTool('timer'); },
  'rand-norep': el => { const rs = randState(currentClass()); rs.noRepeat = el.checked; rs.used.clear(); rerenderTool('random'); },
  'ov-date': el => {
    const oldK = el.dataset.old, newK = el.value;
    if (!newK || oldK === newK) return;
    if (newK in S.overrides && !confirm(`Replace the existing special day on ${longDate(parseKey(newK))}?`)) { el.value = oldK; return; }
    const val = S.overrides[oldK]; delete S.overrides[oldK]; S.overrides[newK] = val;
    save(); renderEditor();
  },
  'ie-sticky-note': el => {
    const c = ieClass(); if (!c) return;
    const today = dateKey(now());
    c.cls.screenNotes ||= {};
    const txt = $('[data-ie-pubnotes]')?.value ?? (c.cls.screenNotes[today] || c.cls.screenNotes._sticky || '');
    if (el.checked) { c.cls.screenNotes._sticky = txt; }
    else { delete c.cls.screenNotes._sticky; if (txt.trim()) c.cls.screenNotes[today] = txt; }
    save(); P.sideKey = '';
  },
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
  'noise-limit': el => { NOISE.limit = Number(el.value); S.settings.noiseLimit = NOISE.limit; save(); const l = $('#nm .lim'); if (l) l.style.left = NOISE.limit + '%'; const d = $('#nm-limdyn'); if (d) d.textContent = dynOf(NOISE.limit); },
  'rand-n': el => { randState(currentClass()).groupN = clamp(Number(el.value) || 4, 2, 12); },
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
      const redo = () => { if (VIEW === 'edit') renderEditor(); else if (P.autoDrawer && el.closest('#auto-drawer')) renderAutoDrawer(); };
      // Leaving a field with the mouse fires this at mouse-down; rebuilding then swallows the click. Wait for the click to finish.
      // A menu popup can swallow the pointer-up, so also redraw after a short wait.
      if (POINTER_DOWN) { pendingRerender = redo; setTimeout(() => { if (pendingRerender === redo) { pendingRerender = null; POINTER_DOWN = false; redo(); } }, 400); } else redo();
    }
  }
});
let POINTER_DOWN = false, pendingRerender = null;
document.addEventListener('pointerdown', () => { POINTER_DOWN = true; }, true);
const endPointer = () => {
  if (!POINTER_DOWN) return;
  POINTER_DOWN = false;
  // after the click has run (setTimeout 0 comes after click)
  setTimeout(() => { const f = pendingRerender; pendingRerender = null; if (f) f(); }, 0);
};
document.addEventListener('pointerup', endPointer, true);
document.addEventListener('pointercancel', endPointer, true);
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
  if (document.querySelector('#bug-modal, #wn-modal, #av-cal, #sr-ws-modal, #gr-card')) return;
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
document.addEventListener('pointerdown', () => { P.lastMove = Date.now(); if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().then(() => $('.sound-chip')?.remove()).catch(() => { }); }, true);

// ============================================================ boot
window.__companionState = on => { if (!on && P.companion) { P.companion = null; P.compAppsOpen = false; P.compAppsHover = false; tick(); } };
// Apps menu in Companion HUD opens on deliberate click (no accidental 240 ms hover hijack)

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
  // Update header/title/clock first so fitDock() measures the real class header width before placing step 1
  tick(); renderDock(); renderTour();
}
function endTour(silent = false) {
  const wasFull = !P.tourSteps;
  clearTimeout(P.tourDelayTimer);
  cancelAnimationFrame(P.tourRaf); P.tourRaf = 0;
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
  tick(); renderDock();
}
function stepTour(d) {
  if (P.tour == null) return;
  const steps = activeTourSteps(), n = P.tour + d;
  if (n >= steps.length) return endTour();
  P.tour = Math.max(0, n);
  renderTour();
}
function tourTarget(step) {
  const vis = sel => {
    if (!sel) return null;
    const el = $(sel);
    return el && el.offsetWidth > 0 && el.offsetHeight > 0 ? el : null;
  };
  let target = vis(step.sel);
  // If a toolbar button got tucked into the ⋯ overflow menu on a narrow window, point at ⋯ instead of losing the ring
  if (!target && step.sel && step.sel.includes('data-dock-id')) target = vis('#p-dock .dock-more');
  if (!target) target = vis(step.fallback);
  return target;
}
function positionTour() {
  if (P.tour == null || VIEW !== 'present') return;
  const steps = activeTourSteps(), step = steps[P.tour]; if (!step) return;
  const card = $('.tour-card'); if (!card) return;
  const target = tourTarget(step);
  const r = target ? target.getBoundingClientRect() : null;
  let ring = $('.tour-ring');
  if (r) {
    if (!ring) {
      ring = document.createElement('div'); ring.className = 'tour-ring';
      document.body.insertBefore(ring, card);
    }
    const pad = 6;
    Object.assign(ring.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
  } else if (ring) {
    ring.remove();
  }
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
}
function renderTour() {
  clearTimeout(P.tourDelayTimer);
  cancelAnimationFrame(P.tourRaf); P.tourRaf = 0;
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
    const bd = document.createElement('div'); bd.className = 'tour-backdrop'; bd.onclick = () => endTour();
    document.body.appendChild(bd);
    const card = document.createElement('div'); card.className = 'tour-card';
    card.innerHTML = `<div class="tour-top"><span>Step ${P.tour + 1} of ${steps.length}</span><button data-action="tour-skip">Close</button></div>
      <h3>${esc(step.title)}</h3><p>${esc(step.body)}</p>
      <div class="tour-foot"><button data-action="tour-prev" ${P.tour === 0 ? 'disabled' : ''}>← Back</button>
      <div class="tour-dots">${steps.map((_, i) => `<i class="${i === P.tour ? 'on' : ''}"></i>`).join('')}</div>
      <button class="primary" data-action="tour-next">${P.tour === steps.length - 1 ? 'Done' : 'Next →'}</button></div>`;
    document.body.appendChild(card);
    positionTour();
    // Re-align after header ResizeObserver / fitDock / layout settles on first launch
    P.tourRaf = requestAnimationFrame(() => {
      if (P.tour == null) return;
      positionTour();
      P.tourRaf = requestAnimationFrame(positionTour);
    });
  };
  if (step.delay) P.tourDelayTimer = setTimeout(paintOverlay, step.delay);
  else paintOverlay();
}

// ---------- Searchable Files Window (Audio / PDF / Scores / Images / Video + single-file Pin)
let FB_AUDIO = null, FB_AUDIO_ID = null;
function fbStopAudio() {
  if (FB_AUDIO) { try { FB_AUDIO.pause(); } catch { } FB_AUDIO = null; FB_AUDIO_ID = null; if (VIEW === 'present') renderDock(); }
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
    toast(`Switched to tab “${existing.title}”`);
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
function fbUnpinFileFromClass(id) {
  const cls = currentClass(); if (!cls) return;
  const idx = cls.resources.findIndex(r => r.fileId === id || r.score?.fileId === id);
  if (idx < 0) return;
  const [removed] = cls.resources.splice(idx, 1);
  if (P.stageSel[context(now()).key] === removed.id) P.stageSel[context(now()).key] = 'warmup';
  save(); P.stageKey = ''; tick();
  toast(`Unpinned “${removed.title}” from ${cls.name}`);
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
function deleteLibraryFile(id) {
  const f = S.files[id]; if (!f) return false;
  const refs = [];
  for (const c of S.classes) {
    const hits = [];
    if (c.resources.some(r => r.fileId === id || r.score?.fileId === id)) hits.push('tab');
    if (c.theme?.image === 'file:' + id) hits.push('background');
    if ((c.automations || []).some(a => a.fileId === id || a.sound === 'file:' + id)) hits.push('automation');
    if (hits.length) refs.push(`${c.name} (${hits.join(', ')})`);
  }
  if ((S.recordings || []).some(r => r.fileId === id)) refs.push('Voice recordings');
  const msg = refs.length
    ? `Delete “${f.name}” from your library?\n\nCurrently used in: ${refs.join('; ')}. Deleting it will also remove those references.`
    : `Delete “${f.name}” from your library? This cannot be undone.`;
  if (!confirm(msg)) return false;
  if (FB_AUDIO_ID === id) fbStopAudio();
  for (const c of S.classes) {
    c.resources = c.resources.filter(r => r.fileId !== id && r.score?.fileId !== id);
    if (c.theme?.image === 'file:' + id) c.theme.image = '';
    for (const a of c.automations || []) {
      if (a.fileId === id) a.fileId = '';
      if (a.sound === 'file:' + id) a.sound = 'chime';
    }
  }
  if (S.recordings) S.recordings = S.recordings.filter(r => r.fileId !== id);
  for (const k of Object.keys(S.windows || {})) {
    S.windows[k] = S.windows[k].filter(w => w.fileId !== id && w.score?.fileId !== id);
  }
  deleteFile(id);
  P.stageKey = ''; WIN.sig = '';
  toast(`Deleted “${f.name}”`);
  if (VIEW === 'present') tick();
  return true;
}
function fbDeleteFile(id) { return deleteLibraryFile(id); }
function fbPinBrowserToClass() {
  const cls = currentClass();
  if (!cls) return toast('Switch to a class first to pin Files as a tab.');
  const existing = cls.resources.find(r => r.filesBrowser);
  if (existing) {
    P.stageSel[context(now()).key] = existing.id;
    P.stageKey = ''; tick();
    toast('Switched to Files tab');
    return;
  }
  const res = { id: uid(), title: 'Files', filesBrowser: true };
  cls.resources.push(res);
  P.stageSel[context(now()).key] = res.id;
  save(); P.stageKey = ''; tick();
  toast(`Pinned Files browser to ${cls.name}`);
}
function fbUnpinBrowserFromClass() {
  const cls = currentClass(); if (!cls) return;
  const idx = cls.resources.findIndex(r => r.filesBrowser);
  if (idx < 0) return;
  const [removed] = cls.resources.splice(idx, 1);
  if (P.stageSel[context(now()).key] === removed.id) P.stageSel[context(now()).key] = 'warmup';
  save(); P.stageKey = ''; tick();
  toast(`Unpinned Files tab from ${cls.name}`);
}
function mountFilesBrowser(host) {
  if (!host) return;
  if (!host._fbState) host._fbState = { q: '', cat: 'all', openId: null, pdfState: {}, scoreState: {}, uploading: '' };
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
          <button class="fb-btn ${pin ? 'on' : ''}" data-fb="pin-out" data-id="${id}" title="${pin ? 'Open this file\'s pinned tab' : 'Pin this single file outside as its own class tab'}">${IC('ico:pin')} <span>${pin ? 'Open tab' : 'Pin as own tab'}</span></button>
          ${pin ? `<button class="fb-btn" data-fb="unpin" data-id="${id}" title="Unpin from ${esc(cls?.name || 'class')}">${IC('ico:close')}</button>` : ''}
          ${c === 'score' ? `<button class="fb-btn" data-fb="editscore" data-id="${id}" title="Edit this score in Scan &amp; Fix">${IC('ico:quickedit')} <span>Edit</span></button>` : ''}
          <button class="fb-btn" data-fb="popout" data-id="${id}" title="Open this file in a separate floating window">${IC('ico:external')} <span>Pop out</span></button>
          <button class="fb-btn fb-del" data-fb="del" data-id="${id}" title="Delete this file from your library">${IC('ico:trash')}</button>
        </div>
        <div class="fb-vbody">${bodyHTML}</div>
      </div>`;
      const pdfEl = host.querySelector('[data-fb-pdf]');
      if (pdfEl && typeof mountPdf === 'function') {
        mountPdf(pdfEl, src, (st.pdfState[id] ||= {}), () => save(), pdfInkOpts(id, { inFiles: true }));
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
        ${!inStage ? `<button class="fb-btn ${browserPinned ? 'on' : ''}" data-fb="${browserPinned ? 'unpin-browser' : 'pin-browser'}" title="${browserPinned ? 'Click to unpin Files tab from this class' : 'Pin this Files browser as a tab in the current class'}">${IC('ico:pin')} <span>${browserPinned ? 'Unpin tab' : 'Pin tab'}</span></button>` : ''}
        <button class="fb-add" data-fb="add" title="Import new files into your library">${IC('ico:plus')} ${st.uploading ? esc(st.uploading) : 'Add files'}</button>
      </div>
      ${all.length ? `<div class="fb-cats">
        ${cats.map(([k, lbl]) => `<button class="fb-cat ${st.cat === k ? 'on' : ''}" data-fb="cat" data-v="${k}">${lbl} <span>${counts[k] || 0}</span></button>`).join('')}
      </div>` : ''}
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
            <button class="fb-btn ${pin ? 'on' : ''}" data-fb="pin" data-id="${id}" title="${pin ? 'Open this pinned tab' : 'Pin this single file outside as its own tab'}">${IC('ico:pin')} <span>${pin ? 'Open tab' : 'Pin'}</span></button>
            ${pin ? `<button class="fb-btn" data-fb="unpin" data-id="${id}" title="Unpin from ${esc(cls?.name || 'class')}" aria-label="Unpin">${IC('ico:close')}</button>` : ''}
            <button class="fb-btn fb-del" data-fb="del" data-id="${id}" title="Delete ${esc(f.name)} from your library">${IC('ico:trash')}</button>
          </div>`;
        }).join('') : (all.length
          ? `<div class="fb-empty">No files match your filter. <button type="button" class="fb-btn" data-fb="cat" data-v="all">Show all (${all.length})</button></div>`
          : `<button type="button" class="fb-empty-drop" data-fb="add"><b>Drop files here or click to add</b><span>Supports PDFs, Audio (MP3/WAV/M4A), MusicXML / MuseScore, Images &amp; Video</span></button>`)}
      </div>
    </div>`;
    const inp = host.querySelector('.fb-search');
    if (inp) {
      if (hadFocus && prevVal != null) { inp.focus(); if (selStart != null) try { inp.setSelectionRange(selStart, selStart); } catch { } }
      inp.addEventListener('input', () => { st.q = inp.value; render(); });
    }
  };
  const importBatch = async fs => {
    if (!fs.length) return;
    let added = 0, failed = 0, lastCat = null;
    for (let i = 0; i < fs.length; i++) {
      st.uploading = `Adding ${i + 1}/${fs.length}…`; render();
      try {
        const id = await storeFile(fs[i]);
        added++; lastCat = fbCategoryOf(id, S.files[id]);
      } catch { failed++; }
    }
    st.uploading = '';
    if (added && st.cat !== 'all' && lastCat && st.cat !== lastCat) st.cat = 'all';
    if (added) toast(`Added ${added} file${added > 1 ? 's' : ''} to library${failed ? ` (${failed} couldn't be saved)` : ''}`);
    else if (failed) toast('Could not save file — storage may be full.', 4000);
    render();
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
      else if (act === 'editscore' && id) { const f = S.files[id]; const title = (f?.name || 'Score').replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, ''); addWindow({ kind: 'scan', scan: { sourceFileId: id, title } }, { w: 0.86, h: 0.86 }); }
      else if (act === 'popout') fbOpenFileFloating(id);
      else if (act === 'del') {
        if (st.openId === id && host.querySelector('.score-host')) stopMusicHosts();
        if (fbDeleteFile(id)) {
          if (st.openId === id) st.openId = null;
          render();
        }
      }
      else if (act === 'pin' || act === 'pin-out') { fbPinFileToClass(id); render(); }
      else if (act === 'unpin') { fbUnpinFileFromClass(id); render(); }
      else if (act === 'pin-browser') { fbPinBrowserToClass(); render(); }
      else if (act === 'unpin-browser') { fbUnpinBrowserFromClass(); render(); }
      else if (act === 'play') {
        if (FB_AUDIO_ID === id) { fbStopAudio(); render(); return; }
        fbStopAudio();
        try {
          const a = new Audio(await fileBlobURL(id));
          FB_AUDIO = a; FB_AUDIO_ID = id;
          a.onended = () => { if (FB_AUDIO === a) { fbStopAudio(); render(); } };
          a.play().catch(() => { });
          renderDock();
        } catch { }
        render();
      } else if (act === 'add') {
        const fs = await pickFile('application/pdf,image/*,video/*,audio/*,.mxl,.musicxml,.mscz,.mscx', true);
        await importBatch(fs);
      }
    });
    host.addEventListener('dragover', e => { e.preventDefault(); host.classList.add('fb-drop'); });
    host.addEventListener('dragleave', () => host.classList.remove('fb-drop'));
    host.addEventListener('drop', async e => {
      e.preventDefault(); host.classList.remove('fb-drop');
      await importBatch([...(e.dataTransfer?.files || [])]);
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
  welcomeIntro: 'Welcome to Rehearsal! Here is a quick look at what you can do.',
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
  const isFirstRun = (IS_FRESH_INSTALL || (!S.settings.seenWhatsNew && !S.settings.tourDone)) && !force;
  const m = document.createElement('div');
  m.id = 'wn-modal';
  m.className = 'bug-backdrop';
  m.innerHTML = `<div class="bug-card wn-card" role="dialog" aria-label="${esc(WHATS_NEW.title)}">
    <div class="bug-head">
      <h3>${IC('ico:book')} ${esc(WHATS_NEW.title)}</h3>
      <button class="bug-x" data-wn="close" title="Close" aria-label="Close">${IC('ico:close')}</button>
    </div>
    <p class="wn-intro">${esc(isFirstRun ? (WHATS_NEW.welcomeIntro || WHATS_NEW.intro) : WHATS_NEW.intro)}</p>
    ${WHATS_NEW.featured?.length ? `<div class="wn-sec">${isFirstRun ? 'Start Here' : 'Featured Highlights'}</div><ul class="wn-list wn-featured">${WHATS_NEW.featured.map(rowHTML).join('')}</ul>` : ''}
    ${!isFirstRun && WHATS_NEW.more?.length ? `<div class="wn-sec">More Features</div><ul class="wn-compact">${WHATS_NEW.more.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${isFirstRun ? '' : `<p class="wn-more">Want to learn more? You can explore on your own, or check out the step-by-step walkthroughs anytime in <b>Setup → Tutorials</b>.</p>
    <div class="wn-bug">
      <span class="wn-ic">${IC('ico:warn')}</span>
      <div>
        <b>Spotted a bug or have an idea?</b>
        <p>Press <kbd>${bugKey}</kbd> or open <b>⋯ → Report a Bug</b> anytime. Rehearsal grabs a screenshot automatically (uncheck it if student names are visible) and sends your note straight from the app, with no sign-in needed.</p>
      </div>
    </div>`}
    <div class="bug-foot wn-foot">
      <button type="button" class="bug-btn" data-wn="tutorials">${IC('ico:book')} Tutorials</button>
      <button type="button" class="bug-btn" data-wn="bug">${IC('ico:warn')} Report a Bug</button>
      <span class="grow"></span>
      ${isFirstRun
        ? `<button type="button" class="bug-btn" data-wn="explore">Explore on my own</button><button type="button" class="bug-btn primary" data-wn="tour">Take Quick Tour</button>`
        : `<button type="button" class="bug-btn primary" data-wn="close">Continue</button>`}
    </div>
  </div>`;
  document.body.appendChild(m);
  const close = (allowTour = false) => {
    document.removeEventListener('keydown', onWnKey, true);
    markSeen();
    m.remove();
    if (allowTour && VIEW === 'present' && !S.settings.seenBasicTour) {
      S.settings.seenBasicTour = true; save();
      setTimeout(() => startTour(null, true), 160);
    }
  };
  const onWnKey = ev => {
    if (!m.isConnected) { document.removeEventListener('keydown', onWnKey, true); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(false); }
  };
  document.addEventListener('keydown', onWnKey, true);
  m.addEventListener('click', e => {
    if (e.target === m) { close(false); return; }
    const b = e.target.closest('[data-wn]'); if (!b) return;
    const act = b.dataset.wn;
    if (act === 'tutorials') {
      close(false);
      TAB = 'tutorials'; go('edit');
      setTimeout(() => { $('.help-search')?.focus(); }, 80);
    } else if (act === 'bug') {
      close(false);
      triggerBugReport();
    } else if (act === 'explore' || act === 'close') {
      close(false);
    } else if (act === 'tour') {
      close(true);
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

async function boot() {
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
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

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
