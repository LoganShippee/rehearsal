import * as L from '../lib.mjs';
import { armFakeScoreGrade, clearFakeScoreGrade } from '../fakegrade.mjs';
// ~10s of action + ~3.5s fake grading feedback
export const meta = { seconds: 13 };
const MXL = '/Users/loganshippee/Rehearsal/web/demo/ode-to-joy.mxl';
export async function run(R, ctx) {
  const P = R.page, sleep = L.sleep;
  await L.stage(R, 'Score Practice');
  await P.waitForSelector('.sp-root [data-sp=play]', { visible: true, timeout: 10000 });
  // Load the sample score if the stage is empty (plumbing, no cursor needed)
  if (!(await P.evaluate(() => !!document.querySelector('.sp-score svg:not(.ico)')))) {
    const [fc] = await Promise.all([P.waitForFileChooser(), P.evaluate(() => document.querySelector('.sp-root [data-sp=addscore]')?.click())]);
    await fc.accept([MXL]);
  }
  await P.waitForSelector('.sp-score svg:not(.ico)', { visible: true, timeout: 20000 });
  // Skip the count-in so playback starts right away (plumbing), and make sure nothing is left playing
  await P.evaluate(() => {
    const q = s => document.querySelector('.sp-root ' + s);
    q('[data-sp=settings]')?.click();   // settings form is only built while open
    const s = q('select[data-spk=countIn]'); if (s) { s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    q('[data-sp=settings]')?.click();
    const p = q('[data-sp=play]'); if (p && /Stop/i.test(p.innerText)) p.click();
    // moving playhead on (glides on the beat)
    if (/Off/i.test(q('[data-sp=playhead]')?.innerText || '')) q('[data-sp=playhead]').click();
  });
  await L.cap(R, 'Rehearse with ease');
  await sleep(250);

  // 1. drag across measures 3-6 to choose the spot, then turn the loop on
  const y = 495;
  await L.glide(R, 600, y, 14); await sleep(60);
  await P.mouse.down(); await sleep(50);
  for (let i = 1; i <= 10; i++) { await P.mouse.move(600 + i * 21, y + (i % 2)); await sleep(20); }
  await P.mouse.up(); R.mx = 810; R.my = y; await sleep(250);
  await L.click(R, '[data-sp=loop]', null, { pause: 250 });

  // 2. slow it down
  await L.click(R, '[data-sp=tempo-step][data-d="-5"]', null, { pause: 100 });
  await L.click(R, '[data-sp=tempo-step][data-d="-5"]', null, { pause: 250 });

  // 3. solo the melody
  await L.click(R, '[data-sp=solo]', null, { pause: 250 });

  // 4. play: the cursor follows the music around the loop
  await L.click(R, '[data-sp=play]', null, { pause: 2300 });
  await L.shot(R, ctx, 'e-play');

  // 5. stop, then grade: a click on the real Grade button; the feedback is built from a synthetic sung take
  await armFakeScoreGrade(R, { mistakes: 'few', takeMs: 600 });
  await L.click(R, '[data-sp=play]', null, { pause: 150 });
  await L.cap(R, 'Grade the part you sing', 0);
  await L.click(R, '[data-sp=grade]', null, { pause: 1500 });   // button shows "Stop & grade", then the colours + report card appear
  await L.cap(R, '');
  await sleep(1100);
  await L.shot(R, ctx, 'e-grade');

  // leave clean: card and coloured notes off, real handler back
  await clearFakeScoreGrade(R);
  await L.cap(R, '', 250);
}
