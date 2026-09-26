// Pure-function coverage for the Vendor Standalone Billing + Self-Serve Work Orders build
// (Sep 24 2026 brief). Sliced straight from the live worker.js source, same convention as
// test/qb-address.test.mjs / test/trade-map.test.mjs — no Sheets/QuickBooks credentials
// needed or used; these three helpers are pure (no I/O).
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  const needle = 'function ' + name + '(';
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { validateApprovalSource, vendorHasBillingPropertyAccess, computeStandaloneBillTotals } = new Function(
  grab('validateApprovalSource') + '\n' +
  grab('vendorHasBillingPropertyAccess') + '\n' +
  grab('computeStandaloneBillTotals') + '\n' +
  'return { validateApprovalSource, vendorHasBillingPropertyAccess, computeStandaloneBillTotals };'
)();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// ── validateApprovalSource (§4a/4b) ──────────────────────────────────────────
t('owner is valid with no note', validateApprovalSource('owner', '').ok === true);
t('brett is valid with no note', validateApprovalSource('brett', '').ok === true);
t('other requires a note', validateApprovalSource('other', '').ok === false);
t('other with a note is valid', validateApprovalSource('other', 'discussed in person 9/24').ok === true);
t('other with only whitespace is still rejected', validateApprovalSource('other', '   ').ok === false);
t('unknown source is rejected', validateApprovalSource('vendor-decided', '').ok === false);
t('blank source is rejected', validateApprovalSource('', '').ok === false);
t('case-insensitive source', validateApprovalSource('OWNER', '').ok === true);
t('note is trimmed on success', validateApprovalSource('other', '  hi  ').note === 'hi');

// ── vendorHasBillingPropertyAccess (§3c) ─────────────────────────────────────
t('property in the list passes', vendorHasBillingPropertyAccess({ Billing_Property_Access: '10,20,30' }, '20') === true);
t('property not in the list fails', vendorHasBillingPropertyAccess({ Billing_Property_Access: '10,20,30' }, '99') === false);
t('spaces around ids are tolerated', vendorHasBillingPropertyAccess({ Billing_Property_Access: '10, 20 ,30' }, '20') === true);
t('blank list denies everything', vendorHasBillingPropertyAccess({ Billing_Property_Access: '' }, '20') === false);
t('missing vendor denies everything', vendorHasBillingPropertyAccess(null, '20') === false);
t('numeric vs string id both match', vendorHasBillingPropertyAccess({ Billing_Property_Access: '20' }, 20) === true);

// ── computeStandaloneBillTotals (§3c/§5) — matches the existing hourly/flat bill's
// Total/Receipts_Total/Receipts_Reimburse_Total formula EXACTLY (Total excludes items paid
// on Ridge Co's own card — same as vendorPayable in index.html's irCalc), so Review Bills'
// existing money math and QuickBooks send path never need to know a bill is standalone.
t('all-reimburse items: total = full amount', (() => {
  const r = computeStandaloneBillTotals([{ amount: 40, pay: 'reimburse' }, { amount: 10, pay: 'reimburse' }]);
  return r.receipts_total === 50 && r.receipts_reimburse_total === 50 && r.total === 50;
})());
t('mixed pay modes: total excludes account-paid items', (() => {
  const r = computeStandaloneBillTotals([{ amount: 40, pay: 'reimburse' }, { amount: 10, pay: 'account' }]);
  return r.receipts_total === 50 && r.receipts_reimburse_total === 40 && r.total === 40;
})());
t('all-account items: nothing owed to the vendor, but receipts_total is still the full bill', (() => {
  const r = computeStandaloneBillTotals([{ amount: 25, pay: 'account' }]);
  return r.receipts_total === 25 && r.receipts_reimburse_total === 0 && r.total === 0;
})());
t('zero/negative amounts are ignored', (() => {
  const r = computeStandaloneBillTotals([{ amount: 0, pay: 'reimburse' }, { amount: -5, pay: 'reimburse' }, { amount: 10, pay: 'reimburse' }]);
  return r.receipts_total === 10 && r.total === 10;
})());
t('empty/garbage input yields zeros, never throws', (() => {
  const r = computeStandaloneBillTotals(null);
  return r.receipts_total === 0 && r.receipts_reimburse_total === 0 && r.total === 0;
})());
t('missing pay field defaults to reimburse (owed to vendor)', (() => {
  const r = computeStandaloneBillTotals([{ amount: 15 }]);
  return r.receipts_reimburse_total === 15;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
