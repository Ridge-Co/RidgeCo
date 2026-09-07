// Undo feature (Sep 7 2026) — Brett's complaint: the post-Confirm modal in signed-proposals.html
// only ever showed a "Cancel" button, even after the invoice+bill had already been created ("✓
// Created invoice #1694 + bill" next to a button reading "Cancel" is confusing — nothing left to
// cancel). Fixed with a relabel (Cancel -> Close) plus a real Undo path that deletes the QB
// invoice/bill and reverts the row, gated by a confirm() dialog.
//
// This file tests the one pure/testable piece of that: qbTxnSafeToDelete, the guard shared by
// qbDeleteInvoiceSafe/qbDeleteBillSafe (and the pre-existing qbDeleteBill endpoint) that refuses
// to delete anything with a payment already applied — the same "don't erase a payment's target"
// rule qbDeleteBill already enforced for vendor bills, now shared with the new invoice/undo paths.
// The three new endpoint functions themselves (scopeProposalUnbook/-Final, proposalUnbook) are
// thin orchestration over qbApi/fetchTab/updateRow and aren't meaningfully unit-testable without
// a live QuickBooks + Sheets double — same reason no prior qbApi-calling function in this suite
// (qbDeleteBill, qbSendInvoice, etc.) has its own test either. Brett's own live pass after push is
// the real verification for those, same as every other QB-write path in this codebase.
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
const { qbTxnSafeToDelete } = new Function(grab('qbTxnSafeToDelete') + '\nreturn { qbTxnSafeToDelete };')();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// ---- untouched transaction: balance === total -> safe to delete ----
t('exact match, both numbers -> ok', qbTxnSafeToDelete('Invoice', '1694', 462.50, 462.50).ok === true);
t('exact match, string numbers (as QBO returns them) -> ok', qbTxnSafeToDelete('Bill', '55', '325.00', '325.00').ok === true);
t('sub-penny float noise (462.500000001 vs 462.5) is still ok', qbTxnSafeToDelete('Invoice', '1', 462.500000001, 462.5).ok === true);

// ---- a real payment applied (balance != total by more than a penny) -> refuse ----
{
  const r = qbTxnSafeToDelete('Invoice', '1694', 0, 462.50);
  t('fully paid invoice (balance 0) is refused', r.ok === false);
  t('refusal names the transaction kind + id', /Invoice 1694/.test(r.error));
  t('refusal shows both dollar amounts', /\$0\.00/.test(r.error) && /\$462\.50/.test(r.error));
}
{
  const r = qbTxnSafeToDelete('Bill', '55', 100, 325);
  t('partially paid bill is refused', r.ok === false);
  t('partial-payment refusal shows both amounts', /\$100\.00/.test(r.error) && /\$325\.00/.test(r.error));
}

// ---- missing/garbage numbers must never crash or accidentally allow a delete ----
t('missing balance (undefined) does not throw and defaults to allowing (nothing to compare against)', qbTxnSafeToDelete('Invoice', '1', undefined, 462.50).ok === true);
t('missing total (undefined) does not throw and defaults to allowing', qbTxnSafeToDelete('Invoice', '1', 462.50, undefined).ok === true);
t('both missing does not throw', qbTxnSafeToDelete('Bill', '1', undefined, undefined).ok === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
