// Offline test for the Receipt Reconciler intake-time rescan guard (Part 0, Sep 22 2026 incident:
// a $56.04 Home Depot receipt Brett had already processed reappeared as a fresh Pending row with
// no indication it had already been handled).
// Run: node test/receipt-recon-rescan-guard.test.mjs
// Extracts the REAL pure functions and receiptReconScan from worker.js so this can't drift from
// what ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

function extractFn(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
function extractSync(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}

// ── Pure-function tests (no I/O) ──────────────────────────────────────────────────────────────────────
const pure = new Function(`
  ${extractSync('_rcNorm')}
  ${extractSync('receiptReconGmailIdFromDescription')}
  ${extractSync('receiptReconEntrySource')}
  ${extractSync('receiptReconFindRescanMatches')}
  return { _rcNorm, receiptReconGmailIdFromDescription, receiptReconEntrySource, receiptReconFindRescanMatches };
`)();
const { receiptReconGmailIdFromDescription, receiptReconEntrySource, receiptReconFindRescanMatches } = pure;

{
  const desc = 'From email → Hub. Mailbox: brett@bmoremanagement.com | From: HomeDepot@order.homedepot.com | Subject: Electronic Receipt | https://mail.google.com/mail/u/?authuser=brett%40bmoremanagement.com#all/19abc123def456';
  ok(receiptReconGmailIdFromDescription(desc) === '19abc123def456', 'extracts the Gmail message id already embedded by ReceiptMailToHub.gs (no Apps Script change needed)');
  ok(receiptReconGmailIdFromDescription('') === '', 'no description (manual Drive drop) -> empty id');
  ok(receiptReconGmailIdFromDescription('some random Drive description') === '', 'unrelated description -> empty id');
}
{
  const desc = 'From email → Hub. Mailbox: brett@bmoremanagement.com | From: x | Subject: y | https://mail.google.com/...#all/abc';
  ok(receiptReconEntrySource(desc) === 'email_scan', 'ReceiptMailToHub.gs description -> email_scan');
  ok(receiptReconEntrySource('') === 'manual_drop', 'no description -> manual_drop (Brett dropped it in Drive by hand)');
  ok(receiptReconEntrySource('scanned by Brett at the office') === 'manual_drop', 'unrelated description -> manual_drop');
}
{
  // The actual Sep 22 8:05pm incident: a $56.04 Home Depot receipt already in Receipts (confirmed)
  // resurfaces as a new candidate via a different Drive file.
  const receipts = [{ ID: 'R1', Active: 'TRUE', Amount: '56.04', Date: '2026-09-20', Store: 'Home Depot', WO_ID: '4021' }];
  const candidate = { total: 56.04, store: 'Home Depot', date: '2026-09-20', gmailMessageId: '' };
  const matches = receiptReconFindRescanMatches(candidate, receipts, []);
  ok(matches.length === 1 && matches[0].type === 'receipts', 'flags a re-scan against an already-confirmed Receipts row (the real Sep 22 incident)');
  ok(/already-processed receipt from 2026-09-20/.test(matches[0].reason) && /WO 4021/.test(matches[0].reason), 'reason names the date and WO so Brett can cross-check at a glance');
}
{
  // Store normalization: "Home Depot" vs "HOME DEPOT #1234" style OCR noise should still match on
  // the normalized core tokens the way _rcNorm/receiptDuplicatesAtProperty already does elsewhere.
  const receipts = [{ ID: 'R2', Active: 'TRUE', Amount: '19.99', Date: '2026-09-10', Store: 'HOME DEPOT' }];
  const candidate = { total: 19.99, store: 'Home Depot', date: '2026-09-10', gmailMessageId: '' };
  ok(receiptReconFindRescanMatches(candidate, receipts, []).length === 1, 'store match is case/spacing-insensitive');
}
{
  // Negative: different amount, different date, or different store must NOT flag — a false
  // positive would make Brett distrust the flag and could hide a real second purchase.
  const receipts = [{ ID: 'R3', Active: 'TRUE', Amount: '56.04', Date: '2026-09-20', Store: 'Home Depot' }];
  ok(receiptReconFindRescanMatches({ total: 56.05, store: 'Home Depot', date: '2026-09-20' }, receipts, []).length === 0, 'one cent off -> no false match');
  ok(receiptReconFindRescanMatches({ total: 56.04, store: 'Home Depot', date: '2026-09-21' }, receipts, []).length === 0, 'different date -> no false match');
  ok(receiptReconFindRescanMatches({ total: 56.04, store: 'Lowes', date: '2026-09-20' }, receipts, []).length === 0, 'different store -> no false match (a real second purchase must never be hidden)');
}
{
  // Inactive (soft-deleted) Receipts rows must never flag a re-scan.
  const receipts = [{ ID: 'R4', Active: 'FALSE', Amount: '10.00', Date: '2026-09-10', Store: 'Amazon' }];
  ok(receiptReconFindRescanMatches({ total: 10.00, store: 'Amazon', date: '2026-09-10' }, receipts, []).length === 0, 'Active=FALSE Receipts row is ignored');
}
{
  // Queue-side: a row Brett already Skipped or confirmed-as-duplicate must flag a re-add; a row
  // still sitting Pending must NOT (that's not "already dispositioned" — it's just another
  // candidate waiting on the same decision, not evidence of a prior one).
  const queue = [
    { ID: 'Q1', Active: 'TRUE', Status: 'skipped', Total: '56.04', Receipt_Date: '2026-09-20', Vendor: 'Home Depot' },
    { ID: 'Q2', Active: 'TRUE', Status: 'pending', Total: '56.04', Receipt_Date: '2026-09-20', Vendor: 'Home Depot' },
  ];
  const m1 = receiptReconFindRescanMatches({ total: 56.04, store: 'Home Depot', date: '2026-09-20' }, [], queue);
  ok(m1.length === 1 && m1[0].type === 'queue_dispositioned' && m1[0].queue_id === 'Q1', 'flags against a dispositioned (skipped) queue row, ignores the still-pending one');
}
{
  const queue = [{ ID: 'Q3', Active: 'TRUE', Status: 'duplicate_confirmed', Total: '12.50', Receipt_Date: '2026-08-01', Vendor: 'Lowes' }];
  const m = receiptReconFindRescanMatches({ total: 12.50, store: 'Lowes', date: '2026-08-01' }, [], queue);
  ok(m.length === 1 && /duplicate confirmed/.test(m[0].reason), 'flags against a duplicate_confirmed queue row with a readable status in the reason');
}
{
  // Layer 1 (cheapest/highest confidence): exact re-add of the same source email via its Gmail
  // message id, already embedded in the Drive file description by ReceiptMailToHub.gs.
  const queue = [{ ID: 'Q4', Active: 'TRUE', Status: 'confirmed', Gmail_Message_ID: '19abc', Received_Date: '2026-09-15T12:00:00.000Z', Total: '5.00', Receipt_Date: '2026-01-01', Vendor: 'Nowhere' }];
  const m = receiptReconFindRescanMatches({ total: 999, store: 'Somewhere else entirely', date: '2020-01-01', gmailMessageId: '19abc' }, [], queue);
  ok(m.length === 1 && m[0].type === 'gmail_exact' && m[0].queue_id === 'Q4', 'Gmail-message-id hard match fires even when amount/store/date look nothing alike (same source email)');
}
{
  // No gmail id on the candidate -> no gmail_exact matches attempted at all.
  const queue = [{ ID: 'Q5', Active: 'TRUE', Status: 'confirmed', Gmail_Message_ID: '', Total: '5.00', Receipt_Date: '2026-01-01', Vendor: 'Nowhere' }];
  ok(receiptReconFindRescanMatches({ total: 1, store: 'x', date: '2020-01-01', gmailMessageId: '' }, [], queue).length === 0, 'blank Gmail id on both sides never matches');
}
{
  // Missing store/date/amount must never crash or false-positive.
  ok(receiptReconFindRescanMatches({ total: 0, store: '', date: '' }, [{ ID: 'R', Active: 'TRUE', Amount: '0', Date: '', Store: '' }], []).length === 0, 'blank candidate fields never flag (never a false positive on empty data)');
}
console.log(`  (pure) ${pass} passed, ${fail} failed so far`);

// ── End-to-end: the real receiptReconScan, run against a fake world ────────────────────────────────
function world({ receipts = [], queueRows = [], files = [], extract = () => ({ vendor: 'Home Depot', total: 56.04, date: '2026-09-20', items: [] }) }) {
  const added = [];
  const deps = {
    fetchConfig: async () => ({}),
    getAccessToken: async () => 'tok',
    ensureTab: async () => {}, ensureColumns: async () => {},
    fetch: async () => ({ json: async () => ({ files }) }),
    fetchTab: async () => queueRows.slice(),
    receiptCustomerCards: async () => ({}),
    fetchTabs: async () => [[], [], receipts],
    driveDownload: async () => ({ bytes: new ArrayBuffer(1), mime: 'application/pdf' }),
    receiptExtract: async () => extract(),
    receiptSuggestCore: () => ({ verdict: 'review' }),
    addRow: async (env, tab, row) => { added.push(row); },
    setConfigKey: async () => {},
    json: (o) => o,
  };
  const helperNames = ['receiptReconCutoff', 'receiptBeforeCutoff', 'receiptCutoffNote', '_rcNorm', 'receiptReconGmailIdFromDescription', 'receiptReconEntrySource', 'receiptReconFindRescanMatches'];
  const helperSrc = helperNames.map(n => extractSync(n)).join('\n');
  const helpers = new Function(`const RECEIPT_RECON_MIN_DATE_DEFAULT = '2026-07-01'; ${helperSrc}; return { ${helperNames.join(', ')} };`)();
  Object.assign(deps, helpers);
  deps.RECEIPT_RECON_QUEUE_HEADERS = [];
  deps.RECEIPT_RECON_FOLDER_ID_DEFAULT = 'FOLDER';
  const names = Object.keys(deps);
  const fn = new Function(...names, `return (${extractFn('receiptReconScan')});`)(...names.map(n => deps[n]));
  return { scan: (b) => fn({}, b), added };
}

{
  // The real Sep 22 incident, reproduced end to end: a $56.04 Home Depot receipt already
  // confirmed into Receipts comes back through the folder scan as a brand-new Drive file.
  const receipts = [{ ID: 'R100', Active: 'TRUE', Amount: '56.04', Date: '2026-09-20', Store: 'Home Depot', WO_ID: '4021' }];
  const files = [{ id: 'newfile1', name: 'HomeDepot_rescan.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive/newfile1' }];
  const w = world({ receipts, files });
  const r = await w.scan({});
  ok(r.scanned === 1 && r.flagged_rescan === 1, 'the resurfaced $56.04 HD receipt is scanned AND flagged (got scanned=' + r.scanned + ' flagged_rescan=' + r.flagged_rescan + ')');
  ok(w.added[0].Status === 'pending', 'CRITICAL: still lands as Pending, never auto-skipped — a false match must never hide a real second purchase');
  ok(/Possible re-scan/.test(w.added[0].Notes), 'Notes carries the plain-language warning so it is visible even off the dedicated UI');
  const rescan = JSON.parse(w.added[0].Rescan_Match_JSON);
  ok(rescan.length === 1 && rescan[0].type === 'receipts' && rescan[0].receipt_id === 'R100', 'Rescan_Match_JSON references the exact matched Receipts row for the UI link/reference');
}
{
  // A genuinely new receipt (different amount) must NOT be flagged.
  const receipts = [{ ID: 'R101', Active: 'TRUE', Amount: '56.04', Date: '2026-09-20', Store: 'Home Depot' }];
  const files = [{ id: 'newfile2', name: 'HomeDepot_new.pdf', mimeType: 'application/pdf', webViewLink: '' }];
  const w = world({ receipts, files, extract: () => ({ vendor: 'Home Depot', total: 12.99, date: '2026-09-20', items: [] }) });
  const r = await w.scan({});
  ok(r.flagged_rescan === 0 && w.added[0].Rescan_Match_JSON === '[]', 'a different amount at the same store/date is never flagged as a re-scan');
  ok(w.added[0].Notes === '', 'no warning text when nothing matched');
}
{
  // Entry_Source / Gmail_Message_ID are populated from the Drive file description (Apps Script
  // metadata that already exists today — no ReceiptMailToHub.gs redeploy needed).
  const files = [{ id: 'newfile3', name: 'HomeDepot_email.pdf', mimeType: 'application/pdf', webViewLink: '',
    description: 'From email → Hub. Mailbox: brett@bmoremanagement.com | From: HomeDepot@order.homedepot.com | Subject: Electronic Receipt | https://mail.google.com/mail/u/?authuser=brett%40bmoremanagement.com#all/19xyz789' }];
  const w = world({ files, extract: () => ({ vendor: 'Ace Hardware', total: 8.50, date: '2026-09-19', items: [] }) });
  await w.scan({});
  ok(w.added[0].Entry_Source === 'email_scan', 'Entry_Source recorded from the email pipeline description');
  ok(w.added[0].Gmail_Message_ID === '19xyz789', 'Gmail_Message_ID captured for future hard-block matching');
}
{
  // Manual Drive drop (no description) -> manual_drop, no Gmail id, and (of course) still works.
  const files = [{ id: 'newfile4', name: 'scan.pdf', mimeType: 'application/pdf', webViewLink: '' }];
  const w = world({ files, extract: () => ({ vendor: 'Lowes', total: 22.00, date: '2026-09-19', items: [] }) });
  await w.scan({});
  ok(w.added[0].Entry_Source === 'manual_drop' && w.added[0].Gmail_Message_ID === '', 'a manually-dropped scan is labeled manual_drop with no Gmail id');
}
{
  // Layer 1 end-to-end: the exact same source email re-added (different Drive file, same Gmail
  // message id) against a queue row Brett already confirmed.
  const queueRows = [{ ID: 'Q200', Active: 'TRUE', Status: 'confirmed', Gmail_Message_ID: '19same', Received_Date: '2026-09-18T10:00:00.000Z', Total: '1', Receipt_Date: '2026-01-01', Vendor: 'X' }];
  const files = [{ id: 'newfile5', name: 'reforward.pdf', mimeType: 'application/pdf', webViewLink: '',
    description: 'From email → Hub. Mailbox: brett@bmoremanagement.com | From: y | Subject: z | https://mail.google.com/mail/u/?authuser=x#all/19same' }];
  const w = world({ queueRows, files, extract: () => ({ vendor: 'Totally Different Store', total: 999.99, date: '2026-01-05', items: [] }) });
  const r = await w.scan({});
  ok(r.flagged_rescan === 1, 'exact same source email (Gmail id match) is flagged even though store/amount/date look unrelated');
  const rescan = JSON.parse(w.added[0].Rescan_Match_JSON);
  ok(rescan[0].type === 'gmail_exact' && rescan[0].queue_id === 'Q200', 'flagged as gmail_exact against the already-confirmed queue row');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
