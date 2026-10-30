// Oct 30 2026 — Field Inspection photo uploads vs Google's shared per-minute Sheets READ quota.
// Brett's photos got stuck: each /fi/photo did 4 full-tab Sheets reads (2x FI_Inspections, which holds up to 8 x 360 KB of report JSON, and 2x FI_Photos) through a raw
// 3-try / ~2 s retry loop that the read meter could not see, and whose quota error came back as a generic 500 'internal'. This runs the REAL FI block from
// worker.js against test/_fi-world.mjs and pins the fix:
//   - warm photo = 2 Sheets reads (FI_Photos pre-check + ONE-ROW read-back of the append) and zero FI_Inspections reads; the first photo of an inspection (creates its Drive folder) = 5, the second = 3
//   - positive-only inspection cache (a just-saved inspection is never reported missing; an unsaved one is never cached)
//   - quota answers are rethrown to the Worker's top-level typed-429 handler, any other failure is still a loud 500, and a failed telemetry write is reported
//   - fiReadFresh drops the shared 6 s cache first (read-back must be fresh) and a photo never sets up tabs on every cold instance
//   - the append read-back still fails loudly when the row is wrong, and falls back to the full-tab check when Sheets does not say where it wrote
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 300) : ''); } };

const mkDoc = () => ({ v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, owner: { id: 'O1', name: 'Premier Property Management LLC' }, overall: { condition: 'fair', notes: '' },
  areas: [{ id: 'a1', name: 'Kitchen', condition: 'fair', issues: [] }] });
const pr = (mime, n) => ({ headers: { get: k => (k === 'Content-Type' ? mime : '') }, arrayBuffer: async () => new ArrayBuffer(n) });
const u = (id, ph) => new URL('https://x/fi/photo?inspection_id=' + id + '&photo_id=' + ph);
const getReads = (w, from) => w.h.calls.slice(from).filter(c => c.startsWith('GET /values/'));
const ID = 'fi_quota_0001';

// ── 1. read counts per photo ──
{
  const w = world();
  let r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc(), meta: { client_name: 'Premier', inspector: 'Brett' } });
  t('setup: inspection saved', r.status === 200, r);
  w.fiInspCacheDrop(ID);                       // start cold, as a fresh Worker instance would
  let n0 = w.h.calls.length;
  let up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00001'));
  t('first photo ok', up.status === 200 && up.body.ok, up);
  let reads = getReads(w, n0);
  t('first photo ever of an inspection also creates its Drive folder: 5 reads, one time only', reads.length === 5 && reads.filter(c => c === 'GET /values/FI_Inspections').length === 3, reads);
  t('read-back is a single-row ranged read of the new row', reads.some(c => /^GET \/values\/FI_Photos!A2:G2$/.test(c)), reads);
  t('read-back is NOT a whole-tab FI_Photos re-read (only the pre-check is)', reads.filter(c => c === 'GET /values/FI_Photos').length === 1, reads);
  t('photo did NOT run the tab/column setup (no metadata read, no ensureColumns)', !w.h.calls.slice(n0).some(c => c.startsWith('GET ?fields')), w.h.calls.slice(n0));

  n0 = w.h.calls.length;
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00002'));
  reads = getReads(w, n0);
  t('second photo = 3 reads (one lookup that now sees the folder and is remembered)', up.body.ok && reads.length === 3 && reads.filter(c => c === 'GET /values/FI_Inspections').length === 1, reads);
  n0 = w.h.calls.length;
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00009'));
  reads = getReads(w, n0);
  t('third photo = 2 reads, zero FI_Inspections reads (cache hit)', up.body.ok && reads.length === 2 && !reads.includes('GET /values/FI_Inspections'), reads);
  t('both photos landed in the right folder', (w.h.uploads || []).length === 3 && w.h.uploads[0].folderId === w.h.uploads[2].folderId);
  t('FI_Photos has exactly the three rows', w.h.tabs.FI_Photos.rows.length === 3);

  n0 = w.h.calls.length;
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00002'));
  reads = getReads(w, n0);
  t('retry of an already-filed photo is idempotent: existing, 1 read, no Drive upload, no write', up.body.existing === true && reads.length === 1 && (w.h.uploads || []).length === 3 && !w.h.calls.slice(n0).some(c => c.startsWith('POST')), { up, reads });
  t('every fresh read dropped the shared tab cache first (read-back never stale)', (w.h.invalidated || []).includes('FI_Photos') && (w.h.invalidated || []).includes('FI_Inspections'), w.h.invalidated);
}

