// In-house jobs (Brett is the vendor) have NO payable, so they must be kept off the vendor
// reconciliation — but NEVER at the cost of hiding real money owed. These pin the exact
// predicate used in qbVendorReconcile:
//   inHouse = !hasRealOpenBill && (irInHouseByWO[wo] === true || (vendorInHouse && !qbBillId))
//   (1) a per-job QB_In_House flag marks the row in-house (no QB bill);
//   (2) a vendor-level In_House flag marks a no-bill row in-house;
//   (3) SAFETY: a row with a REAL open QB bill is NEVER in-house, even if flags say so —
//       genuine money owed can't be hidden by a mislabelled flag;
//   (4) a plain external bill with no flags is never in-house.
import assert from 'node:assert';

// Mirror of the inline predicate in worker.js qbVendorReconcile.
function isInHouse({ irInHouse, vendorInHouse, qbBillId, qbBillFound, billBal }) {
  const hasRealOpenBill = !!qbBillFound && billBal !== null && billBal > 0.005;
  return !hasRealOpenBill && (irInHouse === true || (vendorInHouse && !qbBillId));
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// (1) per-job QB_In_House, no QB bill → in-house
ok(isInHouse({ irInHouse: true, vendorInHouse: false, qbBillId: '', qbBillFound: false, billBal: null }) === true,
  'per-job QB_In_House with no bill is in-house');

// (2) vendor-level In_House, no QB bill → in-house
ok(isInHouse({ irInHouse: false, vendorInHouse: true, qbBillId: '', qbBillFound: false, billBal: null }) === true,
  'vendor-level In_House with no bill is in-house');

// (3) SAFETY — a real OPEN QB bill is never in-house, even with both flags set
ok(isInHouse({ irInHouse: true, vendorInHouse: true, qbBillId: 'B12', qbBillFound: true, billBal: 460 }) === false,
  'a real open payable is never hidden as in-house');

// (3b) vendor In_House but the row DOES carry a bill id → not in-house via the vendor path
//      (only the per-job flag could mark it, and it isn't set here)
ok(isInHouse({ irInHouse: false, vendorInHouse: true, qbBillId: 'B7', qbBillFound: true, billBal: 100 }) === false,
  'vendor In_House does not hide a row that has its own QB bill');

// (3c) a PAID QB bill (balance 0) that is flagged in-house → in-house (nothing to pay anyway)
ok(isInHouse({ irInHouse: true, vendorInHouse: false, qbBillId: 'B9', qbBillFound: true, billBal: 0 }) === true,
  'a settled bill flagged in-house is in-house (no open payable to protect)');

// (4) plain external vendor, no flags → not in-house
ok(isInHouse({ irInHouse: false, vendorInHouse: false, qbBillId: '', qbBillFound: false, billBal: null }) === false,
  'external no-bill row is not in-house');

console.log('reconcile-inhouse: ' + n + ' assertions passed');
