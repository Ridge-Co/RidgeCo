/**
 * DELIVERY EMAILS -> HUB  (Delivery system Phase 1, the mailbox side)
 * ---------------------------------------------------------------------------------------------
 * ONE IDENTICAL FILE, PASTED INTO EVERY MAILBOX THAT MIGHT RECEIVE STORE EMAILS.
 * Nothing in this file is specific to one mailbox, and it needs NO password, token or secret.
 *
 * HOW IT SIGNS IN: every call to the Hub carries a Google identity token for the mailbox that
 * runs the script (ScriptApp.getIdentityToken(): a short-lived, signed proof of "this is
 * <mailbox>"). The Hub checks Google's signature and that the mailbox is on its own list
 * (Config key Delivery_Mailboxes). The token is never stored, logged or emailed.
 *
 * If a delivery email reaches two of your mailboxes, both copies may send it; the Hub makes
 * sure it is counted ONCE (one record, one text to you, one tenant request, one calendar event).
 * The HUB writes the calendar itself; this script does not touch Google Calendar at all.
 * When you change this file, paste the SAME file into every copy and compare the SCRIPT_VERSION
 * that status() prints.
 *
 * When you order an appliance (Home Depot, Lowe's, Ace, Walmart), the store emails an order
 * confirmation, a delivery date, a delivery window, "your driver is N stops away", "delivered",
 * reschedule and cancel notices. Every minute this script finds the NEW ones in this mailbox and
 * hands each one to the Hub (POST /intake/delivery-email). The Hub reads it, creates or updates the
 * Delivery record, links the property / work order, texts you, and updates the calendar.
 *
 * NO AI IN HERE. Plain Gmail search + one HTTPS call. The Hub decides what each email is.
 * Marketing that slips through comes back as "not_delivery" and is labelled Delivery/Ignored
 * quietly. Nothing is deleted or archived.
 *
 * LABELS this script puts on the Gmail thread (labels belong to each mailbox separately):
 *   Delivery/Sent to Hub      - the Hub took it (including "the Hub already had it").
 *   Delivery/Needs Attention  - something needs you (you also get an email saying what).
 *   Delivery/Ignored          - the Hub says it is not about a delivery (no alert).
 *
 * NOTHING FAILS SILENTLY (this script emails the ALERT_EMAIL address, or the mailbox itself if
 * that is not set, only when something is WRONG; the Hub sends the normal delivery texts):
 *   - Hub unreachable / error / sign-in refused -> retried every minute; email on the first
 *                                                  failure, then a reminder every hour.
 *   - Hub parked it, could not text you, could not match the property, or could not update the
 *     calendar -> email saying so.
 *   - Google will not give the script an identity token -> email (at most one an hour).
 *   - Setup missing -> email (at most one an hour). The script never just does nothing.
 *   - Emails dated BEFORE setup() was first run are never imported (no backfill).
 *
 * SETUP (once per mailbox, about 3 minutes, on a Chromebook in Chrome). DO IT BEFORE YOU ORDER.
 * Full steps: context/DELIVERY_INTAKE_SETUP_v1.0.md. Short version:
 *   1. script.google.com while signed in to the mailbox -> New project -> name it Delivery Intake.
 *   2. Paste this whole file over Code.gs. Paste the companion appsscript.json over the manifest
 *      (Project Settings -> tick "Show appsscript.json manifest file in editor"). Save.
 *   3. Pick setup in the function dropdown, Run, approve the permissions.
 *   4. Pick status, Run: it must say the identity token works and show this mailbox's address.
 *   5. Tell the Hub this mailbox is allowed (Config key Delivery_Mailboxes). Optional: dryRunLatest.
 * Optional Script Properties (all optional): ALERT_EMAIL, SENDER_DOMAINS.
 */

