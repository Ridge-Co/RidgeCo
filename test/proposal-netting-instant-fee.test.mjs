// Oct 19 2026 — proposal netting + instant-pay fee. Runs the REAL pure helpers sliced out of worker.js.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabLine(prefix) {
  const i = src.indexOf(prefix); if (i < 0) throw new Error('missing ' + prefix);
  return src.slice(i, src.indexOf('\n', i));
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, a, b) => t(n + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b));

const code = [
  grabLine('const INSTANT_FEE_DEFAULTS'), grabLine('const INSTANT_FEE_LABEL_EN'), grabLine('const INSTANT_FEE_LABEL_ES'), grabLine('const FEE_CREDIT_LABEL_EN'), grabLine('const FEE_CREDIT_LABEL_ES'), grabLine('const INSTANT_FEE_PAD_DEDUCTION_EN'), grabLine('const INSTANT_FEE_PAD_DEDUCTION_ES'),
  grab('money2'), grab('instantFeeConfig'), grabLine('const clampFee'), grab('instantFeePad'), grab('instantFeeLegacyDeduction'),
  grab('instantPayEnabled'), grab('propUnitText'), grab('scopeVendorPayableSchedule'), grab('proposalBillingState'),
  grab('proposalCandidatesForBill'), grab('proposalNettingPlan'), grab('vendorBillAdjustments'),
  'function formatUnitLabel(u){ return /^\\d/.test(String(u)) ? "Apt " + u : String(u); }',
  'return { money2, instantFeeConfig, instantFeePad, instantFeeLegacyDeduction, instantPayEnabled, propUnitText, proposalBillingState, proposalCandidatesForBill, proposalNettingPlan, vendorBillAdjustments };',
].join('\n');
const H = new Function(code)();
const cfg = H.instantFeeConfig({});

// ── fee table (legacy deduction — the one wired in) ──
const legacy = { 150: [10, 140], 400: [10, 390], 750: [10, 740], 1160: [11.49, 1148.51], 1250: [12.38, 1237.62], 1740: [17.23, 1722.77], 12000: [100, 11900] };
for (const [bill, [ded, send]] of Object.entries(legacy)) {
  const d = H.instantFeeLegacyDeduction(+bill, cfg);
  eq('legacy ' + bill, [d, H.money2(+bill - d)], [ded, send]);
}
// ── padded variant (built, not wired) ──
const pad = { 100: 10, 500: 10, 1000: 10, 1010: 10.1, 1250: 12.5, 5000: 50, 10000: 100, 12000: 100 };
for (const [net, p] of Object.entries(pad)) eq('pad ' + net, H.instantFeePad(+net, cfg), p);
eq('zero fee', H.instantFeeLegacyDeduction(0, cfg), 0);
eq('negative fee', H.instantFeeLegacyDeduction(-5, cfg), 0);
t('fee never exceeds the bill', H.instantFeeLegacyDeduction(4, cfg) <= 4);
eq('rounding 1.005', H.money2(1.005), 1.01);

// ── config ──
eq('cfg defaults', [cfg.rate, cfg.min, cfg.max, cfg.warnings.length], [0.01, 10, 100, 0]);
const c2 = H.instantFeeConfig({ instant_fee_rate: '0.02', instant_fee_min: '5', instant_fee_max: '50' });
eq('cfg override', [c2.rate, c2.min, c2.max], [0.02, 5, 50]);
const c3 = H.instantFeeConfig({ instant_fee_rate: '1' });
t('rate "1" (=100%) rejected with warning', c3.rate === 0.01 && c3.warnings.length === 1);
const c4 = H.instantFeeConfig({ instant_fee_rate: 'abc' });
t('garbage rate warns', c4.warnings.length === 1 && c4.rate === 0.01);
const c5 = H.instantFeeConfig({ instant_fee_min: '200', instant_fee_max: '100' });
t('max<min falls back + warns', c5.max === 100 && c5.min === 10 && c5.warnings.length >= 1);

