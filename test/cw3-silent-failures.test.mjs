// Fault-injection tests for Phase C batch w3 (Oct 20 2026): the swallowed errors in worker.js between woSplit and depositApprove
// (WO status/split/assign, vendor bills + vendor invoice email, loan ledger, invoice review approve, QB undo, estimates, approval stage).
// Extracts the REAL functions from worker.js into a fake world, FORCES each failure and asserts: reported (right severity), caller still gets what it got before
// (or now sees a warning where success used to be claimed), and the happy path reports nothing.   Run: node test/cw3-silent-failures.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function grab(name, kind = 'function') {
  const sig = (kind === 'async' ? 'async function ' : 'function ') + name + '(';
  const start = src.indexOf(sig); if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constVal = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = (.*);$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return (0, eval)('(' + m[1] + ')'); };

// ── fake world: every extracted function is evaluated inside `with (W)`, so any dependency not stubbed throws ReferenceError (loud, not silent) ──
const W = Object.create(null);
const load = (name, kind = 'function') => { W[name] = new Function('W', 'with (W) { return (' + grab(name, kind) + '); }')(W); return W[name]; };
let REPORTS, TABS, TAB_FAIL, CALLS, WRITE_FAIL, SMS_FAIL, TELEMETRY_FAIL;
const resetWorld = () => { REPORTS = []; TABS = {}; TAB_FAIL = {}; CALLS = []; WRITE_FAIL = {}; SMS_FAIL = false; TELEMETRY_FAIL = false; W._failPending.length = 0; };
W._failPending = []; W.FAIL_PENDING_MAX = constVal('FAIL_PENDING_MAX'); W.FAIL_EVENTS_TAB = 'Failure_Events'; W.FAIL_EVENT_COLS = constVal('FAIL_EVENT_COLS');
W.failSeverity = (w, m, s) => s || 'P2'; W.failTrim = (s, n) => String(s).slice(0, n);
W.reportFailure = async (env, f) => { REPORTS.push(f); return { ok: true, id: 'x' }; };
W.fetchTab = async (env, tab) => { if (TAB_FAIL[tab]) throw new Error(TAB_FAIL[tab]); return (TABS[tab] || []).map(r => ({ ...r })); };
W.sheetsRequest = async () => ({});
W.failEnsureTabs = async () => {};
for (const n of ['failBuildEvent', 'softNote', 'parseJsonCell']) load(n);
for (const n of ['softFail', 'fetchTabSoft', 'safeJson', 'tryWrite']) load(n, 'async');
W.json = (b, s) => ({ body: b, status: s || 200 });
W.isMissingTabError = (e) => /Unable to parse range/i.test((e && e.message) || '');
W.LOAN_LEDGER_TAB = 'Vendor_Loan_Ledger';
W.ensureColumns = async (env, tab, cols) => { CALLS.push(['ensureColumns', tab, cols]); if (WRITE_FAIL.ensureColumns) throw new Error('ensureColumns quota: ' + tab); };
W.updateRow = async (env, tab, id, f) => { CALLS.push(['updateRow', tab, id, f]); if (WRITE_FAIL[tab] || WRITE_FAIL.updateRow) throw new Error('updateRow failed ' + tab); return { json: async () => ({ success: true }), clone() { return this; } }; };
W.updateWOFields = async (env, id, f) => { CALLS.push(['updateWOFields', id, f]); if (WRITE_FAIL.updateWOFields) throw new Error('updateWOFields failed'); };
W.logTelemetry = async (env, e) => { CALLS.push(['telemetry', e]); if (TELEMETRY_FAIL) throw new Error('telemetry sheet write failed'); };
W.sendSMS = async (env, to, msg) => { CALLS.push(['sendSMS', to, msg]); if (SMS_FAIL) throw new Error('Twilio 503'); return { sid: 'SM1' }; };
W.logWOAudit = async () => { if (WRITE_FAIL.audit) throw new Error('audit write failed'); };
const env = {};
console.error = () => {};
const seen = (where) => REPORTS.find(f => f.where === where) || W._failPending.map(p => ({ where: p.Where, severity: p.Severity })).find(p => p.where === where);
const nothing = () => REPORTS.length === 0 && W._failPending.length === 0;

// ───────────────────────────── getVendorLoanBalance ─────────────────────────────
console.log('getVendorLoanBalance');
load('getVendorLoanBalance', 'async');
resetWorld(); TABS.Vendor_Loan_Ledger = [{ Vendor_ID: '7', Amount: '100', Active: 'TRUE' }, { Vendor_ID: '7', Amount: '-30' }, { Vendor_ID: '8', Amount: '5' }];
ok(await W.getVendorLoanBalance(env, '7') === 70 && nothing(), 'happy path sums the vendor balance and reports nothing');
resetWorld(); TAB_FAIL.Vendor_Loan_Ledger = 'Unable to parse range: Vendor_Loan_Ledger';
ok(await W.getVendorLoanBalance(env, '7') === 0 && nothing(), 'a tab that does not exist yet is "no loans": 0, not reported');
resetWorld(); TAB_FAIL.Vendor_Loan_Ledger = 'Sheets 429 quota exceeded';
ok(await W.getVendorLoanBalance(env, '7') === 0 && seen('loan_balance_read_failed') && seen('loan_balance_read_failed').severity === 'P1', 'a Sheets outage still returns 0 for old callers but is reported P1 (an outstanding loan would otherwise look like zero)');

