import * as L from '../lib.mjs';
export const meta = { seconds: 10, advance: false };
// Pick a class in the toolbar's class picker: visible cursor click, then set the value (native dropdowns don't render in headless).
async function pick(R, name) {
  const sel = await L.find(R, '#p-cls');
  const [x, y] = await L.center(R, sel); await L.glide(R, x, y, 22); await L.sleep(120);
  await R.page.mouse.down(); await L.sleep(60); await R.page.mouse.up(); await L.sleep(120);
  await R.page.evaluate(n => { const s = document.getElementById('p-cls'); const o = [...s.options].find(o => o.text.startsWith(n)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }, name);
  await L.sleep(1500);
}
export async function run(R) {
  await L.cap(R, 'Every class has its own setup and look');
  await L.sleep(500);
  await pick(R, 'Band'); await L.sleep(300);
  await pick(R, 'Orchestra'); await L.sleep(300);
  await pick(R, 'Choir'); await L.sleep(1500);
  await L.cap(R, '', 200);
}
