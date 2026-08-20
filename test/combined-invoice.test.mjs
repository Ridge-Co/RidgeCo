// B-227 Phase 3 — combine every not-yet-invoiced approved Invoice_Review row sharing a WO_ID
// into ONE QuickBooks customer invoice, while still posting one separate QB Bill per vendor.
// Two layers tested: (1) qbGroupOpenRows, the pure grouping predicate, run for real against
// fixture rows — this is the money-safety-critical piece (get grouping wrong and either a
// bill silently drops off an invoice, or an already-sent invoice gets reopened); and (2) a
// static shape check on qbSendCombinedInvoice/qbSendInvoice so the loop-over-every-group-row
// write-back, the per-vendor Bill loop, and the batch-mapping guard can't quietly regress.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

// ── qbGroupOpenRows: the actual grouping predicate, executed for real ──────────
const { qbGroupOpenRows } = new Function(grab('qbGroupOpenRows') + '\nreturn { qbGroupOpenRows };')();

const laborRow = { ID: '1', WO_ID: 'WO-100', Bill_ID: 'B-1', Vendor_ID: 'V-1', Active: 'TRUE', QB_Invoice_ID: '' };
const materialsRow = { ID: '2', WO_ID: 'WO-100', Bill_ID: 'B-2', Vendor_ID: 'V-2', Active: 'TRUE', QB_Invoice_ID: '' };
const otherWoRow = { ID: '3', WO_ID: 'WO-200', Bill_ID: 'B-3', Vendor_ID: 'V-1', Active: 'TRUE', QB_Invoice_ID: '' };
const alreadyInvoicedRow = { ID: '4', WO_ID: 'WO-100', Bill_ID: 'B-4', Vendor_ID: 'V-3', Active: 'TRUE', QB_Invoice_ID: '9001' };
const voidedRow = { ID: '5', WO_ID: 'WO-100', Bill_ID: 'B-5', Vendor_ID: 'V-4', Active: 'FALSE', QB_Invoice_ID: '' };

// The ordinary single-vendor job: only one open row on the WO — groups with itself, length 1.
// This is the case that must behave EXACTLY like it did before Phase 3 existed.
t('a lone bill on a WO groups alone', (() => {
  const g = qbGroupOpenRows([laborRow], laborRow);
  return g.length === 1 && g[0].ID === '1';
})());

// The actual Phase 3 case: two open bills, same WO, neither invoiced yet — both join.
t('two open bills on the same WO combine', (() => {
  const g = qbGroupOpenRows([laborRow, materialsRow], laborRow);
  return g.length === 2 && g.some(r => r.ID === '1') && g.some(r => r.ID === '2');
})());
t('grouping is symmetric — starting from either row finds the same pair', (() => {
  const g = qbGroupOpenRows([laborRow, materialsRow], materialsRow);
  return g.length === 2 && g.some(r => r.ID === '1') && g.some(r => r.ID === '2');
})());

// A bill on a DIFFERENT work order must never be pulled in, even from the same vendor.
t('a bill on a different WO never joins the group', (() => {
  const g = qbGroupOpenRows([laborRow, materialsRow, otherWoRow], laborRow);
  return g.length === 2 && !g.some(r => r.ID === '3');
})());

// A row that already has a QB_Invoice_ID is a DIFFERENT invoice that already exists in
// QuickBooks. It must never be silently folded into a fresh combined send.
t('an already-invoiced sibling is excluded from a fresh group', (() => {
  const g = qbGroupOpenRows([laborRow, alreadyInvoicedRow], laborRow);
  return g.length === 1 && g[0].ID === '1';
})());

// And the reverse: asking to (re)send a row that ALREADY has an invoice must return just
// that row alone — never reach back and pull in freshly-approved siblings that haven't been
// invoiced yet. Grouping only ever happens going forward from a clean slate.
t('an already-invoiced row never reopens by pulling in new siblings', (() => {
  const g = qbGroupOpenRows([alreadyInvoicedRow, laborRow], alreadyInvoicedRow);
  return g.length === 1 && g[0].ID === '4';
})());

// A voided (Active=FALSE) row on the same WO must not be swept into a live send.
t('a voided sibling is excluded', (() => {
  const g = qbGroupOpenRows([laborRow, materialsRow, voidedRow], laborRow);
  return g.length === 2 && !g.some(r => r.ID === '5');
})());

// ── buildInvoiceLines: combine arithmetic — sum-of-parts must equal the whole ──────────
const { buildInvoiceLines } = new Function(grab('buildInvoiceLines') + '\nreturn { buildInvoiceLines };')();
const trade = { item: 'ITEM-1', expense: '55' };
const wo = { Description: 'Rekey locks', ID: 'WO-100' };

