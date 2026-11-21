'use strict';
/* Rehearsal classroom music tools:
   1. Classroom Piano & Vocal Warm-Up Sequencer (renderPiano)
   2. Rehearsal Backing-Track & Reference Audio Player (mountAudioPlayer)
   3. Interactive Solfege Ladder, Curwen Hand Signs & Echo Board (renderSolBoard) */

const TOOL_PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const TOOL_SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const TOOL_SOL_CHROM = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
const TOOL_MAJOR_SEMI = [0, 2, 4, 5, 7, 9, 11];
const TOOL_MINOR_SEMI = [0, 2, 3, 5, 7, 8, 10];
const TOOL_PENTA_SEMI = [0, 2, 4, 7, 9];

function toolMidiName(m, sharp = false) {
  const pc = ((m % 12) + 12) % 12, oct = Math.floor(m / 12) - 1;
  return (sharp ? TOOL_SHARP_NAMES[pc] : TOOL_PC_NAMES[pc]) + oct;
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
  scale5:  { name: '5-Note Scale',     steps: [[0,1],[2,1],[4,1],[5,1],[7,1],[5,1],[4,1],[2,1],[0,2]], syl: ['do','re','mi','fa','sol','fa','mi','re','do'] },
  triad:   { name: 'Major Triad',      steps: [[0,1],[4,1],[7,1],[4,1],[0,2]],                         syl: ['do','mi','sol','mi','do'] },
  octarp:  { name: 'Octave Arpeggio',  steps: [[0,1],[4,1],[7,1],[12,1.5],[7,1],[4,1],[0,2]],          syl: ['do','mi','sol','do\'','sol','mi','do'] },
  scale9:  { name: '9-Note Scale',     steps: [[0,.5],[2,.5],[4,.5],[5,.5],[7,.5],[9,.5],[11,.5],[12,.5],[14,.5],[12,.5],[11,.5],[9,.5],[7,.5],[5,.5],[4,.5],[2,.5],[0,2]], syl: ['do','re','mi','fa','sol','la','ti','do\'','re\'','do\'','ti','la','sol','fa','mi','re','do'] },
  sigh5:   { name: '5-4-3-2-1 Sigh',   steps: [[7,1],[5,1],[4,1],[2,1],[0,2]],                         syl: ['sol','fa','mi','re','do'] },
  octslide:{ name: 'Octave Leap',      steps: [[0,1.5],[12,2],[0,2]],                                  syl: ['do','do\'','do'] },
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

const PIANO_SEQ = { playing: false, host: null, timers: [], stepIdx: 0, noteIdx: -1, roots: [] };

function pianoState() {
  return (S.settings.piano ||= {
    baseOct: 3, keyPc: 0, labels: 'notes', sustain: false, seqOpen: true,
    pattern: 'scale5', startMidi: 60, peakMidi: 67, dir: 'updown', tempo: 116, chordBetween: true, autoStep: true,
  });
}

function pianoSeqStop(rerender = false) {
  PIANO_SEQ.timers.forEach(clearTimeout);
  PIANO_SEQ.timers = [];
  const h = PIANO_SEQ.host;
  PIANO_SEQ.playing = false; PIANO_SEQ.noteIdx = -1;
  if (h) h.querySelectorAll('.pk-key.lit, .pq-syl.on').forEach(x => x.classList.remove('lit', 'on'));
  if (rerender && h && h.isConnected) renderPiano(h);
}

function pianoBuildRoots(st) {
  const lo = Math.min(st.startMidi, st.peakMidi), hi = Math.max(st.startMidi, st.peakMidi);
  const up = []; for (let m = lo; m <= hi; m++) up.push(m);
  if (st.dir === 'up') return up;
  if (st.dir === 'down') return up.reverse();
  const dn = []; for (let m = hi - 1; m >= lo; m--) dn.push(m);
  return [...up, ...dn];
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
  // update banner text without full DOM rebuild so playback stays silky
  const kEl = host.querySelector('.pq-key'), cEl = host.querySelector('.pq-cnt');
  if (kEl) kEl.textContent = `${TOOL_PC_NAMES[((root % 12) + 12) % 12]} Major`;
  if (cEl) cEl.textContent = `Key ${idx + 1} of ${roots.length}`;
  // shift keyboard octave automatically if the pattern reaches outside the visible 2.5 octaves
  const loVis = 12 * (st.baseOct + 1), hiVis = loVis + 31;
  const maxNote = root + Math.max(...pat.steps.map(s => s[0]));
  if (root < loVis || maxNote > hiVis) {
    st.baseOct = clamp(Math.floor(root / 12) - 1, 2, 5);
    renderPiano(host);
  }
  const beatMs = 60000 / clamp(Number(st.tempo) || 116, 50, 200);
  let delay = 0;
  const allMidis = pat.steps.map(s => root + s[0]);
  toolEnsurePiano([...allMidis, root, root + 4, root + 7]);

  if (st.chordBetween) {
    const chord = [root, root + 4, root + 7];
    const t0 = setTimeout(() => {
      if (!PIANO_SEQ.playing) return;
      chord.forEach(m => { toolPlayNote(m, beatMs * 1.1 / 1000, 0.55); pianoLightKey(host, m, beatMs * 0.9); });
      host.querySelectorAll('.pq-syl.on').forEach(x => x.classList.remove('on'));
    }, delay);
    PIANO_SEQ.timers.push(t0);
    delay += beatMs * 1.4;
  }

  pat.steps.forEach(([semi, beats], ni) => {
    const m = root + semi, durMs = beats * beatMs;
    const tid = setTimeout(() => {
      if (!PIANO_SEQ.playing || !host.isConnected) return;
      toolPlayNote(m, Math.max(0.18, (durMs * 0.92) / 1000), 0.82);
      pianoLightKey(host, m, Math.max(180, durMs * 0.85));
      host.querySelectorAll('.pq-syl').forEach((el, j) => el.classList.toggle('on', j === ni));
    }, delay);
    PIANO_SEQ.timers.push(tid);
    delay += durMs;
  });

  if (st.autoStep) {
    const nextTid = setTimeout(() => {
      if (!PIANO_SEQ.playing) return;
      pianoPlayStep(host, st, idx + 1);
    }, delay + beatMs * 0.6);
    PIANO_SEQ.timers.push(nextTid);
  } else {
    const endTid = setTimeout(() => {
      if (!PIANO_SEQ.playing) return;
      host.querySelectorAll('.pq-syl.on').forEach(x => x.classList.remove('on'));
    }, delay + 120);
    PIANO_SEQ.timers.push(endTid);
  }
}

function renderPiano(h) {
  const st = pianoState();
  const baseMidi = 12 * (st.baseOct + 1); // e.g., C3 = 48
  // Build 19 white keys (2.5 octaves: C..G) + intervening black keys
  const whiteOffsets = [], blackOffsets = [];
  const isBlack = pc => [1, 3, 6, 8, 10].includes(pc);
  let wCount = 0;
  for (let off = 0; off <= 31; off++) {
    const m = baseMidi + off, pc = m % 12;
    if (isBlack(pc)) blackOffsets.push({ m, pos: wCount });
    else { whiteOffsets.push({ m, idx: wCount }); wCount++; }
  }
  toolEnsurePiano([...whiteOffsets.map(x => x.m), ...blackOffsets.map(x => x.m)]);

  const keyLbl = m => {
    if (st.labels === 'off') return '';
    if (st.labels === 'solfege') {
      const rel = ((m - st.keyPc) % 12 + 12) % 12;
      return TOOL_SOL_CHROM[rel];
    }
    return m % 12 === 0 ? toolMidiName(m) : TOOL_PC_NAMES[m % 12];
  };

  const pat = PIANO_PATTERNS[st.pattern] || PIANO_PATTERNS.scale5;
  const activeRoot = PIANO_SEQ.playing && PIANO_SEQ.roots[PIANO_SEQ.stepIdx] != null ? PIANO_SEQ.roots[PIANO_SEQ.stepIdx] : st.startMidi;
  const keyRangeOpts = [];
  for (let m = 48; m <= 79; m++) keyRangeOpts.push(m);

  h.innerHTML = `<div class="pn" tabindex="0">
    <div class="pn-bar">
      <div class="pn-grp">
        <button data-pn="oct" data-d="-1" title="Lower octave" ${st.baseOct <= 2 ? 'disabled' : ''}>${IC('ico:chevleft')}</button>
        <span class="pn-oct">C${st.baseOct}–G${st.baseOct + 2}</span>
        <button data-pn="oct" data-d="1" title="Higher octave" ${st.baseOct >= 5 ? 'disabled' : ''}>${IC('ico:chevright')}</button>
      </div>
      <label class="pn-sel">Key <select data-pn-k="keyPc">${TOOL_PC_NAMES.map((n, i) => `<option value="${i}" ${st.keyPc === i ? 'selected' : ''}>${n} major</option>`).join('')}</select></label>
      <div class="pn-seg" role="group" aria-label="Key labels">
        ${[['notes', 'Notes'], ['solfege', 'Solfege'], ['off', 'Off']].map(([v, l]) => `<button data-pn="labels" data-v="${v}" class="${st.labels === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <button data-pn="sustain" class="${st.sustain ? 'on' : ''}" title="Hold notes longer">Sustain</button>
      <span class="grow"></span>
      <button data-pn="seq-toggle" class="${st.seqOpen ? 'on' : ''}">${IC('ico:music')} Warm-up</button>
    </div>

    <div class="pn-chords">
      <span class="pn-clbl">${TOOL_PC_NAMES[st.keyPc]} Chords</span>
      ${PIANO_CHORDS.map(ch => `<button data-pn="chord" data-c="${ch.id}" title="Play ${ch.lbl} chord in ${TOOL_PC_NAMES[st.keyPc]}">${ch.lbl}</button>`).join('')}
      <span class="pn-hint">Click, slide, or use keys A–K</span>
    </div>

    <div class="pn-keys">
      ${whiteOffsets.map(({ m }) => {
        const isDo = st.labels === 'solfege' && ((m - st.keyPc) % 12 + 12) % 12 === 0;
        return `<button type="button" class="pk-key wk ${isDo ? 'is-do' : ''}" data-midi="${m}"><span>${keyLbl(m)}</span></button>`;
      }).join('')}
      ${blackOffsets.map(({ m, pos }) => `<button type="button" class="pk-key bk" data-midi="${m}" style="left:calc(${(pos * 100 / wCount).toFixed(3)}% - ${(50 / wCount * 0.64).toFixed(3)}%);width:${(100 / wCount * 0.64).toFixed(3)}%"><span>${st.labels === 'off' ? '' : keyLbl(m)}</span></button>`).join('')}
    </div>

    ${st.seqOpen ? `<div class="pn-seq">
      <div class="pq-banner">
        <div class="pq-meta"><b class="pq-key">${TOOL_PC_NAMES[((activeRoot % 12) + 12) % 12]} Major</b><span class="pq-cnt">${PIANO_SEQ.playing ? `Key ${PIANO_SEQ.stepIdx + 1} of ${PIANO_SEQ.roots.length}` : pat.name}</span></div>
        <div class="pq-syls">${pat.syl.map(s => `<span class="pq-syl">${s}</span>`).join('')}</div>
      </div>
      <div class="pq-row">
        <button data-pn="seq-play" class="pn-primary">${PIANO_SEQ.playing && PIANO_SEQ.host === h ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Start warm-up'}</button>
        ${PIANO_SEQ.playing && !st.autoStep ? `<button data-pn="seq-next" class="pn-primary">Next key ${IC('ico:chevright')}</button>` : ''}
        <label>Pattern <select data-pn-k="pattern">${Object.entries(PIANO_PATTERNS).map(([k, p]) => `<option value="${k}" ${st.pattern === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
        <label>Start <select data-pn-k="startMidi">${keyRangeOpts.map(m => `<option value="${m}" ${st.startMidi === m ? 'selected' : ''}>${toolMidiName(m)}</option>`).join('')}</select></label>
        <label>Peak <select data-pn-k="peakMidi">${keyRangeOpts.map(m => `<option value="${m}" ${st.peakMidi === m ? 'selected' : ''}>${toolMidiName(m)}</option>`).join('')}</select></label>
        <label>Move <select data-pn-k="dir">${[['updown', 'Up & down'], ['up', 'Up only'], ['down', 'Down only']].map(([v, l]) => `<option value="${v}" ${st.dir === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>BPM <input type="number" min="50" max="200" step="4" data-pn-k="tempo" value="${st.tempo}"></label>
        <label class="pn-chk"><input type="checkbox" data-pn-k="chordBetween" ${st.chordBetween ? 'checked' : ''}> Chord cue</label>
        <label class="pn-chk"><input type="checkbox" data-pn-k="autoStep" ${st.autoStep ? 'checked' : ''}> Auto-step</label>
      </div>
    </div>` : ''}
  </div>`;

  const rootEl = h.querySelector('.pn');
  const keysEl = h.querySelector('.pn-keys');
  let dragging = false, lastMidi = null;
  const hitKey = btn => {
    if (!btn || !btn.dataset.midi) return;
    const m = +btn.dataset.midi;
    toolPlayNote(m, st.sustain ? 2.4 : 0.9, 0.85, 'piano');
    btn.classList.add('lit');
    setTimeout(() => btn.classList.remove('lit'), st.sustain ? 650 : 260);
  };
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

  rootEl.onkeydown = e => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.code === 'Space' && PIANO_SEQ.playing && PIANO_SEQ.host === h) {
      e.preventDefault();
      if (!st.autoStep) pianoPlayStep(h, st, PIANO_SEQ.stepIdx + 1); else pianoSeqStop(true);
      return;
    }
    const off = PIANO_KBD_MAP[e.key.toLowerCase()];
    if (off != null && !e.repeat) {
      e.preventDefault();
      const m = baseMidi + 12 + off;
      const btn = h.querySelector(`.pk-key[data-midi="${m}"]`) || h.querySelector(`.pk-key[data-midi="${baseMidi + off}"]`);
      if (btn) hitKey(btn);
    }
  };

  h.onclick = e => {
    const b = e.target.closest('[data-pn]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.pn;
    if (act === 'oct') { st.baseOct = clamp(st.baseOct + Number(b.dataset.d), 2, 5); save(); renderPiano(h); }
    else if (act === 'labels') { st.labels = b.dataset.v; save(); renderPiano(h); }
    else if (act === 'sustain') { st.sustain = !st.sustain; save(); renderPiano(h); }
    else if (act === 'seq-toggle') { st.seqOpen = !st.seqOpen; save(); renderPiano(h); }
    else if (act === 'chord') {
      const ch = PIANO_CHORDS.find(x => x.id === b.dataset.c); if (!ch) return;
      const root = 12 * (st.baseOct + 2) + st.keyPc; // middle octave of visible keyboard
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
  h.onchange = e => {
    const el = e.target, k = el.dataset.pnK; if (!k) return;
    if (el.type === 'checkbox') st[k] = el.checked;
    else if (['keyPc', 'startMidi', 'peakMidi', 'tempo'].includes(k)) st[k] = Number(el.value);
    else st[k] = el.value;
    save();
    if (!PIANO_SEQ.playing) renderPiano(h);
  };
}
