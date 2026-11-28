'use strict';
/* Rehearsal classroom music tools:
   1. Classroom Piano & Vocal Warm-Up Sequencer (renderPiano)
   2. Rehearsal Backing-Track & Reference Audio Player (mountAudioPlayer)
   3. Interactive Solfege Ladder, Curwen Hand Signs & Echo Board (renderSolBoard) */

const TOOL_PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const TOOL_SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const TOOL_FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const TOOL_KEY_LABELS = ['C', 'D♭ / C♯', 'D', 'E♭', 'E', 'F', 'F♯ / G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const TOOL_FLAT_KEYS = new Set([1, 3, 5, 8, 10]); // Db, Eb, F, Ab, Bb prefer flats
const TOOL_ENH = { 1: ['C♯', 'D♭'], 3: ['D♯', 'E♭'], 6: ['F♯', 'G♭'], 8: ['G♯', 'A♭'], 10: ['A♯', 'B♭'] };
const TOOL_SOL_SHARP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
const TOOL_SOL_FLAT = ['do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'sol', 'le', 'la', 'te', 'ti'];
const TOOL_VF_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const TOOL_KEY_SCALES = [
  ['c', 'd', 'e', 'f', 'g', 'a', 'b'],
  ['db', 'eb', 'f', 'gb', 'ab', 'bb', 'c'],
  ['d', 'e', 'f#', 'g', 'a', 'b', 'c#'],
  ['eb', 'f', 'g', 'ab', 'bb', 'c', 'd'],
  ['e', 'f#', 'g#', 'a', 'b', 'c#', 'd#'],
  ['f', 'g', 'a', 'bb', 'c', 'd', 'e'],
  ['f#', 'g#', 'a#', 'b', 'c#', 'd#', 'e#'],
  ['g', 'a', 'b', 'c', 'd', 'e', 'f#'],
  ['ab', 'bb', 'c', 'db', 'eb', 'f', 'g'],
  ['a', 'b', 'c#', 'd', 'e', 'f#', 'g#'],
  ['bb', 'c', 'd', 'eb', 'f', 'g', 'a'],
  ['b', 'c#', 'd#', 'e', 'f#', 'g#', 'a#'],
];
const TOOL_NAT_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const TOOL_MAJOR_SEMI = [0, 2, 4, 5, 7, 9, 11];
const TOOL_MINOR_SEMI = [0, 2, 3, 5, 7, 8, 10];
const TOOL_PENTA_SEMI = [0, 2, 4, 7, 9];

function toolMidiName(m, keyPc = null) {
  const pc = ((m % 12) + 12) % 12, oct = Math.floor(m / 12) - 1;
  if (keyPc === true || keyPc === 'sharp') return TOOL_SHARP_NAMES[pc] + oct;
  if (keyPc === 'flat') return TOOL_FLAT_NAMES[pc] + oct;
  if (typeof keyPc === 'number') return (TOOL_FLAT_KEYS.has(((keyPc % 12) + 12) % 12) ? TOOL_FLAT_NAMES[pc] : TOOL_SHARP_NAMES[pc]) + oct;
  return TOOL_PC_NAMES[pc] + oct;
}

// Convert a MIDI note relative to a major tonic pitch class into a textbook VexFlow key string (e.g. 'db/4', 'e#/5').
function toolMidiToVfKey(midi, rootPc) {
  const kp = ((rootPc % 12) + 12) % 12;
  const rel = ((midi - kp) % 12 + 12) % 12;
  const scale = TOOL_KEY_SCALES[kp];
  let sp = null;
  const diatIdx = TOOL_MAJOR_SEMI.indexOf(rel);
  if (diatIdx >= 0) {
    sp = scale[diatIdx];
  } else {
    // Chromatic pitch: raise the lower diatonic neighbor unless that creates a double sharp, else lower the upper neighbor.
    const loIdx = TOOL_MAJOR_SEMI.indexOf((rel + 11) % 12);
    if (loIdx >= 0 && !scale[loIdx].endsWith('#')) {
      const base = scale[loIdx];
      sp = base.endsWith('b') ? base[0] : base + '#';
    } else {
      const hiIdx = TOOL_MAJOR_SEMI.indexOf((rel + 1) % 12);
      const base = hiIdx >= 0 ? scale[hiIdx] : 'c';
      sp = base.endsWith('#') ? base[0] : base + 'b';
    }
  }
  const accOff = sp.endsWith('#') ? 1 : sp.endsWith('b') ? -1 : 0;
  const oct = Math.round((midi - (TOOL_NAT_PC[sp[0]] + accOff)) / 12) - 1;
  return `${sp}/${oct}`;
}

// Plays a note with the bundled FluidR3 piano when loaded, or a warm synth immediately while loading.
function toolPlayNote(midi, dur = 0.85, vel = 0.78, sound = 'piano', atTime = null) {
  const c = ac(); c.resume?.();
  const t = atTime ?? c.currentTime + 0.005;
  const dest = typeof musicOut === 'function' ? musicOut(c) : c.destination;
  if (sound === 'piano' && typeof SP_PIANO !== 'undefined' && typeof spNoteName === 'function' && SP_PIANO.buffers[spNoteName(midi)]) {
    spPianoNote(dest, t, midi, dur, vel);
    return;
  }
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.02, vel * 0.36), t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.08, dur + 0.15));
  g.connect(dest);
  if (sound === 'organ') {
    const o = c.createOscillator();
    const w = c.createPeriodicWave(new Float32Array([0, 1, .5, .3, .18, .1]), new Float32Array(6));
    o.setPeriodicWave(w); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + dur + 0.22);
  } else if (sound === 'sine') {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + dur + 0.22);
  } else {
    // warm piano-like fallback while FluidR3 samples finish decoding
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
    o1.type = 'triangle'; o1.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2; g2.gain.value = 0.22;
    o1.connect(g); o2.connect(g2).connect(g);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.22); o2.stop(t + dur + 0.22);
  }
}

function toolEnsurePiano(midis) {
  if (typeof spPianoReady === 'function') spPianoReady(midis).catch(() => { });
}

// ============================================================ 1. CLASSROOM PIANO & VOCAL WARM-UP SEQUENCER
const PIANO_PATTERNS = {
  scale5:     { name: '5-Note Scale',             tip: 'Vowels: nee–neh–nah–noh–noo', steps: [[0,1],[2,1],[4,1],[5,1],[7,1],[5,1],[4,1],[2,1],[0,2]], syl: ['do','re','mi','fa','sol','fa','mi','re','do'] },
  sigh5:      { name: '5-4-3-2-1 Sigh',           tip: 'Gentle descending release',   steps: [[7,1],[5,1],[4,1],[2,1],[0,2]], syl: ['sol','fa','mi','re','do'] },
  triad:      { name: 'Major Triad',              tip: 'Legato 1–3–5–3–1',            steps: [[0,1],[4,1],[7,1],[4,1],[0,2]], syl: ['do','mi','sol','mi','do'] },
  staccato:   { name: 'Staccato Triad ("Ha-Ha")', tip: 'Crisp diaphragm bounce',      staccato: true, steps: [[0,1],[4,1],[7,1],[4,1],[0,1]], syl: ['do','mi','sol','mi','do'] },
  octarp:     { name: 'Octave Arpeggio',          tip: '1–3–5–8–5–3–1',               steps: [[0,1],[4,1],[7,1],[12,1],[7,1],[4,1],[0,2]], syl: ['do','mi','sol',"do'",'sol','mi','do'] },
  siren:      { name: '1–5–8–5–1 Siren',          tip: 'Lip trill or ng hum',         steps: [[0,1],[7,1],[12,1],[7,1],[0,2]], syl: ['do','sol',"do'",'sol','do'] },
  thirds:     { name: 'Thirds Agility',           tip: '"Mommy made me mash…"',       steps: [[0,.5],[4,.5],[2,.5],[5,.5],[4,.5],[7,.5],[5,.5],[2,.5],[0,2]], syl: ['do','mi','re','fa','mi','sol','fa','re','do'] },
  descthirds: { name: 'Descending Thirds',        tip: '5–3–4–2–3–1–2–7–1',           steps: [[7,.5],[4,.5],[5,.5],[2,.5],[4,.5],[0,.5],[2,.5],[-1,.5],[0,2]], syl: ['sol','mi','fa','re','mi','do','re','ti,','do'] },
  zing:       { name: 'Zing-a-Mama',              tip: 'High-do descending cascade',  steps: [[12,1],[7,.5],[4,.5],[0,1],[7,.5],[4,.5],[0,2]], syl: ["do'",'sol','mi','do','sol','mi','do'] },
  scale8:     { name: 'Full Octave Scale',        tip: 'Smooth 1–8–1 legato',         steps: [[0,.5],[2,.5],[4,.5],[5,.5],[7,.5],[9,.5],[11,.5],[12,.5],[11,.5],[9,.5],[7,.5],[5,.5],[4,.5],[2,.5],[0,2]], syl: ['do','re','mi','fa','sol','la','ti',"do'",'ti','la','sol','fa','mi','re','do'] },
  rossini:    { name: 'Rossini 9-Note Scale',     tip: 'Classic 1–9–1 agility',       steps: [[0,.5],[2,.5],[4,.5],[5,.5],[7,.5],[9,.5],[11,.5],[12,.5],[14,.5],[12,.5],[11,.5],[9,.5],[7,.5],[5,.5],[4,.5],[2,.5],[0,2]], syl: ['do','re','mi','fa','sol','la','ti',"do'","re'","do'",'ti','la','sol','fa','mi','re','do'] },
  chrom:      { name: 'Chromatic Hum',            tip: 'Half-step tuning & blend',    steps: [[0,1],[1,1],[2,1],[1,1],[0,2]], syl: ['do','di','re','di','do'] },
};
const PIANO_CHORDS = [
  { id: 'I',  lbl: 'I',  semi: [0, 4, 7] },
  { id: 'ii', lbl: 'ii', semi: [2, 5, 9] },
  { id: 'iii',lbl: 'iii',semi: [4, 7, 11] },
  { id: 'IV', lbl: 'IV', semi: [5, 9, 12] },
  { id: 'V',  lbl: 'V',  semi: [7, 11, 14] },
  { id: 'V7', lbl: 'V7', semi: [7, 11, 14, 17] },
  { id: 'vi', lbl: 'vi', semi: [9, 12, 16] },
];
const PIANO_KBD_MAP = { a:0, w:1, s:2, e:3, d:4, f:5, t:6, g:7, y:8, h:9, u:10, j:11, k:12, o:13, l:14, p:15, ';':16 };
const PIANO_OFF_TO_KBD = Object.fromEntries(Object.entries(PIANO_KBD_MAP).map(([k, off]) => [off, k.toUpperCase()]));

const PIANO_SEQ = { playing: false, host: null, timers: [], stepIdx: 0, noteIdx: -1, roots: [] };

