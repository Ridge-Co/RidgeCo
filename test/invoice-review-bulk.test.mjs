// /invoice-review/approve-bulk (approveInvoiceReviewBulk) — the Review Bills bulk-select
// endpoint. Money-adjacent: it writes Vendor_Bills.Status/Customer_Total and appends
// Invoice_Review rows for a WHOLE BATCH sharing one read + one write of each tab, instead of
// the ~7-Sheets-calls-per-bill the single-item approve does N times. These assertions run the
// REAL function (extracted straight from worker.js, not reimplemented) against an in-memory
// fake Sheets backend, so the test can't drift from what ships. What it protects:
//   1. Every approved bill's Vendor_Bills row actually gets Status:'reviewed' + the right
//      Customer_Total, at the right sheet row (the batchUpdate range math must be correct —
//      a wrong row number silently corrupts a DIFFERENT bill).
//   2. Every approved job gets exactly one new Invoice_Review row, with the right fields.
//   3. A bill that doesn't exist reports a per-item error WITHOUT aborting the rest of the
//      batch (one bad row in a 10-bill batch must not lose the other 9).
//   4. Re-approving an already-approved bill/job is a no-op (dedup), not a duplicate.
//   5. The whole point of "bulk": however many bills are in the batch, this costs a small
//      constant number of Sheets write calls, not one pair per bill.
import fs from 'fs';
import assert from 'node:assert';
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
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const cacheSrc   = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc      = grab(wsrc, 'async function sheetsRequest(');
const ensureSrc  = grab(wsrc, 'async function ensureColumns(');
const colSrc     = grab(wsrc, 'function col(index)') || grab(wsrc, 'function col(index');
const idcSrc     = grab(wsrc, 'function idColIndex(');
const nextIdSrc  = grab(wsrc, 'function nextSafeId(');
const jsonSrc    = grab(wsrc, 'function json(data');
const bulkSrc    = grab(wsrc, 'async function approveInvoiceReviewBulk(');

// ── In-memory fake Sheets backend ────────────────────────────────────────────
function makeDb() {
  return {
    Vendor_Bills: {
      headers: ['ID','WO_ID','Vendor_ID','Vendor_Name','Status','Job_Type','Own_Materials','Brett_Time','Brett_Hrs','Travel','Markup','Processing_Fee','Customer_Total','Brett_Net','Own_Wage','Profit','Approved_By','Reviewed_Date'],
      rows: [
        ['101','WO-1','V-1','Alex','submitted','','','','','','','','','','','','',''],
        ['102','WO-2','V-2','Oscar','submitted','','','','','','','','','','','','',''],
      ],
    },
    Invoice_Review: {
      headers: ['ID','Bill_ID','WO_ID','Vendor_ID','Vendor_Name','Job_Type','Vendor_Cost','Brett_Time','Own_Materials','Own_Material_IDs','Travel','Markup','Processing_Fee','Customer_Total','Brett_Net','Own_Wage','Profit','QB_Invoice_Status','QB_Invoice_ID','QB_Bill_ID','Approved_By','Approved_Date','Active'],
      rows: [],
    },
  };
}

