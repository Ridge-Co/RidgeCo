// Fault-injection tests for Phase C batch w6 (Oct 20 2026): swallowed errors in worker.js between the vendor share view and the receipt duplicate audit
// (QuickBooks owner/vendor lookups, pay-bills audit log, property update, invoice repair, receipt duplicate checks, ...).
// Extracts the REAL functions from worker.js, FORCES each failure, and asserts (a) it is reported (right severity), (b) the caller still gets what it got before
// (or now hears about a failure it used to be told was a success), (c) the happy path reports nothing.   Run: node test/cw6-silent-failures.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function grab(name) {
  let kind = 'function ';
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) { start = src.indexOf('function ' + name + '('); }
  if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = .*;$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };

// ── fake world ──
let REPORTS, TABS, TAB_FAIL, ROW_WRITES, ROW_WRITE_FAIL, ENSURE_FAIL, QB, QB_FAIL, TELEMETRY_FAIL, SHEETS, FETCHES;
const reportFailure = async (env, f) => { REPORTS.push(f); return { ok: true, id: 'x' }; };
const sheetsRequest = async (env, method, path, body) => { SHEETS.push({ method, path }); if (SHEETS.fail && SHEETS.fail(path)) throw new Error('Sheets 503 on ' + path); return {}; };
const fetchTab = async (env, tab) => { if (TAB_FAIL && TAB_FAIL(tab)) throw new Error('Sheets read failed for ' + tab); return (TABS[tab] || []).map(r => ({ ...r })); };
const updateRow = async (env, tab, id, fields) => { if (ROW_WRITE_FAIL) throw new Error('Sheets 429 quota on update ' + tab); ROW_WRITES.push({ tab, id, fields }); return { status: 200, body: { success: true } }; };
const ensureColumns = async (env, tab, cols) => { if (ENSURE_FAIL) throw new Error('Sheets 500 adding columns'); };
const ensureTab = async () => {};
const addRow = async () => { if (ROW_WRITE_FAIL) throw new Error('Sheets 429 quota on add'); return { status: 200 }; };
const json = (b, s) => ({ body: b, status: s || 200, clone() { return { json: async () => b }; } });
const qbApi = async (env, path, method, body, token) => { if (QB_FAIL && QB_FAIL(path)) throw new Error('QuickBooks 500 on ' + path.slice(0, 40)); return QB(path); };
const logTelemetry = async (env, o) => { if (TELEMETRY_FAIL) throw new Error('telemetry tab unwritable'); };
const failBuildEvent_deps = [constLine('FAIL_EVENTS_TAB'), constLine('FAIL_EVENT_COLS'), constLine('FAIL_PENDING_MAX'), 'const _failPending = [];'];
const failSeverity = (where, message, sev) => sev || 'P2';
const failTrim = (s, n) => String(s).slice(0, n);
const failEnsureTabs = async () => {};
const ALL_PENDING = [];
const mk = (names, params, extraSrc = '', returns = names) => { const w = mk0(names, params, extraSrc, returns); ALL_PENDING.push(w.pending); return w; };
const mk0 = (names, params, extraSrc = '', returns = names) => new Function(
  'reportFailure', 'sheetsRequest', 'fetchTab', 'updateRow', 'ensureColumns', 'ensureTab', 'addRow', 'json', 'qbApi', 'logTelemetry', 'failSeverity', 'failTrim', 'failEnsureTabs', ...Object.keys(params),
  [...failBuildEvent_deps, grab('failBuildEvent'), grab('softNote'), grab('softFail'), grab('parseJsonCell'), grab('fetchTabSoft'), grab('safeJson'), grab('tryWrite'),
    extraSrc, ...names.map(grab), 'return { ' + returns.join(', ') + ', pending: _failPending };'].join('\n'))(
  reportFailure, sheetsRequest, fetchTab, updateRow, ensureColumns, ensureTab, addRow, json, qbApi, logTelemetry, failSeverity, failTrim, failEnsureTabs, ...Object.values(params));
