// WO vendor deposit (Sep 15-16 2026) — offline tests for depositApprove / depositClear.
// Extracts the REAL functions verbatim out of worker.js and runs them against an in-memory
// fake Sheets backend (same convention as test/wo-void.test.mjs). The QuickBooks boundary
// (qbAccessToken/qbApi/qbFindOrCreateVendor/qbFault/qbDeleteBillSafe/QB_TRADE_MAP) is mocked
// rather than exercised for real — this file proves depositApprove/depositClear call that
// boundary correctly and handle both success and failure from it, not that Intuit's API works.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}
function grabRange(src, startSig, endSig) {
  const start = src.indexOf(startSig);
  if (start < 0) throw new Error('not found: ' + startSig);
  const end = src.indexOf(endSig, start);
  if (end < 0) throw new Error('end not found: ' + endSig);
  return src.slice(start, end);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('  ✗ FAIL:', n); } };

const cacheSrc            = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc              = grab(wsrc, 'async function sheetsRequest(');
const ensureSrc          = grab(wsrc, 'async function ensureColumns(');
const ensureInnerSrc     = grab(wsrc, 'async function ensureColumnsInner(');
const idcSrc             = grab(wsrc, 'function idColIndex(');
const colSrc             = grab(wsrc, 'function col(index)') || grab(wsrc, 'function col(index');
const jsonSrc            = grab(wsrc, 'function json(data');
const fetchTabSrc        = grab(wsrc, 'async function fetchTab(');
const findWOSrc          = grab(wsrc, 'function findWO(');
const updateWOFieldsSrc  = grab(wsrc, 'async function updateWOFields(');
const depositApproveSrc  = grab(wsrc, 'async function depositApprove(');
const depositClearSrc    = grab(wsrc, 'async function depositClear(');
// Oct 26 2026 — cap, fee line, automatic deduction helpers (the REAL source, not copies).
function grabLine(src, prefix) { const i = src.indexOf(prefix); if (i < 0) throw new Error('missing ' + prefix); return src.slice(i, src.indexOf('\n', i)); }
const feeSrc = [
  grabLine(wsrc, 'const INSTANT_FEE_DEFAULTS'), grabLine(wsrc, 'const INSTANT_FEE_LABEL_EN'), grabLine(wsrc, 'const INSTANT_FEE_LABEL_ES'),
  grabLine(wsrc, 'const FEE_CREDIT_LABEL_EN'), grabLine(wsrc, 'const FEE_CREDIT_LABEL_ES'), grabLine(wsrc, 'const INSTANT_FEE_PAD_DEDUCTION_EN'), grabLine(wsrc, 'const INSTANT_FEE_PAD_DEDUCTION_ES'),
  grab(wsrc, 'function money2('), grab(wsrc, 'function instantFeeConfig('), grabLine(wsrc, 'const clampFee'), grab(wsrc, 'function instantFeePad('),
  grab(wsrc, 'function instantFeeLegacyDeduction('), grab(wsrc, 'function instantPayEnabled('), grab(wsrc, 'function vendorBillAdjustments('),
  grab(wsrc, 'function woDepositCredit('), grab(wsrc, 'function woDepositEstimateCap('), grab(wsrc, 'async function woDepositMarkApplied('),
].join('\n');

// Confidence that the mocked QB boundary below actually matches what worker.js calls: assert
// depositApprove's real source references every mock name we're about to substitute in. If a
// future edit renames one of these, this test fails loud here instead of silently mocking a
// function nothing calls anymore.
['qbAccessToken', 'qbFindOrCreateVendor', 'qbApi', 'qbFault', 'QB_TRADE_MAP'].forEach(name => {
  if (!depositApproveSrc.includes(name)) throw new Error(`depositApprove no longer references ${name} — update this test's mocks`);
});
if (!depositClearSrc.includes('qbDeleteBillSafe')) throw new Error('depositClear no longer references qbDeleteBillSafe — update this test');

const WO_HEADERS = ['ID','Property_ID','Unit_ID','Vendor_ID','Trade','Description','Status',
  'Deposit_Amount','Deposit_Vendor_ID','Deposit_Approved_Date','Deposit_Notes','Deposit_Applied',
  'Deposit_QB_Bill_ID','Deposit_QB_Bill_Number','Deposit_Fee','Deposit_Applied_Bill','Deposit_Applied_Date'];
