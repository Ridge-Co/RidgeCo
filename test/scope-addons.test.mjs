// Optional add-ons on scope proposals (Oct 13 2026, Brett): "one job plus an optional add-on that is
// highly recommended" vs "a completely different way to do the job". Tests the REAL shipped code:
// pricing (price the whole job, show the difference), the customer boundary (no vendor cost), signing
// (a declined add-on adds nothing to subtotal / vendor cost / trade vote / schedule), the proposal-text
// "all options" doc, plus scope-proposal.html's checkbox/total logic and the Message Queue English view.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const proposalHtml = fs.readFileSync(new URL('../scope-proposal.html', import.meta.url), 'utf8');
const mqHtml = fs.readFileSync(new URL('../message-queue.html', import.meta.url), 'utf8');
function grabFrom(text, name, isAsync) {
  const sig = (isAsync ? 'async function ' : 'function ') + name + '(';
  const i = text.indexOf(sig);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const grab = (n, a) => grabFrom(src, n, a);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const pc = { tiers: [[1000, 0.35, 50], [2000, 0.30, 0], [null, 0.25, 0]], adminFee: 85, adminFeeThreshold: 3000, cardFeeMult: 1.03, roundTo: 5 };

const H = new Function(
  [grab('calcTieredEstimate'), grab('scopeItemsPricing'), grab('scopeCleanVariants'), grab('scopeCleanItems'), grab('scopeComputeMilestoneAmounts')].join('\n') +
  '\nreturn { calcTieredEstimate, scopeItemsPricing, scopeCleanVariants, scopeCleanItems, scopeComputeMilestoneAmounts };'
)();

// ---- storage: `optional` survives scopeCleanItems, and old items keep their exact shape ----
{
  const c = H.scopeCleanItems([
    { id: 'li1', description: 'Flash and patch', variants: [{ key: 'v1', vendor_cost: 1300 }] },
    { id: 'li2', description: 'Silvercoat', optional: true, variants: [{ key: 'v1', vendor_cost: 1600 }] },
    { id: 'li3', description: 'Other', optional: false, variants: [{ key: 'v1', vendor_cost: 5 }] },
  ]);
  ok(!('optional' in c[0]) && !('optional' in c[2]), 'base items carry no optional key (old shape unchanged)');
  ok(c[1].optional === true, 'an optional add-on keeps optional:true through save');
}

// ---- pricing: add-on is the difference the add-on makes to the whole job ----
const items = H.scopeCleanItems([
  { id: 'li1', description: 'Flash and patch roof', variants: [{ key: 'v1', vendor_cost: 1300 }] },
  { id: 'li2', description: 'Silvercoat', optional: true, variants: [{ key: 'v1', vendor_cost: 1600 }] },
]);
const P = H.scopeItemsPricing(items, pc, { mode: 'markup' });
const base = H.calcTieredEstimate(1300, pc).finalPrice, whole = H.calcTieredEstimate(2900, pc).finalPrice;
ok(P.subtotal === base, 'base subtotal excludes the add-on (' + base + ')');
ok(P.vendorCostTotal === 1300, 'vendor cost total excludes the add-on');
ok(P.items[1].optional === true && P.items[0].optional === undefined, 'priced items keep the optional flag');
ok(P.items[1].variants[0].price === whole - base, 'add-on price = price(base+add-on) - price(base) = ' + (whole - base));
ok(P.items[1].variants[0].price >= 1600, 'add-on is never priced below its own vendor cost');
ok(P.subtotal + P.items[1].variants[0].price === whole, 'base + add-on lands exactly on the whole-job price');
// a manual override on the add-on wins
{
  const it2 = H.scopeCleanItems([{ id: 'a', description: 'A', variants: [{ key: 'v1', vendor_cost: 1300 }] }, { id: 'b', description: 'B', optional: true, variants: [{ key: 'v1', vendor_cost: 1600, price_override: 2000 }] }]);
  ok(H.scopeItemsPricing(it2, pc, { mode: 'markup' }).items[1].variants[0].price === 2000, 'price_override on an add-on is respected');
}
// an old scope (no add-ons) prices exactly as before
{
  const old = H.scopeCleanItems([{ id: 'a', description: 'A', variants: [{ key: 'v1', vendor_cost: 1300 }, { key: 'v2', vendor_cost: 1600 }] }]);
  const r = H.scopeItemsPricing(old, pc, { mode: 'markup' });
  ok(r.subtotal === base && r.items[0].variants[1].price === H.calcTieredEstimate(1600, pc).finalPrice, 'alternatives (pick one) price exactly as before');
}

// ---- customer boundary: add-on flag passes through, vendor cost never does ----
const stored = P.items;
const viewStubs = {
  scopeProposalLinkAuth: async () => ({ s: { ID: '5', Property_ID: '1', Proposal_Items_JSON: JSON.stringify(stored) } }),
  scopeAddr: async () => '1 Main St', scopeProposalPhotos: async () => [],
  scopeParsePaymentSchedule: () => [{ label: 'Deposit', percent: 40, trigger: 'upfront' }, { label: 'Final', percent: 60, trigger: 'completion' }],
  scopeValidatePaymentSchedule: (m) => ({ schedule: m }), scopeMaxUpfrontPct: async () => 33.34,
  scopeComputeMilestoneAmounts: H.scopeComputeMilestoneAmounts, scopeDefaultPaymentSchedule: () => [],
  scopeSigTab: async () => {}, fetchTab: async () => [], paymentMilestonesTab: async () => {}, json: (o) => o,
};
{
  const view = new Function(...Object.keys(viewStubs), grab('scopeProposalView', true) + '\nreturn scopeProposalView;')(...Object.values(viewStubs));
  const out = await view({}, { searchParams: { get: () => 't' } });
  ok(out.items[1].optional === true && out.items[0].optional === undefined, 'customer payload flags the add-on');
  ok(out.subtotal === base, 'customer base total excludes the add-on');
  ok(!/vendor_cost/.test(JSON.stringify(out)), 'customer payload has no vendor_cost');
  eq(out.schedule.map(m => m.customer_amount), [+(0.4 * base).toFixed(2), +(base - +(0.4 * base).toFixed(2)).toFixed(2)], 'schedule is computed on the base total');
}

// ---- signing: ticked vs declined ----
const SF = new Function(grab('scopeComputeMilestoneAmounts') + '\n' + grab('scopeScheduleAddonProblem') + '\nreturn { scopeComputeMilestoneAmounts, scopeScheduleAddonProblem };')();
const tel2 = [];
async function sign(selections, schedule) {
  const added = []; let signedRow = null; const mil = [];
  const stubs = {
    scopeProposalLinkAuth: async () => ({ s: { ID: '5', Property_ID: '1', WO_ID: '', Vendor_ID: '3', Proposal_Items_JSON: JSON.stringify(stored), Line_Items: JSON.stringify(items) } }),
    scopeSigTab: async () => {}, fetchTab: async () => [], scopeParseItems: s => JSON.parse(s.Line_Items || '[]'),
    ensureColumns: async () => {}, paymentMilestonesTab: async () => {}, scopeMaxUpfrontPct: async () => 33.34,
    scopeParsePaymentSchedule: () => [{ label: 'Deposit', percent: 40, trigger: 'upfront' }, { label: 'Final', percent: 60, trigger: 'completion' }],
    scopeValidatePaymentSchedule: (m) => ({ schedule: m }), scopeDefaultPaymentSchedule: () => [],
    scopeComputeMilestoneAmounts: H.scopeComputeMilestoneAmounts,
    addRow: async (env, tab, row) => { if (tab === 'Scope_Signatures') signedRow = row; else mil.push(row); return { json: async () => ({ id: 'x' + (added.push(1)) }) }; },
    updateRow: async () => {}, setApprovalStage: async () => {}, estimateSmsContext: async () => ({}), sendTemplatedSms: async () => {}, vendorFirstName: () => 'V',
    json: (o) => o,
  };
  const fn = new Function(...Object.keys(stubs), grab('scopeProposalSign', true) + '\nreturn scopeProposalSign;')(...Object.values(stubs));
  const out = await fn({}, { t: 'x', signer_name: 'Jane Owner', signature_png: 'data:image/png;base64,' + 'A'.repeat(200), selections }, '1.1.1.1', 'ua');
  return { out, signedRow, mil };
}
{
  const declined = await sign({ li1: 'v1' });
  ok(declined.out.ok && declined.out.subtotal === base, 'declined add-on: subtotal is the base only');
  eq(JSON.parse(declined.signedRow.Selections_JSON), { li1: 'v1' }, 'declined add-on is not in the signed selections');
  ok(declined.signedRow.Vendor_Cost_Total === '1300', 'declined add-on: vendor cost total is the base only (vendor is not billed for it)');
  ok(declined.mil.reduce((s, m) => s + +m.Customer_Amount, 0).toFixed(2) === base.toFixed(2), 'declined: milestones foot to the base total');
  const absent = await sign({});
  ok(absent.out.subtotal === base, 'no selection at all still signs the base job and declines the add-on');
  const bogus = await sign({ li1: 'v1', li2: '__none__' });
  ok(bogus.out.subtotal === base && !('li2' in JSON.parse(bogus.signedRow.Selections_JSON)), 'a bogus add-on key is treated as declined, never silently added');

  const taken = await sign({ li1: 'v1', li2: 'v1' });
  ok(taken.out.subtotal === whole, 'ticked add-on: subtotal = whole-job price ' + whole);
  eq(JSON.parse(taken.signedRow.Selections_JSON), { li1: 'v1', li2: 'v1' }, 'ticked add-on is recorded in selections');
  ok(taken.signedRow.Vendor_Cost_Total === '2900', 'ticked add-on: vendor cost total = 1300 + 1600');
  ok(taken.mil.reduce((s, m) => s + +m.Customer_Amount, 0).toFixed(2) === whole.toFixed(2), 'ticked: the 40/60 milestones foot to the new total');
  ok(+taken.mil[0].Customer_Amount === +(0.4 * whole).toFixed(2), 'ticked: deposit is 40% of the new total');
}

// ---- proposal text lists every option; add-ons are not in the Total ----
{
  const body = grab('scopeProposal', true);
  ok(/Optional add-ons \(NOT included in the total below/.test(body), 'proposal text has an Optional add-ons block');
  ok(/Choose one:/.test(body), 'proposal text lists pick-one alternatives with their prices');
  ok(/base job, before any optional add-ons/.test(body), 'the Total line says it is the base job when add-ons exist');
  ok(/Every line item is marked as an optional add-on/.test(body), 'a scope with only add-ons is refused with a clear message');
}

// ---- scope-proposal.html: checkbox + live totals ----
{
  const g = name => grabFrom(proposalHtml, name, false);
  const boxes = {};   // name -> {checked,value}
  const radios = {};  // name -> value
  const doc = { querySelector: sel => {
    let m = /input\[name="addon-(.+)"\]$/.exec(sel); if (m) return boxes[m[1]] || null;
    m = /input\[name="item-(.+)"\]:checked$/.exec(sel); if (m) return radios[m[1]] !== undefined ? { value: radios[m[1]] } : null;
    return null; } };
  const f = new Function('document', 'CSS', 'DATA', g('chosenKey') + g('buildSelections') + g('scheduleAmounts') + g('currentTotals') + '\nreturn { buildSelections, currentTotals };');
  const DATA = { items: [
    { id: 'li1', selected_key: 'v1', variants: [{ key: 'v1', price: 1775 }] },
    { id: 'li2', optional: true, selected_key: 'v1', variants: [{ key: 'v1', price: 1250 }] },
    { id: 'li3', optional: true, selected_key: 'v1', variants: [{ key: 'v1', label: 'A', price: 100 }, { key: 'v2', label: 'B', price: 200 }] },
  ], schedule: [{ label: 'Deposit', percent: 40, trigger: 'upfront' }, { label: 'Final', percent: 60, trigger: 'completion' }] };
  DATA.items.forEach(() => {});
  const api = f(doc, { escape: x => x }, DATA);
  boxes.li2 = { checked: false, value: 'v1' };
  eq(api.buildSelections(), { li1: 'v1' }, 'unticked add-on is absent from the selections sent to the server');
  ok(api.currentTotals().subtotal === 1775, 'unticked add-on is not in the live total');
  boxes.li2.checked = true;
  eq(api.buildSelections(), { li1: 'v1', li2: 'v1' }, 'ticked add-on is sent');
  const t = api.currentTotals();
  ok(t.subtotal === 3025, 'ticked add-on is added to the live total');
  eq(t.schedule.map(m => m.customer_amount), [1210, 1815], 'live schedule recalculates on the new total (40/60)');
  radios.li3 = ''; ok(!('li3' in api.buildSelections()), 'multi-option add-on on "No thanks" is declined');
  radios.li3 = 'v2'; ok(api.buildSelections().li3 === 'v2' && api.currentTotals().subtotal === 3225, 'multi-option add-on picks one option and adds its price');
  ok(/class="addon-tag">Optional add-on/.test(proposalHtml) && /Added to your job/.test(proposalHtml) && /Not added to this job/.test(proposalHtml), 'signed page shows added / not added');
}

// ---- Message Queue English view ----
{
  const eng = {};
  const f = new Function('english', 'esc', grabFrom(mqHtml, 'englishHtml', false) + '\nreturn englishHtml;');
  const englishHtml = f(eng, s => String(s));
  ok(/English:<\/b> New job/.test(englishHtml({ ID: '1', Original_Body: 'New job' })), 'a row with a saved English original shows it');
  eng['2'] = { english: 'Live translation' };
  ok(/Live translation/.test(englishHtml({ ID: '2', Original_Body: '' })), 'a live-translated row shows it');
  eng['3'] = { error: 'down' };
  ok(/English view unavailable/.test(englishHtml({ ID: '3', Original_Body: '' })) && /Retry/.test(englishHtml({ ID: '3', Original_Body: '' })), 'a failed translation is a visible warning with Retry, not blank');
  eq(englishHtml({ ID: '9', Original_Body: '' }), '', 'an English-only message shows no extra box');
  ok(/the Hub returned no answer for this message/.test(mqHtml), 'a row the Hub omits from the translate reply gets a warning, never "Translating…" forever');
}
{
  // server: dispatch text carries the English original; translate endpoint behaviour
  const dispatch = grab('assignVendor', true);
  ok(/original_body: isSpanish \? msgEn : ''/.test(dispatch) && /translated_to: isSpanish \? 'es' : ''/.test(dispatch), 'Spanish dispatch text is queued WITH its English original');
  const rows = [
    { ID: '1', Recipient_Type: 'vendor', Message_Body: 'Nuevo trabajo: Roofing', Original_Body: 'New job: Roofing' },
    { ID: '2', Recipient_Type: 'vendor', Message_Body: 'Nuevo trabajo: Plomería en 20 E Eager', Original_Body: '' },
    { ID: '3', Recipient_Type: 'vendor', Message_Body: 'New job: Roofing', Original_Body: '' },
    { ID: '4', Recipient_Type: 'tenant', Message_Body: 'Hola', Original_Body: '' },
  ];
  const tel = [];
  const mk = translate => new Function('ensureSmsInfra', 'fetchTab', 'MSG_QUEUE_TAB', 'translateText', 'logTelemetry', 'json',
    'const MQ_LOOKS_SPANISH = ' + src.match(/const MQ_LOOKS_SPANISH = (.+);\n/)[1] + ';\n' + grab('translateMessageQueue', true) + '\nreturn translateMessageQueue;')(
    async () => {}, async () => rows, 'Message_Queue', translate, async (e, r) => { tel.push(r); }, o => o);
  const out = await mk(async () => 'Plumbing job at 20 E Eager')({}, { ids: ['1', '2', '3', '4', '99'] });
  eq(out.results.map(r => r.id + ':' + (r.english ? 'E' : r.skipped ? 'S' : 'X')), ['1:E', '2:E', '3:S', '4:S', '99:X'], 'saved English returned, Spanish translated live, English/tenant rows skipped, missing row reported');
  ok(out.results[0].english === 'New job: Roofing' && out.results[1].source === 'live', 'saved text is used before any live translation');
  const bad = await mk(async (e, t) => t)({}, { ids: ['2'] });
  ok(bad.results[0].error && tel.length === 1 && tel[0].Success === 'FALSE', 'a translation that returns nothing is a visible per-row error AND an Ops_Telemetry failure');
}

console.log(`scope-addons: ${n} assertions passed`);
