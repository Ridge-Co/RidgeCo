/**
 * DELIVERY EMAILS -> HUB  (Delivery system Phase 1, the mailbox side)
 * ---------------------------------------------------------------------------------------------
 * ONE IDENTICAL FILE, PASTED INTO EVERY MAILBOX THAT MIGHT RECEIVE STORE EMAILS.
 * Nothing in this file is specific to one mailbox. Which mailbox it is running in comes from
 * Google (Session.getActiveUser), and everything you choose (the shared calendar, who gets the
 * alert emails, the token) lives in Script Properties, which is the SAME block in every copy.
 * If a delivery email reaches two of your mailboxes, both copies may see it; the Hub and the
 * calendar logic make sure it is counted ONCE (one record, one text to you, one tenant request,
 * one calendar event). When you change this file, paste the SAME file into every copy and
 * compare the SCRIPT_VERSION that status() prints.
 *
 * When you order an appliance (Home Depot, Lowe's, Ace, Walmart), the store emails an order
 * confirmation, a delivery date, a delivery window, "your driver is N stops away", "delivered",
 * reschedule and cancel notices. Every minute this script finds the NEW ones in this mailbox and
 * hands each one to the Hub (POST /intake/delivery-email). The Hub reads it, creates or updates the
 * Delivery record, links the property / work order, and texts you. THIS script then puts the
 * delivery on the shared Google Calendar (one event per order, moved or deleted when the store
 * changes it).
 *
 * NO AI IN HERE. Plain Gmail search + one HTTPS call + Calendar. The Hub decides what each email
 * is. Marketing that slips through comes back as "not_delivery" and is labelled Delivery/Ignored
 * quietly. Nothing is deleted or archived.
 *
 * LABELS this script puts on the Gmail thread (labels belong to each mailbox separately):
 *   Delivery/Sent to Hub      - the Hub took it (including "the Hub already had it").
 *   Delivery/Needs Attention  - something needs you (you also get an email saying what).
 *   Delivery/Ignored          - the Hub says it is not about a delivery (no alert).
 *
 * NOTHING FAILS SILENTLY (this script emails the ALERT_EMAIL address only when something is
 * WRONG; the Hub sends the normal delivery texts):
 *   - Hub unreachable / error / wrong token -> retried every minute; email on the first failure,
 *                                              then a reminder every hour while it keeps failing.
 *   - Hub parked it, could not text you, could not match the property -> email saying so.
 *   - Calendar write failed -> email with the event details so you can add it by hand. (The Hub
 *                              record was already saved, so the email still counts as handled.)
 *   - Token or setup missing -> email (at most one an hour). The script never just does nothing.
 *   - Emails dated BEFORE setup() was first run are never imported (no backfill).
 *
 * SETUP (once per mailbox, about 5 minutes, on a Chromebook in Chrome). DO IT BEFORE YOU ORDER.
 * The full step-by-step with the exact Script Properties block is in
 * context/DELIVERY_INTAKE_SETUP_v1.0.md. Short version:
 *   1. Open script.google.com while signed in to the mailbox. New project, name it Delivery Intake.
 *   2. Paste this whole file over Code.gs. Paste the companion appsscript.json over the manifest
 *      (Project Settings -> tick "Show appsscript.json manifest file in editor"). Save.
 *   3. Project Settings -> Script Properties: add the SAME properties in every mailbox:
 *        INTAKE_TOKEN  (copy from showToken() in the Buildium Intake project)
 *        CALENDAR_ID   (the one shared calendar all mailboxes write to)
 *        ALERT_EMAIL   (where the failure emails go)
 *      (Or use setConfig(), see below.)
 *   4. Pick setup in the function dropdown, Run, approve the permissions.
 *   5. Run status and compare SCRIPT_VERSION and "Config fingerprint" with the other mailboxes.
 *   6. Optional: testCalendar, dryRunLatest.
 */

// ── Fixed names ──────────────────────────────────────────────────────────────────────────────
var WORKER_URL    = 'https://maintenance-hub.brett-2f8.workers.dev';
var HUB_PATH      = '/intake/delivery-email';
// Bump this whenever the file changes. status() prints it; after pasting a new version into one mailbox,
// paste the SAME file into the others and compare the numbers.
var SCRIPT_VERSION = '1.1.0';
var CONFIG_KEYS   = ['INTAKE_TOKEN', 'CALENDAR_ID', 'ALERT_EMAIL', 'SENDER_DOMAINS'];   // the only Script Properties the person sets
var LABEL_DONE    = 'Delivery/Sent to Hub';
var LABEL_ATTN    = 'Delivery/Needs Attention';
var LABEL_IGN     = 'Delivery/Ignored';
var HANDLER       = 'processDeliveryEmails';
// Same as the Hub's Config key Delivery_Sender_Domains default. Override here with the Script Property SENDER_DOMAINS (comma list).
var DEFAULT_DOMAINS = ['homedepot.com', 'lowes.com', 'acehardware.com', 'walmart.com'];
var MAX_PER_RUN   = 10;
var MAX_RETRY_PER_RUN = 3;                      // previously-failed emails retried per run, so a stuck one cannot starve new mail
var LOOKBACK_MS   = 14 * 24 * 3600 * 1000;
var KEEP_IDS      = 400;
var KEEP_EVENTS   = 40;                          // key -> calendar event hint only; the calendar itself is searched by key (see findAllByKey_)
var KEEP_FAILS    = 50;
var KEEP_ALERTS   = 8;
var ALERT_BODY_MAX = 1500;
var FAIL_LAST_MAX = 100;
// A Script Property value may not exceed 9 KB (9216 bytes) or setProperty throws. Everything stored as JSON is trimmed to fit under this.
var PROP_MAX_BYTES = 8500;
var CAL_BACK_DAYS = 14, CAL_AHEAD_DAYS = 400;    // how far the calendar is searched for an existing event with the same key
var KEY_HINT_MS   = 10 * 60 * 1000;              // trust our own key->event hint only this long (calendar search can lag right after a create)
var CAL_SETTLE_MS = 1500;                        // pause after creating an event, then check no other copy created one too
var HTML_MAX      = 200000;
var BODY_MAX      = 200000;
var ALERT_EVERY_MS = 3600 * 1000;
var TAG_NAME      = 'deliveryKey';

