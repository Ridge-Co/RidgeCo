// WO vendor deposit (Sep 15 2026) — offline tests for depositApprove / depositClear.
// Extracts the REAL functions verbatim out of worker.js and runs them against an in-memory
// fake Sheets backend, same convention/mock as test/wo-void.test.mjs, so this test cannot
// quietly drift from what ships.
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

// WO_HEADERS pre-seeds the deposit columns so ensureColumns is always a same-shape no-op
// here — it's exercised for real (against the live sheet) by the paste-ready patch's own
// post-push verification, not by this offline harness.
const WO_HEADERS = ['ID','Property_ID','Vendor_ID','Trade','Description','Status',
  'Deposit_Amount','Deposit_Vendor_ID','Deposit_Approved_Date','Deposit_Notes','Deposit_Applied'];

function makeDb(rows) {
  return { Work_Orders: { headers: WO_HEADERS.slice(), rows: rows.map(r => WO_HEADERS.map(h => r[h] ?? '')) } };
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

function build(db) {
  const src = [
    'const CORS = {};',
    cacheSrc, srSrc, ensureSrc, ensureInnerSrc, idcSrc, colSrc, jsonSrc, fetchTabSrc, findWOSrc,
    updateWOFieldsSrc, depositApproveSrc, depositClearSrc,
    'return { depositApprove, depositClear };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db), (fn) => fn());
}

function row(db, woId) { return db.Work_Orders.rows.find(r => r[0] === woId); }
function field(name, r) { const i = WO_HEADERS.indexOf(name); return r ? r[i] : undefined; }

console.log('WO vendor deposit — offline tests\n');
const env = { SHEET_ID: 'S' };

// ── validation ────────────────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { amount: 300 });
  const body = await res.json();
  t('wo_id required', res.status === 400 && /wo_id required/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 0 });
  const body = await res.json();
  t('rejects zero/non-positive amount', res.status === 400 && /positive number/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { wo_id: 'WO-9999', amount: 300 });
  t('404s on an unknown WO', res.status === 404);
}

// ── happy path: records the deposit, does NOT touch Status ────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 300, notes: '151 W Lanvale Apt 1 — window repair deposit' });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('reports success', body.success === true);
  t('stores the deposit amount', field('Deposit_Amount', r) === '300.00');
  t('defaults Deposit_Vendor_ID from the WO Vendor_ID', field('Deposit_Vendor_ID', r) === 'V-9');
  t('stamps a Deposit_Approved_Date', /^\d{4}-\d{2}-\d{2}$/.test(field('Deposit_Approved_Date', r)));
  t('carries the notes through', field('Deposit_Notes', r) === '151 W Lanvale Apt 1 — window repair deposit');
  t('starts Deposit_Applied FALSE', field('Deposit_Applied', r) === 'FALSE');
  t('never touches WO Status — job is not complete', field('Status', r) === 'In Progress');
}

// ── explicit vendor_id overrides the WO's own Vendor_ID ────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Vendor_ID: 'V-9' }]);
  const { depositApprove } = build(db);
  await depositApprove(env, { wo_id: 'WO-1', vendor_id: 'V-42', amount: 100 });
  const r = row(db, 'WO-1');
  t('explicit vendor_id wins over the WO default', field('Deposit_Vendor_ID', r) === 'V-42');
}

// ── duplicate-deposit guard ─────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Approved_Date: '2026-09-01', Deposit_Applied: 'FALSE' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 150 });
  const body = await res.json();
  t('refuses a second deposit while one is unapplied', res.status === 409 && /already has an unapplied deposit/.test(body.error));
  const r = row(db, 'WO-1');
  t('does not overwrite the existing deposit on refusal', field('Deposit_Amount', r) === '300.00');
}
{
  // force:true explicitly replaces it
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Approved_Date: '2026-09-01', Deposit_Applied: 'FALSE' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 150, force: true });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('force:true replaces an outstanding deposit', body.success === true && field('Deposit_Amount', r) === '150.00');
}
{
  // a PRIOR deposit already applied to a completed bill is not "outstanding" — a new one is fine
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Approved_Date: '2026-08-01', Deposit_Applied: 'TRUE' }]);
  const { depositApprove } = build(db);
  const res = await depositApprove(env, { wo_id: 'WO-1', amount: 150 });
  const body = await res.json();
  t('a second job\'s deposit is fine once the first was already applied', body.success === true);
}

// ── clear ────────────────────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress' }]);
  const { depositClear } = build(db);
  const res = await depositClear(env, { wo_id: 'WO-1' });
  const body = await res.json();
  t('404s clearing a WO with no deposit recorded', res.status === 404 && /No deposit recorded/.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Status: 'In Progress', Deposit_Amount: '300.00', Deposit_Vendor_ID: 'V-9', Deposit_Approved_Date: '2026-09-01', Deposit_Applied: 'FALSE' }]);
  const { depositClear } = build(db);
  const res = await depositClear(env, { wo_id: 'WO-1', reason: 'entered wrong WO' });
  const body = await res.json();
  const r = row(db, 'WO-1');
  t('clear reports success', body.success === true);
  t('wipes the deposit amount', field('Deposit_Amount', r) === '');
  t('wipes the deposit vendor', field('Deposit_Vendor_ID', r) === '');
  t('records the reason in Notes', field('Deposit_Notes', r) === 'Cleared: entered wrong WO');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
