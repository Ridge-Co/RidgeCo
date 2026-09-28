// Vendor-pay-per-milestone rollover + per-milestone Calc_Mode/Flat_Customer_Amount (Sep 18 2026,
// worker.js) — Payment_Milestones gains Vendor_Paid_At_This_Milestone/Calc_Mode/
// Flat_Customer_Amount (WO-to-Scope conversion build). Pulls the REAL pure helpers straight out
// of worker.js, same grab()/grabConst()/new Function() technique as test/payment-schedule.test.mjs
// and test/scope-book.test.mjs, so this tests the actual shipped logic, not a re-implementation.
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
const {
  scopeValidatePaymentSchedule, scopeComputeMilestoneAmounts, scopeVendorPayableSchedule,
} = new Function(
  grab('scopeValidatePaymentSchedule') + '\n' + grab('scopeComputeMilestoneAmounts') + '\n' + grab('scopeVendorPayableSchedule') +
  '\nreturn { scopeValidatePaymentSchedule, scopeComputeMilestoneAmounts, scopeVendorPayableSchedule };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── scopeValidatePaymentSchedule: new fields default to today's exact behavior ──────────────
{
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 50, trigger: 'upfront' }, { label: 'Final', percent: 50, trigger: 'completion' }], 33.34);
  ok(!r.error, 'a plain schedule with no vendor_paid/calc_mode still validates (backward compatible)');
  ok(r.schedule.every(m => m.vendor_paid === true), 'vendor_paid defaults to true — matches today\'s implicit always-pay behavior');
  ok(r.schedule.every(m => m.calc_mode === 'percent'), 'calc_mode defaults to percent — matches today\'s exact behavior');
  ok(r.schedule.every(m => m.flat_customer_amount === null), 'flat_customer_amount stays null when not in flat mode');
}
{
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 50, trigger: 'upfront', vendor_paid: false }, { label: 'Final', percent: 50, trigger: 'completion' }], 33.34);
  ok(!r.error, 'vendor_paid:false is a valid milestone flag');
  ok(r.schedule[0].vendor_paid === false && r.schedule[1].vendor_paid === true, 'vendor_paid is carried per-milestone, not applied to the whole schedule');
}
{
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 50, trigger: 'upfront', calc_mode: 'flat', flat_customer_amount: 1000 }, { label: 'Final', percent: 50, trigger: 'completion' }], 33.34);
  ok(!r.error, 'a flat milestone with a valid flat_customer_amount validates');
  ok(r.schedule[0].calc_mode === 'flat' && r.schedule[0].flat_customer_amount === 1000, 'flat_customer_amount is stored on the milestone');
}
{
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 50, trigger: 'upfront', calc_mode: 'flat' }, { label: 'Final', percent: 50, trigger: 'completion' }], 33.34);
  ok(r.error && /flat_customer_amount/.test(r.error), 'calc_mode:flat with no flat_customer_amount is rejected, not silently $0');
}
{
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 50, trigger: 'upfront', calc_mode: 'flat', flat_customer_amount: -5 }, { label: 'Final', percent: 50, trigger: 'completion' }], 33.34);
  ok(r.error, 'a negative flat_customer_amount is rejected');
}

// ── scopeComputeMilestoneAmounts: flat overrides the CUSTOMER side only ──────────────────────
{
  // $10,000 job, 50/25/25 split by percent, vendor cost $6,000 — the exact figures already
  // proven correct in payment-schedule.test.mjs. Middle milestone forced to a flat $2,000
  // (instead of the 25%/$2,500 it would otherwise compute) — vendor side must be UNCHANGED.
  const schedule = scopeValidatePaymentSchedule([
    { label: 'Deposit', percent: 50, trigger: 'upfront' },
    { label: 'Progress', percent: 25, trigger: 'manual', calc_mode: 'flat', flat_customer_amount: 2000 },
    { label: 'Final', percent: 25, trigger: 'completion' },
  ], 33.34).schedule;
  const amounts = scopeComputeMilestoneAmounts(schedule, 10000, 6000);
  ok(amounts[0].customer_amount === 5000, 'the non-flat deposit milestone is unaffected — still 50% of $10,000');
  ok(amounts[1].customer_amount === 2000, 'the flat milestone bills EXACTLY the typed amount, not the 25%/$2,500 percent would give');
  ok(amounts[1].vendor_amount === 1500, 'the flat milestone\'s VENDOR share is completely unaffected — still 25% of the $6,000 vendor cost');
  ok(amounts[2].customer_amount === 3000, 'the LAST milestone absorbs the customer-side remainder: $10,000 - $5,000 - $2,000 = $3,000 (not the plain 25%/$2,500 it would be without the flat override upstream)');
  ok(amounts[2].vendor_amount === 1500, 'the final milestone\'s vendor share is untouched by the customer-side flat override — still $1,500');
}
{
  // A flat override on the LAST milestone bills exactly as typed — it must NOT still try to
  // absorb a customer-side rounding remainder once it's flat.
  const schedule = scopeValidatePaymentSchedule([
    { label: 'Deposit', percent: 50, trigger: 'upfront' },
    { label: 'Final', percent: 50, trigger: 'completion', calc_mode: 'flat', flat_customer_amount: 100 },
  ], 33.34).schedule;
  const amounts = scopeComputeMilestoneAmounts(schedule, 10000, 6000);
  ok(amounts[1].customer_amount === 100, 'a flat FINAL milestone bills exactly $100, not the $5,000 remainder a percent-based last milestone would absorb');
  ok(amounts[1].vendor_amount === 3000, 'the flat final milestone\'s vendor share is still the normal 50% of $6,000 vendor cost — completely unaffected');
}
{
  const schedule = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 50, trigger: 'upfront' }, { label: 'Final', percent: 50, trigger: 'completion' }], 33.34).schedule;
  const amounts = scopeComputeMilestoneAmounts(schedule, 1000, 500);
  ok(amounts.every(m => m.vendor_paid === true && m.calc_mode === 'percent'), 'a schedule with no flags at all still carries the correct defaults through to the computed amounts');
}

