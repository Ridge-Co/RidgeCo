// Oct 22 2026 - Needs Attention cleanup (17 open Hub problems). Every case FORCES the failure and checks the row the failure ledger would hold.
//  A. ledger severity follows the CURRENT rule, both ways (alerts-off / dead-man-off conditions, qb_payables_payment_date_missing event row)
//  B. a Sheets read-quota hit inside a scheduler job / the cleaning scheduler is the calm P2 "sheets_quota_busy" row - no P0, no text, no email
//  C. /qb/ready under quota answers the typed 429 "busy" (not a 500) and leaves the P2 row
//  D. strEnsureTabs warms the tab cache with ONE batched read (the cold-start read burst that caused the quota hits)
//  E. failure-reporter.js: a network-only failure is confirmed against the Hub before it reaches the ledger
// (the read-meter "busy minute files nothing" change is asserted in test/read-meter.test.mjs; the scheduler dispatcher in test/scheduler.test.mjs)
// Run: node test/needs-attention-oct22.test.mjs
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
function grab(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

// ───────────────────────── A. ledger severity follows the current rule ─────────────────────────
const bi = src.indexOf('// ═══ FAILURE-LEDGER-BEGIN'), be = src.indexOf('// ═══ FAILURE-LEDGER-END');
t('ledger block markers exist', bi > 0 && be > bi);
const L = new Function(src.slice(bi, be) + '\nreturn { failRollupPlan, failTableSeverity, failSeverity };')();
const NOW = Date.UTC(2026, 9, 22, 18, 30);
const isoAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const row = (o) => Object.assign({ _row: 2, ID: 'F-1', Fingerprint: 'x', Severity: 'P0', System: 'hub', Where: 'w', Message: 'm', Source: 'worker', First_Seen: isoAgo(100), Last_Seen: isoAgo(1), Count: 1, Status: 'open', Notified_At: '', Notified_Count: 0, Last_Event_ID: '1', Fixed_In: '', Notes: '' }, o);
const plan = (ledger, conditions) => L.failRollupPlan({ events: [], ledger, conditions: conditions || [], nowMs: NOW });
const cond = (key, severity, extra) => Object.assign({ key, severity, where: key, message: 'cond ' + key }, extra || {});
{
  // #1 failure_alerts P0 and #8 dead_man_switch P1 - both are P2 by Brett's standing choice, but the rows still said P0 / P1
  const rows = [row({ _row: 2, Fingerprint: 'cond|failure_alerts', Where: 'failure_alerts', Severity: 'P0', Source: 'condition' }),
                row({ _row: 3, Fingerprint: 'cond|dead_man_switch', Where: 'dead_man_switch', Severity: 'P1', Source: 'condition' })];
  const p = plan(rows, [cond('failure_alerts', 'P2'), cond('dead_man_switch', 'P2')]);
  const a = p.all.find(r => r.Fingerprint === 'cond|failure_alerts'), d = p.all.find(r => r.Fingerprint === 'cond|dead_man_switch');
  t('#1 alerts-off condition row comes DOWN from P0 to P2', a.Severity === 'P2', a);
  t('#8 dead-man-off condition row comes DOWN from P1 to P2', d.Severity === 'P2', d);
  t('the de-escalation is written (row is in updates) and says why', p.updates.length === 2 && /severity P0 -> P2 2026-10-22 \(current rule\)/.test(a.Notes));
  t('a row that is no longer P0 is not texted', p.sms.length === 0, p.sms);
  // the old behaviour (what these rows did): a P0 open condition WOULD have been texted
  const stillP0 = plan([row({ Fingerprint: 'cond|failure_alerts', Where: 'failure_alerts', Severity: 'P0', Source: 'condition' })], [cond('failure_alerts', 'P0')]);
  t('control: if the rule were still P0 the same row would be texted (so the P2 result above is the fix)', stillP0.sms.length === 1);
  // escalation still works, and records why
  const up = plan([row({ Fingerprint: 'cond|twilio_balance', Where: 'twilio_balance', Severity: 'P1', Source: 'condition' })], [cond('twilio_balance', 'P0')]);
  const upRow = up.all.find(r => r.Fingerprint === 'cond|twilio_balance');
  t('escalation still works (P1 -> P0) and is texted', upRow.Severity === 'P0' && up.sms.length === 1);
  // wontfix is Brett's decision: never touched
  const wf = plan([row({ Fingerprint: 'cond|failure_alerts', Where: 'failure_alerts', Severity: 'P0', Source: 'condition', Status: 'wontfix' })], [cond('failure_alerts', 'P2')]);
  t('a wontfix row keeps its severity', wf.all.find(r => r.Fingerprint === 'cond|failure_alerts').Severity === 'P0');
  // unchanged severity: no note, no churn in Notes
  const same = plan([row({ Fingerprint: 'cond|failure_alerts', Where: 'failure_alerts', Severity: 'P2', Source: 'condition', Notes: 'keep' })], [cond('failure_alerts', 'P2')]);
  t('no change in severity adds no note', same.all[0].Notes === 'keep');
  // a condition that stopped being true still auto-clears
  const cleared = plan([row({ Fingerprint: 'cond|failure_alerts', Where: 'failure_alerts', Severity: 'P0', Source: 'condition' })], []);
  t('a condition that is no longer true is still cleared automatically', cleared.all[0].Status === 'fixed' && /no longer true/.test(cleared.all[0].Notes));
}
{
  // #5 qb_payables_payment_date_missing: a quiet event row filed as P0 before the rule made it P2 stays P0 (and keeps the 7-day quiet-close) forever
  const stale = row({ _row: 5, ID: 'F-1792452838483-udgg', Fingerprint: 'hub|qb_payables_payment_date_missing|#', Where: 'qb_payables_payment_date_missing', Severity: 'P0', Last_Seen: isoAgo(30), Count: 22 });
  const p = plan([stale]);
  const r = p.all[0];
  t('#5 an open quiet event row whose Where is fixed at P2 is brought down to P2', r.Severity === 'P2', r);
  t('... it is written, with a note naming the fixed rule', p.updates.length === 1 && /severity P0 -> P2 2026-10-22 \(fixed severity for qb_payables_payment_date_missing\)/.test(r.Notes), r.Notes);
  t('... and it is no longer a P0 that gets texted', p.sms.length === 0);
  const bump = plan([row({ Where: 'door_watchdog', Severity: 'P2' })]);
  t('it never escalates: a P2 row stays P2 even when its Where table value is lower urgency', bump.all[0].Severity === 'P2');
  const esc = plan([row({ Where: 'deposit_sweep_not_found', Severity: 'P2' })]);
  t('it never escalates: a P2 row whose table severity is P1 stays P2', esc.all[0].Severity === 'P2' && esc.updates.length === 0, esc.all[0]);
  const noTable = plan([row({ Where: 'scheduler_job', Severity: 'P0' })]);
  t('a Where with no fixed severity is untouched', noTable.all[0].Severity === 'P0' && noTable.updates.length === 0);
  const wf = plan([row({ Where: 'qb_payables_payment_date_missing', Severity: 'P0', Status: 'wontfix' })]);
  t('closed / wontfix rows are untouched', wf.all[0].Severity === 'P0' && wf.updates.length === 0);
  const credit = plan([row({ Where: 'receipt_parse', Severity: 'P0', Message: 'Your credit balance is too low to access the Anthropic API' })]);
  t('guard: an urgent-wording P0 on a P2-by-rule Where (API credit balance) is NOT demoted', credit.all[0].Severity === 'P0' && credit.updates.length === 0, credit.all[0]);
  const sel = plan([row({ Where: 'selftest', Severity: 'P0' })]);
  t('guard: only a fixed P2 demotes - a P0 on a Where fixed at P1 is left alone', sel.all[0].Severity === 'P0' && sel.updates.length === 0);
  const queueSms = plan([stale, row({ _row: 6, Fingerprint: 'y', Where: 'receipt_parse', Severity: 'P0', Message: 'credit balance too low' })]);
  t('guard: the credit-balance P0 is still texted while the stale P2 one is not', queueSms.sms.length === 1 && queueSms.sms[0].Where === 'receipt_parse', queueSms.sms);
  t('failTableSeverity: null when nothing is fixed for the Where, the value otherwise', L.failTableSeverity('scheduler_job') === null && L.failTableSeverity('sheets_quota_busy') === 'P2' && L.failTableSeverity(undefined) === null);
}

// ───────────────────────── real worker.js over a fake Google ─────────────────────────
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const tabs = new Map(), calls = [], outbound = [];
const st = { failWhen: null };
const colN = (s) => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const gerr = (code, message) => ({ error: { code, message } });
const gQuota = () => gerr(429, "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com' for consumer 'project_number:664428332384'.");
function handle(method, path, body) {
  calls.push(method + ' ' + path);
  if (st.failWhen) { const f = st.failWhen(method, path, body); if (f) return f; }
  const missing = (n) => gerr(400, 'Unable to parse range: ' + n);
  let m;
  if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 60, rowCount: 1000 } } })) };
  if (method === 'GET' && path.startsWith('/values:batchGet?')) {
    const names = [...path.slice(path.indexOf('?') + 1).matchAll(/ranges=([^&]+)/g)].map(x => decodeURIComponent(x[1]));
    return { valueRanges: names.map(n => ({ range: n, values: (tabs.get(n) || []).map(r => r.slice()) })) };
  }
  if (method === 'GET' && (m = /^\/values\/([^!:?]+)(?:!(.+))?$/.exec(path))) {
    const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n);
    const rows = tabs.get(n);
    if (m[2] && /^(1:1|A1:[A-Z]+1)$/.test(m[2])) return { values: rows.slice(0, 1).map(r => r.slice()) };
    return { range: n, values: rows.map(r => r.slice()) };
  }
  if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) {
    const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n);
    const first = tabs.get(n).length + 1; for (const r of body.values) tabs.get(n).push(r.slice());
    return { updates: { updatedRange: `${n}!A${first}:Z${first + body.values.length - 1}`, updatedRows: body.values.length } };
  }
  if (method === 'PUT' && (m = /^\/values\/([^!:?]+)!([A-Z]+)(\d+)/.exec(path))) {
    const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n);
    const rows = tabs.get(n), r0 = +m[3] - 1, c0 = colN(m[2]);
    body.values.forEach((vr, i) => { while (rows.length <= r0 + i) rows.push([]); vr.forEach((v, j) => { while (rows[r0 + i].length <= c0 + j) rows[r0 + i].push(''); rows[r0 + i][c0 + j] = v; }); });
    return { updatedCells: 1 };
  }
  if (method === 'POST' && path === '/values:batchUpdate') {
    for (const d of body.data) {
      const mm = /^([^!]+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(d.range); const rows = tabs.get(mm[1]); if (!rows) return missing(mm[1]);
      const r0 = +mm[3] - 1, c0 = colN(mm[2]);
      d.values.forEach((vr, i) => { while (rows.length <= r0 + i) rows.push([]); vr.forEach((v, j) => { while (rows[r0 + i].length <= c0 + j) rows[r0 + i].push(''); rows[r0 + i][c0 + j] = v; }); });
    }
    return { totalUpdatedCells: body.data.length };
  }
  if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
  return gerr(400, 'fake sheets: unsupported ' + method + ' ' + path);
}
const realFetch = globalThis.fetch, _realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => _realSetTimeout(fn, ms >= 1000 ? 1 : ms, ...a);   // skip cron pacing and quota back-off waits
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url, method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const r = handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), init && init.body ? JSON.parse(init.body) : undefined); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  outbound.push(method + ' ' + url);
  return new Response(JSON.stringify({ ok: true, sid: 'SMFAKE' }), { status: 200 });
};
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev', SECRET = 'admin-secret-for-tests-0123456789', SCHED = 'sched-token-for-tests-' + 'k'.repeat(30);
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET };
const call = async (method, path, headers, body) => {
  skew += 100000;   // beats the 6 s tab cache and the 90 s cron-env cache
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: () => {} });
  let j = null; try { j = await res.clone().json(); } catch (_) { /* non-JSON body is asserted via status */ }
  return { status: res.status, headers: res.headers, json: j };
};
const TELE = ['ID', 'Timestamp', 'Source', 'Session_Id', 'Job_Type', 'Skill_Or_Endpoint', 'Tier_Requested', 'Model_Used', 'Escalated', 'Tokens_In', 'Tokens_Out', 'Est_Cost', 'Latency_ms', 'Success', 'Confidence', 'Human_Corrected', 'Notes'];
const EVC = ['ID', 'Timestamp', 'System', 'Source', 'Where', 'Ref', 'Severity', 'Message', 'Context'];
const reset = () => {
  tabs.clear(); calls.length = 0; outbound.length = 0; st.failWhen = null;
  tabs.set('Config', [['Key', 'Value'], ['Scheduler_Token', SCHED], ['admin_phone', '+15555550100'], ['failure_alert_enabled', 'TRUE']]);
  tabs.set('Ops_Telemetry', [TELE.slice()]); tabs.set('Failure_Events', [EVC.slice()]);
  for (const n of ['Notification_Queue', 'Vendor_Requests', 'Message_Queue', 'Invoice_Review', 'Work_Orders', 'Estimates']) tabs.set(n, [['ID']]);
};
const events = () => { const r = tabs.get('Failure_Events'), h = r[0]; return r.slice(1).map(x => Object.fromEntries(h.map((c, i) => [c, x[i]]))); };
const H = { 'X-Auth-Token': SCHED }, HA = { 'X-Auth-Token': SECRET };
const origErr = console.error, origWarn = console.warn; console.error = () => {}; console.warn = () => {};

