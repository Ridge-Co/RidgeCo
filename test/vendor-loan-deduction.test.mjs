// Pure-function tests for the Alex/vendor-loan automatic-deduction formula (CAP-036 #13,
// Sep 24 2026, Brett-confirmed spec). Pins every edge case named in the brief: the sub-$100
// floor, the 2.5%→5% linear scale, the $25 cap, the round-down/round-up threshold at $350/$351,
// and the never-rounded, never-over-owed payoff exception.
import fs from 'fs';
const worker = fs.readFileSync('worker.js', 'utf8');

function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf(')', i); j = src.indexOf('{', j);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

const { computeLoanDeduction } = new Function(
  grab(worker, 'computeLoanDeduction') + '\nreturn { computeLoanDeduction };'
)();

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

// ── No balance = no deduction, regardless of labor ──────────────────────────────────────
t('zero balance never deducts', computeLoanDeduction(500, 0) === 0);
t('negative balance never deducts', computeLoanDeduction(500, -20) === 0);

// ── Sub-$100 labor floor: no deduction at all under $100, even with a real balance ──────
t('labor $50 → $0 (under the $100 floor)', computeLoanDeduction(50, 210) === 0);
t('labor $99.99 → $0 (still under the floor)', computeLoanDeduction(99.99, 210) === 0);

// ── $100 exactly = 2.5%, the low end of the linear scale ────────────────────────────────
t('labor $100 → $2.50 (2.5% of 100, already a $2.50 multiple)', computeLoanDeduction(100, 210) === 2.5, computeLoanDeduction(100, 210));

// ── Mid-scale, round DOWN (labor under $350) ────────────────────────────────────────────
// $150 labor: pct = 2.5% + (150-100)/(500-100)*2.5% = 2.8125% → $4.21875 → floor to $2.50
t('labor $150 → $2.50 (rounds down)', computeLoanDeduction(150, 207.5) === 2.5, computeLoanDeduction(150, 207.5));
// $300 labor: pct = 3.75% → $11.25 → floor to $10.00
t('labor $300 → $10.00 (rounds down)', computeLoanDeduction(300, 207.5) === 10, computeLoanDeduction(300, 207.5));
// $350 labor (boundary, spec says treat as round-down): pct = 4.0625% → $14.21875 → floor to $12.50
t('labor $350 (boundary) → $12.50 (round-down side)', computeLoanDeduction(350, 100) === 12.5, computeLoanDeduction(350, 100));

// ── $351 boundary flips to round UP ──────────────────────────────────────────────────────
// pct = 4.06875% → $14.2814 → ceil to $15.00
t('labor $351 (boundary) → $15.00 (round-up side)', computeLoanDeduction(351, 100) === 15, computeLoanDeduction(351, 100));

// ── $500+ = flat 5%, and the $25 cap ─────────────────────────────────────────────────────
t('labor $500 → $25.00 (5%, hits the cap exactly)', computeLoanDeduction(500, 197.5) === 25, computeLoanDeduction(500, 197.5));
t('labor $1000 (well over $500) → still $25.00 (capped, not $50)', computeLoanDeduction(1000, 172.5) === 25, computeLoanDeduction(1000, 172.5));

// ── Payoff exception #1: the raw (pre-rounding) deduction alone clears the balance ──────
// $200 labor → raw deduction $6.25, which is >= a $5 balance → pays exactly $5, unrounded.
t('payoff (pre-round): deducts exactly the $5 left, not the $6.25 formula amount',
  computeLoanDeduction(200, 5) === 5, computeLoanDeduction(200, 5));
t('payoff never overpays past the balance', computeLoanDeduction(500, 3) === 3, computeLoanDeduction(500, 3));

// ── Payoff exception #2: rounding (specifically rounding UP) pushes past the balance ────
// $351 labor → raw $14.2814 (< $14.50 balance, so check #1 does NOT trigger) → rounds UP to
// $15.00, which WOULD exceed the $14.50 balance → exact $14.50 payoff, not the rounded $15.
t('payoff (post-round): rounding up over the balance still pays exactly what\'s owed',
  computeLoanDeduction(351, 14.5) === 14.5, computeLoanDeduction(351, 14.5));

// ── A non-payoff deduction never leaves the balance negative or exceeds the cap+rounding ──
t('an ordinary deduction stays below the remaining balance',
  computeLoanDeduction(300, 207.5) < 207.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
