// Oct 20 2026 review fixes (Worker side), three small fault-injection tests on the REAL functions extracted from worker.js:
//  (a) qbAccessToken: the Config refresh token wins over an older in-memory rotated one, UNLESS that rotated token could not be saved (_qbRotated.saved === false)
//  (b) alertAdminOnFailure: a refused admin number (Twilio 21610 etc.) is a P0 `admin_sms_undeliverable`, and the hourly debounce key is NOT written
//  (c) trashUnbilled: a failed tab read is pushed into `items` as {type:'load_error'} and counted in `count` (old consumers only read items/count)
// Run: node test/review-fixes-worker.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
console.error = () => {};
const json = (b, s) => ({ body: b, status: s || 200 });

// ═════════ (a) qbAccessToken: Config token vs in-memory rotated token ═════════
console.log('qbAccessToken token preference');
let CONFIG, SET_FAIL, FETCHES, FETCH_PLAN, REPORTS;
const sheetsRequest = async () => ({ values: Object.entries(CONFIG).map(([k, v]) => [k, v]) });
const setConfigKey = async (env, { key, value }) => { if (SET_FAIL) throw new Error('Sheets 503 on write'); CONFIG[key] = value; return { status: 200 }; };
const reportFailure = async (env, f) => { REPORTS.push(f); return { ok: true }; };
const fetchStub = async (url, opts) => {
  FETCHES.push({ url, opts });
  const plan = FETCH_PLAN.shift(); if (!plan) throw new Error('unplanned fetch ' + url);
  return { ok: plan.status < 400, status: plan.status, text: async () => JSON.stringify(plan.body) };
};
const piecesA = [grab('failSetConfig'), grab('fetchConfig'), grab('fetchConfigStrict'), 'let _qbRotated = null;', grab('qbPersistRefreshToken'), grab('qbAccessToken')].join('\n');
const W = new Function('sheetsRequest', 'setConfigKey', 'reportFailure', 'softNote', 'fetch', 'isStaging', 'json', 'QB_TOKEN_URL', 'btoa',
  piecesA + '\nreturn { qbAccessToken, resetRot: () => { _qbRotated = null; } };')(sheetsRequest, setConfigKey, reportFailure, () => true, fetchStub, () => false, json, 'https://oauth.example/tokens', (s) => Buffer.from(s, 'binary').toString('base64'));
const env0 = { QB_CLIENT_ID: 'cid', QB_CLIENT_SECRET: 'sec', QB_REALM_ID: '123', QB_REFRESH_TOKEN: 'ENV-SEED' };
const reset = () => { CONFIG = { QB_REFRESH_TOKEN: 'OLD-RT' }; SET_FAIL = false; FETCHES = []; FETCH_PLAN = []; REPORTS = []; W.resetRot(); };
const sentToken = (i) => decodeURIComponent((/refresh_token=([^&]+)/.exec(FETCHES[i].opts.body) || [])[1] || '');

// saved OK, then ANOTHER isolate rotates again (Config now holds a newer token): this instance must use Config, not its older in-memory copy
reset(); FETCH_PLAN = [{ status: 200, body: { access_token: 'A1', refresh_token: 'RT-1' } }];
await W.qbAccessToken(env0);
ok(CONFIG.QB_REFRESH_TOKEN === 'RT-1', 'first refresh rotated and saved the token to Config');
CONFIG.QB_REFRESH_TOKEN = 'RT-FROM-OTHER-ISOLATE'; FETCH_PLAN = [{ status: 200, body: { access_token: 'A2', refresh_token: 'RT-2' } }];
await W.qbAccessToken(env0);
ok(sentToken(1) === 'RT-FROM-OTHER-ISOLATE', 'saved:true -> the (newer) Config token is preferred over the older in-memory rotated one', sentToken(1));
// the save FAILED: the in-memory token is the only valid one, so it must win over the stale Config copy
reset(); SET_FAIL = true; FETCH_PLAN = [{ status: 200, body: { access_token: 'A1', refresh_token: 'RT-UNSAVED' } }];
await W.qbAccessToken(env0);
SET_FAIL = false; FETCH_PLAN = [{ status: 200, body: { access_token: 'A2', refresh_token: 'RT-NEXT' } }];
await W.qbAccessToken(env0);
ok(sentToken(1) === 'RT-UNSAVED', 'saved:false (Config write failed) -> the in-memory rotated token is used, not the stale Config copy', sentToken(1));
ok(/_qbRotated\.saved === false|!_qbRotated\.saved/.test(grab('qbAccessToken')), 'source: the in-memory override is gated on the saved flag');

