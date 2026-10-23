/**
 * DELIVERY EMAILS -> HUB  (v1.0, Oct 23 2026 - Delivery system Phase 1, the mailbox side)
 * ---------------------------------------------------------------------------------------------
 * When you order an appliance (Home Depot, Lowe's, Ace, Walmart), the store emails you an order
 * confirmation, a delivery date, a delivery window, "your driver is N stops away", "delivered",
 * reschedule and cancel notices. Every minute this script finds the NEW ones in this mailbox and
 * hands each one to the Hub (POST /intake/delivery-email). The Hub reads it, creates or updates the
 * Delivery record, links the property / work order, and texts you. THIS script then puts the
 * delivery on the Google Calendar (one event per order, moved or deleted when the store changes it).
 *
 * NO AI IN HERE. Plain Gmail search + one HTTPS call + Calendar. The Hub decides what each email
 * is. Marketing that slips through comes back as "not_delivery" and is labelled Delivery/Ignored
 * quietly. Nothing is deleted or archived.
 *
 * LABELS this script puts on the Gmail thread:
 *   Delivery/Sent to Hub      - the Hub took it.
 *   Delivery/Needs Attention  - something needs you (you also get an email saying what).
 *   Delivery/Ignored          - the Hub says it is not about a delivery (no alert).
 *
 * NOTHING FAILS SILENTLY (this script emails brett@bmoremanagement.com only when something is
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
 * Use the mailbox that receives the store emails (info@bmoremanagement.com most likely). Do it
 * again in brett@bmoremanagement.com only if store emails ever land there too.
 *   1. Open script.google.com while signed in to that mailbox. Click "New project" (top left).
 *      Click "Untitled project" at the top and rename it  Delivery Intake.
 *   2. In the Editor, click "Code.gs" in the left list. Select everything (Ctrl+A), delete, paste
 *      this whole file. Press Ctrl+S to save.
 *   3. Click the gear "Project Settings" in the left bar and tick
 *      "Show "appsscript.json" manifest file in editor". Click "Editor" (the < > icon) in the left
 *      bar, click appsscript.json, select everything, delete, paste the companion appsscript.json,
 *      Ctrl+S.
 *   4. Token (so the Hub accepts this script). In your brett@ account open the existing
 *      "Buildium Intake" project, pick showToken in the function dropdown, click Run, and copy the
 *      long INTAKE_TOKEN value from the "Execution log" at the bottom. Nothing changes in Cloudflare.
 *      Back in Delivery Intake: gear "Project Settings" -> scroll to "Script Properties" ->
 *      "Edit script properties" -> "Add script property": Property = INTAKE_TOKEN, Value = the
 *      token -> "Save script properties".
 *      (Alternative: setToken('the token') inside a temporary function; the Script Properties
 *      screen is easier and leaves the token out of the code.)
 *   5. Click "Editor", pick setup in the function dropdown (top bar), click Run. Google asks for
 *      permission: "Review permissions" -> pick the mailbox -> "Advanced" ->
 *      "Go to Delivery Intake (unsafe)" -> "Allow". (It says unsafe only because it is your own
 *      unpublished script.) The Execution log should end with "Setup done".
 *   6. Optional checks: run testCalendar (proves the calendar works), run dryRunLatest (shows what
 *      the Hub would do with the newest store email, creates nothing), run status (one-glance health).
 *   7. Optional: to put the events on brett@'s calendar instead of this mailbox's own calendar:
 *      in brett@'s Google Calendar share that calendar with info@ ("Settings and sharing" ->
 *      "Share with specific people or groups" -> add info@ -> "Make changes to events"), then here
 *      Script Properties -> add CALENDAR_ID = brett@bmoremanagement.com, then run testCalendar.
 */

// ── Fixed names ──────────────────────────────────────────────────────────────────────────────
var WORKER_URL    = 'https://maintenance-hub.brett-2f8.workers.dev';
var HUB_PATH      = '/intake/delivery-email';
var NOTIFY_EMAIL  = 'brett@bmoremanagement.com';
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
var KEEP_EVENTS   = 200;
var KEEP_FAILS    = 200;
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
  try { getCal_(); Logger.log('Calendar OK: ' + (p.getProperty('CALENDAR_ID') || 'primary')); }
  catch (e) { Logger.log('CALENDAR PROBLEM (the Hub part still works): ' + e + '  -> run testCalendar after fixing CALENDAR_ID / sharing.'); }
  if (!tokenOf_()) Logger.log('NEXT STEP: INTAKE_TOKEN is not set yet. Add it under Project Settings -> Script Properties (see the steps at the top of this file). Until then you will get an email saying so.');
  else Logger.log('Token present (' + mask_(tokenOf_()) + ').');
  Logger.log('Setup done. Mailbox: ' + mailbox_());
}

function removeTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === HANDLER) { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('Removed ' + n + ' trigger(s). The watcher is now OFF until you run setup again.');
}