const PIANO_DEFAULTS = () => ({
  baseOct: 3, keyPc: 0, labels: 'notes', sustain: false, kbdOn: true, seqOpen: true,
  pattern: 'scale5', startMidi: 60, peakMidi: 67, dir: 'updown', tempo: 116,
  chordBetween: true, autoStep: true, clef: 'treble', showCounts: false,
  zoom: 1, staffH: 136,
});
function pianoState(h = null) {
  let st = null;
  const rid = h?.dataset?.wgRes, wid = h?.dataset?.wgWin;
  if (rid && typeof findRes === 'function') {
    const r = findRes(rid);
    if (r?.widget) {
      if (!r.widget.state) r.widget.state = Object.assign(PIANO_DEFAULTS(), JSON.parse(JSON.stringify(S.settings.piano || {})));
      st = r.widget.state;
    }
  } else if (wid && typeof findWin === 'function') {
    const w = findWin(wid);
    if (w) {
      if (!w.wgState) w.wgState = Object.assign(PIANO_DEFAULTS(), JSON.parse(JSON.stringify(S.settings.piano || {})));
      st = w.wgState;
    }
  }
  st ||= (S.settings.piano ||= PIANO_DEFAULTS());
  if (st.kbdOn === undefined) st.kbdOn = true;
  if (!st.clef) st.clef = 'treble';
  if (st.showCounts === undefined) st.showCounts = false;
  if (!st.zoom) st.zoom = 1;
  if (!st.staffH) st.staffH = 136;
  if (st.pattern === 'scale9') st.pattern = 'rossini';
  if (st.pattern === 'octslide') st.pattern = 'siren';
  return st;
}

function pianoActiveKeyPc(st) {
  if (PIANO_SEQ.playing && PIANO_SEQ.roots[PIANO_SEQ.stepIdx] != null) {
    return ((PIANO_SEQ.roots[PIANO_SEQ.stepIdx] % 12) + 12) % 12;
  }
  return ((st.keyPc || 0) % 12 + 12) % 12;
}

function pianoKeyLabelHTML(m, labels, keyPc, isBlack) {
  if (labels === 'off') return '';
  if (labels === 'solfege') {
    const rel = ((m - keyPc) % 12 + 12) % 12;
    const syl = (TOOL_FLAT_KEYS.has(keyPc) ? TOOL_SOL_FLAT : TOOL_SOL_SHARP)[rel];
    return `<span class="pk-lbl">${syl}</span>`;
  }
  const pc = ((m % 12) + 12) % 12;
  if (isBlack) {
    const [sh, fl] = TOOL_ENH[pc];
    const preferFlat = TOOL_FLAT_KEYS.has(keyPc);
    const top = preferFlat ? fl : sh, bot = preferFlat ? sh : fl;
    return `<span class="pk-enh"><b>${top}</b><small>${bot}</small></span>`;
  }
  return `<span class="pk-lbl">${pc === 0 ? 'C' + (Math.floor(m / 12) - 1) : TOOL_SHARP_NAMES[pc]}</span>`;
}

// Update piano key labels, tonic highlights, and chords header smoothly without rebuilding the DOM (ideal during warm-up modulation).
function pianoSyncKeyLabels(host, keyPc, st) {
  const kp = ((keyPc % 12) + 12) % 12;
  host.querySelectorAll('.pk-key').forEach(btn => {
    const m = +btn.dataset.midi;
    const isBlack = btn.classList.contains('bk');
    const lblWrap = btn.querySelector('.pk-txt');
    if (lblWrap) lblWrap.innerHTML = pianoKeyLabelHTML(m, st.labels, kp, isBlack);
    btn.classList.toggle('is-do', st.labels === 'solfege' && ((m - kp) % 12 + 12) % 12 === 0);
  });
  const clbl = host.querySelector('.pn-clbl');
  if (clbl) clbl.textContent = `${TOOL_PC_NAMES[kp]} Chords`;
}

