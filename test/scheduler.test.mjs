// Apps Script scheduler (Oct 12 2026) - PERMANENT RULE: NO CRON ANYWHERE.
// Covers the dispatcher (POST /cron/run, GET /cron/status), the pure due/status logic across DST, the
// no-duplicate-run guarantees (concurrent callers, double calls, claim expiry), the Scheduler_Token gate,
// the redaction of that token, the loud no-op scheduled(), the /health summary, and the "no cron anywhere"
// structure (wrangler.toml, workflows). Runs two ways:
//   * the scheduler block is sliced out of worker.js and evaluated with in-memory fakes (fast, deterministic, injected clock)
//   * the REAL worker.js default export is imported and driven over a fake Google Sheets (fetch is stubbed)
// The clock is pinned everywhere it matters (opts.now / explicit dates) - nothing here depends on today's date.
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const tick = (ms) => new Promise(r => setTimeout(r, ms));
const iso = (s) => new Date(s);

// ───────────────────────────── in-memory Google Sheets ─────────────────────────────
function makeStore() {
  const tabs = new Map();           // name -> array of row arrays
  const calls = [];
  const st = { tabs, calls, latency: () => 0, failNext: null, failWhen: null };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {   // path relative to /spreadsheets/{id}
    calls.push(method + ' ' + path);
    const lat = st.latency(); if (lat) await tick(lat);
    if (st.failWhen && st.failWhen(method, path, body)) return { error: { code: 500, message: 'injected sheets failure' } };
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) {
      const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name);
      return { range: name, values: tabs.get(name).map(r => r.slice()) };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 60, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) {
      const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name);
      for (const r of body.values) tabs.get(name).push(r.slice());
      return { updates: { updatedRows: body.values.length } };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
        const col = mm[1].split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]);
        while (rows[row].length <= col) rows[row].push('');
        rows[row][col] = d.values[0][0];
      }
      return { totalUpdatedCells: body.data.length };
    }
    if (method === 'POST' && path === ':batchUpdate') {
      for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []);
      return {};
    }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  st.cfg = () => Object.fromEntries((tabs.get('Config') || []).filter(r => r[0]).map(r => [r[0], r[1] || '']));
  st.setCfg = (k, v) => { const rows = tabs.get('Config'); const i = rows.findIndex(r => r[0] === k); if (i >= 0) rows[i][1] = v; else rows.push([k, v]); };
  tabs.set('Config', [['Key', 'Value']]);
  return st;
}

// ───────────────────────────── 1. scheduler block, sliced out of worker.js ─────────────────────────────
const bi = wsrc.indexOf('// ═══ SCHEDULER-BLOCK-BEGIN'), be = wsrc.indexOf('// ═══ SCHEDULER-BLOCK-END');
t('scheduler block markers exist', bi > 0 && be > bi);
const blockSrc = wsrc.slice(bi, be);
function load(store, over) {
  over = over || {};
  const telemetry = [], alerts = [];
  const stubs = {
    invalidateTabCache: () => {},
    sheetsRequest: async (env, method, path, body) => { const r = await store.handle(method, path, body); if (r && r.error) throw new Error(`Sheets API error on ${method} ${path}: ${r.error.message}`); return r; },
    logTelemetry: async (env, rec) => { if (over.telemetryFails) throw new Error('telemetry sheet down'); telemetry.push(rec); },
    alertAdminOnFailure: async (env, k, m) => { alerts.push({ k, m }); return { skipped: true }; },
    setConfigKey: async (env, b) => { store.setCfg(b.key, b.value); return { ok: true }; },
    json: (b, s) => ({ body: b, status: s || 200 }),
    __cronEnv: (e) => e,
    doorWatchdogCron: async () => ({ ok: true }),
    processQuietHoursQueue: async () => ({ checked: 0, results: [] }),
    processPendingNotifications: async () => ({ status: 200, clone() { return this; }, async json() { return { processed: 0 }; } }),
    processVendorNudges: async () => ({ checked: 0, results: [] }),
    processRecurringWorkOrders: async () => ({ templates: 0, posted: 0 }),
    processEstimateReminders: async () => ({ skipped: 'x' }),
    processDepositPaidSweep: async () => ({ ok: true }),
    maybeRunDailySelftest: async () => ({ skipped: true }),
    checkDeadManSwitch: async () => ({ skipped: true }),
    inspStrGuardTick: async () => ({ enabled: false }), inspAlert: async () => {},
    buildDigest: async () => ({}), deliverDigest: async () => ({ delivered: false }),
    receiptScan: async () => ({ ok: true }), receiptReconScan: async () => ({ ok: true }),
    backfillItemsSummary: async () => ({ ok: true, updated: 0, failed: 0 }), purgeConfirmedDuplicateReceipts: async () => ({ ok: true }),
    sendReceiptsToQBEmail: async () => ({ ok: true, sent: 0, failed: [] }), releaseTurnoverByDate: async () => ({}),
    fetchTab: async () => [], isMissingTabError: () => false, MSG_QUEUE_TAB: 'Message_Queue', NOTIF_QUEUE_TAB: 'Notification_Queue', VENDOR_REQ_TAB: 'Vendor_Requests',
    etHour: (d) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(d)) % 24,
    etDateString: (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d),
    estimatesAwaitingDecision: () => [], ESTIMATE_SMS_DEFAULT_SINCE: '2026-09-29T00:00:00.000Z', RECUR_POST_START_HOUR_ET: 8, QUIET_HOURS_START_ET: 19,
    recurIsTrue: (v) => String(v).toUpperCase() === 'TRUE', recurEtDateISO: (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d),
    recurLatestDue: () => null, recurTargets: () => [], recurTargetKey: (x) => x.p + '|' + (x.u || ''), recurWOIsOpen: () => false,
    qbSyncPayments: async () => ({ ok: true }), runWeeklyReview: async () => ({ ok: true, logged: true, delivery: null }), runWeeklyArReport: async () => ({ delivered: false }),
  };
  Object.assign(stubs, over.stubs || {});
  const names = Object.keys(stubs);
  const fn = new Function(...names, blockSrc + '\nreturn { schedTokenOk, schedEtParts, schedJobDue, schedDueJobs, schedStatus, schedParseState, schedRunNext, schedRunHandler, schedStatusHandler, schedHealthSummary, schedUnexpectedCloudflareCron, schedBadness, SCHED_JOBS, SCHED_STAGING_SAFE_JOBS };');
  return Object.assign(fn(...names.map(n => stubs[n])), { telemetry, alerts, stubs });
}
const S0 = () => ({ v: 1, claim_until: '', claim_id: '', claim_job: '', last_tick: '', jobs: {} });
const P = load(makeStore());
// A store that already holds a Scheduler_State (i.e. NOT the first-ever tick), so first-run seeding does not apply.
const primeState = (store) => { store.tabs.get('Config').push(['Scheduler_State', JSON.stringify(S0())]); return store; };

// registry shape
{
  const names = P.SCHED_JOBS.map(j => j.name);
  t('registry priority order', JSON.stringify(names) === JSON.stringify(['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard', 'daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync', 'review_mon', 'review_wed', 'ar_report_mon']), names);
  t('registry names unique', new Set(names).size === names.length);
  const dw = P.SCHED_JOBS.find(j => j.name === 'door_watchdog'), sw = P.SCHED_JOBS.find(j => j.name === 'sweep');
  t('15-minute jobs gate at >=14 min', dw.every_min === 14 && sw.every_min === 14);
  const g = (n) => P.SCHED_JOBS.find(j => j.name === n);
  t('daily jobs at 07:00 ET', ['daily_digest', 'daily_receipts', 'daily_turnover', 'daily_qb_sync'].every(n => g(n).kind === 'daily' && g(n).at === '07:00'));
  t('weekly jobs', g('review_mon').dow === 1 && g('review_mon').at === '08:30' && g('review_wed').dow === 3 && g('review_wed').at === '08:00' && g('ar_report_mon').dow === 1 && g('ar_report_mon').at === '09:00' && g('ar_report_mon').retry === false);
}

