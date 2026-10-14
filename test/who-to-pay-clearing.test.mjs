// Who To Pay — customer "paid on" date + funds-clearing indicator (Oct 14 2026).
// Brett: "Who to pay page needs to display when the customer paid so I can judge when to pay vendor (funds cleared bank
// account). Indicator needed for 3 business days after payment from customer including bank holidays. I still make the
// decision to pay vendor." Answers: clock starts on the Payment's date (day 0); days-to-clear depends on payment method.
//
// Extracts the REAL helpers + qbPayables out of worker.js and the REAL payFmtDate/payClearChip out of index.html (same
// extract-the-real-function convention as who-to-pay-duplicate-guard.test.mjs) so this cannot drift from what ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const wsrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');
const isrc = readFileSync(join(here, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL: ' + msg); } assert.ok(cond, msg); }

function braced(src, start) {
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } }
  return src.slice(start, i);
}
function extractFn(name, isAsync) {
  const marker = (isAsync ? 'async function ' : 'function ') + name + '(';
  const start = wsrc.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in worker.js`);
  return braced(wsrc, start);
}

// ═════════════════ Part 1: pure date / config / method helpers ═════════════════
console.log('Clearing helpers — offline tests\n');
const pureSrc = ['parseHolidayMap', 'nextBusinessDay', 'paymentClearDaysMap', 'classifyPaymentMethod', 'addBusinessDays', 'summarizeInvoicePayments']
  .map(n => extractFn(n, false)).join('\n');
const H = new Function(`${pureSrc}\nreturn { parseHolidayMap, paymentClearDaysMap, classifyPaymentMethod, addBusinessDays, summarizeInvoicePayments };`)();

const hol = H.parseHolidayMap('2026-10-12:Columbus Day,2026-11-11:Veterans Day,2026-11-26:Thanksgiving Day,2026-12-25:Christmas Day,2027-01-01:New Year\'s Day');

// Payment day is day 0; weekends and bank holidays do not count.
ok(H.addBusinessDays('2026-10-05', 3, hol) === '2026-10-08', 'Mon pay -> clears Thu (day 0 = payment day)');
ok(H.addBusinessDays('2026-10-08', 3, hol) === '2026-10-14', 'Thu pay over Columbus Day weekend -> Fri, (Mon holiday skipped) Tue, Wed = Wed 10-14');
ok(H.addBusinessDays('2026-10-09', 3, hol) === '2026-10-15', 'Fri pay -> Tue, Wed, Thu (Mon 10-12 Columbus Day skipped)');
ok(H.addBusinessDays('2026-10-10', 3, hol) === '2026-10-15', 'Saturday payment: day 0 is the Saturday; Tue, Wed, Thu');
ok(H.addBusinessDays('2026-11-24', 3, hol) === '2026-11-30', 'Tue before Thanksgiving -> Wed, (Thu holiday) Fri, Mon');
ok(H.addBusinessDays('2026-12-23', 3, hol) === '2026-12-29', 'Wed before Christmas -> Thu, (Fri holiday) Mon, Tue');
ok(H.addBusinessDays('2026-12-31', 3, hol) === '2027-01-06', 'across the year boundary with New Year\'s Day skipped');
ok(H.addBusinessDays('2026-10-10', 0, hol) === '2026-10-10', '0 days (cash) = same day, even on a weekend');
ok(H.addBusinessDays('2026-10-05', 3, new Map()) === '2026-10-08', 'works with no holiday list at all');
ok(H.addBusinessDays('garbage', 3, hol) === '' && H.addBusinessDays('', 3, hol) === '' && H.addBusinessDays(undefined, 3, hol) === '', 'bad/missing date -> "" (never a guessed date)');

// Config.PAYMENT_CLEAR_DAYS
let c = H.paymentClearDaysMap('');
ok(c.map.ach === 3 && c.map.card === 3 && c.map.check === 5 && c.map.cash === 0 && c.map.other === 3 && !c.bad.length, 'defaults: ach 3, card 3, check 5, cash 0, other 3');
c = H.paymentClearDaysMap('ach:1, CHECK:7 ,card:2');
ok(c.map.ach === 1 && c.map.check === 7 && c.map.card === 2 && c.map.other === 3 && !c.bad.length, 'overrides apply (case/space tolerant), untouched keys keep defaults');
c = H.paymentClearDaysMap('ach:abc,foo:2,constructor:1,card:99,check');
ok(c.bad.length === 5 && c.map.ach === 3 && c.map.card === 3 && c.map.check === 5, 'invalid entries are REPORTED in bad[] and ignored (never silently half-applied): ' + JSON.stringify(c.bad));
ok(!('foo' in c.map) && Object.keys(c.map).length === 5, 'unknown keys cannot pollute the map');

// Payment method classification
const methods = new Map([['1', { Id: '1', Name: 'Cash', Type: 'NON_CREDIT_CARD' }], ['2', { Id: '2', Name: 'Check', Type: 'NON_CREDIT_CARD' }],
  ['3', { Id: '3', Name: 'Visa', Type: 'CREDIT_CARD' }], ['4', { Id: '4', Name: 'ACH', Type: 'NON_CREDIT_CARD' }], ['5', { Id: '5', Name: 'E-Check', Type: 'NON_CREDIT_CARD' }],
  ['6', { Id: '6', Name: 'Zelle', Type: 'NON_CREDIT_CARD' }], ['7', { Id: '7', Name: 'Some Custom', Type: 'CREDIT_CARD' }],
  ['8', { Id: '8', Name: 'QuickBooks Payments-Bank', Type: 'CREDIT_CARD' }], ['9', { Id: '9', Name: 'QuickBooks Payments-Credit Card', Type: 'CREDIT_CARD' }],
  ['10', { Id: '10', Name: 'QuickBooks Payments-PayPal', Type: 'CREDIT_CARD' }], ['11', { Id: '11', Name: 'Bank of America Visa', Type: 'CREDIT_CARD' }]]);
const cls = (p) => H.classifyPaymentMethod(p, methods).cls;
ok(cls({ PaymentMethodRef: { value: '1' } }) === 'cash', 'Cash -> cash');
ok(cls({ PaymentMethodRef: { value: '2' } }) === 'check', 'Check -> check');
ok(cls({ PaymentMethodRef: { value: '3' } }) === 'card', 'Visa (CREDIT_CARD) -> card');
ok(cls({ PaymentMethodRef: { value: '4' } }) === 'ach', 'ACH -> ach');
ok(cls({ PaymentMethodRef: { value: '5' } }) === 'ach', '"E-Check" -> ach, NOT check (contains the word check)');
ok(cls({ PaymentMethodRef: { value: '6' } }) === 'other', 'Zelle (unrecognised) -> other (default 3 days)');
ok(cls({ PaymentMethodRef: { value: '7' } }) === 'card', 'a custom-named method with Type CREDIT_CARD -> card');
ok(cls({ PaymentMethodRef: { value: '99', name: 'Credit Card' } }) === 'card', 'ref carrying only a name still classifies');
ok(cls({ CreditCardPayment: { CreditChargeResponse: {} } }) === 'card', 'a QuickBooks Payments card payment object -> card');
ok(cls({}) === 'other' && cls(null) === 'other', 'no method at all -> other');
// Oct 14 bank-label fix: QuickBooks files "QuickBooks Payments-Bank" under Type CREDIT_CARD, so it used to read as card.
ok(cls({ PaymentMethodRef: { value: '8' } }) === 'ach', '"QuickBooks Payments-Bank" (Type CREDIT_CARD) -> ach, not card');
ok(cls({ PaymentMethodRef: { value: '99', name: 'QuickBooks Payments-Bank' } }) === 'ach', 'bank name carried on the ref alone -> ach');
ok(cls({ PaymentMethodRef: { value: '9' } }) === 'card', '"QuickBooks Payments-Credit Card" stays card');
ok(cls({ PaymentMethodRef: { value: '10' } }) === 'card', '"QuickBooks Payments-PayPal" stays card (PayPal landed like a card in the statement study)');
ok(cls({ PaymentMethodRef: { value: '11' } }) === 'card', 'a card whose name contains "Bank" (Bank of America Visa) stays card');
ok(cls({ PaymentMethodRef: { value: '8' }, CreditCardPayment: { CreditChargeResponse: {} } }) === 'card', 'a real QuickBooks card-charge object still wins -> card');

// summarizeInvoicePayments: clearing vs cleared, today boundary, multiple payments, unknown
const ctx = (today) => ({ methodsById: methods, clearMap: H.paymentClearDaysMap('').map, holidayMap: hol, today });
let s = H.summarizeInvoicePayments([{ TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], ctx('2026-10-14'));
ok(s.status === 'clearing' && s.clears_on === '2026-10-16' && s.clear_days === 3 && s.paid_date === '2026-10-13' && s.method === 'ach' && s.method_name === 'ACH', 'ACH paid Tue 10-13, today Wed 10-14 -> clearing until Fri 10-16');
s = H.summarizeInvoicePayments([{ TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], ctx('2026-10-15'));
ok(s.status === 'clearing', 'the day BEFORE clears_on is still clearing');
s = H.summarizeInvoicePayments([{ TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], ctx('2026-10-16'));
ok(s.status === 'cleared', 'ON clears_on it is cleared (Mon pay clears Thu; payment day is day 0)');
s = H.summarizeInvoicePayments([{ TxnDate: '2026-10-13', PaymentMethodRef: { value: '1' } }], ctx('2026-10-13'));
ok(s.status === 'cleared' && s.clears_on === '2026-10-13', 'cash clears the same day');
s = H.summarizeInvoicePayments([{ TxnDate: '2026-10-05', PaymentMethodRef: { value: '2' } }], ctx('2026-10-12'));
ok(s.status === 'clearing' && s.clears_on === '2026-10-13' && s.clear_days === 5, 'check paid Mon 10-05: 5 biz days, Columbus Day skipped -> Tue 10-13');
s = H.summarizeInvoicePayments([
  { TxnDate: '2026-10-01', PaymentMethodRef: { value: '4' } },
  { TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } },
], ctx('2026-10-14'));
ok(s.count === 2 && s.paid_date === '2026-10-13' && s.status === 'clearing' && s.clears_on === '2026-10-16', 'two payments: reports the LATEST paid date and the LAST clear date');
s = H.summarizeInvoicePayments([], ctx('2026-10-14'));
ok(s.status === 'unknown' && s.count === 0 && s.paid_date === '', 'no payments found -> unknown (never blank/cleared)');
s = H.summarizeInvoicePayments([{ TxnDate: 'not-a-date' }, { PaymentMethodRef: { value: '4' } }], ctx('2026-10-14'));
ok(s.status === 'unknown' && s.count === 2, 'payments without a usable date -> unknown');

// ═════════════════ Part 2: qbPayables integration (fake QuickBooks) ═════════════════
console.log('\nqbPayables — clearing integration — offline tests\n');
const qbpSrc = ['function qbEscape(', 'async function qbFindLikelyUnlinkedPayment(', 'function depositMilestoneForSignature(', 'function firstMilestoneForSignature(', 'async function logAndCollectError(',
  'function parseHolidayMap(', 'function nextBusinessDay(', 'function paymentClearDaysMap(', 'function classifyPaymentMethod(', 'function addBusinessDays(',
  'function summarizeInvoicePayments(', 'async function qbLoadInvoicePayments(', 'async function qbPayables(']
  .map(sg => { const isAsync = sg.startsWith('async '); const name = sg.replace('async ', '').replace('function ', '').replace('(', ''); return extractFn(name, isAsync); }).join('\n');

const NOW = '2026-10-14'; // Wednesday, after Columbus Day (Mon 10-12)
const HOLS = '2026-10-12:Columbus Day,2026-11-11:Veterans Day,2026-11-26:Thanksgiving Day,2026-12-25:Christmas Day,2027-01-01:New Year\'s Day';
const vendorRow = { ID: '9', QBO_Vendor_ID: '77', Company: 'Alex Busey' };
const ir = (wo, inv, bill) => ({ ID: wo, Active: 'TRUE', WO_ID: wo, QB_Invoice_ID: inv, QB_Bill_ID: bill, Approved_Date: new Date().toISOString(), Customer_Total: '500.00', Vendor_Cost: '300.00', Vendor_ID: '9', Vendor_Name: '', QB_In_House: 'FALSE' });

function build({ irs, invoices, payments, paymentMethods, config, throwOn, sig }) {
  const telemetry = [];
  const calls = [];
  const fetchTabs = async (env, tabs) => tabs.map(t => (t === 'Invoice_Review' ? irs : t === 'Vendors' ? [vendorRow] : []));
  const fetchTab = async (env, tab) => (sig ? ({ Scope_Signatures: sig.signatures, Scopes: sig.scopes, Payment_Milestones: [] }[tab] || []) : []);
  const qbApi = async (env, path) => {
    const p = decodeURIComponent(path);
    calls.push(p);
    if (throwOn && throwOn.test(p)) throw new Error('QuickBooks 500 on ' + p.slice(0, 60));
    if (!p.startsWith('query?')) return {};
    if (/from Invoice /.test(p)) return { QueryResponse: { Invoice: invoices } };
    if (/from Bill /.test(p)) return { QueryResponse: { Bill: [{ Id: 'B1', Balance: 300, TotalAmt: 300, DueDate: '', DocNumber: '' }, { Id: 'B2', Balance: 300, TotalAmt: 300, DueDate: '', DocNumber: '' }, { Id: 'B3', Balance: 300, TotalAmt: 300, DueDate: '', DocNumber: '' }, { Id: 'B4', Balance: 300, TotalAmt: 300, DueDate: '', DocNumber: '' }] } };
    if (/from PaymentMethod/.test(p)) return { QueryResponse: { PaymentMethod: paymentMethods || [] } };
    if (/from Payment where CustomerRef/.test(p)) return { QueryResponse: { Payment: (payments || []).filter(x => x._byCustomer) } };
    if (/from Payment where Id/.test(p)) return { QueryResponse: { Payment: (payments || []).filter(x => !x._byCustomer) } };
    if (/from Purchase/.test(p)) return { QueryResponse: { Purchase: [] } };
    return { QueryResponse: {} };
  };
  const stubs = {
    fetchTabs, fetchTab, paymentMilestonesTab: async () => {}, logTelemetry: async (env, row) => { telemetry.push(row); },
    fetchConfig: async () => config || { US_HOLIDAYS: HOLS },
    etDateString: () => NOW,
    qbAccessToken: async () => 't', qbApi, qbVendorDisplayName: (v) => (v && v.Company) || 'Vendor', vendorTermLabel: () => 'Due on receipt', json: (b) => b,
    scopeSigVendorBillAmount: (vc, dep, sub) => ({ amount: +(vc * dep / sub).toFixed(2) }), scopeSigSkipIsInHouse: () => false,
  };
  const names = Object.keys(stubs);
  const fn = new Function(...names, qbpSrc + '\nreturn qbPayables;')(...names.map(n => stubs[n]));
  return { run: () => fn({}, new URL('http://x/?days=90')), telemetry, calls };
}
const PM = [{ Id: '4', Name: 'ACH', Type: 'NON_CREDIT_CARD' }, { Id: '2', Name: 'Check', Type: 'NON_CREDIT_CARD' }, { Id: '3', Name: 'Visa', Type: 'CREDIT_CARD' }];
const paidInv = (id, pays, extra) => ({ Id: id, Balance: 0, TotalAmt: 500, DocNumber: id, LinkedTxn: pays.map(x => ({ TxnId: x, TxnType: 'Payment' })), CustomerRef: { value: 'C-' + id }, ...extra });

// ---- ACH paid Tue 10-13: clearing, but the state is STILL "PAY THE VENDOR" and still counts as owed (informational only) ----
{
  const t = build({
    irs: [ir('WO-1', 'I1', 'B1')],
    invoices: [paidInv('I1', ['P1'])],
    payments: [{ Id: 'P1', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' }, TotalAmt: 500 }],
    paymentMethods: PM,
  });
  const res = await t.run();
  const r = res.rows[0];
  ok(r.customer_paid_date === '2026-10-13' && r.customer_pay_method === 'ach' && r.customer_pay_method_name === 'ACH', 'row carries paid date + method');
  ok(r.customer_clear_status === 'clearing' && r.customer_clears_on === '2026-10-16' && r.customer_clear_days === 3 && r.customer_payment_count === 1, 'ACH paid Tue 10-13, today Wed 10-14 -> clearing, clears Fri 10-16');
  ok(r.state === 'PAY THE VENDOR' && res.owed_now === 1 && Math.abs(res.owed_total - 300) < 0.01, 'STILL "PAY THE VENDOR" and still counted in owed_now/owed_total (indicator never blocks or hides: he sometimes pays early)');
  ok(res.as_of === NOW && res.clear_days && res.clear_days.ach === 3, 'response tells the page the as-of date and the days-to-clear table');
  ok(!res.warnings.length, 'no warnings on the happy path (got: ' + JSON.stringify(res.warnings) + ')');
}
// ---- check paid Mon 10-05 (5 biz days, Columbus Day skipped) -> cleared Tue 10-13 ----
{
  const t = build({ irs: [ir('WO-2', 'I2', 'B2')], invoices: [paidInv('I2', ['P2'])], payments: [{ Id: 'P2', TxnDate: '2026-10-05', PaymentMethodRef: { value: '2' } }], paymentMethods: PM });
  const r = (await t.run()).rows[0];
  ok(r.customer_clear_status === 'cleared' && r.customer_clears_on === '2026-10-13' && r.customer_clear_days === 5 && r.customer_pay_method === 'check', 'check paid Mon 10-05 -> cleared 10-13 (5 business days, Columbus Day skipped)');
}
// ---- card via CreditCardPayment object ----
{
  const t = build({ irs: [ir('WO-3', 'I3', 'B3')], invoices: [paidInv('I3', ['P3'])], payments: [{ Id: 'P3', TxnDate: '2026-10-14', CreditCardPayment: {} }], paymentMethods: PM });
  const r = (await t.run()).rows[0];
  ok(r.customer_pay_method === 'card' && r.customer_clear_status === 'clearing' && r.customer_clears_on === '2026-10-19', 'card paid today Wed 10-14 -> clears Mon 10-19 (Thu, Fri, Mon)');
}
// ---- Config.PAYMENT_CLEAR_DAYS override is honoured ----
{
  const t = build({ irs: [ir('WO-4', 'I4', 'B4')], invoices: [paidInv('I4', ['P4'])], payments: [{ Id: 'P4', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, config: { US_HOLIDAYS: HOLS, PAYMENT_CLEAR_DAYS: 'ach:1' } });
  const r = (await t.run()).rows[0];
  ok(r.customer_clear_days === 1 && r.customer_clears_on === '2026-10-14' && r.customer_clear_status === 'cleared', 'PAYMENT_CLEAR_DAYS=ach:1 -> ACH paid 10-13 clears 10-14 = cleared today');
}
// ---- bad config entry is reported, defaults used ----
{
  const t = build({ irs: [ir('WO-4', 'I4', 'B4')], invoices: [paidInv('I4', ['P4'])], payments: [{ Id: 'P4', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, config: { US_HOLIDAYS: HOLS, PAYMENT_CLEAR_DAYS: 'ach:soon' } });
  const res = await t.run();
  ok(res.rows[0].customer_clear_days === 3 && res.warnings.some(w => w.stage === 'qb_payables_clear_days_config'), 'invalid PAYMENT_CLEAR_DAYS -> default used AND a visible warning');
  ok(t.telemetry.some(x => x.Job_Type === 'qb_payables_clear_days_config' && x.Success === 'FALSE'), '...and it is logged to Ops_Telemetry (Success=FALSE)');
}
// ---- partial payment (Q5: both) ----
{
  const t = build({ irs: [ir('WO-5', 'I5', 'B1')], invoices: [{ Id: 'I5', Balance: 200, TotalAmt: 500, DocNumber: '5', LinkedTxn: [{ TxnId: 'P5', TxnType: 'Payment' }] }], payments: [{ Id: 'P5', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM });
  const r = (await t.run()).rows[0];
  ok(r.state === 'owner paid in part' && r.customer_partial === true && r.customer_clear_status === 'clearing' && r.customer_paid_date === '2026-10-13', 'part-paid row also gets the date + clearing indicator');
}
// ---- unpaid invoice: no indicator, no Payment lookups at all ----
{
  const t = build({ irs: [ir('WO-6', 'I6', 'B1')], invoices: [{ Id: 'I6', Balance: 500, TotalAmt: 500, DocNumber: '6', LinkedTxn: [], CustomerRef: { value: 'C6' } }], payments: [], paymentMethods: PM });
  const res = await t.run();
  const r = res.rows[0];
  ok(r.state === 'waiting on the owner' && r.customer_clear_status === '' && r.customer_paid_date === '' && r.customer_payment_count === 0, 'unpaid invoice -> no indicator fields');
  ok(!t.calls.some(c => /from Payment/.test(c)), 'unpaid invoices trigger NO Payment/PaymentMethod QuickBooks calls');
  ok(!res.warnings.length, 'and no warnings');
}
// ---- paid but no Payment can be found anywhere -> 'unknown' + one aggregated visible warning; row still PAY THE VENDOR ----
{
  const t = build({ irs: [ir('WO-7', 'I7', 'B1')], invoices: [{ Id: 'I7', Balance: 0, TotalAmt: 500, DocNumber: '7', LinkedTxn: [{ TxnId: 'CM1', TxnType: 'CreditMemo' }], CustomerRef: { value: 'C7' } }], payments: [], paymentMethods: PM });
  const res = await t.run();
  const r = res.rows[0];
  ok(r.customer_clear_status === 'unknown' && r.state === 'PAY THE VENDOR', 'paid invoice with no resolvable Payment -> status unknown (not blank, not cleared); state untouched');
  const w = res.warnings.find(x => x.stage === 'qb_payables_payment_date_missing');
  ok(w && /WO-7/.test(w.ref + w.error), 'one aggregated warning names the WO (visible in the page banner)');
  ok(t.telemetry.some(x => x.Job_Type === 'qb_payables_payment_date_missing' && x.Success === 'FALSE'), 'and it is logged to Ops_Telemetry');
}
// ---- Payment query throws -> warning + unknown, never silent ----
{
  const t = build({ irs: [ir('WO-8', 'I8', 'B1')], invoices: [paidInv('I8', ['P8'])], payments: [{ Id: 'P8', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, throwOn: /from Payment where Id/ });
  const res = await t.run();
  ok(res.ok !== false && res.rows.length === 1, 'a failing Payment lookup does not take down the whole page');
  ok(res.warnings.some(x => x.stage === 'qb_payables_payment_fetch'), 'the failure is surfaced as a warning');
  ok(res.rows[0].customer_clear_status === 'unknown', 'and the row says unknown instead of pretending no payment / cleared');
  ok(t.telemetry.some(x => x.Job_Type === 'qb_payables_payment_fetch'), 'and is logged to Ops_Telemetry');
}
// ---- PaymentMethod lookup fails -> warning, method falls back to 'other' (3 days) ----
{
  const t = build({ irs: [ir('WO-9', 'I9', 'B1')], invoices: [paidInv('I9', ['P9'])], payments: [{ Id: 'P9', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, throwOn: /from PaymentMethod/ });
  const res = await t.run();
  ok(res.warnings.some(x => x.stage === 'qb_payables_paymentmethod_fetch') && res.rows[0].customer_pay_method === 'other' && res.rows[0].customer_clears_on === '2026-10-16', 'PaymentMethod lookup failure -> warning + conservative "other" (3 days), still shows a date');
}
// ---- fallback path: no LinkedTxn on the invoice, found via the customer's Payments ----
{
  const t = build({
    irs: [ir('WO-10', 'I10', 'B1')],
    invoices: [{ Id: 'I10', Balance: 0, TotalAmt: 500, DocNumber: '10', LinkedTxn: [], CustomerRef: { value: 'C10' } }],
    payments: [{ Id: 'P10', _byCustomer: true, TxnDate: '2026-10-13', PaymentMethodRef: { value: '3' }, Line: [{ Amount: 500, LinkedTxn: [{ TxnId: 'I10', TxnType: 'Invoice' }] }] },
               { Id: 'PX', _byCustomer: true, TxnDate: '2026-09-01', PaymentMethodRef: { value: '4' }, Line: [{ Amount: 50, LinkedTxn: [{ TxnId: 'OTHER', TxnType: 'Invoice' }] }] }],
    paymentMethods: PM,
  });
  const res = await t.run();
  const r = res.rows[0];
  ok(r.customer_paid_date === '2026-10-13' && r.customer_pay_method === 'card' && r.customer_payment_count === 1, 'fallback finds the right Payment by its Line.LinkedTxn -> Invoice id, ignoring other invoices\' payments');
  ok(!res.warnings.length, 'fallback success -> no warnings');
}
// ---- holidays: missing / stale are reported, not silently ignored ----
{
  const t = build({ irs: [ir('WO-11', 'I11', 'B1')], invoices: [paidInv('I11', ['P11'])], payments: [{ Id: 'P11', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, config: {} });
  const res = await t.run();
  ok(res.warnings.some(x => x.stage === 'qb_payables_holidays_missing'), 'empty/unreadable Config.US_HOLIDAYS -> visible warning (bank holidays NOT excluded)');
  const t2 = build({ irs: [ir('WO-11', 'I11', 'B1')], invoices: [paidInv('I11', ['P11'])], payments: [{ Id: 'P11', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, config: { US_HOLIDAYS: '2025-12-25:Christmas Day' } });
  ok((await t2.run()).warnings.some(x => x.stage === 'qb_payables_holidays_stale'), 'holiday list with no dates for this year -> visible warning');
}
// ---- Signed Proposal rows get the same indicator ----
{
  const sig = {
    signatures: [{ ID: 'S1', Scope_ID: '1', Active: 'TRUE', QB_Invoice_ID: 'IS1', QB_Bill_ID: 'B1', Subtotal: '1000', Deposit_Amount: '500', Vendor_Cost_Total: '600' }],
    scopes: [{ ID: '1', WO_ID: 'WO-SIG', Vendor_ID: '9' }],
  };
  const t = build({ irs: [], invoices: [paidInv('IS1', ['PS1'], { TotalAmt: 500 })], payments: [{ Id: 'PS1', TxnDate: '2026-10-13', PaymentMethodRef: { value: '4' } }], paymentMethods: PM, sig });
  const res = await t.run();
  const r = res.rows.find(x => x.source === 'scope_signature');
  ok(r && r.customer_clear_status === 'clearing' && r.customer_clears_on === '2026-10-16' && r.customer_pay_method === 'ach', 'signed-proposal (deposit) row also carries the clearing indicator');
}

// ═════════════════ Part 3: the page chip (real payFmtDate / payClearChip from index.html) ═════════════════
console.log('\nWho To Pay page chip — offline tests\n');
const escSrc = braced(isrc, isrc.indexOf('function esc('));
const chipSrc = braced(isrc, isrc.indexOf('function payFmtDate(')) + '\n' + braced(isrc, isrc.indexOf('function payClearChip('));
const { payClearChip, payFmtDate } = new Function(`${escSrc}\n${chipSrc}\nreturn { payClearChip, payFmtDate };`)();

ok(payFmtDate('2026-10-16').includes('Oct 16') && payFmtDate('2026-10-16').includes('Fri'), 'payFmtDate shows weekday + date with no timezone drift (got: ' + payFmtDate('2026-10-16') + ')');
ok(payFmtDate('') === '' && payFmtDate('nope') === '' && payFmtDate(null) === '', 'payFmtDate returns "" on bad input');
ok(payClearChip({}) === '' && payClearChip({ customer_clear_status: '' }) === '' && payClearChip(null) === '', 'no status -> no chip (unpaid rows are unchanged)');
let h = payClearChip({ customer_clear_status: 'clearing', customer_paid_date: '2026-10-13', customer_pay_method_name: 'ACH', customer_clears_on: '2026-10-16', customer_clear_days: 3, customer_payment_count: 1 });
ok(h.includes('⏳') && h.includes('Paid') && h.includes('Oct 13') && h.includes('by ACH') && h.includes('Oct 16') && h.includes('3 business days'), 'clearing chip: paid date, method, expected clear date, business-day count');
h = payClearChip({ customer_clear_status: 'cleared', customer_paid_date: '2026-10-05', customer_pay_method_name: 'Check', customer_clears_on: '2026-10-13', customer_clear_days: 5, customer_payment_count: 1 });
ok(h.includes('✓') && h.includes('cleared') && h.includes('Oct 13'), 'cleared chip');
h = payClearChip({ customer_clear_status: 'clearing', customer_partial: true, customer_paid_date: '2026-10-13', customer_pay_method: 'ach', customer_clears_on: '2026-10-16', customer_clear_days: 1, customer_payment_count: 2 });
ok(h.includes('Part-payment') && h.includes('latest of 2 payments') && h.includes('1 business day') && !h.includes('1 business days'), 'partial + multi-payment wording, singular "1 business day"');
h = payClearChip({ customer_clear_status: 'unknown' });
ok(h.includes('unavailable') && !h.includes('✓') && !h.includes('⏳'), 'unknown chip says the date is unavailable (never looks cleared)');
h = payClearChip({ customer_clear_status: 'clearing', customer_paid_date: '2026-10-13', customer_pay_method_name: '<img src=x onerror=alert(1)>', customer_clears_on: '2026-10-16', customer_clear_days: 3 });
ok(!h.includes('<img') && h.includes('&lt;img'), 'method name is HTML-escaped (QuickBooks-controlled text)');

// ═════════════════ Part 4: wiring tripwires ═════════════════
ok(isrc.includes('id="pay-f-clear"') || isrc.includes("id=\"pay-f-clear\"") || isrc.includes('pay-f-clear'), 'index.html has the "still clearing" filter');
ok(/'pay-q', 'pay-f-state', 'pay-f-clear'/.test(isrc), 'Clear button resets the new filter too');
ok(/if \(fc && r\.customer_clear_status !== fc\) return false;/.test(isrc), 'filter is wired into the row filter');
ok(isrc.includes('payClearChip(r) +'), 'card(r) renders the chip');
ok(/still clearing — the money may not be in your bank yet\. Your call\./.test(isrc), 'banner notes how many "PAY THE VENDOR" rows are still clearing (informational)');
const qbpFull = extractFn('qbPayables', true);
ok(!/canPay[^;]*clear/i.test(isrc) && !/customer_clear_status[^;\n]*disabled/.test(isrc), 'clearing status is never wired into the pay checkbox / pay action (informational only)');
ok(/\.\.\.clearFields\(ir\.WO_ID/.test(qbpFull) && /\.\.\.clearFields\(c\.sc\.WO_ID/.test(qbpFull), 'both row builders (Invoice_Review + signed proposals) attach the clearing fields');

console.log(`\nwho-to-pay-clearing: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
