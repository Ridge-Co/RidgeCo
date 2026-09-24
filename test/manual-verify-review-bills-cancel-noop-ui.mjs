// Headless Playwright pass for CAP-036 #15 (Sep 24 2026, real incident: Eddie Smith's bill):
// Review Bills / "Send to QuickBooks" confirm modal — pressing Cancel used to close the modal
// only, leaving the approval that "Approve & send to QuickBooks" already made in place, which
// silently removed the bill from Review Bills with no visible way back. Loads the REAL
// index.html, intercepts the Worker fetch calls, drives the real shipped previewQBSend/
// cancelQBSend functions in a real browser, and asserts:
//
//   1. When the QuickBooks preview modal was opened by a FRESH approval in this same click
//      (previewQBSend(id, true) — exactly what invBillThisJob does), pressing Cancel calls
//      POST /invoice-review/unapprove for that id (undoing the approval) and tells the user the
//      bill is back in Review Bills, untouched.
//   2. When the modal was opened for a bill that was ALREADY approved from an earlier sitting
//      (previewQBSend(id) with no second argument — exactly what the Send-to-QB queue's own
//      "Preview & Send" button does), pressing Cancel does NOT call unapprove — that approval
//      predates this click and must be left alone, same as it always has been.
//   3. Either way, Cancel never calls the real send endpoint (/qb/send-invoice with no
//      preview_only) — nothing is created in QuickBooks.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'index.html');
const HTML_ARG = process.argv[2];
const targetHtml = HTML_ARG || htmlPath;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const unapproveCalls = [];
const realSendCalls = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });

  await page.route('**/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/hub-bootstrap', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ properties: [], units: [], tenants: [], vendors: [], workorders: [], invoices: [], owners: [], keys: [] }),
  }));
  await page.route('**/pricing-config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.route('**/notifications/pending', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/wishlist', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.route('**/qb/send-invoice', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (!body.preview_only) realSendCalls.push(body);
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        preview: {
          customer: { display: 'Test Owner' }, vendor: { display: 'Eddie Smith' }, trade: 'Plumbing',
          invoice: { lines: [{ desc: 'Job', amount: 185 }], total: 185 },
          bill: { total: 150 }, bill_to: {}, warnings: [],
        },
      }),
    });
  });
  await page.route('**/invoice-review/unapprove', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    unapproveCalls.push(body);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: body.id, wo_id: 'WO-1234', bill_id: 'B-1', bill_restored: true }) });
  });
  await page.route('**/vendor-bills*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/qb/ready*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('file://' + targetHtml, { waitUntil: 'load' });
  await page.waitForSelector('#app', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(consoleErrors.length === 0, 'no JS errors loading + logging into the Hub (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  // ── Case 1: a bill just approved by THIS click (the real Eddie Smith scenario) ────────────────────────
  await page.evaluate(() => window.previewQBSend('IR-EDDIE-1', true));
  await page.waitForSelector('#modal-qb-send.open', { timeout: 3000 });
  await page.waitForTimeout(150);
  await page.locator('#modal-qb-send .modal-actions button:has-text("Cancel")').click();
  await page.waitForTimeout(150);

  ok(!(await page.locator('#modal-qb-send').evaluate((el) => el.classList.contains('open'))), 'Case 1: the modal actually closes on Cancel');
  ok(unapproveCalls.length === 1 && unapproveCalls[0].id === 'IR-EDDIE-1', 'Case 1: Cancel called POST /invoice-review/unapprove for the bill that was JUST approved by this click (got: ' + JSON.stringify(unapproveCalls) + ')');
  ok(realSendCalls.length === 0, 'Case 1: Cancel never called the real (non-preview) /qb/send-invoice — nothing created in QuickBooks');
  const toastText1 = await page.locator('.toast').last().textContent().catch(() => '');
  ok(/back in Review Bills/.test(toastText1 || ''), 'Case 1: the user is told the bill is back in Review Bills, untouched (got: ' + JSON.stringify(toastText1) + ')');

  // ── Case 2: a bill that was ALREADY approved before this click (Send-to-QB queue's own path) ──
  unapproveCalls.length = 0; realSendCalls.length = 0;
  await page.evaluate(() => window.previewQBSend('IR-OLD-APPROVAL-2'));
  await page.waitForSelector('#modal-qb-send.open', { timeout: 3000 });
  await page.waitForTimeout(150);
  await page.locator('#modal-qb-send .modal-actions button:has-text("Cancel")').click();
  await page.waitForTimeout(150);

  ok(!(await page.locator('#modal-qb-send').evaluate((el) => el.classList.contains('open'))), 'Case 2: the modal closes on Cancel');
  ok(unapproveCalls.length === 0, 'Case 2: Cancel does NOT call unapprove for a bill approved before this click — that approval is left alone (got: ' + JSON.stringify(unapproveCalls) + ')');
  ok(realSendCalls.length === 0, 'Case 2: Cancel never called the real /qb/send-invoice either');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