const EST_HEADERS = ['ID','WO_ID','Version','Subtotal','Status'];
const VENDOR_HEADERS = ['ID','Name','Company','First_Name','QBO_Vendor_ID'];

function makeDb(woRows, vendorRows, estRows) {
  return {
    Estimates: { headers: EST_HEADERS.slice(), rows: (estRows || []).map(r => EST_HEADERS.map(h => r[h] ?? '')) },
    Work_Orders: { headers: WO_HEADERS.slice(), rows: woRows.map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    Vendors: { headers: VENDOR_HEADERS.slice(), rows: (vendorRows || []).map(r => VENDOR_HEADERS.map(h => r[h] ?? '')) },
    Properties: { headers: ['ID','Address'], rows: [] },
    Units: { headers: ['ID','Unit_Label'], rows: [] },
  };
}

function makeFetch(db) {
  return async (url, opts) => {
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0];
    const method = opts.method;
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      const body = JSON.parse(opts.body);
      for (const d of body.data) {
        const [tabName, cellRef] = d.range.split('!');
        const colLetter = cellRef.match(/[A-Z]+/)[0];
        const rowNum = parseInt(cellRef.match(/\d+/)[0], 10);
        let ci = 0; for (let k = 0; k < colLetter.length; k++) ci = ci * 26 + (colLetter.charCodeAt(k) - 64); ci -= 1;
        const tab = db[tabName];
        if (!tab) continue;
        if (rowNum === 1) { tab.headers[ci] = d.values[0][0]; continue; }
        const r = tab.rows[rowNum - 2];
        if (r) r[ci] = d.values[0][0];
      }
      return { json: async () => ({}) };
    }
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

// ── Mock QuickBooks boundary — configurable per test via qbState ──────────────────────────
function mockQbSrc() {
  return `
    async function qbAccessToken(env) { if (qbState.tokenFails) throw new Error('mock QB auth failure'); return 'mock-token'; }
    async function qbFindOrCreateVendor(env, vendor, displayName, token) {
      qbState.vendorLookupCalls = (qbState.vendorLookupCalls||0) + 1;
      if (qbState.vendorFails) throw new Error('mock QB vendor failure');
      if (vendor.QBO_Vendor_ID) return vendor.QBO_Vendor_ID;
      return qbState.createdVendorId;
    }
    async function qbApi(env, path, method, body, token) {
      qbState.lastBillPayload = (path.indexOf('bill') === 0 && method === 'POST') ? body : qbState.lastBillPayload;
      if (path.indexOf('bill') === 0 && method === 'POST') {
        if (!qbState.billSucceeds) return { Fault: { Error: [{ Message: 'mock bill create failure' }] } };
        return { Bill: { Id: qbState.billId, DocNumber: qbState.billNumber } };
      }
      throw new Error('mock qbApi: unhandled path ' + path);
    }
    function qbFault(r) { return (r && r.Fault && r.Fault.Error && r.Fault.Error[0] && r.Fault.Error[0].Message) || null; }
    async function qbDeleteBillSafe(env, billId, token) {
      qbState.deleteCalledWith = billId;
      return qbState.deleteResult;
    }
    const QB_TRADE_MAP = { General: { item: '40', income: '198', expense: '68' } };
  `;
}

function build(db, qbState) {
  const src = [
    'const CORS = {};',
    'const qbState = ' + JSON.stringify(qbState) + ';',
    cacheSrc, srSrc, ensureSrc, ensureInnerSrc, idcSrc, colSrc, jsonSrc, fetchTabSrc, findWOSrc,
    updateWOFieldsSrc, mockQbSrc(),
    'async function fetchConfig(env) { return qbState.config || {}; }',
    'async function logTelemetry(env, rec) { (qbState.telemetry = qbState.telemetry || []).push(rec); }',
    feeSrc, depositApproveSrc, depositClearSrc,
    'return { depositApprove, depositClear, woDepositCredit, woDepositEstimateCap, woDepositMarkApplied, vendorBillAdjustments, instantFeeConfig, qbState };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db), (fn) => fn());
}

function row(db, woId) { return db.Work_Orders.rows.find(r => r[0] === woId); }
function field(name, r) { const i = WO_HEADERS.indexOf(name); return r ? r[i] : undefined; }

const okQb = { billSucceeds: true, billId: 'QBB-1', billNumber: 'BILL-0001', createdVendorId: 'QBV-99', deleteResult: { ok: true, doc: 'BILL-0001' } };

console.log('WO vendor deposit — offline tests\n');
const env = { SHEET_ID: 'S' };

// ── validation ────────────────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositApprove } = build(db, okQb);
  const res = await depositApprove(env, { amount: 300 });
  const body = await res.json();
  t('wo_id required', res.status === 400 && /wo_id required/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositApprove } = build(db, okQb);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 0 });
  const body = await res.json();
  t('rejects zero/non-positive amount', res.status === 400 && /positive number/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositApprove } = build(db, okQb);
  const res = await depositApprove(env, { wo_id: 'WO-9999', amount: 300 });
  t('404s on an unknown WO', res.status === 404);
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]); // no Vendor_ID, none passed
  const { depositApprove } = build(db, okQb);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 300 });
  const body = await res.json();
  t('requires a vendor when the WO has none', res.status === 400 && /vendor_id required/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9' }]);
  const { depositApprove } = build(db, okQb);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 300 });
  t('404s if the WO\'s vendor_id resolves to nothing in Vendors', res.status === 404);
}

