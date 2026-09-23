// Pure-function + route-shape coverage for Part 3 of the Sep 22 2026 dup/refund/bulk brief:
// refund detection (receiptApplyRefundDetection), matching (receiptRefundFindMatches), and the
// Rung-3 reversal write (receiptReconRefundReverse). Extracts the REAL functions straight out of
// worker.js (not reimplemented), same convention as receipt-attach-only.test.mjs and
// receipt-suggest-core.test.mjs.
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

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── receiptApplyRefundDetection — the code-level guard on top of the model's own OCR sign ──────
const { receiptApplyRefundDetection } = new Function(
  grab('receiptApplyRefundDetection') + '\nreturn { receiptApplyRefundDetection };'
)();

// The real Aug 24 2026 Home Depot return, reconstructed from Brett's description: TOTAL
// -$111.18, "REFUND-CUSTOMER COPY", "ORIG REC:" lines — but the model still read the printed
// digits as a positive charge (the live bug). refund_signal_text is what the updated prompt now
// asks the model to also return; the detector must flip the sign regardless.
const hdAug24 = {
  vendor: 'The Home Depot', date: '2026-08-24', total: 111.18,
  handwritten_note: '', po_reference: '', invoice_number: '',
  items: [], items_summary: [], card_last4: '4412',
  refund_signal_text: 'REFUND-CUSTOMER COPY  ORIG REC:',
  suggested_category: 'personal/HSA', confidence: 0.86,
};
{
  const r = receiptApplyRefundDetection(hdAug24);
  ok(r.refund === true, 'Aug 24 HD receipt (REFUND-CUSTOMER COPY / ORIG REC language) is detected as a refund');
  ok(r.total === -111.18, 'the mis-OCR\'d +$111.18 is forced negative to -$111.18, never passed on as a positive charge');
  ok(/REFUND-CUSTOMER COPY/.test(r.refund_reason), 'the refund reason carries the actual refund_signal_text verbatim');
}
{
  // Negative total with no refund_signal_text — defense in depth still catches it.
  const r = receiptApplyRefundDetection({ total: -45, refund_signal_text: '', handwritten_note: '', po_reference: '', invoice_number: '' });
  ok(r.refund === true, 'a negative TOTAL alone (no refund language) is still detected as a refund');
  ok(r.total === -45, 'an already-negative total stays negative (not double-negated)');
}
{
  // RETURN / ORIG REC language elsewhere in the extracted fields (not just refund_signal_text).
  const r = receiptApplyRefundDetection({ total: 22, po_reference: 'ORIG REC: 4471-9982', handwritten_note: '', invoice_number: '', refund_signal_text: '' });
  ok(r.refund === true, '"ORIG REC" language in po_reference alone is enough to flag a refund');
  ok(r.total === -22, 'the positive total is forced negative once refund language is found anywhere in the extracted fields');
}
{
  // Ordinary positive purchase, no refund signal anywhere — must NOT be flagged.
  const r = receiptApplyRefundDetection({ total: 87.42, vendor: 'Home Depot', handwritten_note: '3014 N Calvert', po_reference: '', invoice_number: '', refund_signal_text: '' });
  ok(r.refund === false, 'an ordinary positive purchase with no refund language is not flagged');
  ok(r.total === 87.42, 'a genuine purchase total is left untouched');
}
{
  // A parse-error-shaped object (no total at all) must never throw.
  const r = receiptApplyRefundDetection({ total: null, refund_signal_text: '' });
  ok(r.refund === false && r.total === null, 'a null/unreadable total with no refund language never throws and is not flagged');
}

// ── receiptRefundFindMatches — the matching step, pure and I/O-free ────────────────────────────
const rcNormSrc = grab('_rcNorm');
const stopConst = "const RECEIPT_STOP=new Set(['the','and','for','with','apt','ste','unit','street','saint','st','ave','rd','ln','pl','n','s','e','w','2x','x']);";
const { receiptRefundFindMatches } = new Function(
  rcNormSrc + '\n' + stopConst + '\n' + grab('receiptRefundFindMatches') + '\nreturn { receiptRefundFindMatches };'
)();

