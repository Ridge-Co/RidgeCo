// Oct 19 2026 — padded instant-pay fee, fee-credit ledger, credit-aware Reprice/Relabel + Who To Pay, and the read-only proposal sweep.
// Real functions are sliced out of worker.js / index.html and run against in-memory fakes.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const idx = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grabFrom(text, kind, name) {
  const i = text.indexOf(kind + ' ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const grab = (n) => grabFrom(src, 'function', n);
const grabAsync = (n) => grabFrom(src, 'async function', n);
function grabLine(prefix) { const i = src.indexOf(prefix); if (i < 0) throw new Error('missing ' + prefix); return src.slice(i, src.indexOf('\n', i)); }
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, a, b) => t(n + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b));

// ───────── pure layer ─────────
const H = new Function([
  grabLine('const INSTANT_FEE_DEFAULTS'), grabLine('const INSTANT_FEE_LABEL_EN'), grabLine('const INSTANT_FEE_LABEL_ES'),
  grabLine('const FEE_CREDIT_LABEL_EN'), grabLine('const FEE_CREDIT_LABEL_ES'), grabLine('const INSTANT_FEE_PAD_DEDUCTION_EN'), grabLine('const INSTANT_FEE_PAD_DEDUCTION_ES'),
  grab('money2'), grab('instantFeeConfig'), grabLine('const clampFee'), grab('instantFeePad'), grab('instantFeeLegacyDeduction'), grab('instantPayEnabled'),
  grab('instantPadFor'), grab('vendorBillAdjustments'), grab('feeCreditBalanceOf'), grab('qbPickWorkLine'),
  grab('scopeVendorPayableSchedule'), grab('proposalBillingState'), grab('proposalBillingSweepRows'),
  'return { money2, instantFeeConfig, instantFeePad, instantPadFor, vendorBillAdjustments, feeCreditBalanceOf, qbPickWorkLine, proposalBillingSweepRows };',
].join('\n'))();
const off = H.instantFeeConfig({});
const on = H.instantFeeConfig({ instant_fee_pad_enabled: 'TRUE' });
t('pad mode is OFF by default', off.pad_enabled === false);
t('pad mode turns on with Config TRUE', on.pad_enabled === true && H.instantFeeConfig({ instant_fee_pad_enabled: 'yes' }).pad_enabled && !H.instantFeeConfig({ instant_fee_pad_enabled: 'no' }).pad_enabled);
const cesar = { ID: '3', Instant_Pay: 'TRUE', In_House: 'FALSE' };
eq('pad $500 job (on)', H.instantPadFor(cesar, {}, on, 500), 10);
eq('pad $1,250 job', H.instantPadFor(cesar, {}, on, 1250), 12.5);
eq('pad off -> 0', H.instantPadFor(cesar, {}, off, 500), 0);
eq('vendor not instant -> 0', H.instantPadFor({ ID: '9', Instant_Pay: 'FALSE' }, {}, on, 500), 0);
eq('in-house -> 0', H.instantPadFor({ ID: '3', Instant_Pay: 'TRUE', In_House: 'TRUE' }, {}, on, 500), 0);
eq('Cesar default (no own setting) -> padded', H.instantPadFor({ ID: '3' }, {}, on, 500), 10);