// ───────────────────────────── setApprovalStage ─────────────────────────────
console.log('\nsetApprovalStage');
load('setApprovalStage', 'async');
W.APPROVAL_STAGES = constVal('APPROVAL_STAGES'); W.findWO = (rows, id) => rows.find(r => r.ID === id);
resetWorld(); TABS.Work_Orders = [{ ID: 'WO-1', Approval_Stage: '' }];
ok(await W.setApprovalStage(env, { woId: 'WO-1', scopeId: 'S1', stage: 'Approved' }) === true && nothing(), 'happy path: true, nothing reported');
resetWorld(); WRITE_FAIL.ensureColumns = true;
ok(await W.setApprovalStage(env, { woId: 'WO-1', stage: 'Approved' }) === true && seen('approval_stage_ensure_columns') && seen('approval_stage_ensure_columns').severity === 'P1', 'ensureColumns failure is reported P1 (write still attempted, same return as before)');
resetWorld(); WRITE_FAIL.updateWOFields = true;
ok(await W.setApprovalStage(env, { woId: 'WO-1', stage: 'Approved' }) === false && seen('approval_stage_write_failed') && seen('approval_stage_write_failed').severity === 'P1', 'a failed stage write returns false as before AND is reported P1');
resetWorld(); WRITE_FAIL.Scopes = true;
ok(await W.setApprovalStage(env, { woId: 'WO-1', scopeId: 'S1', stage: 'Approved' }) === true && seen('approval_stage_write_failed'), 'WO written, Scope write failed: still true (partial) as before, but reported');

// ───────────────────────────── backfillApprovalStage ─────────────────────────────
console.log('\nbackfillApprovalStage');
load('backfillApprovalStage', 'async');
W.fetchTabs = async (env, tabs) => Promise.all(tabs.map(t => W.fetchTab(env, t)));
const seedBackfill = () => { TABS.Work_Orders = [{ ID: 'WO-1' }, { ID: 'WO-2' }]; TABS.Estimates = [{ WO_ID: 'WO-1', Version: '1', Status: 'Pending' }, { WO_ID: 'WO-2', Version: '1', Status: 'Approved' }]; TABS.Scopes = []; };
resetWorld(); seedBackfill();
let bf = (await W.backfillApprovalStage(env, { apply: true })).body;
ok(bf.written === 2 && bf.failed === undefined && bf.failure_warning === undefined && nothing(), 'happy path: both rows written, response unchanged (no failed/warning keys), nothing reported');
resetWorld(); seedBackfill(); WRITE_FAIL.updateWOFields = true;
bf = (await W.backfillApprovalStage(env, { apply: true })).body;
ok(bf.success === true && bf.written === 0 && bf.failed === 2 && /could not be written/.test(bf.failure_warning) && seen('backfill_approval_stage_row_failed') && seen('backfill_approval_stage_row_failed').severity === 'P1', 'rows that cannot be written are counted in the response (failed/warning) and reported P1, instead of vanishing');
resetWorld(); seedBackfill(); WRITE_FAIL.ensureColumns = true;
bf = (await W.backfillApprovalStage(env, { apply: true })).body;
ok(bf.written === 2 && seen('backfill_approval_stage_ensure_columns'), 'ensureColumns failure is reported (writes still attempted as before)');

// ───────────────────────────── updateStatus / saveChecklist ─────────────────────────────
console.log('\nupdateStatus / saveChecklist');
load('updateStatus', 'async'); load('saveChecklist', 'async');
Object.assign(W, {
  addonLiveChildren: () => [], addonLiveChildrenMessage: () => '', translateToEnglish: async (e, t) => t, resetVendorNudgeClock: async () => {},
  fetchConfig: async () => ({}), fetchConfigStrict: async () => ({}), formatUnitLabel: (l) => l, tenantsForDispatch: () => [], isTenantNotifiable: () => true, woJobLabel: () => 'job',
  logSMS: async () => {}, smsGatedSend: async () => ({ sent: true }), shouldNotifyOwner: async () => false,
  releaseTurnoverCleaningIfReady: async () => { if (W.__turnoverFail) throw new Error('Sheets 500 reading Work_Orders'); },
});
const seedStatus = () => { TABS.Work_Orders = [{ ID: 'WO-1', Status: 'New', Turnover_Group_ID: 'TG1', Turnover_Role: 'Paint' }]; for (const t of ['Units', 'Tenants', 'Properties', 'Owners', 'Vendors', 'Estimates']) TABS[t] = []; };
resetWorld(); seedStatus(); W.__turnoverFail = false;
let r = await W.updateStatus(env, { wo_id: 'WO-1', status: 'Complete' });
ok(JSON.stringify(r.body) === '{"success":true}' && nothing(), 'happy path: response is exactly {success:true}, nothing reported');
resetWorld(); seedStatus(); WRITE_FAIL.ensureColumns = true;
r = await W.updateStatus(env, { wo_id: 'WO-1', status: 'On Hold', hold_reason: 'waiting on parts' });
ok(r.body.success === true && r.body.failure_warnings.length === 1 && /hold reason/i.test(r.body.failure_warnings[0]) && seen('wo_status_ensure_hold_reason').severity === 'P1', 'On Hold + ensureColumns failure: status still saved, but the caller gets a warning and the failure is reported P1');
resetWorld(); seedStatus(); W.__turnoverFail = true;
r = await W.updateStatus(env, { wo_id: 'WO-1', status: 'Complete' });
ok(r.body.success === true && /turnover cleaning/i.test(r.body.failure_warnings[0]) && seen('turnover_cleaning_release_failed').severity === 'P1', 'turnover cleaning release failure: reported P1 and surfaced as a warning (used to be invisible, leaving Cleaning On Hold)');
W.__turnoverFail = false;
resetWorld(); seedStatus(); TELEMETRY_FAIL = true;
r = await W.updateStatus(env, { wo_id: 'WO-1', status: 'Accepted' });
ok(r.body.success === true && !r.body.failure_warnings && seen('telemetry_write_failed:wo_status').severity === 'P2', 'telemetry write failure is noted P2 and does not change the response');
resetWorld(); WRITE_FAIL.audit = true;
r = await W.saveChecklist(env, { wo_id: 'WO-1', checklist: [], updated_by: 'v1' });
ok(r.body.success === true && seen('checklist_audit_failed').severity === 'P2', 'checklist audit failure: still success, reported P2');
resetWorld(); r = await W.saveChecklist(env, { wo_id: 'WO-1', checklist: [], updated_by: 'v1' });
ok(r.body.success === true && nothing(), 'checklist happy path reports nothing');

