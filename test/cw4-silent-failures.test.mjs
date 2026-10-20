// Fault-injection tests for Phase C batch w4 (Oct 20 2026, no-silent-failures): the swallowed errors in worker.js between the estimate/WO-edit
// handlers and the digest (WO writes, audit/SMS logs, vendor nudge clocks, notification queue, failure-alert + dead-man SMS, scheduler background, recurring templates).
// Extracts the REAL functions from worker.js, FORCES each failure and asserts: (a) it is reported with the right severity, (b) the caller still gets what it got before
// (or now gets the failure where it used to be told "done"), (c) the happy path reports nothing.   Run: node test/cw4-silent-failures.test.mjs
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
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = .*;$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };
console.error = () => {};

// ── fake world ──
let REPORTS, ENSURE_FAIL, SHEETS_FAIL, SHEET_CALLS, SMS_RESULT, SMS_THROW, SETCFG_FAIL, CFG, CONFIG_SET, ADDROW_FAIL, UPDATEROW_FAIL, TEL_FAIL, ALERT_THROW, SHARE_FAIL, TOKEN_FAIL, WO_FIELD_CALLS, TABLE;
const reportFailure = async (env, f) => { REPORTS.push(f); return { ok: true, id: 'x' }; };
const sheetsRequest = async (env, method, path, body) => {
  SHEET_CALLS.push({ method, path, body });
  if (SHEETS_FAIL) throw new Error('Sheets 503 on ' + method + ' ' + path);
  if (method === 'GET') return { values: TABLE[path.replace('/values/', '')] || [['ID', 'WO_ID']] };
  return {};
};
const ensureColumns = async () => { if (ENSURE_FAIL) throw new Error('ensureColumns quota'); };
const ensureTab = async () => {};
const nextSafeId = () => 7;
const sendSMS = async () => { if (SMS_THROW) throw new Error('network down'); return SMS_RESULT; };
const setConfigKey = async (env, { key, value }) => { if (SETCFG_FAIL) throw new Error('Config write 503'); CONFIG_SET.push([key, value]); return { status: 200 }; };
const fetchConfig = async () => CFG;
const addRow = async () => { if (ADDROW_FAIL) throw new Error('addRow 503'); return { ok: true }; };
const updateRow = async () => { if (UPDATEROW_FAIL) throw new Error('updateRow 503'); return { ok: true }; };
const fetchTab = async () => { if (SHEETS_FAIL) throw new Error('read 503'); return []; };
const logTelemetry = async () => { if (TEL_FAIL) throw new Error('telemetry 503'); };
const alertAdminOnFailureStub = async () => { if (ALERT_THROW) throw new Error('alert 503'); return { sent: true }; };
const readTelemetryRows = async () => [];
const failSeverity = (where, message, sev) => sev || 'P2';
const failTrim = (s, n) => String(s).slice(0, n);
const failEnsureTabs = async () => {};
const normalizePhone = (p) => p;
const json = (b, s) => ({ body: b, status: s || 200 });
const idColIndex = () => 0;
const findWO = (rows, id) => rows.find(r => r.ID === id);
const getAccessToken = async () => { if (TOKEN_FAIL) throw new Error('no drive token'); return 'tok'; };
const driveShareAnyone = async () => { if (SHARE_FAIL) throw new Error('drive 403'); };
const schedErrText = (e) => String((e && e.message) || e);

const piecesCore = [constLine('FAIL_EVENTS_TAB'), constLine('FAIL_EVENT_COLS'), constLine('FAIL_PENDING_MAX'), 'const _failPending = [];', grab('failBuildEvent'), grab('softNote'), grab('softFail', 'async'), grab('parseJsonCell'), grab('failSetConfig', 'async')].join('\n');
const pieces = [piecesCore,
  grab('updateWOField', 'async'), grab('queueNotification', 'async'), grab('alertAdminOnFailure', 'async'), grab('alertDebounceOk'), grab('isDeadManSwitchTripped'), grab('checkDeadManSwitch', 'async'),
  grab('recurTargets'), grab('logWOAuditMany', 'async'), constLine('WO_AUDIT_MSG_COLS'), grab('logSMS', 'async'), grab('createVendorNudgeClock', 'async'), grab('resetVendorNudgeClock', 'async'),
  grab('getPricingConfig', 'async'), grab('mqReportFailure', 'async'), grab('callWithFailureAlert', 'async'), grab('logAttachment', 'async'), constLine('NON_SHARE_FILE_TYPES'),
].join('\n');
const names = ['updateWOField', 'queueNotification', 'alertAdminOnFailure', 'checkDeadManSwitch', 'recurTargets', 'logWOAuditMany', 'logSMS', 'createVendorNudgeClock', 'resetVendorNudgeClock', 'getPricingConfig', 'mqReportFailure', 'callWithFailureAlert', 'logAttachment'];
const params = ['reportFailure', 'sheetsRequest', 'ensureColumns', 'ensureTab', 'nextSafeId', 'sendSMS', 'setConfigKey', 'fetchConfig', 'addRow', 'updateRow', 'fetchTab', 'logTelemetry', 'readTelemetryRows', 'failSeverity', 'failTrim', 'failEnsureTabs',
  'normalizePhone', 'json', 'idColIndex', 'findWO', 'getAccessToken', 'driveShareAnyone', 'ensureVendorReqTab', 'next9amET', 'VENDOR_REQ_TAB', 'NOTIF_QUEUE_TAB', 'NOTIF_QUEUE_COLS', '_notifQueueReadyBox'];
