// Nov 2 2026 - Field Inspection: attach full-size originals that Brett already put in each property's Drive "Full size" folder.
// Runs the REAL fiOrigBridge from worker.js (scan / fetch / attach) against test/_fi-world.mjs and pins:
//   - scan finds the "Full size" folder next to the inspection folder (any case/trailing space) and lists its images + which photos already have an original
//   - fetch hands back exact bytes, caps the batch size, and names every file it could not give (nothing silent)
//   - attach COPIES the file into the inspection folder as <photo>_original.<ext>, records the four Orig_* cells, reads them back, and shows up in /fi/report
//   - attach never replaces an existing original (including one that lands mid-request), is idempotent, reuses a same-size copy, refuses a size clash
//   - only files inside the Full size folder can be attached; every failure is typed, logged to telemetry, and fails the response
//   - wiring: HUB_PROD_WRITE_PATHS, route, staging guard; no swallowing catch in the new code
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 500) : ''); } };
const ID = 'fi_att_0001', IDS = ['ph_att_a', 'ph_att_b', 'ph_att_c', 'ph_att_d'];
const mkDoc = (ids) => ({ v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, owner: { id: 'O1', name: 'Premier' }, overall: { condition: 'fair', notes: '' }, date: '2026-10-15', areas: [{ id: 'a1', name: 'Kitchen', condition: 'fair', issues: [], photo_ids: ids }] });
const pr = (mime, n) => ({ headers: { get: k => (k === 'Content-Type' ? mime : '') }, arrayBuffer: async () => new ArrayBuffer(n) });
const up = (id, ph) => new URL('https://x/fi/photo?inspection_id=' + id + '&photo_id=' + ph);

async function setup(opts) {
  opts = opts || {};
  const w = world();
  const r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc(IDS), meta: { client_name: 'Premier', inspector: 'Brett' } });
  const token = r.body.report_token;
  const it = w.h.tabs.FI_Inspections; it.rows[0][it.headers.indexOf('Status')] = 'published';
  for (const p of IDS) await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), up(ID, p));
  { const hi = it.headers.indexOf('Drive_Folder_ID'); while (it.rows[0].length <= hi) it.rows[0].push(''); it.rows[0][hi] = opts.noFolder ? '' : 'INSPF'; }
  const d = { full: [   // what is in the Full size folder
    { id: 'src_001', name: 'IMG_20261015_123752.jpg', mimeType: 'image/jpeg', size: '369043', imageMediaMetadata: { time: '2026:10:15 12:37:52', width: 3000, height: 4000 } },
    { id: 'src_002', name: 'IMG_20261015_123831.jpg', mimeType: 'image/jpeg', size: '604831', imageMediaMetadata: { time: '2026:10:15 12:38:31', width: 3000, height: 4000 } },
    { id: 'src_003', name: 'IMG_20261015_130509.jpg', mimeType: 'image/jpeg', size: '399745' },
    { id: 'src_vid', name: 'VID_1.mp4', mimeType: 'video/mp4', size: '99999' } ],
    inInsp: opts.inInsp || [], copies: [], listCalls: 0, bytes: {}, fullName: opts.fullName === undefined ? 'Full size ' : opts.fullName };
  w.h.driveD = d;
  w.h.net = async (url, o) => {
    url = String(url);
    const R = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (url.includes('alt=media')) {
      const id = decodeURIComponent(url.match(/files\/([^?]+)\?/)[1]);
      if (d.mediaFail && d.mediaFail.includes(id)) return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
      const b = d.bytes[id] || new TextEncoder().encode('bytes-of-' + id); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
    if (!url.startsWith('https://www.googleapis.com/drive/v3/files')) return null;
    const u = new URL(url), mid = u.pathname.match(/\/drive\/v3\/files\/([^/]+?)(\/copy)?$/);
    if (mid && mid[2]) { // copy
      const src0 = d.full.find(f => f.id === decodeURIComponent(mid[1]));
      if (d.copyFail) return R(500, { error: { message: 'copy down' } });
      const b = JSON.parse(o.body), c = { id: 'copy_' + (d.copies.length + 1), name: b.name, size: d.copySize != null ? String(d.copySize) : src0.size, parents: b.parents, from: src0.id };
      d.copies.push(c); if (d.onCopy) d.onCopy(c);
      return R(200, c);
    }
    if (mid && mid[1] === 'INSPF') return R(200, { id: 'INSPF', name: 'Inspection 10152026', parents: ['PROP'] });
    if (!mid) {
      d.listCalls++;
      const q = u.searchParams.get('q') || '';
      if (d.listFail) return R(500, { error: { message: 'list down' } });
      if (q.startsWith("'PROP' in parents")) return R(200, { files: [{ id: 'FS1', name: d.fullName }, { id: 'INSPF', name: 'Inspection 10152026' }, { id: 'FS_OTHER', name: 'Full size photos old' }] });
      if (q.startsWith("'FS1' in parents")) return R(200, { files: d.full });
      if (q.startsWith("'INSPF' in parents")) return R(200, { files: d.inInsp.concat(d.copies.map(c => ({ id: c.id, name: c.name, size: c.size, mimeType: 'image/jpeg' }))) });
      return R(200, { files: [] });
    }
    return null;
  };
  return { w, token, d };
}
const bridge = (w, body) => w.fiOrigBridge(w.env, Object.assign({ inspection_id: ID }, body));
const origCells = (w) => { const tb = w.h.tabs.FI_Photos, g = n => tb.headers.indexOf(n); const o = {}; for (const r of tb.rows) o[r[g('ID')]] = { f: r[g('Orig_Drive_File_ID')] || '', m: r[g('Orig_Mime')] || '', b: r[g('Orig_Bytes')] || '', at: r[g('Orig_At')] || '' }; return o; };

