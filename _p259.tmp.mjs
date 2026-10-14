import { chromium } from 'playwright';
const b = await chromium.launch();
const pages = ['index.html','owner.html','tenant.html','vendor.html','wo.html','command-center.html','receipt-reconciliation.html'];
for (const pg of pages) {
  const p = await b.newPage({viewport:{width:412,height:915}});
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error' && /WOStatus|not defined|is not a function/.test(m.text())) errs.push('console: '+m.text()); });
  try { await p.goto('http://localhost:8767/'+pg,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(700);
    const has = await p.evaluate(()=>typeof WOStatus!=='undefined' ? Object.keys(WOStatus.sets).length : -1);
    console.log(pg, 'WOStatus groups:', has, 'errors:', JSON.stringify(errs));
  } catch(e){ console.log(pg,'load fail',e.message.slice(0,80)); }
  await p.close();
}
await b.close();
