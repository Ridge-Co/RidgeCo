// buildLaborDescription compiles the invoice's labor-line description from what was actually
// logged — each time entry's own Invoice_Description (customer-facing, separate from the
// private Notes field), in date order, filtered to entries linked to THIS bill. The bill's own
// Invoice_Description (the flat-rate / no-time-entry case) leads when present. Falls back to
// the old wo.Invoice_Memo/Description only when neither exists, so old jobs don't regress.
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const buildLaborDescription = new Function(grab('buildLaborDescription') + '\nreturn buildLaborDescription;')();

const wo = { Invoice_Memo: '', Description: 'Tenant reported leak under sink' };

test('compiles linked entries in chronological order, dated', () => {
  const bill = { ID: 'B-1' };
  const entries = [
    { Active: 'TRUE', Bill_ID: 'B-1', Start_DateTime: '2026-08-14T09:00', Invoice_Description: 'Return with parts and complete the repairs' },
    { Active: 'TRUE', Bill_ID: 'B-1', Start_DateTime: '2026-08-12T09:00', Invoice_Description: 'Diagnose' },
  ];
  const out = buildLaborDescription(bill, entries, wo);
  assert.strictEqual(out, '2026-08-12 — Diagnose; 2026-08-14 — Return with parts and complete the repairs');
});

test('the bill\'s own Invoice_Description leads when set (flat-rate / no time entries)', () => {
  const bill = { ID: 'B-2', Invoice_Description: 'Trash service — weekly pickup' };
  const out = buildLaborDescription(bill, [], wo);
  assert.strictEqual(out, 'Trash service — weekly pickup');
});

test('bill description and entry descriptions combine when both exist', () => {
  const bill = { ID: 'B-3', Invoice_Description: 'Kitchen faucet repair' };
  const entries = [
    { Active: 'TRUE', Bill_ID: 'B-3', Start_DateTime: '2026-08-12T09:00', Invoice_Description: 'Diagnose' },
  ];
  const out = buildLaborDescription(bill, entries, wo);
  assert.strictEqual(out, 'Kitchen faucet repair; 2026-08-12 — Diagnose');
});

test('entries linked to a DIFFERENT bill are excluded', () => {
  const bill = { ID: 'B-1' };
  const entries = [
    { Active: 'TRUE', Bill_ID: 'B-2', Start_DateTime: '2026-08-12T09:00', Invoice_Description: 'Wrong job' },
  ];
  const out = buildLaborDescription(bill, entries, wo);
  assert.strictEqual(out, wo.Description);   // nothing matched — falls back
});

test('inactive (soft-deleted) entries are excluded', () => {
  const bill = { ID: 'B-1' };
  const entries = [
    { Active: 'FALSE', Bill_ID: 'B-1', Start_DateTime: '2026-08-12T09:00', Invoice_Description: 'Deleted entry' },
  ];
  const out = buildLaborDescription(bill, entries, wo);
  assert.strictEqual(out, wo.Description);
});

test('entries with a blank Invoice_Description are skipped, not rendered as an empty segment', () => {
  const bill = { ID: 'B-1' };
  const entries = [
    { Active: 'TRUE', Bill_ID: 'B-1', Start_DateTime: '2026-08-12T09:00', Invoice_Description: '' },
    { Active: 'TRUE', Bill_ID: 'B-1', Start_DateTime: '2026-08-13T09:00', Invoice_Description: 'Complete the repair' },
  ];
  const out = buildLaborDescription(bill, entries, wo);
  assert.strictEqual(out, '2026-08-13 — Complete the repair');
});

test('falls back to wo.Invoice_Memo (preferred over wo.Description) when nothing new was filled in', () => {
  const bill = { ID: 'B-9' };
  const woWithMemo = { Invoice_Memo: 'Hand-typed memo from before this feature existed', Description: 'Original tenant request' };
  const out = buildLaborDescription(bill, [], woWithMemo);
  assert.strictEqual(out, woWithMemo.Invoice_Memo);
});

test('old jobs with no bill/entry data at all fall back to wo.Description, unchanged from before', () => {
  const bill = {};
  const out = buildLaborDescription(bill, [], wo);
  assert.strictEqual(out, wo.Description);
});
