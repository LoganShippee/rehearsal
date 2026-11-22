'use strict';
/* Rehearsal Online Homework — lightweight standalone browser shim.
   Provides the small set of browser utilities that web/sight.js, web/score.js,
   web/grade.js, and web/music.js expect from web/app.js, so hw.html can reuse
   all four engines verbatim with zero modifications to the classroom app. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => new Date();

const QS = new URLSearchParams(location.search);
const TOKEN = '';
const HAS_SERVER = false;
const IS_NATIVE = false;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const DEVICE = IS_IOS ? 'iPad' : (/CrOS/.test(navigator.userAgent) ? 'Chromebook' : 'computer');

function native() { return false; }

function toast(msg, ms = 2800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// Minimal in-memory state stubs expected by sight.js / score.js / grade.js
// Automatically carries over saved Sight Reading presets, rhythm system, and grading strictness
// from Rehearsal's localStorage ('rehearsal') + hw-local storage without mutating classroom classes.
const HW_SETTINGS_KEY = 'rehearsal-hw-teacher-prefs';
function hwLoadCarriedSettings() {
  const out = {
    avDelay: null,
    saveGradeRecordings: false,
    srPresets: [],
    srBar: null,
    spBar: null,
    lastScore: null,
    rhythmSystem: 'numbers',
    gradeStrictness: 50,
    gradeStrictRhythm: 50,
    gradeStrictPitch: 50,
    solMinor: 'do',
  };
  try {
    const main = JSON.parse(localStorage.getItem('rehearsal') || 'null');
    const ms = main?.settings || {};
    if (Array.isArray(ms.srPresets)) out.srPresets = ms.srPresets.slice();
    if (ms.rhythmSystem) out.rhythmSystem = ms.rhythmSystem;
    if (ms.gradeStrictness != null && isFinite(+ms.gradeStrictness)) out.gradeStrictness = +ms.gradeStrictness;
    if (ms.gradeStrictRhythm != null && isFinite(+ms.gradeStrictRhythm)) out.gradeStrictRhythm = +ms.gradeStrictRhythm;
    else out.gradeStrictRhythm = out.gradeStrictness;
    if (ms.gradeStrictPitch != null && isFinite(+ms.gradeStrictPitch)) out.gradeStrictPitch = +ms.gradeStrictPitch;
    else out.gradeStrictPitch = out.gradeStrictness;
    if (ms.solMinor) out.solMinor = ms.solMinor;
  } catch { }
  try {
    const hw = JSON.parse(localStorage.getItem(HW_SETTINGS_KEY) || 'null');
    if (hw) {
      if (Array.isArray(hw.srPresets) && hw.srPresets.length) {
        const seen = new Set(out.srPresets.map(p => p.id || p.name));
        for (const p of hw.srPresets) {
          const k = p.id || p.name;
          if (!seen.has(k)) { out.srPresets.push(p); seen.add(k); }
        }
      }
      if (hw.rhythmSystem) out.rhythmSystem = hw.rhythmSystem;
      if (hw.gradeStrictness != null && isFinite(+hw.gradeStrictness)) out.gradeStrictness = +hw.gradeStrictness;
      if (hw.gradeStrictRhythm != null && isFinite(+hw.gradeStrictRhythm)) out.gradeStrictRhythm = +hw.gradeStrictRhythm;
      if (hw.gradeStrictPitch != null && isFinite(+hw.gradeStrictPitch)) out.gradeStrictPitch = +hw.gradeStrictPitch;
      if (hw.solMinor) out.solMinor = hw.solMinor;
    }
  } catch { }
  return out;
}

const S = {
  classes: [],
  files: {},
  settings: hwLoadCarriedSettings(),
};
const P = {};
const WIN = { key: null, sig: '' };

function save() {
  try {
    localStorage.setItem(HW_SETTINGS_KEY, JSON.stringify({
      srPresets: S.settings.srPresets || [],
      rhythmSystem: S.settings.rhythmSystem || 'numbers',
      gradeStrictness: S.settings.gradeStrictness ?? 50,
      gradeStrictRhythm: S.settings.gradeStrictRhythm ?? 50,
      gradeStrictPitch: S.settings.gradeStrictPitch ?? 50,
      solMinor: S.settings.solMinor || 'do',
    }));
  } catch { }
}
function tick() { }
function render() { }
function mountSightHosts() { }
function refreshRhythmCounts() { }
function currentClass() { return null; }

// In-memory Blob URL store so Score Practice loads assigned or picked .mxl/.musicxml files cleanly
const HW_FILES = {}; // fileId -> { url, name, mime, size, blob }

function hwRegisterFile(blob, name) {
  const id = 'hwf_' + uid();
  const url = URL.createObjectURL(blob);
  HW_FILES[id] = { url, name, mime: blob.type || 'application/octet-stream', size: blob.size || 0, blob };
  S.files[id] = { name, mime: blob.type || 'application/octet-stream', size: blob.size || 0, added: Date.now() };
  return id;
}

function fileDirectURL(id) {
  return HW_FILES[id]?.url || null;
}

async function storeFile(file) {
  return hwRegisterFile(file, file.name || 'score.musicxml');
}

function pickFile(accept = '', multiple = false) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    if (multiple) inp.multiple = true;
    inp.onchange = () => resolve([...(inp.files || [])]);
    inp.click();
  });
}

function printHTML(html) {
  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = String(html || '');
  const cleanup = () => { area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60000);
  window.print();
}

// ---------- Audio engine helpers (matches web/app.js behavior for iPad / Chromebook / desktop)
let AC = null, AC_NEEDS_RESET = false, AC_LIVE_MICS = 0, AC_HIDDEN_AT = 0;
function audioSession(type) {
  if (!IS_IOS) return;
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) {
      navigator.audioSession.type = type;
    }
  } catch { }
}

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
  try { if (typeof GR !== 'undefined' && GR.mic && !GR.mic.own && typeof grMicClose === 'function') grMicClose(); } catch { }
  const old = AC;
  AC = null;
  AC_NEEDS_RESET = false;
  if (old) {
    try { if (old.state !== 'closed') old.close(); } catch { }
  }
  const fresh = ac();
  fresh.resume?.().catch(() => { });
  return fresh;
}

function acForPlayback() {
  const busyRec = (typeof GR !== 'undefined' && GR.on) || (typeof SP_VREC !== 'undefined' && SP_VREC.on);
  const c = (AC_NEEDS_RESET && !busyRec) ? resetAudioEngine() : ac();
  if (!AC_LIVE_MICS) audioSession('playback');
  if (c.state !== 'running') c.resume?.().catch(() => { });
  return c;
}

function watchPlaybackClock(c, isAlive, onBroken) {
  const t0 = c.currentTime, p0 = performance.now();
  setTimeout(() => {
    if (!isAlive() || AC !== c) return;
    const dtWall = (performance.now() - p0) / 1000;
    const dtAudio = c.currentTime - t0;
    if (c.state !== 'running' || dtAudio < 0.05 || (dtWall > 0.25 && dtAudio > dtWall * 1.75)) {
      resetAudioEngine();
      try { onBroken && onBroken(); } catch { }
    }
  }, 550);
}
window.resetAudioEngine = resetAudioEngine;
window.acForPlayback = acForPlayback;
window.watchPlaybackClock = watchPlaybackClock;

// Audio session + device-change recovery so playback stays clean after mic use or sleep
(() => {
  const md = navigator.mediaDevices;
  if (!md) return;
  try { md.addEventListener?.('devicechange', () => { AC_NEEDS_RESET = true; }); } catch { }
  if (!md.getUserMedia) return;
  const live = new Set();
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async c => {
    if (c?.audio) audioSession('play-and-record');
    let s;
    try { s = await gum(c); }
    catch (e) {
      if (!c?.audio || !/AudioSession|category/i.test(e?.message || '')) throw e;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { }
      s = await gum(c);
    }
    s.getAudioTracks().forEach(t => live.add(t));
    AC_LIVE_MICS = live.size;
    if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => { });
    return s;
  };
  const stop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function () {
    stop.call(this);
    if (live.delete(this)) {
      AC_LIVE_MICS = live.size;
      if (![...live].some(t => t.readyState === 'live')) {
        live.clear(); AC_LIVE_MICS = 0;
        AC_NEEDS_RESET = true;
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
  if (AC_HIDDEN_AT && Date.now() - AC_HIDDEN_AT > 15000) AC_NEEDS_RESET = true;
  if (!AC_LIVE_MICS) audioSession('playback');
  if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => { });
});

document.addEventListener('pointerdown', () => audioSession(
  document.hidden ? 'auto' : (navigator.audioSession?.type === 'play-and-record' ? 'play-and-record' : 'playback')
), { once: true, capture: true });

const AV_KEY = 'rehearsal-avdelay';
function avDelayMs() {
  try {
    const v = localStorage.getItem(AV_KEY);
    if (v != null && v !== '' && isFinite(+v)) return +v;
  } catch { }
  return AC && AC.outputLatency > 0 ? 0 : 60;
}
function setAvDelay(ms) {
  ms = Math.round(Math.max(-200, Math.min(600, ms)) / 10) * 10;
  try { localStorage.setItem(AV_KEY, String(ms)); } catch { }
  S.settings.avDelay = ms;
  return ms;
}

const VOL_KEY = 'rehearsal-volume';
function musicVol() {
  try { const v = +localStorage.getItem(VOL_KEY); if (v > 0) return v; } catch { }
  return 1.8;
}
const MUSIC_OUTS = new Set();
function musicOut(c = ac()) {
  if (!c.__music) {
    const g = c.createGain();
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12;
    lim.attack.value = 0.002; lim.release.value = 0.12;
    g.gain.value = musicVol();
    g.connect(lim).connect(c.destination);
    c.__music = g;
    MUSIC_OUTS.add(g);
  }
  return c.__music;
}
function setMusicVol(v) {
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { }
  for (const g of MUSIC_OUTS) try { g.gain.setTargetAtTime(v, g.context.currentTime, 0.03); } catch { }
}

const MET_VOL_KEY = 'rehearsal-metvol';
function metVol() {
  try { const s = localStorage.getItem(MET_VOL_KEY); if (s != null && s !== '' && isFinite(+s)) return Math.max(0, +s); } catch { }
  return 1;
}
function setMetVol(v) {
  v = Math.max(0, Math.min(2, +v || 0));
  try { localStorage.setItem(MET_VOL_KEY, String(v)); } catch { }
  document.querySelectorAll('input[data-metvol]').forEach(i => {
    if (+i.value !== v) i.value = v;
    const b = i.parentElement?.querySelector('.mv-v');
    if (b) b.textContent = Math.round(v * 100) + '%';
  });
}
const metVolSlider = (label = 'Metronome volume') =>
  `<label class="metvol" title="Volume of the metronome and count-in clicks only">${label} <input type="range" min="0" max="2" step="0.05" value="${metVol()}" data-metvol><b class="mv-v">${Math.round(metVol() * 100)}%</b></label>`;

document.addEventListener('input', e => {
  if (e.target.matches?.('input[data-metvol]')) { e.stopPropagation(); setMetVol(e.target.value); }
}, true);

function tone(freq, start, dur, type = 'sine', gain = 0.2) {
  const c = ac(), t0 = c.currentTime + start;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// Built-in 4-measure 2-part vocal MusicXML sample so Score Practice works out-of-the-box in the spike
const HW_SAMPLE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Sample Vocal Check-In (4 Measures)</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Alto</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above"><sound tempo="84"/></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>Do</text></lyric></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>re</text></lyric></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>mi</text></lyric></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>fa</text></lyric></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>half</type><lyric><text>sol</text></lyric></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>half</type><lyric><text>mi</text></lyric></note>
    </measure>
    <measure number="3">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>fa</text></lyric></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>mi</text></lyric></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>re</text></lyric></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>re</text></lyric></note>
    </measure>
    <measure number="4">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>whole</type><lyric><text>do</text></lyric></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>Do</text></lyric></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>ti</text></lyric></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>do</text></lyric></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>re</text></lyric></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>half</type><lyric><text>mi</text></lyric></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type><lyric><text>do</text></lyric></note>
    </measure>
    <measure number="3">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>re</text></lyric></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>do</text></lyric></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>4</duration><type>half</type><lyric><text>ti</text></lyric></note>
    </measure>
    <measure number="4">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>whole</type><lyric><text>do</text></lyric></note>
    </measure>
  </part>
</score-partwise>`;