// ── happy path: creates a real QB bill, records it, does NOT touch WO Status ──────────────
{
  const db = makeDb(
    [{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9', Trade: 'General', Description: 'Window repair' }],
    [{ ID: 'V-9', Name: 'Cesar Diaz', QBO_Vendor_ID: '77' }],
  );
  const { depositApprove, qbState } = build(db, { ...okQb });
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 300, notes: 'sent via QB instant pay' });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('reports success', body.success === true);
  t('returns the QB bill id/number', body.qb_bill_id === 'QBB-1' && body.qb_bill_number === 'BILL-0001');
  t('stores the deposit amount', field('Deposit_Amount', r) === '300.00');
  t('stores the QB bill id on the WO', field('Deposit_QB_Bill_ID', r) === 'QBB-1');
  t('stores the QB bill number on the WO', field('Deposit_QB_Bill_Number', r) === 'BILL-0001');
  t('starts Deposit_Applied FALSE', field('Deposit_Applied', r) === 'FALSE');
  t('never touches WO Status — job is not complete', field('Status', r) === 'In Progress');
  t('uses the vendor\'s existing QBO_Vendor_ID rather than creating a new one', qbState.vendorLookupCalls === 1);
}

// ── QuickBooks failures must fail loud and record NOTHING ─────────────────────────────────
{
  const db = makeDb(
    [{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9' }],
    [{ ID: 'V-9', Name: 'Cesar Diaz', QBO_Vendor_ID: '77' }],
  );
  const { depositApprove } = build(db, { ...okQb, tokenFails: true });
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 300 });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('QB auth failure returns 502', res.status === 502 && /QuickBooks auth failed/.test(body.error));
  t('nothing recorded on the WO when auth fails', field('Deposit_Amount', r) === '');
}
{
  const db = makeDb(
    [{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9' }],
    [{ ID: 'V-9', Name: 'Cesar Diaz', QBO_Vendor_ID: '77' }],
  );
  const { depositApprove } = build(db, { ...okQb, billSucceeds: false });
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 300 });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('QB bill creation failure returns 502', res.status === 502 && /bill was not created/.test(body.error));
  t('nothing recorded on the WO when bill creation fails', field('Deposit_Amount', r) === '');
}

