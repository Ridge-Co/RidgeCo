// Nov 17 2026 (Brett): a receipt paid on a CUSTOMER's card still picks a work order and is ATTACHED there as a reference, but must never be billed.
// Runs the REAL worker.js functions (extracted, not reimplemented) against an in-memory fake sheet and proves:
//   - the attach writes a Non_Billable Receipts row, an Attachments gallery row, and nothing else (no Invoice_Review, no QuickBooks email, no Vendor_Bills)
//   - every billing path ignores it: listReceipts flag, scope materials actuals, the QB receipt sweep, both invoice-approval backstops, the invoice picker
//   - the receipt number (Invoice_Number) is saved to Receipts.Receipt_Number by confirm and attach, blank stays blank, and search returns it
import fs from 'node:fs'; import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const idx = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name, asyncFn) {
  const key = (asyncFn ? 'async function ' : 'function ') + name + '(';
  const i = src.indexOf(key); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓ ' + m); };

// ── fake world ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sheets = { Receipts: [], Attachments: [], Invoice_Review: [{ ID: '7', WO_ID: '1001', Active: 'TRUE', Own_Materials: '0', Own_Material_IDs: '', Customer_Total: '100', QB_Invoice_ID: '' }],
  Work_Orders: [{ ID: '1001', Property_ID: '11', Status: 'In Progress' }],
  Receipt_Recon_Queue: [] };
const log = [];   // every write, in order
const json = (body, status = 200) => ({ status, body, json: async () => body, clone() { return this; } });
const fetchTab = async (env, tab) => (sheets[tab] || []).map(r => ({ ...r }));
let nextId = 500;
const addRow = async (env, tab, row) => { const id = String(nextId++); (sheets[tab] = sheets[tab] || []).push({ ID: id, ...row }); log.push(['addRow', tab]); return json({ success: true, id }); };
const updateRow = async (env, tab, id, f) => { const r = (sheets[tab] || []).find(x => String(x.ID) === String(id)); Object.assign(r, f); log.push(['updateRow', tab, id]); return json({ ok: true }); };
const ensured = []; const ensureColumns = async (env, tab, cols) => { ensured.push([tab, cols.slice()]); };
const findRecentDuplicate = async () => null;
const spies = { appendReceiptToInvoiceReview: 0, sendReceiptsToQBEmail: 0 };
const appendReceiptToInvoiceReview = async () => { spies.appendReceiptToInvoiceReview++; return { linked: true }; };
const sendReceiptsToQBEmail = async () => { spies.sendReceiptsToQBEmail++; return json({ sent: 1 }); };
const scopeCoveringSignatureForWO = async () => null;
const logTelemetry = async () => {};
const _rcNorm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const code = [grab('receiptIsNonBilling'), grab('nonBillingReceiptIdsAmong', true), grab('addReceipt', true), grab('qbBatchQueuedNote'), grab('receiptAttachOnly', true), grab('receiptReconConfirm', true),
  grab('listReceipts', true), grab('scopeMaterialsBudgetSummary'), grab('receiptReconSearch', true)].join('\n');
const W = new Function('json', 'fetchTab', 'addRow', 'updateRow', 'ensureColumns', 'findRecentDuplicate', 'appendReceiptToInvoiceReview', 'sendReceiptsToQBEmail', 'scopeCoveringSignatureForWO', 'logTelemetry', '_rcNorm',
  code + '\nreturn { receiptIsNonBilling, nonBillingReceiptIdsAmong, addReceipt, receiptAttachOnly, receiptReconConfirm, listReceipts, scopeMaterialsBudgetSummary, receiptReconSearch };')(
  json, fetchTab, addRow, updateRow, ensureColumns, findRecentDuplicate, appendReceiptToInvoiceReview, sendReceiptsToQBEmail, scopeCoveringSignatureForWO, logTelemetry, _rcNorm);
const env = {};
const q = (o) => ({ ID: '1', Status: 'pending', Vendor: "Lowe's", Total: '43.23', Receipt_Date: '2026-11-10', PO_Reference: '', Invoice_Number: '99431', Source_File_ID: 'drv1', Source_File_URL: 'https://drive/x', Suggestion: JSON.stringify({ category: 'customer_paid', action: 'exclude' }), Manual_Customer_Card: 'TRUE', ...o });

console.log('receiptIsNonBilling');
ok(W.receiptIsNonBilling({ Non_Billable: 'TRUE' }) && W.receiptIsNonBilling({ Non_Billable: 'true' }), 'Non_Billable TRUE is non-billing');
ok(W.receiptIsNonBilling({ Category: 'customer_paid' }) && W.receiptIsNonBilling({ Category: 'attached_only' }), 'customer_paid and attached_only categories are non-billing even without the new column');
ok(!W.receiptIsNonBilling({ Category: 'billable' }) && !W.receiptIsNonBilling({ Category: 'company' }) && !W.receiptIsNonBilling({}) && !W.receiptIsNonBilling(null), 'ordinary / blank / null rows stay billable (existing rows unchanged)');

