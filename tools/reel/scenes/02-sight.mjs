import * as L from '../lib.mjs';
import { fakeGradeSight, clearFakeGrade } from '../fakegrade.mjs';
export const meta = { seconds: 11 };
export async function run(R, ctx) {
  await L.click(R, '[data-action=stage]', 'Sight Reading', { pause: 500 });
  await L.cap(R, 'Full sight-reading generation and grading, no internet needed');
  await L.click(R, '[data-sr="new"]', null, { pause: 500 });
  await L.click(R, '[data-sr="new"]', null, { pause: 600 });
  await L.click(R, '[data-sr="play"]', null, { pause: 1400 });
  await L.shot(R, ctx, 'b-playing');
  await L.click(R, '[data-sr="play"]', null, { pause: 300 });
  await L.click(R, '[data-sr="grade"]', null, { pause: 800 });
  await L.shot(R, ctx, 'c-menu');
  await R.page.keyboard.press('Escape'); await L.sleep(150);
  await R.page.evaluate(() => document.querySelector('.sr-grmenu')?.remove());
  await L.cap(R, '');                       // the caption would sit on top of the report card
  await fakeGradeSight(R, { mistakes: 'few' });
  await L.sleep(2000);
  await L.shot(R, ctx, 'd-result');
  await clearFakeGrade(R);
}
