import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [,, dir, out, ...fr] = process.argv;
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(3,640px);gap:4px">`+fr.map(f=>`<div style="position:relative"><img width=640 src="file://${process.cwd()}/${dir}/${f}.jpg"><b style="position:absolute;left:4px;top:4px;color:#ff0;font:14px sans-serif;background:#000a">${f}</b></div>`).join('')+`</body>`;
fs.writeFileSync('/tmp/sheet.html',html);
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--allow-file-access-from-files']});
const p=await b.newPage();await p.setViewport({width:1932,height:420*Math.ceil(fr.length/3)});
await p.goto('file:///tmp/sheet.html');await new Promise(r=>setTimeout(r,800));
await p.screenshot({path:out});await b.close();
