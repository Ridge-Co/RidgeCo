// Vendor-portal quota burst (Oct 19 2026): "Could not load estimate: Sheets API error on GET /values/Estimates:
// Quota exceeded ... Read requests per minute per user". Opening a portal with N work-order cards fires ~6N
// concurrent requests, each a cache MISS, each its own Google read. Concurrent readers of the same tab must now
// share ONE read. Exercised against the REAL functions pulled out of worker.js.
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
const tick = () => new Promise(r => setImmediate(r));
const ERR429 = { error: { code: 429, message: 'Quota exceeded' } };
const EST = { values: [['ID', 'WO_ID'], ['E1', 'WO-1']] };

// fetch whose responses are released by the test, so we can hold a read "in flight" while more callers arrive
function build(handler, nowRef) {
  const calls = [];
  const gate = [];
  const fetchImpl = (url) => new Promise((resolve) => {
    calls.push(url);
    gate.push(() => resolve({ json: async () => handler(url) }));
  });
  const release = () => { while (gate.length) gate.shift()(); };
  const mod = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date',
    cacheSrc + '\n' + srSrc + '\n' + ftSrc + '\n' + fT1Src + '\nreturn { sheetsRequest, fetchTabs, fetchTab, __tabCache, __inflight, __batchInflight, invalidateTabCache, __invalidateFromWrite };'
  )(async () => 'tok', fetchImpl, (fn) => fn(), { now: () => nowRef.v });
  return { ...mod, calls, release };
}
const env = { SHEET_ID: 'S' };

// 1. THE BUG: a burst of 40 simultaneous reads of one tab = exactly one Google read
{
  const now = { v: 1_000_000 };
  const m = build(() => EST, now);
  const ps = Array.from({ length: 40 }, () => m.fetchTab(env, 'Estimates'));
  await tick(); await tick(); m.release();
  const out = await Promise.all(ps);
  t('40 concurrent fetchTab(Estimates) -> ONE Google read', m.calls.length === 1);
  t('every caller got the rows', out.every(r => r.length === 1 && r[0].WO_ID === 'WO-1'));
  t('in-flight table is empty afterwards', m.__inflight.size === 0);
  await m.fetchTab(env, 'Estimates');
  t('a follow-up inside the 6s cache window makes no read', m.calls.length === 1);
}

// 2. different tabs are NOT merged into each other
{
  const now = { v: 1_000_000 };
  const m = build(() => EST, now);
  const ps = [m.fetchTab(env, 'Estimates'), m.fetchTab(env, 'Time_Entries'), m.fetchTab(env, 'Estimates')];
  await tick(); await tick(); m.release(); await Promise.all(ps);
  t('two different tabs -> two reads (not one)', m.calls.length === 2);
}

// 3. batchGet burst: 25 identical authorisation reads (Work_Orders+Tenants+Properties) -> ONE batchGet
{
  const now = { v: 1_000_000 };
  const batch = { valueRanges: [{ values: [['ID'], ['1']] }, { values: [['ID'], ['2']] }, { values: [['ID'], ['3']] }] };
  const m = build(() => batch, now);
  const ps = Array.from({ length: 25 }, () => m.fetchTabs(env, ['Work_Orders', 'Tenants', 'Properties']));
  await tick(); await tick(); m.release();
  const out = await Promise.all(ps);
  t('25 concurrent identical fetchTabs -> ONE batchGet', m.calls.length === 1);
  t('each caller got all three tabs in order', out.every(([a, b, c]) => a[0].ID === '1' && b[0].ID === '2' && c[0].ID === '3'));
  t('batch in-flight table empty afterwards', m.__batchInflight.size === 0);
}

// 4. a failed shared read: every waiter sees the failure, nothing is cached, and the NEXT call tries again
{
  const now = { v: 1_000_000 };
  let mode = 'bad';
  const m = build(() => (mode === 'bad' ? ERR429 : EST), now);
  const ps = Array.from({ length: 5 }, () => throws(() => m.fetchTab(env, 'Estimates')));
  // retries use the fake setTimeout (immediate); release each attempt as it appears
  for (let i = 0; i < 12; i++) { await tick(); m.release(); }
  const res = await Promise.all(ps);
  t('all 5 concurrent callers see the failure (nobody silently gets empty)', res.every(Boolean));
  t('the failed read was shared (6 attempts total, not 30)', m.calls.length === 6);
  t('a failure is never cached', !m.__tabCache.has('Estimates'));
  t('in-flight entry is cleared after failure', m.__inflight.size === 0);
  mode = 'good';
  const p = m.fetchTab(env, 'Estimates'); await tick(); await tick(); m.release();
  t('the next call after a failure reads again and succeeds', (await p).length === 1);
}

