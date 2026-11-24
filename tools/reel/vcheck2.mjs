import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
for (const w of [1440,390]) { const p=await b.newPage();await p.setViewport({width:w,height:900});
await p.goto('http://localhost:8766/index.html',{waitUntil:'networkidle2'});await new Promise(r=>setTimeout(r,1500));
console.log(w, JSON.stringify(await p.evaluate(()=>{const el=document.querySelector("video"),v=el.getBoundingClientRect(),f=el.parentElement.getBoundingClientRect();return {v:[v.width,v.height],f:[f.width,f.height],sw:document.documentElement.scrollWidth}})));
await p.screenshot({path:`/private/tmp/claude-501/-Users-loganshippee-Rehearsal/23b43268-378e-4ca3-a920-c83395eaad34/scratchpad/h${w}.png`});}
await b.close();
