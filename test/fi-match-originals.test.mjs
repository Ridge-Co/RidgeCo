// Nov 2 2026 - Field Inspection: attach full-size ORIGINALS to photos that were uploaded BEFORE the original-upload build (Brett: "re-uploading the photos for the previous
// inspections is a major setback"). The originals are still in his phone's gallery; the page matches each pick to the stored 1600 px copy by an image fingerprint.
// Pins (runs the REAL code out of field-inspect.html):
//   - the fingerprint matcher, on fingerprints made by REAL Chromium from 94 natural pictures (original vs the page's own 1600 px / JPEG 0.82 copy): same picture <= 8 of 256 bits
//     apart, unrelated pictures >= 69 apart; thousands of random inspections: ZERO originals attached to a wrong photo; near-identical shots are left alone (listed), never guessed
//   - the matcher takes certain pairs out in rounds (which settles picks that were only unsure because of them) and never pairs one photo twice
//   - the flow: only photos WITHOUT an original are offered, ones already uploading are skipped, picks from other jobs are ignored, originals are queued 'late' (no local standard row)
//     and fed in a few at a time, anything unmatched / unreadable / unloadable is LISTED and reported (nothing silent)
//   - the uploader: a 'late' original with no local standard copy is sent (a normal one without its photo is still dropped); rows queued while a pass is running are not forgotten
//   - the UI hooks exist: the card on the Review screen, the single-photo button in the photo viewer, the file input
// Real-browser end-to-end (real page + real worker code, byte-for-byte check): OM_IMG_DIR=<folder of jpgs> node test/manual-verify-fi-match-originals.mjs
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/fi-match-hashes.json', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };

const pa = html.indexOf('// ORIG-MATCH-PURE-START'), pb = html.indexOf('// ORIG-MATCH-PURE-END');
if (pa < 0 || pb < pa) { console.log('FAIL: pure matcher block missing'); process.exit(1); }
const M = new vm.Script(html.slice(pa, pb) + '\n({ omMatch, omDist, omGrayToHex, omBitsToHex, OM_MAX_DIST, OM_MARGIN })').runInNewContext({});