// ── Fixed names ──────────────────────────────────────────────────────────────────────────────
var WORKER_URL    = 'https://maintenance-hub.brett-2f8.workers.dev';
var HUB_PATH      = '/intake/delivery-email';
// Bump this whenever the file changes. status() prints it; after pasting a new version into one mailbox,
// paste the SAME file into the others and compare the numbers.
var SCRIPT_VERSION = '1.2.0';
var CONFIG_KEYS   = ['ALERT_EMAIL', 'SENDER_DOMAINS'];   // the only Script Properties the person may set (both optional)
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
var KEEP_FAILS    = 50;
var KEEP_ALERTS   = 8;
var ALERT_BODY_MAX = 1500;
var FAIL_LAST_MAX = 100;
// A Script Property value may not exceed 9 KB (9216 bytes) or setProperty throws. Everything stored as JSON is trimmed to fit under this.
var PROP_MAX_BYTES = 8500;
var HTML_MAX      = 200000;
var BODY_MAX      = 200000;
var ALERT_EVERY_MS = 3600 * 1000;

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
  var idt = identity_();
  Logger.log('Script version ' + SCRIPT_VERSION + '. Mailbox: ' + mailbox_() + '. Config fingerprint ' + configFingerprint_() + ' (must be the same in every mailbox copy).');
  if (alertEmailInvalid_()) Logger.log('WARNING: ALERT_EMAIL is set but is not an email address, so failure emails go to THIS mailbox. Fix or delete the ALERT_EMAIL Script Property.');
  else if (!alertEmail_()) Logger.log('Failure emails will go to this mailbox (' + mailbox_() + '). Add the ALERT_EMAIL Script Property to send them somewhere else.');
  if (idt.ok) Logger.log('Hub sign-in OK: Google vouches for ' + idt.email + ' (token valid until ' + new Date(idt.exp * 1000).toString() + '). That address must be in the Hub\'s Delivery_Mailboxes list.');
  else Logger.log('HUB SIGN-IN PROBLEM: ' + idt.error + '  -> approve the permissions when Google asks (including "openid"), run setup again, then run status.');
  Logger.log('Setup done. Mailbox: ' + mailbox_() + ' | version ' + SCRIPT_VERSION);
}

function removeTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === HANDLER) { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('Removed ' + n + ' trigger(s). The watcher is now OFF until you run setup again.');
}

// Sets all the shared Script Properties from one pasted block of KEY=VALUE lines (the same block in every mailbox).
// Everything is checked first; if any line is wrong NOTHING is saved.
//   function runOnce() { setConfig('ALERT_EMAIL=the-address-for-failure-emails'); }
function setConfig(text) {
  var parsed = parseConfig_(text);
  if (parsed.errors.length) throw new Error('Nothing was saved. Fix these lines and run again:\n- ' + parsed.errors.join('\n- '));
  var keys = Object.keys(parsed.values);
  if (!keys.length) throw new Error('Nothing to save: no KEY=VALUE lines found.');
  keys.forEach(function (k) { props_().setProperty(k, parsed.values[k]); });
  keys.forEach(function (k) { Logger.log('Saved ' + k + ' = ' + parsed.values[k]); });
  Logger.log('Config fingerprint now ' + configFingerprint_() + ' (compare with the other mailboxes).');
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
      if (k === 'ALERT_EMAIL') { if (!validEmail_(v)) throw new Error('ALERT_EMAIL is not an email address'); v = v.toLowerCase(); }
      else if (k === 'SENDER_DOMAINS') { if (!v.split(',').some(function (x) { return validDomain_(x); })) throw new Error('SENDER_DOMAINS has no valid domain'); }
    } catch (e) { out.errors.push('line ' + (i + 1) + ' (' + k + '): ' + e.message); return; }
    out.values[k] = v;
  });
  return out;
}
function validEmail_(v) { return /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,255}\.[A-Za-z]{2,}$/.test(String(v || '').trim()); }
function validDomain_(x) { return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(String(x || '').trim().toLowerCase()); }
// Short non-secret fingerprint of the shared settings. Equal in every mailbox when the Script Properties block matches.
function configFingerprint_() {
  var parts = [String(alertEmail_() || ''), domains_().slice().sort().join(','), WORKER_URL, HUB_PATH];
  var str = parts.join('|'), h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return ('00000000' + h.toString(16)).slice(-8);
}

