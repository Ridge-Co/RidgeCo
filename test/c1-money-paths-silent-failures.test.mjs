// Fault-injection tests for the no-silent-failures "C1" chokepoints (Oct 20 2026): QuickBooks token refresh, sendSMSRaw/sendSMS, fetchConfig.
// Extracts the REAL functions from worker.js and forces each failure; asserts it is reported to the ledger with the right severity AND the caller sees an error.
// Run: node test/c1-money-paths-silent-failures.test.mjs
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

// ── fake world ──
let CONFIG, CONFIG_READ_FAIL, SET_FAIL, SET_IGNORED, FETCHES, FETCH_PLAN, REPORTS;
const env0 = { QB_CLIENT_ID: 'cid', QB_CLIENT_SECRET: 'sec', QB_REALM_ID: '123', QB_REFRESH_TOKEN: 'ENV-SEED', TWILIO_SID: 'AC1', TWILIO_API_SID: 'SK1', TWILIO_API_KEY: 'k', TWILIO_FROM: '+14105550000' };
const sheetsRequest = async (env, method, path) => { if (CONFIG_READ_FAIL) throw new Error('Sheets API error on GET /values/Config: Quota exceeded'); return { values: Object.entries(CONFIG).map(([k, v]) => [k, v]) }; };
const setConfigKey = async (env, { key, value }) => { if (SET_FAIL) throw new Error('Sheets 503 on write'); if (!SET_IGNORED) CONFIG[key] = value; return { status: 200 }; };
const reportFailure = async (env, f) => { REPORTS.push(f); return { ok: true }; };
const fetch = async (url, opts) => {
  FETCHES.push({ url, opts });
  const plan = FETCH_PLAN.shift(); if (!plan) throw new Error('unplanned fetch ' + url);
  if (plan instanceof Error) throw plan;
  return { ok: plan.status < 400, status: plan.status, text: async () => (typeof plan.body === 'string' ? plan.body : JSON.stringify(plan.body)) };
};
const isStaging = () => false;
const json = (b, s) => ({ body: b, status: s || 200 });
const normalizePhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : ''; };
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const pieces = [
  grab('failSetConfig', 'async'), grab('fetchConfig', 'async'), grab('fetchConfigStrict', 'async'),
  'let _qbRotated = null;', grab('qbPersistRefreshToken', 'async'), grab('qbAccessToken', 'async'),
  grab('smsFailSeverity'), grab('sendSMSRaw', 'async'), grab('sendSMS', 'async'),
].join('\n');
const W = new Function('sheetsRequest', 'setConfigKey', 'reportFailure', 'softNote', 'fetch', 'isStaging', 'json', 'normalizePhone', 'QB_TOKEN_URL', 'btoa', 'unescape',
  pieces + '\nreturn { fetchConfig, fetchConfigStrict, qbAccessToken, sendSMSRaw, sendSMS, smsFailSeverity, resetRot: () => { _qbRotated = null; } };')(sheetsRequest, setConfigKey, reportFailure, (where, msg, severity) => { REPORTS.push({ where, message: msg, severity }); return true; }, fetch, isStaging, json, normalizePhone, QB_TOKEN_URL, (s) => Buffer.from(s, 'binary').toString('base64'), unescape);
const reset = () => { CONFIG = { QB_REFRESH_TOKEN: 'OLD-RT', TWILIO_ENABLED: 'TRUE' }; CONFIG_READ_FAIL = false; SET_FAIL = false; SET_IGNORED = false; FETCHES = []; FETCH_PLAN = []; REPORTS = []; W.resetRot(); };
const err = origErrHush(); function origErrHush() { const o = console.error; console.error = () => {}; return o; }
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

