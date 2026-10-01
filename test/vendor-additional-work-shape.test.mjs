// Server -> client SHAPE test (Sep 30 2026). The REAL addonList (worker.js) is executed against fixture sheets, its JSON output
// is fed through the REAL client parsing/rendering functions extracted from vendor.html and index.html and executed here.
// A server/client contract mismatch (the earlier BLOCKERs: missing success/items/estimate_status) fails this test.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync('worker.js', 'utf8');
const vendor = fs.readFileSync('vendor.html', 'utf8');
const admin = fs.readFileSync('index.html', 'utf8');
function grabAny(text, prefix, name) {
  const i = text.indexOf(prefix + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let pd = 0, k = text.indexOf('(', i);
  for (; k < text.length; k++) { if (text[k] === '(') pd++; else if (text[k] === ')') { pd--; if (!pd) break; } }
  let d = 0, j = text.indexOf('{', k);
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const W = grabAny.bind(null, src, 'function '), WA = grabAny.bind(null, src, 'async function ');
const grab0 = f => new Function(W(f) + '\nreturn ' + f + ';')();

// ---- real server output ----
const json = d => ({ _d: d });
const wos = [
  { ID: 'WO-1', Vendor_ID: 'V1', Type: 'manual' },
  ...[['11', 'Approved'], ['12', 'Pending'], ['13', 'Needs Info'], ['14', 'Declined'], ['15', 'Converted']].map(([i]) => ({ ID: 'WO-' + i, Vendor_ID: 'V1', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Submitted', Addon_Items_JSON: '[{"index":0,"desc":"item ' + i + '"}]', Created_Date: i })),
  { ID: 'WO-2', Vendor_ID: 'V2', Type: 'manual' },
  { ID: 'WO-21', Vendor_ID: 'V2', Type: 'addon', Parent_WO_ID: 'WO-2', Addon_Status: 'Submitted', Addon_Items_JSON: '[{"index":0,"desc":"other vendor"}]', Created_Date: '1' },
];
const ests = [['11', 'Approved'], ['12', 'Pending'], ['13', 'Needs Info'], ['14', 'Declined'], ['15', 'Converted'], ['21', 'Pending']].map(([i, s]) => ({ ID: 'E' + i, WO_ID: 'WO-' + i, Version: '1', Status: s, Subtotal: '100.00', Line_Items: '[]', Active: 'TRUE' }));
const list = new Function('json', 'fetchTabs', 'findWO', 'addonIsDraft', 'addonParseItems', 'addonLatestEstimate', 'addonPhotosByItem', 'ADDON_PHOTO_TYPES', WA('addonList') + '\nreturn addonList;')(
  json, async () => [wos, ests, []], (l, id) => l.find(w => w.ID === id) || null, grab0('addonIsDraft'), grab0('addonParseItems'), grab0('addonLatestEstimate'), grab0('addonPhotosByItem'), ['before', 'photo']);
const call = async (parent, role, id) => JSON.parse(JSON.stringify((await list({}, { searchParams: { get: k => (k === 'parent_wo_id' ? parent : null) } }, role, id))._d));   // round-trip = what the wire delivers
const vendorJson = await call('', 'vendor', 'V1');
const adminJson = await call('WO-1', 'admin', '');

// ---- vendor.html: REAL loadVendorAddons + renderVendorAddons + awStatusInfo ----
{
  const fn = n => grabAny(vendor, 'function ', n);
  const wraps = {};
  const document = { getElementById: id => (wraps[id] = wraps[id] || { innerHTML: '' }) };
  const window = { _wos: [{ ID: 'WO-1' }] };
  let apiCalls = 0;
  const api = async (m, p) => { apiCalls++; return vendorJson; };
  const mod = new Function('window', 'document', 'api', 't', 'esc', 'awEligible', fn('awStatusInfo') + fn('renderVendorAddons') + fn('loadVendorAddons') + '\nreturn { loadVendorAddons };')(
    window, document, api, s => s, s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), () => true);
  await mod.loadVendorAddons();
  const html = wraps['addon-wrap-0'].innerHTML;
  ok(apiCalls === 1, 'one call');
  ok((window._addons['WO-1'] || []).length === 5 && !window._addons['WO-2'], 'rows distributed by parent_wo_id from the REAL server response, only this vendor\'s');
  for (const c of ['WO-11', 'WO-12', 'WO-13', 'WO-14', 'WO-15']) ok(html.includes(c), 'card rendered for ' + c);
  ok(html.includes('Approved - go ahead') && html.includes('Needs info') && html.includes('Declined') && html.includes('Awaiting review'), 'each estimate_status from the server maps to a real chip');
  ok(!html.includes('undefined') && !html.includes('NaN'), 'no undefined/NaN leaked from a field-name mismatch');
  ok(html.includes('$100.00') && html.includes('item 11'), 'amount and item text come through');
  ok(!html.includes('other vendor'), 'never another vendor\'s row');
}
// ---- index.html: REAL reloadHubAdditionalWork + renderHubAdditionalWork + awAdminState/awAdminCard ----
{
  const fn = n => grabAny(admin, 'function ', n);
  const holder = { id: 'aw-admin-WO-1', style: {}, innerHTML: '' };
  const document = { getElementById: id => (id === 'aw-admin-WO-1' ? holder : null) };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mod = new Function('document', 'api', 'esc', 'var _awAdmin = {}; var _awAdminChildren = {};' + fn('awAdminState') + fn('reloadHubAdditionalWork') + fn('renderHubAdditionalWork') + fn('awAdminCard') + '\nreturn { reloadHubAdditionalWork, _awAdmin };')(
    document, async (m, p) => { ok(m === 'GET' && p === '/wo/additional-work?parent_wo_id=WO-1', 'admin calls the parent form'); return adminJson; }, esc);
  await mod.reloadHubAdditionalWork('WO-1');
  ok(holder.style.display === '' && holder.innerHTML.length > 500, 'admin section shows (not hidden) from the REAL server response');
  for (const c of ['WO-11', 'WO-12', 'WO-13', 'WO-14', 'WO-15']) ok(holder.innerHTML.includes(c), 'admin card for ' + c);
  ok(holder.innerHTML.includes('Sent to proposal') && holder.innerHTML.includes('Needs info (waiting on vendor)') && holder.innerHTML.includes('Awaiting your decision') && holder.innerHTML.includes('Declined'), 'admin state labels all resolve from estimate_status');
  ok(holder.innerHTML.includes('1 pending'), 'pending badge counts the one Pending row');
  ok(!holder.innerHTML.includes('undefined') && !holder.innerHTML.includes('NaN'), 'no undefined/NaN in admin cards');
  ok(adminJson.success === true && Array.isArray(adminJson.items) && adminJson.items.every(r => 'estimate_status' in r && 'child_wo_id' in r && 'parent_wo_id' in r), 'server contract keys present');
}
console.log('vendor-additional-work-shape: ' + n + ' checks passed');
