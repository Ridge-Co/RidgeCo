// Oct 1 2026 (Brett): (1) Re-open a Reconciler receipt that was already emailed to QuickBooks without a
// duplicate QB email, (2) put a shared copy of every Reconciler receipt in the WO's customer Drive folder
// (scoped exception to FEATURE_LOG rule 13) - find-before-create / adopt-never-duplicate, (3) backfill, (4) guards.
// Extracts the REAL functions from worker.js (not reimplemented), same convention as the other receipt tests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const rr = fs.readFileSync(new URL('../receipt-reconciler.html', import.meta.url), 'utf8');
const idx = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const PURE = ['_rcNorm', 'receiptReconQueueIndex', 'receiptFolderCopyCandidates', 'receiptIdsWithFolderCopy', 'receiptSourceDriveId', 'receiptFolderCopyExt', 'receiptFolderCopyTitle',
  'driveQueryQuote', 'pickAdoptableCopy', 'uniqueCopyTitle', 'receiptInvoiceSentReason', 'receiptReopenGuard', 'receiptQbCarryFor', 'invoiceReceiptFolderIssue', 'selftestCheckReceiptFolderCopies', 'receiptCopyFail'];
const mimeConst = /const RECEIPT_COPY_MIME_EXT = \{[^}]*\};/.exec(src)[0];
const P = new Function(mimeConst + '\n' + PURE.map(grab).join('\n') + '\nreturn {' + PURE.join(',') + '};')();

// ── the 8 hand-made copies (Brett, Oct 1) must be ADOPTED, never duplicated ─────────────────────
test('title format: Receipt - <Store> <Date> - $<Amount>.<ext>', () => {
  assert.equal(P.receiptFolderCopyTitle({ Store: "Lowe's", Date: '2026-09-04T00:00:00Z', Amount: '50.2' }, 'jpg'), "Receipt - Lowe's 2026-09-04 - $50.20.jpg");
  assert.equal(P.receiptFolderCopyTitle({ Store: 'Home Depot', Date: '2026-09-04', Amount: '-12' }, 'pdf'), 'Receipt - Home Depot 2026-09-04 - -$12.00.pdf');
  assert.equal(P.receiptFolderCopyTitle({ Store: 'A/B', Date: '', Amount: '5' }, ''), 'Receipt - A-B - $5.00');
  assert.equal(P.receiptFolderCopyExt('scan.PNG', 'image/jpeg', ''), 'png');
  assert.equal(P.receiptFolderCopyExt('scan', 'image/heic', ''), 'heic');
  assert.equal(P.receiptFolderCopyExt('x', '', 'jpeg'), 'jpeg');
});
test('adoption: exact title, then normalized (jpeg vs jpg, apostrophes), never a file another receipt owns', () => {
  const title = "Receipt - Lowe's 2026-09-04 - $50.20.jpg";
  const files = [{ id: 'A', name: 'unrelated.jpg' }, { id: 'B', name: 'Receipt - Lowes 2026-09-04 - $50.20.jpeg' }, { id: 'C', name: title }];
  assert.deepEqual([P.pickAdoptableCopy(files, title, new Set()).file.id, P.pickAdoptableCopy(files, title, new Set()).via], ['C', 'exact']);
  assert.equal(P.pickAdoptableCopy(files.filter(f => f.id !== 'C'), title, new Set()).file.id, 'B');
  assert.equal(P.pickAdoptableCopy(files.filter(f => f.id !== 'C'), title, new Set(['B'])), null, 'claimed file is never adopted by a second receipt');
  assert.equal(P.pickAdoptableCopy([{ id: 'F', name: title, mimeType: 'application/vnd.google-apps.folder' }, { id: 'T', name: title, trashed: true }], title, new Set()), null);
  assert.equal(P.uniqueCopyTitle(title, [title], 77), "Receipt - Lowe's 2026-09-04 - $50.20 (receipt 77).jpg");
});

