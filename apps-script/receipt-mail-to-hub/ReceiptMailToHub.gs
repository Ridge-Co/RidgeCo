/**
 * RECEIPT MAIL → HUB  (v1.0, Sep 22 2026)
 * ---------------------------------------------------------------------------------------------
 * Moves emailed purchase receipts (Home Depot, Lowe's, Amazon, anything you approve) into the
 * Drive folder the RidgeCo Hub's Receipt Reconciler already scans:
 *     "Receipts and Invoices"  (folder ID 1-sf6pQN2DD3qj5cPZavy1k0DOfH4U20n)
 * From there the Hub OCRs the file and suggests a work order, exactly like a scanned paper receipt.
 *
 * NO AI IN HERE. It's all Gmail filters, labels and plain rules:
 *   1. A real Gmail filter (one per approved rule) puts matching emails in the label
 *      "Receipts/To Hub" when they arrive. You can also add that label by hand to any email
 *      (e.g. a vendor forwarding you a Home Depot order), including from the Gmail phone app.
 *   2. Every 10 minutes processQueue() looks ONLY at that label. It doesn't search the inbox.
 *      It saves each email's PDF/photo attachment into the folder, or turns the email body into
 *      a PDF if there's no attachment. Then it moves the email to "Receipts/Sent to Hub".
 *   3. Every Monday, weeklyDiscovery() lists senders that look like receipts but aren't covered
 *      yet and adds them to the Rules sheet as "Pending". The digest email asks you to set each
 *      one to Approved or Denied. The next run after you approve one creates its Gmail filter
 *      and pulls in its past emails back to Backfill_Since.
 *
 * Runs on Google's own scheduler (Apps Script triggers). Nothing here touches Cloudflare cron.
 * Install the same file in EACH mailbox that receives receipts (brett@ and info@). All installs
 * share one Google Sheet ("Receipt Mail → Hub Rules") that holds the rules, config and log.
 *
 * SETUP (once per mailbox, about 3 minutes; see context/RECEIPT_MAIL_TO_HUB_v1.0.md):
 *   a. script.google.com → New project → paste this file over Code.gs → Save.
 *   b. Project Settings (gear) → tick "Show appsscript.json" → back in Editor, paste the
 *      companion appsscript.json over it → Save. (Turns on the Gmail API service and the exact
 *      permissions this needs, including creating Gmail filters.)
 *   c. Pick "setup" in the function dropdown → Run → approve the permissions prompt.
 *   Do brett@ FIRST; it creates the shared sheet and shares it with info@.
 * ---------------------------------------------------------------------------------------------
 */

// ── Fixed names (change only if you also rename things in Gmail/Drive) ───────────────────────
var SHEET_NAME       = 'Receipt Mail → Hub Rules';
var LABEL_QUEUE      = 'Receipts/To Hub';
var LABEL_DONE       = 'Receipts/Sent to Hub';
var LABEL_ERROR      = 'Receipts/Hub Error';
var TZ               = 'America/New_York';

// Defaults written into the Config tab the first time setup() runs. After that, the Config
// tab is the source of truth; edit it there, not here.
var CONFIG_DEFAULTS = {
  Drive_Folder_ID: '1-sf6pQN2DD3qj5cPZavy1k0DOfH4U20n',    // Hub Receipt Reconciler folder
  Backfill_Since:  '2026/07/01',                           // how far back a newly approved rule reaches
  Notify_Email:    'brett@bmoremanagement.com',            // who gets the Monday approval list
  Share_With:      'info@bmoremanagement.com',             // other mailboxes that install this script
  Max_Per_Run:     '25',                                   // emails handled per 10-minute run
  Discovery_Days:  '8',                                    // weekly look-back for new senders
  Min_Image_KB:    '30'                                    // smaller images are logos/signatures, skipped
};

