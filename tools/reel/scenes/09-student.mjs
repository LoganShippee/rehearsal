import * as L from '../lib.mjs';
import { armFakeScoreGrade, clearFakeScoreGrade } from '../fakegrade.mjs';
// ~9.5s of real content + ~3.5s fake grading feedback (total ~12-13s).
export const meta = { seconds: 12 };
export async function run(R, ctx) {
  await R.openTab('http://localhost:8765/hw.html?demo=1&auto=1');
  await R.page.waitForSelector('.hw-asgn-card .hw-btn');
  await L.cap(R, 'Then see what students see', 1700);
  // Open the Ode to Joy score assignment (titled "Vocal Part Check-In") with a visible click.
  await R.page.evaluate(() => { const c = [...document.querySelectorAll('.hw-asgn-card')].find(x => x.innerText.includes('Vocal Part Check-In')); c.querySelector('.hw-btn').setAttribute('data-reel', 'ode'); });
  await L.click(R, '[data-reel=ode]', null, { pause: 900 });
  await R.page.waitForSelector('.hw-back-btn'); await R.page.waitForSelector('.hw-btn-go');
  await L.cap(R, '', 100);
  await L.shot(R, ctx, 'runner');
  await L.sleep(1200);
  // Cursor drifts along the score so viewers read it (the page doesn't scroll; the whole score fits).
  await L.glide(R, 330, 500, 22); await L.glide(R, 980, 520, 40); await L.sleep(400);
  // The student sings: a visible click on the real "Sing it" button; the feedback comes from a synthetic take.
  await armFakeScoreGrade(R, { mistakes: 'few', takeMs: 600 });
  await L.click(R, '#hw-sp-grade', null, { pause: 1500 });   // "Stop & grade", then colours + report card
  await L.shot(R, ctx, 'graded');
  await L.sleep(1300);
  await clearFakeScoreGrade(R);
  await L.click(R, '.hw-back-btn', null, { pause: 800 });
  await R.page.waitForSelector('.hw-asgn-card');
  await L.sleep(200);
  await R.backToMain();
}