// Value comes from showToken() in the Buildium Intake project (same INTAKE_TOKEN as Cloudflare).
function setToken(value) {
  var v = String(value == null ? '' : value).trim();
  if (v.length < 20 || /\s/.test(v)) throw new Error('That does not look like the token (too short or has spaces). Copy the whole INTAKE_TOKEN value from showToken() in the Buildium Intake project.');
  props_().setProperty('INTAKE_TOKEN', v);
  Logger.log('Token saved (' + v.length + ' characters, ' + mask_(v) + ').');
}

// Never prints the whole token here; shows enough to compare with the Buildium project.
function showToken() {
  var t = tokenOf_();
  Logger.log(t ? 'INTAKE_TOKEN is set: ' + mask_(t) + ' (' + t.length + ' characters).' : 'INTAKE_TOKEN is NOT set. See step 4 at the top of this file.');
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
    p.setProperty('FAILS', JSON.stringify(fails));

    var r = sendToHub_(c.m, token, mailbox, false);
    if (!r.ok) {
      f.n = (f.n || 0) + 1; f.inflight = false; f.last = r.raw;
      stats.failed++;
      var due = !f.la || (Date.now() - f.la) >= ALERT_EVERY_MS;
      if (due) { f.la = Date.now(); failLines.push('- "' + c.m.getSubject() + '" (received ' + c.m.getDate() + '), attempt ' + f.n + ': ' + r.raw); }
      fails[c.id] = f;
      p.setProperty('FAILS', JSON.stringify(trimMap_(fails, KEEP_FAILS, 'la')));
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
        try { calRes = applyCalendar_(r.calendar, { order_number: r.json.order_number, wo_id: r.json.wo_id, delivery_address: r.json.delivery_address }); if (calRes && calRes.changed) stats.cal_ok++; }
        catch (e) { calErr = e; stats.cal_fail++; }
      }
      if (r.attention) { stats.attention++; queueAlert_('Delivery email needs your attention', r.attentionText + '\n\nEmail: ' + c.m.getSubject() + '\nReceived: ' + c.m.getDate() + (r.summary ? '\nHub has: ' + r.summary : '')); }
      if (calErr) queueAlert_('Delivery NOT added to the calendar', 'The Hub saved this delivery, but the Google Calendar could not be updated: ' + redact_(calErr, token) + '\n\nWHAT TO DO: add it by hand' + (r.calendar.title ? ': ' + r.calendar.title : '') + (r.calendar.start_iso ? ' on ' + r.calendar.start_iso : '') + (r.calendar.location ? ' at ' + r.calendar.location : '') + '. Then run testCalendar in the Delivery Intake project to see why (calendar permission, or CALENDAR_ID is wrong).\n\nEmail: ' + c.m.getSubject());
      if (r.attention || calErr) labelName = LABEL_ATTN;
    }
    done.push(c.id); delete fails[c.id];
    addLabel_(c.thread, labelName);
    if (wasFailed && labelName !== LABEL_ATTN && !threadHasFail_(c.thread, fails)) removeLabel_(c.thread, LABEL_ATTN);
    done = trimIds_(done, KEEP_IDS);
    p.setProperty('DONE_IDS', JSON.stringify(done));
    p.setProperty('FAILS', JSON.stringify(fails));
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
// A display name such as "orders@homedepot.com" <x@evil.io> must not pass.
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

function rfcMessageId_(m) {
  try { var h = m.getHeader('Message-ID'); h = h && String(h).trim(); return h || ''; } catch (e) { return ''; }
}

