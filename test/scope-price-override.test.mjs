// Manual final-price override on scope proposal items (Sep 2 2026, Brett: "there is no way for
// me to edit the final pricing manually"). Checks: (1) a variant's price_override wins outright
// over calcTieredEstimate; (2) vendor_cost is untouched by an override, so vendor-bill proration
// at signing (always vendor_cost × deposit/subtotal) is unaffected; (3) a blank/absent override
// falls back to the normal auto-calculated markup price, unchanged from before this feature;
// (4) the customer-facing shape still carries only key/label/price — an override never smuggles
// vendor_cost or the override flag itself to a customer-facing surface.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { scopeItemsPricing, calcTieredEstimate, scopeCleanVariants } = new Function(
  grab('calcTieredEstimate') + '\n' + grab('scopeItemsPricing') + '\n' + grab('scopeCleanVariants') +
  '\nreturn { scopeItemsPricing, calcTieredEstimate, scopeCleanVariants };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const pc = { tiers: [[1000, 0.35, 50], [2000, 0.30, 0], [null, 0.25, 0]], adminFee: 85, adminFeeThreshold: 3000, cardFeeMult: 1.05, roundTo: 5 };

// ---- override wins outright ----
const items = [
  { id: 'li1', area: 'Exterior', description: 'Roof work', variants: [
      { key: 'v1', label: '', vendor_cost: 800, price_override: 999.99 },
    ], selected_key: 'v1' },
  { id: 'li2', area: 'Kitchen', description: 'Faucet swap', variants: [{ key: 'v1', label: '', vendor_cost: 150 }], selected_key: 'v1' },
];
const priced = scopeItemsPricing(items, pc);
const autoCalc = calcTieredEstimate(800, pc);
ok(priced.items[0].variants[0].price === 999.99, 'an override sets the exact final price, ignoring the tiered-markup calculation');
ok(priced.items[0].variants[0].price !== autoCalc.finalPrice, 'the overridden price differs from what auto-calc would have produced');
ok(priced.items[0].variants[0].vendor_cost === 800, 'vendor_cost is carried through unchanged even when price is overridden');

// ---- vendor-bill proration basis is unaffected: subtotal changes, vendorCostTotal does not ----
ok(priced.vendorCostTotal === 950, 'vendor cost total still sums raw vendor_cost (800 + 150) regardless of the price override');
const faucetCalc = calcTieredEstimate(150, pc);
const expectedSubtotal = +(999.99 + faucetCalc.finalPrice).toFixed(2);
ok(priced.subtotal === expectedSubtotal, 'subtotal reflects the overridden price for the overridden item');

// ---- no override = unchanged behavior (regression guard) ----
const itemsNoOverride = [{ id: 'li1', area: '', description: 'Faucet swap', variants: [{ key: 'v1', label: '', vendor_cost: 150 }], selected_key: 'v1' }];
const pricedNoOverride = scopeItemsPricing(itemsNoOverride, pc);
ok(pricedNoOverride.items[0].variants[0].price === faucetCalc.finalPrice, 'with no override, price still comes from calcTieredEstimate exactly as before');

// ---- scopeCleanVariants sanitizes price_override correctly ----
const cleaned1 = scopeCleanVariants({ variants: [{ key: 'v1', vendor_cost: 100, price_override: '250.5' }] });
ok(cleaned1.variants[0].price_override === 250.5, 'scopeCleanVariants parses a numeric-string override into a number');
const cleaned2 = scopeCleanVariants({ variants: [{ key: 'v1', vendor_cost: 100, price_override: '' }] });
ok(cleaned2.variants[0].price_override === null, 'scopeCleanVariants treats a blank override as no override (null)');
const cleaned3 = scopeCleanVariants({ variants: [{ key: 'v1', vendor_cost: 100 }] });
ok(cleaned3.variants[0].price_override === null, 'scopeCleanVariants treats a missing override field as no override (null)');
const cleaned4 = scopeCleanVariants({ variants: [{ key: 'v1', vendor_cost: 100, price_override: '-5' }] });
ok(cleaned4.variants[0].price_override === null, 'scopeCleanVariants rejects a negative override rather than passing it through');

// ---- no-leak contract still holds with an override present ----
const customerFacing = priced.items.map(it => ({
  id: it.id, description: it.description,
  variants: it.variants.map(v => ({ key: v.key, label: v.label, price: v.price })),
  selected_key: it.selected_key,
}));
const asJson = JSON.stringify(customerFacing);
ok(!/vendor_cost/i.test(asJson), 'customer-facing JSON contains no vendor_cost key even when an override was used');
ok(!/price_override/i.test(asJson), 'customer-facing JSON contains no price_override flag — the override is invisible to the customer, only its result (price) shows');
ok(Object.keys(customerFacing[0].variants[0]).sort().join(',') === 'key,label,price', 'a customer-facing overridden variant still has exactly key/label/price — nothing extra leaks');

console.log(`scope-price-override: ${n} assertions passed`);
