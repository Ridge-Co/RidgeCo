// Hand-edited Proposal_Text guard (Aug 24 2026 — same-day follow-up to the scopeProposalView
// `note` leak fix). POST /scope/update lets Brett/Cowork save a hand-typed Proposal_Text directly,
// bypassing the AI rewrite in scopeProposal() — that text is never filtered anywhere else before
// reaching the customer via scopeProposalView's legacy flat-text fallback. findVendorPricingLeak()
// gates it at the one place it's ever written. This test checks it catches real vendor-pricing
// language WITHOUT false-positiving on the standard customer-facing boilerplate every proposal
// already uses (Brett's rule explicitly allows the job description + final price/deposit).
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
const { findVendorPricingLeak } = new Function(grab('findVendorPricingLeak') + '\nreturn { findVendorPricingLeak };')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- must catch the actual incident language and obvious variants ----
ok(!!findVendorPricingLeak('Vendor quote $650 for this full punch list (lump sum, not per item).'),
  'catches the exact incident phrase ("Vendor quote $...")');
ok(!!findVendorPricingLeak('Contractor quoted $3,200 for the repair option.'),
  'catches "Contractor quoted $..."');
ok(!!findVendorPricingLeak('Applying a 25% markup plus 5% admin fee.'),
  'catches "markup"');
ok(!!findVendorPricingLeak('Our margin on this job is about 30%.'),
  'catches "margin"');
ok(!!findVendorPricingLeak('This price is marked-up from the vendor cost.'),
  'catches "marked-up" / "vendor cost"');
ok(!!findVendorPricingLeak("Remember: we're making about $1,200 on this one."),
  'catches "we\'re making $..."');

// ---- realistic close variants (found by adversarial review of the first pass) ----
ok(!!findVendorPricingLeak("Vendor's quote was $650 for the punch list."),
  'catches possessive "Vendor\'s quote"');
ok(!!findVendorPricingLeak('Vendors quote ran $650 on this one.'),
  'catches plural "Vendors quote"');
ok(!!findVendorPricingLeak('Sub charged us $650 for the drywall.'),
  'catches "Sub charged us $..."');
ok(!!findVendorPricingLeak('We were quoted $650 by the roofer before markup.'),
  'catches "We were quoted $..."');
ok(!!findVendorPricingLeak("We're clearing about $1,200 on this one."),
  'catches "we\'re clearing $..." (profit-margin paraphrase)');

// ---- must NOT false-positive on the standard customer-facing boilerplate ----
const legitDoc = `3101 Gibbons Ave\n\nScope of Work:\n\nExterior:\n  - Repair roof above 2nd floor bathroom\n\nFinancial Terms:\n\nTotal Estimated Cost: $925.00\nRequired 50% Deposit: $462.50\n\nPayment & Project Terms:\n\n- A 50% electronic deposit is required to approve this proposal and schedule the work.\n- All deposits and final invoices must be paid electronically. Physical checks are not accepted.`;
ok(findVendorPricingLeak(legitDoc) === null, 'standard customer-facing proposal boilerplate ("Total Estimated Cost", "Deposit") is NOT flagged');
ok(findVendorPricingLeak('') === null, 'empty text is not flagged');
ok(findVendorPricingLeak('Replace the kitchen faucet and re-caulk the tub surround.') === null,
  'a plain job description with no pricing language at all is not flagged');
ok(findVendorPricingLeak('Reset the door margin so it does not rub the frame.') === null,
  'ordinary trade use of "margin" (door/cabinet fit) is NOT flagged — only the money sense is');
ok(findVendorPricingLeak('Vendor billing address updated on file.') === null,
  '"vendor billing" (an unrelated admin note) is not flagged now that bill* was dropped from the vendor pattern');

// ---- documented residual gap (acceptable for a keyword net, not a bug) ----
// A pricing sentence with no trigger noun/phrase at all is invisible to this guard by
// construction — this is the known, documented limitation, not a regression to fix here.
ok(findVendorPricingLeak('Our cost is $400, customer price is $650.') === null,
  'DOCUMENTED GAP: two dollar amounts with no vendor/contractor/markup/margin trigger word still slip through — keyword net, not semantic filter (see function comment / FEATURE_LOG)');

console.log(`scope-update-proposal-text-guard: ${n} assertions passed`);
