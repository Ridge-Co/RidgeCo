// Phase 7c (read fallbacks) of the silent-failure burn-down (Nov 18 2026): tab reads that fall back to an empty list now report when they fail,
// and a corrupt PROPOSAL_CONFIG secret is reported. Fallback values are unchanged. Source checks plus runs of the real helpers.
// Run: node test/read-fallbacks-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);

console.log('Backfills and checks report an unreadable tab');
has(/softFail\(env, 'backfillScopeWOVendor:Scopes', e, \{ severity: 'P2', source: 'read' \}\)\.then\(\(\) => \[\]\)/, 'scope vendor backfill: Scopes read reported P2, still []');
has(/softFail\(env, 'backfillScopeWOVendor:Work_Orders', e, \{ severity: 'P2'/, 'scope vendor backfill: Work_Orders read reported P2');
has(/softFail\(env, 'backfillReceiptAttachments:Receipts', e, \{ severity: 'P2'/, 'receipt gallery backfill: Receipts read reported P2');
has(/softFail\(env, 'backfillReceiptAttachments:Attachments', e, \{ severity: 'P1'[^\n]*duplicate gallery rows[^\n]*\.then\(\(\) => \[\]\)/, 'receipt gallery backfill: an unreadable Attachments tab is P1 (a rerun could add duplicates), still []');
has(/softFail\(env, 'receiptsImageCheck:Receipts', e, \{ severity: 'P2'/, 'image check: Receipts read reported P2');
has(/softFail\(env, 'receiptsImageCheck:Receipt_Recon_Queue', e, \{ severity: 'P2'/, 'image check: Receipt_Recon_Queue read reported P2');
has(/softFail\(env, 'arReportSetOptIn:AR_Report_OptIn', e, \{ severity: 'P1', source: 'read', ref: ownerId[^\n]*\.then\(\(\) => \[\]\)/, 'AR opt-in: an unreadable opt-in tab is P1 (a second row could be added), still []');

console.log('fetchConfig fallbacks say why they are spare');
const cfgLines = src.split('\n').filter(l => /fetchConfig\(env\)\.catch\(\(\) => \(\{\}\)\);/.test(l));
ok(cfgLines.length === 3 && cfgLines.every(l => /silent-ok: fetchConfig never throws/.test(l)), 'all 3 spare fetchConfig catches carry a silent-ok reason (' + cfgLines.length + ')');
has(/async function fetchConfig\(env\) \{\n  try \{/, 'fetchConfig itself still swallows its own errors, so the spare catch cannot fire');

console.log('Runs of the real helpers');
const grab = (kw, name) => { const i = src.indexOf(kw + ' ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const seen = [], notes = [];
const softFail = async (env, where, e, o) => { seen.push(where + '|' + o.severity + '|' + (o.ref || '')); return { ok: false }; };
const softNote = (env, where, msg, o) => { notes.push(where + '|' + o.severity + '|' + msg); };
let rows = [{ ID: 'R1', Active: 'TRUE' }, { ID: 'R2', Active: 'FALSE' }, { ID: 'R3' }];
let boom = false;
const fetchTab = async () => { if (boom) throw new Error('sheet down'); return rows; };
const code = [grab('async function', 'qbApprovedReceipts'), grab('async function', 'scopeProposalPhotos'), grab('function', 'proposalRegistry')].join('\n');
const f = new Function('fetchTab', 'softFail', 'softNote', 'SCOPE_PROPOSAL_PHOTO_TYPES', code + '\nreturn { qbApprovedReceipts, scopeProposalPhotos, proposalRegistry };')(fetchTab, softFail, softNote, ['before', 'photo', 'other']);
const env = {};
const run = async () => {
  const good = await f.qbApprovedReceipts(env, { ID: 'IR-1', Own_Material_IDs: 'R1,R2,R3' });
  ok(good.length === 2 && seen.length === 0, 'approved receipts, good read: the active ones, nothing reported');
  ok((await f.qbApprovedReceipts(env, { ID: 'IR-1', Own_Material_IDs: '' })).length === 0 && seen.length === 0, 'approved receipts, no ids: [] without a read or a report');
  boom = true;
  const bad = await f.qbApprovedReceipts(env, { ID: 'IR-9', Own_Material_IDs: 'R1' });
  ok(bad.length === 0 && seen.length === 1 && seen[0] === 'qbApprovedReceipts:Receipts|P1|IR-9', 'approved receipts, failed read: still [] and reported once at P1 with the invoice id');
  const ph = await f.scopeProposalPhotos(env, { ID: 'S-4', WO_ID: '' });
  ok(Array.isArray(ph) && ph.length === 0 && seen.length === 2 && seen[1] === 'scopeProposalPhotos:Attachments|P2|S-4', 'proposal photos, failed read: still [] and reported at P2 with the scope id');
  boom = false;
  rows = [{ WO_ID: 'W1', Active: 'TRUE', File_Type: 'photo', Mime_Type: 'image/jpeg', Drive_File_ID: 'F1', File_Name: 'a.jpg' }, { WO_ID: 'W1', File_Type: 'receipt', Drive_File_ID: 'F2' }];
  const ph2 = await f.scopeProposalPhotos(env, { ID: 'S-5', WO_ID: 'W1' });
  ok(ph2.length === 1 && ph2[0].fileId === 'F1' && seen.length === 2, 'proposal photos, good read: only the photo, nothing new reported');
  ok(JSON.stringify(f.proposalRegistry({ PROPOSAL_CONFIG: '{"A":{"wo":"1"}}' })) === '{"A":{"wo":"1"}}' && notes.length === 0, 'proposal registry, good secret: parsed, nothing reported');
  ok(JSON.stringify(f.proposalRegistry({})) === '{}' && JSON.stringify(f.proposalRegistry(undefined)) === '{}' && notes.length === 0, 'proposal registry, unset secret: {} and nothing reported (the feature is dormant on purpose)');
  ok(JSON.stringify(f.proposalRegistry({ PROPOSAL_CONFIG: '{oops' })) === '{}' && notes.length === 1 && /^proposalRegistry:PROPOSAL_CONFIG\|P1\|/.test(notes[0]), 'proposal registry, corrupt secret: still {} but reported at P1');
  f.proposalRegistry({ PROPOSAL_CONFIG: '{oops' });
  ok(notes.length === 1, 'proposal registry: the same corrupt secret is reported once per isolate, not on every call');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
};
run();
