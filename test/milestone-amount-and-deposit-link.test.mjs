// Nov 2 2026 - WO-1253 / Scope 11 / signature 7: the REAL worker.js over a fake Google Sheets and a fake QuickBooks.
// Two things Brett needed: (1) a BILLING-ONLY edit of a pending proposal milestone ($655 -> $830) that sends nothing to the customer and touches nothing in
// QuickBooks, and (2) re-recording an EXISTING, already-paid QuickBooks deposit bill (7996: $200 less the $10 fee = $190) on the work order, WITHOUT creating a
// second bill. Then billing the milestone proves the invoice is $830 and Cesar's final bill takes the $200 off ($460 - $200 - $10 = $250).
// Run: node test/milestone-amount-and-deposit-link.test.mjs
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const tabs = new Map();
const colN = (s) => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const gerr = (code, message) => ({ error: { code, message } });
function handle(method, path, body) {
  const missing = (n) => gerr(400, 'Unable to parse range: ' + n);
  let m;
  if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 80, rowCount: 1000 } } })) };
  if (method === 'GET' && path.startsWith('/values:batchGet?')) {
    const names = [...path.slice(path.indexOf('?') + 1).matchAll(/ranges=([^&]+)/g)].map(x => decodeURIComponent(x[1]));
    return { valueRanges: names.map(n => ({ range: n, values: (tabs.get(n) || []).map(r => r.slice()) })) };
  }
  if (method === 'GET' && (m = /^\/values\/([^!:?]+)(?:!(.+))?$/.exec(path))) {
    const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n);
    const rows = tabs.get(n);
    if (m[2] && /^(1:1|A1:[A-Z]+1)$/.test(m[2])) return { values: rows.slice(0, 1).map(r => r.slice()) };
    return { range: n, values: rows.map(r => r.slice()) };
  }
  if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) {
    const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n);
    const first = tabs.get(n).length + 1; for (const r of body.values) tabs.get(n).push(r.slice());
    return { updates: { updatedRange: `${n}!A${first}:Z${first + body.values.length - 1}`, updatedRows: body.values.length } };
  }
  if (method === 'PUT' && (m = /^\/values\/([^!:?]+)!([A-Z]+)(\d+)/.exec(path))) {
    const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n);
    const rows = tabs.get(n), r0 = +m[3] - 1, c0 = colN(m[2]);
    body.values.forEach((vr, i) => { while (rows.length <= r0 + i) rows.push([]); vr.forEach((v, j) => { while (rows[r0 + i].length <= c0 + j) rows[r0 + i].push(''); rows[r0 + i][c0 + j] = v; }); });
    return { updatedCells: 1 };
  }
  if (method === 'POST' && path === '/values:batchUpdate') {
    for (const d of body.data) {
      const mm = /^([^!]+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(d.range); const rows = tabs.get(mm[1]); if (!rows) return missing(mm[1]);
      const r0 = +mm[3] - 1, c0 = colN(mm[2]);
      d.values.forEach((vr, i) => { while (rows.length <= r0 + i) rows.push([]); vr.forEach((v, j) => { while (rows[r0 + i].length <= c0 + j) rows[r0 + i].push(''); rows[r0 + i][c0 + j] = v; }); });
    }
    return { totalUpdatedCells: body.data.length };
  }
  if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
  return gerr(400, 'fake sheets: unsupported ' + method + ' ' + path);
}