// ── validation ──
{
  const { w } = await setup();
  let r = await bridge(w, { action: 'nope' }); t('bad action -> 400', r.status === 400 && r.body.error === 'bad_action', r);
  r = await w.fiOrigBridge(w.env, { action: 'scan', inspection_id: 'x' }); t('bad id -> 400', r.status === 400, r);
  r = await w.fiOrigBridge(w.env, { action: 'scan', inspection_id: 'fi_missing_9999' }); t('unknown inspection -> 404', r.status === 404, r);
  const n = await setup({ noFolder: true });
  r = await bridge(n.w, { action: 'scan' }); t('no Drive folder yet -> 409 no_folder, nothing created', r.status === 409 && r.body.error === 'no_folder', r);
  r = await bridge(w, { action: 'attach', pairs: [] }); t('attach with no pairs -> 400', r.status === 400 && r.body.error === 'bad_pairs', r);
  r = await bridge(w, { action: 'attach', pairs: Array.from({ length: 13 }, (_, i) => ({ photo_id: 'ph_att_a', file_id: 'src_' + i + 'xxxxx' })) }); t('attach with 13 pairs -> 400', r.status === 400, r);
  r = await bridge(w, { action: 'fetch', kind: 'zzz', ids: ['src_1xx'] }); t('fetch bad kind -> 400', r.status === 400, r);
}
// ── scan ──
{
  const { w, d } = await setup();
  const calls0 = w.h.calls.length;
  const r = await bridge(w, { action: 'scan' });
  t('scan ok', r.status === 200 && r.body.ok, r);
  t('scan finds "Full size " (trailing space) next to the inspection folder, not "Full size photos old"', r.body.full_folders.length === 1 && r.body.full_folders[0].id === 'FS1', r.body.full_folders);
  t('scan lists only images (video skipped)', r.body.originals.length === 3 && !r.body.originals.some(o => o.id === 'src_vid'), r.body.originals.map(o => o.id));
  t('scan carries size + capture time', r.body.originals[0].size === 369043 && r.body.originals[0].time === '2026:10:15 12:37:52' && r.body.originals[0].w === 3000, r.body.originals[0]);
  t('scan lists the 4 photos, none with an original', r.body.photos.length === 4 && r.body.photos.every(p => !p.has_orig), r.body.photos);
  t('scan writes nothing', !d.copies.length && !w.h.calls.slice(calls0).some(c => c.startsWith('POST')), w.h.calls.slice(calls0));
  const up2 = await setup({ fullName: 'FULL SIZE' }); const r2 = await bridge(up2.w, { action: 'scan' }); t('folder name match ignores case', r2.body.full_folders.length === 1, r2.body);
  const no = await setup({ fullName: 'Misc' }); const r3 = await bridge(no.w, { action: 'scan' }); t('no Full size folder -> empty list, still ok (the caller sees 0 files)', r3.body.ok && r3.body.full_folders.length === 0 && r3.body.originals.length === 0, r3.body);
  const lf = await setup(); lf.d.listFail = true; let threw = null; try { await bridge(lf.w, { action: 'scan' }); } catch (e) { threw = e; }
  t('Drive listing failure is thrown (fiRoute turns it into a typed 500 + telemetry), never an empty list', threw && /list.*failed/.test(String(threw.message)), threw && threw.message);
}
// ── fetch ──
{
  const { w, d } = await setup();
  d.bytes.src_001 = new Uint8Array([1, 2, 3, 4, 250]);
  let r = await bridge(w, { action: 'fetch', kind: 'orig', ids: ['src_001', 'src_002'] });
  t('fetch orig returns bytes', r.body.files.length === 2 && r.body.files[0].id === 'src_001' && Buffer.from(r.body.files[0].b64, 'base64').equals(Buffer.from([1, 2, 3, 4, 250])), r.body);
  r = await bridge(w, { action: 'fetch', kind: 'orig', ids: ['src_001', 'nopexxx'] });
  t('fetch names an id that is not in the Full size folder and fails the response', r.body.ok === false && r.body.missing.join() === 'nopexxx' && r.body.files.length === 1, r.body);
  r = await bridge(w, { action: 'fetch', kind: 'orig', ids: ['src_vid'] }); t('a video cannot be fetched', r.body.missing.join() === 'src_vid', r.body);
  d.full.push({ id: 'src_big', name: 'big.jpg', mimeType: 'image/jpeg', size: String(6 * 1024 * 1024) }, { id: 'src_huge', name: 'huge.jpg', mimeType: 'image/jpeg', size: String(13 * 1024 * 1024) });
  d.bytes.src_big = new Uint8Array(6 * 1024 * 1024);
  r = await bridge(w, { action: 'fetch', kind: 'orig', ids: ['src_big', 'src_001', 'src_huge'] });
  t('batch is capped (~5 MB): first file always goes, the next is deferred, over-12 MB is reported too_big', r.body.files.length === 1 && r.body.files[0].id === 'src_big' && r.body.deferred.join() === 'src_001' && r.body.too_big[0].id === 'src_huge', r.body);
  d.mediaFail = ['src_002']; r = await bridge(w, { action: 'fetch', kind: 'orig', ids: ['src_002'] });
  t('a Drive read error is reported per file, response not ok', r.body.ok === false && r.body.failed[0].id === 'src_002' && r.body.failed[0].status === 500, r.body);
  r = await bridge(w, { action: 'fetch', kind: 'std', ids: ['ph_att_a', 'ph_att_b'] });
  t('fetch std returns the stored copies', r.body.files.length === 2 && r.body.files[0].id === 'ph_att_a' && r.body.files[0].mime === 'image/jpeg', r.body);
  r = await bridge(w, { action: 'fetch', kind: 'std', ids: ['ph_zzz_none'] }); t('fetch std of an unknown photo is "missing"', r.body.missing.join() === 'ph_zzz_none' && r.body.ok === false, r.body);
  r = await bridge(w, { action: 'fetch', kind: 'std', ids: Array.from({ length: 26 }, (_, i) => 'ph_att_' + i + 'xxx') }); t('more than 25 ids -> 400', r.status === 400, r);
}
// ── attach: happy path ──
{
  const { w, d, token } = await setup();
  const rd0 = w.h.calls.filter(c => c.startsWith('GET /values/')).length;
  let r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }, { photo_id: 'ph_att_b', file_id: 'src_002' }] });
  t('attach ok', r.status === 200 && r.body.ok && r.body.attached === 2 && r.body.errors === 0, r.body);
  t('copies land in the inspection folder with the app\'s own name', d.copies.length === 2 && d.copies[0].name === 'ph_att_a_original.jpg' && d.copies[0].parents[0] === 'INSPF' && d.copies[1].name === 'ph_att_b_original.jpg', d.copies);
  const c = origCells(w);
  t('Orig_* cells hold the COPY (so deleting the Full size folder later breaks nothing), mime, bytes, time', c.ph_att_a.f === 'copy_1' && c.ph_att_a.m === 'image/jpeg' && c.ph_att_a.b === '369043' && /^2026-/.test(c.ph_att_a.at) && c.ph_att_b.f === 'copy_2', c);
  t('photos not named stay without an original', !c.ph_att_c.f && !c.ph_att_d.f, c);
  const rep = await w.fiReport(w.env, { headers: { get: () => '' } }, new URL('https://x/fi/report?r=' + token)).catch(e => e);
  if (rep && rep.body) t('/fi/report now lists the two as having a full-size original', rep.body.photo_full && rep.body.photo_full.ph_att_a === 369043 && rep.body.photo_full.ph_att_b === 604831 && !rep.body.photo_full.ph_att_c, rep.body.photo_full);
  r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }, { photo_id: 'ph_att_c', file_id: 'src_003' }] });
  t('re-running is idempotent: the attached photo is "existing", no second copy; the new one attaches', r.body.existing === 1 && r.body.attached === 1 && d.copies.length === 3 && d.copies.filter(x => x.name === 'ph_att_a_original.jpg').length === 1, r.body);
  const sc = await bridge(w, { action: 'scan' }); t('scan now shows 3 photos with an original', sc.body.photos.filter(p => p.has_orig).length === 3, sc.body.photos);
}
// ── attach: refusals + failures ──
{
  const { w, d } = await setup();
  let r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'not_in_folder_1' }, { photo_id: 'ph_nope_xxx', file_id: 'src_001' }, { photo_id: 'ph_att_b', file_id: 'src_vid' }, { photo_id: 'ph_att_c', file_id: 'src_003' }, { photo_id: 'ph_att_c', file_id: 'src_002' }] });
  const by = Object.fromEntries(r.body.results.map(x => [x.photo_id + ':' + x.file_id, x]));
  t('a file outside the Full size folder is refused', by['ph_att_a:not_in_folder_1'].reason === 'file_not_in_full_size_folder', by);
  t('an unknown photo is refused', by['ph_nope_xxx:src_001'].reason === 'photo_not_found', by);
  t('a video is refused', by['ph_att_b:src_vid'].reason === 'file_not_in_full_size_folder', by);
  t('the same photo twice in one request: second is refused', by['ph_att_c:src_002'].reason === 'duplicate_in_request' && by['ph_att_c:src_003'].status === 'attached', by);
  t('failures fail the response and log telemetry', r.body.ok === false && r.body.errors === 4 && w.h.telemetry.some(x => x.Job_Type === 'fi_originals_attach_error' && x.Success === 'FALSE' && /ph_nope_xxx/.test(x.Notes)), w.h.telemetry);
  t('only the one valid pair copied/wrote', d.copies.length === 1 && origCells(w).ph_att_c.f === 'copy_1' && !origCells(w).ph_att_a.f, origCells(w));
}
{
  const { w, d } = await setup(); d.copyFail = true;
  const r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }] });
  t('Drive copy failure: typed error, nothing written to the sheet, telemetry', r.body.ok === false && /^copy_failed/.test(r.body.results[0].reason) && !origCells(w).ph_att_a.f && !w.h.calls.some(c => c.startsWith('POST /values:batchUpdate')) && w.h.telemetry.length === 1, r.body);
}
{
  const { w, d } = await setup(); d.copySize = 5;
  const r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }] });
  t('a copy with the wrong size is refused and not recorded', r.body.results[0].reason === 'copy_size_mismatch' && !origCells(w).ph_att_a.f, r.body);
}
{
  const { w } = await setup(); w.h.dropBatch = true;
  const r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }] });
  t('a write that did not stick is reported verify_failed (never "attached")', r.body.ok === false && r.body.results[0].status === 'error' && r.body.results[0].reason === 'verify_failed' && r.body.attached === 0, r.body);
}
{ // a same-named copy from an earlier, interrupted run is reused when the size matches...
  const { w, d } = await setup({ inInsp: [{ id: 'old_copy', name: 'ph_att_a_original.jpg', size: '369043', mimeType: 'image/jpeg' }] });
  let r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }] });
  t('same-size leftover copy is reused (no second copy)', r.body.attached === 1 && d.copies.length === 0 && origCells(w).ph_att_a.f === 'old_copy', r.body);
  // ...but a different-size file with that name is never guessed at
  const x = await setup({ inInsp: [{ id: 'other', name: 'ph_att_b_original.jpg', size: '111', mimeType: 'image/jpeg' }] });
  r = await bridge(x.w, { action: 'attach', pairs: [{ photo_id: 'ph_att_b', file_id: 'src_002' }] });
  t('a different-size file with that name is a name_conflict, nothing written', r.body.results[0].reason === 'name_conflict' && !origCells(x.w).ph_att_b.f && x.d.copies.length === 0, r.body);
}
{ // the phone attaches an original while the copy is being made: it wins, ours is not written
  const { w, d } = await setup();
  d.onCopy = () => { const tb = w.h.tabs.FI_Photos, g = n => tb.headers.indexOf(n), row = tb.rows.find(r => r[g('ID')] === 'ph_att_a'); row[g('Orig_Drive_File_ID')] = 'phone_orig'; };
  const r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }, { photo_id: 'ph_att_b', file_id: 'src_002' }] });
  t('an original that arrived mid-request is kept, not overwritten', origCells(w).ph_att_a.f === 'phone_orig' && r.body.results[0].status === 'existing' && r.body.results[1].status === 'attached', r.body);
}
{ // an existing original (from the phone flow) is never touched
  const { w, d } = await setup();
  const tb = w.h.tabs.FI_Photos, g = n => tb.headers.indexOf(n), row = tb.rows.find(r => r[g('ID')] === 'ph_att_a'); row[g('Orig_Drive_File_ID')] = 'phone_orig';
  const r = await bridge(w, { action: 'attach', pairs: [{ photo_id: 'ph_att_a', file_id: 'src_001' }] });
  t('a photo that already has an original is "existing": no copy, no write', r.body.existing === 1 && d.copies.length === 0 && origCells(w).ph_att_a.f === 'phone_orig', r.body);
}
// ── wiring ──
t('route is on the prod write allow-list', /HUB_PROD_WRITE_PATHS = \[[^\]]*'\/admin\/fi-originals-bridge'/.test(src));
t('route is wired through fiRoute', /path === '\/admin\/fi-originals-bridge'\) return await fiRoute\(env, 'originals-bridge', \(\) => fiOrigBridge\(env, body\)\)/.test(src));
t('staging may only touch TEST- inspections', /path === '\/admin\/fi-originals-bridge'\) return String\(\(body && body\.inspection_id\) \|\| ''\)\.startsWith\('TEST-'\)/.test(src));
const a = src.indexOf('const FI_BRIDGE_FETCH_BYTES'), b = src.indexOf('async function fiDriveSharedRoot(');
const code = src.slice(a, b);
t('new code has no empty / swallowing catch', !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(code) && !/\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined)/.test(code));
t('new code never deletes or moves anything in Drive', !/method:\s*'(DELETE|PATCH)'/.test(code) && !/trash/i.test(code.replace(/trashed=false/g, '')));
t('new code contains no cron / schedule', !/crons?\b|schedule:/i.test(code));
console.log('fi-attach-drive-originals: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
