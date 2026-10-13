// SMS delivery check (Oct 13 2026): the daily scheduler job `sms_delivery_check` that watches for carrier filtering
// of the notifications number's link texts. Tests every failure path (Config unreadable, Twilio unconfigured / HTTP
// error / non-JSON / bad shape, email failure, state write failure, telemetry failure) plus the pure classification,
// alert thresholds, state streak and the paging. Brett's rule: NOTHING FAILS SILENTLY.
// Run: node test/sms-delivery-check.test.mjs   (SRC=path/to/worker.js to test another copy)
import fs from 'fs';
const src = fs.readFileSync(process.env.SRC || new URL('../worker.js', import.meta.url), 'utf8');
const START = src.indexOf('// ── SMS delivery check (Oct 13 2026)');
const END = src.indexOf('// ── END SMS delivery check');
if (START < 0 || END < START) throw new Error('sms delivery check block not found in worker.js');
const block = src.slice(START, END);
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const M = new Function('schedReadConfigRows', 'logTelemetry', 'gmailSendEmail', 'setConfigKey',
  grab('schedEtParts') + '\n' + grab('schedErrText') + '\n' + grab('_escHtml') + '\n' + grab('configFromValues') + '\n' + block +
  '\nreturn { smsDcHasLink, smsDcClassify, smsDcEvaluate, smsDcParseState, smsDcNextState, smsDcCanRetire, smsDcCompose, smsDcFetchMessages, smsDeliveryCheckPass, schedRunSmsDeliveryCheck, SMS_DC_STATE_KEY, SMS_DC_LOOKBACK_MS };')(
  async () => { throw new Error('unexpected real read'); }, async () => { throw new Error('unexpected real telemetry'); }, async () => { throw new Error('unexpected real email'); }, async () => { throw new Error('unexpected real setConfigKey'); });

let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };

const NOW = Date.parse('2026-10-14T11:00:00.000Z');   // 07:00 EDT Wed
const H = 3600000;
const ago = (h) => new Date(NOW - h * H).toISOString();
const msg = (o) => Object.assign({ sid: 'SM' + Math.random().toString(16).slice(2, 10), direction: 'outbound-api', from: '+14108880328', to: '+14105551234', body: 'Ridge Co: New work order #1 Reply YES', status: 'delivered', error_code: null, date_sent: ago(2), date_updated: ago(2) }, o || {});
const LINK = 'Ridge Co: open https://ridge-co.github.io/RidgeCo/vendor.html?wo=1';

// ── link detection
t('https link', M.smsDcHasLink('see https://x.com/a'));
t('www link', M.smsDcHasLink('see www.x.com'));
t('bare domain/path', M.smsDcHasLink('go to bmoremanagement.com/i/1234'));
t('plain text has no link', !M.smsDcHasLink('Ridge Co: work order #1234 is complete. Reply STOP to opt out.'));
t('null body has no link', !M.smsDcHasLink(null));
t('a price is not a link', !M.smsDcHasLink('The estimate is $1,200.50 for 3.5 hours'));

