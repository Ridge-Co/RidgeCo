// Duplicate Work Order + bid groups (Oct 12 2026 build) — offline tests.
// Extracts the REAL functions verbatim out of worker.js and runs them against an in-memory fake
// Sheets backend (same convention as test/wo-split.test.mjs), so this cannot drift from what ships.
// The clock is PINNED (a fake Date is injected into the evaluated code) so the quiet-hours cases do
// not depend on what time of day the suite runs.
import fs from 'fs';
import './_wo-status-global.mjs';   // WOStatus for the sandboxed worker.js functions (queue #140)
// Phase C (Oct 20 2026): worker.js code now calls these shared never-swallow helpers; in this sandbox they are inert stand-ins.
const PHASE_C_SHIM = 'const softNote = () => false, softFail = async () => ({ ok: false }), tryWrite = async (e, w, fn) => { try { return { ok: true, value: await fn() }; } catch (x) { return { ok: false, error: String(x && x.message || x) }; } }, safeJson = async (r, f) => { try { return await r.json(); } catch (x) { return f; } }, parseJsonCell = (r, f) => { if (r === undefined || r === null || (typeof r === "string" && !r.trim())) return f; if (typeof r !== "string") return r; try { return JSON.parse(r); } catch (x) { return f; } };\n';
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
  tenantMovedOut: grab(wsrc, 'function tenantMovedOut('), smsGate: grab(wsrc, 'function smsGateDecision('), smsToggle: grabConst(wsrc, 'const smsToggleOn'), normPhone: grab(wsrc, 'function normalizePhone('),
  mqTab: grabConst(wsrc, "const MSG_QUEUE_TAB = 'Message_Queue';"), mqCols: grabConst(wsrc, 'const MSG_QUEUE_COLS'),
  smsInfraState: grabRange(wsrc, 'const SMS_TOGGLE_TABS', 'async function ensureSmsInfra'), smsInfra: grab(wsrc, 'async function ensureSmsInfra('),
  etHour: grab(wsrc, 'function etHour('), nyOff: grab(wsrc, 'function nyOffsetMinutes('),
  quietConsts: grabConst(wsrc, 'const QUIET_HOURS_START_ET') + '\n' + grabConst(wsrc, 'const QUIET_HOURS_END_ET'),
  isQuiet: grab(wsrc, 'function isQuietHoursNow('), nextQuiet: grab(wsrc, 'function nextQuietHoursEnd('),
  sendRaw: grab(wsrc, 'async function sendSMSRaw('), updMq: grab(wsrc, 'async function updateMessageQueueRow('), fetchConfig: grab(wsrc, 'async function fetchConfig('), fetchConfigStrict: grab(wsrc, 'async function fetchConfigStrict('), smsSev: grab(wsrc, 'function smsFailSeverity('),
  smsGated: grab(wsrc, 'async function smsGatedSend(').replace('async function smsGatedSend(', 'async function __realSmsGatedSend('),
  quietQueue: grab(wsrc, 'async function processQuietHoursQueue('),
  notifyConsts: grabConst(wsrc, 'const OWNER_NOTIFY_DEFAULTS') + '\n' + grabConst(wsrc, 'const NOTIFY_TIERS'), shouldNotify: grab(wsrc, 'async function shouldNotifyOwner('),
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
      if (opts.twilioFail) { const b = { message: 'The \'To\' number is not a valid phone number', code: 21211 }; return { ok: false, status: 400, text: async () => JSON.stringify(b), json: async () => b }; }
      { const b = { sid: 'SM_FAKE' + log.twilio.length }; return { ok: true, status: 201, text: async () => JSON.stringify(b), json: async () => b }; }
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
      const __first = db[m2[1]].rows.length + 2; db[m2[1]].rows.push(...body.values);
      if (opts.onAppend) opts.onAppend(m2[1], body.values, db);
      return { json: async () => ({ updates: { updatedRange: m2[1] + '!A' + __first } }) };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { json: async () => ({ sheets: [] }) };
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

// 2026-10-14 are fixed instants. EDT = UTC-4.
const NOON_ET = Date.UTC(2026, 9, 14, 16, 0, 0);       // 12:00 ET  -> outside quiet hours
const NIGHT_ET = Date.UTC(2026, 9, 15, 2, 30, 0);      // 22:30 ET  -> inside quiet hours (7pm-9am)

function build(db, o = {}) {
  const log = { twilio: [], sms: [] };   // sms = every smsGatedSend call (the gate), recorded by the spy wrapper below
  const fixed = o.now || NOON_ET;
  const src = [
    'const CORS = {};', ['function appendedRowNumber(','function mintNextNumericId(','async function guardAppendedIds(','async function mqReportFailure('].map(s => grab(wsrc, s)).join('\n'), S.cache, S.isMissing, S.sr, S.ensureInner, S.ensure, S.ensureTab, S.idc, S.col, S.json, S.fetchTab, S.fetchTabs, S.findWO,
    S.updateWOFields, S.nextSafeId, S.logAudit, S.logAuditMany, S.logMsgAudit, S.auditCols, S.addRow, S.invalidate, 'async function reportFailure() { return { ok: true }; }', S.telemetry, S.nonShare, S.block,
    S.addonLive, S.isTenantCurrent, S.currentTenant, S.tenantsFor, S.isBackground, S.isNotifiable, S.tenantMovedOut, S.smsGate, S.smsToggle, S.normPhone, S.mqTab, S.mqCols,
    S.smsInfraState, S.smsInfra, S.etHour, S.nyOff, S.quietConsts, S.isQuiet, S.nextQuiet, S.sendRaw, S.updMq, S.fetchConfig, S.fetchConfigStrict, S.smsSev, 'async function reportFailure() { return { ok: true }; }', S.smsGated,
    'async function smsGatedSend(env, o) { __spy.push({ wo_id: o.wo_id, message_type: o.message_type, recipient_type: o.recipient_type, vendor_id: o.vendor && o.vendor.ID, vendor_name: o.vendor && o.vendor.Name, body: o.message_body, already_localized: o.already_localized, original_body: o.original_body, bypassQuietHours: o.bypassQuietHours === true }); return await __realSmsGatedSend(env, o); }',
    S.quietQueue, S.portalLink, S.unitLabel, S.phoneDisp, S.jobLabel, S.voidCols, S.splitMax, S.splitFields, S.testMarker, S.openStatuses,
    // stubs for unrelated collaborators (not under test here)
    'async function createVendorNudgeClock() {}', 'async function resetVendorNudgeClock() {}',
    'async function translateForVendorDetailed(env, vendor, text) { return { translated: false, text }; }',
    'async function translateToEnglish(env, t) { return t; }', 'async function sendSMS() {}', S.notifyConsts, o.realOwnerNotify ? S.shouldNotify : 'async function shouldNotifyOwner() { return false; }',
    'async function releaseTurnoverCleaningIfReady() {}', 'async function findLockedVendorBillForWOs() { return null; }',
    'function enrichWO(wo) { return { ID: wo.ID, Vendor_ID: wo.Vendor_ID, Status: wo.Status }; }',
    'async function logSMS() {}',
    S.assign, S.updateStatus, S.ownerWOs, S.woCombine, S.woSplit, S.isTestWO, S.isTestRecord, S.hubGuard,
    'return { processQuietHoursQueue, bidCancelVendorMessage, bidCancelVendorPlan, bidWinnerNotifyPlan, bidWinnerNotifyDiff, vendorSmsDetailFromResult, woDuplicate, woBidGroupUnlink, woBidGroupGet, woBidGroupCancel, assignVendor, updateStatus, bidGroupWriteBlock, bidCancelClassify, nextBidGroupId, woDupResetChecklist, ownerWorkorders, woCombine, woSplit, hubTestWriteAllowed, isBidGroupWO, woDupAppendCopy, woDupSerialize, __woDupTapCache };',
  ].join('\n');
  class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } }
  const api = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date', '__spy', PHASE_C_SHIM + src)(async () => 'tok', makeFetch(db, o, log), (fn) => fn(), FD, log.sms);
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
  t('accepted copy: cancellable WITH a warning that the vendor has accepted and WILL be texted it is cancelled (Oct 13 follow-up #2)', k({ ID: 'X', Status: 'Accepted' }).warnings.some(w => /already accepted/.test(w) && /will be texted that it is cancelled/.test(w)) && !k({ ID: 'X', Status: 'Accepted' }).warnings.some(w => /NOT be told/.test(w)));
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
  t('plus a Bid_Group_Cancel audit row per cancel stating what happened to the vendor text', tab(db, 'WO_Audit').filter(a => a.Field === 'Bid_Group_Cancel').length === 2 && tab(db, 'WO_Audit').filter(a => a.Field === 'Bid_Group_Cancel').every(a => /Vendor text: sent/.test(a.Notes)));
  t('ONLY the two cancelled copies\' vendors were texted (Oct 13 follow-up #2); the skipped one, the kept original and the tenant/owner were not', tab(db, 'Message_Queue').length === 2 && tab(db, 'Message_Queue').every(q => q.Message_Type === 'vendor_job_cancelled' && q.Recipient_Type === 'vendor') && b.log.twilio.length === 2);
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
  t('keep_one: the chosen WO stays open; the other COPIES are cancelled (Complete skipped); the ORIGINAL is never cancelled (Oct 13 follow-up)', k.body.ok && wf(db, 'WO-1250', 'Status') === 'Assigned' && wf(db, 'WO-1239', 'Status') === 'Accepted' && wf(db, 'WO-1252', 'Status') === 'Cancelled' && wf(db, 'WO-1251', 'Status') === 'Complete');
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
  t('BUILD_VERSION bumped for this feature', /const BUILD_VERSION = '2026-10-(1[2-9]|2\d|3[01])\.\d+-[a-z-]+'/.test(wsrc));   // widened Oct 20 2026: a pinned date range broke on every later build
  t('no swallowing catch in the new block', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(S.block) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(S.block));
}

