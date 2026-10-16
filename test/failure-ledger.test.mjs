// Offline tests for the failure ledger (no-silent-failures phase A1, Oct 16 2026).
// Extracts the REAL code between FAILURE-LEDGER-BEGIN/END out of worker.js and runs it against an in-memory fake of Sheets, so the test cannot drift from what ships.
// Run: node test/failure-ledger.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
function grab(name, kind = 'function') {
  const sig = (kind === 'async' ? 'async function ' : 'function ') + name + '(';
  const start = src.indexOf(sig); if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const bi = src.indexOf('// ═══ FAILURE-LEDGER-BEGIN'), be = src.indexOf('// ═══ FAILURE-LEDGER-END');
if (bi < 0 || be < bi) throw new Error('ledger block markers missing');
const block = src.slice(bi, be);

// ── fake world ──
let SHEET, SMS, SMS_RESULT, OVERDUE, FAIL_APPEND, ERR;
const colIdx = L => L.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
async function sheetsRequest(env, method, path, body) {
  let m;
  if (method === 'GET' && (m = /^\/values\/([^!:?]+)(?:!(.+))?$/.exec(path))) {
    if (!SHEET[m[1]]) { const e = new Error('Unable to parse range: ' + m[1]); throw e; }
    const rows = SHEET[m[1]]; let from = 0, to;
    if (m[2]) {
      let r;
      if ((r = /^A(\d+):[A-Z]+(\d+)?$/.exec(m[2]))) { from = parseInt(r[1], 10) - 1; to = r[2] ? parseInt(r[2], 10) : undefined; }
      else if ((r = /^1:1$/.exec(m[2]))) { return { values: rows.slice(0, 1).map(x => x.slice()) }; }
      else if ((r = /^([A-Z]+)2:([A-Z]+)$/.exec(m[2]))) { const ci = colIdx(r[1]); return { values: rows.slice(1).map(x => [x[ci] === undefined ? '' : x[ci]]) }; }
      else throw new Error('unhandled range ' + m[2]);
    }
    return { values: rows.slice(from, to).map(r => r.slice()) };
  }
  if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) {
    if (FAIL_APPEND) throw new Error('Sheets 503');
    const t = SHEET[m[1]] || (SHEET[m[1]] = []); const first = t.length + 1; for (const r of body.values) t.push(r.slice());
    return { updates: { updatedRange: `${m[1]}!A${first}:Z${first + body.values.length - 1}`, updatedRows: body.values.length } };
  }
  if (method === 'POST' && path === '/values:batchUpdate') {
    let n = 0; for (const u of body.data) { const mm = /^([^!]+)!([A-Z]+)(\d+)(?::([A-Z]+)\d+)?$/.exec(u.range); const t = SHEET[mm[1]]; const r = +mm[3] - 1; const c0 = colIdx(mm[2]); u.values[0].forEach((v, j) => { t[r][c0 + j] = v; n++; }); }
    return { totalUpdatedCells: n };
  }
  throw new Error('unhandled ' + method + ' ' + path);
}
const ensureTab = async (env, name, headers) => { if (!SHEET[name]) SHEET[name] = [headers.slice()]; };
const isMissingTabError = e => /Unable to parse range/.test(String(e && e.message));
const json = (o, s) => ({ body: o, status: s || 200 });
const sendSMS = async (env, to, text) => { SMS.push({ to, text }); return SMS_RESULT; };
const setConfigKey = async (env, { key, value }) => { const t = SHEET.Config; const r = t.find(x => x[0] === key); if (r) r[1] = value; else t.push([key, value]); return json({ success: true }); };
const schedReadConfigRows = async () => SHEET.Config;
const schedParseState = () => ({ state: {} });
const SCHED_TOKEN_MIN_LEN = 24, SCHED_TOKEN_KEY = 'Scheduler_Token';
const schedEffective = () => ({ jobs: [] });
const schedStatus = () => ({ overdue: OVERDUE.map(o => o.name), jobs: Object.fromEntries(OVERDUE.map(o => [o.name, { overdue_reason: o.reason }])), tick_age_min: 3 });
const SCHED_STATE_KEY = 'Scheduler_State';
const OPS_QUEUE_TAB = 'Ops_Build_Queue', OPS_QUEUE_COLS = ['ID', 'Timestamp', 'Title', 'Rank', 'Problem', 'Impact', 'Effort', 'Tag', 'First_Step', 'Review_TS', 'Status', 'Approved_By', 'Risk_Class', 'Lens', 'Requires_Spend', 'Spend_Note', 'Workaround'];
let TWILIO, QUEUE_FAIL;
const fetch = async (url) => { if (TWILIO instanceof Error) throw TWILIO; return { ok: TWILIO.status === undefined ? true : TWILIO.status < 400, status: TWILIO.status || 200, text: async () => JSON.stringify(TWILIO.body) }; };
const ensureColumns = async () => {};
const addRow = async (env, tab, obj) => { if (QUEUE_FAIL) return { status: 500, clone() { return this; }, async json() { return {}; } }; const t = SHEET[tab] || (SHEET[tab] = [OPS_QUEUE_COLS.slice()]); const id = String(t.length); t.push(OPS_QUEUE_COLS.map(c => c === 'ID' ? id : (obj[c] === undefined ? '' : String(obj[c])))); return { status: 200, clone() { return this; }, async json() { return { id }; } }; };
const pieces = [grab('schedTokenOk'), grab('schedFindRow'), grab('schedCell'), grab('buildScoutQueueRow'), grab('col'), grab('configFromValues'), grab('appendedRowNumber'), grab('schedEtParts')].join('\n');
const L = new Function('SCHED_TOKEN_MIN_LEN', 'SCHED_TOKEN_KEY', 'MSG_QUEUE_TAB', 'fetch', 'ensureColumns', 'addRow', 'OPS_QUEUE_TAB', 'OPS_QUEUE_COLS', 'sheetsRequest', 'ensureTab', 'isMissingTabError', 'json', 'sendSMS', 'setConfigKey', 'schedReadConfigRows', 'schedParseState', 'schedEffective', 'schedStatus', 'SCHED_STATE_KEY',
  pieces + '\n' + block + '\nreturn { failSevRank, failNormalizeMessage, failFingerprint, failSeverity, failBuildEvent, failRollupPlan, failFormatP0Sms, failDigestPlan, failLegacyAlerted, reportFailure, failRollupRun, failOpenList, failUpdate, failReportEndpoint, failConditions, failInvariantItems, failDuplicateIds, failMessageQueueStats, failInvariantConditions, failQueuePlan, failQueueItem, __reset: () => { _failTabsReady = false; for (const w of [_failWin, _failAnonWin]) { w.start = 0; w.n = 0; w.dropped = 0; } }, FAIL_EVENT_COLS, FAIL_LEDGER_COLS, FAIL_P0_REPEAT_MS, FAIL_P0_REMIND_MS };')(
  SCHED_TOKEN_MIN_LEN, SCHED_TOKEN_KEY, 'Message_Queue', fetch, ensureColumns, addRow, OPS_QUEUE_TAB, OPS_QUEUE_COLS, sheetsRequest, ensureTab, isMissingTabError, json, sendSMS, setConfigKey, schedReadConfigRows, schedParseState, schedEffective, schedStatus, SCHED_STATE_KEY);
