// Split Work Orders (Sep 22 2026 build) — offline tests for woSplit() and its lock helpers.
// Extracts the REAL functions verbatim out of worker.js and runs them against an in-memory fake
// Sheets backend, same convention/mock as test/wo-combine.test.mjs, so this test cannot quietly
// drift from what ships. woSplit() itself calls the real createWorkOrder()/updateWOFields()/
// woVoid()/smsGatedSend() (grabbed alongside it) so the numbering/rollback/SMS-gating behavior
// under test is exactly what the endpoint actually runs, not a re-implementation.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  let i = src.indexOf('(', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) { i++; break; } }
  }
  const open = src.indexOf('{', i);
  let bdepth = 0, j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') bdepth++;
    else if (src[j] === '}') { bdepth--; if (!bdepth) break; }
  }
  return src.slice(start, j + 1);
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

const cacheSrc               = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc                   = grab(wsrc, 'async function sheetsRequest(');
const ensureSrc               = grab(wsrc, 'async function ensureColumns(');
const ensureInnerSrc          = grab(wsrc, 'async function ensureColumnsInner(');
const ensureTabSrc            = grab(wsrc, 'async function ensureTab(');
const isMissingTabSrc         = grab(wsrc, 'function isMissingTabError(');
const idcSrc                  = grab(wsrc, 'function idColIndex(');
const colSrc                   = grab(wsrc, 'function col(index)') || grab(wsrc, 'function col(index');
const jsonSrc                  = grab(wsrc, 'function json(data');
const fetchTabSrc             = grab(wsrc, 'async function fetchTab(');
const findWOSrc               = grab(wsrc, 'function findWO(');
const updateWOFieldsSrc       = grab(wsrc, 'async function updateWOFields(');
const nextSafeIdSrc           = grab(wsrc, 'function nextSafeId(');
const logAuditSrc             = grab(wsrc, 'async function logWOAudit(');
const logAuditManySrc         = grab(wsrc, 'async function logWOAuditMany(');
const logMsgAuditSrc          = grab(wsrc, 'async function logMessageAudit(');
const reasonsSrc               = grabConst(wsrc, 'const WO_VOID_REASONS');
const columnsSrc               = grabConst(wsrc, 'const WO_VOID_COLUMNS');
const woVoidSrc                = grab(wsrc, 'async function woVoid(');
const woUnvoidSrc              = grab(wsrc, 'async function woUnvoid(');
const findRecentDupeSrc        = grab(wsrc, 'async function findRecentDuplicate(');
const addRowSrc                = grab(wsrc, 'async function addRow(');
const updateRowSrc             = grab(wsrc, 'async function updateRow(');
// Root cause fix for WO-1213/WO-1214 (rule 162 follow-up, Sep 23 2026) added a same-isolate
// synchronous claim that createWorkOrder now calls before its own dupe check — grab it
// alongside createWorkOrder itself, same convention turnover.test.mjs follows.
const claimCacheSrc            = grabRange(wsrc, 'const __woClaimCache = new Map();', 'async function createWorkOrder(');
const createWorkOrderSrc       = grab(wsrc, 'async function createWorkOrder(');
const splitOrigFieldsSrc       = grabConst(wsrc, 'const WO_SPLIT_ORIGINAL_FIELDS');
const splitMaxNewSrc           = grabConst(wsrc, 'const WO_SPLIT_MAX_NEW');
const timeEntryLockSrc         = grab(wsrc, 'function timeEntryReassignLock(');
const vendorBillLockSrc        = grab(wsrc, 'function vendorBillReassignLock(');
const woSplitSrc               = grab(wsrc, 'async function woSplit(');
const isTenantCurrentSrc       = grab(wsrc, 'function isTenantCurrent(');
const currentTenantSrc         = grab(wsrc, 'function currentTenantForDispatch(');
const isBackgroundWOSrc        = grab(wsrc, 'function isBackgroundWO(');
const isTenantNotifiableSrc    = grab(wsrc, 'function isTenantNotifiable(');
const smsGateDecisionSrc       = grab(wsrc, 'function smsGateDecision(');
const smsToggleOnSrc           = grabConst(wsrc, 'const smsToggleOn');
const normalizePhoneSrc        = grab(wsrc, 'function normalizePhone(');
const msgQueueTabSrc           = grabConst(wsrc, "const MSG_QUEUE_TAB = 'Message_Queue';");
const msgQueueColsSrc          = grabConst(wsrc, 'const MSG_QUEUE_COLS');
const smsInfraStateSrc         = grabRange(wsrc, "const SMS_TOGGLE_TABS", 'async function ensureSmsInfra');
const ensureSmsInfraSrc        = grab(wsrc, 'async function ensureSmsInfra(');
const etHourSrc                = grab(wsrc, 'function etHour(');
const quietHoursConstsSrc      = grabConst(wsrc, 'const QUIET_HOURS_START_ET') + '\n' + grabConst(wsrc, 'const QUIET_HOURS_END_ET');
const isQuietHoursSrc          = grab(wsrc, 'function isQuietHoursNow(');
const nextQuietHoursSrc        = grab(wsrc, 'function nextQuietHoursEnd(');
const nyOffsetMinutesSrc       = grab(wsrc, 'function nyOffsetMinutes(');
const fetchConfigSrc           = grab(wsrc, 'async function fetchConfig(');
const smsGatedSendSrc          = grab(wsrc, 'async function smsGatedSend(');
const updateMsgQueueRowSrc     = grab(wsrc, 'async function updateMessageQueueRow(');
const sendSMSRawSrc            = grab(wsrc, 'async function sendSMSRaw(');

