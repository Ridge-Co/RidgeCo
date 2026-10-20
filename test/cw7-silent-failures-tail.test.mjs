// Fault-injection tests for Phase C batch w7 (Oct 20 2026): the tail of worker.js (QB send-invoice, deliveries, trash service, inspection booking alerts, proposals e-sign, field inspection).
// Extracts the REAL functions + the REAL softNote/softFail/tryWrite/fetchTabSoft/safeJson helpers from worker.js, FORCES each failure, and asserts it is reported with the right severity,
// that the caller still gets what it got before (or now sees the failure where success was falsely claimed), and that the happy path reports nothing.
// Run: node test/cw7-silent-failures-tail.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanSource } from '../scripts/silent-failure-lint.mjs';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function grab(name) {
  let start = src.indexOf('async function ' + name + '('); if (start < 0) start = src.indexOf('\nfunction ' + name + '(') + 1;
  if (start <= 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = .*;$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };
console.error = () => {}; console.log = ((o) => (...a) => { if (typeof a[0] === 'string' && /^(  [✓✗]|\n?[a-zA-Z])/.test(a[0])) o(...a); })(console.log);

// ── fake world ──
let REPORTS, APPENDS, TAB_FAIL, TABS, CALLS, X;
const sheetsRequest = async (env, method, path, body) => { APPENDS.push({ path, body }); return {}; };
const reportFailure = async (env, f) => { REPORTS.push({ where: f.where, severity: f.severity, message: f.message || (f.err && f.err.message) }); return { ok: true, id: 'x' }; };
const fetchTab = async (env, tab) => { if (TAB_FAIL && TAB_FAIL.has(tab)) throw new Error('Sheets read failed for ' + tab); return TABS[tab] || []; };
const failSeverity = (where, message, sev) => sev || 'P2';
const failTrim = (s, n) => String(s).slice(0, n);
const json = (b, s) => ({ body: b, status: s || 200, async json() { return b; } });
const helpers = [constLine('FAIL_EVENTS_TAB'), constLine('FAIL_EVENT_COLS'), constLine('FAIL_PENDING_MAX'), 'const _failPending = [];', grab('failBuildEvent'), grab('softNote'), grab('softFail'), grab('parseJsonCell'), grab('fetchTabSoft'), grab('safeJson'), grab('tryWrite')].join('\n');
// every site is built in the same fake world; `extra` is the stub bag (name -> value) for the function under test
function build(pieces, extra, exportNames) {
  const stubs = Object.assign({ sheetsRequest, reportFailure, fetchTab, failEnsureTabs: async () => {}, failSeverity, failTrim, json }, extra);
  const names = Object.keys(stubs);
  return new Function(...names, helpers + '\n' + pieces.join('\n') + '\nreturn { pending: _failPending, ' + exportNames.join(', ') + ' };')(...names.map(n => stubs[n]));
}
const reset = () => { REPORTS = []; APPENDS = []; TAB_FAIL = null; TABS = {}; CALLS = []; X.pending.length = 0; };
const events = () => REPORTS.map(r => ({ where: r.where, severity: r.severity })).concat(X.pending.map(p => ({ where: p.Where, severity: p.Severity })));
const has = (where, sev) => events().some(e => e.where === where && (!sev || e.severity === sev));
const none = () => events().length === 0;
const env = {};

