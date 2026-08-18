// Turnover trigger (B-100) — Repairs + Paint open in parallel immediately (so vendors can be
// lined up well before a knee-jerk, last-minute turnover), Cleaning is created On Hold and only
// releases once BOTH finish, or the target move-in date arrives, whichever comes first. These
// assertions run the REAL functions extracted straight from worker.js (not reimplemented)
// against an in-memory fake Sheets backend, so the test can't drift from what ships. What it
// protects:
//   1. createTurnoverWOs makes exactly 3 connected WOs sharing one Turnover_Group_ID, Cleaning
//      starts On Hold with a Hold_Reason and (when a target move-in date is given) the correct
//      day-before Turnover_Release_Date.
//   2. Idempotency — a second turnover on a unit that already has one running is rejected (409),
//      not silently stacked on top.
//   3. releaseTurnoverCleaningIfReady only releases Cleaning once BOTH siblings are done, never
//      on just one, and correctly no-ops if Cleaning was already released.
//   4. releaseTurnoverByDate (the cron sweep) releases a Cleaning WO whose release date has
//      arrived even though its siblings are still open — the "whichever comes first" half.
//   5. scheduleMoveOutWithTurnover books Tenants.Scheduled_Move_Out_Date WITHOUT touching
//      Active/PIN (unlike the destructive /tenant/move-out), and starts the turnover.
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
function grabConst(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const cacheSrc      = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc          = grab(wsrc, 'async function sheetsRequest(');
const ensureSrc       = grab(wsrc, 'async function ensureColumns(');
const colSrc          = grab(wsrc, 'function col(index)') || grab(wsrc, 'function col(index');
const idcSrc          = grab(wsrc, 'function idColIndex(');
const jsonSrc         = grab(wsrc, 'function json(data');
const fetchTabSrc     = grab(wsrc, 'async function fetchTab(');
const fetchTabsSrc    = grab(wsrc, 'async function fetchTabs(');
const updateRowSrc    = grab(wsrc, 'async function updateRow(');
const updateWOFieldsSrc = grab(wsrc, 'async function updateWOFields(');
const createWOSrc     = grab(wsrc, 'async function createWorkOrder(');
const rolesSrc        = grabConst(wsrc, 'const TURNOVER_ROLES');
const tradeMapSrc     = grabConst(wsrc, 'const TURNOVER_TRADE_BY_ROLE');
const descMapSrc      = grabConst(wsrc, 'const TURNOVER_DESC_BY_ROLE');
const doneStatusesSrc = grabConst(wsrc, 'const TURNOVER_RELEASE_DONE_STATUSES');
const dayBeforeSrc    = grab(wsrc, 'function dayBefore(');
const nextGroupIdSrc  = grab(wsrc, 'function nextTurnoverGroupId(');
const createTOSrc     = grab(wsrc, 'async function createTurnoverWOs(');
const startTOSrc      = grab(wsrc, 'async function startTurnoverManual(');
const scheduleMOSrc   = grab(wsrc, 'async function scheduleMoveOutWithTurnover(');
const releaseIfReadySrc = grab(wsrc, 'async function releaseTurnoverCleaningIfReady(');
const releaseByDateSrc  = grab(wsrc, 'async function releaseTurnoverByDate(');

// ── In-memory fake Sheets backend ────────────────────────────────────────────
const WO_HEADERS = ['ID','Property_ID','Unit_ID','Tenant_ID','Vendor_ID','Type','Trade','Description',
  'Priority','Status','Scheduled_Date','Scheduled_Window','Completed_Date','Invoice_ID','Owner_WO_Ref',
  'WO_Contact_Name','WO_Contact_Phone','Tenant_Visible','Tenant_Notify_Created','Tenant_Notify_Updates',
  'Vendor_SMS_Sent','Tenant_SMS_Sent','Owner_Notified','Created_By','Created_Date','Notes','Room',
  'Vendor_Needs_Access','Checklist'];

function makeDb(extra) {
  const db = {
    Units: { headers: ['ID','Property_ID','Unit_Label','Tenant_ID'], rows: [['U-1','P-1','1A','T-1']] },
    Tenants: { headers: ['ID','Unit_ID','Property_ID','First_Name','Last_Name','Phone','Active','Move_Out_Date','PIN'], rows: [['T-1','U-1','P-1','Jane','Doe','+15551234567','TRUE','','ABC12345']] },
    Work_Orders: { headers: WO_HEADERS.slice(), rows: [] },
  };
  return Object.assign(db, extra);
}

function makeFetch(db, callLog) {
  return async (url, opts) => {
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0];
    const method = opts.method;
    callLog.push(method + ' ' + path);

    // GET /values:batchGet?ranges=A&ranges=B
    if (method === 'GET' && path === '/values:batchGet') {
      const qs = new URLSearchParams(full.split('?')[1] || '');
      const ranges = qs.getAll('ranges');
      const valueRanges = ranges.map(r => {
        const tab = db[r];
        return { values: tab ? [tab.headers, ...tab.rows] : [] };
      });
      return { json: async () => ({ valueRanges }) };
    }
    // GET /values/TAB
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    // GET spreadsheet metadata (ensureColumns' grid-resize probe, path = "?fields=...") and
    // the grid-resize ":batchUpdate" it can trigger are both intentionally NOT modeled here —
    // both are wrapped in ensureColumns' own try/catch, so falling through to "unhandled mock
    // path" below and throwing is exactly as safe as a real API error would be.
    // POST /values:batchUpdate  { data: [{range:'Tab!A1', values:[[v]]}, ...] }
    if (method === 'POST' && path === '/values:batchUpdate') {
      const body = JSON.parse(opts.body);
      for (const d of body.data) {
        const [tabName, cellRef] = d.range.split('!');
        const colLetter = cellRef.match(/[A-Z]+/)[0];
        const rowNum = parseInt(cellRef.match(/\d+/)[0], 10);
        let ci = 0; for (let k = 0; k < colLetter.length; k++) ci = ci * 26 + (colLetter.charCodeAt(k) - 64); ci -= 1;
        const tab = db[tabName];
        if (!tab) continue;
        if (rowNum === 1) { tab.headers[ci] = d.values[0][0]; continue; } // header write (ensureColumns)
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
    'const CORS = {};',
    cacheSrc, srSrc, ensureSrc, colSrc, idcSrc, jsonSrc, fetchTabSrc, fetchTabsSrc,
    updateRowSrc, updateWOFieldsSrc,
    'async function addRow(){ return { success:true, id:"X" }; }', // WO_Tenants linking side-effect — not under test
    'async function logTelemetry(){ /* no-op in tests */ }',
    createWOSrc,
    rolesSrc, tradeMapSrc, descMapSrc, doneStatusesSrc,
    dayBeforeSrc, nextGroupIdSrc, createTOSrc, startTOSrc, scheduleMOSrc, releaseIfReadySrc, releaseByDateSrc,
    'return { createTurnoverWOs, startTurnoverManual, scheduleMoveOutWithTurnover, releaseTurnoverCleaningIfReady, releaseTurnoverByDate, dayBefore, nextTurnoverGroupId };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db, callLog), (fn) => fn());
}

function findWOById(db, id) { return db.Work_Orders.rows.find(r => r[WO_HEADERS.indexOf('ID')] === id); }
function field(db, row, name) { return row ? row[db.Work_Orders.headers.indexOf(name)] : undefined; }

// ── 1. Happy path — 3 connected WOs, Cleaning On Hold with the right release date ──────────
{
  const db = makeDb(); const callLog = [];
  const { createTurnoverWOs } = build(db, callLog);
  const res = await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1', target_move_in_date: '2026-09-10', source: 'manual', created_by: 'Admin' });
  const body = await res.json();
  t('reports success with a group id and 3 wo ids', body.success === true && /^TO-\d+$/.test(body.group_id) && body.wo_ids.Repairs && body.wo_ids.Paint && body.wo_ids.Cleaning);
  t('exactly 3 WO rows were created', db.Work_Orders.rows.length === 3);

  const repairs = findWOById(db, body.wo_ids.Repairs);
  const paint = findWOById(db, body.wo_ids.Paint);
  const cleaning = findWOById(db, body.wo_ids.Cleaning);
  t('all 3 share the same Turnover_Group_ID', field(db, repairs,'Turnover_Group_ID') === body.group_id && field(db, paint,'Turnover_Group_ID') === body.group_id && field(db, cleaning,'Turnover_Group_ID') === body.group_id);
  t('Repairs is open (New), not blocked', field(db, repairs,'Status') === 'New');
  t('Paint is open (New), not blocked', field(db, paint,'Status') === 'New');
  t('Cleaning starts On Hold', field(db, cleaning,'Status') === 'On Hold');
  t('Cleaning has a Hold_Reason explaining why', /Repairs/.test(field(db, cleaning,'Hold_Reason') || '') );
  t('Cleaning release date is the day BEFORE the target move-in date', field(db, cleaning,'Turnover_Release_Date') === '2026-09-09');
  t('Repairs trade is General, Paint is Painting, Cleaning is Cleaning', field(db, repairs,'Trade')==='General' && field(db, paint,'Trade')==='Painting' && field(db, cleaning,'Trade')==='Cleaning');
  t('turnover WOs default to NOT tenant-visible (no tenant to show it to yet)', field(db, repairs,'Tenant_Visible')==='FALSE');
}

// ── 2. No target move-in date → no release date, Cleaning still On Hold ────────────────────
{
  const db = makeDb(); const callLog = [];
  const { createTurnoverWOs } = build(db, callLog);
  const res = await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1', source: 'manual' });
  const body = await res.json();
  const cleaning = findWOById(db, body.wo_ids.Cleaning);
  t('release_date is null when no target move-in date given', body.release_date === null);
  t('Turnover_Release_Date column is blank', (field(db, cleaning,'Turnover_Release_Date')||'') === '');
  t('Cleaning is still created On Hold (waits on Repairs+Paint only)', field(db, cleaning,'Status') === 'On Hold');
}

// ── 3. Idempotency — a unit with an active turnover rejects a second one ───────────────────
{
  const db = makeDb(); const callLog = [];
  const { createTurnoverWOs } = build(db, callLog);
  const first = await (await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1' })).json();
  const rowsAfterFirst = db.Work_Orders.rows.length;
  const second = await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1' });
  const secondBody = await second.json();
  t('second call is rejected (409-style error)', !!secondBody.error && secondBody.existing_group_id === first.group_id);
  t('no additional WOs were created by the rejected second call', db.Work_Orders.rows.length === rowsAfterFirst);
}

// ── 4. Idempotency does NOT block a NEW turnover once the old one is fully done ────────────
{
  const db = makeDb(); const callLog = [];
  const { createTurnoverWOs } = build(db, callLog);
  const first = await (await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1' })).json();
  for (const id of Object.values(first.wo_ids)) {
    const row = findWOById(db, id);
    row[WO_HEADERS.indexOf('Status')] = 'Complete';
  }
  const second = await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1' });
  const secondBody = await second.json();
  t('a second turnover is allowed once the first is fully Complete', secondBody.success === true && secondBody.group_id !== first.group_id);
}

// ── 5. releaseTurnoverCleaningIfReady — needs BOTH siblings done, not just one ─────────────
{
  const db = makeDb(); const callLog = [];
  const { createTurnoverWOs, releaseTurnoverCleaningIfReady } = build(db, callLog);
  const created = await (await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1' })).json();
  const repairsId = created.wo_ids.Repairs, cleaningId = created.wo_ids.Cleaning;

  findWOById(db, repairsId)[WO_HEADERS.indexOf('Status')] = 'Complete';
  await releaseTurnoverCleaningIfReady({ SHEET_ID: 'S' }, created.group_id);
  t('Cleaning stays On Hold with only ONE sibling done', field(db, findWOById(db, cleaningId), 'Status') === 'On Hold');

  findWOById(db, created.wo_ids.Paint)[WO_HEADERS.indexOf('Status')] = 'Complete';
  await releaseTurnoverCleaningIfReady({ SHEET_ID: 'S' }, created.group_id);
  const cleaningAfter = findWOById(db, cleaningId);
  t('Cleaning releases to New once BOTH Repairs and Paint are done', field(db, cleaningAfter, 'Status') === 'New');
  t('Hold_Reason is cleared on release', (field(db, cleaningAfter, 'Hold_Reason') || '') === '');
}

// ── 6. releaseTurnoverByDate — the date-fallback cron sweep ────────────────────────────────
{
  const db = makeDb(); const callLog = [];
  const { createTurnoverWOs, releaseTurnoverByDate } = build(db, callLog);
  const created = await (await createTurnoverWOs({ SHEET_ID: 'S' }, { unit_id: 'U-1', target_move_in_date: '2000-01-05' })).json(); // release date long past
  await releaseTurnoverByDate({ SHEET_ID: 'S' });
  const cleaning = findWOById(db, created.wo_ids.Cleaning);
  t('Cleaning releases by date even though Repairs/Paint are still open', field(db, cleaning, 'Status') === 'New');

  // A second unit whose release date is still in the future should NOT be touched.
  const db2 = makeDb(); const cl2 = [];
  const { createTurnoverWOs: c2, releaseTurnoverByDate: r2 } = build(db2, cl2);
  const created2 = await (await c2({ SHEET_ID: 'S' }, { unit_id: 'U-1', target_move_in_date: '2099-01-05' })).json();
  await r2({ SHEET_ID: 'S' });
  t('a future release date is left On Hold', field(db2, findWOById(db2, created2.wo_ids.Cleaning), 'Status') === 'On Hold');
}

// ── 7. scheduleMoveOutWithTurnover — books the date WITHOUT deactivating the tenant ────────
{
  const db = makeDb(); const callLog = [];
  const { scheduleMoveOutWithTurnover } = build(db, callLog);
  const res = await scheduleMoveOutWithTurnover({ SHEET_ID: 'S' }, { tenant_id: 'T-1', move_out_date: '2026-10-01', target_move_in_date: '2026-10-05', created_by: 'Admin' });
  const body = await res.json();
  t('reports success and started a turnover', body.success === true && body.turnover_created === true);
  const tenantRow = db.Tenants.rows.find(r => r[0] === 'T-1');
  const tHeaders = db.Tenants.headers;
  t('Scheduled_Move_Out_Date is set on the tenant', tenantRow[tHeaders.indexOf('Scheduled_Move_Out_Date')] === '2026-10-01');
  t('Tenant is NOT deactivated — still Active TRUE', tenantRow[tHeaders.indexOf('Active')] === 'TRUE');
  t('Tenant keeps their PIN — this is not the destructive move-out', tenantRow[tHeaders.indexOf('PIN')] === 'ABC12345');
  t('exactly 3 turnover WOs were created for this tenant\'s unit', db.Work_Orders.rows.length === 3);
}

// ── 8. dayBefore / nextTurnoverGroupId — small pure-function sanity checks ─────────────────
{
  const db = makeDb(); const callLog = [];
  const { dayBefore, nextTurnoverGroupId } = build(db, callLog);
  t('dayBefore steps back one calendar day', dayBefore('2026-03-01') === '2026-02-28');
  t('dayBefore of empty input is empty', dayBefore('') === '');
  t('nextTurnoverGroupId starts at TO-1001 with no prior groups', nextTurnoverGroupId([]) === 'TO-1001');
  t('nextTurnoverGroupId increments past the highest existing group', nextTurnoverGroupId([{Turnover_Group_ID:'TO-1001'},{Turnover_Group_ID:'TO-1004'},{Turnover_Group_ID:''}]) === 'TO-1005');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
