// Deposit-paid transition for milestone-billed scopes + never-silent sweep (Oct 1 2026, WO-1227 / Scope 8).
// Extracts the REAL functions verbatim out of worker.js and runs them against in-memory fakes (same
// convention as test/wo-deposit.test.mjs). QuickBooks / Sheets / SMS / telemetry boundaries are mocked.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
const isrc = fs.readFileSync('index.html', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };

const src = [
  'function alertDebounceOk(', 'function firstMilestoneForSignature(', 'function depositMilestoneForSignature(', 'function resolveScopeDepositInvoice(',
  'function classifyMissingDeposit(', 'async function claimDepositTextMarker(',
  'async function scopeDepositInvoiceId(', 'async function scopeDepositPaidTransition(', 'async function logAndCollectError(',
  'async function depositSweepSurface(', 'async function processDepositPaidSweep(',
].map(s => grab(wsrc, s)).join('\n');

function makeWorld(opts = {}) {
  const w = {
    scopes: [{ ID: '8', WO_ID: 'WO-1227', Vendor_ID: 'V1', Approval_Stage: 'Pre-approved', Active: 'TRUE' }],
    sigs: [{ ID: 'S8', Scope_ID: '8', Active: 'TRUE', QB_Invoice_ID: '', Signed_TS: opts.signedTS || '2026-09-30T00:00:00Z' }],
    milestones: [
      { ID: 'M2', Scope_ID: '8', Signature_ID: 'S8', Sequence: '2', QB_Invoice_ID: '7902', Active: 'TRUE' },
      { ID: 'M1', Scope_ID: '8', Signature_ID: 'S8', Sequence: '1', QB_Invoice_ID: '7901', Active: 'TRUE' },
    ],
    invoices: { '7901': { Id: '7901', TotalAmt: 500, Balance: 0 }, '7902': { Id: '7902', TotalAmt: 500, Balance: 500 } },
    cfg: { admin_phone: '+15550001111' }, telemetry: [], sms: [], templated: [], cfgWrites: [], qbCalls: [],
    failTelemetry: false, qbThrow: false, tokenThrow: false, smsResult: { sid: 'x' }, templatedResult: { sent: true }, ctxThrow: false,
    cfgWriteFails: false, scopeReads: 0, ...opts,
  };
  const env = {};
  const ctx = {
    fetchTab: async (e, tab) => {
      if (tab === 'Scopes') { w.scopeReads++; if (w.flipAfterReads && w.scopeReads > w.flipAfterReads) w.scopes.forEach(x => { x.Approval_Stage = 'Approved'; }); }
      return ({ Scopes: w.scopes, Scope_Signatures: w.sigs, Payment_Milestones: w.milestones }[tab] || []);
    },
    invalidateTabCache: () => {},
    sheetsRequest: async () => ({ values: Object.entries(w.cfg).map(([k, v]) => [k, v]) }),
    paymentMilestonesTab: async () => {},
    fetchConfig: async () => w.cfg,
    setConfigKey: async (e, { key, value }) => { if (w.cfgWriteFails) throw new Error('config write boom'); w.cfgWrites.push(key); w.cfg[key] = value; return {}; },
    qbAccessToken: async () => { if (w.tokenThrow) throw new Error('token boom'); return 'tok'; },
    qbApi: async (e, path) => { w.qbCalls.push(path); if (w.qbThrow) throw new Error('qb boom'); const id = decodeURIComponent(path.split('?')[0].split('/')[1]); return w.invoices[id] ? { Invoice: w.invoices[id] } : {}; },
    setApprovalStage: async (e, { scopeId, stage }) => { const s = w.scopes.find(x => x.ID === String(scopeId)); if (w.stageWriteFails) return false; s.Approval_Stage = stage; return true; },
    estimateSmsContext: async () => { if (w.ctxThrow) throw new Error('ctx boom'); return { property: 'P', address: 'A', vendor: { Phone: '+1555' } }; },
    sendTemplatedSms: async (e, o) => { w.templated.push(o.type); return typeof w.templatedResult === 'function' ? w.templatedResult(o) : w.templatedResult; },
    vendorFirstName: () => 'V',
    logTelemetry: async (e, rec) => { if (w.failTelemetry) throw new Error('sheet down'); w.telemetry.push(rec); },
    sendSMS: async (e, to, msg) => { w.sms.push(msg); return w.smsResult; },
    ESTIMATE_SMS_DEFAULT_SINCE: '2026-09-29T00:00:00.000Z',
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, `const _depositTransitionInFlight = new Set();\n${src}\nreturn { processDepositPaidSweep, resolveScopeDepositInvoice, scopeDepositPaidTransition, classifyMissingDeposit };`);
  return { w, env, api: fn(...names.map(n => ctx[n])) };
}

