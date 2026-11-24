// Shared recorder: headless Chrome + screencast frames + injected caption/cursor/clock overlays.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const W = 1280, H = 800;
const OVERLAY = `(() => {
  const RD = Date; let base = RD.now(), t0 = base, speed = 1;
  const cur = () => t0 + (RD.now() - base) * speed;
  class D extends RD { constructor(...a) { if (a.length === 0) super(cur()); else super(...a); } static now() { return cur(); } }
  window.Date = D;
  window.__clock = { set(ms) { t0 = ms; base = RD.now(); }, speed(s) { t0 = cur(); base = RD.now(); speed = s; document.getElementById('reel-lapse')?.classList.toggle('on', s > 1); } , real: () => RD.now() };
  const css = document.createElement('style'); css.textContent = \`
    #reel-cap { position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 14px); max-width: 1020px; padding: 14px 30px; border-radius: 16px; z-index: 2147483647; pointer-events: none;
      background: rgba(12,20,36,.88); color: #fff; font: 700 32px/1.25 -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif; letter-spacing: -.01em; text-align: center; opacity: 0; transition: opacity .35s, transform .35s; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
    #reel-cap.on { opacity: 1; transform: translate(-50%, 0); }
    #reel-cap small { display: block; font-weight: 500; font-size: 19px; opacity: .8; margin-top: 4px; }
    #reel-cur { position: fixed; left: 0; top: 0; width: 28px; height: 28px; z-index: 2147483647; pointer-events: none; transform: translate(-100px,-100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); }
    .reel-rip { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 3px solid #ffd54a; z-index: 2147483646; pointer-events: none; animation: reelrip .55s ease-out forwards; }
    @keyframes reelrip { to { transform: scale(4.5); opacity: 0; } }
    #reel-lapse { position: fixed; top: 14px; right: 16px; z-index: 2147483647; padding: 6px 14px; border-radius: 99px; background: #ffd54a; color: #222; font: 700 15px -apple-system, sans-serif; opacity: 0; transition: opacity .3s; pointer-events: none; }
    #reel-lapse.on { opacity: 1; }
    #reel-end { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: linear-gradient(160deg,#0f2a4d,#1565c0); color: #fff; font-family: -apple-system, 'SF Pro Display', sans-serif; opacity: 0; transition: opacity .7s; pointer-events: none; }
    #reel-end.on { opacity: 1; }
    #reel-end img { width: 120px; height: 120px; border-radius: 28px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
    #reel-end h1 { font-size: 76px; margin: 0; letter-spacing: -.03em; } #reel-end p { font-size: 30px; margin: 0; opacity: .9; }
    #reel-end .pill { margin-top: 10px; padding: 12px 34px; border-radius: 99px; background: #ffd54a; color: #1b1b1b; font-weight: 800; font-size: 34px; }
  \`;
  const mk = () => {
    document.head.appendChild(css);
    const c = document.createElement('div'); c.id = 'reel-cap'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'reel-cur'; k.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2l7.5 19 2.6-7.7L21 10.7z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'; document.body.appendChild(k);
    const l = document.createElement('div'); l.id = 'reel-lapse'; l.textContent = 'Time-lapse'; document.body.appendChild(l);
    addEventListener('mousemove', e => { k.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = 'reel-rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  };
  if (document.body) mk(); else addEventListener('DOMContentLoaded', mk);
})();`;