// Rules seeded on first setup. Home Depot is pre-approved (confirmed: its e-receipt emails carry
// an eReceipt.pdf attachment). Lowe's and Amazon are deliberately NOT seeded: their emails come in
// several kinds (ordered / ready for pickup / shipped / delivered) and some have no prices at all,
// so they go through the approval list and you pick the kind that's the actual receipt.
var SEED_RULES = [
  { From: 'HomeDepot@order.homedepot.com',   Subject_Contains: 'Electronic Receipt', Store: 'HomeDepot', Status: 'Approved', Source: 'seed', Notes: 'HD e-receipt, eReceipt.pdf attached' },
  { From: 'HomeDepotReceipt@homedepot.com',  Subject_Contains: 'Electronic Receipt', Store: 'HomeDepot', Status: 'Approved', Source: 'seed', Notes: 'Older HD e-receipt sender' }
];

var RULE_HEADERS = ['Rule_ID','Status','From','Subject_Contains','Store','Source','Example_Subject','Count_Seen','Last_Seen','Found_In','Notes'];
var LOG_HEADERS  = ['Timestamp','Mailbox','Gmail_Message_ID','RFC_Message_ID','From','Subject','Email_Date','Rule_ID','Result','Drive_File_IDs','Detail'];
var STATUS_VALUES = ['Approved','Pending','Denied'];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SETUP
// ═════════════════════════════════════════════════════════════════════════════════════════════
function setup() {
  if (typeof Gmail === 'undefined') {
    throw new Error('Gmail API service is not enabled. Paste the companion appsscript.json (Project Settings → Show appsscript.json), or add "Gmail API" under Services (+), then run setup again.');
  }
  var me = Session.getActiveUser().getEmail();
  var ss = getOrCreateSheet_(me);
  var cfg = readConfig_(ss);

  // Folder must be writable from this mailbox. Fail loudly now, not silently every 10 minutes.
  try { DriveApp.getFolderById(cfg.Drive_Folder_ID).getName(); }
  catch (e) { throw new Error('This mailbox (' + me + ') cannot open the Drive folder ' + cfg.Drive_Folder_ID + '. Share it with ' + me + ' and run setup again.'); }

  [LABEL_QUEUE, LABEL_DONE, LABEL_ERROR].forEach(getOrCreateLabel_);

  // Idempotent triggers: remove this project's old ones first.
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('weeklyDiscovery').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  if (sameEmail_(me, cfg.Notify_Email)) {
    ScriptApp.newTrigger('weeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  }

  var synced = syncRules_(ss, cfg, me);            // creates filters + labels the backfill
  var found  = discover_(ss, cfg, me, 90);         // first look-back is 90 days, not 8
  // The files themselves move on the first 10-minute trigger run (or run processQueue now by
  // hand). Kept out of setup so setup stays well under Apps Script's 6-minute limit.

  var msg = 'Setup done for ' + me + '.\n' +
    'Sheet: ' + ss.getUrl() + '\n' +
    'Filters created/updated: ' + synced.created + ', past emails queued (since ' + cfg.Backfill_Since + '): ' + synced.labeled + '\n' +
    'New sender candidates added to the sheet for approval: ' + found + '\n' +
    'Files start landing in the Hub folder within 10 minutes (' + (Number(cfg.Max_Per_Run) || 25) + ' emails per run).';
  Logger.log(msg);
  return msg;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// EVERY 10 MINUTES — move labeled emails into the Drive folder
// ═════════════════════════════════════════════════════════════════════════════════════════════
function processQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { messages: 0, saved: 0, remaining: 0, skipped_locked: true };
  try {
    var me = Session.getActiveUser().getEmail();
    var ss = getOrCreateSheet_(me);
    var cfg = readConfig_(ss);
    syncRules_(ss, cfg, me);   // cheap when nothing changed: approvals take effect within 10 min

    var rules = readRules_(ss).filter(function (r) { return r.Status === 'Approved'; });
    var logged = loggedIds_(ss);
    var folder = DriveApp.getFolderById(cfg.Drive_Folder_ID);
    var qLabel = getOrCreateLabel_(LABEL_QUEUE), dLabel = getOrCreateLabel_(LABEL_DONE), eLabel = getOrCreateLabel_(LABEL_ERROR);
    var max = Number(cfg.Max_Per_Run) || 25, minImg = (Number(cfg.Min_Image_KB) || 30) * 1024;
    var started = Date.now();

    var threads = qLabel.getThreads(0, 100);
    var out = { messages: 0, saved: 0, remaining: 0 };
    for (var ti = 0; ti < threads.length; ti++) {
      if (out.messages >= max || Date.now() - started > 4.5 * 60 * 1000) { out.remaining = threads.length - ti; break; }
      var thread = threads[ti];
      var plan = planThread_(thread.getMessages(), rules, logged);
      var threadFailed = false;

      plan.skip.forEach(function (m) {
        appendLog_(ss, me, m, '', 'skipped', [], 'Manually tagged thread: only the newest email with a receipt is sent');
        markLogged_(logged, m);
      });

      for (var i = 0; i < plan.send.length; i++) {
        var item = plan.send[i], m = item.message;
        try {
          var ids = saveMessage_(m, item.rule, folder, minImg, me);
          appendLog_(ss, me, m, item.rule ? item.rule.Rule_ID : 'manual', ids.length ? 'saved' : 'nothing_to_save', ids, '');
          markLogged_(logged, m);
          out.saved += ids.length; out.messages++;
        } catch (e) {
          var tries = (logged.errors[m.getId()] || 0) + 1;
          appendLog_(ss, me, m, item.rule ? item.rule.Rule_ID : 'manual', 'error', [], String(e && e.message || e).slice(0, 300) + ' (attempt ' + tries + ')');
          logged.errors[m.getId()] = tries;
          if (tries < 3) threadFailed = true;   // leave in queue, retry next run
          else markLogged_(logged, m);          // give up after 3 tries, shows under Hub Error
          out.messages++;
        }
      }

      if (!threadFailed) {
        thread.removeLabel(qLabel);
        thread.addLabel(plan.hadHardError(logged) ? eLabel : dLabel);
      }
    }
    return out;
  } finally { lock.releaseLock(); }
}

/**
 * Decide which messages in a queued thread get sent. Pure logic; no Gmail calls except getters.
 *  - Messages matching an Approved rule are sent (every one not already logged).
 *  - If NOTHING in the thread matches a rule, it was tagged by hand: send only the newest
 *    not-yet-logged message that has a real attachment, or the newest message if none has one.
 *    Older messages in that thread are logged as skipped so re-tagging doesn't duplicate.
 */
function planThread_(messages, rules, logged) {
  var fresh = messages.filter(function (m) { return !isLogged_(logged, m); });
  var send = [], skip = [];
  var matched = fresh.map(function (m) { return { message: m, rule: matchRule_(rules, m.getFrom(), m.getSubject()) }; })
                     .filter(function (x) { return x.rule; });
  if (matched.length) {
    send = matched;
  } else if (fresh.length) {
    var withAtt = fresh.filter(function (m) { return m.getAttachments({ includeInlineImages: false }).length > 0; });
    var pick = (withAtt.length ? withAtt : fresh)[(withAtt.length ? withAtt : fresh).length - 1];
    send = [{ message: pick, rule: null }];
    skip = fresh.filter(function (m) { return m !== pick; });
  }
  return {
    send: send, skip: skip,
    hadHardError: function (lg) { return send.some(function (x) { return (lg.errors[x.message.getId()] || 0) >= 3; }); }
  };
}

/** Save one email's receipt into the folder. Returns the new Drive file IDs. */
function saveMessage_(m, rule, folder, minImgBytes, mailbox) {
  var from = m.getFrom(), date = m.getDate();
  var store = rule ? (rule.Store || storeFromSender_(from)) : 'Manual';   // hand-tagged emails
  var base = Utilities.formatDate(date, TZ, 'yyyy-MM-dd') + '_' + slug_(store) + '_' + m.getId().slice(-8);
  var link = 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(mailbox) + '#all/' + m.getId();
  var desc = 'From email → Hub. Mailbox: ' + mailbox + ' | From: ' + from + ' | Subject: ' + m.getSubject() + ' | ' + link;

  var atts = m.getAttachments({ includeInlineImages: false, includeAttachments: true }).filter(function (a) {
    var t = String(a.getContentType() || '').toLowerCase();
    if (t.indexOf('pdf') !== -1) return true;
    if (t.indexOf('image/') === 0) return a.getSize() >= minImgBytes && !/heic|heif|tiff?/.test(t);  // Hub OCR takes jpeg/png/gif/webp
    return false;
  });

  var blobs = [];
  if (atts.length) {
    atts.forEach(function (a, i) {
      var t = String(a.getContentType()).toLowerCase();
      var ext = t.indexOf('pdf') !== -1 ? 'pdf' : (t.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      blobs.push(a.copyBlob().setName(base + (atts.length > 1 ? '_' + (i + 1) : '') + '.' + ext));
    });
  } else {
    // No usable attachment: render the email itself to PDF (Lowe's/Amazon-style HTML receipts).
    var header = '<div style="font:12px Arial,sans-serif;border-bottom:1px solid #999;padding-bottom:6px;margin-bottom:10px">' +
      'From: ' + esc_(from) + '<br>Date: ' + esc_(Utilities.formatDate(date, TZ, 'yyyy-MM-dd HH:mm')) +
      '<br>Subject: ' + esc_(m.getSubject()) + '<br>Mailbox: ' + esc_(mailbox) + '</div>';
    var html = '<html><head><meta charset="utf-8"></head><body>' + header + (m.getBody() || esc_(m.getPlainBody() || '')) + '</body></html>';
    blobs.push(Utilities.newBlob(html, 'text/html', base + '.html').getAs('application/pdf').setName(base + '.pdf'));
  }

  var ids = [];
  blobs.forEach(function (b) {
    var existing = folder.getFilesByName(b.getName());         // belt-and-braces duplicate guard
    if (existing.hasNext()) { ids.push(existing.next().getId()); return; }
    var f = folder.createFile(b);
    try { f.setDescription(desc.slice(0, 1000)); } catch (e) { /* description is nice-to-have */ }
    ids.push(f.getId());
  });
  return ids;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// RULES → REAL GMAIL FILTERS (+ one-time backfill per rule)
// ═════════════════════════════════════════════════════════════════════════════════════════════
/**
 * For THIS mailbox: every Approved rule gets a Gmail filter (label "Receipts/To Hub"), and the
 * first time, its past emails since Backfill_Since get that label too. A rule that is no longer
 * Approved (or whose From/Subject was edited) has its old filter removed. Filter IDs are kept
 * in this project's Script Properties, which are per mailbox.
 */
function syncRules_(ss, cfg, me) {
  var props = PropertiesService.getScriptProperties();
  var rules = readRules_(ss);
  var queueLabelId = gmailLabelId_(LABEL_QUEUE);
  var result = { created: 0, removed: 0, labeled: 0 };
  var wanted = {};

  rules.forEach(function (r) {
    if (r.Status !== 'Approved' || !r.From) return;
    var sig = r.From.toLowerCase() + '|' + (r.Subject_Contains || '').toLowerCase();
    wanted[r.Rule_ID] = true;
    var key = 'filter:' + r.Rule_ID, saved = props.getProperty(key);
    var rec = saved ? JSON.parse(saved) : null;
    if (rec && rec.sig === sig) return;                                  // already in place
    if (rec && rec.id) { try { Gmail.Users.Settings.Filters.remove('me', rec.id); result.removed++; } catch (e) {} }

    var criteria = { from: r.From };
    if (r.Subject_Contains) criteria.subject = r.Subject_Contains;
    var id = findExistingFilter_(criteria, queueLabelId);
    if (!id) {
      id = Gmail.Users.Settings.Filters.create({ criteria: criteria, action: { addLabelIds: [queueLabelId] } }, 'me').id;
      result.created++;
    }
    props.setProperty(key, JSON.stringify({ id: id, sig: sig }));

    // Backfill: label past matches once, for this rule's current definition.
    if (props.getProperty('backfill:' + r.Rule_ID) !== sig) {
      result.labeled += labelPast_(r, cfg.Backfill_Since);
      props.setProperty('backfill:' + r.Rule_ID, sig);
    }
  });

  // Remove filters for rules that were denied, set back to pending, or deleted from the sheet.
  props.getKeys().forEach(function (k) {
    if (k.indexOf('filter:') !== 0) return;
    var ruleId = k.slice(7);
    if (wanted[ruleId]) return;
    try { Gmail.Users.Settings.Filters.remove('me', JSON.parse(props.getProperty(k)).id); result.removed++; } catch (e) {}
    props.deleteProperty(k);
  });
  return result;
}

function labelPast_(rule, since) {
  var q = 'from:(' + rule.From + ')' + (rule.Subject_Contains ? ' subject:(' + rule.Subject_Contains + ')' : '') +
          ' after:' + since + ' -' + labelQ_(LABEL_DONE) + ' -' + labelQ_(LABEL_QUEUE) + ' -' + labelQ_(LABEL_ERROR);
  var label = getOrCreateLabel_(LABEL_QUEUE), n = 0;
  for (var start = 0; start < 500; start += 100) {
    var batch = GmailApp.search(q, start, 100);
    if (!batch.length) break;
    label.addToThreads(batch); n += batch.length;
    if (batch.length < 100) break;
  }
  return n;
}

function findExistingFilter_(criteria, labelId) {
  var list = (Gmail.Users.Settings.Filters.list('me').filter) || [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i], c = f.criteria || {}, a = f.action || {};
    if ((c.from || '') === (criteria.from || '') && (c.subject || '') === (criteria.subject || '') &&
        (a.addLabelIds || []).indexOf(labelId) !== -1) return f.id;
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// WEEKLY — find new receipt-looking senders for approval
// ═════════════════════════════════════════════════════════════════════════════════════════════
function weeklyDiscovery() {
  var me = Session.getActiveUser().getEmail();
  var ss = getOrCreateSheet_(me);
  var cfg = readConfig_(ss);
  return discover_(ss, cfg, me, Number(cfg.Discovery_Days) || 8);
}

/**
 * Keyword + attachment based, no AI. Candidate = an email from the last N days that has a PDF
 * attached or a receipt-like subject, isn't already covered by any rule (Approved, Pending or
 * Denied), and isn't a promotion/newsletter. Grouped by sender + subject pattern (numbers,
 * order #s and quoted product names stripped), so "Ordered: "Mobil 1…"" and
 * "Ordered: "M18 bits…"" become one candidate: "Ordered:".
 */
function discover_(ss, cfg, me, days) {
  var q = 'newer_than:' + days + 'd -from:me -in:chats -category:promotions -category:social -label:newsletters ' +
          '-' + labelQ_(LABEL_QUEUE) + ' -' + labelQ_(LABEL_DONE) + ' -' + labelQ_(LABEL_ERROR) + ' ' +
          '(filename:pdf OR subject:(receipt OR invoice OR "order confirmation" OR "your order" OR ordered OR purchase OR "order #"))';
  var rules = readRules_(ss);
  var groups = {}, t0 = Date.now();
  for (var start = 0; start < 300 && Date.now() - t0 < 3 * 60 * 1000; start += 100) {
    var threads = GmailApp.search(q, start, 100);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        if ((Date.now() - m.getDate().getTime()) > days * 86400000) return;
        var from = emailOf_(m.getFrom()), subj = m.getSubject() || '';
        if (!from || sameEmail_(from, me)) return;
        if (matchRule_(rules, from, subj, true)) return;              // any status suppresses
        var pattern = subjectPattern_(subj);
        var key = from.toLowerCase() + '|' + pattern.toLowerCase();
        var g = groups[key] || (groups[key] = { from: from, pattern: pattern, example: subj, count: 0, last: m.getDate() });
        g.count++; if (m.getDate() > g.last) { g.last = m.getDate(); g.example = subj; }
      });
    });
    if (threads.length < 100) break;
  }
  return upsertCandidates_(ss, groups, me);
}

function upsertCandidates_(ss, groups, me) {
  var sh = ss.getSheetByName('Rules');
  var rows = readRules_(ss);
  var added = 0;
  Object.keys(groups).forEach(function (key) {
    var g = groups[key];
    var existing = rows.filter(function (r) { return r.Status === 'Pending' && r.From.toLowerCase() === g.from.toLowerCase() && (r.Subject_Contains || '').toLowerCase() === g.pattern.toLowerCase(); })[0];
    var lastSeen = Utilities.formatDate(g.last, TZ, 'yyyy-MM-dd');
    if (existing) {
      var foundIn = mergeList_(existing.Found_In, me);
      sh.getRange(existing._row, RULE_HEADERS.indexOf('Count_Seen') + 1, 1, 3).setValues([[Number(existing.Count_Seen || 0) + g.count, lastSeen, foundIn]]);
      return;
    }
    var id = nextRuleId_(rows);
    var rec = { Rule_ID: id, Status: 'Pending', From: g.from, Subject_Contains: g.pattern, Store: storeFromSender_(g.from),
                Source: 'discovered', Example_Subject: g.example, Count_Seen: g.count, Last_Seen: lastSeen, Found_In: me, Notes: '' };
    sh.appendRow(RULE_HEADERS.map(function (h) { return rec[h]; }));
    rec._row = sh.getLastRow(); rows.push(rec); added++;
  });
  return added;
}

/** Monday digest to Notify_Email: every Pending row, with how to approve. Installed in one mailbox only. */
function weeklyDigest() {
  var me = Session.getActiveUser().getEmail();
  var ss = getOrCreateSheet_(me);
  var cfg = readConfig_(ss);
  var pending = readRules_(ss).filter(function (r) { return r.Status === 'Pending'; });
  var since = new Date(Date.now() - 7 * 86400000);
  var log = ss.getSheetByName('Log').getDataRange().getValues().slice(1);
  var savedWeek = log.filter(function (r) { return r[8] === 'saved' && new Date(r[0]) >= since; }).length;
  var errWeek = log.filter(function (r) { return r[8] === 'error' && new Date(r[0]) >= since; }).length;
  if (!pending.length && !errWeek) return 'nothing to send';

  var rowsHtml = pending.map(function (r) {
    return '<tr><td>' + esc_(r.Rule_ID) + '</td><td>' + esc_(r.From) + '</td><td>' + esc_(r.Subject_Contains) + '</td><td>' +
           esc_(r.Example_Subject) + '</td><td style="text-align:right">' + esc_(String(r.Count_Seen || '')) + '</td><td>' + esc_(r.Found_In) + '</td></tr>';
  }).join('');
  var html = '<p><b>Receipt senders waiting for your OK: ' + pending.length + '</b></p>' +
    '<p>Open the <a href="' + ss.getUrl() + '">rules sheet</a> and set <b>Status</b> to <b>Approved</b> (send these to the Hub from now on, and pull in past ones since ' +
    esc_(cfg.Backfill_Since) + ') or <b>Denied</b> (never ask again). You can shorten <b>Subject_Contains</b> before approving; it matches if every word is in the subject.</p>' +
    (pending.length ? '<table border="1" cellpadding="4" style="border-collapse:collapse;font:12px Arial"><tr><th>ID</th><th>From</th><th>Subject_Contains</th><th>Example</th><th>#</th><th>Mailbox</th></tr>' + rowsHtml + '</table>' : '') +
    '<p>Last 7 days: ' + savedWeek + ' email(s) sent to the Hub folder' + (errWeek ? ', <b>' + errWeek + ' error(s)</b>, see the Log tab and the "Receipts/Hub Error" label' : '') + '.</p>';
  MailApp.sendEmail({ to: cfg.Notify_Email, subject: 'Receipt senders to approve (' + pending.length + ')', htmlBody: html });
  return 'sent';
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SHEET (rules / config / log)
// ═════════════════════════════════════════════════════════════════════════════════════════════
function getOrCreateSheet_(me) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* fall through and look again */ } }

  // Another mailbox may already have created it and shared it with this one.
  var it = DriveApp.searchFiles('title = "' + SHEET_NAME + '" and mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false');
  var ss = it.hasNext() ? SpreadsheetApp.openById(it.next().getId()) : null;

  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    var rules = ss.getSheets()[0].setName('Rules');
    rules.getRange(1, 1, 1, RULE_HEADERS.length).setValues([RULE_HEADERS]).setFontWeight('bold');
    rules.setFrozenRows(1);
    SEED_RULES.forEach(function (r, i) {
      var rec = Object.assign({ Rule_ID: 'R' + (i + 1), Found_In: me, Count_Seen: '', Last_Seen: '', Example_Subject: '' }, r);
      rules.appendRow(RULE_HEADERS.map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
    });
    var statusCol = RULE_HEADERS.indexOf('Status') + 1;
    rules.getRange(2, statusCol, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS_VALUES, true).setAllowInvalid(false).build());

    var cfg = ss.insertSheet('Config');
    cfg.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Meaning']]).setFontWeight('bold');
    var meaning = {
      Drive_Folder_ID: 'Hub Receipt Reconciler folder ("Receipts and Invoices")',
      Backfill_Since: 'yyyy/mm/dd. How far back a newly approved rule pulls past emails',
      Notify_Email: 'Gets the Monday approval list',
      Share_With: 'Other mailboxes that install this script (comma-separated)',
      Max_Per_Run: 'Emails handled per 10-minute run',
      Discovery_Days: 'Weekly look-back for new senders',
      Min_Image_KB: 'Images smaller than this are logos/signatures and are skipped'
    };
    Object.keys(CONFIG_DEFAULTS).forEach(function (k) { cfg.appendRow([k, CONFIG_DEFAULTS[k], meaning[k] || '']); });
    cfg.getRange('B:B').setNumberFormat('@');   // keep 2026/07/01 as text, not a date

    var log = ss.insertSheet('Log');
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    log.setFrozenRows(1);

    String(CONFIG_DEFAULTS.Share_With || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (email) {
      try { DriveApp.getFileById(ss.getId()).addEditor(email); } catch (e) { Logger.log('Could not share with ' + email + ': ' + e); }
    });
  }
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function readConfig_(ss) {
  var out = Object.assign({}, CONFIG_DEFAULTS);
  var vals = ss.getSheetByName('Config').getDataRange().getValues().slice(1);
  vals.forEach(function (r) {
    if (!r[0]) return;
    var v = r[1];
    if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy/MM/dd');   // someone retyped the date
    out[String(r[0]).trim()] = String(v).trim();
  });
  return out;
}

