// Manual browser check for rc-ui (UI plan Phase 0). Run: node test/manual-verify-rc-ui.mjs   (needs Playwright; not part of node --test). Prints PASS/FAIL per behaviour.
import { createRequire } from 'node:module'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const srv=http.createServer((q,s)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));fs.readFile(p,(e,d)=>{if(e){s.writeHead(404);return s.end()}s.writeHead(200,{'content-type':p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'text/html'});s.end(d)})}).listen(0);
const url='http://127.0.0.1:'+srv.address().port+'/rc-ui-demo.html';
const b=await chromium.launch(); const res=[]; const ok=(c,m)=>{res.push((c?'PASS ':'FAIL ')+m)};
const pg=await (await b.newContext({viewport:{width:412,height:915},hasTouch:true,isMobile:true,serviceWorkers:'block'})).newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
await pg.route('**/*',r=>{const u=new URL(r.request().url()); return u.hostname==='127.0.0.1'?r.continue():r.abort()});
await pg.goto(url); await pg.waitForTimeout(500);
const btn=t=>pg.getByRole('button',{name:t,exact:true});
// sheet: open, focus inside, escape closes, focus returns
await btn('Open a sheet').click(); ok(await pg.locator('.rc-sheet').count()===1,'sheet opens');
ok(await pg.evaluate(()=>!!document.activeElement.closest('.rc-sheet')),'focus moved into sheet');
const box=await pg.locator('.rc-sheet').boundingBox(); ok(box.y+box.height>=914 && box.width>=411,'phone: sheet sits at the bottom, full width ('+JSON.stringify(box)+')');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(100); ok(await pg.locator('.rc-sheet').count()===0,'Escape closes');
ok(await pg.evaluate(()=>document.activeElement.textContent==='Open a sheet'),'focus returned to the button');
// back button closes
await btn('Open a sheet').click(); await pg.goBack(); await pg.waitForTimeout(150);
ok(await pg.locator('.rc-sheet').count()===0,'phone back button closes the sheet'); ok(pg.url().includes('rc-ui-demo'),'...and stays on the page');
// confirm true/false
await btn('Confirm').click(); await pg.getByRole('button',{name:'Mark complete'}).click(); await pg.waitForTimeout(100); ok((await pg.locator('#sheet-out').textContent()).includes('true'),'rcConfirm resolves true');
await btn('Confirm').click(); await pg.getByRole('button',{name:'Cancel',exact:true}).click(); await pg.waitForTimeout(100); ok((await pg.locator('#sheet-out').textContent()).includes('false'),'rcConfirm resolves false on Cancel');
// danger confirm starts on cancel
await btn('Confirm (danger)').click(); ok(await pg.evaluate(()=>document.activeElement.textContent==='Keep job'),'danger confirm focuses the safe button'); await pg.keyboard.press('Escape');
// ask validation keeps sheet open
await btn('Ask').click(); await pg.getByRole('button',{name:'Add contact'}).click(); ok(await pg.locator('.rc-field__error').filter({hasText:'Please enter'}).count()===1,'empty answer shows an error and stays open');
await pg.keyboard.type('Al'); await pg.keyboard.press('Enter'); ok(await pg.locator('.rc-sheet').count()===1,'validate message keeps it open');
await pg.keyboard.type('ice'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(100); ok((await pg.locator('#sheet-out').textContent()).includes('"Alice"'),'rcAsk resolves the text');
// tab trap
await btn('Confirm').click(); for(let i=0;i<6;i++) await pg.keyboard.press('Tab'); ok(await pg.evaluate(()=>!!document.activeElement.closest('.rc-sheet')),'Tab stays inside the sheet'); await pg.keyboard.press('Escape');
// toast + undo
await btn('Toast with Undo').click(); await pg.getByRole('button',{name:'Undo',exact:true}).click(); await pg.waitForTimeout(100); ok((await pg.locator('#sheet-out').textContent()).includes('action'),'toast Undo resolves "action"');
// retry: the demo fails the first retry on purpose
await pg.getByRole('button',{name:'Retry',exact:true}).click(); await pg.waitForTimeout(1300); ok(await pg.locator('.rc-error').count()===1,'retry failing keeps the error visible (button comes back)');
ok(await pg.getByRole('button',{name:'Retry',exact:true}).isEnabled(),'Retry button re-enabled after a failure');
// spanish
await pg.getByRole('button',{name:'Español'}).click(); ok(await pg.locator('.rc-empty__title').count()===1 && (await pg.getByRole('button',{name:'Reintentar'}).count())===1,'Spanish switches rc-ui words (Reintentar)');
// desktop dialog
const d=await (await b.newContext({viewport:{width:1366,height:768}})).newPage(); await d.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort()); await d.goto(url);
await d.getByRole('button',{name:'Open a sheet',exact:true}).click(); const bb=await d.locator('.rc-sheet').boundingBox(); ok(bb.width<=560 && bb.y>50 && bb.y+bb.height<718,'desktop: centred dialog 560 max ('+JSON.stringify(bb)+')');
// css-missing warning
const w=await (await b.newContext()).newPage(); await w.route('**/*',r=>{const u=r.request().url(); if(u.includes('rc-ui.css')) return r.abort(); return new URL(u).hostname==='127.0.0.1'?r.continue():r.abort()}); await w.goto(url); await w.waitForTimeout(300);
ok(await w.locator('#rc-ui-banner').count()===1,'CSS blocked: visible warning banner'); ok(await w.getByRole('button',{name:'Open a sheet'}).count()===1,'...and the page still works');
const j=await (await b.newContext()).newPage(); await j.route('**/*',r=>{const u=r.request().url(); if(u.includes('rc-ui.js')) return r.abort(); return new URL(u).hostname==='127.0.0.1'?r.continue():r.abort()}); await j.goto(url); await j.waitForTimeout(300);
ok((await j.locator('[role=alert]').first().textContent()).includes('rc-ui.js'),'JS blocked: visible warning');
ok(errs.length===0,'no page errors '+errs.join(';'));
console.log(res.join('\n')); await b.close(); srv.close(); if (res.some(r => r.startsWith('FAIL'))) process.exit(1);
