// Payment schedule / milestone billing (Sep 14 2026) — generalizes the old fixed 50%
// deposit/final split into an arbitrary N-way schedule (Brett: presets 1/3, 1/4, custom).
// Pulls the REAL pure helpers straight out of worker.js, same grab()/grabConst() technique as
// test/scope-book.test.mjs, so this tests the actual shipped logic, not a re-implementation.
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
  scopeDefaultPaymentSchedule, scopeValidatePaymentSchedule, scopeComputeMilestoneAmounts,
} = new Function(
  grab('scopeDefaultPaymentSchedule') + '\n' + grab('scopeValidatePaymentSchedule') + '\n' + grab('scopeComputeMilestoneAmounts') +
  '\nreturn { scopeDefaultPaymentSchedule, scopeValidatePaymentSchedule, scopeComputeMilestoneAmounts };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- scopeDefaultPaymentSchedule ----
{
  const d = scopeDefaultPaymentSchedule();
  ok(d.length === 2, 'default schedule has 2 milestones');
  ok(d[0].trigger === 'upfront' && d[0].percent === 33.34, 'default upfront milestone is 33.34% (MD 1/3 cap), not the old 50%');
  ok(d[1].trigger === 'completion', 'default second milestone is completion');
  ok(+(d[0].percent + d[1].percent).toFixed(2) === 100, 'default schedule sums to 100%');
}

// ---- scopeValidatePaymentSchedule: happy paths ----
{
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 33.34, trigger: 'upfront' }, { label: 'Final', percent: 66.66, trigger: 'completion' }], 33.34);
  ok(!r.error, 'valid 2-way schedule at exactly the cap has no error');
  ok(r.warnings.length === 0, 'no warning when upfront is exactly at the cap, not over it');
}
{
  // Brett's own example: 50% upfront + 25% progress + 25% final — should validate (warn-only
  // since 50% exceeds the MD cap), never be rejected outright — that's his explicit call.
  const r = scopeValidatePaymentSchedule([
    { label: 'Deposit', percent: 50, trigger: 'upfront' },
    { label: 'Progress', percent: 25, trigger: 'manual' },
    { label: 'Final', percent: 25, trigger: 'completion' },
  ], 33.34);
  ok(!r.error, '50/25/25 custom schedule is accepted, not rejected');
  ok(r.warnings.length === 1 && /33.34%/.test(r.warnings[0]), 'a warning (not an error) fires for the over-cap upfront milestone');
}
{
  // 1/3 preset: three equal shares.
  const third = +(100 / 3).toFixed(2);
  const r = scopeValidatePaymentSchedule([
    { label: 'Deposit', percent: third, trigger: 'upfront' },
    { label: 'Progress', percent: third, trigger: 'manual' },
    { label: 'Final', percent: third, trigger: 'completion' },
  ], 33.34);
  ok(!r.error, '1/3 preset (3x 33.33%) validates');
  ok(Math.abs(r.schedule.reduce((s, m) => s + m.percent, 0) - 100) < 0.01, '1/3 preset normalizes to exactly 100% after rounding-drift correction');
}
{
  // Missing/garbage trigger falls back to 'manual' rather than throwing.
  const r = scopeValidatePaymentSchedule([{ label: 'Deposit', percent: 100 }], 33.34);
  ok(!r.error, 'a milestone with no trigger field still validates');
  ok(r.schedule[0].trigger === 'manual', 'an unrecognized/missing trigger defaults to manual, never upfront (never silently deposit-like)');
}

// ---- scopeValidatePaymentSchedule: rejections ----
{
  const r = scopeValidatePaymentSchedule([], 33.34);
  ok(r.error, 'an empty milestone list is rejected');
}
{
  const r = scopeValidatePaymentSchedule([{ label: 'A', percent: 40 }, { label: 'B', percent: 40 }], 33.34);
  ok(r.error && /100%/.test(r.error), 'percentages that add to 80% (not 100%) are rejected with a clear message');
}
{
  const r = scopeValidatePaymentSchedule([{ label: 'A', percent: 0 }, { label: 'B', percent: 100 }], 33.34);
  ok(r.error, 'a zero-percent milestone is rejected rather than silently creating a $0 line');
}
{
  // Small rounding drift (e.g. three-way 33.33/33.33/33.34 typed by hand slightly off) is
  // absorbed into the last entry rather than rejected — this is what makes the 1/3 preset usable
  // from a UI that only accepts 2-decimal percent inputs.
  const r = scopeValidatePaymentSchedule([{ label: 'A', percent: 33.33 }, { label: 'B', percent: 33.33 }, { label: 'C', percent: 33.33 }], 33.34);
  ok(!r.error, '99.99% (0.01 short of 100 from rounding) is absorbed, not rejected');
  ok(Math.abs(r.schedule.reduce((s, m) => s + m.percent, 0) - 100) < 0.001, 'the corrected schedule sums to exactly 100%');
}

// ---- scopeComputeMilestoneAmounts: exact-footing / no rounding drift ----
{
  // A subtotal that doesn't divide evenly by 3 is the real stress case for rounding drift.
  const schedule = [
    { label: 'Deposit', percent: 33.33, trigger: 'upfront' },
    { label: 'Progress', percent: 33.33, trigger: 'manual' },
    { label: 'Final', percent: 33.34, trigger: 'completion' },
  ];
  const amounts = scopeComputeMilestoneAmounts(schedule, 1000, 500);
  const custSum = +amounts.reduce((s, m) => s + m.customer_amount, 0).toFixed(2);
  const vendSum = +amounts.reduce((s, m) => s + m.vendor_amount, 0).toFixed(2);
  ok(custSum === 1000, 'milestone customer amounts foot exactly to the subtotal (' + custSum + ' === 1000), no rounding drift');
  ok(vendSum === 500, 'milestone vendor amounts foot exactly to the vendor cost total (' + vendSum + ' === 500), no rounding drift');
}
{
  // Brett's own example, with real dollars: $10,000 job, 50% upfront / 25% progress / 25% final.
  const schedule = [
    { label: 'Deposit', percent: 50, trigger: 'upfront' },
    { label: 'Progress', percent: 25, trigger: 'manual' },
    { label: 'Final', percent: 25, trigger: 'completion' },
  ];
  const amounts = scopeComputeMilestoneAmounts(schedule, 10000, 6000);
  ok(amounts[0].customer_amount === 5000, '50% of $10,000 customer subtotal is $5,000');
  ok(amounts[1].customer_amount === 2500 && amounts[2].customer_amount === 2500, '25%/25% split the remaining $5,000 evenly');
  ok(amounts[0].vendor_amount === 3000, "vendor's 50% milestone is prorated off the VENDOR's own $6,000 cost (3000), not the customer subtotal — this is what keeps Brett's markup separate at every draw");
  ok(amounts[1].vendor_amount === 1500 && amounts[2].vendor_amount === 1500, "vendor's 25%/25% milestones are 1500 each off their own 6000 base");
}
{
  // Single-milestone (100%) schedule — the degenerate case a "bill it all at once" job would use.
  const amounts = scopeComputeMilestoneAmounts([{ label: 'Full payment', percent: 100, trigger: 'completion' }], 733.5, 400);
  ok(amounts.length === 1 && amounts[0].customer_amount === 733.5 && amounts[0].vendor_amount === 400, 'a single 100% milestone gets the whole subtotal/vendor-cost, unchanged by rounding logic');
}

console.log(`payment-schedule.test.mjs: ${n} assertions passed`);