const RECEIPTS = [
  // The real original purchase this Aug 24 return would be reversing — same store, exact
  // amount, dated before the refund, within the match window.
  { ID: '900', WO_ID: '4021', Property_ID: 'P1', Amount: '111.18', Date: '2026-08-10', Store: 'Home Depot', Description: 'kitchen faucet, fittings', Active: 'TRUE' },
  // A smaller purchase at the same store — can never be the source of a $111.18 refund.
  { ID: '901', WO_ID: '4022', Property_ID: 'P1', Amount: '50.00', Date: '2026-08-01', Store: 'Home Depot', Description: 'paint, primer', Active: 'TRUE' },
  // A different store entirely.
  { ID: '902', WO_ID: '4023', Property_ID: 'P2', Amount: '111.18', Date: '2026-08-12', Store: 'Lowes', Description: 'faucet', Active: 'TRUE' },
  // Right store/amount but dated AFTER the refund — can't be the source of a return that
  // happened first.
  { ID: '903', WO_ID: '4024', Property_ID: 'P1', Amount: '111.18', Date: '2026-08-30', Store: 'Home Depot', Description: 'faucet', Active: 'TRUE' },
  // A negative row (another refund/credit) must never be offered as a "purchase" to reverse.
  { ID: '904', WO_ID: '4021', Property_ID: 'P1', Amount: '-20.00', Date: '2026-08-05', Store: 'Home Depot', Description: 'prior return', Active: 'TRUE' },
  // Inactive row — excluded regardless of everything else matching.
  { ID: '905', WO_ID: '4021', Property_ID: 'P1', Amount: '111.18', Date: '2026-08-09', Store: 'Home Depot', Description: 'faucet', Active: 'FALSE' },
];
const refundInput = { store: 'Home Depot', amount: -111.18, date: '2026-08-24', items: ['returned faucet'] };
{
  const cands = receiptRefundFindMatches(refundInput, RECEIPTS);
  ok(cands.length >= 1, 'at least one candidate is found for the real Aug 24 HD refund');
  ok(cands[0].receipt_id === '900', 'the exact-amount, same-store, pre-dated purchase (#900) ranks first');
  ok(cands[0].exact_amount === true, 'candidate #900 is flagged as an exact amount match');
  ok(!cands.some(c => c.receipt_id === '901'), 'a smaller prior purchase (#901, $50) is never offered as the source of a $111.18 refund');
  ok(!cands.some(c => c.receipt_id === '902'), 'a different store (#902, Lowes) is excluded even at the exact amount');
  ok(!cands.some(c => c.receipt_id === '903'), 'a purchase dated AFTER the refund (#903) is excluded — it can\'t be the source of an earlier return');
  ok(!cands.some(c => c.receipt_id === '904'), 'another negative/refund row (#904) is never offered as a purchase to reverse');
  ok(!cands.some(c => c.receipt_id === '905'), 'an inactive Receipts row (#905) is excluded');
}
{
  // Store or amount missing entirely -> no candidates, never throws.
  ok(receiptRefundFindMatches({ store: '', amount: -111.18, date: '2026-08-24' }, RECEIPTS).length === 0, 'no store on the refund -> no candidates');
  ok(receiptRefundFindMatches({ store: 'Home Depot', amount: 0, date: '2026-08-24' }, RECEIPTS).length === 0, 'zero refund amount -> no candidates');
  ok(receiptRefundFindMatches(null, RECEIPTS).length === 0, 'a null refund input never throws');
  ok(receiptRefundFindMatches(refundInput, null).length === 0, 'a null receipts list never throws');
}
{
  // Item-overlap bumps score without being required.
  const withItems = receiptRefundFindMatches({ store: 'Home Depot', amount: -111.18, date: '2026-08-24', items: ['kitchen faucet'] }, RECEIPTS);
  const withoutItems = receiptRefundFindMatches({ store: 'Home Depot', amount: -111.18, date: '2026-08-24', items: [] }, RECEIPTS);
  ok(withItems[0].receipt_id === '900' && withoutItems[0].receipt_id === '900', 'the top candidate is the same with or without item text (item overlap is a bonus, not a requirement)');
  ok(withItems[0].score >= withoutItems[0].score, 'matching item text (faucet) scores at least as high as no item text at all');
}

// ── receiptSuggestCore's refund branch (Part 3 update — no longer skip-only) ───────────────────
const consts = "const RECEIPT_OPEN_STATUSES=['New','Assigned','Accepted','In Progress','On Hold','Pending Invoice','Complete'];" + stopConst;
const { receiptSuggestCore } = new Function([
  rcNormSrc, consts, grab('matchReceiptProperty'), grab('rankReceiptWOs'), grab('receiptIsDuplicate'), grab('receiptSuggestCore'),
  'return { receiptSuggestCore };',
].join('\n'))();
{
  const r = receiptSuggestCore({ po: '3014 N Calvert', total: -111.18 }, [], [], [], []);
  ok(r.category === 'refund', 'negative total -> category refund');
  ok(r.action !== 'skip', 'a refund is no longer action "skip" — it has real actions in the UI now');
  ok(r.total === -111.18, 'the negative total is passed through unchanged');
}
{
  // Defense-in-depth: an explicit refund:true flag on an otherwise-positive total is still
  // forced negative — never lets a refund reach addReceipt as a positive charge from this layer.
  const r = receiptSuggestCore({ po: '3014 N Calvert', total: 111.18, refund: true }, [], [], [], []);
  ok(r.category === 'refund' && r.total === -111.18, 'an explicit refund:true flag forces the total negative even if it arrived positive');
}

