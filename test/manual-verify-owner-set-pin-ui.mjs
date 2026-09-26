// Headless Playwright pass over the REAL index.html: Owners page → "Set PIN" (Sep 26 2026).
//  - "Select owners with no PIN" ticks exactly the owners missing one
//  - Set PIN for Selected → editable preview (suggested PINs use the phone digits), live rule checks, duplicate check
//  - one owner selected ⇒ replacement offered; many ⇒ backfill only (existing PINs kept) unless "replace" is ticked
//  - Save sends only valid rows; server refusals show per owner; good rows still save
//  - "Text these PINs" hands the saved owners to the existing send-PIN dialog
// Only the Worker's fetch endpoints are intercepted; the app code is the real shipped file.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

let OWNERS = [
  { ID: '1', First_Name: 'Amy', Last_Name: 'Ames', Company: 'Ames Holdings', Phone: '+14106158842', PIN: '', Active: 'TRUE' },
  { ID: '2', First_Name: 'Bo', Last_Name: 'Bell', Company: '', Phone: '+14438864174', PIN: 'BOB64174', Active: 'TRUE' },
  { ID: '3', First_Name: 'Cy', Last_Name: 'Cole', Company: '', Phone: '', PIN: '', Active: 'TRUE' },
  { ID: '4', First_Name: 'Di', Last_Name: 'Dunn', Company: '', Phone: '+14105550142', PIN: '', Active: 'TRUE' },
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
const posts = {}; const suggestCalls = [];
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
await page.route('**/*', async route => {
  const req = route.request(); const u = new URL(req.url());
  if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  const p = u.pathname; const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
  if (body) posts[p] = body;
  if (p === '/hub-bootstrap') return json(route, { properties: [], units: [], tenants: [], vendors: [], workorders: [], invoices: [], owners: OWNERS, keys: [] });
  if (p === '/owner/pin-suggest') {
    suggestCalls.push(body);
    const rows = body.owner_ids.map(id => {
      const o = OWNERS.find(x => x.ID === id);
      if (o.PIN && !body.overwrite) return { owner_id: id, phone: o.Phone, current_pin: o.PIN, proposed_pin: '', skipped: 'Already has a PIN', note: '' };
      const l5 = (o.Phone || '').replace(/\D/g, '').slice(-5);
      return { owner_id: id, phone: o.Phone, current_pin: o.PIN, proposed_pin: 'XKQ' + (l5.length === 5 ? l5 : '90417'), from_phone: l5.length === 5, note: '' };
    });
    return json(route, { success: true, rows });
  }
  if (p === '/owner/set-pins') {
    const results = body.assignments.map(a => a.pin === 'TAK12849' ? { owner_id: a.owner_id, ok: false, error: 'That PIN is already used by another login.' } : { owner_id: a.owner_id, ok: true, pin: a.pin });
    const saved = results.filter(r => r.ok).length;
    body.assignments.forEach(a => { if (a.pin !== 'TAK12849') { const o = OWNERS.find(x => x.ID === a.owner_id); if (o) o.PIN = a.pin; } });
    return json(route, { success: true, saved, failed: results.length - saved, results });
  }
  if (p === '/config' || p === '/tenant-wo-settings') return json(route, p === '/config' ? {} : { owners: [], properties: [] });
  if (p === '/owner-users') return json(route, []);
  return json(route, req.method() === 'GET' ? [] : { success: true });
});
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForFunction(() => window.state && window.state.owners && window.state.owners.length === 4, null, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => { window.showPage('owners'); window.renderOwnersPage(); });
await page.waitForSelector('#owners-list .pin-check');
const checked = () => page.locator('#owners-list .pin-check:checked').evaluateAll(els => els.map(e => e.getAttribute('data-id')));

console.log('Selecting owners');
ok((await page.textContent('#owners-action-bar')).includes('0 selected'), 'nothing is selected to start with');
await page.click('button:has-text("Select owners with no PIN")');
ok(JSON.stringify((await checked()).sort()) === '["1","3","4"]', 'ticks exactly the owners with no PIN (Amy, Cy, Di — not Bo): ' + JSON.stringify(await checked()));
ok(await page.locator('#owners-action-bar').isVisible() && (await page.textContent('#owners-action-bar')).includes('3 selected'), 'action bar shows "3 selected"');
ok(await page.locator('#owners-action-bar button:has-text("Set PIN for Selected")').count() === 1, 'the Set PIN for Selected button is in the bar');
await page.evaluate(() => window.clearPinChecks('owners-list'));
await page.evaluate(() => window.openSetOwnerPinModal());
ok(!(await page.locator('#modal-set-owner-pin').evaluate(e => e.classList.contains('open'))), 'with nobody selected the dialog does not open');

console.log('Backfill (several owners)');
await page.click('button:has-text("Select owners with no PIN")');
await page.click('#owners-action-bar button:has-text("Set PIN for Selected")');
await page.waitForSelector('.spn-pin');
ok(suggestCalls.at(-1).overwrite === false && JSON.stringify(suggestCalls.at(-1).owner_ids.sort()) === '["1","3","4"]', 'asks for suggestions for the 3 selected owners, not replacing PINs: ' + JSON.stringify(suggestCalls.at(-1)));
const vals = await page.locator('.spn-pin').evaluateAll(els => els.map(e => e.value));
ok(vals.length === 3, 'three editable PIN boxes');
ok(vals[0] === 'XKQ58842' && vals[2] === 'XKQ50142', 'suggested PINs follow each owner\'s phone digits: ' + JSON.stringify(vals));
const dlg = await page.textContent('#modal-set-owner-pin');
ok(dlg.includes('Ames Holdings — Amy Ames'), 'owners are labelled business first, with the contact: (Ames Holdings — Amy Ames)');
ok(dlg.includes('no phone — random digits'), 'an owner with no phone is flagged as getting random digits');
ok(await page.locator('#spn-save').isEnabled() && (await page.textContent('#spn-save')).includes('Save 3 PINs'), 'Save shows how many PINs it will write: ' + await page.textContent('#spn-save'));
ok(await page.locator('#spn-overwrite').isChecked() === false, 'multiple owners: "replace existing" is OFF by default');

console.log('Editing + validation');
const boxes = page.locator('.spn-pin');
await boxes.nth(0).fill('abc12');
ok((await page.textContent('#spn-st-0')).includes('3 letters then 5 numbers') && await page.locator('#spn-save').isDisabled(), 'a malformed PIN is flagged and Save is blocked');
await boxes.nth(0).fill('abc12345');
ok((await page.textContent('#spn-st-0')).includes('simple run') && await page.locator('#spn-save').isDisabled(), '12345-style run is flagged');
await boxes.nth(0).fill('qrs90417');
ok(await boxes.nth(0).inputValue() === 'QRS90417', 'typing is uppercased');
await boxes.nth(1).fill('QRS90417');
ok((await page.textContent('#spn-st-1')).includes('twice') && await page.locator('#spn-save').isDisabled(), 'the same PIN typed for two owners is flagged and blocks Save');
await boxes.nth(1).fill('TAK12849');
ok(await page.locator('#spn-save').isEnabled(), 'a well-formed, unique PIN enables Save');

console.log('Saving (one refused by the server)');
await page.click('#spn-save');
await page.waitForSelector('#spn-after', { state: 'visible' });
const sent = posts['/owner/set-pins'].assignments;
ok(sent.length === 3 && sent.find(a => a.owner_id === '1').pin === 'QRS90417' && sent.find(a => a.owner_id === '3').pin === 'TAK12849', 'sends owner id + PIN for each valid row: ' + JSON.stringify(sent));
ok((await page.textContent('#spn-st-0')).includes('saved'), 'accepted rows show ✓ saved');
ok((await page.textContent('#spn-st-1')).includes('already used by another login'), 'the refused row shows the server\'s reason');
ok((await page.textContent('#spn-msg')).includes('Saved 2 PINs') && (await page.textContent('#spn-msg')).includes('1 need attention'), 'summary: "Saved 2 PINs — 1 need attention"');
await boxes.nth(1).fill('LMN73519');
await page.click('#spn-save'); await page.waitForTimeout(300);
ok(posts['/owner/set-pins'].assignments.length === 1 && posts['/owner/set-pins'].assignments[0].owner_id === '3', 'fixing the refused PIN and saving again only re-sends that one owner');
ok(OWNERS.find(o => o.ID === '1').PIN === 'QRS90417', 'the saved PIN reached the (mock) sheet');

console.log('Text the PINs');
await page.click('#spn-send');
ok(await page.locator('#modal-send-pin-bulk').evaluate(e => e.classList.contains('open')), 'opens the existing send-PIN dialog');
const bulk = await page.textContent('#bulk-pin-list');
ok(bulk.includes('Ames Holdings') && bulk.includes('Dunn') , 'it lists the saved owners that have a phone');
ok(!bulk.includes('Cole') , 'an owner with no phone is left out of the text list');
await page.evaluate(() => window.closeModal('modal-send-pin-bulk'));

console.log('Single owner');
await page.evaluate(() => { window.clearPinChecks('owners-list'); window.renderOwnersPage(); });
await page.waitForSelector('#owners-list .pin-check');
await page.locator('#owners-list .pin-check[data-id="2"]').check();
await page.click('#owners-action-bar button:has-text("Set PIN for Selected")');
await page.waitForSelector('.spn-pin');
ok(await page.locator('#spn-overwrite').isChecked(), 'one owner who already has a PIN: replacement is offered (box pre-ticked)');
ok(suggestCalls.at(-1).overwrite === true, 'and the server is asked to propose a replacement');
ok(await page.locator('.spn-pin').inputValue() === 'XKQ64174', 'suggestion built from that owner\'s phone digits');
await page.locator('.spn-pin').fill('MYP48213'); await page.click('#spn-save'); await page.waitForSelector('#spn-after', { state: 'visible' });
ok(posts['/owner/set-pins'].assignments.length === 1 && posts['/owner/set-pins'].assignments[0].pin === 'MYP48213', 'a typed PIN is saved for exactly that owner');
await page.evaluate(() => window.closeModal('modal-set-owner-pin'));
// several owners, some with PINs, replace ticked
await page.evaluate(() => { window.clearPinChecks('owners-list'); });
for (const id of ['1', '2']) await page.locator(`#owners-list .pin-check[data-id="${id}"]`).check();
await page.click('#owners-action-bar button:has-text("Set PIN for Selected")');
await page.waitForSelector('#spn-list table');
ok((await page.textContent('#spn-list')).includes('Already has a PIN — kept'), 'several owners: those who already have a PIN are shown as kept');
await page.locator('#spn-overwrite').check(); await page.waitForTimeout(300);
ok((await page.locator('.spn-pin').count()) === 2, 'ticking "replace existing" makes every selected owner editable');
ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors[0] : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