// ── Pure lock-helper tests — no Sheets involved ──────────────────────────────────────────────
{
  const src = timeEntryLockSrc + '\n' + vendorBillLockSrc + '\nreturn { timeEntryReassignLock, vendorBillReassignLock };';
  const { timeEntryReassignLock, vendorBillReassignLock } = new Function(src)();

  t('a time entry with no Bill_ID is unlocked', timeEntryReassignLock({ Bill_ID: '' }, []) === null);
  t('a time entry linked to a LIVE bill is locked', timeEntryReassignLock({ Bill_ID: 'B1' }, [{ ID: 'B1', Active: 'TRUE' }]) !== null);
  t('a time entry linked to a VOIDED bill is unlocked (freed, same as listTimeEntries convention)', timeEntryReassignLock({ Bill_ID: 'B1' }, [{ ID: 'B1', Active: 'FALSE' }]) === null);
  t('a time entry linked to a bill that no longer resolves is unlocked', timeEntryReassignLock({ Bill_ID: 'B9' }, [{ ID: 'B1', Active: 'TRUE' }]) === null);

  t('an inactive/voided bill is locked', vendorBillReassignLock({ Active: 'FALSE', Status: 'submitted' }, []) !== null);
  t('a reviewed bill is locked', vendorBillReassignLock({ Active: 'TRUE', Status: 'reviewed', ID: 'B1' }, []) !== null);
  t('a plain submitted+active bill with no QB linkage is unlocked', vendorBillReassignLock({ Active: 'TRUE', Status: 'submitted', ID: 'B1' }, []) === null);
  t('a bill already sent to QuickBooks (live Invoice_Review row w/ QB_Invoice_ID) is locked',
    vendorBillReassignLock({ Active: 'TRUE', Status: 'submitted', ID: 'B1' }, [{ Active: 'TRUE', Bill_ID: 'B1', QB_Invoice_ID: 'INV-1' }]) !== null);
  t('an Invoice_Review row for a DIFFERENT bill does not lock this one',
    vendorBillReassignLock({ Active: 'TRUE', Status: 'submitted', ID: 'B1' }, [{ Active: 'TRUE', Bill_ID: 'B2', QB_Invoice_ID: 'INV-1' }]) === null);
}