// ───────────────────────── B. cleaning scheduler alert + handler: quota is a calm P2 row ─────────────────────────
{
  const tel = [], sent = [];
  const mk = () => new Function('logTelemetry', 'fetchConfig', 'strSendBrett', 'console', 'json', 'strErrText',
    'const __strSysAt = {};\n' + grab('function sheetsQuotaBusyError(') + '\n' + grab('async function strSystemAlert(') + '\n' + grab('async function strHandleErr(') +
    '\nreturn { strSystemAlert, strHandleErr };')(
    async (_e, rec) => { tel.push(rec); }, async () => ({ admin_phone: '+15555550100' }), async (...a) => { sent.push(a); return { ok: true, log: [] }; },
    { error() {}, warn() {}, log() {} }, (b, s) => ({ body: b, status: s || 200 }), (e) => String((e && e.message) || e));
  const W = mk();
  const sev = (rec) => L.failSeverity(rec.Job_Type, rec.Notes);
  // #9: the exact text on Needs Attention
  const MSG9 = "Sheets API error on GET ?fields=sheets.properties.title: Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com' for consumer 'project_number:664428332384'.";
  await W.strSystemAlert({}, 'tick', MSG9);
  t('#9 quota during the cleaning tick: ONE telemetry row, filed as sheets_quota_busy (P2), not str_cleaning (P1)', tel.length === 1 && tel[0].Job_Type === 'sheets_quota_busy' && tel[0].Success === 'FALSE' && sev(tel[0]) === 'P2', tel);
  t('#9 ... and Brett is NOT texted or emailed for it', sent.length === 0, sent);
  tel.length = 0;
  await W.strSystemAlert({}, 'tick', 'Cleaning calendar: The service account can see the calendar but is not allowed to change it.');
  t('control: a real cleaning failure is still the str_cleaning row ...', tel.length === 1 && tel[0].Job_Type === 'str_cleaning' && tel[0].Success === 'FALSE', tel);
  t('control: (what changed) the SAME quota text filed under str_cleaning was a P1; filed as sheets_quota_busy it is P2', L.failSeverity('str_cleaning', MSG9) === 'P1' && L.failSeverity('sheets_quota_busy', MSG9) === 'P2');
  t('control: ... and still tells Brett (SMS + email helper called, urgent)', sent.length === 1 && sent[0][5] === true, sent);
  // the same alert twice inside 30 minutes is throttled for real failures only; quota rows are never suppressed or sent
  tel.length = 0; sent.length = 0;
  await W.strSystemAlert({}, 'tick', MSG9); await W.strSystemAlert({}, 'tick', MSG9);
  t('quota hits keep being recorded (2 rows) and still never message Brett', tel.length === 2 && sent.length === 0);
  // telemetry itself failing must not throw out of the alert (never loops, never crashes the tick)
  const W2 = new Function('logTelemetry', 'fetchConfig', 'strSendBrett', 'console',
    'const __strSysAt = {};\n' + grab('function sheetsQuotaBusyError(') + '\n' + grab('async function strSystemAlert(') + '\nreturn strSystemAlert;')(
    async () => { throw new Error('telemetry sheet down'); }, async () => ({}), async () => ({}), { error() {}, warn() {}, log() {} });
  let threw = false; try { await W2({}, 'tick', MSG9); } catch (_) { threw = true; }
  t('a failing telemetry write inside the quota branch is contained (logged to console, not thrown)', !threw);
  // strHandleErr: quota is rethrown to the top-level handler (typed 429 busy); everything else is the old 500 + alert
  tel.length = 0; sent.length = 0;
  let rethrown = null; try { await W.strHandleErr({}, new Error(MSG9), 'cleaner_page'); } catch (e) { rethrown = e; }
  t('strHandleErr rethrows a quota error so the top-level handler answers the typed 429 "busy" and files the P2 row', rethrown && /Quota exceeded/.test(rethrown.message) && tel.length === 0 && sent.length === 0);
  const r500 = await W.strHandleErr({}, new Error('Cannot read properties of undefined'), 'cleaner_page');
  t('control: any other error is still a 500 and still tells Brett', r500.status === 500 && sent.length === 1 && tel.some(x => x.Job_Type === 'str_cleaning'));
  const r4xx = await W.strHandleErr({}, Object.assign(new Error('bad'), { code: 'bad_link', status: 404 }), 'x');
  t('control: a typed 4xx is passed straight through', r4xx.status === 404);
}

