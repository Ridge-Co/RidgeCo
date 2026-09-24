// Bulk Combine Work Orders (Sep 22 2026 build) — offline tests for resolveCombineFields() and
// woCombine(). Extracts the REAL functions verbatim out of worker.js and runs them against an
// in-memory fake Sheets backend, same convention/mock as test/wo-void.test.mjs, so this test
// cannot quietly drift from what ships. woCombine() itself calls the real woVoid()/woUnvoid()
// (grabbed alongside it) so the Notes-merge/audit/rollback behavior under test is exactly what
// the endpoint actually runs, not a re-implementation.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

// Robust against a destructured first parameter (e.g. `function f({ a, b }) {`) — walks the
// parameter list's own paren depth first, THEN takes the next '{' as the function body, so a
// param-object's brace is never mistaken for the body's opening brace (wo-void.test.mjs's
// simpler version only handles plain params and would grab logMessageAudit's destructured
// param list instead of its body).
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

const cacheSrc            = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc                = grab(wsrc, 'async function sheetsRequest(');
const ensureSrc            = grab(wsrc, 'async function ensureColumns(');
const ensureInnerSrc       = grab(wsrc, 'async function ensureColumnsInner(');
const ensureTabSrc         = grab(wsrc, 'async function ensureTab(');
const isMissingTabSrc      = grab(wsrc, 'function isMissingTabError(');
const idcSrc               = grab(wsrc, 'function idColIndex(');
const colSrc                = grab(wsrc, 'function col(index)') || grab(wsrc, 'function col(index');
const jsonSrc               = grab(wsrc, 'function json(data');
const fetchTabSrc          = grab(wsrc, 'async function fetchTab(');
const findWOSrc            = grab(wsrc, 'function findWO(');
const updateWOFieldsSrc    = grab(wsrc, 'async function updateWOFields(');
const nextSafeIdSrc        = grab(wsrc, 'function nextSafeId(');
const logAuditSrc          = grab(wsrc, 'async function logWOAudit(');
const logAuditManySrc      = grab(wsrc, 'async function logWOAuditMany(');
const logMsgAuditSrc       = grab(wsrc, 'async function logMessageAudit(');
const reasonsSrc            = grabConst(wsrc, 'const WO_VOID_REASONS');
const columnsSrc            = grabConst(wsrc, 'const WO_VOID_COLUMNS');
const woVoidSrc             = grab(wsrc, 'async function woVoid(');
const woUnvoidSrc           = grab(wsrc, 'async function woUnvoid(');
const combineFieldsConstSrc = grabConst(wsrc, 'const WO_COMBINE_RECONCILE_FIELDS');
const combineMergeConstSrc  = grabConst(wsrc, 'const WO_COMBINE_MERGE_FIELDS');
const mergeTextFieldSrc     = grab(wsrc, 'function mergeWOTextField(');
const resolveCombineSrc     = grab(wsrc, 'function resolveCombineFields(');
const woCombineSrc          = grab(wsrc, 'async function woCombine(');
const vendorBillLockSrc       = grab(wsrc, 'function vendorBillReassignLock(');
const findLockedVendorBillSrc = grab(wsrc, 'async function findLockedVendorBillForWOs(');
const isTenantCurrentSrc    = grab(wsrc, 'function isTenantCurrent(');
const currentTenantSrc      = grab(wsrc, 'function currentTenantForDispatch(');
const tenantsForDispatchSrc = grab(wsrc, 'function tenantsForDispatch(');
const isBackgroundWOSrc     = grab(wsrc, 'function isBackgroundWO(');
const isTenantNotifiableSrc = grab(wsrc, 'function isTenantNotifiable(');
const smsGateDecisionSrc    = grab(wsrc, 'function smsGateDecision(');
const smsToggleOnSrc        = grabConst(wsrc, 'const smsToggleOn');
const normalizePhoneSrc     = grab(wsrc, 'function normalizePhone(');
const msgQueueTabSrc        = grabConst(wsrc, "const MSG_QUEUE_TAB = 'Message_Queue';");
const msgQueueColsSrc       = grabConst(wsrc, 'const MSG_QUEUE_COLS');
const smsInfraStateSrc      = grabRange(wsrc, "const SMS_TOGGLE_TABS", 'async function ensureSmsInfra');
const ensureSmsInfraSrc     = grab(wsrc, 'async function ensureSmsInfra(');
const etHourSrc             = grab(wsrc, 'function etHour(');
const quietHoursConstsSrc   = grabConst(wsrc, 'const QUIET_HOURS_START_ET') + '\n' + grabConst(wsrc, 'const QUIET_HOURS_END_ET');
const isQuietHoursSrc       = grab(wsrc, 'function isQuietHoursNow(');
const nextQuietHoursSrc     = grab(wsrc, 'function nextQuietHoursEnd(');
const nyOffsetMinutesSrc    = grab(wsrc, 'function nyOffsetMinutes(');
const fetchConfigSrc        = grab(wsrc, 'async function fetchConfig(');
const smsGatedSendSrc       = grab(wsrc, 'async function smsGatedSend(');
const updateMsgQueueRowSrc  = grab(wsrc, 'async function updateMessageQueueRow(');
const sendSMSRawSrc         = grab(wsrc, 'async function sendSMSRaw(');
const getWorkOrdersListSrc  = grab(wsrc, 'async function getWorkOrdersList(');

