// Phase 3b of the silent-failure burn-down (Nov 17 2026): QuickBooks send family + receipt reconciler.
// Source checks: every failure site that used to swallow now reports (or carries a reasoned silent-ok), and the saved record is never failed.
// Run: node test/money-receipts-qb-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);
const sev = (where, s) => new RegExp("softFail\\(env, '" + where + "', e, \\{[^}]*severity: '" + s + "'");

console.log('QuickBooks send family');
has(sev('qbUndoSend:loanReverse', 'P1'), 'qbUndoSend: a failed loan-ledger reversal is reported P1');
has(/Unable to parse range\|not found\|does not exist/, 'qbUndoSend: a genuinely missing ledger tab is not reported');
has(sev('qbUndoSend:audit', 'P2'), 'qbUndoSend: audit row failure reported P2');
has(sev('qbRepairInvoice:sharePhotos', 'P2'), 'qbRepairInvoice: photo share failure reported');
has(sev('qbRepairInvoice:clearFlag', 'P2'), 'qbRepairInvoice: a flag that fails to clear is reported');
has(sev('qbSendStandaloneInvoice:receipts', 'P1'), 'qbSendStandaloneInvoice: receipt read failure reported P1');
has(sev('qbSendInvoice:receipts', 'P1'), 'qbSendInvoice: receipt read failure reported P1');
has(sev('qbSendInvoice:sendTo', 'P1'), 'qbSendInvoice: recipient lookup failure reported P1');
has(sev('qbSendInvoice:markInvoiced', 'P1'), 'qbSendInvoice: a job that fails to mark invoiced is reported P1');
has(sev('qbSendInvoice:dupNumberCheck', 'P2'), 'qbSendInvoice: duplicate-number check failure reported');
has(sev('qbSendCombinedInvoice:sendTo', 'P1'), 'qbSendCombinedInvoice: recipient lookup failure reported P1');
has(sev('qbSendCombinedInvoice:markInvoiced', 'P1'), 'qbSendCombinedInvoice: a job that fails to mark invoiced is reported P1');
has(sev('qbSendCombinedInvoice:dupNumberCheck', 'P2'), 'qbSendCombinedInvoice: duplicate-number check failure reported');

console.log('Receipt reconciler');
has(sev('addReceipt:newId', 'P1'), 'addReceipt: unreadable new id is reported P1');
has(sev('addReceipt:galleryWrite', 'P2'), 'addReceipt: gallery write failure reported (receipt still saved)');
has(sev('receiptReconScan:queueRead', 'P1'), 'receiptReconScan: unreadable queue is reported P1');
has(/receiptReconScan:queueRead[\s\S]{0,500}return json\(\{ ok: false/, 'receiptReconScan: stops rather than re-adding every file as new');
has(/softFail\(env, 'receiptReconScan:config'/, 'receiptReconScan: settings read failure reported');
has(sev('receiptReconConfirm:addAnswer', 'P1'), 'receiptReconConfirm: unreadable add answer reported P1');
has(sev('receiptReconRefundReverse:addAnswer', 'P1'), 'receiptReconRefundReverse: unreadable add answer reported P1');
has(sev('receiptReconReassign:addAnswer', 'P1'), 'receiptReconReassign: unreadable add answer reported P1');
has(sev('receiptReconSearch:properties', 'P2'), 'receiptReconSearch: properties read failure reported');
has(sev('receiptReconSearch:workorders', 'P2'), 'receiptReconSearch: work orders read failure reported');
has(sev('editVendorBillReceipts:orphanReview', 'P2'), 'editVendorBillReceipts: review row left active is reported');
has(sev('approveInvoiceReview:dupCheck', 'P1'), 'approveInvoiceReview: unreadable duplicate check reported P1');
has(sev('approveInvoiceReview:newId', 'P1'), 'approveInvoiceReview: unreadable new id reported P1');
has(/softFail\(env, 'sendReceiptsToQB:config'/, 'sendReceiptsToQB: settings failure reported');
has(sev('sendReceiptsToQB:attachment', 'P1'), 'sendReceiptsToQB: receipt forwarded without image is reported P1');
has(/fetchTabSoft\(env, 'Properties', \{ where: 'sendReceiptsToQB:Properties'/, 'sendReceiptsToQB: property read uses the reporting reader');

console.log('Exemptions are reasoned');
const exempt = (src.match(/silent-ok: [^*\n]+/g) || []).filter(s => s.replace('silent-ok:', '').trim().split(/\s+/).length < 3);
ok(exempt.length === 0, 'every silent-ok has a 3+ word reason');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
