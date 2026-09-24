// Offline test for the Statement Importer's pure matcher (Phase 1, Sep 24 2026 —
// STATEMENT_RECEIPT_RECONCILIATION_BUILD_BRIEF_v1.0). Extracts the REAL statementLineMatch (and
// _rcNorm, which it reuses directly) from worker.js so this can't drift from what ships.
// Run: node test/statement-import.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

function extractSync(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}

const pure = new Function(`
  ${extractSync('_rcNorm')}
  ${extractSync('statementLineMatch')}
  return { _rcNorm, statementLineMatch };
`)();
const { statementLineMatch } = pure;

// ── 1) Confirmed via exact match (amount + date + normalized vendor) ───────────────────────────
{
  const receipts = [{ ID: 'R1', Active: 'TRUE', Amount: '56.04', Date: '2026-09-20', Store: 'Home Depot', WO_ID: '4021' }];
  // Layer 1 requires _rcNorm EQUALITY (same discipline as receiptReconFindRescanMatches) —
  // case/spacing-insensitive, but not a substring/rough match; that's Layer 3 ("possible") only.
  const line = { amount: 56.04, date: '2026-09-20', vendor: 'HOME   DEPOT', ref: '' };
  const m = statementLineMatch(line, receipts, []);
  ok(m.confidence === 'confirmed' && m.type === 'exact_receipt' && m.receipt_id === 'R1', 'exact amount+date+normalized-vendor match against a live Receipts row -> confirmed');
}
{
  // Same, but the match is a non-pending Receipt_Recon_Queue row instead of a Receipts row —
  // still-pending rows must never count as a prior disposition.
  const queue = [
    { ID: 'Q1', Active: 'TRUE', Status: 'confirmed', Total: '12.50', Receipt_Date: '2026-08-01', Vendor: 'Lowes' },
    { ID: 'Q2', Active: 'TRUE', Status: 'pending', Total: '12.50', Receipt_Date: '2026-08-01', Vendor: 'Lowes' },
  ];
  const m = statementLineMatch({ amount: 12.50, date: '2026-08-01', vendor: 'Lowes', ref: '' }, [], queue);
  ok(m.confidence === 'confirmed' && m.type === 'exact_queue' && m.queue_id === 'Q1', 'exact match against a dispositioned queue row (not the still-pending one) -> confirmed');
}

// ── 2) Confirmed via ref match with a date gap ──────────────────────────────────────────────────
{
  const queue = [{ ID: 'Q3', Active: 'TRUE', Status: 'pending', Total: '212.17', Receipt_Date: '2026-09-01', Vendor: 'Home Depot', PO_Reference: 'HD-INV-88213' }];
  // Statement line dated 4 days later than the queue row's Receipt_Date — well outside the ±3-day
  // window Layer 3 uses — but the reference number matches exactly, so this is still confirmed.
  const line = { amount: 212.17, date: '2026-09-05', vendor: 'Home Depot', ref: 'HD-INV-88213' };
  const m = statementLineMatch(line, [], queue);
  ok(m.confidence === 'confirmed' && m.type === 'ref_queue' && m.queue_id === 'Q3', 'PO/invoice reference exact match overrides the date gap -> confirmed even though dates differ by more than 3 days');
}
{
  // A ref match at the WRONG amount must never confirm — the reference alone isn't enough, it's
  // "ref + same amount" per the spec.
  const queue = [{ ID: 'Q4', Active: 'TRUE', Status: 'pending', Total: '212.17', Receipt_Date: '2026-09-01', Vendor: 'Home Depot', Invoice_Number: 'INV-999' }];
  const m = statementLineMatch({ amount: 50.00, date: '2026-09-01', vendor: 'Home Depot', ref: 'INV-999' }, [], queue);
  ok(m.confidence === null, 'reference matches but amount does not -> no confirmed match');
}