const reset = (cfg) => {
  SHEET = { Config: [['failure_alert_enabled', 'TRUE'], ['admin_phone', '+15550001111'], ['dead_man_switch_enabled', 'TRUE']].concat(cfg || []) };
  L.__reset(); TWILIO = new Error('no twilio'); QUEUE_FAIL = false; SMS = []; SMS_RESULT = { sid: 'SM1' }; OVERDUE = []; FAIL_APPEND = false; ERR = [];
};
const origErr = console.error; console.error = (...a) => { ERR.push(a.join(' ')); };
const T0 = Date.UTC(2026, 9, 16, 12, 5);      // 8:05 AM ET
const env = {};

console.log('failure ledger — offline tests\n');
console.log('Pure helpers');
ok(L.failFingerprint('hub', 'scheduler_job', 'deposit_paid: ok:false [] 12') === L.failFingerprint('hub', 'scheduler_job', 'deposit_paid: ok:false [] 97'), 'the same failure with different numbers has one fingerprint');
ok(L.failFingerprint('hub', 'a', 'x') !== L.failFingerprint('hub', 'b', 'x'), 'different places do not merge');
ok(L.failSeverity('receipt_parse', 'Your credit balance is too low to access the Anthropic API') === 'P0', 'API credits exhausted is P0 even though receipt parsing is normally P2');
ok(L.failSeverity('receipt_parse', 'could not read the PDF') === 'P2', 'ordinary parse failures are P2');
ok(L.failSeverity('door_watchdog', 'problem_alerted: key=problem:lock_set via=sms') === 'P2', 'door watchdog (already texted) is P2 on screen');
ok(L.failSeverity('scheduler_job', 'deposit_paid: ok:false []') === 'P0', 'scheduler job failures are P0');
ok(L.failSeverity('wo_status', "Quota exceeded for quota metric 'Read requests'") === 'P1', 'Sheets quota errors are P1');
ok(L.failSeverity('anything', 'x', 'P1') === 'P1' && L.failSeverity('door_watchdog', 'credit balance', 'P2') === 'P2', 'an explicit severity always wins');
ok(L.failSeverity('mystery', 'mystery') === 'P2', 'unknown defaults to P2 (visible, not noisy)');
let ev = L.failBuildEvent({ where: 'x', err: new Error('boom') }, 5, 'ab12');
ok(ev.Message === 'boom' && ev.ID === '5-ab12' && ev.System === 'hub', 'an Error object becomes its message');
ev = L.failBuildEvent(undefined, 5, 'ab12'); ok(ev.Message === '(no details)' && ev.Where === 'unknown', 'a completely empty report still produces a row');
ev = L.failBuildEvent({ where: 'x', message: 'a\nb'.repeat(500), system: 'Bad Sys!!' }, 5, 'ab12'); ok(ev.Message.length <= 400 && !/\n/.test(ev.Message) && ev.System === 'badsys', 'long/multiline messages and odd system names are cleaned');

