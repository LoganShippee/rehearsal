import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
const line = (n) => `<div class="staff">${'<i></i>'.repeat(5)}</div>`;
await p.setContent(`<html><body style="margin:0;font-family:Georgia,serif;color:#111">
<style>@page{size:8.5in 11in;margin:0} body{padding:.7in .8in} h1{font-size:34px;margin:0 0 4px} h2{font:600 15px Helvetica;color:#555;margin:0 0 22px;letter-spacing:.05em;text-transform:uppercase}
.staff{position:relative;height:44px;margin:34px 0 8px} .staff i{display:block;height:1px;background:#222;margin-bottom:10px}
.lyr{font-size:20px;display:flex;justify-content:space-between;margin:0 0 10px} .box{border:2px solid #1565c0;border-radius:10px;padding:14px 18px;margin-top:26px;background:#f4f8fd;font:17px/1.55 Helvetica}
.box b{color:#1565c0}</style>
<h1>Ode to Joy</h1><h2>Soprano / Alto &middot; Rehearsal notes</h2>
${[['Freu-de, schö-ner Göt-ter-fun-ken','Toch-ter aus E-ly-si-um'],['Wir be-tre-ten feu-er-trun-ken','Himm-li-sche, dein Hei-lig-thum'],['Dei-ne Zau-ber bin-den wie-der','Was die Mo-de streng ge-teilt']].map(([a,c])=>`<div class="staff">${'<i></i>'.repeat(5)}</div><div class="lyr"><span>${a}</span><span>${c}</span></div>`).join('')}
<div class="box"><b>Rehearsal notes</b><br>m. 1-4: Sopranos, lift the pickup, light and bright.<br>m. 5-8: Breathe after "Funken". Crescendo into the cadence.<br>m. 9-12: Altos, watch the rhythm on beat 3.</div>
</body></html>`);
await p.pdf({ path: 'assets/10-sample.pdf', width: '8.5in', height: '11in', printBackground: true });
await b.close();
