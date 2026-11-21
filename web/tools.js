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
  const st = {
    speed: 1, loop: false, loopA: null, loopB: null, countIn: false, bpm: 100,
    peaks: AUD_PEAKS_CACHE[fileId] || null, dur: 0, counting: false, raf: 0, countTimers: [],
  };
  const audio = new Audio(src);
  audio.preload = 'auto';
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
      <button data-aud="clrloop" hidden title="Clear A–B loop">Clear loop</button>
      <span class="aud-sp"></span>
      <span class="aud-speeds" title="Playback speed (keeps pitch)">${[0.5, 0.75, 0.85, 1, 1.1, 1.25].map(v => `<button data-aud="spd" data-v="${v}" class="${v === 1 ? 'on' : ''}">${v}×</button>`).join('')}</span>
    </div>
    <div class="aud-ctl aud-sub">
      <label class="aud-chk"><input type="checkbox" data-aud-k="countIn"> Count-in (4 beats)</label>
      <label class="aud-bpm">at <input type="number" min="40" max="220" step="2" data-aud-k="bpm" value="100"> BPM</label>
      <span class="aud-sp"></span>
      <span class="aud-hint">Drag waveform to loop · Space = play · M = marker · [ ] = jump</span>
    </div>
    <div class="aud-marks-bar">
      <span class="aud-mlbl">${IC('ico:flag')} Markers</span>
      <button data-aud="mprev" title="Previous marker ([)">${IC('ico:chevleft')}</button>
      <button data-aud="mnext" title="Next marker (])">${IC('ico:chevright')}</button>
      <button data-aud="madd" class="ic-btn" title="Drop a rehearsal marker here (M)">${IC('ico:plus')} Marker</button>
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
      ? list.map(m => `<span class="aud-mk" data-mid="${m.id}"><button data-aud="mgo" data-mid="${m.id}" title="Jump to ${audFmt(m.t)}"><b>${audFmt(m.t)}</b> ${esc(m.label)}</button><button class="x" data-aud="mdel" data-mid="${m.id}" title="Remove marker" aria-label="Remove marker">${IC('ico:close')}</button></span>`).join('')
      : '<span class="aud-mnone">No markers yet — press + Marker (or M) to tag rehearsal spots.</span>';
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
    const beatMs = 60000 / clamp(Number(st.bpm) || 100, 40, 220);
    statEl.hidden = false;
    for (let i = 0; i < 4; i++) {
      st.countTimers.push(setTimeout(() => {
        if (!st.counting || !host.isConnected) return;
        statEl.textContent = String(i + 1);
        if (typeof metClick === 'function') metClick(c.currentTime + 0.01, i === 0 ? 'down' : 'beat');
      }, i * beatMs));
    }
    st.countTimers.push(setTimeout(() => {
      if (!st.counting || !host.isConnected) return;
      st.counting = false; statEl.hidden = true;
      audio.playbackRate = st.speed;
      audio.play().catch(() => { });
      syncUI();
    }, 4 * beatMs));
    syncUI();
  };

  const togglePlay = () => {
    if (st.counting) { stopCount(); statEl.hidden = true; syncUI(); return; }
    if (!audio.paused) { audio.pause(); syncUI(); return; }
    const startAt = st.loop && st.loopA != null && (audio.currentTime < st.loopA || (st.loopB != null && audio.currentTime >= st.loopB - 0.05)) ? st.loopA : null;
    startWithOptionalCountIn(startAt);
  };

  const addMarkerHere = () => {
    const t = +(audio.currentTime || 0).toFixed(2);
    const n = marks().length + 1;
    const label = prompt(`Label for marker at ${audFmt(t)}:`, `Spot ${n}`);
    if (label == null) return;
    marks().push({ id: uid(), t, label: label.trim() || `Spot ${n}` });
    marks().sort((a, b) => a.t - b.t);
    save(); renderMarks(); drawWaveCanvas();
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
    else if (st.loopB - st.loopA < 0.25) { st.loopA = st.loopB = null; st.loop = false; audio.currentTime = d.t0; syncUI(); }
    else { audio.currentTime = st.loopA; syncUI(); }
  };

  host.onclick = e => {
    const b = e.target.closest('[data-aud]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.aud;
    if (act === 'play') togglePlay();
    else if (act === 'back') { audio.currentTime = Math.max(0, (audio.currentTime || 0) - 5); syncUI(); }
    else if (act === 'fwd') { audio.currentTime = Math.min(st.dur || audio.duration || 0, (audio.currentTime || 0) + 5); syncUI(); }
    else if (act === 'loop') { st.loop = !st.loop; syncUI(); }
    else if (act === 'clrloop') { st.loopA = st.loopB = null; st.loop = false; syncUI(); }
    else if (act === 'spd') {
      st.speed = Number(b.dataset.v); audio.playbackRate = st.speed;
      host.querySelectorAll('[data-aud="spd"]').forEach(x => x.classList.toggle('on', Number(x.dataset.v) === st.speed));
    } else if (act === 'madd') addMarkerHere();
    else if (act === 'mprev') jumpMarker(-1);
    else if (act === 'mnext') jumpMarker(1);
    else if (act === 'mgo') { const m = marks().find(x => x.id === b.dataset.mid); if (m) { audio.currentTime = m.t; syncUI(); } }
    else if (act === 'mdel') { meta.marks = marks().filter(x => x.id !== b.dataset.mid); save(); renderMarks(); drawWaveCanvas(); }
  };
  host.onchange = e => {
    const el = e.target, k = el.dataset.audK; if (!k) return;
    if (k === 'countIn') st.countIn = el.checked;
    if (k === 'bpm') st.bpm = clamp(Number(el.value) || 100, 40, 220);
  };
  rootEl.onkeydown = e => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, (audio.currentTime || 0) - 5); syncUI(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min(st.dur || 0, (audio.currentTime || 0) + 5); syncUI(); }
    else if (e.key.toLowerCase() === 'm') { e.preventDefault(); addMarkerHere(); }
    else if (e.key.toLowerCase() === 'l') { e.preventDefault(); st.loop = !st.loop; syncUI(); }
    else if (e.key === '[') { e.preventDefault(); jumpMarker(-1); }
    else if (e.key === ']') { e.preventDefault(); jumpMarker(1); }
  };

  renderMarks();
  syncUI();
}

