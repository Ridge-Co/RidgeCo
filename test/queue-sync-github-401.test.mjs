// Queue sync vs a REJECTED GitHub token, HTTP 401 (Nov 19 2026). Offline fault-injection tests that load the REAL ghPublicJson, githubTokenShape,
// ghErrText, ghTokenRejected, cleanPrNumber and opsQueueSync source out of worker.js and drive them with a fake fetch, fake Sheets and a fake failure ledger.
// Needs Attention rows: F-1795027659213-1oyy (P0, scheduler_job: "queue_sync: ok:false [... GitHub /pulls/602 -> HTTP 401 ...]") and F-c1795030305235-0
// (P0, "Scheduled job queue_sync is overdue"). Cause: the Hub's GITHUB_READ_TOKEN was refused by GitHub with 401 (bad or expired token). Only 403/429 were
// soft, so every tick failed for 17+ hours although the repo is public and the token is optional.
// What must hold now: (1) a refused token is dropped, the call retried once without it, and the sync keeps working; (2) NOT silent: ONE calm P2 names the
// problem and what the Worker holds (kind, length, fingerprint, paste mistakes) and never the token value; (3) the happy path reports nothing;
// (4) every other GitHub failure (a 401 with no token, a 500) is still a loud job error.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
function decl(name) { const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(wsrc); if (!m) throw new Error('const not found: ' + name); return m[0]; }
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };

const pieces = [
  decl('QUEUE_REPO'), decl('_ghTok'), decl('GH_TOKEN_SKIP_MS'),
  grab(wsrc, 'async function githubTokenShape('), grab(wsrc, 'async function ghErrText('), grab(wsrc, 'async function ghTokenRejected('),
  grab(wsrc, 'async function ghPublicJson('), grab(wsrc, 'function cleanPrNumber('), grab(wsrc, 'async function opsQueueSync('),
];

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
    'async function reportFailure(env, f) { st.failures.push(f); return st.reportResult; }',
    'function json(o) { return o; }',
    'async function fetch(url, init) { const a = (init && init.headers && init.headers.Authorization) || \'\'; st.calls.push({ url, auth: a }); return st.respond(url, a); }',
    ...pieces,
    'return { opsQueueSync, ghPublicJson, githubTokenShape, _ghTok };',
  ].join('\n');
  return new Function('st', src)(st);
}

const TOK = 'ghp_' + 'A1b2'.repeat(9);                      // 40 characters, the classic shape
const HDR = ['ID', 'Title', 'Status', 'Build_State', 'PR_Number'];
const sheet3 = [HDR, ['138', 'a', 'building', 'pr_open', '565'], ['142', 'b', 'building', 'pr_open', '566'], ['150', 'c', 'building', 'pr_open', '567']];
const mkSt = (o) => Object.assign({ sheet: sheet3, calls: [], updates: [], failures: [], reportResult: { ok: true }, respond: () => new Response('{}', { status: 200 }) }, o || {});
const R401 = () => new Response(JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' }), { status: 401, headers: { 'x-github-request-id': 'ABCD:1234:5678' } });
const MERGED = () => new Response(JSON.stringify({ state: 'closed', merged: true }), { status: 200 });
const OPEN = () => new Response(JSON.stringify({ state: 'open' }), { status: 200 });
const RL = () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });

console.log('queue sync vs a rejected GitHub token (401) — offline tests\n');

// 1. ghPublicJson: refused token -> retried once without it, data comes back, the rejection is recorded WITHOUT the token value.
{
  const st = mkSt({ respond: (u, a) => (a ? R401() : OPEN()) });
  const h = build(st);
  const d = await h.ghPublicJson('/pulls/1', { GITHUB_READ_TOKEN: TOK });
  t('401 with a token: the lookup still returns the PR (asked again without the token)', d && d.state === 'open', d);
  t('exactly two calls: with the token, then without', st.calls.length === 2 && st.calls[0].auth === 'Bearer ' + TOK && st.calls[1].auth === '', st.calls);
  const p = h._ghTok.pending || {};
  t('rejection recorded with status, GitHub\'s own words and its request id', p.status === 401 && p.why === 'Bad credentials' && p.reqId === 'ABCD:1234:5678', p);
  t('shape says classic token, 40 characters, 8-hex fingerprint, no paste problems', p.shape && /classic/.test(p.shape.kind) && p.shape.length === 40 && /^[0-9a-f]{8}$/.test(p.shape.fp) && p.shape.flags.length === 0, p.shape);
  t('the token value is nowhere in the pending report', !JSON.stringify(p).includes(TOK.slice(4)), p);
  await h.ghPublicJson('/pulls/2', { GITHUB_READ_TOKEN: TOK });
  t('within 10 minutes the refused token is not sent again (saves a call per lookup)', st.calls.length === 3 && st.calls[2].auth === '', st.calls);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    await h.ghPublicJson('/pulls/3', { GITHUB_READ_TOKEN: TOK });
  } finally { Date.now = realNow; }
  t('after 10 minutes the token is tried again (so a re-set secret is picked up)', st.calls[3] && st.calls[3].auth === 'Bearer ' + TOK, st.calls);
  const st2 = mkSt({ respond: (u, a) => (a ? R401() : OPEN()) });
  const h2 = build(st2);
  await h2.ghPublicJson('/pulls/1', { GITHUB_READ_TOKEN: TOK });
  await h2.ghPublicJson('/pulls/1', { GITHUB_READ_TOKEN: TOK + 'x' });
  t('a DIFFERENT token is tried straight away even inside the window', st2.calls.some(c => c.auth === 'Bearer ' + TOK + 'x'), st2.calls);
}