// ── woSplit() integration — in-memory fake Sheets backend ───────────────────────────────────
const WO_HEADERS = ['ID','Property_ID','Unit_ID','Tenant_ID','Vendor_ID','Type','Trade','Description','Priority','Status',
  'Scheduled_Date','Scheduled_Window','Completed_Date','Invoice_ID','Owner_WO_Ref','WO_Contact_Name','WO_Contact_Phone',
  'Tenant_Visible','Tenant_Notify_Created','Tenant_Notify_Updates','Vendor_SMS_Sent','Tenant_SMS_Sent','Owner_Notified',
  'Created_By','Created_Date','Notes','Room','Vendor_Needs_Access','Checklist','Managed_By',
  'Voided','Void_Reason','Void_Reason_Detail','Void_Combined_Into_WO_ID','Voided_By','Voided_Date'];
const AUDIT_HEADERS = ['ID','WO_ID','Changed_By','Changed_By_Role','Field','Old_Value','New_Value','Timestamp','Notes',
  'Channel','Recipient_Name','Recipient_Type','Message_Type','Message_Body','Outcome'];
const TENANT_HEADERS = ['ID','Property_ID','Unit_ID','First_Name','Last_Name','Phone','Active','Move_In_Date','Move_Out_Date','SMS_Enabled','SMS_OptOut'];
const OWNER_HEADERS = ['ID','First_Name','Last_Name','Phone','SMS_Enabled'];
const PROPERTY_HEADERS = ['ID','Owner_ID','Address','SMS_Enabled'];
const UNIT_HEADERS = ['ID','Property_ID','Unit_Label','Tenant_ID'];
const VENDOR_HEADERS = ['ID','Name','Phone','SMS_Enabled','SMS_OptOut'];
const TIME_ENTRY_HEADERS = ['ID','WO_ID','Hours','Bill_ID','Active','Created_Date','Entered_By','Role','Entered_By_ID'];
const VENDOR_BILL_HEADERS = ['ID','WO_ID','Vendor_ID','Vendor_Name','Total','Status','Active','Created_Date'];
const INVOICE_REVIEW_HEADERS = ['ID','Bill_ID','WO_ID','Active','QB_Invoice_ID'];
const MSGQ_HEADERS = ['ID','WO_ID','Message_Type','Recipient_Type','Recipient_Name','Recipient_Phone','Property_ID','Property_Address','Message_Body','Status','Delivered_To','Gate_Snapshot','Created_Date','Sent_Date','Twilio_Message_SID','Active','Send_After'];

function makeDb(wos, extra = {}) {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: wos.map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    WO_Audit: { headers: AUDIT_HEADERS.slice(), rows: [] },
    WO_Tenants: { headers: ['ID','WO_ID','Tenant_ID'], rows: [] },
    Tenants: { headers: TENANT_HEADERS.slice(), rows: (extra.tenants || []).map(r => TENANT_HEADERS.map(h => r[h] ?? '')) },
    Owners: { headers: OWNER_HEADERS.slice(), rows: (extra.owners || []).map(r => OWNER_HEADERS.map(h => r[h] ?? '')) },
    Properties: { headers: PROPERTY_HEADERS.slice(), rows: (extra.properties || []).map(r => PROPERTY_HEADERS.map(h => r[h] ?? '')) },
    Units: { headers: UNIT_HEADERS.slice(), rows: (extra.units || []).map(r => UNIT_HEADERS.map(h => r[h] ?? '')) },
    Vendors: { headers: VENDOR_HEADERS.slice(), rows: [] },
    Time_Entries: { headers: TIME_ENTRY_HEADERS.slice(), rows: (extra.timeEntries || []).map(r => TIME_ENTRY_HEADERS.map(h => r[h] ?? '')) },
    Vendor_Bills: { headers: VENDOR_BILL_HEADERS.slice(), rows: (extra.vendorBills || []).map(r => VENDOR_BILL_HEADERS.map(h => r[h] ?? '')) },
    Invoice_Review: { headers: INVOICE_REVIEW_HEADERS.slice(), rows: (extra.invoiceReview || []).map(r => INVOICE_REVIEW_HEADERS.map(h => r[h] ?? '')) },
    Message_Queue: { headers: MSGQ_HEADERS.slice(), rows: [] },
    Config: { headers: ['Key','Value'], rows: Object.entries(extra.config || {}).map(([k, v]) => [k, v]) },
  };
}