// ═════════ trash service ═════════
console.log('trash service');
X = build([constLine('TRASH_DOW'), grab('trashWeekKey'), grab('trashPastDeadline'), grab('trashIsSkipped'), grab('trashReadTab'), grab('trashUnbilled'), grab('trashWeek'), grab('trashListProperties')], {}, ['trashUnbilled', 'trashWeek', 'trashListProperties', 'trashReadTab']);
reset(); TABS = { Trash_Properties: [{ ID: 'p1', Label: 'Bldg 1', Visits_Per_Week: '2', Nudge_Day: 'Thu' }], Trash_Visits: [], Trash_Skips: [] };
let r = await X.trashUnbilled(env, null);
ok(none() && !('load_errors' in r.body) && r.body.items.length >= 1, 'trashUnbilled happy path: items found, nothing reported, no load_errors field');
reset(); TAB_FAIL = new Set(['Trash_Visits']); TABS = { Trash_Properties: [{ ID: 'p1', Label: 'Bldg 1' }] };
r = await X.trashUnbilled(env, null);
ok(has('tab_read_failed:trash_unbilled', 'P1') && r.status === 200 && Array.isArray(r.body.items) && r.body.load_errors.length === 1 && /Trash_Visits/.test(r.body.load_errors[0]), 'trashUnbilled: a failed visits read is reported P1 (it feeds the push nudge) AND named in load_errors, response shape unchanged otherwise');
reset(); TAB_FAIL = new Set(['Trash_Skips']); TABS = { Trash_Properties: [{ ID: 'p1', Label: 'B' }] };
r = await X.trashWeek(env, null);
ok(has('tab_read_failed:trash_week', 'P2') && r.body.load_errors.length === 1 && Array.isArray(r.body.properties), 'trashWeek: a failed read is reported (P2) and shown via load_errors');
reset(); TABS = { Trash_Properties: [{ ID: 'p1', Label: 'B' }] }; r = await X.trashWeek(env, null);
ok(none() && !('load_errors' in r.body), 'trashWeek happy path: nothing reported');
reset(); TAB_FAIL = new Set(['Trash_Properties']); r = await X.trashListProperties(env);
ok(has('tab_read_failed:trash_list_properties', 'P2') && Array.isArray(r.body) && r.body.length === 0, 'trashListProperties: still returns [] (array shape kept) but the read failure is reported');

// trashDefaultItem
let CFG, CFG_FAIL, QB_FAIL, SET_FAIL, QB_ITEM;
const tdi = build([grab('trashDefaultItem')], { fetchConfig: async () => { if (CFG_FAIL) throw new Error('cfg down'); return CFG; }, qbApi: async () => { if (QB_FAIL) throw new Error('QB 401'); return QB_ITEM; }, qbDupId: () => null, setConfigKey: async () => { if (SET_FAIL) throw new Error('Sheets 503'); return { status: 200 }; }, qbEscape: s => s }, ['trashDefaultItem']);
X = tdi;
const q0 = () => { CFG = {}; CFG_FAIL = false; QB_FAIL = false; SET_FAIL = false; QB_ITEM = { QueryResponse: { Item: [{ Id: '77', Name: 'Trash Service' }] } }; };
reset(); q0(); CFG = { trash_qb_item_id: '55' }; let it = await tdi.trashDefaultItem(env, 't');
ok(it.id === '55' && none(), 'trashDefaultItem happy path (cached id): returned, nothing reported');
reset(); q0(); it = await tdi.trashDefaultItem(env, 't');
ok(it.id === '77' && none(), 'trashDefaultItem happy path (found in QB): returned, nothing reported');
reset(); q0(); SET_FAIL = true; it = await tdi.trashDefaultItem(env, 't');
ok(it.id === '77' && has('trash_default_item_cache', 'P2'), 'trashDefaultItem: could not cache the item id -> still returns the item, reported P2');
reset(); q0(); QB_FAIL = true; it = await tdi.trashDefaultItem(env, 't');
ok(it.id === '40' && it.name === 'General' && has('trash_default_item_qb_lookup', 'P0'), 'trashDefaultItem: QuickBooks lookup fails -> same General fallback as before, but reported P0 (invoice would bill the wrong item)');
reset(); q0(); CFG_FAIL = true; it = await tdi.trashDefaultItem(env, 't');
ok(it.id === '77' && has('trash_default_item_config_read', 'P1'), 'trashDefaultItem: config read throws -> reported P1, continues to QuickBooks');

// ═════════ proposal e-sign ═════════
console.log('\nproposal e-sign');
X = build([grab('proposalRegistry')], {}, ['proposalRegistry']);
reset(); ok(JSON.stringify(X.proposalRegistry({})) === '{}' && none(), 'proposalRegistry: PROPOSAL_CONFIG unset -> {} quietly (the feature is dormant)');
ok(X.proposalRegistry({ PROPOSAL_CONFIG: '{"A":{"wo":"WO-1"}}' }).A.wo === 'WO-1' && none(), 'proposalRegistry: valid config parsed, nothing reported');
ok(JSON.stringify(X.proposalRegistry({ PROPOSAL_CONFIG: '{oops' })) === '{}' && has('proposal_config_unreadable', 'P1'), 'proposalRegistry: corrupt secret -> {} as before, but reported P1');