// 2. THE BUG: the whole sync pass. Token refused on the first lookup; every PR still gets looked up and the rows still move on; job is green; ONE calm P2.
{
  const st = mkSt({ respond: (u, a) => (a ? R401() : MERGED()) });
  const r = await build(st).opsQueueSync({ GITHUB_READ_TOKEN: TOK }, {}, { tick: true, ignoreSuppliedPrs: true, max: 12 });
  t('token refused: the job is NOT failed (no errors, no rate_limited)', r.ok === true && r.errors.length === 0 && r.rate_limited.length === 0, r);
  t('token refused: all three PRs were still read and all three rows moved on (the sync really works)', st.updates.length === 3 && st.updates.every(u => u.f.Build_State === 'live'), st.updates);
  t('the token was sent ONCE; the other lookups went without it', st.calls.filter(c => c.auth).length === 1 && st.calls.filter(c => !c.auth).length === 3, st.calls);
  t('NOT SILENT: exactly one failure row', st.failures.length === 1, st.failures);
  const f = st.failures[0] || {};
  t('it is a calm P2 with its own where, never a P0', f.severity === 'P2' && f.where === 'github_read_token_rejected' && f.ref === 'GITHUB_READ_TOKEN', f);
  t('it names the token, the HTTP status, what the Worker holds and the fix', /GITHUB_READ_TOKEN/.test(f.message) && /HTTP 401: Bad credentials/.test(f.message) && /classic token/.test(f.message) && /40 characters/.test(f.message) && /fingerprint [0-9a-f]{8}/.test(f.message) && /maintenance-hub Worker/.test(f.message) && /never in chat/.test(f.message), f.message);
  t('the diagnosis fits inside the ledger\'s 400-character message cap', f.message.length <= 400, f.message.length);
  t('the token value never reaches the ledger (message or context)', !JSON.stringify(f).includes(TOK.slice(4)) && !/Bearer/.test(f.message), f);
  t('GitHub\'s request id is kept as context', f.context && f.context.github_request_id === 'ABCD:1234:5678', f.context);
}

// 3. HAPPY PATH: a good token reports nothing and is sent on every lookup.
{
  const st = mkSt({ respond: () => OPEN() });
  const r = await build(st).opsQueueSync({ GITHUB_READ_TOKEN: TOK }, {}, { tick: true, ignoreSuppliedPrs: true, max: 12 });
  t('good token: ok, no failure row, no error', r.ok === true && r.errors.length === 0 && st.failures.length === 0, { r, f: st.failures });
  t('good token: sent on all three lookups, no retry', st.calls.length === 3 && st.calls.every(c => c.auth === 'Bearer ' + TOK), st.calls);
  const st2 = mkSt({ respond: () => OPEN() });
  const r2 = await build(st2).opsQueueSync({}, {}, {});
  t('no token set at all: works anonymously, reports nothing', r2.ok === true && st2.failures.length === 0 && st2.calls.every(c => c.auth === ''), { r2, f: st2.failures });
}

// 4. Token refused AND GitHub then rate-limits the anonymous call: both calm rows, job still green (the pre-existing 403 behaviour is kept).
{
  const st = mkSt({ respond: (u, a) => (a ? R401() : RL()) });
  const r = await build(st).opsQueueSync({ GITHUB_READ_TOKEN: TOK }, {}, {});
  t('401 then 403: job ok, lookups reported as rate_limited', r.ok === true && r.errors.length === 0 && r.rate_limited.length === 3, r);
  const w = st.failures.map(f => f.where).sort();
  t('both calm P2 rows are filed (token rejected + GitHub blocked)', JSON.stringify(w) === JSON.stringify(['github_read_token_rejected', 'queue_sync_github_blocked']) && st.failures.every(f => f.severity === 'P2'), st.failures);
}

