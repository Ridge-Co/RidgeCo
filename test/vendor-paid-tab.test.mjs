// Oct 19 2026 — vendor portal PAID tab + paid/cancelled folding, and the QuickBooks vendor payment date behind it.
import fs from 'fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
function grab(sig, src) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---------- worker: vendor payment date from QuickBooks BillPayment ----------
const { vendorBillPaidDate, vendorBillPaymentIds } = new Function(grab('function vendorBillPaymentIds(', w) + '\n' + grab('function vendorBillPaidDate(', w) + '\nreturn { vendorBillPaidDate, vendorBillPaymentIds };')();
const bill = (links) => ({ Id: '9', LinkedTxn: links });
const pays = new Map([['11', { Id: '11', TxnDate: '2026-10-05' }], ['12', { Id: '12', TxnDate: '2026-10-12' }], ['13', { Id: '13', TxnDate: 'garbage' }]]);
ok(vendorBillPaidDate(bill([{ TxnId: '11', TxnType: 'BillPaymentCheck' }]), pays) === '2026-10-05', 'one BillPayment -> its date');
ok(vendorBillPaidDate(bill([{ TxnId: '11', TxnType: 'BillPaymentCheck' }, { TxnId: '12', TxnType: 'BillPaymentCreditCard' }]), pays) === '2026-10-12', 'several payments -> the LATEST date');
ok(vendorBillPaidDate(bill([{ TxnId: '11', TxnType: 'PurchaseOrder' }]), pays) === '', 'a non-payment linked txn is ignored');
ok(vendorBillPaidDate(bill([{ TxnId: '99', TxnType: 'BillPaymentCheck' }]), pays) === '', 'unresolvable payment -> blank, never a guess');
ok(vendorBillPaidDate(bill([{ TxnId: '13', TxnType: 'BillPaymentCheck' }]), pays) === '', 'unusable date -> blank');
ok(vendorBillPaidDate(bill(undefined), pays) === '' && vendorBillPaidDate(null, pays) === '' && vendorBillPaidDate(bill([]), null) === '', 'no links / null bill / null map are safe');
ok(vendorBillPaymentIds(bill([{ TxnId: 1, TxnType: 'BillPaymentCheck' }, { TxnId: null, TxnType: 'BillPaymentCheck' }])).join() === '1', 'payment ids are strings, nulls dropped');