// ── fake QuickBooks ──
const qb = { posts: [], gets: [], seq: 700, failBill: false, bills: {} };
function qbHandle(method, url, body) {
  const path = url.replace(/^https:\/\/[^/]+\/v3\/company\/[^/]+\//, '');
  let gm; if (method === 'GET' && (gm = /^bill\/(\d+)/.exec(path))) { qb.gets.push(path); return qb.bills[gm[1]] ? { Bill: qb.bills[gm[1]] } : { Fault: { Error: [{ Message: 'Object Not Found' }] } }; }
  if (method === 'POST' && path.startsWith('bill')) {
    qb.posts.push({ kind: 'bill', body });
    if (qb.failBill) return { Fault: { Error: [{ Message: 'fake bill failure' }] } };
    const id = String(++qb.seq); return { Bill: { Id: id, DocNumber: 'BILL-' + id } };
  }
  if (method === 'POST' && path.startsWith('invoice')) { qb.posts.push({ kind: 'invoice', body }); const id = String(++qb.seq); return { Invoice: { Id: id, DocNumber: 'INV-' + id } }; }
  if (method === 'POST') { qb.posts.push({ kind: 'other:' + path, body }); return {}; }
  if (path.includes('from Term') || path.includes('from%20Term')) return { QueryResponse: { Term: [{ Id: '1', Name: 'Due on receipt', DueDays: 0 }] } };
  return { QueryResponse: {} };
}

const realFetch = globalThis.fetch, _realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => _realSetTimeout(fn, ms >= 1000 ? 1 : ms, ...a);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url, method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if (url.startsWith('https://oauth.platform.intuit.com')) return new Response(JSON.stringify({ access_token: 'qbtok', refresh_token: 'same' }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const r = handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), init && init.body ? JSON.parse(init.body) : undefined); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  if (url.includes('intuit.com')) { const r = qbHandle(method, decodeURIComponent(url), init && init.body ? JSON.parse(init.body) : undefined); return new Response(JSON.stringify(r), { status: 200 }); }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev', SECRET = 'admin-secret-for-tests-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET, QB_CLIENT_ID: 'c', QB_CLIENT_SECRET: 's', QB_REALM_ID: '123', QB_REFRESH_TOKEN: 'r' };
const call = async (method, path, body) => {
  skew += 100000;   // beats the short tab cache
  const res = await worker.fetch(new Request(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Auth-Token': SECRET }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: () => {} });
  let j = null; try { j = await res.clone().json(); } catch (_) { j = { _nonjson: true }; }
  return { status: res.status, json: j };
};
const origErr = console.error, origWarn = console.warn, origLog = console.log; console.error = () => {}; console.warn = () => {};

// ── seed: WO-1253 exactly as live on Nov 2: deposit record CLEARED, QuickBooks bill 7996 ($200 - $10 fee = $190, paid) still there ──
const tab = (name, headers, rows) => tabs.set(name, [headers.slice()].concat((rows || []).map(r => headers.map(h => r[h] ?? ''))));
const read = (name) => { const r = tabs.get(name) || [[]], h = r[0]; return r.slice(1).map(x => Object.fromEntries(h.map((c, i) => [c, x[i] ?? '']))); };
let outbound = [];   // anything that is neither Google Sheets/OAuth nor QuickBooks = an email/SMS to someone
const innerFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!/sheets\.googleapis\.com|oauth2\.googleapis\.com|intuit\.com/.test(url)) outbound.push(url);
  return innerFetch(input, init);
};
function seed(woExtra) {
  tabs.clear(); qb.posts.length = 0; qb.gets.length = 0; qb.failBill = false; outbound = [];
  qb.bills = { '7996': { Id: '7996', DocNumber: '', TxnDate: '2026-10-26', TotalAmt: 190, Balance: 0, SyncToken: '0', VendorRef: { value: '77' },
      Line: [{ Amount: 200, Description: 'Deposit' }, { Amount: -10, Description: 'Instant-pay fee' }] },
    '7999': { Id: '7999', DocNumber: '', TxnDate: '2026-10-28', TotalAmt: 556.61, Balance: 556.61, SyncToken: '0', VendorRef: { value: '77' }, Line: [{ Amount: 556.61 }] },
    '8100': { Id: '8100', DocNumber: 'X', TxnDate: '2026-10-26', TotalAmt: 190, Balance: 0, SyncToken: '0', VendorRef: { value: '999' }, Line: [{ Amount: 200 }, { Amount: -10 }] },
    '8200': { Id: '8200', DocNumber: 'BIG', TxnDate: '2026-10-26', TotalAmt: 500, Balance: 0, SyncToken: '0', VendorRef: { value: '77' }, Line: [{ Amount: 500 }] } };
  tab('Config', ['Key', 'Value'], [{ Key: 'admin_phone', Value: '+15555550100' }]);
  tab('Ops_Telemetry', ['ID', 'Timestamp', 'Source', 'Session_Id', 'Job_Type', 'Skill_Or_Endpoint', 'Tier_Requested', 'Model_Used', 'Escalated', 'Tokens_In', 'Tokens_Out', 'Est_Cost', 'Latency_ms', 'Success', 'Confidence', 'Human_Corrected', 'Notes'], []);
  tab('Work_Orders', ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Trade', 'Description', 'Status', 'Type', 'Scope_ID', 'Customer_Charge', 'Notes', 'Deposit_Amount', 'Deposit_Vendor_ID', 'Deposit_Approved_Date', 'Deposit_Notes', 'Deposit_Applied', 'Deposit_QB_Bill_ID', 'Deposit_QB_Bill_Number'],
    [Object.assign({ ID: 'WO-1253', Property_ID: '94', Vendor_ID: '3', Trade: 'General', Description: 'Repair', Status: 'Complete', Scope_ID: '11', Customer_Charge: '830', Deposit_Notes: 'Cleared', Deposit_Applied: 'FALSE' }, woExtra || {})]);
  tab('Properties', ['ID', 'Address', 'Owner_ID', 'QBO_Customer_ID'], [{ ID: '94', Address: '411 West 23rd St', Owner_ID: 'O1' }]);
  tab('Owners', ['ID', 'Billing_Name', 'Company', 'Billing_Email', 'QBO_Customer_ID'], [{ ID: 'O1', Billing_Name: 'Greg Overton', Billing_Email: 'g@example.com', QBO_Customer_ID: '55' }]);
  tab('Units', ['ID', 'Unit_Label'], []);
  tab('Vendors', ['ID', 'Name', 'QBO_Vendor_ID', 'In_House', 'Language'], [{ ID: '3', Name: 'Cesar Diaz', QBO_Vendor_ID: '77' }]);
  tab('Estimates', ['ID', 'WO_ID', 'Version', 'Subtotal', 'Status'], [{ ID: '31', WO_ID: 'WO-1253', Version: '1', Subtotal: '460', Status: 'Converted' }]);
  tab('Vendor_Bills', ['ID', 'WO_ID', 'Vendor_ID', 'Active', 'QB_Bill_ID'], []);
  tab('Invoice_Review', ['ID', 'WO_ID', 'Vendor_ID', 'Active', 'QB_Bill_ID', 'Deposit_Credit'], []);
  tab('Scopes', ['ID', 'WO_ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Title', 'Active', 'Proposal_Items_JSON'],
    [{ ID: '11', WO_ID: 'WO-1253', Property_ID: '94', Vendor_ID: '3', Title: 'Repair', Active: 'TRUE', Proposal_Items_JSON: '[]' }]);
  tab('Scope_Signatures', ['ID', 'Scope_ID', 'Signer_Name', 'Selections_JSON', 'Subtotal', 'Deposit_Amount', 'Vendor_Cost_Total', 'Signed_Date', 'Status', 'QB_Invoice_ID', 'QB_Bill_ID', 'QB_Final_Invoice_ID', 'QB_Final_Bill_ID', 'Active'],
    [{ ID: '7', Scope_ID: '11', Signer_Name: 'Greg Overton', Selections_JSON: '{}', Subtotal: '655', Deposit_Amount: '0', Vendor_Cost_Total: '460', Signed_Date: '2026-10-26', Status: 'Signed', Active: 'TRUE' }]);
  tab('Payment_Milestones', ['ID', 'Scope_ID', 'Signature_ID', 'Label', 'Percent', 'Trigger', 'Sequence', 'Customer_Amount', 'Vendor_Amount', 'Status', 'QB_Invoice_ID', 'QB_Invoice_Number', 'QB_Bill_ID', 'QB_Bill_Number', 'Billed_Date', 'Created_Date', 'Active', 'Vendor_Paid_At_This_Milestone', 'Calc_Mode', 'Flat_Customer_Amount'],
    [{ ID: '5', Scope_ID: '11', Signature_ID: '7', Label: 'Final', Percent: '100', Trigger: 'completion', Sequence: '1', Customer_Amount: '655', Vendor_Amount: '460', Status: 'pending', Active: 'TRUE', Vendor_Paid_At_This_Milestone: 'TRUE', Calc_Mode: 'percent' }]);
  for (const n of ['Time_Entries', 'Receipts', 'Instant_Fee_Credit']) tab(n, ['ID', 'WO_ID', 'Vendor_ID', 'Scope_ID', 'Active'], []);
}
const wo = () => read('Work_Orders').find(r => r.ID === 'WO-1253');
const ms = () => read('Payment_Milestones').find(r => r.ID === '5');
const tel = (job) => read('Ops_Telemetry').filter(r => r.Job_Type === job);
const sum = (lines) => Math.round(lines.reduce((a, l) => a + l.Amount, 0) * 100) / 100;
const SET = '/scope-proposal/milestone/set-amount';

