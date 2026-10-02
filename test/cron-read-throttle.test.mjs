// Background (cron) jobs must not exhaust the shared Sheets read quota (Oct 2 2026).
// Exercises the REAL helpers/sheetsRequest/fetchTabs from worker.js.
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
const GOOD = { values: [['ID'], ['1']] };

function build(nowRef) {
  const waits = []; let calls = 0;
  const fetchImpl = async () => { calls++; return { json: async () => GOOD }; };
  const mod = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date',
    cacheSrc + '\n' + srSrc + '\n' + ftSrc + '\n' + fT1Src + '\nreturn { sheetsRequest, fetchTab, fetchTabs, __cronEnv, __tabCache };'
  )(async () => 'tok', fetchImpl, (fn, ms) => { waits.push(ms); nowRef.v += ms; fn(); }, { now: () => nowRef.v });
  return { ...mod, waits, calls: () => calls };
}
const base = { SHEET_ID: 'S' };

// 1. cron env is a child: flagged, inherits bindings, never mutates the shared env
{
  const m = build({ v: 1e6 });
  const c = m.__cronEnv(base);
  t('cron env flagged', c.__CRON__ === true);
  t('cron env inherits SHEET_ID', c.SHEET_ID === 'S');
  t('shared env NOT flagged', base.__CRON__ === undefined);
  t('idempotent', m.__cronEnv(c) === c);
}
// 2. cron reuses a tab read up to 90s ago (users' 6s cache would have expired)
{
  const now = { v: 1e6 }; const m = build(now); const c = m.__cronEnv(base);
  await m.fetchTab(c, 'Work_Orders');
  now.v += 60_000;
  await m.fetchTab(c, 'Work_Orders');
  t('cron: 2nd read of same tab 60s later is a cache hit', m.calls() === 1);
  now.v += 40_000; // 100s total
  await m.fetchTab(c, 'Work_Orders');
  t('cron: read after 100s goes to Sheets', m.calls() === 2);
}
// 3. user (non-cron) reads keep the short 6s cache
{
  const now = { v: 1e6 }; const m = build(now);
  await m.fetchTab(base, 'Work_Orders');
  now.v += 60_000;
  await m.fetchTab(base, 'Work_Orders');
  t('user: read 60s later is NOT served from cache', m.calls() === 2);
}
// 4. cron cache reuse also applies to batchGet, and a cron-read entry is not served to users past 6s
{
  const now = { v: 1e6 }; const m = build(now); const c = m.__cronEnv(base);
  await m.fetchTab(c, 'Vendors');
  now.v += 30_000;
  await m.fetchTabs(base, ['Vendors']);
  t('user read 30s after a cron read goes to Sheets (stays fresh)', m.calls() === 2);
}
// 5. pacing: 5 distinct cron reads are spaced >= 2500ms apart; user reads never wait
{
  const now = { v: 1e6 }; const m = build(now); const c = m.__cronEnv(base);
  for (const tab of ['A', 'B', 'C', 'D', 'E']) await m.fetchTab(c, tab);
  const paced = m.waits.filter(w => w > 0);
  t('cron reads paced (4 waits after the first)', paced.length === 4 && paced.every(w => w >= 2400 && w <= 2600));
  const m2 = build({ v: 1e6 });
  for (const tab of ['A', 'B', 'C', 'D', 'E']) await m2.fetchTab(base, tab);
  t('user reads never paced', m2.waits.length === 0);
}
// 6. wiring
t('cronSweep wraps env', /async function cronSweep\(env\) \{\s*env = __cronEnv\(env\);/.test(wsrc));
t('scheduled() wraps env', /env\.__STAGING__ = isStaging\(env\);\s*env = __cronEnv\(env\);/.test(wsrc));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
