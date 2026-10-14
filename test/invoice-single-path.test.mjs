// Queue #100 (Oct 14 2026): one invoice path. Log Invoice retired; the Invoice Builder / fallback
// never preview a figure other than the one typed; "differs" compares whole cents.
import fs from 'fs';
import assert from 'node:assert';
const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function grab(src, kind, name) {
  const i = src.indexOf(kind + ' ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

// ---- worker: retired route + cents compare --------------------------------------------------
const tel = [];
const json = (body, status = 200) => ({ body, status });
const w = new Function('json', 'logTelemetry', `
  ${grab(worker, 'function', 'sameCents')}
  ${grab(worker, 'async function', 'retiredLogInvoice')}
  return { sameCents, retiredLogInvoice };
`)(json, async (_e, rec) => { tel.push(rec); });

ok(w.sameCents('150', '150.00') && w.sameCents(150, '150.0') && w.sameCents('1234.5', '1234.50'), 'same price in different spellings is NOT a difference');
ok(!w.sameCents('150.00', '150.01'), 'a one-cent gap IS a difference');
ok(!w.sameCents('', '10') && !w.sameCents(undefined, '10') && !w.sameCents('abc', '10'), 'blank or unreadable never matches a real price');
ok(w.sameCents('', '') === true && w.sameCents(undefined, '') === true, 'blank vs blank compares without throwing');
{
  const r = await w.retiredLogInvoice({}, { wo_id: 'WO-9', amount: '175' }, '/invoice', null);
  ok(r.status === 410 && r.body.retired === true && /Nothing was saved/.test(r.body.error), '/invoice returns a loud 410 and says nothing was saved');
  ok(tel.length === 1 && tel[0].Job_Type === 'legacy_invoice_blocked' && tel[0].Success === 'FALSE' && /WO-9/.test(tel[0].Notes), 'the blocked attempt is logged to telemetry as a failure with the WO');
  const r2 = await w.retiredLogInvoice({}, null, '/invoice/update', 'owner');
  ok(r2.status === 410, '/invoice/update is retired too (null body does not throw)');
}
ok(/if \(path === '\/invoice' \|\| path === '\/invoice\/update'\) return await retiredLogInvoice/.test(worker), 'both routes are wired to the retired handler');
ok(!/function createInvoice\(/.test(worker) && !/createInvoice\(env/.test(worker), 'the sheet-only createInvoice is gone');
ok(worker.includes('!sameCents(already.Customer_Total, customer_total)') && worker.includes('!sameCents(already.Customer_Total, a.customer_total)'), 'single and bulk approve both compare by cents');
ok(!/String\(already\.Customer_Total \|\| ''\) !==/.test(worker), 'no string compare of dollar amounts is left in approve');

// ---- frontend: no Log Invoice anywhere ------------------------------------------------------
ok(!/Log Invoice/.test(html), 'no "Log Invoice" button or modal text left in index.html');
ok(!/submitInvoice|openInvoiceModal|modal-invoice|invoiceWOId/.test(html), 'Log Invoice functions, modal and state are removed');
ok(!/api\('POST','\/invoice'/.test(html), 'index.html no longer posts to /invoice');

// ---- frontend: price-mismatch guard, pulled from the real page ------------------------------
const els = {};
const doc = { getElementById: id => els[id] || null };
const f = new Function('document', 'esc', '_invWO', '_invBill', '_invIRRow', '_invMode', '_invPass5', 'invPricing', 'invMatPickedIds', `
  ${grab(html, 'function', 'invPriceMismatch')}
  ${grab(html, 'function', 'invPriceMismatchHtml')}
  ${grab(html, 'function', 'invBuildApprovalPayload')}
  return { invPriceMismatch, invPriceMismatchHtml, invBuildApprovalPayload };
`);
const mk = (reviewed, irTotal) => {
  const bill = { ID: 'B1', Vendor_ID: 'V1', Vendor_Name: 'V', Status: reviewed ? 'reviewed' : 'submitted' };
  return f(doc, s => String(s), {}, { k1: bill }, { k1: irTotal === undefined ? null : { id: 'IR-1', customer_total: irTotal } }, {}, {},
    () => ({ totalCost: 100, brettTime: 0, travel: 0, vendorPayable: 100, ownMaterials: 0, brettHrs: 0, billType: 'standard', cashOut: 100, ownWage: 0 }), () => []);
};
const typed = v => { els['inv-charge-k1'] = { value: v }; };

{
  const g = mk(true, '150.00');
  typed('150'); ok(g.invBuildApprovalPayload('k1').alreadyKnownId === 'IR-1', 'typed $150 vs approved $150.00 -> goes to the preview (same price)');
  typed(''); ok(g.invBuildApprovalPayload('k1').alreadyKnownId === 'IR-1', 'blank box -> goes to the preview of the approved figure');
  typed('175');
  const r = g.invBuildApprovalPayload('k1');
  ok(r.priceMismatch === true && r.approved === 150 && r.typed === 175 && r.id === 'IR-1' && !r.alreadyKnownId, 'typed $175 vs approved $150 -> mismatch, NO preview of the old figure');
  typed('150.01'); ok(g.invBuildApprovalPayload('k1').priceMismatch === true, 'a one-cent difference is caught');
  const html1 = g.invPriceMismatchHtml(150, 175, 'IR-1');
  ok(/\$150\.00/.test(html1) && /\$175\.00/.test(html1) && /nothing has been changed/i.test(html1) && /previewQBSend\('IR-1'\)/.test(html1), 'message names both figures, promises no change, offers the approved preview');
}
{
  const g = mk(true, 'oops'); typed('150');
  ok(g.invBuildApprovalPayload('k1').priceMismatch === true, 'an unreadable approved figure is treated as a mismatch, never a silent pass');
  const g2 = mk(false, undefined); typed('150');
  const r = g2.invBuildApprovalPayload('k1');
  ok(!r.priceMismatch && !r.alreadyKnownId && r.payload && r.payload.customer_total === '150.00', 'a not-yet-approved bill still builds the approval with exactly the typed figure');
}
ok(/if \(built\.priceMismatch\)/.test(html) && /invPriceMismatch\(typed, row\.customer_total\)/.test(html), 'both callers (Invoice Builder and the bill-less fallback) use the guard');
console.log(`invoice-single-path: ${n}/${n} passing`);
