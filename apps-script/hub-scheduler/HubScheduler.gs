/**
 * HUB SCHEDULER  (v1.0, Oct 12 2026) — the ONLY clock for the RidgeCo Hub
 * ---------------------------------------------------------------------------------------------
 * PERMANENT RULE (Brett, Oct 12 2026): NO CRON ANYWHERE. Not Cloudflare Cron Triggers (the account
 * is at its trigger cap, so new ones silently never attach — that is why quiet-hours texts were never
 * released), not GitHub Actions `schedule:`. Apps Script time-driven triggers are the only clock.
 * To add a periodic job later, add it to SCHED_JOBS in the Hub's worker.js — never add a cron.
 *
 * What this does: every 15 minutes, runScheduler() tells the Hub "run whatever is due"
 * (POST /cron/run). The Hub runs ONE job per call (each in its own Worker run) and says whether more
 * are due; this script keeps asking until nothing is. The Hub decides WHAT is due (every-15-minute
 * jobs, the daily 7am ET jobs, Monday/Wednesday reports), uses Eastern wall-clock time, and catches
 * up a missed job the next time the script ticks that day. It also refuses to run anything twice,
 * so a second copy of this script (or a double tick) is harmless.
 *
 * NOTHING FAILS SILENTLY — you get an EMAIL (sent from here, independent of the Hub and of Twilio) when:
 *   - the Hub can't be reached / returns an error / returns junk   → immediately, then a reminder at most
 *                                                                     hourly while it persists, then a "RECOVERED" email
 *   - a job reports it failed                                       → once per job per 3 hours
 *   - a job is overdue (didn't run when it should have)             → once per distinct overdue set per 3 hours
 *   - there is more than one scheduler trigger (it deletes the extras and tells you)
 *   - this script itself throws (it emails you, then re-throws so Google's own failure email also fires)
 *
 * SETUP (once, about 3 minutes; sign in as brett@bmoremanagement.com — the Google account that can edit the Hub sheet):
 *   a. script.google.com → New project → paste this file over Code.gs → Save.
 *   b. Project Settings (gear) → tick "Show appsscript.json" → back in Editor, paste the companion
 *      appsscript.json over it → Save.
 *   c. Pick "setup" in the function dropdown → Run → approve the permissions prompt (it needs your
 *      spreadsheet, to send email, and to make its own timer).
 *   d. Read the log: it should say the token was saved, ONE 15-minute timer is installed, and the first
 *      tick ran. That's all — there is nothing to paste into Cloudflare. setup() put the secret
 *      token in the Hub's Config sheet (row "Scheduler_Token") itself.
 *   Other functions you can run from the dropdown any time: statusReport (plain-English status of every
 *   job), runScheduler (tick now), removeScheduler (turns it off — see its note).
 */

// ── Fixed names ───────────────────────────────────────────────────────────────────────────
var WORKER_URL   = 'https://maintenance-hub.brett-2f8.workers.dev';
var SHEET_ID     = '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4';
var NOTIFY_EMAIL = 'brett@bmoremanagement.com';
var CONFIG_TAB   = 'Config';
var TOKEN_KEY    = 'Scheduler_Token';
var HANDLER      = 'runScheduler';
var MAX_CALLS    = 15;                     // one job per call; the Hub has 13 jobs, so a tick can finish a full catch-up
var MAX_RUN_MS   = 4.5 * 60 * 1000;        // stay under Apps Script's 6-minute limit; anything left waits for the next tick
var FAIL_REMIND_MS    = 60 * 60 * 1000;    // Hub unreachable: reminder at most hourly
var JOB_ALERT_MS      = 3 * 60 * 60 * 1000;
var OVERDUE_ALERT_MS  = 3 * 60 * 60 * 1000;

function props_() { return PropertiesService.getScriptProperties(); }

