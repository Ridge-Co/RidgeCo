// Queue #261 (Nov 20 2026): inspection findings to work orders - real-browser walk-through of field-inspect.html at phone size (390) and desktop (1366)
// against the REAL Worker code (test/_fi-world.mjs fakes Sheets/Drive/Gmail/SMS and the Hub's work order functions).
// Run:  FI_SHOTS=/some/dir PW=/opt/npm-tools/node_modules/playwright/index.mjs node test/manual-verify-fi-wo-convert-ui.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { world } from './_fi-world.mjs';
const { chromium } = await import(process.env.PW || 'playwright');
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).split('\n').slice(0, 10).join(' | ')); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
const OPEN = '2026-11-18T14:00:00Z';
const realNow = Date.now.bind(Date); let off = Date.parse(OPEN) - realNow();
const setServerTime = (iso) => { off = Date.parse(iso) - realNow(); };
// the Worker code sees the pretend time ONLY while it runs (the fake world is all promises, so nothing else interleaves); Playwright keeps the real clock
const atServerTime = async (fn) => { Date.now = () => realNow() + off; try { return await fn(); } finally { Date.now = realNow; } };

const w = world(); w.h.staged = false;
await w.fiList(w.env);
const ID = 'fi_woui0000001';
const doc0 = { v: 1, date: '2026-11-18', type: 'periodic', property: { id: 'P1', address: '3572 Dudley Ave, Baltimore, MD 21213' }, owner: { id: 'O1', name: 'Owner One' }, overall: { condition: 'fair' },
  areas: [
    { id: 'a1', name: 'Kitchen', condition: 'fair', issues: [
      { id: 'is_k1', title: 'Leak under sink', trade: 'plumbing', severity: 'high', detail: '', recommended_fix: 'Replace trap', photo_ids: [], wo: true },
      { id: 'is_k2', title: 'Faucet drips', trade: 'plumbing', severity: 'medium', detail: '', recommended_fix: 'Replace cartridge', photo_ids: [] },
      { id: 'is_k3', title: 'Dead outlet', trade: 'electrical', severity: 'medium', detail: '', recommended_fix: '', photo_ids: [] }] },
    { id: 'a2', name: 'Bath', condition: 'poor', issues: [
      { id: 'is_b1', title: 'Toilet runs', trade: 'plumbing', severity: 'low', detail: '', recommended_fix: 'New flapper', photo_ids: [] },
      { id: 'is_b2', title: 'Tenant: clear the tub', trade: 'tenant_action', severity: 'info', detail: '', recommended_fix: '', photo_ids: [] }] }] };
