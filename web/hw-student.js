'use strict';
/* Rehearsal Online Homework — Student Portal & Milestone 1 Engine-Reuse Spike.
   Reuses web/sight.js, web/score.js, web/grade.js, and web/music.js verbatim:
     - Mandatory Session Audio Sync Test (8-click tap calibration per session)
     - Clean Student-Facing UI (hides teacher toolbars; Teacher Setup drawer toggles for preview)
     - Sight Reading: Practice Mode OR True Sight-Read (15–60s study countdown, tonic chord /
       scale / starting pitch buttons during study, automatic mic for pitch & automatic
       spacebar/tap for rhythm-only with zero popup menus or infinite wait)
     - Score Practice: MusicXML (.mxl / .musicxml) student view
     - Audio-Only: scales/warmups with MediaRecorder + 16 kHz mono WAV fallback
     - IndexedDB offline-safe take storage ("Saved on this device — Ready to upload") */

const HW_MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const HW_DB_NAME = 'rehearsal-hw-takes';
const HW_STORE = 'takes';
const HW_SYNC_SESSION_KEY = 'rehearsal-hw-sync-ok';

// ---------- Audio codec detection & 16 kHz mono WAV fallback
function hwPickAudioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { }
  }
  return '';
}

function hwDownsampleTo16kWav(chunks, srcSr) {
  const total = chunks.reduce((s, a) => s + a.length, 0);
  if (!total) return new Blob([], { type: 'audio/wav' });
  const targetSr = Math.min(16000, srcSr || 44100);
  const ratio = (srcSr || 44100) / targetSr;
  const outLen = Math.max(1, Math.floor(total / ratio));
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += merged[j];
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }

  const buf = new ArrayBuffer(44 + out.length * 2);
  const view = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + out.length * 2, true);
  str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, targetSr, true); view.setUint32(28, targetSr * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- IndexedDB offline take store
function hwIdbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HW_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HW_STORE)) {
        req.result.createObjectStore(HW_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function hwIdbPut(take) {
  const db = await hwIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HW_STORE, 'readwrite');
    tx.objectStore(HW_STORE).put(take);
    tx.oncomplete = () => resolve(take);
    tx.onerror = () => reject(tx.error);
  });
}
async function hwIdbAll() {
  const db = await hwIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HW_STORE, 'readonly');
    const req = tx.objectStore(HW_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    req.onerror = () => reject(req.error);
  });
}
async function hwIdbDelete(id) {
  const db = await hwIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HW_STORE, 'readwrite');
    tx.objectStore(HW_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function hwIdbClear() {
  const db = await hwIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HW_STORE, 'readwrite');
    tx.objectStore(HW_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Warm pitch-reference playback helpers (Starting Pitch, Tonic Chord, Full Scale, Tempo)
function hwPlayMidi(c, time, midi, dur, gain = 0.9) {
  if (typeof grTone === 'function') {
    grTone(c, time, midi, dur, gain);
    return;
  }
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  tone(f, Math.max(0, time - c.currentTime), dur, 'triangle', 0.25 * gain);
}

function hwMidiLabel(midi) {
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function hwSightPitchInfo(st) {
  const o = st?.solfege || {};
  const firstDeg = st?.ex?.solfege?.pitches?.[0] ?? st?.ex?.solfege?.parts?.[0]?.pitches?.[0] ?? 0;
  const shift = typeof grVoiceShift === 'function' ? grVoiceShift(st) : 0;
  const sp = d => srSpell(o.key || 'C', o.scale || 'major', d, o.clef || 'treble');
  const start = sp(firstDeg);
  const startMidi = start.midi + shift;
  const tonic = sp(0);
  const tonicMidi = tonic.midi + shift;
  return {
    sp,
    shift,
    startSyl: start.syl,
    startMidi,
    startName: hwMidiLabel(startMidi),
    tonicMidi,
    tonicName: hwMidiLabel(tonicMidi),
  };
}

async function hwPlayStartingPitch(st) {
  const c = ac(); await c.resume();
  const info = hwSightPitchInfo(st);
  hwPlayMidi(c, c.currentTime + 0.04, info.startMidi, 1.2, 0.95);
}

async function hwPlayTonicChord(st) {
  const c = ac(); await c.resume();
  const info = hwSightPitchInfo(st);
  const t0 = c.currentTime + 0.04;
  // Arpeggiate Do-Mi-Sol-Do', then sound the chord together
  [0, 2, 4, 7].forEach((d, i) => {
    hwPlayMidi(c, t0 + i * 0.14, info.sp(d).midi + info.shift, 1.15 - i * 0.1, 0.72);
  });
}

async function hwPlayScale(st) {
  const c = ac(); await c.resume();
  const info = hwSightPitchInfo(st);
  const t0 = c.currentTime + 0.04;
  [0, 1, 2, 3, 4, 5, 6, 7].forEach((d, i) => {
    hwPlayMidi(c, t0 + i * 0.24, info.sp(d).midi + info.shift, i === 7 ? 0.65 : 0.26, 0.8);
  });
}

async function hwPlayTempoPulse(bpm = 84) {
  const c = ac(); await c.resume();
  const beat = 60 / clamp(Number(bpm) || 84, 30, 200);
  const t0 = c.currentTime + 0.05;
  for (let i = 0; i < 4; i++) {
    if (typeof grClick === 'function') grClick(c, t0 + i * beat, i === 0, 0.85);
    else tone(i === 0 ? 1100 : 780, 0.05 + i * beat, 0.05, 'triangle', 0.22 * metVol());
  }
}

// ---------- Mandatory Session Audio Sync Check (runs once every browser session)
const HW_SYNC = {
  running: false,
  timers: [],
  keyHandler: null,
  mandatory: true,
};

function hwSyncIsDone() {
  try { return sessionStorage.getItem(HW_SYNC_SESSION_KEY) === '1'; } catch { return false; }
}

function hwClearSyncTimers() {
  HW_SYNC.timers.forEach(id => clearTimeout(id));
  HW_SYNC.timers = [];
  if (HW_SYNC.keyHandler) {
    document.removeEventListener('keydown', HW_SYNC.keyHandler, true);
    HW_SYNC.keyHandler = null;
  }
  HW_SYNC.running = false;
}

function hwOpenSyncModal(mandatory = false) {
  hwClearSyncTimers();
  HW_SYNC.mandatory = mandatory;
  const overlay = $('#hw-sync-overlay');
  const dotsEl = $('#hw-sync-dots');
  const padBtn = $('#hw-sync-pad');
  const statusEl = $('#hw-sync-status');
  const startBtn = $('#hw-sync-start');
  const cancelBtn = $('#hw-sync-cancel');
  if (!overlay) return;

  dotsEl.innerHTML = Array.from({ length: 12 }, (_, i) =>
    `<span class="hw-sync-dot ${i < 4 ? 'lead' : 'tap'}" data-sdot="${i}"></span>`
  ).join('');
  padBtn.disabled = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Start 10-Second Sync Check';
  cancelBtn.hidden = mandatory;
  statusEl.textContent = mandatory
    ? 'Required once at the start of each session so timing matches your device.'
    : `Current sync: ${avDelayMs()} ms. Press Start to recalibrate.`;
  overlay.hidden = false;

  cancelBtn.onclick = () => {
    hwClearSyncTimers();
    overlay.hidden = true;
  };
  startBtn.onclick = () => hwRunSyncTest();
}

async function hwRunSyncTest() {
  if (HW_SYNC.running) return;
  hwClearSyncTimers();
  HW_SYNC.running = true;

  const overlay = $('#hw-sync-overlay');
  const dots = $$('#hw-sync-dots .hw-sync-dot');
  const padBtn = $('#hw-sync-pad');
  const statusEl = $('#hw-sync-status');
  const startBtn = $('#hw-sync-start');

  dots.forEach(d => d.classList.remove('active', 'done'));
  startBtn.disabled = true;
  padBtn.disabled = false;

  const c = ac();
  await c.resume();
  const beat = 60 / 90; // 90 BPM steady pulse
  const t0 = c.currentTime + 0.5;
  const lead = 4, n = 8;
  const clicks = [];

  for (let i = 0; i < lead + n; i++) {
    const t = t0 + i * beat;
    if (typeof grClick === 'function') grClick(c, t, i % 4 === 0, 1.0);
    else tone(i % 4 === 0 ? 1100 : 780, t - c.currentTime, 0.05, 'triangle', 0.28 * metVol());
    if (i >= lead) clicks.push(t);
    const msUntil = Math.max(0, (t - c.currentTime) * 1000);
    HW_SYNC.timers.push(setTimeout(() => {
      dots.forEach(d => d.classList.remove('active'));
      if (dots[i]) dots[i].classList.add('active');
      if (i < lead) statusEl.textContent = `Listen & get ready… (${i + 1} / 4)`;
      else if (i === lead) statusEl.textContent = 'Tap NOW on each click! (Space or circle)';
    }, msUntil));
  }

  const diffs = [];
  const usedClicks = new Set();
  const recordTap = e => {
    if (!HW_SYNC.running) return;
    const t = typeof grTapTime === 'function' ? grTapTime(c, e) : c.currentTime;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < clicks.length; i++) {
      const dist = Math.abs(clicks[i] - t);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestDist < beat / 2 && !usedClicks.has(bestIdx)) {
      usedClicks.add(bestIdx);
      diffs.push(t - clicks[bestIdx]);
      if (dots[lead + bestIdx]) dots[lead + bestIdx].classList.add('done');
    }
    padBtn.classList.remove('hit'); void padBtn.offsetWidth; padBtn.classList.add('hit');
    setTimeout(() => padBtn.classList.remove('hit'), 110);
    statusEl.textContent = `Taps captured: ${diffs.length} of ${n}`;
  };

  padBtn.onpointerdown = e => { e.preventDefault(); recordTap(e); };
  HW_SYNC.keyHandler = e => {
    if (overlay.hidden) return;
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); recordTap(e); }
    if (e.key === 'Escape' && !HW_SYNC.mandatory) { e.preventDefault(); hwClearSyncTimers(); overlay.hidden = true; }
  };
  document.addEventListener('keydown', HW_SYNC.keyHandler, true);

  const totalMs = Math.max(0, (t0 + (lead + n) * beat + 0.55 - c.currentTime) * 1000);
  HW_SYNC.timers.push(setTimeout(() => {
    hwClearSyncTimers();
    padBtn.disabled = true;
    dots.forEach(d => d.classList.remove('active'));
    if (diffs.length < 5) {
      statusEl.textContent = `Only ${diffs.length} taps heard (need at least 5). Try again!`;
      startBtn.disabled = false;
      startBtn.textContent = 'Try Sync Check Again';
      return;
    }
    const medianSec = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const ms = setAvDelay(medianSec * 1000);
    try { sessionStorage.setItem(HW_SYNC_SESSION_KEY, '1'); } catch { }
    hwRenderHeaderChips();
    statusEl.innerHTML = `Synced: <strong>${ms} ms</strong> on this ${esc(DEVICE)}. You're ready!`;
    startBtn.disabled = false;
    startBtn.textContent = 'Continue to Homework';
    startBtn.onclick = () => { overlay.hidden = true; };
    toast(`Audio sync calibrated (${ms} ms)`);
  }, totalMs));
}