// ── 2. cache is POSITIVE-only ──
{
  const w = world();
  let up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('fi_quota_nosave', 'ph_q00003'));
  t('photo for an unsaved inspection is a visible 409, not cached', up.status === 409 && up.body.error === 'inspection_not_saved', up);
  let r = await w.fiSave(w.env, { id: 'fi_quota_nosave', base_rev: 0, doc: mkDoc(), meta: { inspector: 'Brett' } });
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('fi_quota_nosave', 'ph_q00003'));
  t('once saved, the same photo goes through straight away (a miss was never remembered)', r.status === 200 && up.status === 200 && up.body.ok, { r: r.status, up });
  // row with no Drive folder yet is never cached: the first photo creates the folder, the cache only learns it afterwards
  w.fiInspCacheDrop('fi_quota_nosave');
  const f = await w.fiFindInspectionForPhoto(w.env, 'fi_quota_nosave');
  t('cache lookup returns a real row and the trimmed copy carries no report JSON', f.row && f.row.o.Drive_Folder_ID && !('Data_1' in (await w.fiFindInspectionForPhoto(w.env, 'fi_quota_nosave')).row.o), f);
}

// ── 3. quota is "busy", everything else is a loud 500 ──
{
  const w = world();
  await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc(), meta: { inspector: 'Brett' } });
  w.fiInspCacheDrop(ID);
  const QUOTA = new Error("Sheets API error on GET /values/FI_Photos: Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'");
  w.h.sheetsReadError = (tab) => (tab === 'FI_Photos' ? QUOTA : null);
  let thrown = null, res = null;
  try { res = await w.fiRoute(w.env, 'photo', () => w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00004'))); } catch (e) { thrown = e; }
  t('quota error is rethrown for the Worker top-level typed-429 handler (not a 500 internal)', thrown === QUOTA && res === null, { thrown: thrown && thrown.message, res });
  t('nothing was uploaded to Drive or written when the read quota was out', (w.h.uploads || []).length === 0 && !(w.h.tabs.FI_Photos && w.h.tabs.FI_Photos.rows.length));
  w.h.sheetsReadError = (tab) => (tab === 'FI_Photos' ? new Error('Sheets API error on GET /values/FI_Photos: The caller does not have permission') : null);
  res = await w.fiRoute(w.env, 'photo', () => w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00004')));
  t('a real Sheets failure is still a loud 500 internal with the detail', res.status === 500 && res.body.error === 'internal' && /permission/.test(res.body.detail), res);
  t('...and it is logged to Ops_Telemetry', w.h.telemetry.some(x => x.Job_Type === 'fi_route_error' && x.Success === 'FALSE'), w.h.telemetry);
  w.h.sheetsReadError = null;
}

// ── 4. a failed telemetry write is reported, never swallowed ──
{
  const w = world();
  const boom = () => { throw new Error('Ops_Telemetry down'); };
  const w2 = world();
  // run fiRoute with a telemetry logger that throws: reuse the factory's own logTelemetry by making h.telemetry.push throw
  w2.h.telemetry = { push: boom };
  const res = await w2.fiRoute(w2.env, 'save', async () => { throw new Error('some bug'); });
  t('telemetry failure surfaces as telemetry_error in the 500', res.status === 500 && /Ops_Telemetry down/.test(res.body.telemetry_error || ''), res);
  t('route 500 still carries the original error detail', /some bug/.test(res.body.detail || ''), res);
  void w;
}

// ── 5. missing tab -> set up once and carry on; write read-back still loud ──
{
  const w = world();
  await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc(), meta: { inspector: 'Brett' } });
  w.fiInspCacheDrop(ID);
  let thrownOnce = false;
  w.h.sheetsReadError = (tab) => { if (tab === 'FI_Photos' && !thrownOnce) { thrownOnce = true; return new Error('Sheets API error on GET /values/FI_Photos: Unable to parse range: FI_Photos'); } return null; };
  // __fiTabsReady is already true after fiSave in this isolate, so a missing-tab error is NOT retried through setup: it is loud
  let err = null; try { await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00005')); } catch (e) { err = e; }
  t('with tabs already set up this instance, a missing tab is a loud error (never swallowed)', err && /Unable to parse range/.test(err.message), err && err.message);
  w.h.sheetsReadError = null;

  // read-back catches a row that did not keep the Drive id
  w.h.corruptOnce = true;
  w.h.corrupt = (tab, vals, headers) => { if (tab === 'FI_Photos') vals[headers.indexOf('Drive_File_ID')] = 'wrong'; return vals; };
  const up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00006'));
  t('a corrupted append is 500 verify_failed (never ok:true)', up.status === 500 && up.body.error === 'verify_failed' && up.body.ok === false, up);
  w.h.corrupt = null;

  // append that does not say where it landed -> falls back to the full-tab read-back, still verifies
  w.h.noAppendRange = true;
  const n0 = w.h.calls.length;
  const ok = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00007'));
  t('no updatedRange from Sheets -> full-tab read-back, still ok', ok.status === 200 && ok.body.ok && getReads(w, n0).filter(c => c === 'GET /values/FI_Photos').length === 2, { ok, reads: getReads(w, n0) });
  w.h.noAppendRange = false;

  // dropped append (Sheets said ok, row not there) is still caught by the fallback
  w.h.noAppendRange = true; w.h.dropAppend = 'FI_Photos';
  const dropped = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u(ID, 'ph_q00008'));
  t('append that silently dropped the row -> verify_failed', dropped.status === 500 && dropped.body.error === 'verify_failed', dropped);
  w.h.dropAppend = null; w.h.noAppendRange = false;
}

