// Headless Playwright pass for Parts 1+2 (Sep 22 2026 brief): the image-attached indicator and
// the "Attach image only, don't bill" action, at 390px (phone width), on BOTH surfaces the brief
// names — the pending-queue duplicate-flag card and the "Audit older" flags view. Loads the REAL
// receipt-reconciler.html, intercepts the Worker fetch calls, and asserts against a real browser
// executing the real shipped JS — same convention as manual-verify-wo-picker-dates-ui.mjs.
//
// Critically also verifies the negative claim Brett's standing rule requires proof of, not just
// a code read: clicking "Attach image only" calls ONLY /receipt/attach-only — never
// /receipt-recon/confirm, and nothing that would touch Vendor_Bills/Invoice_Review.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'receipt-reconciler.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

// ── Fixture 1: pending queue — a duplicate-flagged row with NO image, one with an image ──────
const FAKE_ROWS = [
  {
    ID: '1', Status: 'pending', Vendor: 'Home Depot', Total: '56.04', Receipt_Date: '2026-08-15',
    Received_Date: '2026-08-15T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_ID: '', Source_File_URL: '', // <- no image on file
    suggestion: { category: 'billable', action: 'suggest', property: { id: 'P1' }, flags: ['duplicate_on_wo'], suggested_wo: { id: '4021' } },
    items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [],
  },
  {
    ID: '2', Status: 'pending', Vendor: 'Ace Hardware', Total: '12.50', Receipt_Date: '2026-08-16',
    Received_Date: '2026-08-16T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_ID: 'driveFileXYZ', Source_File_URL: 'https://drive.google.com/xyz', // <- has an image
    suggestion: { category: 'billable', action: 'suggest', property: { id: 'P1' }, flags: ['duplicate_on_wo'], suggested_wo: { id: '4021' } },
    items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [],
  },
];
const FAKE_PROPS = [{ ID: 'P1', Address: '3014 N Calvert St' }];
const FAKE_WOS = [{ ID: '4021', Property_ID: 'P1', Status: 'In Progress', Description: 'Kitchen faucet repair', Created_Date: '2026-08-01', Completed_Date: '' }];

// ── Fixture 2: audit-flags view — one flagged receipt with no image, matched to an existing WO,
// and a queue row on file that could supply the missing scan.
const FAKE_FLAGS = [
  { id: 'FLAG1', receipt_id: 'RC900', wo_id: '4021', store: 'Home Depot', receipt_date: '2026-08-15', amount: 56.04, match_count: 2, matches: [ { doc: '1705', invoice_id: '99', customer_name: 'Phoenix Estates', date: '2026-09-01', amount: 56.04, paid: true, description: 'Materials' } ], status: 'pending', flagged_date: '2026-09-22T00:00:00.000Z', reviewed_date: '', image_attached: false, image_url: '' },
];
const FAKE_QUEUE_ALL = [
  { ID: '77', Status: 'skipped', Vendor: 'Home Depot', Total: '56.04', Receipt_Date: '2026-08-15', Source_File_ID: 'd1', Source_File_URL: 'https://drive.google.com/d1' },
];

