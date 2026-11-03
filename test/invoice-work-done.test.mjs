// Nov 2 2026 (Brett, invoice 1774 / WO-1253): customer invoices must say what work was done.
//  - checklist items print in past tense ("Reattached siding"), "— resolved" when we cannot rephrase
//  - items with a vendor reason code are LEFT OFF and flagged, never claimed resolved
//  - access codes in a WO description never reach a customer-facing line
//  - vendors cannot mark Complete / submit an invoice while items are unresolved (server + portal + share link)
//  - "Mark all resolved" exists on the Hub only
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const vendorHtml = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
const woHtml = fs.readFileSync(new URL('../wo.html', import.meta.url), 'utf8');
const hubHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function grab(name, text = src) {
  const i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const names = ['looksLikeAccessDetail', 'sanitizeCustomerText', 'parseChecklistItems', 'clPastTense', 'checklistItemPastTense',
  'workDoneFromChecklist', 'workDoneBlock', 'workDoneWarnings', 'scopeSafeTitle', 'checklistUnresolvedItems', 'checklistGateMessage', 'mergeVendorChecklist', 'scopeRepairNewDescription', 'scopeRepairPlanLines', 'scopeRepairMatchMilestone'];
const H = new Function(names.map(n => grab(n)).join('\n') + '\nreturn { ' + names.join(', ') + ' };')();

const cl = items => JSON.stringify(items);

test('checklist items become past-tense lines; unknown verbs fall back to "— resolved"', () => {
  const wd = H.workDoneFromChecklist(cl([
    { t: 'Reattach siding using adhesive', done: false, code: '' },
    { t: 'Kitchen: Replace faucet', done: true, code: '' },
    { t: 'Painted trim', done: true },
    { t: 'Siding on north wall', done: false },
  ]));
  assert.deepStrictEqual(wd.lines, ['Reattached siding using adhesive', 'Kitchen: Replaced faucet', 'Painted trim', 'Siding on north wall — resolved']);
  assert.strictEqual(H.workDoneBlock({ Checklist: cl([{ t: 'Fix gate latch' }]) }), 'Work completed:\n• Fixed gate latch');
});

test('reason-coded items are left off and flagged in the preview warnings', () => {
  const wo = { Checklist: cl([{ t: 'Replace porch light', done: true }, { t: 'Repaint garage', done: false, code: 'estimate' }, { t: 'Check attic', done: false, code: 'access', why: 'locked' }]) };
  const wd = H.workDoneFromChecklist(wo.Checklist);
  assert.deepStrictEqual(wd.lines, ['Replaced porch light']);
  assert.strictEqual(wd.excluded.length, 2);
  const w = H.workDoneWarnings(wo);
  assert.ok(w.length === 1 && /2 checklist items are left OFF/.test(w[0]) && /Repaint garage/.test(w[0]) && /needs estimate/.test(w[0]));
  assert.ok(!H.workDoneBlock(wo).includes('Repaint garage'));
});

test('WO-1253: access codes in the description never reach the customer line; items still list', () => {
  const codes = 'Access codes temporary: 085352, 074240, 034211\n';
  assert.strictEqual(H.sanitizeCustomerText(codes), '');
  assert.strictEqual(H.sanitizeCustomerText('Fix siding\nLockbox 1234\nRepaint trim'), 'Fix siding\nRepaint trim');
  assert.strictEqual(H.scopeSafeTitle({ Title: 'WO WO-1253 — ' + codes, WO_ID: 'WO-1253' }), 'WO WO-1253');
  assert.strictEqual(H.scopeSafeTitle({ Title: 'WO WO-1200 — Fix fence', WO_ID: 'WO-1200' }), 'WO WO-1200 — Fix fence');
  assert.strictEqual(H.scopeSafeTitle({ Title: '', WO_ID: '' }), 'scope of work');
  const wd = H.workDoneFromChecklist(cl([{ t: 'Reattach siding' }, { t: 'Door code is 4471' }]));
  assert.deepStrictEqual(wd.lines, ['Reattached siding']);
  assert.strictEqual(wd.withheld.length, 1);
  assert.ok(/access code or key detail/.test(H.workDoneWarnings({ Checklist: cl([{ t: 'Door code is 4471' }]) })[0]));
});

test('ordinary job text is not mistaken for an access detail', () => {
  ['Replace 4 inch vent', 'Installed fan in 2026 remodel', 'Fixed code violation on stairs', 'Re-caulk tub'].forEach(t => assert.strictEqual(H.looksLikeAccessDetail(t), false, t));
});

test('empty / malformed checklist yields nothing and does not throw', () => {
  ['', null, undefined, '[]', 'not json', '{"a":1}'].forEach(raw => {
    assert.deepStrictEqual(H.workDoneFromChecklist(raw).lines, []);
    assert.strictEqual(H.workDoneBlock({ Checklist: raw }), '');
    assert.deepStrictEqual(H.workDoneWarnings({ Checklist: raw }), []);
  });
});

test('gate: unresolved = not done AND no reason; message is English or Spanish', () => {
  const raw = cl([{ t: 'a', done: true }, { t: 'b', done: false }, { t: 'c', done: false, code: 'parts' }, { t: 'd' }]);
  assert.deepStrictEqual(H.checklistUnresolvedItems(raw).map(i => i.t), ['b', 'd']);
  assert.deepStrictEqual(H.checklistUnresolvedItems('[]'), []);
  const en = H.checklistGateMessage(2, 'invoice', 'en'), es = H.checklistGateMessage(2, 'invoice', 'es');
  assert.ok(/can't submit an invoice yet: 2 checklist items are not checked off/.test(en));
  assert.ok(/Todavía no puede enviar una factura: 2 elementos/.test(es) && /motivo/.test(es));
  assert.ok(/mark this job complete/.test(H.checklistGateMessage(1, 'complete', 'en')) && /marcar este trabajo como completo/.test(H.checklistGateMessage(1, 'complete', 'es')));
});

test('share-link vendors can tick/reason existing items only (no add, rename, remove)', () => {
  const existing = cl([{ t: 'Fix gate', done: false }, { t: 'Paint', done: false, code: 'parts', why: 'x', d: 'Painted the fence' }]);
  const incoming = cl([{ t: 'Fix gate', done: true }, { t: 'Paint', done: false, code: 'bogus' }, { t: 'Injected item', done: true }]);
  const out = H.mergeVendorChecklist(existing, incoming);
  assert.deepStrictEqual(out.map(i => i.t), ['Fix gate', 'Paint']);
  assert.strictEqual(out[0].done, true);
  assert.strictEqual(out[1].code, '');       // invalid code dropped
  assert.strictEqual(out[1].d, 'Painted the fence');   // generated wording is not editable by the vendor
});

test('server wiring: status Complete and bill submit are gated for vendors; Hub bills are not', () => {
  const us = grab('updateStatus');
  assert.ok(/changedRole === 'vendor' && \(body\.status === 'Complete'/.test(us) && /checklistGateResponse\(/.test(us));
  assert.ok(us.indexOf('checklistGateResponse(') < us.indexOf('await updateWOFields(env, body.wo_id, fields)'), 'gate runs before any write');
  const ab = grab('addVendorBill');
  assert.ok(/Entered_By \|\| ''\)\.toLowerCase\(\) !== 'hub'/.test(ab) && /checklistGateResponse\(/.test(ab));
  assert.ok(/code: 'checklist_incomplete'/.test(src));
  assert.ok(/path === '\/wo\/shared\/checklist'\)\s+return await woSharedChecklist/.test(src));
});

test('scope invoices: only the FINAL round lists the work; titles are sanitized on every milestone path', () => {
  const bm = src.slice(src.indexOf('const isFinalRound ='), src.indexOf('const isFinalRound =') + 900);
  assert.ok(/isFinalRound \? await scopeWorkDoneForInvoice/.test(bm));
  assert.ok(/mi === picked\.length - 1/.test(src));
  assert.ok(!/\(s\.Title \|\| 'scope of work'\)/.test(src), 'no raw Scope.Title left in invoice descriptions');
  assert.ok(/workDoneFB\.block/.test(src), 'final-balance invoice lists the work too');
  assert.ok(/looksLikeAccessDetail\(wo\.Description\) \? sanitizeCustomerText/.test(src), 'push-to-scope title is sanitized at the source');
});

test('buildLaborDescription: checklist follows typed text and replaces generic WO text', () => {
  const lab = new Function(['englishOnly', 'isTrueish', 'laborEntryText'].map(n => grab(n)).join('\n') + '\n' + names.map(n => grab(n)).join('\n') + '\n' + grab('buildLaborDescription') + '\nreturn buildLaborDescription;')();
  const wo = { Description: 'Access codes temporary: 085352, 074240\n', Checklist: cl([{ t: 'Reattach siding' }]) };
  assert.strictEqual(lab({ ID: 'B1', Invoice_Description: 'Siding repair' }, [], wo), 'Siding repair\nWork completed:\n• Reattached siding');
  assert.strictEqual(lab({ ID: 'B1' }, [], wo), 'Work completed:\n• Reattached siding');
  assert.strictEqual(lab({ ID: 'B1' }, [], { Description: 'Access codes temporary: 085352\n', Checklist: '' }), '', 'codes never fall through to the invoice');
});

test('portal + share link: client-side gate with en/es text; Mark all resolved is Hub-only', () => {
  assert.ok(/function checklistBlockMsg/.test(vendorHtml) && /Todavía no puede/.test(vendorHtml));
  assert.ok(/openBillModal[\s\S]{0,900}checklistBlockMsg\(_open, 'invoice'\)/.test(vendorHtml));
  assert.ok(/persistChecklist\(idx\)\.then/.test(vendorHtml), 'status posts only after the checklist is saved');
  assert.ok(/function clBlockMsg/.test(woHtml) && /Todavía no puede/.test(woHtml) && /\/wo\/shared\/checklist/.test(woHtml));
  assert.ok(/function markChecklistAllResolved/.test(hubHtml) && /Mark all resolved/.test(hubHtml));
  assert.ok(!/Mark all resolved|markChecklistAllResolved/.test(vendorHtml + woHtml), 'vendors never get the button');
});

test('repair planner (invoice 1774): final milestone line gets safe title + work list; amounts untouched; other lines left alone', () => {
  const ctx = { tradeName: 'General', addr: '411 West 23rd St', safeTitle: 'WO WO-1253', block: 'Work completed:\n• Reattached siding', allMilestones: [{ ID: 'm1', Label: 'Deposit', Sequence: 1 }, { ID: 'm2', Label: 'Final', Sequence: 2 }] };
  const existing = { Line: [
    { Id: '1', DetailType: 'SalesItemLineDetail', Amount: 830, Description: 'General — WO WO-1253 — Access codes temporary: 085352, 074240 — Final (411 West 23rd St)', SalesItemLineDetail: { Qty: 1, UnitPrice: 830, ItemRef: { value: '9' } } },
    { Id: '2', DetailType: 'SalesItemLineDetail', Amount: -100, Description: 'Less: already invoiced', SalesItemLineDetail: {} },
    { DetailType: 'SubTotalLineDetail', Amount: 730 },
  ] };
  const plan = H.scopeRepairPlanLines('milestone', ctx, existing, [{ ID: 'm2', Label: 'Final', Sequence: 2 }]);
  assert.strictEqual(plan.changes.length, 1);
  assert.strictEqual(plan.lines.length, 2, 'subtotal line dropped, the rest kept');
  assert.strictEqual(plan.lines[0].Description, 'General — WO WO-1253 — Final (411 West 23rd St)\nWork completed:\n• Reattached siding');
  assert.strictEqual(plan.lines[0].Amount, 830);
  assert.deepStrictEqual(plan.lines[0].SalesItemLineDetail, existing.Line[0].SalesItemLineDetail);
  assert.strictEqual(plan.lines[1].Description, 'Less: already invoiced');
  assert.ok(plan.finalListed);
  assert.ok(!/085352|074240/.test(JSON.stringify(plan.lines)), 'no access codes remain');
  // a deposit milestone (not the last) never lists the work
  const dep = H.scopeRepairPlanLines('milestone', ctx, { Line: [{ DetailType: 'SalesItemLineDetail', Amount: 500, Description: 'General — x — Deposit (411 West 23rd St)' }] }, [{ ID: 'm1', Label: 'Deposit', Sequence: 1 }]);
  assert.ok(!/Work completed/.test(dep.lines[0].Description) && !dep.finalListed);
  // already-correct wording produces no change
  const again = H.scopeRepairPlanLines('milestone', ctx, { Line: plan.lines }, [{ ID: 'm2', Label: 'Final', Sequence: 2 }]);
  assert.strictEqual(again.changes.length, 0);
});

test('repair endpoint: description-only, total/balance read back, paid needs explicit OK, no broker write path', () => {
  const fn = src.slice(src.indexOf('async function qbRepairScopeInvoice('));
  assert.ok(/needs_allow_paid: true/.test(fn) && /read-back check failed/.test(fn) && /Not touching it/.test(fn));
  assert.ok(/path === '\/qb\/repair-scope-invoice'\)\s+return await qbRepairScopeInvoice/.test(src));
  const hubWrite = src.slice(src.indexOf('HUB_PROD_WRITE_PATHS'), src.indexOf('HUB_PROD_WRITE_PATHS') + 1500);
  assert.ok(!/repair-scope-invoice/.test(hubWrite), 'QuickBooks writes stay behind Brett, not the broker');
  assert.ok(/repairScopeInvoice\(/.test(hubHtml) && /Update it in QuickBooks/.test(hubHtml));
});
