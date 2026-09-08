// scopeProposalPhotos() — the customer-safe photo subset served on the shareable scope proposal
// link (rule 149). Extracts the REAL function (+ its SCOPE_PROPOSAL_PHOTO_TYPES const) out of
// worker.js and runs it against a fake fetchTab, same pattern as test/dupe-guard.test.mjs — no
// network, no Sheets, cannot quietly drift from what ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL: ' + msg); } assert.ok(cond, msg); }

function extractFn(name) {
  const start = workerSrc.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in worker.js — did it get renamed?`);
  let i = workerSrc.indexOf('{', start), depth = 0;
  for (; i < workerSrc.length; i++) {
    if (workerSrc[i] === '{') depth++;
    else if (workerSrc[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return workerSrc.slice(start, i);
}
function extractConst(name) {
  const start = workerSrc.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`${name} not found in worker.js`);
  const end = workerSrc.indexOf(';', start);
  return workerSrc.slice(start, end + 1);
}

let TABS = {};
const fetchTab = async (env, tab) => { if (TABS[tab] === undefined) throw new Error(`no fake table for ${tab}`); return TABS[tab]; };
const scopeProposalPhotos = new Function('fetchTab', `${extractConst('SCOPE_PROPOSAL_PHOTO_TYPES')}\nreturn (${extractFn('scopeProposalPhotos')});`)(fetchTab);

console.log('scopeProposalPhotos — offline tests\n');

// A realistic mixed Attachments tab: photos on the WO, a stray photo still under the pre-WO
// SCOPE-<id> staging key (shouldn't happen post-conversion but tested defensively), an inactive
// photo, and every excluded type (after/report/receipt/bill/invoice) plus a non-image/video 'other'.
TABS.Attachments = [
  { ID: '1', WO_ID: 'WO-500', File_Type: 'before', Drive_File_ID: 'f1', Drive_URL: 'https://drive.google.com/file/d/f1/view', File_Name: 'before1.jpg', Mime_Type: 'image/jpeg', Active: 'TRUE' },
  { ID: '2', WO_ID: 'WO-500', File_Type: 'photo', Drive_File_ID: 'f2', Drive_URL: 'https://drive.google.com/file/d/f2/view', File_Name: 'phone-upload.jpg', Mime_Type: '', Active: 'TRUE' }, // no mime, still treated as image (matches index.html's own convention)
  { ID: '3', WO_ID: 'WO-500', File_Type: 'other', Drive_File_ID: 'f3', Drive_URL: 'https://drive.google.com/file/d/f3/view', File_Name: 'walkthrough.mp4', Mime_Type: 'video/mp4', Active: 'TRUE' },
  { ID: '4', WO_ID: 'WO-500', File_Type: 'after', Drive_File_ID: 'f4', Drive_URL: '#', File_Name: 'after1.jpg', Mime_Type: 'image/jpeg', Active: 'TRUE' },      // excluded: not relevant pre-signature
  { ID: '5', WO_ID: 'WO-500', File_Type: 'report', Drive_File_ID: 'f5', Drive_URL: '#', File_Name: 'inspection.pdf', Mime_Type: 'application/pdf', Active: 'TRUE' }, // excluded: admin-internal
  { ID: '6', WO_ID: 'WO-500', File_Type: 'receipt', Drive_File_ID: 'f6', Drive_URL: '#', File_Name: 'receipt.pdf', Mime_Type: 'application/pdf', Active: 'TRUE' },  // excluded: private cost doc
  { ID: '7', WO_ID: 'WO-500', File_Type: 'bill', Drive_File_ID: 'f7', Drive_URL: '#', File_Name: 'bill.pdf', Mime_Type: 'application/pdf', Active: 'TRUE' },        // excluded: private cost doc
  { ID: '8', WO_ID: 'WO-500', File_Type: 'invoice', Drive_File_ID: 'f8', Drive_URL: '#', File_Name: 'invoice.pdf', Mime_Type: 'application/pdf', Active: 'TRUE' },  // excluded: private cost doc
  { ID: '9', WO_ID: 'WO-500', File_Type: 'other', Drive_File_ID: 'f9', Drive_URL: '#', File_Name: 'warranty.pdf', Mime_Type: 'application/pdf', Active: 'TRUE' },   // excluded: not viewable (not image/video)
  { ID: '10', WO_ID: 'WO-500', File_Type: 'before', Drive_File_ID: 'f10', Drive_URL: '#', File_Name: 'deleted.jpg', Mime_Type: 'image/jpeg', Active: 'FALSE' },     // excluded: inactive
  { ID: '11', WO_ID: 'WO-999', File_Type: 'before', Drive_File_ID: 'f11', Drive_URL: '#', File_Name: 'other-job.jpg', Mime_Type: 'image/jpeg', Active: 'TRUE' },    // excluded: different WO
  { ID: '12', WO_ID: 'SCOPE-42', File_Type: 'before', Drive_File_ID: 'f12', Drive_URL: '#', File_Name: 'pre-wo.jpg', Mime_Type: 'image/jpeg', Active: 'TRUE' },     // excluded here: this scope already has WO-500
];

// ---- 1. Scope with a real WO_ID: only the customer-safe, viewable, active, same-WO photos ----
const s1 = { ID: '42', WO_ID: 'WO-500' };
const photos1 = await scopeProposalPhotos({}, s1);
ok(photos1.length === 3, `exactly 3 customer-safe photos returned (got ${photos1.length})`);
ok(photos1.every(p => ['f1', 'f2', 'f3'].includes(p.fileId)), 'only the before/photo/other viewable files came through');
ok(!photos1.some(p => ['f4','f5','f6','f7','f8','f9','f10','f11','f12'].includes(p.fileId)), 'after/report/receipt/bill/invoice/non-viewable/inactive/other-WO files are all excluded');

const vid = photos1.find(p => p.fileId === 'f3');
ok(vid && vid.isVideo === true, 'mp4 attachment correctly flagged isVideo');
const noMime = photos1.find(p => p.fileId === 'f2');
ok(noMime && noMime.isViewable === true, 'a photo with no Mime_Type still counts as viewable (mirrors index.html isImage fallback)');

// ---- 2. Vendor cost / private fields never leak into the returned shape ----
ok(photos1.every(p => Object.keys(p).sort().join(',') === 'fileId,isVideo,isViewable,name,url'), 'returned photo objects only ever carry fileId/name/url/isVideo/isViewable — no other Attachments columns leak through');

// ---- 3. Scope with NO WO yet: falls back to the SCOPE-<id> staging key ----
const s2 = { ID: '42', WO_ID: '' };
const photos2 = await scopeProposalPhotos({}, s2);
ok(photos2.length === 1 && photos2[0].fileId === 'f12', 'a scope with no WO_ID yet looks under SCOPE-<id>, not the empty string');

// ---- 4. A scope with no matching attachments at all returns an empty array, not an error ----
const s3 = { ID: '999', WO_ID: 'WO-DOES-NOT-EXIST' };
const photos3 = await scopeProposalPhotos({}, s3);
ok(Array.isArray(photos3) && photos3.length === 0, 'no matching attachments → empty array, not a throw');

// ---- 5. fetchTab throwing (e.g. Sheets hiccup) fails open to an empty array, never breaks the proposal ----
const badFetchTab = async () => { throw new Error('Sheets API down'); };
const scopeProposalPhotosFailOpen = new Function('fetchTab', `${extractConst('SCOPE_PROPOSAL_PHOTO_TYPES')}\nreturn (${extractFn('scopeProposalPhotos')});`)(badFetchTab);
const photos4 = await scopeProposalPhotosFailOpen({}, s1);
ok(Array.isArray(photos4) && photos4.length === 0, 'a Sheets read failure fails open (empty photos) rather than breaking the whole proposal load');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