window.openAvCal = () => hwOpenSyncModal(false);

// ---------- Mirror of server-side score recomputation & integrity checks
function hwBuildSubmissionSummary(type, label, gradeResult, audioBlob, durationSec, expectedSec, meta = {}) {
  const flags = [];
  let overallPct = null;
  let rhythmPct = null;
  let pitchPct = null;
  let resultsJson = null;

  if (gradeResult?.res) {
    const res = gradeResult.res;
    const notes = Array.isArray(res.notes) ? res.notes : [];
    const total = notes.length;
    const rOk = notes.filter(n => n.status === 'ok' || n.status === 'pitch').length;
    const rHalf = notes.filter(n => n.status === 'timing').length;
    rhythmPct = total ? Math.round(((rOk + 0.5 * rHalf) / total) * 100) : Math.round(res.rhythmPct || 0);
    if (gradeResult.gradePitch && total) {
      const pOk = notes.filter(n => n.status === 'ok' || (n.status === 'timing' && n.pitch === 'ok')).length;
      pitchPct = Math.round((pOk / total) * 100);
      overallPct = Math.round((rhythmPct + pitchPct) / 2);
    } else {
      overallPct = rhythmPct;
    }

    const frames = gradeResult.take?.frames || [];
    const rmsPeak = frames.reduce((m, f) => Math.max(m, f.rms || 0), 0);
    if (!gradeResult.take?.taps) {
      if (rmsPeak < 0.008 && overallPct >= 50) flags.push('low_rms_high_score');
      if (!audioBlob || audioBlob.size === 0) flags.push('missing_audio');
    }
    if (expectedSec > 1 && durationSec > 0 && durationSec < expectedSec * 0.5) {
      flags.push('duration_too_short');
    }

    resultsJson = {
      engineRhythmPct: Math.round(res.rhythmPct || 0),
      enginePitchPct: res.pitchPct == null ? null : Math.round(res.pitchPct),
      recomputedOverallPct: overallPct,
      offsetMs: res.offsetMs ?? null,
      driftCents: res.driftCents ?? null,
      extra: res.extra ?? 0,
      rmsPeak: +rmsPeak.toFixed(4),
      inputMode: gradeResult.take?.taps ? 'tap' : (gradeResult.gradePitch ? 'mic_pitch_rhythm' : 'mic_rhythm'),
      noteCount: total,
      notes: notes.map(n => ({
        bar: n.bar, idx: n.idx, status: n.status, pitch: n.pitch || null, cents: n.cents ?? null, errMs: n.errMs ?? null,
      })),
    };
  } else if (!audioBlob || audioBlob.size === 0) {
    flags.push('missing_audio');
  }

  if (audioBlob && audioBlob.size > HW_MAX_AUDIO_BYTES) flags.push('audio_over_15mb');

  return {
    id: 'take_' + uid(),
    createdAt: Date.now(),
    status: 'pending_upload',
    type,
    label,
    overallPct,
    rhythmPct,
    pitchPct,
    durationSec: +Number(durationSec || 0).toFixed(2),
    expectedSec: expectedSec ? +Number(expectedSec).toFixed(2) : null,
    audioMime: audioBlob?.type || null,
    audioBytes: audioBlob?.size || 0,
    audioBlob: audioBlob || null,
    integrityFlags: flags,
    resultsJson,
    meta,
  };
}

// ---------- Zero-touch MediaRecorder hook around web/grade.js
const HW_GRADE_CAP = { mr: null, chunks: [], mime: '', startedAt: 0, activeContext: null };