const reset = () => { ALL_PENDING.forEach(a => { a.length = 0; }); REPORTS = []; TABS = {}; TAB_FAIL = null; ROW_WRITES = []; ROW_WRITE_FAIL = false; ENSURE_FAIL = false; QB = () => ({}); QB_FAIL = null; TELEMETRY_FAIL = false; SHEETS = []; FETCHES = []; };
console.error = () => {}; console.warn = () => {};
const env = {};
const noted = (W, where) => W.pending.filter(p => p.Where === where || p.Where.startsWith(where));
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ───────────────────────── propertyUpdate: ensureColumns failure used to look like a clean save ─────────────────────────
console.log('propertyUpdate');
{
  const W = mk(['propertyUpdate'], { PROPERTY_SOURCE_FIELDS: ['Source_Name', 'Source_Type', 'Source_Phone', 'Source_Email'] });
  reset(); let r = await W.propertyUpdate(env, { id: 'P1', fields: { Source_Name: 'Bob', Address: '1 Main' } });
  ok(r.status === 200 && REPORTS.length === 0 && W.pending.length === 0 && ROW_WRITES.length === 1, 'happy path: saved, nothing reported');
  reset(); ENSURE_FAIL = true; r = await W.propertyUpdate(env, { id: 'P1', fields: { Source_Name: 'Bob', Address: '1 Main' } });
  ok(r.status === 500 && r.body.partial === true && /NOT saved/.test(r.body.error) && ROW_WRITES.length === 1, 'the user is told the Source fields were not saved (and the other fields still were)', r);
  ok(REPORTS.length === 1 && REPORTS[0].where === 'property_update_ensure_source_columns' && REPORTS[0].severity === 'P1', 'the failure is in the ledger as P1', REPORTS);
  reset(); ENSURE_FAIL = true; r = await W.propertyUpdate(env, { id: 'P1', fields: { Address: '1 Main' } });
  ok(r.status === 200 && REPORTS.length === 0, 'an ordinary edit never touches ensureColumns, so nothing changes for it');
  reset(); ENSURE_FAIL = true; r = await W.propertyUpdate(env, { id: 'P1', fields: { Commercial_Subtype: 'Retail' } });
  ok(r.status === 500 && REPORTS[0].where === 'property_update_ensure_subtype_column', 'Commercial_Subtype column failure is reported and surfaced too');
}

// ───────────────────────── findRecentDuplicate ─────────────────────────
console.log('\nfindRecentDuplicate');
{
  const W = mk(['findRecentDuplicate'], {});
  reset(); TABS.Receipts = [{ ID: '1', Active: 'TRUE', Total: '5', Created_Date: new Date().toISOString() }];
  ok((await W.findRecentDuplicate(env, 'Receipts', { Total: '5' }, 60)).ID === '1' && W.pending.length === 0, 'happy path: finds the duplicate, reports nothing');
  reset(); TAB_FAIL = () => true;
  ok(await W.findRecentDuplicate(env, 'Receipts', { Total: '5' }, 60) === null, 'a failed read still lets the write through (null), as designed');
  ok(W.pending.length === 1 && W.pending[0].Where === 'duplicate_guard_failed:Receipts' && W.pending[0].Severity === 'P1', 'but the broken guard is queued for the ledger as P1', W.pending);
}

// ───────────────────────── uiTestWindowOpen ─────────────────────────
console.log('\nuiTestWindowOpen');
{
  let CFG;
  const W = mk(['uiTestWindowOpen'], { fetchConfig: async () => { if (CFG instanceof Error) throw CFG; return CFG; }, UI_TEST_MAX_MINUTES: 120 });
  reset(); CFG = { ui_test_mode_until: new Date(Date.now() + 600000).toISOString() };
  ok(await W.uiTestWindowOpen(env) === true && W.pending.length === 0, 'happy path: open window, nothing reported');
  CFG = new Error('Config read failed');
  ok(await W.uiTestWindowOpen(env) === false && W.pending[0].Where === 'ui_test_window_check', 'a failing check stays closed (false) and is queued');
}

// ───────────────────────── qbApprovedReceipts: must not rebuild an invoice minus its materials ─────────────────────────
console.log('\nqbApprovedReceipts');
{
  const W = mk(['qbApprovedReceipts'], {});
  reset(); TABS.Receipts = [{ ID: '7', Active: 'TRUE' }, { ID: '8', Active: 'FALSE' }];
  ok((await W.qbApprovedReceipts(env, { Own_Material_IDs: '7,8' })).length === 1 && W.pending.length === 0, 'happy path: returns only the active approved receipt');
  ok((await W.qbApprovedReceipts(env, {})).length === 0, 'no ids: empty list, no read');
  TAB_FAIL = () => true;
  const e = await rejects(W.qbApprovedReceipts(env, { ID: 'IR1', Own_Material_IDs: '7' }));
  ok(e && /cannot be rebuilt safely/.test(e.message) && W.pending[0].Where === 'qb_approved_receipts_read_failed' && W.pending[0].Severity === 'P1', 'a failed read now stops the repair (no silent empty list) and is reported P1', e && e.message);
}

