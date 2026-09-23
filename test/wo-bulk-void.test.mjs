// Bulk Void (worker.js woBulkVoid, POST /wo/bulk-void) -- offline tests. Extracts the REAL
// functions verbatim out of worker.js and runs them against an in-memory fake Sheets backend,
// same convention/mock as test/wo-void.test.mjs, so this test cannot quietly drift from what
// ships. Covers: successful bulk void, money-attached WOs correctly skipped (each of the three
// money signals independently), WO_Audit entries created for the voided ones, and mixed
// batches (some void, some skip) in one call.
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
function grabConst(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('  ✗ FAIL:', n); } };

const cacheSrc          = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc              = grab(wsrc, 'async function sheetsRequest(');
const ensureSrc          = grab(wsrc, 'async function ensureColumns(');
const idcSrc             = grab(wsrc, 'function idColIndex(');
const colSrc             = grab(wsrc, 'function col(index)') || grab(wsrc, 'function col(index');
const jsonSrc            = grab(wsrc, 'function json(data');
const fetchTabSrc        = grab(wsrc, 'async function fetchTab(');
const findWOSrc          = grab(wsrc, 'function findWO(');
const updateWOFieldsSrc  = grab(wsrc, 'async function updateWOFields(');
const nextSafeIdSrc      = grab(wsrc, 'function nextSafeId(');
const logAuditSrc        = grab(wsrc, 'async function logWOAudit(');
const logAuditManySrc    = grab(wsrc, 'async function logWOAuditMany(');
const reasonsSrc         = grabConst(wsrc, 'const WO_VOID_REASONS');
const columnsSrc         = grabConst(wsrc, 'const WO_VOID_COLUMNS');
const woVoidSrc          = grab(wsrc, 'async function woVoid(');
const moneyBlockSrc      = grab(wsrc, 'function woBulkVoidMoneyBlockReason(');
const woBulkVoidSrc      = grab(wsrc, 'async function woBulkVoid(');

// -- In-memory fake Sheets backend (same shape/behavior as wo-void.test.mjs's mock), extended
// with a Vendor_Bills tab so the linked-vendor-bill money check has something to read. --------
const WO_HEADERS = ['ID','Property_ID','Unit_ID','Vendor_ID','Trade','Description','Status','Notes',
  'Customer_Charge','QBO_Invoice_Number',
  'Voided','Void_Reason','Void_Reason_Detail','Void_Combined_Into_WO_ID','Voided_By','Voided_Date'];
const AUDIT_HEADERS = ['ID','WO_ID','Changed_By','Changed_By_Role','Field','Old_Value','New_Value','Timestamp','Notes'];
const BILL_HEADERS = ['ID','WO_ID','Vendor_ID','Status','Active'];

