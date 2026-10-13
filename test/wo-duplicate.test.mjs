// Duplicate Work Order + bid groups (Oct 12 2026 build) — offline tests.
// Extracts the REAL functions verbatim out of worker.js and runs them against an in-memory fake
// Sheets backend (same convention as test/wo-split.test.mjs), so this cannot drift from what ships.
// The clock is PINNED (a fake Date is injected into the evaluated code) so the quiet-hours cases do
// not depend on what time of day the suite runs.
import fs from 'fs';
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')') { depth--; if (!depth) { i++; break; } } }
  const open = src.indexOf('{', i);
  let b = 0, j = open;
  for (; j < src.length; j++) { if (src[j] === '{') b++; else if (src[j] === '}') { b--; if (!b) break; } }
  return src.slice(start, j + 1);
}
function grabRange(src, startSig, endSig) {
  const start = src.indexOf(startSig); if (start < 0) throw new Error('not found: ' + startSig);
  const end = src.indexOf(endSig, start); if (end < 0) throw new Error('end not found: ' + endSig);
  return src.slice(start, end);
}
function grabConst(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  return src.slice(start, src.indexOf(';', start) + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n); } };

const S = {
  cache: grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads'),
  sr: grab(wsrc, 'async function sheetsRequest('), ensure: grab(wsrc, 'async function ensureColumns('), ensureInner: grab(wsrc, 'async function ensureColumnsInner('),
  ensureTab: grab(wsrc, 'async function ensureTab('), isMissing: grab(wsrc, 'function isMissingTabError('), idc: grab(wsrc, 'function idColIndex('),
  col: grab(wsrc, 'function col(index'), json: grab(wsrc, 'function json(data'), fetchTab: grab(wsrc, 'async function fetchTab('), fetchTabs: grab(wsrc, 'async function fetchTabs('),
  findWO: grab(wsrc, 'function findWO('), updateWOFields: grab(wsrc, 'async function updateWOFields('), nextSafeId: grab(wsrc, 'function nextSafeId('),
  logAudit: grab(wsrc, 'async function logWOAudit('), logAuditMany: grab(wsrc, 'async function logWOAuditMany('), logMsgAudit: grab(wsrc, 'async function logMessageAudit('),
  auditCols: grabConst(wsrc, 'const WO_AUDIT_MSG_COLS'), addRow: grab(wsrc, 'async function addRow('), invalidate: grab(wsrc, 'function invalidateTabCache('),
  telemetry: grabConst(wsrc, "const TELEMETRY_TAB") + '\n' + grabConst(wsrc, 'const TELEMETRY_COLS') + '\nlet _telemetryTabReady = false;\n' + grab(wsrc, 'async function logTelemetry('),
  nonShare: grabConst(wsrc, 'const NON_SHARE_FILE_TYPES'),
  block: grabRange(wsrc, 'const WO_DUP_ALLOWED_STATUSES', 'async function assignVendor('),
  assign: grab(wsrc, 'async function assignVendor('), updateStatus: grab(wsrc, 'async function updateStatus('),
  addonLive: grab(wsrc, 'function addonLiveChildren(') + '\n' + grab(wsrc, 'function addonLiveChildrenMessage('),
  isTenantCurrent: grab(wsrc, 'function isTenantCurrent('), currentTenant: grab(wsrc, 'function currentTenantForDispatch('), tenantsFor: grab(wsrc, 'function tenantsForDispatch('),
  isBackground: grab(wsrc, 'function isBackgroundWO('), isNotifiable: grab(wsrc, 'function isTenantNotifiable('),
  smsGate: grab(wsrc, 'function smsGateDecision('), smsToggle: grabConst(wsrc, 'const smsToggleOn'), normPhone: grab(wsrc, 'function normalizePhone('),
  mqTab: grabConst(wsrc, "const MSG_QUEUE_TAB = 'Message_Queue';"), mqCols: grabConst(wsrc, 'const MSG_QUEUE_COLS'),
  smsInfraState: grabRange(wsrc, 'const SMS_TOGGLE_TABS', 'async function ensureSmsInfra'), smsInfra: grab(wsrc, 'async function ensureSmsInfra('),
  etHour: grab(wsrc, 'function etHour('), nyOff: grab(wsrc, 'function nyOffsetMinutes('),
  quietConsts: grabConst(wsrc, 'const QUIET_HOURS_START_ET') + '\n' + grabConst(wsrc, 'const QUIET_HOURS_END_ET'),
  isQuiet: grab(wsrc, 'function isQuietHoursNow('), nextQuiet: grab(wsrc, 'function nextQuietHoursEnd('),
  sendRaw: grab(wsrc, 'async function sendSMSRaw('), updMq: grab(wsrc, 'async function updateMessageQueueRow('), fetchConfig: grab(wsrc, 'async function fetchConfig('),
  smsGated: grab(wsrc, 'async function smsGatedSend('),
  portalLink: grab(wsrc, 'function vendorPortalLink('), unitLabel: grab(wsrc, 'function formatUnitLabel('), phoneDisp: grab(wsrc, 'function formatPhoneDisplay('), jobLabel: grab(wsrc, 'function woJobLabel('),
  ownerWOs: grab(wsrc, 'async function ownerWorkorders('), woCombine: grab(wsrc, 'async function woCombine('), woSplit: grab(wsrc, 'async function woSplit('),
  voidCols: grabConst(wsrc, 'const WO_VOID_COLUMNS'), splitMax: grabConst(wsrc, 'const WO_SPLIT_MAX_NEW'), splitFields: grabConst(wsrc, 'const WO_SPLIT_ORIGINAL_FIELDS'),
  hubGuard: grab(wsrc, 'async function hubTestWriteAllowed('), isTestWO: grab(wsrc, 'async function isTestWO('), isTestRecord: grab(wsrc, 'async function isTestRecord('),
  testMarker: grabConst(wsrc, 'const TEST_MARKER_FIELD'), openStatuses: grabConst(wsrc, 'const OPEN_WO_STATUSES'),
};

const WO_HEADERS = ['Vendor_Needs_Access', 'ID', 'Property_ID', 'Unit_ID', 'Tenant_ID', 'Vendor_ID', 'Type', 'Trade', 'Description', 'Priority', 'Status',
  'Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Invoice_ID', 'Owner_WO_Ref', 'WO_Contact_Name', 'WO_Contact_Phone',
  'Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Vendor_SMS_Sent', 'Tenant_SMS_Sent', 'Owner_Notified',
  'Created_By', 'Created_Date', 'Notes', 'Room', 'QBO_Invoice_Number', 'QBO_Bill_Number', 'Customer_Charge', 'Deposit_Amount', 'Deposit_QB_Bill_Number',
  'Scope_ID', 'Approval_Stage', 'Estimate_Revised', 'Current_Estimate', 'Hold_Reason', 'Drive_Folder_ID', 'Drive_Folder_URL', 'Parent_WO_ID',
  'Intake_Message_ID', 'Source', 'Turnover_Group_ID',
  'Voided', 'Void_Reason', 'Void_Reason_Detail', 'Void_Combined_Into_WO_ID', 'Voided_By', 'Voided_Date',
  // NOTE: Checklist, Managed_By, Entry_Notes, Owner_Notes, Vendor_Admin_Notes, Admin_Notes, Bid_Group_ID, Duplicated_From and
  // Owner_Notify_Override are deliberately MISSING here — the prod sheet lacks the last three, and ensureColumns must add them.
];
const AUDIT_HEADERS = ['ID', 'WO_ID', 'Changed_By', 'Changed_By_Role', 'Field', 'Old_Value', 'New_Value', 'Timestamp', 'Notes', 'Channel', 'Recipient_Name', 'Recipient_Type', 'Message_Type', 'Message_Body', 'Outcome', 'Original_Body', 'Translated_To'];
const H = {
  WO_Tenants: ['ID', 'WO_ID', 'Tenant_ID', 'Tenant_Name', 'Tenant_Phone', 'Added_By', 'Added_Date', 'Active'],
  Tenants: ['ID', 'Property_ID', 'Unit_ID', 'First_Name', 'Last_Name', 'Phone', 'Active', 'Move_In_Date', 'Move_Out_Date', 'SMS_Enabled', 'SMS_OptOut'],
  Owners: ['ID', 'First_Name', 'Last_Name', 'Phone', 'SMS_Enabled'], Properties: ['ID', 'Owner_ID', 'Address', 'SMS_Enabled', 'Access_Notes'],
  Units: ['ID', 'Property_ID', 'Unit_Label', 'Tenant_ID'], Vendors: ['ID', 'Name', 'Phone', 'SMS_Enabled', 'SMS_OptOut', 'Language', 'Active'],
  Time_Entries: ['ID', 'WO_ID', 'Active'], Vendor_Bills: ['ID', 'WO_ID', 'Active', 'Status'], Invoice_Review: ['ID', 'WO_ID', 'Bill_ID', 'Active'],
  Message_Queue: ['ID', 'WO_ID', 'Message_Type', 'Recipient_Type', 'Recipient_Name', 'Recipient_Phone', 'Property_ID', 'Property_Address', 'Message_Body', 'Status', 'Delivered_To', 'Gate_Snapshot', 'Created_Date', 'Sent_Date', 'Twilio_Message_SID', 'Active', 'Send_After', 'Original_Body', 'Translated_To'],
  Attachments: ['ID', 'WO_ID', 'Invoice_ID', 'File_Type', 'Drive_File_ID', 'Drive_URL', 'File_Name', 'Uploaded_By', 'Created_Date', 'Notes', 'Active', 'Mime_Type', 'Receipt_ID'],
  Estimates: ['ID', 'WO_ID', 'Vendor_ID', 'Version', 'Subtotal', 'Status', 'Active'], Config: ['Key', 'Value'], Ops_Telemetry: ['ID', 'Timestamp', 'Source', 'Session_Id', 'Job_Type', 'Skill_Or_Endpoint', 'Tier_Requested', 'Model_Used', 'Escalated', 'Tokens_In', 'Tokens_Out', 'Est_Cost', 'Latency_ms', 'Success', 'Confidence', 'Human_Corrected', 'Notes'],
};
const toRows = (hdr, list) => (list || []).map(r => hdr.map(h => r[h] ?? ''));

