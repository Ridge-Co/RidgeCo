/**
 * HUB SCHEDULER  (v2.0, Oct 13 2026) — the ONE clock for everything Brett runs on a timer
 * ---------------------------------------------------------------------------------------------
 * PERMANENT RULE (Brett, Oct 12 2026): NO CRON ANYWHERE. Not Cloudflare Cron Triggers (the account
 * is at its trigger cap, so new ones silently never attach), not GitHub Actions `schedule:`. This Apps
 * Script is the only clock. Every periodic thing is a row in the JOBS table just below: its name, how
 * often, what it does, and an on/off switch. To change a time, edit the row. To turn something off,
 * set  enabled: false.  To add something periodic, add a row — never add a cron anywhere else.
 *
 * HOW IT WORKS: every 15 minutes runScheduler() runs. (1) It tells the Hub "run whatever is due"
 * (POST /cron/run), sending the JOBS table so the Hub uses these times. (2) It runs the other rows
 * itself: calls the other Workers (Pinterest sync, BarrelCo entry sheet, STR, BrettOS) or "presses the
 * Run button" on a GitHub workflow. Nothing runs twice: the Hub keeps its own once-a-day / minimum-gap
 * records, and this script keeps the same records for its own rows.
 *
 * NOTHING FAILS SILENTLY — you get an EMAIL (sent from here, independent of the Hub and of Twilio) when:
 *   - the Hub can't be reached / returns an error / returns junk   → immediately, then a reminder at most
 *                                                                     hourly while it persists, then a "RECOVERED" email
 *   - a job fails (Hub job, other Worker, or a GitHub workflow that finished red) → once per job per 3 hours
 *   - a job is overdue (didn't run when it should have)             → once per distinct overdue set per 3 hours
 *   - a row is ON but is missing a secret it needs                  → once a day, until you add it or switch the row off
 *   - the JOBS table has a typo                                     → hourly, until fixed (Hub jobs keep running on their last schedule)
 *   - there is more than one scheduler timer (it deletes the extras and tells you)
 *   - the Hub's failure ledger has an urgent problem nobody acknowledged     → email at once, then every 6 h while the list is unchanged (works even if Hub texting is down or alerts are off)
 *   - another Worker (BarrelCo, STR, BrettOS, Pinterest) fails its health check twice in a row → email + a ledger item, then a "back up" email
 *   - this script itself throws (it emails you, then re-throws so Google's own failure email also fires)
 *
 * ── SETUP: TWO STEPS, YOU CHOOSE WHEN TO START ─────────────────────────────────────────────────────
 * Sign in as brett@bmoremanagement.com (the Google account that can edit the Hub sheet).
 *   a. script.google.com → New project → paste this file over Code.gs → Save.
 *   b. Project Settings (gear) → tick "Show appsscript.json" → back in Editor, paste the companion
 *      appsscript.json over it → Save.
 *   c. Function dropdown → pick  setup  → Run → approve the permissions prompt.
 *      setup() is SAFE: it saves the secret token, then asks the Hub (read-only) "what would the first
 *      tick do?" and prints the answer in the log: texts waiting from quiet hours (by age), vendor
 *      nudges that are overdue, which jobs would run, which are marked already-done. It sends NOTHING,
 *      starts NO timer and runs NO job. Read the log (View → Logs / Execution log).
 *   d. When you are happy: pick  approveAndStart  → Run. THAT is the only step that starts the 15-minute
 *      timer and runs the first tick.
 *   Anything else you need to add (secrets for the Pinterest / GitHub / STR / BrettOS rows) goes in
 *   Project Settings → Script properties → Add. setup() tells you exactly which ones, in plain words.
 *
 * Other functions you can run from the dropdown any time:
 *   showSchedule   – the JOBS table in plain English (what runs when, on or off)
 *   statusReport   – plain-English status of every job (last success, overdue, errors)
 *   preflight      – re-run the read-only "what would the next tick do?"
 *   runScheduler   – tick now (only works after approveAndStart)
 *   removeScheduler – turns everything OFF (see its note)
 */

// ═══ 1. THE JOBS TABLE — every schedule, in one place ═════════════════════════════════════════════
// One line per job. Edit the times / the on-off switch freely; the script checks the table every tick and
// EMAILS YOU about a typo instead of guessing. All times are Eastern.
//
//   name      – short id (do not rename a Hub job: the Hub knows it by this name)
//   run       – 'hub' = the Hub does the work   |   'github' = press Run on a GitHub workflow
//               'pinterest' | 'barrelco_entry' | 'str_tick' | 'brettos_sync' = call that Worker
//   what      – one plain-English line
//   enabled   – true = on, false = off
//   WHEN (use exactly one style):
//     every_min: 15              every 15 minutes (the timer ticks every 15 min, so 15 is the fastest that means anything)
//     at: '07:00'                every day at 7:00 AM
//     day: 'Mon', at: '08:30'    every Monday at 8:30 AM   (Sun Mon Tue Wed Thu Fri Sat)
//   github rows also have:  repo, workflow (the file name), ref (branch, usually 'main'), inputs (optional)
//   quiet: …   RESERVED for a later "pause overnight" feature. It is NOT active yet — using it is rejected.
var JOBS = [
  // ── Run inside the Hub (the Hub decides what "due" means and never runs a job twice) ──
  { name: 'door_watchdog',       run: 'hub', every_min: 15,                    enabled: true, what: 'Checks the door-code system; texts Brett only if it is unhealthy.' },
  { name: 'sweep',               run: 'hub', every_min: 15,                    enabled: true, what: 'Texts quiet-hours-held messages that are now due, sends due queued reminders and due vendor nudges.' },
  { name: 'sweep_work',          run: 'hub', every_min: 15,                    enabled: true, what: 'Posts due recurring work orders, sends the once-a-day estimate reminder, moves paid-deposit scopes forward.' },
  { name: 'sweep_checks',        run: 'hub', every_min: 15,                    enabled: true, what: 'Runs the daily self-test and the dead-man check (alerts if there is no telemetry for 24h).' },
  { name: 'insp_guard',          run: 'hub', every_min: 15,                    enabled: true, what: 'Checks inspection bookings against the STR calendar (does nothing until that module is set up).' },
  { name: 'str_cleaning',        run: 'hub', every_min: 15,                    enabled: true, what: 'Milam Ridge cleaning scheduler: keeps 35 days of turnovers covered, texts the cleaner queue, writes the cleaning calendar, alerts Brett (does nothing until STR_ENGINE_ENABLED is TRUE).' },
  { name: 'followup_sweep',      run: 'hub', every_min: 60,                    enabled: true, what: 'Tenant fix-check: 2 days after a check was texted with no answer, sends the tenant ONE reminder (9am-7pm only) and texts Brett "no answer - call them".' },
  { name: 'ai_credit_probe',    run: 'hub', every_min: 60,                    enabled: true, what: 'Does nothing unless AI reading is paused (Anthropic credit out). While paused, at most hourly, makes one tiny Claude call and clears the pause (plus one "AI is back" text) if it works.' },
  { name: 'daily_digest',        run: 'hub', at: '07:00',                      enabled: true, what: 'Builds the morning digest and texts it to the admin phone.' },
  { name: 'daily_receipts',      run: 'hub', at: '07:00',                      enabled: true, what: 'Scans the receipt inbox.' },
  { name: 'daily_receipts_post', run: 'hub', at: '07:00',                      enabled: true, what: 'Emails newly scanned receipts to QuickBooks.' },
  { name: 'daily_turnover',      run: 'hub', at: '07:00',                      enabled: true, what: 'Releases turnover work orders due today.' },
  { name: 'daily_qb_sync',       run: 'hub', at: '07:00',                      enabled: true, what: 'Syncs QuickBooks payments and runs the deposit-paid sweep.' },
  { name: 'sms_delivery_check',  run: 'hub', at: '07:00',                      enabled: true, what: 'Reads the last day of outbound texts from Twilio, flags carrier-filtered or failing link texts, and emails Brett the result (set enabled:false once it is proven clean).' },
  { name: 'review_mon',          run: 'hub', day: 'Mon', at: '08:30',         enabled: true, what: 'Runs the Monday weekly review and delivers it.' },
  { name: 'review_wed',          run: 'hub', day: 'Wed', at: '08:00',         enabled: true, what: 'Runs the Wednesday weekly review (logged only).' },
  { name: 'ar_report_mon',       run: 'hub', day: 'Mon', at: '09:00',         enabled: true, what: 'Builds and delivers the Monday AR aging report.' },
  { name: 'hub_impr_mon',        run: 'hub', day: 'Mon', at: '07:15',         enabled: true, what: 'Pulls new items from the Google Tasks list "RidgeCo Hub Improvements" into the Optimizer queue (as proposed).' },
  { name: 'hub_impr_thu',        run: 'hub', day: 'Thu', at: '07:15',         enabled: true, what: 'Same sweep, Thursday.' },
  { name: 'hub_impr_daily',      run: 'hub', at: '07:30',                      enabled: true, what: 'Marks Hub Improvements items done once built (queue item done / PR merged) and reports any that are stuck.' },
  { name: 'str_digest_mon',      run: 'hub', day: 'Mon', at: '08:00',         enabled: true, what: 'Emails the cleaners the Milam Ridge cleaning calendar with calendar invites (does nothing until STR_DIGEST_ENABLED is TRUE).' },
  { name: 'str_digest_wed',      run: 'hub', day: 'Wed', at: '08:00',         enabled: true, what: 'Same cleaning email, Wednesday.' },
  { name: 'str_digest_fri',      run: 'hub', day: 'Fri', at: '08:00',         enabled: true, what: 'Same cleaning email, Friday.' },

  // ── Other Workers (this script calls them; secrets live in Script properties, never in this file) ──
  { name: 'pinterest_sync',      run: 'pinterest',      day: 'Sun', at: '09:00', enabled: true,  what: 'BarrelCo: copies new Pinterest pins into the Google Drive folders (was a weekly GitHub Action).' },
  { name: 'barrelco_entry',      run: 'barrelco_entry', every_min: 15,           enabled: true,  what: 'BarrelCo: applies new rows typed in the Entry sheet to Inventory/History (was never running: its cron was switched off).' },
  { name: 'brettos_sync',        run: 'brettos_sync',   at: '06:30',             enabled: true,  what: 'BrettOS: refreshes the shared property / listing / contact list (was a Cloudflare cron set in the dashboard).' },
  { name: 'str_tick',            run: 'str_tick',       every_min: 60,           enabled: false, what: 'STR door codes: runs the hourly arrival-alert / lock-retry job (the TruviSync script already does this every 5 min, so this is an extra safety net; turn on after adding STR_ADMIN_TOKEN).' },

  // ── GitHub workflows (this script presses Run, then checks the result; the workflows no longer have their own timers) ──
  { name: 'ci_context_sync',      run: 'github', repo: 'Ridge-Co/RidgeCo', workflow: 'context-sync.yml',     ref: 'main', every_min: 30,           enabled: true, what: 'Folds Claude capture notes from the Drive inbox into context/CAPTURE_INBOX.md.' },
  { name: 'ci_doc_audit',         run: 'github', repo: 'Ridge-Co/RidgeCo', workflow: 'doc-audit.yml',        ref: 'main', at: '09:00',               enabled: true, what: 'Flags commits that landed with no FEATURE_LOG entry.' },
  { name: 'ci_drift_check',       run: 'github', repo: 'Ridge-Co/RidgeCo', workflow: 'drift-check.yml',      ref: 'main', at: '07:45',               enabled: true, what: 'Opens an issue if the staging branch differs from main with no explanation.' },
  { name: 'ci_selftest_invoice',  run: 'github', repo: 'Ridge-Co/RidgeCo', workflow: 'selftest-invoice.yml', ref: 'main', at: '08:00',               enabled: true, what: 'Daily invoice-OCR canary: one real Claude vision call against the live Hub.' },
  { name: 'data_video_watcher',   run: 'github', repo: 'brett332/data',    workflow: 'video-watcher.yml',    ref: 'main', at: '07:30',               enabled: true, what: 'Watches the YouTube channels, summarises new videos with Gemini, saves the digests (uses paid API keys).' }
];

