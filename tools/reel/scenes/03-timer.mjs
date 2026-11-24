import * as L from '../lib.mjs';
import { fclick } from '../assets/03-04-fast.mjs';
export const meta = { seconds: 6 };
export async function run(R, ctx) {
  await L.cap(R, 'Give students timed practice');
  await fclick(R, '[data-action=stage]', 'Sight Reading', 450);
  await fclick(R, '[data-action=tool]', 'Timer', 450);
  await fclick(R, '[data-action=quick-timer]', '2', 800);
  await L.sleep(2200);   // countdown ticks over the exercise
  await fclick(R, 'button', 'End', 300);
  await L.cap(R, '', 200);
}