// ET wall clock across DST
{
  t('EDT wall clock', JSON.stringify(P.schedEtParts(iso('2026-10-12T12:30:00Z'))) === JSON.stringify({ date: '2026-10-12', minutes: 8 * 60 + 30, dow: 1 }));
  t('EST wall clock', JSON.stringify(P.schedEtParts(iso('2026-11-02T13:30:00Z'))) === JSON.stringify({ date: '2026-11-02', minutes: 8 * 60 + 30, dow: 1 }));
  t('midnight ET is hour 0, not 24', P.schedEtParts(iso('2026-11-02T05:00:00Z')).minutes === 0 && P.schedEtParts(iso('2026-11-02T05:00:00Z')).date === '2026-11-02');
}
const job = (n) => P.SCHED_JOBS.find(j => j.name === n);
const due = (n, js, at) => P.schedJobDue(job(n), js, iso(at));
// weekly review_mon 08:30 ET: EDT (Oct 12) vs EST (Nov 2)
t('review_mon EDT: 12:29Z (08:29 ET) not due', due('review_mon', {}, '2026-10-12T12:29:00Z') === null);
t('review_mon EDT: 12:30Z (08:30 ET) due', !!due('review_mon', {}, '2026-10-12T12:30:00Z'));
t('review_mon EST: 12:30Z is 07:30 ET - NOT due (a UTC cron would have fired an hour early)', due('review_mon', {}, '2026-11-02T12:30:00Z') === null);
t('review_mon EST: 13:29Z not due, 13:30Z due', due('review_mon', {}, '2026-11-02T13:29:00Z') === null && !!due('review_mon', {}, '2026-11-02T13:30:00Z'));
// daily 07:00 ET on DST change days
t('daily_digest on the fall-back day (Nov 1, EST after 2am): 11:59Z = 06:59 EST not due, 12:00Z = 07:00 EST due', due('daily_digest', {}, '2026-11-01T11:59:00Z') === null && !!due('daily_digest', {}, '2026-11-01T12:00:00Z'));
t('daily_digest on the spring-forward day (Mar 8, EDT): 10:59Z = 06:59 EDT not due, 11:00Z due', due('daily_digest', {}, '2026-03-08T10:59:00Z') === null && !!due('daily_digest', {}, '2026-03-08T11:00:00Z'));
t('daily_digest summer 07:00 EDT = 11:00Z; winter 07:00 EST = 12:00Z', !!due('daily_digest', {}, '2026-07-15T11:00:00Z') && due('daily_digest', {}, '2026-12-15T11:00:00Z') === null && !!due('daily_digest', {}, '2026-12-15T12:00:00Z'));
// weekday gating
t('review_mon not due on a Tuesday', due('review_mon', {}, '2026-10-13T15:00:00Z') === null);
t('review_wed due Wednesday 08:00 ET only', due('review_wed', {}, '2026-10-14T11:59:00Z') === null && !!due('review_wed', {}, '2026-10-14T12:00:00Z') && due('review_wed', {}, '2026-10-15T15:00:00Z') === null);
t('ar_report_mon waits for 09:00 ET', due('ar_report_mon', {}, '2026-10-12T12:59:00Z') === null && !!due('ar_report_mon', {}, '2026-10-12T13:00:00Z'));
// catch-up after a missed slot + once-per-key
{
  const ydone = { last_key: '2026-10-11' };
  t('catch-up: scheduler was down at 7am, runs at 3:10pm ET the same day', due('daily_digest', ydone, '2026-10-12T19:10:00Z') && due('daily_digest', ydone, '2026-10-12T19:10:00Z').key === '2026-10-12');
  t('once-per-key: not due again the same ET day after success', due('daily_digest', { last_key: '2026-10-12' }, '2026-10-12T23:00:00Z') === null);
  t('a missed day does not pile up: next ET day runs once', due('daily_digest', { last_key: '2026-10-08' }, '2026-10-12T11:00:00Z').key === '2026-10-12');
  t('late-evening ET still the same key (UTC date already rolled)', due('daily_digest', { last_key: '2026-10-12' }, '2026-10-13T02:30:00Z') === null);
  t('Monday review missed all day is dropped (not carried to Tuesday)', due('review_mon', { last_key: '2026-10-05' }, '2026-10-13T14:00:00Z') === null);
}
// interval gating
{
  const base = '2026-10-12T14:00:00Z';
  const ago = (min) => new Date(Date.parse(base) - min * 60000).toISOString();
  t('interval: never run -> due', !!due('sweep', {}, base));
  t('interval: started 13 min ago -> not due', due('sweep', { last_start: ago(13) }, base) === null);
  t('interval: started 14 min ago -> due', !!due('sweep', { last_start: ago(14) }, base));
  t('interval: a 15-min Apps Script trigger always finds it due', !!due('sweep', { last_start: ago(15) }, base));
  t('interval: gated on START (a slow run does not shorten the gap)', due('sweep', { last_start: ago(10), last_end: ago(1) }, base) === null);
  t('interval: a last_start far in the future (bad clock) cannot stall the job forever', !!due('sweep', { last_start: new Date(Date.parse(base) + 3 * 3600000).toISOString() }, base));
}
// failed daily: retry gap + attempt cap
{
  const day = '2026-10-12', at = (min) => new Date(Date.parse('2026-10-12T15:00:00Z') + min * 60000).toISOString();
  const js = (n, endMin) => ({ attempts: { key: day, n }, last_end: at(endMin), last_start: at(endMin - 1) });
  t('failed daily: not retried within 30 min', due('daily_turnover', js(1, -10), '2026-10-12T15:00:00Z') === null);
  t('failed daily: retried after 30 min', !!due('daily_turnover', js(1, -31), '2026-10-12T15:00:00Z'));
  t('failed daily: gives up after 3 attempts', due('daily_turnover', js(3, -300), '2026-10-12T15:00:00Z') === null);
  t('attempts from yesterday do not block today', !!due('daily_turnover', { attempts: { key: '2026-10-11', n: 3 }, last_end: at(-600) }, '2026-10-12T15:00:00Z'));
}
// priority order with everything due
{
  const names = P.schedDueJobs(S0(), iso('2026-10-12T14:00:00Z'), P.SCHED_JOBS, {}).map(d => d.name);
  t('priority order when everything is due (Monday 10am ET)', names.join() === 'door_watchdog,sweep,sweep_work,sweep_checks,insp_guard,daily_digest,daily_receipts,daily_receipts_post,daily_turnover,daily_qb_sync,review_mon,ar_report_mon', names.join());
  const early = P.schedDueJobs(S0(), iso('2026-10-14T09:00:00Z'), P.SCHED_JOBS, {}).map(d => d.name);   // Wed 05:00 EDT: only the interval jobs
  t('before 7am ET only the 15-minute jobs are due', early.join() === 'door_watchdog,sweep,sweep_work,sweep_checks,insp_guard', early.join());
  t('only[] restricts', P.schedDueJobs(S0(), iso('2026-10-12T14:00:00Z'), P.SCHED_JOBS, { only: ['sweep'] }).map(d => d.name).join() === 'sweep');
}
// schedStatus overdue logic
{
  const now = iso('2026-10-12T16:00:00Z');   // Monday 12:00 ET
  const mins = (m) => new Date(now.getTime() - m * 60000).toISOString();
  const fresh = S0(); fresh.last_tick = mins(3);
  for (const n of ['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard']) fresh.jobs[n] = { last_start: mins(5), last_end: mins(4), last_ok: mins(4), last_status: 'ok' };
  for (const n of ['daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync']) fresh.jobs[n] = { last_start: mins(300), last_end: mins(299), last_ok: mins(299), last_key: '2026-10-12', last_status: 'ok' };
  for (const n of ['review_mon', 'ar_report_mon']) fresh.jobs[n] = { last_end: mins(200), last_ok: mins(200), last_key: '2026-10-12', last_status: 'ok' };
  const s = P.schedStatus(fresh, now, P.SCHED_JOBS);
  t('status: healthy scheduler has no overdue jobs', s.overdue.length === 0 && s.tick_age_min === 3, s.overdue);
  const stale = JSON.parse(JSON.stringify(fresh)); stale.jobs.sweep.last_ok = mins(46); stale.jobs.daily_digest.last_key = '2026-10-11';
  const s2 = P.schedStatus(stale, now, P.SCHED_JOBS);
  t('status: 15-min job with last_ok 46 min ago is overdue; daily not run today (due 5h ago) is overdue', s2.overdue.join() === 'sweep,daily_digest', s2.overdue);
  t('status: 45 min exactly is not yet overdue', (() => { const x = JSON.parse(JSON.stringify(fresh)); x.jobs.sweep.last_ok = mins(45); return P.schedStatus(x, now, P.SCHED_JOBS).overdue.length === 0; })());
  const within = P.schedStatus(S0(), iso('2026-10-12T12:00:00Z'), [job('daily_digest')]);   // 08:00 ET, 1h after due: inside the 3h grace
  t('status: a daily job inside its 3h grace is not overdue', within.overdue.length === 0);
  const after = P.schedStatus(S0(), iso('2026-10-12T14:00:01Z'), [job('daily_digest')]);     // 10:00:01 ET, 3h after due
  t('status: a daily job 3h past due is overdue', after.overdue.join() === 'daily_digest', after);
  const empty = P.schedStatus(S0(), now, P.SCHED_JOBS);
  t('status: before the first-ever run every 15-min job reads overdue (never completed)', empty.jobs.sweep.overdue && /never completed/.test(empty.jobs.sweep.overdue_reason) && empty.tick_age_min === null);
  const hung = JSON.parse(JSON.stringify(fresh)); hung.jobs.sweep = { last_start: mins(20), last_end: mins(40), last_ok: mins(40) };
  t('status: started but never finished is flagged', /never finished/.test(P.schedStatus(hung, now, P.SCHED_JOBS).jobs.sweep.overdue_reason));
  const failedFinal = JSON.parse(JSON.stringify(fresh)); failedFinal.jobs.ar_report_mon.last_failed_final = '2026-10-12'; failedFinal.jobs.ar_report_mon.last_error = 'boom';
  t('status: a failed-and-not-retried weekly job is overdue with the error', P.schedStatus(failedFinal, now, P.SCHED_JOBS).jobs.ar_report_mon.overdue_reason.includes('boom'));
  t('status: non-expected weekday (Tuesday) weekly job is not overdue', P.schedStatus(S0(), iso('2026-10-13T20:00:00Z'), [job('review_mon')]).overdue.length === 0);
}
// parse state: blank = first run, garbage = error (never silently "empty")
{
  t('parseState blank -> fresh state', P.schedParseState('').state && P.schedParseState(undefined).state.jobs && Object.keys(P.schedParseState('  ').state.jobs).length === 0);
  t('parseState garbage -> error (so a corrupt cell cannot re-run every job)', !!P.schedParseState('{not json').error && !P.schedParseState('{not json').state);
  t('parseState array -> error', !!P.schedParseState('[]').error);
}
// step-result inspection
{
  t('badness: ok:false', !!P.schedBadness(200, { ok: false, errors: ['x'] }));
  t('badness: error field', /boom/.test(P.schedBadness(200, { error: 'boom' })));
  t('badness: non-empty errors list', !!P.schedBadness(200, { ok: true, errors: [{ file: 'a' }] }));
  t('badness: empty errors list is fine', P.schedBadness(200, { ok: true, errors: [] }) === null);
  t('badness: HTTP 500', /HTTP 500/.test(P.schedBadness(500, { error: 'x' })));
  t('badness: failed count', !!P.schedBadness(200, { ok: true, failed: 2 }) && P.schedBadness(200, { ok: true, failed: 0 }) === null);
  t('badness: skipped/dormant results are fine', P.schedBadness(200, { skipped: true, reason: 'dormant' }) === null && P.schedBadness(200, { delivered: false, reason: 'dormant' }) === null);
}