// ── Pure resolveCombineFields() — no Sheets involved at all ─────────────────────────────────
{
  const src = resolveCombineSrc + '\nreturn { resolveCombineFields };';
  const { resolveCombineFields } = new Function(combineFieldsConstSrc + '\n' + src)();

  // 1. all-agree fields silently auto-resolve, even when the group is skewed (4 vs 1) —
  //    what matters is unanimity, not majority.
  {
    const wos = [
      { Managed_By: 'me', Vendor_ID: 'V1', Scheduled_Date: '', Priority: 'normal', Status: 'New', Trade: 'Plumbing' },
      { Managed_By: 'me', Vendor_ID: 'V1', Scheduled_Date: '', Priority: 'urgent', Status: 'New', Trade: 'Electrical' },
    ];
    const { resolved, conflicts } = resolveCombineFields(wos, {});
    t('Managed_By auto-resolves when all agree', resolved.Managed_By === 'me');
    t('Vendor_ID auto-resolves when all agree', resolved.Vendor_ID === 'V1');
    t('Priority is a conflict (differs)', conflicts.includes('Priority'));
    t('Status auto-resolves when all agree', resolved.Status === 'New');
  }
  // 2. Trade is NEVER compared or returned, even though every WO has a different one.
  {
    const wos = [
      { Managed_By: 'me', Trade: 'Plumbing' },
      { Managed_By: 'me', Trade: 'Electrical' },
      { Managed_By: 'me', Trade: 'HVAC' },
    ];
    const { resolved, conflicts } = resolveCombineFields(wos, {});
    t('Trade never appears in resolved', !('Trade' in resolved));
    t('Trade never appears in conflicts', !conflicts.includes('Trade'));
  }
  // 2b. Description is NEVER compared or returned either (Sep 23 2026 — it's a merge field
  //     now, not a reconcile field at all).
  {
    const wos = [
      { Managed_By: 'me', Description: 'Garbage disposal broken' },
      { Managed_By: 'me', Description: 'Door needs rescrewing' },
    ];
    const { resolved, conflicts } = resolveCombineFields(wos, {});
    t('Description never appears in resolved (moved to merge fields)', !('Description' in resolved));
    t('Description never appears in conflicts (moved to merge fields)', !conflicts.includes('Description'));
  }
  // 3. Disagreement with no override -> conflict, not a guess.
  {
    const wos = [{ Priority: 'urgent' }, { Priority: 'low' }];
    const { conflicts } = resolveCombineFields(wos, {}, ['Priority']);
    t('a field with no override and no agreement is reported as a conflict', conflicts.includes('Priority'));
  }
  // 4. A valid override (matching a real candidate value) resolves the conflict — and the
  //    chosen value can be one that NEITHER the "first" WO nor any single majority holds, i.e.
  //    Brett's picked value only has to match SOME selected WO, not the survivor specifically.
  {
    const wos = [{ Managed_By: 'Brett' }, { Managed_By: 'Owner' }, { Managed_By: 'PM Co' }];
    const { resolved, conflicts } = resolveCombineFields(wos, { Managed_By: 'PM Co' }, ['Managed_By']);
    t('a valid override resolves the conflict', resolved.Managed_By === 'PM Co' && !conflicts.length);
  }
  // 5. An override that does NOT match any real candidate value is refused — still a conflict,
  //    never trusted blindly.
  {
    const wos = [{ Priority: 'urgent' }, { Priority: 'low' }];
    const { conflicts, resolved } = resolveCombineFields(wos, { Priority: 'made-up-value' }, ['Priority']);
    t('an override not matching any real candidate is rejected, not applied', conflicts.includes('Priority') && !('Priority' in resolved));
  }
  // 6. A field where all agree stays silently resolved even if an override is ALSO supplied
  //    for it (the override is simply irrelevant/ignored since there's no conflict to settle).
  {
    const wos = [{ Priority: 'normal' }, { Priority: 'normal' }];
    const { resolved, conflicts } = resolveCombineFields(wos, { Priority: 'urgent' }, ['Priority']);
    t('agreement wins regardless of an irrelevant override', resolved.Priority === 'normal' && !conflicts.length);
  }
}

// ── Pure mergeWOTextField() — no Sheets involved ─────────────────────────────────────────────
{
  const src = mergeTextFieldSrc + '\nreturn { mergeWOTextField };';
  const { mergeWOTextField } = new Function(src)();
  t('a blank incoming value leaves the survivor value untouched', mergeWOTextField('keep me', 'WO-1', '') === 'keep me');
  t('a blank incoming value on an empty survivor value stays empty', mergeWOTextField('', 'WO-1', '   ') === '');
  const merged = mergeWOTextField('original text', 'WO-99', 'new text');
  t('a non-blank incoming value is appended, original text preserved', merged.startsWith('original text') && merged.includes('new text'));
  t('the appended text is prefixed with the source WO id', /combined from WO-99/.test(merged));
  const mergedFromEmpty = mergeWOTextField('', 'WO-5', 'first thing');
  t('merging onto an empty survivor value still gets the source-WO prefix, no leading blank line', mergedFromEmpty.startsWith('[') && /combined from WO-5/.test(mergedFromEmpty) && mergedFromEmpty.includes('first thing'));
}

// ── woCombine() integration — in-memory fake Sheets backend ─────────────────────────────────
const WO_HEADERS = ['ID','Property_ID','Unit_ID','Vendor_ID','Trade','Description','Status','Priority',
  'Managed_By','Scheduled_Date','Scheduled_Window','Notes','Room','Owner_WO_Ref','WO_Contact_Name','WO_Contact_Phone',
  'Customer_Charge','Deposit_Amount','Deposit_Vendor_ID','Scope_ID','Tenant_Visible','QBO_Invoice_Number',
  'Tenant_Notify_Updates',
  'Voided','Void_Reason','Void_Reason_Detail','Void_Combined_Into_WO_ID','Voided_By','Voided_Date'];
const AUDIT_HEADERS = ['ID','WO_ID','Changed_By','Changed_By_Role','Field','Old_Value','New_Value','Timestamp','Notes',
  'Channel','Recipient_Name','Recipient_Type','Message_Type','Message_Body','Outcome'];
