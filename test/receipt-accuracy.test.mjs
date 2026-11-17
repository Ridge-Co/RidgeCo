// Receipt Reconciler accuracy build (Nov 17 2026): acceptance tests 1-8 of
// context/RECEIPT_RECONCILER_ACCURACY_BUILD_BRIEF_v1.0.md. Pure functions only, loaded from the real worker.js.
import assert from 'node:assert';
import { E } from './_receipt-engine.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const PROPS = [
  { ID: 2, Address: '928 N Calvert St', Active: 'FALSE' },   // the inactive twin: no units, no work orders
  { ID: 11, Address: '928 N Calvert St', Active: 'TRUE' },
  { ID: 12, Address: '807 N Calvert St', Active: 'TRUE' },
  { ID: 30, Address: '1220 Anywhere St', Active: 'TRUE' },
];
const UNITS = [
  ...[['27', '1F'], ['28', '1R'], ['29', '2F'], ['30', '2R'], ['31', '3F'], ['32', '3R'], ['33', 'Bsmt'], ['34', 'Carriage House']]
    .map(([ID, l]) => ({ ID, Property_ID: '11', Unit_Label: /^[0-9]/.test(l) ? 'Apt ' + l : l })),
  { ID: '40', Property_ID: '12', Unit_Label: 'Apt 3R' }, { ID: '41', Property_ID: '12', Unit_Label: 'Apt 1F' },
];
const WOS = [
  { ID: 'WO-1220', Property_ID: '11', Unit_ID: '32', Status: 'In Progress', Created_Date: '2026-09-23', Description: 'repair ceiling light' },
  { ID: 'WO-1300', Property_ID: '11', Unit_ID: '29', Status: 'Assigned', Created_Date: '2026-10-20', Description: 'replace faucet' },
  { ID: 'WO-1100', Property_ID: '11', Unit_ID: '28', Status: 'Paid', Completed_Date: '2026-09-23', Description: 'paint hall' },   // closed 9 days before 10/02
  { ID: 'WO-1101', Property_ID: '11', Unit_ID: '28', Status: 'Invoiced', Completed_Date: '2026-08-01', Description: 'old job' },  // closed long ago
];

// 1. Twin property: inactive ID 2 never wins; the active twin with units does; unit parsed.
{
  const m = E.matchReceiptProperty('928 n calvert apt 2R', PROPS, UNITS, WOS);
  ok(m && String(m.property.ID) === '11', 'resolves to the ACTIVE 928 N Calvert St (ID 11)');
  ok(E.matchReceiptCandidates(['928 n calvert'], PROPS, UNITS, WOS).every(c => String(c.property.ID) !== '2'), 'inactive property never returned');
  const h = E.receiptPropertyHint(['928 n calvert apt 2R'], PROPS, UNITS, WOS, '2026-10-02');
  eq(String(h.unit.id), '30', 'Apt 2R resolves to unit 30'); eq(h.unit.source, 'marker');
  // same score, both active: the one that really has units/work orders wins, not the first row
  const twins = [{ ID: 5, Address: '10 Elm St', Active: 'TRUE' }, { ID: 6, Address: '10 Elm St', Active: 'TRUE' }];
  eq(String(E.matchReceiptProperty('10 elm st', twins, [{ ID: 'u1', Property_ID: '6', Unit_Label: '1' }], []).property.ID), '6', 'tie goes to the property with units');
  eq(String(E.matchReceiptProperty('10 elm st', twins).property.ID), '5', 'no units known: lowest ID');
  ok(E.matchReceiptProperty('928 n calvert', [{ ID: 2, Address: '928 N Calvert St', Active: 'FALSE' }]) === null, 'only an inactive match = no match');
}

