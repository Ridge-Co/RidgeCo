// Oct 29 2026 - "quota-calm" (queue items 215, 216, 222). Google's shared per-minute Sheets READ quota is a calm P2 `sheets_quota_busy` row that is retried; PR #421
// added that path, but four callers still filed the same failure as P0/P1. Each case here FORCES the exact failure and checks the row the failure ledger would hold.
//   (a) inspGuardFailure wrote a quota hit as Job_Type insp_booking (P1 because the text says "Quota exceeded"); the 45-minute persistent alert must stay loud.
//   (b) ensureColumns always logged ensure_columns_failed (P1); a READ-quota error is now sheets_quota_busy (P2) and still throws.
//   (c) sheetsQuotaBusyError is anchored on "Sheets API error on GET", so a quota error NESTED in a job's error text (ok:false [{"stage":...,"error":"Sheets API error..."}])
//       or behind a label ("Held cleaner texts could not be processed: ...") was missed -> P0 scheduler_job / P1 str_cleaning. ALL nested errors must be quota errors.
// (The deposit sweep's own read-quota path is in test/deposit-paid-who-to-pay.test.mjs.)  Run: node test/quota-calm.test.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 600) : ''); } };
function grab(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) { const i = src.indexOf('const ' + name + ' ='); if (i < 0) throw new Error('missing const ' + name); return src.slice(i, src.indexOf(';\n', i) + 1); }
// the real ledger classifier (same slice failure-ledger.test.mjs uses)
const ledger = new Function(
  grab('function failSevRank(') + '\n' + src.slice(src.indexOf('const FAIL_SEVERITY_BY_WHERE'), src.indexOf('// ── pure helpers (unit-tested)')) + '\n' + grab('function failSeverity(') +
  '\nreturn { failSeverity };')();
const sev = rec => ledger.failSeverity(rec.Job_Type, rec.Notes);

const QUOTA = "Sheets API error on GET /values/Scopes: Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com'";
const QUOTA_B = QUOTA.replace('/values/Scopes', '/values/Scope_Signatures');
const REAL = 'Cannot read properties of undefined (reading \'ID\')';
const WRITE_QUOTA = QUOTA.replace('on GET', 'on POST');

// ───────────────────────── (c) nested / labelled quota errors ─────────────────────────
const H = new Function(
  grab('function sheetsQuotaBusyError(') + '\n' + grabConst('SHEETS_QUOTA_LABEL_RE') + '\n' + grab('function sheetsQuotaBusyText(') + '\n' + grab('function schedErrorsAreQuotaBusy(') +
  '\n' + grab('function schedBadness(') + '\n' + grab('function schedErrText(') + '\n' + grab('async function schedUnwrap(') + '\n' + grab('function schedBodyIsQuotaBusy(') + '\n' + grab('async function schedStep(') +
  '\nreturn { sheetsQuotaBusyError, sheetsQuotaBusyText, schedErrorsAreQuotaBusy, schedBadness, schedBodyIsQuotaBusy, schedStep };')();
const nest = (...errs) => 'ok:false ' + JSON.stringify(errs.map(e => ({ stage: 'deposit_sweep_read', ref: 'scopes/signatures/milestones', error: e })));   // complete (not cut) text
const busyList = (...texts) => H.schedErrorsAreQuotaBusy(texts.map(x => ({ step: 'deposit_paid', error: x })));