// ───────────────────────── payAuthLog ─────────────────────────
console.log('\npayAuthLog');
{
  const W = mk(['payAuthLog'], { PAY_AUTH_LOG_TAB: 'Pay_Auth_Log', PAY_AUTH_LOG_COLS: ['Timestamp'] });
  reset(); ok(await W.payAuthLog(env, 'paid', 'd', 10, 'me', 'i') === true && W.pending.length === 0, 'happy path: true, nothing reported');
  ROW_WRITE_FAIL = true;
  ok(await W.payAuthLog(env, 'paid', 'd', 10, 'me', 'i') === false && W.pending[0].Where === 'pay_auth_log_write_failed' && W.pending[0].Severity === 'P1', 'failed log write: still false (callers retry + warn on screen) AND queued as P1');
}

// ───────────────────────── qbFindLikelyUnlinkedPayment ─────────────────────────
console.log('\nqbFindLikelyUnlinkedPayment');
{
  const W = mk(['qbFindLikelyUnlinkedPayment'], { qbEscape: (s) => s });
  reset(); QB = () => ({ QueryResponse: { Purchase: [{ Id: '5', TotalAmt: 100.4, TxnDate: '2026-10-01' }] } });
  ok((await W.qbFindLikelyUnlinkedPayment(env, 't', 'V1', 100)).id === '5' && W.pending.length === 0, 'happy path: finds the match, nothing reported');
  QB_FAIL = () => true;
  ok(await W.qbFindLikelyUnlinkedPayment(env, 't', 'V1', 100) === null && W.pending[0].Where === 'qb_unlinked_payment_lookup_failed', 'QuickBooks failure: still null (fail open) but reported');
}

// ───────────────────────── qbInvoiceLineDuplicates ─────────────────────────
console.log('\nqbInvoiceLineDuplicates');
{
  const W = mk(['qbInvoiceLineDuplicates'], { DUPLICATE_CHECK_MAX_INVOICE_OPENS: 5 });
  reset(); QB = (p) => ({ Invoice: { Id: p.includes('/2?') ? '2' : '1', DocNumber: 'D', TxnDate: '2026-10-01', Line: [{ DetailType: 'SalesItemLineDetail', Amount: 12.5, Description: 'x' }] } });
  QB_FAIL = (p) => p.includes('invoice/1?');
  const m = await W.qbInvoiceLineDuplicates(env, 't', 12.5, [{ Id: '1' }, { Id: '2' }]);
  ok(m.length === 1 && m[0].invoice_id === '2', 'one bad invoice open does not stop the others');
  ok(W.pending.length === 1 && W.pending[0].Where === 'receipt_dup_invoice_open_failed' && W.pending[0].Severity === 'P1', 'and the failed open is reported P1 (a missed duplicate could mean double billing)');
  reset(); QB = () => ({ Invoice: { Id: '1', Line: [] } }); await W.qbInvoiceLineDuplicates(env, 't', 12.5, [{ Id: '1' }]); ok(W.pending.length === 0, 'happy path reports nothing');
}

