// Ops_Build_Queue #5 — smoke test for /admin/share-attachments: mocks a realistic Attachments
// payload (mixed file types, a missing Drive_File_ID, an already-known-missing row) and asserts
// adminShareAttachments resolves the right share target per row and classifies file types
// correctly, so a future regression here (e.g. a NON_SHARE_FILE_TYPES edit that accidentally
// starts sharing receipts/bills/invoices) is caught before a tenant or admin ever reports a
// missing/wrongly-exposed document. Complements the deeper edge-case coverage in
// test/share-attachments-limit.test.mjs — this file stays intentionally small and readable as
// a single end-to-end smoke pass over one realistic-shaped payload.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// A realistic mixed Attachments payload for one WO's photo/document set.
const payload = [
  { ID: 'a1', Active: 'TRUE', File_Type: 'before',   Drive_File_ID: 'drive-before-1',   WO_ID: 'WO-1', File_Name: 'before.jpg' },
  { ID: 'a2', Active: 'TRUE', File_Type: 'after',    Drive_File_ID: 'drive-after-1',    WO_ID: 'WO-1', File_Name: 'after.jpg' },
  { ID: 'a3', Active: 'TRUE', File_Type: 'receipt',  Drive_File_ID: 'drive-receipt-1',  WO_ID: 'WO-1', File_Name: 'receipt.pdf' },
  { ID: 'a4', Active: 'TRUE', File_Type: 'bill',     Drive_File_ID: 'drive-bill-1',     WO_ID: 'WO-1', File_Name: 'bill.pdf' },
  { ID: 'a5', Active: 'TRUE', File_Type: 'invoice',  Drive_File_ID: 'drive-invoice-1',  WO_ID: 'WO-1', File_Name: 'invoice.pdf' },
  { ID: 'a6', Active: 'TRUE', File_Type: 'before',   Drive_File_ID: '',                 WO_ID: 'WO-2', File_Name: 'no-drive-id.jpg' },
  { ID: 'a7', Active: 'FALSE', File_Type: 'before',  Drive_File_ID: 'drive-inactive-1', WO_ID: 'WO-2', File_Name: 'inactive.jpg' },
  { ID: 'a8', Active: 'TRUE', File_Type: 'before',   Drive_File_ID: 'drive-missing-1',  Drive_File_Missing: 'TRUE', WO_ID: 'WO-3', File_Name: 'gone.jpg' },
];

const factory = new Function(
  'fetchTab', 'getAccessToken', 'logTelemetry', 'json', 'driveShareAnyoneVerbose', 'driveIsSharedAnyone',
  'ensureColumns', 'updateRow',
  "const NON_SHARE_FILE_TYPES = ['receipt','bill','invoice'];\n" +
  grab('adminShareAttachments') +
  '\nreturn { adminShareAttachments };'
);

const sharedIds = [];
const { adminShareAttachments } = factory(
  async () => payload,
  async () => 'fake-token',
  async () => {},
  (data) => ({ __json: true, data }),
  async (token, fileId) => { sharedIds.push(fileId); return { ok: true, status: 200, error: null }; },
  async () => false,
  async () => {},
  async () => {},
);

const { data: result } = await adminShareAttachments({}, { dry_run: false });

{
  ok(sharedIds.includes('drive-before-1'), '"before" photo is shared');
  ok(sharedIds.includes('drive-after-1'), '"after" photo is shared');
  ok(!sharedIds.includes('drive-receipt-1'), 'a receipt is NEVER shared — customer-money-sensitive document stays internal');
  ok(!sharedIds.includes('drive-bill-1'), 'a bill is NEVER shared, same reason');
  ok(!sharedIds.includes('drive-invoice-1'), 'an invoice is NEVER shared, same reason');
  ok(!sharedIds.includes('drive-inactive-1'), 'an Active=FALSE row is never touched, regardless of file type');
  ok(!sharedIds.includes('drive-missing-1'), 'a row already marked Drive_File_Missing is never re-attempted');
  ok(sharedIds.length === 2, `exactly the 2 real, active, non-financial, not-already-missing photos get a share call — got ${sharedIds.length}: ${JSON.stringify(sharedIds)}`);
}

{
  ok(result.scanned === 8, 'scanned counts every row in the payload, including inactive/no-id/known-missing ones');
  ok(result.skipped_internal === 3, 'the 3 financial-document rows (receipt/bill/invoice) are counted as skipped_internal');
  ok(result.skipped_no_id === 1, 'the row with a blank Drive_File_ID is counted as skipped_no_id');
  ok(result.skipped_known_missing === 1, 'the already-marked row is counted as skipped_known_missing, not re-processed');
  ok(result.shareable === 2, 'shareable reflects only the 2 rows actually eligible for a share call');
  ok(result.shared === 2 && result.failed === 0, 'both eligible rows share successfully in this scenario');
}

console.log(`admin-share-attachments-smoke: ${n}/${n} passing`);
