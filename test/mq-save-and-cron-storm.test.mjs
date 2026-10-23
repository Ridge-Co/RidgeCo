// Oct 23 2026 - (1) "lost text": a text that really went out must never be left marked pending without anyone being told;
// (2) cron retry storm: a throttled background read gives up fast, door-critical + people keep the full retries.
// Fault injection: every failure below is FORCED (Google 429s, a dead Message_Queue write) and we assert it is reported with the right
// severity, the caller sees it, and the happy path reports nothing.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
function grabRange(src, a, b) { const s = src.indexOf(a); if (s < 0) throw new Error('nf ' + a); const e = src.indexOf(b, s); if (e < 0) throw new Error('nf end ' + b); return src.slice(s, e); }
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL:', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };

// ───────────────────────── A. sheetsRequest: cron lane vs critical vs people ─────────────────────────
const cacheSrc = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc = grab(wsrc, 'async function sheetsRequest(');
function buildSR(script) {
  const waits = []; let calls = 0; const now = { v: 1e6 };
  const fetchImpl = async () => { calls++; const r = script(calls); return { status: r.error ? r.error.code : 200, json: async () => r }; };
  const mod = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date',
    cacheSrc + '\n' + srSrc + '\nreturn { sheetsRequest, __cronEnv, __cronLast429At, CRON_QUOTA_COOLDOWN_MS };'
  )(async () => 'tok', fetchImpl, (fn, ms) => { waits.push(ms); now.v += ms; fn(); }, { now: () => now.v });
  return Object.assign(mod, { waits, calls: () => calls });
}
const Q429 = { error: { code: 429, message: "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'" } };
const OK = { values: [['ID'], ['1']] };
const base = { SHEET_ID: 'S' };
{
  const m = buildSR(() => Q429); const c = m.__cronEnv(base);
  let err = null; try { await m.sheetsRequest(c, 'GET', '/values/Work_Orders'); } catch (e) { err = e; }
  t('STORM cron non-critical read: gives up after 2 tries (was 6) and throws the quota error to the job', m.calls() === 2 && err && /^Sheets API error on GET .*Quota exceeded/.test(err.message), [m.calls(), err && err.message]);
  t('STORM cron non-critical read: only one short retry wait (2 s), not ~15 s of backoff', m.waits.filter(w => w > 0 && w < 2600).length >= 1 && m.waits.reduce((a, b) => a + b, 0) < 8000, m.waits);
  t('STORM the 429 is recorded for the dispatcher (starts the cooldown)', m.__cronLast429At() > 0);
}
{
  const m = buildSR(() => Q429); const c = m.__cronEnv(base); c.__CRON_CRITICAL__ = true;
  let err = null; try { await m.sheetsRequest(c, 'GET', '/values/Work_Orders'); } catch (e) { err = e; }
  t('door-critical cron read keeps all 6 tries', m.calls() === 6 && !!err, m.calls());
}
{
  const m = buildSR(() => Q429);
  let err = null; try { await m.sheetsRequest(base, 'GET', '/values/Work_Orders'); } catch (e) { err = e; }
  t('a PERSON\'s read keeps all 6 tries', m.calls() === 6 && !!err, m.calls());
  t('a person\'s 429 does NOT start the background cooldown', m.__cronLast429At() === 0);
}
{
  const m = buildSR(() => Q429); const c = m.__cronEnv(base);
  let err = null; try { await m.sheetsRequest(c, 'POST', '/values:batchUpdate', { data: [] }); } catch (e) { err = e; }
  t('cron WRITES are unchanged (4 tries): the fast lane is for reads only', m.calls() === 4 && !!err, m.calls());
}
{
  const m = buildSR((n) => n === 1 ? Q429 : OK); const c = m.__cronEnv(base);
  const r = await m.sheetsRequest(c, 'GET', '/values/Work_Orders');
  t('one blip then OK: the single retry succeeds, caller gets the data', m.calls() === 2 && r.values.length === 2);
  t('...and the blip is still recorded', m.__cronLast429At() > 0);
}
{
  const m = buildSR(() => OK); const c = m.__cronEnv(base);
  await m.sheetsRequest(c, 'GET', '/values/Work_Orders');
  t('HAPPY path: one call, no retry wait beyond pacing, no 429 recorded', m.calls() === 1 && m.__cronLast429At() === 0);
}

