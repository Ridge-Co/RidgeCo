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
  'Deposit_QB_Bill_ID','Deposit_QB_Bill_Number'];
const VENDOR_HEADERS = ['ID','Name','Company','First_Name','QBO_Vendor_ID'];

function makeDb(woRows, vendorRows) {
  return {
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
    updateWOFieldsSrc, mockQbSrc(), depositApproveSrc, depositClearSrc,
    'return { depositApprove, depositClear, qbState };',
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
