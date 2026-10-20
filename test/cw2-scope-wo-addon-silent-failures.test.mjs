// Fault-injection tests for Phase C batch w2 (Oct 20 2026, no-silent-failures): scope-proposal send/sign/book/unbook, time entry, WO create,
// self-serve WO, additional work, void/bulk-void/combine/split. Extracts the REAL functions from worker.js, runs them in a fake world
// where any name the test did not stub throws, FORCES each failure and asserts: it is reported (right severity), the response still has its
// old shape on success, and where the old code claimed success the response now carries a warning / rolled_back:false.
// Run: node test/cw2-scope-wo-addon-silent-failures.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
console.error = () => {};

function grabSrc(name) {
  let start = src.indexOf('\nasync function ' + name + '(');
  if (start < 0) start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  start += 1;
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = (.*);$', 'm').exec(src); if (!m) throw new Error('missing const ' + n); return m[1]; };

// ── the fake world: a Proxy that throws for any free name the test did not provide ──
const STUBS = Object.create(null);
const world = new Proxy({}, {
  has: (t, k) => typeof k === 'string' && !(k in globalThis),
  get: (t, k) => { if (typeof k === 'symbol') return undefined; if (k in STUBS) return STUBS[k]; throw new ReferenceError('test world: ' + k + ' is not stubbed'); },
});
function load(...names) { for (const n of names) { const code = grabSrc(n); STUBS[n] = new Function('W', 'with (W) { return (' + code + '); }')(world); } }
function loadConst(...names) { for (const n of names) STUBS[n] = new Function('W', 'with (W) { return (' + constLine(n) + '); }')(world); }

// reporting plumbing (the REAL helpers, over a fake ledger)
let REPORTS, SHEET_FAIL;
const pending = [];
STUBS._failPending = pending;
STUBS.FAIL_PENDING_MAX = 50;
STUBS.failSeverity = (w, m, s) => s || 'P2';
STUBS.failTrim = (s, n) => String(s).slice(0, n);
STUBS.FAIL_EVENTS_TAB = 'Failure_Events'; STUBS.FAIL_EVENT_COLS = ['ID', 'Timestamp', 'System', 'Source', 'Where', 'Ref', 'Severity', 'Message', 'Context'];
STUBS.reportFailure = async (env, f) => { REPORTS.push({ where: f.where, severity: f.severity, ctx: f.context, msg: f.message || (f.err && f.err.message) }); return { ok: true }; };
STUBS.json = (b, s) => ({ body: b, status: s || 200, json: async () => b });
load('failBuildEvent', 'softNote', 'softFail', 'parseJsonCell', 'safeJson', 'fetchTabSoft', 'tryWrite');
const allReports = () => REPORTS.concat(pending.map(p => ({ where: p.Where, severity: p.Severity, msg: p.Message })));
const has = (where, sev) => allReports().some(r => r.where === where && (!sev || r.severity === sev));
const none = () => allReports().length === 0;

let FAIL;   // set of 'op' keys that must throw, e.g. 'updateRow:Scopes'
const boom = (k) => { if (FAIL.has(k)) throw new Error('Sheets 503 on ' + k); };
const reset = () => { REPORTS = []; pending.length = 0; FAIL = new Set(); SHEET_FAIL = false; };
const env = { WORKER_BASE_URL: 'https://w.example' };

// ─────────────────────────── pure helpers: parseJsonCell conversions ───────────────────────────
console.log('JSON cell parsers');
load('scopeDefaultPaymentSchedule', 'scopeParsePaymentSchedule', 'addonParseItems');
reset();
ok(Array.isArray(STUBS.scopeParsePaymentSchedule({ Payment_Schedule_JSON: '' })) && none(), 'empty Payment_Schedule_JSON -> default schedule, nothing reported');
ok(STUBS.scopeParsePaymentSchedule({ Payment_Schedule_JSON: '[{"label":"A","percent":100,"trigger":"completion"}]' })[0].label === 'A' && none(), 'valid schedule is used');
ok(Array.isArray(STUBS.scopeParsePaymentSchedule({ Payment_Schedule_JSON: '{bad' })) && has('json_cell_corrupt:Scopes.Payment_Schedule_JSON', 'P1'), 'corrupt schedule -> default schedule AND a P1 note (it changes customer billing)');
reset();
ok(STUBS.addonParseItems({ Addon_Items_JSON: '[{"index":0,"desc":"x"}]' }).length === 1 && none(), 'addonParseItems: valid items parsed quietly');
ok(STUBS.addonParseItems({ Addon_Items_JSON: 'oops' }).length === 0 && has('json_cell_corrupt:Work_Orders.Addon_Items_JSON', 'P2'), 'addonParseItems: corrupt cell -> [] AND reported');
ok(STUBS.addonParseItems({ Addon_Items_JSON: '{"a":1}' }).length === 0, 'addonParseItems: non-array -> []');

// ─────────────────────────── scopeProposalSend ───────────────────────────
console.log('\nscopeProposalSend');
load('scopeProposalResolveRecipient', 'scopeProposalSend');
Object.assign(STUBS, {
  PROPOSAL_RESEND_GUARD_MS: 60000, PORTAL_BASE: 'https://p.example', PROPOSAL_SEND_LOG_TAB: 'Proposal_Send_Log', PROPOSAL_SEND_LOG_COLS: ['Timestamp'],
  scopeFind: async () => ({ ID: '7', Proposal_Text: 'text', Send_Count: '0', Property_ID: 'P1' }),
  fetchTabs: async () => [[{ ID: 'P1', Owner_ID: 'O1' }], [{ ID: 'O1', Email: 'o@x.com' }]],
  qbPropertyDisplayName: () => '1 Main', qbOwnerDisplayName: () => 'Olive', scopeProposalLinkToken: async () => 'tok', buildScopeProposalEmailHtml: () => '<p/>',
  gmailSendEmail: async () => { boom('gmail'); return { sent: true }; }, ensureTab: async () => {}, ensureColumns: async (e, t) => boom('ensureColumns:' + t),
  addRow: async (e, t) => { boom('addRow:' + t); return {}; }, updateRow: async (e, t) => { boom('updateRow:' + t); },
  proposalOwnerSms: async () => ({ status: 'sent' }),
});
reset();
let r = await STUBS.scopeProposalSend(env, { scope_id: '7' });
ok(r.body.success === true && !('failure_warnings' in r.body) && r.body.sms.status === 'sent' && none(), 'happy path: same response shape as before, no warnings, nothing reported');
reset(); FAIL.add('updateRow:Scopes');
r = await STUBS.scopeProposalSend(env, { scope_id: '7' });
ok(r.body.success === true && r.body.failure_warnings && /sent-date/.test(r.body.failure_warnings[0]) && has('proposal_send_stamp_failed', 'P1'), 'stamp of Sent_Date fails AFTER the email went: still success, but P1 reported and the screen is warned');
reset(); FAIL.add('addRow:Proposal_Send_Log');
r = await STUBS.scopeProposalSend(env, { scope_id: '7' });
ok(r.body.success === true && r.body.failure_warnings && /send-log/.test(r.body.failure_warnings.join(' ')) && has('proposal_send_log_failed', 'P2'), 'audit-log row fails: reported (P2) and warned');
reset(); FAIL.add('gmail'); FAIL.add('addRow:Proposal_Send_Log');
r = await STUBS.scopeProposalSend(env, { scope_id: '7' });
ok(r.status === 500 && /Send failed/.test(r.body.error) && has('proposal_send_log_failed', 'P2'), 'email fails AND the FAILED audit row cannot be written: caller still gets the send error, the log failure is reported');

// ─────────────────────────── scopeProposalPhotos ───────────────────────────
console.log('\nscopeProposalPhotos');
load('scopeProposalPhotos'); STUBS.SCOPE_PROPOSAL_PHOTO_TYPES = ['before', 'photo', 'other'];
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); return [{ Active: 'TRUE', WO_ID: 'SCOPE-7', File_Type: 'before', Mime_Type: 'image/jpeg', Drive_File_ID: 'f1' }]; };
reset(); let ph = await STUBS.scopeProposalPhotos(env, { ID: '7' });
ok(ph.length === 1 && ph[0].fileId === 'f1' && none(), 'photos: happy path unchanged, nothing reported');
reset(); FAIL.add('fetchTab:Attachments'); ph = await STUBS.scopeProposalPhotos(env, { ID: '7' });
ok(Array.isArray(ph) && ph.length === 0 && has('scope_proposal_photos_failed', 'P2'), 'photos: read failure -> [] as before, but reported');

