// Demo prospects screen on the Hub Owners page (Nov 11 2026, phase 2b) — browser verification, mocked Worker (no staging/prod calls).
// Needs Playwright + Chromium.  Run from the repo root:  node test/manual-verify-demo-hub-ui.mjs [screenshot-dir]
// Checks, on a 412px touch phone and a desktop window: the button is there and reachable, the modal opens and lists the slots,
// a server error is SHOWN (never a blank panel), add shows the name + PIN and clears the form, clear/convert ask first, nothing overflows sideways,
// every button is >=44px tall on the phone, and the demo banner appears on the owner and tenant pages only for demo logins.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright'); import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev'; const OUT = process.argv[2] || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop = { viewport: { width: 1280, height: 900 } };
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' }));
const slotsFor = (list) => ({ slots: list, pool_size: 3, login_days: 10 });
const S1 = { slot: 1, state: 'active', prospect: { first_name: 'Ann', last_name: '', phone: '+14105550133', email: 'ann@prospect.example', pin: 'ABC12345' }, added: '2026-11-11T12:00:00Z', first_login: '2026-11-11T13:00:00Z', expires: '2026-11-21T13:00:00Z', owner_id: 'DO1', tenant_id: 'DT1' };
const S2 = { slot: 2, state: 'waiting for first login', prospect: { first_name: 'Bo', last_name: 'Lee', phone: '+14105550144', email: 'bo@prospect.example', pin: 'XYZ99999' }, added: '2026-11-11T12:30:00Z', first_login: '', expires: '' };
const S3 = { slot: 3, state: 'free', prospect: null };
async function hub(opts, handler) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errs = [], calls = []; page.on('pageerror', e => errs.push(e.message)); page._errs = errs; page._calls = calls;
  page.on('dialog', d => { page._lastDialog = d.message(); d.accept(); });
  await page.route(W + '/**', async route => { const u = new URL(route.request().url()), m = route.request().method(); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    const body = route.request().postData(); calls.push({ m, p: u.pathname, body: body ? JSON.parse(body) : null });
    let r = await handler(u.pathname, m, body ? JSON.parse(body) : null); if (r === undefined) r = u.pathname === '/hub-bootstrap' ? { body: { properties: [], units: [], tenants: [], vendors: [], workorders: [], invoices: [], owners: [{ ID: '12', First_Name: 'Rita', Last_Name: 'Real', Phone: '+14105550122', PIN: 'RIT12345', Active: 'TRUE' }], keys: [] } } : { body: {} };
    await route.fulfill({ status: r.status || 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(r.body) }); });
  await page.addInitScript(() => localStorage.setItem('mh_auth', 'T'));
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#app', { state: 'visible' });
  await page.evaluate(() => showPage('owners')); await page.waitForSelector('#page-owners.active, #page-owners[style*="block"]', { timeout: 8000 }).catch(() => {});
  return page;
}
const shot = async (p, name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false }); } };
const open = async (p) => { await p.evaluate(() => openDemoProspectsModal()); await p.waitForSelector('#modal-demo-prospects.open'); };

await t('phone: the Demo Prospects button is on the Owners page and tappable', async () => { const p = await hub(phone, async () => undefined); const b = p.locator('button:has-text("Demo Prospects")'); await b.waitFor(); const box = await b.boundingBox(); assert(box.height >= 40, 'button height ' + box.height); await b.click(); await p.waitForSelector('#modal-demo-prospects.open'); await p.context().close(); });
await t('phone: slots list renders 3 cards with login name + PIN, no sideways scroll', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S2, S3]) } : undefined); await open(p); await p.waitForSelector('#dp-slots >> text=Slot 3');
  const txt = await p.locator('#dp-slots').innerText(); assert(/ABC12345/.test(txt) && /XYZ99999/.test(txt) && /Slot 1/.test(txt) && /Slot 2/.test(txt) && /open/i.test(txt), txt);
  assert(/10 days after first login/.test(txt) && /not yet/.test(txt));
  const ov = await p.evaluate(() => { const m = document.querySelector('#modal-demo-prospects .modal'); return { sw: m.scrollWidth, cw: m.clientWidth, dw: document.documentElement.scrollWidth, vw: window.innerWidth }; });
  assert(ov.sw <= ov.cw + 1 && ov.dw <= ov.vw + 1, JSON.stringify(ov)); await shot(p, 'phone-slots'); assert.deepStrictEqual(p._errs, []); await p.context().close(); });
await t('phone: every button in the modal is at least 44px tall', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S2, S3]) } : undefined); await open(p); await p.waitForSelector('#dp-slots >> text=Slot 3');
  const small = await p.evaluate(() => [...document.querySelectorAll('#modal-demo-prospects button')].filter(b => b.offsetParent).map(b => ({ t: b.textContent.trim().slice(0, 20), h: Math.round(b.getBoundingClientRect().height) })).filter(x => x.h < 44));
  assert.deepStrictEqual(small, []); await p.context().close(); });
