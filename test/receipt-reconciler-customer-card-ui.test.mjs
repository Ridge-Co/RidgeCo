// Nov 17 2026: customer-card receipts get a work order picker + reference-only attach, and the receipt number shows on cards and in the Selected WO panel.
// Drives the real receipt-reconciler.html in a headless browser with every Worker call mocked. Skips (loudly) when Playwright is not installed.
// Run: node test/receipt-reconciler-customer-card-ui.test.mjs
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium; try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (e) { console.log('NOT RUN: Playwright is not installed here'); process.exit(0); }
let pass = 0, fail = 0; const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); }).listen(0);
const origin = 'http://127.0.0.1:' + srv.address().port;
const today = new Date().toISOString().slice(0, 10), d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const props = [{ ID: '11', Address: '928 N Calvert St', Active: 'TRUE' }];
const wos = [{ ID: '1001', Property_ID: '11', Status: 'In Progress', Description: 'open job', Created_Date: d(5) }, { ID: '1002', Property_ID: '11', Status: 'Paid', Description: 'closed 200 days ago', Created_Date: d(230), Completed_Date: d(200) }, { ID: '1003', Property_ID: '11', Status: 'Cancelled', Description: 'cancelled, blank completed', Created_Date: d(40), Completed_Date: '' }];
const q = (o) => Object.assign({ Status: 'pending', Vendor: 'Home Depot', Total: '43.23', Receipt_Date: today, Received_Date: new Date().toISOString(), Card_Last4: '', Invoice_Number: '', items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [], Active: 'TRUE', Source_File_ID: 'f1', Source_File_URL: 'https://drive.example/f1' }, o);
const pending = [
  q({ ID: '1', Invoice_Number: 'WH37678511', suggestion: { category: 'billable', action: 'need_property', flags: [] } }),
  q({ ID: '2', Vendor: "Lowe's", Invoice_Number: '99431', suggestion: { category: 'customer_paid', action: 'exclude', manual_customer_card: true, flags: [] } }),
  q({ ID: '3', Invoice_Number: '', PO_Reference: 'PO 5512', suggestion: { category: 'billable', action: 'need_property', flags: [] } }),
  q({ ID: '4', Invoice_Number: '', PO_Reference: '', suggestion: { category: 'billable', action: 'need_property', flags: [] } }),
  q({ ID: '179', Vendor: "Lowe's", Total: '6.33', Receipt_Date: '2026-10-05', PO_Reference: '8616 tower bridge way', Invoice_Number: '36109', suggestion: { category: 'billable', action: 'need_property', flags: [] } }),
];
const calls = []; let attachResponse = { ok: true, success: true };
const mock = (u, method) => {
  const p = u.pathname;
  if (p === '/receipt-recon/queue') return u.searchParams.get('status') === 'confirmed' ? [] : pending;
  if (p === '/properties') return props; if (p === '/workorders') return wos; if (p === '/units') return [];
  if (p === '/receipt-recon/cards') return { ok: true, mine: [], customer: [], customer_from_secret: false, errors: [] };
  if (p === '/receipt-recon/rules') return { ok: true, rules: [] };
  if (p === '/receipt/attach-only') return attachResponse;
  return method === 'GET' ? [] : { ok: true, success: true };
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
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
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 160))); page.on('dialog', dl => { errs.push('dialog: ' + dl.message().slice(0, 60)); dl.dismiss(); });
await page.goto(origin + '/receipt-reconciler.html'); await page.waitForSelector('#rc1', { timeout: 15000 });
const txt = sel => page.locator(sel).first().innerText();

