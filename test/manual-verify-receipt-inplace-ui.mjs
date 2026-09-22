// Headless verification: Receipt Reconciler actions update in place (Sep 22 2026).
// Brett: "it drives me crazy to have to scroll down through a whole bunch of receipts to get to the
// one I was just working on". Checks that Confirm / Skip / expense / duplicate actions do NOT
// reload the list, keep the scroll position, leave other cards (and anything typed in them) alone,
// and that a duplicate check only updates that card's evidence block. Also covers ↩ Move back to
// Pending on the Skipped tab. Mocks the worker; runs against the real receipt-reconciler.html.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '..', 'receipt-reconciler.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const rows = [];
for (let i = 1; i <= 14; i++) rows.push({
  ID: String(i), Status: 'pending', Vendor: 'Home Depot', Total: String(10 + i) + '.00', Receipt_Date: '2026-08-' + String(i).padStart(2, '0'),
  PO_Reference: '1111 E 43RD ST', Source_File_URL: 'https://x/' + i, items_summary: ['item ' + i],
  suggestion: { category: 'billable', action: 'suggest', property: { id: 'P1' } },
});
rows.push({ ID: '90', Status: 'skipped', Vendor: 'Surplus City', Total: '7.76', Receipt_Date: '2025-06-15', PO_Reference: '', Source_File_URL: 'https://x/90',
  Notes: 'Receipt dated 2025-06-15 is before the 2026-07-01 cutoff — skipped automatically. Tap "Move back to Pending" if you need it.', suggestion: { category: 'billable' } });

let queueCalls = 0;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === 'file:') return route.continue();
  const p = u.pathname;
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const send = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/receipt-recon/queue') { queueCalls++; const st = u.searchParams.get('status'); return send(rows.filter(r => st === 'all' || r.Status === st)); }
  if (p === '/workorders') return send([{ ID: 'WO-7', Property_ID: 'P1', Status: 'Assigned', Description: 'outlets' }]);
  if (p === '/properties') return send([{ ID: 'P1', Address: '1111 E 43rd St' }, { ID: '85', Address: '1864 Kerns School Rd' }]);
  if (p === '/units') return send([]);
  const row = body && rows.find(r => r.ID === body.id);
  if (p === '/receipt-recon/confirm') { row.Status = 'confirmed'; return send({ ok: true, success: true, id: 'R' + body.id, amount: body.amount, qb_email: body.no_wo ? { sent: true } : null,
    invoice_link: body.wo_id ? { linked: true, already_sent: true, new_customer_total: '99.00' } : null }); }
  if (p === '/receipt-recon/skip') { row.Status = 'skipped'; return send({ ok: true, id: body.id }); }
  if (p === '/receipt-recon/unskip') { row.Status = 'pending'; return send({ ok: true, id: body.id }); }
  if (p === '/receipt-recon/check-duplicates') return send({ ok: true, id: body.id, evidence: [{ signal: 'qb_invoice_line', reason: 'Already appears as a $15.00 line item on sent invoice #1705 (2026-08-20).' }] });
  if (p === '/receipt-recon/confirm-duplicate') { row.Status = 'duplicate'; return send({ ok: true }); }
  return send({});
});
await page.addInitScript(() => { localStorage.setItem('mh_auth', 'test-token'); });
await page.goto('file://' + pagePath);
await page.waitForSelector('#rc14');
const callsAfterLoad = queueCalls;

// Type into card 9 first (this scrolls), then scroll to card 8 and measure — must survive
await page.fill('#rc9-desc', 'typed by Brett');
await page.evaluate(() => { document.getElementById('rc8').scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); });
const y0 = await page.evaluate(() => window.scrollY);
const top8 = await page.evaluate(() => document.getElementById('rc8').getBoundingClientRect().top);

// 1. Skip card 8 — clicked via the DOM so Playwright doesn't scroll the page itself; any scroll
// change measured below is the app's own doing.
await page.evaluate(() => [...document.querySelectorAll('#rc8 button')].find(b => b.textContent.trim() === 'Skip').click());
await page.waitForFunction(() => !document.getElementById('rc8'));
await page.waitForTimeout(150);
ok(queueCalls === callsAfterLoad, 'Skip did not reload the list');
const y1 = await page.evaluate(() => window.scrollY);
ok(Math.abs(y1 - y0) < 5, `scroll position kept (${y0} → ${y1})`);
const top9 = await page.evaluate(() => document.getElementById('rc9').getBoundingClientRect().top);
ok(Math.abs(top9 - top8) < 30, 'the next receipt slid up into the same spot on screen');
ok(await page.inputValue('#rc9-desc') === 'typed by Brett', 'what was typed in the next card is untouched');
ok(/Skipped/.test(await page.textContent('#rc-toast')), 'result shown in the toast');
ok(/13 pending/.test(await page.textContent('#conn-status')), 'pending count went 14 → 13 without a reload');

// 2. Duplicate check on card 9 — only its evidence block changes; typed text + picks survive
await page.click('#rc9 button:has-text("Check duplicates")');
await page.waitForFunction(() => /invoice #1705/.test(document.getElementById('rc9-evidence').textContent));
ok(queueCalls === callsAfterLoad, 'duplicate check did not reload the list');
ok(await page.inputValue('#rc9-desc') === 'typed by Brett', 'duplicate check kept the typed description');
ok(await page.locator('#rc9 button:has-text("It\'s this one")').count() === 1, '"It\'s this one" button appears in place');
ok(await page.locator('#rc9 button:has-text("Check duplicates")').isEnabled(), 'Check duplicates can be tapped again');

// 3. "It's this one" → card leaves in place
await page.click('#rc9 button:has-text("It\'s this one")');
await page.waitForFunction(() => !document.getElementById('rc9'));
ok(queueCalls === callsAfterLoad, 'confirm-duplicate did not reload the list');

// 4. Confirm to a WO that was already invoiced — the warning must survive the card leaving
await page.selectOption('#rc10-wo', 'WO-7');
await page.click('#rc10 button:has-text("✓ Confirm")');
await page.waitForFunction(() => !document.getElementById('rc10'));
ok(/flagged for repair/.test(await page.textContent('#rc-toast')), 'the "already invoiced — flagged for repair" warning stays visible in the toast');

// 5. Expense tap
await page.click('#rc11 button:has-text("Ridge Co expense")');
await page.waitForFunction(() => !document.getElementById('rc11'));
ok(queueCalls === callsAfterLoad && /Sent to QuickBooks/.test(await page.textContent('#rc-toast')), 'expense tap: no reload, toast says Sent to QuickBooks');

// 6. Skipped tab: cutoff note + Move back to Pending
await page.click('.tab:has-text("Skipped")');
await page.waitForSelector('#rc90');
ok(/before the 2026-07-01 cutoff/.test(await page.textContent('#rc90')), 'skipped card shows why it was skipped');
const before = queueCalls;
await page.click('#rc90 button:has-text("Move back to Pending")');
await page.waitForFunction(() => !document.getElementById('rc90'));
ok(queueCalls === before && rows.find(r => r.ID === '90').Status === 'pending', 'Move back to Pending works without a reload');

// 7. Phone width: toast doesn't cause sideways scroll
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'no sideways scroll at phone width');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