let WO_FAIL, ROW_FAIL, UPD, WOUPD, INV_FAIL, QBCALLS;
const regEnv = { PROPOSAL_CONFIG: JSON.stringify({ 'RC-1': { wo: 'WO-9', property: '1 Main St', vendorId: 'V1', trade: 'Roofing', options: { A: { label: 'Opt A' } } } }) };
const sig = () => ({ ID: 's1', Proposal_ID: 'RC-1', Option: 'A', First_Payment: '1000', Vendor_Cost: '700', Owner_Total: '3000', Signer_Name: 'Pat', Signed_Date: '2026-10-01', Active: 'TRUE', QB_Invoice_ID: 'I1', QB_Bill_ID: 'B1' });
const pu = build([grab('proposalRegistry'), grab('proposalUnbook')], { ensureProposalTab: async () => {}, qbAccessToken: async () => 'tok', qbDeleteInvoiceSafe: async () => ({ ok: true }), qbDeleteBillSafe: async () => ({ ok: true }), updateRow: async () => ({}), updateWOFields: async (e, wo, f) => { if (WO_FAIL) throw new Error('Sheets 500'); } }, ['proposalUnbook']);
X = pu;
reset(); WO_FAIL = false; TABS = { Proposal_Signatures: [sig()] }; r = await pu.proposalUnbook(regEnv, { id: 's1' });
ok(r.body.ok === true && !('failure_warning' in r.body) && none(), 'proposalUnbook happy path: ok, no warning, nothing reported');
reset(); WO_FAIL = true; TABS = { Proposal_Signatures: [sig()] }; r = await pu.proposalUnbook(regEnv, { id: 's1' });
ok(r.body.ok === true && r.body.undone_invoice === 'I1' && /WO-9/.test(r.body.failure_warning) && has('proposal_unbook_wo_status', 'P1'), 'proposalUnbook: WO status write fails -> still ok:true as before, but a warning is returned AND it is reported P1');

const pb = build([grab('proposalRegistry'), grab('proposalBook')], {
  ensureProposalTab: async () => {}, fetchTabs: async (e, tabs) => tabs.map(t => TABS[t] || []), findWO: () => ({ Property_ID: 'p1' }), QB_TRADE_MAP: { Roofing: { item: '1', expense: '2' }, General: { item: '1', expense: '2' } },
  qbResolveBillTo: () => ({ level: 'owner', qb_id: '', display: 'Owner Co' }), qbOwnerDisplayName: () => 'Owner Co', qbBillToNote: () => '', qbAccessToken: async () => 'tok', qbFindOrCreateCustomer: async () => 'C1',
  qbApi: async (e, path) => { if (/invoice/.test(path)) return { Invoice: { Id: 'I9', DocNumber: '1001' } }; return { Bill: { Id: 'B9', DocNumber: '2001' } }; }, qbFindOrCreateVendor: async () => 'V9',
  updateRow: async (e, tab, id, f) => { if (UPD && UPD(f)) throw new Error('Sheets 503 on write'); return {}; }, updateWOFields: async () => { if (WO_FAIL) throw new Error('Sheets 500'); },
}, ['proposalBook']);
X = pb;
const bookTabs = () => ({ Proposal_Signatures: [Object.assign(sig(), { QB_Invoice_ID: '', QB_Bill_ID: '' })], Properties: [{ ID: 'p1', Address: '1 Main St', Owner_ID: 'o1' }], Owners: [{ ID: 'o1', Billing_Email: 'o@x.com' }], Vendors: [{ ID: 'V1', Company: 'Roof Co' }], Work_Orders: [] });
reset(); WO_FAIL = false; UPD = null; TABS = bookTabs(); r = await pb.proposalBook(regEnv, { id: 's1' });
ok(r.body.ok === true && r.body.invoice_id === 'I9' && r.body.bill_id === 'B9' && r.body.failure_warnings === undefined && r.body.warnings.some(w => /Invoice is the FIRST payment only/.test(w)) && !r.body.warnings.some(w => /could not be marked|saving its id/.test(w)) && none(), 'proposalBook happy path: invoice + bill created, no failure warnings, nothing reported');
reset(); WO_FAIL = false; UPD = f => f.Status === 'Booked' && f.QB_Invoice_ID && !('QB_Bill_ID' in f); TABS = bookTabs(); r = await pb.proposalBook(regEnv, { id: 's1' });
ok(r.body.ok === true && r.body.invoice_id === 'I9' && r.body.failure_warnings.some(w => /saving its id on the proposal failed/.test(w)) && r.body.warnings.some(w => /Invoice is the FIRST payment only/.test(w)) && !r.body.warnings.some(w => /could not be marked|saving its id/.test(w)) && has('proposal_book_persist_invoice', 'P0'), 'proposalBook: the invoice-id checkpoint write fails -> reported P0 and the response warns (duplicate-invoice risk), booking continues as before');
reset(); WO_FAIL = true; UPD = null; TABS = bookTabs(); r = await pb.proposalBook(regEnv, { id: 's1' });
ok(r.body.ok === true && r.body.failure_warnings.some(w => /WO-9 could not be marked Invoiced/.test(w)) && r.body.warnings.some(w => /Invoice is the FIRST payment only/.test(w)) && !r.body.warnings.some(w => /could not be marked|saving its id/.test(w)) && has('proposal_book_wo_status', 'P1'), 'proposalBook: WO status write fails -> still ok:true, warning returned, reported P1');

