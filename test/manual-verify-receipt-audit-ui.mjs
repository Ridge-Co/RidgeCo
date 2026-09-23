// Headless verification: "Audit older receipts" tab in the Receipt Reconciler (Task 1, Sep 22
// 2026 receipt-follow-ups handoff). Checks the tab renders flags, the sub-status filters work,
// "Run full audit" pages through build-index + scan to completion, and marking a flag writes
// only to /admin/receipt-duplicate-audit/mark — never a QuickBooks-touching endpoint. Mocks the
// worker; runs against the real receipt-reconciler.html, at 390px like every other Hub UI check.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '..', 'receipt-reconciler.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

let flags = [
  { id: '1', receipt_id: '50', wo_id: '1001', store: 'Home Depot', receipt_date: '2026-08-01', amount: 125,
    match_count: 1, matches: [{ doc: '1705', invoice_id: '99', customer_name: 'Phoenix Estates', date: '2026-08-20', amount: 125, paid: true, description: 'paint' }],
    status: 'pending', flagged_date: '2026-09-22T00:00:00Z', reviewed_date: '' },
  { id: '2', receipt_id: '51', wo_id: '1002', store: 'Lowes', receipt_date: '2026-08-05', amount: 60,
    match_count: 2, matches: [{ doc: '1706', invoice_id: '100', customer_name: 'Milam Ridge', date: '2026-08-06', amount: 60, paid: false, description: 'lumber' }],
    status: 'pending', flagged_date: '2026-09-22T00:00:00Z', reviewed_date: '' },
];

let buildIndexCalls = 0, scanCalls = 0, markCalls = [], qbWriteCalls = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === 'file:') return route.continue();
  const p = u.pathname;
  const method = route.request().method();
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const send = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

  if (p === '/receipt-recon/queue') return send([]);
  if (p === '/workorders') return send([{ ID: '1001', Property_ID: 'P1', Status: 'Complete', Description: 'outlets' }]);
  if (p === '/properties') return send([{ ID: 'P1', Address: '1111 E 43rd St' }]);
  if (p === '/units') return send([]);

  if (p === '/admin/receipt-duplicate-audit/flags') {
    const st = u.searchParams.get('status');
    const rows = st === 'all' ? flags : flags.filter(f => f.status === st);
    return send({ ok: true, count: rows.length, flags: rows });
  }
  if (p === '/admin/receipt-duplicate-audit/build-index' && method === 'POST') {
    buildIndexCalls++;
    // Two-batch pagination — proves the client loops on next_offset rather than assuming done in one call.
    if (buildIndexCalls === 1) return send({ ok: true, total_invoices: 22, offset: 0, opened_this_batch: 15, lines_cached_this_batch: 30, next_offset: 15, done: false, list_query_carried_line: false });
    return send({ ok: true, total_invoices: 22, offset: 15, opened_this_batch: 7, lines_cached_this_batch: 14, next_offset: null, done: true, list_query_carried_line: false });
  }
  if (p === '/admin/receipt-duplicate-audit/scan' && method === 'POST') {
    scanCalls++;
    return send({ ok: true, total_receipts: 2, offset: 0, scanned_this_batch: 2, flagged_new: 2, flagged_updated: 0, cleared_stale: 0, next_offset: null, done: true });
  }
  if (p === '/admin/receipt-duplicate-audit/mark' && method === 'POST') {
    markCalls.push(body);
    const f = flags.find(x => x.id === body.id); if (f) f.status = body.status;
    return send({ ok: true, id: body.id, status: body.status });
  }
  // Any QuickBooks-touching write endpoint must NEVER be hit from this UI — the audit is
  // read-only against QuickBooks and "mark" never fixes anything in QB itself.
  if (p === '/qb/send-invoice' || p === '/qb/ready') { qbWriteCalls.push(p); return send({ ok: false, error: 'should not be called' }); }
  return send({});
});
await page.addInitScript(() => { localStorage.setItem('mh_auth', 'test-token'); });
await page.goto('file://' + pagePath);
await page.waitForSelector('#tabs');

// 1. Switch to the Audit tab — flags render, default sub-filter is "pending".
await page.click('#tabs >> text=🔍 Audit older');
await page.waitForSelector('#audit-run-btn');
let cardCount = await page.locator('.rcard').count();
ok(cardCount === 2, 'both seeded pending flags render as cards');
let title0 = await page.locator('.rc-title').first().textContent();
ok(/Home Depot/.test(title0), 'flag card shows the receipt store + amount');
let invoiceLine = await page.locator('.rc-posting').first().textContent();
ok(/1705/.test(invoiceLine) && /Phoenix Estates/.test(invoiceLine), 'flag card shows the matching invoice # and customer');

// 2. Sub-status filter — switching to "Real duplicate" shows zero (none marked yet).
await page.click('#list .tab >> text=Real duplicate');
await page.waitForTimeout(150);
let emptyText = await page.locator('.empty').textContent().catch(() => null);
ok(emptyText !== null, 'switching the sub-filter to a status with no flags shows the empty state, not stale cards');
await page.click('#list .tab >> text=Pending');
await page.waitForTimeout(150);
cardCount = await page.locator('.rcard').count();
ok(cardCount === 2, 'switching back to Pending re-shows both flags');

// 3. Run full audit — pages through build-index (2 calls) then scan (1 call), never bailing
// after the first batch, and never touching a QB write endpoint.
await page.click('#audit-run-btn');
await page.waitForFunction(() => document.getElementById('audit-progress') && /Done/.test(document.getElementById('audit-progress').textContent));
ok(buildIndexCalls === 2, 'Run full audit pages build-index to done:true rather than stopping after batch 1 (' + buildIndexCalls + ' calls)');
ok(scanCalls === 1, 'scan called through to done:true (' + scanCalls + ' call(s))');
ok(qbWriteCalls.length === 0, 'the audit UI never calls a QuickBooks write endpoint (send-invoice/ready) — read-only by construction');
let progText = await page.locator('#audit-progress').textContent();
ok(/list query carried Line: no/.test(progText), 'progress line surfaces the list-query-carries-Line answer from build-index');

// 4. Mark a flag "real duplicate" — only /mark is called, card updates to reflect the new status.
await page.locator('.rcard').first().locator('button.warnbtn').click();
await page.waitForTimeout(200);
ok(markCalls.length === 1 && markCalls[0].id === '1' && markCalls[0].status === 'real_duplicate', 'tapping "Real duplicate" posts exactly one /mark call with the right id+status');
ok(qbWriteCalls.length === 0, 'marking a flag still never touches QuickBooks — fixing a real duplicate stays Brett\'s own QuickBooks tap');

ok(errors.length === 0, 'no uncaught page errors (' + errors.join('; ') + ')');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