function makeDb(x = {}) {
  const db = {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: toRows(WO_HEADERS, x.wos) }, WO_Audit: { headers: AUDIT_HEADERS.slice(), rows: [] },
  };
  for (const k of Object.keys(H)) db[k] = { headers: H[k].slice(), rows: toRows(H[k], x[k]) };
  if (x.config) db.Config.rows = Object.entries(x.config).map(([k, v]) => [k, v]);
  return db;
}

function makeFetch(db, opts, log) {
  return async (url, fopts) => {
    if (/api\.twilio\.com/.test(url)) {
      log.twilio.push(String(fopts.body || ''));
      if (!opts.allowTwilio) throw new Error('unexpected real Twilio call in a test');
      return { json: async () => ({ sid: 'SM_FAKE' + log.twilio.length }) };
    }
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0], method = fopts.method;
    if (opts.throwOnWrite && opts.throwOnWrite(path, method, fopts.body, db)) throw new Error('injected failure: ' + method + ' ' + path);
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows.map(r => r.slice())] }) };
    }
    if (method === 'GET' && path === '/values:batchGet') {
      const names = [...full.matchAll(/ranges=([^&]+)/g)].map(x => decodeURIComponent(x[1]));
      return { json: async () => ({ valueRanges: names.map(n => ({ values: db[n] ? [db[n].headers, ...db[n].rows.map(r => r.slice())] : [] })) }) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      const body = JSON.parse(fopts.body);
      for (const d of body.data) {
        const [tabName, cellRef] = d.range.split('!');
        const letters = cellRef.match(/[A-Z]+/)[0], rowNum = parseInt(cellRef.match(/\d+/)[0], 10);
        let ci = 0; for (const ch of letters) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1;
        const tab = db[tabName]; if (!tab) continue;
        if (rowNum === 1) { tab.headers[ci] = d.values[0][0]; continue; }
        const r = tab.rows[rowNum - 2]; if (r) { while (r.length <= ci) r.push(''); r[ci] = d.values[0][0]; }
      }
      return { json: async () => ({}) };
    }
    let m2 = /^\/values\/([^!:?]+):append/.exec(path);
    if (method === 'POST' && m2) {
      const body = JSON.parse(fopts.body);
      if (!db[m2[1]]) db[m2[1]] = { headers: [], rows: [] };
      db[m2[1]].rows.push(...body.values);
      if (opts.onAppend) opts.onAppend(m2[1], body.values, db);
      return { json: async () => ({}) };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { json: async () => ({ sheets: [] }) };
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

// 2026-10-14 are fixed instants. EDT = UTC-4.
const NOON_ET = Date.UTC(2026, 9, 14, 16, 0, 0);       // 12:00 ET  -> outside quiet hours
const NIGHT_ET = Date.UTC(2026, 9, 15, 2, 30, 0);      // 22:30 ET  -> inside quiet hours (7pm-9am)

function build(db, o = {}) {
  const log = { twilio: [] };
  const fixed = o.now || NOON_ET;
  const src = [
    'const CORS = {};', S.cache, S.isMissing, S.sr, S.ensureInner, S.ensure, S.ensureTab, S.idc, S.col, S.json, S.fetchTab, S.fetchTabs, S.findWO,
    S.updateWOFields, S.nextSafeId, S.logAudit, S.logAuditMany, S.logMsgAudit, S.auditCols, S.addRow, S.invalidate, S.telemetry, S.nonShare, S.block,
    S.addonLive, S.isTenantCurrent, S.currentTenant, S.tenantsFor, S.isBackground, S.isNotifiable, S.smsGate, S.smsToggle, S.normPhone, S.mqTab, S.mqCols,
    S.smsInfraState, S.smsInfra, S.etHour, S.nyOff, S.quietConsts, S.isQuiet, S.nextQuiet, S.sendRaw, S.updMq, S.fetchConfig, S.smsGated,
    S.portalLink, S.unitLabel, S.phoneDisp, S.jobLabel, S.voidCols, S.splitMax, S.splitFields, S.testMarker, S.openStatuses,
    // stubs for unrelated collaborators (not under test here)
    'async function createVendorNudgeClock() {}', 'async function resetVendorNudgeClock() {}',
    'async function translateForVendorDetailed(env, vendor, text) { return { translated: false, text }; }',
    'async function translateToEnglish(env, t) { return t; }', 'async function sendSMS() {}', 'async function shouldNotifyOwner() { return false; }',
    'async function releaseTurnoverCleaningIfReady() {}', 'async function findLockedVendorBillForWOs() { return null; }',
    'function enrichWO(wo) { return { ID: wo.ID, Vendor_ID: wo.Vendor_ID, Status: wo.Status }; }',
    'async function logSMS() {}',
    S.assign, S.updateStatus, S.ownerWOs, S.woCombine, S.woSplit, S.isTestWO, S.isTestRecord, S.hubGuard,
    'return { woDuplicate, woBidGroupUnlink, woBidGroupGet, woBidGroupCancel, assignVendor, updateStatus, bidGroupWriteBlock, bidCancelClassify, nextBidGroupId, woDupResetChecklist, ownerWorkorders, woCombine, woSplit, hubTestWriteAllowed, isBidGroupWO, woDupAppendCopy, woDupSerialize, __woDupTapCache };',
  ].join('\n');
  class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } }
  const api = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date', src)(async () => 'tok', makeFetch(db, o, log), (fn) => fn(), FD);
  return Object.assign({ log }, api);
}