// ── who is instant ──
const cesar = { ID: 3 }, other = { ID: 9 };
eq('cesar default on', H.instantPayEnabled(cesar, {}, undefined), true);
eq('other default off', H.instantPayEnabled(other, {}, undefined), false);
eq('vendor flag TRUE', H.instantPayEnabled({ ID: 9, Instant_Pay: 'TRUE' }, {}, undefined), true);
eq('vendor flag FALSE beats default', H.instantPayEnabled({ ID: 3, Instant_Pay: 'FALSE' }, {}, undefined), false);
eq('override off', H.instantPayEnabled(cesar, {}, false), false);
eq('override on', H.instantPayEnabled(other, {}, true), true);
eq('config id list', H.instantPayEnabled({ ID: 12 }, { instant_pay_default_vendor_ids: '3, 12' }, undefined), true);

eq('propUnit', H.propUnitText({ Address: '20 E Eager St' }, { Unit_Label: '3' }), '20 E Eager St Apt 3');
eq('propUnit no unit', H.propUnitText({ Address: '20 E Eager St' }, null), '20 E Eager St');

// ── 20 E Eager St (WO-1246): $3,810 job, 50% deposit invoice 1759 ($1,524 paid) ──
const sig = { ID: 5, Scope_ID: 10, Subtotal: 3810, Vendor_Cost_Total: 2900 };
const ms = [
  { ID: 1, Signature_ID: 5, Label: 'Deposit', Sequence: 1, Customer_Amount: 1524, Vendor_Amount: 1160, Status: 'billed', QB_Invoice_ID: '1759', QB_Invoice_Number: '1759', QB_Bill_ID: '7925', QB_Bill_Number: '7925', Vendor_Paid_At_This_Milestone: 'TRUE' },
  { ID: 2, Signature_ID: 5, Label: 'Final', Sequence: 2, Customer_Amount: 2286, Vendor_Amount: 1740, Status: 'pending', Vendor_Paid_At_This_Milestone: 'TRUE' },
];
const st = H.proposalBillingState(sig, ms);
const plan = H.proposalNettingPlan({ state: st, grossCustomer: 3810, grossVendor: 2900 });
eq('eager credit', [plan.credit_customer, plan.credit_vendor, plan.net_customer, plan.net_vendor], [1524, 1160, 2286, 1740]);
eq('eager no problems', plan.problems.length, 0);
t('eager labels', /Deposit/.test(plan.customer_label) && /1759/.test(plan.customer_label) && /ya facturado/.test(plan.vendor_label_es));
const adj = H.vendorBillAdjustments({ payable: 2900, credits: [{ type: 'proposal_credit', amount: plan.credit_vendor, desc: plan.vendor_label_en, desc_es: plan.vendor_label_es }], feeOn: true, cfg, lang: 'en' });
eq('eager vendor: fee + send', [adj.fee, adj.bill_total, adj.lines.length], [17.23, 1722.77, 2]);
eq('eager lines negative', adj.lines.every(l => l.amount < 0), true);
const adjEs = H.vendorBillAdjustments({ payable: 2900, credits: [{ amount: 1160, desc: 'x', desc_es: 'Menos: y' }], feeOn: true, cfg, lang: 'es' });
t('ES labels', adjEs.lines[0].desc === 'Menos: y' && /Recuperación/.test(adjEs.lines[1].desc));
const adjOff = H.vendorBillAdjustments({ payable: 2900, credits: [{ amount: 1160, desc: 'x' }], feeOn: false, cfg, lang: 'en' });
eq('fee off', [adjOff.fee, adjOff.bill_total, adjOff.lines.length], [0, 1740, 1]);

// ── Fort Ave: nothing billed → full amount, one invoice ──
const sigF = { ID: 7, Scope_ID: 4, Subtotal: 925, Vendor_Cost_Total: 680, Deposit_Amount: 462.5 };
const stF = H.proposalBillingState(sigF, []);
eq('legacy mode', stF.mode, 'legacy');
const planF = H.proposalNettingPlan({ state: stF, grossCustomer: 925, grossVendor: 680 });
eq('fort ave nothing billed → full', [planF.nothing_billed, planF.net_customer, planF.net_vendor, planF.credit_customer], [true, 925, 680, 0]);
const adjF = H.vendorBillAdjustments({ payable: 680, credits: [], feeOn: true, cfg, lang: 'en' });
eq('fort ave fee', adjF.fee, 10);