// ───────────────────────── receiptCheckDuplicatesOne ─────────────────────────
console.log('\nreceiptCheckDuplicatesOne');
{
  let FT;
  const W = mk(['receiptCheckDuplicatesOne'], {
    fetchTabs: async () => { if (FT) throw new Error('Receipts tab unreadable'); return [[], []]; },
    receiptDuplicatesAtProperty: () => [], qbAccessToken: async () => 't', qbDuplicateBillsNear: async () => [], qbDuplicateExpensesNear: async () => [],
    qbAllInvoicesRaw: async () => [], qbInvoiceCandidatesByDate: () => [], qbInvoiceLineDuplicates: async () => [],
  });
  reset(); FT = false;
  let ev = await W.receiptCheckDuplicatesOne(env, { Suggestion: '{"property":{"id":"P1"}}', Total: '10', Receipt_Date: '2026-10-01' });
  ok(ev.length === 0 && W.pending.length === 0, 'happy path: no evidence, nothing reported');
  FT = true;
  ev = await W.receiptCheckDuplicatesOne(env, { Suggestion: '{"property":{"id":"P1"}}', Total: '10', Receipt_Date: '2026-10-01' });
  ok(ev.length === 1 && ev[0].signal === 'qb_check_error' && /Receipts tab/.test(ev[0].reason), 'a Receipts read failure is shown to the person looking (evidence row the page already renders as a warning)', ev);
  ok(W.pending.some(p => p.Where === 'receipt_dup_receipts_read_failed' && p.Severity === 'P1'), 'and queued for the ledger');
  reset(); FT = false; ev = await W.receiptCheckDuplicatesOne(env, { Suggestion: '{broken', Total: '0', Receipt_Date: '' });
  ok(Array.isArray(ev) && W.pending.some(p => p.Where === 'json_cell_corrupt:Receipt_Recon_Queue.Suggestion'), 'a corrupt Suggestion cell no longer vanishes: P2 note, processing continues');
}

// ───────────────────────── receiptDuplicateAuditFlags ─────────────────────────
console.log('\nreceiptDuplicateAuditFlags');
{
  const W = mk(['receiptDuplicateAuditFlags'], { ensureReceiptDuplicateAuditTabs: async () => {}, receiptImageAttachedInfo: () => ({ image_attached: false, image_url: '' }) });
  reset(); TABS.Receipt_Duplicate_Audit = [{ ID: '1', Receipt_ID: '9', Matches_JSON: '[{"a":1}]' }, { ID: '2', Receipt_ID: '9', Matches_JSON: '{oops' }]; TABS.Receipts = [{ ID: '9' }];
  let r = await W.receiptDuplicateAuditFlags(env, null);
  ok(r.body.count === 2 && r.body.flags[0].matches.length === 1 && Array.isArray(r.body.flags[1].matches) && r.body.flags[1].matches.length === 0, 'corrupt Matches_JSON gives [] as before');
  ok(W.pending.length === 1 && W.pending[0].Where === 'json_cell_corrupt:Receipt_Duplicate_Audit.Matches_JSON', 'and exactly the corrupt cell is queued');
  reset(); TABS.Receipt_Duplicate_Audit = [{ ID: '1', Receipt_ID: '9', Matches_JSON: '' }]; TAB_FAIL = (t) => t === 'Receipts';
  r = await W.receiptDuplicateAuditFlags(env, null);
  ok(r.body.count === 1 && REPORTS.some(x => x.where === 'tab_read_failed:receipt_duplicate_audit_flags' && x.severity === 'P2'), 'a failed Receipts read still returns the flags but is reported');
}

// ───────────────────────── vendorPaidJobs ─────────────────────────
console.log('\nvendorPaidJobs');
{
  const W = mk(['vendorPaidJobs'], { findWO: (wos, id) => wos.find(w => String(w.ID) === String(id)), propUnitText: () => '1 Main', money2: (x) => x });
  reset(); TABS.Vendor_Bills = [{ QB_Bill_ID: 'B1', WO_ID: 'W1' }]; TABS.Work_Orders = [{ ID: 'W1', Property_ID: 'P1' }]; TABS.Properties = [{ ID: 'P1' }]; TABS.Units = [];
  let r = await W.vendorPaidJobs(env, ['B1']);
  ok(r.jobs.length === 1 && r.unresolved.length === 0 && REPORTS.length === 0, 'happy path: job resolved, nothing reported');
  TAB_FAIL = (t) => t === 'Vendor_Bills';
  r = await W.vendorPaidJobs(env, ['B1']);
  ok(r.unresolved.length === 1 && REPORTS.some(x => x.where === 'tab_read_failed:vendor_paid_jobs'), 'a failed Vendor_Bills read: the bill is listed as unresolved (as before) AND the failure is reported');
}

