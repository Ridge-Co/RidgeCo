// Nov 2 2026 - Field Inspection: full-size (original) photos + photo viewing that no longer drains Google's shared Sheets read quota.
// Brett: photos "could not be loaded" all over the PDF (a 139-photo report = ~280 Sheets reads for a 60/min limit); recipients must get the FULL-SIZE
// photo ("from original photo, they need as much detail as possible"), links must never expire ("indefinitely"). Runs the REAL FI block from worker.js
// against test/_fi-world.mjs and pins:
//   - POST /fi/photo?kind=orig stores the untouched original beside the copy, records it on the SAME FI_Photos row, verifies it, and is idempotent
//   - an original can never arrive before its standard copy; too big / empty / unsaved inspection are loud, typed errors
//   - an old 7-column FI_Photos tab gets the Orig_* columns by itself
//   - /fi/photo/view?full=1 serves the original (X-Photo-Variant: original), falls back to the standard copy when there is none, dl=1 downloads, links carry no expiry
//   - viewing N photos costs 2 Sheets reads in total (not 2 per photo), even when they all arrive at once; /fi/report fills that lookup for free
//   - unknown token / unknown photo cannot hammer Sheets; a photo uploaded a moment ago is viewable at once
//   - a Drive hiccup is retried once before the page sees a broken image
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };

const mkDoc = (photoIds) => ({ v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, owner: { id: 'O1', name: 'Premier' }, overall: { condition: 'fair', notes: '' }, date: '2026-11-02',
  areas: [{ id: 'a1', name: 'Kitchen', condition: 'fair', issues: [], photo_ids: photoIds }] });
const pr = (mime, n) => ({ headers: { get: k => (k === 'Content-Type' ? mime : '') }, arrayBuffer: async () => new ArrayBuffer(n) });
const u = (id, ph, kind) => new URL('https://x/fi/photo?inspection_id=' + id + '&photo_id=' + ph + (kind ? '&kind=' + kind : ''));
const vu = (tok, ph, extra) => new URL('https://x/fi/photo/view?r=' + tok + '&p=' + ph + (extra || ''));
const sheetReads = (w, from) => w.h.calls.slice(from).filter(c => c.startsWith('GET /values/'));
const hd = (res, k) => (res && res.headers && typeof res.headers.get === 'function') ? res.headers.get(k) : undefined;
const allHd = (res) => { const o = {}; if (res && res.headers && res.headers.forEach) res.headers.forEach((v, k) => { o[k] = v; }); return o; };
const ID = 'fi_full_0001';
const IDS = ['ph_full_a', 'ph_full_b', 'ph_full_c'];

async function setup(opts) {
  const w = world();
  let r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc(IDS), meta: { client_name: 'Premier', inspector: 'Brett' } });
  t('setup: inspection saved', r.status === 200, r);
  const token = r.body.report_token;
  // publish (flip the status cell directly: publishing rules are tested elsewhere)
  const it = w.h.tabs.FI_Inspections, si = it.headers.indexOf('Status'); it.rows[0][si] = 'published';
  w.h.driveFetches = [];
  w.h.net = async (url) => { if (String(url).includes('alt=media')) { const m = String(url).match(/files\/([^?]+)\?/); w.h.driveFetches.push(decodeURIComponent(m[1])); if (w.h.driveStatuses && w.h.driveStatuses.length) { const st = w.h.driveStatuses.shift(); if (st !== 200) return { ok: false, status: st, body: null, headers: { get: () => null } }; } } return null; };
  for (const p of IDS.slice(0, opts && opts.n || 2)) { const up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, p)); t('standard copy ' + p + ' uploaded', up.status === 200 && up.body.ok, up); }
  return { w, token };
}

