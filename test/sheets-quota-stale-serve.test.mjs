// Vendor portal "Quota exceeded for 'Read requests per minute per user'" (Oct 2 2026).
// Two protections, exercised against the REAL functions pulled out of worker.js:
//   1. GET retries wait ~15s total (6 tries) instead of ~2s, so a per-minute quota can clear.
//   2. Read-only callers that opt in with {stale:true} fall back to the last good copy of a
//      tab (<= 15 min old) when Google still refuses. Writes / callers that do not opt in
//      NEVER get stale data -- they still throw.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
function grabRange(src, a, b) { const s = src.indexOf(a); if (s < 0) throw new Error('nf ' + a); const e = src.indexOf(b, s); return src.slice(s, e); }
const cacheSrc = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc = grab(wsrc, 'async function sheetsRequest(');
const ftSrc = grab(wsrc, 'async function fetchTabs(');
const fT1Src = grab(wsrc, 'async function fetchTab(');

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };
const resp = (o) => ({ json: async () => o });
const ERR429 = { error: { code: 429, message: 'Quota exceeded' } };
const GOOD = { values: [['ID', 'Name'], ['1', 'Cesar']] };

// one shared module scope per scenario so sheetsRequest / fetchTabs / fetchTab share __tabCache
function build(fetchImpl, nowRef) {
  const waits = [];
  const mod = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date',
    cacheSrc + '\n' + srSrc + '\n' + ftSrc + '\n' + fT1Src + '\nreturn { sheetsRequest, fetchTabs, fetchTab, __tabCache };'
  )(async () => 'tok', fetchImpl, (fn, ms) => { waits.push(ms); fn(); },
    { now: () => nowRef.v });
  return { ...mod, waits };
}
const env = { SHEET_ID: 'S' };

// 1. GET backoff budget: 6 tries, waits grow, total >= 15s of waiting (minus jitter floor)
{
  let calls = 0; const now = { v: 1_000_000 };
  const m = build(async () => { calls++; return resp(ERR429); }, now);
  t('GET 429 forever -> throws (no stale opt-in)', await throws(() => m.sheetsRequest(env, 'GET', '/values/Work_Orders')));
  t('GET gets 6 attempts', calls === 6);
  const total = m.waits.reduce((a, b) => a + b, 0);
  t('GET waits 5 times, totalling ~15s (>= 15000ms base waits)', m.waits.length === 5 && total >= 15500 - 1 && total < 15500 + 5 * 120);
}

// 2. Writes keep the short budget
{
  let calls = 0; const now = { v: 1_000_000 };
  const m = build(async () => { calls++; return resp(ERR429); }, now);
  await throws(() => m.sheetsRequest(env, 'POST', '/values/Vendor_Bills:append', { values: [] }));
  t('POST gets 4 attempts', calls === 4);
  t('POST base wait is 300ms', m.waits[0] >= 300 && m.waits[0] < 300 + 120);
}

// 3. stale fallback via sheetsRequest(readOpts.stale)
{
  let mode = 'good'; const now = { v: 1_000_000 };
  const m = build(async () => resp(mode === 'good' ? GOOD : ERR429), now);
  const first = await m.sheetsRequest(env, 'GET', '/values/Vendors', undefined, { stale: true });
  t('first read caches good data', first.values.length === 2);
  mode = 'bad'; now.v += 60_000; // 1 minute later: cache expired (6s), still within 15 min
  const second = await m.sheetsRequest(env, 'GET', '/values/Vendors', undefined, { stale: true });
  t('opt-in read serves stale copy when Google keeps refusing', second.values[1][1] === 'Cesar');
  t('same read WITHOUT opt-in still throws', await throws(() => m.sheetsRequest(env, 'GET', '/values/Vendors')));
  now.v += 20 * 60_000; // 21 min since last good read
  t('stale copy older than 15 min is NOT served', await throws(() => m.sheetsRequest(env, 'GET', '/values/Vendors', undefined, { stale: true })));
}

// 4. no stale copy ever existed -> still throws even with opt-in
{
  const now = { v: 1_000_000 };
  const m = build(async () => resp(ERR429), now);
  t('opt-in with nothing cached still throws', await throws(() => m.sheetsRequest(env, 'GET', '/values/Never_Read', undefined, { stale: true })));
}

// 5. writes never get stale-served even if the opt-in were passed
{
  let mode = 'good'; const now = { v: 1_000_000 };
  const m = build(async () => resp(mode === 'good' ? GOOD : ERR429), now);
  await m.sheetsRequest(env, 'GET', '/values/Vendors');
  mode = 'bad';
  t('a POST with the stale opt-in is not stale-served', await throws(() => m.sheetsRequest(env, 'POST', '/values/Vendors:append', {}, { stale: true })));
}

// 6. fetchTabs batchGet stale fallback
{
  let mode = 'good'; const now = { v: 1_000_000 };
  const batch = { valueRanges: [{ values: [['ID', 'S'], ['7', 'Open']] }, { values: [['ID'], ['9']] }] };
  const m = build(async () => resp(mode === 'good' ? batch : ERR429), now);
  const [a, b] = await m.fetchTabs(env, ['Work_Orders', 'Master_Keys'], { stale: true });
  t('fetchTabs caches good batch', a[0].ID === '7' && b[0].ID === '9');
  mode = 'bad'; now.v += 60_000;
  const [a2, b2] = await m.fetchTabs(env, ['Work_Orders', 'Master_Keys'], { stale: true });
  t('fetchTabs opt-in serves stale rows on failure', a2[0].S === 'Open' && b2[0].ID === '9');
  t('fetchTabs WITHOUT opt-in throws on failure', await throws(() => m.fetchTabs(env, ['Work_Orders', 'Master_Keys'])));
  t('fetchTabs opt-in throws if any needed tab has no stale copy', await throws(() => m.fetchTabs(env, ['Work_Orders', 'Brand_New_Tab'], { stale: true })));
  // stale serve must not refresh the stale entry's age (else a long outage would serve it forever)
  now.v += 20 * 60_000;
  t('stale fetchTabs stops serving once the copy is too old', await throws(() => m.fetchTabs(env, ['Work_Orders', 'Master_Keys'], { stale: true })));
}

// 7. wiring: only the vendor portal read paths opt in
{
  const vw = grab(wsrc, 'async function vendorWorkorders(');
  t('vendorWorkorders opts in (tabs + master key holders)', /fetchTabs\([^)]*\{ stale: true \}\)/.test(vw) && /fetchMasterKeyHolders\(env, \{ stale: true \}\)/.test(vw));
  const lb = grab(wsrc, 'async function listVendorBills(');
  t('listVendorBills opts in only for a vendor_id call', /fetchTab\(env, 'Vendor_Bills', \{ stale: !!vendorId \}\)/.test(lb));
  const optIns = (wsrc.match(/stale: true|stale: !!vendorId/g) || []).length;
  t('exactly the 4 intended opt-in call sites exist (vendorWorkorders batched + fallback x2, listVendorBills)', optIns === 4);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