await t('desktop: modal looks right (screenshot) and lists slots', async () => { const p = await hub(desktop, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S2, S3]) } : undefined); await open(p); await p.waitForSelector('#dp-slots >> text=Slot 2'); await shot(p, 'desktop-slots'); await p.context().close(); });
await t('slot list failing to load shows a visible "Needs your attention" box (never blank)', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { status: 500, body: { error: 'Sheets said no (test)' } } : undefined); await open(p); await p.waitForSelector('#dp-slots >> text=Needs your attention');
  assert(/Sheets said no/.test(await p.locator('#dp-slots').innerText())); await p.context().close(); });
await t('add: empty fields are refused on the page with a visible message and NOTHING is sent', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S3]) } : undefined); await open(p); await p.fill('#dp-name', 'Zed'); await p.click('#dp-add-btn'); await p.waitForSelector('#dp-msg >> text=required');
  assert(!p._calls.some(c => c.p === '/demo/add')); await p.context().close(); });
await t('add: success shows name + PIN, clears the form, refreshes the list, sends exactly name/phone/email', async () => {
  let added = false; const p = await hub(phone, async (path_, m) => { if (path_ === '/demo/slots') return { body: slotsFor(added ? [S1, S3] : [S3]) }; if (path_ === '/demo/add') { added = true; return { body: { success: true, slot: 1, pin: 'ABC12345', login_name: 'Ann', note: 'x' } }; } });
  await open(p); await p.fill('#dp-name', 'Ann'); await p.fill('#dp-phone', '(410) 555-0133'); await p.fill('#dp-email', 'ann@prospect.example'); await p.click('#dp-add-btn');
  await p.waitForSelector('#dp-result >> text=ABC12345'); assert(/Nothing was texted or emailed/.test(await p.locator('#dp-result').innerText()));
  assert.strictEqual(await p.inputValue('#dp-name'), ''); assert.strictEqual(await p.inputValue('#dp-phone'), ''); await p.waitForSelector('#dp-slots >> text=ann@prospect.example');
  const sent = p._calls.find(c => c.p === '/demo/add'); assert.deepStrictEqual(sent.body, { name: 'Ann', phone: '(410) 555-0133', email: 'ann@prospect.example' }); await shot(p, 'phone-added'); assert.deepStrictEqual(p._errs, []); await p.context().close(); });
await t('add: a server refusal (all slots in use) is shown in the modal and the form keeps what was typed', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S2, S1]) } : path_ === '/demo/add' ? { status: 409, body: { error: 'All 3 demo slots are in use. Clear one first.' } } : undefined);
  await open(p); await p.fill('#dp-name', 'Di'); await p.fill('#dp-phone', '4105550188'); await p.fill('#dp-email', 'di@x.co'); await p.click('#dp-add-btn'); await p.waitForSelector('#dp-msg >> text=All 3 demo slots');
  assert.strictEqual(await p.inputValue('#dp-name'), 'Di'); assert.strictEqual(await p.locator('#dp-add-btn').isDisabled(), false); await p.context().close(); });
await t('add: a network failure is shown, the button comes back', async () => {
  const p = await hub(phone, async (path_, m) => path_ === '/demo/slots' ? { body: slotsFor([S3]) } : undefined); await open(p); await p.route(W + '/demo/add', r => r.abort('connectionrefused'));
  await p.fill('#dp-name', 'Ann'); await p.fill('#dp-phone', '4105550133'); await p.fill('#dp-email', 'a@b.co'); await p.click('#dp-add-btn'); await p.waitForSelector('#dp-msg >> text=Needs your attention'); assert.strictEqual(await p.locator('#dp-add-btn').isDisabled(), false); await p.context().close(); });
await t('clear: asks first, then calls /demo/reset for that slot and refreshes', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S3, S3]) } : path_ === '/demo/reset' ? { body: { success: true } } : undefined); await open(p); await p.waitForSelector('#dp-slots >> text=ABC12345');
  await p.click('#dp-slots button:has-text("Clear")'); await p.waitForFunction(() => true); await p.waitForTimeout(300);
  assert(/Clear demo slot 1/.test(p._lastDialog || ''), p._lastDialog); assert.deepStrictEqual(p._calls.find(c => c.p === '/demo/reset').body, { slot: 1 }); await p.context().close(); });
await t('clear: declining the question sends nothing', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S3, S3]) } : undefined); p.removeAllListeners('dialog'); p.on('dialog', d => d.dismiss()); await open(p); await p.waitForSelector('#dp-slots >> text=ABC12345');
  await p.click('#dp-slots button:has-text("Clear")'); await p.waitForTimeout(300); assert(!p._calls.some(c => c.p === '/demo/reset')); await p.context().close(); });