var KEYWORDS_Q = '(order OR delivery OR delivered OR deliver OR schedule OR scheduled OR arrive OR arriving OR arrival OR reschedule OR rescheduled OR cancel OR cancelled OR canceled OR tracking OR "stops away" OR "on its way")';
var NOT_MARKETING_Q = '-subject:(coupon OR "special offer" OR "save up to" OR "sale ends")';
// Gmail sometimes files real order mail under Promotions; rescue only the unmistakable ones.
var RESCUE_Q = 'category:promotions subject:("your order" OR "order confirmation" OR "scheduled for delivery" OR "out for delivery" OR "stops away" OR "on its way" OR "has been delivered" OR "rescheduled" OR "delivery window" OR "delivery date")';

function props_() { return PropertiesService.getScriptProperties(); }
function json_(s, dflt) { try { var v = JSON.parse(s || ''); return (v === null || v === undefined) ? dflt : v; } catch (e) { return dflt; } }
function utf8Len_(s) {
  s = String(s == null ? '' : s); var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } else n += 3;
  }
  return n;
}
// Saves a list or a map as JSON that is guaranteed to fit in one Script Property: oldest entries are dropped until it fits.
// (A map keeps the entries with the largest obj[k][field].) Returns the value actually saved.
function saveJson_(key, value, keep, field) {
  var isList = Array.isArray(value), v = value, k = keep;
  for (var guard = 0; guard < 60; guard++) {
    v = isList ? trimIds_(value, k) : trimMap_(value, k, field);
    if (utf8Len_(JSON.stringify(v)) <= PROP_MAX_BYTES || k <= 1) break;
    k = Math.max(1, Math.floor(k * 0.8));
  }
  props_().setProperty(key, JSON.stringify(v));
  return v;
}

// ── One-time setup ───────────────────────────────────────────────────────────────────────────
function setup() {
  var p = props_();
  if (!p.getProperty('CUTOFF_MS')) p.setProperty('CUTOFF_MS', String(Date.now()));   // nothing older is ever imported
  label_(LABEL_DONE); label_(LABEL_ATTN); label_(LABEL_IGN);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === HANDLER) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(1).create();
  var n = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === HANDLER; }).length;
  Logger.log('Trigger installed: ' + HANDLER + ' every 1 minute (' + n + ' trigger' + (n === 1 ? '' : 's') + ' for it; should be exactly 1).');
  Logger.log('Only emails received after ' + new Date(Number(p.getProperty('CUTOFF_MS'))).toString() + ' will be imported.');
  Logger.log('Script version ' + SCRIPT_VERSION + '. Mailbox: ' + mailbox_() + '. Config fingerprint ' + configFingerprint_() + ' (must be the same in every mailbox copy).');
  if (!alertEmail_()) Logger.log('WARNING: ALERT_EMAIL is not set (or not an email address). Failure emails will go to THIS mailbox only. Add ALERT_EMAIL under Project Settings -> Script Properties.');
  if (!String(p.getProperty('CALENDAR_ID') || '').trim()) Logger.log('NOTE: CALENDAR_ID is not set, so this mailbox\'s own calendar is used. With several mailboxes, set CALENDAR_ID to the one shared calendar in every copy.');
  try { getCal_(); Logger.log('Calendar OK: ' + (p.getProperty('CALENDAR_ID') || 'primary')); }
  catch (e) { Logger.log('CALENDAR PROBLEM (the Hub part still works): ' + e + '  -> run testCalendar after fixing CALENDAR_ID / sharing.'); }
  if (!tokenOf_()) Logger.log('NEXT STEP: INTAKE_TOKEN is not set yet. Add it under Project Settings -> Script Properties (or run setConfig; see the top of this file). Until then you will get an email saying so.');
  else Logger.log('Token present (' + mask_(tokenOf_()) + ').');
  Logger.log('Setup done. Mailbox: ' + mailbox_() + ' | version ' + SCRIPT_VERSION);
}

function removeTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === HANDLER) { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('Removed ' + n + ' trigger(s). The watcher is now OFF until you run setup again.');
}

// Value comes from showToken() in the Buildium Intake project (same INTAKE_TOKEN as Cloudflare).
function setToken(value) {
  var v = validToken_(value);
  props_().setProperty('INTAKE_TOKEN', v);
  Logger.log('Token saved (' + v.length + ' characters, ' + mask_(v) + ').');
}
function validToken_(value) {
  var v = String(value == null ? '' : value).trim();
  if (v.length < 20 || /\s/.test(v)) throw new Error('That does not look like the token (too short or has spaces). Copy the whole INTAKE_TOKEN value from showToken() in the Buildium Intake project.');
  return v;
}

