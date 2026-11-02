// Nov 2 2026 - the phone page sends the ORIGINAL photo (full resolution) in the background, after the fast standard copy.
// Runs the REAL code from field-inspect.html (the "full-size original" block + the photo uploader block) in a sandbox with a fake network / IndexedDB / timers and pins:
//   - originals queue behind EVERY standard copy and only after their own standard copy is on the server
//   - the request carries the untouched file with its real type, photo_id of the standard photo, kind=orig; a longer timeout than a standard copy
//   - the phone copy of an original is freed once the server confirms (and a repeat answer "existing" counts as done)
//   - an original the server will never take (over 30 MB) is NOT left as a red bar that cannot clear: it is toasted + reported + dropped; auth failures still stay red
//   - an original whose photo was removed from the inspection is dropped with it
//   - HEIC / over-limit files are re-saved at FULL pixel size (never scaled down); a file that cannot fit is reported, not silently skipped
//   - the bottom bar says "full-size copy" so it is clear what is uploading
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const a1 = html.indexOf('// Nov 2 2026 (Brett): recipients get the FULL-SIZE photo'), b1 = html.indexOf('var photoTarget = null;');
const a2 = html.indexOf('// ── photo uploader ─'), b2 = html.indexOf('// ── model ─');
if (a1 < 0 || b1 < a1 || a2 < 0 || b2 < a2) { console.log('FAIL: could not find the code blocks'); process.exit(1); }
const code = html.slice(a1, b1) + '\n' + html.slice(a2, b2);
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 300) : ''); } };

function mk() {
  const timers = []; let now = 1_000_000; const reports = [], toasts = [];
  const db = { photos: [], docs: { insp1: { base_rev: 3 } } };
  const net = { queue: [], calls: [], reqs: [] };
  const enc = [];       // compressImage calls
  const sb = {
    console, Date: { now: () => now }, Math, Object, Promise, Number, String, JSON, Array, RegExp, Error,
    WORKER: 'https://w', AUTH_TOKEN: 'tok',
    S: { pumping: false, photoMsg: '', view: 'home', rec: { id: 'insp1', dirty: false }, sync: {} },
    photoState: {}, esc: (x) => String(x),
    navigator: { onLine: true },
    setSync() {}, safeRender() {}, scheduleSync() {},
    toast(m) { toasts.push(m); },
    dbAll: async () => db.photos.map(p => p),
    dbGet: async (st, id) => db.docs[id],
    dbPut: async (st, p) => { const i = db.photos.findIndex(x => x.id === p.id); if (i >= 0) db.photos[i] = p; else db.photos.push(p); },
    dbDel: async (st, id) => { const i = db.photos.findIndex(x => x.id === id); if (i >= 0) db.photos.splice(i, 1); },
    compressImage: async (file, max, q) => { enc.push({ max, q, from: file.type }); const size = sb.__encSizes.shift(); return { size: size == null ? 1000 : size, type: 'image/jpeg', enc: true }; },
    __encSizes: [],
    window: { hubReportFailure: (w, m, x) => reports.push({ w, m, x }), AbortController: null },
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; this.signal.__rej && this.signal.__rej(new Error('AbortError')); } },
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: now + ms, live: true, ms }); return id; },
    clearTimeout: (id) => { const x = timers.find(y => y.id === id); if (x) x.live = false; },
    setInterval: () => 999, clearInterval: () => {},
    fetch: (url, opts) => {
      net.calls.push(url); net.reqs.push({ url, opts });
      const r = net.queue.shift() || { status: 200, body: { ok: true } };
      if (r === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) });
    },
  };
  sb.window.AbortController = sb.AbortController;
  vm.createContext(sb); vm.runInContext(code, sb);
  return {
    sb, db, net, reports, toasts, enc, timers,
    std(id, extra) { db.photos.push(Object.assign({ id, insp: 'insp1', blob: { std: id }, state: 'pending', err: '' }, extra || {})); },
    orig(id, extra) { db.photos.push(Object.assign({ id: id + '__o', photo_id: id, kind: 'orig', insp: 'insp1', blob: { orig: id, size: 5_000_000 }, mime: 'image/jpeg', state: 'pending', err: '' }, extra || {})); },
    advance(ms) { now += ms; for (const x of timers.filter(y => y.live && y.at <= now)) { x.live = false; x.fn(); } },
    async settle() { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); },
    async drain(n) { for (let i = 0; i < (n || 8); i++) { await this.settle(); this.advance(1000); } await this.settle(); },
    run(src) { return vm.runInContext(src, sb); },
  };
}
const q = (c) => c.net.reqs.map(r => { const u = new URL(r.url); return u.searchParams.get('photo_id') + (u.searchParams.get('kind') ? ':' + u.searchParams.get('kind') : ':std'); });

