const [MUSIC, GRADE] = arguments;
var window = this; var document = { addEventListener(){}, getElementById(){ return null; } };
load(MUSIC); load(GRADE);
const q = 0.5, T0 = 2.0;
// q q 8 8 q | h q-rest(skip) q
const writ = [[0,1],[1,1],[2,.5],[2.5,.5],[3,1],[4,2],[7,1]];
const exp = writ.map(([t, len], i) => ({ t, len, midi: 60, bar: 1 + Math.floor(t / 4), idx: i + 1 }));
const end = T0 + 8 * q + 0.8;
let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
function run(label, taps) {
  const r = grAnalyze([], exp, q, T0, end, true, null, taps);
  print(`${label.padEnd(40)} R ${String(r.rhythmPct).padStart(3)}  pitch ${r.pitchPct}  offset ${r.offsetMs}ms  extra ${r.extra}  ` + r.notes.map((n, i) => n.status !== 'ok' ? `${i + 1}:${n.status}${n.errMs != null ? '(' + n.errMs + ')' : ''}` : '').filter(Boolean).join(' '));
}
const on = (d = 0, j = 0) => writ.map(([t]) => T0 + t * q + d + j * rnd());
run('perfect', on());
run('steady 90 ms late + 20 ms jitter', on(0.09, 0.04));
run('count-in taps + perfect', [T0 - 2, T0 - 1.5, T0 - 1, T0 - 0.5, ...on()]);
run('note 4 missed', on().filter((_, i) => i !== 3));
run('note 5 tapped 150 ms late', on().map((t, i) => i === 4 ? t + 0.15 : t));
run('extra tap on the rest (beat 7)', [...on(), T0 + 6 * q]);
run('no taps', []);
