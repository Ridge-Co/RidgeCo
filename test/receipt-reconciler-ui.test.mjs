// Tests the pure logic behind the Aug 23 Receipt Reconciler UI fixes (Brett's 4-issue report):
// (C) the WO-existence guard's boolean shape, and (D) the 180-day confirmed-duplicate purge
// decision (receiptDuplicatePurgeDue). Both are extracted straight from worker.js, not
// reimplemented, per the codebase's convention (mirrors receipt-suggest-core.test.mjs).
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
const { receiptDuplicatePurgeDue } = new Function(
  grab('receiptDuplicatePurgeDue') + '\nreturn { receiptDuplicatePurgeDue };'
)();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// ── receiptDuplicatePurgeDue — the 180-day retention decision (Brett's issue D) ──
const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2027-01-01T00:00:00Z');

t('not due — wrong status (still pending)', receiptDuplicatePurgeDue({ Status: 'pending', Duplicate_Confirmed_Date: new Date(now - 200 * DAY).toISOString() }, now, 180) === false);
t('not due — already purged (Active FALSE)', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Active: 'FALSE', Duplicate_Confirmed_Date: new Date(now - 200 * DAY).toISOString() }, now, 180) === false);
t('not due — confirmed only 10 days ago', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: new Date(now - 10 * DAY).toISOString() }, now, 180) === false);
t('not due — missing Duplicate_Confirmed_Date entirely', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: '' }, now, 180) === false);
t('not due — unparseable date string', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: 'not-a-date' }, now, 180) === false);
t('not due — 179 days (one day short)', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: new Date(now - 179 * DAY).toISOString() }, now, 180) === false);
t('DUE — exactly 180 days (boundary, inclusive)', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: new Date(now - 180 * DAY).toISOString() }, now, 180) === true);
t('DUE — well past 180 days', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: new Date(now - 365 * DAY).toISOString() }, now, 180) === true);
t('respects a different retention window if ever passed explicitly', receiptDuplicatePurgeDue({ Status: 'duplicate_confirmed', Duplicate_Confirmed_Date: new Date(now - 40 * DAY).toISOString() }, now, 30) === true);
t('null row does not throw', receiptDuplicatePurgeDue(null, now, 180) === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
