// usage: jsc test.js -- <music.js> <grade.js> <label>
const [MUSIC, GRADE, LABEL] = arguments;
var window = this; var document = { addEventListener(){}, getElementById(){ return null; } };
load(MUSIC); load(GRADE);
print('==== ' + LABEL);
// ---- A. pitch detector
const SR = 48000;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const voice = (hz, amp = 0.3) => { const b = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const t = i / SR; b[i] = amp * (Math.sin(2*Math.PI*hz*t) + 0.5*Math.sin(2*Math.PI*2*hz*t+1) + 0.25*Math.sin(2*Math.PI*3*hz*t+2)) / 1.75 + 0.01*rnd(); } return b; };
const noise = () => { const b = new Float32Array(2048); for (let i = 0; i < 2048; i++) b[i] = 0.3 * rnd(); return b; };
const opts = typeof GR_PITCH_OPTS !== 'undefined' ? GR_PITCH_OPTS : {};
for (const hz of [98, 220, 440, 880]) print(`detector ${hz} Hz voice -> ${muDetectPitch(voice(hz), SR, 0.012, opts).f.toFixed(1)}`);
let noisy = 0; for (let k = 0; k < 50; k++) if (muDetectPitch(noise(), SR, 0.012, opts).f > 0) noisy++;
print(`detector white noise: ${noisy}/50 frames given a pitch`);
// ---- B. analyzer on synthetic performances
const q = 0.5, T0 = 1.0;
const writ = [[0,1,60],[1,1,62],[2,1,64],[3,1,65],[4,.5,67],[4.5,.5,64],[5,1,72],[6,2,60]]; // C D E F G E C' C
const exp = writ.map(([t, len, midi], i) => ({ t, len, midi, bar: 1 + Math.floor(t / 4), idx: i + 1 }));
function perform({ delay = 0.2, transpose = 3, legato = true, octaveAt = -1, cough = false, scoop = 0, flatDrift = 0 } = {}) {
  const fr = []; let poll = 0;
  const end = T0 + 8 * q + 0.8;
  for (let t = T0 - 0.3; t <= end; t += 0.01) {
    const pos = (t - T0 - delay) / q;
    const k = exp.findIndex(e => pos >= e.t && pos < e.t + e.len);
    let rms = 0.0015 + 0.0005 * Math.abs(rnd()), f = -1;
    if (k >= 0) {
      const e = exp[k], into = (pos - e.t) * q, left = (e.t + e.len - pos) * q;
      const gap = !legato && left < 0.04;
      if (!gap) {
        rms = 0.08 + 0.01 * rnd();
        let m = e.midi + transpose + (k === octaveAt ? -12 : 0) - flatDrift * (k / exp.length);
        if (into < 0.06) m -= scoop;
        if (poll % 4 === 0) f = 440 * Math.pow(2, (m - 69 + 0.1 * rnd()) / 12);
      }
    }
    if (cough && Math.abs(t - (T0 + 2.6)) < 0.006) rms = 1.0;
    poll++;
    fr.push({ t, rms, f });
  }
  return { fr, end };
}
function run(name, p, lat = 0.2) {
  const { fr, end } = perform(p);
  const r = grAnalyze(fr, exp, q, T0, end, true, lat);
  const bad = r.notes.filter(n => n.status !== 'ok').map(n => `${n.idx}:${n.status}${n.pitch && n.pitch !== 'ok' ? '/' + n.pitch : ''}`).join(' ');
  print(`${name.padEnd(34)} rhythm ${String(r.rhythmPct).padStart(3)}%  pitch ${String(r.pitchPct).padStart(3)}%  offset ${r.offsetMs}ms${r.latUsed ? ' (vs beat)' : ''}  heard ${r.diag.heard}  ${bad}`);
}
run('clean, legato, up a m3', {});
run('detached notes', { legato: false });
run('note 7 sung an octave low', { octaveAt: 6 });
run('cough spike mid-phrase', { cough: true });
run('scoops 1 semitone into each note', { scoop: 1 });
run('drifts 0.8 semitone flat', { flatDrift: 0.8 });
run('drags whole example by 120 ms', { delay: 0.32 });
run('no latency setting (null)', { delay: 0.32 }, null);
run('drags whole example by 250 ms', { delay: 0.45 });
run('rushes whole example by 100 ms', { delay: 0.1 });
run('speaker setting way off (lat 0.6)', {}, 0.6);
run('speaker setting 0 (true 0.2)', {}, 0);
run('no setting, on time-ish', {}, null);
