// Scope proposal customer view — `note` leak fix (Aug 24 2026 incident).
// A scope item's free-text `note` field (typed into scope-creator.html with no
// internal/customer split) was being echoed straight through scopeProposalView() to the
// customer-facing scope-proposal.html page. A live proposal shipped a vendor's raw quote text
// ("Vendor quote $650 for this full punch list...") to a customer this way. `vendor_cost` was
// already stripped at this exact boundary (see scope-variants.test.mjs) — `note` never was,
// until now. This test asserts the item-mapping object literal inside scopeProposalView()
// does not reference `it.note` (or any `note` key) at all, the same structural-check style
// scope-variants.test.mjs uses for the vendor_cost contract.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const fn = grab('scopeProposalView');

// The item-mapping block: `const items = rawItems.map(it => ({ ... }))`.
const mapStart = fn.indexOf('const items = rawItems.map(it => (');
ok(mapStart >= 0, 'scopeProposalView still builds its customer-facing `items` via rawItems.map(it => ({...}))');
const mapEnd = fn.indexOf('}));', mapStart);
const mapBlock = fn.slice(mapStart, mapEnd + 4);

ok(!/\bit\.note\b/.test(mapBlock), 'customer-facing item mapping in scopeProposalView never reads it.note');
ok(!/\bnote\s*:/.test(mapBlock), 'customer-facing item mapping in scopeProposalView never emits a `note` key');

// Belt-and-suspenders: vendor_cost still stripped too (regression guard against re-breaking
// the original #1 non-negotiable while fixing this one). Checks for an actual `vendor_cost:`
// key/assignment, not just the word — the line above legitimately says "// no vendor_cost" in
// a comment to document the omission, which would false-positive on a bare substring match.
ok(!/vendor_cost\s*:/.test(mapBlock), 'customer-facing item mapping still contains no vendor_cost key');

console.log(`scope-proposal-note-leak: ${n} assertions passed`);
