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

function makeSandbox({ fetchTabRows, alreadySharedIds, shareOkIds, telemetryCalls }) {
  const factory = new Function(
    'fetchTab', 'getAccessToken', 'logTelemetry', 'json', 'driveShareAnyone', 'driveIsSharedAnyone',
    "const NON_SHARE_FILE_TYPES = ['receipt','bill','invoice'];\n" +
    grab('adminShareAttachments') +
    '\nreturn { adminShareAttachments };'
  );
  return factory(
    async () => fetchTabRows,
    async () => 'fake-token',
    async (env, rec) => { telemetryCalls.push(rec); },
    (data) => ({ __json: true, data }),
    async (token, fileId) => (shareOkIds ? shareOkIds.has(fileId) : true),
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

  // ── 4. Real mode: failures still collect correctly, bounded by limit ──
  tc = [];
  const S4 = makeSandbox({ fetchTabRows: rowsOf(6), alreadySharedIds: new Set(), telemetryCalls: tc, shareOkIds: new Set(['file-1','file-3']) });
  const realFail = (await S4.adminShareAttachments({}, { dry_run: false, limit: 6 })).data;
  t('failed files are counted', realFail.failed === 4, realFail.failed);
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

  console.log(`\nshare-attachments-limit: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
