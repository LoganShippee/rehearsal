'use strict';
/* Rehearsal Online Homework — Student Portal & Milestone 1 Engine-Reuse Spike.
   Reuses web/sight.js, web/score.js, web/grade.js, and web/music.js verbatim:
     - Mandatory Session Audio Sync Test (8-click tap calibration per session)
     - Clean Student-Facing UI (hides teacher toolbars) vs. Full Teacher Setup mode
       (exposes 100% of Rehearsal's Sight Reading & Score Practice options + Homework settings)
     - Teacher options to display Solfege / Counting + Grading Strictness slider with live leeway
     - True Sight-Read: 15–60s study countdown, Starting Pitch / Tonic Chord / Scale buttons,
       automatic mic (pitch) or Spacebar/Tap (rhythm-only), and automatic submission at finish
     - Practice Mode & Audio-Only: students can rehearse/record multiple takes, listen back,
       and click "Submit This Take" on the take they want to turn in
     - IndexedDB offline-safe take storage ("Saved on this device") */

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
const HW_SYNC = { running: false, timers: [], keyHandler: null, mandatory: true };
function hwSyncIsDone() {
  try { return sessionStorage.getItem(HW_SYNC_SESSION_KEY) === '1'; } catch { return false; }
}
function hwClearSyncTimers() {
  HW_SYNC.timers.forEach(id => clearTimeout(id));
  HW_SYNC.timers = [];
  if (HW_SYNC.keyHandler) { document.removeEventListener('keydown', HW_SYNC.keyHandler, true); HW_SYNC.keyHandler = null; }
  HW_SYNC.running = false;
}
function hwOpenSyncModal(mandatory = false) {
  hwClearSyncTimers();
  HW_SYNC.mandatory = mandatory;
  const overlay = $('#hw-sync-overlay'), dotsEl = $('#hw-sync-dots'), padBtn = $('#hw-sync-pad'),
    statusEl = $('#hw-sync-status'), startBtn = $('#hw-sync-start'), cancelBtn = $('#hw-sync-cancel');
  if (!overlay) return;
  dotsEl.innerHTML = Array.from({ length: 12 }, (_, i) => `<span class="hw-sync-dot ${i < 4 ? 'lead' : 'tap'}" data-sdot="${i}"></span>`).join('');
  padBtn.disabled = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Start 10-Second Sync Check';
  cancelBtn.hidden = mandatory;
  statusEl.textContent = mandatory
    ? 'Required once at the start of each session so timing matches your device.'
    : `Current sync: ${avDelayMs()} ms. Press Start to recalibrate.`;
  overlay.hidden = false;
  cancelBtn.onclick = () => { hwClearSyncTimers(); overlay.hidden = true; };
  startBtn.onclick = () => hwRunSyncTest();
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
  const beat = 60 / 90, t0 = c.currentTime + 0.5, lead = 4, n = 8, clicks = [];
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
    hwClearSyncTimers(); padBtn.disabled = true; dots.forEach(d => d.classList.remove('active'));
    if (diffs.length < 5) {
      statusEl.textContent = `Only ${diffs.length} taps heard (need at least 5). Try again!`;
      startBtn.disabled = false; startBtn.textContent = 'Try Sync Check Again';
      return;
    }
    const medianSec = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const ms = setAvDelay(medianSec * 1000);
    try { sessionStorage.setItem(HW_SYNC_SESSION_KEY, '1'); } catch { }
    hwRenderHeaderChips();
    statusEl.innerHTML = `Synced: <strong>${ms} ms</strong> on this ${esc(DEVICE)}. You're ready!`;
    startBtn.disabled = false; startBtn.textContent = 'Continue to Homework';
    startBtn.onclick = () => { overlay.hidden = true; };
    toast(`Audio sync calibrated (${ms} ms)`);
  }, totalMs));
}
window.openAvCal = () => hwOpenSyncModal(false);

