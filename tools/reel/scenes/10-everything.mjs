// Scene 10: everything else (floating tools), then annotation on a PDF and on a playing score.
import * as L from '../lib.mjs';
import path from 'node:path';
const A = f => path.resolve(import.meta.dirname, '../assets', f);
export const meta = { seconds: 18 };

const sleep = L.sleep;
// Click a control that opens the native file chooser: click it visibly and hand the chooser our file.
async function clickChoose(R, sel, txt, file) {
  const chooser = R.page.waitForFileChooser({ timeout: 8000 });
  await fc(R, sel, txt, { pause: 100 });
  const c = await chooser; await c.accept([file]);
}
// A real mouse drag along absolute page points.
async function draw(R, pts, step = 4) {
  await L.glide(R, pts[0][0], pts[0][1], 8); await R.page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    for (let s = 1; s <= step; s++) { await R.page.mouse.move(x0 + (x1 - x0) * s / step, y0 + (y1 - y0) * s / step); await sleep(6); }
  }
  await R.page.mouse.up(); R.mx = pts[pts.length - 1][0]; R.my = pts[pts.length - 1][1]; await sleep(100);
}
const ellipse = (cx, cy, rx, ry, n = 16) => Array.from({ length: n + 2 }, (_, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
async function waitFor(R, sel, txt, ms = 8000) {
  const t = Date.now();
  for (;;) { try { return await L.find(R, sel, txt); } catch (e) { if (Date.now() - t > ms) throw e; await sleep(100); } }
}
// Same as L.click (visible cursor glide + real click) but a shorter glide so the pacing stays brisk.
async function fc(R, sel, txt, { pause = 300, steps = 14 } = {}) {
  const el = await waitFor(R, sel, txt); await el.evaluate(e => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const [x, y] = await L.center(R, el); await L.glide(R, x, y, steps); await sleep(90);
  await R.page.mouse.down(); await sleep(50); await R.page.mouse.up(); await sleep(pause);
}
const openMenu = R => fc(R, '[data-action=win-menu]', null, { pause: 300 });
const tab = (R, label) => fc(R, '[data-action=stage]', label, { pause: 450 });
const T0 = Date.now(); const mark = m => process.env.REEL_DEBUG && console.log(m, ((Date.now() - T0) / 1000).toFixed(1));

export async function run(R, ctx) {
  const P = R.page;
  P.on('dialog', d => d.accept().catch(() => { }));   // "Clear all?" confirms
  // ---------- 1. other tools, as floating windows ----------
  await L.cap(R, 'And everything else, built in', 0);
  await openMenu(R);
  await fc(R, '.win-menu [data-action=wm-cal]', null, { pause: 900 });
  await fc(R, '#p-dock [data-action=wm-piano]', null, { pause: 1000 });
  await L.shot(R, ctx, '10-windows'); mark('windows');
  await P.evaluate(() => { A['wm-closeall'](); if (P.winMenu) { P.winMenu = false; renderWinMenu(); renderDock(); } });   // hidden plumbing

  // ---------- 2. annotate on a PDF ----------
  await L.cap(R, 'Annotate right on PDFs…', 0);
  await tab(R, 'Files');
  await clickChoose(R, '[data-fb=add]', null, A('10-sample.pdf'));
  await waitFor(R, '[data-fb=open]', 'sample'); await sleep(250);
  await fc(R, '[data-fb=open]', 'sample', { pause: 300 });
  await waitFor(R, 'svg.pdfv-ink'); await sleep(300); mark('pdf open');
  await fc(R, '[data-pdf=annot]', null, { pause: 250 });
  await fc(R, '[data-pdfa=size][data-v="2"]', null, { pause: 150 });
  const pg = await P.evaluate(() => { const r = document.querySelector('svg.pdfv-ink').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const at = (fx, fy) => [pg.x + pg.w * fx, pg.y + pg.h * fy];
  await draw(R, ellipse(...at(0.18, 0.215), pg.w * 0.15, pg.h * 0.03));                          // circle the opening words
  await draw(R, [at(0.26, 0.33), at(0.32, 0.34), at(0.38, 0.33), at(0.45, 0.34)], 4);           // underline
  await fc(R, '[data-pdfa=tool][data-v=hl]', null, { pause: 100 });
  await fc(R, '[data-pdfa=color][data-v="#f2c230"]', null, { pause: 100 });
  await draw(R, [at(0.09, 0.525), at(0.40, 0.525), at(0.72, 0.525)], 8);                         // highlight a note
  await L.shot(R, ctx, '10-pdf-drawn'); mark('pdf drawn'); await sleep(500);
  await P.evaluate(() => { document.querySelector('[data-pdfa=clearall]')?.click(); });
  await P.evaluate(() => document.querySelector('[data-pdfa=done]')?.click());
  await P.evaluate(() => document.querySelector('[data-fb=back]')?.click());

  // ---------- 3. annotate on top of live playback ----------
  await L.cap(R, '…and on top of live playback', 0);
  await tab(R, 'Score Practice');
  const needScore = await P.evaluate(() => [...document.querySelectorAll('[data-sp=addscore]')].some(b => b.offsetParent && b.innerText.includes('Choose score')));
  if (needScore) {
    await clickChoose(R, '[data-sp=addscore]', 'Choose score', A('10-ode.musicxml'));
    await waitFor(R, '#stage-content svg:not(.ico)', null, 12000); await sleep(700);
  }
  mark('score');
  await L.jsClick(R, '[data-sp=playhead]', 'Off');   // hidden plumbing: show the glide playhead so playback is visible
  await fc(R, '[data-sp=play]', 'Play', { pause: 1300 });                       // live playback
  await fc(R, '[data-action=ink-toggle]', null, { pause: 300 });               // annotate on top
  await P.select('[data-action-change=ink-size]', '8');
  await draw(R, ellipse(800, 492, 98, 42));
  await L.shot(R, ctx, '10-score-drawn'); mark('score drawn'); await sleep(500);
  await fc(R, '[data-action=ink-clear]', null, { pause: 350 });
  await fc(R, '[data-action=ink-toggle]', null, { pause: 300 });
  await fc(R, '[data-sp=play]', null, { pause: 300 });                          // stop playback
  mark('end');
  await L.cap(R, '', 200);
}
