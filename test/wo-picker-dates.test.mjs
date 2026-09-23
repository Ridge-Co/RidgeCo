// Tests the pure date-window-check logic behind Part 5 (Sep 22 2026, Brett 7:57pm): "when I'm
// matching a receipt to a work order I can't see when that WO was opened/closed — I want to
// eyeball whether the receipt date makes sense next to the WO's own dates."
// Extracts the REAL functions straight out of receipt-reconciler.html's inline <script> (not
// reimplemented) so this can't drift from what ships, mirroring receipt-suggest-core.test.mjs's
// convention of grabbing pure functions out of the real source rather than duplicating them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'receipt-reconciler.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('could not find inline <script> in receipt-reconciler.html');
const src = scriptMatch[1];

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const isoConst = 'const ISO_DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;\n';
const { woDatesLabel, woDateWindowWarning } = new Function(
  isoConst + grab('woDatesLabel') + '\n' + grab('woDateWindowWarning') + '\nreturn { woDatesLabel, woDateWindowWarning };'
)();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

// ── woDatesLabel ──────────────────────────────────────────────────────────────────────────────
ok(woDatesLabel({ Created_Date: '2026-08-01', Completed_Date: '' }) === 'opened 2026-08-01', 'open WO (no Completed_Date) shows opened only');
ok(woDatesLabel({ Created_Date: '2026-08-01', Completed_Date: '2026-09-10' }) === 'opened 2026-08-01 · closed 2026-09-10', 'closed WO shows both dates');
ok(woDatesLabel({ Created_Date: '2026-08-01T14:22:00.000Z', Completed_Date: '' }) === 'opened 2026-08-01', 'full ISO timestamp Created_Date is truncated to the date part');
ok(woDatesLabel({ Created_Date: '', Completed_Date: '' }) === '', 'no dates on file -> empty label, never throws');
ok(woDatesLabel({}) === '', 'missing fields entirely -> empty label');
ok(woDatesLabel(null) === '', 'null WO -> empty label, never throws');
ok(woDatesLabel({ Created_Date: 'not-a-date', Completed_Date: 'also-not' }) === '', 'unparseable date strings are dropped, not shown garbled');

// ── woDateWindowWarning ──────────────────────────────────────────────────────────────────────
const wo = { ID: '4021', Created_Date: '2026-08-01', Completed_Date: '2026-09-10' };
ok(woDateWindowWarning('2026-08-15', wo) === null, 'receipt dated inside the open→close window -> no warning');
ok(woDateWindowWarning('2026-08-01', wo) === null, 'receipt dated exactly on the opened date -> no warning (boundary inclusive)');
ok(woDateWindowWarning('2026-09-10', wo) === null, 'receipt dated exactly on the closed date -> no warning (boundary inclusive)');

const before = woDateWindowWarning('2026-07-15', wo);
ok(before && before.type === 'before_open', 'receipt dated before the WO opened -> before_open warning');
ok(/predates this WO/.test(before.message) && /2026-08-01/.test(before.message), 'before_open message names the opened date (' + before.message + ')');

const after = woDateWindowWarning('2026-09-25', wo);
ok(after && after.type === 'after_close', 'receipt dated after the WO closed -> after_close warning');
ok(/dated after this WO closed/.test(after.message) && /2026-09-10/.test(after.message), 'after_close message names the closed date (' + after.message + ')');

// Still-open WO (no Completed_Date) — only the before-open check can ever fire.
const openWo = { ID: '5001', Created_Date: '2026-09-01', Completed_Date: '' };
ok(woDateWindowWarning('2026-09-20', openWo) === null, 'still-open WO, receipt well after opened -> no warning (nothing to compare against for "closed")');
const openBefore = woDateWindowWarning('2026-08-01', openWo);
ok(openBefore && openBefore.type === 'before_open', 'still-open WO but receipt predates its own opened date -> still warns');

// Missing/unparseable data must never warn (never a false positive on incomplete data) and must
// never throw.
ok(woDateWindowWarning('', wo) === null, 'blank receipt date -> no warning');
ok(woDateWindowWarning('not-a-date', wo) === null, 'unparseable receipt date -> no warning');
ok(woDateWindowWarning('2026-07-01', { ID: '9', Created_Date: '', Completed_Date: '' }) === null, 'WO with no dates on file at all -> no warning (nothing to compare against)');
ok(woDateWindowWarning('2026-07-01', null) === null, 'null WO -> no warning, never throws');
ok(woDateWindowWarning(null, wo) === null, 'null receipt date -> no warning, never throws');

// A WO that's Complete-but-still-"open" per OPEN_WO_STATUSES (Complete stays open in this picker
// per worker.js's OPEN_WO_STATUSES) can still have a Completed_Date on file (set at the Complete
// transition) — the date check is purely date-based, independent of Status/open-closed grouping.
const completeButOpen = { ID: '6001', Status: 'Complete', Created_Date: '2026-08-01', Completed_Date: '2026-08-20' };
const lateReceipt = woDateWindowWarning('2026-09-01', completeButOpen);
ok(lateReceipt && lateReceipt.type === 'after_close', 'a receipt dated after Completed_Date still warns even though Status=Complete is grouped as "open" in the picker');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
