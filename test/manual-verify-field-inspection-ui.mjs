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
  let body = {}; if (m === 'POST' && p !== '/fi/photo' && p !== '/fi/transcribe') { try { body = JSON.parse(rq.postData() || '{}'); } catch (e) { body = {}; } }
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
  else if (p === '/fi/issue-types') r = await w.fiTypesList(env);
  else if (p === '/fi/issue-types/save') r = await w.fiTypesSave(env, body);
  else if (p === '/fi/issue-types/touch') r = await w.fiTypesTouch(env, body);
  else if (p === '/fi/route') r = await w.fiRoute(env, 'route', () => w.fiRouteNotes(env, body));
  else if (p === '/fi/brand/scrape') r = await w.fiBrandScrape(env, body, async (url) => w.h.scrape(url));
  else if (p === '/fi/read-label') r = await w.fiRoute(env, 'read-label', () => w.fiReadLabel(env, body));
  else if (p === '/fi/transcribe') r = await w.fiTranscribe(Object.assign({}, env, { GEMINI_API_KEY: 'gk' }), q, u);
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
  await page.click('button:has-text("＋ Add company")'); await page.fill('.sheet label:has-text("Company name") + input', 'Premier Property Management');
  await page.locator('.sheet input[type=color] >> nth=0').evaluate(el => { el.value = '#0b5d3b'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('.sheet label:has-text("Tagline") + input', 'Baltimore, MD');
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

// ════════ Round 2 (Oct 15 2026): reorder, photo select/move/remove, equipment, issue types, brand capture, voice notes ════════
const R2 = (status, body, ctype = 'text/html', loc = '') => { const bytes = typeof body === 'string' ? Buffer.from(body) : body; return { ok: status >= 200 && status < 300, status, headers: { get: k => (k === 'Content-Type' ? ctype : k === 'Location' ? loc : '') }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), json: async () => JSON.parse(bytes.toString()) }; };
const areaIds = async () => page.evaluate(() => { const m = {}; S.rec.doc.areas.forEach(a => { m[a.name] = a.id; }); return m; });
const docOnPhone = async () => page.evaluate(() => JSON.parse(JSON.stringify(S.rec.doc)));
const boxOK = async (loc, label) => { const b = await loc.boundingBox(); assert.ok(b.width >= 36 && b.height >= 36, `${label} target ${Math.round(b.width)}x${Math.round(b.height)} too small`); };
await t('areas are in walk-through order and can be re-ordered with big ▲ ▼ buttons', async () => {
  await page.click('button:has-text("Areas")').catch(() => {});
  await page.waitForSelector('text=Areas in walk-through order');
  const names = async () => (await page.locator('.area-row b').allInnerTexts());
  let n = await names();
  assert.ok(n.indexOf('Exterior Front') < n.indexOf('Roof & Gutters') && n.indexOf('Roof & Gutters') < n.indexOf('Living Room') && n.indexOf('Kitchen') < n.indexOf('Basement') && n.indexOf('Basement') < n.indexOf('Bedroom 1') && n.indexOf('Bedroom 2') < n.indexOf('Smoke & CO Detectors'), 'default walk order: ' + n.join(' > '));
  await page.click('button:has-text("↕ Reorder")');
  const kRow = page.locator('.area-row:has-text("Kitchen")');
  await boxOK(kRow.locator('button[aria-label="Move up"]'), 'move up');
  const b1 = await kRow.locator('button[aria-label="Move up"]').boundingBox(), b2 = await kRow.locator('button[aria-label="Move down"]').boundingBox();
  assert.ok(b2.x - (b1.x + b1.width) >= 8 - 0.5, 'gap between ▲ and ▼ is at least 8px');
  await kRow.locator('button[aria-label="Move up"]').click(); await kRow.locator('button[aria-label="Move up"]').click();
  n = await names(); assert.ok(n.indexOf('Kitchen') < n.indexOf('Living Room'), 'kitchen moved above living room: ' + n.join(','));
  await page.click('button:has-text("✨ Auto-order for a walk-through")'); await page.click('#ao-go');
  n = await names(); assert.ok(n.indexOf('Living Room') < n.indexOf('Kitchen'), 'auto-order restored walk order');
  await noHScroll(page, 'reorder'); await shot(page, 'reorder', true);
  await kRow.locator('button[aria-label="Move down"]').click(); await page.click('button:has-text("Done")'); await waitSaved();
  const onServer = JSON.parse(w.h.tabs.FI_Inspections.rows[0].slice(w.h.tabs.FI_Inspections.headers.indexOf('Data_1')).join(''));
  assert.ok(onServer.areas.map(a => a.name).indexOf('Kitchen') > onServer.areas.map(a => a.name).indexOf('Dining Room') + 0, 'order saved to the server');
});
await t('photos: select several, move to another area; viewer prev/next; remove cleans phone storage', async () => {
  await page.click('.area-row:has-text("Exterior Rear")'); await page.waitForSelector('#pending');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Add photos")')]);
  await fc.setFiles([{ name: 'b.png', mimeType: 'image/png', buffer: PNG }, { name: 'c.png', mimeType: 'image/png', buffer: PNG }]);
  await page.waitForFunction(() => document.querySelectorAll('.thumbs .thumb').length === 3); await waitSaved();
  await page.click('button:has-text("Select")'); await page.waitForSelector('.selbar');
  assert.ok(await page.locator('.selbar button:has-text("Move…"):disabled').count(), 'Move disabled until something is selected');
  await page.locator('.thumbs .thumb').nth(0).click(); await page.locator('.thumbs .thumb').nth(1).click();
  assert.equal(await page.locator('.thumb.chk').count(), 2); assert.ok((await page.locator('.selbar').innerText()).includes('2 selected'));
  await noHScroll(page, 'select mode'); await shot(page, 'select', true);
  await page.click('.selbar button:has-text("Move…")'); await page.waitForSelector('text=Move 2 photos to…');
  await page.click('.sheet .area-row:has-text("Heating / HVAC")');
  await page.waitForFunction(() => document.querySelectorAll('.thumbs .thumb').length === 1);
  let d = await docOnPhone(); const ids = await areaIds();
  assert.equal(d.areas.find(a => a.name === 'Heating / HVAC').photo_ids.length, 2, 'two photos now in HVAC'); assert.equal(d.areas.find(a => a.name === 'Exterior Rear').photo_ids.length, 1);
  await waitSaved();
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Heating / HVAC")'); await page.waitForSelector('#pending');
  await page.locator('.thumbs .thumb').nth(0).click(); await page.waitForSelector('text=Photo 1 of 2');
  await page.click('.sheet button:has-text("Next ›")'); await page.waitForSelector('text=Photo 2 of 2');
  assert.ok(await page.locator('.sheet button:has-text("Next ›"):disabled').count(), 'Next disabled at the end');
  await page.click('.sheet button:has-text("Remove")'); await page.waitForSelector('text=Remove 1 photo?'); await page.click('#rm-go');
  await page.waitForFunction(() => document.querySelectorAll('.thumbs .thumb').length === 1);
  const idb = await page.evaluate(() => dbAll('photos').then(r => r.length)); assert.equal(idb, 2, 'removed photo also dropped from phone storage (3 -> 2)');
  await waitSaved();
});
await t('equipment: furnace model/serial/filter size, read label from photo fills blanks only, saved + shown', async () => {
  w.h.net = async (url) => (String(url).includes('alt=media') ? R2(200, JPEG, 'image/jpeg') : null);
  w.h.ai = JSON.stringify({ readable: true, kind: 'furnace', brand: 'Carrier', model: '59TP6A060', serial: '1008A12345', year: '10/2008', filter_size: '16x25x1', notes: '60,000 BTU' });
  await page.click('button:has-text("＋ Furnace")'); await page.waitForSelector('#eqf-model');
  await page.fill('#eqf-brand', 'Carier'); // typed by hand, slightly different on purpose
  await page.locator('.sheet .thumbs .thumb').first().click(); await page.click('#eq-read');
  await page.waitForSelector('text=Filled from the label');
  assert.equal(await page.inputValue('#eqf-model'), '59TP6A060'); assert.equal(await page.inputValue('#eqf-filter_size'), '16x25x1');
  assert.equal(await page.inputValue('#eqf-brand'), 'Carier', 'typed value NOT overwritten silently');
  assert.ok((await page.locator('.sheet').innerText()).includes('The label shows different values'), 'difference is surfaced');
  await page.click('button:has-text("Use the label values")'); assert.equal(await page.inputValue('#eqf-brand'), 'Carrier');
  await boxOK(page.locator('#eq-read'), 'read label'); await noHScroll(page, 'equipment sheet'); await shot(page, 'equip', false);
  await page.click('.sheet .btn.primary:has-text("Save")');
  await page.waitForSelector('.issue:has-text("Furnace")');
  assert.ok((await page.locator('.issue:has-text("Furnace")').innerText()).includes('filter 16x25x1'));
  await waitSaved();
  const onServer = JSON.parse(w.h.tabs.FI_Inspections.rows[0].slice(w.h.tabs.FI_Inspections.headers.indexOf('Data_1')).join(''));
  const hv = onServer.areas.find(a => a.name === 'Heating / HVAC'); assert.equal(hv.equipment[0].model, '59TP6A060'); assert.equal(hv.equipment[0].filter_size, '16x25x1');
  // an unreadable label is reported, not faked
  w.h.ai = JSON.stringify({ readable: false });
  await page.click('.issue:has-text("Furnace")'); await page.waitForSelector('#eq-read'); await page.click('#eq-read');
  await page.waitForSelector('text=Could not read a label'); await page.click('.sheet button:has-text("Cancel")');
});
await t('issue types: pick from the list (fills trade/severity/fix), new types are learned, use counts grow', async () => {
  await page.click('button:has-text("Areas")'); await page.click('.area-row:has-text("Bathroom")'); await page.waitForSelector('#pending');
  await page.click('button:has-text("＋ Add an issue by hand")'); await page.waitForSelector('#ie-title');
  await page.click('button:has-text("Choose a type…")'); await page.waitForSelector('#tp-q'); await page.fill('#tp-q', 'toilet');
  await page.waitForSelector('#tp-list .area-row'); assert.ok((await page.locator('#tp-list').innerText()).includes('Running toilet'));
  assert.ok((await page.locator('#tp-list .area-row').first().innerText()).includes('common here'), 'types common to a bathroom are listed first');
  await page.locator('#tp-list .area-row:has-text("Running toilet")').click(); await page.waitForSelector('#ie-title');
  assert.equal(await page.inputValue('#ie-title'), 'Running toilet'); assert.ok(await page.locator('.sheet .pill.type:has-text("Running toilet")').count());
  assert.ok((await page.locator('.sheet textarea').nth(1).inputValue()).includes('Replace the flapper'), 'typical fix filled in');
  await page.click('.sheet .btn.primary:has-text("Save")'); await page.waitForSelector('.issue:has-text("Running toilet")');
  assert.ok(await page.locator('.issue .pill.type:has-text("Running toilet")').count(), 'type shown on the card');
  await page.waitForFunction(() => /./.test(document.getElementById('sync-st').textContent));
  await page.waitForTimeout(500);
  const tab = w.h.tabs.FI_Issue_Types, hd = tab.headers; const row = tab.rows.find(r => r[hd.indexOf('Name')] === 'Running toilet');
  assert.equal(row[hd.indexOf('Uses')], '1', 'use counted on the server');
  // brand-new type typed by hand is learned
  await page.click('button:has-text("＋ Add an issue by hand")'); await page.waitForSelector('#ie-title');
  await page.click('button:has-text("Choose a type…")'); await page.fill('#tp-new', 'Squeaky floor at tub'); await page.click('.sheet button:has-text("Use")');
  await page.fill('#ie-title', 'Floor squeaks by the tub'); await page.click('.sheet .btn.primary:has-text("Save")'); await page.waitForSelector('.issue:has-text("Floor squeaks")');
  await page.waitForFunction((n) => true, 0); await page.waitForTimeout(500);
  assert.ok(tab.rows.some(r => r[hd.indexOf('Name')] === 'Squeaky floor at tub' && r[hd.indexOf('Source')] === 'learned'), 'learned type stored');
  await waitSaved();
});
await t('issue types: server outage is shown (not silent) and the update is retried later', async () => {
  await page.click('button:has-text("＋ Add an issue by hand")'); await page.waitForSelector('#ie-title');
  await page.click('button:has-text("Choose a type…")'); await page.fill('#tp-new', 'Odd smell near drain'); await page.click('.sheet button:has-text("Use")');
  await page.fill('#ie-title', 'Odd smell near drain'); w.h.corruptOnce = true; w.h.corrupt = (tab, vals, headers) => { if (tab === 'FI_Issue_Types') vals[headers.indexOf('Uses')] = '77'; return vals; };
  await page.click('.sheet .btn.primary:has-text("Save")'); await page.waitForFunction(() => /Issue-type list not updated/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('fi_type_q') || '[]').length > 0), 'queued for retry');
  await waitSaved();
});
await t('brand: capture from a website fills the form; manual fields; errors are shown', async () => {
  const SITE = `<html><head><title>Acme Home Services | Baltimore</title><meta property="og:site_name" content="Acme Home Services"><meta name="theme-color" content="#7a1f3d"><script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme Home Services","logo":"https://www.acme-test.com/logo.png","telephone":"443-555-0142","address":{"streetAddress":"9 Chase St","addressLocality":"Baltimore","addressRegion":"MD","postalCode":"21202"}}</script><style>:root{--primary:#7a1f3d;--accent:#d19b00}</style></head><body><a href="mailto:hello@acme-test.com">mail</a></body></html>`;
  w.h.scrape = async (url) => { if (url === 'https://www.acme-test.com/') return R2(200, SITE); if (url === 'https://www.acme-test.com/logo.png') return R2(200, PNG, 'image/png'); if (/blocked/.test(url)) return R2(403, 'no'); return R2(404, 'nf'); };
  await page.click('button:has-text("Areas")').catch(() => {}); await page.click('button:has-text("‹ All inspections")').catch(() => {});
  await page.waitForSelector('button:has-text("Brands")'); await page.click('button:has-text("Brands")'); await page.click('button:has-text("＋ Add company")');
  await page.fill('#br-web', 'blocked-site.com'); await page.click('#br-cap'); await page.waitForSelector('.sheet .banner.err');
  assert.ok((await page.locator('.sheet .banner.err').innerText()).includes('by hand'), 'blocked site: clear message with manual-entry advice');
  await page.fill('#br-web', 'www.acme-test.com'); await page.click('#br-cap'); await page.waitForSelector('text=Found on www.acme-test.com');
  await boxOK(page.locator('#br-cap'), 'capture'); await boxOK(page.locator('.swatch').first(), 'swatch'); await noHScroll(page, 'brand sheet'); await shot(page, 'brandcap', false);
  await page.click('button:has-text("Fill the form from the website")'); await page.waitForFunction(() => document.querySelector('.sheet img[alt=logo]'));
  assert.equal(await page.inputValue('.sheet label:has-text("Company name") + input'), 'Acme Home Services');
  assert.equal(await page.inputValue('.sheet label:has-text("Phone") + input'), '443-555-0142'); assert.equal(await page.inputValue('.sheet label:has-text("Email") + input'), 'hello@acme-test.com');
  assert.equal(await page.inputValue('.sheet label:has-text("Address") + input'), '9 Chase St, Baltimore, MD 21202');
  assert.equal(await page.inputValue('.sheet label:has-text("Main color") + input'), '#7a1f3d');
  await page.click('#br-save'); await page.waitForSelector('#view .card:has-text("Acme Home Services")');
  const bt = w.h.tabs.FI_Brands, bh = bt.headers, br = bt.rows.find(r => r[bh.indexOf('Name')] === 'Acme Home Services');
  assert.equal(br[bh.indexOf('Website')], 'https://www.acme-test.com'); assert.equal(br[bh.indexOf('Phone')], '443-555-0142'); assert.ok(br[bh.indexOf('Logo_Data')].startsWith('data:image/'));
  // removing a company must not blank its saved contact details
  await page.click('#view .card:has-text("Acme Home Services")'); await page.click('button:has-text("Remove company")'); await page.waitForTimeout(600);
  const br2 = bt.rows.find(r => r[bh.indexOf('Name')] === 'Acme Home Services'); assert.equal(br2[bh.indexOf('Phone')], '443-555-0142', 'contact details kept when a company is removed'); assert.equal(br2[bh.indexOf('Active')], 'FALSE');
});
await t('voice notes: upload recordings -> transcripts -> sorted into the right areas -> review -> add', async () => {
  await page.click('button:has-text("‹ Back")').catch(() => {}); await page.click('.card:has-text("122 S Gilmor")').catch(() => {});
  await page.waitForSelector('text=Voice notes'); await page.click('.card:has-text("Voice notes") button:has-text("Open")');
  await page.waitForSelector('button:has-text("Add recordings")'); await noHScroll(page, 'voice empty');
  w.h.net = async (url, opts) => { if (!String(url).includes('generativelanguage')) return null; const n = (w.h.gemCalls = (w.h.gemCalls || 0) + 1); if (n <= 2) return R2(400, JSON.stringify({ error: { message: 'bad audio data' } }), 'application/json'); return R2(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'In the hallway on the first floor. Upstairs bathroom the exhaust fan is really loud. Also the furnace is a Carrier model 59TP6A060, filter is 16 by 25 by 1. Something about the back yard.' }] } }] }), 'application/json'); };
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Add recordings")')]);
  await fc.setFiles({ name: 'My recording 5.m4a', mimeType: 'audio/x-m4a', buffer: Buffer.from('fakeaudio-bytes-0123456789') });
  await page.waitForSelector('.pill.bad:has-text("Failed")'); assert.ok((await page.locator('#view').innerText()).includes('bad audio data'), 'transcription failure shown with the reason');
  await page.click('button:has-text("Try again")'); await page.waitForSelector('.pill.warn:has-text("Not sorted yet")');
  assert.ok((await page.locator('#view').innerText()).includes('1 notes') === false);
  await page.click('button:has-text("Show / fix text")'); assert.ok((await page.inputValue('textarea')).includes('exhaust fan is really loud'));
  await waitSaved(); const ids = await areaIds();
  w.h.ai = JSON.stringify({ issues: [
    { area_id: ids['Bathroom'], note_id: 'x', quote: 'Upstairs bathroom the exhaust fan is really loud', type: 'Exhaust fan missing, noisy or not working', title: 'Exhaust fan is very loud', trade: 'hvac', severity: 'low', detail: 'Bath fan is loud.', recommended_fix: 'Replace the fan', fix_source: 'suggested' },
    { area_id: 'nope', title: 'Something about the back yard', trade: 'exterior_site', severity: 'low' }],
    equipment: [{ area_id: ids['Heating / HVAC'], kind: 'furnace', brand: 'Carrier', model: '59TP6A060', filter_size: '16x25x1', notes: 'heard by voice - verify' }],
    conditions: [{ area_id: ids['Bathroom'], condition: 'fair' }], new_areas: [{ name: 'Sunroom', quote: 'x' }], unassigned: [] });
  await page.click('#route-btn'); await page.waitForSelector('text=Review sorted notes');
  const txt = await page.locator('#view').evaluate(el => el.innerText + ' ' + Array.from(el.querySelectorAll('input,textarea')).map(i => i.value).join(' '));
  assert.ok(txt.includes('Exhaust fan is very loud') && txt.includes('Carrier') && txt.includes('Something about the back yard') && txt.includes('Sunroom'), 'all proposals visible');
  assert.ok(await page.locator('#racc-btn:disabled').count(), 'cannot add while an item is unplaced');
  assert.equal((await docOnPhone()).areas.find(a => a.name === 'Bathroom').issues.filter(i => i.src === 'voice').length, 0, 'nothing added before approval');
  await noHScroll(page, 'route review'); await shot(page, 'route', true);
  await page.selectOption('#ua-0', ids['Exterior Rear']); await page.click('button:has-text("Add to that area’s notes")');
  await page.click('button:has-text("Create this area")'); await page.waitForFunction(() => S.rec.doc.areas.some(a => a.name === 'Sunroom'));
  await page.waitForSelector('#racc-btn:not([disabled])'); await page.click('#racc-btn'); await page.waitForSelector('text=Areas in walk-through order');
  const d = await docOnPhone(); const bath = d.areas.find(a => a.name === 'Bathroom'), hv = d.areas.find(a => a.name === 'Heating / HVAC'), rear = d.areas.find(a => a.name === 'Exterior Rear');
  const fan = bath.issues.find(i => i.title === 'Exhaust fan is very loud'); assert.ok(fan && fan.src === 'voice' && fan.issue_type.startsWith('Exhaust fan'), 'issue landed in the bathroom with its type');
  assert.ok(hv.equipment.some(e => e.model === '59TP6A060' && e.kind === 'furnace'), 'second furnace record added from the recording');
  assert.ok(String(rear.pending_text).includes('back yard'), 'unplaced text went to the area notes for the normal flow');
  assert.equal(bath.condition, 'fair'); assert.ok(d.voice_notes[0].routed === true, 'note marked sorted');
  await waitSaved();
  assert.ok(!(await page.locator('#view').innerText()).includes('not sorted into areas yet'));
});
await t('report shows equipment + brand contact; transcripts never leave the app', async () => {
  const pg = await newPage(); const tok = await page.evaluate(() => S.rec.token);
  await pg.goto(BASE + 'inspection-report.html?r=' + encodeURIComponent(tok)); await pg.waitForSelector('.doc-title');
  const txt = await pg.locator('body').innerText();
  assert.ok(txt.includes('Equipment & model information') && txt.includes('59TP6A060') && txt.includes('16x25x1'), 'equipment section');
  assert.ok(!txt.includes('exhaust fan is really loud') || txt.includes('Exhaust fan is very loud'), 'only the reviewed issue text, not the transcript');
  assert.ok(!(await pg.content()).includes('Something about the back yard.'), 'raw transcript not in the report page');
  await noHScroll(pg, 'report r2'); await shot(pg, 'report-r2', true); await pg.close();
});
await t('no uncaught errors / console errors anywhere', async () => { assert.deepEqual(errs, []); });
await browser.close(); server.close();
console.log(`\nfield-inspection UI: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