const env = { SHEET_ID: 'S', __STAGING__: false, TWILIO_SID: 'AC1', TWILIO_API_SID: 'SK1', TWILIO_API_KEY: 'k', TWILIO_FROM: '+15550001111' };   // "production-like": the fake Twilio endpoint is called
const envStg = { SHEET_ID: 'S', __STAGING__: true };
const wf = (db, id, name) => { const r = db.Work_Orders.rows.find(x => x[db.Work_Orders.headers.indexOf('ID')] === id); return r ? r[db.Work_Orders.headers.indexOf(name)] : undefined; };
const woRows = (db) => db.Work_Orders.rows.map(r => Object.fromEntries(db.Work_Orders.headers.map((h, i) => [h, r[i] ?? ''])));
const tab = (db, name) => db[name].rows.map(r => Object.fromEntries(db[name].headers.map((h, i) => [h, r[i] ?? ''])));
const call = async (p) => { const res = await p; return { status: res.status, body: await res.json() }; };
const CHECKLIST = JSON.stringify([{ t: 'Prep walls', done: true, code: '', why: '' }, { t: 'Two coats', done: false, code: 'parts', why: 'waiting on paint' }]);
const SRC = { ID: 'WO-1239', Property_ID: '70', Unit_ID: '54', Tenant_ID: '114', Vendor_ID: '2', Type: 'manual', Trade: 'Painting', Description: 'Estimate to repaint unit using 2-tone scheme.\nUNIT IS VACANT', Priority: 'normal', Status: 'Accepted', Scheduled_Date: '2026-10-20', Scheduled_Window: 'AM', Invoice_ID: 'INV-1', Owner_WO_Ref: 'REF-9', WO_Contact_Name: 'Pat', WO_Contact_Phone: '+14105550000', Tenant_Visible: 'TRUE', Tenant_Notify_Created: 'TRUE', Tenant_Notify_Updates: 'TRUE', Vendor_SMS_Sent: 'TRUE', Tenant_SMS_Sent: 'TRUE', Owner_Notified: 'TRUE', Created_By: 'admin', Created_Date: '2026-10-11T20:36:28.832Z', Notes: 'N', Room: 'Kitchen', QBO_Invoice_Number: 'Q1', QBO_Bill_Number: 'QB2', Customer_Charge: '500', Deposit_Amount: '50', Deposit_QB_Bill_Number: 'D1', Scope_ID: 'S1', Approval_Stage: 'Estimated', Estimate_Revised: 'TRUE', Current_Estimate: '420.00', Hold_Reason: 'x', Drive_Folder_ID: 'F1', Drive_Folder_URL: 'http://f', Parent_WO_ID: '', Intake_Message_ID: 'M1', Source: 'Buildium email' };
function seed(extra = {}) {
  return makeDb({
    wos: [SRC, { ID: 'WO-1238', Property_ID: '70', Type: 'manual', Trade: 'Painting', Description: 'Hallways', Status: 'Assigned', Vendor_ID: '2', Created_Date: '2026-10-11T20:34:06.846Z' }].concat(extra.wos || []),
    Checklist: undefined,
    WO_Tenants: [{ ID: '1', WO_ID: 'WO-1239', Tenant_ID: '114', Tenant_Name: 'Tina Tenant', Tenant_Phone: '+14105551111', Added_By: 'system-auto', Added_Date: 'd', Active: 'TRUE' }, { ID: '2', WO_ID: 'WO-1239', Tenant_ID: '200', Tenant_Name: 'Gone', Tenant_Phone: '', Active: 'FALSE' }],
    Tenants: [{ ID: '114', Property_ID: '70', Unit_ID: '54', First_Name: 'Tina', Last_Name: 'Tenant', Phone: '+14105551111', Active: 'TRUE' }],
    Owners: [{ ID: '5', First_Name: 'Olive', Last_Name: 'Owner', Phone: '+14105552222' }],
    Properties: [{ ID: '70', Owner_ID: '5', Address: '931 Saint Paul St', Access_Notes: 'real' }, { ID: 'TP', Owner_ID: '5', Address: 'TEST', Access_Notes: 'TEST-PROPERTY' }],
    Units: [{ ID: '54', Property_ID: '70', Unit_Label: '2' }],
    Vendors: [{ ID: '2', Name: 'Alex Busey', Phone: '+14436172152', Language: '' }, { ID: '3', Name: 'Cesar Diaz', Phone: '+12407051090', Language: 'es' }, { ID: '4', Name: 'No Phone Co', Phone: '', Language: '' }, { ID: '6', Name: 'Opted Out', Phone: '+14105559999', SMS_OptOut: 'TRUE' }, { ID: '7', Name: 'Gone Vendor', Phone: '+14105558888', Active: 'FALSE' }, { ID: '8', Name: 'TEST-VENDOR-001', Phone: '+14105557777' }],
    Attachments: [
      { ID: '1', WO_ID: 'WO-1239', File_Type: 'photo', Drive_File_ID: 'D1', Drive_URL: 'u1', File_Name: 'a.jpg', Uploaded_By: 'Brett', Notes: 'before', Active: 'TRUE', Mime_Type: 'image/jpeg' },
      { ID: '2', WO_ID: 'WO-1239', File_Type: 'video', Drive_File_ID: 'D2', Drive_URL: 'u2', File_Name: 'b.mp4', Active: 'TRUE', Mime_Type: 'video/mp4' },
      { ID: '3', WO_ID: 'WO-1239', File_Type: 'receipt', Drive_File_ID: 'D3', Active: 'TRUE' }, { ID: '4', WO_ID: 'WO-1239', File_Type: 'bill', Drive_File_ID: 'D4', Active: 'TRUE' },
      { ID: '5', WO_ID: 'WO-1239', File_Type: 'invoice', Drive_File_ID: 'D5', Active: 'TRUE' }, { ID: '6', WO_ID: 'WO-1239', File_Type: 'photo', Drive_File_ID: 'D6', Active: 'FALSE' },
      { ID: '7', WO_ID: 'WO-1239', File_Type: 'photo', Drive_File_ID: 'D7', Active: 'TRUE', Receipt_ID: 'R1' }, { ID: '8', WO_ID: 'WO-9999', File_Type: 'photo', Drive_File_ID: 'D8', Active: 'TRUE' },
    ],
    config: Object.assign({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }, extra.config || {}),
  });
}
// Add the columns the real prod sheet does have, with values, so "copy everything" is testable.
function seedWithExtraCols(db) {
  const add = { Checklist: CHECKLIST, Managed_By: 'RidgeCo', Entry_Notes: 'Key under mat', Owner_Notes: 'owner n', Vendor_Admin_Notes: 'vendor admin n', Admin_Notes: 'admin n' };
  for (const [k, v] of Object.entries(add)) { db.Work_Orders.headers.push(k); db.Work_Orders.rows.forEach(r => r.push(r[1] === 'WO-1239' ? v : '')); }
  return db;
}

console.log('Duplicate Work Order + bid groups — offline tests\n');

// ── 1. Pure helpers ──────────────────────────────────────────────────────────────────────────
{
  const db = makeDb(); const b = build(db);
  t('nextBidGroupId starts at BG-1001', b.nextBidGroupId([{}, { Bid_Group_ID: '' }]) === 'BG-1001');
  t('nextBidGroupId increments the max and ignores TO- ids', b.nextBidGroupId([{ Bid_Group_ID: 'BG-1004' }, { Bid_Group_ID: 'BG-1002' }, { Turnover_Group_ID: 'TO-5000' }]) === 'BG-1005');
  const r = b.woDupResetChecklist(CHECKLIST);
  const arr = JSON.parse(r.value);
  t('checklist reset: every item not done, reason cleared, text kept', r.ok && r.count === 2 && arr.every(i => i.done === false && i.code === '' && i.why === '') && arr[0].t === 'Prep walls' && arr[1].t === 'Two coats');
  t('empty checklist is fine', b.woDupResetChecklist('').ok && b.woDupResetChecklist('').value === '');
  const bad = b.woDupResetChecklist('{oops');
  t('unparseable checklist is copied as-is AND reported', bad.ok === false && bad.value === '{oops' && /JSON/.test(bad.error));
  t('isBidGroupWO: either stamp counts', b.isBidGroupWO({ Bid_Group_ID: 'BG-1' }) && b.isBidGroupWO({ Duplicated_From: 'WO-1' }) && !b.isBidGroupWO({}) && !b.isBidGroupWO({ Bid_Group_ID: ' ' }));
}

