// Headless verification for the Receipt Reconciler one-tap expense buttons (Sep 22 2026).
// Mocks the worker endpoints so this runs offline against the real receipt-reconciler.html.
// Checks the exact payload each button posts, the on-screen result, and the unreadable-file note.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '..', 'receipt-reconciler.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const queue = [
  { ID: '11', Status: 'pending', Vendor: 'Home Depot', Total: '50.22', Receipt_Date: '2026-09-04', PO_Reference: '1577 ingleside', Source_File_URL: 'https://x/1',
    items_summary: ['gloves', 'cleaner'], suggestion: { category: 'billable', action: 'suggest', property: { id: 'P1' } } },
  { ID: '12', Status: 'pending', Vendor: 'Home Depot', Total: '56.04', Receipt_Date: '2026-09-04', PO_Reference: 'bmore', Source_File_URL: 'https://x/2',
    items_summary: ['tools'], suggestion: { category: 'company', action: 'exclude' } },
  { ID: '13', Status: 'pending', Vendor: 'Home Depot', Total: '18.13', Receipt_Date: '2026-08-24', PO_Reference: '2309 ROBB ST', Source_File_URL: 'https://x/3',
    items_summary: ['wedges'], suggestion: { category: 'billable', action: 'suggest', property: { id: 'P2' } } },
];
const properties = [
  { ID: 'P1', Address: '1577 Ingleside Ave' }, { ID: 'P2', Address: '2309 Robb St' },
  { ID: '85', Address: '1864 Kerns School Rd, Springfield WV' },
];
const posted = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });   // phone width
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === 'file:') return route.continue();
  const p = u.pathname;
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const send = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/receipt-recon/queue') return send(queue.filter(q => q.Status === 'pending'));
  if (p === '/workorders') return send([{ ID: 'WO-1', Property_ID: 'P1', Status: 'Assigned', Description: 'drain' }]);
  if (p === '/properties') return send(properties);
  if (p === '/units') return send([]);
  if (p === '/receipt-recon/confirm') {
    posted.push(body);
    const q = queue.find(x => x.ID === body.id); if (q) q.Status = 'confirmed';
    return send({ ok: true, success: true, id: 'R' + body.id, amount: body.amount, qb_email: { sent: true, error: null } });
  }
  if (p === '/receipt-recon/scan') return send({ ok: true, scanned: 0, remaining: 0, errors: [], stuck: ['recon_smoke_test.png'] });
  return send({});
});
await page.addInitScript(() => { localStorage.setItem('mh_auth', 'test-token'); });
await page.goto('file://' + pagePath);
await page.waitForSelector('#rc11');

// 1. every pending card gets the expense bar; Kerns button present
ok(await page.locator('#rc11 .rc-expense').count() === 1 && await page.locator('#rc12 .rc-expense').count() === 1, 'expense bar on a billable card and on a company card');
ok(await page.locator('#rc11 button:has-text("1864 Kerns School Rd")').count() === 1, 'Kerns School Rd button shown');
ok(await page.locator('#rc12 button:has-text("property picked above")').count() === 0, 'company card has no "property picked above" button (it has its own picker)');

// 2. Ridge Co expense on a billable receipt
await page.click('#rc11 button:has-text("Ridge Co expense")');
await page.waitForFunction(() => /recorded as a Ridge Co expense/.test(document.querySelector('#rc11-status')?.textContent || ''));
let p = posted[0];
ok(p.id === '11' && p.no_wo === true && p.property_id === '' && p.amount === '50.22' && p.description === 'gloves, cleaner', 'Ridge Co: posts no_wo, no property, amount + materials description');
ok(/Sent to QuickBooks/.test(await page.textContent('#rc11-status')), 'on-screen: "Sent to QuickBooks"');
ok(!('wo_id' in p), 'no work order sent');

// reload shows it gone
await page.waitForFunction(() => !document.querySelector('#rc11'), null, { timeout: 5000 });
ok(await page.locator('#rc11').count() === 0, 'confirmed receipt drops off the pending list');

// 3. Kerns on the company card
await page.click('#rc12 button:has-text("1864 Kerns School Rd")');
await page.waitForFunction(() => /1864 Kerns School Rd expense/.test(document.querySelector('#rc12-status')?.textContent || ''));
p = posted[1];
ok(p.id === '12' && p.no_wo === true && p.property_id === '85', 'Kerns: posts no_wo with property 85');

// 4. "property picked above" with a picked property, and without one
await page.selectOption('#rc13-prop', '');
await page.click('#rc13 button:has-text("property picked above")');
ok(/Pick a property above first/.test(await page.textContent('#rc13-status')) && posted.length === 2, 'no property picked: refuses, posts nothing');
await page.selectOption('#rc13-prop', 'P2');
await page.click('#rc13 button:has-text("property picked above")');
await page.waitForFunction(() => /2309 Robb St expense/.test(document.querySelector('#rc13-status')?.textContent || ''));
ok(posted[2].property_id === 'P2' && posted[2].no_wo === true, 'picked property: posts no_wo with that property');

// 5. buttons stay tappable at phone width (no horizontal overflow)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
ok(!overflow, 'no sideways scroll at phone width');

// 6. scan status shows the skipped unreadable file
await page.click('button:has-text("Scan now")');
await page.waitForFunction(() => /unreadable/.test(document.getElementById('conn-status').textContent));
ok(/skipping 1 unreadable file\(s\): recon_smoke_test\.png/.test(await page.textContent('#conn-status')), 'scan line names the skipped unreadable file');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
