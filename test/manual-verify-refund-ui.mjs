// Headless Playwright pass for Part 3 (Sep 22 2026 brief): refund detection/matching/reversal in
// the Reconciler UI, at 390px (phone width). Loads the REAL receipt-reconciler.html, intercepts
// the Worker fetch calls, and asserts against a real browser executing the real shipped JS — same
// convention as manual-verify-attach-only-ui.mjs / manual-verify-wo-picker-dates-ui.mjs.
//
// Covers three things end to end:
//  1. A refund row shows the 🔄 REFUND badge and a negative pre-filled amount (never a positive
//     charge for a receipt that's actually money coming back).
//  2. "Find matching purchase" -> a candidate renders -> "This matches — reverse the billed
//     amount" fires a native confirm() dialog, then calls ONLY /receipt-recon/refund-reverse
//     (never /receipt-recon/confirm or /receipt/attach-only) with the right ids.
//  3. A SECOND refund row with no match uses the existing "Expense only" buttons (PR #23's flow)
//     and posts a NEGATIVE amount to /receipt-recon/confirm with no_wo:true — the "no match /
//     partial — post as expense" path from the brief.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'receipt-reconciler.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

// Row 1: the reconstructed real Aug 24 2026 Home Depot return — TOTAL -$111.18, refund category.
// Row 2: a second refund with NO matching original purchase — exercises the negative-expense path.
const FAKE_ROWS = [
  {
    ID: '1', Status: 'pending', Vendor: 'Home Depot', Total: '-111.18', Receipt_Date: '2026-08-24',
    Received_Date: '2026-08-24T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_ID: 'hd85eb0166', Source_File_URL: 'https://drive.google.com/hd85eb0166',
    Notes: '🔄 Refund/return detected — REFUND-CUSTOMER COPY  ORIG REC:',
    suggestion: { category: 'refund', action: 'refund_review', total: -111.18, store: 'Home Depot', date: '2026-08-24' },
    items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [],
  },
  {
    ID: '2', Status: 'pending', Vendor: 'Ace Hardware', Total: '-18.00', Receipt_Date: '2026-08-20',
    Received_Date: '2026-08-20T10:00:00.000Z', Entry_Source: 'manual_drop', PO_Reference: '',
    Source_File_ID: '', Source_File_URL: '',
    suggestion: { category: 'refund', action: 'refund_review', total: -18.00, store: 'Ace Hardware', date: '2026-08-20' },
    items: [], items_summary: [], duplicate_evidence: [], rescan_matches: [],
  },
];
const FAKE_PROPS = [{ ID: 'P1', Address: '3014 N Calvert St' }];
const FAKE_WOS = [{ ID: '4021', Property_ID: 'P1', Status: 'In Progress', Description: 'Kitchen faucet repair', Created_Date: '2026-08-01', Completed_Date: '' }];