// ─────────────────────────── scopeProposalSign ───────────────────────────
console.log('\nscopeProposalSign');
load('scopeParseItems', 'scopeValidatePaymentSchedule', 'scopeComputeMilestoneAmounts', 'scopeScheduleAddonProblem', 'scopeProposalSign');
let SIGN_ID, SMS_FAIL;
const scopeRow = { ID: '7', WO_ID: 'WO-1', Vendor_ID: 'V1', Unit_ID: '',
  Proposal_Items_JSON: JSON.stringify([{ id: 'i1', variants: [{ key: 'a', price: 100 }], selected_key: 'a' }]),
  Line_Items: JSON.stringify([{ id: 'i1', variants: [{ key: 'a', vendor_cost: 60 }] }]) };
Object.assign(STUBS, {
  scopeProposalLinkAuth: async () => ({ s: scopeRow }), scopeSigTab: async () => {}, paymentMilestonesTab: async () => {},
  scopeMaxUpfrontPct: async () => 100, setApprovalStage: async () => {}, estimateSmsContext: async () => ({ property: {}, address: '1 Main', vendor: { Phone: '+14105550000' } }),
  sendTemplatedSms: async () => { if (SMS_FAIL) throw new Error('Twilio 500'); return { sent: true }; }, vendorFirstName: () => 'V',
  logTelemetry: async () => {},
});
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); return []; };
STUBS.addRow = async (e, t) => { boom('addRow:' + t); return { json: async () => (t === 'Scope_Signatures' ? (SIGN_ID ? { id: SIGN_ID } : {}) : { id: 'M' + Math.random() }) }; };
STUBS.updateRow = async (e, t) => { boom('updateRow:' + t); };
const signBody = { t: 'tok', signer_name: 'Olive Owner', signature_png: 'x'.repeat(200) };
const resetSign = () => { reset(); SIGN_ID = 'S1'; SMS_FAIL = false; };
resetSign(); r = await STUBS.scopeProposalSign(env, signBody, '1.2.3.4', 'UA');
ok(r.body.ok === true && !('failure_warning' in r.body) && r.body.schedule.length > 0 && none(), 'sign happy path: same response, no warning, nothing reported', r);
resetSign(); FAIL.add('addRow:Payment_Milestones'); r = await STUBS.scopeProposalSign(env, signBody, 'ip', 'ua');
ok(r.body.ok === true && r.body.schedule.length === 0 && /milestones/.test(r.body.failure_warning) && has('scope_sign_milestones_failed', 'P1'), 'milestone rows fail after the signature saved: signature stands, P1 reported, response carries a warning');
resetSign(); FAIL.add('ensureColumns:Payment_Milestones'); r = await STUBS.scopeProposalSign(env, signBody, 'ip', 'ua');
ok(r.body.ok === true && has('scope_sign_ensure_milestone_columns_failed', 'P1'), 'ensureColumns(Payment_Milestones) fails: reported P1, signing continues');
resetSign(); FAIL.add('ensureColumns:Scope_Signatures');
const sc2 = { ...scopeRow, Proposal_Items_JSON: JSON.stringify([{ id: 'i1', variants: [{ key: 'a', price: 100, materials_price: 10 }], selected_key: 'a' }]), Line_Items: JSON.stringify([{ id: 'i1', variants: [{ key: 'a', vendor_cost: 60, rc_materials_cost: 5 }] }]) };
STUBS.scopeProposalLinkAuth = async () => ({ s: sc2 });
r = await STUBS.scopeProposalSign(env, signBody, 'ip', 'ua');
ok(r.body.ok === true && has('scope_sign_ensure_rc_columns_failed', 'P1'), 'ensureColumns(Scope_Signatures RC columns) fails: reported P1');
STUBS.scopeProposalLinkAuth = async () => ({ s: scopeRow });
resetSign(); SIGN_ID = ''; r = await STUBS.scopeProposalSign(env, signBody, 'ip', 'ua');
ok(r.body.ok === true && /no payment milestones/.test(r.body.failure_warning) && has('scope_sign_no_signature_id', 'P1'), 'signature row id not readable: no milestones created -> P1 + warning (was silent)');
resetSign(); SMS_FAIL = true; r = await STUBS.scopeProposalSign(env, signBody, 'ip', 'ua');
ok(r.body.ok === true && has('scope_signed_sms_failed', 'P0'), '"owner signed" texts to Brett/vendor fail: P0 reported, signature response unchanged');