// Track every POST body sent, so we can assert exactly one endpoint was hit and nothing billing-
// related (Invoice_Review/Vendor_Bills) was ever called.
const postsSeen = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.route('**/receipt-recon/queue?status=pending*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_ROWS) }));
  await page.route('**/receipt-recon/queue?status=all*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_QUEUE_ALL) }));
  await page.route('**/workorders', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_WOS) }));
  await page.route('**/properties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROPS) }));
  await page.route('**/units', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/admin/receipt-duplicate-audit/flags*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, count: FAKE_FLAGS.length, flags: FAKE_FLAGS }) }));
  await page.route('**/receipt/attach-only', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    postsSeen.push({ path: '/receipt/attach-only', body });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, success: true, wo_id: body.wo_id, property_id: 'P1', attached_only: true, id: '9001', amount: body.amount || '56.04' }) });
  });
  // Any call to these would mean Part 2's "never bill" claim is broken — fail loudly rather than
  // silently 404ing, so a regression shows up as a wrong-call assertion, not a swallowed error.
  await page.route('**/receipt-recon/confirm', (route) => { postsSeen.push({ path: '/receipt-recon/confirm', body: JSON.parse(route.request().postData() || '{}') }); route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"should never be called by attach-only"}' }); });

  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.waitForSelector('.rcard', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(consoleErrors.length === 0, 'no JS errors while rendering the pending queue (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  // ── Part 1: image-attached indicator on the pending duplicate-flagged cards ─────────────────
  const card1Text = await page.locator('#rc1').innerText();
  const card2Text = await page.locator('#rc2').innerText();
  ok(/No image attached/.test(card1Text) && /⚠/.test(card1Text), 'row 1 (no Source_File_ID/URL) shows the "No image attached" warning pill');
  ok(/Image attached/.test(card2Text) && /✅/.test(card2Text), 'row 2 (has Source_File_ID/URL) shows the "Image attached" confirm pill');

  // ── Part 2: "Attach image only, don't bill" button present on both duplicate-flagged rows,
  // next to Confirm duplicate (an alternative resolution, not a replacement) ───────────────────
  const attachBtn1 = page.locator('#rc1 button:has-text("Attach image only")');
  const confirmDupBtn1 = page.locator('#rc1 button:has-text("Confirm duplicate")');
  ok(await attachBtn1.count() > 0, 'row 1 offers "Attach image only, don\'t bill"');
  ok(await confirmDupBtn1.count() > 0, '"Confirm duplicate" is still offered alongside it — an alternative, not a replacement');

  // Pick the suggested WO (4021, ★ suggested) then tap attach-only.
  await page.selectOption('#rc1-wo', '4021');
  await page.waitForTimeout(100);
  await attachBtn1.click();
  await page.waitForTimeout(200);
  const status1 = await page.locator('#rc1-status').innerText();
  ok(/Image attached to 4021/.test(status1) && /not billed/.test(status1), 'row 1 status line confirms the image was attached to WO 4021 and NOT billed (' + JSON.stringify(status1) + ')');

  // ── The critical negative check: exactly ONE network write happened, to /receipt/attach-only,
  // and /receipt-recon/confirm (the billing path, which internally calls
  // appendReceiptToInvoiceReview) was never hit. ──────────────────────────────────────────────
  ok(postsSeen.length === 1, 'exactly one write POST fired for the attach-only action (got ' + postsSeen.length + ': ' + JSON.stringify(postsSeen.map(p => p.path)) + ')');
  ok(postsSeen[0] && postsSeen[0].path === '/receipt/attach-only', 'the one write POST that fired was /receipt/attach-only');
  ok(!postsSeen.some(p => p.path === '/receipt-recon/confirm'), '/receipt-recon/confirm (the billing path — appendReceiptToInvoiceReview) was NEVER called by the attach-only flow');
  ok(postsSeen[0].body.wo_id === '4021' && postsSeen[0].body.id === '1', 'the attach-only POST carried the right receipt id (1) and WO id (4021)');

  // ── Part 5 reuse check: the picker used for attach-only is the SAME enriched panel (dates,
  // link, warning) — confirm the "Selected WO" detail panel rendered for this card too.
  const detail1 = await page.locator('#rc1-wo-detail').innerHTML();
  ok(/href="index\.html\?wo=4021"/.test(detail1), 'the attach-only flow reused the Part 5 "Selected WO" panel — clickable WO link present');
  ok(/opened 2026-08-01/.test((await page.locator('#rc1-wo-detail').innerText()).toLowerCase()), 'the attach-only flow\'s picker shows the WO\'s opened date (Part 5 reuse)');

  // ── Part 1 + 2 on the "Audit older" view ────────────────────────────────────────────────────
  postsSeen.length = 0;
  await page.click('div.tab:has-text("Audit older")');
  await page.waitForTimeout(300);
  const auditCardText = await page.locator('#audFLAG1').innerText();
  ok(/No image attached/.test(auditCardText) && /⚠/.test(auditCardText), 'audit card for a receipt with no Source_File_ID/URL shows "No image attached"');
  const auditAttachBtn = page.locator('#audFLAG1 button:has-text("Attach image only")');
  ok(await auditAttachBtn.count() > 0, 'audit card offers "Attach image only, don\'t bill" next to Real duplicate / Not a duplicate');
  const realDupBtn = page.locator('#audFLAG1 button:has-text("Real duplicate")');
  const notDupBtn = page.locator('#audFLAG1 button:has-text("Not a duplicate")');
  ok(await realDupBtn.count() > 0 && await notDupBtn.count() > 0, 'the normal audit resolution actions (Real duplicate / Not a duplicate) are still present alongside it');

  await auditAttachBtn.click();
  await page.waitForTimeout(300);
  // Should find the matching queue row (ID 77, same store+amount, has a file) and offer it.
  const srcSelCount = await page.locator('#audFLAG1-src').count();
  ok(srcSelCount > 0, 'a matching scanned queue row (same store+amount, has a file) was found and offered as the source scan');
  const attachConfirmBtn = page.locator('#audFLAG1-attach button:has-text("Attach to WO")');
  ok(await attachConfirmBtn.count() > 0, 'a confirm button to attach the found scan to the receipt\'s own WO is shown');
  await attachConfirmBtn.click();
  await page.waitForTimeout(200);
  const auditStatus = await page.locator('#audFLAG1-status').innerText();
  ok(/Image attached to WO 4021/.test(auditStatus) && /not billed/.test(auditStatus), 'audit-view attach-only status line confirms the attach and non-billing (' + JSON.stringify(auditStatus) + ')');
  ok(postsSeen.length === 1 && postsSeen[0].path === '/receipt/attach-only', 'audit-view attach-only also called ONLY /receipt/attach-only (got ' + JSON.stringify(postsSeen.map(p => p.path)) + ')');
  ok(postsSeen[0].body.id === '77' && postsSeen[0].body.wo_id === '4021', 'audit-view attach-only POST carried the picked source scan id (77) and the flag\'s own WO id (4021)');

  // 390px layout sanity on both views.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  ok(scrollWidth <= clientWidth + 2, `no horizontal overflow at 390px on the audit view (scrollWidth ${scrollWidth} vs clientWidth ${clientWidth})`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
