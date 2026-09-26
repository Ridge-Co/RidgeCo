// Headless Playwright pass for the owner self-serve onboarding page (owner-onboard.html), phone viewport.
// Loads the REAL shipped page; only the Worker's own fetch endpoints are intercepted (page.route).
// Covers: dead link, prefill, step validation (name/business choice, billing, PIN rules + availability),
// property type/unit-count rules (house=1 locked, multi/condo required, commercial subtype), the
// "one unit of a multi" path, vacant→lockbox/no-lockbox rules, "provide later" rule, SMS consent
// unchecked by default, exact payload sent to /owner-onboard/submit, server-error mapping, success screen.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + join(here, '..', 'owner-onboard.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const seen = { submit: null, pinChecks: [] };
  const consoleErrors = []; page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.route('**/owner-onboard/info**', r => r.fulfill({ json: opts.info || { valid: true, prefill: { first: 'Pat', last: 'Lee', phone: '4105550142', email: 'pat@example.com' } } }));
  await page.route('**/owner-onboard/check-pin', r => { const b = JSON.parse(r.request().postData()); seen.pinChecks.push(b.pin); r.fulfill({ json: b.pin === 'TAK12849' ? { ok: true, available: false, reason: 'That PIN is already taken — please try a different one.' } : { ok: true, available: true, reason: '' } }); });
  await page.route('**/owner-onboard/submit', r => { seen.submit = JSON.parse(r.request().postData()); r.fulfill(opts.submitResponse || { json: { success: true, first_name: 'Pat', properties: 1 } }); });
  await page.goto(page_url + '?t=' + (opts.token ?? 'abcdefghijklmnopqrstuvwx'));
  return { page, seen, consoleErrors, ctx };
}
const errShown = (page, path) => page.locator(`[data-e="${path}"].show`).count().then(n => n > 0);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

console.log('Dead links');
{
  let { page, ctx } = await newPage({ token: '' });
  ok((await page.textContent('#app')).includes('personal link'), 'no token → asks for the personal link');
  await ctx.close();
  ({ page, ctx } = await newPage({ info: { valid: false, message: 'This link has expired. Please ask us for a new one.' } }));
  ok((await page.textContent('#app')).includes('expired'), 'expired link shows the server message');
  ok(await page.locator('#next').count() === 0, 'no form is shown on a dead link');
  await ctx.close();
}

console.log('Step 1: about you / billing / PIN');
const { page, seen, consoleErrors } = await newPage();
ok(await page.inputValue('[id="owner.first"]') === 'Pat' && await page.inputValue('[id="owner.phone"]') === '4105550142', 'invite prefill fills name/phone/email');
ok(await noHScroll(page), 'no horizontal scroll at 390px (step 1)');
await page.fill('[id="owner.first"]', ''); await page.fill('[id="owner.billing_email"]', '');
await page.click('#next');
ok(await errShown(page, 'owner.first'), 'blank first name is flagged');
ok(await errShown(page, 'owner.business_choice'), 'business-vs-name choice is REQUIRED (nothing preselected)');
ok(await errShown(page, 'owner.billing_email') && await errShown(page, 'owner.billing_address.street') && await errShown(page, 'owner.billing_address.zip'), 'billing email + address parts flagged');
ok(await errShown(page, 'owner.pin'), 'PIN is required');
ok((await page.textContent('.steplbl')).includes('Step 1 of 3'), 'still on step 1 after failed Continue');
await page.fill('[id="owner.first"]', 'Pat');
await page.fill('[id="owner.billing_email"]', 'pat@example.com');
await page.click('text=I have a business name');
ok(await page.locator('[id="owner.business_name"]').count() === 1, 'business name input appears when business chosen');
await page.click('text=Use my name');
ok(await page.locator('[id="owner.business_name"]').count() === 0, 'business name input hidden for "use my name"');
await page.fill('[id="owner.billing_address.street"]', '12 Main St'); await page.fill('[id="owner.billing_address.city"]', 'Baltimore');
await page.selectOption('[id="owner.billing_address.state"]', 'MD'); await page.fill('[id="owner.billing_address.zip"]', '21201');
// PIN rules
await page.fill('[id="owner.pin"]', 'abc12345');
ok(await page.locator('#rules li.ok').count() === 2, 'sequential PIN: letters+numbers ok but "simple run" rule not satisfied');
await page.fill('[id="owner.pin"]', 'tak12849'); await page.waitForTimeout(800);
ok((await page.textContent('#pinstat')).includes('already taken'), 'taken PIN is reported live from the server');
await page.click('text=Suggest'); await page.waitForTimeout(800);
const suggested = await page.inputValue('[id="owner.pin"]');
ok(/^[A-Z]{3}\d{5}$/.test(suggested), 'Suggest produces a valid 3-letters + 5-digits PIN: ' + suggested);
ok((await page.textContent('#pinstat')).includes('available'), 'suggested PIN is confirmed available');
await page.fill('[id="owner.pin"]', 'XKQ90417'); await page.waitForTimeout(800);
await page.click('#next');
ok((await page.textContent('.steplbl')).includes('Step 2 of 3'), 'valid step 1 advances to step 2');