// ───────────────────────── C. /qb/ready under quota: typed 429 busy + P2 row, not a 500 ─────────────────────────
{
  reset();
  const ok = await call('GET', '/qb/ready', HA);
  t('happy path: /qb/ready answers 200 with nothing waiting', ok.status === 200, ok.json);
  t('happy path: and files no failure', !events().some(e => /qb_ready|sheets_quota_busy|unhandled_500/.test(e.Where)), events().map(e => e.Where));
  reset();
  st.failWhen = (m, p) => (m === 'GET' && /^\/values:batchGet\?/.test(p) && /Invoice_Review/.test(decodeURIComponent(p))) ? gQuota() : null;
  const r = await call('GET', '/qb/ready', HA);
  t('#11 Google read quota while loading the QuickBooks queue: HTTP 429 (not 500)', r.status === 429, { status: r.status, body: r.json });
  t('#11 ... a typed "busy" answer the page can retry on', r.json && r.json.busy === true && /quota|busy/i.test(r.json.error || ''), r.json);
  t('#11 ... with Retry-After', !!r.headers.get('Retry-After'));
  const ev = events();
  t('#11 ... and the failure ledger gets the calm P2 sheets_quota_busy event', ev.some(e => e.Where === 'sheets_quota_busy' && e.Severity === 'P2'), ev);
  t('#11 ... and no 500 / unhandled_500 event', !ev.some(e => e.Severity === 'P1' && /qb_ready|unhandled_500/.test(e.Where)), ev);
  reset();
  st.failWhen = (m, p) => (m === 'GET' && /^\/values:batchGet\?/.test(p)) ? gerr(500, 'injected sheets failure') : null;
  const bad = await call('GET', '/qb/ready', HA);
  t('control: a real read failure is still a 500 with the error text', bad.status === 500 && /Could not read the QuickBooks queue/.test((bad.json && bad.json.error) || ''), bad.json);
}