// ═══ A. milestone amount edit: validation ═══
seed();
{
  const base = { signature_id: '7', milestone_id: '5', customer_amount: 830, reason: 'Last-minute scope change' };
  t('missing reason -> 400', (await call('POST', SET, { ...base, reason: '' })).status === 400);
  t('zero amount -> 400', (await call('POST', SET, { ...base, customer_amount: 0 })).status === 400);
  t('negative amount -> 400', (await call('POST', SET, { ...base, customer_amount: -5 })).status === 400);
  t('absurd amount -> 400', (await call('POST', SET, { ...base, customer_amount: 9999999 })).status === 400);
  t('non-numeric amount -> 400', (await call('POST', SET, { ...base, customer_amount: 'abc' })).status === 400);
  t('unknown milestone -> 404', (await call('POST', SET, { ...base, milestone_id: '99' })).status === 404);
  t('milestone on another signature -> 404', (await call('POST', SET, { ...base, signature_id: '8' })).status === 404);
  const same = await call('POST', SET, { ...base, customer_amount: 655 });
  t('same amount -> 400, nothing changed', same.status === 400 && ms().Customer_Amount === '655', same.json);
  t('every refusal left the milestone at $655', ms().Customer_Amount === '655' && ms().Calc_Mode === 'percent');
}