// ── 2. Duplicate: happy path with a vendor (Cesar, Spanish) ─────────────────────────────────────
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const { status, body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('duplicate returns 200 ok:true created:true', status === 200 && r.ok === true && r.created === true && r.errors.length === 0);
  t('new WO id is max+1', r.new_wo_id === 'WO-1240');
  t('bid group is BG-1001 and returned', r.bid_group_id === 'BG-1001');
  const rows = woRows(db), c = rows.find(x => x.ID === 'WO-1240'), s = rows.find(x => x.ID === 'WO-1239');
  t('prod-missing columns were added by ensureColumns', ['Bid_Group_ID', 'Duplicated_From', 'Owner_Notify_Override'].every(h => db.Work_Orders.headers.includes(h)));
  t('source stamped into the group (the original is a member too)', s.Bid_Group_ID === 'BG-1001' && s.Duplicated_From === '');
  t('copy stamped: group + Duplicated_From', c.Bid_Group_ID === 'BG-1001' && c.Duplicated_From === 'WO-1239');
  t('copied: property/unit/tenant/type/trade/description/priority/room/contact/ref/notes',
    c.Property_ID === '70' && c.Unit_ID === '54' && c.Tenant_ID === '114' && c.Type === 'manual' && c.Trade === 'Painting' && c.Description === SRC.Description && c.Priority === 'normal' && c.Room === 'Kitchen' &&
    c.WO_Contact_Name === 'Pat' && c.WO_Contact_Phone === '+14105550000' && c.Owner_WO_Ref === 'REF-9' && c.Notes === 'N');
  t('copied: the 4 notes columns + Managed_By', c.Entry_Notes === 'Key under mat' && c.Owner_Notes === 'owner n' && c.Vendor_Admin_Notes === 'vendor admin n' && c.Admin_Notes === 'admin n' && c.Managed_By === 'RidgeCo');
  const cl = JSON.parse(c.Checklist);
  t('checklist copied with done flags reset', cl.length === 2 && cl.every(i => i.done === false && i.why === '') && r.copied.checklist === true && r.copied.checklist_items === 2);
  t('source checklist untouched', JSON.parse(s.Checklist)[0].done === true);
  const blank = ['Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Invoice_ID', 'QBO_Invoice_Number', 'QBO_Bill_Number', 'Customer_Charge', 'Deposit_Amount', 'Deposit_QB_Bill_Number', 'Scope_ID', 'Approval_Stage', 'Estimate_Revised', 'Current_Estimate', 'Hold_Reason', 'Drive_Folder_ID', 'Drive_Folder_URL', 'Parent_WO_ID', 'Intake_Message_ID', 'Source', 'Voided', 'Void_Reason'];
  t('NOT copied: schedule/billing/QBO/deposit/scope/approval/estimate/hold/drive/void/intake fields are blank', blank.every(k => c[k] === ''));
  t('silent flags: tenant not visible, no tenant create/update notices, owner notifications off, nothing marked sent',
    c.Tenant_Visible === 'FALSE' && c.Tenant_Notify_Created === 'FALSE' && c.Tenant_Notify_Updates === 'FALSE' && c.Owner_Notify_Override === 'off' && c.Tenant_SMS_Sent === 'FALSE' && c.Owner_Notified === 'FALSE');
  t('vendor assigned + status Assigned (read back)', c.Vendor_ID === '3' && c.Status === 'Assigned' && r.vendor_name === 'Cesar Diaz');
  t('source WO keeps its own vendor/status untouched', s.Vendor_ID === '2' && s.Status === 'Accepted' && s.Scheduled_Date === '2026-10-20');
  const wt = tab(db, 'WO_Tenants').filter(x => x.WO_ID === 'WO-1240');
  t('tenant link copied (active only): tenant 114', wt.length === 1 && wt[0].Tenant_ID === '114' && wt[0].Active === 'TRUE' && r.copied.tenants === 1);
  const at = tab(db, 'Attachments').filter(x => x.WO_ID === 'WO-1240');
  t('photo + video re-pointed to the new WO (same Drive ids); receipt/bill/invoice/inactive/receipt-linked skipped', at.length === 2 && at.map(a => a.Drive_File_ID).sort().join() === 'D1,D2' && at.every(a => a.Active === 'TRUE') && r.copied.attachments === 2);
  t('photo note carried over', at.find(a => a.Drive_File_ID === 'D1').Notes === 'before');
  t('source attachments still there', tab(db, 'Attachments').filter(x => x.WO_ID === 'WO-1239').length === 7);
  t('no estimates/bills/time entries created on the copy', tab(db, 'Estimates').length === 0 && tab(db, 'Vendor_Bills').length === 0 && tab(db, 'Time_Entries').length === 0);
  // Silence: the ONLY message created is the vendor's; Twilio was called exactly once, to Cesar.
  const mq = tab(db, 'Message_Queue');
  t('only ONE queued message exists and it is the vendor job text', mq.length === 1 && mq[0].Message_Type === 'vendor_job_assigned' && mq[0].Recipient_Type === 'vendor' && mq[0].WO_ID === 'WO-1240');
  t('exactly one Twilio call (no tenant, no owner)', b.log.twilio.length === 1);
  t('the text went to Cesar (+1 240 705 1090)', /To=%2B12407051090/.test(b.log.twilio[0]) || /12407051090/.test(decodeURIComponent(b.log.twilio[0])));
  t('Spanish vendor gets the Spanish text', /Nuevo trabajo/.test(r.vendor_sms.message_body || '') && r.vendor_sms.language === 'es');
  t('vendor_sms outcome returned: sent', r.vendor_sms.status === 'sent' && r.copied && r.warnings.length === 0);
  const aud = tab(db, 'WO_Audit').filter(a => a.Field === 'Duplicated');
  t('WO_Audit rows on both WOs', aud.some(a => a.WO_ID === 'WO-1240' && a.New_Value === 'WO-1239') && aud.some(a => a.WO_ID === 'WO-1239' && a.New_Value === 'WO-1240'));
  const tel = tab(db, 'Ops_Telemetry').filter(x => x.Job_Type === 'wo_duplicate');
  t('telemetry row written with Success TRUE', tel.length === 1 && tel[0].Success === 'TRUE' && /WO-1240/.test(tel[0].Notes));
}

// ── 3. Quiet hours: the copy's vendor text bypasses them; plain /assign still does not ─────────────
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true, now: NIGHT_ET });
  const { body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('at 10:30pm ET the duplicate vendor text is SENT (bypasses quiet hours)', r.vendor_sms.status === 'sent' && b.log.twilio.length === 1);
  const mq = tab(db, 'Message_Queue');
  t('queue row sent, no Send_After hold', mq[0].Status === 'sent' && mq[0].Send_After === '');
  // Same moment, ordinary /assign path (no internal flag): still HELD — the bypass is feature-only.
  const res = await call(b.assignVendor(env, { wo_id: 'WO-1238', vendor_id: '3', notify: true, notify_tenant: false }));
  t('ordinary assignVendor at 10:30pm ET is still held for quiet hours', res.body.vendor_sms === false && res.body.vendor_sms_detail.status === 'held' && /quiet hours/i.test(res.body.vendor_sms_detail.reason) && b.log.twilio.length === 1);
  t('a body field cannot turn the bypass on (the option is not read from the request body)', !/body\.bypass/i.test(wsrc.slice(wsrc.indexOf('async function assignVendor('), wsrc.indexOf('async function updateStatus('))));
}

// ── 4. Vendor SMS outcomes are always reported (never silent) ─────────────────────────────────────
for (const [label, vendorId, cfg, wantStatus, wantRe] of [
  ['Twilio globally disabled', '3', { TWILIO_ENABLED: 'FALSE' }, 'failed', /Blocked.*global/i],
  ['vendor opted out', '6', {}, 'failed', /Blocked/i],
  ['vendor has no phone', '4', {}, 'failed', /no phone/i],
]) {
  const db = seedWithExtraCols(seed({ config: cfg })); const b = build(db, { allowTwilio: true });
  const { status, body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: vendorId }));
  t(`${label}: copy still created and assigned`, status === 200 && r.created === true && wf(db, r.new_wo_id, 'Vendor_ID') === vendorId);
  t(`${label}: vendor_sms.status=${wantStatus} with a reason`, r.vendor_sms.status === wantStatus && wantRe.test(r.vendor_sms.reason));
  t(`${label}: surfaced in warnings too`, r.warnings.some(w => /Vendor text FAILED/.test(w)));
  t(`${label}: no Twilio call`, b.log.twilio.length === 0);
}
{
  const db = seedWithExtraCols(seed({ config: { TWILIO_TEST_MODE: 'TRUE' } })); const b = build(db, { allowTwilio: true });
  const { body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('TEST MODE on: reported as sent-to-test-number, not as a normal send', r.vendor_sms.status === 'sent' && r.vendor_sms.test_mode === true && /TEST MODE/.test(r.vendor_sms.reason));
}

{
  // On the STAGING worker texts are stubbed: the outcome must say so (never claim "sent").
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const { body: r } = await call(b.woDuplicate(envStg, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('staging stub is reported as skipped/STAGING with the Spanish text still shown', r.vendor_sms.status === 'skipped' && /STAGING/.test(r.vendor_sms.reason) && /Nuevo trabajo/.test(r.vendor_sms.message_body) && b.log.twilio.length === 0);
}

// ── 5. No vendor / property-wide / English vendor / tenantless ────────────────────────────────────
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const { body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239' }));
  t('copy without a vendor: unassigned, status New, vendor_sms skipped, no message at all', r.created && wf(db, r.new_wo_id, 'Vendor_ID') === '' && wf(db, r.new_wo_id, 'Status') === 'New' && r.vendor_sms.status === 'skipped' && tab(db, 'Message_Queue').length === 0 && b.log.twilio.length === 0);
  const { body: r2 } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1238', vendor_id: '3' }));
  t('property-wide WO (no unit, no tenant) duplicates fine and its vendor is texted', r2.ok && wf(db, r2.new_wo_id, 'Unit_ID') === '' && r2.copied.tenants === 0 && r2.vendor_sms.status === 'sent');
  const { body: r3 } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '8' }));
  t('English vendor gets the English text', r3.vendor_sms.status === 'sent' && /New Painting job/.test(r3.vendor_sms.message_body) && r3.vendor_sms.language === 'en');
  t('two copies of one source share ONE group (the source is stamped once)', r3.bid_group_id === 'BG-1001' && wf(db, 'WO-1239', 'Bid_Group_ID') === 'BG-1001');
  t('the property-wide WO started its own group', r2.bid_group_id === 'BG-1002');
}