// Sets all the shared Script Properties from one pasted block of KEY=VALUE lines (the same block in every mailbox).
// Everything is checked first; if any line is wrong NOTHING is saved. Never prints the token.
//   function runOnce() { setConfig('INTAKE_TOKEN=...\nCALENDAR_ID=...\nALERT_EMAIL=...'); }
function setConfig(text) {
  var parsed = parseConfig_(text);
  if (parsed.errors.length) throw new Error('Nothing was saved. Fix these lines and run again:\n- ' + parsed.errors.join('\n- '));
  var keys = Object.keys(parsed.values);
  if (!keys.length) throw new Error('Nothing to save: no KEY=VALUE lines found.');
  keys.forEach(function (k) { props_().setProperty(k, parsed.values[k]); });
  keys.forEach(function (k) { Logger.log('Saved ' + k + (k === 'INTAKE_TOKEN' ? ' (' + parsed.values[k].length + ' characters, ' + mask_(parsed.values[k]) + ')' : ' = ' + parsed.values[k])); });
  Logger.log('Config fingerprint now ' + configFingerprint_() + ' (compare with the other mailboxes). You can delete the temporary function that held the token.');
}
// Pure: turns the pasted block into validated values. Lines starting with # and blank lines are ignored.
function parseConfig_(text) {
  var out = { values: {}, errors: [] };
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (line, i) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var eq = line.indexOf('=');
    if (eq < 1) { out.errors.push('line ' + (i + 1) + ': expected KEY=VALUE'); return; }
    var k = line.slice(0, eq).trim().toUpperCase(), v = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (CONFIG_KEYS.indexOf(k) < 0) { out.errors.push('line ' + (i + 1) + ': unknown setting ' + k + ' (allowed: ' + CONFIG_KEYS.join(', ') + ')'); return; }
    try {
      if (k === 'INTAKE_TOKEN') v = validToken_(v);
      else if (k === 'ALERT_EMAIL') { if (!validEmail_(v)) throw new Error('ALERT_EMAIL is not an email address'); v = v.toLowerCase(); }
      else if (k === 'CALENDAR_ID') { if (!v) throw new Error('CALENDAR_ID is empty (use primary to mean this mailbox\'s own calendar)'); }
      else if (k === 'SENDER_DOMAINS') { if (!v.split(',').some(function (x) { return validDomain_(x); })) throw new Error('SENDER_DOMAINS has no valid domain'); }
    } catch (e) { out.errors.push('line ' + (i + 1) + ' (' + k + '): ' + (k === 'INTAKE_TOKEN' ? String(e.message) : e.message)); return; }
    out.values[k] = v;
  });
  return out;
}
function validEmail_(v) { return /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,255}\.[A-Za-z]{2,}$/.test(String(v || '').trim()); }
function validDomain_(x) { return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(String(x || '').trim().toLowerCase()); }
// Short non-secret fingerprint of the shared settings. Equal in every mailbox when the Script Properties block matches.
function configFingerprint_() {
  var p = props_();
  var parts = [String(p.getProperty('CALENDAR_ID') || 'primary').trim().toLowerCase(), String(alertEmail_() || ''), domains_().slice().sort().join(','), WORKER_URL, HUB_PATH];
  var str = parts.join('|'), h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return ('00000000' + h.toString(16)).slice(-8);
}

// Never prints the whole token here; shows enough to compare with the Buildium project.
function showToken() {
  var t = tokenOf_();
  Logger.log(t ? 'INTAKE_TOKEN is set: ' + mask_(t) + ' (' + t.length + ' characters).' : 'INTAKE_TOKEN is NOT set. Add it under Project Settings -> Script Properties (or run setConfig).');
}

function tokenOf_() { return String(props_().getProperty('INTAKE_TOKEN') || '').trim(); }
function mask_(t) { t = String(t || ''); return t.length > 10 ? 'ends with ...' + t.slice(-4) : '(short)'; }
function redact_(s, token) { s = String(s == null ? '' : s); return token ? s.split(token).join('[token]') : s; }

// ── Main loop (1-minute trigger) ─────────────────────────────────────────────────────────────
function processDeliveryEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;                       // a previous run is still going; skip this minute
  try {
    run_();
  } catch (e) {
    if (e && e.noAlert) throw e;                           // the alert mail itself is what failed: it stays queued, and this error makes the run show as failed
    // Never die quietly: an exception here (Gmail quota, label error, ...) would otherwise just skip this minute.
    try {
      alertThrottled_('exception', 'Delivery watcher script error', 'processDeliveryEmails threw: ' + redact_(e, tokenOf_()) + (e && e.stack ? '\n' + redact_(e.stack, tokenOf_()) : '') + '\n\nIt will retry next minute. If you keep getting this, tell Claude.');
    } catch (e2) { Logger.log('ALERT FAILED too: ' + e2); throw e2; }
  } finally {
    lock.releaseLock();
  }
}