// ── 1. uploading originals ──
{
  const { w, token } = await setup();
  const photos = () => w.h.tabs.FI_Photos;
  // original before the standard copy exists
  let r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 5000), u(ID, 'ph_full_zzz', 'orig'));
  t('original before its standard copy = visible 409 photo_not_saved', r.status === 409 && r.body.error === 'photo_not_saved', r);
  r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 5000), u('fi_nosuch_9999', 'ph_full_a', 'orig'));
  t('original for an unsaved inspection = 409 inspection_not_saved', r.status === 409 && r.body.error === 'inspection_not_saved', r);
  r = await w.fiPhotoUpload(w.env, pr('image/gif', 5000), u(ID, 'ph_full_a', 'orig'));
  t('wrong type = 415', r.status === 415, r);
  r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 0), u(ID, 'ph_full_a', 'orig'));
  t('empty original = 400', r.status === 400 && r.body.error === 'empty', r);
  r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 31 * 1024 * 1024), u(ID, 'ph_full_a', 'orig'));
  t('over 30 MB = 413 with a plain message', r.status === 413 && /30 MB/.test(r.body.message), r);

  const nUp = w.h.uploads.length;
  r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 4_200_000), u(ID, 'ph_full_a', 'orig'));
  t('original stored', r.status === 200 && r.body.ok && r.body.original === true && r.body.bytes === 4_200_000, r);
  const up = w.h.uploads[w.h.uploads.length - 1];
  t('original is its own Drive file, named for the photo, in the SAME folder as the copy', w.h.uploads.length === nUp + 1 && up.name === 'ph_full_a_original.jpg' && up.folderId === w.h.uploads[0].folderId, up);
  const h = photos().headers, row = photos().rows[0], col = (n) => row[h.indexOf(n)];
  t('FI_Photos got the four Orig_* columns', ['Orig_Drive_File_ID', 'Orig_Mime', 'Orig_Bytes', 'Orig_At'].every(c => h.includes(c)), h);
  t('same row now points at the original (and still at the standard copy)', col('Orig_Drive_File_ID') && col('Orig_Drive_File_ID') !== col('Drive_File_ID') && col('Orig_Bytes') === '4200000' && col('Orig_Mime') === 'image/jpeg' && col('Active') === 'TRUE' && col('ID') === 'ph_full_a', row);
  t('still ONE row per photo (no duplicate row appended)', photos().rows.length === 2);
  t('the other photo is untouched', !photos().rows[1][h.indexOf('Orig_Drive_File_ID')]);

  const n2 = w.h.uploads.length;
  r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 4_200_000), u(ID, 'ph_full_a', 'orig'));
  t('second send of the same original is idempotent: existing, no second Drive file', r.body.existing === true && w.h.uploads.length === n2, r);

  r = await w.fiPhotoUpload(w.env, pr('image/png', 900_000), u(ID, 'ph_full_b', 'orig'));
  t('png original keeps its type and extension', r.body.ok && w.h.uploads[w.h.uploads.length - 1].name === 'ph_full_b_original.png' && photos().rows[1][h.indexOf('Orig_Mime')] === 'image/png', r);

  // read-back must catch a wrong row
  const w2 = (await setup()).w;
  w2.h.corrupt = (tab, vals, heads) => { if (tab === 'FI_Photos' && heads.includes('Orig_Drive_File_ID')) vals[heads.indexOf('Orig_Drive_File_ID')] = 'WRONG'; return vals; };
  w2.h.corruptOnce = true;
  r = await w2.fiPhotoUpload(w2.env, pr('image/jpeg', 1000), u(ID, 'ph_full_a', 'orig'));
  t('a record that did not keep the pointer = loud 500 verify_failed, never "saved"', r.status === 500 && r.body.error === 'verify_failed', r);

  // Drive refuses
  const w3 = (await setup()).w; w3.h.driveFail = true;
  r = await w3.fiPhotoUpload(w3.env, pr('image/jpeg', 1000), u(ID, 'ph_full_a', 'orig'));
  t('Drive refusing the original = 502, row untouched', r.status === 502 && !w3.h.tabs.FI_Photos.rows[0][w3.h.tabs.FI_Photos.headers.indexOf('Orig_Drive_File_ID')], r);
  const w4 = (await setup()).w; w4.h.driveSize = 7;
  r = await w4.fiPhotoUpload(w4.env, pr('image/jpeg', 1000), u(ID, 'ph_full_a', 'orig'));
  t('Drive storing a different byte count = 502 drive_size_mismatch', r.status === 502 && r.body.error === 'drive_size_mismatch', r);
}

// ── 2. an old 7-column FI_Photos tab ──
{
  const { w } = await setup();
  const tb = w.h.tabs.FI_Photos; tb.headers = tb.headers.slice(0, 7); tb.rows = tb.rows.map(r => r.slice(0, 7));
  const r = await w.fiPhotoUpload(w.env, pr('image/jpeg', 3000), u(ID, 'ph_full_a', 'orig'));
  t('an old tab without Orig_* columns is upgraded by the first original and the original is recorded', r.status === 200 && tb.headers.includes('Orig_Drive_File_ID') && tb.rows[0][tb.headers.indexOf('Orig_Drive_File_ID')], r);
  const st = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_full_c'));
  t('and a standard photo still uploads on the widened tab', st.status === 200 && st.body.ok, st);
}