console.log('receipt number');
ok(/Receipt # WH37678511/.test(await txt('#rc1 .rc-sub')), 'Home Depot order number shows as a "Receipt # …" chip on the card sub line');
ok(await page.locator('#rc1 .rc-rn').getAttribute('data-rn') === 'WH37678511', 'the chip carries the exact number for copying');
ok(/Receipt # 99431/.test(await txt('#rc2 .rc-sub')), "Lowe's number shows on the customer-card card too");
ok(await page.locator('#rc3 .rc-rn').count() === 0 && /PO 5512/.test(await txt('#rc3 .rc-sub')), 'blank Invoice_Number falls back to the PO_Reference text, no chip');
ok(!/undefined|null/.test(await txt('#rc3 .rc-sub')) && !/undefined|null/.test(await txt('#rc4 .rc-sub')), 'blank values never render the words undefined / null');
ok(await page.locator('#rc4 .rc-rn').count() === 0, 'no number and no PO renders nothing');
await page.locator('#rc1-prop').selectOption('11'); await page.locator('#rc1-wo').selectOption('1001');
ok(/Receipt # WH37678511/.test(await txt('#rc1-wo-detail')), 'the Selected WO detail panel shows the receipt # chip once a WO is picked');
await page.locator('#rc4-prop').selectOption('11'); await page.locator('#rc4-wo').selectOption('1001');
ok(!/Receipt #|undefined/.test(await txt('#rc4-wo-detail')), 'the detail panel shows no chip (and no "undefined") for a receipt with no number');

console.log('picker window');
const opts = await page.locator('#rc1-wo optgroup').evaluateAll(gs => gs.map(g => g.label + ':' + [...g.querySelectorAll('option')].map(o => o.value).join(',')));
ok(opts.some(g => /Closed in the last year:.*1002/.test(g)), 'WO closed 200 days ago is offered by default');
ok(opts.some(g => /Closed in the last year:.*1003/.test(g)), 'cancelled WO with blank Completed_Date is offered (falls back to Created_Date)');

console.log('customer-card attach');
ok(await page.locator('#rc2-wo').count() === 1 && await page.locator('#rc2-prop').count() === 1, 'the customer-card receipt now has a property + work order picker');
ok(/not<\/b> billed|not billed/i.test(await page.locator('#rc2 .rc-cc-note').innerHTML()), 'the card says plainly it is not billed');
ok(await page.locator('#rc2 button:has-text("Confirm")').count() === 0, 'the normal Confirm (billing) button is NOT on a customer-card card');
ok(await page.locator('#rc2 button:has-text("Ridge Co expense")').count() === 0, 'the expense-to-QuickBooks buttons are NOT on a customer-card card');
await page.locator('#rc2 button:has-text("Attach to work order")').click();
ok(/Pick a work order/.test(await txt('#rc2-status')) && !calls.some(c => c.path === '/receipt/attach-only'), 'no work order picked: refused on the card, nothing sent');
await page.locator('#rc2-prop').selectOption('11'); await page.locator('#rc2-wo').selectOption('1001');
ok(/Attaching \(reference only, not billed\)/.test(await txt('#rc2-posting')), 'the posting line says reference only, not billed');
await page.locator('#rc2 button:has-text("Attach to work order")').click(); await page.waitForTimeout(400);
const att = calls.filter(c => c.path === '/receipt/attach-only');
ok(att.length === 1 && att[0].body.id === '2' && att[0].body.wo_id === '1001' && att[0].body.customer_card === true, 'attach posts /receipt/attach-only with the WO and customer_card:true');
ok(!calls.some(c => ['/receipt-recon/confirm', '/receipt-recon/expense'].includes(c.path)), 'no confirm / expense (billing) call was made');
ok(await page.locator('#rc2').count() === 0, 'a successful attach takes the card out of Pending');
console.log('fixed-price job: cost only, do not bill');
ok(await page.locator('#rc179 button:has-text("Fixed-price job")').count() === 1 && await page.locator('#rc1 button:has-text("Fixed-price job")').count() === 1, 'every normal card has the Fixed-price option');
ok(await page.locator('#rc2 button:has-text("Fixed-price job")').count() === 0, 'a customer-card card does not (that cost is the customer\'s)');
ok(/Receipt # 36109/.test(await txt('#rc179 .rc-sub')) && /8616 tower bridge way/.test(await txt('#rc179 .rc-sub')), 'the Lowe\'s card shows receipt # 36109 and the PO text');
await page.locator('#rc179 button:has-text("Fixed-price job")').click();
ok(/Pick a work order/.test(await txt('#rc179-status')) && !calls.some(c => c.body.non_billing_reason === 'fixed_price'), 'no work order: refused on the card, nothing sent');
await page.locator('#rc179-prop').selectOption('11'); await page.locator('#rc179-wo').selectOption('1002');
ok(/Receipt # 36109/.test(await txt('#rc179-wo-detail')), 'the Selected WO panel shows the receipt #');
await page.locator('#rc179 button:has-text("Fixed-price job")').click(); await page.waitForTimeout(400);
const fpc = calls.filter(c => c.path === '/receipt/attach-only' && c.body.non_billing_reason === 'fixed_price');
ok(fpc.length === 1 && fpc[0].body.id === '179' && fpc[0].body.wo_id === '1002', 'posts the SAME attach endpoint with non_billing_reason fixed_price');
ok(!calls.some(c => c.path === '/receipt-recon/confirm'), 'no confirm (billing) call');
ok(errs.length === 0, 'no page errors or pop-ups (' + errs.join(' | ') + ')');
await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
