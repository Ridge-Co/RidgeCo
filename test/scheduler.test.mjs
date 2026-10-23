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
const gi = wsrc.indexOf('// ═══ AI-CREDIT-GUARD-BEGIN'), ge = wsrc.indexOf('// ═══ AI-CREDIT-GUARD-END');
t('AI-credit guard markers exist', gi > 0 && ge > gi);
const blockSrc = wsrc.slice(bi, be) + '\n' + wsrc.slice(gi, ge);
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
    failStatusForScheduler: async () => ({}), __cronEnv: (e) => e, __meterCronEnv: (e) => e, __cronLast429At: () => (over.last429 ? over.last429() : 0), CRON_QUOTA_COOLDOWN_MS: 150000,
    doorWatchdogCron: async () => ({ ok: true }),
    processQuietHoursQueue: async () => ({ checked: 0, results: [] }),
    processPendingNotifications: async () => ({ status: 200, clone() { return this; }, async json() { return { processed: 0 }; } }),
    processVendorNudges: async () => ({ checked: 0, results: [] }),
    processRecurringWorkOrders: async () => ({ templates: 0, posted: 0 }),
    processEstimateReminders: async () => ({ skipped: 'x' }),
    processDepositPaidSweep: async () => ({ ok: true }),
    maybeRunDailySelftest: async () => ({ skipped: true }),
    checkDeadManSwitch: async () => ({ skipped: true }), failRollupRun: async () => ({ ok: true, events_in: 0 }),
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
    hubImpPull: async () => ({ new: 0 }), hubImpReconcile: async () => ({ rows: 0, updated: 0, completed_now: [], problems: [] }), opsQueueSync: async () => ({ ok: true, checked: 0, changed: [], errors: [] }),
    qbSyncPayments: async () => ({ ok: true }), runWeeklyReview: async () => ({ ok: true, logged: true, delivery: null }), runWeeklyArReport: async () => ({ delivered: false }),
  };
  Object.assign(stubs, over.stubs || {});
  const names = Object.keys(stubs);
  const fn = new Function(...names, blockSrc + '\nreturn { schedTokenOk, schedEtParts, schedJobDue, schedDueJobs, schedStatus, schedStampFirstSeen, schedGrace, schedParseState, schedRunNext, schedRunHandler, schedStatusHandler, schedHealthSummary, schedUnexpectedCloudflareCron, schedBadness, schedApplyOverrides, schedEffective, schedExpected, schedCooldownPlan, schedCooldownNext, SCHED_JOBS, SCHED_STAGING_SAFE_JOBS };');
  return Object.assign(fn(...names.map(n => stubs[n])), { telemetry, alerts, stubs });
}
const S0 = () => ({ v: 1, claim_until: '', claim_id: '', claim_job: '', last_tick: '', jobs: {} });
const P = load(makeStore());
// A store that already holds a Scheduler_State (i.e. NOT the first-ever tick), so first-run seeding does not apply.
const primeState = (store) => { store.tabs.get('Config').push(['Scheduler_State', JSON.stringify(S0())]); return store; };