// ── classification
{
  const s = M.smsDcClassify([
    msg(), msg({ body: LINK }), msg({ body: LINK, status: 'undelivered', error_code: 30007 }),
    msg({ status: 'failed', error_code: 30003 }), msg({ status: 'sent', date_updated: ago(0.5) }), msg({ status: 'sent', date_updated: ago(5), body: LINK }),
    msg({ direction: 'inbound' }), msg({ date_sent: ago(40) }), null, 'junk', msg({ date_sent: 'not a date', date_created: 'nope' }),
    msg({ status: 'queued', date_sent: null, date_created: ago(1), date_updated: ago(1) }),
  ], NOW);
  t('inbound, too-old, malformed and unparseable-date messages are ignored', s.total === 7, s);
  t('delivered counted', s.delivered === 2);
  eq('filter hit captured with last-4 only, no body', s.filter_hits.map(h => [h.code, h.to_last4, h.has_link, Object.keys(h).includes('body')]), [['30007', '1234', true, false]]);
  eq('other error bucketed (not a filter)', s.other_errors, { '30003': 1 });
  t('stuck = sent with no update >3h', s.stuck === 1 && s.with_link.stuck === 1, s);
  t('recent sent / queued are in flight', s.in_flight === 2, s);
  t('with-link bucket', s.with_link.sent === 3 && s.with_link.delivered === 1 && s.with_link.filtered === 1 && s.with_link.stuck === 1, s.with_link);
  t('by_from tracked', s.by_from['+14108880328'].sent === 7, s.by_from);
  eq('empty / non-array input', [M.smsDcClassify([], NOW).total, M.smsDcClassify(undefined, NOW).total, M.smsDcClassify('x', NOW).total], [0, 0, 0]);
  const a = M.smsDcClassify([msg({ status: 'undelivered', error_code: 30034 }), msg({ status: 'failed', error_code: 30032 }), msg({ status: 'failed' }), msg({ status: 'undelivered', error_code: 21610, error_message: 'Attempt to send to unsubscribed recipient' })], NOW);
  t('30034 and 30032 are filter/registration hits', a.filter_hits.map(h => h.code).sort().join() === '30032,30034', a.filter_hits);
  t('failed with no code is reported, not dropped', Object.keys(a.other_errors).some(k => /failed \(no code\)/.test(k)) && Object.keys(a.other_errors).some(k => /^21610 /.test(k)), a.other_errors);
}

// ── evaluation thresholds
{
  const clean = M.smsDcEvaluate(M.smsDcClassify([msg(), msg({ body: LINK }), msg({ status: 'failed', error_code: 30003 })], NOW));
  t('routine handset failures are NOT an alert', clean.level === 'clean' && clean.reasons.length === 0 && clean.notes.length === 1, clean);
  const f = M.smsDcEvaluate(M.smsDcClassify([msg({ status: 'undelivered', error_code: 30007 })], NOW));
  t('a single 30007 is an alert', f.level === 'alert' && /filtered/.test(f.reasons[0]), f);
  const fiveLinksOneBad = [1, 2, 3, 4].map(() => msg({ body: LINK })).concat([msg({ body: LINK, status: 'failed', error_code: 30005 })]);
  t('1 of 5 link texts failing = 20% = alert', M.smsDcEvaluate(M.smsDcClassify(fiveLinksOneBad, NOW)).level === 'alert');
  const fourLinksOneBad = [1, 2, 3].map(() => msg({ body: LINK })).concat([msg({ body: LINK, status: 'failed', error_code: 30005 })]);
  t('below the 5-text minimum a link failure is not (yet) an alert', M.smsDcEvaluate(M.smsDcClassify(fourLinksOneBad, NOW)).level === 'clean');
  const stuckLinks = [1, 2, 3, 4, 5].map(() => msg({ body: LINK, status: 'sent', date_updated: ago(6) }));
  t('link texts that never get a receipt count against the links', M.smsDcEvaluate(M.smsDcClassify(stuckLinks, NOW)).level === 'alert');
  const noLinkBad = [1, 2, 3, 4, 5].map(() => msg({ status: 'failed', error_code: 30003 }));
  t('failures on texts WITHOUT links never trip the link alert', M.smsDcEvaluate(M.smsDcClassify(noLinkBad, NOW)).level === 'clean');
}

// ── state streak
{
  eq('blank state parses fresh, not corrupt', M.smsDcParseState('').corrupt, false);
  t('garbage state is flagged corrupt and reset', M.smsDcParseState('{nope').corrupt === true && M.smsDcParseState('{nope').state.clean_days === 0);
  t('array state is corrupt', M.smsDcParseState('[1]').corrupt === true);
  let s = M.smsDcParseState('').state;
  s = M.smsDcNextState(s, 'clean', '2026-10-14', 6); s = M.smsDcNextState(s, 'clean', '2026-10-14', 6);
  t('same ET date counts once (a retry does not double-count)', s.clean_days === 1 && s.clean_link_texts === 6, s);
  s = M.smsDcNextState(s, 'clean', '2026-10-15', 4);
  t('next date adds', s.clean_days === 2 && s.clean_link_texts === 10);
  s = M.smsDcNextState(s, 'alert', '2026-10-16', 9);
  t('an alert resets the streak', s.clean_days === 0 && s.clean_link_texts === 0 && s.last_date === '2026-10-16');
  t('retire needs BOTH 14 clean days and 30 link texts', !M.smsDcCanRetire({ clean_days: 14, clean_link_texts: 29 }) && !M.smsDcCanRetire({ clean_days: 13, clean_link_texts: 99 }) && M.smsDcCanRetire({ clean_days: 14, clean_link_texts: 30 }));
  t('round trip through JSON', JSON.stringify(M.smsDcParseState(JSON.stringify(s)).state) === JSON.stringify(s));
}