// ── worker.js wiring sanity ─────────────────────────────────────────────────────────────────
ok(/if \(path === '\/receipt-recon\/refund-candidates'\)\s+return await receiptReconRefundCandidates\(env, body\);/.test(src), 'POST /receipt-recon/refund-candidates is routed');
ok(/if \(path === '\/receipt-recon\/refund-reverse'\)\s+return await receiptReconRefundReverse\(env, body\);/.test(src), 'POST /receipt-recon/refund-reverse is routed');
ok(/async function receiptReconRefundCandidates\(env, body\)/.test(src), 'receiptReconRefundCandidates is defined');
ok(/async function receiptReconRefundReverse\(env, body\)/.test(src), 'receiptReconRefundReverse is defined');

// Rung-3 gate: neither new endpoint is public, and neither is granted to any PIN-issued role —
// both require the admin secret exactly like every other money write in this file.
{
  const pubStart = src.indexOf('const PUBLIC_PATHS');
  const pubEnd = src.indexOf('];', pubStart);
  const pub = src.slice(pubStart, pubEnd);
  ok(!/\/receipt-recon\/refund-reverse/.test(pub), '/receipt-recon/refund-reverse is NOT in PUBLIC_PATHS (admin-gated)');
  ok(!/\/receipt-recon\/refund-candidates/.test(pub), '/receipt-recon/refund-candidates is NOT in PUBLIC_PATHS (admin-gated)');
  const roleStart = src.indexOf('const ROLE_SCOPES');
  const roleEnd = src.indexOf('function isPathAllowedForRole', roleStart);
  const roles = src.slice(roleStart, roleEnd);
  ok(!/\/receipt-recon\/refund-reverse/.test(roles), '/receipt-recon/refund-reverse is not granted to any vendor/tenant/owner scope');
}

// addReceipt now accepts allow_negative, but still rejects a bare negative amount by default.
{
  const body = grab('addReceipt');
  ok(/allow_negative/.test(body), 'addReceipt reads an allow_negative flag');
  ok(/amt < 0 && !allow_negative/.test(body), 'addReceipt still rejects a negative amount unless allow_negative was explicitly passed');
}

// receiptReconRefundReverse: requires a reason, is preview-capable, always forces the amount
// negative, and reuses addReceipt/appendReceiptToInvoiceReview rather than a bespoke QB call —
// same shape as scopeProposalAdjustBill's Rung-3 convention.
{
  const body = grab('receiptReconRefundReverse');
  ok(/reason.*required/i.test(body), 'receiptReconRefundReverse requires a reason, same convention as scopeProposalAdjustBill');
  ok(/preview_only/.test(body), 'receiptReconRefundReverse supports preview_only before writing anything');
  ok(/-Math\.abs\(Number\(row\.Total\)/.test(body), 'the reversal amount is always forced negative regardless of what Total holds');
  ok(/allow_negative: true/.test(body), 'receiptReconRefundReverse passes allow_negative:true to addReceipt');
  ok(/category: 'refund'/.test(body), 'the reversing Receipts row is tagged category refund');
  ok(/appendReceiptToInvoiceReview\(env, \{ wo_id: original\.WO_ID/.test(body), 'the reversal folds into the SAME Invoice_Review mechanism receiptReconConfirm uses — no bespoke QuickBooks call');
  ok(!/qbApi\(/.test(body), 'receiptReconRefundReverse never calls QuickBooks directly — it only ever writes a Receipts row + folds into Invoice_Review, same as every other receipt write in this pipeline');
}

// appendReceiptToInvoiceReview now tolerates a negative delta (the reversal credit) with a floor.
{
  const body = grab('appendReceiptToInvoiceReview');
  ok(/if \(!amt\) return \{ linked: false, reason: 'no_amount' \};/.test(body), 'appendReceiptToInvoiceReview now rejects only a literal zero amount, not any negative amount');
  ok(/newOwnMaterials < 0 \|\| newCustomerTotal < 0/.test(body), 'a reversal is floored — it can never push Own_Materials/Customer_Total below $0');
}

// receiptReconConfirm: a refund posted through the no-WO expense path is always forced negative.
{
  const body = grab('receiptReconConfirm');
  ok(/isRefundRow/.test(body), 'receiptReconConfirm detects a refund row');
  ok(/-Math\.abs\(Number\(amount\) \|\| 0\)/.test(body), 'receiptReconConfirm forces the amount negative for a refund posted through the no-WO expense path');
  ok(/allow_negative: \(noWo && isRefundRow\)/.test(body), 'allow_negative is only passed for the refund + no-WO combination, never for an ordinary billable receipt');
}

console.log(`receipt-refund: ${n}/${n} passing`);
