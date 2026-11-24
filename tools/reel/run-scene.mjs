// Develop ONE scene on its own:  node run-scene.mjs scenes/02-sight.mjs [--record] [--url=http://localhost:8765/]
// Starts from the seeded Choir home screen (clock 8:10, agenda at step 1). Screenshots go to $SHOTS (default ./shots-<scene>/).
import * as L from './lib.mjs'; import { seed } from './seed.mjs'; import path from 'node:path'; import fs from 'node:fs';
const file = process.argv[2]; const rec = process.argv.includes('--record');
const url = (process.argv.find(a => a.startsWith('--url=')) || '--url=http://localhost:8765/').slice(6);
const name = path.basename(file, '.mjs'); const shots = process.env.SHOTS || `shots-${name}`; fs.mkdirSync(shots, { recursive: true });
const mod = await import(path.resolve(file));
const R = await L.start({ out: `frames-${name}`, record: rec });
R.page.on('pageerror', e => console.log('PAGEERROR', e.message));
await seed(R, url);
const t0 = Date.now(); if (rec) R.startRec();
try { await mod.run(R, { shots, url }); } catch (e) { console.log('SCENE FAILED:', e.stack || e); await L.shot(R, { shots }, 'FAILED').catch(() => { }); }
console.log(`scene ${name} took ${((Date.now() - t0) / 1000).toFixed(1)}s (target ${mod.meta?.seconds ?? '?'}s)`);
if (rec) { R.stopRec(); console.log('frames in', `frames-${name}`, R.frames.length); }
await R.browser.close();
