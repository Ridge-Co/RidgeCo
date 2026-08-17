// The Sheets read layer was the source of the "Quota exceeded / Read requests per
// minute per user" error on the live Hub. Three changes, all exercised here against
// the REAL functions pulled out of worker.js so the test can't drift from what ships:
//
//   1. sheetsRequest retries a 429 with backoff instead of throwing it on screen.
//   2. Retry safety is method-aware: a 429 (never applied) is safe to retry for any
//      method; a 500/503 (maybe applied) is retried ONLY for GET, never for a POST
//      that could double-append a bill/row. This guard is the whole point.
//   3. fetchTabs reads many tabs in ONE batchGet, preserving order and fetchTab's
//      row-object shape, so a screen that fired 5 reads now costs 1.
//   4. getAccessToken caches the hour-long token instead of minting one per call.

import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

function grabRange(src, startSig, endSig) {
  const start = src.indexOf(startSig);
  if (start < 0) throw new Error('not found: ' + startSig);
  const end = src.indexOf(endSig, start);
  if (end < 0) throw new Error('end not found: ' + endSig);
  return src.slice(start, end);
}

// sheetsRequest and fetchTabs both close over the in-isolate __tabCache (added to absorb
// duplicate reads within a request/short burst — see worker.js comments). Grab that whole
// block too and prepend it inside each `new Function(...)` body so every makeSR/makeFT call
// gets its OWN fresh `const __tabCache = new Map()` — isolated per test block, no
// cross-contamination between assertions that happen to hit the same tab name.
const cacheSrc = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };
const okThrow = async (fn) => { try { await fn(); return false; } catch { return true; } };

// ── sheetsRequest: retry + method-aware safety ──────────────────────────────
const srSrc = grab(wsrc, 'async function sheetsRequest(');
const makeSR = (fetchImpl) => new Function(
  'getAccessToken', 'fetch', 'setTimeout',
  cacheSrc + '\n' + srSrc + '\nreturn { sheetsRequest };'
)(async () => 'tok', fetchImpl, (fn) => fn()); // setTimeout fires immediately → no real waiting

const resp = (obj) => ({ json: async () => obj });
const OK = { values: [['ID'], ['1']] };
const ERR429 = { error: { code: 429, message: 'Quota exceeded' } };
const ERR500 = { error: { code: 500, message: 'Backend error' } };

// a 429 then success → the retry swallows the throttle and returns the good data
{
  let calls = 0;
  const { sheetsRequest } = makeSR(async () => { calls++; return resp(calls < 2 ? ERR429 : OK); });
  const out = await sheetsRequest({ SHEET_ID: 'S' }, 'GET', '/values/Work_Orders');
  t('429 then 200: returns data, does not throw', JSON.stringify(out) === JSON.stringify(OK));
  t('429 then 200: actually retried (2 fetches)', calls === 2);
}

// a persistent 429 → eventually throws (bounded, not infinite)
{
  let calls = 0;
  const { sheetsRequest } = makeSR(async () => { calls++; return resp(ERR429); });
  t('persistent 429 eventually throws', await okThrow(() => sheetsRequest({ SHEET_ID: 'S' }, 'GET', '/x')));
  t('persistent 429 is bounded to 4 attempts', calls === 4);
}

// a 500 on a GET is retried (idempotent read)
{
  let calls = 0;
  const { sheetsRequest } = makeSR(async () => { calls++; return resp(calls < 2 ? ERR500 : OK); });
  const out = await sheetsRequest({ SHEET_ID: 'S' }, 'GET', '/values/Work_Orders');
  t('500 on GET is retried', calls === 2 && JSON.stringify(out) === JSON.stringify(OK));
}

// a 500 on a POST is NOT retried — the append may have landed; retrying = double-write
{
  let calls = 0;
  const { sheetsRequest } = makeSR(async () => { calls++; return resp(ERR500); });
  t('500 on POST throws immediately — no double-append', await okThrow(() =>
    sheetsRequest({ SHEET_ID: 'S' }, 'POST', '/values/Vendor_Bills:append', { values: [] })));
  t('500 on POST is not retried (1 fetch only)', calls === 1);
}