function makeFetch(db, opts = {}) {
  return async (url, fopts) => {
    if (/api\.twilio\.com/.test(url)) {
      if (!opts.allowTwilio) throw new Error('unexpected real Twilio call in a test — staging guard failed');
      return { json: async () => ({ sid: 'SM_TEST_FAKE_SID' }) };
    }
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0];
    const method = fopts.method;
    if (opts.throwOnWrite && opts.throwOnWrite(path, method, fopts.body)) {
      throw new Error('injected failure: ' + method + ' ' + path);
    }
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      const body = JSON.parse(fopts.body);
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
      const body = JSON.parse(fopts.body);
      if (!db[m2[1]]) db[m2[1]] = { headers: [], rows: [] };
      db[m2[1]].rows.push(...body.values);
      return { json: async () => ({}) };
    }
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

function build(db, fetchOpts) {
  const src = [
    'const CORS = {};',
    cacheSrc, isMissingTabSrc, srSrc, ensureInnerSrc, ensureSrc, ensureTabSrc,
    idcSrc, colSrc, jsonSrc, fetchTabSrc, findWOSrc,
    updateWOFieldsSrc, nextSafeIdSrc, logAuditSrc, logAuditManySrc, logMsgAuditSrc,
    reasonsSrc, columnsSrc, woVoidSrc, woUnvoidSrc,
    findRecentDupeSrc, claimCacheSrc, addRowSrc, updateRowSrc, createWorkOrderSrc,
    splitOrigFieldsSrc, splitMaxNewSrc, timeEntryLockSrc, vendorBillLockSrc, woSplitSrc,
    isTenantCurrentSrc, currentTenantSrc, isBackgroundWOSrc, isTenantNotifiableSrc,
    smsGateDecisionSrc, smsToggleOnSrc, normalizePhoneSrc,
    msgQueueTabSrc, msgQueueColsSrc, smsInfraStateSrc, ensureSmsInfraSrc,
    etHourSrc, nyOffsetMinutesSrc, quietHoursConstsSrc, isQuietHoursSrc, nextQuietHoursSrc, sendSMSRawSrc, updateMsgQueueRowSrc, fetchConfigSrc, smsGatedSendSrc,
    'return { woVoid, woUnvoid, woSplit, createWorkOrder, smsGatedSend };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db, fetchOpts), (fn) => fn());
}

function row(db, tab, id) { return db[tab].rows.find(r => r[0] === id); }
function field(headers, name, r) { const i = headers.indexOf(name); return r ? r[i] : undefined; }
const wf = (db, id, name) => field(WO_HEADERS, name, row(db, 'Work_Orders', id));

console.log('Split Work Orders — offline tests\n');
const env = { SHEET_ID: 'S', __STAGING__: true };

// ── 1. Validation ─────────────────────────────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1' }]);
  const { woSplit } = build(db);
  const res = await woSplit(env, { original_wo_id: '', new_work_orders: [{}] });
  t('missing original_wo_id is rejected', res.status === 400);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1' }]);
  const { woSplit } = build(db);
  const res = await woSplit(env, { original_wo_id: 'WO-1', new_work_orders: [] });
  t('empty new_work_orders is rejected', res.status === 400);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1' }]);
  const { woSplit } = build(db);
  const many = Array.from({ length: 11 }, () => ({ Description: 'x' }));
  const res = await woSplit(env, { original_wo_id: 'WO-1', new_work_orders: many });
  t('more than 10 new work orders is rejected', res.status === 400);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1' }]);
  const { woSplit } = build(db);
  const res = await woSplit(env, { original_wo_id: 'WO-9999', new_work_orders: [{ Description: 'x' }] });
  t('missing original WO 404s', res.status === 404);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1', Voided: 'TRUE' }]);
  const { woSplit } = build(db);
  const res = await woSplit(env, { original_wo_id: 'WO-1', new_work_orders: [{ Description: 'x' }] });
  t('a voided original cannot be split', res.status === 400);
}

