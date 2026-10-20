// Tools & Log page (Oct 20 2026), real index.html, only Worker fetches mocked.
// Usage: node test/manual-verify-devlog-tools-ui.mjs [path/to/index.html]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url'; import { dirname, join, basename } from 'node:path';
import http from 'node:http'; import fs from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url)); const target = process.argv[2] || join(here, '..', 'index.html');
// Served over http://localhost, not file://: headless Chrome loses localStorage across reloads on file:// now and then,
// which would make the "remembered after reload" checks flaky. A real origin behaves like the live Hub.
const root = dirname(target);
const server = http.createServer((q, r) => { const f = join(root, q.url.split('?')[0] === '/' ? basename(target) : decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'text/plain' }); r.end(d); }); }).listen(0);
const base = 'http://localhost:' + server.address().port + '/' + basename(target);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const json = (route, d, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(d) });
const browser = await chromium.launch();
const errors = [];
async function open(vp, { failWishlist = false, blockStorage = false, failVAR = false, failVTR = false, blockErrorLog = false, populate = false, reports } = {}) {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  if (blockErrorLog) await page.addInitScript(() => { const st = Storage.prototype.setItem; /* quota-full style: reads work, writing the Error Log throws */ Storage.prototype.setItem = function (k, v) { if (k === 'mh_errors') throw new Error('QuotaExceededError'); return st.call(this, k, v); }; });
  await page.addInitScript(bs => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {}
    if (bs) { const boom = () => { throw new Error('storage blocked'); }; const g = Storage.prototype.getItem, st = Storage.prototype.setItem; Storage.prototype.getItem = function (k) { if (/^mh_dl_/.test(k)) boom(); return g.call(this, k); }; Storage.prototype.setItem = function (k, v) { if (/^mh_dl_/.test(k)) boom(); return st.call(this, k, v); }; } }, blockStorage);
  await page.route('**/*', async route => { const u = new URL(route.request().url()); if (!/workers\.dev$/.test(u.hostname)) return route.continue();
    if (u.pathname === '/hub-bootstrap') return json(route, { properties: [], units: [], tenants: [], vendors: [], workorders: [], invoices: [], owners: [], keys: [] });
    if (u.pathname === '/failure/report') { if (reports) reports.push(route.request().postData()); return json(route, { success: true }); }
    if (u.pathname === '/wishlist') return failWishlist ? json(route, { error: 'boom' }, 500) : json(route, []);
    if (/vendor-access-request/.test(u.pathname) && failVAR) return json(route, { error: 'boom' }, 500);
    return json(route, route.request().method() === 'GET' ? [] : { success: true }); });
  await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(800);
  await page.evaluate(() => showPage('devlog', document.querySelector('.nav-btn[onclick*="devlog"]'))); await page.waitForTimeout(900);
  return { ctx, page };
}
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);

for (const [name, vp] of [['desktop 1280', { width: 1280, height: 900 }], ['phone 390', { width: 390, height: 844 }]]) {
  console.log('(' + name + ') layout');
  const { ctx, page } = await open(vp);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll');
  ok(await page.locator('#dl-pin-grid .dl-tool').count() === 8, 'Most used shows the 8 default tools');
  ok(await page.locator('.dl-grid .dl-tool').count() === 33, 'all 33 tools are on the page');
  const small = await page.evaluate(() => Array.from(document.querySelectorAll('#page-devlog .dl-tool-btn, #page-devlog .dl-star')).filter(e => e.offsetParent !== null).filter(e => e.getBoundingClientRect().height < 43).length);
  ok(small === 0, 'every visible tool button and star is at least 44px tall (' + small + ' too small)');
  const tiny = await page.evaluate(() => Array.from(document.querySelectorAll('#page-devlog *')).filter(e => e.offsetParent !== null && e.children.length === 0 && (e.textContent || '').trim() !== '🎤' && (e.textContent || '').trim() && parseFloat(getComputedStyle(e).fontSize) < 12.5).length);
  ok(tiny === 0, 'no visible text smaller than 12.5px (the shared 🎤 dictation icon aside) (' + tiny + ' found)');
  if (tiny) console.log('    ' + JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('#page-devlog *')).filter(e => e.offsetParent !== null && e.children.length === 0 && (e.textContent || '').trim() !== '🎤' && (e.textContent || '').trim() && parseFloat(getComputedStyle(e).fontSize) < 12.5).map(e => e.tagName + '.' + e.className + '#' + e.id + ' ' + getComputedStyle(e).fontSize + ' ' + e.textContent.trim().slice(0, 25)))));
  await ctx.close();
}