// ── 3. viewing: standard vs full vs download ──
{
  const { w, token } = await setup();
  await w.fiPhotoUpload(w.env, pr('image/jpeg', 4_200_000), u(ID, 'ph_full_a', 'orig'));
  const stdA = w.h.tabs.FI_Photos.rows[0][w.h.tabs.FI_Photos.headers.indexOf('Drive_File_ID')], origA = w.h.tabs.FI_Photos.rows[0][w.h.tabs.FI_Photos.headers.indexOf('Orig_Drive_File_ID')];
  const stdB = w.h.tabs.FI_Photos.rows[1][w.h.tabs.FI_Photos.headers.indexOf('Drive_File_ID')];
  w.__fiViewCache.clear();
  let res = await w.fiPhotoView(w.env, vu(token, 'ph_full_a'));
  t('default view = the standard copy', res.status === 200 && hd(res, 'X-Photo-Variant') === 'standard' && w.h.driveFetches.pop() === stdA, [res.status, allHd(res)]);
  t('views are cached for a day and carry no expiry/signature', /max-age=86400/.test(hd(res, 'Cache-Control')) && !/expire|signature/i.test(JSON.stringify(allHd(res))), allHd(res));
  res = await w.fiPhotoView(w.env, vu(token, 'ph_full_a', '&full=1'));
  t('full=1 = the ORIGINAL file', res.status === 200 && hd(res, 'X-Photo-Variant') === 'original' && w.h.driveFetches.pop() === origA && hd(res, 'Content-Type') === 'image/jpeg', [res.status, allHd(res)]);
  t('full view is inline (opens in the browser) unless dl=1', !hd(res, 'Content-Disposition'));
  res = await w.fiPhotoView(w.env, vu(token, 'ph_full_a', '&full=1&dl=1'));
  t('dl=1 downloads the original with a clear file name', /^attachment; filename="inspection-photo-ph_full_a-original\.jpg"$/.test(hd(res, 'Content-Disposition')), allHd(res));
  res = await w.fiPhotoView(w.env, vu(token, 'ph_full_b', '&full=1'));
  t('no original (uploaded before this feature) = the standard copy, honestly labelled', res.status === 200 && hd(res, 'X-Photo-Variant') === 'standard' && w.h.driveFetches.pop() === stdB, [res.status, allHd(res)]);
  res = await w.fiPhotoView(w.env, vu(token, 'ph_full_b', '&full=1&dl=1'));
  t('its download is NOT named "original"', !/original/.test(hd(res, 'Content-Disposition')), allHd(res));
  res = await w.fiPhotoView(w.env, vu(token, 'ph_nope_xx'));
  t('unknown photo = 404', res.status === 404, res);
  res = await w.fiPhotoView(w.env, vu('tk_not_a_real_token', 'ph_full_a'));
  t('unknown token = 404', res.status === 404, res);
  res = await w.fiPhotoView(w.env, vu('', 'ph_full_a'));
  t('missing token = 404', res.status === 404, res);

  // a photo that belongs to ANOTHER inspection is never served through this token
  const o = await w.fiSave(w.env, { id: 'fi_full_other', base_rev: 0, doc: mkDoc(['ph_other_a1']), meta: { client_name: 'X' } });
  await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('fi_full_other', 'ph_other_a1'));
  res = await w.fiPhotoView(w.env, vu(token, 'ph_other_a1'));
  t("another inspection's photo is never served through this report's token", res.status === 404, res.status);
  res = await w.fiPhotoView(w.env, vu(o.body.report_token, 'ph_other_a1'));
  t('...but is served through its own token', res.status === 200, res.status);
}