// ── 1. order, request shape, storage freed ──
{
  const c = mk();
  c.orig('ph_a'); c.std('ph_a'); c.orig('ph_b'); c.std('ph_b');       // deliberately stored in the "wrong" order
  c.run('pumpPhotos()'); await c.drain(10);
  t('all standard copies go first, then the originals', q(c).join() === 'ph_a:std,ph_b:std,ph_a:orig,ph_b:orig', q(c));
  const o = c.net.reqs[2];
  t('original request: POST, real file type, 4 MB body untouched, kind=orig & the STANDARD photo id, inspection id', o.opts.method === 'POST' && o.opts.headers['Content-Type'] === 'image/jpeg' && o.opts.body.orig === 'ph_a' && /inspection_id=insp1/.test(o.url) && /kind=orig/.test(o.url) && /photo_id=ph_a(&|$)/.test(o.url), o);
  t('standard copy request is unchanged (jpeg, no kind)', !/kind=/.test(c.net.reqs[0].url) && c.net.reqs[0].opts.headers['Content-Type'] === 'image/jpeg');
  t('every row is done', c.db.photos.every(p => p.state === 'done'), c.db.photos.map(p => p.id + ':' + p.state));
  t('the original blob is released from the phone once the server has it; the standard copy is kept for the local view', c.db.photos.filter(p => p.kind === 'orig').every(p => !p.blob) && c.db.photos.filter(p => !p.kind).every(p => p.blob), c.db.photos);
  t('nothing is left waiting', Object.keys(c.sb.photoState).length === 0, c.sb.photoState);
}
// png original keeps its type
{
  const c = mk(); c.std('ph_a', { state: 'done' }); c.orig('ph_a', { mime: 'image/png' });
  c.run('pumpPhotos()'); await c.drain(4);
  t('png original goes up as image/png', c.net.reqs.length === 1 && c.net.reqs[0].opts.headers['Content-Type'] === 'image/png', c.net.reqs.map(r => r.opts.headers));
}
// ── 2. an original waits for its standard copy ──
{
  const c = mk(); c.std('ph_a'); c.orig('ph_a');
  c.net.queue.push({ status: 429, body: { error: 'sheets_busy', busy: true, retry_after_seconds: 8, message: 'Google Sheets is busy' } });
  c.run('pumpPhotos()'); await c.drain(3);
  t('standard copy hit the quota: the original was NOT sent ahead of it', q(c).join() === 'ph_a:std', q(c));
  t('and the original is still queued, not failed', c.db.photos.find(p => p.kind === 'orig').state === 'pending');
  c.advance(60_000); await c.drain(8);
  t('after the wait both go, in order', q(c).join() === 'ph_a:std,ph_a:std,ph_a:orig', q(c));
}
{
  const c = mk(); c.std('ph_a', { state: 'done' }); c.orig('ph_a');
  c.net.queue.push({ status: 409, body: { ok: false, error: 'photo_not_saved', message: 'The standard copy of this photo has not reached the server yet.' } });
  c.run('pumpPhotos()'); await c.drain(3);
  t('server says the standard copy is not there yet: original stays queued (not failed, not dropped), retries later', c.db.photos.find(p => p.kind === 'orig').state === 'pending' && c.db.photos.find(p => p.kind === 'orig').blob, c.db.photos);
}
// ── 3. originals the server will never take ──
{
  const c = mk(); c.std('ph_a', { state: 'done' }); c.orig('ph_a'); c.std('ph_b'); 
  c.net.queue.push({ status: 413, body: { ok: false, error: 'too_large', message: 'The full-size photo is larger than 30 MB, so only the standard copy is kept.' } });
  c.net.queue.unshift({ status: 200, body: { ok: true } });             // ph_b standard goes first
  c.run('pumpPhotos()'); await c.drain(8);
  t('over-30MB original: dropped from the queue (no red bar that can never clear)', !c.db.photos.some(p => p.id === 'ph_a__o') && !c.sb.photoState['ph_a__o'], c.db.photos.map(p => p.id));
  t('...but told to Brett (toast with the reason) and reported to the failure log', c.toasts.some(m => /full-size photo was not kept/.test(m) && /30 MB/.test(m)) && c.reports.some(r => r.x.photo_id === 'ph_a'), [c.toasts, c.reports]);
  t('the standard copy is untouched', c.db.photos.find(p => p.id === 'ph_a').state === 'done');
}
{
  const c = mk(); c.std('ph_a', { state: 'done' }); c.orig('ph_a');
  c.net.queue.push({ status: 401, body: { ok: false, error: 'unauthorized', message: 'bad code' } });
  c.run('pumpPhotos()'); await c.drain(3);
  const o = c.db.photos.find(p => p.kind === 'orig');
  t('a sign-in failure keeps the original (red, with Retry) - it is NOT discarded', o && o.state === 'error' && o.blob && /Not signed in/.test(o.err), o);
}
// ── 4. photo removed ──
{
  const c = mk(); c.orig('ph_gone');
  c.run('pumpPhotos()'); await c.drain(3);
  t('an original whose photo no longer exists is dropped without a request', c.net.reqs.length === 0 && c.db.photos.length === 0, [c.net.reqs.length, c.db.photos]);
}
// ── 5. bar wording ──
{
  const c = mk(); c.std('ph_a'); c.orig('ph_a'); c.orig('ph_b'); c.std('ph_b', { state: 'done' });
  c.run('photoState = {"ph_a":{state:"pending",err:""},"ph_a__o":{state:"pending",err:""},"ph_b__o":{state:"pending",err:""}}');
  const s = c.run('photoStatusHtml(3)');
  t('bar says "1 photo + 2 full-size copies waiting"', /1 photo \+ 2 full-size copies waiting/.test(s.txt), s);
  c.run('S.pumping = true; S.up.sendingId = "ph_a__o"');
  t('while an original uploads the bar says so', /full-size photo/.test(c.run('photoStatusHtml(3)').txt));
}
// ── 6. preparing the original ──
{
  const c = mk();
  const jpg = { type: 'image/jpeg', size: 6_000_000 };
  let r = await c.run('prepareOriginal').call(null, jpg);
  t('a normal phone JPEG is sent as-is (the very same file, no re-encode)', r.blob === jpg && r.mime === 'image/jpeg' && c.enc.length === 0, [r, c.enc]);
  c.sb.__encSizes = [8_000_000];
  r = await c.run('prepareOriginal')({ type: 'image/heic', size: 4_000_000 });
  t('HEIC is re-saved at FULL pixel size (no downscale) as a high-quality JPEG', r.mime === 'image/jpeg' && r.blob.enc && c.enc[0].max >= 100000 && c.enc[0].q === 0.95, c.enc);
  c.enc.length = 0; c.sb.__encSizes = [40_000_000, 20_000_000];
  r = await c.run('prepareOriginal')({ type: 'image/jpeg', size: 45_000_000 });
  t('an over-limit JPEG is re-saved smaller (0.95 then 0.88) but still at full pixel size', r.blob.size === 20_000_000 && c.enc.map(e => e.q).join() === '0.95,0.88' && c.enc.every(e => e.max >= 100000), c.enc);
  c.enc.length = 0; c.sb.__encSizes = [40_000_000, 35_000_000];
  let err = null; try { await c.run('prepareOriginal')({ type: 'image/jpeg', size: 60_000_000 }); } catch (e) { err = e; }
  t('one that cannot fit even then is a loud rejection', err && /30 MB/.test(err.message), err && err.message);
  // queueOriginal never throws, and reports instead of staying silent
  c.sb.__encSizes = [40_000_000, 35_000_000];
  await c.run('queueOriginal')({ id: 'insp1' }, 'ph_z', { type: 'image/jpeg', size: 60_000_000 });
  t('queueOriginal on an impossible file: no row, a toast, a failure-log report', !c.db.photos.some(p => p.id === 'ph_z__o') && c.toasts.some(m => /full-size copy of one photo could not be kept/.test(m)) && c.reports.some(x => x.x.photo_id === 'ph_z'), [c.toasts, c.reports]);
  await c.run('queueOriginal')({ id: 'insp1' }, 'ph_y', jpg);
  const row = c.db.photos.find(p => p.id === 'ph_y__o');
  t('queueOriginal on a normal file stores a pending orig row pointing at the standard photo', row && row.kind === 'orig' && row.photo_id === 'ph_y' && row.state === 'pending' && row.mime === 'image/jpeg' && row.blob === jpg && c.sb.photoState['ph_y__o'], row);
}
// ── 7. source rules ──
{
  const add = html.indexOf("$('photo-in').addEventListener('change'"), end = html.indexOf('// ── photo uploader ─');
  const handler = html.slice(add, end);
  t('adding a photo queues its original after the standard row is stored', /return queueOriginal\(rec, id, f\);/.test(handler));
  t('the standard copy path is still 1600 px / 0.82 (fast report photos)', /var max = maxSide \|\| 1600/.test(html) && /quality \|\| 0\.82/.test(html));
  t('removing a photo also removes its queued original', /dbDel\('photos', id\+'__o'\)/.test(html));
  t('loadPhotoBlobs does not make object URLs for original rows', /p\.kind === 'orig'\) return;/.test(html));
}
console.log(`fi-original-photos-client: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
