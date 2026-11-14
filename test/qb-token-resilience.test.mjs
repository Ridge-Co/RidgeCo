// QuickBooks token resilience (Nov 13 2026, FL-20261113-qbtoken). Offline tests that load the REAL qbAccessToken /
// qbApi / sheetsRequest source out of worker.js and drive them with fakes for Intuit and Google Sheets.
// Bug being locked out: a failed Config read made the Hub silently use the stale deploy-time env seed, Intuit answered
// invalid_grant, and Brett was told "QB refresh token expired or revoked" while the real login was fine.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
function grabRange(src, a, b) {
  const s = src.indexOf(a); if (s < 0) throw new Error('not found: ' + a);
  const e = src.indexOf(b, s); if (e < 0) throw new Error('end not found: ' + b);
  return src.slice(s, e);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n); } };

const tokSrc = grabRange(wsrc, 'let __qbTok = null;', 'async function qbApi(');
const apiSrc = grab(wsrc, 'async function qbApi(');
const cacheSrc = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc = grab(wsrc, 'async function sheetsRequest(');
const jsonSrc = grab(wsrc, 'function json(data');

// The real source must still call the helpers the fakes replace (fails loud if one is renamed).
['setConfigKey', 'invalidateTabCache', 'sheetsRequest', 'logTelemetry', 'reportFailure', 'qbBase'].forEach(n => {
  if (!tokSrc.includes(n)) throw new Error('qb token code no longer references ' + n + ' — update this test');
});

// st = scripted world: Config sheet value + failure switches + what Intuit currently accepts.
function build(st) {
  const src = [
    'const CORS = {};',
    "const QB_TOKEN_URL = 'https://intuit.test/token';",
    'function qbBase() { return "https://qb.test/v3/company"; }',
    'async function sheetsRequest(env, method, path) {',
    '  st.sheetReads++;',
    "  if (st.configReadFails) throw new Error(st.configReadFails);",
    '  const rows = []; if (st.configToken !== null) rows.push(["QB_REFRESH_TOKEN", st.configToken]); rows.push(["other","x"]);',
    '  return { values: rows };',
    '}',
    'function invalidateTabCache() { st.invalidations++; }',
    'async function setConfigKey(env, b) { st.writes.push(b.value); if (st.writeFails) throw new Error(st.writeFails); st.configToken = b.value; return { status: 200 }; }',
    'async function logTelemetry(env, rec) { st.telemetry.push(rec); }',
    'async function reportFailure(env, f) { st.failures.push(f); return { ok: true }; }',
    tokSrc, apiSrc,
    'return { qbAccessToken, qbApi, qbForgetAccessToken };',
  ].join('\n');
  const fetchFake = async (url, opts) => {
    if (String(url).startsWith('https://intuit.test/token')) {
      const rt = decodeURIComponent(/refresh_token=(.*)$/.exec(opts.body)[1]);
      st.intuitCalls.push(rt);
      if (st.intuitDown) return { ok: false, status: 503, text: async () => 'upstream' };
      if (rt !== st.valid) return { ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' };
      st.n++; st.valid = 'RT-' + (st.n + 1);
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'AT-' + st.n, refresh_token: st.valid, expires_in: 3600 }) };
    }
    st.apiCalls.push(opts.headers.Authorization);
    const bad = st.apiStatus401 && st.apiCalls.length <= st.apiStatus401;
    return { status: bad ? 401 : 200, json: async () => ({ ok: !bad }) };
  };
  const mod = new Function('st', 'fetch', 'btoa', 'setTimeout', 'console', src);
  return mod(st, fetchFake, (s) => Buffer.from(s).toString('base64'), (fn, ms) => setTimeout(fn, Math.min(ms, 5)), { error() {}, log() {}, warn() {} });
}
const mkSt = (o) => Object.assign({ configToken: 'RT-1', valid: 'RT-1', n: 0, configReadFails: '', writeFails: '', intuitDown: false, apiStatus401: 0,
  sheetReads: 0, invalidations: 0, writes: [], telemetry: [], failures: [], intuitCalls: [], apiCalls: [] }, o || {});
const envQb = (seed) => ({ QB_CLIENT_ID: 'c', QB_CLIENT_SECRET: 's', QB_REALM_ID: 'r', QB_REFRESH_TOKEN: seed || 'STALE-SEED' });
async function err(p) { try { await p; return null; } catch (e) { return String(e.message); } }

console.log('QB token resilience — offline tests\n');