// ── legacy shape with deposit billed ──
const stL = H.proposalBillingState({ ...sigF, QB_Invoice_ID: '90', QB_Invoice_Number: '90', QB_Bill_ID: '70', QB_Bill_Number: '70' }, []);
const planL = H.proposalNettingPlan({ state: stL, grossCustomer: 925, grossVendor: 680 });
eq('legacy deposit billed', [planL.credit_customer, planL.net_customer], [462.5, 462.5]);

// ── problems ──
const stAll = H.proposalBillingState(sig, ms.map(m => ({ ...m, Status: 'billed', QB_Bill_ID: m.QB_Bill_ID || '1' })));
eq('fully billed blocks', H.proposalNettingPlan({ state: stAll, grossCustomer: 3810, grossVendor: 2900 }).problems.map(p => p.code), ['fully_billed']);
const over = H.proposalNettingPlan({ state: st, grossCustomer: 4200, grossVendor: 2900 });
t('overbill flagged + overridable', over.problems.some(p => p.code === 'overbill' && p.overridable));
const under = H.proposalNettingPlan({ state: st, grossCustomer: 3500, grossVendor: 2900 });
t('under signed warns', under.warnings.length === 1 && under.problems.length === 0);
const nl = H.proposalNettingPlan({ state: st, grossCustomer: 1500, grossVendor: 2900 });
t('nothing left', nl.problems.some(p => p.code === 'nothing_left'));
const voc = H.proposalNettingPlan({ state: st, grossCustomer: 3810, grossVendor: 1000 });
t('vendor over credit', voc.problems.some(p => p.code === 'vendor_over_credit'));
// deposit billed to customer but no vendor bill → no vendor credit
const noBill = H.proposalNettingPlan({ state: H.proposalBillingState(sig, [{ ...ms[0], QB_Bill_ID: '', QB_Bill_Number: '' }, ms[1]]), grossCustomer: 3810, grossVendor: 2900 });
eq('no vendor bill → no vendor credit', [noBill.credit_customer, noBill.credit_vendor], [1524, 0]);

// ── tiny bill: fee swallows payment ──
const tiny = H.vendorBillAdjustments({ payable: 8, credits: [], feeOn: true, cfg, lang: 'en' });
eq('tiny bill fee capped at bill', [tiny.fee, tiny.bill_total], [8, 0]);
t('tiny bill note', tiny.notes.length === 1);
const zero = H.vendorBillAdjustments({ payable: 100, credits: [{ amount: 100, desc: 'x' }], feeOn: true, cfg, lang: 'en' });
t('nothing payable → no fee + note', zero.fee === 0 && zero.notes.length === 1);

// ── candidates ──
const scopes = [
  { ID: 10, WO_ID: 1246, Property_ID: 1, Vendor_ID: 3, Unit_ID: 5 },
  { ID: 4, WO_ID: 1180, Property_ID: 2, Vendor_ID: 8, Unit_ID: '' },
  { ID: 11, WO_ID: 900, Property_ID: 2, Vendor_ID: 8, Unit_ID: 7 },
];
const sigs = [{ ID: 5, Scope_ID: 10, Subtotal: 3810 }, { ID: 7, Scope_ID: 4, Subtotal: 925, Deposit_Amount: 462.5 }, { ID: 8, Scope_ID: 11, Subtotal: 100 }];
const c1 = H.proposalCandidatesForBill({ woId: 1246, wo: { ID: 1246, Property_ID: 1, Unit_ID: 5 }, vendorId: 3, scopes, sigs, milestones: ms });
eq('linked candidate', [c1.length, c1[0].link], [1, 'linked']);
const cF = H.proposalCandidatesForBill({ woId: 1154, wo: { ID: 1154, Property_ID: 2, Unit_ID: '' }, vendorId: 8, scopes, sigs, milestones: [] });
t('fort ave found by property+vendor on different WO', cF.some(c => String(c.scope.ID) === '4' && c.link === 'same_property_vendor'));
t('other unit excluded', !H.proposalCandidatesForBill({ woId: 1154, wo: { Property_ID: 2, Unit_ID: 99 }, vendorId: 8, scopes, sigs, milestones: [] }).some(c => String(c.scope.ID) === '11'));
const cAll = H.proposalCandidatesForBill({ woId: 1246, wo: { Property_ID: 1, Unit_ID: 5 }, vendorId: 3, scopes, sigs, milestones: stAll.items.map((i, k) => ({ ...ms[k], Status: 'billed' })) });
eq('linked but fully billed still returned', cAll.length === 1 && cAll[0].fully_billed, true);
const cWrongVendor = H.proposalCandidatesForBill({ woId: 1154, wo: { Property_ID: 2 }, vendorId: 99, scopes, sigs, milestones: [] });
eq('different vendor → none', cWrongVendor.length, 0);

