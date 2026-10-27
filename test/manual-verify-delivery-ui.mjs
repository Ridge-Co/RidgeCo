// Headless Playwright pass for the delivery UI pieces (Oct 23 2026, Phase 0/1 delivery watcher):
//   1. command-center.html  "Today's deliveries" card (shows / hides / error is visible)
//   2. index.html           WO detail "Create delivery" button -> deliveries.html?wo_id=&property_id=
//   3. deliveries.html      Needs Review bucket on top, Cancelled, Source badge, on-site contact as stored + "Driver calls: Brett" note,
//                           duplicate Order_Number warning on manual add
// Loads the REAL shipped pages from disk and intercepts ONLY the Worker fetches (no real network, no sends,
// no production writes). Runs at 375px (phone) and 1280px (desktop).
//   node test/manual-verify-delivery-ui.mjs
// Needs the `playwright` package resolvable from the repo (node_modules/ is gitignored; CI does not run this
// file, same convention as the other test/manual-verify-*.mjs scripts).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const url = (f, q) => 'file://' + join(root, f) + (q || '');
const WORKER = 'https://maintenance-hub.brett-2f8.workers.dev';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const TODAY = '2026-10-23';
const XSS = '"><img src=x onerror="window.__xss=1">';
const D = (o) => Object.assign({
  id: '', order_number: '', store: '', item_type: '', make_model: '', dims: '', property_id: '', unit_id: '', tenant_id: '',
  property_address: '', unit_label: '', tenant_name: '', tenant_phone: '', delivery_address: '', expected_date: '', expected_window: '',
  onsite_contact: 'tenant', onsite_contact_phone: '', backup_contact: '', backup_phone: '', notes: '', linked_wo_ids: '',
  status: 'Ordered', source: 'manual',
}, o);

const D1 = D({ id: 'D1', order_number: 'H1234-567890', store: 'Home Depot', item_type: 'Refrigerator', make_model: 'GE GTS18FBMWW', property_id: 'P1',
  delivery_address: '1109 Battery Ave Apt 2, Baltimore MD 21230 with a very long street line that must wrap on a phone', expected_date: TODAY, expected_window: '9a-1p',
  status: 'Window-Set', onsite_contact: 'brett', onsite_contact_phone: '+14105550100', linked_wo_ids: 'WO-1042', source: 'email-watcher', notes: 'Driver calls Brett: 410-555-0100. Gate code 4417.' });
const D2 = D({ id: 'D2', order_number: 'W123456789', store: "Lowe's", item_type: 'Washer', delivery_address: '20 E Eager St, Baltimore MD 21202', expected_date: TODAY, expected_window: '11a-3p',
  status: 'En-Route', tenant_name: 'Dana Smith', tenant_phone: '+14105551111', source: 'manual' });
const D3 = D({ id: 'D3', order_number: 'H9999-000001', store: 'Home Depot', item_type: 'Dryer', delivery_address: '5 Tomorrow Rd', expected_date: '2026-10-24', status: 'Scheduled', source: 'email-watcher', onsite_contact: 'brett', onsite_contact_phone: '+14105550100', tenant_name: 'Pat Lee', tenant_phone: '+14105552222' });
const D4 = D({ id: 'D4', order_number: XSS, store: 'Home Depot' + XSS, item_type: '', delivery_address: XSS, status: 'Needs Review', source: 'email-watcher', onsite_contact: 'brett',
  notes: 'NEEDS PROPERTY: address as received 77 Nowhere Ln. Raw excerpt: ' + XSS + ' ' + 'x'.repeat(400), linked_wo_ids: 'WO-1' + XSS });
const D5 = D({ id: 'D5', order_number: 'H5555-111111', store: 'Home Depot', item_type: 'Range', delivery_address: '9 Cancel Ct', expected_date: '2026-10-25', status: 'Cancelled', source: 'email-watcher' });
const D6 = D({ id: 'D6', order_number: 'H6666-222222', store: 'Home Depot', item_type: 'Dishwasher', delivery_address: '3 Done Dr', expected_date: TODAY, expected_window: '8a-12p', status: 'Delivered', source: 'manual', linked_wo_ids: 'WO-1050, WO-1051' });
const ALL = [D1, D2, D3, D4, D5, D6];