// ── 6. Double-tap + concurrency ──────────────────────────────────────────────────────────────────────
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const first = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  const again = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('an identical repeat tap is refused (409) and names the copy it just made', again.status === 409 && again.body.created === false && again.body.previous_new_wo_id === first.body.new_wo_id && /ignored/.test(again.body.error));
  t('only one copy exists after the repeat', woRows(db).filter(w => w.Duplicated_From === 'WO-1239').length === 1 && b.log.twilio.length === 1);
}
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const [a, c, d] = await Promise.all([b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }), b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '8' }), b.woDuplicate(env, { source_wo_id: 'WO-1239' })].map(call));
  const ids = [a, c, d].map(x => x.body.new_wo_id);
  t('three concurrent duplicates get three DISTINCT WO numbers', new Set(ids).size === 3 && ids.every(Boolean));
  const all = woRows(db).map(w => w.ID);
  t('no duplicate WO number anywhere in the sheet', new Set(all).size === all.length);
  t('all three joined the same single group', new Set([a, c, d].map(x => x.body.bid_group_id)).size === 1 && woRows(db).filter(w => w.Bid_Group_ID === 'BG-1001').length === 4);
}
{
  // Another isolate (a tenant submit) takes the same WO number in the instant after our append.
  let raced = false;
  const db = seedWithExtraCols(seed());
  const b = build(db, { allowTwilio: true, onAppend: (tabName, vals, d) => {
    if (tabName === 'Work_Orders' && !raced) { raced = true; const row = vals[0].slice(); row[d.Work_Orders.headers.indexOf('Duplicated_From')] = ''; row[d.Work_Orders.headers.indexOf('Bid_Group_ID')] = ''; row[d.Work_Orders.headers.indexOf('Description')] = 'foreign tenant WO'; d.Work_Orders.rows.unshift(row); }
  } });
  const { status, body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  const all = woRows(db);
  t('ID race: the copy was renumbered, the foreign row kept its number', status === 200 && r.new_wo_id === 'WO-1241' && all.filter(w => w.ID === 'WO-1240').length === 1 && all.find(w => w.ID === 'WO-1240').Description === 'foreign tenant WO');
  t('ID race: the copy is reachable under its new number with its links', all.find(w => w.ID === 'WO-1241').Duplicated_From === 'WO-1239' && wf(db, 'WO-1241', 'Vendor_ID') === '3' && tab(db, 'WO_Tenants').some(x => x.WO_ID === 'WO-1241') && r.warnings.some(w => /renumbered/.test(w)));
}

// ── 7. Validation: every refusal is a clear message AND a telemetry row ───────────────────────────────
{
  const mk = (extra) => seedWithExtraCols(seed(extra));
  const cases = [
    ['missing source_wo_id', {}, 400, /source_wo_id required/, null],
    ['source not found = failure', { source_wo_id: 'WO-9999' }, 404, /not found/, null],
    ['unknown vendor', { source_wo_id: 'WO-1239', vendor_id: '99' }, 404, /Vendor 99 not found/, null],
    ['inactive vendor', { source_wo_id: 'WO-1239', vendor_id: '7' }, 400, /inactive/, null],
    ['same vendor already on the source', { source_wo_id: 'WO-1239', vendor_id: '2' }, 409, /already has WO-1239/, null],
    ['voided source', { source_wo_id: 'WO-V' }, 400, /voided/, { wos: [{ ID: 'WO-V', Property_ID: '70', Status: 'New', Voided: 'TRUE' }] }],
    ['cancelled source', { source_wo_id: 'WO-C' }, 400, /Cancelled/, { wos: [{ ID: 'WO-C', Property_ID: '70', Status: 'Cancelled' }] }],
    ['completed source', { source_wo_id: 'WO-D' }, 400, /Complete/, { wos: [{ ID: 'WO-D', Property_ID: '70', Status: 'Complete' }] }],
    ['additional-work child', { source_wo_id: 'WO-A' }, 400, /additional work/, { wos: [{ ID: 'WO-A', Property_ID: '70', Status: 'New', Type: 'addon', Parent_WO_ID: 'WO-1239' }] }],
    ['owner-managed source with a vendor', { source_wo_id: 'WO-O', vendor_id: '3' }, 400, /property owner/, { wos: [{ ID: 'WO-O', Property_ID: '70', Status: 'New', Managed_By: 'Owner' }] }],
  ];
  for (const [label, body, wantStatus, re, extra] of cases) {
    const db = mk(extra || {}); if (extra && extra.wos && extra.wos[0].Managed_By) { db.Work_Orders.rows.find(r => r[1] === 'WO-O')[db.Work_Orders.headers.indexOf('Managed_By')] = 'Owner'; }
    const before = db.Work_Orders.rows.length; const b = build(db, { allowTwilio: true });
    const { status, body: r } = await call(b.woDuplicate(env, body));
    t(`refused: ${label} (${status})`, status === wantStatus && r.created === false && re.test(r.error) && r.errors.length >= 1);
    t(`refused: ${label} — nothing written, nothing sent`, db.Work_Orders.rows.length === before && b.log.twilio.length === 0 && tab(db, 'Message_Queue').length === 0);
    t(`refused: ${label} — logged to Ops_Telemetry as a failure`, tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_duplicate' && x.Success === 'FALSE'));
  }
}

// ── 8. Failure injection: nothing is swallowed ───────────────────────────────────────────────────────
{
  // (a) the append of the copy row fails -> 500, the source is NOT left stamped, no half-made group
  const db = seedWithExtraCols(seed()); let breakAppend = true;
  const b = build(db, { allowTwilio: true, throwOnWrite: (path, method) => breakAppend && method === 'POST' && path.startsWith('/values/Work_Orders:append') });
  const { status, body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('append failure: 500, created:false, error names the cause', status === 500 && r.created === false && /append failed/.test(r.error));
  t('append failure: source was taken back out of the group (no orphan one-member group)', wf(db, 'WO-1239', 'Bid_Group_ID') === '' && woRows(db).every(w => w.Duplicated_From === ''));
  t('append failure: telemetry FALSE + nothing sent', tab(db, 'Ops_Telemetry').some(x => x.Success === 'FALSE' && x.Job_Type === 'wo_duplicate') && b.log.twilio.length === 0);
  // the failed attempt must not leave the double-tap guard armed: an immediate retry works
  breakAppend = false;
  const retry = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('after a failed attempt the retry is NOT blocked by the repeat-tap guard and succeeds', retry.status === 200 && retry.body.ok === true && retry.body.bid_group_id === 'BG-1001');
}
{
  // (b) WO_Tenants append fails -> copy exists, ok:false, error visible, vendor still handled
  const db = seedWithExtraCols(seed());
  const b = build(db, { allowTwilio: true, throwOnWrite: (path, method) => method === 'POST' && path.startsWith('/values/WO_Tenants:append') });
  const { status, body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('tenant-link failure: copy created but ok:false with a visible error', status === 200 && r.created === true && r.ok === false && r.errors.some(e => /Tenant links were not copied/.test(e)));
  t('tenant-link failure: logged as a failure with the WO ids', tab(db, 'Ops_Telemetry').some(x => x.Success === 'FALSE' && /WO-1239->WO-1240/.test(x.Notes)));
}
{
  // (c) the attachments append fails; (d) the audit append fails
  for (const [label, tabName, re] of [['attachments', 'Attachments', /Photos\/videos were not copied/], ['audit', 'WO_Audit', /WO_Audit rows were not written/]]) {
    const db = seedWithExtraCols(seed());
    const b = build(db, { allowTwilio: true, throwOnWrite: (path, method) => method === 'POST' && path.startsWith(`/values/${tabName}:append`) });
    const { body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239' }));
    t(`${label} failure surfaces in errors and ok is false`, r.created && r.ok === false && r.errors.some(e => re.test(e)));
  }
}
{
  // (e) the vendor write never lands (updateWOFields drops it) -> detected by the read-back
  const db = seedWithExtraCols(seed());
  const b = build(db, { allowTwilio: true });
  // simulate a dropped write: break Vendor_ID header so updateWOFields skips it
  db.Work_Orders.headers[db.Work_Orders.headers.indexOf('Vendor_ID')] = 'Vendor_ID_RENAMED';
  const { body: r } = await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }));
  t('a vendor write that did not stick is caught by the read-back (error + vendor_sms failed)', r.created && r.ok === false && r.vendor_sms.status === 'failed' && r.errors.some(e => /not assigned/.test(e)));
}

// ── 9. Unlink ─────────────────────────────────────────────────────────────────────────────────────────
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const c1 = (await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }))).body;
  const c2 = (await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '8' }))).body;
  const u1 = await call(b.woBidGroupUnlink(env, { wo_id: c1.new_wo_id }));
  t('unlink a copy of a 3-member group: only that copy is cleared', u1.status === 200 && u1.body.ok && u1.body.cleared.join() === c1.new_wo_id && wf(db, c1.new_wo_id, 'Bid_Group_ID') === '' && wf(db, c2.new_wo_id, 'Bid_Group_ID') === 'BG-1001' && wf(db, 'WO-1239', 'Bid_Group_ID') === 'BG-1001');
  t('unlinked copy keeps Duplicated_From (history) and its vendor', wf(db, c1.new_wo_id, 'Duplicated_From') === 'WO-1239' && wf(db, c1.new_wo_id, 'Vendor_ID') === '3');
  const u2 = await call(b.woBidGroupUnlink(env, { wo_id: c2.new_wo_id }));
  t('unlinking until one member is left releases that last member too', u2.body.ok && u2.body.cleared.sort().join() === [c2.new_wo_id, 'WO-1239'].sort().join() && wf(db, 'WO-1239', 'Bid_Group_ID') === '' && u2.body.warnings.some(w => /released from the group too/.test(w)));
  const u3 = await call(b.woBidGroupUnlink(env, { wo_id: c2.new_wo_id }));
  t('unlinking a WO that is not in a group is a clear 400, not a silent success', u3.status === 400 && /not in a bid group/.test(u3.body.error));
  const u4 = await call(b.woBidGroupUnlink(env, { wo_id: 'WO-NOPE' }));
  t('unlink of an unknown WO is a 404 failure', u4.status === 404);
  t('unlink wrote WO_Audit rows and telemetry', tab(db, 'WO_Audit').some(a => a.Field === 'Bid_Group_ID' && a.Old_Value === 'BG-1001' && a.New_Value === '' && a.WO_ID === c1.new_wo_id) && tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_unlink' && x.Success === 'TRUE') && tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_unlink' && x.Success === 'FALSE'));
}