// ═══ B. preview writes nothing ═══
{
  const pv = await call('POST', SET, { signature_id: '7', milestone_id: '5', customer_amount: 830, reason: 'Last-minute scope change', preview_only: true });
  t('preview ok with old 655 -> new 830, change +175', pv.json.ok && pv.json.preview.old_customer_amount === 655 && pv.json.preview.new_customer_amount === 830 && pv.json.preview.change === 175, pv.json);
  t('preview says vendor side unchanged ($460), sends nothing, touches no QuickBooks', pv.json.preview.vendor_amount_unchanged === 460 && pv.json.preview.sends_nothing_to_customer === true && pv.json.preview.touches_quickbooks === false);
  t('preview warns the proposal total now differs from the signed $655', (pv.json.warnings || []).some(w => /830\.00/.test(w) && /655\.00/.test(w)), pv.json.warnings);
  t('preview wrote nothing (milestone, telemetry, QuickBooks)', ms().Customer_Amount === '655' && read('Ops_Telemetry').length === 0 && qb.posts.length === 0 && !('Original_Customer_Amount' in ms()));
}

// ═══ C. the real edit ═══
{
  const r = await call('POST', SET, { signature_id: '7', milestone_id: '5', customer_amount: 830, reason: 'Last-minute scope change' });
  t('edit succeeds', r.status === 200 && r.json.ok === true, r.json);
  const m = ms();
  t('milestone now bills $830 and is flat (so no stale 100% shown)', m.Customer_Amount === '830' && m.Calc_Mode === 'flat' && m.Flat_Customer_Amount === '830', m);
  t('original $655, reason, who and when are kept', m.Original_Customer_Amount === '655' && m.Amount_Edit_Reason === 'Last-minute scope change' && m.Amount_Edited_By === 'Brett' && /^2026|^20/.test(m.Amount_Edited_Date), m);
  t('vendor amount is untouched ($460) and still pending', m.Vendor_Amount === '460' && m.Status === 'pending');
  const sg = read('Scope_Signatures')[0];
  t('the SIGNED record is exactly as signed ($655)', sg.Subtotal === '655' && sg.Status === 'Signed');
  t('nothing went to QuickBooks, and nothing was emailed or texted to anyone', qb.posts.length === 0 && outbound.length === 0, { posts: qb.posts, outbound });
  t('audit row written to Ops_Telemetry', tel('milestone_amount_edited').length === 1 && /655\.00 -> 830\.00/.test(tel('milestone_amount_edited')[0].Notes), read('Ops_Telemetry'));
  const again = await call('POST', SET, { signature_id: '7', milestone_id: '5', customer_amount: 840, reason: 'Second tweak' });
  t('a second edit keeps the ORIGINAL 655 on record', again.json.ok && ms().Customer_Amount === '840' && ms().Original_Customer_Amount === '655', ms());
  await call('POST', SET, { signature_id: '7', milestone_id: '5', customer_amount: 830, reason: 'Back to 830' });
}