const postsSeen = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  // Auto-accept the native confirm() dialog reverseRefund shows before writing anything — the
  // explicit-tap safety the brief requires; we still assert the dialog actually appeared.
  const dialogsSeen = [];
  page.on('dialog', async (d) => { dialogsSeen.push(d.message()); await d.accept(); });

  await page.route('**/receipt-recon/queue?status=pending*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_ROWS) }));
  await page.route('**/workorders', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_WOS) }));
  await page.route('**/properties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROPS) }));
  await page.route('**/units', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.route('**/receipt-recon/refund-candidates', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    postsSeen.push({ path: '/receipt-recon/refund-candidates', body });
    const candidates = body.id === '1'
      ? [{ receipt_id: '900', wo_id: '4021', property_id: 'P1', amount: 111.18, date: '2026-08-10', store: 'Home Depot', description: 'kitchen faucet, fittings', exact_amount: true, item_overlap: 1, score: 5 }]
      : []; // row 2: no match found
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: body.id, candidates }) });
  });
  await page.route('**/receipt-recon/refund-reverse', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    postsSeen.push({ path: '/receipt-recon/refund-reverse', body });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, success: true, wo_id: '4021', original_receipt_id: '900', amount: '-111.18', id: '9002', invoice_link: { linked: true, ir_id: 'IR1' } }) });
  });
  await page.route('**/receipt-recon/confirm', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    postsSeen.push({ path: '/receipt-recon/confirm', body });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, success: true, amount: body.amount, id: '9003', qb_email: { sent: true } }) });
  });
  // Any call to these would mean a refund silently billed through the wrong path.
  await page.route('**/receipt/attach-only', (route) => { postsSeen.push({ path: '/receipt/attach-only', body: JSON.parse(route.request().postData() || '{}') }); route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"should never be called from the refund flow"}' }); });

  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.waitForSelector('.rcard', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(consoleErrors.length === 0, 'no JS errors while rendering the pending queue (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  // ── 1. Refund badge + negative pre-filled amount ────────────────────────────────────────────
  const card1Text = await page.locator('#rc1').innerText();
  ok(/🔄\s*REFUND/.test(card1Text), 'row 1 (the reconstructed Aug 24 HD return) shows the 🔄 REFUND badge');
  const amtVal1 = await page.locator('#rc1-amt').inputValue();
  ok(amtVal1 === '-111.18', 'row 1\'s amount field is pre-filled NEGATIVE (-111.18), never the mis-OCR\'d positive +111.18 (' + JSON.stringify(amtVal1) + ')');
  // No generic Confirm / WO-picker on a refund card.
  ok(await page.locator('#rc1 select[id$="-wo"]').count() === 0, 'row 1 has no generic WO picker — refunds get their own actions, not the billable-receipt flow');
  ok(await page.locator('#rc1 button:has-text("✓ Confirm")').count() === 0, 'row 1 has no generic "✓ Confirm" button');

  // ── 2. Find matching purchase -> candidate renders -> reverse fires the right, and ONLY the
  // right, network call, behind a native confirm() dialog. ─────────────────────────────────────
  await page.click('#rc1 button:has-text("Find matching purchase")');
  await page.waitForTimeout(200);
  ok(postsSeen.some(p => p.path === '/receipt-recon/refund-candidates' && p.body.id === '1'), 'clicking "Find matching purchase" called /receipt-recon/refund-candidates with id 1');
  const matchesHtml = await page.locator('#rc1-refund-matches').innerHTML();
  ok(/Home Depot/.test(matchesHtml) && /111\.18/.test(matchesHtml) && /exact amount/.test(matchesHtml), 'the candidate original purchase (Home Depot, $111.18, exact amount) is rendered for Brett to eyeball');
  const reverseBtn = page.locator('#rc1-refund-matches button:has-text("This matches")');
  ok(await reverseBtn.count() > 0, 'a "This matches — reverse the billed amount" button is offered on the candidate');

  postsSeen.length = 0;
  await reverseBtn.click();
  await page.waitForTimeout(250);
  ok(dialogsSeen.length === 1, 'reversing fired exactly one native confirm() dialog before writing anything (Brett\'s own explicit tap, twice over)');
  ok(/credits the customer.s invoice/i.test(dialogsSeen[0] || ''), 'the confirm() dialog explains this credits the customer\'s invoice, not a silent action');
  ok(postsSeen.length === 1, 'exactly one write POST fired for the reversal (got ' + postsSeen.length + ': ' + JSON.stringify(postsSeen.map(p => p.path)) + ')');
  ok(postsSeen[0].path === '/receipt-recon/refund-reverse', 'the one write POST was /receipt-recon/refund-reverse');
  ok(postsSeen[0].body.id === '1' && postsSeen[0].body.receipt_id === '900', 'the reversal POST carried the queue row id (1) and the matched original receipt id (900)');
  ok(!!postsSeen[0].body.reason, 'the reversal POST carried a non-empty reason (server requires one)');
  ok(!postsSeen.some(p => p.path === '/receipt-recon/confirm' || p.path === '/receipt/attach-only'), 'the ordinary billable-confirm and attach-only paths were NEVER called by the reversal flow');
  const status1 = await page.locator('#rc1-status').innerText();
  ok(/Reversed \$111\.18/.test(status1) && /WO 4021/.test(status1), 'row 1 status line confirms the reversal against WO 4021 (' + JSON.stringify(status1) + ')');

  // ── 3. No-match refund (row 2) -> "no match / partial" negative-expense path ──────────────────
  const card2Text = await page.locator('#rc2').innerText();
  ok(/🔄\s*REFUND/.test(card2Text), 'row 2 also shows the REFUND badge');
  postsSeen.length = 0;
  await page.click('#rc2 button:has-text("Find matching purchase")');
  await page.waitForTimeout(200);
  const matches2 = await page.locator('#rc2-refund-matches').innerText();
  ok(/No matching purchase found/.test(matches2), 'row 2 (no candidate) tells Brett to post it as a negative expense instead');
  ok(/negative expense/i.test(await page.locator('#rc2').innerText()), 'row 2\'s expense buttons are labeled for the no-match/partial-refund case');

  postsSeen.length = 0;
  await page.click('#rc2 button:has-text("Ridge Co expense")');
  await page.waitForTimeout(200);
  ok(postsSeen.length === 1 && postsSeen[0].path === '/receipt-recon/confirm', 'row 2\'s "Ridge Co expense" button posts through the existing PR #23 expense endpoint (/receipt-recon/confirm)');
  ok(postsSeen[0].body.no_wo === true, 'the expense POST carries no_wo:true — no work order, no customer invoice');
  ok(Number(postsSeen[0].body.amount) < 0, 'the expense POST carries a NEGATIVE amount (' + postsSeen[0].body.amount + ') — money back, not a charge');

  // 390px layout sanity.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  ok(scrollWidth <= clientWidth + 2, `no horizontal overflow at 390px (scrollWidth ${scrollWidth} vs clientWidth ${clientWidth})`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