console.log('customer-card attach: what gets written');
sheets.Receipt_Recon_Queue.push(q({ ID: '1' }));
const res = await W.receiptAttachOnly(env, { id: '1', wo_id: '1001', amount: '43.23', description: 'screws', store: "Lowe's", date: '2026-11-10', customer_card: true });
ok(res.body.ok && res.body.customer_card === true && res.body.attached_only === true && res.body.receipt_number === '99431', 'attach succeeds and reports customer_card + the receipt number');
const rc = sheets.Receipts[0];
ok(rc && rc.WO_ID === '1001' && rc.Category === 'customer_paid' && rc.Non_Billable === 'TRUE', 'Receipts row is on the WO, Category customer_paid, Non_Billable TRUE');
ok(rc.Receipt_Number === '99431', 'Receipts.Receipt_Number holds the queue Invoice_Number');
ok(rc.Source_File_ID === 'drv1' && sheets.Attachments.length === 1 && sheets.Attachments[0].WO_ID === '1001' && sheets.Attachments[0].Receipt_ID === rc.ID, 'the image is attached to the WO gallery (Attachments row linked to the receipt)');
ok(sheets.Receipt_Recon_Queue[0].Status === 'attached_only' && /not billed, not expensed/.test(sheets.Receipt_Recon_Queue[0].Notes) && sheets.Receipt_Recon_Queue[0].Confirmed_Receipt_ID === rc.ID, 'queue row is attached_only with a plain note and the Receipts id (Undo can find it)');
ok(spies.appendReceiptToInvoiceReview === 0 && spies.sendReceiptsToQBEmail === 0, 'never called appendReceiptToInvoiceReview or sendReceiptsToQBEmail');
ok(log.every(([k, tab]) => ['Receipts', 'Attachments', 'Receipt_Recon_Queue'].includes(tab)), 'writes touched only Receipts, Attachments and the queue (' + [...new Set(log.map(l => l[1]))].join(', ') + ')');
ok(sheets.Invoice_Review[0].Own_Materials === '0' && sheets.Invoice_Review[0].Own_Material_IDs === '' && sheets.Invoice_Review[0].Customer_Total === '100', 'the WO\'s Invoice_Review row is untouched (no materials, no total change)');
ok(ensured.some(([t, c]) => t === 'Receipts' && c.includes('Non_Billable') && c.includes('Receipt_Number')), 'ensureColumns adds Non_Billable and Receipt_Number (its own failures are logged by ensureColumns, rule 174)');

console.log('customer-card attach: guards');
sheets.Receipt_Recon_Queue.push(q({ ID: '2', Manual_Customer_Card: '', Suggestion: JSON.stringify({ category: 'billable' }) }));
const bad = await W.receiptAttachOnly(env, { id: '2', wo_id: '1001', customer_card: true });
ok(bad.status === 409 && bad.body.code === 'not_customer_card', 'customer_card:true on a receipt that is NOT marked customer-card is refused (409), nothing written');
const noWo = await W.receiptAttachOnly(env, { id: '1', customer_card: true });
ok(noWo.status === 400, 'no work order -> 400');
sheets.Receipt_Recon_Queue.push(q({ ID: '3', Source_File_ID: '', Source_File_URL: '' }));
const noImg = await W.receiptAttachOnly(env, { id: '3', wo_id: '1001', customer_card: true });
ok(noImg.status === 400 && /no scanned image/.test(noImg.body.error), 'no image on file -> clear 400 (not a silent no-op)');
const bogus = await W.receiptAttachOnly(env, { id: '3', wo_id: '9999', customer_card: true });
ok(bogus.status === 400 && /No work order/.test(bogus.body.error), 'a nonexistent WO is refused');
ok(sheets.Receipts.length === 1, 'none of the refused attempts wrote a Receipts row');