// ── pure resolution ───────────────────────────────────────────────────────────
{
  const { api, w } = makeWorld();
  let r = api.resolveScopeDepositInvoice(w.sigs, w.milestones, '8');
  t('milestone fallback picks earliest sequence', r.invoiceId === '7901' && r.source === 'milestone' && r.milestone.ID === 'M1');
  r = api.resolveScopeDepositInvoice([{ ...w.sigs[0], QB_Invoice_ID: '555' }], w.milestones, '8');
  t('signature invoice wins over milestones', r.invoiceId === '555' && r.source === 'signature');
  r = api.resolveScopeDepositInvoice(w.sigs, [], '8');
  t('no invoice anywhere -> empty (sig present)', r.invoiceId === '' && !!r.sig);
  r = api.resolveScopeDepositInvoice([], w.milestones, '8');
  t('no signature -> sig null', r.sig === null && r.invoiceId === '');
  r = api.resolveScopeDepositInvoice(w.sigs, [{ ...w.milestones[1], Active: 'FALSE' }, { ...w.milestones[0], QB_Invoice_ID: '  ' }], '8');
  t('inactive / blank-invoice milestones ignored', r.invoiceId === '');
}

// ── sweep: milestone deposit paid -> transitions once, texts once ───────────────
{
  const { api, w, env } = makeWorld();
  const r1 = await api.processDepositPaidSweep(env);
  t('checked 1', r1.checked === 1);
  t('transitioned scope 8 via milestone', r1.transitioned.length === 1 && r1.transitioned[0].scope === '8' && r1.transitioned[0].source === 'milestone' && r1.transitioned[0].invoice_id === '7901');
  t('scope now Approved', w.scopes[0].Approval_Stage === 'Approved');
  t('admin + vendor texts sent exactly once', w.templated.join() === 'admin_deposit_paid,vendor_deposit_paid');
  t('no errors/not_found; ok', r1.ok === true && !r1.errors.length && !r1.not_found.length);
  const r2 = await api.processDepositPaidSweep(env);
  t('second sweep is a no-op (no double text)', r2.checked === 0 && !r2.transitioned.length && w.templated.length === 2);
}
// unpaid deposit: untouched
{
  const { api, w, env } = makeWorld({ invoices: { '7901': { Id: '7901', TotalAmt: 500, Balance: 500 } } });
  const r = await api.processDepositPaidSweep(env);
  t('unpaid deposit stays Pre-approved', w.scopes[0].Approval_Stage === 'Pre-approved' && !r.transitioned.length && r.ok);
}
// not_found: no invoice anywhere
{
  const { api, w, env } = makeWorld({ milestones: [] });
  const r = await api.processDepositPaidSweep(env);
  t('not_found reported', r.not_found.length === 1 && r.not_found[0].scope === '8' && r.not_found[0].wo_id === 'WO-1227' && /no deposit invoice/.test(r.not_found[0].reason) && r.ok === false);
  t('not_found -> telemetry row', w.telemetry.length === 1 && w.telemetry[0].Job_Type === 'deposit_sweep_not_found' && w.telemetry[0].Success === 'FALSE' && /scope=8 wo=WO-1227/.test(w.telemetry[0].Notes));
  t('not_found -> one admin SMS + day marker', w.sms.length === 1 && w.cfgWrites.includes('deposit_sweep_alert_not_found_8'));
  const r2 = await api.processDepositPaidSweep(env);
  t('2nd sweep same day still reports in result', r2.not_found.length === 1);
  t('...but telemetry + SMS rate-limited to once/day/scope', w.telemetry.length === 1 && w.sms.length === 1);
}
// not_found: QB has no such invoice
{
  const { api, w, env } = makeWorld({ invoices: {} });
  const r = await api.processDepositPaidSweep(env);
  t('QB missing invoice -> not_found', r.not_found.length === 1 && r.not_found[0].invoice_id === '7901' && /QuickBooks returned no invoice/.test(r.not_found[0].reason));
}
// Pre-approved but no signature
{
  const { api, w, env } = makeWorld({ sigs: [] });
  const r = await api.processDepositPaidSweep(env);
  t('no active signature -> not_found', r.not_found.length === 1 && /no active signature/.test(r.not_found[0].reason));
}
// errors are never swallowed
{
  const { api, w, env } = makeWorld({ qbThrow: true });
  const r = await api.processDepositPaidSweep(env);
  t('QB throw -> errors[] + telemetry', r.errors.length === 1 && /qb boom/.test(r.errors[0].error) && r.ok === false && w.telemetry.some(x => x.Job_Type === 'deposit_sweep_error' && /qb boom/.test(x.Notes)));
}
{
  const { api, w, env } = makeWorld({ tokenThrow: true });
  const r = await api.processDepositPaidSweep(env);
  t('QB token failure surfaced per scope', r.errors.length >= 1 && r.errors[0].stage === 'qb_token' && w.telemetry.length >= 1);
}
{
  const { api, w, env } = makeWorld({ stageWriteFails: true });
  const r = await api.processDepositPaidSweep(env);
  t('failed Approval_Stage write -> error, NO texts sent', r.errors.length === 1 && /did not move to Approved/.test(r.errors[0].error) && w.templated.length === 0 && !r.transitioned.length);
}
{
  const { api, w, env } = makeWorld({ failTelemetry: true, qbThrow: true });
  const r = await api.processDepositPaidSweep(env);
  t('telemetry failure is itself reported in errors', r.errors.some(e => e.stage === 'telemetry') && r.errors.some(e => /qb boom/.test(e.error)));
}