// static wiring in the worker
const pay = grab('async function qbPayables(', w);
ok((pay.match(/vendor_paid_date: vendorPaidDate/g) || []).length === 2, 'both Invoice_Review rows and signed-proposal rows carry vendor_paid_date');
ok(/qbBatchById\('BillPayment'/.test(pay), 'BillPayments are fetched in batch (not one call per bill)');
ok(/qb_payables_vendor_paid_date_missing/.test(pay), 'a paid bill with no resolvable payment date is reported (not silent)');
const sync = grab('async function qbSyncPayments(', w);
ok(/Vendor_Paid_Date/.test(sync) && /updateRowVerified\(env, 'Work_Orders'/.test(sync), 'sync saves Vendor_Paid_Date on the work order with a read-back');
ok(/qb_sync_vendor_paid_date/.test(sync), 'a failed date save is logged + returned');
ok(/r\.vendor_paid === true && r\.vendor_paid_date/.test(sync), 'only saved when QuickBooks positively says paid and a date exists');
ok(/!\(r\.source === 'scope_signature' && r\.phase !== 'final'\)/.test(sync.slice(sync.indexOf('qb_sync_vendor_paid_date') - 1200)), 'a proposal DEPOSIT payment never stamps the work order paid date');

// ---------- vendor.html pure helpers ----------
const helpers = ['isPaidWO', 'isCancelledWO', 'paidDateOf', 'localDateStr', 'paidWithinDays', 'comparePaidDate', 'fmtPaidDate', 'partitionPaidCancelled'].map(f => grab('function ' + f + '(', html)).join('\n');
const H = new Function(helpers + '\nreturn { isPaidWO, isCancelledWO, paidDateOf, paidWithinDays, comparePaidDate, fmtPaidDate, partitionPaidCancelled };')();
const NOW = new Date(2026, 9, 19, 15, 0, 0);   // Oct 19 2026 local
const P = (id, d, extra) => Object.assign({ ID: id, Status: 'Paid', Vendor_Paid_Date: d, Created_Date: '2026-09-01' }, extra || {});
ok(H.isPaidWO({ Status: 'Paid' }) && H.isPaidWO({ Status: ' paid '.trim() }) && !H.isPaidWO({ Status: 'Complete' }) && !H.isPaidWO(null), 'isPaidWO');
ok(H.isCancelledWO({ Status: 'Cancelled' }) && H.isCancelledWO({ Status: 'canceled' }) && !H.isCancelledWO({ Status: 'Paid' }), 'isCancelledWO (both spellings)');
ok(H.paidDateOf({ Vendor_Paid_Date: '2026-10-12' }) === '2026-10-12' && H.paidDateOf({ Vendor_Paid_Date: '10/12/2026' }) === '' && H.paidDateOf({}) === '', 'paidDateOf accepts only YYYY-MM-DD');
// quick filters: 10 / 14 / 30 days (inclusive of the boundary day)
ok(H.paidWithinDays(P('a', '2026-10-19'), 10, NOW), 'paid today is within 10 days');
ok(H.paidWithinDays(P('a', '2026-10-09'), 10, NOW), 'exactly 10 days ago is still within 10 days');
ok(!H.paidWithinDays(P('a', '2026-10-08'), 10, NOW), '11 days ago is outside 10 days');
ok(H.paidWithinDays(P('a', '2026-10-05'), 14, NOW) && !H.paidWithinDays(P('a', '2026-10-04'), 14, NOW), '14-day boundary');
ok(H.paidWithinDays(P('a', '2026-09-19'), 30, NOW) && !H.paidWithinDays(P('a', '2026-09-18'), 30, NOW), '30-day boundary');
ok(!H.paidWithinDays(P('a', ''), 30, NOW), 'a paid job with no readable date never matches a "last N days" filter');
// sort: newest payment first; unknown dates last
const sorted = [P('old', '2026-09-30'), P('none', ''), P('new', '2026-10-18'), P('mid', '2026-10-10')].sort((a, b) => H.comparePaidDate(a, b, true)).map(x => x.ID);
ok(sorted.join() === 'new,mid,old,none', 'newest payment first, unknown date last: ' + sorted);
const asc = [P('old', '2026-09-30'), P('none', ''), P('new', '2026-10-18')].sort((a, b) => H.comparePaidDate(a, b, false)).map(x => x.ID);
ok(asc.join() === 'old,new,none', 'oldest first still keeps unknown dates last: ' + asc);
ok(H.fmtPaidDate('2026-10-05') === 'Oct 5, 2026' && H.fmtPaidDate('') === '' && H.fmtPaidDate('nope') === '', 'fmtPaidDate');
// folding order
const part = H.partitionPaidCancelled([{ ID: 1, Status: 'Cancelled' }, { ID: 2, Status: 'Accepted' }, { ID: 3, Status: 'Paid' }, { ID: 4, Status: 'Complete' }, { ID: 5, Status: 'Canceled' }, { ID: 6, Status: 'Paid' }]);
ok(part.active.map(x => x.ID).join() === '2,4' && part.paid.map(x => x.ID).join() === '3,6' && part.cancelled.map(x => x.ID).join() === '1,5', 'active first; paid and cancelled kept apart, each in original order');

// ---------- vendor.html wiring ----------
const tabs = html.slice(html.indexOf('<div class="tabs">'), html.indexOf('<div id="vtrBanner">'));
const order = [...tabs.matchAll(/id="(tab\w+)"/g)].map(m => m[1]);
ok(order.join() === 'tabOpen,tabAll,tabDue,tabInvoiced,tabPaid', 'PAID tab is the LAST tab: ' + order);
ok(/data-i18n="PAID"/.test(tabs) && /'PAID':'PAGADOS'/.test(html), 'PAID tab has a Spanish label');
ok(/switchTab\('paid'\)/.test(tabs), 'tab opens the paid view');
for (const d of [10, 14, 30, 0]) ok(new RegExp('setPaidRange\\(' + d + '\\)').test(html), 'quick filter button for ' + d);
ok(/value="paid-desc"/.test(html) && /value="paid-asc"/.test(html), 'payment-date sorts are in the sort menu');
ok(/if \(currentTab === 'paid'\) return fetchPaidWOs\(\)/.test(html), 'paid tab loads the paid list');
ok(/sortSel\.value = 'paid-desc'/.test(grab('function switchTab(', html)), 'paid tab defaults to most-recent-payment first');
ok(/\(window\._allWos \|\| window\._wos/.test(grab('function filterVendorWOs(', html)), 'filters start from the FULL list (backspacing a search brings jobs back)');
const rw = grab('function renderWOs(', html);
ok(/<details class="wo-fold"/.test(rw) && !/ open>/.test(rw.replace(/\(\(_foldOpen\[key\] \|\| searching\) \? ' open' : ''\)/, '')), 'paid and cancelled sections render collapsed (opened only by the vendor or by a search)');
ok(/PAID JOBS/.test(rw) && /CANCELLED JOBS/.test(rw), 'both folds exist');
ok(/currentTab === 'paid' \? \{ active: wos/.test(rw), 'the PAID tab itself is not folded');
ok(/Vendor_Paid_Date|paidDateOf\(wo\)/.test(rw), 'paid cards show the payment date');
// pricing must not leak: the vendor-facing list shows only the date, no customer money
ok(!/Customer_Total|Customer_Charge|Proposal_Credit/.test(rw), 'renderWOs shows no customer pricing');

console.log('vendor-paid-tab: ' + n + ' checks passed');