// ───────────────────────── B. updateMessageQueueRow: the post-send status save ─────────────────────────
const mqSrc = grab(wsrc, 'async function mqReportFailure(') + '\n' + grab(wsrc, 'async function updateMessageQueueRow(');
function buildMQ(over) {
  over = over || {};
  const log = { gets: 0, posts: [], telemetry: [], alerts: [], waits: [] };
  const headers = ['ID', 'WO_ID', 'Status', 'Delivered_To', 'Sent_Date', 'Twilio_Message_SID', 'Send_After', 'Gate_Snapshot'];
  const sheetsRequest = async (env, method, path, body) => {
    if (method === 'GET') { log.gets++; if (over.getFails && log.gets <= over.getFails) throw new Error('Sheets API error on GET /values/Message_Queue: Quota exceeded for quota metric'); return { values: [headers, ['41', 'WO-1', 'pending'], ['42', 'WO-2', 'pending']] }; }
    log.posts.push(body);
    if (over.postFails === Infinity || (over.postFails && log.posts.length <= over.postFails)) throw new Error('Sheets API error on POST /values:batchUpdate: Quota exceeded for quota metric');
    return { totalUpdatedCells: over.shortCells ? 1 : body.data.length };
  };
  const logTelemetry = async (env, rec) => { log.telemetry.push(rec); };
  const alertAdminOnFailure = async (env, k, m) => { log.alerts.push({ k, m }); return { sent: true }; };
  const col = (i) => String.fromCharCode(65 + i);
  const fn = new Function('sheetsRequest', 'logTelemetry', 'alertAdminOnFailure', 'col', 'MSG_QUEUE_TAB', 'setTimeout', 'console',
    mqSrc + '\nreturn { updateMessageQueueRow };')(sheetsRequest, logTelemetry, alertAdminOnFailure, col, 'Message_Queue', (f, ms) => { log.waits.push(ms); f(); }, { error() {}, warn() {}, log() {} });
  return Object.assign(fn, { log, headers });
}
const SENT = { Status: 'sent', Delivered_To: '+14105550100', Sent_Date: 'now', Twilio_Message_SID: 'SM123abc' };
{
  const m = buildMQ(); const ok = await m.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3, headers: m.headers });
  t('LOST TEXT: with headers + row from the send, the save reads NOTHING (no whole-tab read to hit the quota)', ok === true && m.log.gets === 0 && m.log.posts.length === 1, m.log);
  t('...and writes the right cells (row 3: Status C, Delivered_To D, SID F)', m.log.posts[0].data.map(d => d.range).join() === 'Message_Queue!C3,Message_Queue!D3,Message_Queue!E3,Message_Queue!F3', m.log.posts[0].data.map(d => d.range));
  t('HAPPY path reports nothing (no telemetry, no alert, no waits)', m.log.telemetry.length === 0 && m.log.alerts.length === 0 && m.log.waits.length === 0);
}
{
  const m = buildMQ(); const ok = await m.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3 });
  t('no headers passed: falls back to one tab read (old behaviour for other callers)', ok === true && m.log.gets === 1 && m.log.posts.length === 1);
  const m2 = buildMQ(); const ok2 = await m2.updateMessageQueueRow({}, '42', { Status: 'skipped' });
  t('no row number either: finds the row by id', ok2 === true && m2.log.gets === 1 && m2.log.posts[0].data[0].range === 'Message_Queue!C3');
}
{
  // FAULT: two quota failures, then it lands - the text is correctly marked, nobody is paged
  const m = buildMQ({ postFails: 2 }); const ok = await m.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3, headers: m.headers });
  t('FAULT quota x2 then OK: saved on the 3rd try', ok === true && m.log.posts.length === 3, m.log.posts.length);
  t('...waited 2.5 s then 8 s between tries (the quota is per minute)', m.log.waits.join() === '2500,8000', m.log.waits);
  t('...and a recovered blip is NOT a P0 page', m.log.telemetry.length === 0 && m.log.alerts.length === 0);
}
{
  // FAULT: it never lands -> reported once, P0 type, with the Twilio SID + phone so the row can be fixed by hand; caller gets false
  const m = buildMQ({ postFails: Infinity }); const ok = await m.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3, headers: m.headers });
  t('FAULT save never lands: returns false (caller must handle it)', ok === false);
  t('...4 tries over ~30 s before giving up', m.log.posts.length === 4 && m.log.waits.join() === '2500,8000,20000', [m.log.posts.length, m.log.waits]);
  const r = m.log.telemetry;
  t('...exactly ONE message_queue_update Success=FALSE row (the P0 type in the ledger)', r.length === 1 && r[0].Job_Type === 'message_queue_update' && r[0].Success === 'FALSE', r);
  t('...that names the Twilio SID, the phone and the status it wanted, so the sent text can be reconciled', /SM123abc/.test(r[0].Notes) && /\+14105550100/.test(r[0].Notes) && /Status=sent/.test(r[0].Notes), r[0] && r[0].Notes);
  t('...and the admin is alerted', m.log.alerts.length === 1 && m.log.alerts[0].k === 'message_queue_update', m.log.alerts);
}
{
  // FAULT: even the fallback header read is throttled once
  const m = buildMQ({ getFails: 1 }); const ok = await m.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3 });
  t('FAULT fallback read throttled once: retried and saved', ok === true && m.log.gets === 2 && m.log.posts.length === 1 && m.log.telemetry.length === 0);
}
{
  // data problem (retrying cannot help): reported once, not retried
  const m = buildMQ(); const ok = await m.updateMessageQueueRow({}, '999', SENT);
  t('row not found: false, reported once, NOT retried', ok === false && m.log.gets === 1 && m.log.posts.length === 0 && m.log.telemetry.length === 1 && /row not found/.test(m.log.telemetry[0].Notes) && m.log.waits.length === 0, m.log);
  const m2 = buildMQ({ shortCells: true }); const ok2 = await m2.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3, headers: m2.headers });
  t('only some cells saved: false + reported, not retried', ok2 === false && m2.log.posts.length === 1 && m2.log.telemetry.length === 1 && /cells saved/.test(m2.log.telemetry[0].Notes), m2.log);
  const m3 = buildMQ({ postFails: Infinity }); const ok3 = await m3.updateMessageQueueRow({}, '42', SENT, { sheetRow: 3, headers: m3.headers, retryWaitsMs: [] });
  t('retryWaitsMs [] = a single try (tests / callers that cannot wait)', ok3 === false && m3.log.posts.length === 1 && m3.log.telemetry.length === 1);
}

