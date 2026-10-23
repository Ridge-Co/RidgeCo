// D-16 (Oct 23 2026): cut the Twilio text bill. Runs the REAL code out of worker.js (see _d16-support.mjs) against injected fakes.
//   1 plain characters (sanitizer, piece estimate, Spanish exception)   2 nudges (own number, 3-day cap)   3 (door watchdog: see door-watchdog.test.mjs)
//   4 never send twice (incl. the status write-back failing)            5 real cost logging + balance snapshot   6 Twilio permanent errors + regions
// Every FAULT below is forced and we assert it is reported (ledger), the caller sees it, and the happy path reports nothing.
// Run: node test/sms-cost-d16.test.mjs
import { wsrc, d16Real, d16Deps, d16Queue, D16_BLOCK } from './_d16-support.mjs';
import './_wo-status-global.mjs';

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', n, extra === undefined ? '' : JSON.stringify(extra)); } };
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };
function grab(name) {
  let i = wsrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (wsrc.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = wsrc.indexOf('{', wsrc.indexOf(')', i));
  for (; j < wsrc.length; j++) { if (wsrc[j] === '{') d++; else if (wsrc[j] === '}') { d--; if (!d) break; } }
  return wsrc.slice(i, j + 1);
}
const MIN = 60000, HR = 3600000, DAY = 86400000;
const R = d16Real();

// ========================= 1. PLAIN CHARACTERS =========================
{
  const E = R.smsEstimate;
  eq('estimate: empty = 0 pieces', E('').pieces, 0);
  eq('estimate: 160 plain chars = 1 piece GSM-7', [E('a'.repeat(160)).pieces, E('a'.repeat(160)).encoding], [1, 'GSM-7']);
  eq('estimate: 161 plain chars = 2 pieces (153 each)', E('a'.repeat(161)).pieces, 2);
  eq('estimate: 306 = 2, 307 = 3', [E('a'.repeat(306)).pieces, E('a'.repeat(307)).pieces], [2, 3]);
  eq('estimate: GSM extension characters count 2 each ([ ] { } ^ ~ | \\ euro)', E('[]{}^~|\\€').units, 18);
  eq('estimate: 80 brackets (160 units) = 1 piece, 81 = 2', [E('['.repeat(80)).pieces, E('['.repeat(81)).pieces], [1, 2]);
  eq('estimate: one em dash turns the WHOLE text UCS-2 (70 per piece)', [E('a'.repeat(70) + '—').encoding, E('a'.repeat(70) + '—').pieces], ['UCS-2', 2]);
  eq('estimate: UCS-2 70 chars = 1 piece, 71 = 2, 134 = 2, 135 = 3', [E('—' + 'a'.repeat(69)).pieces, E('—' + 'a'.repeat(70)).pieces, E('—' + 'a'.repeat(133)).pieces, E('—' + 'a'.repeat(134)).pieces], [1, 2, 2, 3]);
  eq('estimate: an emoji counts 2 UTF-16 units', E('😀').units, 2);
  eq('estimate: non-GSM characters are listed', E('a—b…c').non_gsm, ['—', '…']);
  eq('estimate: e-acute and n-tilde are GSM-7 (a name like Jose with an accent stays cheap)', [E('José Peña').encoding, E('José Peña').units], ['GSM-7', 9]);
  eq('estimate: a-acute is NOT in GSM-7', E('está').encoding, 'UCS-2');
}
{
  const S = (s, o) => R.smsSanitize(s, o);
  const cases = [
    ['em dash', 'a — b', 'a - b'], ['en dash', 'a – b', 'a - b'], ['minus sign', '5 − 3', '5 - 3'], ['non-breaking hyphen', 'x‑y', 'x-y'],
    ['curly single quotes', 'it’s ‘ok’', "it's 'ok'"], ['curly double quotes', '“hi”', '"hi"'], ['low double quote', '„hi”', '"hi"'],
    ['ellipsis character', 'wait…', 'wait...'], ['non-breaking space', 'a b', 'a b'], ['narrow nbsp + thin space', 'a b c', 'a b c'], ['ideographic space', 'a　b', 'a b'],
    ['bullet', '• one', '- one'], ['middle dot', 'a · b', 'a - b'], ['multiplication sign', '2×4', '2x4'], ['degree', '70°', '70deg'], ['trademark', 'Foo™', 'FooTM'],
    ['one half', '½ day', '1/2 day'], ['arrow', 'a → b', 'a -> b'], ['check mark emoji dropped', '✅ done', 'done'], ['cross mark dropped', '❌ no', 'no'],
    ['warning sign + variation selector', '⚠️ care', 'WARNING: care'], ['red circle', '🔴 now', 'ALERT: now'], ['smiley dropped', 'ok 😀', 'ok'],
    ['zero width space', 'a​b', 'ab'], ['soft hyphen', 'co­op', 'coop'], ['accent a-acute', 'está', 'esta'], ['accent i-acute (e-acute stays)', 'qué día', 'qué dia'], ['i-acute, u-acute', 'tú aquí', 'tu aqui'],
    ['e-acute stays (GSM-7)', 'café', 'café'], ['n-tilde stays (GSM-7)', 'niño', 'niño'], ['plain text untouched', 'Hi Sam, WO-1231 is done. Ref: WO-1231.', 'Hi Sam, WO-1231 is done. Ref: WO-1231.'],
  ];
  for (const [name, input, want] of cases) eq('sanitize: ' + name, S(input).text, want);
  const big = S('Hi Sam, checking in on WO-1231 — Plumbing job (Fix the leak…) at 12 Main St. We’ll “see” you • soon…');
  t('sanitize: result is pure GSM-7 and changed is reported', big.after.encoding === 'GSM-7' && big.changed === true && big.before.encoding === 'UCS-2', big);
  t('sanitize: pieces drop (before > after)', big.before.pieces >= big.after.pieces, big);
  eq('sanitize: idempotent', S(big.text).text, big.text);
  eq('sanitize: unchanged text reports changed:false', S('plain text').changed, false);
  eq('sanitize: no-op on null/undefined', [S(null).text, S(undefined).text], ['', '']);
  const zh = S('Hello 你好');
  t('sanitize: a character with no safe plain form is LEFT (never silently deleted) and listed', zh.text === 'Hello 你好' && zh.unmapped.join() === '你,好', zh);
  eq('sanitize: a run of spaces collapses', S('a   b').text, 'a b');
  // Spanish exception: accents kept, dashes/quotes/ellipsis still plain
  const es = S('Hola — ¿puedes confirmar el trabajo en “Peñalosa”… está listo? ’gracias’', { keepAccents: true });
  eq('Spanish: accents kept, dash/quotes/ellipsis normalised', es.text, 'Hola - ¿puedes confirmar el trabajo en "Peñalosa"... está listo? \'gracias\'');
  t('Spanish: still UCS-2 only because of the accent (a-acute), no other offenders', es.unmapped.length === 0 && es.after.non_gsm.join() === 'á', es);
  eq('Spanish: plain Spanish with only GSM accents (e, n, u-umlaut, i-grave) stays GSM-7', R.smsEstimate(S('Hola, mañana vendré. Gracias', { keepAccents: true }).text).encoding, 'GSM-7');
  eq('Spanish: without keepAccents the accents ARE flattened', S('está').text, 'esta');
}
{
  // shorter templates: the five biggest, rendered with realistic data
  const M = new Function(grab('smsShort') + '\n' + grab('woJobLabel') + '\n' + grab('renderTemplate') + '\n' + grab('vendorPortalLink') + '\n' + grab('withTenantStopNote') + '\nconst TENANT_STOP_NOTE = ' + JSON.stringify((wsrc.match(/const TENANT_STOP_NOTE = (".*?");/) || [])[1] ? JSON.parse(wsrc.match(/const TENANT_STOP_NOTE = (".*?");/)[1]) : '') + ';\nreturn { smsShort, woJobLabel, renderTemplate, vendorPortalLink, withTenantStopNote };')();
  const tplBlock = wsrc.slice(wsrc.indexOf('const DEFAULT_MESSAGE_TEMPLATES = ['), wsrc.indexOf('\n];', wsrc.indexOf('const DEFAULT_MESSAGE_TEMPLATES = [')) + 3);
  const TPL = new Function(tplBlock + '\nreturn DEFAULT_MESSAGE_TEMPLATES;')();
  const tpl = n => TPL.find(x => x.Message_Type === n && x.Channel === 'sms').Body;
  const wo = { Trade: 'Plumbing', Description: 'Kitchen sink is leaking under the cabinet and water is pooling on the floor near the dishwasher' };
  const addr = '1714 Highland Ave Unit 2B';
  const nudge = `Hi Christopher, checking in on WO-1231: ${M.woJobLabel(wo)} at ${addr}. Please add the schedule in your portal, mark it Complete when done, then submit your invoice. ${M.vendorPortalLink('WO-1231')}`;
  const vp = R.smsEstimate(nudge);
  t('template: vendor nudge is 2 pieces or fewer and plain GSM-7 (was about 6)', vp.pieces <= 2 && vp.encoding === 'GSM-7', vp);
  t('template: vendor nudge keeps the portal link and the three asks', /vendor\.html\?wo=WO-1231/.test(nudge) && /schedule/.test(nudge) && /Complete/.test(nudge) && /invoice/.test(nudge));
  const welcome = M.withTenantStopNote(M.renderTemplate(tpl('tenant_welcome'), { FirstName: 'Dana', AssistantName: 'Riley', Owner: 'Pat Moore', Address: addr }));
  const wp = R.smsEstimate(welcome);
  t('template: tenant welcome (with the STOP note) is 2 pieces or fewer, plain (was 3)', wp.pieces <= 2 && wp.encoding === 'GSM-7', wp);
  t('template: tenant welcome keeps the STOP opt-out line and the ask to save the number', /Reply STOP/.test(welcome) && /save this number/i.test(welcome));
  const notice = M.renderTemplate(tpl('property_notice'), { AssistantName: 'Riley', Owner: 'Pat Moore', Address: addr }).replace('[describe the issue here]', 'Water will be shut off tomorrow 9am-11am for a repair.');
  const np = R.smsEstimate(notice);
  t('template: property notice shell + a typical 1-line notice is 2 pieces or fewer, plain (was 4)', np.pieces <= 2 && np.encoding === 'GSM-7', np);
  const ownerLine = `Hi Pat, new Plumbing request from your tenant at ${addr}: ${M.smsShort(wo.Description, 80)}. We'll update you once it's scheduled. Ref: WO-1231.`;
  const op = R.smsEstimate(ownerLine);
  t('template: owner "request received" text is 2 pieces or fewer, plain (was 3-4)', op.pieces <= 2 && op.encoding === 'GSM-7', op);
  const ownerHold = `Hi Pat, WO-1231 (${M.woJobLabel(wo)}) at ${addr} is on hold: ${M.smsShort('Waiting on a part from the supplier, expected next Tuesday afternoon, will reschedule then', 80)}.`;
  t('template: owner on-hold text is 2 pieces or fewer, plain', R.smsEstimate(ownerHold).pieces <= 2 && R.smsEstimate(ownerHold).encoding === 'GSM-7', R.smsEstimate(ownerHold));
  eq('smsShort: cuts to n chars with a plain "..."', M.smsShort('a'.repeat(100), 10), 'aaaaaaaaaa...');
  eq('smsShort: first line only', M.smsShort('one\ntwo', 50), 'one');
  eq('smsShort: short text unchanged / null safe', [M.smsShort('hi', 50), M.smsShort(null, 5)], ['hi', '']);
  t('templates: no default SMS template contains a non-GSM-7 character', TPL.filter(x => x.Channel === 'sms').every(x => R.smsEstimate(x.Body.replace(/\{\w+\}/g, 'x')).encoding === 'GSM-7'), TPL.filter(x => x.Channel === 'sms' && R.smsEstimate(x.Body.replace(/\{\w+\}/g, 'x')).encoding !== 'GSM-7').map(x => x.Message_Type));
}

// ========================= 6. DESTINATIONS + TWILIO ERRORS (pure) =========================
{
  const D = R.smsDestinationCheck;
  for (const [p, ok] of [['+14105550100', true], ['+17875550100', true], ['+13405550100', true], ['+16135550100', true], ['+12125550100', true]]) t('region: ' + p + ' (US / PR / USVI / Canada) allowed', D(p).ok === ok);
  for (const [p, why] of [['+989121234567', /not a \+1/], ['+5352123456', /not a \+1/], ['+963944123456', /not a \+1/], ['+442071234567', /not a \+1/], ['+18765550100', /another Caribbean country/], ['+12425550100', /another Caribbean country/], ['+1410555', /10-digit/], ['', /not a \+1/]]) {
    const d = D(p); t('region: ' + (p || '(blank)') + ' refused', d.ok === false && why.test(d.reason), d);
  }
  eq('region: only the last 4 digits are exposed', D('+989121234567').last4, '4567');
  const E = R.smsErrorInfo;
  for (const code of [21408, 21211, 21614, 21610, 21612, 30003, 30005, 30006]) t('error ' + code + ' is permanent with a plain reason', E({ code }).permanent === true && E({ code }).reason.length > 5);
  t('error 30007 (carrier filtered) and 20429 (rate limit) are NOT permanent', E({ code: 30007 }).permanent === false && E({ code: 20429 }).permanent === false);
  t('error info: string code parsed; none = 0', E({ code: '21211' }).code === 21211 && E({ sid: 'SM1' }).code === 0 && E(null).code === 0);
  const O = R.smsSendOutcome;
  eq('outcome: sid = sent', [O({ sid: 'SM1' }).sent, O({ sid: 'SM1' }).status, O({ sid: 'SM1' }).sid], [true, 'sent', 'SM1']);
  const bad = O({ code: 21211, message: 'Invalid To' });
  t('outcome: permanent Twilio error = failed + code + plain reason + permanent flag', !bad.sent && bad.status === 'failed' && bad.errorCode === '21211' && bad.permanent === true && /not a valid phone number/.test(bad.reason) && /will not be retried/.test(bad.reason), bad);
  t('outcome: duplicate skip = skipped, not failed', O({ skipped: true, duplicate: true, reason: 'x' }).status === 'skipped' && O({ skipped: true, duplicate: true }).duplicate === true);
  t('outcome: region block = failed with blocked_region', O({ skipped: true, region_blocked: true, reason: 'text not sent: destination outside enabled regions (x)' }).errorCode === 'blocked_region' && O({ region_blocked: true }).regionBlocked === true);
  t('outcome: network-style error keeps its message, no code', O({ error: 'no answer' }).reason === 'no answer' && O({ error: 'no answer' }).errorCode === '');
}

// ========================= pure guards (duplicate / nudge / known-bad / own number) =========================
{
  const P = '+14105550111', NOW = Date.parse('2026-10-23T15:00:00Z');
  const row = (o) => Object.assign({ ID: '1', WO_ID: 'WO-1', Message_Type: 'vendor_nudge_status', Recipient_Phone: P, Message_Body: 'hello', Status: 'sent', Created_Date: new Date(NOW - 2 * MIN).toISOString(), Sent_Date: new Date(NOW - 2 * MIN).toISOString(), Active: 'TRUE' }, o || {});
  const F = (rows, o) => R.mqFindDuplicate(rows, Object.assign({ phone: P, body: 'hello', nowMs: NOW }, o || {}));
  t('dup: same text, sent 2 min ago -> duplicate', F([row()]) && F([row()]).status === 'sent');
  t('dup: status "sending" counts (write-back failed case)', F([row({ Status: 'sending', Sent_Date: '' })]) && F([row({ Status: 'sending', Sent_Date: '' })]).status === 'sending');
  t('dup: sent 11 min ago -> NOT a duplicate (10-minute window)', F([row({ Sent_Date: new Date(NOW - 11 * MIN).toISOString(), Created_Date: new Date(NOW - 11 * MIN).toISOString() })]) === null);
  t('dup: different body / other number / failed / skipped -> not duplicates', F([row({ Message_Body: 'other' })]) === null && F([row({ Recipient_Phone: '+14105550999' })]) === null && F([row({ Status: 'failed' })]) === null && F([row({ Status: 'skipped' })]) === null);
  t('dup: an inactive row is ignored', F([row({ Active: 'FALSE' })]) === null);
  t('dup: held for quiet hours counts at any age', F([row({ Status: 'pending', Send_After: new Date(NOW + HR).toISOString(), Created_Date: new Date(NOW - 3 * DAY).toISOString(), Sent_Date: '' })]).status === 'held');
  t('dup: own row is ignored (selfRow = sheet row 2)', F([row()], { selfRow: 2 }) === null);
  t('dup: earlierThanRow - a later row never counts (the earlier racer wins)', F([row(), row({ ID: '2' })], { selfRow: 2, earlierThanRow: 2 }) === null && F([row(), row({ ID: '2' })], { selfRow: 3, earlierThanRow: 3 }) !== null);
  const NF = (rows, o) => R.mqFindRecentNudge(rows, Object.assign({ family: 'vendor_nudge_', woId: 'WO-1', phone: P, gapMs: 72 * HR, nowMs: NOW }, o || {}));
  t('nudge cap: a nudge sent 2 days ago blocks', NF([row({ Sent_Date: new Date(NOW - 2 * DAY).toISOString() })]) !== null);
  t('nudge cap: a nudge sent 71h ago blocks, 73h ago does not', NF([row({ Sent_Date: new Date(NOW - 71 * HR).toISOString() })]) !== null && NF([row({ Sent_Date: new Date(NOW - 73 * HR).toISOString() })]) === null);
  t('nudge cap: a different work order / other person / other message family does not block', NF([row({ WO_ID: 'WO-2' })]) === null && NF([row({ Recipient_Phone: '+14105550999' })]) === null && NF([row({ Message_Type: 'vendor_job_assigned' })]) === null);
  t('nudge cap: a failed or skipped earlier nudge does not block', NF([row({ Status: 'failed' })]) === null && NF([row({ Status: 'skipped' })]) === null);
  t('nudge cap: photo / invoice nudges are in the same family', NF([row({ Message_Type: 'vendor_nudge_invoice' })]) !== null);
  const KB = (rows) => R.mqFindKnownBad(rows, { phone: P, nowMs: NOW, windowMs: 30 * DAY });
  t('known bad: a permanent failure (21211) in the last 30 days blocks', KB([row({ Status: 'failed', Error_Code: '21211' })]) !== null);
  t('known bad: region (21408) and opt-out (21610) failures are never remembered', KB([row({ Status: 'failed', Error_Code: '21408' })]) === null && KB([row({ Status: 'failed', Error_Code: '21610' })]) === null);
  t('known bad: ONLY invalid-number codes block - 21614 blocks; temporary 30003 / 30005 / 30006 / 21612 never do', KB([row({ Status: 'failed', Error_Code: '21614' })]) !== null && [30003, 30005, 30006, 21612].every(c => KB([row({ Status: 'failed', Error_Code: String(c) })]) === null));
  t('known bad: a non-permanent failure / an old one / another number does not block', KB([row({ Status: 'failed', Error_Code: '30007' })]) === null && KB([row({ Status: 'failed', Error_Code: '21211', Created_Date: new Date(NOW - 40 * DAY).toISOString() })]) === null && KB([row({ Status: 'failed', Error_Code: '21211', Recipient_Phone: '+14105550999' })]) === null);
  const own = R.smsIsOwnNumber;
  t('own number: the admin phone', own('410-555-0100', { admin_phone: '(410) 555-0100' }, null) === true);
  t('own number: an In_House vendor', own('+14105550111', { admin_phone: '+14105550100' }, { In_House: 'TRUE' }) === true);
  t('own number: anyone else', own('+14105550111', { admin_phone: '+14105550100' }, { In_House: 'FALSE' }) === false && own('', {}, null) === false);
  const stuck = R.mqRowsToObjects ? null : null; void stuck;
  const Q = d16Queue({ updateMessageQueueRow: async () => true, sendSMSRaw: async () => ({ sid: 'x' }) });
  t('stuck sending: 20 min old is reported, 5 min and 50 min are not, other statuses are not', Q.mqStuckSending([row({ Status: 'sending', Sent_Date: new Date(NOW - 20 * MIN).toISOString() }), row({ ID: '2', Status: 'sending', Sent_Date: new Date(NOW - 5 * MIN).toISOString() }), row({ ID: '3', Status: 'sending', Sent_Date: new Date(NOW - 50 * MIN).toISOString() }), row({ ID: '4', Status: 'sent' })], NOW).map(r => r.ID).join() === '1');
}

// ========================= sendSMSRaw (the one transport) =========================
function transport(opts) {
  opts = opts || {};
  const calls = { fetch: [], rows: [], reports: [] };
  const HEADERS = ['ID', 'WO_ID', 'Recipient_Type', 'Recipient_ID', 'Phone', 'Message', 'Sent_Date', 'Status', 'Twilio_SID', 'Segments', 'Est_Segments', 'Encoding', 'Chars', 'Price', 'Price_Unit', 'Message_Type', 'Queue_ID', 'Log_Source', 'Error_Code', 'Note'];
  let answers = (opts.answers || [{ sid: 'SM1', num_segments: '1' }]).slice();
  const world = {
    fetch: async (url, init) => {
      calls.fetch.push({ url, body: new URLSearchParams(init.body).get('Body'), to: new URLSearchParams(init.body).get('To') });
      if (opts.fetchThrows) throw new Error('socket hang up');
      const a = answers.length > 1 ? answers.shift() : answers[0];
      return { ok: !a.code, status: a.code ? 400 : 201, json: async () => a };
    },
    sheetsRequest: async (env, method, path, body) => {
      if (opts.logFails) throw new Error('Sheets 429');
      if (method === 'GET') return { values: [HEADERS] };
      calls.rows.push(Object.fromEntries(HEADERS.map((h, i) => [h, body.values[0][i]]))); return { updates: { updatedRange: 'SMS_Logs!A9' } };
    },
    isStaging: () => !!opts.staging,
  };
  const r = d16Real(world);
  const origReport = r.rec.reports;
  calls.reports = origReport;
  const env = Object.assign({ TWILIO_SID: 'AC1', TWILIO_API_SID: 'SK1', TWILIO_API_KEY: 'k', TWILIO_FROM: '+14105550000' }, opts.env || {});
  return { send: (to, msg, o) => r.sendSMSRaw(env, to, msg, o), calls, r };
}
{
  const T = transport({ answers: [{ sid: 'SM1', num_segments: '1', price: '-0.0079', price_unit: 'USD' }] });
  const res = await T.send('4105550111', 'Hi Sam — it’s ready… “ok” ✅', { context: { wo_id: 'WO-9', message_type: 'tenant_job_completed', recipient_type: 'tenant', queue_id: '77' } });
  eq('transport: the body that reaches Twilio is plain', T.calls.fetch[0].body, 'Hi Sam - it\'s ready... "ok"');
  t('transport: success returns the sid', res.sid === 'SM1');
  const row = T.calls.rows[0];
  t('transport: one SMS_Logs row with Segments, Est_Segments, Encoding, Price, Message_Type, Queue_ID, Status sent', row && row.Status === 'sent' && row.Segments === '1' && row.Est_Segments === '1' && row.Encoding === 'GSM-7' && row.Price === '-0.0079' && row.Price_Unit === 'USD' && row.Message_Type === 'tenant_job_completed' && row.Queue_ID === '77' && row.WO_ID === 'WO-9' && row.Log_Source === 'transport', row);
  t('happy path reports nothing to the failure ledger', T.calls.reports.length === 0);
}
{
  const T = transport({ answers: [{ sid: 'SM2', num_segments: '3' }] });
  await T.send('4105550111', 'a'.repeat(120));
  t('transport: when Twilio bills more pieces than we estimated, the row says so', /Twilio billed 3 piece\(s\), we estimated 1/.test(T.calls.rows[0].Note) && T.calls.rows[0].Segments === '3');
}
{
  // double-send guard in the transport
  const T = transport();
  const a = await T.send('4105550111', 'WO-1231 is complete', { context: { message_type: 'tenant_job_completed' } });
  const b = await T.send('4105550111', 'WO-1231 is complete', { context: { message_type: 'tenant_job_completed' } });
  t('double send: the second identical text 2 seconds later is NOT sent', a.sid === 'SM1' && b.skipped === true && b.duplicate === true && T.calls.fetch.length === 1, b);
  t('double send: the suppression is logged (Status suppressed_duplicate)', T.calls.rows.some(r => r.Status === 'suppressed_duplicate' && /10-minute guard/.test(r.Note)), T.calls.rows);
  const c = await T.send('4105550111', 'WO-1231 is complete', { allowRepeat: true });
  t('double send: allowRepeat (a deliberate resend) goes through', c.sid === 'SM1' && T.calls.fetch.length === 2);
  const d = await T.send('4105550111', 'a different text');
  const e = await T.send('4105550222', 'WO-1231 is complete');
  t('double send: a different body or a different number is not blocked', d.sid && e.sid && T.calls.fetch.length === 4);
}
{
  // a refused/failed send frees the guard so a corrected resend is allowed
  const T = transport({ answers: [{ code: 21211, message: 'Invalid To' }, { sid: 'SM3', num_segments: '1' }] });
  const a = await T.send('4105550111', 'hello there');
  const b = await T.send('4105550111', 'hello there');
  t('a Twilio refusal does not poison the guard: the retry is sent', !a.sid && b.sid === 'SM3' && T.calls.fetch.length === 2);
  const row = T.calls.rows[0];
  t('Twilio error code is stored on the SMS_Logs row with a plain reason', row.Status === 'failed' && row.Error_Code === '21211' && /not a valid phone number/.test(row.Note), row);
}
{
  const T = transport({ fetchThrows: true });
  let threw = null; try { await T.send('4105550111', 'hi'); } catch (e) { threw = e; }
  t('FAULT no answer from Twilio: the error propagates to the caller (not swallowed)', threw && /socket hang up/.test(threw.message));
  t('...and it is logged as failed, and the guard is freed', T.calls.rows.some(r => r.Status === 'failed' && /socket hang up/.test(r.Note)));
  T.calls.fetch.length = 0;
  let threw2 = null; try { await T.send('4105550111', 'hi'); } catch (e) { threw2 = e; }
  t('...so a retry actually calls Twilio again', T.calls.fetch.length === 1 && threw2);
}
{
  // region
  const T = transport();
  const res = await T.send('+989121234567', 'Hello', { context: { queue_id: '' } });
  t('region: +98 is not sent (no call to Twilio)', T.calls.fetch.length === 0 && res.skipped === true && res.region_blocked === true && /destination outside enabled regions/.test(res.reason), res);
  const rep = T.calls.reports;
  t('region: ONE calm P2 ledger row, with the last 4 digits only', rep.length === 1 && rep[0].severity === 'P2' && rep[0].where === 'sms_destination_region' && /text not sent: destination outside enabled regions/.test(rep[0].message) && /ending 4567/.test(rep[0].message) && !/989121234567/.test(JSON.stringify(rep)), rep);
  t('region: the SMS_Logs row hides the number (***4567) and says blocked_region', T.calls.rows[0].Phone === '***4567' && T.calls.rows[0].Status === 'blocked_region' && !/989121234567/.test(JSON.stringify(T.calls.rows)), T.calls.rows);
  const pr = await T.send('7875550100', 'Hola');
  t('region: a Puerto Rico number (+1 787) is sent', pr.sid === 'SM1' && T.calls.fetch.length === 1);
  const cu = await T.send('+5352123456', 'Hola');
  t('region: Cuba (+53) and Syria (+963) are refused too', cu.region_blocked === true && (await T.send('+963944123456', 'x')).region_blocked === true && T.calls.fetch.length === 1);
}
{
  // a queue-backed region refusal is reported by the caller with its row id, not twice
  const T = transport();
  await T.send('+989121234567', 'Hello', { context: { queue_id: '363' } });
  t('region: with a queue id the transport leaves the ledger row to smsGatedSend (no double report)', T.calls.reports.length === 0 && T.calls.rows.length === 1);
}
{
  const T = transport();
  await T.send('4105550111', 'Your PIN is 482913', { context: { message_type: 'pin_send_tenant' } });
  t('PIN text: the SMS_Logs row never holds the PIN', !/482913/.test(JSON.stringify(T.calls.rows)) && /contains a login PIN/.test(T.calls.rows[0].Message));
  const T2 = transport(); await T2.send('4105550111', 'code 7777', { redact: true });
  t('opts.redact does the same', !/7777/.test(JSON.stringify(T2.calls.rows)));
}
{
  const T = transport({ staging: true });
  const res = await T.send('4105550111', 'hi — there');
  t('staging: stubbed, no Twilio call, logged as staged with our own estimate', res.staged === true && T.calls.fetch.length === 0 && T.calls.rows[0].Status === 'staged' && res.segments_est === 1, res);
}
{
  const T = transport({ env: { TWILIO_API_KEY: '' } });
  const a = await T.send('4105550111', 'hi');
  t('FAULT Twilio not configured: an error is returned (not "sent"), and a later send is not blocked by the guard', /not configured/.test(a.error) && T.calls.fetch.length === 0);
}
{
  const T = transport({ logFails: true });
  const res = await T.send('4105550111', 'hello');
  t('FAULT the SMS_Logs write fails: the text STILL goes out, and the failure is reported (P1 sms_log_write)', res.sid === 'SM1' && T.calls.reports.some(r => r.where === 'sms_log_write' && r.severity === 'P1' && /429/.test(r.message)), T.calls.reports);
}

// ========================= smsGatedSend: nudges, double send, errors, regions =========================
const QCOLS = new Function(wsrc.slice(wsrc.indexOf('const MSG_QUEUE_COLS'), wsrc.indexOf(';', wsrc.indexOf('const MSG_QUEUE_COLS')) + 1) + '\nreturn MSG_QUEUE_COLS;')();
t('Message_Queue has Error_Code and Error_Reason at the END of its columns', QCOLS.slice(-2).join() === 'Error_Code,Error_Reason', QCOLS.slice(-3));
function gate(o) {
  o = o || {};
  const st = { grid: [QCOLS.slice()], raw: [], updates: [], reports: [], logs: [], mqFailures: [], now: o.now || Date.now() };
  const d16 = d16Deps();
  const deps = {
    ensureSmsInfra: async () => {},
    fetchConfig: async () => Object.assign({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE', admin_phone: '+14105550100' }, o.cfg || {}),
    normalizePhone: new Function(grab('normalizePhone') + '\nreturn normalizePhone;')(), tenantMovedOut: new Function(grab('tenantMovedOut') + '\nreturn tenantMovedOut;')(),
    sheetsRequest: async (e, method, path, body) => {
      if (method === 'GET') return { values: st.grid.map(r => r.slice()) };
      st.grid.push(body.values[0].slice()); return { updates: { updatedRange: 'Message_Queue!A' + st.grid.length } };
    },
    nextSafeId: rows => String(rows.length), appendedRowNumber: r => parseInt(String(r.updates.updatedRange).replace(/\D/g, ''), 10),
    guardAppendedIds: async (e, t2, ap, n, idc, ids) => ({ ids: ids.map(String), row: parseInt(String(ap.updates.updatedRange).replace(/\D/g, ''), 10), repaired: false }),
    mqReportFailure: async (e, id, m) => { st.mqFailures.push({ id, m }); },
    isQuietHoursNow: () => !!o.quiet, nextQuietHoursEnd: () => new Date('2026-10-24T13:00:00Z'), etHour: () => 12, quietHoldUntil: () => null,
    updateMessageQueueRow: async (e, id, f) => {
      st.updates.push({ id, f });
      if (o.statusWriteFails && f.Status && f.Status !== 'sending') return false;
      const i = st.grid.findIndex((r, ix) => ix > 0 && r[0] === String(id));
      if (i > 0) for (const k of Object.keys(f)) { const c = QCOLS.indexOf(k); if (c >= 0) st.grid[i][c] = f[k]; }
      return true;
    },
    sendSMSRaw: async (e, to, msg, opts) => {
      st.raw.push({ to, msg, opts });
      const a = (o.sendAnswers || [{ sid: 'SM' + (st.raw.length) }]); return a[Math.min(st.raw.length - 1, a.length - 1)];
    },
    logMessageAudit: async () => { if (o.auditFails) throw new Error('WO_Audit write 500'); },
    smsGateDecision: new Function(grab('smsGateDecision') + '\nreturn smsGateDecision;')(),
    smsToggleOn: v => String(v == null ? '' : v).toUpperCase() !== 'FALSE',
    translateForVendorDetailed: async () => ({ translated: false }),
    MSG_QUEUE_TAB: 'Message_Queue', MSG_QUEUE_COLS: QCOLS,
  };
  Object.assign(deps, d16, {
    smsLogRecord: async (e, r) => { st.logs.push(r); return { ok: true }; },
    reportFailure: async (e, r) => { st.reports.push(r); },
    smsReportRegionBlocked: async (e, rowId, check) => { st.reports.push({ where: 'sms_destination_region', severity: 'P2', ref: 'Message_Queue ' + rowId, message: 'text not sent: destination outside enabled regions (Message_Queue row ' + rowId + ', number ending ' + check.last4 + ')' }); },
  });
  delete deps.__rec;
  const names = Object.keys(deps);
  const send = new Function(...names, grab('smsGatedSend') + '\nreturn smsGatedSend;')(...names.map(k => deps[k]));
  const mq = () => st.grid.slice(1).map(r => Object.fromEntries(QCOLS.map((c, i) => [c, r[i]])));
  return { send: (opts) => send({}, opts), st, mq, deps };
}
const vendor = { ID: '19', Name: 'Regina Saville', Phone: '5403364284', Language: 'en', In_House: 'FALSE' };
const nudge = (extra) => Object.assign({ wo_id: 'WO-1231', message_type: 'vendor_nudge_status', recipient_type: 'vendor', vendor, message_body: 'Hi Regina, checking in on WO-1231.' }, extra || {});
{
  // happy path: row born "sending", then "sent"
  const G = gate();
  const r = await G.send(nudge());
  t('gated happy: sent, one Twilio call, nothing reported', r.sent === true && G.st.raw.length === 1 && G.st.reports.length === 0 && !('warning' in r), r);
  const row = G.mq()[0];
  t('gated happy: the queue row was written as "sending" (durable marker BEFORE the send) and ends "sent" with the SID', G.st.updates.length === 1 && G.st.updates[0].f.Status === 'sent' && row.Status === 'sent' && row.Twilio_Message_SID === 'SM1' && G.st.grid[1][QCOLS.indexOf('Status')] === 'sent', G.st.updates);
  const born = (() => { const g = gate(); return g; })(); void born;
}
{
  // a row that is born "sending": capture the first appended value
  const G = gate(); let firstStatus = null;
  const origReq = G.deps.sheetsRequest;
  const g2 = gate({}); const orig = g2.st.grid.push.bind(g2.st.grid); g2.st.grid.push = (row) => { if (firstStatus === null) firstStatus = row[QCOLS.indexOf('Status')]; return orig(row); };
  await g2.send(nudge());
  t('gated: the appended row has Status "sending" (not "pending")', firstStatus === 'sending', firstStatus); void origReq;
}
{
  // -- item 4: the status write-back fails (Sheets quota) -> the same text must NOT go out again --
  const G = gate({ statusWriteFails: true });
  const a = await G.send({ wo_id: 'WO-1231', message_type: 'tenant_job_completed', recipient_type: 'tenant', tenant: { ID: '5', Phone: '4105550111', First_Name: 'Dana' }, message_body: 'Hi Dana, your Plumbing job is complete. Ref: WO-1231.' });
  t('FAULT status write-back fails: the text WAS sent once and the caller is told (warning)', a.sent === true && /WAS sent/.test(a.warning) && /sending/.test(a.warning), a);
  t('...the queue row is left "sending", never "pending"', G.mq()[0].Status === 'sending');
  const b = await G.send({ wo_id: 'WO-1231', message_type: 'tenant_job_completed', recipient_type: 'tenant', tenant: { ID: '5', Phone: '4105550111', First_Name: 'Dana' }, message_body: 'Hi Dana, your Plumbing job is complete. Ref: WO-1231.' });
  t('...so the SAME text a moment later (retry / double tap / second isolate) is suppressed: only ONE Twilio call in total', b.sent === false && b.suppressed === true && b.duplicate_suppressed === true && G.st.raw.length === 1, b);
  t('...no second queue row was written', G.mq().length === 1);
  t('...the suppression is logged to SMS_Logs with the reason', G.st.logs.some(l => l.Status === 'suppressed_duplicate' && /sending/.test(l.Note) && l.Message_Type === 'tenant_job_completed'), G.st.logs);
}
{
  // two WO texts 2 seconds apart (WO-1231 / WO-1248 evidence): second identical call is suppressed; a different WO text is not
  const G = gate();
  const base = { message_type: 'owner_job_complete', recipient_type: 'owner', owner: { ID: '3', Phone: '4105550142', First_Name: 'Pat' }, property: { ID: '50' } };
  const a = await G.send(Object.assign({ wo_id: 'WO-1248', message_body: 'Hi Pat, WO-1248 (Roofing job) at 1 Main St is complete.' }, base));
  const b = await G.send(Object.assign({ wo_id: 'WO-1248', message_body: 'Hi Pat, WO-1248 (Roofing job) at 1 Main St is complete.' }, base));
  const c = await G.send(Object.assign({ wo_id: 'WO-1249', message_body: 'Hi Pat, WO-1249 (Roofing job) at 1 Main St is complete.' }, base));
  t('same text twice in a row: one send; a different WO text still goes', a.sent && !b.sent && b.duplicate_suppressed && c.sent && G.st.raw.length === 2, [a.sent, b.sent, c.sent]);
}
{
  // window: a copy older than 10 minutes is not a duplicate
  const G = gate();
  await G.send(nudge({ message_type: 'tenant_manual' , recipient_type: 'vendor' }));
  const i = G.st.grid.length - 1; const old = new Date(Date.now() - 11 * MIN).toISOString();
  G.st.grid[i][QCOLS.indexOf('Created_Date')] = old; G.st.grid[i][QCOLS.indexOf('Sent_Date')] = old;
  const r = await G.send(nudge({ message_type: 'tenant_manual' }));
  t('a copy sent 11 minutes ago is NOT a duplicate (window is 10 minutes)', r.sent === true && G.st.raw.length === 2, r);
}
{
  // quiet hours: the held row is a duplicate guard too (not re-queued twice)
  const G = gate({ quiet: true });
  const a = await G.send(nudge());
  const b = await G.send(nudge());
  t('a text held for quiet hours is not queued twice', a.held_for_quiet_hours === true && b.suppressed === true && G.mq().length === 1 && G.st.raw.length === 0, [a, b]);
}
{
  // -- item 2: nudges --
  const G = gate({ cfg: { admin_phone: '+15403364284' } });   // the vendor's phone IS the admin phone
  const r = await G.send(nudge());
  t('nudge to the admin\'s own number: not sent, no queue row, no Twilio call', r.sent === false && r.suppress_reason === 'own_number' && G.st.raw.length === 0 && G.mq().length === 0, r);
  t('...and the suppression is logged (Status suppressed_own_number) without printing the number in the note', G.st.logs.some(l => l.Status === 'suppressed_own_number' && !/5403364284/.test(l.Note)), G.st.logs);
  const G2 = gate();
  const r2 = await G2.send(nudge({ vendor: Object.assign({}, vendor, { In_House: 'TRUE' }) }));
  t('nudge to an In_House vendor: not sent', r2.suppress_reason === 'own_number' && G2.st.raw.length === 0);
  const r3 = await G2.send(nudge({ message_type: 'vendor_job_assigned', vendor: Object.assign({}, vendor, { In_House: 'TRUE' }), message_body: 'New job WO-1.' }));
  t('a NON-nudge text (job assignment) to an In_House vendor is NOT blocked', r3.sent === true && G2.st.raw.length === 1);
}
{
  const G = gate();
  const r1 = await G.send(nudge());
  t('first nudge goes', r1.sent === true);
  // make that row 2 days old
  const age = (ms) => { const iso = new Date(Date.now() - ms).toISOString(); const i = G.st.grid.length - 1; G.st.grid[i][QCOLS.indexOf('Created_Date')] = iso; G.st.grid[i][QCOLS.indexOf('Sent_Date')] = iso; };
  age(2 * DAY);
  const r2 = await G.send(nudge({ message_body: 'Hi Regina, a different nudge on WO-1231.' }));
  t('a second nudge 2 days later, same person, same WO: suppressed (3-day cap)', r2.sent === false && r2.suppress_reason === 'nudge_cap' && !!r2.next_allowed_at && G.st.raw.length === 1, r2);
  t('...next_allowed_at is 3 days after the first nudge', Math.abs(Date.parse(r2.next_allowed_at) - (Date.now() - 2 * DAY + 72 * HR)) < 60000, r2.next_allowed_at);
  t('...and the suppression is logged', G.st.logs.some(l => l.Status === 'suppressed_nudge_cap' && l.WO_ID === 'WO-1231'));
  const r3 = await G.send(nudge({ wo_id: 'WO-9999', message_body: 'Hi Regina, checking in on WO-9999.' }));
  t('a nudge about a DIFFERENT work order is not capped', r3.sent === true);
  age(73 * HR); // the WO-9999 row is last; age the WO-1231 row instead
  const idx = G.mq().findIndex(r => r.WO_ID === 'WO-1231'); const iso = new Date(Date.now() - 73 * HR).toISOString();
  G.st.grid[idx + 1][QCOLS.indexOf('Created_Date')] = iso; G.st.grid[idx + 1][QCOLS.indexOf('Sent_Date')] = iso;
  const r4 = await G.send(nudge({ message_body: 'Hi Regina, one more on WO-1231.' }));
  t('3 days + 1 hour later the next nudge goes', r4.sent === true, r4);
}
{
  // quiet hours behaviour is unchanged for nudges
  const G = gate({ quiet: true });
  const r = await G.send(nudge());
  t('quiet hours: a nudge is still held until 9am (existing behaviour)', r.held_for_quiet_hours === true && r.send_after === '2026-10-24T13:00:00.000Z');
}
{
  // -- item 6: Twilio permanent errors are final --
  const G = gate({ sendAnswers: [{ code: 21211, message: 'The To number is not valid' }] });
  const r = await G.send({ wo_id: 'WO-1251', message_type: 'tenant_job_assigned', recipient_type: 'tenant', tenant: { ID: '8', Phone: '7875550100', First_Name: 'Ana' }, message_body: 'Hi Ana, a plumber is assigned. Ref: WO-1251.' });
  const row = G.mq()[0];
  t('permanent error 21211: the queue row is marked failed ONCE with the code and a plain-English reason', r.sent === false && row.Status === 'failed' && row.Error_Code === '21211' && /not a valid phone number/.test(row.Error_Reason) && r.error_code === '21211', [row, r]);
  const led = G.st.reports.filter(x => x.where === 'sms_undeliverable');
  t('...ONE calm P2 ledger row, row id + last 4 digits only', led.length === 1 && led[0].severity === 'P2' && /ending 0100/.test(led[0].message) && !/7875550100/.test(JSON.stringify(G.st.reports)), G.st.reports);
  const again = await G.send({ wo_id: 'WO-1251', message_type: 'tenant_job_scheduled', recipient_type: 'tenant', tenant: { ID: '8', Phone: '7875550100', First_Name: 'Ana' }, message_body: 'Hi Ana, your job is scheduled for Friday.' });
  t('...a later text to the same bad number is NOT sent again (known undeliverable) and is logged', again.sent === false && again.suppress_reason === 'known_undeliverable' && G.st.raw.length === 1 && G.st.logs.some(l => l.Status === 'suppressed_known_bad'), again);
}
{
  const G = gate({ sendAnswers: [{ code: 21408, message: 'Permission to send an SMS has not been enabled for the region' }, { sid: 'SM77' }] });
  const o = { wo_id: 'WO-1251', message_type: 'tenant_job_assigned', recipient_type: 'tenant', tenant: { ID: '8', Phone: '7875550100', First_Name: 'Ana' }, message_body: 'Hi Ana, a plumber is assigned. Ref: WO-1251.' };
  const r = await G.send(o);
  const row = G.mq()[0];
  t('error 21408 (region not enabled): row failed with the code and a plain reason, not retried by this call', r.sent === false && row.Status === 'failed' && row.Error_Code === '21408' && /Geo Permissions/.test(row.Error_Reason) && G.st.raw.length === 1, row);
  t('...21408 is NOT a permanent per-number block: after Geo Permissions are fixed a NEW text to that number goes', (await G.send(Object.assign({}, o, { message_type: 'tenant_job_scheduled', message_body: 'Your job is scheduled for Friday.' }))).sent === true);
}
{
  // never retried by the release sweeps: a failed row is final (processQuietHoursQueue only takes Status "pending")
  t('the release sweeps only pick up "pending" rows (a failed or sending row is never re-sent)', /const due = rows\.filter\(r => r\.Status === 'pending' && r\.Send_After/.test(wsrc.slice(wsrc.indexOf('async function processQuietHoursQueue('), wsrc.indexOf('async function processQuietHoursQueue(') + 1500)));
  const rel = wsrc.slice(wsrc.indexOf('async function releaseMessageQueue('), wsrc.indexOf('async function releaseMessageQueue(') + 2500);
  t('the manual release uses the same claim-before-send path (mqSendQueuedRow)', /mqSendQueuedRow\(env, row, deliverTo/.test(rel) && /mqSendQueuedRow\(/.test(wsrc.slice(wsrc.indexOf('async function processQuietHoursQueue('), wsrc.indexOf('async function processQuietHoursQueue(') + 6000)));
}
{
  // -- item 6(b): destinations outside +1 are not sent --
  const G = gate();
  for (const [phone, label] of [['+989121234567', 'Iran +98'], ['+5352123456', 'Cuba +53'], ['+963944123456', 'Syria +963']]) {
    const before = G.st.reports.length;
    const r = await G.send({ wo_id: 'WO-1252', message_type: 'tenant_job_assigned', recipient_type: 'tenant', tenant: { ID: '9' + label.length, Phone: phone, First_Name: 'X' }, message_body: 'Hi X, update on WO-1252 for ' + label });
    const rep = G.st.reports.slice(before);
    t(label + ': not sent, no Twilio call, row failed with a plain reason', r.sent === false && G.st.raw.length === 0 && /outside enabled regions/.test(r.error_reason || '') && r.error_code === 'blocked_region', r);
    t(label + ': exactly ONE ledger row, P2, calm wording, row id, last 4 only, never the full number', rep.length === 1 && rep[0].severity === 'P2' && /text not sent: destination outside enabled regions/.test(rep[0].message) && /Message_Queue row \d+/.test(rep[0].message) && new RegExp('ending ' + phone.slice(-4)).test(rep[0].message) && !rep[0].message.includes(phone.slice(0, -4)), rep);
  }
  const pr = await G.send({ wo_id: 'WO-1253', message_type: 'tenant_job_assigned', recipient_type: 'tenant', tenant: { ID: '3', Phone: '7875550100', First_Name: 'Ana' }, message_body: 'Hi Ana, update on WO-1253.' });
  t('a Puerto Rico number (+1 787) IS sent', pr.sent === true && G.st.raw.length === 1);
}
{
  // -- item 1: sanitizer inside the gated path --
  const G = gate();
  await G.send(nudge({ message_body: 'Hi Regina, checking in on WO-1231 — Plumbing job (Fix the leak…) “soon” ✅' }));
  t('gated: the queued and sent text is plain', G.mq()[0].Message_Body === 'Hi Regina, checking in on WO-1231 - Plumbing job (Fix the leak...) "soon"' && G.st.raw[0].msg === G.mq()[0].Message_Body, G.mq()[0].Message_Body);
  const GS = gate();
  await GS.send({ wo_id: 'WO-1', message_type: 'vendor_job_assigned', recipient_type: 'vendor', vendor: { ID: '20', Name: 'Alex', Phone: '4105551212', Language: 'es' }, message_body: 'Hola — ¿puedes aceptar el trabajo? Está listo…', already_localized: true, translated_to: 'es' });
  t('gated: a Spanish vendor keeps accents but gets plain dash / ellipsis', GS.st.raw[0].msg === 'Hola - ¿puedes aceptar el trabajo? Está listo...' && GS.st.raw[0].opts.keepAccents === true, GS.st.raw[0]);
  const GE = gate();
  await GE.send({ wo_id: 'WO-1', message_type: 'vendor_job_assigned', recipient_type: 'vendor', vendor: { ID: '21', Name: 'Sam', Phone: '4105551213', Language: 'en' }, message_body: 'Está listo' });
  t('gated: an English-language vendor gets accents flattened', GE.st.raw[0].msg === 'Esta listo' && GE.st.raw[0].opts.keepAccents === false);
}

{
  const G = gate({ auditFails: true });
  const r = await G.send(nudge());
  t('FAULT the per-WO audit row cannot be written: the text still goes and the failure is reported (P2 message_audit), not swallowed', r.sent === true && G.st.reports.some(x => x.where === 'message_audit' && x.severity === 'P2' && /500/.test(x.message)), G.st.reports);
  const H = gate({ auditFails: true, quiet: true });
  const r2 = await H.send(nudge());
  t('FAULT the audit row for a quiet-hours hold fails: reported too', r2.held_for_quiet_hours === true && H.st.reports.some(x => x.where === 'message_audit'), H.st.reports);
  const ok = gate(); await ok.send(nudge());
  t('happy path: no audit failure is reported', ok.st.reports.length === 0);
}

// ========================= the nudge sweep (real processVendorNudges) =========================
{
  const consts = ['VENDOR_NUDGE_MAX', 'VENDOR_NUDGE_REPEAT_HOURS', 'VENDOR_MANUAL_REPEAT_HOURS', 'WO_STATUS_COMPLETE_OR_LATER', 'WO_STATUS_INVOICED_OR_LATER'].map(n => { const i = wsrc.indexOf('const ' + n + ' ='); return wsrc.slice(i, wsrc.indexOf(';', i) + 1); }).join('\n');
  const mk = (gateAnswer, vendorOver) => {
    const c = { updates: [], sent: [] };
    const NOW = Date.now();
    const rows = [{ ID: '5', WO_ID: 'WO-1231', Vendor_ID: '19', Request_Type: 'status_update', Status: 'open', Nudge_Count: '1', Next_Nudge_At: new Date(NOW - HR).toISOString() }];
    const deps = {
      ensureVendorReqTab: async () => {}, VENDOR_REQ_TAB: 'Vendor_Requests',
      fetchTab: async (e, tab) => tab === 'Vendor_Requests' ? rows : tab === 'Work_Orders' ? [{ ID: 'WO-1231', Status: 'Assigned', Property_ID: 'P1', Unit_ID: 'U1', Trade: 'Plumbing', Description: 'Fix the leaking kitchen faucet at the sink', Vendor_ID: '19' }] : tab === 'Vendors' ? [Object.assign({ ID: '19', First_Name: 'Regina', Phone: '5403364284', In_House: 'FALSE' }, vendorOver || {})] : tab === 'Properties' ? [{ ID: 'P1', Address: '12 Main St' }] : [{ ID: 'U1', Unit_Label: '2' }],
      fetchConfig: async () => ({ admin_phone: '+14105550100' }),
      findWO: (wos, id) => wos.find(w => w.ID === id), updateRow: async (e, tab, id, f) => { c.updates.push(f); }, addRow: async () => {},
      addonNudgeHold: () => false, formatUnitLabel: x => String(x), smsGatedSend: async (e, o) => { c.sent.push(o); return gateAnswer; },
      sendSMS: async () => ({ sid: 'x' }), smsReportIfFailed: async () => true,
    };
    const names = Object.keys(deps);
    const fn = new Function(...names, consts + '\n' + grab('smsShort') + '\n' + grab('woJobLabel') + '\n' + grab('vendorPortalLink') + '\n' + grab('processVendorNudges') + '\nreturn processVendorNudges;')(...names.map(k => deps[k]));
    return { run: () => fn({}), c };
  };
  let m = mk({ sent: true, gate_snapshot: 'ok' }); let out = await m.run();
  t('nudge sweep: a normal nudge goes, count +1, next nudge in 72 hours (3 days)', out.results[0].action === 'nudged' && m.c.updates[0].Nudge_Count === '2' && Math.abs(Date.parse(m.c.updates[0].Next_Nudge_At) - (Date.now() + 72 * HR)) < 60000, [out, m.c.updates]);
  const nm = m.c.sent[0].message_body;
  t('nudge sweep: the text is plain, 2 pieces or fewer, keeps the link', R.smsEstimate(nm).encoding === 'GSM-7' && R.smsEstimate(nm).pieces <= 2 && /vendor\.html\?wo=WO-1231/.test(nm), R.smsEstimate(nm));
  m = mk({ sent: false, suppressed: true, suppress_reason: 'own_number' }); out = await m.run();
  t('nudge sweep: a nudge to the owner\'s own number is CANCELLED (not re-armed every day), no count used', out.results[0].action === 'cancelled_own_number' && m.c.updates.length === 1 && m.c.updates[0].Status === 'cancelled' && !('Nudge_Count' in m.c.updates[0]), [out, m.c.updates]);
  const later = new Date(Date.now() + 40 * HR).toISOString();
  m = mk({ sent: false, suppressed: true, suppress_reason: 'nudge_cap', next_allowed_at: later }); out = await m.run();
  t('nudge sweep: a nudge held back by the 3-day cap is pushed to when it is next allowed, no count used', out.results[0].action === 'nudge_capped' && m.c.updates[0].Next_Nudge_At === later && !('Nudge_Count' in m.c.updates[0]), [out, m.c.updates]);
  m = mk({ sent: false, held_for_quiet_hours: true }); out = await m.run();
  t('nudge sweep: a quiet-hours hold still counts (existing behaviour)', out.results[0].action === 'nudged' && m.c.updates[0].Nudge_Count === '2');
}

// ========================= queued sends (quiet-hours release / manual release) =========================
{
  const mk = (o) => {
    o = o || {}; const calls = { updates: [], raw: [], reports: [], mqf: [] };
    const deps = {
      updateMessageQueueRow: async (e, id, f) => { calls.updates.push(f); if (o.claimFails && f.Status === 'sending') return false; if (o.finalFails && f.Status !== 'sending') return false; return true; },
      sendSMSRaw: async (e, to, msg, opts) => { calls.raw.push({ to, msg, opts }); if (o.throws) throw new Error('boom'); return (o.answer || { sid: 'SMq' }); },
      reportFailure: async (e, r) => { calls.reports.push(r); }, mqReportFailure: async (e, id, m) => { calls.mqf.push(m); },
      smsReportRegionBlocked: async (e, id, c) => { calls.reports.push({ where: 'sms_destination_region', rowId: id, last4: c.last4 }); },
    };
    const Q = d16Queue(Object.assign({ smsSendOutcome: R.smsSendOutcome, smsDestinationCheck: R.smsDestinationCheck }, deps));
    return { Q, calls };
  };
  const row = { ID: '12', WO_ID: 'WO-1', Message_Type: 'tenant_job_scheduled', Recipient_Type: 'tenant', Recipient_Phone: '+14105550111', Message_Body: 'Your job is scheduled', Translated_To: '' };
  let m = mk(); let r = await m.Q.mqSendQueuedRow({}, row, '+14105550111', { Gate_Snapshot: 'ok' });
  t('queued send: marks "sending" FIRST, sends once, then marks "sent" with the SID', r.sent === true && m.calls.updates.length === 2 && m.calls.updates[0].Status === 'sending' && m.calls.updates[1].Status === 'sent' && m.calls.updates[1].Twilio_Message_SID === 'SMq' && m.calls.updates[1].Gate_Snapshot === 'ok' && m.calls.raw.length === 1 && m.calls.reports.length === 0, m.calls);
  m = mk({ claimFails: true }); r = await m.Q.mqSendQueuedRow({}, row, '+14105550111');
  t('FAULT the "sending" mark cannot be saved: the text is NOT sent (fails closed), caller is told, row stays pending for the next sweep', r.sent === false && r.claim_failed === true && m.calls.raw.length === 0 && /not sent/.test(r.outcome.reason), r);
  m = mk({ finalFails: true }); r = await m.Q.mqSendQueuedRow({}, row, '+14105550111');
  t('FAULT the final "sent" save fails: it WAS sent once; the row stays "sending" (never back to pending), so no sweep can send it again', r.sent === true && m.calls.raw.length === 1 && m.calls.updates[0].Status === 'sending' && m.calls.updates[m.calls.updates.length - 1].Status === 'sent', m.calls.updates);
  m = mk({ answer: { code: 21610, message: 'unsubscribed' } }); r = await m.Q.mqSendQueuedRow({}, row, '+14105550111');
  t('queued send, permanent error 21610 (STOP): row failed once with the code + reason; not a ledger P2 per number-block (opt-outs are routine)', r.sent === false && m.calls.updates[1].Status === 'failed' && m.calls.updates[1].Error_Code === '21610' && /opted out/.test(m.calls.updates[1].Error_Reason), m.calls.updates);
  m = mk({ answer: { code: 21614, message: 'not mobile' } }); r = await m.Q.mqSendQueuedRow({}, row, '+14105550111');
  t('queued send, permanent error 21614: ONE calm P2 ledger row with the last 4 digits', m.calls.reports.length === 1 && m.calls.reports[0].severity === 'P2' && /ending 0111/.test(m.calls.reports[0].message) && !/4105550111/.test(m.calls.reports[0].message), m.calls.reports);
  m = mk(); r = await m.Q.mqSendQueuedRow({}, row, '+989121234567');
  t('queued send to a +98 number: not sent, row failed blocked_region, ONE region ledger row', r.sent === false && m.calls.raw.length === 0 && m.calls.updates[1].Error_Code === 'blocked_region' && m.calls.reports.length === 1 && m.calls.reports[0].where === 'sms_destination_region', m.calls);
  m = mk({ throws: true }); r = await m.Q.mqSendQueuedRow({}, row, '+14105550111');
  t('FAULT Twilio call throws: reported (message_queue_update), row failed, caller sees sent:false', r.sent === false && m.calls.mqf.length === 1 && /may or may not have gone out/.test(m.calls.mqf[0]) && m.calls.updates[1].Status === 'failed', m.calls);
  m = mk(); await m.Q.mqSendQueuedRow({}, Object.assign({}, row, { Translated_To: 'es', Message_Body: 'Hola' }), '+14105550111');
  t('queued send passes keepAccents for a Spanish row and the logging context (queue id, message type)', m.calls.raw[0].opts.keepAccents === true && m.calls.raw[0].opts.context.queue_id === '12' && m.calls.raw[0].opts.context.message_type === 'tenant_job_scheduled');
}
{
  // processQuietHoursQueue: only 'pending' rows are taken; a stale "sending" row is REPORTED, not re-sent
  const rows = [
    { ID: '1', Status: 'sending', Send_After: '2026-01-01T12:00:00Z', Recipient_Type: 'tenant', Recipient_Phone: '+14105550111', Message_Body: 'a', Created_Date: new Date(Date.now() - 30 * MIN).toISOString(), Sent_Date: new Date(Date.now() - 20 * MIN).toISOString(), Twilio_Message_SID: '' },
    { ID: '2', Status: 'failed', Send_After: '2026-01-01T12:00:00Z', Recipient_Type: 'tenant', Recipient_Phone: '+14105550111', Message_Body: 'b', Created_Date: '2026-01-01T00:00:00Z', Error_Code: '21211' },
    { ID: '3', Status: 'pending', Send_After: '2026-01-01T12:00:00Z', Recipient_Type: 'tenant', Recipient_Phone: '+14105550222', Message_Body: 'c', Created_Date: '2026-01-01T00:00:00Z', Property_ID: '50' },
  ];
  const calls = { raw: [], upd: [], mqf: [] };
  const deps = {
    ensureSmsInfra: async () => {}, fetchConfig: async () => ({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }),
    normalizePhone: p => String(p || ''), fetchTab: async (e, tab) => tab === 'Message_Queue' ? rows : [], MSG_QUEUE_TAB: 'Message_Queue',
    smsToggleOn: () => true, tenantForQueuedText: () => ({ ID: 't', SMS_Enabled: 'TRUE' }), tenantMovedOut: () => false,
    smsGateDecision: () => ({ sendOk: true, gateSnapshot: 'all on' }), proposalSeenByOwner: () => false, proposalStampSms: async () => {}, logTelemetry: async () => {},
    sendSMSRaw: async (e, to, m) => { calls.raw.push(to); return { sid: 'S1' }; }, updateMessageQueueRow: async (e, id, f) => { calls.upd.push([id, f.Status]); return true; },
    mqReportFailure: async (e, id, m) => { calls.mqf.push([id, m]); }, reportFailure: async () => {},
  };
  Object.assign(deps, d16Deps(), d16Queue(deps));
  deps.mqReportFailure = async (e, id, m) => { calls.mqf.push([id, m]); };
  const names = Object.keys(deps).filter(k => k !== '__rec');
  const fn = new Function(...names, grab('processQuietHoursQueue') + '\nreturn processQuietHoursQueue;')(...names.map(k => deps[k]));
  const out = await fn({});
  t('sweep: only the pending row (3) is sent; the "sending" (1) and "failed" (2) rows are never re-sent', calls.raw.length === 1 && calls.raw[0] === '+14105550111'.replace('0111', '0222') || (calls.raw.length === 1 && out.results.length === 1 && out.results[0].id === '3'), [calls, out]);
  t('sweep: the row stuck at "sending" for 20 minutes is REPORTED (message_queue_update) once, not silently ignored', calls.mqf.length === 1 && calls.mqf[0][0] === '1' && /NOT sent again/.test(calls.mqf[0][1]), calls.mqf);
}

// ========================= updateStatus: the same status twice does not re-text =========================
{
  const us = grab('updateStatus');
  t('updateStatus: a repeat of the same status skips the one-off admin Complete text and the tenant "accepted" text', /const _repeatStatus = String\(wo\.Status \|\| ''\) === String\(body\.status \|\| ''\)/.test(us) && /config\.admin_phone && !_repeatStatus/.test(us) && /if \(_repeatStatus\) continue;/.test(us));
  t('updateStatus: those two legacy texts now check Twilio\'s answer (reported to the ledger on failure)', /smsReportIfFailed\(env, 'sms_admin_complete'/.test(us) && /smsReportIfFailed\(env, 'sms_tenant_accepted'/.test(us));
  t('legacy logSMS no longer reads the whole SMS_Logs tab and no longer swallows a failed write', /smsLogRecord\(env, \{ WO_ID/.test(grab('logSMS')) && !/catch\(e\) \{ \/\*/.test(grab('logSMS')) && !/values\/SMS_Logs`\)/.test(grab('logSMS')));
  const rr = d16Real({ sheetsRequest: async () => { throw new Error('Sheets 429'); } });
  const lr = await rr.smsLogRecord({}, { Status: 'sent' });
  t('FAULT logSMS-style write fails: reported once (P1 sms_log_write) and returned, not swallowed', lr.ok === false && rr.rec.reports.length === 1 && rr.rec.reports[0].where === 'sms_log_write' && rr.rec.reports[0].severity === 'P1', rr.rec.reports);
  const ok1 = await rr.smsReportIfFailed({}, 'w', 'ref', { sid: 'SM1' });
  const ok2 = await rr.smsReportIfFailed({}, 'w', 'ref', { skipped: true, reason: 'TWILIO_ENABLED not TRUE' });
  t('smsReportIfFailed: a sent or switched-off text reports nothing', ok1 === true && ok2 === false && rr.rec.reports.length === 1);
  const ok3 = await rr.smsReportIfFailed({}, 'w', 'WO-5', { error: 'Twilio down' });
  t('smsReportIfFailed: a real failure is a P0 ledger row', ok3 === false && rr.rec.reports[1].severity === 'P0' && rr.rec.reports[1].where === 'w' && /Twilio down/.test(rr.rec.reports[1].message), rr.rec.reports);
  const ok4 = await rr.smsReportIfFailed({}, 'w', 'WO-5', { code: 21211, message: 'x' });
  t('smsReportIfFailed: a permanent Twilio refusal is P2 (calm)', ok4 === false && rr.rec.reports[2].severity === 'P2');
}

// ========================= 5. real cost + daily balance snapshot =========================
{
  const sg = wsrc.slice(wsrc.indexOf('const SMS_LOG_COST_COLS'), wsrc.indexOf('\n', wsrc.indexOf('const SMS_LOG_COST_COLS')));
  t('SMS_Logs gets cost columns appended at the END (Segments, Est_Segments, Encoding, Chars, Price, Price_Unit, Error_Code...)', /'Segments'.*'Est_Segments'.*'Encoding'.*'Chars'.*'Price'.*'Price_Unit'.*'Error_Code'/.test(sg));
  t('SMS_Logs columns are added with ensureColumns (never ensureTab over the live tab, only if the tab is missing)', /await ensureColumns\(env, SMS_LOG_TAB, want\)/.test(wsrc) && /if \(!isMissingTabError\(e\)\) throw e; await ensureTab\(env, SMS_LOG_TAB, want\)/.test(wsrc));
  const B = new Function(grab('twilioBalancePlan') + '\nreturn { twilioBalancePlan };')();
  const p1 = B.twilioBalancePlan([], '2026-10-23', 41.5, '2026-10-23T11:00:00Z', 'integrity check');
  t('balance plan: first row has no change', p1.row && p1.row.Date === '2026-10-23' && p1.row.Balance_USD === '41.50' && p1.row.Change_USD === '' && p1.row.Note === 'first row', p1);
  const p2 = B.twilioBalancePlan([{ Date: '2026-10-22', Balance_USD: '42.90' }, { Date: '2026-10-21', Balance_USD: '44.30' }], '2026-10-23', 41.5, 'x', 's');
  t('balance plan: change vs the last recorded day (negative = spent)', p2.row.Change_USD === '-1.40' && /since 2026-10-22/.test(p2.row.Note), p2);
  const p3 = B.twilioBalancePlan([{ Date: '2026-10-23', Balance_USD: '41.50' }], '2026-10-23', 41.0, 'x', 's');
  t('balance plan: one row per day (a second run the same day writes nothing)', p3.skip === true && /already recorded/.test(p3.reason));
  t('balance plan: top-up shows as a positive change', B.twilioBalancePlan([{ Date: '2026-10-22', Balance_USD: '5.00' }], '2026-10-23', 55, 'x', 's').row.Change_USD === '50.00');
  t('balance plan: no number = skip', B.twilioBalancePlan([], 'd', NaN, 'x', 's').skip === true && B.twilioBalancePlan([], 'd', null, 'x', 's').skip === true);

  // the pass, with injected IO
  const pass = (o) => {
    o = o || {}; const c = { reports: [], appended: [], condCalls: 0, fetchCalls: 0 };
    const deps = {
      schedEtParts: (d) => ({ date: '2026-10-23' }), schedErrText: e => String((e && e.message) || e), configFromValues: () => ({}), schedReadConfigRows: async () => [], ensureTab: async () => {}, fetchTab: async () => [], addRow: async () => ({ json: async () => ({ success: true }) }),
      reportFailure: async (e, r) => { c.reports.push(r); }, failInvariantConditions: async () => [],
    };
    const names = Object.keys(deps);
    const fn = new Function(...names, wsrc.slice(wsrc.indexOf('const TWILIO_BAL_TAB'), wsrc.indexOf('async function schedRunTwilioBalanceLog')) + '\nreturn twilioBalanceSnapshotPass;')(...names.map(k => deps[k]));
    const env = Object.assign({ TWILIO_SID: 'AC', TWILIO_API_SID: 'SK', TWILIO_API_KEY: 'k' }, o.env || {});
    const io = {
      nowMs: Date.parse('2026-10-23T11:00:00Z'), readConfigRows: async () => [],
      conditions: async (e, cfg, nowMs, out) => { c.condCalls++; if (o.balance != null) { out.balance = o.balance; out.balance_at = nowMs - 5 * HR; } return []; },
      readRows: async () => o.rows || [], appendRow: async (row) => { if (o.appendFails) throw new Error('append 500'); c.appended.push(row); return o.appendUnconfirmed ? { success: false } : { success: true }; },
      reportFailure: async (e, r) => { c.reports.push(r); },
    };
    return { run: () => fn(env, io), c };
  };
  let P = pass({ balance: 38.25, rows: [{ Date: '2026-10-22', Balance_USD: '39.65' }] }); let res = await P.run();
  t('balance pass: writes ONE row (date, balance, change) using the integrity check\'s balance, no extra Twilio call here', res.ok && P.c.appended.length === 1 && P.c.appended[0].Date === '2026-10-23' && P.c.appended[0].Balance_USD === '38.25' && P.c.appended[0].Change_USD === '-1.40' && P.c.condCalls === 1 && P.c.reports.length === 0, [res, P.c]);
  P = pass({ balance: 38.25, rows: [{ Date: '2026-10-23', Balance_USD: '38.25' }] }); res = await P.run();
  t('balance pass: already recorded today -> no write, ok', res.ok && P.c.appended.length === 0 && /already recorded/.test(res.detail.skipped));
  P = pass({ env: { TWILIO_API_KEY: '' } }); res = await P.run();
  t('balance pass: no Twilio credentials (staging) -> skipped, nothing written, nothing reported', res.ok && /no Twilio credentials/.test(res.detail.skipped) && P.c.appended.length === 0 && P.c.condCalls === 0 && P.c.reports.length === 0);
  P = pass({ balance: null }); res = await P.run();
  t('FAULT no balance available: job fails, P1 ledger row, nothing written', res.ok === false && P.c.appended.length === 0 && P.c.reports.length === 1 && P.c.reports[0].severity === 'P1' && P.c.reports[0].where === 'twilio_balance_log', [res, P.c.reports]);
  P = pass({ balance: 20, appendFails: true }); res = await P.run();
  t('FAULT the row write throws: job fails, P1 ledger row names the step', res.ok === false && P.c.reports.length === 1 && /write_row/.test(P.c.reports[0].message), [res, P.c.reports]);
  P = pass({ balance: 20, appendUnconfirmed: true }); res = await P.run();
  t('FAULT the write is not confirmed (no success): treated as a failure, not "done"', res.ok === false && P.c.reports.length === 1);
  // scheduler wiring
  const reg = wsrc.slice(wsrc.indexOf('const SCHED_JOBS = ['), wsrc.indexOf('];', wsrc.indexOf('const SCHED_JOBS = [')));
  t('scheduler: twilio_balance_log is a daily Hub job (Apps Script clock, NO cron)', /name: 'twilio_balance_log', kind: 'daily'/.test(reg) && !/cron/i.test(wsrc.slice(wsrc.indexOf('async function twilioBalanceSnapshotPass'), wsrc.indexOf('async function schedRunTwilioBalanceLog'))));
  t('the invoice integrity check stores the balance and a snapshot caller reuses it (one Twilio call per 20 h)', /JSON\.stringify\(\{ at: nowMs, items: compact, balance \}\)/.test(wsrc) && /if \(hasBal \|\| !out\) return stored\.items;/.test(wsrc));
  const dcBlock = wsrc.slice(wsrc.indexOf('const SMS_DC_LOOKBACK_MS'), wsrc.indexOf('function smsDcClassify(')); const dc = new Function(dcBlock + '\n' + grab('smsDcClassify') + '\nreturn smsDcClassify;')();
  const sum = dc([{ direction: 'outbound-api', date_sent: '2026-10-23T10:00:00Z', status: 'delivered', body: 'a', from: '+1', to: '+14105550111', num_segments: '2', price: '-0.0158' }, { direction: 'outbound-api', date_sent: '2026-10-23T10:01:00Z', status: 'delivered', body: 'b', from: '+1', to: '+14105550111', num_segments: '1', price: null }], Date.parse('2026-10-23T11:00:00Z'));
  t('delivery check summary adds up pieces and price Twilio billed', sum.pieces === 3 && Math.abs(sum.price_usd - 0.0158) < 1e-9 && sum.priced === 1, sum);
}

console.log(`sms-cost-d16: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