// ── 10. GET /wo/bid-group ─────────────────────────────────────────────────────────────────────────────
{
  const db = seedWithExtraCols(seed()); const b = build(db, { allowTwilio: true });
  const c1 = (await call(b.woDuplicate(env, { source_wo_id: 'WO-1239', vendor_id: '3' }))).body;
  db.Estimates.rows.push(['1', c1.new_wo_id, '3', '1', '420.00', 'Pending', 'TRUE']);
  const g = await call(b.woBidGroupGet(env, new URL('https://x/wo/bid-group?wo_id=' + c1.new_wo_id)));
  const m = g.body.members;
  t('GET members: original first, then copy, with vendor names, status, estimate', g.body.group_id === 'BG-1001' && m.length === 2 && m[0].id === 'WO-1239' && m[0].is_original && m[0].vendor_name === 'Alex Busey' && m[1].id === c1.new_wo_id && m[1].vendor_name === 'Cesar Diaz' && m[1].status === 'Assigned' && m[1].latest_estimate.subtotal === '420.00' && m[1].duplicated_from === 'WO-1239');
  const none = await call(b.woBidGroupGet(env, new URL('https://x/wo/bid-group?wo_id=WO-1238')));
  t('a WO that is not in a group returns an empty list (an expected state)', none.status === 200 && none.body.group_id === '' && none.body.members.length === 0);
  const nf = await call(b.woBidGroupGet(env, new URL('https://x/wo/bid-group?wo_id=WO-NOPE')));
  t('unknown WO is a 404 (not found is a failure)', nf.status === 404);
  t('missing params is a 400', (await call(b.woBidGroupGet(env, new URL('https://x/wo/bid-group')))).status === 400);
  await call(b.woBidGroupUnlink(env, { wo_id: c1.new_wo_id }));
  const ind = await call(b.woBidGroupGet(env, new URL('https://x/wo/bid-group?wo_id=' + c1.new_wo_id)));
  t('an unlinked copy reports it is an independent copy of the source', ind.body.members.length === 0 && /Independent copy of WO-1239/.test(ind.body.note));
}

// ── 11. Cancel: classifier ────────────────────────────────────────────────────────────────────────────
{
  const b = build(makeDb()); const ctx = { bills: [{ WO_ID: 'B1', Active: 'TRUE' }, { WO_ID: 'B2', Active: 'FALSE' }], timeEntries: [{ WO_ID: 'T1', Active: 'TRUE' }], invoiceReview: [{ WO_ID: 'I1', Active: 'TRUE' }], workorders: [{ Type: 'addon', Parent_WO_ID: 'A1' }] };
  const k = (wo) => b.bidCancelClassify(Object.assign({ Status: 'Assigned' }, wo), ctx);
  t('plain assigned copy: cancellable', k({ ID: 'X' }).kind === 'cancel');
  t('accepted copy: cancellable WITH a warning that the vendor is not told', k({ ID: 'X', Status: 'Accepted' }).warnings.some(w => /will NOT be told/.test(w)));
  for (const s of ['Complete', 'Pending Invoice', 'Invoiced', 'Paid']) t(`status ${s} is skipped`, k({ ID: 'X', Status: s }).kind === 'skip');
  t('already cancelled', k({ ID: 'X', Status: 'Cancelled' }).kind === 'already' && k({ ID: 'X', Status: 'Canceled' }).kind === 'already');
  t('live vendor bill -> skip; inactive bill -> fine', k({ ID: 'B1' }).kind === 'skip' && k({ ID: 'B2' }).kind === 'cancel');
  t('time entry -> skip', k({ ID: 'T1' }).kind === 'skip');
  t('invoice review row -> skip', k({ ID: 'I1' }).kind === 'skip');
  t('Customer_Charge > 0 -> skip; 0 -> fine', k({ ID: 'X', Customer_Charge: '$120.50' }).kind === 'skip' && k({ ID: 'X', Customer_Charge: '0' }).kind === 'cancel');
  t('QBO invoice / QBO bill / invoice id / deposit / scope -> skip', ['QBO_Invoice_Number', 'QBO_Bill_Number', 'Invoice_ID', 'Deposit_QB_Bill_Number', 'Scope_ID'].every(f => k({ ID: 'X', [f]: 'abc' }).kind === 'skip') && k({ ID: 'X', Deposit_Amount: '25' }).kind === 'skip');
  t('voided -> skip', k({ ID: 'X', Voided: 'TRUE' }).kind === 'skip');
  t('every skip carries a human-readable reason', k({ ID: 'T1' }).reasons.length === 1 && /time entr/.test(k({ ID: 'T1' }).reasons[0]));
  t('add-on children produce a warning (updateStatus enforces the refusal)', k({ ID: 'A1' }).warnings.some(w => /additional-work/.test(w)));
}