export async function start({ url, out, record = true, w = W, h = H }) {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'], defaultViewport: { width: w, height: h } });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(OVERLAY);
  const R = { browser, page, out, frames: [], n: 0, t0: 0, recording: false, mx: 640, my: 400 };
  if (record) fs.rmSync(out, { recursive: true, force: true }), fs.mkdirSync(out, { recursive: true });
  R.wire = async pg => {
    R.client = await pg.createCDPSession();
    R.client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      if (R.recording) {
        const name = String(R.n++).padStart(5, '0') + '.jpg';
        fs.writeFileSync(out + '/' + name, Buffer.from(data, 'base64'));
        R.frames.push({ f: name, t: metadata.timestamp - R.t0 });
      }
      R.client.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
    });
    await R.client.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  };
  await R.wire(page); R.main = page;
  // Open another tab (e.g. the student homework portal) and record IT instead, keeping the teacher app's state untouched. R.backToMain() returns.
  R.openTab = async url => {
    const pg = await browser.newPage(); await pg.setViewport({ width: w, height: h }); await pg.evaluateOnNewDocument(OVERLAY);
    await R.client.send('Page.stopScreencast').catch(() => { }); R.page = pg; await R.wire(pg); await pg.bringToFront();
    if (url) await pg.goto(url, { waitUntil: 'networkidle2' }); return pg;
  };
  R.backToMain = async () => { const old = R.page; await R.client.send('Page.stopScreencast').catch(() => { }); R.page = R.main; await R.main.bringToFront(); await R.main.setViewport({ width: 1, height: 1 }).catch(() => { }); await R.main.setViewport({ width: w, height: h }); await R.wire(R.main); if (old !== R.main) await old.close().catch(() => { }); };
  R.startRec = () => { R.t0 = Date.now() / 1000; R.recording = true; R.frames.length = 0; R.n = 0; };
  R.stopRec = () => { R.recording = false; fs.writeFileSync(out + '/times.json', JSON.stringify(R.frames)); };
  if (url) await page.goto(url, { waitUntil: 'networkidle2' });
  return R;
}

// ---- actions (all take R) ----
export const cap = async (R, html, ms = 0) => { await R.page.evaluate(h => { const c = document.getElementById('reel-cap'); if (h) { c.innerHTML = h; c.classList.add('on'); } else c.classList.remove('on'); }, html); if (ms) await sleep(ms); };
export async function glide(R, x, y, steps = 28) {
  const sx = R.mx, sy = R.my; // ease-in-out path so the cursor looks human
  for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await R.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e); await sleep(14); }
  R.mx = x; R.my = y;
}
export async function center(R, handle) { const b = await handle.boundingBox(); if (!b) throw new Error('no box'); return [b.x + b.width / 2, b.y + b.height / 2]; }
// find a visible element by CSS + optional text; returns ElementHandle
export async function find(R, sel, txt) {
  const h = await R.page.evaluateHandle((sel, txt) => [...document.querySelectorAll(sel)].find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== 'hidden' && (!txt || (x.innerText || x.title || x.value || '').includes(txt)); }) || null, sel, txt);
  const el = h.asElement(); if (!el) throw new Error(`not found: ${sel} ${txt || ''}`); return el;
}
export async function click(R, sel, txt, { pause = 700, after = 0 } = {}) {
  const el = await find(R, sel, txt); await el.evaluate(e => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const [x, y] = await center(R, el); await glide(R, x, y); await sleep(160);
  await R.page.mouse.down(); await sleep(70); await R.page.mouse.up(); await sleep(pause + after);
}
export async function type(R, text, delay = 55) { for (const ch of text) { await R.page.keyboard.type(ch); await sleep(delay); } }
export const jsClick = (R, sel, txt) => R.page.evaluate((sel, txt) => { const e = [...document.querySelectorAll(sel)].find(x => x.offsetParent && (!txt || x.innerText.includes(txt))); e && e.click(); return !!e; }, sel, txt);
export const setClock = (R, h, m = 0, s = 0) => R.page.evaluate((h, m, s) => { const d = new Date(); d.setHours(h, m, s, 0); window.__clock.set(d.getTime()); }, h, m, s);
export const clockSpeed = (R, n) => R.page.evaluate(n => window.__clock.speed(n), n);
export async function dismissWelcome(R) { await jsClick(R, 'button', 'Explore on my own'); await sleep(600); }

// ---- scene helpers ----
// Advance the agenda sidebar one step with a real, visible click (keeps the sidebar in step with the video's chapters).
export async function nextStep(R) { await click(R, '[data-action=agenda-next]', null, { pause: 500 }); }
export const shot = (R, ctx, name) => R.page.screenshot({ path: `${ctx.shots}/${name}.png` });
// Click a main stage tab (Warm-up / Sight Reading / Score Practice / Files).
export const stage = (R, label) => click(R, '[data-action=stage]', label, { pause: 900 });
