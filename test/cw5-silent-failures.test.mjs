// Phase C batch w5 (Oct 20 2026): fault-injection tests for the swallowed-error fixes in worker.js (AI credit, digest, AR reports/reminders,
// Gmail, receipts, owner onboarding, WO share). Extracts the REAL functions from worker.js, FORCES each failure, and asserts
//   (a) it is reported (softNote queue / reportFailure) with the right severity,
//   (b) the caller still gets what it got before (or now gets the failure where success was falsely claimed),
//   (c) the happy path reports nothing.
// Run: node test/cw5-silent-failures.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function grab(name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = .*;$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };

// ── the real Phase C helpers, wired to capture instead of writing to Sheets ──
let REPORTS, TAB_FAIL;
const pending = [];
const reportFailure = async (env, f) => { REPORTS.push(f); return { ok: true, id: 'x' }; };
const fetchTabBase = async (env, tab) => { if (TAB_FAIL) throw new Error('Sheets read failed for ' + tab); return []; };
const base = {
  reportFailure, fetchTab: fetchTabBase, failSeverity: (w, m, s) => s || 'P2', failTrim: (s, n) => String(s).slice(0, n),
  sheetsRequest: async () => ({}), failEnsureTabs: async () => {},
  json: (b, status) => ({ status: status || 200, ok: (status || 200) < 400, body: b, async json() { return b; } }),
  schedErrText: (e) => String((e && e.message) || e),
};
const helperSrc = [constLine('FAIL_EVENTS_TAB'), constLine('FAIL_EVENT_COLS'), constLine('FAIL_PENDING_MAX'), 'const _failPending = __pending;', grab('failBuildEvent'), grab('softNote'), grab('softFail'),
  grab('parseJsonCell'), grab('fetchTabSoft'), grab('safeJson'), grab('tryWrite')].join('\n');
// make(fnNames, deps, extraSrc): builds the named worker.js functions with every free variable supplied from base+deps.
function make(fnNames, deps, extraSrc) {
  const all = Object.assign({ __pending: pending }, base, deps || {});
  const keys = Object.keys(all);
  const body = helperSrc + '\n' + (extraSrc || '') + '\n' + fnNames.map(grab).join('\n') + '\nreturn {' + fnNames.join(',') + '};';
  return new Function(...keys, body)(...keys.map(k => all[k]));
}
const reset = () => { REPORTS = []; TAB_FAIL = false; pending.length = 0; };
const noted = (where) => pending.find(p => p.Where === where);
const reported = (where) => REPORTS.find(r => r.where === where);
console.error = () => {};
const env = { QB_REALM_ID: 'R1', WORKER_SECRET: 's' };
const throwing = (m) => async () => { throw new Error(m); };

