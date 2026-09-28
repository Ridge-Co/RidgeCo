// Estimate / proposal SMS (Sep 28 2026, FEATURE_LOG rule 201). Extracts the REAL functions from
// worker.js and runs them against in-memory fakes.
import fs from 'fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(sig) {
  const i = w.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = w.indexOf('{', w.indexOf(')', i));
  for (; j < w.length; j++) { if (w[j] === '{') d++; else if (w[j] === '}') { d--; if (!d) break; } }
  return w.slice(i, j + 1);
}
function grabConst(sig) { const i = w.indexOf(sig); if (i < 0) throw new Error('missing ' + sig); return w.slice(i, w.indexOf('\n', i)); }
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---------- pure eligibility ----------
const pure = new Function(
  grabConst('const NEEDS_INFO_RESUME_DAYS') + grabConst('const REMINDER_MIN_AGE_HOURS') + '\n' + grab('function estimatesAwaitingDecision(') + '\nreturn estimatesAwaitingDecision;')();
const NOW = new Date('2026-10-02T12:00:00Z'), SINCE = '2026-09-29T00:00:00Z';
const day = d => new Date(NOW.getTime() - d * 86400000).toISOString();
const wo = (id, extra) => Object.assign({ ID: id, Status: 'Assigned', Voided: '' }, extra || {});
const est = (wid, extra) => Object.assign({ WO_ID: wid, Version: '1', Status: 'Pending', Created_Date: day(1), Active: 'TRUE' }, extra || {});
const ids = (e, ws) => pure(e, ws, NOW, SINCE).map(x => x.wo_id);

ok(ids([est('A')], [wo('A')]).join() === 'A', 'a pending estimate awaiting a decision is included');
ok(!ids([est('A', { Status: 'Approved' })], [wo('A')]).length, 'Approved stops reminders');
ok(!ids([est('A', { Status: 'Declined' })], [wo('A')]).length, 'Declined stops reminders');
ok(!ids([est('A', { Status: 'Converted' })], [wo('A')]).length, 'pushed to proposal (Converted) stops reminders');
ok(!ids([est('A', { Created_Date: day(10) })], [wo('A')]).length, 'estimates from before the SMS cut-over never remind (old backfilled jobs stay quiet)');
ok(!ids([est('A', { Created_Date: new Date(NOW.getTime() - 3 * 3600000).toISOString() })], [wo('A')]).length, 'an estimate posted a few hours ago already got its own text — not in the digest yet');
ok(!ids([est('A', { Status: 'Needs Info', Needs_Info_Date: day(1) })], [wo('A')]).length, 'needs-info pauses reminders');
ok(!ids([est('A', { Status: 'Needs Info', Needs_Info_Date: day(2.9) })], [wo('A')]).length, 'still paused just under 3 days');
ok(ids([est('A', { Status: 'Needs Info', Needs_Info_Date: day(3.1) })], [wo('A')]).join() === 'A', 'needs-info resumes after 3 days');
ok(!ids([est('A', { Status: 'Needs Info' })], [wo('A')]).length, 'needs-info with no flag date stays paused (never guesses)');
ok(ids([est('A', { Version: '1', Status: 'Approved' }), est('A', { Version: '2', Status: 'Pending' })], [wo('A')]).join() === 'A', 'only the LATEST version counts — a revision after approval is awaiting review again');
ok(!ids([est('A', { Version: '1', Status: 'Pending' }), est('A', { Version: '2', Status: 'Approved' })], [wo('A')]).length, 'an older pending version is ignored once the latest is approved');
ok(!ids([est('A')], [wo('A', { Voided: 'TRUE' })]).length && !ids([est('A')], [wo('A', { Status: 'Paid' })]).length && !ids([est('A')], []).length, 'voided / closed / missing WOs never remind');
ok(!ids([est('A', { Active: 'FALSE' })], [wo('A')]).length, 'inactive estimate rows ignored');