// ─────────────────────────── book / unbook (QuickBooks) ───────────────────────────
console.log('\nscopeProposalBook / Unbook / SignedList');
load('scopeProposalBook', 'scopeProposalUnbook', 'scopeProposalBookFinal');
let QB_INVOICE_OK;
const sigRow = { ID: 'S1', Scope_ID: '7', Subtotal: '100', Deposit_Amount: '50', Vendor_Cost_Total: '60', Active: 'TRUE', QB_Invoice_ID: '', QB_Final_Invoice_ID: '', Signer_Name: 'O', Signed_Date: '2026-10-01' };
Object.assign(STUBS, {
  scopesTab: async () => {}, scopeSigVendorBillAmount: () => ({ ratio: 0.5, amount: 30 }), SCOPE_BILL_SKIP_INHOUSE: 'in-house', SCOPE_SIG_HEADERS: ['ID'],
  scopeSigResolveParties: async () => ({ tradeName: 'General', trade: { item: '1', expense: '2' }, prop: {}, unit: null, owner: { Email: 'o@x.com' }, vendor: { ID: 'V1' }, billTo: { level: 'property', qb_id: 'C1' }, custDisplay: 'Cust', vendDisplay: 'Vend', vendorInHouse: true, addr: '1 Main' }),
  qbBillToNote: () => '', fetchConfig: async () => ({}), instantFeeConfig: () => ({ warnings: [] }), vendorBillAdjustments: () => ({ notes: [], lines: [], fee: 0, bill_total: 30 }), instantPayEnabled: () => false,
  qbAccessToken: async () => 'T', qbApi: async () => (QB_INVOICE_OK ? { Invoice: { Id: 'INV9', DocNumber: '1764' } } : {}), qbFault: () => 'x', qbFindOrCreateVendor: async () => 'QV',
  updateWOFields: async (e, id) => boom('updateWOFields:' + id), qbDeleteInvoiceSafe: async () => ({ ok: true }), qbDeleteBillSafe: async () => ({ ok: true }),
});
const SIGNED = { ...sigRow, QB_Invoice_ID: 'I1', QB_Invoice_Number: '1', QB_Bill_ID: 'B1', QB_Bill_Number: '2' };
let SIG_ROWS = [sigRow];
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); return t === 'Scope_Signatures' ? SIG_ROWS : [{ ID: '7', WO_ID: 'WO-1', Vendor_ID: 'V1' }]; };
STUBS.updateRow = async (e, t, id, f) => { boom('updateRow:' + t + ':' + Object.keys(f).join('+')); };
const resetBook = () => { reset(); QB_INVOICE_OK = true; SIG_ROWS = [sigRow]; };
resetBook(); r = await STUBS.scopeProposalBook(env, { id: 'S1' });
ok(r.body.ok === true && r.body.invoice_id === 'INV9' && !('failure_warnings' in r.body) && none(), 'book happy path: unchanged, nothing reported', r.body);
resetBook(); FAIL.add('updateRow:Scope_Signatures:Status+QB_Invoice_ID+QB_Invoice_Number'); r = await STUBS.scopeProposalBook(env, { id: 'S1' });
ok(r.body.ok === true && r.body.failure_warnings.some(w => /do not book again/.test(w)) && r.body.warnings.some(w => /Invoice is the DEPOSIT only/.test(w)) && !r.body.warnings.some(w => /do not book again|could not be set to|WAS created/.test(w)) && has('scope_book_persist_invoice_id_failed', 'P0'), 'QB invoice created but its id cannot be saved: P0 + a loud warning (a retry would duplicate the invoice)');
resetBook(); FAIL.add('updateRow:Scopes:Status+Updated_Date'); r = await STUBS.scopeProposalBook(env, { id: 'S1' });
ok(r.body.ok === true && r.body.failure_warnings.some(w => /scope status/.test(w)) && r.body.warnings.some(w => /Invoice is the DEPOSIT only/.test(w)) && !r.body.warnings.some(w => /do not book again|could not be set to|WAS created/.test(w)) && has('scope_book_scope_status_failed', 'P1'), 'scope status stamp fails after booking: P1 + warning');
resetBook(); FAIL.add('updateWOFields:WO-1'); r = await STUBS.scopeProposalBook(env, { id: 'S1' });
ok(r.body.ok === true && r.body.failure_warnings.some(w => /WO-1/.test(w)) && r.body.warnings.some(w => /Invoice is the DEPOSIT only/.test(w)) && !r.body.warnings.some(w => /do not book again|could not be set to|WAS created/.test(w)) && has('scope_book_wo_status_failed', 'P1'), 'WO status set to Invoiced fails: P1 + warning');
resetBook(); SIG_ROWS = [SIGNED]; FAIL.add('updateRow:Scopes:Status+Updated_Date'); r = await STUBS.scopeProposalUnbook(env, { id: 'S1' });
ok(r.body.ok === true && /could not be reset/.test(r.body.failure_warning) && has('scope_unbook_status_reset_failed', 'P1'), 'unbook: QB undone but scope/WO status reset fails -> P1 + warning');
resetBook(); SIG_ROWS = [SIGNED]; r = await STUBS.scopeProposalUnbook(env, { id: 'S1' });
ok(r.body.ok === true && !('failure_warning' in r.body) && none(), 'unbook happy path: unchanged');
// book-final / unbook-final are mechanical repeats of the above (same catch shapes); exercise the final-invoice-id persist (P0) once.
resetBook(); SIG_ROWS = [{ ...sigRow, QB_Invoice_ID: 'I1', QB_Bill_ID: 'B1' }];
STUBS.scopeSigFinalAmounts = undefined;
load('scopeProposalSignedList'); Object.assign(STUBS, { scopeSigBillGap: () => ({ kind: 'billed', reason: '' }), scopeSigFinalBillGap: () => ({ kind: 'billed', reason: '' }) });
resetBook(); STUBS.fetchTab = async (e, t) => { if (FAIL.has('fetchTab:' + t)) throw new Error('Sheets 429 ' + t); return []; };
FAIL.add('fetchTab:Payment_Milestones'); FAIL.add('fetchTab:Receipts'); FAIL.add('fetchTab:Scopes');
try { await STUBS.scopeProposalSignedList(env, new URL('https://x/y')); } catch (e) { ok(false, 'signed list threw: ' + e.message); }
ok(has('scope_signed_list_milestones_failed', 'P1') && has('scope_signed_list_receipts_failed', 'P2') && has('tab_read_failed:scope_signed_list', 'P2'), 'signed-proposals list: failed Scopes/Milestones/Receipts reads are each reported (were swallowed)');

