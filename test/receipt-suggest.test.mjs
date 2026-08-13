// The Receipt Reconciler engine (CAP-002) decides where a receipt belongs with PURE code — no AI —
// so daily reconciliation costs nothing in model tokens. These pin the three deterministic pieces:
//   matchReceiptProperty — resolves the property from the PO by address token overlap, weighting the
//     house number double, and returns null below a confidence floor (so it flags, never mis-files);
//   rankReceiptWOs — returns only OPEN work orders, ranked by keyword overlap with the receipt;
//   receiptIsDuplicate — catches same-WO/amount/date/store re-posts (the bug we hit twice by hand).
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
// _rcNorm + the const RECEIPT_OPEN_STATUSES/RECEIPT_STOP are dependencies — pull them in too.
const norm = grab('_rcNorm');
const consts = "const RECEIPT_OPEN_STATUSES=['New','Assigned','Accepted','In Progress','On Hold','Pending Invoice','Complete'];" +
  "const RECEIPT_STOP=new Set(['the','and','for','with','apt','ste','unit','street','saint','st','ave','rd','ln','pl','n','s','e','w','2x','x']);";
const matchReceiptProperty = new Function(norm + '\n' + grab('matchReceiptProperty') + '\nreturn matchReceiptProperty;')();
const rankReceiptWOs = new Function(norm + '\n' + consts + '\n' + grab('rankReceiptWOs') + '\nreturn rankReceiptWOs;')();
const receiptIsDuplicate = new Function(norm + '\n' + grab('receiptIsDuplicate') + '\nreturn receiptIsDuplicate;')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const PROPS = [
  { ID: 8,  Address: '3014 N Calvert St' },
  { ID: 4,  Address: '1214 N Calvert St' },
  { ID: 5,  Address: '151 W Lanvale St' },
  { ID: 53, Address: '2309 Robb St' },
];

// matchReceiptProperty
ok(matchReceiptProperty('3014 N CALVERT APT B', PROPS).property.ID === 8, 'PO with house# picks 3014 not 1214');
ok(matchReceiptProperty('2309 ROBB STREET', PROPS).property.ID === 53, 'matches 2309 Robb');
ok(matchReceiptProperty('151 w lanvale 1', PROPS).property.ID === 5, 'matches 151 Lanvale');
ok(matchReceiptProperty('bmore', PROPS) === null, 'no address tokens ⇒ null (flagged, not mis-filed)');
ok(matchReceiptProperty('', PROPS) === null, 'empty PO ⇒ null');

// rankReceiptWOs — only open WOs, ranked by keyword overlap
const WOS = [
  { ID:'WO-1099', Status:'In Progress', Trade:'Electrical', Description:'Tenant reported smell of smoke and smoke alarm going off' },
  { ID:'WO-1035', Status:'Paid',        Trade:'Landscaping', Description:'Trim the tree branches' },
  { ID:'WO-1029', Status:'Assigned',    Trade:'General',     Description:'Apartment turnover, paint as needed' },
];
const rankSmoke = rankReceiptWOs({ items:['3x Smoke & Carbon combo hardwired','mosquito dunks'], po:'3014 N Calvert' }, WOS);
ok(rankSmoke.every(w => w.open), 'only open WOs returned (Paid WO-1035 excluded)');
ok(rankSmoke[0].id === 'WO-1099', 'smoke detectors rank the smoke-alarm WO first');
ok(rankReceiptWOs({ items:['paint'], po:'x' }, [{ID:'W1',Status:'Paid',Trade:'',Description:'paint'}]).length === 0, 'a Paid WO is never a target');
// Address tokens in the PO must NOT drive WO ranking (the live bug): a WO whose description merely
// repeats the address must lose to the WO that matches the actual materials.
const addrLeak = rankReceiptWOs({ items:['3x Smoke Carbon combo hardwired'], po:'3014 N Calvert Apt B' }, [
  { ID:'WO-1099', Status:'In Progress', Trade:'Electrical', Description:'smoke alarm going off' },
  { ID:'WO-1125', Status:'New',         Trade:'General',    Description:'3014 N Calvert Apt B condensate leak follow-up' },
]);
ok(addrLeak[0].id === 'WO-1099', 'address tokens do not leak into WO ranking — smoke WO wins over the address-repeating WO');

// receiptIsDuplicate
const RCPTS = [
  { WO_ID:'WO-1099', Amount:'217.07', Date:'2026-08-04', Store:'Home Depot', Active:'TRUE' },
  { WO_ID:'WO-1099', Amount:'50.00',  Date:'2026-08-04', Store:'Home Depot', Active:'FALSE' },
];
ok(receiptIsDuplicate(RCPTS, 'WO-1099', 217.07, '2026-08-04', 'home depot') === true, 'exact same WO+amt+date+store ⇒ duplicate (case-insensitive store)');
ok(receiptIsDuplicate(RCPTS, 'WO-1099', 217.07, '2026-08-05', 'Home Depot') === false, 'different date ⇒ not duplicate');
ok(receiptIsDuplicate(RCPTS, 'WO-1029', 217.07, '2026-08-04', 'Home Depot') === false, 'different WO ⇒ not duplicate');
ok(receiptIsDuplicate(RCPTS, 'WO-1099', 50.00, '2026-08-04', 'Home Depot') === false, 'a soft-deleted (Active FALSE) receipt does not count');

console.log('receipt-suggest: ' + n + ' assertions passed');