console.log('\nreportFailure never throws, never stays silent');
reset();
let r = await L.reportFailure(env, { where: 'wo_status', message: 'Sheets 500' });
ok(r.ok && SHEET.Failure_Events.length === 2 && SHEET.Failure_Events[1][4] === 'wo_status', 'a report appends one event row (tab self-provisions)');
reset(); FAIL_APPEND = true;
r = await L.reportFailure(env, { where: 'wo_status', message: 'x' });
ok(r.ok === false && ERR.some(e => /COULD NOT BE SAVED/.test(e)), 'when the sheet is down it returns ok:false and console.errors the full report (no throw)');
reset();
const bad = {}; bad.self = bad;
r = await L.reportFailure(env, { where: 'x', message: 'm', context: bad });
ok(r.ok === true, 'an unserialisable context cannot break reporting');
reset();
let dropped = 0; for (let i = 0; i < 70; i++) { const q = await L.reportFailure(env, { where: 'loop', message: 'again' }); if (q.dropped) dropped++; }
ok(dropped === 10 && SHEET.Failure_Events.length === 61, 'a runaway loop is capped at 60 events a minute and the rest are counted as dropped');
r = await L.reportFailure(env, { where: 'loop', message: 'again' });
ok(r.dropped === true, 'still capped inside the same minute');

console.log('\nRollup plan (pure)');
const evt = (id, where, msg, sev, ts) => ({ ID: id, Timestamp: ts || '2026-10-16T12:00:00.000Z', System: 'hub', Source: 'worker', Where: where, Ref: '', Severity: sev || 'P0', Message: msg, Context: '' });
const plan = (events, ledger, extra) => L.failRollupPlan(Object.assign({ events, ledger: ledger || [], conditions: [], nowMs: T0 }, extra || {}));
let p = plan([evt('100-a', 'sms', 'twilio down', 'P0'), evt('101-b', 'sms', 'twilio down', 'P0')]);
ok(p.created.length === 1 && p.created[0].Count === 2 && p.created[0].Status === 'open', 'two identical events become ONE ledger row with count 2');
ok(p.sms.length === 1, 'a new open P0 is texted');
const row = Object.assign({}, p.created[0], { _row: 2 });
p = plan([evt('100-a', 'sms', 'twilio down'), evt('101-b', 'sms', 'twilio down')], [row]);
ok(p.created.length === 0 && p.updates.length === 0, 'events already counted (ID <= Last_Event_ID) change nothing (idempotent)');
p = plan([evt('102-c', 'sms', 'twilio down')], [row]);
ok(p.updates.length === 1 && p.updates[0].Count === 3, 'a new event bumps the count');
p = plan([evt('102-c', 'sms', 'twilio down', 'P0')], [Object.assign({}, row, { Severity: 'P2' })]);
ok(p.updates[0].Severity === 'P0', 'severity only ever escalates');
p = plan([evt('103-d', 'sms', 'twilio down')], [Object.assign({}, row, { Status: 'fixed', Fixed_In: 'PR 340' })]);
ok(p.updates[0].Status === 'open' && /reopened/.test(p.updates[0].Notes) && p.updates[0].Count === 1 && p.sms.length === 1, 'a recurrence after "fixed" reopens, notes the build, and alerts again');
p = plan([evt('103-d', 'sms', 'twilio down')], [Object.assign({}, row, { Status: 'wontfix' })]);
ok(p.updates[0].Status === 'wontfix' && p.updates[0].Count === 3 && p.sms.length === 0, 'won\'t-fix keeps counting but never alerts');
p = plan([], [Object.assign({}, row, { Status: 'acknowledged' })]);
ok(p.sms.length === 0, 'acknowledged problems are not re-texted');
const notified = Object.assign({}, row, { Notified_At: new Date(T0 - 3600000).toISOString(), Notified_Count: 2 });
p = plan([], [notified]); ok(p.sms.length === 0, 'texted an hour ago and nothing new: quiet');
p = plan([], [Object.assign({}, notified, { Count: 5 })]); ok(p.sms.length === 0, 'grown but texted only an hour ago: still quiet (6h repeat guard)');
p = plan([], [Object.assign({}, notified, { Count: 5, Notified_At: new Date(T0 - 7 * 3600000).toISOString() })]); ok(p.sms.length === 1, 'grown and texted 7 h ago: texted again');
p = plan([], [Object.assign({}, notified, { Notified_At: new Date(T0 - 25 * 3600000).toISOString() })]); ok(p.sms.length === 1, 'still open and unacknowledged after 25 h: daily reminder');
p = plan([evt('100-a', 'scheduler_job', 'x')], [], { legacyAlerted: (w) => w === 'scheduler_job' });
ok(p.sms.length === 0 && p.quiet.length === 1, 'already texted by the older alert path: recorded as notified, not texted twice');
p = plan([evt('100-a', 'x', 'p1 thing', 'P1')]); ok(p.sms.length === 0 && p.created[0].Severity === 'P1', 'P1 is never texted immediately');
// conditions
p = plan([], [], { conditions: [{ key: 'overdue:daily_receipts', where: 'scheduler:daily_receipts', severity: 'P0', message: 'overdue' }] });
ok(p.created.length === 1 && p.created[0].Source === 'condition' && p.sms.length === 1, 'an overdue-job condition creates a P0 row and texts');
const crow = Object.assign({}, p.created[0], { _row: 3, Notified_At: new Date(T0).toISOString(), Notified_Count: 1 });
p = plan([], [crow], { conditions: [{ key: 'overdue:daily_receipts', where: 'scheduler:daily_receipts', severity: 'P0', message: 'still overdue' }] });
ok(p.updates.length === 1 && p.updates[0].Count === 1 && p.updates[0].Message === 'still overdue' && p.sms.length === 0, 'a persisting condition refreshes Last_Seen without inflating the count or re-texting');
p = plan([], [crow], { conditions: [] });
ok(p.updates[0].Status === 'fixed' && /cleared/.test(p.updates[0].Notes), 'a condition that stops being true clears itself');

