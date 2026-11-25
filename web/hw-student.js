'use strict';
/* Rehearsal Online Homework — Student Portal.
   Reuses web/sight.js, web/score.js, web/grade.js, and web/music.js verbatim
   and connects through window.HW_API (Cloudflare Worker backend or faithful
   Local Preview Mode when no ?api= endpoint is configured):
     - Student Sign-In via Class Code + Personal 6-char Code OR Google Sign-In
     - Shared-Chromebook sessionStorage tokens + Sign Out + Offline Retry Queue
     - Mandatory Session Audio Sync Check after sign-in (8-click calibration)
     - My Assignments dashboard with attempt counters, scores, and True Sight-Read lock
     - True Sight-Read: server /start reveal + study countdown + auto-record + auto-submit
     - Practice & Audio-Only: rehearse multiple takes + click "Submit This Take"
     - Collapsible Teacher Setup preserved in Local Preview Mode only */

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
  if (typeof grTone === 'function') { grTone(c, time, midi, dur, gain); return; }
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
  return { sp, shift, startSyl: start.syl, startMidi, startName: hwMidiLabel(startMidi) };
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
  [0, 2, 4, 7].forEach((d, i) => hwPlayMidi(c, t0 + i * 0.14, info.sp(d).midi + info.shift, 1.15 - i * 0.1, 0.72));
}
async function hwPlayScale(st) {
  const c = ac(); await c.resume();
  const info = hwSightPitchInfo(st);
  const t0 = c.currentTime + 0.04;
  [0, 1, 2, 3, 4, 5, 6, 7].forEach((d, i) => hwPlayMidi(c, t0 + i * 0.24, info.sp(d).midi + info.shift, i === 7 ? 0.65 : 0.26, 0.8));
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

// ---------- Mandatory Session Audio Sync Check
const HW_SYNC = { running: false, timers: [], keyHandler: null, mandatory: true, gain: null, onComplete: null };
// a 4-click count-in, then 6 taps; 4 good taps are enough for a steady median
const HW_SYNC_LEAD = 4, HW_SYNC_TAPS = 6, HW_SYNC_MIN_TAPS = 4;
function hwSyncSpaceSuppression() {
  try {
    const syncOpen = !$('#hw-sync-overlay')?.hidden;
    const studyCover = !!$('#hw-study-cover');
    window.__hwSuppressSpace = (HW_STATE.view !== 'runner') || syncOpen || studyCover || !!HW_STATE.srStudying;
  } catch { window.__hwSuppressSpace = false; }
}
function hwSyncIsDone() {
  // once per Chromebook (the measured delay is already saved per device); Sign Out asks again
  try { return localStorage.getItem(HW_SYNC_SESSION_KEY) === '1' || sessionStorage.getItem(HW_SYNC_SESSION_KEY) === '1'; } catch { return false; }
}
function hwClearSyncTimers() {
  HW_SYNC.timers.forEach(id => clearTimeout(id));
  HW_SYNC.timers = [];
  if (HW_SYNC.gain) {
    try { HW_SYNC.gain.gain.value = 0; HW_SYNC.gain.disconnect(); } catch { }
    HW_SYNC.gain = null;
  }
  if (HW_SYNC.keyHandler) { document.removeEventListener('keydown', HW_SYNC.keyHandler, true); HW_SYNC.keyHandler = null; }
  HW_SYNC.running = false;
}
function hwCloseSyncModal(force = false) {
  const overlay = $('#hw-sync-overlay');
  hwClearSyncTimers();
  hwSyncMicStop();
  if (overlay) overlay.hidden = true;
  const cb = HW_SYNC.onComplete;
  HW_SYNC.onComplete = null;
  hwSyncSpaceSuppression();
  if (cb && force) cb();
}
function hwOpenSyncModal(mandatory = false, onComplete = null) {
  hwClearSyncTimers();
  HW_SYNC.mandatory = mandatory;
  HW_SYNC.onComplete = typeof onComplete === 'function' ? onComplete : null;
  const overlay = $('#hw-sync-overlay'), dotsEl = $('#hw-sync-dots'), padBtn = $('#hw-sync-pad'),
    statusEl = $('#hw-sync-status'), startBtn = $('#hw-sync-start'), cancelBtn = $('#hw-sync-cancel'),
    outBtn = $('#hw-sync-signout');
  if (!overlay) return;
  dotsEl.innerHTML = Array.from({ length: HW_SYNC_LEAD + HW_SYNC_TAPS }, (_, i) => `<span class="hw-sync-dot ${i < HW_SYNC_LEAD ? 'lead' : 'tap'}" data-sdot="${i}"></span>`).join('');
  padBtn.disabled = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Start';
  startBtn.onclick = () => hwRunSyncTest();
  hwSyncMicStart();
  cancelBtn.hidden = mandatory;
  if (outBtn) {
    outBtn.hidden = !HW_STATE.session;
    outBtn.onclick = async () => {
      hwCloseSyncModal(false);
      await hwSignOut();
    };
  }
  statusEl.textContent = 'Wait for the 4 yellow clicks, then press Space.';
  overlay.hidden = false;
  hwSyncSpaceSuppression();
  cancelBtn.onclick = () => { if (!HW_SYNC.mandatory) hwCloseSyncModal(false); };
  overlay.onclick = e => { if (e.target === overlay && !HW_SYNC.mandatory) hwCloseSyncModal(false); };
  HW_SYNC.keyHandler = e => {
    if (overlay.hidden) return;
    if (e.key === 'Escape' && !HW_SYNC.mandatory) {
      e.preventDefault();
      e.stopImmediatePropagation();
      hwCloseSyncModal(false);
    }
  };
  document.addEventListener('keydown', HW_SYNC.keyHandler, true);
}

// Step 1 of "Get ready": turn the mic on right away (so Chrome asks now, not mid-homework) and show a live
// level bar. Its own short-lived stream, closed with the dialog; grading opens the mic itself later.
const HW_SYNC_MIC = { stream: null, raf: 0, ctx: null, heard: false };
async function hwSyncMicStart() {
  const msg = $('#hw-sync-mic-msg'), fill = $('#hw-sync-meter');
  if (!msg || !fill || HW_SYNC_MIC.stream) return;
  HW_SYNC_MIC.heard = false;
  fill.style.width = '0%'; fill.classList.remove('ok');
  msg.innerHTML = 'When Chrome asks, click <strong>Allow while visiting the site</strong>.';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    msg.innerHTML = err?.name === 'NotAllowedError'
      ? 'Mic is blocked. Click the icon left of the web address, set <strong>Microphone</strong> to <strong>Allow</strong>, then reload.'
      : 'No microphone found. Plug one in, or ask your teacher.';
    return;
  }
  if ($('#hw-sync-overlay')?.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
  HW_SYNC_MIC.stream = stream;
  msg.innerHTML = 'Say <strong>“ah”</strong>. The bar should move.';
  const c = ac();
  const resume = () => { try { c.resume(); } catch { } };
  resume();
  $('#hw-sync-overlay')?.addEventListener('pointerdown', resume, { once: true });
  const src = c.createMediaStreamSource(stream), an = c.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  HW_SYNC_MIC.ctx = { src, an };
  const buf = new Float32Array(an.fftSize);
  const tickMeter = () => {
    if (!HW_SYNC_MIC.stream) return;
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length), pct = Math.min(100, Math.round(rms * 400));
    fill.style.width = pct + '%';
    if (!HW_SYNC_MIC.heard && rms > 0.04) {
      HW_SYNC_MIC.heard = true;
      fill.classList.add('ok');
      msg.innerHTML = '✓ Your mic works.';
    }
    HW_SYNC_MIC.raf = requestAnimationFrame(tickMeter);
  };
  tickMeter();
}
function hwSyncMicStop() {
  cancelAnimationFrame(HW_SYNC_MIC.raf); HW_SYNC_MIC.raf = 0;
  try { HW_SYNC_MIC.ctx?.src.disconnect(); } catch { }
  HW_SYNC_MIC.ctx = null;
  HW_SYNC_MIC.stream?.getTracks().forEach(t => t.stop());
  HW_SYNC_MIC.stream = null;
}
async function hwRunSyncTest() {
  if (HW_SYNC.running) return;
  hwClearSyncTimers();
  HW_SYNC.running = true;
  const overlay = $('#hw-sync-overlay'), dots = $$('#hw-sync-dots .hw-sync-dot'),
    padBtn = $('#hw-sync-pad'), statusEl = $('#hw-sync-status'), startBtn = $('#hw-sync-start');
  dots.forEach(d => d.classList.remove('active', 'done'));
  startBtn.disabled = true; padBtn.disabled = false;

  const c = ac(); await c.resume();
  const clickBus = c.createGain();
  clickBus.gain.value = 1.0;
  clickBus.connect(c.destination);
  HW_SYNC.gain = clickBus;

  const beat = 60 / 90, t0 = c.currentTime + 0.5, lead = HW_SYNC_LEAD, n = HW_SYNC_TAPS, clicks = [];
  for (let i = 0; i < lead + n; i++) {
    const t = t0 + i * beat;
    const osc = c.createOscillator(), env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = i % 4 === 0 ? 1100 : 780;
    const vol = (i % 4 === 0 ? 0.34 : 0.24) * metVol();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    osc.connect(env).connect(clickBus);
    osc.start(t);
    osc.stop(t + 0.06);
    if (i >= lead) clicks.push(t);
    const msUntil = Math.max(0, (t - c.currentTime) * 1000);
    HW_SYNC.timers.push(setTimeout(() => {
      dots.forEach(d => d.classList.remove('active'));
      if (dots[i]) dots[i].classList.add('active');
      if (i < lead) statusEl.textContent = `Listen… ${i + 1}`;
      else if (i === lead) statusEl.textContent = 'Press Space now!';
    }, msUntil));
  }

  const diffs = [], usedClicks = new Set();
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
    statusEl.textContent = `${diffs.length} of ${n}`;
  };

  padBtn.onpointerdown = e => { e.preventDefault(); recordTap(e); };
  HW_SYNC.keyHandler = e => {
    if (overlay.hidden) return;
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); recordTap(e); }
    if (e.key === 'Escape' && !HW_SYNC.mandatory) { e.preventDefault(); e.stopImmediatePropagation(); hwCloseSyncModal(false); }
  };
  document.addEventListener('keydown', HW_SYNC.keyHandler, true);

  const totalMs = Math.max(0, (t0 + (lead + n) * beat + 0.55 - c.currentTime) * 1000);
  HW_SYNC.timers.push(setTimeout(() => {
    hwClearSyncTimers(); padBtn.disabled = true; dots.forEach(d => d.classList.remove('active'));
    if (diffs.length < HW_SYNC_MIN_TAPS) {
      statusEl.textContent = 'Not enough taps. Try again.';
      startBtn.disabled = false; startBtn.textContent = 'Try again';
      return;
    }
    const medianSec = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const ms = setAvDelay(medianSec * 1000);
    try { sessionStorage.setItem(HW_SYNC_SESSION_KEY, '1'); localStorage.setItem(HW_SYNC_SESSION_KEY, '1'); } catch { }
    hwRenderHeaderChips();
    statusEl.innerHTML = '✓ Done. You’re ready!';
    statusEl.title = `${ms} ms on this ${DEVICE}`;
    startBtn.disabled = false; startBtn.textContent = 'Continue';
    startBtn.onclick = () => hwCloseSyncModal(true);
  }, totalMs));
}
window.openAvCal = () => hwOpenSyncModal(false);

