// Headless Playwright pass over the REAL index.html for the Sep 26 2026 Hub changes:
//  (1) Add Property no longer carries the previous property's values into the next one (Brett's bug)
//  (2) Add Property: commercial type + sub-type; unit count locked to 1 for house/rowhome, required for
//      multi/condo/commercial (multi >= 2); payload includes Commercial_Subtype
//  (3) Edit Property: commercial + sub-type round trip; owner-reported Unit_Count is not silently shrunk
//  (4) Owners: billing fields in Add/Edit Owner (payload + prefill)
//  (5) Owners: "Owner Onboarding Link" modal creates a link, lists invites, revokes
// Only the Worker's fetch endpoints are intercepted; the app code is the real shipped file.
// Usage: node test/manual-verify-hub-owner-property-ui.mjs [path/to/index.html]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const OWNERS = [{ ID: '7', First_Name: 'Pat', Last_Name: 'Lee', Company: 'Lee Holdings', Phone: '4105550142', Email: 'pat@x.com', Active: 'TRUE', PIN: 'PAT48213',
  Billing_Name: 'Lee Holdings LLC', Billing_Address: '12 Main St', Billing_City: 'Baltimore', Billing_State: 'MD', Billing_Zip: '21201', Billing_Phone: '4105550142', Billing_Email: 'bill@x.com' },
  // Owner-dropdown fixtures (Sep 26 2026): company-only, person-only, two contacts under one business, inactive, nameless
  { ID: '15', First_Name: '', Last_Name: '', Company: 'Ridge Co', Active: 'TRUE' },
  { ID: '16', First_Name: 'Dan', Last_Name: 'Glecker', Company: '', Active: 'TRUE' },
  { ID: '3', First_Name: 'Jennifer', Last_Name: 'Goldszmidt', Company: 'Goldszmidt Properties', Active: 'TRUE' },
  { ID: '19', First_Name: 'Adrian', Last_Name: 'Goldszmidt', Company: 'Goldszmidt Properties', Active: 'TRUE' },
  { ID: '30', First_Name: '', Last_Name: '', Company: '', Active: 'TRUE' },
  { ID: '18', First_Name: 'Mark', Last_Name: 'Passerelli', Company: 'Zed Inactive Co', Active: 'FALSE' }];
const PROPS = [
  { ID: '50', Address: '9 Elm St', City: 'Winchester', Type: 'multi', Unit_Count: '4', Owner_ID: '7', Active: 'TRUE', Onboarding_Source: 'self_serve_link', Market: 'Winchester' },
  { ID: '51', Address: '100 Market St', City: 'Baltimore', Type: 'commercial', Commercial_Subtype: 'retail', Unit_Count: '2', Owner_ID: '7', Active: 'TRUE', Market: 'Baltimore' },
];
const UNITS = [{ ID: '1', Property_ID: '50', Unit_Label: 'Apt 2', Active: 'TRUE' }];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
const posts = {};
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
let invites = [{ id: '1', status: 'used', name: 'Pat Lee', owner_id: '7', created: '2026-09-20T10:00:00Z', used: '2026-09-21T10:00:00Z', needs_review: true, note: '', link: '', summary: JSON.stringify({ properties: [{}], warnings: ['1 unit(s) marked "I will provide this later" — follow up for tenant/access info.'] }) }];
await page.route('**/*', async route => {
  const req = route.request(); const u = new URL(req.url());
  if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  const p = u.pathname;
  if (req.method() === 'POST') { posts[p] = JSON.parse(req.postData() || '{}'); }
  if (p === '/hub-bootstrap') return json(route, { properties: PROPS, units: UNITS, tenants: [], vendors: [], workorders: [], invoices: [], owners: OWNERS, keys: [] });
  if (p === '/owner-onboard/invites') return json(route, invites);
  if (p === '/owner-onboard/invite/create') { const b = posts[p]; const row = { id: '2', status: 'pending', name: b.name, created: new Date().toISOString(), note: b.note || '', needs_review: false, summary: '', link: 'https://ridge-co.github.io/RidgeCo/owner-onboard.html?t=NEWTOKEN' }; invites.unshift(row); return json(route, { success: true, id: '2', token: 'NEWTOKEN', link: row.link, expires: 'x' }); }
  if (p === '/owner-onboard/invite/revoke') { invites = invites.map(i => i.id === posts[p].id ? { ...i, status: 'revoked', link: '' } : i); return json(route, { success: true }); }
  if (p === '/property/add') return json(route, { success: true, id: '99' });
  if (p === '/property/update' || p === '/owner/update' || p === '/owner/add') return json(route, { success: true, id: '8' });
  if (p === '/owner/tenant-wo-toggle' || p === '/owner/held-contact-note') return json(route, { success: true });
  if (p === '/tenant-wo-settings') return json(route, { owners: [], properties: [] });
  if (p === '/config') return json(route, {});
  return json(route, req.method() === 'GET' ? [] : { success: true });
});
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForFunction(() => window.state && window.state.properties && window.state.properties.length === 2, null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => !!window.openAddPropertyModal && !!window.apTypeChanged), 'Hub loaded with the new functions present');