// ═══ 2. FIXED SETTINGS (rarely edited) ════════════════════════════════════════════════════════════
var WORKER_URL    = 'https://maintenance-hub.brett-2f8.workers.dev';
var SHEET_ID      = '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4';
var NOTIFY_EMAIL  = 'brett@bmoremanagement.com';
var PINTEREST_URL = 'https://pinterest-sync.brett-2f8.workers.dev';
var BARRELCO_URL  = 'https://barrel-co.brett-2f8.workers.dev';
var STR_URL       = 'https://str-automation.brett-2f8.workers.dev';
var BRETTOS_URL   = 'https://brett-os.brett-2f8.workers.dev';
// Workers the watcher probes every tick (GET /health). Up = any answer below HTTP 500 (a 404 or 401 still proves the Worker is alive);
// down = no answer, a Cloudflare error, or HTTP 5xx. To watch another Worker add a row here.
var PROBES = [
  { name: 'brett-os',       url: BRETTOS_URL },
  { name: 'barrel-co',      url: BARRELCO_URL },
  { name: 'str-automation', url: STR_URL, body: 'str' },   // body:'str' = also read the JSON answer: open problems / stale ticks become ledger items
  { name: 'pinterest-sync', url: PINTEREST_URL },
  { name: 'gh-broker',      url: 'https://gh-broker.brett-2f8.workers.dev' },     // answers 401 to everything without its key: 401 proves the code is running
  { name: 'listing-forge',  url: 'https://listing-forge.brett-2f8.workers.dev' }, // answers 200 to every path: proves only that the Worker is up
];
var CONFIG_TAB    = 'Config';
var TOKEN_KEY     = 'Scheduler_Token';
var ENTRY_TOKEN_KEY = 'Entry_Run_Token';   // the key in the BarrelCo sheet's Config tab
var HANDLER       = 'runScheduler';
var TICK_MINUTES  = 15;                    // how often the timer fires (Apps Script allows 1, 5, 10, 15 or 30)
var MAX_CALLS     = 25;                    // one Hub job per call; the Hub has 21 jobs, so a tick can finish a full catch-up
var MAX_RUN_MS    = 4.5 * 60 * 1000;       // stay under Apps Script's 6-minute limit; anything left waits for the next tick
var HUB_SHARE     = 0.6;                   // the Hub loop may use at most this share of the run; the rest is for the other rows
var FAIL_REMIND_MS    = 60 * 60 * 1000;    // Hub unreachable: reminder at most hourly
var LEDGER_REMIND_MS  = 6 * 60 * 60 * 1000;    // urgent problems in the Hub's failure ledger: email again at most every 6 h while the set is unchanged
var PROBE_FAILS_BEFORE_ALERT = 2;          // a Worker must fail its health probe this many ticks in a row (about 30 min) before it is reported
var WATCH_EVERY_MS = 25 * 60 * 1000;       // the GitHub-run check and the deployed-version check each look at most this often (not every tick)
var WATCH_FAILS_BEFORE_ALERT = 3;          // if a watcher itself cannot get its answer this many times in a row, that is reported too
var DEPLOY_DRIFT_GRACE_MS = 45 * 60 * 1000; // main and the live Worker may differ this long after a merge (deploy time) before it is a problem
var MAIN_RUN_REMIND_MS = 24 * 60 * 60 * 1000; // a red run on main is re-reported at most once a day while it stays the latest result
var MAIN_REPO = 'Ridge-Co/RidgeCo';
var JOB_ALERT_MS      = 3 * 60 * 60 * 1000;
var OVERDUE_ALERT_MS  = 3 * 60 * 60 * 1000;
var NEEDS_ALERT_MS    = 24 * 60 * 60 * 1000;
var OVERDUE_INTERVAL_MIN = 45;             // same limits the Hub uses
var OVERDUE_GRACE_MIN    = 180;
var RETRY_GAP_MS      = 30 * 60 * 1000;    // a failed daily/weekly row: retry no sooner than this ...
var MAX_ATTEMPTS      = 3;                 // ... and at most this many tries per day
var GH_NO_RUN_MIN     = 20;                // a dispatched workflow that shows no run after this long is reported
var GH_STUCK_MIN      = 90;                // a run still not finished after this long is reported
var DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var JOB_FIELDS = ['name', 'run', 'what', 'enabled', 'every_min', 'at', 'day', 'repo', 'workflow', 'ref', 'inputs'];

function props_() { return PropertiesService.getScriptProperties(); }

