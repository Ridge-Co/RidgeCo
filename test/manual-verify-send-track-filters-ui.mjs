// Real-browser check of the Send & Track filter/sort bar. Loads the REAL markup + functions sliced out of
// index.html (no copies), stubs only api()/esc()/toast()/confirm(), and drives it in headless Chromium.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const mStart = html.indexOf('<!-- ── Send & Track: invoices in QuickBooks');
const mEnd = html.indexOf('<div style="border-top:1px solid var(--border);margin:22px 0 14px"></div>');
const jsStart = html.indexOf('var _stSendable = [];');
const jsEnd = html.indexOf('var _irBills = [];');
if ([mStart, mEnd, jsStart, jsEnd].some(n => n < 0)) throw new Error('markers not found in index.html');
const markup = html.slice(mStart, mEnd), js = html.slice(jsStart, jsEnd);

const inv = (id, customer, o = {}) => Object.assign({ id: String(id), doc: String(1000 + id), customer, total: 100, balance: 100, email: 'a@b.c', has_email: true, txn_date: '2026-09-01', due_date: '2026-09-15', days_overdue: 0, vendors: [], wo_ids: [], property_id: '', property_address: '', owner_id: '', owner_name: '' }, o);
const fixture = (extra = {}) => Object.assign({
  ok: true, counts: { not_sent: 4, overdue: 2, sent: 2, paid: 0 }, enrich_error: '',
  not_sent: [
    inv(1, 'Zed Owner:928 N Calvert', { vendors: ['Eddie Smith'], property_id: '10', property_address: '928 N Calvert St', owner_id: '1', owner_name: 'Zed Owner', total: 495, txn_date: '2026-09-05' }),
    inv(2, 'Alpha Owner:5 Main', { vendors: ['Cesar Diaz'], property_id: '11', property_address: '5 Main St', owner_id: '2', owner_name: 'Alpha Owner', total: 80, txn_date: '2026-08-01' }),
    inv(3, 'Mid Owner:9 Elm', { vendors: ['Cesar Diaz', 'Eddie Smith'], property_id: '12', property_address: '9 Elm', owner_id: '3', owner_name: 'Mid Owner', total: 300, txn_date: '2026-09-20' }),
    inv(4, 'Orphan Customer', { total: 50 }),
  ],
  overdue: [
    inv(5, 'Alpha Owner:5 Main', { vendors: ['Cesar Diaz'], property_id: '11', property_address: '5 Main St', owner_id: '2', owner_name: 'Alpha Owner', days_overdue: 40, total: 120 }),
    inv(6, 'Zed Owner:928 N Calvert', { vendors: ['Eddie Smith'], property_id: '10', property_address: '928 N Calvert St', owner_id: '1', owner_name: 'Zed Owner', days_overdue: 12, total: 60 }),
  ],
  sent: [
    inv(7, 'Mid Owner:9 Elm', { vendors: ['Eddie Smith'], property_id: '12', owner_id: '3', owner_name: 'Mid Owner', total: 20 }),
    inv(8, 'Alpha Owner:5 Main', { vendors: ['Cesar Diaz'], property_id: '11', owner_id: '2', owner_name: 'Alpha Owner', total: 10 }),
  ],
}, extra);

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; } else { fails++; console.log('FAIL:', m); } };

const browser = await chromium.launch();
async function newPage(data) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.setContent(`<!doctype html><html><head><style>:root{--surface:#fff;--surface2:#f4f4f4;--border:#ccc;--text:#111;--muted:#666;--accent:#06c;--font:sans-serif}</style></head><body><div id="page-invoice-review">${markup}</div>
  <script>
  window.__calls = [];
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function toast(){}
  window.confirm = function(m){ window.__confirm = m; return true; };
  function api(method, p, body){
    window.__calls.push({method:method, path:p, body:body});
    if (p === '/ar/invoices') return Promise.resolve(JSON.parse(${JSON.stringify(JSON.stringify(data))}));
    if (p === '/ar/remind') return Promise.resolve(body.preview ? {items: body.invoice_ids.map(function(id){return {id:id, customer:'c'+id, balance:1, willSend:true};})} : {items: body.invoice_ids.map(function(id){return {id:id, sent:true};})});
    return Promise.resolve({});
  }
  ${js}
  </script></body></html>`);
  await page.evaluate(() => loadSendTrack());
  await page.waitForSelector('#st-q');
  return { page, errors };
}
const visibleIds = (page) => page.evaluate(() => _stAll.filter(r => document.getElementById(r.rowId).style.display !== 'none').map(r => r.inv.id).sort());
const order = (page, sec) => page.evaluate((s) => Array.from(document.querySelectorAll('#st-sec-' + s + ' [data-st-row]')).map(e => e.querySelector('[style*="font-weight:600"]').textContent), sec);

