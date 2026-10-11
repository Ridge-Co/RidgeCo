// Headless Playwright pass for the vendor back-charge UI (Oct 11 2026). Loads the REAL index.html, mocks
// the Worker, and drives the shipped bc* functions at a phone viewport (412x915) and a desktop one.
// Asserts: panel opens + lists unbilled hub time, ticking time prefills hours, Add posts the right body
// (and an error from the Worker is SHOWN, not swallowed), a bill already in QB leads to a preview + a
// Confirm tap that calls apply-to-qb (preview_only first), Void calls /backcharge/void, and the QB send
// preview shows the negative back-charge line and the net.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const targetHtml = process.argv[2] || join(here, '..', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const J = (route, obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

async function run(viewport, label) {
  console.log('\n== ' + label);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); }); // HTTP-status noise (an unmocked 401, my intentional mocked 409) is not a JS error
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
  const calls = { add: [], apply: [], void: [] };
  let bcRows = [];
  let addMode = 'ok'; // ok | error | in_qb
  await page.route('**/config', r => J(r, {}));
  await page.route('**/hub-bootstrap', r => J(r, { properties: [], units: [], tenants: [], vendors: [], workorders: [], invoices: [], owners: [], keys: [] }));
  await page.route('**/pricing-config', r => J(r, { configured: false }));
  await page.route('**/notifications/pending', r => J(r, []));
  await page.route('**/wishlist', r => J(r, []));
  await page.route('**/backcharges*', r => J(r, { backcharges: bcRows, default_rate: 85, default_description: 'Work completed by Brett, included in estimate' }));
  await page.route('**/time-entries*', r => J(r, [
    { ID: '11', WO_ID: 'WO-9', Role: 'hub', Duration_Minutes: '60', Billable: 'TRUE', Active: 'TRUE', Billed_Bill_ID: '', Notes: 'drop materials', Date: '2026-10-10' },
    { ID: '12', WO_ID: 'WO-9', Role: 'hub', Duration_Minutes: '30', Billable: 'TRUE', Active: 'TRUE', Billed_Bill_ID: '', Date: '2026-10-11' },
    { ID: '13', WO_ID: 'WO-9', Role: 'vendor', Duration_Minutes: '120', Billable: 'TRUE', Active: 'TRUE', Billed_Bill_ID: '' },
  ]));
  await page.route('**/backcharge/add', r => {
    const b = JSON.parse(r.request().postData() || '{}'); calls.add.push(b);
    if (addMode === 'error') return J(r, { error: 'Time entry 11 is already on another back-charge' }, 409);
    bcRows = [{ ID: '5', WO_ID: 'WO-9', Vendor_ID: 'V-1', Hours: '1.5', Rate: '85', Amount: '127.50', Description: b.description, Status: 'pending' }];
    J(r, { success: true, id: '5', amount: '127.50', hours: 1.5, rate: 85, status: 'pending', bill_state: addMode === 'in_qb' ? 'in_qb' : 'not_billed_yet', qb_bills: addMode === 'in_qb' ? [{ bill_id: '555', bill_number: 'B-5' }] : [], warnings: [] });
  });
  await page.route('**/backcharge/apply-to-qb', r => {
    const b = JSON.parse(r.request().postData() || '{}'); calls.apply.push(b);
    if (b.preview_only) return J(r, { ok: true, preview: { backcharge_id: '5', qb_bill_id: '555', qb_bill_number: 'B-5', current_total: 1000, deduction: 127.5, new_total: 872.5, unapplied: 0 } });
    bcRows = bcRows.map(x => Object.assign({}, x, { Status: 'applied', QB_Bill_Number: 'B-5' }));
    J(r, { ok: true, qb_bill_id: '555', qb_bill_number: 'B-5', new_total: 872.5, deduction: 127.5, unapplied: 0 });
  });
  await page.route('**/backcharge/void', r => { calls.void.push(JSON.parse(r.request().postData() || '{}')); bcRows = []; J(r, { success: true, id: '5', warnings: [] }); });

  await page.goto('file://' + targetHtml, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  ok(errs.length === 0, 'no JS errors on load (' + errs.slice(0, 2).join(' | ') + ')');

  // host element with the real button markup
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="t" style="position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;background:#fff;z-index:99999;padding:16px">' + bcHostHtml('bc-t', 'WO-9', 'V-1', 'Cesar') + '</div>');
  });
  ok(await page.locator('#t button:has-text("Charge vendor")').isVisible(), 'Charge vendor button is visible');
  await page.locator('#t button:has-text("Charge vendor")').click();
  await page.waitForSelector('#bc-t input[type=checkbox]', { timeout: 3000 });
  ok((await page.locator('#bc-t input[type=checkbox]').count()) === 2, 'lists only YOUR unbilled hub time (2 of 3 entries; vendor time excluded)');
  ok((await page.locator('#bc-t-rate').inputValue()) === '85', 'rate defaults to $85');
  ok((await page.locator('#bc-t-desc').inputValue()) === 'Work completed by Brett, included in estimate', 'description defaults to the agreed text');
  await page.screenshot({ path: `/tmp/bc-${label}-open.png` });

  // tick both entries -> hours prefill 1.5
  const boxes = page.locator('#bc-t input[type=checkbox]');
  await boxes.nth(0).check(); await boxes.nth(1).check();
  ok((await page.locator('#bc-t-hrs').inputValue()) === '1.5', 'ticking time prefills hours (1.5)');

  // no horizontal scroll at this viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'no horizontal page scroll');

  // error from Worker is shown
  addMode = 'error';
  await page.locator('#bc-t-save').click();
  await page.waitForSelector('#bc-t >> text=already on another back-charge', { timeout: 3000 });
  ok(true, 'a Worker error is SHOWN in the panel, not swallowed');

  // happy path (bill not in QB yet)
  addMode = 'ok';
  await page.locator('#bc-t-save').click();
  await page.waitForSelector('#bc-t >> text=comes off automatically', { timeout: 3000 });
  const sent = calls.add[calls.add.length - 1];
  ok(sent.wo_id === 'WO-9' && sent.vendor_id === 'V-1' && sent.time_entry_ids.length === 2 && String(sent.hours) === '1.5' && String(sent.rate) === '85', 'Add posts wo, vendor, both time ids, hours 1.5, rate 85');
  ok(await page.locator('#bc-t-sum').innerText().then(t => /\$127\.50 back-charge pending/.test(t)), 'pending summary shows $127.50 under the button');
  ok(await page.locator('#bc-t >> text=−$127.50').count() > 0, 'the back-charge is listed as −$127.50 pending');
  ok(!(await page.content()).includes('avoid this in the future'), 'no "avoid this" lecture text anywhere in the UI');

  // void
  await page.locator('#bc-t button:has-text("Void")').first().click();
  await page.waitForTimeout(400);
  ok(calls.void.length === 1 && calls.void[0].id === '5', 'Void calls POST /backcharge/void with the id');

  // bill already in QB -> preview then confirm
  addMode = 'in_qb';
  await page.locator('#bc-t-hrs').fill('1.5');
  await page.locator('#bc-t-save').click();
  await page.waitForSelector('#bc-t >> text=Edit QuickBooks bill B-5', { timeout: 4000 });
  ok(calls.apply.length === 1 && calls.apply[0].preview_only === true, 'bill already in QB: first call is apply-to-qb with preview_only (nothing written)');
  ok(await page.locator('#bc-t').innerText().then(t => /\$1000\.00 → \$872\.50/.test(t) || /\$1000\.00 .* \$872\.50/.test(t)), 'preview shows the bill going $1000.00 → $872.50');
  await page.screenshot({ path: `/tmp/bc-${label}-confirm.png` });
  await page.locator('#bc-t button:has-text("Confirm")').click();
  await page.waitForSelector('#bc-t >> text=is now $872.50', { timeout: 4000 });
  ok(calls.apply.length === 2 && !calls.apply[1].preview_only && calls.apply[1].qb_bill_id === '555', 'Confirm tap sends the real apply-to-qb for that bill');

  // QB send preview shows the line
  const html = await page.evaluate(() => renderQBBillBlock({ total: 872.5, backcharges: [{ description: 'Work completed by Brett, included in estimate', hours: 1.5, rate: 85, applied: 127.5, unapplied: 0 }], skipped: false }, { display: 'Cesar' }));
  ok(/−\$127\.50/.test(html) && /Work completed by Brett, included in estimate/.test(html) && /\$872\.50/.test(html), 'QB send preview shows the negative line and the net total');
  const htmlFloor = await page.evaluate(() => renderQBBillBlock({ total: 0, backcharges: [{ description: 'x', hours: 0, rate: 0, applied: 60, unapplied: 40 }], skipped: false }, { display: 'Cesar' }));
  ok(/\$40\.00 of this could not be deducted/.test(htmlFloor), 'floor shortfall ($40) is called out in the preview');

  ok(errs.length === 0, 'no JS errors during the whole flow (' + errs.slice(0, 2).join(' | ') + ')');
  await browser.close();
}
(async () => {
  await run({ width: 412, height: 915 }, 'mobile');
  await run({ width: 1280, height: 800 }, 'desktop');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
