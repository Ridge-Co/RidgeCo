// Headless Playwright pass for Part 5 (Sep 22 2026, WO picker: link + open/close dates + a
// mismatch warning), at 390px (phone width). Loads the REAL receipt-reconciler.html, intercepts
// the Worker fetch calls with a fake queue/workorders/properties response, picks a WO in the
// picker on each row, and asserts the "Selected WO" detail panel actually renders — the link,
// the dates, and (only on the mismatched row) the warning — in a real browser executing the real
// shipped JS, not a static code read.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'receipt-reconciler.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const FAKE_ROWS = [
  {
    // Row 1: receipt dated well inside its WO's open→close window -> no warning expected.
    ID: '1', Status: 'pending', Vendor: 'Ace Hardware', Total: '12.50', Receipt_Date: '2026-08-15',
    Received_Date: '2026-08-15T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_URL: '', suggestion: { category: 'billable', action: 'need_property', property: { id: 'P1' } },
    items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [],
  },
  {
    // Row 2: receipt dated AFTER its WO's Completed_Date -> after_close warning expected.
    ID: '2', Status: 'pending', Vendor: 'Home Depot', Total: '56.04', Receipt_Date: '2026-09-25',
    Received_Date: '2026-09-25T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_URL: '', suggestion: { category: 'billable', action: 'need_property', property: { id: 'P1' } },
    items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [],
  },
];

const FAKE_PROPS = [{ ID: 'P1', Address: '3014 N Calvert St' }];
const FAKE_WOS = [
  { ID: '4021', Property_ID: 'P1', Status: 'In Progress', Description: 'Kitchen faucet repair', Created_Date: '2026-08-01', Completed_Date: '' },
  { ID: '4022', Property_ID: 'P1', Status: 'Invoiced', Description: 'Bathroom tile', Created_Date: '2026-08-01', Completed_Date: '2026-09-10' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.route('**/receipt-recon/queue*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_ROWS) }));
  await page.route('**/workorders', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_WOS) }));
  await page.route('**/properties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROPS) }));
  await page.route('**/units', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.waitForSelector('.rcard', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  ok(consoleErrors.length === 0, 'no JS errors while rendering the queue (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  // Row 1: pick the open, in-window WO (4021) via the select. No warning should appear, but the
  // link + opened date must.
  await page.selectOption('#rc1-wo', '4021');
  await page.waitForTimeout(100);
  const detail1 = await page.locator('#rc1-wo-detail').innerHTML();
  const detail1Text = await page.locator('#rc1-wo-detail').innerText();
  ok(/href="index\.html\?wo=4021"/.test(detail1) && /target="_blank"/.test(detail1), 'row 1 detail panel has a clickable link to index.html?wo=4021 (the existing admin WO deep-link, target=_blank)');
  ok(/opened 2026-08-01/.test(detail1Text.toLowerCase()), 'row 1 detail panel shows the WO\'s opened date (' + JSON.stringify(detail1Text) + ')');
  ok(!/⚠/.test(detail1Text), 'row 1 (receipt inside the WO\'s window) shows NO warning');

  // Row 2: pick the closed WO (4022, closed 2026-09-10) against a receipt dated 2026-09-25 ->
  // after_close warning must render. WO 4022 is Status=Invoiced (closed), so it only appears
  // once "show closed" is checked — same as any other closed-WO pick in this picker.
  await page.check('#rc2-showclosed');
  await page.waitForTimeout(100);
  await page.selectOption('#rc2-wo', '4022');
  await page.waitForTimeout(100);
  const detail2 = await page.locator('#rc2-wo-detail').innerHTML();
  const detail2Text = await page.locator('#rc2-wo-detail').innerText();
  ok(/href="index\.html\?wo=4022"/.test(detail2), 'row 2 detail panel links to index.html?wo=4022');
  ok(/closed 2026-09-10/.test(detail2Text.toLowerCase()), 'row 2 detail panel shows the WO\'s closed date');
  ok(/dated after this WO closed/.test(detail2Text) && /2026-09-10/.test(detail2Text), 'row 2 (receipt dated after WO closed) shows the inline mismatch warning (' + JSON.stringify(detail2Text) + ')');

  // Warning is advisory only — Confirm must still be present/enabled on the mismatched row, never
  // blocked by the warning.
  const confirmBtn2 = await page.locator('#rc2 button:has-text("Confirm")').count();
  ok(confirmBtn2 > 0, 'row 2 still offers Confirm despite the warning — advisory only, never a block');

  // The dropdown OPTION text itself also carries the dates + a ⚠ marker, visible while browsing
  // before a selection is made (an <option> can't hold a link, so this is text-only).
  const optionTexts = await page.locator('#rc2-wo option').allTextContents();
  const flaggedOption = optionTexts.find(t => t.includes('4022'));
  ok(!!flaggedOption && /closed 2026-09-10/.test(flaggedOption) && /⚠/.test(flaggedOption), 'the WO 4022 <option> itself shows its closed date and a ⚠ marker (' + JSON.stringify(flaggedOption) + ')');
  const cleanOption = optionTexts.find(t => t.includes('4021'));
  ok(!!cleanOption && !/⚠/.test(cleanOption), 'the WO 4021 <option> (no mismatch for either row) carries no ⚠ marker');

  // 390px layout sanity: the new detail panel must not force horizontal scroll.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  ok(scrollWidth <= clientWidth + 2, `no horizontal overflow at 390px (scrollWidth ${scrollWidth} vs clientWidth ${clientWidth})`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