// 1) renders everything, all row ids unique (sent rows used to all share "st-row-x")
{
  const { page, errors } = await newPage(fixture());
  ok((await visibleIds(page)).length === 8, 'all 8 rows visible by default');
  ok(await page.evaluate(() => { const ids = Array.from(document.querySelectorAll('[data-st-row]')).map(e => e.id); return new Set(ids).size === ids.length && ids.length === 8; }), 'row ids unique');
  ok((await page.textContent('#st-count')) === 'Showing 8 of 8 invoices', 'count line');
  const vOpts = await page.$$eval('#st-f-vendor option', o => o.map(x => x.textContent));
  ok(vOpts.join('|') === 'All vendors|Cesar Diaz|Eddie Smith|(No linked vendor)', 'vendor options ' + vOpts.join('|'));

  // 2) vendor filter (the reminder use-case) incl. combined invoice matching either vendor
  await page.selectOption('#st-f-vendor', 'Cesar Diaz');
  ok((await visibleIds(page)).join() === '2,3,5,8', 'Cesar invoices: ' + (await visibleIds(page)).join());
  ok((await page.textContent('#st-cnt-not_sent')) === '2 of 4', 'section count shows 2 of 4');
  await page.selectOption('#st-f-vendor', '__none__');
  ok((await visibleIds(page)).join() === '4', 'no-linked-vendor bucket');
  // 3) owner + property + status + customer
  await page.selectOption('#st-f-vendor', '');
  await page.selectOption('#st-f-owner', '2');
  ok((await visibleIds(page)).join() === '2,5,8', 'owner filter');
  await page.selectOption('#st-f-status', 'overdue');
  ok((await visibleIds(page)).join() === '5', 'owner + overdue');
  await page.click('text=Clear');
  ok((await visibleIds(page)).length === 8, 'clear restores all');
  await page.selectOption('#st-f-cust', 'Orphan Customer');
  ok((await visibleIds(page)).join() === '4', 'customer filter');
  // 4) search
  await page.click('text=Clear');
  await page.fill('#st-q', 'cesar');
  ok((await visibleIds(page)).join() === '2,3,5,8', 'search by vendor');
  await page.fill('#st-q', 'zzzz');
  ok(await page.isVisible('#st-nomatch'), 'no-match message');
  ok(errors.length === 0, 'no page errors: ' + errors.join(';'));
  await page.close();
}

// 5) sorting by customer reorders rows without losing checkbox state
{
  const { page } = await newPage(fixture());
  await page.evaluate(() => stToggleBulkMode());
  await page.check('[data-i="0"]');                                 // Zed, not_sent #1
  await page.selectOption('#st-sort', 'cust_az');
  const o = await order(page, 'not_sent');
  ok(o.join('|') === 'Alpha Owner:5 Main|Mid Owner:9 Elm|Orphan Customer|Zed Owner:928 N Calvert', 'customer A→Z: ' + o.join('|'));
  ok(await page.isChecked('[data-i="0"]'), 'checkbox state survives a sort');
  await page.selectOption('#st-sort', 'cust_za');
  ok((await order(page, 'not_sent'))[0] === 'Zed Owner:928 N Calvert', 'customer Z→A');
  await page.selectOption('#st-sort', 'amt_desc');
  ok((await order(page, 'not_sent'))[0] === 'Zed Owner:928 N Calvert', 'amount high→low (495 first)');
  await page.selectOption('#st-sort', 'overdue');
  ok((await order(page, 'overdue'))[0] === 'Alpha Owner:5 Main', 'most overdue first (40d)');
  await page.selectOption('#st-sort', '');
  ok((await order(page, 'not_sent'))[0] === 'Zed Owner:928 N Calvert', 'default restores server order');
  await page.close();
}

// 6) safety: a checked row hidden by a filter is neither counted nor sent
{
  const { page } = await newPage(fixture());
  await page.evaluate(() => stToggleBulkMode());
  await page.check('[data-i="0"]');                                 // Zed / Eddie
  await page.check('[data-i="1"]');                                 // Alpha / Cesar
  await page.selectOption('#st-f-vendor', 'Cesar Diaz');            // hides row 0
  const bar = await page.textContent('#st-bulk-count');
  ok(/^1 selected/.test(bar) && /1 more hidden by filters/.test(bar), 'bar excludes hidden: ' + bar);
  await page.evaluate(() => stBulkSend());
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls.filter(c => c.path === '/ar/remind'));
  ok(calls.length === 2 && calls.every(c => c.body.invoice_ids.join() === '2'), 'only the visible invoice previewed+sent: ' + JSON.stringify(calls.map(c => c.body.invoice_ids)));
  await page.close();
}

// 7) select-all-visible respects the filter
{
  const { page } = await newPage(fixture());
  await page.evaluate(() => stToggleBulkMode());
  await page.selectOption('#st-f-vendor', 'Eddie Smith');
  await page.evaluate(() => stSelectAllVisible(true));
  const n = await page.evaluate(() => stCheckedVisible().map(c => _stSendable[+c.dataset.i].inv.id).sort().join());
  ok(n === '1,3,6', 'select all visible = Eddie invoices that can be sent: ' + n);
  await page.close();
}

// 8) filters survive a refresh (re-render), and a failed Hub lookup is shown, not hidden
{
  const { page } = await newPage(fixture());
  await page.selectOption('#st-f-vendor', 'Cesar Diaz');
  await page.selectOption('#st-sort', 'cust_az');
  await page.evaluate(() => loadSendTrack());
  await page.waitForTimeout(100);
  ok((await page.inputValue('#st-f-vendor')) === 'Cesar Diaz' && (await page.inputValue('#st-sort')) === 'cust_az', 'filter + sort restored after refresh');
  ok((await visibleIds(page)).join() === '2,3,5,8', 'filter re-applied after refresh');
  await page.close();
  const bad = await newPage(fixture({ enrich_error: 'Sheets quota' }));
  ok(!(await bad.page.$('#st-f-vendor')), 'vendor select hidden when lookup failed');
  ok((await bad.page.textContent('#st-filters')).includes('Sheets quota'), 'lookup failure shown to the user');
  ok(await bad.page.$('#st-f-cust') !== null, 'customer filter still available');
  await bad.page.close();
}

await browser.close();
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