// ── 2. Happy path: inheritance, per-new-WO fields, original stays, description independence ──
{
  const db = makeDb([
    { ID: 'WO-100', Property_ID: '76', Unit_ID: 'U1', Tenant_ID: 'T1', Trade: 'Plumbing', Priority: 'urgent',
      Description: 'Leak under both sinks and the water heater is making noise', Status: 'New', Managed_By: 'RidgeCo' },
  ]);
  const { woSplit } = build(db);
  const res = await woSplit(env, {
    original_wo_id: 'WO-100',
    original_overrides: { Description: 'Leak under the kitchen sink only' },
    new_work_orders: [
      { Trade: 'Plumbing', Priority: 'normal', Description: 'Leak under the bathroom sink', Managed_By: 'RidgeCo' },
      { Trade: 'HVAC', Priority: 'urgent', Description: 'Water heater making noise', Vendor_ID: 'V9' },
    ],
    updated_by: 'Brett',
  });
  const body = await res.json();
  t('split succeeds', body.success === true);
  t('creates exactly 2 new WOs', body.new_wo_ids.length === 2);
  const [newA, newB] = body.new_wo_ids;
  t('new WO A inherits Property_ID from original', wf(db, newA, 'Property_ID') === '76');
  t('new WO A inherits Unit_ID from original', wf(db, newA, 'Unit_ID') === 'U1');
  t('new WO A inherits Tenant_ID from original', wf(db, newA, 'Tenant_ID') === 'T1');
  t('new WO A gets its OWN Trade', wf(db, newA, 'Trade') === 'Plumbing');
  t('new WO B gets a DIFFERENT Trade', wf(db, newB, 'Trade') === 'HVAC');
  t('new WO B gets its own Vendor_ID', wf(db, newB, 'Vendor_ID') === 'V9');
  t('new WO A has no vendor (left unassigned, same as normal WO creation)', wf(db, newA, 'Vendor_ID') === '');
  t("new WO A's description is its OWN, not the original's full text", wf(db, newA, 'Description') === 'Leak under the bathroom sink');
  t("new WO B's description is independently different from A's", wf(db, newB, 'Description') === 'Water heater making noise');
  t("the original's own description was independently trimmed via original_overrides", wf(db, 'WO-100', 'Description') === 'Leak under the kitchen sink only');
  t('the original is untouched on fields with no override (Trade)', wf(db, 'WO-100', 'Trade') === 'Plumbing');
  t('an audit row exists on the original naming both new WOs', db.WO_Audit.rows.some(r => r[1] === 'WO-100' && r[4] === 'Split' && r[8].includes(newA) && r[8].includes(newB)));
  t('an audit row exists on each new WO naming the original', db.WO_Audit.rows.some(r => r[1] === newA && /from WO-100/.test(r[8])) && db.WO_Audit.rows.some(r => r[1] === newB && /from WO-100/.test(r[8])));
}

// ── 3. Two new WOs with IDENTICAL trade+description don't collide into the same WO id ────────
{
  const db = makeDb([
    { ID: 'WO-200', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'Fix the leak', Status: 'New' },
  ]);
  const { woSplit } = build(db);
  const res = await woSplit(env, {
    original_wo_id: 'WO-200',
    new_work_orders: [
      { Trade: 'Plumbing', Description: 'Fix the leak' }, // identical to the original — pre-fill left unedited
      { Trade: 'Plumbing', Description: 'Fix the leak' }, // both new WOs left identical too
    ],
  });
  const body = await res.json();
  t('split with two identical-content new WOs still succeeds', body.success === true);
  t('two DISTINCT WO ids are created, not collapsed by the createWorkOrder double-tap dupe guard', new Set(body.new_wo_ids).size === 2);
  t('both new WOs end up with the exact requested (marker-free) description', wf(db, body.new_wo_ids[0], 'Description') === 'Fix the leak' && wf(db, body.new_wo_ids[1], 'Description') === 'Fix the leak');
}