console.log('\nTexts');
ok(/Hub problem \(3x\)/.test(L.failFormatP0Sms([{ Count: 3, Where: 'scheduler_job', Message: 'deposit' }])), 'single-problem text includes the count');
const multi = L.failFormatP0Sms([1, 2, 3, 4, 5].map(i => ({ Count: 1, Where: 'w' + i, Message: 'm' + i })));
ok(/5 urgent Hub problems/.test(multi) && /\+2 more/.test(multi) && multi.length < 320, 'many problems are consolidated into one short text');
let dg = L.failDigestPlan([{ Status: 'open', Severity: 'P1', Where: 'selftest', Message: '37/39', Last_Seen: new Date(T0 - 3600000).toISOString() }], T0, '');
ok(dg && /1 Hub problem/.test(dg.text) && dg.dateKey === '2026-10-16', 'morning digest lists recent P1s');
ok(L.failDigestPlan([], T0, '2026-10-16') === null, 'one digest per ET day');
ok(L.failDigestPlan([], Date.UTC(2026, 9, 16, 11, 0), '') === null, 'no digest before 8 AM ET');
dg = L.failDigestPlan([{ Status: 'open', Severity: 'P2', Where: 'a', Message: 'b', Last_Seen: new Date(T0).toISOString() }], Date.UTC(2026, 9, 19, 12, 5), '');
ok(dg && /1 minor open/.test(dg.text), 'Mondays also mention minor problems');

