// Overnight heartbeat (Nov 3 2026): the one morning report (ran / failed / never ran / home PC runner / Needs Attention).
// Slices the real heartbeat block out of worker.js and drives it with in-memory fakes and a pinned clock.
// Run: node test/overnight-heartbeat.test.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const a = wsrc.indexOf('const HB_JOB = '), b = wsrc.indexOf('// GET /heartbeat/latest');
if (a < 0 || b < 0) throw new Error('heartbeat block not found');
const block = wsrc.slice(a, b);
const latestSrc = wsrc.slice(b, wsrc.indexOf('\n}\n', b) + 3);

const NOW = Date.parse('2026-11-03T10:45:00Z');          // 05:45 EST... pinned; the job itself is judged against injected status
const H = 3600000;
const ago = (ms) => new Date(NOW - ms).toISOString();

function load(extra) {
  const stubs = Object.assign({
    schedErrText: (e) => String((e && e.message) || e).slice(0, 300),
    schedReadConfigRows: async () => [['Scheduler_State', '{}'], ['admin_email', 'me@example.com']],
    configFromValues: (rows) => Object.fromEntries(rows.map(r => [r[0], r[1]])),
    schedParseState: () => ({ state: { jobs: {} } }),
    schedCell: (rows, k) => { const r = rows.find(x => x[0] === k); return r ? r[1] : ''; },
    SCHED_STATE_KEY: 'Scheduler_State',
    aiCreditStateFromRows: () => ({ paused: false }),
    schedStatus: () => ({ tick_age_min: 5, jobs: {} }),
    schedEffective: () => ({ jobs: [] }),
    schedEtParts: () => ({ date: '2026-11-03' }),
    sheetsRequest: async () => ({ values: [] }), FAIL_LEDGER_TAB: 'Failures', FAIL_LEDGER_COLS: ['ID', 'Status', 'Severity'], FAIL_OPEN: ['open', 'acknowledged'],
    isMissingTabError: () => false, failRowsToObjects: (v) => v.map(r => ({ ID: r[0], Status: r[1], Severity: r[2] })),
    failSetConfig: async () => {}, reportFailure: async () => ({ ok: true }), gmailSendEmail: async () => ({ sent: true }),
    SMS_DC_DEFAULT_TO: 'default@example.com', json: (o, s) => ({ body: o, status: s || 200 }), fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
  }, extra || {});
  const names = Object.keys(stubs);
  return new Function(...names, block + '\n' + latestSrc + '\nreturn { hbAgo, hbHomeEvaluate, hbJobRows, hbBuildReport, hbRender, hbFetchHome, hbOpenCounts, schedRunOvernightHeartbeat, heartbeatLatest, HB_CFG_KEY };')(...names.map(n => stubs[n]));
}
const L = load();

// ── 1. home runner verdicts ────────────────────────────────────────────────────────────────────────────────────
const done = { state: 'done', started: ago(7 * H), finished: ago(6 * H), last_seen: ago(6 * H), run: '2026-11-02', detail: 'COMPLETE: 10 items, 49 needs, 45 min' };
let h = L.hbHomeEvaluate({ ok: true, status: done }, NOW);
t('home: finished last night = ok', h.level === 'ok' && h.state === 'done' && /45 min/.test(h.line), h);
h = L.hbHomeEvaluate({ ok: true, status: Object.assign({}, done, { finished: ago(40 * H) }) }, NOW);
t('home: finished 40 h ago = MISSED A NIGHT (problem)', h.level === 'problem' && h.state === 'missed' && /MISSED/.test(h.line), h);
h = L.hbHomeEvaluate({ ok: true, status: { state: 'running', started: ago(10 * H), last_seen: ago(1 * H) } }, NOW);
t('home: running for 10 h = STUCK (problem)', h.level === 'problem' && h.state === 'stuck', h);
h = L.hbHomeEvaluate({ ok: true, status: { state: 'running', started: ago(1 * H), last_seen: ago(10 * 60000) } }, NOW);
t('home: running for 1 h = fine', h.level === 'ok' && h.state === 'running', h);
h = L.hbHomeEvaluate({ ok: true, status: { state: 'done' } }, NOW);
t('home: done with no finish time = unknown, not ok', h.level === 'unknown', h);
h = L.hbHomeEvaluate({ ok: true, status: { state: 'crashed', detail: 'out of memory', last_seen: ago(2 * H) } }, NOW);
t('home: any other state = problem', h.level === 'problem' && /crashed/.test(h.line), h);
h = L.hbHomeEvaluate({ ok: false, error: 'GitHub answered HTTP 404' }, NOW);
t('home: unreadable = UNKNOWN (never reported as ok)', h.level === 'unknown' && /UNKNOWN/.test(h.line) && /404/.test(h.line), h);
h = L.hbHomeEvaluate(null, NOW);
t('home: no answer at all = unknown', h.level === 'unknown');

