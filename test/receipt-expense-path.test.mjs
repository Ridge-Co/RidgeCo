// Offline test for the Receipt Reconciler expense path (Sep 22 2026).
// Run: node test/receipt-expense-path.test.mjs
// Extracts the REAL receiptReconConfirm and sendReceiptsToQBEmail from worker.js and runs them
// against fake Sheets/Drive/Gmail. Checks: a no-work-order confirm is always recorded as an
// expense (category 'company', even when the scanner said 'billable'), goes to QuickBooks right
// away (only that one receipt), never touches an invoice; a work-order confirm is unchanged.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
function extractFn(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
const jsonResp = (o, status = 200) => ({ status, json: async () => o, clone() { return this; } });

function world() {
  const tabs = {
    Receipt_Recon_Queue: [
      { ID: '1', Status: 'pending', Total: '50.22', Vendor: 'Home Depot', Receipt_Date: '2026-09-04', PO_Reference: '1577 ingleside', Source_File_ID: 'F1', Source_File_URL: 'u1', Suggestion: JSON.stringify({ category: 'billable', action: 'suggest' }) },
      { ID: '2', Status: 'pending', Total: '18.13', Vendor: 'Home Depot', Receipt_Date: '2026-08-24', PO_Reference: '2309 ROBB ST', Source_File_ID: 'F2', Suggestion: JSON.stringify({ category: 'billable' }) },
      { ID: '3', Status: 'pending', Total: '56.04', Vendor: 'Home Depot', Receipt_Date: '2026-09-04', PO_Reference: 'bmore', Source_File_ID: 'F3', Suggestion: JSON.stringify({ category: 'company', action: 'exclude' }) },
    ],
    Receipts: [
      { ID: '900', Active: 'TRUE', QB_Email_Sent: 'FALSE', Store: 'Older', Amount: '9.99', Payment_Source: 'company_card' },  // an older unsent row — must NOT be sent by an expense tap
    ],
    Work_Orders: [{ ID: 'WO-1200', Description: 'tub drain' }],
    Properties: [{ ID: '85', Address: '1864 Kerns School Rd, Springfield WV' }],
  };
  const sent = [], irCalls = [], updates = [];
  let nextId = 1000;
  const deps = {
    json: (o, s) => jsonResp(o, s),
    fetchTab: async (env, t) => (tabs[t] || []).map(r => ({ ...r })),
    fetchConfig: async () => ({ qb_receipts_email: 'qb@example.com' }),
    ensureColumns: async () => {},
    updateRow: async (env, t, id, fields) => { updates.push({ t, id, fields }); const r = (tabs[t] || []).find(x => String(x.ID) === String(id)); if (r) Object.assign(r, fields); },
    addReceipt: async (env, body) => { const id = String(nextId++); tabs.Receipts.push({ ID: id, Active: 'TRUE', QB_Email_Sent: 'FALSE', Store: body.store, Amount: String(body.amount), WO_ID: body.wo_id, Property_ID: body.property_id, Category: body.category, Payment_Source: 'company_card', Source_File_ID: body.source_file_id }); return jsonResp({ success: true, id, amount: String(body.amount) }); },
    scopeCoveringSignatureForWO: async () => null,
    appendReceiptToInvoiceReview: async (env, a) => { irCalls.push(a); return { linked: true }; },
    _recoverReceiptSourceFile: (r) => ({ id: r.Source_File_ID || '', url: '' }),
    getAccessToken: async () => 't',
    driveDownload: async () => ({ bytes: new ArrayBuffer(2), mime: 'application/pdf' }),
    bytesToB64: () => 'AA==',
    gmailSendEmailWithAttachment: async (env, m) => { sent.push(m); },
    _escHtml: (s) => String(s),
    setTimeout: (f) => f(),
  };
  const names = Object.keys(deps);
  const sendQB = new Function(...names, `return (${extractFn('sendReceiptsToQBEmail')});`)(...names.map(n => deps[n]));
  deps.sendReceiptsToQBEmail = sendQB;
  const names2 = Object.keys(deps);
  const confirm = new Function(...names2, `return (${extractFn('receiptReconConfirm')});`)(...names2.map(n => deps[n]));
  return { tabs, sent, irCalls, confirm: async (b) => (await confirm({}, b)).json() };
}

{
  const w = world();
  const r = await w.confirm({ id: '1', no_wo: true, property_id: '', amount: '50.22', store: 'Home Depot', date: '2026-09-04', description: 'gloves, cleaner, tape' });
  const row = w.tabs.Receipts.find(x => x.ID === r.id);
  ok(r.ok && row && row.Category === 'company', 'Ridge Co expense on a scanner-"billable" receipt is recorded as category company (expense), not billable');
  ok(row.WO_ID === '' && row.Property_ID === '', 'no work order, no property');
  ok(w.irCalls.length === 0, 'never touches an invoice');
  ok(r.qb_email && r.qb_email.sent === true && w.sent.length === 1, 'sent to QuickBooks right away');
  ok(/General Ridge Co expense/.test(w.sent[0].html) && w.sent[0].attachment, 'QB email says Ridge Co expense and carries the receipt file');
  ok(w.tabs.Receipts.find(x => x.ID === '900').QB_Email_Sent === 'FALSE', 'an older unsent receipt was NOT sent by this tap (only the one just recorded)');
  ok(w.tabs.Receipt_Recon_Queue.find(x => x.ID === '1').Status === 'confirmed', 'queue row marked confirmed');
}
{
  const w = world();
  const r = await w.confirm({ id: '2', no_wo: true, property_id: '85', amount: '18.13' });
  const row = w.tabs.Receipts.find(x => x.ID === r.id);
  ok(row.Property_ID === '85' && row.Category === 'company', 'Kerns School Rd expense: property 85, category company');
  ok(/Expense — property: 1864 Kerns School Rd/.test(w.sent[0].html), 'QB email names 1864 Kerns School Rd as an expense');
}
{
  const w = world();
  const r = await w.confirm({ id: '2', wo_id: 'WO-1200', amount: '18.13' });
  const row = w.tabs.Receipts.find(x => x.ID === r.id);
  ok(row.Category === 'billable' && row.WO_ID === 'WO-1200', 'work-order confirm unchanged: billable on the WO');
  ok(w.irCalls.length === 1, 'work-order confirm still folds into the invoice');
  ok(w.sent.length === 0 && r.qb_email === null, 'work-order confirm is NOT sent to QB immediately (daily sweep, as before)');
}
{
  const w = world();
  const r = await w.confirm({ id: '3', no_wo: true, amount: '56.04' });
  ok(w.tabs.Receipts.find(x => x.ID === r.id).Category === 'company' && r.qb_email.sent, 'existing company-expense ("bmore") path still works and now goes to QB right away');
}
{
  const w = world();
  const r = await w.confirm({ id: '1', no_wo: true, amount: '50.22' });
  const again = await w.confirm({ id: '1', no_wo: true, amount: '50.22' });
  ok(again.error === 'already confirmed' && w.sent.length === 1, 'double tap: second confirm refused, QB email sent once');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