console.log('\nFull rollup against the fake sheet');
reset();
await L.reportFailure(env, { where: 'scheduler_job', message: 'deposit_paid: ok:false []' });
await L.reportFailure(env, { where: 'scheduler_job', message: 'deposit_paid: ok:false []' });
await L.reportFailure(env, { where: 'receipt_parse', message: 'Your credit balance is too low to access the Anthropic API.' });
let res = await L.failRollupRun(env, { nowMs: T0 });
ok(res.ok && res.events_in === 3 && res.new_rows >= 2, 'rollup reads the events and writes ledger rows');
const led = SHEET.Failures.slice(1);
ok(led.some(x => x[4] === 'scheduler_job' && x[9] === '2'), 'the two scheduler events are one row with count 2');
ok(led.some(x => x[4] === 'receipt_parse' && x[2] === 'P0'), 'the credit-balance failure is a P0 row');
ok(SMS.length >= 1 && /urgent Hub problems|Hub problem/.test(SMS[0].text) && SMS[0].to === '+15550001111', 'Brett was texted once, consolidated');
ok(SHEET.Config.find(x => x[0] === 'failure_rollup_cursor') && /^\d+:/.test(SHEET.Config.find(x => x[0] === 'failure_rollup_cursor')[1]), 'the cursor was saved');
ok(led.filter(x => x[2] === 'P0' && x[10] === 'open').every(x => x[11]), 'texted rows are marked with Notified_At');
const smsAfter1 = SMS.length;
res = await L.failRollupRun(env, { nowMs: T0 + 15 * 60000 });
ok(res.events_in === 0 && SMS.length === smsAfter1, 'a second run with nothing new reads nothing and texts nothing');
await L.reportFailure(env, { where: 'scheduler_job', message: 'deposit_paid: ok:false []' });
res = await L.failRollupRun(env, { nowMs: T0 + 30 * 60000 });
ok(res.events_in === 1 && SHEET.Failures.slice(1).find(x => x[4] === 'scheduler_job')[9] === '3' && SMS.length === smsAfter1, 'a new occurrence bumps the count without re-texting inside 6 h');
// alerts off: recorded, not texted, and the condition tells Brett why
reset([]); SHEET.Config[0][1] = 'FALSE';
await L.reportFailure(env, { where: 'scheduler_job', message: 'boom' });
res = await L.failRollupRun(env, { nowMs: T0 });
ok(SMS.length === 0 && res.alerts_on === false, 'alerts switched off: nothing texted');
ok(SHEET.Failures.slice(1).some(x => x[1] === 'cond|alerts_off' && x[2] === 'P0'), '... but a P0 "alerts are OFF" row explains why on screen');
SHEET.Config[0][1] = 'TRUE';
res = await L.failRollupRun(env, { nowMs: T0 + 900000 });
ok(SMS.length === 1, 'when Brett switches alerts on, the backlog of urgent problems is texted (once)');
ok(SHEET.Failures.slice(1).find(x => x[1] === 'cond|alerts_off')[10] === 'fixed', 'and the "alerts are OFF" row clears itself');
// SMS failure retried
reset(); SMS_RESULT = { code: 21608, message: 'unverified' };
await L.reportFailure(env, { where: 'scheduler_job', message: 'boom' });
res = await L.failRollupRun(env, { nowMs: T0 });
ok(res.ok === false && res.errors.some(e => e.step === 'notify_p0') && !SHEET.Failures.slice(1).find(x => x[4] === 'scheduler_job')[11], 'a failed alert text is reported as a job error and the row stays un-notified');
SMS_RESULT = { sid: 'SM2' }; res = await L.failRollupRun(env, { nowMs: T0 + 900000 });
ok(SMS.length === 2 && SHEET.Failures.slice(1).find(x => x[4] === 'scheduler_job')[11], 'next run retries the text and marks it');
// overdue scheduler job
reset(); OVERDUE = [{ name: 'daily_receipts', reason: 'has not run for 2026-10-16' }];
res = await L.failRollupRun(env, { nowMs: T0 });
ok(SHEET.Failures.slice(1).some(x => x[1] === 'cond|overdue:daily_receipts' && x[2] === 'P0'), 'an overdue scheduler job becomes a P0 ledger row');
// morning digest
reset(); await L.reportFailure(env, { where: 'selftest', message: '37/39 passed' });
res = await L.failRollupRun(env, { nowMs: T0 });
ok(SMS.some(s => /🟠/.test(s.text)) && SHEET.Config.find(x => x[0] === 'failure_digest_last_date')[1] === '2026-10-16', 'P1s go out in the 8 AM digest and the date is recorded');
// header drift and bad cursor
reset(); await L.reportFailure(env, { where: 'x', message: 'y' }); SHEET.Failures[0][0] = 'Oops';
let thrown = ''; try { await L.failRollupRun(env, { nowMs: T0 }); } catch (e) { thrown = e.message; }
ok(/header row changed/.test(thrown), 'a changed ledger header makes the job fail loudly instead of writing to the wrong columns');
reset(); await L.reportFailure(env, { where: 'x', message: 'y' }); SHEET.Config.push(['failure_rollup_cursor', '9:nope']);
res = await L.failRollupRun(env, { nowMs: T0 });
ok(res.events_in === 1, 'a cursor that no longer matches the sheet falls back to a full read');