// Optional legacy shared secret: only used if somebody happened to set the INTAKE_TOKEN Script Property. Never required.
function legacyToken_() { return String(props_().getProperty('INTAKE_TOKEN') || '').trim(); }
// Removes every secret (string or list of strings) from text that may be logged or emailed.
function redact_(s, secrets) {
  s = String(s == null ? '' : s);
  var list = Array.isArray(secrets) ? secrets : [secrets];
  for (var i = 0; i < list.length; i++) if (list[i] && String(list[i]).length >= 8) s = s.split(String(list[i])).join('[token]');
  return s.replace(/eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}/g, '[token]');   // anything shaped like a Google/JWT token (even a cut-off one, even one we never saw)
}
var SECRETS_ = [];   // identity token / legacy token of the current run, for redacting error text
var IDENTITY_EMAIL_ = '';   // email claim of the last good identity token: the mailbox's address when Session cannot say

// ── Hub sign-in: Google identity token of the mailbox that runs the script ───────────────────
// Pure: decodes the (unverified) payload of a JWT so we can show the email claim and expiry. The HUB verifies the signature.
function b64urlToString_(b64) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''), bytes = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var v = chars.indexOf(s.charAt(i)); if (v < 0) throw new Error('not base64');
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 255); buf &= (1 << bits) - 1; }
  }
  var out = '';
  for (var k = 0; k < bytes.length; k++) out += '%' + ('0' + bytes[k].toString(16)).slice(-2);
  return decodeURIComponent(out);
}
function decodeJwtPayload_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    var p = JSON.parse(b64urlToString_(parts[1]));
    return (p && typeof p === 'object') ? p : null;
  } catch (e) { return null; }
}
// { ok, token, email, exp, error }. Never throws, never returns the token inside `error`.
function identity_() {
  var t;
  try { t = ScriptApp.getIdentityToken(); if (t && typeof t === 'string') SECRETS_.push(t); }
  catch (e) { return { ok: false, error: 'identity token unavailable (' + redact_(e, SECRETS_) + ')' }; }
  if (!t || typeof t !== 'string') return { ok: false, error: 'identity token unavailable (Google returned nothing; the "openid" permission has probably not been approved)' };
  var pl = decodeJwtPayload_(t);
  if (!pl) return { ok: false, error: 'identity token unavailable (Google returned something that is not a readable token)' };
  var email = String(pl.email || '').toLowerCase(), exp = Number(pl.exp || 0);
  if (!email) return { ok: false, error: 'identity token has no email claim (the userinfo.email permission has probably not been approved)' };
  if (exp && exp * 1000 < Date.now() + 30000) return { ok: false, error: 'identity token is already expired (exp ' + new Date(exp * 1000).toString() + ')' };
  IDENTITY_EMAIL_ = email;
  return { ok: true, token: t, email: email, exp: exp };
}

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
      alertThrottled_('exception', 'Delivery watcher script error', 'processDeliveryEmails threw: ' + redact_(e, SECRETS_) + (e && e.stack ? '\n' + redact_(e.stack, SECRETS_) : '') + '\n\nIt will retry next minute. If you keep getting this, tell Claude.');
    } catch (e2) { Logger.log('ALERT FAILED too: ' + e2); throw e2; }
  } finally {
    lock.releaseLock();
  }
}