function run_() {
  var p = props_();
  flushAlerts_();                                          // anything that could not be emailed last time goes first
  var token = tokenOf_();
  var cutoff = Number(p.getProperty('CUTOFF_MS') || 0);
  if (!token || !cutoff) {
    alertThrottled_('notsetup', 'Delivery watcher is not set up', 'Delivery emails are NOT being imported.\n' + (!token ? 'The INTAKE_TOKEN is missing: Project Settings -> Script Properties -> add INTAKE_TOKEN (copy it from showToken() in the Buildium Intake project).\n' : '') + (!cutoff ? 'Setup has not been run: pick setup in the function dropdown and click Run.\n' : '') + '\nMailbox: ' + mailbox_());
    recordRun_({ result: 'not_set_up' });
    return;
  }
  if (!alertEmail_()) alertThrottled_('noalertemail', 'ALERT_EMAIL is not set', 'Delivery watcher failure emails are going to this mailbox (' + mailbox_() + ') only, because the ALERT_EMAIL Script Property is missing or is not an email address. Add ALERT_EMAIL (the same value in every mailbox copy) under Project Settings -> Script Properties.', 24 * ALERT_EVERY_MS);
  var mailbox = mailbox_();
  var domains = domains_();
  var done = json_(p.getProperty('DONE_IDS'), []);
  var fails = json_(p.getProperty('FAILS'), {});
  var since = Math.floor(Math.max(cutoff, Date.now() - LOOKBACK_MS) / 1000);

  // Collect candidates from both searches, de-duplicated, oldest first (so a calendar move is applied in order).
  var qs = searchQueries_(domains, since), seen = {}, cands = [];
  for (var qi = 0; qi < qs.length; qi++) {
    var threads = GmailApp.search(qs[qi], 0, 30);
    for (var ti = 0; ti < threads.length; ti++) {
      var msgs = threads[ti].getMessages();
      for (var mi = 0; mi < msgs.length; mi++) {
        var m = msgs[mi], id = m.getId();
        if (seen[id] || done.indexOf(id) >= 0) continue;
        seen[id] = 1;
        if (!eligible_(m, cutoff, domains)) continue;
        cands.push({ m: m, id: id, thread: threads[ti], t: m.getDate().getTime() });
      }
    }
  }
  cands.sort(function (a, b) { return a.t - b.t; });

  var stats = { found: cands.length, sent: 0, ignored: 0, duplicate: 0, attention: 0, failed: 0, cal_ok: 0, cal_fail: 0, waiting: 0 };
  var failLines = [], handled = 0, retried = 0, stop = false;
  for (var ci = 0; ci < cands.length; ci++) {
    var c = cands[ci];
    if (stop || handled >= MAX_PER_RUN) { stats.waiting++; continue; }
    var wasFailed = !!fails[c.id];
    if (wasFailed) { if (retried >= MAX_RETRY_PER_RUN) { stats.waiting++; continue; } retried++; }
    handled++;
    // Mark "in flight" BEFORE the call: if the run dies after the Hub took it, the retry knows it must still do the calendar.
    var f = fails[c.id] || { n: 0 };
    f.inflight = true; fails[c.id] = f;
    fails = saveJson_('FAILS', fails, KEEP_FAILS, 'la');

    var r = sendToHub_(c.m, token, mailbox, false);
    if (!r.ok) {
      f.n = (f.n || 0) + 1; f.inflight = false; f.last = String(r.raw).slice(0, FAIL_LAST_MAX);
      stats.failed++;
      var due = !f.la || (Date.now() - f.la) >= ALERT_EVERY_MS;
      if (due) { f.la = Date.now(); failLines.push('- "' + c.m.getSubject() + '" (received ' + c.m.getDate() + '), attempt ' + f.n + ': ' + r.raw); }
      fails[c.id] = f;
      fails = saveJson_('FAILS', fails, KEEP_FAILS, 'la');
      addLabel_(c.thread, LABEL_ATTN);
      if (r.transient) stop = true;                        // Hub down / token rejected: do not hammer it with the rest this minute
      continue;
    }

    // The Hub took it.
    var labelName = LABEL_DONE, calErr = null, calRes = null;
    if (r.ignored) { labelName = LABEL_IGN; stats.ignored++; }
    else {
      if (r.duplicate) stats.duplicate++; else stats.sent++;
      if (r.calendar && (!r.duplicate || wasFailed)) {      // a duplicate Hub answer means "already handled"; only a retry of OUR failed attempt still owes the calendar
        try { calRes = applyCalendar_(r.calendar, { order_number: r.json.order_number, wo_id: r.json.wo_id, delivery_address: r.json.delivery_address }); if (calRes && calRes.changed) stats.cal_ok++; if (calRes && calRes.warn) queueAlert_('Delivery calendar needs a quick look', calRes.warn + '\n\nEmail: ' + c.m.getSubject()); }
        catch (e) { calErr = e; stats.cal_fail++; }
      }
      if (r.attention) { stats.attention++; queueAlert_('Delivery email needs your attention', r.attentionText + '\n\nEmail: ' + c.m.getSubject() + '\nReceived: ' + c.m.getDate() + (r.summary ? '\nHub has: ' + r.summary : '')); }
      if (calErr) queueAlert_('Delivery NOT added to the calendar', 'The Hub saved this delivery, but the Google Calendar could not be updated: ' + redact_(calErr, token) + '\n\nWHAT TO DO: add it by hand' + (r.calendar.title ? ': ' + r.calendar.title : '') + (r.calendar.start_iso ? ' on ' + r.calendar.start_iso : '') + (r.calendar.location ? ' at ' + r.calendar.location : '') + '. Then run testCalendar in the Delivery Intake project to see why (calendar permission, or CALENDAR_ID is wrong).\n\nEmail: ' + c.m.getSubject());
      if (r.attention || calErr) labelName = LABEL_ATTN;
    }
    done.push(c.id); delete fails[c.id];
    addLabel_(c.thread, labelName);
    if (wasFailed && labelName !== LABEL_ATTN && !threadHasFail_(c.thread, fails)) removeLabel_(c.thread, LABEL_ATTN);
    done = saveJson_('DONE_IDS', done, KEEP_IDS);
    fails = saveJson_('FAILS', fails, KEEP_FAILS, 'la');
  }

  if (failLines.length) {
    var total = Object.keys(fails).length;
    queueAlert_('Delivery email NOT imported', 'The Hub did not take these delivery emails (' + total + ' waiting in all):\n' + failLines.join('\n') + (stats.waiting ? '\n\n(' + stats.waiting + ' more are waiting behind them.)' : '') + '\n\nThe script retries every minute and will remind you once an hour. If a line says HTTP 401/403, the token is wrong: copy it again from showToken() in the Buildium Intake project into Script Properties -> INTAKE_TOKEN. Otherwise tell Claude.');
  }
  recordRun_({ result: 'ok', stats: stats });
  if (!flushAlerts_()) { var fe = new Error('Delivery alert email could not be sent (' + alertQueue_().length + ' waiting). Check Gmail/MailApp quota; it will retry next minute.'); fe.noAlert = true; throw fe; }
}

// ── Pure helpers (unit-tested in Node) ───────────────────────────────────────────────────────
// The REAL sender address must be on one of the store domains (bare, or the last <...> of "Name <addr>").
// A display name that merely contains a store address (with a different real address in the angle brackets) must not pass.
function senderOk_(from, domains) {
  var s = String(from || '').slice(0, 300), list = (domains && domains.length) ? domains : DEFAULT_DOMAINS;
  for (var i = 0; i < list.length; i++) {
    var d = String(list[i]).trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(d)) continue;
    var re = new RegExp('(?:^|<)\\s*[^<>\\s@]{1,64}@(?:[a-z0-9-]{1,63}\\.){0,4}' + d.replace(/\./g, '\\.') + '\\s*>?\\s*$', 'i');
    if (re.test(s)) return true;
  }
  return false;
}

function domains_() {
  var raw = String(props_().getProperty('SENDER_DOMAINS') || '');
  var list = raw.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(function (x) { return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(x); });
  return list.length ? list : DEFAULT_DOMAINS.slice();
}

// Store sender + not before the cutoff. What the email IS is the Hub's decision, not ours.
function eligible_(m, cutoff, domains) {
  if (m.getDate().getTime() < cutoff) return false;
  return senderOk_(m.getFrom(), domains);
}

function searchQueries_(domains, sinceSec) {
  var from = 'from:(' + (domains && domains.length ? domains : DEFAULT_DOMAINS).join(' OR ') + ')';
  var after = ' after:' + sinceSec;
  return [from + ' ' + KEYWORDS_Q + ' -category:promotions ' + NOT_MARKETING_Q + after, from + ' ' + RESCUE_Q + after];
}