// ═════════ deliveries ═════════
console.log('\ndeliveries');
let WO_BODY;
const dl = build([grab('deliveriesList'), grab('deliveryAdd'), grab('deliveryRelay')], { ensureDeliveryTab: async () => {}, createWorkOrder: async () => ({ async json() { if (WO_BODY instanceof Error) throw WO_BODY; return WO_BODY; } }), addRow: async () => ({ async json() { return { success: true, id: 'D1' }; } }),
  fetchTabs: async (e, tabs) => tabs.map(t => TABS[t] || []), sendSMS: async () => ({ sid: 'SM1' }), gmailSendEmail: async () => ({}), logSMS: async () => { if (CALLS.includes('logfail')) throw new Error('log tab full'); } }, ['deliveriesList', 'deliveryAdd', 'deliveryRelay']);
X = dl;
reset(); TAB_FAIL = new Set(['Tenants']); TABS = { Deliveries: [{ ID: 'd1', Active: 'TRUE' }] }; r = await dl.deliveriesList(env, null);
ok(r.body.count === 1 && has('tab_read_failed:deliveries_list', 'P2'), 'deliveriesList: a failed Tenants read still returns the deliveries but is reported');
reset(); TABS = { Deliveries: [{ ID: 'd1', Active: 'TRUE' }] }; r = await dl.deliveriesList(env, null); ok(r.body.count === 1 && none(), 'deliveriesList happy path: nothing reported');
reset(); WO_BODY = { id: 'WO-5' }; r = await dl.deliveryAdd(env, { property_id: 'p1', item_type: 'Fridge' });
ok(r.body.success && r.body.wo_id === 'WO-5' && none(), 'deliveryAdd happy path: auto-WO linked, nothing reported');
reset(); WO_BODY = new SyntaxError('Unexpected token <'); r = await dl.deliveryAdd(env, { property_id: 'p1', item_type: 'Fridge' });
ok(r.body.success && r.body.wo_id === '' && has('response_not_json:delivery_add_wo_response') && has('delivery_add_auto_wo_not_created', 'P1'), 'deliveryAdd: unreadable WO reply -> delivery still saved as before, but reported (P1: the install WO is missing)');
reset(); WO_BODY = { error: 'no property' }; r = await dl.deliveryAdd(env, { property_id: 'p1' });
ok(r.body.success && has('delivery_add_auto_wo_not_created', 'P1'), 'deliveryAdd: WO reply without an id is reported P1');
reset(); TABS = { Deliveries: [{ ID: 'd1', Tenant_ID: 't1', Onsite_Contact: 'tenant', Linked_WO_IDs: 'WO-1' }], Tenants: [{ ID: 't1', Phone: '4105550000', Email: 'a@b.c', First_Name: 'Al' }] };
r = await dl.deliveryRelay(env, { id: 'd1', message: 'hi' }); ok(r.body.success && r.body.sms_sent && none(), 'deliveryRelay happy path: nothing reported');
reset(); CALLS.push('logfail'); TABS = { Deliveries: [{ ID: 'd1', Tenant_ID: 't1', Onsite_Contact: 'tenant', Linked_WO_IDs: 'WO-1' }], Tenants: [{ ID: 't1', Phone: '4105550000', First_Name: 'Al' }] };
r = await dl.deliveryRelay(env, { id: 'd1', message: 'hi' }); ok(r.body.success && r.body.sms_sent && has('delivery_relay_sms_log', 'P1'), 'deliveryRelay: the SMS log write fails -> the send result is unchanged, the failed log is reported P1');

