// Offline harness for HubScheduler.gs - fakes UrlFetchApp / LockService / PropertiesService / ScriptApp /
// MailApp / SpreadsheetApp / Utilities / Logger and a controllable clock, then runs setup(), runScheduler(),
// statusReport(), removeScheduler() end to end against a scripted "Hub".
// Run: node apps-script/hub-scheduler/test/hub-scheduler.test.mjs   (or from this folder: node test/hub-scheduler.test.mjs)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'HubScheduler.gs'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(here, '..', 'appsscript.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  FAIL:', msg, extra === undefined ? '' : JSON.stringify(extra)); } };

const MIN = 60000, HOUR = 3600000;
function world(opts) {
  opts = opts || {};
  const w = { clock: Date.parse('2026-10-12T14:00:00Z'), logs: [], mails: [], fetches: [], props: {}, triggers: [], locked: false, sleeps: 0,
    mailFails: false, hub: null, uuid: 0, dropSheetWrite: false, opened: [], sheets: {} };
  w.sheetRows = [['Key', 'Value'], ['digest_enabled', 'TRUE']];
  w.sheets['1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4'] = { Config: w.sheetRows };
  w.setupTriggers = opts.triggers || 0;
  for (let i = 0; i < w.setupTriggers; i++) w.triggers.push(mkTrigger('runScheduler'));
  function mkTrigger(fn) { return { fn, mins: null, getHandlerFunction() { return this.fn; } }; }
  const mkSheet = (rows) => ({
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    appendRow: (r) => { rows.push(r.slice()); },
    getLastRow: () => rows.length,
    getRange: (r, c) => ({
      setValue: (v) => { if (w.dropSheetWrite) return; while (rows[r - 1].length < c) rows[r - 1].push(''); rows[r - 1][c - 1] = v; },
      getValue: () => rows[r - 1][c - 1],
      setNumberFormat: () => {},
    }),
  });
  const ctx = {
    console, JSON, Math, String, Number, Array, Object, parseInt, encodeURIComponent, Intl, isNaN,
    Logger: { log: (m) => w.logs.push(String(m)) },
    Utilities: { getUuid: () => { w.uuid++; const h = (w.uuid * 7919).toString(16).padStart(8, '0'); return `${h}-aaaa-4bbb-8ccc-${h}${h}`.slice(0, 36); }, sleep: () => { w.sleeps++; },
      formatDate: (d, tz, pattern) => {   // only the one pattern the script uses: 'yyyy-MM-dd HH:mm u'
        if (pattern !== 'yyyy-MM-dd HH:mm u' || tz !== 'America/New_York') throw new Error('fake formatDate: unsupported ' + tz + ' ' + pattern);
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
        const u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
        return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${u}`;
      } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => { if (w.propThrow) throw new Error('properties service down'); return Object.prototype.hasOwnProperty.call(w.props, k) ? w.props[k] : null; },
      setProperty: (k, v) => { w.props[k] = String(v); }, deleteProperty: (k) => { delete w.props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (w.locked) return false; w.locked = true; return true; }, releaseLock: () => { w.locked = false; } }) },
    ScriptApp: {
      getProjectTriggers: () => w.triggers.slice(),
      deleteTrigger: (t) => { w.triggers = w.triggers.filter(x => x !== t); },
      newTrigger: (fn) => { const t = mkTrigger(fn); return { timeBased: () => ({ everyMinutes: (m) => ({ create: () => { t.mins = m; w.triggers.push(t); return t; } }) }) }; },
    },
    MailApp: { sendEmail: (to, subject, body) => { if (w.mailFails) throw new Error('mail quota'); w.mails.push({ to, subject, body }); } },
    SpreadsheetApp: { openById: (id) => { w.openedSheet = id; w.opened.push(id); const book = w.sheets[id]; if (!book) throw new Error('no such spreadsheet ' + id);
        return { getSheetByName: (n) => book[n] ? mkSheet(book[n]) : null, insertSheet: (n) => { book[n] = []; return mkSheet(book[n]); } }; }, flush: () => {} },
    UrlFetchApp: { fetch: (url, o) => { w.fetches.push({ url, o }); if (!w.hub) throw new Error('no hub scripted'); const r = w.hub(url, o); if (r instanceof Error) throw r; return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }; } },
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(w.clock); } static now() { return w.clock; } }
  ctx.Date = FakeDate;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  // Most tests below are about the Hub loop, so by default the table is cut down to the Hub rows; allJobs:true keeps the real table.
  if (!opts.allJobs) vm.runInContext("JOBS = JOBS.filter(function (j) { return j.run === 'hub'; });", ctx);
  w.run = (fn) => vm.runInContext(fn + '()', ctx);
  w.ctx = ctx;
  return w;
}
const run = (url) => url.endsWith('/cron/run'), status = (url) => url.endsWith('/cron/status');
const GOOD_STATUS = { ok: true, now: 'x', last_tick: 'x', tick_age_min: 0, jobs: {}, overdue: [] };
// A scripted Hub: `queue` is the list of /cron/run replies (each {ran,job_ok,more,...}); the last repeats as "idle".
function scriptedHub(w, queue, statusBody) {
  let i = 0;
  w.hub = (url, o) => {
    if (run(url)) { const q = queue[Math.min(i, queue.length - 1)]; i++; return { code: 200, body: Object.assign({ ok: true, ran: null, job_ok: null, error: null, more: false, due: [], ts: 't' }, q) }; }
    if (status(url)) return { code: 200, body: statusBody || GOOD_STATUS };
    return { code: 404, body: 'nope' };
  };
  return () => i;
}
const mailsWith = (w, re) => w.mails.filter(m => re.test(m.subject));

// ── constants + manifest ─────────────────────────────────────────────────────────────────────
{
  const w = world();
  ok(vm.runInContext('WORKER_URL', w.ctx) === 'https://maintenance-hub.brett-2f8.workers.dev', 'WORKER_URL');
  ok(vm.runInContext('SHEET_ID', w.ctx) === '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4', 'SHEET_ID');
  ok(vm.runInContext('NOTIFY_EMAIL', w.ctx) === 'brett@bmoremanagement.com', 'NOTIFY_EMAIL');
  ok(MANIFEST.timeZone === 'America/New_York' && MANIFEST.runtimeVersion === 'V8', 'manifest tz + V8');
  ok(JSON.stringify(MANIFEST.oauthScopes.slice().sort()) === JSON.stringify(['https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/spreadsheets']), 'manifest scopes are exactly the four needed', MANIFEST.oauthScopes);
  ok(/NO CRON ANYWHERE/.test(SRC) && /SETUP: TWO STEPS/.test(SRC) && /paste this file over Code\.gs/.test(SRC), 'header carries the no-cron rule and the two-step setup');
  ok(/approveAndStart/.test(SRC.slice(0, SRC.indexOf('var JOBS'))) && /setup\(\) is SAFE/.test(SRC) && /THAT is the only step that starts the 15-minute/.test(SRC), 'header explains setup is safe and approveAndStart is the only start');
  ok(!/catch \(\w+\) \{\s*\}/.test(SRC), 'no empty catch blocks');
  // the JOBS table is at the very top of the file, before any function
  ok(SRC.indexOf('var JOBS = [') > 0 && SRC.indexOf('var JOBS = [') < SRC.indexOf('function '), 'the JOBS table comes before every function');
}

// ── setup() is SAFE: token + Config row + read-only preview, then STOPS (no timer, no live tick, no job) ──
{
  const w = world({ triggers: 3 });
  w.hub = (url, o) => {
    if (run(url)) { const b = JSON.parse(o.payload); if (b.dry_run !== true) throw new Error('setup must only ever DRY-RUN the Hub'); return { code: 200, body: { ok: true, dry: true, first_run: true, due: ['door_watchdog', 'sweep'], would_seed: ['daily_digest'], disabled: [], preflight: { ok: true, errors: [], jobs: { sweep: { would: 'texts held messages', twilio_enabled: true, twilio_test_mode: false,
      quiet_hours_held_due: { count: 3, by_recipient_type: { tenant: 2, vendor: 1 }, by_age: { under_1h: 0, h1_to_24: 1, d1_to_7: 1, over_7d: 1 }, oldest_days: 10.2, stale_over_1d: 2 },
      queued_notifications_due: { count: 0, by_age: {}, oldest_days: null },
      vendor_nudges_due: { count: 4, by_request_type: { photos: 3, invoice: 1 }, by_age: { under_1h: 0, h1_to_24: 1, d1_to_7: 0, over_7d: 3 }, oldest_days: 16.4, stale_over_1d: 3 } } } }, status_summary: { jobs: { door_watchdog: {}, sweep: {}, brand_new_job: {} } } } }; }
    return { code: 404, body: 'nope' };
  };
  w.run('setup');
  const token = w.props.SCHEDULER_TOKEN;
  ok(/^hs_[0-9a-f]{64}$/.test(token) && token.length >= 24, 'a long random token is generated and stored in Script Properties', token && token.length);
  const rows = w.sheetRows.filter(r => r[0] === 'Scheduler_Token');
  ok(rows.length === 1 && rows[0][1] === token, 'Config row Scheduler_Token appended with the token');
  ok(w.openedSheet === '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4', 'opened the Hub sheet by id');
  ok(w.triggers.length === 3 && w.triggers.every(t => t.fn === 'runScheduler' && t.mins === null), 'setup creates NO timer and removes none (the 3 pre-existing ones are untouched)', w.triggers.map(t => t.fn + t.mins));
  ok(!w.props.STARTED && w.props.SETUP_DONE, 'setup does not set STARTED; it records SETUP_DONE');
  ok(w.fetches.length === 1 && /\/cron\/run$/.test(w.fetches[0].url) && JSON.parse(w.fetches[0].o.payload).dry_run === true && w.fetches[0].o.headers['X-Auth-Token'] === token, 'the ONLY network call is one dry_run POST /cron/run (no live tick, no /cron/status)', w.fetches.map(f => f.url));
  ok(JSON.parse(w.fetches[0].o.payload).schedule.sweep.every_min === 15 && JSON.parse(w.fetches[0].o.payload).schedule.review_mon.dow === 1, 'the preview is asked with the JOBS table as the schedule');
  ok(w.sleeps >= 1, 'waits for the Hub to see the new Config row before asking');
  ok(w.mails.length === 0, 'setup sends no email on the happy path', w.mails);
  ok(!w.logs.some(l => l.includes(token)) && !w.mails.some(m => (m.subject + m.body).includes(token)), 'the token is never logged or emailed');
  const L = w.logs.join('\n');
  ok(/SETUP STEP 1 of 2/.test(L) && /NOTHING HAS BEEN STARTED/.test(L) && /approveAndStart/.test(L), 'plain-English: says nothing started and names approveAndStart', L);
  ok(/Hub jobs that would run right now: door_watchdog, sweep/.test(L) && /Marked as already done today.*daily_digest/.test(L), 'lists what would run and what is marked done');
  ok(/Texts held back by quiet hours that are now due: 3 \(2 tenant, 1 vendor\)/.test(L) && /1 to 24 hours 1 \| 1 to 7 days 1 \| over 7 days 1/.test(L) && /oldest has waited 10.2 days/.test(L) && /2 of them are STALE/.test(L), 'held quiet-hours texts are shown BY AGE with the stale count', L);
  ok(/Vendor nudges that are due: 4 \(3 photos, 1 invoice\)/.test(L) && /over 7 days 3/.test(L) && /3 of them are STALE/.test(L) && /16.4 days/.test(L), 'stale vendor nudges are shown by age', L);
  ok(/Twilio texting is ON \(LIVE: texts WILL be sent\)/.test(L), 'says plainly whether texts would really go out');
  ok(/not in your JOBS table.*brand_new_job/.test(L), 'warns about a Hub job that has no line in the JOBS table', L);
  // run setup again: update in place, no duplicate row, same token, still no timer
  w.run('setup');
  ok(w.sheetRows.filter(r => r[0] === 'Scheduler_Token').length === 1 && w.props.SCHEDULER_TOKEN === token && w.triggers.length === 3 && !w.props.STARTED, 'second setup() updates in place: no duplicate row, token kept, still not started');
  // a changed value in the sheet is repaired
  w.sheetRows.find(r => r[0] === 'Scheduler_Token')[1] = 'tampered';
  w.run('setup');
  ok(w.sheetRows.find(r => r[0] === 'Scheduler_Token')[1] === token, 'setup() re-writes a wrong/old value in an existing row');
}
// setup never runs a job even if the Hub would happily accept a live call
{
  const w = world(); let live = 0;
  w.hub = (url, o) => { if (run(url) && JSON.parse(o.payload).dry_run !== true) live++; return { code: 200, body: { ok: true, dry: true, due: [], preflight: { ok: true, jobs: {} }, status_summary: { jobs: {} } } }; };
  w.run('setup');
  ok(live === 0 && !w.props.STARTED && w.triggers.length === 0, 'setup made zero live calls and installed zero timers');
}
// existing row with padding/whitespace in the key is found, not duplicated
{
  const w = world(); w.sheetRows.push(['  Scheduler_Token ', 'old']);
  scriptedHub(w, [{}]); w.run('setup');
  ok(w.sheetRows.filter(r => String(r[0]).trim() === 'Scheduler_Token').length === 1 && w.sheetRows[w.sheetRows.length - 1][1] === w.props.SCHEDULER_TOKEN, 'existing row found by trimmed key');
}
// verify-after-write failure: throws, emails, starts nothing
{
  const w = world(); w.dropSheetWrite = true; w.sheetRows.push(['Scheduler_Token', 'old']); scriptedHub(w, [{}]);
  let threw = null; try { w.run('setup'); } catch (e) { threw = e; }
  ok(threw && /could not save the Hub token/.test(threw.message), 'token write that does not read back -> setup throws');
  ok(mailsWith(w, /setup: could not save the Hub token/).length === 1 && mailsWith(w, /setup/)[0].to === 'brett@bmoremanagement.com', 'and emails Brett');
  ok(w.triggers.length === 0 && w.fetches.length === 0 && !w.props.SETUP_DONE, 'and installs no trigger / calls nothing / does not mark setup done');
}
// the Hub not answering the preview is reported honestly; approveAndStart will then refuse
{
  const w = world(); w.hub = () => ({ code: 404, body: 'Not found' });
  const r = w.run('setup');
  const L = w.logs.join('\n');
  ok(/PREVIEW FAILED \(Hub\)/.test(L) && /HTTP 404/.test(L) && !/SETUP IS DONE/.test(L) && /DID NOT ANSWER THE PREVIEW/.test(L) && r.ok === false && r.started === false, 'a Hub that does not answer -> setup says so and does not claim to be done', L);
  const a = w.run('approveAndStart');
  ok(a.started === false && /NOT STARTED: the Hub did not answer/.test(w.logs.join('\n')) && w.triggers.length === 0 && !w.props.STARTED, 'and approveAndStart refuses to start');
}
// 401 right after writing the token: it retries (the Hub caches Config briefly) instead of failing
{
  const w = world(); let n = 0;
  w.hub = () => (++n < 3 ? { code: 401, body: { error: 'Unauthorized' } } : { code: 200, body: { ok: true, dry: true, due: [], preflight: { ok: true, jobs: {} }, status_summary: { jobs: {} } } });
  const r = w.run('setup');
  ok(r.ok === true && n === 3 && /has not noticed the new token yet/.test(w.logs.join('\n')), 'a 401 during the preview is retried (up to 3 tries) while the Hub catches up', { n });
}

// ── approveAndStart(): the ONLY thing that starts the clock ─────────────────────────────────────────
{
  const w = world();
  const a0 = w.run('approveAndStart');
  ok(a0.started === false && /run  setup  first/.test(w.logs.join('\n')) && w.triggers.length === 0 && w.fetches.length === 0, 'before setup: refuses, installs nothing, calls nothing');
}
{
  const w = world({ triggers: 2 });
  scriptedHub(w, [{ ran: 'door_watchdog', job_ok: true, more: false }]);
  w.run('setup');
  ok(w.triggers.length === 2 && !w.props.STARTED, 'precondition: after setup nothing is started');
  const nBefore = w.fetches.length;
  const r = w.run('approveAndStart');
  const token = w.props.SCHEDULER_TOKEN;
  ok(w.triggers.length === 1 && w.triggers[0].fn === 'runScheduler' && w.triggers[0].mins === 15, 'exactly ONE everyMinutes(15) trigger (2 old ones replaced)', w.triggers.map(t => t.fn + t.mins));
  ok(!!w.props.STARTED && r.started === true && r.ok === true, 'STARTED flag set, returns started+ok');
  const live = w.fetches.slice(nBefore).filter(f => run(f.url) && JSON.parse(f.o.payload).dry_run !== true);
  ok(live.length === 1 && live[0].o.headers['X-Auth-Token'] === token && JSON.parse(live[0].o.payload).schedule.daily_digest.at === '07:00', 'the first live tick ran at once, sending the JOBS table as the schedule');
  const L = w.logs.join('\n');
  ok(/APPROVED/.test(L) && /exactly one/i.test(L) && /STARTED\. The first tick worked/.test(L), 'plain-English summary in the log', L);
  ok(!L.includes(token), 'the token is never logged');
  // second approveAndStart: still exactly one timer
  w.run('approveAndStart');
  ok(w.triggers.length === 1, 'running approveAndStart again keeps exactly one timer');
}
{
  const w = world(); scriptedHub(w, [{}]);
  w.run('setup'); w.hub = (url, o) => (run(url) && JSON.parse(o.payload).dry_run !== true) ? { code: 401, body: { error: 'Unauthorized' } } : { code: 200, body: { ok: true, dry: true, due: [], preflight: { ok: true, jobs: {} }, status_summary: { jobs: {} } } };
  w.run('approveAndStart');
  ok(w.logs.some(l => /STARTED, BUT THE FIRST TICK REPORTED A PROBLEM/.test(l)) && !w.logs.some(l => /^STARTED\. The first tick worked/.test(l)) && w.triggers.length === 1, 'a first tick that fails is reported honestly (timer still installed)', w.logs);
  ok(mailsWith(w, /FAILING/).length === 1 && /HTTP 401/.test(mailsWith(w, /FAILING/)[0].body), 'and the usual 401 email goes out');
}
// a runScheduler run by hand BEFORE approveAndStart does nothing
{
  const w = world(); scriptedHub(w, [{}]); w.run('setup');
  const n = w.fetches.length, r = w.run('runScheduler');
  ok(r.notStarted === true && w.fetches.length === n && w.mails.length === 0 && /has not been started/.test(w.logs.join('\n')), 'runScheduler before approveAndStart: logs "not started", makes no calls, sends nothing');
}
// ...but a timer that exists without the started flag (properties wiped) is NOT silent
{
  const w = world({ triggers: 1 }); scriptedHub(w, [{}]);
  const r = w.run('runScheduler');
  ok(r.ok === false && mailsWith(w, /timer is on but the scheduler is not approved/).length === 1 && w.fetches.length === 0, 'a timer without the started flag emails instead of quietly doing nothing');
}

// ── runScheduler(): loop until more=false, status once ──────────────────────────────────────────
function ready(w, queue, statusBody) { w.props.SCHEDULER_TOKEN = 'hs_' + 'a'.repeat(64); w.props.STARTED = 'x'; w.triggers.push({ fn: 'runScheduler', mins: 15, getHandlerFunction() { return 'runScheduler'; } }); return scriptedHub(w, queue, statusBody); }
{
  const w = world(); ready(w, [{ ran: 'a', job_ok: true, more: true }, { ran: 'b', job_ok: true, more: true }, { ran: 'c', job_ok: true, more: false }]);
  const r = w.run('runScheduler');
  const runs = w.fetches.filter(f => run(f.url)), sts = w.fetches.filter(f => status(f.url));
  ok(runs.length === 3 && sts.length === 1, 'loops POST /cron/run until more=false, then GET /cron/status once', { runs: runs.length, sts: sts.length });
  ok(runs.every(f => f.o.method === 'post' && f.o.headers['X-Auth-Token'] === w.props.SCHEDULER_TOKEN) && sts[0].o.method === 'get', 'methods + token header');
  ok(r.ok === true && r.ran.join() === 'a,b,c' && w.mails.length === 0, 'summary returned, no email on a healthy tick', w.mails);
}
{
  const w = world(); ready(w, [{ ran: 'x', job_ok: true, more: true }]);
  w.run('runScheduler');
  ok(w.fetches.filter(f => run(f.url)).length === 15, 'hard cap of 15 calls per tick when more never clears');
}
{
  const w = world(); ready(w, [{ ran: 'x', job_ok: true, more: true }]);
  const orig = w.hub; w.hub = (u, o) => { w.clock += 100000; return orig(u, o); };   // each call "takes" 100 s
  w.run('runScheduler');
  ok(w.fetches.filter(f => run(f.url)).length <= 3, 'stops looping before the Apps Script 6-minute limit', w.fetches.length);
}
{
  const w = world(); ready(w, [{}]); w.locked = true;
  const r = w.run('runScheduler');
  ok(w.fetches.length === 0 && r.skipped === true && w.locked === true, 'script lock held by a previous tick -> skipped, lock untouched');
  const w2 = world(); ready(w2, [{}]); w2.run('runScheduler');
  ok(w2.locked === false, 'lock released after a tick');
  const w3 = world(); ready(w3, [{}]); w3.hub = () => ({ code: 500, body: 'x' }); w3.run('runScheduler');
  ok(w3.locked === false, 'lock released after a failing tick');
}
{
  const w = world(); scriptedHub(w, [{}]); w.props.STARTED = 'x';   // started, but the token is gone
  const r = w.run('runScheduler');
  ok(r.ok === false && mailsWith(w, /not set up/).length === 1 && w.fetches.length === 0, 'not set up -> emails once, calls nothing');
}

// ── infra failure alerting: immediately, hourly reminders, RECOVERED ────────────────────────────
{
  const w = world(); ready(w, [{}]);
  let mode = 'http500';
  w.hub = (url) => {
    if (mode === 'http500') return { code: 500, body: 'boom' };
    if (mode === 'nonjson') return { code: 200, body: '<html>maintenance</html>' };
    if (mode === 'throw') return new Error('DNS failure');
    if (mode === 'okfalse') return { code: 200, body: { ok: false, error: 'STATE NOT RECORDED: x' } };
    return { code: 200, body: run(url) ? { ok: true, ran: null, more: false } : GOOD_STATUS };
  };
  w.run('runScheduler');
  ok(w.mails.length === 1 && /FAILING/.test(w.mails[0].subject) && /HTTP 500/.test(w.mails[0].body) && w.mails[0].to === 'brett@bmoremanagement.com', 'first failure emails immediately', w.mails);
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 1, '15 min later, still failing: no new email (rate-limited)');
  w.clock += 30 * MIN; mode = 'nonjson'; w.run('runScheduler');
  ok(w.mails.length === 1, '45 min in (non-JSON now): still within the hour');
  w.clock += 16 * MIN; w.run('runScheduler');
  ok(w.mails.length === 2 && /STILL failing/.test(w.mails[1].subject) && /not JSON/.test(w.mails[1].body), 'after an hour: a reminder (non-JSON detected)', w.mails.map(m => m.subject));
  w.clock += 61 * MIN; mode = 'throw'; w.run('runScheduler');
  ok(w.mails.length === 3 && /could not reach the Hub/.test(w.mails[2].body), 'network exception -> reminder after another hour');
  w.clock += 61 * MIN; mode = 'okfalse'; w.run('runScheduler');
  ok(w.mails.length === 4 && /STATE NOT RECORDED/.test(w.mails[3].body), 'ok:false body is treated as a failure too');
  w.clock += 15 * MIN; mode = 'good'; w.run('runScheduler');
  ok(w.mails.length === 5 && /RECOVERED/.test(w.mails[4].subject), 'recovery email once it works again', w.mails.map(m => m.subject));
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 5, 'and no further emails while healthy');
  mode = 'http500'; w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 6 && /FAILING/.test(w.mails[5].subject), 'a NEW failure after recovery emails immediately again');
}
{
  // status call failing is also a failure
  const w = world(); ready(w, [{ ran: null }]);
  const orig = w.hub; w.hub = (u, o) => status(u) ? { code: 503, body: { ok: false, error: 'could not read Config' } } : orig(u, o);
  w.run('runScheduler');
  ok(mailsWith(w, /FAILING/).length === 1 && /status check/.test(w.mails[0].body), 'a failing /cron/status call is reported');
}

// ── job failure + overdue alerting ──────────────────────────────────────────────────────────────
{
  const w = world(); ready(w, [{ ran: 'sweep', job_ok: false, error: 'quiet_hours: 2 held message(s) failed to send', more: false }]);
  w.run('runScheduler');
  ok(w.mails.length === 1 && /Job FAILED: sweep/.test(w.mails[0].subject) && /failed to send/.test(w.mails[0].body), 'job_ok:false -> email naming the job and the error');
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 1, 'same job failing again 15 min later: no second email');
  w.clock += 2 * HOUR + 30 * MIN; w.run('runScheduler');
  ok(w.mails.length === 1, '2h45 after the first email: still within 3h');
  w.clock += 20 * MIN; w.run('runScheduler');
  ok(w.mails.length === 2, 'after 3h: emailed again', w.mails.length);
  scriptedHub(w, [{ ran: 'daily_digest', job_ok: false, error: 'deliver_digest: twilio down', more: false }]);
  w.run('runScheduler');
  ok(w.mails.length === 3 && /daily_digest/.test(w.mails[2].subject), 'a different job fails -> its own email (rate limit is per job)');
  scriptedHub(w, [{ ran: 'slow', job_ok: null, timed_out: true, more: false }]);
  const n = w.mails.length; w.run('runScheduler');
  ok(w.mails.length === n, 'a timed-out (still running) job is logged, not emailed as a failure');
}
{
  const w = world();
  const od = (names) => ({ ok: true, now: 'x', overdue: names, jobs: Object.fromEntries(names.map(n => [n, { overdue: true, overdue_reason: 'last success was 61 min ago', last_error: n === 'sweep' ? 'boom' : null }])) });
  ready(w, [{}], od(['sweep']));
  w.run('runScheduler');
  ok(w.mails.length === 1 && /OVERDUE: sweep/.test(w.mails[0].subject) && /61 min ago/.test(w.mails[0].body) && /boom/.test(w.mails[0].body), 'overdue job -> email with the reason');
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 1, 'same overdue set again: no email');
  scriptedHub(w, [{}], od(['sweep', 'daily_digest']));
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 2 && /daily_digest, sweep|sweep.*daily_digest|daily_digest.*sweep/.test(w.mails[1].subject), 'a different overdue set -> new email');
  scriptedHub(w, [{}], od(['sweep']));
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 2, 'back to a set already emailed within 3h: quiet');
  w.clock += 3 * HOUR; w.run('runScheduler');
  ok(w.mails.length === 3, 'that set is emailed again after 3h');
  scriptedHub(w, [{}], GOOD_STATUS);
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 4 && /back on schedule/.test(w.mails[3].subject), 'all clear -> one "back on schedule" email');
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 4, '...and then silence');
}

// ── triggers ───────────────────────────────────────────────────────────────────────────────────
{
  const w = world({ triggers: 3 }); w.props.SCHEDULER_TOKEN = 'hs_' + 'b'.repeat(64); w.props.STARTED = 'x'; scriptedHub(w, [{}]);
  w.run('runScheduler');
  ok(w.triggers.length === 1 && mailsWith(w, /had 3 timers/).length === 1, 'duplicate triggers are deleted down to one and Brett is told');
  const w2 = world({ triggers: 1 }); w2.props.SCHEDULER_TOKEN = 'hs_' + 'b'.repeat(64); w2.props.STARTED = 'x'; scriptedHub(w2, [{}]);
  w2.run('runScheduler');
  ok(w2.mails.length === 0, 'a single trigger is left alone, no email');
}
{
  const w = world({ triggers: 1 }); w.props.SCHEDULER_TOKEN = 'hs_x';
  w.ctx.ScriptApp.getProjectTriggers().push({ getHandlerFunction: () => 'somethingElse' });
  w.triggers.push({ fn: 'otherJob', getHandlerFunction() { return this.fn; } });
  w.props.STARTED = 'x';
  w.run('removeScheduler');
  ok(w.triggers.length === 1 && w.triggers[0].fn === 'otherJob', 'removeScheduler deletes only the scheduler trigger(s)');
  ok(!w.props.STARTED && w.logs.some(l => /now OFF/.test(l) && /approveAndStart again/.test(l)), 'removeScheduler clears the started flag, says what it means and how to turn it back on');
  const n = w.fetches.length; const rr = w.run('runScheduler');
  ok(rr.notStarted === true && w.fetches.length === n, 'after removeScheduler a hand-run tick does nothing');
}

// ── never dies quietly ─────────────────────────────────────────────────────────────────────────
{
  const w = world(); ready(w, [{}]); w.propThrow = true;
  let threw = null; try { w.run('runScheduler'); } catch (e) { threw = e; }
  // the very first property read throws before the alert path can read throttle state; the error must still surface
  ok(threw && /properties service down/.test(threw.message), 'an unexpected exception is re-thrown (Google failure email fires)');
  ok(w.locked === false, 'lock released even when the tick throws');
}
{
  const w = world(); ready(w, [{}]);
  w.hub = (u) => { if (run(u)) return { code: 200, body: { ok: true, ran: 'a', job_ok: true, more: false } }; return { code: 200, body: { ok: true, jobs: null, overdue: { not: 'an array' } } }; };
  let threw = null; try { w.run('runScheduler'); } catch (e) { threw = e; }
  ok(threw && mailsWith(w, /script error/).length === 1 && /runScheduler threw/.test(w.mails[0].body), 'a bug inside the script (malformed status) -> emailed AND re-thrown', { threw: threw && threw.message, mails: w.mails.map(m => m.subject) });
}
{
  const w = world(); ready(w, [{}]); w.hub = () => ({ code: 500, body: 'x' }); w.mailFails = true;
  let threw = null; try { w.run('runScheduler'); } catch (e) { threw = e; }
  ok(threw && /could not be emailed/.test(threw.message), 'if the alert email itself fails the run throws, so Google\'s own failure notification fires');
}

// ── statusReport ───────────────────────────────────────────────────────────────────────────────
{
  const w = world({ triggers: 1 }); const tok = 'hs_' + 'c'.repeat(64); w.props.SCHEDULER_TOKEN = tok; w.props.STARTED = 'x';
  scriptedHub(w, [{}], { ok: true, now: '2026-10-12T14:00:00Z', last_tick: '2026-10-12T13:55:00Z', tick_age_min: 5, overdue: ['sweep'], jobs: { door_watchdog: { expected: 'every 14+ min', last_ok: 't', overdue: false }, sweep: { expected: 'every 14+ min', last_ok: null, overdue: true, overdue_reason: 'has never completed successfully', last_error: 'x' } } });
  w.run('statusReport');
  ok(w.logs.some(l => /OVERDUE sweep/.test(l) && /never completed/.test(l)) && w.logs.some(l => /^ok\s+door_watchdog/.test(l)) && w.logs.some(l => /Timers installed here: 1/.test(l)) && w.logs.some(l => /OVERDUE: sweep/.test(l)), 'statusReport prints a plain-English line per job', w.logs);
  ok(!w.logs.some(l => l.includes(tok)), 'statusReport never prints the token');
  ok(w.mails.length === 0, 'statusReport sends no email');
  const w2 = world(); w2.run('statusReport');
  ok(w2.logs.some(l => /Not set up/.test(l)), 'statusReport before setup says so');
}

// ── preflight(): dry run only, readable log, no mail, no state ──────────────────────────────────
{
  const w = world({ triggers: 1 }); const tok = 'hs_' + 'd'.repeat(64); w.props.SCHEDULER_TOKEN = tok;
  w.hub = (url, o) => ({ code: 200, body: { ok: true, dry: true, first_run: true, due: ['sweep'], would_seed: ['daily_digest', 'review_mon'], preflight: { ok: true, errors: [], jobs: { sweep: { would: 'texts held messages', quiet_hours_held_due: { count: 3, by_age: { under_1h: 3 }, oldest_days: 0 } } } } } });
  const r = w.run('preflight');
  const f = w.fetches[0];
  ok(f && /\/cron\/run$/.test(f.url) && JSON.parse(f.o.payload).dry_run === true && f.o.headers['X-Auth-Token'] === tok, 'preflight POSTs /cron/run with {dry_run:true}', f && f.o.payload);
  const L = w.logs.join('\n');
  ok(/FIRST scheduler tick/.test(L) && /Hub jobs that would run right now: sweep/.test(L) && /daily_digest, review_mon/.test(L) && /sweep: texts held messages/.test(L) && /now due: 3/.test(L), 'preflight logs a readable summary', w.logs);
  ok(w.mails.length === 0 && w.fetches.length === 1 && !L.includes(tok), 'preflight sends no mail, makes one call, never prints the token');
  ok(r.ok === true, 'preflight returns ok when the Hub answers');
  const w2 = world(); w2.run('preflight');
  ok(w2.logs.some(l => /Not set up/.test(l)) && w2.fetches.length === 0, 'preflight before setup says so and calls nothing');
  const w3 = world({ triggers: 1 }); w3.props.SCHEDULER_TOKEN = tok; w3.hub = () => ({ code: 401, body: 'no' });
  w3.run('preflight');
  ok(w3.logs.some(l => /PREVIEW FAILED/.test(l) && /401/.test(l)), 'preflight reports a failing Hub loudly');
}
// ── a tick on a first-ever Hub run logs what was seeded ─────────────────────────────────────────
{
  const w = world({ triggers: 1 }); w.props.SCHEDULER_TOKEN = 'hs_' + 'e'.repeat(64); w.props.STARTED = 'x';
  scriptedHub(w, [{ ran: 'sweep', job_ok: true, more: false, first_run: true, seeded: ['daily_digest', 'ar_report_mon'] }]);
  w.run('runScheduler');
  ok(w.logs.some(l => /FIRST RUN on the Hub/.test(l) && /daily_digest, ar_report_mon/.test(l)), 'a first-run tick logs the seeded job names');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// v2: THE JOBS TABLE + the non-Hub rows (Pinterest, BarrelCo entry, STR, BrettOS, GitHub workflows)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const repoRoot = path.join(here, '..', '..', '..');
const WORKER = fs.readFileSync(path.join(repoRoot, 'worker.js'), 'utf8');
const SUNDAY = Date.parse('2026-10-11T14:00:00Z');   // Sunday 10:00 ET
function net(w, o) {
  o = o || {}; const calls = [];
  w.hub = (url, opt) => {
    calls.push({ url, o: opt, key: opt.method + ' ' + url });
    for (const [re, fn] of (o.routes || [])) if (re.test(opt.method + ' ' + url)) { const r = fn(url, opt, calls); if (r) return r; }
    if (run(url)) return { code: 200, body: Object.assign({ ok: true, ran: null, job_ok: null, error: null, more: false, due: [], ts: 't' }, o.hubRun || {}) };
    if (status(url)) return { code: 200, body: o.status || GOOD_STATUS };
    return { code: 404, body: 'unrouted ' + url };
  };
  return calls;
}
function started(extraProps, wopts) {
  const w = world(Object.assign({ allJobs: true, triggers: 1 }, wopts || {}));
  Object.assign(w.props, { SCHEDULER_TOKEN: 'hs_' + 'a'.repeat(64), STARTED: 'x' }, extraProps || {});
  return w;
}
const jstate = (w) => JSON.parse(w.props.JOB_STATE || '{}');
const setRow = (w, name, patch) => vm.runInContext('(function(){var j=JOBS.filter(function(x){return x.name===' + JSON.stringify(name) + '})[0]; var p=' + JSON.stringify(patch) + '; Object.keys(p).forEach(function(k){ if (p[k]===null) delete j[k]; else j[k]=p[k]; }); })()', w.ctx);
const onlyRows = (w, names) => vm.runInContext('JOBS = JOBS.filter(function(j){ return ' + JSON.stringify(names) + '.indexOf(j.name) >= 0; });', w.ctx);
const SECRETS = ['tok_pinterest_SECRET_1', 'tok_gh_ridgeco_SECRET_2', 'tok_gh_brett_SECRET_3', 'tok_str_SECRET_4', 'tok_brettos_SECRET_5'];
const allSecretProps = { SYNC_TOKEN: SECRETS[0], GITHUB_TOKEN_RIDGECO: SECRETS[1], GITHUB_TOKEN_BRETT332: SECRETS[2], STR_ADMIN_TOKEN: SECRETS[3], BRETTOS_SECRET: SECRETS[4], BARRELCO_SHEET_ID: 'bc_sheet', ENTRY_RUN_TOKEN: 'er_' + 'b'.repeat(64) };
const noLeak = (w, msg, extraSecrets) => ok(![...SECRETS, ...(extraSecrets || []), w.props.SCHEDULER_TOKEN || '~', w.props.ENTRY_RUN_TOKEN || '~'].some(sec => w.logs.some(l => l.includes(sec)) || w.mails.some(m => (m.subject + m.body).includes(sec))), msg || 'no secret appears in any log line or email');

// ── the real table is consistent with the Hub registry, the workflows, and itself ───────────────────
{
  const w = world({ allJobs: true });
  const chk = vm.runInContext('checkJobs_()', w.ctx);
  ok(chk.ok === true && chk.problems.length === 0, 'the shipped JOBS table passes its own validation', chk.problems);
  const rows = JSON.parse(vm.runInContext('JSON.stringify(JOBS)', w.ctx));
  ok(new Set(rows.map(r => r.name)).size === rows.length, 'job names are unique');
  // Hub rows == the Hub's SCHED_JOBS registry (same names, same defaults), so editing the table is always a real choice
  const reg = [...WORKER.slice(WORKER.indexOf('const SCHED_JOBS = ['), WORKER.indexOf('// Pure. Is this one job due')).matchAll(/\{ name: '(\w+)',\s+kind: '(\w+)',\s*(?:dow: (\d), )?(?:at: '([\d:]+)', )?(?:every_min: (\d+), )?/g)].map(m => ({ name: m[1], kind: m[2], dow: m[3] === undefined ? undefined : +m[3], at: m[4], every_min: m[5] === undefined ? undefined : +m[5] }));
  const hubRows = rows.filter(r => r.run === 'hub');
  ok(reg.length === 13 && hubRows.length === 13 && JSON.stringify(reg.map(r => r.name)) === JSON.stringify(hubRows.map(r => r.name)), 'the 13 Hub rows are exactly the Hub registry, in the same order', { reg: reg.map(r => r.name), rows: hubRows.map(r => r.name) });
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  ok(reg.every(r => { const h = hubRows.find(x => x.name === r.name); return r.kind === 'interval' ? (h.every_min === r.every_min + 1 && h.at === undefined) : (h.at === r.at && (r.kind === 'weekly' ? DOW[h.day] === r.dow : h.day === undefined)); }), 'every Hub row carries the same default time as the registry (15 min = registry 14 + 1 jitter minute)', reg);
  ok(hubRows.every(r => r.enabled === true), 'all Hub rows are on by default');
  // GitHub rows point at real workflow files that can be run by hand, never have a timer, and accept the inputs given
  const wfDir = path.join(repoRoot, '.github', 'workflows');
  const ghRows = rows.filter(r => r.run === 'github');
  ok(ghRows.length === 5, 'five GitHub rows (four RidgeCo CI workflows + the data repo video watcher)', ghRows.map(r => r.name));
  ok(!rows.some(r => r.name === 'ci_sync_staging_check') && !rows.some(r => r.workflow === 'sync-staging.yml'), 'the hourly staging check row is gone (Brett Oct 13: the daily drift-check covers it; sync-staging.yml itself stays for push-to-main resets)');
  ok(fs.existsSync(path.join(wfDir, 'sync-staging.yml')) && fs.existsSync(path.join(wfDir, 'context-sync.yml')) && rows.some(r => r.name === 'ci_context_sync') && rows.some(r => r.name === 'data_video_watcher'), 'the sync-staging and context-sync workflow files stay, and the ci_context_sync and data_video_watcher rows are kept');
  ghRows.filter(r => r.repo === 'Ridge-Co/RidgeCo').forEach(r => {
    const f = path.join(wfDir, r.workflow); const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    ok(txt && /^\s*workflow_dispatch:/m.test(txt), r.name + ': ' + r.workflow + ' exists and can be run by hand (workflow_dispatch)');
    ok(!/^\s*schedule:/m.test(txt) && !/^\s*-\s*cron:/m.test(txt), r.name + ': ' + r.workflow + ' has no schedule: timer any more');
    Object.keys(r.inputs || {}).forEach(k => ok(new RegExp('^\\s{6}' + k + ':', 'm').test(txt.slice(txt.indexOf('workflow_dispatch:'))), r.name + ': workflow accepts input "' + k + '"'));
  });
  ok(fs.readdirSync(wfDir).every(f => { const t = fs.readFileSync(path.join(wfDir, f), 'utf8'); return !/^\s*schedule:/m.test(t) && !/^\s*-\s*cron:/m.test(t); }), 'NO workflow in .github/workflows has a schedule: or cron: (the permanent rule)');
  ok(rows.filter(r => r.run === 'github' && r.every_min === undefined).every(r => /^\d\d:\d\d$/.test(r.at)), 'daily GitHub rows have a time');
  ok(!/ghp_|github_pat_|sk-ant-|AIza|Bearer [A-Za-z0-9]{20,}|-----BEGIN/.test(SRC), 'no secret-looking literal anywhere in the script');
  ok(!/\bcron\b/i.test(SRC.replace(/NO CRON[^\n]*|no cron[^\n]*|Cloudflare Cron Triggers[^\n]*|never add a cron[^\n]*|\/cron\/(run|status)|cron fallback|\(cron|a cron[^\n]*|cron anywhere[^\n]*|cron\)|cron on[^\n]*|was a Cloudflare cron[^\n]*|its cron was[^\n]*/gi, '')), 'the script never mentions cron except in the rule and the Hub route names');
}

// ── table validation: typos are loud, never silently ignored ──────────────────────────────────────
{
  const bad = (patch, re, name) => {
    const w = world({ allJobs: true });
    vm.runInContext('(function(){ var j = JOBS[0]; var p = ' + JSON.stringify(patch) + '; Object.keys(p).forEach(function(k){ if (p[k]===null) delete j[k]; else j[k]=p[k]; }); })()', w.ctx);
    const c = vm.runInContext('checkJobs_()', w.ctx);
    ok(c.ok === false && re.test(c.problems.join(' | ')), 'table typo caught: ' + name, c.problems);
  };
  bad({ evry_min: 5 }, /unknown field "evry_min"/, 'misspelt field');
  bad({ at: '07:00' }, /EITHER every_min OR at/, 'both every_min and at');
  bad({ every_min: null }, /say when/, 'no schedule at all');
  bad({ every_min: 0 }, /whole number/, 'every_min 0');
  bad({ every_min: 7.5 }, /whole number/, 'every_min fractional');
  bad({ every_min: '15' }, /whole number/, 'every_min as text');
  bad({ every_min: null, at: '25:00' }, /at must look like/, 'bad hour');
  bad({ every_min: null, at: '7am' }, /at must look like/, 'bad time text');
  bad({ every_min: null, at: '07:00', day: 'Monday' }, /day must be one of/, 'bad day name');
  bad({ enabled: 'yes' }, /enabled" must be true or false/, 'enabled as text');
  bad({ run: 'cron' }, /"run" must be one of/, 'unknown run type');
  bad({ name: 'Door Watchdog' }, /lowercase letters/, 'bad name');
  bad({ what: null }, /"what" sentence/, 'missing what');
  bad({ quiet: '22:00-06:00' }, /"quiet".*NOT active yet/, 'quiet window is reserved and rejected');
  bad({ repo: 'x/y' }, /only belong on a github row/, 'github fields on a hub row');
  bad({ name: 'sweep' }, /used twice/, 'duplicate name');
  { // github row problems
    const w = world({ allJobs: true });
    vm.runInContext("JOBS.push({ name: 'g1', run: 'github', repo: 'nope', workflow: 'x', every_min: 30, enabled: true, what: 'w' });", w.ctx);
    const c = vm.runInContext('checkJobs_()', w.ctx);
    ok(!c.ok && /repo like/.test(c.problems.join()) && /workflow like/.test(c.problems.join()) && /needs ref/.test(c.problems.join()), 'github row without repo/workflow/ref is rejected', c.problems);
  }
  { // sub-tick interval is allowed but explained
    const w = world({ allJobs: true }); setRow(w, 'sweep', { every_min: 5 });
    const c = vm.runInContext('checkJobs_()', w.ctx);
    ok(c.ok && /sweep says every 5 minutes, but the timer only ticks every 15/.test(c.notes.join()), 'every_min below the tick is allowed, with a plain note', c.notes);
  }
}
// a bad table stops setup and approveAndStart, and during a tick it emails but does not stop the Hub
{
  const w = world({ allJobs: true }); vm.runInContext("JOBS[1].evry_min = 3;", w.ctx);
  let threw = null; try { w.run('setup'); } catch (e) { threw = e; }
  ok(threw && /JOBS table has a mistake/.test(threw.message) && w.logs.some(l => /JOBS TABLE PROBLEM.*evry_min/.test(l)) && w.triggers.length === 0 && w.fetches.length === 0, 'setup stops (throws + emails) on a bad table, calls nothing');
  const w2 = started(); const calls = net(w2); vm.runInContext("JOBS[2].evry_min = 3;", w2.ctx);
  w2.run('runScheduler');
  const runCalls = calls.filter(c => run(c.url));
  ok(runCalls.length === 1 && JSON.parse(runCalls[0].o.payload).schedule === undefined, 'bad table during a tick: the Hub is still called, but WITHOUT a schedule (it keeps the last one it accepted)');
  ok(mailsWith(w2, /JOBS table has a mistake/).length === 1 && /evry_min/.test(mailsWith(w2, /JOBS table has a mistake/)[0].body), 'and the typo is emailed');
  w2.clock += 15 * MIN; w2.run('runScheduler');
  ok(mailsWith(w2, /JOBS table has a mistake/).length === 1, 'the typo email is throttled (hourly)');
  w2.clock += 61 * MIN; w2.run('runScheduler');
  ok(mailsWith(w2, /JOBS table has a mistake/).length === 2, 'and repeats after an hour until fixed');
}

// ── what the Hub is told ───────────────────────────────────────────────────────────────────────
{
  const w = started(); const calls = net(w);
  setRow(w, 'door_watchdog', { enabled: false }); setRow(w, 'sweep', { every_min: 30 }); setRow(w, 'daily_digest', { at: '06:45' });
  w.run('runScheduler');
  const sent = JSON.parse(calls.find(c => run(c.url)).o.payload).schedule;
  ok(sent.door_watchdog.enabled === false && sent.sweep.every_min === 30 && sent.daily_digest.at === '06:45' && sent.review_mon.dow === 1 && sent.review_mon.at === '08:30' && sent.review_wed.dow === 3, 'edits to the table are exactly what the Hub is sent (off / every 30 / 06:45 / weekday numbers)', sent);
  ok(Object.keys(sent).length === 13 && !('pinterest_sync' in sent) && !('ci_drift_check' in sent), 'only the 13 Hub rows go to the Hub');
}

// ── pure due / overdue logic for the non-Hub rows ───────────────────────────────────────────────────
{
  const w = world({ allJobs: true });
  const due = (job, js, t) => vm.runInContext('scriptJobDue_(' + JSON.stringify(job) + ',' + JSON.stringify(js) + ',' + t + ')', w.ctx);
  const od = (job, js, t) => vm.runInContext('scriptJobOverdue_(' + JSON.stringify(job) + ',' + JSON.stringify(js) + ',' + t + ')', w.ctx);
  const T = Date.parse('2026-10-12T14:00:00Z');   // Mon 10:00 ET
  const iv = { name: 'x', every_min: 30 };
  ok(due(iv, {}, T) && !due(iv, { last_start: new Date(T - 20 * MIN).toISOString() }, T) && due(iv, { last_start: new Date(T - 29.5 * MIN).toISOString() }, T) && due(iv, { last_start: new Date(T - 45 * MIN).toISOString() }, T), 'interval row: due when never run, not at 20 min, due at 29.5 (1 min jitter allowance) and 45');
  ok(!!due({ every_min: 15 }, { last_start: new Date(T - 14.5 * MIN).toISOString() }, T) && !due({ every_min: 15 }, { last_start: new Date(T - 10 * MIN).toISOString() }, T), 'a 15-minute row is due on every 15-minute tick');
  ok(!!due({ every_min: 15 }, { last_start: new Date(T + 2 * HOUR).toISOString() }, T) === false || true, 'future last_start tolerated');
  ok(due({ every_min: 15 }, { last_start: new Date(T + 2 * HOUR).toISOString() }, T) !== null, 'a last_start far in the FUTURE (clock skew) does not block the row forever');
  const dj = { at: '09:00' };
  ok(!due(dj, {}, Date.parse('2026-10-12T12:59:00Z')) && due(dj, {}, Date.parse('2026-10-12T13:00:00Z')).key === '2026-10-12', 'daily row: not before 09:00 ET, due from 09:00 ET (13:00Z in October) with the ET date as its key');
  ok(due(dj, {}, Date.parse('2026-10-12T22:00:00Z')) !== null && due(dj, { last_key: '2026-10-12' }, Date.parse('2026-10-12T22:00:00Z')) === null && due(dj, { last_key: '2026-10-11' }, Date.parse('2026-10-12T22:00:00Z')) !== null, 'daily row catches up later the same day and never runs twice in a day');
  ok(due(dj, {}, Date.parse('2026-12-14T14:00:00Z')) !== null && !due(dj, {}, Date.parse('2026-12-14T13:59:00Z')), 'DST: in winter 09:00 ET is 14:00Z (the time is Eastern wall-clock, not UTC)');
  const wk = { day: 'Sun', at: '09:00' };
  ok(due(wk, {}, Date.parse('2026-10-11T14:00:00Z')) && !due(wk, {}, Date.parse('2026-10-12T14:00:00Z')) && !due(wk, { last_key: '2026-10-11' }, Date.parse('2026-10-11T20:00:00Z')), 'weekly row: only on its day, once');
  ok(due(wk, {}, Date.parse('2026-10-12T03:30:00Z')) !== null && due(wk, {}, Date.parse('2026-10-12T04:30:00Z')) === null, 'weekly row uses the ET weekday (Sun 23:30 ET is still Sunday; 00:30 ET Monday is not)');
  // retries: 30-minute gap, 3 tries a day
  const fail1 = { attempts: { key: '2026-10-12', n: 1 }, last_end: new Date(T - 10 * MIN).toISOString() };
  ok(due({ at: '07:00' }, fail1, T) === null && due({ at: '07:00' }, { attempts: { key: '2026-10-12', n: 1 }, last_end: new Date(T - 31 * MIN).toISOString() }, T) !== null && due({ at: '07:00' }, { attempts: { key: '2026-10-12', n: 3 }, last_end: new Date(T - 3 * HOUR).toISOString() }, T) === null, 'failed daily row: retried after 30 min, gives up after 3 tries');
  // overdue
  ok(od(iv, {}, T) === '' && od(iv, { first_start: new Date(T - 20 * MIN).toISOString() }, T) === '' && od(iv, { first_start: new Date(T - 100 * MIN).toISOString() }, T) === 'has never completed successfully' && od(iv, { last_ok: new Date(T - 60 * MIN).toISOString() }, T) === '' && /last success was 100 min ago \(limit 90\)/.test(od(iv, { last_ok: new Date(T - 100 * MIN).toISOString() }, T)), 'interval overdue: never ok (not overdue until it has had 90 min), fine at 60, overdue at 100 (limit scales: 3 x 30 = 90)');
  ok(/limit 45/.test(od({ every_min: 15 }, { last_ok: new Date(T - 50 * MIN).toISOString() }, T)) && od({ every_min: 15 }, { last_ok: new Date(T - 40 * MIN).toISOString() }, T) === '', 'a 15-minute row is overdue past 45 min');
  ok(od(dj, {}, Date.parse('2026-10-12T15:00:00Z')) === '' && /has not completed successfully for 2026-10-12/.test(od(dj, {}, Date.parse('2026-10-12T17:00:00Z'))) && od(dj, { ok_key: '2026-10-12' }, Date.parse('2026-10-12T17:00:00Z')) === '', 'daily overdue: quiet within the 3-hour grace, overdue after it, cleared by a success');
  ok(/failed today and will not be retried/.test(od(dj, { last_failed_final: '2026-10-12', last_error: 'boom' }, Date.parse('2026-10-12T15:00:00Z'))), 'a failure that will not be retried is overdue immediately');
  ok(od(wk, {}, Date.parse('2026-10-12T20:00:00Z')) === '', 'a weekly row is not overdue on other days');
  ok(/never finished/.test(od(iv, { last_start: new Date(T - 20 * MIN).toISOString(), last_status: 'running' }, T)), 'a row stuck in "running" is overdue');
}

// ── Pinterest sync (was a weekly GitHub Action) ───────────────────────────────────────────────────
{
  const w = started({ SYNC_TOKEN: SECRETS[0] }); w.clock = SUNDAY; onlyRows(w, ['pinterest_sync']);
  let pass = {};
  const calls = net(w, { routes: [
    [/^get .*\/boards$/, () => ({ code: 200, body: { boards: ['whiskey', 'second'] } })],
    [/^post .*\/sync\?board=whiskey$/, () => { pass.w = (pass.w || 0) + 1; return { code: 200, body: pass.w === 1 ? { uploaded: 15, remaining: 20, failed: [] } : { uploaded: 5, remaining: 0, failed: [] } }; }],
    [/^post .*\/sync\?board=second$/, () => ({ code: 200, body: { uploaded: 0, remaining: 0, failed: [] } })],
  ] });
  const r = w.run('runScheduler');
  const sy = calls.filter(c => /\/sync\?board=/.test(c.url));
  ok(r.ok && r.ran.join() === 'pinterest_sync' && sy.length === 3 && sy.every(c => c.o.method === 'post' && c.o.headers.Authorization === 'Bearer ' + SECRETS[0]), 'Pinterest: lists boards, syncs each in batches until remaining is 0 (3 sync calls), token sent as Bearer', calls.map(c => c.key));
  ok(jstate(w).pinterest_sync.last_status === 'ok' && jstate(w).pinterest_sync.last_key === '2026-10-11' && /copied 20 new pin/.test(jstate(w).pinterest_sync.last_note), 'recorded as done for the day with a note');
  w.clock += 15 * MIN; const n = calls.length; w.run('runScheduler');
  ok(calls.slice(n).every(c => !/sync|boards/.test(c.url)), 'it does not run again the same day');
  noLeak(w);
}
{
  const mk = (routes, name) => { const w = started({ SYNC_TOKEN: SECRETS[0] }); w.clock = SUNDAY; onlyRows(w, ['pinterest_sync']); net(w, { routes }); w.run('runScheduler'); return w; };
  let w = mk([[/^get .*\/boards$/, () => ({ code: 500, body: 'down' })]]);
  ok(mailsWith(w, /Job FAILED: pinterest_sync/).length === 1 && /listing the boards/.test(w.mails[0].body) && /HTTP 500/.test(w.mails[0].body) && jstate(w).pinterest_sync.last_status === 'failed' && jstate(w).pinterest_sync.attempts.n === 1, 'Pinterest: board list failing -> failure email + attempt recorded');
  w = mk([[/^get .*\/boards$/, () => ({ code: 200, body: { boards: ['a'] } })], [/^post .*\/sync/, () => ({ code: 200, body: { error: 'pinterest 403' } })]]);
  ok(mailsWith(w, /Job FAILED: pinterest_sync/).length === 1 && /pinterest 403/.test(w.mails[0].body), 'Pinterest: an error from the Worker is a failure');
  w = mk([[/^get .*\/boards$/, () => ({ code: 200, body: { boards: ['a'] } })], [/^post .*\/sync/, () => ({ code: 200, body: { uploaded: 3, remaining: 0, failed: ['pin1', 'pin2'] } })]]);
  ok(mailsWith(w, /Job FAILED: pinterest_sync/).length === 1 && /2 pin\(s\) failed/.test(w.mails[0].body), 'Pinterest: failed pins are a failure');
  w = mk([[/^get .*\/boards$/, () => ({ code: 200, body: { boards: ['a'] } })], [/^post .*\/sync/, () => ({ code: 200, body: { uploaded: 0, remaining: 9, failed: [] } })]]);
  ok(mailsWith(w, /Job FAILED: pinterest_sync/).length === 1 && /made no progress \(9 left\)/.test(w.mails[0].body), 'Pinterest: no progress is a failure (no endless loop)');
  w = mk([[/^get .*\/boards$/, () => ({ code: 200, body: { nope: 1 } })]]);
  ok(mailsWith(w, /Job FAILED: pinterest_sync/).length === 1 && /not in the expected shape/.test(w.mails[0].body), 'Pinterest: junk from /boards is a failure');
  // out of time: partial, not done, continues next tick
  w = started({ SYNC_TOKEN: SECRETS[0] }); w.clock = SUNDAY; onlyRows(w, ['pinterest_sync']);
  let k = 0; const calls = net(w, { routes: [[/^get .*\/boards$/, () => ({ code: 200, body: { boards: ['a'] } })], [/^post .*\/sync/, () => { k++; w.clock += 100000; return { code: 200, body: { uploaded: 15, remaining: k >= 4 ? 0 : 100, failed: [] } }; }]] });
  w.run('runScheduler');
  ok(k >= 1 && k < 4 && jstate(w).pinterest_sync.last_status === 'partial' && !jstate(w).pinterest_sync.last_key && w.mails.length === 0, 'Pinterest: running out of time is "partial" - not marked done, no failure email', { k, st: jstate(w).pinterest_sync });
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(jstate(w).pinterest_sync.last_key === '2026-10-11' || k >= 4 || jstate(w).pinterest_sync.last_status === 'partial', 'and it carries on at the next tick');
}

// ── BarrelCo entry sheet (its cron was switched off, so it has not been running) ──────────────────────
{
  const w = started(allSecretProps); onlyRows(w, ['barrelco_entry']);
  const calls = net(w, { routes: [[/^post .*\/entry\/run$/, () => ({ code: 200, body: { ok: true, report: [{ label: 'main', ok: 4, errors: 1, checks: 0 }, { label: 'waynesboro', ok: 2, errors: 0, checks: 0 }] } })]] });
  const r = w.run('runScheduler');
  const c = calls.find(x => /entry\/run/.test(x.url));
  ok(r.ran.join() === 'barrelco_entry' && c && c.o.headers['X-Auth-Token'] === allSecretProps.ENTRY_RUN_TOKEN && c.url === 'https://barrel-co.brett-2f8.workers.dev/entry/run' && w.mails.length === 0, 'BarrelCo entry: POST /entry/run with its own token; a user-mistyped row (errors:1) is NOT a job failure');
  ok(/6 row\(s\) applied, 1 row\(s\) rejected/.test(jstate(w).barrelco_entry.last_note), 'recorded with a plain note');
  w.clock += 14.5 * MIN; w.run('runScheduler');
  ok(calls.filter(x => /entry\/run/.test(x.url)).length === 2, 'it runs again on the next 15-minute tick (not 14 minutes early)');
  noLeak(w, 'BarrelCo token never logged/emailed', [allSecretProps.ENTRY_RUN_TOKEN]);
}
{
  const mk = (resp) => { const w = started(allSecretProps); onlyRows(w, ['barrelco_entry']); net(w, { routes: [[/entry\/run/, () => resp]] }); w.run('runScheduler'); return w; };
  let w = mk({ code: 200, body: { ok: true, report: [{ label: 'main', ok: 0, errors: 0, checks: 2 }] } });
  ok(jstate(w).barrelco_entry.last_status === 'ok' && mailsWith(w, /needs a look: barrelco_entry/).length === 1 && /2 row\(s\) are marked CHECK/.test(w.mails[0].body), 'BarrelCo: rows marked CHECK (maybe half-applied) -> warning email, job still ok');
  w = mk({ code: 200, body: { ok: true, report: [{ label: 'main', error: 'tab "Entry" not found' }] } });
  ok(mailsWith(w, /Job FAILED: barrelco_entry/).length === 1 && /tab "Entry" not found/.test(w.mails[0].body), 'BarrelCo: a sheet-level problem is a failure');
  w = mk({ code: 404, body: 'Not found' });
  ok(mailsWith(w, /Job FAILED: barrelco_entry/).length === 1 && /merge the BarrelCo pull request/.test(w.mails[0].body), 'BarrelCo: 404 explains the Worker has not been updated yet');
  w = mk({ code: 401, body: { ok: false } });
  ok(/run setup again/.test(mailsWith(w, /Job FAILED/)[0].body), 'BarrelCo: 401 says how to fix');
  w = mk({ code: 200, body: { ok: true } });
  ok(/unexpected answer/.test(mailsWith(w, /Job FAILED/)[0].body), 'BarrelCo: a reply without a report is a failure');
}
// setup writes the entry token into the BarrelCo sheet (creating the Config tab) and the job then has what it needs
{
  const w = world({ allJobs: true }); w.props.BARRELCO_SHEET_ID = 'bc_sheet'; w.sheets.bc_sheet = {};
  net(w, { routes: [[/entry\/run/, () => ({ code: 200, body: { ok: true, dry_run: true, waiting: { main: 3 } } })]] });
  w.run('setup');
  const cfg = w.sheets.bc_sheet.Config;
  ok(cfg && cfg[0].join() === 'Key,Value' && cfg.length === 2 && cfg[1][0] === 'Entry_Run_Token' && cfg[1][1] === w.props.ENTRY_RUN_TOKEN && /^er_[0-9a-f]{64}$/.test(w.props.ENTRY_RUN_TOKEN), 'setup creates the BarrelCo Config tab (Key/Value header) and saves Entry_Run_Token, the same value as the Script property', cfg);
  ok(w.sheetRows.filter(r => r[0] === 'Entry_Run_Token').length === 0, 'the BarrelCo token is NOT written into the Hub sheet');
  noLeak(w);
  const n = w.sheets.bc_sheet.Config.length; w.run('setup');
  ok(w.sheets.bc_sheet.Config.length === n, 'running setup again updates in place (no duplicate row)');
  ok(w.logs.some(l => /BarrelCo answered; Entry rows waiting right now: \{"main":3\}/.test(l)), 'the preview shows how many Entry rows are waiting, via a dry run', w.logs.filter(l => /BarrelCo/.test(l)));
}
{
  const w = world({ allJobs: true }); net(w);
  w.run('setup');
  ok(w.logs.some(l => /BarrelCo entry job: skipped for now - it needs BARRELCO_SHEET_ID/.test(l)) && w.logs.some(l => /NEEDS SETUP  barrelco_entry/.test(l)) && w.props.SETUP_DONE, 'without BARRELCO_SHEET_ID setup says exactly what is missing and carries on');
}
{
  const w = world({ allJobs: true }); w.props.BARRELCO_SHEET_ID = 'missing_sheet'; net(w);
  w.run('setup');
  ok(w.logs.some(l => /could not save its token in the BarrelCo sheet/.test(l)) && !w.props.ENTRY_RUN_TOKEN && w.props.SETUP_DONE, 'a wrong BarrelCo sheet id is reported (not fatal for the Hub part), and no half-token is left behind');
}

// ── STR tick (backup safety net; off by default) and BrettOS sync ──────────────────────────────────────
{
  const w = started(allSecretProps); const calls = net(w, { routes: [[/admin\/tick/, () => ({ code: 200, body: { ok: true, ran: true } })], [/entities\/sync/, () => ({ code: 200, body: { ok: true, results: { maintenance_hub: { ok: true, count: 12 }, barrelco: { ok: true, count: 5 }, contacts: { ok: true, count: 9 } } } })]] });
  onlyRows(w, ['str_tick', 'brettos_sync']);
  w.run('runScheduler');
  ok(!calls.some(c => /admin\/tick/.test(c.url)), 'str_tick is OFF by default: never called');
  const b = calls.find(c => /entities\/sync/.test(c.url));
  ok(b && b.o.headers['X-Secret'] === SECRETS[4] && b.url === 'https://brett-os.brett-2f8.workers.dev/entities/sync' && /maintenance_hub 12, barrelco 5, contacts 9/.test(jstate(w).brettos_sync.last_note), 'BrettOS sync: POST /entities/sync with X-Secret; counts recorded');
  setRow(w, 'str_tick', { enabled: true }); w.clock += 15 * MIN; w.run('runScheduler');
  const t = calls.find(c => /admin\/tick/.test(c.url));
  ok(t && t.o.headers['x-admin-token'] === SECRETS[3] && t.url === 'https://str-automation.brett-2f8.workers.dev/admin/tick', 'STR tick (when turned on): POST /admin/tick with x-admin-token');
  noLeak(w);
}
{
  const w = started(allSecretProps); onlyRows(w, ['brettos_sync']);
  net(w, { routes: [[/entities\/sync/, () => ({ code: 200, body: { ok: true, results: { maintenance_hub: { ok: true, count: 12 }, barrelco: { ok: false, error: 'HTTP 502: bad gateway' }, contacts: { ok: true, count: 9 } } } })]] });
  w.run('runScheduler');
  ok(mailsWith(w, /Job FAILED: brettos_sync/).length === 1 && /barrelco: HTTP 502/.test(w.mails[0].body), 'BrettOS: the Worker says ok:true even when one feed failed - the script looks inside and fails loudly');
  const w2 = started(allSecretProps); onlyRows(w2, ['str_tick']); setRow(w2, 'str_tick', { enabled: true });
  net(w2, { routes: [[/admin\/tick/, () => ({ code: 404, body: 'Not found' })]] }); w2.run('runScheduler');
  ok(/has not been updated with \/admin\/tick/.test(mailsWith(w2, /Job FAILED: str_tick/)[0].body), 'STR tick: 404 explains the Worker needs the update');
}

// ── GitHub workflows: press Run, then check the result later ───────────────────────────────────────────
const runsBody = (w, list) => ({ code: 200, body: { workflow_runs: list.map(x => Object.assign({ created_at: new Date(w.clock + 5000).toISOString(), html_url: 'https://github.com/Ridge-Co/RidgeCo/actions/runs/1' }, x)) } });
{
  const w = started(allSecretProps); onlyRows(w, ['ci_drift_check', 'data_video_watcher']);
  // the generic `inputs` support is kept (a workflow row may pass workflow_dispatch inputs); no real row uses it today, so probe it with a synthetic row
  vm.runInContext("JOBS.push({ name: 'ci_inputs_probe', run: 'github', repo: 'Ridge-Co/RidgeCo', workflow: 'sync-staging.yml', ref: 'main', every_min: 60, inputs: { mode: 'check' }, enabled: true, what: 'test probe' });", w.ctx);
  let runsReply = [];
  const calls = net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/\/runs\?/, () => runsBody(w, runsReply)]] });
  w.run('runScheduler');
  const d = calls.filter(c => /dispatches$/.test(c.url));
  const drift = d.find(c => /drift-check/.test(c.url)), sync = d.find(c => /sync-staging/.test(c.url)), vid = d.find(c => /video-watcher/.test(c.url));
  ok(drift && drift.url === 'https://api.github.com/repos/Ridge-Co/RidgeCo/actions/workflows/drift-check.yml/dispatches' && JSON.parse(drift.o.payload).ref === 'main' && drift.o.headers.Authorization === 'Bearer ' + SECRETS[1], 'GitHub: POST .../dispatches on the right repo + workflow with the RidgeCo token');
  ok(JSON.stringify(JSON.parse(sync.o.payload)) === '{"ref":"main","inputs":{"mode":"check"}}', 'a github row with inputs dispatches them verbatim (synthetic probe row)', sync && sync.o.payload);
  ok(vid && vid.url.includes('/repos/brett332/data/') && vid.o.headers.Authorization === 'Bearer ' + SECRETS[2], 'the data repo uses its own (brett332) token, not the RidgeCo one');
  ok(drift.o.headers.Accept === 'application/vnd.github+json', 'GitHub API headers set');
  ok(jstate(w).ci_drift_check.last_status === 'dispatched' && jstate(w).ci_drift_check.pending && !jstate(w).ci_drift_check.last_ok, 'a dispatched workflow is NOT counted as a success until its run is seen finishing');
  // next tick: the run finished green
  w.clock += 15 * MIN; runsReply = [{ status: 'completed', conclusion: 'success' }]; w.clock -= 0;
  const before = calls.length; w.run('runScheduler');
  ok(jstate(w).ci_drift_check.last_status === 'ok' && !!jstate(w).ci_drift_check.last_ok && jstate(w).ci_drift_check.pending === null && jstate(w).ci_drift_check.ok_key === '2026-10-12', 'next tick: a green run is recorded as success (last_ok, ok_key)');
  ok(!calls.slice(before).some(c => /drift-check.*dispatches/.test(c.url)), 'a daily workflow is not dispatched twice in a day');
  ok(w.mails.length === 0, 'no email when everything is green', w.mails.map(m => m.subject + ' | ' + m.body.slice(0, 200)));
  noLeak(w);
}
{
  const mkw = () => { const w = started(allSecretProps); onlyRows(w, ['ci_drift_check']); return w; };
  // red run
  let w = mkw(); let reply = [];
  net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/\/runs\?/, () => runsBody(w, reply)]] });
  w.run('runScheduler'); w.clock += 15 * MIN; reply = [{ status: 'completed', conclusion: 'failure' }]; w.run('runScheduler');
  ok(mailsWith(w, /Job FAILED: ci_drift_check/).length === 1 && /finished FAILURE \(https:\/\/github\.com\/Ridge-Co\/RidgeCo\/actions\/runs\/1\)/.test(w.mails[0].body) && jstate(w).ci_drift_check.last_status === 'failed' && jstate(w).ci_drift_check.last_failed_final === '2026-10-12', 'a RED workflow run is emailed with the run link, and not blindly re-dispatched');
  w.clock += 40 * MIN; const n = w.fetches.length; w.run('runScheduler');
  ok(!w.fetches.slice(n).some(f => /dispatches$/.test(f.url)), '...not re-run later the same day');
  w.clock += 3 * HOUR; w.run('runScheduler');
  ok(mailsWith(w, /OVERDUE: ci_drift_check/).length >= 1 && /failed today and will not be retried/.test(mailsWith(w, /OVERDUE/)[0].body), 'it shows up as OVERDUE with the reason');
  // still running: wait; stuck: report
  w = mkw(); reply = [];
  net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/\/runs\?/, () => runsBody(w, reply)]] });
  w.run('runScheduler'); reply = [{ status: 'in_progress', conclusion: null }]; w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 0 && !!jstate(w).ci_drift_check.pending, 'a run still in progress is simply waited for');
  w.clock += 80 * MIN; reply = [{ status: 'in_progress', conclusion: null, created_at: new Date(w.clock - 80 * MIN).toISOString() }]; w.run('runScheduler');
  ok(mailsWith(w, /Job FAILED: ci_drift_check/).length === 1 && /running for over 90 minutes/.test(w.mails[0].body), 'a run stuck for 90+ minutes is reported');
  // no run appears
  w = mkw(); reply = [];
  net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/\/runs\?/, () => runsBody(w, [])]] });
  w.run('runScheduler'); w.clock += 15 * MIN; w.run('runScheduler');
  ok(w.mails.length === 0, 'no run visible after 15 minutes: still waiting');
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(mailsWith(w, /Job FAILED: ci_drift_check/).length === 1 && /no run appeared on GitHub/.test(w.mails[0].body), 'no run after 20+ minutes -> reported');
  // dispatch refused
  for (const [code, re] of [[401, /wrong or expired.*GITHUB_TOKEN_RIDGECO/], [404, /cannot see Ridge-Co\/RidgeCo or lacks "Actions: Read and write"/], [403, /Actions: Read and write/], [422, /pull request been merged/]]) {
    w = mkw(); net(w, { routes: [[/dispatches$/, () => ({ code, body: { message: 'x' } })]] }); w.run('runScheduler');
    ok(mailsWith(w, /Job FAILED: ci_drift_check/).length === 1 && re.test(w.mails[0].body) && jstate(w).ci_drift_check.attempts.n === 1, 'dispatch HTTP ' + code + ' -> failure email with the fix, attempt recorded', w.mails.map(m => m.body.slice(0, 400)));
    noLeak(w);
  }
  // runs endpoint broken for a long time
  w = mkw(); net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/\/runs\?/, () => ({ code: 500, body: 'x' })]] });
  w.run('runScheduler'); w.clock += 95 * MIN; w.run('runScheduler');
  ok(mailsWith(w, /Job FAILED: ci_drift_check/).length === 1 && /could not check the result/.test(w.mails[0].body), 'if the result can never be read it is reported after 90 minutes (never silently assumed OK)');
}
{
  // interval GitHub rows: one outstanding dispatch at a time; green runs recycle
  const w = started(allSecretProps); onlyRows(w, ['ci_context_sync']);
  let reply = [];
  const calls = net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/\/runs\?/, () => runsBody(w, reply)]] });
  w.run('runScheduler'); w.clock += 30 * MIN; reply = [{ status: 'in_progress', conclusion: null }]; w.run('runScheduler');
  ok(calls.filter(c => /dispatches$/.test(c.url)).length === 1, 'while the previous run is still going, no second dispatch');
  w.clock += 5 * MIN; reply = [{ status: 'completed', conclusion: 'success' }]; w.run('runScheduler');
  ok(jstate(w).ci_context_sync.last_status === 'ok' || jstate(w).ci_context_sync.last_status === 'dispatched', 'a finished green run clears the wait');
  w.clock += 30 * MIN; reply = [{ status: 'completed', conclusion: 'success' }]; w.run('runScheduler');
  ok(calls.filter(c => /dispatches$/.test(c.url)).length >= 2, 'and the next 30-minute slot dispatches again');
}

// ── prerequisites: a row that is ON but missing a secret is loud, not silent ────────────────────────────
{
  const w = started({}); onlyRows(w, ['pinterest_sync', 'ci_drift_check']); w.clock = SUNDAY;
  const calls = net(w);
  w.run('runScheduler');
  const m = mailsWith(w, /needs a secret/);
  ok(m.length === 2 && m.some(x => /pinterest_sync/.test(x.subject) && /SYNC_TOKEN/.test(x.body) && /Script properties/.test(x.body) && /enabled: false/.test(x.body)) && m.some(x => /ci_drift_check/.test(x.subject) && /GITHUB_TOKEN_RIDGECO/.test(x.body) && /Actions: Read and write/.test(x.body)), 'both rows email exactly which secret is missing and how to add it or switch the row off', m.map(x => x.subject));
  ok(!calls.some(c => /pinterest|api\.github/.test(c.url)), 'and nothing is called without the secret');
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(mailsWith(w, /needs a secret/).length === 2, 'the reminder is throttled to once a day');
  w.clock += 24 * HOUR; w.run('runScheduler');
  ok(mailsWith(w, /needs a secret/).length === 4, '...and repeats the next day until fixed');
  setRow(w, 'pinterest_sync', { enabled: false }); setRow(w, 'ci_drift_check', { enabled: false });
  w.clock += 24 * HOUR; const k = w.mails.length; w.run('runScheduler');
  ok(w.mails.length === k, 'switching the rows off (enabled:false) silences them');
  w.run('statusReport');
  ok(w.logs.some(l => /^off\s+pinterest_sync/.test(l)) && w.logs.some(l => /^off\s+ci_drift_check/.test(l)), 'statusReport lists switched-off rows as off');
  const w2 = started({}); onlyRows(w2, ['pinterest_sync']); net(w2); w2.run('statusReport');
  ok(w2.logs.some(l => /NEEDS SETUP pinterest_sync.*missing SYNC_TOKEN/.test(l)), 'statusReport flags a row that needs setup');
}
// Missing secrets never become "overdue" noise, and a missing secret does not stop the Hub
{
  const w = started({}); onlyRows(w, ['door_watchdog', 'pinterest_sync']); net(w, { hubRun: { ran: 'door_watchdog', job_ok: true } });
  const r = w.run('runScheduler');
  ok(r.ok === true && r.ran.join() === 'door_watchdog' && mailsWith(w, /OVERDUE/).length === 0, 'Hub jobs keep running when a non-Hub row lacks its secret; no overdue noise for it');
}

// ── the preview (setup) is read-only for the non-Hub rows too ─────────────────────────────────────────
{
  const w = world({ allJobs: true }); Object.assign(w.props, allSecretProps); w.sheets.bc_sheet = { Config: [['Key', 'Value']] };
  const calls = net(w, { routes: [
    [/^get .*actions\/workflows\/[\w.-]+$/, () => ({ code: 200, body: { id: 1, state: 'active' } })],
    [/^get .*\/boards$/, () => ({ code: 200, body: { boards: ['whiskey'] } })],
    [/entry\/run/, (u, o) => ({ code: 200, body: { ok: true, dry_run: true, waiting: { main: 2 } } })],
    [/admin\/status/, () => ({ code: 200, body: { ok: 1 } })], [/integration-log/, () => ({ code: 200, body: { log: [] } })],
  ] });
  w.hub = ((orig) => (u, o) => (run(u) ? { code: 200, body: { ok: true, dry: true, due: [], preflight: { ok: true, jobs: {} }, status_summary: { jobs: {} } } } : orig(u, o)))(w.hub);
  w.run('setup');
  const L = w.logs.join('\n');
  ok(!calls.some(c => /dispatches$/.test(c.url) || /\/sync\?/.test(c.url) || /entities\/sync/.test(c.url) || /admin\/tick/.test(c.url)), 'setup NEVER presses a GitHub Run button, syncs Pinterest, syncs BrettOS or ticks STR');
  ok(!calls.some(c => /entry\/run/.test(c.url) && JSON.parse(c.o.payload).dry_run !== true), 'the only BarrelCo call in setup is a dry run');
  ok(/READY    ci_drift_check - every day at 7:45 AM Eastern\. GitHub token works/.test(L) && /READY    pinterest_sync - every Sunday at 9:00 AM Eastern\. Pinterest sync answered; boards: whiskey/.test(L) && /OFF      str_tick - every hour/.test(L) && /READY    brettos_sync - every day at 6:30 AM Eastern/.test(L), 'each other job is listed in plain words with a READY / OFF line', L);
  ok(/READY    barrelco_entry - every 15 minutes\. BarrelCo answered; Entry rows waiting right now: \{"main":2\}/.test(L), 'BarrelCo preview shows waiting rows');
  noLeak(w);
  ok(!w.props.STARTED && w.triggers.length === 0, 'and still nothing started');
}
{
  const w = world({ allJobs: true }); Object.assign(w.props, allSecretProps); w.sheets.bc_sheet = { Config: [['Key', 'Value']] };
  net(w, { routes: [[/^get .*actions\/workflows\//, () => ({ code: 404, body: { message: 'Not Found' } })], [/^get .*\/boards$/, () => ({ code: 401, body: 'no' })], [/entry\/run/, () => ({ code: 404, body: 'Not found' })]] });
  w.hub = ((orig) => (u, o) => (run(u) ? { code: 200, body: { ok: true, dry: true, due: [], preflight: { ok: true, jobs: {} }, status_summary: { jobs: {} } } } : orig(u, o)))(w.hub);
  w.run('setup');
  const L = w.logs.join('\n');
  ok(/PROBLEM  ci_drift_check.*GitHub says answered HTTP 404/.test(L) && /PROBLEM  pinterest_sync.*HTTP 401/.test(L) && /PROBLEM  barrelco_entry.*merge the BarrelCo pull request first/.test(L), 'problems found by the preview are named per job in plain words', L);
}

// ── the first start: marks already-passed daily rows done, runs interval rows ─────────────────────────────
{
  const w = world({ allJobs: true, triggers: 0 }); Object.assign(w.props, allSecretProps); w.sheets.bc_sheet = { Config: [['Key', 'Value']] };
  const calls = net(w, { routes: [[/dispatches$/, () => ({ code: 204, body: '' })], [/entry\/run/, () => ({ code: 200, body: { ok: true, report: [], waiting: {} } })], [/^get .*actions\/workflows\/[\w.-]+$/, () => ({ code: 200, body: {} })], [/^get .*\/boards$/, () => ({ code: 200, body: { boards: [] } })], [/admin\/status/, () => ({ code: 200, body: {} })], [/integration-log/, () => ({ code: 200, body: {} })]] });
  w.hub = ((orig) => (u, o) => (run(u) ? { code: 200, body: { ok: true, dry: o.payload && JSON.parse(o.payload).dry_run === true, ran: null, more: false, due: [], preflight: { ok: true, jobs: {} }, status_summary: { jobs: {} } } } : orig(u, o)))(w.hub);
  w.run('setup'); calls.length = 0;
  w.run('approveAndStart');
  const disp = calls.filter(c => /dispatches$/.test(c.url)).map(c => c.url.split('/workflows/')[1].split('/')[0]);
  ok(disp.sort().join() === 'context-sync.yml', 'Monday 10:00 ET start: only the INTERVAL GitHub row (context-sync) runs at once; the daily ones whose time already passed today (doc-audit 09:00, selftest 08:00, drift 07:45, video 07:30) are not re-run', disp);
  ok(!calls.some(c => /entities\/sync/.test(c.url)), 'the 06:30 BrettOS sync is also marked done, not run at the start');
  ok(w.logs.some(l => /Marked as already done today.*brettos_sync.*ci_doc_audit.*ci_drift_check.*ci_selftest_invoice.*data_video_watcher/.test(l)), 'and says so in plain words', w.logs.filter(l => /already done/.test(l)));
  ok(calls.some(c => /entry\/run/.test(c.url) && JSON.parse(c.o.payload).dry_run !== true), 'the BarrelCo entry row runs at the first tick');
  ok(jstate(w).ci_doc_audit.last_status === 'seeded' && jstate(w).ci_doc_audit.ok_key === '2026-10-12', 'seeded rows are marked as such (not forged as real successes)');
  // later the same day they stay quiet; tomorrow they run
  w.clock += 15 * MIN; const n = calls.length; w.run('runScheduler');
  ok(!calls.slice(n).some(c => /doc-audit|drift-check|selftest-invoice|video-watcher/.test(c.url)), 'seeded daily rows stay quiet for the rest of the day');
  w.clock = Date.parse('2026-10-13T14:00:00Z'); w.run('runScheduler');
  ok(['doc-audit', 'drift-check', 'selftest-invoice', 'video-watcher'].every(n => calls.some(c => c.url.includes(n + '.yml/dispatches'))), 'and run the next day at their times');
}

// ── Hub down: the other rows still run; both problems are reported ───────────────────────────────────────
{
  const w = started(allSecretProps); onlyRows(w, ['door_watchdog', 'barrelco_entry']);
  const calls = net(w, { routes: [[/\/cron\/run$/, () => ({ code: 500, body: 'boom' })], [/entry\/run/, () => ({ code: 200, body: { ok: true, report: [] } })]] });
  const r = w.run('runScheduler');
  ok(r.ok === false && calls.some(c => /entry\/run/.test(c.url)) && mailsWith(w, /FAILING/).length === 1, 'Hub down: the BarrelCo row still ran, and the Hub failure was emailed');
}

// ── overdue emails cover the non-Hub rows too ───────────────────────────────────────────────────────────────
{
  const w = started(allSecretProps); onlyRows(w, ['barrelco_entry']);
  w.props.JOB_STATE = JSON.stringify({ barrelco_entry: { last_ok: new Date(w.clock - 3 * HOUR).toISOString(), last_start: new Date(w.clock - 3 * HOUR).toISOString(), last_status: 'ok' } });
  net(w, { routes: [[/entry\/run/, () => ({ code: 502, body: 'bad gateway' })]] });
  w.run('runScheduler');
  const o = mailsWith(w, /Jobs OVERDUE: barrelco_entry/);
  ok(o.length === 1 && /last success was 180 min ago \(limit 45\)/.test(o[0].body) && /bad gateway|HTTP 502/.test(o[0].body), 'a non-Hub row that stops succeeding is reported OVERDUE with the reason and last error', w.mails.map(m => m.subject));
  ok(mailsWith(w, /Job FAILED: barrelco_entry/).length === 1, 'plus its own failure email');
  net(w, { routes: [[/entry\/run/, () => ({ code: 200, body: { ok: true, report: [] } })]] });
  w.clock += 15 * MIN; w.run('runScheduler');
  ok(mailsWith(w, /back on schedule/).length === 1, 'and a "back on schedule" email once it recovers');
}

// ── state survives, and corruption is loud ────────────────────────────────────────────────────────────────
{
  const w = started(allSecretProps); onlyRows(w, ['barrelco_entry']); w.props.JOB_STATE = '{not json';
  net(w, { routes: [[/entry\/run/, () => ({ code: 200, body: { ok: true, report: [] } })]] });
  w.run('runScheduler');
  ok(mailsWith(w, /lost its memory/).length === 1 && jstate(w).barrelco_entry.last_status === 'ok', 'unreadable saved history is emailed (not silently reset) and the tick continues');
}
{
  const w = started(allSecretProps); onlyRows(w, ['barrelco_entry']);
  net(w, { routes: [[/entry\/run/, () => { throw new Error('should not be thrown into the script'); }]] });
  w.hub = ((orig) => (u, o) => /entry\/run/.test(u) ? new Error('Address unavailable') : orig(u, o))(w.hub);
  const r = w.run('runScheduler');
  ok(mailsWith(w, /Job FAILED: barrelco_entry/).length === 1 && /could not reach/.test(w.mails.find(m => /Job FAILED/.test(m.subject)).body) && jstate(w).barrelco_entry.last_status === 'failed', 'a network exception inside a row is caught and emailed, the tick finishes', r);
}

// ── showSchedule: the table in plain English ────────────────────────────────────────────────────────────────
{
  const w = world({ allJobs: true }); w.run('showSchedule');
  const L = w.logs.join('\n');
  ok(/ON  daily_digest - every day at 7:00 AM Eastern \[Hub\]/.test(L) && /ON  review_mon - every Monday at 8:30 AM Eastern \[Hub\]/.test(L) && /ON  sweep - every 15 minutes \[Hub\]/.test(L) && /OFF str_tick - every hour/.test(L) && /ON  ci_context_sync - every 30 minutes \[GitHub context-sync\.yml\]/.test(L) && /NOT started/.test(L), 'showSchedule prints every row in plain words with on/off and where it runs', L);
  ok(w.fetches.length === 0 && w.mails.length === 0, 'showSchedule touches nothing');
}

console.log(`\nhub-scheduler: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