// Token gate (pure)
{
  const SEC = 'a'.repeat(24) + 'XYZ123';
  t('token: exact match on POST /cron/run', P.schedTokenOk(SEC, SEC, 'POST', '/cron/run'));
  t('token: exact match on GET /cron/status', P.schedTokenOk(SEC, SEC, 'GET', '/cron/status'));
  t('token: wrong method on /cron/run', !P.schedTokenOk(SEC, SEC, 'GET', '/cron/run'));
  t('token: wrong method on /cron/status', !P.schedTokenOk(SEC, SEC, 'POST', '/cron/status'));
  for (const [m, p] of [['POST', '/cron/sweep'], ['GET', '/workorders'], ['POST', '/status'], ['POST', '/config/set'], ['GET', '/config'], ['POST', '/admin-notify'], ['POST', '/cron/run/'], ['POST', '/cron/runx']])
    t(`token: rejected on ${m} ${p}`, !P.schedTokenOk(SEC, SEC, m, p));
  t('token: mismatch', !P.schedTokenOk(SEC, SEC.slice(0, -1) + 'Q', 'POST', '/cron/run'));
  t('token: prefix / longer value', !P.schedTokenOk(SEC, SEC.slice(0, 20), 'POST', '/cron/run') && !P.schedTokenOk(SEC, SEC + 'x', 'POST', '/cron/run'));
  t('token: blank secret fails closed (even with a blank header)', !P.schedTokenOk('', '', 'POST', '/cron/run') && !P.schedTokenOk('', 'x', 'POST', '/cron/run') && !P.schedTokenOk('   ', '   ', 'POST', '/cron/run'));
  t('token: missing secret (undefined/null) fails closed', !P.schedTokenOk(undefined, 'x', 'POST', '/cron/run') && !P.schedTokenOk(null, '', 'GET', '/cron/status'));
  t('token: short secret (<24) fails closed even when it matches', !P.schedTokenOk('short', 'short', 'POST', '/cron/run'));
  t('token: empty header with a real secret', !P.schedTokenOk(SEC, '', 'POST', '/cron/run'));
  t('token: secret with trailing newline from the sheet still matches the clean token', P.schedTokenOk(SEC + '\n', SEC, 'POST', '/cron/run'));
}

// ───────────────────────────── 2. dispatcher with fakes ─────────────────────────────
const T0 = Date.parse('2026-10-12T14:00:00Z');   // Monday 10:00 ET
const clock = (start) => { const c = { v: start }; c.now = () => c.v; return c; };
function mkJobs(log, spec) {
  const out = [];
  for (const [name, kind, extra] of spec) {
    out.push(Object.assign({ name, kind, every_min: 14, at: '07:00', run: async () => { log.push(name); return { ok: true, errors: [] }; } }, extra || {}));
  }
  return out;
}
const fast = (c, extra) => Object.assign({ now: c.now, sleep: async () => {}, verifyDelayMs: 0, budgetMs: 5000 }, extra || {});
const stateOf = (store) => JSON.parse(store.cfg().Scheduler_State);