// ═════════ inspection loaders + alerts ═════════
console.log('\ninspection booking');
const il = build([grab('inspCustomersList'), grab('inspAvailabilityGet')], {}, ['inspCustomersList', 'inspAvailabilityGet']);
X = il;
reset(); TAB_FAIL = new Set(['Insp_Customers']); r = await il.inspCustomersList(env); ok(Array.isArray(r.body) && r.body.length === 0 && has('tab_read_failed:insp_customers_list', 'P2'), 'inspCustomersList: failed read returns [] as before and is reported');
reset(); TAB_FAIL = new Set(['Insp_Blackouts']); TABS = { Insp_Availability_Rules: [{ ID: '1' }] }; r = await il.inspAvailabilityGet(env); ok(r.body.rules.length === 1 && r.body.blackouts.length === 0 && has('tab_read_failed:insp_availability_get', 'P2'), 'inspAvailabilityGet: failed blackouts read reported, rules still returned');
reset(); TABS = { Insp_Customers: [{ ID: '1', Active: 'TRUE' }] }; r = await il.inspCustomersList(env); ok(r.body.length === 1 && none(), 'inspCustomersList happy path: nothing reported');

let TEL_FAIL, SMS_FAIL, MAIL_FAIL, ALERTS;
const ia = build(['const __inspAlertAt = {};', grab('inspAlert')], { logTelemetry: async () => { if (TEL_FAIL) throw new Error('telemetry tab gone'); }, fetchConfig: async () => ({ admin_phone: '+14105550000' }), sendSMS: async () => { if (SMS_FAIL) throw new Error('Twilio 21608'); return { sid: 'x' }; }, gmailSendEmail: async () => { if (MAIL_FAIL) throw new Error('Gmail 401'); return {}; } }, ['inspAlert']);
X = ia;
const iaReset = () => { reset(); TEL_FAIL = SMS_FAIL = MAIL_FAIL = false; for (const k of Object.keys({})) {} };
let n = 0; const kind = () => 'k' + (++n);   // __inspAlertAt throttles per kind
iaReset(); await ia.inspAlert(env, kind(), 'slot taken'); ok(none(), 'inspAlert happy path: nothing reported');
iaReset(); TEL_FAIL = true; await ia.inspAlert(env, kind(), 'x'); ok(has('telemetry_write_failed:insp_booking', 'P2'), 'inspAlert: telemetry write fails -> noted P2');
iaReset(); SMS_FAIL = true; await ia.inspAlert(env, kind(), 'x'); ok(has('insp_alert_sms_failed', 'P0'), 'inspAlert: the SMS to Brett fails -> noted P0');
iaReset(); MAIL_FAIL = true; await ia.inspAlert(env, kind(), 'x'); ok(has('insp_alert_email_failed', 'P1'), 'inspAlert: the email to Brett fails -> noted P1');

