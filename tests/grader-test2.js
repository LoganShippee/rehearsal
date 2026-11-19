// usage: jsc test2.js -- <music.js> <grade.js> <label>
const [MUSIC, GRADE, LABEL] = arguments;
var window = this; var document = { addEventListener(){}, getElementById(){ return null; } };
load(MUSIC); load(GRADE);
print('==== ' + LABEL);
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const q = 0.5, T0 = 1.0;
const mk = w => w.map(([t, len, midi], i) => ({ t, len, midi, bar: 1 + Math.floor(t / 4), idx: i + 1 }));
const MEL = {
  steps:  mk([[0,1,60],[1,1,62],[2,1,64],[3,1,65],[4,.5,67],[4.5,.5,64],[5,1,72],[6,2,60]]),
  repeat: mk([[0,1,60],[1,1,60],[2,1,62],[3,1,62],[4,.5,64],[4.5,.5,64],[5,1,64],[6,2,60]]),
  long:   mk([...Array(16)].map((_, i) => [i, 1, [60,62,64,65,67,65,64,62,60,64,67,72,71,69,67,60][i]])),
};
function perform(exp, { delay = 0.2, transpose = 3, legato = true, octaveAt = -1, cough = false, scoop = 0, flatDrift = 0,
                        dip = 0, jitter = 0, vibrato = 0, wrongAt = [], wrongBy = 0, wrongRun = null } = {}) {
  const fr = []; let poll = 0;
  const end = T0 + (exp.at(-1).t + exp.at(-1).len) * q + 0.8;
  for (let t = T0 - 0.3; t <= end; t += 0.01) {
    const pos = (t - T0 - delay) / q;
    const k = exp.findIndex(e => pos >= e.t && pos < e.t + e.len);
    let rms = 0.0015 + 0.0005 * Math.abs(rnd()), f = -1;
    if (k >= 0) {
      const e = exp[k], into = (pos - e.t) * q, left = (e.t + e.len - pos) * q;
      if (!(!legato && left < 0.04)) {
        rms = 0.08 * (1 + jitter * 2 * rnd()) * (1 + vibrato * 0.5 * Math.sin(2 * Math.PI * 5.5 * t));
        if (dip && k > 0 && into < 0.05) rms *= dip;               // consonant at the start of each note ("do", "re")
        let m = e.midi + transpose + (k === octaveAt ? -12 : 0) - flatDrift * (k / exp.length);
        if (wrongAt.includes(k)) m += wrongBy;
        if (wrongRun && k >= wrongRun[0] && k <= wrongRun[1]) m += 1;
        if (into < 0.06) m -= scoop;
        m += vibrato * Math.sin(2 * Math.PI * 5.5 * t);
        if (poll % 4 === 0 && !(dip && k > 0 && into < 0.05)) f = 440 * Math.pow(2, (m - 69 + 0.1 * rnd()) / 12);
      }
    }
    if (cough && Math.abs(t - (T0 + 2.6)) < 0.006) rms = 1.0;
    poll++;
    fr.push({ t, rms, f });
  }
  return { fr, end };
}
function run(name, mel, p = {}, lat = 0.2) {
  const exp = MEL[mel], { fr, end } = perform(exp, p);
  const r = grAnalyze(fr, exp, q, T0, end, true, lat);
  const bad = r.notes.filter(n => n.status !== 'ok').map(n => `${n.idx}:${n.status}${n.pitch && n.pitch !== 'ok' ? '/' + n.pitch : ''}`).join(' ');
  const drift = r.driftCents != null ? `drift ${r.driftCents}¢` : '';
  print(`${name.padEnd(38)} R ${String(r.rhythmPct).padStart(3)}  P ${String(r.pitchPct).padStart(3)}  heard ${String(r.diag.heard).padStart(2)}/${exp.length} extra ${r.extra} ${drift}  ${bad}`);
}
run('clean steps', 'steps');
run('detached', 'steps', { legato: false });
run('octave low on note 7', 'steps', { octaveAt: 6 });
run('cough', 'steps', { cough: true });
run('scoops', 'steps', { scoop: 1 });
run('drift 0.8 flat (8 notes)', 'steps', { flatDrift: 0.8 });
run('drift 1.0 flat (16 notes)', 'long', { flatDrift: 1.0 });
run('drift 1.0 flat + note 10 wrong by 2', 'long', { flatDrift: 1.0, wrongAt: [9], wrongBy: 2 });
run('16 notes, notes 6-10 a semitone sharp', 'long', { wrongRun: [5, 9] });
run('wrong by 1 on notes 3,5', 'steps', { wrongAt: [2, 4], wrongBy: 1 });
run('repeated notes, consonant dip 30%', 'repeat', { dip: 0.3 });
run('repeated notes, consonant dip 50%', 'repeat', { dip: 0.5 });
run('repeated notes, no dip (pure legato)', 'repeat', {});
run('repeated notes, detached', 'repeat', { legato: false });
run('steps, loudness jitter 20%', 'steps', { jitter: 0.2 });
run('steps, vibrato 0.3 st + tremolo', 'steps', { vibrato: 0.3, jitter: 0.1 });
run('long, dip 30% + jitter + vibrato', 'long', { dip: 0.3, jitter: 0.15, vibrato: 0.25 });
run('octave low on note 7, consonants', 'steps', { octaveAt: 6, dip: 0.3 });
run('wrong by 1 on notes 3,5, consonants', 'steps', { wrongAt: [2, 4], wrongBy: 1, dip: 0.3 });
run('long, heavy tremolo 40% no dips', 'long', { vibrato: 0.4, jitter: 0.25 });