// The RFC 822 Message-ID header: identical in every mailbox that received the same email (Gmail's own id is not).
// Gmail's getHeader is tried first; if it is missing or throws, the raw message headers are read instead.
function extractRfcId_(m) {
  var v = '';
  var names = ['Message-ID', 'Message-Id', 'Message-id'];
  for (var i = 0; i < names.length && !v; i++) { try { v = cleanRfcId_(m.getHeader(names[i])); } catch (e) { v = ''; } }
  if (v) return v;
  var raw = '';
  try { raw = String(m.getRawContent() || '').slice(0, 30000); } catch (e) { return ''; }
  var end = raw.search(/\r?\n\r?\n/); if (end >= 0) raw = raw.slice(0, end);             // headers end at the first blank line; never read the body
  raw = raw.replace(/\r?\n[ \t]+/g, ' ');                                              // unfold wrapped header lines
  var lines = raw.split(/\r?\n/);
  for (var k = 0; k < lines.length; k++) {
    var mm = /^message-id[ \t]*:(.*)$/i.exec(lines[k]);
    if (mm) return cleanRfcId_(mm[1]);
  }
  return '';
}
function cleanRfcId_(h) {
  h = String(h == null ? '' : h).replace(/[\r\n\t]+/g, ' ').trim();
  var br = /<[^<>\s]{1,300}>/.exec(h);
  if (br) h = br[0];
  if (!h || h.length > 320 || /[\u0000-\u001f\u007f\s]/.test(h)) return '';
  return h;
}
function rfcMessageId_(m) { return extractRfcId_(m); }

// message_id stays = the RFC id when there is one, else Gmail's id. rfc_message_id / gmail_id are sent separately so the
// Hub can recognise the same email arriving in several mailboxes. A dry run prefixes the ids so it can never match a real record.
function buildPayload_(m, mailbox, dry) {
  var rfc = extractRfcId_(m), gid = String(m.getId()), pre = dry ? 'DRYRUN-' : '';
  var html = ''; try { html = String(m.getBody() || ''); } catch (e) {}
  var body = String(m.getPlainBody() || '');
  var payload = {
    subject: m.getSubject(), body: body.slice(0, BODY_MAX), from: m.getFrom(),
    message_id: pre + (rfc || gid), gmail_id: gid, received_at: m.getDate().toISOString(),
    mailbox: mailbox, dry_run: !!dry, script_version: SCRIPT_VERSION
  };
  if (rfc) payload.rfc_message_id = pre + rfc;
  if (html) payload.html = html.slice(0, HTML_MAX);
  return payload;
}

function describe_(j) {
  var bits = [], s = function (v) { return v === null || v === undefined ? '' : String(v); };
  if (s(j.order_number)) bits.push('Order ' + s(j.order_number));
  var item = [s(j.item_type), s(j.make_model)].filter(Boolean).join(' ');
  if (item) bits.push(item);
  var when = [s(j.expected_date), s(j.expected_window)].filter(Boolean).join(' ');
  if (when) bits.push(when);
  if (s(j.delivery_address)) bits.push(s(j.delivery_address));
  if (s(j.wo_id)) bits.push(s(j.wo_id));
  return bits.join(' | ');
}

// Turns the Hub's HTTP answer into what the loop needs. Never throws.
function handleResponse_(code, text, token) {
  var raw = redact_(String(text == null ? '' : text).slice(0, 600), token), j = null;
  try { j = JSON.parse(text); } catch (e) {}
  if (code !== 200 || !j || typeof j !== 'object' || j.success !== true) {
    var auth = code === 401 || code === 403;
    var tr = auth || code === 0 || code === 429 || code >= 500;
    return { ok: false, transient: tr, authProblem: auth, raw: 'HTTP ' + code + ' ' + raw + (auth ? '  (the Hub rejected the token)' : '') };
  }
  var res = { ok: true, json: j, kind: j.kind || '', raw: raw, ignored: false, duplicate: false, attention: false, attentionText: '', summary: describe_(j), calendar: null };
  if (j.kind === 'not_delivery') { res.ignored = true; return res; }
  if (j.duplicate === true) {
    res.duplicate = true;
    // Kept so the loop can still finish the calendar when the duplicate is only OUR earlier attempt coming back.
    if (j.calendar && typeof j.calendar === 'object' && j.calendar.action && j.calendar.action !== 'none') res.calendar = j.calendar;
    return res;
  }
  var why = [];
  if (j.parked === true) why.push('The Hub could not place this email (' + (j.reason || 'unknown reason') + (j.detail ? ': ' + j.detail : '') + '). It saved it as "Needs Review" in Deliveries' + (j.delivery_id ? ' (' + j.delivery_id + ')' : '') + '. WHAT TO DO: open the Hub > Deliveries, find the row marked Needs Review and fix it by hand. If it is a new kind of store email, tell Claude so the reader can learn it.');
  if (j.brett_sms_sent === false) why.push('The delivery WAS saved but the text message to you did NOT go out (' + (j.sms_status || 'no reason given') + '). This email is your only alert. WHAT TO DO: open the Hub > Deliveries and check the date/window.');
  if (j.property_matched === false) why.push('The Hub could not match the delivery address to one property' + (j.delivery_address ? ' (' + j.delivery_address + ')' : '') + ', so no work order was made. WHAT TO DO: open the Hub > Deliveries, open the row and pick the property.');
  if (j.telemetry_ok === false) why.push('The delivery was saved, but the Hub could not write its own log row. Tell Claude.');
  if (j.tenant_sms === 'failed') why.push('The text to the tenant failed. WHAT TO DO: check Deliveries and contact the tenant yourself if needed.');
  if (why.length) { res.attention = true; res.attentionText = why.join('\n\n'); }
  if (j.calendar && typeof j.calendar === 'object' && j.calendar.action && j.calendar.action !== 'none') res.calendar = j.calendar;
  return res;
}

function ymd_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