let _alertImpl = null;
const W = new Function(...params, 'alertAdminOnFailureOverride',
  pieces.replace('let _notifQueueReady = false;', '') + '\nlet _notifQueueReady = false;\nconst __pending = _failPending;\nreturn { ' + names.join(', ') + ', pending: _failPending, softNote, softFail, parseJsonCell };')(
  reportFailure, sheetsRequest, ensureColumns, ensureTab, nextSafeId, sendSMS, setConfigKey, fetchConfig, addRow, updateRow, fetchTab, logTelemetry, readTelemetryRows, failSeverity, failTrim, failEnsureTabs,
  normalizePhone, json, idColIndex, findWO, getAccessToken, driveShareAnyone, async () => {}, () => new Date(Date.now() + 86400000), 'Vendor_Requests', 'Notification_Queue', ['ID', 'WO_ID'], null, null);

const reset = () => {
  REPORTS = []; ENSURE_FAIL = false; SHEETS_FAIL = false; SHEET_CALLS = []; SMS_RESULT = { sid: 'SM1' }; SMS_THROW = false; SETCFG_FAIL = false; CONFIG_SET = []; ADDROW_FAIL = false; UPDATEROW_FAIL = false; TEL_FAIL = false; ALERT_THROW = false;
  SHARE_FAIL = false; TOKEN_FAIL = false; WO_FIELD_CALLS = []; TABLE = {};
  CFG = { failure_alert_enabled: 'TRUE', admin_phone: '+14105550000', dead_man_switch_enabled: 'TRUE' };
  W.pending.length = 0;
};
const env = {};
const pend = () => W.pending.map(p => p.Where + '|' + p.Severity);
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

console.log('updateWOField (was: catch { /* non-fatal */ })');
reset(); TABLE.Work_Orders = [['ID', 'Current_Estimate'], ['WO-1', '0']];
let r = await W.updateWOField(env, 'WO-1', 'Current_Estimate', '99.00');
ok(r === undefined && REPORTS.length === 0 && SHEET_CALLS.some(c => c.method === 'PUT'), 'happy path: writes the cell, returns undefined as before, reports nothing');
reset(); SHEETS_FAIL = true;
r = await W.updateWOField(env, 'WO-1', 'Current_Estimate', '99.00');
ok(r && r.ok === false && REPORTS.length === 1 && REPORTS[0].where === 'update_wo_field_failed' && REPORTS[0].severity === 'P1' && REPORTS[0].context.ref === 'WO-1', 'a failed WO field write is reported (P1) and handed back as {ok:false}; still never throws', REPORTS);
reset(); TABLE.Work_Orders = [['ID', 'Other'], ['WO-1', '0']];
r = await W.updateWOField(env, 'WO-1', 'Current_Estimate', '1');
ok(r === undefined && REPORTS.length === 0, 'a column that does not exist is still a quiet no-op (unchanged behaviour)');

console.log('\nqueueNotification (the "text is queued" claim)');
reset(); r = await W.queueNotification(env, 'WO-1', 'tenant_schedule', '+1', 'hi', 'iso', {});
ok(r && r.ok === true && REPORTS.length === 0, 'happy path: ok:true, nothing reported');
reset(); SHEETS_FAIL = true; r = await W.queueNotification(env, 'WO-1', 'tenant_schedule', '+1', 'hi', 'iso', {});
ok(r && r.ok === false && REPORTS.length === 1 && REPORTS[0].where === 'queue_notification_failed' && REPORTS[0].severity === 'P0', 'queue write fails: P0 reported and ok:false returned so scheduleWO stops claiming notify_queued', REPORTS);

