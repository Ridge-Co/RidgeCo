// Fault-injection tests for Phase C batch w4, part 2 (Oct 20 2026): the admin/owner WO + merge handlers whose best-effort steps used to vanish.
// Real functions (addWONote, ownerUpdateWO, adminUpdateWO, adminMergeOwner, adminMergeProperty) are pulled out of worker.js and driven with forced failures.
// Run: node test/cw4-handlers-silent-failures.test.mjs
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
const constBlock = (n) => { const m = new RegExp('^const ' + n + ' = [\\s\\S]*?^\\];?$|^const ' + n + ' = .*;$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };
console.error = () => {};

let REPORTS, ENSURE_FAIL, SMS_FAIL, UPDATEROW_FAIL_FOR, FETCH_FAIL_AFTER, TABS, UNITS_CALLS, SENT;
const softFail = async (env, where, err, sev, ctx) => { REPORTS.push({ where, sev, ctx }); return { ok: false, error: String((err && err.message) || err) }; };
const softNote = (where, err, sev) => { REPORTS.push({ where, sev, note: true }); };
const json = (b, s) => ({ body: b, status: s || 200 });
const ensureColumns = async () => { if (ENSURE_FAIL) throw new Error('ensureColumns 429'); };
const fetchTab = async (env, tab) => { if (tab === 'Units') { UNITS_CALLS++; if (FETCH_FAIL_AFTER && UNITS_CALLS >= FETCH_FAIL_AFTER) throw new Error('Units read 503'); } return (TABS[tab] || []).map(r => Object.assign({}, r)); };
const fetchTabs = async (env, tabs) => Promise.all(tabs.map(t => fetchTab(env, t)));
const fetchConfig = async () => ({ admin_phone: '+14105550000' });
const sendSMS = async (env, to, msg) => { if (SMS_FAIL) throw new Error('twilio down'); SENT.push([to, msg]); return { sid: 'S' }; };
const smsGatedSend = async () => { if (SMS_FAIL) throw new Error('gate down'); return { sent: true }; };
const logSMS = async () => {};
const logWOAuditMany = async () => {};
const logWOAudit = async () => {};
const updateRow = async (env, tab, id) => { if (UPDATEROW_FAIL_FOR && UPDATEROW_FAIL_FOR(tab, id)) throw new Error('updateRow 503 on ' + tab); return { ok: true }; };
const updateWOFields = async () => {};
const findWO = (rows, id) => rows.find(r => r.ID === id);
const propUnitText = (p) => (p && p.Address) || '';
const translateToEnglish = async () => '';
const isMissingTabError = () => false;
const qbOwnerDisplayName = (o) => (o.Billing_Name || o.Company || '').trim();
const qbNormName = (s) => String(s || '').toLowerCase().trim();
const qbNormAddress = (s) => String(s || '').toLowerCase().trim();

const OWNER_EDITABLE_FIELDS = ['Owner_WO_Ref', 'Priority', 'Scheduled_Date', 'Managed_By'];
const code = [
  "const OWNER_EDITABLE_FIELDS = ['Owner_WO_Ref','Priority','Scheduled_Date','Managed_By'];",
  "const OWNER_REFS = [{ tab: 'Properties', col: 'Owner_ID' }];",
  "const PROPERTY_REFS = [{ tab: 'Work_Orders', col: 'Property_ID' }, { tab: 'Units', col: 'Property_ID' }];",
  grab('addEstimateVersion', 'async'), grab('addWONote', 'async'), grab('ownerUpdateWO', 'async'), grab('adminUpdateWO', 'async'), grab('adminMergeOwner', 'async'), grab('adminMergeProperty', 'async'),
].join('\n');
let EST = {};
const bidGroupWriteBlock = async () => null, findRecentDuplicate = async () => null, estimateLineItemsCanonical = (x) => x, vendorWantsSpanish = () => false, fmtMoney = (n) => '$' + n;
const estimateEnglishFields = async () => { if (EST.translate) throw new Error('claude 529'); return { ok: false }; };
const addRow = async () => { if (EST.addRow) throw new Error('addRow 503'); return { ok: true }; };
const updateWOField = async () => EST.fieldRes;
const setApprovalStage = async () => { if (EST.stage) throw new Error('stage 503'); };
const estimateSmsContext = async () => ({ wo: {}, vendor: {}, property: {}, address: 'x' });
const sendTemplatedSms = async () => { if (EST.sms) throw new Error('sms 503'); };
const fetchTabSoft = async (env, tab) => fetchTab(env, tab);
const W = new Function('bidGroupWriteBlock', 'findRecentDuplicate', 'estimateLineItemsCanonical', 'vendorWantsSpanish', 'fmtMoney', 'estimateEnglishFields', 'addRow', 'updateWOField', 'setApprovalStage', 'estimateSmsContext', 'sendTemplatedSms', 'fetchTabSoft', 'softFail', 'softNote', 'json', 'ensureColumns', 'fetchTab', 'fetchTabs', 'fetchConfig', 'sendSMS', 'smsGatedSend', 'logSMS', 'logWOAuditMany', 'logWOAudit', 'updateRow', 'updateWOFields', 'findWO',
  'propUnitText', 'translateToEnglish', 'isMissingTabError', 'qbOwnerDisplayName', 'qbNormName', 'qbNormAddress',
  code + '\nreturn { addEstimateVersion, addWONote, ownerUpdateWO, adminUpdateWO, adminMergeOwner, adminMergeProperty };')(
  bidGroupWriteBlock, findRecentDuplicate, estimateLineItemsCanonical, vendorWantsSpanish, fmtMoney, estimateEnglishFields, addRow, updateWOField, setApprovalStage, estimateSmsContext, sendTemplatedSms, fetchTabSoft,
  softFail, softNote, json, ensureColumns, fetchTab, fetchTabs, fetchConfig, sendSMS, smsGatedSend, logSMS, logWOAuditMany, logWOAudit, updateRow, updateWOFields, findWO,
  propUnitText, translateToEnglish, isMissingTabError, qbOwnerDisplayName, qbNormName, qbNormAddress);

const reset = () => {
  REPORTS = []; ENSURE_FAIL = false; SMS_FAIL = false; UPDATEROW_FAIL_FOR = null; FETCH_FAIL_AFTER = 0; UNITS_CALLS = 0; SENT = [];
  TABS = {
    Work_Orders: [{ ID: 'WO-1', Property_ID: 'P1', Managed_By: 'RidgeCo', Notes: '' }],
    Properties: [{ ID: 'P1', Owner_ID: 'O1', Address: '1 Main St', City: 'Baltimore' }, { ID: 'P2', Owner_ID: 'O1', Address: '1 Main St', City: 'Baltimore' }],
    Owners: [{ ID: 'O1', Billing_Name: 'Acme', QBO_Customer_ID: '55', Phone: '+1410' }, { ID: 'O2', Billing_Name: 'Acme', QBO_Customer_ID: '' }, { ID: 'O3', Billing_Name: 'Acme', QBO_Customer_ID: '' }],
    Units: [{ ID: 'U1', Property_ID: 'P1', Unit_Label: 'Apt 1' }, { ID: 'U2', Property_ID: 'P2', Unit_Label: 'Apt 1' }],
  };
};

console.log('addEstimateVersion: best-effort steps after the estimate row is saved');
const estBody = { wo_id: 'WO-1', vendor_id: 'V1', created_by: 'vendor', line_items: [{ desc: 'fix', amount: 100 }] };
reset(); EST = {};
let er = await W.addEstimateVersion({}, estBody);
ok(JSON.stringify(er.body) === '{"success":true,"version":1,"subtotal":"100.00"}' && REPORTS.length === 0, 'happy path response is byte-for-byte the old one, nothing reported');
reset(); EST = { fieldRes: { ok: false, error: 'x' } }; er = await W.addEstimateVersion({}, estBody);
ok(er.body.success === true && er.body.failure_warnings && /Current_Estimate/.test(er.body.failure_warnings[0]), 'updateWOField reports {ok:false}: the response carries a warning (estimate itself saved)');
reset(); EST = { stage: true }; er = await W.addEstimateVersion({}, estBody);
ok(er.body.success === true && /approval stage/.test(er.body.failure_warnings[0]) && REPORTS.some(x => x.where === 'estimate_approval_stage_update' && x.sev === 'P1'), 'approval stage update fails: P1 reported + warning');
reset(); EST = { sms: true }; er = await W.addEstimateVersion({}, estBody);
ok(er.body.success === true && !er.body.failure_warnings && REPORTS.some(x => x.where === 'estimate_admin_sms_failed' && x.sev === 'P0'), 'the "new estimate" text to Brett fails: P0 reported, estimate still saved');
reset(); EST = { translate: true }; er = await W.addEstimateVersion({}, estBody);
ok(er.body.success === true && REPORTS.some(x => x.where === 'estimate_english_copy_failed' && x.sev === 'P2'), 'English-copy translation fails: P2 noted, the estimate is saved without it (fail-open unchanged)');

console.log('\naddWONote: tenant note pings Brett');
reset(); let r = await W.addWONote({}, { wo_id: 'WO-1', note: 'leak', author_role: 'tenant', author: 'T' });
ok(r.body.success === true && SENT.length === 1 && REPORTS.length === 0, 'happy path: note saved, admin text sent, nothing reported');
reset(); SMS_FAIL = true; r = await W.addWONote({}, { wo_id: 'WO-1', note: 'leak', author_role: 'tenant', author: 'T' });
ok(r.body.success === true && REPORTS.some(x => x.where === 'tenant_note_admin_sms_failed' && x.sev === 'P0'), 'admin text fails: the saved note still returns success, but a P0 is reported', REPORTS);

console.log('\nownerUpdateWO / adminUpdateWO: Managed_By column');
reset(); r = await W.ownerUpdateWO({}, { wo_id: 'WO-1', owner_id: 'O1', fields: { Managed_By: 'Owner' } });
ok(JSON.stringify(r.body) === '{"success":true}' && REPORTS.length === 0, 'owner happy path response is exactly {success:true}');
reset(); ENSURE_FAIL = true; r = await W.ownerUpdateWO({}, { wo_id: 'WO-1', owner_id: 'O1', fields: { Managed_By: 'Owner' } });
ok(r.body.success === true && /Managed_By column/.test(r.body.failure_warning) && REPORTS.some(x => x.where === 'owner_update_wo_managed_by_column' && x.sev === 'P1'), 'owner: column setup fails -> P1 reported and the screen gets a warning', REPORTS);
reset(); r = await W.adminUpdateWO({}, { wo_id: 'WO-1', fields: { Managed_By: 'Owner' } });
ok(JSON.stringify(r.body) === '{"success":true}' && REPORTS.length === 0, 'admin happy path (owner notified) is exactly {success:true}');
reset(); ENSURE_FAIL = true; r = await W.adminUpdateWO({}, { wo_id: 'WO-1', fields: { Managed_By: 'Owner' } });
ok(r.body.success === true && /Managed_By column/.test(r.body.failure_warning) && REPORTS.some(x => x.where === 'admin_update_wo_managed_by_column' && x.sev === 'P1'), 'admin: column setup fails -> P1 + warning');
reset(); TABS.Owners[0].Phone = '+14105551111'; TABS.Properties[0].Owner_ID = 'O1'; SMS_FAIL = true;
r = await W.adminUpdateWO({}, { wo_id: 'WO-1', fields: { Managed_By: 'Owner' } });
ok(r.body.success === true && REPORTS.some(x => x.where === 'managed_by_owner_notify_failed' && x.sev === 'P0'), 'admin: the owner notification text fails -> P0 reported, the WO update still succeeds');

console.log('\nadminMergeOwner: QuickBooks link carried to the keeper');
reset(); r = await W.adminMergeOwner({}, { from_id: 'O1', to_id: 'O2', apply: true });
ok(r.body.success === true && r.body.qb_moved === true && !r.body.failure_warning && REPORTS.length === 0, 'happy path: qb_moved true, no warning, nothing reported');
reset(); UPDATEROW_FAIL_FOR = (tab) => tab === 'Owners' && false; // plan moves nothing for Owners; fail only the QBO write below
let calls = 0; UPDATEROW_FAIL_FOR = (tab) => tab === 'Owners' && ++calls === 1;
r = await W.adminMergeOwner({}, { from_id: 'O1', to_id: 'O2', apply: true });
ok(r.body.success === true && r.body.qb_moved === false && /QuickBooks link/.test(r.body.failure_warning) && REPORTS.some(x => x.where === 'owner_merge_qb_link_carry_failed' && x.sev === 'P0'), 'QB link write fails: P0 reported, qb_moved no longer claims true, the screen is told to set it by hand', r.body);

console.log('\nadminMergeProperty: duplicate unit-name check');
reset(); r = await W.adminMergeProperty({}, { from_id: 'P1', to_id: 'P2', apply: false });
ok(r.body.label_clashes && r.body.label_clashes.length === 1 && !r.body.label_clash_check_failed && REPORTS.length === 0, 'happy path: clash found and listed, nothing reported');
reset(); FETCH_FAIL_AFTER = 2; // 1st Units read = reference plan, 2nd = the advisory clash check
r = await W.adminMergeProperty({}, { from_id: 'P1', to_id: 'P2', apply: false });
ok(r.body.label_clash_check_failed === true && r.body.label_clashes.length === 0 && /NOT a clean bill/.test(r.body.failure_warning) && REPORTS.some(x => x.where === 'property_merge_label_clash_check' && x.sev === 'P2'), 'clash check cannot read Units: P2 reported and the empty list is flagged as unverified instead of reading "no clashes"', r.body);

console.log(`\ncw4-handlers-silent-failures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
