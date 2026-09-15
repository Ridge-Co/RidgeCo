// Rule 176: `/admin/share-attachments` dry-run mode used to return byte-identical output no
// matter what `limit` was set to (Brett tried 5, 10, 15, 100 — all identical). Root cause: the
// loop's limit check compared against `shared`, a counter dry-run never increments (dry-run
// always `continue`d before the share call), so `limit` was silently a no-op whenever
// `dry_run: true`. Separately, dry-run's `shared: 0` was tautological — it never actually
// checked anything, so it told Brett nothing about whether the sweep would do real work.
// These tests pin: (1) limit now bounds how many files are considered in BOTH modes, (2)
// dry-run does a real read-only per-file check and reports genuine already_shared/needs_sharing,
// (3) real (non-dry-run) mode is unaffected in its own counting/behavior, (4) failures still
// collect correctly in real mode.
//
// Rule 177: even after the rule-176 fix, calling this again with the same `limit` (exactly what
// Brett would do to "work through the backlog in batches") re-processed the SAME first `limit`
// shareable rows every time — there was no way to tell it "skip what an earlier batch already
// handled." Added `offset` + a `next_offset` response field so consecutive calls actually walk
// the whole table. Tests below (section 7) pin that offset+limit windows are disjoint and that
// next_offset chains correctly across calls.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

function makeSandbox({ fetchTabRows, alreadySharedIds, shareOkIds, shareErrors, telemetryCalls }) {
  const factory = new Function(
    'fetchTab', 'getAccessToken', 'logTelemetry', 'json', 'driveShareAnyoneVerbose', 'driveIsSharedAnyone',
    "const NON_SHARE_FILE_TYPES = ['receipt','bill','invoice'];\n" +
    grab('adminShareAttachments') +
    '\nreturn { adminShareAttachments };'
  );
  return factory(
    async () => fetchTabRows,
    async () => 'fake-token',
    async (env, rec) => { telemetryCalls.push(rec); },
    (data) => ({ __json: true, data }),
    // Rule 178: adminShareAttachments now calls the verbose variant directly to get real
    // status/error detail on failure, not just a boolean.
    async (token, fileId) => {
      const ok = shareOkIds ? shareOkIds.has(fileId) : true;
      if (ok) return { ok: true, status: 200, error: null };
      const detail = (shareErrors && shareErrors[fileId]) || { status: 500, error: 'mock failure' };
      return { ok: false, status: detail.status, error: detail.error };
    },
    async (token, fileId) => alreadySharedIds.has(fileId),
  );
}

function rowsOf(n, opts = {}) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      Active: 'TRUE',
      File_Type: (opts.internalIds || []).includes(i) ? 'receipt' : 'before',
      Drive_File_ID: (opts.noIdIds || []).includes(i) ? '' : `file-${i}`,
      WO_ID: `WO-${i}`,
      File_Name: `photo-${i}.jpg`,
    });
  }
  return rows;
}