// bill lines: pad on, $500 net -> +10 / -10, total 500 (brief acceptance check)
let a = H.vendorBillAdjustments({ payable: 500, feeOn: true, cfg: on, lang: 'en', pad: 10, credits: [] });
eq('$500: lines', a.lines.map(l => [l.type, l.amount]), [['instant_fee_pad', 10], ['instant_fee', -10]]);
eq('$500: total sent = net', a.bill_total, 500);
eq('$500: fee/pad', [a.fee, a.pad], [10, 10]);
a = H.vendorBillAdjustments({ payable: 1250, feeOn: true, cfg: on, lang: 'en', pad: 12.5, credits: [] });
eq('$1,250: +12.50 / -12.50, total 1250', [a.lines.map(l => l.amount), a.bill_total], [[12.5, -12.5], 1250]);
t('pad and deduction net to zero', Math.abs(a.lines.reduce((s, l) => s + l.amount, 0)) < 1e-9);
// toggle off removes BOTH lines
a = H.vendorBillAdjustments({ payable: 500, feeOn: false, cfg: on, lang: 'en', pad: 10, credits: [] });
eq('toggle off: no lines, total 500', [a.lines.length, a.bill_total, a.fee, a.pad], [0, 500, 0, 0]);
t('toggle off explains the pad stays with Ridge Co', a.notes.some(n => /pad stays with Ridge Co/.test(n)));
// Spanish labels
a = H.vendorBillAdjustments({ payable: 500, feeOn: true, cfg: on, lang: 'es', pad: 10, credits: [] });
t('Spanish pad + deduction labels', /Recuperación/.test(a.lines[0].desc) && /Deducción/.test(a.lines[1].desc));
// no pad stored -> exactly the legacy behaviour
a = H.vendorBillAdjustments({ payable: 1250, feeOn: true, cfg: off, lang: 'en', credits: [] });
eq('legacy unchanged', [a.lines.map(l => [l.type, l.amount]), a.bill_total], [[['instant_fee', -12.38]], 1237.62]);
// proposal credit changes the amount sent -> pad falls back to the legacy deduction (with a note)
a = H.vendorBillAdjustments({ payable: 2900, feeOn: true, cfg: on, lang: 'en', pad: 29, credits: [{ type: 'proposal_credit', amount: 1160, desc: 'x' }] });
t('credit + pad -> legacy deduction + explained', a.pad === 0 && a.lines.some(l => l.type === 'instant_fee' && l.amount < 0 && l.amount !== -29) && a.notes.some(n => /pad is replaced/.test(n)));

// ───────── fee credit ─────────
a = H.vendorBillAdjustments({ payable: 500, feeOn: true, cfg: on, lang: 'en', pad: 10, credits: [], feeCredit: 15 });
eq('$15 credit vs $10 deduction: zeroes the deduction', [a.credit_applied, a.credit_left, a.bill_total], [10, 5, 510]);
eq('credit line is its own visible line', a.lines.map(l => l.type), ['instant_fee_pad', 'instant_fee', 'fee_credit']);
a = H.vendorBillAdjustments({ payable: 1250, feeOn: true, cfg: off, lang: 'en', credits: [], feeCredit: 4 });
eq('credit smaller than the deduction reduces it', [a.credit_applied, a.credit_left, a.bill_total], [4, 0, 1241.62]);
a = H.vendorBillAdjustments({ payable: 1250, feeOn: false, cfg: off, lang: 'en', credits: [], feeCredit: 20 });
eq('no deduction -> credit untouched (never adds money to a bill that has no fee)', [a.credit_applied, a.credit_left, a.bill_total, a.lines.length], [0, 20, 1250, 0]);
a = H.vendorBillAdjustments({ payable: 1250, feeOn: true, cfg: off, lang: 'es', credits: [], feeCredit: 4 });
t('Spanish credit label', /Crédito/.test(a.lines[a.lines.length - 1].desc));
const rows = [
  { Vendor_ID: '3', Entry_Type: 'credit', Amount: '15', Active: 'TRUE' }, { Vendor_ID: '3', Entry_Type: 'applied', Amount: '-10', Active: 'TRUE' },
  { Vendor_ID: '3', Entry_Type: 'credit', Amount: '99', Active: 'FALSE' }, { Vendor_ID: '4', Entry_Type: 'credit', Amount: '50', Active: 'TRUE' },
];
eq('ledger balance = signed sum of active rows for the vendor', H.feeCreditBalanceOf(rows, '3'), 5);
eq('other vendor unaffected', H.feeCreditBalanceOf(rows, '4'), 50);
eq('never negative', H.feeCreditBalanceOf([{ Vendor_ID: '3', Amount: '-5', Active: 'TRUE' }], '3'), 0);

