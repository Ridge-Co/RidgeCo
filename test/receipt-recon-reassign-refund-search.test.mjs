// Sep 23 2026 build: reassign a confirmed BMore/Ridge Co expense, manual refund marking
// (pending + already-confirmed), and a search over the canonical Receipts ledger. Same
// convention as receipt-attach-only.test.mjs — extracts the REAL function bodies straight out
// of worker.js and checks the actual business rules statically (no live Sheets I/O available in
// a build sandbox), plus route-wiring sanity checks.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  const start = i >= 0 ? i : src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', start));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(start, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── Route wiring ─────────────────────────────────────────────────────────────────────────────
ok(/if \(path === '\/receipt-recon\/reassign'\)\s+return await receiptReconReassign\(env, body\);/.test(src), 'POST /receipt-recon/reassign is routed');
ok(/if \(path === '\/receipt-recon\/mark-refund'\)\s+return await receiptReconMarkRefund\(env, body\);/.test(src), 'POST /receipt-recon/mark-refund is routed');
ok(/if \(path === '\/receipt-recon\/mark-refund-confirmed'\)\s+return await receiptReconMarkRefundConfirmed\(env, body\);/.test(src), 'POST /receipt-recon/mark-refund-confirmed is routed');
ok(/if \(path === '\/receipt-recon\/search'\)\s+return await receiptReconSearch\(env, url\);/.test(src), 'GET /receipt-recon/search is routed');

// ── receiptReconReassign — Brett's own scoping answer (Sep 23 2026): not-yet-sent-to-QuickBooks
// only, property_id always required, wo_id optional, voids the original then reposts.
{
  const body = grab('receiptReconReassign');
  ok(/property_id required/.test(body), 'reassign requires property_id');
  ok(/row\.Status !== 'confirmed'/.test(body), 'reassign only accepts an already-confirmed queue row');
  ok(/QB_Email_Sent \|\| ''\)\.toUpperCase\(\) === 'TRUE'/.test(body), 'reassign checks the original Receipts row\'s QB_Email_Sent flag');
  ok(/already emailed to QuickBooks/.test(body), 'reassign refuses with a clear message once the original was already sent to QuickBooks');
  ok(/Active: 'FALSE'/.test(body), 'reassign soft-deletes (never hard-deletes) the original Receipts row');
  ok(/addReceipt\(env,/.test(body), 'reassign posts the new receipt through the same addReceipt() every other entry path uses');
  ok(/wo_id \? 'billable' : 'company'/.test(body), 'reassign computes category the same way the rest of the pipeline does (billable with a WO, company without)');
}

// ── receiptReconMarkRefund — pending-only, never touches Receipts ──────────────────────────────
{
  const body = grab('receiptReconMarkRefund');
  ok(/\(row\.Status \|\| 'pending'\) !== 'pending'/.test(body), 'mark-refund only allows a pending row');
  ok(!/updateRow\(env, 'Receipts'/.test(body), 'mark-refund never writes to the Receipts tab (nothing has billed yet on a pending row)');
  ok(/Manual_Refund: refund \? 'TRUE' : 'FALSE'/.test(body), 'mark-refund toggles the Manual_Refund column both directions');
}

// ── receiptReconMarkRefundConfirmed — reuses the Pending refund flow, same QB-sent guard ───────
{
  const body = grab('receiptReconMarkRefundConfirmed');
  ok(/\['confirmed', 'attached_only'\]\.includes\(row\.Status\)/.test(body), 'mark-refund-confirmed only accepts a confirmed or attached_only row');
  ok(/QB_Email_Sent \|\| ''\)\.toUpperCase\(\) === 'TRUE'/.test(body), 'mark-refund-confirmed checks the same QB_Email_Sent guard as reassign');
  ok(/Status: 'pending', Manual_Refund: 'TRUE'/.test(body), 'mark-refund-confirmed drops the row back to Pending with Manual_Refund set — reuses the existing refund UI rather than a second posting path');
  ok(/Confirmed_WO_ID: '', Confirmed_Amount: '', Confirmed_Description: '', Confirmed_Receipt_ID: ''/.test(body), 'mark-refund-confirmed clears the stale Confirmed_* fields so the row reads as a fresh pending refund');
}

// ── receiptReconSearch — canonical Receipts ledger, amount + text match, read-only ─────────────
{
  const body = grab('receiptReconSearch');
  ok(/fetchTab\(env, 'Receipts'\)/.test(body), 'search reads the canonical Receipts ledger, not just the queue');
  ok(!/updateRow|addRow/.test(body), 'search never writes anything — read-only');
  ok(/Math\.abs\(Number\(r\.Amount\) - qAmount\) < 0\.01/.test(body), 'search matches amount with cent-level tolerance so "101.28" or "$101.28" both work');
}

// ── listReceiptReconQueue — Manual_Refund override ──────────────────────────────────────────────
{
  const body = grab('listReceiptReconQueue');
  ok(/Manual_Refund \|\| ''\)\.toUpperCase\(\) === 'TRUE'/.test(body), 'the queue list applies the Manual_Refund override');
  ok(/category: 'refund', manual_refund: true/.test(body), 'a manually-flagged row is reported with category refund + a manual_refund marker (so the frontend can offer an undo, unlike a real auto-detected refund)');
}

// ── receiptReconConfirm — now records Confirmed_Receipt_ID for reassign/mark-refund to find ────
{
  const body = grab('receiptReconConfirm');
  ok(/Confirmed_Receipt_ID: addJson\.duplicate \? '' : String\(addJson\.id \|\| ''\)/.test(body), 'confirm stores Confirmed_Receipt_ID on the queue row so a later reassign/mark-refund can find the exact Receipts row');
}

// ── Schema ───────────────────────────────────────────────────────────────────────────────────
ok(/RECEIPT_RECON_QUEUE_HEADERS = \[[^\]]*'Confirmed_Receipt_ID'[^\]]*'Manual_Refund'/.test(src), 'Receipt_Recon_Queue schema includes the two new columns');

console.log(`receipt-recon-reassign-refund-search: ${n}/${n} passing`);
