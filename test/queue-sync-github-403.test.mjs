// Queue sync vs GitHub 403 (Nov 17 2026). Offline tests that load the REAL opsQueueSync / cleanPrNumber source out of worker.js and drive
// them with fakes for Sheets, GitHub and the failure ledger.
// Needs Attention row: F-1794918668628-m9oi (P0, scheduler_job): "queue_sync: ok:false [... GitHub /pulls/565 -> HTTP 403 (GitHub rate-limits
// the Hub's shared address ...)]". The 15-minute tick already treated 403/429 as rate_limited; the strict DAILY run did not, and filed a P0
// every morning for something the Hub cannot fix by itself.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };

const syncSrc = grab(wsrc, 'async function opsQueueSync(');
const cleanSrc = grab(wsrc, 'function cleanPrNumber(');
['ghPublicJson', 'reportFailure', 'rateLimited', 'ghTried', 'queueDeployStep'].forEach(n => {
  if (!syncSrc.includes(n)) throw new Error('opsQueueSync no longer references ' + n + ' — update this test');
});

function build(st) {
  const src = [
    "const OPS_QUEUE_TAB = 'Ops_Build_Queue'; const OPS_QUEUE_COLS = [];",
    'async function ensureTab() {} async function ensureColumns() {}',
    'async function sheetsRequest() { return { values: st.sheet }; }',
    'function queueStuckInfo() { return { stuck: false }; }',
    "function queueStageOf() { return 'pr_open'; }",
    'function matchPrToItem() { return null; }',
    "function prStateToBuildState(pr) { return pr && pr.state === 'closed' ? (pr.merged ? 'live' : 'pr_closed') : 'pr_open'; }",
    'function queueSyncStageFields() { return {}; }',
    'async function updateQueueRowOrThrow(env, id, f) { st.updates.push({ id, f }); }',
    'async function queueDeployStep() {}',
    'async function ghPublicJson(path) { st.gh.push(path); const e = st.ghFail(path); if (e) throw new Error(e); return st.ghData(path); }',
    'async function reportFailure(env, f) { st.failures.push(f); return st.reportResult; }',
    'function json(o) { return o; }',
    cleanSrc, syncSrc,
    'return { opsQueueSync };',
  ].join('\n');
  return new Function('st', src)(st);
}
const HDR = ['ID', 'Title', 'Status', 'Build_State', 'PR_Number'];
const mkSt = (o) => Object.assign({
  sheet: [HDR, ['138', 'a', 'building', 'pr_open', '565'], ['142', 'b', 'building', 'pr_open', '566']],
  gh: [], updates: [], failures: [], reportResult: { ok: true },
  ghFail: () => '', ghData: () => ({ state: 'open' }),
}, o || {});
const RL = (p) => 'GitHub ' + p + " → HTTP 403 (GitHub rate-limits the Hub's shared address; open the Proposals page to sync from your browser)";

console.log('queue sync vs GitHub 403 — offline tests\n');

// 1. THE BUG: the strict (non-tick) daily run must not fail the job on a rate-limit refusal.
{
  const st = mkSt({ ghFail: RL });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('daily run + GitHub 403: no job error (this is what filed the P0)', r.ok === true && r.errors.length === 0, r);
  t('daily run + GitHub 403: both lookups reported as rate_limited, not dropped', r.rate_limited.length === 2 && /HTTP 403/.test(r.rate_limited[0].error), r.rate_limited);
}

// 2. Tick mode behaves the same.
{
  const st = mkSt({ ghFail: RL });
  const r = await build(st).opsQueueSync({}, {}, { tick: true, ignoreSuppliedPrs: true, max: 12 });
  t('tick + GitHub 403: no job error, rate_limited reported', r.ok === true && r.errors.length === 0 && r.rate_limited.length === 2, r);
}

// 3. NOT silent: when GitHub refuses every lookup, exactly one calm P2 is filed, naming the fix.
{
  const st = mkSt({ ghFail: RL });
  await build(st).opsQueueSync({}, {}, {});
  t('every lookup refused: ONE failure row filed', st.failures.length === 1, st.failures);
  const f = st.failures[0] || {};
  t('failure row is a P2 (never a P0) with its own where', f.severity === 'P2' && f.where === 'queue_sync_github_blocked', f);
  t('failure row names the fix and says no token is set', /GITHUB_READ_TOKEN/.test(f.message) && /No GITHUB_READ_TOKEN is set/.test(f.message) && /never paste/.test(f.message), f.message);
  t('failure row never contains a token value', !/Bearer|ghp_|github_pat_/.test(f.message || ''));
  const withTok = mkSt({ ghFail: RL });
  await build(withTok).opsQueueSync({ GITHUB_READ_TOKEN: 'x' }, {}, {});
  t('a set-but-refused token is reported differently', withTok.failures.length === 1 && /still refused it/.test(withTok.failures[0].message), withTok.failures);
}

// 4. Partial refusal (some lookups worked) files nothing: the next pass retries the rest.
{
  const st = mkSt({ ghFail: (p) => (p.endsWith('/565') ? '' : RL('/pulls/566')), ghData: () => ({ state: 'open' }) });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('one lookup worked, one refused: ok, one rate_limited, no failure row', r.ok === true && r.rate_limited.length === 1 && st.failures.length === 0, { r, f: st.failures });
}

// 5. Every OTHER GitHub error is still a loud job error (only 403/429 are calm).
{
  const st = mkSt({ ghFail: (p) => 'GitHub ' + p + ' → HTTP 500' });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('GitHub 500: job error, not rate_limited', r.ok === false && r.errors.length === 2 && r.rate_limited.length === 0, r);
  t('GitHub 500: no "blocked by rate limit" row', st.failures.length === 0);
}

// 5b. HTTP 401 (revoked/expired GITHUB_READ_TOKEN, Nov 19 2026) is calm too: one P2 row, not a failing job.
{
  const st = mkSt({ ghFail: (p) => 'GitHub ' + p + ' → HTTP 401' });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('GitHub 401: no job error, reported as rate_limited', r.ok === true && r.errors.length === 0 && r.rate_limited.length === 2, r);
  t('GitHub 401: one calm blocked row filed', st.failures.length === 1, st.failures);
}

// 6. If the failure row itself cannot be filed, that is surfaced as a job error (never swallowed).
{
  const st = mkSt({ ghFail: RL, reportResult: { ok: false, dropped: true } });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('failure row could not be filed: job error says so', r.ok === false && r.errors.some(e => /could not file the GitHub-blocked failure row/.test(e.error)), r);
}

// 7. Nothing in flight: no GitHub call, no row.
{
  const st = mkSt({ sheet: [HDR, ['9', 'x', 'dropped', '', '']] });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('nothing in flight: no GitHub call, no failure row, ok', r.ok === true && st.gh.length === 0 && st.failures.length === 0, r);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