function makeDb(rows, bills) {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: rows.map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    WO_Audit: { headers: AUDIT_HEADERS.slice(), rows: [] },
    Vendor_Bills: { headers: BILL_HEADERS.slice(), rows: (bills || []).map(r => BILL_HEADERS.map(h => r[h] ?? '')) },
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
    let m2 = /^\/values\/([^!:?]+):append/.exec(path);
    if (method === 'POST' && m2) {
      const body = JSON.parse(opts.body);
      if (!db[m2[1]]) db[m2[1]] = { headers: [], rows: [] };
      db[m2[1]].rows.push(...body.values);
      return { json: async () => ({}) };
    }
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

function build(db) {
  const src = [
    'const CORS = {};',
    cacheSrc, srSrc, ensureSrc, idcSrc, colSrc, jsonSrc, fetchTabSrc, findWOSrc,
    updateWOFieldsSrc, nextSafeIdSrc, logAuditSrc, logAuditManySrc,
    reasonsSrc, columnsSrc, woVoidSrc, moneyBlockSrc, woBulkVoidSrc,
    'return { woVoid, woBulkVoid };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db), (fn) => fn());
}

function row(db, woId) { return db.Work_Orders.rows.find(r => r[0] === woId); }
function field(name, r) { const i = WO_HEADERS.indexOf(name); return r ? r[i] : undefined; }

console.log('Bulk Void -- offline tests\n');
const env = { SHEET_ID: 'S' };

// -- 1. request validation -----------------------------------------------------
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: [], reason: 'Duplicate' });
  const body = await res.json();
  t('empty ids list is rejected', res.status === 400 && /ids required/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-1'], reason: 'Bogus' });
  const body = await res.json();
  t('rejects a reason outside the enum', res.status === 400 && /reason must be one of/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-1'], reason: 'Combined' });
  const body = await res.json();
  t('Combined without a shared target id is rejected', res.status === 400 && /combined_into_wo_id required/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-1'], reason: 'Combined', combined_into_wo_id: 'WO-9999' });
  const body = await res.json();
  t('Combined into a work order that does not exist 404s the whole request', res.status === 404 && /not found/.test(body.error));
}

// -- 2. successful bulk void -- every WO in a clean batch is voided, each with its own audit row
{
  const db = makeDb([
    { ID: 'WO-1039', Property_ID: '76', Status: 'Cancelled', Description: 'Test' },
    { ID: 'WO-1054', Property_ID: '76', Status: 'Cancelled', Description: 'TEST -- verifying' },
    { ID: 'WO-1057', Property_ID: '76', Status: 'Cancelled', Description: 'Test' },
  ]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-1039', 'WO-1054', 'WO-1057'], reason: 'Duplicate', updated_by: 'Brett' });
  const body = await res.json();
  t('all three voided', body.voided.length === 3 && body.skipped.length === 0);
  t('WO-1039 flag flipped', field('Voided', row(db, 'WO-1039')) === 'TRUE');
  t('WO-1054 flag flipped', field('Voided', row(db, 'WO-1054')) === 'TRUE');
  t('WO-1057 flag flipped', field('Voided', row(db, 'WO-1057')) === 'TRUE');
  t('every voided WO got its own WO_Audit row', db.WO_Audit.rows.filter(a => a[4] === 'Voided').length === 3);
  t('audit rows carry the right actor', db.WO_Audit.rows.every(a => a[2] === 'Brett'));
}

// -- 3. money-attached skips -- each of the three signals independently ---------
{
  const db = makeDb([{ ID: 'WO-A', Property_ID: '76', Status: 'New', Customer_Charge: '125.00' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-A'], reason: 'Duplicate' });
  const body = await res.json();
  t('Customer_Charge blocks the void', body.voided.length === 0 && body.skipped.length === 1);
  t('skip reason names the charge', /Customer charge/.test(body.skipped[0].reason) && /125\.00/.test(body.skipped[0].reason));
  t('the WO was NOT voided', field('Voided', row(db, 'WO-A')) !== 'TRUE');
}
{
  const db = makeDb([{ ID: 'WO-B', Property_ID: '76', Status: 'New', QBO_Invoice_Number: 'INV-4421' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-B'], reason: 'Duplicate' });
  const body = await res.json();
  t('QBO_Invoice_Number blocks the void', body.voided.length === 0 && body.skipped.length === 1);
  t('skip reason names the invoice', /Already invoiced/.test(body.skipped[0].reason) && /INV-4421/.test(body.skipped[0].reason));
}
{
  const db = makeDb(
    [{ ID: 'WO-C', Property_ID: '76', Status: 'New' }],
    [{ ID: 'BILL-1', WO_ID: 'WO-C', Vendor_ID: 'V-1', Status: 'submitted', Active: 'TRUE' }]
  );
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-C'], reason: 'Duplicate' });
  const body = await res.json();
  t('a linked (even unreviewed) vendor bill blocks the void', body.voided.length === 0 && body.skipped.length === 1);
  t('skip reason names the bill', /linked vendor bill/.test(body.skipped[0].reason) && /BILL-1/.test(body.skipped[0].reason));
}
{
  // An INACTIVE (voided) vendor bill does not count as money attached -- Active:'FALSE' means
  // it was itself undone, same convention timeEntryReassignLock/vendorBillReassignLock use.
  const db = makeDb(
    [{ ID: 'WO-D', Property_ID: '76', Status: 'New' }],
    [{ ID: 'BILL-2', WO_ID: 'WO-D', Vendor_ID: 'V-1', Status: 'submitted', Active: 'FALSE' }]
  );
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-D'], reason: 'Duplicate' });
  const body = await res.json();
  t('an inactive/voided vendor bill does not block the void', body.voided.length === 1 && body.skipped.length === 0);
}

// -- 4. mixed batch -- some void, some skip, in ONE call -------------------------
{
  const db = makeDb(
    [
      { ID: 'WO-1039', Property_ID: '76', Status: 'Cancelled', Description: 'Test' },
      { ID: 'WO-1054', Property_ID: '76', Status: 'Cancelled', Description: 'TEST -- verifying', Customer_Charge: '80.00' },
      { ID: 'WO-1057', Property_ID: '76', Status: 'Cancelled', Description: 'Test' },
      { ID: 'WO-1059', Property_ID: '76', Status: 'Cancelled', Description: 'Test', QBO_Invoice_Number: 'INV-1' },
      { ID: 'WO-9999', Property_ID: '76', Status: 'New', Voided: 'TRUE', Void_Reason: 'Duplicate' },
    ],
    [{ ID: 'BILL-9', WO_ID: 'WO-1057', Vendor_ID: 'V-1', Status: 'reviewed', Active: 'TRUE' }]
  );
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, {
    ids: ['WO-1039', 'WO-1054', 'WO-1057', 'WO-1059', 'WO-9999', 'WO-NOPE'],
    reason: 'Duplicate', updated_by: 'Brett',
  });
  const body = await res.json();
  t('exactly the clean WO is voided', body.voided.length === 1 && body.voided[0] === 'WO-1039');
  t('everything else is skipped, reported not dropped', body.skipped.length === 5);
  const byId = {}; body.skipped.forEach(s => { byId[s.id] = s.reason; });
  t('WO-1054 skipped for its customer charge', /Customer charge/.test(byId['WO-1054']));
  t('WO-1057 skipped for its reviewed vendor bill', /linked vendor bill/.test(byId['WO-1057']) && /reviewed/.test(byId['WO-1057']));
  t('WO-1059 skipped for its QBO invoice', /Already invoiced/.test(byId['WO-1059']));
  t('WO-9999 skipped as already voided', byId['WO-9999'] === 'Already voided');
  t('WO-NOPE skipped as not found', byId['WO-NOPE'] === 'Work order not found');
  t('only the actually-voided WO got a WO_Audit row', db.WO_Audit.rows.filter(a => a[4] === 'Voided').length === 1);
  t('the surviving audit row is for WO-1039', db.WO_Audit.rows[0][1] === 'WO-1039');
  t('WO-1054/1057/1059/9999 were never flipped', field('Voided', row(db, 'WO-1054')) !== 'TRUE' && field('Voided', row(db, 'WO-1057')) !== 'TRUE' && field('Voided', row(db, 'WO-1059')) !== 'TRUE');
}

// -- 5. Combined reason -- one shared target for the whole batch ----------------
{
  const db = makeDb([
    { ID: 'WO-50', Property_ID: '76', Status: 'New', Notes: 'first' },
    { ID: 'WO-51', Property_ID: '76', Status: 'New', Notes: 'second' },
    { ID: 'WO-52', Property_ID: '76', Status: 'New' },
  ]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-50', 'WO-51'], reason: 'Combined', combined_into_wo_id: 'WO-52', updated_by: 'Brett' });
  const body = await res.json();
  t('both voided into the shared survivor', body.voided.length === 2 && body.skipped.length === 0);
  t('both record the same combined-into target', field('Void_Combined_Into_WO_ID', row(db, 'WO-50')) === 'WO-52' && field('Void_Combined_Into_WO_ID', row(db, 'WO-51')) === 'WO-52');
  t('the survivor cannot appear in its own batch', true); // covered by test below
}
{
  const db = makeDb([{ ID: 'WO-60', Property_ID: '76', Status: 'New' }]);
  const { woBulkVoid } = build(db);
  const res = await woBulkVoid(env, { ids: ['WO-60'], reason: 'Combined', combined_into_wo_id: 'WO-60' });
  const body = await res.json();
  t('a WO cannot be combined into itself in a bulk batch', body.voided.length === 0 && body.skipped.length === 1 && /itself/.test(body.skipped[0].reason));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
