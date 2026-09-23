// Headless Playwright pass for the Part 0 rescan-guard UI (Sep 22 2026), at 390px (phone width).
// Loads the REAL receipt-reconciler.html, intercepts the Worker fetch calls with a fake
// /receipt-recon/queue response (one clean pending row, one flagged-rescan pending row, one
// email-scanned row, one manually-dropped row) and asserts the new entry-source label and the
// rescan warning banner actually render — this is a real browser executing the real shipped JS,
// not a static code read.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'receipt-reconciler.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const FAKE_ROWS = [
  {
    ID: '1', Status: 'pending', Vendor: 'Ace Hardware', Total: '12.50', Receipt_Date: '2026-09-19',
    Received_Date: '2026-09-19T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_URL: '', suggestion: { category: 'billable', action: 'need_property' }, items: [], items_summary: [],
    duplicate_evidence: [], rescan_matches: [],
  },
  {
    // The Sep 22 8:05pm incident, reproduced in the UI: a $56.04 Home Depot receipt that matches
    // an already-confirmed Receipts row.
    ID: '2', Status: 'pending', Vendor: 'Home Depot', Total: '56.04', Receipt_Date: '2026-09-20',
    Received_Date: '2026-09-22T20:05:00.000Z', Entry_Source: 'email_scan', PO_Reference: '3014 N Calvert',
    Source_File_URL: 'https://drive.example/x', suggestion: { category: 'billable', action: 'need_property' },
    items: [], items_summary: [], duplicate_evidence: [],
    rescan_matches: [{ type: 'receipts', receipt_id: 'R900', wo_id: '4021', date: '2026-09-20', amount: '56.04', store: 'Home Depot',
      reason: 'Possible re-scan — matches an already-processed receipt from 2026-09-20 ($56.04 at Home Depot, WO 4021).' }],
  },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.route('**/receipt-recon/queue*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_ROWS) }));
  await page.route('**/workorders', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/properties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/units', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.waitForSelector('.rcard', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  ok(consoleErrors.length === 0, 'no JS errors while rendering the queue (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  const cardCount = await page.locator('.rcard').count();
  ok(cardCount === 2, 'both fake rows rendered as cards (got ' + cardCount + ')');

  // Row 1: clean, manual_drop — entry-source label visible, no rescan banner.
  const card1Text = await page.locator('#rc1').innerText();
  ok(/dropped in Drive manually, 2026-09-19/.test(card1Text), 'row 1 shows the manual-drop entry-source label (' + JSON.stringify(card1Text.slice(0, 120)) + ')');
  ok(!/Possible re-scan/.test(card1Text), 'row 1 (no match) shows no rescan warning');

  // Row 2: the $56.04 HD incident — entry-source AND the rescan warning banner, visible on a
  // still-PENDING card (this is the whole point: it must not be hidden until Skip/Confirm).
  const card2Text = await page.locator('#rc2').innerText();
  ok(/via email scan, 2026-09-22/.test(card2Text), 'row 2 shows the email-scan entry-source label');
  ok(/Possible re-scan.*already-processed receipt from 2026-09-20/.test(card2Text.replace(/\n/g, ' ')), 'row 2 shows the rescan warning with the matched date, visible while still Pending');
  ok(/WO 4021/.test(card2Text), 'the warning references the matched WO so Brett can cross-check in one glance');

  // The row must still be a normal actionable Pending card — Confirm/Skip still present (never
  // auto-skipped by the flag).
  const hasConfirm = await page.locator('#rc2 button:has-text("Check duplicates")').count();
  const hasSkip = await page.locator('#rc2 button:has-text("Skip")').count();
  ok(hasConfirm > 0 && hasSkip > 0, 'flagged row still offers normal actions — the flag never removes Brett\'s own decision');

  // 390px layout sanity: the warning banner must not force horizontal scroll.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  ok(scrollWidth <= clientWidth + 2, `no horizontal overflow at 390px (scrollWidth ${scrollWidth} vs clientWidth ${clientWidth})`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