// ── duplicate-deposit guard (mentions the QB bill in the refusal) ──────────────────────────
{
  const db = makeDb(
    [{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9', Deposit_Amount: '300.00', Deposit_Approved_Date: '2026-09-01', Deposit_Applied: 'FALSE', Deposit_QB_Bill_Number: 'BILL-0001' }],
    [{ ID: 'V-9', QBO_Vendor_ID: '77' }],
  );
  const { depositApprove } = build(db, okQb);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 150 });
  const body = await res.json();
  t('refuses a second deposit while one is unapplied', res.status === 409 && /already has an unapplied deposit/.test(body.error) && /BILL-0001/.test(body.error));
}
{
  const db = makeDb(
    [{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9', Deposit_Amount: '300.00', Deposit_Approved_Date: '2026-09-01', Deposit_Applied: 'FALSE' }],
    [{ ID: 'V-9', QBO_Vendor_ID: '77' }],
  );
  const { depositApprove } = build(db, { ...okQb, billId: 'QBB-2', billNumber: 'BILL-0002' });
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 150, force: true });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('force:true replaces an outstanding deposit', body.success === true && field('Deposit_Amount', r) === '150.00' && field('Deposit_QB_Bill_Number', r) === 'BILL-0002');
}

// ── clear ────────────────────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositClear } = build(db, okQb);
  const res = await depositClear(env, { wo_id: 'WO-1' });
  const body = await res.json();
  t('404s clearing a WO with no deposit recorded', res.status === 404 && /No deposit recorded/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Vendor_ID: 'V-9', Deposit_Approved_Date: '2026-09-01', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: 'QBB-1', Deposit_QB_Bill_Number: 'BILL-0001' }]);
  const { depositClear, qbState } = build(db, { ...okQb });
  const res = await depositClear(env, { wo_id: 'WO-1', reason: 'entered wrong WO' });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('clear reports success', body.success === true);
  t('deletes the QB bill', qbState.deleteCalledWith === 'QBB-1' && /deleted/.test(body.qb_note));
  t('wipes the deposit amount', field('Deposit_Amount', r) === '');
  t('wipes the QB bill fields', field('Deposit_QB_Bill_ID', r) === '' && field('Deposit_QB_Bill_Number', r) === '');
  t('records the reason in Notes', field('Deposit_Notes', r) === 'Cleared: entered wrong WO');
}
{
  // Bill already paid — qbDeleteBillSafe refuses; clear must NOT silently pretend it deleted it
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: 'QBB-1', Deposit_QB_Bill_Number: 'BILL-0001' }]);
  const { depositClear } = build(db, { ...okQb, deleteResult: { ok: false, error: 'Bill BILL-0001 has a payment against it.' } });
  const res = await depositClear(env, { wo_id: 'WO-1' });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('clear still succeeds on the Hub side even if the QB bill can\'t be deleted', body.success === true);
  t('says plainly that the QB bill could not be deleted', /could NOT be deleted/.test(body.qb_note));
  t('still wipes the Hub-side deposit fields', field('Deposit_Amount', r) === '');
}


// ═══ Oct 26 2026 — deposit added after the fact (WO-1253 / Cesar): cap, fee line, automatic deduction ═══
const CESAR = [{ ID: '3', Name: 'Cesar Diaz', QBO_Vendor_ID: '77' }];
const EST460 = [{ ID: '31', WO_ID: 'WO-1253', Version: '1', Subtotal: '460', Status: 'Converted' }];
const wo1253 = (extra) => [{ ID: 'WO-1253', Status: 'Assigned', Vendor_ID: '3', Trade: 'General', Description: 'Repair', ...(extra || {}) }];

