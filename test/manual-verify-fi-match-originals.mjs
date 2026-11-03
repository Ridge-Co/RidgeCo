// Nov 2 2026 - real-browser end-to-end check of "Attach full-size originals" (field-inspect.html) for EARLIER photos.
// The REAL phone page runs in Chromium at phone size; the Worker is the REAL FI code from worker.js over the in-memory fake (test/_fi-world.mjs), reached through
// Playwright request interception. Needs a folder of real photos:  OM_IMG_DIR=/path/to/jpgs node test/manual-verify-fi-match-originals.mjs
// (the run on Nov 2 used 31 natural pictures at 4032x3024 + shifted "burst" variants; each stored copy is made by the page's own compressImage: 1600 px, JPEG 0.82).
// Scenario = Brett's: an inspection whose photos were uploaded BEFORE the original-upload build (server has the 1600 px copy only). Open it, Review, "Attach full-size originals",
// choose the originals in the wrong order together with pictures from OTHER jobs, and check: every original lands on ITS OWN photo (byte for byte), nothing lands on a wrong photo,
// near-identical shots are left alone and listed, and the single-photo button works.
import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { world } from './_fi-world.mjs';
const IMG_DIR = process.env.OM_IMG_DIR, SHOTS = process.env.OM_SHOTS || '';
if (!IMG_DIR || !fs.existsSync(IMG_DIR)) { console.log('SKIP: set OM_IMG_DIR to a folder of large JPEG photos'); process.exit(0); }
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = u.startsWith('/__imgs/') ? path.join(IMG_DIR, u.slice(8)) : path.join(ROOT, u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); } else { res.writeHead(200, { 'Content-Type': p.endsWith('.jpg') ? 'image/jpeg' : p.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); } });
});
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).split('\n').slice(0, 8).join(' | ')); } };

const w = world(); w.h.staged = true;
const tb = (n, headers, rows) => { w.h.tabs[n] = { headers, rows }; };
tb('Owners', ['ID', 'Company', 'First_Name', 'Last_Name', 'PIN', 'Active'], [['O1', 'Premier Property Management LLC', 'Pat', 'Premier', '9999', 'TRUE']]);
tb('Properties', ['ID', 'Address', 'City', 'Type', 'Unit_Count', 'Owner_ID', 'Active'], [['P12', '122 S Gilmor St', 'Baltimore', 'rowhome', '1', 'O1', 'TRUE']]);
const uploadLog = [];
const stdBytes = {}, origBytes = {}, fakeDown = { orig: false };   // photo id -> bytes the server holds
const reqOf = (route, u) => ({ headers: { get: k => route.request().headers()[String(k).toLowerCase()] || '' }, arrayBuffer: async () => { const b = route.request().postDataBuffer(); return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : new ArrayBuffer(0); } });
async function handle(route) {
  const rq = route.request(), u = new URL(rq.url()), p = u.pathname, m = rq.method();
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  let body = {}; if (m === 'POST' && p !== '/fi/photo') { try { body = JSON.parse(rq.postData() || '{}'); } catch (e) { body = {}; } }
  const env = w.env, q = reqOf(route, u); let r;
  if (p === '/fi/directory') r = await w.fiRoute(env, 'directory', () => w.fiDirectory(env));
  else if (p === '/fi/list') r = await w.fiList(env);
  else if (p === '/fi/inspection') r = await w.fiGetInspection(env, u);
  else if (p === '/fi/report') r = await w.fiReport(env, q, u);
  else if (p === '/fi/save') r = await w.fiRoute(env, 'save', () => w.fiSave(env, body));
  else if (p === '/fi/issue-types') r = await w.fiTypesList(env);
  else if (p === '/fi/folder/organize') r = await w.fiRoute(env, 'folder-organize', () => w.fiFolderOrganize(env, body));
  else if (p === '/fi/photo') {
    r = await w.fiPhotoUpload(env, q, u); uploadLog.push(u.searchParams.get('kind') + ' ' + u.searchParams.get('photo_id') + ' -> ' + r.status + ' ' + (r.body && (r.body.error || r.body.ok)));
    if (r.status === 200 && r.body.ok) { const buf = rq.postDataBuffer(), id = u.searchParams.get('photo_id'); if (u.searchParams.get('kind') === 'orig') origBytes[id] = buf; else stdBytes[id] = buf; }
  }
  else if (p === '/fi/photo/view') { const id = u.searchParams.get('p'); const pv = await w.fiPhotoView(env, u); if (pv.status === 200 && stdBytes[id]) return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/jpeg' }, body: stdBytes[id] }); return route.fulfill({ status: pv.status || 404, headers: CORS, body: 'nf' }); }
  else return route.fulfill({ status: 404, headers: CORS, body: '{"error":"nf"}' });
  return route.fulfill({ status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) });
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'sek'); } catch (e) {} });
await ctx.route(W + '/**', handle);
const errs = [];
const page = await ctx.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => errs.push('pageerror: ' + e.message));