// ── copyReceiptIntoWOFolder end-to-end against a fake Drive/Sheets ──────────────────────────────
function world({ files = [], shareOk = true, srcMeta = { id: 'SRC', name: 'scan.jpg', mimeType: 'image/jpeg', fileExtension: 'jpg' }, woFolder = 'FOLDER1' } = {}) {
  const log = { copies: [], shares: [], addRows: [], updateRows: [], tele: [], created: 0 };
  const deps = {
    fetch: async (url, init) => {
      url = String(url); const method = (init && init.method) || 'GET';
      const resp = (o, ok = true, status = 200) => ({ ok, status, json: async () => o });
      if (/\/files\/SRC\?/.test(url)) return srcMeta ? resp(srcMeta) : resp({}, false, 404);
      if (/\/files\/FOLDER1\?/.test(url)) return resp({ id: 'FOLDER1', name: 'WO-1', webViewLink: 'https://drive.google.com/drive/folders/FOLDER1' });
      if (/\/files\?/.test(url)) return resp({ files });
      if (/\/copy\?/.test(url)) { log.copies.push(JSON.parse(init.body)); return resp({ id: 'NEWCOPY' }); }
      return resp({}, false, 500);
    },
    URLSearchParams,
    getAccessToken: async () => 't',
    fetchTab: async (e, t) => (t === 'Attachments' ? deps._atts : []),
    ensureColumns: async () => {},
    updateRow: async (e, t, id, f) => { log.updateRows.push({ t, id, f }); return { status: 200 }; },
    addRow: async (e, t, r) => { log.addRows.push({ t, r }); return { status: 200, clone() { return this; }, json: async () => ({ id: '9001' }) }; },
    driveShareAnyoneVerbose: async (tok, id) => { log.shares.push(id); return shareOk ? { ok: true } : { ok: false, status: 403, error: 'nope' }; },
    logTelemetry: async (e, r) => { log.tele.push(r); },
    findDriveFolder: async () => null,
    findOrCreateFolder: async () => { log.created++; return { id: 'NEWF' }; },
    updateWOFields: async () => {},
    _atts: [],
  };
  for (const n of PURE) deps[n] = P[n];
  const names = ['ensureWOCustomerFolder', 'driveGetFileMeta', 'driveFindOrCreatePropertyFolder', 'driveFindOrCreateWOFolder', 'persistWOFolderFields', 'copyReceiptIntoWOFolder'];
  const names1 = Object.keys(deps);
  const body = mimeConst + '\n' + names.map(grab).join('\n') + '\nreturn {' + names.join(',') + '};';
  const fns = new Function(...names1, body)(...names1.map(n => deps[n]));
  return { fns, log, deps };
}
const REC = { ID: '94', WO_ID: 'WO-1202', Store: 'Lowes', Date: '2026-09-04', Amount: '50.20', Source_File_ID: 'SRC', Source_File_URL: 'https://drive.google.com/file/d/SRC/view' };
const WO = { ID: 'WO-1202', Property_ID: '1', Drive_Folder_ID: 'FOLDER1', Drive_Folder_URL: 'https://drive.google.com/drive/folders/FOLDER1' };

