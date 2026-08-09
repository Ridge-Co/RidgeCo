// The vendor-reconciliation status classifier decides, from the LIVE QuickBooks balances, what
// state each vendor bill is in. The one that must never be missed is action=true: the customer
// invoice is paid but the vendor bill is not — money Brett collected and still owes the vendor.
// Runs the real function out of worker.js so the test can't drift from what ships.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const { qbReconcileStatus } = new Function(
  grab(wsrc, 'function qbReconcileStatus(') + '\nreturn { qbReconcileStatus };')();

// hasBillId, billFound, billBal, hasInv, invBal
let r;
r = qbReconcileStatus(false, false, null, true, 100);
t('no QB bill id at all is flagged as such', r.status === 'No vendor bill in QuickBooks' && r.action === false);

r = qbReconcileStatus(true, false, null, true, 0);
t('linked bill id that QB does NOT return is a broken link, never "pay vendor"', r.status === 'Linked bill not found in QuickBooks' && r.action === false);

r = qbReconcileStatus(true, true, 0, true, 0);
t('vendor paid + owner paid = Vendor paid, no action', r.status === 'Vendor paid' && r.action === false);

r = qbReconcileStatus(true, true, 150, true, 0);
t('THE key case: owner paid us but vendor still owed → action', r.status === 'COLLECTED — pay vendor' && r.action === true);

r = qbReconcileStatus(true, true, 150, true, 150);
t('vendor owed AND owner has not paid → Waiting on owner, no action', r.status === 'Waiting on owner' && r.action === false);

r = qbReconcileStatus(true, true, 150, false, null);
t('vendor owed but no invoice on file → unpaid/unknown, no action', /unpaid/i.test(r.status) && r.action === false);

r = qbReconcileStatus(true, true, 0.004, true, 200);
t('a sub-penny bill balance counts as paid (rounding guard)', r.status === 'Vendor paid');

r = qbReconcileStatus(true, true, 150, true, 0.004);
t('a sub-penny invoice balance counts as owner-paid → action', r.action === true);

console.log(`\nvendor-reconcile: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