// ============================================================ 3. INTERACTIVE SOLFEGE LADDER, CURWEN HAND SIGNS & ECHO BOARD
const CURWEN_SVG = {
  do:  `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="11" y="9" width="24" height="18" rx="7" fill="currentColor" fill-opacity=".16"/><path d="M17 15h14M17 20h14"/><path d="M35 14h4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4"/></svg>`,
  re:  `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 27 L34 9 L39 14 L13 31 Z" fill="currentColor" fill-opacity=".16"/><path d="M28 13 L36 7"/></svg>`,
  mi:  `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 16h34a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6Z" fill="currentColor" fill-opacity=".16"/><path d="M12 22v3M36 22v2"/></svg>`,
  fa:  `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="7" width="20" height="14" rx="5" fill="currentColor" fill-opacity=".16"/><path d="M30 14h4a3 3 0 0 1 3 3v10a3 3 0 0 1-6 0v-6"/></svg>`,
  sol: `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="8" width="28" height="20" rx="5" fill="currentColor" fill-opacity=".16"/><path d="M10 14h28M10 19h28M10 24h22"/><path d="M14 8V5a2 2 0 0 1 4 0v3"/></svg>`,
  la:  `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 C15 7, 27 7, 34 15 C37 19, 38 25, 36 29 C33 25, 29 22, 23 23 C17 24, 13 21, 9 14 Z" fill="currentColor" fill-opacity=".16"/><path d="M27 18 C30 22, 31 26, 30 29"/></svg>`,
  ti:  `<svg class="sb-hand" viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="16" width="16" height="13" rx="5" fill="currentColor" fill-opacity=".16"/><path d="M24 18 L38 6"/><path d="M32 6h6v6"/></svg>`,
};