// ── 4. Reassignments: time entries + vendor bills, targeting original and new WOs ────────────
{
  const db = makeDb([
    { ID: 'WO-300', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'Two visits worth of work', Status: 'New' },
  ], {
    timeEntries: [
      { ID: 'TE-1', WO_ID: 'WO-300', Hours: '2', Bill_ID: '', Active: 'TRUE' },
      { ID: 'TE-2', WO_ID: 'WO-300', Hours: '3', Bill_ID: '', Active: 'TRUE' },
    ],
    vendorBills: [
      { ID: 'VB-1', WO_ID: 'WO-300', Vendor_ID: 'V1', Total: '150', Status: 'submitted', Active: 'TRUE' },
    ],
  });
  const { woSplit } = build(db);
  const res = await woSplit(env, {
    original_wo_id: 'WO-300',
    new_work_orders: [{ Trade: 'Plumbing', Description: 'Second visit' }],
    reassignments: [
      { type: 'time_entry', id: 'TE-2', target: 0 },
      { type: 'vendor_bill', id: 'VB-1', target: 'original' },
    ],
  });
  const body = await res.json();
  t('split with reassignments succeeds', body.success === true);
  const newId = body.new_wo_ids[0];
  t('TE-1 (not reassigned) stays on the original', field(TIME_ENTRY_HEADERS, 'WO_ID', row(db, 'Time_Entries', 'TE-1')) === 'WO-300');
  t('TE-2 moved to the new WO', field(TIME_ENTRY_HEADERS, 'WO_ID', row(db, 'Time_Entries', 'TE-2')) === newId);
  t("VB-1 explicitly targeted 'original' stays put", field(VENDOR_BILL_HEADERS, 'WO_ID', row(db, 'Vendor_Bills', 'VB-1')) === 'WO-300');
}

// ── 5. Locked time entry / vendor bill reassignment is blocked with a reason, nothing created ─
{
  const db = makeDb([
    { ID: 'WO-400', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'x', Status: 'New' },
  ], {
    timeEntries: [{ ID: 'TE-9', WO_ID: 'WO-400', Hours: '1', Bill_ID: 'VB-9', Active: 'TRUE' }],
    vendorBills: [{ ID: 'VB-9', WO_ID: 'WO-400', Vendor_ID: 'V1', Total: '90', Status: 'submitted', Active: 'TRUE' }],
  });
  const { woSplit } = build(db);
  const res = await woSplit(env, {
    original_wo_id: 'WO-400',
    new_work_orders: [{ Trade: 'Plumbing', Description: 'y' }],
    reassignments: [{ type: 'time_entry', id: 'TE-9', target: 0 }],
  });
  const body = await res.json();
  t('a locked (already-billed) time entry reassignment is refused with reassign_locked', res.status === 409 && body.error === 'reassign_locked');
  t('no new WO was created — validation happens before anything is created', db.Work_Orders.rows.length === 1);
}
{
  const db = makeDb([
    { ID: 'WO-410', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'x', Status: 'New' },
  ], {
    vendorBills: [{ ID: 'VB-10', WO_ID: 'WO-410', Vendor_ID: 'V1', Total: '90', Status: 'reviewed', Active: 'TRUE' }],
  });
  const { woSplit } = build(db);
  const res = await woSplit(env, {
    original_wo_id: 'WO-410',
    new_work_orders: [{ Trade: 'Plumbing', Description: 'y' }],
    reassignments: [{ type: 'vendor_bill', id: 'VB-10', target: 0 }],
  });
  const body = await res.json();
  t('a reviewed/approved vendor bill reassignment is refused', res.status === 409 && body.error === 'reassign_locked' && body.type === 'vendor_bill');
  t('no new WO was created for the reviewed-bill case either', db.Work_Orders.rows.length === 1);
}