// ── 2. job verdicts (shapes copied from live GET /cron/status) ────────────────────────────────────────────────
const okJob = { expected: 'every 14+ min', enabled: true, last_ok: ago(5 * 60000), last_status: 'ok', overdue: false, overdue_reason: '', seeded: false };
const jobs = {
  fine: okJob,
  off: Object.assign({}, okJob, { enabled: false }),
  failed: Object.assign({}, okJob, { last_status: 'failed', last_error: 'Sheets 500' }),
  overdue: Object.assign({}, okJob, { last_ok: ago(9 * H), overdue: true, overdue_reason: 'last success was 540 min ago' }),
  never: Object.assign({}, okJob, { last_ok: null, overdue: true, overdue_reason: 'has never completed successfully' }),
  paused: Object.assign({}, okJob, { paused: true, paused_reason: 'paused: AI credit' }),
  newjob: Object.assign({}, okJob, { last_ok: null, grace: true, grace_reason: 'new job, first run pending' }),
  seeded: Object.assign({}, okJob, { last_ok: null, last_status: 'seeded', seeded: true }),
};
const rows = Object.fromEntries(L.hbJobRows({ jobs }, NOW).map(r => [r.name, r.verdict]));
t('verdicts', JSON.stringify(rows) === JSON.stringify({ fine: 'ok', off: 'off', failed: 'failed', overdue: 'overdue', never: 'never', paused: 'paused', newjob: 'new', seeded: 'seeded' }), rows);
t('a job that is both overdue and has an error is not shown as ok', L.hbJobRows({ jobs: { x: Object.assign({}, okJob, { overdue: true, last_status: 'failed' }) } }, NOW)[0].verdict !== 'ok');

