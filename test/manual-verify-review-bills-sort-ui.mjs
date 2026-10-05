// Real-browser check of the Vendor Bill Review sort + visible-only bulk approve. Real functions sliced from index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const a = html.indexOf('function irBillContext(b) {');
const b = html.indexOf('// Receipts_JSON is already on the bill object');
const c = html.indexOf('// A checked card that a filter has since hidden is NOT approved');
const d = html.indexOf('function irBulkApprove() {');
if ([a, b, c, d].some(n => n < 0)) throw new Error('markers not found');
const js = html.slice(a, b) + '\n' + html.slice(c, d);

const bills = [
  { ID: 'b1', WO_ID: 'W1', Vendor_Name: 'Eddie Smith', Total: '300', Created_Date: '2026-09-10T10:00:00Z', Pending_Info: 'TRUE' },
  { ID: 'b2', WO_ID: 'W2', Vendor_Name: 'Cesar Diaz', Total: '80', Created_Date: '2026-08-01T10:00:00Z' },
  { ID: 'b3', WO_ID: 'W3', Vendor_Name: 'Cesar Diaz', Total: '500', Created_Date: '2026-09-20T10:00:00Z' },
  { ID: 'b4', WO_ID: '',   Vendor_Name: 'Abe Standalone', Total: '50', Created_Date: '2026-09-01T10:00:00Z' },
];
const state = {
  workorders: [{ ID: 'W1', Property_ID: 'P1' }, { ID: 'W2', Property_ID: 'P2' }, { ID: 'W3', Property_ID: 'P3' }],
  properties: [{ ID: 'P1', Address: '9 Zebra St', Owner_ID: 'O1' }, { ID: 'P2', Address: '5 Main St', Owner_ID: 'O2' }, { ID: 'P3', Address: '1 Apple Ln', Owner_ID: 'O2' }],
  owners: [{ ID: 'O1', First_Name: 'Zed', Last_Name: 'Owner' }, { ID: 'O2', First_Name: 'Alpha', Last_Name: 'Owner' }],
};

let fails = 0, passes = 0;
const ok = (cond, m) => { if (cond) passes++; else { fails++; console.log('FAIL:', m); } };
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.setContent(`<!doctype html><html><body><div id="ir-filters"></div><div id="ir-bulk-bar"><span id="ir-bulk-count"></span><button id="ir-bulk-approve-btn"></button></div><div id="ir-list"></div>
<script>
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function safeArray(x){ return Array.isArray(x)?x:[]; }
var state = ${JSON.stringify(state)};
var _irBills = ${JSON.stringify(bills)};
${js}
document.getElementById('ir-list').innerHTML = _irBills.map(function(b,i){ return '<div id="ir-card-'+i+'"><span class="v">'+b.Vendor_Name+'</span><input type="checkbox" class="ir-bulk-check" data-i="'+i+'" onchange="irUpdateBulkBar()"><input id="inv-charge-ir'+i+'" value="'+b.Total+'"></div>'; }).join('');
irBuildFilters(); irApplyFilters();
</script></body></html>`);

const order = () => page.$$eval('#ir-list > div', els => els.map(e => e.querySelector('.v').textContent));
const sel = (id, v) => page.selectOption('#' + id, v);

ok(await page.$('#ir-sort') !== null, 'sort dropdown exists');
ok(JSON.stringify(await order()) === JSON.stringify(['Eddie Smith', 'Cesar Diaz', 'Cesar Diaz', 'Abe Standalone']), 'default keeps queue order');
await sel('ir-sort', 'vendor_az');
ok(JSON.stringify(await order()) === JSON.stringify(['Abe Standalone', 'Cesar Diaz', 'Cesar Diaz', 'Eddie Smith']), 'vendor A-Z: ' + await order());
await sel('ir-sort', 'vendor_za');
ok((await order())[0] === 'Eddie Smith', 'vendor Z-A first');
await sel('ir-sort', 'owner_az');
{ const o = await order(); ok(o[o.length - 1] === 'Abe Standalone' || o[0] === 'Abe Standalone', 'owner A-Z runs'); }
await sel('ir-sort', 'amt_desc');
ok(JSON.stringify(await order()) === JSON.stringify(['Cesar Diaz', 'Eddie Smith', 'Cesar Diaz', 'Abe Standalone']), 'amount high-low: ' + await order());
await sel('ir-sort', 'amt_asc');
ok((await order())[0] === 'Abe Standalone', 'amount low-high first');
await sel('ir-sort', 'date_old');
ok((await order())[0] === 'Cesar Diaz', 'oldest first');
await sel('ir-sort', 'date_new');
ok(JSON.stringify(await order()) === JSON.stringify(['Cesar Diaz', 'Eddie Smith', 'Abe Standalone', 'Cesar Diaz']), 'newest first: ' + await order());
await sel('ir-sort', '');
ok((await order())[0] === 'Eddie Smith', 'back to default order');

// sort + filter together; count text; ids intact
await sel('ir-sort', 'amt_desc'); await sel('ir-f-vendor', 'Cesar Diaz');
ok(await page.textContent('#ir-count') === 'Showing 2 of 4 bills', 'count with filter+sort');
const visible = await page.$$eval('#ir-list > div', els => els.filter(e => e.style.display !== 'none').map(e => e.id));
ok(JSON.stringify(visible) === JSON.stringify(['ir-card-2', 'ir-card-1']), 'filtered+sorted visible ids: ' + visible);

// Clear resets sort too
await page.click('text=Clear');
ok(await page.inputValue('#ir-sort') === '' && (await order())[0] === 'Eddie Smith', 'Clear resets sort + order');

// checkbox state survives a re-sort
await page.check('.ir-bulk-check[data-i="2"]');
await sel('ir-sort', 'vendor_za');
ok(await page.isChecked('.ir-bulk-check[data-i="2"]'), 'checkbox persists across sort');

// hidden-checked safety
await page.check('.ir-bulk-check[data-i="0"]');
await sel('ir-sort', ''); await sel('ir-f-vendor', 'Cesar Diaz');
let txt = await page.textContent('#ir-bulk-count');
ok(/1 selected/.test(txt) && /1 more hidden by filters/.test(txt), 'hidden checked excluded + noted: ' + txt);
ok(await page.evaluate(() => irCheckedVisible().map(x => x.getAttribute('data-i')).join()) === '2', 'only visible checked returned');

// rebuild keeps selections (approve/flag reloads)
await page.evaluate(() => { irBuildFilters(); irApplyFilters(); });
ok(await page.inputValue('#ir-f-vendor') === 'Cesar Diaz', 'filter survives rebuild');
await sel('ir-sort', 'amt_asc');
await page.evaluate(() => { irBuildFilters(); irApplyFilters(); });
ok(await page.inputValue('#ir-sort') === 'amt_asc', 'sort survives rebuild');

ok(errors.length === 0, 'no page errors: ' + errors.join('|'));
await browser.close();
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