test('copy: no existing file -> files.copy into the WO folder, shared anyone-with-link, recorded on a new Attachments row', async () => {
  const w = world();
  const r = await w.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, {});
  assert.equal(r.status, 'ok'); assert.equal(r.adopted, false);
  assert.equal(w.log.copies.length, 1); assert.deepEqual(w.log.copies[0].parents, ['FOLDER1']);
  assert.equal(w.log.copies[0].name, 'Receipt - Lowes 2026-09-04 - $50.20.jpg');
  assert.deepEqual(w.log.shares, ['NEWCOPY']);
  assert.equal(w.log.addRows.length, 1); assert.equal(w.log.addRows[0].r.Folder_Copy_ID, 'NEWCOPY'); assert.equal(w.log.addRows[0].r.Receipt_ID, '94');
});
test('adopt: a hand-made copy with the matching title is adopted - NO second copy - and still shared + recorded', async () => {
  const w = world({ files: [{ id: '1122BROPF3GHcv3fO-Uf745DzVg_qqpu4', name: 'Receipt - Lowes 2026-09-04 - $50.20.jpg', mimeType: 'image/jpeg' }] });
  const r = await w.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, {});
  assert.equal(r.status, 'ok'); assert.equal(r.adopted, true);
  assert.equal(w.log.copies.length, 0, 'must not duplicate');
  assert.deepEqual(w.log.shares, ['1122BROPF3GHcv3fO-Uf745DzVg_qqpu4']);
  assert.equal(w.log.addRows[0].r.Folder_Copy_ID, '1122BROPF3GHcv3fO-Uf745DzVg_qqpu4');
});
test('idempotent: a receipt that already has a recorded copy does nothing at all', async () => {
  const w = world(); w.deps._atts.push({ ID: '5', Receipt_ID: '94', Active: 'TRUE', Folder_Copy_ID: 'X', Folder_Copy_Folder_ID: 'FOLDER1' });
  const ctx = {}; const r = await w.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, ctx);
  assert.equal(r.already, true); assert.equal(w.log.copies.length + w.log.shares.length + w.log.addRows.length + w.log.updateRows.length, 0);
});
test('failure is returned + logged to Telemetry, never thrown (receipt add must not fail)', async () => {
  const w = world({ shareOk: false });
  const r = await w.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, {});
  assert.match(r.status, /^failed:.*share failed/); assert.equal(w.log.tele[0].Job_Type, 'receipt_folder_copy_failed'); assert.equal(w.log.addRows.length, 0, 'nothing recorded for a failed copy');
  const w2 = world({ srcMeta: null });
  assert.match((await w2.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, {})).status, /^failed:.*not found in Drive/);
  assert.match((await w.fns.copyReceiptIntoWOFolder({}, 't', REC, null, {})).status, /^failed:/);
  assert.equal((await w.fns.copyReceiptIntoWOFolder({}, 't', { ...REC, Source_File_ID: '', Source_File_URL: '' }, WO, {})).status, 'skipped:no_source_file');
});
test('dryRun (backfill preview) writes/copies/shares nothing', async () => {
  const w = world();
  const r = await w.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, { dryRun: true });
  assert.equal(r.status, 'ok'); assert.equal(r.action, 'would_copy');
  assert.equal(w.log.copies.length + w.log.shares.length + w.log.addRows.length + w.log.updateRows.length + w.log.created, 0);
  const w2 = world({ files: [{ id: 'HAND', name: 'Receipt - Lowes 2026-09-04 - $50.20.jpg' }] });
  assert.equal((await w2.fns.copyReceiptIntoWOFolder({}, 't', REC, WO, { dryRun: true })).action, 'would_adopt');
});
test('blank Drive_Folder_ID: preview never creates the folder; the real run finds-or-creates by name and persists BOTH id and url', async () => {
  const wo = { ID: 'WO-1020', Property_ID: '1' };
  const w1 = world(); const fnsBody = ['ensureWOCustomerFolder', 'driveGetFileMeta', 'driveFindOrCreatePropertyFolder', 'driveFindOrCreateWOFolder', 'persistWOFolderFields'];
  const d = { ...w1.deps, fetchTab: async () => [{ ID: '1', Address: '1 Main St' }] }; const nm = Object.keys(d);
  const writes = []; d.updateWOFields = async (e, id, f) => { writes.push({ id, f }); };
  const f = new Function(...nm, fnsBody.map(grab).join('\n') + '\nreturn {ensureWOCustomerFolder};')(...nm.map(n => d[n]));
  const prev = await f.ensureWOCustomerFolder({ DRIVE_PROPERTIES_ROOT: 'ROOT' }, 't', { ...wo }, { dryRun: true });
  assert.equal(prev.source, 'would_create'); assert.equal(writes.length, 0);
  const real = await f.ensureWOCustomerFolder({ DRIVE_PROPERTIES_ROOT: 'ROOT' }, 't', { ...wo }, {});
  assert.equal(real.id, 'NEWF'); assert.equal(writes.length, 1); assert.equal(writes[0].f.Drive_Folder_ID, 'NEWF'); assert.ok(writes[0].f.Drive_Folder_URL.includes('NEWF'));
});

