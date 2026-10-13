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
    mailFails: false, hub: null, uuid: 0, dropSheetWrite: false };
  w.sheetRows = [['Key', 'Value'], ['digest_enabled', 'TRUE']];
  w.setupTriggers = opts.triggers || 0;
  for (let i = 0; i < w.setupTriggers; i++) w.triggers.push(mkTrigger('runScheduler'));
  function mkTrigger(fn) { return { fn, mins: null, getHandlerFunction() { return this.fn; } }; }
  const sheet = {
    getDataRange: () => ({ getValues: () => w.sheetRows.map(r => r.slice()) }),
    appendRow: (r) => { w.sheetRows.push(r.slice()); },
    getLastRow: () => w.sheetRows.length,
    getRange: (r, c) => ({
      setValue: (v) => { if (w.dropSheetWrite) return; while (w.sheetRows[r - 1].length < c) w.sheetRows[r - 1].push(''); w.sheetRows[r - 1][c - 1] = v; },
      getValue: () => w.sheetRows[r - 1][c - 1],
      setNumberFormat: () => {},
    }),
  };
  const ctx = {
    console, JSON, Math, String, Number, Array, Object, parseInt,
    Logger: { log: (m) => w.logs.push(String(m)) },
    Utilities: { getUuid: () => { w.uuid++; const h = (w.uuid * 7919).toString(16).padStart(8, '0'); return `${h}-aaaa-4bbb-8ccc-${h}${h}`.slice(0, 36); }, sleep: () => { w.sleeps++; } },
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
    SpreadsheetApp: { openById: (id) => { w.openedSheet = id; return { getSheetByName: (n) => n === 'Config' ? sheet : null }; }, flush: () => {} },
    UrlFetchApp: { fetch: (url, o) => { w.fetches.push({ url, o }); if (!w.hub) throw new Error('no hub scripted'); const r = w.hub(url, o); if (r instanceof Error) throw r; return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }; } },
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(w.clock); } static now() { return w.clock; } }
  ctx.Date = FakeDate;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
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
  const c = (n) => w.ctx[n] !== undefined ? w.ctx[n] : vm.runInContext(n, w.ctx);
  ok(vm.runInContext('WORKER_URL', w.ctx) === 'https://maintenance-hub.brett-2f8.workers.dev', 'WORKER_URL');
  ok(vm.runInContext('SHEET_ID', w.ctx) === '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4', 'SHEET_ID');
  ok(vm.runInContext('NOTIFY_EMAIL', w.ctx) === 'brett@bmoremanagement.com', 'NOTIFY_EMAIL');
  ok(MANIFEST.timeZone === 'America/New_York' && MANIFEST.runtimeVersion === 'V8', 'manifest tz + V8');
  ok(JSON.stringify(MANIFEST.oauthScopes.slice().sort()) === JSON.stringify(['https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/spreadsheets']), 'manifest scopes are exactly the four needed', MANIFEST.oauthScopes);
  ok(/NO CRON ANYWHERE/.test(SRC) && /SETUP \(once/.test(SRC) && /paste this file over Code\.gs/.test(SRC), 'header carries the no-cron rule and the setup steps');
  ok(!/catch \(\w+\) \{\s*\}/.test(SRC), 'no empty catch blocks');
  void c;
}

// ── setup(): token, Config row, ONE trigger, first tick, never logs the token ───────────────────
{
  const w = world({ triggers: 3 });
  scriptedHub(w, [{ ran: 'door_watchdog', job_ok: true, more: false }]);
  w.run('setup');
  const token = w.props.SCHEDULER_TOKEN;
  ok(/^hs_[0-9a-f]{64}$/.test(token) && token.length >= 24, 'a long random token is generated and stored in Script Properties', token && token.length);
  const rows = w.sheetRows.filter(r => r[0] === 'Scheduler_Token');
  ok(rows.length === 1 && rows[0][1] === token, 'Config row Scheduler_Token appended with the token');
  ok(w.openedSheet === '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4', 'opened the Hub sheet by id');
  ok(w.triggers.length === 1 && w.triggers[0].fn === 'runScheduler' && w.triggers[0].mins === 15, 'exactly ONE everyMinutes(15) trigger (3 old ones removed)', w.triggers.map(t => t.fn + t.mins));
  const f = w.fetches[0];
  ok(f && f.url === 'https://maintenance-hub.brett-2f8.workers.dev/cron/run' && f.o.method === 'post' && f.o.headers['X-Auth-Token'] === token, 'first tick ran immediately: POST /cron/run with X-Auth-Token');
  ok(w.sleeps >= 1, 'waits for the Hub to see the new Config row before the first tick');
  ok(!w.logs.some(l => l.includes(token)) && !w.mails.some(m => (m.subject + m.body).includes(token)), 'the token is never logged or emailed');
  ok(w.logs.some(l => /exactly one/i.test(l)) && w.logs.some(l => /DONE/.test(l)), 'plain-English summary in the log', w.logs);
  // run setup again: update in place, no duplicate row, same token, still one trigger
  w.run('setup');
  ok(w.sheetRows.filter(r => r[0] === 'Scheduler_Token').length === 1 && w.props.SCHEDULER_TOKEN === token && w.triggers.length === 1, 'second setup() updates in place: no duplicate row, token kept, still one trigger');
  // a changed value in the sheet is repaired
  w.sheetRows.find(r => r[0] === 'Scheduler_Token')[1] = 'tampered';
  w.run('setup');
  ok(w.sheetRows.find(r => r[0] === 'Scheduler_Token')[1] === token, 'setup() re-writes a wrong/old value in an existing row');
}
// existing row with padding/whitespace in the key is found, not duplicated
{
  const w = world(); w.sheetRows.push(['  Scheduler_Token ', 'old']);
  scriptedHub(w, [{}]); w.run('setup');
  ok(w.sheetRows.filter(r => String(r[0]).trim() === 'Scheduler_Token').length === 1 && w.sheetRows[w.sheetRows.length - 1][1] === w.props.SCHEDULER_TOKEN, 'existing row found by trimmed key');
}
// verify-after-write failure: throws, emails, installs nothing
{
  const w = world(); w.dropSheetWrite = true; w.sheetRows.push(['Scheduler_Token', 'old']); scriptedHub(w, [{}]);
  let threw = null; try { w.run('setup'); } catch (e) { threw = e; }
  ok(threw && /could not save the scheduler token/.test(threw.message), 'token write that does not read back -> setup throws');
  ok(mailsWith(w, /setup: could not save the scheduler token/).length === 1 && mailsWith(w, /setup/)[0].to === 'brett@bmoremanagement.com', 'and emails Brett');
  ok(w.triggers.length === 0 && w.fetches.length === 0, 'and installs no trigger / runs no tick');
}
// first tick failing during setup is reported honestly, not "DONE"
{
  const w = world(); w.hub = () => ({ code: 401, body: { error: 'Unauthorized' } });
  w.run('setup');
  ok(w.logs.some(l => /FIRST TICK FAILED/.test(l)) && !w.logs.some(l => /^DONE/.test(l)) && w.triggers.length === 1, 'setup says the first tick failed (timer still installed)', w.logs);
  ok(mailsWith(w, /FAILING/).length === 1 && /HTTP 401/.test(mailsWith(w, /FAILING/)[0].body) && /run setup\(\) again/.test(mailsWith(w, /FAILING/)[0].body), 'and a 401 email explains how to fix it');
}