// ---------- the 8am reminder runner ----------
function runner(state) {
  const sent = [], cfgWrites = [];
  const etHour = d => state.hour;
  const etDateString = () => '2026-10-02';
  const fetchConfig = async () => state.cfg;
  const fetchTab = async (_e, t) => ({ Estimates: state.ests, Work_Orders: state.wos, Vendors: [{ ID: 'V1', First_Name: 'Cesar' }] }[t] || []);
  const setConfigKey = async (_e, o) => { cfgWrites.push(o); state.cfg[o.key] = o.value; };
  const sendTemplatedSms = async (_e, o) => { sent.push(o); return { sent: true }; };
  const fmtMoney = x => (+x).toFixed(2);
  const src = grabConst('const ESTIMATE_SMS_DEFAULT_SINCE') + grabConst('const NEEDS_INFO_RESUME_DAYS') + grabConst('const REMINDER_MIN_AGE_HOURS') + '\n' + grab('function estimatesAwaitingDecision(') + '\n' + grab('async function processEstimateReminders(') + '\nreturn processEstimateReminders;';
  const fn = new Function('etHour', 'etDateString', 'fetchConfig', 'fetchTab', 'setConfigKey', 'sendTemplatedSms', 'fmtMoney', src)(etHour, etDateString, fetchConfig, fetchTab, setConfigKey, sendTemplatedSms, fmtMoney);
  return { fn, sent, cfgWrites };
}
const mk = (o) => Object.assign({ hour: 8, cfg: { estimate_sms_since: SINCE }, ests: [est('A', { Vendor_ID: 'V1', Subtotal: '1250' })], wos: [wo('A')] }, o);
{
  const r = runner(mk()); const out = await r.fn({}, NOW);
  ok(out.count === 1 && r.sent.length === 1 && r.sent[0].type === 'admin_estimate_reminder' && r.sent[0].kind === 'admin', 'sends one admin digest in the 8am ET hour');
  ok(r.sent[0].bypassQuietHours === true, 'the 8am reminder bypasses the 9am quiet-hours release (Brett asked for 8:00)');
  ok(r.sent[0].tokens.List.includes('A Cesar $1250.00') && r.sent[0].tokens.Count === 1, 'digest lists the WO, vendor and amount');
  ok(r.cfgWrites.some(x => x.key === 'estimate_reminder_last_date' && x.value === '2026-10-02'), 'claims the day before sending');
}
{ const r = runner(mk({ hour: 9 })); const out = await r.fn({}, NOW); ok(out.skipped && !r.sent.length, 'nothing at any other hour'); }
{ const r = runner(mk({ cfg: { estimate_sms_since: SINCE, estimate_reminder_last_date: '2026-10-02' } })); const out = await r.fn({}, NOW); ok(out.skipped === 'already sent today' && !r.sent.length, 'never twice in one day (two sweeps can both fire)'); }
{ const r = runner(mk({ ests: [] })); const out = await r.fn({}, NOW); ok(out.count === 0 && !r.sent.length && !r.cfgWrites.length, 'nothing awaiting -> no text and the day is not burned'); }

// ---------- templates: editable, no dollar amounts to vendors ----------
const defsSrc = w.slice(w.indexOf('const DEFAULT_MESSAGE_TEMPLATES = ['), w.indexOf('async function ensureMessageTemplates') );
const DEFS = new Function(defsSrc.slice(0, defsSrc.lastIndexOf('];') + 2).replace('const DEFAULT_MESSAGE_TEMPLATES', 'var D') + '\nreturn D;')();
const need = ['admin_estimate_new', 'admin_estimate_reminder', 'admin_proposal_signed', 'admin_deposit_paid', 'vendor_estimate_approved', 'vendor_estimate_approved_deposit', 'vendor_estimate_declined', 'vendor_estimate_needs_info', 'vendor_proposal_signed', 'vendor_deposit_paid'];
ok(need.every(t => DEFS.some(d => d.Message_Type === t && d.Channel === 'sms')), 'all ten new templates are defined');
ok(DEFS.filter(d => d.Message_Type.startsWith('vendor_') && need.includes(d.Message_Type)).every(d => !/\$|\{Amount\}|\{Subtotal\}/.test(d.Body)), 'vendor templates contain no dollar amounts');
const vd = DEFS.find(d => d.Message_Type === 'vendor_deposit_paid').Body, vs = DEFS.find(d => d.Message_Type === 'vendor_proposal_signed').Body;
ok(/DEPOSIT/.test(vd) && /deposit/i.test(vd) && !/invoice for/i.test(vd), 'deposit-paid wording says it is the DEPOSIT (distinct from the regular invoice-paid text)');
ok(/Pending deposit payment/i.test(vs), 'signed text says "pending deposit payment"');
ok(grab('async function ensureMessageTemplates(').includes('_msgTemplatesToppedUp') && grab('async function ensureMessageTemplates(').includes('never touches an existing row'), 'a live Sheet gets the new templates without overwriting Brett\'s edits');

// ---------- wiring ----------
const has = (fn, s) => grab(fn).includes(s);
ok(has('async function addEstimateVersion(', "type: 'admin_estimate_new'") && has('async function addEstimateVersion(', "(admin|hub|brett)"), 'a vendor-posted estimate texts Brett; one Brett types himself does not');
ok(has('async function approveEstimate(', 'vendor_estimate_approved') && !grab('async function approveEstimate(').includes('sendSMS(env'), 'approve texts the vendor through the gated template path (old raw amount text removed)');
ok(has('async function scopeProposalSign(', "type: 'admin_proposal_signed'") && has('async function scopeProposalSign(', "type: 'vendor_proposal_signed'"), 'signing texts Brett and the vendor');
ok(has('async function scopeDepositPaidTransition(', "type: 'admin_deposit_paid'") && has('async function scopeDepositPaidTransition(', "type: 'vendor_deposit_paid'") && has('async function scopeDepositPaidTransition(', "!== 'Pre-approved'"), 'deposit paid texts both, once (only from Pre-approved)');
ok(has('async function cronSweep(', 'processEstimateReminders') && has('async function cronSweep(', 'processDepositPaidSweep'), 'both sweeps run from the 15-minute cron');
ok(has('async function smsGatedSend(', "kind === 'admin' ? opts.admin"), "admin is a recipient kind in the gated sender (Global switch, test mode, quiet hours all still apply)");
ok(has('async function flagEstimate(', "['Pending', 'Needs Info']") && has('async function flagEstimate(', "Status: 'Declined'"), 'only a pending estimate can be flagged; decline sets Declined');
console.log(n + ' passed, 0 failed');
