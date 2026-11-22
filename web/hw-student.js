'use strict';
/* Rehearsal Online Homework — Student Portal & Milestone 1 Engine-Reuse Spike.
   Reuses web/sight.js, web/score.js, web/grade.js, and web/music.js verbatim:
     1. Sight Reading (Practice Mode OR True Sight-Read with 15–60s study countdown + auto-record)
     2. Score Practice (built-in sample MusicXML or any picked .mxl/.musicxml file)
     3. Audio-Only Recording (MediaRecorder Opus/MP4 + automatic 16 kHz mono WAV fallback)
   Every completed take is saved immediately to IndexedDB (rehearsal-hw-takes) with
   compressed audio, recomputed scores, per-note results, and integrity check metrics. */

const HW_MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const HW_DB_NAME = 'rehearsal-hw-takes';
const HW_STORE = 'takes';

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
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { }
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

// ---------- IndexedDB offline take store ("Saved on this device — Retry Upload")
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
        bar: n.bar,
        idx: n.idx,
        status: n.status,
        pitch: n.pitch || null,
        cents: n.cents ?? null,
        errMs: n.errMs ?? null,
      })),
    };
  } else if (!audioBlob || audioBlob.size === 0) {
    flags.push('missing_audio');
  }

  if (audioBlob && audioBlob.size > HW_MAX_AUDIO_BYTES) {
    flags.push('audio_over_15mb');
  }

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

// ---------- Zero-touch MediaRecorder hook around web/grade.js's single mic stream
const HW_GRADE_CAP = {
  mr: null,
  chunks: [],
  mime: '',
  startedAt: 0,
  stoppingPromise: null,
  activeContext: null, // { type, label, host, getMeta }
};

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
        if (blob.size > 0) {
          resolve({ blob, durationSec: elapsed });
          return;
        }
      }
      resolve(buildFallbackWav());
    };
    if (mr.state === 'inactive') { finalize(); return; }
    mr.addEventListener('stop', finalize, { once: true });
    try { mr.stop(); } catch { resolve(buildFallbackWav()); }
  });
}

// Wrap grStart, spGradeStart, and grShowCard non-invasively (zero edits to web/grade.js or web/score.js)
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
          label: `Sight Reading (${st.mode === 'solfege' ? 'Solfege' : 'Rhythm'})`,
          host,
          expectedSec: Math.max(0, (GR.end || 0) - (GR.T0 || 0) - 0.8),
          meta: {
            mode: st.mode,
            ts: st[st.mode]?.ts,
            tempo: st[st.mode]?.tempo,
            key: st[st.mode]?.key,
            trueSightRead: !!HW_STATE.srTrueMode,
            studySeconds: HW_STATE.srTrueMode ? HW_STATE.srStudySec : 0,
          },
        };
        if (input !== 'tap' && GR.mic?.stream) {
          hwStartParallelRecorder(GR.mic.stream);
        } else {
          hwAbortParallelRecorder();
        }
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
          meta: {
            scoreName: ctl?.st?.name || 'Sample Score',
            gradeMode: mode,
            tempo: ctl?.st?.tempo || null,
          },
        };
        if (mode !== 'tap' && GR.mic?.stream) {
          hwStartParallelRecorder(GR.mic.stream);
        } else {
          hwAbortParallelRecorder();
        }
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
            ctx.type,
            ctx.label,
            grObj,
            grObj.take?.taps ? null : blob,
            durationSec,
            ctx.expectedSec,
            ctx.meta
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

