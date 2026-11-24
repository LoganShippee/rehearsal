import * as L from '../lib.mjs';
export const meta = { seconds: 5, advance: false };
export async function run(R) {
  await L.cap(R, '');
  await R.page.evaluate(() => {
    document.getElementById('reel-end')?.remove();
    const d = document.createElement('div'); d.id = 'reel-end';
    d.innerHTML = '<img src="/icon-512.png"><h1>Rehearsal</h1><p>The classroom app for music teachers</p><div class="pill">Free</div><p style="font-size:22px;opacity:.75;margin-top:-4px">Free for teachers</p>';
    const pl = d.querySelector('.pill'); pl.style.fontSize = '60px'; pl.style.padding = '14px 64px'; pl.style.marginTop = '18px';
    document.body.appendChild(d); void d.offsetWidth; d.classList.add('on');
  });
  await L.sleep(4800);
}