console.log('(1) Add Property does not carry values over');
await page.evaluate(() => window.openAddPropertyModal());
await page.fill('#p-address', '1 First St'); await page.fill('#p-city', 'Waynesboro'); await page.selectOption('#p-market', 'Waynesboro');
await page.selectOption('#p-type', 'multi'); await page.fill('#p-units', '6');
await page.fill('#p-lockbox', '9999'); await page.fill('#p-lockcode', '1111'); await page.fill('#p-shutoff', 'basement'); await page.fill('#p-hvac', '16x20x1'); await page.fill('#p-breaker', 'closet'); await page.fill('#p-access', 'call tenant');
await page.evaluate(() => window.closeModal('modal-add-property'));
await page.evaluate(() => window.openAddPropertyModal());
for (const [id, want] of [['p-address',''],['p-city',''],['p-lockbox',''],['p-lockcode',''],['p-shutoff',''],['p-hvac',''],['p-breaker',''],['p-access','']]) {
  ok(await page.inputValue('#' + id) === want, `#${id} is blank on reopen`);
}
ok(await page.inputValue('#p-type') === 'house', 'type back to House');
ok(await page.inputValue('#p-market') === 'Baltimore', 'market back to Baltimore');
ok(await page.inputValue('#p-units') === '1', 'unit count back to 1');
ok(await page.inputValue('#p-owner') === '', 'owner back to none');
// also after a SUCCESSFUL add
await page.fill('#p-address', '2 Second St'); await page.fill('#p-city', 'Baltimore');
await page.evaluate(() => window.submitAddProperty()); await page.waitForTimeout(300);
ok(posts['/property/add'] && posts['/property/add'].Address === '2 Second St', 'add sends the entered address');
await page.evaluate(() => window.openAddPropertyModal());
ok(await page.inputValue('#p-address') === '' && await page.inputValue('#p-city') === '', 'fields blank after a successful add + reopen');

console.log('(2) Add Property: types, subtype, unit count');
ok(await page.locator('#p-units').evaluate(e => e.readOnly), 'house: unit count locked');
await page.selectOption('#p-type', 'rowhome');
ok(await page.inputValue('#p-units') === '1' && await page.locator('#p-units').evaluate(e => e.readOnly), 'rowhome: unit count locked at 1');
await page.selectOption('#p-type', 'condo');
ok(await page.inputValue('#p-units') === '' && !(await page.locator('#p-units').evaluate(e => e.readOnly)), 'condo: unit count cleared and editable (must be entered)');
await page.selectOption('#p-type', 'multi');
ok(await page.locator('#p-units').getAttribute('min') === '2', 'multi: minimum 2');
const opts = await page.locator('#p-type option').allTextContents();
ok(opts.includes('Commercial'), 'Commercial is a property type');
ok(!(await page.locator('#p-subtype-wrap').isVisible()), 'sub-type hidden for non-commercial');
await page.selectOption('#p-type', 'commercial');
ok(await page.locator('#p-subtype-wrap').isVisible(), 'sub-type shown for commercial');
const subOpts = await page.locator('#p-subtype option').allTextContents();
ok(['Retail','Mixed use','Industrial','Office'].every(x => subOpts.includes(x)), 'sub-types retail / mixed use / industrial / office');
delete posts['/property/add'];
await page.fill('#p-address', '3 Third St'); await page.fill('#p-units', '3');
await page.evaluate(() => window.submitAddProperty()); await page.waitForTimeout(200);
ok(!posts['/property/add'], 'commercial without a sub-type is blocked');
await page.selectOption('#p-subtype', 'mixed_use');
await page.evaluate(() => window.submitAddProperty()); await page.waitForTimeout(300);
ok(posts['/property/add'] && posts['/property/add'].Type === 'commercial' && posts['/property/add'].Commercial_Subtype === 'mixed_use' && posts['/property/add'].Unit_Count === '3', 'commercial add sends type, sub-type, unit count');
await page.evaluate(() => window.openAddPropertyModal());
await page.fill('#p-address', '4 Fourth St'); await page.selectOption('#p-type', 'multi'); await page.fill('#p-units', '1');
delete posts['/property/add'];
await page.evaluate(() => window.submitAddProperty()); await page.waitForTimeout(200);
ok(!posts['/property/add'], 'multi with unit count 1 is blocked');
await page.fill('#p-units', '');
await page.evaluate(() => window.submitAddProperty()); await page.waitForTimeout(200);
ok(!posts['/property/add'], 'multi with no unit count is blocked');
await page.selectOption('#p-type', 'house');
await page.evaluate(() => window.submitAddProperty()); await page.waitForTimeout(300);
ok(posts['/property/add'] && posts['/property/add'].Unit_Count === '1' && posts['/property/add'].Commercial_Subtype === '', 'house add sends Unit_Count 1 and no sub-type');
// switching away from commercial clears a stale sub-type
await page.evaluate(() => window.openAddPropertyModal());
await page.selectOption('#p-type', 'commercial'); await page.selectOption('#p-subtype', 'office'); await page.selectOption('#p-type', 'house');
ok(await page.inputValue('#p-subtype') === '', 'leaving commercial clears the sub-type');