console.log('\nalertAdminOnFailure (was: sent:true even if the text never left)');
reset(); r = await W.alertAdminOnFailure(env, 'wo_create', 'boom');
ok(r.sent === true && CONFIG_SET.length === 1 && CONFIG_SET[0][0] === 'failure_alert_last_sent_wo_create' && REPORTS.length === 0, 'happy path unchanged: sent, debounce key written, nothing reported');
reset(); SMS_RESULT = { error: 'Twilio HTTP 401' }; r = await W.alertAdminOnFailure(env, 'wo_create', 'boom');
ok(r.sent === false && /401/.test(r.error) && CONFIG_SET.length === 0, 'sendSMS returns an error: not reported as sent, and the debounce key is NOT written (the rollup treats it as already-texted, so writing it would swallow the P0)');
reset(); SMS_THROW = true; r = await W.alertAdminOnFailure(env, 'wo_create', 'boom');
ok(r.sent === false && REPORTS.length === 1 && REPORTS[0].where === 'failure_alert_sms_failed' && REPORTS[0].severity === 'P0', 'sendSMS throws: P0 reported, sent:false', REPORTS);
reset(); SETCFG_FAIL = true; r = await W.alertAdminOnFailure(env, 'wo_create', 'boom');
ok(r.sent === true && REPORTS.length === 1 && REPORTS[0].where === 'failure_alert_debounce_write_failed' && REPORTS[0].severity === 'P1', 'debounce write fails: text still counted as sent, but the write failure is reported (P1)', REPORTS);
reset(); CFG.failure_alert_enabled = 'FALSE'; r = await W.alertAdminOnFailure(env, 'x', 'y');
ok(r.skipped === true && REPORTS.length === 0, 'dormant alerts stay a quiet skip');
reset(); SMS_RESULT = { skipped: true, reason: 'TWILIO_ENABLED not TRUE' }; r = await W.alertAdminOnFailure(env, 'x', 'y');
ok(r.sent === true && REPORTS.length === 0, 'sendSMS skipped by the Twilio kill switch behaves as before (no false alarm)');

console.log('\ncheckDeadManSwitch');
reset(); r = await W.checkDeadManSwitch(env);
ok(r.alerted === true && CONFIG_SET.some(c => c[0] === 'dead_man_switch_last_alert_ts') && REPORTS.length === 0, 'tripped + text sent: alerted:true, debounce written (unchanged)');
reset(); SMS_RESULT = { error: 'Twilio HTTP 500' }; r = await W.checkDeadManSwitch(env);
ok(r.alerted === false && /500/.test(r.sms_error) && CONFIG_SET.length === 0, 'text did not go out: alerted:false with the reason, debounce NOT written so the next sweep retries');
reset(); SMS_THROW = true; r = await W.checkDeadManSwitch(env);
ok(r.alerted === false && REPORTS.some(x => x.where === 'dead_man_switch_sms_failed' && x.severity === 'P0'), 'text throws: P0 reported');
reset(); SETCFG_FAIL = true; r = await W.checkDeadManSwitch(env);
ok(r.alerted === true && REPORTS.some(x => x.where === 'dead_man_switch_debounce_write_failed' && x.severity === 'P1'), 'debounce write fails: reported P1');
reset(); TEL_FAIL = true; r = await W.checkDeadManSwitch(env);
ok(r.alerted === true && pend().includes('telemetry_write_failed:dead_man_switch|P2'), 'the telemetry write failing is noted (P2) and does not change the result');

console.log('\nmqReportFailure / callWithFailureAlert (telemetry + admin alert catches)');
reset(); TEL_FAIL = true; ALERT_THROW = false;
// alertAdminOnFailure inside the extracted world is the real one (reads CFG); make it throw by breaking fetchConfig result
CFG = null;
await W.mqReportFailure(env, '5', 'update did not land');
ok(pend().includes('telemetry_write_failed:message_queue_update|P2') && pend().some(p => p.startsWith('failure_alert_threw:message_queue_update|P0')), 'telemetry write failure -> P2 note; alert helper throwing -> P0 note; function still resolves', pend());
reset(); TEL_FAIL = true; CFG = null;
const thrown = await rejects(W.callWithFailureAlert(env, 'wo_create', '/wo', async () => { throw new Error('original failure'); }));
ok(thrown && thrown.message === 'original failure', 'callWithFailureAlert still rethrows the ORIGINAL error unchanged');
ok(pend().includes('telemetry_write_failed:wo_create|P2') && pend().some(p => p.startsWith('failure_alert_threw:wo_create|P0')), 'and both secondary failures are noted instead of vanishing', pend());
reset(); const okv = await W.callWithFailureAlert(env, 'wo_create', '/wo', async () => 42);
ok(okv === 42 && W.pending.length === 0, 'happy path returns the value, notes nothing');

