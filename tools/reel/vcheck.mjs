import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage();await p.setViewport({width:1280,height:900});
await p.goto('http://localhost:8766/index.html',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,2500));
const info=await p.evaluate(()=>{const v=document.getElementById('hero-tour');return {t:v.currentTime,paused:v.paused,dur:v.duration,w:v.videoWidth,rs:v.readyState}});
console.log(JSON.stringify(info));
const dir=process.argv[2];
for(const [i,t] of [[1,30],[2,70]]){await p.evaluate(t=>{const v=document.getElementById('hero-tour');v.pause();v.currentTime=t},t);await new Promise(r=>setTimeout(r,1200));
 await (await p.$('#hero-tour')).screenshot({path:`${dir}/v${i}.png`});}
await b.close();
