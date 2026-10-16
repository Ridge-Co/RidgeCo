// AI-credit "alert once, then pause" (Oct 16 2026). On Oct 15 ~4pm ET the prepaid Anthropic credit ran out; every Claude call failed with
// HTTP 400 "Your credit balance is too low...", daily_receipts retried the same PDFs every ~30 min all night, and nobody was told.
// Drives the REAL worker.js default export (router, scheduler, ledger and all) over a fake Google Sheets and a fake Anthropic, so it proves
// what Brett would actually get - not a copy. Fault injection throughout: for each forced failure it asserts (1) it is logged, (2) a
// telemetry / ledger row exists, (3) the caller sees an error or a plain "paused" answer - never a quiet success.
//   1. Classifier: credit-exhausted and key-refused are recognised; ordinary 400 / 429 / 500 are NOT a pause.
//   2. First failing call: flag set (+when +what Anthropic said), telemetry ai_credit_exhausted FALSE, ONE alert (text + email).
//   3. While paused: NO Anthropic call at all; callers get a typed ai_credit_paused / _paused answer; no second alert; one reminder per 24 h.
//   4. daily_receipts: skipped with {paused:true}, not retried every 30 min, shown as "paused: AI credit" (not overdue); runs again at once after resume.
//   5. Resume: POST /admin/ai-credit-resume makes ONE real call and clears the flag only on success; the hourly probe job costs nothing unless paused.
//   6. Auth: admin only (no role session, no read-only token, no write token); GET /ai-credit/status readable by the read-only prod token, secret-free.
//   7. Silent-failure injection: flag write fails, alert undeliverable, flag unreadable, failed notice after resume.
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
// The scheduler waits ~700 ms after each state write to verify it; collapse short waits so the whole file runs in seconds (the 50 s job budget timer is left alone).
const _realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => _realSetTimeout(fn, (ms && ms < 20000) ? 0 : ms, ...a);

// ───────────────────────────── 1. classifier + pure helpers (sliced out of worker.js) ─────────────────────────────
const gi = wsrc.indexOf('// ═══ AI-CREDIT-GUARD-BEGIN'), ge = wsrc.indexOf('// ═══ AI-CREDIT-GUARD-END');
t('guard block markers exist', gi > 0 && ge > gi);
const P = new Function('schedCell', 'schedReadConfigRows', 'schedErrText', 'logTelemetry', 'MODEL_REGISTRY', 'json',
  wsrc.slice(gi, ge) + '\nreturn { aiCreditClassify, aiCreditAlertDue, aiCreditStateFromRows, aiCreditAlertText, aiCreditErrorTextIsOutage, aiCreditPausedAtFromRows, AI_CREDIT_REMINDER_MS };')(
  (rows, k) => { const r = (rows || []).find(x => x[0] === k); return r ? String(r[1] || '') : ''; }, async () => [], (e) => String((e && e.message) || e), async () => {}, { REASON: { model: 'm' } }, () => ({}));
const CREDIT_TXT = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
{
  const c = P.aiCreditClassify(400, { type: 'error', error: { type: 'invalid_request_error', message: CREDIT_TXT } });
  t('classify: the real Oct 15 error (400 invalid_request_error + credit balance text) = credit', c && c.kind === 'credit', c);
  t('classify: type billing_error = credit', P.aiCreditClassify(400, { error: { type: 'billing_error', message: 'x' } }).kind === 'credit');
  t('classify: 402 = credit', P.aiCreditClassify(402, { error: { message: '' } }).kind === 'credit');
  t('classify: 401 = auth (key refused)', P.aiCreditClassify(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }).kind === 'auth');
  t('classify: 403 permission_error = auth', P.aiCreditClassify(403, { error: { type: 'permission_error', message: 'nope' } }).kind === 'auth');
  t('classify: an ordinary 400 (bad image) is NOT a pause', P.aiCreditClassify(400, { error: { type: 'invalid_request_error', message: 'Could not process image' } }) === null);
  t('classify: 429 rate limit is NOT a pause', P.aiCreditClassify(429, { error: { type: 'rate_limit_error', message: 'slow down' } }) === null);
  t('classify: 500 / 529 overloaded are NOT a pause', P.aiCreditClassify(500, { error: { message: 'oops' } }) === null && P.aiCreditClassify(529, { error: { type: 'overloaded_error', message: 'busy' } }) === null);
  t('classify: a 403 without a permission/billing signal is NOT a pause', P.aiCreditClassify(403, { error: { type: 'forbidden', message: 'cloudflare' } }) === null);
  t('classify: garbage bodies never throw', P.aiCreditClassify(400, null) === null && P.aiCreditClassify(400, 'x') === null && P.aiCreditClassify(undefined, undefined) === null);
  const now = Date.parse('2026-10-16T12:00:00Z'), H = 3600000;
  const st = (o) => Object.assign({ paused: true, at: '2026-10-01T08:00:00Z', alerted_at: '' }, o);
  t('alert due: first when never alerted', P.aiCreditAlertDue(st({}), now) === 'first');
  t('alert due: none when alerted 1h ago', P.aiCreditAlertDue(st({ alerted_at: new Date(now - H).toISOString() }), now) === '');
  t('alert due: none at 23h', P.aiCreditAlertDue(st({ alerted_at: new Date(now - 23 * H).toISOString() }), now) === '');
  t('alert due: ONE reminder at 24h+', P.aiCreditAlertDue(st({ alerted_at: new Date(now - 25 * H).toISOString() }), now) === 'reminder');
  t('alert due: an alert from an EARLIER pause does not count', P.aiCreditAlertDue(st({ at: '2026-10-16T11:00:00Z', alerted_at: '2026-10-16T09:00:00Z' }), now) === 'first');
  t('alert due: nothing when not paused', P.aiCreditAlertDue({ paused: false }, now) === '');
  const txt = P.aiCreditAlertText({ kind: 'credit', err: CREDIT_TXT, at: 'x' }, 'first');
  t('alert text says what happened, what is affected, where to fix it', /credit is OUT/i.test(txt.sms) && /receipt scanning/i.test(txt.sms) && /Anthropic Console > Settings > Billing > Buy credits/.test(txt.sms) && /auto-reload/.test(txt.sms), txt.sms);
  t('alert text lists affected features in the email', /field-inspection/.test(txt.html) && /Resume/.test(txt.html));
  t('outage wording in a stored per-file failure is recognised', P.aiCreditErrorTextIsOutage('Claude 400: ' + CREDIT_TXT) && P.aiCreditErrorTextIsOutage('AI is paused (Anthropic credit is out)') && !P.aiCreditErrorTextIsOutage('Could not process image'));
}