// ═══════════════ AI credit / fail-open (P0 / P1) ═══════════════
console.log('aiFailOpenNote: telemetry write failing too');
{
  reset();
  const t = make(['aiFailOpenNote'], { aiCreditIsPausedError: (e) => !!e.paused, logTelemetry: throwing('telemetry tab down') });
  await t.aiFailOpenNote(env, 'translate_sms', new Error('Anthropic 500'));
  const n = noted('ai_fail_open:translate_sms');
  ok(n && n.Severity === 'P1' && /Anthropic 500/.test(n.Message) && /telemetry tab down/.test(n.Message), 'both failures are queued (P1), naming the AI error and the telemetry error', n);
  reset(); await t.aiFailOpenNote(env, 'x', Object.assign(new Error('credit'), { paused: true })); ok(pending.length === 0, 'the designed pause path reports nothing here (already alerted elsewhere)');
  reset(); const t2 = make(['aiFailOpenNote'], { aiCreditIsPausedError: () => false, logTelemetry: async () => {} }); await t2.aiFailOpenNote(env, 'x', new Error('e')); ok(pending.length === 0, 'telemetry written fine -> nothing extra queued');
}
console.log('\naiCreditCheck: pause flag unreadable');
{
  reset();
  const t = make(['aiCreditCheck'], { schedReadConfigRows: throwing('Config read 429'), aiCreditStateFromRows: () => ({ paused: false }), logTelemetry: throwing('telemetry down') },
    'let _aiCreditCache = null, _aiCreditReadFailMs = 0; const AI_CREDIT_CACHE_MS = 1000;');
  const st = await t.aiCreditCheck(env, { fresh: true });
  const n = noted('ai_credit_flag_read_failed');
  ok(st.paused === false && /429/.test(st.read_error), 'caller still gets {paused:false, read_error} (AI is let through, as before)', st);
  ok(n && n.Severity === 'P0', 'flag-read failure + telemetry failure is queued as P0', n);
}
console.log('\nrouteAIValid');
{
  reset();
  const t = make(['routeAIValid']);
  ok(t.routeAIValid({ text: '```json\n{"a":1}\n```' }, { schema: true }) === true && t.routeAIValid({ text: 'not json' }, { schema: true }) === false && t.routeAIValid({ text: 'hi' }, {}) === true, 'valid JSON passes, garbage is rejected exactly as before');
  ok(pending.length === 0 && REPORTS.length === 0, 'model output that is not JSON is the expected "invalid" answer: nothing reported (documented silent-ok)');
}

// ═══════════════ AR reminders (QuickBooks send) ═══════════════
console.log('\narRemind: QuickBooks send + audit log');
{
  const inv = { Balance: 100, DocNumber: 'D1', CustomerRef: { name: 'Cust' }, BillEmail: { Address: 'c@x.com' } };
  const mk = (over) => make(['arRemind'], Object.assign({
    qbAccessToken: async () => 'tok', qbApi: async () => ({ Invoice: inv }), qbBase: () => 'https://qb', ensureTab: async () => {}, ensureColumns: async () => {}, addRow: async () => ({}),
    AR_REMINDER_TAB: 'AR_Reminders', AR_REMINDER_COLS: ['ID'],
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ Invoice: { EmailStatus: 'EmailSent' } }) }),
  }, over), '');
  reset(); let r = await mk({}).arRemind(env, { invoice_ids: ['1'] });
  ok(r.body.items[0].sent === true && pending.length === 0 && REPORTS.length === 0, 'happy path: sent, nothing reported');
  reset(); r = await mk({ addRow: throwing('sheet 500') }).arRemind(env, { invoice_ids: ['1'] });
  ok(r.body.items[0].sent === true, 'audit-log failure: the email WAS sent, so the item stays sent:true');
  ok(reported('ar_remind_audit_log_failed') && reported('ar_remind_audit_log_failed').severity === 'P1', 'audit-log failure is reported P1 (it is the cooldown/audit record)');
  reset(); r = await mk({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } }) }).arRemind(env, { invoice_ids: ['1'] });
  ok(r.body.items[0].sent === false && /send not confirmed/.test(r.body.items[0].reason), 'QuickBooks answering non-JSON is NOT reported as sent: the caller sees "send not confirmed"');
  ok(noted('response_not_json:ar_remind_send'), 'the non-JSON body is queued for the ledger');
}