// ── 12. Cancel: endpoint ──────────────────────────────────────────────────────────────────────────────
async function groupOf4() {
  const db = seedWithExtraCols(seed({ wos: [{ ID: 'WO-1250', Property_ID: '70', Unit_ID: '54', Status: 'Assigned', Vendor_ID: '8', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1001', Created_Date: '2026-10-12T01:00:00Z' }, { ID: 'WO-1251', Property_ID: '70', Unit_ID: '54', Status: 'Complete', Vendor_ID: '4', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1001', Created_Date: '2026-10-12T02:00:00Z' }, { ID: 'WO-1252', Property_ID: '70', Unit_ID: '54', Status: 'Assigned', Vendor_ID: '3', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1001', Created_Date: '2026-10-12T03:00:00Z' }] }));
  // header columns for the bid fields must exist before rows carrying them are read
  for (const h of ['Bid_Group_ID', 'Duplicated_From', 'Owner_Notify_Override']) if (!db.Work_Orders.headers.includes(h)) { db.Work_Orders.headers.push(h); db.Work_Orders.rows.forEach(r => r.push('')); }
  db.Work_Orders.rows.find(r => r[1] === 'WO-1239')[db.Work_Orders.headers.indexOf('Bid_Group_ID')] = 'BG-1001';
  const set = (id, k, v) => { db.Work_Orders.rows.find(r => r[1] === id)[db.Work_Orders.headers.indexOf(k)] = v; };
  // WO-1239 carries billing data in SRC (to prove the copy does not inherit it); the cancel group needs a cancellable original.
  for (const k of ['Invoice_ID', 'QBO_Invoice_Number', 'QBO_Bill_Number', 'Customer_Charge', 'Deposit_Amount', 'Deposit_QB_Bill_Number', 'Scope_ID']) set('WO-1239', k, '');
  for (const id of ['WO-1250', 'WO-1251', 'WO-1252']) { set(id, 'Duplicated_From', 'WO-1239'); set(id, 'Bid_Group_ID', 'BG-1001'); }
  return { db, set };
}
{
  const { db } = await groupOf4(); const b = build(db, { allowTwilio: true });
  const snap = JSON.stringify(db.Work_Orders.rows);
  for (const [label, body] of [['no confirm', { wo_id: 'WO-1239', mode: 'all' }], ['dry_run:true', { wo_id: 'WO-1239', mode: 'all', dry_run: true }], ['confirm:true AND dry_run:true', { wo_id: 'WO-1239', mode: 'all', dry_run: true, confirm: true }], ['confirm:"yes" (not boolean true)', { wo_id: 'WO-1239', mode: 'all', confirm: 'yes' }]]) {
    const r = await call(b.woBidGroupCancel(env, body));
    t(`preview only (${label}): 200, dry_run true, nothing changed`, r.status === 200 && r.body.dry_run === true && JSON.stringify(db.Work_Orders.rows) === snap);
  }
  const p = (await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'all' }))).body;
  const by = Object.fromEntries(p.results.map(x => [x.wo_id, x]));
  t('preview lists each member with id, vendor, status', p.results.length === 4 && by['WO-1239'].vendor_name === 'Alex Busey' && by['WO-1239'].status_before === 'Accepted' && by['WO-1252'].vendor_name === 'Cesar Diaz');
  t('preview: would_cancel for open members, would_skip (with reason) for the Complete one', by['WO-1250'].result === 'would_cancel' && by['WO-1251'].result === 'would_skip' && /Complete/.test(by['WO-1251'].reasons[0]) && p.summary.would_cancel === 3 && p.summary.would_skip === 1);
  t('preview wrote only telemetry (no WO_Audit rows, no messages)', tab(db, 'WO_Audit').length === 0 && tab(db, 'Message_Queue').length === 0 && b.log.twilio.length === 0);
  const dup = (await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates' }))).body;
  t('preview duplicates mode keeps the original', dup.results.find(x => x.wo_id === 'WO-1239').result === 'kept' && dup.summary.would_cancel === 2);
  const k1 = (await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252' }))).body;
  t('preview keep_one keeps the chosen WO and targets the rest', k1.results.find(x => x.wo_id === 'WO-1252').result === 'kept' && k1.results.find(x => x.wo_id === 'WO-1239').result === 'kept' && k1.results.find(x => x.wo_id === 'WO-1250').result === 'would_cancel');
}
{
  const { db } = await groupOf4(); const b = build(db, { allowTwilio: true });
  const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1252', mode: 'duplicates', confirm: true, updated_by: 'Brett' }));
  t('confirm duplicates: ok, cancelled the 2 cancellable copies, skipped the Complete one, kept the original', r.status === 200 && r.body.ok && r.body.dry_run === false && r.body.summary.cancelled === 2 && r.body.summary.skipped === 1 && r.body.summary.kept === 1);
  t('statuses written + read back', wf(db, 'WO-1250', 'Status') === 'Cancelled' && wf(db, 'WO-1252', 'Status') === 'Cancelled' && wf(db, 'WO-1251', 'Status') === 'Complete' && wf(db, 'WO-1239', 'Status') === 'Accepted');
  const aud = tab(db, 'WO_Audit').filter(a => a.Field === 'Status' && a.New_Value === 'Cancelled');
  t('goes through updateStatus: a WO_Audit Status row per cancel (changed_by from the request)', aud.length === 2 && aud.every(a => a.Changed_By === 'Brett'));
  t('plus a Bid_Group_Cancel audit row stating the vendor was not texted', tab(db, 'WO_Audit').filter(a => a.Field === 'Bid_Group_Cancel').length === 2 && tab(db, 'WO_Audit').some(a => /vendor was not texted/.test(a.Notes)));
  t('NO message of any kind was sent on cancel', tab(db, 'Message_Queue').length === 0 && b.log.twilio.length === 0);
  t('the skipped member is reported with its reason', r.body.results.find(x => x.wo_id === 'WO-1251').result === 'skipped');
  t('cancel result is in telemetry (Success TRUE)', tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel' && x.Success === 'TRUE' && /cancelled=2/.test(x.Notes)));
  const again = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'all', confirm: true }));
  t('running "cancel all" again: already-cancelled members are reported as such, the original is cancelled', again.body.summary.already_cancelled === 2 && wf(db, 'WO-1239', 'Status') === 'Cancelled' && again.body.summary.cancelled === 1);
}
{
  const { db, set } = await groupOf4(); const b = build(db, { allowTwilio: true });
  db.Vendor_Bills.rows.push(['1', 'WO-1250', 'TRUE', 'submitted']); db.Time_Entries.rows.push(['1', 'WO-1252', 'TRUE']); set('WO-1239', 'Customer_Charge', '99');
  const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'all', confirm: true }));
  t('members with a bill / time entry / customer charge are skipped, never cancelled', r.body.summary.cancelled === 0 && r.body.summary.skipped === 4 && ['WO-1239', 'WO-1250', 'WO-1252'].every(id => wf(db, id, 'Status') !== 'Cancelled'));
  t('each skip names its reason', /vendor bill/.test(r.body.results.find(x => x.wo_id === 'WO-1250').reasons.join()) && /time entr/.test(r.body.results.find(x => x.wo_id === 'WO-1252').reasons.join()) && /Customer charge/.test(r.body.results.find(x => x.wo_id === 'WO-1239').reasons.join()));
  t('"nothing to cancel" is stated as a warning', r.body.warnings.some(w => /Nothing to cancel/.test(w)));
}
{
  const { db } = await groupOf4(); const b = build(db, { allowTwilio: true });
  const bad = [[{ wo_id: 'WO-1239', mode: 'nuke', confirm: true }, 400], [{ wo_id: 'WO-1239', mode: 'keep_one', confirm: true }, 400], [{ wo_id: 'WO-1239', mode: 'keep_one', keep_wo_id: 'WO-1238', confirm: true }, 400], [{ wo_id: 'WO-1238', mode: 'all', confirm: true }, 400], [{ wo_id: 'WO-NOPE', mode: 'all', confirm: true }, 404], [{ group_id: 'BG-9999', mode: 'all', confirm: true }, 404]];
  for (const [body, want] of bad) { const r = await call(b.woBidGroupCancel(env, body)); t(`rejected ${JSON.stringify(body)} -> ${want}`, r.status === want && r.body.errors.length >= 1); }
  t('nothing was cancelled by the rejected calls', woRows(db).every(w => w.Status !== 'Cancelled'));
  const k = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'keep_one', keep_wo_id: 'WO-1250', confirm: true }));
  t('keep_one: the chosen WO stays open; the others are cancelled (Complete skipped)', k.body.ok && wf(db, 'WO-1250', 'Status') === 'Assigned' && wf(db, 'WO-1239', 'Status') === 'Cancelled' && wf(db, 'WO-1252', 'Status') === 'Cancelled' && wf(db, 'WO-1251', 'Status') === 'Complete');
}
{
  // one member's status write fails: the others still go, the failure is reported, ok:false
  const { db } = await groupOf4();
  const b = build(db, { allowTwilio: true, throwOnWrite: (path, method, body) => method === 'POST' && path === '/values:batchUpdate' && /Cancelled/.test(String(body)) && db.Work_Orders.rows.find(r => r[1] === 'WO-1250')[db.Work_Orders.headers.indexOf('Status')] === 'Cancelled' === false && !globalThis.__failed1 && (globalThis.__failed1 = true) });
  const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('a failing cancel is reported per member and flips ok to false', r.status === 500 && r.body.ok === false && r.body.summary.failed >= 1 && r.body.errors.length >= 1 && r.body.results.some(x => x.result === 'failed'));
  t('the failure is in telemetry with the WO id', tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel' && x.Success === 'FALSE' && /WO-125\d/.test(x.Notes)));
  delete globalThis.__failed1;
}
{
  // add-on orphan guard (same as /status Cancelled): a member with a live add-on child is refused, others proceed
  const { db } = await groupOf4(); const b = build(db, { allowTwilio: true });
  db.Work_Orders.headers.push('Addon_Status'); db.Work_Orders.rows.forEach(r => r.push(''));
  db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => ({ ID: 'WO-AD1', Type: 'addon', Parent_WO_ID: 'WO-1250', Status: 'New', Property_ID: '70', Addon_Status: 'Submitted' }[h] ?? '')));
  db.Estimates.rows.push(['9', 'WO-AD1', '8', '1', '100.00', 'Pending', 'TRUE']);
  const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('orphan guard honoured: parent with a live add-on is NOT cancelled and the refusal is reported', wf(db, 'WO-1250', 'Status') !== 'Cancelled' && r.body.results.find(x => x.wo_id === 'WO-1250').result === 'failed' && /additional work|add-on|open/i.test(r.body.results.find(x => x.wo_id === 'WO-1250').reasons.join()));
  t('the other copy was still cancelled', wf(db, 'WO-1252', 'Status') === 'Cancelled');
}