const jres = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// Routes every Worker call. `opts.deliveries` is the /deliveries payload (array) or 'ERR' for a 500.
async function mockWorker(page, opts) {
  const calls = { added: [], updated: [], dialogs: [], deliveriesGets: 0 };
  await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
  await page.route(WORKER + '/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname, m = route.request().method();
    if (p === '/deliveries') {
      calls.deliveriesGets++;
      if (opts.deliveries === 'ERR') return jres(route, { error: 'boom from sheets' }, 500);
      return jres(route, { today: TODAY, count: opts.deliveries.length, deliveries: opts.deliveries });
    }
    if (p === '/delivery/add' && m === 'POST') { calls.added.push(JSON.parse(route.request().postData() || '{}')); return jres(route, { success: true, id: 'DNEW', wo_id: '' }); }
    if (p === '/delivery/update' && m === 'POST') { calls.updated.push(JSON.parse(route.request().postData() || '{}')); return jres(route, { success: true }); }
    if (p === '/version') return jres(route, { version: 'test' });
    if (p === '/properties') return jres(route, [{ ID: 'P1', Address: '1109 Battery Ave', Active: 'TRUE' }]);
    if (p === '/units' || p === '/tenants' || p === '/workorders' || p === '/invoices' || p === '/vendors') return jres(route, []);
    if (p === '/vendor-bills') return jres(route, []);
    if (p === '/stale-wos') return jres(route, { ok: true, count: 0, stale: [], threshold_days: 4 });
    if (p === '/ar/aging') return jres(route, { ok: false });
    if (p === '/ops-review-log' || p === '/ops-telemetry' || p === '/brettos-tasks-summary') return jres(route, { ok: false });
    return jres(route, {});
  });
  return calls;
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ name: 'phone 375px', width: 375, height: 800 }, { name: 'desktop 1280px', width: 1280, height: 900 }]) {
    console.log('\n=== ' + vp.name + ' ===');

    // ───────────────── 1. Command Center card ─────────────────
    {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      const calls = await mockWorker(page, { deliveries: ALL });
      await page.goto(url('command-center.html'), { waitUntil: 'load' });
      await page.waitForSelector('#deliv-card', { timeout: 8000 }).catch(() => {});
      ok(errs.length === 0, 'command-center: no JS errors (' + errs.slice(0, 2).join(' | ') + ')');
      ok(await page.locator('#deliv-card').count() === 1, 'command-center: Today\'s deliveries card is shown when there are deliveries today');
      const kind = await page.locator('#deliv-card').getAttribute('data-kind').catch(() => '');
      ok(kind === 'today', 'command-center: card kind is "today" (got ' + kind + ')');
      const rows = await page.locator('#deliv-card .deliv-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      ok(JSON.stringify(rows.slice().sort()) === JSON.stringify(['D1', 'D2', 'D6']), 'command-center: lists exactly the 3 deliveries dated today (ET) and not tomorrow / cancelled / needs-review ones (got ' + rows.join(',') + ')');
      const txt = await page.locator('#deliv-card').innerText();
      ok(/Refrigerator/.test(txt) && /H1234-567890/.test(txt) && /9a-1p/.test(txt) && /Window-Set/.test(txt), 'command-center: row shows item, order #, window and status');
      ok(/1109 Battery Ave Apt 2/.test(txt), 'command-center: row shows the delivery address');
      ok(/Meets: Brett/.test(txt), 'command-center: on-site contact shown as stored (Meets: Brett)');
      ok(/Driver calls: Brett/.test(txt), 'command-center: "Driver calls: Brett" note shown when the delivery notes say so');
      const woLinks = await page.locator('#deliv-card a.deliv-wo').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
      ok(woLinks.includes('index.html?wo=WO-1042'), 'command-center: linked WO is a link into the Hub (index.html?wo=WO-1042)');
      ok(woLinks.includes('index.html?wo=WO-1050') && woLinks.includes('index.html?wo=WO-1051'), 'command-center: multiple linked WOs each get their own link');
      ok(await page.locator('#deliv-card a.deliv-all[href="deliveries.html"]').count() === 1, 'command-center: card links to deliveries.html');
      ok(await page.evaluate(() => !window.__xss), 'command-center: no injected markup ran');
      ok(await noHorizontalScroll(page), 'command-center: no horizontal page scroll at ' + vp.width + 'px');
      ok(calls.deliveriesGets === 1, 'command-center: exactly ONE GET /deliveries per load (' + calls.deliveriesGets + ')');
      await page.close();
    }
    {
      // needs-review row but nothing today: compact card, not silence
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await mockWorker(page, { deliveries: [D3, D4, D5] });
      await page.goto(url('command-center.html'), { waitUntil: 'load' });
      await page.waitForSelector('#deliv-card', { timeout: 8000 }).catch(() => {});
      ok(await page.locator('#deliv-card').getAttribute('data-kind').catch(() => '') === 'review-only', 'command-center: nothing today but a Needs Review row -> compact review card (never silent)');
      ok(/1 delivery email/i.test(await page.locator('#deliv-card').innerText().catch(() => '')) && await page.locator('#deliv-card a[href="deliveries.html"]').count() >= 1, 'command-center: review card says how many and links to deliveries.html');
      ok(await page.evaluate(() => !window.__xss), 'command-center: hostile order/address text in a Needs Review row did not execute');
      await page.close();
    }
    {
      // hidden when none today
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await mockWorker(page, { deliveries: [D3, D5] });
      await page.goto(url('command-center.html'), { waitUntil: 'load' });
      await page.waitForFunction(() => document.getElementById('hTitle') && document.getElementById('hTitle').textContent !== 'Loading…', null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      ok(await page.locator('#deliv-card').count() === 0, 'command-center: card is hidden when no delivery is today and none needs review');
      await page.close();
    }
    {
      // empty list is also hidden (and not an error)
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await mockWorker(page, { deliveries: [] });
      await page.goto(url('command-center.html'), { waitUntil: 'load' });
      await page.waitForFunction(() => document.getElementById('hTitle') && document.getElementById('hTitle').textContent !== 'Loading…', null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      ok(await page.locator('#deliv-card').count() === 0, 'command-center: zero deliveries -> no card, no error');
      await page.close();
    }
    {
      // fetch failure must be visible
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await mockWorker(page, { deliveries: 'ERR' });
      await page.goto(url('command-center.html'), { waitUntil: 'load' });
      await page.waitForSelector('#deliv-card', { timeout: 8000 }).catch(() => {});
      ok(await page.locator('#deliv-card').getAttribute('data-kind').catch(() => '') === 'error', 'command-center: a failed /deliveries call shows a visible error card');
      const t = await page.locator('#deliv-card').innerText().catch(() => '');
      ok(/couldn.t load/i.test(t) && /boom from sheets/.test(t), 'command-center: error card says it could not load and why (' + t.replace(/\s+/g, ' ').slice(0, 90) + ')');
      ok(await page.locator('#hTitle').innerText() === 'Live — reading your Hub', 'command-center: a deliveries failure does not knock the rest of the page into sample mode');
      await page.close();
    }

    // ───────────────── 3. deliveries.html ─────────────────
    {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      const calls = await mockWorker(page, { deliveries: ALL });
      page.on('dialog', async (dlg) => { calls.dialogs.push(dlg.message()); await (calls.dialogAction === 'accept' ? dlg.accept() : dlg.dismiss()); });
      await page.goto(url('deliveries.html'), { waitUntil: 'load' });
      await page.waitForSelector('#lists .dcard', { timeout: 8000 }).catch(() => {});
      ok(errs.length === 0, 'deliveries: no JS errors (' + errs.slice(0, 2).join(' | ') + ')');
      const titles = await page.locator('#lists .sec-title').allInnerTexts();
      ok(/needs review/i.test(titles[0] || ''), 'deliveries: Needs Review is the FIRST section (got "' + (titles[0] || '') + '")');
      ok(titles.some((t) => /^📦 Today/i.test(t)) && titles.some((t) => /Upcoming/i.test(t)), 'deliveries: Today and Upcoming sections still there');
      ok(titles.some((t) => /cancel/i.test(t)), 'deliveries: an upcoming Cancelled delivery is visible in its own section, not buried');
      const reviewCards = await page.locator('#lists .dcard.review').count();
      ok(reviewCards === 1, 'deliveries: Needs Review row is rendered as a prominent .review card (' + reviewCards + ')');
      const revBox = await page.locator('#lists .dcard.review').first().boundingBox();
      const todayBox = await page.locator('#lists .dcard[data-id="D1"]').boundingBox();
      ok(revBox && todayBox && revBox.y < todayBox.y, 'deliveries: Needs Review row sits above today\'s deliveries');
      ok(await page.evaluate(() => !window.__xss), 'deliveries: hostile text in a delivery row did not execute (everything escaped)');
      const badge = await page.locator('#lists .dcard[data-id="D1"] .src-badge').first().getAttribute('data-src').catch(() => '');
      ok(badge === 'email-watcher', 'deliveries: email-watcher row carries a Source badge (data-src=' + badge + ')');
      const badge2 = await page.locator('#lists .dcard[data-id="D2"] .src-badge').first().getAttribute('data-src').catch(() => '');
      ok(badge2 === 'manual', 'deliveries: manual row carries a "manual" Source badge (data-src=' + badge2 + ')');
      const d1 = await page.locator('#lists .dcard[data-id="D1"]').innerText();
      ok(/Meets: Brett/.test(d1), 'deliveries: on-site contact shown as stored ("Meets: Brett"), not hardcoded text');
      ok(!/Ridge Co \(Brett\) receives/.test(d1), 'deliveries: no hardcoded "Ridge Co (Brett) receives" label');
      ok(await page.locator('#lists .dcard[data-id="D1"] .driver-note').count() === 1 && /Driver calls: Brett/.test(d1), 'deliveries: small "Driver calls: Brett" note when Delivery_Notes contains "Driver calls Brett"');
      ok(await page.locator('#lists .dcard[data-id="D2"] .driver-note').count() === 0, 'deliveries: no driver note on rows without it');
      ok(await page.locator('#lists .dcard[data-id="D1"] button:has-text("Relay")').count() === 0, 'deliveries: no Relay button when the only phone on a brett row is Brett\'s own');
      calls.dialogAction = 'dismiss';
      await page.locator('#lists .dcard[data-id="D3"] button:has-text("Relay")').click();
      await page.waitForTimeout(150);
      ok(calls.dialogs.length === 1 && /4105552222/.test(calls.dialogs[0]) && !/4105550100/.test(calls.dialogs[0]), 'deliveries: Relay on a brett-contact row targets the tenant phone, never Brett\'s own');
      calls.dialogs.length = 0;
      ok(await page.locator('#lists .dcard[data-id="D2"] button:has-text("Relay")').count() === 1, 'deliveries: tenant row keeps its Relay button (existing behavior intact)');
      ok(await noHorizontalScroll(page), 'deliveries: no horizontal page scroll at ' + vp.width + 'px');
      const tooWide = await page.evaluate(() => { const vw = window.innerWidth; return [...document.querySelectorAll('#lists *')].filter((e) => e.getBoundingClientRect().right > vw + 1).length; });
      ok(tooWide === 0, 'deliveries: nothing in the list spills past the screen edge (' + tooWide + ' elements)');
      const shortBtns = await page.evaluate(() => [...document.querySelectorAll('#lists .actions .btn')].filter((b) => b.getBoundingClientRect().height < 36).length);
      ok(shortBtns === 0, 'deliveries: action buttons are at least 36px tall (' + shortBtns + ' short)');

      // status dropdown options
      await page.locator('#lists .dcard[data-id="D2"] button:has-text("Edit")').click();
      const opts = await page.locator('#df-status option').allInnerTexts();
      ok(opts.includes('Needs Review') && opts.includes('Cancelled'), 'deliveries: status dropdown has Needs Review and Cancelled (' + opts.join(',') + ')');
      await page.evaluate(() => window.closeD());

      // editing a watcher row must not blank Onsite_Contact / Status
      await page.locator('#lists .dcard[data-id="D4"] button:has-text("Edit")').click();
      ok(await page.inputValue('#df-onsite') === 'brett', 'deliveries: editing a "brett" row keeps onsite=brett in the form (not blanked)');
      ok(await page.inputValue('#df-status') === 'Needs Review', 'deliveries: editing a Needs Review row keeps that status in the form');
      await page.evaluate(() => { document.getElementById('df-save').click(); });
      await page.waitForTimeout(250);
      ok(calls.updated.length === 1 && calls.updated[0].fields.Onsite_Contact === 'brett' && calls.updated[0].fields.Status === 'Needs Review', 'deliveries: saving an untouched watcher row writes Onsite_Contact=brett and Status=Needs Review back unchanged');
      ok(await page.evaluate(() => !window.__xss), 'deliveries: edit form prefilled with hostile text did not execute');
      await page.waitForTimeout(100);

      // duplicate order warning
      const fill = async (order) => {
        await page.evaluate(() => { window.PREFILL = null; window.openAdd(); });
        await page.selectOption('#df-store-select', 'Home Depot');
        await page.fill('#df-order', order);
      };
      calls.dialogAction = 'dismiss';
      await fill('h1234-567890');           // same as D1 but different case / no dash difference
      await page.evaluate(() => document.getElementById('df-save').click());
      await page.waitForTimeout(250);
      ok(calls.dialogs.length === 1 && /already/i.test(calls.dialogs[0]) && /H1234-567890/i.test(calls.dialogs[0]), 'deliveries: adding an existing Order # asks for confirmation naming the order (' + (calls.dialogs[0] || 'no dialog') + ')');
      ok(calls.added.length === 0, 'deliveries: cancelling the duplicate warning sends NOTHING');
      ok(await page.evaluate(() => !document.getElementById('df-save').disabled), 'deliveries: Save button is usable again after cancelling the warning');
      ok(await page.evaluate(() => document.getElementById('d-modal').classList.contains('open')), 'deliveries: form stays open after cancelling so nothing typed is lost');
      calls.dialogAction = 'accept';
      await page.evaluate(() => document.getElementById('df-save').click());
      await page.waitForTimeout(300);
      ok(calls.dialogs.length === 2 && calls.added.length === 1 && calls.added[0].order_number === 'h1234-567890' && calls.added[0].source === 'manual', 'deliveries: accepting the warning adds it (source=manual)');

      calls.dialogs.length = 0; calls.added.length = 0;
      await fill('H-BRAND-NEW-1');
      await page.evaluate(() => document.getElementById('df-save').click());
      await page.waitForTimeout(300);
      ok(calls.dialogs.length === 0 && calls.added.length === 1, 'deliveries: a new Order # adds with no warning');
      calls.dialogs.length = 0; calls.added.length = 0;
      await page.evaluate(() => { window.PREFILL = null; window.openAdd(); });
      await page.evaluate(() => document.getElementById('df-save').click());
      await page.waitForTimeout(300);
      ok(calls.dialogs.length === 0 && calls.added.length === 1, 'deliveries: a blank Order # never triggers the duplicate warning');
      await page.close();
    }
    {
      // deep link from the WO still prefills; load failure is visible and duplicate check says it could not run
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const calls = await mockWorker(page, { deliveries: ALL });
      await page.goto(url('deliveries.html', '?wo_id=WO-77&property_id=P1'), { waitUntil: 'load' });
      await page.waitForSelector('#d-modal.open', { timeout: 8000 }).catch(() => {});
      ok(/Linked to WO-77/.test(await page.locator('#df-woline').innerText()), 'deliveries: ?wo_id=&property_id= deep link still opens the form linked to the WO');
      ok(await page.inputValue('#df-property') === 'P1', 'deliveries: deep link still preselects the property');
      await page.close();
    }
    {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const calls = await mockWorker(page, { deliveries: 'ERR' });
      page.on('dialog', async (dlg) => { calls.dialogs.push(dlg.message()); await dlg.dismiss(); });
      await page.goto(url('deliveries.html'), { waitUntil: 'load' });
      await page.waitForFunction(() => /Could not load/.test(document.getElementById('lists').innerText), null, { timeout: 8000 }).catch(() => {});
      ok(/Could not load/.test(await page.locator('#lists').innerText()), 'deliveries: a failed load says so on screen');
      await page.evaluate(() => { window.PREFILL = null; window.openAdd(); });
      await page.fill('#df-order', 'ANY-1');
      await page.evaluate(() => document.getElementById('df-save').click());
      await page.waitForTimeout(250);
      ok(calls.dialogs.length === 1 && /could not check|couldn.t check|can.t check/i.test(calls.dialogs[0]) && calls.added.length === 0, 'deliveries: if the list never loaded, adding with an order # warns that duplicates could not be checked (not a silent pass)');
      await page.close();
    }

    // ───────────────── 2. index.html Create delivery ─────────────────
    {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} window.__opened = []; window.open = function (u, t) { window.__opened.push(String(u)); return {}; }; });
      const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      await page.route('**/config', (r) => json(r, {}));
      await page.route('**/model-registry', (r) => json(r, {}));   // the stored-token auth probe
      await page.route('**/failures/open', (r) => json(r, []));
      await page.route('**/version', (r) => json(r, { version: 'test' }));
      await page.route('**/hub-bootstrap', (r) => json(r, {
        properties: [{ ID: 'P1', Address: '1 Test St', Active: 'TRUE' }], units: [{ ID: 'U1', Property_ID: 'P1', Unit_Label: 'Apt 2' }], tenants: [], vendors: [],
        workorders: [
          { ID: 'WO-9001', Property_ID: 'P1', Unit_ID: 'U1', Trade: 'Appliance', Status: 'New', Priority: 'normal', Type: 'manual', Description: 'Replace fridge', Notes: '', Vendor_ID: '' },
          { ID: 'WO-9002', Property_ID: '', Unit_ID: '', Trade: 'General', Status: 'New', Priority: 'normal', Type: 'manual', Description: 'No property', Notes: '', Vendor_ID: '' },
        ], invoices: [], owners: [], keys: [],
      }));
      await page.route('**/pricing-config', (r) => json(r, { configured: false }));
      await page.route('**/notifications/pending', (r) => json(r, []));
      await page.route('**/wishlist', (r) => json(r, []));
      await page.goto(url('index.html'), { waitUntil: 'load' });
      await page.waitForSelector('#app', { state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      ok(errs.length === 0, 'index: no JS errors loading the Hub (' + errs.slice(0, 2).join(' | ') + ')');
      await page.evaluate(() => window.openWODetail('WO-9001'));
      await page.waitForSelector('#modal-wo-detail.open', { timeout: 5000 }).catch(() => {});
      const btn = page.locator('#detail-actions button', { hasText: 'Create delivery' });
      ok(await btn.count() === 1, 'index: WO detail modal has exactly one "Create delivery" button');
      const bb = await btn.boundingBox().catch(() => null);
      ok(bb && bb.height >= 32, 'index: Create delivery button is a real tap target (' + (bb ? Math.round(bb.height) : '?') + 'px tall)');
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click();
      const opened = await page.evaluate(() => window.__opened.slice());
      ok(opened.length === 1, 'index: tapping it opens exactly one page (' + opened.length + ')');
      const u = new URL(opened[0] || 'x:', 'file:///hub/index.html');
      ok(/deliveries\.html$/.test(u.pathname), 'index: it opens deliveries.html (' + (opened[0] || '') + ')');
      ok(u.searchParams.get('wo_id') === 'WO-9001' && u.searchParams.get('property_id') === 'P1', 'index: URL carries ?wo_id=WO-9001&property_id=P1 (' + u.search + ')');
      ok(u.searchParams.get('unit_id') === 'U1', 'index: URL also carries the WO\'s unit_id when it has one');
      await page.evaluate(() => { window.__opened.length = 0; window.openWODetail('WO-9002'); });
      await page.locator('#detail-actions button', { hasText: 'Create delivery' }).click();
      const opened2 = await page.evaluate(() => window.__opened.slice());
      const u2 = new URL(opened2[0] || 'x:', 'file:///hub/index.html');
      ok(u2.searchParams.get('wo_id') === 'WO-9002' && !u2.searchParams.has('property_id'), 'index: a WO with no property still links by wo_id and leaves property_id off (' + u2.search + ')');
      const overflow = await page.evaluate(() => { const ov = document.getElementById('modal-wo-detail'); return ov.scrollWidth - ov.clientWidth; });
      ok(overflow <= 0, 'index: WO detail modal has no horizontal overflow with the new button (+' + overflow + ')');
      await page.close();
    }
  }
  await browser.close();
  console.log('\ndelivery UI: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