// registry shape
{
  const names = P.SCHED_JOBS.map(j => j.name);
  t('registry priority order', JSON.stringify(names) === JSON.stringify(['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard', 'str_cleaning', 'followup_sweep', 'ai_credit_probe', 'daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync', 'sms_delivery_check', 'twilio_balance_log', 'review_mon', 'review_wed', 'ar_report_mon', 'hub_impr_mon', 'hub_impr_thu', 'hub_impr_daily', 'str_digest_mon', 'str_digest_wed', 'str_digest_fri']), names);
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
  t('priority order when everything is due (Monday 10am ET): daily/weekly jobs first, then the 15-minute jobs, array order inside each', names.join() === 'daily_digest,daily_receipts,daily_receipts_post,daily_turnover,daily_qb_sync,sms_delivery_check,twilio_balance_log,review_mon,ar_report_mon,hub_impr_mon,hub_impr_daily,str_digest_mon,door_watchdog,sweep,sweep_work,sweep_checks,insp_guard,str_cleaning,followup_sweep', names.join());
  // Oct 14 2026 incident: the six 15-minute jobs filled every tick's time share, so no daily/weekly job ever ran. A due daily
  // job must now come BEFORE every due interval job, and interval jobs still run once the dailies are done or backing off.
  const wed = P.schedDueJobs(S0(), iso('2026-10-14T19:00:00Z'), P.SCHED_JOBS, {}).map(d => d.name);   // Wed 3pm ET, nothing has ever run
  const firstInterval = wed.findIndex(n => ['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard', 'str_cleaning', 'followup_sweep'].includes(n));
  t('Wed 3pm, nothing ever run: every daily/weekly job is ahead of every interval job', firstInterval === wed.length - 7 && wed.slice(0, firstInterval).every(n => !['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard', 'str_cleaning', 'followup_sweep'].includes(n)) && wed.includes('review_wed') && wed.includes('str_digest_wed'), wed.join());
  const done = S0(); for (const n of ['daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync', 'sms_delivery_check', 'twilio_balance_log', 'hub_impr_daily', 'review_wed', 'str_digest_wed']) done.jobs[n] = { last_key: '2026-10-14', last_status: 'ok', last_ok: '2026-10-14T19:00:00.000Z', last_end: '2026-10-14T19:00:00.000Z' };
  const after = P.schedDueJobs(done, iso('2026-10-14T19:05:00Z'), P.SCHED_JOBS, {}).map(d => d.name);
  t('once the daily/weekly jobs are done the interval jobs run in their usual order', after.join() === 'door_watchdog,sweep,sweep_work,sweep_checks,insp_guard,str_cleaning,followup_sweep', after.join());
  const backoff = S0(); backoff.jobs.daily_qb_sync = { attempts: { key: '2026-10-14', n: 1 }, last_end: '2026-10-14T19:00:00.000Z', last_start: '2026-10-14T18:59:00.000Z', last_status: 'failed' };
  const bo = P.schedDueJobs(backoff, iso('2026-10-14T19:05:00Z'), P.SCHED_JOBS, {}).map(d => d.name);
  t('a failed daily job in its retry back-off does not block anything (not due until the gap passes)', !bo.includes('daily_qb_sync') && bo.includes('str_cleaning'), bo.join());
  const early = P.schedDueJobs(S0(), iso('2026-10-14T09:00:00Z'), P.SCHED_JOBS, {}).map(d => d.name);   // Wed 05:00 EDT: only the interval jobs
  t('before 7am ET only the 15-minute jobs are due', early.join() === 'door_watchdog,sweep,sweep_work,sweep_checks,insp_guard,str_cleaning,followup_sweep', early.join());
  t('only[] restricts', P.schedDueJobs(S0(), iso('2026-10-12T14:00:00Z'), P.SCHED_JOBS, { only: ['sweep'] }).map(d => d.name).join() === 'sweep');
}
// schedStatus overdue logic
{
  const now = iso('2026-10-12T16:00:00Z');   // Monday 12:00 ET
  const mins = (m) => new Date(now.getTime() - m * 60000).toISOString();
  const fresh = S0(); fresh.last_tick = mins(3);
  for (const n of ['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard', 'str_cleaning', 'followup_sweep']) fresh.jobs[n] = { last_start: mins(5), last_end: mins(4), last_ok: mins(4), last_status: 'ok' };
  for (const n of ['daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync', 'sms_delivery_check']) fresh.jobs[n] = { last_start: mins(300), last_end: mins(299), last_ok: mins(299), last_key: '2026-10-12', last_status: 'ok' };
  for (const n of ['review_mon', 'ar_report_mon', 'hub_impr_mon', 'hub_impr_daily', 'str_digest_mon']) fresh.jobs[n] = { last_end: mins(200), last_ok: mins(200), last_key: '2026-10-12', last_status: 'ok' };
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
// Oct 20 2026: pretend every job's grace clock started long ago (the grace window is what these tests are NOT about).
const ageGrace = (store) => { const s = JSON.parse(store.cfg().Scheduler_State); for (const j of Object.values(s.jobs)) { if (j.grace_from) j.grace_from = '2026-01-01T00:00:00.000Z'; } store.setCfg('Scheduler_State', JSON.stringify(s)); };

// 1g NEW-JOB GRACE (Oct 20 2026): a brand-new / just re-enabled job is not "overdue" until its own limit has passed
{
  const NOW = iso('2026-10-20T16:00:00Z');                       // Tue 12:00 ET
  const minAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString();
  const sw = job('sweep'), dg = job('daily_digest');             // sweep: every 15 min -> limit max(45, 3x15) = 45; daily_digest: 07:00 ET, grace 180
  // stamping
  const st = { v: 1, last_tick: minAgo(1), jobs: { sweep: { last_ok: minAgo(5) }, door_watchdog: {} } };
  const jobsL = P.SCHED_JOBS.map(j => j.name === 'sweep_work' ? Object.assign({}, j, { disabled: true }) : j);
  const ch = P.schedStampFirstSeen(st, NOW, jobsL);
  t('stamp: every job is stamped once', ch.length === jobsL.length && st.jobs.sweep.seen_at === NOW.toISOString());
  t('stamp: a job that already had a success gets NO grace clock (stays strict)', st.jobs.sweep.grace_from === undefined && st.jobs.sweep.last_ok === minAgo(5));
  t('stamp: a never-run job gets seen_at + grace_from', st.jobs.door_watchdog.grace_from === NOW.toISOString() && st.jobs.sweep_checks.grace_from === NOW.toISOString());
  t('stamp: a disabled job is marked seen-disabled (seen_at "") with no grace', st.jobs.sweep_work.seen_at === '' && !st.jobs.sweep_work.grace_from);
  t('stamp: second pass changes nothing', P.schedStampFirstSeen(st, new Date(NOW.getTime() + 60000), jobsL).length === 0 && st.jobs.sweep.seen_at === NOW.toISOString());
  const re = P.schedStampFirstSeen(st, new Date(NOW.getTime() + 120000), P.SCHED_JOBS);   // sweep_work switched back on
  t('stamp: re-enabling a job gets a fresh grace clock', re.join() === 'sweep_work' && st.jobs.sweep_work.grace_from === new Date(NOW.getTime() + 120000).toISOString() && st.jobs.sweep_work.seen_at === new Date(NOW.getTime() + 120000).toISOString());
  // interval job
  const base = { v: 1, last_tick: minAgo(1) };
  const s1 = P.schedStatus(Object.assign({ jobs: { sweep: { seen_at: minAgo(10), grace_from: minAgo(10) } } }, base), NOW, [sw]);
  t('status: new interval job 10 min in is NOT overdue, shows grace', s1.jobs.sweep.overdue === false && s1.jobs.sweep.grace === true && s1.overdue.length === 0 && /new job/.test(s1.jobs.sweep.grace_reason), s1.jobs.sweep);
  const s2 = P.schedStatus(Object.assign({ jobs: { sweep: { seen_at: minAgo(50), grace_from: minAgo(50) } } }, base), NOW, [sw]);
  t('status: new interval job 50 min in (past its 45 min limit) IS overdue - "never completed"', s2.jobs.sweep.overdue === true && /never completed/.test(s2.jobs.sweep.overdue_reason) && s2.overdue.join() === 'sweep', s2.jobs.sweep);
  const slow = Object.assign({}, sw, { every_min: 119, every_human: 120 });   // every 2h -> 3x = 360 min
  const s2b = P.schedStatus(Object.assign({ jobs: { sweep: { seen_at: minAgo(200), grace_from: minAgo(200) } } }, base), NOW, [slow]);
  t('grace scales with cadence: a 2-hour job is still in grace at 200 min (limit 360)', s2b.jobs.sweep.overdue === false && s2b.jobs.sweep.grace === true, s2b.jobs.sweep);
  // re-enabled with an old success
  const reen = { seen_at: minAgo(10), grace_from: minAgo(10), last_ok: minAgo(3 * 24 * 60) };
  const s3 = P.schedStatus(Object.assign({ jobs: { sweep: reen } }, base), NOW, [sw]);
  t('status: a job re-enabled 10 min ago with a 3-day-old success is in grace, not overdue', s3.jobs.sweep.overdue === false && s3.jobs.sweep.grace === true && /switched back on|new job/.test(s3.jobs.sweep.grace_reason), s3.jobs.sweep);
  const s3b = P.schedStatus(Object.assign({ jobs: { sweep: Object.assign({}, reen, { seen_at: '', grace_from: minAgo(10) }) } }, base), NOW, [sw]);
  t('status: re-enable reason says so', /switched back on/.test(s3b.jobs.sweep.grace_reason), s3b.jobs.sweep);
  const s3c = P.schedStatus(Object.assign({ jobs: { sweep: Object.assign({}, reen, { grace_from: minAgo(60) }) } }, base), NOW, [sw]);
  t('status: re-enabled but still no run after 60 min -> overdue "last success was ... min ago"', s3c.jobs.sweep.overdue === true && /last success was/.test(s3c.jobs.sweep.overdue_reason), s3c.jobs.sweep);
  // success since the clock started ends the grace and normal judgment resumes
  const s4 = P.schedStatus(Object.assign({ jobs: { sweep: { seen_at: minAgo(100), grace_from: minAgo(100), last_ok: minAgo(90) } } }, base), NOW, [sw]);
  t('status: it ran OK after grace_from, then went quiet 90 min -> overdue (grace does not hide a real outage)', s4.jobs.sweep.overdue === true && !s4.jobs.sweep.grace, s4.jobs.sweep);
  // an established job (success, no grace clock) keeps the strict rule
  const s5 = P.schedStatus(Object.assign({ jobs: { sweep: { seen_at: minAgo(5000), last_ok: minAgo(90) } } }, base), NOW, [sw]);
  t('status: an established job that stopped is overdue immediately (no grace)', s5.jobs.sweep.overdue === true && !s5.jobs.sweep.grace, s5.jobs.sweep);
  // a started-never-finished job is overdue even inside grace
  const s6 = P.schedStatus(Object.assign({ jobs: { sweep: { seen_at: minAgo(20), grace_from: minAgo(20), last_start: minAgo(15), last_status: 'running' } } }, base), NOW, [sw]);
  t('status: grace does not hide "started and never finished"', s6.jobs.sweep.overdue === true && /never finished/.test(s6.jobs.sweep.overdue_reason), s6.jobs.sweep);
  // unstamped
  const s7 = P.schedStatus(Object.assign({ jobs: {} }, base), NOW, [sw]);
  t('status: a job the dispatcher has not stamped yet (ticking, never ran) is in grace - the deploy that added it is not an outage', s7.jobs.sweep.overdue === false && s7.jobs.sweep.grace === true, s7.jobs.sweep);
  const s8 = P.schedStatus({ v: 1, last_tick: null, jobs: {} }, NOW, [sw]);
  t('status: with NO tick at all there is no excuse - never-run stays overdue', s8.jobs.sweep.overdue === true, s8.jobs.sweep);
  // daily job: due 07:00 ET, "overdue" from 10:00 ET
  const d1 = P.schedStatus(Object.assign({ jobs: { daily_digest: { seen_at: minAgo(60), grace_from: minAgo(60) } } }, base), NOW, [dg]);
  t('status: a daily job added 60 min ago (already 5h past its slot) is in grace, not overdue', d1.jobs.daily_digest.overdue === false && d1.jobs.daily_digest.grace === true, d1.jobs.daily_digest);
  const d2 = P.schedStatus(Object.assign({ jobs: { daily_digest: { seen_at: minAgo(200), grace_from: minAgo(200) } } }, base), NOW, [dg]);
  t('status: the same daily job 200 min after being added (limit 180) and still not run -> overdue', d2.jobs.daily_digest.overdue === true && /has not run for/.test(d2.jobs.daily_digest.overdue_reason), d2.jobs.daily_digest);
  const d3 = P.schedStatus(Object.assign({ jobs: { daily_digest: { seen_at: minAgo(60), grace_from: minAgo(60), last_failed_final: '2026-10-20', last_error: 'boom' } } }, base), NOW, [dg]);
  t('status: grace does not hide a daily job that FAILED for good today', d3.jobs.daily_digest.overdue === true && /failed today/.test(d3.jobs.daily_digest.overdue_reason), d3.jobs.daily_digest);
  // dispatcher end to end: the first real tick persists the stamps
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval'], ['b', 'interval']]);
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs }));
  const s = stateOf(store);
  t('dispatcher: first tick stamps seen_at + grace_from for every job in the state it persists, and reports grace_stamped', r1.body.grace_stamped.join() === 'a,b' && s.jobs.a.seen_at && s.jobs.b.seen_at && s.jobs.b.grace_from === s.jobs.b.seen_at, [r1.body, s.jobs]);
  t('dispatcher: a job that ran keeps its stamps AND gets last_ok', !!s.jobs.a.last_ok && !!s.jobs.a.seen_at, s.jobs.a);
  c.v += 20 * 60000;
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('dispatcher: stamps are only written once (second tick reports none)', !r2.body.grace_stamped, r2.body);
  const dry = await L.schedRunNext({}, null, fast(c, { jobs, dry: true, preflight: false }));
  t('dry run stamps nothing to the sheet', dry.status === 200 && JSON.stringify(stateOf(store).jobs.b.grace_from) === JSON.stringify(s.jobs.b.grace_from));
}

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
  t('slow job: caller gets timed_out (not a hang, not a failure), more=false when nothing else is due', r.body.timed_out === true && r.body.ran === 'slow' && r.body.job_ok === null && r.body.more === false && r.body.ok === true, r.body);
  t('slow job: handed to ctx.waitUntil so it survives the caller hanging up', waits.length === 1);
  t('slow job: its claim is released at the timeout (Oct 14 2026: a held claim blocked the whole queue)', r.body.claim_released === true && stateOf(store).claim_id === '', r.body);
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('the slow job itself is not started a second time while it is still running (its last_start holds it)', r2.body.ran === null && log.length === 0, r2.body);
  await Promise.all(waits);
  t('slow job finished and recorded its result in state', log.length === 1 && stateOf(store).jobs.slow.last_status === 'ok' && stateOf(store).claim_id === '');
}
// 2k-b Oct 14 2026 REGRESSION: a job that times out must NOT stop the queue. The daily self-test hung every tick from 7am and the
// jobs behind it (the cleaning scheduler, insp_guard) never ran. Now: more:true, the next call runs the next job, nobody is clobbered.
{
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const waits = [];
  const jobs = mkJobs(log, [['hang', 'interval', { run: async () => { await tick(150); log.push('hang'); return { ok: true, errors: [] }; } }], ['next', 'interval']]);
  const r = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 30 }));
  t('timed-out job: more=true and the other due job is named', r.body.timed_out === true && r.body.more === true && JSON.stringify(r.body.due) === JSON.stringify(['next']), r.body);
  const r2 = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 2000 }));
  t('the very next call runs the job behind it (not "another run holds the claim")', r2.body.ran === 'next' && r2.body.job_ok === true && !r2.body.skipped, r2.body);
  await Promise.all(waits);
  const stf = stateOf(store);
  t('both jobs recorded ok, no claim left behind', stf.jobs.hang.last_status === 'ok' && stf.jobs.next.last_status === 'ok' && stf.claim_id === '', stf);
}
// 2k-c Oct 14 2026 REGRESSION (daily-first exposed it): a DAILY job that times out has no last_key yet, so it stayed due and the very
// next call of the same tick picked it again (up to 25 times). It must be left alone for the retry gap, counted as an attempt, and
// capped at SCHED_MAX_ATTEMPTS per day - and the jobs behind it must still run.
{
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  const waits = [];
  const jobs = mkJobs(log, [['dhang', 'daily', { run: async () => { await tick(400); log.push('dhang'); return { ok: false, errors: [{ step: 'x', error: 'never finishes in time' }] }; } }], ['next', 'interval']]);
  const r = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 30 }));
  t('timed-out daily job: the first call ran it, timed out, and counted attempt 1', r.body.ran === 'dhang' && r.body.timed_out === true && stateOf(store).jobs.dhang.attempts.n === 1, r.body);
  t('timed-out daily job: more=true and it is NOT in its own due list', r.body.more === true && JSON.stringify(r.body.due) === JSON.stringify(['next']), r.body);
  const r2 = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 2000 }));
  t('the very next call runs the job behind it and does NOT start the daily job again', r2.body.ran === 'next' && !log.includes('dhang') && stateOf(store).jobs.dhang.attempts.n === 1, r2.body);
  await Promise.all(waits);
  t('a daily job that failed after timing out keeps its single counted attempt (no double count)', stateOf(store).jobs.dhang.attempts.n === 1 && stateOf(store).jobs.dhang.last_status === 'failed', stateOf(store).jobs.dhang);
  c.v += 31 * 60000;
  const r3 = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 30 }));
  t('after the 30 min retry gap the daily job is tried again (attempt 2)', r3.body.ran === 'dhang' && stateOf(store).jobs.dhang.attempts.n === 2, r3.body);
}
{
  // if the claim cannot be released the old behaviour holds AND it is loud (warning in the result + telemetry row)
  const store = makeStore(), L = load(store), c = clock(T0), log = [];
  const waits = [];
  const jobs = mkJobs(log, [['hang', 'interval', { run: async () => { store.failWhen = (m, p) => m === 'POST' && p === '/values:batchUpdate'; await tick(150); store.failWhen = null; log.push('hang'); return { ok: true, errors: [] }; } }], ['next', 'interval']]);
  const r = await L.schedRunNext({}, { waitUntil: (p) => waits.push(p) }, fast(c, { jobs, budgetMs: 30 }));
  t('claim release failing: more=false, claim_released=false, a visible warning', r.body.timed_out === true && r.body.more === false && r.body.claim_released === false && /could NOT be released/.test((r.body.warnings || [])[0] || ''), r.body);
  t('claim release failing is logged to telemetry (Success FALSE, dispatcher)', L.telemetry.some(x => x.Success === 'FALSE' && x.Skill_Or_Endpoint === 'dispatcher' && /could NOT be released/.test(x.Notes)), L.telemetry);
  await Promise.all(waits);
}
// 2k-d Oct 14 2026: a daily job may return {ok:true, partial:true} (one time-slice done, more to do - daily_qb_sync). It is NOT done for the
// day, is not re-picked for SCHED_PARTIAL_GAP_MS (so it never hogs one tick), resumes later, is done only on its final slice, and is a
// FAILURE (loud) after SCHED_MAX_PARTIALS slices in one ET day.
{
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  let slicesLeft = 2;
  const jobs = mkJobs(log, [['dq', 'daily', { run: async () => { log.push('dq'); return slicesLeft-- > 0 ? { ok: true, partial: true, errors: [] } : { ok: true, errors: [] }; } }], ['next', 'interval']]);
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs }));
  const s1 = stateOf(store).jobs.dq;
  t('partial slice: job_ok, flagged partial, status "partial", NOT marked done for the day', r1.body.ran === 'dq' && r1.body.job_ok === true && r1.body.partial === true && s1.last_status === 'partial' && !s1.last_key && s1.partials.n === 1 && !!s1.last_ok && s1.attempts === null, { r: r1.body, s1 });
  t('partial slice: not offered again in the same tick (the job behind it runs)', JSON.stringify(r1.body.due) === JSON.stringify(['next']) && r1.body.more === true, r1.body);
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('partial slice: the very next call runs the job behind it, not the partial job again', r2.body.ran === 'next' && log.filter(x => x === 'dq').length === 1, r2.body);
  c.v += 6 * 60000;
  const r3 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('partial slice: resumes after the partial gap (slice 2)', r3.body.ran === 'dq' && r3.body.partial === true && stateOf(store).jobs.dq.partials.n === 2, r3.body);
  c.v += 6 * 60000;
  const r4 = await L.schedRunNext({}, null, fast(c, { jobs }));
  const s4 = stateOf(store).jobs.dq;
  t('final slice marks the day done and clears the partial bookkeeping', r4.body.ran === 'dq' && !r4.body.partial && s4.last_status === 'ok' && !!s4.last_key && s4.partials === null && s4.partial_at === null && s4.attempts === null, { r: r4.body, s4 });
  c.v += 6 * 60000;
  const r5 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('after the final slice the job is not run again that day', r5.body.ran !== 'dq' && log.filter(x => x === 'dq').length === 3, r5.body);
}
{
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['dq', 'daily', { run: async () => { log.push('dq'); return { ok: true, partial: true, errors: [] }; } }]]);
  let last = null;
  for (let i = 0; i < 14; i++) { last = await L.schedRunNext({}, null, fast(c, { jobs })); c.v += 6 * 60000; if (last.body.ran !== 'dq') break; }
  const s = stateOf(store).jobs.dq;
  t('a job that never finishes becomes a loud FAILURE on slice 13 (not a forever-green "partial")', log.length === 13 && s.last_status === 'failed' && /after 12 slices/.test(s.last_error || '') && L.telemetry.some(x => x.Success === 'FALSE' && x.Skill_Or_Endpoint === 'dq'), { n: log.length, s });
}
// 2k-e Oct 20 2026: a job that REPORTS progress_made on its partial slices (daily_qb_sync) is judged on progress, not a flat 12 slices
{
  const runN = async (seq, extra) => {
    const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
    let i = 0;
    const jobs = mkJobs(log, [['dq', 'daily', { run: async () => { log.push('dq'); const step = seq[Math.min(i++, seq.length - 1)];
      return step === 'done' ? { ok: true, errors: [] } : (step === undefined ? { ok: true, partial: true, errors: [] } : { ok: true, partial: true, progress_made: step === 'p', errors: [] }); } }]]);
    let last = null;
    for (let k = 0; k < (extra || 100); k++) { last = await L.schedRunNext({}, null, fast(c, { jobs })); c.v += 6 * 60000; if (last.body.ran !== 'dq') break; }
    return { store, L, c, log, last, s: stateOf(store).jobs.dq };
  };
  // 3 slices in a row with no progress -> failure on the 3rd
  const a = await runN(['n', 'n', 'n', 'n']);
  t('3 no-progress slices in a row = loud FAILURE on slice 3 ("made no progress")', a.log.length === 3 && a.s.last_status === 'failed' && /made no progress in its last 3 slices/.test(a.s.last_error || '') && a.L.telemetry.some(x => x.Success === 'FALSE' && x.Skill_Or_Endpoint === 'dq'), { n: a.log.length, s: a.s });
  // two stalls then progress resets the counter; 20 progress slices sail past the old flat cap of 12
  const b = await runN(['n', 'n', 'p', 'n', 'n', 'p', ...Array(14).fill('p'), 'done']);
  t('stalls that are followed by progress never fail; 21 slices pass the old flat 12-slice cap and the day completes', b.log.length === 21 && b.s.last_status === 'ok' && !!b.s.last_key && b.s.partials === null, { n: b.log.length, s: b.s });
  const c2 = await runN(['n', 'n', 'p'], 4);
  t('stalled counter is stored (partials.stalled) and reset by a progress slice', c2.log.length === 4 && c2.s.last_status === 'partial' && c2.s.partials.stalled === 0, c2.s);
  const store2 = primeState(makeStore()), L2 = load(store2), clk2 = clock(T0), log2 = [];
  const jobs2 = mkJobs(log2, [['dq', 'daily', { run: async () => { log2.push('dq'); return { ok: true, partial: true, progress_made: false, errors: [] }; } }]]);
  await L2.schedRunNext({}, null, fast(clk2, { jobs: jobs2 })); clk2.v += 6 * 60000; await L2.schedRunNext({}, null, fast(clk2, { jobs: jobs2 }));
  t('after 2 stalled slices the state holds partials {n:2, stalled:2} and the job is still "partial", not failed', stateOf(store2).jobs.dq.partials.stalled === 2 && stateOf(store2).jobs.dq.partials.n === 2 && stateOf(store2).jobs.dq.last_status === 'partial', stateOf(store2).jobs.dq);
  clk2.v += 6 * 60000; await L2.schedRunNext({}, null, fast(clk2, { jobs: jobs2 }));   // 3rd stalled slice -> failed
  t('3rd stalled slice fails and is retried by the normal 30 min rule (attempt counted)', stateOf(store2).jobs.dq.last_status === 'failed' && stateOf(store2).jobs.dq.attempts.n === 1, stateOf(store2).jobs.dq);
  // a job that creeps (always progress) hits the absolute backstop, loudly
  const e = await runN(['p']);
  t('always-progress-but-never-finishing job fails at the hard backstop (slice 61), not forever', e.log.length === 61 && e.s.last_status === 'failed' && /after 60 slices/.test(e.s.last_error || ''), { n: e.log.length, s: e.s });
  // a job that does NOT report progress keeps the old flat cap (the daily self-test)
  const f = await runN([undefined]);
  t('a partial job that does not report progress_made keeps the flat 12-slice cap', f.log.length === 13 && /after 12 slices/.test(f.s.last_error || ''), { n: f.log.length, s: f.s });
}
{
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['dq', 'daily', { run: async () => { log.push('dq'); return { ok: false, partial: true, errors: [{ step: 'x', error: 'boom' }] }; } }]]);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  const s = stateOf(store).jobs.dq;
  t('a partial slice that ALSO reported an error is a failure (counted attempt, retry gap), never "partial"', r.body.job_ok === false && !r.body.partial && s.last_status === 'failed' && s.attempts.n === 1 && !s.partial_at, { r: r.body, s });
}
// 2k-c a failed job says WHY (the deposit sweep failed 70+ times as "ok:false []")
{
  const msg = P.schedBadness(200, { ok: false, errors: [], not_found: [{ scope: '4', wo_id: 'WO-1180', reason: 'no deposit invoice on the signature' }] });
  t('ok:false with an empty errors list names the not_found scope + reason', /scope 4/.test(msg) && /WO-1180/.test(msg) && /no deposit invoice/.test(msg), msg);
  t('ok:false with nothing at all still says so in words, not []', /gave no reason/.test(P.schedBadness(200, { ok: false })), P.schedBadness(200, { ok: false }));
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
// 2l-bis (Oct 22 2026, Needs Attention #2/#3): a job whose ONLY errors are Google's shared Sheets READ quota is a calm P2 "sheets_quota_busy" row, not a P0
// "scheduler_job" failure that texts Brett. Anything else (including a mix) is unchanged: P0 scheduler_job + admin alert.
{
  const Q = (tab) => `Sheets API error on GET /values/${tab}: Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com' for consumer 'project_number:664428332384'.`;
  const runOne = async (errors, extra) => {
    const store = primeState(makeStore()), L = load(store), c = clock(Date.parse('2026-10-12T14:00:00Z')), log = [];
    const jobs = mkJobs(log, [['q', 'interval', { run: async () => ({ ok: false, errors }) }]]);
    const r = await L.schedRunNext({}, null, fast(c, { jobs, only: ['q'], force: true }));
    return { r, L, store };
  };
  const a = await runOne([{ step: 'pending_notifications', error: Q('Notification_Queue') }, { step: 'vendor_nudges', error: Q('Vendor_Requests') }]);
  t('quota-only job failure: still recorded as failed and retried (state says failed)', a.r.body.job_ok === false && stateOf(a.store).jobs.q.last_status === 'failed', a.r.body);
  t('quota-only job failure: the answer says quota_busy and keeps the error text', a.r.body.quota_busy === true && /Quota exceeded/.test(a.r.body.error));
  t('quota-only job failure: ONE telemetry row, Job_Type sheets_quota_busy (a P2 in the ledger), naming the job', a.L.telemetry.length === 1 && a.L.telemetry[0].Job_Type === 'sheets_quota_busy' && a.L.telemetry[0].Skill_Or_Endpoint === 'scheduler/q' && a.L.telemetry[0].Success === 'FALSE', a.L.telemetry);
  t('quota-only job failure: nobody is paged (alertAdminOnFailure never called)', a.L.alerts.length === 0 && !a.r.body.admin_alerted, a.L.alerts);
  const b = await runOne([{ step: 'pending_notifications', error: Q('Notification_Queue') }, { step: 'vendor_nudges', error: 'Sheets API error on GET /values/Vendor_Requests: injected sheets failure' }]);
  t('mixed (one quota + one real error): NOT treated as quota - P0 scheduler_job row and the admin alert', b.r.body.quota_busy !== true && b.L.telemetry[0].Job_Type === 'scheduler_job' && b.L.alerts.length === 1, { tel: b.L.telemetry, alerts: b.L.alerts });
  const c2 = await runOne([{ step: 'job', error: 'Cannot read properties of undefined' }]);
  t('a real bug: unchanged - P0 scheduler_job row, admin alert', c2.L.telemetry[0].Job_Type === 'scheduler_job' && c2.L.telemetry[0].Skill_Or_Endpoint === 'q' && c2.L.alerts.length === 1);
  const d = await runOne([{ step: 'x', error: Q('Config').replace('on GET', 'on POST') }]);
  t('a WRITE that hit quota is a real failure (not "busy"): P0 scheduler_job + alert', d.L.telemetry[0].Job_Type === 'scheduler_job' && d.L.alerts.length === 1);
  const e = await runOne([]);
  t('ok:false with no errors listed is still a plain failure (not "quota")', e.L.telemetry[0].Job_Type === 'scheduler_job' && e.r.body.quota_busy !== true);
  const ok = await (async () => { const store = primeState(makeStore()), L = load(store), c = clock(Date.parse('2026-10-12T14:00:00Z')); const jobs = mkJobs([], [['q', 'interval']]); const r = await L.schedRunNext({}, null, fast(c, { jobs, only: ['q'], force: true })); return { r, L }; })();
  t('happy path: nothing recorded, nobody paged', ok.r.body.job_ok === true && ok.L.telemetry.length === 0 && ok.L.alerts.length === 0);
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
const DAILY5 = ['daily_digest', 'daily_receipts', 'daily_receipts_post', 'daily_turnover', 'daily_qb_sync', 'sms_delivery_check'];   // (name kept; it is now six dailies, all at 07:00 ET)
const INTERVAL5 = ['door_watchdog', 'sweep', 'sweep_work', 'sweep_checks', 'insp_guard', 'str_cleaning', 'followup_sweep'];
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
  t('first tick reports first_run + seeded:[the 5 dailies and the two Monday weeklies]', a.first.body.first_run === true && a.first.body.seeded.join() === [...DAILY5, 'review_mon', 'ar_report_mon', 'hub_impr_mon', 'hub_impr_daily', 'str_digest_mon'].join(), a.first.body);
  const s = stateOf(store);
  t('seeded jobs carry last_key = today (ET), last_status seeded, last_seeded:true and NO forged last_ok / last_start', ['daily_digest', 'review_mon', 'ar_report_mon'].every(n => s.jobs[n].last_key === '2026-10-12' && s.jobs[n].last_status === 'seeded' && s.jobs[n].last_seeded === true && !s.jobs[n].last_ok && !s.jobs[n].last_start), s.jobs.daily_digest);
  t('review_wed (Wednesday job) is not seeded on a Monday (it only gets the grace stamp)', !s.jobs.review_wed || (!s.jobs.review_wed.last_key && !s.jobs.review_wed.last_seeded), s.jobs.review_wed);
  t('state records the seeding summary', s.seeded && s.seeded.jobs.length === 11 && !!s.seeded.at);
  const st = L.schedStatus(s, new Date(c.v), L.SCHED_JOBS);
  t('/cron/status shows seeded jobs as seeded, not overdue; top-level seeded summary present', st.seeded && st.seeded.jobs.length === 11 && st.jobs.daily_digest.seeded === true && st.jobs.daily_digest.last_ok === null && !st.overdue.includes('daily_digest') && !st.overdue.includes('review_mon'), st.overdue);
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
  t('first tick Mon 08:45 ET: seeds the dailies + review_mon but NOT ar_report_mon', a.first.body.seeded.join() === [...DAILY5, 'review_mon', 'hub_impr_mon', 'hub_impr_daily', 'str_digest_mon'].join(), a.first.body.seeded);
  c.v = Date.parse('2026-10-12T13:00:00Z');
  const b = await drain(L, c);
  t('...and ar_report_mon then runs at 09:00 ET while the seeded ones stay quiet', b.ran.includes('ar_report_mon') && !b.ran.includes('review_mon') && !b.ran.some(n => DAILY5.includes(n)), b.ran);
}
{
  // DST: fall-back day, Monday Nov 2 2026 is EST (UTC-5): 13:29Z = 08:29 EST
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-11-02T13:29:00Z'));
  const a = await drain(L, c);
  t('DST (EST): first tick 08:29 EST seeds the dailies only (review_mon is 08:30 EST)', a.first.body.seeded.join() === [...DAILY5, 'hub_impr_mon', 'hub_impr_daily', 'str_digest_mon'].join() && a.ran.join() === INTERVAL5.join(), a.first.body.seeded);
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
  t('DST (spring-forward day): dailies run at 07:00 EDT (11:00Z), not an hour later', (await drain(L, c)).ran.filter(n => DAILY5.includes(n)).length === 6);
  const store2 = makeStore(), L2 = load(store2);
  t('DST (spring-forward day): a first tick at 07:30 EDT seeds the five dailies + the 07:30 Hub Improvements check', (await drain(L2, clock(Date.parse('2026-03-08T11:30:00Z')))).first.body.seeded.join() === [...DAILY5, 'hub_impr_daily'].join());
}
{
  // a Scheduler_State row that exists but is blank is ALSO a first run
  const store = makeStore(), L = load(store), c = clock(Date.parse('2026-10-13T01:00:00Z'));
  store.tabs.get('Config').push(['Scheduler_State', '   ']);
  const a = await drain(L, c);
  t('blank Scheduler_State cell (row present) is a first run too', a.first.body.first_run === true && a.first.body.seeded.length === 11);
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
  t('dry run on blank state: first_run true, would_seed lists the ten, due is only the interval jobs', r.body.dry === true && r.body.first_run === true && r.body.would_seed.length === 11 && r.body.due.join() === INTERVAL5.join(), r.body);
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
  const stat0 = await call('GET', '/cron/status', H);
  t('status right after the first ticks: never-run jobs are in GRACE (new job, first run pending), not overdue', stat0.json.jobs.insp_guard.overdue === false && stat0.json.jobs.sweep.overdue === false && stat0.json.jobs.sweep.grace === true && !stat0.json.overdue.includes('sweep'), stat0.json.jobs.sweep);
  ageGrace(store);
  const stat = await call('GET', '/cron/status', H);
  t('status: insp_guard fine, never-run jobs overdue (once their grace has run out)', stat.json.jobs.insp_guard.overdue === false && stat.json.overdue.includes('sweep') && stat.json.tick_age_min <= 2, stat.json.overdue);
  const h = await call('GET', '/health', {});
  t('public /health carries a coarse scheduler summary (age + overdue NAMES only)', h.status === 200 && h.json.scheduler && typeof h.json.scheduler.last_tick_age_min === 'number' && Array.isArray(h.json.scheduler.overdue) && h.json.scheduler.overdue.includes('sweep') && !('jobs' in h.json.scheduler) && !JSON.stringify(h.json.scheduler).includes('last_error'), h.json && h.json.scheduler);
  const noauth = await call('POST', '/cron/run', {}, {});
  t('POST /cron/run without a token -> 401', noauth.status === 401);
  const getRun = await call('GET', '/cron/run', H);
  t('GET /cron/run -> 401 (Scheduler_Token only authorises POST there)', getRun.status === 401);
}
{
  // PREFLIGHT: POST /cron/run {dry_run:true} lists what the next real tick WOULD do (counts only), with no side effects
  const H = { 'X-Auth-Token': SCHED_TOKEN };
  const ago = (h) => new Date(Date.now() + skew - h * 3600000).toISOString();
  const future = new Date(Date.now() + skew + 5 * 3600000).toISOString();
  store.tabs.set('Message_Queue', [['ID', 'Status', 'Send_After', 'Recipient_Type', 'Message_Body', 'Recipient_Phone'],
    ['1', 'pending', ago(2), 'tenant', 'hello', '+15550000001'], ['2', 'pending', ago(240), 'vendor', 'old one', '+15550000002'],
    ['3', 'pending', future, 'tenant', 'not yet', '+15550000003'], ['4', 'sent', ago(5), 'tenant', 'done', '+15550000004']]);
  store.tabs.set('Notification_Queue', [['ID', 'WO_ID', 'Type', 'Phone', 'Message', 'Send_After', 'Sent', 'Created_At'],
    ['1', 'WO-1', 'x', '+15550000001', 'reminder', ago(30), 'FALSE', ago(31)], ['2', 'WO-2', 'x', '+15550000002', 'already', ago(30), 'TRUE', ago(31)], ['3', 'WO-3', 'x', '+15550000003', 'later', future, 'FALSE', ago(1)]]);
  store.tabs.set('Vendor_Requests', [['ID', 'WO_ID', 'Vendor_ID', 'Request_Type', 'Status', 'Next_Nudge_At'],
    ['1', 'WO-1', 'V1', 'photos', 'open', ago(3)], ['2', 'WO-2', 'V1', 'invoice', 'open', future], ['3', 'WO-3', 'V1', 'photos', 'satisfied', ago(3)]]);
  store.setCfg('TWILIO_ENABLED', 'TRUE'); store.setCfg('TWILIO_TEST_MODE', 'FALSE');
  const before = { state: store.cfg().Scheduler_State, mq: JSON.stringify(store.tabs.get('Message_Queue')), posts: store.calls.filter(x => x.startsWith('POST')).length, outbound: outbound.length };
  const r = await call('POST', '/cron/run', H, { dry_run: true });
  const pf = r.json && r.json.preflight;
  t('preflight: dry_run:true is accepted with the Scheduler_Token and returns a preflight block', r.status === 200 && r.json.dry === true && pf && pf.ok === true && pf.read_only === true, r);
  const qh = pf && pf.jobs.sweep && pf.jobs.sweep.quiet_hours_held_due;
  t('preflight: held quiet-hours rows due = 2 (the future and the already-sent rows are not counted), with age buckets and oldest age', qh && qh.count === 2 && qh.by_recipient_type.tenant === 1 && qh.by_recipient_type.vendor === 1 && qh.by_age.h1_to_24 === 1 && qh.by_age.over_7d === 1 && qh.oldest_days >= 9.9 && qh.oldest_days <= 10.1, qh);
  t('preflight: queued notifications due = 1, vendor nudges due = 1 (photos)', pf.jobs.sweep.queued_notifications_due.count === 1 && pf.jobs.sweep.vendor_nudges_due.count === 1 && pf.jobs.sweep.vendor_nudges_due.by_request_type.photos === 1, pf.jobs.sweep);
  t('preflight: states whether Twilio is on and whether test mode is on (no secrets)', pf.jobs.sweep.twilio_enabled === true && pf.jobs.sweep.twilio_test_mode === false);
  t('preflight: sweep_work reports the estimate reminder, recurring WOs and deposit sweep counts; every job has a plain-English "would"', pf.jobs.sweep_work && 'estimate_reminder' in pf.jobs.sweep_work && 'recurring_wos' in pf.jobs.sweep_work && pf.jobs.sweep_work.deposit_paid.pre_approved_scopes === 0 && Object.values(pf.jobs).every(j => typeof j.would === 'string' && j.would.length > 10), pf.jobs.sweep_work);
  t('preflight: names the jobs that were seeded and will not run today (empty here: not a first run)', Array.isArray(pf.will_not_run_today_seeded));
  t('preflight: ZERO side effects - no Sheets write, no state change, no queue row touched, no outbound SMS/HTTP', store.calls.filter(x => x.startsWith('POST')).length === before.posts && store.cfg().Scheduler_State === before.state && JSON.stringify(store.tabs.get('Message_Queue')) === before.mq && outbound.length === before.outbound, { posts: store.calls.filter(x => x.startsWith('POST')).length - before.posts, outbound: outbound.length - before.outbound });
  const legacy = await call('POST', '/cron/run', H, { dry: true });
  t('preflight: the older {dry:true} form returns the same preflight', legacy.status === 200 && legacy.json.preflight && legacy.json.preflight.jobs.sweep.quiet_hours_held_due.count === 2);
  store.failWhen = (m, p) => m === 'GET' && p === '/values/Vendor_Requests';
  const bad = await call('POST', '/cron/run', H, { dry_run: true });
  t('preflight: a failing read is reported loudly in preflight.errors (ok:false), the other counts still come back', bad.status === 200 && bad.json.preflight.ok === false && bad.json.preflight.errors.some(e => /Vendor_Requests|vendor_nudges_due/.test(e.where + e.error)) && bad.json.preflight.jobs.sweep.quiet_hours_held_due.count === 2, bad.json.preflight && bad.json.preflight.errors);
  store.failWhen = null;
  store.tabs.delete('Message_Queue'); store.tabs.delete('Notification_Queue'); store.tabs.delete('Vendor_Requests');
}
{
  // END TO END (real worker.js default export): the JOBS-table schedule flows through POST /cron/run into status + health
  const H = { 'X-Auth-Token': SCHED_TOKEN };
  const ago = (h) => new Date(Date.now() + skew - h * 3600000).toISOString();
  store.tabs.set('Message_Queue', [['ID', 'Status', 'Send_After', 'Recipient_Type', 'Message_Body', 'Recipient_Phone'],
    ['1', 'pending', ago(2), 'tenant', 'hello', '+15550000001'], ['2', 'pending', ago(240), 'vendor', 'old one', '+15550000002'], ['3', 'pending', ago(30), 'tenant', 'day-old', '+15550000003']]);
  store.tabs.set('Notification_Queue', [['ID', 'WO_ID', 'Type', 'Phone', 'Message', 'Send_After', 'Sent', 'Created_At']]);
  store.tabs.set('Vendor_Requests', [['ID', 'WO_ID', 'Vendor_ID', 'Request_Type', 'Status', 'Next_Nudge_At'],
    ['1', 'WO-1', 'V1', 'photos', 'open', ago(3)], ['2', 'WO-2', 'V1', 'invoice', 'open', ago(50)], ['3', 'WO-3', 'V1', 'photos', 'open', ago(400)]]);
  const posts = store.calls.filter(x => x.startsWith('POST')).length;
  const dry = await call('POST', '/cron/run', H, { dry_run: true, schedule: { daily_digest: { enabled: false }, review_mon: { at: '10:15' } } });
  const pf = dry.json && dry.json.preflight;
  t('preflight: held quiet-hours rows are listed BY AGE with a stale count (3 rows: 2h, 30h, 10d -> 2 older than a day, oldest ~10 days)', pf && pf.jobs.sweep.quiet_hours_held_due.count === 3 && pf.jobs.sweep.quiet_hours_held_due.by_age.h1_to_24 === 1 && pf.jobs.sweep.quiet_hours_held_due.by_age.d1_to_7 === 1 && pf.jobs.sweep.quiet_hours_held_due.by_age.over_7d === 1 && pf.jobs.sweep.quiet_hours_held_due.stale_over_1d === 2, pf && pf.jobs.sweep.quiet_hours_held_due);
  t('preflight: stale vendor nudges are listed by age (3h, 50h, 400h -> 2 stale, oldest ~16 days)', pf && pf.jobs.sweep.vendor_nudges_due.count === 3 && pf.jobs.sweep.vendor_nudges_due.by_age.under_1h === 0 && pf.jobs.sweep.vendor_nudges_due.by_age.h1_to_24 === 1 && pf.jobs.sweep.vendor_nudges_due.stale_over_1d === 2 && pf.jobs.sweep.vendor_nudges_due.oldest_days > 16 && pf.jobs.sweep.vendor_nudges_due.oldest_days < 17.5, pf && pf.jobs.sweep.vendor_nudges_due);
  t('preflight with a schedule: previews it (digest disabled -> not in the due list / preflight jobs), writes nothing', dry.status === 200 && dry.json.disabled.join() === 'daily_digest' && !dry.json.due.includes('daily_digest') && !(pf.jobs.daily_digest) && store.calls.filter(x => x.startsWith('POST')).length === posts && !JSON.parse(store.cfg().Scheduler_State || '{}').schedule);
  const live = await call('POST', '/cron/run', H, { only: 'insp_guard', schedule: { door_watchdog: { enabled: false }, sweep: { every_min: 30 } } });
  t('live call with a schedule is accepted, and remembers it in Scheduler_State', live.status === 200 && live.json.schedule_overrides.join() === 'door_watchdog,sweep' && live.json.disabled.join() === 'door_watchdog' && JSON.stringify(JSON.parse(store.cfg().Scheduler_State).schedule) === '{"door_watchdog":{"enabled":false},"sweep":{"every_min":30}}', live.json);
  ageGrace(store);
  const stat = await call('GET', '/cron/status', H);
  t('/cron/status uses the remembered schedule: door_watchdog DISABLED and not overdue, sweep "every 30 min"', stat.json.jobs.door_watchdog.enabled === false && stat.json.jobs.door_watchdog.overdue === false && !stat.json.overdue.includes('door_watchdog') && stat.json.jobs.sweep.expected === 'every 30 min' && stat.json.overdue.includes('sweep_work'), stat.json.jobs.door_watchdog);
  const health = await call('GET', '/health', {});
  t('/health overdue list also ignores the disabled job', !health.json.scheduler.overdue.includes('door_watchdog') && health.json.scheduler.overdue.includes('sweep_work'), health.json.scheduler);
  const rej = await call('POST', '/cron/run', H, { schedule: { door_watchdog: { cron: '* * * * *' } } });
  t('a bad schedule over HTTP -> 400 with the reason (an email from the Apps Script), nothing ran', rej.status === 400 && /unknown field "cron"/.test(rej.json.error) && rej.json.ran === null, rej);
  const str = await call('POST', '/cron/run', H, { schedule: 'every minute' });
  t('a non-object schedule -> 400', str.status === 400 && /keyed by job name/.test(str.json.error), str.json);
  const clear = await call('POST', '/cron/run', H, { only: 'insp_guard', schedule: {} });
  t('sending {} clears the remembered schedule again', clear.status === 200 && JSON.stringify(JSON.parse(store.cfg().Scheduler_State).schedule) === '{}');
  store.tabs.delete('Message_Queue'); store.tabs.delete('Notification_Queue'); store.tabs.delete('Vendor_Requests');
  void posts;
}
{
  const fstart = wsrc.indexOf('async function hubTestWriteAllowed('), fend = wsrc.indexOf('\nasync function ', fstart + 10);
  const real = new Function('SCHED_STAGING_SAFE_JOBS', wsrc.slice(fstart, fend) + '\nreturn hubTestWriteAllowed;')(['door_watchdog', 'insp_guard']);
  const check = (body) => real({}, '/cron/run', body);
  t('hub-test guard: a dry run WITH a schedule is allowed; a live run with only a schedule is refused (it would run every due job)', (await check({ dry_run: true, schedule: { sweep: { enabled: false } } })) === true && (await check({ schedule: { sweep: { enabled: false } } })) === false && (await check({ only: 'insp_guard', schedule: {} })) === true);
}
{
  // the hub-test (staging) token may only dry-run / run the two safe jobs - exercise the REAL hubTestWriteAllowed (a TDZ bug here shipped once: `_b` is declared further down the function)
  const fstart = wsrc.indexOf('async function hubTestWriteAllowed('), fend = wsrc.indexOf('\nasync function ', fstart + 10);
  const real = new Function('SCHED_STAGING_SAFE_JOBS', wsrc.slice(fstart, fend) + '\nreturn hubTestWriteAllowed;')(['door_watchdog', 'insp_guard']);
  const check = (body) => real({}, '/cron/run', body);
  t('hub-test guard: dry run allowed (dry and dry_run)', (await check({ dry: true })) === true && (await check({ dry_run: true })) === true && (await check({ dry_run: 'true' })) === false && (await check({ dry_run: true, force: true })) === false);
  t('hub-test guard: insp_guard / door_watchdog allowed', (await check({ only: 'insp_guard' })) === true && (await check({ only: 'door_watchdog' })) === true);
  t('hub-test guard: a bare run (all due jobs), the sweeps, force and arrays are refused', (await check({})) === false && (await check(undefined)) === false && (await check({ only: 'sweep' })) === false && (await check({ only: 'insp_guard', force: true })) === false && (await check({ only: ['insp_guard'] })) === false && (await check({ dry: 'true' })) === false);
}
// ═══ SCHEDULE OVERRIDES (Oct 13 2026): the Apps Script JOBS table is the one place schedules are edited ═══
{
  const SJ = P.SCHED_JOBS;
  const same = P.schedApplyOverrides(SJ, undefined);
  t('overrides: undefined / null = the defaults, untouched', same.jobs === SJ && same.errors.length === 0 && P.schedApplyOverrides(SJ, null).jobs === SJ && P.schedApplyOverrides(SJ, {}).jobs.every((j, i) => j === SJ[i]));
  const ok = P.schedApplyOverrides(SJ, { sweep: { every_min: 30 }, door_watchdog: { every_min: 15 }, sweep_work: { every_min: 1 }, insp_guard: { every_min: 60, enabled: false }, daily_digest: { at: '6:45' }, review_mon: { at: '10:00', dow: 2 }, daily_turnover: { enabled: true } });
  const g = (n) => ok.jobs.find(j => j.name === n);
  t('overrides: valid map accepted, no errors', ok.errors.length === 0, ok.errors);
  t('overrides: every_min is the HUMAN cadence (Hub keeps 1 min of jitter slack): 30 -> 29, 15 -> 14 (the default), 1 -> 1', g('sweep').every_min === 29 && g('sweep').every_human === 30 && g('door_watchdog').every_min === 14 && g('sweep_work').every_min === 1);
  t('overrides: enabled:false -> disabled; enabled:true leaves it on', g('insp_guard').disabled === true && !g('daily_turnover').disabled);
  t('overrides: at is normalised to HH:MM, dow changes the weekday, untouched fields stay', g('daily_digest').at === '06:45' && g('review_mon').at === '10:00' && g('review_mon').dow === 2 && g('review_wed').dow === 3);
  t('overrides: the defaults array itself is never mutated', SJ.find(j => j.name === 'sweep').every_min === 14 && !SJ.some(j => j.disabled) && SJ.find(j => j.name === 'daily_digest').at === '07:00');
  t('overrides: only fields that were sent are remembered (applied)', JSON.stringify(ok.applied.daily_digest) === '{"at":"06:45"}' && JSON.stringify(ok.applied.insp_guard) === '{"every_min":60,"enabled":false}' || JSON.stringify(ok.applied.insp_guard) === '{"enabled":false,"every_min":60}', ok.applied);
  const bads = [
    [{ nope: { enabled: true } }, /unknown job "nope"/], [{ sweep: { color: 'red' } }, /unknown field "color"/], [{ sweep: { quiet: '22:00-06:00' } }, /not active yet/],
    [{ daily_digest: { every_min: 15 } }, /daily job/], [{ sweep: { at: '07:00' } }, /every-N-minutes/], [{ daily_digest: { dow: 1 } }, /only weekly/], [{ sweep: { dow: 1 } }, /only weekly/],
    [{ sweep: { every_min: 0 } }, /whole number/], [{ sweep: { every_min: 1.5 } }, /whole number/], [{ sweep: { every_min: 1441 } }, /whole number/], [{ sweep: { every_min: '15' } }, /whole number/],
    [{ daily_digest: { at: '25:00' } }, /look like/], [{ daily_digest: { at: '7am' } }, /look like/], [{ daily_digest: { at: '07:60' } }, /look like/], [{ review_mon: { dow: 7 } }, /0 \(Sunday\)/],
    [{ sweep: { enabled: 'yes' } }, /true or false/], [{ sweep: 'off' }, /must be an object/], [[], /keyed by job name/], ['x', /keyed by job name/],
  ];
  for (const [raw, re] of bads) { const r = P.schedApplyOverrides(SJ, raw); t('overrides: rejected loudly - ' + JSON.stringify(raw).slice(0, 60), r.errors.length >= 1 && re.test(r.errors.join(' | ')) && r.jobs === SJ && Object.keys(r.applied).length === 0, r.errors); }
  const mixed = P.schedApplyOverrides(SJ, { sweep: { every_min: 30 }, daily_digest: { at: 'bad' } });
  t('overrides: one bad entry rejects the WHOLE map (no half-applied schedule)', mixed.errors.length === 1 && mixed.jobs === SJ);
  // behaviour: due logic honours the override
  const L0 = Date.parse('2026-10-12T14:00:00Z');
  const sw = (m) => ({ jobs: { sweep: { last_start: new Date(L0 - m * 60000).toISOString(), last_ok: new Date(L0 - m * 60000).toISOString() } } });
  const j30 = P.schedApplyOverrides(SJ, { sweep: { every_min: 30 } }).jobs;
  t('overrides: "every 30" is not due 20 min after the last run, is due at 29.5 and 45', P.schedDueJobs(sw(20), new Date(L0), j30, { only: ['sweep'] }).length === 0 && P.schedDueJobs(sw(29.5), new Date(L0), j30, { only: ['sweep'] }).length === 1 && P.schedDueJobs(sw(45), new Date(L0), j30, { only: ['sweep'] }).length === 1);
  t('overrides: default "every 15" still due at 14.5 min', P.schedDueJobs(sw(14.5), new Date(L0), SJ, { only: ['sweep'] }).length === 1 && P.schedDueJobs(sw(10), new Date(L0), SJ, { only: ['sweep'] }).length === 0);
  const off = P.schedApplyOverrides(SJ, { sweep: { enabled: false } }).jobs;
  t('overrides: a disabled job is never due (even if never run)', P.schedDueJobs({ jobs: {} }, new Date(L0), off, { only: ['sweep'] }).length === 0 && P.schedDueJobs({ jobs: {} }, new Date(L0), off, {}).every(d => d.name !== 'sweep'));
  const stOff = P.schedStatus({ jobs: {} }, new Date(L0), off);
  t('overrides: a disabled job is reported as DISABLED and is never overdue; the other never-run jobs still are', stOff.jobs.sweep.enabled === false && stOff.jobs.sweep.overdue === false && /DISABLED/.test(stOff.jobs.sweep.expected) && !stOff.overdue.includes('sweep') && stOff.overdue.includes('sweep_work'), stOff.jobs.sweep);
  t('overrides: expected text shows the human cadence and the new time', P.schedExpected(j30.find(j => j.name === 'sweep')) === 'every 30 min' && P.schedExpected(P.schedApplyOverrides(SJ, { daily_digest: { at: '06:45' } }).jobs.find(j => j.name === 'daily_digest')) === 'daily after 06:45 ET');
  // overdue limit scales with the cadence: hourly -> 180, default 15-minute -> 45
  const hourly = P.schedApplyOverrides(SJ, { sweep: { every_min: 60 } }).jobs;
  const okAgo = (m) => ({ jobs: { sweep: { last_start: new Date(L0 - m * 60000).toISOString(), last_end: new Date(L0 - m * 60000 + 1000).toISOString(), last_ok: new Date(L0 - m * 60000).toISOString() } } });
  t('overrides: overdue limit scales with the cadence (hourly job fine at 100 min, overdue at 200; default job overdue at 50)', !P.schedStatus(okAgo(100), new Date(L0), hourly).jobs.sweep.overdue && P.schedStatus(okAgo(200), new Date(L0), hourly).jobs.sweep.overdue && P.schedStatus(okAgo(50), new Date(L0), SJ).jobs.sweep.overdue && !P.schedStatus(okAgo(40), new Date(L0), SJ).jobs.sweep.overdue);
  // schedEffective: stored schedule, corrupt fallback
  const e1 = P.schedEffective({ schedule: { sweep: { every_min: 30 } } });
  t('schedEffective: uses the stored map; a corrupt stored map falls back to the defaults and says so', e1.jobs.find(j => j.name === 'sweep').every_human === 30 && !e1.schedule_error && P.schedEffective({ schedule: { zzz: {} } }).schedule_error && P.schedEffective({ schedule: { zzz: {} } }).jobs === SJ && P.schedEffective(null).jobs === SJ);
}
{
  // the dispatcher: sent schedule is validated, applied, remembered; a rejected one runs nothing
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval'], ['b', 'interval'], ['d', 'daily']]);
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs, schedule: { a: { enabled: false } } }));
  t('dispatcher: a disabled job is skipped, the next due one runs (the daily job goes first, Oct 14 2026); the reply names overrides + disabled', r1.body.ran === 'd' && log.join() === 'd' && r1.body.more === true && r1.body.due.join() === 'b' && r1.body.disabled.join() === 'a' && r1.body.schedule_overrides.join() === 'a', r1.body);
  t('dispatcher: the schedule is remembered in Scheduler_State', JSON.stringify(stateOf(store).schedule) === '{"a":{"enabled":false}}', stateOf(store).schedule);
  c.v += 15 * 60000;
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('dispatcher: a later call WITHOUT a schedule (manual run) still honours the remembered one', r2.body.ran === 'b' && log.join() === 'd,b' && r2.body.disabled.join() === 'a', r2.body);
  c.v += 15 * 60000;
  const r3 = await L.schedRunNext({}, null, fast(c, { jobs, schedule: {} }));
  t('dispatcher: sending {} re-enables everything and clears the remembered schedule', r3.body.disabled.length === 0 && r3.body.ran === 'a' && JSON.stringify(stateOf(store).schedule) === '{}', r3.body);
  const before = store.cfg().Scheduler_State, logLen = log.length;
  const bad = await L.schedRunNext({}, null, fast(c, { jobs, schedule: { b: { every_min: 'fast' }, ghost: {} } }));
  t('dispatcher: a rejected schedule is a 400 with the reason, runs NOTHING, writes NO state, and logs telemetry', bad.status === 400 && bad.body.ok === false && /rejected/.test(bad.body.error) && /every_min/.test(bad.body.error) && /unknown job "ghost"/.test(bad.body.error) && log.length === logLen && store.cfg().Scheduler_State === before && L.telemetry.some(x => x.Success === 'FALSE' && x.Skill_Or_Endpoint === 'schedule_overrides'), { body: bad.body, tel: L.telemetry });
  const dry = await L.schedRunNext({}, null, fast(c, { jobs, schedule: { b: { enabled: false } }, dry: true }));
  t('dispatcher: a dry run previews the sent schedule (b disabled) but does NOT remember it', dry.status === 200 && !dry.body.due.includes('b') && dry.body.disabled.join() === 'b' && store.cfg().Scheduler_State === before);
  // a stored schedule that became invalid (job renamed in a later deploy) is a loud 400, never a silent default
  const store2 = makeStore(); const s2 = S0(); s2.schedule = { gone_job: { enabled: false } }; store2.tabs.get('Config').push(['Scheduler_State', JSON.stringify(s2)]);
  const L2 = load(store2), r4 = await L2.schedRunNext({}, null, fast(clock(T0), { jobs, }));
  t('dispatcher: an invalid STORED schedule is loud (400 + telemetry), and a corrected schedule from the caller fixes it', r4.status === 400 && /stored schedule is invalid/.test(r4.body.error) && L2.telemetry.length === 1 && (await L2.schedRunNext({}, null, fast(clock(T0), { jobs, schedule: {} }))).status === 200);
}
{
  // a job with an override that changes its time runs at the NEW time (daily at 06:30 ET)
  const store = primeState(makeStore()), L = load(store), c = clock(Date.parse('2026-10-12T10:40:00Z')), log = [];   // 06:40 ET
  const jobs = mkJobs(log, [['d', 'daily']]);
  const none = await L.schedRunNext({}, null, fast(c, { jobs }));
  const early = await L.schedRunNext({}, null, fast(c, { jobs, schedule: { d: { at: '06:30' } } }));
  t('dispatcher: daily job with at=06:30 is not due at 06:40 by default (07:00) but runs once the table says 06:30', none.body.ran === null && early.body.ran === 'd' && log.length === 1);
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
  t('every registry entry maps to a defined job function', names.length === 23 && names.every(n => new RegExp('async function ' + n + '\\(').test(wsrc)), names);
  // the scheduler block never swallows
  t('scheduler block has no empty/underscore catch', !/catch\s*\(\s*_?\s*\)\s*\{\s*\}/.test(blockSrc) && !/catch\s*\(\s*_\s*\)/.test(blockSrc) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(blockSrc));
  const ver = /const BUILD_VERSION = '([^']+)'/.exec(wsrc)[1];
  t('BUILD_VERSION is a 2026-10-12+ build (the scheduler build is 2026-10-12.5-apps-script-scheduler; a same-day bump by another build is fine)', /^2026-10-(1[2-9]|2\d|3[01])\.\d+-/.test(ver), ver);
}
{
  // catch-up forms of the two jobs that used to need the exact hour
  const self = wsrc.slice(wsrc.indexOf('async function maybeRunDailySelftest('), wsrc.indexOf('// GET /ar/aging'));
  t('maybeRunDailySelftest: catch-up form (skips only BEFORE 7am), keeps its once-per-day guard, no swallowed read error', /etHour\(\) < 7/.test(self) && !/etHour\(\) !== 7/.test(self) && /already ran today/.test(self) && /if \(!isMissingTabError\(e\)\) throw e/.test(self));
  const est = wsrc.slice(wsrc.indexOf('async function processEstimateReminders('), wsrc.indexOf('async function processEstimateReminders(') + 600);
  t('processEstimateReminders: no longer requires the exact 8am hour', !/!== 8/.test(est) && /h < 8 \|\| h >= 18/.test(est));
}

