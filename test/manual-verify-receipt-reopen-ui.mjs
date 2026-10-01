// Headless verification for the Oct 1 2026 Receipt Reconciler Re-open button + customer-folder-copy
// failure banner. Mocks the worker endpoints so this runs offline against the real receipt-reconciler.html.
// Checks: (1) confirmed cards show "↩ Re-open (already sent to QB)", (2) it asks via a native confirm()
// that says the receipt was already emailed to QuickBooks and will NOT be re-sent, (3) Cancel posts
// nothing, (4) OK posts /receipt-recon/reopen {id}, (5) a 409 (invoice already sent) is shown as an error
// and the card stays, (6) a confirm whose response has folder_copy:'failed:...' shows the sticky warning
// banner, and a folder_copy:'ok' response shows none.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '..', 'receipt-reconciler.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const confirmed = [
  { ID: '21', Status: 'confirmed', Vendor: 'Home Depot', Total: '50.22', Receipt_Date: '2026-09-04', Confirmed_WO_ID: 'WO-1', Source_File_URL: 'https://x/1', suggestion: { category: 'billable' } },
  { ID: '22', Status: 'confirmed', Vendor: 'Lowes', Total: '18.13', Receipt_Date: '2026-08-24', Confirmed_WO_ID: 'WO-2', Source_File_URL: 'https://x/2', suggestion: { category: 'billable' } },
];
const pending = [
  { ID: '31', Status: 'pending', Vendor: 'Lowes', Total: '9.99', Receipt_Date: '2026-09-05', PO_Reference: '', Source_File_URL: 'https://x/3', items_summary: ['tape'], suggestion: { category: 'billable', action: 'suggest' } },
  { ID: '32', Status: 'pending', Vendor: 'Lowes', Total: '8.88', Receipt_Date: '2026-09-05', PO_Reference: '', Source_File_URL: 'https://x/4', items_summary: ['nails'], suggestion: { category: 'billable', action: 'suggest' } },
];
const posted = [];
let folderCopyResult = 'failed:share failed (403): nope';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], dialogs = [];
page.on('pageerror', e => errors.push(String(e)));
let dialogAnswer = false;
page.on('dialog', async d => { dialogs.push(d.message()); if (dialogAnswer) await d.accept(); else await d.dismiss(); });
await page.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === 'file:') return route.continue();
  const p = u.pathname;
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const send = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/receipt-recon/queue') return send(u.searchParams.get('status') === 'confirmed' ? confirmed : pending);
  if (p === '/workorders') return send([{ ID: 'WO-1', Property_ID: 'P1', Status: 'Assigned', Description: 'drain' }, { ID: 'WO-2', Property_ID: 'P1', Status: 'Assigned', Description: 'sink' }]);
  if (p === '/properties') return send([{ ID: 'P1', Address: '1577 Ingleside Ave' }]);
  if (p === '/units') return send([]);
  if (p === '/receipt-recon/reopen') {
    posted.push({ p, body });
    if (body.id === '22') return send({ error: 'Work order WO-2 is already invoiced in QuickBooks (invoice 77). Re-opening here would leave QuickBooks and the customer\'s invoice out of sync - fix it in QuickBooks directly.', invoice_sent: true }, 409);
    return send({ ok: true, id: body.id, voided_receipt_id: '700', qb_email_will_not_resend: true });
  }
  if (p === '/receipt-recon/confirm') {
    posted.push({ p, body });
    return send({ ok: true, success: true, id: 'R' + body.id, amount: body.amount, invoice_link: { linked: true }, folder_copy: folderCopyResult });
  }
  return send({});
});
await page.addInitScript(() => { localStorage.setItem('mh_auth', 'test-token'); });
await page.goto('file://' + pagePath);
await page.waitForSelector('#rc31');

