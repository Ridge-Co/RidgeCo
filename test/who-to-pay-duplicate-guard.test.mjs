// Who To Pay — unlinked-payment double-pay guard (rule 153). Brett hit this live: WO-1025 / Alex
// Busey showed "PAY THE VENDOR" while the actual QuickBooks bill had already been paid by Venmo
// (recorded as a plain Expense, never linked to the Bill, so the Bill's own Balance stayed open).
// Extracts the REAL qbFindLikelyUnlinkedPayment + qbPayables out of worker.js and runs them
// against a fake qbApi/fetchTabs, same extraction convention as test/dupe-guard.test.mjs — this
// test cannot quietly drift from what ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL: ' + msg); } assert.ok(cond, msg); }

function extractFn(name, isAsync) {
  const marker = (isAsync ? 'async function ' : 'function ') + name + '(';
  const start = workerSrc.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in worker.js — did it get renamed?`);
  let i = workerSrc.indexOf('{', start), depth = 0;
  for (; i < workerSrc.length; i++) { if (workerSrc[i] === '{') depth++; else if (workerSrc[i] === '}') { depth--; if (!depth) { i++; break; } } }
  return workerSrc.slice(start, i);
}

// ═══════════════════ Part 1: qbFindLikelyUnlinkedPayment in isolation ═══════════════════
console.log('qbFindLikelyUnlinkedPayment — offline tests\n');

let lastQuery = '';
function makeQbApi(queryResponse, shouldThrow) {
  return async (env, path) => {
    lastQuery = path;
    if (shouldThrow) throw new Error('QuickBooks API down');
    return { QueryResponse: { Purchase: queryResponse || [] } };
  };
}
const qbEscapeSrc = extractFn('qbEscape', false);
const findFnSrc = extractFn('qbFindLikelyUnlinkedPayment', true);

function build(qbApi) {
  return new Function('qbApi', `${qbEscapeSrc}\n${findFnSrc}\nreturn qbFindLikelyUnlinkedPayment;`)(qbApi);
}

// Brett's exact case: a $297.50 Venmo payment sitting in QuickBooks as an unlinked Purchase.
const fn1 = build(makeQbApi([
  { Id: '5001', TxnDate: '2026-09-01', TotalAmt: 297.5, PaymentType: 'Cash', DocNumber: '', PrivateNote: 'Venmo payment - Alex' },
]));
const match1 = await fn1({}, 'FAKE_TOKEN', '123', 297.50);
ok(match1 !== null, 'finds the matching unlinked Venmo purchase');
ok(match1.amount === 297.5, 'reports the correct amount');
ok(match1.payment_type === 'Cash', 'reports the payment type');
ok(match1.note.includes('Venmo'), 'reports the memo/note so Brett can eyeball it');
ok(lastQuery.includes('123'), 'the query is scoped to the right vendor QBO id (got: ' + lastQuery + ')');
ok(lastQuery.includes('Purchase'), 'queries the Purchase entity (Expense/Check/CC charge), not Bill');

// Amount just barely within the $1 slack should still match (rounding/fee noise).
const fn2 = build(makeQbApi([{ Id: '5002', TxnDate: '2026-09-01', TotalAmt: 297.99, PaymentType: 'Check' }]));
const match2 = await fn2({}, 'x', '123', 297.50);
ok(match2 !== null, 'a close-enough amount (within $1) still counts as a likely match');

// No Purchase transactions at all for this vendor -> no match, no false alarm.
const fn3 = build(makeQbApi([]));
const match3 = await fn3({}, 'x', '123', 297.50);
ok(match3 === null, 'no Purchase transactions at all -> no false alarm');

// A Purchase exists but for a totally different amount -> not a match.
const fn4 = build(makeQbApi([{ Id: '5003', TxnDate: '2026-09-01', TotalAmt: 50.00, PaymentType: 'Cash' }]));
const match4 = await fn4({}, 'x', '123', 297.50);
ok(match4 === null, 'a Purchase for an unrelated amount is not treated as a match');

// No vendor QBO id at all (vendor never linked to QuickBooks) -> can't check, no crash.
const fn5 = build(makeQbApi([{ Id: '5004', TotalAmt: 297.5 }]));
const match5 = await fn5({}, 'x', '', 297.50);
ok(match5 === null, 'no vendor QBO id -> skips the check cleanly, no crash');

// $0/negative owed -> nothing meaningful to check.
const match6 = await fn5({}, 'x', '123', 0);
ok(match6 === null, 'zero amount owed -> skips the check');

// qbApi throwing (real-world: rate limit, network blip) -> fails OPEN, no warning, no crash.
// This can only ever ADD a warning, never hide/block the existing "PAY THE VENDOR" state.
const fn7 = build(makeQbApi(null, true));
const match7 = await fn7({}, 'x', '123', 297.50);
ok(match7 === null, 'a QuickBooks API failure fails open (no warning shown) rather than throwing');

// ═══════════════════ Part 2: full qbPayables state-machine integration ═══════════════════
console.log('\nqbPayables — state machine integration — offline tests\n');

function buildQbPayables({ invoiceBalance, billBalance, billTotal, purchases, irs, vendors }) {
  const fetchTabs = async (env, tabs) => tabs.map(t => (t === 'Invoice_Review' ? irs : t === 'Vendors' ? vendors : []));
  const qbAccessToken = async () => 'FAKE_TOKEN';
  const qbApi = async (env, path) => {
    if (path.startsWith('invoice/')) return { Invoice: { Balance: invoiceBalance, DocNumber: '1648' } };
    if (path.startsWith('bill/')) return { Bill: { Balance: billBalance, TotalAmt: billTotal, DueDate: '2026-09-15', DocNumber: '' } };
    if (path.startsWith('query?')) return { QueryResponse: { Purchase: purchases || [] } };
    return {};
  };
  const qbVendorDisplayName = (v) => (v && v.Company) || 'Vendor';
  const vendorTermLabel = () => 'Due on receipt';
  const json = (body) => body;
  const src = `${extractFn('qbEscape', false)}\n${extractFn('qbFindLikelyUnlinkedPayment', true)}\n${extractFn('qbPayables', true)}\nreturn qbPayables;`;
  return new Function('fetchTabs', 'qbAccessToken', 'qbApi', 'qbVendorDisplayName', 'vendorTermLabel', 'json', src)
    (fetchTabs, qbAccessToken, qbApi, qbVendorDisplayName, vendorTermLabel, json);
}

// Brett's exact WO-1025 / Alex Busey scenario: owner (customer) paid in full ($495, invoice
// balance 0), but the vendor bill ($297.50) has a matching unlinked Venmo Purchase sitting in QB.
const irRow = { ID: '1', Active: 'TRUE', WO_ID: 'WO-1025', QB_Invoice_ID: 'INV-1', QB_Bill_ID: 'BILL-7578', Approved_Date: new Date().toISOString(), Customer_Total: '495.00', Vendor_Cost: '297.50', Vendor_ID: '9', Vendor_Name: '', QB_In_House: 'FALSE' };
const vendorRow = { ID: '9', QBO_Vendor_ID: '77', Company: 'Alex Busey' };

const qbPayablesDup = buildQbPayables({
  invoiceBalance: 0, billBalance: 297.50, billTotal: 297.50,
  purchases: [{ Id: '9001', TxnDate: '2026-09-02', TotalAmt: 297.50, PaymentType: 'Cash', PrivateNote: 'paid by venmo' }],
  irs: [irRow], vendors: [vendorRow],
});
const resDup = await qbPayablesDup({}, new URL('http://x/?days=90'));
const rowDup = resDup.rows[0];
ok(rowDup.state === 'possible duplicate', `WO-1025/Alex Busey now flags as 'possible duplicate' instead of 'PAY THE VENDOR' (got: ${rowDup.state})`);
ok(rowDup.possible_duplicate && rowDup.possible_duplicate.amount === 297.50, 'the flagged row carries the matching QuickBooks transaction detail');
ok(rowDup.wo_id === 'WO-1025' && rowDup.vendor_name === 'Alex Busey', 'still the right WO/vendor');

// The bulk-pay total must NOT include a possible-duplicate row -- Brett should never be able to
// batch-mark-paid something the Hub itself flagged as possibly already paid.
ok(resDup.owed_now === 0 && resDup.owed_total === 0, 'a possible-duplicate row is excluded from the ready-to-pay total/count');

// ---- Regression: the ordinary case (no matching Purchase) still says PAY THE VENDOR as before ----
const qbPayablesNormal = buildQbPayables({
  invoiceBalance: 0, billBalance: 297.50, billTotal: 297.50,
  purchases: [], // nothing unusual in QuickBooks
  irs: [irRow], vendors: [vendorRow],
});
const resNormal = await qbPayablesNormal({}, new URL('http://x/?days=90'));
ok(resNormal.rows[0].state === 'PAY THE VENDOR', 'with no matching Purchase, the row still correctly says PAY THE VENDOR (no false positives)');
ok(resNormal.rows[0].possible_duplicate === null, 'no duplicate data attached when nothing was found');
ok(resNormal.owed_now === 1 && Math.abs(resNormal.owed_total - 297.50) < 0.01, 'a genuinely-owed bill still counts toward the ready-to-pay total');

// ---- The check only ever runs when a row would otherwise say PAY THE VENDOR -- an already-paid
// vendor bill should never trigger a Purchase-transaction lookup at all (nothing to protect against) ----
let purchaseQueried = false;
const fetchTabsPaid = async (env, tabs) => tabs.map(t => (t === 'Invoice_Review' ? [irRow] : t === 'Vendors' ? [vendorRow] : []));
const qbApiPaid = async (env, path) => {
  if (path.startsWith('invoice/')) return { Invoice: { Balance: 0, DocNumber: '1648' } };
  if (path.startsWith('bill/')) return { Bill: { Balance: 0, TotalAmt: 297.50, DueDate: '', DocNumber: '' } }; // vendor bill ALREADY paid
  if (path.startsWith('query?')) { purchaseQueried = true; return { QueryResponse: { Purchase: [] } }; }
  return {};
};
const srcPaid = `${extractFn('qbEscape', false)}\n${extractFn('qbFindLikelyUnlinkedPayment', true)}\n${extractFn('qbPayables', true)}\nreturn qbPayables;`;
const qbPayablesAlreadyPaid = new Function('fetchTabs', 'qbAccessToken', 'qbApi', 'qbVendorDisplayName', 'vendorTermLabel', 'json', srcPaid)
  (fetchTabsPaid, async () => 'x', qbApiPaid, (v) => (v && v.Company) || 'Vendor', () => 'Due on receipt', (b) => b);
const resPaid = await qbPayablesAlreadyPaid({}, new URL('http://x/?days=90'));
ok(resPaid.rows[0].state === 'vendor paid', 'a genuinely already-paid vendor bill still says vendor paid');
ok(purchaseQueried === false, 'the Purchase cross-check is never run for rows that are not about to say PAY THE VENDOR (no wasted QB API calls)');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