// ── 4. the Sheets-read budget ──
{
  const { w, token } = await setup({ n: 3 });
  w.__fiViewCache.clear(); w.__fiViewMiss.clear();
  let n0 = w.h.calls.length;
  for (let i = 0; i < 30; i++) await w.fiPhotoView(w.env, vu(token, IDS[i % 3]));
  let reads = sheetReads(w, n0);
  t('30 photo views = 2 Sheets reads in total (was 60)', reads.length === 2 && reads.includes('GET /values/FI_Inspections') && reads.includes('GET /values/FI_Photos'), reads);

  w.__fiViewCache.clear(); n0 = w.h.calls.length;
  const all = await Promise.all(Array.from({ length: 40 }, (_, i) => w.fiPhotoView(w.env, vu(token, IDS[i % 3], i % 2 ? '&full=1' : ''))));
  reads = sheetReads(w, n0);
  t('40 views arriving AT ONCE (a report opening) still = 2 reads: they share one lookup', reads.length === 2 && all.every(x => x.status === 200), [reads, all.map(x => x.status)]);

  // the report fills the lookup
  w.__fiViewCache.clear(); n0 = w.h.calls.length;
  const rep = await w.fiReport(w.env, { headers: { get: () => '' } }, new URL('https://x/fi/report?r=' + token));
  const afterReport = w.h.calls.length;
  for (let i = 0; i < 15; i++) await w.fiPhotoView(w.env, vu(token, IDS[i % 3]));
  t('after /fi/report the photos need ZERO further Sheets reads', rep.status === 200 && sheetReads(w, afterReport).length === 0, [rep.status, sheetReads(w, afterReport)]);

  // unknown token cannot hammer Sheets
  w.__fiViewMiss.clear(); n0 = w.h.calls.length;
  for (let i = 0; i < 10; i++) await w.fiPhotoView(w.env, vu('tk_scan_token_1', IDS[0]));
  t('10 requests with a bad token = one lookup (2 reads at most)', sheetReads(w, n0).length <= 1, sheetReads(w, n0));

  // unknown photo for a good token: at most one refresh per gap
  w.__fiViewCache.clear(); await w.fiPhotoView(w.env, vu(token, IDS[0])); n0 = w.h.calls.length;
  for (let i = 0; i < 10; i++) await w.fiPhotoView(w.env, vu(token, 'ph_missing_' + i + 'xx'));
  t('10 requests for photos that do not exist cost no extra reads inside the refresh gap', sheetReads(w, n0).length === 0, sheetReads(w, n0));

  // the cache ages out so a deleted/unpublished-and-removed photo does not live forever
  const real = Date.now; n0 = w.h.calls.length;
  Date.now = () => real() + 4 * 60 * 1000;
  try { await w.fiPhotoView(w.env, vu(token, IDS[0])); } finally { Date.now = real; }
  t('after the cache ages (3 min) the next view looks the photo up again', sheetReads(w, n0).length === 2, sheetReads(w, n0));

  // a photo uploaded a moment ago is viewable at once
  const sv = await w.fiSave(w.env, { id: ID, base_rev: 1, doc: mkDoc(IDS.concat(['ph_full_new'])), meta: {} });
  await w.fiPhotoView(w.env, vu(token, IDS[0]));
  await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_full_new'));
  const nv = await w.fiPhotoView(w.env, vu(token, 'ph_full_new'));
  t('a photo that just finished uploading is viewable immediately (cache dropped on upload)', nv.status === 200, nv.status);
  await w.fiPhotoUpload(w.env, pr('image/jpeg', 8000), u(ID, 'ph_full_new', 'orig'));
  const nf = await w.fiPhotoView(w.env, vu(token, 'ph_full_new', '&full=1'));
  t('and its original is viewable immediately after it uploads', nf.status === 200 && hd(nf, 'X-Photo-Variant') === 'original', allHd(nf));
}

// ── 5. /fi/report tells the page which photos have an original ──
{
  const { w, token } = await setup({ n: 3 });
  await w.fiPhotoUpload(w.env, pr('image/jpeg', 4_200_000), u(ID, 'ph_full_a', 'orig'));
  const rep = await w.fiReport(w.env, { headers: { get: () => '' } }, new URL('https://x/fi/report?r=' + token));
  t('report lists photo_full = {photo id: original bytes} for photos that have one only', rep.body.photo_full && rep.body.photo_full.ph_full_a === 4_200_000 && !('ph_full_b' in rep.body.photo_full) && !('ph_full_c' in rep.body.photo_full), rep.body.photo_full);
  t('photo_ids still lists every photo that reached the server', rep.body.photo_ids.length === 3, rep.body.photo_ids);
  t('no Drive file ids or links leak into the public report', !/drv\d|drive\.google|Orig_Drive/.test(JSON.stringify(rep.body)), JSON.stringify(rep.body).match(/.{40}(drv\d|drive\.google|Orig_Drive).{40}/));
}

// ── 6. Drive hiccups ──
{
  const { w, token } = await setup();
  w.__fiViewCache.clear();
  w.h.driveStatuses = [429];
  let res = await w.fiPhotoView(w.env, vu(token, 'ph_full_a'));
  t('one Drive 429 is retried once: the image still loads', res.status === 200 && w.h.driveFetches.length === 2, [res.status, w.h.driveFetches]);
  w.h.driveStatuses = [500, 500];
  res = await w.fiPhotoView(w.env, vu(token, 'ph_full_a'));
  t('Drive down twice = typed 502 drive_read (the page retries), not a hang', res.status === 502 && res.body.error === 'drive_read', res);
}

// ── 7. source rules ──
{
  const fn = src.slice(src.indexOf('async function fiPhotoView('), src.indexOf('async function fiReport('));
  t('fiPhotoView itself makes no Sheets read', !/fiReadFresh|sheetsRequest|FI_Inspections|FI_Photos/.test(fn), fn.match(/fiReadFresh|sheetsRequest|FI_Inspections|FI_Photos/));
  t('no expiring/signed URL machinery was introduced', !/X-Goog-Expires|expires=|signedUrl|presign/i.test(src.slice(src.indexOf('async function fiPhotoUploadOriginal('), src.indexOf('async function fiReport('))));
  t('the swallow-nothing rule: no empty catch in the new code', !/catch\s*\([^)]*\)\s*\{\s*\}/.test(src.slice(src.indexOf('async function fiPhotoUploadOriginal('), src.indexOf('async function fiReport('))));
}
console.log(`fi-full-size-photos: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