const first = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: doc0 }); assert.ok(first.body.ok);
w.h.tabs.Work_Orders = { headers: ['ID', 'Property_ID', 'Unit_ID', 'Trade', 'Description', 'Type', 'Priority', 'Checklist', 'Vendor_ID'], rows: [] };
w.h.tabs.Vendors = { headers: ['ID', 'Name', 'Trade', 'Active'], rows: [['V1', 'Pipes Inc', 'Plumbing', 'TRUE'], ['V2', 'Sparky LLC', 'Electrical', 'TRUE']] };
const J = (b) => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
const reqOf = (route, u) => ({ headers: { get: k => route.request().headers()[String(k).toLowerCase()] || '' }, arrayBuffer: async () => { const b = route.request().postDataBuffer(); return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : new ArrayBuffer(0); } });
const calls = [];
async function handle(route) {
  const rq = route.request(), u = new URL(rq.url()), p = u.pathname, m = rq.method(); const CORS = J();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (w.h.netDown) return route.abort('failed');
  let body = {}; if (m === 'POST' && p !== '/fi/photo') { try { body = JSON.parse(rq.postData() || '{}'); } catch (e) { body = {}; } }
  const env = w.env, q = reqOf(route, u); calls.push(m + ' ' + p); let r;
  const R = r0 => r0;
  if (p === '/fi/wo/plan') r = await w.fiRoute(env, 'wo-plan', () => w.fiWoPlan(env, body));
  else if (p === '/fi/wo/create') r = await w.fiRoute(env, 'wo-create', () => w.fiWoCreate(env, body));
  else if (p === '/fi/wo/vendors') r = await w.fiRoute(env, 'wo-vendors', () => w.fiWoVendors(env));
  else if (p === '/failures/open' || p === '/failure/report' || p === '/fi/billing' || p === '/fi/photo-sizes') r = { status: 200, body: { ok: true, failures: [], items: [], sizes: {}, billing: {} } };   // not part of this feature; answered quietly so the page's own failure reporter stays silent
  else if (p === '/fi/list') r = await w.fiList(env);
  else if (p === '/fi/inspection') r = await w.fiGetInspection(env, u);
  else if (p === '/fi/save') r = await w.fiRoute(env, 'save', () => w.fiSave(env, body));
  else if (p === '/fi/photo') { if (w.h.photoDelay) await new Promise(r0 => setTimeout(r0, w.h.photoDelay)); r = await w.fiPhotoUpload(env, q, u); }
  else if (p === '/fi/photo/view') return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/png' }, body: PNG });
  else if (p === '/fi/issue-types') r = await w.fiTypesList(env);
  else if (p === '/fi/issue-types/touch') r = await w.fiTypesTouch(env, body);
  else if (p === '/fi/bookings') r = { status: 200, body: { ok: true, bookings: [] } };
  else if (p === '/fi/directory') r = await w.fiDirectory(env);
  else return route.fulfill({ status: 404, headers: CORS, body: '{"error":"nf"}' });
  return route.fulfill({ status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) });
}
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function openPage(clockIso, vp) {
  const ctx = await browser.newContext(vp || phone);
  await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'sek'); } catch (e) {} });
  await ctx.route(W + '/**', handle);
  if (clockIso) await ctx.clock.install({ time: new Date(clockIso) });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(9000); const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|failure-reporter/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.goto(BASE + 'field-inspect.html'); await pg.waitForSelector('text=Dudley');
  await pg.click('text=3572 Dudley'); await pg.waitForSelector('text=areas done');
  await pg.click('text=Review & report'); await pg.waitForSelector('#wo-open');
  return { ctx, pg, errs };
}
const shot = async (pg, n) => { if (process.env.FI_SHOTS) await pg.screenshot({ path: process.env.FI_SHOTS + '/' + n + '.png', fullPage: false }); };
const noH = async (pg, l) => { const [a, b] = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert.ok(a <= b + 1, `${l}: horizontal scroll ${a} > ${b}`); };
const saved = (pg) => pg.waitForFunction(() => /Saved to server/.test(document.getElementById('sync-st').textContent) && !/waiting/.test(document.getElementById('sync-st').textContent), null, { timeout: 15000 });
const serverDoc = async () => (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID))).body.doc;

