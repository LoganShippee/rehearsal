import * as L from '../lib.mjs';
// End card: the classroom app is free; Online Homework is free during the launch (planned price shown honestly).
export const meta = { seconds: 8, advance: false };
export async function run(R) {
  await L.cap(R, '');
  await R.page.evaluate(() => {
    document.getElementById('reel-end')?.remove();
    const d = document.createElement('div'); d.id = 'reel-end';
    d.innerHTML = `
      <style>
        #reel-end { gap: 0 !important; background: linear-gradient(45deg, #bb3fe4 0%, #8553f0 38%, #4a72f7 78%, #3f78f8 100%) !important; }
        #reel-end .brand { display: flex; align-items: center; gap: 22px; margin-bottom: 8px; }
        #reel-end .brand img { width: 96px; height: 96px; border-radius: 50%; box-shadow: none !important; filter: drop-shadow(0 6px 14px rgba(40,20,100,.35)); }
        #reel-end .brand h1 { font-size: 64px; }
        #reel-end .tag { font-size: 26px; opacity: .85; margin-bottom: 26px; }
        #reel-end .cards { display: flex; flex-direction: column; align-items: center; gap: 16px; }
        #reel-end .c { width: 620px; padding: 22px 34px 20px; border-radius: 24px; background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.28); box-shadow: 0 18px 50px rgba(0,0,0,.28); text-align: center; }
        #reel-end .c .k { font-size: 20px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; opacity: .8; }
        #reel-end .c .big { font-size: 56px; font-weight: 800; margin: 6px 0 2px; letter-spacing: -.02em; }
        #reel-end .c .big.gold { color: #ffd54a; }
        #reel-end .c .sub { font-size: 24px; opacity: .92; }
        #reel-end .c ul { list-style: none; padding: 0; margin: 12px 0 0; font-size: 20px; line-height: 1.4; opacity: .9; }
        #reel-end .c li::before { content: '\\2713\\00a0\\00a0'; color: #ffd54a; font-weight: 800; }
                #reel-end .c.hw { width: 620px; padding: 20px 24px 18px; border-radius: 20px; }
        #reel-end .c.hw .k { font-size: 16px; }
        #reel-end .c.hw .big { font-size: 38px; margin: 4px 0 0; }
        #reel-end .c.hw .sub { font-size: 18px; }
        #reel-end .c.hw ul { font-size: 17px; margin-top: 12px; line-height: 1.5; }
        #reel-end .foot { margin-top: 22px; font-size: 22px; opacity: .75; }
      </style>
      <div class="brand"><img src="/icon-512.png"><h1>Rehearsal</h1></div>
      <div class="tag">The classroom app for music teachers</div>
      <div class="cards">
        <div class="c"><div class="k">Classroom app</div><div class="big gold">Free</div><div class="sub">For classroom use. No account.</div>
          <ul><li>Mac, Windows and web</li><li>Works offline</li><li>Every tool you just saw</li><li>Files stay on your device</li></ul></div>
        <div class="c hw"><div class="k">Online Homework</div><div class="big gold">30-day trial</div><div class="sub">No card needed to start</div>
          <ul><li>Graded practice at home</li><li>Then $5/month or $49/year</li><li>Notice before any charge</li></ul></div>
      </div>
      <div class="foot">rehearsalmusic.com</div>`;
    document.body.appendChild(d); void d.offsetWidth; d.classList.add('on');
  });
  await L.sleep(7600);
}