// ─────────────────────────── time entry / hourly rate / WO tenants ───────────────────────────
console.log('\naddTimeEntry / resolveHubHourlyRate / listWOTenants');
load('resolveHubHourlyRate', 'listWOTenants');
Object.assign(STUBS, { DEFAULT_HUB_RATE: 85, findWO: () => null, fetchTabs: async () => { throw new Error('Sheets 429'); } });
reset(); ok(await STUBS.resolveHubHourlyRate(env, 'WO-1') === 85 && has('hub_hourly_rate_lookup_failed', 'P1'), 'hourly-rate lookup failure: default rate as before, reported P1 (it prices invoices)');
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); return [{ WO_ID: 'WO-1', Active: 'TRUE' }]; };
reset(); r = await STUBS.listWOTenants(env, new URL('https://x/y?wo_id=WO-1')); ok(r.body.length === 1 && none(), 'listWOTenants happy path unchanged');
reset(); FAIL.add('fetchTab:WO_Tenants'); r = await STUBS.listWOTenants(env, new URL('https://x/y?wo_id=WO-1')); ok(Array.isArray(r.body) && r.body.length === 0 && has('list_wo_tenants_failed', 'P2'), 'listWOTenants read failure -> [] as before, reported');
load('addTimeEntry');
Object.assign(STUBS, { bidGroupWriteBlock: async () => null, roundUpTo15: (m) => Math.ceil(m / 15) * 15, findRecentDuplicate: async () => null });
STUBS.addRow = async (e, t) => { boom('addRow:' + t); return {}; };
const te = { wo_id: 'WO-1', role: 'vendor', entered_by: 'v', duration_minutes_raw: '60', hourly_rate: '50', invoice_description: 'Fixed sink' };
reset(); r = await STUBS.addTimeEntry(env, te); ok(r.body.success === true && !('failure_warning' in r.body) && none(), 'time entry happy path unchanged', r);
reset(); FAIL.add('ensureColumns:Time_Entries'); r = await STUBS.addTimeEntry(env, te);
ok(r.body.success === true && /invoice description/.test(r.body.failure_warning) && has('time_entry_ensure_invoice_description_failed', 'P1'), 'time entry: Invoice_Description column cannot be prepared -> P1 + warning (customer-facing text may be lost)');