console.log('\nEndpoints');
reset(); await L.reportFailure(env, { where: 'a', message: 'one', severity: 'P2' }); await L.reportFailure(env, { where: 'b', message: 'two', severity: 'P0' });
await L.failRollupRun(env, { nowMs: T0 });
let o = await L.failOpenList(env, new URL('https://x/failures/open'));
ok(o.status === 200 && o.body.ok && o.body.counts.P0 >= 1 && o.body.failures[0].Severity === 'P0' && !('_row' in o.body.failures[0]), 'open list is sorted worst first, counts included, no internal fields');
const id0 = o.body.failures.find(f => f.Where === 'a').ID;
let u = await L.failUpdate(env, { id: id0, status: 'acknowledged', notes: 'looking' });
ok(u.status === 200 && u.body.failure.Status === 'acknowledged' && /looking/.test(u.body.failure.Notes), 'acknowledge saves and reads back');
ok((await L.failUpdate(env, { id: id0, status: 'bogus' })).status === 400, 'bad status refused');
ok((await L.failUpdate(env, { id: 'nope', status: 'fixed' })).status === 404, 'unknown id is a 404, not a silent no-op');
const mk = (tok, body) => ({ request: { headers: { get: (h) => (h === 'X-Auth-Token' ? tok : h === 'User-Agent' ? 'UA' : '') } }, body });
env.WORKER_SECRET = 'adm'; env.FAILURE_INGEST_TOKEN = 'ing';
reset();
let a = mk('', { system: 'barrelco', where: 'checkout', message: 'boom', severity: 'P0' });
r = await L.failReportEndpoint(env, a.request, a.body);
ok(r.status === 200 && SHEET.Failure_Events[1][2] === 'page:barrelco' && SHEET.Failure_Events[1][6] === 'P2', 'an anonymous page report is forced to P2 and tagged page:');
a = mk('ing', { system: 'barrelco', where: 'checkout', message: 'boom', severity: 'P0' });
r = await L.failReportEndpoint(env, a.request, a.body);
ok(r.status === 200 && SHEET.Failure_Events[2][2] === 'barrelco' && SHEET.Failure_Events[2][6] === 'P0', 'a caller with the ingest token may set system and severity');
a = mk('', { where: 'x' }); r = await L.failReportEndpoint(env, a.request, a.body); ok(r.status === 400, 'a report without a message is refused');
FAIL_APPEND = true; a = mk('', { where: 'x', message: 'm' }); r = await L.failReportEndpoint(env, a.request, a.body); ok(r.status === 503, 'if the report could not be saved the caller is told (503)');
FAIL_APPEND = false;
reset(); for (let i = 0; i < 25; i++) { a = mk('', { where: 'spam', message: 'm' + i }); r = await L.failReportEndpoint(env, a.request, a.body); }
ok(r.status === 429, 'anonymous spam is rate limited (429)');
reset(); r = await L.reportFailure(env, { where: 'real', message: 'important' }); ok(r.ok, 'real reports still get through while anonymous spam is capped');

console.log('\nA3a: daily checks');
ok(JSON.stringify(L.failDuplicateIds(['1', '2', '2', ' 3', '3', '', '4'])) === '["2","3"]', 'duplicate ids found, blanks ignored');
const NOW = T0;
let st = L.failMessageQueueStats([
  { Status: 'pending', Active: 'TRUE', Send_After: new Date(NOW - 8 * 3600000).toISOString() },
  { Status: 'pending', Active: 'TRUE', Send_After: new Date(NOW - 1 * 3600000).toISOString() },
  { Status: 'pending', Active: 'FALSE', Send_After: new Date(NOW - 9 * 3600000).toISOString() },
  { Status: 'pending', Active: 'TRUE', Send_After: '' },
  { Status: 'failed', Created_Date: new Date(NOW - 2 * 3600000).toISOString() },
  { Status: 'failed', Created_Date: new Date(NOW - 50 * 3600000).toISOString() },
  { Status: 'sent' }], NOW);