// ── 3) Possible via ±3-day window ───────────────────────────────────────────────────────────────
{
  const receipts = [{ ID: 'R5', Active: 'TRUE', Amount: '89.99', Date: '2026-09-10', Store: 'Ace Hardware' }];
  const line = { amount: 89.99, date: '2026-09-12', vendor: 'Ace Hardware', ref: '' }; // 2 days later
  const m = statementLineMatch(line, receipts, []);
  ok(m.confidence === 'possible' && m.type === 'window_receipt' && m.receipt_id === 'R5', 'same amount, date 2 days off, vendor matches -> possible (not confirmed)');
}
{
  // Exactly at the ±3-day boundary must still count.
  const receipts = [{ ID: 'R6', Active: 'TRUE', Amount: '40.00', Date: '2026-09-10', Store: 'Lowes' }];
  const line = { amount: 40.00, date: '2026-09-13', vendor: 'Lowes', ref: '' }; // exactly 3 days later
  ok(statementLineMatch(line, receipts, []).confidence === 'possible', 'exactly 3 days off is still inside the window -> possible');
}
{
  // Outside the window (4 days) must not match at all.
  const receipts = [{ ID: 'R7', Active: 'TRUE', Amount: '40.00', Date: '2026-09-10', Store: 'Lowes' }];
  const line = { amount: 40.00, date: '2026-09-14', vendor: 'Lowes', ref: '' }; // 4 days later
  ok(statementLineMatch(line, receipts, []).confidence === null, '4 days off is outside the ±3-day window -> no match');
}

// ── 4) Null when nothing matches ────────────────────────────────────────────────────────────────
{
  const receipts = [{ ID: 'R8', Active: 'TRUE', Amount: '15.00', Date: '2026-09-01', Store: 'Home Depot' }];
  const queue = [{ ID: 'Q5', Active: 'TRUE', Status: 'confirmed', Total: '15.00', Receipt_Date: '2026-09-01', Vendor: 'Home Depot' }];
  const line = { amount: 999.00, date: '2026-01-01', vendor: 'A Vendor Nobody Has Heard Of', ref: '' };
  ok(statementLineMatch(line, receipts, queue).confidence === null, 'wildly different amount/date/vendor -> null');
}
{
  ok(statementLineMatch({ amount: 0, date: '', vendor: '', ref: '' }, [], []).confidence === null, 'blank/zero line never false-positives');
}

// ── 5) Amount must match exactly to the cent — the boundary case ───────────────────────────────
{
  const receipts = [{ ID: 'R9', Active: 'TRUE', Amount: '56.04', Date: '2026-09-20', Store: 'Home Depot' }];
  const oneCentOff = statementLineMatch({ amount: 56.05, date: '2026-09-20', vendor: 'Home Depot', ref: '' }, receipts, []);
  ok(oneCentOff.confidence === null, 'one cent off on an otherwise-exact same-day match -> no confirmed match (fails Layer 1)');
  // The ±3-day "possible" layer also requires the amount to match EXACTLY (to the cent) — a
  // near-amount within the date window must still not flag as possible.
  const nearAmountInWindow = statementLineMatch({ amount: 56.05, date: '2026-09-21', vendor: 'Home Depot', ref: '' }, receipts, []);
  ok(nearAmountInWindow.confidence === null, 'one cent off, even within the ±3-day window -> still no match (amount is exact-only at every layer)');
  // Exactly matching to the cent (56.04 vs 56.040000001 float noise) still confirms via .toFixed(2).
  const floatNoise = statementLineMatch({ amount: 56.040000001, date: '2026-09-20', vendor: 'Home Depot', ref: '' }, receipts, []);
  ok(floatNoise.confidence === 'confirmed', '.toFixed(2) string comparison absorbs harmless float noise at the same cent value');
}

// ── 6) Inactive/soft-deleted rows never match (mirrors receiptReconFindRescanMatches discipline) ─
{
  const receipts = [{ ID: 'R10', Active: 'FALSE', Amount: '10.00', Date: '2026-09-10', Store: 'Amazon' }];
  ok(statementLineMatch({ amount: 10.00, date: '2026-09-10', vendor: 'Amazon', ref: '' }, receipts, []).confidence === null, 'Active=FALSE Receipts row is ignored');
  const queue = [{ ID: 'Q6', Active: 'FALSE', Status: 'confirmed', Total: '10.00', Receipt_Date: '2026-09-10', Vendor: 'Amazon' }];
  ok(statementLineMatch({ amount: 10.00, date: '2026-09-10', vendor: 'Amazon', ref: '' }, [], queue).confidence === null, 'Active=FALSE queue row is ignored');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