// ── review round 2 (Oct 1 2026) ─────────────────────────────────────────────────
// (5) deposit = lowest-Sequence milestone ONLY; never falls through to milestone 2
{
  const { api, w } = makeWorld();
  const ms = [{ ID: 'M1', Signature_ID: 'S8', Sequence: '1', QB_Invoice_ID: '', Active: 'TRUE', Status: 'pending' }, { ID: 'M2', Signature_ID: 'S8', Sequence: '2', QB_Invoice_ID: '7902', Active: 'TRUE' }];
  const r = api.resolveScopeDepositInvoice(w.sigs, ms, '8');
  t('milestone 1 without invoice does NOT fall through to milestone 2', r.invoiceId === '' && r.first && r.first.ID === 'M1');
  const r2 = api.resolveScopeDepositInvoice(w.sigs, [{ ...ms[0], Active: 'FALSE' }, ms[1]], '8');
  t('inactive milestone 1 is skipped: milestone 2 becomes the first', r2.invoiceId === '7902');
}
// (4) classification + fresh signing -> awaiting only (no alarm); old / billed-without-invoice -> alarm
{
  const { api, w, env } = makeWorld({ milestones: [], signedTS: new Date().toISOString() });
  const r = await api.processDepositPaidSweep(env);
  t('fresh signing without invoice -> awaiting_invoice, not not_found', r.awaiting_invoice.length === 1 && r.awaiting_invoice[0].scope === '8' && !r.not_found.length);
  t('fresh signing: no SMS, no telemetry, no alarm', w.sms.length === 0 && w.telemetry.length === 0 && r.ok === true && !r.errors.length);
}
{
  const { api, w, env } = makeWorld({ milestones: [{ ID: 'M1', Signature_ID: 'S8', Sequence: '1', QB_Invoice_ID: '', Active: 'TRUE', Status: 'billed' }], signedTS: new Date().toISOString() });
  const r = await api.processDepositPaidSweep(env);
  t('fresh but milestone 1 billed with no invoice id -> alarm immediately', r.not_found.length === 1 && /marked billed/.test(r.not_found[0].reason) && w.sms.length === 1);
}
{
  const { api } = makeWorld();
  const now = Date.parse('2026-10-02T12:00:00Z');
  t('classify: 23h old is awaiting', api.classifyMissingDeposit({ Signed_TS: '2026-10-01T13:00:00Z' }, null, now).alarm === false);
  t('classify: 25h old alarms', api.classifyMissingDeposit({ Signed_TS: '2026-10-01T11:00:00Z' }, null, now).alarm === true);
  t('classify: unreadable signing time alarms (never hidden)', api.classifyMissingDeposit({ Signed_TS: '' }, null, now).alarm === true);
}
// (1) alert SMS that did not really send must not set the 24h marker
{
  const { api, w, env } = makeWorld({ milestones: [], smsResult: { skipped: true, reason: 'TWILIO_ENABLED not TRUE' } });
  const r = await api.processDepositPaidSweep(env);
  t('SMS skipped -> reported in errors (alert_sms), no marker', r.errors.some(e => e.stage === 'alert_sms' && /skipped/.test(e.error)) && !w.cfgWrites.includes('deposit_sweep_alert_not_found_8') && r.ok === false);
  t('SMS skipped -> telemetry row for alert_not_sent', w.telemetry.some(x => x.Job_Type === 'deposit_sweep_alert_not_sent'));
  w.smsResult = { sid: 'y' };
  const r2 = await api.processDepositPaidSweep(env);
  t('next sweep retries the SMS and only then sets the marker', w.sms.length === 2 && w.cfgWrites.includes('deposit_sweep_alert_not_found_8') && !r2.errors.length);
  await api.processDepositPaidSweep(env);
  t('...then once/day again', w.sms.length === 2);
}
{
  const { api, w, env } = makeWorld({ milestones: [], cfg: {} });
  const r = await api.processDepositPaidSweep(env);
  t('no admin_phone -> error surfaced, no marker', r.errors.some(e => e.stage === 'alert_sms' && /admin_phone/.test(e.error)) && !w.cfgWrites.includes('deposit_sweep_alert_not_found_8'));
}
{
  const { api, w, env } = makeWorld({ milestones: [], smsResult: { error: 'twilio 21608' } });
  const r = await api.processDepositPaidSweep(env);
  t('SMS error result -> surfaced', r.errors.some(e => e.stage === 'alert_sms' && /21608/.test(e.error)));
}
// (2) deposit-paid text results are checked
for (const [label, res] of [['sent:false gate-blocked', { sent: false, gate_snapshot: {} }], ['error', { sent: false, error: 'twilio down' }], ['undefined', undefined]]) {
  const { api, w, env } = makeWorld({ templatedResult: res });
  const r = await api.processDepositPaidSweep(env);
  t(`text ${label}: scope still Approved, texted:false, failures listed`, w.scopes[0].Approval_Stage === 'Approved' && r.transitioned[0].texted === false && r.transitioned[0].text_errors.length === 2 && r.errors.filter(e => e.stage === 'deposit_paid_text_failed').length === 2);
  t(`text ${label}: telemetry rows written`, w.telemetry.filter(x => x.Job_Type === 'deposit_paid_text_failed').length === 2);
}
{
  const { api, w, env } = makeWorld({ templatedResult: { sent: false, held_for_quiet_hours: true } });
  const r = await api.processDepositPaidSweep(env);
  t('held for quiet hours counts as queued, not a failure', r.transitioned[0].texted === true && !r.errors.length);
}
{
  const { api, w, env } = makeWorld({ ctxThrow: true });
  const r = await api.processDepositPaidSweep(env);
  t('estimateSmsContext throw -> approved but texts not sent, surfaced', w.scopes[0].Approval_Stage === 'Approved' && r.transitioned[0].texted === false && r.errors.some(e => e.stage === 'deposit_paid_text_context' && /approved but texts not sent/.test(e.ref)) && w.templated.length === 0);
}
// (3) cross-isolate claim marker + stage re-read
{
  const { api, w, env } = makeWorld();
  await api.processDepositPaidSweep(env);
  t('claim marker deposit_paid_text_8 written before texting', w.cfgWrites.includes('deposit_paid_text_8'));
}
{
  const { api, w, env } = makeWorld({ cfg: { admin_phone: '+1555', deposit_paid_text_8: '2026-10-01T00:00:00Z' } });
  const r = await api.processDepositPaidSweep(env);
  t('marker already set (other isolate texted) -> Approved but NO texts', w.scopes[0].Approval_Stage === 'Approved' && w.templated.length === 0 && r.transitioned[0].texted === false && !r.errors.length);
}
{
  const { api, w, env } = makeWorld({ cfgWriteFails: true });
  const r = await api.processDepositPaidSweep(env);
  t('claim write failure surfaced, still texts exactly once', r.errors.some(e => e.stage === 'deposit_paid_text_claim') && w.templated.length === 2);
}
{
  const { api, w, env } = makeWorld({ flipAfterReads: 2 });
  const r = await api.processDepositPaidSweep(env);
  t('stage re-read: scope moved by another sweep mid-flight -> no write, no texts', w.templated.length === 0 && !r.transitioned.length);
}