const laborBill = { Receipts_JSON: '[]', Truck_Stock: '0', Bill_Type: 'hourly', Hours: '2', Rate: '50' };
const laborIr = { WO_ID: 'WO-100', Customer_Total: '110' }; // 2hr x $50 + $10 markup, still ties to Customer_Total
const materialsBill = { Receipts_JSON: JSON.stringify([{ amount: 45, desc: 'Keys & locks' }]), Truck_Stock: '0' };
const materialsIr = { WO_ID: 'WO-100', Customer_Total: '60' }; // $45 materials + $15 markup/labor remainder

const laborInv = buildInvoiceLines(laborIr, laborBill, trade, 'Locks', wo, null, []);
const materialsInv = buildInvoiceLines(materialsIr, materialsBill, trade, 'Locks', wo, null, []);

t('each row\'s own lines still sum to its own Customer_Total',
  Math.abs(laborInv.lines.reduce((s,l)=>s+l.Amount,0) - 110) < 0.01 &&
  Math.abs(materialsInv.lines.reduce((s,l)=>s+l.Amount,0) - 60) < 0.01);

const combinedLines = laborInv.lines.concat(materialsInv.lines);
const combinedTotal = +(laborIr.Customer_Total ? Number(laborIr.Customer_Total) : 0) + Number(materialsIr.Customer_Total);
t('concatenated lines sum to the combined total — the arithmetic Phase 3 relies on',
  Math.abs(combinedLines.reduce((s,l)=>s+l.Amount,0) - combinedTotal) < 0.01);
t('materials line survives the combine untouched', combinedLines.some(l => l.Description.indexOf('Keys & locks') >= 0));
t('labor line survives the combine untouched (hours x rate breakdown, since it reconciles)',
  combinedLines.some(l => l.Description.indexOf('hr') >= 0 || l.Description.indexOf('Locks') >= 0));

// ── Static shape checks on the write path (money-critical, can't be unit-run without a
// live QuickBooks token — assert the source does what it must, mirroring the existing
// invoice-no-bill.test.mjs pattern for the same reason) ──────────
const combinedFn = grabAsync('qbSendCombinedInvoice');

t('every group row gets its OWN updateRow — not just the first (the actual Phase 3 gap)',
  /for \(const rb of rowBuilds\) \{[\s\S]*?await updateRow\(env, 'Invoice_Review', rb\.row\.ID,/.test(combinedFn));
t('every group row is written with the SAME invoice id — one invoice, not one per row',
  /QB_Invoice_ID: invoiceId, QB_Bill_ID: rb\.billId/.test(combinedFn));
t('one QB Bill is still created per distinct vendor, inside the per-row loop',
  /for \(const rb of rowBuilds\) \{[\s\S]*?VendorRef: \{ value: vendorId \}/.test(combinedFn));
t('the WO only flips to Invoiced when EVERY row in the group cleanly resolved',
  /const allSent = !!invoiceId && rowBuilds\.every\(rb => rb\.status === 'sent'\)/.test(combinedFn));
t('batch sends are guarded the same way the single-row path guards them — across every vendor in the group',
  /if \(ctx\.batch\) \{[\s\S]*?for \(const rb of rowBuilds\) \{[\s\S]*?needsVend/.test(combinedFn));
t('an in-house vendor in the group still skips its own bill without blocking the others',
  /vendorInHouse && vendorCost > 0|rb\.vendorInHouse && rb\.vendorCost > 0/.test(combinedFn));

// Regression guard for the bug ridgeco-validate caught before push: a row already carrying
// its own QB_Bill_ID (e.g. left in "Bill exists, Invoice blank" after a prior partial-failure
// retry) must NOT get billed a second time just because it's swept back into a fresh group —
// qbGroupOpenRows only looks at QB_Invoice_ID, so this guard is the only thing standing
// between a retry and a duplicate vendor Bill.
t('a row that already has its own QB_Bill_ID is never re-billed on a retry (duplicate-Bill guard)',
  /let billId = \(rb\.row\.QB_Bill_ID && rb\.row\.QB_Bill_ID\.trim\(\)\) \|\| '';[\s\S]{0,600}if \(!billId && rb\.vendorCost > 0 && !rb\.vendorInHouse\)/.test(combinedFn));
t('a reused/retried bill keeps its already-recorded bill number instead of getting blanked on write-back',
  /rb\.billDocAssigned = rb\.row\.QB_Bill_Number \|\| '';/.test(combinedFn));

const sendFn = grabAsync('qbSendInvoice');
t('qbSendInvoice branches to the combined path whenever the group has more than one row',
  /const groupRows = qbGroupOpenRows\(irRows, ir\);[\s\S]*?if \(groupRows\.length > 1\) \{[\s\S]*?return await qbSendCombinedInvoice/.test(sendFn));
t('the single-row path is untouched when the group is just this one row — no behavior change for the ordinary job',
  sendFn.indexOf('const custTotal  = Number(ir.Customer_Total) || 0;') > sendFn.indexOf('if (groupRows.length > 1)'));

const queueFn = grabAsync('qbReadyQueue');
t('the Send-to-QB queue surfaces combines_with so the screen can warn before Brett taps Send',
  /combines_with:/.test(queueFn));

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