// ═══ 3. SETUP (safe) AND START (the only thing that turns the clock on) ══════════════════════════════
// Step 1. Safe. Saves the token, checks everything read-only, prints what the first tick WOULD do, then STOPS.
function setup() {
  var p = props_();
  var table = checkJobs_();
  if (!table.ok) { table.problems.forEach(function (m) { Logger.log('JOBS TABLE PROBLEM: ' + m); }); fatal_('the JOBS table has a mistake', 'setup() stopped because the JOBS table at the top of the script has a mistake:\n\n' + table.problems.join('\n') + '\n\nFix it and run setup() again.'); }
  Logger.log('SETUP STEP 1 of 2 - this part is safe: it sends nothing, starts no timer and runs no job.');

  // 1. A long random token, kept in Script Properties. (Prefixed so a Sheet can never read it as a number.)
  if (!p.getProperty('SCHEDULER_TOKEN')) {
    p.setProperty('SCHEDULER_TOKEN', 'hs_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    Logger.log('Created a new secret token (not shown; it is stored in this script and in the Hub sheet).');
  }
  var token = p.getProperty('SCHEDULER_TOKEN');

  // 2. Put it where the Hub reads it: Config tab, key "Scheduler_Token". Then READ IT BACK.
  writeConfigKey_(SHEET_ID, TOKEN_KEY, token, 'Hub');
  Logger.log('Verified: the Hub scheduler token is saved in the Hub Config sheet.');

  // 3. The BarrelCo entry job reads its own token from the BarrelCo sheet's Config tab (only if that row is on).
  setupBarrelEntryToken_();

  // 4. Read-only preview of what the first tick would do. The Hub may take a few seconds to see the new Config row.
  Utilities.sleep(8000);
  var pv = previewReport_({ retries: 3 });

  p.setProperty('SETUP_DONE', new Date().toISOString());
  Logger.log('');
  if (pv.hubOk) {
    Logger.log('SETUP IS DONE - NOTHING HAS BEEN STARTED. The scheduler is OFF until you say so.');
    Logger.log('Read the preview above. When you are happy with it, run:  approveAndStart');
  } else {
    Logger.log('SETUP SAVED THE TOKEN BUT THE HUB DID NOT ANSWER THE PREVIEW (see PREVIEW FAILED above). Nothing has been started.');
    Logger.log('Fix that first (usually: the Hub has not been updated to the scheduler build yet), then run setup again. approveAndStart will refuse to start until the Hub answers.');
  }
  return { ok: pv.hubOk, started: false };
}

// Step 2. The ONLY function that starts the clock: installs the ONE timer and runs the first tick.
function approveAndStart() {
  var p = props_();
  if (!p.getProperty('SETUP_DONE') || !p.getProperty('SCHEDULER_TOKEN')) { Logger.log('Not yet: run  setup  first (it is safe), read its preview, then come back and run approveAndStart.'); return { ok: false, started: false, problem: 'setup not done' }; }
  var table = checkJobs_();
  if (!table.ok) { table.problems.forEach(function (m) { Logger.log('JOBS TABLE PROBLEM: ' + m); }); Logger.log('Not started: fix the JOBS table first.'); return { ok: false, started: false, problem: 'bad table' }; }
  Logger.log('APPROVED. Checking the Hub one more time (read-only) before starting...');
  var pv = previewReport_({ retries: 1, quiet: true });
  if (!pv.hubOk) { Logger.log('NOT STARTED: the Hub did not answer the read-only check (' + pv.problem + '). Nothing was changed. Fix that, then run approveAndStart again.'); return { ok: false, started: false, problem: pv.problem }; }

  // Daily/weekly rows of this script whose time already passed today are marked done (the Hub does the same on ITS first tick),
  // so starting at 2pm does not re-run the 9am audit. Rows that have never run on an interval run at once.
  var seeded = seedScriptJobs_(Date.now());
  if (seeded.length) Logger.log('Marked as already done today (will NOT run until their next slot): ' + seeded.join(', ') + '.');

  var removed = deleteSchedulerTriggers_();
  ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(TICK_MINUTES).create();
  var n = schedulerTriggers_().length;
  if (n !== 1) { fatal_('expected exactly one scheduler timer', 'After starting there are ' + n + ' "' + HANDLER + '" triggers instead of 1.'); }
  p.setProperty('STARTED', new Date().toISOString());
  p.deleteProperty('FAIL_SINCE');
  Logger.log('Timer installed: ' + HANDLER + ' every ' + TICK_MINUTES + ' minutes (replaced ' + removed + ' old one(s)). There is exactly one.');
  Logger.log('Running the first tick now...');
  var first = runScheduler();
  if (first && first.ok) {
    Logger.log('STARTED. The first tick worked (' + (first.ran && first.ran.length ? 'ran ' + first.ran.join(', ') : 'nothing was due') + '). From now on it ticks every ' + TICK_MINUTES + ' minutes by itself. If anything goes wrong you will get an email at ' + NOTIFY_EMAIL + '.');
  } else {
    Logger.log('STARTED, BUT THE FIRST TICK REPORTED A PROBLEM: ' + (first && first.problem) + '. The timer is installed and keeps retrying every ' + TICK_MINUTES + ' minutes; an email about this was sent to ' + NOTIFY_EMAIL + '.');
  }
  Logger.log('Run showSchedule to read the table in plain English, or statusReport any time to see every job. (Secrets are never printed.)');
  return { ok: !!(first && first.ok), started: true };
}

// ── The tick (15-minute trigger) ────────────────────────────────────────────────────────────
function runScheduler() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('A previous tick is still running; skipping this one.'); return { ok: true, skipped: true }; }
  try {
    dedupeTriggers_();
    var p = props_();
    if (!p.getProperty('STARTED')) {
      if (schedulerTriggers_().length) { alertThrottled_('nostart', FAIL_REMIND_MS, 'Hub scheduler timer is on but the scheduler is not approved', 'The 15-minute timer exists but this script has lost its "started" flag (script properties were cleared?). Nothing is running. Run approveAndStart once to fix it.'); return { ok: false, problem: 'timer without approval' }; }
      Logger.log('The scheduler has not been started yet, so nothing was run. Run setup (safe), then approveAndStart.');
      return { ok: true, notStarted: true };
    }
    var token = p.getProperty('SCHEDULER_TOKEN');
    if (!token) { alertThrottled_('notsetup', FAIL_REMIND_MS, 'Hub scheduler is not set up', 'The scheduler token is missing from this script. Run setup() then approveAndStart in the Apps Script project "Hub Scheduler". Until then nothing scheduled runs.'); return { ok: false, problem: 'not set up' }; }

    var table = checkJobs_();
    if (!table.ok) alertThrottled_('badtable', FAIL_REMIND_MS, 'Hub scheduler JOBS table has a mistake', 'The JOBS table at the top of the script has a mistake, so the non-Hub rows are NOT running and the Hub keeps using the last schedule it accepted:\n\n' + table.problems.join('\n') + '\n\nFix the line and save; the next tick picks it up.');
    var started = Date.now(), calls = 0, ran = [], infraFailed = false, more = false, problem = null;
    var payload = table.ok ? { schedule: hubSchedule_() } : {};
    while (calls < MAX_CALLS) {
      if (Date.now() - started > MAX_RUN_MS * HUB_SHARE) { Logger.log('Stopping the Hub loop early to leave time for the other jobs; the rest will run on the next tick.'); break; }
      calls++;
      var r = hub_('post', '/cron/run', token, payload);
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
    var hubStatus = null;
    if (!infraFailed) {
      var s = hub_('get', '/cron/status', token);
      if (!s.ok) { infraFailed = true; problem = 'status check: ' + s.problem; infraFailure_(problem); }
      else hubStatus = s.body;
    }
    // The non-Hub rows run even when the Hub is down (they do not depend on it).
    var script = table.ok ? runScriptJobs_(started) : { ran: [], status: { overdue: [], jobs: {} } };
    ran = ran.concat(script.ran);
    if (hubStatus) checkLedger_(hubStatus.failures);
    if (hubStatus) checkOverdue_(mergeStatus_(hubStatus, script.status));
    else if (script.status.overdue.length) checkOverdue_(mergeStatus_({ overdue: [], jobs: {} }, script.status));
    if (Date.now() - started < MAX_RUN_MS) { try { probeWorkers_(); } catch (pe) { alertThrottled_('probe_script', FAIL_REMIND_MS, 'Hub scheduler: the Worker health probes crashed', 'probeWorkers_ threw: ' + pe + '\n\nThe other checks in this tick still ran.'); } }
    if (Date.now() - started < MAX_RUN_MS) { try { checkMainRuns_(); } catch (me) { alertThrottled_('mainruns_script', FAIL_REMIND_MS, 'Hub scheduler: the main-branch run check crashed', 'checkMainRuns_ threw: ' + me + '\n\nThe other checks in this tick still ran.'); } }
    if (Date.now() - started < MAX_RUN_MS) { try { checkDeploy_(); } catch (de) { alertThrottled_('deploy_script', FAIL_REMIND_MS, 'Hub scheduler: the deployed-version check crashed', 'checkDeploy_ threw: ' + de + '\n\nThe other checks in this tick still ran.'); } }
    if (!infraFailed) recovered_();
    Logger.log('Tick done: ' + (ran.length ? 'ran ' + ran.join(', ') : 'nothing was due') + (more ? ' (more still due; next tick)' : '') + '.');
    return { ok: !infraFailed, ran: ran, more: more, problem: problem };
  } catch (e) {
    // Never die quietly: tell Brett, then re-throw so Google's own failure notification fires too.
    try { alertThrottled_('exception', FAIL_REMIND_MS, 'Hub scheduler script error', 'runScheduler threw: ' + e + (e && e.stack ? '\n' + e.stack : '') + '\n\nIt will try again in ' + TICK_MINUTES + ' minutes. If you keep getting this, forward this email to Claude.'); }
    catch (e2) { Logger.log('COULD NOT EMAIL ABOUT: ' + e + ' (mail error: ' + e2 + ')'); }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// ── Read-only preview (used by setup and approveAndStart; also runnable from the dropdown) ──────────────
// Asks the Hub what its NEXT tick would do (counts only; nothing is sent, claimed or changed) and checks that every other row
// has what it needs. Prints plain English. Returns { hubOk, problem }.
function preflight() {
  if (!props_().getProperty('SCHEDULER_TOKEN')) { Logger.log('Not set up yet: run setup() first.'); return { ok: false, problem: 'not set up' }; }
  var pv = previewReport_({ retries: 1 });
  return { ok: pv.hubOk, problem: pv.problem };
}
function previewReport_(opts) {
  opts = opts || {};
  var token = props_().getProperty('SCHEDULER_TOKEN'), res = { hubOk: false, problem: null };
  var table = checkJobs_();
  if (!table.ok) { res.problem = 'the JOBS table has a mistake: ' + table.problems.join(' | '); Logger.log('PREVIEW FAILED: ' + res.problem); return res; }
  table.notes.forEach(function (m) { Logger.log('Note: ' + m); });
  var r = null;
  for (var i = 0; i < (opts.retries || 1); i++) {
    r = hub_('post', '/cron/run', token, { dry_run: true, schedule: hubSchedule_() });
    if (r.ok || !/HTTP 401/.test(r.problem || '') || i === (opts.retries || 1) - 1) break;
    Logger.log('The Hub has not noticed the new token yet; waiting a few seconds and asking again...');
    Utilities.sleep(8000);
  }
  if (!r.ok) { res.problem = r.problem; Logger.log('PREVIEW FAILED (Hub): ' + r.problem); }
  else {
    res.hubOk = true;
    if (!opts.quiet) describeHubPreview_(r.body);
    else Logger.log('The Hub answered the read-only check.');
  }
  if (!opts.quiet) describeScriptJobs_();
  return res;
}
function describeHubPreview_(b) {
  var pf = b.preflight || {}, jobs = pf.jobs || {};
  Logger.log('');
  Logger.log('=== WHAT THE HUB WOULD DO ON ITS FIRST TICK (nothing was sent, claimed or changed) ===');
  if (b.first_run) Logger.log('This would be the Hub\'s FIRST scheduler tick, so daily/weekly jobs whose time has already passed today are marked done instead of running.');
  Logger.log('Hub jobs that would run right now: ' + ((b.due && b.due.length) ? b.due.join(', ') : 'none'));
  if (b.would_seed && b.would_seed.length) Logger.log('Marked as already done today (will NOT run until their next slot): ' + b.would_seed.join(', '));
  if (b.disabled && b.disabled.length) Logger.log('Switched OFF in the JOBS table: ' + b.disabled.join(', '));
  var sw = jobs.sweep;
  if (sw) {
    Logger.log('Twilio texting is ' + (sw.twilio_enabled ? 'ON' : 'OFF') + (sw.twilio_enabled ? (sw.twilio_test_mode ? ' (TEST MODE: texts are not really sent)' : ' (LIVE: texts WILL be sent)') : '') + '.');
    describeQueue_('Texts held back by quiet hours that are now due', sw.quiet_hours_held_due, 'by_recipient_type');
    describeQueue_('Queued reminder texts that are due', sw.queued_notifications_due);
    describeQueue_('Vendor nudges that are due', sw.vendor_nudges_due, 'by_request_type');
  }
  var sa = jobs.sweep_work;
  if (sa) {
    if (sa.estimate_reminder) Logger.log('Estimate reminder: ' + (sa.estimate_reminder.would_send ? 'WOULD send (' + sa.estimate_reminder.estimates_awaiting_decision + ' estimate(s) awaiting a decision)' : 'would not send (' + (sa.estimate_reminder.reason || 'nothing awaiting a decision') + ')'));
    if (sa.recurring_wos) Logger.log('Recurring work orders that would be posted: ' + (sa.recurring_wos.would_post || 0) + (sa.recurring_wos.reason ? ' (' + sa.recurring_wos.reason + ')' : ''));
  }
  if (jobs.daily_digest) Logger.log('Morning digest: ' + (jobs.daily_digest.admin_phone_set ? 'an admin phone is set' : 'NO admin phone is set, so it would not be delivered'));
  Object.keys(jobs).forEach(function (n) { Logger.log('  - ' + n + ': ' + (jobs[n].would || '')); });
  if (pf.errors && pf.errors.length) Logger.log('THE PREVIEW COULD NOT COUNT SOME THINGS: ' + JSON.stringify(pf.errors));
  var s = b.status_summary;
  if (s && s.schedule_error) Logger.log('WARNING: ' + s.schedule_error);
  var hubNames = s && s.jobs ? Object.keys(s.jobs) : [], tableNames = JOBS.filter(function (j) { return j.run === 'hub'; }).map(function (j) { return j.name; });
  var missing = hubNames.filter(function (n) { return tableNames.indexOf(n) < 0; });
  if (missing.length) Logger.log('NOTE: the Hub has job(s) that are not in your JOBS table, so they run on the Hub\'s built-in schedule: ' + missing.join(', ') + '. Add a line for each so you can see and edit it.');
}
function describeQueue_(label, q, typeKey) {
  if (!q) return;
  if (q.error) { Logger.log(label + ': COULD NOT COUNT (' + q.error + ')'); return; }
  if (!q.count) { Logger.log(label + ': none.'); return; }
  var a = q.by_age || {}, types = q[typeKey] ? Object.keys(q[typeKey]).map(function (k) { return q[typeKey][k] + ' ' + k; }).join(', ') : '';
  Logger.log(label + ': ' + q.count + (types ? ' (' + types + ')' : '') + '.');
  Logger.log('     by how long they have been waiting: under 1 hour ' + (a.under_1h || 0) + ' | 1 to 24 hours ' + (a.h1_to_24 || 0) + ' | 1 to 7 days ' + (a.d1_to_7 || 0) + ' | over 7 days ' + (a.over_7d || 0) + (a.unknown ? ' | unknown age ' + a.unknown : '') + (q.oldest_days != null ? '; the oldest has waited ' + q.oldest_days + ' days' : '') + '.');
  if (q.stale_over_1d) Logger.log('     ' + q.stale_over_1d + ' of them are STALE (more than a day old). They go out on the first tick unless you clear them first.');
}
function describeScriptJobs_() {
  Logger.log('');
  Logger.log('=== THE OTHER JOBS (this script runs them) ===');
  var any = false;
  JOBS.forEach(function (job) {
    if (job.run === 'hub') return;
    any = true;
    if (!job.enabled) { Logger.log('  OFF      ' + job.name + ' - ' + describe_(job)); return; }
    var miss = missingNeeds_(job);
    if (miss.length) { Logger.log('  NEEDS SETUP  ' + job.name + ' - ' + describe_(job) + '. Missing: ' + miss.map(function (k) { return k + ' (' + propHelp_(k) + ')'; }).join('; ') + '. Add it in Project Settings > Script properties, then run setup again - or set enabled: false.'); return; }
    var chk = checkScriptJob_(job);
    Logger.log('  ' + (chk.ok ? 'READY    ' : 'PROBLEM  ') + job.name + ' - ' + describe_(job) + '. ' + chk.line);
  });
  if (!any) Logger.log('  (none)');
  var seeded = wouldSeedScriptJobs_(Date.now());
  if (seeded.length) Logger.log('Of these, marked as already done today when you start (so they do not run again at once): ' + seeded.join(', ') + '.');
}

// One HTTPS call to the Hub. Returns { ok:true, body } or { ok:false, problem } — never throws.
function hub_(method, path, token, payload) {
  var opts = { method: method, headers: { 'X-Auth-Token': token }, muteHttpExceptions: true, followRedirects: false };
  if (method === 'post') { opts.contentType = 'application/json'; opts.payload = payload ? JSON.stringify(payload) : '{}'; }
  var resp;
  try { resp = UrlFetchApp.fetch(WORKER_URL + path, opts); }
  catch (e) { return { ok: false, problem: 'could not reach the Hub (' + path + '): ' + e }; }
  var code = resp.getResponseCode(), text = String(resp.getContentText() || ''), j = null;
  try { j = JSON.parse(text); } catch (e) { /* silent-ok: a non-JSON reply is handled below by the status check */ }
  if (code !== 200) return { ok: false, problem: 'the Hub answered HTTP ' + code + ' for ' + path + ': ' + text.slice(0, 400) + (code === 401 ? '  (401 = the token in the Hub Config sheet does not match this script; run setup() again)' : '') };
  if (!j || typeof j !== 'object') return { ok: false, problem: 'the Hub answered ' + path + ' with something that is not JSON: ' + text.slice(0, 300) };
  if (j.ok === false) return { ok: false, problem: 'the Hub reported a problem on ' + path + ': ' + String(j.error || text).slice(0, 500) };
  return { ok: true, body: j };
}

// ═══ 4. THE JOBS TABLE: checking it and turning it into schedules ═══════════════════════════════════
var RUN_TYPES = ['hub', 'github', 'pinterest', 'barrelco_entry', 'str_tick', 'brettos_sync'];
function atMinutes_(at) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(at)); return m ? (+m[1]) * 60 + (+m[2]) : NaN; }
function validAt_(at) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(at)); return !!m && +m[1] <= 23 && +m[2] <= 59; }
// Returns { ok, problems:[plain English], notes:[] }. A typo is an error you hear about, never a silently ignored line.
function checkJobs_() {
  var problems = [], notes = [], seen = {};
  if (!JOBS || !JOBS.length) problems.push('the JOBS table is empty.');
  (JOBS || []).forEach(function (j, i) {
    var label = 'Line ' + (i + 1) + (j && j.name ? ' (' + j.name + ')' : '');
    if (!j || typeof j !== 'object') { problems.push(label + ': is not a { ... } row.'); return; }
    if (!j.name || !/^[a-z0-9_]+$/.test(j.name)) problems.push(label + ': "name" must be lowercase letters, numbers and underscores.');
    else if (seen[j.name]) problems.push(label + ': the name "' + j.name + '" is used twice.');
    else seen[j.name] = true;
    Object.keys(j).forEach(function (k) {
      if (k === 'quiet') problems.push(label + ': "quiet" (pause overnight) is reserved for a later feature and is NOT active yet. Remove it.');
      else if (JOB_FIELDS.indexOf(k) < 0) problems.push(label + ': unknown field "' + k + '" (typo? allowed: ' + JOB_FIELDS.join(', ') + ').');
    });
    if (RUN_TYPES.indexOf(j.run) < 0) problems.push(label + ': "run" must be one of ' + RUN_TYPES.join(', ') + '.');
    if (typeof j.enabled !== 'boolean') problems.push(label + ': "enabled" must be true or false.');
    if (!j.what || typeof j.what !== 'string') problems.push(label + ': add a "what" sentence so the table explains itself.');
    var hasEvery = j.every_min !== undefined, hasAt = j.at !== undefined, hasDay = j.day !== undefined;
    if (hasEvery && (hasAt || hasDay)) problems.push(label + ': use EITHER every_min OR at (with an optional day), not both.');
    else if (!hasEvery && !hasAt) problems.push(label + ': say when: every_min: 15  or  at: \'07:00\'  (or day + at).');
    else if (hasEvery) {
      if (typeof j.every_min !== 'number' || j.every_min % 1 !== 0 || j.every_min < 1 || j.every_min > 1440) problems.push(label + ': every_min must be a whole number from 1 to 1440.');
      else if (j.every_min < TICK_MINUTES) notes.push((j.name || label) + ' says every ' + j.every_min + ' minutes, but the timer only ticks every ' + TICK_MINUTES + ', so it will run every ' + TICK_MINUTES + ' minutes.');
    } else {
      if (!validAt_(j.at)) problems.push(label + ': at must look like \'07:00\' (24-hour, Eastern time).');
      if (hasDay && DAYS[j.day] === undefined) problems.push(label + ': day must be one of Sun Mon Tue Wed Thu Fri Sat.');
    }
    if (j.run === 'github') {
      if (!/^[\w.-]+\/[\w.-]+$/.test(j.repo || '')) problems.push(label + ': a github row needs repo like \'Ridge-Co/RidgeCo\'.');
      if (!/^[\w.-]+\.ya?ml$/.test(j.workflow || '')) problems.push(label + ': a github row needs workflow like \'drift-check.yml\'.');
      if (!j.ref) problems.push(label + ': a github row needs ref (the branch, usually \'main\').');
      if (j.inputs !== undefined && (typeof j.inputs !== 'object' || j.inputs === null || Array.isArray(j.inputs))) problems.push(label + ': inputs must be { name: \'value\' }.');
    } else if (j.repo || j.workflow || j.ref || j.inputs) problems.push(label + ': repo/workflow/ref/inputs only belong on a github row.');
  });
  return { ok: problems.length === 0, problems: problems, notes: notes };
}
// What the Hub is told: { jobName: { enabled, every_min } | { enabled, at } | { enabled, at, dow } } for the 'hub' rows.
function hubSchedule_() {
  var out = {};
  JOBS.forEach(function (j) {
    if (j.run !== 'hub') return;
    var o = { enabled: !!j.enabled };
    if (j.every_min !== undefined) o.every_min = j.every_min;
    else { o.at = j.at; if (j.day) o.dow = DAYS[j.day]; }
    out[j.name] = o;
  });
  return out;
}
function fmtTime_(at) { var m = atMinutes_(at), h = Math.floor(m / 60), mm = m % 60; return (h % 12 === 0 ? 12 : h % 12) + ':' + (mm < 10 ? '0' : '') + mm + (h < 12 ? ' AM' : ' PM'); }
function describe_(j) {
  if (j.every_min !== undefined) {
    var n = j.every_min;
    return n === 60 ? 'every hour' : (n % 60 === 0 ? 'every ' + (n / 60) + ' hours' : 'every ' + n + ' minutes');
  }
  return (j.day ? 'every ' + DAY_NAMES[DAYS[j.day]] : 'every day') + ' at ' + fmtTime_(j.at) + ' Eastern';
}
function showSchedule() {
  var table = checkJobs_();
  Logger.log('=== THE JOBS TABLE, IN PLAIN ENGLISH (edit it at the top of the script) ===');
  table.problems.forEach(function (m) { Logger.log('MISTAKE: ' + m); });
  var st = loadJobState_(), started = !!props_().getProperty('STARTED');
  JOBS.forEach(function (j) {
    var where = j.run === 'hub' ? 'Hub' : j.run === 'github' ? 'GitHub ' + j.workflow : j.run;
    Logger.log((j.enabled ? 'ON  ' : 'OFF ') + j.name + ' - ' + describe_(j) + ' [' + where + '] - ' + j.what);
  });
  Logger.log(started ? 'The scheduler is RUNNING (timer every ' + TICK_MINUTES + ' minutes).' : 'The scheduler is NOT started (run setup, then approveAndStart).');
  void st;
}