// ── 1. the fingerprint maths ──
{
  t('distance of a fingerprint to itself is 0, to its inverse is 256', M.omDist('ab'.repeat(32), 'ab'.repeat(32)) === 0 && M.omDist('0'.repeat(64), 'f'.repeat(64)) === 256);
  t('different lengths / empty never count as a match', M.omDist('ab', 'abcd') > 256 && M.omDist('', 'ab') > 256 && M.omDist(null, 'ab') > 256);
  const flat = new Array(17 * 16).fill(100); t('a flat picture gives 256 bits of zeros (64 hex chars)', M.omGrayToHex(flat) === '0'.repeat(64), M.omGrayToHex(flat));
  const ramp = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 17; x++) ramp.push(200 - x * 10);
  t('a left-to-right fade gives all ones', M.omGrayToHex(ramp) === 'f'.repeat(64));
  const d = (a, b) => M.omDist(a, b);
  const same = fixture.map(r => d(r.ho, r.hs));
  t('REAL Chromium: every original is within 8 bits of its own 1600 px copy', Math.max.apply(null, same) <= 8, Math.max.apply(null, same));
  const base = (n) => { const b = n.replace(/\.jpg$/, '').split('__')[0]; return b === 'cat' ? 'chelsea' : b; };   // cat.jpg and chelsea.jpg are the same picture
  let minUn = 999; for (const r of fixture) for (const q of fixture) if (base(r.n) !== base(q.n)) minUn = Math.min(minUn, d(r.ho, q.hs));
  t('REAL Chromium: unrelated pictures are at least 60 bits apart (limit is ' + M.OM_MAX_DIST + ')', minUn >= 60 && minUn > M.OM_MAX_DIST + 12, minUn);
}
// ── 2. matching on the real fingerprints: never wrong ──
{
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rows = fixture.filter(r => !/__b2/.test(r.n) && r.n !== 'chelsea.jpg' && !/^chelsea__/.test(r.n));     // brightness-only copies fingerprint identically: tested separately below
  let wrong = 0, right = 0, unsure = 0, runs = 0, lostHere = 0, dupPair = 0;
  for (let k = 0; k < 400; k++) {
    const sh = rows.slice().sort(() => rnd() - 0.5), n = 8 + Math.floor(rnd() * 35);
    const here = sh.slice(0, n), picks = here.concat(sh.slice(n, n + Math.floor(rnd() * 30))).sort(() => rnd() - 0.5);
    const m = M.omMatch(here.map(r => ({ id: r.n, h: r.hs })), picks.map(r => ({ key: r.n, h: r.ho })));
    runs++; const seenS = {}, seenP = {};
    m.pairs.forEach(p => { if (p.key === p.id) right++; else wrong++; if (seenS[p.id] || seenP[p.key]) dupPair++; seenS[p.id] = seenP[p.key] = 1; });
    unsure += m.unsure.length;
    const inSet = new Set(here.map(r => r.n)); m.noMatch.forEach(key => { if (inSet.has(key)) lostHere++; });
  }
  t('400 random inspections (' + right + ' attachments): NOT ONE original attached to a wrong photo', wrong === 0 && right > 6000, { right, wrong });
  t('no photo and no picture is ever used twice', dupPair === 0, dupPair);
  t('an original that belongs here is never reported as "matched nothing" (it is matched or listed as not sure)', lostHere === 0, lostHere);
  t('realistic near-identical shots are mostly still resolved (not-sure stays a small fraction)', unsure / right < 0.06, { unsure, right });
  // brightness-only copies are the SAME picture to any fingerprint: both must be left alone, never swapped
  const a = fixture.find(r => r.n === 'coffee.jpg'), b = fixture.find(r => r.n === 'coffee__b2.jpg');
  const m = M.omMatch([{ id: 'A', h: a.hs }, { id: 'B', h: b.hs }], [{ key: 'pa', h: a.ho }, { key: 'pb', h: b.ho }]);
  t('two shots that differ only in brightness: NOT guessed, both listed as not sure', m.pairs.length === 0 && m.unsure.length === 2, m);
  // one clear photo + one identical pair
  const c = fixture.find(r => r.n === 'brick.jpg');
  const m2 = M.omMatch([{ id: 'A', h: a.hs }, { id: 'B', h: b.hs }, { id: 'C', h: c.hs }], [{ key: 'pa', h: a.ho }, { key: 'pb', h: b.ho }, { key: 'pc', h: c.ho }]);
  t('...while the clear photo next to them is still attached', m2.pairs.length === 1 && m2.pairs[0].key === 'pc' && m2.pairs[0].id === 'C' && m2.unsure.length === 2, m2);
  // rounds: X is clear; Y' is only unsure because of X's twin - once X is taken it resolves
  const x = fixture.find(r => r.n === 'astronaut.jpg'), xs = fixture.find(r => r.n === 'astronaut__b1.jpg'), z = fixture.find(r => r.n === 'moon.jpg');
  const m3 = M.omMatch([{ id: 'X', h: x.hs }, { id: 'Z', h: z.hs }], [{ key: 'px', h: x.ho }, { key: 'pz', h: z.ho }, { key: 'pxs', h: xs.ho }]);
  t('a pick with no stored photo left is "matched nothing", not forced onto a taken photo', m3.pairs.length === 2 && m3.pairs.every(p => p.key === 'p' + p.id.toLowerCase()), m3);
  t('empty inputs are fine', M.omMatch([], []).pairs.length === 0 && M.omMatch([{ id: 'a', h: a.hs }], []).unmatchedStored[0] === 'a' && M.omMatch([], [{ key: 'k', h: a.ho }]).noMatch[0] === 'k');
  t('a stored photo with no pick stays in unmatchedStored', M.omMatch([{ id: 'A', h: a.hs }, { id: 'C', h: c.hs }], [{ key: 'pa', h: a.ho }]).unmatchedStored.join() === 'C');
}
// ── 3. the flow, with the browser pieces faked ──
const fa = html.indexOf('// ── attach full-size originals to EARLIER photos'), fb = html.indexOf('// ── photo uploader ─');
if (fa < 0 || fb < fa) { console.log('FAIL: flow block missing'); process.exit(1); }
function mkFlow() {
  const log = { toasts: [], reports: [], queued: [], api: [], fetches: [], sheets: [], timers: [] };
  const db = { photos: [] };
  const els = { 'om-box': null, 'orig-in': { value: '', click() { log.clicked = (log.clicked || 0) + 1; }, addEventListener(ev, fn) { this.onchange = fn; } } };
  let box = null;
  const sb = {
    console, Math, Object, Promise, Number, String, JSON, Array, Error, Date, parseInt, isNaN, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    WORKER: 'https://w', esc: (x) => String(x == null ? '' : x),
    S: { rec: { id: 'insp1', token: 'TOK123', base_rev: 4 } },
    $: (id) => (id === 'om-box' ? box : els[id]),
    openSheet(h) { box = { innerHTML: '', _first: h }; sb.__html = h; },
    closeSheet() { box = null; },
    toast(m) { log.toasts.push(m); },
    reportPhoto(w, m, id) { log.reports.push({ w, m, id }); },
    pumpPhotos() { log.pumps = (log.pumps || 0) + 1; return Promise.resolve(); },
    dbAll: async () => db.photos.slice(),
    api: async (method, path) => { log.api.push(method + ' ' + path); if (sb.__apiFail) throw new Error(sb.__apiFail); return sb.__report; },
    queueOriginal: async (rec, id, file, opts) => { log.queued.push({ id, name: file.name, late: !!(opts && opts.late) }); if (sb.__queueFail) return false; db.photos.push({ id: id + '__o', photo_id: id, kind: 'orig', state: 'pending', blob: {} }); return true; },
    fetch: async (url) => { log.fetches.push(url); const id = new URL(url).searchParams.get('p'); if (sb.__fetchFail && sb.__fetchFail[id]) return { ok: false, status: 502 }; return { ok: true, blob: async () => ({ id }) }; },
    setTimeout: (fn, ms) => { log.timers.push(ms); return setTimeout(fn, 0); },
  };
  vm.createContext(sb); vm.runInContext(html.slice(fa, fb), sb);
  // the REAL omHashBlob needs a canvas: replace it by "the fingerprint travels on the object" (the maths above is tested on real Chromium output)
  vm.runInContext('omHashBlob = function(b){ return b.h ? Promise.resolve(b.h) : (b.fail ? Promise.reject(new Error(b.fail)) : Promise.resolve(HASH[b.id])); };', sb);
  sb.HASH = {};
  return { sb, log, db, getBox: () => box, htmlNow: () => (box ? box.innerHTML : '') };
}
const idsOf = (names) => names.map(n => 'ph_' + n.replace(/\.jpg$/, ''));
{
  const f = mkFlow(); const names = ['astronaut.jpg', 'coffee.jpg', 'brick.jpg', 'moon.jpg', 'rocket.jpg', 'gravel.jpg'], H = (n) => fixture.find(r => r.n === n);
  names.forEach(n => { f.sb.HASH['ph_' + n.replace('.jpg', '')] = H(n).hs; });
  f.sb.__report = { photo_ids: idsOf(names), photo_full: { ph_astronaut: 123456 } };       // astronaut already has its original
  f.db.photos.push({ id: 'ph_coffee__o', photo_id: 'ph_coffee', kind: 'orig', state: 'pending', blob: {} });   // coffee's original is already uploading from this phone
  f.sb.omOpen();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  const O = f.sb.OM;
  t('opening asks the server which photos have an original (admin report), not the phone', f.log.api.join() === 'GET /fi/report?r=TOK123', f.log.api);
  t('only photos WITHOUT an original, and not already uploading one, are offered', O.todo.join() === 'ph_brick,ph_moon,ph_rocket,ph_gravel' && O.phase === 'pick' && O.total === 6, O);
  t('the sheet says how many and shows the choose button', /Choose photos from my phone/.test(f.htmlNow()) && />4</.test(f.htmlNow().replace(/<\/?b>/g, '>')) || /<b>4<\/b>/.test(f.htmlNow()), f.htmlNow().slice(0, 300));

  // picks: moon, brick, rocket (in a different order), one from another job, one that cannot be read, a duplicate of brick, one that is a near twin of nothing
  const mk = (n, extra) => Object.assign({ name: n, size: 5e6, lastModified: 1, h: H(n).ho }, extra || {});
  const picks = [mk('rocket.jpg'), mk('brick.jpg'), mk('china.jpg'), { name: 'broken.heic', size: 9e6, lastModified: 2, fail: 'could not be read (image/heic)' }, mk('moon.jpg'), mk('brick.jpg')];
  await f.sb.omRun(picks);
  const res = f.sb.OM.result;
  t('three originals were matched and queued as LATE rows (no local standard copy needed)', res.pairs === 3 && f.log.queued.length === 3 && f.log.queued.every(q => q.late), { res, q: f.log.queued });
  t('each went to its own photo', f.log.queued.map(q => q.name + '>' + q.id).sort().join() === 'brick.jpg>ph_brick,moon.jpg>ph_moon,rocket.jpg>ph_rocket', f.log.queued);
  t('the same picture chosen twice is counted once', res.dup === 1, res);
  t('the picture from another job is listed as matching nothing', res.noMatch.length === 1 && f.sb.OM.names[res.noMatch[0]] === 'china.jpg', res);
  t('the unreadable picture is LISTED with its reason (not skipped silently)', res.readFail.length === 1 && /broken\.heic/.test(res.readFail[0].name) && /heic/.test(res.readFail[0].err), res);
  t('the photo nobody picked is reported as still standard-size', res.left === 1 && f.sb.OM.todo.join() === 'ph_gravel', res);
  const view = f.htmlNow() || '';
  t('the result sheet is shown when the sheet is open', view === '' || /matched and/.test(view), view.slice(0, 200));
  t('uploads are poked after queueing', (f.log.pumps || 0) >= 3);
  t('a toast says how many are uploading', f.log.toasts.some(m => /3 originals matched/.test(m)), f.log.toasts);
  // the stored photos were read from the report token's photo route (what the phone can read), not from Drive
  t('stored copies are read through the report photo route', f.log.fetches.length >= 4 && f.log.fetches.every(u => u.startsWith('https://w/fi/photo/view?r=TOK123&p=')), f.log.fetches);
}
{ // stored photos that cannot be loaded are reported, and nothing is matched against a hole
  const f = mkFlow(); const H = (n) => fixture.find(r => r.n === n);
  f.sb.HASH = { ph_a: H('brick.jpg').hs, ph_b: H('moon.jpg').hs };
  f.sb.__report = { photo_ids: ['ph_a', 'ph_b'], photo_full: {} }; f.sb.omOpen(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  f.sb.__fetchFail = { ph_b: 1 };
  await f.sb.omRun([{ name: 'brick.jpg', size: 1, lastModified: 1, h: H('brick.jpg').ho }, { name: 'moon.jpg', size: 1, lastModified: 2, h: H('moon.jpg').ho }]);
  const r = f.sb.OM.result;
  t('one stored photo could not be loaded: the other still matches, the failure is listed and reported to the Hub', r.pairs === 1 && r.loadFail.length === 1 && f.log.reports.some(x => /could not be loaded to compare/.test(x.m)), { r, rep: f.log.reports });
  t('the one it could not read is still counted as missing its original', r.left === 1 && f.sb.OM.todo.join() === 'ph_b', r);
}
{ // the server cannot be asked: visible error + reported
  const f = mkFlow(); f.sb.__apiFail = 'HTTP 500'; f.sb.omOpen(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  t('report lookup failure: the sheet shows it and offers Try again; reported', f.sb.OM.phase === 'error' && /HTTP 500/.test(f.htmlNow()) && /Try again/.test(f.htmlNow()) && f.log.reports.length === 1, [f.sb.OM, f.log.reports]);
}
{ // nothing missing
  const f = mkFlow(); f.sb.__report = { photo_ids: ['a', 'b'], photo_full: { a: 1, b: 2 } }; f.sb.omOpen(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  t('every photo already has its original: says so, offers nothing to pick', f.sb.OM.phase === 'none' && /already has its full-size original/.test(f.htmlNow()) && !/Choose photos/.test(f.htmlNow()), f.htmlNow());
}
{ // an inspection that is not saved yet cannot be matched
  const f = mkFlow(); f.sb.S.rec.token = ''; f.sb.omOpen();
  t('unsaved inspection: told to save first, no request made', f.log.toasts.some(m => /Save the inspection/.test(m)) && f.log.api.length === 0, f.log);
  t('and the card button is disabled until saved', /id="om-open"[^>]*disabled/.test(f.sb.omCard()));
}
{ // queueing is throttled: only a few multi-MB originals wait on the phone at once
  const f = mkFlow(); const H = (n) => fixture.find(r => r.n === n), names = ['astronaut.jpg', 'coffee.jpg', 'brick.jpg', 'moon.jpg', 'rocket.jpg', 'gravel.jpg', 'grass.jpg', 'page.jpg', 'text.jpg', 'retina.jpg'];
  names.forEach(n => { f.sb.HASH['ph_' + n.replace('.jpg', '')] = H(n).hs; });
  f.sb.__report = { photo_ids: idsOf(names), photo_full: {} }; f.sb.omOpen(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  // the fake uploader frees one queued row per poke after the 8th
  let freed = 0; const origPump = f.sb.pumpPhotos; f.sb.pumpPhotos = function () { f.log.pumps = (f.log.pumps || 0) + 1; const pend = f.db.photos.filter(p => p.state !== 'done'); if (pend.length) { pend[0].state = 'done'; delete pend[0].blob; freed++; } return Promise.resolve(); };
  let maxWaiting = 0; const dbAll0 = f.sb.dbAll; f.sb.dbAll = async () => { const rows = await dbAll0(); maxWaiting = Math.max(maxWaiting, rows.filter(p => p.kind === 'orig' && p.state !== 'done' && p.blob).length); return rows; };
  await f.sb.omRun(names.map(n => ({ name: n, size: 1, lastModified: 1, h: H(n).ho })));
  t('all 10 matched and queued', f.sb.OM.result.pairs === 10 && f.log.queued.length === 10, f.sb.OM.result);
  t('never more than ' + 6 + ' originals waiting on the phone at once', maxWaiting <= 6, maxWaiting);
}
{ // an original that cannot be kept on the phone is counted and shown
  const f = mkFlow(); const H = (n) => fixture.find(r => r.n === n); f.sb.HASH = { ph_a: H('brick.jpg').hs }; f.sb.__report = { photo_ids: ['ph_a'], photo_full: {} };
  f.sb.omOpen(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); f.sb.__queueFail = true;
  await f.sb.omRun([{ name: 'brick.jpg', size: 1, lastModified: 1, h: H('brick.jpg').ho }]);
  t('queue failure: 0 attached, 1 shown as could-not-keep, the photo is still listed as missing its original', f.sb.OM.result.pairs === 0 && f.sb.OM.result.queueFail === 1 && f.sb.OM.result.left === 1, f.sb.OM.result);
}

// ── 4. the uploader: late rows, and rows queued while a pass is running ──
const ua = html.indexOf('// ── photo uploader ─'), ub = html.indexOf('// ── model ─');
function mkUp() {
  const timers = []; let now = 1_000_000; const db = { photos: [], docs: { insp1: { base_rev: 3 } } }; const net = { reqs: [], hold: null };
  const sb = {
    console, Date: { now: () => now }, Math, Object, Promise, Number, String, JSON, Array, RegExp, Error, WORKER: 'https://w', AUTH_TOKEN: 'tok',
    S: { pumping: false, photoMsg: '', view: 'home', rec: { id: 'insp1', dirty: false }, sync: {} }, photoState: {}, esc: (x) => String(x), navigator: { onLine: true },
    setSync() {}, safeRender() {}, scheduleSync() {}, toast() {}, window: { hubReportFailure() {}, AbortController: null }, AbortController: null,
    dbAll: async () => db.photos.map(p => p), dbGet: async (st, id) => db.docs[id],
    dbPut: async (st, p) => { const i = db.photos.findIndex(x => x.id === p.id); if (i >= 0) db.photos[i] = p; else db.photos.push(p); },
    dbDel: async (st, id) => { const i = db.photos.findIndex(x => x.id === id); if (i >= 0) db.photos.splice(i, 1); },
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: now + ms, live: true }); return id; }, clearTimeout: (id) => { const x = timers.find(y => y.id === id); if (x) x.live = false; }, setInterval: () => 9, clearInterval() {},
    fetch: (url, opts) => { net.reqs.push(url); const done = () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }); return net.hold ? net.hold.then(done) : Promise.resolve(done()); },
  };
  vm.createContext(sb); vm.runInContext(html.slice(ua, ub), sb);
  return { sb, db, net, advance(ms) { now += ms; for (const x of timers.filter(y => y.live && y.at <= now)) { x.live = false; x.fn(); } }, async settle() { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); }, async drain(n) { for (let i = 0; i < (n || 6); i++) { await this.settle(); this.advance(1000); } await this.settle(); } };
}
const kinds = (c) => c.net.reqs.map(u => { const x = new URL(u); return x.searchParams.get('photo_id') + (x.searchParams.get('kind') ? ':orig' : ':std'); });
{
  const c = mkUp(); // a 'late' original: its standard copy was uploaded months ago and is not on this phone
  c.db.photos.push({ id: 'ph_old__o', photo_id: 'ph_old', kind: 'orig', insp: 'insp1', blob: { x: 1 }, mime: 'image/jpeg', state: 'pending', err: '', late: true });
  c.sb.pumpPhotos(); await c.drain();
  t('a late original with no local standard row IS sent', kinds(c).join() === 'ph_old:orig', kinds(c));
  t('and its phone copy is freed once the server has it', c.db.photos[0].state === 'done' && !c.db.photos[0].blob, c.db.photos);
}
{
  const c = mkUp(); // an ordinary original whose photo was removed is still dropped (existing behaviour)
  c.db.photos.push({ id: 'ph_gone__o', photo_id: 'ph_gone', kind: 'orig', insp: 'insp1', blob: { x: 1 }, mime: 'image/jpeg', state: 'pending', err: '' });
  c.sb.pumpPhotos(); await c.drain();
  t('a normal original whose photo is gone is dropped, not sent', c.net.reqs.length === 0 && c.db.photos.length === 0, [c.net.reqs, c.db.photos]);
}
{
  const c = mkUp(); // rows queued while a pass is running used to be forgotten until something else poked the uploader
  const row = (id) => ({ id: id + '__o', photo_id: id, kind: 'orig', insp: 'insp1', blob: { x: id }, mime: 'image/jpeg', state: 'pending', err: '', late: true });
  c.db.photos.push(row('ph_1'));
  let release; c.net.hold = new Promise(r => { release = r; });
  c.sb.pumpPhotos(); await c.settle();                       // pass 1 is mid-upload of ph_1
  c.db.photos.push(row('ph_2')); c.db.photos.push(row('ph_3'));
  c.sb.pumpPhotos();                                         // the page pokes the uploader again: a pass is running
  t('poking a running pass does not start a second one', kinds(c).length === 1, kinds(c));
  release(); c.net.hold = null; await c.drain(12);
  t('...but the rows queued meanwhile are uploaded by the follow-up pass, with no other trigger', kinds(c).join() === 'ph_1:orig,ph_2:orig,ph_3:orig', kinds(c));
}

// ── 5. the UI hooks ──
{
  t('the Review screen has the card (before "Before you publish")', html.indexOf('h += omCard();') > 0 && html.indexOf('h += omCard();') < html.indexOf("<b>Before you publish</b>"));
  t('the photo viewer has the single-photo button', /omAttachOne\(\\''\+id\+'\\'\)">Attach full-size original/.test(html));
  t('the file input exists and is hidden like the photo input', /<input type="file" id="orig-in" accept="image\/\*" multiple class="hide">/.test(html));
  t('the flow queues with late:true and nothing in it swallows a failure silently', /queueOriginal\(rec, q\.id, fileByKey\[q\.key\], \{ late:true \}\)/.test(html) && !/catch\(function\(\)\{\s*\}\)|catch\(function\(e\)\{\s*\}\)|catch\(\(\)\s*=>\s*\{\s*\}\)/.test(html.slice(fa, fb)));
  t('the card says what it does in plain words', /Attach full-size originals…/.test(html) && /attaches each one to the right photo by itself/.test(html));
}
console.log(`fi-match-originals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
