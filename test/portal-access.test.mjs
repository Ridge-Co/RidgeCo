// Portal access tracking (Oct 22 2026): the Twilio verdict, the follow-up state machine, and the login stamp.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const calls = { update: [], telemetry: [], ensure: [] };
let updateThrows = false;
const mk = new Function('updateRowVerified', 'ensureColumns', 'logTelemetry',
  'const PORTAL_LOGIN_COLS = ["First_Login_Date","Last_Login_Date","Login_Count","Login_Evidence"];\n' +
  grab('smsSendVerdict') + '\n' + grab('portalAccessStatus') + '\n' + grab('stampPortalLogin') + '\nreturn { smsSendVerdict, portalAccessStatus, stampPortalLogin };');
const { smsSendVerdict, portalAccessStatus, stampPortalLogin } = mk(
  async (env, tab, id, f) => { if (updateThrows) throw new Error('Tenants row 5 did not keep: Login_Count'); calls.update.push({ tab, id, f }); },
  async (env, tab, cols) => { calls.ensure.push({ tab, cols }); },
  async (env, rec) => { calls.telemetry.push(rec); });

// ---- smsSendVerdict
t('twilio accepted = ok', smsSendVerdict({ sid: 'SM1', status: 'queued', error_code: null }).ok === true);
t('skipped (texting off) is NOT ok', smsSendVerdict({ skipped: true, reason: 'TWILIO_ENABLED not TRUE' }).ok === false);
t('skipped keeps its reason', /TWILIO_ENABLED/.test(smsSendVerdict({ skipped: true, reason: 'TWILIO_ENABLED not TRUE' }).result));
t('twilio error code is NOT ok', smsSendVerdict({ code: 21211, message: 'invalid To', status: 400 }).ok === false);
t('missing phone error is NOT ok', smsSendVerdict({ error: 'No phone number' }).ok === false);
t('staged (staging) counts as ok but flagged', (v => v.ok && v.staged)(smsSendVerdict({ staged: true })));
t('null response is NOT ok', smsSendVerdict(null).ok === false);
t('unknown shape is NOT ok', smsSendVerdict({ foo: 1 }).ok === false);

// ---- portalAccessStatus
const NOW = Date.parse('2026-10-22T12:00:00Z');
const ago = d => new Date(NOW - d * 86400000).toISOString();
let s = portalAccessStatus({}, NOW);
t('nothing sent => pin_not_sent / none', s.state === 'pin_not_sent' && s.level === 'none' && !s.pin_sent);
s = portalAccessStatus({ PIN_Sent_Date: ago(3), PIN_Send_Result: 'sent' }, NOW);
t('3 days, no login => waiting', s.level === 'waiting' && s.days_since_pin === 3 && s.pin_verified);
s = portalAccessStatus({ PIN_Sent_Date: ago(14), PIN_Send_Result: 'sent' }, NOW);
t('14 days => amber', s.level === 'amber' && s.state === 'sent_never_logged_in');
s = portalAccessStatus({ PIN_Sent_Date: ago(29) }, NOW);
t('29 days => still amber', s.level === 'amber');
s = portalAccessStatus({ PIN_Sent_Date: ago(30) }, NOW);
t('30 days => red', s.level === 'red');
s = portalAccessStatus({ PIN_Sent_Date: ago(40), First_Login_Date: ago(35), Last_Login_Date: ago(2), Login_Count: '4' }, NOW);
t('logged in once => ok, never flagged', s.level === 'ok' && s.logged_in && s.login_count === 4 && s.state === 'logged_in');
s = portalAccessStatus({ Login_Evidence: 'prior_activity' }, NOW);
t('proven prior use => logged_in without inventing a date', s.logged_in && s.first_login === '' && s.state === 'logged_in_prior_use' && s.level === 'ok');
s = portalAccessStatus({ PIN_Sent_Date: ago(20), PIN_Send_Result: 'logged_unverified' }, NOW);
t('backfilled sends are labelled unverified', s.pin_sent && !s.pin_verified && s.level === 'amber');
s = portalAccessStatus({ PIN_Sent_Date: ago(10) }, NOW, { amberDays: 7, redDays: 9 });
t('thresholds are configurable', s.level === 'red');
s = portalAccessStatus({ PIN_Sent_Date: 'garbage' }, NOW);
t('unparseable date is treated as not sent', s.state === 'pin_not_sent');
s = portalAccessStatus({ Welcome_Sent: 'TRUE', Welcome_Sent_Date: ago(5) }, NOW);
t('welcome flag read', s.welcome_sent === true);

// ---- stampPortalLogin
await stampPortalLogin({}, { tab: 'Tenants', id: '5', row: { Login_Count: '2', First_Login_Date: '2026-09-01T00:00:00.000Z' } });
t('ensures the columns first', calls.ensure[0].tab === 'Tenants' && calls.ensure[0].cols.includes('Login_Count'));
t('count goes 2 -> 3', calls.update[0].f.Login_Count === '3');
t('first login date is never overwritten', calls.update[0].f.First_Login_Date === '2026-09-01T00:00:00.000Z');
t('last login is set', /^2026|^20\d\d/.test(calls.update[0].f.Last_Login_Date));
await stampPortalLogin({}, { tab: 'Vendors', id: '9', row: {} });
t('brand-new person: count 1 and first=last', calls.update[1].f.Login_Count === '1' && calls.update[1].f.First_Login_Date === calls.update[1].f.Last_Login_Date);
updateThrows = true;
let threw = false;
try { await stampPortalLogin({}, { tab: 'Tenants', id: '5', row: {} }); } catch (e) { threw = true; }
t('a failed stamp never throws (login must still work)', !threw);
t('a failed stamp is logged loudly to telemetry', calls.telemetry.length === 1 && calls.telemetry[0].Success === 'FALSE' && calls.telemetry[0].Job_Type === 'portal_login_stamp_failed' && /Tenants 5/.test(calls.telemetry[0].Notes));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
