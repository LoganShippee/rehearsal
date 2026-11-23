// Real practice takes, re-graded and compared with the approved baseline in
// tests/fixtures/takes/takes.json, using the two-tier rule in docs/feature-registry.md:
//   - any score change at all is listed as a warning;
//   - FAIL if a score moved more than 2 points, or moved at all while the grading code
//     (web/grade.js + web/music.js) is unchanged since the baseline was approved
//     (same recording + same code must give the same score);
//   - always compared with the one approved baseline, never the last run, so small
//     changes can't add up unnoticed.
// usage: jsc tests/grader-takes-test.js -- web/music.js web/grade.js grader-takes-test [print]
//   "print" shows the current scores as a new baseline to paste in, once Logan approves them.
const [MUSIC, GRADE, LABEL, MODE] = arguments;
var window = this; var document = { addEventListener(){}, getElementById(){ return null; } };
load(MUSIC); load(GRADE);
print('==== ' + LABEL);

const DIR = 'tests/fixtures/takes/';
const M = JSON.parse(readFile(DIR + 'takes.json'));
// FNV-1a: a fingerprint of the grading code, so the test knows whether it changed
let h = 0x811c9dc5;
for (const ch of readFile(GRADE) + '\u0000' + readFile(MUSIC)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
const codeHash = h.toString(16).padStart(8, '0');
const codeSame = codeHash === M.gradingCodeHash;

const now = [], warnings = [], failures = [];
for (const t of M.takes) {
  const L = JSON.parse(readFile(DIR + t.file));
  const r = grAnalyze(L.frames, L.exp, L.q, L.T0, L.end, L.gradePitch, L.lat, null, M.strictness);
  const got = { rhythmPct: r.rhythmPct, pitchPct: r.pitchPct };
  now.push({ ...t, baseline: got });
  for (const k of ['rhythmPct', 'pitchPct']) {
    const was = t.baseline[k], is = got[k];
    if (was === is) continue;
    const d = (was == null || is == null) ? Infinity : Math.abs(is - was);
    const line = `${t.file} ${k}: ${was} -> ${is}`;
    warnings.push(line);
    if (d > 2) failures.push(`${line} (moved more than 2 points)`);
    else if (codeSame) failures.push(`${line} (grading code unchanged, so this should not move)`);
  }
}

print(`grading code fingerprint ${codeHash} (${codeSame ? 'same as' : 'CHANGED since'} the approved baseline)`);
for (const t of now) print(`  ${t.file.padEnd(30)} rhythm ${String(t.baseline.rhythmPct).padStart(3)}  pitch ${String(t.baseline.pitchPct).padStart(4)}${t.issue ? '   [known issue]' : ''}`);
if (warnings.length) { print(`WARNING: ${warnings.length} score change(s) from the approved baseline:`); warnings.forEach(w => print('  ' + w)); }
if (MODE === 'print') print('\nNew baseline (paste into takes.json only after Logan approves):\n' + JSON.stringify({ gradingCodeHash: codeHash, takes: now.map(t => ({ file: t.file, baseline: t.baseline })) }, null, 1));
if (failures.length) {
  print(`FAIL: ${failures.length} change(s) need Logan's review:`); failures.forEach(f => print('  ' + f));
  throw new Error('grader-takes-test failed');
}
print(`grader-takes-test: ${M.takes.length} takes match the approved baseline${warnings.length ? ' within tolerance (see warnings)' : ''}`);