console.log('nested quota errors');
t('anchored: the raw Sheets quota error is busy (unchanged)', busyList(QUOTA));
t('anchored: a real error is not busy (unchanged)', !busyList(REAL));
t('anchored: a quota error on a WRITE is not a harmless read-busy (unchanged)', !busyList(WRITE_QUOTA));
t('NESTED: ok:false [{"stage":"deposit_sweep_read","error":"Sheets API error on GET ..."}] is busy (it used to stay P0)', busyList(nest(QUOTA)), nest(QUOTA));
t('NESTED: "N error(s): [...]" form is busy', busyList('2 error(s): ' + JSON.stringify([{ step: 'a', error: QUOTA }, { step: 'b', error: QUOTA_B }])));
t('NESTED: two quota errors in one list are busy', busyList(nest(QUOTA, QUOTA_B)));
t('NESTED: a quota message that itself contains escaped double quotes is still read correctly', busyList(nest(QUOTA + ' (project "abc")')) && !busyList(nest(QUOTA + ' (project "abc")', REAL)));
t('MIXED: one quota error + one real error stays loud (P0)', !busyList(nest(QUOTA, REAL)), nest(QUOTA, REAL));
t('MIXED: the real error FIRST stays loud too', !busyList(nest(REAL, QUOTA)));
t('MIXED: quota READ + quota WRITE stays loud', !busyList(nest(QUOTA, WRITE_QUOTA)));
t('MIXED across entries: one busy entry + one real entry stays loud', H.schedErrorsAreQuotaBusy([{ step: 'x', error: nest(QUOTA) }, { step: 'y', error: REAL }]) === false);
t('two busy entries are busy', H.schedErrorsAreQuotaBusy([{ step: 'x', error: nest(QUOTA) }, { step: 'y', error: QUOTA_B }]) === true);
t('a telemetry write that failed on a READ quota (labelled) is busy; on a WRITE it is not', busyList(nest('could not write Ops_Telemetry: ' + QUOTA)) && !busyList(nest('could not write Ops_Telemetry: ' + WRITE_QUOTA)));
t('CUT OFF at the scheduler\'s 300 characters: the text alone is NOT assumed busy (a second, real error may be hidden after the cut)', (() => { const s = nest(QUOTA, QUOTA_B).slice(0, 300); return !/[\]\x7d]\s*$/.test(s) && !busyList(s); })());
t('...including a cut that looks all-quota but lost a real second entry', !busyList(nest(QUOTA, REAL).slice(0, 285)));
t('an "error" value we cannot read (object / null) is not assumed busy', !busyList('ok:false [{"stage":"a","error":{"code":429}}]') && !busyList('ok:false [{"stage":"a","error":null}]') && !busyList('ok:false [{"error":"' + QUOTA + '"},{"error":{"x":1}}]'));
t('the not_found form (scope 11) is untouched: quota-looking words in a not_found list are NOT busy', !busyList('ok:false ' + JSON.stringify({ not_found: ['scope 11 WO-1253 ' + QUOTA] })));
t('empty / blank / non-string inputs are not busy', !busyList('') && !busyList(undefined) && !H.schedErrorsAreQuotaBusy([]) && !H.schedErrorsAreQuotaBusy(null));
t('LABEL: "Held cleaner texts could not be processed: Sheets API error on GET ..." is busy', H.sheetsQuotaBusyText('Held cleaner texts could not be processed: ' + QUOTA));
t('LABEL: the same label with a real error / a write quota is NOT busy', !H.sheetsQuotaBusyText('Held cleaner texts could not be processed: ' + REAL) && !H.sheetsQuotaBusyText('Held cleaner texts could not be processed: ' + WRITE_QUOTA));
t('LABEL: a label that carries a second Sheets error is NOT busy', !H.sheetsQuotaBusyText('Held cleaner texts could not be processed: ' + QUOTA + ' | Sheets API error on POST /values:batchUpdate: The caller does not have permission'));
t('an Error object works too', H.sheetsQuotaBusyText(new Error(QUOTA)) && !H.sheetsQuotaBusyText(new Error(REAL)));
t('sheetsQuotaBusyError itself is unchanged (still anchored)', H.sheetsQuotaBusyError(QUOTA) && !H.sheetsQuotaBusyError('Held cleaner texts could not be processed: ' + QUOTA));

