/**
 * Ridge Co — Email → Work Order intake poller (B-103, Phase A)
 * ---------------------------------------------------------------------------
 * The ONLY piece of this system that touches Gmail. It stays deliberately dumb:
 * it forwards raw messages to the Worker and applies a label based on the reply.
 * All parsing/business logic lives in worker.js so it is git-versioned and
 * curl-testable (PAT-001).
 *
 * SETUP (one time, ~2 minutes — Google requires user consent, so this cannot be
 * done from code):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties, add:
 *        WORKER_URL   https://staging-maintenance-hub.brett-2f8.workers.dev   (staging first!)
 *        INTAKE_TOKEN <the INTAKE_TOKEN value you set in Cloudflare>
 *   3. Run `testOneEmail` once → approve the OAuth consent screen.
 *   4. Check the log, then Triggers → Add Trigger → pollIntake → Time-driven →
 *      Minutes timer → every 5 minutes.
 *   5. Point WORKER_URL at the production URL only after staging passes.
 *
 * SECURITY: every message is checked for DMARC (or SPF+DKIM) pass before it is
 * forwarded — see checkAuthentication_. The Worker authorizes intake on the
 * sender address, and the From header is forgeable, so this check is what makes
 * that trust meaningful. A message failing it is labelled NeedsReview, never
 * forwarded. If legitimate Buildium mail ever starts getting blocked, check the
 * log for the recorded verdict before relaxing anything.
 *
 * LABELS (two-layer dedupe — the Worker also checks Owner_WO_Ref):
 *   RidgeCo/Processed   → handled; never sent again.
 *   RidgeCo/NeedsReview → parsed but a human must confirm. Excluded from the
 *                         query so it does not re-send every 5 minutes. Remove
 *                         this label to re-run a message after a parser fix.
 *   (no label)          → transport/server error; retried on the next run.
 */

var SENDERS = [
  'donotreply@managebuilding.com',
  'phoenixestatesmaryland@gmail.com'
];

var LABEL_PROCESSED = 'RidgeCo/Processed';
var LABEL_REVIEW    = 'RidgeCo/NeedsReview';
var MAX_PER_RUN     = 25;   // keeps a backlog from blowing the 6-min execution cap

function pollIntake() {
  var props       = PropertiesService.getScriptProperties();
  var workerUrl   = props.getProperty('WORKER_URL');
  var intakeToken = props.getProperty('INTAKE_TOKEN');
  if (!workerUrl || !intakeToken) {
    Logger.log('ERROR: set WORKER_URL and INTAKE_TOKEN in Script Properties first.');
    return;
  }

  var processed = getOrCreateLabel_(LABEL_PROCESSED);
  var review    = getOrCreateLabel_(LABEL_REVIEW);

  var query = '(' + SENDERS.map(function (s) { return 'from:' + s; }).join(' OR ') + ')'
            + ' -label:' + LABEL_PROCESSED.replace('/', '-')
            + ' -label:' + LABEL_REVIEW.replace('/', '-')
            + ' newer_than:30d';

  var threads = GmailApp.search(query, 0, MAX_PER_RUN);
  Logger.log('Query: ' + query);
  Logger.log('Threads found: ' + threads.length);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    var outcome  = null;

    for (var m = 0; m < messages.length; m++) {
      outcome = postMessage_(workerUrl, intakeToken, messages[m]);
      // Any hard failure in a thread → label nothing, retry the whole thread later.
      if (outcome === 'error') break;
    }

    if (outcome === 'error')            Logger.log('  → left unlabeled for retry');
    else if (outcome === 'review')      threads[t].addLabel(review);
    else                                threads[t].addLabel(processed);
  }
}

/**
 * Email authentication check — the intake trust boundary.
 *
 * The Worker decides what to do based on the sender address, and Gmail's
 * `from:` search matches the FROM HEADER, which anyone can forge. Without this,
 * sending mail that merely CLAIMS to be from Buildium drives the whole
 * record-creation pipeline (work orders, properties, units, tenants) with no
 * token at all.
 *
 * Gmail records its verdict in the Authentication-Results header. We require
 * DMARC=pass, which only succeeds when SPF or DKIM aligns with the From domain —
 * exactly the property we need. A message that fails is NOT silently dropped;
 * it's labelled for review so a false negative is visible rather than lost.
 *
 * Returns { pass: bool, detail: string }.
 */
function checkAuthentication_(message) {
  var raw;
  try { raw = message.getRawContent(); }
  catch (e) { return { pass: false, detail: 'could not read raw content: ' + e }; }
  if (!raw) return { pass: false, detail: 'empty raw content' };

  // Only the headers, and only the receiving server's own results.
  var headers = raw.split(/\r?\n\r?\n/)[0] || '';
  var unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  var lines = unfolded.split(/\r?\n/);
  var results = lines.filter(function (l) { return /^Authentication-Results:/i.test(l); }).join(' ').toLowerCase();

  if (!results) return { pass: false, detail: 'no Authentication-Results header' };
  if (/dmarc=pass/.test(results)) return { pass: true, detail: 'dmarc=pass' };
  // Fall back to SPF+DKIM both passing if DMARC wasn't evaluated.
  if (/spf=pass/.test(results) && /dkim=pass/.test(results)) return { pass: true, detail: 'spf+dkim pass' };

  var why = (results.match(/(dmarc|spf|dkim)=(\w+)/g) || []).join(' ') || 'no verdict found';
  return { pass: false, detail: why };
}

/** Returns 'ok' | 'review' | 'error'. */
function postMessage_(workerUrl, intakeToken, message) {
  var auth = checkAuthentication_(message);
  if (!auth.pass) {
    Logger.log('  BLOCKED (failed email auth: ' + auth.detail + '): ' + message.getSubject());
    return 'review';   // labelled NeedsReview — visible, not silently discarded
  }

  var payload = {
    sender:     message.getFrom(),
    subject:    message.getSubject(),
    date:       message.getDate().toISOString(),
    message_id: message.getId(),
    html:       message.getBody(),
    plaintext:  message.getPlainBody()
  };

  try {
    var res = UrlFetchApp.fetch(workerUrl.replace(/\/$/, '') + '/intake', {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'X-Auth-Token': intakeToken },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log('  ' + payload.subject + ' → HTTP ' + code + ' ' + body.substring(0, 300));

    if (code !== 200) return 'error';

    var data = JSON.parse(body);
    if (data.status === 'created' || data.status === 'duplicate' || data.status === 'skipped') return 'ok';
    if (data.status === 'needs_review' || data.status === 'unsupported') return 'review';
    return 'error';
  } catch (e) {
    Logger.log('  EXCEPTION: ' + e);
    return 'error';
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * Dry run: posts the single most recent matching email and logs the Worker's
 * reply WITHOUT applying any label, so you can run it repeatedly while testing.
 */
function testOneEmail() {
  var props   = PropertiesService.getScriptProperties();
  var threads = GmailApp.search('(' + SENDERS.map(function (s) { return 'from:' + s; }).join(' OR ') + ')', 0, 1);
  if (!threads.length) { Logger.log('No matching emails found.'); return; }
  var msgs = threads[0].getMessages();
  Logger.log('Testing: ' + msgs[msgs.length - 1].getSubject());
  Logger.log('Result: ' + postMessage_(
    props.getProperty('WORKER_URL'),
    props.getProperty('INTAKE_TOKEN'),
    msgs[msgs.length - 1]
  ));
}