// ── 6. source-level guarantees ──
{
  const a = src.indexOf('async function fiReadFresh('), b = src.indexOf('async function fiWriteRow(');
  const fn = src.slice(a, b);
  t('fiReadFresh goes through sheetsRequest (6-try backoff + meter), not a raw fetch', /sheetsRequest\(env, 'GET'/.test(fn) && !/fetch\(`https:\/\/sheets/.test(fn));
  t('fiReadFresh drops the cached/shared tab copy first', /invalidateTabCache\(tab\)/.test(fn));
  const pa = src.indexOf('async function fiPhotoUpload('), pb = src.indexOf('async function fiPhotoView(');
  const ph = src.slice(pa, pb);
  t('photo upload no longer sets up tabs on every cold instance', !/^\s*await fiEnsureTabs\(env\);/m.test(ph.split('const row = found.row')[0].split('try {')[0]));
  t('photo upload reads FI_Inspections at most once per request (no second fiFindInspection for headers)', (ph.match(/fiFindInspection\(/g) || []).length === 1 && /fiFindInspectionForPhoto\(env, inspId\)/.test(ph));
  t('fiRoute rethrows quota-busy for the typed 429 and reports a failed telemetry write', /if \(sheetsQuotaBusyError\(e\)\) throw e;/.test(src.slice(src.indexOf('async function fiRoute('), src.indexOf('function fiErr(')) ) && /telemetry_error/.test(src));
}

console.log(`fi-photo-quota: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
