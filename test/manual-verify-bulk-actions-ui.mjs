// Headless Playwright pass for Part 4 (Sep 22 2026 brief): bulk-select checkboxes + bulk-actions
// bar on the Receipt Reconciler, at 390px (phone width). Loads the REAL receipt-reconciler.html,
// intercepts the Worker fetch calls, and asserts against a real browser executing the real
// shipped JS — same convention as manual-verify-attach-only-ui.mjs / manual-verify-wo-picker-dates-ui.mjs.
//
// Covers:
//   1. Checking rows shows the bulk-actions bar with the right count; unchecking hides it.
//   2. Switching status tabs clears the selection (the rule 184-185 scoping discipline applied
//      to this page's own single #list container — a selection from one view must never survive
//      into a different view's bulk action).
//   3. A full bulk action (bulk-skip) actually calls the real batched endpoint
//      (/receipt-recon/bulk-action) with the checked ids and the right action, and the UI
//      reflects the result (toast + list reload).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'receipt-reconciler.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const PENDING_ROWS = [
  { ID: '1', Status: 'pending', Vendor: 'Home Depot', Total: '10.00', Receipt_Date: '2026-08-15', Received_Date: '2026-08-15T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '', Source_File_ID: '', Source_File_URL: '', suggestion: { category: 'billable', action: 'suggest', property: {}, flags: [] }, items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [] },
  { ID: '2', Status: 'pending', Vendor: 'Lowes', Total: '20.00', Receipt_Date: '2026-08-16', Received_Date: '2026-08-16T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '', Source_File_ID: '', Source_File_URL: '', suggestion: { category: 'billable', action: 'suggest', property: {}, flags: [] }, items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [] },
  { ID: '3', Status: 'pending', Vendor: 'Ace Hardware', Total: '30.00', Receipt_Date: '2026-08-17', Received_Date: '2026-08-17T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '', Source_File_ID: '', Source_File_URL: '', suggestion: { category: 'billable', action: 'suggest', property: {}, flags: [] }, items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [] },
];
const SKIPPED_ROWS = [
  { ID: '9', Status: 'skipped', Vendor: 'Surplus City', Total: '5.00', Receipt_Date: '2026-08-10', Received_Date: '2026-08-10T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '', Notes: '', suggestion: {}, items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [] },
];
const FAKE_PROPS = [{ ID: 'P1', Address: '1864 Kerns School Rd' }];

const bulkActionCalls = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.route('**/receipt-recon/queue?status=pending*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PENDING_ROWS) }));
  await page.route('**/receipt-recon/queue?status=skipped*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SKIPPED_ROWS) }));
  await page.route('**/workorders', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/properties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROPS) }));
  await page.route('**/units', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/receipt-recon/bulk-action', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    bulkActionCalls.push(body);
    const succeeded = body.ids.map((id) => ({ id, result: { ok: true } }));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, action: body.action, processed: body.ids.length, succeeded, failed: [], remaining_ids: [], remaining: 0 }) });
  });

  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.waitForSelector('.rcard', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(consoleErrors.length === 0, 'no JS errors while rendering the pending queue with checkboxes (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  // 1. Bar hidden with nothing checked
  const barHiddenInitially = await page.evaluate(() => getComputedStyle(document.getElementById('rc-bulk-bar')).display === 'none');
  ok(barHiddenInitially, 'bulk-actions bar is hidden when nothing is checked');

  const checkboxCount = await page.locator('#list .rc-check').count();
  ok(checkboxCount === 3, 'all 3 pending rows have their own checkbox (found ' + checkboxCount + ')');

  // 2. Check two rows -> bar appears with count 2
  await page.locator('#list .rc-check').nth(0).check();
  await page.locator('#list .rc-check').nth(1).check();
  await page.waitForTimeout(50);
  const barVisibleAfterCheck = await page.evaluate(() => getComputedStyle(document.getElementById('rc-bulk-bar')).display !== 'none');
  ok(barVisibleAfterCheck, 'bulk-actions bar appears once >=1 row is checked');
  const countLabel = await page.locator('#rc-bulk-count').innerText();
  ok(countLabel.trim() === '2 selected', 'count label reads "2 selected" (got "' + countLabel.trim() + '")');

  // 3. Uncheck both -> bar hides again
  await page.locator('#list .rc-check').nth(0).uncheck();
  await page.locator('#list .rc-check').nth(1).uncheck();
  await page.waitForTimeout(50);
  const barHiddenAfterUncheck = await page.evaluate(() => getComputedStyle(document.getElementById('rc-bulk-bar')).display === 'none');
  ok(barHiddenAfterUncheck, 'unchecking every row hides the bulk-actions bar again');

  // 4. Check a row, then switch to a DIFFERENT status tab (Skipped) — the different view's own
  // checkboxes must start fresh, unaffected by the pending tab's selection (rule 184-185
  // scoping discipline: a checkbox from one page/view must never ride along into another).
  await page.locator('#list .rc-check').nth(0).check();
  await page.waitForTimeout(50);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('rc-bulk-bar')).display !== 'none'), 'bar visible after checking a row on the Pending tab');
  await page.locator('.tab', { hasText: 'Skipped' }).click();
  await page.waitForSelector('.rcard', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const barHiddenOnNewTab = await page.evaluate(() => getComputedStyle(document.getElementById('rc-bulk-bar')).display === 'none');
  ok(barHiddenOnNewTab, 'switching to the Skipped tab clears the previous tab\'s selection — bar starts hidden, not carrying over the Pending count');
  const skippedCheckboxesUnchecked = await page.locator('#list .rc-check:checked').count();
  ok(skippedCheckboxesUnchecked === 0, 'no checkbox on the new (Skipped) view is pre-checked from the old selection');

  // 5. Check the skipped row and fire a real bulk action (move_to_pending) — verify it hits the
  // real batched endpoint with the right ids/action, and the bar clears afterward.
  page.once('dialog', (d) => d.accept());
  await page.locator('#list .rc-check').nth(0).check();
  await page.waitForTimeout(50);
  await page.route('**/receipt-recon/queue?status=skipped*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.locator('#rc-bulk-bar').getByRole('button', { name: /Move back to Pending/ }).click();
  await page.waitForTimeout(300);
  ok(bulkActionCalls.length === 1, 'exactly one call to /receipt-recon/bulk-action fired (got ' + bulkActionCalls.length + ')');
  if (bulkActionCalls[0]) {
    ok(bulkActionCalls[0].action === 'move_to_pending', 'the call carries action="move_to_pending"');
    ok(Array.isArray(bulkActionCalls[0].ids) && bulkActionCalls[0].ids.length === 1 && bulkActionCalls[0].ids[0] === '9', 'the call carries exactly the checked row\'s id ("9")');
  }
  const barHiddenAfterAction = await page.evaluate(() => getComputedStyle(document.getElementById('rc-bulk-bar')).display === 'none');
  ok(barHiddenAfterAction, 'bulk-actions bar hides again once the bulk action completes and the selection is cleared');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