// ── Re-open guard ───────────────────────────────────────────────────────────────────────────────
test('re-open: allowed when QB_Email_Sent=TRUE (carries the date); refused 409 once the WO invoice went out', () => {
  const row = { ID: '5', Status: 'confirmed', Confirmed_WO_ID: 'WO-9' };
  const rcpt = { ID: '70', WO_ID: 'WO-9', Amount: '40', QB_Email_Sent: 'TRUE', QB_Email_Sent_Date: '2026-09-30T10:00:00Z' };
  const g = P.receiptReopenGuard({ row, receipt: rcpt, wo: { ID: 'WO-9', Status: 'Open' }, irRows: [] });
  assert.equal(g.ok, true); assert.equal(g.carry_qb_sent, true); assert.match(g.prior_qb_email_date, /^2026-09-30/);
  assert.equal(P.receiptReopenGuard({ row, receipt: { ...rcpt, QB_Email_Sent: 'FALSE' }, wo: {}, irRows: [] }).carry_qb_sent, false);
  for (const wo of [{ ID: 'WO-9', QBO_Invoice_Number: '1234' }, { ID: 'WO-9', Status: 'Invoiced' }, { ID: 'WO-9', Status: 'Paid' }]) {
    const x = P.receiptReopenGuard({ row, receipt: rcpt, wo, irRows: [] }); assert.equal(x.ok, false); assert.equal(x.status, 409); assert.equal(x.invoice_sent, true);
  }
  assert.equal(P.receiptReopenGuard({ row, receipt: rcpt, wo: {}, irRows: [{ ID: '3', WO_ID: 'WO-9', QB_Invoice_ID: 'Q1', Active: 'TRUE' }] }).status, 409);
  assert.equal(P.receiptReopenGuard({ row, receipt: rcpt, wo: {}, irRows: [{ ID: '3', WO_ID: 'WO-9', QB_Invoice_ID: 'Q1', Active: 'FALSE' }] }).ok, true, 'a voided IR row does not block');
  assert.equal(P.receiptReopenGuard({ row: { ...row, Status: 'pending' }, receipt: rcpt, wo: {}, irRows: [] }).status, 409);
  assert.equal(P.receiptReopenGuard({ row, receipt: null, wo: {}, irRows: [] }).status, 404);
});
test('QB carry: re-confirm of a re-opened row is flagged already-sent; never for a refund; flags a changed amount', () => {
  const q = { Reopened_QB_Sent: 'TRUE', Prior_QB_Email_Date: '2026-09-30T10:00:00Z', Prior_QB_Amount: '40' };
  assert.equal(P.receiptQbCarryFor(q, 40).date, '2026-09-30T10:00:00Z'); assert.equal(P.receiptQbCarryFor(q, 40).amount_changed, false);
  assert.equal(P.receiptQbCarryFor(q, 55).amount_changed, true);
  assert.equal(P.receiptQbCarryFor(q, -40), null); assert.equal(P.receiptQbCarryFor({ Reopened_QB_Sent: 'FALSE' }, 40), null); assert.equal(P.receiptQbCarryFor(null, 40), null);
});

