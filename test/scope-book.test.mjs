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

// The vendor-bill-skip visibility fix (Aug 24 2026 — Cesar Gomez / Jamuna Yalamanchili report):
// scopeInitialBillSkipReason (what scopeProposalBook decides before it tries QuickBooks),
// scopeEffectiveBillSkipReason (the legacy-row in-house fallback scopeProposalSignedList applies
// when Bill_Skip_Reason predates this fix and reads blank), and scopeBillMissing (the gate the
// list endpoint uses to flag a row red vs. leave it a calm "✓ Booked").
const { scopeInitialBillSkipReason, scopeEffectiveBillSkipReason, scopeBillMissing } = new Function(
  grab('scopeInitialBillSkipReason') + '\n' + grab('scopeEffectiveBillSkipReason') + '\n' + grab('scopeBillMissing') +
  '\nreturn { scopeInitialBillSkipReason, scopeEffectiveBillSkipReason, scopeBillMissing };'
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

// ---- scopeInitialBillSkipReason: why scopeProposalBook is about to skip the bill ----
{
  ok(scopeInitialBillSkipReason('', null, false, 500) === 'no_vendor', 'no Vendor_ID at all on the scope -> no_vendor');
  ok(scopeInitialBillSkipReason('V-999', null, false, 500) === 'vendor_not_found', 'a Vendor_ID that does not resolve -> vendor_not_found (not confused with no_vendor)');
  ok(scopeInitialBillSkipReason('V-003', { ID: 'V-003' }, true, 500) === 'in_house', 'a resolved but in-house vendor -> in_house, even with a real cost');
  ok(scopeInitialBillSkipReason('V-003', { ID: 'V-003' }, false, 0) === 'zero_cost', 'a resolved, non-in-house vendor with $0 prorated bill -> zero_cost');
  ok(scopeInitialBillSkipReason('V-003', { ID: 'V-003' }, false, 325) === '', 'a resolved, non-in-house vendor with a real cost -> no skip reason, bill should be attempted');
}

// ---- scopeEffectiveBillSkipReason: the legacy in-house fallback for rows booked before this fix ----
{
  ok(scopeEffectiveBillSkipReason('qb_bill_api_error', false) === 'qb_bill_api_error', 'a stored reason always wins over re-derivation');
  ok(scopeEffectiveBillSkipReason('qb_bill_api_error', true) === 'qb_bill_api_error', 'a stored reason wins even if the vendor now reads as in-house');
  ok(scopeEffectiveBillSkipReason('', true) === 'in_house', 'blank stored reason + an in-house vendor -> re-derived as in_house (the legacy-row fix)');
  ok(scopeEffectiveBillSkipReason('', false) === '', 'blank stored reason + a NOT in-house vendor stays blank -> genuinely unknown, not assumed innocent');
}

// ---- scopeBillMissing: the red-flag gate on the Signed Proposals list ----
{
  ok(scopeBillMissing(true, false, 650, '') === true, 'booked, no bill id, real vendor cost, no skip reason -> flag it');
  ok(scopeBillMissing(true, false, 650, 'in_house') === false, 'booked, no bill id, but in_house -> do NOT flag (expected, no payable by policy)');
  ok(scopeBillMissing(true, true, 650, '') === false, 'booked and the bill id IS present -> never flag regardless of reason');
  ok(scopeBillMissing(false, false, 650, '') === false, 'not booked yet at all -> not this gate’s concern (still "needs billing", not "bill missing")');
  ok(scopeBillMissing(true, false, 0, '') === false, 'booked, no bill id, but vendor cost is $0 -> nothing was ever expected, do not flag');
}

console.log(`scope-book: ${n} assertions passed`);