// 2. Work order reference: explicit beats address; a bare number that is both a WO and a house number is ambiguous.
{
  const h = E.receiptPropertyHint(['1220'], PROPS, UNITS, WOS, '2026-10-02');
  ok(h.po_ambiguous, 'po 1220 is ambiguous');
  ok(h.wo_ref.candidates.some(c => c.type === 'wo' && c.wo_id === 'WO-1220'), 'WO-1220 offered');
  ok(h.wo_ref.candidates.some(c => c.type === 'property' && c.address === '1220 Anywhere St'), 'the 1220 property offered');
  eq(h.wo_ref.candidates.find(c => c.type === 'wo').open_on_receipt_date, true, 'WO-1220 was open on 10/02');
  eq(h.property, null, 'nothing auto-picked');
  const s = E.receiptSuggestCore({ po: '1220', total: 34.95, date: '2026-10-02', store: 'Home Depot', items: ['bulb'] }, PROPS, WOS, [], [], { units: UNITS, myCards: [] });
  ok(s.flags.includes('po_ambiguous') && s.action === 'need_property', 'suggestion flags it and does not pick');
  const x = E.receiptPropertyHint(['WO-1220'], PROPS, UNITS, WOS, '2026-10-02');
  eq(String(x.property.ID), '11'); eq(String(x.unit.id), '32'); eq(x.wo_ref.confidence, 'explicit');
  ok(!x.po_ambiguous, 'explicit is not ambiguous');
  const y = E.receiptSuggestCore({ po: 'work order 1220', total: 34.95, date: '2026-10-02', store: 'Home Depot', items: [] }, PROPS, WOS, [], [], { units: UNITS, myCards: [] });
  eq(y.suggested_wo.id, 'WO-1220', 'explicit WO becomes the suggested WO');
}

// 3. Unit parsing.
{
  const p11 = PROPS[1], p12 = PROPS[2];
  const u = (t, p) => { const r = E.receiptUnitHint([t], p, UNITS); return r && r.label; };
  eq(u('928 n calvert apt 3R', p11), 'Apt 3R'); eq(u('#2F', p11), 'Apt 2F'); eq(u('unit B', p11), null, 'unit B does not exist: no guess');
  eq(u('Carriage House', p11), 'Carriage House'); eq(u('bsmt', p11), 'Bsmt'); eq(u('807 n calvert apt 3R', p12), 'Apt 3R');
  eq(u('928 n calvert 1F', p11), 'Apt 1F', 'bare token right after the street address'); eq(u('apt 3R', p12), 'Apt 3R');
  eq(E.receiptUnitHint(['apt 2R'], p11, []), null, 'no units known: null');
}

// 4. Cards.
{
  const mine = ['1661', '7508', '2326', '0930', '1004', '4157', '2317'], cust = ['7442'];
  eq(E.receiptCardStatus('1661', mine, cust), 'mine'); eq(E.receiptCardStatus('7442', mine, cust), 'customer');
  eq(E.receiptCardStatus('9999', mine, cust), 'unknown'); eq(E.receiptCardStatus('', mine, cust), 'not_read'); eq(E.receiptCardStatus('12', mine, cust), 'not_read');
  eq(E.receiptCardStatus('XXXX 7442', mine, cust), 'customer', 'last 4 digits are taken from a longer string');
  eq(E.receiptCardLast4Strict('1234'), '1234'); eq(E.receiptCardLast4Strict('12345'), ''); eq(E.receiptCardLast4Strict('12a4'), ''); eq(E.receiptCardLast4Strict(''), '');
  const base = { po: '928 n calvert', total: 40, date: '2026-10-02', store: 'Home Depot', items: [] };
  const ctx = { units: UNITS, myCards: mine };
  const c1 = E.receiptSuggestCore({ ...base, card: '7442' }, PROPS, WOS, [], cust, ctx);
  eq(c1.category, 'customer_paid', 'customer card is still excluded'); eq(c1.card_status, 'customer'); ok(c1.property_hint.property, 'and still carries the property hint');
  const c2 = E.receiptSuggestCore({ ...base, po: 'bmore', card: '7442' }, PROPS, WOS, [], cust, ctx);
  ok(c2.flags.includes('card_conflict'), 'customer card + bmore PO = card_conflict'); eq(c2.category, 'company');
  ok(E.receiptSuggestCore({ ...base, card: '9999' }, PROPS, WOS, [], cust, ctx).flags.includes('card_unknown'), 'unknown card warns');
  ok(E.receiptSuggestCore({ ...base, card: '' }, PROPS, WOS, [], cust, ctx).flags.includes('card_not_read'), 'unreadable card warns');
  ok(!E.receiptSuggestCore({ ...base, card: '1661' }, PROPS, WOS, [], cust, ctx).flags.some(f => f.startsWith('card_')), 'my own card: no card flag');
  ok(!E.receiptSuggestCore({ ...base, card: '9999' }, PROPS, WOS, [], cust).flags.includes('card_unknown'), 'old callers (no ctx) see no new flags');
  const bm = E.receiptSuggestCore({ ...base, po: 'bmore' }, PROPS, WOS, [], cust, ctx);
  eq(bm.category, 'company'); ok(bm.property_hint, 'a business-expense card still carries property_hint');
}