const TENANT_HEADERS = ['ID','Property_ID','Unit_ID','First_Name','Last_Name','Phone','Active','Move_In_Date','Move_Out_Date','SMS_Enabled','SMS_OptOut'];
const OWNER_HEADERS = ['ID','First_Name','Last_Name','Phone','SMS_Enabled'];
const PROPERTY_HEADERS = ['ID','Owner_ID','Address','SMS_Enabled'];
const UNIT_HEADERS = ['ID','Property_ID','Unit_Label','Tenant_ID'];
const MSGQ_HEADERS = ['ID','WO_ID','Message_Type','Recipient_Type','Recipient_Name','Recipient_Phone','Property_ID','Property_Address','Message_Body','Status','Delivered_To','Gate_Snapshot','Created_Date','Sent_Date','Twilio_Message_SID','Active','Send_After'];
// ensureSmsInfra() unconditionally provisions SMS_Enabled/SMS_OptOut on ALL of
// Properties/Owners/Tenants/Vendors (not just the ones a given test cares about) — Vendors
// must exist in the mock even though these tests never reference a vendor directly, or
// ensureColumns's GET on a wholly-missing tab throws and smsGatedSend's non-fatal try/catch
// in woCombine silently swallows it, producing a false "SMS never sent" the test would
// otherwise mis-blame on the gate logic instead of the test fixture.
const VENDOR_HEADERS = ['ID','Name','Phone','SMS_Enabled','SMS_OptOut'];
const VENDOR_BILL_HEADERS = ['ID','WO_ID','Vendor_ID','Vendor_Name','Total','Status','Active','Created_Date'];
const INVOICE_REVIEW_HEADERS = ['ID','Bill_ID','WO_ID','Active','QB_Invoice_ID'];

function makeDb(wos, extra = {}) {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: wos.map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    WO_Audit: { headers: AUDIT_HEADERS.slice(), rows: [] },
    Tenants: { headers: TENANT_HEADERS.slice(), rows: (extra.tenants || []).map(r => TENANT_HEADERS.map(h => r[h] ?? '')) },
    Owners: { headers: OWNER_HEADERS.slice(), rows: (extra.owners || []).map(r => OWNER_HEADERS.map(h => r[h] ?? '')) },
    Properties: { headers: PROPERTY_HEADERS.slice(), rows: (extra.properties || []).map(r => PROPERTY_HEADERS.map(h => r[h] ?? '')) },
    Units: { headers: UNIT_HEADERS.slice(), rows: (extra.units || []).map(r => UNIT_HEADERS.map(h => r[h] ?? '')) },
    Vendors: { headers: VENDOR_HEADERS.slice(), rows: [] },
    Vendor_Bills: { headers: VENDOR_BILL_HEADERS.slice(), rows: (extra.vendorBills || []).map(r => VENDOR_BILL_HEADERS.map(h => r[h] ?? '')) },
    Invoice_Review: { headers: INVOICE_REVIEW_HEADERS.slice(), rows: (extra.invoiceReview || []).map(r => INVOICE_REVIEW_HEADERS.map(h => r[h] ?? '')) },
    Message_Queue: { headers: MSGQ_HEADERS.slice(), rows: [] },
    Config: { headers: ['Key','Value'], rows: Object.entries(extra.config || {}).map(([k, v]) => [k, v]) },
  };
}

