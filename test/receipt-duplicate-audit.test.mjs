// Pure-function coverage for the QuickBooks duplicate-receipt AUDIT (Task 1, Sep 22 2026
// handoff). This is a read-only, all-invoice/all-receipt sweep — distinct from the existing
// receiptCheckDuplicatesOne (5-invoice, ±45-day, on-demand). Only the I/O-free helpers are
// testable this way; the build-index/scan/flags/mark endpoints make real QuickBooks + Sheets
// calls and are covered by the live staging pass (Brett's own confirmation), same convention as
// every other QB-touching build in this repo (see receipt-duplicate-checker.test.mjs).
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
const body = [
  grab('qbInvoiceLineCacheRows'),
  grab('resolveWOCustomerId'),
  grab('receiptDuplicateAuditMatches'),
  grab('receiptDuplicateAuditDecision'),
  'return { qbInvoiceLineCacheRows, resolveWOCustomerId, receiptDuplicateAuditMatches, receiptDuplicateAuditDecision };',
].join('\n');
const { qbInvoiceLineCacheRows, resolveWOCustomerId, receiptDuplicateAuditMatches, receiptDuplicateAuditDecision } = new Function(body)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── qbInvoiceLineCacheRows ─────────────────────────────────────────────────────────
{
  const rows = qbInvoiceLineCacheRows({
    Id: '99', DocNumber: '1705', TxnDate: '2026-08-20', TotalAmt: 150, Balance: 0,
    CustomerRef: { value: '42', name: 'Phoenix Estates' },
    Line: [
      { DetailType: 'SalesItemLineDetail', Amount: 100, Description: 'Materials — paint' },
      { DetailType: 'SalesItemLineDetail', Amount: 50, Description: 'Labor' },
      { DetailType: 'SubTotalLineDetail', Amount: 150 }, // must be excluded — not a real charge line
    ],
  });
  ok(rows.length === 2, 'extracts only SalesItemLineDetail lines, skips SubTotal/other line types');
  ok(rows[0].invoice_id === '99' && rows[0].doc === '1705' && rows[0].date === '2026-08-20', 'carries invoice id/doc/date onto every line');
  ok(rows[0].customer_id === '42' && rows[0].customer_name === 'Phoenix Estates', 'carries the resolved customer id+name');
  ok(rows.every(r => r.paid === true), 'Balance 0 on a positive TotalAmt marks every line paid');
}
{
  const rows = qbInvoiceLineCacheRows({ Id: '1', TotalAmt: 100, Balance: 40, Line: [{ DetailType: 'SalesItemLineDetail', Amount: 100 }] });
  ok(rows[0].paid === false, 'a nonzero remaining Balance marks the line unpaid');
}
{
  ok(qbInvoiceLineCacheRows(null).length === 0, 'null invoice → empty array, never throws');
  ok(qbInvoiceLineCacheRows({ Id: '1', Line: [{ DetailType: 'SalesItemLineDetail', Amount: 0 }] }).length === 0, 'a zero-amount line is dropped');
}

// ── resolveWOCustomerId ─────────────────────────────────────────────────────────────
const WOS = [{ ID: '1001', Property_ID: '8', Unit_ID: '' }, { ID: '1002', Property_ID: '8', Unit_ID: 'U1' }, { ID: '1003', Property_ID: '9', Unit_ID: '' }];
const PROPS = [{ ID: '8', Owner_ID: '5', QBO_Customer_ID: '' }, { ID: '9', Owner_ID: '6', QBO_Customer_ID: '77' }];
const UNITS = [{ ID: 'U1', QBO_Customer_ID: '88' }];
const OWNERS = [{ ID: '5', QBO_Customer_ID: '55' }, { ID: '6', QBO_Customer_ID: '66' }];
{
  ok(resolveWOCustomerId('1001', WOS, PROPS, UNITS, OWNERS) === '55', 'falls back to the owner customer id when property+unit have none');
  ok(resolveWOCustomerId('1002', WOS, PROPS, UNITS, OWNERS) === '88', 'unit customer id wins over property/owner when set');
  ok(resolveWOCustomerId('1003', WOS, PROPS, UNITS, OWNERS) === '77', 'property customer id wins over owner when set and no unit override');
  ok(resolveWOCustomerId('9999', WOS, PROPS, UNITS, OWNERS) === '', 'unknown WO id resolves to empty string, not a throw');
}

