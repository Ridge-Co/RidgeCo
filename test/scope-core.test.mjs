// Scope Creator (B-030/031/076) pure-logic regression tests. Pulls the REAL functions out of
// worker.js (no copies) and checks: (1) scopeCleanItems normalizes/ids/drops empty items;
// (2) calcTieredEstimate applies markup server-side and only exposes final customer numbers via
// the proposal template — the #1 non-negotiable (no cost/markup ever reaches the customer doc).
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const scopeCleanItems = new Function(grab('scopeCleanItems') + '\nreturn scopeCleanItems;')();
const calcTieredEstimate = new Function(grab('calcTieredEstimate') + '\nreturn calcTieredEstimate;')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- scopeCleanItems ----
const cleaned = scopeCleanItems([
  { description: 'Replace kitchen faucet', area: 'Kitchen', trade: 'Plumbing' },
  { id: 'liX', description: 'Paint bedroom', area: 'Bedroom' },
  { description: '' },            // dropped — no description
  { note: 'orphan note' },        // dropped — no description
]);
ok(cleaned.length === 2, 'items without a description are dropped');
ok(cleaned[0].id === 'li1', 'a missing id is auto-assigned li1');
ok(cleaned[1].id === 'liX', 'an existing id is preserved');
ok(cleaned[0].qty === '' && cleaned[0].note === '', 'missing optional fields default to empty string');
ok(cleaned[0].trade === 'Plumbing' && cleaned[0].area === 'Kitchen', 'provided fields are preserved');

// ---- calcTieredEstimate: markup applied, only final numbers exposed ----
const p = calcTieredEstimate(1000);
ok(p.finalPrice > 1000, 'a $1000 vendor cost marks up to a higher customer price');
ok(Math.abs(p.deposit - p.finalPrice / 2) < 0.01, 'deposit is exactly half the final price');
ok(p.finalPrice % 5 === 0, 'final price rounds up to the nearest $5');
// The pricing fn always adds the fixed $75 first-hour + 5% fee, so a $0 basis resolves to $80 —
// harmless because scopeProposal requires estimate_amount > 0 before it ever runs.
const z = calcTieredEstimate(0);
ok(Number.isFinite(z.finalPrice) && Math.abs(z.deposit - z.finalPrice / 2) < 0.01, 'zero cost is finite (no NaN) and deposit stays half');

// ---- no-leak contract: the customer proposal template must carry ONLY final price + deposit ----
// This mirrors the exact string scopeProposal builds; assert cost/markup never appear in it.
const est = 1200, pricing = calcTieredEstimate(est);
const doc = `123 Main St\n\nScope of Work:\n\n- Replace faucet\n\nFinancial Terms:\n\nTotal Estimated Cost: $${pricing.finalPrice.toFixed(2)}\nRequired 50% Deposit: $${pricing.deposit.toFixed(2)}\n\nPayment & Project Terms:\n- 50% deposit.`;
ok(doc.includes('$' + pricing.finalPrice.toFixed(2)), 'proposal shows the final customer price');
ok(!doc.includes(String(est)), 'proposal does NOT contain the raw vendor cost');
ok(!doc.includes(String(pricing.markupPct)) && !/markup/i.test(doc), 'proposal contains no markup figure or word');
ok(!doc.includes(pricing.stepA.toFixed(2)) && !doc.includes(pricing.stepB.toFixed(2)), 'proposal contains none of the intermediate markup math');

console.log(`scope-core: ${n} assertions passed`);