// ───────────────────────────── getAdminSmsRecipient / woLocationText / sendTemplatedSms ─────────────────────────────
console.log('\nestimate SMS helpers');
for (const n of ['getAdminSmsRecipient', 'woLocationText', 'sendTemplatedSms']) load(n, 'async');
W.propUnitText = (p, u) => (p ? p.Address : '') + (u ? ' ' + u.Unit_Label : '');
W.HUB_URL = 'https://hub'; W.DEFAULT_MESSAGE_TEMPLATES = [{ Message_Type: 't1', Channel: 'sms', Body: 'Hello {{Location}}' }]; W.renderTemplate = (b, tk) => b.replace('{{Location}}', tk.Location);
W.getMessageTemplate = async () => { if (W.__tplFail) throw new Error('Message_Templates read failed'); return null; };
W.smsGatedSend = async () => ({ sent: true });
resetWorld(); W.fetchConfig = async () => ({ ADMIN_SMS_PHONE: '+1555' });
ok((await W.getAdminSmsRecipient(env)).Phone === '+1555' && nothing(), 'getAdminSmsRecipient reads the config directly (fetchConfig never throws)');
resetWorld(); TABS.Work_Orders = [{ ID: 'WO-1', Property_ID: 'P1' }]; TABS.Properties = [{ ID: 'P1', Address: '1 Main St' }]; TABS.Units = [];
ok(await W.woLocationText(env, 'WO-1', null, '') === '1 Main St' && nothing(), 'woLocationText happy path reports nothing');
resetWorld(); TAB_FAIL.Properties = 'Sheets read failed'; TELEMETRY_FAIL = true;
ok(await W.woLocationText(env, 'WO-1', { Address: 'fallback' }, '') === 'fallback' && seen('telemetry_write_failed:wo_location_lookup_failed'), 'woLocationText: lookup failure falls back as before; when even the telemetry write fails that is noted too');
W.__tplFail = true; resetWorld();
let sr = await W.sendTemplatedSms(env, { type: 't1', kind: 'vendor', vendor: { Phone: '1' }, wo_id: 'WO-1', tokens: { Location: 'X' } });
ok(sr.sent === true && seen('message_template_lookup_failed:t1').severity === 'P2', 'template lookup failure: SMS still goes out with the built-in default, failure noted P2');
W.__tplFail = false; resetWorld(); W.smsGatedSend = async () => { throw new Error('Twilio down'); }; TELEMETRY_FAIL = true;
sr = await W.sendTemplatedSms(env, { type: 't1', kind: 'vendor', vendor: { Phone: '1' }, wo_id: 'WO-1', tokens: { Location: 'X' } });
ok(sr.sent === false && /Twilio down/.test(sr.error) && seen('telemetry_write_failed:estimate_sms_failed'), 'send failure still returns {sent:false,error}; the telemetry write failure behind it is noted too');
W.smsGatedSend = async () => ({ sent: true });

// ───────────────────────────── vendor bills ─────────────────────────────
console.log('\nvendor bills: editVendorBillReceipts / vendorAccessRequestApprove / vendorRequestPropertyAccess / list readers');
for (const n of ['editVendorBillReceipts', 'vendorAccessRequestApprove', 'vendorRequestPropertyAccess', 'vendorLoanGet', 'listVendorAccessRequests', 'listVendorBills'])
  load(n, 'async');
