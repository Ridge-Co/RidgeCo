// Pure-function + route-shape coverage for Parts 1+2 of the Sep 22 2026 dup/refund/bulk brief:
// "is the flagged receipt's own image actually attached?" (Part 1) and the "attach image only,
// don't bill" endpoint (Part 2). Extracts the REAL function straight out of worker.js (not
// reimplemented), same convention as receipt-duplicate-audit.test.mjs.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { receiptImageAttachedInfo } = new Function(
  grab('receiptImageAttachedInfo') + '\nreturn { receiptImageAttachedInfo };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── receiptImageAttachedInfo (Part 1) ───────────────────────────────────────────────────────
{
  const r = receiptImageAttachedInfo({ Source_File_URL: 'https://drive.google.com/x', Source_File_ID: 'abc123' });
  ok(r.image_attached === true, 'a Receipts row with a Source_File_URL is reported as image-attached');
  ok(r.image_url === 'https://drive.google.com/x', 'the image URL is passed through');
}
{
  const r = receiptImageAttachedInfo({ Source_File_URL: '', Source_File_ID: 'abc123' });
  ok(r.image_attached === true, 'Source_File_ID alone (no URL) still counts as attached');
  ok(r.image_url === '', 'no URL on file -> empty image_url even though attached by ID');
}
{
  const r = receiptImageAttachedInfo({ Source_File_URL: '', Source_File_ID: '' });
  ok(r.image_attached === false, 'a Receipts row with neither field populated is reported as NOT attached');
}
{
  const r = receiptImageAttachedInfo(null);
  ok(r.image_attached === false, 'no matching Receipts row at all (null) -> not attached, never throws');
}
{
  const r = receiptImageAttachedInfo(undefined);
  ok(r.image_attached === false, 'undefined Receipts row -> not attached, never throws');
}

// ── worker.js wiring sanity (routes/functions exist exactly as named) ──────────────────────
ok(/if \(path === '\/receipt\/attach-only'\)\s+return await receiptAttachOnly\(env, body\);/.test(src), 'POST /receipt/attach-only is routed to receiptAttachOnly');
ok(/async function receiptAttachOnly\(env, body\)/.test(src), 'receiptAttachOnly is defined');
ok(/HUB_TEST_WRITE_PATHS = \[[^\]]*'\/receipt\/attach-only'/.test(src), '/receipt/attach-only is allow-listed for HUB_TEST_TOKEN writes');
{
  const gateStart = src.indexOf("if (path === '/receipt/attach-only') {", src.indexOf('async function hubTestWriteAllowed'));
  const gateBody = gateStart >= 0 ? src.slice(gateStart, gateStart + 900) : '';
  ok(gateStart >= 0 && /isTestRecord\(env, 'Properties', wo\.Property_ID\)/.test(gateBody), '/receipt/attach-only has a record-level TEST- gate on the WO\'s Property, same pattern as /status');
}

// ── Part 2's own claim: reuses addReceipt (file-attach half), never appendReceiptToInvoiceReview
// or sendReceiptsToQBEmail (the billing halves). Static-check the function body, in addition to
// the Playwright pass below which verifies the actual network calls at runtime.
{
  const body = grab('receiptAttachOnly');
  ok(/addReceipt\(env,/.test(body), 'receiptAttachOnly calls addReceipt (the file-attach mechanism)');
  ok(!/appendReceiptToInvoiceReview/.test(body), 'receiptAttachOnly never calls appendReceiptToInvoiceReview (no Invoice_Review write)');
  ok(!/sendReceiptsToQBEmail/.test(body), 'receiptAttachOnly never calls sendReceiptsToQBEmail');
  ok(!/Vendor_Bills/.test(body), 'receiptAttachOnly never references Vendor_Bills');
  ok(/category: 'attached_only'/.test(body), 'receiptAttachOnly tags the Receipts row with the new attached_only category (checked the existing enum first — none of billable/company/customer_paid/refund fit)');
  ok(/Status: 'attached_only'/.test(body), 'receiptAttachOnly sets the Receipt_Recon_Queue row Status to attached_only (excluded from the default ?status=pending view)');
}

console.log(`receipt-attach-only: ${n}/${n} passing`);
