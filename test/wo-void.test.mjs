// Work Order Void/Hide (FEATURE_LOG rule 162) — offline tests for woVoid, woUnvoid, and
// getWorkOrdersList. Extracts the REAL functions verbatim out of worker.js and runs them
// against an in-memory fake Sheets backend, same convention/mock as test/turnover.test.mjs,
// so this test cannot quietly drift from what ships.
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
const woUnvoidSrc        = grab(wsrc, 'async function woUnvoid(');
const getListSrc         = grab(wsrc, 'async function getWorkOrdersList(');

// ── In-memory fake Sheets backend (same shape/behavior as turnover.test.mjs's mock) ──────
const WO_HEADERS = ['ID','Property_ID','Unit_ID','Vendor_ID','Trade','Description','Status','Notes',
  'Voided','Void_Reason','Void_Reason_Detail','Void_Combined_Into_WO_ID','Voided_By','Voided_Date'];
const AUDIT_HEADERS = ['ID','WO_ID','Changed_By','Changed_By_Role','Field','Old_Value','New_Value','Timestamp','Notes'];

function makeDb(rows) {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: rows.map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    WO_Audit: { headers: AUDIT_HEADERS.slice(), rows: [] },
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
    reasonsSrc, columnsSrc, woVoidSrc, woUnvoidSrc, getListSrc,
    'return { woVoid, woUnvoid, getWorkOrdersList };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db), (fn) => fn());
}

function row(db, woId) { return db.Work_Orders.rows.find(r => r[0] === woId); }
function field(name, r) { const i = WO_HEADERS.indexOf(name); return r ? r[i] : undefined; }

console.log('Work Order Void/Hide — offline tests\n');
const env = { SHEET_ID: 'S' };

// ── 1. reason validation ──────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-1', reason: 'Bogus' });
  const body = await res.json();
  t('rejects a reason outside the enum', res.status === 400 && /reason must be one of/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-1', reason: 'Combined' });
  const body = await res.json();
  t('Combined without a target id is rejected', res.status === 400 && /combined_into_wo_id required/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-1', reason: 'Combined', combined_into_wo_id: 'WO-9999' });
  const body = await res.json();
  t('Combined into a work order that does not exist is rejected', res.status === 404 && /not found/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-1', reason: 'Combined', combined_into_wo_id: 'WO-1' });
  const body = await res.json();
  t('cannot combine a work order into itself', res.status === 400 && /itself/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Status: 'New' }]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-9999', reason: 'Duplicate' });
  t('voiding a work order that does not exist 404s', res.status === 404);
}

// ── 2. Duplicate / Other — sets the flag, keeps Status untouched ────────────
{
  const db = makeDb([{ ID: 'WO-1192', Property_ID: '76', Status: 'New' }]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-1192', reason: 'Duplicate', updated_by: 'Brett' });
  const body = await res.json();
  const r = row(db, 'WO-1192');
  t('Duplicate void succeeds', body.success === true);
  t('Voided flag is set', field('Voided', r) === 'TRUE');
  t('Void_Reason recorded', field('Void_Reason', r) === 'Duplicate');
  t('Status is left completely alone — Voided is independent of Status', field('Status', r) === 'New');
  t('Voided_By recorded', field('Voided_By', r) === 'Brett');
  t('an audit row was logged', db.WO_Audit.rows.length === 1 && db.WO_Audit.rows[0][4] === 'Voided');
}
{
  const db = makeDb([{ ID: 'WO-2', Property_ID: '76', Status: 'Assigned' }]);
  const { woVoid } = build(db);
  await woVoid(env, { wo_id: 'WO-2', reason: 'Other', detail: 'created against the wrong property' });
  const r = row(db, 'WO-2');
  t('Other reason stores the free-text detail', field('Void_Reason_Detail', r) === 'created against the wrong property');
}

// ── 3. Combined — copies Notes onto the surviving WO, nothing else moves ────
{
  const db = makeDb([
    { ID: 'WO-10', Property_ID: '76', Status: 'New', Notes: 'Tenant called again about the same leak' },
    { ID: 'WO-11', Property_ID: '76', Status: 'Assigned', Notes: 'Vendor already on site' },
  ]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-10', reason: 'Combined', combined_into_wo_id: 'WO-11', updated_by: 'Brett' });
  const body = await res.json();
  const voided = row(db, 'WO-10'), target = row(db, 'WO-11');
  t('Combined void succeeds', body.success === true);
  t('the voided WO records which WO it was folded into', field('Void_Combined_Into_WO_ID', voided) === 'WO-11');
  t('the target WO keeps its own original notes', field('Notes', target).includes('Vendor already on site'));
  t('the target WO gains the voided WO\'s notes, tagged with a combined-from prefix',
    /combined from WO-10/.test(field('Notes', target)) && field('Notes', target).includes('Tenant called again'));
}
{
  // No notes on the voided WO -> nothing to copy, target's notes stay exactly as they were.
  const db = makeDb([
    { ID: 'WO-20', Property_ID: '76', Status: 'New', Notes: '' },
    { ID: 'WO-21', Property_ID: '76', Status: 'New', Notes: 'original note' },
  ]);
  const { woVoid } = build(db);
  await woVoid(env, { wo_id: 'WO-20', reason: 'Combined', combined_into_wo_id: 'WO-21' });
  t('a voided WO with no notes leaves the target\'s notes untouched', field('Notes', row(db, 'WO-21')) === 'original note');
}

// ── 4. Restore — flips Voided back, keeps the reason/detail as history ──────
{
  const db = makeDb([{ ID: 'WO-30', Property_ID: '76', Status: 'New', Voided: 'TRUE', Void_Reason: 'Duplicate', Voided_By: 'Brett', Voided_Date: '2026-09-14T00:00:00.000Z' }]);
  const { woUnvoid } = build(db);
  const res = await woUnvoid(env, { wo_id: 'WO-30', updated_by: 'Brett' });
  const body = await res.json();
  const r = row(db, 'WO-30');
  t('unvoid succeeds', body.success === true);
  t('Voided flips back to FALSE', field('Voided', r) === 'FALSE');
  t('the void reason is preserved as history, not cleared', field('Void_Reason', r) === 'Duplicate');
  t('an audit row for the restore was logged (TRUE -> FALSE)', db.WO_Audit.rows.some(a => a[4] === 'Voided' && a[5] === 'TRUE' && a[6] === 'FALSE'));
}
{
  const db = makeDb([{ ID: 'WO-31', Property_ID: '76', Status: 'New' }]);
  const { woUnvoid } = build(db);
  const res = await woUnvoid(env, { wo_id: 'WO-9999' });
  t('unvoiding a work order that does not exist 404s', res.status === 404);
}

// ── 5. getWorkOrdersList — the three visibility modes ────────────────────────
{
  const db = makeDb([
    { ID: 'WO-40', Property_ID: '76', Status: 'New' },
    { ID: 'WO-41', Property_ID: '76', Status: 'New', Voided: 'TRUE', Void_Reason: 'Duplicate' },
  ]);
  const { getWorkOrdersList } = build(db);
  const def = await (await getWorkOrdersList(env, new URL('https://x/workorders'))).json();
  t('default list excludes the voided row', def.length === 1 && def[0].ID === 'WO-40');
  const all = await (await getWorkOrdersList(env, new URL('https://x/workorders?include_voided=1'))).json();
  t('?include_voided=1 returns both rows', all.length === 2);
  const only = await (await getWorkOrdersList(env, new URL('https://x/workorders?voided_only=1'))).json();
  t('?voided_only=1 returns ONLY the voided row', only.length === 1 && only[0].ID === 'WO-41');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