// ═══════════════ AR report emails ═══════════════
console.log('\narReportSend / arReportSetOptIn / arReportRevoke');
{
  const group = { owner_id: '7', eligible: true, owner_email: 'o@x.com', owner_name: 'Owner', total_open: 10, invoices: [{}] };
  const mk = (over) => make(['arReportSend'], Object.assign({
    arReportRollup: async () => ({ groups: [group] }), arReportLinkToken: async () => 'tk', buildArReportEmailHtml: () => '<p/>', gmailSendEmail: async () => ({ sent: true }),
    ensureTab: async () => {}, addRow: async () => ({}), AR_REPORT_LOG_TAB: 'AR_Report_Log', AR_REPORT_LOG_COLS: ['ID'],
  }, over));
  reset(); let r = await mk({}).arReportSend(env, { owner_ids: ['7'] });
  ok(r.body.sent === 1 && REPORTS.length === 0, 'happy path: sent, nothing reported');
  reset(); r = await mk({ addRow: throwing('log tab 500') }).arReportSend(env, { owner_ids: ['7'] });
  ok(r.body.sent === 1 && reported('ar_report_audit_log_failed') && reported('ar_report_audit_log_failed').severity === 'P1', 'send succeeded + audit log failed: still sent, failure reported P1');
  reset(); r = await mk({ gmailSendEmail: throwing('Gmail 401'), addRow: throwing('log tab 500') }).arReportSend(env, { owner_ids: ['7'] });
  ok(r.body.sent === 0 && /Gmail 401/.test(r.body.results[0].reason) && reported('ar_report_failure_log_failed'), 'send failed AND its failure row could not be logged: result still says why, the logging failure is reported');

  const added = [];
  const mkOpt = (over) => make(['arReportSetOptIn'], Object.assign({
    ensureTab: async () => {}, AR_OPTIN_TAB: 'AR_Optin', AR_OPTIN_COLS: ['ID'], updateRow: async () => {}, addRow: async (e, t, row) => { added.push(row); },
  }, over));
  reset(); let o = await mkOpt({ fetchTab: async (e, t) => t === 'Owners' ? [{ ID: '7', First_Name: 'A', Last_Name: 'B' }] : [] }).arReportSetOptIn(env, { owner_id: '7', enabled: true });
  ok(o.body.ok === true && added.length === 1 && REPORTS.length === 0, 'opt-in happy path adds the row, reports nothing');
  reset(); added.length = 0;
  o = await mkOpt({ fetchTab: throwing('Sheets read 503') }).arReportSetOptIn(env, { owner_id: '7', enabled: true });
  ok(o.status === 502 && /nothing was changed/.test(o.body.error) && added.length === 0, 'unreadable opt-in list: refuses (502) instead of adding a duplicate row');
  ok(reported('ar_optin_read_failed') && reported('ar_optin_read_failed').severity === 'P1', '...and reports it P1');

  const mkRev = (over) => make(['arReportRevoke'], Object.assign({ ensureColumns: async () => {}, fetchTab: async () => [{ ID: '7', AR_Report_Rev: '2' }], updateRow: async () => {} }, over));
  reset(); let v = await mkRev({}).arReportRevoke(env, { owner_id: '7' });
  ok(v.body.success && v.body.rev === '3' && !('failure_warning' in v.body) && REPORTS.length === 0, 'revoke happy path: unchanged response, nothing reported');
  reset(); v = await mkRev({ ensureColumns: throwing('quota') }).arReportRevoke(env, { owner_id: '7' });
  ok(v.body.success && v.body.rev === '3' && /could not be confirmed/.test(v.body.failure_warning) && reported('ar_report_ensure_rev_column').severity === 'P1', 'ensureColumns failure on revoke: still revokes, but the response carries a warning and it is reported P1');
}