// ---------- Mirror of server-side score recomputation & integrity checks
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
      notes: notes.map(n => ({ bar: n.bar, idx: n.idx, status: n.status, pitch: n.pitch || null, cents: n.cents ?? null, errMs: n.errMs ?? null })),
    };
  } else if (!audioBlob || audioBlob.size === 0) {
    flags.push('missing_audio');
  }

  if (audioBlob && audioBlob.size > HW_MAX_AUDIO_BYTES) flags.push('audio_over_15mb');

  return {
    id: 'take_' + uid(),
    createdAt: Date.now(),
    status: autoSubmit ? 'submitted' : 'draft',
    autoSubmitted: !!autoSubmit,
    submittedAt: autoSubmit ? Date.now() : null,
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
            syncMs: avDelayMs(), strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 50, pitch: 50 },
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
          autoSubmit: false,
          expectedSec: Math.max(0, (GR.end || 0) - (GR.T0 || 0) - 0.8),
          meta: {
            scoreName: ctl?.st?.name || 'Sample Score', gradeMode: mode, tempo: ctl?.st?.tempo || null,
            syncMs: avDelayMs(), strictness: typeof grStrictnessValues === 'function' ? grStrictnessValues() : { rhythm: 50, pitch: 50 },
          },
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
          autoSubmit: false, expectedSec: 0, meta: {},
        };
        HW_GRADE_CAP.activeContext = null;
        // Immediately clear any active Stop & Grade button / LIVE bar once the take completes
        const studyBar = $('#hw-study-bar');
        if (studyBar && ctx.autoSubmit) {
          studyBar.classList.remove('live');
          studyBar.classList.add('done');
          const timerEl = $('#hw-study-timer');
          if (timerEl) timerEl.textContent = 'DONE';
          const msgEl = $('#hw-study-msg');
          if (msgEl) msgEl.innerHTML = '<strong>Completed!</strong> Your True Sight-Read take has been auto-submitted.';
          const pWrap = $('#hw-study-pitches');
          if (pWrap) {
            pWrap.innerHTML = `<span class="hw-pill submitted">✓ Auto-Submitted</span><button type="button" class="hw-btn" id="hw-study-again">New Excerpt (Preview)</button>`;
            const again = $('#hw-study-again');
            if (again) again.onclick = () => hwMountSightRunner();
          }
        }
        const grObj = host.__grResult;
        hwFinishParallelRecorder(grObj.take?.rec).then(async ({ blob, durationSec }) => {
          const take = hwBuildSubmissionSummary(
            ctx.type, ctx.label, grObj, grObj.take?.taps ? null : blob, durationSec, ctx.expectedSec, ctx.meta, ctx.autoSubmit
          );
          await hwIdbPut(take);
          HW_STATE.latestTakeId = take.id;
          if (ctx.autoSubmit) HW_STATE.srTrueSubmitted = take;
          onTakeSaved(take);
          toast(ctx.autoSubmit
            ? `True Sight-Read auto-submitted (${take.overallPct != null ? take.overallPct + '%' : 'audio'})`
            : `Practice take saved (${take.overallPct != null ? take.overallPct + '%' : 'audio'}) — click Submit when ready`);
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
  spGradeMode: 'mic',   // 'mic' | 'rhythm' | 'tap'
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

async function hwSubmitTake(id) {
  const take = HW_STATE.takes.find(t => t.id === id);
  if (!take) return;
  take.status = 'submitted';
  take.submittedAt = Date.now();
  await hwIdbPut(take);
  await hwRefreshTakes();
  hwRenderLatestBanner();
  toast('Submitted to your teacher!');
}

function hwRenderLatestBanner() {
  const host = $('#hw-latest-banner');
  if (!host) return;
  const t = HW_STATE.takes.find(x => x.id === HW_STATE.latestTakeId && x.type === HW_STATE.tab);
  if (!t) { host.innerHTML = ''; return; }
  if (t.status === 'submitted') {
    host.innerHTML = `<div class="hw-submit-banner">
      <span><strong>✓ ${t.autoSubmitted ? 'Auto-Submitted (True Sight-Read)' : 'Submitted to Teacher'}:</strong> ${esc(t.label)}${t.overallPct != null ? ` — ${t.overallPct}% (Rhythm ${t.rhythmPct}%${t.pitchPct != null ? ` · Pitch ${t.pitchPct}%` : ''})` : ''}</span>
      <span class="small">Saved on this ${esc(DEVICE)}</span>
    </div>`;
  } else {
    host.innerHTML = `<div class="hw-submit-banner draft">
      <span><strong>Practice Take Ready:</strong> ${esc(t.label)}${t.overallPct != null ? ` — ${t.overallPct}%` : ''} (Not submitted yet — listen below or record again)</span>
      <button type="button" class="hw-btn good" id="hw-banner-submit">Submit This Take</button>
    </div>`;
    const btn = $('#hw-banner-submit');
    if (btn) btn.onclick = () => hwSubmitTake(t.id);
  }
}

// ---------- Header chips & Teacher Setup drawer (full Rehearsal options!)
function hwRenderHeaderChips() {
  const syncBtn = $('#hw-sync-btn'), devChip = $('#hw-dev-chip'), tBtn = $('#hw-teacher-toggle');
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
    tBtn.textContent = HW_STATE.teacherOpen ? 'Preview Student View' : 'Teacher Setup ▾';
  }
}

function hwSyncRunnerViewClass() {
  const runner = $('#hw-runner-body');
  if (!runner) return;
  runner.classList.toggle('hw-student-view', !HW_STATE.teacherOpen);
  runner.classList.toggle('hw-teacher-mode', HW_STATE.teacherOpen);
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
      <div class="small muted" style="width:100%">Full Rehearsal Sight Reading toolbar &amp; Settings are open below — configure key, clef, range, leaps, rhythms, presets, or Build your own excerpt, then click <strong>Preview Student View</strong>.</div>`;

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
          <option value="rhythm" ${HW_STATE.spGradeMode === 'rhythm' ? 'selected' : ''}>Microphone (Rhythm Only)</option>
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
      <div class="small muted" style="width:100%">Full Rehearsal Score Practice controls &amp; Settings are open below — pick focus voice, measure selection, tempo, or solfege/counts, then click <strong>Preview Student View</strong>.</div>`;

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
  st.settingsOpen = HW_STATE.teacherOpen; // In Teacher Setup, show ALL Sight Reading settings natively!

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

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <div>
          <h2>${HW_STATE.teacherOpen ? 'Configure Sight-Reading Assignment (All Rehearsal Options)' : (trueMode ? 'True Sight-Reading Check' : 'Sight-Reading Practice Assignment')}</h2>
          <div class="hw-submeta">${esc(metaDesc)}${strictDesc ? ` · ${esc(strictDesc)}` : ''}</div>
        </div>
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
            ${isPitch ? `
              <button type="button" class="hw-btn pitch" id="hw-pitch-start">Starting Pitch (${esc(pitchInfo.startSyl)} · ${esc(pitchInfo.startName)})</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-chord">Tonic Chord</button>
              <button type="button" class="hw-btn pitch" id="hw-pitch-scale">Scale</button>
            ` : `
              <button type="button" class="hw-btn pitch" id="hw-tempo-pulse">Hear Tempo (${tempoNow} BPM)</button>
            `}
            <button type="button" class="hw-btn" id="hw-sr-hear">Hear Example</button>
          </div>
          <div class="hw-student-actions">
            <button type="button" class="hw-btn primary" id="hw-sr-record">${isPitch ? 'Record Practice Take (Mic)' : 'Tap Practice Take (Space / Tap)'}</button>
          </div>
        </div>
      `) : ''}

      <div class="hw-stage" id="hw-sr-stage">
        <div class="sr-host" id="hw-sr-host"></div>
        ${trueMode ? `
          <div class="hw-study-cover" id="hw-study-cover">
            <h3>Ready for your ${HW_STATE.srStudySec}-Second True Sight-Read?</h3>
            <p>
              When you press start, a fresh excerpt will appear for <strong>${HW_STATE.srStudySec} seconds</strong>.
              ${isPitch
                ? 'During study time you can hear your <strong>Starting Pitch, Tonic Chord, and Scale</strong>. At 0:00, your <strong>microphone will count in, record, and automatically submit</strong> your take.'
                : 'During study time you can hear the <strong>tempo pulse</strong>. At 0:00, <strong>Spacebar / Tap rhythm grading will start and automatically submit</strong> your take.'}
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
  mountSight(host, st, () => {
    // Keep Teacher Setup checkboxes & leeway readout in sync when teacher edits inside Sight Reading
    if (HW_STATE.teacherOpen) hwRenderTeacherOptions();
  });
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
      beginBtn.textContent = isPitch ? 'Checking microphone…' : 'Preparing excerpt…';
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

      if (st.mode !== 'build') {
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

// ---------- Score Practice Runner (Student View + Full Teacher Setup View)
function hwMountScoreRunner() {
  hwStopStudyTimer();
  hwSyncRunnerViewClass();
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

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <div>
          <h2>${HW_STATE.teacherOpen ? 'Configure Score Practice Assignment (All Rehearsal Options)' : `Score Check-In: ${esc(HW_STATE.spState.name)}`}</h2>
          <div class="hw-submeta">${esc(modeLabel)}${esc(strictDesc)}</div>
        </div>
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
          <label class="small" style="display:inline-flex;align-items:center;gap:6px">Part:
            <select id="hw-sp-part" style="border:1px solid #cbd5e1;border-radius:8px;padding:5px 8px;background:#fff"></select>
          </label>
          <button type="button" class="hw-btn pitch" id="hw-sp-pitch">Starting Pitch</button>
          <button type="button" class="hw-btn" id="hw-sp-play">Practice Playback</button>
        </div>
        <div class="hw-student-actions">
          <button type="button" class="hw-btn primary" id="hw-sp-grade">${HW_STATE.spGradeMode === 'tap' ? 'Tap Practice Take (Space / Tap)' : 'Record Practice Take (Mic)'}</button>
        </div>
      </div>` : ''}

      <div class="hw-stage">
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
  $('#hw-sp-play').onclick = () => { if (!ctl?.sc) return; if (ctl.playing) spStop(); else spPlay(ctl); };
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
  a.pcmNode = null; a.srcNode = null; a.analyser = null; a.mr = null; a.recording = false;
}

function hwMountAudioRunner() {
  hwStopStudyTimer();
  hwSyncRunnerViewClass();
  const body = $('#hw-runner-body'), a = HW_STATE.aud, mime = hwPickAudioMime();

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <div>
          <h2>Audio Check-In Assignment</h2>
          <div class="hw-submeta">${a.countIn ? `Includes 4-beat count-in at ${a.bpm} BPM` : 'Starts recording immediately'} · Record as many practice takes as you like, then click Submit.</div>
        </div>
      </div>
      <div id="hw-latest-banner"></div>
      <div class="hw-audio-body">
        <div class="hw-audio-prompt"><strong>Instructions:</strong> ${esc(a.prompt)}</div>
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
          <button class="hw-btn danger" id="hw-aud-rec">${a.recording ? 'Stop & Save Practice Take' : 'Start Recording'}</button>
          <span class="muted small" id="hw-aud-status">Ready. Takes save immediately on this device before submitting.</span>
        </div>
      </div>
    </div>`;

  hwRenderLatestBanner();
  $('#hw-aud-rec').onclick = () => { if (a.recording) hwStopAudioOnly(); else hwStartAudioOnly(); };
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
    await hwIdbPut(take);
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
async function hwRefreshTakes() {
  try { HW_STATE.takes = await hwIdbAll(); } catch { HW_STATE.takes = []; }
  hwRenderTakes();
  hwRenderLatestBanner();
}

function hwRenderTakes() {
  const host = $('#hw-takes-list'), countEl = $('#hw-takes-count');
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
    const isSubmitted = t.status === 'submitted';
    const packetPreview = {
      id: t.id, status: t.status, auto_submitted: !!t.autoSubmitted, submitted_at: t.submittedAt,
      type: t.type, overall_pct: t.overallPct, rhythm_pct: t.rhythmPct, pitch_pct: t.pitchPct,
      audio_mime: t.audioMime, audio_bytes: t.audioBytes, audio_duration_sec: t.durationSec, expected_sec: t.expectedSec,
      integrity_flags: t.integrityFlags, results_json: t.resultsJson, meta: t.meta,
    };

    return `<div class="hw-take-item" data-take="${esc(t.id)}">
      <div class="hw-take-top">
        <div><strong>${esc(t.label)}</strong> <span class="muted small">· ${esc(when)}</span></div>
        <div class="hw-take-meta">
          ${t.overallPct != null ? `<span class="hw-pill score">Overall ${t.overallPct}% (R ${t.rhythmPct}%${t.pitchPct != null ? ` · P ${t.pitchPct}%` : ''})</span>` : ''}
          ${t.integrityFlags?.length ? `<span class="hw-pill flag">Flags: ${esc(t.integrityFlags.join(', '))}</span>` : ''}
          ${isSubmitted
            ? `<span class="hw-pill submitted">✓ ${t.autoSubmitted ? 'Auto-Submitted' : 'Submitted'}</span>`
            : `<span class="hw-pill draft">Practice Take (Not Submitted)</span>`}
        </div>
      </div>
      <div class="hw-take-meta">
        <span>Audio: ${t.audioBytes ? `${esc(t.audioMime || 'audio')} · ${hwFmtBytes(t.audioBytes)} · ${t.durationSec}s` : 'None (Spacebar / Tap rhythm)'}</span>
        ${t.resultsJson?.strictness ? `<span>· ${esc(t.resultsJson.strictness.label)} (±${t.resultsJson.strictness.rhythmMs}ms / ±${t.resultsJson.strictness.pitchCents}¢)</span>` : ''}
        ${t.resultsJson?.offsetMs != null ? `<span>· Offset ${t.resultsJson.offsetMs}ms</span>` : ''}
      </div>
      ${audioUrl ? `<audio class="hw-take-audio" controls preload="metadata" src="${audioUrl}"></audio>` : ''}
      <div class="row">
        ${!isSubmitted ? `<button class="hw-btn good" data-hw-submit="${esc(t.id)}">Submit This Take</button>` : ''}
        <button class="hw-btn" data-hw-json="${esc(t.id)}">${showJson ? 'Hide' : 'Inspect'} Submission JSON</button>
        ${audioUrl ? `<a class="hw-btn" href="${audioUrl}" download="${esc(t.id)}.${(t.audioMime || '').includes('mp4') ? 'm4a' : (t.audioMime || '').includes('wav') ? 'wav' : 'webm'}">Download Audio</a>` : ''}
        <button class="hw-btn" data-hw-del="${esc(t.id)}">Delete</button>
      </div>
      ${showJson ? `<pre class="hw-json-pre">${esc(JSON.stringify(packetPreview, null, 2))}</pre>` : ''}
    </div>`;
  }).join('');

  host.querySelectorAll('[data-hw-submit]').forEach(b => { b.onclick = () => hwSubmitTake(b.dataset.hwSubmit); });
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

  $('#hw-sync-btn').onclick = () => hwOpenSyncModal(false);
  const toggleTeacher = () => {
    HW_STATE.teacherOpen = !HW_STATE.teacherOpen;
    $('#hw-teacher-drawer').hidden = !HW_STATE.teacherOpen;
    hwRenderHeaderChips();
    hwRenderTeacherOptions();
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
    for (const url of HW_STATE.takeUrls.values()) URL.revokeObjectURL(url);
    HW_STATE.takeUrls.clear();
    await hwIdbClear();
    await hwRefreshTakes();
    toast('Cleared local takes.');
  };

  hwSwitchTab('sight');
  hwRefreshTakes();

  if (!hwSyncIsDone()) {
    hwOpenSyncModal(true);
  }
}

document.addEventListener('DOMContentLoaded', hwBoot);