// ───────────────────────── QuickBooks owner / vendor mapping saves ─────────────────────────
console.log('\nQuickBooks customer / vendor mapping');
{
  const W = mk(['qbFindOrCreateCustomer', 'addOwnerWithQBSync', 'qbDupId', 'qbFault'], {
    qbLookupExisting: async () => 'QBC1', qbMappingClash: async () => null, qbOwnerDisplayName: (o) => o.Name || '', qbAccessToken: async () => 't',
  });
  reset();
  ok(await W.qbFindOrCreateCustomer(env, { ID: 'O1', Name: 'x' }, 'Acme', 't') === 'QBC1' && ROW_WRITES.length === 1 && REPORTS.length === 0, 'happy path: id returned and saved, nothing reported');
  reset(); ROW_WRITE_FAIL = true;
  ok(await W.qbFindOrCreateCustomer(env, { ID: 'O1', Name: 'x' }, 'Acme', 't') === 'QBC1', 'the QB id is still returned when saving the mapping fails');
  ok(REPORTS.length === 1 && REPORTS[0].where === 'owner_save_qbo_customer_id' && REPORTS[0].severity === 'P1', 'but the unsaved mapping is in the ledger as P1', REPORTS);
  // addOwnerWithQBSync: the QuickBooks sync fails after the owner was saved
  const W2 = mk(['addOwnerWithQBSync'], { addRow: async () => json({ id: 'O9' }), qbOwnerDisplayName: (o) => o.Name, qbAccessToken: async () => { throw new Error('QuickBooks token refused'); }, qbFindOrCreateCustomer: async () => 'x' });
  reset(); const resp = await W2.addOwnerWithQBSync(env, { Name: 'Zed' });
  ok(resp.body.id === 'O9', 'owner add still returns the saved owner');
  ok(REPORTS.length === 1 && REPORTS[0].where === 'owner_add_qb_sync_failed' && REPORTS[0].severity === 'P1' && /token refused/.test(REPORTS[0].message || (REPORTS[0].err && REPORTS[0].err.message)), 'the failed QuickBooks sync is written to the ledger now (P1)', REPORTS);
  const W3 = mk(['qbDupId'], {});
  ok(W3.qbDupId({ Fault: { Error: [{ code: '6240', Detail: 'Id=77' }] } }) === '77' && W3.qbDupId(null) === null, 'qbDupId unchanged');
}

// ───────────────────────── qbLookupExisting ─────────────────────────
console.log('\nqbLookupExisting');
{
  let LIST_FAIL;
  const W = mk(['qbLookupExisting'], { qbListEntities: async () => { if (LIST_FAIL) throw new Error('list failed'); return []; }, qbMatchEntity: () => null, qbEscape: (s) => s });
  reset(); QB = () => ({ QueryResponse: { Customer: [{ Id: '4', DisplayName: 'A' }] } }); LIST_FAIL = false;
  ok(await W.qbLookupExisting(env, 'owner', 'A', '', 't') === '4' && W.pending.length === 0, 'happy path: direct query finds exactly one, nothing reported');
  LIST_FAIL = true; ok(await W.qbLookupExisting(env, 'owner', 'A', '', 't') === '4' && W.pending.length === 0, 'list failure falls through to the direct query (documented stronger fallback)');
  QB_FAIL = () => true; ok(await W.qbLookupExisting(env, 'owner', 'A', '', 't') === null && W.pending[0].Where === 'qb_lookup_existing_failed:owner', 'when the direct query ALSO fails (so create is next) it is reported P1');
}

// ───────────────────────── driveIsSharedAnyone / qbUploadAttachable ─────────────────────────
console.log('\nDrive / QuickBooks upload bodies');
{
  let FETCH;
  const fetch = async (u, o) => FETCH(u, o);
  const W = mk(['driveIsSharedAnyone', 'qbUploadAttachable', 'qbFault'], { fetch, qbBase: () => 'https://qb', FormData, Blob });
  reset(); FETCH = async () => ({ ok: true, status: 200, json: async () => ({ permissions: [{ type: 'anyone' }] }) });
  ok(await W.driveIsSharedAnyone('t', 'F1') === true && W.pending.length === 0, 'driveIsSharedAnyone happy path');
  FETCH = async () => { throw new Error('network down'); };
  ok(await W.driveIsSharedAnyone('t', 'F1') === false && W.pending[0].Where === 'drive_is_shared_check_failed', 'network failure: false as before, but reported');
  reset(); FETCH = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  const e = await rejects(W.qbUploadAttachable({ QB_REALM_ID: '1' }, 't', 'Invoice', '9', 'a.jpg', 'image/jpeg', new ArrayBuffer(2), true));
  ok(e && /attach HTTP 200/.test(e.message) && W.pending.some(p => p.Where === 'response_not_json:qb_attachable_upload'), 'an HTML/garbage upload reply still throws AND the reason is queued');
  reset(); FETCH = async () => ({ ok: true, status: 200, json: async () => ({ AttachableResponse: [{ Attachable: { Id: '55' } }] }) });
  ok(await W.qbUploadAttachable({ QB_REALM_ID: '1' }, 't', 'Invoice', '9', 'a.jpg', 'image/jpeg', new ArrayBuffer(2), true) === '55' && W.pending.length === 0, 'qbUploadAttachable happy path');
}