// ── 16. FOLLOW-UP (Oct 13 2026): "Keep this" never cancels the ORIGINAL; a kept COPY becomes tenant-visible ─────────
// Brett: keep_one must cancel only the duplicate copies that are not the winner. "Yes, winning becomes visible to
// tenant" = Tenant_Visible TRUE on the winning copy, and NO SMS of any kind. Unlinking leaves Tenant_Visible alone.
{
  const winnerDb = async () => {
    const { db, set } = await groupOf4();
    for (const id of ['WO-1250', 'WO-1251', 'WO-1252']) set(id, 'Tenant_Visible', 'FALSE');   // exactly how /wo/duplicate stamps a copy
    set('WO-1239', 'Tenant_Visible', 'TRUE');
    return { db, set };
  };
  // (a) winner is a COPY: original stays active and untouched, other live copies cancelled, winner visible
  {
    const { db } = await winnerDb(); const b = build(db, { allowTwilio: true });
    const pv = (await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252' }))).body;
    const by = Object.fromEntries(pv.results.map(x => [x.wo_id, x]));
    t('preview keep_one(copy): the ORIGINAL is kept, not targeted', by['WO-1239'].result === 'kept' && /original/i.test(by['WO-1239'].reasons.join()));
    t('preview keep_one(copy): only the other live copy would be cancelled; Complete one skipped', by['WO-1250'].result === 'would_cancel' && by['WO-1251'].result === 'would_skip' && pv.summary.would_cancel === 1);
    t('preview states the winner will become tenant-visible (nothing written yet)', pv.winner && pv.winner.wo_id === 'WO-1252' && pv.winner.is_original === false && pv.winner.will_become_tenant_visible === true && pv.winner.became_tenant_visible === false && wf(db, 'WO-1252', 'Tenant_Visible') === 'FALSE');
    t('preview wrote nothing to the winner (no Bid_Winner column added either)', !db.Work_Orders.headers.includes('Bid_Winner') && wf(db, 'WO-1250', 'Status') === 'Assigned');
    const snapQ = JSON.stringify(db.Message_Queue.rows);
    const r = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true, updated_by: 'Brett' }));
    t('confirm keep_one(copy): 200 ok, no errors', r.status === 200 && r.body.ok === true && r.body.errors.length === 0);
    t('original WO-1239 is NOT cancelled (still Accepted, same vendor)', wf(db, 'WO-1239', 'Status') === 'Accepted' && wf(db, 'WO-1239', 'Vendor_ID') === '2' && by['WO-1239'] && r.body.results.find(x => x.wo_id === 'WO-1239').result === 'kept');
    t('the other live copy WO-1250 is cancelled; Complete WO-1251 is skipped; winner stays open', wf(db, 'WO-1250', 'Status') === 'Cancelled' && wf(db, 'WO-1251', 'Status') === 'Complete' && wf(db, 'WO-1252', 'Status') === 'Assigned');
    t('winning copy is now Tenant_Visible TRUE and marked Bid_Winner TRUE (read back)', wf(db, 'WO-1252', 'Tenant_Visible') === 'TRUE' && wf(db, 'WO-1252', 'Bid_Winner') === 'TRUE');
    t('the losing copies are NOT made visible and are not marked winner', wf(db, 'WO-1250', 'Tenant_Visible') === 'FALSE' && wf(db, 'WO-1251', 'Tenant_Visible') === 'FALSE' && wf(db, 'WO-1250', 'Bid_Winner') !== 'TRUE' && wf(db, 'WO-1239', 'Bid_Winner') !== 'TRUE');
    t('result reports the winner became tenant-visible', r.body.winner && r.body.winner.became_tenant_visible === true && r.body.winner.wo_id === 'WO-1252');
    t('NO text to the tenant or owner at keep time; the only queued text is the losing copy\'s vendor cancellation', tab(db, 'Message_Queue').length === 1 && tab(db, 'Message_Queue')[0].Message_Type === 'vendor_job_cancelled' && tab(db, 'Message_Queue')[0].WO_ID === 'WO-1250' && b.log.twilio.length === 1 && JSON.stringify(db.Message_Queue.rows) !== snapQ);
    t('the kept winner\'s vendor and the original\'s vendor were NOT texted', !b.log.sms.some(c => c.wo_id === 'WO-1252' || c.wo_id === 'WO-1239') && wf(db, 'WO-1252', 'Tenant_SMS_Sent') !== 'TRUE');
    t('WO_Audit has a Tenant_Visible FALSE->TRUE row for the winner', tab(db, 'WO_Audit').some(a => a.WO_ID === 'WO-1252' && a.Field === 'Tenant_Visible' && a.Old_Value === 'FALSE' && a.New_Value === 'TRUE' && a.Changed_By === 'Brett' && /no text/i.test(a.Notes)));
    t('telemetry row for the cancel is Success TRUE and names the winner', tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel' && x.Success === 'TRUE' && /keep=WO-1252/.test(x.Notes)));
    // idempotent re-run: nothing breaks, no second Tenant_Visible audit row
    const again = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
    t('re-running the same keep_one is clean and does not re-audit visibility', again.body.ok && again.body.winner.became_tenant_visible === false && again.body.winner.already_visible === true && tab(db, 'WO_Audit').filter(a => a.WO_ID === 'WO-1252' && a.Field === 'Tenant_Visible').length === 1);
    // owner portal: winner (still linked) is shown; a still-linked non-winner copy stays hidden
    db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => ({ ID: 'L9', Property_ID: '70', Status: 'Assigned', Duplicated_From: 'WO-1239', Bid_Group_ID: 'BG-1001', Tenant_Visible: 'FALSE' }[h] ?? '')));
    const ow = await call(b.ownerWorkorders(env, new URL('https://x/owner-workorders?owner_id=5')));
    const oids = ow.body.map(w => w.ID);
    t('owner portal: the winning copy (still linked to the group) IS shown', oids.includes('WO-1252'));
    t('owner portal: the original is shown; a still-linked non-winner copy is still hidden', oids.includes('WO-1239') && !oids.includes('L9') && !oids.includes('WO-1250'));
  }
  // (b) winner is the ORIGINAL: copies cancelled, original untouched, nothing made visible/winner
  {
    const { db } = await winnerDb(); const b = build(db, { allowTwilio: true });
    const pv = (await call(b.woBidGroupCancel(env, { wo_id: 'WO-1250', mode: 'keep_one', keep_wo_id: 'WO-1239' }))).body;
    t('preview keep_one(original): winner is the original, no visibility change planned', pv.winner.is_original === true && pv.winner.will_become_tenant_visible === false);
    const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1250', mode: 'keep_one', keep_wo_id: 'WO-1239', confirm: true }));
    t('keep_one(original): all live copies cancelled, original untouched and active', r.body.ok && wf(db, 'WO-1239', 'Status') === 'Accepted' && wf(db, 'WO-1250', 'Status') === 'Cancelled' && wf(db, 'WO-1252', 'Status') === 'Cancelled');
    t('keep_one(original): no Tenant_Visible/Bid_Winner writes, no audit for them', wf(db, 'WO-1239', 'Tenant_Visible') === 'TRUE' && wf(db, 'WO-1252', 'Tenant_Visible') === 'FALSE' && !tab(db, 'WO_Audit').some(a => a.Field === 'Tenant_Visible' || a.Field === 'Bid_Winner') && r.body.winner.became_tenant_visible === false);
    t('keep_one(original): only the two cancelled copies\' vendors are texted (no tenant/owner text, original\'s vendor not texted)', tab(db, 'Message_Queue').length === 2 && tab(db, 'Message_Queue').every(q => q.Recipient_Type === 'vendor' && ['WO-1250', 'WO-1252'].includes(q.WO_ID)) && b.log.twilio.length === 2);
  }
  // (c) original is protected EVEN IF it is cancellable and the winner is a copy (explicit regression for decision 1); 'all' still cancels it
  {
    const { db } = await winnerDb(); const b = build(db, { allowTwilio: true });
    await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'keep_one', keep_wo_id: 'WO-1250', confirm: true }));
    t('regression: keep_one never cancels the original (before this follow-up it did)', wf(db, 'WO-1239', 'Status') === 'Accepted');
    const { db: db2 } = await winnerDb(); const b2 = build(db2);
    await call(b2.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'all', confirm: true }));
    t('"Cancel whole group" (mode all) is unchanged: it still cancels the original', wf(db2, 'WO-1239', 'Status') === 'Cancelled');
  }
  // (d) winner write fails -> NOTHING is cancelled, error is returned and logged (a downstream effect never fires after a failed write)
  {
    const { db } = await winnerDb();
    const b = build(db, { allowTwilio: true, throwOnWrite: (path, method, body) => method === 'POST' && path === '/values:batchUpdate' && /Tenant_Visible|"TRUE"/.test(String(body)) && !/Cancelled/.test(String(body)) && String(body).includes('"TRUE"') });
    const r = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
    t('failed winner write: 500, ok false, error names the winner', r.status === 500 && r.body.ok === false && r.body.errors.some(e => /WO-1252/.test(e)));
    t('failed winner write: no member was cancelled', woRows(db).every(w => w.Status !== 'Cancelled'));
    t('failed winner write is logged to Ops_Telemetry as a failure', tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel' && x.Success === 'FALSE' && /WO-1252/.test(x.Notes)));
  }
  // (e) a cancelled / voided winner is refused (would leave nothing alive)
  {
    const { db, set } = await winnerDb(); const b = build(db);
    set('WO-1250', 'Status', 'Cancelled'); set('WO-1252', 'Voided', 'TRUE');
    const r1 = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1250', confirm: true }));
    const r2 = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252' }));
    t('keep_one on a cancelled member is a clear 400 (also in preview), nothing changes', r1.status === 400 && /cancelled/i.test(r1.body.error) && r2.status === 400 && /voided/i.test(r2.body.error) && wf(db, 'WO-1239', 'Status') === 'Accepted');
  }
  // (f) switching the winner: Brett earlier kept WO-1250, now keeps WO-1252 -> the old marker is cleared
  {
    const { db, set } = await winnerDb();
    db.Work_Orders.headers.push('Bid_Winner'); db.Work_Orders.rows.forEach(r => r.push(''));
    set('WO-1250', 'Bid_Winner', 'TRUE'); set('WO-1250', 'Tenant_Visible', 'TRUE');
    const b = build(db);
    const r = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
    t('re-choosing a different winner moves the marker (old winner is cancelled and no longer marked)', r.status === 200 && wf(db, 'WO-1252', 'Bid_Winner') === 'TRUE' && wf(db, 'WO-1250', 'Bid_Winner') === '' && wf(db, 'WO-1250', 'Status') === 'Cancelled' && wf(db, 'WO-1252', 'Tenant_Visible') === 'TRUE');
  }
  // (g) Unlink leaves Tenant_Visible exactly as it is (both values); duplicates/all modes never touch visibility
  {
    const { db } = await winnerDb(); const b = build(db);
    await call(b.woBidGroupUnlink(env, { wo_id: 'WO-1250' }));
    t('unlink a hidden copy: Tenant_Visible stays FALSE', wf(db, 'WO-1250', 'Bid_Group_ID') === '' && wf(db, 'WO-1250', 'Tenant_Visible') === 'FALSE');
    const { db: d2, set } = await winnerDb(); set('WO-1252', 'Tenant_Visible', 'TRUE'); const b2 = build(d2);
    await call(b2.woBidGroupUnlink(env, { wo_id: 'WO-1252' }));
    t('unlink a visible copy: Tenant_Visible stays TRUE', wf(d2, 'WO-1252', 'Bid_Group_ID') === '' && wf(d2, 'WO-1252', 'Tenant_Visible') === 'TRUE');
    const { db: d3 } = await winnerDb(); const b3 = build(d3);
    await call(b3.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
    t('mode duplicates never changes any Tenant_Visible', ['WO-1250', 'WO-1251', 'WO-1252'].every(id => wf(d3, id, 'Tenant_Visible') === 'FALSE') && wf(d3, 'WO-1239', 'Tenant_Visible') === 'TRUE');
    t('unlink code does not touch Tenant_Visible at all', !/Tenant_Visible/.test(grab(wsrc, 'async function woBidGroupUnlink(')));
  }
  // (h) GET /wo/bid-group exposes the winner + visibility for the Hub panel
  {
    const { db } = await winnerDb(); const b = build(db);
    await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
    const g = (await call(b.woBidGroupGet(env, new URL('https://x/wo/bid-group?wo_id=WO-1252')))).body;
    const m = Object.fromEntries(g.members.map(x => [x.id, x]));
    t('GET /wo/bid-group: winner flagged with tenant_visible; others not', m['WO-1252'].is_winner === true && m['WO-1252'].tenant_visible === true && m['WO-1250'].is_winner === false && m['WO-1250'].tenant_visible === false);
  }
  // (i) tenant portal: the winner is no longer filtered out (the same predicate tenantWorkorders uses)
  {
    // Oct 14 2026 (#150): the predicate moved into tenantCanSeeWO so /attachments shares it; tenantWorkorders calls it.
    const tw = grab(wsrc, 'async function tenantWorkorders(').slice(0, 2500);
    const tcs = grab(wsrc, 'function tenantCanSeeWO(');
    t('tenant portal hides only Tenant_Visible === "FALSE" (so TRUE shows the winner)', /w\.Tenant_Visible === 'FALSE'\) return false/.test(tcs) && /tenantCanSeeWO\(tenant, w\)/.test(tw));
  }
  // (j) source-level guards
  {
    const cancelSrc = grab(wsrc, 'async function woBidGroupCancel(');
    const notifySrc = grab(wsrc, 'async function bidCancelNotifyVendor(');
    t('cancel code: the ONLY way it texts is bidCancelNotifyVendor -> smsGatedSend with recipient_type vendor (never tenant/owner/sendSMS/assign/queueNotification)', !/sendSMS|smsGatedSend|assignVendor|queueMessage|queueNotification|notifyTenant/.test(cancelSrc) && /smsGatedSend\(env, \{[^}]*recipient_type: 'vendor'/.test(notifySrc) && !/recipient_type: '(tenant|owner)'/.test(notifySrc + cancelSrc) && /bidCancelNotifyVendor\(/.test(cancelSrc));
    t('cancel code: no swallowing catch', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(cancelSrc));
    t('BUILD_VERSION bumped to the follow-up value (or a later build)', /const BUILD_VERSION = '2026-10-(1[3-9]|2\d|3[01])\.\d+-[a-z-]+'/.test(wsrc));
  }
}

// ── 17. FOLLOW-UP #2 (Oct 13 2026, Brett): "tell the vendor." + "kept copy notifies according to that work order's settings." ──
// Build 1: executing a cancel texts the assigned vendor of every copy that REALLY got cancelled (never on a preview, never twice,
// quiet hours respected, failures returned + logged, a failed text never undoes the cancel). Build 2: a kept COPY starts notifying like
// its original work order; no "new work order" blast at keep time.
const twi = (b) => b.log.twilio.map(x => { const p = new URLSearchParams(x); return { to: p.get('To'), body: p.get('Body') }; });
const MORNING_NEXT = Date.UTC(2026, 9, 15, 14, 0, 0);   // 10:00 ET the next morning
const stamp = (set, ids) => { for (const id of ids || ['WO-1250', 'WO-1251', 'WO-1252']) { set(id, 'Tenant_Visible', 'FALSE'); set(id, 'Tenant_Notify_Created', 'FALSE'); set(id, 'Tenant_Notify_Updates', 'FALSE'); set(id, 'Owner_Notify_Override', 'off'); } };
const EN_1250 = '[WO-1250] CANCELLED: the job at 931 Saint Paul St Unit 2 is no longer needed. Please do not do this work. Thank you.';
const ES_1252 = '[WO-1252] CANCELADO: el trabajo de Painting en 931 Saint Paul St Unit 2 ya no es necesario. Por favor no realice este trabajo. Gracias.';
const EN_1252 = '[WO-1252] CANCELLED: the Painting job at 931 Saint Paul St Unit 2 is no longer needed. Please do not do this work. Thank you.';
{
  // 17a. wording + pure plan
  const b = build(makeDb());
  const en = b.bidCancelVendorMessage('WO-1252', 'Painting', '931 Saint Paul St Unit 2', false), es = b.bidCancelVendorMessage('WO-1252', 'Painting', '931 Saint Paul St Unit 2', true);
  t('wording EN is exactly the agreed short text with WO number, trade and address', en.text === EN_1252 && en.language === 'en');
  t('wording ES is exactly the agreed short text and keeps the English as .en', es.text === ES_1252 && es.language === 'es' && es.en === EN_1252);
  t('no trade -> "the job" / "el trabajo"', b.bidCancelVendorMessage('WO-1', '', 'X', false).text === '[WO-1] CANCELLED: the job at X is no longer needed. Please do not do this work. Thank you.' && b.bidCancelVendorMessage('WO-1', '', 'X', true).text === '[WO-1] CANCELADO: el trabajo en X ya no es necesario. Por favor no realice este trabajo. Gracias.');
  t('texts carry no tenant/owner info, no phone numbers, no money', !/Tina|Olive|tenant|owner|inquilino|\$|\+1/i.test(en.text + es.text));
  t('texts fit in 2 SMS segments (< 320 chars) even with a long address', b.bidCancelVendorMessage('WO-1252', 'General Maintenance', '1234 Some Very Long Street Name Avenue Unit 12B (Back Bedroom)', true).text.length < 320);
  const row = { wo_id: 'WO-9', vendor_id: '3', vendor_name: 'Cesar Diaz' }, prop = { Address: '1 A St' }, vcz = { ID: '3', Name: 'Cesar Diaz', Phone: '+12407051090', Language: 'es' };
  const pl = (vendor, kept) => b.bidCancelVendorPlan(row, vendor, { Trade: 'Painting' }, prop, null, kept || new Map());
  t('plan: assigned vendor with a phone -> will_send in their language', pl(vcz).status === 'will_send' && pl(vcz).language === 'es' && /CANCELADO/.test(pl(vcz).message_body) && /CANCELLED/.test(pl(vcz).message_en));
  t('plan: no vendor -> skipped; unknown vendor / no phone -> cannot_send; vendor holding a job that stays open -> skipped',
    b.bidCancelVendorPlan({ wo_id: 'W', vendor_id: '' }, null, {}, null, null, new Map()).status === 'skipped' && pl(null).status === 'cannot_send' && pl({ ID: '3', Name: 'X', Phone: '' }).status === 'cannot_send' && pl(vcz, new Map([['3', 'WO-1']])).status === 'skipped' && /WO-1/.test(pl(vcz, new Map([['3', 'WO-1']])).reason));
}
{
  // 17b. PREVIEW never texts and says exactly who will be told
  const { db, set } = await groupOf4(); set('WO-1252', 'Trade', 'Painting'); const b = build(db, { allowTwilio: true });
  for (const body of [{ wo_id: 'WO-1239', mode: 'all' }, { wo_id: 'WO-1239', mode: 'all', dry_run: true }, { wo_id: 'WO-1239', mode: 'all', dry_run: true, confirm: true }, { wo_id: 'WO-1239', mode: 'all', confirm: 'yes' }, { wo_id: 'WO-1239', mode: 'keep_one', keep_wo_id: 'WO-1252' }, { wo_id: 'WO-1239', mode: 'duplicates' }])
    await call(b.woBidGroupCancel(env, body));
  t('6 preview variants: the SMS gate is NEVER called, no queue row, no Twilio call', b.log.sms.length === 0 && tab(db, 'Message_Queue').length === 0 && b.log.twilio.length === 0);
  const p = (await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'all' }))).body;
  const by = Object.fromEntries(p.results.map(x => [x.wo_id, x]));
  t('preview: each cancel target has a vendor_sms plan naming who will be texted', by['WO-1252'].vendor_sms.status === 'will_send' && by['WO-1252'].vendor_sms.reason === 'Cesar Diaz will be texted that WO-1252 is cancelled.' && by['WO-1250'].vendor_sms.status === 'will_send' && by['WO-1239'].vendor_sms.status === 'will_send');
  t('preview shows the exact text the vendor gets (Spanish for Cesar, English underneath)', by['WO-1252'].vendor_sms.message_body === ES_1252 && by['WO-1252'].vendor_sms.message_en === EN_1252 && by['WO-1250'].vendor_sms.message_body === EN_1250);
  t('preview: the Complete (skipped) member is not texted', by['WO-1251'].result === 'would_skip' && by['WO-1251'].vendor_sms.status === 'skipped');
  t('preview: summary.would_text counts the vendors and the notices say who', p.summary.would_text === 3 && p.vendor_text_notices.filter(n => n.level === 'ok').map(n => n.text).includes('Cesar Diaz will be texted that WO-1252 is cancelled.') && p.vendor_text_notices.filter(n => n.level === 'ok').length === 3);
  t('preview: noon ET -> no quiet-hours warning', p.quiet_hours_now === false && !p.warnings.some(w => /quiet hours/i.test(w)));
  const k = (await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252' }))).body;
  t('preview keep_one: only the cancelled copy\'s vendor is named; the winner\'s vendor (Cesar) and the original\'s (Alex) are NOT', k.summary.would_text === 1 && k.vendor_text_notices.length === 1 && /TEST-VENDOR-001 will be texted that WO-1250/.test(k.vendor_text_notices[0].text) && k.results.find(x => x.wo_id === 'WO-1252').vendor_sms.status === 'skipped' && k.results.find(x => x.wo_id === 'WO-1239').vendor_sms.status === 'skipped');
  set('WO-1251', 'Status', 'Assigned');   // vendor 4 has no phone
  const np = (await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates' }))).body;
  t('preview: a vendor with no phone is flagged as CANNOT be texted (bad level) before Brett confirms', np.results.find(x => x.wo_id === 'WO-1251').vendor_sms.status === 'cannot_send' && np.vendor_text_notices.some(n => n.level === 'bad' && /No Phone Co/.test(n.text)) && np.summary.would_text === 2);
  const bn = build(db, { allowTwilio: true, now: NIGHT_ET });
  const nq = (await call(bn.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates' }))).body;
  t('preview at 10:30pm ET: says the texts will be held until after 9am', nq.quiet_hours_now === true && nq.warnings.some(w => /quiet hours/i.test(w) && /held/.test(w)) && bn.log.sms.length === 0);
  t('preview wrote no WO_Audit rows and no status changes', tab(db, 'WO_Audit').length === 0 && woRows(db).every(w => w.Status !== 'Cancelled'));
}
{
  // 17c. EXECUTE (noon): the SMS gate is called once per cancelled copy with the right vendor and WO
  const { db, set } = await groupOf4(); set('WO-1252', 'Trade', 'Painting'); const b = build(db, { allowTwilio: true });
  const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true, updated_by: 'Brett' }));
  t('confirm: 200 ok, 2 cancelled, nothing to attend to', r.status === 200 && r.body.ok === true && r.body.summary.cancelled === 2 && r.body.needs_attention === false && r.body.errors.length === 0);
  t('SMS gate called exactly twice: WO-1250 -> vendor 8 and WO-1252 -> vendor 3, type vendor_job_cancelled, vendor recipient', b.log.sms.length === 2 && b.log.sms.every(c => c.message_type === 'vendor_job_cancelled' && c.recipient_type === 'vendor') && b.log.sms.some(c => c.wo_id === 'WO-1250' && c.vendor_id === '8') && b.log.sms.some(c => c.wo_id === 'WO-1252' && c.vendor_id === '3'));
  t('hand-built bilingual text goes through (already_localized), Spanish for Cesar with the English kept as Original_Body', b.log.sms.every(c => c.already_localized === true) && b.log.sms.find(c => c.wo_id === 'WO-1252').body === ES_1252 && b.log.sms.find(c => c.wo_id === 'WO-1252').original_body === EN_1252 && b.log.sms.find(c => c.wo_id === 'WO-1250').body === EN_1250 && b.log.sms.find(c => c.wo_id === 'WO-1250').original_body === '');
  t('the quiet-hours bypass is NOT used (a cancellation notice is not urgent)', b.log.sms.every(c => c.bypassQuietHours === false));
  const w = twi(b);
  t('exactly 2 Twilio sends: Cesar (Spanish) and TEST-VENDOR (English); nobody else', w.length === 2 && w.some(x => x.to === '+12407051090' && x.body === ES_1252) && w.some(x => x.to === '+14105557777' && x.body === EN_1250));
  t('no text to the tenant (Tina), owner (Olive), the original\'s vendor (Alex) or the Complete copy\'s vendor', !w.some(x => ['+14105551111', '+14105552222', '+14436172152'].includes(x.to)));
  const mq = tab(db, 'Message_Queue');
  t('Message_Queue: 2 sent vendor rows, WO ids right, gates open, Spanish row keeps its English original', mq.length === 2 && mq.every(q => q.Status === 'sent' && q.Message_Type === 'vendor_job_cancelled' && q.Recipient_Type === 'vendor' && q.Gate_Snapshot === 'all gates open') && mq.find(q => q.WO_ID === 'WO-1252').Original_Body === EN_1252 && mq.find(q => q.WO_ID === 'WO-1252').Translated_To === 'es');
  const by = Object.fromEntries(r.body.results.map(x => [x.wo_id, x]));
  t('per-vendor outcome returned on each row: sent + reason + language', by['WO-1252'].vendor_sms.status === 'sent' && by['WO-1252'].vendor_sms.language === 'es' && by['WO-1250'].vendor_sms.status === 'sent' && by['WO-1250'].vendor_sms.language === 'en' && by['WO-1251'].vendor_sms.status === 'skipped');
  t('summary.vendor_texts and vendor_texts[] report 2 sent', r.body.summary.vendor_texts.sent === 2 && r.body.vendor_texts.length === 2 && r.body.vendor_texts.every(x => x.status === 'sent'));
  t('the vendor of the kept ORIGINAL (Alex) was not texted', !b.log.sms.some(c => c.vendor_id === '2'));
  t('each Bid_Group_Cancel audit row records the vendor text outcome', tab(db, 'WO_Audit').filter(a => a.Field === 'Bid_Group_Cancel').every(a => /Vendor text: sent/.test(a.Notes)));
  t('per-WO SMS audit rows exist (who was texted, what)', tab(db, 'WO_Audit').filter(a => a.Field === 'SMS' && a.Message_Type === 'vendor_job_cancelled').length === 2);
  t('telemetry: one wo_bid_cancel_vendor_sms row per text, Success TRUE, with WO + vendor', tab(db, 'Ops_Telemetry').filter(x => x.Job_Type === 'wo_bid_cancel_vendor_sms' && x.Success === 'TRUE').length === 2 && tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel_vendor_sms' && /WO-1252 vendor=3 status=sent/.test(x.Notes)));
  t('cancel telemetry carries the text counts', tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel' && /"sent":2/.test(x.Notes)));
  t('the texts were sent only AFTER the statuses were verified Cancelled', wf(db, 'WO-1250', 'Status') === 'Cancelled' && wf(db, 'WO-1252', 'Status') === 'Cancelled');
  // mode all: the original IS cancelled, so its vendor is told
  const { db: d2 } = await groupOf4(); const b2 = build(d2, { allowTwilio: true });
  const ra = await call(b2.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'all', confirm: true }));
  t('mode all: the original is cancelled AND its vendor (Alex) is texted, with trade + unit + room', ra.body.summary.cancelled === 3 && b2.log.sms.some(c => c.wo_id === 'WO-1239' && c.vendor_id === '2' && c.body === '[WO-1239] CANCELLED: the Painting job at 931 Saint Paul St Unit 2 (Kitchen) is no longer needed. Please do not do this work. Thank you.') && b2.log.sms.length === 3);
  // keep_one: only losers are told
  const { db: d3 } = await groupOf4(); stampSilent(d3); const b3 = build(d3, { allowTwilio: true });
  const rk = await call(b3.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
  t('keep_one(copy): only WO-1250\'s vendor is texted; the winner\'s vendor (Cesar), the original\'s (Alex) and the Complete copy\'s are not', rk.body.ok && b3.log.sms.length === 1 && b3.log.sms[0].wo_id === 'WO-1250');
}
function stampSilent(db) { const set = (id, k, v) => { db.Work_Orders.rows.find(r => r[1] === id)[db.Work_Orders.headers.indexOf(k)] = v; }; stamp(set); }
{
  // 17d. QUIET HOURS: held (not bypassed), cancel still done, released later by the scheduler's sweep
  const { db, set } = await groupOf4(); set('WO-1252', 'Trade', 'Painting'); const b = build(db, { allowTwilio: true, now: NIGHT_ET });
  const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('10:30pm ET: cancels done, both vendor texts HELD, no Twilio call, not flagged as a failure', r.status === 200 && r.body.ok && r.body.summary.cancelled === 2 && r.body.summary.vendor_texts.held === 2 && r.body.summary.vendor_texts.failed === 0 && b.log.twilio.length === 0 && r.body.needs_attention === false && !r.body.warnings.some(x => /FAILED/.test(x)));
  t('held rows say when they go out', r.body.vendor_texts.every(x => x.status === 'held' && /Held for quiet hours/.test(x.reason) && /2026-10-15T13:00:00\.000Z/.test(x.reason)));
  const mq = tab(db, 'Message_Queue');
  t('queue rows are pending with Send_After = 9:00am ET next morning, and the bypass flag was off', mq.length === 2 && mq.every(q => q.Status === 'pending' && q.Send_After === '2026-10-15T13:00:00.000Z') && b.log.sms.every(c => c.bypassQuietHours === false));
  const later = build(db, { allowTwilio: true, now: MORNING_NEXT });
  const rel = await later.processQuietHoursQueue(env);
  t('the scheduler sweep (processQuietHoursQueue) releases them at 10am: both sent, to the right numbers', rel.checked === 2 && rel.results.every(x => x.sent) && twi(later).length === 2 && twi(later).some(x => x.to === '+12407051090' && x.body === ES_1252) && tab(db, 'Message_Queue').every(q => q.Status === 'sent'));
  const again = await call(later.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('a retried confirm after the release sends nothing more', again.body.summary.cancelled === 0 && again.body.summary.already_cancelled === 2 && later.log.sms.length === 0 && twi(later).length === 2);
}
{
  // 17e. IDEMPOTENT: never twice
  const { db, set } = await groupOf4(); const b = build(db, { allowTwilio: true });
  await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  const r2 = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('second confirm on already-cancelled copies: nothing cancelled, nothing texted, gate not called again', r2.body.summary.cancelled === 0 && r2.body.summary.already_cancelled === 2 && b.log.sms.length === 2 && b.log.twilio.length === 2 && tab(db, 'Message_Queue').length === 2 && r2.body.results.filter(x => x.result === 'already_cancelled').every(x => x.vendor_sms.status === 'skipped'));
  const { db: d2 } = await groupOf4(); const b2 = build(d2, { allowTwilio: true });
  const [x, y] = await Promise.all([b2.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }), b2.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true })].map(call));
  t('two simultaneous confirms: still exactly one text per cancelled WO', b2.log.sms.length === 2 && b2.log.twilio.length === 2 && x.body.summary.cancelled + y.body.summary.cancelled === 2);
  // belt and braces: a WO that was re-opened by hand and cancelled again does not get a second text (one queued/sent text per WO is the rule)
  const sets = (id, k, v) => { d2.Work_Orders.rows.find(r => r[1] === id)[d2.Work_Orders.headers.indexOf(k)] = v; };
  sets('WO-1250', 'Status', 'Assigned');
  const r3 = await call(b2.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('re-opened then cancelled again: no second text, and it says why', r3.body.summary.cancelled === 1 && b2.log.sms.length === 2 && r3.body.results.find(z => z.wo_id === 'WO-1250').vendor_sms.status === 'skipped' && /already sent/.test(r3.body.results.find(z => z.wo_id === 'WO-1250').vendor_sms.reason));
  // a vendor with two cancelled copies gets one text per WO
  const { db: d4, set: s4 } = await groupOf4(); s4('WO-1250', 'Vendor_ID', '3'); const b4 = build(d4, { allowTwilio: true });
  await call(b4.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
  t('one vendor on two cancelled copies: one text per WO (two), each naming its own WO', b4.log.sms.length === 2 && new Set(b4.log.sms.map(c => c.wo_id)).size === 2 && twi(b4).every(x => x.to === '+12407051090') && twi(b4).some(x => /WO-1250/.test(x.body)) && twi(b4).some(x => /WO-1252/.test(x.body)));
}
{
  // 17f. FAILURES: returned + logged, never swallowed, never undo or block the cancel
  const failCase = async (label, prep, opts, check) => {
    const { db, set } = await groupOf4(); prep && prep(db, set); const b = build(db, Object.assign({ allowTwilio: true }, opts || {}));
    const r = await call(b.woBidGroupCancel((opts && opts.env) || env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
    check(r, db, b, label);
  };
  const cancelledOk = (db) => wf(db, 'WO-1250', 'Status') === 'Cancelled' && wf(db, 'WO-1252', 'Status') === 'Cancelled';
  const telFail = (db, re) => tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel_vendor_sms' && x.Success === 'FALSE' && re.test(x.Notes));
  await failCase('Twilio switched off', (db) => { db.Config.rows.find(r => r[0] === 'TWILIO_ENABLED')[1] = 'FALSE'; }, {}, (r, db, b, l) => {
    t(`${l}: both cancels stand, 200, ok true`, r.status === 200 && r.body.ok === true && cancelledOk(db));
    t(`${l}: each vendor_sms is FAILED with the gate reason`, r.body.vendor_texts.length === 2 && r.body.vendor_texts.every(x => x.status === 'failed' && /Blocked.*Global OFF/.test(x.reason)) && r.body.summary.vendor_texts.failed === 2);
    t(`${l}: needs_attention + a warning per failed text telling Brett to call`, r.body.needs_attention === true && r.body.warnings.filter(w => /Vendor text FAILED/.test(w) && /call them/.test(w)).length === 2);
    t(`${l}: logged to Ops_Telemetry as failures with the WO ids`, telFail(db, /WO-1250/) && telFail(db, /WO-1252/) && b.log.twilio.length === 0);
    t(`${l}: the audit row says the text failed`, tab(db, 'WO_Audit').filter(a => a.Field === 'Bid_Group_Cancel').every(a => /Vendor text: failed/.test(a.Notes)));
  });
  await failCase('vendor has no phone', (db, set) => { db.Vendors.rows.push(['9', 'Phoneless Pete', '', '', '', '', '']); set('WO-1250', 'Vendor_ID', '9'); }, {}, (r, db, b, l) => {
    const v = r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms;
    t(`${l}: failed with a clear reason, gate not called for it, the other vendor still texted, cancel stands`, v.status === 'failed' && /Phoneless Pete has no valid phone/.test(v.reason) && !b.log.sms.some(c => c.wo_id === 'WO-1250') && b.log.sms.some(c => c.wo_id === 'WO-1252') && cancelledOk(db) && r.body.needs_attention === true && telFail(db, /WO-1250/));
  });
  await failCase('queue write blows up', null, { throwOnWrite: (path, method) => method === 'POST' && path === '/values/Message_Queue:append' }, (r, db, b, l) => {
    t(`${l}: texts reported failed (could not be queued), cancels stand, no Twilio call`, r.status === 200 && r.body.vendor_texts.every(x => x.status === 'failed' && /could not be queued or sent/.test(x.reason)) && cancelledOk(db) && b.log.twilio.length === 0);
    t(`${l}: logged to telemetry and in warnings`, telFail(db, /WO-1252/) && r.body.warnings.some(w => /Vendor text FAILED for WO-1252/.test(w)));
  });
  await failCase('Twilio rejects the number', null, { twilioFail: true }, (r, db, b, l) => {
    t(`${l}: failed "Twilio rejected", queue row marked failed, cancels stand`, r.body.vendor_texts.every(x => x.status === 'failed' && /Twilio rejected/.test(x.reason)) && tab(db, 'Message_Queue').every(q => q.Status === 'failed') && cancelledOk(db) && telFail(db, /Twilio rejected/));
  });
  await failCase('vendor id not in Vendors', (db, set) => set('WO-1250', 'Vendor_ID', '99'), {}, (r, db, b, l) => {
    t(`${l}: failed "not found in the Vendors tab", never silently skipped`, r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms.status === 'failed' && /not found in the Vendors tab/.test(r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms.reason) && cancelledOk(db) && r.body.needs_attention === true);
  });
  await failCase('vendor opted out', (db, set) => set('WO-1250', 'Vendor_ID', '6'), {}, (r, db, b, l) => {
    t(`${l}: gate blocks it and the block is reported as failed`, r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms.status === 'failed' && /Vendor opted out/.test(r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms.reason) && cancelledOk(db));
  });
  await failCase('no vendor on the copy', (db, set) => set('WO-1250', 'Vendor_ID', ''), {}, (r, db, b, l) => {
    const v = r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms;
    t(`${l}: skipped with a reason, gate not called for it, not a failure`, v.status === 'skipped' && /No vendor/.test(v.reason) && !b.log.sms.some(c => c.wo_id === 'WO-1250') && r.body.needs_attention === false && r.body.summary.vendor_texts.skipped === 1 && cancelledOk(db));
  });
  await failCase('same vendor holds the kept original', (db, set) => set('WO-1250', 'Vendor_ID', '2'), {}, (r, db, b, l) => {
    const v = r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms;
    t(`${l}: that vendor is NOT texted about the cancelled copy (they still have the kept job), and it says so`, v.status === 'skipped' && /also has WO-1239/.test(v.reason) && !b.log.sms.some(c => c.wo_id === 'WO-1250') && cancelledOk(db));
  });
  await failCase('staging worker', null, { env: envStg }, (r, db, b, l) => {
    t(`${l}: reported skipped/STAGING (never claims sent), no Twilio, cancels stand`, r.body.vendor_texts.length === 2 && r.body.vendor_texts.every(x => x.status === 'skipped' && /STAGING/.test(x.reason)) && b.log.twilio.length === 0 && cancelledOk(db));
  });
  await failCase('test mode on', (db) => { db.Config.rows.find(r => r[0] === 'TWILIO_TEST_MODE')[1] = 'TRUE'; }, {}, (r, db, b, l) => {
    t(`${l}: sent to the TEST number and says so (not a normal send)`, r.body.vendor_texts.every(x => x.status === 'sent' && /TEST MODE/.test(x.reason)) && twi(b).every(x => x.to === '+14439617927'));
  });
  // the cancel itself fails for one copy -> that vendor is NOT texted about a cancel that did not happen
  {
    const { db } = await groupOf4(); const b = build(db, { allowTwilio: true });
    db.Work_Orders.headers.push('Addon_Status'); db.Work_Orders.rows.forEach(r => r.push(''));
    db.Work_Orders.rows.push(db.Work_Orders.headers.map(h => ({ ID: 'WO-AD1', Type: 'addon', Parent_WO_ID: 'WO-1250', Status: 'New', Property_ID: '70', Addon_Status: 'Submitted' }[h] ?? '')));
    db.Estimates.rows.push(['9', 'WO-AD1', '8', '1', '100.00', 'Pending', 'TRUE']);
    const r = await call(b.woBidGroupCancel(env, { wo_id: 'WO-1239', mode: 'duplicates', confirm: true }));
    t('a cancel that FAILS (live add-on) texts nobody about it; the copy that did cancel is texted', r.body.results.find(x => x.wo_id === 'WO-1250').result === 'failed' && r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms.status === 'skipped' && /cancel failed/.test(r.body.results.find(x => x.wo_id === 'WO-1250').vendor_sms.reason) && b.log.sms.length === 1 && b.log.sms[0].wo_id === 'WO-1252');
  }
}
{
  // 17g. BUILD 2: a kept COPY notifies per its original work order's settings; nothing is sent at keep time
  const keep = async (prep, opts) => {
    const { db, set } = await groupOf4(); stamp(set); prep && prep(db, set);
    const b = build(db, Object.assign({ allowTwilio: true, realOwnerNotify: true }, opts || {}));
    const snapMq = JSON.stringify(db.Message_Queue.rows);
    const r = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true, updated_by: 'Brett' }));
    return { db, set, b, r, snapMq };
  };
  const { db, set, b, r, snapMq } = await keep();
  t('keep: ok, winner restored to a normal work order\'s settings (read back): visible, tenant create + update notices on, owner override cleared',
    r.status === 200 && r.body.ok && wf(db, 'WO-1252', 'Tenant_Visible') === 'TRUE' && wf(db, 'WO-1252', 'Tenant_Notify_Created') === 'TRUE' && wf(db, 'WO-1252', 'Tenant_Notify_Updates') === 'TRUE' && wf(db, 'WO-1252', 'Owner_Notify_Override') === '' && wf(db, 'WO-1252', 'Bid_Winner') === 'TRUE');
  t('the same four settings as the original WO-1239 (which was created normally)', ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates'].every(k => wf(db, 'WO-1252', k) === wf(db, 'WO-1239', k)) && wf(db, 'WO-1239', 'Owner_Notify_Override') === '');
  t('losing / skipped copies stay silent (flags untouched), the original is untouched', wf(db, 'WO-1250', 'Tenant_Notify_Updates') === 'FALSE' && wf(db, 'WO-1250', 'Owner_Notify_Override') === 'off' && wf(db, 'WO-1251', 'Tenant_Visible') === 'FALSE' && wf(db, 'WO-1239', 'Tenant_Visible') === 'TRUE' && wf(db, 'WO-1239', 'Status') === 'Accepted');
  const n = r.body.winner.notify;
  t('result reports what changed and where it came from', n.from_original === true && n.source_wo_id === 'WO-1239' && n.text_sent_now === false && ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Owner_Notify_Override'].every(k => n.changed.includes(k)) && /follows the normal work order rules/.test(r.body.winner.note));
  const aud = tab(db, 'WO_Audit').filter(a => a.WO_ID === 'WO-1252' && ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Owner_Notify_Override', 'Bid_Winner'].includes(a.Field));
  t('WO_Audit: one row per changed field with old and new value, who, and "no text"', aud.length === 5 && aud.find(a => a.Field === 'Owner_Notify_Override').Old_Value === 'off' && aud.find(a => a.Field === 'Owner_Notify_Override').New_Value === '' && aud.find(a => a.Field === 'Tenant_Notify_Updates').Old_Value === 'FALSE' && aud.find(a => a.Field === 'Tenant_Notify_Updates').New_Value === 'TRUE' && aud.every(a => a.Changed_By === 'Brett') && aud.filter(a => a.Field !== 'Bid_Winner').every(a => /no text/i.test(a.Notes)));
  const mq = tab(db, 'Message_Queue');
  t('NO "new work order" blast: Message_Queue holds no tenant/owner row, only the losing copy\'s vendor cancellation; no Twilio to Tina/Olive', mq.every(q => q.Recipient_Type === 'vendor' && q.Message_Type === 'vendor_job_cancelled') && !twi(b).some(x => ['+14105551111', '+14105552222'].includes(x.to)) && !db.Notification_Queue && !tab(db, 'Message_Queue').some(q => q.WO_ID === 'WO-1252'));
  // behaviour from then on: a status change on the winner notifies like any WO
  const afterKeep = twi(b).length;
  await call(b.updateStatus(env, { wo_id: 'WO-1252', status: 'Complete', updated_by: 'Brett' }));
  const w2 = twi(b).slice(afterKeep);
  t('after the keep, marking the winner Complete texts the TENANT (Tina) and the OWNER (Olive) exactly like a normal WO', w2.some(x => x.to === '+14105551111' && /is complete/.test(x.body)) && w2.some(x => x.to === '+14105552222' && /is complete/.test(x.body)));
  // contrast: the same Complete on a copy that was NOT kept stays silent for tenant and owner
  const { db: d2, set: s2 } = await groupOf4(); stamp(s2); const b2 = build(d2, { allowTwilio: true, realOwnerNotify: true });
  await call(b2.updateStatus(env, { wo_id: 'WO-1252', status: 'Complete', updated_by: 'Brett' }));
  t('contrast: a silent copy that was never kept texts neither tenant nor owner on Complete', !twi(b2).some(x => ['+14105551111', '+14105552222'].includes(x.to)));
  // idempotent re-run: no second round of audit rows
  const again = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
  t('re-running keep_one changes nothing and writes no new audit rows for the winner', again.body.ok && again.body.winner.notify.changed.length === 0 && tab(db, 'WO_Audit').filter(a => a.WO_ID === 'WO-1252' && ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Owner_Notify_Override', 'Bid_Winner'].includes(a.Field)).length === 5);
}
{
  // preview states the notification plan and writes nothing
  const { db, set } = await groupOf4(); stamp(set); const b = build(db, { allowTwilio: true });
  const before = JSON.stringify(db.Work_Orders.rows);
  const pv = (await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252' }))).body;
  t('preview: winner.notify lists the fields that WILL change and says no text is sent now; nothing written', pv.winner.notify.will_change.length === 4 && pv.winner.notify.text_sent_now === false && /No text is sent right now/.test(pv.winner.note) && pv.winner.notify.settings.Tenant_Notify_Updates === 'TRUE' && JSON.stringify(db.Work_Orders.rows) === before);
}
{
  // settings come from THE ORIGINAL's own configuration, not blindly TRUE
  const { db, b, r } = await (async () => {
    const { db, set } = await groupOf4(); stamp(set);
    set('WO-1239', 'Tenant_Notify_Updates', 'FALSE'); set('WO-1239', 'Owner_Notify_Override', 'completion');   // Brett had turned tenant updates off on this job
    const b = build(db, { allowTwilio: true }); const r = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
    return { db, b, r };
  })();
  t('original has tenant updates OFF and owner level "completion": the kept copy gets exactly that (not blindly everything on)', r.body.ok && wf(db, 'WO-1252', 'Tenant_Notify_Updates') === 'FALSE' && wf(db, 'WO-1252', 'Tenant_Notify_Created') === 'TRUE' && wf(db, 'WO-1252', 'Tenant_Visible') === 'TRUE' && wf(db, 'WO-1252', 'Owner_Notify_Override') === 'completion');
  // chain: the winner is a copy of a copy -> still the ORIGINAL's settings
  const g = await groupOf4(); stamp(g.set); g.set('WO-1252', 'Duplicated_From', 'WO-1250');
  const bb = build(g.db, { allowTwilio: true }); const rr = await call(bb.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
  t('copy of a copy: walks Duplicated_From up to the original WO-1239', rr.body.winner.notify.source_wo_id === 'WO-1239' && wf(g.db, 'WO-1252', 'Tenant_Notify_Updates') === 'TRUE' && wf(g.db, 'WO-1252', 'Owner_Notify_Override') === '');
  // original missing -> the normal defaults
  const h = await groupOf4(); stamp(h.set); h.set('WO-1252', 'Duplicated_From', 'WO-GONE');
  const bh = build(h.db, { allowTwilio: true }); const rh = await call(bh.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
  t('original cannot be found: the normal defaults (visible, notices on, owner override cleared) and the result says so', rh.body.winner.notify.from_original === false && /normal defaults/.test(rh.body.winner.note) && wf(h.db, 'WO-1252', 'Tenant_Visible') === 'TRUE' && wf(h.db, 'WO-1252', 'Tenant_Notify_Updates') === 'TRUE' && wf(h.db, 'WO-1252', 'Owner_Notify_Override') === '');
  // unknown override value on the original is not copied
  const pl = build(makeDb()).bidWinnerNotifyPlan([{ ID: 'A', Owner_Notify_Override: 'banana' }, { ID: 'B', Duplicated_From: 'A' }], { ID: 'B', Duplicated_From: 'A' });
  t('an unrecognised owner override on the original is not copied (falls back to the owner\'s own setting)', pl.settings.Owner_Notify_Override === '' && pl.from_original === true);
  // winner is the original: nothing about notifications is touched
  const o = await groupOf4(); stamp(o.set); const bo = build(o.db, { allowTwilio: true });
  const ro = await call(bo.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1239', confirm: true }));
  t('keep_one on the ORIGINAL: no notification setting is touched anywhere, result.winner.notify is null', ro.body.winner.notify === null && !tab(o.db, 'WO_Audit').some(a => ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Owner_Notify_Override', 'Bid_Winner'].includes(a.Field)) && wf(o.db, 'WO-1252', 'Owner_Notify_Override') === 'off');
}
{
  // write ordering guarantee: if the winner write fails NOTHING is cancelled and NOBODY is texted
  const { db, set } = await groupOf4(); stamp(set);
  const b = build(db, { allowTwilio: true, throwOnWrite: (path, method, body) => method === 'POST' && path === '/values:batchUpdate' && /"TRUE"/.test(String(body)) && !/Cancelled/.test(String(body)) });
  const r = await call(b.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
  t('winner write fails: 500, nothing cancelled, no vendor text, no Twilio, failure logged', r.status === 500 && woRows(db).every(w => w.Status !== 'Cancelled') && b.log.sms.length === 0 && b.log.twilio.length === 0 && tab(db, 'Message_Queue').length === 0 && tab(db, 'Ops_Telemetry').some(x => x.Job_Type === 'wo_bid_cancel' && x.Success === 'FALSE' && /WO-1252/.test(x.Notes)) && /NOTHING was cancelled/.test(r.body.error));
  // unlink after a keep leaves every setting exactly as it is
  const { db: d2, set: s2 } = await groupOf4(); stamp(s2); const b2 = build(d2, { allowTwilio: true });
  await call(b2.woBidGroupCancel(env, { group_id: 'BG-1001', mode: 'keep_one', keep_wo_id: 'WO-1252', confirm: true }));
  const snap = ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Owner_Notify_Override', 'Bid_Winner'].map(k => wf(d2, 'WO-1252', k)).join('|');
  await call(b2.woBidGroupUnlink(env, { wo_id: 'WO-1252' }));
  t('Unlink after a keep: Bid_Group_ID cleared but all four notification settings (and the winner marker) exactly as they were', wf(d2, 'WO-1252', 'Bid_Group_ID') === '' && ['Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Owner_Notify_Override', 'Bid_Winner'].map(k => wf(d2, 'WO-1252', k)).join('|') === snap);
  t('unlink code touches none of the notification fields', !/Tenant_Notify|Owner_Notify_Override|Tenant_Visible/.test(grab(wsrc, 'async function woBidGroupUnlink(')));
}
{
  // 17h. source-level guards + refactor equivalence
  const asg = grab(wsrc, 'async function assignVendor(');
  t('assignVendor now uses the shared vendorSmsDetailFromResult mapping (one copy of the sent/held/failed/skipped rules)', /vendorSmsDetail = vendorSmsDetailFromResult\(env, r, _lang, msg\)/.test(asg) && !/Held for quiet hours/.test(asg));
  const notifySrc = grab(wsrc, 'async function bidCancelNotifyVendor(');
  t('bidCancelNotifyVendor: no quiet-hours bypass, no swallowing catch', !/bypassQuietHours/.test(notifySrc) && !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(notifySrc) && /catch \(e\) \{\s*out\.status = 'failed'/.test(notifySrc));
  t('the cancel path never calls the vendor text for a preview (it returns before the cancel loop)', grab(wsrc, 'async function woBidGroupCancel(').indexOf('return json(result, 200);') < grab(wsrc, 'async function woBidGroupCancel(').indexOf('bidCancelNotifyVendor('));
  t('only one new SMS message type is introduced: vendor_job_cancelled', /const BID_CANCEL_SMS_TYPE = 'vendor_job_cancelled'/.test(wsrc));
  t('BUILD_VERSION is the .7 follow-up (or a later build)', /const BUILD_VERSION = '2026-10-(1[3-9]|2\d|3[01])\.\d+-[a-z-]+'/.test(wsrc)); // Oct 14 2026: was pinned to exactly 2026-10-13.7, which failed on ANY later build bump
}

console.log(`\nwo-duplicate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