W.addRow = async (env, tab, row) => { CALLS.push(['addRow', tab, row]); return { body: { success: true, id: '99' }, status: 200, clone() { return this; }, json: async () => ({ success: true, id: '99' }) }; };
W.getConfig = async () => ({ admin_phone: '+1555' });
const seedBill = () => { TABS.Vendor_Bills = [{ ID: 'B1', WO_ID: 'WO-1', Status: 'reviewed', Labor_Total: '100', Receipts_JSON: '[]', Total: '100' }]; TABS.Invoice_Review = [{ ID: 'IR1', Bill_ID: 'B1', Active: 'TRUE' }]; };
resetWorld(); seedBill();
r = await W.editVendorBillReceipts(env, { bill_id: 'B1', receipts: [{ amount: 20, desc: 'paint' }] });
ok(r.body.success === true && r.body.reset_to_submitted === true && nothing(), 'editVendorBillReceipts happy path: unchanged response, nothing reported');
resetWorld(); seedBill(); TAB_FAIL.Invoice_Review = 'Sheets 503';
r = await W.editVendorBillReceipts(env, { bill_id: 'B1', receipts: [{ amount: 20, desc: 'paint' }] });
ok(r.body.success === true && seen('bill_receipts_invoice_review_read_failed').severity === 'P1', 'Invoice_Review unreadable (so the "already sent to QuickBooks" stop could not be checked): proceeds as before but is reported P1');
resetWorld(); seedBill(); WRITE_FAIL.Invoice_Review = true; WRITE_FAIL.ensureColumns = true; WRITE_FAIL.audit = true;
r = await W.editVendorBillReceipts(env, { bill_id: 'B1', receipts: [{ amount: 20, desc: 'paint' }] });
ok(r.body.success === true && ['bill_receipts_ensure_columns', 'bill_receipts_stale_review_row', 'bill_receipts_audit_failed'].every(w => seen(w) && seen(w).severity === 'P1'), 'ensureColumns, stale review-row and audit failures are each reported P1 while the bill edit itself still lands');

resetWorld(); TABS.Vendor_Access_Requests = [{ ID: '5', Vendor_ID: 'V1', Requested_Property_ID: 'P1' }]; TABS.Vendors = [{ ID: 'V1', Billing_Property_Access: '' }];
r = await W.vendorAccessRequestApprove(env, { id: '5', decision: 'approve', scope: 'ongoing' });
ok(r.body.success === true && nothing(), 'access approve happy path reports nothing');
resetWorld(); TABS.Vendor_Access_Requests = [{ ID: '5', Vendor_ID: 'V1', Requested_Property_ID: 'P1' }]; TABS.Vendors = [{ ID: 'V1', Billing_Property_Access: '' }]; WRITE_FAIL.Vendors = true;
r = await W.vendorAccessRequestApprove(env, { id: '5', decision: 'approve', scope: 'ongoing' });
ok(r.body.success === true && seen('vendor_access_grant_property_append').severity === 'P1', 'access approve: the vendor property-list append failing is reported P1 (request still resolved as before)');

resetWorld(); TABS.Vendors = [{ ID: 'V1', Name: 'Vee' }]; TABS.Properties = [{ ID: 'P1', Address: '1 Main' }]; SMS_FAIL = true;
r = await W.vendorRequestPropertyAccess(env, { vendor_id: 'V1', property_id: 'P1' });
ok(r.body.success !== false && CALLS.some(c => c[0] === 'addRow') && seen('vendor_access_request_admin_sms_failed').severity === 'P0', 'access request: the row is saved; Brett not being texted is reported P0');

resetWorld(); TAB_FAIL.Vendor_Loan_Ledger = 'Sheets 429';
r = await W.vendorLoanGet(env, { searchParams: new URLSearchParams('vendor_id=V1') });
ok(seen('vendor_loan_get_read_failed').severity === 'P1', 'vendor loan history read failure is reported P1 (balance screen would otherwise look clean)');
resetWorld(); TAB_FAIL.Vendor_Loan_Ledger = 'Unable to parse range: x';
await W.vendorLoanGet(env, { searchParams: new URLSearchParams('vendor_id=V1') });
ok(nothing(), 'missing loan tab is a legitimate "no history": nothing reported');
resetWorld(); TAB_FAIL.Vendor_Access_Requests = 'Sheets 503';
r = await W.listVendorAccessRequests(env, { searchParams: new URLSearchParams('status=pending') });
ok(Array.isArray(r.body) ? r.body.length === 0 : true, 'access request list still answers (empty) on a read failure') ;
ok(seen('vendor_access_requests_read_failed').severity === 'P2', '...and the read failure is reported P2');
resetWorld(); TAB_FAIL.Vendor_Bills = 'Sheets 503';
r = await W.listVendorBills(env, { searchParams: new URLSearchParams('status=submitted') });
ok(Array.isArray(r.body) && r.body.length === 0 && seen('vendor_bills_list_failed').severity === 'P1', 'Review Bills list: still [] for the UI but the read failure is reported P1');

