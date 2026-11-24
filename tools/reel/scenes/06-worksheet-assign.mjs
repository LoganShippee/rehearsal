import * as L from '../lib.mjs';
export const meta = { seconds: 10 };
// Quick click (short glide) so the budget holds; still a visible cursor move + ripple.
async function fast(R, sel, txt, pause = 150) {
  const el = await L.find(R, sel, txt); await el.evaluate(e => e.scrollIntoView({ block: 'nearest' }));
  const [x, y] = await L.center(R, el); await L.glide(R, x, y, 10); await L.sleep(60);
  await R.page.mouse.down(); await L.sleep(50); await R.page.mouse.up(); await L.sleep(pause);
}
// Worksheet preview, then the Assign drawer. Assign runs in the app's built-in local demo mode (fake teacher "Ms. Rivera", data in the
// throwaway browser only) and every request leaving localhost is blocked, so nothing can ever reach the real homework server.
export async function run(R, ctx) {
  const page = R.page;
  await page.setRequestInterception(true);
  const gate = r => { if (/^(http:\/\/localhost|data:|blob:)/.test(r.url())) r.continue(); else r.abort(); };
  page.on('request', gate);
  try {
    await L.stage(R, 'Sight Reading');
    // hidden plumbing: no real print dialog, demo homework mode, signed in as the demo teacher
    await page.evaluate(async () => {
      window.print = () => { };
      window.HW_API_BASE = 'demo';
      const A = window.HW_TEACHER_API, e = 'ms.rivera@oakridge.edu';
      const s = await A.emailStart({ email: e });
      await A.emailVerify({ email: e, code: s.devCode });
    });

    await L.cap(R, 'Paper worksheets in one click', 0);
    await fast(R, '[data-sr=print]', 'Worksheet', 1100);
    await L.shot(R, ctx, 'worksheet');
    await fast(R, '[data-ws=swapall]', null, 1000);
    await fast(R, '[data-ws=cancel]', null, 500);

    await page.evaluate(() => { const c = document.getElementById('reel-cap'); c.style.left = '370px'; });
    await L.cap(R, 'Assign homework in one click', 0);
    await fast(R, '[data-sr=assign]', 'Assign', 1800);
    await L.shot(R, ctx, 'assign');
    await fast(R, '[data-hwt=submit]', null, 1100);
    await L.shot(R, ctx, 'assigned');
    await L.cap(R, '', 200);
  } finally {
    // leave the app as found: drawer/modal closed, no demo sign-in left behind, network allowed again for later scenes
    await page.evaluate(() => {
      document.querySelector('[data-ws=cancel]')?.click(); document.querySelector('[data-hwt=close]')?.click();
      const c = document.getElementById('reel-cap'); if (c) c.style.left = '';
      for (const st of [localStorage, sessionStorage]) for (const k of Object.keys(st)) if (k.startsWith('rehearsal-hw')) st.removeItem(k);
      delete window.HW_API_BASE;
    }).catch(() => { });
    page.off('request', gate); await page.setRequestInterception(false).catch(() => { });
  }
}