// ── composition (escaping, privacy)
{
  const s = M.smsDcClassify([msg({ body: LINK, status: 'undelivered', error_code: 30007, sid: 'SM<script>' })], NOW);
  const c = M.smsDcCompose(s, M.smsDcEvaluate(s), { clean_days: 0, clean_link_texts: 0 }, '2026-10-14', false);
  t('alert subject says problem + count', /SMS delivery problem: 1 filtered/.test(c.subject), c.subject);
  t('html escapes ids', !/<script>/.test(c.html) && /&lt;script&gt;/.test(c.html));
  t('html never contains a full phone number or the text body', !/\+?1?4105551234/.test(c.html) && !/vendor\.html/.test(c.html));
  t('html shows last 4 only', /…1234/.test(c.html));
  const ok = M.smsDcClassify([msg(), msg({ body: LINK })], NOW);
  const c2 = M.smsDcCompose(ok, M.smsDcEvaluate(ok), { clean_days: 15, clean_link_texts: 40 }, '2026-10-14', true);
  t('clean subject', /clean: 2 texts, 1 with links/.test(c2.subject), c2.subject);
  t('retire line + truncation note', /looks resolved/.test(c2.html) && /counts may be incomplete/.test(c2.html));
}

// ── fetch: paging, auth, errors
const R = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
const env = { TWILIO_SID: 'ACtest', TWILIO_API_SID: 'SKtest', TWILIO_API_KEY: 'secret' };
{
  const calls = [];
  const pages = [R(200, { messages: [msg(), msg()], next_page_uri: '/2010-04-01/Accounts/ACtest/Messages.json?Page=1&PageSize=1000' }), R(200, { messages: [msg()], next_page_uri: null })];
  const f = await M.smsDcFetchMessages(env, NOW, async (url, init) => { calls.push({ url, init }); return pages[calls.length - 1]; });
  t('pages followed to the end', f.messages.length === 3 && f.pages === 2 && f.truncated === false, f);
  t('first URL: account SID, UTC date filter, page size, basic auth with the API-key pair', /\/Accounts\/ACtest\/Messages\.json\?/.test(calls[0].url) && /DateSent%3E=2026-10-1[12]/.test(calls[0].url) && /PageSize=1000/.test(calls[0].url) && calls[0].init.headers.Authorization === 'Basic ' + btoa('SKtest:secret'), calls[0]);
  t('second URL is on api.twilio.com', calls[1].url.startsWith('https://api.twilio.com/2010-04-01/'));
  let n = 0;
  const endless = await M.smsDcFetchMessages(env, NOW, async () => { n++; return R(200, { messages: [msg()], next_page_uri: '/next' }); });
  t('paging is capped and says it was truncated', n === 6 && endless.truncated === true && endless.pages === 6, { n, endless: endless.pages });
  const rej = async (e, fn) => { try { await M.smsDcFetchMessages(e, NOW, fn); return null; } catch (x) { return String(x.message); } };
  t('unconfigured Twilio throws loudly', /Twilio not configured/.test(await rej({}, async () => R(200, {}))));
  t('missing API key throws', /Twilio not configured/.test(await rej({ TWILIO_SID: 'a', TWILIO_API_SID: 'b' }, async () => R(200, {}))));
  t('HTTP 401 throws with status', /HTTP 401/.test(await rej(env, async () => R(401, { message: 'Authenticate' }))));
  t('non-JSON throws', /non-JSON/.test(await rej(env, async () => R(200, '<html>'))));
  t('missing messages array throws', /no messages array/.test(await rej(env, async () => R(200, { ok: 1 }))));
  t('network error propagates', /boom/.test(await rej(env, async () => { throw new Error('boom'); })));
}

