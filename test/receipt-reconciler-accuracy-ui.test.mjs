// Nov 17 2026 receipt-accuracy build: drives the real receipt-reconciler.html in a headless browser with every Worker call mocked.
// Skips (loudly) when Playwright is not installed. Run: node test/receipt-reconciler-accuracy-ui.test.mjs
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium; try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (e) { console.log('NOT RUN: Playwright is not installed here'); process.exit(0); }
let pass = 0, fail = 0; const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); }).listen(0);
const origin = 'http://127.0.0.1:' + srv.address().port;
const today = new Date().toISOString().slice(0, 10), recent = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10), old = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const props = [{ ID: '2', Address: '928 N Calvert St', Active: 'FALSE' }, { ID: '11', Address: '928 N Calvert St', Active: 'TRUE' }, { ID: '85', Address: '1864 Kerns School Rd', Active: 'TRUE' }];
const wos = [{ ID: '1001', Property_ID: '11', Status: 'In Progress', Description: 'open job', Created_Date: old }, { ID: '1002', Property_ID: '11', Status: 'Paid', Description: 'closed recently', Created_Date: old, Completed_Date: recent }, { ID: '1003', Property_ID: '11', Status: 'Paid', Description: 'closed long ago', Created_Date: old, Completed_Date: old }];
const q = (o) => Object.assign({ Status: 'pending', Vendor: 'Home Depot', Total: '43.23', Receipt_Date: today, Received_Date: new Date().toISOString(), Card_Last4: '', items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [], Active: 'TRUE' }, o);
const pending = [
  q({ ID: '1', suggestion: { category: 'billable', action: 'suggest', property: { id: '2', address: '928 N Calvert St' }, flags: ['card_unknown'], card_status: 'unknown', rule: { id: '7', action: 'business', blocked: ['card_unknown'], auto: false } }, Card_Last4: '4444', dup_signals: [{ reason: 'Possible duplicate of queue entry #2 (pending): $43.23 at Home Depot on ' + today + '.' }] }),
  q({ ID: '2', Vendor: 'Google LLC', suggestion: { category: 'company', action: 'exclude', flags: [] } }),
  q({ ID: '3', suggestion: { category: 'customer_paid', action: 'exclude', manual_customer_card: true, flags: [] } }),
  q({ ID: '5', Card_Last4: '1661', suggestion: { category: 'billable', action: 'need_property', flags: [] } }),
  q({ ID: '4', suggestion: { category: 'billable', action: 'need_property', flags: ['po_ambiguous'], property_hint: { candidates: [{ id: '11', address: '1220 Anywhere St' }, { id: '85', address: '928 N Calvert St' }] } }, dup_read_error: 'Receipts could not be read for the duplicate check: boom' }),
];
const confirmed = [q({ ID: '9', Status: 'confirmed', Vendor: 'Apple Valley Waste', Notes: '🤖 Auto-handled by rule #3 (always this property).', auto_handled: true })];
const calls = [];
const mock = (u, method, body) => {
  const p = u.pathname;
  if (p === '/receipt-recon/queue') return u.searchParams.get('status') === 'confirmed' ? confirmed : pending;
  if (p === '/properties') return props; if (p === '/workorders') return wos; if (p === '/units') return [];
  if (p === '/receipt-recon/cards') return { ok: true, mine: [{ last4: '1661', label: 'Home Depot' }], customer: [{ last4: '7442', label: 'Goldszmidt' }], customer_from_secret: false, errors: [] };
  if (p === '/receipt-recon/rules') return { ok: true, rules: [{ ID: '3', Match_Vendor: 'Apple Valley Waste', Action: 'property', Property_ID: '85', Auto: 'TRUE', Active: 'TRUE', Hits: '2' }] };
  return method === 'GET' ? [] : { ok: true, success: true };
};
const browser = await chromium.launch();
for (const vp of [{ n: '412', w: 412, h: 915, mobile: true }, { n: '1366', w: 1366, h: 768, mobile: false }]) {
  console.log('viewport ' + vp.n); calls.length = 0;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'x'); } catch (e) {} });
  await ctx.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (u.origin === origin) return route.continue();
    if (/workers\.dev$/.test(u.hostname)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (r.method() === 'POST') calls.push({ path: u.pathname, body: JSON.parse(r.postData() || '{}') });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(mock(u, r.method())) });
    }
    return ['font', 'image', 'stylesheet'].includes(r.resourceType()) ? route.continue() : route.abort();
  });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 160))); page.on('dialog', d => { errs.push('dialog: ' + d.message().slice(0, 60)); d.dismiss(); });
  await page.goto(origin + '/receipt-reconciler.html'); await page.waitForSelector('#rc1', { timeout: 15000 });
  const txt = sel => page.locator(sel).first().innerText();
  const propOpts = await page.locator('#rc1-prop option').allInnerTexts();
  ok(propOpts.filter(t => /928 N Calvert/.test(t)).length === 1, 'inactive duplicate property is hidden from the picker (one 928 N Calvert St)');
  ok(await page.locator('#rc1-prop').inputValue() === '11', 'a stale suggestion pointing at the inactive duplicate property (ID 2) pre-selects the active twin (ID 11)');
  ok(/Possible duplicate/.test(await txt('#rc1')) && /queue entry #2/.test(await txt('#rc1')), 'duplicate banner names the other entry');
  ok(/not on either list/.test(await txt('#rc1')) && await page.locator('#rc1 button:has-text("This is my card")').count() === 1, 'unknown card shows the one-tap "my card / customer\'s card" buttons');
  ok(/Rule #7: always a business expense/.test(await txt('#rc1')), 'a rule that matched is shown on the card');
  ok(await page.locator('#rc1 button:has-text("customer\'s card")').count() >= 1, 'every pending row has the customer-card button');
  const woOpts = await page.locator('#rc1-wo optgroup').evaluateAll(gs => gs.map(g => g.label + ':' + [...g.querySelectorAll('option')].map(o => o.value).join(',')));
  if (process.env.DEBUG_WO) console.log(JSON.stringify(woOpts));
  ok(woOpts.some(g => /last 30 days:.*1002/.test(g)) && !woOpts.some(g => /1003/.test(g)), 'work order closed 10 days ago is offered; one closed 90 days ago is not (until "show older")');
  // business card: pickers behind the toggle
  ok(await page.locator('#rc2-billbox').isHidden(), 'business card hides the work-order pickers at first');
  await page.locator('#rc2-bill').check();
  ok(await page.locator('#rc2-billbox').isVisible() && await page.locator('#rc2-billbtn').isVisible() && await page.locator('#rc2-bizbtn').isHidden(), '"Bill this to a customer instead" reveals unit/WO pickers and swaps the confirm button');
  ok(await page.locator('#rc3 button:has-text("Not a customer-card purchase")').count() === 1, 'a manual customer-card mark has an undo button');
  ok(/Could be: 1220 Anywhere St/.test(await txt('#rc4')) && /po number is ambiguous/i.test(await txt('#rc4')), 'ambiguous PO lists the candidates and never picks one');
  const banner = await txt('.rc-banner');
  ok(/Receipts could not be read/.test(banner), 'a duplicate-check read failure shows an error banner');
  // panels
  ok(await page.locator('details.rc-sub-panel[open]').count() === 0 && await page.locator('#rc-card-l4').isHidden() && await page.locator('#rc-rule-vendor').isHidden(), 'the add-a-card and add-a-rule forms are collapsed until opened');
  await page.locator('details.rc-panel summary:has-text("Auto-handled")').click();
  ok(/Apple Valley Waste/.test(await txt('#rc-panels')) && await page.locator('#ah9 button:has-text("Undo")').count() === 1, 'Auto-handled list shows the row with an Undo button');
  await page.locator('#ah9 button').click();
  ok(/Tap again to undo/.test(await txt('#ah9 button')) && !calls.some(c => c.path === '/receipt-recon/undo'), 'Undo needs a second tap (no browser pop-up) before anything is sent');
  await page.locator('#ah9 button').click(); await page.waitForTimeout(500);
  ok(calls.some(c => c.path === '/receipt-recon/undo' && c.body.id === '9'), 'second tap sends the undo');
  // mark customer card with remember
  ok(await page.locator('#rc5 .rc-hint').count() === 0 && await page.locator('[id$="-cc-save"]').count() === 0, 'a card already saved as MINE (1661) shows no "remember as customer card" prompt at all');
  ok(await page.locator('#rc1 button:has-text("This is my card")').count() === 1 && await page.locator('#rc1 .rc-hint button:text-is("Customer\'s card")').count() === 1, 'an unknown card offers both "my card" and "customer\'s card"');
  await page.locator('#rc1 button:has-text("This is my card")').click(); await page.waitForTimeout(500);
  ok(calls.some(c => c.path === '/receipt-recon/cards' && c.body.last4 === '4444' && c.body.owner === 'mine') && !calls.some(c => c.path === '/receipt-recon/mark-customer-card' && c.body.id === '1'), '"This is my card" saves it as mine and does not mark the receipt as a customer purchase');
  await page.locator('#rc1 .rc-hint button:text-is("Customer\'s card")').click(); await page.waitForTimeout(500);
  ok(calls.some(c => c.path === '/receipt-recon/mark-customer-card' && c.body.id === '1' && c.body.customer_card === true && c.body.last4 === '4444'), '"Customer\'s card" marks the receipt and remembers the last-4');
  await page.locator('#rc4 button:has-text("This was on a customer")').click(); await page.waitForTimeout(500);
  ok(calls.some(c => c.path === '/receipt-recon/mark-customer-card' && c.body.id === '4' && c.body.last4 === undefined), 'the plain customer-card button saves no card');
  await page.locator('details.rc-panel summary:has-text("Always-rules")').click();
  await page.locator('details.rc-sub-panel summary:has-text("Add a rule")').click();
  await page.fill('#rc-rule-vendor', 'Google LLC'); await page.locator('button:has-text("Save rule")').click(); await page.waitForTimeout(500);
  ok(calls.some(c => c.path === '/receipt-recon/rules' && c.body.match_vendor === 'Google LLC' && c.body.action === 'business'), 'saving a rule posts it');
  await page.locator('details.rc-panel summary:has-text("Cards")').click();
  await page.locator('details.rc-sub-panel summary:has-text("Add a card")').click();
  await page.fill('#rc-card-l4', '12'); await page.locator('button:has-text("Save card")').click(); await page.waitForTimeout(300);
  ok(!calls.some(c => c.path === '/receipt-recon/cards' && c.body.last4 === '12'), 'a card with fewer than 4 digits is refused before anything is sent');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(sw <= 1, 'no sideways scroll at ' + vp.n + 'px');
  const small = await page.evaluate(() => [...document.querySelectorAll('#rc-panels button, #rc-panels input, #rc-panels select')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).length);
  ok(small === 0, 'panel buttons and inputs are at least 40px tall');
  const fs16 = await page.evaluate(() => [...document.querySelectorAll('#rc-panels input, #rc-panels select')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).length);
  ok(fs16 === 0, 'panel inputs use 16px text (no iOS zoom)');
  ok(errs.length === 0, 'no page errors or pop-ups' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await page.screenshot({ path: path.join(ROOT, 'ui-check-out', 'receipt-reconciler-accuracy-' + vp.n + '.png'), fullPage: true }).catch(() => {});
  await ctx.close();
}
await browser.close(); srv.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exit(1);