// ── 3. the report ────────────────────────────────────────────────────────────────────────────────────────────
const homeOk = L.hbHomeEvaluate({ ok: true, status: done }, NOW);
let rep = L.hbBuildReport({ status: { tick_age_min: 3, jobs: { a: okJob, b: okJob, c: Object.assign({}, okJob, { enabled: false }) } }, home: homeOk, open: { P0: 0, P1: 2, P2: 5 }, nowMs: NOW, etDate: '2026-11-03' });
t('clean night: level ok, headline says all clear, no problems', rep.level === 'ok' && /All clear/.test(rep.headline) && rep.problems.length === 0 && rep.unknowns.length === 0, rep);
t('clean night: counts', rep.counts.ok === 2 && rep.counts.off === 1 && rep.counts.jobs === 3, rep.counts);
rep = L.hbBuildReport({ status: { tick_age_min: 3, jobs }, home: homeOk, open: { P0: 1, P1: 0, P2: 0 }, nowMs: NOW, etDate: '2026-11-03' });
t('bad night: level problem', rep.level === 'problem');
t('bad night: failed, overdue and never-ran each get a problem line', ['failed: FAILED', 'overdue: OVERDUE', 'never: NEVER RAN'].every(s => rep.problems.some(p => p.startsWith(s))), rep.problems);
t('bad night: an urgent Needs Attention item is a problem', rep.problems.some(p => /urgent \(P0\)/.test(p)));
t('bad night: paused / new / seeded are listed but not counted as problems', rep.jobs.some(j => j.name === 'paused') && !rep.problems.some(p => /^(paused|newjob|seeded):/.test(p)));
rep = L.hbBuildReport({ status: { tick_age_min: 200, jobs: { a: okJob } }, home: homeOk, open: null, openError: 'Sheets 503', nowMs: NOW, etDate: '2026-11-03' });
t('clock silent 200 min: problem says NOTHING scheduled is running', rep.level === 'problem' && rep.problems.some(p => /NOTHING scheduled is running/.test(p)), rep.problems);
t('Needs Attention unreadable is named as could-not-check', rep.unknowns.some(u => /UNKNOWN: Sheets 503/.test(u)), rep.unknowns);
rep = L.hbBuildReport({ status: { tick_age_min: 3, jobs: { a: okJob } }, home: L.hbHomeEvaluate({ ok: false, error: 'no token' }, NOW), open: { P0: 0, P1: 0, P2: 0 }, nowMs: NOW, etDate: '2026-11-03' });
t('home unreadable alone: level attention (not ok, not a false alarm), named in the report', rep.level === 'attention' && rep.unknowns.length === 1 && /Home PC runner: UNKNOWN/.test(rep.unknowns[0]), rep);
rep = L.hbBuildReport({ status: { tick_age_min: null, jobs: {} }, home: homeOk, open: null, nowMs: NOW, etDate: '2026-11-03' });
t('clock never ticked: problem', rep.level === 'problem' && /never ticked/.test(rep.problems[0]));

// ── 4. rendering ─────────────────────────────────────────────────────────────────────────────────────────────
const bad = L.hbBuildReport({ status: { tick_age_min: 3, jobs: { 'x<b>': Object.assign({}, okJob, { overdue: true, last_ok: null, overdue_reason: '<script>' }) } }, home: homeOk, open: { P0: 0, P1: 0, P2: 0 }, nowMs: NOW, etDate: '2026-11-03' });
const out = L.hbRender(bad);
t('render: subject carries the level and date', /^\[PROBLEM\] Overnight heartbeat 2026-11-03/.test(out.subject), out.subject);
t('render: HTML is escaped', !/<script>/.test(out.html) && !/x<b>/.test(out.html) && /&lt;script&gt;/.test(out.html));
t('render: text has HOME PC and HUB JOBS sections', /HOME PC/.test(out.text) && /HUB JOBS/.test(out.text));
t('render: says no texts are sent', /No texts are sent/.test(out.html));
t('render: an ok report is tagged OK', /^\[OK\]/.test(L.hbRender(L.hbBuildReport({ status: { tick_age_min: 1, jobs: { a: okJob } }, home: homeOk, open: { P0: 0, P1: 0, P2: 0 }, nowMs: NOW, etDate: 'd' })).subject));

// ── 5. fetching the home status ────────────────────────────────────────────────────────────────────────────────
let r = await L.hbFetchHome({}, async () => { throw new Error('should not fetch without a token'); });
t('fetch: no GITHUB_READ_TOKEN = a clear, named error and NO request', r.ok === false && /GITHUB_READ_TOKEN/.test(r.error), r);
r = await L.hbFetchHome({ GITHUB_READ_TOKEN: 'x'.repeat(20) }, async () => ({ ok: false, status: 404, text: async () => '' }));
t('fetch: HTTP 404 = error naming the status', r.ok === false && /404/.test(r.error), r);
r = await L.hbFetchHome({ GITHUB_READ_TOKEN: 'x'.repeat(20) }, async () => ({ ok: true, status: 200, text: async () => 'not json' }));
t('fetch: invalid JSON = error', r.ok === false && /JSON/.test(r.error), r);
let seenHdr;
r = await L.hbFetchHome({ GITHUB_READ_TOKEN: 'tok' }, async (u, o) => { seenHdr = o.headers; return { ok: true, status: 200, text: async () => JSON.stringify(done) }; });
t('fetch: good answer parsed; token sent as Bearer', r.ok === true && r.status.state === 'done' && seenHdr.Authorization === 'Bearer tok');
r = await L.hbFetchHome({ GITHUB_READ_TOKEN: 'tok' }, async () => { throw new Error('network down'); });
t('fetch: thrown error is returned, not thrown', r.ok === false && /network down/.test(r.error));