function hwStartParallelRecorder(stream) {
  hwAbortParallelRecorder();
  const mime = hwPickAudioMime();
  HW_GRADE_CAP.chunks = [];
  HW_GRADE_CAP.mime = mime;
  HW_GRADE_CAP.startedAt = performance.now();
  if (!stream || !mime) return;
  try {
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
    mr.ondataavailable = e => { if (e.data && e.data.size > 0) HW_GRADE_CAP.chunks.push(e.data); };
    mr.start(250);
    HW_GRADE_CAP.mr = mr;
  } catch (err) {
    console.warn('hwStartParallelRecorder fallback to WAV:', err);
    HW_GRADE_CAP.mr = null;
  }
}

function hwAbortParallelRecorder() {
  if (HW_GRADE_CAP.mr && HW_GRADE_CAP.mr.state !== 'inactive') {
    try { HW_GRADE_CAP.mr.stop(); } catch { }
  }
  HW_GRADE_CAP.mr = null;
  HW_GRADE_CAP.chunks = [];
}

function hwFinishParallelRecorder(recFallback) {
  const mr = HW_GRADE_CAP.mr;
  const mime = HW_GRADE_CAP.mime || 'audio/webm';
  const elapsed = HW_GRADE_CAP.startedAt ? (performance.now() - HW_GRADE_CAP.startedAt) / 1000 : 0;
  HW_GRADE_CAP.mr = null;

  const buildFallbackWav = () => {
    if (recFallback && Array.isArray(recFallback.chunks) && recFallback.chunks.length) {
      const totalSamples = recFallback.chunks.reduce((s, a) => s + a.length, 0);
      const dur = recFallback.sr ? totalSamples / recFallback.sr : elapsed;
      return { blob: hwDownsampleTo16kWav(recFallback.chunks, recFallback.sr || 44100), durationSec: dur };
    }
    return { blob: null, durationSec: elapsed };
  };

  if (!mr) return Promise.resolve(buildFallbackWav());
  return new Promise(resolve => {
    const finalize = () => {
      if (HW_GRADE_CAP.chunks.length) {
        const blob = new Blob(HW_GRADE_CAP.chunks, { type: mr.mimeType || mime });
        if (blob.size > 0) { resolve({ blob, durationSec: elapsed }); return; }
      }
      resolve(buildFallbackWav());
    };
    if (mr.state === 'inactive') { finalize(); return; }
    mr.addEventListener('stop', finalize, { once: true });
    try { mr.stop(); } catch { resolve(buildFallbackWav()); }
  });
}

function hwInstallEngineHooks(onTakeSaved) {
  if (window.__hwHooksInstalled) return;
  window.__hwHooksInstalled = true;

  if (typeof grStart === 'function') {
    const origGrStart = window.grStart;
    window.grStart = async function (host, st, timeline, btn, input = 'mic') {
      const wasRunning = typeof GR !== 'undefined' && (GR.on || GR.starting);
      const res = await origGrStart.call(this, host, st, timeline, btn, input);
      if (!wasRunning && typeof GR !== 'undefined' && GR.on) {
        HW_GRADE_CAP.activeContext = {
          type: 'sight',
          label: `Sight Reading (${st.mode === 'solfege' ? 'Solfege · Mic' : 'Rhythm · ' + (input === 'tap' ? 'Spacebar/Tap' : 'Mic')})`,
          host,
          expectedSec: Math.max(0, (GR.end || 0) - (GR.T0 || 0) - 0.8),
          meta: {
            mode: st.mode,
            input,
            ts: st[st.mode]?.ts,
            tempo: st[st.mode]?.tempo,
            key: st[st.mode]?.key,
            trueSightRead: !!HW_STATE.srTrueMode,
            studySeconds: HW_STATE.srTrueMode ? HW_STATE.srStudySec : 0,
            syncMs: avDelayMs(),
          },
        };
        if (input !== 'tap' && GR.mic?.stream) hwStartParallelRecorder(GR.mic.stream);
        else hwAbortParallelRecorder();
      }
      return res;
    };
  }

  if (typeof spGradeStart === 'function') {
    const origSpGradeStart = window.spGradeStart;
    window.spGradeStart = async function (ctl, btn, inputOverride = null) {
      const wasRunning = typeof GR !== 'undefined' && (GR.on || GR.starting);
      const res = await origSpGradeStart.call(this, ctl, btn, inputOverride);
      if (!wasRunning && typeof GR !== 'undefined' && GR.on) {
        const mode = inputOverride || ctl?.st?.gradeMode || 'mic';
        HW_GRADE_CAP.activeContext = {
          type: 'score',
          label: `Score Practice (${ctl?.st?.name || 'Sample Score'})`,
          host: ctl?.host,
          expectedSec: Math.max(0, (GR.end || 0) - (GR.T0 || 0) - 0.8),
          meta: { scoreName: ctl?.st?.name || 'Sample Score', gradeMode: mode, tempo: ctl?.st?.tempo || null, syncMs: avDelayMs() },
        };
        if (mode !== 'tap' && GR.mic?.stream) hwStartParallelRecorder(GR.mic.stream);
        else hwAbortParallelRecorder();
      }
      return res;
    };
  }

  if (typeof grShowCard === 'function') {
    const origGrShowCard = window.grShowCard;
    window.grShowCard = function (res, gradePitch, hist, host, fromRecent) {
      const out = origGrShowCard.call(this, res, gradePitch, hist, host, fromRecent);
      if (!fromRecent && host?.__grResult) {
        const ctx = HW_GRADE_CAP.activeContext || {
          type: host.classList?.contains('score-host') ? 'score' : 'sight',
          label: host.classList?.contains('score-host') ? 'Score Practice' : 'Sight Reading',
          expectedSec: 0,
          meta: {},
        };
        HW_GRADE_CAP.activeContext = null;
        const grObj = host.__grResult;
        hwFinishParallelRecorder(grObj.take?.rec).then(async ({ blob, durationSec }) => {
          const take = hwBuildSubmissionSummary(
            ctx.type, ctx.label, grObj, grObj.take?.taps ? null : blob, durationSec, ctx.expectedSec, ctx.meta
          );
          await hwIdbPut(take);
          onTakeSaved(take);
          toast(`Take saved locally (${take.overallPct != null ? take.overallPct + '%' : 'audio'})`);
        }).catch(err => console.error('Failed saving graded take:', err));
      }
      return out;
    };
  }
}

// ---------- App State
const HW_STATE = {
  tab: 'sight',         // 'sight' | 'score' | 'audio'
  teacherOpen: false,
  // Sight Reading assignment config (normally set by teacher)
  srKind: 'solfege',    // 'solfege' (pitch+rhythm -> mic) | 'rhythm' (rhythm-only -> spacebar/tap)
  srTrueMode: true,     // Default to True Sight-Read (30s) so teacher can immediately test it
  srStudySec: 30,
  srStudyLeft: 0,
  srStudyTimer: null,
  srStudying: false,
  srState: null,
  srHost: null,
  // Score Practice assignment config
  spFileId: null,
  spState: null,
  spHost: null,
  spCtl: null,
  spGradeMode: 'mic',   // 'mic' | 'rhythm' | 'tap'
  // Audio-Only config
  aud: {
    recording: false, stream: null, mr: null, chunks: [], pcmChunks: [], pcmSr: 44100,
    pcmNode: null, srcNode: null, analyser: null, raf: 0, startedAt: 0, timer: null,
    countIn: true, bpm: 84,
    prompt: 'Sing a 5-note major scale (do–re–mi–fa–sol–fa–mi–re–do) on "ah", or play your assigned warm-up.',
  },
  takes: [],
  expandedJson: new Set(),
  takeUrls: new Map(),
};

function hwFmtBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}
function hwFmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// ---------- Header chips & Teacher Setup drawer
function hwRenderHeaderChips() {
  const syncBtn = $('#hw-sync-btn');
  const devChip = $('#hw-dev-chip');
  const tBtn = $('#hw-teacher-toggle');
  if (syncBtn) {
    const done = hwSyncIsDone();
    syncBtn.textContent = done ? `Sync: ${avDelayMs()} ms ✓` : 'Audio Sync Needed';
    syncBtn.classList.toggle('ok', done);
    syncBtn.classList.toggle('warn', !done);
  }
  if (devChip) {
    const mime = hwPickAudioMime();
    devChip.textContent = `${DEVICE} · ${mime ? mime.split(';')[0] : 'WAV fallback'}`;
  }
  if (tBtn) {
    tBtn.classList.toggle('on', HW_STATE.teacherOpen);
    tBtn.textContent = HW_STATE.teacherOpen ? 'Teacher Setup ▴' : 'Teacher Setup ▾';
  }
}

function hwRenderTeacherOptions() {
  const box = $('#hw-teacher-opts');
  if (!box) return;
  if (HW_STATE.tab === 'sight') {
    const st = HW_STATE.srState || (HW_STATE.srState = srDefaults());
    const o = st[HW_STATE.srKind];
    box.innerHTML = `
      <label>Exercise type:
        <select id="hw-t-srkind">
          <option value="solfege" ${HW_STATE.srKind === 'solfege' ? 'selected' : ''}>Solfege / Pitch (auto-uses Microphone)</option>
          <option value="rhythm" ${HW_STATE.srKind === 'rhythm' ? 'selected' : ''}>Rhythm Only (auto-uses Spacebar / Tap)</option>
        </select>
      </label>
      <label>Mode:
        <select id="hw-t-srmode">
          <option value="true" ${HW_STATE.srTrueMode ? 'selected' : ''}>True Sight-Read (timed study + auto-record)</option>
          <option value="practice" ${!HW_STATE.srTrueMode ? 'selected' : ''}>Practice Mode (rehearse then record)</option>
        </select>
      </label>
      ${HW_STATE.srTrueMode ? `<label>Study time:
        <select id="hw-t-srsec">
          ${[15, 30, 45, 60].map(s => `<option value="${s}" ${HW_STATE.srStudySec === s ? 'selected' : ''}>${s}s</option>`).join('')}
        </select>
      </label>` : ''}
      ${HW_STATE.srKind === 'solfege' ? `
        <label>Key:
          <select id="hw-t-srkey">
            ${['C', 'G', 'D', 'A', 'F', 'Bb', 'Eb'].map(k => `<option value="${k}" ${o.key === k ? 'selected' : ''}>${k.replace('b', '♭')}</option>`).join('')}
          </select>
        </label>
        <label>Clef:
          <select id="hw-t-srclef">
            <option value="treble" ${o.clef === 'treble' ? 'selected' : ''}>Treble</option>
            <option value="bass" ${o.clef === 'bass' ? 'selected' : ''}>Bass</option>
          </select>
        </label>
      ` : ''}
      <label>Meter:
        <select id="hw-t-srts">
          ${['4/4', '3/4', '2/4', '6/8'].map(m => `<option value="${m}" ${o.ts === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </label>
      <label>Tempo:
        <input type="number" id="hw-t-srtempo" min="40" max="180" value="${o.tempo || 80}" style="width:66px">
      </label>
      <button type="button" class="hw-btn" id="hw-t-srnew">New Excerpt</button>`;

    $('#hw-t-srkind').onchange = e => { HW_STATE.srKind = e.target.value; HW_STATE.srState.mode = HW_STATE.srKind; hwRenderTeacherOptions(); hwMountSightRunner(); };
    $('#hw-t-srmode').onchange = e => { HW_STATE.srTrueMode = e.target.value === 'true'; hwRenderTeacherOptions(); hwMountSightRunner(); };
    if ($('#hw-t-srsec')) $('#hw-t-srsec').onchange = e => { HW_STATE.srStudySec = Number(e.target.value) || 30; hwMountSightRunner(); };
    if ($('#hw-t-srkey')) $('#hw-t-srkey').onchange = e => { o.key = e.target.value; HW_STATE.srState.ex.solfege = srGenParts(o); hwMountSightRunner(); };
    if ($('#hw-t-srclef')) $('#hw-t-srclef').onchange = e => { o.clef = e.target.value; HW_STATE.srState.ex.solfege = srGenParts(o); hwMountSightRunner(); };
    $('#hw-t-srts').onchange = e => {
      o.ts = e.target.value;
      HW_STATE.srState.ex[HW_STATE.srKind] = HW_STATE.srKind === 'rhythm' ? { rhythm: srGenRhythm(o.ts, o.measures, o.cells, o.ties) } : srGenParts(o);
      hwMountSightRunner();
    };
    $('#hw-t-srtempo').onchange = e => { o.tempo = clamp(Number(e.target.value) || 80, 40, 180); hwMountSightRunner(); };
    $('#hw-t-srnew').onclick = () => {
      HW_STATE.srState.ex[HW_STATE.srKind] = HW_STATE.srKind === 'rhythm' ? { rhythm: srGenRhythm(o.ts, o.measures, o.cells, o.ties) } : srGenParts(o);
      hwMountSightRunner();
    };
  } else if (HW_STATE.tab === 'score') {
    box.innerHTML = `
      <label>Grading method:
        <select id="hw-t-spmode">
          <option value="mic" ${HW_STATE.spGradeMode === 'mic' ? 'selected' : ''}>Microphone (Pitch + Rhythm)</option>
          <option value="rhythm" ${HW_STATE.spGradeMode === 'rhythm' ? 'selected' : ''}>Microphone (Rhythm Only)</option>
          <option value="tap" ${HW_STATE.spGradeMode === 'tap' ? 'selected' : ''}>Spacebar / Tap (Rhythm Only)</option>
        </select>
      </label>
      <button type="button" class="hw-btn" id="hw-t-sppick">Load .mxl / .musicxml File…</button>
      <button type="button" class="hw-btn" id="hw-t-spsample">Reset to Sample Score</button>`;
    $('#hw-t-spmode').onchange = e => { HW_STATE.spGradeMode = e.target.value; if (HW_STATE.spState) HW_STATE.spState.gradeMode = HW_STATE.spGradeMode; hwMountScoreRunner(); };
    $('#hw-t-sppick').onclick = async () => {
      const fs = await pickFile('.mxl,.musicxml,.xml', false);
      if (!fs.length) return;
      const f = fs[0];
      const id = await storeFile(f);
      HW_STATE.spState = { fileId: id, name: f.name.replace(/\.(mxl|musicxml|xml)$/i, ''), gradeMode: HW_STATE.spGradeMode };
      hwMountScoreRunner();
      toast(`Loaded ${f.name}`);
    };
    $('#hw-t-spsample').onclick = () => {
      HW_STATE.spState = { fileId: HW_STATE.spFileId, name: 'Sample Vocal Check-In', gradeMode: HW_STATE.spGradeMode };
      hwMountScoreRunner();
    };
  } else {
    const a = HW_STATE.aud;
    box.innerHTML = `
      <label style="flex:1;min-width:260px">Prompt:
        <input type="text" id="hw-t-audprompt" value="${esc(a.prompt)}" style="flex:1;min-width:200px">
      </label>
      <label><input type="checkbox" id="hw-t-audci" ${a.countIn ? 'checked' : ''}> 4-beat count-in</label>
      <label>BPM: <input type="number" id="hw-t-audbpm" min="40" max="208" value="${a.bpm}" style="width:66px"></label>`;
    $('#hw-t-audprompt').onchange = e => { a.prompt = e.target.value; hwMountAudioRunner(); };
    $('#hw-t-audci').onchange = e => { a.countIn = e.target.checked; hwMountAudioRunner(); };
    $('#hw-t-audbpm').onchange = e => { a.bpm = clamp(Number(e.target.value) || 84, 40, 208); hwMountAudioRunner(); };
  }
}

// ---------- Sight Reading Student Runner
function hwStopStudyTimer() {
  if (HW_STATE.srStudyTimer) {
    clearInterval(HW_STATE.srStudyTimer);
    HW_STATE.srStudyTimer = null;
  }
  HW_STATE.srStudying = false;
}

function hwSightViewState(st) {
  return {
    ...st,
    show: false,
    showCounts: false,
    playhead: st.playhead ?? 'beat',
  };
}

function hwStartSightGradingDirect(host, st, actionBtn, inputMode) {
  if (typeof grStart !== 'function') return toast('Grading engine not loaded.');
  const tl = host?.__timeline;
  if (!tl || !tl.length) return toast('Notation is still loading — try again.');
  // Directly launch grading with explicit 'mic' or 'tap' — NEVER open .sr-grmenu!
  grStart(host, hwSightViewState(st), tl, actionBtn, inputMode);
}

function hwMountSightRunner() {
  hwStopStudyTimer();
  const body = $('#hw-runner-body');
  if (!HW_STATE.srState) {
    HW_STATE.srState = srDefaults();
  }
  const st = HW_STATE.srState;
  st.mode = HW_STATE.srKind;
  st.show = false;
  st.showCounts = false;
  if (st[st.mode]) st[st.mode].showCounts = false;

  const isPitch = HW_STATE.srKind === 'solfege';
  const autoInput = isPitch ? 'mic' : 'tap';
  const trueMode = HW_STATE.srTrueMode;
  const o = st[st.mode];
  const pitchInfo = isPitch ? hwSightPitchInfo(st) : null;
  const metaDesc = isPitch
    ? `${o.key.replace('b', '♭')} ${o.scale} · ${o.clef === 'bass' ? 'Bass' : 'Treble'} clef · ${o.ts} · ${o.tempo} BPM · Microphone (Pitch + Rhythm)`
    : `Rhythm only · ${o.ts} · ${o.tempo} BPM · Spacebar / Touch Tap`;

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <div>
          <h2>${trueMode ? 'True Sight-Reading Check' : 'Sight-Reading Practice Assignment'}</h2>
          <div class="hw-submeta">${esc(metaDesc)}</div>
        </div>
        <div class="hw-controls">
          <span class="hw-zoom-pill" title="Adjust sheet music size">
            <button type="button" id="hw-sr-zout">−</button>
            <button type="button" id="hw-sr-zreset">${Math.round((st.zoom || 1) * 100)}%</button>
            <button type="button" id="hw-sr-zin">+</button>
          </span>
        </div>
      </div>

      ${trueMode ? `
        <div class="hw-study-bar" id="hw-study-bar" hidden>
          <div class="hw-study-left">
            <span class="hw-study-timer" id="hw-study-timer">${hwFmtTime(HW_STATE.srStudySec)}</span>
            <span id="hw-study-msg"><strong>Study silently!</strong> ${isPitch ? 'Recording begins automatically on your microphone at 0:00.' : 'Rhythm tapping (Spacebar / Tap) begins automatically at 0:00.'}</span>
          </div>
          <div class="hw-study-pitches" id="hw-study-pitches">
            ${isPitch ? `
              <button type="button" class="hw-btn pitch" id="hw-pitch-start">Starting Pitch (${esc(pitchInfo.startSyl)} · ${esc(pitchInfo.startName)})</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-chord">Tonic Chord</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-scale">Scale</button>
            ` : `
              <button type="button" class="hw-btn pitch" id="hw-tempo-pulse">Hear Tempo (${o.tempo} BPM)</button>
            `}
            <button type="button" class="hw-btn danger" id="hw-study-now">${isPitch ? 'Start Recording Now' : 'Start Tapping Now'}</button>
          </div>
        </div>
      ` : `
        <div class="hw-student-bar">
          <div class="hw-student-actions">
            ${isPitch ? `
              <button type="button" class="hw-btn pitch" id="hw-pitch-start">Starting Pitch (${esc(pitchInfo.startSyl)} · ${esc(pitchInfo.startName)})</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-chord">Tonic Chord</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-scale">Scale</button>
            ` : `
              <button type="button" class="hw-btn pitch" id="hw-tempo-pulse">Hear Tempo (${o.tempo} BPM)</button>
            `}
            <button type="button" class="hw-btn" id="hw-sr-hear">Hear Example</button>
          </div>
          <div class="hw-student-actions">
            <button type="button" class="hw-btn primary" id="hw-sr-record">${isPitch ? 'Record Graded Take (Mic)' : 'Start Rhythm Take (Space / Tap)'}</button>
          </div>
        </div>
      `}

      <div class="hw-stage" id="hw-sr-stage">
        <div class="sr-host" id="hw-sr-host"></div>
        ${trueMode ? `
          <div class="hw-study-cover" id="hw-study-cover">
            <h3>Ready for your ${HW_STATE.srStudySec}-Second True Sight-Read?</h3>
            <p>
              When you press start, a fresh excerpt will appear for <strong>${HW_STATE.srStudySec} seconds</strong>.
              ${isPitch
                ? 'During study time you can hear your <strong>Starting Pitch, Tonic Chord, and Scale</strong>. At 0:00, your <strong>microphone will automatically count in and record</strong>.'
                : 'During study time you can hear the <strong>tempo pulse</strong>. At 0:00, <strong>Spacebar / Tap rhythm grading will start automatically</strong>.'}
            </p>
            <button type="button" class="hw-btn primary" id="hw-study-begin" style="padding:11px 20px;font-size:15px">
              Reveal Excerpt &amp; Start ${HW_STATE.srStudySec}s Study Timer
            </button>
          </div>
        ` : ''}
      </div>
    </div>`;

  const host = $('#hw-sr-host');
  HW_STATE.srHost = host;
  window.__spaceTarget = 'sr';
  mountSight(host, st, () => { });

  // Clean zoom controls wired directly to sight.js's vector zoom
  const updateZoomLabel = () => {
    const zEl = $('#hw-sr-zreset');
    if (zEl) zEl.textContent = `${Math.round((st.zoom || 1) * 100)}%`;
  };
  $('#hw-sr-zout').onclick = () => { host.__zoomBy?.(0.9); updateZoomLabel(); };
  $('#hw-sr-zin').onclick = () => { host.__zoomBy?.(1.1); updateZoomLabel(); };
  $('#hw-sr-zreset').onclick = () => { host.__zoomReset?.(); updateZoomLabel(); };

  const wirePitchButtons = () => {
    const pBtn = $('#hw-pitch-start');
    const cBtn = $('#hw-pitch-chord');
    const sBtn = $('#hw-pitch-scale');
    const tBtn = $('#hw-tempo-pulse');
    if (pBtn) pBtn.onclick = () => hwPlayStartingPitch(st);
    if (cBtn) cBtn.onclick = () => hwPlayTonicChord(st);
    if (sBtn) sBtn.onclick = () => hwPlayScale(st);
    if (tBtn) tBtn.onclick = () => hwPlayTempoPulse(o.tempo);
  };
  wirePitchButtons();

  // Practice mode buttons
  const hearBtn = $('#hw-sr-hear');
  if (hearBtn) {
    hearBtn.onclick = () => {
      const innerPlay = host.querySelector('[data-sr="play"]');
      if (innerPlay) innerPlay.click();
    };
  }
  const recBtn = $('#hw-sr-record');
  if (recBtn) {
    recBtn.onclick = () => hwStartSightGradingDirect(host, st, recBtn, autoInput);
  }

  // True Sight-Read flow: pre-warm mic on click -> reveal fresh excerpt -> play tonic -> 30s countdown -> auto-start grading!
  const beginBtn = $('#hw-study-begin');
  if (beginBtn) {
    beginBtn.onclick = async () => {
      beginBtn.disabled = true;
      beginBtn.textContent = isPitch ? 'Checking microphone…' : 'Preparing excerpt…';
      try {
        await ac().resume();
        // Pre-warm mic BEFORE the 30s countdown so no permission popup interrupts 0:00!
        if (isPitch && typeof grMic === 'function') {
          const mic = await grMic();
          await grMicReady(mic, null);
        }
      } catch (err) {
        beginBtn.disabled = false;
        beginBtn.textContent = `Reveal Excerpt & Start ${HW_STATE.srStudySec}s Study Timer`;
        toast(`Microphone required for pitch grading: ${err?.message || 'permission denied'}`);
        return;
      }

      // Generate fresh unseen excerpt and re-mount cleanly
      st.ex[st.mode] = isPitch ? srGenParts(o) : { rhythm: srGenRhythm(o.ts, o.measures, o.cells, o.ties) };
      mountSight(host, st, () => { });

      // Update starting pitch label for the newly generated excerpt
      if (isPitch) {
        const freshInfo = hwSightPitchInfo(st);
        const pBtn = $('#hw-pitch-start');
        if (pBtn) pBtn.textContent = `Starting Pitch (${freshInfo.startSyl} · ${freshInfo.startName})`;
        hwPlayTonicChord(st);
      }

      $('#hw-study-cover')?.remove();
      const barEl = $('#hw-study-bar');
      const timerEl = $('#hw-study-timer');
      const msgEl = $('#hw-study-msg');
      const nowBtn = $('#hw-study-now');
      if (barEl) barEl.hidden = false;

      HW_STATE.srStudyLeft = HW_STATE.srStudySec;
      HW_STATE.srStudying = true;
      if (timerEl) timerEl.textContent = hwFmtTime(HW_STATE.srStudyLeft);

      const triggerAutoGrade = () => {
        if (!HW_STATE.srStudying) return;
        hwStopStudyTimer();
        if (barEl) barEl.classList.add('live');
        if (timerEl) timerEl.textContent = 'LIVE';
        if (msgEl) {
          msgEl.innerHTML = isPitch
            ? '<strong>Recording live!</strong> Sing after the count-in.'
            : '<strong>Tap live!</strong> Press <strong>Space</strong> (or tap the on-screen button) after the count-in.';
        }
        // Hide study pitch buttons once recording begins
        const pWrap = $('#hw-study-pitches');
        if (pWrap) {
          pWrap.innerHTML = `<button type="button" class="hw-btn danger" id="hw-study-stop">Stop &amp; Finish</button>`;
          $('#hw-study-stop').onclick = () => { if (typeof grStop === 'function') grStop(true); };
        }
        hwStartSightGradingDirect(host, st, $('#hw-study-stop'), autoInput);
      };

      if (nowBtn) nowBtn.onclick = triggerAutoGrade;

      HW_STATE.srStudyTimer = setInterval(() => {
        HW_STATE.srStudyLeft -= 1;
        if (timerEl) timerEl.textContent = hwFmtTime(HW_STATE.srStudyLeft);
        if (HW_STATE.srStudyLeft <= 0) triggerAutoGrade();
      }, 1000);
    };
  }
}

// ---------- Score Practice Student Runner
function hwMountScoreRunner() {
  hwStopStudyTimer();
  const body = $('#hw-runner-body');
  if (!HW_STATE.spFileId) {
    const sampleBlob = new Blob([HW_SAMPLE_MUSICXML], { type: 'application/xml' });
    HW_STATE.spFileId = hwRegisterFile(sampleBlob, 'Sample Vocal Check-In.musicxml');
  }
  if (!HW_STATE.spState) {
    HW_STATE.spState = {
      fileId: HW_STATE.spFileId,
      name: S.files[HW_STATE.spFileId]?.name || 'Sample Vocal Check-In',
      gradeMode: HW_STATE.spGradeMode,
    };
  }
  HW_STATE.spState.gradeMode = HW_STATE.spGradeMode;
  const modeLabel = HW_STATE.spGradeMode === 'tap'
    ? 'Spacebar / Tap (Rhythm Only)'
    : HW_STATE.spGradeMode === 'rhythm'
      ? 'Microphone (Rhythm Only)'
      : 'Microphone (Pitch + Rhythm)';

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <div>
          <h2>Score Check-In: ${esc(HW_STATE.spState.name)}</h2>
          <div class="hw-submeta">${esc(modeLabel)} · Click any measure to start from there, or record from bar 1.</div>
        </div>
        <div class="hw-controls">
          <span class="hw-zoom-pill">
            <button type="button" id="hw-sp-zout">−</button>
            <button type="button" id="hw-sp-zreset">${Math.round((HW_STATE.spState.zoom || 0.8) * 100)}%</button>
            <button type="button" id="hw-sp-zin">+</button>
          </span>
        </div>
      </div>
      <div class="hw-student-bar">
        <div class="hw-student-actions">
          <label class="small" style="display:inline-flex;align-items:center;gap:6px">Part:
            <select id="hw-sp-part" style="border:1px solid #cbd5e1;border-radius:8px;padding:5px 8px;background:#fff"></select>
          </label>
          <button type="button" class="hw-btn pitch" id="hw-sp-pitch">Starting Pitch</button>
          <button type="button" class="hw-btn" id="hw-sp-play">Practice Playback</button>
        </div>
        <div class="hw-student-actions">
          <button type="button" class="hw-btn primary" id="hw-sp-grade">${HW_STATE.spGradeMode === 'tap' ? 'Start Rhythm Take (Space / Tap)' : 'Record Graded Take (Mic)'}</button>
        </div>
      </div>
      <div class="hw-stage">
        <div class="score-host" id="hw-sp-host"></div>
      </div>
    </div>`;

  const host = $('#hw-sp-host');
  HW_STATE.spHost = host;
  window.__spaceTarget = 'sp';
  const ctl = mountScore(host, HW_STATE.spState, () => { }, 'hw-sp-' + HW_STATE.spState.fileId);
  HW_STATE.spCtl = ctl;

  // Populate parts dropdown once OSMD finishes parsing
  const populateParts = () => {
    const sel = $('#hw-sp-part');
    if (!sel || !ctl?.sc?.lines?.length) return false;
    sel.innerHTML = ctl.sc.lines.map((l, i) => `<option value="${i}" ${(HW_STATE.spState.focus ?? 0) === i ? 'selected' : ''}>${esc(l.name || `Part ${i + 1}`)}</option>`).join('');
    sel.onchange = () => {
      HW_STATE.spState.focus = Number(sel.value);
      ctl.updateBar?.();
    };
    return true;
  };
  let tries = 0;
  const partPoll = setInterval(() => {
    if (populateParts() || ++tries > 40) clearInterval(partPoll);
  }, 150);

  const setSpZoom = next => {
    HW_STATE.spState.zoom = clamp(Math.round(next * 100) / 100, 0.4, 2.2);
    if (ctl.osmd) { ctl.osmd.zoom = HW_STATE.spState.zoom; ctl.lastW = 0; ctl.relayout(); }
    const zEl = $('#hw-sp-zreset');
    if (zEl) zEl.textContent = `${Math.round(HW_STATE.spState.zoom * 100)}%`;
  };
  $('#hw-sp-zout').onclick = () => setSpZoom((HW_STATE.spState.zoom || 0.8) - 0.1);
  $('#hw-sp-zin').onclick = () => setSpZoom((HW_STATE.spState.zoom || 0.8) + 0.1);
  $('#hw-sp-zreset').onclick = () => setSpZoom(1);

  $('#hw-sp-pitch').onclick = async () => {
    if (!ctl?.sc) return;
    const c = ac(); await c.resume();
    const li = typeof spGradeLine === 'function' ? spGradeLine(ctl) : 0;
    const R = typeof spGradeRange === 'function' ? spGradeRange(ctl) : { a: 0, b: 999 };
    const first = ctl.sc.events?.find(e => e.line === li && e.q >= R.a - 1e-6 && e.midi != null);
    if (first) hwPlayMidi(c, c.currentTime + 0.04, first.midi, 1.2, 0.95);
    else toast('No starting pitch found for this part.');
  };

  $('#hw-sp-play').onclick = () => {
    if (!ctl?.sc) return;
    if (ctl.playing) spStop(); else spPlay(ctl);
  };

  const gBtn = $('#hw-sp-grade');
  gBtn.onclick = () => spGradeStart(ctl, gBtn, HW_STATE.spGradeMode);
}

// ---------- Audio-Only Recorder Runner
function hwCleanupAudioOnly() {
  const a = HW_STATE.aud;
  if (a.raf) { cancelAnimationFrame(a.raf); a.raf = 0; }
  if (a.timer) { clearInterval(a.timer); a.timer = null; }
  try { a.pcmNode?.disconnect(); a.srcNode?.disconnect(); } catch { }
  if (a.stream) { a.stream.getTracks().forEach(t => t.stop()); a.stream = null; }
  a.pcmNode = null; a.srcNode = null; a.analyser = null; a.mr = null;
  a.recording = false;
}

function hwMountAudioRunner() {
  hwStopStudyTimer();
  const body = $('#hw-runner-body');
  const a = HW_STATE.aud;
  const mime = hwPickAudioMime();

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <div>
          <h2>Audio Check-In Assignment</h2>
          <div class="hw-submeta">${a.countIn ? `Includes 4-beat count-in at ${a.bpm} BPM` : 'Starts recording immediately'}</div>
        </div>
      </div>
      <div class="hw-audio-body">
        <div class="hw-audio-prompt">
          <strong>Instructions:</strong> ${esc(a.prompt)}
        </div>
        <div class="hw-wave-box">
          <canvas id="hw-aud-canvas" width="900" height="130"></canvas>
          <div class="hw-rec-time" id="hw-aud-time">0:00</div>
        </div>
        <div class="hw-level-wrap">
          <span>Mic level</span>
          <div class="hw-level-bar"><div class="hw-level-fill" id="hw-aud-lvl"></div></div>
          <span class="muted">${mime ? esc(mime.split(';')[0]) : '16 kHz WAV fallback'}</span>
        </div>
        <div class="row">
          <button class="hw-btn danger" id="hw-aud-rec">${a.recording ? 'Stop & Save Take' : 'Start Recording'}</button>
          <span class="muted small" id="hw-aud-status">Ready. Takes save immediately on this device before uploading.</span>
        </div>
      </div>
    </div>`;

  $('#hw-aud-rec').onclick = () => {
    if (a.recording) hwStopAudioOnly(); else hwStartAudioOnly();
  };
}

async function hwStartAudioOnly() {
  const a = HW_STATE.aud;
  const btn = $('#hw-aud-rec'), statusEl = $('#hw-aud-status'), timeEl = $('#hw-aud-time'), lvlEl = $('#hw-aud-lvl'), canvas = $('#hw-aud-canvas');
  if (a.recording) return;

  try {
    const c = ac(); await c.resume();
    if (statusEl) statusEl.textContent = 'Requesting microphone…';
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    a.stream = stream; a.recording = true; a.chunks = []; a.pcmChunks = []; a.pcmSr = c.sampleRate || 44100;
    if (btn) btn.textContent = 'Stop & Save Take';

    if (a.countIn) {
      const beatSec = 60 / a.bpm;
      if (statusEl) statusEl.textContent = `Count-in (${a.bpm} BPM)…`;
      for (let b = 0; b < 4; b++) tone(b === 0 ? 1100 : 780, b * beatSec, 0.06, 'triangle', 0.25 * metVol());
      await new Promise(r => setTimeout(r, Math.round(4 * beatSec * 1000)));
      if (!a.recording) return;
    }

    const src = c.createMediaStreamSource(stream);
    const analyser = c.createAnalyser(); analyser.fftSize = 1024;
    src.connect(analyser); a.srcNode = src; a.analyser = analyser;

    const mime = hwPickAudioMime();
    if (mime) {
      try {
        const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
        mr.ondataavailable = e => { if (e.data && e.data.size > 0) a.chunks.push(e.data); };
        mr.start(250); a.mr = mr;
      } catch { a.mr = null; }
    }
    if (!a.mr && typeof c.createScriptProcessor === 'function') {
      const sp = c.createScriptProcessor(4096, 1, 1);
      const silent = c.createGain(); silent.gain.value = 0;
      sp.onaudioprocess = ev => { if (a.recording) a.pcmChunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
      src.connect(sp); sp.connect(silent).connect(c.destination); a.pcmNode = sp;
    }

    a.startedAt = performance.now();
    if (statusEl) statusEl.textContent = 'Recording…';
    a.timer = setInterval(() => {
      if (!a.recording) return;
      if (timeEl) timeEl.innerHTML = `<span class="hw-rec-dot"></span>${hwFmtTime((performance.now() - a.startedAt) / 1000)}`;
    }, 200);

    const buf = new Uint8Array(analyser.fftSize);
    const ctx2d = canvas ? canvas.getContext('2d') : null;
    const drawWave = () => {
      if (!a.recording || !a.analyser) return;
      a.raf = requestAnimationFrame(drawWave);
      a.analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sumSq += v * v; }
      const rms = Math.sqrt(sumSq / buf.length);
      if (lvlEl) lvlEl.style.width = `${clamp(Math.round(rms * 320), 0, 100)}%`;
      if (ctx2d && canvas) {
        const W = canvas.width, H = canvas.height;
        ctx2d.fillStyle = '#0f172a'; ctx2d.fillRect(0, 0, W, H);
        ctx2d.strokeStyle = '#38bdf8'; ctx2d.lineWidth = 2.5; ctx2d.beginPath();
        const step = W / buf.length;
        for (let i = 0; i < buf.length; i++) { const y = (buf[i] / 255) * H; if (i === 0) ctx2d.moveTo(0, y); else ctx2d.lineTo(i * step, y); }
        ctx2d.stroke();
      }
    };
    drawWave();
  } catch (err) {
    hwCleanupAudioOnly();
    if (btn) btn.textContent = 'Start Recording';
    if (statusEl) statusEl.textContent = `Microphone error: ${err?.message || err}`;
    toast('Could not access microphone.');
  }
}

function hwStopAudioOnly() {
  const a = HW_STATE.aud;
  if (!a.recording) return;
  const elapsed = a.startedAt ? (performance.now() - a.startedAt) / 1000 : 0;
  const mr = a.mr, pcmChunks = a.pcmChunks.slice(), pcmSr = a.pcmSr;
  const saveBlob = async blob => {
    hwCleanupAudioOnly();
    const take = hwBuildSubmissionSummary('audio', 'Audio Check-In', null, blob, elapsed, 0, {
      prompt: a.prompt, countIn: a.countIn, bpm: a.bpm, syncMs: avDelayMs(),
    });
    await hwIdbPut(take);
    await hwRefreshTakes();
    hwMountAudioRunner();
    toast(`Audio take saved locally (${hwFmtBytes(take.audioBytes)})`);
  };
  if (mr && mr.state !== 'inactive') {
    mr.addEventListener('stop', () => {
      const blob = a.chunks.length ? new Blob(a.chunks, { type: mr.mimeType || 'audio/webm' }) : hwDownsampleTo16kWav(pcmChunks, pcmSr);
      saveBlob(blob);
    }, { once: true });
    try { mr.stop(); } catch { saveBlob(hwDownsampleTo16kWav(pcmChunks, pcmSr)); }
  } else {
    saveBlob(hwDownsampleTo16kWav(pcmChunks, pcmSr));
  }
}

// ---------- Saved Takes Drawer
async function hwRefreshTakes() {
  try { HW_STATE.takes = await hwIdbAll(); } catch { HW_STATE.takes = []; }
  hwRenderTakes();
}

function hwRenderTakes() {
  const host = $('#hw-takes-list');
  const countEl = $('#hw-takes-count');
  if (!host) return;
  if (countEl) countEl.textContent = `${HW_STATE.takes.length} saved locally`;
  if (!HW_STATE.takes.length) {
    host.innerHTML = `<div class="hw-empty">No takes recorded yet. Completed takes stay saved on this device even if Wi-Fi drops.</div>`;
    return;
  }

  host.innerHTML = HW_STATE.takes.map(t => {
    let audioUrl = HW_STATE.takeUrls.get(t.id);
    if (!audioUrl && t.audioBlob instanceof Blob && t.audioBlob.size > 0) {
      audioUrl = URL.createObjectURL(t.audioBlob);
      HW_STATE.takeUrls.set(t.id, audioUrl);
    }
    const when = new Date(t.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const showJson = HW_STATE.expandedJson.has(t.id);
    const packetPreview = {
      id: t.id, type: t.type, overall_pct: t.overallPct, rhythm_pct: t.rhythmPct, pitch_pct: t.pitchPct,
      audio_mime: t.audioMime, audio_bytes: t.audioBytes, audio_duration_sec: t.durationSec, expected_sec: t.expectedSec,
      integrity_flags: t.integrityFlags, results_json: t.resultsJson, meta: t.meta,
    };

    return `<div class="hw-take-item" data-take="${esc(t.id)}">
      <div class="hw-take-top">
        <div><strong>${esc(t.label)}</strong> <span class="muted small">· ${esc(when)}</span></div>
        <div class="hw-take-meta">
          ${t.overallPct != null ? `<span class="hw-pill score">Overall ${t.overallPct}% (R ${t.rhythmPct}%${t.pitchPct != null ? ` · P ${t.pitchPct}%` : ''})</span>` : ''}
          ${t.integrityFlags?.length ? `<span class="hw-pill flag">Flags: ${esc(t.integrityFlags.join(', '))}</span>` : ''}
          <span class="hw-pill offline">Saved on this ${esc(DEVICE)}</span>
        </div>
      </div>
      <div class="hw-take-meta">
        <span>Audio: ${t.audioBytes ? `${esc(t.audioMime || 'audio')} · ${hwFmtBytes(t.audioBytes)} · ${t.durationSec}s` : 'None (Spacebar / Tap rhythm)'}</span>
        ${t.resultsJson?.offsetMs != null ? `<span>· Offset ${t.resultsJson.offsetMs}ms</span>` : ''}
        ${t.resultsJson?.rmsPeak != null ? `<span>· Peak RMS ${t.resultsJson.rmsPeak}</span>` : ''}
      </div>
      ${audioUrl ? `<audio class="hw-take-audio" controls preload="metadata" src="${audioUrl}"></audio>` : ''}
      <div class="row">
        <button class="hw-btn" data-hw-json="${esc(t.id)}">${showJson ? 'Hide' : 'Inspect'} Submission JSON</button>
        ${audioUrl ? `<a class="hw-btn" href="${audioUrl}" download="${esc(t.id)}.${(t.audioMime || '').includes('mp4') ? 'm4a' : (t.audioMime || '').includes('wav') ? 'wav' : 'webm'}">Download Audio</a>` : ''}
        <button class="hw-btn" data-hw-del="${esc(t.id)}">Delete</button>
      </div>
      ${showJson ? `<pre class="hw-json-pre">${esc(JSON.stringify(packetPreview, null, 2))}</pre>` : ''}
    </div>`;
  }).join('');

  host.querySelectorAll('[data-hw-json]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.hwJson;
      if (HW_STATE.expandedJson.has(id)) HW_STATE.expandedJson.delete(id); else HW_STATE.expandedJson.add(id);
      hwRenderTakes();
    };
  });
  host.querySelectorAll('[data-hw-del]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.hwDel;
      const url = HW_STATE.takeUrls.get(id);
      if (url) { URL.revokeObjectURL(url); HW_STATE.takeUrls.delete(id); }
      await hwIdbDelete(id);
      await hwRefreshTakes();
    };
  });
}