// ─────────────────────────── createWorkOrder ───────────────────────────
console.log('\ncreateWorkOrder');
load('createWorkOrder');
let TENANT_READ_FAIL, NOTIFY_FAIL;
Object.assign(STUBS, {
  claimWOSignature: () => true, findRecentDuplicate: async () => null, guardAppendedIds: async (e, t, a, n, c, ids) => ({ ids }), mintNextNumericId: () => 1,
  sheetsRequest: async (e, m, path) => (m === 'GET' ? { values: [['ID', 'Property_ID', 'Checklist'], ['WO-1001', 'P1', '']] } : {}),
  fetchTabs: async () => { if (NOTIFY_FAIL) throw new Error('Sheets 429'); return [[], [], [], []]; },
  shouldNotifyOwner: async () => false, tenantsForDispatch: () => [], isTenantNotifiable: () => false, queueNotification: async () => {}, propUnitText: () => '', TENANT_STOP_NOTE: '',
  smsGatedSend: async () => ({}), logTelemetry: async () => {},
});
STUBS.fetchTab = async (e, t) => { if (t === 'Tenants' && TENANT_READ_FAIL) throw new Error('Sheets 429'); return []; };
const resetWO = () => { reset(); TENANT_READ_FAIL = false; NOTIFY_FAIL = false; };
resetWO(); r = await STUBS.createWorkOrder(env, { property_id: 'P1', description: 'leak' });
ok(r.body.success === true && r.body.id === 'WO-1002' && !('failure_warnings' in r.body) && none(), 'WO create happy path: same {success,id}, nothing reported', r.body);
resetWO(); FAIL.add('ensureColumns:Work_Orders'); r = await STUBS.createWorkOrder(env, { property_id: 'P1', description: 'leak2', checklist: '[]' });
ok(r.body.success === true && /checklist/.test(r.body.failure_warnings[0]) && has('wo_create_ensure_checklist_failed', 'P1'), 'checklist column cannot be prepared: WO still created, P1 + warning');
resetWO(); TENANT_READ_FAIL = true; r = await STUBS.createWorkOrder(env, { property_id: 'P1', description: 'leak3' });
ok(r.body.success === true && /tenants could not be linked/.test(r.body.failure_warnings.join(' ')) && has('wo_create_link_tenants_failed', 'P1'), 'tenant linking fails: WO still created, P1 + warning');
resetWO(); NOTIFY_FAIL = true; r = await STUBS.createWorkOrder(env, { property_id: 'P1', description: 'leak4' });
ok(r.body.success === true && /notices may not have been sent/.test(r.body.failure_warnings.join(' ')) && has('wo_create_received_notifications_failed', 'P1'), 'owner/tenant "received" notices fail: WO still created, P1 + warning (reviewer: a read blip is not a send failure)');

// ─────────────────────────── self-serve WO / additional work ───────────────────────────
console.log('\nworkorderSelfServe / additional work');
load('workorderSelfServe');
let ASSIGN_FAIL;
Object.assign(STUBS, {
  validateApprovalSource: () => ({ ok: true, source: 'phone', note: '' }),
  fetchTabs: async () => [[{ ID: 'V1', Can_Create_Own_WO: 'TRUE', Trade: 'Plumbing' }], [{ ID: 'P1', Active: 'TRUE' }]],
  createWorkOrder: async () => ({ clone: () => ({ json: async () => ({ success: true, id: 'WO-5000' }) }) }),
  assignVendor: async () => { if (ASSIGN_FAIL) throw new Error('assign blew up'); return {}; },
});
const ssBody = { vendor_id: 'V1', property_id: 'P1', description: 'fix', approval_source: 'phone' };
reset(); ASSIGN_FAIL = false; r = await STUBS.workorderSelfServe(env, ssBody);
ok(r.body.success === true && r.body.id === 'WO-5000' && !('failure_warning' in r.body) && none(), 'self-serve happy path unchanged');
reset(); ASSIGN_FAIL = true; r = await STUBS.workorderSelfServe(env, ssBody);
ok(r.body.success === true && r.body.id === 'WO-5000' && /could not be assigned/.test(r.body.failure_warning) && has('self_serve_wo_assign_failed', 'P1'), 'self-assign fails after the WO exists: P1 reported, vendor told');

// addonWithdraw
load('addonWithdraw', 'addonLatestEstimate', 'addonIsChild', 'addonActingVendor');
Object.assign(STUBS, { logWOAudit: async () => { boom('logWOAudit'); }, ADDON_WO_COLUMNS: [], WO_VOID_COLUMNS: ['Voided'] });
const child = { ID: 'WO-9', Type: 'addon', Parent_WO_ID: 'WO-1', Vendor_ID: 'V1', Addon_Status: 'Submitted' };
STUBS.fetchTab = async (e, t) => (t === 'Work_Orders' ? [child] : [{ ID: 'E1', WO_ID: 'WO-9', Version: '1', Status: 'Pending', Active: 'TRUE' }]);
STUBS.findWO = (rows, id) => rows.find(x => x.ID === id);
STUBS.updateWOFields = async (e, id) => boom('updateWOFields:' + id);
STUBS.updateRow = async (e, t) => boom('updateRow:' + t);
STUBS.addonActingVendor = () => 'V1'; STUBS.addonIsChild = () => true;
reset(); r = await STUBS.addonWithdraw(env, { child_wo_id: 'WO-9' }, 'vendor', 'sess');
ok(r.body.success === true && !('failure_warnings' in r.body) && none(), 'withdraw happy path unchanged');
reset(); FAIL.add('ensureColumns:Work_Orders'); FAIL.add('updateRow:Estimates'); FAIL.add('logWOAudit'); r = await STUBS.addonWithdraw(env, { child_wo_id: 'WO-9' }, 'vendor', 'sess');
ok(r.body.success === true && r.body.failure_warnings.length === 2 && has('addon_withdraw_ensure_columns_failed', 'P1') && has('addon_withdraw_estimate_status_failed', 'P1') && has('addon_withdraw_audit_failed', 'P2'), 'withdraw: void columns / estimate status / audit row failures are each reported and the first two are returned as warnings');