// ── qbPayables: milestone deposit with vendor cost but no vendor bill -> 'vendor bill missing' ──
{
  const qbpSrc = ['function qbEscape(', 'async function qbFindLikelyUnlinkedPayment(', 'function depositMilestoneForSignature(', 'function firstMilestoneForSignature(', 'async function logAndCollectError(', 'async function qbPayables(']
    .map(sg => { try { return grab(wsrc, sg); } catch (e) { return grab(wsrc, sg.replace('async ', '')); } }).join('\n');
  const stubs = {
    fetchTabs: async (e, tabs) => tabs.map(x => (x === 'Invoice_Review' ? [] : [])),
    fetchTab: async (e, tab) => ({
      Scope_Signatures: [{ ID: 'S8', Scope_ID: '8', Active: 'TRUE', QB_Invoice_ID: '', Subtotal: '1000', Deposit_Amount: '500', Vendor_Cost_Total: '600' }],
      Scopes: [{ ID: '8', WO_ID: 'WO-1227', Vendor_ID: 'V1' }],
      Payment_Milestones: [{ ID: 'M1', Signature_ID: 'S8', Sequence: '1', QB_Invoice_ID: '7901', QB_Bill_ID: '', Customer_Amount: '500', Vendor_Amount: '300', Active: 'TRUE' }],
    }[tab] || []),
    paymentMilestonesTab: async () => {}, logTelemetry: async () => {},
    qbAccessToken: async () => 't',
    qbApi: async (e, path) => (path.includes('from%20Invoice') ? { QueryResponse: { Invoice: [{ Id: '7901', Balance: 0, DocNumber: '1' }] } } : { QueryResponse: {} }),
    qbVendorDisplayName: () => 'V', vendorTermLabel: () => 'x', json: b => b,
    scopeSigVendorBillAmount: (vc, dep, sub) => ({ amount: +(vc * dep / sub).toFixed(2) }), scopeSigSkipIsInHouse: () => false,
  };
  const names = Object.keys(stubs);
  const qbPayablesFn = new Function(...names, qbpSrc + '\nreturn qbPayables;')(...names.map(n => stubs[n]));
  const res = await qbPayablesFn({}, new URL('http://x/?days=90'));
  const row = res.rows.find(r => r.milestone_id === 'M1');
  t('milestone deposit row exists with milestone invoice + milestone customer total', !!row && row.invoice_id === '7901' && row.customer_total === 500 && row.customer_paid === true);
  t("milestone deposit with vendor cost but no bill -> 'vendor bill missing' (not 'nothing to pay')", row && row.state === 'vendor bill missing');
  t('...and it is in warnings', res.warnings.some(x => x.stage === 'vendor_bill_missing' && /WO-1227/.test(x.ref)));
}

