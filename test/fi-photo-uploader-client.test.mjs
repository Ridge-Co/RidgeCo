// Oct 30 2026 — the Field Inspection page's photo uploader must never leave Brett guessing.
// Runs the REAL uploader code out of field-inspect.html (between the "photo uploader" banner and the "model" banner) in a sandbox with a fake network, a fake
// IndexedDB and fake timers, and pins:
//   - a Google-quota (429/busy) or flaky-network failure never marks a photo FAILED: it stays queued, the bar says why, and the page retries by itself with a wait
//   - the wait grows (5/10/20/40/60 s) for ordinary failures and honours the server's retry_after for quota
//   - other callers that poke pumpPhotos() every 600 ms (the urgent-send wait loop) cannot bypass the wait; the Retry now button / coming back online can
//   - a request that never answers times out instead of pinning the uploader forever
//   - only a never-acceptable photo (too big / wrong type) or MAX failed tries becomes "failed", with the Retry photos button, and it is reported (not silent)
//   - the bar names the position ("Uploading photo 2 of 3") and a countdown
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const a = html.indexOf('// ── photo uploader ─'), b = html.indexOf('// ── model ─');
if (a < 0 || b < a) { console.log('FAIL: could not find the uploader block'); process.exit(1); }
const code = html.slice(a, b);
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 300) : ''); } };

function mk() {
  const timers = []; let now = 1_000_000; const reports = [];
  const db = { photos: [], docs: { insp1: { base_rev: 3 } } };
  const net = { queue: [], calls: [] };    // queue of responses: {status, body} | 'throw' | 'hang'
  const sb = {
    console, Date: { now: () => now }, Math, Object, Promise, Number, String, JSON, Array,
    WORKER: 'https://w', AUTH_TOKEN: 'tok',
    S: { pumping: false, photoMsg: '', view: 'home', rec: { id: 'insp1', dirty: false }, sync: {} },
    photoState: {}, esc: (x) => String(x),
    navigator: { onLine: true },
    setSync() { sb.__syncs++; }, safeRender() {}, scheduleSync() {},
    dbAll: async (st) => db.photos.map(p => p),
    dbGet: async (st, id) => db.docs[id],
    dbPut: async (st, p) => { const i = db.photos.findIndex(x => x.id === p.id); if (i >= 0) db.photos[i] = p; else db.photos.push(p); },
    window: { hubReportFailure: (w, m, x) => reports.push({ w, m, x }), AbortController: null },
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; this.signal.__rej && this.signal.__rej(new Error('AbortError')); } },
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: now + ms, live: true }); return id; },
    clearTimeout: (id) => { const x = timers.find(y => y.id === id); if (x) x.live = false; },
    setInterval: () => 999, clearInterval: () => {},
    fetch: (url, opts) => {
      net.calls.push(url);
      const r = net.queue.shift() || { status: 200, body: { ok: true } };
      if (r === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      if (r === 'hang') return new Promise((_, rej) => { opts.signal.__rej = rej; });
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) });
    },
    __syncs: 0,
  };
  sb.window.AbortController = sb.AbortController;
  vm.createContext(sb);
  vm.runInContext(code, sb);
  const api = {
    sb, db, net, reports,
    add(id, extra) { db.photos.push(Object.assign({ id, insp: 'insp1', blob: {}, state: 'pending', err: '' }, extra || {})); },
    advance(ms) { now += ms; for (const x of timers.filter(y => y.live && y.at <= now)) { x.live = false; x.fn(); } },
    async drain(n) { for (let i = 0; i < (n || 6); i++) { await this.settle(); this.advance(1000); } await this.settle(); },
    waitLeft() { return Math.round((sb.S.up.nextAt - sb.Date.now()) / 1000); },
    async settle() { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); },
    status() { const np = Object.keys(sb.photoState).filter(k => sb.photoState[k].state !== 'done').length; return vm.runInContext('photoStatusHtml(' + Math.max(np, 1) + ')', sb); },
    run(src) { return vm.runInContext(src, sb); },
  };
  return api;
}
const BUSY = { status: 429, body: { error: 'sheets_busy', busy: true, retry_after_seconds: 8, message: 'Google Sheets is busy' } };

// ── backoff curve ──
{
  const c = mk();
  t('backoff 5,10,20,40,60,60', [1, 2, 3, 4, 5, 9].map(n => c.run('photoBackoff(' + n + ')')).join() === '5,10,20,40,60,60');
}

// ── quota: photo stays queued, bar explains, retries by itself ──
{
  const c = mk(); c.add('ph_a'); c.add('ph_b');
  c.net.queue.push(BUSY);
  c.run('pumpPhotos()'); await c.drain(3);
  const rows = c.db.photos;
  t('quota failure does NOT mark the photo failed', rows.every(p => p.state === 'pending'), rows.map(p => p.state));
  t('loop stopped after the shared-cause failure (only 1 request made)', c.net.calls.length === 1, c.net.calls);
  const s = c.status();
  t('bar says Google is limiting + nothing is wrong + countdown + Retry now', /limiting/.test(s.txt) && /nothing is wrong/.test(s.txt) && /Retrying by itself in \d+s/.test(s.txt) && /Retry now/.test(s.act) && s.cls === 'work', s);
  t('wait honours the server retry_after (8s) plus a small extra', c.sb.S.up.nextAt - 1_000_000 >= 8000, c.sb.S.up.nextAt);
  // another part of the page pokes the uploader: must NOT bypass the wait
  c.run('pumpPhotos()'); await c.drain(3);
  t('a poke during the wait does not hit the server again', c.net.calls.length === 1, c.net.calls);
  // timer fires -> retries
  c.advance(60_000); await c.drain();
  t('after the wait it retried by itself and uploaded both', c.net.calls.length === 3 && c.db.photos.every(p => p.state === 'done'), { calls: c.net.calls.length, st: c.db.photos.map(p => p.state) });
  t('bar goes quiet once everything is uploaded (no waiting photos)', Object.keys(c.sb.photoState).length === 0);
}

