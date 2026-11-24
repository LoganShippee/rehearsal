import * as L from '../lib.mjs';
export const meta = { seconds: 9, advance: false };
export async function run(R) {
  await L.cap(R, 'And it moves on by itself');
  await L.click(R, '[data-action=unpin-schedule]', null, { pause: 500 }).catch(() => { });
  await L.setClock(R, 8, 49, 40); await L.sleep(500);
  await L.clockSpeed(R, 150);
  await L.sleep(6800);
  await L.clockSpeed(R, 1); await L.sleep(500);
  await L.cap(R, '', 200);
}
