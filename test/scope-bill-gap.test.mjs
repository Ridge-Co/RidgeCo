// Vendor-bill gap tracking on signed scope proposals (Aug 24 2026).
//
// The bug this guards: /scope-proposal/book creates a customer DEPOSIT invoice and a prorated
// vendor bill. The invoice id is persisted the moment it exists (so a bill failure can never
// duplicate the invoice), which means a booking whose vendor bill was skipped or failed still
// flipped the row to Status: Booked and rendered as a plain green "✓ Booked" forever. Ridge Co
// invoiced the customer and never created the payable, with nothing left behind to notice it by.
//
// Two real helpers are pulled straight out of worker.js (never re-implemented here):
//   • scopeSigBillGap        — classifies a row's vendor-bill state for the Hub.
//   • scopeSigSkipIsInHouse  — the one legitimate skip, which must stay calm rather than alarm.
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
const { scopeSigBillGap, scopeSigSkipIsInHouse, SCOPE_BILL_SKIP_INHOUSE } = new Function(
  grabConst('SCOPE_BILL_SKIP_INHOUSE') + '\n' + grab('scopeSigSkipIsInHouse') + '\n' + grab('scopeSigBillGap') +
  '\nreturn { scopeSigBillGap, scopeSigSkipIsInHouse, SCOPE_BILL_SKIP_INHOUSE };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- the state before anything is booked ----
{
  const g = scopeSigBillGap({ Status: 'Signed' }, false);
  ok(g.kind === 'not_booked', 'a signed-but-unbooked row is not a gap — it is the normal pre-billing state');
  ok(g.reason === '', 'nothing booked yet means nothing to explain');
}

// ---- the healthy booked case ----
{
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', QB_Bill_ID: '77' }, false);
  ok(g.kind === 'billed', 'invoice AND bill present is a clean booking');
  ok(g.reason === '', 'a clean booking carries no reason text');
}
{
  // A bill exists, but a stale reason is still sitting on the row (e.g. a retry that succeeded
  // against a Worker that failed to clear it). The bill itself is the truth, not the note.
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', QB_Bill_ID: '77', Bill_Skip_Reason: 'QB bill failed: timeout' }, false);
  ok(g.kind === 'billed', 'an existing QB_Bill_ID outranks a stale Bill_Skip_Reason — never cry gap over a bill that exists');
}

// ---- THE BUG: invoiced, no bill, no explanation ----
{
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', QB_Bill_ID: '' }, false);
  ok(g.kind === 'missing', 'invoiced with no bill and no recorded reason is a HARD gap, not a silent green checkmark');
  ok(/no vendor bill/i.test(g.reason), 'the gap says plainly that the customer was invoiced and the vendor was not billed');
}
{
  // Status can lag; an invoice id alone is enough to prove the customer side went through.
  const g = scopeSigBillGap({ Status: '', QB_Invoice_ID: '55', QB_Bill_ID: '' }, false);
  ok(g.kind === 'missing', 'a QB_Invoice_ID alone proves the customer was billed — the gap does not depend on Status saying Booked');
}
{
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', Bill_Skip_Reason: 'QB bill failed: Duplicate Document Number' }, false);
  ok(g.kind === 'missing', 'a recorded QB failure is a gap');
  ok(g.reason === 'QB bill failed: Duplicate Document Number', 'the exact recorded reason is surfaced verbatim, not paraphrased away');
}
{
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', Bill_Skip_Reason: 'No vendor is set on this scope — no vendor bill will be created.' }, false);
  ok(g.kind === 'missing', 'a missing vendor is a gap Brett has to fix, not an expected skip');
}
{
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', Bill_Skip_Reason: 'The signed selections carry $0 of vendor cost — there is nothing to bill.' }, false);
  ok(g.kind === 'missing', '$0 of vendor cost on a signed scope is a pricing gap worth flagging, not a clean booking');
}

// ---- the ONE legitimate skip: in-house work ----
{
  const g = scopeSigBillGap({ Status: 'Booked', QB_Invoice_ID: '55', Bill_Skip_Reason: SCOPE_BILL_SKIP_INHOUSE }, false);
  ok(g.kind === 'in_house', 'in-house work is an expected skip — Ridge Co never creates a payable to itself');
  ok(g.reason === SCOPE_BILL_SKIP_INHOUSE, 'the in-house reason is passed through for the calm note');
}
{
  // LEGACY ROWS: booked before Bill_Skip_Reason existed, so the row can't explain itself. The
  // in-house case is re-derived from the scope's vendor. Without this, every old in-house job
  // false-flags red — and an alarm that cries wolf is an alarm Brett stops reading.
  const legacy = { Status: 'Booked', QB_Invoice_ID: '55', QB_Bill_ID: '' };
  ok(scopeSigBillGap(legacy, true).kind === 'in_house', 'a legacy row whose vendor is in-house is re-derived as expected, not flagged');
  ok(scopeSigBillGap(legacy, false).kind === 'missing', 'a legacy row with a real (non-in-house) vendor still flags — the fallback excuses in-house only');
}
{
  ok(scopeSigSkipIsInHouse(SCOPE_BILL_SKIP_INHOUSE), 'the canonical in-house reason is recognised as in-house');
  ok(scopeSigSkipIsInHouse('Vendor is marked In-House — skipped'), 'in-house detection is case-insensitive, so older/hand-edited wordings still read as expected');
  ok(!scopeSigSkipIsInHouse('QB bill failed: unknown error'), 'a real failure is never mistaken for the in-house skip');
  ok(!scopeSigSkipIsInHouse(''), 'an empty reason is not in-house');
}

// ---- defensive ----
{
  ok(scopeSigBillGap(null, false).kind === 'not_booked', 'a null row degrades to not_booked rather than throwing inside the Hub list');
}

// ---- the column has to actually exist, or nothing above is ever persisted ----
{
  ok(/SCOPE_SIG_HEADERS\s*=\s*\[[^\]]*'Bill_Skip_Reason'/.test(src), 'Bill_Skip_Reason is declared in SCOPE_SIG_HEADERS');
  ok(/ensureColumns\(env, 'Scope_Signatures', SCOPE_SIG_HEADERS\)/.test(src),
    'book() backfills the column with ensureColumns — ensureTab alone only writes headers to an EMPTY tab, and updateRow silently DROPS a field with no matching header, so the live sheet would swallow every skip reason (FEATURE_LOG rule 37)');
  const commit = src.slice(src.indexOf('// ---- COMMIT ----'));
  ok(commit.indexOf("ensureColumns(env, 'Scope_Signatures'") >= 0 &&
     commit.indexOf("ensureColumns(env, 'Scope_Signatures'") < commit.indexOf("Bill_Skip_Reason: billId"),
    'the backfill runs on the commit path BEFORE the row is written — and not on preview or the customer signing path');
  ok(/Bill_Skip_Reason: billId \? '' : billSkipReason/.test(src),
    'book() persists the reason on every commit and CLEARS it once a bill exists, so a successful retry cannot leave a stale banner');
}

// ---- the Hub must be sent the prorated amount, not the full vendor cost ----
{
  ok(/vendor_bill_amount: vendorBillAmount/.test(src),
    '/scope-proposal/signed returns vendor_bill_amount — the amount book() will actually bill — not just Vendor_Cost_Total under a "deposit share" label');
  const html = fs.readFileSync(new URL('../signed-proposals.html', import.meta.url), 'utf8');
  ok(/r\.vendor_bill_amount/.test(html), 'the Hub reads vendor_bill_amount for the "Bill vendor (deposit share)" figure');
  ok(!/billAmt=r\.kind==='scope' \? r\.vendor_cost_total/.test(html),
    'the Hub no longer shows the vendor\'s FULL job cost under the deposit-share label (the $650-vs-$325 bug)');
  ok(/bill_gap/.test(html) && /Retry vendor bill/.test(html),
    'the Hub renders the persistent gap state and offers a retry rather than a permanent green checkmark');
}

console.log(`scope-bill-gap: ${n} assertions passed`);