// ───────────────────────────── 2. the real worker over a fake Sheets + fake Anthropic ─────────────────────────────
function makeStore() {
  const tabs = new Map(); const calls = [];
  const st = { tabs, calls, failWhen: null };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {
    calls.push(method + ' ' + path);
    if (st.failWhen && st.failWhen(method, path, body)) return { error: { code: 500, message: 'injected sheets failure' } };
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); return { range: name, values: tabs.get(name).map(r => r.slice()) }; }
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)!A(\d+):[A-Z]+$/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); return { range: name, values: tabs.get(name).slice(Number(m[2]) - 1).map(r => r.slice()) }; }
    if (method === 'GET' && (m = /^\/values:batchGet\?(.*)$/.exec(path))) {
      const names = m[1].split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, ''))); const valueRanges = [];
      for (const name of names) { if (!tabs.has(name)) return missing(name); valueRanges.push({ range: name, values: tabs.get(name).map(r => r.slice()) }); }
      return { valueRanges };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 60, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); for (const r of body.values) tabs.get(name).push(r.slice()); return { updates: { updatedRows: body.values.length } }; }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)(?::[A-Z]+\d+)?$/.exec(cell);
        if (!mm) return { error: { code: 400, message: 'fake sheets: bad range ' + d.range } };
        const col = mm[1].split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]);
        const vals = d.values[0];
        for (let k = 0; k < vals.length; k++) { while (rows[row].length <= col + k) rows[row].push(''); rows[row][col + k] = vals[k]; }
      }
      return { totalUpdatedCells: body.data.reduce((a, d) => a + d.values[0].length, 0) };
    }
    if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  st.cfg = () => Object.fromEntries((tabs.get('Config') || []).filter(r => r[0]).map(r => [r[0], r[1] || '']));
  st.setCfg = (k, v) => { const rows = tabs.get('Config'); const i = rows.findIndex(r => r[0] === k); if (i >= 0) rows[i][1] = v; else rows.push([k, v]); };
  tabs.set('Config', [['Key', 'Value']]);
  return st;
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
const outbound = [];            // every non-Sheets call the worker made
let anthropicMode = 'ok';       // ok | credit | auth | rate | badreq | http500
const claudeBodies = [];
const RECEIPT_JSON = JSON.stringify({ vendor: 'Test Hardware', date: '2026-10-15', total: 12.34, items: ['screws'], items_summary: ['hardware'], confidence: 0.9, suggested_category: 'customer WO' });
const INVOICE_JSON = JSON.stringify({ vendor_name: 'Vee LLC', invoice_number: 'INV-9', invoice_date: '2026-10-15', amount: 250, line_items: ['labor'], notes: '' });
let claudeText = INVOICE_JSON;
const anthropicBody = () => {
  switch (anthropicMode) {
    case 'credit': return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: CREDIT_TXT } }), { status: 400 });
    case 'auth': return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 });
    case 'rate': return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429 });
    case 'badreq': return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Could not process image' } }), { status: 400 });
    case 'http500': return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'oops' } }), { status: 500 });
    default: return new Response(JSON.stringify({ content: [{ type: 'text', text: claudeText }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  }
};
let channelsUp = true;           // false = Twilio and Gmail both fail (alert undeliverable)
let driveFiles = [];             // Drive list answer for the inbox-scan tests
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) {
    const b = init && init.body ? JSON.parse(init.body) : undefined;
    const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b);
    return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 });
  }
  outbound.push(method + ' ' + url);
  if (url.includes('api.twilio.com')) return channelsUp ? new Response(JSON.stringify({ sid: 'SM1' }), { status: 200 }) : new Response(JSON.stringify({ code: 21608, message: 'Twilio is down (injected)' }), { status: 500 });
  if (url.includes('gmail.googleapis.com')) return channelsUp ? new Response(JSON.stringify({ id: 'gm1' }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'Gmail is down (injected)' } }), { status: 500 });
  if (url.startsWith('https://api.anthropic.com/v1/messages')) { claudeBodies.push(init && init.body ? JSON.parse(init.body) : null); return anthropicBody(); }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return new Response(JSON.stringify({ files: driveFiles }), { status: 200 });
  if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) return new Response('FILE-BYTES', { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const PROD = 'https://maintenance-hub.brett-2f8.workers.dev', STG = 'https://maintenance-hub-staging.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789', RO = 'prod-readonly-token-0123456789', WR = 'prod-write-token-0123456789', STGTOK = 'hub-test-token-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET, ANTHROPIC_API_KEY: 'sk-ant-test', HUB_PROD_RO_TOKEN: RO, HUB_PROD_WRITE_TOKEN: WR,
  TWILIO_SID: 'ACtest', TWILIO_API_SID: 'SKtest', TWILIO_API_KEY: 'twkey', TWILIO_FROM: '+14105550199', GMAIL_CLIENT_ID: 'gid', GMAIL_CLIENT_SECRET: 'gsec', GMAIL_REFRESH_TOKEN: 'grt', GMAIL_SENDER: 'hub@test.example' };
const stgEnv = Object.assign({}, env, { HUB_TEST_TOKEN: STGTOK });
let skew = 0; const _RealDate = Date; const _realNow = _RealDate.now.bind(_RealDate);
// skew BOTH Date.now() and the no-argument new Date() (the worker stamps with new Date().toISOString())
globalThis.Date = class extends _RealDate { constructor(...a) { if (a.length === 0) super(_realNow() + skew); else super(...a); } static now() { return _realNow() + skew; } };
const advance = (ms) => { skew += ms; };
const call = async (method, path, token, body, base, e) => {
  skew += 10000;      // defeats the Sheets tab cache and the 30 s flag cache between calls
  const res = await worker.fetch(new Request((base || PROD) + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), e || env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) { /* silent-ok: a non-JSON answer is reported through `text` */ }
  return { status: res.status, json: j, text };
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mint = (role, id) => { const now = Math.floor(Date.now() / 1000); const body = b64u(JSON.stringify({ role, id, iat: now, exp: now + 30 * 86400 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);
const teleRows = (job) => { const tb = store.tabs.get('Ops_Telemetry') || []; const h = tb[0] || []; const ji = h.indexOf('Job_Type'); return tb.slice(1).filter(r => r[ji] === job).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const cfg = () => store.cfg();
const claudeCalls = () => outbound.filter(o => o.includes('api.anthropic.com')).length;
const driveCalls = () => outbound.filter(o => o.includes('googleapis.com/drive')).length;
const resetOutbound = () => { outbound.length = 0; claudeBodies.length = 0; };
const notifyCount = () => teleRows('admin_notify').length;
const IMG = Buffer.from('fake-image-bytes').toString('base64');

tab('Config', ['Key', 'Value'], [{ Key: 'admin_phone', Value: '+14105550100' }, { Key: 'TWILIO_ENABLED', Value: 'TRUE' }, { Key: 'failure_alert_enabled', Value: 'TRUE' }, { Key: 'dead_man_switch_enabled', Value: 'TRUE' }]);
tab('Vendors', ['ID', 'Name', 'Phone', 'Active'], [{ ID: 'V1', Name: 'Vee One', Phone: '4105550001', Active: 'TRUE' }]);
tab('Work_Orders', ['ID', 'Vendor_ID', 'Status'], [{ ID: 'WO-1', Vendor_ID: 'V1', Status: 'Assigned' }]);
const VEN1 = mint('vendor', 'V1'), TEN1 = mint('tenant', 'T1'), OWN1 = mint('owner', 'O1');

console.log('## section A');
// ── A. healthy: nothing changes when Anthropic works ───────────────────────────────────────────────────────
{
  anthropicMode = 'ok'; claudeText = INVOICE_JSON; resetOutbound();
  const r = await call('POST', '/vendor-bill/extract', VEN1, { image_b64: IMG, mime: 'image/jpeg' });
  t('healthy: vendor invoice auto-read still works', r.status === 200 && r.json.extract.amount === 250 && !r.json.extract._paused, r);
  t('healthy: exactly one Claude call, no pause flag, no alert', claudeCalls() === 1 && cfg().AI_CREDIT_PAUSED === undefined && notifyCount() === 0);
  const s = await call('GET', '/ai-credit/status', SECRET);
  t('healthy: GET /ai-credit/status says not paused', s.status === 200 && s.json.paused === false && s.json.since === null, s.json);
  const h = await call('GET', '/health', undefined);
  t('healthy: /health carries ai_credit {paused:false}', h.status === 200 && h.json.ai_credit && h.json.ai_credit.paused === false, h.json && h.json.ai_credit);
}

console.log('## section B');
// ── B. errors that are NOT a pause leave everything alone ─────────────────────────────────────────────────
for (const mode of ['rate', 'badreq', 'http500']) {
  anthropicMode = mode; resetOutbound(); advance(120000);
  const r = await call('POST', '/vendor-bill/extract', VEN1, { image_b64: IMG, mime: 'image/jpeg' });
  t(`not a pause (${mode}): fails open as before, no pause flag`, r.status === 200 && r.json.extract._error === true && !r.json.extract._paused && cfg().AI_CREDIT_PAUSED === undefined, r.json);
  t(`not a pause (${mode}): the swallowed failure is now LOGGED (ai_fail_open telemetry) so it is not silent`, teleRows('ai_fail_open').length >= 1 || teleRows('invoice_parse').length >= 1, { fo: teleRows('ai_fail_open').length, ip: teleRows('invoice_parse').length });
}
t('not a pause: no alert was ever sent', notifyCount() === 0 && teleRows('ai_credit_exhausted').length === 0);

console.log('## section C');
// ── C. THE incident: credit runs out ─────────────────────────────────────────────────────────────────────
anthropicMode = 'credit'; resetOutbound(); advance(120000);
const first = await call('POST', '/vendor-bill/extract', VEN1, { image_b64: IMG, mime: 'image/jpeg' });
t('credit out: vendor gets a plain "paused - enter it by hand" (no 500, no raw Anthropic text)', first.status === 200 && first.json.paused === true && first.json.extract._paused === true && /paused - enter it by hand/.test(first.json.message) && !/credit balance/i.test(first.text), first.json);
t('credit out: exactly ONE Claude call was spent finding out (no escalation retries)', claudeCalls() === 1, claudeCalls());
{
  const c = cfg();
  t('credit out: flag AI_CREDIT_PAUSED=TRUE saved', c.AI_CREDIT_PAUSED === 'TRUE', c);
  t('credit out: pause time and Anthropic\'s own words saved', /^2026-/.test(c.AI_CREDIT_PAUSED_AT || '') && /credit balance is too low/.test(c.AI_CREDIT_LAST_ERROR || '') && c.AI_CREDIT_PAUSED_KIND === 'credit', c);
  const ex = teleRows('ai_credit_exhausted');
  t('credit out: Ops_Telemetry ai_credit_exhausted Success=FALSE written', ex.length === 1 && ex[0].Success === 'FALSE', ex);
  t('credit out: the alert was stamped (one per pause)', /^2026-/.test(c.AI_CREDIT_ALERT_LAST_SENT || ''));
  t('credit out: ledger told it the alert already went out (no second text)', !!c.failure_alert_last_sent_ai_credit_paused && !!c.failure_alert_last_sent_ai_credit_exhausted);
  t('credit out: exactly ONE admin text attempt', notifyCount() === 1, notifyCount());
  const st = await call('GET', '/ai-credit/status', SECRET);
  t('credit out: /ai-credit/status reports paused + since + fix + affected', st.json.paused === true && st.json.kind === 'credit' && /Buy credits/.test(st.json.fix) && st.json.affected.length >= 4 && /credit balance/.test(st.json.last_error), st.json);
  const h = await call('GET', '/health', undefined);
  t('credit out: /health shows ai_credit.paused true and NO error text', h.json.ai_credit.paused === true && !/credit balance/i.test(JSON.stringify(h.json.ai_credit)), h.json.ai_credit);
}

console.log('## section D');
// ── D. while paused: nothing calls Anthropic, nothing re-alerts ─────────────────────────────────────────
{
  resetOutbound(); const n0 = notifyCount();
  const a = await call('POST', '/vendor-bill/extract', VEN1, { image_b64: IMG, mime: 'image/jpeg' });
  const b = await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  const c = await call('POST', '/wo/shared/bill-extract', undefined, { image_b64: IMG });   // unauthenticated -> 401, spends nothing
  t('paused: invoice auto-read answers "paused" without calling Anthropic', a.json.extract._paused === true && claudeCalls() === 0, a.json);
  t('paused: contact-card read answers "paused - enter it by hand"', b.json._paused === true && /enter it by hand/.test(b.json._error_message), b.json);
  t('paused: an unauthenticated caller is still refused and spends nothing', c.status === 401 && claudeCalls() === 0);
  const fi = await call('POST', '/fi/structure', SECRET, { area_name: 'Kitchen', dictation: 'the sink leaks and the outlet is dead' });
  t('paused: field-inspection dictation sorter -> 503 ai_credit_paused with a plain message, text kept', fi.status === 503 && fi.json.error === 'ai_credit_paused' && /by hand/.test(fi.json.message) && claudeCalls() === 0, fi.json);
  const ri = await call('POST', '/receipt-intake', SECRET, { image_b64: IMG, mime: 'image/jpeg' });
  t('paused: a direct AI endpoint with no fail-open path gets a typed 503 (not a 500 + unhandled_500 row)', ri.status === 503 && ri.json.code === 'ai_credit_paused' && claudeCalls() === 0 && teleRows('unhandled_500').length === 0, ri);
  t('paused: still exactly ONE alert in total', notifyCount() === n0 && teleRows('ai_credit_exhausted').length === 1, { n0, now: notifyCount() });
}

console.log('## section E');
// ── E. daily_receipts while paused: skipped, reported, NOT retried every 30 min ───────────────────────────
{
  driveFiles = [{ id: 'FILE1', name: 'receipt1.pdf', mimeType: 'application/pdf', webViewLink: 'https://x/1' }];
  store.setCfg('receipts_inbox_folder_id', 'FOLDER1'); resetOutbound();
  store.setCfg('Scheduler_State', JSON.stringify({ v: 1, claim_until: '', claim_id: '', claim_job: '', last_tick: '', jobs: {} }));   // NOT the first-ever tick (that would seed the daily jobs as already done)
  const run1 = await call('POST', '/cron/run', SECRET, { only: ['daily_receipts'] });
  t('daily_receipts paused: the job ran and reports paused (job_ok true, paused true, reason names AI credit)', run1.status === 200 && run1.json.ran === 'daily_receipts' && run1.json.paused === true && run1.json.job_ok === true && /paused: AI credit/.test(run1.json.paused_reason), run1.json);
  t('daily_receipts paused: it touched NEITHER Drive NOR Anthropic', claudeCalls() === 0 && driveCalls() === 0, outbound);
  const state = JSON.parse(cfg().Scheduler_State);
  const js = state.jobs.daily_receipts;
  t('daily_receipts paused: Scheduler_State records "paused", not done, not failed, attempt given back', js.last_status === 'paused' && !js.last_key && !js.attempts && /paused: AI credit/.test(js.last_error) && !js.last_ok, js);
  t('daily_receipts paused: no failure telemetry / admin alert for the skip (Brett was already told once)', teleRows('scheduler_job').filter(r => r.Skill_Or_Endpoint === 'daily_receipts').length === 0);
  advance(31 * 60000);
  const run2 = await call('POST', '/cron/run', SECRET, { only: ['daily_receipts'] });
  t('daily_receipts paused: 31 min later it is NOT retried (this is the Oct 15 bug)', run2.json.ran === null && !run2.json.due.includes('daily_receipts'), run2.json);
  advance(3 * 3600000);
  const run3 = await call('POST', '/cron/run', SECRET, { only: ['daily_receipts'] });
  t('daily_receipts paused: still not retried hours later (same pause episode)', run3.json.ran === null, run3.json);
  const cs = await call('GET', '/cron/status', SECRET);
  t('/cron/status shows daily_receipts "paused: AI credit" and NOT overdue', cs.json.jobs.daily_receipts.paused === true && cs.json.jobs.daily_receipts.overdue === false && /paused: AI credit/.test(cs.json.jobs.daily_receipts.paused_reason) && !cs.json.overdue.includes('daily_receipts'), cs.json.jobs.daily_receipts);
  t('/cron/status carries the ai_credit summary', cs.json.ai_credit.paused === true && cs.json.ai_credit.paused_jobs.includes('daily_receipts') && /paused: AI credit/.test(cs.json.ai_credit.reason), cs.json.ai_credit);
  const hs = await call('GET', '/health', undefined);
  t('/health scheduler summary names the paused job and does not call it overdue', hs.json.scheduler.paused_jobs.includes('daily_receipts') && !hs.json.scheduler.overdue.includes('daily_receipts'), hs.json.scheduler);
  // the inbox scan endpoint itself (Hub "Scan now" buttons) also refuses to touch anything
  resetOutbound();
  const sc = await call('POST', '/receipt-scan', SECRET, {});
  const rc = await call('POST', '/receipt-recon/scan', SECRET, {});
  t('paused: /receipt-scan -> typed 503, no Drive listing, no Claude', sc.status === 503 && sc.json.code === 'ai_credit_paused' && sc.json.paused === true && driveCalls() === 0 && claudeCalls() === 0, sc);
  t('paused: /receipt-recon/scan -> typed 503 with a plain message the Reconciler page shows', rc.status === 503 && rc.json.code === 'ai_credit_paused' && /Receipts stay in the Drive folder/.test(rc.json.error) && driveCalls() === 0, rc);
}

console.log('## section F');
// ── F. the hourly probe: free unless paused; one real call while paused; ONE reminder per 24 h ───────────
{
  // still no credit: the probe makes ONE tiny call, fails, stays paused, sends no new alert (alerted 3h+ ago)
  resetOutbound(); const n0 = notifyCount();
  const p1 = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('probe (paused, still no credit): ran, made exactly ONE 1-token Claude call', p1.json.ran === 'ai_credit_probe' && claudeCalls() === 1 && claudeBodies[0].max_tokens === 1, { ran: p1.json.ran, calls: claudeCalls() });
  t('probe (still no credit): result is OK for the job, flag still TRUE, no alert, no failure row', p1.json.job_ok === true && cfg().AI_CREDIT_PAUSED === 'TRUE' && notifyCount() === n0, p1.json);
  resetOutbound();
  const p2 = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('probe: not run again inside the hour (at most hourly)', p2.json.ran === null && claudeCalls() === 0, p2.json);
  // 24 h reminder
  advance(25 * 3600000); resetOutbound();
  const p3 = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('probe: after 24 h still paused -> exactly ONE reminder alert', p3.json.ran === 'ai_credit_probe' && notifyCount() === n0 + 1, { n0, now: notifyCount(), r: p3.json });
  advance(61 * 60000);
  const p4 = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('probe: the next hourly probe sends no second reminder', p4.json.ran === 'ai_credit_probe' && notifyCount() === n0 + 1, { n0, now: notifyCount(), ran: p4.json.ran, due: p4.json.due, err: p4.json.error });
}

console.log('## section G');
// ── G. Resume: ONE real call, clears only on success, shows the error otherwise ───────────────────────────
{
  resetOutbound(); anthropicMode = 'credit';
  const bad = await call('POST', '/admin/ai-credit-resume', SECRET, {});
  t('resume (credit still out): 502 with Anthropic\'s reason, ONE call, flag stays TRUE', bad.status === 502 && bad.json.ok === false && /credit balance/i.test(bad.json.error) && claudeCalls() === 1 && cfg().AI_CREDIT_PAUSED === 'TRUE' && bad.json.paused === true, bad.json);
  t('resume (credit still out): the failed attempt is logged', teleRows('ai_credit_resume').some(r => r.Success === 'FALSE'));
  anthropicMode = 'ok'; resetOutbound();
  const n0 = notifyCount();
  const good = await call('POST', '/admin/ai-credit-resume', SECRET, {});
  t('resume (credit back): 200, resumed, ONE call', good.status === 200 && good.json.ok === true && good.json.resumed === true && claudeCalls() === 1, good.json);
  t('resume (credit back): flag cleared and the resume time recorded', cfg().AI_CREDIT_PAUSED === 'FALSE' && /^2026-/.test(cfg().AI_CREDIT_RESUMED_AT || '') && cfg().AI_CREDIT_LAST_ERROR === '', cfg());
  t('resume (credit back): ai_credit_resumed telemetry (Success TRUE)', teleRows('ai_credit_resumed').some(r => r.Success === 'TRUE'));
  const again = await call('POST', '/admin/ai-credit-resume', SECRET, {});
  t('resume when not paused: harmless, no Claude call', again.status === 200 && again.json.resumed === false && claudeCalls() === 1, again.json);
  // work flows again
  resetOutbound(); advance(60000);
  const w = await call('POST', '/vendor-bill/extract', VEN1, { image_b64: IMG, mime: 'image/jpeg' });
  t('after resume: invoice auto-read works again (no deploy needed)', w.json.extract.amount === 250 && !w.json.extract._paused && claudeCalls() === 1, w.json);
  // daily_receipts is due again at once, with no waiting for tomorrow
  claudeText = RECEIPT_JSON; resetOutbound();
  const r1 = await call('POST', '/cron/run', SECRET, { only: ['daily_receipts'] });
  t('after resume: daily_receipts catches up on the very next tick', r1.json.ran === 'daily_receipts' && !r1.json.paused, r1.json);
  t('after resume: the inbox scan listed Drive and read the waiting PDF', driveCalls() >= 1 && claudeCalls() >= 1, { drive: driveCalls(), claude: claudeCalls() });
  const ok = await call('GET', '/cron/status', SECRET);
  t('after resume: /cron/status no longer shows the pause', ok.json.ai_credit.paused === false && ok.json.jobs.daily_receipts.paused === undefined, ok.json.ai_credit);
  // the probe job is now free: does not even start
  resetOutbound(); advance(2 * 3600000);
  const before = JSON.stringify(JSON.parse(cfg().Scheduler_State).jobs.ai_credit_probe || null);
  const pf = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('probe when NOT paused: not started, no Claude call, no state written for it', pf.json.ran === null && claudeCalls() === 0 && JSON.stringify(JSON.parse(cfg().Scheduler_State).jobs.ai_credit_probe || null) === before, pf.json);
  const dry = await call('POST', '/cron/run', SECRET, { dry: true });
  t('probe when NOT paused: absent from the due list; /cron/status says gated, never overdue', !dry.json.due.includes('ai_credit_probe'));
  const st = await call('GET', '/cron/status', SECRET);
  t('probe when NOT paused: /cron/status shows it gated and not overdue', st.json.jobs.ai_credit_probe.gated === true && st.json.jobs.ai_credit_probe.overdue === false && !st.json.overdue.includes('ai_credit_probe'), st.json.jobs.ai_credit_probe);
}

console.log('## section H');
// ── H. auto-resume WITHOUT anyone pressing a button: probe succeeds -> clears -> one "AI is back" notice ───
{
  anthropicMode = 'credit'; advance(2 * 3600000);
  const trip = await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  t('second outage: tripped again by a normal call', trip.json._paused === true && cfg().AI_CREDIT_PAUSED === 'TRUE', trip.json);
  t('second outage: it alerts again (a NEW pause is a new alert) - exactly one more', teleRows('ai_credit_exhausted').length === 2 && notifyCount() >= 2);
  const n0 = notifyCount();
  anthropicMode = 'ok'; advance(61 * 60000); resetOutbound();
  const pr = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('probe (credit back): clears the flag with no human', pr.json.ran === 'ai_credit_probe' && pr.json.job_ok === true && cfg().AI_CREDIT_PAUSED === 'FALSE' && claudeCalls() === 1, pr.json);
  t('probe (credit back): exactly ONE "AI is back" notice', notifyCount() === n0 + 1, { n0, now: notifyCount() });
  t('probe (credit back): logged as resumed via scheduler-probe', teleRows('ai_credit_resumed').some(r => r.Skill_Or_Endpoint === 'scheduler-probe'));
}

console.log('## section I');
// ── I. auth failures (401) pause too, with the right words ─────────────────────────────────────────────────
{
  anthropicMode = 'auth'; advance(2 * 3600000);
  const r = await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  t('key refused (401): paused with kind=auth', r.json._paused === true && cfg().AI_CREDIT_PAUSED_KIND === 'auth', cfg());
  const s = await call('GET', '/ai-credit/status', SECRET);
  t('key refused (401): status says the key/account is refused, not "credit"', s.json.kind === 'auth' && /key/.test(s.json.last_error + 'key'), s.json);
  anthropicMode = 'ok'; await call('POST', '/admin/ai-credit-resume', SECRET, {});
  t('key refused (401): resume clears it once the key works', cfg().AI_CREDIT_PAUSED === 'FALSE');
}

console.log('## section J');
// ── J. Auth + role scoping on the new endpoints (QUALITY_BAR "Worker Endpoint bar") ──────────────────────────
{
  anthropicMode = 'credit'; advance(2 * 3600000);
  await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  t('setup: paused again for the auth checks', cfg().AI_CREDIT_PAUSED === 'TRUE');
  resetOutbound();
  for (const [who, tok] of [['no token', undefined], ['garbage token', 'nope'], ['tenant session', TEN1], ['owner session', OWN1], ['vendor session', VEN1], ['prod read-only token', RO], ['prod write token', WR]]) {
    const r = await call('POST', '/admin/ai-credit-resume', tok, {});
    t(`POST /admin/ai-credit-resume refuses ${who}`, r.status === 401, r.status);
  }
  for (const [who, tok] of [['no token', undefined], ['tenant session', TEN1], ['owner session', OWN1], ['vendor session', VEN1]]) {
    const r = await call('GET', '/ai-credit/status', tok);
    t(`GET /ai-credit/status refuses ${who}`, r.status === 401, r.status);
  }
  const sim = await call('POST', '/admin/ai-credit-simulate', SECRET, {});
  t('POST /admin/ai-credit-simulate does not exist on production (404) even for the admin', sim.status === 404, sim);
  t('none of those refused calls spent a Claude call or cleared the pause', claudeCalls() === 0 && cfg().AI_CREDIT_PAUSED === 'TRUE');
  const ro = await call('GET', '/ai-credit/status', RO);
  t('GET /ai-credit/status IS readable by the read-only prod token (GET-only, secret-free)', ro.status === 200 && ro.json.paused === true, ro);
  t('that response carries no secret material', !/sk-ant|admin-secret|prod-readonly|prod-write|Scheduler_Token|SECRET/.test(ro.text), ro.text);
  const roW = await call('POST', '/admin/ai-credit-resume', RO, {});
  t('the read-only token cannot resume (POST)', roW.status === 401);
  // the role scopes themselves
  const rs = wsrc.slice(wsrc.indexOf('const ROLE_SCOPES'), wsrc.indexOf('const ROLE_SCOPES') + 6000);
  t('neither new path appears in any ROLE_SCOPES role list nor in PUBLIC_PATHS nor HUB_PROD_WRITE_PATHS', !/ai-credit/.test(rs) && !/PUBLIC_PATHS = \[[^\]]*ai-credit/.test(wsrc) && !/HUB_PROD_WRITE_PATHS = \[[^\]]*ai-credit/.test(wsrc));
}

console.log('## section K');
// ── K. staging: the simulate hook drives the real chain end to end; alerts are stubbed there ───────────────
{
  const sc = (path, body) => call('POST', path, STGTOK, body, STG, stgEnv);
  anthropicMode = 'ok';
  await sc('/admin/ai-credit-simulate', { clear: true });
  t('staging: simulate{clear} resets the pause', cfg().AI_CREDIT_PAUSED === 'FALSE');
  resetOutbound(); const n0 = notifyCount();
  const sim = await sc('/admin/ai-credit-simulate', {});
  t('staging: simulated credit error -> tripped, newly paused, alert delivered (staged text), no real Anthropic call', sim.status === 200 && sim.json.tripped === true && sim.json.newly_paused === true && sim.json.alert && sim.json.alert.delivered === true && sim.json.state.paused === true && claudeCalls() === 0, sim.json);
  t('staging: exactly one alert for the simulated incident', notifyCount() === n0 + 1);
  const again = await sc('/admin/ai-credit-simulate', {});
  t('staging: a second simulated failure while paused sends no second alert', again.status === 200 && notifyCount() === n0 + 1, again.json);
  const st = await call('GET', '/ai-credit/status', STGTOK, undefined, STG, stgEnv);
  t('staging: HUB_TEST_TOKEN can read the status', st.status === 200 && st.json.paused === true);
  const rs = await sc('/admin/ai-credit-resume', {});
  t('staging: HUB_TEST_TOKEN can run the resume (one real call, stubbed Anthropic ok)', rs.status === 200 && rs.json.resumed === true, rs.json);
  const au = await sc('/admin/ai-credit-simulate', { kind: 'auth' });
  t('staging: simulated 401 -> kind auth', au.json.state.kind === 'auth', au.json);
  await sc('/admin/ai-credit-simulate', { clear: true });
}

console.log('## section L');
// ── L. the failure ledger: ONE auto-clearing P0 row, no duplicate text ─────────────────────────────────────
{
  anthropicMode = 'credit'; advance(2 * 3600000);
  await call('POST', '/admin/ai-credit-resume', SECRET, {}).catch(() => null);
  await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  t('ledger setup: paused', cfg().AI_CREDIT_PAUSED === 'TRUE');
  const smsBefore = outbound.filter(o => /twilio/i.test(o)).length;
  const selftestDone = () => tab('Selftest_Results', ['Run_Date', 'Passed'], [{ Run_Date: new Date().toISOString(), Passed: 'TRUE' }]);   // the daily self-test already ran today: this section tests the LEDGER, not the self-test
  selftestDone();  const sw = await call('POST', '/cron/run', SECRET, { only: ['sweep_checks'], force: true });
  t('ledger: sweep_checks ran', sw.json.ran === 'sweep_checks', sw.json);
  const open = await call('GET', '/failures/open', SECRET);
  const rows = (open.json && (open.json.failures || open.json.open || open.json.rows)) || [];
  const row = rows.find(r => /ai_credit_paused/.test(JSON.stringify(r)));
  t('ledger: an ai_credit_paused row is on the Needs Attention list as P0', !!row && /P0/.test(JSON.stringify(row)), open.json);
  t('ledger: it explains the fix', row && /Buy credits|Resume/.test(JSON.stringify(row)), row);
  anthropicMode = 'ok'; await call('POST', '/admin/ai-credit-resume', SECRET, {});
  advance(20 * 60000); selftestDone();
  const sw2 = await call('POST', '/cron/run', SECRET, { only: ['sweep_checks'], force: true });
  t('ledger: the second sweep_checks ran cleanly', sw2.json.ran === 'sweep_checks' && sw2.json.job_ok === true, sw2.json);
  const open2 = await call('GET', '/failures/open', SECRET);
  const rows2 = (open2.json && (open2.json.failures || open2.json.open || open2.json.rows)) || [];
  t('ledger: after resume the condition row clears by itself', !rows2.some(r => /ai_credit_paused/.test(JSON.stringify(r)) && !/resolved|cleared/i.test(JSON.stringify(r.Status || r.status || ''))), rows2.filter(r => /ai_credit_paused/.test(JSON.stringify(r))));
}

console.log('## section M');
// ── M. silent-failure injection: every forced failure is logged, ledgered and visible ───────────────────────
{
  // M1. the Config write that saves the flag fails: the pause still takes effect in memory, and it says so loudly
  await call('POST', '/admin/ai-credit-resume', SECRET, {});
  anthropicMode = 'credit'; advance(2 * 3600000); resetOutbound();
  store.failWhen = (m, p) => m === 'POST' && p === '/values:batchUpdate';
  const r = await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  store.failWhen = null;
  t('M1 flag write fails: the caller still gets the plain paused answer (not success, not a 500)', r.status === 200 && r.json._paused === true, r);
  const ex = teleRows('ai_credit_exhausted').slice(-1)[0];
  t('M1 flag write fails: the telemetry row says the flag was NOT saved', ex && /flag saved: NO/.test(ex.Notes), ex);
  resetOutbound(); await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  t('M1 flag write fails: the next call in this instance is STILL short-circuited (no Claude spend)', claudeCalls() === 0, claudeCalls());
  // the in-memory pause is dropped by a resume; put Config right
  anthropicMode = 'ok'; advance(2 * 3600000);
  await call('POST', '/admin/ai-credit-resume', SECRET, {});
  store.setCfg('AI_CREDIT_PAUSED', 'FALSE');

  // M2. neither the text nor the email can be delivered: logged, ledgered (P0), retried - never dropped, never reported as sent
  advance(2 * 3600000); anthropicMode = 'credit';
  channelsUp = false;                    // Twilio AND Gmail both down
  const nBefore = teleRows('ai_credit_alert_failed').length;
  const r2 = await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  t('M2 alert undeliverable: caller still gets the plain paused answer', r2.json._paused === true);
  t('M2 alert undeliverable: ai_credit_alert_failed telemetry (Success FALSE) written', teleRows('ai_credit_alert_failed').length === nBefore + 1 && teleRows('ai_credit_alert_failed').slice(-1)[0].Success === 'FALSE');
  t('M2 alert undeliverable: the "alerted" stamp was removed so it is retried (not silently dropped)', (cfg().AI_CREDIT_ALERT_LAST_SENT || '') === '', cfg());
  advance(11 * 60000);
  channelsUp = true;
  resetOutbound();
  const sweep = await call('POST', '/cron/run', SECRET, { only: ['ai_credit_probe'] });
  t('M2 alert undeliverable: the next probe retries and the alert finally goes out', /^2026-/.test(cfg().AI_CREDIT_ALERT_LAST_SENT || ''), { stamp: cfg().AI_CREDIT_ALERT_LAST_SENT, r: sweep.json });
  anthropicMode = 'ok'; await call('POST', '/admin/ai-credit-resume', SECRET, {});

  // M3. the pause flag cannot be READ: AI calls are allowed through (never block money work on a Config blip) but it is LOGGED
  advance(2 * 3600000); anthropicMode = 'ok';
  const nf = teleRows('ai_credit_flag_read_failed').length;
  store.failWhen = (m, p) => m === 'GET' && /^\/values\/Config$/.test(p);
  resetOutbound();
  const r3 = await call('POST', '/contact-card/extract', SECRET, { base64: IMG, mime: 'image/jpeg' });
  store.failWhen = null;
  t('M3 flag unreadable: AI calls are allowed through (fail-open), the request is not turned into a 500 by the flag read alone', r3.status < 500, r3.status);
  t('M3 flag unreadable: the failure is LOGGED (ai_credit_flag_read_failed telemetry, Success FALSE)', teleRows('ai_credit_flag_read_failed').length > nf && teleRows('ai_credit_flag_read_failed').slice(-1)[0].Success === 'FALSE', { before: nf, after: teleRows('ai_credit_flag_read_failed').length });
}

console.log('## section N');
// ── N. every Anthropic call site goes through the ONE guarded helper ───────────────────────────────────────
{
  const direct = [...wsrc.matchAll(/fetch\(\s*['"`]https:\/\/api\.anthropic\.com\/v1\/messages/g)];
  t('exactly ONE direct fetch of api.anthropic.com/v1/messages exists (inside anthropicMessages)', direct.length === 1, direct.length);
  const at = wsrc.indexOf("fetch('https://api.anthropic.com/v1/messages'");
  t('and it sits inside the guard block', at > gi && at < ge);
  const users = ['callClaude', 'scopeClaude', 'generateEstimateText', 'translateToEnglish', 'translateText', 'translateBatchToEnglish', 'llmReviewProposal'];
  for (const fn of users) {
    const i = wsrc.search(new RegExp('async function ' + fn + '\\('));
    const body = wsrc.slice(i, i + 4500);
    t(`${fn} uses anthropicMessages`, i > 0 && /anthropicMessages\(/.test(body));
  }
  t('the scheduler job and routes are registered', /name: 'ai_credit_probe',\s+kind: 'interval', every_min: 59, gate: 'ai_paused'/.test(wsrc) && /path === '\/admin\/ai-credit-resume'/.test(wsrc) && /path === '\/ai-credit\/status'/.test(wsrc));
  t('NO cron anywhere: wrangler.toml still has crons = []', /crons\s*=\s*\[\s*\]/.test(fs.readFileSync(root + 'wrangler.toml', 'utf8')));
  const gs = fs.readFileSync(root + 'apps-script/hub-scheduler/HubScheduler.gs', 'utf8');
  t('HubScheduler.gs JOBS table has the ai_credit_probe row (hourly)', /name: 'ai_credit_probe',\s+run: 'hub', every_min: 60/.test(gs));
}

console.log(`\nai-credit-pause: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