// What to do on the calendar, from the Hub's calendar object. Pure (no CalendarApp).
// extra = { order_number, wo_id } from the Hub response, for the fixed description.
function calendarPlan_(c, extra) {
  extra = extra || {};
  if (!c || typeof c !== 'object' || !c.action || c.action === 'none') return { op: 'none' };
  var key = String(c.key || '').trim();
  if (!key) return { op: 'invalid', error: 'the Hub sent a calendar change without a key' };
  if (c.action === 'cancel') return { op: 'delete', key: key, startYmd: ymd_(c.start_iso) };
  if (c.action !== 'create' && c.action !== 'update') return { op: 'invalid', error: 'unknown calendar action "' + c.action + '"' };
  var title = String(c.title || '').trim();
  if (!title) return { op: 'invalid', error: 'the Hub sent a calendar event without a title' };
  var st = ymd_(c.start_iso);
  if (!st) return { op: 'invalid', error: 'the Hub sent a calendar event without a valid start date' };
  var desc = 'Tenant asked to be present if able; otherwise Brett receives. Driver calls Brett.';
  var refs = [];
  if (extra.order_number) refs.push('Order ' + extra.order_number);
  if (extra.wo_id) refs.push('WO ' + extra.wo_id);
  if (refs.length) desc += ' ' + refs.join(', ') + '.';
  desc += '\n' + keyMarker_(key);                                      // lets any copy of the script find this event again by key
  var plan = { op: 'upsert', key: key, title: title, location: String(c.location || ''), description: desc, startYmd: st };
  var timed = c.all_day !== true && /^\d{4}-\d{2}-\d{2}T/.test(String(c.start_iso));
  if (timed) {
    var s = new Date(c.start_iso), e = c.end_iso ? new Date(c.end_iso) : null;
    if (isNaN(s.getTime())) return { op: 'invalid', error: 'the Hub sent an unreadable start time "' + c.start_iso + '"' };
    if (!e || isNaN(e.getTime()) || e.getTime() <= s.getTime()) e = new Date(s.getTime() + 3600 * 1000);
    plan.allDay = false; plan.start = s; plan.end = e;
  } else {
    plan.allDay = true; plan.start = new Date(st.y, st.mo - 1, st.d);          // script time zone = America/New_York (appsscript.json)
  }
  return plan;
}

function trimIds_(ids, keep) { ids = ids || []; return ids.length > keep ? ids.slice(ids.length - keep) : ids; }
// Keep the `keep` entries with the largest obj[k][field] (newest). Used for DELIVERY_EVENTS and FAILS.
function trimMap_(map, keep, field) {
  var ks = Object.keys(map || {});
  if (ks.length <= keep) return map;
  ks.sort(function (a, b) { return (Number(map[b][field]) || 0) - (Number(map[a][field]) || 0); });
  var out = {};
  ks.slice(0, keep).forEach(function (k) { out[k] = map[k]; });
  return out;
}

// ── Hub call ─────────────────────────────────────────────────────────────────────────────────
function sendToHub_(m, token, mailbox, dry) {
  var resp;
  try {
    resp = UrlFetchApp.fetch(WORKER_URL + HUB_PATH, {
      method: 'post', contentType: 'application/json', headers: { 'X-Auth-Token': token },
      payload: JSON.stringify(buildPayload_(m, mailbox, dry)), muteHttpExceptions: true
    });
  } catch (e) { return { ok: false, transient: true, raw: 'network error: ' + redact_(e, token) }; }
  return handleResponse_(resp.getResponseCode(), resp.getContentText(), token);
}

// ── Calendar (runs as the mailbox owner; the Hub itself cannot edit this calendar) ───────────
function getCal_() {
  var id = String(props_().getProperty('CALENDAR_ID') || 'primary').trim() || 'primary';
  var cal = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Calendar "' + id + '" was not found or this mailbox cannot edit it. Share it with this mailbox ("Make changes to events") or fix the CALENDAR_ID script property.');
  return cal;
}

// The unique text put in every event's description. Any copy of this script (any mailbox) finds the event again by it.
function keyMarker_(key) { return '[delivery-key:' + key + ']'; }
function eventHasKey_(ev, key) {
  try { if (ev.getTag(TAG_NAME) === key) return true; } catch (e) {}
  try { if (String(ev.getDescription() || '').indexOf(keyMarker_(key)) >= 0) return true; } catch (e) {}
  return false;
}
function sortById_(evs) { return evs.sort(function (a, b) { var x = String(a.getId()), y = String(b.getId()); return x < y ? -1 : x > y ? 1 : 0; }); }

// Finds EVERY event on the calendar that carries this key, whoever created it (this script or a copy in another mailbox):
//   1. free-text search for the key over a wide date range (a reschedule can move the event far from its old date),
//   2. if that finds nothing, a plain scan around the event's date (search is not instant and can miss),
//   3. last, our own key->event hint, but only for a few minutes after we created it.
// Sorted by event id so that every copy picks the same survivor if two exist.
function findAllByKey_(cal, key, plan, hint) {
  var day = 24 * 3600 * 1000, now = Date.now(), out = [], seen = {};
  function take(evs) { for (var i = 0; i < evs.length; i++) { var id = ''; try { id = String(evs[i].getId()); } catch (e) { continue; } if (!seen[id] && eventHasKey_(evs[i], key)) { seen[id] = 1; out.push(evs[i]); } } }
  try { take(cal.getEvents(new Date(now - CAL_BACK_DAYS * day), new Date(now + CAL_AHEAD_DAYS * day), { search: key })); } catch (e) {}
  if (!out.length && plan && plan.startYmd) {
    var y = plan.startYmd;
    take(cal.getEvents(new Date(y.y, y.mo - 1, y.d - 3), new Date(y.y, y.mo - 1, y.d + 4)));
  }
  if (!out.length && hint && hint.id && (now - Number(hint.t || 0)) < KEY_HINT_MS) {
    try { var ev = cal.getEventById(hint.id); if (ev) take([ev]); } catch (e) {}
  }
  return sortById_(out);
}
function writeEvent_(ev, plan) {
  ev.setTitle(plan.title);
  if (plan.allDay) ev.setAllDayDate(plan.start); else ev.setTime(plan.start, plan.end);
  ev.setLocation(plan.location); ev.setDescription(plan.description);
  try { ev.setTag(TAG_NAME, plan.key); } catch (e) {}
}
// Deletes every event in `evs` except `keep` (if given). Returns how many could NOT be deleted.
function deleteExtras_(evs, keepId) {
  var bad = 0;
  for (var i = 0; i < evs.length; i++) {
    if (keepId && String(evs[i].getId()) === keepId) continue;
    try { evs[i].deleteEvent(); } catch (e) { bad++; }
  }
  return bad;
}