// ── One-time setup ────────────────────────────────────────────────────────────────────────
function setup() {
  var p = props_();
  // 1. A long random token, kept in Script Properties. (Prefixed so a Sheet can never read it as a number.)
  if (!p.getProperty('SCHEDULER_TOKEN')) {
    p.setProperty('SCHEDULER_TOKEN', 'hs_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    Logger.log('Created a new secret token (not shown; it is stored in this script and in the Hub sheet).');
  }
  var token = p.getProperty('SCHEDULER_TOKEN');

  // 2. Put it where the Hub reads it: Config tab, key "Scheduler_Token". Update the row if present, else append. Then READ IT BACK.
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(CONFIG_TAB);
  if (!sheet) { fatal_('Hub sheet has no "' + CONFIG_TAB + '" tab', 'setup() could not find the Config tab in the Hub sheet (' + SHEET_ID + ').'); }
  var vals = sheet.getDataRange().getValues(), row = -1;
  for (var i = 0; i < vals.length; i++) { if (String(vals[i][0]).trim() === TOKEN_KEY) { row = i + 1; break; } }
  if (row < 0) { sheet.appendRow([TOKEN_KEY, token]); row = sheet.getLastRow(); Logger.log('Added a "' + TOKEN_KEY + '" row to the Hub Config sheet.'); }
  else { Logger.log('Found the existing "' + TOKEN_KEY + '" row (row ' + row + ') in the Hub Config sheet; updating it.'); }
  var cell = sheet.getRange(row, 2);
  cell.setNumberFormat('@'); cell.setValue(token);
  SpreadsheetApp.flush();
  var back = String(sheet.getRange(row, 2).getValue());
  if (back !== token) { fatal_('could not save the scheduler token in the Hub sheet', 'setup() wrote the token to Config row ' + row + ' but reading it back did not match. Nothing was scheduled.'); }
  Logger.log('Verified: the token is saved in the Hub Config sheet (row ' + row + ').');

  // 3. Exactly ONE 15-minute trigger.
  var removed = deleteSchedulerTriggers_();
  ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(15).create();
  var n = schedulerTriggers_().length;
  if (n !== 1) { fatal_('expected exactly one scheduler timer', 'After setup there are ' + n + ' "' + HANDLER + '" triggers instead of 1.'); }
  Logger.log('Timer installed: ' + HANDLER + ' every 15 minutes (replaced ' + removed + ' old one(s)). There is exactly one.');

  // 4. First tick now (give the Hub a few seconds: it caches the Config sheet briefly, so it may not have seen the new token yet).
  p.deleteProperty('FAIL_SINCE');
  Utilities.sleep(8000);
  Logger.log('Running the first tick now...');
  var first = runScheduler();
  if (first && first.ok) {
    Logger.log('DONE. The first tick worked (' + (first.ran.length ? 'ran ' + first.ran.join(', ') : 'nothing was due') + '). The Hub scheduler is on and ticks every 15 minutes by itself. If anything goes wrong you will get an email at ' + NOTIFY_EMAIL + '.');
  } else {
    Logger.log('SETUP FINISHED BUT THE FIRST TICK FAILED: ' + (first && first.problem) + '. The timer is installed and will keep retrying every 15 minutes; an email about this was sent to ' + NOTIFY_EMAIL + '. (If the Hub has not been updated to the scheduler build yet, that is why; it will start working by itself once it has.)');
  }
  Logger.log('Run statusReport any time to see every job. (The token is never printed anywhere.)');
}

// ── The tick (15-minute trigger) ────────────────────────────────────────────────────────────
function runScheduler() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('A previous tick is still running; skipping this one.'); return { ok: true, skipped: true }; }
  try {
    dedupeTriggers_();
    var token = props_().getProperty('SCHEDULER_TOKEN');
    if (!token) { alertThrottled_('notsetup', FAIL_REMIND_MS, 'Hub scheduler is not set up', 'Run setup() once in the Apps Script project "Hub Scheduler". Until then nothing scheduled runs on the Hub.'); return { ok: false, problem: 'not set up' }; }
    var started = Date.now(), calls = 0, ran = [], infraFailed = false, more = false, problem = null;
    while (calls < MAX_CALLS) {
      if (Date.now() - started > MAX_RUN_MS) { Logger.log('Stopping early to stay under the Apps Script time limit; the rest will run on the next tick.'); break; }
      calls++;
      var r = hub_('post', '/cron/run', token);
      if (!r.ok) { infraFailed = true; problem = r.problem; infraFailure_(r.problem); break; }
      var b = r.body;
      if (b.ran) {
        ran.push(b.ran + (b.job_ok === false ? ' (FAILED)' : b.timed_out ? ' (still running)' : ''));
        if (b.job_ok === false) jobFailure_(b);
        else if (b.timed_out) Logger.log(b.ran + ' is taking longer than 50 s; it continues in the background (see statusReport).');
      }
      if (b.first_run) Logger.log('FIRST RUN on the Hub. Daily/weekly jobs whose time had already passed today were marked as already done (so nothing is sent twice): ' + ((b.seeded && b.seeded.length) ? b.seeded.join(', ') : '(none)') + '.');
      if (b.skipped) Logger.log('Hub says: ' + b.skipped + (b.claim_job ? ' (' + b.claim_job + ')' : ''));
      more = !!b.more;
      if (!more) break;
    }
    if (!infraFailed) {
      var s = hub_('get', '/cron/status', token);
      if (!s.ok) { infraFailed = true; problem = 'status check: ' + s.problem; infraFailure_(problem); }
      else checkOverdue_(s.body);
    }
    if (!infraFailed) recovered_();
    Logger.log('Tick done: ' + (ran.length ? 'ran ' + ran.join(', ') : 'nothing was due') + (more ? ' (more still due; next tick)' : '') + '.');
    return { ok: !infraFailed, ran: ran, more: more, problem: problem };
  } catch (e) {
    // Never die quietly: tell Brett, then re-throw so Google's own failure notification fires too.
    try { alertThrottled_('exception', FAIL_REMIND_MS, 'Hub scheduler script error', 'runScheduler threw: ' + e + (e && e.stack ? '\n' + e.stack : '') + '\n\nIt will try again in 15 minutes. If you keep getting this, forward this email to Claude.'); }
    catch (e2) { Logger.log('COULD NOT EMAIL ABOUT: ' + e + ' (mail error: ' + e2 + ')'); }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// Run any time (after setup): asks the Hub what its NEXT tick would do - counts only. Sends nothing, claims nothing, changes nothing.
function preflight() {
  var token = props_().getProperty('SCHEDULER_TOKEN');
  if (!token) { Logger.log('Not set up yet: run setup() first.'); return { ok: false, problem: 'not set up' }; }
  var r = hub_('post', '/cron/run', token, { dry_run: true });
  if (!r.ok) { Logger.log('PREFLIGHT FAILED: ' + r.problem); return r; }
  var b = r.body, pf = b.preflight || {}, jobs = pf.jobs || {};
  Logger.log('PREFLIGHT (nothing was sent, claimed or changed).' + (b.first_run ? ' This would be the Hub\'s FIRST scheduler tick.' : ''));
  Logger.log('Would run now: ' + ((b.due && b.due.length) ? b.due.join(', ') : 'nothing'));
  if (b.would_seed && b.would_seed.length) Logger.log('Marked as already done today, will NOT run until their next slot: ' + b.would_seed.join(', '));
  Object.keys(jobs).forEach(function (n) {
    var j = jobs[n], detail = {};
    Object.keys(j).forEach(function (k) { if (k !== 'would') detail[k] = j[k]; });
    Logger.log('  ' + n + ': ' + j.would);
    if (Object.keys(detail).length) Logger.log('      ' + JSON.stringify(detail));
  });
  if (pf.errors && pf.errors.length) Logger.log('PREFLIGHT COULD NOT COUNT SOME THINGS: ' + JSON.stringify(pf.errors));
  return { ok: pf.ok !== false, body: b };
}

// One HTTPS call to the Hub. Returns { ok:true, body } or { ok:false, problem } — never throws.
function hub_(method, path, token, payload) {
  var opts = { method: method, headers: { 'X-Auth-Token': token }, muteHttpExceptions: true, followRedirects: false };
  if (method === 'post') { opts.contentType = 'application/json'; opts.payload = payload ? JSON.stringify(payload) : '{}'; }
  var resp;
  try { resp = UrlFetchApp.fetch(WORKER_URL + path, opts); }
  catch (e) { return { ok: false, problem: 'could not reach the Hub (' + path + '): ' + e }; }
  var code = resp.getResponseCode(), text = String(resp.getContentText() || ''), j = null;
  try { j = JSON.parse(text); } catch (e) { /* handled below */ }
  if (code !== 200) return { ok: false, problem: 'the Hub answered HTTP ' + code + ' for ' + path + ': ' + text.slice(0, 400) + (code === 401 ? '  (401 = the token in the Hub Config sheet does not match this script; run setup() again)' : '') };
  if (!j || typeof j !== 'object') return { ok: false, problem: 'the Hub answered ' + path + ' with something that is not JSON: ' + text.slice(0, 300) };
  if (j.ok === false) return { ok: false, problem: 'the Hub reported a problem on ' + path + ': ' + String(j.error || text).slice(0, 500) };
  return { ok: true, body: j };
}

// ── Alerts ─────────────────────────────────────────────────────────────────────────────────
function infraFailure_(problem) {
  var p = props_(), now = Date.now();
  Logger.log('PROBLEM: ' + problem);
  var since = Number(p.getProperty('FAIL_SINCE') || 0);
  if (!since) {
    p.setProperty('FAIL_SINCE', String(now)); p.setProperty('FAIL_LAST_ALERT', String(now));
    alert_('Hub scheduler is FAILING', 'The scheduler could not run the Hub\'s jobs:\n\n' + problem + '\n\nNothing scheduled (quiet-hours texts, reminders, daily jobs) is running until this is fixed. It retries every 15 minutes and I will email again at most hourly, and when it recovers.');
  } else if (now - Number(p.getProperty('FAIL_LAST_ALERT') || 0) >= FAIL_REMIND_MS) {
    p.setProperty('FAIL_LAST_ALERT', String(now));
    alert_('Hub scheduler STILL failing (' + Math.round((now - since) / 60000) + ' min)', 'Still not working since ' + new Date(since).toString() + ':\n\n' + problem);
  }
}
function recovered_() {
  var p = props_(), since = Number(p.getProperty('FAIL_SINCE') || 0);
  if (!since) return;
  p.deleteProperty('FAIL_SINCE'); p.deleteProperty('FAIL_LAST_ALERT');
  alert_('Hub scheduler RECOVERED', 'The scheduler is talking to the Hub again (it was failing for about ' + Math.max(1, Math.round((Date.now() - since) / 60000)) + ' minutes, since ' + new Date(since).toString() + '). Jobs that were missed catch up on their own; check statusReport if you want to see them.');
}
function jobFailure_(b) {
  alertThrottled_('job_' + b.ran, JOB_ALERT_MS, 'Hub job FAILED: ' + b.ran, 'The Hub job "' + b.ran + '" failed on this tick:\n\n' + String(b.error || '(no detail)').slice(0, 1500) + '\n\nIt was logged in the Hub\'s Ops_Telemetry tab (Job_Type scheduler_job). Interval jobs retry on the next tick; daily jobs retry a couple of times that day. I email at most once per job every 3 hours.');
}
function checkOverdue_(status) {
  var p = props_(), now = Date.now();
  var overdue = (status && status.overdue) ? status.overdue.slice().sort() : [];
  var seen = JSON.parse(p.getProperty('OVERDUE_SEEN') || '{}'), k;
  for (k in seen) { if (now - seen[k] > 24 * 3600 * 1000) delete seen[k]; }
  if (!overdue.length) {
    if (p.getProperty('OVERDUE_ACTIVE')) { p.deleteProperty('OVERDUE_ACTIVE'); alert_('Hub scheduler: back on schedule', 'No Hub job is overdue any more.'); }
    p.setProperty('OVERDUE_SEEN', JSON.stringify(seen)); return;
  }
  var key = overdue.join(',');
  if (!seen[key] || now - seen[key] >= OVERDUE_ALERT_MS) {
    seen[key] = now; p.setProperty('OVERDUE_ACTIVE', '1');
    var lines = overdue.map(function (n) { var j = status.jobs && status.jobs[n] || {}; return '  - ' + n + ': ' + (j.overdue_reason || 'overdue') + (j.last_error ? ' [last error: ' + String(j.last_error).slice(0, 200) + ']' : ''); });
    alert_('Hub jobs OVERDUE: ' + overdue.join(', '), 'These Hub jobs did not run when they should have:\n\n' + lines.join('\n') + '\n\nHub status page for detail: run statusReport in the Hub Scheduler Apps Script project.');
  }
  p.setProperty('OVERDUE_SEEN', JSON.stringify(seen));
}
function fatal_(subject, body) { alert_('Hub scheduler setup: ' + subject, body); throw new Error('Hub scheduler setup failed: ' + subject + '. ' + body); }
function alert_(subject, body) {
  try { MailApp.sendEmail(NOTIFY_EMAIL, '[Hub scheduler] ' + subject, body); }
  catch (e) {
    Logger.log('ALERT EMAIL FAILED: ' + e + ' | ' + subject + ' | ' + body);
    // Last resort: a failing run shows up as an error in Apps Script's Executions list / trigger-failure emails.
    throw new Error('Hub scheduler alert could not be emailed: ' + subject);
  }
}
function alertThrottled_(key, windowMs, subject, body) {
  var p = props_(), k = 'LAST_ALERT_' + key, last = Number(p.getProperty(k) || 0);
  if (Date.now() - last < windowMs) return;
  p.setProperty(k, String(Date.now()));
  alert_(subject, body);
}

// ── Triggers ───────────────────────────────────────────────────────────────────────────────
function schedulerTriggers_() { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === HANDLER; }); }
function deleteSchedulerTriggers_() { var ts = schedulerTriggers_(); ts.forEach(function (t) { ScriptApp.deleteTrigger(t); }); return ts.length; }
// More than one timer = two ticks racing. Keep one, delete the rest, tell Brett.
function dedupeTriggers_() {
  var ts = schedulerTriggers_();
  if (ts.length <= 1) return;
  for (var i = 1; i < ts.length; i++) ScriptApp.deleteTrigger(ts[i]);
  alert_('Hub scheduler had ' + ts.length + ' timers', 'I found ' + ts.length + ' timers for ' + HANDLER + ' (they would run it twice per tick) and deleted ' + (ts.length - 1) + '. One remains.');
}