const SB_COLORS = {
  do:  ['#d9383a', '#fff'],
  re:  ['#e87a24', '#fff'],
  mi:  ['#eab308', '#1d2330'],
  fa:  ['#2ea04e', '#fff'],
  sol: ['#1f85a8', '#fff'],
  la:  ['#7b4bc4', '#fff'],
  ti:  ['#d64891', '#fff'],
};

function solBoardState() {
  return (S.settings.solboard ||= {
    keyPc: 0, mode: 'major', range: 'lowsol', sound: 'piano',
    hands: true, notes: false, colors: true, layout: 'ladder', mysteryLen: 4,
  });
}

function solBoardSteps(st) {
  const root = 60 + (st.keyPc || 0); // C4..B4
  const defs = {
    major: [
      { syl: 'sol,', base: 'sol', semi: -5, kbd: '0' },
      { syl: 'la,',  base: 'la',  semi: -3 },
      { syl: 'ti,',  base: 'ti',  semi: -1 },
      { syl: 'do',   base: 'do',  semi: 0,  kbd: '1' },
      { syl: 're',   base: 're',  semi: 2,  kbd: '2' },
      { syl: 'mi',   base: 'mi',  semi: 4,  kbd: '3' },
      { syl: 'fa',   base: 'fa',  semi: 5,  kbd: '4' },
      { syl: 'sol',  base: 'sol', semi: 7,  kbd: '5' },
      { syl: 'la',   base: 'la',  semi: 9,  kbd: '6' },
      { syl: 'ti',   base: 'ti',  semi: 11, kbd: '7' },
      { syl: "do'",  base: 'do',  semi: 12, kbd: '8' },
    ],
    minor: [
      { syl: 'sol,', base: 'sol', semi: -5, kbd: '0' },
      { syl: 'le,',  base: 'la',  semi: -4 },
      { syl: 'te,',  base: 'ti',  semi: -2 },
      { syl: 'do',   base: 'do',  semi: 0,  kbd: '1' },
      { syl: 're',   base: 're',  semi: 2,  kbd: '2' },
      { syl: 'me',   base: 'mi',  semi: 3,  kbd: '3' },
      { syl: 'fa',   base: 'fa',  semi: 5,  kbd: '4' },
      { syl: 'sol',  base: 'sol', semi: 7,  kbd: '5' },
      { syl: 'le',   base: 'la',  semi: 8,  kbd: '6' },
      { syl: 'te',   base: 'ti',  semi: 10, kbd: '7' },
      { syl: "do'",  base: 'do',  semi: 12, kbd: '8' },
    ],
    penta: [
      { syl: 'sol,', base: 'sol', semi: -5, kbd: '0' },
      { syl: 'la,',  base: 'la',  semi: -3 },
      { syl: 'do',   base: 'do',  semi: 0,  kbd: '1' },
      { syl: 're',   base: 're',  semi: 2,  kbd: '2' },
      { syl: 'mi',   base: 'mi',  semi: 4,  kbd: '3' },
      { syl: 'sol',  base: 'sol', semi: 7,  kbd: '4' },
      { syl: 'la',   base: 'la',  semi: 9,  kbd: '5' },
      { syl: "do'",  base: 'do',  semi: 12, kbd: '6' },
    ],
    chromatic: [
      { syl: 'do', base: 'do', semi: 0, kbd: '1' },
      { syl: 'di', base: 'do', semi: 1, alt: true },
      { syl: 're', base: 're', semi: 2, kbd: '2' },
      { syl: 'ri', base: 're', semi: 3, alt: true },
      { syl: 'mi', base: 'mi', semi: 4, kbd: '3' },
      { syl: 'fa', base: 'fa', semi: 5, kbd: '4' },
      { syl: 'fi', base: 'fa', semi: 6, alt: true },
      { syl: 'sol', base: 'sol', semi: 7, kbd: '5' },
      { syl: 'si', base: 'sol', semi: 8, alt: true },
      { syl: 'la', base: 'la', semi: 9, kbd: '6' },
      { syl: 'li', base: 'la', semi: 10, alt: true },
      { syl: 'ti', base: 'ti', semi: 11, kbd: '7' },
      { syl: "do'", base: 'do', semi: 12, kbd: '8' },
    ],
  };
  let list = defs[st.mode] || defs.major;
  if (st.range === 'dodo') list = list.filter(x => x.semi >= 0);
  return list.map(x => ({ ...x, midi: root + x.semi }));
}