// ═══ D. a billed milestone cannot be edited ═══
{
  const rows = tabs.get('Payment_Milestones'), h = rows[0];
  rows[1][h.indexOf('Status')] = 'billed'; rows[1][h.indexOf('QB_Invoice_ID')] = '555'; rows[1][h.indexOf('QB_Invoice_Number')] = '1800';
  const r = await call('POST', SET, { signature_id: '7', milestone_id: '5', customer_amount: 900, reason: 'too late' });
  t('billed milestone refused (409), amount unchanged', r.status === 409 && /already billed/.test(r.json.error) && ms().Customer_Amount === '830', r.json);
}

// ═══ E. deposit link: refusals first ═══
const LINK = '/wo/deposit-link';
seed();
{
  const L = (b) => call('POST', LINK, Object.assign({ wo_id: 'WO-1253', qb_bill_id: '7996' }, b));
  t('non-digit bill id -> 400', (await L({ qb_bill_id: 'abc' })).status === 400);
  t('missing wo -> 404', (await L({ wo_id: 'WO-9999' })).status === 404);
  t('bill that does not exist in QuickBooks -> 404', (await L({ qb_bill_id: '123456' })).status === 404);
  t('another vendor\'s bill -> 409', (await L({ qb_bill_id: '8100' })).status === 409);
  t('a deposit bigger than the $460 estimate allows -> 409', (await L({ qb_bill_id: '8200' })).status === 409);
  t('a wrong amount from the caller -> 409', (await L({ amount: 150 })).status === 409);
  t('nothing was written by any refusal', wo().Deposit_Amount === '' && wo().Deposit_QB_Bill_ID === '' && qb.posts.length === 0);
  // used elsewhere
  tabs.get('Vendor_Bills').push(['1', 'WO-1253', '3', 'TRUE', '7996']);
  const used = await L({});
  t('a bill already attached to a Vendor_Bills row -> 409', used.status === 409 && /already used/.test(used.json.error), used.json);
  tabs.get('Vendor_Bills').length = 1;
}

// ═══ F. deposit link: preview, then the real thing ═══
{
  const pv = await call('POST', LINK, { wo_id: 'WO-1253', qb_bill_id: '7996', preview_only: true });
  t('preview: $200 deposit, $10 fee, already paid, QuickBooks untouched', pv.json.success && pv.json.amount === '200.00' && pv.json.fee === '10.00' && pv.json.already_paid === true && pv.json.creates_or_changes_anything_in_quickbooks === false, pv.json);
  t('preview wrote nothing', wo().Deposit_Amount === '' && read('Ops_Telemetry').length === 0);
  const r = await call('POST', LINK, { wo_id: 'WO-1253', qb_bill_id: '7996', amount: 200, reason: 'Deposit was cleared by mistake' });
  t('link succeeds', r.status === 200 && r.json.success === true, r.json);
  const w = wo();
  t('WO records $200, vendor 3, bill 7996, fee 10, NOT applied', w.Deposit_Amount === '200.00' && w.Deposit_Vendor_ID === '3' && w.Deposit_QB_Bill_ID === '7996' && w.Deposit_Fee === '10.00' && w.Deposit_Applied === 'FALSE' && w.Deposit_Approved_Date === '2026-10-26', w);
  t('QuickBooks was only READ (no bill/invoice/payment created, changed or deleted)', qb.posts.length === 0 && qb.gets.length >= 1, { posts: qb.posts });
  t('audit row written', tel('wo_deposit_linked').length === 1);
  const twice = await call('POST', LINK, { wo_id: 'WO-1253', qb_bill_id: '7996' });
  t('linking again is refused (a deposit is already recorded)', twice.status === 409, twice.json);
  seed({ ID: 'WO-1254' });
  tabs.get('Work_Orders').push(tabs.get('Work_Orders')[0].map(c => ({ ID: 'WO-1253', Vendor_ID: '3', Deposit_QB_Bill_ID: '7996', Deposit_Amount: '200.00' }[c] ?? '')));
  const other = await call('POST', LINK, { wo_id: 'WO-1254', qb_bill_id: '7996' });
  t('a bill already recorded as another work order\'s deposit is refused', other.status === 409 && /already used by the deposit on WO-1253/.test(other.json.error), other.json);
}