// ---------- Local summary builder before uploading to Worker
function hwBuildSubmissionSummary(type, label, gradeResult, audioBlob, durationSec, expectedSec, meta = {}, autoSubmit = false) {
  const flags = [];
  let overallPct = null, rhythmPct = null, pitchPct = null, resultsJson = null;

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
    if (expectedSec > 1 && durationSec > 0 && durationSec < expectedSec * 0.5) flags.push('duration_too_short');

    resultsJson = {
      engineRhythmPct: Math.round(res.rhythmPct || 0),
      enginePitchPct: res.pitchPct == null ? null : Math.round(res.pitchPct),
      recomputedOverallPct: overallPct,
      strictness: res.strictness || null,
      offsetMs: res.offsetMs ?? null,
      driftCents: res.driftCents ?? null,
      extra: res.extra ?? 0,
      rmsPeak: +rmsPeak.toFixed(4),
      inputMode: gradeResult.take?.taps ? 'tap' : (gradeResult.gradePitch ? 'mic_pitch_rhythm' : 'mic_rhythm'),
      noteCount: total,
      notes: notes.map((n, i) => ({
        bar: n.bar, idx: n.idx, status: n.status, pitch: n.pitch || null, cents: n.cents ?? null, errMs: n.errMs ?? null,
        written: n.written ?? null, sungAs: n.sungAs || null, octave: n.octave || null, joined: n.joined || null,
        t: Number.isFinite(gradeResult.exp?.[i]?.t) ? +gradeResult.exp[i].t.toFixed(4) : null,
      })),
      // so the teacher's review can draw the same marks on the music as the student's grade card
      q: res.q || null,
      lineIdx: gradeResult.lineIdx ?? null,
      rangeLabel: res.rangeLabel || null,
      partName: res.partName || null,
      heard: res.diag?.heard ?? null,
      extraAt: (() => {
        const used = new Set(notes.map(n => n.match).filter(Boolean));
        return (res.det || []).filter(d => !used.has(d) && res.q).map(d => +((d.t - res.T0 - (res.offsetSec || 0)) / res.q).toFixed(3)).filter(Number.isFinite);
      })(),
    };
  } else if (!audioBlob || audioBlob.size === 0) {
    flags.push('missing_audio');
  }

  if (audioBlob && audioBlob.size > HW_MAX_AUDIO_BYTES) flags.push('audio_over_15mb');

  return {
    id: 'take_' + uid(),
    assignmentId: HW_STATE.activeAssignment?.id || `preview_${type}`,
    assignmentTitle: HW_STATE.activeAssignment?.title || label,
    studentId: HW_STATE.previewMode ? 'teacher_preview' : (HW_STATE.session?.student?.id || 'local'),
    attemptStartId: meta.attemptStartId || null,
    createdAt: Date.now(),
    status: 'draft',
    uploadState: 'draft', // 'draft' | 'uploading' | 'queued_offline' | 'submitted'
    serverSubmissionId: null,
    lastUploadError: null,
    autoSubmitted: !!autoSubmit,
    submittedAt: null,
    type, label, overallPct, rhythmPct, pitchPct,
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
  HW_GRADE_CAP.chunks = []; HW_GRADE_CAP.mime = mime; HW_GRADE_CAP.startedAt = performance.now();
  if (!stream || !mime) return;
  try {
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
    mr.ondataavailable = e => { if (e.data && e.data.size > 0) HW_GRADE_CAP.chunks.push(e.data); };
    mr.start(250); HW_GRADE_CAP.mr = mr;
  } catch { HW_GRADE_CAP.mr = null; }
}
function hwAbortParallelRecorder() {
  if (HW_GRADE_CAP.mr && HW_GRADE_CAP.mr.state !== 'inactive') { try { HW_GRADE_CAP.mr.stop(); } catch { } }
  HW_GRADE_CAP.mr = null; HW_GRADE_CAP.chunks = [];
}
function hwFinishParallelRecorder(recFallback) {
  const mr = HW_GRADE_CAP.mr, mime = HW_GRADE_CAP.mime || 'audio/webm';
  const elapsed = HW_GRADE_CAP.startedAt ? (performance.now() - HW_GRADE_CAP.startedAt) / 1000 : 0;
  HW_GRADE_CAP.mr = null;
  const buildFallbackWav = () => {
    if (recFallback && Array.isArray(recFallback.chunks) && recFallback.chunks.length) {
      const totalSamples = recFallback.chunks.reduce((s, a) => s + a.length, 0);
      return { blob: hwDownsampleTo16kWav(recFallback.chunks, recFallback.sr || 44100), durationSec: recFallback.sr ? totalSamples / recFallback.sr : elapsed };
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
        const autoSubmit = HW_STATE.tab === 'sight' && HW_STATE.srTrueMode && !HW_STATE.teacherOpen;
        HW_GRADE_CAP.activeContext = {
          type: 'sight',
          label: `Sight Reading (${st.mode === 'solfege' ? 'Solfege · Mic' : 'Rhythm · ' + (input === 'tap' ? 'Spacebar/Tap' : 'Mic')})`,
          host,
          autoSubmit,
          expectedSec: Math.max(0, (GR.end || 0) - (GR.T0 || 0) - 0.8),
          meta: {
            mode: st.mode, input, ts: st[st.mode]?.ts, tempo: st[st.mode]?.tempo, key: st[st.mode]?.key,
            trueSightRead: !!HW_STATE.srTrueMode, studySeconds: HW_STATE.srTrueMode ? HW_STATE.srStudySec : 0,
            attemptStartId: HW_STATE.activeAttemptStart?.id || null,
            syncMs: avDelayMs(), strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 25, pitch: 25 },
          },
        };
        if (input !== 'tap' && GR.mic?.stream) hwStartParallelRecorder(GR.mic.stream);
        else hwAbortParallelRecorder();
      } else if (!wasRunning && typeof GR !== 'undefined' && !GR.on && !GR.starting) hwMicCloseSoon(0);   // cancelled while the mic was starting: don't leave it open
      return res;
    };
  }

  if (typeof spGradeStart === 'function') {
    const origSpGradeStart = window.spGradeStart;
    window.spGradeStart = async function (ctl, btn, inputOverride = null) {
      const wasRunning = typeof GR !== 'undefined' && (GR.on || GR.starting);
      const res = await origSpGradeStart.call(this, ctl, btn, inputOverride);
      if (!wasRunning && typeof GR !== 'undefined' && GR.on) {
        let mode = inputOverride || ctl?.st?.gradeMode || 'mic'; if (mode === 'rhythm') mode = 'tap';
        HW_GRADE_CAP.activeContext = {
          type: 'score',
          label: `Score Practice (${ctl?.st?.name || HW_STATE.activeAssignment?.title || 'Score Check-In'})`,
          host: ctl?.host,
          autoSubmit: false,
          expectedSec: Math.max(0, (GR.end || 0) - (GR.T0 || 0) - 0.8),
          meta: {
            scoreName: ctl?.st?.name || 'Score Check-In', gradeMode: mode, tempo: ctl?.st?.tempo || null,
            attemptStartId: null,
            syncMs: avDelayMs(), strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 25, pitch: 25 },
          },
        };
        if (mode !== 'tap' && GR.mic?.stream) hwStartParallelRecorder(GR.mic.stream);
        else hwAbortParallelRecorder();
      } else if (!wasRunning && typeof GR !== 'undefined' && !GR.on && !GR.starting) hwMicCloseSoon(0);   // cancelled while the mic was starting: don't leave it open
      return res;
    };
  }

  if (typeof grShowCard === 'function') {
    const origGrShowCard = window.grShowCard;
    window.grShowCard = function (res, gradePitch, hist, host, fromRecent) {
      const out = origGrShowCard.call(this, res, gradePitch, hist, host, fromRecent);
      if (HW_STATE.freePractice) { HW_GRADE_CAP.activeContext = null; hwAbortParallelRecorder(); return out; }   // just practice: the card is the result, nothing saved
      if (!fromRecent && host?.__grResult) {
        const ctx = HW_GRADE_CAP.activeContext || {
          type: host.classList?.contains('score-host') ? 'score' : 'sight',
          label: host.classList?.contains('score-host') ? 'Score Practice' : 'Sight Reading',
          autoSubmit: false, expectedSec: 0, meta: {},
        };
        HW_GRADE_CAP.activeContext = null;
        const studyBar = $('#hw-study-bar');
        if (studyBar && ctx.autoSubmit) {
          studyBar.classList.remove('live');
          studyBar.classList.add('done');
          const timerEl = $('#hw-study-timer');
          if (timerEl) timerEl.textContent = 'DONE';
          const msgEl = $('#hw-study-msg');
          if (msgEl) {
            msgEl.innerHTML = HW_STATE.previewMode
              ? '<strong>Completed!</strong> Grading your preview take locally…'
              : '<strong>Completed!</strong> Saving &amp; submitting your True Sight-Read take…';
          }
          const pWrap = $('#hw-study-pitches');
          if (pWrap) pWrap.innerHTML = `<span class="hw-pill draft">${HW_STATE.previewMode ? 'Grading…' : 'Uploading…'}</span>`;
        }
        const grObj = host.__grResult;
        hwFinishParallelRecorder(grObj.take?.rec).then(async ({ blob, durationSec }) => {
          const take = hwBuildSubmissionSummary(
            ctx.type, ctx.label, grObj, grObj.take?.taps ? null : blob, durationSec, ctx.expectedSec, ctx.meta, ctx.autoSubmit
          );
          if (hwTakeIsEmpty(take, grObj)) { toast('Nothing was heard, so that take wasn’t saved.'); return; }
          await hwIdbPut(take);
          await hwPruneTakes(take);
          HW_STATE.latestTakeId = take.id;
          await onTakeSaved(take);
          if (HW_STATE.previewMode) {
            if (ctx.autoSubmit) {
              const msgEl = $('#hw-study-msg'), pWrap = $('#hw-study-pitches');
              if (msgEl) {
                msgEl.innerHTML = `<strong>Preview complete!</strong>${take.overallPct != null ? ` Score: ${take.overallPct}% —` : ''} Nothing was saved to your Gradebook. Click <strong>Reset Preview</strong> above to try again.`;
              }
              if (pWrap) pWrap.innerHTML = `<span class="hw-pill submitted">✓ Preview Complete</span>`;
            }
            toast(`Preview take graded (${take.overallPct != null ? take.overallPct + '%' : 'audio'}) — sandbox only, not saved to Gradebook`);
          } else if (ctx.autoSubmit && HW_STATE.session && !HW_STATE.teacherOpen) {
            await hwUploadTake(take.id);
          } else {
            toast(`Practice take saved (${take.overallPct != null ? take.overallPct + '%' : 'audio'}) — click Submit when ready`);
          }
        }).catch(err => console.error('Failed saving graded take:', err));
      }
      return out;
    };
  }

  // When a take ends, close the mic soon instead of 2 minutes later (the app keeps it open between takes
  // for Macs; on a student's Chromebook the browser's mic light staying on looks like it's still recording).
  // A cancelled take also stops the background recorder, so it can't turn into an empty take later.
  if (typeof grStop === 'function') {
    const origGrStop = window.grStop;
    window.grStop = function (show = true) {
      const wasOn = typeof GR !== 'undefined' && GR.on;
      const out = origGrStop.call(this, show);
      if (wasOn) {
        if (!show) { HW_GRADE_CAP.activeContext = null; hwAbortParallelRecorder(); }
        hwMicCloseSoon(show ? HW_MIC_IDLE_MS : 0);
      }
      return out;
    };
  }
}
const HW_MIC_IDLE_MS = 20000;
function hwMicCloseSoon(ms) {
  if (typeof GR === 'undefined' || !GR.mic || typeof grMicClose !== 'function') return;
  clearTimeout(GR.mic.idle);
  GR.mic.idle = setTimeout(grMicClose, ms);
}

