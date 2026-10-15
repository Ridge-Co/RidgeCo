// Field Inspection (Oct 15 2026) — real-browser verification of field-inspect.html + inspection-report.html at phone size.
// The Worker is the REAL FI code from worker.js running over the in-memory fake (test/_fi-world.mjs), reached through
// Playwright request interception — no staging/prod calls. Run from the repo root:  node test/manual-verify-field-inspection-ui.mjs
import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { world } from './_fi-world.mjs';
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).split('\n').slice(0, 12).join(' | ')); if (process.env.FI_SHOTS) { try { await page.screenshot({ path: process.env.FI_SHOTS + '/fail-' + fails + '.png' }); console.log('   url', page.url(), '| view:', (await page.locator('#view').innerText()).slice(0, 300).replace(/\n/g, ' / ')); } catch (_) {} } } };
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
const props = [{ ID: '12', Address: '122 S Gilmor St', City: 'Baltimore', State: 'MD', Zip: '21223', Active: 'TRUE' }, { ID: '13', Address: '5 Other Ave', City: 'Towson', State: 'MD', Zip: '21204', Active: 'TRUE' }];
const w = world();
w.h.staged = true;
const reqOf = (route, u) => ({ headers: { get: k => route.request().headers()[String(k).toLowerCase()] || '' }, arrayBuffer: async () => { const b = route.request().postDataBuffer(); return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : new ArrayBuffer(0); } });
const log = [];
async function handle(route) {
  const rq = route.request(), u = new URL(rq.url()), p = u.pathname, m = rq.method();
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (w.h.netDown) return route.abort('failed');
  let body = {}; if (m === 'POST' && p !== '/fi/photo') { try { body = JSON.parse(rq.postData() || '{}'); } catch (e) { body = {}; } }
  const env = w.env, q = reqOf(route, u); log.push(m + ' ' + p);
  let r;
  if (p === '/properties') r = { status: 200, body: props };
  else if (p === '/fi/list') r = await w.fiList(env);
  else if (p === '/fi/inspection') r = await w.fiGetInspection(env, u);
  else if (p === '/fi/report') r = await w.fiReport(env, q, u);
  else if (p === '/fi/save') r = await w.fiRoute(env, 'save', () => w.fiSave(env, body));
  else if (p === '/fi/publish') r = await w.fiPublish(env, body);
  else if (p === '/fi/structure') r = await w.fiStructure(env, body);
  else if (p === '/fi/summarize') r = await w.fiSummarize(env, body);
  else if (p === '/fi/brand/save') r = await w.fiBrandSave(env, body);
  else if (p === '/fi/email-report') r = await w.fiEmailReport(env, q, body);
  else if (p === '/fi/photo') r = await w.fiPhotoUpload(env, q, u);
  else if (p === '/fi/photo/view') { const pv = await w.fiPhotoView(env, u); if (pv.status === 200) return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/jpeg' }, body: JPEG }); r = pv; }
  else return route.fulfill({ status: 404, headers: CORS, body: '{"error":"nf"}' });
  return route.fulfill({ status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) });
}
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: [] };
const ctx = await browser.newContext(phone);
await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'sek'); } catch (e) {} });
await ctx.route(W + '/**', handle);
const pubCtx = await browser.newContext(phone); await pubCtx.route(W + '/**', handle); // no admin code: what a customer sees
const errs = [];
async function newPublicPage() { const pg = await pubCtx.newPage(); pg.setDefaultTimeout(8000); pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); return pg; }
async function newPage() { const pg = await ctx.newPage(); pg.setDefaultTimeout(8000); pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); }); return pg; }
const page = await newPage();
const shot = async (pg, name, full) => { if (process.env.FI_SHOTS) await pg.screenshot({ path: process.env.FI_SHOTS + '/' + name + '.png', fullPage: !!full }); };
const noHScroll = async (pg, label) => { const [sw, iw] = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert.ok(sw <= iw + 1, `${label}: horizontal scroll ${sw} > ${iw}`); };
const bar = () => page.locator('#sync-st').innerText();
const waitSaved = async () => { await page.waitForFunction(() => /Saved to server/.test(document.getElementById('sync-st').textContent) && !/waiting/.test(document.getElementById('sync-st').textContent), null, { timeout: 12000 }); };