// ── 13. Billing guards on cancelled/voided bid-group copies ─────────────────────────────────────────
{
  const db = seedWithExtraCols(seed()); for (const h of ['Bid_Group_ID', 'Duplicated_From']) if (!db.Work_Orders.headers.includes(h)) { db.Work_Orders.headers.push(h); db.Work_Orders.rows.forEach(r => r.push('')); }
  const add = (o) => db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => o[h] ?? ''));
  add({ ID: 'C1', Status: 'Cancelled', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1' }); add({ ID: 'C2', Status: 'Canceled', Bid_Group_ID: 'BG-1' });
  add({ ID: 'C3', Status: 'Cancelled', Duplicated_From: 'WO-1239' }); add({ ID: 'C4', Status: 'Assigned', Voided: 'TRUE', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1' });
  add({ ID: 'OK1', Status: 'Assigned', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1' }); add({ ID: 'NG1', Status: 'Cancelled' });
  const b = build(db);
  const blk = (id) => b.bidGroupWriteBlock(env, id, 'estimates', 'presupuestos', '/estimate');
  const c1 = await blk('C1');
  t('cancelled copy is blocked with a clear bilingual message', c1 && /C1 has been cancelled/.test(c1.message) && /fue cancelado/.test(c1.message) && /presupuestos/.test(c1.message) && c1.logged === true);
  t('cancelled original-in-group (group stamp only) is blocked', !!(await blk('C2')));
  t('cancelled UNLINKED copy (Duplicated_From only) is still blocked', !!(await blk('C3')));
  t('voided copy is blocked, worded as voided', /voided/.test((await blk('C4')).message));
  t('an open copy is not blocked', (await blk('OK1')) === null);
  t('an ordinary cancelled WO (not a bid-group WO) is NOT blocked — existing behaviour unchanged', (await blk('NG1')) === null);
  t('unknown / blank WO ids do not block (the caller reports its own not-found)', (await blk('NOPE')) === null && (await blk('')) === null);
  t('every block is logged to Ops_Telemetry as a failure', tab(db, 'Ops_Telemetry').filter(x => x.Job_Type === 'bid_group_write_blocked' && x.Success === 'FALSE').length === 4);
  for (const [fn, key, what] of [['addEstimateVersion', "'/estimate'", 'estimate'], ['addTimeEntry', "'/time-entry/add'", 'time entry'], ['addVendorBill', "'/vendor-bill/add'", 'vendor bill'], ['approveInvoiceReview', "'/invoice-review/approve'", 'invoice review approval']]) {
    const body = grab(wsrc, `async function ${fn}(`);
    const gi = body.indexOf('bidGroupWriteBlock('), wi = Math.min(...['addRow(', 'sheetsRequest(', "'POST'"].map(x => { const i = body.indexOf(x); return i < 0 ? 1e9 : i; }));
    t(`${fn}: guard present with the right endpoint label, before the first write`, gi > 0 && body.includes(key) && gi < wi && /409/.test(body.slice(gi, gi + 400)));
  }
}

// ── 14. Owner portal hides still-linked copies; tenant-facing flags; Combine/Split refusal ─────────
{
  const db = seedWithExtraCols(seed()); for (const h of ['Bid_Group_ID', 'Duplicated_From']) if (!db.Work_Orders.headers.includes(h)) { db.Work_Orders.headers.push(h); db.Work_Orders.rows.forEach(r => r.push('')); }
  const add = (o) => db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => o[h] ?? ''));
  add({ ID: 'L1', Property_ID: '70', Status: 'Assigned', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1' }); add({ ID: 'U1', Property_ID: '70', Status: 'Assigned', Duplicated_From: 'WO-1239' });
  add({ ID: 'G1', Property_ID: '70', Status: 'Assigned', Bid_Group_ID: 'BG-1' });
  const b = build(db);
  const res = await call(b.ownerWorkorders(env, new URL('https://x/owner-workorders?owner_id=5')));
  const ids = res.body.map(w => w.ID);
  t('owner portal: still-linked copy (both stamps) is hidden', !ids.includes('L1'));
  t('owner portal: the original (group stamp only), an unlinked copy and ordinary WOs still show', ids.includes('G1') && ids.includes('U1') && ids.includes('WO-1239') && ids.includes('WO-1238'));
  const sp = await call(b.woSplit(env, { original_wo_id: 'G1', new_work_orders: [{ Description: 'x' }] }));
  t('Split on a bid-group WO is refused with a clear message', sp.status === 400 && /bid group BG-1/.test(sp.body.error) && /unlink/i.test(sp.body.error));
  const cm = await call(b.woCombine(env, { survivor_wo_id: 'WO-1238', combined_wo_ids: ['G1'] }));
  t('Combine that includes a bid-group WO (as a combined WO) is refused', cm.status === 400 && /bid group BG-1/.test(cm.body.error));
  const cm2 = await call(b.woCombine(env, { survivor_wo_id: 'G1', combined_wo_ids: ['WO-1238'] }));
  t('Combine with a bid-group survivor is refused', cm2.status === 400 && /bid group BG-1/.test(cm2.body.error));
  const sp2 = await call(b.woSplit(env, { original_wo_id: 'U1', new_work_orders: [{ Description: 'x' }] }));
  t('an UNLINKED copy (no Bid_Group_ID) is not refused by the bid-group rule', !(sp2.status === 400 && /bid group/.test(sp2.body.error || '')));
}

// ── 15. Staging test-token guard (TEST- records only) + wiring ───────────────────────────────────────
{
  const db = seedWithExtraCols(seed());
  db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => ({ ID: 'WO-T1', Property_ID: 'TP', Status: 'New' }[h] ?? '')));
  db.Vendors.rows[5][1] = 'TEST-VENDOR-001'; // id 8
  // TEST_MARKER_FIELD: Properties -> Access_Notes, Vendors -> Name
  const b = build(db);
  const g = (p, body) => b.hubTestWriteAllowed(env, p, body).then(x => (x && typeof x === 'object') ? x.ok : x);
  t('guard: TEST WO + TEST vendor is allowed', await g('/wo/duplicate', { source_wo_id: 'WO-T1', vendor_id: '8' }) === true);
  t('guard: TEST WO, no vendor is allowed', await g('/wo/duplicate', { source_wo_id: 'WO-T1' }) === true);
  t('guard: REAL WO is refused', await g('/wo/duplicate', { source_wo_id: 'WO-1239' }) === false);
  t('guard: TEST WO with a REAL vendor is refused', await g('/wo/duplicate', { source_wo_id: 'WO-T1', vendor_id: '3' }) === false);
  t('guard: unknown source is refused', await g('/wo/duplicate', { source_wo_id: 'NOPE' }) === false);
  t('guard: unlink/cancel on a group containing a real WO is refused; with only TEST WOs allowed',
    await g('/wo/bid-group/cancel', { wo_id: 'WO-1239', mode: 'all' }) === false);
  for (const h of ['Bid_Group_ID', 'Duplicated_From']) if (!db.Work_Orders.headers.includes(h)) { db.Work_Orders.headers.push(h); db.Work_Orders.rows.forEach(r => r.push('')); }
  const setv = (id, k, v) => { db.Work_Orders.rows.find(r => r[1] === id)[db.Work_Orders.headers.indexOf(k)] = v; };
  db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => ({ ID: 'WO-T2', Property_ID: 'TP', Status: 'New' }[h] ?? '')));
  setv('WO-T1', 'Bid_Group_ID', 'BG-T'); setv('WO-T2', 'Bid_Group_ID', 'BG-T');
  const b2 = build(db), g2 = (p, body) => b2.hubTestWriteAllowed(env, p, body).then(x => (x && typeof x === 'object') ? x.ok : x);
  t('guard: an all-TEST group is allowed for cancel and unlink', await g2('/wo/bid-group/cancel', { group_id: 'BG-T', mode: 'all' }) === true && await g2('/wo/bid-group/unlink', { wo_id: 'WO-T2' }) === true);
  db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => ({ ID: 'WO-R9', Property_ID: '70', Status: 'New', Bid_Group_ID: 'BG-T' }[h] ?? '')));
  const b3 = build(db), g3 = (p, body) => b3.hubTestWriteAllowed(env, p, body).then(x => (x && typeof x === 'object') ? x.ok : x);
  t('guard: one real member in the group refuses the whole batch', await g3('/wo/bid-group/cancel', { group_id: 'BG-T', mode: 'all' }) === false && await g3('/wo/bid-group/unlink', { wo_id: 'WO-T1' }) === false);
  const rt = wsrc.slice(wsrc.indexOf("if (path === '/wo/split')                 return await woSplit(env, body);"));
  t('routes wired: POST /wo/duplicate, /wo/bid-group/unlink, /wo/bid-group/cancel and GET /wo/bid-group', /path === '\/wo\/duplicate'\)\s+return await woDuplicate/.test(rt) && /path === '\/wo\/bid-group\/unlink'\)\s+return await woBidGroupUnlink/.test(rt) && /path === '\/wo\/bid-group\/cancel'\)\s+return await woBidGroupCancel/.test(wsrc) && /path === '\/wo\/bid-group'\)\s+return await woBidGroupGet/.test(wsrc));
  t('admin-only: none of the new paths is in any ROLE_SCOPES list (vendor/tenant/owner sessions are refused)', !/ROLE_SCOPES[\s\S]{0,4000}\/wo\/(duplicate|bid-group)/.test(wsrc.slice(wsrc.indexOf('const ROLE_SCOPES'), wsrc.indexOf('function isPathAllowedForRole'))));
  t('the HTTP body cannot set Bid_Group_ID/Duplicated_From through createWorkOrder (not touched)', !/Bid_Group_ID|Duplicated_From/.test(grab(wsrc, 'async function createWorkOrder(')));
  t('BUILD_VERSION bumped for this feature', /const BUILD_VERSION = '2026-10-1[2-9]\.\d+-[a-z-]+'/.test(wsrc));
  t('no swallowing catch in the new block', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(S.block) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(S.block));
}

console.log(`\nwo-duplicate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