// 2a first run, one job per call, more flag, then idle
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval'], ['b', 'interval'], ['c', 'interval']]);
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('first call runs exactly one job (the first by priority)', r1.status === 200 && r1.body.ran === 'a' && r1.body.job_ok === true && log.join() === 'a', r1.body);
  t('first call says more=true with the remaining due names', r1.body.more === true && r1.body.due.join() === 'b,c', r1.body);
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('second call runs b', r2.body.ran === 'b' && r2.body.more === true && log.join() === 'a,b');
  const r3 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('third call runs c and says more=false', r3.body.ran === 'c' && r3.body.more === false && log.join() === 'a,b,c');
  const r4 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('fourth call: nothing due -> ran null, more false, heartbeat written', r4.body.ran === null && r4.body.more === false && r4.status === 200 && log.length === 3 && stateOf(store).last_tick === new Date(c.v).toISOString());
  const s = stateOf(store);
  t('state has last_start/last_end/last_ok/last_status for each job and no claim left behind', ['a', 'b', 'c'].every(n => s.jobs[n].last_start && s.jobs[n].last_end && s.jobs[n].last_ok && s.jobs[n].last_status === 'ok' && s.jobs[n].last_error === null) && s.claim_id === '' && s.claim_until === '', s);
  t('successful ticks write NO Ops_Telemetry rows', L.telemetry.length === 0);
  t('one Scheduler_State row only (no per-job Config keys)', Object.keys(store.cfg()).filter(k => /^Scheduler|Cron_Sweep/.test(k)).join() === 'Scheduler_State');
}
// 2b double call within the interval is a no-op (no duplicate run)
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval']]);
  await L.schedRunNext({}, null, fast(c, { jobs }));
  c.v += 5 * 60000;
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('double call 5 min later: job not run again', r.body.ran === null && log.length === 1);
  c.v += 8 * 60000;   // 13 min since start
  await L.schedRunNext({}, null, fast(c, { jobs }));
  t('13 min after start: still not run', log.length === 1);
  c.v += 60000;       // 14 min
  await L.schedRunNext({}, null, fast(c, { jobs }));
  t('14 min after start: runs again', log.length === 2);
}
// 2c once-per-key for a daily job, even called repeatedly (a second Apps Script project would look like this)
{
  const store = primeState(makeStore()), L = load(store), c = clock(Date.parse('2026-10-12T12:00:00Z')), log = [];   // 08:00 ET
  const jobs = mkJobs(log, [['d', 'daily', {}]]);
  for (let i = 0; i < 6; i++) { await L.schedRunNext({}, null, fast(c, { jobs })); c.v += 20 * 60000; }
  t('daily job ran once across six ticks the same ET day', log.length === 1, log);
  c.v = Date.parse('2026-10-13T12:00:00Z');
  await L.schedRunNext({}, null, fast(c, { jobs }));
  t('and once more the next ET day', log.length === 2);
}
// 2d concurrency: N callers at once, one due job -> runs exactly once
for (const N of [2, 5, 8]) {
  const store = makeStore(); store.latency = () => Math.floor(Math.random() * 6);
  const L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['only_job', 'interval', { run: async () => { await tick(15); log.push('only_job'); return { ok: true, errors: [] }; } }]]);
  const rs = await Promise.all(Array.from({ length: N }, () => L.schedRunNext({}, null, { now: c.now, sleep: tick, verifyDelayMs: 60, budgetMs: 5000, jobs })));
  const ran = rs.filter(r => r.body.ran === 'only_job');
  t(`concurrency (${N} simultaneous callers): the job ran exactly once`, log.length === 1 && ran.length === 1, { log, skipped: rs.map(r => r.body.skipped || r.body.ran) });
  t(`concurrency (${N}): every other caller was told it lost / the claim is held`, rs.filter(r => r.body.skipped).length === N - 1);
}
// 2e two callers each with their own job list pass, interleaved over several rounds: no job runs twice in a tick
{
  const store = makeStore(); store.latency = () => Math.floor(Math.random() * 4);
  const L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval'], ['b', 'interval'], ['c', 'interval']]);
  const caller = async () => { for (let i = 0; i < 6; i++) { await L.schedRunNext({}, null, { now: c.now, sleep: tick, verifyDelayMs: 40, budgetMs: 5000, jobs }); await tick(2); } };
  await Promise.all([caller(), caller()]);
  t('two looping callers: each job ran exactly once in the window', ['a', 'b', 'c'].every(n => log.filter(x => x === n).length === 1), log);
}
// 2f held claim and expiry self-heal
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval']]);
  const held = S0(); held.claim_id = 'dead'; held.claim_job = 'a'; held.claim_until = new Date(T0 + 3 * 60000).toISOString();
  store.tabs.get('Config').push(['Scheduler_State', JSON.stringify(held)]);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('a live claim blocks the run and names the holder', r.status === 200 && r.body.ran === null && /claim/.test(r.body.skipped) && r.body.claim_job === 'a' && log.length === 0);
  c.v = T0 + 3 * 60000 + 1;   // claim expired (runner died mid-flight)
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('an expired claim self-heals: the next caller runs the job', r2.body.ran === 'a' && log.length === 1);
  t('and the stale claim is cleared', stateOf(store).claim_id === '');
}
// 2g throwing job: logged, recorded, returned, never blocks the others
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['bad', 'interval', { run: async () => { throw new Error('kaboom with detail'); } }], ['good', 'interval']]);
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('throwing job -> job_ok false + error text returned (HTTP 200: the dispatcher itself worked)', r1.status === 200 && r1.body.ran === 'bad' && r1.body.job_ok === false && /kaboom with detail/.test(r1.body.error) && r1.body.ok === true, r1.body);
  t('throwing job -> Ops_Telemetry FALSE row with Job_Type scheduler_job and the job name', L.telemetry.length === 1 && L.telemetry[0].Success === 'FALSE' && L.telemetry[0].Job_Type === 'scheduler_job' && L.telemetry[0].Skill_Or_Endpoint === 'bad' && /kaboom/.test(L.telemetry[0].Notes), L.telemetry);
  t('throwing job -> admin alert attempted (rate-limited inside alertAdminOnFailure)', L.alerts.length === 1 && L.alerts[0].k === 'scheduler_bad');
  t('throwing job -> state records last_error + failed status, no last_ok', (() => { const j = stateOf(store).jobs.bad; return /kaboom/.test(j.last_error) && j.last_status === 'failed' && !j.last_ok; })());
  t('throwing job -> the next job still runs on the next call', r1.body.more === true && (await L.schedRunNext({}, null, fast(c, { jobs }))).body.ran === 'good' && log.join() === 'good');
  const r3 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('failed interval job is not hammered: not re-run before its interval', r3.body.ran === null);
  const st = L.schedStatus(stateOf(store), new Date(c.v + 50 * 60000), jobs);
  t('and shows up overdue in the status report with its error', st.overdue.includes('bad') && /never completed/.test(st.jobs.bad.overdue_reason) && /kaboom/.test(st.jobs.bad.last_error));
}
// 2h step-level failures (a job returning errors without throwing) are failures too; telemetry failure is surfaced
{
  const store = makeStore(), L = load(store, { telemetryFails: true }), c = clock(T0);
  const jobs = mkJobs([], [['x', 'interval', { run: async () => ({ ok: true, errors: [{ step: 'quiet_hours', error: 'sheet 429' }] }) }]]);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('job returning errors[] is job_ok false with step names', r.body.job_ok === false && /quiet_hours: sheet 429/.test(r.body.error));
  t('telemetry write failing is itself reported in the result (not swallowed)', /telemetry sheet down/.test(r.body.telemetry_error || ''), r.body);
}
// 2i state write failures are loud
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval']]);
  let writes = 0;
  store.failWhen = (m, p) => { if (m === 'POST' && p === '/values:batchUpdate') { writes++; return writes > 0; } return false; };
  store.tabs.get('Config').push(['Scheduler_State', '']);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('cannot write the claim -> 503, job NOT run, error says why', r.status === 503 && r.body.ok === false && /claim/.test(r.body.error) && log.length === 0, r.body);
  t('dispatcher failure is logged to telemetry', L.telemetry.some(x => x.Success === 'FALSE' && x.Skill_Or_Endpoint === 'dispatcher'));
}
{
  // claim write works, end-of-run write fails -> ok:false + STATE NOT RECORDED
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval', { run: async () => { log.push('a'); store.failWhen = (m, p) => m === 'POST' && p === '/values:batchUpdate'; return { ok: true, errors: [] }; } }]]);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('end-of-run state write failing -> ok:false, state_error set, telemetry row', r.body.ok === false && /STATE NOT RECORDED/.test(r.body.error) && !!r.body.state_error && L.telemetry.some(x => /could not record/.test(x.Notes)), r.body);
}
// 2j unreadable / corrupt state never "re-runs everything"
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval']]);
  store.tabs.get('Config').push(['Scheduler_State', '{corrupt']);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('corrupt Scheduler_State -> 503 with reset instructions, nothing run', r.status === 503 && /not valid JSON/.test(r.body.error) && /Delete that Config row/.test(r.body.error) && log.length === 0);
  const store2 = makeStore(), L2 = load(store2);
  store2.failWhen = (m, p) => m === 'GET';
  const r2 = await L2.schedRunNext({}, null, fast(c, { jobs }));
  t('Config read failure -> 503, nothing run, error names the read', r2.status === 503 && /could not read Config/.test(r2.body.error) && log.length === 0);
  const sres = await L2.schedStatusHandler({});
  t('status handler: Config read failure is a 503, not an empty report', sres.status === 503 && sres.body.ok === false);
}
// 2k time budget: slow job answers timed_out, finishes in the background and records itself
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const waits = [];
  const jobs = mkJobs(log, [['slow', 'interval', { run: async () => { await tick(120); log.push('slow'); return { ok: true, errors: [] }; } }]]);
  const r = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 30 }));
  t('slow job: caller gets timed_out (not a hang, not a failure), more=false', r.body.timed_out === true && r.body.ran === 'slow' && r.body.job_ok === null && r.body.more === false && r.body.ok === true, r.body);
  t('slow job: handed to ctx.waitUntil so it survives the caller hanging up', waits.length === 1);
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('while it is still running the claim holds: no second run', r2.body.skipped && log.length === 0);
  await Promise.all(waits);
  t('slow job finished and recorded its result in state', log.length === 1 && stateOf(store).jobs.slow.last_status === 'ok' && stateOf(store).claim_id === '');
}
// 2l daily retry / no_retry / retry:false semantics
{
  const store = primeState(makeStore()), L = load(store), c = clock(Date.parse('2026-10-12T14:00:00Z')), log = [];
  let fails = 2;
  const jobs = mkJobs(log, [['d', 'daily', { run: async () => { log.push('d'); return fails-- > 0 ? { ok: false, errors: [{ step: 's', error: 'transient' }] } : { ok: true, errors: [] }; } }]]);
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('daily failure recorded with attempts=1 and NOT marked done', r1.body.job_ok === false && stateOf(store).jobs.d.attempts.n === 1 && !stateOf(store).jobs.d.last_key);
  t('retry not before 30 min', (await L.schedRunNext({}, null, fast(c, { jobs }))).body.ran === null && log.length === 1);
  c.v += 31 * 60000;
  const r3 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('retried after 30 min (still failing)', r3.body.ran === 'd' && r3.body.job_ok === false && stateOf(store).jobs.d.attempts.n === 2);
  c.v += 31 * 60000;
  const r4 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('third attempt succeeds -> marked done for the ET day', r4.body.job_ok === true && stateOf(store).jobs.d.last_key === '2026-10-12' && !stateOf(store).jobs.d.attempts);
  c.v += 31 * 60000;
  t('and is then never run again that day', (await L.schedRunNext({}, null, fast(c, { jobs }))).body.ran === null && log.length === 3);
}
{
  const store = primeState(makeStore()), L = load(store), c = clock(Date.parse('2026-10-12T14:00:00Z')), log = [];
  const jobs = mkJobs(log, [
    ['noretry', 'daily', { retry: false, run: async () => { log.push('noretry'); return { ok: false, errors: [{ step: 'send', error: 'smtp 500' }] }; } }],
    ['after_send', 'daily', { run: async () => { log.push('after_send'); return { ok: false, errors: [{ step: 'send', error: 'half sent' }], no_retry: true }; } }],
  ]);
  await L.schedRunNext({}, null, fast(c, { jobs })); await L.schedRunNext({}, null, fast(c, { jobs }));
  c.v += 3 * 3600000;
  await L.schedRunNext({}, null, fast(c, { jobs }));
  t('retry:false and result.no_retry:true failures are never auto-retried (no duplicate sends)', log.join() === 'noretry,after_send', log);
  const s = stateOf(store), st = L.schedStatus(s, new Date(c.v), jobs);
  t('...but they are loudly overdue with the error in /cron/status', st.overdue.join() === 'noretry,after_send' && /smtp 500/.test(st.jobs.noretry.overdue_reason), st);
}
// 2m only / force / unknown / dry
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval'], ['b', 'interval']]);
  const bad = await L.schedRunNext({}, null, fast(c, { jobs, only: ['zzz'] }));
  t('unknown job name -> 400', bad.status === 400 && /unknown job/.test(bad.body.error) && log.length === 0);
  const badForce = await L.schedRunNext({}, null, fast(c, { jobs, force: true }));
  t('force without exactly one job -> 400', badForce.status === 400);
  const dry = await L.schedRunNext({}, null, fast(c, { jobs, dry: true }));
  t('dry run: lists due jobs, runs nothing, writes nothing', dry.body.dry === true && dry.body.due.join() === 'a,b' && log.length === 0 && !store.cfg().Scheduler_State && !store.calls.some(x => x.startsWith('POST')));
  const only = await L.schedRunNext({}, null, fast(c, { jobs, only: ['b'] }));
  t('only[] runs just that job', only.body.ran === 'b' && log.join() === 'b' && only.body.more === false);
  const f = await L.schedRunNext({}, null, fast(c, { jobs, only: ['b'], force: true }));
  t('force re-runs a not-due job once', f.body.ran === 'b' && log.join() === 'b,b');
}
// 2n the real registry's job functions: inspect + split behaviour with stubs
{
  const store = makeStore(), c = clock(Date.parse('2026-10-12T14:00:00Z'));
  const L = load(store, { stubs: {
    processQuietHoursQueue: async () => ({ checked: 2, results: [{ id: '1', sent: true, failed: false }, { id: '2', sent: false, failed: true, gate_snapshot: 'ok' }] }),
    receiptScan: async () => ({ status: 200, clone() { return this; }, async json() { return { ok: true, errors: ['file x unreadable'] }; } }),
    sendReceiptsToQBEmail: async () => ({ ok: true, sent: 1, failed: [{ id: 'r1' }] }),
    deliverDigest: async () => { throw new Error('twilio down'); },
    maybeRunDailySelftest: async () => ({ ok: true, total: 10, passed: 8, failed: 2 }),
    qbSyncPayments: async () => ({ ok: true, errors: [], failed: 3, deposit_sweep: true }),
  } });
  const env = {};
  const sweep = await L.SCHED_JOBS.find(j => j.name === 'sweep').run(env);
  t('sweep: a held message that failed to SEND is a job failure (not a quiet "sent:false")', sweep.ok === false && sweep.errors.some(e => /failed to send: 2/.test(e.error)), sweep.errors);
  const rec = await L.SCHED_JOBS.find(j => j.name === 'daily_receipts').run(env);
  t('daily_receipts: a Response whose body lists errors is a failure', rec.ok === false && /file x unreadable/.test(JSON.stringify(rec.errors)));
  const post = await L.SCHED_JOBS.find(j => j.name === 'daily_receipts_post').run(env);
  t('daily_receipts_post: failed email batch -> failure AND no_retry (never blindly re-sent)', post.ok === false && post.no_retry === true);
  const dig = await L.SCHED_JOBS.find(j => j.name === 'daily_digest').run(env);
  t('daily_digest: delivery throwing is a failure and no_retry (it may already have texted)', dig.ok === false && dig.no_retry === true && /twilio down/.test(JSON.stringify(dig.errors)));
  const chk = await L.SCHED_JOBS.find(j => j.name === 'sweep_checks').run(env);
  t('sweep_checks: selftest findings are reported by the selftest itself, not as a scheduler failure', chk.ok === true && chk.detail.selftest.selftest_failed === 2);
  const qb = await L.SCHED_JOBS.find(j => j.name === 'daily_qb_sync').run(env);
  t('daily_qb_sync: same failure condition as the old scheduled() (ok:false / errors) - a failed count alone is not a job failure', qb.ok === true);
  const dig2 = load(makeStore(), { stubs: { buildDigest: async () => { throw new Error('sheet down'); } } });
  const d2 = await dig2.SCHED_JOBS.find(j => j.name === 'daily_digest').run({});
  t('daily_digest: build failing is retryable (nothing was sent)', d2.ok === false && !d2.no_retry);
  const okL = load(makeStore());
  const d3 = await okL.SCHED_JOBS.find(j => j.name === 'daily_digest').run({});
  t('daily_digest: success writes its heartbeat row (Job_Type daily_digest, Success TRUE)', d3.ok === true && okL.telemetry.length === 1 && okL.telemetry[0].Job_Type === 'daily_digest' && okL.telemetry[0].Success === 'TRUE');
  const insp = load(makeStore(), { stubs: { inspStrGuardTick: async () => { throw new Error('calendar 500'); } } });
  const ir = await insp.SCHED_JOBS.find(j => j.name === 'insp_guard').run({});
  t('insp_guard: throw is reported (and the inspection alert path still fires)', ir.ok === false && /calendar 500/.test(JSON.stringify(ir.errors)));
  const insp2 = load(makeStore(), { stubs: { inspStrGuardTick: async () => ({ enabled: true, error: 'cannot read calendar' }) } });
  t('insp_guard: a returned {error} is a failure', (await insp2.SCHED_JOBS.find(j => j.name === 'insp_guard').run({})).ok === false);
  const wr = load(makeStore(), { stubs: { runWeeklyReview: async () => ({ ok: true, logged: false, logged_error: 'tab missing', delivery: null }) } });
  t('weekly review: history row not saved is a failure', (await wr.SCHED_JOBS.find(j => j.name === 'review_mon').run({})).ok === false);
}

