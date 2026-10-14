// Hub Improvements (Oct 14 2026): (1) native listbox selection is readable (white on blue, not black on blue);
// (2) Work Orders "Not Assigned" filter folds Cancelled/Paid/Invoiced into a collapsed "Closed out" group.
// Real index.html, only Worker fetches mocked.  Usage: node test/manual-verify-hub-improvements-ui.mjs [path/to/index.html]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url'; import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)); const target = process.argv[2] || join(here, '..', 'index.html');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const PROPS = [{ ID: '50', Address: '9 Elm St', City: 'Winchester', Type: 'house', Unit_Count: '1', Owner_ID: '7', Active: 'TRUE' }];
const mk = (id, status, vendor) => ({ ID: id, Property_ID: '50', Status: status, Vendor_ID: vendor, Trade: 'Plumbing', Description: 'desc ' + id, Created_Date: '2026-10-01', Priority: 'normal', Voided: 'FALSE' });
const WOS = [mk('WO-1', 'New', ''), mk('WO-2', 'Cancelled', ''), mk('WO-3', 'Paid', ''), mk('WO-4', 'Invoiced', ''), mk('WO-5', 'Assigned', 'V1'), mk('WO-6', 'Paid', 'V1'), mk('WO-7', 'Complete', '')];
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
const json = (route, d) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
await page.route('**/*', async route => { const u = new URL(route.request().url()); if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  if (u.pathname === '/hub-bootstrap') return json(route, { properties: PROPS, units: [], tenants: [], vendors: [{ ID: 'V1', Name: 'Vee', Active: 'TRUE' }], workorders: WOS, invoices: [], owners: [], keys: [] });
  return json(route, route.request().method() === 'GET' ? [] : { success: true }); });
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForFunction(() => window.state && window.state.workorders && window.state.workorders.length === 7, null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => state.workorders.length) === 7, 'Hub loaded with 7 test work orders');

console.log('(1) listbox selection colors');
const css = await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<select id="__t" size="3"><option>a</option><option selected>b</option></select>'); const o = document.querySelectorAll('#__t option')[1]; const cs = getComputedStyle(o); return { color: cs.color, bg: cs.backgroundColor }; });
ok(css.color === 'rgb(255, 255, 255)', 'selected option text is white (got ' + css.color + ')');
ok(css.bg === 'rgb(29, 78, 216)', 'selected option background is the accent blue (got ' + css.bg + ')');

console.log('(2) Not Assigned collapses closed-out');
await page.evaluate(() => { showPage('workorders', null); document.getElementById('wo-filter').value = 'all'; filterUnassignedWOs(); });
await page.waitForSelector('#wo-closed-out-group', { timeout: 5000 }).catch(() => {});
ok(await page.locator('#wo-closed-out-group').count() === 1, 'one Closed out group exists');
ok(await page.evaluate(() => !document.getElementById('wo-closed-out-group').open), 'group is collapsed by default');
ok(/Closed out \(3\)/.test(await page.textContent('#wo-closed-out-group summary')), 'summary counts 3 closed-out');
const liveOutside = await page.evaluate(() => { const g = document.getElementById('wo-closed-out-group'); return Array.from(document.querySelectorAll('#wo-list-full .wo-card')).filter(c => !g.contains(c)).length; });
ok(liveOutside === 2, 'live unassigned (New + Complete) stay outside the group: ' + liveOutside);
ok(await page.evaluate(() => document.getElementById('wo-closed-out-group').querySelectorAll('.wo-card').length) === 3, 'Cancelled, Paid, Invoiced are inside the group');
await page.click('#wo-closed-out-group summary'); ok(await page.evaluate(() => document.getElementById('wo-closed-out-group').open), 'tap expands it');
await page.evaluate(() => renderWOPage()); ok(await page.evaluate(() => document.getElementById('wo-closed-out-group').open), 'stays open across re-render');
await page.evaluate(() => { document.getElementById('f-vendor').value = 'V1'; renderWOPage(); });
ok(await page.locator('#wo-closed-out-group').count() === 0, 'a normal vendor filter has no group (unchanged behaviour)');
ok(errors.length === 0, 'no page errors ' + errors.join('|'));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