console.log('fetchConfig');
reset();
ok((await W.fetchConfig(env0)).TWILIO_ENABLED === 'TRUE' && REPORTS.length === 0, 'healthy read returns the settings, reports nothing');
CONFIG_READ_FAIL = true;
let c = await W.fetchConfig(env0);
ok(JSON.stringify(c) === '{}' && REPORTS.length === 1 && REPORTS[0].where === 'config_read_failed' && REPORTS[0].severity === 'P1', 'a failed Config read still returns {} for old callers but is written to the ledger (P1)', REPORTS);
ok((await rejects(W.fetchConfigStrict(env0))) instanceof Error, 'fetchConfigStrict throws instead of pretending Config is empty');

console.log('\nQuickBooks token refresh');
reset(); FETCH_PLAN = [{ status: 200, body: { access_token: 'AT1', refresh_token: 'NEW-RT' } }];
ok(await W.qbAccessToken(env0) === 'AT1' && CONFIG.QB_REFRESH_TOKEN === 'NEW-RT' && REPORTS.length === 0, 'happy path: rotated token saved AND read back, nothing reported');
ok(/refresh_token=OLD-RT/.test(FETCHES[0].opts.body), 'uses the token saved in Config (not the old env seed)');
reset(); SET_FAIL = true; FETCH_PLAN = [{ status: 200, body: { access_token: 'AT2', refresh_token: 'NEW-RT2' } }];
ok(await W.qbAccessToken(env0) === 'AT2' && REPORTS.some(r => r.where === 'qb_token_not_saved' && r.severity === 'P0' && /could NOT be saved/.test(r.message)), 'rotated token cannot be saved: the caller still works but a P0 is raised at once', REPORTS);
FETCH_PLAN = [{ status: 200, body: { access_token: 'AT3', refresh_token: 'NEW-RT3' } }]; REPORTS = [];
await W.qbAccessToken(env0);
ok(/refresh_token=NEW-RT2/.test(FETCHES[1].opts.body), 'the next call in the same instance uses the newest token it was given, not the stale Config copy');
reset(); SET_IGNORED = true; FETCH_PLAN = [{ status: 200, body: { access_token: 'AT4', refresh_token: 'NEW-RT4' } }];
await W.qbAccessToken(env0);
ok(REPORTS.some(r => r.where === 'qb_token_not_saved' && /read-back/.test(r.message)), 'a write that "succeeds" but does not stick is caught by the read-back (P0)');
reset(); FETCH_PLAN = [{ status: 400, body: { error: 'invalid_grant' } }];
let e = await rejects(W.qbAccessToken(env0));
ok(e && /expired or revoked/.test(e.message) && REPORTS.some(r => r.where === 'qb_auth' && r.severity === 'P0'), 'invalid_grant: caller gets the error and a P0 is raised', REPORTS);
reset(); CONFIG_READ_FAIL = true;
e = await rejects(W.qbAccessToken(env0));
ok(e && FETCHES.length === 0 && REPORTS.some(r => r.where === 'qb_auth' && r.severity === 'P1' && /Not trying the old env token/.test(r.message)), 'Config unreadable: does NOT fall back to the stale env seed; error + P1', { fetches: FETCHES.length, REPORTS });
reset(); FETCH_PLAN = [new Error('network down')];
e = await rejects(W.qbAccessToken(env0));
ok(e && REPORTS.some(r => r.where === 'qb_auth' && r.severity === 'P1' && /could not reach Intuit/.test(r.message)), 'network failure to Intuit: error + P1 (transient)');
reset(); FETCH_PLAN = [{ status: 503, body: 'upstream' }];
e = await rejects(W.qbAccessToken(env0));
ok(e && REPORTS.some(r => r.severity === 'P1'), 'Intuit 5xx: P1');
reset(); FETCH_PLAN = [{ status: 401, body: { error: 'invalid_client' } }];
e = await rejects(W.qbAccessToken(env0));
ok(e && REPORTS.some(r => r.severity === 'P0'), 'Intuit 4xx (bad client): P0');
reset(); e = await rejects(W.qbAccessToken({}));
ok(e && /env vars missing/.test(e.message) && REPORTS[0].severity === 'P0', 'QB env vars missing: error + P0');