function readRules_(ss) {
  var sh = ss.getSheetByName('Rules');
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(String);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var rec = { _row: i + 1 };
    head.forEach(function (h, j) { rec[h] = vals[i][j] === null ? '' : String(vals[i][j]).trim(); });
    if (!rec.From) continue;
    if (!rec.Rule_ID) {                     // row typed in by hand: give it an ID
      rec.Rule_ID = nextRuleId_(rows.concat([rec]));
      sh.getRange(i + 1, head.indexOf('Rule_ID') + 1).setValue(rec.Rule_ID);
    }
    rec.Status = normStatus_(rec.Status);
    rows.push(rec);
  }
  return rows;
}

function appendLog_(ss, mailbox, m, ruleId, result, fileIds, detail) {
  ss.getSheetByName('Log').appendRow([
    new Date(), mailbox, m.getId(), rfcId_(m), m.getFrom(), m.getSubject(),
    Utilities.formatDate(m.getDate(), TZ, 'yyyy-MM-dd HH:mm'), ruleId, result, fileIds.join(','), detail || ''
  ]);
}

/**
 * Already-handled set, across BOTH mailboxes. The RFC Message-ID header is the same when one
 * email is delivered to brett@ and info@, so the second mailbox skips it: no duplicate files.
 * Errors don't count as handled (they retry) until the 3rd attempt.
 */