function run_() {
  var p = props_();
  flushAlerts_();                                          // anything that could not be emailed last time goes first
  SECRETS_ = [legacyToken_()];
  var cutoff = Number(p.getProperty('CUTOFF_MS') || 0);
  if (!cutoff) {
    alertThrottled_('notsetup', 'Delivery watcher is not set up', 'Delivery emails are NOT being imported.\nSetup has not been run: pick setup in the function dropdown and click Run.\n\nMailbox: ' + mailbox_());
    recordRun_({ result: 'not_set_up' });
    return;
  }
  var idt = identity_();
  if (!idt.ok) {
    alertThrottled_('noidentity', 'Delivery watcher cannot sign in to the Hub', 'Delivery emails are NOT being imported: ' + idt.error + '.\n\nWHAT TO DO: in the Delivery Intake project pick setup in the function dropdown and Run it again, and approve the permissions when Google asks (including "openid" / "associate you with your personal info"). Then run status: it must say the identity token works.\n\nMailbox: ' + mailbox_());
    recordRun_({ result: 'no_identity' });
    return;
  }
  if (alertEmailInvalid_()) alertThrottled_('badalertemail', 'ALERT_EMAIL is not a valid address', 'The ALERT_EMAIL Script Property is set but is not an email address, so delivery watcher failure emails go to this mailbox (' + mailbox_() + ') instead. Fix or delete ALERT_EMAIL under Project Settings -> Script Properties.', 24 * ALERT_EVERY_MS);
  var mailbox = mailbox_();
  var domains = domains_();
  var done = json_(p.getProperty('DONE_IDS'), []);
  var fails = json_(p.getProperty('FAILS'), {});
  var since = Math.floor(Math.max(cutoff, Date.now() - LOOKBACK_MS) / 1000);

  // Collect candidates from both searches, de-duplicated, oldest first (so later updates arrive after earlier ones).
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

  var stats = { found: cands.length, sent: 0, ignored: 0, duplicate: 0, attention: 0, failed: 0, waiting: 0 };
  var failLines = [], handled = 0, retried = 0, stop = false, authFail = false;
  for (var ci = 0; ci < cands.length; ci++) {
    var c = cands[ci];
    if (stop || handled >= MAX_PER_RUN) { stats.waiting++; continue; }
    var wasFailed = !!fails[c.id];
    if (wasFailed) { if (retried >= MAX_RETRY_PER_RUN) { stats.waiting++; continue; } retried++; }
    handled++;
    var f = fails[c.id] || { n: 0 };
    // If the run dies after the Hub took the email, the retry just gets "duplicate: true" back: harmless, the Hub counts it once.
    var r = sendToHub_(c.m, idt, mailbox, false);
    if (!r.ok) {
      f.n = (f.n || 0) + 1; f.last = String(r.raw).slice(0, FAIL_LAST_MAX);
      stats.failed++;
      var due = !f.la || (Date.now() - f.la) >= ALERT_EVERY_MS;
      if (due) { f.la = Date.now(); failLines.push('- "' + c.m.getSubject() + '" (received ' + c.m.getDate() + '), attempt ' + f.n + ': ' + r.raw); }
      fails[c.id] = f;
      fails = saveJson_('FAILS', fails, KEEP_FAILS, 'la');
      addLabel_(c.thread, LABEL_ATTN);
      if (r.transient) stop = true;                        // Hub down / sign-in rejected: do not hammer it with the rest this minute
      if (r.authProblem) authFail = true;
      continue;
    }

    // The Hub took it.
    var labelName = LABEL_DONE;
    if (r.ignored) { labelName = LABEL_IGN; stats.ignored++; }
    else {
      if (r.duplicate) stats.duplicate++; else stats.sent++;
      if (r.attention) { stats.attention++; queueAlert_('Delivery email needs your attention', r.attentionText + '\n\nEmail: ' + c.m.getSubject() + '\nReceived: ' + c.m.getDate() + (r.summary ? '\nHub has: ' + r.summary : '')); labelName = LABEL_ATTN; }
    }
    done.push(c.id); delete fails[c.id];
    addLabel_(c.thread, labelName);
    if (wasFailed && labelName !== LABEL_ATTN && !threadHasFail_(c.thread, fails)) removeLabel_(c.thread, LABEL_ATTN);
    done = saveJson_('DONE_IDS', done, KEEP_IDS);
    fails = saveJson_('FAILS', fails, KEEP_FAILS, 'la');
  }

  if (failLines.length) {
    var total = Object.keys(fails).length;
    queueAlert_('Delivery email NOT imported', 'The Hub did not take these delivery emails (' + total + ' waiting in all):\n' + failLines.join('\n') + (stats.waiting ? '\n\n(' + stats.waiting + ' more are waiting behind them.)' : '') + '\n\nThe script retries every minute and will remind you once an hour. ' + (authFail ? 'HTTP 401/403 means the Hub refused this mailbox\'s sign-in. Most likely ' + mailbox + ' is not in the Hub\'s Delivery_Mailboxes list: ask Claude to add it (the same pasted script is fine, nothing to change here). If it was working before, run setup again here and approve the permissions, then run status.' : 'Tell Claude if this keeps happening.'));
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
  var raw = redact_(text, token).slice(0, 600), j = null;   // redact BEFORE cutting: a cut-off token would no longer match
  try { j = JSON.parse(text); } catch (e) {}
  if (code !== 200 || !j || typeof j !== 'object' || j.success !== true) {
    var auth = code === 401 || code === 403;
    var tr = auth || code === 0 || code === 429 || code >= 500;
    return { ok: false, transient: tr, authProblem: auth, raw: 'HTTP ' + code + ' ' + raw + (auth ? '  (the Hub refused the sign-in: this mailbox\'s email may not be in the Hub\'s Delivery_Mailboxes list)' : '') };
  }
  var res = { ok: true, json: j, kind: j.kind || '', raw: raw, ignored: false, duplicate: false, attention: false, attentionText: '', summary: describe_(j) };
  if (j.kind === 'not_delivery') { res.ignored = true; return res; }
  if (j.duplicate === true) {
    res.duplicate = true;                                  // already handled (by this or another mailbox's copy): nothing more to do, no alert
    return res;
  }
  var why = [];
  if (j.parked === true) why.push('The Hub could not place this email (' + (j.reason || 'unknown reason') + (j.detail ? ': ' + j.detail : '') + '). It saved it as "Needs Review" in Deliveries' + (j.delivery_id ? ' (' + j.delivery_id + ')' : '') + '. WHAT TO DO: open the Hub > Deliveries, find the row marked Needs Review and fix it by hand. If it is a new kind of store email, tell Claude so the reader can learn it.');
  if (j.brett_sms_sent === false) why.push('The delivery WAS saved but the text message to you did NOT go out (' + (j.sms_status || 'no reason given') + '). This email is your only alert. WHAT TO DO: open the Hub > Deliveries and check the date/window.');
  if (j.property_matched === false) why.push('The Hub could not match the delivery address to one property' + (j.delivery_address ? ' (' + j.delivery_address + ')' : '') + ', so no work order was made. WHAT TO DO: open the Hub > Deliveries, open the row and pick the property.');
  if (j.telemetry_ok === false) why.push('The delivery was saved, but the Hub could not write its own log row. Tell Claude.');
  if (j.tenant_sms === 'failed') why.push('The text to the tenant failed. WHAT TO DO: check Deliveries and contact the tenant yourself if needed.');
  var cal = calendarFailure_(j);
  if (cal) why.push('The delivery WAS saved but the Hub could not put it on the Google Calendar (' + cal + '). The Hub writes the calendar itself and also alerts you. WHAT TO DO: add it by hand' + (describe_(j) ? ': ' + describe_(j) : '') + ', and tell Claude.');
  if (why.length) { res.attention = true; res.attentionText = why.join('\n\n'); }
  return res;
}

// The Hub writes the calendar itself and reports it as calendar_status. Returns the reason text if it says "failed", else ''.
// Accepts a plain word ("ok" / "failed" / "failed: no permission") or an object ({status|state|ok, reason|error|detail|message}).
function calendarFailure_(j) {
  var cs = j && j.calendar_status, extra = String((j && (j.calendar_error || j.calendar_reason || j.calendar_detail)) || '').trim();
  if (cs === undefined || cs === null || cs === '') return '';
  var failed = false, reason = '';
  if (typeof cs === 'string') { failed = /^\s*(fail|error)/i.test(cs); reason = cs; }
  else if (typeof cs === 'object') {
    var st = String(cs.status || cs.state || '');
    failed = /^\s*(fail|error)/i.test(st) || cs.ok === false || cs.success === false;
    reason = String(cs.reason || cs.error || cs.detail || cs.message || st || '');
  }
  if (!failed) return '';
  reason = (extra || reason || 'no reason given').replace(/^\s*(failed|error)\s*[:\-]?\s*/i, '').trim() || 'no reason given';
  return reason.slice(0, 300);
}

function trimIds_(ids, keep) { ids = ids || []; return ids.length > keep ? ids.slice(ids.length - keep) : ids; }
// Keep the `keep` entries with the largest obj[k][field] (newest). Used for FAILS.
function trimMap_(map, keep, field) {
  var ks = Object.keys(map || {});
  if (ks.length <= keep) return map;
  ks.sort(function (a, b) { return (Number(map[b][field]) || 0) - (Number(map[a][field]) || 0); });
  var out = {};
  ks.slice(0, keep).forEach(function (k) { out[k] = map[k]; });
  return out;
}

// ── Hub call ─────────────────────────────────────────────────────────────────────────────────
// idt = the object identity_() returned. The Google identity token goes in Authorization: Bearer; the old shared secret
// (only if somebody happened to set INTAKE_TOKEN) rides along as X-Auth-Token. Neither is ever logged or emailed.
function sendToHub_(m, idt, mailbox, dry) {
  var resp, headers = { Authorization: 'Bearer ' + idt.token }, legacy = legacyToken_();
  if (legacy) headers['X-Auth-Token'] = legacy;
  var secrets = [idt.token, legacy];
  try {
    resp = UrlFetchApp.fetch(WORKER_URL + HUB_PATH, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(buildPayload_(m, mailbox, dry)), muteHttpExceptions: true
    });
  } catch (e) { return { ok: false, transient: true, raw: 'network error: ' + redact_(e, secrets) }; }
  return handleResponse_(resp.getResponseCode(), resp.getContentText(), secrets);
}

