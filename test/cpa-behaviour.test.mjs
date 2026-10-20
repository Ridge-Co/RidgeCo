// Phase C batch pa (Oct 20 2026): fault-injection for the Hub pages. Each test extracts the page's REAL function text,
// runs it in a fake world with a failing API, and asserts (a) window.hubReportFailure was called, (b) the screen says so
// (never an empty list / fake success), (c) the happy path reports nothing.
// Run: node test/cpa-behaviour.test.mjs
import { grabFn, makeOk, el } from './cpa-helpers.mjs';
const T = makeOk();
const tick = () => new Promise(r => setTimeout(r, 15));
const world = () => { const reports = []; return { reports, window: { hubReportFailure: (w, e, x) => { reports.push({ where: w, msg: e && e.message ? e.message : String(e), ref: x && x.ref }); return true; } } }; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeArray = v => Array.isArray(v) ? v : [];

// ── 1. index: bulk vendor permission must not claim success for vendors the server refused ──
async function bulkVendor(failIds) {
  const w = world(), toasts = [], state = { vendors: [{ ID: 'v1' }, { ID: 'v2' }, { ID: 'v3' }] };
  const doc = { getElementById: () => ({ querySelectorAll: () => ['v1', 'v2', 'v3'].map(id => ({ dataset: { id } })) }) };
  const api = async (m, p, body) => { if (failIds.includes(body.id)) { if (body.id === 'v2') throw new Error('network down'); return { error: 'not allowed' }; } return { success: true }; };
  const fn = new Function('window', 'document', 'confirm', 'api', 'safeArray', 'state', 'toast', 'clearPinChecks', 'renderVendorsPage', grabFn('index.html', 'bulkSetVendorPermission') + '; return bulkSetVendorPermission;')
    (w.window, doc, () => true, api, safeArray, state, (m, t) => toasts.push([m, t]), () => {}, () => {});
  fn('Can_Bill_No_WO', '/vendor/set-can-bill-no-wo'); await tick();
  return { w, toasts, state };
}
{
  const ok = await bulkVendor([]);
  T.ok(ok.w.reports.length === 0, 'bulk permission happy path reports nothing');
  T.ok(ok.state.vendors.every(v => v.Can_Bill_No_WO === 'TRUE') && ok.toasts[0][1] === 'success', 'happy path marks all and toasts success', ok.toasts);
  const bad = await bulkVendor(['v2', 'v3']);
  T.ok(bad.w.reports.length === 2, 'both failed vendors (network throw and {error}) are reported', bad.w.reports);
  T.ok(bad.w.reports.some(r => r.ref === 'v2') && bad.w.reports.some(r => r.ref === 'v3'), 'report carries the vendor id');
  T.ok(bad.state.vendors[0].Can_Bill_No_WO === 'TRUE' && !bad.state.vendors[1].Can_Bill_No_WO && !bad.state.vendors[2].Can_Bill_No_WO, 'only the vendors that really succeeded are marked');
  T.ok(bad.toasts[0][1] === 'error' && /2 FAILED/.test(bad.toasts[0][0]), 'user is told 2 failed, not "Updated 3"', bad.toasts);
}

// ── 2. index: bulk-void preview must not say "will be voided" when the bill lookup failed ──
async function bulkVoid(fail) {
  const w = world(), prev = el(), gates = []; const g = { _bulkVoidIds: ['W1', 'W2'], _bulkVoidVoidableIds: [] };
  const api = async (m, p) => { if (fail) throw new Error('Quota exceeded'); return []; };
  const run = new Function('window', 'document', 'api', 'safeArray', 'state', 'esc', 'bvComputeMoneyReason', 'bvUpdateConfirmGate', 'g',
    'var _bulkVoidIds = g._bulkVoidIds, _bulkVoidVoidableIds = g._bulkVoidVoidableIds;\n' + grabFn('index.html', 'bvRenderPreview') + '; bvRenderPreview(); return function(){ return _bulkVoidVoidableIds; };')
    (w.window, { getElementById: () => prev }, api, safeArray, { workorders: [] }, esc, () => '', () => gates.push(1), g);
  await tick(); return { w, prev, voidable: run() };
}
{
  const ok = await bulkVoid(false);
  T.ok(ok.w.reports.length === 0 && /will be voided/.test(ok.prev.innerHTML), 'bulk void preview happy path unchanged and silent');
  const bad = await bulkVoid(true);
  T.ok(bad.w.reports.length >= 1 && bad.w.reports[0].where === 'index:bulk-void-bill-lookup', 'bill lookup failure is reported', bad.w.reports);
  T.ok(/Could not preview vendor bills/.test(bad.prev.innerHTML) && !/will be voided/.test(bad.prev.innerHTML), 'preview shows the failure instead of a confident count', bad.prev.innerHTML);
}

// ── 3. index: split-reassign list must say when it could not load ──
async function splitRows(failBills) {
  const w = world(), wrap = el(), rows = el();
  const api = async (m, p) => { if (failBills && /vendor-bills/.test(p)) throw new Error('boom'); return []; };
  const fn = new Function('window', 'document', 'api', 'safeArray', 'renderSplitReassignOptions',
    'var _splitTimeEntries = [], _splitVendorBills = [];\n' + grabFn('index.html', 'loadSplitReassignRows') + '; return loadSplitReassignRows;')
    (w.window, { getElementById: id => id === 'split-reassign-wrap' ? wrap : rows }, api, safeArray, () => { wrap.style.display = 'none'; });
  fn('WO-1'); await tick(); return { w, wrap, rows };
}
{
  const ok = await splitRows(false); T.ok(ok.w.reports.length === 0 && !ok.rows.innerHTML, 'split reassign happy path silent');
  const bad = await splitRows(true);
  T.ok(bad.w.reports.length === 1 && bad.w.reports[0].where === 'index:split-vendor-bills', 'split reassign failure reported', bad.w.reports);
  T.ok(/Could not load the vendor bills/.test(bad.rows.innerHTML) && bad.wrap.style.display === '', 'split reassign shows a visible warning and un-hides the section');
}

// ── 4. index: damaged Access_Trade_Defaults must never be overwritten by a save/remove ──
async function tradeDefaults(fnName, stored) {
  const w = world(), toasts = [], posts = [], list = el();
  const api = async (m, p, b) => { if (m === 'POST') { posts.push([p, b]); return { success: true }; } return { Access_Trade_Defaults: stored }; };
  const ids = { 'trade-access-trade': { value: 'Plumbing' }, 'trade-access-val': { value: 'FALSE' }, 'trade-access-list': list };
  const fn = new Function('window', 'document', 'api', 'toast', 'esc', 'loadTradeAccessDefaults',
    ['saveTradeAccessDefault', 'removeTradeAccessDefault', 'loadTradeAccessDefaults'].map(n => grabFn('index.html', n)).join('\n') + '; return ' + fnName + ';')
    (w.window, { getElementById: id => ids[id] || null }, api, (m, t) => toasts.push([m, t]), esc, () => {});
  fn('Plumbing'); await tick(); return { w, toasts, posts, list };
}
{
  for (const n of ['saveTradeAccessDefault', 'removeTradeAccessDefault']) {
    const good = await tradeDefaults(n, '{"HVAC":"TRUE"}');
    T.ok(good.posts.length === 1 && good.w.reports.length === 0, n + ' happy path saves once, reports nothing');
    const bad = await tradeDefaults(n, '{"HVAC":"TRUE"');
    T.ok(bad.posts.length === 0, n + ' does NOT overwrite a damaged saved value', bad.posts);
    T.ok(bad.w.reports.length === 1 && /trade-defaults-parse/.test(bad.w.reports[0].where), n + ' reports the damaged value', bad.w.reports);
    T.ok(bad.toasts.some(t => t[1] === 'error' && /could not be read/.test(t[0])), n + ' tells the user nothing was changed', bad.toasts);
  }
  const l = await tradeDefaults('loadTradeAccessDefaults', '{bad');
  T.ok(/could not be read/.test(l.list.innerHTML) && !/default to YES/.test(l.list.innerHTML) && l.w.reports.length === 1, 'loader shows damaged-value message, not "no defaults set"');
}

// ── 5. index: Invoice Review must say when job context failed to load (and stay quiet when it did not) ──
async function invoiceReview(failProps) {
  const w = world(), list = el(); const state = { workorders: [], properties: [], units: [], vendors: [], owners: [] };
  const api = async (m, p) => { if (failProps && p === '/properties') throw new Error('Sheets 503'); if (p === '/vendors') return { error: 'Quota exceeded' }; if (/vendor-bills/.test(p)) return []; return [{ ID: 'x' }]; };
  const fn = new Function('window', 'document', 'api', 'safeArray', 'state',
    'var _irBills = [];\n' + grabFn('index.html', 'loadInvoiceReview') + '; return loadInvoiceReview;')
    (w.window, { getElementById: id => id === 'ir-list' ? list : el() }, api, safeArray, state);
  fn(); await tick(); await tick(); return { w, list, state };
}
{
  const bad = await invoiceReview(true);
  T.ok(bad.w.reports.some(r => r.where === 'index:invoice-review-context properties'), 'properties failure reported', bad.w.reports);
  T.ok(bad.w.reports.some(r => r.where === 'index:invoice-review-context vendors'), 'a non-array (error object) answer is also reported', bad.w.reports);
  T.ok(/Could not load: (properties, vendors|vendors, properties)/.test(bad.list.innerHTML) && /No vendor bills pending/.test(bad.list.innerHTML), 'banner is shown above the list', bad.list.innerHTML.slice(0, 300));
  const good = await invoiceReview(false);
  T.ok(good.w.reports.length === 1 && /vendors/.test(good.w.reports[0].where), 'only the genuinely failing context load reports');
}

// ── 6. index: damaged receipts list is never opened for editing ──
{
  const w = world(), toasts = [], opened = []; const bill = { ID: 'B1', Receipts_JSON: '[{"amount":5' };
  const g = { _billCache: { B1: bill }, _billReceiptsEdit: {} };
  const fn = new Function('window', 'toast', 'renderEditReceiptsPanel', grabFn('index.html', 'openEditReceiptsPanel') + '; return openEditReceiptsPanel;')(Object.assign(w.window, g), (m, t) => toasts.push([m, t]), () => opened.push(1));
  fn('B1', 'W1');
  T.ok(w.reports.length === 1 && w.reports[0].ref === 'B1' && !opened.length && toasts[0][1] === 'error', 'damaged receipts: reported, user told, editor not opened (saving would wipe them)');
}

// ── 7. command-center: unreadable 200 answers throw + report; failed best-effort cards are named on screen ──
async function cc(body, ok = true, status = 200) {
  const w = world(); const fetchFn = async () => ({ ok, status, text: async () => body });
  const code = ['getJSON', 'loadAR', 'ccFail', 'ccFailBanner'].map(n => grabFn('command-center.html', n)).join('\n');
  const env = new Function('window', 'fetch', 'WORKER', 'TOKEN', 'h', 'const CC_FAILED=[];\n' + code + '; return {getJSON, loadAR, ccFailBanner, CC_FAILED};')(w.window, fetchFn, 'https://x', 't', esc);
  return { w, env };
}
{
  const g = await cc('{"a":1}'); const d = await g.env.getJSON('/x'); T.ok(d.a === 1 && g.w.reports.length === 0, 'command-center getJSON happy path silent');
  const e = await cc('<html>gateway</html>'); let err = ''; try { await e.env.getJSON('/x?q=1'); } catch (x) { err = x.message; }
  T.ok(/unreadable/.test(err) && e.w.reports.length === 1 && e.w.reports[0].where === 'command-center:unreadable-response /x', 'unparseable 200 is thrown and reported (not returned as null)', { err, r: e.w.reports });
  const empty = await cc(''); T.ok((await empty.env.getJSON('/x')) === null && empty.w.reports.length === 0, 'an empty body stays null as before');
  const ar = await cc('{"error":"QuickBooks not connected"}'); const v = await ar.env.loadAR();
  T.ok(v === null && ar.env.CC_FAILED.join() === 'AR aging', 'failed AR card returns null as before');
  T.ok(/Couldn’t load: AR aging/.test(ar.env.ccFailBanner()) && ar.w.reports.some(r => r.where === 'command-center:AR aging'), 'and the page says which card is missing, and it is reported');
}

// ── 8. proposals / action-center getJSON: same unreadable-answer rule ──
{
  for (const [file, tag] of [['proposals.html', 'proposals'], ['action-center.html', 'action-center']]) {
    const w = world(); const mk = body => new Function('window', 'fetch', 'WORKER', 'TOKEN', grabFn(file, 'getJSON') + '; return getJSON;')(w.window, async () => ({ ok: true, status: 200, text: async () => body }), 'https://x', 't');
    T.ok((await mk('{"ok":1}')('/p')).ok === 1 && w.reports.length === 0, file + ' happy path silent');
    let err = ''; try { await mk('oops <html>')('/p'); } catch (x) { err = x.message; }
    T.ok(/unreadable/.test(err) && w.reports.length === 1 && w.reports[0].where.startsWith(tag + ':unreadable-response'), file + ' unparseable 200 throws and reports', { err, r: w.reports });
  }
}

// ── 9. receipt-reconciler: a failed context load is named in the status line ──
async function rrQueue(fail) {
  const w = world(), status = el(), list = el();
  const get = async p => { if (/queue/.test(p)) return [{ ID: 1 }]; if (fail && p === '/properties') throw new Error('503'); return []; };
  const fn = new Function('window', 'document', 'get', 'esc', 'toggleFilterBar', 'rebuildWoDatalist', 'renderFiltered', 'filterQueueRows',
    'var curStatus="open", allWOs=[], allProperties=[], allUnits=[], lastQueueRows=[], queueFilterText="";\n' + grabFn('receipt-reconciler.html', 'loadQueue') + '; return loadQueue;')
    (w.window, { getElementById: id => id === 'conn-status' ? status : (id === 'list' ? list : null) }, get, esc, () => {}, () => {}, () => {}, () => []);
  await fn(); return { w, status };
}
{
  const good = await rrQueue(false); T.ok(good.w.reports.length === 0 && /✅ 1 open$/.test(good.status.textContent), 'receipt queue happy path unchanged and silent', good.status.textContent);
  const bad = await rrQueue(true);
  T.ok(bad.w.reports.length === 1 && bad.w.reports[0].where === 'receipt-reconciler:context-load properties', 'receipt queue context failure reported', bad.w.reports);
  T.ok(/could not load properties/.test(bad.status.textContent) && /✅ 1 open/.test(bad.status.textContent), 'status line names what is missing, queue still shows', bad.status.textContent);
}

// ── 10. scope-creator / bulk-importer loaders: no silent empty list ──
{
  const w = world(), box = el();
  const fn = new Function('window', 'document', 'get', 'scopeKey', 'addPhotoCard', grabFn('scope-creator.html', 'loadScopePhotos') + '; return loadScopePhotos;')(w.window, { getElementById: () => box }, async () => { throw new Error('Drive 500'); }, () => 'SCOPE-1', () => {});
  await fn();
  T.ok(w.reports.length === 1 && /could not load the existing photos|Could not load the existing photos/.test(box.innerHTML), 'scope photos: failure reported and shown');
  const w2 = world(), box2 = el(), cards = [];
  await new Function('window', 'document', 'get', 'scopeKey', 'addPhotoCard', grabFn('scope-creator.html', 'loadScopePhotos') + '; return loadScopePhotos;')(w2.window, { getElementById: () => box2 }, async () => [{ File_Name: 'a.jpg', Drive_URL: 'u' }], () => 'SCOPE-1', (n) => cards.push(n))();
  T.ok(w2.reports.length === 0 && cards.length === 1, 'scope photos happy path silent');
}
{
  const w = world(), sel = el();
  new Function('window', 'document', 'api', 'esc', 'var INSP_CUSTOMERS=[];\n' + grabFn('bulk-importer.html', 'loadInspCustomers') + '; loadInspCustomers();')(w.window, { getElementById: () => sel }, async () => { throw new Error('404'); }, esc);
  await tick();
  T.ok(w.reports.length === 1 && /could not load customers/.test(sel.innerHTML), 'bulk-importer customers: failure reported and the picker says so');
  const w2 = world(), sel2 = el();
  new Function('window', 'document', 'api', 'esc', 'var INSP_CUSTOMERS=[];\n' + grabFn('bulk-importer.html', 'loadInspCustomers') + '; loadInspCustomers();')(w2.window, { getElementById: () => sel2 }, async () => [{ ID: 'c1', Name: 'Acme' }], esc);
  await tick(); T.ok(w2.reports.length === 0 && /Acme/.test(sel2.innerHTML), 'bulk-importer customers happy path silent');
}

// ── 11. index: simple loaders tell the user ──
{
  const w = world(), toasts = [], reqEl = el();
  const wish = new Function('window', 'api', 'toast', 'renderWishlist', 'var wishlistItems=[];\n' + grabFn('index.html', 'loadWishlist') + '; return loadWishlist;')(w.window, async () => { throw new Error('x'); }, (m, t) => toasts.push([m, t]), () => {});
  wish(); await tick();
  T.ok(w.reports.length === 1 && toasts[0][1] === 'error', 'wishlist load failure: reported + toast');
  const w2 = world();
  new Function('window', 'document', 'api', 'renderVendorAccessRequests', 'updateVendorAccessRequestBadges', 'var vendorAccessRequests=[];\n' + grabFn('index.html', 'loadVendorAccessRequests') + '; loadVendorAccessRequests();')(w2.window, { getElementById: () => reqEl }, async () => { throw new Error('x'); }, () => {}, () => {});
  await tick(); T.ok(w2.reports.length === 1 && /Could not load requests/.test(reqEl.innerHTML), 'vendor access requests load failure: reported + visible');
}
T.done('cpa-behaviour');