function loggedIds_(ss) {
  var vals = ss.getSheetByName('Log').getDataRange().getValues().slice(1);
  var out = { gmail: {}, rfc: {}, errors: {} };
  vals.forEach(function (r) {
    if (r[8] === 'error') { out.errors[r[2]] = (out.errors[r[2]] || 0) + 1; return; }
    out.gmail[r[2]] = true; if (r[3]) out.rfc[r[3]] = true;
  });
  Object.keys(out.errors).forEach(function (id) { if (out.errors[id] >= 3) out.gmail[id] = true; });
  return out;
}
function isLogged_(lg, m) { return !!(lg.gmail[m.getId()] || (rfcId_(m) && lg.rfc[rfcId_(m)])); }
function markLogged_(lg, m) { lg.gmail[m.getId()] = true; var r = rfcId_(m); if (r) lg.rfc[r] = true; }
function rfcId_(m) { try { return String(m.getHeader('Message-ID') || '').trim(); } catch (e) { return ''; } }

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SMALL HELPERS (pure; covered by test/receipt-mail-to-hub.test.mjs)
// ═════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Same meaning as the Gmail filter: From matches the sender's address exactly, or its domain
 * when From is a domain ("lowes.com" or "@lowes.com"); every word of Subject_Contains appears in
 * the subject (blank = any subject). includeAll=true also matches Pending/Denied rules.
 */