// 2o FIRST-EVER TICK: no duplicates. With a blank Scheduler_State, daily/weekly jobs whose slot already passed today (ET) are
// SEEDED as done (the old crons / a person already ran them), 15-minute jobs run at once, and later slots run normally.
const DAILY5 = ['daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync'];
const INTERVAL5 = ['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard'];
// Drain one "tick" the way the Apps Script does: call until more=false. Returns { ran, first } (first = the first response).
const drain = async (L, c, extra) => {
  const ran = []; let first = null;
  for (let i = 0; i < 30; i++) {
    const r = await L.schedRunNext({}, null, fast(c, extra || {}));
    if (!first) first = r;
    if (r.body.ran) ran.push(r.body.ran);
    if (!r.body.more) break;
  }
  return { ran, first };
};
{
  // Monday 21:00 ET (Oct 13 01:00Z): the old crons ran this morning
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-13T01:00:00Z'));
  const a = await drain(L, c);
  t('first tick Mon 21:00 ET runs ONLY the five 15-minute jobs', a.ran.join() === INTERVAL5.join(), a.ran);
  t('first tick reports first_run + seeded:[the 5 dailies and the two Monday weeklies]', a.first.body.first_run === true && a.first.body.seeded.join() === [...DAILY5, 'review_mon', 'ar_report_mon'].join(), a.first.body);
  const s = stateOf(store);
  t('seeded jobs carry last_key = today (ET), last_status seeded, last_seeded:true and NO forged last_ok / last_start', ['daily_digest', 'review_mon', 'ar_report_mon'].every(n => s.jobs[n].last_key === '2026-10-12' && s.jobs[n].last_status === 'seeded' && s.jobs[n].last_seeded === true && !s.jobs[n].last_ok && !s.jobs[n].last_start), s.jobs.daily_digest);
  t('review_wed (Wednesday job) is not seeded on a Monday', !s.jobs.review_wed);
  t('state records the seeding summary', s.seeded && s.seeded.jobs.length === 7 && !!s.seeded.at);
  const st = L.schedStatus(s, new Date(c.v), L.SCHED_JOBS);
  t('/cron/status shows seeded jobs as seeded, not overdue; top-level seeded summary present', st.seeded && st.seeded.jobs.length === 7 && st.jobs.daily_digest.seeded === true && st.jobs.daily_digest.last_ok === null && !st.overdue.includes('daily_digest') && !st.overdue.includes('review_mon'), st.overdue);
  c.v += 20 * 60000;
  const b = await drain(L, c);
  t('second tick does NOT reseed (no seeded / first_run fields) and the dailies stay quiet', b.first.body.seeded === undefined && b.first.body.first_run === undefined && b.ran.every(n => INTERVAL5.includes(n)), b);
  c.v = Date.parse('2026-10-13T11:00:00Z');   // Tue 07:00 EDT
  const d = await drain(L, c);
  t('next morning 07:00 ET the five dailies run (once), the Monday jobs do not', DAILY5.every(n => d.ran.includes(n)) && !d.ran.includes('review_mon') && !d.ran.includes('ar_report_mon'), d.ran);
  t('...and the seed marker is replaced by a real run', stateOf(store).jobs.daily_digest.last_seeded === undefined && stateOf(store).jobs.daily_digest.last_status === 'ok' && !!stateOf(store).jobs.daily_digest.last_ok);
  c.v = Date.parse('2026-10-14T12:00:00Z');   // Wed 08:00 EDT
  t('Wednesday 08:00 ET review_wed runs', (await drain(L, c)).ran.includes('review_wed'));
  c.v = Date.parse('2026-10-19T12:29:00Z');   // next Mon 08:29
  t('next Monday 08:29 ET review_mon does not run yet', !(await drain(L, c)).ran.includes('review_mon'));
  c.v = Date.parse('2026-10-19T12:30:00Z');
  t('next Monday 08:30 ET review_mon runs', (await drain(L, c)).ran.includes('review_mon'));
  c.v = Date.parse('2026-10-19T13:00:00Z');
  t('next Monday 09:00 ET ar_report_mon runs', (await drain(L, c)).ran.includes('ar_report_mon'));
}
{
  // Monday 06:00 ET (10:00Z): nothing has passed yet -> nothing seeded, everything runs at its slot
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-12T10:00:00Z'));
  const a = await drain(L, c);
  t('first tick Mon 06:00 ET seeds nothing (seeded is an empty list) and runs the five interval jobs', a.first.body.first_run === true && a.first.body.seeded.length === 0 && a.ran.join() === INTERVAL5.join() && !stateOf(store).seeded, a.first.body);
  c.v = Date.parse('2026-10-12T10:59:00Z');
  t('06:59 ET: dailies still not due', !(await drain(L, c)).ran.some(n => DAILY5.includes(n)));
  c.v = Date.parse('2026-10-12T11:00:00Z');
  const d = await drain(L, c);
  t('07:00 ET: all five dailies run', DAILY5.every(n => d.ran.includes(n)), d.ran);
  c.v = Date.parse('2026-10-12T12:30:00Z');
  t('08:30 ET: review_mon runs', (await drain(L, c)).ran.includes('review_mon'));
  c.v = Date.parse('2026-10-12T13:00:00Z');
  t('09:00 ET: ar_report_mon runs', (await drain(L, c)).ran.includes('ar_report_mon'));
}
{
  // mid-morning first tick (Mon 08:45 ET): dailies + review_mon seeded, ar_report_mon (09:00) still to come
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-12T12:45:00Z'));
  const a = await drain(L, c);
  t('first tick Mon 08:45 ET: seeds the dailies + review_mon but NOT ar_report_mon', a.first.body.seeded.join() === [...DAILY5, 'review_mon'].join(), a.first.body.seeded);
  c.v = Date.parse('2026-10-12T13:00:00Z');
  const b = await drain(L, c);
  t('...and ar_report_mon then runs at 09:00 ET while the seeded ones stay quiet', b.ran.includes('ar_report_mon') && !b.ran.includes('review_mon') && !b.ran.some(n => DAILY5.includes(n)), b.ran);
}
{
  // DST: fall-back day, Monday Nov 2 2026 is EST (UTC-5): 13:29Z = 08:29 EST
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-11-02T13:29:00Z'));
  const a = await drain(L, c);
  t('DST (EST): first tick 08:29 EST seeds the dailies only (review_mon is 08:30 EST)', a.first.body.seeded.join() === DAILY5.join() && a.ran.join() === INTERVAL5.join(), a.first.body.seeded);
  c.v = Date.parse('2026-11-02T13:30:00Z');
  t('DST (EST): review_mon runs at 13:30Z = 08:30 EST', (await drain(L, c)).ran.includes('review_mon'));
  c.v = Date.parse('2026-11-02T14:00:00Z');
  t('DST (EST): ar_report_mon runs at 14:00Z = 09:00 EST', (await drain(L, c)).ran.includes('ar_report_mon'));
}
{
  // DST: spring-forward day, Sunday Mar 8 2026 is EDT after 2am (UTC-4): 10:59Z = 06:59 EDT, 11:00Z = 07:00 EDT
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-03-08T10:59:00Z'));
  const a = await drain(L, c);
  t('DST (spring-forward day): first tick 06:59 EDT seeds nothing', a.first.body.seeded.length === 0 && a.ran.join() === INTERVAL5.join());
  c.v = Date.parse('2026-03-08T11:00:00Z');
  t('DST (spring-forward day): dailies run at 07:00 EDT (11:00Z), not an hour later', (await drain(L, c)).ran.filter(n => DAILY5.includes(n)).length === 5);
  const store2 = makeStore(), L2 = load(store2);
  t('DST (spring-forward day): a first tick at 07:30 EDT seeds the five dailies', (await drain(L2, clock(Date.parse('2026-03-08T11:30:00Z')))).first.body.seeded.join() === DAILY5.join());
}
{
  // a Scheduler_State row that exists but is blank is ALSO a first run
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-13T01:00:00Z'));
  store.tabs.get('Config').push(['Scheduler_State', '   ']);
  const a = await drain(L, c);
  t('blank Scheduler_State cell (row present) is a first run too', a.first.body.first_run === true && a.first.body.seeded.length === 7);
}
{
  // jobs added to the registry LATER keep catch-up: existing state, no entry for the new job -> it runs
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-12T19:00:00Z')), log = [];   // 15:00 ET
  const st0 = S0(); st0.jobs.old_job = { last_key: '2026-10-12', last_status: 'ok', last_ok: '2026-10-12T11:00:00.000Z' };
  store.tabs.get('Config').push(['Scheduler_State', JSON.stringify(st0)]);
  const jobs = mkJobs(log, [['old_job', 'daily'], ['new_job', 'daily']]);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('a newly added daily job whose slot passed catches up on existing state (not seeded)', r.body.ran === 'new_job' && r.body.seeded === undefined && r.body.first_run === undefined && log.join() === 'new_job', r.body);
  t('...while the job that already ran today stays quiet', (await L.schedRunNext({}, null, fast(c, { jobs }))).body.ran === null && log.length === 1);
}
{
  // dry run on a blank state: reports first_run + would_seed, writes NOTHING, claims NOTHING
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-13T01:00:00Z'));
  const r = await L.schedRunNext({}, null, fast(c, { dry: true }));
  t('dry run on blank state: first_run true, would_seed lists the seven, due is only the interval jobs', r.body.dry === true && r.body.first_run === true && r.body.would_seed.length === 7 && r.body.due.join() === INTERVAL5.join(), r.body);
  t('dry run wrote nothing (no POST, no Scheduler_State) and a real tick afterwards is still a first run', !store.calls.some(x => x.startsWith('POST')) && !store.cfg().Scheduler_State && (await L.schedRunNext({}, null, fast(c, {}))).body.first_run === true);
}
{
  // concurrent first ticks: still exactly one run of each interval job, no daily job runs
  const store = makeStore(); store.latency = () => Math.floor(Math.random() * 4);
  const L = load(store), c = clock(Date.parse('2026-10-13T01:00:00Z')), log = [];
  const jobs = [...INTERVAL5.map(n => ({ name: n, kind: 'interval', every_min: 14, run: async () => { log.push(n); return { ok: true, errors: [] }; } })),
    ...DAILY5.map(n => ({ name: n, kind: 'daily', at: '07:00', run: async () => { log.push(n); return { ok: true, errors: [] }; } }))];
  const caller = async () => { for (let i = 0; i < 80 && log.length < INTERVAL5.length; i++) { await L.schedRunNext({}, null, { now: c.now, sleep: tick, verifyDelayMs: 30, budgetMs: 5000, jobs }); await tick(2); } };
  await Promise.all([caller(), caller(), caller()]);
  t('three simultaneous first-tick callers: each interval job ran once, no daily job ran (seeded)', INTERVAL5.every(n => log.filter(x => x === n).length === 1) && !log.some(n => DAILY5.includes(n)), log);
}