// 5. stale opt-in is PER CALLER: a follower that did not opt in never receives stale data
{
  const now = { v: 1_000_000 };
  let mode = 'good';
  const m = build(() => (mode === 'good' ? EST : ERR429), now);
  const first = m.fetchTab(env, 'Estimates'); await tick(); await tick(); m.release(); await first;
  mode = 'bad'; now.v += 60_000; // cache expired, copy is 1 min old
  const optIn = m.fetchTab(env, 'Estimates', { stale: true });
  const noOpt = throws(() => m.fetchTab(env, 'Estimates'));
  for (let i = 0; i < 12; i++) { await tick(); m.release(); }
  const rows = await optIn;
  t('opted-in caller gets the last good copy', rows.length === 1 && rows[0].ID === 'E1');
  t('caller that did NOT opt in still gets the error', await noOpt);
}

// 6. a leader that opted into stale must not leak stale data to a non-opted follower
{
  const now = { v: 1_000_000 };
  let mode = 'good';
  const m = build(() => (mode === 'good' ? EST : ERR429), now);
  const first = m.fetchTab(env, 'Estimates'); await tick(); await tick(); m.release(); await first;
  mode = 'bad'; now.v += 60_000;
  const leaderOptIn = m.fetchTab(env, 'Estimates', { stale: true }); // arrives first -> becomes the leader
  const follower = throws(() => m.fetchTab(env, 'Estimates'));
  for (let i = 0; i < 12; i++) { await tick(); m.release(); }
  await leaderOptIn;
  t('follower of an opted-in leader still throws', await follower);
}

// 7. a write drops the in-flight read so a later reader never joins a pre-write read
{
  const now = { v: 1_000_000 };
  const m = build(() => EST, now);
  const before = m.fetchTab(env, 'Estimates'); await tick();
  t('read is in flight', m.__inflight.has('Estimates'));
  m.__invalidateFromWrite('/values:batchUpdate', { data: [{ range: 'Estimates!A2', values: [['x']] }] });
  t('a write to Estimates drops the in-flight entry', !m.__inflight.has('Estimates'));
  const after = m.fetchTab(env, 'Estimates'); await tick();
  t('a reader after the write starts its own read', m.calls.length === 2);
  m.release(); await Promise.all([before, after]);
  t('structural change clears everything', (() => { m.fetchTab(env, 'Z').catch(() => {}); m.__invalidateFromWrite('/:batchUpdate', {}); return m.__inflight.size === 0; })());
}

// 9. BACKGROUND (cron) READS ARE NEVER SHARED WITH PEOPLE. Cron reads are deliberately paced 2.5s apart (__cronPace) so the
// scheduler cannot eat the quota. If a person's request joined an in-flight cron read it would inherit that pacing and a
// Hub login (GET /config) would time out at 8s while a sweep was running. A person must start their own read.
{
  const now = { v: 1_000_000 };
  const calls = []; const gate = []; const timers = [];
  const fetchImpl = (url) => new Promise((resolve) => { calls.push(url); gate.push(() => resolve({ json: async () => EST })); });
  const mod = new Function('getAccessToken', 'fetch', 'setTimeout', 'Date',
    cacheSrc + '\n' + srSrc + '\n' + ftSrc + '\n' + fT1Src + '\nreturn { fetchTab, fetchTabs, __inflight, __batchInflight };'
  )(async () => 'tok', fetchImpl, (fn) => { timers.push(fn); }, { now: () => now.v });   // timers are HELD: this is the pacing wait
  const cronEnv = { SHEET_ID: 'S', __CRON__: true };
  const cron1 = mod.fetchTab(cronEnv, 'Work_Orders');           // takes the first pace slot (no wait) and reads
  for (let i = 0; i < 6; i++) { await tick(); while (gate.length) gate.shift()(); }
  await cron1;
  const cron2 = mod.fetchTab(cronEnv, 'Config');                // next slot is 2.5s away -> parked on the pacing timer
  await tick(); await tick();
  t('a paced cron read does not register itself for people to join', !mod.__inflight.has('Config'));
  const person = mod.fetchTab({ SHEET_ID: 'S' }, 'Config');     // a person asks for the same tab at the same moment
  let outcome = 'hung';
  const done = person.then(() => { outcome = 'done'; });
  for (let i = 0; i < 12 && outcome === 'hung'; i++) { await tick(); while (gate.length) gate.shift()(); }   // fetches answer; pacing timers stay held
  t('a person is NOT parked behind a paced cron read of the same tab', outcome === 'done');
  const bcron = mod.fetchTabs(cronEnv, ['Work_Orders', 'Tenants', 'Properties']); await tick(); await tick();
  t('a cron batchGet does not register itself in the shared batch table', mod.__batchInflight.size === 0);
  timers.splice(0).forEach(f => f()); for (let i = 0; i < 8; i++) { await tick(); while (gate.length) gate.shift()(); }
  await Promise.allSettled([cron2, bcron]);
}

// 8. wiring guard: the shared-read plumbing is declared inside the cache block the other tests load
{
  t('in-flight maps live in the cache block', /const __inflight = new Map\(\)/.test(cacheSrc) && /const __batchInflight = new Map\(\)/.test(cacheSrc));
  t('writes drop in-flight entries', /__dropInflightFor\(t\)/.test(cacheSrc) && /invalidateTabCache\(tab\) \{ if \(tab\) \{ __tabCache\.delete\(tab\); __dropInflightFor/.test(cacheSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