// ONE event per calendar.key, idempotent across scripts: find by key on the calendar itself (not only our own
// Script Property), update if found, create only if not found. If two copies create at the same instant, each
// re-checks after a moment and keeps the same survivor (lowest event id), so one event is left.
// Returns { changed, what, warn }. THROWS on failure (caller emails the alert address).
function applyCalendar_(c, extra) {
  var p = props_(), map = json_(p.getProperty('DELIVERY_EVENTS'), {});
  var plan = calendarPlan_(c, extra);
  if (plan.op === 'none') return { changed: false, what: 'none' };
  if (plan.op === 'invalid') throw new Error(plan.error);
  var cal = getCal_(), key = plan.key, found = findAllByKey_(cal, key, plan, map[key]), warn = '';
  if (plan.op === 'delete') {
    var failed = 0;
    for (var i = 0; i < found.length; i++) { try { found[i].deleteEvent(); } catch (e) { if (!failed) warn = e; failed++; } }
    if (failed) throw new Error('could not delete ' + failed + ' calendar event(s) for ' + key + ': ' + warn);   // keep the key hint: the event still exists
    delete map[key]; saveJson_('DELIVERY_EVENTS', map, KEEP_EVENTS, 't');
    return { changed: found.length > 0, what: found.length ? 'deleted' : 'nothing to delete' };
  }
  var opts = { location: plan.location, description: plan.description }, what, ev;
  if (found.length) {
    ev = found[0]; writeEvent_(ev, plan); what = 'updated';
    var bad = deleteExtras_(found, String(ev.getId()));
    if (bad) warn = bad + ' extra calendar event(s) for ' + key + ' could not be removed. Delete the duplicate by hand (same title, same order number).';
  } else {
    if (plan.allDay) ev = cal.createAllDayEvent(plan.title, plan.start, opts); else ev = cal.createEvent(plan.title, plan.start, plan.end, opts);
    try { ev.setTag(TAG_NAME, key); } catch (e) {}
    what = 'created';
    // Another mailbox's copy may have created the same event in the same second. Look again and converge on one.
    try { Utilities.sleep(CAL_SETTLE_MS); } catch (e) {}
    var again = findAllByKey_(cal, key, plan, { id: ev.getId(), t: Date.now() });
    if (again.length > 1) {
      var survivor = again[0];
      if (String(survivor.getId()) !== String(ev.getId())) writeEvent_(survivor, plan);
      var bad2 = deleteExtras_(again, String(survivor.getId()));
      ev = survivor; what = 'created (merged with a copy made at the same moment)';
      if (bad2) warn = bad2 + ' extra calendar event(s) for ' + key + ' could not be removed. Delete the duplicate by hand (same title, same order number).';
    }
  }
  map[key] = { id: String(ev.getId()), t: Date.now() };
  saveJson_('DELIVERY_EVENTS', map, KEEP_EVENTS, 't');
  return { changed: true, what: what, warn: warn };
}

function testCalendar() {
  try {
    var cal = getCal_();
    var start = new Date(Date.now() + 24 * 3600 * 1000), end = new Date(start.getTime() + 15 * 60 * 1000);
    var ev = cal.createEvent('Delivery Intake calendar test (safe to ignore)', start, end);
    var id = ev.getId();
    ev.deleteEvent();
    Logger.log('CALENDAR OK: created and deleted a test event (' + id + ') on "' + (props_().getProperty('CALENDAR_ID') || 'primary') + '". Delivery events will work.');
    return true;
  } catch (e) {
    Logger.log('CALENDAR FAILED: ' + e + '\nThe Hub part still works, but deliveries will not reach the calendar until this is fixed.');
    return false;
  }
}

// ── Sanity check: what would the Hub do with the newest store email? (creates/sends nothing) ──
function dryRunLatest() {
  var token = tokenOf_();
  if (!token) { Logger.log('INTAKE_TOKEN is not set; add it first (Project Settings -> Script Properties, or run setConfig).'); return; }
  var domains = domains_();
  var qs = searchQueries_(domains, Math.floor((Date.now() - 60 * 24 * 3600 * 1000) / 1000)), best = null;
  for (var qi = 0; qi < qs.length; qi++) {
    var threads = GmailApp.search(qs[qi], 0, 10);
    for (var i = 0; i < threads.length; i++) {
      var msgs = threads[i].getMessages();
      for (var k = 0; k < msgs.length; k++) if (senderOk_(msgs[k].getFrom(), domains) && (!best || msgs[k].getDate() > best.getDate())) best = msgs[k];
    }
  }
  if (!best) { Logger.log('No store email found in the last 60 days to test with.'); return; }
  var r = sendToHub_(best, token, mailbox_(), true);
  Logger.log('Email: ' + best.getSubject() + ' (' + best.getDate() + ') from ' + best.getFrom());
  Logger.log('Hub says: ' + (r.ok ? JSON.stringify(r.json).slice(0, 3000) : 'FAILED ' + r.raw));
  if (r.ok) Logger.log('Nothing was created or sent (dry run).');
}