// ───────────────────────────── 3. the REAL worker.js over a fake Google ─────────────────────────────
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
const outbound = [];     // every non-Google URL the worker tried to reach
const realFetch = globalThis.fetch;
const _realSetTimeout = globalThis.setTimeout;   // cron-env reads are paced 2.5s apart (real quota protection) - skip those waits here
globalThis.setTimeout = (fn, ms, ...a) => _realSetTimeout(fn, ms >= 2000 ? 1 : ms, ...a);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) {
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), body);
    return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 });
  }
  outbound.push(method + ' ' + url);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789';
const SCHED_TOKEN = 'sched-token-for-tests-' + 'k'.repeat(30);
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET };
// The worker caches whole-tab reads for 6s per isolate; the fake sheet is edited out-of-band between calls, so move the worker's
// Date.now() forward before each request (only Date.now - the scheduler's own clock use is injected/relative).
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;
const call = async (method, path, headers, body) => {
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: () => {} });
  let j = null; try { j = await res.clone().json(); } catch (_) {}
  return { status: res.status, json: j };
};
store.setCfg('Scheduler_Token', SCHED_TOKEN);
store.setCfg('admin_phone', '+15555550100');

{
  // auth matrix against the real gate
  const H = { 'X-Auth-Token': SCHED_TOKEN };
  const st = await call('GET', '/cron/status', H);
  t('gate: GET /cron/status with Scheduler_Token -> 200 + report', st.status === 200 && st.json.ok === true && st.json.jobs && st.json.jobs.sweep, st);
  const denied = [['POST', '/cron/status'], ['GET', '/cron/run'], ['POST', '/cron/sweep'], ['GET', '/workorders'], ['GET', '/vendors'], ['POST', '/status'], ['GET', '/config'], ['POST', '/config/set'], ['POST', '/admin-notify'], ['POST', '/workorder'], ['GET', '/hub-bootstrap']];
  for (const [m, p] of denied) { const r = await call(m, p, H, m === 'POST' ? {} : undefined); t(`gate: Scheduler_Token is rejected (401) on ${m} ${p}`, r.status === 401, r.status); }
  const bad = await call('GET', '/cron/status', { 'X-Auth-Token': SCHED_TOKEN.slice(0, -1) + 'Z' });
  t('gate: wrong token -> 401', bad.status === 401);
  const none = await call('GET', '/cron/status', {});
  t('gate: no token -> 401', none.status === 401);
  const empty = await call('GET', '/cron/status', { 'X-Auth-Token': '' });
  t('gate: empty token -> 401', empty.status === 401);
  const admin = await call('GET', '/cron/status', { 'X-Auth-Token': SECRET });
  t('gate: the admin secret still works for the status report', admin.status === 200);
  // blank / missing / short Scheduler_Token in Config fails closed
  store.setCfg('Scheduler_Token', '');
  const blank = await call('GET', '/cron/status', { 'X-Auth-Token': '' });
  const blank2 = await call('GET', '/cron/status', { 'X-Auth-Token': 'anything-at-all-anything-at-all' });
  t('gate: blank Scheduler_Token in Config fails closed (empty and non-empty headers)', blank.status === 401 && blank2.status === 401);
  store.setCfg('Scheduler_Token', 'short');
  t('gate: short Scheduler_Token fails closed', (await call('GET', '/cron/status', { 'X-Auth-Token': 'short' })).status === 401);
  const row = store.tabs.get('Config'); const saved = row.filter(r => r[0] === 'Scheduler_Token'); row.splice(0, row.length, ...row.filter(r => r[0] !== 'Scheduler_Token'));
  t('gate: missing Scheduler_Token row fails closed', (await call('GET', '/cron/status', { 'X-Auth-Token': SCHED_TOKEN })).status === 401);
  store.setCfg('Scheduler_Token', SCHED_TOKEN);
  store.failWhen = (m, p) => m === 'GET' && p === '/values/Config';
  const down = await call('GET', '/cron/status', H);
  t('gate: a Config read failure is a loud 503, not a misleading 401', down.status === 503 && /scheduler auth unavailable/.test(down.json.error), down);
  store.failWhen = null;
}
{
  // Scheduler_Token is redacted in every Config listing (admin-secret caller included)
  const cfg = await call('GET', '/config', { 'X-Auth-Token': SECRET });
  t('redaction: GET /config hides Scheduler_Token for the admin caller', cfg.status === 200 && cfg.json.Scheduler_Token === '(set — hidden)' && !JSON.stringify(cfg.json).includes(SCHED_TOKEN), cfg.json && cfg.json.Scheduler_Token);
  const isSecret = new Function(wsrc.slice(wsrc.indexOf('const CONFIG_SECRET_KEYS'), wsrc.indexOf('function isConfigRedactionPlaceholder')) + '\nreturn isSecretConfigKey;')();
  t('redaction: Scheduler_Token matches the secret-key pattern; Scheduler_State (not a secret) does not', isSecret('Scheduler_Token') === true && isSecret('Scheduler_State') === false);
}
{
  // real end-to-end: dry run, a real job, state, status, health
  const H = { 'X-Auth-Token': SCHED_TOKEN };
  const dry = await call('POST', '/cron/run', H, { dry: true });
  t('POST /cron/run dry: lists due jobs, nothing run/written', dry.status === 200 && dry.json.dry === true && dry.json.due.includes('door_watchdog') && !store.cfg().Scheduler_State, dry);
  const unk = await call('POST', '/cron/run', H, { only: 'nope' });
  t('POST /cron/run: unknown job -> 400', unk.status === 400);
  const r = await call('POST', '/cron/run', H, { only: 'insp_guard' });
  t('POST /cron/run only=insp_guard: ran, job_ok (module not configured -> clean no-op), more=false', r.status === 200 && r.json.ran === 'insp_guard' && r.json.job_ok === true && r.json.more === false, r);
  const s = JSON.parse(store.cfg().Scheduler_State);
  t('state landed in the single Config key with last_ok', s.jobs.insp_guard && s.jobs.insp_guard.last_status === 'ok' && !!s.jobs.insp_guard.last_ok && s.claim_id === '');
  const again = await call('POST', '/cron/run', H, { only: 'insp_guard' });
  t('calling it again immediately is a no-op (interval gate)', again.json.ran === null);
  const stat = await call('GET', '/cron/status', H);
  t('status: insp_guard fine, never-run jobs overdue', stat.json.jobs.insp_guard.overdue === false && stat.json.overdue.includes('sweep') && stat.json.tick_age_min <= 2, stat.json.overdue);
  const h = await call('GET', '/health', {});
  t('public /health carries a coarse scheduler summary (age + overdue NAMES only)', h.status === 200 && h.json.scheduler && typeof h.json.scheduler.last_tick_age_min === 'number' && Array.isArray(h.json.scheduler.overdue) && h.json.scheduler.overdue.includes('sweep') && !('jobs' in h.json.scheduler) && !JSON.stringify(h.json.scheduler).includes('last_error'), h.json && h.json.scheduler);
  const noauth = await call('POST', '/cron/run', {}, {});
  t('POST /cron/run without a token -> 401', noauth.status === 401);
  const getRun = await call('GET', '/cron/run', H);
  t('GET /cron/run -> 401 (Scheduler_Token only authorises POST there)', getRun.status === 401);
}
{
  // the hub-test (staging) token may only dry-run / run the two safe jobs - exercise the REAL hubTestWriteAllowed (a TDZ bug here shipped once: `_b` is declared further down the function)
  const fstart = wsrc.indexOf('async function hubTestWriteAllowed('), fend = wsrc.indexOf('\nasync function ', fstart + 10);
  const real = new Function('SCHED_STAGING_SAFE_JOBS', wsrc.slice(fstart, fend) + '\nreturn hubTestWriteAllowed;')(['door_watchdog', 'insp_guard']);
  const check = (body) => real({}, '/cron/run', body);
  t('hub-test guard: dry run allowed', (await check({ dry: true })) === true);
  t('hub-test guard: insp_guard / door_watchdog allowed', (await check({ only: 'insp_guard' })) === true && (await check({ only: 'door_watchdog' })) === true);
  t('hub-test guard: a bare run (all due jobs), the sweeps, force and arrays are refused', (await check({})) === false && (await check(undefined)) === false && (await check({ only: 'sweep' })) === false && (await check({ only: 'insp_guard', force: true })) === false && (await check({ only: ['insp_guard'] })) === false && (await check({ dry: 'true' })) === false);
}
{
  // scheduled() is a loud no-op
  outbound.length = 0;
  const unexpectedRows = () => { const tab = store.tabs.get('Ops_Telemetry') || []; const jt = (tab[0] || []).indexOf('Job_Type'); return tab.slice(1).filter(r => r[jt] === 'unexpected_cloudflare_cron'); };
  const hdrOf = () => store.tabs.get('Ops_Telemetry')[0];
  let threw = null;
  try { await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.parse('2026-10-12T14:00:00Z') }, env, { waitUntil() {} }); } catch (e) { threw = e; }
  const tel = unexpectedRows();
  const su = hdrOf().indexOf('Success'), no = hdrOf().indexOf('Notes');
  t('scheduled(): throws (shows as a failed run in Cloudflare)', !!threw && /NO cron is allowed/.test(threw.message), threw && threw.message);
  t('scheduled(): logs ONE Ops_Telemetry FALSE row "unexpected_cloudflare_cron" naming the cron', tel.length === 1 && tel[0][su] === 'FALSE' && /\*\/15/.test(tel[0][no]), tel);
  t('scheduled(): does NO job work (no outbound calls, no sweep claim, no scheduler job run)', outbound.length === 0 && !store.cfg().Cron_Sweep_Claimed_Until, outbound);
  const stateBefore = store.cfg().Scheduler_State;
  let threw2 = null;
  try { await worker.scheduled({ cron: '0 11 * * *' }, env, {}); } catch (e) { threw2 = e; }
  t('scheduled(): second fire within 6h still throws but does not spam telemetry', !!threw2 && unexpectedRows().length === 1);
  t('scheduled(): never touches Scheduler_State', store.cfg().Scheduler_State === stateBefore);
  store.setCfg('unexpected_cron_last_logged', new Date(Date.now() - 7 * 3600000).toISOString());
  skew += 100000;   // scheduled() reads Config through the cron env, which caches whole tabs for 90s
  try { await worker.scheduled({ cron: '0 11 * * *' }, env, {}); } catch (_) {}
  t('scheduled(): logs again after the 6h rate limit', unexpectedRows().length === 2);
}
globalThis.fetch = realFetch;
globalThis.setTimeout = _realSetTimeout;