// ── 6. the job ────────────────────────────────────────────────────────────────────────────────────────────────
function run(over, deps) {
  const calls = { emails: [], saves: [], failures: [] };
  const M = load(Object.assign({
    schedStatus: () => ({ tick_age_min: 3, jobs: { a: okJob } }),
    gmailSendEmail: async (env, m) => { calls.emails.push(m); return { sent: true }; },
    failSetConfig: async (env, k, v) => { calls.saves.push([k, v]); },
    reportFailure: async (env, f) => { calls.failures.push(f); return { ok: true }; },
  }, over));
  return M.schedRunOvernightHeartbeat({}, Object.assign({ nowMs: NOW, fetchHome: async () => ({ ok: true, status: done }), openCounts: async () => ({ open: { P0: 0, P1: 0, P2: 0 } }) }, deps)).then(res => ({ res, calls }));
}
let o = await run({});
t('job: clean night succeeds, emails once, saves once, no failure row', o.res.ok && o.calls.emails.length === 1 && o.calls.saves.length === 1 && o.calls.failures.length === 0, o.res);
t('job: email goes to Config admin_email, never an SMS path', o.calls.emails[0].to === 'me@example.com' && !/sendSMS/.test(block));
t('job: saved under heartbeat_last with the readable text included', o.calls.saves[0][0] === 'heartbeat_last' && JSON.parse(o.calls.saves[0][1]).text.includes('HUB JOBS'));
t('job: email sent => no_retry (a retry must not email twice)', o.res.no_retry === true);
o = await run({}, { fetchHome: async () => ({ ok: false, error: 'no token' }) });
t('job: home unreadable still succeeds but writes a P2 Needs Attention row and says UNKNOWN in the email', o.res.ok && o.calls.failures.length === 1 && o.calls.failures[0].severity === 'P2' && o.calls.failures[0].where === 'heartbeat_home_runner' && /UNKNOWN/.test(o.calls.emails[0].html), o);
o = await run({ gmailSendEmail: async () => { throw new Error('gmail down'); } });
t('job: email failure = job FAILS loudly (error named, not retried-as-sent)', o.res.ok === false && o.res.errors.some(e => e.step === 'send_email' && /gmail down/.test(e.error)) && o.res.no_retry === false, o.res);
o = await run({ gmailSendEmail: async () => ({}) });
t('job: email with no confirmation = job fails', o.res.ok === false && o.res.errors.some(e => e.step === 'send_email'));
o = await run({ failSetConfig: async () => { throw new Error('Config not saved (HTTP 500)'); } });
t('job: save failure = job FAILS, but the email still goes out', o.res.ok === false && o.res.errors.some(e => e.step === 'save_report') && o.calls.emails.length === 1, o.res);
o = await run({ schedReadConfigRows: async () => { throw new Error('quota'); } });
t('job: Config unreadable = job fails, nothing sent', o.res.ok === false && o.res.errors[0].step === 'read_config' && o.calls.emails.length === 0);
o = await run({ schedParseState: () => ({ error: 'state corrupt' }) });
t('job: scheduler state corrupt = job fails, nothing sent', o.res.ok === false && o.res.errors[0].step === 'scheduler_state' && o.calls.emails.length === 0);
o = await run({ schedReadConfigRows: async () => [['Scheduler_State', '{}'], ['heartbeat_quiet_when_ok', 'TRUE']] });
t('job: quiet_when_ok = TRUE and a clean night => no email, still saved', o.res.ok && o.calls.emails.length === 0 && o.calls.saves.length === 1 && o.res.no_retry === false, o.res);
o = await run({ schedReadConfigRows: async () => [['Scheduler_State', '{}'], ['heartbeat_quiet_when_ok', 'TRUE']], schedStatus: () => ({ tick_age_min: 3, jobs: { a: Object.assign({}, okJob, { overdue: true, last_ok: null }) } }) });
t('job: quiet_when_ok = TRUE but a PROBLEM => email anyway', o.res.ok && o.calls.emails.length === 1 && /^\[PROBLEM\]/.test(o.calls.emails[0].subject), o.res);
o = await run({}, { openCounts: async () => ({ error: 'Sheets 503' }) });
t('job: Needs Attention unreadable is reported in the email, not hidden', o.res.ok && /UNKNOWN: Sheets 503/.test(o.calls.emails[0].html) && /^\[CHECK\]/.test(o.calls.emails[0].subject), o.calls.emails[0] && o.calls.emails[0].subject);
o = await run({ reportFailure: async () => { throw new Error('ledger down'); } }, { fetchHome: async () => ({ ok: false, error: 'x' }) });
t('job: failing to record the P2 row is a warning, report still sent', o.res.ok && o.res.warnings.some(w => /could not record/.test(w)) && o.calls.emails.length === 1, o.res);