// 1. THE BUG: Config unreadable must NOT fall back to the stale env seed.
{
  const st = mkSt({ configReadFails: 'Read requests per minute exceeded' });
  const { qbAccessToken } = build(st);
  const e = await err(qbAccessToken(envQb()));
  t('unreadable Config: throws', !!e);
  t('unreadable Config: Intuit was never called with the stale seed', st.intuitCalls.length === 0);
  t('unreadable Config: message says Sheets hiccup, not expired/revoked', /Google Sheets hiccup/.test(e) && !/expired or revoked/.test(e));
  t('unreadable Config: message does not contain P0 trigger words', !/invalid_grant|token (has )?(expired|been revoked)|unauthori[sz]ed|\b401\b|authentication (failed|error)/i.test(e));
}
// 2. Seed is used only when Config was read fine and has no token.
{
  const st = mkSt({ configToken: null, valid: 'STALE-SEED' });
  const { qbAccessToken } = build(st);
  t('empty Config row + seed: works from seed', (await qbAccessToken(envQb())) === 'AT-1' && st.intuitCalls[0] === 'STALE-SEED');
}
// 3. Config token wins over seed; rotated token is saved AND verified.
{
  const st = mkSt();
  const { qbAccessToken } = build(st);
  t('Config token used (not env seed)', (await qbAccessToken(envQb())) === 'AT-1' && st.intuitCalls[0] === 'RT-1');
  t('rotated refresh token written once', st.writes.length === 1 && st.writes[0] === 'RT-2' && st.configToken === 'RT-2');
  t('persist verified by a FRESH read-back', st.invalidations >= 1);
  t('no failure reported on a clean save', st.failures.length === 0 && st.telemetry.length === 0);
}
// 4. Access token is cached: many calls, ONE Intuit refresh.
{
  const st = mkSt();
  const { qbAccessToken } = build(st);
  const a = await qbAccessToken(envQb()), b = await qbAccessToken(envQb()), c = await qbAccessToken(envQb());
  t('cached access token reused', a === b && b === c && st.intuitCalls.length === 1);
}
// 5. Concurrent cold callers in one isolate refresh once, not N times (no rotation race).
{
  const st = mkSt();
  const { qbAccessToken } = build(st);
  const r = await Promise.all([1, 2, 3, 4, 5, 6].map(() => qbAccessToken(envQb())));
  t('6 concurrent callers all get a token', r.every(x => x === 'AT-1'));
  t('6 concurrent callers cause exactly 1 Intuit refresh', st.intuitCalls.length === 1);
}
// 6. Another request rotated the token after we read Config: recheck finds it.
{
  const st = mkSt({ configToken: 'RT-OLD', valid: 'RT-NEW' });
  const { qbAccessToken } = build(st);
  // after the first (refused) attempt the sheet "already has" the fresh token
  const orig = st.intuitCalls.push.bind(st.intuitCalls);
  st.intuitCalls.push = (x) => { const r = orig(x); if (x === 'RT-OLD') st.configToken = 'RT-NEW'; return r; };
  t('stale Config token: fresh recheck finds the rotated one and succeeds', (await qbAccessToken(envQb())) === 'AT-1' && st.intuitCalls.join() === 'RT-OLD,RT-NEW');
}
// 7. Genuinely dead login still reports it (and only then).
{
  const st = mkSt({ configToken: 'RT-X', valid: 'RT-OTHER' });
  const { qbAccessToken } = build(st);
  const e = await err(qbAccessToken(envQb('ALSO-DEAD')));
  t('really revoked: says reconnect QuickBooks', /expired or revoked — reconnect QuickBooks/.test(e));
}
// 8. Intuit 5xx / network is not reported as revoked.
{
  const st = mkSt({ intuitDown: true });
  const { qbAccessToken } = build(st);
  const e = await err(qbAccessToken(envQb()));
  t('Intuit 503: reported as a refresh error, not revoked', /QB token refresh 503/.test(e) && !/revoked/.test(e));
}
// 9. Save fails: not silent, token still works, newest token kept in memory for the next refresh.
{
  const st = mkSt({ writeFails: 'Sheets write quota' });
  const { qbAccessToken, qbForgetAccessToken } = build(st);
  t('save fails: caller still gets the access token', (await qbAccessToken(envQb())) === 'AT-1');
  t('save fails: telemetry row written', st.telemetry.some(x => x.Job_Type === 'qb_refresh_token_not_saved' && x.Success === 'FALSE'));
  t('save fails: failure ledger row filed (P1)', st.failures.some(f => f.where === 'qb_refresh_token_not_saved' && f.severity === 'P1'));
  t('save fails: write was retried once', st.writes.length === 2);
  // Config still holds the OLD token (RT-1, now stale at Intuit). Next refresh must still work via the in-memory newest.
  qbForgetAccessToken();
  st.valid = 'RT-2'; // Intuit only accepts the newest
  t('save fails: next refresh recovers using the in-memory newest token', (await qbAccessToken(envQb())) === 'AT-2' && st.intuitCalls.slice(-2).join() === 'RT-1,RT-2');
}
// 10. qbApi: a 401 drops the cached token and retries once when it fetched the token itself.
{
  const st = mkSt({ apiStatus401: 1 });
  const { qbApi } = build(st);
  const r = await qbApi(envQb(), 'companyinfo/1');
  t('qbApi 401: retried with a fresh token and succeeded', r.ok === true && st.apiCalls.length === 2 && st.apiCalls[0] !== st.apiCalls[1]);
}
{
  const st = mkSt({ apiStatus401: 1 });
  const { qbApi, qbAccessToken } = build(st);
  const tok = await qbAccessToken(envQb());
  const r = await qbApi(envQb(), 'x', 'GET', null, tok);
  t('qbApi 401 with caller-supplied token: no hidden retry', r.ok === false && st.apiCalls.length === 1);
  t('qbApi 401: cache dropped so the next call refreshes', (await qbAccessToken(envQb())) === 'AT-2');
}

// 11. sheetsRequest: a joined read killed by the cross-request error is redone on its own.
{
  let first = true, sheetCalls = 0;
  const sr = new Function('getAccessToken', 'fetch', 'setTimeout', 'console',
    ['const CORS = {};', cacheSrc, srSrc, jsonSrc, 'return { sheetsRequest };'].join('\n')
  )(async () => 'tok', async () => {
    sheetCalls++;
    if (first) { first = false; throw new Error('This promise was created by a request that has since ended, so it can never settle.'); }
    return { ok: true, status: 200, json: async () => ({ values: [['a', 'b']] }) };
  }, (fn) => fn(), { error() {}, log() {}, warn() {} });
  const env = { SHEET_ID: 'S' };
  const res = await Promise.allSettled([sr.sheetsRequest(env, 'GET', '/values/Config'), sr.sheetsRequest(env, 'GET', '/values/Config')]);
  t('joined read: cross-request error does not fail the caller', res.every(r => r.status === 'fulfilled' && r.value.values[0][0] === 'a'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