// Render the current warm-up pattern as real VexFlow sheet music with key signature, movable-do solfege, and optional rhythm counts.
function pianoDrawWarmupStaff(host, st, root) {
  const box = host.querySelector('.pq-staff');
  const VF = window.Vex && window.Vex.Flow;
  if (!box || !VF) return;
  const pat = PIANO_PATTERNS[st.pattern] || PIANO_PATTERNS.scale5;
  const rootPc = ((root % 12) + 12) % 12;
  const vfKey = TOOL_VF_KEYS[rootPc];
  const clef = st.clef === 'bass' ? 'bass' : 'treble';
  const showCounts = !!st.showCounts;
  const nNotes = pat.steps.length;
  const totalBeats = pat.steps.reduce((a, s) => a + s[1], 0);
  const W = Math.max(460, Math.min(820, 128 + nNotes * 40));
  const H = showCounts ? 148 : 126;

  box.innerHTML = '';
  host.__pqNoteEls = [];
  try {
    const renderer = new VF.Renderer(box, VF.Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();
    const stave = new VF.Stave(8, 12, W - 16);
    stave.addClef(clef);
    if (vfKey !== 'C') stave.addKeySignature(vfKey);
    stave.setEndBarType(VF.Barline.type.END);
    stave.setContext(ctx).draw();

    const durStr = b => b <= 0.5 ? '8' : b === 1 ? 'q' : b === 1.5 ? 'qd' : b === 2 ? 'h' : b === 3 ? 'hd' : 'w';
    const notes = pat.steps.map(([semi, beats]) => {
      const ds = durStr(beats);
      const n = new VF.StaveNote({
        keys: [toolMidiToVfKey(root + semi, rootPc)],
        duration: ds.replace('d', ''),
        dots: ds.includes('d') ? 1 : 0,
        clef,
        auto_stem: true,
      });
      if (ds.includes('d')) {
        if (VF.Dot && VF.Dot.buildAndAttach) VF.Dot.buildAndAttach([n], { all: true });
        else if (n.addDotToAll) n.addDotToAll();
      }
      if (pat.staccato && VF.Articulation) {
        try { n.addModifier(new VF.Articulation('a.').setPosition(VF.Modifier.Position.ABOVE), 0); } catch { }
      }
      return n;
    });

    const beams = [];
    let run = [];
    pat.steps.forEach(([, beats], i) => {
      if (beats <= 0.5) {
        run.push(notes[i]);
        if (run.length === 4) { beams.push(new VF.Beam(run, true)); run = []; }
      } else {
        if (run.length >= 2) beams.push(new VF.Beam(run, true));
        run = [];
      }
    });
    if (run.length >= 2) beams.push(new VF.Beam(run, true));

    const voice = new VF.Voice({ num_beats: Math.max(4, Math.ceil(totalBeats)), beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
    voice.addTickables(notes);
    if (VF.Accidental && VF.Accidental.applyAccidentals) VF.Accidental.applyAccidentals([voice], vfKey);
    const fmtW = Math.max(180, stave.getNoteEndX() - stave.getNoteStartX() - 24);
    new VF.Formatter().joinVoices([voice]).format([voice], fmtW);
    voice.draw(ctx, stave);
    beams.forEach(b => b.setContext(ctx).draw());

    // Capture each StaveNote's SVG group for live playback highlighting
    host.__pqNoteEls = notes.map(n => (n.getAttribute ? n.getAttribute('el') : (n.attrs && n.attrs.el)) || null);

    // Draw movable-do solfege + optional rhythm count syllables underneath
    let bottom = stave.getYForLine(4) + 12;
    for (const n of notes) {
      const ys = n.getYs ? n.getYs() : [];
      const down = n.getStemDirection && n.getStemDirection() === -1;
      if (ys.length) bottom = Math.max(bottom, Math.max(...ys) + (down ? 30 : 8));
    }
    bottom = Math.min(bottom, H - (showCounts ? 38 : 20));
    const headX = n => (typeof srHeadX === 'function' ? srHeadX(n) : n.getAbsoluteX() + 6);
    const mTxt = txt => { try { const w = ctx.measureText(txt).width; if (w > 0) return w; } catch { } return txt.length * 7; };

    let beatPos = 0;
    const useDashes = typeof rhythmSys === 'function' && (rhythmSys() === 'kodaly' || rhythmSys() === 'takadimi');
    const countPlaced = [];
    notes.forEach((n, i) => {
      const cx = headX(n);
      const syl = pat.syl[i] || '';
      if (syl) {
        ctx.save();
        ctx.setFont('Arial', 12.5, 'bold');
        ctx.setFillStyle('#1d2330');
        ctx.fillText(syl, cx - mTxt(syl) / 2, bottom + 14);
        ctx.restore();
      }
      if (showCounts && typeof rhythmSyllable === 'function') {
        const beats = pat.steps[i][1];
        const posInBar = beatPos % 4;
        const lbl = rhythmSyllable(posInBar, 'simple', false, beats);
        if (lbl) {
          ctx.save();
          ctx.setFont('Arial', 11.5, 'bold');
          ctx.setFillStyle('#5a6275');
          const lw = mTxt(lbl);
          ctx.fillText(lbl, cx - lw / 2, bottom + 31);
          ctx.restore();
          countPlaced.push({ x: cx - lw / 2, w: lw, beatIdx: Math.floor(beatPos + 1e-6), dur: beats });
        }
      }
      beatPos += pat.steps[i][1];
    });
    if (useDashes && countPlaced.length > 1) {
      for (let i = 1; i < countPlaced.length; i++) {
        const a = countPlaced[i - 1], b = countPlaced[i];
        if (a.dur < 1 && b.dur < 1 && a.beatIdx === b.beatIdx) {
          const midX = (a.x + a.w + b.x) / 2;
          ctx.save();
          ctx.setFont('Arial', 11.5, 'bold');
          ctx.setFillStyle('#5a6275');
          ctx.fillText('-', midX - mTxt('-') / 2, bottom + 31);
          ctx.restore();
        }
      }
    }

    const svg = box.querySelector('svg');
    if (svg) {
      const zm = clamp(Number(st.zoom) || 1, 0.6, 2.2);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.height = `${Math.round(H * zm)}px`;
      svg.style.maxHeight = 'none';
      svg.style.width = 'auto';
      svg.style.maxWidth = 'none';
    }
  } catch { }
}

function pianoHighlightStaffNote(host, noteIdx) {
  const els = host.__pqNoteEls || [];
  els.forEach((el, j) => {
    if (!el) return;
    if (typeof srLight === 'function') srLight(el, j === noteIdx);
    else el.classList.toggle('sr-cur', j === noteIdx);
  });
}

function pianoSeqStop(rerender = false) {
  PIANO_SEQ.timers.forEach(clearTimeout);
  PIANO_SEQ.timers = [];
  const h = PIANO_SEQ.host;
  PIANO_SEQ.playing = false; PIANO_SEQ.noteIdx = -1;
  if (h) {
    h.querySelectorAll('.pk-key.lit, .pq-syl.on').forEach(x => x.classList.remove('lit', 'on'));
    pianoHighlightStaffNote(h, -1);
  }
  if (rerender && h && h.isConnected) renderPiano(h);
}

function pianoBuildRoots(st) {
  const s = st.startMidi, p = st.peakMidi;
  const seq = (from, to) => {
    const out = [], step = to >= from ? 1 : -1;
    for (let m = from; step > 0 ? m <= to : m >= to; m += step) out.push(m);
    return out;
  };
  if (st.dir === 'up') return seq(s, Math.max(s, p));
  if (st.dir === 'down') return seq(s, Math.min(s, p));
  const first = seq(s, p);
  const back = first.length > 1 ? first.slice(0, -1).reverse() : [];
  return [...first, ...back];
}
function pianoRoutePreview(st) {
  const roots = pianoBuildRoots(st);
  if (!roots.length) return '';
  if (roots.length === 1) return toolMidiName(roots[0]);
  if (st.dir === 'updown' && roots.length > 2) {
    const mid = roots[Math.floor(roots.length / 2)];
    return `${toolMidiName(roots[0])} → ${toolMidiName(mid)} → ${toolMidiName(roots[roots.length - 1])}`;
  }
  return `${toolMidiName(roots[0])} → ${toolMidiName(roots[roots.length - 1])}`;
}

function pianoLightKey(host, midi, ms = 380) {
  const k = host.querySelector(`.pk-key[data-midi="${midi}"]`);
  if (!k) return;
  k.classList.add('lit');
  const tid = setTimeout(() => k.classList.remove('lit'), ms);
  PIANO_SEQ.timers.push(tid);
}

function pianoPlayStep(host, st, idx) {
  if (!host.isConnected) return pianoSeqStop();
  const pat = PIANO_PATTERNS[st.pattern] || PIANO_PATTERNS.scale5;
  const roots = PIANO_SEQ.roots;
  if (idx >= roots.length) { pianoSeqStop(true); return; }
  PIANO_SEQ.stepIdx = idx;
  const root = roots[idx];
  const rootPc = ((root % 12) + 12) % 12;

  // Shift keyboard octave automatically if the pattern reaches outside the visible 2.5 octaves
  const loVis = 12 * (st.baseOct + 1), hiVis = loVis + 31;
  const minNote = root + Math.min(0, ...pat.steps.map(s => s[0]));
  const maxNote = root + Math.max(7, ...pat.steps.map(s => s[0]));
  if (minNote < loVis || maxNote > hiVis) {
    st.baseOct = clamp(Math.floor(minNote / 12) - 1, 2, 5);
    renderPiano(host);
  }

  // Update banner, piano key labels (so Solfege "do" moves with the key!), and live VexFlow staff
  const kEl = host.querySelector('.pq-key'), cEl = host.querySelector('.pq-cnt');
  if (kEl) kEl.textContent = `${TOOL_KEY_LABELS[rootPc]} Major`;
  if (cEl) cEl.textContent = idx > 0 && st.chordBetween ? `Modulating → V7 – I (${idx + 1}/${roots.length})` : `Key ${idx + 1} of ${roots.length}`;
  pianoSyncKeyLabels(host, rootPc, st);
  pianoDrawWarmupStaff(host, st, root);

  const beatMs = 60000 / clamp(Number(st.tempo) || 116, 50, 200);
  let delay = 0;
  const allMidis = pat.steps.map(s => root + s[0]);
  const v7Chord = [root - 5, root - 1, root + 2, root + 5];
  const iChord = [root, root + 4, root + 7];
  if (root >= 60) iChord.unshift(root - 12);
  toolEnsurePiano([...allMidis, ...v7Chord, ...iChord]);

  if (st.chordBetween) {
    if (idx > 0) {
      // Classic choral accompanist modulation between reps: V7 of the new key → I of the new key
      const tV7 = setTimeout(() => {
        if (!PIANO_SEQ.playing || !host.isConnected) return;
        v7Chord.forEach(m => { toolPlayNote(m, beatMs * 0.95 / 1000, 0.52); pianoLightKey(host, m, beatMs * 0.85); });
        host.querySelectorAll('.pq-syl.on').forEach(x => x.classList.remove('on'));
        pianoHighlightStaffNote(host, -1);
      }, delay);
      PIANO_SEQ.timers.push(tV7);
      delay += beatMs * 1.0;
    }
    const tI = setTimeout(() => {
      if (!PIANO_SEQ.playing || !host.isConnected) return;
      iChord.forEach(m => { toolPlayNote(m, beatMs * 1.15 / 1000, 0.58); pianoLightKey(host, m, beatMs * 0.95); });
      if (cEl) cEl.textContent = `Key ${idx + 1} of ${roots.length}`;
      host.querySelectorAll('.pq-syl.on').forEach(x => x.classList.remove('on'));
      pianoHighlightStaffNote(host, -1);
    }, delay);
    PIANO_SEQ.timers.push(tI);
    delay += beatMs * 1.35;
  }

  pat.steps.forEach(([semi, beats], ni) => {
    const m = root + semi, durMs = beats * beatMs;
    const noteSec = pat.staccato ? Math.max(0.11, (durMs * 0.36) / 1000) : Math.max(0.18, (durMs * 0.92) / 1000);
    const tid = setTimeout(() => {
      if (!PIANO_SEQ.playing || !host.isConnected) return;
      toolPlayNote(m, noteSec, 0.84);
      pianoLightKey(host, m, Math.max(140, pat.staccato ? durMs * 0.42 : durMs * 0.85));
      host.querySelectorAll('.pq-syl').forEach((el, j) => el.classList.toggle('on', j === ni));
      pianoHighlightStaffNote(host, ni);
    }, delay);
    PIANO_SEQ.timers.push(tid);
    delay += durMs;
  });

  if (st.autoStep) {
    const nextTid = setTimeout(() => {
      if (!PIANO_SEQ.playing) return;
      pianoPlayStep(host, st, idx + 1);
    }, delay + beatMs * 0.55);
    PIANO_SEQ.timers.push(nextTid);
  } else {
    const endTid = setTimeout(() => {
      if (!PIANO_SEQ.playing) return;
      host.querySelectorAll('.pq-syl.on').forEach(x => x.classList.remove('on'));
      pianoHighlightStaffNote(host, -1);
    }, delay + 120);
    PIANO_SEQ.timers.push(endTid);
  }
}

function renderPiano(h) {
  const st = pianoState(h);
  const baseMidi = 12 * (st.baseOct + 1); // e.g., C3 = 48
  const kbdBase = baseMidi + 12;          // middle octave (C4..E5 when showing C3..G5)
  // Build 19 white keys (2.5 octaves: C..G) + intervening black keys
  const whiteOffsets = [], blackOffsets = [];
  const isBlackPc = pc => [1, 3, 6, 8, 10].includes(pc);
  let wCount = 0;
  for (let off = 0; off <= 31; off++) {
    const m = baseMidi + off, pc = m % 12;
    if (isBlackPc(pc)) blackOffsets.push({ m, pos: wCount });
    else { whiteOffsets.push({ m, idx: wCount }); wCount++; }
  }
  toolEnsurePiano([...whiteOffsets.map(x => x.m), ...blackOffsets.map(x => x.m)]);

  const pat = PIANO_PATTERNS[st.pattern] || PIANO_PATTERNS.scale5;
  const activeRoot = PIANO_SEQ.playing && PIANO_SEQ.roots[PIANO_SEQ.stepIdx] != null
    ? PIANO_SEQ.roots[PIANO_SEQ.stepIdx]
    : st.startMidi;
  const activeKeyPc = PIANO_SEQ.playing
    ? ((activeRoot % 12) + 12) % 12
    : (st.seqOpen ? ((st.startMidi % 12) + 12) % 12 : ((st.keyPc || 0) % 12 + 12) % 12);

  const keyRangeOpts = [];
  for (let m = 43; m <= 79; m++) keyRangeOpts.push(m); // G2 to G5 (supports Bass & Treble choirs)

  const kbdBadge = m => {
    if (st.kbdOn === false) return '';
    const k = PIANO_OFF_TO_KBD[m - kbdBase];
    return k ? `<kbd class="pk-kbd">${k}</kbd>` : '';
  };

  h.innerHTML = `<div class="pn" tabindex="0">
    <div class="pn-bar">
      <div class="pn-grp">
        <button data-pn="oct" data-d="-1" title="Lower octave (Z)" ${st.baseOct <= 2 ? 'disabled' : ''}>${IC('ico:chevleft')}</button>
        <span class="pn-oct">C${st.baseOct}–G${st.baseOct + 2}</span>
        <button data-pn="oct" data-d="1" title="Higher octave (X)" ${st.baseOct >= 5 ? 'disabled' : ''}>${IC('ico:chevright')}</button>
      </div>
      <label class="pn-sel">Key <select data-pn-k="keyPc">${TOOL_KEY_LABELS.map((n, i) => `<option value="${i}" ${activeKeyPc === i ? 'selected' : ''}>${n} major</option>`).join('')}</select></label>
      <div class="pn-seg" role="group" aria-label="Key labels">
        ${[['notes', 'Notes'], ['solfege', 'Solfege'], ['off', 'Off']].map(([v, l]) => `<button data-pn="labels" data-v="${v}" class="${st.labels === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <button data-pn="sustain" class="${st.sustain ? 'on' : ''}" title="Hold notes longer">Sustain</button>
      <button data-pn="kbd" class="${st.kbdOn !== false ? 'on' : ''}" title="Play piano with computer keyboard (A–; keys, Z/X octave)">${IC('ico:keyboard')} Keys</button>
      <span class="grow"></span>
      <button data-pn="seq-toggle" class="${st.seqOpen ? 'on' : ''}">${IC('ico:music')} Warm-up</button>
    </div>

    <div class="pn-chords">
      <span class="pn-clbl">${TOOL_PC_NAMES[activeKeyPc]} Chords</span>
      ${PIANO_CHORDS.map(ch => `<button data-pn="chord" data-c="${ch.id}" title="Play ${ch.lbl} chord in ${TOOL_PC_NAMES[activeKeyPc]}">${ch.lbl}</button>`).join('')}
      <span class="pn-hint">${st.kbdOn !== false ? 'Type A–; to play · Z / X = octave' : 'Click or slide across keys'}</span>
    </div>

    <div class="pn-keys ${st.kbdOn !== false ? 'has-kbd' : ''}">
      ${whiteOffsets.map(({ m }) => {
        const isDo = st.labels === 'solfege' && ((m - activeKeyPc) % 12 + 12) % 12 === 0;
        return `<button type="button" class="pk-key wk ${isDo ? 'is-do' : ''}" data-midi="${m}">${kbdBadge(m)}<span class="pk-txt">${pianoKeyLabelHTML(m, st.labels, activeKeyPc, false)}</span></button>`;
      }).join('')}
      ${blackOffsets.map(({ m, pos }) => {
        const isDo = st.labels === 'solfege' && ((m - activeKeyPc) % 12 + 12) % 12 === 0;
        return `<button type="button" class="pk-key bk ${isDo ? 'is-do' : ''}" data-midi="${m}" style="left:calc(${(pos * 100 / wCount).toFixed(3)}% - ${(50 / wCount * 0.66).toFixed(3)}%);width:${(100 / wCount * 0.66).toFixed(3)}%">${kbdBadge(m)}<span class="pk-txt">${pianoKeyLabelHTML(m, st.labels, activeKeyPc, true)}</span></button>`;
      }).join('')}
    </div>

    ${st.seqOpen ? (() => {
      const zoomPct = Math.round(clamp(Number(st.zoom) || 1, 0.6, 2.2) * 100);
      const boxH = clamp(Number(st.staffH) || 136, 88, 360);
      return `<div class="pn-seq">
      <div class="pq-banner">
        <div class="pq-meta"><b class="pq-key">${TOOL_KEY_LABELS[((activeRoot % 12) + 12) % 12]} Major</b><span class="pq-route" title="Warm-up key progression">${pianoRoutePreview(st)}</span><span class="pq-cnt">${PIANO_SEQ.playing ? `Key ${PIANO_SEQ.stepIdx + 1} of ${PIANO_SEQ.roots.length}` : (pat.tip || pat.name)}</span></div>
        <div class="pq-syls">${pat.syl.map(s => `<span class="pq-syl">${s}</span>`).join('')}</div>
        <span class="grow"></span>
        <span class="tb-lbl">Zoom</span>
        <span class="sr-zoom pq-zoom" title="Make the warm-up music bigger or smaller (${zoomPct}%) — pinch on trackpad or click % to reset"><button type="button" data-pn="zoom" data-d="-1" title="Smaller" ${(st.zoom || 1) <= 0.6 ? 'disabled' : ''}>${IC('ico:minus')}</button><button type="button" class="tb-zpct" data-pn="zoom-reset" title="Reset zoom to 100%">${zoomPct}%</button><button type="button" data-pn="zoom" data-d="1" title="Bigger" ${(st.zoom || 1) >= 2.2 ? 'disabled' : ''}>${IC('ico:plus')}</button></span>
      </div>
      <div class="pq-staff-wrap" style="height:${boxH}px">
        <div class="pq-staff" aria-label="Warm-up music notation"></div>
        <div class="pq-resize" title="Drag up or down to resize the notation window"><span></span></div>
      </div>`;
    })() : ''}${st.seqOpen ? `
      <div class="pq-row">
        <button data-pn="seq-play" class="pn-primary">${PIANO_SEQ.playing && PIANO_SEQ.host === h ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Start warm-up'}</button>
        ${PIANO_SEQ.playing && !st.autoStep ? `<button data-pn="seq-next">Next key ${IC('ico:chevright')}</button>` : ''}
        <label>Pattern <select data-pn-k="pattern">${Object.entries(PIANO_PATTERNS).map(([k, p]) => `<option value="${k}" ${st.pattern === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
        <label>Start <select data-pn-k="startMidi">${keyRangeOpts.map(m => `<option value="${m}" ${st.startMidi === m ? 'selected' : ''}>${toolMidiName(m)}</option>`).join('')}</select></label>
        <label title="Highest (or turnaround/lowest) key the warm-up reaches before turning back"><span class="pq-peak-lbl">${st.dir === 'down' ? 'Low' : st.peakMidi < st.startMidi ? 'Turnaround' : 'Peak'}</span> <select data-pn-k="peakMidi">${keyRangeOpts.map(m => `<option value="${m}" ${st.peakMidi === m ? 'selected' : ''}>${toolMidiName(m)}</option>`).join('')}</select></label>
        <label>Move <select data-pn-k="dir">${[['updown', 'Up & down'], ['up', 'Up only'], ['down', 'Down only']].map(([v, l]) => `<option value="${v}" ${st.dir === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Clef <select data-pn-k="clef">${[['treble', 'Treble'], ['bass', 'Bass']].map(([v, l]) => `<option value="${v}" ${st.clef === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>BPM <input type="number" min="50" max="200" step="4" data-pn-k="tempo" value="${st.tempo}"></label>
        <label class="pn-chk" title="Play V7 → I modulation chord into each new key"><input type="checkbox" data-pn-k="chordBetween" ${st.chordBetween ? 'checked' : ''}> Modulate chord</label>
        <label class="pn-chk" title="Automatically advance to the next key after each pattern"><input type="checkbox" data-pn-k="autoStep" ${st.autoStep ? 'checked' : ''}> Auto-advance keys</label>
        <label class="pn-chk" title="Show rhythm counting syllables under the warm-up staff"><input type="checkbox" data-pn-k="showCounts" ${st.showCounts ? 'checked' : ''}> Counts</label>
      </div>
    </div>` : ''}
  </div>`;

  const applyPianoZoom = nextZ => {
    const z = clamp(Math.round(nextZ * 100) / 100, 0.6, 2.2);
    if (Math.abs(z - (st.zoom || 1)) < 1e-3) return;
    st.zoom = z;
    const pct = Math.round(z * 100);
    const svg = h.querySelector('.pq-staff svg');
    if (svg) {
      const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      const baseH = vb[3] || 110;
      svg.style.height = `${Math.round(baseH * z)}px`;
    }
    const zBox = h.querySelector('.pq-zoom');
    if (zBox) {
      const lbl = zBox.querySelector('.tb-zpct'); if (lbl) lbl.textContent = `${pct}%`;
      const minus = zBox.querySelector('[data-d="-1"]'), plus = zBox.querySelector('[data-d="1"]');
      if (minus) minus.disabled = z <= 0.6;
      if (plus) plus.disabled = z >= 2.2;
    }
    save();
  };
  h.__pianoZoomBy = (factor, toggle = false) => {
    if (toggle) applyPianoZoom(Math.abs((st.zoom || 1) - 1) > 0.03 ? 1 : 1.4);
    else applyPianoZoom((Number(st.zoom) || 1) * factor);
  };
  if (st.seqOpen) {
    pianoDrawWarmupStaff(h, st, activeRoot);
    const rz = h.querySelector('.pq-resize'), wrap = h.querySelector('.pq-staff-wrap');
    if (wrap) {
      wrap.addEventListener('wheel', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault(); e.stopPropagation();
        h.__pianoZoomBy(Math.exp(-e.deltaY * 0.01));
      }, { passive: false });
      let gs = 1;
      wrap.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
      wrap.addEventListener('gesturechange', e => { e.preventDefault(); h.__pianoZoomBy(e.scale / gs); gs = e.scale; });
      wrap.addEventListener('gestureend', e => e.preventDefault());
    }
    if (rz && wrap) {
      rz.onpointerdown = ev => {
        ev.preventDefault(); ev.stopPropagation();
        const y0 = ev.clientY, h0 = wrap.offsetHeight;
        const move = mv => {
          const nh = clamp(Math.round(h0 + (mv.clientY - y0)), 88, 360);
          st.staffH = nh;
          wrap.style.height = nh + 'px';
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          save();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
    }
  }

  const keysEl = h.querySelector('.pn-keys');
  let dragging = false, lastMidi = null;
  const hitKey = btn => {
    if (!btn || !btn.dataset.midi) return;
    const m = +btn.dataset.midi;
    toolPlayNote(m, st.sustain ? 2.4 : 0.9, 0.85, 'piano');
    btn.classList.add('lit');
    setTimeout(() => btn.classList.remove('lit'), st.sustain ? 650 : 260);
  };
  h.__pianoHitKey = hitKey;
  h.__pianoBaseMidi = baseMidi;

  keysEl.onpointerdown = e => {
    const k = e.target.closest('.pk-key'); if (!k) return;
    e.preventDefault(); e.stopPropagation();
    dragging = true; lastMidi = k.dataset.midi; hitKey(k);
  };
  keysEl.onpointermove = e => {
    if (!dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.pk-key');
    if (el && el.dataset.midi !== lastMidi) { lastMidi = el.dataset.midi; hitKey(el); }
  };
  const endDrag = () => { dragging = false; lastMidi = null; };
  keysEl.onpointerup = endDrag; keysEl.onpointercancel = endDrag; keysEl.onpointerleave = endDrag;

  h.onclick = e => {
    const b = e.target.closest('[data-pn]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.pn;
    if (act === 'oct') { st.baseOct = clamp(st.baseOct + Number(b.dataset.d), 2, 5); save(); renderPiano(h); }
    else if (act === 'zoom') {
      const nextZ = clamp(Math.round(((Number(st.zoom) || 1) + 0.1 * Number(b.dataset.d)) * 100) / 100, 0.6, 2.2);
      const minFit = Math.round(126 * nextZ);
      if ((st.staffH || 136) < minFit && Number(b.dataset.d) > 0) {
        st.staffH = clamp(minFit, 88, 360);
        const wrap = h.querySelector('.pq-staff-wrap');
        if (wrap) wrap.style.height = st.staffH + 'px';
      }
      applyPianoZoom(nextZ);
    }
    else if (act === 'zoom-reset') { applyPianoZoom(1); }
    else if (act === 'labels') {
      st.labels = b.dataset.v; save();
      if (PIANO_SEQ.playing) {
        pianoSyncKeyLabels(h, pianoActiveKeyPc(st), st);
        h.querySelectorAll('[data-pn="labels"]').forEach(x => x.classList.toggle('on', x.dataset.v === st.labels));
      } else renderPiano(h);
    }
    else if (act === 'sustain') { st.sustain = !st.sustain; save(); if (PIANO_SEQ.playing) b.classList.toggle('on', st.sustain); else renderPiano(h); }
    else if (act === 'kbd') { st.kbdOn = st.kbdOn === false ? true : false; save(); if (!PIANO_SEQ.playing) renderPiano(h); else b.classList.toggle('on', st.kbdOn); }
    else if (act === 'seq-toggle') { st.seqOpen = !st.seqOpen; save(); if (!st.seqOpen && PIANO_SEQ.playing && PIANO_SEQ.host === h) pianoSeqStop(false); renderPiano(h); }
    else if (act === 'chord') {
      const ch = PIANO_CHORDS.find(x => x.id === b.dataset.c); if (!ch) return;
      const kp = pianoActiveKeyPc(st);
      const root = 12 * (st.baseOct + 2) + kp; // middle octave of visible keyboard
      ch.semi.forEach((semi, idx) => {
        const m = root + semi;
        setTimeout(() => { toolPlayNote(m, st.sustain ? 2.4 : 1.3, 0.72, 'piano'); pianoLightKey(h, m, 650); }, idx * 24);
      });
    } else if (act === 'seq-play') {
      if (PIANO_SEQ.playing && PIANO_SEQ.host === h) { pianoSeqStop(true); return; }
      pianoSeqStop(false);
      PIANO_SEQ.playing = true; PIANO_SEQ.host = h; PIANO_SEQ.roots = pianoBuildRoots(st);
      renderPiano(h);
      pianoPlayStep(h, st, 0);
    } else if (act === 'seq-next') {
      if (PIANO_SEQ.playing && PIANO_SEQ.host === h) pianoPlayStep(h, st, PIANO_SEQ.stepIdx + 1);
    }
  };
  h.onpointerdown = () => { window.__spaceTarget = 'piano'; window.__pianoActiveHost = h; };
  h.onchange = e => {
    const el = e.target, k = el.dataset.pnK; if (!k) return;
    if (el.type === 'checkbox') st[k] = el.checked;
    else if (['keyPc', 'startMidi', 'peakMidi', 'tempo'].includes(k)) st[k] = Number(el.value);
    else st[k] = el.value;
    // Keep Key selector and Warm-up Start note harmoniously synced
    if (k === 'keyPc' && st.seqOpen) {
      const oct = Math.floor(st.startMidi / 12);
      const span = st.peakMidi - st.startMidi;
      st.startMidi = clamp(oct * 12 + st.keyPc, 43, 75);
      st.peakMidi = clamp(st.startMidi + span, 43, 79);
    } else if (k === 'startMidi') {
      st.keyPc = ((st.startMidi % 12) + 12) % 12;
    } else if (k === 'clef') {
      // Shift warm-up range into a comfortable register when toggling Treble <-> Bass
      if (st.clef === 'bass' && st.startMidi >= 58) {
        st.startMidi = clamp(st.startMidi - 12, 43, 79);
        st.peakMidi = clamp(st.peakMidi - 12, 43, 79);
        st.baseOct = clamp(Math.floor(st.startMidi / 12) - 1, 2, 5);
      } else if (st.clef === 'treble' && st.startMidi < 55) {
        st.startMidi = clamp(st.startMidi + 12, 43, 79);
        st.peakMidi = clamp(st.peakMidi + 12, 43, 79);
        st.baseOct = clamp(Math.floor(st.startMidi / 12) - 1, 2, 5);
      }
    }
    // Auto-nudge Peak when switching to Down only with Peak above Start (or Up only with Peak below Start)
    if (k === 'dir') {
      if (st.dir === 'down' && st.peakMidi >= st.startMidi) st.peakMidi = clamp(st.startMidi - 5, 43, 79);
      else if (st.dir === 'up' && st.peakMidi <= st.startMidi) st.peakMidi = clamp(st.startMidi + 5, 43, 79);
    }
    save();
    if (!PIANO_SEQ.playing) {
      renderPiano(h);
    } else {
      const rt = h.querySelector('.pq-route'); if (rt) rt.textContent = pianoRoutePreview(st);
      const pl = h.querySelector('.pq-peak-lbl'); if (pl) pl.textContent = st.dir === 'down' ? 'Low' : st.peakMidi < st.startMidi ? 'Turnaround' : 'Peak';
      if (k === 'autoStep') {
        const playBtn = h.querySelector('[data-pn="seq-play"]');
        let nxt = h.querySelector('[data-pn="seq-next"]');
        if (!st.autoStep && !nxt && playBtn) {
          nxt = document.createElement('button');
          nxt.dataset.pn = 'seq-next';
          nxt.innerHTML = `Next key ${IC('ico:chevright')}`;
          playBtn.insertAdjacentElement('afterend', nxt);
        } else if (st.autoStep && nxt) {
          nxt.remove();
        }
      } else if (k === 'showCounts' || k === 'clef') {
        pianoDrawWarmupStaff(h, st, PIANO_SEQ.roots[PIANO_SEQ.stepIdx] ?? st.startMidi);
      } else {
        const curRoot = PIANO_SEQ.roots[PIANO_SEQ.stepIdx];
        const nextRoots = pianoBuildRoots(st);
        const found = nextRoots.indexOf(curRoot);
        PIANO_SEQ.roots = nextRoots;
        if (found >= 0) PIANO_SEQ.stepIdx = found;
        const cEl = h.querySelector('.pq-cnt');
        if (cEl) cEl.textContent = `Key ${PIANO_SEQ.stepIdx + 1} of ${PIANO_SEQ.roots.length} · applies next key`;
      }
    }
  };
  initToolsKeyboard();
}

// ============================================================ 2. REHEARSAL AUDIO TRACK PLAYER
const AUD_PEAKS_CACHE = {};

function audFmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function mountAudioPlayer(host, fileId) {
  if (!host || host.__audId === fileId) return;
  host.__audCleanup?.();
  host.__audId = fileId;
  const meta = S.files[fileId];
  const src = fileDirectURL(fileId);
  if (!meta || !src) { host.innerHTML = '<div class="res-fallback">This audio file is missing.</div>'; return; }

  const marks = () => (meta.marks ||= []);
  const saved = (meta.aud ||= {});
  const st = {
    speed: Number(saved.speed) || 1,
    loop: !!saved.loop,
    loopA: saved.loopA != null ? Number(saved.loopA) : null,
    loopB: saved.loopB != null ? Number(saved.loopB) : null,
    countIn: !!saved.countIn,
    bpm: Number(saved.bpm) || 100,
    peaks: AUD_PEAKS_CACHE[fileId] || null, dur: 0, counting: false, raf: 0, countTimers: [],
  };
  const saveAud = () => {
    Object.assign(saved, { speed: st.speed, loop: st.loop, loopA: st.loopA, loopB: st.loopB, countIn: st.countIn, bpm: st.bpm });
    save();
  };
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.playbackRate = st.speed;
  audio.preservesPitch = true;
  if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;

  const stopCount = () => { st.countTimers.forEach(clearTimeout); st.countTimers = []; st.counting = false; };
  const cleanup = () => {
    stopCount(); cancelAnimationFrame(st.raf);
    try { audio.pause(); audio.src = ''; } catch { }
  };
  host.__audCleanup = cleanup;

  const title = (meta.name || 'Audio track').replace(/\.[^.]+$/, '');
  host.innerHTML = `<div class="aud" tabindex="0">
    <div class="aud-head">
      <div class="aud-title">${IC('ico:audio')} <b>${esc(title)}</b></div>
      <span class="aud-time">0:00 / —</span>
    </div>
    <div class="aud-wavewrap">
      <canvas class="aud-wave" title="Click to seek · drag across to set an A–B loop"></canvas>
      <div class="aud-wstatus" hidden></div>
    </div>
    <div class="aud-ctl">
      <button data-aud="play" class="aud-primary" title="Play / Pause (Space)">${IC('ico:play')} Play</button>
      <button data-aud="back" title="Back 5 seconds (←)">−5s</button>
      <button data-aud="fwd" title="Forward 5 seconds (→)">+5s</button>
      <button data-aud="loop" title="Toggle A–B loop (L)">${IC('ico:repeat')} Loop</button>
      <button data-aud="seta" title="Set loop start A to current position">Set A</button>
      <button data-aud="setb" title="Set loop end B to current position">Set B</button>
      <button data-aud="clrloop" hidden title="Clear A–B loop">Clear loop</button>
      <span class="aud-sp"></span>
      <span class="aud-speeds" title="Playback speed (keeps pitch)">${[0.5, 0.75, 0.85, 1, 1.1, 1.25].map(v => `<button data-aud="spd" data-v="${v}" class="${v === st.speed ? 'on' : ''}">${v}×</button>`).join('')}</span>
    </div>
    <div class="aud-ctl aud-sub">
      <label class="aud-chk"><input type="checkbox" data-aud-k="countIn" ${st.countIn ? 'checked' : ''}> Count-in (4 beats)</label>
      <label class="aud-bpm">at <input type="number" min="40" max="220" step="2" data-aud-k="bpm" value="${st.bpm}"> BPM</label>
      <span class="aud-sp"></span>
      <span class="aud-hint">Drag waveform or use Set A / B · Space = play · M = marker · [ ] = jump</span>
    </div>
    <div class="aud-marks-bar">
      <span class="aud-mlbl">${IC('ico:flag')} Markers</span>
      <button data-aud="mprev" title="Previous marker ([)">${IC('ico:chevleft')}</button>
      <button data-aud="mnext" title="Next marker (])">${IC('ico:chevright')}</button>
      <button data-aud="madd" class="ic-btn" title="Drop a rehearsal marker here instantly (M)">${IC('ico:plus')} Marker</button>
      <div class="aud-mlist"></div>
    </div>
  </div>`;

  const rootEl = host.querySelector('.aud');
  const cvs = host.querySelector('.aud-wave');
  const timeEl = host.querySelector('.aud-time');
  const statEl = host.querySelector('.aud-wstatus');
  const playBtn = host.querySelector('[data-aud="play"]');
  const loopBtn = host.querySelector('[data-aud="loop"]');
  const clrLoopBtn = host.querySelector('[data-aud="clrloop"]');
  const mlistEl = host.querySelector('.aud-mlist');

  const drawWaveCanvas = () => {
    if (!cvs || !host.isConnected) return;
    const r = cvs.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cvs.width !== W || cvs.height !== H) { cvs.width = W; cvs.height = H; }
    const g = cvs.getContext('2d');
    g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(host);
    const txt = cs.getPropertyValue('--text').trim() || '#fff';
    const acc = cs.getPropertyValue('--accent').trim() || '#ffd166';
    const dur = st.dur || audio.duration || 0;
    const cur = audio.currentTime || 0;
    const frac = dur > 0 ? clamp(cur / dur, 0, 1) : 0;

    // A-B loop shading
    if (dur > 0 && st.loopA != null && st.loopB != null) {
      const x1 = (st.loopA / dur) * W, x2 = (st.loopB / dur) * W;
      g.save(); g.globalAlpha = st.loop ? 0.24 : 0.12; g.fillStyle = acc;
      g.fillRect(x1, 0, Math.max(2, x2 - x1), H);
      g.globalAlpha = 0.85; g.fillRect(x1, 0, 2 * dpr, H); g.fillRect(x2 - 2 * dpr, 0, 2 * dpr, H);
      g.restore();
    }

    // Waveform bars
    const peaks = st.peaks;
    if (peaks && peaks.length) {
      const n = peaks.length, step = W / n, bw = Math.max(1.5 * dpr, step * 0.68);
      for (let i = 0; i < n; i++) {
        const x = i * step, h = Math.max(3 * dpr, peaks[i] * (H * 0.82));
        const played = (i + 0.5) / n <= frac;
        g.save();
        g.fillStyle = played ? acc : txt;
        g.globalAlpha = played ? 0.92 : 0.34;
        g.fillRect(x, (H - h) / 2, bw, h);
        g.restore();
      }
    } else {
      // clean progress rail while peaks decode
      g.save(); g.fillStyle = txt; g.globalAlpha = 0.2; g.fillRect(0, H / 2 - 2 * dpr, W, 4 * dpr);
      g.fillStyle = acc; g.globalAlpha = 0.9; g.fillRect(0, H / 2 - 2 * dpr, W * frac, 4 * dpr); g.restore();
    }

    // Rehearsal markers
    if (dur > 0) {
      for (const mk of marks()) {
        const mx = clamp(mk.t / dur, 0, 1) * W;
        g.save(); g.strokeStyle = '#ff6b6b'; g.lineWidth = 2 * dpr;
        g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, H); g.stroke();
        g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(mx, 6 * dpr, 4 * dpr, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }

    // Playhead
    if (dur > 0) {
      const px = frac * W;
      g.save(); g.fillStyle = txt; g.fillRect(px - 1.5 * dpr, 0, 3 * dpr, H); g.restore();
    }
  };

  const renderMarks = () => {
    const list = marks().sort((a, b) => a.t - b.t);
    mlistEl.innerHTML = list.length
      ? list.map(m => `<span class="aud-mk" data-mid="${m.id}"><button data-aud="mgo" data-mid="${m.id}" title="Jump to ${audFmt(m.t)} · double-click to rename"><b>${audFmt(m.t)}</b> <span class="aud-mname">${esc(m.label)}</span></button><button class="x" data-aud="mren" data-mid="${m.id}" title="Rename marker" aria-label="Rename marker">${IC('ico:edit')}</button><button class="x" data-aud="mdel" data-mid="${m.id}" title="Remove marker" aria-label="Remove marker">${IC('ico:close')}</button></span>`).join('')
      : '<span class="aud-mnone">No markers yet — press + Marker (or M) to tag rehearsal spots without stopping.</span>';
  };

  const syncUI = () => {
    if (!host.isConnected) { cleanup(); return; }
    const dur = st.dur || (isFinite(audio.duration) ? audio.duration : 0);
    if (dur && !st.dur) st.dur = dur;
    timeEl.textContent = `${audFmt(audio.currentTime)} / ${dur ? audFmt(dur) : '—'}`;
    playBtn.innerHTML = (!audio.paused || st.counting) ? `${IC('ico:pause')} Pause` : `${IC('ico:play')} Play`;
    loopBtn.classList.toggle('on', st.loop);
    const hasLoop = st.loopA != null && st.loopB != null;
    clrLoopBtn.hidden = !hasLoop;
    loopBtn.innerHTML = `${IC('ico:repeat')} ${hasLoop ? `Loop ${audFmt(st.loopA)}–${audFmt(st.loopB)}` : 'Loop'}`;
    drawWaveCanvas();
  };

  const startWithOptionalCountIn = fromTime => {
    stopCount();
    if (fromTime != null) audio.currentTime = fromTime;
    if (!st.countIn) {
      statEl.hidden = true;
      audio.playbackRate = st.speed;
      audio.play().catch(() => { });
      syncUI();
      return;
    }
    st.counting = true;
    const c = ac(); c.resume?.();
    const beatSec = 60 / clamp(Number(st.bpm) || 100, 40, 220);
    const beatMs = beatSec * 1000;
    const t0 = c.currentTime + 0.04;
    statEl.hidden = false;
    for (let i = 0; i < 4; i++) {
      if (typeof metClick === 'function') metClick(t0 + i * beatSec, i === 0 ? 'down' : 'beat');
      st.countTimers.push(setTimeout(() => {
        if (!st.counting || !host.isConnected) return;
        statEl.textContent = String(i + 1);
      }, Math.max(0, Math.round(i * beatMs + 35))));
    }
    st.countTimers.push(setTimeout(() => {
      if (!st.counting || !host.isConnected) return;
      st.counting = false; statEl.hidden = true;
      audio.playbackRate = st.speed;
      audio.play().catch(() => { });
      syncUI();
    }, Math.round(4 * beatMs + 35)));
    syncUI();
  };

  const togglePlay = () => {
    if (st.counting) { stopCount(); statEl.hidden = true; syncUI(); return; }
    if (!audio.paused) { audio.pause(); syncUI(); return; }
    const startAt = st.loop && st.loopA != null && (audio.currentTime < st.loopA || (st.loopB != null && audio.currentTime >= st.loopB - 0.05)) ? st.loopA : null;
    startWithOptionalCountIn(startAt);
  };
  window.__audActive = host;
  host.__audTogglePlay = togglePlay;
  rootEl.addEventListener('pointerdown', () => { window.__spaceTarget = 'aud'; window.__audActive = host; });

  const addMarkerHere = () => {
    const t = +(audio.currentTime || 0).toFixed(2);
    const n = marks().length + 1;
    marks().push({ id: uid(), t, label: `Spot ${n}` });
    marks().sort((a, b) => a.t - b.t);
    save(); renderMarks(); drawWaveCanvas();
  };
  const startInlineRename = mid => {
    const m = marks().find(x => x.id === mid); if (!m) return;
    const chip = mlistEl.querySelector(`.aud-mk[data-mid="${mid}"] .aud-mname`); if (!chip) return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = m.label; inp.className = 'aud-mren-inp';
    inp.onclick = ev => ev.stopPropagation();
    let closed = false;
    const done = commit => {
      if (closed) return;
      closed = true;
      if (commit) { const v = inp.value.trim(); if (v) m.label = v; save(); }
      renderMarks();
    };
    inp.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
    };
    inp.onblur = () => done(true);
    chip.replaceWith(inp);
    inp.focus(); inp.select();
  };

  const jumpMarker = dir => {
    const list = marks().sort((a, b) => a.t - b.t); if (!list.length) return;
    const cur = audio.currentTime || 0;
    const target = dir < 0 ? [...list].reverse().find(m => m.t < cur - 0.6) || list[0]
      : list.find(m => m.t > cur + 0.3) || list[list.length - 1];
    if (target) { audio.currentTime = target.t; syncUI(); }
  };

  const tickLoop = () => {
    if (!host.isConnected) { cleanup(); return; }
    if (!audio.paused && st.loop && st.loopA != null && st.loopB != null && audio.currentTime >= st.loopB) {
      if (st.countIn) { audio.pause(); startWithOptionalCountIn(st.loopA); }
      else audio.currentTime = st.loopA;
    }
    syncUI();
    st.raf = requestAnimationFrame(tickLoop);
  };
  st.raf = requestAnimationFrame(tickLoop);

  audio.addEventListener('loadedmetadata', () => { st.dur = audio.duration || 0; syncUI(); });
  audio.addEventListener('error', () => {
    cleanup();
    host.innerHTML = `<div class="res-fallback">Could not play “${esc(title)}”. The file may be missing or unsupported in this browser.</div>`;
  });
  audio.addEventListener('ended', () => {
    if (st.loop) startWithOptionalCountIn(st.loopA ?? 0);
    else syncUI();
  });

  // Decode waveform peaks asynchronously (cached per fileId)
  if (!st.peaks && typeof decodePeaks === 'function') {
    fetch(src).then(r => r.blob()).then(b => decodePeaks(b, 180)).then(p => {
      if (!p) return;
      AUD_PEAKS_CACHE[fileId] = p; st.peaks = p; drawWaveCanvas();
    }).catch(() => { });
  }

  // Click to seek, drag to set A–B loop
  let wDrag = null;
  const xToTime = clientX => {
    const r = cvs.getBoundingClientRect(), dur = st.dur || audio.duration || 0;
    return dur ? clamp((clientX - r.left) / r.width, 0, 1) * dur : 0;
  };
  cvs.onpointerdown = e => {
    e.preventDefault(); e.stopPropagation();
    try { cvs.setPointerCapture(e.pointerId); } catch { }
    wDrag = { x0: e.clientX, t0: xToTime(e.clientX), dragged: false };
  };
  cvs.onpointermove = e => {
    if (!wDrag) return;
    if (!wDrag.dragged && Math.abs(e.clientX - wDrag.x0) > 8) wDrag.dragged = true;
    if (wDrag.dragged) {
      const t1 = xToTime(e.clientX);
      st.loopA = Math.min(wDrag.t0, t1); st.loopB = Math.max(wDrag.t0, t1); st.loop = true;
      syncUI();
    }
  };
  cvs.onpointerup = e => {
    if (!wDrag) return;
    const d = wDrag; wDrag = null;
    if (!d.dragged) { audio.currentTime = d.t0; syncUI(); }
    else if (st.loopB - st.loopA < 0.25) { st.loopA = st.loopB = null; st.loop = false; audio.currentTime = d.t0; saveAud(); syncUI(); }
    else { audio.currentTime = st.loopA; saveAud(); syncUI(); }
  };

  host.__audTogglePlay = togglePlay;
  rootEl.onpointerdown = () => { window.__spaceTarget = 'aud'; window.__audActive = host; };
  host.ondblclick = e => {
    const go = e.target.closest('[data-aud="mgo"]');
    if (go) { e.stopPropagation(); startInlineRename(go.dataset.mid); }
  };
  host.onclick = e => {
    window.__spaceTarget = 'aud'; window.__audActive = host;
    const b = e.target.closest('[data-aud]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.aud;
    if (act === 'play') togglePlay();
    else if (act === 'back') { audio.currentTime = Math.max(0, (audio.currentTime || 0) - 5); syncUI(); }
    else if (act === 'fwd') { audio.currentTime = Math.min(st.dur || audio.duration || 0, (audio.currentTime || 0) + 5); syncUI(); }
    else if (act === 'loop') {
      st.loop = !st.loop; saveAud(); syncUI();
      if (st.loop && st.loopA == null && typeof toast === 'function') toast('Looping full track — drag the waveform or click Set A / Set B to loop a section.');
    }
    else if (act === 'seta') {
      const t = +(audio.currentTime || 0).toFixed(2);
      st.loopA = t;
      if (st.loopB != null && st.loopB <= st.loopA) st.loopB = null;
      if (st.loopB != null) st.loop = true;
      saveAud(); syncUI();
    }
    else if (act === 'setb') {
      const t = +(audio.currentTime || 0).toFixed(2);
      if (st.loopA == null) st.loopA = 0;
      if (t <= st.loopA) { st.loopB = st.loopA; st.loopA = t; } else st.loopB = t;
      st.loop = true; saveAud(); syncUI();
    }
    else if (act === 'clrloop') { st.loopA = st.loopB = null; st.loop = false; saveAud(); syncUI(); }
    else if (act === 'spd') {
      st.speed = Number(b.dataset.v); audio.playbackRate = st.speed; saveAud();
      host.querySelectorAll('[data-aud="spd"]').forEach(x => x.classList.toggle('on', Number(x.dataset.v) === st.speed));
    } else if (act === 'madd') addMarkerHere();
    else if (act === 'mprev') jumpMarker(-1);
    else if (act === 'mnext') jumpMarker(1);
    else if (act === 'mgo') { const m = marks().find(x => x.id === b.dataset.mid); if (m) { audio.currentTime = m.t; syncUI(); } }
    else if (act === 'mren') { startInlineRename(b.dataset.mid); }
    else if (act === 'mdel') { meta.marks = marks().filter(x => x.id !== b.dataset.mid); save(); renderMarks(); drawWaveCanvas(); }
  };
  host.onchange = e => {
    const el = e.target, k = el.dataset.audK; if (!k) return;
    if (k === 'countIn') st.countIn = el.checked;
    if (k === 'bpm') st.bpm = clamp(Number(el.value) || 100, 40, 220);
    saveAud();
  };
  rootEl.onkeydown = e => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.max(0, (audio.currentTime || 0) - 5); syncUI(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.min(st.dur || 0, (audio.currentTime || 0) + 5); syncUI(); }
    else if (e.key.toLowerCase() === 'm') { e.preventDefault(); e.stopPropagation(); addMarkerHere(); }
    else if (e.key.toLowerCase() === 'l') { e.preventDefault(); e.stopPropagation(); st.loop = !st.loop; saveAud(); syncUI(); }
    else if (e.key === '[') { e.preventDefault(); e.stopPropagation(); jumpMarker(-1); }
    else if (e.key === ']') { e.preventDefault(); e.stopPropagation(); jumpMarker(1); }
  };

  renderMarks();
  syncUI();
  initToolsKeyboard();
}

// ============================================================ 3. INTERACTIVE SOLFEGE LADDER, CURWEN HAND SIGNS & ECHO BOARD
const CURWEN_HAND_KEYS = new Set([
  'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
  'di', 'ri', 'fi', 'si', 'li',
  'ra', 'me', 'se', 'le', 'te',
]);

function curwenHandHTML(handKey, label) {
  const k = CURWEN_HAND_KEYS.has(handKey) ? handKey : 'do';
  return `<span class="sb-hand-wrap"><img class="sb-hand-img" src="vendor/hands/${k}.png" alt="${esc(label)} hand sign" draggable="false"></span>`;
}

const SB_COLORS = {
  do:  ['#d9383a', '#fff'],
  re:  ['#e87a24', '#fff'],
  mi:  ['#c8960c', '#fff'],
  fa:  ['#2ea04e', '#fff'],
  sol: ['#1f85a8', '#fff'],
  la:  ['#7b4bc4', '#fff'],
  ti:  ['#d64891', '#fff'],
};

const SOLBOARD_DEFAULTS = () => ({
  keyPc: 0, mode: 'major', range: 'lowsol', sound: 'piano',
  hands: true, notes: false, colors: true, layout: 'ladder', mysteryLen: 4,
});
function solBoardState(h = null) {
  let st = null;
  const rid = h?.dataset?.wgRes, wid = h?.dataset?.wgWin;
  if (rid && typeof findRes === 'function') {
    const r = findRes(rid);
    if (r?.widget) {
      if (!r.widget.state) r.widget.state = Object.assign(SOLBOARD_DEFAULTS(), JSON.parse(JSON.stringify(S.settings.solboard || {})));
      st = r.widget.state;
    }
  } else if (wid && typeof findWin === 'function') {
    const w = findWin(wid);
    if (w) {
      if (!w.wgState) w.wgState = Object.assign(SOLBOARD_DEFAULTS(), JSON.parse(JSON.stringify(S.settings.solboard || {})));
      st = w.wgState;
    }
  }
  return st || (S.settings.solboard ||= SOLBOARD_DEFAULTS());
}

function solBoardSteps(st) {
  const root = 60 + (st.keyPc || 0); // C4..B4
  const defs = {
    major: [
      { syl: 'sol,', base: 'sol', hand: 'sol', semi: -5 },
      { syl: 'la,',  base: 'la',  hand: 'la',  semi: -3 },
      { syl: 'ti,',  base: 'ti',  hand: 'ti',  semi: -1 },
      { syl: 'do',   base: 'do',  hand: 'do',  semi: 0  },
      { syl: 're',   base: 're',  hand: 're',  semi: 2  },
      { syl: 'mi',   base: 'mi',  hand: 'mi',  semi: 4  },
      { syl: 'fa',   base: 'fa',  hand: 'fa',  semi: 5  },
      { syl: 'sol',  base: 'sol', hand: 'sol', semi: 7  },
      { syl: 'la',   base: 'la',  hand: 'la',  semi: 9  },
      { syl: 'ti',   base: 'ti',  hand: 'ti',  semi: 11 },
      { syl: "do'",  base: 'do',  hand: 'do',  semi: 12 },
    ],
    minor: [
      { syl: 'sol,', base: 'sol', hand: 'sol', semi: -5 },
      { syl: 'le,',  base: 'la',  hand: 'le',  semi: -4 },
      { syl: 'te,',  base: 'ti',  hand: 'te',  semi: -2 },
      { syl: 'do',   base: 'do',  hand: 'do',  semi: 0  },
      { syl: 're',   base: 're',  hand: 're',  semi: 2  },
      { syl: 'me',   base: 'mi',  hand: 'me',  semi: 3  },
      { syl: 'fa',   base: 'fa',  hand: 'fa',  semi: 5  },
      { syl: 'sol',  base: 'sol', hand: 'sol', semi: 7  },
      { syl: 'le',   base: 'la',  hand: 'le',  semi: 8  },
      { syl: 'te',   base: 'ti',  hand: 'te',  semi: 10 },
      { syl: "do'",  base: 'do',  hand: 'do',  semi: 12 },
    ],
    penta: [
      { syl: 'sol,', base: 'sol', hand: 'sol', semi: -5 },
      { syl: 'la,',  base: 'la',  hand: 'la',  semi: -3 },
      { syl: 'do',   base: 'do',  hand: 'do',  semi: 0  },
      { syl: 're',   base: 're',  hand: 're',  semi: 2  },
      { syl: 'mi',   base: 'mi',  hand: 'mi',  semi: 4  },
      { syl: 'sol',  base: 'sol', hand: 'sol', semi: 7  },
      { syl: 'la',   base: 'la',  hand: 'la',  semi: 9  },
      { syl: "do'",  base: 'do',  hand: 'do',  semi: 12 },
    ],
    chromatic: [
      { syl: 'do',   base: 'do',  hand: 'do',  semi: 0,  kbd: 'A' },
      { syl: 'di',   base: 'do',  hand: 'di',  semi: 1,  kbd: 'W', alt: true },
      { syl: 're',   base: 're',  hand: 're',  semi: 2,  kbd: 'S' },
      { syl: 'ri',   base: 're',  hand: 'ri',  semi: 3,  kbd: 'E', alt: true },
      { syl: 'mi',   base: 'mi',  hand: 'mi',  semi: 4,  kbd: 'D' },
      { syl: 'fa',   base: 'fa',  hand: 'fa',  semi: 5,  kbd: 'F' },
      { syl: 'fi',   base: 'fa',  hand: 'fi',  semi: 6,  kbd: 'T', alt: true },
      { syl: 'sol',  base: 'sol', hand: 'sol', semi: 7,  kbd: 'G' },
      { syl: 'si',   base: 'sol', hand: 'si',  semi: 8,  kbd: 'Y', alt: true },
      { syl: 'la',   base: 'la',  hand: 'la',  semi: 9,  kbd: 'H' },
      { syl: 'li',   base: 'la',  hand: 'li',  semi: 10, kbd: 'U', alt: true },
      { syl: 'ti',   base: 'ti',  hand: 'ti',  semi: 11, kbd: 'J' },
      { syl: "do'",  base: 'do',  hand: 'do',  semi: 12, kbd: 'K' },
    ],
    chromatic_flat: [
      { syl: 'do',   base: 'do',  hand: 'do',  semi: 0,  kbd: 'A' },
      { syl: 'ra',   base: 're',  hand: 'ra',  semi: 1,  kbd: 'W', alt: true },
      { syl: 're',   base: 're',  hand: 're',  semi: 2,  kbd: 'S' },
      { syl: 'me',   base: 'mi',  hand: 'me',  semi: 3,  kbd: 'E', alt: true },
      { syl: 'mi',   base: 'mi',  hand: 'mi',  semi: 4,  kbd: 'D' },
      { syl: 'fa',   base: 'fa',  hand: 'fa',  semi: 5,  kbd: 'F' },
      { syl: 'se',   base: 'sol', hand: 'se',  semi: 6,  kbd: 'T', alt: true },
      { syl: 'sol',  base: 'sol', hand: 'sol', semi: 7,  kbd: 'G' },
      { syl: 'le',   base: 'la',  hand: 'le',  semi: 8,  kbd: 'Y', alt: true },
      { syl: 'la',   base: 'la',  hand: 'la',  semi: 9,  kbd: 'H' },
      { syl: 'te',   base: 'ti',  hand: 'te',  semi: 10, kbd: 'U', alt: true },
      { syl: 'ti',   base: 'ti',  hand: 'ti',  semi: 11, kbd: 'J' },
      { syl: "do'",  base: 'do',  hand: 'do',  semi: 12, kbd: 'K' },
    ],
  };
  const isChrom = st.mode === 'chromatic' || st.mode === 'chromatic_flat';
  let list = defs[st.mode] || defs.major;
  if (st.range === 'dodo' && !isChrom) list = list.filter(x => x.semi >= 0);
  const numKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
  return list.map((x, idx) => ({ ...x, kbd: isChrom ? x.kbd : (numKeys[idx] || ''), midi: root + x.semi }));
}

function renderSolBoard(h) {
  const st = solBoardState(h);
  const steps = solBoardSteps(st);
  const isChrom = st.mode === 'chromatic' || st.mode === 'chromatic_flat';
  const hasLow = steps.some(s => s.semi < 0);
  toolEnsurePiano(steps.map(s => s.midi));
  const trail = (h.__trail ||= []);
  const mys = h.__mystery || null;
  const spdMs = { slow: 760, med: 540, fast: 360 }[st.echoSpeed || 'med'] || 540;
  const playSeq = (seq, revealOnPlay = true) => {
    (h.__timers ||= []).forEach(clearTimeout); h.__timers = [];
    seq.forEach((item, idx) => {
      const tid = setTimeout(() => {
        if (!h.isConnected) return;
        toolPlayNote(item.midi, Math.max(0.32, spdMs * 0.001), 0.85, st.sound || 'piano');
        if (revealOnPlay) {
          const btn = h.querySelector(`.sb-tile[data-semi="${item.semi}"]`);
          if (btn) { btn.classList.add('lit'); setTimeout(() => btn.classList.remove('lit'), Math.min(380, spdMs * 0.72)); }
        }
        const chip = h.querySelector(`.sb-echo-item[data-ei="${idx}"]`);
        if (chip) { chip.classList.add('lit'); setTimeout(() => chip.classList.remove('lit'), Math.min(380, spdMs * 0.72)); }
      }, idx * spdMs);
      h.__timers.push(tid);
    });
  };

  const displaySteps = st.layout === 'ladder' ? [...steps].reverse() : steps;
  const tileStyle = s => {
    if (!st.colors) return '';
    const [bg, fg] = SB_COLORS[s.base] || ['#4a5568', '#fff'];
    return `style="--sb-bg:${bg};--sb-fg:${fg}"`;
  };
  const keyHint = isChrom ? 'A–K (piano layout)' : `1–${steps[steps.length - 1]?.kbd || '8'}`;

  h.innerHTML = `<div class="sb ${st.layout === 'grid' ? 'is-grid' : 'is-ladder'} ${st.colors ? 'is-col' : ''} ${displaySteps.length >= 10 ? 'is-dense' : ''}" tabindex="0">
    <div class="sb-bar">
      <div class="sb-bar-row">
        <label>Key <select data-sb-k="keyPc">${TOOL_KEY_LABELS.map((n, i) => `<option value="${i}" ${st.keyPc === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Scale <select data-sb-k="mode">${[['major', 'Major'], ['minor', 'Minor (do)'], ['penta', 'Pentatonic'], ['chromatic', 'Chromatic (♯)'], ['chromatic_flat', 'Chromatic (♭)']].map(([v, l]) => `<option value="${v}" ${st.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${!isChrom ? `<label>Range <select data-sb-k="range">${[['lowsol', 'sol, – do\''], ['dodo', 'do – do\'']].map(([v, l]) => `<option value="${v}" ${st.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <label>Sound <select data-sb-k="sound">${[['piano', 'Piano'], ['sine', 'Pure sine'], ['organ', 'Organ']].map(([v, l]) => `<option value="${v}" ${st.sound === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="sb-bar-row">
        <button data-sb="hands" class="${st.hands ? 'on' : ''}" title="Show Curwen hand signs">Hands</button>
        <button data-sb="notes" class="${st.notes ? 'on' : ''}" title="Show pitch letter names">Letters</button>
        <button data-sb="colors" class="${st.colors ? 'on' : ''}" title="Boomwhacker / Kodály pitch colors">Colors</button>
        <button data-sb="layout" title="Switch vertical ladder / horizontal grid">${st.layout === 'ladder' ? IC('ico:movehoriz') + ' Grid' : IC('ico:movevert') + ' Ladder'}</button>
      </div>
    </div>

    <div class="sb-echo">
      <div class="sb-echo-bar">
        ${mys ? `
          <span class="sb-elbl">Mystery echo</span>
          <span class="grow"></span>
          <div class="sb-echo-acts">
            <button data-sb="mys-replay">${IC('ico:play')} Replay</button>
            <button data-sb="echo-spd" title="Replay speed">Speed: ${({ slow: 'Slow', med: 'Med', fast: 'Fast' })[st.echoSpeed || 'med']}</button>
            <button data-sb="mys-reveal" class="sb-primary">${mys.revealed ? 'Hide' : 'Reveal'}</button>
            <label class="sb-mlen"><select data-sb-k="mysteryLen" title="Notes in Mystery Echo">${[3, 4, 5].map(n => `<option value="${n}" ${st.mysteryLen === n ? 'selected' : ''}>${n} notes</option>`).join('')}</select></label>
            <button data-sb="mys-new">New</button>
            <button data-sb="mys-close" title="Back to echo trail">${IC('ico:close')}</button>
          </div>
        ` : `
          <span class="sb-elbl">Echo trail <small class="sb-ecnt">${trail.length}/12</small></span>
          <span class="grow"></span>
          <div class="sb-echo-acts">
            <button data-sb="trail-play" ${trail.length ? '' : 'disabled'}>${IC('ico:play')} Replay</button>
            <button data-sb="echo-spd" title="Replay speed">Speed: ${({ slow: 'Slow', med: 'Med', fast: 'Fast' })[st.echoSpeed || 'med']}</button>
            <button data-sb="trail-undo" title="Remove last note" ${trail.length ? '' : 'disabled'}>⌫ Undo</button>
            <button data-sb="trail-clear" ${trail.length ? '' : 'disabled'}>Clear</button>
            <span class="sb-esep" aria-hidden="true"></span>
            <label class="sb-mlen"><select data-sb-k="mysteryLen" title="Notes in Mystery Echo">${[3, 4, 5].map(n => `<option value="${n}" ${st.mysteryLen === n ? 'selected' : ''}>${n} notes</option>`).join('')}</select></label>
            <button data-sb="mys-new">${IC('ico:sparkle')} Mystery echo</button>
          </div>
        `}
      </div>
      <div class="sb-elist">
        ${mys
          ? mys.notes.map((n, i) => `<span class="sb-echo-item ${mys.revealed ? 'rev' : 'hid'}" data-ei="${i}" ${mys.revealed ? tileStyle(n) : ''}>${mys.revealed ? esc(n.syl) : '?'}</span>`).join('')
          : (trail.length
              ? trail.map((n, i) => `<button type="button" class="sb-echo-item rev" data-sb="trail-rm" data-ei="${i}" title="Click to remove" ${tileStyle(n)}>${esc(n.syl)}</button>`).join('')
              : `<span class="sb-ehint">Tap tiles below (or press ${keyHint}) to build an echo phrase.</span>`)}
      </div>
    </div>

    <div class="sb-tiles">
      ${displaySteps.map(s => `<button type="button" class="sb-tile ${s.alt ? 'is-alt' : ''} ${s.semi < 0 ? 'is-low' : ''}" data-semi="${s.semi}" ${tileStyle(s)}>
        ${st.hands ? curwenHandHTML(s.hand || s.base, s.syl) : ''}
        <b class="sb-syl">${s.syl}</b>
        ${st.notes ? `<span class="sb-note">${toolMidiName(s.midi, st.mode === 'chromatic_flat' || st.mode === 'minor' ? 'flat' : st.mode === 'chromatic' ? 'sharp' : st.keyPc)}</span>` : ''}
        ${s.kbd ? `<kbd class="sb-kbd">${s.kbd}</kbd>` : ''}
      </button>`).join('')}
    </div>
  </div>`;

  const triggerStep = s => {
    if (!s) return;
    toolPlayNote(s.midi, 0.72, 0.85, st.sound || 'piano');
    const btn = h.querySelector(`.sb-tile[data-semi="${s.semi}"]`);
    if (btn) { btn.classList.add('lit'); setTimeout(() => btn.classList.remove('lit'), 320); }
    if (!h.__mystery) {
      trail.push(s); if (trail.length > 12) trail.shift();
      const list = h.querySelector('.sb-elist');
      if (list) list.innerHTML = trail.map((n, i) => `<button type="button" class="sb-echo-item rev" data-sb="trail-rm" data-ei="${i}" title="Click to remove" ${tileStyle(n)}>${esc(n.syl)}</button>`).join('');
      const cnt = h.querySelector('.sb-ecnt'); if (cnt) cnt.textContent = `${trail.length}/12`;
      h.querySelectorAll('[data-sb="trail-play"], [data-sb="trail-undo"], [data-sb="trail-clear"]').forEach(b => { b.disabled = !trail.length; });
    }
  };

  h.__sbHandleKey = key => {
    const up = key.toUpperCase();
    const match = steps.find(s => s.kbd && s.kbd.toUpperCase() === up);
    if (match) { triggerStep(match); return true; }
    if (up === 'R') {
      if (h.__mystery) { playSeq(h.__mystery.notes, h.__mystery.revealed); return true; }
      if (trail.length) { playSeq(trail, true); return true; }
    }
    return false;
  };

  const makeMystery = () => {
    const pool = steps.filter(s => !s.alt && (st.range === 'lowsol' ? true : s.semi >= 0));
    const start = pool.find(s => s.semi === 0) || pool[0];
    const notes = [start];
    let curIdx = pool.indexOf(start);
    for (let i = 1; i < (st.mysteryLen || 4); i++) {
      // musical stepwise or small-skip motion
      const cands = pool.map((p, idx) => ({ p, idx })).filter(x => Math.abs(x.idx - curIdx) <= 2 && x.idx !== curIdx);
      const pick = cands[Math.floor(Math.random() * cands.length)] || { p: start, idx: 0 };
      notes.push(pick.p); curIdx = pick.idx;
    }
    h.__mystery = { notes, revealed: false };
    renderSolBoard(h);
    playSeq(notes, false);
  };

  h.onclick = e => {
    const tile = e.target.closest('.sb-tile');
    if (tile) { e.stopPropagation(); triggerStep(steps.find(x => String(x.semi) === tile.dataset.semi)); return; }
    const b = e.target.closest('[data-sb]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.sb;
    if (act === 'hands') { st.hands = !st.hands; save(); renderSolBoard(h); }
    else if (act === 'notes') { st.notes = !st.notes; save(); renderSolBoard(h); }
    else if (act === 'colors') { st.colors = !st.colors; save(); renderSolBoard(h); }
    else if (act === 'layout') { st.layout = st.layout === 'ladder' ? 'grid' : 'ladder'; save(); renderSolBoard(h); }
    else if (act === 'echo-spd') { const o = ['slow', 'med', 'fast']; st.echoSpeed = o[(o.indexOf(st.echoSpeed || 'med') + 1) % o.length]; save(); renderSolBoard(h); }
    else if (act === 'trail-play') { playSeq(trail, true); }
    else if (act === 'trail-undo') { trail.pop(); renderSolBoard(h); }
    else if (act === 'trail-rm') { trail.splice(Number(b.dataset.ei), 1); renderSolBoard(h); }
    else if (act === 'trail-clear') { h.__trail = []; renderSolBoard(h); }
    else if (act === 'mys-new') { makeMystery(); }
    else if (act === 'mys-replay' && h.__mystery) { playSeq(h.__mystery.notes, h.__mystery.revealed); }
    else if (act === 'mys-reveal' && h.__mystery) { h.__mystery.revealed = !h.__mystery.revealed; renderSolBoard(h); }
    else if (act === 'mys-close') { h.__mystery = null; renderSolBoard(h); }
  };
  h.onchange = e => {
    const el = e.target, k = el.dataset.sbK; if (!k) return;
    st[k] = ['keyPc', 'mysteryLen'].includes(k) ? Number(el.value) : el.value;
    if (k === 'mode' || k === 'range') {
      h.__trail = []; h.__mystery = null;
    } else if (k === 'keyPc') {
      const nextSteps = solBoardSteps(st);
      const remap = arr => arr.map(n => nextSteps.find(x => x.semi === n.semi) || n);
      if (h.__trail?.length) h.__trail = remap(h.__trail);
      if (h.__mystery?.notes?.length) h.__mystery.notes = remap(h.__mystery.notes);
    } else if (k === 'mysteryLen' && h.__mystery) {
      save(); makeMystery(); return;
    }
    save(); renderSolBoard(h);
  };
  initToolsKeyboard();
}

// Global document keyboard handler for Classroom Piano & Solfege Board so teachers can play
// immediately without clicking to focus inside the widget first. Picks the frontmost visible tool.
let TOOLS_KBD_INIT = false;
function initToolsKeyboard() {
  if (TOOLS_KBD_INIT) return;
  TOOLS_KBD_INIT = true;
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (document.querySelector('#sr-ws-modal, .modal:not([hidden]), .av-cal')) return;
    if (e.code === 'Space' && window.__spaceTarget === 'aud' && window.__audActive?.isConnected && window.__audActive.__audTogglePlay) {
      e.preventDefault(); window.__audActive.__audTogglePlay(); return;
    }
    // Find all visible Piano & Solfege Board hosts, prioritizing focused or highest-z floating window
    const cands = [...document.querySelectorAll('.wg-host')].filter(h => {
      if (!h.isConnected) return false;
      const r = h.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return false;
      return !!(h.querySelector('.pn') || h.querySelector('.sb'));
    });
    if (!cands.length) return;
    const scoreHost = h => {
      let s = 0;
      if (document.activeElement && h.contains(document.activeElement)) s += 10000;
      const win = h.closest('.win');
      if (win) s += 1000 + (parseInt(getComputedStyle(win).zIndex, 10) || 0);
      return s;
    };
    cands.sort((a, b) => scoreHost(b) - scoreHost(a));
    const top = cands[0];
    // Do not hijack keys if another non-Piano/Solfege floating window is sitting above this one
    const topWin = top.closest('.win');
    const topZ = topWin ? (parseInt(getComputedStyle(topWin).zIndex, 10) || 0) : -1;
    const otherHigher = [...document.querySelectorAll('.win')].some(w => {
      if (w === topWin || !w.offsetWidth) return false;
      return (parseInt(getComputedStyle(w).zIndex, 10) || 0) > topZ;
    });
    if (otherHigher && !(document.activeElement && top.contains(document.activeElement))) return;
    const k = e.key.toLowerCase();

    if (top.querySelector('.pn')) {
      const st = pianoState(top);
      if (e.code === 'Space' && (window.__spaceTarget === 'piano' || (PIANO_SEQ.playing && PIANO_SEQ.host === top))) {
        e.preventDefault();
        if (PIANO_SEQ.playing && PIANO_SEQ.host === top) {
          pianoSeqStop(true);
        } else {
          if (!st.seqOpen) { st.seqOpen = true; save(); }
          pianoSeqStop(false);
          PIANO_SEQ.playing = true; PIANO_SEQ.host = top; PIANO_SEQ.roots = pianoBuildRoots(st);
          renderPiano(top);
          pianoPlayStep(top, st, 0);
        }
        return;
      }
      if (st.kbdOn === false) return;
      if (k in PIANO_KBD_MAP && top.__pianoBaseMidi != null && top.__pianoHitKey) {
        e.preventDefault();
        const midi = top.__pianoBaseMidi + 12 + PIANO_KBD_MAP[k];
        const btn = top.querySelector(`.pk-key[data-midi="${midi}"]`);
        if (btn) top.__pianoHitKey(btn);
        else toolPlayNote(midi, st.sustain ? 2.4 : 0.9, 0.85, 'piano');
        return;
      }
      if (k === 'z' || k === 'x') {
        e.preventDefault();
        const nextOct = clamp(st.baseOct + (k === 'x' ? 1 : -1), 2, 5);
        if (nextOct !== st.baseOct) { st.baseOct = nextOct; save(); renderPiano(top); }
        return;
      }
    } else if (top.querySelector('.sb') && top.__sbHandleKey) {
      if (top.__sbHandleKey(e.key)) { e.preventDefault(); return; }
    }
  });
}
window.pianoSeqStop = pianoSeqStop;