function buildPayload_(m, mailbox, dry) {
  var id = rfcMessageId_(m) || m.getId();
  var html = ''; try { html = String(m.getBody() || ''); } catch (e) {}
  var body = String(m.getPlainBody() || '');
  var payload = {
    subject: m.getSubject(), body: body.slice(0, BODY_MAX), from: m.getFrom(),
    message_id: (dry ? 'DRYRUN-' : '') + id, received_at: m.getDate().toISOString(),
    mailbox: mailbox, dry_run: !!dry
  };
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

function findByTag_(cal, key, plan) {
  if (!plan.startYmd) return null;
  var from = new Date(plan.startYmd.y, plan.startYmd.mo - 1, plan.startYmd.d - 2), to = new Date(plan.startYmd.y, plan.startYmd.mo - 1, plan.startYmd.d + 3);
  var evs = cal.getEvents(from, to);
  for (var i = 0; i < evs.length; i++) { try { if (evs[i].getTag(TAG_NAME) === key) return evs[i]; } catch (e) {} }
  return null;
}

// One event per calendar.key. Returns { changed, what }. THROWS on failure (caller emails Brett).
function applyCalendar_(c, extra) {
  var p = props_(), map = json_(p.getProperty('DELIVERY_EVENTS'), {});
  var plan = calendarPlan_(c, extra);
  if (plan.op === 'none') return { changed: false, what: 'none' };
  if (plan.op === 'invalid') throw new Error(plan.error);
  var cal = getCal_(), key = plan.key, ev = null;
  if (map[key] && map[key].id) { try { ev = cal.getEventById(map[key].id); } catch (e) { ev = null; } }
  if (!ev) ev = findByTag_(cal, key, plan);               // map lost or a crash between create and save: do not duplicate
  if (plan.op === 'delete') {
    if (!ev) { delete map[key]; p.setProperty('DELIVERY_EVENTS', JSON.stringify(map)); return { changed: false, what: 'nothing to delete' }; }
    ev.deleteEvent();
    delete map[key]; p.setProperty('DELIVERY_EVENTS', JSON.stringify(map));
    return { changed: true, what: 'deleted' };
  }
  var opts = { location: plan.location, description: plan.description }, what;
  if (ev) {
    ev.setTitle(plan.title);
    if (plan.allDay) ev.setAllDayDate(plan.start); else ev.setTime(plan.start, plan.end);
    ev.setLocation(plan.location); ev.setDescription(plan.description);
    what = 'updated';
  } else {
    ev = plan.allDay ? cal.createAllDayEvent(plan.title, plan.start, opts) : cal.createEvent(plan.title, plan.start, plan.end, opts);
    try { ev.setTag(TAG_NAME, key); } catch (e) {}
    what = 'created';
  }
  map[key] = { id: ev.getId(), t: Date.now() };
  p.setProperty('DELIVERY_EVENTS', JSON.stringify(trimMap_(map, KEEP_EVENTS, 't')));
  return { changed: true, what: what };
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
  if (!token) { Logger.log('INTAKE_TOKEN is not set; add it first (step 4 at the top of this file).'); return; }
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
    alerts_waiting: alertQueue_().length
  };
  Logger.log('Trigger: ' + (mine === 1 ? 'OK (1)' : 'PROBLEM - ' + mine + ' installed, should be 1; run setup') + (s.other_triggers ? ' (+' + s.other_triggers + ' other)' : ''));
  Logger.log('Set up since: ' + (s.cutoff || 'NOT SET UP - run setup'));
  Logger.log('Token: ' + (s.token_present ? 'present (' + mask_(tokenOf_()) + ')' : 'MISSING'));
  Logger.log('Calendar: ' + s.calendar_id + ' | events tracked: ' + s.events_tracked + ' | mailbox: ' + s.mailbox);
  Logger.log('Last run: ' + (last ? new Date(last.t).toString() + ' ' + JSON.stringify(last) : 'never'));
  Logger.log('Totals: ' + JSON.stringify(counts) + ' | failing emails: ' + s.failing + ' | alerts waiting to send: ' + s.alerts_waiting);
  return s;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function mailbox_() {
  try { var e = Session.getActiveUser().getEmail(); if (e) return e; } catch (x) {}
  try { var e2 = Session.getEffectiveUser().getEmail(); if (e2) return e2; } catch (y) {}
  return 'unknown';
}
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
function alertQueue_() { return json_(props_().getProperty('ALERT_QUEUE'), []); }
function queueAlert_(subject, body) {
  var q = alertQueue_(); q.push({ s: subject, b: body, t: new Date().toString() });
  props_().setProperty('ALERT_QUEUE', JSON.stringify(q.slice(-20)));
}
function flushAlerts_() {
  var q = alertQueue_();
  if (!q.length) return true;
  var subject = '[Hub delivery] ' + (q.length === 1 ? q[0].s : q.length + ' delivery watcher notices');
  var body = q.map(function (a, i) { return (q.length > 1 ? (i + 1) + '. ' + a.s + '\n' : '') + a.b + '\n(' + a.t + ')'; }).join('\n\n----------\n\n');
  try { MailApp.sendEmail(NOTIFY_EMAIL, subject, body); }
  catch (e) { Logger.log('ALERT EMAIL FAILED: ' + e + ' | ' + subject); return false; }
  props_().deleteProperty('ALERT_QUEUE');
  return true;
}
// At most one email per key per hour (so a stuck condition cannot flood the mailbox).
function alertThrottled_(key, subject, body) {
  var p = props_(), k = 'LAST_ALERT_' + key, last = Number(p.getProperty(k) || 0);
  if (Date.now() - last < ALERT_EVERY_MS) return;
  queueAlert_(subject, body);
  if (flushAlerts_()) p.setProperty(k, String(Date.now()));
  else throw new Error('Delivery alert could not be emailed: ' + subject);
}

if (typeof module !== 'undefined') module.exports = { senderOk_: senderOk_, eligible_: eligible_, buildPayload_: buildPayload_, handleResponse_: handleResponse_, calendarPlan_: calendarPlan_, trimIds_: trimIds_, trimMap_: trimMap_, searchQueries_: searchQueries_, redact_: redact_, domains_: domains_ };