// ───────────────────────────── addVendorBill ─────────────────────────────
console.log('\naddVendorBill / sendVendorInvoiceConfirmationEmail');
load('addVendorBill', 'async'); load('sendVendorInvoiceConfirmationEmail', 'async');
Object.assign(W, {
  bidGroupWriteBlock: async () => null, findRecentDuplicate: async () => null, parseIdList: (x) => (Array.isArray(x) ? x : []),
  linkTimeEntriesToBill: async () => { if (W.__linkFail) throw new Error('Time_Entries write failed'); },
  autoMatchVendorToQbo: async () => { if (W.__qboFail) throw new Error('QBO vendor lookup failed'); },
  WOStatus: { sets: { FIELD_OPEN: ['New', 'Assigned'] } },
  gmailSendEmail: async () => { CALLS.push(['email']); if (W.__emailFail) throw new Error('Gmail 500'); },
  logMessageAudit: async () => { if (W.__auditFail) throw new Error('Message_Audit write failed'); },
  translateText: async () => { if (W.__xlateFail) throw new Error('translate down'); return 'Descripcion'; },
  makeSessionToken: async () => { if (W.__tokenFail) throw new Error('WORKER_SECRET missing'); return 'tok'; },
  parseHolidayMap: () => ({}), vendorPaymentWindow: () => ({ due_date: '2026-11-01', skipped_holidays: [] }), _escHtml: (x) => String(x), driveIdFromUrl: (u) => u && 'F1',
});
const seedBillAdd = () => { TABS.Work_Orders = [{ ID: 'WO-1', Status: 'New', Property_ID: 'P1', Description: 'Fix sink' }]; TABS.Vendors = [{ ID: 'V1', Name: 'Vee', Email: 'v@x.com', Phone: '+1', Language: 'en' }]; TABS.Properties = [{ ID: 'P1', Address: '1 Main' }]; };
const clearFlags = () => { for (const k of ['__linkFail', '__qboFail', '__emailFail', '__auditFail', '__xlateFail', '__tokenFail']) W[k] = false; };
const billBody = () => ({ WO_ID: 'WO-1', Vendor_ID: 'V1', Total: '50', Vendor_Invoice_No: 'A1', Vendor_Invoice_Date: '2026-10-01', Payment_Method: 'x', Invoice_File_URL: 'u', Invoice_Description: 'd', time_entry_ids: ['T1'], Receipts_JSON: '[{"url":"u","desc":"r"}]' });
clearFlags(); resetWorld(); seedBillAdd(); W.fetchConfig = async () => ({ VENDOR_INVOICE_EMAIL_TEST_VENDOR_IDS: 'V1' });
r = await W.addVendorBill(env, billBody());
ok(r.body.success === true && nothing() && CALLS.some(c => c[0] === 'email'), 'addVendorBill happy path: bill saved, email sent, nothing reported');
clearFlags(); resetWorld(); seedBillAdd(); WRITE_FAIL.ensureColumns = true;
r = await W.addVendorBill(env, billBody());
const colWheres = ['Vendor_Invoice_No', 'Vendor_Invoice_Date', 'Payment_Method', 'Invoice_File', 'Invoice_Description', 'Submitted_At'].map(c => 'vendor_bill_ensure_columns:' + c);
ok(r.body.success === true && colWheres.every(w => seen(w) && seen(w).severity === 'P1'), 'every ensureColumns failure on the bill is reported P1 (the bill still saves, exactly as before)');
clearFlags(); resetWorld(); seedBillAdd(); W.__linkFail = true; W.__qboFail = true; W.__emailFail = true;
r = await W.addVendorBill(env, billBody());
ok(r.body.success === true && seen('vendor_bill_link_time_entries').severity === 'P1' && seen('vendor_bill_qbo_vendor_match').severity === 'P1' && seen('vendor_invoice_confirmation_email_failed').severity === 'P1', 'time-entry link, QBO vendor match and confirmation email failures are each reported P1; the bill response is unchanged');
clearFlags(); resetWorld(); seedBillAdd(); WRITE_FAIL.updateWOFields = true;
r = await W.addVendorBill(env, billBody());
ok(r.body.success === true && seen('vendor_bill_auto_complete_wo').severity === 'P1', 'bill saved but the WO could not be moved to Complete: reported P1');
clearFlags(); resetWorld(); seedBillAdd(); W.findRecentDuplicate = async () => ({ ID: 'B0' }); W.__linkFail = true;
r = await W.addVendorBill(env, billBody()); W.findRecentDuplicate = async () => null;
ok(r.body.duplicate === true && seen('vendor_bill_dupe_link_time_entries').severity === 'P1', 'duplicate re-submit: link failure reported P1, response still duplicate:true');