// ───────── ledger I/O: applied once, only after the bill id; manual post; failed send applies nothing ─────────
{
  const store = [];
  let nextId = 1;
  const f = new Function('rows', 'money2', 'feeCreditBalanceOf', 'ensureFeeCreditTab', 'addRow', 'invalidateTabCache', 'FEE_CREDIT_TAB', 'fetchTab', 'isMissingTabError',
    grabAsync('feeCreditRows') + '\n' + grabAsync('feeCreditApplyOnce') + '\nreturn { feeCreditApplyOnce, feeCreditRows };');
  const api = f(store, H.money2, H.feeCreditBalanceOf, async () => {}, async (env, tab, row) => { store.push(Object.assign({ ID: String(nextId++), Active: 'TRUE' }, row)); return { clone: () => ({ json: async () => ({ id: 1 }) }) }; }, () => {}, 'Instant_Fee_Credit',
    async () => store, () => false);
  store.push({ ID: '0', Vendor_ID: '3', Entry_Type: 'credit', Amount: '15', Active: 'TRUE' });
  const r1 = await api.feeCreditApplyOnce({}, { vendorId: '3', vendorName: 'Cesar', amount: 10, irId: 'IR-9', qbBillId: '7001', woId: 'WO-1' });
  eq('first use records the credit', [r1.applied, r1.balance], [10, 5]);
  const r2 = await api.feeCreditApplyOnce({}, { vendorId: '3', vendorName: 'Cesar', amount: 10, irId: 'IR-9', qbBillId: '7001', woId: 'WO-1' });
  t('a retried send never double-credits', r2.already === true && store.filter(x => x.Entry_Type === 'applied').length === 1);
  const r3 = await api.feeCreditApplyOnce({}, { vendorId: '3', vendorName: 'Cesar', amount: 10, irId: 'IR-10', qbBillId: '7002', woId: 'WO-2' });
  eq('credit larger than what is left uses only what is left', [r3.applied, r3.balance, r3.short], [5, 0, true]);
}
// wiring: apply happens only inside the "bill id came back" branch, in both send paths
const single = grabAsync('qbSendInvoice'), combined = grabAsync('qbSendCombinedInvoice');
for (const [nm, body] of [['single', single], ['combined', combined]]) {
  const iApply = body.indexOf('feeCreditApplyOnce'), iPost = body.indexOf("'bill?minorversion=73', 'POST'");
  t(nm + ': credit recorded AFTER the QuickBooks bill POST', iApply > iPost && iPost > 0);
  t(nm + ': a failed ledger read stops a real send (503), never silently skips the credit', /fee-credit ledger/.test(body) && /503/.test(body));
  t(nm + ': a failed record is logged + warned', /fee_credit_apply_failed/.test(body));
}
t('single path passes stored pad + credit into the bill', /pad: irPad, feeCredit: feeCreditAvail/.test(single));
t('combined path passes each row pad + credit', /pad: rb\.pad, feeCredit: rb\.creditAvail/.test(combined));