// ───────────────────── Oct 23 2026: Sheets-quota COOLDOWN (retry-storm fix, Needs Attention #10) ─────────────────────
const QUOTA_ERR = 'Sheets API error on GET /values/Work_Orders: Quota exceeded for quota metric \'Read requests\' and limit \'Read requests per minute per user\'';
{
  // pure helpers
  const J = [{ name: 'door', critical: true }, { name: 'x' }];
  const dueAll = [{ name: 'x', key: 'k' }, { name: 'door', key: 'k' }];
  const p0 = P.schedCooldownPlan({}, 1000, dueAll, J, false);
  t('cooldown plan: no marker -> not cooling, everything runs', p0.cooling === false && p0.runnable.length === 2 && p0.held.length === 0);
  const p1 = P.schedCooldownPlan({ quota_hot_until: new Date(5000).toISOString() }, 1000, dueAll, J, false);
  t('cooldown plan: future marker -> only the critical job runs, the rest are held by name', p1.cooling === true && p1.runnable.map(d => d.name).join() === 'door' && p1.held.join() === 'x', p1);
  t('cooldown plan: an expired marker does not cool', P.schedCooldownPlan({ quota_hot_until: new Date(500).toISOString() }, 1000, dueAll, J, false).cooling === false);
  t('cooldown plan: a forced run is never held', P.schedCooldownPlan({ quota_hot_until: new Date(5000).toISOString() }, 1000, dueAll, J, true).runnable.length === 2);
  t('cooldown plan: a corrupt marker is ignored, not fatal', P.schedCooldownPlan({ quota_hot_until: 'garbage' }, 1000, dueAll, J, false).cooling === false);
  t('cooldown next: throttled -> now+cooldown', P.schedCooldownNext('', 1000, true, 150000) === new Date(151000).toISOString());
  t('cooldown next: a throttled run never SHORTENS a longer marker', P.schedCooldownNext(new Date(900000).toISOString(), 1000, true, 150000) === new Date(900000).toISOString());
  t('cooldown next: calm run keeps a future marker', P.schedCooldownNext(new Date(5000).toISOString(), 1000, false, 150000) === new Date(5000).toISOString());
  t('cooldown next: calm run clears an expired marker', P.schedCooldownNext(new Date(500).toISOString(), 1000, false, 150000) === '');
  t('door_watchdog is the (only) critical job in the registry', P.SCHED_JOBS.filter(j => j.critical).map(j => j.name).join() === 'door_watchdog');

  // FAULT INJECTION: a job hits the quota -> cooldown starts, it is a calm P2 row (not a P0 page), critical job still runs, others wait, then resume
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  let xFails = true;
  const jobs = [
    { name: 'x', kind: 'interval', every_min: 14, run: async () => { log.push('x'); return xFails ? { ok: false, errors: [{ step: 'job', error: QUOTA_ERR }] } : { ok: true, errors: [] }; } },
    { name: 'door', kind: 'interval', every_min: 1, critical: true, run: async () => { log.push('door'); return { ok: true, errors: [] }; } },
    { name: 'y', kind: 'interval', every_min: 1, run: async () => { log.push('y'); return { ok: true, errors: [] }; } },
  ];
  const r1 = await L.schedRunNext({}, null, fast(c, { jobs }));
  const hot1 = stateOf(store).quota_hot_until;
  t('storm: the throttled job is reported quota_busy, not a page', r1.body.ran === 'x' && r1.body.job_ok === false && r1.body.quota_busy === true && !r1.body.admin_alerted && L.alerts.length === 0, r1.body);
  t('storm: a calm P2 sheets_quota_busy telemetry row, no P0 scheduler_job row', L.telemetry.some(r => r.Job_Type === 'sheets_quota_busy' && r.Success === 'FALSE') && !L.telemetry.some(r => r.Job_Type === 'scheduler_job'), L.telemetry);
  t('storm: Scheduler_State now holds quota_hot_until = now + 150 s, and the run reports it', hot1 === new Date(T0 + 150000).toISOString() && r1.body.quota_hot_until === hot1, hot1);
  c.v += 10000;
  const r2 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('cooling: the door-critical job still runs on the very next tick', r2.body.ran === 'door' && r2.body.job_ok === true && log.join() === 'x,door', r2.body);
  t('cooling: the other due job is held and named in the answer', r2.body.quota_cooldown && r2.body.quota_cooldown.held.join() === 'y' && r2.body.quota_cooldown.until === hot1, r2.body);
  t('cooling: a calm critical run does NOT clear or shorten the marker', stateOf(store).quota_hot_until === hot1);
  c.v += 10000;
  const r3 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('cooling: nothing else starts, no read-heavy job runs, more=false so the Apps Script loop stops', r3.body.ran === null && r3.body.more === false && log.join() === 'x,door' && r3.body.quota_cooldown.held.join() === 'y', r3.body);
  t('cooling: the heartbeat is still written (the dead-man switch sees a live clock)', stateOf(store).last_tick === new Date(c.v).toISOString());
  // /cron/status uses the real clock (like its claim field), so put a marker that is really in the future into the state
  const realFuture = new Date(Date.now() + 90000).toISOString();
  const stNow = stateOf(store); stNow.quota_hot_until = realFuture; store.setCfg('Scheduler_State', JSON.stringify(stNow));
  const stat = await L.schedStatusHandler({});
  t('cooling: /cron/status shows the cooldown', stat.body && stat.body.quota_cooldown_until === realFuture, stat.body && stat.body.quota_cooldown_until);
  stNow.quota_hot_until = hot1; store.setCfg('Scheduler_State', JSON.stringify(stNow));
  const stat2 = await L.schedStatusHandler({});
  t('cooldown over: /cron/status shows no cooldown', stat2.body && stat2.body.quota_cooldown_until === undefined);
  const forced = await L.schedRunNext({}, null, fast(c, { jobs, only: ['y'], force: true }));
  t('cooling: a forced run of a held job is allowed', forced.body.ran === 'y' && forced.body.job_ok === true && log.join() === 'x,door,y', forced.body);
  c.v += 150000;
  xFails = false;
  const r4 = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('cooldown over: held jobs run again on the first tick after it', r4.body.ran && ['door', 'y'].includes(r4.body.ran) && !r4.body.quota_cooldown, r4.body);
  t('cooldown over: a calm run drops the expired marker from the state', stateOf(store).quota_hot_until === undefined);
}
{
  // a job that SUCCEEDS but took a real 429 on the way still starts the cooldown (the signal is the 429, not the failure)
  const store = primeState(makeStore()); let n429 = 0;
  const L = load(store, { last429: () => n429 }), c = clock(T0), log = [];
  const jobs = [{ name: 'x', kind: 'interval', every_min: 14, run: async () => { n429 = c.v; log.push('x'); return { ok: true, errors: [] }; } }];
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('429 seen but job ok: still ok, cooldown set', r.body.job_ok === true && !r.body.quota_busy && !!stateOf(store).quota_hot_until, [r.body, stateOf(store)]);
}
{
  // a door-critical job failing on the quota EXTENDS the marker (never shortens), and is still a quota-busy row
  const store = primeState(makeStore()), L = load(store), c = clock(T0);
  const jobs = [{ name: 'door', kind: 'interval', every_min: 1, critical: true, run: async () => ({ ok: false, errors: [{ step: 'job', error: QUOTA_ERR }] }) }];
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('critical job on the quota: cooldown set, calm row, no page', r.body.quota_busy === true && L.alerts.length === 0 && stateOf(store).quota_hot_until === new Date(T0 + 150000).toISOString(), r.body);
}
{
  // happy path reports nothing; a NON-quota failure is still a loud P0 and starts no cooldown
  const store = primeState(makeStore()), L = load(store), c = clock(T0), log = [];
  const jobs = mkJobs(log, [['a', 'interval'], ['b', 'interval']]);
  const r = await L.schedRunNext({}, null, fast(c, { jobs }));
  t('happy path: no marker, no cooldown field, no telemetry', !stateOf(store).quota_hot_until && !r.body.quota_cooldown && L.telemetry.length === 0, [r.body, L.telemetry]);
  const store2 = primeState(makeStore()), L2 = load(store2), c2 = clock(T0);
  const bad = [{ name: 'a', kind: 'interval', every_min: 14, run: async () => ({ ok: false, errors: [{ step: 'job', error: 'boom: not a quota problem' }] }) }];
  const rb = await L2.schedRunNext({}, null, fast(c2, { jobs: bad }));
  t('a real (non-quota) failure stays a P0 scheduler_job row + admin alert and starts NO cooldown', L2.telemetry.some(r => r.Job_Type === 'scheduler_job') && L2.alerts.length === 1 && !stateOf(store2).quota_hot_until && !rb.body.quota_busy, [L2.telemetry, L2.alerts]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