// ── Re-open on the Confirmed tab ───────────────────────────────────────────────────────────────
await page.click('.tab:has-text("Confirmed")');
await page.waitForSelector('#rc21');
ok(await page.locator('#rc21 button:has-text("↩ Re-open (already sent to QB)")').count() === 1, 'confirmed card shows the "↩ Re-open (already sent to QB)" button');
ok(await page.locator('#rc21 button:has-text("Undo confirmation")').count() === 1, 'Undo confirmation is still there too');
const btnBox = await page.locator('#rc21 button:has-text("Re-open")').boundingBox();
ok(btnBox && btnBox.height >= 28, 'Re-open button has a usable tap height (' + (btnBox && Math.round(btnBox.height)) + 'px)');

dialogAnswer = false;
await page.click('#rc21 button:has-text("Re-open")');
await page.waitForTimeout(300);
ok(dialogs.length === 1 && /already emailed to QuickBooks/.test(dialogs[0]) && /NOT be sent it again/.test(dialogs[0]), 'confirm dialog says it was already emailed to QuickBooks and will NOT be re-sent');
ok(posted.length === 0, 'Cancel on the dialog posts nothing');

dialogAnswer = true;
await page.click('#rc21 button:has-text("Re-open")');
await page.waitForFunction(() => !document.querySelector('#rc21'), null, { timeout: 5000 });
ok(posted.length === 1 && posted[0].p === '/receipt-recon/reopen' && posted[0].body.id === '21', 'OK posts /receipt-recon/reopen with the queue id');
ok(/QuickBooks will NOT be emailed again/.test(await page.textContent('#rc-toast')), 'result toast says QuickBooks will not be emailed again');

// 409: invoice already sent -> error shown on the card, card stays
await page.click('#rc22 button:has-text("Re-open")');
await page.waitForFunction(() => /already invoiced in QuickBooks|already invoiced/.test(document.querySelector('#rc22-status')?.textContent || ''));
ok(await page.locator('#rc22').count() === 1, '409 (invoice already sent): the card stays');
ok(/already invoiced/.test(await page.textContent('#rc22-status')), '409 error text is shown on the card');
ok(await page.locator('#rc22 button:has-text("Re-open")').isEnabled(), 'button re-enabled after the failure');

// ── folder_copy failure banner ─────────────────────────────────────────────────────────────────
await page.click('.tab:has-text("Pending")');
await page.waitForSelector('#rc31');
ok(await page.locator('#rc-folder-warn').count() === 0, 'no banner before anything fails');
await page.evaluate(() => { const m = document.getElementById('rc31-wo-manual'); if (m) m.value = 'WO-1'; });
await page.click('#rc31 button:has-text("Confirm")');
await page.waitForSelector('#rc-folder-warn');
const warn = await page.textContent('#rc-folder-warn');
ok(/copy into the customer work-order folder FAILED/.test(warn) && /share failed/.test(warn), 'failed folder copy shows a visible sticky warning with the reason');
const posN = await page.evaluate(() => getComputedStyle(document.getElementById('rc-folder-warn')).position);
ok(posN === 'sticky', 'banner is sticky (stays on screen, not a 9-second toast)');
await page.waitForTimeout(500);
ok(await page.locator('#rc-folder-warn').count() === 1, 'banner is still there after the toast window starts');
await page.click('#rc-folder-warn a:has-text("dismiss")');
ok(await page.locator('#rc-folder-warn').count() === 0, 'dismiss removes the banner');

folderCopyResult = 'ok';
await page.evaluate(() => { const m = document.getElementById('rc32-wo-manual'); if (m) m.value = 'WO-1'; });
await page.click('#rc32 button:has-text("Confirm")');
await page.waitForFunction(() => !document.querySelector('#rc32'), null, { timeout: 5000 });
ok(await page.locator('#rc-folder-warn').count() === 0, "folder_copy:'ok' shows no warning");

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
ok(!overflow, 'no sideways scroll at phone width');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await page.screenshot({ path: process.env.SHOT || '/tmp/rr-reopen.png' }).catch(() => {});
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