clearFlags(); resetWorld(); seedBillAdd(); TABS.Vendors[0].Language = 'es'; W.__xlateFail = true; W.__tokenFail = true; W.__auditFail = true;
await W.sendVendorInvoiceConfirmationEmail(env, billBody());
ok(CALLS.some(c => c[0] === 'email') && seen('vendor_invoice_email_translate_failed').severity === 'P2' && seen('vendor_invoice_email_file_token_failed').severity === 'P0' && seen('message_audit_failed:vendor_invoice_confirmation').severity === 'P2', 'invoice email: translate (P2), session-token (P0) and audit (P2) failures are reported; the email still goes out');
clearFlags(); resetWorld(); seedBillAdd(); TABS.Vendors[0].Email = ''; SMS_FAIL = true;
await W.sendVendorInvoiceConfirmationEmail(env, billBody());
ok(seen('vendor_email_request_sms_failed').severity === 'P1', 'asking a vendor for their email by SMS: a failed stamp write is reported P1 (reviewer: P0 was too loud for a nicety)');
clearFlags(); resetWorld(); seedBillAdd(); TABS.Vendors[0].Email = ''; WRITE_FAIL.ensureColumns = true;
await W.sendVendorInvoiceConfirmationEmail(env, billBody());
ok(seen('vendor_email_request_ensure_columns').severity === 'P1', 'email-request stamp column failure reported P1');
clearFlags(); resetWorld(); seedBillAdd(); TAB_FAIL.Properties = 'Sheets 503';
await W.sendVendorInvoiceConfirmationEmail(env, billBody());
ok(seen('tab_read_failed:vendor_invoice_email') && CALLS.some(c => c[0] === 'email'), 'a failed Properties read is reported (P2) and the email still goes out without the address, as before');
clearFlags(); resetWorld(); seedBillAdd(); const rcpt = { ...billBody(), Receipts_JSON: '{not json' };
await W.sendVendorInvoiceConfirmationEmail(env, rcpt);
ok(seen('json_cell_corrupt:Vendor_Bills.Receipts_JSON').severity === 'P1', 'a corrupt Receipts_JSON cell is noted P1 (receipt links skipped as before; money-adjacent so it reaches the digest)');

// ───────────────────────────── estimates ─────────────────────────────
console.log('\nestimates: approve / unapprove / flag / retranslate / reminders');
for (const n of ['unapproveEstimate', 'approveEstimate', 'flagEstimate', 'retranslateEstimate', 'processEstimateReminders', 'scopeDepositInvoiceId', 'notifyVendorTemplated', 'estimateSmsContext']) load(n, 'async');
load('addonEstimateActionBlock'); load('col'); load('estimatesAwaitingDecision'); load('firstMilestoneForSignature');
Object.assign(W, {
  NEEDS_INFO_RESUME_DAYS: 3, REMINDER_MIN_AGE_HOURS: 12, ESTIMATE_SMS_DEFAULT_SINCE: '2026-09-29T00:00:00.000Z', fmtMoney: (n) => String(n), vendorFirstName: () => 'V',
  translateForVendorDetailed: async (e, v, t) => ({ text: t, translated: false }), logSMS: async () => {},
  etHour: () => 10, etDateString: () => '2026-10-20', setConfigKey: async () => { if (W.__cfgWriteFail) throw new Error('Config write 503'); },
  paymentMilestonesTab: async () => { if (W.__msFail) throw new Error('ensureTab quota'); }, resolveScopeDepositInvoice: () => 'INV1',
  estimateEnglishFields: async (e, lines) => ({ ok: true, line_items: lines, change_reason_en: 'x' }),
  WOStatus: { sets: { RECEIPT_CLOSED: ['Closed'], FIELD_OPEN: ['New'] } }, propUnitText: () => 'loc', translateText: async (e, t) => t,
});
W.json = (b, s) => ({ body: b, status: s || 200 });
const sheetWith = (rows) => async (env, method, path) => (method === 'GET' ? { values: rows } : {});
const estRows = [['ID', 'Status', 'Approval_Note'], ['E1', 'Approved', '']];
const seedEst = (status) => { TABS.Estimates = [{ ID: 'E1', WO_ID: 'WO-1', Version: '1', Status: status || 'Approved', Vendor_ID: 'V1', Subtotal: '100', Line_Items: '[{"desc":"a"}]' }]; TABS.Work_Orders = [{ ID: 'WO-1', Vendor_ID: 'V1', Property_ID: 'P1' }]; TABS.Vendors = [{ ID: 'V1', Phone: '+1', Name: 'Vee' }]; TABS.Properties = [{ ID: 'P1', Address: 'A' }]; TABS.Units = []; };
W.sheetsRequest = sheetWith(estRows);
resetWorld(); seedEst(); W.fetchConfig = async () => ({});
r = await W.unapproveEstimate(env, { wo_id: 'WO-1', reason: 'redo' });
ok(r.body.success === true && r.body.vendor_notified === true && r.body.warning === '' && nothing(), 'unapproveEstimate happy path: vendor texted, no warning, nothing reported');
resetWorld(); seedEst(); SMS_FAIL = true;
r = await W.unapproveEstimate(env, { wo_id: 'WO-1' });
ok(r.body.success === true && r.body.vendor_notified === false && /could not be texted/.test(r.body.warning) && seen('estimate_unapprove_vendor_sms_failed').severity === 'P0', 'unapproveEstimate: vendor SMS failure keeps its warning AND is now reported P0');

W.notifyVendorTemplated = undefined; load('notifyVendorTemplated', 'async');
W.sendTemplatedSms = async () => { throw new Error('Twilio 503'); };
resetWorld(); seedEst('Pending'); W.sheetsRequest = sheetWith([['ID', 'Status', 'Approved_By'], ['E1', 'Pending', '']]); TELEMETRY_FAIL = true;
r = await W.approveEstimate(env, { wo_id: 'WO-1' });
ok(r.body.success === true && /text failed/.test(r.body.vendor_sms) && seen('telemetry_write_failed:estimate_approve_vendor_sms_failed').severity === 'P2', 'approveEstimate: SMS failure still surfaced in the response; the telemetry write failure behind it is noted');
resetWorld(); seedEst('Pending'); W.sendTemplatedSms = async () => ({ sent: true });
r = await W.approveEstimate(env, { wo_id: 'WO-1' });
ok(r.body.success === true && r.body.vendor_sms === 'sent' && nothing(), 'approveEstimate happy path reports nothing');

