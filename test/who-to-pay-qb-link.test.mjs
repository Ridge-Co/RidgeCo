// Who To Pay — "open bill in QB" deep link (rule 151). Extracts the REAL card(r) renderer and
// qbBillLink() out of index.html and runs them against synthetic row data, same
// extract-the-real-function convention as the worker.js tests (test/dupe-guard.test.mjs etc.) —
// this test cannot quietly drift from what ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL: ' + msg); } assert.ok(cond, msg); }

function extractBraced(startIdx) {
  let i = src.indexOf('{', startIdx), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } }
  return src.slice(startIdx, i);
}
// The card(r) renderer lives specifically inside loadPayables — there's a second, unrelated
// `function card(...)` elsewhere in index.html (a pricing-option UI card), so anchor the search
// to the exact single-arg signature used inside loadPayables, not just "function card(".
const cardStart = src.indexOf('function card(r) {');
if (cardStart === -1) throw new Error('function card(r) not found in index.html — did loadPayables get refactored?');
const cardSrc = extractBraced(cardStart);

const qbBillLinkStart = src.indexOf('function qbBillLink(');
if (qbBillLinkStart === -1) throw new Error('qbBillLink not found in index.html');
const qbBillLinkSrc = extractBraced(qbBillLinkStart);

// esc() is index.html's real HTML-escaping helper elsewhere in the file — reuse it verbatim
// rather than a stand-in, so escaping behavior in the test matches production exactly.
const escStart = src.indexOf('function esc(');
const escSrc = extractBraced(escStart);

const card = new Function(`${escSrc}\n${qbBillLinkSrc}\nreturn (${cardSrc});`)();

console.log('Who To Pay — QB bill link — offline tests\n');

// Brett's exact example from the request: WO-1048, Eddie Smith, vendor inv WO-1048, cust inv
// #1619, PAY THE VENDOR, owner billed $1050 (paid), vendor owed $705 (Due on receipt, due
// 2026-09-03), with a real bill_id present.
const row = {
  wo_id: 'WO-1048', vendor_name: 'Eddie Smith', invoice_number: '1619',
  state: 'PAY THE VENDOR', bill_id: '9142', vendor_ref: '', vendor_cost: 705, vendor_balance: 705,
  customer_total: 1050, customer_paid: true, customer_balance: 0, customer_partial: false,
  vendor_paid: false, vendor_partial: false, terms: 'Due on receipt', bill_due: '2026-09-03', in_house: false,
};

const html = card(row);

ok(html.includes('open bill in QB'), 'card includes an "open bill in QB" link');
ok(html.includes('https://app.qbo.intuit.com/app/bill?txnId=9142'), 'link points at the real QB bill deep-link URL with the exact bill_id (got: ' + (html.match(/href="([^"]*)"/) || [])[1] + ')');
ok(html.includes('target="_blank"') && html.includes('rel="noopener"'), 'link opens in a new tab safely (matches the existing qbInvoiceLink convention)');
ok(html.includes('Vendor owed $705.00'), 'still shows the vendor-owed amount as before');
ok(html.includes('Due on receipt') && html.includes('due 2026-09-03'), 'still shows terms/due date as before');
ok(html.includes('Owner billed $1050.00') && html.includes('paid'), 'still shows owner-billed status as before');

// ---- No bill_id at all -> no bill link, no crash, falls back to the existing "no vendor bill" text ----
const rowNoBill = { ...row, bill_id: '', vendor_ref: '', in_house: false };
const htmlNoBill = card(rowNoBill);
ok(!htmlNoBill.includes('open bill in QB'), 'no bill_id -> no QB link rendered');
ok(htmlNoBill.includes('no vendor bill'), 'falls back to the existing "no vendor bill" text');

// ---- Link still shows on non-"ready to pay" states too, as long as a real bill_id exists
//      (e.g. "owner paid in part") -- Brett can look any real bill up, not just PAY THE VENDOR ones ----
const rowPartial = { ...row, state: 'owner paid in part', customer_paid: false, customer_partial: true, customer_balance: 200 };
const htmlPartial = card(rowPartial);
ok(htmlPartial.includes('https://app.qbo.intuit.com/app/bill?txnId=9142'), 'link also shows on other states with a real bill, not just PAY THE VENDOR');

// ---- Bill id gets URL-encoded (defensive -- QB ids are normally plain numeric, but never trust it blind) ----
const rowWeirdId = { ...row, bill_id: '91 42&x' };
const htmlWeirdId = card(rowWeirdId);
ok(htmlWeirdId.includes(encodeURIComponent('91 42&x')), 'bill_id is URL-encoded into the link, not concatenated raw');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