// ---------- App State
const HW_STATE = {
  view: 'auth',         // 'auth' | 'list' | 'runner'
  session: null,        // { student, class }
  previewMode: false,
  previewToken: '',
  previewClass: null,
  previewRevealed: false,
  assignments: [],
  activeAssignment: null,
  activeAttemptStart: null,
  scoreFileIds: new Map(),
  tab: 'sight',         // 'sight' | 'score' | 'audio'
  teacherOpen: false,
  // Sight Reading assignment config
  srTrueMode: true,
  srStudySec: 30,
  srStudyLeft: 0,
  srStudyTimer: null,
  srStudying: false,
  srTrueSubmitted: null,
  srState: null,
  srHost: null,
  // Score Practice assignment config
  spFileId: null,
  spState: null,
  spHost: null,
  spCtl: null,
  spGradeMode: 'mic',   // 'mic' | 'tap' (older 'rhythm' = clap into the mic, now tapped)
  // Audio-Only config
  aud: {
    recording: false, stream: null, mr: null, chunks: [], pcmChunks: [], pcmSr: 44100,
    pcmNode: null, srcNode: null, analyser: null, raf: 0, startedAt: 0, timer: null,
    countIn: true, bpm: 84,
    prompt: 'Sing a 5-note major scale (do–re–mi–fa–sol–fa–mi–re–do) on "ah", or play your assigned warm-up.',
  },
  takes: [],
  latestTakeId: null,
  expandedJson: new Set(),
  takeUrls: new Map(),
  serverAudioUrls: new Map(),
  scoreLoadError: '',
  retryingAll: false,
  capabilities: { googleSignInEnabled: false, billingEnabled: false },
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
function hwFmtDue(ts) {
  if (!ts) return 'No due date';
  try {
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return 'Due soon'; }
}
function hwFormatCodeInputValue(raw) {
  const norm = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (norm.length > 3) return `${norm.slice(0, 3)}-${norm.slice(3)}`;
  return norm;
}

function hwCanSubmitActive() {
  if (HW_STATE.previewMode) return true;
  if (HW_STATE.teacherOpen) return true;
  if (!HW_STATE.session) return true;
  if (HW_STATE.session.class?.acceptingSubmissions === false) return false;
  const a = HW_STATE.activeAssignment;
  if (a && a.attemptsRemaining !== null && a.attemptsRemaining !== undefined && a.attemptsRemaining <= 0) {
    return false;
  }
  return true;
}

function hwCurrentTakesForAssignment() {
  const aid = HW_STATE.activeAssignment?.id;
  if (HW_STATE.previewMode) {
    return HW_STATE.takes.filter(t => t.studentId === 'teacher_preview' && (!aid || t.assignmentId === aid));
  }
  const sid = HW_STATE.session?.student?.id;
  return HW_STATE.takes.filter(t => {
    if (t.studentId === 'teacher_preview') return false;
    if (aid && t.assignmentId && t.assignmentId !== aid) return false;
    if (sid && t.studentId && t.studentId !== 'local' && t.studentId !== sid) return false;
    return true;
  });
}

function hwQueuedOfflineTakes() {
  const sid = HW_STATE.session?.student?.id;
  return HW_STATE.takes.filter(t =>
    t.studentId !== 'teacher_preview' &&
    t.uploadState === 'queued_offline' &&
    (!sid || !t.studentId || t.studentId === 'local' || t.studentId === sid)
  );
}

// ---------- Upload Pipeline & IndexedDB Offline Queue
async function hwUploadTake(id) {
  if (HW_STATE.previewMode) {
    toast('Teacher Preview Sandbox — takes stay local and are never saved to your Gradebook.');
    return { ok: false, previewBlocked: true };
  }
  const take = HW_STATE.takes.find(t => t.id === id);
  if (!take || !HW_STATE.session) return;
  const targetAssignmentId = take.assignmentId || HW_STATE.activeAssignment?.id;
  if (!targetAssignmentId) return;

  take.uploadState = 'uploading';
  take.lastUploadError = null;
  await hwIdbPut(take);
  hwRenderTakes();
  hwRenderLatestBanner();

  const payload = {
    attemptStartId: take.attemptStartId || take.meta?.attemptStartId || null,
    durationSec: take.durationSec || 0,
    expectedSec: take.expectedSec || 0,
    claimedOverallPct: take.overallPct,
    results: take.resultsJson || null,
    meta: take.meta || {},
  };

  const res = await HW_API.submitAttempt(targetAssignmentId, {
    payload,
    audioBlob: take.audioBlob instanceof Blob ? take.audioBlob : null,
  });

  if (res.ok && res.submission) {
    take.status = 'submitted';
    take.uploadState = 'submitted';
    take.submittedAt = res.submission.submittedAt || Date.now();
    take.serverSubmissionId = res.submission.id;
    take.overallPct = res.submission.overallPct;
    take.rhythmPct = res.submission.rhythmPct;
    take.pitchPct = res.submission.pitchPct;
    take.lastUploadError = null;
    await hwIdbPut(take);

    if (HW_STATE.activeAssignment && HW_STATE.activeAssignment.id === targetAssignmentId) {
      HW_STATE.activeAttemptStart = null;
      if (take.autoSubmitted) HW_STATE.srTrueSubmitted = take;
    }

    await hwRefreshAssignments();
    if (HW_STATE.activeAssignment && HW_STATE.activeAssignment.id === targetAssignmentId) {
      const fresh = await HW_API.getAssignment(targetAssignmentId);
      if (fresh.ok && fresh.assignment) HW_STATE.activeAssignment = fresh.assignment;
      hwRenderRunnerHeaderBar();
      const studyMsg = $('#hw-study-msg'), pWrap = $('#hw-study-pitches');
      if (take.autoSubmitted && studyMsg && pWrap) {
        studyMsg.innerHTML = `<strong>Completed!</strong> Auto-submitted to your teacher${take.overallPct != null ? ` (${take.overallPct}%)` : ''}.`;
        pWrap.innerHTML = `<span class="hw-pill submitted">✓ Auto-Submitted</span>`;
      }
    }
    await hwRefreshTakes();
    toast(`Submitted to your teacher!${take.overallPct != null ? ` (${take.overallPct}%)` : ''}`);
    return { ok: true };
  }

  if (res.networkError) {
    take.status = 'draft';
    take.uploadState = 'queued_offline';
    take.lastUploadError = res.error || 'Saved on this device — connect to Wi-Fi and click Retry Upload.';
    await hwIdbPut(take);
    await hwRefreshTakes();
    const studyMsg = $('#hw-study-msg'), pWrap = $('#hw-study-pitches');
    if (take.autoSubmitted && studyMsg && pWrap) {
      studyMsg.innerHTML = '<strong>Saved on this device!</strong> Offline — reconnect to Wi-Fi and click Retry Upload below.';
      pWrap.innerHTML = `<span class="hw-pill queued">Saved Offline</span>`;
    }
    toast('No connection — recording saved safely on this device.');
    return { ok: false, networkError: true };
  }

  // Permanent rejection (409 attempt limit, 402 read-only, 413 audio too large, etc.)
  take.status = 'draft';
  take.uploadState = 'draft';
  take.lastUploadError = res.error || 'Could not submit recording.';
  await hwIdbPut(take);
  await hwRefreshTakes();
  toast(take.lastUploadError);
  return { ok: false, error: take.lastUploadError };
}

async function hwRetryQueuedUploads(quiet = false) {
  if (HW_STATE.retryingAll || !HW_STATE.session) return;
  const queued = hwQueuedOfflineTakes();
  if (!queued.length) return;
  HW_STATE.retryingAll = true;
  hwRenderOfflineBanner();
  let uploaded = 0;
  for (const t of queued) {
    const out = await hwUploadTake(t.id);
    if (out?.ok) uploaded++;
    else if (out?.networkError) break;
  }
  HW_STATE.retryingAll = false;
  hwRenderOfflineBanner();
  if (!quiet && uploaded > 0) {
    toast(`Uploaded ${uploaded} queued recording${uploaded === 1 ? '' : 's'}!`);
  }
}

function hwRenderOfflineBanner() {
  const banner = $('#hw-offline-banner'), msg = $('#hw-offline-msg'), btn = $('#hw-retry-all');
  if (!banner) return;
  const queued = HW_STATE.session ? hwQueuedOfflineTakes() : [];
  if (!queued.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (msg) {
    msg.textContent = `${queued.length} recording${queued.length === 1 ? '' : 's'} saved on this device — waiting to upload`;
  }
  if (btn) {
    btn.disabled = HW_STATE.retryingAll;
    btn.textContent = HW_STATE.retryingAll ? 'Uploading…' : 'Retry Upload Now';
  }
}

function hwRenderLatestBanner() {
  const host = $('#hw-latest-banner');
  if (!host) return;
  const takeList = hwCurrentTakesForAssignment();
  const t = takeList.find(x => x.id === HW_STATE.latestTakeId && x.type === HW_STATE.tab) || null;
  if (!t) { host.innerHTML = ''; return; }

  if (HW_STATE.previewMode) {
    host.innerHTML = `<div class="hw-submit-banner draft">
      <span><strong>Preview Take Graded:</strong> ${esc(t.label)}${t.overallPct != null ? ` — ${t.overallPct}% (Rhythm ${t.rhythmPct}%${t.pitchPct != null ? ` · Pitch ${t.pitchPct}%` : ''})` : ''}</span>
      <span class="hw-pill preview">Sandbox Only · Not Sent to Gradebook</span>
    </div>`;
    return;
  }

  if (t.uploadState === 'uploading') {
    host.innerHTML = `<div class="hw-submit-banner draft">
      <span><strong>Uploading…</strong> ${esc(t.label)} is being sent to your teacher.</span>
    </div>`;
  } else if (t.uploadState === 'queued_offline') {
    host.innerHTML = `<div class="hw-submit-banner" style="background:#fffbeb;border-bottom-color:#fcd34d;color:#78350f">
      <span><strong>Saved on this device:</strong> ${esc(t.label)} — waiting for connection to upload.</span>
      <button type="button" class="hw-btn primary" id="hw-banner-retry">Retry Upload</button>
    </div>`;
    const rbtn = $('#hw-banner-retry');
    if (rbtn) rbtn.onclick = () => hwUploadTake(t.id);
  } else if (t.status === 'submitted') {
    host.innerHTML = `<div class="hw-submit-banner">
      <span><strong>✓ ${t.autoSubmitted ? 'Auto-Submitted (True Sight-Read)' : 'Submitted to Teacher'}:</strong> ${esc(t.label)}${t.overallPct != null ? ` — ${t.overallPct}% (Rhythm ${t.rhythmPct}%${t.pitchPct != null ? ` · Pitch ${t.pitchPct}%` : ''})` : ''}</span>
      <span class="small">Saved on this ${esc(DEVICE)}</span>
    </div>`;
  } else {
    const canSub = hwCanSubmitActive();
    host.innerHTML = `<div class="hw-submit-banner draft">
      <span><strong>Practice Take Ready:</strong> ${esc(t.label)}${t.overallPct != null ? ` — ${t.overallPct}%` : ''} ${t.lastUploadError ? `(${esc(t.lastUploadError)})` : '(Not submitted yet — listen below or record again)'}</span>
      <button type="button" class="hw-btn good" id="hw-banner-submit" ${canSub ? '' : 'disabled'}>Submit This Take</button>
    </div>`;
    const btn = $('#hw-banner-submit');
    if (btn) btn.onclick = () => hwUploadTake(t.id);
  }
}

// ---------- Header chips & View Navigation
function hwRenderHeaderChips() {
  const demo = HW_API.isDemoMode();
  const loggedIn = !!HW_STATE.session;
  const preview = !!HW_STATE.previewMode;
  const badge = $('#hw-mode-badge');
  if (badge) {
    badge.textContent = preview ? 'Teacher Preview' : (demo ? 'Preview Mode' : 'Student Portal');
    badge.classList.toggle('preview', preview);
  }

  const stuChip = $('#hw-student-chip');
  if (stuChip) {
    if (preview) {
      stuChip.hidden = false;
      stuChip.textContent = `Teacher Sandbox${HW_STATE.previewClass?.name ? ` · ${HW_STATE.previewClass.name}` : ''}`;
    } else if (loggedIn) {
      const s = HW_STATE.session.student;   // the class name is already at the top of the page
      stuChip.hidden = false;
      stuChip.textContent = s.displayName;
    } else {
      stuChip.hidden = true;
    }
  }

  const syncBtn = $('#hw-sync-btn');
  if (syncBtn) {
    syncBtn.hidden = !(loggedIn || preview);
    const done = hwSyncIsDone();
    syncBtn.textContent = done ? 'Re-sync' : (preview ? 'Audio Sync (Optional)' : 'Audio Sync Needed');
    syncBtn.title = done ? `Tap along again if your headphones changed (now ${avDelayMs()} ms)` : 'Run the audio sync check for this device';
    syncBtn.classList.toggle('ok', done);
    syncBtn.classList.toggle('warn', !done && !preview);
  }

  const offBtn = $('#hw-offline-btn');
  if (offBtn) {
    offBtn.hidden = preview || !(demo && loggedIn);
    const isOff = HW_API.isDemoOffline();
    offBtn.textContent = isOff ? 'Offline Test: ON' : 'Offline Test: Off';
    offBtn.classList.toggle('offline-on', isOff);
  }

  const tBtn = $('#hw-teacher-toggle');
  if (tBtn) {
    tBtn.hidden = preview || HW_STATE.freePractice || !(demo && loggedIn && HW_STATE.view === 'runner');
    tBtn.classList.toggle('on', HW_STATE.teacherOpen);
    tBtn.textContent = HW_STATE.teacherOpen ? 'Preview Student View' : 'Teacher Setup ▾';
  }

  const outBtn = $('#hw-signout-btn');
  if (outBtn) outBtn.hidden = preview || !loggedIn;

  const devChip = $('#hw-dev-chip');
  if (devChip) {
    devChip.hidden = !(demo || preview);
    if (demo || preview) {
      const mime = hwPickAudioMime();
      devChip.textContent = `${DEVICE} · ${mime ? mime.split(';')[0] : 'WAV fallback'}`;
    }
  }
}

function hwCleanupMediaAndMic() {
  hwStopStudyTimer();
  if (HW_STATE.aud.recording) hwCleanupAudioOnly();
  hwAbortParallelRecorder();
  if (typeof GR !== 'undefined' && (GR.on || GR.starting)) try { grStop(false); } catch { }
  if (typeof grMicClose === 'function') try { grMicClose(); } catch { }
}

function hwSetView(view) {
  if (view !== 'runner') {
    hwCleanupMediaAndMic();
    document.getElementById('gr-card')?.remove();   // the grade card belongs to the assignment just left
    HW_STATE.freePractice = false;
    HW_STATE.teacherOpen = false;
    const drawer = $('#hw-teacher-drawer');
    if (drawer) drawer.hidden = true;
  }
  HW_STATE.view = view;
  const authEl = $('#hw-auth-view'), listEl = $('#hw-list-view'), runEl = $('#hw-runner-wrap');
  if (authEl) authEl.hidden = view !== 'auth';
  if (listEl) listEl.hidden = view !== 'list';
  if (runEl) runEl.hidden = view !== 'runner';
  hwSyncSpaceSuppression();
  hwRenderHeaderChips();
  hwRenderOfflineBanner();
}

function hwSyncRunnerViewClass() {
  const runner = $('#hw-runner-body');
  if (!runner) return;
  runner.classList.remove('hw-free');
  runner.classList.toggle('hw-student-view', !HW_STATE.teacherOpen);
  runner.classList.toggle('hw-teacher-mode', HW_STATE.teacherOpen);
}

// ---------- Sign-In Screen
function hwShowAuthError(msg) {
  const box = $('#hw-auth-err');
  if (!box) return;
  if (!msg) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.textContent = msg;
}

async function hwEnsureGsiLoaded() {
  if (window.google?.accounts?.id) return true;
  if (hwEnsureGsiLoaded._p) return hwEnsureGsiLoaded._p;
  hwEnsureGsiLoaded._p = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(!!window.google?.accounts?.id);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return hwEnsureGsiLoaded._p;
}

// The Google Web client ID comes from the homework server (set once there); a link or page can override it.
function hwGoogleClientId() {
  return QS.get('googleClientId') || window.HW_GOOGLE_CLIENT_ID || HW_STATE.capabilities?.googleClientId || '';
}

// Draw Google's own "Sign in with Google" button into slot. It opens a popup, which works even when Chrome
// hides Google's pop-down prompt (it does after a student closes it a few times). Returns false if unavailable.
async function hwRenderGoogleButton(slot, onCredential) {
  const clientId = hwGoogleClientId();
  if (!slot || !clientId || HW_API.isDemoMode()) return false;
  if (!(await hwEnsureGsiLoaded())) return false;
  try {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: resp => { if (resp?.credential) onCredential(resp.credential); },
    });
    slot.innerHTML = '';
    window.google.accounts.id.renderButton(slot, {
      type: 'standard', theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with',
      width: Math.max(240, Math.min(400, slot.clientWidth || 320)),
    });
    return true;
  } catch { return false; }
}