// ---------- Main UI state
const HW_STATE = {
  tab: 'sight',         // 'sight' | 'score' | 'audio'
  srTrueMode: false,    // false = Practice, true = True Sight-Read
  srStudySec: 30,       // 15 | 30 | 45 | 60
  srStudyLeft: 0,
  srStudyTimer: null,
  srState: null,
  srHost: null,
  spFileId: null,
  spState: null,
  spHost: null,
  // Audio-only recorder state
  aud: {
    recording: false,
    stream: null,
    mr: null,
    chunks: [],
    pcmChunks: [],
    pcmSr: 44100,
    pcmNode: null,
    srcNode: null,
    analyser: null,
    raf: 0,
    startedAt: 0,
    timer: null,
    countIn: true,
    bpm: 84,
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

// ---------- Diagnostics header
function hwRenderDiagnostics() {
  const el = $('#hw-diag');
  if (!el) return;
  const mime = hwPickAudioMime();
  const hasIdb = typeof indexedDB !== 'undefined';
  const hasMic = !!navigator.mediaDevices?.getUserMedia;
  const sr = AC ? `${Math.round(AC.sampleRate / 1000)} kHz` : 'Audio ready';
  el.innerHTML = `
    <span class="hw-chip">${esc(DEVICE)}</span>
    <span class="hw-chip ${mime ? 'ok' : 'warn'}" title="Preferred compressed recording format">${mime ? esc(mime.split(';')[0]) : 'WAV fallback'}</span>
    <span class="hw-chip ${hasMic ? 'ok' : 'warn'}">${hasMic ? 'Mic API OK' : 'No Mic API'}</span>
    <span class="hw-chip ${hasIdb ? 'ok' : 'warn'}">${hasIdb ? 'IndexedDB OK' : 'No IndexedDB'}</span>
    <span class="hw-chip">${esc(sr)} · sync ${avDelayMs()}ms</span>`;
}

// ---------- Sight Reading Runner (Practice + True Sight-Read)
function hwStopStudyTimer() {
  if (HW_STATE.srStudyTimer) {
    clearInterval(HW_STATE.srStudyTimer);
    HW_STATE.srStudyTimer = null;
  }
}

function hwMountSightRunner() {
  hwStopStudyTimer();
  const body = $('#hw-runner-body');
  if (!HW_STATE.srState) {
    HW_STATE.srState = srDefaults();
    HW_STATE.srState.mode = 'solfege';
  }
  const trueMode = HW_STATE.srTrueMode;

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <h2>1. Sight Reading Runner <span class="muted small">(reusing web/sight.js + web/grade.js verbatim)</span></h2>
        <div class="hw-controls">
          <label>Mode:
            <select id="hw-sr-mode">
              <option value="practice" ${!trueMode ? 'selected' : ''}>Practice Mode (unlimited replay)</option>
              <option value="true" ${trueMode ? 'selected' : ''}>True Sight-Read (study countdown + auto-record)</option>
            </select>
          </label>
          ${trueMode ? `<label>Study timer:
            <select id="hw-sr-study-sec">
              ${[15, 30, 45, 60].map(s => `<option value="${s}" ${HW_STATE.srStudySec === s ? 'selected' : ''}>${s}s</option>`).join('')}
            </select>
          </label>` : ''}
        </div>
      </div>
      ${trueMode ? `<div class="hw-study-bar" id="hw-study-bar">
        <span><strong>True Sight-Read:</strong> Press <em>Reveal &amp; Start Countdown</em> to inspect a fresh excerpt. Recording begins automatically when the timer reaches 0:00.</span>
        <span class="hw-study-timer" id="hw-study-timer">${hwFmtTime(HW_STATE.srStudySec)}</span>
      </div>` : ''}
      <div class="hw-stage" id="hw-sr-stage">
        <div class="sr-host" id="hw-sr-host"></div>
        ${trueMode ? `<div class="hw-study-cover" id="hw-study-cover">
          <h3>Ready for True Sight-Read?</h3>
          <p>A fresh sight-reading excerpt will be generated when you start. You will have <strong>${HW_STATE.srStudySec} seconds</strong> to silently study it before grading begins automatically.</p>
          <button class="hw-btn primary" id="hw-study-begin">Reveal &amp; Start ${HW_STATE.srStudySec}s Study Countdown</button>
        </div>` : ''}
      </div>
    </div>`;

  const host = $('#hw-sr-host');
  HW_STATE.srHost = host;
  window.__spaceTarget = 'sr';
  mountSight(host, HW_STATE.srState, () => { });

  $('#hw-sr-mode').onchange = e => {
    HW_STATE.srTrueMode = e.target.value === 'true';
    hwMountSightRunner();
  };
  const secSel = $('#hw-sr-study-sec');
  if (secSel) {
    secSel.onchange = e => {
      HW_STATE.srStudySec = Number(e.target.value) || 30;
      hwMountSightRunner();
    };
  }
  const beginBtn = $('#hw-study-begin');
  if (beginBtn) {
    beginBtn.onclick = () => {
      // Unlock AudioContext on this user gesture so auto-record at 0:00 succeeds cleanly
      try { ac().resume(); } catch { }
      // Generate a fresh excerpt via Sight Reading's real New button
      host.querySelector('[data-sr="new"]')?.click();
      $('#hw-study-cover')?.remove();
      HW_STATE.srStudyLeft = HW_STATE.srStudySec;
      const timerEl = $('#hw-study-timer');
      const barEl = $('#hw-study-bar');
      if (timerEl) timerEl.textContent = hwFmtTime(HW_STATE.srStudyLeft);
      hwStopStudyTimer();
      HW_STATE.srStudyTimer = setInterval(() => {
        HW_STATE.srStudyLeft -= 1;
        if (timerEl) timerEl.textContent = hwFmtTime(HW_STATE.srStudyLeft);
        if (HW_STATE.srStudyLeft <= 0) {
          hwStopStudyTimer();
          if (barEl) barEl.innerHTML = '<span><strong>Recording started automatically!</strong> Perform after the count-in.</span><span class="hw-study-timer">LIVE</span>';
          // Trigger Sight Reading's real Grade button automatically
          const gBtn = host.querySelector('[data-sr="grade"]');
          if (gBtn) {
            if (HW_STATE.srState.mode === 'rhythm') {
              // Rhythm opens a menu on click; invoke grStart directly with mic
              gBtn.click();
              setTimeout(() => {
                const micChoice = document.querySelector('.sr-grmenu button[data-gm="mic"]');
                if (micChoice) micChoice.click();
              }, 30);
            } else {
              gBtn.click();
            }
          }
        }
      }, 1000);
    };
  }
}

// ---------- Score Practice Runner (built-in sample + pick any .mxl / .musicxml)
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
      gradeMode: 'mic',
    };
  }

  body.innerHTML = `
    <div class="hw-card">
      <div class="hw-card-head">
        <h2>2. Score Practice Runner <span class="muted small">(reusing web/score.js + OSMD + web/grade.js verbatim)</span></h2>
        <div class="hw-controls">
          <button class="hw-btn" id="hw-sp-pick">Load .mxl / .musicxml File…</button>
          <button class="hw-btn" id="hw-sp-sample">Reset to Sample Score</button>
        </div>
      </div>
      <div class="hw-stage">
        <div class="score-host" id="hw-sp-host"></div>
      </div>
    </div>`;

  const host = $('#hw-sp-host');
  HW_STATE.spHost = host;
  window.__spaceTarget = 'sp';
  mountScore(host, HW_STATE.spState, () => { }, 'hw-sp-' + HW_STATE.spState.fileId);

  $('#hw-sp-pick').onclick = async () => {
    const fs = await pickFile('.mxl,.musicxml,.xml', false);
    if (!fs.length) return;
    const f = fs[0];
    const id = await storeFile(f);
    HW_STATE.spState = { fileId: id, name: f.name.replace(/\.(mxl|musicxml|xml)$/i, ''), gradeMode: 'mic' };
    hwMountScoreRunner();
    toast(`Loaded ${f.name}`);
  };
  $('#hw-sp-sample').onclick = () => {
    HW_STATE.spState = { fileId: HW_STATE.spFileId, name: 'Sample Vocal Check-In', gradeMode: 'mic' };
    hwMountScoreRunner();
  };
}

// ---------- Audio-Only Recorder Runner (MediaRecorder + 16 kHz mono WAV fallback)
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
        <h2>3. Audio-Only Recording Runner <span class="muted small">(scales, warm-ups &amp; check-ins)</span></h2>
        <div class="hw-controls">
          <label><input type="checkbox" id="hw-aud-ci" ${a.countIn ? 'checked' : ''}> 4-beat count-in</label>
          <label>BPM: <input type="number" id="hw-aud-bpm" min="40" max="208" value="${a.bpm}" style="width:68px"></label>
        </div>
      </div>
      <div class="hw-audio-body">
        <div class="hw-audio-prompt">
          <strong>Assignment prompt:</strong> ${esc(a.prompt)}
        </div>
        <div class="hw-wave-box">
          <canvas id="hw-aud-canvas" width="900" height="130"></canvas>
          <div class="hw-rec-time" id="hw-aud-time">0:00</div>
        </div>
        <div class="hw-level-wrap">
          <span>Mic level</span>
          <div class="hw-level-bar"><div class="hw-level-fill" id="hw-aud-lvl"></div></div>
          <span class="muted">Codec: ${mime ? esc(mime) : '16 kHz mono WAV fallback'}</span>
        </div>
        <div class="row">
          <button class="hw-btn danger" id="hw-aud-rec">${a.recording ? 'Stop & Save Take' : 'Start Recording'}</button>
          <span class="muted small" id="hw-aud-status">Ready. Takes are saved locally in IndexedDB immediately when stopped.</span>
        </div>
      </div>
    </div>`;

  $('#hw-aud-ci').onchange = e => { a.countIn = e.target.checked; };
  $('#hw-aud-bpm').onchange = e => { a.bpm = clamp(Number(e.target.value) || 84, 40, 208); };
  $('#hw-aud-rec').onclick = () => {
    if (a.recording) hwStopAudioOnly();
    else hwStartAudioOnly();
  };
}

async function hwStartAudioOnly() {
  const a = HW_STATE.aud;
  const btn = $('#hw-aud-rec');
  const statusEl = $('#hw-aud-status');
  const timeEl = $('#hw-aud-time');
  const lvlEl = $('#hw-aud-lvl');
  const canvas = $('#hw-aud-canvas');
  if (a.recording) return;

  try {
    const c = ac();
    await c.resume();
    hwRenderDiagnostics();
    if (statusEl) statusEl.textContent = 'Requesting microphone…';
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    a.stream = stream;
    a.recording = true;
    a.chunks = [];
    a.pcmChunks = [];
    a.pcmSr = c.sampleRate || 44100;

    if (btn) btn.textContent = 'Stop & Save Take';

    // Optional 4-beat count-in before recording starts
    if (a.countIn) {
      const beatSec = 60 / a.bpm;
      if (statusEl) statusEl.textContent = `Count-in (${a.bpm} BPM)…`;
      for (let b = 0; b < 4; b++) {
        tone(b === 0 ? 1100 : 780, b * beatSec, 0.06, 'triangle', 0.25 * metVol());
      }
      await new Promise(r => setTimeout(r, Math.round(4 * beatSec * 1000)));
      if (!a.recording) return;
    }

    // Analyser for live waveform & mic level + PCM fallback capture
    const src = c.createMediaStreamSource(stream);
    const analyser = c.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    a.srcNode = src;
    a.analyser = analyser;

    const mime = hwPickAudioMime();
    if (mime) {
      try {
        const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
        mr.ondataavailable = e => { if (e.data && e.data.size > 0) a.chunks.push(e.data); };
        mr.start(250);
        a.mr = mr;
      } catch (err) {
        console.warn('Audio-only MediaRecorder threw, switching to WAV fallback:', err);
        a.mr = null;
      }
    }

    // Always attach lightweight PCM fallback if MediaRecorder wasn't started
    if (!a.mr && typeof c.createScriptProcessor === 'function') {
      const sp = c.createScriptProcessor(4096, 1, 1);
      const silent = c.createGain();
      silent.gain.value = 0;
      sp.onaudioprocess = ev => {
        if (!a.recording) return;
        a.pcmChunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
      };
      src.connect(sp);
      sp.connect(silent).connect(c.destination);
      a.pcmNode = sp;
    }

    a.startedAt = performance.now();
    if (statusEl) statusEl.textContent = a.mr ? `Recording (${a.mr.mimeType || mime})…` : 'Recording (16 kHz mono WAV fallback)…';

    a.timer = setInterval(() => {
      if (!a.recording) return;
      const elapsed = (performance.now() - a.startedAt) / 1000;
      if (timeEl) timeEl.innerHTML = `<span class="hw-rec-dot"></span>${hwFmtTime(elapsed)}`;
    }, 200);

    const buf = new Uint8Array(analyser.fftSize);
    const ctx2d = canvas ? canvas.getContext('2d') : null;
    const drawWave = () => {
      if (!a.recording || !a.analyser) return;
      a.raf = requestAnimationFrame(drawWave);
      a.analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      if (lvlEl) lvlEl.style.width = `${clamp(Math.round(rms * 320), 0, 100)}%`;
      if (ctx2d && canvas) {
        const W = canvas.width, H = canvas.height;
        ctx2d.fillStyle = '#0f172a';
        ctx2d.fillRect(0, 0, W, H);
        ctx2d.strokeStyle = '#38bdf8';
        ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        const step = W / buf.length;
        for (let i = 0; i < buf.length; i++) {
          const y = (buf[i] / 255) * H;
          if (i === 0) ctx2d.moveTo(0, y); else ctx2d.lineTo(i * step, y);
        }
        ctx2d.stroke();
      }
    };
    drawWave();
  } catch (err) {
    hwCleanupAudioOnly();
    if (btn) btn.textContent = 'Start Recording';
    if (statusEl) statusEl.textContent = `Microphone error: ${err?.message || err}. Check browser mic permission for this site.`;
    toast('Could not access microphone.');
  }
}

function hwStopAudioOnly() {
  const a = HW_STATE.aud;
  if (!a.recording) return;
  const elapsed = a.startedAt ? (performance.now() - a.startedAt) / 1000 : 0;
  const mr = a.mr;
  const pcmChunks = a.pcmChunks.slice();
  const pcmSr = a.pcmSr;

  const saveBlob = async blob => {
    hwCleanupAudioOnly();
    const take = hwBuildSubmissionSummary('audio', 'Audio-Only Recording', null, blob, elapsed, 0, {
      prompt: a.prompt,
      countIn: a.countIn,
      bpm: a.bpm,
    });
    await hwIdbPut(take);
    await hwRefreshTakes();
    hwMountAudioRunner();
    toast(`Audio take saved locally (${hwFmtBytes(take.audioBytes)})`);
  };

  if (mr && mr.state !== 'inactive') {
    mr.addEventListener('stop', () => {
      const blob = a.chunks.length
        ? new Blob(a.chunks, { type: mr.mimeType || 'audio/webm' })
        : hwDownsampleTo16kWav(pcmChunks, pcmSr);
      saveBlob(blob);
    }, { once: true });
    try { mr.stop(); } catch { saveBlob(hwDownsampleTo16kWav(pcmChunks, pcmSr)); }
  } else {
    saveBlob(hwDownsampleTo16kWav(pcmChunks, pcmSr));
  }
}

// ---------- Saved Takes Drawer (IndexedDB Offline Queue)
async function hwRefreshTakes() {
  try {
    HW_STATE.takes = await hwIdbAll();
  } catch (err) {
    console.error('IndexedDB load failed:', err);
    HW_STATE.takes = [];
  }
  hwRenderTakes();
}

function hwRenderTakes() {
  const host = $('#hw-takes-list');
  const countEl = $('#hw-takes-count');
  if (!host) return;
  if (countEl) countEl.textContent = `${HW_STATE.takes.length} saved locally`;

  if (!HW_STATE.takes.length) {
    host.innerHTML = `<div class="hw-empty">No takes recorded yet. Record a Sight Reading, Score Practice, or Audio-Only take above — it will persist here in IndexedDB even if you refresh the page offline.</div>`;
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
      id: t.id,
      type: t.type,
      overall_pct: t.overallPct,
      rhythm_pct: t.rhythmPct,
      pitch_pct: t.pitchPct,
      audio_mime: t.audioMime,
      audio_bytes: t.audioBytes,
      audio_duration_sec: t.durationSec,
      expected_sec: t.expectedSec,
      integrity_flags: t.integrityFlags,
      results_json: t.resultsJson,
      meta: t.meta,
    };

    return `<div class="hw-take-item" data-take="${esc(t.id)}">
      <div class="hw-take-top">
        <div>
          <strong>${esc(t.label)}</strong>
          <span class="muted small"> · ${esc(when)}</span>
        </div>
        <div class="hw-take-meta">
          ${t.overallPct != null ? `<span class="hw-pill score">Overall ${t.overallPct}% (R ${t.rhythmPct}%${t.pitchPct != null ? ` · P ${t.pitchPct}%` : ''})</span>` : ''}
          ${t.integrityFlags?.length ? `<span class="hw-pill flag">Flags: ${esc(t.integrityFlags.join(', '))}</span>` : ''}
          <span class="hw-pill offline">Saved on this ${esc(DEVICE)} — Ready to upload</span>
        </div>
      </div>
      <div class="hw-take-meta">
        <span>Audio: ${t.audioBytes ? `${esc(t.audioMime || 'audio')} · ${hwFmtBytes(t.audioBytes)} · ${t.durationSec}s` : 'None (tap mode)'}</span>
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
      if (HW_STATE.expandedJson.has(id)) HW_STATE.expandedJson.delete(id);
      else HW_STATE.expandedJson.add(id);
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

// ---------- Tab switcher & boot
function hwSwitchTab(tab) {
  if (HW_STATE.aud.recording) hwCleanupAudioOnly();
  if (typeof GR !== 'undefined' && GR.on) try { grStop(false); } catch { }
  HW_STATE.tab = tab;
  document.querySelectorAll('.hw-tab').forEach(b => b.classList.toggle('on', b.dataset.hwTab === tab));
  if (tab === 'sight') hwMountSightRunner();
  else if (tab === 'score') hwMountScoreRunner();
  else hwMountAudioRunner();
}

function hwBoot() {
  hwRenderDiagnostics();
  hwInstallEngineHooks(() => hwRefreshTakes());

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
}

document.addEventListener('DOMContentLoaded', hwBoot);