console.log('\nrecurTargets (Targets cell)');
reset(); ok(JSON.stringify(W.recurTargets({ Targets: '[{"p":"P1","u":"U1"},{"p":"P1","u":"U1"},{"p":"P2"}]' })) === '[{"p":"P1","u":"U1"},{"p":"P2","u":""}]' && W.pending.length === 0, 'valid cell: parsed + de-duplicated, nothing noted');
ok(W.recurTargets({ Targets: '' }).length === 0 && W.recurTargets({}).length === 0 && W.pending.length === 0, 'an empty cell is a legitimately empty list, nothing noted');
ok(W.recurTargets({ Targets: '[{bad json' }).length === 0 && pend().includes('json_cell_corrupt:Recurring_Templates.Targets|P2'), 'a corrupt cell still yields [] but is noted (P2) so a template that stopped generating is visible');
reset(); ok(W.recurTargets({ Targets: '{"not":"an array"}' }).length === 0, 'valid JSON that is not an array -> [] (unchanged)');

console.log('\nlogWOAuditMany / logSMS (audit + SMS log rows)');
reset(); await W.logWOAuditMany(env, [{ woId: 'WO-1', field: 'Status', newValue: 'x' }]);
ok(SHEET_CALLS.some(c => c.method === 'POST') && W.pending.length === 0, 'happy path writes the audit row, notes nothing');
reset(); SHEETS_FAIL = true; await W.logWOAuditMany(env, [{ woId: 'WO-1', field: 'Status', newValue: 'x' }]);
ok(pend().includes('wo_audit_write_failed|P1'), 'audit write fails: never throws into the main operation, but a P1 is queued');
reset(); ENSURE_FAIL = true; await W.logWOAuditMany(env, [{ woId: 'WO-1', channel: 'sms', messageBody: 'hi' }]);
ok(pend().includes('wo_audit_columns_failed|P1'), 'message-audit column setup fails: P1 queued, the row write is still attempted');
reset(); SHEETS_FAIL = true; await W.logSMS(env, 'WO-1', 'tenant', '1', '+1', 'hi');
ok(pend().includes('sms_log_write_failed|P1'), 'SMS_Logs write fails: P1 queued (the SMS itself was already sent)');
reset(); await W.logSMS(env, 'WO-1', 'tenant', '1', '+1', 'hi'); ok(W.pending.length === 0, 'logSMS happy path notes nothing');

console.log('\nvendor nudge clock');
reset(); ADDROW_FAIL = true; await W.createVendorNudgeClock(env, 'WO-1', 'V-1');
ok(REPORTS.length === 1 && REPORTS[0].where === 'vendor_nudge_clock_create_failed' && REPORTS[0].severity === 'P1', 'clock cannot be created: P1 reported (vendor would never be nudged); assignment is not failed');
reset(); await W.createVendorNudgeClock(env, 'WO-1', 'V-1'); ok(REPORTS.length === 0, 'happy path reports nothing');
reset(); SHEETS_FAIL = true; await W.resetVendorNudgeClock(env, 'WO-1', 'V-1');
ok(REPORTS.some(x => x.where === 'vendor_nudge_clock_reset_failed' && x.severity === 'P1'), 'reset fails: P1 reported');

console.log('\ngetPricingConfig');
reset(); ok(JSON.stringify(await W.getPricingConfig({ PRICING_CONFIG: '{"tiers":[]}' })) === '{"tiers":[]}' && W.pending.length === 0, 'valid secret: used, nothing noted');
reset(); CFG = { pricing_config: '{"adminFee":5}' };
ok((await W.getPricingConfig({ PRICING_CONFIG: '{oops' })).adminFee === 5 && pend().includes('pricing_config_secret_invalid|P1'), 'corrupt secret: falls back to the sheet row exactly as before AND notes it (P1)');
reset(); CFG = { pricing_config: 'nope' };
ok((await W.getPricingConfig({})) === null && pend().includes('pricing_config_sheet_invalid|P1'), 'corrupt sheet row: pricing stays dormant (null) but it is noted (P1)');
reset(); CFG = {}; ok((await W.getPricingConfig({})) === null && W.pending.length === 0, 'simply not configured is not a failure');

