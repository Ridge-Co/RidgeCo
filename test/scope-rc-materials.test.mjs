// Ridge Co–supplied materials on scope proposals + receipt double-billing block (Sep 22 2026).
// Brett: "there was no way to account for materials included in the estimate but to be paid for
// by ridge co rather than vendor" — he had to type a fake $1 vendor cost, which then got paid to
// the vendor. Tests the REAL shipped helpers pulled out of worker.js (same grab() technique as
// payment-schedule.test.mjs), plus a runtime pass through scopeProposalView with stubbed I/O to
// prove Ridge Co's materials COST never reaches the customer payload.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name, isAsync) {
  const sig = (isAsync ? 'async function ' : 'function ') + name + '(';
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) {
  const m = src.match(new RegExp('const ' + name + ' = [^;]+;'));
  if (!m) throw new Error('missing const ' + name);
  return m[0];
}
const H = new Function(
  [grab('calcTieredEstimate'), grab('scopeItemsPricing'), grab('scopeCleanVariants'), grab('scopeCleanItems'),
   grabConst('SCOPE_MATERIALS_MODES'), grab('scopeCleanMaterialsPricing'), grab('scopeParseMaterialsPricing'),
   grab('scopeComputeMilestoneAmounts'), grab('scopeMaterialsBudgetSummary'), grab('scopeCoveringSignature'),
   grab('gmailRefreshCandidates'), grab('gmailIdTokenEmail'), grab('findVendorPricingLeak')].join('\n') +
  '\nreturn { calcTieredEstimate, scopeItemsPricing, scopeCleanVariants, scopeCleanItems, scopeCleanMaterialsPricing, scopeParseMaterialsPricing, scopeComputeMilestoneAmounts, scopeMaterialsBudgetSummary, scopeCoveringSignature, gmailRefreshCandidates, gmailIdTokenEmail, findVendorPricingLeak };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const pc = { tiers: [[1000, 0.35, 50], [2000, 0.30, 0], [null, 0.25, 0]], adminFee: 85, adminFeeThreshold: 3000, cardFeeMult: 1.03, roundTo: 5 };
const r2 = x => Math.round(x * 100) / 100;

// ---- scopeCleanVariants: new fields kept, old shape untouched ----
{
  const plain = H.scopeCleanVariants({ variants: [{ key: 'v1', label: '', vendor_cost: 500 }] });
  eq(Object.keys(plain.variants[0]).sort(), ['key', 'label', 'price_override', 'vendor_cost'], 'a variant with no materials keeps its exact pre-existing shape');
  const withMat = H.scopeCleanVariants({ variants: [{ key: 'v1', vendor_cost: 0, rc_materials_cost: '212.456', rc_materials_desc: '  LVP flooring + underlayment  ' }] });
  ok(withMat.variants[0].rc_materials_cost === 212.46, 'materials cost is kept and rounded to cents');
  ok(withMat.variants[0].rc_materials_desc === 'LVP flooring + underlayment', 'materials description is kept, trimmed');
  const neg = H.scopeCleanVariants({ variants: [{ key: 'v1', vendor_cost: 10, rc_materials_cost: -50 }] });
  ok(!('rc_materials_cost' in neg.variants[0]), 'a negative materials cost is dropped, not stored');
  const long = H.scopeCleanVariants({ variants: [{ key: 'v1', rc_materials_cost: 5, rc_materials_desc: 'x'.repeat(500) }] });
  ok(long.variants[0].rc_materials_desc.length === 200, 'materials description is capped at 200 chars');
  const items = H.scopeCleanItems([{ id: 'li1', description: 'Floor', variants: [{ key: 'v1', rc_materials_cost: 100, rc_materials_desc: 'LVP' }] }]);
  ok(items[0].variants[0].rc_materials_cost === 100, 'scopeCleanItems (the /scope/update path) preserves materials — a save never wipes them');
}

// ---- scopeItemsPricing: no materials = byte-identical to before ----
{
  const items = [{ id: 'li1', description: 'Faucet', variants: [{ key: 'v1', label: '', vendor_cost: 150 }], selected_key: 'v1' }];
  const p = H.scopeItemsPricing(items, pc, { mode: 'flat_pct', pct: 40 });
  ok(p.items[0].variants[0].price === H.calcTieredEstimate(150, pc).finalPrice, 'no materials → price is exactly calcTieredEstimate, whatever the materials mode');
  eq(Object.keys(p.items[0].variants[0]).sort(), ['key', 'label', 'price', 'price_override', 'vendor_cost'], 'no materials → priced variant shape unchanged');
  ok(p.rcMaterialsCostTotal === 0 && p.rcMaterialsPriceTotal === 0, 'no materials → materials totals are 0');
}

// ---- markup mode: priced together with the vendor part, materials split out ----
{
  const items = [{ id: 'li1', description: 'Floor', variants: [{ key: 'v1', vendor_cost: 800, rc_materials_cost: 400, rc_materials_desc: 'LVP' }], selected_key: 'v1' }];
  const p = H.scopeItemsPricing(items, pc, { mode: 'markup' });
  const v = p.items[0].variants[0];
  const combo = H.calcTieredEstimate(1200, pc).finalPrice;
  ok(v.price === combo, 'markup mode: option total = calcTieredEstimate(vendor + materials) — one job, one tier, one minimum');
  ok(v.materials_price === r2(combo * 400 / 1200), 'markup mode: materials line = its proportional share of that price');
  ok(v.vendor_cost === 800, 'vendor_cost stays the vendor-only amount');
  ok(p.vendorCostTotal === 800, 'vendorCostTotal EXCLUDES Ridge Co materials — the vendor is never billed for them');
  ok(p.rcMaterialsCostTotal === 400 && p.rcMaterialsPriceTotal === v.materials_price, 'materials totals reported');
  ok(v.materials_desc === 'LVP', 'materials description carried for the customer line');
}
// markup mode is the default when no/invalid mode given
{
  const items = [{ id: 'li1', description: 'x', variants: [{ key: 'v1', vendor_cost: 800, rc_materials_cost: 400 }], selected_key: 'v1' }];
  ok(H.scopeItemsPricing(items, pc).items[0].variants[0].price === H.calcTieredEstimate(1200, pc).finalPrice, 'missing materials mode defaults to same-markup');
  ok(H.scopeItemsPricing(items, pc, { mode: 'bogus' }).items[0].variants[0].price === H.calcTieredEstimate(1200, pc).finalPrice, 'invalid materials mode defaults to same-markup');
  ok(H.scopeItemsPricing(items, pc).items[0].variants[0].materials_desc === 'Materials', 'blank materials description shows as "Materials"');
}

// ---- materials-only item (the exact $1-workaround case) ----
{
  const items = [{ id: 'li1', description: 'Supply vanity', variants: [{ key: 'v1', vendor_cost: 0, rc_materials_cost: 300, rc_materials_desc: 'Vanity' }], selected_key: 'v1' }];
  const mk = H.scopeItemsPricing(items, pc, { mode: 'markup' });
  ok(mk.items[0].variants[0].price === H.calcTieredEstimate(300, pc).finalPrice && mk.items[0].variants[0].materials_price === mk.items[0].variants[0].price, 'materials-only, markup mode: the whole price is the materials line');
  ok(mk.vendorCostTotal === 0, 'materials-only: $0 to the vendor (no more fake $1)');
  const ac = H.scopeItemsPricing(items, pc, { mode: 'at_cost' });
  ok(ac.items[0].variants[0].price === r2(300 * 1.03), 'materials-only, at-cost: no labor minimum markup sneaks in on a $0 vendor cost');
}

// ---- at_cost and flat_pct ----
{
  const items = [{ id: 'li1', description: 'Floor', variants: [{ key: 'v1', vendor_cost: 800, rc_materials_cost: 400 }], selected_key: 'v1' }];
  const ac = H.scopeItemsPricing(items, pc, { mode: 'at_cost' }).items[0].variants[0];
  ok(ac.materials_price === r2(400 * 1.03), 'at-cost: materials × card-fee multiplier only');
  ok(ac.price === r2(H.calcTieredEstimate(800, pc).finalPrice + ac.materials_price), 'at-cost: vendor part priced alone by the normal tiers, plus materials');
  const fp = H.scopeItemsPricing(items, pc, { mode: 'flat_pct', pct: 20 }).items[0].variants[0];
  ok(fp.materials_price === r2(400 * 1.2 * 1.03), 'flat %: materials × (1 + pct) × card fee');
  ok(fp.price === r2(H.calcTieredEstimate(800, pc).finalPrice + fp.materials_price), 'flat %: labor + materials');
  const noFee = H.scopeItemsPricing(items, { ...pc, cardFeeMult: undefined }, { mode: 'at_cost' }).items[0].variants[0];
  ok(noFee.materials_price === 400, 'no card-fee multiplier configured → at-cost is exactly cost');
}

// ---- price_override covers labor only; materials priced on top ----
{
  const items = [{ id: 'li1', description: 'Floor', variants: [{ key: 'v1', vendor_cost: 800, price_override: 1000, rc_materials_cost: 400 }], selected_key: 'v1' }];
  const v = H.scopeItemsPricing(items, pc, { mode: 'at_cost' }).items[0].variants[0];
  ok(v.price === r2(1000 + 400 * 1.03) && v.price_override === 1000, 'override + materials: override is the labor part, materials added on top');
  const vm = H.scopeItemsPricing(items, pc, { mode: 'markup' }).items[0].variants[0];
  ok(vm.price === r2(1000 + vm.materials_price) && vm.materials_price > 400, 'override + markup mode: materials keep their marked-up share, override covers labor');
}

// ---- multi-option: only the selected option counts toward totals ----
{
  const items = [{ id: 'li1', description: 'Roof', variants: [
    { key: 'v1', label: 'Repair', vendor_cost: 500 },
    { key: 'v2', label: 'Replace', vendor_cost: 3000, rc_materials_cost: 2000, rc_materials_desc: 'Shingles' },
  ], selected_key: 'v1' }];
  const p = H.scopeItemsPricing(items, pc, { mode: 'at_cost' });
  ok(p.rcMaterialsCostTotal === 0 && p.vendorCostTotal === 500, 'totals follow the selected option (Repair has no materials)');
  ok(p.items[0].variants[1].materials_price === r2(2000 * 1.03), 'the unselected option still carries its own materials line for the customer to see');
}

// ---- milestones: vendor side never includes materials ----
{
  const items = [{ id: 'li1', description: 'Floor', variants: [{ key: 'v1', vendor_cost: 800, rc_materials_cost: 400 }], selected_key: 'v1' }];
  const p = H.scopeItemsPricing(items, pc, { mode: 'markup' });
  const ms = H.scopeComputeMilestoneAmounts([{ label: 'Deposit', percent: 40, trigger: 'upfront' }, { label: 'Final', percent: 60, trigger: 'completion' }], p.subtotal, p.vendorCostTotal);
  ok(r2(ms.reduce((s, m) => s + m.vendor_amount, 0)) === 800, 'milestone vendor amounts sum to the vendor cost only (800), never 1200');
  ok(r2(ms.reduce((s, m) => s + m.customer_amount, 0)) === p.subtotal, 'milestone customer amounts still sum to the full price, materials included');
}

// ---- scopeCleanMaterialsPricing ----
{
  eq(H.scopeCleanMaterialsPricing({ mode: 'markup', pct: 99 }).value, { mode: 'markup' }, 'markup mode drops a stray pct');
  eq(H.scopeCleanMaterialsPricing({ mode: 'at_cost' }).value, { mode: 'at_cost' }, 'at_cost accepted');
  eq(H.scopeCleanMaterialsPricing({ mode: 'flat_pct', pct: '15.555' }).value, { mode: 'flat_pct', pct: 15.56 }, 'flat % accepted and rounded');
  ok(!!H.scopeCleanMaterialsPricing({ mode: 'flat_pct' }).error, 'flat % with no pct is rejected');
  ok(!!H.scopeCleanMaterialsPricing({ mode: 'flat_pct', pct: -5 }).error, 'negative pct rejected');
  ok(!!H.scopeCleanMaterialsPricing({ mode: 'flat_pct', pct: 501 }).error, 'pct over 500 rejected');
  ok(!!H.scopeCleanMaterialsPricing({ mode: 'free' }).error, 'unknown mode rejected');
  ok(!!H.scopeCleanMaterialsPricing(null).error, 'null rejected');
  eq(H.scopeParseMaterialsPricing({}), { mode: 'markup' }, 'unset on the scope → same-markup default');
  eq(H.scopeParseMaterialsPricing({ Materials_Pricing_JSON: '{"mode":"flat_pct","pct":12}' }), { mode: 'flat_pct', pct: 12 }, 'saved choice parsed');
  eq(H.scopeParseMaterialsPricing({ Materials_Pricing_JSON: 'garbage' }), { mode: 'markup' }, 'corrupt saved value → default, never throws');
}

// ---- materials description leak guard (same net as Proposal_Text) ----
{
  ok(H.findVendorPricingLeak('LVP flooring + underlayment') === null, 'a plain materials description passes');
  ok(!!H.findVendorPricingLeak('vanity, 20% markup'), 'a markup mention in the description is caught');
}

// ---- budget vs actual ----
{
  const rc = [
    { ID: '1', WO_ID: 'WO-9', Amount: '150.00', Active: 'TRUE' },
    { ID: '2', WO_ID: 'WO-9', Amount: '100.50' },
    { ID: '3', WO_ID: 'WO-9', Amount: '999', Active: 'FALSE' },
    { ID: '4', WO_ID: 'WO-8', Amount: '50' },
    { ID: '5', WO_ID: 'WO-9', Amount: '75', Role: 'vendor' },
  ];
  const w = H.scopeMaterialsBudgetSummary(400, 480, 'WO-9', rc);
  ok(w.actual === 250.5 && w.receipt_count === 2 && w.variance === 149.5 && w.state === 'within', 'within budget: sums only active, Ridge Co (non-vendor-logged) receipts on this WO');
  ok(H.scopeMaterialsBudgetSummary(200, 240, 'WO-9', rc).state === 'over', 'over budget flagged');
  ok(H.scopeMaterialsBudgetSummary(200, 240, 'WO-7', rc).state === 'not_bought', 'budget but no receipts yet');
  ok(H.scopeMaterialsBudgetSummary(0, 0, 'WO-9', rc).state === 'none', 'no materials budget → nothing to track (those receipts bill through Review Bills as before)');
  ok(H.scopeMaterialsBudgetSummary(0, 0, 'WO-7', rc).state === 'none', 'no budget, no receipts → nothing to show');
  ok(H.scopeMaterialsBudgetSummary(200, 240, '', rc).state === 'not_bought', 'no WO yet → no receipts counted');
  const u = H.scopeMaterialsBudgetSummary(200, 240, 'WO-9', null);
  ok(u.state === 'unknown' && u.actual === null, 'a failed Receipts read reports unknown, never a confident $0');
}

// ---- scopeCoveringSignature: which WOs are billed through a signed proposal ----
{
  const scopes = [{ ID: '5', WO_ID: 'WO-9' }, { ID: '6', WO_ID: 'WO-10' }, { ID: '7', WO_ID: '' }, { ID: '8', WO_ID: 'WO-13' }];
  const sigs = [{ ID: '1', Scope_ID: '5', Active: 'TRUE', RC_Materials_Cost: '300' }, { ID: '2', Scope_ID: '6', Active: 'FALSE', RC_Materials_Cost: '300' }, { ID: '4', Scope_ID: '8', Active: 'TRUE', RC_Materials_Cost: '' }];
  eq(H.scopeCoveringSignature(scopes, sigs, 'WO-9'), { scope_id: '5', signature_id: '1', materials_budget: 300 }, 'signed scope WO with Ridge Co materials priced in is covered');
  ok(H.scopeCoveringSignature(scopes, sigs, 'WO-13') === null, 'a signed proposal with NO materials budget (e.g. every pre-Sep-22 one) is not covered — its receipts still bill through Review Bills');
  ok(H.scopeCoveringSignature(scopes, sigs, 'WO-10') === null, 'a withdrawn (inactive) signature does not cover the WO');
  ok(H.scopeCoveringSignature(scopes, sigs, 'WO-11') === null, 'an ordinary WO is not covered — its receipts bill normally');
  ok(H.scopeCoveringSignature(scopes, sigs, '') === null, 'blank WO id → not covered');
  eq(H.scopeCoveringSignature(scopes, [{ ID: '3', Scope_ID: '7', RC_Materials_Cost: '50.5' }], 'WO-12', { Scope_ID: '7' }), { scope_id: '7', signature_id: '3', materials_budget: 50.5 }, 'Work_Orders.Scope_ID link also counts');
  ok(H.scopeCoveringSignature(scopes, [], 'WO-9') === null, 'proposed but not yet signed → not covered');
}

// ---- Gmail token sources + id_token check ----
{
  eq(H.gmailRefreshCandidates('A', 'B').map(c => c.source), ['config', 'env'], 'Config token tried first, then the Cloudflare secret');
  eq(H.gmailRefreshCandidates('', 'B').map(c => c.source), ['env'], 'no Config token → env only (today\'s behavior)');
  eq(H.gmailRefreshCandidates('A', 'A').length, 1, 'same token in both places is only tried once');
  eq(H.gmailRefreshCandidates(' ', ''), [], 'nothing set → no candidates');
  const tok = p => 'x.' + Buffer.from(JSON.stringify(p)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.y';
  eq(H.gmailIdTokenEmail(tok({ email: 'RidgeCoMaintenance@gmail.com', email_verified: true })), { email: 'ridgecomaintenance@gmail.com', verified: true }, 'id_token email decoded + lowercased');
  ok(H.gmailIdTokenEmail(tok({ email: 'a@b.com', email_verified: false })).verified === false, 'unverified email reported as such');
  ok(H.gmailIdTokenEmail('garbage') === null && H.gmailIdTokenEmail('') === null, 'malformed id_token → null, never throws');
}

// ---- runtime: scopeProposalView never leaks Ridge Co's materials COST ----
{
  const viewSrc = grab('scopeProposalView', true);
  const stored = [{ id: 'li1', area: 'Kitchen', description: 'Floor', note: 'vendor quote 800', selected_key: 'v1', variants: [
    { key: 'v1', label: '', price: 1650, vendor_cost: 800, rc_materials_cost: 400, materials_price: 550, materials_desc: 'LVP' },
  ] }, { id: 'li2', description: 'Faucet', selected_key: 'v1', variants: [{ key: 'v1', label: '', price: 255, vendor_cost: 150 }] }];
  const stubs = {
    scopeProposalLinkAuth: async () => ({ s: { ID: '5', Property_ID: '1', Proposal_Items_JSON: JSON.stringify(stored) } }),
    scopeAddr: async () => '1 Main St', scopeProposalPhotos: async () => [],
    scopeParsePaymentSchedule: () => [{ label: 'Deposit', percent: 50, trigger: 'upfront' }, { label: 'Final', percent: 50, trigger: 'completion' }],
    scopeValidatePaymentSchedule: (m) => ({ schedule: m }), scopeMaxUpfrontPct: async () => 33.34,
    scopeComputeMilestoneAmounts: H.scopeComputeMilestoneAmounts, scopeDefaultPaymentSchedule: () => [],
    scopeSigTab: async () => {}, fetchTab: async () => [], paymentMilestonesTab: async () => {},
    json: (o) => o,
  };
  const view = new Function(...Object.keys(stubs), viewSrc + '\nreturn scopeProposalView;')(...Object.values(stubs));
  const out = await view({}, { searchParams: { get: () => 't' } });
  const s = JSON.stringify(out);
  ok(!/rc_materials_cost/.test(s) && !/vendor_cost/.test(s), 'customer payload carries no rc_materials_cost and no vendor_cost');
  ok(!/\b400\b/.test(s), 'Ridge Co\'s materials cost (400) appears nowhere in the customer payload');
  eq(out.items[0].variants[0], { key: 'v1', label: '', price: 1650, materials_price: 550, materials_desc: 'LVP' }, 'customer sees the option price + materials description + materials price only');
  eq(Object.keys(out.items[1].variants[0]).sort(), ['key', 'label', 'price'], 'an option with no materials keeps the old key/label/price shape');
  ok(out.subtotal === 1905, 'subtotal = option totals (materials already inside price) — no double count');
}

console.log(`scope-rc-materials: ${n} assertions passed`);
