// Sep 22 2026 fix — Work_Orders.Vendor_ID was never written anywhere in the Scope Proposal
// pipeline: /scope/to-wo creates the WO fully unassigned, and none of /scope/estimate,
// /scope/proposal/sign, scopeProposalBook, or scopeProposalBillMilestones ever touch
// Work_Orders.Vendor_ID. Confirmed live root cause of a real incident: vendor Cesar Diaz showed
// zero jobs in both his own portal (GET /vendor-workorders, filters on Work_Orders.Vendor_ID)
// and the admin Work Orders vendor filter, despite having signed, in-progress Scope Proposal
// work — because that field was permanently blank on every WO those jobs actually lived on.
//
// Two things shipped: (1) /scope/estimate (the one place Scopes.Vendor_ID is ever set) now also
// propagates onto the linked WO going forward; (2) POST /admin/backfill-scope-wo-vendor sweeps
// every already-existing gap. Neither of those two orchestration functions is meaningfully
// unit-testable without a live Sheets double (same reason no other qbApi/Sheets-calling function
// in this suite has its own test either — see test/scope-unbook.test.mjs's own note). What IS
// unit-tested here is the one pure decision rule both share: scopeBackfillEligible — most
// importantly, that it refuses to ever overwrite a WO that already has a vendor on file.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { scopeBackfillEligible } = new Function(grab('scopeBackfillEligible') + '\nreturn { scopeBackfillEligible };')();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// ---- the real Cesar/WO-1071 shape: scope has a vendor + a linked WO, WO's own Vendor_ID blank ----
t('scope with vendor + linked WO, WO vendor blank -> eligible',
  scopeBackfillEligible({ WO_ID: '1071', Vendor_ID: '3' }, { ID: '1071', Vendor_ID: '' }) === true);
t('WO Vendor_ID as undefined (never-set column) -> still eligible',
  scopeBackfillEligible({ WO_ID: '1071', Vendor_ID: '3' }, { ID: '1071' }) === true);

// ---- must never overwrite a WO that already has a vendor -- the one rule that matters most ----
t('WO already has a (possibly different) vendor -> refused, never overwritten',
  scopeBackfillEligible({ WO_ID: '1090', Vendor_ID: '3' }, { ID: '1090', Vendor_ID: '6' }) === false);
t('WO already has the SAME vendor -> still refused (no-op, not an error, but not "eligible")',
  scopeBackfillEligible({ WO_ID: '1090', Vendor_ID: '3' }, { ID: '1090', Vendor_ID: '3' }) === false);

// ---- missing pieces -> refused, never throws ----
t('scope has no WO_ID (no linked work order yet) -> refused', scopeBackfillEligible({ WO_ID: '', Vendor_ID: '3' }, { ID: '1', Vendor_ID: '' }) === false);
t('scope has no Vendor_ID yet -> refused', scopeBackfillEligible({ WO_ID: '1071', Vendor_ID: '' }, { ID: '1071', Vendor_ID: '' }) === false);
t('no matching WO row found (undefined) -> refused, does not throw', scopeBackfillEligible({ WO_ID: '9999', Vendor_ID: '3' }, undefined) === false);
t('null scope -> refused, does not throw', scopeBackfillEligible(null, { ID: '1', Vendor_ID: '' }) === false);
t('null wo -> refused, does not throw', scopeBackfillEligible({ WO_ID: '1', Vendor_ID: '3' }, null) === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
