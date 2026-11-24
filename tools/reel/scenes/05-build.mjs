import * as L from '../lib.mjs';
export const meta = { seconds: 8 };
// Quicker click than L.click (shorter glide) so the 8s budget holds; still a visible cursor move + ripple.
async function fast(R, sel, txt, pause = 150) {
  const el = await L.find(R, sel, txt); await el.evaluate(e => e.scrollIntoView({ block: 'nearest' }));
  const [x, y] = await L.center(R, el); await L.glide(R, x, y, 9); await L.sleep(60);
  await R.page.mouse.down(); await L.sleep(50); await R.page.mouse.up(); await L.sleep(pause);
}
// Build mode: the teacher drops in a syncopation, closes the tools, and the usual Play / Grade / Metronome controls work on it.
export async function run(R, ctx) {
  await L.stage(R, 'Sight Reading');
  await L.cap(R, 'Build exercises that target one skill', 0);
  await fast(R, '[data-sr=mode]', 'Build', 350);
  await fast(R, '[data-sr=settings]', 'Settings', 350);
  await fast(R, '[data-sr=badd][data-id=syn]', null, 250);
  await fast(R, '[data-sr=bsyl][data-d="4"]', null, 250);
  await fast(R, '[data-sr=badd][data-id=h]', null, 250);
  await fast(R, '[data-sr=badd][data-id=syn]', null, 250);
  await fast(R, '[data-sr=badd][data-id=h]', null, 250);
  await fast(R, '[data-sr=settings]', 'Settings', 700);
  await L.shot(R, ctx, 'built');
  await fast(R, '[data-sr=play]', null, 1000);
  await L.shot(R, ctx, 'playing');
  await L.cap(R, '', 200);
  await L.jsClick(R, '[data-sr=play]'); await L.sleep(100);
  await L.jsClick(R, '[data-sr=mode]', 'Solfege'); await L.sleep(100);
}
