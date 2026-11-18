// Phase 3c of the silent-failure burn-down (Nov 17 2026): proposal signing, signed list, QuickBooks id links, receipt duplicate checks.
// Source checks: every failure site that used to swallow now reports (or carries a reasoned silent-ok), and a saved record is never failed.
// Run: node test/money-proposals-qb-link-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);
const sev = (where, s) => new RegExp("softFail\\(env, '" + where + "', e, \\{[^}]*severity: '" + s + "'");
const soft = (where, s) => new RegExp("fetchTabSoft\\(env, '[A-Za-z_]+', \\{ where: '" + where + "', severity: '" + s + "'");

console.log('Proposal signing');
has(sev('scopeProposalSign:items', 'P1'), 'unreadable proposal items reported P1');
has(sev('scopeProposalSign:sigAnswer', 'P1'), 'unreadable signature answer reported P1');
has(sev('scopeProposalSign:milestoneAnswer', 'P1'), 'unreadable milestone answer reported P1');
has(sev('scopeProposalSign:texts', 'P0'), 'a failed signed-proposal text reported P0 (the signature stays saved)');
has(/where: 'scopeParsePaymentSchedule'[^}]*severity: 'P1'/, 'an unreadable payment schedule reported P1 before the default split is used');
ok(!/scopeParsePaymentSchedule\(s\)/.test(src), 'no caller leaves out env, so the report can always be sent');

console.log('Signed proposals list');
has(soft('scopeProposalSignedList:Scopes', 'P1'), 'Scopes read failure reported P1');
has(soft('scopeProposalSignedList:Properties', 'P2'), 'Properties read failure reported');
has(sev('scopeProposalSignedList:milestones', 'P1'), 'milestones read failure reported P1 (page would show the old layout)');
has(sev('scopeProposalSignedList:receipts', 'P2'), 'receipts read failure reported');

console.log('Bills, sweeps and intake');
has(sev('moveVendorBillToNewWO:attachment', 'P1'), 'a photo that fails to move is reported');
has(sev('processDepositPaidSweep:milestonesTab', 'P1'), 'sweep: milestones tab failure reported P1');
has(sev('receiptIntake:newId', 'P1'), 'receiptIntake: unreadable new id reported P1');
has(sev('findRecentDuplicate', 'P1'), 'findRecentDuplicate: a fail-open duplicate guard is reported P1');

console.log('QuickBooks id links');
has(sev('qbLookupExisting:query', 'P1'), 'qbLookupExisting: failed lookup that leads to a create is reported P1');
has(sev('qbFindOrCreateCustomer:linkCreated', 'P1'), 'created QuickBooks customer not linked to its owner is reported P1');
has(sev('qbFindOrCreateCustomer:linkFound', 'P1'), 'found QuickBooks customer not linked is reported P1');
has(sev('qbFindOrCreateVendor:linkCreated', 'P1'), 'created QuickBooks vendor not linked is reported P1');
has(sev('qbFindOrCreateVendor:linkFound', 'P1'), 'found QuickBooks vendor not linked is reported P1');

console.log('Receipt duplicate checks');
has(sev('receiptCheckDuplicatesOne:receipts', 'P1'), 'a Receipts read failure in the duplicate check is reported P1');
has(sev('qbInvoiceLineDuplicates:openInvoice', 'P2'), 'an invoice that cannot be opened is reported');
has(sev('receiptDuplicateAuditBuildIndex:openInvoice', 'P2'), 'index build: an invoice that cannot be opened is reported');
has(soft('receiptDuplicateAuditFlags:Receipts', 'P2'), 'audit flags: Receipts read failure reported');
has(/where: 'listReceiptReconQueue:Suggestion'/, 'queue list: a corrupt Suggestion cell is reported');
has(/where: 'receiptDuplicateAuditFlags:matches'/, 'audit flags: a corrupt Matches cell is reported');

console.log('Exemptions are reasoned');
const exempt = (src.match(/silent-ok: [^*\n]+/g) || []).filter(s => s.replace('silent-ok:', '').trim().split(/\s+/).length < 3);
ok(exempt.length === 0, 'every silent-ok has a 3+ word reason');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