// ───────────────────────── D. cold-start read burst of the cleaning scheduler ─────────────────────────
{
  reset();   // steady state on a COLD instance: the cleaning tabs all exist with their headers (the usual case for the 14-minute scheduler tick)
  const STR_TABS = new Function(src.slice(src.indexOf('const STR_TABS = {'), src.indexOf('};', src.indexOf('const STR_TABS = {')) + 2) + '\nreturn STR_TABS;')();
  for (const [n, h] of Object.entries(STR_TABS)) tabs.set(n, [h.slice()]);
  tabs.set('Vendors', [['ID', 'Name', 'Service_Area']]);
  const before = calls.length;
  const r = await call('GET', '/str/c/page?k=short', {});
  const mine = calls.slice(before);
  const gets = mine.filter(x => x.startsWith('GET '));
  console.log('  [info] cold /str/c/page: ' + gets.length + ' Google reads: ' + gets.map(x => x.slice(0, 60)).join(' | '));
  t('a cold cleaning request ends in the normal "bad link" 404 (tabs were self-provisioned)', r.status === 404, { status: r.status, body: r.json });
  const single = gets.filter(x => /^GET \/values\/STR_/.test(x));
  t('#3/#9 the nine cleaning tabs are NOT each read on their own any more (one batched read warms the cache)', single.length === 0, single);
  t('#3/#9 the tab warm-up is ONE batchGet naming every cleaning tab', gets.filter(x => /batchGet/.test(x) && /STR_Cleaners/.test(x) && /STR_Log/.test(x)).length >= 1, gets);
  t('#3/#9 a cold start now costs at most 6 Google reads in total (was about 11 for the tab check alone)', gets.length <= 6, gets.length);
}