let BRETT_FAIL;
const sa = build(['const __strSysAt = {};', grab('strSystemAlert')], { logTelemetry: async () => { if (TEL_FAIL) throw new Error('telemetry tab gone'); }, fetchConfig: async () => ({}), strSendBrett: async () => { if (BRETT_FAIL) throw new Error('no route to Brett'); return { ok: true }; } }, ['strSystemAlert']);
X = sa;
reset(); TEL_FAIL = false; BRETT_FAIL = false; await sa.strSystemAlert(env, kind(), 'm'); ok(none(), 'strSystemAlert happy path: nothing reported');
reset(); TEL_FAIL = true; await sa.strSystemAlert(env, kind(), 'm'); ok(has('telemetry_write_failed:str_cleaning', 'P2'), 'strSystemAlert: telemetry fails -> noted P2');
reset(); TEL_FAIL = false; BRETT_FAIL = true; await sa.strSystemAlert(env, kind(), 'm'); ok(has('str_alert_could_not_tell_brett', 'P0'), 'strSystemAlert: could not tell Brett -> noted P0');

// ═════════ field inspection ═════════
console.log('\nfield inspection');
const fr = build([grab('fiErr'), grab('fiRoute')], { logTelemetry: async () => { if (TEL_FAIL) throw new Error('telemetry tab gone'); } }, ['fiRoute']);
X = fr;
reset(); TEL_FAIL = false; r = await fr.fiRoute(env, 'save', async () => { throw new Error('boom'); }); ok(r.status === 500 && r.body.error === 'internal' && none(), 'fiRoute: a route crash returns the 500 (telemetry ledgers it), nothing extra reported');
reset(); TEL_FAIL = true; r = await fr.fiRoute(env, 'save', async () => { throw new Error('boom'); }); ok(r.status === 500 && has('telemetry_write_failed:fi_route_error', 'P2'), 'fiRoute: the error telemetry write also fails -> still the same 500, failure noted');
reset(); TEL_FAIL = false; r = await fr.fiRoute(env, 'save', async () => 'fine'); ok(r === 'fine' && none(), 'fiRoute happy path unchanged');
const fx = build([grab('fiExtractJson'), grab('fiResolveUrl'), grab('fiLdNodes')], {}, ['fiExtractJson', 'fiResolveUrl', 'fiLdNodes']);
ok(fx.fiExtractJson('```json\n{"a":1}\n```').a === 1 && fx.fiExtractJson('Sure! {"a":2} done').a === 2 && fx.fiExtractJson('nothing here') === null, 'fiExtractJson: probes still behave (pure, direct, embedded, none)');
ok(fx.fiResolveUrl('/x', 'https://a.com/b') === 'https://a.com/x' && fx.fiResolveUrl('javascript:1', 'https://a.com') === '' && fx.fiResolveUrl('http://', 'not a base') === '', 'fiResolveUrl: probes still behave');
ok(fx.fiLdNodes('<script type="application/ld+json">{bad</script><script type="application/ld+json">{"@type":"Product"}</script>').length === 1, 'fiLdNodes: a malformed block is skipped, the next one is still read');