// ---------- Tab switch & Boot
function hwSwitchTab(tab) {
  if (HW_STATE.aud.recording) hwCleanupAudioOnly();
  if (typeof GR !== 'undefined' && GR.on) try { grStop(false); } catch { }
  HW_STATE.tab = tab;
  document.querySelectorAll('.hw-tab').forEach(b => b.classList.toggle('on', b.dataset.hwTab === tab));
  hwRenderTeacherOptions();
  if (tab === 'sight') hwMountSightRunner();
  else if (tab === 'score') hwMountScoreRunner();
  else hwMountAudioRunner();
}

function hwBoot() {
  hwRenderHeaderChips();
  hwInstallEngineHooks(() => hwRefreshTakes());

  $('#hw-sync-btn').onclick = () => hwOpenSyncModal(false);
  const toggleTeacher = () => {
    HW_STATE.teacherOpen = !HW_STATE.teacherOpen;
    $('#hw-teacher-drawer').hidden = !HW_STATE.teacherOpen;
    hwRenderHeaderChips();
    if (HW_STATE.teacherOpen) hwRenderTeacherOptions();
  };
  $('#hw-teacher-toggle').onclick = toggleTeacher;
  $('#hw-teacher-close').onclick = toggleTeacher;

  document.querySelectorAll('.hw-tab').forEach(b => {
    b.onclick = () => hwSwitchTab(b.dataset.hwTab);
  });

  $('#hw-clear-takes').onclick = async () => {
    for (const url of HW_STATE.takeUrls.values()) URL.revokeObjectURL(url);
    HW_STATE.takeUrls.clear();
    await hwIdbClear();
    await hwRefreshTakes();
    toast('Cleared local takes.');
  };

  hwSwitchTab('sight');
  hwRefreshTakes();

  // Mandatory Audio Sync Check at the start of every new session
  if (!hwSyncIsDone()) {
    hwOpenSyncModal(true);
  }
}

document.addEventListener('DOMContentLoaded', hwBoot);