// ── 7. the endpoint ────────────────────────────────────────────────────────────────────────────────────────────
let E = load({ schedReadConfigRows: async () => [['heartbeat_last', JSON.stringify({ as_of: new Date(Date.now() - 2 * H).toISOString(), level: 'ok', headline: 'All clear' })]] });
let ep = await E.heartbeatLatest({});
t('endpoint: returns the saved report with its age', ep.status === 200 && ep.body.ok && ep.body.level === 'ok' && ep.body.stale === false && ep.body.age_hours > 1.5, ep);
E = load({ schedReadConfigRows: async () => [['heartbeat_last', JSON.stringify({ as_of: new Date(Date.now() - 40 * H).toISOString(), level: 'ok' })]] });
ep = await E.heartbeatLatest({});
t('endpoint: a report older than 30 h is flagged stale', ep.body.stale === true);
E = load({ schedReadConfigRows: async () => [] });
ep = await E.heartbeatLatest({});
t('endpoint: no report yet = 404 with a plain message', ep.status === 404 && /no heartbeat/.test(ep.body.error));
E = load({ schedReadConfigRows: async () => [['heartbeat_last', '{bad']] });
ep = await E.heartbeatLatest({});
t('endpoint: corrupt saved report = 500, not a crash', ep.status === 500);
E = load({ schedReadConfigRows: async () => { throw new Error('quota'); } });
ep = await E.heartbeatLatest({});
t('endpoint: Config unreadable = 503', ep.status === 503);

// ── 8. wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
t('wiring: registered as a DAILY job at 06:45 with retry:false', /name: 'overnight_heartbeat', kind: 'daily',\s+at: '06:45', retry: false/.test(wsrc));
t('wiring: GET /heartbeat/latest is routed', /path === '\/heartbeat\/latest'\)\s+return await heartbeatLatest\(env\)/.test(wsrc));
t('wiring: NOT in the staging-safe list (staging never emails a heartbeat)', !/SCHED_STAGING_SAFE_JOBS = \[[^\]]*overnight_heartbeat/.test(wsrc));
const gs = fs.readFileSync(root + 'apps-script/hub-scheduler/HubScheduler.gs', 'utf8');
t('wiring: Apps Script JOBS table has the row', /name: 'overnight_heartbeat',\s+run: 'hub', at: '06:45'/.test(gs));
t('no cron / no SMS inside the heartbeat block', !/cron/i.test(block.replace(/NO CRON/g, '')) && !/sendSMS|smsGatedSend/.test(block));
t('no empty catch in the heartbeat block', !/catch\s*\(\s*_?\s*\)\s*\{\s*\}/.test(block) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(block));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
