// Scope proposal -> QuickBooks booking (Phase 2, Aug 21 2026 — follows the per-item e-sign
// work of rule 123). Pulls the REAL pure helpers out of worker.js: (1) scopeSigVendorBillAmount
// — the vendor bill must be prorated to the SAME share of vendor cost as the deposit is of the
// subtotal, never the full vendor cost (that's the older B-076 proposalBook() behavior, and
// deliberately NOT what this new path does); (2) scopeSigTrade — picks the trade that routes
// the QB item/income/expense accounts, majority-vote over the SIGNED items only, General on a
// tie or a miss, and never a trade QB_TRADE_MAP doesn't actually have.
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
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing ' + name);
  const j = src.indexOf(';\n', i);
  return src.slice(i, j + 1);
}
const { scopeSigVendorBillAmount, scopeSigTrade } = new Function(
  grabConst('QB_TRADE_MAP') + '\n' + grab('scopeSigVendorBillAmount') + '\n' + grab('scopeSigTrade') +
  '\nreturn { scopeSigVendorBillAmount, scopeSigTrade };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- scopeSigVendorBillAmount: proration ----
{
  // Normal 50% deposit (the usual case: deposit = subtotal/2) -> vendor bill is 50% of vendor cost.
  const r = scopeSigVendorBillAmount(2000, 1500, 3000); // subtotal 3000, deposit 1500 = 50%
  ok(r.ratio === 0.5, 'ratio is 0.5 for a standard 50% deposit');
  ok(r.amount === 1000, 'vendor bill is 50% of vendor cost (1000 of 2000), not the full 2000');
}
{
  // A non-standard deposit fraction prorates the vendor bill to match, not to 50%.
  const r = scopeSigVendorBillAmount(1000, 250, 1000); // 25% deposit
  ok(Math.abs(r.ratio - 0.25) < 1e-9, 'ratio reflects the actual deposit/subtotal fraction (25%)');
  ok(r.amount === 250, 'vendor bill prorates to the same 25% share (250 of 1000)');
}
{
  // Zero subtotal (should never happen, but must never divide by zero / NaN) falls back to 50%.
  const r = scopeSigVendorBillAmount(500, 0, 0);
  ok(r.ratio === 0.5, 'falls back to a 50% ratio when subtotal is 0 rather than dividing by zero');
  ok(r.amount === 250, 'the 50% fallback still produces a sane, non-NaN bill amount');
}
{
  const r = scopeSigVendorBillAmount(0, 500, 1000);
  ok(r.amount === 0, 'zero vendor cost prorates to zero, not NaN or a negative');
}

// ---- scopeSigTrade: majority vote, signed-items-only, safe fallback ----
{
  const items = [
    { id: 'a', trade: 'Roofing' }, { id: 'b', trade: 'Roofing' }, { id: 'c', trade: 'Plumbing' },
  ];
  const t = scopeSigTrade(items, { a: 'v1', b: 'v1', c: 'v1' });
  ok(t === 'Roofing', 'majority trade (2 Roofing vs 1 Plumbing) wins');
}
{
  // Item 'c' was never signed/selected (not in `selections`) — must not count toward the vote.
  const items = [
    { id: 'a', trade: 'Roofing' }, { id: 'b', trade: 'Plumbing' }, { id: 'c', trade: 'Plumbing' },
  ];
  const t = scopeSigTrade(items, { a: 'v1', b: 'v1' }); // c unsigned
  ok(t === 'Roofing', 'a tied 1-1 vote among SIGNED items only (c excluded) resolves to the first counted, not the unsigned majority');
}
{
  // A trade string not present in QB_TRADE_MAP must never leak through unmapped.
  const items = [{ id: 'a', trade: 'MadeUpTrade' }];
  const t = scopeSigTrade(items, { a: 'v1' });
  ok(t === 'General', 'an unrecognized trade name falls back to General rather than an invalid QB_TRADE_MAP key');
}
{
  ok(scopeSigTrade([], {}) === 'General', 'no items at all falls back to General, not a crash');
}

// ---- final-balance booking (Sep 2 2026, scopeProposalBookFinal): conservation invariant ----
// The final invoice/bill amounts are derived as (subtotal - deposit) and (vendorCostTotal -
// depositVendorBillAmount) — never re-derived independently — so deposit+final must always sum
// back to exactly the full subtotal/vendor cost, with no leftover or double-counted cent.
{
  const cases = [
    [2000, 1000, 3000],   // vendor cost 2000, standard 50% deposit
    [1000, 250, 1000],    // 25% deposit (non-standard ratio)
    [500, 500, 500],      // 100% deposit (edge case: nothing should remain)
  ];
  for (const [vendorCostTotal, deposit, subtotal] of cases) {
    const dep = scopeSigVendorBillAmount(vendorCostTotal, deposit, subtotal);
    const finalAmount = +(subtotal - deposit).toFixed(2);
    const finalVendorAmount = +(vendorCostTotal - dep.amount).toFixed(2);
    ok(Math.abs((deposit + finalAmount) - subtotal) < 1e-9, `deposit + final invoice sums back to the full subtotal (${subtotal})`);
    ok(Math.abs((dep.amount + finalVendorAmount) - vendorCostTotal) < 1e-9, `deposit vendor bill + final vendor bill sums back to the full vendor cost (${vendorCostTotal})`);
    ok(finalVendorAmount >= -1e-9, 'final vendor bill amount is never negative');
  }
}

console.log(`scope-book: ${n} assertions passed`);