// ═══ G. the whole point: edit to $830, link the deposit, bill - invoice $830, Cesar's final $460 - $200 - $10 = $250, deposit applied once ═══
seed();
{
  await call('POST', SET, { signature_id: '7', milestone_id: '5', customer_amount: 830, reason: 'Last-minute scope change' });
  await call('POST', LINK, { wo_id: 'WO-1253', qb_bill_id: '7996' });
  const pv = await call('POST', '/scope-proposal/bill-milestones', { signature_id: '7', milestone_ids: ['5'], preview_only: true });
  const p = pv.json.preview;
  t('billing preview exists', pv.json.ok === true && !!p, pv.json);
  if (p) {
    t('preview invoice is $830 (not the old $655)', p.invoice.amount === 830, p.invoice);
    t('preview vendor bill: $460 less the $200 deposit, $10 fee, send $250', p.bill && p.bill.amount === 460 && p.bill.deposit_credit === 200 && p.bill.fee === 10 && p.bill.send_amount === 250, p.bill);
  }
  t('billing preview wrote nothing', qb.posts.length === 0 && wo().Deposit_Applied === 'FALSE' && ms().Status === 'pending');
  const r = await call('POST', '/scope-proposal/bill-milestones', { signature_id: '7', milestone_ids: ['5'] });
  t('billing succeeds', r.json.ok === true && !!r.json.invoice_id && !!r.json.bill_id, r.json);
  const inv = qb.posts.filter(x => x.kind === 'invoice'), bills = qb.posts.filter(x => x.kind === 'bill');
  t('exactly one invoice for $830 and one vendor bill', inv.length === 1 && sum(inv[0].body.Line) === 830 && bills.length === 1, qb.posts.map(x => x.kind));
  t('Cesar\'s bill lines: $460, -$200 deposit, -$10 fee = $250', bills.length === 1 && bills[0].body.Line.length === 3 && bills[0].body.Line[0].Amount === 460 && bills[0].body.Line[1].Amount === -200 && /deposit already paid/i.test(bills[0].body.Line[1].Description) && bills[0].body.Line[2].Amount === -10 && sum(bills[0].body.Line) === 250, bills[0] && bills[0].body.Line);
  t('deposit now applied exactly once, to the final bill', wo().Deposit_Applied === 'TRUE' && wo().Deposit_Applied_Bill === r.json.bill_number, wo());
  t('milestone is billed with the invoice and bill ids', ms().Status === 'billed' && ms().QB_Invoice_ID === r.json.invoice_id && ms().QB_Bill_ID === r.json.bill_id);
  t('no second deposit bill was ever created (only the final bill was posted)', bills.length === 1);
}

// ═══ H. wiring: routes and buttons exist ═══
{
  const src = fs.readFileSync(root + 'worker.js', 'utf8'), sp = fs.readFileSync(root + 'signed-proposals.html', 'utf8'), ix = fs.readFileSync(root + 'index.html', 'utf8');
  t('routes registered', /\/scope-proposal\/milestone\/set-amount'\) return await setMilestoneCustomerAmount/.test(src) && /\/wo\/deposit-link'\)\s+return await depositLink/.test(src));
  t('Signed Proposals has an Edit amount link that previews first', /editMilestoneAmount/.test(sp) && /customer_amount:amount,reason:reason,preview_only:true/.test(sp) && /modalMode==='msamount'/.test(sp));
  t('Hub deposit panel has Link existing bill that previews first', /depositLinkUI/.test(ix) && /\/wo\/deposit-link', Object\.assign\(\{ preview_only: true \}/.test(ix));
  const newCode = src.slice(src.indexOf('async function setMilestoneCustomerAmount'), src.indexOf('async function scopeProposalBillMilestones')) + src.slice(src.indexOf('async function depositLink'), src.indexOf('async function addEstimateVersion'));
  t('no swallowing catch in the new code', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(newCode) && !/\.catch\(\s*\(\s*\)\s*=>/.test(newCode));
  t('the new code never writes to QuickBooks except through the existing billing path', !/qbApi\([^)]*'POST'/.test(newCode));
}

console.log = origLog;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