await t('convert: asks first, shows the new real owner + QuickBooks id, reloads real lists', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S3, S3]) } : path_ === '/demo/convert' ? { body: { success: true, slot: 1, owner_id: '77', qb_customer_id: 'QB555', new_pin: 'NEW12345' } } : undefined); await open(p); await p.waitForSelector('#dp-slots >> text=ABC12345');
  await p.click('#dp-slots button:has-text("Convert")'); await p.waitForSelector('#dp-result >> text=QB555'); assert(/REAL owner/.test(p._lastDialog || '')); assert(/NEW12345/.test(await p.locator('#dp-result').innerText()));
  assert.deepStrictEqual(p._calls.find(c => c.p === '/demo/convert').body, { slot: 1 }); await p.waitForTimeout(400); assert(p._calls.filter(c => c.p === '/hub-bootstrap').length >= 2, 'lists reloaded'); await p.context().close(); });
await t('convert: a QuickBooks failure is shown in full and the slot list refreshes (prospect still there)', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S3, S3]) } : path_ === '/demo/convert' ? { status: 500, body: { error: 'Real owner 77 exists but the QuickBooks customer step failed (QB down). The prospect is still in slot 1; press Convert again.' } } : undefined);
  await open(p); await p.waitForSelector('#dp-slots >> text=ABC12345'); await p.click('#dp-slots button:has-text("Convert")'); await p.waitForSelector('#dp-msg >> text=QuickBooks customer step failed'); assert(/ABC12345/.test(await p.locator('#dp-slots').innerText())); await p.context().close(); });
await t('real owner list is untouched: the demo section does not add rows to the Owners table', async () => {
  const p = await hub(phone, async (path_) => path_ === '/demo/slots' ? { body: slotsFor([S1, S2, S3]) } : undefined); await p.waitForSelector('#owners-list >> text=Rita'); assert(!/Demo|ABC12345/.test(await p.locator('#owners-list').innerText())); await p.context().close(); });

// ---- demo banner on the owner + tenant pages ----
const portal = async (file, key, sess) => { const ctx = await browser.newContext(phone); const page = await ctx.newPage(); page.setDefaultTimeout(8000); page._errs = []; page.on('pageerror', e => page._errs.push(e.message));
  await page.route(W + '/**', async route => { const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }; if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h }); await route.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: '[]' }); });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, sess]); await page.goto(BASE + file); await page.waitForTimeout(500); return page; };
await t('owner page: a demo session shows the DEMO strip and a DEMO header tag; logout removes it', async () => { const p = await portal('owner.html', 'mh_owner_sess', { token: 'T', owner_id: 'DO1', owner_name: 'Ann', owner_company: '', demo: true }); await p.waitForSelector('#demoBanner'); assert(/DEMO/.test(await p.locator('#demoBanner').innerText())); assert(/^DEMO/.test(await p.locator('#ownerCompany').innerText())); await shot(p, 'phone-owner-demo'); await p.evaluate(() => doLogout()); assert.strictEqual(await p.locator('#demoBanner').count(), 0); assert.deepStrictEqual(p._errs, []); await p.context().close(); });
await t('owner page: a REAL session shows no DEMO strip', async () => { const p = await portal('owner.html', 'mh_owner_sess', { token: 'T', owner_id: '12', owner_name: 'Rita', owner_company: 'Real Co' }); await p.waitForTimeout(300); assert.strictEqual(await p.locator('#demoBanner').count(), 0); assert(!/DEMO/.test(await p.locator('#ownerCompany').innerText())); await p.context().close(); });
await t('tenant page: a demo session shows the DEMO strip and a DEMO address tag; logout removes it', async () => { const p = await portal('tenant.html', 'mh_tenant_sess', { token: 'T', tenant_id: 'DT1', tenant_name: 'Ann (demo tenant)', property_address: '101 Sample Row', unit_label: 'A1', can_submit_wo: true, demo: true }); await p.waitForSelector('#demoBanner'); assert(/^DEMO/.test(await p.locator('#tenantAddr').innerText())); await shot(p, 'phone-tenant-demo'); await p.evaluate(() => doLogout()); assert.strictEqual(await p.locator('#demoBanner').count(), 0); assert.deepStrictEqual(p._errs, []); await p.context().close(); });
await t('tenant page: a REAL session shows no DEMO strip', async () => { const p = await portal('tenant.html', 'mh_tenant_sess', { token: 'T', tenant_id: '40', tenant_name: 'Tess', property_address: '500 Real St', unit_label: '1', can_submit_wo: true }); await p.waitForTimeout(300); assert.strictEqual(await p.locator('#demoBanner').count(), 0); assert(!/DEMO/.test(await p.locator('#tenantAddr').innerText())); await p.context().close(); });

await browser.close(); server.close(); console.log(`\ndemo-hub-ui: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