console.log('\nlogAttachment');
reset(); let a = await W.logAttachment(env, { wo_id: 'WO-1', file_id: 'f1', file_type: 'photo', addon_item: '2' });
ok(a.body.success === true && !a.body.failure_warnings && REPORTS.length === 0, 'happy path response is exactly {success:true}');
reset(); ENSURE_FAIL = true; a = await W.logAttachment(env, { wo_id: 'WO-1', file_id: 'f1', file_type: 'receipt', addon_item: '2' });
ok(a.body.success === true && a.body.failure_warnings && a.body.failure_warnings.length === 1 && REPORTS[0].where === 'log_attachment_addon_column' && REPORTS[0].severity === 'P1', 'Addon_Item column setup fails: the upload still succeeds, P1 reported, response carries a warning');
reset(); SHARE_FAIL = true; a = await W.logAttachment(env, { wo_id: 'WO-1', file_id: 'f1', file_type: 'photo' });
ok(a.body.success === true && /may not open/.test(a.body.failure_warnings[0]) && REPORTS[0].where === 'log_attachment_share_failed' && REPORTS[0].severity === 'P1', 'Drive share fails: P1 reported and the response says the file may not open');
reset(); TOKEN_FAIL = true; a = await W.logAttachment(env, { wo_id: 'WO-1', file_id: 'f1', file_type: 'photo' });
ok(REPORTS.some(x => x.where === 'log_attachment_share_failed'), 'Drive token failure is reported the same way');

console.log('\ngrep: converted sites no longer contain the swallow');
const gone = [
  "try { await updateWOField(env, woId, 'Current_Estimate', subtotal.toFixed(2)); } catch(e) {}",
  "try { await ensureColumns(env, 'Estimates', ['Change_Reason_EN']); row.Change_Reason_EN = changeReasonEn; } catch (_) {}",
  "try { await ensureColumns(env, 'Work_Orders', ['Managed_By']); } catch (_) {}",
  "catch (e) { /* non-fatal — note already saved */ }",
  "catch(e) { /* non-fatal — note already saved */ }",
  "try { await ensureColumns(env, 'Attachments', ['Addon_Item']); } catch(_){}",
  "catch(e){/* non-fatal */}",
  "catch (e) { /* non-fatal — assignment itself already succeeded */ }",
  "try { await ensureColumns(env, 'Wishlist', ['Status']); } catch (e) { /* non-fatal — add still works */ }",
  "try { await sendSMS(env, cfg.admin_phone, msg); } catch (_) {}",
  "try { await setConfigKey(env, { key, value: new Date().toISOString() }); } catch (_) {}",
  "catch(e) { /* non-fatal — SMS already sent, logging is secondary */ }",
  "catch(e) { /* never break main operation */ }",
  "try { skips = JSON.parse(tpl.Last_Skips || '{}') || {}; } catch (_) {}",
  "if (fq && !tq) { try { await updateRow(env, 'Owners', toId, { QBO_Customer_ID: fq }); } catch (e) {} }",
  "catch (e) { /* fail open: English goes out */ }",
  "fetchTab(env,'Work_Orders').catch(()=>[]),\n    fetchTab(env,'Vendor_Bills').catch(()=>[]),",
];
for (const g of gone) ok(!src.includes(g), 'removed: ' + g.replace(/\s+/g, ' ').slice(0, 90));
const telemetryEmpty = src.split('\n').filter(l => /try \{ await logTelemetry\(/.test(l) && /catch\s*\(\s*_\s*\)\s*\{\s*\}\s*(\}\s*)?$/.test(l.trim()));
ok(telemetryEmpty.length === 0 || telemetryEmpty.every(l => !/(turnover_|admin_share_attachments|wo_schedule|message_template_refresh|message_queue_update|proposal_sms_skip_check_failed|dead_man_switch)/.test(l)), 'no one-line logTelemetry(...) catch(_){} left on this batch\'s telemetry sites', telemetryEmpty.map(l => l.slice(0, 80)));
ok(/ctx\.waitUntil\(work\.catch\(\(e\) => \{ console\.error\('scheduler: background completion of ' \+ job\.name \+ ' failed:', schedErrText\(e\)\); return softFail\(env, 'scheduler_background_failed:'/.test(src), 'scheduler background completion failure is awaited into the ledger (P0) via waitUntil, not just console');
ok(/notifyQueued = !\(qn && qn\.ok === false\)/.test(src), 'scheduleWO no longer claims notify_queued when the queue write failed');
ok(/catch \(e\) \{ await softFail\(env, 'estimate_approval_stage_update', e, 'P1'/.test(src) && /failure_warnings: estWarnings/.test(src), 'estimate POST reports a failed stage/estimate write and returns warnings');
ok(/door_watchdog_abort_failed/.test(src) && /silent-ok: the Promise\.race below returns this same rejection/.test(src), 'door watchdog: abort failure is noted; the race-loser catch carries a reviewed silent-ok');

console.log(`\ncw4-silent-failures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
