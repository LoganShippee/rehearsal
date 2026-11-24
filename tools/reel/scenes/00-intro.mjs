import * as L from '../lib.mjs';
export const meta = { seconds: 4, advance: false };
export async function run(R) {
  await L.glide(R, 700, 420, 10);
  await L.cap(R, 'All the tools for rehearsal in one place', 3600);
  await L.cap(R, '', 400);
}