// ── 6. Rollback on partial failure ────────────────────────────────────────────────────────────
{
  const db = makeDb([
    { ID: 'WO-500', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Priority: 'normal', Description: 'keep', Status: 'New' },
  ], {
    timeEntries: [{ ID: 'TE-5', WO_ID: 'WO-500', Hours: '1', Bill_ID: '', Active: 'TRUE' }],
  });
  // Force the SECOND new-WO's post-create updateWOFields (Vendor_ID) to throw, simulating a
  // Sheets error mid-batch, so at least one WO is fully created before the failure.
  const { woSplit } = build(db, {
    throwOnWrite: (path, method, bodyStr) => {
      if (method !== 'POST' || path !== '/values:batchUpdate') return false;
      const b = JSON.parse(bodyStr);
      // Fires only on the write that stamps the marker Vendor_ID value onto the SECOND new
      // WO's post-create updateWOFields call — the first new WO (and its own post-create
      // writes) and the original's own writes are all unaffected.
      return b.data.some(d => d.values && d.values[0] && d.values[0][0] === 'V-FORCES-ROW3-WRITE');
    },
  });
  const res = await woSplit(env, {
    original_wo_id: 'WO-500',
    original_overrides: { Priority: 'urgent' },
    new_work_orders: [
      { Trade: 'Plumbing', Description: 'first' },
      { Trade: 'Plumbing', Description: 'second', Vendor_ID: 'V-FORCES-ROW3-WRITE' },
    ],
    reassignments: [{ type: 'time_entry', id: 'TE-5', target: 0 }],
    updated_by: 'Brett',
  });
  const body = await res.json();
  t('a partial failure is reported as split_failed with rolled_back:true', res.status === 500 && body.error === 'split_failed' && body.rolled_back === true);
  t("the original's Priority was restored to its ORIGINAL value, not left at the override", wf(db, 'WO-500', 'Priority') === 'normal');
  t('TE-5 was restored back onto the original (reassignment undone)', field(TIME_ENTRY_HEADERS, 'WO_ID', row(db, 'Time_Entries', 'TE-5')) === 'WO-500');
  t('every created WO ended up voided (rolled back) rather than left live and unaccounted for',
    body.created_then_rolled_back.every(id => wf(db, id, 'Voided') === 'TRUE'));
}