console.log('every billing path ignores it');
const list = await W.listReceipts(env, new URL('https://x/receipts?wo_id=1001'));
ok(list.body.length === 1 && list.body[0].Non_Billing === 'TRUE', 'GET /receipts (feeds the invoice picker and WO panel) flags it Non_Billing TRUE');
sheets.Receipts.push({ ID: '900', WO_ID: '1001', Amount: '20.00', Category: 'billable', Active: 'TRUE', Role: 'hub' });
const list2 = await W.listReceipts(env, new URL('https://x/receipts?wo_id=1001'));
ok(list2.body.find(r => r.ID === '900').Non_Billing === 'FALSE', 'an ordinary billable receipt on the same WO is still Non_Billing FALSE');
const budget = W.scopeMaterialsBudgetSummary(100, 130, '1001', sheets.Receipts);
ok(budget.actual === 20 && budget.receipt_count === 1, 'scope materials actual counts only the billable $20, not the $43.23 customer-card reference');
const nb = await W.nonBillingReceiptIdsAmong(env, [rc.ID, '900']);
ok(nb.length === 1 && nb[0] === rc.ID, 'approval backstop identifies exactly the reference-only receipt');
ok((await W.nonBillingReceiptIdsAmong(env, [])).length === 0, 'no ids -> nothing to check, no sheet read needed');
// static wiring of the two approval endpoints + QB sweep + invoice picker
const approve = grab('approveInvoiceReview', true), bulk = grab('approveInvoiceReviewBulk', true), sweep = grab('qbBatchWaiting');
ok(/nonBillingReceiptIdsAmong\(env, _ownIds\)/.test(approve) && /receipt_not_billable/.test(approve) && /\}, 503\)/.test(approve.slice(approve.indexOf('nonBillingReceiptIdsAmong'))), 'single approval refuses reference-only receipts (409) and fails closed (503) when Receipts cannot be read');
ok(/nonBillingReceiptIdsAmong\(env, _ids, _nbRows\)/.test(bulk) && /receipt_not_billable/.test(bulk), 'bulk approval refuses them per item too');
ok(/Non_Billable \|\| ''\)\.toUpperCase\(\) === 'TRUE' && String\(r\.Non_Billable_Reason/.test(sweep), 'the daily QuickBooks receipt sweep skips Non_Billable customer-card rows (a customer\'s card was never a Ridge Co purchase)');
ok(/r\.Non_Billing !== 'TRUE'/.test(idx), 'index.html invoice materials picker never lists a Non_Billing receipt, so it can never be ticked or priced with markup');
ok(/r\.Non_Billing === 'TRUE' \? 0/.test(idx), 'index.html WO receipts total excludes reference-only receipts');
// invoice build reads only Own_Material_IDs: simulate a stale page sending the receipt id anyway
{
  const ids = [rc.ID]; const blocked = await W.nonBillingReceiptIdsAmong(env, ids);
  ok(blocked.includes(rc.ID), 'a stale page that still sends the receipt id in own_material_ids is blocked server-side');
}

console.log('receipt number: confirm + search');
sheets.Receipt_Recon_Queue.push(q({ ID: '10', Vendor: 'Home Depot', Total: '55.00', Invoice_Number: 'WH37678511', Manual_Customer_Card: '', Suggestion: JSON.stringify({ category: 'billable' }) }));
const conf = await W.receiptReconConfirm(env, { id: '10', wo_id: '1001', amount: '55.00', description: 'paint', store: 'Home Depot', date: '2026-11-11' });
const hdRow = sheets.Receipts.find(r => r.Description === 'paint');
ok(conf.body.ok && hdRow && hdRow.Receipt_Number === 'WH37678511' && conf.body.receipt_number === 'WH37678511', 'confirm saves the order number to Receipts.Receipt_Number and returns it');
ok(hdRow.Non_Billable === '' && hdRow.Category === 'billable', 'an ordinary confirm is unchanged: still billable, Non_Billable blank');
ok(spies.appendReceiptToInvoiceReview === 1, 'an ordinary confirm still folds into the invoice (billing path unchanged)');
sheets.Receipt_Recon_Queue.push(q({ ID: '11', Vendor: 'Ace', Total: '9.00', Invoice_Number: '', Manual_Customer_Card: '', Suggestion: JSON.stringify({ category: 'billable' }) }));
await W.receiptReconConfirm(env, { id: '11', wo_id: '1001', amount: '9.00', description: 'bolts', store: 'Ace', date: '2026-11-11' });
ok(sheets.Receipts.find(r => r.Description === 'bolts').Receipt_Number === '', 'a blank Invoice_Number saves a blank Receipt_Number (nothing invented, never "undefined")');
const s1 = await W.receiptReconSearch(env, new URL('https://x/receipt-recon/search?q=WH37678511'));
ok(s1.body.count === 1 && s1.body.results[0].receipt_number === 'WH37678511' && s1.body.results[0].non_billing === false, 'search finds a receipt BY its number and returns receipt_number');
const s2 = await W.receiptReconSearch(env, new URL('https://x/receipt-recon/search?q=43.23'));
ok(s2.body.results[0].receipt_number === '99431' && s2.body.results[0].non_billing === true, 'search shows the customer-card row with its number and non_billing true');
ok(!/undefined/.test(JSON.stringify(s2.body)), 'no "undefined" in search output');

