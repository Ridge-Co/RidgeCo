/**
 * BUILDIUM EMAIL → HUB WORK ORDERS  (v1.0, Oct 12 2026 — backlog B-103)
 * ---------------------------------------------------------------------------------------------
 * When a customer on Buildium (Phoenix Estate Rentals, LLC today) posts a work order to you,
 * Buildium emails brett@ twice from donotreply@managebuilding.com:
 *     1. "New work order: <address>"                  ← link-only notice. This script IGNORES it.
 *     2. "Phoenix Estate Rentals, LLC: Work order N"  ← the detailed email. THIS is the one used.
 * Every minute this script finds new detailed emails and hands each one to the Hub
 * (POST /intake/email). The Hub reads it, matches the property/unit, creates the Work Order, and
 * texts you straight away (any hour). If it can't place the job with certainty it does NOT create
 * a junk work order; it parks it in the Hub's Intake_Queue tab and texts you instead.
 *
 * NO AI IN HERE. Plain Gmail search + one HTTPS call. Nothing is deleted or archived; processed
 * emails just get the label "Buildium/Sent to Hub" (or "Buildium/Needs Attention" if the Hub
 * parked it or something went wrong).
 *
 * NOTHING FAILS SILENTLY:
 *   - Hub unreachable / error      → retried every minute; you get an email on the first failure
 *                                    and a reminder email every hour it keeps failing.
 *   - Hub parked it / SMS not sent → you get an email saying so.
 *   - Emails dated BEFORE setup() was run are never imported (no backfill, no surprise WOs).
 *
 * SETUP (once, about 3 minutes; mailbox = brett@bmoremanagement.com):
 *   a. script.google.com → New project → paste this file over Code.gs → Save.
 *   b. Project Settings (gear) → tick "Show appsscript.json" → back in Editor, paste the companion
 *      appsscript.json over it → Save.
 *   c. Pick "setup" in the function dropdown → Run → approve the permissions prompt.
 *      Then open View → Logs (or Executions) and copy the long INTAKE_TOKEN line it prints.
 *   d. Cloudflare → Workers → maintenance-hub → Settings → Variables and Secrets → Add →
 *      type Secret, name INTAKE_TOKEN, value = that token → Deploy.
 *   e. (Optional sanity check) pick "dryRunLatest" → Run → the log shows what the Hub would do with
 *      the newest Phoenix email, without creating anything.
 */

// ── Fixed names ──────────────────────────────────────────────────────────────────────────────
var WORKER_URL    = 'https://maintenance-hub.brett-2f8.workers.dev';
var NOTIFY_EMAIL  = 'brett@bmoremanagement.com';
var LABEL_DONE    = 'Buildium/Sent to Hub';
var LABEL_ATTN    = 'Buildium/Needs Attention';
var SEARCH_BASE   = 'from:donotreply@managebuilding.com subject:"Work order" -subject:"New work order"';
var MAX_PER_RUN   = 10;
var LOOKBACK_MS   = 14 * 24 * 3600 * 1000;
var KEEP_IDS      = 300;

function props_() { return PropertiesService.getScriptProperties(); }