// 5. Duplicates.
{
  const hd = (id, amt, date, store, status, inv) => ({ ID: id, Total: String(amt), Receipt_Date: date, Vendor: store, Status: status || 'pending', Invoice_Number: inv || '', Active: 'TRUE' });
  const a = hd(7, 43.23, '2026-09-24', 'Home Depot', 'pending'), b = hd(9, 43.23, '2026-09-24', 'THE HOME DEPOT #1234', 'pending');
  ok(E.receiptDupSignals({ total: 43.23, date: '2026-09-24', store: 'The Home Depot #1234' }, [], [a, b], { selfQueueId: 9 }).some(s => s.queue_id === 7 && s.type === 'other_queue_row'), 'screenshot pair: twin flagged, both pending');
  ok(E.receiptDupSignals({ total: 43.23, date: '2026-09-24', store: 'Home Depot' }, [], [a, b], { selfQueueId: 7 }).some(s => s.queue_id === 9), 'and the other way round');
  eq(E.receiptDupSignals({ total: 43.23, date: '2026-09-24', store: 'Home Depot' }, [], [a], { selfQueueId: 7 }).length, 0, 'never flags itself');
  const sig = (d, amt, store) => E.receiptDupSignals({ total: amt, date: d, store: store || 'Home Depot' }, [], [a]);
  ok(sig('2026-09-27', 43.23).length === 1, '+3 days flagged'); ok(sig('2026-09-21', 43.23).length === 1, '-3 days flagged');
  ok(sig('2026-09-28', 43.23).length === 0, '+4 days not flagged'); ok(sig('2026-09-24', 43.24).length === 0, 'different amount not flagged');
  ok(sig('2026-09-24', 43.23, "Lowe's").length === 0, 'different store not flagged');
  const byInv = E.receiptDupSignals({ total: 43.23, date: '2026-12-01', store: 'Hd Supply', invoice: 'INV-88-1234' }, [], [hd(3, 43.23, '2026-09-24', 'Home Depot', 'confirmed', 'inv88 1234')]);
  ok(byInv.length === 1 && byInv[0].by === 'invoice_number' && byInv[0].type === 'queue_dispositioned', 'same invoice number + amount flagged across dates/stores');
  eq(E.receiptDupSignals({ total: 43.23, date: '2026-12-01', store: 'Hd Supply', invoice: 'INV-88-1234' }, [], [hd(3, 50.00, '2026-09-24', 'Home Depot', 'confirmed', 'inv88 1234')]).length, 0, 'same invoice number but different amount: no');
  ok(E.receiptDupSignals({ total: 43.23, date: '2026-09-25', store: 'Home Depot' }, [{ ID: 4, Amount: '43.23', Date: '2026-09-24', Store: 'Home Depot', WO_ID: 'WO-1', Active: 'TRUE' }], []).some(s => s.type === 'receipts'), 'compared with Receipts too');
  eq(E.receiptDupSignals({ total: -43.23, date: '2026-09-24', store: 'Home Depot' }, [], [a]).length, 0, 'refunds are not compared');
  eq(E.receiptDupSignals({ total: 43.23, date: '2026-09-24', store: 'Home Depot' }, [], [{ ...a, Active: 'FALSE' }]).length, 0, 'inactive rows ignored');
}

// 6. Vendor-invoice name list.
{
  const L = E.RECEIPT_VENDOR_INVOICE_NAMES_DEFAULT;
  ok(E.receiptIsVendorInvoice('Alex Busey', L), 'Alex Busey'); ok(E.receiptIsVendorInvoice('K&C Cleaning LLC', L), 'K&C Cleaning');
  ok(!E.receiptIsVendorInvoice('Home Depot', L), 'Home Depot unaffected'); ok(!E.receiptIsVendorInvoice('', L), 'blank vendor');
  ok(E.receiptIsVendorInvoice('Acme Plumbing', ['acme plumbing']), 'list is whatever Config says'); ok(!E.receiptIsVendorInvoice('Acme Plumbing', []), 'empty list: nothing excluded');
  const s = E.receiptSuggestCore({ po: '928 n calvert', total: 300, date: '2026-10-02', store: 'Alex Busey', items: [] }, PROPS, WOS, [], [], { units: UNITS, myCards: [], vendorInvoiceNames: L });
  eq(s.category, 'vendor_invoice'); eq(s.action, 'exclude');
  eq(E.receiptSuggestCore({ po: '928 n calvert', total: 30, date: '2026-10-02', store: 'Home Depot', items: [] }, PROPS, WOS, [], [], { units: UNITS, myCards: [], vendorInvoiceNames: L }).category, 'billable');
}