// ═══ 5. THE NON-HUB ROWS: due logic, state, runners ════════════════════════════════════════════════
function etParts_(ms) {
  var f = Utilities.formatDate(new Date(ms), 'America/New_York', 'yyyy-MM-dd HH:mm u').split(' ');
  var hm = f[1].split(':'), u = +f[2];
  return { date: f[0], minutes: (+hm[0]) * 60 + (+hm[1]), dow: u % 7 };
}
function loadJobState_() {
  var raw = props_().getProperty('JOB_STATE');
  if (!raw) return {};
  try { var j = JSON.parse(raw); if (j && typeof j === 'object' && !Array.isArray(j)) return j; throw new Error('not an object'); }
  catch (e) { alertThrottled_('jobstate', JOB_ALERT_MS, 'Hub scheduler lost its memory of the non-Hub jobs', 'The saved run history for the non-Hub jobs could not be read (' + e + '). It was reset, so daily jobs may run once more today. Nothing else is affected.'); props_().deleteProperty('JOB_STATE'); return {}; }
}
function saveJobState_(st) { props_().setProperty('JOB_STATE', JSON.stringify(st)); }
// Pure. Is this non-Hub row due? Returns { key } or null. Same rules as the Hub: intervals keep a minimum gap; daily/weekly
// run once per Eastern day once their time has passed (and catch up if a tick was missed); failures retry after 30 min, 3 tries a day.
function scriptJobDue_(job, js, nowMs) {
  js = js || {};
  if (job.every_min !== undefined) {
    var last = Date.parse(js.last_start || ''), gap = (job.every_min <= 1 ? 1 : job.every_min - 1) * 60000;
    if (!isNaN(last) && last <= nowMs + 5 * 60000 && nowMs - last < gap) return null;
    return { key: 'interval' };
  }
  var et = etParts_(nowMs);
  if (job.day && et.dow !== DAYS[job.day]) return null;
  if (et.minutes < atMinutes_(job.at)) return null;
  if (js.last_key === et.date) return null;
  var a = js.attempts;
  if (a && a.key === et.date && a.n > 0) {
    if (a.n >= MAX_ATTEMPTS) return null;
    var lastEnd = Date.parse(js.last_end || js.last_start || '');
    if (!isNaN(lastEnd) && nowMs - lastEnd < RETRY_GAP_MS) return null;
  }
  return { key: et.date };
}
// Pure. Is this non-Hub row overdue? -> '' or the reason.
function scriptJobOverdue_(job, js, nowMs) {
  js = js || {};
  var st = Date.parse(js.last_start || ''), en = Date.parse(js.last_end || '');
  if (!isNaN(st) && (isNaN(en) || en < st) && nowMs - st > 10 * 60000 && js.last_status === 'running') return 'started ' + Math.round((nowMs - st) / 60000) + ' min ago and never finished';
  if (job.every_min !== undefined) {
    var ok = Date.parse(js.last_ok || ''), limit = Math.max(OVERDUE_INTERVAL_MIN, 3 * job.every_min);
    if (isNaN(ok)) {
      // Never succeeded yet: only a problem once it has had a fair chance (a freshly started row, or a GitHub run still being checked, is not overdue).
      var first = Date.parse(js.first_start || '');
      return (!isNaN(first) && (nowMs - first) / 60000 > limit) ? 'has never completed successfully' : '';
    }
    var age = Math.round((nowMs - ok) / 60000);
    return age > limit ? 'last success was ' + age + ' min ago (limit ' + limit + ')' : '';
  }
  var et = etParts_(nowMs);
  if (job.day && et.dow !== DAYS[job.day]) return '';
  if (js.last_failed_final === et.date) return 'failed today and will not be retried automatically: ' + (js.last_error || '?');
  if (et.minutes >= atMinutes_(job.at) + OVERDUE_GRACE_MIN && js.ok_key !== et.date) return 'has not completed successfully for ' + et.date + ' (was due ' + job.at + ' ET)' + (js.last_error ? ' [last error: ' + String(js.last_error).slice(0, 150) + ']' : '');
  return '';
}
// First start only: daily/weekly rows whose slot already passed today (and have no history) are marked done for today.
function wouldSeedScriptJobs_(nowMs) {
  var st = loadJobState_(), et = etParts_(nowMs), out = [];
  JOBS.forEach(function (j) {
    if (j.run === 'hub' || !j.enabled || j.every_min !== undefined) return;
    if (st[j.name] && (st[j.name].last_key || st[j.name].last_start)) return;
    if (j.day && et.dow !== DAYS[j.day]) return;
    if (et.minutes < atMinutes_(j.at)) return;
    out.push(j.name);
  });
  return out;
}
function seedScriptJobs_(nowMs) {
  var names = wouldSeedScriptJobs_(nowMs), st = loadJobState_(), et = etParts_(nowMs);
  names.forEach(function (n) { st[n] = { last_key: et.date, ok_key: et.date, last_status: 'seeded', seeded_at: new Date(nowMs).toISOString() }; });
  if (names.length) saveJobState_(st);
  return names;
}

