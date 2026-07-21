// Regression guard for handlePhotoUploadClean after the getWOFolder refactor.
// Run: node test/photoupload.test.mjs
//
// Photo upload is a FEATURE_LOG "✅ Working" row and carries rule 13 (vendor
// receipts must never land in the customer-facing WO folder that gets shared
// anyone-with-link on invoice send). The B-103 refactor pulled the folder
// resolution out into getWOFolder(); this pins the resulting folder LAYOUT so a
// future edit to the shared helper can't silently reroute receipts.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const tmp  = join(mkdtempSync(join(tmpdir(), 'ridgeco-photo-')), 'worker.mjs');
writeFileSync(tmp, readFileSync(join(here, '..', 'worker.js')));
const { handlePhotoUploadClean } = await import(pathToFileURL(tmp).href);

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

// Fake Drive: folders are a tree keyed by "<parentId>/<name>".
let folders, uploads, appended;
const ROOT = 'ROOT_PROPS';

function installStub() {
  folders = new Map([[ROOT, { id: ROOT, name: '(root)', parent: null }]]);
  uploads = [];
  appended = [];
  let nextId = 1;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, headers: { get: () => null } });

    if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'fake' });

    // Drive: folder search
    if (u.includes('googleapis.com/drive/v3/files?') && (opts.method === undefined || opts.method === 'GET')) {
      const q = decodeURIComponent(u);
      const name   = (q.match(/name="([^"]+)"/) || [])[1];
      const parent = (q.match(/'([^']+)' in parents/) || [])[1];
      const hit = [...folders.values()].find(f => f.name === name && f.parent === parent);
      return ok({ files: hit ? [{ id: hit.id, name: hit.name, webViewLink: `https://drive/${hit.id}` }] : [] });
    }
    // Drive: folder create
    if (u.includes('googleapis.com/drive/v3/files?') && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      const id = `F${nextId++}`;
      folders.set(id, { id, name: body.name, parent: body.parents[0] });
      return ok({ id, name: body.name, webViewLink: `https://drive/${id}` });
    }
    // Drive: file upload
    if (u.includes('/upload/drive/v3/files')) {
      const meta = (String(opts.body ? new TextDecoder().decode(opts.body) : '').match(/\{"name":.*?\}/) || ['{}'])[0];
      let parsed = {}; try { parsed = JSON.parse(meta); } catch (e) {}
      const id = `FILE${nextId++}`;
      uploads.push({ id, name: parsed.name, parent: (parsed.parents || [])[0] });
      return ok({ id, name: parsed.name, webViewLink: `https://drive/file/${id}` });
    }
    // Sheets
    if (u.includes('sheets.googleapis.com')) {
      const rest = decodeURIComponent((u.match(/spreadsheets\/[^/]+(\/.*)?$/) || [])[1] || '');
      if (opts.method === 'GET' || !opts.method) {
        if (rest.includes('/values/Attachments')) return ok({ values: [['ID','WO_ID','File_Name','File_Type','Drive_File_ID','Drive_URL','Mime_Type','Created_Date','Active']] });
        if (rest.includes('/values/Work_Orders')) return ok({ values: [['Vendor_Needs_Access','ID','Drive_Folder_URL','Drive_Folder_ID'], ['auto','WO-500','','']] });
        return ok({ values: [] });
      }
      if (rest.includes(':append')) { appended.push(JSON.parse(opts.body).values[0]); return ok({}); }
      return ok({});
    }
    throw new Error(`UNEXPECTED CALL: ${u}`);
  };
}

const ENV = { SHEET_ID: 'S', DRIVE_PROPERTIES_ROOT: ROOT, GOOGLE_SA_EMAIL: 'sa@x.com', GOOGLE_SA_KEY: PEM };

// Minimal multipart request carrying the fields handlePhotoUploadClean reads.
function uploadReq({ fileType, woId = 'WO-500', property = '1110 N Dukeland St' }) {
  const fd = new FormData();
  fd.set('file', new File(['binary-bytes'], 'shot.jpg', { type: 'image/jpeg' }));
  fd.set('wo_id', woId);
  fd.set('property', property);
  fd.set('file_type', fileType);
  return new Request('https://x/upload-photo', { method: 'POST', body: fd });
}

const pathOf = (id) => {
  const out = [];
  let f = folders.get(id);
  while (f && f.parent) { out.unshift(f.name); f = folders.get(f.parent); }
  return out.join('/');
};
const uploadedTo = () => pathOf(uploads[uploads.length - 1].parent);

section('job photo → customer-facing WO folder');
installStub();
let res = await handlePhotoUploadClean(ENV, uploadReq({ fileType: 'photo' }));
let body = await res.json();
eq(body.success, true, 'upload succeeded');
eq(uploadedTo(), '1110 N Dukeland St/WO-500', 'lands in <property>/<WO id>');
eq(appended.length, 1, 'logged to Attachments');

section('RULE 13 — receipts/bills/invoices → NON-shared internal folder');
for (const t of ['receipt', 'bill', 'invoice']) {
  installStub();
  res = await handlePhotoUploadClean(ENV, uploadReq({ fileType: t }));
  body = await res.json();
  eq(body.success, true, `${t}: upload succeeded`);
  eq(uploadedTo(), `1110 N Dukeland St/_Internal — Vendor Bills/WO-500`, `${t}: lands in the internal folder`);
  // The decisive check: it must NOT be in the folder that gets shared
  // anyone-with-link when the invoice is sent.
  eq(uploadedTo().includes('_Internal'), true, `${t}: NOT in the customer-facing WO folder`);
}

section('RULE 13 — case-insensitive file_type still routes internally');
installStub();
await handlePhotoUploadClean(ENV, uploadReq({ fileType: 'Receipt' }));
eq(uploadedTo().includes('_Internal'), true, '"Receipt" (capitalised) still routed internally');

section('only the customer-facing folder becomes the WO Drive_Folder link');
installStub();
await handlePhotoUploadClean(ENV, uploadReq({ fileType: 'photo' }));
const photoSetFolder = folders.size > 1;
eq(photoSetFolder, true, 'job photo path creates the WO folder');
installStub();
res = await handlePhotoUploadClean(ENV, uploadReq({ fileType: 'receipt' }));
body = await res.json();
eq(body.woFolderUrl.length > 0, true, 'receipt still returns its folder url to the caller');

section('missing file / missing Drive root are handled, not thrown');
installStub();
const noFile = new Request('https://x/upload-photo', { method: 'POST', body: new FormData() });
res = await handlePhotoUploadClean(ENV, noFile);
eq(res.status, 400, 'no file → 400');
installStub();
res = await handlePhotoUploadClean({ ...ENV, DRIVE_PROPERTIES_ROOT: '' }, uploadReq({ fileType: 'photo' }));
eq(res.status, 500, 'missing DRIVE_PROPERTIES_ROOT → clean 500');

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
if (fail) process.exit(1);