// routes + guards
t('routes registered', /path === '\/vendor-fee-credit'\)/.test(src) && /path === '\/vendor-fee-credit\/add'\)/.test(src) && /path === '\/qb\/proposal-billing-sweep'/.test(src));
t('staging write guard covers the credit post', /path === '\/vendor-fee-credit\/add'\) return !!_b\.vendor_id && await isTestRecord/.test(src));
t('credit post refuses absurd amounts and unknown vendors', /over \$5,000/.test(src) && /No vendor ' \+ vendorId/.test(src));

// ───────── approval stamps the pad, and refuses a mismatch ─────────
{
  const approve = grabAsync('approveInvoiceReview');
  t('approve validates the pad before anything is written', approve.indexOf('resolveApprovalPad') < approve.indexOf("addRow(env, 'Invoice_Review'"));
  t('approve stamps Instant_Pad and verifies it landed', /Instant_Pad: String\(padRes\.pad\)/.test(approve) && /approve_instant_pad_not_saved/.test(approve));
  const mk2 = (cfgObj) => new Function('fetchConfig', 'fetchTab', [grab('money2'), grabLine('const INSTANT_FEE_DEFAULTS'), grab('instantFeeConfig'), grabLine('const clampFee'), grab('instantFeePad'), grab('instantPayEnabled'), grab('instantPadFor'), grabAsync('resolveApprovalPad'), 'return resolveApprovalPad;'].join('\n'))(async () => cfgObj, async () => [{ ID: '3', Instant_Pay: 'TRUE' }]);
  let r = await mk2({ instant_fee_pad_enabled: 'TRUE' })({}, { vendor_id: '3', vendor_cost: '500', instant_pad: '10.00' });
  eq('matching pad accepted', r, { pad: 10 });
  r = await mk2({ instant_fee_pad_enabled: 'TRUE' })({}, { vendor_id: '3', vendor_cost: '500', instant_pad: '12.00' });
  t('wrong pad refused with a reload message', !!r.error && /fee schedule says \$10\.00/.test(r.error));
  r = await mk2({})({}, { vendor_id: '3', vendor_cost: '500', instant_pad: '10.00' });
  t('pad while the switch is off refused', !!r.error && /does not apply/.test(r.error));
  r = await mk2({})({}, { vendor_id: '3', vendor_cost: '500' });
  eq('no pad posted (older page / bulk approve) -> legacy, nothing stamped', r, { pad: 0 });
  r = await mk2({ instant_fee_pad_enabled: 'TRUE' })({}, { vendor_id: '3', vendor_cost: '500', instant_pad: '-3' });
  t('negative pad refused', !!r.error);
}

// ───────── client mirror: invPadFor == server instantFeePad ─────────
{
  // INSTANT_FEE_CFG is a free variable in the page, so it is provided through a wrapper scope
  const mkClient = (cfg) => new Function('INSTANT_FEE_CFG', grabFrom(idx, 'function', 'invPadFor') + '\nreturn invPadFor;')(cfg);
  const c = { pad_enabled: true, rate: 0.01, min: 10, max: 100, default_vendor_ids: ['3'] };
  const inv = mkClient(c);
  for (const n of [100, 500, 1000, 1010, 1250, 5000, 10000, 12000, 333.33]) eq('client pad == server pad @' + n, inv({ ID: '3', Instant_Pay: 'TRUE' }, n), H.instantFeePad(n, off));
  eq('client: Cesar default (blank Instant_Pay)', inv({ ID: '3' }, 500), 10);
  eq('client: other vendor, blank -> 0', inv({ ID: '7' }, 500), 0);
  eq('client: in-house -> 0', inv({ ID: '3', Instant_Pay: 'TRUE', In_House: 'TRUE' }, 500), 0);
  eq('client: switch off -> 0', mkClient(null)({ ID: '3', Instant_Pay: 'TRUE' }, 500), 0);
  t('invoice builder prices the pad into the cost basis and posts it', /totalCost \+= instantPad/.test(idx) && /instant_pad: \(p\.instantPad \|\| 0\)\.toFixed\(2\)/.test(idx));
  t('pricing-config endpoint carries the pad switch', /instant_fee: _instant/.test(src) && /INSTANT_FEE_CFG = \(r && r\.instant_fee && r\.instant_fee\.pad_enabled\)/.test(idx));
}

// ───────── Reprice / Relabel on a netted invoice ─────────
{
  const irNet = { Proposal_Applied: 'TRUE', Proposal_Credit_Customer: '1524' };
  const L = (id, amt) => ({ Id: id, DetailType: 'SalesItemLineDetail', Amount: amt });
  let p = H.qbPickWorkLine({ Line: [L('1', 3810), L('2', -1524)] }, irNet);
  t('netted invoice: work line + credit line identified', p.line && p.line.Id === '1' && p.creditLine.Id === '2' && p.credit === 1524);
  p = H.qbPickWorkLine({ Line: [L('2', -1524), L('1', 3810)] }, irNet);
  t('order of lines does not matter', p.line.Id === '1');
  p = H.qbPickWorkLine({ Line: [L('1', 3810)] }, irNet);
  t('netted row whose invoice lacks the credit line -> refused', !!p.error);
  p = H.qbPickWorkLine({ Line: [L('1', 3810), L('2', -1000)] }, irNet);
  t('credit line of a different amount -> refused', !!p.error);
  p = H.qbPickWorkLine({ Line: [L('1', 500)] }, {});
  t('plain one-line invoice still works', p.line.Id === '1' && p.credit === 0 && p.creditLine === null);
  p = H.qbPickWorkLine({ Line: [L('1', 500), L('2', 20)] }, {});
  t('plain two-line invoice still refused', !!p.error);
  const rp = grabAsync('qbRepriceInvoice');
  t('reprice sends both lines on a netted invoice', /pick\.creditLine \? \[newLine, pick\.creditLine\]/.test(rp));
  t('reprice refuses a job total at/below the credit', /must be more than the \$/.test(rp));
  t('relabel is credit-aware', /qbPickWorkLine/.test(grabAsync('qbRelabelInvoice')));
}

// ───────── Who To Pay compares to the NET invoice ─────────
{
  const pay = grabAsync('qbPayables');
  t('payables nets the proposal credit before judging part-paid', /propCreditPay/.test(pay) && /customer_total: custTotal, proposal_credit: propCreditPay/.test(pay));
}

// ───────── sweep ─────────
{
  const scopes = [{ ID: '8', WO_ID: 'WO-1227', Title: 'Inspection Fail Repairs' }, { ID: '10', WO_ID: 'WO-1246', Title: 'Roof' }, { ID: '6', WO_ID: 'WO-1183', Title: 'Caulk' }, { ID: '3', WO_ID: 'WO-1175', Title: 'Drywall' }];
  const sigs = [{ ID: '5', Scope_ID: '8', Subtotal: '1100', Vendor_Cost_Total: '850', Deposit_Amount: '550' }, { ID: '6', Scope_ID: '10', Subtotal: '3810', Vendor_Cost_Total: '2900' },
    { ID: '4', Scope_ID: '6', Subtotal: '325', Vendor_Cost_Total: '325', Deposit_Amount: '162.5' }, { ID: '2', Scope_ID: '3', Subtotal: '8100', Vendor_Cost_Total: '6800', Deposit_Amount: '4050', QB_Invoice_ID: '7742', QB_Final_Invoice_ID: '7817' }];
  const ms = [
    { ID: '1', Signature_ID: '5', Label: 'Deposit', Sequence: '1', Customer_Amount: '366.74', Vendor_Amount: '283.39', Status: 'billed', QB_Invoice_ID: '7901', QB_Invoice_Number: '1746', QB_Bill_ID: '7902' },
    { ID: '2', Signature_ID: '5', Label: 'Final', Sequence: '2', Customer_Amount: '733.26', Vendor_Amount: '566.61', Status: 'pending' },
    { ID: '3', Signature_ID: '6', Label: 'Deposit', Sequence: '1', Customer_Amount: '1524', Vendor_Amount: '1160', Status: 'billed', QB_Invoice_ID: '7947', QB_Bill_ID: '7948' },
    { ID: '4', Signature_ID: '6', Label: 'Final', Sequence: '2', Customer_Amount: '2286', Vendor_Amount: '1740', Status: 'billed', QB_Invoice_ID: '7971', QB_Bill_ID: '7972' },
  ];
  const irs = [{ ID: '200', WO_ID: 'WO-1227', Active: 'TRUE', Customer_Total: '1100', QB_Invoice_ID: '', Proposal_Applied: '' }];
  let rows2 = H.proposalBillingSweepRows({ scopes, sigs, milestones: ms, irs });
  eq('only the partly-billed proposal is listed', rows2.map(r => r.wo_id), ['WO-1227']);
  t('WO-1227 flagged: an unsent full-price bill would double-bill', rows2[0].flags.includes('unsent_bill_would_double_bill') && rows2[0].flags.includes('netting_decision_pending'));
  eq('WO-1227 numbers', [rows2[0].signed_total, rows2[0].already_invoiced, rows2[0].still_open], [1100, 366.74, 733.26]);
  rows2 = H.proposalBillingSweepRows({ scopes, sigs, milestones: ms, irs: [{ ID: '200', WO_ID: 'WO-1227', Active: 'TRUE', Customer_Total: '1100', QB_Invoice_ID: '8000', Proposal_Applied: '' }] });
  t('an invoice already sent in full on top of the deposit is flagged', rows2[0].flags.includes('sent_unnetted_over_signed'));
  rows2 = H.proposalBillingSweepRows({ scopes, sigs, milestones: ms, irs: [{ ID: '200', WO_ID: 'WO-1227', Active: 'TRUE', Customer_Total: '1100', QB_Invoice_ID: '8000', Proposal_Applied: 'TRUE', Proposal_Credit_Customer: '366.74' }] });
  t('a netted send is clean', rows2[0].flags.length === 0 && rows2[0].related_bills[0].netting === 'applied');
  rows2 = H.proposalBillingSweepRows({ scopes, sigs, milestones: ms, irs: [] });
  t('no related bill -> listed, no flags', rows2.length === 1 && rows2[0].flags.length === 0);
  const sweepFn = grabAsync('proposalBillingSweep');
  t('sweep is read-only (no writes, no QuickBooks)', !/addRow|updateRow|sheetsRequest\(env, 'POST'|qbApi/.test(sweepFn));
}

// Vendors page UI
t('Vendors page: fee-credit link, modal and handlers exist', /openFeeCreditModal\(/.test(idx) && /id="modal-fee-credit"/.test(idx) && /\/vendor-fee-credit\/add/.test(idx) && /\/vendor-fee-credit\?vendor_id=/.test(idx));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