console.log('Step 2: properties / units');
ok(await noHScroll(page), 'no horizontal scroll at 390px (step 2)');
await page.click('#next');
ok(await errShown(page, 'properties[0].address') && await errShown(page, 'properties[0].type'), 'empty property is flagged');
await page.fill('[id="properties[0].address"]', '9 Elm St'); await page.fill('[id="properties[0].city"]', 'Winchester');
await page.selectOption('[id="properties[0].type"]', 'house');
ok(await page.locator('[id="properties[0].unit_count"]').count() === 0, 'house: no unit-count input; shown as 1 unit');
ok((await page.textContent('#app')).includes('1 unit'), 'house shows the fixed "1 unit" tag');
ok(await page.locator('[id="properties[0].units[0].label"]').count() === 0, 'house: no unit-label input');
await page.selectOption('[id="properties[0].type"]', 'multi');
ok(await page.locator('[id="properties[0].unit_count"]').count() === 1, 'multi: unit-count input required');
ok(await page.locator('[id="properties[0].units[0].label"]').count() === 1, 'multi: unit label input appears');
await page.selectOption('[id="properties[0].type"]', 'commercial');
ok(await page.locator('[id="properties[0].subtype"]').count() === 1, 'commercial: sub-type picker appears');
const subs = await page.locator('[id="properties[0].subtype"] option').allTextContents();
ok(['Retail','Mixed use','Industrial','Office'].every(x => subs.includes(x)), 'sub-types are retail / mixed use / industrial / office');
await page.selectOption('[id="properties[0].type"]', 'condo');
ok(await page.locator('[id="properties[0].subtype"]').count() === 0, 'sub-type disappears for non-commercial');
await page.selectOption('[id="properties[0].type"]', 'multi');
await page.click('#next');
ok(await errShown(page, 'properties[0].unit_count'), 'multi with no unit count is flagged');
await page.fill('[id="properties[0].unit_count"]', '1'); await page.click('#next');
ok((await page.locator('[data-e="properties[0].unit_count"]').textContent()).includes('2 or more'), 'multi count of 1 rejected with a clear message');
await page.fill('[id="properties[0].unit_count"]', '4');
await page.fill('[id="properties[0].units[0].label"]', 'Apt 2');
await page.click('#next');
ok(await errShown(page, 'properties[0].units[0].status'), 'unit occupancy choice is required');
// vacant + lockbox
await page.click('[name="properties[0].units[0].status"][value="vacant"]');
await page.click('#next');
ok(await errShown(page, 'properties[0].units[0].access.method'), 'vacant: must select lockbox or no lockbox');
await page.click('[name="properties[0].units[0].access.method"][value="none"]');
await page.click('#next');
ok(await errShown(page, 'properties[0].units[0].access.note'), 'vacant + no lockbox: access note required');
await page.click('[name="properties[0].units[0].access.method"][value="lockbox"]');
await page.click('#next');
ok(await errShown(page, 'properties[0].units[0].access.code'), 'vacant + lockbox: code required');
await page.click('[name="properties[0].units[0].access.method"][value="none"]');
await page.fill('[id="properties[0].units[0].access.note"]', 'Key with listing agent, call 410-555-0100');
// "later" alone must not pass
await page.click('[name="properties[0].units[0].status"][value="later"]');
await page.click('#next');
ok((await page.textContent('#app')).includes('at least one unit that is occupied'), '"provide later" alone is rejected with an explanation');
// tenant
await page.click('[name="properties[0].units[0].status"][value="tenant"]');
await page.click('#next');
ok(await errShown(page, 'properties[0].units[0].tenant.first') && await errShown(page, 'properties[0].units[0].tenant.phone'), 'occupied: tenant name + phone required');
await page.click('[name="properties[0].units[0].status"][value="vacant"]');
await page.click('[name="properties[0].units[0].access.method"][value="lockbox"]');
await page.fill('[id="properties[0].units[0].access.code"]', '4421');
await page.fill('[id="properties[0].units[0].access.location"]', 'left of door');
// second unit marked "later" is allowed alongside a resolved one
await page.click('text=+ Add another unit');
await page.fill('[id="properties[0].units[1].label"]', 'Apt 3');
await page.click('[name="properties[0].units[1].status"][value="later"]');
// add a second property (single-family, occupied)
await page.click('text=+ Add another property');
await page.fill('[id="properties[1].address"]', '5 Oak Ave'); await page.fill('[id="properties[1].city"]', 'Baltimore');
await page.selectOption('[id="properties[1].type"]', 'rowhome');
await page.click('[name="properties[1].units[0].status"][value="tenant"]');
await page.fill('[id="properties[1].units[0].tenant.first"]', 'Sam'); await page.fill('[id="properties[1].units[0].tenant.phone"]', '(410) 555-0199');
ok(await noHScroll(page), 'no horizontal scroll at 390px with multiple properties/units');
await page.click('#next');
ok((await page.textContent('.steplbl')).includes('Step 3 of 3'), 'valid step 2 advances to step 3');