// ── the pictures ──
const all = fs.readdirSync(IMG_DIR).filter(f => f.endsWith('.jpg')).sort();
const baseOnes = all.filter(f => !f.includes('__'));
const inInsp = baseOnes.slice(0, 14).concat(['astronaut__b1.jpg'].filter(f => all.includes(f)));      // 15 photos in this inspection (one is a near-identical shifted shot of another)
const extras = baseOnes.slice(14).concat(all.filter(f => /__b1/.test(f) && !inInsp.includes(f)).slice(0, 4));   // pictures from other jobs
const idOf = (f) => 'ph_' + f.replace(/\.jpg$/, '').replace(/[^A-Za-z0-9]/g, '_').slice(0, 24);
const ID = 'fi_match_0001';

await t('setup: an inspection whose photos exist on the server at 1600 px only (the "earlier photos" state)', async () => {
  await page.goto(BASE + 'blank-om.html').catch(() => {});
  await page.goto(BASE + 'field-inspect.html'); await page.waitForSelector('text=New inspection');
  // make each stored copy with the page's own compressImage, from the full-size file
  for (const f of inInsp) {
    const b64 = await page.evaluate(async (url) => { const blob = await (await fetch(url)).blob(); const std = await compressImage(blob); const ab = await std.arrayBuffer(); let s = ''; const u8 = new Uint8Array(ab); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }, '/__imgs/' + f);
    stdBytes[idOf(f)] = Buffer.from(b64, 'base64');
  }
  const doc = { v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, owner: { id: 'O1', name: 'Premier' }, overall: { condition: 'fair', notes: '' }, date: '2026-10-15',
    areas: [{ id: 'a1', name: 'Kitchen', condition: 'fair', issues: [], photo_ids: inInsp.map(idOf) }] };
  const r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc, meta: { client_name: 'Premier', inspector: 'Brett' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const f of inInsp) {
    const bytes = stdBytes[idOf(f)];
    const up = await w.fiPhotoUpload(w.env, { headers: { get: k => (k === 'Content-Type' ? 'image/jpeg' : '') }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, new URL('https://x/fi/photo?inspection_id=' + ID + '&photo_id=' + idOf(f)));
    assert.ok(up.status === 200 && up.body.ok, JSON.stringify(up));
  }
  assert.equal(Object.keys(origBytes).length, 0, 'no originals on the server yet');
});
await t('open the old inspection -> Review -> the "Full-size photos" card is there', async () => {
  await page.reload(); await page.waitForSelector('text=Gilmor'); await page.click('text=Gilmor'); await page.waitForSelector('text=areas done');
  await page.click('button:has-text("Review")'); await page.waitForSelector('#om-open');
  if (SHOTS) await page.locator('#om-open').scrollIntoViewIfNeeded().then(() => page.screenshot({ path: SHOTS + '/1-review-card.png' }));
  assert.ok(await page.locator('#om-open').isEnabled(), 'button enabled once the inspection is saved');
});
let resultText = '';
await t('choose ALL originals (shuffled) + pictures from other jobs: every original is attached to its own photo, byte for byte', async () => {
  await page.click('#om-open'); await page.waitForSelector('button:has-text("Choose photos from my phone")');
  const txt = await page.locator('#om-box').innerText(); assert.ok(new RegExp('\\b' + inInsp.length + '\\b').test(txt), 'says how many photos lack an original: ' + txt.slice(0, 120));
  if (SHOTS) await page.screenshot({ path: SHOTS + '/2-pick.png' });
  const picks = inInsp.concat(extras).sort((a, b) => (a < b ? 1 : -1));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Choose photos from my phone")')]);
  await fc.setFiles(picks.map(f => path.join(IMG_DIR, f)));
  await page.waitForSelector('#om-box :text("matched and")', { timeout: 180000 });
  resultText = await page.locator('#om-box').innerText();
  if (SHOTS) await page.screenshot({ path: SHOTS + '/3-result.png' });
  // wait until the phone has uploaded everything it said it queued
  const nQueued = Number((resultText.replace(/\s+/g, ' ').match(/(\d+) photos? matched/) || [0, 0])[1]); assert.ok(nQueued > 0, 'the page reported matches: ' + resultText.slice(0, 200));
  const t0 = Date.now(); while (Object.keys(origBytes).length < nQueued && Date.now() - t0 < 150000) await page.waitForTimeout(500);
  if (Object.keys(origBytes).length !== nQueued) console.log('   DEBUG got', Object.keys(origBytes).length, 'of', nQueued, '| bar:', (await page.locator('#sync-st').innerText()).replace(/\s+/g, ' '), '| uploadlog:', JSON.stringify(uploadLog.slice(-6)));
  assert.equal(Object.keys(origBytes).length, nQueued, 'every original the page said it queued reached the server');
  let right = 0, wrong = 0, missing = [];
  for (const f of inInsp) {
    const id = idOf(f), got = origBytes[id], want = fs.readFileSync(path.join(IMG_DIR, f));
    if (!got) { missing.push(f); continue; }
    if (Buffer.compare(got, want) === 0) right++; else wrong++;
  }
  console.log('   result box:', resultText.replace(/\s+/g, ' ').slice(0, 400));
  console.log('   attached correctly:', right, ' attached to the WRONG photo:', wrong, ' left alone:', missing.length, missing.join(', '));
  assert.equal(wrong, 0, 'no original may ever land on a wrong photo');
  assert.ok(right >= inInsp.length - 2, 'nearly all attach (only genuinely near-identical shots may be left)');
});
await t('what was left alone is LISTED (not silent) and the page offers to continue', async () => {
  const left = inInsp.filter(f => !origBytes[idOf(f)]);
  if (!left.length) { console.log('   (nothing was left alone)'); return; }
  assert.ok(/left alone|still have only the standard size|still has only the standard size/.test(resultText), 'result mentions what is left: ' + resultText.slice(0, 300));
});
await t('single-photo button attaches an original to the photo being viewed', async () => {
  const left = inInsp.filter(f => !origBytes[idOf(f)]);
  const target = left[0] || inInsp[0]; const id = idOf(target);
  if (!left.length) { delete origBytes[id]; /* simulate a leftover: clear the server copy so the upload is observable */ }
  await page.click('button:has-text("Done")').catch(() => {});
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Kitchen")'); await page.waitForSelector('.thumb img');
  const idx = inInsp.indexOf(target);
  await page.locator('.thumb img').nth(idx).click(); await page.waitForSelector('button:has-text("Attach full-size original")');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Attach full-size original")')]);
  await fc.setFiles(path.join(IMG_DIR, target));
  await page.waitForFunction((pid) => true, id);
  const t0 = Date.now(); while (!origBytes[id] && Date.now() - t0 < 60000) await page.waitForTimeout(500);
  assert.ok(origBytes[id] && Buffer.compare(origBytes[id], fs.readFileSync(path.join(IMG_DIR, target))) === 0, 'the chosen file is now the original of that photo');
});
await t('no page errors', async () => { assert.deepEqual(errs, []); });
await browser.close(); server.close();
console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