// ── receiptDuplicateAuditMatches ──────────────────────────────────────────────────────────
const CACHE = [
  { Invoice_ID: '1', Doc_Number: '100', TxnDate: '2026-08-01', Customer_QB_ID: '55', Amount: '125.00', Line_Description: 'paint', Paid: 'TRUE', Active: 'TRUE' },
  { Invoice_ID: '2', Doc_Number: '101', TxnDate: '2026-07-01', Customer_QB_ID: '55', Amount: '125.00', Line_Description: 'earlier', Paid: 'FALSE', Active: 'TRUE' }, // BEFORE the receipt date — must be excluded
  { Invoice_ID: '3', Doc_Number: '102', TxnDate: '2026-09-01', Customer_QB_ID: '66', Amount: '90.00', Line_Description: 'wrong amount', Paid: 'TRUE', Active: 'TRUE' },
  { Invoice_ID: '4', Doc_Number: '103', TxnDate: '2026-08-01', Customer_QB_ID: '55', Amount: '125.00', Line_Description: 'inactive', Paid: 'TRUE', Active: 'FALSE' }, // inactive cache row — excluded
];
{
  const m = receiptDuplicateAuditMatches({ amount: '125.00', date: '2026-08-01' }, CACHE);
  ok(m.length === 1 && m[0].invoice_id === '1', 'matches same-amount lines on/after the receipt date only, excludes earlier invoices, wrong amount, and inactive rows');
}
{
  ok(receiptDuplicateAuditMatches({ amount: '0', date: '2026-08-01' }, CACHE).length === 0, 'zero/blank amount never matches anything');
  ok(receiptDuplicateAuditMatches({ amount: '125.00', date: '' }, CACHE).length === 0, 'blank receipt date refuses to scan rather than matching everything');
}
{
  const sameDay = receiptDuplicateAuditMatches({ amount: '90.00', date: '2026-09-01' }, CACHE);
  ok(sameDay.length === 1, 'an invoice dated exactly ON the receipt date counts as a match (on-or-after, not strictly after)');
}

// ── receiptDuplicateAuditDecision ────────────────────────────────────────────────────────
{
  const d = receiptDuplicateAuditDecision([], '55');
  ok(d.flagged === false, 'zero matches never flags');
}
{
  const d = receiptDuplicateAuditDecision([{ doc: '1', customer_id: '55' }, { doc: '2', customer_id: '55' }], '55');
  ok(d.flagged === true && /2 separate invoice lines/.test(d.reason), '2+ matches flags on count alone, even at the receipt\'s own customer');
}
{
  const d = receiptDuplicateAuditDecision([{ doc: '1', customer_id: '66', date: '2026-08-05' }], '55');
  ok(d.flagged === true && /different customer/.test(d.reason), 'a single match at a DIFFERENT resolved customer flags');
}
{
  const d = receiptDuplicateAuditDecision([{ doc: '1', customer_id: '55' }], '55');
  ok(d.flagged === false, 'a single match at the SAME customer does not flag (amount alone across one invoice is not evidence)');
}
{
  const d = receiptDuplicateAuditDecision([{ doc: '1', customer_id: '' }], '');
  ok(d.flagged === false, 'unresolved customer ids on both sides never flag as "different" — unknown is never treated as different');
}
{
  const d = receiptDuplicateAuditDecision([{ doc: '1', customer_id: '66' }], '');
  ok(d.flagged === false, 'an unresolved OWN customer id never flags on the customer-mismatch path, even if the match has one');
}

console.log(`receipt-duplicate-audit: ${n}/${n} passing`);