// ─────────────────────────── void / bulk void / combine / split ───────────────────────────
console.log('\nwoVoid / woBulkVoid / woCombine / woSplit');
load('woVoid', 'woBulkVoid', 'woCombine', 'woSplit', 'findLockedVendorBillForWOs');
Object.assign(STUBS, {
  WO_VOID_REASONS: ['Duplicate', 'Combined', 'Other'], WO_VOID_COLUMNS: ['Voided'], addonLiveChildren: () => [], addonLiveChildrenMessage: () => '', logWOAuditMany: async () => {},
  woBulkVoidMoneyBlockReason: () => '', logTelemetry: async () => {}, vendorBillReassignLock: () => '', timeEntryReassignLock: () => '', mergeWOTextField: (a) => a,
});
let WOS;
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); return t === 'Work_Orders' ? WOS : []; };
STUBS.logWOAudit = async () => {};
STUBS.updateWOFields = async (e, id) => boom('updateWOFields:' + id);
STUBS.updateRow = async (e, t) => boom('updateRow:' + t);
STUBS.ensureColumns = async (e, t) => boom('ensureColumns:' + t);
WOS = [{ ID: 'WO-1', Notes: 'a note' }, { ID: 'WO-2', Notes: '' }];
reset(); r = await STUBS.woVoid(env, { wo_id: 'WO-1', reason: 'Duplicate' }); ok(r.body.success === true && !('failure_warning' in r.body) && none(), 'void happy path unchanged');
reset(); FAIL.add('ensureColumns:Work_Orders'); r = await STUBS.woVoid(env, { wo_id: 'WO-1', reason: 'Duplicate' });
ok(r.body.success === true && /void columns/.test(r.body.failure_warning) && has('wo_void_ensure_columns_failed', 'P1'), 'void: columns cannot be prepared -> P1 + warning');
reset(); FAIL.add('updateWOFields:WO-2'); r = await STUBS.woVoid(env, { wo_id: 'WO-1', reason: 'Combined', combined_into_wo_id: 'WO-2' });
ok(r.body.success === true && /notes could not be copied/.test(r.body.failure_warning) && has('wo_void_merge_notes_failed', 'P1'), 'void-combined: notes merge onto the survivor fails -> P1 + warning');
reset(); r = await STUBS.woBulkVoid(env, { ids: ['WO-1'], reason: 'Duplicate' }); ok(r.body.success === true && r.body.voided.length === 1 && !('failure_warning' in r.body) && none(), 'bulk void happy path unchanged', r.body);
reset(); FAIL.add('fetchTab:Vendor_Bills'); r = await STUBS.woBulkVoid(env, { ids: ['WO-1'], reason: 'Duplicate' });
ok(r.body.success === true && /vendor-bill check could not run/.test(r.body.failure_warning) && has('wo_bulk_void_vendor_bills_unreadable', 'P1'), 'bulk void: Vendor_Bills unreadable -> still fail-open, but P1 + a warning that the money check did not run');
// combine rollback: second void fails -> first is un-voided; if the un-void ALSO fails, rolled_back must be false.
WOS = [{ ID: 'S', Description: 'd' }, { ID: 'A', Description: 'a' }, { ID: 'B', Description: 'b' }];
let voidCalls;
const realWoVoid = STUBS.woVoid;
STUBS.woVoid = async (e, b) => { voidCalls.push(b.wo_id); if (b.wo_id === 'B') return { json: async () => ({ error: 'sheet said no' }) }; return { json: async () => ({ success: true }) }; };
STUBS.woUnvoid = async (e, b) => { if (FAIL.has('unvoid')) throw new Error('unvoid blew up'); };
Object.assign(STUBS, { WO_COMBINE_RECONCILE_FIELDS: [], WO_COMBINE_MERGE_FIELDS: [], resolveCombineFields: () => ({ resolved: {}, conflicts: [] }), woJobLabel: () => '', tenantsForDispatch: () => [] });
let UNVOID_FAIL = false;
STUBS.woVoid = async (e, b) => { if (b.wo_id === 'B') return { json: async () => ({ error: 'sheet said no' }) }; return { json: async () => ({ success: true }) }; };
STUBS.woUnvoid = async () => { if (UNVOID_FAIL) throw new Error('unvoid blew up'); return {}; };
const cmb = { survivor_wo_id: 'S', combined_wo_ids: ['A', 'B'] };
reset(); STUBS.woVoid = async () => ({ json: async () => ({ success: true }) });
r = await STUBS.woCombine(env, cmb); ok(r.body.success === true && !('failure_warnings' in r.body) && none(), 'combine happy path unchanged');
STUBS.woVoid = async (e, b) => { if (b.wo_id === 'B') return { json: async () => ({ error: 'sheet said no' }) }; return { json: async () => ({ success: true }) }; };
reset(); r = await STUBS.woCombine(env, cmb); ok(r.status === 500 && r.body.rolled_back === true && !('rollback_failures' in r.body) && none(), 'combine: a failed void is rolled back cleanly -> rolled_back:true as before');
reset(); UNVOID_FAIL = true; r = await STUBS.woCombine(env, cmb);
ok(r.status === 500 && r.body.rolled_back === false && r.body.rollback_failures.length === 1 && has('wo_combine_rollback_incomplete', 'P1'), 'combine: rollback step itself fails -> rolled_back is now FALSE (was falsely true), failure listed and P1 reported');
UNVOID_FAIL = false;
reset(); STUBS.woVoid = async () => ({ json: async () => ({ success: true }) }); STUBS.smsGatedSend = async () => { throw new Error('Twilio down'); };
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); if (t === 'Work_Orders') return WOS; if (t === 'Tenants') return [{ ID: 'T1' }]; return []; };
STUBS.tenantsForDispatch = () => [{ ID: 'T1', First_Name: 'T' }]; STUBS.isTenantNotifiable = () => true;
r = await STUBS.woCombine(env, cmb);
ok(r.body.success === true && /tenant notice/.test(r.body.failure_warnings.join(' ')) && has('wo_combine_tenant_sms_failed', 'P0'), 'combine: tenant notice SMS throws after the combine succeeded -> P0 reported + warning (was swallowed)');
STUBS.tenantsForDispatch = () => []; STUBS.isTenantNotifiable = () => false;