function renderSolBoard(h) {
  const st = solBoardState();
  const steps = solBoardSteps(st);
  toolEnsurePiano(steps.map(s => s.midi));
  const trail = (h.__trail ||= []);
  const mys = h.__mystery || null;
  const playSeq = (seq, revealOnPlay = true) => {
    (h.__timers ||= []).forEach(clearTimeout); h.__timers = [];
    seq.forEach((item, idx) => {
      const tid = setTimeout(() => {
        if (!h.isConnected) return;
        toolPlayNote(item.midi, 0.55, 0.85, st.sound || 'piano');
        if (revealOnPlay) {
          const btn = h.querySelector(`.sb-tile[data-semi="${item.semi}"]`);
          if (btn) { btn.classList.add('lit'); setTimeout(() => btn.classList.remove('lit'), 380); }
        }
        const chip = h.querySelector(`.sb-echo-item[data-ei="${idx}"]`);
        if (chip) { chip.classList.add('lit'); setTimeout(() => chip.classList.remove('lit'), 380); }
      }, idx * 540);
      h.__timers.push(tid);
    });
  };

  const displaySteps = st.layout === 'ladder' ? [...steps].reverse() : steps;
  const tileStyle = s => {
    if (!st.colors) return '';
    const [bg, fg] = SB_COLORS[s.base] || ['#4a5568', '#fff'];
    return `style="--sb-bg:${bg};--sb-fg:${fg}"`;
  };

  h.innerHTML = `<div class="sb ${st.layout === 'grid' ? 'is-grid' : 'is-ladder'} ${st.colors ? 'is-col' : ''}" tabindex="0">
    <div class="sb-bar">
      <label>Key <select data-sb-k="keyPc">${TOOL_PC_NAMES.map((n, i) => `<option value="${i}" ${st.keyPc === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Scale <select data-sb-k="mode">${[['major', 'Major'], ['minor', 'Minor (do)'], ['penta', 'Pentatonic'], ['chromatic', 'Chromatic']].map(([v, l]) => `<option value="${v}" ${st.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${st.mode !== 'chromatic' ? `<label>Range <select data-sb-k="range">${[['lowsol', 'sol, – do\''], ['dodo', 'do – do\'']].map(([v, l]) => `<option value="${v}" ${st.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      <label>Sound <select data-sb-k="sound">${[['piano', 'Piano'], ['sine', 'Pure sine'], ['organ', 'Organ']].map(([v, l]) => `<option value="${v}" ${st.sound === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button data-sb="hands" class="${st.hands ? 'on' : ''}" title="Show Curwen hand signs">Hands</button>
      <button data-sb="notes" class="${st.notes ? 'on' : ''}" title="Show pitch letter names">Letters</button>
      <button data-sb="colors" class="${st.colors ? 'on' : ''}" title="Boomwhacker / Kodály pitch colors">Colors</button>
      <button data-sb="layout" title="Switch vertical ladder / horizontal grid">${st.layout === 'ladder' ? IC('ico:movehoriz') + ' Grid' : IC('ico:movevert') + ' Ladder'}</button>
    </div>

    <div class="sb-echo">
      ${mys ? `
        <span class="sb-elbl">Mystery echo</span>
        <div class="sb-elist">${mys.notes.map((n, i) => `<span class="sb-echo-item ${mys.revealed ? 'rev' : 'hid'}" data-ei="${i}" ${mys.revealed ? tileStyle(n) : ''}>${mys.revealed ? esc(n.syl) : '?'}</span>`).join('')}</div>
        <button data-sb="mys-replay">${IC('ico:play')} Replay</button>
        <button data-sb="mys-reveal" class="sb-primary">${mys.revealed ? 'Hide' : 'Reveal'}</button>
        <button data-sb="mys-new">New (${st.mysteryLen})</button>
        <button data-sb="mys-close" title="Back to echo trail">${IC('ico:close')}</button>
      ` : `
        <span class="sb-elbl">Echo trail</span>
        <div class="sb-elist">${trail.length ? trail.map((n, i) => `<span class="sb-echo-item rev" data-ei="${i}" ${tileStyle(n)}>${esc(n.syl)}</span>`).join('') : '<span class="sb-ehint">Tap syllables below (or press 1–8) to build an echo phrase.</span>'}</div>
        ${trail.length ? `<button data-sb="trail-play">${IC('ico:play')} Replay</button><button data-sb="trail-clear">Clear</button>` : ''}
        <span class="grow"></span>
        <label class="sb-mlen"><select data-sb-k="mysteryLen" title="Notes in Mystery Echo">${[3, 4, 5].map(n => `<option value="${n}" ${st.mysteryLen === n ? 'selected' : ''}>${n} notes</option>`).join('')}</select></label>
        <button data-sb="mys-new" class="sb-primary">${IC('ico:sparkle')} Mystery echo</button>
      `}
    </div>

    <div class="sb-tiles">
      ${displaySteps.map(s => `<button type="button" class="sb-tile ${s.alt ? 'is-alt' : ''}" data-semi="${s.semi}" ${tileStyle(s)}>
        ${st.hands ? (CURWEN_SVG[s.base] || '') : ''}
        <b class="sb-syl">${s.syl}</b>
        ${st.notes ? `<span class="sb-note">${toolMidiName(s.midi)}</span>` : ''}
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
      trail.push(s); if (trail.length > 8) trail.shift();
      const list = h.querySelector('.sb-elist');
      if (list) list.innerHTML = trail.map((n, i) => `<span class="sb-echo-item rev" data-ei="${i}" ${tileStyle(n)}>${esc(n.syl)}</span>`).join('');
      if (trail.length === 1) renderSolBoard(h); // reveal Replay/Clear buttons
    }
  };

  const makeMystery = () => {
    const pool = steps.filter(s => !s.alt && s.semi >= 0);
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
    else if (act === 'trail-play') { playSeq(trail, true); }
    else if (act === 'trail-clear') { h.__trail = []; renderSolBoard(h); }
    else if (act === 'mys-new') { makeMystery(); }
    else if (act === 'mys-replay' && h.__mystery) { playSeq(h.__mystery.notes, h.__mystery.revealed); }
    else if (act === 'mys-reveal' && h.__mystery) { h.__mystery.revealed = !h.__mystery.revealed; renderSolBoard(h); }
    else if (act === 'mys-close') { h.__mystery = null; renderSolBoard(h); }
  };
  h.onchange = e => {
    const el = e.target, k = el.dataset.sbK; if (!k) return;
    st[k] = ['keyPc', 'mysteryLen'].includes(k) ? Number(el.value) : el.value;
    h.__trail = []; h.__mystery = null;
    save(); renderSolBoard(h);
  };
  h.querySelector('.sb').onkeydown = e => {
    if (e.target.closest('input,select,textarea')) return;
    const match = steps.find(s => s.kbd === e.key);
    if (match) { e.preventDefault(); triggerStep(match); return; }
    if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      if (h.__mystery) playSeq(h.__mystery.notes, h.__mystery.revealed);
      else if (trail.length) playSeq(trail, true);
    }
  };
}
