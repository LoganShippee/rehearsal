import * as L from '../lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const meta = { seconds: 10 };
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/08-your-own.mxl');
const sleep = L.sleep;
let intercepting = false;
const T0 = () => Date.now(); const lap = (n, t) => process.env.LAPS && console.log(n, Date.now() - t);
export async function run(R, ctx) {
  const pg = R.page; let t = T0();
  // Never let the assign flow reach the real homework server (requests to api.rehearsalmusic.com are aborted; count is logged).
  if (!intercepting) { intercepting = true; await pg.setRequestInterception(true);
    pg.on('request', rq => { if (/api\.rehearsalmusic\.com/.test(rq.url())) { globalThis.__reelBlocked = (globalThis.__reelBlocked || 0) + 1; rq.abort().catch(() => { }); } else rq.continue().catch(() => { }); }); }
  // Hidden plumbing: the app's built-in local preview mode (sample teacher, no server) so Assign opens the real drawer.
  await pg.evaluate(async () => { window.HW_API_BASE = ''; const a = window.HW_TEACHER_API; await a.emailStart({ email: 'ms.rivera@oakridge.edu' }); await a.emailVerify({ email: 'ms.rivera@oakridge.edu', code: '482913' }); });
  // a nicer score name than the asset filename
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel08-')); const MXL = path.join(dir, 'Amazing Grace.mxl'); fs.copyFileSync(SRC, MXL);
  await L.cap(R, 'Upload your own MXL: same playback and grading.<small>Assign any part.</small>', 0);
  await L.stage(R, 'Score Practice'); lap('stage', t); t = T0();
  const [chooser] = await Promise.all([pg.waitForFileChooser({ timeout: 8000 }), L.click(R, '[data-sp=addscore]', null, { pause: 0 })]);
  await chooser.accept([MXL]);
  await pg.waitForFunction(() => /Amazing Grace/i.test(document.querySelector('.sp-file')?.selectedOptions?.[0]?.text || '') && document.querySelector('.sp-page svg, .sp-page canvas, [class*=sp-] svg'), { timeout: 10000 }).catch(() => { });
  await sleep(300); lap('upload', t); t = T0();
  await L.cap(R, '');
  await L.click(R, '[data-sp=play]', null, { pause: 2300 }); lap('play', t); t = T0();
  await L.shot(R, ctx, 'c-playing');
  // choose which part to assign: the grade menu's "Voice / Part to grade" picker
  await L.click(R, '[data-sp=grade-menu]', null, { pause: 400 });
  await pg.waitForSelector('select[data-spk=gradeLine]', { timeout: 5000 });
  const sel = await L.find(R, 'select[data-spk=gradeLine]');
  const [x, y] = await L.center(R, sel); await L.glide(R, x, y, 16); await sleep(250);
  await pg.select('select[data-spk=gradeLine]', '1');   // Alto (a native dropdown can't be filmed, so set it directly)
  await sleep(500); lap('part', t); t = T0();
  await L.shot(R, ctx, 'c-part');
  await L.jsClick(R, '[data-sp=play]');   // stop playback (hidden)
  await L.cap(R, 'Upload your own MXL: same playback and grading.<small>Assign any part.</small>', 0);
  await L.click(R, '[data-sp=assign]', null, { pause: 500 });
  await pg.waitForSelector('[data-hwt-change=score-file]', { timeout: 8000 });
  await sleep(500); lap('assign', t); t = T0();
  await L.shot(R, ctx, 'd-assign');
  // leave clean
  await L.cap(R, '');
  await L.click(R, 'button', 'Cancel', { pause: 300 });
  await L.shot(R, ctx, 'e-clean');
  console.log('blocked server requests:', globalThis.__reelBlocked || 0);
}