ok(st.stuck === 1 && st.oldest_hours === 8 && st.failed24 === 1, 'stuck = active pending text >6 h past its send time; failed counted for 24 h only; held/inactive/old rows ignored');
let it = L.failInvariantItems({ dup: [{ tab: 'Message_Queue', ids: ['298'] }, { tab: 'Work_Orders', ids: [] }], mq: { stuck: 2, oldest_hours: 9, failed24: 0 }, twilio: { balance: 8.5 }, errors: [{ check: 'message_queue', error: 'boom' }] });
ok(it.length === 4 && it.find(x => x.key === 'inv:dup:Message_Queue').severity === 'P1' && it.find(x => x.key === 'inv:twilio_balance').severity === 'P0' && it.find(x => x.key === 'inv:check_failed:message_queue'), 'items: duplicates P1, Twilio under $10 P0, and a check that could not run is itself an item');
ok(L.failInvariantItems({ twilio: { balance: 18 } })[0].severity === 'P1' && L.failInvariantItems({ twilio: { balance: 80 } }).length === 0, 'Twilio $10-$25 is P1; healthy balance raises nothing');
// full run against fake sheet
reset();
SHEET.Message_Queue = [['ID', 'Status', 'Active', 'Send_After', 'Created_Date'], ['1', 'pending', 'TRUE', new Date(T0 - 9 * 3600000).toISOString(), ''], ['2', 'sent', 'TRUE', '', ''], ['2', 'sent', 'TRUE', '', '']];
SHEET.Work_Orders = [['Vendor_Needs_Access', 'ID'], ['', 'WO-1'], ['', 'WO-2']];
const envT = { TWILIO_SID: 'AC1', TWILIO_API_SID: 'SK1', TWILIO_API_KEY: 'k' }; TWILIO = { body: { balance: '7.10' } };
res = await L.failRollupRun(envT, { nowMs: T0 });
const rowsA = SHEET.Failures.slice(1).map(x => x[1]);
ok(rowsA.includes('cond|inv:dup:Message_Queue') && rowsA.includes('cond|inv:mq_stuck') && rowsA.includes('cond|inv:twilio_balance') && !rowsA.includes('cond|inv:dup:Work_Orders'), 'the daily checks put duplicate IDs, a stuck text and a low Twilio balance on the ledger (WO header is not column A: found by name)');
ok(SMS.length >= 1 && /Twilio balance|Hub problem/.test(SMS[0].text), 'a low Twilio balance (P0) texts');
const storedCfg = SHEET.Config.find(x => x[0] === 'failure_invariants_json');
ok(storedCfg && JSON.parse(storedCfg[1]).items.length >= 3, 'the result is stored in Config so the next 15-minute runs do not re-read every tab');
const reads = []; const origSR = sheetsRequest;
SHEET.Message_Queue.splice(2, 1);                                // fix the duplicate; the stored result is still fresh, so nothing changes yet
res = await L.failRollupRun(envT, { nowMs: T0 + 900000 });
ok(SHEET.Failures.slice(1).find(x => x[1] === 'cond|inv:dup:Message_Queue')[10] === 'open', 'within 20 h the stored result is used (no re-read)');
res = await L.failRollupRun(envT, { nowMs: T0 + 21 * 3600000 });
ok(SHEET.Failures.slice(1).find(x => x[1] === 'cond|inv:dup:Message_Queue')[10] === 'fixed', 'after 20 h the checks re-run and a repaired problem clears itself');
reset(); TWILIO = new Error('Twilio down');
res = await L.failRollupRun(envT, { nowMs: T0 });
ok(SHEET.Failures.slice(1).some(x => x[1] === 'cond|inv:check_failed:twilio_balance' && x[2] === 'P1'), 'if the Twilio check cannot run, that is itself a visible problem (never silent)');
reset(); TWILIO = { body: { balance: '50' } };
const storedBad = JSON.parse(JSON.stringify([['failure_invariants_json', '{not json']])); SHEET.Config.push(storedBad[0]);
res = await L.failRollupRun(envT, { nowMs: T0 });
ok(res.ok !== undefined && !SHEET.Failures.slice(1).some(x => /inv:run_failed/.test(x[1])), 'a corrupt stored result is simply recomputed');