console.log('(3) Edit Property');
await page.evaluate(() => window.openEditPropertyModal('51'));
ok(await page.inputValue('#ep-type') === 'commercial' && await page.inputValue('#ep-subtype') === 'retail' && await page.locator('#ep-subtype-wrap').isVisible(), 'commercial property opens with sub-type prefilled and visible');
ok(await page.locator('#ep-units-section').isVisible(), 'commercial properties get the Units section');
await page.selectOption('#ep-subtype', 'office'); delete posts['/property/update'];
await page.evaluate(() => window.submitEditProperty()); await page.waitForTimeout(300);
ok(posts['/property/update'] && posts['/property/update'].fields.Commercial_Subtype === 'office' && posts['/property/update'].fields.Type === 'commercial', 'edit saves the new sub-type');
await page.evaluate(() => window.openEditPropertyModal('50'));
delete posts['/property/update'];
await page.evaluate(() => window.submitEditProperty()); await page.waitForTimeout(300);
ok(posts['/property/update'] && posts['/property/update'].fields.Unit_Count === '4', 'owner-onboarded multi (4 reported, 1 listed) keeps Unit_Count 4 instead of shrinking to 1', posts['/property/update'] && posts['/property/update'].fields.Unit_Count);
await page.evaluate(() => window.openEditPropertyModal('50'));
await page.selectOption('#ep-type', 'house'); delete posts['/property/update'];
await page.evaluate(() => window.submitEditProperty()); await page.waitForTimeout(300);
ok(posts['/property/update'] && posts['/property/update'].fields.Unit_Count === '1' && posts['/property/update'].fields.Commercial_Subtype === '', 'changing to a house sets count 1 and clears sub-type');

console.log('(4) Owner billing fields');
await page.evaluate(() => window.openAddOwnerModal());
for (const id of ['ao-b-name','ao-b-street','ao-b-city','ao-b-state','ao-b-zip','ao-b-phone','ao-b-email']) ok(await page.locator('#' + id).count() === 1, `Add Owner has #${id}`);
await page.fill('#ao-first', 'Kim'); await page.fill('#ao-b-street', '5 Bay St'); await page.fill('#ao-b-city', 'Towson'); await page.fill('#ao-b-state', 'md'); await page.fill('#ao-b-zip', '21204'); await page.fill('#ao-b-email', 'k@x.com');
await page.evaluate(() => window.submitAddOwner()); await page.waitForTimeout(300);
const ob = posts['/owner/add'];
ok(ob && ob.Billing_Address === '5 Bay St' && ob.Billing_City === 'Towson' && ob.Billing_State === 'MD' && ob.Billing_Zip === '21204' && ob.Billing_Email === 'k@x.com', 'Add Owner sends the billing address parts (state uppercased)', ob);
await page.evaluate(() => window.openAddOwnerModal());
ok(await page.inputValue('#ao-b-street') === '' && await page.inputValue('#ao-b-city') === '', 'Add Owner billing fields reset on reopen');
await page.evaluate(() => window.openEditOwnerModal('7'));
ok(await page.inputValue('#eo-b-street') === '12 Main St' && await page.inputValue('#eo-b-city') === 'Baltimore' && await page.inputValue('#eo-b-state') === 'MD' && await page.inputValue('#eo-b-zip') === '21201' && await page.inputValue('#eo-b-name') === 'Lee Holdings LLC' && await page.inputValue('#eo-b-email') === 'bill@x.com', 'Edit Owner shows the saved billing address');
await page.fill('#eo-b-street', '99 New Rd'); delete posts['/owner/update'];
await page.evaluate(() => window.submitEditOwner()); await page.waitForTimeout(400);
ok(posts['/owner/update'] && posts['/owner/update'].fields.Billing_Address === '99 New Rd' && posts['/owner/update'].fields.Billing_City === 'Baltimore', 'Edit Owner saves the billing address');

