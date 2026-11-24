import * as L from '../lib.mjs';
import { fclick } from '../assets/03-04-fast.mjs';
export const meta = { seconds: 7, advance: false };
const mode = (R, v, p) => fclick(R, `[data-sr=mode][data-v=${v}]`, null, p);
const tog = (R, k, p) => fclick(R, `[data-sr=${k}]`, null, p);
export async function run(R, ctx) {
  await L.cap(R, 'Toggle what students see in one tap');
  await fclick(R, '[data-action=stage]', 'Sight Reading', 200);
  await mode(R, 'rhythm', 330);
  await tog(R, 'counts', 330);
  await mode(R, 'solfege', 330);
  await tog(R, 'show', 380);
  await tog(R, 'rhyonly', 380);
  await tog(R, 'rhyonly', 300);
  await tog(R, 'settings', 750);
  await tog(R, 'settings', 250);
  await mode(R, 'rhythm', 330);
  await L.cap(R, '', 200);
}