console.log('\nA3a: auto-queue of problems left open > 24 h');
const lrow = (o) => Object.assign({ ID: 'F1', Fingerprint: 'hub|x|y', Severity: 'P0', System: 'hub', Where: 'receipt_parse', Message: 'credit balance too low', Count: '19', Status: 'open', First_Seen: new Date(T0 - 30 * 3600000).toISOString(), Last_Seen: new Date(T0).toISOString(), Notes: '', _row: 2 }, o);
ok(L.failQueuePlan([lrow({})], T0).length === 1, 'P0 open 30 h is queued');
ok(L.failQueuePlan([lrow({ First_Seen: new Date(T0 - 5 * 3600000).toISOString() })], T0).length === 0, 'not before 24 h');
ok(L.failQueuePlan([lrow({ Severity: 'P2' })], T0).length === 0 && L.failQueuePlan([lrow({ Status: 'fixed' })], T0).length === 0 && L.failQueuePlan([lrow({ Status: 'wontfix' })], T0).length === 0, 'minor, fixed and won\'t-fix problems are never queued');
ok(L.failQueuePlan([lrow({ Notes: '2026-10-16 queued: Ops_Build_Queue #77' })], T0).length === 0, 'already queued: never twice');
ok(L.failQueuePlan([lrow({ Fingerprint: 'cond|alerts_off' })], T0).length === 0, 'switches Brett flips himself are not build work');
ok(L.failQueuePlan([1, 2, 3, 4, 5].map(i => lrow({ ID: 'F' + i, _row: i + 1 })), T0).length === 3, 'at most 3 per run (a pile-up cannot flood the queue)');
ok(/^Fix: receipt_parse/.test(L.failQueueItem(lrow({})).title) && /Needs Attention ID F1/.test(L.failQueueItem(lrow({})).problem), 'queue item names the place and the ledger ID');
const R0 = Date.now();
reset(); await L.reportFailure(env, { where: 'receipt_parse', message: 'credit balance too low' });
await L.failRollupRun(env, { nowMs: R0 });
res = await L.failRollupRun(env, { nowMs: R0 + 30 * 3600000 });
const q = SHEET.Ops_Build_Queue;
ok(res.queued === 1 && q && q.length === 2 && q[1][10] === 'proposed' && q[1][11] === 'failure-ledger' && /Fix: receipt_parse/.test(q[1][2]), 'after 24 h an open P0 lands in Ops_Build_Queue as "proposed" (Brett still decides)');
ok(/queued: Ops_Build_Queue #1/.test(SHEET.Failures.slice(1).find(x => x[4] === 'receipt_parse')[15]), 'the ledger row records which queue item it became');
res = await L.failRollupRun(env, { nowMs: R0 + 31 * 3600000 });
ok(res.queued === 0 && SHEET.Ops_Build_Queue.length === 2, 'and the next run does not queue it again');
reset(); await L.reportFailure(env, { where: 'receipt_parse', message: 'credit balance too low' });
await L.failRollupRun(env, { nowMs: R0 }); QUEUE_FAIL = true;
res = await L.failRollupRun(env, { nowMs: R0 + 30 * 3600000 });
ok(res.ok === false && res.errors.some(e => e.step === 'queue_item') && !/queued:/.test(SHEET.Failures.slice(1).find(x => x[4] === 'receipt_parse')[15]), 'if the queue write fails the job reports it and the ledger is not marked queued (it retries)');

console.log('\nA3a: the Apps Script scheduler token may report with real severities');
reset(); SHEET.Config.push(['Scheduler_Token', 'sched-secret-token-0123456789abcdef0123456789']);
env.WORKER_SECRET = 'adm'; env.FAILURE_INGEST_TOKEN = '';
a = mk('sched-secret-token-0123456789abcdef0123456789', { system: 'scheduler', source: 'apps-script', where: 'worker_probe:barrel-co', message: 'barrel-co /health HTTP 502', severity: 'P1' });
r = await L.failReportEndpoint(env, a.request, a.body);
ok(r.status === 200 && SHEET.Failure_Events[1][2] === 'scheduler' && SHEET.Failure_Events[1][6] === 'P1', 'the scheduler token is trusted: system and severity are kept');
a = mk('wrong-token', { system: 'scheduler', where: 'x', message: 'm', severity: 'P0' });
r = await L.failReportEndpoint(env, a.request, a.body);
ok(r.status === 200 && SHEET.Failure_Events[2][6] === 'P2' && SHEET.Failure_Events[2][2] === 'page:scheduler', 'a wrong token is treated as anonymous (P2, tagged page:)');

console.log('\nWiring (static) + telemetry bridge');
const lt = grab('logTelemetry', 'async');
ok(/Success == null \? '' : rec\.Success\)\.toUpperCase\(\) === 'FALSE'/.test(lt) && /reportFailure\(env/.test(lt), 'logTelemetry mirrors every Success=FALSE row into the ledger');
ok(lt.indexOf('reportFailure(') < lt.indexOf('ensureTab(env, TELEMETRY_TAB'), 'the mirror runs before the telemetry write, so a telemetry write failure still leaves a ledger event');
ok(!/logTelemetry/.test(block.replace(/\/\/.*$/gm, '')), 'the ledger code never calls logTelemetry (no recursion)');
ok(/failure_ledger', \(\) => failRollupRun\(env\)/.test(grab('schedRunSweepChecks', 'async')), 'the rollup runs in the sweep_checks job');
ok(/path === '\/failures\/open'/.test(src) && /path === '\/failure\/update'/.test(src) && /path === '\/failure\/report'/.test(src), 'routes are registered');
const pub = src.slice(src.indexOf('const PUBLIC_PATHS'), src.indexOf('if (!PUBLIC_PATHS.includes(path))'));
ok(/'\/failure\/report'/.test(pub) && !/'\/failure\/update'/.test(pub) && !/'\/failures\/open'/.test(pub), 'only /failure/report is public; the list and update are admin-only');
const scopes = src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('const ROLE_SCOPES') + 200000);
ok(!/\/failure\/update|\/failures\/open/.test(scopes.slice(0, scopes.indexOf('\n};'))), 'no portal role can list or change failures');

console.error = origErr;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