// Signed in with codes and not linked yet: offer a one-time "Use Google next time".
function hwRenderGoogleLinkOffer() {
  const box = $('#hw-glink');
  if (!box) return;
  const stu = HW_STATE.session?.student || {};
  let dismissed = false;
  try { dismissed = localStorage.getItem('rehearsal-hw-glink-skip-' + stu.id) === '1'; } catch { }
  const show = !HW_STATE.isTestSession && !!hwGoogleClientId() && !HW_API.isDemoMode() && HW_STATE.session?.authMethod === 'code' && stu.hasGoogle === false && !dismissed;
  box.hidden = !show;
  if (!show) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="hw-glink-text"><strong>Skip the codes next time.</strong> Connect your school Google account.</div>
    <div class="hw-glink-btns"><div id="hw-glink-gsi"></div><button type="button" class="hw-btn" id="hw-glink-skip">Not now</button></div>`;
  $('#hw-glink-skip').onclick = () => {
    try { localStorage.setItem('rehearsal-hw-glink-skip-' + stu.id, '1'); } catch { }
    box.hidden = true;
  };
  hwRenderGoogleButton($('#hw-glink-gsi'), async cred => {
    const res = await HW_API.linkGoogle(cred);
    if (!res.ok) { toast(res.error || 'Could not connect Google.'); return; }
    stu.hasGoogle = true;
    box.hidden = true;
    toast('Done! Next time, just click Sign in with Google.');
  }).then(ok => { if (!ok) box.hidden = true; });
}

// Show or fold away the student-code form (Google sign-in is the default when it's on).
function hwApplyCodeOpen(gEnabled) {
  const form = $('#hw-code-form'), tog = $('#hw-code-toggle'), div = $('#hw-code-divider');
  const open = !gEnabled || !!HW_STATE.codeOpen;
  if (form) form.hidden = !open;
  if (div) div.hidden = !gEnabled;
  if (tog) {
    tog.setAttribute('aria-expanded', String(open));
    tog.textContent = open ? 'Hide student code' : 'Use my student code instead';
  }
}
function hwRenderAuthScreen() {
  hwSetView('auth');
  hwShowAuthError('');
  const jcInput = $('#hw-in-joincode'), scInput = $('#hw-in-stucode'), clsPicker = $('#hw-google-classes');
  if (clsPicker) { clsPicker.hidden = true; clsPicker.innerHTML = ''; }
  const urlCode = QS.get('code');
  const urlStudent = QS.get('student');
  if (jcInput && urlCode && !jcInput.value) {
    jcInput.value = hwFormatCodeInputValue(urlCode);
  }
  if (scInput && urlStudent && !scInput.value) {
    scInput.value = hwFormatCodeInputValue(urlStudent);
  }

  const gEnabled = HW_API.isDemoMode() || !!hwGoogleClientId();
  const gBox = $('#hw-google-box'), gDiv = $('#hw-code-divider'), authSub = $('#hw-auth-sub');
  if (gBox) gBox.hidden = !gEnabled;
  if (gDiv) gDiv.hidden = !gEnabled;
  const gJoin = $('#hw-google-join'); if (gJoin) gJoin.hidden = true;
  $('#hw-code-submit')?.classList.toggle('primary', !gEnabled);   // one bright button: Google when it's on
  // Google is the default. The student-code form stays folded away until "Use my student code instead" is clicked,
  // except when Google isn't set up, in the sandbox, or the page was opened from a printed slip link that has a code.
  if (HW_STATE.codeOpen == null) HW_STATE.codeOpen = HW_API.isDemoMode() || !!(urlCode || urlStudent);
  hwApplyCodeOpen(gEnabled);
  if (authSub) {
    authSub.innerHTML = gEnabled
      ? 'Use your school Google account, or your student code.'
      : 'Enter the <strong>Class Code</strong> and your <strong>Student Code</strong> from your teacher.';
  }
  // Google's own button (a popup) where Google Sign-In is set up; our plain button in the sandbox
  const gBtn = $('#hw-google-btn'), gSlot = $('#hw-google-gsi');
  if (gEnabled && !HW_API.isDemoMode()) {
    hwRenderGoogleButton(gSlot, cred => hwHandleGoogleSignIn('', cred)).then(ok => { if (gBtn) gBtn.hidden = ok; });
  } else if (gBtn) {
    gBtn.hidden = false;
    if (gSlot) gSlot.innerHTML = '';
  }

  const demoBox = $('#hw-demo-creds');
  if (demoBox) {
    if (!HW_API.isDemoMode()) {
      demoBox.hidden = true;
      demoBox.innerHTML = '';
    } else {
      const creds = HW_API.getDemoCredentials();
      if (jcInput && !jcInput.value && creds.joinCode) {
        jcInput.value = hwFormatCodeInputValue(creds.joinCode);
      }
      if (scInput && !scInput.value && creds.students[0]?.code) {
        scInput.value = hwFormatCodeInputValue(creds.students[0].code);
      }
      demoBox.hidden = false;
      demoBox.innerHTML = `
        <div><strong>Student Sandbox</strong> — Sample codes are already filled in above (<strong>${esc(creds.joinCode)}</strong> · ${esc(creds.students[0]?.displayName || 'Maya Lin')}). Click <strong>Sign In with Code</strong>, or jump in as another sample student:</div>
        <div class="hw-demo-btns">
          ${creds.students.map((s, idx) => `<button type="button" class="hw-btn" data-demo-stu="${idx}">${esc(s.displayName)} (${esc(s.code)})</button>`).join('')}
          <button type="button" class="hw-btn" id="hw-demo-google">Try Google Student</button>
        </div>`;
      demoBox.querySelectorAll('[data-demo-stu]').forEach(btn => {
        btn.onclick = () => {
          const st = creds.students[Number(btn.dataset.demoStu)];
          if (!st) return;
          if (jcInput) jcInput.value = creds.joinCode;
          if (scInput) scInput.value = st.code;
          $('#hw-code-form')?.requestSubmit();
        };
      });
      const dg = $('#hw-demo-google');
      if (dg) {
        dg.onclick = () => {
          if (jcInput && !jcInput.value) jcInput.value = creds.joinCode;
          hwHandleGoogleSignIn();
        };
      }
      // "Demo what students see" link (?demo=1&auto=1): skip the sample sign-in and open the sample class straight away
      if (QS.get('auto') === '1' && !HW_STATE.autoDemoDone) {
        HW_STATE.autoDemoDone = true;
        document.body.classList.add('hw-auto-demo');
        demoBox.querySelector('[data-demo-stu]')?.click();
      }
    }
  }
}

async function hwEnterAuthenticated(sessionPayload) {
  HW_STATE.session = {
    authMethod: sessionPayload.authMethod || sessionPayload.student?.authMethod || '',
    student: sessionPayload.student,
    class: {
      acceptingSubmissions: true,
      ...(sessionPayload.class || {}),
    },
  };
  await hwRefreshTakes();
  await hwRefreshAssignments();
  hwRenderAssignmentList();
  hwSetView('list');
  hwRenderGoogleLinkOffer();
  if (!hwSyncIsDone() && !document.body.classList.contains('hw-auto-demo')) {   // the demo link skips the mic check
    hwOpenSyncModal(true, () => hwRetryQueuedUploads(true));
  } else {
    hwRetryQueuedUploads(true);
  }
}

async function hwHandleCodeSubmit(e) {
  e.preventDefault();
  hwShowAuthError('');
  const btn = $('#hw-code-submit');
  const joinCode = $('#hw-in-joincode')?.value || '';
  const studentCode = $('#hw-in-stucode')?.value || '';
  const name = $('#hw-in-stuname')?.value || '';
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  const res = await HW_API.loginWithCode({ joinCode, studentCode, name });
  if (btn) { btn.disabled = false; btn.textContent = 'Sign In with Code'; }

  if (!res.ok) {
    hwShowAuthError(res.error || 'Could not sign in. Check your codes and try again.');
    return;
  }
  await hwEnterAuthenticated(res);
}

async function hwHandleGoogleSignIn(chosenClassId = '', cachedIdToken = '') {
  hwShowAuthError('');
  const joinCode = ($('#hw-in-gjoin')?.value || $('#hw-in-joincode')?.value || '').trim();
  let idToken = cachedIdToken;

  if (!idToken) {
    if (HW_API.isDemoMode()) {
      idToken = 'dev-google:demo-alex|alex.rivera@school.edu|Alex Rivera';
    } else {
      const clientId = QS.get('googleClientId') || window.HW_GOOGLE_CLIENT_ID || '';
      const loaded = clientId ? await hwEnsureGsiLoaded() : false;
      if (!clientId || !loaded || !window.google?.accounts?.id) {
        hwShowAuthError('Google Sign-In is not configured on this link. Sign in with your Class Code & Student Code above.');
        return;
      }
      idToken = await new Promise(resolve => {
        let done = false;
        const finish = tok => { if (!done) { done = true; resolve(tok || ''); } };
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: resp => finish(resp?.credential || ''),
          });
          window.google.accounts.id.prompt(n => {
            if (n && (n.isNotDisplayed?.() || n.isSkippedMoment?.() || n.isDismissedMoment?.())) {
              finish('');
            }
          });
        } catch { finish(''); }
      });
      if (!idToken) {
        hwShowAuthError('Google Sign-In was canceled or unavailable.');
        return;
      }
    }
  }

  const gBtn = $('#hw-google-btn');
  if (gBtn) { gBtn.disabled = true; gBtn.textContent = 'Signing in with Google…'; }
  const res = await HW_API.loginWithGoogle({ idToken, joinCode, classId: chosenClassId });
  if (gBtn) { gBtn.disabled = false; gBtn.textContent = 'Sign in with Google'; }

  if (!res.ok) {
    // First Google sign-in: ask for the Class Code once, then reuse the same Google sign-in (no second popup).
    if (res.code === 'JOIN_CODE_REQUIRED' || res.code === 'CLASS_NOT_FOUND') {
      const box = $('#hw-google-join'), inp = $('#hw-in-gjoin'), go = $('#hw-google-join-go');
      if (box && inp && go) {
        box.hidden = false;
        if (res.code === 'CLASS_NOT_FOUND') hwShowAuthError(res.error);
        inp.focus();
        const submit = () => { if (inp.value.trim()) hwHandleGoogleSignIn('', idToken); };
        go.onclick = submit;
        inp.onkeydown = e => { if (e.key === 'Enter') submit(); };
        return;
      }
    }
    hwShowAuthError(res.error || 'Google Sign-In failed.');
    return;
  }
  const gj = $('#hw-google-join'); if (gj) gj.hidden = true;
  if (res.selectClass && Array.isArray(res.classes)) {
    const picker = $('#hw-google-classes');
    if (picker) {
      picker.hidden = false;
      picker.innerHTML = `<div class="small"><strong>Choose your class:</strong></div>` +
        res.classes.map(c => `<button type="button" class="hw-btn" data-gcls="${esc(c.classId)}">${esc(c.name)} (${esc(c.joinCode)})</button>`).join('');
      picker.querySelectorAll('[data-gcls]').forEach(b => {
        b.onclick = () => hwHandleGoogleSignIn(b.dataset.gcls, idToken);
      });
    }
    return;
  }
  await hwEnterAuthenticated(res);
}

async function hwSignOut() {
  hwCleanupMediaAndMic();
  const prevSid = HW_STATE.session?.student?.id;
  for (const url of HW_STATE.takeUrls.values()) { try { URL.revokeObjectURL(url); } catch { } }
  HW_STATE.takeUrls.clear();
  for (const url of HW_STATE.serverAudioUrls.values()) { try { URL.revokeObjectURL(url); } catch { } }
  HW_STATE.serverAudioUrls.clear();
  try {
    const allTakes = await hwIdbAll();
    for (const t of allTakes) {
      if (t.status === 'submitted' && (!prevSid || t.studentId === prevSid || t.studentId === 'local')) {
        await hwIdbDelete(t.id);
      }
    }
    HW_STATE.takes = await hwIdbAll();
  } catch { HW_STATE.takes = []; }
  try { sessionStorage.removeItem(HW_SYNC_SESSION_KEY); localStorage.removeItem(HW_SYNC_SESSION_KEY); } catch { }
  await HW_API.logout();
  HW_STATE.session = null;
  HW_STATE.assignments = [];
  HW_STATE.activeAssignment = null;
  HW_STATE.activeAttemptStart = null;
  HW_STATE.latestTakeId = null;
  HW_STATE.scoreLoadError = '';
  const sc = $('#hw-in-stucode'), sn = $('#hw-in-stuname');
  if (sc) sc.value = '';
  if (sn) sn.value = '';
  hwRenderAuthScreen();
  toast('Signed out.');
}

// ---------- My Assignments List
async function hwRefreshAssignments() {
  if (!HW_STATE.session) return;
  const res = await HW_API.listAssignments();
  if (res.ok && Array.isArray(res.assignments)) {
    HW_STATE.assignments = res.assignments;
  } else if (res.status === 401) {
    await hwSignOut();
  }
}

function hwRenderAssignmentList() {
  const head = $('#hw-list-head'), grid = $('#hw-asgn-grid');
  if (!head || !grid || !HW_STATE.session) return;
  const cls = HW_STATE.session.class || {};
  const readOnly = cls.acceptingSubmissions === false;

  head.innerHTML = `
    <div>
      <h2>${esc(cls.name || 'My Class')}</h2>
      ${cls.teacherName ? `<div class="hw-submeta">${esc(cls.teacherName)}</div>` : ''}
      ${readOnly ? `<div class="hw-auth-err" style="margin-top:8px">This class is currently not accepting new submissions. You can still review past scores.</div>` : ''}
    </div>`;

  hwRenderPracticeButtons();
  if (!HW_STATE.assignments.length) {
    grid.innerHTML = `<div class="hw-empty hw-empty-card">No homework right now.</div>`;
    return;
  }

  const queuedByAsgn = new Set(hwQueuedOfflineTakes().map(t => t.assignmentId));
  const localSubmittedByAsgn = new Map();
  for (const t of HW_STATE.takes) {
    if (t.status === 'submitted' && t.assignmentId) {
      localSubmittedByAsgn.set(t.assignmentId, (localSubmittedByAsgn.get(t.assignmentId) || 0) + 1);
    }
  }

  // One card per assignment, to-do first (soonest due first), done last. Only the next one due gets the
  // bright button, so "what do I do now?" is answered at a glance.
  const rows = HW_STATE.assignments.map((a, i) => {
    const best = a.bestSubmission || a.latestSubmission;
    const usedCount = Math.max(Number(a.attemptsUsed || 0), localSubmittedByAsgn.get(a.id) || 0);
    const remaining = a.maxAttempts != null ? Math.max(0, Number(a.maxAttempts) - usedCount) : a.attemptsRemaining;
    const exhausted = remaining != null && remaining <= 0;
    const queued = queuedByAsgn.has(a.id);
    return { a, i, best, usedCount, remaining, exhausted, queued, done: !!best || queued || exhausted };
  });
  const dueKey = r => (r.a.dueAt ? Number(r.a.dueAt) : Infinity);
  rows.sort((x, y) => (x.done - y.done) || (dueKey(x) - dueKey(y)) || (x.i - y.i));
  const nextId = rows.find(r => !r.done)?.a.id;

  grid.innerHTML = rows.map(({ a, best, usedCount, remaining, exhausted, queued }) => {
    const isTrueSr = a.type === 'sight' && a.mode === 'true_sight_read';
    const typeLabel = a.type === 'sight' ? 'Sight Reading' : a.type === 'score' ? 'Our Music' : 'Sing It';
    const isNext = a.id === nextId;

    let statusPill = `<span class="hw-pill draft">To do</span>`;
    if (queued) {
      statusPill = `<span class="hw-pill queued">Saved, sending…</span>`;
    } else if (best) {
      const shownPct = best.effectivePct != null ? best.effectivePct : best.overallPct;
      statusPill = `<span class="hw-pill score">Done ✓${shownPct != null ? ` ${shownPct}%` : ''}</span>`;
    }

    // only what changes what the student does: one try, or how many tries are left
    const triesTxt = isTrueSr && usedCount === 0 ? 'One try'
      : (a.maxAttempts != null && a.maxAttempts > 1 && !exhausted ? `${remaining} ${remaining === 1 ? 'try' : 'tries'} left` : '');
    const ctaLabel = exhausted ? 'View' : (best ? 'Try again' : (isNext ? 'Start →' : 'Open'));

    return `<article class="hw-asgn-card${isNext ? ' is-next' : ''}${best || exhausted ? ' is-done' : ''}" data-asgn="${esc(a.id)}">
      <div style="display:flex;flex-direction:column;gap:8px">
        <div class="hw-asgn-badges">
          <span class="hw-pill ${isTrueSr ? 'truesr' : 'type'}">${esc(typeLabel)}</span>
          ${statusPill}
        </div>
        <h3>${esc(a.title)}</h3>
        ${a.instructions ? `<p class="hw-asgn-desc">${esc(a.instructions)}</p>` : ''}
      </div>
      <div class="hw-asgn-foot">
        <div class="hw-asgn-meta">
          ${a.dueAt ? `<span>Due ${esc(hwFmtDue(a.dueAt))}</span>` : ''}
          ${triesTxt ? `<span class="${a.dueAt ? 'hw-meta-dot' : ''}">${esc(triesTxt)}</span>` : ''}
        </div>
        <button type="button" class="hw-btn ${isNext ? 'primary hw-btn-next' : ''}" data-open-asgn="${esc(a.id)}">${esc(ctaLabel)}</button>
      </div>
    </article>`;
  }).join('');

  grid.querySelectorAll('[data-open-asgn]').forEach(btn => {
    btn.onclick = () => hwOpenAssignment(btn.dataset.openAsgn);
  });
}

// ---------- Free practice (no assignment): big buttons under the assignments.
// Sight Reading runs entirely on the Chromebook: new exercises, Hear it, Tap/Sing it with the grade card,
// and nothing is saved or sent. Practice tracks are the scores a teacher shares for practice (sharing from
// the teacher side comes next; until then the page says none are shared yet).
function hwRenderPracticeButtons() {
  const box = $('#hw-practice');
  if (!box) return;
  box.innerHTML = `
    <button type="button" class="hw-practice-btn" id="hw-practice-sr">Sight reading</button>
    <button type="button" class="hw-practice-btn" id="hw-practice-tracks">Practice tracks</button>`;
  $('#hw-practice-sr').onclick = () => hwOpenFreePractice('rhythm');
  $('#hw-practice-tracks').onclick = () => hwOpenPracticeTracks();
}

function hwOpenPracticeTracks() {
  HW_STATE.freePractice = true;
  HW_STATE.activeAssignment = null;
  const takesCard = $('#hw-takes-card'); if (takesCard) takesCard.hidden = true;
  hwSetView('runner');
  hwRenderRunnerHeaderBar();
  const titleEl = $('#hw-back-title'); if (titleEl) titleEl.textContent = 'Practice tracks';
  const attEl = $('#hw-runner-attempts'); if (attEl) { attEl.className = 'hw-pill draft'; attEl.textContent = 'Just practice · not graded'; }
  const tracks = Array.isArray(HW_STATE.practiceTracks) ? HW_STATE.practiceTracks : [];
  $('#hw-runner-body').innerHTML = `<div class="hw-card"><div class="hw-empty" style="padding:48px 20px">${tracks.length ? '' : 'Your teacher hasn’t shared any practice tracks yet.'}</div></div>`;
}

// Free Sight Reading practice uses Sight Reading's own toolbar and Settings (minus teacher tools), starting
// from the student's last practice settings on this Chromebook. Each Sight Reading assignment in the class
// shows up as a "Teacher: …" preset, so the teacher's level is one click away.
const HW_FREE_SR_KEY = 'rehearsal-hw-practice-sr';

async function hwOpenFreePractice(kind) {
  HW_STATE.freePractice = true;
  HW_STATE.activeAssignment = null;
  HW_STATE.activeSubmissions = [];
  HW_STATE.activeAttemptStart = null;
  HW_STATE.latestTakeId = null;
  HW_STATE.srTrueMode = false;
  HW_STATE.tab = 'sight';
  const base = srDefaults();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(HW_FREE_SR_KEY) || 'null'); } catch { }
  const st = {
    ...base, ...(saved || {}),
    rhythm: { ...base.rhythm, ...(saved?.rhythm || {}) },
    solfege: { ...base.solfege, ...(saved?.solfege || {}) },
    ex: {}, settingsOpen: false,
  };
  if (st.mode !== 'rhythm' && st.mode !== 'solfege') st.mode = kind === 'solfege' ? 'solfege' : 'rhythm';
  HW_STATE.srState = st;
  // practice always grades at Standard (the sliders are hidden); assignments set their own when opened
  S.settings.gradeStrictRhythm = 25; S.settings.gradeStrictPitch = 25; S.settings.gradeStrictness = 25;
  const takesCard = $('#hw-takes-card'); if (takesCard) takesCard.hidden = true;
  hwSetView('runner');
  hwRenderRunnerHeaderBar();
  const titleEl = $('#hw-back-title'); if (titleEl) titleEl.textContent = 'Sight reading';
  const attEl = $('#hw-runner-attempts'); if (attEl) { attEl.className = 'hw-pill draft'; attEl.textContent = 'Just practice · not graded'; }
  hwMountFreeSight();
  if (await hwLoadTeacherSrPresets() && HW_STATE.freePractice && HW_STATE.srState === st && st.settingsOpen) hwMountFreeSight();
}

function hwMountFreeSight() {
  const body = $('#hw-runner-body'), st = HW_STATE.srState;
  if (!body || !st) return;
  body.classList.remove('hw-student-view', 'hw-teacher-mode');
  body.classList.add('hw-free');
  body.innerHTML = `<div class="hw-card"><div class="hw-stage hw-free-stage"><div class="sr-host" id="hw-sr-host"></div></div></div>`;
  const host = $('#hw-sr-host');
  HW_STATE.srHost = host;
  window.__spaceTarget = 'sr';
  hwSyncSpaceSuppression();
  let lastKey = '';
  mountSight(host, st, () => {
    // a new exercise or kind: the old grade card no longer matches the music
    const key = st.mode + '|' + JSON.stringify(st.ex?.[st.mode] || null).slice(0, 200);
    if (lastKey && key !== lastKey) document.getElementById('gr-card')?.remove();
    lastKey = key;
    try {
      const { ex, settingsOpen, ...keep } = st; void ex; void settingsOpen;
      localStorage.setItem(HW_FREE_SR_KEY, JSON.stringify(keep));
    } catch { }
  });
}

// One "Teacher: <title>" preset per Sight Reading assignment in this class (settings only, never the excerpt).
async function hwLoadTeacherSrPresets() {
  const list = (HW_STATE.assignments || []).filter(a => a.type === 'sight').slice(0, 6);
  if (!list.length || typeof srSavedPresets !== 'function' || typeof srPresetSnapshot !== 'function') return false;
  const presets = srSavedPresets();
  for (let i = presets.length - 1; i >= 0; i--) if (String(presets[i].id).startsWith('teacher-')) presets.splice(i, 1);
  for (const a of list) {
    const res = await HW_API.getAssignment(a.id).catch(() => null);
    const sr = res?.assignment?.config?.srState || res?.assignment?.config;
    if (!sr) continue;
    const mode = sr.mode === 'rhythm' ? 'rhythm' : (sr.mode === 'build' ? null : 'solfege');
    if (!mode || !sr[mode]) continue;
    presets.push({ id: 'teacher-' + a.id, name: `Teacher: ${String(a.title || 'Sight Reading').slice(0, 30)}`, mode, data: srPresetSnapshot(sr[mode], mode) });
  }
  return true;
}

function hwClosePreviewWindow() {
  try { window.close(); } catch { }
  setTimeout(() => {
    if (!window.closed) location.href = './';
  }, 120);
}

function hwRenderRunnerHeaderBar() {
  const a = HW_STATE.activeAssignment;
  const titleEl = $('#hw-back-title'), attEl = $('#hw-runner-attempts'),
    backBtn = $('#hw-back-list'), backBar = $('#hw-back-bar'),
    previewBanner = $('#hw-preview-banner'), previewMsg = $('#hw-preview-msg');

  if (backBar) backBar.hidden = false;
  if (backBtn) {
    backBtn.hidden = false;   // teachers in preview get a clear way back too
    const lbl = $('#hw-back-label');
    if (lbl) lbl.textContent = HW_STATE.previewMode ? 'Back to assignment setup' : 'All assignments';
  }
  // keep the sticky bar just under the page header, whatever height it wraps to
  const hdr = document.querySelector('.hw-header');
  if (hdr) document.documentElement.style.setProperty('--hw-hdr-h', hdr.offsetHeight + 'px');
  if (titleEl) titleEl.textContent = a ? a.title : 'Homework';

  if (previewBanner) {
    previewBanner.hidden = !HW_STATE.previewMode;
    if (HW_STATE.previewMode && previewMsg) {
      const clsName = HW_STATE.previewClass?.name ? ` (${HW_STATE.previewClass.name})` : '';
      const draftNote = a?.published === false ? ' · <strong>Draft</strong> (not published to students yet)' : '';
      previewMsg.innerHTML = `Testing <strong>${esc(a?.title || 'this assignment')}</strong>${esc(clsName)} as a student${draftNote} — takes stay local and are never saved to your Gradebook.`;
    }
  }

  if (attEl && a) {
    if (HW_STATE.previewMode) {
      attEl.className = 'hw-pill preview';
      attEl.textContent = 'Sandbox · Unlimited Test Tries';
      return;
    }
    const localSubs = hwCurrentTakesForAssignment().filter(t => t.status === 'submitted').length;
    const serverSubs = Array.isArray(HW_STATE.activeSubmissions) ? HW_STATE.activeSubmissions.length : 0;
    const used = Math.max(Number(a.attemptsUsed || 0), localSubs, serverSubs);
    if (a.maxAttempts != null) {
      const done = used >= Number(a.maxAttempts);
      attEl.className = `hw-pill ${done ? 'score' : 'draft'}`;
      attEl.textContent = `${used} of ${a.maxAttempts} attempt${a.maxAttempts === 1 ? '' : 's'} used`;
    } else {
      attEl.className = 'hw-pill draft';
      attEl.textContent = `${used} submitted · Unlimited attempts`;
    }
  }
}

// Sight Reading draws ex.rhythm as { rhythm: [measures] }. Rhythm assignments saved before 2026-11-23 stored the
// bare list, which left students a blank white box, so repair it as it loads.
function hwFixSrEx(ex) {
  if (ex && Array.isArray(ex.rhythm)) ex.rhythm = { rhythm: ex.rhythm };
  return ex;
}

async function hwPopulateRunnerFromAssignment(a, scoreLoader, submissions = []) {
  HW_STATE.freePractice = false;
  HW_STATE.activeAssignment = a;
  HW_STATE.activeSubmissions = Array.isArray(submissions) ? submissions : [];
  HW_STATE.activeAttemptStart = HW_STATE.previewMode ? null : (a.activeStart || null);
  HW_STATE.srTrueSubmitted = null;
  HW_STATE.scoreLoadError = '';
  HW_STATE.tab = a.type === 'score' ? 'score' : (a.type === 'audio' ? 'audio' : 'sight');

  const cfg = a.config || {};
  if (cfg.countingSystem) S.settings.rhythmSystem = cfg.countingSystem;
  const sr = cfg.strictness || { rhythm: 25, pitch: 25 };
  S.settings.gradeStrictRhythm = clamp(Number(sr.rhythm ?? 25), 0, 100);
  S.settings.gradeStrictPitch = clamp(Number(sr.pitch ?? 25), 0, 100);
  S.settings.gradeStrictness = Math.round((S.settings.gradeStrictRhythm + S.settings.gradeStrictPitch) / 2);

  if (HW_STATE.tab === 'sight') {
    const baseSr = srDefaults();
    const incomingSr = cfg.srState || cfg;
    const mode = incomingSr.mode === 'rhythm' ? 'rhythm' : (incomingSr.mode === 'build' ? 'build' : 'solfege');
    HW_STATE.srState = {
      ...baseSr,
      ...JSON.parse(JSON.stringify(incomingSr)),
      mode,
      rhythm: { ...baseSr.rhythm, ...(incomingSr.rhythm || {}) },
      solfege: { ...baseSr.solfege, ...(incomingSr.solfege || {}) },
      ex: incomingSr.ex ? JSON.parse(JSON.stringify(incomingSr.ex)) : {},
    };
    hwFixSrEx(HW_STATE.srState.ex);
    if (a.excerptLocked && !HW_STATE.previewMode) {
      HW_STATE.srState.ex = {};
    }
    HW_STATE.srTrueMode = a.mode === 'true_sight_read';
    HW_STATE.srStudySec = Number(cfg.studySeconds || 30);
  } else if (HW_STATE.tab === 'score') {
    const cacheKey = HW_STATE.previewMode ? `preview:${a.id}:${HW_STATE.previewToken}` : a.id;
    let fid = HW_STATE.scoreFileIds.get(cacheKey);
    if (!fid) {
      const dl = await scoreLoader();
      if (dl.ok && dl.blob) {
        fid = hwRegisterFile(dl.blob, dl.filename || a.scoreFilename || 'Score.musicxml');
        HW_STATE.scoreFileIds.set(cacheKey, fid);
      } else if (HW_API.isDemoMode() || String(HW_STATE.previewToken || '').startsWith('demo:')) {
        const sampleBlob = new Blob([HW_SAMPLE_MUSICXML], { type: 'application/xml' });
        fid = hwRegisterFile(sampleBlob, 'Sample Vocal Check-In.musicxml');
        HW_STATE.scoreFileIds.set(cacheKey, fid);
      } else {
        HW_STATE.scoreLoadError = dl.error || 'Could not download the score file for this assignment. Check your connection and try again.';
      }
    }
    HW_STATE.spFileId = fid || null;
    HW_STATE.spGradeMode = cfg.gradeMode || cfg.spState?.gradeMode || 'mic';
    if (HW_STATE.spGradeMode === 'rhythm') HW_STATE.spGradeMode = 'tap';   // older assignments: clapping is tapped now
    HW_STATE.spState = {
      ...(cfg.spState || {}),
      fileId: fid || null,
      name: a.title,
      gradeMode: HW_STATE.spGradeMode,
      layout: 'v',   // always "Down": a teacher's "Sideways" setting gave students one long line they couldn't scroll down or switch back
    };
  } else {
    HW_STATE.aud.countIn = cfg.countIn !== false;
    HW_STATE.aud.bpm = clamp(Number(cfg.bpm || 84), 40, 208);
    HW_STATE.aud.prompt = cfg.prompt || a.instructions || HW_STATE.aud.prompt;
  }

  const takesCard = $('#hw-takes-card');
  if (takesCard) takesCard.hidden = false;
  hwSetView('runner');
  hwRenderRunnerHeaderBar();
  document.querySelectorAll('.hw-tab').forEach(b => b.classList.toggle('on', b.dataset.hwTab === HW_STATE.tab));
  hwRenderTeacherOptions();
  hwRenderTakes();
  if (HW_STATE.tab === 'sight') hwMountSightRunner();
  else if (HW_STATE.tab === 'score') hwMountScoreRunner();
  else hwMountAudioRunner();
}

async function hwOpenAssignment(assignmentId) {
  const res = await HW_API.getAssignment(assignmentId);
  if (!res.ok || !res.assignment) {
    toast(res.error || 'Could not load assignment.');
    return;
  }
  await hwPopulateRunnerFromAssignment(
    res.assignment,
    () => HW_API.downloadScoreBlob(res.assignment.id),
    res.submissions
  );
}

async function hwOpenPreview(previewToken) {
  HW_STATE.previewMode = true;
  HW_STATE.previewToken = String(previewToken || '').trim();
  HW_STATE.previewRevealed = false;
  HW_STATE.latestTakeId = null;

  const res = await HW_API.getPreviewAssignment(HW_STATE.previewToken);
  if (!res.ok || !res.assignment) {
    HW_STATE.activeAssignment = null;
    HW_STATE.previewClass = null;
    hwSetView('runner');
    const previewBanner = $('#hw-preview-banner');
    const backBar = $('#hw-back-bar');
    const takesCard = $('#hw-takes-card');
    const body = $('#hw-runner-body');
    if (previewBanner) previewBanner.hidden = true;
    if (backBar) backBar.hidden = true;
    if (takesCard) takesCard.hidden = true;
    if (body) {
      body.innerHTML = `
        <div class="hw-card">
          <div class="hw-card-head">
            <div>
              <h2>Preview Link Unavailable</h2>
              <div class="hw-submeta">Teacher Preview Sandbox</div>
            </div>
          </div>
          <div class="hw-audio-body">
            <div class="hw-auth-err" role="alert">${esc(res.error || 'This preview link has expired or is no longer available. Open a fresh preview from Rehearsal.')}</div>
            <div class="row">
              <button type="button" class="hw-btn primary" id="hw-preview-err-close">Close Preview</button>
            </div>
          </div>
        </div>`;
      const cbtn = $('#hw-preview-err-close');
      if (cbtn) cbtn.onclick = hwClosePreviewWindow;
    }
    return;
  }

  HW_STATE.previewClass = res.class || null;
  await hwRefreshTakes();
  await hwPopulateRunnerFromAssignment(
    res.assignment,
    () => HW_API.downloadPreviewScoreBlob(HW_STATE.previewToken),
    []
  );
}

// ---------- Teacher Setup drawer (Local Preview Mode only)
function hwSyncTeacherEditsToDemo() {
  if (!HW_API.isDemoMode() || !HW_STATE.activeAssignment) return;
  const a = HW_STATE.activeAssignment;
  if (HW_STATE.tab === 'sight' && HW_STATE.srState) {
    a.type = 'sight';
    a.mode = HW_STATE.srTrueMode ? 'true_sight_read' : 'practice';
    a.config = {
      ...(a.config || {}),
      studySeconds: HW_STATE.srStudySec,
      countingSystem: S.settings.rhythmSystem || 'numbers',
      strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 25, pitch: 25 },
      srState: JSON.parse(JSON.stringify(HW_STATE.srState)),
    };
  } else if (HW_STATE.tab === 'score' && HW_STATE.spState) {
    a.type = 'score';
    a.mode = 'practice';
    a.config = {
      ...(a.config || {}),
      gradeMode: HW_STATE.spGradeMode,
      countingSystem: S.settings.rhythmSystem || 'numbers',
      strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 25, pitch: 25 },
      spState: JSON.parse(JSON.stringify(HW_STATE.spState)),
    };
  } else if (HW_STATE.tab === 'audio') {
    a.type = 'audio';
    a.mode = 'practice';
    a.config = {
      ...(a.config || {}),
      countIn: HW_STATE.aud.countIn,
      bpm: HW_STATE.aud.bpm,
      prompt: HW_STATE.aud.prompt,
      strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 25, pitch: 25 },
    };
  }
  HW_API.upsertDemoAssignment(a);
}

function hwRenderTeacherOptions() {
  const box = $('#hw-teacher-opts');
  if (!box) return;
  const rhySystems = typeof RHYTHM_SYSTEMS !== 'undefined'
    ? RHYTHM_SYSTEMS
    : [['numbers', 'Numbers (1 e & a)'], ['kodaly', 'Kodály (ta / ti-ti)'], ['takadimi', 'Takadimi (ta / ta-di)']];

  if (HW_STATE.tab === 'sight') {
    const st = HW_STATE.srState || (HW_STATE.srState = srDefaults());
    const curMode = st.mode === 'rhythm' ? 'rhythm' : 'solfege';
    const o = st[curMode] || st.solfege;
    const countsOn = !!(o.showCounts ?? st.showCounts);
    const presets = typeof srSavedPresets === 'function' ? srSavedPresets() : [];
    box.innerHTML = `
      <label>Assign Preset:
        <select id="hw-t-preset" ${presets.length ? '' : 'title="Save presets in Sight Reading ⚙ Settings below or in the main Rehearsal app — they carry over automatically"'}>
          <option value="">${presets.length ? '— Pick a saved preset —' : 'No saved presets yet (save one in ⚙ below)'}</option>
          ${presets.map(p => `<option value="${esc(p.id || p.name)}">${esc(p.name)} (${p.mode === 'rhythm' ? 'Rhythm' : 'Solfege'})</option>`).join('')}
        </select>
      </label>
      <label>Assignment mode:
        <select id="hw-t-srmode">
          <option value="true" ${HW_STATE.srTrueMode ? 'selected' : ''}>True Sight-Read (study timer + auto-submit)</option>
          <option value="practice" ${!HW_STATE.srTrueMode ? 'selected' : ''}>Practice Mode (rehearse + student clicks Submit)</option>
        </select>
      </label>
      ${HW_STATE.srTrueMode ? `<label>Study timer:
        <select id="hw-t-srsec">
          ${[15, 30, 45, 60].map(s => `<option value="${s}" ${HW_STATE.srStudySec === s ? 'selected' : ''}>${s}s</option>`).join('')}
        </select>
      </label>` : ''}
      ${curMode === 'solfege' ? `<label><input type="checkbox" id="hw-t-showsol" ${st.show ? 'checked' : ''}> Show Solfege to students</label>` : ''}
      <label><input type="checkbox" id="hw-t-showcnt" ${countsOn ? 'checked' : ''}> Show Counting to students</label>
      <label>Counting system:
        <select id="hw-t-rhysys">
          ${rhySystems.map(([v, l]) => `<option value="${v}" ${(S.settings.rhythmSystem || 'numbers') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </label>
      <div style="width:100%;padding-top:4px">${typeof grStrictnessSlider === 'function' ? grStrictnessSlider(o.tempo || 80) : ''}</div>
      <div class="small muted" style="width:100%">Full Rehearsal Sight Reading toolbar &amp; Settings are open below — configure key, clef, range, leaps, rhythms, presets, or Build your own excerpt, then click <strong>Preview Assignment as Student →</strong>.</div>`;

    const presetSel = $('#hw-t-preset');
    if (presetSel) {
      presetSel.onchange = e => {
        const val = e.target.value;
        if (!val) return;
        const p = presets.find(x => (x.id || x.name) === val);
        if (!p || !p.data) return;
        const pm = p.mode === 'rhythm' ? 'rhythm' : 'solfege';
        st.mode = pm;
        Object.assign(st[pm], JSON.parse(JSON.stringify(p.data)));
        st.ex[pm] = pm === 'rhythm'
          ? { rhythm: srGenRhythm(st.rhythm.ts, st.rhythm.measures, st.rhythm.cells, st.rhythm.ties) }
          : srGenParts(st.solfege);
        hwRenderTeacherOptions();
        hwMountSightRunner();
        toast(`Applied preset: ${p.name}`);
      };
    }
    $('#hw-t-srmode').onchange = e => { HW_STATE.srTrueMode = e.target.value === 'true'; HW_STATE.srTrueSubmitted = null; hwRenderTeacherOptions(); hwMountSightRunner(); };
    if ($('#hw-t-srsec')) $('#hw-t-srsec').onchange = e => { HW_STATE.srStudySec = Number(e.target.value) || 30; hwMountSightRunner(); };
    if ($('#hw-t-showsol')) $('#hw-t-showsol').onchange = e => { st.show = e.target.checked; hwMountSightRunner(); };
    $('#hw-t-showcnt').onchange = e => {
      st.showCounts = e.target.checked;
      if (st[st.mode]) st[st.mode].showCounts = e.target.checked;
      hwMountSightRunner();
    };
    $('#hw-t-rhysys').onchange = e => { S.settings.rhythmSystem = e.target.value; save(); hwMountSightRunner(); };
  } else if (HW_STATE.tab === 'score') {
    const st = HW_STATE.spState || {};
    box.innerHTML = `
      <label>Grading method:
        <select id="hw-t-spmode">
          <option value="mic" ${HW_STATE.spGradeMode === 'mic' ? 'selected' : ''}>Microphone (Pitch + Rhythm)</option>
          <option value="tap" ${HW_STATE.spGradeMode === 'tap' ? 'selected' : ''}>Spacebar / Tap (Rhythm Only)</option>
        </select>
      </label>
      <label><input type="checkbox" id="hw-t-spsol" ${st.solfege ? 'checked' : ''}> Show Solfege to students</label>
      <label><input type="checkbox" id="hw-t-spcnt" ${st.counts ? 'checked' : ''}> Show Counting to students</label>
      <label>Counting system:
        <select id="hw-t-sprhysys">
          ${rhySystems.map(([v, l]) => `<option value="${v}" ${(S.settings.rhythmSystem || 'numbers') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="hw-btn" id="hw-t-sppick">Load .mxl / .musicxml File…</button>
      <button type="button" class="hw-btn" id="hw-t-spsample">Reset to Sample Score</button>
      <div style="width:100%;padding-top:4px">${typeof grStrictnessSlider === 'function' ? grStrictnessSlider(st.tempo || 80) : ''}</div>
      <div class="small muted" style="width:100%">Full Rehearsal Score Practice controls &amp; Settings are open below — pick focus voice, measure selection, tempo, or solfege/counts, then click <strong>Preview Assignment as Student →</strong>.</div>`;

    $('#hw-t-spmode').onchange = e => { HW_STATE.spGradeMode = e.target.value; if (HW_STATE.spState) HW_STATE.spState.gradeMode = HW_STATE.spGradeMode; hwMountScoreRunner(); };
    $('#hw-t-spsol').onchange = e => { if (HW_STATE.spState) HW_STATE.spState.solfege = e.target.checked; hwMountScoreRunner(); };
    $('#hw-t-spcnt').onchange = e => { if (HW_STATE.spState) HW_STATE.spState.counts = e.target.checked; hwMountScoreRunner(); };
    $('#hw-t-sprhysys').onchange = e => { S.settings.rhythmSystem = e.target.value; hwMountScoreRunner(); };
    $('#hw-t-sppick').onclick = async () => {
      const fs = await pickFile('.mxl,.musicxml,.xml', false);
      if (!fs.length) return;
      const f = fs[0], id = await storeFile(f);
      HW_STATE.spState = { fileId: id, name: f.name.replace(/\.(mxl|musicxml|xml)$/i, ''), gradeMode: HW_STATE.spGradeMode };
      hwMountScoreRunner(); toast(`Loaded ${f.name}`);
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

// ---------- Sight Reading Runner (Student View + Full Teacher Setup View)
function hwStopStudyTimer() {
  if (HW_STATE.srStudyTimer) { clearInterval(HW_STATE.srStudyTimer); HW_STATE.srStudyTimer = null; }
  HW_STATE.srStudying = false;
  hwSyncSpaceSuppression();
}

function hwSightEffectiveKind(st) {
  if (st.mode === 'build') return st.build?.kind === 'rhythm' ? 'rhythm' : 'solfege';
  if (st.mode === 'solfege' && st.solRhythm) return 'rhythm';
  return st.mode === 'rhythm' ? 'rhythm' : 'solfege';
}

function hwSightViewState(st) {
  const o = st[st.mode] || {};
  const showCounts = o.showCounts != null ? !!o.showCounts : !!st.showCounts;
  if (st.mode === 'build' && typeof srBuildView === 'function') {
    const bv = srBuildView(st);
    bv.showCounts = showCounts;
    bv.show = !!st.show;
    return bv;
  }
  if (st.mode === 'solfege' && st.solRhythm && st.ex?.solfege) {
    return {
      mode: 'rhythm', show: !!st.show, showCounts, playhead: st.playhead ?? 'beat', startM: st.startM || 0,
      rhythm: st.solfege, ex: { rhythm: { rhythm: (st.ex.solfege.parts?.[0] || st.ex.solfege).rhythm } },
    };
  }
  return { ...st, showCounts, playhead: st.playhead ?? 'beat' };
}

function hwStartSightGradingDirect(host, st, actionBtn, inputMode) {
  if (typeof grStart !== 'function') return toast('Grading engine not loaded.');
  const tl = host?.__timeline;
  if (!tl || !tl.length) return toast('Notation is still loading — try again.');
  grStart(host, hwSightViewState(st), tl, actionBtn, inputMode);
}

function hwMountSightRunner() {
  hwStopStudyTimer();
  hwSyncRunnerViewClass();
  const body = $('#hw-runner-body');
  if (!HW_STATE.srState) {
    HW_STATE.srState = srDefaults();
    HW_STATE.srState.mode = 'solfege';
  }
  const st = HW_STATE.srState;
  st.settingsOpen = HW_STATE.teacherOpen;

  const effKind = hwSightEffectiveKind(st);
  const isPitch = effKind === 'solfege';
  const autoInput = isPitch ? 'mic' : 'tap';
  const trueMode = HW_STATE.srTrueMode && !HW_STATE.teacherOpen;
  const o = st.mode === 'build' ? (st.build || st.solfege) : (st[st.mode] || st.solfege);
  const tempoNow = o.tempo || 80;
  const strictSpec = typeof grStrictnessSpec === 'function' ? grStrictnessSpec(null, tempoNow) : null;
  const pitchInfo = isPitch ? hwSightPitchInfo(st) : null;
  const metaDesc = isPitch
    ? `${(o.key || 'C').replace('b', '♭')} ${o.scale || 'major'} · ${o.clef === 'bass' ? 'Bass' : 'Treble'} clef · ${o.ts || '4/4'} · ${tempoNow} BPM · Microphone (Pitch + Rhythm)`
    : `Rhythm only · ${o.ts || '4/4'} · ${tempoNow} BPM · Spacebar / Touch Tap`;
  const strictDesc = strictSpec
    ? `Rhythm: ${strictSpec.rhythmLabel} (±${strictSpec.rhythmMs} ms)${isPitch ? ` · Pitch: ${strictSpec.pitchLabel} (±${strictSpec.pitchCents}¢)` : ''}`
    : '';

  const asgn = HW_STATE.activeAssignment;
  const canSub = hwCanSubmitActive();
  const lockedByLimit = !canSub && !HW_STATE.teacherOpen && !HW_STATE.previewMode;
  const excerptLocked = HW_STATE.previewMode
    ? (trueMode && !HW_STATE.previewRevealed)
    : (!!asgn?.excerptLocked && !HW_STATE.activeAttemptStart && trueMode);
  const exhaustedMsg = HW_STATE.session?.class?.acceptingSubmissions === false
    ? 'This class is not accepting new submissions right now.'
    : 'You have already submitted all allowed attempts for this assignment.';

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        ${HW_STATE.teacherOpen ? `<div>
          <h2>Configure Sight-Reading Assignment (All Rehearsal Options)</h2>
          <div class="hw-submeta">${esc(metaDesc)}${strictDesc ? ` · ${esc(strictDesc)}` : ''}</div>
        </div>` : hwStudentInstr(asgn)}
        ${!HW_STATE.teacherOpen ? `<div class="hw-controls">
          <span class="hw-zoom-pill" title="Adjust sheet music size">
            <button type="button" id="hw-sr-zout">−</button>
            <button type="button" id="hw-sr-zreset">${Math.round((st.zoom || 1) * 100)}%</button>
            <button type="button" id="hw-sr-zin">+</button>
          </span>
        </div>` : ''}
      </div>

      <div id="hw-latest-banner"></div>

      ${!HW_STATE.teacherOpen ? (trueMode ? `
        <div class="hw-study-bar" id="hw-study-bar" hidden>
          <div class="hw-study-left">
            <span class="hw-study-timer" id="hw-study-timer">${hwFmtTime(HW_STATE.srStudySec)}</span>
            <span id="hw-study-msg"><strong>Study silently!</strong> ${isPitch ? 'Recording starts automatically on your mic at 0:00 and auto-submits when done.' : 'Spacebar / Tap rhythm grading starts automatically at 0:00 and auto-submits when done.'}</span>
          </div>
          <div class="hw-study-pitches" id="hw-study-pitches">
            ${isPitch ? `
              <button type="button" class="hw-btn pitch" id="hw-pitch-start">Starting Pitch (${esc(pitchInfo.startSyl)} · ${esc(pitchInfo.startName)})</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-chord">Tonic Chord</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-scale">Scale</button>
            ` : `
              <button type="button" class="hw-btn pitch" id="hw-tempo-pulse">Hear Tempo (${tempoNow} BPM)</button>
            `}
            <button type="button" class="hw-btn danger" id="hw-study-now">${isPitch ? 'Start Recording Now' : 'Start Tapping Now'}</button>
          </div>
        </div>
      ` : `
        <div class="hw-student-bar">
          <div class="hw-student-actions">
            <span class="hw-step">1</span>
            <button type="button" class="hw-btn" id="hw-sr-hear">Hear it</button>
            ${isPitch ? `
              <button type="button" class="hw-btn pitch" id="hw-pitch-start" title="${esc(pitchInfo.startSyl)} · ${esc(pitchInfo.startName)}">Starting pitch</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-chord">Chord</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-scale">Scale</button>
            ` : `
              <button type="button" class="hw-btn pitch" id="hw-tempo-pulse" title="${tempoNow} beats per minute">Hear the beat</button>
            `}
          </div>
          <div class="hw-student-actions">
            ${lockedByLimit
              ? `<span class="hw-pill score">✓ ${esc(exhaustedMsg)}</span>`
              : `<span class="hw-step">2</span><button type="button" class="hw-btn primary hw-btn-go" id="hw-sr-record">${isPitch ? '● Sing it' : 'Tap it'}</button>`}
          </div>
        </div>
      `) : ''}

      <div class="hw-stage" id="hw-sr-stage">
        <div class="sr-host" id="hw-sr-host"></div>
        ${trueMode && !lockedByLimit ? `
          <div class="hw-study-cover" id="hw-study-cover">
            <h3>Ready for your ${HW_STATE.srStudySec}-Second True Sight-Read?</h3>
            <p>
              When you press start, your excerpt will appear for <strong>${HW_STATE.srStudySec} seconds</strong>.
              ${isPitch
                ? 'During study time you can hear your <strong>Starting Pitch, Tonic Chord, and Scale</strong>. At 0:00, your <strong>microphone will count in, record, and automatically submit</strong> your take.'
                : 'During study time you can hear the <strong>tempo pulse</strong>. At 0:00, <strong>Spacebar / Tap rhythm grading will start and automatically submit</strong> your take.'}
              ${HW_STATE.previewMode ? '<br><span class="small muted">Preview Sandbox: nothing is submitted to your Gradebook and you can click Reset Preview anytime.</span>' : ''}
            </p>
            <button type="button" class="hw-btn primary" id="hw-study-begin" style="padding:11px 20px;font-size:15px">
              Reveal Excerpt &amp; Start ${HW_STATE.srStudySec}s Study Timer
            </button>
          </div>
        ` : (trueMode && lockedByLimit ? `
          <div class="hw-submit-banner" style="position:relative;z-index:26">
            <span><strong>✓ Completed:</strong> ${esc(exhaustedMsg)}</span>
          </div>
        ` : '')}
      </div>
    </div>`;

  const host = $('#hw-sr-host');
  HW_STATE.srHost = host;
  window.__spaceTarget = 'sr';
  hwSyncSpaceSuppression();

  // True Sight-Read security: when excerptLocked is true, keep the real notation empty behind the cover!
  if (!excerptLocked || HW_STATE.teacherOpen) {
    mountSight(host, st, () => {
      if (HW_STATE.teacherOpen) hwRenderTeacherOptions();
    });
  } else {
    host.innerHTML = `<div class="hw-empty" style="padding-top:160px">Excerpt hidden until you click Reveal Excerpt.</div>`;
  }
  hwRenderLatestBanner();

  if (HW_STATE.teacherOpen) return;

  const updateZoomLabel = () => {
    const zEl = $('#hw-sr-zreset');
    if (zEl) zEl.textContent = `${Math.round((st.zoom || 1) * 100)}%`;
  };
  $('#hw-sr-zout').onclick = () => { host.__zoomBy?.(0.9); updateZoomLabel(); };
  $('#hw-sr-zin').onclick = () => { host.__zoomBy?.(1.1); updateZoomLabel(); };
  $('#hw-sr-zreset').onclick = () => { host.__zoomReset?.(); updateZoomLabel(); };

  if ($('#hw-pitch-start')) $('#hw-pitch-start').onclick = () => hwPlayStartingPitch(st);
  if ($('#hw-pitch-chord')) $('#hw-pitch-chord').onclick = () => hwPlayTonicChord(st);
  if ($('#hw-pitch-scale')) $('#hw-pitch-scale').onclick = () => hwPlayScale(st);
  if ($('#hw-tempo-pulse')) $('#hw-tempo-pulse').onclick = () => hwPlayTempoPulse(tempoNow);

  if ($('#hw-sr-hear')) $('#hw-sr-hear').onclick = () => host.querySelector('[data-sr="play"]')?.click();
  if ($('#hw-sr-record')) {
    const recBtn = $('#hw-sr-record');
    recBtn.onclick = () => hwStartSightGradingDirect(host, st, recBtn, autoInput);
  }

  const beginBtn = $('#hw-study-begin');
  if (beginBtn) {
    beginBtn.onclick = async () => {
      beginBtn.disabled = true;
      beginBtn.textContent = isPitch ? 'Checking microphone & unlocking…' : 'Unlocking excerpt…';
      try {
        await ac().resume();
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

      let studyLeft = HW_STATE.srStudySec;
      if (HW_STATE.previewMode) {
        HW_STATE.previewRevealed = true;
      } else if (asgn && HW_STATE.session) {
        const startRes = await HW_API.startAttempt(asgn.id);
        if (!startRes.ok) {
          beginBtn.disabled = false;
          beginBtn.textContent = `Reveal Excerpt & Start ${HW_STATE.srStudySec}s Study Timer`;
          toast(startRes.error || 'Could not start assignment right now.');
          return;
        }
        HW_STATE.activeAttemptStart = startRes.attemptStart;
        if (asgn) asgn.excerptLocked = false;
        const unlockedSr = startRes.config?.srState || startRes.config;
        if (unlockedSr) {
          if (unlockedSr.ex && Object.keys(unlockedSr.ex).length) st.ex = hwFixSrEx(JSON.parse(JSON.stringify(unlockedSr.ex)));
          if (unlockedSr.build?.notes) st.build = JSON.parse(JSON.stringify(unlockedSr.build));
        }
        if (startRes.resumed && startRes.attemptStart?.startedAt) {
          const elapsedSec = Math.floor((Date.now() - startRes.attemptStart.startedAt) / 1000);
          studyLeft = Math.max(1, (startRes.attemptStart.studySeconds || HW_STATE.srStudySec) - elapsedSec);
        } else if (startRes.attemptStart?.studySeconds) {
          studyLeft = startRes.attemptStart.studySeconds;
        }
      }

      if (st.mode !== 'build' && !st.ex?.[st.mode]) {
        st.ex[st.mode] = st.mode === 'rhythm'
          ? { rhythm: srGenRhythm(o.ts, o.measures, o.cells, o.ties) }
          : srGenParts(o);
      }
      mountSight(host, st, () => { });

      if (isPitch) {
        const freshInfo = hwSightPitchInfo(st);
        const pBtn = $('#hw-pitch-start');
        if (pBtn) pBtn.textContent = `Starting Pitch (${freshInfo.startSyl} · ${freshInfo.startName})`;
        hwPlayTonicChord(st);
      }

      $('#hw-study-cover')?.remove();
      const barEl = $('#hw-study-bar'), timerEl = $('#hw-study-timer'), msgEl = $('#hw-study-msg'), nowBtn = $('#hw-study-now');
      if (barEl) barEl.hidden = false;

      HW_STATE.srStudyLeft = studyLeft;
      HW_STATE.srStudying = true;
      hwSyncSpaceSuppression();
      if (timerEl) timerEl.textContent = hwFmtTime(HW_STATE.srStudyLeft);

      const triggerAutoGrade = () => {
        if (!HW_STATE.srStudying) return;
        hwStopStudyTimer();
        hwSyncSpaceSuppression();
        if (barEl) barEl.classList.add('live');
        if (timerEl) timerEl.textContent = 'LIVE';
        if (msgEl) {
          msgEl.innerHTML = isPitch
            ? '<strong>Recording live!</strong> Sing after the count-in — your take will auto-submit when finished.'
            : '<strong>Tap live!</strong> Press <strong>Space</strong> (or tap the screen) after the count-in — auto-submits when finished.';
        }
        const pWrap = $('#hw-study-pitches');
        if (pWrap) {
          pWrap.innerHTML = `<button type="button" class="hw-btn danger" id="hw-study-stop">Finish &amp; Auto-Submit</button>`;
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

// Student view: the title is already in the bar above, so the card opens with the teacher's own instructions
// (one short line) instead of repeating the title and listing settings.
function hwStudentInstr(asgn) {
  const txt = String(asgn?.instructions || '').trim();
  return txt ? `<p class="hw-instr">${esc(txt)}</p>` : '<div></div>';
}

// ---------- Score Practice Runner (Student View + Full Teacher Setup View)
function hwMountScoreRunner() {
  hwStopStudyTimer();
  hwSyncRunnerViewClass();
  const body = $('#hw-runner-body');
  if (HW_STATE.scoreLoadError && !HW_STATE.teacherOpen && HW_STATE.activeAssignment) {
    body.innerHTML = `
      <div class="hw-card">
        <div class="hw-card-head">
          <div>
            <h2>${esc(HW_STATE.activeAssignment.title || 'Score Practice')}</h2>
            <div class="hw-submeta">Score Download Issue</div>
          </div>
        </div>
        <div class="hw-audio-body">
          <div class="hw-auth-err" role="alert">${esc(HW_STATE.scoreLoadError)}</div>
          <div class="row">
            <button type="button" class="hw-btn primary" id="hw-sp-retry-dl">Retry Download</button>
          </div>
        </div>
      </div>`;
    const rbtn = $('#hw-sp-retry-dl');
    if (rbtn) {
      rbtn.onclick = () => HW_STATE.previewMode
        ? hwOpenPreview(HW_STATE.previewToken)
        : hwOpenAssignment(HW_STATE.activeAssignment.id);
    }
    hwRenderLatestBanner();
    return;
  }
  if (!HW_STATE.spFileId && (HW_API.isDemoMode() || HW_STATE.teacherOpen)) {
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
  if (!HW_STATE.teacherOpen && HW_STATE.spState.voicesOpen === undefined) HW_STATE.spState.voicesOpen = true;   // every part's on/off, volume, Solo in view
  const tempoNow = HW_STATE.spState.tempo || 84;
  const strictSpec = typeof grStrictnessSpec === 'function' ? grStrictnessSpec(null, tempoNow) : null;
  const modeLabel = HW_STATE.spGradeMode === 'tap'
    ? 'Spacebar / Tap (Rhythm Only)'
    : HW_STATE.spGradeMode === 'rhythm'
      ? 'Microphone (Rhythm Only)'
      : 'Microphone (Pitch + Rhythm)';
  const strictDesc = strictSpec
    ? ` · Rhythm: ${strictSpec.rhythmLabel} (±${strictSpec.rhythmMs} ms)${HW_STATE.spGradeMode === 'mic' ? ` · Pitch: ${strictSpec.pitchLabel} (±${strictSpec.pitchCents}¢)` : ''}`
    : '';
  const canSub = hwCanSubmitActive();

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        ${HW_STATE.teacherOpen ? `<div>
          <h2>Configure Score Practice Assignment (All Rehearsal Options)</h2>
          <div class="hw-submeta">${esc(modeLabel)}${esc(strictDesc)}</div>
        </div>` : hwStudentInstr(HW_STATE.activeAssignment)}
        ${!HW_STATE.teacherOpen ? `<div class="hw-controls">
          <span class="hw-zoom-pill">
            <button type="button" id="hw-sp-zout">−</button>
            <button type="button" id="hw-sp-zreset">${Math.round((HW_STATE.spState.zoom || 0.8) * 100)}%</button>
            <button type="button" id="hw-sp-zin">+</button>
          </span>
        </div>` : ''}
      </div>

      <div id="hw-latest-banner"></div>

      ${!HW_STATE.teacherOpen ? `<div class="hw-student-bar">
        <div class="hw-student-actions">
          <span class="hw-step">1</span>
          <label class="hw-part-lbl">My part
            <select id="hw-sp-part" class="hw-part-select"></select>
          </label>
          <button type="button" class="hw-btn pitch" id="hw-sp-pitch">Starting pitch</button>
        </div>
        <div class="hw-student-actions">
          ${canSub
            ? `<span class="hw-step">2</span><button type="button" class="hw-btn primary hw-btn-go" id="hw-sp-grade">${HW_STATE.spGradeMode === 'tap' ? 'Tap it' : '● Sing it'}</button>`
            : `<span class="hw-pill score">✓ All tries used</span>`}
        </div>
      </div>` : ''}

      <div class="hw-stage hw-stage-score">
        <div class="score-host" id="hw-sp-host"></div>
      </div>
    </div>`;

  const host = $('#hw-sp-host');
  HW_STATE.spHost = host;
  window.__spaceTarget = 'sp';
  const ctl = mountScore(host, HW_STATE.spState, () => { }, 'hw-sp-' + HW_STATE.spState.fileId);
  HW_STATE.spCtl = ctl;
  hwRenderLatestBanner();

  if (HW_STATE.teacherOpen) return;

  const populateParts = () => {
    const sel = $('#hw-sp-part');
    if (!sel || !ctl?.sc?.lines?.length) return false;
    sel.innerHTML = ctl.sc.lines.map((l, i) => `<option value="${i}" ${(HW_STATE.spState.focus ?? 0) === i ? 'selected' : ''}>${esc(l.name || `Part ${i + 1}`)}</option>`).join('');
    sel.onchange = () => { HW_STATE.spState.focus = Number(sel.value); ctl.updateBar?.(); };
    return true;
  };
  let tries = 0;
  const partPoll = setInterval(() => { if (populateParts() || ++tries > 40) clearInterval(partPoll); }, 150);

  const setSpZoom = next => {
    HW_STATE.spState.zoom = clamp(Math.round(next * 100) / 100, 0.4, 2.2);
    if (ctl.osmd) { ctl.osmd.zoom = HW_STATE.spState.zoom; ctl.lastW = 0; ctl.relayout(); }
    const zEl = $('#hw-sp-zreset'); if (zEl) zEl.textContent = `${Math.round(HW_STATE.spState.zoom * 100)}%`;
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
  const gBtn = $('#hw-sp-grade');
  if (gBtn) gBtn.onclick = () => spGradeStart(ctl, gBtn, HW_STATE.spGradeMode);
}

// ---------- Audio-Only Recorder Runner
function hwCleanupAudioOnly() {
  const a = HW_STATE.aud;
  if (a.raf) { cancelAnimationFrame(a.raf); a.raf = 0; }
  if (a.timer) { clearInterval(a.timer); a.timer = null; }
  try { a.pcmNode?.disconnect(); a.srcNode?.disconnect(); } catch { }
  if (a.stream) { a.stream.getTracks().forEach(t => t.stop()); a.stream = null; }
  a.pcmNode = null; a.srcNode = null; a.analyser = null; a.mr = null; a.recording = false;
}

function hwMountAudioRunner() {
  hwStopStudyTimer();
  hwSyncRunnerViewClass();
  const body = $('#hw-runner-body'), a = HW_STATE.aud, mime = hwPickAudioMime();
  const canSub = hwCanSubmitActive();

  body.innerHTML = `
    <div class="hw-card">
      <div id="hw-latest-banner"></div>
      <div class="hw-audio-body">
        <div class="hw-audio-prompt">${esc(a.prompt)}</div>
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
          <button class="hw-btn danger" id="hw-aud-rec" ${canSub || a.recording ? '' : 'disabled'}>${a.recording ? 'Stop & Save Practice Take' : (canSub ? 'Start Recording' : 'Attempt Limit Reached')}</button>
          <span class="muted small" id="hw-aud-status">Ready. Takes save immediately on this device before submitting.</span>
        </div>
      </div>
    </div>`;

  hwRenderLatestBanner();
  const recBtn = $('#hw-aud-rec');
  if (recBtn) recBtn.onclick = () => { if (a.recording) hwStopAudioOnly(); else hwStartAudioOnly(); };
}

async function hwStartAudioOnly() {
  const a = HW_STATE.aud;
  const btn = $('#hw-aud-rec'), statusEl = $('#hw-aud-status'), timeEl = $('#hw-aud-time'), lvlEl = $('#hw-aud-lvl'), canvas = $('#hw-aud-canvas');
  if (a.recording) return;
  try {
    const c = ac(); await c.resume();
    if (statusEl) statusEl.textContent = 'Requesting microphone…';
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    a.stream = stream; a.recording = true; a.chunks = []; a.pcmChunks = []; a.pcmSr = c.sampleRate || 44100;
    if (btn) btn.textContent = 'Stop & Save Practice Take';

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

    const buf = new Uint8Array(analyser.fftSize), ctx2d = canvas ? canvas.getContext('2d') : null;
    const drawWave = () => {
      if (!a.recording || !a.analyser) return;
      a.raf = requestAnimationFrame(drawWave);
      a.analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sumSq += v * v; }
      if (lvlEl) lvlEl.style.width = `${clamp(Math.round(Math.sqrt(sumSq / buf.length) * 320), 0, 100)}%`;
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
    }, false);
    if (hwTakeIsEmpty(take)) { await hwRefreshTakes(); hwMountAudioRunner(); toast('That recording was too short to save.'); return; }
    await hwIdbPut(take);
    await hwPruneTakes(take);
    HW_STATE.latestTakeId = take.id;
    await hwRefreshTakes();
    hwMountAudioRunner();
    toast(`Practice take saved (${hwFmtBytes(take.audioBytes)}) — click Submit when ready`);
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
// Practice takes pile up on Chromebooks (each one holds its recording), so only the newest few are kept.
// A take waiting to upload, a submitted take and the best-scoring practice take are never removed here.
const HW_KEEP_TAKES = 5;
function hwIsPracticeTake(t) { return t.status === 'draft' && (!t.uploadState || t.uploadState === 'draft'); }
function hwBestTakeId(list) {
  let best = null;
  for (const t of list) if (hwIsPracticeTake(t) && t.overallPct != null && (!best || t.overallPct > best.overallPct)) best = t;
  return best?.id || null;
}
// A take that stopped right away or heard nothing has nothing worth keeping (it showed up as a 0:00 take).
function hwTakeIsEmpty(take, gradeResult) {
  if (take.autoSubmitted) return false;                        // a one-try take always counts
  const taps = gradeResult?.take?.taps;
  if (taps) return Array.isArray(taps) && taps.length === 0;
  if (!take.audioBytes || take.durationSec < 1) return true;
  const rj = take.resultsJson;
  return !!rj && rj.heard === 0 && rj.rmsPeak < 0.004;
}
async function hwPruneTakes(take) {
  try {
    const all = await hwIdbAll();
    const mine = all.filter(t => t.assignmentId === take.assignmentId && t.studentId === take.studentId);
    const best = hwBestTakeId(mine);
    const practice = mine.filter(hwIsPracticeTake).sort((a, b) => b.createdAt - a.createdAt);
    // keep the newest five, but if the best one is older, it takes the place of the fifth
    const keep = new Set(practice.slice(0, HW_KEEP_TAKES).map(t => t.id));
    if (best && !keep.has(best)) { keep.delete(practice[HW_KEEP_TAKES - 1].id); keep.add(best); }
    keep.add(take.id);
    for (const t of practice) {
      if (keep.has(t.id)) continue;
      const url = HW_STATE.takeUrls.get(t.id);
      if (url) { try { URL.revokeObjectURL(url); } catch { } HW_STATE.takeUrls.delete(t.id); }
      await hwIdbDelete(t.id);
    }
  } catch (err) { console.warn('Could not tidy old takes:', err); }
}
async function hwRefreshTakes() {
  try { HW_STATE.takes = await hwIdbAll(); } catch { HW_STATE.takes = []; }
  hwRenderTakes();
  hwRenderLatestBanner();
  hwRenderOfflineBanner();
  if (HW_STATE.view === 'list') hwRenderAssignmentList();
}

function hwRenderTakes() {
  const host = $('#hw-takes-list'), countEl = $('#hw-takes-count'), clearBtn = $('#hw-clear-takes');
  if (!host) return;
  const isTeacher = !!HW_STATE.teacherOpen;
  const isPreview = !!HW_STATE.previewMode;
  const list = hwCurrentTakesForAssignment();
  if (clearBtn) {
    clearBtn.hidden = !(isTeacher || (isPreview && list.length > 0));
    clearBtn.textContent = isPreview ? 'Clear Preview Takes' : 'Clear Local Takes';
  }

  const serverSubs = Array.isArray(HW_STATE.activeSubmissions) ? HW_STATE.activeSubmissions : [];
  const serverSubById = new Map(serverSubs.map(s => [s.id, s]));
  const localServerIds = new Set(list.map(t => t.serverSubmissionId).filter(Boolean));
  const remoteOnlySubs = serverSubs.filter(s => !localServerIds.has(s.id));

  const bestId = list.filter(hwIsPracticeTake).length > 1 ? hwBestTakeId(list) : null;
  if (countEl) {
    const nPractice = list.filter(hwIsPracticeTake).length, nOther = list.filter(t => t.status === 'submitted').length;
    const kept = `${nPractice} of ${HW_KEEP_TAKES} practice takes saved on this ${DEVICE}`;
    countEl.textContent = isPreview
      ? `${list.length} preview take${list.length === 1 ? '' : 's'} (sandbox only)`
      : (remoteOnlySubs.length || nOther
        ? `${kept} · ${Math.max(serverSubs.length, nOther)} submitted`
        : kept);
  }
  if (!list.length && !remoteOnlySubs.length) {
    host.innerHTML = `<div class="hw-empty">${isPreview
      ? 'No preview takes recorded yet. Record or tap above to test grading and audio playback — takes stay local and are never saved to your Gradebook.'
      : 'No takes recorded yet for this assignment. Completed takes stay saved on this device even if Wi-Fi drops.'}</div>`;
    return;
  }

  const canSub = hwCanSubmitActive();

  const remoteHtml = remoteOnlySubs.map(s => {
    const eff = s.effectivePct != null ? s.effectivePct : s.overallPct;
    const when = s.submittedAt ? new Date(s.submittedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const cachedAudio = HW_STATE.serverAudioUrls.get(s.id);
    return `<div class="hw-take-item" data-srv-sub="${esc(s.id)}">
      <div class="hw-take-top">
        <div><strong>Attempt #${Number(s.attemptNum || 1)}</strong> ${when ? `<span class="muted small">· ${esc(when)}</span>` : ''}</div>
        <div class="hw-take-meta">
          ${eff != null ? `<span class="hw-pill score">Score ${eff}%${s.teacherOverridePct != null && s.teacherOverridePct !== s.overallPct ? ` (Teacher override from ${s.overallPct}%)` : (s.rhythmPct != null ? ` (Rhythm ${s.rhythmPct}%${s.pitchPct != null ? ` · Pitch ${s.pitchPct}%` : ''})` : '')}</span>` : ''}
          <span class="hw-pill submitted">✓ Submitted</span>
        </div>
      </div>
      ${s.teacherComment ? `<div class="hw-teacher-feedback"><strong>Teacher comment:</strong> ${esc(s.teacherComment)}</div>` : ''}
      ${cachedAudio ? `<audio class="hw-take-audio" controls preload="metadata" src="${cachedAudio}"></audio>` : (s.audioAvailable ? `<div><button type="button" class="hw-btn" data-hw-load-audio="${esc(s.id)}">Listen to Submitted Audio</button></div>` : '')}
    </div>`;
  }).join('');

  host.innerHTML = remoteHtml + list.map(t => {
    const srv = t.serverSubmissionId ? serverSubById.get(t.serverSubmissionId) : null;
    const shownOverall = srv?.effectivePct != null ? srv.effectivePct : t.overallPct;
    let audioUrl = HW_STATE.takeUrls.get(t.id);
    if (!audioUrl && t.audioBlob instanceof Blob && t.audioBlob.size > 0) {
      audioUrl = URL.createObjectURL(t.audioBlob);
      HW_STATE.takeUrls.set(t.id, audioUrl);
    }
    const when = new Date(t.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const showJson = isTeacher && HW_STATE.expandedJson.has(t.id);
    const isSubmitted = t.status === 'submitted';
    const isQueued = t.uploadState === 'queued_offline';
    const isUploading = t.uploadState === 'uploading';
    const packetPreview = {
      id: t.id, assignmentId: t.assignmentId, status: t.status, uploadState: t.uploadState,
      serverSubmissionId: t.serverSubmissionId, auto_submitted: !!t.autoSubmitted, submitted_at: t.submittedAt,
      type: t.type, overall_pct: shownOverall, rhythm_pct: t.rhythmPct, pitch_pct: t.pitchPct,
      audio_mime: t.audioMime, audio_bytes: t.audioBytes, audio_duration_sec: t.durationSec, expected_sec: t.expectedSec,
      integrity_flags: t.integrityFlags, results_json: t.resultsJson, meta: t.meta,
    };

    let pillHtml = `<span class="hw-pill draft">Practice Take</span>${t.id === bestId ? ' <span class="hw-pill submitted" title="Your best score. It stays saved even when older takes are cleared.">★ Best</span>' : ''}`;
    if (isUploading) pillHtml = `<span class="hw-pill draft">Uploading…</span>`;
    else if (isQueued) pillHtml = `<span class="hw-pill queued">Saved on this device — Retry Upload</span>`;
    else if (isSubmitted) pillHtml = `<span class="hw-pill submitted">✓ ${t.autoSubmitted ? 'Auto-Submitted' : 'Submitted'}</span>`;

    return `<div class="hw-take-item" data-take="${esc(t.id)}">
      <div class="hw-take-top">
        <div><strong>${esc(t.label)}</strong> <span class="muted small">· ${esc(when)}</span></div>
        <div class="hw-take-meta">
          ${shownOverall != null ? `<span class="hw-pill score">Score ${shownOverall}%${srv?.teacherOverridePct != null && srv.teacherOverridePct !== t.overallPct ? ` (Teacher override)` : ` (Rhythm ${t.rhythmPct}%${t.pitchPct != null ? ` · Pitch ${t.pitchPct}%` : ''})`}</span>` : ''}
          ${isTeacher && t.integrityFlags?.length ? `<span class="hw-pill flag">Flags: ${esc(t.integrityFlags.join(', '))}</span>` : ''}
          ${pillHtml}
        </div>
      </div>
      ${srv?.teacherComment ? `<div class="hw-teacher-feedback"><strong>Teacher comment:</strong> ${esc(srv.teacherComment)}</div>` : ''}
      ${t.lastUploadError && !isSubmitted ? `<div class="small" style="color:#b45309">${esc(t.lastUploadError)}</div>` : ''}
      ${isTeacher ? `<div class="hw-take-meta">
        <span>Audio: ${t.audioBytes ? `${esc(t.audioMime || 'audio')} · ${hwFmtBytes(t.audioBytes)} · ${t.durationSec}s` : 'None (Spacebar / Tap rhythm)'}</span>
        ${t.resultsJson?.strictness ? `<span>· ${esc(t.resultsJson.strictness.label)} (±${t.resultsJson.strictness.rhythmMs}ms / ±${t.resultsJson.strictness.pitchCents}¢)</span>` : ''}
        ${t.resultsJson?.offsetMs != null ? `<span>· Offset ${t.resultsJson.offsetMs}ms</span>` : ''}
      </div>` : ''}
      ${audioUrl ? `<audio class="hw-take-audio" controls preload="metadata" src="${audioUrl}"></audio>` : ''}
      <div class="row">
        ${isPreview
          ? `<span class="hw-pill preview">Sandbox Only · Not Sent to Gradebook</span>`
          : (isQueued
            ? `<button class="hw-btn primary" data-hw-submit="${esc(t.id)}">Retry Upload</button>`
            : (!isSubmitted && !isUploading
              ? `<button class="hw-btn good" data-hw-submit="${esc(t.id)}" ${canSub ? '' : 'disabled'}>Submit This Take</button>`
              : ''))}
        ${(!isSubmitted || isTeacher || isPreview) && !isUploading ? `<button class="hw-btn" data-hw-del="${esc(t.id)}">Delete</button>` : ''}
        ${isTeacher ? `<button class="hw-btn" data-hw-json="${esc(t.id)}">${showJson ? 'Hide' : 'Inspect'} Submission JSON</button>` : ''}
        ${(isTeacher || isPreview) && audioUrl ? `<a class="hw-btn" href="${audioUrl}" download="${esc(t.id)}.${(t.audioMime || '').includes('mp4') ? 'm4a' : (t.audioMime || '').includes('wav') ? 'wav' : 'webm'}">Download Audio</a>` : ''}
      </div>
      ${showJson ? `<pre class="hw-json-pre">${esc(JSON.stringify(packetPreview, null, 2))}</pre>` : ''}
    </div>`;
  }).join('');

  host.querySelectorAll('[data-hw-load-audio]').forEach(b => {
    b.onclick = async () => {
      const sid = b.dataset.hwLoadAudio;
      b.disabled = true; b.textContent = 'Loading audio…';
      const r = await HW_API.fetchSubmissionAudioUrl(sid);
      if (r.ok && r.url) {
        HW_STATE.serverAudioUrls.set(sid, r.url);
        hwRenderTakes();
      } else {
        b.disabled = false; b.textContent = 'Listen to Submitted Audio';
        toast(r.error || 'Could not load audio recording.');
      }
    };
  });
  host.querySelectorAll('[data-hw-submit]').forEach(b => { b.onclick = () => hwUploadTake(b.dataset.hwSubmit); });
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

async function hwBoot() {
  HW_STATE.capabilities = await HW_API.getCapabilities();
  hwRenderHeaderChips();
  hwInstallEngineHooks(() => hwRefreshTakes());
  window.__onGrStrictnessChange = () => {
    const sub = $('#hw-runner-body .hw-submeta');
    if (!sub || typeof grStrictnessSpec !== 'function') return;
    const isPitch = HW_STATE.tab === 'sight'
      ? hwSightEffectiveKind(HW_STATE.srState || srDefaults()) === 'solfege'
      : HW_STATE.tab === 'score' && HW_STATE.spGradeMode === 'mic';
    const tempo = HW_STATE.tab === 'sight'
      ? ((HW_STATE.srState?.[HW_STATE.srState?.mode]?.tempo) || 80)
      : (HW_STATE.spState?.tempo || 84);
    const sp = grStrictnessSpec(null, tempo);
    const tag = `Rhythm: ${sp.rhythmLabel} (±${sp.rhythmMs} ms)${isPitch ? ` · Pitch: ${sp.pitchLabel} (±${sp.pitchCents}¢)` : ''}`;
    sub.textContent = sub.textContent.replace(/Rhythm:.*$/, tag);
  };

  // Code formatting helper on Sign-In inputs
  ['#hw-in-joincode', '#hw-in-stucode'].forEach(sel => {
    const el = $(sel);
    if (el) {
      el.addEventListener('input', () => {
        const formatted = hwFormatCodeInputValue(el.value);
        if (el.value !== formatted) el.value = formatted;
      });
    }
  });

  $('#hw-code-form').onsubmit = hwHandleCodeSubmit;
  $('#hw-code-toggle').onclick = () => {
    HW_STATE.codeOpen = !HW_STATE.codeOpen;
    hwApplyCodeOpen(true);
    if (HW_STATE.codeOpen) $('#hw-in-joincode')?.focus();
  };
  $('#hw-google-btn').onclick = () => hwHandleGoogleSignIn();
  $('#hw-signout-btn').onclick = hwSignOut;
  $('#hw-sync-btn').onclick = () => hwOpenSyncModal(false);
  $('#hw-retry-all').onclick = () => hwRetryQueuedUploads(false);
  $('#hw-back-list').onclick = async () => {
    hwCleanupMediaAndMic();
    if (HW_STATE.previewMode) { hwClosePreviewWindow(); return; }   // teacher preview: close it, back to setup
    await hwRefreshAssignments();
    hwRenderAssignmentList();
    hwSetView('list');
  };

  $('#hw-offline-btn').onclick = () => {
    const next = !HW_API.isDemoOffline();
    HW_API.setDemoOffline(next);
    hwRenderHeaderChips();
    toast(next ? 'Offline Test enabled — uploads will queue locally' : 'Online — ready to retry queued uploads');
    if (!next) hwRetryQueuedUploads(false);
  };

  const toggleTeacher = () => {
    if (HW_STATE.teacherOpen) hwSyncTeacherEditsToDemo();
    HW_STATE.teacherOpen = !HW_STATE.teacherOpen;
    $('#hw-teacher-drawer').hidden = !HW_STATE.teacherOpen;
    hwRenderHeaderChips();
    hwRenderTeacherOptions();
    hwRenderTakes();
    if (HW_STATE.tab === 'sight') hwMountSightRunner();
    else if (HW_STATE.tab === 'score') hwMountScoreRunner();
    else hwMountAudioRunner();
  };
  $('#hw-teacher-toggle').onclick = toggleTeacher;
  $('#hw-teacher-close').onclick = toggleTeacher;

  document.querySelectorAll('.hw-tab').forEach(b => {
    b.onclick = () => hwSwitchTab(b.dataset.hwTab);
  });

  $('#hw-clear-takes').onclick = async () => {
    if (HW_STATE.previewMode) {
      const previewTakes = HW_STATE.takes.filter(t => t.studentId === 'teacher_preview');
      for (const t of previewTakes) {
        const url = HW_STATE.takeUrls.get(t.id);
        if (url) { URL.revokeObjectURL(url); HW_STATE.takeUrls.delete(t.id); }
        await hwIdbDelete(t.id);
      }
      await hwRefreshTakes();
      toast('Cleared preview takes.');
      return;
    }
    for (const url of HW_STATE.takeUrls.values()) URL.revokeObjectURL(url);
    HW_STATE.takeUrls.clear();
    await hwIdbClear();
    await hwRefreshTakes();
    toast('Cleared local takes.');
  };

  const resetPreviewBtn = $('#hw-preview-reset');
  if (resetPreviewBtn) {
    resetPreviewBtn.onclick = () => {
      if (!HW_STATE.previewMode || !HW_STATE.activeAssignment) return;
      hwCleanupMediaAndMic();
      HW_STATE.previewRevealed = false;
      HW_STATE.latestTakeId = null;
      hwRenderTakes();
      if (HW_STATE.tab === 'sight') hwMountSightRunner();
      else if (HW_STATE.tab === 'score') hwMountScoreRunner();
      else hwMountAudioRunner();
      toast('Preview reset — ready to test again.');
    };
  }
  const closePreviewBtn = $('#hw-preview-close');
  if (closePreviewBtn) {
    closePreviewBtn.onclick = hwClosePreviewWindow;
  }

  window.addEventListener('online', () => {
    if (!HW_STATE.previewMode) hwRetryQueuedUploads(true);
  });

  // Teacher Preview Sandbox (?preview=<token>) skips student sign-in & sync lock
  const previewTok = QS.get('preview');
  if (previewTok) {
    await hwOpenPreview(previewTok);
    return;
  }

  // A teacher opening "Test Student" arrives with #test=<token>. The #part is never sent to any
  // server; take it, then clear it from the address bar so it isn't left in history or shared.
  const testTok = (location.hash.match(/^#test=([^&]+)/) || [])[1];
  if (testTok) {
    HW_STATE.isTestSession = true;   // a teacher previewing: don't offer to connect Google
    try { history.replaceState(null, '', location.pathname + location.search); } catch { }
    HW_API.setToken(decodeURIComponent(testTok));
  }

  // Restore the kept sign-in (localStorage on this Chromebook, or this tab's copy)
  if (HW_API.getToken()) {
    const me = await HW_API.getMe();
    if (me.ok && me.student && me.class) {
      await hwEnterAuthenticated(me);
      return;
    }
    HW_API.clearSession();
  }
  hwRenderAuthScreen();
}

document.addEventListener('DOMContentLoaded', hwBoot);
