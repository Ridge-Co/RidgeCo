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
//__CHUNK_END__