// ═════════ read-back + fee credit ═════════
console.log('\nupdateRowVerified / vendorFeeCreditAdd');
let RES_JSON;
const uv = build([grab('updateRowVerified')], { updateRow: async () => ({ clone() { return { async json() { if (RES_JSON instanceof Error) throw RES_JSON; return RES_JSON; } }; }, status: 200 }), invalidateTabCache: () => {} }, ['updateRowVerified']);
X = uv;
const rej = async (p) => { try { await p; return null; } catch (e) { return e; } };
reset(); RES_JSON = new SyntaxError('bad body'); let e1 = await rej(uv.updateRowVerified(env, 'Invoice_Review', 'r1', { A: '1' })); ok(e1 && /was not updated/.test(e1.message), 'updateRowVerified: an unreadable reply still THROWS (never a quiet "saved")');
reset(); RES_JSON = { success: true }; TABS = { Invoice_Review: [{ ID: 'r1', A: '1' }] }; ok((await rej(uv.updateRowVerified(env, 'Invoice_Review', 'r1', { A: '1' }))) === null, 'updateRowVerified: a good reply and a matching read-back passes');
let ADD_JSON;
const fc = build([grab('vendorFeeCreditAdd')], { ensureFeeCreditTab: async () => {}, feeCreditBalance: async () => (CALLS.includes('saved') && CALLS.push('read') && CALLS.filter(c => c === 'read').length > 1 ? 25 : 0), addRow: async () => ({ clone() { return { async json() { if (ADD_JSON instanceof Error) throw ADD_JSON; return ADD_JSON; } }; } }), invalidateTabCache: () => {}, money2: (n) => Math.round(n * 100) / 100, FEE_CREDIT_TAB: 'Instant_Fee_Credit' }, ['vendorFeeCreditAdd']);
X = fc;
reset(); CALLS.push('saved'); ADD_JSON = { success: true }; TABS = { Vendors: [{ ID: 'v1', Name: 'Cesar' }] };
r = await fc.vendorFeeCreditAdd(env, { vendor_id: 'v1', amount: 25 }); ok(r.body && r.body.success && none(), 'vendorFeeCreditAdd happy path: nothing reported');
reset(); ADD_JSON = new SyntaxError('Unexpected token <'); TABS = { Vendors: [{ ID: 'v1', Name: 'Cesar' }] };
r = await fc.vendorFeeCreditAdd(env, { vendor_id: 'v1', amount: 25 }); ok(r.status === 500 && /did not save correctly/.test(r.body.error) && has('response_not_json:vendor_fee_credit_add'), 'vendorFeeCreditAdd: an unreadable add reply is noted, and the balance read-back still catches the unsaved credit (500)');

// ═════════ the converted sites no longer swallow ═════════
console.log('\nsource wiring');
const startLine = src.slice(0, src.indexOf("'qb_send_invoice_ensure_columns'")).split('\n').length;
const left = scanSource(src).filter(f => !f.allowed && f.line >= startLine);
ok(left.length === 0, 'worker.js from the QB send-invoice area to the end has no unmarked swallowing catch', left.slice(0, 5));
const count = (needle) => src.split(needle).length - 1;
const must = [
  [/tryWrite\(env, 'qb_send_invoice_ensure_columns'[\s\S]{0,300}'P1'\)/, 'ensureColumns for Invoice_Review is a reported write (P1)'],
  [/tryWrite\(env, 'qb_send_invoice_wo_status'[\s\S]{0,400}'P1'\);\s*\n\s*if \(!_wr\.ok\) failWarnings\.push/, 'single-row send: WO Invoiced write is reported (P1) and surfaced as a warning'],
  [/tryWrite\(env, 'qb_send_invoice_group_wo_status'[\s\S]{0,400}'P1'\);\s*\n\s*if \(!_wr\.ok\) failWarnings\.push/, 'group send: WO Invoiced write is reported (P1) and surfaced as a warning'],
  [/softFail\(env, 'qb_preview_loan_balance', e, 'P2'[\s\S]{0,40}\); failWarnings\.push/, 'preview: loan balance read failure is reported and shown as a warning'],
  [{ test: () => count("softFail(env, 'qb_owner_email_lookup'") === 2 }, 'both send paths report a failed QB owner-email lookup'],
  [{ test: () => count("softFail(env, 'qb_invoice_dup_check'") === 2 }, 'both send paths report a failed duplicate-number check'],
  [/proposal_netting_check_failed', te, 'P2'/, 'netting-check telemetry failure is noted'], [{ test: () => count("telemetry_write_failed:proposal_netting_persist_failed', te, 'P2'") === 2 }, 'netting-persist telemetry failure is noted on both paths'],
  [/proposal_closeout_failed', te, 'P2'/, 'closeout telemetry failure is noted'], [{ test: () => count("telemetry_write_failed:fee_credit_apply_failed', te, 'P2'") === 2 }, 'fee-credit telemetry failure is noted on both paths'],
  [/parseJsonCell\(billRow && billRow\.Receipts_JSON, \[\], /, 'stored Receipts_JSON cell is parsed with parseJsonCell'],
];
for (const [re, msg] of must) ok(re.test(src), msg);

console.log(`\ncw7-silent-failures-tail: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