console.log('Step 3: review + consent + submit');
const summary = await page.textContent('.sum');
ok(summary.includes('9 Elm St') && summary.includes('5 Oak Ave') && summary.includes('Unit Apt 2') && summary.includes('vacant') && summary.includes('tenant Sam'), 'review lists both properties and unit statuses');
ok(await page.isChecked('#consent') === false, 'SMS permission checkbox is UNCHECKED by default');
const consentText = await page.textContent('.consent');
ok(consentText.includes('STOP') && consentText.includes('Consent isn') && consentText.includes('SMS Terms'), 'consent copy has opt-out, not-a-condition, and terms link');
ok(await page.locator('.consent a[href="https://bmoremanagement.com/sms-terms"]').count() === 1 && await page.locator('.consent a[href="https://bmoremanagement.com/sms-privacy"]').count() === 1, 'links point at the real SMS terms/privacy pages');
await page.check('#consent');
await page.click('#next');
await page.waitForSelector('text=all set');
const b = seen.submit;
ok(b && b.token === 'abcdefghijklmnopqrstuvwx', 'token sent with submit');
ok(b.owner.first === 'Pat' && b.owner.business_choice === 'name' && b.owner.pin === 'XKQ90417' && b.owner.billing_address.state === 'MD', 'owner payload correct');
ok(b.sms_consent === true && b.consent_version, 'consent + version sent');
ok(b.properties.length === 2 && b.properties[0].type === 'multi' && String(b.properties[0].unit_count) === '4' && b.properties[0].units.length === 2, 'multi: declared count 4 but only 2 units listed');
ok(b.properties[0].units[0].status === 'vacant' && b.properties[0].units[0].access.method === 'lockbox' && b.properties[0].units[0].access.code === '4421', 'vacant lockbox unit payload');
ok(b.properties[1].type === 'rowhome' && b.properties[1].unit_count === 1 && b.properties[1].units[0].tenant.first === 'Sam', 'rowhome forced to 1 unit with tenant');
ok((await page.textContent('#app')).includes('Pat') && !(await page.textContent('#app')).includes('XKQ90417'), 'success screen greets by name and never echoes the PIN');
ok(await page.evaluate(() => Object.keys(localStorage).every(k => !k.startsWith('oo_draft_'))), 'draft cleared after success');
ok(consoleErrors.length === 0, 'no uncaught page errors' + (consoleErrors.length ? ': ' + consoleErrors[0] : ''));

console.log('Server-side rejection mapping');
{
  const r = await newPage({ submitResponse: { status: 422, json: { error: 'Please fix the highlighted items.', errors: [{ field: 'owner.pin', message: 'That PIN is already taken — please try a different one.' }] } } });
  const p = r.page;
  await p.click('text=Use my name'); await p.fill('[id="owner.billing_address.street"]', '12 Main St'); await p.fill('[id="owner.billing_address.city"]', 'Baltimore');
  await p.selectOption('[id="owner.billing_address.state"]', 'MD'); await p.fill('[id="owner.billing_address.zip"]', '21201'); await p.fill('[id="owner.pin"]', 'XKQ90417'); await p.waitForTimeout(700);
  await p.click('#next');
  await p.fill('[id="properties[0].address"]', '5 Oak Ave'); await p.fill('[id="properties[0].city"]', 'Baltimore'); await p.selectOption('[id="properties[0].type"]', 'house');
  await p.click('[name="properties[0].units[0].status"][value="vacant"]'); await p.click('[name="properties[0].units[0].access.method"][value="lockbox"]'); await p.fill('[id="properties[0].units[0].access.code"]', '1290');
  await p.click('#next'); await p.click('#next');
  await p.waitForSelector('text=Step 1 of 3');
  ok(await errShown(p, 'owner.pin'), 'server PIN rejection sends the owner back to step 1 with the PIN flagged');
  ok(!(await p.textContent('#app')).includes('all set'), 'no success screen on a rejection');
  await r.ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