// ── Sanity check: what would the Hub do with the newest store email? (creates/sends nothing) ──
function dryRunLatest() {
  SECRETS_ = [legacyToken_()];
  var idt = identity_();
  if (!idt.ok) { Logger.log('Cannot sign in to the Hub: ' + idt.error + '. Run setup, approve the permissions, then try again.'); return; }
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
  var r = sendToHub_(best, idt, mailbox_(), true);
  Logger.log('Email: ' + best.getSubject() + ' (' + best.getDate() + ') from ' + best.getFrom());
  Logger.log('Hub says: ' + (r.ok ? JSON.stringify(r.json).slice(0, 3000) : 'FAILED ' + r.raw));
  if (r.ok) Logger.log('Nothing was created or sent (dry run).');
}

function status() {
  var p = props_(), cutoff = Number(p.getProperty('CUTOFF_MS') || 0);
  var trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var mine = trig.filter(function (h) { return h === HANDLER; }).length;
  var last = json_(p.getProperty('LAST_RUN'), null), counts = json_(p.getProperty('COUNTS'), {});
  SECRETS_ = [legacyToken_()];
  var idt = identity_();
  var s = {
    trigger_count: mine, other_triggers: trig.length - mine, cutoff: cutoff ? new Date(cutoff).toString() : null,
    identity_ok: idt.ok, identity_email: idt.ok ? idt.email : null, identity_expires: idt.ok && idt.exp ? new Date(idt.exp * 1000).toString() : null, identity_error: idt.ok ? null : idt.error, legacy_token_set: !!legacyToken_(), mailbox: mailbox_(),
    last_run: last, counts: counts, done_ids: json_(p.getProperty('DONE_IDS'), []).length,
    failing: Object.keys(json_(p.getProperty('FAILS'), {})).length,
    alerts_waiting: alertQueue_().length, script_version: SCRIPT_VERSION, config_fingerprint: configFingerprint_(), alert_email: alertEmail_() || null
  };
  Logger.log('Script version: ' + SCRIPT_VERSION + ' | Config fingerprint: ' + s.config_fingerprint + '   (both must be identical in every mailbox copy)');
  Logger.log('Trigger: ' + (mine === 1 ? 'OK (1)' : 'PROBLEM - ' + mine + ' installed, should be 1; run setup') + (s.other_triggers ? ' (+' + s.other_triggers + ' other)' : ''));
  Logger.log('Set up since: ' + (s.cutoff || 'NOT SET UP - run setup'));
  if (idt.ok) {
    Logger.log('Hub sign-in: OK. Google identity token obtained for ' + idt.email + (idt.exp ? ', valid until ' + s.identity_expires : '') + '.');
    Logger.log('  -> ' + idt.email + ' must be in the Hub\'s Delivery_Mailboxes list, or the Hub answers 401/403.');
    if (s.mailbox !== 'unknown' && s.mailbox !== idt.email) Logger.log('  NOTE: the script reports its mailbox as ' + s.mailbox + ' but the token says ' + idt.email + '. The token is what the Hub trusts.');
  } else Logger.log('Hub sign-in: PROBLEM - ' + idt.error + '. Run setup again and approve the permissions (including openid), then run status.');
  Logger.log('Mailbox: ' + s.mailbox + (s.legacy_token_set ? ' | optional INTAKE_TOKEN is set (not needed; it is only sent as an extra header)' : ' | no secrets stored (none needed)'));
  Logger.log('Alert emails go to: ' + (s.alert_email || 'this mailbox (' + s.mailbox + ') - set the optional ALERT_EMAIL Script Property to send them elsewhere'));
  Logger.log('Last run: ' + (last ? new Date(last.t).toString() + ' ' + JSON.stringify(last) : 'never'));
  Logger.log('Totals: ' + JSON.stringify(counts) + ' | failing emails: ' + s.failing + ' | alerts waiting to send: ' + s.alerts_waiting);
  return s;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
// Which mailbox this copy is running in. Comes from Google (Session, else the identity token's email), never from the code, so the identical file works in any mailbox.
function mailbox_() {
  try { var e = Session.getActiveUser().getEmail(); if (e) return String(e).trim().toLowerCase(); } catch (x) {}
  try { var e2 = Session.getEffectiveUser().getEmail(); if (e2) return String(e2).trim().toLowerCase(); } catch (y) {}
  return IDENTITY_EMAIL_ || 'unknown';
}
// Where failure emails go: Script Property ALERT_EMAIL (same in every copy), else this mailbox itself (never nowhere).
function alertEmail_() { var v = String(props_().getProperty('ALERT_EMAIL') || '').trim(); return validEmail_(v) ? v.toLowerCase() : ''; }
function alertEmailInvalid_() { var v = String(props_().getProperty('ALERT_EMAIL') || '').trim(); return !!v && !validEmail_(v); }
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
  try { if (!to) throw new Error('no valid alert address (the mailbox address could not be read; set ALERT_EMAIL under Script Properties)'); MailApp.sendEmail(to, subject, body); }
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

if (typeof module !== 'undefined') module.exports = { senderOk_: senderOk_, eligible_: eligible_, buildPayload_: buildPayload_, handleResponse_: handleResponse_, calendarFailure_: calendarFailure_, decodeJwtPayload_: decodeJwtPayload_, trimIds_: trimIds_, trimMap_: trimMap_, searchQueries_: searchQueries_, redact_: redact_, domains_: domains_, extractRfcId_: extractRfcId_, parseConfig_: parseConfig_, configFingerprint_: configFingerprint_, utf8Len_: utf8Len_, SCRIPT_VERSION: SCRIPT_VERSION };
