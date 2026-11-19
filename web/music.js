'use strict';
/* Music tools for Rehearsal: Tuner + Drone window and Metronome window. */

const MU_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MU_TRANSPOSE = { concert: ['Concert', 0], bb: ['B♭ instrument', 2], eb: ['E♭ instrument', 9], f: ['F instrument', 7] };
const MU_SENS = { quiet: 0.006, normal: 0.012, noisy: 0.02 };      // the loudest-sound level needed before the tuner listens
// an arc on the tuner gauge between two cent values (the gauge spans -50..+50 cents over 90 degrees)
const muArc = (c1, c2) => { const p = c => { const a = c * 0.9 * Math.PI / 180; return [95 * Math.sin(a), -95 * Math.cos(a)]; }; const [x1, y1] = p(c1), [x2, y2] = p(c2); return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A 95 95 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`; };
const muAlive = id => id && document.querySelector(`[data-mu-win="${id}"]`);
const muAC = () => (typeof ac === 'function' ? ac() : (window.__muAC ||= new AudioContext()));

function muDefaults(kind) {
  return kind === 'tuner'
    ? { trans: 'concert', refA: 440, target: 'auto', sens: 'normal', drone: { pc: 10, oct: 3, mode: 'single', sound: 'organ', vol: 0.5, pure: true } }
    : { tempo: 100, beats: 4, pattern: '', sub: 1, thenGo: false, sound: 'click', accents: true, mute: false, voice: false, offset: 0, rampTo: 0, rampBars: 4 };
}

// ============================================================ TUNER
// Autocorrelation pitch detection (works well for sustained band/orchestra tones).
// opts (optional): minHz / maxHz limit the search range; minClarity (0–1) rejects frames whose
// best period is not clearly periodic (breaths, consonants, room noise). The tuner uses the defaults.
function muDetectPitch(buf, sr, minRms = 0.012, opts = {}) {
  const { minHz = 40, maxHz = 0, minClarity = 0 } = opts;
  let n = buf.length, rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return { f: -1, rms, clarity: 0 };
  let r1 = 0, r2 = n - 1; const th = 0.2;
  for (let i = 0; i < n / 2; i++) if (Math.abs(buf[i]) < th) { r1 = i; break; }
  for (let i = 1; i < n / 2; i++) if (Math.abs(buf[n - i]) < th) { r2 = n - i; break; }
  const b = buf.subarray(r1, r2); n = b.length;
  const maxLag = Math.min(n, Math.floor(sr / minHz));        // default lowest note ~40 Hz (tuba)
  const minLag = maxHz > 0 ? Math.floor(sr / maxHz) : 0;
  const c = new Float32Array(maxLag);
  for (let lag = 0; lag < maxLag; lag++) { let s = 0; for (let j = 0; j < n - lag; j++) s += b[j] * b[j + lag]; c[lag] = s; }
  let d = 0; while (d < maxLag - 1 && c[d] > c[d + 1]) d++;
  d = Math.max(d, minLag);
  let mv = -1, mp = -1;
  for (let i = d; i < maxLag; i++) if (c[i] > mv) { mv = c[i]; mp = i; }
  if (mp < 2 || mp >= maxLag - 1) return { f: -1, rms, clarity: 0 };
  // Octave fix (opt-in): low voices often look almost as alike two cycles later as one, so the
  // biggest peak can sit at twice the true period (reading an octave low). If half (or a third of)
  // that period is a peak nearly as strong, that is the real pitch.
  if (opts.octaveFix) {
    for (const k of [2, 3]) {
      const c0 = Math.round(mp / k); if (c0 < Math.max(2, minLag)) continue;
      let bi = c0; for (let j = c0 - 2; j <= c0 + 2; j++) if (j > 1 && j < maxLag - 1 && c[j] > c[bi]) bi = j;
      if (c[bi] >= c[bi - 1] && c[bi] >= c[bi + 1] && c[bi] >= 0.85 * mv) { mp = bi; mv = c[bi]; break; }
    }
  }
  // how alike the signal is to itself one period later (1 = perfectly periodic), corrected for the shorter overlap
  const clarity = c[0] > 0 ? (c[mp] / (n - mp)) / (c[0] / n) : 0;
  if (clarity < minClarity) return { f: -1, rms, clarity };
  const x1 = c[mp - 1], x2 = c[mp], x3 = c[mp + 1], a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  const T0 = a ? mp - bb / (2 * a) : mp;
  return { f: sr / T0, rms, clarity };
}

const MU_TUNER = { stream: null, an: null, buf: null, raf: 0, host: null, id: null, hist: [] };
async function muTunerStart(host, st, id) {
  muTunerStop();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const c = muAC(); await c.resume();
    const src = c.createMediaStreamSource(stream), an = c.createAnalyser();
    an.fftSize = 4096; src.connect(an);
    Object.assign(MU_TUNER, { stream, an, buf: new Float32Array(2048), host, id, hist: [] });
    let last = 0;
    const loop = (ts) => {
      if (!MU_TUNER.stream) return;
      const live = muAlive(MU_TUNER.id); if (!live) { muTunerStop(); return; }
      MU_TUNER.host = live;
      if (ts - last > 55) { last = ts; muTunerFrame(live, st); }
      MU_TUNER.raf = requestAnimationFrame(loop);
    };
    MU_TUNER.raf = requestAnimationFrame(loop);
  } catch (e) {
    (typeof toast === 'function' ? toast : alert)('Microphone not available: ' + e.message);
  }
  muTunerRender(host, st, id);
}
function muTunerStop() {
  cancelAnimationFrame(MU_TUNER.raf);
  MU_TUNER.stream?.getTracks().forEach(t => t.stop());
  Object.assign(MU_TUNER, { stream: null, an: null, id: null });
}
function muTunerFrame(host, st) {
  const { an, buf } = MU_TUNER; if (!an) return;
  an.getFloatTimeDomainData(buf);
  const { f } = muDetectPitch(buf, muAC().sampleRate, MU_SENS[st.sens || 'normal']);
  const view = host.querySelector('.tu-read'); if (!view) return;
  if (f <= 0 || f > 2500) { view.classList.add('idle'); return; }
  const ref = st.refA || 440;
  const m = 69 + 12 * Math.log2(f / ref);                       // semitones from the reference A
  MU_TUNER.hist.push(m); if (MU_TUNER.hist.length > 5) MU_TUNER.hist.shift();
  const sorted = [...MU_TUNER.hist].sort((a, b) => a - b), mm = sorted[Math.floor(sorted.length / 2)];
  let n = Math.round(mm);
  if (st.target && st.target !== 'auto') {                      // tune to the chosen note, the nearest octave of it
    const d = ((+st.target - n) % 12 + 18) % 12 - 6;
    n = n + d;
  }
  const exact = (mm - n) * 100, cents = Math.round(exact);
  const written = n + MU_TRANSPOSE[st.trans][1];
  view.classList.remove('idle');
  view.querySelector('.tu-note').textContent = MU_NAMES[((written % 12) + 12) % 12];
  view.querySelector('.tu-oct').textContent = Math.floor(written / 12) - 1;
  view.querySelector('.tu-cents').textContent = (exact > 0 ? '+' : '') + exact.toFixed(1) + '¢';
  view.querySelector('.tu-hz').textContent = f.toFixed(2) + ' Hz' + (st.trans !== 'concert' ? ` · concert ${MU_NAMES[((n % 12) + 12) % 12]}` : '') + (ref !== 440 ? ` · A = ${ref}` : '');
  const needle = view.querySelector('.tu-needle');
  // the needle glides toward the reading instead of jumping, so small wobbles don't shake it
  const target = Math.max(-50, Math.min(50, exact)), disp = MU_TUNER.disp ?? target;
  MU_TUNER.disp = disp + (target - disp) * 0.5;
  needle.style.transform = `rotate(${MU_TUNER.disp * 0.9}deg)`;
  const ok = Math.abs(cents) <= 5, near = Math.abs(cents) <= 15;
  view.dataset.state = ok ? 'ok' : near ? 'near' : 'off';
  view.querySelector('.tu-hint').textContent = ok ? 'In tune' : cents > 0 ? 'Sharp ↓' : 'Flat ↑';
}
function muTunerRender(host, st, id) {
  const listening = !!MU_TUNER.stream && MU_TUNER.id === id;
  host.querySelector('.tu-panel').innerHTML = `
    <div class="mu-row"><select data-mu="trans">${Object.entries(MU_TRANSPOSE).map(([k, [l]]) => `<option value="${k}" ${st.trans === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button data-mu="listen" class="${listening ? 'on' : ''}">${listening ? IC('ico:stop') + ' Stop listening' : IC('ico:mic') + ' Start tuner'}</button></div>
    <div class="mu-row">
      <label>A = <select data-mu="ref">${[435, 436, 437, 438, 439, 440, 441, 442, 443, 444, 445].map(v => `<option value="${v}" ${(st.refA || 440) === v ? 'selected' : ''}>${v} Hz</option>`).join('')}</select></label>
      <label>Tune to <select data-mu="target"><option value="auto" ${!st.target || st.target === 'auto' ? 'selected' : ''}>Nearest note</option>${MU_NAMES.map((nm, i) => `<option value="${i}" ${String(st.target) === String(i) ? 'selected' : ''}>${nm}</option>`).join('')}</select></label>
      <label>Listens to <select data-mu="sens">${[['quiet', 'Quiet room'], ['normal', 'Normal'], ['noisy', 'Noisy room']].map(([k, l]) => `<option value="${k}" ${(st.sens || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="tu-read idle" data-state="off">
      <svg class="tu-gauge" viewBox="-110 -105 220 120">
        <path d="M -95 0 A 95 95 0 0 1 95 0" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="14"/>
        <path d="${muArc(-15, 15)}" fill="none" stroke="#f4a261" stroke-opacity=".55" stroke-width="14"/>
        <path d="${muArc(-5, 5)}" fill="none" stroke="#2ecc71" stroke-width="14"/>
        ${Array.from({ length: 21 }, (_, i) => i * 5 - 50).map(c => { const a = (c * 0.9 - 90) * Math.PI / 180, major = c % 10 === 0, len = c % 25 === 0 ? 14 : major ? 9 : 5; return `<line x1="${Math.cos(a) * 82}" y1="${Math.sin(a) * 82}" x2="${Math.cos(a) * (82 - len)}" y2="${Math.sin(a) * (82 - len)}" stroke="currentColor" stroke-opacity="${major ? .55 : .25}" stroke-width="${c % 25 === 0 ? 2.2 : 1.1}"/>`; }).join('')}
        ${[-50, -25, 0, 25, 50].map(c => { const a = (c * 0.9 - 90) * Math.PI / 180; return `<text x="${Math.cos(a) * 58}" y="${Math.sin(a) * 58 + 4}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">${c > 0 ? '+' + c : c}</text>`; }).join('')}
        <g class="tu-needle"><line x1="0" y1="0" x2="0" y2="-88" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/><circle r="7" fill="var(--accent)"/></g>
      </svg>
      <div class="tu-big"><span class="tu-note">–</span><sub class="tu-oct"></sub></div>
      <div class="tu-cents">${listening ? 'Play a note…' : 'Tap “Start tuner”'}</div>
      <div class="tu-hint"></div>
      <div class="tu-hz"></div>
    </div>`;
}

// ============================================================ DRONE
const MU_DRONE = { master: null, voices: [], owner: null, id: null, watch: 0 };
const MU_DRONE_MODES = { single: ['Single note', [0]], fifth: ['Root + 5th', [0, 7]], fifthoct: ['Root + 5th + octave', [0, 7, 12]], major: ['Major chord', [0, 4, 7]], minor: ['Minor chord', [0, 3, 7]] };
const MU_PURE = { 0: 1, 3: 6 / 5, 4: 5 / 4, 7: 3 / 2, 12: 2 };
function muDroneStop(fade = 0.25) {
  const c = muAC(), m = MU_DRONE.master; if (!m) return;
  m.gain.cancelScheduledValues(c.currentTime); m.gain.setValueAtTime(m.gain.value, c.currentTime);
  m.gain.linearRampToValueAtTime(0, c.currentTime + fade);
  const vs = MU_DRONE.voices; setTimeout(() => { vs.forEach(v => { try { v.stop(); } catch { } }); try { m.disconnect(); } catch { } }, fade * 1000 + 50);
  clearInterval(MU_DRONE.watch);
  Object.assign(MU_DRONE, { master: null, voices: [], owner: null, id: null, watch: 0 });
}
function muDroneStart(d, owner, id) {
  muDroneStop(0.08);
  const c = muAC(); c.resume();
  const master = c.createGain(); master.gain.value = 0; master.connect(c.destination);
  master.gain.linearRampToValueAtTime(d.vol * 0.35, c.currentTime + (d.sound === 'strings' ? 0.6 : 0.2));
  const root = 440 * Math.pow(2, (12 * (d.oct + 1) + d.pc - 69) / 12);
  const ivs = MU_DRONE_MODES[d.mode][1], voices = [];
  let organ = null;
  for (const iv of ivs) {
    const f = d.pure && MU_PURE[iv] ? root * MU_PURE[iv] : root * Math.pow(2, iv / 12);
    const g = c.createGain(); g.gain.value = (iv === 0 ? 1 : 0.7) / Math.sqrt(ivs.length); g.connect(master);
    if (d.sound === 'strings') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(g);
      for (const det of [-5, 5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; const og = c.createGain(); og.gain.value = 0.35; o.connect(og).connect(lp); o.start(); voices.push(o); }
    } else {
      const o = c.createOscillator();
      if (d.sound === 'organ') { organ ||= c.createPeriodicWave(new Float32Array([0, 1, .55, .35, .25, .12, .1]), new Float32Array(7)); o.setPeriodicWave(organ); }
      else o.type = 'sine';
      o.frequency.value = f; o.connect(g); o.start(); voices.push(o);
    }
  }
  Object.assign(MU_DRONE, { master, voices, owner, id });
  MU_DRONE.watch = setInterval(() => { if (!muAlive(MU_DRONE.id)) muDroneStop(); }, 1000);
}
function muDroneRender(host, st) {
  const d = st.drone, playing = MU_DRONE.owner === st;
  const quick = MU_NAMES.map((l, pc) => [pc, l]);                 // every note, one tap each
  host.querySelector('.dr-panel').innerHTML = `
    <div class="mu-h">Drone</div>
    <div class="dr-quick">${quick.map(([pc, l]) => `<button data-mu="dpc" data-v="${pc}" class="${d.pc === pc ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="mu-row">
      <label>Note <select data-mu="d" data-k="pc">${MU_NAMES.map((nm, i) => `<option value="${i}" ${d.pc === i ? 'selected' : ''}>${nm}</option>`).join('')}</select></label>
      <label>Octave <select data-mu="d" data-k="oct">${[1, 2, 3, 4, 5, 6].map(o => `<option ${d.oct === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
    </div>
    <div class="mu-row">
      <label>Play <select data-mu="d" data-k="mode">${Object.entries(MU_DRONE_MODES).map(([k, [l]]) => `<option value="${k}" ${d.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Sound <select data-mu="d" data-k="sound">${[['organ', 'Organ'], ['sine', 'Soft sine'], ['strings', 'Strings']].map(([k, l]) => `<option value="${k}" ${d.sound === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="mu-row"><label class="mu-chk"><input type="checkbox" data-mu="d" data-k="pure" ${d.pure ? 'checked' : ''}> Pure (just) intervals</label>
      <label>Volume <input type="range" min="0.05" max="1" step="0.05" data-mu="d" data-k="vol" value="${d.vol}"></label></div>
    <button class="dr-play ${playing ? 'on' : ''}" data-mu="drone">${playing ? IC('ico:stop') + ' Stop drone' : IC('ico:play') + ' Start drone'} · concert ${MU_NAMES[d.pc]}${MU_DRONE_MODES[d.mode][1].length > 1 ? ' ' + (MU_DRONE_MODES[d.mode][0].toLowerCase()) : ''}</button>`;
}

function mountTuner(host, st, onChange, id) {
  host.innerHTML = `<div class="mu tuner"><div class="tu-panel"></div><div class="dr-panel"></div></div>`;
  if (MU_TUNER.id === id) MU_TUNER.host = host;
  muTunerRender(host, st, id); muDroneRender(host, st);
  host.onclick = e => {
    const b = e.target.closest('[data-mu]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    e.stopPropagation();
    const k = b.dataset.mu;
    if (k === 'listen') { if (MU_TUNER.stream && MU_TUNER.id === id) { muTunerStop(); muTunerRender(host, st, id); } else muTunerStart(host, st, id); return; }
    if (k === 'drone') { MU_DRONE.owner === st ? muDroneStop() : muDroneStart(st.drone, st, id); muDroneRender(host, st); return; }
    if (k === 'dpc') { st.drone.pc = +b.dataset.v; if (MU_DRONE.owner === st) muDroneStart(st.drone, st, id); onChange(); muDroneRender(host, st); }
  };
  const change = e => {
    const el = e.target; if (!el.dataset.mu) return;
    if (el.dataset.mu === 'trans') { st.trans = el.value; onChange(); return; }
    if (el.dataset.mu === 'ref') { st.refA = +el.value; onChange(); return; }
    if (el.dataset.mu === 'target') { st.target = el.value; onChange(); return; }
    if (el.dataset.mu === 'sens') { st.sens = el.value; onChange(); return; }
    if (el.dataset.mu === 'd') {
      const k = el.dataset.k;
      st.drone[k] = el.type === 'checkbox' ? el.checked : k === 'vol' ? +el.value : ['pc', 'oct'].includes(k) ? +el.value : el.value;
      if (MU_DRONE.owner === st) {
        if (k === 'vol') { const c = muAC(); MU_DRONE.master.gain.setTargetAtTime(st.drone.vol * 0.35, c.currentTime, 0.05); }
        else if (e.type === 'change') muDroneStart(st.drone, st, id);
      }
      onChange();
      if (e.type === 'change') muDroneRender(host, st);
    }
  };
  host.onchange = change; host.oninput = e => { if (e.target.dataset.k === 'vol') change(e); };
}

// ============================================================ METRONOME
const MET = { on: false, timer: 0, raf: 0, next: 0, tick: 0, queue: [], st: null, host: null, id: null, stopAfter: -1, taps: [] };
function metGroups(st) {
  const parts = String(st.pattern || '').split(/[+\s,]+/).map(Number).filter(n => n > 0);
  return parts.length && parts.reduce((a, b) => a + b, 0) === st.beats ? parts : null;
}
function metAccentSet(st) {
  const g = null, set = new Set([0]);   // accents are set per beat by tapping (st.marks); no pattern box
  if (g) { let p = 0; for (const n of g) { set.add(p); p += n; } }
  return set;
}
// Per-beat state: 'normal' | 'accent' | 'silent'. Tap a beat to cycle normal → accent → silent → normal.
function metBeatState(st, i) {
  const m = st.marks && st.marks[i];
  return m || (metAccentSet(st).has(i) ? 'accent' : 'normal');
}
function metClick(time, kind, sound = 'click') {
  const c = muAC(), o = c.createOscillator(), g = c.createGain();
  let f = kind === 'down' ? 1760 : kind === 'accent' ? 1480 : kind === 'beat' ? 1100 : 820;
  let amp = kind === 'down' ? 0.55 : kind === 'accent' ? 0.45 : kind === 'beat' ? 0.32 : 0.14;
  let type = kind === 'sub' ? 'sine' : 'triangle', dec = kind === 'sub' ? 0.035 : 0.07;
  if (sound === 'wood') { f *= 0.45; type = 'sine'; dec = 0.06; }          // soft wood-block knock
  if (sound === 'beep') { type = 'square'; amp *= 0.5; dec = 0.1; }        // electronic beep
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(amp, time + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, time + dec);
  o.connect(g).connect(c.destination); o.start(time); o.stop(time + dec + 0.02);
}
// Count out loud (uses the device's speech voice; silently skipped if none is available)
function metSay(n) {
  try { if (!('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(String(n)); u.rate = 1.5; u.volume = 0.8; speechSynthesis.speak(u); } catch (e) {}
}
function metStart(host, st, countOff = false, id = MET.id) {
  metStop();
  const c = muAC(); c.resume();
  Object.assign(MET, { on: true, st, host, id, next: c.currentTime + 0.12, beat: 0, sub: 0, beatsPlayed: 0, queue: [], countOff, base: st.tempo });
  MET.timer = setInterval(() => {
    if (!muAlive(MET.id)) { metStop(); return; }
    while (MET.next < c.currentTime + 0.12) {
      const beats = Math.max(1, st.beats), subs = Math.max(1, st.sub);
      if (MET.beat >= beats) MET.beat = 0;                 // fewer beats chosen mid-bar
      if (MET.sub >= subs) MET.sub = 0;
      // count-off: one bar, then stop (unless "keep going" is ticked — that can change live too)
      if (MET.countOff && !st.thenGo && MET.sub === 0 && MET.beatsPlayed >= beats) {
        setTimeout(() => { metStop(); if (MET.host) metRender(MET.host, st); }, (MET.next - c.currentTime) * 1000 + 50); clearInterval(MET.timer); return;
      }
      const state = metBeatState(st, MET.beat);
      const kind = MET.sub ? 'sub' : MET.beat === 0 ? 'down' : state === 'accent' ? 'accent' : 'beat';
      // sound is nudged by the sync offset (video/audio lag); the flash stays on the true beat
      const at = Math.max(c.currentTime + 0.001, MET.next + (st.offset || 0) / 1000);
      if (!st.mute && state !== 'silent') metClick(at, kind, st.sound || 'click');
      MET.queue.push({ t: MET.next, beat: MET.beat, sub: MET.sub });
      // gradual tempo change: moves linearly from the start BPM to "ramp to" over the chosen number of bars
      const frac = st.rampTo ? Math.min(1, MET.beatsPlayed / Math.max(1, (st.rampBars || 4) * beats)) : 0;
      const tempo = st.rampTo ? MET.base + (st.rampTo - MET.base) * frac : st.tempo;
      MET.next += 60 / Math.max(30, tempo) / subs;
      if (++MET.sub >= subs) { MET.sub = 0; MET.beat = (MET.beat + 1) % beats; MET.beatsPlayed++; }
    }
  }, 25);
  const frame = () => {
    if (!MET.on) return;
    const now = muAC().currentTime; let cur = null;
    while (MET.queue.length && MET.queue[0].t <= now) cur = MET.queue.shift();
    if (cur && MET.host) metShow(MET.host, st, cur);
    if (cur && st.voice && cur.sub === 0) metSay(cur.beat + 1);
    MET.raf = requestAnimationFrame(frame);
  };
  MET.raf = requestAnimationFrame(frame);
  metRender(host, st);
}
function metStop() {
  clearInterval(MET.timer); cancelAnimationFrame(MET.raf);
  const was = MET.on; Object.assign(MET, { on: false, queue: [] });
  return was;
}
function metShow(host, st, { beat, sub }) {
  const big = host.querySelector('.me-big'); if (!big) return;
  if (sub === 0) {
    big.textContent = beat + 1;
    big.classList.toggle('down', beat === 0);
    big.classList.remove('hit'); void big.offsetWidth; big.classList.add('hit');
    host.querySelectorAll('.me-dot').forEach((d, i) => d.classList.toggle('on', i === beat));
  }
  host.querySelectorAll('.me-sub i').forEach((d, i) => d.classList.toggle('on', i === sub));
}
function metRender(host, st) {
  const running = MET.on && MET.host === host && MET.st === st;
  const subs = [[1, '♩'], [2, '♫ 8ths'], [3, '3 triplets'], [4, '♬ 16ths'], [6, '6 sextuplets']];
  host.querySelector('.me-panel').innerHTML = `
    <div class="me-display">
      <div class="me-big ${running ? '' : 'idle'}">${running ? '' : st.tempo}</div>
      <div class="me-dots">${Array.from({ length: st.beats }, (_, i) => { const s = metBeatState(st, i); return `<span class="me-dot ${s === 'accent' ? 'acc' : s === 'silent' ? 'silent' : ''}" data-mu="mark" data-v="${i}" title="Tap: normal → accent → silent">${i + 1}</span>`; }).join('')}</div>
      <div class="me-sub">${st.sub > 1 ? Array.from({ length: st.sub }, () => '<i></i>').join('') : ''}</div>
    </div>
    <div class="me-controls">
      <div class="me-tempo"><button data-mu="tempo" data-v="-5">−5</button><button data-mu="tempo" data-v="-1">−</button>
        <span class="me-bpm"><b>${st.tempo}</b> BPM</span><button data-mu="tempo" data-v="1">+</button><button data-mu="tempo" data-v="5">+5</button>
        <button data-mu="tap" class="me-tap">Tap</button></div>
      <input type="range" min="30" max="240" value="${st.tempo}" data-mu="bpm" class="me-slider">
      <div class="mu-row">
        <label>Beats <select data-mu="beats">${Array.from({ length: 12 }, (_, i) => `<option ${st.beats === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <span class="me-subs">${subs.map(([n, l]) => `<button data-mu="sub" data-v="${n}" class="${st.sub === n ? 'on' : ''}">${l}</button>`).join('')}</span>
      </div>
      <div class="mu-row">
        <label>Sound <select data-mu="sound">${[['click', 'Click'], ['wood', 'Wood block'], ['beep', 'Beep']].map(([v, l]) => `<option value="${v}" ${(st.sound || 'click') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="mu-chk"><input type="checkbox" data-mu="mute" ${st.mute ? 'checked' : ''}> Flash only (no sound)</label>
        <label class="mu-chk"><input type="checkbox" data-mu="voice" ${st.voice ? 'checked' : ''}> Count out loud</label>
      </div>
      <div class="mu-row">
        <label>Sync <input type="number" data-mu="offset" value="${st.offset || 0}" step="10" min="-300" max="300" size="4" title="Delay the click sound by this many milliseconds to line up with video or audio lag"> ms</label>
        <label>Ramp to <input type="number" data-mu="rampTo" value="${st.rampTo || ''}" placeholder="BPM" min="30" max="240" size="4" title="Leave empty for no tempo change"> BPM over <input type="number" data-mu="rampBars" value="${st.rampBars || 4}" min="1" max="64" size="3"> bars</label>
      </div>
      <div class="mu-row">
        <button data-mu="start" class="me-start ${running && !MET.countOff ? 'on' : ''}">${running && !MET.countOff ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Start'}</button>
        <button data-mu="count" class="${running && MET.countOff ? 'on' : ''}">1-2-3-4 Count-off</button>
        <label class="mu-chk"><input type="checkbox" data-mu="thenGo" ${st.thenGo ? 'checked' : ''}> keep going after count-off</label>
      </div>
    </div>`;
}
function mountMetronome(host, st, onChange, id) {
  host.innerHTML = `<div class="mu metro"><div class="me-panel"></div></div>`;
  if (MET.on && MET.id === id) MET.host = host;           // keep ticking through window re-draws
  metRender(host, st);
  const restart = () => metRender(host, st);   // a running metronome picks the change up on its next click
  host.onclick = e => {
    const b = e.target.closest('[data-mu]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    e.stopPropagation();
    const k = b.dataset.mu;
    if (k === 'start') { if (MET.on && MET.id === id && !MET.countOff) { metStop(); metRender(host, st); } else metStart(host, st, false, id); return; }
    if (k === 'count') { metStart(host, st, true, id); return; }
    if (k === 'tempo') { st.tempo = Math.max(30, Math.min(240, st.tempo + +b.dataset.v)); }
    if (k === 'sub') { st.sub = +b.dataset.v; }
    if (k === 'mark') {
      const i = +b.dataset.v, cur = metBeatState(st, i);
      st.marks = Array.from({ length: Math.max(1, st.beats) }, (_, j) => metBeatState(st, j));
      st.marks[i] = cur === 'normal' ? 'accent' : cur === 'accent' ? 'silent' : 'normal';
    }
    if (k === 'tap') {
      const now = performance.now(); if (MET.taps.length && now - MET.taps[MET.taps.length - 1] > 2000) MET.taps = [];
      MET.taps.push(now); if (MET.taps.length > 5) MET.taps.shift();
      if (MET.taps.length >= 2) { const iv = (MET.taps[MET.taps.length - 1] - MET.taps[0]) / (MET.taps.length - 1); st.tempo = Math.max(30, Math.min(240, Math.round(60000 / iv))); }
    }
    onChange(); restart();
  };
  host.oninput = e => { if (e.target.dataset.mu === 'bpm') { st.tempo = +e.target.value; const b = host.querySelector('.me-bpm b'); if (b) b.textContent = st.tempo; const big = host.querySelector('.me-big.idle'); if (big) big.textContent = st.tempo; } };
  host.onchange = e => {
    const el = e.target, k = el.dataset.mu; if (!k) return;
    if (k === 'bpm') st.tempo = +el.value;
    if (k === 'beats') { st.beats = +el.value; st.marks = null; if (!metGroups(st)) st.pattern = ''; }
    if (k === 'thenGo') st.thenGo = el.checked;
    if (k === 'sound') st.sound = el.value;
    if (k === 'mute') st.mute = el.checked;
    if (k === 'voice') st.voice = el.checked;
    if (k === 'offset') st.offset = Math.max(-300, Math.min(300, +el.value || 0));
    if (k === 'rampTo') st.rampTo = el.value === '' ? 0 : Math.max(30, Math.min(240, +el.value));
    if (k === 'rampBars') st.rampBars = Math.max(1, Math.min(64, +el.value || 4));
    onChange(); restart();
  };
}

window.muDefaults = muDefaults;
window.mountTuner = mountTuner;
window.mountMetronome = mountMetronome;
if (typeof mountSightHosts === 'function') mountSightHosts();