var NEEDS = {
  pinterest: ['SYNC_TOKEN'],
  barrelco_entry: ['BARRELCO_SHEET_ID', 'ENTRY_RUN_TOKEN'],
  str_tick: ['STR_ADMIN_TOKEN'],
  brettos_sync: ['BRETTOS_SECRET']
};
function ghTokenProp_(job) { return 'GITHUB_TOKEN_' + String(job.repo.split('/')[0]).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function needsOf_(job) { return job.run === 'github' ? [ghTokenProp_(job)] : (NEEDS[job.run] || []); }
function missingNeeds_(job) { return needsOf_(job).filter(function (k) { return !props_().getProperty(k); }); }
function propHelp_(k) {
  var h = {
    SYNC_TOKEN: 'the Pinterest sync secret: the same value as SYNC_TOKEN on the pinterest-sync Worker in Cloudflare',
    BARRELCO_SHEET_ID: 'the long ID in the web address of the BarrelCo "Barrel Tools" Google Sheet (docs.google.com/spreadsheets/d/THIS-PART/edit)',
    ENTRY_RUN_TOKEN: 'made for you by setup() once BARRELCO_SHEET_ID is set; do not type it',
    STR_ADMIN_TOKEN: 'the same value as ADMIN_TOKEN on the str-automation Worker in Cloudflare',
    BRETTOS_SECRET: 'the same value as WORKER_SECRET on the brett-os Worker in Cloudflare'
  };
  if (h[k]) return h[k];
  if (/^GITHUB_TOKEN_/.test(k)) return 'a GitHub fine-grained access token for the "' + k.replace('GITHUB_TOKEN_', '') + '" repositories with permission "Actions: Read and write" (github.com > Settings > Developer settings > Personal access tokens > Fine-grained)';
  return 'a secret value';
}

// Run every enabled non-Hub row that is due. Returns { ran:[names], status:{ overdue:[], jobs:{} } }.
function runScriptJobs_(started) {
  var st = loadJobState_(), now = Date.now(), ran = [], status = { overdue: [], jobs: {} };
  JOBS.forEach(function (job) {
    if (job.run === 'hub' || !job.enabled) return;
    var js = st[job.name] = st[job.name] || {};
    var miss = missingNeeds_(job);
    if (miss.length) {
      alertThrottled_('needs_' + job.name, NEEDS_ALERT_MS, 'Hub scheduler job needs a secret: ' + job.name, 'The job "' + job.name + '" (' + describe_(job) + ') is switched ON but is missing: ' + miss.map(function (k) { return k + ' - ' + propHelp_(k); }).join('; ') + '.\n\nAdd it in the Apps Script project: Project Settings (gear) > Script properties > Add script property, then run setup once more. Or switch the job off by setting enabled: false in the JOBS table. It is NOT running until then.');
      status.jobs[job.name] = { overdue: false, needs_setup: true };
      return;
    }
    if (job.run === 'github' && js.pending) {
      var v = verifyGithubRun_(job, js, now);
      if (v.alert) { jobFailure_({ ran: job.name, error: v.alert }); ledgerThrottled_('gh_' + job.name, JOB_ALERT_MS, 'github_workflow:' + job.name, 'P1', job.name + ': ' + v.alert); }
      saveJobState_(st);
    }
    var due = scriptJobDue_(job, js, now);
    if (due && !(job.run === 'github' && js.pending)) {
      if (Date.now() - started > MAX_RUN_MS) Logger.log('Out of time this tick; ' + job.name + ' will run on the next one.');
      else { var res = runOneScriptJob_(job, js, due, started); ran.push(job.name + (res.ok ? (res.partial ? ' (partly done; continues next tick)' : '') : ' (FAILED)')); saveJobState_(st); }
    }
    var od = scriptJobOverdue_(job, js, Date.now());
    status.jobs[job.name] = { overdue: !!od, overdue_reason: od, last_error: js.last_error || null };
    if (od) status.overdue.push(job.name);
  });
  saveJobState_(st);
  return { ran: ran, status: status };
}
function runOneScriptJob_(job, js, due, started) {
  var t0 = new Date().toISOString();
  if (!js.first_start) js.first_start = t0;
  js.last_start = t0; js.last_status = 'running';
  var res;
  try { res = RUNNERS[job.run](job, { deadline: started + MAX_RUN_MS - 15000 }); }
  catch (e) { res = { ok: false, errors: ['the job threw: ' + e] }; }
  if (!res || typeof res !== 'object') res = { ok: false, errors: ['the job returned nothing'] };
  var errors = res.errors || [], ok = res.ok !== false && errors.length === 0;
  var end = new Date().toISOString();
  js.last_end = end; js.duration_ms = Date.parse(end) - Date.parse(t0);
  js.last_error = ok ? null : errors.join(' | ').slice(0, 300);
  if (res.note) js.last_note = String(res.note).slice(0, 200);
  if (ok && res.partial) { js.last_status = 'partial'; }
  else if (ok && res.dispatched) {
    // GitHub: pressing Run worked; the RESULT is checked on later ticks (verifyGithubRun_).
    js.last_status = 'dispatched'; js.pending = { at: t0, key: due.key, repo: job.repo, workflow: job.workflow };
    if (job.every_min === undefined) { js.last_key = due.key; js.attempts = null; }
  } else if (ok) {
    js.last_status = 'ok'; js.last_ok = end; js.ok_key = due.key === 'interval' ? 'interval' : due.key;
    if (job.every_min === undefined) { js.last_key = due.key; js.attempts = null; js.last_failed_final = null; }
  } else {
    js.last_status = 'failed';
    if (job.every_min === undefined) { var a = js.attempts && js.attempts.key === due.key ? js.attempts.n : 0; js.attempts = { key: due.key, n: a + 1 }; }
    jobFailure_({ ran: job.name, error: js.last_error });
    ledgerThrottled_('job_' + job.name, JOB_ALERT_MS, 'script_job:' + job.name, 'P1', job.name + ' failed: ' + js.last_error);
  }
  if (res.warnings && res.warnings.length) alertThrottled_('warn_' + job.name, JOB_ALERT_MS, 'Hub scheduler job needs a look: ' + job.name, res.warnings.join('\n'));
  return { ok: ok, partial: !!res.partial };
}
function mergeStatus_(hub, script) {
  var out = { overdue: (hub.overdue || []).slice(), jobs: {} };
  Object.keys(hub.jobs || {}).forEach(function (k) { out.jobs[k] = hub.jobs[k]; });
  (script.overdue || []).forEach(function (n) { out.overdue.push(n); });
  Object.keys(script.jobs || {}).forEach(function (k) { out.jobs[k] = script.jobs[k]; });
  return out;
}

// ── generic HTTP for the other Workers (never throws; never puts a secret in a message) ─────────────
function http_(method, url, headers, payload) {
  var opts = { method: method, headers: headers || {}, muteHttpExceptions: true, followRedirects: false };
  if (method === 'post') { opts.contentType = 'application/json'; opts.payload = payload !== undefined ? JSON.stringify(payload) : '{}'; }
  var resp;
  try { resp = UrlFetchApp.fetch(url, opts); }
  catch (e) { return { ok: false, code: 0, problem: 'could not reach ' + url.replace(/\?.*$/, '') + ': ' + e }; }
  var code = resp.getResponseCode(), text = String(resp.getContentText() || ''), j = null;
  try { j = JSON.parse(text); } catch (e) { /* silent-ok: not JSON, callers that need it check the status */ }
  if (code < 200 || code >= 300) return { ok: false, code: code, body: j, text: text, problem: 'answered HTTP ' + code + ' for ' + url.replace(/\?.*$/, '') + ': ' + text.slice(0, 300) };
  return { ok: true, code: code, body: j, text: text };
}

var RUNNERS = { pinterest: runPinterest_, barrelco_entry: runBarrelEntry_, str_tick: runStrTick_, brettos_sync: runBrettos_, github: runGithub_ };

// Pinterest: the same loop the weekly GitHub Action ran - list the boards, then sync each in batches until nothing is left.
function runPinterest_(job, ctx) {
  var hdr = { Authorization: 'Bearer ' + props_().getProperty('SYNC_TOKEN') };
  var b = http_('get', PINTEREST_URL + '/boards', hdr);
  if (!b.ok) return { ok: false, errors: ['Pinterest sync: listing the boards ' + b.problem] };
  if (!b.body || !Array.isArray(b.body.boards)) return { ok: false, errors: ['Pinterest sync: the board list was not in the expected shape: ' + String(b.text).slice(0, 150)] };
  var errors = [], uploaded = 0, partial = false;
  outer: for (var i = 0; i < b.body.boards.length; i++) {
    var board = b.body.boards[i];
    for (var pass = 1; pass <= 20; pass++) {
      if (Date.now() > ctx.deadline) { partial = true; break outer; }
      var r = http_('post', PINTEREST_URL + '/sync?board=' + encodeURIComponent(board), hdr);
      if (!r.ok) { errors.push(board + ': ' + r.problem); break; }
      var d = r.body || {};
      if (d.error) { errors.push(board + ': ' + String(d.error).slice(0, 150)); break; }
      if (d.failed && d.failed.length) errors.push(board + ': ' + d.failed.length + ' pin(s) failed to copy');
      var up = Number(d.uploaded) || 0; uploaded += up;
      if (Number(d.remaining) === 0) break;
      if (!up) { errors.push(board + ': made no progress (' + d.remaining + ' left)'); break; }
    }
  }
  return { ok: errors.length === 0, errors: errors, partial: partial && errors.length === 0, note: 'copied ' + uploaded + ' new pin(s)' };
}

// BarrelCo entry sheet: ask the Worker to apply the new Entry rows. A row the user mistyped is shown in the sheet's own Status column;
// only a Worker-level problem (tab missing, Sheets down) fails the job, and rows left half-applied (CHECK) raise a warning email.
function runBarrelEntry_(job) {
  var r = http_('post', BARRELCO_URL + '/entry/run', { 'X-Auth-Token': props_().getProperty('ENTRY_RUN_TOKEN') }, {});
  if (!r.ok) {
    var hint = r.code === 404 ? ' (404: the BarrelCo Worker has not been updated with the /entry/run route yet - merge the BarrelCo pull request)' : r.code === 401 ? ' (401: the token in the BarrelCo sheet Config tab does not match; run setup again)' : '';
    return { ok: false, errors: ['BarrelCo entry: ' + r.problem + hint] };
  }
  var b = r.body || {};
  if (b.ok !== true || !Array.isArray(b.report)) return { ok: false, errors: ['BarrelCo entry: unexpected answer: ' + String(r.text).slice(0, 200)] };
  var errors = [], warnings = [], applied = 0, rowErrors = 0;
  b.report.forEach(function (x) {
    if (x.error) errors.push(x.label + ': ' + String(x.error).slice(0, 150));
    applied += x.ok || 0; rowErrors += x.errors || 0;
    if (x.checks) warnings.push('BarrelCo entry sheet "' + x.label + '": ' + x.checks + ' row(s) are marked CHECK (something may be half-applied). Compare Inventory and History before re-entering.');
  });
  return { ok: errors.length === 0, errors: errors, warnings: warnings, note: applied + ' row(s) applied' + (rowErrors ? ', ' + rowErrors + ' row(s) rejected (see the Status column in the sheet)' : '') };
}

function runStrTick_(job) {
  var r = http_('post', STR_URL + '/admin/tick', { 'x-admin-token': props_().getProperty('STR_ADMIN_TOKEN') }, {});
  if (!r.ok) return { ok: false, errors: ['STR tick: ' + r.problem + (r.code === 404 ? ' (the str-automation Worker has not been updated with /admin/tick yet)' : '')] };
  var b = r.body || {};
  if (b.ok !== true) return { ok: false, errors: ['STR tick: ' + String(r.text).slice(0, 200)] };
  return { ok: true, errors: [], note: b.ran ? 'ran the hourly job' : 'skipped: ' + (b.reason || 'ran recently') };
}

function runBrettos_(job) {
  var r = http_('post', BRETTOS_URL + '/entities/sync', { 'X-Secret': props_().getProperty('BRETTOS_SECRET') }, {});
  if (!r.ok) return { ok: false, errors: ['BrettOS sync: ' + r.problem] };
  var b = r.body || {}, res = b.results, errors = [];
  if (b.ok !== true || !res || typeof res !== 'object') return { ok: false, errors: ['BrettOS sync: unexpected answer: ' + String(r.text).slice(0, 200)] };
  // The Worker answers ok:true even when one of its three feeds failed, so look inside.
  Object.keys(res).forEach(function (k) { if (res[k] && res[k].ok === false) errors.push(k + ': ' + String(res[k].error || 'failed').slice(0, 150)); });
  return { ok: errors.length === 0, errors: errors, note: Object.keys(res).map(function (k) { return k + ' ' + (res[k] && res[k].count != null ? res[k].count : '?'); }).join(', ') };
}

// GitHub: press "Run workflow". The workflow keeps its own logic; only its timer moved here.
function ghHeaders_(job) { return { Authorization: 'Bearer ' + props_().getProperty(ghTokenProp_(job)), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function runGithub_(job) {
  var body = { ref: job.ref }; if (job.inputs) body.inputs = job.inputs;
  var r = http_('post', 'https://api.github.com/repos/' + job.repo + '/actions/workflows/' + job.workflow + '/dispatches', ghHeaders_(job), body);
  if (r.ok) return { ok: true, errors: [], dispatched: true, note: 'pressed Run' };
  var why = r.code === 401 ? 'the GitHub token is wrong or expired - make a new one and replace ' + ghTokenProp_(job)
    : (r.code === 403 || r.code === 404) ? 'the token cannot see ' + job.repo + ' or lacks "Actions: Read and write", or the workflow file ' + job.workflow + ' does not exist on ' + job.ref
    : r.code === 422 ? 'GitHub refused the request - the workflow may not accept Run-by-hand or does not take these inputs yet; has the matching pull request been merged?'
    : r.problem;
  return { ok: false, errors: [job.name + ': could not press Run on ' + job.workflow + ': ' + why + ' (GitHub said HTTP ' + r.code + ')'] };
}
// Look at the run a dispatch started. Returns { done, alert } and updates js. A red run is a failure (alert), a missing/stuck run too.
function verifyGithubRun_(job, js, nowMs) {
  var pend = js.pending, ageMin = (nowMs - Date.parse(pend.at)) / 60000;
  var r = http_('get', 'https://api.github.com/repos/' + job.repo + '/actions/workflows/' + job.workflow + '/runs?event=workflow_dispatch&per_page=10', ghHeaders_(job));
  if (!r.ok) { return ageMin > GH_STUCK_MIN ? finishGh_(js, false, 'could not check the result of ' + job.workflow + ': ' + r.problem) : { done: false }; }
  var runs = (r.body && r.body.workflow_runs) || [], since = Date.parse(pend.at) - 60000, mine = null;
  runs.forEach(function (x) { var c = Date.parse(x.created_at || ''); if (c >= since && (!mine || c > Date.parse(mine.created_at))) mine = x; });
  if (!mine) return ageMin > GH_NO_RUN_MIN ? finishGh_(js, false, job.workflow + ' was told to run ' + Math.round(ageMin) + ' minutes ago but no run appeared on GitHub') : { done: false };
  if (mine.status !== 'completed') return ageMin > GH_STUCK_MIN ? finishGh_(js, false, job.workflow + ' has been running for over ' + GH_STUCK_MIN + ' minutes (' + mine.html_url + ')') : { done: false };
  if (mine.conclusion === 'success') return finishGh_(js, true, '');
  return finishGh_(js, false, job.workflow + ' finished ' + String(mine.conclusion).toUpperCase() + ' (' + mine.html_url + ')');
}
function finishGh_(js, ok, msg) {
  var end = new Date().toISOString(), key = js.pending.key;
  js.pending = null; js.last_end = end;
  if (ok) { js.last_status = 'ok'; js.last_ok = end; js.ok_key = key; js.last_error = null; js.last_failed_final = null; return { done: true }; }
  js.last_status = 'failed'; js.last_error = msg.slice(0, 300);
  if (key !== 'interval') js.last_failed_final = key;
  return { done: true, alert: msg };
}

// ── read-only checks used by the preview ─────────────────────────────────────────────────────
function checkScriptJob_(job) {
  var p = props_();
  try {
    if (job.run === 'github') {
      var r = http_('get', 'https://api.github.com/repos/' + job.repo + '/actions/workflows/' + job.workflow, ghHeaders_(job));
      return r.ok ? { ok: true, line: 'GitHub token works and can see the workflow (it still needs "Actions: Read and write" to press Run).' } : { ok: false, line: 'GitHub says ' + r.problem };
    }
    if (job.run === 'pinterest') {
      var b = http_('get', PINTEREST_URL + '/boards', { Authorization: 'Bearer ' + p.getProperty('SYNC_TOKEN') });
      return b.ok ? { ok: true, line: 'Pinterest sync answered; boards: ' + ((b.body && b.body.boards) || []).join(', ') + '.' } : { ok: false, line: 'Pinterest sync ' + b.problem };
    }
    if (job.run === 'barrelco_entry') {
      var e = http_('post', BARRELCO_URL + '/entry/run', { 'X-Auth-Token': p.getProperty('ENTRY_RUN_TOKEN') }, { dry_run: true });
      if (!e.ok) return { ok: false, line: 'BarrelCo ' + e.problem + (e.code === 404 ? ' - the BarrelCo Worker does not have /entry/run yet (merge the BarrelCo pull request first).' : '') };
      return { ok: true, line: 'BarrelCo answered; Entry rows waiting right now: ' + JSON.stringify((e.body && e.body.waiting) || {}) + ' (nothing was changed).' };
    }
    if (job.run === 'str_tick') {
      var s = http_('get', STR_URL + '/admin/status', { 'x-admin-token': p.getProperty('STR_ADMIN_TOKEN') });
      return s.ok ? { ok: true, line: 'str-automation accepted the admin token.' } : { ok: false, line: 'str-automation ' + s.problem };
    }
    if (job.run === 'brettos_sync') {
      var o = http_('get', BRETTOS_URL + '/integration-log', { 'X-Secret': p.getProperty('BRETTOS_SECRET') });
      return o.ok ? { ok: true, line: 'BrettOS accepted the secret.' } : { ok: false, line: 'BrettOS ' + o.problem };
    }
  } catch (err) { return { ok: false, line: 'check failed: ' + err }; }
  return { ok: false, line: 'unknown job type' };
}

// ── BarrelCo entry token: made here, written into the BarrelCo sheet's Config tab (where that Worker reads it), read back ──
function setupBarrelEntryToken_() {
  var p = props_(), row = JOBS.filter(function (j) { return j.run === 'barrelco_entry' && j.enabled; })[0];
  if (!row) return;
  if (!p.getProperty('BARRELCO_SHEET_ID')) { Logger.log('BarrelCo entry job: skipped for now - it needs BARRELCO_SHEET_ID (' + propHelp_('BARRELCO_SHEET_ID') + '). Add it in Project Settings > Script properties and run setup again. The rest of setup continues.'); return; }
  if (!p.getProperty('ENTRY_RUN_TOKEN')) p.setProperty('ENTRY_RUN_TOKEN', 'er_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  try { writeConfigKey_(p.getProperty('BARRELCO_SHEET_ID'), ENTRY_TOKEN_KEY, p.getProperty('ENTRY_RUN_TOKEN'), 'BarrelCo', true); Logger.log('Verified: the BarrelCo entry token is saved in the BarrelCo sheet Config tab.'); }
  catch (e) { p.deleteProperty('ENTRY_RUN_TOKEN'); Logger.log('BarrelCo entry job: could not save its token in the BarrelCo sheet (' + e.message + '). Check BARRELCO_SHEET_ID. The rest of setup continues.'); }
}
// Put key=value on a sheet's Config tab (update the row if present, else append), then READ IT BACK. Throws if it did not stick.
function writeConfigKey_(sheetId, key, value, label, createTab) {
  var ss = SpreadsheetApp.openById(sheetId), sheet = ss.getSheetByName(CONFIG_TAB);
  if (!sheet && createTab) { sheet = ss.insertSheet(CONFIG_TAB); sheet.appendRow(['Key', 'Value']); }
  if (!sheet) { fatal_('the ' + label + ' sheet has no "' + CONFIG_TAB + '" tab', 'setup() could not find the Config tab in the ' + label + ' sheet (' + sheetId + ').'); }
  var vals = sheet.getDataRange().getValues(), row = -1;
  for (var i = 0; i < vals.length; i++) { if (String(vals[i][0]).trim() === key) { row = i + 1; break; } }
  if (row < 0) { sheet.appendRow([key, value]); row = sheet.getLastRow(); Logger.log('Added a "' + key + '" row to the ' + label + ' Config sheet.'); }
  else { Logger.log('Found the existing "' + key + '" row (row ' + row + ') in the ' + label + ' Config sheet; updating it.'); }
  var cell = sheet.getRange(row, 2);
  cell.setNumberFormat('@'); cell.setValue(value);
  SpreadsheetApp.flush();
  var back = String(sheet.getRange(row, 2).getValue());
  if (back !== value) { fatal_('could not save the ' + label + ' token in the sheet', 'setup() wrote the token to ' + label + ' Config row ' + row + ' but reading it back did not match. Nothing was started.'); }
}

// ═══ 6. ALERTS ═════════════════════════════════════════════════════════════════════════════════
function infraFailure_(problem) {
  var p = props_(), now = Date.now();
  Logger.log('PROBLEM: ' + problem);
  var since = Number(p.getProperty('FAIL_SINCE') || 0);
  if (!since) {
    p.setProperty('FAIL_SINCE', String(now)); p.setProperty('FAIL_LAST_ALERT', String(now));
    alert_('Hub scheduler is FAILING', 'The scheduler could not run the Hub\'s jobs:\n\n' + problem + '\n\nNothing scheduled on the Hub (quiet-hours texts, reminders, daily jobs) is running until this is fixed. It retries every ' + TICK_MINUTES + ' minutes and I will email again at most hourly, and when it recovers.');
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
  alertThrottled_('job_' + b.ran, JOB_ALERT_MS, 'Job FAILED: ' + b.ran, 'The job "' + b.ran + '" failed:\n\n' + String(b.error || '(no detail)').slice(0, 1500) + '\n\nHub jobs are also logged in the Hub\'s Ops_Telemetry tab (Job_Type scheduler_job). Interval jobs retry on the next tick; daily jobs retry a couple of times that day. I email at most once per job every 3 hours.');
}
function checkOverdue_(status) {
  var p = props_(), now = Date.now();
  var overdue = (status && status.overdue) ? status.overdue.slice().sort() : [];
  var seen = JSON.parse(p.getProperty('OVERDUE_SEEN') || '{}'), k;
  for (k in seen) { if (now - seen[k] > 24 * 3600 * 1000) delete seen[k]; }
  if (!overdue.length) {
    if (p.getProperty('OVERDUE_ACTIVE')) { p.deleteProperty('OVERDUE_ACTIVE'); alert_('Hub scheduler: back on schedule', 'No job is overdue any more.'); }
    p.setProperty('OVERDUE_SEEN', JSON.stringify(seen)); return;
  }
  var key = overdue.join(',');
  if (!seen[key] || now - seen[key] >= OVERDUE_ALERT_MS) {
    seen[key] = now; p.setProperty('OVERDUE_ACTIVE', '1');
    var lines = overdue.map(function (n) { var j = status.jobs && status.jobs[n] || {}; return '  - ' + n + ': ' + (j.overdue_reason || 'overdue') + (j.last_error ? ' [last error: ' + String(j.last_error).slice(0, 200) + ']' : ''); });
    alert_('Jobs OVERDUE: ' + overdue.join(', '), 'These jobs did not run when they should have:\n\n' + lines.join('\n') + '\n\nFor detail run statusReport in the Hub Scheduler Apps Script project.');
  }
  p.setProperty('OVERDUE_SEEN', JSON.stringify(seen));
}
// ── Failure ledger: the independent second path (email), the report helper, and Worker health probes ───────────────
// The Hub texts urgent problems, but if texting itself is what is broken (or the alert switch is off) the text never arrives. So every
// tick the Hub's /cron/status also returns a summary of the failure ledger and THIS script emails about any urgent, unacknowledged problem.
// Acknowledge a problem on the Needs Attention page to silence it.
function checkLedger_(f) {
  var p = props_(), now = Date.now();
  if (f === undefined) { Logger.log('The Hub did not include a failure-ledger summary in /cron/status (older Hub build); nothing to check.'); return; }
  if (!f || f.ok === false) {
    alertThrottled_('ledger_unreadable', LEDGER_REMIND_MS, 'Hub failure ledger could not be read', 'The Hub could not read its failure ledger, so urgent problems may be invisible right now:\n\n' + String(f && f.error || '(no detail)').slice(0, 500));
    return;
  }
  var items = f.p0_unack || [];
  if (!items.length) { p.deleteProperty('LEDGER_P0_KEY'); p.deleteProperty('LEDGER_P0_AT'); return; }
  var key = items.map(function (i) { return i.id; }).sort().join(','), lastKey = p.getProperty('LEDGER_P0_KEY'), lastAt = Number(p.getProperty('LEDGER_P0_AT') || 0);
  if (key === lastKey && now - lastAt < LEDGER_REMIND_MS) return;
  p.setProperty('LEDGER_P0_KEY', key); p.setProperty('LEDGER_P0_AT', String(now));
  var lines = items.map(function (i) { return '  - ' + i.where + (i.count > 1 ? ' (' + i.count + 'x)' : '') + ': ' + String(i.message).slice(0, 220) + '  [first seen ' + i.first_seen + ']'; });
  alert_('URGENT: ' + items.length + ' Hub problem' + (items.length === 1 ? '' : 's') + ' need you',
    'These urgent problems are open in the Hub failure ledger and nobody has acknowledged them:\n\n' + lines.join('\n') +
    '\n\n(' + (f.open || 0) + ' open in total, ' + (f.P1 || 0) + ' important.) Open the Hub, then Needs Attention, to acknowledge, fix or copy a brief for Claude. This email repeats every 6 hours while the list is unchanged; acknowledging silences it.\n\nThis message comes from the Apps Script scheduler, not from the Hub, so it still arrives if Hub texting is down.');
}
// Never throws. Reports to the Hub ledger with the scheduler token (trusted: real system and severity). If the Hub is down this cannot work, and the email path covers that.
function ledger_(where, severity, message) {
  try {
    var token = props_().getProperty('SCHEDULER_TOKEN');
    if (!token) return false;
    var resp = UrlFetchApp.fetch(WORKER_URL + '/failure/report', { method: 'post', contentType: 'application/json', headers: { 'X-Auth-Token': token }, followRedirects: false, muteHttpExceptions: true,
      payload: JSON.stringify({ system: 'scheduler', source: 'apps-script', where: where, severity: severity, message: String(message).slice(0, 300) }) });
    if (resp.getResponseCode() !== 200) { Logger.log('LEDGER REPORT NOT ACCEPTED (HTTP ' + resp.getResponseCode() + '): ' + where + ' | ' + message); return false; }
    return true;
  } catch (e) { Logger.log('LEDGER REPORT FAILED: ' + e + ' | ' + where + ' | ' + message); return false; }
}
function ledgerThrottled_(key, windowMs, where, severity, message) {
  var p = props_(), k = 'LAST_LEDGER_' + key, last = Number(p.getProperty(k) || 0);
  if (Date.now() - last < windowMs) return;
  if (ledger_(where, severity, message)) p.setProperty(k, String(Date.now()));
}
// GET /health on each Worker in PROBES. Reports only after PROBE_FAILS_BEFORE_ALERT failures in a row; emails once per 6 h; says when it recovers.
function probeWorkers_() {
  var p = props_(), st = {};
  try { st = JSON.parse(p.getProperty('PROBE_STATE') || '{}') || {}; } catch (e) { st = {}; Logger.log('PROBE_STATE was not valid JSON; starting fresh.'); }
  PROBES.forEach(function (pr) {
    var s = st[pr.name] || { fails: 0, alerted: false }, code = 0, err = '', text = '';
    try { var resp = UrlFetchApp.fetch(pr.url + '/health', { method: 'get', muteHttpExceptions: true, followRedirects: false }); code = resp.getResponseCode(); if (pr.body) text = String(resp.getContentText() || ''); }
    catch (e) { err = String(e).slice(0, 200); }
    var down = !!err || code === 0 || code >= 500, why = err || ('HTTP ' + code);
    if (down) {
      s.fails = (s.fails || 0) + 1; s.last = why;
      if (s.fails >= PROBE_FAILS_BEFORE_ALERT) {
        s.alerted = true;
        alertThrottled_('probe_' + pr.name, LEDGER_REMIND_MS, 'Worker DOWN: ' + pr.name, 'The Worker "' + pr.name + '" (' + pr.url + ') has failed its health check ' + s.fails + ' ticks in a row. Last answer: ' + why + '.\n\nAnything that depends on it is not working until it is fixed.');
        ledgerThrottled_('probe_' + pr.name, LEDGER_REMIND_MS, 'worker_probe:' + pr.name, 'P1', pr.name + ' health check failing (' + why + ', ' + s.fails + ' ticks in a row)');
      }
    } else {
      // a crash while reading the body must not stop PROBE_STATE from being saved for every Worker: report it as a watcher miss instead
      if (pr.body === 'str') { try { probeStrBody_(pr, code, text); } catch (be) { watcherMiss_('probe_body_' + pr.name, 'probe_body:' + pr.name, pr.name + ' /health body check crashed: ' + String(be).slice(0, 200)); } }
      if (s.alerted) alert_('Worker back up: ' + pr.name, 'The Worker "' + pr.name + '" is answering its health check again (HTTP ' + code + ').');
      s = { fails: 0, alerted: false };
    }
    st[pr.name] = s;
  });
  p.setProperty('PROBE_STATE', JSON.stringify(st));
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

// ═══ 7. TRIGGERS ═══════════════════════════════════════════════════════════════════════════════
function schedulerTriggers_() { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === HANDLER; }); }
function deleteSchedulerTriggers_() { var ts = schedulerTriggers_(); ts.forEach(function (t) { ScriptApp.deleteTrigger(t); }); return ts.length; }
// More than one timer = two ticks racing. Keep one, delete the rest, tell Brett.
function dedupeTriggers_() {
  var ts = schedulerTriggers_();
  if (ts.length <= 1) return;
  for (var i = 1; i < ts.length; i++) ScriptApp.deleteTrigger(ts[i]);
  alert_('Hub scheduler had ' + ts.length + ' timers', 'I found ' + ts.length + ' timers for ' + HANDLER + ' (they would run it twice per tick) and deleted ' + (ts.length - 1) + '. One remains.');
}

// ═══ 8. UTILITIES YOU CAN RUN FROM THE DROPDOWN ═══════════════════════════════════════════════════
function statusReport() {
  var token = props_().getProperty('SCHEDULER_TOKEN');
  if (!token) { Logger.log('Not set up yet: run setup().'); return; }
  Logger.log('The scheduler is ' + (props_().getProperty('STARTED') ? 'RUNNING' : 'NOT STARTED (run approveAndStart when you are ready)') + '. Timers installed here: ' + schedulerTriggers_().length + ' (should be ' + (props_().getProperty('STARTED') ? '1' : '0') + ')');
  var r = hub_('get', '/cron/status', token);
  if (!r.ok) { Logger.log('Could not get the Hub status: ' + r.problem); }
  else {
    var s = r.body;
    Logger.log('Hub time: ' + s.now + ' | last tick: ' + (s.last_tick || 'never') + (s.tick_age_min != null ? ' (' + s.tick_age_min + ' min ago)' : ''));
    if (s.schedule_error) Logger.log('WARNING: ' + s.schedule_error);
    Object.keys(s.jobs || {}).forEach(function (n) {
      var j = s.jobs[n];
      Logger.log((j.enabled === false ? 'off        ' : j.overdue ? '!! OVERDUE ' : 'ok         ') + n + ' — ' + j.expected + ' — last success: ' + (j.last_ok || 'never') + (j.last_error ? ' — last error: ' + j.last_error : '') + (j.overdue ? ' — ' + j.overdue_reason : ''));
    });
    Logger.log(s.overdue && s.overdue.length ? 'HUB OVERDUE: ' + s.overdue.join(', ') : 'Nothing on the Hub is overdue.');
  }
  var st = loadJobState_(), now = Date.now(), over = [];
  JOBS.forEach(function (job) {
    if (job.run === 'hub') return;
    var js = st[job.name] || {};
    if (!job.enabled) { Logger.log('off        ' + job.name + ' — ' + describe_(job)); return; }
    var miss = missingNeeds_(job);
    if (miss.length) { Logger.log('NEEDS SETUP ' + job.name + ' — ' + describe_(job) + ' — missing ' + miss.join(', ')); return; }
    var od = scriptJobOverdue_(job, js, now);
    if (od) over.push(job.name);
    Logger.log((od ? '!! OVERDUE ' : 'ok         ') + job.name + ' — ' + describe_(job) + ' — last success: ' + (js.last_ok || 'never') + (js.last_status === 'dispatched' ? ' — waiting for GitHub to finish' : '') + (js.last_error ? ' — last error: ' + js.last_error : '') + (js.last_note ? ' — ' + js.last_note : '') + (od ? ' — ' + od : ''));
  });
  Logger.log(over.length ? 'OTHER JOBS OVERDUE: ' + over.join(', ') : 'None of the other jobs is overdue.');
}
// Turns the scheduler OFF. Nothing will run on a schedule afterwards (there is no cron fallback by design).
// To turn it back on, run approveAndStart.
function removeScheduler() {
  var n = deleteSchedulerTriggers_();
  props_().deleteProperty('STARTED');
  Logger.log('Deleted ' + n + ' timer(s). The scheduler is now OFF: no quiet-hours releases, reminders, daily jobs, reports, GitHub checks or Worker calls will run until you run approveAndStart again.');
  Logger.log('To remove it completely: also delete this Apps Script project, and delete the "' + TOKEN_KEY + '" row in the Hub Config sheet.');
}
