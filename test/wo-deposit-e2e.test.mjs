// Oct 26 2026 - WO-1253 end to end: the REAL worker.js over a fake Google Sheets and a fake QuickBooks.
// Cesar Diaz (vendor 3, instant pay), estimate $460 (already Converted into a proposal), $200 deposit paid by hand,
// then the final vendor bill. Proves, through the real routes: the deposit bill ($200 - $10 fee), the cap, the automatic
// deduction on the final vendor bill ($460 - $200 - $10 = $250), Deposit_Applied flipping only after QuickBooks returns the
// bill id, a retry never deducting twice, and no Vendor_Bills row for the deposit.
// Run: node test/wo-deposit-e2e.test.mjs
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
const qb = { posts: [], seq: 700, failBill: false };
function qbHandle(method, url, body) {
  const path = url.replace(/^https:\/\/[^/]+\/v3\/company\/[^/]+\//, '');
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

const tab = (name, headers, rows) => tabs.set(name, [headers.slice()].concat((rows || []).map(r => headers.map(h => r[h] ?? ''))));
const read = (name) => { const r = tabs.get(name) || [[]], h = r[0]; return r.slice(1).map(x => Object.fromEntries(h.map((c, i) => [c, x[i] ?? '']))); };
function seed(extraWo) {
  tabs.clear(); qb.posts.length = 0; qb.failBill = false;
  tab('Config', ['Key', 'Value'], [{ Key: 'admin_phone', Value: '+15555550100' }]);
  tab('Ops_Telemetry', ['ID', 'Timestamp', 'Source', 'Session_Id', 'Job_Type', 'Skill_Or_Endpoint', 'Tier_Requested', 'Model_Used', 'Escalated', 'Tokens_In', 'Tokens_Out', 'Est_Cost', 'Latency_ms', 'Success', 'Confidence', 'Human_Corrected', 'Notes'], []);
  tab('Work_Orders', ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Trade', 'Description', 'Status', 'Type', 'Scope_ID', 'Deposit_Amount', 'Deposit_Vendor_ID', 'Deposit_Approved_Date', 'Deposit_Notes', 'Deposit_Applied', 'Deposit_QB_Bill_ID', 'Deposit_QB_Bill_Number'],
    [Object.assign({ ID: 'WO-1253', Property_ID: '94', Vendor_ID: '3', Trade: 'General', Description: 'Repair', Status: 'Assigned' }, extraWo || {})]);
  tab('Properties', ['ID', 'Address', 'Owner_ID', 'QBO_Customer_ID'], [{ ID: '94', Address: '411 West 23rd St', Owner_ID: 'O1' }]);
  tab('Owners', ['ID', 'Billing_Name', 'Company', 'Billing_Email', 'QBO_Customer_ID'], [{ ID: 'O1', Billing_Name: 'Owner One', Billing_Email: 'o@example.com', QBO_Customer_ID: '55' }]);
  tab('Units', ['ID', 'Unit_Label'], []);
  tab('Vendors', ['ID', 'Name', 'QBO_Vendor_ID', 'In_House', 'Language'], [{ ID: '3', Name: 'Cesar Diaz', QBO_Vendor_ID: '77' }]);
  tab('Estimates', ['ID', 'WO_ID', 'Version', 'Subtotal', 'Status'], [{ ID: '31', WO_ID: 'WO-1253', Version: '1', Subtotal: '460', Status: 'Converted' }]);
  tab('Vendor_Bills', ['ID', 'WO_ID', 'Vendor_ID', 'Vendor_Name', 'Active', 'Bill_Type', 'Labor_Total', 'Flat_Rate', 'Receipts_JSON', 'Truck_Stock', 'Standalone'],
    [{ ID: '9', WO_ID: 'WO-1253', Vendor_ID: '3', Vendor_Name: 'Cesar Diaz', Active: 'TRUE', Bill_Type: 'flat', Flat_Rate: '460' }]);
  tab('Invoice_Review', ['ID', 'Bill_ID', 'WO_ID', 'Vendor_ID', 'Vendor_Name', 'Vendor_Cost', 'Customer_Total', 'Active', 'QB_Invoice_ID', 'QB_Bill_ID', 'QB_Invoice_Status', 'Approved_Date', 'Own_Material_IDs'],
    [{ ID: '5', Bill_ID: '9', WO_ID: 'WO-1253', Vendor_ID: '3', Vendor_Name: 'Cesar Diaz', Vendor_Cost: '460', Customer_Total: '655', Active: 'TRUE', QB_Invoice_Status: 'pending', Approved_Date: '2026-10-26' }]);
  for (const n of ['Time_Entries', 'Receipts', 'Scopes', 'Scope_Signatures', 'Payment_Milestones', 'Instant_Fee_Credit']) tab(n, ['ID', 'WO_ID', 'Vendor_ID', 'Scope_ID', 'Active'], []);
}
const wo = () => read('Work_Orders').find(r => r.ID === 'WO-1253');
const billLines = (i) => qb.posts.filter(p => p.kind === 'bill')[i].body.Line;
const sum = (lines) => Math.round(lines.reduce((a, l) => a + l.Amount, 0) * 100) / 100;

// ═══ 1. the deposit ═══
seed();
{
  const over = await call('POST', '/wo/deposit-approve', { wo_id: 'WO-1253', amount: 500 });
  t('over the $460 estimate is refused with 400', over.status === 400 && /most you can deposit is \$460\.00/.test(over.json.error), over.json);
  t('...and nothing reached QuickBooks', qb.posts.length === 0);
  const pv = await call('POST', '/wo/deposit-approve', { wo_id: 'WO-1253', amount: 200, preview_only: true });
  t('preview says $200, $10 fee, send $190', pv.json.success && pv.json.amount === '200.00' && pv.json.fee === '10.00' && pv.json.send_amount === '190.00', pv.json);
  t('preview created nothing', qb.posts.length === 0 && wo().Deposit_Amount === '');
  const dep = await call('POST', '/wo/deposit-approve', { wo_id: 'WO-1253', amount: 200 });
  t('deposit created', dep.json.success === true && !!dep.json.qb_bill_id, dep.json);
  t('deposit QB bill is $200 with a -$10 fee line (total $190)', qb.posts.length === 1 && sum(billLines(0)) === 190 && billLines(0).length === 2 && billLines(0)[1].Amount === -10, qb.posts);
  t('WO records the deposit, unapplied, with the bill id and fee', wo().Deposit_Amount === '200.00' && wo().Deposit_Applied === 'FALSE' && wo().Deposit_QB_Bill_ID === dep.json.qb_bill_id && wo().Deposit_Fee === '10.00', wo());
  t('NO Vendor_Bills row was created for the deposit', read('Vendor_Bills').length === 1);
  t('WO Status untouched', wo().Status === 'Assigned');
}

// ═══ 2. the final bill: preview shows the deduction, nothing is written ═══
{
  const before = qb.posts.length;
  const pv = await call('POST', '/qb/send-invoice', { id: '5', preview_only: true });
  const p = pv.json.preview;
  t('preview exists', !!p, pv.json);
  if (p) {
    t('preview shows the deposit credit of $200', p.deposit && p.deposit.amount === 200, p.deposit);
    t('preview vendor lines: -200 deposit then -10 fee', p.fee.lines.length === 2 && p.fee.lines[0].type === 'deposit_credit' && p.fee.lines[0].amount === -200 && p.fee.lines[1].amount === -10, p.fee.lines);
    t('preview bill total is $250', p.bill.total === 250, p.bill);
    t('preview customer invoice is untouched ($655)', p.invoice.total === 655);
  }
  t('preview wrote nothing to QuickBooks and left the deposit unapplied', qb.posts.length === before && wo().Deposit_Applied === 'FALSE');
}

// ═══ 3. a failed QuickBooks bill must NOT mark the deposit applied; the retry then deducts exactly once ═══
{
  qb.failBill = true;
  const bad = await call('POST', '/qb/send-invoice', { id: '5' });
  t('bill failure is reported, not hidden', bad.json.ok === false && (bad.json.errors || []).some(e => /^Bill/.test(e)), bad.json);
  t('deposit still unapplied after a failed bill', wo().Deposit_Applied === 'FALSE', wo());
  qb.failBill = false;
  const bills0 = qb.posts.filter(p => p.kind === 'bill').length;
  const ok = await call('POST', '/qb/send-invoice', { id: '5' });
  t('retry succeeds', ok.json.ok === true && !!ok.json.bill_id, ok.json);
  const finalBill = qb.posts.filter(p => p.kind === 'bill').slice(bills0)[0];
  const lines = finalBill.body.Line;
  t('final vendor bill lines: $460, -$200 deposit, -$10 fee', lines.length === 3 && lines[0].Amount === 460 && lines[1].Amount === -200 && /deposit already paid/i.test(lines[1].Description) && lines[2].Amount === -10, lines);
  t('final vendor bill adds up to $250', sum(lines) === 250);
  t('Deposit_Applied flipped to TRUE after the bill id came back, with the final bill number', wo().Deposit_Applied === 'TRUE' && wo().Deposit_Applied_Bill === ok.json.bill_number, wo());
  t('Invoice_Review remembers the deduction', read('Invoice_Review')[0].Deposit_Credit === '200.00');
  t('customer invoice went out at $655, no deposit line on it', qb.posts.filter(p => p.kind === 'invoice').every(p => sum(p.body.Line) === 655));
  const again = await call('POST', '/qb/send-invoice', { id: '5' });
  t('sending again is a no-op (already sent)', again.json.already_sent === true && qb.posts.filter(p => p.kind === 'bill').length === bills0 + 1, again.json);
  const clr = await call('POST', '/wo/deposit-clear', { wo_id: 'WO-1253' });
  t('clearing an already-deducted deposit is refused', clr.status === 409, clr.json);
  t('still only the original Vendor_Bills row', read('Vendor_Bills').length === 1);
}

// ═══ 4. a deposit bigger than what is left stops the send and writes nothing ═══
seed({ Deposit_Amount: '500.00', Deposit_Vendor_ID: '3', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: '88', Deposit_QB_Bill_Number: 'B-88' });
{
  const r = await call('POST', '/qb/send-invoice', { id: '5' });
  t('over-large deposit refuses the send (409)', r.status === 409 && r.json.deposit_blocked === true, r.json);
  t('nothing was posted and the deposit is still unapplied', qb.posts.length === 0 && wo().Deposit_Applied === 'FALSE');
}

// ═══ 5. a deposit belonging to another vendor is never taken off this vendor's bill, and says so ═══
seed({ Deposit_Amount: '200.00', Deposit_Vendor_ID: '9', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: '88' });
{
  const pv = await call('POST', '/qb/send-invoice', { id: '5', preview_only: true });
  t('no credit for a different vendor, with a visible warning', pv.json.preview && !pv.json.preview.deposit && pv.json.preview.bill.total === 450 && pv.json.preview.warnings.some(w => /NOT deducted/.test(w)), pv.json.preview && pv.json.preview.warnings);
}

console.error = origErr; console.warn = origWarn;
globalThis.fetch = realFetch; globalThis.setTimeout = _realSetTimeout; Date.now = _realNow;
console.log(`\nwo-deposit-e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