// ── wiring tripwires on the real source ─────────────────────────────────────────
const sched0 = wsrc.slice(wsrc.indexOf('async scheduled(event, env, ctx) {'), wsrc.indexOf('// Thin wrapper (Sep 29 2026)'));
const qbp = grab(wsrc, 'async function qbPayables(');
t('qbPayables uses milestone fallback', qbp.includes('depositMilestoneForSignature(r, allMilestones)') && qbp.includes('warnings,'));
t('scheduled() does not run the sweep twice', sched0.includes('if (!_sweepRanInSync) await processDepositPaidSweep(env)'));
t('banner resets on a failed payables read', isrc.includes("errors = [{ stage: 'payables_read'") && isrc.includes('awaiting_invoice'));
t('qbPayables has no bare swallow in signed-proposal block', !/never break the Invoice_Review-based rows above \*\/ \}/.test(qbp));
const qbs = grab(wsrc, 'async function qbSyncPayments(');
t('qbSyncPayments logs + returns errors and runs sweep', qbs.includes('errors: syncErrors') && qbs.includes('processDepositPaidSweep(env)') && !qbs.includes('/* non-fatal */'));
const sched = wsrc.slice(wsrc.indexOf('async scheduled(event, env, ctx) {'), wsrc.indexOf('// Thin wrapper (Sep 29 2026)'));
t('scheduled() runs processDepositPaidSweep daily', sched.includes('processDepositPaidSweep(env)'));
t('route POST /scope-deposit/sweep wired', /path === '\/scope-deposit\/sweep'\)\s+return json\(await processDepositPaidSweep\(env\)\)/.test(wsrc));
t('hubTestWriteAllowed allows /scope-deposit/sweep', wsrc.includes("if (path === '/scope-deposit/sweep') return true;"));
t('index.html fires sweep on Who To Pay open + renders banner', isrc.includes("loadPayables(false); payablesDepositSweep();") && isrc.includes('id="payables-alerts"') && isrc.includes("api('POST', '/scope-deposit/sweep'"));

console.log(`deposit-paid-who-to-pay: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
