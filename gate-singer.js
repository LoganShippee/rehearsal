'use strict';
/* Solfege Rocket — Pattern Solfege Space Arcade
   Sing multi-note solfege patterns to guide your rocket through a carved asteroid corridor.
   Powered directly by Rehearsal's solfege engine (sight.js), pitch detector (music.js),
   and singing tolerances / cues (grade.js). */

(() => {
  // Never overwrite the main Rehearsal app's saved settings from this prototype.
  if (typeof S !== 'undefined' && S) {
    S.settings = Object.assign({ gradeStrictPitch: 50, gradeStrictRhythm: 50 }, S.settings || {});
  }
  window.save = () => {};

  // ---------- Wave Progression & Musical Solfege Patterns ----------
  const WAVES = [
    {
      range: 'do-mi',
      label: 'do – mi · Steps',
      patterns: [
        { id: 'w1_up',    name: 'Step Up',      degs: [0, 1, 2] },
        { id: 'w1_down',  name: 'Step Down',    degs: [2, 1, 0] },
        { id: 'w1_arch',  name: 'Arch',         degs: [0, 1, 2, 1, 0] },
        { id: 'w1_neigh', name: 'Neighbor',     degs: [0, 1, 0, 2] },
        { id: 'w1_turn',  name: 'Turnaround',   degs: [2, 1, 2, 0] },
      ],
    },
    {
      range: 'do-sol',
      label: 'do – sol · Triad & Scale',
      patterns: [
        { id: 'w2_tri_u', name: 'Tonic Triad Up',   degs: [0, 2, 4] },
        { id: 'w2_tri_d', name: 'Tonic Triad Down', degs: [4, 2, 0] },
        { id: 'w2_tri_a', name: 'Triad Arch',       degs: [0, 2, 4, 2, 0] },
        { id: 'w2_pen_u', name: 'Pentachord Up',    degs: [0, 1, 2, 3, 4] },
        { id: 'w2_pen_d', name: 'Pentachord Down',  degs: [4, 3, 2, 1, 0] },
        { id: 'w2_skip',  name: 'Skip & Step',      degs: [0, 2, 3, 4, 2] },
      ],
    },
    {
      range: 'do-la',
      label: 'do – la · Pentatonic',
      patterns: [
        { id: 'w3_slsm',  name: 'Sol–La–Sol–Mi',    degs: [4, 5, 4, 2] },
        { id: 'w3_climb', name: 'Pentatonic Climb', degs: [0, 2, 4, 5, 4] },
        { id: 'w3_fall',  name: 'Falling 6th',      degs: [5, 4, 3, 2, 0] },
        { id: 'w3_camp',  name: 'Campfire Motif',   degs: [0, 1, 2, 4, 5] },
        { id: 'w3_sub',   name: 'Subdominant Arch', degs: [0, 3, 5, 4, 2] },
      ],
    },
    {
      range: 'octave',
      label: 'do – high do · Octave',
      patterns: [
        { id: 'w4_arp_u', name: 'Full Arpeggio Up',   degs: [0, 2, 4, 7] },
        { id: 'w4_arp_d', name: 'Full Arpeggio Down', degs: [7, 4, 2, 0] },
        { id: 'w4_up4',   name: 'Upper Tetrachord',   degs: [4, 5, 6, 7] },
        { id: 'w4_dn4',   name: 'High Descent',       degs: [7, 6, 5, 4] },
        { id: 'w4_oct',   name: 'Octave Leap',        degs: [0, 4, 7, 5, 4] },
      ],
    },
    {
      range: 'lowsol-do',
      label: 'low sol – high do · Cadences',
      patterns: [
        { id: 'w5_pick',  name: 'Low Sol Pickup',    degs: [-3, 0, 2, 4] },
        { id: 'w5_cad',   name: 'Authentic Cadence', degs: [2, 1, 0, -1, 0] },
        { id: 'w5_dom',   name: 'Dominant Bounce',   degs: [0, -3, 0, 2, 4] },
        { id: 'w5_wide',  name: 'Wide Arpeggio',     degs: [-3, 0, 4, 7] },
        { id: 'w5_grand', name: 'Grand Descent',     degs: [7, 4, 2, 0, -3] },
      ],
    },
  ];

  const ALL_PATTERNS = WAVES.flatMap((w, wi) => w.patterns.map(p => Object.assign({ waveIdx: wi }, p)));
  const BEST_KEY = 'rehearsal_gate_singer_pat_best';
  const CFG_KEY = 'rehearsal_gate_singer_cfg_v1';

  // ---------- Editable Live Config (persisted in localStorage, saveable & uploadable as JSON) ----------
  const DEFAULT_CFG = {
    baseSpeed: 185,
    speedPerWave: 15,
    gateGapX: 245,
    patternGapX: 260,
    leadInX: 420,
    openingH: 180,
    pipeW: 58,
    rockCount: 8,
    rockSpread: 240,
    rockOverlap: 60,
    lookRock: true,
    lookCrystal: true,
    lookIron: true,
    lookIce: true,
    rockDriftSpeed: 130,
    rockDriftAmp: 19,
    rockSpin: 200,
    ambientCount: 26,
    debrisCount: 18,
    debrisSpeed: 220,
    steerSpeed: 10,
    spaceDrag: 7,
    birdXFrac: 20,
    showContour: false,
    pipeLabels: 'auto',
    guideVol: 145,
    droneVol: 120,
    musicVol: 75,
    sfxVol: 110,
    soundMaster: true,
    soundMusic: true,
    soundCharge: true,
    soundClear: true,
    soundFanfare: true,
    refA: 440,
    guideOct: 0,
    pitchCents: 60,
    exactOctave: true,
    lockFrames: 2,
    minClarity: 0.60,
    echoStepMs: 360,
    playMissModel: true,
    startWave: 1,
    patternsPerWave: 2,
    hearts: 3,
    streakForLife: 8,
    streakForBoost: 50,
    boostDur: 6,
    poolAll: false,
    disabledPatterns: [],
    customPatterns: '',
    customOnly: false,
  };

  function loadCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (raw && typeof raw === 'object') return Object.assign({}, DEFAULT_CFG, raw);
    } catch (_) {}
    return Object.assign({}, DEFAULT_CFG);
  }
  let CFG = loadCfg();
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (_) {}
  }

  // Parse custom solfege pattern lines like "do mi sol mi do" or "sol, do re mi do'"
  const SYL_TO_DEG = {
    do: 0, re: 1, mi: 2, me: 2, fa: 3, sol: 4, so: 4, la: 5, le: 5, ti: 6, te: 6,
  };
  function parseCustomPatterns(text) {
    if (!text || !text.trim()) return [];
    const out = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((rawLine, li) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;
      const tokens = line.split(/[\s,\-–—]+/).filter(Boolean);
      const degs = [];
      for (const tok of tokens) {
        let oct = 0;
        let t = tok.toLowerCase();
        if (t.endsWith("'")) { oct += 7; t = t.slice(0, -1); }
        else if (t.endsWith(',') || t.endsWith('_')) { oct -= 7; t = t.slice(0, -1); }
        else if (t.startsWith('high')) { oct += 7; t = t.slice(4); }
        else if (t.startsWith('low')) { oct -= 7; t = t.slice(3); }
        if (SYL_TO_DEG[t] !== undefined) degs.push(SYL_TO_DEG[t] + oct);
      }
      if (degs.length >= 1) {
        out.push({ id: `custom_${li + 1}`, name: `Custom #${out.length + 1}`, degs });
      }
    });
    return out;
  }

  // ---------- DOM Elements ----------
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const modeSel = document.getElementById('modeSel');
  const keySel = document.getElementById('keySel');
  const scaleSel = document.getElementById('scaleSel');
  const voiceSel = document.getElementById('voiceSel');
  const strictSel = document.getElementById('strictSel');
  const speedSel = document.getElementById('speedSel');
  const doBtn = document.getElementById('doBtn');
  const droneBtn = document.getElementById('droneBtn');
  const musicBtn = document.getElementById('musicBtn');
  const sfxBtn = document.getElementById('sfxBtn');
  const cueBtn = document.getElementById('cueBtn');
  const autoBtn = document.getElementById('autoBtn');
  const tuneBtn = document.getElementById('tuneBtn');
  const playBtn = document.getElementById('playBtn');

  const cueBar = document.getElementById('cueBar');
  const cueCard = document.getElementById('cueCard');
  const vexBox = document.getElementById('vexBox');
  const handBox = document.getElementById('handBox');
  const handImg = document.getElementById('handImg');
  const cueTag = document.getElementById('cueTag');
  const cuePrompt = document.getElementById('cuePrompt');
  const patPills = document.getElementById('patPills');
  const cueSub = document.getElementById('cueSub');

  const overlay = document.getElementById('overlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const modalStats = document.getElementById('modalStats');
  const stScore = document.getElementById('stScore');
  const stGates = document.getElementById('stGates');
  const stBest = document.getElementById('stBest');
  const startMicBtn = document.getElementById('startMicBtn');
  const startKeysBtn = document.getElementById('startKeysBtn');
  const startAutoBtn = document.getElementById('startAutoBtn');
  const micErr = document.getElementById('micErr');

  const micDot = document.getElementById('micDot');
  const micLabel = document.getElementById('micLabel');
  const pitchRead = document.getElementById('pitchRead');
  const centsZone = document.getElementById('centsZone');
  const centsPip = document.getElementById('centsPip');
  const hudWave = document.getElementById('hudWave');
  const hudRange = document.getElementById('hudRange');
  const hudStreak = document.getElementById('hudStreak');
  const hudMult = document.getElementById('hudMult');
  const hudCorrect = document.getElementById('hudCorrect');
  const hudTotal = document.getElementById('hudTotal');
  const hudScore = document.getElementById('hudScore');
  const hudHearts = document.getElementById('hudHearts');
  const hudLivesNum = document.getElementById('hudLivesNum');
  const heartsPill = document.getElementById('heartsPill');
  const healLabel = document.getElementById('healLabel');
  const healBar = document.getElementById('healBar');
  const boostProgPill = document.getElementById('boostProgPill');
  const boostLabel = document.getElementById('boostLabel');
  const boostBar = document.getElementById('boostBar');

  const tuneDrawer = document.getElementById('tuneDrawer');
  const tuneCloseBtn = document.getElementById('tuneCloseBtn');
  const patToggleList = document.getElementById('patToggleList');
  const cfgCopyBtn = document.getElementById('cfgCopyBtn');
  const cfgDownloadBtn = document.getElementById('cfgDownloadBtn');
  const cfgUploadBtn = document.getElementById('cfgUploadBtn');
  const cfgFileInput = document.getElementById('cfgFileInput');
  const cfgApplyBtn = document.getElementById('cfgApplyBtn');
  const cfgResetBtn = document.getElementById('cfgResetBtn');

  // Populate keys from Rehearsal's SR_KEYS
  SR_KEYS.forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k.replace('b', '♭');
    keySel.appendChild(opt);
  });

  // ---------- Game State ----------
  const G = {
    state: 'idle',
    inputMode: 'mic',
    autoPilot: false,
    W: 960,
    H: 500,
    dpr: 1,
    t: 0,
    lastTs: 0,

    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    patternsCleared: 0,
    gatesCleared: 0,
    gatesAttempted: 0,
    streak: 0,
    healStreak: 0,
    boostStreak: 0,
    boostTimer: 0,
    boostMax: 6,
    bestStreak: 0,
    hearts: CFG.hearts,
    waveIdx: CFG.startWave - 1,
    camMinDeg: 0,
    camMaxDeg: 2,
    camTargetMinDeg: 0,
    camTargetMaxDeg: 2,
    lastPatternId: '',

    bird: {
      x: 170,
      y: 260,
      vy: 0,
      tilt: 0,
      pitchOffset: 0,
      noteGrace: 0,
      targetY: 260,
      wing: 0,
      flapCooldown: 0,
      flapKick: 0,
      invuln: 0,
      glow: 0,
    },

    patterns: [],
    particles: [],
    popups: [],
    stars: [],
    ambientRocks: [],
    debris: [],
    shake: 0,
    scrollX: 0,

    audio: {
      stream: null,
      an: null,
      buf: null,
      lastPoll: 0,
      f: -1,
      midi: null,
      rms: 0,
      clarity: 0,
      agreeGateId: null,
      agreeCount: 0,
      lastErr: 0,
      lastSyl: '',
      lastSeenT: -99,
      // First-couple-notes octave calibration: accepts any octave on the opening 2 notes,
      // takes the median octave shift across those frames, then strictly enforces do' vs do & sol, vs sol!
      singerOctShift: null,
      anchorLocked: false,
      anchorVotes: [],
      anchorNotesDone: 0,
      recentMidis: [],
    },

    droneOn: false,
    droneOsc: null,
    droneGain: null,
    musicOn: true,
    musicBeatAcc: 0,
    musicStep: 0,
    nextGateUid: 1,
  };

  // ---------- Helpers: Solfege & Pitch Math ----------
  function currentClef() {
    return (voiceSel.value === 'bass' || voiceSel.value === 'lowbass') ? 'bass' : 'treble';
  }
  function voiceShift() {
    if (currentClef() === 'bass') return 0;
    return GR_VOICE_SHIFT[voiceSel.value] || 0;
  }
  function pitchTolCents() {
    return Math.max(15, Math.min(125, Number(CFG.pitchCents) || 60));
  }
  function pitchTolSemitones() {
    return pitchTolCents() / 100;
  }
  function tonicMidi() {
    const sp = srSpell(keySel.value, scaleSel.value, 0, currentClef());
    return grCueMidi(sp.midi + voiceShift());
  }
  function degreeInfo(d) {
    const sp = srSpell(keySel.value, scaleSel.value, d, currentClef());
    const sounding = sp.midi + voiceShift();
    const label = d >= 7 ? `${sp.syl}'` : d < 0 ? `${sp.syl},` : sp.syl;
    return {
      d,
      key: sp.key,
      midi: sp.midi,
      soundingMidi: sounding,
      cueMidi: grCueMidi(sounding),
      pc: ((sp.midi % 12) + 12) % 12,
      syl: sp.syl,
      label,
    };
  }
  function pcDiff(midiFloat, targetPc) {
    const mPc = ((midiFloat % 12) + 12) % 12;
    let diff = mPc - targetPc;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    return diff;
  }
  // Active octave shift combining the Voice selector + the singer's auto-anchored home octave
  function effectiveOctShift() {
    return G.audio.singerOctShift ?? 0;
  }

  // Signed semitone error against the target gate:
  // On the first couple notes (while calibrating the singer's natural voice octave), accepts any octave
  // so opening notes set your home octave cleanly. Once locked, strictly enforces do' vs do & sol, vs sol!
  function gatePitchDiff(midiFloat, gateInfo) {
    if (CFG.exactOctave && G.audio.anchorLocked) {
      const targetMidi = gateInfo.soundingMidi + effectiveOctShift();
      return midiFloat - targetMidi;
    }
    return pcDiff(midiFloat, gateInfo.pc);
  }

  // Single-frame mic octave-slip corrector (adapted from Rehearsal's grade.js):
  // If a single frame jumps ±12 semitones for 1–2 readings while surrounding frames sit in one octave,
  // fold the glitch back — without blocking real intentional leaps to do' or sol,!
  function fixMicOctaveSlip(rawMidi, nowSec) {
    const hist = G.audio.recentMidis;
    // Keep only recent readings within the last 0.22 s
    while (hist.length && (nowSec - hist[0].t) > 0.22) hist.shift();
    let midi = rawMidi;
    if (hist.length >= 3) {
      const sorted = hist.map(h => h.m).sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      const k = Math.round((med - rawMidi) / 12);
      // Only fold if it is almost an exact octave slip (within ±0.65 semitones of ±12/24)
      // AND we haven't already seen 2+ consecutive raw frames in the new octave (an intentional leap!)
      if (k !== 0 && Math.abs(rawMidi + 12 * k - med) < 0.65) {
        const tail = hist.slice(-2);
        const sustainedNewOct = tail.length === 2 && tail.every(h => Math.abs(h.raw - rawMidi) < 1.2);
        if (!sustainedNewOct) {
          midi = rawMidi + 12 * k;
        }
      }
    }
    hist.push({ t: nowSec, m: midi, raw: rawMidi });
    if (hist.length > 12) hist.shift();
    return midi;
  }

  function nearestScaleDegree(midiFloat) {
    const scale = scaleSel.value;
    const steps = SR_STEPS[scale];
    const syls = SR_SYL[scale];
    const tonicSounding = degreeInfo(0).soundingMidi + effectiveOctShift();
    let bestDiff = 999, bestSyl = 'do', bestLabel = 'do';
    // Search across full playable solfege span relative to the singer's home Do octave
    for (let d = -7; d <= 14; d++) {
      const octOff = Math.floor(d / 7);
      const degIdx = ((d % 7) + 7) % 7;
      const targetMidi = tonicSounding + octOff * 12 + steps[degIdx];
      const diff = midiFloat - targetMidi;
      if (Math.abs(diff) < Math.abs(bestDiff)) {
        bestDiff = diff;
        bestSyl = syls[degIdx];
        bestLabel = d >= 7 ? `${bestSyl}'` : d < 0 ? `${bestSyl},` : bestSyl;
      }
    }
    return { syl: bestSyl, label: bestLabel, diffSemitones: bestDiff, cents: Math.round(bestDiff * 100) };
  }

  // Vertical pitch camera: starts with the full do–do' scale on screen (even spacing per scale step,
  // gaps kept for unused notes) and only zooms out once notes beyond it, like low sol, show up.
  const FIXED_MIN_DEG = -3;
  const FIXED_MAX_DEG = 7;
  function computeTargetPitchRange() {
    let lo = Infinity;
    let hi = -Infinity;
    const includeDegs = (degs) => {
      for (const d of degs) {
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    };
    if (CFG.customOnly) {
      const cust = parseCustomPatterns(CFG.customPatterns);
      for (const p of cust) includeDegs(p.degs);
    } else if (CFG.poolAll) {
      for (const p of ALL_PATTERNS) includeDegs(p.degs);
    } else {
      const maxW = Math.max(0, Math.min(WAVES.length - 1, G.waveIdx));
      for (let wi = 0; wi <= maxW; wi++) {
        for (const p of WAVES[wi].patterns) includeDegs(p.degs);
      }
    }
    for (const pat of G.patterns) {
      for (const g of pat.gates) {
        if (g.info.d < lo) lo = g.info.d;
        if (g.info.d > hi) hi = g.info.d;
      }
    }
    // Always show the full do–do' scale; only widen (e.g. down to low sol) when a pattern needs it.
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 7; }
    return { lo: Math.min(0, lo), hi: Math.max(7, hi) };
  }
  function snapPitchCamera() {
    const { lo, hi } = computeTargetPitchRange();
    G.camTargetMinDeg = lo;
    G.camTargetMaxDeg = hi;
    G.camMinDeg = lo;
    G.camMaxDeg = hi;
  }
  function updatePitchCamera(dt) {
    const { lo, hi } = computeTargetPitchRange();
    // Zoom out monotonically during a run as new notes appear (never jarringly zoom back in mid-run)
    G.camTargetMinDeg = Math.min(G.camTargetMinDeg, lo);
    G.camTargetMaxDeg = Math.max(G.camTargetMaxDeg, hi);
    const alpha = 1 - Math.exp(-3.2 * dt);
    const prevLo = G.camMinDeg;
    const prevHi = G.camMaxDeg;
    G.camMinDeg += (G.camTargetMinDeg - G.camMinDeg) * alpha;
    G.camMaxDeg += (G.camTargetMaxDeg - G.camMaxDeg) * alpha;
    if (Math.abs(G.camTargetMinDeg - G.camMinDeg) < 0.002) G.camMinDeg = G.camTargetMinDeg;
    if (Math.abs(G.camTargetMaxDeg - G.camMaxDeg) < 0.002) G.camMaxDeg = G.camTargetMaxDeg;
    if (G.camMinDeg !== prevLo || G.camMaxDeg !== prevHi) {
      for (const pat of G.patterns) {
        for (const g of pat.gates) {
          g.cy = degreeToY(g.info.d);
          g.y0 = g.cy - g.h / 2;
          g.y1 = g.cy + g.h / 2;
        }
      }
    }
  }
  function degreeToY(d) {
    const span = Math.max(2, G.camMaxDeg - G.camMinDeg);
    // Zoomed-in early waves get comfortable breathing room; wider ranges expand to use ~85% of full height
    const padFrac = span <= 2.5 ? 0.17 : span <= 4.5 ? 0.13 : span <= 6.5 ? 0.105 : 0.08;
    const pad = Math.max(28, Math.min(96, G.H * padFrac));
    const norm = (d - G.camMinDeg) / span;
    return G.H - pad - norm * Math.max(80, G.H - pad * 2);
  }

  // ---------- Audio: Guide Synth, Charge-Up SFX, Harmony Ring Clears, Space Music, Drone ----------
  let guideBus = null;
  function ensureAudio() {
    const c = muAC();
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (!guideBus) {
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.12;
      comp.connect(c.destination);
      guideBus = comp;
    }
    return c;
  }
  function midiToHz(midi) {
    const refA = Number(CFG.refA) || 440;
    return refA * Math.pow(2, (midi - 69) / 12);
  }
  function playGuideTone(midi, dur = 0.55, startOffset = 0.02, relGain = 1) {
    if (!CFG.soundMaster) return;
    const vol = (Number(CFG.guideVol) || 0) / 100;
    if (vol <= 0.01) return;
    const c = ensureAudio();
    const t0 = c.currentTime + startOffset;
    const shifted = grCueMidi(midi + (Number(CFG.guideOct) || 0) * 12);
    const hz = midiToHz(shifted);
    const partials = [
      ['triangle', 1, 0.52],
      ['sine',     2, 0.22],
      ['sine',     3, 0.09],
    ];
    for (const [type, mul, amp0] of partials) {
      const osc = c.createOscillator();
      const g = c.createGain();
      const amp = amp0 * vol * relGain;
      osc.type = type;
      osc.frequency.value = hz * mul;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.014);
      g.gain.exponentialRampToValueAtTime(amp * 0.55, t0 + Math.min(0.35, dur * 0.65));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(guideBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }
  function playTonic() {
    playGuideTone(tonicMidi(), 0.78, 0.02, 1.05);
  }
  function playPatternCue(pat) {
    if (!pat) return;
    const stepSec = Math.max(0.15, (Number(CFG.echoStepMs) || 360) / 1000);
    pat.gates.forEach((g, i) => {
      playGuideTone(g.info.cueMidi, stepSec * 0.92, 0.04 + i * stepSec, 1.0);
    });
  }

  // Rising sci-fi harmonic charge-up sweep when locking onto an approaching ring
  function playLockChargeSfx(targetMidi, timeToImpactSec = 0.45) {
    if (!CFG.soundMaster || !CFG.soundCharge) return;
    const vol = (Number(CFG.sfxVol) ?? 110) / 100;
    if (vol <= 0.01) return;
    const c = ensureAudio();
    const now = c.currentTime;
    const dur = Math.max(0.14, Math.min(0.42, timeToImpactSec * 0.75));
    const endHz = midiToHz(grCueMidi(targetMidi + (Number(CFG.guideOct) || 0) * 12));
    const startHz = endHz * 0.75;

    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const filt = c.createBiquadFilter();
    const g = c.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + dur);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(startHz * 2, now);
    osc2.frequency.exponentialRampToValueAtTime(endHz * 2, now + dur);

    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(endHz * 1.5, now);
    filt.frequency.exponentialRampToValueAtTime(endHz * 4, now + dur);
    filt.Q.value = 1.6;

    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.14 * vol, now + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.04);

    osc.connect(filt);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    osc2.connect(g2); g2.connect(filt);
    filt.connect(g); g.connect(guideBus);

    osc.start(now); osc2.start(now);
    osc.stop(now + dur + 0.06); osc2.stop(now + dur + 0.06);
  }

  // Lush in-key musical chord/bell stab right as the rocket clears a ring
  function playSmashSfx(targetMidi, scaleDeg = 0) {
    if (!CFG.soundMaster || !CFG.soundClear) return;
    const vol = (Number(CFG.sfxVol) ?? 110) / 100;
    if (vol <= 0.01) return;
    const c = ensureAudio();
    const now = c.currentTime;
    const baseMidi = grCueMidi(targetMidi + (Number(CFG.guideOct) || 0) * 12);
    const isMinor = scaleSel.value === 'minor';
    const thirdInt = (scaleDeg === 0 || scaleDeg === 3 || scaleDeg === 4) ? (isMinor && scaleDeg !== 4 ? 3 : 4) : 3;
    const chord = G.streak >= 4
      ? [baseMidi, baseMidi + thirdInt, baseMidi + 7, baseMidi + 12]
      : [baseMidi, baseMidi + 7, baseMidi + 12];

    chord.forEach((m, i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = midiToHz(m);
      const t0 = now + i * 0.016;
      const peak = (i === 0 ? 0.24 : 0.14 / i) * vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(peak * 0.38, t0 + 0.14);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.44);
      osc.connect(g); g.connect(guideBus);
      osc.start(t0);
      osc.stop(t0 + 0.46);
    });
  }

  // Beat-synced ambient outer-space backing groove (locked to active key & gate tempo)
  function playSpaceMusicPulse(step, beatDur) {
    if (!CFG.soundMaster || !CFG.soundMusic || !G.musicOn) return;
    const vol = (Number(CFG.musicVol) ?? 75) / 100;
    if (vol <= 0.01) return;
    const c = ensureAudio();
    const now = c.currentTime;
    const steps = SR_STEPS[scaleSel.value] || SR_STEPS.major;
    const root = tonicMidi() - 12;
    const bassRoot = root < 36 ? root + 12 : root;

    const degCycle = [0, 4, 2, 4];
    const bassDeg = step % 8 < 4 ? 0 : (step % 8 < 6 ? 3 : 4);
    const bassMidi = bassRoot + steps[bassDeg % 7];

    if (step % 2 === 0) {
      const osc = c.createOscillator();
      const filt = c.createBiquadFilter();
      const g = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToHz(bassMidi);
      filt.type = 'lowpass';
      filt.frequency.value = 340;
      const dur = Math.min(0.45, beatDur * 0.9);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.16 * vol, now + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(filt); filt.connect(g); g.connect(guideBus);
      osc.start(now); osc.stop(now + dur + 0.02);
    }

    const arpMidi = grCueMidi(tonicMidi() + steps[degCycle[step % degCycle.length]] + 12);
    const aOsc = c.createOscillator();
    const aFilt = c.createBiquadFilter();
    const aGain = c.createGain();
    aOsc.type = 'sine';
    aOsc.frequency.value = midiToHz(arpMidi);
    aFilt.type = 'lowpass';
    aFilt.frequency.value = 1400;
    const aDur = Math.min(0.32, beatDur * 0.65);
    aGain.gain.setValueAtTime(0.0001, now);
    aGain.gain.linearRampToValueAtTime(0.065 * vol, now + 0.01);
    aGain.gain.exponentialRampToValueAtTime(0.0001, now + aDur);
    aOsc.connect(aFilt); aFilt.connect(aGain); aGain.connect(guideBus);
    aOsc.start(now); aOsc.stop(now + aDur + 0.02);
  }

  // Sparkling arcade Star-Power arpeggio pulse during Hyperdrive Boost
  function playStarBoostNote(step) {
    if (!CFG.soundMaster || !CFG.soundMusic) return;
    const vol = Math.max(0.25, ((Number(CFG.musicVol) ?? 75) + (Number(CFG.sfxVol) ?? 110)) / 200);
    const c = ensureAudio();
    const now = c.currentTime;
    const steps = SR_STEPS[scaleSel.value] || SR_STEPS.major;
    const arp = [0, 2, 4, 7, 4, 2, 5, 7];
    const d = arp[step % arp.length];
    const midi = grCueMidi(tonicMidi() + steps[d % 7] + (d >= 7 ? 12 : 0) + 12);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(midi);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.14 * vol, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(g); g.connect(guideBus);
    osc.start(now); osc.stop(now + 0.16);
  }

  function triggerHyperdriveBoost() {
    const dur = Math.max(3, Number(CFG.boostDur) || 6);
    G.boostTimer = dur;
    G.boostMax = dur;
    G.boostStreak = 0;
    G.shake = 0.45;
    spawnBurst(G.bird.x, G.bird.y, '#fde047', 34);
    spawnBurst(G.bird.x, G.bird.y, '#c084fc', 24);
    spawnPopup(G.W * 0.5, G.H * 0.24, '⚡ HYPERDRIVE BOOST! NO SINGING NEEDED! ⚡', '#fde047');
    playPatternClearFanfare();
    syncHud();
  }

  function playPatternClearFanfare() {
    if (!CFG.soundMaster || !CFG.soundFanfare) return;
    const root = tonicMidi();
    [root, root + 4, root + 7, root + 12].forEach((m, i) => {
      playGuideTone(m, 0.28, i * 0.075, 0.72);
    });
  }

  function playBonkSfx(trueCueMidi) {
    if (!CFG.soundMaster) return;
    if (CFG.soundClear || CFG.soundCharge) {
      const c = ensureAudio();
      const now = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(175, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.16);
      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(g); g.connect(guideBus);
      osc.start(now); osc.stop(now + 0.2);
    }
    if (CFG.playMissModel) {
      playGuideTone(trueCueMidi, 0.5, 0.2, 0.95);
    }
  }

  function stopDrone() {
    G.droneOn = false;
    droneBtn.classList.remove('active');
    if (G.droneOsc) {
      try {
        const c = muAC();
        G.droneGain.gain.setTargetAtTime(0.0001, c.currentTime, 0.05);
        G.droneOsc.stop(c.currentTime + 0.18);
      } catch (_) {}
      G.droneOsc = null;
      G.droneGain = null;
    }
  }
  function updateDroneGain() {
    if (!G.droneOn || !G.droneGain) return;
    const c = muAC();
    const v = Math.max(0.0001, 0.14 * ((Number(CFG.droneVol) || 0) / 100));
    G.droneGain.gain.setTargetAtTime(v, c.currentTime, 0.05);
  }
  function toggleDrone() {
    if (G.droneOn) { stopDrone(); return; }
    const c = ensureAudio();
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const filt = c.createBiquadFilter();
    const g = c.createGain();
    const hz = midiToHz(grCueMidi(tonicMidi() + (Number(CFG.guideOct) || 0) * 12));
    osc.type = 'triangle';
    osc.frequency.value = hz;
    osc2.type = 'sine';
    osc2.frequency.value = hz * 1.5;
    filt.type = 'lowpass';
    filt.frequency.value = 680;
    const targetGain = Math.max(0.0001, 0.14 * ((Number(CFG.droneVol) || 120) / 100));
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(targetGain, c.currentTime + 0.25);
    osc.connect(filt);
    const g5 = c.createGain(); g5.gain.value = 0.28;
    osc2.connect(g5); g5.connect(filt);
    filt.connect(g); g.connect(guideBus);
    osc.start(); osc2.start();
    const origStop = osc.stop.bind(osc);
    osc.stop = t => { origStop(t); try { osc2.stop(t); } catch (_) {} };
    G.droneOsc = osc;
    G.droneGain = g;
    G.droneOn = true;
    droneBtn.classList.add('active');
  }

  async function startMic() {
    micErr.classList.remove('show');
    if (G.audio.stream) return true;
    const c = ensureAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = c.createMediaStreamSource(stream);
      const an = c.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      G.audio.stream = stream;
      G.audio.an = an;
      G.audio.buf = new Float32Array(2048);
      micDot.classList.add('live');
      micLabel.textContent = 'Mic live';
      return true;
    } catch (e) {
      micErr.textContent = muMicErrMsg(e);
      micErr.classList.add('show');
      return false;
    }
  }

  // ---------- Varied Space Obstacles, Ambient Field & Fast Debris ----------
  function enabledObstacleKinds() {
    const out = [];
    if (CFG.lookRock) out.push('rock');
    if (CFG.lookCrystal) out.push('crystal');
    if (CFG.lookIron) out.push('iron');
    if (CFG.lookIce) out.push('ice');
    return out.length ? out : ['rock'];
  }
  function effectiveKind(shape) {
    const kinds = enabledObstacleKinds();
    if (kinds.includes(shape.kind)) return shape.kind;
    return kinds[Math.abs(shape.kindSeed || 0) % kinds.length];
  }

  function makeRockShape(seed, radius, forceKind = null) {
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const kinds = enabledObstacleKinds();
    const kindSeed = Math.floor(rnd() * 997);
    const kind = forceKind || kinds[kindSeed % kinds.length];
    const n = kind === 'crystal' ? 7 : kind === 'iron' ? 8 : 10;
    const verts = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rr = kind === 'crystal'
        ? radius * (i % 2 === 0 ? (0.95 + rnd() * 0.25) : (0.58 + rnd() * 0.20))
        : radius * (0.74 + rnd() * 0.36);
      verts.push({ x: Math.cos(ang) * rr, y: Math.sin(ang) * rr });
    }
    const craters = Array.from({ length: 3 }, () => ({
      x: (rnd() - 0.5) * radius * 0.85,
      y: (rnd() - 0.5) * radius * 0.85,
      r: radius * (0.14 + rnd() * 0.16),
    }));
    return {
      kind,
      kindSeed,
      verts,
      craters,
      r: radius,
      ang: rnd() * Math.PI * 2,
      spin: (rnd() < 0.5 ? -1 : 1) * (0.10 + rnd() * 0.24),
      wxAmp: (rnd() < 0.5 ? -1 : 1) * (5 + rnd() * 10),
      wyAmp: (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 9),
      wxFreq: 0.22 + rnd() * 0.32,
      wyFreq: 0.20 + rnd() * 0.30,
      phaseX: rnd() * Math.PI * 2,
      phaseY: rnd() * Math.PI * 2,
    };
  }

  function makeRockDecor(seed) {
    const baseR = Math.max(16, Math.min(48, (Number(CFG.pipeW) || 64) * 0.48));
    let s = (seed * 1103515245 + 12345) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const mkCluster = (sideSign, offsetSeed) => {
      const rocks = [];
      // First 8 hug the path (rock count slider); the rest keep stacking outward to fill the screen edge.
      for (let i = 0; i < 24; i++) {
        const r = baseR * (i === 0 ? 0.98 : (0.50 + rnd() * 0.58));
        const dxNorm = i === 0 ? 0 : (rnd() - 0.5);
        const extraDist = i === 0 ? 0 : (24 + i * 26 + rnd() * 38);
        rocks.push({
          dxNorm,
          extraDist,
          side: sideSign,
          shape: makeRockShape(offsetSeed + i * 17, r),
        });
      }
      return rocks;
    };
    return {
      topCluster: mkCluster(-1, seed * 101 + 1),
      botCluster: mkCluster(1, seed * 101 + 53),
    };
  }

  function rebuildAmbientRocks() {
    const target = Math.max(0, Math.min(60, Number(CFG.ambientCount) || 0));
    G.ambientRocks = [];
    for (let i = 0; i < target; i++) {
      const depth = 0.16 + Math.random() * 0.42;
      G.ambientRocks.push({
        x: Math.random() * G.W,
        y: 30 + Math.random() * (G.H - 60),
        vx: 3 + Math.random() * 10,
        vy: (Math.random() - 0.5) * 6,
        depth,
        alpha: 0.16 + depth * 0.30,
        shape: makeRockShape(900 + i, 8 + depth * 20),
      });
    }
  }

  function rebuildDebris() {
    const target = Math.max(0, Math.min(50, Number(CFG.debrisCount) || 0));
    const types = ['panel', 'shard', 'pebble', 'streak'];
    G.debris = [];
    for (let i = 0; i < target; i++) {
      const type = types[i % types.length];
      G.debris.push({
        type,
        x: Math.random() * G.W,
        y: 24 + Math.random() * (G.H - 48),
        speedMul: 0.78 + Math.random() * 0.72,
        vy: (Math.random() - 0.5) * 26,
        size: type === 'panel' ? (8 + Math.random() * 7) : type === 'shard' ? (5 + Math.random() * 6) : (2.5 + Math.random() * 4),
        ang: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random() * 4.2),
        alpha: 0.32 + Math.random() * 0.48,
        hue: type === 'panel' ? '#38bdf8' : type === 'shard' ? '#cbd5e1' : type === 'streak' ? '#a78bfa' : '#94a3b8',
      });
    }
  }

  // ---------- Pattern Pool & Spawning ----------
  function activeWave() {
    return WAVES[Math.min(G.waveIdx, WAVES.length - 1)];
  }
  function pickCueMode() {
    const m = modeSel.value;
    if (m !== 'mix') return m;
    const pool = ['read', 'hear', 'leap'];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function getEligiblePatterns() {
    const custom = parseCustomPatterns(CFG.customPatterns);
    if (CFG.customOnly && custom.length) return custom;
    const disabled = new Set(CFG.disabledPatterns || []);
    let builtIn = CFG.poolAll
      ? ALL_PATTERNS.filter(p => !disabled.has(p.id))
      : activeWave().patterns.filter(p => !disabled.has(p.id));
    if (!builtIn.length && !custom.length) builtIn = activeWave().patterns;
    return [...builtIn, ...custom];
  }

  function spawnPattern(startX) {
    const pool = getEligiblePatterns();
    let cand = pool.filter(p => p.id !== G.lastPatternId);
    if (!cand.length) cand = pool;
    const picked = cand[Math.floor(Math.random() * cand.length)];
    G.lastPatternId = picked.id;

    const cueMode = pickCueMode();
    const gateH = Number(CFG.openingH) || 104;
    const gateW = Number(CFG.pipeW) || 64;
    const gapX = Number(CFG.gateGapX) || 182;
    // Interval-aware spacing: steps sit closer, bigger leaps get more room so the
    // rocket's path climbs/dives on a gentler slope instead of a sharp spike.
    // Leaps (do–sol, do–do') get much more room, and every gap is at least ~1.2× its vertical climb
    // on screen, so the path never turns steeper than about 40° whatever the zoom.
    const pxPerDeg = Math.abs(degreeToY(0) - degreeToY(1));
    const gapFor = n => Math.max(
      gapX * (n <= 1 ? 0.78 : Math.min(2.5, 1.0 + (n - 2) * 0.3)),
      n * pxPerDeg * 1.2
    );
    let runX = startX;

    const gates = picked.degs.map((d, idx) => {
      const lead = idx === 0 ? 0 : gapFor(Math.abs(d - picked.degs[idx - 1]));
      runX += lead;
      const info = degreeInfo(d);
      const cy = degreeToY(d);
      const uid = G.nextGateUid++;
      return {
        uid,
        idx,
        info,
        x: runX,
        lead: lead || gapX,
        w: gateW,
        cy,
        y0: cy - gateH / 2,
        y1: cy + gateH / 2,
        h: gateH,
        rock: makeRockDecor(uid),
        locked: false,
        lockProgress: 0,
        status: 'pending',
        hitSide: null,
        hitFlash: 0,
        sungSyl: '',
      };
    });

    // Breath-space asteroids occupying the break BEFORE this pattern, strictly outside globalPathYAt(x)
    const breathGap = Math.max(110, Number(CFG.patternGapX) || 260);
    const breathRocks = [];
    // Twice as many rocks in the break, scattered all the way to the screen edges
    const breathCount = 2 * Math.max(4, Math.round(breathGap / 44));
    for (let i = 0; i < breathCount; i++) {
      const uid = G.nextGateUid++;
      const frac = (i + 0.5) / breathCount;
      const bx = startX - breathGap + frac * (breathGap - 20) + (Math.random() - 0.5) * 22;
      const side = (i % 2 === 0) ? -1 : 1;
      const extraDist = i < breathCount / 2 ? 18 + Math.random() * 75 : 60 + Math.random() * Math.max(120, G.H * 0.9);
      const baseR = Math.max(16, Math.min(44, (Number(CFG.pipeW) || 64) * (0.34 + Math.random() * 0.24)));
      breathRocks.push({
        x: bx,
        side,
        extraDist,
        pushY: 0,
        vy: 0,
        shape: makeRockShape(uid * 13, baseR),
      });
    }

    const pat = {
      name: picked.name,
      cueMode,
      gates,
      breathRocks,
      cued: false,
      completed: false,
      hadMiss: false,
      endX: gates[gates.length - 1].x + gateW,
    };
    G.patterns.push(pat);
    return pat;
  }

  function activePattern() {
    return G.patterns.find(p => !p.completed) || null;
  }
  function activeGate(pat) {
    if (!pat) return null;
    return pat.gates.find(g => g.status === 'pending') || null;
  }

  // ---------- Cue Card Rendering ----------
  function renderVexPattern(pat) {
    vexBox.innerHTML = '';
    if (!window.Vex || !Vex.Flow) {
      vexBox.textContent = pat.gates.map(g => g.info.label).join(' ');
      return;
    }
    const VF = Vex.Flow;
    const width = Math.max(195, 68 + pat.gates.length * 32);
    const renderer = new VF.Renderer(vexBox, VF.Renderer.Backends.SVG);
    renderer.resize(width, 68);
    const vctx = renderer.getContext();
    vctx.scale(0.76, 0.76);
    const clef = currentClef();
    const stave = new VF.Stave(4, -6, Math.round(width / 0.76) - 10);
    stave.addClef(clef);
    const vfKey = scaleSel.value === 'minor' ? (keySel.value + 'm') : keySel.value;
    try { stave.addKeySignature(vfKey); } catch (_) {}
    stave.setContext(vctx).draw();

    const cur = activeGate(pat);
    const notes = pat.gates.map(g => {
      const n = new VF.StaveNote({ clef, keys: [g.info.key], duration: 'q' });
      const col = g.status === 'cleared' ? '#10b981'
        : g.status === 'missed' ? '#f43f5e'
        : (cur && g.uid === cur.uid) ? '#0284c7'
        : '#334155';
      n.setStyle({ fillStyle: col, strokeStyle: col });
      return n;
    });
    const voice = new VF.Voice({ num_beats: notes.length, beat_value: 4 }).setStrict(false);
    voice.addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], Math.round(width / 0.76) - 80);
    voice.draw(vctx, stave);
  }

  function updateCueCard(pat) {
    if (!pat) {
      const wasVisible = !cueCard.classList.contains('hidden');
      cueCard.classList.add('hidden');
      if (wasVisible) resize();
      return;
    }
    const wasHidden = cueCard.classList.contains('hidden');
    cueCard.classList.remove('hidden');
    if (wasHidden) resize();
    const cur = activeGate(pat);

    vexBox.classList.add('hidden');
    handBox.classList.add('hidden');

    if (pat.cueMode === 'read') {
      cueTag.textContent = `READ PATTERN · ${pat.name.toUpperCase()}`;
      cuePrompt.textContent = `Key of ${keySel.value.replace('b', '♭')} ${scaleSel.value}`;
      cueSub.textContent = 'Sing each note in order to clear its circle';
      vexBox.classList.remove('hidden');
      renderVexPattern(pat);
    } else if (pat.cueMode === 'hear') {
      cueTag.textContent = 'ECHO PATTERN · LISTEN & SING';
      cuePrompt.textContent = pat.name;
      cueSub.textContent = 'Sing back the pattern (press R or ↻ Cue to replay)';
    } else {
      cueTag.textContent = `SOLFEGE PATTERN · ${pat.name.toUpperCase()}`;
      cuePrompt.textContent = cur ? `Next: ${cur.info.label.toUpperCase()}` : 'Pattern complete!';
      cueSub.textContent = 'Sing each solfege syllable in order';
      if (cur) {
        handImg.src = `vendor/hands/${cur.info.syl}.png`;
        handImg.alt = cur.info.syl;
        handBox.classList.remove('hidden');
      }
    }

    patPills.innerHTML = pat.gates.map(g => {
      const isCur = cur && g.uid === cur.uid;
      const cls = g.status === 'cleared' ? 'done'
        : g.status === 'missed' ? 'miss'
        : isCur ? 'active' : '';
      const showSyl = pat.cueMode === 'leap' || g.status !== 'pending';
      const txt = showSyl ? g.info.label.toUpperCase() : '?';
      return `<span class="pat-pill ${cls}">${txt}</span>`;
    }).join('');
  }

  function triggerPatternCue(pat) {
    if (!pat || pat.cued) return;
    pat.cued = true;
    updateCueCard(pat);
    if (pat.cueMode === 'hear') {
      playPatternCue(pat);
    }
  }

  // ---------- Live Pitch Polling (Fast 60 Hz Fresh-Window Detection) ----------
  function pollPitch(nowMs) {
    if (G.autoPilot || G.boostTimer > 0 || G.inputMode !== 'mic' || !G.audio.an) return;
    if (nowMs - G.audio.lastPoll < 12) return;
    G.audio.lastPoll = nowMs;

    const an = G.audio.an;
    const buf = G.audio.buf;
    an.getFloatTimeDomainData(buf);
    const freshBuf = buf.subarray(buf.length - 1536);
    const sr = muAC().sampleRate;
    const opts = Object.assign({}, GR_PITCH_OPTS, {
      minClarity: Number(CFG.minClarity) || 0.6,
      octaveFix: true,
    });
    const res = muDetectPitch(freshBuf, sr, GR_MIN_RMS, opts);

    G.audio.rms = res.rms;
    G.audio.clarity = res.clarity;
    G.audio.f = res.f;

    if (!(res.f > 0)) {
      G.audio.midi = null;
      G.audio.agreeCount = Math.max(0, G.audio.agreeCount - 1);
      pitchRead.textContent = '-- · --';
      centsPip.style.left = 'calc(50% - 4px)';
      centsPip.style.background = 'var(--muted)';
      return;
    }

    const refA = Number(CFG.refA) || 440;
    const rawMidi = 69 + 12 * Math.log2(res.f / refA);
    const midi = fixMicOctaveSlip(rawMidi, G.t);
    G.audio.midi = midi;

    // Collect octave votes across the first couple of notes so any voice range locks its home Do octave reliably!
    const pat = activePattern();
    const gate = activeGate(pat);
    if (G.state === 'playing' && CFG.exactOctave && !G.audio.anchorLocked && gate && gate.x <= G.W + 120) {
      if (Math.abs(pcDiff(midi, gate.info.pc)) <= pitchTolSemitones() && res.clarity >= 0.65) {
        const octShift = Math.round((midi - gate.info.soundingMidi) / 12) * 12;
        G.audio.anchorVotes.push(octShift);
        // Live provisional anchor = median of votes so far
        const sorted = G.audio.anchorVotes.slice().sort((a, b) => a - b);
        G.audio.singerOctShift = sorted[sorted.length >> 1];
      }
    }

    const deg = nearestScaleDegree(midi);
    const noteStr = grName(midi);
    const sign = deg.cents >= 0 ? '+' : '';
    pitchRead.textContent = `${noteStr} · ${deg.label} (${sign}${deg.cents}¢)`;

    const clamped = Math.max(-60, Math.min(60, deg.cents));
    const pct = 50 + (clamped / 60) * 46;
    centsPip.style.left = `calc(${pct.toFixed(1)}% - 4px)`;
    const inTol = Math.abs(deg.diffSemitones) <= pitchTolSemitones();
    centsPip.style.background = inTol ? 'var(--success)' : 'var(--warning)';

    if (G.state !== 'playing') return;
    if (!gate) return;
    if (gate.x > G.W + 120) return;

    const signedErr = gatePitchDiff(midi, gate.info);
    G.audio.lastErr = signedErr;
    G.audio.lastSyl = deg.label;
    G.audio.lastSeenT = G.t;

    if (gate.locked) return;

    const err = Math.abs(signedErr);
    const baseNeed = Math.max(1, Number(CFG.lockFrames) || 2);
    const dist = (gate.x + gate.w * 0.5) - G.bird.x;
    const fastClearLock = (res.clarity >= 0.78 && err <= pitchTolSemitones() * 0.75 && dist < 110);
    const needFrames = fastClearLock ? 1 : baseNeed;

    if (err <= pitchTolSemitones()) {
      if (G.audio.agreeGateId === gate.uid) {
        G.audio.agreeCount = Math.min(8, G.audio.agreeCount + 1);
      } else {
        G.audio.agreeGateId = gate.uid;
        G.audio.agreeCount = 1;
      }
      if (G.audio.agreeCount >= needFrames) {
        lockGate(gate);
      }
    } else {
      G.audio.agreeCount = Math.max(0, G.audio.agreeCount - 1);
    }
  }

  function emitThrusterSparks(count = 4) {
    const colors = G.boostTimer > 0
      ? ['#fde047', '#f472b6', '#38bdf8', '#34d399', '#c084fc']
      : ['#fbbf24', '#fb923c', '#38bdf8', '#fef08a'];
    for (let i = 0; i < count; i++) {
      if (G.particles.length >= 160) G.particles.shift();
      G.particles.push({
        x: G.bird.x - 24,
        y: G.bird.y + (Math.random() - 0.5) * 9,
        vx: -120 - Math.random() * 110,
        vy: (Math.random() - 0.5) * 45,
        size: 2.2 + Math.random() * 3.2,
        color: colors[i % colors.length],
        life: 0.22 + Math.random() * 0.16,
        maxLife: 0.38,
      });
    }
  }

  function lockGate(gate) {
    if (!gate || gate.locked || gate.status !== 'pending') return;
    gate.locked = true;
    gate.lockProgress = 1;
    G.bird.targetY = gate.cy;
    G.bird.flapKick = 1;
    G.bird.glow = 1;
    emitThrusterSparks(6);
    if (G.boostTimer <= 0) {
      const base = Number(CFG.baseSpeed) || 185;
      const perWave = Number(CFG.speedPerWave) || 15;
      const speed = Math.max(60, (base + G.waveIdx * perWave) * (Number(speedSel.value) || 1.25));
      const dist = Math.max(20, (gate.x + gate.w * 0.5) - G.bird.x);
      playLockChargeSfx(gate.info.cueMidi, dist / speed);
    }
  }

  // ---------- Particles & Popups ----------
  function spawnBurst(x, y, color, count = 20) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 70 + Math.random() * 230;
      if (G.particles.length >= 160) G.particles.shift();
      G.particles.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3 + Math.random() * 5,
        color,
        life: 0.4 + Math.random() * 0.35,
        maxLife: 0.75,
      });
    }
  }
  function spawnPopup(x, y, text, color) {
    let sy = y;
    for (let i = 0; i < G.popups.length; i++) {
      const o = G.popups[i];
      if (Math.abs(o.x - x) < 120 && Math.abs(o.y - sy) < 24) sy = o.y + 26;
    }
    sy = Math.max(28, Math.min(G.H - 24, sy));
    G.popups.push({ x, y: sy, text, color, life: 0.95, maxLife: 0.95 });
    if (G.popups.length > 10) G.popups.shift();
  }

  // ---------- Game Lifecycle & HUD ----------
  function syncHud() {
    const wave = activeWave();
    hudWave.textContent = String(G.waveIdx + 1);
    hudRange.textContent = CFG.customOnly ? 'Custom Patterns' : (CFG.poolAll ? 'All Patterns' : wave.label);
    hudStreak.textContent = String(G.streak);
    const mult = Math.min(5, 1 + Math.floor(G.streak / 4));
    hudMult.textContent = `${mult}×`;
    if (hudCorrect) hudCorrect.textContent = String(G.gatesCleared);
    if (hudTotal) hudTotal.textContent = ` / ${G.gatesAttempted}`;
    hudScore.textContent = String(G.score);

    const maxH = Math.max(1, Number(CFG.hearts) || 3);
    hudHearts.textContent = '❤️'.repeat(Math.max(0, G.hearts)) + '🖤'.repeat(Math.max(0, maxH - G.hearts));
    if (hudLivesNum) hudLivesNum.textContent = `${Math.max(0, G.hearts)}/${maxH}`;

    const needHeal = Math.max(3, Number(CFG.streakForLife) || 8);
    if (healLabel && healBar) {
      if (G.hearts < maxH) {
        healLabel.textContent = `Next ❤️: ${G.healStreak}/${needHeal}`;
        healBar.style.width = `${Math.min(100, (G.healStreak / needHeal) * 100)}%`;
      } else {
        healLabel.textContent = '❤️ Full';
        healBar.style.width = '100%';
      }
    }

    const needBoost = Math.max(5, Number(CFG.streakForBoost) || 30);
    if (boostProgPill && boostLabel && boostBar) {
      if (G.boostTimer > 0) {
        boostProgPill.classList.add('active');
        boostLabel.textContent = `⚡ HYPERDRIVE ${G.boostTimer.toFixed(1)}s`;
        boostBar.style.width = `${Math.max(0, Math.min(100, (G.boostTimer / Math.max(1, G.boostMax)) * 100))}%`;
      } else {
        boostProgPill.classList.remove('active');
        boostLabel.textContent = `⚡ Boost: ${G.boostStreak}/${needBoost}`;
        boostBar.style.width = `${Math.min(100, (G.boostStreak / needBoost) * 100)}%`;
      }
    }

    const tolPct = Math.min(48, (pitchTolCents() / 60) * 46);
    centsZone.style.left = `${50 - tolPct}%`;
    centsZone.style.width = `${tolPct * 2}%`;
  }

  function resetRun() {
    G.score = 0;
    G.patternsCleared = 0;
    G.gatesCleared = 0;
    G.gatesAttempted = 0;
    G.streak = 0;
    G.healStreak = 0;
    G.boostStreak = 0;
    G.boostTimer = 0;
    G.bestStreak = 0;
    G.hearts = Math.max(1, Number(CFG.hearts) || 3);
    G.waveIdx = Math.max(0, Math.min(WAVES.length - 1, (Number(CFG.startWave) || 1) - 1));
    G.lastPatternId = '';
    G.patterns = [];
    snapPitchCamera();
    G.particles = [];
    G.popups = [];
    G.shake = 0;
    G.musicBeatAcc = 0;
    G.musicStep = 0;
    G.bird.x = Math.floor(G.W * ((Number(CFG.birdXFrac) || 20) / 100));
    G.bird.y = degreeToY(0);
    G.bird.vy = 0;
    G.bird.tilt = 0;
    G.bird.pitchOffset = 0;
    G.bird.noteGrace = 0.35;
    G.bird.flapCooldown = 0;
    G.bird.flapKick = 0;
    G.bird.targetY = G.bird.y;
    G.bird.invuln = 0;
    G.audio.agreeGateId = null;
    G.audio.agreeCount = 0;
    G.audio.singerOctShift = null;
    G.audio.anchorLocked = false;
    G.audio.anchorVotes = [];
    G.audio.anchorNotesDone = 0;
    G.audio.recentMidis = [];

    const firstStart = Math.max(G.bird.x + 220, G.bird.x + (Number(CFG.leadInX) || 420));
    const first = spawnPattern(firstStart);
    const breathGap = Math.max(110, Number(CFG.patternGapX) || 260);
    spawnPattern(first.endX + breathGap);
    triggerPatternCue(first);
    syncHud();
  }

  function setAutoPilot(on) {
    G.autoPilot = !!on;
    autoBtn.classList.toggle('active', G.autoPilot);
    if (G.autoPilot) {
      micDot.classList.add('live');
      micLabel.textContent = '🤖 Auto-Pilot';
      if (G.state === 'idle' || G.state === 'over') {
        ensureAudio();
        overlay.classList.add('hidden');
        resetRun();
        G.state = 'playing';
        playBtn.textContent = 'Pause';
      } else if (G.state === 'paused') {
        G.state = 'playing';
        playBtn.textContent = 'Pause';
      }
    } else {
      if (G.inputMode === 'mic' && G.audio.stream) {
        micDot.classList.add('live');
        micLabel.textContent = 'Mic live';
      } else {
        micDot.classList.remove('live');
        micLabel.textContent = G.inputMode === 'keys' ? 'Space / Click' : 'Mic off';
      }
    }
  }

  async function startGame(inputMode) {
    G.inputMode = inputMode;
    G.autoPilot = false;
    autoBtn.classList.remove('active');
    ensureAudio();
    if (inputMode === 'mic') {
      const ok = await startMic();
      if (!ok) return;
    } else {
      micDot.classList.remove('live');
      micLabel.textContent = 'Space / Click';
    }
    overlay.classList.add('hidden');
    resetRun();
    G.state = 'playing';
    playBtn.textContent = 'Pause';
    playTonic();
  }

  function endGame() {
    G.state = 'over';
    G.boostTimer = 0;
    playBtn.textContent = 'Restart';
    if (cueBar) cueBar.classList.add('hidden');
    cueCard.classList.add('hidden');
    resize();
    if (G.score > G.best) {
      G.best = G.score;
      localStorage.setItem(BEST_KEY, String(G.best));
    }
    modalTitle.textContent = 'Nice Singing!';
    modalDesc.textContent = `Correct pitches: ${G.gatesCleared} / ${G.gatesAttempted} · Best streak: ${G.bestStreak} · Patterns cleared: ${G.patternsCleared} (${keySel.value.replace('b', '♭')} ${scaleSel.value}).`;
    stScore.textContent = String(G.score);
    stGates.textContent = String(G.patternsCleared);
    stBest.textContent = String(G.best);
    modalStats.style.display = 'grid';
    overlay.classList.remove('hidden');
  }

  // ---------- Main Update Loop ----------
  const topbarEl = document.querySelector('.topbar');
  let lastBoostHudMs = 0;
  function update(dt, nowMs) {
    if (topbarEl) topbarEl.classList.toggle('is-playing', G.state === 'playing');
    if (G.state === 'paused') return;
    G.t += dt;
    pollPitch(nowMs);
    G.bird.x = Math.floor(G.W * ((Number(CFG.birdXFrac) || 20) / 100));

    if (G.state !== 'playing') {
      G.bird.wing += dt * 7;
      G.bird.y = G.H * 0.54 + Math.sin(G.t * 3) * 10;
      return;
    }

    updatePitchCamera(dt);
    rebuildPathCache();
    const base = Number(CFG.baseSpeed) || 185;
    const perWave = Number(CFG.speedPerWave) || 15;
    const isBoosting = G.boostTimer > 0;
    if (isBoosting) {
      G.boostTimer = Math.max(0, G.boostTimer - dt);
      if (G.boostTimer <= 0) {
        G.bird.noteGrace = 0.85;
        spawnPopup(G.W * 0.5, G.H * 0.30, 'Hyperdrive Complete — Back to You!', '#38bdf8');
        syncHud();
      } else if (nowMs - lastBoostHudMs >= 100) {
        lastBoostHudMs = nowMs;
        syncHud();
      }
    }
    const boostMult = isBoosting ? 2.15 : 1.0;
    const speed = (base + G.waveIdx * perWave) * (Number(speedSel.value) || 1.25) * boostMult;
    G.scrollX += speed * dt;

    // Beat-synced space backing groove (or upbeat Star-Power arpeggio during Hyperdrive!)
    const gateSpacing = Math.max(80, Number(CFG.gateGapX) || 182);
    const beatDur = Math.max(0.22, Math.min(1.4, gateSpacing / Math.max(60, speed)));
    G.musicBeatAcc += dt;
    if (isBoosting) {
      if (G.musicBeatAcc >= 0.13) {
        G.musicBeatAcc -= 0.13;
        playStarBoostNote(G.musicStep++);
      }
      if (Math.random() < dt * 45) emitThrusterSparks(2);
    } else if (G.musicBeatAcc >= beatDur * 0.5) {
      G.musicBeatAcc -= beatDur * 0.5;
      playSpaceMusicPulse(G.musicStep++, beatDur);
    }

    G.bird.flapCooldown = Math.max(0, G.bird.flapCooldown - dt);
    G.bird.flapKick = Math.max(0, G.bird.flapKick - dt * 5);
    G.bird.wing += dt * (G.bird.flapKick > 0.1 ? 26 : 10);
    G.bird.glow = Math.max(0, G.bird.glow - dt * 1.8);
    G.bird.invuln = Math.max(0, G.bird.invuln - dt);
    G.shake = Math.max(0, G.shake - dt * 3.5);
    G.bird.noteGrace = Math.max(0, G.bird.noteGrace - dt);

    const curPat = activePattern();
    const curGate = activeGate(curPat);

    // Perfect Auto-Pilot AI OR Hyperdrive Boost: auto-locks & clears every circle effortlessly!
    if ((G.autoPilot || G.boostTimer > 0) && curGate && !curGate.locked && curGate.x - G.bird.x <= Math.max(240, gateSpacing)) {
      lockGate(curGate);
      if (G.autoPilot && G.boostTimer <= 0) {
        playGuideTone(curGate.info.cueMidi, 0.34, 0.01, 0.72);
        pitchRead.textContent = `${grName(curGate.info.soundingMidi)} · ${curGate.info.syl} (+0¢)`;
        centsPip.style.left = 'calc(50% - 4px)';
        centsPip.style.background = 'var(--success)';
      } else if (G.boostTimer > 0) {
        pitchRead.textContent = `⚡ HYPERDRIVE · ${curGate.info.syl.toUpperCase()}`;
        centsPip.style.left = 'calc(50% - 4px)';
        centsPip.style.background = '#fde047';
      }
    }

    // Critically-damped smooth tracking along the carved melody path (`basePathY`) + smooth pitch influence
    const steer = Number(CFG.steerSpeed) || 10;
    const drag = Number(CFG.spaceDrag) || 7;
    const basePathY = globalPathYAt(G.bird.x + 20);
    const inBreathBreak = !curGate || (curGate.x - G.bird.x > (curGate.lead || gateSpacing) * 1.15);

    let desiredOffset = 0;
    if (curGate && curGate.locked) {
      desiredOffset = 0;
      if (Math.random() < dt * 16) emitThrusterSparks(1);
    } else if (!inBreathBreak && !G.autoPilot && G.boostTimer <= 0 && G.inputMode === 'mic' && G.audio.midi != null && curGate && G.bird.noteGrace <= 0) {
      const distToGate = Math.max(0, (curGate.x + curGate.w / 2) - G.bird.x);
      const rawApp = Math.max(0, Math.min(1, (190 - distToGate) / 135));
      const approach = rawApp * rawApp * (3 - 2 * rawApp);
      const signedErr = gatePitchDiff(G.audio.midi, curGate.info);
      const tol = pitchTolSemitones();
      if (Math.abs(signedErr) > tol && approach > 0.01) {
        const excess = Math.min(1, (Math.abs(signedErr) - tol) / 1.8);
        const maxNudge = (curGate.h * 0.5) + 34;
        const nudge = maxNudge * excess * approach;
        desiredOffset = signedErr > 0 ? -nudge : nudge;
      }
      G.bird.flapKick = Math.max(G.bird.flapKick, 0.45);
      if (Math.random() < dt * 12) emitThrusterSparks(1);
    }

    const offsetAlpha = 1 - Math.exp(-Math.max(2.5, steer * 0.45) * dt);
    G.bird.pitchOffset += (desiredOffset - G.bird.pitchOffset) * offsetAlpha;

    const desiredY = Math.max(24, Math.min(G.H - 24, basePathY + G.bird.pitchOffset));
    const prevY = G.bird.y;
    const followRate = Math.max(3.5, Math.min(14, steer * 0.65 + (15 - drag) * 0.18));
    const yAlpha = 1 - Math.exp(-followRate * dt);
    G.bird.y += (desiredY - G.bird.y) * yAlpha;

    if ((curGate && curGate.locked) || inBreathBreak || G.boostTimer > 0) {
      const safeCenter = globalPathYAt(G.bird.x);
      const maxOffset = Math.max(12, ((Number(CFG.openingH) || 104) * 0.5) - 22);
      const clampedTarget = Math.max(safeCenter - maxOffset, Math.min(safeCenter + maxOffset, G.bird.y));
      G.bird.y += (clampedTarget - G.bird.y) * (1 - Math.exp(-16 * dt));
    }
    if (G.bird.y < 24) G.bird.y = 24;
    if (G.bird.y > G.H - 24) G.bird.y = G.H - 24;

    const instVy = dt > 0.0001 ? (G.bird.y - prevY) / dt : 0;
    G.bird.vy += (instVy - G.bird.vy) * (1 - Math.exp(-10 * dt));
    const targetTilt = Math.max(-0.42, Math.min(0.42, G.bird.vy / 460));
    G.bird.tilt += (targetTilt - G.bird.tilt) * (1 - Math.exp(-9 * dt));

    const liveOpeningH = Number(CFG.openingH) || 104;
    const livePipeW = Number(CFG.pipeW) || 64;
    const spinMul = (Number(CFG.rockSpin) ?? 100) / 100;
    const sizeScale = livePipeW / 64;

    for (const pat of G.patterns) {
      if (pat.breathRocks) {
        const corridorHalf = liveOpeningH * 0.58;
        for (const br of pat.breathRocks) {
          br.x -= speed * dt;
          br.shape.ang += br.shape.spin * spinMul * dt;
          const laneY = globalPathYAt(br.x);
          const curY = laneY + br.side * (corridorHalf + br.shape.r * sizeScale * 1.08 + br.extraDist) + br.pushY;
          const dist = Math.hypot(br.x - G.bird.x, curY - G.bird.y);
          const safeDist = 135 + br.shape.r * sizeScale;
          if (dist < safeDist) {
            const push = ((safeDist - dist) / safeDist) * 260;
            br.vy += br.side * push * dt;
          }
          br.vy *= Math.exp(-3.2 * dt);
          br.pushY += br.vy * dt;
        }
      }

      for (const g of pat.gates) {
        g.x -= speed * dt;
        g.h = liveOpeningH;
        g.w = livePipeW;
        g.y0 = g.cy - g.h / 2;
        g.y1 = g.cy + g.h / 2;
        if (g.rock) {
          for (const r of g.rock.topCluster) r.shape.ang += r.shape.spin * spinMul * dt;
          for (const r of g.rock.botCluster) r.shape.ang += r.shape.spin * spinMul * dt;
        }
        if (g.hitFlash > 0) g.hitFlash = Math.max(0, g.hitFlash - dt * 1.4);

        if (curGate && g.uid === curGate.uid && !g.locked) {
          const need = Math.max(1, Number(CFG.lockFrames) || 2);
          const tgt = G.audio.agreeGateId === g.uid ? (G.audio.agreeCount / need) : 0;
          g.lockProgress += (tgt - g.lockProgress) * Math.min(1, dt * 14);
        }

        // Resolve at trailing center of the circle for maximum high-speed forgiveness
        if (g.status === 'pending' && (g.x + g.w * 0.72) <= G.bird.x + 16) {
          G.gatesAttempted++;
          if (g.locked || G.boostTimer > 0) {
            g.status = 'cleared';
            G.gatesCleared++;
            G.streak++;
            if (G.streak > G.bestStreak) G.bestStreak = G.streak;
            const mult = Math.min(5, 1 + Math.floor(G.streak / 4));
            const pts = G.boostTimer > 0 ? 200 : (100 * mult);
            G.score += pts;
            G.shake = 0.2;
            spawnBurst(g.x + g.w / 2, g.cy, G.boostTimer > 0 ? '#fde047' : '#34d399', 20);
            spawnPopup(G.bird.x + 28, g.cy - 22, `+${pts} ${g.info.label.toUpperCase()}`, G.boostTimer > 0 ? '#fde047' : '#34d399');
            playSmashSfx(g.info.cueMidi, ((g.info.d % 7) + 7) % 7);
            if (G.boostTimer <= 0) G.musicBeatAcc = 0;

            // Finalize singer's home octave anchor after clearing the first 2 notes cleanly!
            if (!G.autoPilot && G.boostTimer <= 0 && G.inputMode === 'mic' && CFG.exactOctave && !G.audio.anchorLocked) {
              G.audio.anchorNotesDone++;
              if (G.audio.anchorNotesDone >= 2 && G.audio.anchorVotes.length >= 2) {
                const sorted = G.audio.anchorVotes.slice().sort((a, b) => a - b);
                G.audio.singerOctShift = sorted[sorted.length >> 1];
                G.audio.anchorLocked = true;
                const homeDo = grName(degreeInfo(0).soundingMidi + G.audio.singerOctShift);
                spawnPopup(G.W * 0.5, G.H * 0.22, `🎤 Home Do Locked (${homeDo})`, '#38bdf8');
              }
            }

            // Restore +1 Life on streak when below max lives
            const maxH = Math.max(1, Number(CFG.hearts) || 3);
            const needHeal = Math.max(3, Number(CFG.streakForLife) || 8);
            if (G.hearts < maxH) {
              G.healStreak++;
              if (G.healStreak >= needHeal) {
                G.healStreak = 0;
                G.hearts = Math.min(maxH, G.hearts + 1);
                spawnBurst(G.bird.x, G.bird.y, '#fb7185', 24);
                spawnPopup(G.W * 0.5, G.H * 0.28, '❤️ +1 LIFE RESTORED!', '#fb7185');
                playPatternClearFanfare();
                if (heartsPill) {
                  heartsPill.classList.add('heal-flash');
                  setTimeout(() => heartsPill.classList.remove('heal-flash'), 650);
                }
              }
            }

            // Charge up Mario Kart–style Hyperdrive Boost at 30 in a row!
            if (G.boostTimer <= 0) {
              const needBoost = Math.max(5, Number(CFG.streakForBoost) || 30);
              G.boostStreak++;
              if (G.boostStreak >= needBoost) {
                triggerHyperdriveBoost();
              }
            }
          } else {
            g.status = 'missed';
            pat.hadMiss = true;
            G.hearts--;
            G.streak = 0;
            G.healStreak = 0;
            G.boostStreak = 0;
            G.bird.invuln = 0.85;
            G.shake = 0.5;

            const recentVoice = (G.t - G.audio.lastSeenT) < 0.45 && G.audio.lastSyl;
            if (recentVoice && Math.abs(G.audio.lastErr) > pitchTolSemitones()) {
              const isHigh = G.audio.lastErr > 0;
              g.hitSide = isHigh ? 'high' : 'low';
              g.hitFlash = 1.0;
              g.sungSyl = G.audio.lastSyl.toUpperCase();
              const impactY = isHigh ? Math.max(48, g.y0 - 24) : Math.min(G.H - 42, g.y1 + 24);
              spawnBurst(g.x + g.w / 2, impactY, '#fbbf24', 20);
              spawnPopup(g.x + g.w / 2, impactY - 12, `${isHigh ? '▲ HIGH' : '▼ LOW'} · SANG ${g.sungSyl}`, '#fbbf24');
            } else {
              g.hitSide = null;
              g.hitFlash = 0.8;
              spawnBurst(G.bird.x + 14, G.bird.y, '#fb7185', 16);
              spawnPopup(G.bird.x + 26, G.bird.y - 24, `Missed ${g.info.label.toUpperCase()}`, '#fb7185');
            }
            playBonkSfx(g.info.cueMidi);
            if (G.hearts <= 0) {
              syncHud();
              endGame();
              return;
            }
          }

          G.audio.agreeGateId = null;
          G.audio.agreeCount = 0;
          G.bird.noteGrace = 0.24;

          const remaining = pat.gates.some(x => x.status === 'pending');
          if (!remaining) {
            pat.completed = true;
            if (!pat.hadMiss) {
              G.patternsCleared++;
              G.score += 250;
              spawnPopup(G.W * 0.5, G.H * 0.34, 'PATTERN CLEAR! +250', '#fbbf24');
              playPatternClearFanfare();

              const ppw = Math.max(1, Number(CFG.patternsPerWave) || 2);
              const startW = Math.max(0, (Number(CFG.startWave) || 1) - 1);
              const newWave = Math.min(WAVES.length - 1, startW + Math.floor(G.patternsCleared / ppw));
              if (newWave > G.waveIdx && !CFG.poolAll && !CFG.customOnly) {
                G.waveIdx = newWave;
                spawnPopup(G.W * 0.5, G.H * 0.44, `WAVE ${G.waveIdx + 1}: ${WAVES[G.waveIdx].label.toUpperCase()}!`, '#38bdf8');
              }
            }
            const nextPat = activePattern();
            if (nextPat) triggerPatternCue(nextPat);
          } else {
            updateCueCard(pat);
          }
          syncHud();
        }
      }
      pat.endX = pat.gates[pat.gates.length - 1].x + pat.gates[pat.gates.length - 1].w;
    }

    // Wait until a pattern AND all scattered asteroids are completely off-screen left before culling
    G.patterns = G.patterns.filter(p => p.endX > -460);
    const rightmost = G.patterns.reduce((mx, p) => Math.max(mx, p.endX), 0);
    if (rightmost < G.W + 260) {
      const breathGap = Math.max(110, Number(CFG.patternGapX) || 260);
      const np = spawnPattern(Math.max(G.W + 40, rightmost + breathGap));
      if (activePattern() === np) triggerPatternCue(np);
    }

    // Ambient flying background asteroids
    const ambDrift = (Number(CFG.rockDriftSpeed) ?? 100) / 100;
    for (const ar of G.ambientRocks) {
      ar.x -= (speed * ar.depth * 0.45 + ar.vx * ambDrift) * dt;
      ar.y += (ar.vy * ambDrift + Math.sin(G.t * ar.shape.wyFreq * ambDrift + ar.shape.phaseY) * 6 * ambDrift) * dt;
      ar.shape.ang += ar.shape.spin * spinMul * dt;
      if (ar.x < -60) {
        ar.x = G.W + 50 + Math.random() * 140;
        ar.y = 40 + Math.random() * (G.H - 80);
      }
      if (ar.y < -40) ar.y = G.H + 35;
      if (ar.y > G.H + 40) ar.y = -35;
    }

    // Fast-moving space debris streaking faster than the asteroids
    const debBase = speed * ((Number(CFG.debrisSpeed) ?? 220) / 100);
    for (const d of G.debris) {
      d.x -= debBase * d.speedMul * dt;
      d.y += d.vy * dt;
      d.ang += d.spin * dt;
      if (d.x < -80) {
        d.x = G.W + 30 + Math.random() * 160;
        d.y = 24 + Math.random() * (G.H - 48);
      }
      if (d.y < -30) d.y = G.H + 25;
      if (d.y > G.H + 30) d.y = -25;
    }

    for (const p of G.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 320 * dt;
      p.life -= dt;
    }
    G.particles = G.particles.filter(p => p.life > 0);

    for (const pop of G.popups) {
      pop.y -= 42 * dt;
      pop.life -= dt;
    }
    G.popups = G.popups.filter(p => p.life > 0);
  }

  // ---------- Rendering: Deep Space, Nebula, Debris, Varied Obstacles & Solfege Rocket ----------
  let cachedSkyH = 0;
  let cachedSkyGrad = null;
  let _ladderCacheKey = '';
  let _ladderCache = [];
  function drawBackground() {
    if (cachedSkyH !== G.H || !cachedSkyGrad) {
      cachedSkyH = G.H;
      cachedSkyGrad = ctx.createLinearGradient(0, 0, 0, G.H);
      cachedSkyGrad.addColorStop(0, '#090e1f');
      cachedSkyGrad.addColorStop(0.55, '#101833');
      cachedSkyGrad.addColorStop(1, '#14203e');
    }
    ctx.fillStyle = cachedSkyGrad;
    ctx.fillRect(-16, -16, G.W + 32, G.H + 32);

    const drawNebula = (cx, cy, r, col) => {
      const ng = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
      ng.addColorStop(0, col);
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    drawNebula(G.W * 0.18, G.H * 0.28, G.W * 0.28, 'rgba(139, 92, 246, 0.14)');
    drawNebula(G.W * 0.82, G.H * 0.34, G.W * 0.30, 'rgba(20, 184, 166, 0.12)');
    drawNebula(G.W * 0.22, G.H * 0.78, G.W * 0.25, 'rgba(56, 189, 248, 0.10)');

    for (let i = 0; i < G.stars.length; i++) {
      const s = G.stars[i];
      const sx = ((s.x - G.scrollX * s.p) % G.W + G.W) % G.W;
      const sy = s.y % Math.max(1, G.H);
      const tw = 0.55 + 0.45 * Math.sin(G.t * 2.5 + i);
      ctx.fillStyle = i % 5 === 0
        ? `rgba(196, 181, 253, ${(0.75 * tw).toFixed(2)})`
        : `rgba(226, 232, 240, ${(0.55 * tw).toFixed(2)})`;
      if (i % 7 === 0) {
        const r = s.r * 3.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - r);
        ctx.quadraticCurveTo(sx, sy, sx + r, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy + r);
        ctx.quadraticCurveTo(sx, sy, sx - r, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy - r);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Full diatonic pitch-ladder guide lines aligned to the live zoomed pitch camera
    // Shows every scale step — including unrepresented gap notes like re & fa between do, mi, sol
    const minVisibleDeg = Math.floor(G.camMinDeg) - 1;
    const maxVisibleDeg = Math.ceil(G.camMaxDeg) + 1;
    const ladderKey = `${keySel.value}|${scaleSel.value}|${minVisibleDeg}|${maxVisibleDeg}`;
    if (ladderKey !== _ladderCacheKey) {
      _ladderCacheKey = ladderKey;
      _ladderCache = [];
      for (let d = maxVisibleDeg; d >= minVisibleDeg; d--) {
        const mod = ((d % 7) + 7) % 7;
        const tier = mod === 0 ? 2 : (mod === 2 || mod === 4) ? 1 : 0;
        _ladderCache.push({ d, lbl: degreeInfo(d).label, tier });
      }
    }
    ctx.save();
    ctx.font = '700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const a of _ladderCache) {
      const y = degreeToY(a.d);
      if (y < 8 || y > G.H - 8) continue;
      ctx.strokeStyle = a.tier === 2
        ? 'rgba(56, 189, 248, 0.18)'
        : a.tier === 1
          ? 'rgba(148, 163, 184, 0.10)'
          : 'rgba(148, 163, 184, 0.05)';
      ctx.lineWidth = a.tier === 2 ? 1.25 : 1;
      ctx.beginPath();
      ctx.moveTo(32, y);
      ctx.lineTo(G.W, y);
      ctx.stroke();
      ctx.fillStyle = a.tier === 2
        ? 'rgba(125, 211, 252, 0.56)'
        : a.tier === 1
          ? 'rgba(203, 213, 225, 0.36)'
          : 'rgba(148, 163, 184, 0.24)';
      ctx.fillText(a.lbl, 7, y);
    }
    ctx.restore();

    // Hyperspace rainbow speed lines during Hyperdrive Boost
    if (G.boostTimer > 0) {
      ctx.save();
      for (let i = 0; i < 18; i++) {
        const y = ((i * 73 + G.t * 120) % G.H);
        const x = G.W - (((G.t * 1400 + i * 197) % (G.W + 240)) - 120);
        const hue = (G.t * 280 + i * 32) % 360;
        ctx.strokeStyle = `hsla(${hue}, 95%, 72%, 0.45)`;
        ctx.lineWidth = 2 + (i % 2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 90 + (i % 3) * 40, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const ar of G.ambientRocks) {
      drawTumblingAsteroid(ar.x, ar.y, ar.shape, 0, ar.alpha);
    }

    // Fast-moving space debris
    for (const d of G.debris) {
      ctx.save();
      ctx.globalAlpha = d.alpha;
      const tailLen = Math.min(60, 14 + d.speedMul * 22);
      const tg = ctx.createLinearGradient(d.x, d.y, d.x + tailLen, d.y);
      tg.addColorStop(0, d.hue);
      tg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = tg;
      ctx.lineWidth = d.type === 'streak' ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + tailLen, d.y - d.vy * 0.04);
      ctx.stroke();

      ctx.translate(d.x, d.y);
      ctx.rotate(d.ang);
      if (d.type === 'panel') {
        ctx.fillStyle = '#1e3a8a';
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1.2;
        ctx.fillRect(-d.size, -d.size * 0.45, d.size * 2, d.size * 0.9);
        ctx.strokeRect(-d.size, -d.size * 0.45, d.size * 2, d.size * 0.9);
        ctx.beginPath();
        ctx.moveTo(0, -d.size * 0.45);
        ctx.lineTo(0, d.size * 0.45);
        ctx.stroke();
      } else if (d.type === 'shard') {
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(d.size, 0);
        ctx.lineTo(-d.size * 0.6, -d.size * 0.65);
        ctx.lineTo(-d.size, d.size * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = d.hue;
        ctx.beginPath();
        ctx.arc(0, 0, d.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawTumblingAsteroid(cx, cy, shape, flashAmt = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(shape.ang);

    ctx.beginPath();
    shape.verts.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();

    const kind = effectiveKind(shape);
    const rg = ctx.createRadialGradient(-shape.r * 0.3, -shape.r * 0.3, shape.r * 0.1, 0, 0, shape.r * 1.12);
    if (flashAmt > 0.05) {
      rg.addColorStop(0, '#fde047');
      rg.addColorStop(0.45, '#f97316');
      rg.addColorStop(1, '#991b1b');
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 22 * flashAmt;
      ctx.strokeStyle = '#fef08a';
    } else if (kind === 'crystal') {
      rg.addColorStop(0, '#c084fc');
      rg.addColorStop(0.5, '#6d28d9');
      rg.addColorStop(1, '#2e1065');
      ctx.strokeStyle = '#d8b4fe';
    } else if (kind === 'iron') {
      rg.addColorStop(0, '#9a6b52');
      rg.addColorStop(0.5, '#4c3f4c');
      rg.addColorStop(1, '#1e1b29');
      ctx.strokeStyle = '#b48a72';
    } else if (kind === 'ice') {
      rg.addColorStop(0, '#bae6fd');
      rg.addColorStop(0.5, '#38bdf8');
      rg.addColorStop(1, '#164e63');
      ctx.strokeStyle = '#e0f2fe';
    } else {
      rg.addColorStop(0, '#626d99');
      rg.addColorStop(0.55, '#3b4264');
      rg.addColorStop(1, '#1e243d');
      ctx.strokeStyle = '#7b87b8';
    }
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.lineWidth = flashAmt > 0.05 ? 2.6 : 1.6;
    ctx.stroke();

    if (kind === 'crystal' && flashAmt <= 0.05) {
      ctx.strokeStyle = 'rgba(233, 213, 255, 0.38)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < shape.verts.length; i += 2) {
        ctx.moveTo(0, 0);
        ctx.lineTo(shape.verts[i].x * 0.85, shape.verts[i].y * 0.85);
      }
      ctx.stroke();
    } else if (kind === 'ice' && flashAmt <= 0.05) {
      ctx.fillStyle = 'rgba(240, 249, 255, 0.35)';
      ctx.beginPath();
      ctx.ellipse(-shape.r * 0.22, -shape.r * 0.22, shape.r * 0.38, shape.r * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (const cr of shape.craters) {
        ctx.fillStyle = flashAmt > 0.05 ? 'rgba(127, 29, 29, 0.45)' : 'rgba(18, 22, 42, 0.52)';
        ctx.beginPath();
        ctx.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Continuous safe flight path across ALL patterns AND every breath break between them (cached once per frame)
  let _pathPts = [];
  function rebuildPathCache() {
    _pathPts.length = 0;
    for (const pat of G.patterns) {
      for (const g of pat.gates) _pathPts.push({ x: g.x + g.w / 2, y: g.cy });
    }
    if (_pathPts.length > 1) _pathPts.sort((a, b) => a.x - b.x);
  }
  function globalPathYAt(x) {
    const pts = _pathPts;
    if (!pts.length) return degreeToY(0);
    if (x <= pts[0].x) return pts[0].y;
    const last = pts.length - 1;
    if (x >= pts[last].x) return pts[last].y;
    for (let i = 0; i < last; i++) {
      if (x <= pts[i + 1].x) {
        const u = Math.max(0, Math.min(1, (x - pts[i].x) / Math.max(1, pts[i + 1].x - pts[i].x)));
        const s = u * u * (3 - 2 * u);
        return pts[i].y + (pts[i + 1].y - pts[i].y) * s;
      }
    }
    return pts[last].y;
  }

  function drawAllPatternObstacles() {
    const corridorHalf = (Number(CFG.openingH) || 104) * 0.58;
    const maxPerSide = Math.max(1, Math.min(8, Number(CFG.rockCount) || 4));
    const spreadPx = Number(CFG.rockSpread) ?? 145;
    const driftSpd = (Number(CFG.rockDriftSpeed) ?? 100) / 100;
    const driftAmp = Number(CFG.rockDriftAmp) ?? 10;
    const sizeScale = (Number(CFG.pipeW) || 64) / 64;
    const overlapFrac = Math.max(0, Math.min(1, (Number(CFG.rockOverlap) ?? 25) / 100));
    const sepFactor = 1.08 - overlapFrac * 0.86;

    const items = [];
    const hitLabels = [];

    for (const pat of G.patterns) {
      if (pat.breathRocks) {
        for (const br of pat.breathRocks) {
          if (br.x < -180 || br.x > G.W + 220) continue;
          const r = br.shape.r * sizeScale;
          const laneY = globalPathYAt(br.x);
          const ry = laneY + br.side * (corridorHalf + r * 1.08 + driftAmp + br.extraDist) + br.pushY;
          items.push({
            x: br.x, y: ry, r, side: br.side,
            shape: br.shape, flash: 0, alpha: 0.85,
            minClear: corridorHalf + r * 1.06,
          });
        }
      }
      for (const g of pat.gates) {
        const cx = g.x + g.w / 2;
        if (cx < -380 || cx > G.W + 380) continue;
        const rk = g.rock;
        const topFlash = g.hitSide === 'high' ? g.hitFlash : 0;
        const botFlash = g.hitSide === 'low' ? g.hitFlash : 0;
        const addCluster = (cluster, flash) => {
          for (let idx = 0; idx < cluster.length; idx++) {
            const c = cluster[idx];
            // Rocks past the slider count are screen-filler: only draw them when they land on screen
            const filler = idx >= maxPerSide;
            if (filler && idx < 8) continue;
            const sh = c.shape;
            const r = sh.r * sizeScale;
            const rx = cx + c.dxNorm * spreadPx + Math.sin(G.t * sh.wxFreq * driftSpd + sh.phaseX) * driftAmp;
            const laneY = globalPathYAt(rx);
            const ry = laneY + c.side * (corridorHalf + r * 1.08 + driftAmp + c.extraDist) + Math.cos(G.t * sh.wyFreq * driftSpd + sh.phaseY) * driftAmp;
            if (filler && (ry < -r || ry > G.H + r)) continue;
            const entry = {
              x: rx, y: ry, r, side: c.side,
              shape: sh, flash: idx === 0 ? flash : 0, alpha: idx === 0 ? 1 : 0.88,
              minClear: corridorHalf + r * 1.06,
            };
            items.push(entry);
            if (idx === 0 && g.hitFlash > 0.05 && g.sungSyl && ((g.hitSide === 'high' && c.side < 0) || (g.hitSide === 'low' && c.side > 0))) {
              hitLabels.push({ entry, syl: g.sungSyl, alpha: Math.min(1, g.hitFlash * 1.4) });
            }
          }
        };
        addCluster(rk.topCluster, topFlash);
        addCluster(rk.botCluster, botFlash);
      }
    }

    if (sepFactor > 0.25 && items.length > 1) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < items.length; i++) {
          const a = items[i];
          for (let j = i + 1; j < items.length; j++) {
            const b = items[j];
            if (a.side !== b.side) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minD = (a.r + b.r) * sepFactor;
            if (Math.abs(dx) >= minD || Math.abs(dy) >= minD) continue;
            const d = Math.hypot(dx, dy);
            if (d < minD) {
              const push = (minD - d) * 0.5;
              const nx = d > 0.01 ? dx / d : 0.7;
              const ny = d > 0.01 ? dy / d : a.side;
              a.x -= nx * push;
              b.x += nx * push;
              a.y -= ny * push;
              b.y += ny * push;
            }
          }
        }
        for (const it of items) {
          const laneY = globalPathYAt(it.x);
          if (it.side < 0 && it.y > laneY - it.minClear) it.y = laneY - it.minClear;
          if (it.side > 0 && it.y < laneY + it.minClear) it.y = laneY + it.minClear;
        }
      }
    }

    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.scale(sizeScale, sizeScale);
      drawTumblingAsteroid(0, 0, it.shape, it.flash, it.alpha);
      ctx.restore();
    }

    for (const hl of hitLabels) {
      ctx.save();
      ctx.globalAlpha = hl.alpha;
      ctx.fillStyle = '#fef08a';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 14;
      ctx.font = '900 18px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hl.syl, hl.entry.x, hl.entry.y);
      ctx.restore();
    }
  }

  function drawPatternContour(pat, isActive) {
    if (CFG.showContour && pat.gates.length > 1) {
      const traceContour = () => {
        ctx.beginPath();
        for (let i = 0; i < pat.gates.length; i++) {
          const g = pat.gates[i];
          const cx = g.x + g.w / 2;
          if (i === 0) ctx.moveTo(cx, g.cy);
          else {
            const prev = pat.gates[i - 1];
            const px = prev.x + prev.w / 2;
            const midX = (px + cx) / 2;
            ctx.bezierCurveTo(midX, prev.cy, midX, g.cy, cx, g.cy);
          }
        }
      };

      ctx.save();
      traceContour();
      ctx.strokeStyle = isActive ? 'rgba(56, 189, 248, 0.08)' : 'rgba(148, 163, 184, 0.03)';
      ctx.lineWidth = (Number(CFG.openingH) || 104) * 0.92;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      traceContour();
      ctx.strokeStyle = isActive ? 'rgba(56, 189, 248, 0.62)' : 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = isActive ? 2.6 : 1.6;
      ctx.setLineDash([5, 7]);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPatternGates(pat, curGate) {
    for (const g of pat.gates) {
      const isCur = curGate && g.uid === curGate.uid;
      const cx = g.x + g.w / 2;
      if (g.status === 'cleared') continue;

      const missed = g.status === 'missed';
      ctx.save();
      const ringR = Math.min(34, g.h * 0.36);
      const glowCol = missed ? '#fb7185'
        : G.boostTimer > 0 ? '#fde047'
        : g.locked ? '#34d399'
        : isCur ? '#38bdf8'
        : 'rgba(148, 163, 184, 0.45)';
      ctx.strokeStyle = glowCol;
      ctx.lineWidth = g.locked ? 3.5 : isCur ? 2.4 : 1.5;
      if (g.locked || isCur) {
        ctx.shadowColor = glowCol;
        ctx.shadowBlur = g.locked ? 18 : 10;
      }
      ctx.fillStyle = g.locked ? 'rgba(52, 211, 153, 0.18)' : isCur ? 'rgba(56, 189, 248, 0.14)' : 'rgba(13, 17, 29, 0.52)';
      ctx.beginPath();
      ctx.arc(cx, g.cy, ringR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      const showSyl = CFG.pipeLabels === 'always'
        ? true
        : CFG.pipeLabels === 'hide'
          ? (g.locked || g.status !== 'pending')
          : (pat.cueMode === 'leap' || g.locked || g.status !== 'pending');

      ctx.save();
      const txtCol = missed ? '#fb7185' : g.locked ? '#6ee7b7' : isCur ? '#ffffff' : 'rgba(226, 232, 240, 0.85)';
      const fontPx = Math.max(11, Math.min(18, Math.round(ringR * 0.56)));
      ctx.fillStyle = txtCol;
      if (g.locked || isCur) {
        ctx.shadowColor = g.locked ? '#34d399' : '#38bdf8';
        ctx.shadowBlur = 10;
      }
      ctx.font = `900 ${fontPx}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(showSyl ? g.info.label.toUpperCase() : '?', cx, g.cy, Math.max(20, ringR * 1.75));
      ctx.restore();
    }
  }

  function drawGuideBeam(curGate) {
    if (!curGate || !curGate.locked || G.state !== 'playing') return;
    const startX = G.bird.x + 28;
    const endX = curGate.x + curGate.w / 2 - 18;
    if (endX <= startX) return;
    ctx.save();
    ctx.strokeStyle = G.boostTimer > 0 ? 'rgba(253, 224, 71, 0.8)' : 'rgba(52, 211, 153, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.shadowColor = G.boostTimer > 0 ? '#fde047' : '#34d399';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(startX, G.bird.y);
    ctx.lineTo(endX, curGate.cy);
    ctx.stroke();
    ctx.restore();
  }

  function drawBird() {
    const b = G.bird;

    ctx.save();
    if (b.invuln > 0) {
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(G.t * 24);
    }
    ctx.translate(b.x, b.y);
    ctx.rotate(b.tilt || 0);

    if (b.invuln > 0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + Math.sin(G.t * 18) * 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rainbow Star-Power shield aura during Hyperdrive Boost
    if (G.boostTimer > 0) {
      const hue = (G.t * 360) % 360;
      const pulse = 36 + Math.sin(G.t * 22) * 5;
      const sg = ctx.createRadialGradient(0, 0, 10, 0, 0, pulse);
      sg.addColorStop(0, `hsla(${hue}, 100%, 75%, 0.55)`);
      sg.addColorStop(0.6, `hsla(${(hue + 90) % 360}, 100%, 65%, 0.25)`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    const thrust = G.boostTimer > 0 ? 1.85 : Math.max(0.28, b.flapKick * 1.15 + (G.audio.midi != null ? 0.35 : 0));
    const flicker = 0.85 + Math.sin(G.t * 48) * 0.18;
    const fLen = (18 + thrust * 24) * flicker;

    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.beginPath();
    ctx.moveTo(-20, -9);
    ctx.quadraticCurveTo(-20 - fLen * 0.7, -11, -20 - fLen * 1.12, 0);
    ctx.quadraticCurveTo(-20 - fLen * 0.7, 11, -20, 9);
    ctx.closePath();
    ctx.fill();

    const fg = ctx.createLinearGradient(-20, 0, -20 - fLen, 0);
    fg.addColorStop(0, '#fef08a');
    fg.addColorStop(0.45, '#fbbf24');
    fg.addColorStop(1, 'rgba(249, 115, 22, 0.1)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-20, -6.5);
    ctx.quadraticCurveTo(-20 - fLen * 0.55, -7.5, -20 - fLen, 0);
    ctx.quadraticCurveTo(-20 - fLen * 0.55, 7.5, -20, 6.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-20, -3.5);
    ctx.lineTo(-20 - fLen * 0.48, 0);
    ctx.lineTo(-20, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Purple swept top & bottom fins
    const finGrad = ctx.createLinearGradient(-22, -20, -4, 20);
    finGrad.addColorStop(0, '#c084fc');
    finGrad.addColorStop(1, '#6d28d9');
    ctx.fillStyle = finGrad;
    ctx.strokeStyle = '#ddd6fe';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, -12);
    ctx.quadraticCurveTo(-18, -22, -25, -19);
    ctx.quadraticCurveTo(-19, -11, -18, -7);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-4, 12);
    ctx.quadraticCurveTo(-18, 22, -25, 19);
    ctx.quadraticCurveTo(-19, 11, -18, 7);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-22, -7.5, 6, 15, 2);
    ctx.fill(); ctx.stroke();

    const hullGrad = ctx.createLinearGradient(0, -15, 0, 15);
    hullGrad.addColorStop(0, '#ffffff');
    hullGrad.addColorStop(0.55, '#dbeafe');
    hullGrad.addColorStop(1, '#93c5fd');
    ctx.fillStyle = hullGrad;
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(29, 0);
    ctx.bezierCurveTo(22, -13, 2, -16, -18, -10);
    ctx.lineTo(-18, 10);
    ctx.bezierCurveTo(2, 16, 22, 13, 29, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.save();
    ctx.clip();
    const noseGrad = ctx.createLinearGradient(15, -12, 29, 12);
    noseGrad.addColorStop(0, '#38bdf8');
    noseGrad.addColorStop(1, '#0284c7');
    ctx.fillStyle = noseGrad;
    ctx.fillRect(15, -18, 18, 36);
    ctx.restore();

    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.ellipse(-17, 0, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(4, 0, 8.2, 0, Math.PI * 2);
    ctx.fill();
    const winGrad = ctx.createRadialGradient(6, -2, 1, 4, 0, 7);
    winGrad.addColorStop(0, '#ecfeff');
    winGrad.addColorStop(0.5, '#38bdf8');
    winGrad.addColorStop(1, '#0369a1');
    ctx.fillStyle = winGrad;
    ctx.shadowColor = b.glow > 0.1 ? '#34d399' : '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(4, 0, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function drawParticlesAndPopups() {
    for (const p of G.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.life * 8);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
    for (const pop of G.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop.life / pop.maxLife);
      ctx.font = '800 17px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(9, 14, 31, 0.88)';
      const maxW = Math.max(160, G.W - 32);
      ctx.strokeText(pop.text, pop.x, pop.y, maxW);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y, maxW);
      ctx.restore();
    }
  }

  function render() {
    rebuildPathCache();
    ctx.save();
    if (G.shake > 0) {
      const mag = G.shake * 9;
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }
    drawBackground();
    const actPat = activePattern();
    const curGate = activeGate(actPat);
    for (const pat of G.patterns) {
      drawPatternContour(pat, pat === actPat);
    }
    drawAllPatternObstacles();
    for (const pat of G.patterns) {
      drawPatternGates(pat, pat === actPat ? curGate : null);
    }
    drawGuideBeam(curGate);
    drawBird();
    drawParticlesAndPopups();
    ctx.restore();
  }

  function frame(ts) {
    if (!G.lastTs) G.lastTs = ts;
    const dt = Math.min(0.05, (ts - G.lastTs) / 1000);
    G.lastTs = ts;
    update(dt, ts);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Tuning Drawer UI Sync, Save & Upload JSON ----------
  const RANGE_BINDINGS = [
    ['cfgBaseSpeed',      'valBaseSpeed',      'baseSpeed',      v => `${v} px/s`],
    ['cfgSpeedPerWave',   'valSpeedPerWave',   'speedPerWave',   v => `+${v} px/s`],
    ['cfgGateGapX',       'valGateGapX',       'gateGapX',       v => `${v} px`],
    ['cfgPatternGapX',    'valPatternGapX',    'patternGapX',    v => `${v} px`],
    ['cfgLeadInX',        'valLeadInX',        'leadInX',        v => `${v} px`],
    ['cfgOpeningH',       'valOpeningH',       'openingH',       v => `${v} px`],
    ['cfgPipeW',          'valPipeW',          'pipeW',          v => `${v} px`],
    ['cfgRockCount',      'valRockCount',      'rockCount',      v => `${v}`],
    ['cfgRockSpread',     'valRockSpread',     'rockSpread',     v => `${v} px`],
    ['cfgRockOverlap',    'valRockOverlap',    'rockOverlap',    v => `${v}%`],
    ['cfgRockDriftSpeed', 'valRockDriftSpeed', 'rockDriftSpeed', v => `${v}%`],
    ['cfgRockDriftAmp',   'valRockDriftAmp',   'rockDriftAmp',   v => `${v} px`],
    ['cfgRockSpin',       'valRockSpin',       'rockSpin',       v => `${v}%`],
    ['cfgAmbientCount',   'valAmbientCount',   'ambientCount',   v => `${v}`],
    ['cfgDebrisCount',    'valDebrisCount',    'debrisCount',    v => `${v}`],
    ['cfgDebrisSpeed',    'valDebrisSpeed',    'debrisSpeed',    v => `${v}%`],
    ['cfgBirdGlide',      'valBirdGlide',      'steerSpeed',     v => `${v}`],
    ['cfgGravity',        'valGravity',        'spaceDrag',      v => `${v}`],
    ['cfgBirdXFrac',      'valBirdXFrac',      'birdXFrac',      v => `${v}%`],
    ['cfgGuideVol',       'valGuideVol',       'guideVol',       v => `${v}%`],
    ['cfgDroneVol',       'valDroneVol',       'droneVol',       v => `${v}%`],
    ['cfgMusicVol',       'valMusicVol',       'musicVol',       v => `${v}%`],
    ['cfgSfxVol',         'valSfxVol',         'sfxVol',         v => `${v}%`],
    ['cfgRefA',           'valRefA',           'refA',           v => `${v} Hz`],
    ['cfgGuideOct',       'valGuideOct',       'guideOct',       v => `${v > 0 ? '+' : ''}${v} oct`],
    ['cfgPitchCents',     'valPitchCents',     'pitchCents',     v => `±${v}¢`],
    ['cfgLockFrames',     'valLockFrames',     'lockFrames',     v => `${v} (~${v * 16}ms)`],
    ['cfgMinClarity',     'valMinClarity',     'minClarity',     v => Number(v).toFixed(2)],
    ['cfgEchoStepMs',     'valEchoStepMs',     'echoStepMs',     v => `${v} ms`],
    ['cfgStartWave',      'valStartWave',      'startWave',      v => `Wave ${v}`],
    ['cfgPatternsPerWave','valPatternsPerWave','patternsPerWave',v => `${v}`],
    ['cfgHearts',         'valHearts',         'hearts',         v => `${v}`],
    ['cfgStreakForLife',  'valStreakForLife',  'streakForLife',  v => `${v} pitches`],
    ['cfgStreakForBoost', 'valStreakForBoost', 'streakForBoost', v => `${v} pitches`],
    ['cfgBoostDur',       'valBoostDur',       'boostDur',       v => `${v} s`],
  ];

  const BOOL_BINDINGS = [
    ['cfgShowContour',  'showContour'],
    ['cfgLookRock',     'lookRock'],
    ['cfgLookCrystal',  'lookCrystal'],
    ['cfgLookIron',     'lookIron'],
    ['cfgLookIce',      'lookIce'],
    ['cfgExactOctave',  'exactOctave',  true],
    ['cfgSoundMaster',  'soundMaster',  true, () => { if (!CFG.soundMaster && G.droneOn) stopDrone(); syncDrawerFromCfg(); }],
    ['cfgSoundMusic',   'soundMusic',   true, () => syncDrawerFromCfg()],
    ['cfgSoundCharge',  'soundCharge',  true, () => syncDrawerFromCfg()],
    ['cfgSoundClear',   'soundClear',   true, () => syncDrawerFromCfg()],
    ['cfgSoundFanfare', 'soundFanfare', true, () => syncDrawerFromCfg()],
    ['cfgPlayMissModel','playMissModel'],
    ['cfgPoolAll',      'poolAll',      false, () => syncHud()],
    ['cfgCustomOnly',   'customOnly',   false, () => syncHud()],
  ];

  function renderPatternToggles() {
    const disabled = new Set(CFG.disabledPatterns || []);
    const syls = SR_SYL[scaleSel.value] || SR_SYL.major;
    const fmtDegs = degs => degs.map(d => {
      const s = syls[((d % 7) + 7) % 7];
      return d >= 7 ? `${s}'` : d < 0 ? `${s},` : s;
    }).join(' ');
    patToggleList.innerHTML = ALL_PATTERNS.map(p => {
      const chk = disabled.has(p.id) ? '' : 'checked';
      return `<label class="pat-item"><input type="checkbox" data-pat-id="${p.id}" ${chk} /><span>W${p.waveIdx + 1} · ${p.name}</span><code>${fmtDegs(p.degs)}</code></label>`;
    }).join('');
  }

  function syncDrawerFromCfg() {
    RANGE_BINDINGS.forEach(([inId, valId, key, fmt]) => {
      const inp = document.getElementById(inId);
      const val = document.getElementById(valId);
      if (inp) inp.value = String(CFG[key]);
      if (val) val.textContent = fmt(CFG[key]);
    });
    BOOL_BINDINGS.forEach(([id, key, defTrue]) => {
      const el = document.getElementById(id);
      if (el) el.checked = defTrue ? CFG[key] !== false : !!CFG[key];
    });
    document.getElementById('cfgPipeLabels').value = CFG.pipeLabels || 'auto';
    document.getElementById('cfgCustomPatterns').value = CFG.customPatterns || '';
    G.musicOn = CFG.soundMusic !== false;
    musicBtn.classList.toggle('active', G.musicOn && CFG.soundMaster !== false);
    if (sfxBtn) sfxBtn.classList.toggle('active', CFG.soundMaster !== false && (CFG.soundCharge || CFG.soundClear || CFG.soundFanfare));
    renderPatternToggles();
    syncHud();
  }

  function buildConfigSnapshot() {
    return Object.assign({}, CFG, {
      uiMode: modeSel.value,
      uiKey: keySel.value,
      uiScale: scaleSel.value,
      uiVoice: voiceSel.value,
      uiSpeedMult: Number(speedSel.value),
      uiMusicOn: G.musicOn,
    });
  }

  function applyImportedConfig(data) {
    if (!data || typeof data !== 'object') throw new Error('Invalid JSON object');
    const clean = Object.assign({}, DEFAULT_CFG);
    for (const k of Object.keys(DEFAULT_CFG)) {
      if (data[k] !== undefined) clean[k] = data[k];
    }
    CFG = clean;
    [[modeSel, data.uiMode], [keySel, data.uiKey], [scaleSel, data.uiScale], [voiceSel, data.uiVoice]].forEach(([sel, val]) => {
      if (val && [...sel.options].some(o => o.value === val)) sel.value = val;
    });
    if (data.uiSpeedMult != null) {
      const match = [...speedSel.options].find(o => Math.abs(Number(o.value) - Number(data.uiSpeedMult)) < 0.05);
      if (match) speedSel.value = match.value;
    }
    if (typeof data.uiMusicOn === 'boolean') {
      G.musicOn = data.uiMusicOn;
      musicBtn.classList.toggle('active', G.musicOn);
    }
    saveCfg();
    rebuildAmbientRocks();
    rebuildDebris();
    syncDrawerFromCfg();
    if (G.droneOn) { stopDrone(); toggleDrone(); }
    if (G.state === 'playing' || G.state === 'paused') resetRun();
  }

  RANGE_BINDINGS.forEach(([inId, valId, key, fmt]) => {
    const inp = document.getElementById(inId);
    const val = document.getElementById(valId);
    if (!inp) return;
    inp.addEventListener('input', () => {
      CFG[key] = Number(inp.value);
      if (val) val.textContent = fmt(CFG[key]);
      saveCfg();
      syncHud();
      if (key === 'droneVol') updateDroneGain();
      if (key === 'ambientCount') rebuildAmbientRocks();
      if (key === 'debrisCount') rebuildDebris();
      if ((key === 'refA' || key === 'guideOct') && G.droneOn) { stopDrone(); toggleDrone(); }
    });
  });

  BOOL_BINDINGS.forEach(([id, key, , onChange]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', e => {
      CFG[key] = e.target.checked;
      saveCfg();
      if (onChange) onChange();
    });
  });
  document.getElementById('cfgPipeLabels').addEventListener('change', e => { CFG.pipeLabels = e.target.value; saveCfg(); });
  document.getElementById('cfgCustomPatterns').addEventListener('input', e => { CFG.customPatterns = e.target.value; saveCfg(); });

  patToggleList.addEventListener('change', e => {
    const id = e.target?.dataset?.patId;
    if (!id) return;
    const set = new Set(CFG.disabledPatterns || []);
    if (e.target.checked) set.delete(id);
    else set.add(id);
    CFG.disabledPatterns = [...set];
    saveCfg();
  });

  function toggleDrawer(force) {
    const open = force !== undefined ? force : tuneDrawer.classList.contains('hidden');
    tuneDrawer.classList.toggle('hidden', !open);
    tuneBtn.classList.toggle('active', open);
    if (open) syncDrawerFromCfg();
  }
  tuneBtn.addEventListener('click', () => toggleDrawer());
  tuneCloseBtn.addEventListener('click', () => toggleDrawer(false));

  cfgApplyBtn.addEventListener('click', () => {
    saveCfg();
    if (G.state === 'playing' || G.state === 'paused') {
      resetRun();
      G.state = 'playing';
      playBtn.textContent = 'Pause';
    }
  });

  cfgResetBtn.addEventListener('click', () => {
    CFG = Object.assign({}, DEFAULT_CFG);
    saveCfg();
    rebuildAmbientRocks();
    rebuildDebris();
    syncDrawerFromCfg();
    if (G.state === 'playing') resetRun();
  });

  cfgCopyBtn.addEventListener('click', async () => {
    const text = JSON.stringify(buildConfigSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      cfgCopyBtn.textContent = '✓ Copied!';
      setTimeout(() => { cfgCopyBtn.textContent = '📋 Copy JSON'; }, 1600);
    } catch (_) {
      window.prompt('Copy your Solfege Rocket config JSON:', text);
    }
  });

  cfgDownloadBtn.addEventListener('click', () => {
    const text = JSON.stringify(buildConfigSnapshot(), null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solfege-rocket-settings.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    cfgDownloadBtn.textContent = '✓ Saved!';
    setTimeout(() => { cfgDownloadBtn.textContent = '💾 Save File'; }, 1600);
  });

  cfgUploadBtn.addEventListener('click', () => {
    cfgFileInput.value = '';
    cfgFileInput.click();
  });

  cfgFileInput.addEventListener('change', async () => {
    const file = cfgFileInput.files && cfgFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      applyImportedConfig(parsed);
      cfgUploadBtn.textContent = '✓ Loaded!';
      setTimeout(() => { cfgUploadBtn.textContent = '📂 Upload File'; }, 1800);
      spawnPopup(G.W * 0.5, G.H * 0.36, '✓ Tuning Settings Loaded!', '#34d399');
    } catch (err) {
      window.alert('Could not load settings file — make sure it is a valid Solfege Rocket JSON file.');
    }
  });

  strictSel.addEventListener('change', () => {
    const sp = grStrictnessSpec(Number(strictSel.value) || 50, 80);
    CFG.pitchCents = sp.pitchCents;
    saveCfg();
    syncDrawerFromCfg();
  });

  // ---------- Resize & Input Wiring ----------
  function resize() {
    if (!G.patterns.length && G.state === 'idle') snapPitchCamera();
    const rect = canvas.parentElement.getBoundingClientRect();
    G.dpr = Math.min(2, window.devicePixelRatio || 1);
    G.W = Math.max(320, Math.floor(rect.width));
    G.H = Math.max(200, Math.floor(rect.height));
    canvas.width = G.W * G.dpr;
    canvas.height = G.H * G.dpr;
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    G.bird.x = Math.floor(G.W * ((Number(CFG.birdXFrac) || 20) / 100));
    G.bird.y = Math.max(24, Math.min(G.H - 24, G.bird.y || G.H * 0.5));
    G.bird.targetY = Math.max(24, Math.min(G.H - 24, G.bird.targetY || G.H * 0.5));
    // Re-sync existing pattern gate heights cleanly whenever canvas resizes (e.g. Cue Bar showing/hiding)
    for (const pat of G.patterns) {
      for (const g of pat.gates) {
        g.cy = degreeToY(g.info.d);
        g.y0 = g.cy - g.h / 2;
        g.y1 = g.cy + g.h / 2;
      }
    }
    if (!G.stars.length) {
      for (let i = 0; i < 48; i++) {
        G.stars.push({ x: Math.random() * Math.max(1400, G.W), y: Math.random() * Math.max(900, G.H), r: 1 + Math.random() * 1.6, p: 0.12 + Math.random() * 0.25 });
      }
    }
    if (!G.ambientRocks.length) rebuildAmbientRocks();
    else for (const ar of G.ambientRocks) ar.y = Math.max(20, Math.min(G.H - 20, ar.y));
    if (!G.debris.length) rebuildDebris();
    else for (const d of G.debris) d.y = Math.max(20, Math.min(G.H - 20, d.y));
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement);
  } else {
    window.addEventListener('resize', resize);
  }

  startMicBtn.addEventListener('click', () => startGame('mic'));
  startKeysBtn.addEventListener('click', () => startGame('keys'));
  startAutoBtn.addEventListener('click', () => { setAutoPilot(true); toggleDrawer(true); });
  autoBtn.addEventListener('click', () => setAutoPilot(!G.autoPilot));
  doBtn.addEventListener('click', playTonic);
  droneBtn.addEventListener('click', toggleDrone);
  musicBtn.addEventListener('click', () => {
    CFG.soundMusic = !CFG.soundMusic;
    G.musicOn = CFG.soundMusic;
    saveCfg();
    syncDrawerFromCfg();
  });
  if (sfxBtn) {
    sfxBtn.addEventListener('click', () => {
      const anyOn = CFG.soundCharge || CFG.soundClear || CFG.soundFanfare;
      const next = !anyOn;
      CFG.soundCharge = next;
      CFG.soundClear = next;
      CFG.soundFanfare = next;
      saveCfg();
      syncDrawerFromCfg();
    });
  }
  cueBtn.addEventListener('click', () => {
    const p = activePattern();
    if (p) playPatternCue(p);
    else playTonic();
  });

  playBtn.addEventListener('click', () => {
    if (G.state === 'playing') {
      G.state = 'paused';
      playBtn.textContent = 'Resume';
    } else if (G.state === 'paused') {
      G.state = 'playing';
      playBtn.textContent = 'Pause';
    } else {
      startGame(G.inputMode || 'mic');
    }
  });

  [keySel, scaleSel, voiceSel, modeSel].forEach(el => {
    el.addEventListener('change', () => {
      syncHud();
      renderPatternToggles();
      if (G.droneOn) { stopDrone(); toggleDrone(); }
      if (G.state === 'playing') resetRun();
    });
  });

  function practiceLockNext() {
    if (G.state !== 'playing') return;
    const gate = activeGate(activePattern());
    if (!gate) return;
    if (!gate.locked) {
      lockGate(gate);
      playGuideTone(gate.info.cueMidi, 0.3, 0.01, 0.85);
    } else {
      G.bird.flapKick = 0.8;
      emitThrusterSparks(4);
    }
  }

  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (G.state !== 'playing') return;
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (G.inputMode === 'keys') practiceLockNext();
    } else if (e.key === 'r' || e.key === 'R') {
      playPatternCue(activePattern());
    } else if (e.key === 'd' || e.key === 'D') {
      playTonic();
    }
  });

  canvas.addEventListener('pointerdown', () => {
    if (G.state === 'playing' && G.inputMode === 'keys') practiceLockNext();
  });

  // Boot
  resize();
  syncDrawerFromCfg();
  requestAnimationFrame(frame);
})();
