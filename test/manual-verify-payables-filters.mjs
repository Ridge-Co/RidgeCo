// Headless verification for the Payables (Who To Pay) grouping/collapsing/filtering rebuild.
// Mocks the worker endpoints so this runs offline against the real index.html markup/JS —
// same pattern as test/manual-verify-duplicate-checker.mjs.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, '..', 'index.html');

const workorders = [
  { ID: 'WO-9001', Property_ID: 'P1', Trade: 'Plumbing', Status: 'Invoiced', Description: 'Fix leak', Owner_WO_Ref: '' },
  { ID: 'WO-9002', Property_ID: 'P2', Trade: 'General',  Status: 'Invoiced', Description: 'Deck repair', Owner_WO_Ref: '' },
  { ID: 'WO-9003', Property_ID: 'P1', Trade: 'Plumbing', Status: 'Invoiced', Description: 'Water heater', Owner_WO_Ref: '' },
  { ID: 'WO-9004', Property_ID: 'P3', Trade: 'Locksmith',Status: 'Invoiced', Description: 'Rekey unit', Owner_WO_Ref: '' },
  { ID: 'WO-9005', Property_ID: 'P2', Trade: 'General',  Status: 'Invoiced', Description: 'Gutter clean', Owner_WO_Ref: '' },
  { ID: 'WO-9006', Property_ID: 'P1', Trade: 'Plumbing', Status: 'Invoiced', Description: 'Faucet swap', Owner_WO_Ref: '' },
  { ID: 'WO-9007', Property_ID: 'P3', Trade: 'Locksmith',Status: 'Invoiced', Description: 'New locks', Owner_WO_Ref: '' },
  { ID: 'WO-9008', Property_ID: 'P2', Trade: 'General',  Status: 'Invoiced', Description: 'Paint touch-up', Owner_WO_Ref: '' },
];
const properties = [
  { ID: 'P1', Address: '123 Main St', Owner_ID: 'O1', Active: 'TRUE' },
  { ID: 'P2', Address: '456 Oak Ave', Owner_ID: 'O2', Active: 'TRUE' },
  { ID: 'P3', Address: '789 Pine Rd', Owner_ID: 'O1', Active: 'TRUE' },
];
const owners = [
  { ID: 'O1', First_Name: 'Jane', Last_Name: 'Smith' },
  { ID: 'O2', First_Name: 'Bob', Last_Name: 'Jones' },
];
const vendors = [];

function payRow(wo_id, vendor_name, state, extra) {
  return Object.assign({
    ir_id: wo_id + '-ir', wo_id: wo_id, vendor_id: '', vendor_name: vendor_name, terms: 'Due on receipt',
    invoice_id: 'INV-' + wo_id, invoice_number: wo_id.replace('WO-', ''),
    customer_total: 500, customer_balance: 0, customer_paid: true, customer_partial: false,
    bill_id: 'BILL-' + wo_id, vendor_ref: '', vendor_cost: 300,
    vendor_balance: 300, vendor_paid: false, vendor_partial: false,
    bill_due: '2026-09-20', in_house: false, state: state, possible_duplicate: null
  }, extra || {});
}

const payablesRows = [
  payRow('WO-9001', 'Acme Plumbing', 'possible duplicate', { possible_duplicate: { amount: 300, payment_type: 'Check', date: '2026-09-01', doc: '', note: 'looks like a dupe' } }),
  payRow('WO-9002', 'Cesar Gomez', 'PAY THE VENDOR'),
  payRow('WO-9003', 'Acme Plumbing', 'owner paid in part', { customer_paid: false, customer_partial: true, customer_balance: 100 }),
  payRow('WO-9004', "Robert's Key Service", 'waiting on the owner', { customer_paid: false, customer_balance: 500 }),
  payRow('WO-9005', 'Cesar Gomez', 'unknown', { customer_paid: null, customer_balance: null }),
  payRow('WO-9006', 'Acme Plumbing', 'vendor paid', { vendor_paid: true, vendor_balance: 0 }),
  payRow('WO-9007', "Robert's Key Service", 'vendor paid', { vendor_paid: true, vendor_balance: 0 }),
  payRow('WO-9008', '', 'nothing to pay', { in_house: true, bill_id: '' }),
];