// ───────────────────────── E. failure-reporter.js: a network-only failure is confirmed against the Hub first ─────────────────────────
globalThis.fetch = realFetch; globalThis.setTimeout = _realSetTimeout; Date.now = _realNow; console.error = origErr; console.warn = origWarn;
{
  const code = fs.readFileSync(root + 'failure-reporter.js', 'utf8');
  function world(opts) {
    opts = opts || {};
    const reports = [], listeners = {}, timers = [], probes = [];
    const doc = { visibilityState: opts.hidden ? 'hidden' : 'visible', readyState: 'complete', body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, remove() {} }), getElementById: () => null,
      addEventListener: (n, f) => { (listeners['d:' + n] = listeners['d:' + n] || []).push(f); } };
    const win = { location: { search: '', pathname: '/failures.html' }, addEventListener: (n, f) => { (listeners['w:' + n] = listeners['w:' + n] || []).push(f); } };
    win.fetch = async (url, init) => {
      url = String(url);
      if (/\/failure\/report/.test(url)) { reports.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }
      if (/\/version/.test(url)) { probes.push(url); if (opts.hubStatus) return { ok: opts.hubStatus < 400, status: opts.hubStatus }; if (opts.hubUp === false) throw new TypeError('Load failed'); return { ok: true, status: 200 }; }
      return { ok: true, status: 200 };
    };
    const fakeSetTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
    const run = new Function('window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'console', 'URLSearchParams', code);
    const quiet = { error() {}, warn() {}, log() {} };
    run(win, doc, { language: 'en', onLine: opts.offline ? false : true }, win.location, { getItem: () => '' }, { getItem: () => null, setItem() {} }, fakeSetTimeout, () => 0, () => {}, quiet, URLSearchParams);
    return { win, reports, probes, timers, fire: async () => { for (const tm of timers.splice(0)) tm.f(); for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); } };
  }
  const NET15 = 'could not reach the Hub (Failed to fetch)', NET14 = 'network error calling /version: Failed to fetch';
  { // #15: failures.html load, the Hub answers the check -> NOT in the ledger
    const w = world({ hubUp: true });
    w.win.hubReportFailure('failures.html load', NET15); await w.fire();
    t('#15 "could not reach the Hub" while the Hub answers a check is NOT reported', w.reports.length === 0 && w.probes.length === 1, { r: w.reports, p: w.probes });
    t('#15 ... the check waited (a 3 s timer), it did not report on the spot', w.timers.length === 0);
  }
  { // #15 / #14 the Hub really is down -> reported, naming the page and the failed check
    const w = world({ hubUp: false });
    w.win.hubReportFailure('failures.html load', NET15); await w.fire();
    t('#15 the Hub really unreachable: ONE report reaches POST /failure/report', w.reports.length === 1, w.reports);
    t('#15 ... it names the page and says the check failed too', /failures\.html load/.test(w.reports[0].where) && /did not answer a check/.test(w.reports[0].message) && w.reports[0].source === 'browser', w.reports[0]);
    const w14 = world({ hubUp: false });
    w14.win.hubReportFailure('api /version', NET14); await w14.fire();
    t('#14 "network error calling /version: Failed to fetch" is checked the same way (reported only when the Hub is down)', w14.reports.length === 1 && /network error calling \/version/.test(w14.reports[0].message));
    const w14b = world({ hubUp: true });
    w14b.win.hubReportFailure('api /version', NET14); await w14b.fire();
    t('#14 ... and NOT reported when the Hub answers', w14b.reports.length === 0);
  }
  { // the Hub answers but with a server error -> that IS a problem worth a row, with the status
    const w = world({ hubStatus: 503 });
    w.win.hubReportFailure('failures.html load', NET15); await w.fire();
    t('a Hub that answers the check with HTTP 503 IS reported, with the status in the message', w.reports.length === 1 && /Hub check: HTTP 503/.test(w.reports[0].message), w.reports);
    const w404 = world({ hubStatus: 404 });
    w404.win.hubReportFailure('failures.html load', NET15); await w404.fire();
    t('a Hub that answers (even 404) is up: not reported', w404.reports.length === 0);
  }
  { // tab hidden / offline -> not the Hub's fault
    const wh = world({ hubUp: false, hidden: true });
    wh.win.hubReportFailure('failures.html load', NET15); await wh.fire();
    t('a failure while the tab is hidden is NOT reported', wh.reports.length === 0 && wh.probes.length === 0);
    const wo = world({ hubUp: false, offline: true });
    wo.win.hubReportFailure('failures.html load', NET15); await wo.fire();
    t('a failure while the device is offline is NOT reported', wo.reports.length === 0 && wo.probes.length === 0);
  }
  { // everything else is reported immediately, exactly as before
    const w = world({ hubUp: true });
    w.win.hubReportFailure('vendor.html parse', 'Unexpected token < in JSON at position 0');
    t('a non-network message is reported at once (no check, no wait)', w.reports.length === 1 && w.probes.length === 0, w.reports);
    const w2 = world({ hubUp: true });
    w2.win.hubReportFailure('x', 'HTTP 500 from /wo/list');
    t('an HTTP 500 message is reported at once', w2.reports.length === 1);
    const w3 = world({ hubUp: true });
    w3.win.hubReportFailure('x', 'Failed to fetch the invoice template: missing field "Total"');
    t('a message that only STARTS with fetch-like words but carries a real cause after a colon is still reported at once', w3.reports.length === 1 && w3.probes.length === 0, w3.reports);
    const w4 = world({ hubUp: true });
    t('happy path: a page that reports nothing files nothing', w4.reports.length === 0 && w4.probes.length === 0 && w4.timers.length === 0);
  }
}
console.log(`needs-attention-oct22: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
