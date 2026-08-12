// B-224 — invoice from materials/time with NO vendor bill.
//
// The blocker was one line: the pricer bailed when there was no Vendor_Bills row, so a job
// where Brett bought the materials (or did the labor himself) could never be invoiced even
// though the customer owes for them. The SEND path already handled a $0 vendor cost (it skips
// the QB bill and posts the customer invoice only), so the fix is: let approve accept no bill,
// and let the front-end price/enable from materials + time. These assertions run against the
// real source so the guards can't drift. The money-critical rule they protect: materials still
// flow to the customer invoice EXACTLY ONCE (as own-materials), never doubled into a fake bill.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
const hsrc = fs.readFileSync('index.html', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

// ── Worker: approveInvoiceReview accepts a bill-less invoice ──
const approve = grab(wsrc, 'async function approveInvoiceReview(');
t('bill_id is optional; a work order is enough to anchor the review',
  /!customer_total \|\| \(!bill_id && !wo_id\)/.test(approve));
t('the Vendor_Bills row is only updated when there actually is a bill',
  /if \(bill_id\) await updateRow\(env, 'Vendor_Bills'/.test(approve));
t('a bill-less review is de-duped by work order, not by bill id',
  /!String\(r\.Bill_ID \|\| ''\) && String\(r\.WO_ID\) === String\(wo_id\)/.test(approve));
t('the logged review row stores a blank bill id / zero vendor cost cleanly',
  /Bill_ID:\s*bill_id \|\| ''/.test(approve) && /Vendor_Cost:\s*vendor_cost \|\| '0'/.test(approve));

// ── Front-end: invPricing prices from materials/time with no bill ──
const pricing = grab(hsrc, 'function invPricing(');
t('no longer bails out the instant there is no bill', !/if \(!bill\) return null;/.test(pricing));
t('with no bill it still returns null when there is genuinely nothing to bill',
  /invMatTotal\(k\) <= 0 && invTimeTotal\(k\) <= 0/.test(pricing));
t('a synthetic ZERO-cost bill anchors it, so vendor payable comes out $0 (send skips the QB bill)',
  /Bill_Type: 'flat'[\s\S]*Labor_Total: '0'/.test(pricing));

// ── Front-end: the button enables/approves correctly with no bill ──
const loadStatus = grab(hsrc, 'function invLoadStatus(');
t('no bill + nothing priceable stays disabled', /if \(!invPricing\(k\)\) \{ invRenderStatus\(k, null\)/.test(loadStatus));
t('no bill + nothing approved yet offers APPROVE, not a broken state',
  /bill \? \{ state: 'reviewed_no_row' \} : \{ state: 'unapproved' \}/.test(loadStatus));
t('a bill-less sent invoice reads DONE, never "partly sent" (mirrors the Worker billNotOwed rule)',
  /var noVendorBill = !String\(row\.bill_id \|\| ''\)/.test(loadStatus) &&
  /row\.qb_invoice_id && \(row\.qb_bill_id \|\| noVendorBill\)/.test(loadStatus));

const doJob = grab(hsrc, 'function invBillThisJob(');
t('approve payload tolerates a missing bill', /bill_id: bill \? bill\.ID : ''/.test(doJob));
t('the already-reviewed fast-path is guarded against a null bill', /if \(bill && \(bill\.Status/.test(doJob));

// ── The double-bill guard this whole change rests on ──
// Materials reach the invoice as own-materials (invMatTotal), NOT by being copied into a bill.
t('materials are counted once, via invMatTotal — the synthetic bill carries none',
  /Receipts_JSON: '\[\]'/.test(pricing) && /var ownMaterials = invMatTotal\(k\);/.test(pricing));

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
