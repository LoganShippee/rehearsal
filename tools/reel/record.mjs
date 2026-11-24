// Record the whole video:  node record.mjs [--url=...]   ->  out/rehearsal-tour.mp4 (+ poster)
import * as L from './lib.mjs'; import { seed } from './seed.mjs'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const url = (process.argv.find(a => a.startsWith('--url=')) || '--url=http://localhost:8765/').slice(6);
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const files = fs.readdirSync('scenes').filter(f => f.endsWith('.mjs')).sort().filter(f => !only || only.split(',').some(o => f.startsWith(o)));
fs.mkdirSync('out', { recursive: true }); fs.mkdirSync('shots-final', { recursive: true });
const R = await L.start({ out: 'frames', record: true });
R.page.on('pageerror', e => console.log('PAGEERROR', e.message));
await seed(R, url);
await L.sleep(500); R.startRec();
const t0 = Date.now(); let i = 0;
for (const f of files) {
  const mod = await import(path.resolve('scenes', f));
  const s = Date.now();
  try { if (mod.meta?.advance !== false && i > 0) await L.nextStep(R); await mod.run(R, { shots: 'shots-final', url }); }
  catch (e) { console.log(`SCENE ${f} FAILED:`, e.message); await L.shot(R, { shots: 'shots-final' }, 'FAILED-' + f).catch(() => { }); }
  await L.cap(R, '', 0); console.log(`${f}: ${((Date.now() - s) / 1000).toFixed(1)}s (t=${((Date.now() - t0) / 1000).toFixed(0)}s)`); i++;
}
R.stopRec(); await R.browser.close();
execFileSync('./encode', ['frames', 'out/rehearsal-tour.mp4', '1280x800', '30'], { stdio: 'inherit' });