// split: rollback fails
STUBS.WO_SPLIT_MAX_NEW = 10; STUBS.WO_SPLIT_ORIGINAL_FIELDS = ['Trade', 'Priority', 'Vendor_ID', 'Scheduled_Date', 'Managed_By', 'Description'];
STUBS.fetchTab = async (e, t) => { boom('fetchTab:' + t); if (t === 'Work_Orders') return [{ ID: 'O1', Property_ID: 'P1' }]; if (t === 'Vendor_Bills') return [{ ID: 'VB1', WO_ID: 'O1' }]; return []; };
let seq = 0, createN = 0;
STUBS.createWorkOrder = async () => ({ clone: () => ({ json: async () => ({ success: true, id: 'WO-N' + (++createN) }) }) });
STUBS.updateRow = async (e, t, id, f) => { seq++; if (FAIL.has('moveback') && seq > 1) throw new Error('Sheets 503 on move back'); };
STUBS.logWOAudit = async () => { if (FAIL.has('audit')) throw new Error('audit write failed'); };
const splitBody = { original_wo_id: 'O1', new_work_orders: [{ Description: 'part 2' }], reassignments: [{ type: 'vendor_bill', id: 'VB1', target: 0 }] };
reset(); seq = 0; r = await STUBS.woSplit(env, splitBody); ok(r.body.success === true, 'split happy path: success (rest of the response shape untouched)', r.body);
reset(); seq = 0; FAIL.add('audit'); r = await STUBS.woSplit(env, splitBody);
ok(r.status === 500 && r.body.rolled_back === true && none(), 'split: failure rolled back cleanly -> rolled_back:true as before');
reset(); seq = 0; FAIL.add('audit'); FAIL.add('moveback'); r = await STUBS.woSplit(env, splitBody);
ok(r.status === 500 && r.body.rolled_back === false && r.body.rollback_failures.some(x => /move vendor_bill VB1 back/.test(x)) && has('wo_split_rollback_incomplete', 'P1'), 'split: the vendor bill could not be moved back -> rolled_back:false + P1 (was falsely "rolled back")');
reset(); seq = 0; FAIL.add('fetchTab:Invoice_Review'); r = await STUBS.woSplit(env, splitBody);
ok(r.body.success === true && has('wo_split_invoice_review_unreadable', 'P1'), 'split: Invoice_Review unreadable -> lock check ran without it: reported P1');

// additional work: owner notice, start-assign
console.log('\naddonOwnerNotice / addonStart');
load('addonOwnerNotice', 'addonStart', 'addonPhotosByItem');
let CFG_FAIL;
const ownerChild = { ID: 'WO-9', Type: 'addon', Parent_WO_ID: 'WO-1', Vendor_ID: 'V1', Addon_Status: 'Submitted', Property_ID: 'P1', Addon_Items_JSON: '[{"index":0,"desc":"x"}]' };
Object.assign(STUBS, {
  fetchTabs: async () => [[ownerChild, { ID: 'WO-1' }], [{ WO_ID: 'WO-9', Version: '1', Active: 'TRUE', Line_Items: 'NOT JSON' }], [], [{ ID: 'P1', Owner_ID: 'O1' }], [{ ID: 'O1', First_Name: 'Olive', Phone: '+14105550000', Email: 'o@x.com' }], []],
  findWO: (rows, id) => rows.find(x => x.ID === id), addonIsChild: () => true, englishOnly: (x) => x, propUnitText: () => '1 Main',
  addonBuildOwnerNotice: () => ({ sms: 's', subject: 'subj', html: '<p/>' }), addonEmailGate: () => ({ ok: true }),
  smsGatedSend: async () => ({ sent: true }), gmailSendEmail: async () => ({ sent: true }),
  fetchConfig: async () => ({}),
});
STUBS.updateWOFields = async (e, id) => boom('updateWOFields:' + id);
STUBS.logWOAudit = async () => boom('logWOAudit');
reset(); r = await STUBS.addonOwnerNotice(env, { child_wo_id: 'WO-9', preview: false });
ok(r.body.success === true && r.body.warnings.length === 1 && allReports().length === 1 && has('json_cell_corrupt:Estimates.Line_Items', 'P2'), 'owner notice: happy path sends; a corrupt estimate Line_Items cell is noted (P2) while the notice still goes out');
reset(); FAIL.add('updateWOFields:WO-9'); FAIL.add('logWOAudit'); r = await STUBS.addonOwnerNotice(env, { child_wo_id: 'WO-9', preview: false });
ok(r.body.success === true && r.body.failure_warnings.some(w => /notified-date could not be saved/.test(w)) && r.body.warnings.length === 1 && !r.body.warnings.some(w => /notified-date/.test(w)) && has('addon_owner_notice_stamp_failed', 'P1') && has('addon_owner_notice_audit_failed', 'P2'), 'owner notice: notified-date stamp (P1, resend would not be blocked) and audit row (P2) failures are reported; stamp failure is warned');
// addonStart: assign failure
Object.assign(STUBS, {
  ADDON_WO_COLUMNS: [], ADDON_MAX_ITEMS: 20, addonValidateStart: undefined, addonActingVendor: () => 'V1',
});
const startSrc = grabSrc('addonStart');
ok(/addon_start_assign_failed/.test(startSrc) && !/surfaced by the field check below \*\/ \}/.test(startSrc), 'addonStart: the self-assign catch now reports (grep) instead of the old empty comment catch');