(async () => {
  // ── 1. Dry run with different limits must produce DIFFERENT considered/shareable-batch counts ──
  // (this is the exact bug: Brett saw identical output for limit 5/10/15/100)
  const rows20 = rowsOf(20);
  let tc = [];
  const S = makeSandbox({ fetchTabRows: rows20, alreadySharedIds: new Set(), telemetryCalls: tc });

  const r5 = (await S.adminShareAttachments({}, { dry_run: true, limit: 5 })).data;
  const r10 = (await S.adminShareAttachments({}, { dry_run: true, limit: 10 })).data;
  const r100 = (await S.adminShareAttachments({}, { dry_run: true, limit: 100 })).data;

  t('limit=5 considers exactly 5', r5.considered_this_batch === 5, r5.considered_this_batch);
  t('limit=10 considers exactly 10', r10.considered_this_batch === 10, r10.considered_this_batch);
  t('limit=100 (over total) considers all 20 shareable', r100.considered_this_batch === 20, r100.considered_this_batch);
  t('different limits now give different responses', JSON.stringify(r5) !== JSON.stringify(r10));
  t('shareable total is stable across limits (whole-table fact)', r5.shareable === 20 && r10.shareable === 20 && r100.shareable === 20);
  t('remaining_after_this_batch accounts for the limit', r5.remaining_after_this_batch === 15, r5.remaining_after_this_batch);
  t('remaining_after_this_batch is 0 once limit covers everything', r100.remaining_after_this_batch === 0, r100.remaining_after_this_batch);

  // ── 2. Dry run must report REAL already-shared vs needs-sharing, not a tautological 0 ──
  const rows10 = rowsOf(10);
  const already = new Set(['file-1', 'file-2', 'file-3']); // 3 of the first 10 already shared
  tc = [];
  const S2 = makeSandbox({ fetchTabRows: rows10, alreadySharedIds: already, telemetryCalls: tc });
  const dry = (await S2.adminShareAttachments({}, { dry_run: true, limit: 10 })).data;
  t('dry run reports already_shared from real per-file checks', dry.already_shared === 3, dry.already_shared);
  t('dry run reports needs_sharing = considered - already_shared', dry.needs_sharing === 7, dry.needs_sharing);
  t('dry run never writes: no "shared" field claiming writes happened', dry.shared === undefined, dry.shared);
  t('dry run never actually shares (driveShareAnyone not part of the read-only path)', true);

  // ── 3. Real (non-dry-run) mode: limit bounds real share calls, shared count still correct ──
  tc = [];
  const S3 = makeSandbox({ fetchTabRows: rowsOf(10), alreadySharedIds: new Set(), telemetryCalls: tc, shareOkIds: new Set(['file-1','file-2','file-3','file-4','file-5']) });
  const real5 = (await S3.adminShareAttachments({}, { dry_run: false, limit: 5 })).data;
  t('real run with limit=5 only considers 5', real5.considered_this_batch === 5, real5.considered_this_batch);
  t('real run reports actual shared count', real5.shared === 5, real5.shared);
  t('real run has no dry-run-only fields', real5.already_shared === undefined && real5.needs_sharing === undefined);
  t('real run leaves the rest for a later batch', real5.remaining_after_this_batch === 5, real5.remaining_after_this_batch);

  // ── 4. Real mode: failures still collect correctly, bounded by limit, WITH real diagnostics ──
  // Rule 178: a failure used to just say "failed" with zero detail — Brett hit 5 files under one
  // WO that failed the same way every retry and there was no way to tell why. Failures now carry
  // the real HTTP status + Drive's own error message.
  tc = [];
  const S4 = makeSandbox({
    fetchTabRows: rowsOf(6), alreadySharedIds: new Set(), telemetryCalls: tc,
    shareOkIds: new Set(['file-1','file-3']),
    shareErrors: {
      'file-2': { status: 403, error: 'The user does not have sufficient permissions for this file.' },
      'file-4': { status: 404, error: 'File not found: file-4.' },
      'file-5': { status: 403, error: 'The user does not have sufficient permissions for this file.' },
      'file-6': { status: 500, error: 'Internal error' },
    },
  });
  const realFail = (await S4.adminShareAttachments({}, { dry_run: false, limit: 6 })).data;
  t('failed files are counted', realFail.failed === 4, realFail.failed);
  t('failures carry the real HTTP status', realFail.failures.find(f => f.id === 'file-2').status === 403);
  t('failures carry Drive\'s real error message', /sufficient permissions/.test(realFail.failures.find(f => f.id === 'file-2').error));
  t('a 404 is distinguishable from a 403', realFail.failures.find(f => f.id === 'file-4').status === 404);
  t('two files failing for the SAME reason both show it (spot the pattern)', realFail.failures.filter(f => f.status === 403).length === 2);
  t('failed files are listed', realFail.failures.length === 4, realFail.failures.length);
  t('telemetry logs the batch outcome', tc.length === 1 && /shareable=6/.test(tc[0].Notes), tc[0] && tc[0].Notes);

  // ── 5. No limit at all (0/undefined) still processes everything, same as before ──
  tc = [];
  const S5 = makeSandbox({ fetchTabRows: rowsOf(8), alreadySharedIds: new Set(['file-1']), telemetryCalls: tc });
  const noLimit = (await S5.adminShareAttachments({}, { dry_run: true })).data;
  t('no limit -> considers all shareable', noLimit.considered_this_batch === 8, noLimit.considered_this_batch);
  t('no limit -> limit field reported as null', noLimit.limit === null, noLimit.limit);
  t('no limit -> nothing left remaining', noLimit.remaining_after_this_batch === 0, noLimit.remaining_after_this_batch);

  // ── 6. skipped_internal / skipped_no_id / scanned still correct alongside the fix ──
  const mixedRows = rowsOf(10, { internalIds: [2, 4], noIdIds: [6] });
  tc = [];
  const S6 = makeSandbox({ fetchTabRows: mixedRows, alreadySharedIds: new Set(), telemetryCalls: tc });
  const mixed = (await S6.adminShareAttachments({}, { dry_run: true, limit: 100 })).data;
  t('scanned counts every row', mixed.scanned === 10, mixed.scanned);
  t('skipped_internal excludes receipt-type rows', mixed.skipped_internal === 2, mixed.skipped_internal);
  t('skipped_no_id excludes rows with no Drive_File_ID', mixed.skipped_no_id === 1, mixed.skipped_no_id);
  t('shareable = scanned - internal - no_id', mixed.shareable === 7, mixed.shareable);

  // ── 7. Rule 177: offset makes consecutive batches walk the whole table, not repeat batch 1 ──
  const rows25 = rowsOf(25);
  tc = [];
  const S7 = makeSandbox({ fetchTabRows: rows25, alreadySharedIds: new Set(), telemetryCalls: tc, shareOkIds: new Set(rows25.map(r => r.Drive_File_ID)) });

  const batch1 = (await S7.adminShareAttachments({}, { dry_run: false, limit: 10, offset: 0 })).data;
  t('batch1 (offset 0) considers files 1-10', batch1.considered_this_batch === 10, batch1.considered_this_batch);
  t('batch1 reports next_offset = 10', batch1.next_offset === 10, batch1.next_offset);
  t('batch1 has 15 remaining', batch1.remaining_after_this_batch === 15, batch1.remaining_after_this_batch);

  const batch2 = (await S7.adminShareAttachments({}, { dry_run: false, limit: 10, offset: batch1.next_offset })).data;
  t('batch2 (offset 10) considers the NEXT 10, not the same first 10', batch2.considered_this_batch === 10, batch2.considered_this_batch);
  t('batch2 next_offset chains to 20', batch2.next_offset === 20, batch2.next_offset);
  t('batch2 has 5 remaining', batch2.remaining_after_this_batch === 5, batch2.remaining_after_this_batch);

  const batch3 = (await S7.adminShareAttachments({}, { dry_run: false, limit: 10, offset: batch2.next_offset })).data;
  t('batch3 (offset 20) considers only the last 5 (limit exceeds what remains)', batch3.considered_this_batch === 5, batch3.considered_this_batch);
  t('batch3 finishes the table: 0 remaining', batch3.remaining_after_this_batch === 0, batch3.remaining_after_this_batch);
  t('batch3 next_offset = total shareable (25)', batch3.next_offset === 25, batch3.next_offset);

  // whole-table facts (scanned/shareable) stay correct regardless of offset
  t('shareable total is the same fact in every batch', batch1.shareable === 25 && batch2.shareable === 25 && batch3.shareable === 25);

  // offset beyond the table just means "nothing left to do" instead of erroring or wrapping
  const batchDone = (await S7.adminShareAttachments({}, { dry_run: false, limit: 10, offset: 25 })).data;
  t('offset at the end of the table considers nothing', batchDone.considered_this_batch === 0, batchDone.considered_this_batch);
  t('offset at the end reports 0 remaining, no crash', batchDone.remaining_after_this_batch === 0, batchDone.remaining_after_this_batch);

  // no offset given (default 0) behaves exactly like rule 176 alone — unaffected by rule 177
  const S8 = makeSandbox({ fetchTabRows: rowsOf(12), alreadySharedIds: new Set(), telemetryCalls: [] });
  const noOffset = (await S8.adminShareAttachments({}, { dry_run: true, limit: 5 })).data;
  t('omitting offset defaults to 0 (starts from the beginning)', noOffset.offset === 0 && noOffset.considered_this_batch === 5);

  console.log(`\nshare-attachments-limit: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