{ // the real scenario: $200 on a $460 estimate, instant-pay vendor → bill $200 − $10 fee = send $190, estimate already Converted
  const db = makeDb(wo1253(), CESAR, EST460);
  const { depositApprove, qbState } = build(db, { ...okQb });
  const res = await depositApprove(env, { wo_id: 'WO-1253', amount: 200 });
  const body = await res.json(); const r = row(db, 'WO-1253');
  t('WO-1253 deposit succeeds on a Converted estimate', body.success === true && field('Deposit_Amount', r) === '200.00');
  t('fee on the deposit is $10 (1% of $200 is under the $10 minimum)', body.fee === '10.00' && body.send_amount === '190.00' && field('Deposit_Fee', r) === '10.00');
  const lines = qbState.lastBillPayload.Line;
  t('QB bill has the $200 line and a visible −$10 fee line', lines.length === 2 && lines[0].Amount === 200 && lines[1].Amount === -10 && /fee/i.test(lines[1].Description));
  t('bill total the QB bill adds up to is $190', lines.reduce((a, l) => a + l.Amount, 0) === 190);
  t('starts unapplied', field('Deposit_Applied', r) === 'FALSE');
}
{ // cap
  const db = makeDb(wo1253(), CESAR, EST460);
  const { depositApprove, qbState } = build(db, { ...okQb });
  const res = await depositApprove(env, { wo_id: 'WO-1253', amount: 460.01 });
  const body = await res.json();
  t('a deposit over the estimate is refused (400) and says the max', res.status === 400 && body.max_deposit === 460 && /most you can deposit is \$460\.00/.test(body.error));
  t('over-cap refusal never reaches QuickBooks and records nothing', qbState.lastBillPayload === undefined && field('Deposit_Amount', row(db, 'WO-1253')) === '');
  const ok = await (await depositApprove(env, { wo_id: 'WO-1253', amount: 460 })).json();
  t('a deposit exactly equal to the estimate is allowed', ok.success === true);
}
{ // latest non-declined version is the quote
  const ests = [{ ID: '1', WO_ID: 'WO-1', Version: '1', Subtotal: '1000', Status: 'Approved' }, { ID: '2', WO_ID: 'WO-1', Version: '2', Subtotal: '500', Status: 'Approved' }, { ID: '3', WO_ID: 'WO-1', Version: '3', Subtotal: '50', Status: 'Declined' }];
  const { woDepositEstimateCap } = build(makeDb([], [], []), okQb);
  t('cap uses the latest live version (v2), ignoring a declined v3', woDepositEstimateCap(ests, 'WO-1', {}).cap === 500);
  t('no estimate → null (allowed but said out loud)', woDepositEstimateCap([], 'WO-1', {}) === null);
  t('a deposit already deducted is spent against the cap', woDepositEstimateCap(ests, 'WO-1', { Deposit_Amount: '200', Deposit_Applied: 'TRUE' }).cap === 300);
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9' }], [{ ID: 'V-9', Name: 'X', QBO_Vendor_ID: '77' }], []);
  const { depositApprove } = build(db, { ...okQb });
  const body = await (await depositApprove(env, { wo_id: 'WO-1', amount: 300 })).json();
  t('no estimate on file: allowed, flagged, and no fee for a non-instant vendor', body.success === true && body.no_estimate_on_file === true && body.fee === '0.00' && body.warnings.some(w => /No estimate is on file/.test(w)));
}
{ // preview touches nothing
  const db = makeDb(wo1253(), CESAR, EST460);
  const { depositApprove, qbState } = build(db, { ...okQb });
  const body = await (await depositApprove(env, { wo_id: 'WO-1253', amount: 200, preview_only: true })).json();
  t('preview returns the real numbers', body.success === true && body.preview === true && body.send_amount === '190.00' && body.max_deposit === 460);
  t('preview calls no QuickBooks and writes nothing', qbState.lastBillPayload === undefined && qbState.vendorLookupCalls === undefined && field('Deposit_Amount', row(db, 'WO-1253')) === '');
}
{ // a failed estimate read must stop the deposit
  const db = makeDb(wo1253(), CESAR, EST460); delete db.Estimates;
  const { depositApprove, qbState } = build(db, { ...okQb });
  const res = await depositApprove(env, { wo_id: 'WO-1253', amount: 200 });
  const body = await res.json();
  t('estimate read failure → 502, nothing created', res.status === 502 && /Could not read the estimates/.test(body.error) && qbState.lastBillPayload === undefined);
  t('estimate read failure is logged to telemetry', (qbState.telemetry || []).some(x => x.Job_Type === 'wo_deposit_estimate_read_failed' && x.Success === 'FALSE'));
}