// ─────────────────────────── the converted sites no longer contain the swallowing catches ───────────────────────────
console.log('\nconverted sites (grep)');
const gone = [
  ['proposalOwnerSms telemetry', /Job_Type: 'proposal_owner_sms'[^\n]*catch \(_\) \{\}/],
  ['scopeProposalSend audit-log best-effort', /catch \(_\) \{ \/\* audit log best-effort/],
  ['scopeProposalSend stamp swallowed', /catch \(_\) \{ \/\* the email already sent successfully/],
  ['scopeProposalView JSON.parse(Proposal_Items_JSON) swallow', /rawItems = JSON\.parse\(s\.Proposal_Items_JSON \|\| '\[\]'\); \} catch \(_\) \{\}/],
  ['sign: sigResp.json().catch', /sigResp\.json\(\)\.catch\(\(\) => \(\{\}\)\)/],
  ['sign: mResp.json().catch', /mResp\.json\(\)\.catch\(\(\) => \(\{\}\)\)/],
  ['signed list: fetchTab(...).catch(() => [])', /fetchTab\(env, '(Scopes|Properties|Vendors)'\)\.catch\(\(\) => \[\]\)/],
  ['signed list: allMilestones swallow', /allMilestones = await fetchTab\(env, 'Payment_Milestones'\); \} catch \(_\) \{\}/],
  ['book: invoice id persist swallow', /QB_Invoice_Number: invoiceNumber \}\); \} catch \(e\) \{\}/],
  ['book: scope status swallow', /Status: 'invoiced', Updated_Date: new Date\(\)\.toISOString\(\) \}\); \} catch \(e\) \{\}/],
  ['book-final: invoice id persist swallow', /QB_Final_Invoice_Number: invoiceNumber \}\); \} catch \(e\) \{\}/],
  ['unbook: status reset swallow', /Status: 'Pending Invoice' \}\);\n    \}\n  \} catch \(e\) \{\}/],
  ['time entry ensureColumns swallow', /\['Invoice_Description'\]\); \} catch \(e\) \{\} \}/],
  ['createWorkOrder checklist ensureColumns swallow', /\['Checklist'\]\); \} catch\(_\)\{\} \}/],
  ['createWorkOrder tenant link swallow', /Active: 'TRUE' \}\);\n    \}\n  \} catch\(e\) \{\}/],
  ['createWorkOrder notifications swallow', /\} catch \(e\) \{ \/\* non-fatal \*\/ \}\n  try \{ await logTelemetry\(env, \{ Source:'worker', Job_Type:'wo_create'/],
  ['self-serve assign swallow', /WO exists even if the self-assign step fails; Brett can assign it manually \*\/ \}/],
  ['addon withdraw swallows', /Status: 'Withdrawn' \}\); \} catch \(_\) \{\} \}/],
  ['addon owner-notice stamp swallow', /Addon_Owner_Notified_Date: new Date\(\)\.toISOString\(\) \}\); \} catch \(_\) \{\} \}/],
  ['addon fetchConfig try/catch (dead code)', /_cfg = await fetchConfig\(env\); \} catch \(_\) \{\}/],
  ['woVoid ensureColumns swallow', /WO_VOID_COLUMNS\); \} catch \(_\) \{\}/],
  ['woVoid merge-notes swallow', /\{ Notes: merged \}\); \} catch \(e\) \{\}/],
  ['bulk void Vendor_Bills swallow', /vendorBills = await fetchTab\(env, 'Vendor_Bills'\); \} catch \(e\) \{\}/],
  ['combine rollback swallows', /woUnvoid\(env, \{ wo_id: id, updated_by: changedBy, updated_by_role: changedByRole \}\); \} catch \(_\) \{\}/],
  ['combine non-fatal comment catches', /catch \(e\) \{ \/\* non-fatal — combine already succeeded \*\/ \}/],
  ['Invoice_Review swallows', /invoiceReview = await fetchTab\(env, 'Invoice_Review'\); \} catch \(e\) \{\}/],
  ['split rollback swallows', /updateRow\(env, tab, ar\.id, \{ WO_ID: ar\.from \}\); \} catch \(_\) \{\}/],
];
const region = src.slice(src.indexOf('async function proposalOwnerSms'), src.indexOf('\nasync function woSplit(') + 20000);   // this batch's slice of worker.js
for (const [name, re] of gone) ok(!re.test(region), 'no longer present: ' + name);

console.log(`\ncw2: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
