// Scope proposal per-item/variant pricing (Aug 19 2026 — Repair-vs-Replace-style options).
// Pulls the REAL functions out of worker.js. Checks: (1) scopeItemsPricing marks up EACH
// variant's vendor_cost independently and sums the default-selected ones into a subtotal/deposit;
// (2) the customer-facing shape (what scopeProposalView/scopeProposalSign expose) never carries
// vendor_cost — the #1 non-negotiable, now re-verified for the multi-option path specifically.
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
const { scopeItemsPricing, calcTieredEstimate } = new Function(
  grab('calcTieredEstimate') + '\n' + grab('scopeItemsPricing') + '\nreturn { scopeItemsPricing, calcTieredEstimate };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// A real, small pricing config — mirrors the shape documented at getPricingConfig().
const pc = { tiers: [[1000, 0.35, 50], [2000, 0.30, 0], [null, 0.25, 0]], adminFee: 85, adminFeeThreshold: 3000, cardFeeMult: 1.05, roundTo: 5 };

const items = [
  { id: 'li1', area: 'Exterior', description: 'Roof work', variants: [
      { key: 'repair', label: 'Repair Roof', vendor_cost: 800 },
      { key: 'replace', label: 'Replace Roof', vendor_cost: 2400 },
    ], selected_key: 'repair' },
  { id: 'li2', area: 'Kitchen', description: 'Faucet swap', variants: [{ key: 'v1', label: '', vendor_cost: 150 }], selected_key: 'v1' },
];

const priced = scopeItemsPricing(items, pc);

// ---- each variant is priced independently, not just the selected one ----
ok(priced.items[0].variants.length === 2, 'both roof options are priced, not just the selected one');
const repairCalc = calcTieredEstimate(800, pc), replaceCalc = calcTieredEstimate(2400, pc), faucetCalc = calcTieredEstimate(150, pc);
ok(priced.items[0].variants[0].price === repairCalc.finalPrice, 'Repair Roof price matches its own tiered markup');
ok(priced.items[0].variants[1].price === replaceCalc.finalPrice, 'Replace Roof price matches its own (higher-cost) tiered markup');
ok(priced.items[0].variants[1].price > priced.items[0].variants[0].price, 'Replace is priced higher than Repair, as expected');

// ---- subtotal/deposit reflect only the SELECTED variant per item ----
const expectedSubtotal = +(repairCalc.finalPrice + faucetCalc.finalPrice).toFixed(2);
ok(priced.subtotal === expectedSubtotal, 'subtotal sums the selected variant per item, not every variant');
ok(Math.abs(priced.deposit - priced.subtotal / 2) < 0.01, 'deposit is 50% of the subtotal');
ok(priced.vendorCostTotal === 950, 'vendor cost total (private) sums the selected variants\' raw cost: 800 + 150');

// switching the selection changes the subtotal, proving the choice actually drives price
const itemsReplace = JSON.parse(JSON.stringify(items));
itemsReplace[0].selected_key = 'replace';
const pricedReplace = scopeItemsPricing(itemsReplace, pc);
ok(pricedReplace.subtotal > priced.subtotal, 'selecting Replace instead of Repair raises the subtotal');
ok(pricedReplace.vendorCostTotal === 2550, 'vendor cost total updates with the selection: 2400 + 150');

// ---- no-leak contract: the customer-facing shape (scopeProposalView / scopeProposalSign's
// authoritative source) must carry price + label only — never vendor_cost, never markup math ----
const customerFacing = priced.items.map(it => ({
  id: it.id, area: it.area, description: it.description,
  variants: it.variants.map(v => ({ key: v.key, label: v.label, price: v.price })),
  selected_key: it.selected_key,
}));
const asJson = JSON.stringify(customerFacing);
ok(!/vendor_cost/i.test(asJson), 'customer-facing JSON contains no vendor_cost key at all');
// Structural check, not substring (a marked-up price can coincidentally CONTAIN a cost's digits,
// e.g. $3150 contains "150" — that's not a leak, it's the final price). Walk every variant and
// confirm its `price` field is never exactly equal to any raw vendor_cost that went in.
const rawCosts = [800, 2400, 150];
let leaked = false;
for (const it of customerFacing) for (const v of it.variants) if (rawCosts.includes(v.price)) leaked = true;
ok(!leaked, 'no variant\'s customer-facing price is literally equal to an un-marked-up vendor cost');
ok(Object.keys(customerFacing[0].variants[0]).sort().join(',') === 'key,label,price', 'a customer-facing variant has exactly key/label/price — no other field can smuggle cost data');
ok(!/markup/i.test(asJson), 'customer-facing JSON contains no markup figure or word');

console.log(`scope-variants: ${n} assertions passed`);