const results = [];
function check(label, cond) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.route('**/*maintenance-hub.brett-2f8.workers.dev/**', async (route) => {
  const url = route.request().url();
  let body = { ok: true };
  if (url.includes('/qb/payables')) body = { ok: true, count: payablesRows.length, owed_now: 1, owed_total: 300, rows: payablesRows };
  else if (url.includes('/workorders')) body = workorders;
  else if (url.includes('/properties')) body = properties;
  else if (url.includes('/units')) body = [];
  else if (url.includes('/vendors')) body = vendors;
  else if (url.includes('/owners')) body = owners;
  else if (url.includes('/health')) body = { ok: true };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto('file://' + indexPath);
await page.waitForTimeout(300);
// This offline mock never simulates the login gate (GET /config) — #app stays display:none
// until that succeeds, which silently makes every element inside it invisible to Playwright's
// visibility checks (page.fill()/page.click() correctly refuse to act on a 0×0 element). Skip
// straight to the already-logged-in state, same as any real returning user sees.
await page.evaluate(() => {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
});
await page.waitForTimeout(500);

// Navigate to Payables the same way a real click would (exercises showPage's auto-load branch).
await page.evaluate(() => { showPage('payables', null); });
await page.waitForTimeout(600);

// ── Filter bar present ──
check('search box rendered', await page.locator('#pay-q').count() === 1);
check('state filter rendered', await page.locator('#pay-f-state').count() === 1);
check('vendor filter rendered', await page.locator('#pay-f-vendor').count() === 1);
check('property filter rendered', await page.locator('#pay-f-prop').count() === 1);
check('owner filter rendered', await page.locator('#pay-f-owner').count() === 1);
check('trade filter rendered', await page.locator('#pay-f-trade').count() === 1);

// ── Grouping / default collapse state ──
const detailsState = await page.evaluate(() => {
  var out = {};
  document.querySelectorAll('#payables-body details').forEach(function(d) {
    var label = d.querySelector('summary').textContent;
    out[label] = d.open;
  });
  return out;
});
console.log('details open-state map:', JSON.stringify(detailsState));

// Group headers are styled uppercase via CSS text-transform (matching this codebase's existing
// per-row state-badge convention) rather than literal-uppercase markup, so textContent stays
// mixed-case even though the header reads as caps on screen — compare case-insensitively.
function findKey(map, needle) { var n = needle.toUpperCase(); return Object.keys(map).find(function(k) { return k.toUpperCase().indexOf(n) === 0; }); }
const vendorPaidKey = findKey(detailsState, 'VENDOR PAID');
const nothingKey = findKey(detailsState, 'NOTHING TO PAY');
const payVendorKey = findKey(detailsState, 'PAY THE VENDOR');
const partKey = findKey(detailsState, 'OWNER PAID IN PART');

check('"vendor paid" group exists and is collapsed by default', vendorPaidKey && detailsState[vendorPaidKey] === false);
check('"nothing to pay" group exists and is collapsed by default', nothingKey && detailsState[nothingKey] === false);
check('"PAY THE VENDOR" group exists and is open by default', payVendorKey && detailsState[payVendorKey] === true);
check('"owner paid in part" group exists and is open by default', partKey && detailsState[partKey] === true);
check('"vendor paid" count shows (2)', !!vendorPaidKey && vendorPaidKey.indexOf('(2)') !== -1);

const alwaysVisible = await page.evaluate(() => {
  var body = document.getElementById('payables-body');
  var t = body.textContent.toUpperCase();
  return {
    unknown: t.indexOf('UNKNOWN (1)') !== -1,
    waiting: t.indexOf('WAITING ON THE OWNER (1)') !== -1,
    dup: t.indexOf('POSSIBLE DUPLICATE') !== -1,
  };
});
check('"unknown" section always visible (no toggle)', alwaysVisible.unknown);
check('"waiting on the owner" section always visible (no toggle)', alwaysVisible.waiting);
check('"possible duplicate" section always visible (no toggle)', alwaysVisible.dup);

// ── Banner + count line ──
const bannerText = await page.locator('#payables-body').first().evaluate((el) => el.textContent.slice(0, 400));
check('banner shows correct vendor-waiting total', bannerText.includes('1 vendor waiting on $300.00'));
const countText = await page.locator('#pay-count').textContent();
check('count line shows all 8 rows initially', countText.trim() === 'Showing 8 of 8 payable rows');

// ── Search narrows + force-opens a normally-collapsed group ──
await page.fill('#pay-q', 'Robert');
await page.waitForTimeout(200);
const afterSearch = await page.evaluate(() => {
  var out = { count: document.getElementById('pay-count').textContent, details: {} };
  document.querySelectorAll('#payables-body details').forEach(function(d) {
    out.details[d.querySelector('summary').textContent] = d.open;
  });
  return out;
});
console.log('after search "Robert":', JSON.stringify(afterSearch));
check('search "Robert" narrows to 2 rows (WO-9004 waiting, WO-9007 vendor paid)', afterSearch.count.trim() === 'Showing 2 of 8 payable rows');
const vendorPaidKey2 = findKey(afterSearch.details, 'VENDOR PAID');
check('active search forces the normally-collapsed "vendor paid" group open', vendorPaidKey2 && afterSearch.details[vendorPaidKey2] === true);

// ── Clear restores original state ──
await page.click('button[onclick="payablesClearFilters()"]');
await page.waitForTimeout(200);
const afterClear = await page.locator('#pay-count').textContent();
check('Clear button restores full 8-row view', afterClear.trim() === 'Showing 8 of 8 payable rows');
const clearedDetails = await page.evaluate(() => {
  var out = {};
  document.querySelectorAll('#payables-body details').forEach(function(d) { out[d.querySelector('summary').textContent] = d.open; });
  return out;
});
const vendorPaidKey3 = findKey(clearedDetails, 'VENDOR PAID');
check('Clear button restores "vendor paid" back to collapsed', vendorPaidKey3 && clearedDetails[vendorPaidKey3] === false);

// ── Vendor filter ──
await page.selectOption('#pay-f-vendor', "Robert's Key Service");
await page.waitForTimeout(200);
const afterVendorFilter = await page.locator('#pay-count').textContent();
check('vendor filter narrows to Robert\'s Key Service rows (2)', afterVendorFilter.trim() === 'Showing 2 of 8 payable rows');

// ── Property filter dropdown has the right addresses ──
const propOptions = await page.locator('#pay-f-prop option').allTextContents();
check('property filter lists resolved addresses', propOptions.includes('123 Main St') && propOptions.includes('456 Oak Ave') && propOptions.includes('789 Pine Rd'));

// ── Owner filter dropdown resolves owner names ──
const ownerOptions = await page.locator('#pay-f-owner option').allTextContents();
check('owner filter lists resolved owner names', ownerOptions.some((t) => t.includes('Jane') && t.includes('Smith')) && ownerOptions.some((t) => t.includes('Bob') && t.includes('Jones')));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) {
  console.log('FAILURES:', failed.map((f) => f.label).join('; '));
  process.exit(1);
}
process.exit(0);