let A;
await t('Review screen has the button and the old "later update" line is gone', async () => {
  A = await openPage(OPEN); const pg = A.pg;
  assert.ok(!/comes in a later update/.test(await pg.locator('#view').innerText()));
  assert.ok(await pg.locator('#wo-open').isVisible()); await noH(pg, 'review'); await shot(pg, 'wo-0-review');
});
await t('builder opens, nothing is created yet, vendors load', async () => {
  const pg = A.pg; await saved(pg); await pg.click('#wo-open'); await pg.waitForSelector('#wo-arrange');
  assert.equal(w.h.woCreates, undefined); assert.ok(/4 items: 0 on a work order, 4 not yet/.test(await pg.locator('#wo-count').innerText()));
  assert.ok(await pg.locator('#wo-tray').count(), 'tray for the tenant-action item'); await noH(pg, 'builder'); await shot(pg, 'wo-1-builder');
});
await t('"I\'ll pick": start empty, add two items to a NEW work order, then a third to the SAME one, pick a vendor, survives a reload', async () => {
  const pg = A.pg; await pg.click('#wo-pick'); await pg.waitForSelector('#wo-free');
  assert.equal(await pg.locator('.wo-group').count(), 0);
  const rows = pg.locator('#wo-free .issue');
  await rows.nth(0).locator('input[type=checkbox]').check(); await rows.nth(1).locator('input[type=checkbox]').check();
  await pg.click('#wo-selbar >> text=Move selected'); await pg.click('#wo-newwo'); await pg.waitForSelector('.wo-group');
  assert.equal(await pg.locator('.wo-group .issue').count(), 2);
  await pg.locator('#wo-free .issue').first().locator('button').click();   // "Add to..." the next one
  await pg.locator('#sheet button', { hasText: /Work order|Leak/ }).first().click();
  assert.equal(await pg.locator('.wo-group').count(), 1); assert.equal(await pg.locator('.wo-group .issue').count(), 3);
  await pg.locator('.wo-group select').selectOption('V1'); await saved(pg); await shot(pg, 'wo-2-picked');
  const d = await serverDoc(); assert.equal(d.wo_groups.length, 1); assert.equal(d.wo_groups[0].issue_ids.length, 3); assert.equal(d.wo_groups[0].vendor_id, 'V1');
  await pg.reload(); await pg.waitForSelector('text=Dudley');
});
A.ctx.close();
await t('"All on one", then "Related together" replaces drafts after a confirm; items can be moved', async () => {
  A = await openPage(OPEN); const pg = A.pg; await saved(pg); await pg.click('#wo-open'); await pg.waitForSelector('#wo-arrange');
  assert.equal(await pg.locator('.wo-group').count(), 1, 'the earlier arrangement was saved on the server and is back');
  await pg.click('#wo-one'); await pg.click('#wo-confirm-arrange'); await pg.waitForFunction(() => document.querySelectorAll('.wo-group .issue').length === 4);
  assert.equal(await pg.locator('.wo-group').count(), 1);
  await pg.click('#wo-rel'); await pg.click('#wo-confirm-arrange'); await pg.waitForFunction(() => document.querySelectorAll('.wo-group').length === 2);
  await pg.locator('.wo-group').nth(1).locator('.issue button').first().click(); await pg.click('#wo-newwo');
  await pg.waitForFunction(() => document.querySelectorAll('.wo-group').length === 2);
  await shot(pg, 'wo-3-related'); await noH(pg, 'related');
});
await t('review shows the exact work orders, no-texts line, and Create makes them once', async () => {
  const pg = A.pg; await pg.waitForSelector('#wo-review:not([disabled])'); await pg.click('#wo-review'); await pg.waitForSelector('#wo-notexts');
  assert.ok(/No texts or emails are sent/.test(await pg.locator('#wo-notexts').innerText())); await shot(pg, 'wo-4-plan'); await noH(pg, 'plan');
  assert.equal(w.h.woCreates, undefined, 'plan created nothing');
  const n = await pg.locator('#wo-create').innerText(); assert.ok(/Create 2 work orders/.test(n), n);
  await pg.click('#wo-create'); await pg.waitForSelector('#wo-resmsg');
  assert.equal(w.h.woCreates.length, 2); assert.equal(w.h.sms.length, 0); assert.ok((w.h.assigns || []).every(a => a.notify === false)); await shot(pg, 'wo-5-result'); await noH(pg, 'result');
  await pg.click('#sheet button:has-text("Done")'); await pg.waitForSelector('.wo-group a.pill');
  assert.equal(await pg.locator('.wo-group a.pill').count(), 2, 'WO chips on both groups');
  const d = await serverDoc(); assert.ok(d.areas[0].issues[0].wo_id, 'number written back');
});
await t('back on Review: the "work orders created" line shows', async () => {
  const pg = A.pg; await pg.click('text=‹ Review'); await pg.waitForSelector('#wo-madeline'); assert.ok(/2 work orders created/.test(await pg.locator('#wo-madeline').innerText()));
});
await t('desktop width renders without sideways scroll', async () => {
  const B = await openPage(OPEN, { viewport: { width: 1366, height: 800 } }); await B.pg.click('#wo-open'); await B.pg.waitForSelector('#wo-arrange'); await noH(B.pg, 'desktop'); await shot(B.pg, 'wo-6-desktop'); await B.ctx.close();
});
await t('no page errors in the browser console', async () => { assert.deepEqual(A.errs, []); });
await browser.close(); server.close();
console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