// ── the whole pass, with injected IO
function harness(over) {
  over = over || {};
  const h = { cfg: Object.assign({}, over.cfg), emails: [], telem: [], writes: [], calls: 0 };
  const rowsOf = () => [['Key', 'Value']].concat(Object.entries(h.cfg));
  h.deps = {
    nowMs: NOW,
    readConfigRows: over.readConfigRows || (async () => rowsOf()),
    fetchMessages: over.fetchMessages || (async () => ({ messages: over.messages || [msg(), msg({ body: LINK })], pages: 1, truncated: false })),
    sendEmail: over.sendEmail || (async (e, m) => { h.emails.push(m); return { sent: true, message_id: 'g1' }; }),
    setConfigKey: over.setConfigKey || (async (e, b) => { h.writes.push(b); if (!over.stateNotSticky) h.cfg[b.key] = b.value; return { status: 200 }; }),
    logTelemetry: over.logTelemetry || (async (e, r) => { h.telem.push(r); }),
  };
  return h;
}
{
  const h = harness();
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('clean day: ok, one email to the default address, state saved, heartbeat logged', r.ok && !r.errors.length && h.emails.length === 1 && h.emails[0].to === 'brett@bmoremanagement.com' && /clean/.test(h.emails[0].subject) && h.writes.length === 1 && h.telem.length === 1 && h.telem[0].Success === 'TRUE', { r, emails: h.emails.length });
  t('clean day sets no_retry (an email went out)', r.no_retry === true);
  t('detail reports counts and level', r.detail.level === 'clean' && r.detail.total === 2 && r.detail.with_link.sent === 1 && r.detail.clean_days === 1 && r.detail.emailed === true, r.detail);
  t('state row holds a valid streak for the ET date', JSON.parse(h.cfg[M.SMS_DC_STATE_KEY]).last_date === '2026-10-14' && JSON.parse(h.cfg[M.SMS_DC_STATE_KEY]).clean_days === 1, h.cfg);
  t('heartbeat note has no phone numbers', !/\d{10}/.test(h.telem[0].Notes), h.telem[0].Notes);
  const r2 = await M.smsDeliveryCheckPass(env, Object.assign({}, h.deps, { nowMs: NOW + H }));
  t('a second run the same ET day does not double-count the clean day', JSON.parse(h.cfg[M.SMS_DC_STATE_KEY]).clean_days === 1 && r2.ok, h.cfg);
}
{
  const h = harness({ cfg: { admin_email: 'owner@example.com' }, messages: [msg({ body: LINK, status: 'undelivered', error_code: 30007 })] });
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('alert: ok job, emailed to admin_email, subject flags the problem, streak reset', r.ok && h.emails[0].to === 'owner@example.com' && /⚠️/.test(h.emails[0].subject) && r.detail.level === 'alert' && r.detail.filtered === 1 && r.detail.clean_days === 0, r);
}
{
  const h = harness({ cfg: { sms_delivery_check_quiet_when_clean: 'true' } });
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('quiet-when-clean: no email but state + heartbeat still written', r.ok && h.emails.length === 0 && h.writes.length === 1 && h.telem.length === 1 && r.no_retry === false && r.detail.emailed === false, r);
  const h2 = harness({ cfg: { sms_delivery_check_quiet_when_clean: 'TRUE' }, messages: [msg({ status: 'failed', error_code: 30007 })] });
  await M.smsDeliveryCheckPass(env, h2.deps);
  t('quiet-when-clean NEVER mutes an alert', h2.emails.length === 1);
}
{
  const h = harness({ readConfigRows: async () => { throw new Error('sheets 429'); } });
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('Config unreadable -> job FAILS loudly, nothing sent', !r.ok && r.errors[0].step === 'read_config' && /429/.test(r.errors[0].error) && h.emails.length === 0, r);
}
{
  const h = harness({ fetchMessages: async () => { throw new Error('Twilio Messages API HTTP 401: nope'); } });
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('Twilio failure -> job fails, failure telemetry row, no email, no state write', !r.ok && r.errors[0].step === 'fetch_twilio_messages' && h.telem.length === 1 && h.telem[0].Success === 'FALSE' && h.emails.length === 0 && h.writes.length === 0, r);
  const h2 = harness({ fetchMessages: async () => { throw new Error('x'); }, logTelemetry: async () => { throw new Error('telemetry down'); } });
  const r2 = await M.smsDeliveryCheckPass(env, h2.deps);
  t('Twilio failure + telemetry failure: both surfaced', !r2.ok && r2.warnings.some(w => /telemetry down/.test(w)), r2);
}
{
  const h = harness({ sendEmail: async () => { throw new Error('Gmail send failed (HTTP 401)'); } });
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('email failure -> job fails (retryable), no state write', !r.ok && r.errors[0].step === 'send_email' && r.no_retry === false && h.writes.length === 0, r);
  const h2 = harness({ sendEmail: async () => ({ sent: false }) });
  const r2 = await M.smsDeliveryCheckPass(env, h2.deps);
  t('email returning no confirmation is a failure, not a success', !r2.ok && r2.errors[0].step === 'send_email', r2);
  const h3 = harness({ sendEmail: async () => ({ staged: true, sent: false }) });
  t('staging stub counts as delivered (no real send on staging)', (await M.smsDeliveryCheckPass(env, h3.deps)).ok);
}
{
  const h = harness({ setConfigKey: async () => { throw new Error('sheet write 500'); } });
  const r = await M.smsDeliveryCheckPass(env, h.deps);
  t('state write failure: email already sent so job is ok but WARNS', r.ok && r.warnings.some(w => /clean-day streak/.test(w) && /500/.test(w)) && r.no_retry === true, r);
  const h2 = harness({ stateNotSticky: true });
  const r2 = await M.smsDeliveryCheckPass(env, h2.deps);
  t('state write that does not stick is caught by the re-read', r2.warnings.some(w => /did not stick/.test(w)), r2);
  const h3 = harness({ setConfigKey: async () => ({ status: 400 }) });
  t('a 4xx from setConfigKey is caught', (await M.smsDeliveryCheckPass(env, h3.deps)).warnings.some(w => /HTTP 400/.test(w)));
  const h4 = harness({ logTelemetry: async () => { throw new Error('telemetry down'); } });
  const r4 = await M.smsDeliveryCheckPass(env, h4.deps);
  t('heartbeat telemetry failure is a warning, not swallowed', r4.ok && r4.warnings.some(w => /heartbeat telemetry row failed.*telemetry down/.test(w)), r4);
  const h5 = harness({ cfg: { [M.SMS_DC_STATE_KEY]: '{corrupt' } });
  const r5 = await M.smsDeliveryCheckPass(env, h5.deps);
  t('corrupt stored state is reported and replaced', r5.ok && r5.warnings.some(w => /not valid JSON/.test(w)) && JSON.parse(h5.cfg[M.SMS_DC_STATE_KEY]).clean_days === 1, r5);
}
{
  const h = harness({ cfg: { [M.SMS_DC_STATE_KEY]: JSON.stringify({ v: 1, last_date: '2026-10-13', clean_days: 13, clean_link_texts: 40 }) } });
  await M.smsDeliveryCheckPass(env, h.deps);
  t('14th clean day with enough link texts tells Brett it can be retired', /looks resolved/.test(h.emails[0].html), h.emails[0].html.slice(-300));
}
{
  // the scheduler wrapper never throws
  let threw = false; try { await M.schedRunSmsDeliveryCheck({}); } catch (e) { threw = true; }
  t('wrapper with an unusable env does not throw (returns a failed result)', !threw);
}

console.log(`sms-delivery-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