// ── static wiring tripwires ──
const fn = (name) => { const i = src.indexOf('async function ' + name + '('); if (i < 0) throw new Error(name); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const send = fn('qbSendInvoice'), comb = fn('qbSendCombinedInvoice'), undo = fn('qbUndoSend');
t('single path resolves netting', /qbResolveProposalNetting\(/.test(send));
t('single path persists decision before QB writes', send.indexOf('qbPersistNettingDecision(') > 0 && send.indexOf('qbPersistNettingDecision(') < send.indexOf("'bill?minorversion"));
t('single path closes out', /qbProposalCloseOut\(/.test(send));
t('combined path resolves netting + closes out', /qbResolveProposalNetting\(/.test(comb) && /qbProposalCloseOut\(/.test(comb));
t('undo reverts proposal', /qbProposalRevert\(/.test(undo));
t('no QB write without a verified decision', /qbPersistNettingDecision/.test(comb));


// ── message wording (Oct 19 2026): property + unit everywhere, job description for tenants ──
const defsStart = src.indexOf('const DEFAULT_MESSAGE_TEMPLATES = ['), defsEnd = src.indexOf('];', defsStart);
const defs = src.slice(defsStart, defsEnd);
const body = (type) => { const m = defs.match(new RegExp("Message_Type: '" + type + "', Channel: 'sms'[\\s\\S]*?Body:\\s*\\n?\\s*\"([^\"]*)\"")); return m ? m[1] : ''; };
for (const ty of ['admin_estimate_new', 'admin_proposal_signed', 'admin_deposit_paid', 'vendor_estimate_approved', 'vendor_estimate_approved_deposit', 'vendor_estimate_declined', 'vendor_estimate_needs_info', 'vendor_proposal_signed', 'vendor_deposit_paid'])
  t(ty + ' text names the property + unit', /\{Location\}/.test(body(ty)));
t('vendor_paid template exists with amount + jobs', /\{Amount\}/.test(body('vendor_paid')) && /\{Jobs\}/.test(body('vendor_paid')));
const sts = fn('sendTemplatedSms');
t('sendTemplatedSms fills Location from the work order (or scope unit)', /woLocationText\(env, o\.wo_id, o\.property, o\.unit_id\)/.test(sts));
const us = fn('updateStatus');
t('owner complete/on-hold texts use property + unit, not bare property', !/at \$\{property\.Address\} — is complete/.test(us) && !/at \$\{property\.Address\} — is on hold/.test(us));
t('admin complete text names the job + address', /woJobLabel\(wo\)\} at \$\{address\}\. Pending invoice/.test(us));
t('tenant accepted text has the job description', /accepted your \$\{woJobLabel\(wo\)\}/.test(us));
const sched = fn('scheduleWO');
t('owner scheduled text has property + unit', /propUnitText\(property, unit\)\} — is scheduled/.test(sched));
const refresh = fn('refreshUneditedTemplates');
t('template refresh only touches unedited (system_default) rows, verified writes', /Updated_By \|\| ''\) !== 'system_default'\) continue/.test(refresh) && /updateRowVerified/.test(refresh) && /logTelemetry/.test(refresh));
t('manual vendor-paid text endpoint is routed', /\/qb\/notify-vendor-paid'\)\s+return await qbNotifyVendorPaid/.test(src));
t('hub pay path uses the template text + reports failure', /vendorPaidText\(env/.test(src) && /vendor_paid_text_failed/.test(src));
t('instant-pay toggle verifies its write', /updateRowVerified\(env, 'Vendors', id, \{ Instant_Pay/.test(src));

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