// ── automatic deduction: pure helper rules ──
{
  const { woDepositCredit, vendorBillAdjustments, instantFeeConfig } = build(makeDb([], [], []), okQb);
  const base = { Deposit_Amount: '200.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: '88', Deposit_QB_Bill_Number: 'B-88', Deposit_Vendor_ID: '3' };
  const c = woDepositCredit(base, '3');
  t('unapplied deposit with a QB bill → credit of $200, labelled with the bill number', c && c.amount === 200 && /Bill B-88/.test(c.desc) && /Factura B-88/.test(c.desc_es));
  t('already applied → no credit (never twice)', woDepositCredit({ ...base, Deposit_Applied: 'TRUE' }, '3') === null);
  t('no QuickBooks bill id on file → nothing was paid, no credit', woDepositCredit({ ...base, Deposit_QB_Bill_ID: '' }, '3') === null);
  t('a different vendor is never credited with it', woDepositCredit(base, '9') === null);
  t('no deposit → null', woDepositCredit({}, '3') === null && woDepositCredit(null, '3') === null);
  // WO-1253 numbers: $460 vendor cost, $200 deposit, Cesar instant pay → −200, −10 fee, vendor payable $250
  const adj = vendorBillAdjustments({ payable: 460, credits: [{ type: 'deposit_credit', amount: c.amount, desc: c.desc, desc_es: c.desc_es }], feeOn: true, cfg: instantFeeConfig({}), lang: 'en' });
  t('final bill: deposit line −$200 then fee −$10, bill total $250', adj.lines.length === 2 && adj.lines[0].amount === -200 && adj.lines[0].type === 'deposit_credit' && adj.lines[1].amount === -10 && adj.bill_total === 250 && adj.fee === 10);
  t('total fees across deposit + final are $20', adj.fee + 10 === 20);
  const none = vendorBillAdjustments({ payable: 460, credits: [], feeOn: true, cfg: instantFeeConfig({}), lang: 'en' });
  t('without the deposit the bill would be $450 (this is the overpayment being prevented)', none.bill_total === 450);
}

// ── Deposit_Applied flips only through woDepositMarkApplied, verified by read-back, loud on failure ──
{
  const db = makeDb(wo1253({ Deposit_Amount: '200.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: '88', Deposit_QB_Bill_Number: 'B-88' }), CESAR, EST460);
  const { woDepositMarkApplied, qbState } = build(db, okQb);
  const warnings = [];
  const ok = await woDepositMarkApplied(env, 'WO-1253', { amount: 200, bill_id: '88' }, { id: '501', number: 'B-501' }, warnings, '/test');
  const r = row(db, 'WO-1253');
  t('mark-applied flips Deposit_Applied and records the final bill number', ok === true && field('Deposit_Applied', r) === 'TRUE' && field('Deposit_Applied_Bill', r) === 'B-501' && warnings.length === 0);
}
{
  const db = makeDb(wo1253({ Deposit_Amount: '200.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: '88' }), CESAR, EST460);
  const { woDepositMarkApplied, qbState } = build(db, okQb);
  const warnings = [];
  const ok = await woDepositMarkApplied(env, 'WO-NOPE', { amount: 200, bill_id: '88' }, { id: '501', number: 'B-501' }, warnings, '/test');
  t('a flag that did not save returns false, warns loudly, and logs telemetry', ok === false && warnings.some(w => /Deposit_Applied/.test(w) && /by hand/.test(w)) && (qbState.telemetry || []).some(x => x.Job_Type === 'wo_deposit_apply_flag_failed'));
}
{ // clearing a deposit that was already deducted would desync the books — refuse
  const db = makeDb(wo1253({ Deposit_Amount: '200.00', Deposit_Applied: 'TRUE', Deposit_Applied_Bill: 'B-501', Deposit_QB_Bill_ID: '88' }), CESAR, EST460);
  const { depositClear, qbState } = build(db, okQb);
  const res = await depositClear(env, { wo_id: 'WO-1253' });
  const body = await res.json();
  t('clear refuses once the deposit was taken off a final bill', res.status === 409 && /already taken off the final vendor bill/.test(body.error) && qbState.deleteCalledWith === undefined && field('Deposit_Amount', row(db, 'WO-1253')) === '200.00');
}

// ── force:true retires the old QuickBooks deposit bill first (or refuses) ──
{
  const base = { ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9', Deposit_Amount: '300.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: 'QBB-OLD', Deposit_QB_Bill_Number: 'BILL-OLD', Deposit_Fee: '10.00' };
  const db = makeDb([base], [{ ID: 'V-9', QBO_Vendor_ID: '77' }], []);
  const { depositApprove, qbState } = build(db, { ...okQb, billId: 'QBB-NEW', billNumber: 'BILL-NEW' });
  const body = await (await depositApprove(env, { wo_id: 'WO-1', amount: 150, force: true })).json();
  t('force replace deletes the old QB bill first, then creates the new one', body.success === true && qbState.deleteCalledWith === 'QBB-OLD' && field('Deposit_QB_Bill_ID', row(db, 'WO-1')) === 'QBB-NEW' && field('Deposit_Amount', row(db, 'WO-1')) === '150.00');
  t('force replace says the old bill was deleted', body.warnings.some(w => /was deleted in QuickBooks and replaced/.test(w)));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9', Deposit_Amount: '300.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: 'QBB-OLD', Deposit_QB_Bill_Number: 'BILL-OLD' }], [{ ID: 'V-9', QBO_Vendor_ID: '77' }], []);
  const { depositApprove, qbState } = build(db, { ...okQb, deleteResult: { ok: false, error: 'has a payment against it' } });
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 150, force: true });
  const body = await res.json();
  t('force replace refuses when the old bill cannot be deleted, creating nothing', res.status === 409 && /could not be deleted/.test(body.error) && qbState.lastBillPayload === undefined && field('Deposit_Amount', row(db, 'WO-1')) === '300.00');
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: 'QBB-1', Deposit_Fee: '10.00', Deposit_Applied_Bill: 'X', Deposit_Applied_Date: '2026-10-01' }]);
  const { depositClear } = build(db, okQb);
  await depositClear(env, { wo_id: 'WO-1' });
  const r = row(db, 'WO-1');
  t('clear also wipes the fee and applied-bill fields so nothing stale survives a re-approve', field('Deposit_Fee', r) === '' && field('Deposit_Applied_Bill', r) === '' && field('Deposit_Applied_Date', r) === '');
}
{ // heal guard: a bill already recorded taking the deposit off means it is spent, even if the flag did not save
  const { woDepositCredit } = build(makeDb([], [], []), okQb);
  const wo = { ID: 'WO-1', Deposit_Amount: '200.00', Deposit_Applied: 'FALSE', Deposit_QB_Bill_ID: '88', Deposit_Vendor_ID: '3' };
  t('no credit when an Invoice_Review row already recorded deducting it', woDepositCredit(wo, '3', [{ WO_ID: 'WO-1', Active: 'TRUE', Deposit_Credit: '200.00', QB_Bill_ID: '501' }]) === null);
  t('a voided or bill-less review row does not block the credit', woDepositCredit(wo, '3', [{ WO_ID: 'WO-1', Active: 'FALSE', Deposit_Credit: '200.00', QB_Bill_ID: '501' }, { WO_ID: 'WO-1', Active: 'TRUE', Deposit_Credit: '200.00', QB_Bill_ID: '' }]) !== null);
}

