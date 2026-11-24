// Brisker visible click than L.click (shorter glide / settle) so tight scenes fit their budget.
import * as L from '../lib.mjs';
export async function fclick(R, sel, txt, pause = 350) {
  const el = await L.find(R, sel, txt); const [x, y] = await L.center(R, el);
  await L.glide(R, x, y, 12); await L.sleep(60);
  await R.page.mouse.down(); await L.sleep(50); await R.page.mouse.up(); await L.sleep(pause);
}
