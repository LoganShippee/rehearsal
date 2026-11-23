// Sight Reading generator tests. Uses srSeed(n) so the same number always builds the same
// exercise (the app itself never seeds, so teachers always get a new exercise).
// usage: jsc tests/sight-test.js -- web/sight.js sight-test
const [SIGHT, LABEL] = arguments;
var window = this; var document = { addEventListener(){}, getElementById(){ return null; } };
load(SIGHT);
print('==== ' + LABEL);

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) passed++;
  else { failed++; if (failed <= 20) print('FAIL: ' + msg); }
}
const J = x => JSON.stringify(x);
const SEEDS = 60;
const beatsQ = ts => SR_METERS[ts][0] * (SR_METERS[ts][1] === 'compound' ? 1.5 : 1);  // measure length in quarters
const sumM = cells => cells.reduce((n, c) => n + c.ev.reduce((a, e) => a + e[1], 0), 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const MAX_LEAP = { step: 1, third: 2, triad: 4, fifth: 4, octave: 7 };

// ---- 1. The seed works, and turning it off goes back to a new exercise every time
srSeed(7); const a1 = J(srGenParts(srDefaults().solfege));
srSeed(7); const a2 = J(srGenParts(srDefaults().solfege));
check(a1 === a2, 'Same seed builds the same exercise');
const many = new Set();
for (let s = 1; s <= 20; s++) { srSeed(s); many.add(J(srGenRhythm('4/4', 4, ['q', 'h', 'ee', 'qr', 'w']))); }
check(many.size >= 15, `Different seeds build different exercises (${many.size}/20 different)`);
srSeed();
check(srRandom === Math.random, 'srSeed() with no number goes back to normal randomness');

// ---- 2. Rhythm: every measure adds up, only chosen rhythms, no rest at the start or in the last measure
for (let s = 1; s <= SEEDS; s++) for (const ts of Object.keys(SR_METERS)) {
  const table = SR_METERS[ts][1] === 'compound' ? SR_COMPOUND : SR_SIMPLE;
  const all = Object.keys(table);
  const pick = all.filter((_, i) => (i + s) % 3 !== 0);       // a different set of chosen rhythms each seed
  srSeed(s);
  const r = srGenRhythm(ts, 6, pick, true);
  check(r.length === 6, `rhythm ${ts} seed ${s}: 6 measures`);
  r.forEach((m, i) => check(near(sumM(m), beatsQ(ts)), `rhythm ${ts} seed ${s} measure ${i + 1} adds up (${sumM(m)} vs ${beatsQ(ts)})`));
  const fallback = SR_METERS[ts][1] === 'compound' ? 'dq' : 'q';
  r.flat().forEach(c => check(pick.includes(c.id) || c.id === fallback, `rhythm ${ts} seed ${s}: '${c.id}' was chosen`));
  check(!r[0][0].ev[0][2], `rhythm ${ts} seed ${s}: does not open with a rest`);
  check(!r[5].some(c => c.ev.some(e => e[2])), `rhythm ${ts} seed ${s}: no rest in the last measure`);
}

// ---- 3. Solfege melody: right number of pitches, in range, starts and ends on do,
//         and no jump bigger than the leap setting outside the last measure
const cellsMel = ['q', 'h', 'w', 'ee', 'qr', 'hd'];
for (let s = 1; s <= SEEDS; s++) for (const range of Object.keys(SR_RANGES)) for (const leap of Object.keys(SR_LEAPS)) {
  const style = ['patterns', 'mixed', 'free'][s % 3], nM = s % 2 ? 4 : 8;
  const o = { ...srDefaults().solfege, range, leap, melodyStyle: style, measures: nM, cells: cellsMel };
  srSeed(s);
  const m = srGenMelody(o);
  const tag = `melody seed ${s} ${range} ${leap} ${style} ${nM}m`;
  const [, lo, hi] = SR_RANGES[range];
  const noteMeasure = [];
  m.rhythm.forEach((cells, k) => cells.forEach(c => c.ev.forEach(e => { if (!e[2]) noteMeasure.push(k); })));
  check(m.rhythm.length === nM, `${tag}: ${nM} measures`);
  m.rhythm.forEach((cells, k) => check(near(sumM(cells), 4), `${tag}: measure ${k + 1} adds up`));
  check(noteMeasure.length === m.pitches.length, `${tag}: one pitch per note`);
  check(m.pitches.every(p => p >= lo && p <= hi), `${tag}: every pitch in range ${J(m.pitches)}`);
  check(m.pitches[0] === 0, `${tag}: starts on do`);
  check(m.pitches[m.pitches.length - 1] % 7 === 0, `${tag}: ends on do`);
  // "Steps only" means steps everywhere. Other settings may use a 3rd where a repeated
  // pattern starts; their last measure isn't checked yet.
  const lim = leap === 'step' ? 1 : Math.max(MAX_LEAP[leap], 2);
  for (let i = 1; i < m.pitches.length; i++) {
    if (leap !== 'step' && noteMeasure[i] === nM - 1) continue;
    check(Math.abs(m.pitches[i] - m.pitches[i - 1]) <= lim, `${tag}: note ${i + 1} jumps more than the setting allows ${J(m.pitches)}`);
  }
}

// ---- 4. Two and three parts (harmony and canon): right number of parts, every measure adds up
for (let s = 1; s <= SEEDS; s++) for (const P of [2, 3]) for (const texture of ['harmony', 'canon']) {
  srSeed(s);
  const ex = srGenParts({ ...srDefaults().solfege, parts: P, texture, measures: 4, cells: cellsMel });
  check(ex.parts && ex.parts.length === P, `${texture} seed ${s}: ${P} parts`);
  (ex.parts || []).forEach((pt, i) => pt.rhythm.forEach((c, k) =>
    check(near(sumM(c), 4), `${texture} seed ${s} part ${i + 1} measure ${k + 1} adds up`)));
}

// ---- 5. Pinned exercises: if any of these change, the generator's output changed.
//         If the change was on purpose, update the expected value here.
const pinned = [
  ['rhythm 4/4 seed 42', () => { srSeed(42); return srGenRhythm('4/4', 4, ['q', 'h', 'ee', 'qr', 'w'], false).map(m => m.map(c => c.id)); },
    [['ee', 'ee', 'qr', 'qr'], ['q', 'ee', 'h'], ['qr', 'qr', 'h'], ['q', 'ee', 'h']]],
  ['rhythm 6/8 seed 42 (ties)', () => { srSeed(42); return srGenRhythm('6/8', 4, Object.keys(SR_COMPOUND), true).map(m => m.map(c => c.id + (c.tie ? '~' : ''))); },
    [['dh'], ['dh~'], ['ssse', 'desse'], ['dh']]],
  ['solfege defaults seed 42', () => { srSeed(42); const e = srGenParts(srDefaults().solfege); return [e.rhythm.map(m => m.map(c => c.id)), e.pitches]; },
    [[['h', 'q', 'q'], ['h', 'q', 'q'], ['h', 'q', 'q'], ['w']], [0, 1, 2, 1, 2, 3, 2, 1, 1, 0]]],
  ['2-part harmony seed 42', () => { srSeed(42); return srGenParts({ ...srDefaults().solfege, parts: 2, measures: 4 }).parts.map(p => p.pitches); },
    [[0, 1, 2, 1, 2, 3, 2, 1, 1, 0], [0, 1, 2, 1, 0, 1, 0, 1, 1, 0]]],
  // (2026-11-23: endings changed on purpose so "Steps only" walks home to do instead of leaping sol→do.)
];
for (const [name, run, want] of pinned) {
  const got = run();
  check(J(got) === J(want), `pinned ${name} changed:\n  expected ${J(want)}\n  got      ${J(got)}`);
}
srSeed();

print(`sight-test: ${passed} passed, ${failed} failed`);
if (failed) throw new Error('sight-test failed');