// ── flaky network: growing waits, then failed + reported ──
{
  const c = mk(); c.add('ph_a');
  const waits = [];
  for (let i = 0; i < 10; i++) {
    c.net.queue.push({ status: 502, body: { ok: false, error: 'drive_upload', message: 'Drive did not accept the photo. Retry.' } });
    c.run('pumpPhotos(true)'); await c.settle();
    waits.push(c.waitLeft());
    if (c.db.photos[0].state === 'error') break;
    c.advance(c.waitLeft() * 1000);   // jump to the retry time
    c.run('1');
  }
  t('waits grew 5,10,20,40,60...', waits.slice(0, 5).join() === '5,10,20,40,60' || waits.slice(0, 4).join() === '5,10,20,40', waits);
  t('after 10 failed tries the photo is FAILED (not silently retried forever)', c.db.photos[0].state === 'error' && /Failed 10 times/.test(c.db.photos[0].err), c.db.photos[0]);
  t('the failure was reported to the failure log (4th try and final)', c.reports.length >= 1 && c.reports.every(r => r.x && r.x.photo_id === 'ph_a'), c.reports);
  const s = c.status();
  t('bar shows failed + the reason + Retry photos button', s.cls === 'err' && /failed/.test(s.txt) && /Drive did not accept/.test(s.txt) && /Retry photos/.test(s.act), s);
  // user taps Retry photos -> goes again
  c.net.queue.push({ status: 200, body: { ok: true } });
  c.run('retryPhotos()'); await c.drain();
  t('Retry photos clears the failure and uploads', c.db.photos[0].state === 'done', c.db.photos[0]);
}

// ── permanent errors fail immediately and loudly ──
{
  const c = mk(); c.add('ph_big'); c.add('ph_ok');
  c.net.queue.push({ status: 413, body: { ok: false, error: 'too_large', message: 'Photo is larger than 8 MB.' } });
  c.run('pumpPhotos()'); await c.drain(3);
  t('too-large photo is failed straight away with its reason', c.db.photos[0].state === 'error' && /8 MB/.test(c.db.photos[0].err), c.db.photos[0]);
  t('the next photo still uploads (one bad photo does not block the queue)', c.db.photos[1].state === 'done', c.db.photos[1]);
  t('and it was reported', c.reports.length === 1, c.reports);
}

// ── network drop (fetch throws) and hang (timeout) ──
{
  const c = mk(); c.add('ph_a');
  c.net.queue.push('throw');
  c.run('pumpPhotos()'); await c.settle();
  t('no connection -> stays queued, says so, retries in 5s', c.db.photos[0].state === 'pending' && /no connection/.test(c.status().txt) && c.waitLeft() === 5, c.status());
  c.advance(5000); await c.drain();
  t('retry after the wait succeeds', c.db.photos[0].state === 'done', c.db.photos[0]);

  const h = mk(); h.add('ph_h');
  h.net.queue.push('hang');
  const pump = h.run('pumpPhotos()');
  await h.settle();
  t('while a request is in flight the bar names the photo number', /Uploading photo 1 of 1/.test(h.status().txt) || h.sb.S.up.sendingId === 'ph_h', h.status());
  h.advance(75_000);                  // the timeout fires -> abort
  await pump; await h.settle();
  t('timeout message names the wait', /did not answer in 75s/.test(h.status().txt), h.status());
  t('hung request ends as a visible retry, not a stuck uploader', h.sb.S.pumping === false && h.db.photos[0].state === 'pending' && h.sb.S.up.nextAt > 0, { pumping: h.sb.S.pumping, st: h.db.photos[0].state });
}

// ── offline / not yet saved ──
{
  const c = mk(); c.add('ph_a'); c.sb.navigator.onLine = false;
  c.run('pumpPhotos()'); await c.drain(3);
  t('offline: no request, bar says it uploads by itself when signal returns', c.net.calls.length === 0 && /offline/.test(c.status().txt), c.status());
  const d = mk(); d.add('ph_a'); delete d.db.docs.insp1;
  d.run('pumpPhotos()'); await d.drain(3);
  t('inspection not saved yet: waits, no request, tells why', d.net.calls.length === 0 && /finish saving/.test(d.status().txt), d.status());
  const e = mk(); e.add('ph_a'); e.net.queue.push({ status: 409, body: { ok: false, error: 'inspection_not_saved', message: 'Save the inspection to the server first' } });
  e.run('pumpPhotos()'); await e.drain(3);
  t('server says not saved: photo stays queued (not failed), inspection marked dirty', e.db.photos[0].state === 'pending' && e.sb.S.rec.dirty === true, e.db.photos[0]);
}

// ── progress ──
{
  const c = mk(); c.add('ph_1'); c.add('ph_2'); c.add('ph_3');
  const seen = [];
  const orig = c.sb.setSync; c.sb.setSync = () => { if (c.sb.S.up.sendingId) seen.push(c.status().txt); };
  c.run('1'); // keep sandbox alive
  c.sb.photoState = {};
  c.run('pumpPhotos()'); await c.drain(8);
  t('all three uploaded', c.db.photos.every(p => p.state === 'done'), c.db.photos.map(p => p.state));
  t('progress said "photo 1 of 3" ... "photo 3 of 3"', seen.some(x => /photo 1 of 3/.test(x)) && seen.some(x => /photo 3 of 3/.test(x)), seen);
  void orig;
}

console.log(`fi-photo-uploader-client: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