console.log('(6) Owner dropdowns: business first, else person, never blank');
await page.evaluate(() => window.openAddPropertyModal());
const optTexts = await page.locator('#p-owner option').allTextContents();
const optVals = await page.locator('#p-owner option').evaluateAll(els => els.map(e => e.value));
ok(optTexts[0] === 'No owner assigned', 'first option is the explicit "No owner assigned"');
ok(optTexts.slice(1).every(x => x.trim().length > 0 && !/undefined|null/i.test(x)), 'no blank/undefined owner options: ' + JSON.stringify(optTexts));
ok(optTexts.includes('Lee Holdings'), 'business name is the default label (Pat Lee → "Lee Holdings")');
ok(optTexts.includes('Ridge Co'), 'company-only owner shows its business name');
ok(optTexts.includes('Dan Glecker'), 'no business → the person\'s name is used');
ok(optTexts.includes('Owner #30'), 'a nameless owner still gets a non-blank label');
ok(optTexts.includes('Goldszmidt Properties — Adrian Goldszmidt') && optTexts.includes('Goldszmidt Properties — Jennifer Goldszmidt'), 'two contacts under one business are told apart by name');
ok(!optTexts.some(x => x.includes('Zed Inactive')), 'inactive owners are not offered when adding a property');
const sortedRest = optTexts.slice(1).map(x => x.toLowerCase());
ok(JSON.stringify(sortedRest) === JSON.stringify([...sortedRest].sort((a, b) => a.localeCompare(b))), 'options are sorted alphabetically');
ok(new Set(optTexts).size === optTexts.length, 'no two options look identical');
ok(!optVals.slice(1).some(v => !v), 'every real option has an owner id');
// other pickers use the same labels
await page.evaluate(() => window.openAddMasterKeyModal && window.openAddMasterKeyModal());
const mk = await page.locator('#mk-owner option').allTextContents();
ok(mk.slice(1).every(x => x.trim()) && mk.includes('Ridge Co'), 'master-key owner picker uses the same labels');
await page.evaluate(() => window.openBulkAccessModal && window.openBulkAccessModal());
const ba = await page.locator('#ba-owner option').allTextContents();
ok(ba.slice(1).every(x => x.trim()) && ba.includes('Dan Glecker'), 'bulk-access owner picker uses the same labels');
// Edit Property keeps an INACTIVE current owner selectable
PROPS.push({ ID: '52', Address: '5 Zed St', City: 'Baltimore', Type: 'house', Unit_Count: '1', Owner_ID: '18', Active: 'TRUE', Market: 'Baltimore' });
await page.evaluate(() => { window.state.properties.push({ ID: '52', Address: '5 Zed St', City: 'Baltimore', Type: 'house', Unit_Count: '1', Owner_ID: '18', Active: 'TRUE', Market: 'Baltimore' }); window.openEditPropertyModal('52'); });
ok(await page.locator('#ep-owner option:checked').textContent() === 'Zed Inactive Co', 'editing a property whose owner is inactive still shows that owner selected');
await page.evaluate(() => ['modal-add-property','modal-add-masterkey','modal-bulk-access','modal-edit-property'].forEach(id => window.closeModal(id)));

console.log('(5) Onboarding link modal');
await page.evaluate(() => window.openOwnerInviteModal());
await page.waitForSelector('#oi-list >> text=Lee Holdings');
const listTxt = await page.textContent('#oi-list');
ok(listTxt.includes('needs your review') && listTxt.includes('provide this later'), 'used invite shows it needs review, with the reason');
ok(listTxt.includes('Lee Holdings'), 'used invite resolves to the owner it created');
await page.fill('#oi-name', 'Dana Reyes'); await page.fill('#oi-note', '3 rowhomes'); await page.selectOption('#oi-days', '30');
await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.resolve(); });
await page.click('#oi-create-btn'); await page.waitForSelector('#oi-link');
ok((await page.inputValue('#oi-link')) === 'https://ridge-co.github.io/RidgeCo/owner-onboard.html?t=NEWTOKEN', 'link shown to copy');
ok(posts['/owner-onboard/invite/create'].name === 'Dana Reyes' && posts['/owner-onboard/invite/create'].days === 30, 'create sends name + expiry');
await page.waitForSelector('#oi-list >> text=Dana Reyes');
ok((await page.textContent('#oi-list')).includes('pending'), 'new invite listed as pending');
await page.click('#oi-list button:has-text("Revoke")'); await page.waitForTimeout(400);
ok(posts['/owner-onboard/invite/revoke'] && posts['/owner-onboard/invite/revoke'].id === '2', 'revoke sends the invite id');
ok((await page.textContent('#oi-list')).includes('revoked'), 'invite shows as revoked');
ok(await page.locator('#page-owners button:has-text("Owner Onboarding Link")').count() === 1, 'button is on the Owners page');
ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