function makeFetch(db, callLog) {
  return async (url, opts) => {
    const path = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const method = opts.method;
    callLog.push(method + ' ' + path.split('?')[0]);
    // GET /values/TAB
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    // POST /values:batchUpdate  { data: [{range:'Tab!A1', values:[[v]]}, ...] }
    if (method === 'POST' && path.startsWith('/values:batchUpdate')) {
      const body = JSON.parse(opts.body);
      for (const d of body.data) {
        const [tabName, cellRef] = d.range.split('!');
        const colLetter = cellRef.match(/[A-Z]+/)[0];
        const rowNum = parseInt(cellRef.match(/\d+/)[0], 10);
        let ci = 0; for (let k = 0; k < colLetter.length; k++) ci = ci * 26 + (colLetter.charCodeAt(k) - 64); ci -= 1;
        const tab = db[tabName];
        const r = tab.rows[rowNum - 2];
        if (r) r[ci] = d.values[0][0];
      }
      return { json: async () => ({}) };
    }
    // POST /values/TAB:append
    let m2 = /^\/values\/([^!:?]+):append/.exec(path);
    if (method === 'POST' && m2) {
      const body = JSON.parse(opts.body);
      db[m2[1]].rows.push(...body.values);
      return { json: async () => ({}) };
    }
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

function build(db, callLog) {
  const src = [
    'const CORS = {};', // json() spreads this into response headers; irrelevant to these assertions
    cacheSrc, srSrc, ensureSrc, colSrc, idcSrc, nextIdSrc, jsonSrc, bulkSrc,
    'return { approveInvoiceReviewBulk };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db, callLog), (fn) => fn());
}

// ── 1. A clean batch of 2 approvals ──────────────────────────────────────────
{
  const db = makeDb(); const callLog = [];
  const { approveInvoiceReviewBulk } = build(db, callLog);
  const env = { SHEET_ID: 'S' };
  const res = await approveInvoiceReviewBulk(env, { approvals: [
    { bill_id: '101', wo_id: 'WO-1', vendor_id: 'V-1', vendor_name: 'Alex', customer_total: '150.00', vendor_cost: '50.00', markup: '20.00' },
    { bill_id: '102', wo_id: 'WO-2', vendor_id: 'V-2', vendor_name: 'Oscar', customer_total: '200.00', vendor_cost: '80.00', markup: '30.00' },
  ] });
  const body = await res.json();

  t('both approvals report success', body.results.length === 2 && body.results.every(r => r.success));
  t('each gets a distinct Invoice_Review id', body.results[0].id !== body.results[1].id);

  t('bill 101 Vendor_Bills row marked reviewed at the right price', db.Vendor_Bills.rows[0][db.Vendor_Bills.headers.indexOf('Status')] === 'reviewed'
    && db.Vendor_Bills.rows[0][db.Vendor_Bills.headers.indexOf('Customer_Total')] === '150.00');
  t('bill 102 Vendor_Bills row marked reviewed at the right price — NOT bill 101\'s number', db.Vendor_Bills.rows[1][db.Vendor_Bills.headers.indexOf('Status')] === 'reviewed'
    && db.Vendor_Bills.rows[1][db.Vendor_Bills.headers.indexOf('Customer_Total')] === '200.00');

  t('two new Invoice_Review rows were appended', db.Invoice_Review.rows.length === 2);
  const irByWO = Object.fromEntries(db.Invoice_Review.rows.map(r => [r[db.Invoice_Review.headers.indexOf('WO_ID')], r]));
  t('WO-1 review row carries its own bill id + total, not WO-2\'s',
    irByWO['WO-1'][db.Invoice_Review.headers.indexOf('Bill_ID')] === '101' &&
    irByWO['WO-1'][db.Invoice_Review.headers.indexOf('Customer_Total')] === '150.00');
  t('WO-2 review row carries its own bill id + total', irByWO['WO-2'][db.Invoice_Review.headers.indexOf('Bill_ID')] === '102' &&
    irByWO['WO-2'][db.Invoice_Review.headers.indexOf('Customer_Total')] === '200.00');

  // The whole point of bulk: 2 reads (Vendor_Bills, Invoice_Review) + 2 writes (one
  // batchUpdate covering BOTH bills, one append covering BOTH rows) — NOT 2 bills × ~7 calls.
  const writes = callLog.filter(c => c.startsWith('POST'));
  t('exactly one batchUpdate call covers every bill in the batch', writes.filter(w => w.includes('batchUpdate')).length === 1);
  t('exactly one append call covers every new review row', writes.filter(w => w.includes(':append')).length === 1);
  t('total Sheets calls stay small regardless of batch size (<=5 for 2 bills)', callLog.length <= 5);
}

// ── 2. One bad bill_id must not sink the rest of the batch ──────────────────
{
  const db = makeDb(); const callLog = [];
  const { approveInvoiceReviewBulk } = build(db, callLog);
  const res = await approveInvoiceReviewBulk({ SHEET_ID: 'S' }, { approvals: [
    { bill_id: '101', wo_id: 'WO-1', customer_total: '150.00' },
    { bill_id: '999', wo_id: 'WO-999', customer_total: '75.00' }, // doesn't exist
  ] });
  const body = await res.json();
  t('the real bill still succeeds', body.results[0].success === true);
  t('the missing bill reports an error, not a thrown exception', body.results[1].success === false && /not found/i.test(body.results[1].error));
  t('the real bill\'s row was actually updated despite the other failing', db.Vendor_Bills.rows[0][4] === 'reviewed');
}

// ── 3. Re-approving an already-approved job is a no-op, not a duplicate ─────
{
  const db = makeDb(); const callLog = [];
  db.Invoice_Review.rows.push(['IR-9','101','WO-1','V-1','Alex','standard','50','0','0','','0','20','0','150.00','130','0','0','pending','','','Brett','2026-01-01','TRUE']);
  const { approveInvoiceReviewBulk } = build(db, callLog);
  const res = await approveInvoiceReviewBulk({ SHEET_ID: 'S' }, { approvals: [
    { bill_id: '101', wo_id: 'WO-1', customer_total: '150.00' },
  ] });
  const body = await res.json();
  t('dedup hands back the existing row', body.results[0].already_approved === true && body.results[0].id === 'IR-9');
  t('no duplicate Invoice_Review row was appended', db.Invoice_Review.rows.length === 1);
  t('dedup skips all writes entirely (read-only in this case)', callLog.filter(c => c.startsWith('POST')).length === 0);
}

// ── 4. Input guards ───────────────────────────────────────────────────────
{
  const db = makeDb(); const callLog = [];
  const { approveInvoiceReviewBulk } = build(db, callLog);
  const empty = await (await approveInvoiceReviewBulk({ SHEET_ID: 'S' }, { approvals: [] })).json();
  t('an empty batch is rejected up front, no Sheets calls at all', empty.error && callLog.length === 0);

  const tooMany = await (await approveInvoiceReviewBulk({ SHEET_ID: 'S' }, { approvals: Array.from({ length: 51 }, (_, i) => ({ bill_id: String(i) })) })).json();
  t('a batch over the cap is rejected up front', /max 50/i.test(tooMany.error || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