console.log('(search)');
{ const { ctx, page } = await open({ width: 390, height: 844 });
  await page.fill('#dl-search', 'quickbooks'); await page.waitForTimeout(150);
  const shown = await page.evaluate(() => Array.from(document.querySelectorAll('.dl-grid .dl-tool')).filter(t => !t.hidden && t.offsetParent !== null).length);
  ok(shown >= 3 && shown < 33, 'searching "quickbooks" narrows the list (' + shown + ' shown)');
  ok(!(await vis(page, '#dl-pinned')), 'Most used row hides while searching');
  ok(/Showing \d+ of 33/.test(await page.textContent('#dl-search-status')), 'status says how many match');
  await page.fill('#dl-search', 'zzzzqqq'); await page.waitForTimeout(150);
  ok(/No tool matches/.test(await page.textContent('#dl-search-status')), 'no-match message shown (not a blank page)');
  await page.click('#dl-clear-search'); await page.waitForTimeout(150);
  ok(await page.inputValue('#dl-search') === '' && await vis(page, '#dl-pinned'), 'Clear search restores everything');
  await page.fill('#dl-search', 'read meter'); await page.waitForTimeout(150);
  ok(await page.locator('.dl-grid .dl-tool[data-tool="read-meter"]:not([hidden])').count() === 1, 'Read Meter is findable');
  await ctx.close(); }

console.log('(pins remembered)');
{ const { ctx, page } = await open({ width: 1280, height: 900 });
  await page.click('.dl-grid .dl-tool[data-tool="dup-owners"] .dl-star'); await page.waitForTimeout(100);
  ok(await page.locator('#dl-pin-grid .dl-tool[data-tool="dup-owners"]').count() === 1, 'starring a tool adds it to Most used');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(800);
  await page.evaluate(() => showPage('devlog', document.querySelector('.nav-btn[onclick*="devlog"]'))); await page.waitForTimeout(600);
  ok(await page.locator('#dl-pin-grid .dl-tool[data-tool="dup-owners"]').count() === 1, 'the pin is still there after reload');
  await page.click('#dl-pin-grid .dl-tool[data-tool="dup-owners"] .dl-star'); await page.waitForTimeout(100);
  ok(await page.locator('#dl-pin-grid .dl-tool[data-tool="dup-owners"]').count() === 0, 'unstarring removes it');
  // a pinned (cloned) button still runs the original handler
  await page.click('.dl-grid .dl-tool[data-tool="read-meter"] .dl-star'); await page.waitForTimeout(100);
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null), page.click('#dl-pin-grid .dl-tool[data-tool="read-meter"] .dl-tool-btn').catch(() => {})]);
  ok(!!popup, 'a pinned button still runs its original handler (Read Meter opened a window)');
  await ctx.close(); }

console.log('(collapse remembered)');
{ const { ctx, page } = await open({ width: 1280, height: 900 });
  const key = await page.evaluate(() => { const d = document.querySelector('details.dl-group[data-tools]'); return d.getAttribute('data-dl-key'); });
  const s2 = 'details[data-dl-key="' + key + '"]';
  const before = await page.evaluate(s => document.querySelector(s).open, s2);
  await page.click(s2 + ' > summary'); await page.waitForTimeout(300);
  ok(await page.evaluate(s => document.querySelector(s).open, s2) === !before, 'tapping a group header toggles it');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(800);
  await page.evaluate(() => showPage('devlog', document.querySelector('.nav-btn[onclick*="devlog"]'))); await page.waitForTimeout(600);
  ok(await page.evaluate(s => document.querySelector(s).open, s2) === !before, 'the group stays how you left it after reload');
  await ctx.close(); }

console.log('(storage blocked -> says so, still works)');
{ const { ctx, page } = await open({ width: 390, height: 844 }, { blockStorage: true });
  ok(await vis(page, '#dl-storage-note'), 'a note tells you the layout will not be remembered');
  ok(await page.locator('.dl-grid .dl-tool').count() === 33 && await page.locator('#dl-pin-grid .dl-tool').count() === 8, 'tools and default Most used still show');
  await ctx.close(); }

console.log('(load failures are visible, logged, reported)');
{ const reports = []; const { ctx, page } = await open({ width: 390, height: 844 }, { failWishlist: true, reports });
  await page.waitForTimeout(600);
  const txt = await page.textContent('#wishlist-list');
  ok(/Could not load the wishlist/.test(txt) && /Retry/.test(txt), 'wishlist failure shows a red message with Retry');
  ok(reports.some(r => /wishlist_load/.test(r || '')), 'wishlist failure reported to /failure/report');
  ok(/Could not load the wishlist/.test(await page.evaluate(() => localStorage.getItem('mh_errors') || '')), 'wishlist failure written to the Error Log');
  const h = await page.evaluate(() => { const b = document.querySelector('#wishlist-list button'); return b ? b.getBoundingClientRect().height : 0; });
  ok(h >= 43, 'Retry is a full-size button (' + Math.round(h) + 'px)');
  await ctx.close(); }

{ const reports = []; const { ctx, page } = await open({ width: 390, height: 844 }, { failVAR: true, reports }); await page.waitForTimeout(600);
  ok(/Could not load vendor access requests/.test(await page.textContent('#vendor-access-requests-list')), 'vendor-requests failure is shown (not "No pending requests.")');
  ok(await vis(page, '#dl-attn'), 'the Needs-your-attention strip stays open so the failure cannot hide');
  ok(reports.some(r => /vendor_access_requests_load/.test(r || '')), 'vendor-requests failure reported to /failure/report');
  await ctx.close(); }

ok(errors.length === 0, 'no page errors ' + errors.join('|'));
await browser.close(); server.close();
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