// ── every billing path takes the deposit off automatically and flips the flag only AFTER QuickBooks returns the bill id ──
{
  const fn = (name, isAsync = true) => grab(wsrc, (isAsync ? 'async ' : '') + 'function ' + name + '(');
  const single = fn('qbSendInvoice'), combined = fn('qbSendCombinedInvoice'), milestones = fn('scopeProposalBillMilestones'), legacyFinal = fn('scopeProposalBookFinal'), approve = fn('approveInvoiceReview');
  for (const [name, body] of [['qbSendInvoice', single], ['qbSendCombinedInvoice', combined], ['scopeProposalBillMilestones', milestones], ['scopeProposalBookFinal', legacyFinal]]) {
    t(name + ' reads the deposit through woDepositCredit', body.includes('woDepositCredit('));
    t(name + ' puts it on the vendor bill as a deposit_credit line', body.includes("type: 'deposit_credit'"));
    const iBill = Math.max(body.lastIndexOf('billId = ('), body.lastIndexOf('billId = (br'));
    const iMark = body.indexOf('woDepositMarkApplied(');
    t(name + ' marks the deposit applied only after the bill id exists', iMark > -1 && iMark > body.indexOf("'bill?minorversion=73'"));
  }
  t('approveInvoiceReview no longer flips Deposit_Applied at approval', !/Deposit_Applied:\s*'TRUE'/.test(approve));
  t('no path creates a Vendor_Bills row for the deposit', !grab(wsrc, 'async function depositApprove(').includes('Vendor_Bills'));
  t('qbSendInvoice and combined refuse (409) when the deposit exceeds what is left', single.includes('deposit_blocked') && combined.includes('deposit_blocked'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