// 7. Rules.
{
  const rules = [
    { ID: '1', Match_Vendor: 'Google LLC', Min_Amount: '', Max_Amount: '60', Action: 'business', Auto: 'TRUE', Active: 'TRUE' },
    { ID: '2', Match_Vendor: 'Apple Valley Waste', Action: 'property', Property_ID: '99', Auto: 'TRUE', Active: 'TRUE' },
    { ID: '3', Match_Vendor: 'Lowes', Action: 'business', Auto: 'TRUE', Active: 'FALSE' },
  ];
  const row = (o) => ({ vendor: 'Google LLC', total: 12, category: 'billable', card_status: 'mine', duplicate: false, too_old: false, ...o });
  const g = E.receiptRuleDecision(row({}), rules);
  ok(g && g.rule.ID === '1' && g.auto, 'Google LLC always-business auto-confirms');
  for (const [name, o] of [['customer card', { card_status: 'customer' }], ['refund', { category: 'refund', total: -12 }], ['duplicate flag', { duplicate: true }], ['before cutoff', { too_old: true }], ['vendor invoice', { category: 'vendor_invoice' }]]) {
    const d = E.receiptRuleDecision(row(o), rules);
    ok(d && !d.auto && d.blocked.length, 'same rule does NOT auto-confirm on ' + name);
  }
  eq(E.receiptRuleDecision(row({ total: 75 }), rules), null, 'amount outside the range: rule does not apply');
  const p = E.receiptRuleDecision(row({ vendor: 'Apple Valley Waste Inc', total: 88 }), rules);
  ok(p && p.rule.Action === 'property' && p.rule.Property_ID === '99' && p.auto, 'always-this-property rule');
  eq(E.receiptRuleDecision(row({ vendor: 'Lowes' }), rules), null, 'deactivated rule never applies');
  eq(E.receiptRuleDecision(row({ vendor: 'Someone Else' }), rules), null, 'no match');
  const manual = E.receiptRuleDecision(row({}), [{ ...rules[0], Auto: 'FALSE' }]);
  ok(manual && !manual.auto && manual.blocked.length === 0, 'Auto=FALSE: pre-select only');
}

// 8. Closed-WO window.
{
  const r = (date) => E.rankReceiptWOs({ items: [] }, WOS.filter(w => w.Property_ID === '11'), { receiptDate: date });
  const ids = r('2026-10-02').map(w => w.id);
  ok(ids.includes('WO-1100'), 'closed 9 days before: shown'); ok(!ids.includes('WO-1101'), 'closed 62 days before: not shown');
  eq(r('2026-10-02').find(w => w.id === 'WO-1100').closed_recent, true);
  ok(ids.indexOf('WO-1220') < ids.indexOf('WO-1100') && ids.indexOf('WO-1300') < ids.indexOf('WO-1100'), 'open ones rank above closed');
  ok(r('2026-10-22').map(w => w.id).includes('WO-1100'), 'closed 29 days before: shown'); ok(r('2026-10-23').map(w => w.id).includes('WO-1100'), 'closed exactly 30 days before: shown'); ok(!r('2026-10-24').map(w => w.id).includes('WO-1100'), 'closed 31 days before: not shown');
  ok(!E.rankReceiptWOs({ items: [] }, WOS).map(w => w.id).includes('WO-1100'), 'no receipt date: old behaviour, open only');
  const s = E.receiptSuggestCore({ po: '928 n calvert', total: 20, date: '2026-10-02', store: 'Home Depot', items: [] }, PROPS, [WOS[2]], [], [], { units: UNITS, myCards: [] });
  eq(s.action, 'need_wo', 'only a closed WO: still need a WO, not a silent pick'); ok(s.flags.includes('no_open_wo')); ok(s.alternates.some(a => a.id === 'WO-1100'), 'but the closed WO is offered');
  const inv = E.receiptSuggestCore({ po: 'WO-1100', total: 20, date: '2026-10-02', store: 'Home Depot', items: [] }, PROPS, WOS, [], [], { units: UNITS, myCards: [] });
  ok(inv.flags.includes('wo_already_invoiced'), 'explicit reference to a Paid WO keeps wo_already_invoiced');
}

console.log(`receipt-accuracy: ${n} assertions passed`);