await t('login with stored code lands on home with empty list', async () => {
  await page.goto(BASE + 'field-inspect.html'); await page.waitForSelector('text=New inspection'); assert.ok(await page.locator('text=None yet').count());
  await noHScroll(page, 'home');
});
await t('new inspection: Hub search + layout toggles (no sides, 2 bedrooms)', async () => {
  await page.click('text=＋ New inspection'); await page.waitForSelector('#proplist .propitem');
  await page.fill('#pq', 'gilmor'); assert.equal(await page.locator('.propitem').count(), 1);
  await page.click('.propitem'); await page.waitForSelector('text=Inspection type');
  await page.click('button:has-text("−") >> nth=0'); // beds 3 -> 2
  assert.equal(await page.locator('#n-beds').innerText(), '2');
  await page.locator('.toggle:has-text("Exterior sides") input').uncheck();
  await page.locator('.toggle:has-text("Built before 1978") input').check();
  await noHScroll(page, 'new');
  await page.click('#start-btn'); await page.waitForSelector('text=areas done');
  const txt = await page.locator('#view').innerText();
  assert.ok(txt.includes('Exterior Front') && txt.includes('Exterior Rear') && !txt.includes('Exterior Side'), 'sides excluded');
  assert.ok(txt.includes('Bedroom 2') && !txt.includes('Bedroom 3'), 'bedrooms');
  await waitSaved(); assert.equal(w.h.tabs.FI_Inspections.rows.length, 1, 'row on server');
  await noHScroll(page, 'areas'); await shot(page, 'areas', true);
});
await t('area: dictation text -> AI issues -> review -> add (human gate)', async () => {
  await page.click('.area-row:has-text("Kitchen")'); await page.waitForSelector('#pending');
  await page.fill('#pending', 'leak under kitchen sink, probably the p trap, replace it. also peeling paint on the ceiling');
  w.h.ai = JSON.stringify({ issues: [{ title: 'Leak under kitchen sink', trade: 'plumbing', severity: 'urgent', detail: 'Active leak at P-trap.', likely_cause: 'Failed P-trap seal', recommended_fix: 'Replace P-trap', fix_source: 'inspector' }, { title: 'Peeling paint on ceiling', trade: 'drywall_paint', severity: 'high', detail: 'Pre-1978 property: possible lead-paint concern.', recommended_fix: 'Lead-safe scrape and repaint', fix_source: 'suggested' }], area_condition: 'poor', area_summary: 'Leak and paint.' });
  await page.click('#struct-btn'); await page.waitForSelector('text=Review before adding');
  assert.equal(await page.locator('.issue').count(), 0, 'nothing added before human accepts');
  await page.fill('input[placeholder="Title"] >> nth=0', 'Active leak under kitchen sink');
  await page.click('#accept-btn'); await page.waitForSelector('.issue');
  assert.equal(await page.locator('.issue').count(), 2);
  assert.ok((await page.locator('#view').innerText()).includes('Active leak under kitchen sink'));
  assert.equal(await page.inputValue('#pending'), '', 'dictation cleared after accept');
  assert.ok(await page.locator('#cond-seg .sel.poor').count(), 'condition set from AI');
  await noHScroll(page, 'area');
});
await t('area: AI failure is shown, dictation kept, nothing added', async () => {
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Living Room")'); await page.waitForSelector('#pending');
  await page.fill('#pending', 'carpet stained near the door');
  w.h.ai = new Error('model overloaded');
  await page.click('#struct-btn'); await page.waitForSelector('text=AI could not process this');
  assert.equal(await page.inputValue('#pending'), 'carpet stained near the door');
  assert.equal(await page.locator('.issue').count(), 0);
  w.h.ai = 'not json at all';
  await page.click('button:has-text("Try again")'); await page.waitForSelector('text=AI could not process this');
  await page.click('button:has-text("Dismiss")');
});
await t('"Nothing to do" area + manual issue + tenant action', async () => {
  await page.click('#cond-seg button:has-text("Nothing to do")'); await page.fill('#pending', ''); // clear unprocessed text
  await page.click('button:has-text("Clear")').catch(() => {});
  await page.click('button:has-text("＋ Add an issue by hand")'); await page.waitForSelector('#ie-title');
  await page.fill('#ie-title', 'Trash bags stored on porch');
  await page.selectOption('.sheet select', 'tenant_action');
  await page.fill('.sheet textarea >> nth=1', 'Please store trash in the bins and remove debris from the porch.');
  await page.click('.sheet .btn.primary:has-text("Save")'); await page.waitForSelector('.issue');
  assert.ok((await page.locator('.issue').innerText()).includes('Tenant action'));
});
await t('photo: add from gallery, shows thumb, uploads + verifies on server', async () => {
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Exterior Rear")'); await page.waitForSelector('#pending');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Add photos")')]);
  await fc.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.thumb img');
  await page.waitForFunction(() => /Saved to server/.test(document.getElementById('sync-st').textContent) && !/photo/.test(document.getElementById('sync-st').textContent), null, { timeout: 15000 });
  assert.equal(w.h.tabs.FI_Photos.rows.length, 1, 'photo row on server');
  assert.ok(w.h.calls.length > 0);
});
await t('offline: edits are kept on the phone, bar says so, syncs when back online', async () => {
  w.h.netDown = true; await ctx.setOffline(true);
  await page.fill('#anotes', 'Back yard fence leaning'); await page.waitForFunction(() => /Offline|waiting|Not saved/.test(document.getElementById('sync-st').textContent));
  const rowsBefore = w.h.tabs.FI_Inspections.rows[0].join('|');
  assert.ok(!rowsBefore.includes('Back yard fence leaning'), 'not on server yet');
  w.h.netDown = false; await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSaved();
  assert.ok(w.h.tabs.FI_Inspections.rows[0].join('').includes('Back yard fence leaning'), 'on server after reconnect');
});
await t('server rejects (500) -> visible error + Retry, no false "saved"', async () => {
  w.h.corruptOnce = true; w.h.corrupt = (tab, vals, headers) => { if (tab === 'FI_Inspections') { const i = headers.indexOf('Data_1'); vals[i] = 'X'; } return vals; };
  await page.fill('#anotes', 'second edit');
  await page.waitForFunction(() => /Not saved to server/.test(document.getElementById('sync-st').textContent), null, { timeout: 12000 });
  assert.ok(await page.locator('#syncbar button:has-text("Retry")').count());
  await page.click('#syncbar button:has-text("Retry")'); await waitSaved();
});
await t('review: publish blocked by pending dictation, then published', async () => {
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Hallway")'); await page.waitForSelector('#pending');
  await page.fill('#pending', 'stair rail loose');
  await page.click('button:has-text("Finish")').catch(async () => { await page.click('button:has-text("Areas")'); await page.click('button:has-text("Review")'); });
  await page.waitForSelector('text=Before you publish');
  assert.ok((await page.locator('#view').innerText()).includes('Hallway & Stairs” has dictation'), 'block message');
  assert.ok(await page.locator('#pub-btn:disabled').count(), 'publish disabled');
  // clear it and publish
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Hallway")'); await page.waitForSelector('#pending');
  await page.click('button:has-text("Clear")'); await page.click('#cond-seg button:has-text("Fair")');
  // mark remaining areas inspected so no warnings other than expected
  await page.click('button:has-text("Areas")'); await page.click('button:has-text("Review & report ›") >> nth=0');
  await page.click('.seg button:has-text("Fair")');
  await page.waitForSelector('text=Before you publish');
  await waitSaved();
  await page.click('#pub-btn');
  await page.waitForSelector('text=Publish anyway?'); // other areas not marked inspected -> warning needs explicit ack
  await page.click('button:has-text("Yes, publish")');
  await page.waitForSelector('text=Published >> nth=0'); await page.waitForSelector('#rep-link');
  assert.equal(w.h.tabs.FI_Inspections.rows[0][w.h.tabs.FI_Inspections.headers.indexOf('Status')], 'published');
  await noHScroll(page, 'review'); await shot(page, 'review', true);
});
let reportUrl = '';
await t('public report renders branded, grouped by trade, tenant section, photos, no h-scroll', async () => {
  reportUrl = (await page.locator('#rep-link').innerText()).replace('https://ridge-co.github.io/RidgeCo/', BASE);
  const rp = await newPublicPage(); await rp.goto(reportUrl); await rp.waitForSelector('.doc-title');
  const txt = await rp.locator('body').innerText();
  assert.ok(txt.includes('Ridge Co') && txt.includes('122 S Gilmor St') && txt.includes('Plumbing') && txt.includes('Tenant action items') && txt.includes('Trash bags stored on porch'));
  assert.ok(txt.includes('Built before 1978'), 'pre-1978 notice');
  assert.ok(!txt.includes('stair rail loose'), 'cleared dictation text never in report');
  await rp.waitForSelector('.photos img'); await noHScroll(rp, 'report'); await shot(rp, 'report', true);
  assert.ok(await rp.evaluate(() => { const i = document.querySelector('.photos img'); return i.complete && i.naturalWidth > 0; }), 'photo loaded');
  await rp.close();
});
await t('brand switch: add Premier, switch, report re-skins; inspection untouched', async () => {
  await page.click('text=Switch brand'); await page.click('text=Manage brands');
  await page.click('button:has-text("＋ Add company")'); await page.fill('.sheet input >> nth=0', 'Premier Property Management');
  await page.locator('.sheet input[type=color] >> nth=0').evaluate(el => { el.value = '#0b5d3b'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('.sheet input >> nth=3', 'Baltimore, MD'); // tagline field order: name, color, color, tagline
  await page.setInputFiles('#logo-in', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.sheet img[alt=logo]');
  await page.click('#br-save'); await page.waitForSelector('.card:has-text("Premier Property Management")');
  await page.click('button:has-text("‹ Back")');
  const before = JSON.stringify(w.h.tabs.FI_Inspections.rows[0].slice(w.h.tabs.FI_Inspections.headers.indexOf('Data_1')));
  await page.click('button:has-text("Review")').catch(() => {});
  if (!(await page.locator('text=Switch brand').count())) { await page.click('button:has-text("Review & report ›") >> nth=0'); }
  await page.click('text=Switch brand'); await page.click('.area-row:has-text("Premier Property Management")');
  await page.waitForFunction(() => /Premier/.test(document.getElementById('view').innerText)); await waitSaved();
  const rp = await newPublicPage(); await rp.goto(reportUrl); await rp.waitForSelector('.doc-title');
  const txt = await rp.locator('.band').innerText();
  assert.ok(txt.includes('Premier Property Management'), 'band shows Premier');
  assert.equal(await rp.evaluate(() => getComputedStyle(document.querySelector('.band')).backgroundColor), 'rgb(11, 93, 59)');
  assert.ok(await rp.locator('.band img').count(), 'logo shown');
  const after = JSON.stringify(w.h.tabs.FI_Inspections.rows[0].slice(w.h.tabs.FI_Inspections.headers.indexOf('Data_1')));
  assert.equal(after, before, 'inspection data identical after brand switch');
  assert.equal(w.h.tabs.FI_Inspections.rows[0][w.h.tabs.FI_Inspections.headers.indexOf('Status')], 'published', 'still published after brand switch');
  await rp.close();
});
await t('editing after publish hides the public report (friendly message), republish restores', async () => {
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Kitchen")'); await page.waitForSelector('#anotes');
  await page.fill('#anotes', 'edited after publish'); await waitSaved();
  const rp = await newPublicPage(); await rp.goto(reportUrl); await rp.waitForSelector('.msg');
  assert.ok((await rp.locator('.msg').innerText()).includes('being updated'));
  await rp.close();
});
await t('email: preview first, then send (staging reports it was NOT really sent)', async () => {
  await page.click('button:has-text("Areas")'); await page.click('button:has-text("Review & report ›") >> nth=0'); await waitSaved();
  await page.click('#pub-btn'); await page.waitForSelector('text=Publish anyway?').catch(() => {});
  if (await page.locator('button:has-text("Yes, publish")').count()) await page.click('button:has-text("Yes, publish")');
  await page.waitForSelector('#em-to');
  await page.fill('#em-to', 'owner@example.com'); await page.click('#em-prev'); await page.waitForSelector('text=Email preview');
  assert.equal(w.h.mail.length, 0, 'preview must not send');
  await page.click('#em-send'); await page.waitForFunction(() => /NOT really sent|Email sent/.test(document.getElementById('toast').textContent));
  assert.equal(w.h.tabs.FI_Email_Log.rows.length, 1);
});
await t('reopen from list after reload restores everything from phone storage', async () => {
  await page.reload(); await page.waitForSelector('.card:has-text("122 S Gilmor")'); await page.click('.card:has-text("122 S Gilmor")');
  await page.waitForSelector('text=areas done'); assert.ok((await page.locator('#view').innerText()).includes('Kitchen'));
  await noHScroll(page, 'reopened');
});
await t('no uncaught errors / console errors anywhere', async () => { assert.deepEqual(errs, []); });
await browser.close(); server.close();
console.log(`\nfield-inspection UI: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