function matchRule_(rules, fromHeader, subject, includeAll) {
  var addr = emailOf_(fromHeader).toLowerCase();
  var subj = normWords_(subject);
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if (!includeAll && r.Status !== 'Approved') continue;
    var f = String(r.From || '').toLowerCase().trim();
    if (!f) continue;
    var fromOk = f.indexOf('@') > 0 ? addr === f
               : (addr.slice(-(f.replace(/^@/, '').length + 1)) === '@' + f.replace(/^@/, '') || addr.endsWith('.' + f.replace(/^@/, '')));
    if (!fromOk) continue;
    var words = normWords_(r.Subject_Contains).split(' ').filter(Boolean);
    var subjWords = ' ' + subj + ' ';
    if (words.every(function (w) { return subjWords.indexOf(' ' + w + ' ') !== -1; })) return r;
  }
  return null;
}

function subjectPattern_(subject) {
  return String(subject || '')
    .replace(/[⁦-⁩‎‏‪-‮]/g, '')         // bidi marks Amazon puts around counts
    .replace(/"[^"]*"|“[^”]*”/g, '')                                   // quoted product names
    .replace(/\(\s*#?[\w-]*\d[\w-]*\s*\)/g, '')                          // (#3009012602...)
    .replace(/#\s*[\w-]*\d[\w-]*/g, '')                                  // order # 300901...
    .replace(/\b[\w-]*\d[\w-]*\b/g, '')                                  // any other token with digits
    .replace(/\band\s+more items?\b/gi, '')
    .replace(/\s+([!?.,:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:,-]+|[\s,-]+$/g, '')
    .trim();
}

function normWords_(s) { return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9@.]+/g, ' ').trim(); }
function emailOf_(h) { var m = String(h || '').match(/<([^>]+)>/); return (m ? m[1] : String(h || '')).trim(); }
function sameEmail_(a, b) { return emailOf_(a).toLowerCase() === emailOf_(b).toLowerCase(); }
function storeFromSender_(from) {
  var dom = emailOf_(from).split('@')[1] || 'email';
  var parts = dom.toLowerCase().split('.');
  var core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  var known = { homedepot: 'HomeDepot', lowes: 'Lowes', amazon: 'Amazon', harborfreight: 'HarborFreight', sherwin: 'SherwinWilliams', 'sherwin-williams': 'SherwinWilliams', ferguson: 'Ferguson', grainger: 'Grainger', menards: 'Menards' };
  return known[core] || core.charAt(0).toUpperCase() + core.slice(1);
}
function slug_(s) { return String(s || 'receipt').replace(/[^A-Za-z0-9]+/g, '').slice(0, 24) || 'receipt'; }
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function labelQ_(name) { return 'label:' + name.toLowerCase().replace(/[\/\s]+/g, '-'); }
function normStatus_(s) { var t = String(s || '').trim().toLowerCase(); return t === 'approved' ? 'Approved' : t === 'denied' ? 'Denied' : 'Pending'; }
function mergeList_(csv, v) { var a = String(csv || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); if (a.indexOf(v) === -1) a.push(v); return a.join(', '); }
function nextRuleId_(rows) {
  var max = 0; rows.forEach(function (r) { var n = Number(String(r.Rule_ID || '').replace(/^R/i, '')); if (n > max) max = n; });
  return 'R' + (max + 1);
}
function getOrCreateLabel_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
function gmailLabelId_(name) {
  getOrCreateLabel_(name);
  var labels = Gmail.Users.Labels.list('me').labels || [];
  for (var i = 0; i < labels.length; i++) if (labels[i].name === name) return labels[i].id;
  throw new Error('Label not found via Gmail API: ' + name);
}

// Node test hook (ignored by Apps Script).
if (typeof module !== 'undefined') module.exports = { matchRule_: matchRule_, subjectPattern_: subjectPattern_, planThread_: planThread_, storeFromSender_: storeFromSender_, labelQ_: labelQ_, emailOf_: emailOf_, normStatus_: normStatus_, nextRuleId_: nextRuleId_, readRules_: readRules_, loggedIds_: loggedIds_, isLogged_: isLogged_ };
