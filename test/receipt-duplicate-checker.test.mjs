// Pure-function coverage for the receipt duplicate CHECKER (Sep 16 2026 build, from the Sep 2
// design that was never actually shipped). Only the two I/O-free helpers are testable this way
// — receiptCheckDuplicatesOne and the qbDuplicate*/qbInvoiceLineDuplicates functions all make
// real QuickBooks calls and need live credentials this test harness doesn't have; those are
// flagged for Brett's live pass instead, same as every other QB-touching build in this repo.
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
const norm = grab('_rcNorm');
const body = [
  norm,
  grab('receiptDuplicatesAtProperty'),
  grab('qbInvoiceCandidatesByDate'),
  'return { receiptDuplicatesAtProperty, qbInvoiceCandidatesByDate };',
].join('\n');
const { receiptDuplicatesAtProperty, qbInvoiceCandidatesByDate } = new Function(body)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── receiptDuplicatesAtProperty ─────────────────────────────────────────────────────────────
const WOS = [
  { ID: '1001', Property_ID: '8' },
  { ID: '1002', Property_ID: '8' },
  { ID: '1003', Property_ID: '9' }, // different property
];
const RECEIPTS = [
  { ID: '50', Active: 'TRUE', WO_ID: '1001', Property_ID: '', Amount: '125.00', Date: '2026-08-01', Store: 'Home Depot' },
  { ID: '51', Active: 'TRUE', WO_ID: '1002', Property_ID: '', Amount: '125.00', Date: '2026-08-01', Store: 'Home Depot' }, // same property, DIFFERENT wo — the real gap
  { ID: '52', Active: 'TRUE', WO_ID: '1003', Property_ID: '', Amount: '125.00', Date: '2026-08-01', Store: 'Home Depot' }, // different property — must NOT match
  { ID: '53', Active: 'FALSE', WO_ID: '1002', Property_ID: '', Amount: '125.00', Date: '2026-08-01', Store: 'Home Depot' }, // inactive — must NOT match
  { ID: '54', Active: 'TRUE', WO_ID: '1002', Property_ID: '', Amount: '90.00', Date: '2026-08-01', Store: 'Home Depot' }, // wrong amount — must NOT match
];

{
  const dupes = receiptDuplicatesAtProperty({ total: 125.00, store: 'Home Depot', date: '2026-08-01', property_id: '8', id: '50' }, RECEIPTS, WOS);
  ok(dupes.length === 1, 'finds exactly one cross-WO duplicate at the same property (excludes itself, other property, inactive, wrong amount)');
  ok(dupes[0].id === '51', 'the match is the correct row (receipt 51, on a DIFFERENT WO at the same property)');
}
{
  const noneDiffProp = receiptDuplicatesAtProperty({ total: 125.00, store: 'Home Depot', date: '2026-08-01', property_id: '9', id: null }, RECEIPTS, WOS);
  ok(noneDiffProp.length === 1 && noneDiffProp[0].id === '52', 'scoping to property 9 finds only the property-9 receipt, not the property-8 ones');
}
{
  const noProp = receiptDuplicatesAtProperty({ total: 125.00, store: 'Home Depot', date: '2026-08-01', property_id: '', id: null }, RECEIPTS, WOS);
  ok(noProp.length === 0, 'refuses to scan without a resolved property_id rather than guessing (would be unsafe — could match across unrelated properties)');
}
{
  const noDate = receiptDuplicatesAtProperty({ total: 125.00, store: 'Home Depot', date: '', property_id: '8', id: null }, RECEIPTS, WOS);
  ok(noDate.length === 0, 'refuses to scan without a date either');
}
{
  const caseInsensitive = receiptDuplicatesAtProperty({ total: 125.00, store: 'HOME DEPOT', date: '2026-08-01', property_id: '8', id: '50' }, RECEIPTS, WOS);
  ok(caseInsensitive.length === 1, 'store match is case/punctuation-normalized via the shared _rcNorm, same as every other receipt-matching path');
}
{
  const resolvedViaWO = receiptDuplicatesAtProperty({ total: 125.00, store: 'Home Depot', date: '2026-08-01', property_id: '8', id: '999' }, RECEIPTS, WOS);
  ok(resolvedViaWO.some(d => d.id === '50') && resolvedViaWO.some(d => d.id === '51'),
    "a candidate's property resolves via its WO's Property_ID when the Receipts row itself has none (older rows may predate the column)");
}

// ── qbInvoiceCandidatesByDate ────────────────────────────────────────────────────────────────
const INVOICES = [
  { Id: '1', TxnDate: '2026-08-01' },
  { Id: '2', TxnDate: '2026-08-03' }, // within 45d window of 2026-08-01
  { Id: '3', TxnDate: '2026-06-01' }, // well outside the window
  { Id: '4' }, // no TxnDate at all — must not throw, must be excluded
];
{
  const cands = qbInvoiceCandidatesByDate(INVOICES, '2026-08-01', 45);
  ok(cands.length === 2 && cands.map(c => c.Id).sort().join(',') === '1,2', 'keeps only invoices within the date window, excludes the far-out one and the dateless one');
}
{
  ok(qbInvoiceCandidatesByDate(INVOICES, '', 45).length === 0, 'returns nothing for a blank date rather than matching everything');
}
{
  ok(qbInvoiceCandidatesByDate(INVOICES, 'not-a-date', 45).length === 0, 'returns nothing for an unparseable date rather than throwing');
}
{
  ok(qbInvoiceCandidatesByDate([], '2026-08-01', 45).length === 0, 'empty invoice list in, empty list out');
}

console.log(`receipt-duplicate-checker: ${n}/${n} passing`);