// ── candidates / invoice guard / selftest ───────────────────────────────────────────────────────
const Q = [{ Status: 'confirmed', Confirmed_Receipt_ID: '1', Source_File_ID: 'S1' }, { Status: 'pending', Confirmed_Receipt_ID: '3', Source_File_ID: 'S3' }];
const RC = [{ ID: '1', WO_ID: 'WO-1', Source_File_ID: 'S1', Active: 'TRUE' }, { ID: '2', WO_ID: 'WO-1', Source_File_ID: 'S2', Active: 'TRUE' }, { ID: '3', WO_ID: 'WO-1', Source_File_ID: 'S3', Active: 'TRUE' }, { ID: '4', WO_ID: 'WO-1', Source_File_ID: 'S1', Active: 'FALSE' }, { ID: '5', WO_ID: '', Source_File_ID: 'S1', Active: 'TRUE' }];
test('candidates: only active, on a WO, with an image, confirmed through the Reconciler (vendor-added receipts excluded -> they stay private)', () => {
  assert.deepEqual(P.receiptFolderCopyCandidates(RC, Q).map(r => r.ID), ['1']);
});
test('invoice guard: warns on missing copy / no folder / other-WO receipts; silent when all present; ignores vendor receipts', () => {
  const wo = { ID: 'WO-1', Drive_Folder_URL: 'https://drive.google.com/drive/folders/F' };
  const own = [RC[0]];
  const bad = P.invoiceReceiptFolderIssue(own, [], wo, 'WO-1', Q); assert.deepEqual(bad.missing_ids, ['1']); assert.match(bad.message, /no copy in the customer folder/);
  assert.equal(P.invoiceReceiptFolderIssue(own, [{ Receipt_ID: '1', Active: 'TRUE', Folder_Copy_ID: 'X' }], wo, 'WO-1', Q), null);
  assert.equal(P.invoiceReceiptFolderIssue(own, [{ Receipt_ID: '1', Active: 'TRUE', Folder_Copy_ID: 'X' }], { ID: 'WO-1' }, 'WO-1', Q).no_folder, true);
  assert.deepEqual(P.invoiceReceiptFolderIssue(own, [{ Receipt_ID: '1', Active: 'TRUE', Folder_Copy_ID: 'X' }], wo, 'WO-2', Q).off_folder_ids, ['1']);
  assert.equal(P.invoiceReceiptFolderIssue([RC[1]], [], { ID: 'WO-1' }, 'WO-1', Q), null, 'vendor/non-Reconciler receipt: nothing expected');
});
test('selftest check counts confirmed receipts with a WO whose folder copy is missing', () => {
  const r = P.selftestCheckReceiptFolderCopies(RC, [], Q, [{ ID: 'WO-1' }]); assert.equal(r.ok, false); assert.equal(r.missing_count, 1); assert.match(r.reason, /backfill-receipt-folder-copies/);
  assert.equal(P.selftestCheckReceiptFolderCopies(RC, [{ Receipt_ID: '1', Active: 'TRUE', Folder_Copy_ID: 'X' }], Q, [{ ID: 'WO-1' }]).ok, true);
  assert.match(src, /selftestCheckReceiptFolderCopies\(/); assert.match(src, /name: 'receipt_folder_copies'|'receipt_folder_copies'/);
});

// ── wiring / auth boundary (static) ─────────────────────────────────────────────────────────────
test('routes: reopen is admin-only and test-writable but NOT prod-writable; backfill prod-writable (idempotent/additive), apply never test-writable', () => {
  assert.match(src, /if \(path === '\/receipt-recon\/reopen'\)\s+return await receiptReconReopen\(env, body\);/);
  assert.match(src, /if \(path === '\/admin\/backfill-receipt-folder-copies'\) return await backfillReceiptFolderCopies\(env, body\);/);
  const prod = /const HUB_PROD_WRITE_PATHS = \[([^\]]*)\]/.exec(src)[1];
  assert.ok(prod.includes("'/admin/backfill-receipt-folder-copies'")); assert.ok(!prod.includes('/receipt-recon/reopen'), 'reopen must not be prod-writable (money-adjacent)');
  assert.ok(!/ROLE_SCOPES[^;]*receipt-recon\/reopen/s.test(src.slice(src.indexOf('ROLE_SCOPES'), src.indexOf('ROLE_SCOPES') + 6000)), 'reopen has no ROLE_SCOPES entry (admin only)');
  assert.ok(!/PUBLIC_PATHS[^\n]*(receipt-recon\/reopen|backfill-receipt-folder-copies)/.test(src));
  const gate = src.slice(src.indexOf('async function hubTestWriteAllowed'));
  assert.match(gate, /path === '\/admin\/backfill-receipt-folder-copies'\) return !\(body && body\.apply === true\)/);
  assert.match(gate, /path === '\/receipt-recon\/reopen'/);
  assert.match(gate.slice(0, gate.indexOf('\n}\n')), /return false;\s*$/);
});
test('wiring: reopen voids Receipts + invoice line + attachment; reassign now voids the old attachment; /receipt/add can never switch the shared copy on', () => {
  const ro = grab('receiptReconReopen');
  for (const s of ['removeReceiptFromInvoiceReview', 'voidAttachmentForReceipt', 'receiptReopenGuard', 'Reopened_QB_Sent', 'Prior_QB_Email_Date', "Status: 'pending'", 'Notes: note']) assert.ok(ro.includes(s), s);
  assert.ok(!/sendReceiptsToQBEmail|gmailSend|sms/i.test(ro), 'reopen sends nothing');
  assert.match(grab('receiptReconReassign'), /voidAttachmentForReceipt\(env,/);
  assert.match(grab('voidAttachmentForReceipt'), /trashReceiptFolderCopy/);
  assert.ok(!/folderCopy/.test(src.slice(src.indexOf("path === '/receipt/add'"), src.indexOf("path === '/receipt/add'") + 400)), '/receipt/add passes no folderCopy opts');
  for (const f of ['receiptReconConfirm', 'receiptAttachOnly', 'receiptReconRefundReverse']) assert.match(grab(f), /folderCopy: true/, f);
  const bf = grab('backfillReceiptFolderCopies'); assert.match(bf, /apply === true/); assert.match(bf, /Math\.min\(8/); assert.match(bf, /remaining/); assert.match(bf, /dryRun: !apply/);
  assert.ok(!/sendReceiptsToQBEmail|gmailSend|\bsms\b|qbo/i.test(bf), 'backfill: no QB/SMS/email');
  const hp = grab('handlePhotoUploadClean'); assert.match(hp, /driveFindOrCreatePropertyFolder/); assert.match(hp, /driveFindOrCreateWOFolder/);
});
test('invoice send: preview warns, real send is a 409 unless override_receipt_folder (single + combined)', () => {
  const q = grab('qbSendInvoice');
  assert.match(q, /rfIssue/); assert.match(q, /receipt_folder_missing: true/); assert.match(q, /!body\.override_receipt_folder/);
  assert.match(q, /overrideReceiptFolder: !!body\.override_receipt_folder/);
  const c = grab('qbSendCombinedInvoice'); assert.match(c, /!ctx\.overrideReceiptFolder/); assert.match(c, /receipt_folder_missing: true/);
});

// ── UI (static; the headless pass is test/manual-verify-receipt-reopen-ui.mjs) ──────────────────
test('receipt-reconciler.html: Re-open button + confirm dialog + sticky folder-copy failure banner', () => {
  assert.ok(rr.includes('↩ Re-open (already sent to QB)')); assert.match(rr, /post\('\/receipt-recon\/reopen'/);
  const fn = /async function reopenConfirmation[\s\S]*?\n}\n/.exec(rr)[0];
  assert.match(fn, /confirm\(/); assert.match(fn, /already emailed to QuickBooks/); assert.match(fn, /NOT be sent it again/);
  assert.match(rr, /data\.folder_copy !== 'ok'\) showFolderCopyWarning/); assert.match(rr, /customer work-order folder FAILED/);
});
test('index.html: receipt_folder_missing shows a Send anyway that resends override_receipt_folder', () => {
  assert.match(idx, /res\.receipt_folder_missing && !overrideReceiptFolder/); assert.match(idx, /payload\.override_receipt_folder = true/);
  assert.match(idx, /Send anyway \(receipts not in folder\)/);
});