function status() {
  var p = props_(), cutoff = Number(p.getProperty('CUTOFF_MS') || 0);
  var trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var mine = trig.filter(function (h) { return h === HANDLER; }).length;
  var last = json_(p.getProperty('LAST_RUN'), null), counts = json_(p.getProperty('COUNTS'), {});
  var s = {
    trigger_count: mine, other_triggers: trig.length - mine, cutoff: cutoff ? new Date(cutoff).toString() : null,
    token_present: !!tokenOf_(), calendar_id: p.getProperty('CALENDAR_ID') || 'primary', mailbox: mailbox_(),
    last_run: last, counts: counts, done_ids: json_(p.getProperty('DONE_IDS'), []).length,
    failing: Object.keys(json_(p.getProperty('FAILS'), {})).length, events_tracked: Object.keys(json_(p.getProperty('DELIVERY_EVENTS'), {})).length,
    alerts_waiting: alertQueue_().length, script_version: SCRIPT_VERSION, config_fingerprint: configFingerprint_(), alert_email: alertEmail_() || null
  };
  Logger.log('Script version: ' + SCRIPT_VERSION + ' | Config fingerprint: ' + s.config_fingerprint + '   (both must be identical in every mailbox copy)');
  Logger.log('Trigger: ' + (mine === 1 ? 'OK (1)' : 'PROBLEM - ' + mine + ' installed, should be 1; run setup') + (s.other_triggers ? ' (+' + s.other_triggers + ' other)' : ''));
  Logger.log('Set up since: ' + (s.cutoff || 'NOT SET UP - run setup'));
  Logger.log('Token: ' + (s.token_present ? 'present (' + mask_(tokenOf_()) + ')' : 'MISSING'));
  Logger.log('Calendar: ' + s.calendar_id + ' | events tracked: ' + s.events_tracked + ' | mailbox: ' + s.mailbox);
  Logger.log('Alert emails go to: ' + (s.alert_email || 'NOT SET - this mailbox only (' + s.mailbox + '); add ALERT_EMAIL under Script Properties'));
  Logger.log('Last run: ' + (last ? new Date(last.t).toString() + ' ' + JSON.stringify(last) : 'never'));
  Logger.log('Totals: ' + JSON.stringify(counts) + ' | failing emails: ' + s.failing + ' | alerts waiting to send: ' + s.alerts_waiting);
  return s;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
// Which mailbox this copy is running in. Comes from Google, never from the code, so the identical file works in any mailbox.
function mailbox_() {
  try { var e = Session.getActiveUser().getEmail(); if (e) return String(e).trim().toLowerCase(); } catch (x) {}
  try { var e2 = Session.getEffectiveUser().getEmail(); if (e2) return String(e2).trim().toLowerCase(); } catch (y) {}
  return 'unknown';
}
// Where failure emails go: Script Property ALERT_EMAIL (same in every copy), else this mailbox itself (never nowhere).
function alertEmail_() { var v = String(props_().getProperty('ALERT_EMAIL') || '').trim(); return validEmail_(v) ? v.toLowerCase() : ''; }
function alertTo_() { var a = alertEmail_(); if (a) return a; var m = mailbox_(); return validEmail_(m) ? m : ''; }
function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
function addLabel_(thread, name) { thread.addLabel(label_(name)); }
function removeLabel_(thread, name) { var l = GmailApp.getUserLabelByName(name); if (l) thread.removeLabel(l); }
function threadHasFail_(thread, fails) {
  var ms = thread.getMessages();
  for (var i = 0; i < ms.length; i++) if (fails[ms[i].getId()]) return true;
  return false;
}
function recordRun_(info) {
  var p = props_(); info.t = Date.now();
  p.setProperty('LAST_RUN', JSON.stringify(info));
  if (info.stats) {
    var c = json_(p.getProperty('COUNTS'), {});
    Object.keys(info.stats).forEach(function (k) { if (k !== 'found' && k !== 'waiting') c[k] = (c[k] || 0) + info.stats[k]; });
    p.setProperty('COUNTS', JSON.stringify(c));
  }
}

// Alerts are queued in Script Properties first, so an alert that cannot be emailed right now is not lost.
// (A Script Property holds at most 9 KB, so each notice is shortened, and only the newest few are kept; anything pushed
// out is counted and the next email says so, so nothing disappears without a word.)
function alertQueue_() { return json_(props_().getProperty('ALERT_QUEUE'), []); }
function queueAlert_(subject, body) {
  var q = alertQueue_(), dropped = Number(props_().getProperty('ALERT_DROPPED') || 0);
  var b = String(body == null ? '' : body); if (b.length > ALERT_BODY_MAX) b = b.slice(0, ALERT_BODY_MAX) + ' ...(shortened)';
  q.push({ s: String(subject).slice(0, 120), b: b, t: new Date().toString() });
  while (q.length > 1 && (q.length > KEEP_ALERTS || utf8Len_(JSON.stringify(q)) > PROP_MAX_BYTES)) { q.shift(); dropped++; }
  props_().setProperty('ALERT_QUEUE', JSON.stringify(q));
  if (dropped) props_().setProperty('ALERT_DROPPED', String(dropped));
}
function flushAlerts_() {
  var q = alertQueue_();
  if (!q.length) return true;
  var to = alertTo_(), dropped = Number(props_().getProperty('ALERT_DROPPED') || 0);
  var subject = '[Hub delivery] ' + (q.length === 1 ? q[0].s : q.length + ' delivery watcher notices') + ' (' + mailbox_() + ')';
  var body = (dropped ? '(' + dropped + ' older notice' + (dropped === 1 ? ' was' : 's were') + ' shortened away because email could not be sent for a while. Check Hub > Deliveries and Gmail labels Delivery/Needs Attention.)\n\n' : '') +
    q.map(function (a, i) { return (q.length > 1 ? (i + 1) + '. ' + a.s + '\n' : '') + a.b + '\n(' + a.t + ')'; }).join('\n\n----------\n\n') +
    '\n\n-- Delivery Intake ' + SCRIPT_VERSION + ' running in ' + mailbox_();
  try { if (!to) throw new Error('no valid alert address (set ALERT_EMAIL under Script Properties)'); MailApp.sendEmail(to, subject, body); }
  catch (e) { Logger.log('ALERT EMAIL FAILED: ' + e + ' | ' + subject); return false; }
  props_().deleteProperty('ALERT_QUEUE'); props_().deleteProperty('ALERT_DROPPED');
  return true;
}
// At most one email per key per period (default an hour), so a stuck condition cannot flood the mailbox.
function alertThrottled_(key, subject, body, everyMs) {
  var p = props_(), k = 'LAST_ALERT_' + key, last = Number(p.getProperty(k) || 0);
  if (Date.now() - last < (everyMs || ALERT_EVERY_MS)) return;
  queueAlert_(subject, body);
  if (flushAlerts_()) p.setProperty(k, String(Date.now()));
  else throw new Error('Delivery alert could not be emailed: ' + subject);
}

if (typeof module !== 'undefined') module.exports = { senderOk_: senderOk_, eligible_: eligible_, buildPayload_: buildPayload_, handleResponse_: handleResponse_, calendarPlan_: calendarPlan_, trimIds_: trimIds_, trimMap_: trimMap_, searchQueries_: searchQueries_, redact_: redact_, domains_: domains_, extractRfcId_: extractRfcId_, parseConfig_: parseConfig_, configFingerprint_: configFingerprint_, utf8Len_: utf8Len_, keyMarker_: keyMarker_, SCRIPT_VERSION: SCRIPT_VERSION };
