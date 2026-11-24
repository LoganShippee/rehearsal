import * as L from '../lib.mjs';
export const meta = { seconds: 9, advance: false };
// Smoothly scroll the side panel so an element sits near the top (or at a given offset).
const reveal = (R, sel, txt, off = 16) => R.page.evaluate((sel, txt, off) => {
  const e = [...document.querySelectorAll(sel)].find(x => !txt || x.innerText.includes(txt)); if (!e) return false;
  let p = e.parentElement; while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
  if (p) p.scrollTo({ top: e.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - off, behavior: 'smooth' });
  return true;
}, sel, txt, off);
export async function run(R) {
  const T = Date.now(), lg = m => process.env.DBG && console.log(((Date.now() - T) / 1000).toFixed(1), m);
  if (!(await R.page.evaluate(() => /warmup|warm-up/i.test(document.querySelector('.stage-tab.on, [data-action=stage].on, [data-action=stage].cur')?.innerText || 'warm-up')))) await L.stage(R, 'Warm-up');
  await L.cap(R, 'Edit in seconds'); lg('cap');
  await L.click(R, '[data-action=dock-more]', null, { pause: 200 });
  await L.click(R, '[data-action=edit-mode]', null, { pause: 350 }); lg('edit on');
  // warm-up question: click it, replace the text with something short
  await L.click(R, '[data-ie=warmup], [contenteditable]', 'Hum', { pause: 150 });
  await R.page.evaluate(() => { const e = document.activeElement; if (e && e.isContentEditable) document.getSelection().selectAllChildren(e); });
  await L.type(R, 'Hum low, then slide up.', 16); await L.sleep(300); lg('typed warmup');
  // announcement: scroll the side panel to the add row
  await reveal(R, '[data-ie-evkind]', null, 150); await L.sleep(450);
  await L.click(R, '[data-ie-evtext]', null, { pause: 150 });
  await L.type(R, 'Folders due Friday', 16); await L.sleep(250); lg('typed ann');
  await L.click(R, '[data-action=ie-ev-add]', null, { pause: 600 }); lg('added');
  await reveal(R, '.ie-done', null, 150);
  await L.click(R, '.ie-done', null, { pause: 400 }); lg('done');
  // show the Progress tracker with its coloured lights
  await reveal(R, '.p-card', 'PROGRESS', 110); await L.sleep(1000);
  await L.cap(R, '', 100);
  lg('end');
}