resetWorld(); seedEst('Pending'); WRITE_FAIL.ensureColumns = true; W.sendTemplatedSms = async () => ({ sent: true });
r = await W.flagEstimate(env, { wo_id: 'WO-1', reason: 'x' }, 'decline');
ok(r.body.success === true && seen('estimate_flag_ensure_columns').severity === 'P1', 'flagEstimate: ensureColumns failure reported P1 (flag still saved)');

resetWorld(); seedEst('Pending'); WRITE_FAIL.ensureColumns = true;
r = await W.retranslateEstimate(env, { estimate_id: 'E1' });
ok(r.body.success === true && seen('estimate_retranslate_ensure_columns').severity === 'P1', 'retranslate: ensureColumns failure reported P1');
resetWorld(); seedEst('Pending'); TABS.Estimates[0].Line_Items = '{broken';
r = await W.retranslateEstimate(env, { estimate_id: 'E1' });
ok(r.status === 400 && /no line items/i.test(r.body.error) && seen('json_cell_corrupt:Estimates.Line_Items').severity === 'P2', 'retranslate: corrupt Line_Items still gives the same 400 but the corruption is now noted P2');
resetWorld(); seedEst('Pending'); TELEMETRY_FAIL = true;
r = await W.retranslateEstimate(env, { estimate_id: 'E1' });
ok(r.body.success === true && seen('telemetry_write_failed:estimate_retranslate').severity === 'P2', 'retranslate: telemetry failure noted P2 only');
resetWorld(); seedEst('Pending'); r = await W.retranslateEstimate(env, { estimate_id: 'E1' });
ok(r.body.success === true && nothing(), 'retranslate happy path reports nothing');

resetWorld(); W.__cfgWriteFail = true; TABS.Estimates = [{ ID: 'E1', WO_ID: 'WO-1', Version: '1', Status: 'Pending', Created_Date: '2026-10-10T00:00:00Z', Vendor_ID: 'V1' }]; TABS.Work_Orders = [{ ID: 'WO-1', Status: 'New' }]; TABS.Vendors = []; W.fetchConfig = async () => ({}); W.fetchConfigStrict = async () => ({});
r = await W.processEstimateReminders(env, new Date('2026-10-20T15:00:00Z'));
ok(r.skipped === 'could not claim the day' && seen('estimate_reminder_claim_failed').severity === 'P1', 'reminder day-claim failure still skips (no double text) but is now reported P1'); W.__cfgWriteFail = false;
resetWorld(); W.__msFail = true; TABS.Scope_Signatures = []; TABS.Payment_Milestones = [];
ok(await W.scopeDepositInvoiceId(env, 'S1', null) === 'INV1' && seen('payment_milestones_ensure_tab_failed').severity === 'P1', 'scopeDepositInvoiceId: ensureTab failure noted P1, lookup continues as before'); W.__msFail = false;

// ───────────────────────────── approveInvoiceReview / qbUndoSend ─────────────────────────────
console.log('\ninvoice review approve / QuickBooks undo');
load('approveInvoiceReview', 'async'); load('qbUndoSend', 'async');
Object.assign(W, {
  resolveApprovalPad: async () => ({ pad: 0 }), bidGroupWriteBlock: async () => null, scopeCoveringSignatureForWO: async () => null, sameCents: (a, b) => a === b,
  invalidateTabCache: () => {}, findWO: (rows, id) => rows.find(r => r.ID === id),
});
W.addRow = async (env, tab, row) => ({ body: {}, clone() { return this; }, json: async () => { if (W.__addParseFail) throw new Error('Unexpected end of JSON'); return { success: true, id: '77' }; } });
const approveBody = () => ({ bill_id: 'B1', wo_id: 'WO-1', vendor_id: 'V1', customer_total: '150', approved_by: 'Brett' });
const seedApprove = () => { TABS.Invoice_Review = []; TABS.Vendor_Bills = [{ ID: 'B1', WO_ID: 'WO-1' }]; TABS.Work_Orders = [{ ID: 'WO-1', Deposit_Amount: '50', Deposit_Applied: 'FALSE' }]; };
resetWorld(); seedApprove(); W.__addParseFail = false;
r = await W.approveInvoiceReview(env, approveBody());
ok(JSON.stringify(r.body) === '{"success":true,"id":"77","instant_pad":0}' && nothing(), 'approve happy path: response is exactly what it was, nothing reported');
resetWorld(); seedApprove(); WRITE_FAIL.updateWOFields = true;
r = await W.approveInvoiceReview(env, approveBody());
ok(r.body.success === true && r.body.id === '77' && /deposit could not be marked as applied/.test(r.body.failure_warning) && seen('approve_invoice_review_deposit_flag').severity === 'P1', 'approve: deposit flag not saved -> review still saved, but the response carries a warning and it is reported P1 (a second bill could net the deposit twice)');
resetWorld(); seedApprove(); TAB_FAIL.Invoice_Review = 'Sheets 503';
r = await W.approveInvoiceReview(env, approveBody());
ok(r.body.success === true && seen('approve_invoice_review_dedupe_read').severity === 'P1', 'approve: unreadable dedupe tab is reported P1 (approval proceeds as before)');
resetWorld(); seedApprove(); WRITE_FAIL.ensureColumns = true; W.resolveApprovalPad = async () => ({ pad: 0 });
r = await W.approveInvoiceReview(env, approveBody());
ok(r.body.success === true && seen('approve_invoice_review_ensure_columns').severity === 'P1', 'approve: wage/profit ensureColumns failure reported P1');
resetWorld(); seedApprove(); W.__addParseFail = true;
r = await W.approveInvoiceReview(env, approveBody()); W.__addParseFail = false;
ok(r.body.success === true && r.body.id === '' && seen('approve_invoice_review_add_response_unreadable').severity === 'P1', 'approve: unreadable addRow response reported P1 (same empty-id result as before)');