// ───────────────────────────── 4. no cron anywhere (structure) ─────────────────────────────
{
  const toml = fs.readFileSync(root + 'wrangler.toml', 'utf8');
  const live = toml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  t('wrangler.toml: no cron schedules (the only allowed form is an explicit empty `crons = []`, which is what REMOVES attached triggers)', !/crons\s*=\s*\[\s*["']/.test(live) && /\[triggers\]\s*\n\s*crons\s*=\s*\[\s*\]/.test(live));
  t('wrangler.toml: states the permanent no-cron rule and where to add jobs', /NO CRON TRIGGERS\. EVER\./.test(toml) && /SCHED_JOBS/.test(toml));
  t('wrangler.toml: keep_vars still true', /^keep_vars = true/m.test(toml));
  t('cron-sweep.yml workflow is deleted', !fs.existsSync(root + '.github/workflows/cron-sweep.yml'));
  const wfs = fs.readdirSync(root + '.github/workflows').map(f => [f, fs.readFileSync(root + '.github/workflows/' + f, 'utf8')]);
  t('no workflow calls POST /cron/sweep or /cron/run', wfs.every(([f, s]) => !/cron\/sweep|cron\/run|CRON_SWEEP_TOKEN|SCHEDULER_TOKEN/i.test(s)), wfs.filter(([f, s]) => /cron\/sweep|cron\/run/.test(s)).map(x => x[0]));
  const sched = wsrc.slice(wsrc.indexOf('  async scheduled(event, env, ctx) {'), wsrc.indexOf('// Thin wrapper (Sep 29 2026)'));
  t('scheduled() contains no job calls', !/receiptScan|buildDigest|runWeeklyReview|cronSweep|doorWatchdogCron|qbSyncPayments|processDepositPaidSweep|inspStrGuardTick|releaseTurnoverByDate/.test(sched) && /schedUnexpectedCloudflareCron/.test(sched));
  t('no leftover cronSweepLogged / cron-branch dispatch in worker.js', !/cronSweepLogged/.test(wsrc) && !/cron === '/.test(wsrc));
  // every registry job points at a real function
  const names = [...blockSrc.matchAll(/run: \(env(?:[^)]*)\) => (\w+)\(/g)].map(m => m[1]);
  t('every registry entry maps to a defined job function', names.length === 13 && names.every(n => new RegExp('async function ' + n + '\\(').test(wsrc)), names);
  // the scheduler block never swallows
  t('scheduler block has no empty/underscore catch', !/catch\s*\(\s*_?\s*\)\s*\{\s*\}/.test(blockSrc) && !/catch\s*\(\s*_\s*\)/.test(blockSrc) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(blockSrc));
  const ver = /const BUILD_VERSION = '([^']+)'/.exec(wsrc)[1];
  t('BUILD_VERSION is a 2026-10-12+ build (the scheduler build is 2026-10-12.5-apps-script-scheduler; a same-day bump by another build is fine)', /^2026-10-1[2-9]\.\d+-/.test(ver), ver);
}
{
  // catch-up forms of the two jobs that used to need the exact hour
  const self = wsrc.slice(wsrc.indexOf('async function maybeRunDailySelftest('), wsrc.indexOf('// GET /ar/aging'));
  t('maybeRunDailySelftest: catch-up form (skips only BEFORE 7am), keeps its once-per-day guard, no swallowed read error', /etHour\(\) < 7/.test(self) && !/etHour\(\) !== 7/.test(self) && /already ran today/.test(self) && /if \(!isMissingTabError\(e\)\) throw e/.test(self));
  const est = wsrc.slice(wsrc.indexOf('async function processEstimateReminders('), wsrc.indexOf('async function processEstimateReminders(') + 600);
  t('processEstimateReminders: no longer requires the exact 8am hour', !/!== 8/.test(est) && /h < 8 \|\| h >= 18/.test(est));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