// 5. Every OTHER failure stays loud.
{
  const st = mkSt({ respond: () => R401() });
  const r = await build(st).opsQueueSync({}, {}, {});
  t('a 401 when NO token was sent is a real job error (never softened)', r.ok === false && r.errors.length === 3 && /HTTP 401/.test(r.errors[0].error) && st.failures.length === 0, r);
  const st2 = mkSt({ respond: (u, a) => (a ? R401() : new Response('boom', { status: 500 })) });
  const r2 = await build(st2).opsQueueSync({ GITHUB_READ_TOKEN: TOK }, {}, {});
  t('token refused and then GitHub 500: job error (500 is not softened), the token row is still filed', r2.ok === false && r2.errors.length === 3 && /HTTP 500/.test(r2.errors[0].error) && st2.failures.some(f => f.where === 'github_read_token_rejected'), { r2, f: st2.failures });
}

// 6. A token that cannot even be sent (line break inside) is never sent, is reported with the reason, and the sync still works.
{
  const bad = 'ghp_' + 'A'.repeat(18) + '\n' + 'B'.repeat(18);
  const st = mkSt({ respond: () => OPEN() });
  const r = await build(st).opsQueueSync({ GITHUB_READ_TOKEN: bad }, {}, {});
  t('token with a line break inside: never sent, job ok', r.ok === true && st.calls.every(c => c.auth === ''), { r, calls: st.calls });
  const f = st.failures[0] || {};
  t('and reported with the reason and the paste problem', st.failures.length === 1 && /not sent/.test(f.message) && /space or line break inside/.test(f.message) && !/HTTP 0/.test(f.message), f.message);
}

// 7. If the failure row itself cannot be filed, that is a job error (never swallowed).
{
  const st = mkSt({ respond: (u, a) => (a ? R401() : OPEN()), reportResult: { ok: false, error: 'sheet down' } });
  const r = await build(st).opsQueueSync({ GITHUB_READ_TOKEN: TOK }, {}, {});
  t('failure row could not be filed: the job says so', r.ok === false && r.errors.some(e => /could not file the GitHub-token-rejected failure row: sheet down/.test(e.error)), r);
}

// 8. githubTokenShape: what it reveals and what it never does.
{
  const h = build(mkSt());
  const a = await h.githubTokenShape(TOK);
  t('classic token: kind, length 40, no problems', /classic/.test(a.kind) && a.length === 40 && a.flags.length === 0, a);
  const fg = await h.githubTokenShape('github_pat_' + 'Zq7'.repeat(27) + 'Zq'.slice(0, 1));
  t('fine-grained token shape recognised, length in the usual range, no problems', /fine-grained/.test(fg.kind) && fg.length >= 80 && fg.length <= 100 && fg.flags.length === 0, fg);
  const q = await h.githubTokenShape('"' + TOK + '"');
  t('quote marks around the token are flagged', q.flags.some(x => /quote marks/.test(x)), q);
  const b = await h.githubTokenShape('Bearer ' + TOK);
  t('a pasted "Bearer " prefix is flagged', b.flags.some(x => /Bearer or token/.test(x)), b);
  const nl = await h.githubTokenShape(TOK + '\n');
  t('a trailing line break is flagged but the fingerprint matches the clean token (it is what gets sent after trim)', nl.flags.some(x => /ends/.test(x)) && nl.fp === a.fp, { nl, a });
  const o = await h.githubTokenShape('ghp_' + 'A1b2'.repeat(8));
  t('a different token has a different fingerprint; a short classic token is flagged', o.fp !== a.fp && o.flags.some(x => /40 characters/.test(x)), o);
  const e = await h.githubTokenShape('');
  t('an empty value is described as empty', e.kind === 'empty' && e.length === 0, e);
  t('the shape never contains the token', !JSON.stringify(a).includes(TOK.slice(4)) && !JSON.stringify(q).includes(TOK.slice(4)));
}

// 9. Source guards: the pieces this test drives are still wired the way the fix needs.
{
  t('opsQueueSync still files the token-rejected row as P2 with its own where', /where: 'github_read_token_rejected', ref: 'GITHUB_READ_TOKEN', severity: 'P2'/.test(wsrc));
  t('ghPublicJson still retries without the token on 401', /r\.status === 401[\s\S]{0,160}ghTokenRejected/.test(grab(wsrc, 'async function ghPublicJson(')));
  t('the 403/429 soft handling is still there', /HTTP \(403\|429\)/.test(grab(wsrc, 'async function opsQueueSync(')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