// ── 7. Tenant SMS — gated on the ORIGINAL's own (post-override) Tenant_Notify_Updates ────────
{
  const props = [{ ID: '76', Owner_ID: 'O1', Address: '123 Main St', SMS_Enabled: 'TRUE' }];
  const owners = [{ ID: 'O1', First_Name: 'Owen', Phone: '4105550100', SMS_Enabled: 'TRUE' }];
  const units = [{ ID: 'U1', Property_ID: '76', Unit_Label: '2A', Tenant_ID: 'T1' }];
  const tenants = [{ ID: 'T1', Property_ID: '76', Unit_ID: 'U1', First_Name: 'Tam', Last_Name: 'T', Phone: '4105550101', Active: 'TRUE', SMS_Enabled: 'TRUE', SMS_OptOut: 'FALSE' }];
  const baseConfig = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'TRUE' };

  // 7a. All gates open, original's own Tenant_Notify_Updates blank (=on) -> one SMS actually sent.
  {
    const db = makeDb([
      { ID: 'WO-600', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'x', Tenant_Notify_Updates: '' },
    ], { properties: props, owners, units, tenants, config: baseConfig });
    const liveEnv = { SHEET_ID: 'S', __STAGING__: false, TWILIO_SID: 'AC_TEST', TWILIO_API_SID: 'SK_TEST', TWILIO_API_KEY: 'secret', TWILIO_FROM: '+14105551234' };
    const { woSplit } = build(db, { allowTwilio: true });
    const res = await woSplit(liveEnv, { original_wo_id: 'WO-600', new_work_orders: [{ Trade: 'Plumbing', Description: 'y' }, { Trade: 'HVAC', Description: 'z' }] });
    const body = await res.json();
    t('split with all gates open succeeds', body.success === true);
    const mq = db.Message_Queue.rows;
    t('exactly ONE Message_Queue row was written for the split (not one per new WO)', mq.filter(r => r[2] === 'tenant_wo_split').length === 1);
    const splitRow = mq.find(r => r[2] === 'tenant_wo_split');
    t('the split SMS names the original and both new WO ids', new RegExp(body.new_wo_ids[0]).test(splitRow[8]) && new RegExp(body.new_wo_ids[1]).test(splitRow[8]) && /WO-600/.test(splitRow[8]));
    t('the split SMS was actually sent (gate open, real send path exercised)', splitRow[9] === 'sent' && splitRow[14] === 'SM_TEST_FAKE_SID');
  }

  // 7b. The original's own Tenant_Notify_Updates is explicitly FALSE -> no split SMS at all,
  //     even though every gate (Global/Property/Owner/Tenant) is otherwise open. Tenant_Notify_
  //     Updates is not one of the fields Split's original_overrides ever touches (Trade/
  //     Priority/Vendor_ID/Scheduled_Date/Managed_By/Description only), so this exercises the
  //     gate exactly as it's actually read: the original's real current value.
  {
    const db = makeDb([
      { ID: 'WO-610', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'x', Tenant_Notify_Updates: 'FALSE' },
    ], { properties: props, owners, units, tenants, config: baseConfig });
    const { woSplit } = build(db);
    const res = await woSplit(env, {
      original_wo_id: 'WO-610',
      new_work_orders: [{ Trade: 'Plumbing', Description: 'y' }],
    });
    const body = await res.json();
    t('split still succeeds even though the split SMS is blocked', body.success === true);
    t('no tenant_wo_split row was written', !db.Message_Queue.rows.some(r => r[2] === 'tenant_wo_split'));
  }

  // 7c. Global Twilio kill switch OFF -> queued but never sent, same hierarchy as every other
  //     tenant SMS — proving the split SMS is not a bypass.
  {
    const db = makeDb([
      { ID: 'WO-620', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'x', Tenant_Notify_Updates: '' },
    ], { properties: props, owners, units, tenants, config: { TWILIO_ENABLED: 'FALSE', TWILIO_TEST_MODE: 'TRUE' } });
    const { woSplit } = build(db);
    const res = await woSplit(env, { original_wo_id: 'WO-620', new_work_orders: [{ Trade: 'Plumbing', Description: 'y' }] });
    const body = await res.json();
    t('split succeeds even though Global SMS is off', body.success === true);
    const splitRow = db.Message_Queue.rows.find(r => r[2] === 'tenant_wo_split');
    t('a Message_Queue row is still written (queue-write-first, same as every other gated send)', !!splitRow);
    t('but never actually sent — Global OFF blocks it exactly like any other tenant SMS', splitRow[9] !== 'sent' && /Global OFF/.test(splitRow[11]));
  }
}

// ── 8. Ordinary createWorkOrder / /wo/void paths are unaffected ─────────────────────────────
{
  const db = makeDb([]);
  const { createWorkOrder, woVoid } = build(db);
  const res = await createWorkOrder(env, { property_id: '76', unit_id: 'U1', trade: 'Plumbing', description: 'Normal create, unrelated to Split' });
  const body = await res.json();
  t('a normal createWorkOrder call still works exactly as before', body.success === true && !!body.id);
  const voidRes = await woVoid(env, { wo_id: body.id, reason: 'Duplicate', updated_by: 'Brett' });
  const voidBody = await voidRes.json();
  t('a normal /wo/void call on a Split-unrelated WO still works exactly as before', voidBody.success === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