console.log('\nsendSMSRaw / sendSMS');
reset(); FETCH_PLAN = [{ status: 201, body: { sid: 'SM123', status: 'queued' } }];
let r = await W.sendSMSRaw(env0, '410-555-1234', 'hi');
ok(r.sid === 'SM123' && !r.error && REPORTS.length === 0, 'a real send returns Twilio\'s reply, reports nothing');
reset(); FETCH_PLAN = [{ status: 400, body: { code: 21211, message: "The 'To' number is not a valid phone number.", status: 400 } }];
r = await W.sendSMSRaw(env0, '410-555-1234', 'hi');
ok(!r.sid && /Twilio HTTP 400 code 21211/.test(r.error) && r.twilio_code === 21211, 'a Twilio rejection comes back as an error with the reason (callers that only checked .sid used to lose it)', r);
ok(REPORTS.length === 1 && REPORTS[0].where === 'sms_send' && REPORTS[0].severity === 'P2', 'a bad recipient number is a P2 ledger entry');
ok(!JSON.stringify(REPORTS).includes('4105551234') && /1234$/.test(REPORTS[0].ref), 'the ledger entry carries only the last 4 digits of the phone');
reset(); FETCH_PLAN = [{ status: 401, body: { code: 20003, message: 'Authenticate' } }];
r = await W.sendSMSRaw(env0, '4105551234', 'hi');
ok(r.error && REPORTS[0].severity === 'P0', 'Twilio auth failure: error + P0 (nothing can send)');
reset(); FETCH_PLAN = [{ status: 503, body: '<html>Service Unavailable</html>' }];
r = await W.sendSMSRaw(env0, '4105551234', 'hi');
ok(r.error && /Twilio HTTP 503/.test(r.error) && REPORTS[0].severity === 'P0', 'a non-JSON 5xx no longer throws a confusing parse error: error + P0');
reset(); FETCH_PLAN = [{ status: 200, body: { message: 'odd' } }];
r = await W.sendSMSRaw(env0, '4105551234', 'hi');
ok(r.error && !r.sid && REPORTS.length === 1, 'HTTP 200 without a message sid is NOT a success');
reset(); FETCH_PLAN = [new Error('network down')];
ok((await rejects(W.sendSMSRaw(env0, '4105551234', 'hi'))) instanceof Error, 'a network failure still throws (callers keep the row pending and retry)');
reset(); CONFIG_READ_FAIL = true;
r = await W.sendSMS(env0, '4105551234', 'hi');
ok(r.error && /text NOT sent/.test(r.error) && FETCHES.length === 0 && REPORTS.some(x => x.where === 'sms_send' && x.severity === 'P1'), 'Config unreadable: sendSMS says so (used to look like "texting is switched off")', { r, REPORTS });
reset(); CONFIG.TWILIO_ENABLED = '';
r = await W.sendSMS(env0, '4105551234', 'hi');
ok(r.skipped && FETCHES.length === 0 && REPORTS.length === 0, 'texting deliberately switched off is still a plain skip (unchanged)');
ok(W.smsFailSeverity(400, 21610) === 'P2' && W.smsFailSeverity(403, null) === 'P0' && W.smsFailSeverity(429, null) === 'P1' && W.smsFailSeverity(500, null) === 'P0' && W.smsFailSeverity(400, 21608) === 'P0', 'severity table');

console.log('\nStatic wiring');
const mqSites = (src.match(/\| send failed: /g) || []).length;
ok(mqSites >= 3, 'all three Message_Queue send sites record WHY a send failed in Gate_Snapshot', mqSites);
ok(!/catch \(e\) \{ cfg = \{\}; \}\s*\n\s*if \(String\(cfg\.TWILIO_ENABLED/.test(src), 'sendSMS no longer treats an unreadable Config as "disabled"');
ok(/fetchConfigStrict\(env\);\s*\n\s*\} catch/.test(grab('qbAccessToken', 'async')) || /fetchConfigStrict/.test(grab('qbAccessToken', 'async')), 'qbAccessToken reads Config strictly');

console.error = err;
console.log(`\nc1-money-paths: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