// ───────────────────────── C. smsGatedSend wiring: the caller sees a failed save ─────────────────────────
{
  const sg = grab(wsrc, 'async function smsGatedSend(');
  function buildSG(over) {
    over = over || {};
    const calls = []; let sendCount = 0;
    const stubs = {
      ensureSmsInfra: async () => {}, fetchConfig: async () => ({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }),
      normalizePhone: (p) => String(p || ''), smsToggleOn: () => true, tenantMovedOut: () => false,
      smsGateDecision: () => ({ sendOk: true, gateSnapshot: 'all gates on' }),
      translateForVendorDetailed: async () => ({ translated: false }),
      sheetsRequest: async (env, method, path) => method === 'GET' ? { values: [['ID', 'Status'], ['7', 'sent']] } : { updates: { updatedRange: 'Message_Queue!A3:H3' } },
      MSG_QUEUE_TAB: 'Message_Queue', MSG_QUEUE_COLS: ['ID', 'Status'], nextSafeId: () => 8,
      appendedRowNumber: () => 3, guardAppendedIds: async (env, tab, ap, n, idc, ids) => ({ ids, row: 3 }),
      mqReportFailure: async () => {}, etHour: () => 12, isQuietHoursNow: () => !!over.quiet, nextQuietHoursEnd: () => new Date('2026-10-24T13:00:00Z'), quietHoldUntil: () => null,
      sendSMSRaw: async () => ({ sid: 'SM999' }), logMessageAudit: async () => {},
      updateMessageQueueRow: async (env, id, fields, opts) => { calls.push({ id, fields, opts }); return over.saveFails ? false : true; },
    };
    const names = Object.keys(stubs);
    return { run: new Function(...names, sg + '\nreturn smsGatedSend;')(...names.map(n => stubs[n])), calls };
  }
  const opts = { recipient_type: 'tenant', tenant: { Phone: '+14105550111', Name: 'T' }, property: { ID: 'P1' }, message_type: 'x', message_body: 'hello', wo_id: '' };
  const h = buildSG(); const r = await h.run({}, opts);
  t('smsGatedSend passes the queue headers + row number to the save (no second read)', h.calls.length === 1 && Array.isArray(h.calls[0].opts.headers) && h.calls[0].opts.headers.join() === 'ID,Status' && h.calls[0].opts.sheetRow === 3, h.calls);
  t('HAPPY path: sent, and the result has NO warning field', r.sent === true && !('warning' in r), r);
  const h2 = buildSG({ saveFails: true }); const r2 = await h2.run({}, opts);
  t('FAULT save fails after the send: result still says sent=true (it WAS sent) AND carries a warning naming the stale "pending" row', r2.sent === true && /WAS sent/.test(r2.warning) && /pending/.test(r2.warning) && /message_queue_update/.test(r2.warning), r2);
  const h3 = buildSG({ quiet: true, saveFails: true }); const r3 = await h3.run({}, opts);
  t('FAULT the quiet-hours hold mark fails: result says held but warns it will not release by itself', r3.held_for_quiet_hours === true && /will not release by itself/.test(r3.warning), r3);
  const h4 = buildSG({ quiet: true }); const r4 = await h4.run({}, opts);
  t('HAPPY quiet-hours hold: no warning', r4.held_for_quiet_hours === true && !('warning' in r4));
}

// ───────────────────────── D. bookkeeping ─────────────────────────
{
  const ver = /const BUILD_VERSION = '([^']+)'/.exec(wsrc)[1];
  t('BUILD_VERSION names this build (suffix letters/hyphens only)', /^2026-10-23\.\d+-[a-z-]+$/.test(ver) || /^2026-10-(2[4-9]|3\d)/.test(ver) || /^2026-1[12]/.test(ver), ver);
  t('door_watchdog is flagged critical in the registry and the dispatcher marks its env', /name: 'door_watchdog',[^\n]*critical: true/.test(wsrc) && /if \(job\.critical\) jobEnv\.__CRON_CRITICAL__ = true/.test(wsrc));
  t('the post-send save has no swallowing catch (it retries then reports)', !/catch\s*\(\s*_?\s*\)\s*\{\s*\}/.test(mqSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