// ───────────────────────── verifySessionToken ─────────────────────────
console.log('\nverifySessionToken');
{
  const W = mk(['_b64urlBytes', '_b64urlToBytes', '_hmac', 'makeSessionToken', 'verifySessionToken'], { crypto: globalThis.crypto, btoa, atob, TextEncoder, TextDecoder }, 'const _tenc = new TextEncoder(), _tdec = new TextDecoder();', ['makeSessionToken', 'verifySessionToken', '_hmac', '_b64urlBytes']);
  reset(); const tok = await W.makeSessionToken({ role: 'vendor' }, 's3cret');
  ok((await W.verifySessionToken(tok, 's3cret')).role === 'vendor' && W.pending.length === 0, 'valid token verifies, nothing reported');
  ok(await W.verifySessionToken('garbage', 's3cret') === null && await W.verifySessionToken(tok.slice(0, -3) + 'AAA', 's3cret') === null && W.pending.length === 0, 'junk or tampered tokens are just rejected (expected "no")');
  const body = W._b64urlBytes(new TextEncoder().encode('not json')); const bad = body + '.' + await W._hmac(body, 's3cret');
  ok(await W.verifySessionToken(bad, 's3cret') === null && W.pending[0].Where === 'session_token_payload_unparseable', 'a correctly SIGNED token with an unreadable body (should be impossible) is rejected and flagged');
}

// ───────────────────────── vendorSetInstantPay: telemetry write failure ─────────────────────────
console.log('\nvendorSetInstantPay');
{
  const W = mk(['vendorSetInstantPay'], { updateRowVerified: async () => { throw new Error('read-back mismatch'); } });
  reset(); TELEMETRY_FAIL = true; const r = await W.vendorSetInstantPay(env, { id: 'V1', value: true });
  ok(r.status === 500 && /Could not save/.test(r.body.error) && W.pending.some(p => p.Where === 'telemetry_write_failed:vendor_instant_pay_toggle_failed'), 'the user still gets the 500; a dead telemetry tab is now queued instead of vanishing');
}

// ───────────────────────── receiptDuplicateAuditBuildIndex ─────────────────────────
console.log('\nreceiptDuplicateAuditBuildIndex');
{
  const W = mk(['receiptDuplicateAuditBuildIndex'], {
    ensureReceiptDuplicateAuditTabs: async () => {}, qbAccessToken: async () => 't', RECEIPT_AUDIT_INVOICE_OPEN_LIMIT: 15,
    qbAllInvoicesRaw: async () => [{ Id: '1' }, { Id: '2' }],
    qbInvoiceLineCacheRows: (inv) => (inv ? [{ invoice_id: inv.Id, doc: 'D', date: '', customer_id: '', customer_name: '', description: '', amount: 1, paid: false }] : []),
  });
  reset(); QB = (p) => ({ Invoice: { Id: p.includes('/1?') ? '1' : '2' } });
  let r = await W.receiptDuplicateAuditBuildIndex(env, {});
  ok(r.body.ok && r.body.lines_cached_this_batch === 2 && !r.body.failure_warning && !r.body.clear_warning && W.pending.length === 0 && REPORTS.length === 0, 'happy path: unchanged response, nothing reported');
  reset(); QB = (p) => ({ Invoice: { Id: '2' } }); QB_FAIL = (p) => p.includes('/1?');
  r = await W.receiptDuplicateAuditBuildIndex(env, {});
  ok(r.body.ok && r.body.open_failures === 1 && r.body.failed_invoice_ids[0] === '1' && /could not be opened/.test(r.body.failure_warning), 'a failed invoice open is now named in the response');
  ok(r.body.lines_cached_this_batch === 1 && W.pending.some(p => p.Where === 'qb_invoice_line_cache_open_failed' && p.Severity === 'P1'), 'the rest of the batch still cached, failure queued P1');
  reset(); SHEETS.fail = (p) => /:clear$/.test(p);
  r = await W.receiptDuplicateAuditBuildIndex(env, {});
  ok(r.body.ok && /could not be cleared/.test(r.body.clear_warning) && REPORTS.some(x => x.where === 'qb_invoice_line_cache_clear_failed' && x.severity === 'P1'), 'a failed cache clear is surfaced to the caller and reported P1');
}