console.log(`vendor-pay-rollover: pure-helper section — ${n} assertions so far`);

// ── scopeVendorPayableSchedule: the rollover math itself ─────────────────────────────────────
function m(id, sequence, vendor_amount, vendor_paid) { return { id, sequence, vendor_amount, vendor_paid }; }

{
  // Regression test: everything TRUE (today's existing, already-live behavior) must compute
  // IDENTICALLY to just paying each milestone's own vendor_amount — nothing changes for every
  // proposal already signed before this build.
  const out = scopeVendorPayableSchedule([m('a', 1, 300, true), m('b', 2, 150, true), m('c', 3, 150, true)]);
  ok(out.find(x => x.id === 'a').vendor_payable === 300, 'all-TRUE regression: milestone a pays its own amount exactly');
  ok(out.find(x => x.id === 'b').vendor_payable === 150, 'all-TRUE regression: milestone b pays its own amount exactly');
  ok(out.find(x => x.id === 'c').vendor_payable === 150, 'all-TRUE regression: milestone c pays its own amount exactly');
}
{
  // Skip deposit -> vendor gets deposit's share + their own share combined at final (Brett's own
  // example from the spec).
  const out = scopeVendorPayableSchedule([m('deposit', 1, 300, false), m('final', 2, 300, true)]);
  ok(out.find(x => x.id === 'deposit').vendor_payable === 0, 'the skipped deposit milestone pays the vendor $0 this round');
  ok(out.find(x => x.id === 'final').vendor_payable === 600, 'final combines its own $300 + the deposit\'s rolled-forward $300 = $600');
}
{
  // Skip two in a row -> both roll into the next paid one.
  const out = scopeVendorPayableSchedule([m('deposit', 1, 100, false), m('progress', 2, 100, false), m('final', 3, 300, true)]);
  ok(out.find(x => x.id === 'deposit').vendor_payable === 0 && out.find(x => x.id === 'progress').vendor_payable === 0, 'both skipped milestones pay $0');
  ok(out.find(x => x.id === 'final').vendor_payable === 500, 'final absorbs BOTH skipped shares plus its own: 100 + 100 + 300 = 500');
}
{
  // Skip → paid → skip → paid: each paid milestone only absorbs what immediately preceded it,
  // never a share that already rolled into an earlier paid milestone.
  const out = scopeVendorPayableSchedule([
    m('a', 1, 100, false), m('b', 2, 200, true), m('c', 3, 50, false), m('d', 4, 400, true),
  ]);
  ok(out.find(x => x.id === 'b').vendor_payable === 300, 'b absorbs only a\'s skipped 100 + its own 200 = 300, not anything from c');
  ok(out.find(x => x.id === 'd').vendor_payable === 450, 'd absorbs only c\'s skipped 50 + its own 400 = 450, b\'s share already resolved');
  const total = out.reduce((s, x) => s + x.vendor_payable, 0);
  ok(total === 750, 'the vendor\'s TOTAL across the whole schedule is conserved exactly (100+200+50+400=750), just redistributed');
}
{
  // Degenerate case: the schedule ENDS on a skipped milestone with nothing TRUE left to catch
  // it — must still not lose the money; force-attached to the last milestone in the schedule.
  const out = scopeVendorPayableSchedule([m('a', 1, 200, true), m('b', 2, 100, false)]);
  ok(out.find(x => x.id === 'a').vendor_payable === 200, 'a (the only TRUE milestone) is unaffected by a LATER skip that has nothing to roll into');
  ok(out.find(x => x.id === 'b').vendor_payable === 100, 'a trailing skipped milestone with no later TRUE milestone still gets its own share force-attached to the schedule\'s last entry, rather than losing it');
}
{
  // Order-independence: passing the same milestones in a shuffled array must compute identically
  // to passing them pre-sorted, since sequence — not array position — defines order.
  const ordered = scopeVendorPayableSchedule([m('a', 1, 100, false), m('b', 2, 300, true)]);
  const shuffled = scopeVendorPayableSchedule([m('b', 2, 300, true), m('a', 1, 100, false)]);
  ok(ordered.find(x => x.id === 'b').vendor_payable === shuffled.find(x => x.id === 'b').vendor_payable && shuffled.find(x => x.id === 'b').vendor_payable === 400, 'array order does not matter, only the sequence field does');
}
{
  ok(scopeVendorPayableSchedule([]).length === 0, 'an empty schedule returns an empty array, not a crash');
}

console.log(`vendor-pay-rollover.test.mjs: ${n} assertions passed`);