// ── One-time setup ───────────────────────────────────────────────────────────────────────────
function setup() {
  var p = props_();
  if (!p.getProperty('INTAKE_TOKEN')) {
    p.setProperty('INTAKE_TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  if (!p.getProperty('CUTOFF_MS')) p.setProperty('CUTOFF_MS', String(Date.now()));   // nothing older is ever imported
  label_(LABEL_DONE); label_(LABEL_ATTN);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processBuildiumEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processBuildiumEmails').timeBased().everyMinutes(1).create();
  Logger.log('Trigger installed: processBuildiumEmails every 1 minute.');
  Logger.log('Only emails received after ' + new Date(Number(p.getProperty('CUTOFF_MS'))).toString() + ' will be imported.');
  Logger.log('INTAKE_TOKEN (paste into Cloudflare as a Secret named INTAKE_TOKEN): ' + p.getProperty('INTAKE_TOKEN'));
}

function showToken() { Logger.log('INTAKE_TOKEN: ' + props_().getProperty('INTAKE_TOKEN')); }

// ── Main loop (1-minute trigger) ─────────────────────────────────────────────────────────────
function processBuildiumEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;                       // a previous run is still going; skip this minute
  try {
    var p = props_();
    var token = p.getProperty('INTAKE_TOKEN');
    var cutoff = Number(p.getProperty('CUTOFF_MS') || 0);
    if (!token || !cutoff) { alertThrottled_('notsetup', 'Buildium intake is not set up', 'Run setup() once in the Apps Script project "Buildium Intake".'); return; }
    var done = JSON.parse(p.getProperty('DONE_IDS') || '[]');
    var fails = JSON.parse(p.getProperty('FAILS') || '{}');
    var since = Math.floor(Math.max(cutoff, Date.now() - LOOKBACK_MS) / 1000);
    var threads = GmailApp.search(SEARCH_BASE + ' after:' + since, 0, 30);
    var handled = 0;
    for (var ti = 0; ti < threads.length && handled < MAX_PER_RUN; ti++) {
      var msgs = threads[ti].getMessages();
      for (var mi = 0; mi < msgs.length && handled < MAX_PER_RUN; mi++) {
        var m = msgs[mi];
        if (done.indexOf(m.getId()) >= 0) continue;
        if (!eligible_(m, cutoff)) {
          // A Buildium email we don't recognise (format change, "updated"/"cancelled" notice...): tell Brett ONCE instead of ignoring it.
          if (m.getDate().getTime() >= cutoff && senderOk_(m.getFrom()) && !/^\s*New work order/i.test(m.getSubject())) {
            done.push(m.getId());
            alert_('Buildium email not imported (unrecognised format)', 'Subject: ' + m.getSubject() + '\nReceived: ' + m.getDate() + '\n\nThe importer only handles "<Org>: Work order <number>" emails. If this is a new work order, tell Claude so the format can be added.');
            threads[ti].addLabel(label_(LABEL_ATTN));
          }
          continue;
        }
        handled++;
        var r = send_(m, token, false);
        if (r.ok) {
          done.push(m.getId()); delete fails[m.getId()];
          threads[ti].addLabel(label_(r.attention ? LABEL_ATTN : LABEL_DONE));
          if (r.attention) alert_('Buildium work order needs your attention', r.attentionText + '\n\nEmail: ' + m.getSubject() + '\nHub response: ' + r.raw);
        } else {
          var f = fails[m.getId()] || { n: 0 }; f.n++; fails[m.getId()] = f;
          if (f.n === 1 || f.n % 60 === 0) {
            alert_('Buildium email NOT imported (attempt ' + f.n + ')', 'Email: ' + m.getSubject() + '\nReceived: ' + m.getDate() + '\nProblem: ' + r.raw + '\n\nThe script retries every minute. If this keeps failing, tell Claude.');
          }
          threads[ti].addLabel(label_(LABEL_ATTN));
        }
      }
    }
    if (done.length > KEEP_IDS) done = done.slice(done.length - KEEP_IDS);
    p.setProperty('DONE_IDS', JSON.stringify(done));
    p.setProperty('FAILS', JSON.stringify(fails));
  } catch (e) {
    // Never die quietly: an exception here (Gmail quota, label error, ...) would otherwise just skip this minute.
    alertThrottled_('exception', 'Buildium intake script error', 'processBuildiumEmails threw: ' + e + (e && e.stack ? '\n' + e.stack : '') + '\n\nIt will retry next minute. If you keep getting this, tell Claude.');
  } finally {
    lock.releaseLock();
  }
}

// The REAL sender address must be on managebuilding.com (bare, or the last <...> of "Name <addr>").
// A display name such as "donotreply@managebuilding.com" <x@evil.io> must not pass.
function senderOk_(from) {
  return /(?:^|<)\s*[^<>\s@]{1,64}@(?:[a-z0-9-]{1,63}\.){0,4}managebuilding\.com\s*>?\s*$/i.test(String(from || '').slice(0, 300));
}

function eligible_(m, cutoff) {
  if (m.getDate().getTime() < cutoff) return false;
  if (!senderOk_(m.getFrom())) return false;
  var s = m.getSubject();
  return /Work order\s+#?\d+\s*$/i.test(s) && !/^\s*New work order/i.test(s);
}

function send_(m, token, dry) {
  var payload = {
    subject: m.getSubject(), body: m.getPlainBody(), from: m.getFrom(),
    message_id: (dry ? 'DRYRUN-' : '') + m.getId(), received_at: m.getDate().toISOString(), dry_run: !!dry
  };
  var resp;
  try {
    resp = UrlFetchApp.fetch(WORKER_URL + '/intake/email', {
      method: 'post', contentType: 'application/json', headers: { 'X-Auth-Token': token },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (e) { return { ok: false, raw: 'network error: ' + e }; }
  var code = resp.getResponseCode(), raw = resp.getContentText().slice(0, 600), j = null;
  try { j = JSON.parse(resp.getContentText()); } catch (e) { /* silent-ok: unparseable body makes j null so the line below returns ok:false and the caller emails Brett */ }
  if (code !== 200 || !j || j.success !== true) return { ok: false, raw: 'HTTP ' + code + ' ' + raw };
  var attention = false, text = '';
  if (j.parked) { attention = true; text = 'The Hub did NOT create a work order for this one (' + j.reason + ': ' + j.detail + '). It is parked in the Hub Intake_Queue tab (row ' + j.queue_id + ').' + (j.queue_updated === false ? ' (The Hub could not update the queue row after texting you.)' : '') + (j.telemetry_ok === false ? ' (The Hub could not write its log row.)' : ''); }
  else if (j.created && j.sms_sent === false) { attention = true; text = 'Work order ' + j.wo_id + ' WAS created, but the text message to you did not go out (' + j.sms_status + ').'; }
  else if (j.created && j.telemetry_ok === false) { attention = true; text = 'Work order ' + j.wo_id + ' was created and you were texted, but the Hub could not write its log row.'; }
  return { ok: true, attention: attention, attentionText: text, raw: raw, json: j };
}

// ── Sanity check: what would the Hub do with the newest Phoenix email? (creates nothing) ──────
function dryRunLatest() {
  var token = props_().getProperty('INTAKE_TOKEN');
  var threads = GmailApp.search(SEARCH_BASE, 0, 5);
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var k = msgs.length - 1; k >= 0; k--) {
      if (/Work order\s+#?\d+\s*$/i.test(msgs[k].getSubject())) {
        var r = send_(msgs[k], token, true);
        Logger.log('Email: ' + msgs[k].getSubject() + ' (' + msgs[k].getDate() + ')');
        Logger.log('Hub says: ' + (r.ok ? JSON.stringify(r.json) : 'FAILED ' + r.raw));
        return;
      }
    }
  }
  Logger.log('No "Work order" email found to test with.');
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
function alert_(subject, body) {
  try { MailApp.sendEmail(NOTIFY_EMAIL, '[Hub intake] ' + subject, body); }
  catch (e) {
    Logger.log('ALERT EMAIL FAILED: ' + e + ' | ' + subject + ' | ' + body);
    // Last resort: a failing run shows up as an error in Apps Script's Executions list / trigger-failure emails.
    throw new Error('Hub intake alert could not be emailed: ' + subject);
  }
}
// At most one email per key per hour (so a stuck condition cannot flood the mailbox).
function alertThrottled_(key, subject, body) {
  var p = props_(), k = 'LAST_ALERT_' + key, last = Number(p.getProperty(k) || 0);
  if (Date.now() - last < 3600 * 1000) return;
  p.setProperty(k, String(Date.now()));
  alert_(subject, body);
}