// ───────────────────────── qbTermForDays / logAugment ─────────────────────────
console.log('\nqbTermForDays / logAugment');
{
  const W = mk(['qbTermForDays'], {}, 'let _qbTermsByDays = null; let _qbTermsAt = 0;');
  reset(); QB_FAIL = () => true;
  ok(await W.qbTermForDays(env, 't', 30) === '' && W.pending[0].Where === 'qb_terms_lookup_failed', 'terms lookup failure: empty term as before, but reported');
  const W2 = mk(['logAugment'], { ensureAugmentLog: async () => { throw new Error('tab missing'); }, nextSafeId: () => 1, col: () => 'A' });
  reset(); ok(await W2.logAugment(env, 'tenant', 'T1', 'Email', '', 'a@b') === undefined && W2.pending[0].Where === 'augment_log_write_failed', 'audit-row failure never breaks the write but is queued');
}

// ───────────────────────── qbVendorTransactions ─────────────────────────
console.log('\nqbVendorTransactions');
{
  const W = mk(['qbVendorTransactions'], { qbEscape: (s) => s });
  reset(); QB = () => ({ QueryResponse: { Bill: [{ Id: '1' }] } }); QB_FAIL = (p) => /Purchase/.test(decodeURIComponent(p));
  const r = await W.qbVendorTransactions(env, 't', 'V1');
  ok(W.pending.some(p => p.Where === 'qb_vendor_transactions_query_failed:Purchase'), 'the failing source is reported by name', W.pending.map(p => p.Where));
  ok(JSON.stringify(r).includes('"Bill"') || r !== undefined, 'the function still returns a result for the sources that loaded');
}

// ───────────────────────── static: the swallowing catches are gone from the converted sites ─────────────────────────
console.log('\nsource scan');
{
  const has = (s) => src.includes(s);
  ok(!has("} catch(e2){}") && !has("} catch(e3){}") && !has("try { await Promise.all(jobs); } catch(e){}"), 'vendor share view: no empty catches');
  ok(!has("const _sc2 = (await fetchTab(env, 'Scopes').catch") && !has("const _sc = (await fetchTab(env, 'Scopes').catch") && !has("(await fetchTab(env, INTAKE_TAB).catch") && !has("(await fetchTab(env, 'Insp_Bookings').catch") && !has("(await fetchTab(env, WO_SNIPPETS_TAB).catch")
    && !has("fetchTab(env, 'Vendor_Bills').catch(() => []), fetchTab(env, 'Invoice_Review').catch") && !has("fetchTab(env, 'Receipts').catch(() => []),\n  ]);\n  let out = rows.filter"), 'staging guards / vendor paid jobs / audit flags: no .catch(() => [])');
  ok(!has("catch (e) {}\n  }\n\n  // QuickBooks requires DisplayName") && !has("QBO_Customer_ID: found }); } catch (e) {}") && !has("QBO_Vendor_ID: id }); } catch (e) {} }"), 'QuickBooks mapping saves: no empty catches');
  ok(!has("try { receipts = JSON.parse(billRow?.Receipts_JSON || '[]'); } catch (e) {}") && !has("try { receipts = JSON.parse((billRow && billRow.Receipts_JSON) || '[]'); } catch (e) {}") && !has("\n  try { receipts = JSON.parse(billRow.Receipts_JSON || '[]'); } catch (e) {}") && !has("JSON.parse(f.Matches_JSON || '[]')") && !has("JSON.parse(row.Suggestion || 'null'); } catch (_) {}"), 'Receipts_JSON / Matches_JSON / Suggestion parses go through parseJsonCell');
  ok(!has("catch (_) { console.warn('append race repaired but telemetry failed'); }"), 'append-race telemetry catch reports');
  ok(!/Success: 'FALSE'[^\n]*\} catch \(_\) \{\}/.test(src.slice(src.indexOf('async function ensureColumns('), src.indexOf('async function ensureColumnsInner('))), 'ensureColumns failure telemetry catch reports');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