console.log('fixed-price job cost (Brett: 8616 Tower Bridge Way, Lowe\'s $6.33, 2026-10-05, receipt 36109)');
sheets.Work_Orders.push({ ID: '1002', Property_ID: '11', Status: 'In Progress' });
sheets.Invoice_Review.push({ ID: '8', WO_ID: '1002', Active: 'TRUE', Own_Materials: '0', Own_Material_IDs: '', Customer_Total: '500', QB_Invoice_ID: '' });
sheets.Receipt_Recon_Queue.push(q({ ID: '179', Vendor: "Lowe's", Total: '6.33', Receipt_Date: '2026-10-05', PO_Reference: '8616 tower bridge way', Invoice_Number: '36109', Manual_Customer_Card: '', Suggestion: JSON.stringify({ category: 'billable', action: 'need_property' }) }));
const qbBefore = spies.sendReceiptsToQBEmail, irBefore = spies.appendReceiptToInvoiceReview;
const fp = await W.receiptAttachOnly(env, { id: '179', wo_id: '1002', amount: '6.33', description: 'fasteners', store: "Lowe's", date: '2026-10-05', non_billing_reason: 'fixed_price' });
ok(fp.body.ok && fp.body.fixed_price === true && fp.body.customer_card === false && fp.body.receipt_number === '36109', 'fixed-price attach succeeds, reports fixed_price and the receipt number');
const fr = sheets.Receipts.find(r => r.Description === 'fasteners');
ok(fr.WO_ID === '1002' && fr.Property_ID === '11' && fr.Non_Billable === 'TRUE' && fr.Non_Billable_Reason === 'fixed_price', 'Receipts row carries the WO, the property, the ONE non-billing flag and reason fixed_price');
ok(fr.Category === 'company' && fr.Receipt_Number === '36109' && Number(fr.Amount) === 6.33, 'recorded as a company expense (our cost) with receipt number 36109 and $6.33');
ok(spies.sendReceiptsToQBEmail === qbBefore && fp.body.qb_email && fp.body.qb_email.queued === true && fp.body.qb_email.sent === false, 'Nov 17 batch: the fixed-price expense is NOT emailed at attach; it waits in the daily QuickBooks batch (fixed-price cost is ours, so it is waiting, not skipped)');
ok(spies.appendReceiptToInvoiceReview === irBefore, 'never folded into an invoice (appendReceiptToInvoiceReview not called)');
const ir2 = sheets.Invoice_Review.find(r => r.ID === '8');
ok(ir2.Own_Materials === '0' && ir2.Own_Material_IDs === '' && ir2.Customer_Total === '500', 'the WO invoice row is untouched: no materials, no markup base, total unchanged');
ok(sheets.Attachments.some(a => a.WO_ID === '1002' && a.Receipt_ID === fr.ID), 'receipt image is attached to the WO');
ok(sheets.Receipt_Recon_Queue.find(r => r.ID === '179').Status === 'attached_only' && /not billed/.test(sheets.Receipt_Recon_Queue.find(r => r.ID === '179').Notes), 'queue row leaves Pending with a plain note');
const l3 = await W.listReceipts(env, new URL('https://x/receipts?wo_id=1002'));
ok(l3.body[0].Non_Billing === 'TRUE' && l3.body[0].Non_Billable_Reason === 'fixed_price', 'GET /receipts flags it Non_Billing and returns the reason for the WO tag');
ok((await W.nonBillingReceiptIdsAmong(env, [fr.ID])).includes(fr.ID), 'invoice approval backstop refuses it');
const bud2 = W.scopeMaterialsBudgetSummary(10, 13, '1002', sheets.Receipts);
ok(bud2.actual === 6.33, 'scope materials ACTUAL counts the fixed-price cost (it is our spend) while the customer-card reference stays out');
const s3 = await W.receiptReconSearch(env, new URL('https://x/receipt-recon/search?q=36109'));
ok(s3.body.results.length === 1 && s3.body.results[0].non_billable_reason === 'fixed_price', 'search by receipt number finds it and shows the reason');
ok(/String\(r\.Non_Billable_Reason \|\| ''\) !== 'fixed_price'/.test(sweep), 'QB sweep still skips customer-card references but not fixed-price costs');
// the customer-card path is unchanged: still NOT sent to QuickBooks
const qb2 = spies.sendReceiptsToQBEmail;
sheets.Receipt_Recon_Queue.push(q({ ID: '12' }));
await W.receiptAttachOnly(env, { id: '12', wo_id: '1001', customer_card: true });
ok(spies.sendReceiptsToQBEmail === qb2 && sheets.Receipts.find(r => r.Non_Billable_Reason === 'customer_card'), 'customer-card attach still sends nothing to QuickBooks and is tagged customer_card');

console.log(`\nreceipt-customer-card-nonbilling: ${n}/${n} passing`);
