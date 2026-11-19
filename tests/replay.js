// Replay saved Grade attempts.  jsc replay.js -- <music.js> <grade.js> <grlog…j file> [audio]
//   default: re-grade the frames recorded live.   "audio": recompute frames from the .wav (raw mic) first.
const [MUSIC, GRADE, LOG, MODE] = arguments;
var window = this; var document = { addEventListener(){}, getElementById(){ return null; } };
load(MUSIC); load(GRADE);
const L = JSON.parse(readFile(LOG));
let frames = L.frames;
if (MODE === 'audio') {
  const b = read(LOG.replace(/j$/, 'w'), 'binary'), v = new DataView(b.buffer);
  const n = v.getUint32(40, true) / 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = v.getInt16(44 + i * 2, true) / 32768;
  // same chain as the app: two 1400 Hz low-pass filters
  const lp = (a, sr, f0, Q) => { const w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * Q), cw = Math.cos(w), a0 = 1 + al;
    const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0; const y = new Float32Array(a.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < a.length; i++) { const o = b0 * a[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = a[i]; y2 = y1; y1 = o; y[i] = o; } return y; };
  const sr = L.sampleRate, y = lp(lp(x, sr, 1400, 0.7), sr, 1400, 0.7);
  // audio-clock time -> sample number, from the marks (least-squares line)
  const M = L.marks, k = M.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const [s, t] of M) { sx += t; sy += s; sxx += t * t; sxy += t * s; }
  const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx), icpt = (sy - slope * sx) / k;
  print(`audio: ${(n / sr).toFixed(1)} s, sample clock ${slope.toFixed(0)} Hz (expected ${sr})`);
  let poll = 0; frames = L.frames.map(fr => {
    const e = Math.min(n, Math.round(icpt + slope * fr.t)), w = y.subarray(Math.max(0, e - 2048), e);
    if (w.length < 2048) return { t: fr.t, rms: 0, f: -1 };
    const W = Math.round(sr * 0.02); let s = 0; for (let i = w.length - W; i < w.length; i++) s += w[i] * w[i];
    return { t: fr.t, rms: Math.sqrt(s / W), f: (poll++ % 4 === 0) ? muDetectPitch(w, sr, typeof GR_MIN_RMS !== 'undefined' ? GR_MIN_RMS : 0.012, GR_PITCH_OPTS).f : -1 };
  });
}
const r = grAnalyze(frames, L.exp, L.q, L.T0, L.end, L.gradePitch, L.lat);
const nm = m => m == null ? '—' : grName(m) + (Math.abs(m - Math.round(m)) > 0.05 ? (m > Math.round(m) ? '+' : '') + Math.round((m - Math.round(m)) * 100) + '¢' : '');
print(`${L.when}  ${L.mode} ${JSON.stringify(L.settings)}  avDelay ${L.avDelay}  lat ${L.lat?.toFixed(3)}`);
print(`app said : rhythm ${L.result.rhythmPct}%  pitch ${L.result.pitchPct}%  offset ${L.result.offsetMs}ms  heard ${L.result.diag.heard}  extra ${L.result.extra}`);
print(`replay   : rhythm ${r.rhythmPct}%  pitch ${r.pitchPct}%  offset ${r.offsetMs}ms${r.latUsed ? ' (vs beat)' : ''}  heard ${r.diag.heard}  extra ${r.extra}  thr ${r.diag.thr} peak ${r.diag.peak} floor ${r.diag.floor}`);
r.notes.forEach((n, i) => { const e = L.exp[i];
  print(`  bar ${n.bar} note ${n.idx}  written ${nm(n.written).padEnd(6)} @${(L.T0 + e.t * L.q).toFixed(2)}  ${n.status.padEnd(7)} heard ${n.match ? n.match.t.toFixed(2) + ' ' + nm(n.match.midi) : '—'}  ${n.errMs ?? ''}ms ${n.pitch ?? ''} ${n.cents ?? ''}`); });