console.log('\nrunWeeklyArReport / arReportPayLink / gmailAccessToken');
{
  reset();
  const t = make(['runWeeklyArReport'], { fetchConfig: async () => ({ ar_report_enabled: 'TRUE' }), arReportOptInList: async () => [{ Enabled: 'TRUE', Owner_ID: '7' }],
    arReportSend: async () => ({ json: async () => { throw new SyntaxError('x'); } }), logTelemetry: throwing('telemetry down') });
  const r = await t.runWeeklyArReport(env);
  ok(r.delivered === true && r.sent === 0, 'caller result unchanged (delivered:true, sent:0)');
  ok(noted('response_not_json:runWeeklyArReport') && noted('telemetry_write_failed:ar_weekly_report'), 'non-JSON send response AND failing telemetry are both queued');

  reset();
  const g = make(['gmailAccessToken', 'gmailRefreshCandidates'], { fetchConfig: async () => ({ GMAIL_REFRESH_TOKEN: 'rt' }), GMAIL_RECONNECT_HINT: 'Reconnect Gmail.',
    fetch: async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>'); } }) }, 'let _gmailTokenCache = { token: null, at: 0 };');
  let threw = ''; try { await g.gmailAccessToken({ GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's' }); } catch (e) { threw = e.message; }
  ok(/token refresh failed/.test(threw) && noted('response_not_json:gmail_token_refresh'), 'Gmail token endpoint returning HTML still throws, and the bad body is queued');
}

// ═══════════════ Receipts ═══════════════
console.log('\nsendReceiptsToQBEmail');
{
  const tabs = { Receipts: [{ ID: '9', Active: 'TRUE', QB_Email_Sent: 'FALSE', Store: 'HD', Amount: '5', Source_File_ID: 'F9' }], Receipt_Recon_Queue: [], Properties: [], Work_Orders: [] };
  const sent = [];
  const mk = (over) => make(['sendReceiptsToQBEmail'], Object.assign({
    fetchTab: async (e, t) => (tabs[t] || []).map(r => ({ ...r })), fetchConfig: async () => ({ qb_receipts_email: 'qb@x.com' }), ensureColumns: async () => {},
    _recoverReceiptSourceFile: (r) => ({ id: r.Source_File_ID || '', url: '' }), getAccessToken: async () => 't', driveDownload: async () => ({ bytes: new ArrayBuffer(2), mime: 'application/pdf' }),
    bytesToB64: () => 'AA==', _escHtml: (s) => String(s), gmailSendEmailWithAttachment: async (e, m) => { sent.push(m); }, updateRow: async () => {}, setTimeout: (f) => f(),
  }, over));
  reset(); let r = await mk({}).sendReceiptsToQBEmail(env, {});
  ok(r.body.sent === 1 && !('failure_warnings' in r.body) && pending.length === 0 && REPORTS.length === 0, 'happy path: unchanged response, nothing reported');
  reset(); r = await mk({ ensureColumns: throwing('quota') }).sendReceiptsToQBEmail(env, {});
  ok(r.body.sent === 1 && /could not be confirmed/.test(r.body.failure_warnings[0]) && reported('qb_receipts_ensure_columns').severity === 'P1', 'ensureColumns failure: still sends, response gains a warnings entry, reported P1');
  reset(); sent.length = 0; r = await mk({ driveDownload: throwing('Drive 403') }).sendReceiptsToQBEmail(env, {});
  ok(r.body.sent === 1 && r.body.sent_without_attachment === 1 && sent[0].attachment === null && noted('qb_receipt_attachment_failed'), 'attachment download failure: email still goes (text only), reported');
  reset(); TAB_FAIL = true; r = await make(['sendReceiptsToQBEmail'], { fetchTab: async (e, t) => { if (t === 'Receipts') return tabs.Receipts; throw new Error('read failed ' + t); }, fetchConfig: async () => ({ qb_receipts_email: 'qb@x.com' }), ensureColumns: async () => {},
    _recoverReceiptSourceFile: () => ({ id: '', url: '' }), _escHtml: (s) => String(s), gmailSendEmailWithAttachment: async () => {}, updateRow: async () => {}, setTimeout: (f) => f() }).sendReceiptsToQBEmail(env, {});
  ok(r.body.sent === 1 && REPORTS.some(x => x.where === 'tab_read_failed:sendReceiptsToQb'), 'unreadable support tabs (queue/properties/WOs): reported, the send still proceeds');
}
console.log('\nreceiptsImageCheck / vendorBillReconcileReceipts');
{
  reset(); TAB_FAIL = true;
  const t = make(['receiptsImageCheck'], { _recoverReceiptSourceFile: () => ({ id: '' }), ensureTab: async () => {} });
  let threw = null; try { await t.receiptsImageCheck(env); } catch (e) { threw = e; }
  ok(REPORTS.some(x => x.where === 'tab_read_failed:receiptsImageCheck'), 'diagnostic tab reads that fail are reported (not silently treated as empty)', threw && threw.message);

  const mk = (fetchTab) => make(['vendorBillReconcileReceipts'], { receiptImageExtractMultiple: async () => ({ receipts: [{ total: 5 }], receipt_count: 1 }), fetchTab });
  reset(); let r = await mk(async () => [{ ID: 'r1', WO_ID: 'W1', Amount: '5', Active: 'TRUE' }]).vendorBillReconcileReceipts(env, { image_b64: btoa('x'), wo_id: 'W1' });
  ok(r.body.all_accounted_for === true && !('logged_read_error' in r.body) && REPORTS.length === 0, 'happy path: matched, no extra field, nothing reported');
  reset(); r = await mk(throwing('Receipts read 503')).vendorBillReconcileReceipts(env, { image_b64: btoa('x'), wo_id: 'W1' });
  ok(r.body.ok && r.body.all_accounted_for === false && /503/.test(r.body.logged_read_error), 'unreadable Receipts tab: the response says so and does NOT claim all receipts accounted for');
  ok(reported('vendor_bill_reconcile_receipts_read_failed').severity === 'P1', '...and reports it P1');
}
console.log('\nautoLinkReceipt / receiptIntake / receiptScan / approveReceiptQueue');
{
  reset(); TAB_FAIL = false;
  let t = make(['autoLinkReceipt'], { fetchTab: throwing('read failed') });
  let out = await t.autoLinkReceipt(env, { handwritten_note: 'WO-1234' });
  ok(out.wo_id === '' && out.property_id === '' && noted('receipt_autolink_failed'), 'autolink failure: same empty link returned, failure queued');

  const mkIntake = (over) => make(['receiptIntake'], Object.assign({
    receiptExtract: async () => ({ vendor: 'Home Depot', total: 5, suggested_category: 'supplies' }), fetchConfig: async () => ({ receipt_vendor_defaults: '{"home depot":"materials"}' }),
    autoLinkReceipt: async () => ({ wo_id: '', property_id: '' }), ensureTab: async () => {}, RECEIPTS_QUEUE_HEADERS: [], driveIdFromUrl: () => '',
    addRow: async () => ({ status: 200, json: async () => ({ success: true, id: '77' }) }),
  }, over));
  reset(); let ri = await mkIntake({}).receiptIntake(env, { image_b64: btoa('x') });
  const rb = await ri.json();
  ok(rb.id === '77' && rb.queued.Category === 'materials' && pending.length === 0, 'intake happy path: id returned, vendor default applied, nothing reported');
  reset(); ri = await mkIntake({ fetchConfig: async () => ({ receipt_vendor_defaults: '{broken' }), addRow: async () => ({ status: 500, json: async () => { throw new SyntaxError('x'); } }) }).receiptIntake(env, { image_b64: btoa('x') });
  ok(noted('json_cell_corrupt:Config.receipt_vendor_defaults') && noted('receipt_intake_no_id') && noted('receipt_intake_no_id').Severity === 'P1', 'corrupt vendor-defaults cell AND an add that returned no id are both queued (P1 for the missing id)');

  const mkScan = (over, intake) => make(['receiptScan'], Object.assign({
    aiCreditCheck: async () => ({ paused: false }), aiCreditPausedJson: () => ({}), AI_SCAN_PAUSED_MSG: '', fetchConfig: async () => ({ receipts_inbox_folder_id: 'FOLD' }), getAccessToken: async () => 't',
    fetch: async () => ({ json: async () => ({ files: [{ id: 'a', name: 'a.pdf' }] }) }), fetchTab: async () => [], receiptIntake: intake, aiCreditErrorTextIsOutage: () => false, aiCreditIsPausedError: () => false,
    setConfigKey: async () => ({}), DRIVE_PROPERTIES_ROOT: '', findOrCreateFolder: async () => ({}),
  }, over));
  let calls = 0; const intake = async () => { calls++; };
  reset(); let s = await mkScan({}, intake).receiptScan({});
  ok(s.body.ok && s.body.scanned === 1 && calls === 1 && REPORTS.length === 0, 'scan happy path: one file ingested, nothing reported');
  reset(); calls = 0; s = await mkScan({ fetchTab: throwing('Receipts_Queue 429') }, intake).receiptScan({});
  ok(s.status === 500 && s.body.ok === false && calls === 0, 'unreadable queue: the scan stops (no file is re-read / re-billed to the AI) and says why');
  ok(reported('receipt_scan_queue_read_failed').severity === 'P1', '...and reports it P1');

  const rows = [{ ID: '5', Vendor: 'HD', Receipt_Date: '2026-01-01', Total: '5', Category: 'c', Source_File_ID: 'F', Suggested_WO_ID: '', Suggested_Property_ID: '' }];
  const mkApprove = (over) => make(['approveReceiptQueue'], Object.assign({
    fetchTab: async () => rows, fetchConfig: async () => ({ receipts_dest_folder_id: 'DEST', receipt_vendor_defaults: '{}' }), driveIdFromUrl: () => '', getAccessToken: async () => 't',
    driveDownload: async () => ({ bytes: new ArrayBuffer(1), mime: 'application/pdf' }), uploadFileToDrive: async () => ({ webViewLink: 'http://f' }), updateRow: async () => {}, setConfigKey: async () => ({}),
  }, over));
  reset(); let a = await mkApprove({}).approveReceiptQueue(env, { id: '5' });
  ok(a.body.ok && a.body.filed === 'http://f' && !('failure_warning' in a.body) && pending.length === 0 && REPORTS.length === 0, 'approve happy path: unchanged, nothing reported');
  reset(); a = await mkApprove({ uploadFileToDrive: throwing('Drive 500') }).approveReceiptQueue(env, { id: '5' });
  ok(a.body.ok && a.body.filed === null && /could not be filed/.test(a.body.failure_warning) && noted('receipt_queue_filing_failed'), 'filing failure: still marked reviewed, response carries a warning, reported');
  reset(); a = await mkApprove({ setConfigKey: throwing('Config write 500') }).approveReceiptQueue(env, { id: '5' });
  ok(a.body.ok && reported('receipt_vendor_default_learn_failed'), 'vendor-default learning failure: response unchanged, reported');
}

// ═══════════════ Owner onboarding invite / WO share / vendor QB ═══════════════
console.log('\nownerOnboardInviteCreate / woShareRevoke / qbSyncVendorOnboardingFields');
{
  const mk = (addRow) => make(['ownerOnboardInviteCreate'], { ensureTab: async () => {}, ooToken: () => 'TOK', ooClean: (s) => String(s || ''), ooDigits: (s) => String(s || ''), OWNER_INVITE_HEADERS: [], PORTAL_BASE: 'https://p', addRow });
  reset(); let r = await mk(async () => ({ status: 200, clone() { return this; }, json: async () => ({ id: '12' }) })).ownerOnboardInviteCreate(env, {});
  ok(r.body.id === '12' && pending.length === 0, 'invite happy path: id returned, nothing reported');
  reset(); r = await mk(async () => ({ status: 500, clone() { return this; }, json: async () => { throw new SyntaxError('x'); } })).ownerOnboardInviteCreate(env, {});
  ok(r.body.success === true && r.body.id === '' && noted('owner_invite_create_no_id').Severity === 'P1', 'invite whose row did not save: still returns the same shape but is reported P1 (link may be dead)');

  const mkW = (over) => make(['woShareRevoke'], Object.assign({ ensureColumns: async () => {}, fetchTab: async () => [{ ID: '1', Share_Rev: '1' }], findWO: (l, id) => l.find(w => w.ID === id), updateWOFields: async () => {} }, over));
  reset(); let w = await mkW({}).woShareRevoke(env, { wo_id: '1' });
  ok(w.body.success && w.body.rev === '2' && !('failure_warning' in w.body) && REPORTS.length === 0, 'share revoke happy path: unchanged');
  reset(); w = await mkW({ ensureColumns: throwing('quota') }).woShareRevoke(env, { wo_id: '1' });
  ok(w.body.success && /could not be confirmed/.test(w.body.failure_warning) && reported('wo_share_ensure_rev_column').severity === 'P1', 'share revoke with column failure: warning + P1 report');

  reset();
  const q = make(['qbSyncVendorOnboardingFields'], { vendorQBOnboardingFields: () => ({ a: 1 }), qbApi: throwing('QB 500'), qbFault: () => '', logTelemetry: throwing('telemetry down') });
  const qr = await q.qbSyncVendorOnboardingFields(env, { ID: '3' }, '55', 'tok');
  ok(qr.ok === false && /QB 500/.test(qr.error), 'QB push failure still returned to the caller');
  ok(noted('telemetry_write_failed:vendor_onboarding_qb_push_failed'), 'telemetry write failing on top of it is queued');
}

// ═══════════════ source-level guards: converted sites no longer swallow ═══════════════
console.log('\nsource guards');
{
  const has = (re) => re.test(src);
  ok(!has(/try \{ await ensureColumns\(env, 'Owners', \['AR_Report_Rev'\]\); \} catch \(e\) \{\}/), 'no empty catch around the AR_Report_Rev ensureColumns');
  ok(!has(/try \{ await ensureColumns\(env, 'Work_Orders', \['Share_Rev'\]\); \} catch\(e\)\{\}/), 'no empty catch around the Share_Rev ensureColumns');
  ok(!has(/updateRow\(env, 'Owner_Invites'[^\n]*\.catch\(\(\) => \{\}\)/), 'Owner_Invites updates no longer use .catch(() => {})');
  const mine = ['sendReceiptsToQBEmail', 'gmailAccessToken', 'receiptIntake', 'approveReceiptQueue', 'receiptScan', 'woShareSend', 'woShareBuild'].map(grab).join('\n');
  ok(!/fetchConfig\(env\)\.catch/.test(mine), 'fetchConfig(...).catch dead code removed in the receipt / gmail functions');
  ok(!/JSON\.parse\(cfg\.receipt_vendor_defaults/.test(mine) && !/JSON\.parse\(cfg\.receipt_intake_failures/.test(mine) && /parseJsonCell\(cfg\.receipt_vendor_defaults/.test(mine), 'stored-cell JSON parses in receipt functions go through parseJsonCell');
  ok(/const tradeAccessDefaults = parseJsonCell\(config\.Access_Trade_Defaults, \{\}, 'Config\.Access_Trade_Defaults'\)/.test(src), 'shared-WO trade-access defaults parse via parseJsonCell');
  ok(/telemetry_write_failed:daily_digest/.test(src) && /telemetry_write_failed:routeAI/.test(src) && /telemetry_write_failed:write_gate_verdict/.test(src) && /telemetry_write_failed:weekly_review/.test(src) && /telemetry_write_failed:wo_share_send/.test(src), 'host-job telemetry catches now queue a note');
  ok(/ops_queue_rollback_failed/.test(src) && /ops_queue_review_log_failed/.test(src) && /ops_queue_routine_fire/.test(src), 'ops-queue rollback / review-log / routine-fire failures are reported');
  ok(/owner_onboard_invite_release_failed/.test(src) && /owner_onboard_invite_mark_used_failed/.test(src) && /owner_onboard_admin_sms_failed/.test(src), 'owner onboarding: release / mark-used / admin-SMS failures are reported');
}

console.log(`\ncw5-silent-failures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