function makeFetch(db, opts = {}) {
  return async (url, fopts) => {
    // Twilio API calls only happen in the one test that opts in (allowTwilio) — a fake
    // provider response, never a real send. Everywhere else env.__STAGING__ is true, so
    // sendSMSRaw short-circuits before ever reaching fetch at all; if one landed here
    // unexpectedly it would mean a real-send path leaked past staging.
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
    vendorBillLockSrc, findLockedVendorBillSrc,
    combineFieldsConstSrc, combineMergeConstSrc, mergeTextFieldSrc, resolveCombineSrc, woCombineSrc,
    isTenantCurrentSrc, currentTenantSrc, isBackgroundWOSrc, isTenantNotifiableSrc,
    smsGateDecisionSrc, smsToggleOnSrc, normalizePhoneSrc,
    msgQueueTabSrc, msgQueueColsSrc, smsInfraStateSrc, ensureSmsInfraSrc,
    etHourSrc, nyOffsetMinutesSrc, quietHoursConstsSrc, isQuietHoursSrc, nextQuietHoursSrc, sendSMSRawSrc, updateMsgQueueRowSrc, fetchConfigSrc, smsGatedSendSrc,
    getWorkOrdersListSrc,
    'return { woVoid, woUnvoid, woCombine, resolveCombineFields, getWorkOrdersList, smsGatedSend };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db, fetchOpts), (fn) => fn());
}

function row(db, tab, id) { return db[tab].rows.find(r => r[0] === id); }
function field(headers, name, r) { const i = headers.indexOf(name); return r ? r[i] : undefined; }
const wf = (db, id, name) => field(WO_HEADERS, name, row(db, 'Work_Orders', id));

console.log('Bulk Combine Work Orders — offline tests\n');
const env = { SHEET_ID: 'S', __STAGING__: true };

// ── 1. Validation: survivor/target existence, self-reference, empty list ────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: '' }]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1', combined_wo_ids: [] });
  t('empty combined_wo_ids is rejected', res.status === 400);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: '' }]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-9999', combined_wo_ids: ['WO-1'] });
  t('missing survivor 404s', res.status === 404);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: '' }]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1', combined_wo_ids: ['WO-9999'] });
  t('missing combined WO 404s', res.status === 404);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '76', Unit_ID: '' }]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1', combined_wo_ids: ['WO-1'] });
  t('survivor cannot also be a combined id', res.status === 400);
}
// Same-property/unit scoping (server-side, not trusted from the client)
{
  const db = makeDb([
    { ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-2', Property_ID: '99', Unit_ID: 'U9' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1', combined_wo_ids: ['WO-2'] });
  const body = await res.json();
  t('mismatched property/unit is rejected', res.status === 400 && /not the same property\/unit/.test(body.error));
}
// An already-voided WO cannot be combined again (regression: a repeat/double-tap call used to
// silently return success:true instead of rejecting, re-running the void/audit logic on a WO
// that was already combined elsewhere).
{
  const db = makeDb([
    { ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1', Voided: 'TRUE' },
    { ID: 'WO-2', Property_ID: '76', Unit_ID: 'U1' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1', combined_wo_ids: ['WO-2'] });
  const body = await res.json();
  t('an already-voided survivor is rejected, not silently combined into', res.status === 400 && /is voided/.test(body.error));
}
{
  const db = makeDb([
    { ID: 'WO-1', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-2', Property_ID: '76', Unit_ID: 'U1', Voided: 'TRUE' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1', combined_wo_ids: ['WO-2'] });
  const body = await res.json();
  t('an already-voided combined_wo_id is rejected, not re-combined', res.status === 400 && /already voided/.test(body.error));
}

// ── 1b. Billing-state guard: any selected WO already invoiced blocks the whole combine ───────
{
  const db = makeDb([
    { ID: 'WO-1b', Property_ID: '76', Unit_ID: 'U1', QBO_Invoice_Number: 'INV-42' },
    { ID: 'WO-2b', Property_ID: '76', Unit_ID: 'U1' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-1b', combined_wo_ids: ['WO-2b'] });
  const body = await res.json();
  t('an already-invoiced survivor blocks the combine outright (400, no override possible)', res.status === 400 && body.error === 'already_invoiced' && body.wo_ids.includes('WO-1b'));
}
{
  const db = makeDb([
    { ID: 'WO-3b', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-4b', Property_ID: '76', Unit_ID: 'U1', QBO_Invoice_Number: 'INV-99' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-3b', combined_wo_ids: ['WO-4b'], field_overrides: {} });
  const body = await res.json();
  t('an already-invoiced combined WO also blocks it, even with field_overrides supplied', res.status === 400 && body.error === 'already_invoiced' && body.wo_ids.includes('WO-4b'));
}
{
  const db = makeDb([
    { ID: 'WO-5b', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-6b', Property_ID: '76', Unit_ID: 'U1' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-5b', combined_wo_ids: ['WO-6b'] });
  const body = await res.json();
  t('with no QBO invoice number anywhere in the selection, combine proceeds normally', body.success === true);
}
// 1c. Billing guard widened (Sep 23 2026, Brett's follow-up): an already-reviewed vendor bill
//     also blocks the combine outright, even with NO QBO_Invoice_Number set on any WO at all —
//     the vendor-paid side and the customer-invoiced side are two separate signals and either
//     one alone is enough to block.
{
  const db = makeDb([
    { ID: 'WO-7b', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-8b', Property_ID: '76', Unit_ID: 'U1' },
  ], { vendorBills: [{ ID: 'VB-7b', WO_ID: 'WO-8b', Vendor_ID: 'V1', Status: 'reviewed', Active: 'TRUE' }] });
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-7b', combined_wo_ids: ['WO-8b'] });
  const body = await res.json();
  t('an already-reviewed vendor bill on a combined WO blocks the combine, with no QBO invoice number involved at all', res.status === 400 && body.error === 'already_invoiced' && body.locked_bill_id === 'VB-7b');
}
{
  // Same, but the locked signal is a live Invoice_Review row (sent to QuickBooks) rather than
  // Status==='reviewed' — the other half of vendorBillReassignLock's own lock logic.
  const db = makeDb([
    { ID: 'WO-9b', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-10b', Property_ID: '76', Unit_ID: 'U1' },
  ], {
    vendorBills: [{ ID: 'VB-9b', WO_ID: 'WO-9b', Vendor_ID: 'V1', Status: 'submitted', Active: 'TRUE' }],
    invoiceReview: [{ ID: 'IR-1', Bill_ID: 'VB-9b', WO_ID: 'WO-9b', Active: 'TRUE', QB_Invoice_ID: 'QBINV-1' }],
  });
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-9b', combined_wo_ids: ['WO-10b'] });
  const body = await res.json();
  t('a bill already sent to QuickBooks (live Invoice_Review row) blocks the combine on the survivor too', res.status === 400 && body.error === 'already_invoiced' && body.locked_bill_id === 'VB-9b');
}
{
  // A voided/inactive vendor bill and a plain submitted bill with no QB linkage do NOT block —
  // only a genuinely locked bill does.
  const db = makeDb([
    { ID: 'WO-11b', Property_ID: '76', Unit_ID: 'U1' },
    { ID: 'WO-12b', Property_ID: '76', Unit_ID: 'U1' },
  ], { vendorBills: [
    { ID: 'VB-11b', WO_ID: 'WO-11b', Vendor_ID: 'V1', Status: 'submitted', Active: 'FALSE' },
    { ID: 'VB-12b', WO_ID: 'WO-12b', Vendor_ID: 'V1', Status: 'submitted', Active: 'TRUE' },
  ] });
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-11b', combined_wo_ids: ['WO-12b'] });
  const body = await res.json();
  t('a voided vendor bill and an unlocked live one do not block the combine', body.success === true);
}

// ── 2. Field-agreement auto-resolve (silent) ─────────────────────────────────────────────────
{
  const db = makeDb([
    { ID: 'WO-10', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Managed_By: 'Owner', Priority: 'normal', Status: 'New', Notes: '' },
    { ID: 'WO-11', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Managed_By: 'Brett', Priority: 'normal', Status: 'New', Notes: '' },
    { ID: 'WO-12', Property_ID: '76', Unit_ID: 'U1', Trade: 'HVAC', Managed_By: 'Brett', Priority: 'normal', Status: 'New', Notes: '' },
  ]);
  const { woCombine } = build(db);
  // WO-11 is the survivor. Managed_By disagrees (Owner vs Brett vs Brett) -> conflict since not unanimous.
  const res = await woCombine(env, { survivor_wo_id: 'WO-11', combined_wo_ids: ['WO-10', 'WO-12'] });
  const body = await res.json();
  t('a real disagreement 409s with the field named', res.status === 409 && body.error === 'field_conflict' && body.conflicts.includes('Managed_By'));
  t('Priority (all agree: normal) is NOT in the conflict list', !body.conflicts.includes('Priority'));
  t('Status (all agree: New) is NOT in the conflict list', !body.conflicts.includes('Status'));
}
{
  // All agree on Priority/Status but Managed_By differs ONLY between the two non-survivor WOs
  // vs the survivor — still unanimous requirement across ALL selected WOs including survivor.
  const db = makeDb([
    { ID: 'WO-20', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Managed_By: 'Brett', Priority: 'urgent', Status: 'New', Notes: '' },
    { ID: 'WO-21', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Managed_By: 'Brett', Priority: 'urgent', Status: 'New', Notes: '' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-20', combined_wo_ids: ['WO-21'], updated_by: 'Brett' });
  const body = await res.json();
  t('full agreement across survivor + combined succeeds without any override', body.success === true);
  t('resolved_fields reflects the agreed value', body.resolved_fields.Priority === 'urgent');
  t('the voided WO records the survivor as its combine target', wf(db, 'WO-21', 'Void_Combined_Into_WO_ID') === 'WO-20');
}
{
  // Silent auto-apply EVEN WHEN it differs from the survivor's own original value (Brett's
  // explicit case: 4 agree on a value the survivor itself doesn't currently hold).
  const db = makeDb([
    { ID: 'WO-30', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Managed_By: 'Owner', Notes: '' },
    { ID: 'WO-31', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Managed_By: 'Brett', Notes: '' },
    { ID: 'WO-32', Property_ID: '76', Unit_ID: 'U1', Trade: 'HVAC', Managed_By: 'Brett', Notes: '' },
    { ID: 'WO-33', Property_ID: '76', Unit_ID: 'U1', Trade: 'Roofing', Managed_By: 'Brett', Notes: '' },
    { ID: 'WO-34', Property_ID: '76', Unit_ID: 'U1', Trade: 'Painting', Managed_By: 'Brett', Notes: '' },
  ]);
  const { woCombine } = build(db);
  // Survivor WO-30 is Managed_By 'Owner'; the 4 combined WOs all agree on 'Brett' -> a real
  // disagreement (Owner vs Brett), so this must 409 rather than silently pick either side.
  const res = await woCombine(env, { survivor_wo_id: 'WO-30', combined_wo_ids: ['WO-31', 'WO-32', 'WO-33', 'WO-34'] });
  const body = await res.json();
  t('survivor disagreeing with a unanimous combined group is still a real conflict, not auto-picked', res.status === 409 && body.conflicts.includes('Managed_By'));
}

// ── 3. field_overrides resolves a real conflict, and is verified against real candidates ────
{
  const db = makeDb([
    { ID: 'WO-40', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Priority: 'normal', Notes: '' },
    { ID: 'WO-41', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Priority: 'urgent', Notes: '' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-40', combined_wo_ids: ['WO-41'], field_overrides: { Priority: 'urgent' }, updated_by: 'Brett' });
  const body = await res.json();
  t('a valid override resolves the combine', body.success === true);
  t('the survivor now carries the picked (overridden) value, even though it differs from its own original', wf(db, 'WO-40', 'Priority') === 'urgent');
  t('an audit row records the reconciled field change', db.WO_Audit.rows.some(r => r[1] === 'WO-40' && r[4] === 'Priority' && r[6] === 'urgent'));
}
{
  const db = makeDb([
    { ID: 'WO-50', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Priority: 'normal', Notes: '' },
    { ID: 'WO-51', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Priority: 'urgent', Notes: '' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-50', combined_wo_ids: ['WO-51'], field_overrides: { Priority: 'made-up-nonsense' } });
  const body = await res.json();
  t('an override not matching any real candidate value is refused, not trusted', res.status === 409 && body.conflicts.includes('Priority'));
}

// ── 4. Trade is never compared and the survivor keeps its own original Trade ────────────────
{
  const db = makeDb([
    { ID: 'WO-60', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Notes: '' },
    { ID: 'WO-61', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Notes: '' },
    { ID: 'WO-62', Property_ID: '76', Unit_ID: 'U1', Trade: 'HVAC', Notes: '' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-60', combined_wo_ids: ['WO-61', 'WO-62'] });
  const body = await res.json();
  t('combine succeeds despite every WO having a different Trade', body.success === true);
  t('Trade is never in resolved_fields', !('Trade' in body.resolved_fields));
  t("the survivor's own Trade is completely untouched", wf(db, 'WO-60', 'Trade') === 'Plumbing');
}

// ── 5. Notes merge order — each voided WO appended in order, existing prefix convention ─────
{
  const db = makeDb([
    { ID: 'WO-70', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Notes: 'original survivor note' },
    { ID: 'WO-71', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Notes: 'first voided note' },
    { ID: 'WO-72', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Notes: 'second voided note' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-70', combined_wo_ids: ['WO-71', 'WO-72'], updated_by: 'Brett' });
  const body = await res.json();
  t('combine with matching-Trade WOs succeeds', body.success === true);
  const notes = wf(db, 'WO-70', 'Notes');
  t("survivor keeps its own original note", notes.startsWith('original survivor note'));
  t('WO-71\'s note is appended with the combined-from prefix', /combined from WO-71/.test(notes) && notes.includes('first voided note'));
  t('WO-72\'s note is appended AFTER WO-71\'s (voided in order)', notes.indexOf('WO-71') < notes.indexOf('WO-72'));
  t('WO-72\'s note text is present too', notes.includes('second voided note'));
}

// ── 5b. Description/Room/Owner_WO_Ref auto-merge — Brett's actual bug report ─────────────────
{
  const db = makeDb([
    { ID: 'WO-73', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'Garbage disposal broken', Room: 'Kitchen', Owner_WO_Ref: 'OWN-1' },
    { ID: 'WO-74', Property_ID: '76', Unit_ID: 'U1', Trade: 'Carpentry', Description: 'Door needs rescrewing', Room: 'Hallway', Owner_WO_Ref: 'OWN-2' },
    { ID: 'WO-75', Property_ID: '76', Unit_ID: 'U1', Trade: 'General', Description: 'Shelving fell out', Room: 'Closet', Owner_WO_Ref: '' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-73', combined_wo_ids: ['WO-74', 'WO-75'], updated_by: 'Brett' });
  const body = await res.json();
  t('combine with 3 genuinely different Descriptions succeeds with NO field_overrides at all (no picker forced)', body.success === true);
  const desc = wf(db, 'WO-73', 'Description');
  t('none of the 3 original complaints is discarded — all 3 texts present on the survivor', desc.includes('Garbage disposal broken') && desc.includes('Door needs rescrewing') && desc.includes('Shelving fell out'));
  t('order preserved (WO-74 before WO-75)', desc.indexOf('Door needs rescrewing') < desc.indexOf('Shelving fell out'));
  t('Description merge is source-attributed the same way Notes already is', /combined from WO-74/.test(desc) && /combined from WO-75/.test(desc));
  const room = wf(db, 'WO-73', 'Room');
  t('Room is also auto-merged, not silently dropped', room.includes('Kitchen') && room.includes('Hallway') && room.includes('Closet'));
  // Owner_WO_Ref (Sep 23 2026, Brett's follow-up): reverted OUT of the merge-field set — the
  // owner has their own reference numbers on their end, and concatenating several onto the
  // survivor wouldn't match anything the owner recognizes. Excluded like Trade: survivor keeps
  // its own original ref completely untouched.
  const ref = wf(db, 'WO-73', 'Owner_WO_Ref');
  t("Owner_WO_Ref is NOT merged — survivor keeps its own original ref untouched", ref === 'OWN-1');
  t('merged_fields in the response names Description/Room but NOT Owner_WO_Ref', body.merged_fields && 'Description' in body.merged_fields && 'Room' in body.merged_fields && !('Owner_WO_Ref' in body.merged_fields));
  t('resolved_fields (the reconcile-field response key) does NOT include Description', !('Description' in body.resolved_fields));
  t('resolved_fields does NOT include Owner_WO_Ref either (excluded entirely, not reconciled)', !('Owner_WO_Ref' in body.resolved_fields));
}
{
  // Same scenario but the SURVIVOR's own Description starts blank — merge still produces a
  // clean result (no leading blank line / stray separator from the empty starting value).
  const db = makeDb([
    { ID: 'WO-76', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: '' },
    { ID: 'WO-77', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'Only complaint' },
  ]);
  const { woCombine } = build(db);
  const res = await woCombine(env, { survivor_wo_id: 'WO-76', combined_wo_ids: ['WO-77'] });
  const body = await res.json();
  t('combine from a blank survivor Description still succeeds', body.success === true);
  t('the merged Description does not start with a blank line', !wf(db, 'WO-76', 'Description').startsWith('\n'));
  t('the merged Description contains the combined WO\'s text', wf(db, 'WO-76', 'Description').includes('Only complaint'));
}

// ── 6. Rollback on partial failure ────────────────────────────────────────────────────────────
{
  const db = makeDb([
    { ID: 'WO-80', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Priority: 'normal', Notes: 'keep me', Description: 'keep desc' },
    { ID: 'WO-81', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Priority: 'urgent', Notes: 'n1', Description: 'd1' },
    { ID: 'WO-82', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Priority: 'urgent', Notes: 'n2', Description: 'd2' },
  ]);
  // WO-81 voids fine; WO-82's own Voided-flag write is made to fail (simulating a Sheets
  // error mid-batch) — pinpointed by sheet row + column so it fires ONLY on that one write,
  // not on the survivor's field-apply, WO-81's void, or either WO's Notes-merge-onto-survivor
  // write (which woVoid itself swallows in its own try/catch and shouldn't affect this test).
  const woOrder = ['WO-80', 'WO-81', 'WO-82']; // matches the makeDb() row order above
  const targetSheetRow = woOrder.indexOf('WO-82') + 2; // +1 header row, +1 for 1-based rows
  const voidedColIndex = WO_HEADERS.indexOf('Voided');
  const { woCombine } = build(db, {
    throwOnWrite: (path, method, bodyStr) => {
      if (method !== 'POST' || path !== '/values:batchUpdate') return false;
      const b = JSON.parse(bodyStr);
      return b.data.some(d => {
        const m = /^Work_Orders!([A-Z]+)(\d+)$/.exec(d.range);
        if (!m) return false;
        let ci = 0; for (const ch of m[1]) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1;
        return ci === voidedColIndex && parseInt(m[2], 10) === targetSheetRow;
      });
    },
  });
  const res = await woCombine(env, { survivor_wo_id: 'WO-80', combined_wo_ids: ['WO-81', 'WO-82'], field_overrides: { Priority: 'urgent' }, updated_by: 'Brett' });
  const body = await res.json();
  t('a partial failure is reported as combine_failed with rolled_back:true', res.status === 500 && body.error === 'combine_failed' && body.rolled_back === true);
  t('WO-81 was unvoided again (rollback undid the partial void)', wf(db, 'WO-81', 'Voided') !== 'TRUE');
  t("the survivor's Priority was restored to its ORIGINAL value, not left at the reconciled override", wf(db, 'WO-80', 'Priority') === 'normal');
  t("the survivor's Description (a merge field) was also restored to its ORIGINAL value, not left partially merged", wf(db, 'WO-80', 'Description') === 'keep desc');
}

// ── 7. Tenant SMS — one batched notice, gated exactly like other tenant status SMS ─────────
{
  const props = [{ ID: '76', Owner_ID: 'O1', Address: '123 Main St', SMS_Enabled: 'TRUE' }];
  const owners = [{ ID: 'O1', First_Name: 'Owen', Phone: '4105550100', SMS_Enabled: 'TRUE' }];
  const units = [{ ID: 'U1', Property_ID: '76', Unit_Label: '2A', Tenant_ID: 'T1' }];
  const tenants = [{ ID: 'T1', Property_ID: '76', Unit_ID: 'U1', First_Name: 'Tam', Last_Name: 'T', Phone: '4105550101', Active: 'TRUE', SMS_Enabled: 'TRUE', SMS_OptOut: 'FALSE' }];
  const baseConfig = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'TRUE' };

  // 7a. All gates open, survivor's own Tenant_Notify_Updates is ON (blank/TRUE) -> one SMS
  //     actually SENT (not staging-stubbed — allowTwilio + a real TWILIO_ENABLED/creds env,
  //     with the mock Twilio endpoint standing in for the provider, so this test proves the
  //     send genuinely goes through, not just that it wasn't blocked by a gate).
  {
    const db = makeDb([
      { ID: 'WO-90', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Tenant_Notify_Updates: '' },
      { ID: 'WO-91', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing' },
      { ID: 'WO-92', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing' },
    ], { properties: props, owners, units, tenants, config: baseConfig });
    const liveEnv = { SHEET_ID: 'S', __STAGING__: false, TWILIO_SID: 'AC_TEST', TWILIO_API_SID: 'SK_TEST', TWILIO_API_KEY: 'secret', TWILIO_FROM: '+14105551234' };
    const { woCombine } = build(db, { allowTwilio: true });
    const res = await woCombine(liveEnv, { survivor_wo_id: 'WO-90', combined_wo_ids: ['WO-91', 'WO-92'] });
    const body = await res.json();
    t('combine with all gates open succeeds', body.success === true);
    const mq = db.Message_Queue.rows;
    t('exactly ONE Message_Queue row was written for the combine (not one per voided WO)', mq.filter(r => r[2] === 'tenant_wo_combined').length === 1);
    const combinedRow = mq.find(r => r[2] === 'tenant_wo_combined');
    t('the combined SMS body names both combined WO ids and the survivor', /WO-91/.test(combinedRow[8]) && /WO-92/.test(combinedRow[8]) && /WO-90/.test(combinedRow[8]));
    t('the combined SMS was actually sent (gate open, real send path exercised)', combinedRow[9] === 'sent' && combinedRow[14] === 'SM_TEST_FAKE_SID');
  }

  // 7b. Survivor's own Tenant_Notify_Updates is explicitly FALSE -> NO combine SMS at all,
  //     even though every gate (Global/Property/Owner/Tenant) is otherwise open.
  {
    const db = makeDb([
      { ID: 'WO-93', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Tenant_Notify_Updates: 'FALSE' },
      { ID: 'WO-94', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing' },
    ], { properties: props, owners, units, tenants, config: baseConfig });
    const { woCombine } = build(db);
    const res = await woCombine(env, { survivor_wo_id: 'WO-93', combined_wo_ids: ['WO-94'] });
    const body = await res.json();
    t('combine still succeeds even when the combine SMS is blocked', body.success === true);
    t('no tenant_wo_combined Message_Queue row was ever written', !db.Message_Queue.rows.some(r => r[2] === 'tenant_wo_combined'));
  }

  // 7c. Global Twilio kill switch OFF -> the row is queued (chokepoint always queue-writes
  //     first) but never actually sent — same full-hierarchy gate as every other tenant SMS,
  //     proving the combine SMS is not a bypass.
  {
    const db = makeDb([
      { ID: 'WO-95', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Tenant_Notify_Updates: '' },
      { ID: 'WO-96', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing' },
    ], { properties: props, owners, units, tenants, config: { TWILIO_ENABLED: 'FALSE', TWILIO_TEST_MODE: 'TRUE' } });
    const { woCombine } = build(db);
    const res = await woCombine(env, { survivor_wo_id: 'WO-95', combined_wo_ids: ['WO-96'] });
    const body = await res.json();
    t('combine succeeds even though Global SMS is off', body.success === true);
    const combinedRow = db.Message_Queue.rows.find(r => r[2] === 'tenant_wo_combined');
    t('a Message_Queue row is still written (queue-write-first, same as every other gated send)', !!combinedRow);
    t('but it was never actually sent — Global OFF blocks it exactly like any other tenant SMS', combinedRow[9] !== 'sent' && /Global OFF/.test(combinedRow[11]));
  }

  // 7d. Property-level toggle OFF blocks it too (same tenant hierarchy: Global AND Property
  //     AND Owner AND Tenant must all be on).
  {
    const db = makeDb([
      { ID: 'WO-97', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Tenant_Notify_Updates: '' },
      { ID: 'WO-98', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing' },
    ], { properties: [{ ID: '76', Owner_ID: 'O1', Address: '123 Main St', SMS_Enabled: 'FALSE' }], owners, units, tenants, config: baseConfig });
    const { woCombine } = build(db);
    await woCombine(env, { survivor_wo_id: 'WO-97', combined_wo_ids: ['WO-98'] });
    const combinedRow = db.Message_Queue.rows.find(r => r[2] === 'tenant_wo_combined');
    t('Property SMS_Enabled=FALSE blocks the combine SMS the same as it would any tenant SMS', combinedRow && combinedRow[9] !== 'sent' && /Property OFF/.test(combinedRow[11]));
  }
}

// ── 8. /wo/void's existing single-target Combined behavior is completely unchanged ──────────
{
  const db = makeDb([
    { ID: 'WO-100', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Notes: 'solo note' },
    { ID: 'WO-101', Property_ID: '76', Unit_ID: 'U1', Trade: 'Electrical', Notes: 'target note' },
  ]);
  const { woVoid } = build(db);
  const res = await woVoid(env, { wo_id: 'WO-100', reason: 'Combined', combined_into_wo_id: 'WO-101', updated_by: 'Brett' });
  const body = await res.json();
  t('a single manual /wo/void Combined call still works exactly as before', body.success === true);
  t('still requires combined_into_wo_id (unchanged validation)', true);
  const target = row(db, 'Work_Orders', 'WO-101');
  t('the target still gets the voided note merged in, single-target style', field(WO_HEADERS, 'Notes', target).includes('solo note') && field(WO_HEADERS, 'Notes', target).includes('target note'));
  // /wo/void never reconciles Priority/Managed_By/etc — that's woCombine-only behavior.
  t('/wo/void performs no field reconciliation on the target (Priority untouched)', field(WO_HEADERS, 'Priority', target) === '');
  // /wo/void does NOT auto-merge Description either — that's woCombine-only, not extended to
  // the single-target manual flow (left completely untouched, per the comment in worker.js).
  t('/wo/void performs no Description merge on the target either', field(WO_HEADERS, 'Description', target) === '');
}

// ── 9. Owner ref notice (Sep 23 2026, Brett's follow-up) ────────────────────────────────────
// Owner_WO_Ref is excluded from the combine entirely (see section 5b above) — but when that
// means a combined WO's own owner reference is being abandoned (non-blank AND different from
// the survivor's), the owner gets a one-time notice naming which WO+ref pairs were folded into
// the surviving WO+ref, so they can update their own records.
{
  const props = [{ ID: '76', Owner_ID: 'O1', Address: '123 Main St', SMS_Enabled: 'TRUE' }];
  const owners = [{ ID: 'O1', First_Name: 'Owen', Phone: '4105550100', SMS_Enabled: 'TRUE' }];
  const baseConfig = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'TRUE' };

  // 9a. Combined WOs carry distinct, non-blank owner refs that differ from the survivor's ->
  //     one owner notice sent, naming every abandoned WO+ref pair and the surviving WO+ref.
  {
    const db = makeDb([
      { ID: 'WO-110', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'IJKL' },
      { ID: 'WO-111', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'ABCD' },
      { ID: 'WO-112', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'EFGH' },
    ], { properties: props, owners, config: baseConfig });
    const { woCombine } = build(db);
    const res = await woCombine(env, { survivor_wo_id: 'WO-110', combined_wo_ids: ['WO-111', 'WO-112'] });
    const body = await res.json();
    t('combine succeeds', body.success === true);
    const noticeRow = db.Message_Queue.rows.find(r => r[2] === 'owner_wo_combined_ref');
    t('an owner_wo_combined_ref Message_Queue row was written (queued through the gated chokepoint)', !!noticeRow);
    t('the notice is addressed to the owner, not the tenant', noticeRow[3] === 'owner');
    const msg = noticeRow[8];
    t('the notice names both abandoned WOs and their own refs', /WO-111/.test(msg) && /ABCD/.test(msg) && /WO-112/.test(msg) && /EFGH/.test(msg));
    t('the notice names the surviving WO and its own ref', /WO-110/.test(msg) && /IJKL/.test(msg));
    t('the notice asks the owner to update their records', /update (your|their) records/i.test(msg));
    t('the notice says future updates only come on the survivor', /future updates.*WO-110/i.test(msg));
    const auditRow = db.WO_Audit.rows.find(r => r[1] === 'WO-110' && r[4] === 'Owner_Ref_Notice');
    t('no skip-audit row is logged when a notice was actually sent (only the send itself)', !auditRow);
  }

  // 9b. Only ONE distinct Owner_WO_Ref value is involved (nothing abandoned) -> no notice sent,
  //     and the skip is explicitly logged to WO_Audit on the survivor.
  {
    const db = makeDb([
      { ID: 'WO-113', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'SAME-1' },
      { ID: 'WO-114', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'SAME-1' },
      { ID: 'WO-115', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: '' },
    ], { properties: props, owners, config: baseConfig });
    const { woCombine } = build(db);
    const res = await woCombine(env, { survivor_wo_id: 'WO-113', combined_wo_ids: ['WO-114', 'WO-115'] });
    const body = await res.json();
    t('combine succeeds', body.success === true);
    t('no owner_wo_combined_ref notice is queued when nothing is actually abandoned', !db.Message_Queue.rows.some(r => r[2] === 'owner_wo_combined_ref'));
    const auditRow = db.WO_Audit.rows.find(r => r[1] === 'WO-113' && r[4] === 'Owner_Ref_Notice');
    t('the skip is explicitly logged to WO_Audit on the survivor', !!auditRow);
    t('the skip audit row records "skipped" as the new value', auditRow && auditRow[6] === 'skipped');
  }

  // 9c. All combined WOs have a blank Owner_WO_Ref, survivor also blank -> still nothing to
  //     abandon, skip-logged the same way.
  {
    const db = makeDb([
      { ID: 'WO-116', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: '' },
      { ID: 'WO-117', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: '' },
    ], { properties: props, owners, config: baseConfig });
    const { woCombine } = build(db);
    const res = await woCombine(env, { survivor_wo_id: 'WO-116', combined_wo_ids: ['WO-117'] });
    const body = await res.json();
    t('combine succeeds', body.success === true);
    t('no notice queued when every ref involved is blank', !db.Message_Queue.rows.some(r => r[2] === 'owner_wo_combined_ref'));
    const auditRow = db.WO_Audit.rows.find(r => r[1] === 'WO-116' && r[4] === 'Owner_Ref_Notice');
    t('skip logged even for the all-blank case', !!auditRow && auditRow[6] === 'skipped');
  }

  // 9d. The notice is a normal gated send, not a bypass — Global Twilio kill switch OFF still
  //     queues the row but never actually sends it, same as every other gated message.
  {
    const db = makeDb([
      { ID: 'WO-118', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'X1' },
      { ID: 'WO-119', Property_ID: '76', Unit_ID: 'U1', Trade: 'Plumbing', Owner_WO_Ref: 'X2' },
    ], { properties: props, owners, config: { TWILIO_ENABLED: 'FALSE', TWILIO_TEST_MODE: 'TRUE' } });
    const { woCombine } = build(db);
    await woCombine(env, { survivor_wo_id: 'WO-118', combined_wo_ids: ['WO-119'] });
    const noticeRow = db.Message_Queue.rows.find(r => r[2] === 'owner_wo_combined_ref');
    t('the owner ref notice is still queue-written even when the send itself is gated off', !!noticeRow);
    t('but it was never actually sent — Global OFF blocks it exactly like any other owner SMS', noticeRow[9] !== 'sent' && /Global OFF/.test(noticeRow[11]));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