// ═════════ (b) alertAdminOnFailure: refused admin number = P0, no debounce write ═════════
console.log('\nalertAdminOnFailure');
let CFG, SMS_RESULT, SOFTFAILS, CFG_SET;
const piecesB = [grab('alertAdminOnFailure'), grab('alertDebounceOk')].join('\n');
const B = new Function('fetchConfig', 'sendSMS', 'softFail', 'failSetConfig', piecesB + '\nreturn { alertAdminOnFailure };')(
  async () => CFG, async () => SMS_RESULT, async (env, where, e, sev, ctx) => { SOFTFAILS.push({ where, sev, msg: String((e && e.message) || e), ctx }); },
  async (env, key, value) => { CFG_SET.push([key, value]); });
const resetB = () => { CFG = { failure_alert_enabled: 'TRUE', admin_phone: '+14105550100' }; SMS_RESULT = { sent: true }; SOFTFAILS = []; CFG_SET = []; };
resetB(); SMS_RESULT = { error: 'Twilio HTTP 400 code 21610: The message From/To pair violates a blacklist rule.' };
let r = await B.alertAdminOnFailure({}, 'wo_create', 'boom');
ok(r.sent === false && /21610/.test(r.error), 'a refused admin number returns sent:false with the Twilio error');
ok(SOFTFAILS.some(f => f.where === 'admin_sms_undeliverable' && f.sev === 'P0' && /21610/.test(f.msg)), 'it is reported as admin_sms_undeliverable at P0', SOFTFAILS);
ok(CFG_SET.length === 0, 'the failure_alert_last_sent_* debounce key is NOT written (the rollup would treat the P0 as already texted)', CFG_SET);
resetB(); SMS_RESULT = { error: 'Twilio HTTP 500 upstream' };
r = await B.alertAdminOnFailure({}, 'wo_create', 'boom');
ok(r.sent === false && !SOFTFAILS.some(f => f.where === 'admin_sms_undeliverable') && CFG_SET.length === 0, 'a transient send error is not labelled undeliverable, and still does not write the debounce key');
resetB();
r = await B.alertAdminOnFailure({}, 'wo_create', 'boom');
ok(r.sent === true && CFG_SET.length === 1 && CFG_SET[0][0] === 'failure_alert_last_sent_wo_create' && SOFTFAILS.length === 0, 'happy path: sent, debounce key written, nothing reported');

// ═════════ (c) trashUnbilled: failed read -> load_error item + count ═════════
console.log('\ntrashUnbilled');
let TABS, TAB_FAIL, TSOFT;
const piecesC = [constLine('TRASH_DOW'), grab('trashWeekKey'), grab('trashPastDeadline'), grab('trashIsSkipped'), grab('trashReadTab'), grab('trashUnbilled')].join('\n');
const C = new Function('fetchTab', 'softFail', 'json', piecesC + '\nreturn { trashUnbilled };')(
  async (env, tab) => { if (TAB_FAIL && TAB_FAIL.has(tab)) throw new Error('Sheets read failed for ' + tab); return TABS[tab] || []; },
  async (env, where, e, sev) => { TSOFT.push({ where, sev }); }, json);
const resetC = () => { TABS = { Trash_Properties: [{ ID: 'p1', Label: 'Bldg 1', Visits_Per_Week: '2', Nudge_Day: 'Thu' }], Trash_Visits: [], Trash_Skips: [] }; TAB_FAIL = null; TSOFT = []; };
resetC();
const clean = await C.trashUnbilled({}, null);
const cleanItems = clean.body.items.filter(i => i.type !== 'load_error');
ok(clean.body.items.length === cleanItems.length && clean.body.count === clean.body.items.length && !('load_errors' in clean.body), 'no failure: no load_error items, count === items.length, no load_errors key');
resetC(); TAB_FAIL = new Set(['Trash_Visits', 'Trash_Skips']);
const bad = await C.trashUnbilled({}, null);
const le = bad.body.items.filter(i => i.type === 'load_error');
ok(le.length === 2 && /Trash_Visits/.test(le[0].message) && /Trash_Skips/.test(le[1].message), 'each failed tab read is pushed into items as {type:"load_error", message}', le);
ok(bad.body.count === bad.body.items.length && bad.body.count >= 2 && Array.isArray(bad.body.load_errors) && bad.body.load_errors.length === 2, 'count includes the load_error items (old consumers read count/items only) and load_errors is still returned', { count: bad.body.count });
ok(TSOFT.length === 2 && TSOFT.every(f => f.sev === 'P1'), 'both failed reads are also reported to the ledger at P1');

console.log(`\nreview-fixes-worker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