// a 429 on a POST IS retried — rate-limited means it never applied, safe to resend
{
  let calls = 0;
  const { sheetsRequest } = makeSR(async () => { calls++; return resp(calls < 2 ? ERR429 : OK); });
  const out = await sheetsRequest({ SHEET_ID: 'S' }, 'POST', '/values/Vendor_Bills:append', { values: [] });
  t('429 on POST is retried (rate-limit never applied the write)', calls === 2 && !!out.values);
}

// ── fetchTabs: one batchGet, same order, same shape as fetchTab ─────────────
const ftSrc = grab(wsrc, 'async function fetchTabs(');
const makeFT = (batchResp, capture) => new Function(
  'sheetsRequest',
  cacheSrc + '\n' + ftSrc + '\nreturn { fetchTabs };'
)(async (env, method, path) => { if (capture) capture.path = path; return batchResp; });

{
  const batch = { valueRanges: [
    { values: [['ID', 'Status'], ['1', 'Open'], ['2', 'Done']] }, // Work_Orders
    { values: [['ID', 'Address'], ['9', '123 Main']] },           // Properties
    { values: [['ID']] },                                          // Units: header only → []
  ]};
  const cap = {};
  const { fetchTabs } = makeFT(batch, cap);
  const [wos, props, units] = await fetchTabs({}, ['Work_Orders', 'Properties', 'Units']);
  t('fetchTabs maps rows to header-keyed objects', wos.length === 2 && wos[0].ID === '1' && wos[1].Status === 'Done');
  t('fetchTabs preserves request order', props[0].Address === '123 Main');
  t('fetchTabs: a header-only tab returns []', Array.isArray(units) && units.length === 0);
  t('fetchTabs issues a single batchGet request', /\/values:batchGet\?/.test(cap.path));
  t('fetchTabs batchGet lists every tab as a range', /ranges=Work_Orders/.test(cap.path) && /ranges=Properties/.test(cap.path) && /ranges=Units/.test(cap.path));
}

{
  const { fetchTabs } = makeFT({ valueRanges: [] });
  const empty = await fetchTabs({}, []);
  t('fetchTabs([]) short-circuits to []', Array.isArray(empty) && empty.length === 0);
}

{
  // a missing/absent range in the response must degrade to [], not throw
  const { fetchTabs } = makeFT({ valueRanges: [{}] });
  const [rows] = await fetchTabs({}, ['Ghost_Tab']);
  t('fetchTabs: absent values in a range → []', Array.isArray(rows) && rows.length === 0);
}

// ── getAccessToken: caches the hour-long token instead of minting per call ──
{
  const gatSrc = grab(wsrc, 'async function getAccessToken(');
  let mints = 0;
  const { getAccessToken } = new Function(
    'b64url', 'importPrivateKey', 'signRS256', 'fetch',
    'let __sheetsToken = { key: "", token: "", exp: 0 };\n' + gatSrc + '\nreturn { getAccessToken };'
  )(
    () => 'x',
    async () => 'key',
    async () => 'sig',
    async () => { mints++; return { json: async () => ({ access_token: 'TKN' }) }; }
  );
  const env = { GOOGLE_SA_EMAIL: 'sa@x', GOOGLE_SA_KEY: 'k' };
  const a = await getAccessToken(env);
  const b = await getAccessToken(env);
  t('getAccessToken returns the token', a === 'TKN' && b === 'TKN');
  t('getAccessToken mints once, then serves from cache', mints === 1);
  const c = await getAccessToken({ GOOGLE_SA_EMAIL: 'other@x', GOOGLE_SA_KEY: 'k' });
  t('a different service account forces a fresh mint', c === 'TKN' && mints === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
