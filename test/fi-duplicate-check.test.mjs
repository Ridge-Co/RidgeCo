// Nov 2 2026 (Brett): "make the hub field inspection check for duplicates giving me exact locations where they exist in that inspection draft so that i can remove them in the future.
// check file names and sizes not a byte for byte check. flag issues with no photos but let them proceed." + "the '19 problems' indicator is appearing on the pdf printout ... that
// shouldn't ever appear on any output document."
// Pins:
//   - dupCheck (the REAL code out of field-inspect.html): finds copies by file name + size and, for older photos, by stored size; lists every location (area photos / equipment / issue)
//     of every copy; the copy used in most places is the one to keep; the same photo in an area's gallery AND in an issue is NOT a duplicate; two photos whose ORIGINALS differ in size are
//     not merged; excluded areas are ignored; issues with no photos are listed
//   - the Review screen only WARNS (never a block), new photos remember name + size, and a failed size read is shown + reported (not silent)
//   - the Hub side: /fi/photo-sizes returns sizes for one inspection only; the doc validator accepts a sane photo_meta and refuses junk; the public report never carries photo_meta
//   - the "N problems" badge: hidden by a print stylesheet on every page that loads failure-reporter.js, and not drawn at all on the customer report pages
import fs from 'fs';
import vm from 'vm';
import { world } from './_fi-world.mjs';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const reporterSrc = fs.readFileSync(new URL('../failure-reporter.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 500) : ''); } };

const pa = html.indexOf('// DUP-CHECK-PURE-START'), pb = html.indexOf('// DUP-CHECK-PURE-END');
if (pa < 0 || pb < pa) { console.log('FAIL: pure duplicate-check block missing'); process.exit(1); }
const D = new vm.Script(html.slice(pa, pb) + '\n({ dupCheck, dupKb })').runInNewContext({});
const clone = (x) => JSON.parse(JSON.stringify(x));

// Gilmor-shaped draft: two copies of one shot in the Basement (both in the gallery AND in an issue), a twin in another room, plus unrelated photos
const doc = {
  v: 1, areas: [
    { id: 'a_hvac', name: 'Heating / HVAC', photo_ids: ['ph_h1', 'ph_h2', 'ph_x'], issues: [{ id: 'i1', title: 'Furnace Flue', photo_ids: ['ph_h2'] }, { id: 'i2', title: 'No pictures here', photo_ids: [] }] },
    { id: 'a_base', name: 'Basement', photo_ids: ['ph_b1', 'ph_b2'], issues: [{ id: 'i3', title: 'Condensation on Ductwork', photo_ids: ['ph_b1', 'ph_b2'] }] },
    { id: 'a_kit', name: 'Kitchen', photo_ids: ['ph_k1'], equipment: [{ id: 'e1', kind: 'furnace', photo_ids: ['ph_b2'] }] },
    { id: 'a_gone', name: 'Excluded room', excluded: true, photo_ids: ['ph_h1'], issues: [{ id: 'i9', title: 'Hidden', photo_ids: [] }] },
  ],
};
const sizes = { ph_h1: { b: 191459, o: 0 }, ph_h2: { b: 191459, o: 0 }, ph_x: { b: 5000, o: 0 }, ph_b1: { b: 212204, o: 654135 }, ph_b2: { b: 212204, o: 654135 }, ph_k1: { b: 99999, o: 1 } };

// ── 1. finding duplicates by stored size ──
{
  const r = D.dupCheck(clone(doc), sizes);
  t('two sets found (HVAC pair, Basement pair); the unrelated photos are not flagged', r.sets.length === 2, r.sets.map(s => s.copies.map(c => c.id)));
  const hv = r.sets.find(s => s.copies.some(c => c.id === 'ph_h1')), bs = r.sets.find(s => s.copies.some(c => c.id === 'ph_b1'));
  t('HVAC pair: the copy used in an issue is listed first (keep), the gallery-only copy second', hv && hv.copies[0].id === 'ph_h2' && hv.copies[1].id === 'ph_h1', hv && hv.copies.map(c => c.id));
  t('every location of every copy is listed with its area id and name', hv.copies[0].locs.length === 2 && hv.copies[0].locs.some(l => l.where === 'issue: Furnace Flue' && l.area === 'Heating / HVAC' && l.areaId === 'a_hvac') && hv.copies[0].locs.some(l => l.where === 'area photos'), hv.copies[0].locs);
  t('the excluded room is ignored (its use of ph_h1 is not a location)', hv.copies[1].locs.length === 1 && hv.copies[1].locs[0].area === 'Heating / HVAC', hv.copies[1].locs);
  t('Basement pair: equipment locations are named too', bs.copies.find(c => c.id === 'ph_b2').locs.some(l => /^equipment: /.test(l.where) && l.area === 'Kitchen'), bs.copies.map(c => c.locs));
  t('extra copies = 2 (one per set)', r.extra === 2, r.extra);
  t('the same photo in a gallery AND an issue of one area is not, by itself, a duplicate', D.dupCheck({ v: 1, areas: [{ id: 'a', name: 'A', photo_ids: ['ph_only'], issues: [{ id: 'i', title: 'T', photo_ids: ['ph_only'] }] }] }, { ph_only: { b: 10, o: 0 } }).sets.length === 0);
}
// ── 2. file name + size ──
{
  const d2 = clone(doc); d2.photo_meta = { ph_x: { n: 'IMG_20261015_130954.jpg', s: 4100000 }, ph_k1: { n: 'img_20261015_130954.JPG', s: 4100000 } };
  const r = D.dupCheck(d2, sizes);
  const st = r.sets.find(s => s.copies.some(c => c.id === 'ph_x'));
  t('same file name (any case) + same size is a duplicate even though the stored sizes differ', st && st.copies.length === 2 && st.copies.some(c => c.id === 'ph_k1'), r.sets.map(s => s.copies.map(c => c.id)));
  t('the file name and size are shown', st && st.name.toLowerCase() === 'img_20261015_130954.jpg' && st.size === 4100000 && /MB/.test(D.dupKb(st.size)), st);
  const d3 = clone(doc); d3.photo_meta = { ph_x: { n: 'IMG_1.jpg', s: 10 }, ph_k1: { n: 'IMG_1.jpg', s: 11 } };
  t('same name but different size is NOT a duplicate', !D.dupCheck(d3, sizes).sets.some(s => s.copies.some(c => c.id === 'ph_x')));
  t('different names, different stored sizes: nothing flagged', D.dupCheck({ v: 1, areas: [{ id: 'a', name: 'A', photo_ids: ['ph_1', 'ph_2'] }] }, { ph_1: { b: 1000, o: 0 }, ph_2: { b: 1001, o: 0 } }).sets.length === 0);
}
// ── 3. originals that differ keep two same-sized stored photos apart ──
{
  const d = { v: 1, areas: [{ id: 'a', name: 'A', photo_ids: ['ph_1', 'ph_2', 'ph_3'] }] };
  const sets = (sz) => D.dupCheck(d, sz).sets.map(s => s.copies.map(c => c.id).sort().join('+'));
  t('same stored size but originals of different sizes are different pictures', sets({ ph_1: { b: 5000, o: 800000 }, ph_2: { b: 5000, o: 900000 }, ph_3: { b: 1, o: 0 } }).length === 0);
  t('a photo with no original yet still matches ONE that has one', sets({ ph_1: { b: 5000, o: 800000 }, ph_2: { b: 1, o: 0 }, ph_3: { b: 5000, o: 0 } }).join() === 'ph_1+ph_3');
  t('with two different originals in play, a photo with no original is left alone (not guessed)', sets({ ph_1: { b: 5000, o: 800000 }, ph_2: { b: 5000, o: 900000 }, ph_3: { b: 5000, o: 0 } }).length === 0);
  t('same stored size and same original size is a duplicate', sets({ ph_1: { b: 5000, o: 800000 }, ph_2: { b: 5000, o: 800000 }, ph_3: { b: 1, o: 0 } }).join() === 'ph_1+ph_2');
}
// ── 4. issues with no photos ──
{
  const r = D.dupCheck(clone(doc), sizes);
  t('an issue with no photos is listed with its area; issues with photos are not; excluded areas are skipped', r.noPhoto.length === 1 && r.noPhoto[0].title === 'No pictures here' && r.noPhoto[0].area === 'Heating / HVAC' && r.noPhoto[0].areaId === 'a_hvac', r.noPhoto);
  t('no sizes at all (not loaded yet): no crash, no sets, issues still listed', (() => { const x = D.dupCheck(clone(doc), {}); return x.sets.length === 0 && x.noPhoto.length === 1; })());
  t('an empty draft is fine', (() => { const x = D.dupCheck({ v: 1, areas: [] }, {}); return !x.sets.length && !x.noPhoto.length && x.extra === 0; })());
}
// ── 5. the Review screen: warns, never blocks; remembers name + size; a failed read is not silent ──
{
  const lc = html.slice(html.indexOf('function localChecks(doc){'), html.indexOf('function rollup(doc){'));
  t('duplicates and photo-less issues are WARNINGS (warns.push), never blocks', /warns\.push\(dc\.extra\+/.test(lc) && /warns\.push\(npw\)/.test(lc) && !/blocks\.push\([^)]*(dupl|no photos)/i.test(lc), lc.slice(-600));
  t('the Review screen shows the Duplicate photos card', /h \+= dupCard\(doc\);/.test(html));
  t('each location links to its area', /openArea\(\\''\+esc\(l\.areaId\)/.test(html));
  t('a photo added from the phone remembers its file name and size', /doc\.photo_meta = doc\.photo_meta\|\|\{\}\)\[id\] = \{ n:String\(f\.name\)\.slice\(0,80\), s:f\.size \}/.test(html));
  t('a failed size read is shown on the screen AND reported to the failure ledger', /Could not read the stored photo sizes \('\+esc\(c\.err\)/.test(html) && /reportPhoto\('field-inspect duplicate check'/.test(html));
  t('the size fetch does not loop: one fetch per saved version', /c\.loading \|\| c\.rev === rec\.base_rev/.test(html));
}
// ── 6. the Hub side ──
{
  const w = world();
  w.h.tabs.FI_Photos = { headers: ['ID', 'Inspection_ID', 'Drive_File_ID', 'Mime', 'Bytes', 'Created_At', 'Active', 'Orig_Drive_File_ID', 'Orig_Mime', 'Orig_Bytes', 'Orig_At'], rows: [
    ['ph_aaaaaa1', 'TEST-insp_001', 'd1', 'image/jpeg', '1234', 'n', 'TRUE', 'o1', 'image/jpeg', '99999', 'n'],
    ['ph_aaaaaa2', 'TEST-insp_001', 'd2', 'image/jpeg', '5678', 'n', 'TRUE', '', '', '', ''],
    ['ph_aaaaaa3', 'TEST-insp_001', 'd3', 'image/jpeg', '4444', 'n', 'FALSE', '', '', '', ''],
    ['ph_bbbbbb1', 'TEST-insp_002', 'd4', 'image/jpeg', '7777', 'n', 'TRUE', '', '', '', ''],
  ] };
  let r = await w.fiPhotoSizes(w.env, new URL('https://x/fi/photo-sizes?id=TEST-insp_001'));
  let j = r.body !== undefined ? r.body : await r.json();
  t('/fi/photo-sizes returns stored + original sizes of the live photos of ONE inspection', j.ok && Object.keys(j.photos).length === 2 && j.photos.ph_aaaaaa1.b === 1234 && j.photos.ph_aaaaaa1.o === 99999 && j.photos.ph_aaaaaa2.o === 0 && !j.photos.ph_aaaaaa3 && !j.photos.ph_bbbbbb1, j);
  r = await w.fiPhotoSizes(w.env, new URL('https://x/fi/photo-sizes?id=no'));
  t('a bad id is a 400', r.status === 400, r.status);
  const base = () => ({ v: 1, property: { address: '1 Main' }, areas: [{ id: 'a1', name: 'A', issues: [] }] });
  const ok = Object.assign(base(), { photo_meta: { ph_aaaaaa1: { n: 'IMG_1.jpg', s: 12345 } } });
  t('a sane photo_meta validates', w.fiValidateDoc(ok).ok, w.fiValidateDoc(ok));
  t('a doc without photo_meta still validates', w.fiValidateDoc(base()).ok);
  t('photo_meta must be an object', !w.fiValidateDoc(Object.assign(base(), { photo_meta: [] })).ok);
  t('a bad key / a non-string name / a negative size is refused', !w.fiValidateDoc(Object.assign(base(), { photo_meta: { 'x y': { n: 'a', s: 1 } } })).ok && !w.fiValidateDoc(Object.assign(base(), { photo_meta: { ph_aaaaaa1: { n: 5, s: 1 } } })).ok && !w.fiValidateDoc(Object.assign(base(), { photo_meta: { ph_aaaaaa1: { n: 'a', s: -1 } } })).ok);
  t('a very long name is refused', !w.fiValidateDoc(Object.assign(base(), { photo_meta: { ph_aaaaaa1: { n: 'x'.repeat(200), s: 1 } } })).ok);
  t('the worker routes /fi/photo-sizes', /path === '\/fi\/photo-sizes'\)\s+return await fiRoute\(env, 'photo-sizes'/.test(fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8')));
  t('the public report drops photo_meta', /delete doc\.photo_meta;/.test(fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8')));
}
// ── 7. the problems badge never prints ──
{
  function run(pathname, token) {
    const appended = [], styles = [], fetched = [];
    const el = () => ({ style: {}, setAttribute() {}, remove() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
    const head = { appendChild: (e) => { styles.push(e); } };
    const doc = { visibilityState: 'visible', readyState: 'complete', head, body: { appendChild: (e) => appended.push(e) }, createElement: () => el(), getElementById: () => null, addEventListener() {} };
    const win = { location: { search: '', pathname }, addEventListener() {} };
    win.fetch = async (url) => { fetched.push(String(url)); return { ok: true, status: 200, json: async () => ({ counts: { open: 19, acknowledged: 0, P0: 1 } }) }; };
    const store = { mh_auth: token };
    const f = new Function('window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'console', 'URLSearchParams', reporterSrc);
    f(win, doc, { language: 'en', onLine: true }, win.location, { getItem: (k) => store[k] || '' }, { getItem: () => null, setItem() {} }, () => 0, () => 0, () => {}, { error() {}, warn() {}, log() {} }, URLSearchParams);
    return new Promise((r) => setImmediate(() => setImmediate(() => r({ appended, styles, fetched }))));
  }
  const a = await run('/RidgeCo/index.html', 'tok');
  const css = a.styles.map(s => s.textContent || '').join('\n');
  t('a print stylesheet hides the badge and the notice', /@media print\{[^}]*#hub-fail-badge[^}]*#hub-fail-toast[^}]*display:none!important/.test(css), css);
  t('on a normal page the badge is still drawn for the admin (on screen)', a.fetched.some(u => /\/failures\/open/.test(u)) && a.appended.some(e => e.id === 'hub-fail-badge'), { f: a.fetched, n: a.appended.length });
  for (const p of ['/RidgeCo/inspection-report.html', '/RidgeCo/inspection-photos.html']) {
    const b = await run(p, 'tok');
    t(p + ': the badge is never drawn on the customer report pages, not even on screen', !b.fetched.some(u => /\/failures\/open/.test(u)) && !b.appended.some(e => e.id === 'hub-fail-badge'), b.fetched);
    t(p + ': the print stylesheet is still there', /@media print/.test(b.styles.map(s => s.textContent || '').join('')));
  }
  const noTok = await run('/RidgeCo/vendor.html', '');
  t('a device with no admin token still gets the print stylesheet and no badge', /@media print/.test(noTok.styles.map(s => s.textContent || '').join('')) && !noTok.appended.some(e => e.id === 'hub-fail-badge'));
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