// ── runScheduler(): loop until more=false, status once ──────────────────────────────────────────
function ready(w, queue, statusBody) { w.props.SCHEDULER_TOKEN = 'hs_' + 'a'.repeat(64); w.triggers.push({ fn: 'runScheduler', mins: 15, getHandlerFunction() { return 'runScheduler'; } }); return scriptedHub(w, queue, statusBody); }
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
  const w = world(); scriptedHub(w, [{}]);   // no token yet
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
  ok(w.mails.length === 1 && /Hub job FAILED: sweep/.test(w.mails[0].subject) && /failed to send/.test(w.mails[0].body), 'job_ok:false -> email naming the job and the error');
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
  const w = world({ triggers: 3 }); w.props.SCHEDULER_TOKEN = 'hs_' + 'b'.repeat(64); scriptedHub(w, [{}]);
  w.run('runScheduler');
  ok(w.triggers.length === 1 && mailsWith(w, /had 3 timers/).length === 1, 'duplicate triggers are deleted down to one and Brett is told');
  const w2 = world({ triggers: 1 }); w2.props.SCHEDULER_TOKEN = 'hs_' + 'b'.repeat(64); scriptedHub(w2, [{}]);
  w2.run('runScheduler');
  ok(w2.mails.length === 0, 'a single trigger is left alone, no email');
}
{
  const w = world({ triggers: 1 }); w.props.SCHEDULER_TOKEN = 'hs_x';
  w.ctx.ScriptApp.getProjectTriggers().push({ getHandlerFunction: () => 'somethingElse' });
  w.triggers.push({ fn: 'otherJob', getHandlerFunction() { return this.fn; } });
  w.run('removeScheduler');
  ok(w.triggers.length === 1 && w.triggers[0].fn === 'otherJob', 'removeScheduler deletes only the scheduler trigger(s)');
  ok(w.logs.some(l => /now OFF/.test(l) && /setup\(\) again/.test(l)), 'removeScheduler says what it means and how to turn it back on');
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
  const w = world({ triggers: 1 }); const tok = 'hs_' + 'c'.repeat(64); w.props.SCHEDULER_TOKEN = tok;
  scriptedHub(w, [{}], { ok: true, now: '2026-10-12T14:00:00Z', last_tick: '2026-10-12T13:55:00Z', tick_age_min: 5, overdue: ['sweep'], jobs: { door_watchdog: { expected: 'every 14+ min', last_ok: 't', overdue: false }, sweep: { expected: 'every 14+ min', last_ok: null, overdue: true, overdue_reason: 'has never completed successfully', last_error: 'x' } } });
  w.run('statusReport');
  ok(w.logs.some(l => /OVERDUE sweep/.test(l) && /never completed/.test(l)) && w.logs.some(l => /^ok\s+door_watchdog/.test(l)) && w.logs.some(l => /Timers installed here: 1/.test(l)) && w.logs.some(l => /OVERDUE: sweep/.test(l)), 'statusReport prints a plain-English line per job', w.logs);
  ok(!w.logs.some(l => l.includes(tok)), 'statusReport never prints the token');
  ok(w.mails.length === 0, 'statusReport sends no email');
  const w2 = world(); w2.run('statusReport');
  ok(w2.logs.some(l => /Not set up/.test(l)), 'statusReport before setup says so');
}

console.log(`\nhub-scheduler: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