// ── Utilities you can run from the dropdown ────────────────────────────────────────────────────
function statusReport() {
  var token = props_().getProperty('SCHEDULER_TOKEN');
  if (!token) { Logger.log('Not set up yet: run setup().'); return; }
  var r = hub_('get', '/cron/status', token);
  if (!r.ok) { Logger.log('Could not get the Hub status: ' + r.problem); return; }
  var s = r.body;
  Logger.log('Hub time: ' + s.now + ' | last tick: ' + (s.last_tick || 'never') + (s.tick_age_min != null ? ' (' + s.tick_age_min + ' min ago)' : ''));
  Logger.log('Timers installed here: ' + schedulerTriggers_().length + ' (should be 1)');
  Object.keys(s.jobs || {}).forEach(function (n) {
    var j = s.jobs[n];
    Logger.log((j.overdue ? '!! OVERDUE ' : 'ok         ') + n + ' — ' + j.expected + ' — last success: ' + (j.last_ok || 'never') + (j.last_error ? ' — last error: ' + j.last_error : '') + (j.overdue ? ' — ' + j.overdue_reason : ''));
  });
  Logger.log(s.overdue && s.overdue.length ? 'OVERDUE: ' + s.overdue.join(', ') : 'Nothing is overdue.');
}
// Turns the scheduler OFF. Nothing on the Hub will run on a schedule afterwards (there is no cron fallback by design).
// To turn it back on, run setup() again.
function removeScheduler() {
  var n = deleteSchedulerTriggers_();
  Logger.log('Deleted ' + n + ' timer(s). The Hub scheduler is now OFF: no quiet-hours releases, reminders, daily jobs or reports will run until you run setup() again.');
  Logger.log('To remove it completely: also delete this Apps Script project, and delete the "' + TOKEN_KEY + '" row in the Hub Config sheet.');
}