console.log('scheduler wiring');
{
  // the real schedBadness turns a quota-busy job answer into the raw Sheets text; anything with an errors[] entry stands aside
  const qb = { ok: false, quota_busy: true, reason: QUOTA, errors: [] };
  t('schedBadness: {ok:false, quota_busy:true, reason} -> the raw Sheets error (so the scheduler sees "busy")', H.schedBadness(200, qb) === QUOTA.slice(0, 300) && H.schedErrorsAreQuotaBusy([{ step: 'deposit_paid', error: H.schedBadness(200, qb) }]));
  t('schedBadness: quota_busy WITH an errors[] entry does not hide that entry', /telemetry/.test(H.schedBadness(200, { ok: false, quota_busy: true, reason: QUOTA, errors: [{ stage: 'telemetry', error: 'could not write Ops_Telemetry: boom' }] })) && !H.schedErrorsAreQuotaBusy([{ step: 'd', error: H.schedBadness(200, { ok: false, quota_busy: true, reason: QUOTA, errors: [{ stage: 'telemetry', error: 'could not write Ops_Telemetry: boom' }] }) }]));
  t('schedBadness: a plain ok:false with a reason (no quota flag) is unchanged', /ok:false/.test(H.schedBadness(200, { ok: false, reason: 'because' })));
  t('schedBadness: ok:false with real errors[] is unchanged and not busy', !H.schedErrorsAreQuotaBusy([{ step: 'd', error: H.schedBadness(200, { ok: false, errors: [{ stage: 'x', error: REAL }] }) }]));
  // the REAL production shape: Google's full message (~250 chars) wrapped by logAndCollectError, then cut at 300 by schedBadness
  const REALQ = QUOTA + " for consumer 'project_number:664428332384'. Request a higher quota or wait.";
  const step = async (result) => { const errors = []; await H.schedStep('deposit_paid', async () => result, errors); return errors; };
  {
    let errs = await step({ ok: false, errors: [{ stage: 'deposit_sweep_read', ref: 'scopes/signatures/milestones', error: REALQ }] });
    t('schedStep: a step whose errors[] are ALL read-quota (text is cut at 300 chars) is flagged quota_busy and the scheduler sees "busy"', errs.length === 1 && errs[0].quota_busy === true && errs[0].error.length <= 300 && H.schedErrorsAreQuotaBusy(errs), errs);
    errs = await step({ ok: false, errors: [{ stage: 'a', error: REALQ }, { stage: 'b', error: REAL }] });
    t('schedStep: ONE real error in the list means NOT flagged, whatever the cut-off text shows (stays P0)', errs.length === 1 && !errs[0].quota_busy && !H.schedErrorsAreQuotaBusy(errs), errs);
    errs = await step({ ok: false, errors: [{ stage: 'a', error: REAL }, { stage: 'b', error: REALQ }] });
    t('schedStep: ...real error first too', !H.schedErrorsAreQuotaBusy(errs));
    errs = await step({ ok: false, errors: [{ stage: 'a', error: REALQ }], not_found: [{ scope: '11', wo_id: 'WO-1253', reason: 'no deposit invoice' }] });
    t('schedStep: all-quota errors but a scope-11 style not_found alongside is NOT busy (not_found stays loud)', !H.schedErrorsAreQuotaBusy(errs), errs);
    errs = await step({ ok: false, errors: [{ stage: 'a', error: REALQ }], failed: 2 });
    t('schedStep: all-quota errors but other items FAILED is NOT busy', !H.schedErrorsAreQuotaBusy(errs));
    errs = await step({ ok: false, errors: [{ stage: 'a', error: WRITE_QUOTA }] });
    t('schedStep: a WRITE quota error is NOT busy', !H.schedErrorsAreQuotaBusy(errs));
    errs = await step({ error: REALQ });
    t('schedStep: {error: <raw quota text>} is busy through the text check (no flag needed)', errs.length === 1 && H.schedErrorsAreQuotaBusy(errs));
    errs = await step({ ok: false, quota_busy: true, reason: REALQ, errors: [] });
    t('schedStep: the deposit sweep\'s calm answer {ok:false, quota_busy, reason, errors:[]} is flagged busy', errs.length === 1 && errs[0].quota_busy === true && H.schedErrorsAreQuotaBusy(errs), errs);
    errs = await step({ ok: false, quota_busy: true, reason: REAL, errors: [] });
    t('schedStep: ...but quota_busy with a reason that is not a quota error is NOT trusted', !H.schedErrorsAreQuotaBusy(errs), errs);
    const errs2 = []; await H.schedStep('x', async () => { throw new Error(REALQ); }, errs2);
    t('schedStep: a THROWN read-quota error is busy', H.schedErrorsAreQuotaBusy(errs2) && errs2[0].quota_busy === undefined, errs2);
    const errs3 = []; await H.schedStep('x', async () => { throw new Error(REAL); }, errs3);
    t('schedStep: a thrown real error is not', !H.schedErrorsAreQuotaBusy(errs3));
    errs = await step({ ok: true, errors: [] });
    t('happy path: an ok step reports nothing', errs.length === 0);
  }
  const d = src.slice(src.indexOf('const quotaBusy = schedErrorsAreQuotaBusy(errors);'), src.indexOf('// Record the outcome: fresh read-modify-write'));
  t('dispatcher: a busy run files sheets_quota_busy and does NOT page (alertAdminOnFailure only when not busy)', /Job_Type: quotaBusy \? 'sheets_quota_busy' : 'scheduler_job'/.test(d) && /if \(!quotaBusy\) \{\s*try \{ const a = await alertAdminOnFailure/.test(d));
  // the ledger row this produces
  const busyRow = { Job_Type: 'sheets_quota_busy', Notes: 'deposit_paid: ' + nest(QUOTA) };
  const oldRow = { Job_Type: 'scheduler_job', Notes: 'deposit_paid: ' + nest(QUOTA) };
  t('ledger: the busy row is P2; the old scheduler_job row for the same text was P0', sev(busyRow) === 'P2' && sev(oldRow) === 'P0', [sev(busyRow), sev(oldRow)]);
}

// ───────────────────────── strSystemAlert: the labelled held-texts alert ─────────────────────────
console.log('strSystemAlert');
{
  const tel = [], sent = [];
  const mk = () => new Function('logTelemetry', 'fetchConfig', 'strSendBrett', 'console',
    'const __strSysAt = {};\n' + grab('function sheetsQuotaBusyError(') + '\n' + grabConst('SHEETS_QUOTA_LABEL_RE') + '\n' + grab('function sheetsQuotaBusyText(') + '\n' + grab('async function strSystemAlert(') +
    '\nreturn strSystemAlert;')(async (_e, rec) => { tel.push(rec); }, async () => ({ admin_phone: '+15555550100' }), async (...a) => { sent.push(a); return { ok: true, log: [] }; }, { error() {}, warn() {}, log() {} });
  const alert = mk();
  const MSG = 'Held cleaner texts could not be processed: ' + QUOTA;
  await alert({}, 'held_texts', MSG);
  t('held cleaner texts + read quota: ONE row, sheets_quota_busy (P2), Brett not texted (it used to be str_cleaning P1 + a text)', tel.length === 1 && tel[0].Job_Type === 'sheets_quota_busy' && sev(tel[0]) === 'P2' && sent.length === 0, { tel, sent: sent.length });
  t('control: the same text filed as str_cleaning was P1', ledger.failSeverity('str_cleaning', MSG) === 'P1');
  tel.length = 0; sent.length = 0;
  await alert({}, 'held_texts', 'Held cleaner texts could not be processed: ' + REAL);
  t('control: a real held-texts failure is still str_cleaning and still tells Brett', tel.length === 1 && tel[0].Job_Type === 'str_cleaning' && sent.length === 1, { tel, sent: sent.length });
  tel.length = 0; sent.length = 0;
  await alert({}, 'held_texts2', 'Held cleaner texts could not be processed: ' + WRITE_QUOTA);
  t('control: a quota error on a WRITE under that label is still loud', tel[0] && tel[0].Job_Type === 'str_cleaning' && sent.length === 1);
}

// ───────────────────────── (a) inspGuardFailure ─────────────────────────
console.log('inspGuardFailure');
{
  const mkGuard = (state) => new Function('fetchConfig', 'failSetConfig', 'logTelemetry', 'inspAlert', 'console', 'Date',
    grabConst('INSP_GUARD_QUOTA_GRACE_MS') + '\n' + grab('function inspIsSheetsQuotaErr(') + '\n' + grab('function inspIsTransientFeedErr(') + '\n' + grab('async function inspGuardFailure(') + '\nreturn inspGuardFailure;')(
    async () => ({ STR_GUARD_FAIL_SINCE: state.since }), async (_e, k, v) => { state.setKey.push([k, v]); }, async (_e, rec) => { state.tel.push(rec); }, async (_e, kind, msg) => { state.alerts.push([kind, msg]); },
    { error() {}, warn() {}, log() {} }, class extends Date { static now() { return state.now; } });
  const NOW = Date.parse('2026-10-29T15:00:00Z');
  // first hit: no outbreak recorded yet
  let st = { since: '', now: NOW, tel: [], alerts: [], setKey: [] };
  await mkGuard(st)({}, 'str_guard_sheet', new Error(QUOTA));
  t('first quota hit: ONE row, sheets_quota_busy (P2), endpoint still names the guard, no alert', st.tel.length === 1 && st.tel[0].Job_Type === 'sheets_quota_busy' && /^insp-book\/str_guard_sheet_quota$/.test(st.tel[0].Skill_Or_Endpoint) && sev(st.tel[0]) === 'P2' && !st.alerts.length, st);
  t('...and the outage start is recorded (STR_GUARD_FAIL_SINCE)', st.setKey.length === 1 && st.setKey[0][0] === 'STR_GUARD_FAIL_SINCE');
  t('control: the OLD row (insp_booking + "Quota exceeded") was a P1', ledger.failSeverity('insp_booking', 'Sheets read quota hit, will retry next tick (failing 0 min): ' + QUOTA) === 'P1');
  // 20 minutes in: still calm
  st = { since: new Date(NOW - 20 * 60000).toISOString(), now: NOW, tel: [], alerts: [], setKey: [] };
  await mkGuard(st)({}, 'str_guard_sheet', new Error(QUOTA));
  t('20 minutes into an outage: still the calm row, no alert', st.tel[0].Job_Type === 'sheets_quota_busy' && !st.alerts.length && /failing 20 min/.test(st.tel[0].Notes), st);
  // 45+ minutes: the persistent alert (SMS + email via inspAlert) is KEPT
  st = { since: new Date(NOW - 46 * 60000).toISOString(), now: NOW, tel: [], alerts: [], setKey: [] };
  await mkGuard(st)({}, 'str_guard_sheet', new Error(QUOTA));
  t('46 minutes into an outage: the loud persistent alert STILL fires (kind str_guard_sheet_persistent)', st.alerts.length === 1 && st.alerts[0][0] === 'str_guard_sheet_persistent' && /46 minutes/.test(st.alerts[0][1]) && /Sheets read quota/.test(st.alerts[0][1]), st.alerts);
  t('...and the calm row is written first', st.tel.length === 1 && st.tel[0].Job_Type === 'sheets_quota_busy');
  // a real problem: unchanged, alerts at once
  st = { since: '', now: NOW, tel: [], alerts: [], setKey: [] };
  await mkGuard(st)({}, 'str_guard_sheet', new Error('Sheets API error on GET /values/Insp_Bookings: The caller does not have permission'));
  t('control: a real guard failure alerts immediately and files no quota row', st.alerts.length === 1 && st.alerts[0][0] === 'str_guard_sheet' && !st.tel.length, st);
  // a bookings-feed outage is not a Sheets quota: it keeps its own insp_booking row
  st = { since: '', now: NOW, tel: [], alerts: [], setKey: [] };
  await mkGuard(st)({}, 'str_guard_unavailable', new Error('Cleaning-coverage check could not run: Bookings feed (https://x/…(link hidden)) answered 504.'));
  t('control: a bookings-feed 504 keeps the insp_booking row (not relabelled as a Sheets quota)', st.tel.length === 1 && st.tel[0].Job_Type === 'insp_booking' && /_feed$/.test(st.tel[0].Skill_Or_Endpoint) && !st.alerts.length, st.tel);
}

// ───────────────────────── (b) ensureColumns ─────────────────────────
console.log('ensureColumns');
{
  const mkEC = (sheetsRequest, tel) => new Function('sheetsRequest', 'logTelemetry', 'TELEMETRY_TAB',
    grab('function col(index)') + '\n' + grab('async function ensureColumnsInner(') + '\n' + grab('async function ensureColumns(') + '\n' + grab('function sheetsQuotaBusyError(') + '\nreturn ensureColumns;')(
    sheetsRequest, async (_e, rec) => { tel.push(rec); }, 'Ops_Telemetry');
  const tel = [];
  const readQuota = mkEC(async (env, method) => { if (method === 'GET') throw new Error(QUOTA.replace('/values/Scopes', '/values/Receipts')); return {}; }, tel);
  let thrown = null; try { await readQuota({}, 'Receipts', ['Payment_Source']); } catch (e) { thrown = e; }
  t('READ quota in the header check: still THROWS (the caller retries / reports)', thrown && /Quota exceeded/.test(thrown.message), thrown && thrown.message);
  t('...and files ONE calm row: sheets_quota_busy (P2), naming the tab and columns', tel.length === 1 && tel[0].Job_Type === 'sheets_quota_busy' && tel[0].Skill_Or_Endpoint === 'ensure_columns/Receipts' && /Payment_Source/.test(tel[0].Notes) && tel[0].Success === 'FALSE' && sev(tel[0]) === 'P2', tel);
  t('control: the old row (ensure_columns_failed + the quota text) was a P1', ledger.failSeverity('ensure_columns_failed', 'columns=Payment_Source err=' + QUOTA) === 'P1');
  tel.length = 0;
  const readPerm = mkEC(async (env, method) => { if (method === 'GET') throw new Error('Sheets API error on GET /values/Receipts: The caller does not have permission'); return {}; }, tel);
  thrown = null; try { await readPerm({}, 'Receipts', ['Payment_Source']); } catch (e) { thrown = e; }
  t('control: a NON-quota read failure still files ensure_columns_failed under the tab name and still throws', thrown && tel.length === 1 && tel[0].Job_Type === 'ensure_columns_failed' && tel[0].Skill_Or_Endpoint === 'Receipts', tel);
  tel.length = 0;
  const writeQuota = mkEC(async (env, method, path) => { if (method === 'GET' && !path.startsWith('?')) return { values: [['ID', 'Name'], ['1', 'x']] }; throw new Error(WRITE_QUOTA.replace('/values/Scopes', '/values:batchUpdate')); }, tel);
  thrown = null; try { await writeQuota({}, 'Receipts', ['Payment_Source']); } catch (e) { thrown = e; }
  t('control: a quota error on the header WRITE is not a read-busy: ensure_columns_failed, throws', thrown && tel.length === 1 && tel[0].Job_Type === 'ensure_columns_failed', tel);
  tel.length = 0;
  const okEC = mkEC(async () => ({ values: [['ID', 'Payment_Source']] }), tel);
  await okEC({}, 'Receipts', ['Payment_Source']);
  t('happy path: nothing is reported', tel.length === 0);
  tel.length = 0;
  // the Telemetry tab itself must still never recurse
  const telTab = mkEC(async () => { throw new Error(QUOTA); }, tel);
  thrown = null; try { await telTab({}, 'Ops_Telemetry', ['X']); } catch (e) { thrown = e; }
  t('control: the Telemetry tab\'s own failure still does not call logTelemetry (no recursion)', thrown && tel.length === 0);
  // a harness that slices ensureColumns out WITHOUT the quota helper keeps the old row (the typeof guard)
  const noHelper = new Function('sheetsRequest', 'logTelemetry', 'TELEMETRY_TAB', grab('function col(index)') + '\n' + grab('async function ensureColumnsInner(') + '\n' + grab('async function ensureColumns(') + '\nreturn ensureColumns;')(async () => { throw new Error(QUOTA); }, async (_e, r) => { tel.push(r); }, 'Ops_Telemetry');
  thrown = null; try { await noHelper({}, 'Receipts', ['A']); } catch (e) { thrown = e; }
  t('sliced out without the helper: no ReferenceError, original error still thrown, old row', thrown && /Quota exceeded/.test(thrown.message) && tel.length === 1 && tel[0].Job_Type === 'ensure_columns_failed', tel);
}

console.log(`quota-calm: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