const seedUndo = () => { TABS.Invoice_Review = [{ ID: 'IR1', Active: 'TRUE', Bill_ID: 'B1', WO_ID: 'WO-1', QB_Invoice_ID: 'I9', QB_Bill_ID: 'QB9', Proposal_Scope_ID: '' }]; TABS[W.LOAN_LEDGER_TAB] = [{ ID: 'L1', Active: 'TRUE', Entry_Type: 'auto-deduction', Bill_ID: 'B1', Amount: '-25' }]; };
Object.assign(W, {
  qbAccessToken: async () => 'tok', qbApi: async () => ({ Invoice: { Balance: 0, TotalAmt: 1 }, Bill: { Balance: 0, TotalAmt: 1 } }), qbFault: () => '', qbTxnSafeToDelete: () => ({ ok: true }),
  qbDeleteInvoiceSafe: async () => ({ ok: true, doc: 'D1' }), qbDeleteBillSafe: async () => ({ ok: true, doc: 'D2' }), qbProposalRevert: async () => ({ reverted: false }), unapproveInvoiceReview: async () => ({ body: {} }),
});
resetWorld(); seedUndo();
r = await W.qbUndoSend(env, { id: 'IR1' });
ok(r.body.success === true && r.body.loan_reversed === 25 && r.body.warning === '' && nothing(), 'QB undo happy path: loan reversed, no warning, nothing reported');
resetWorld(); seedUndo(); WRITE_FAIL[W.LOAN_LEDGER_TAB] = true;
r = await W.qbUndoSend(env, { id: 'IR1' });
ok(r.body.success === true && r.body.loan_reversed === 0 && /loan-ledger deduction failed/.test(r.body.failure_warning) && !/loan-ledger/.test(r.body.warning) && seen('qb_undo_loan_reversal_failed').severity === 'P0', 'QB undo: a loan deduction that could not be reversed is reported P0 and shown in the response warning (used to be invisible)');
resetWorld(); seedUndo(); TAB_FAIL[W.LOAN_LEDGER_TAB] = 'Unable to parse range: Vendor_Loan_Ledger';
r = await W.qbUndoSend(env, { id: 'IR1' });
ok(r.body.success === true && r.body.warning === '' && nothing(), 'QB undo: no ledger tab = nothing to reverse, stays quiet');
resetWorld(); seedUndo(); WRITE_FAIL.audit = true; TELEMETRY_FAIL = true; W.qbProposalRevert = async () => { throw new Error('revert exploded'); };
r = await W.qbUndoSend(env, { id: 'IR1' });
ok(r.body.success === true && /signed proposal/.test(r.body.warning) && seen('qb_undo_audit_failed').severity === 'P1' && seen('telemetry_write_failed:proposal_revert_failed').severity === 'P2', 'QB undo: audit failure reported P1, proposal-revert telemetry failure noted; the revert warning is still returned');

// ───────────────────────────── source-level: converted sites no longer swallow ─────────────────────────────
console.log('\nsource check');
// Region owned by this batch: from the woSplit tenant-notify catch to the end of the vendor-deposit properties read.
const rs = src.indexOf("softFail(env, 'wo_split_tenant_notify'"), re = src.indexOf("fetchTabSoft(env, 'Properties', 'vendor_deposit_context')");
const region = src.slice(rs, re);
ok(rs > 0 && re > rs, 'region markers found');
const bare = region.match(/catch\s*(\(\s*\w*\s*\))?\s*\{\s*(\/\*[^*]*\*\/)?\s*\}/g) || [];
ok(bare.length === 0, 'no empty catch block is left in the region', bare);
ok(!/try \{ cfg = await fetchConfig\(env\); \} catch \(_\)/.test(region), 'no silent try/catch around fetchConfig remains in the region');
ok(!/\.catch\(\(\) => \[\]\)/.test(region), 'no `.catch(() => [])` read swallow remains in the region');
ok(!/catch ?\(?_?\)? ?\{\}/.test(region), 'no `catch (_) {}` left in the region');
ok(/vendor_deposit_context/.test(src) && /vendor_invoice_email/.test(src), 'converted fetchTabSoft call sites present');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
