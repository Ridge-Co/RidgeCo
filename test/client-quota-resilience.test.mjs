// Oct 19 2026: Sheets read-quota burst. Client side of the fix, run against the REAL functions in vendor.html / index.html.
//  - vendor.html api(): reads capped at 4 in flight, quota answers retried (bounded), writes never queued/retried
//  - a failed estimate / invoice / time / receipt load shows a Retry notice -- NEVER "No estimate submitted yet" (which
//    invited duplicate estimates) and never silently empty (which invited double invoices)
//  - index.html api(): GET quota answers retried (bounded), POST never retried
import fs from 'fs';
const v = fs.readFileSync('vendor.html', 'utf8');
const h = fs.readFileSync('index.html', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const tick = () => new Promise(r => setImmediate(r));
const BUSY = { error: "Sheets API error on GET /values/Estimates: Quota exceeded for quota metric 'Read requests'" };

// ---------- vendor.html ----------
const vendorSrc = [grab(v, 'function api(path, opts)'), grab(v, 'function sheetsBusy('), 'var _apiQ = { active: 0, max: 4, waiting: [] };', grab(v, 'function apiGate(')].join('\n');
function buildVendor(fetchImpl) {
  const delays = [];
  const f = new Function('fetch', 'setTimeout', 'WORKER', 'SECRET', 'FormData', vendorSrc + '\nreturn { api, _apiQ };')(
    fetchImpl, (fn, ms) => { delays.push(ms); fn(); }, 'https://w', 'tok', class {});
  return { ...f, delays };
}
// 1. burst of 30 reads: never more than 4 in flight
{
  let inflight = 0, peak = 0; const resolvers = [];
  const m = buildVendor(() => new Promise(res => { inflight++; peak = Math.max(peak, inflight); resolvers.push(() => { inflight--; res({ json: async () => [] }); }); }));
  const ps = Array.from({ length: 30 }, (_, i) => m.api('GET', '/estimates?wo_id=WO-' + i));
  await tick();
  t('30 simultaneous reads -> only 4 in flight', peak === 4);
  let done = 0; while (resolvers.length || done < 30) { const r = resolvers.shift(); if (r) { r(); done++; } await tick(); if (done >= 30) break; }
  const out = await Promise.all(ps);
  t('all 30 eventually complete', out.length === 30);
  t('peak never exceeded 4', peak === 4);
}
// 2. quota answer retried with 3s/6s/12s, then success
{
  let n = 0;
  const m = buildVendor(async () => ({ json: async () => (++n < 3 ? BUSY : [{ ID: 'E1' }]) }));
  const r = await m.api('GET', '/estimates?wo_id=WO-1');
  t('retried until it succeeded', Array.isArray(r) && r[0].ID === 'E1' && n === 3);
  t('waits were 3s then 6s', m.delays.join(',') === '3000,6000');
}
// 3. bounded: forever busy -> 4 attempts total, the error is HANDED BACK (so the card can show it)
{
  let n = 0;
  const m = buildVendor(async () => ({ json: async () => { n++; return BUSY; } }));
  const r = await m.api('GET', '/estimates?wo_id=WO-1');
  t('gives up after 4 attempts', n === 4);
  t('error object returned to the caller, not swallowed', r && /Quota exceeded/.test(r.error));
  t('slot released after failure', m._apiQ.active === 0);
}
// 4. non-quota errors are NOT retried
{
  let n = 0;
  const m = buildVendor(async () => ({ json: async () => { n++; return { error: 'Forbidden' }; } }));
  const r = await m.api('GET', '/estimates?wo_id=WO-1');
  t('non-quota error returned immediately, no retry', n === 1 && r.error === 'Forbidden');
}
// 5. writes: never retried, never queued behind a full read queue
{
  let n = 0; const held = [];
  const m = buildVendor((url, o) => (o && o.method === 'POST')
    ? (n++, Promise.resolve({ json: async () => BUSY }))
    : new Promise(res => held.push(res)));
  Array.from({ length: 6 }, (_, i) => m.api('GET', '/x' + i));  // fill all 4 read slots + 2 waiting
  await tick();
  const r = await m.api('POST', '/estimate/submit', { a: 1 });
  t('POST goes straight through even with the read queue full', r && r.error && n === 1);
  t('POST quota error is NOT retried from the browser', n === 1);
}
// 6. load failures render a Retry notice (real showLoadFailed + real loaders), never "No estimate submitted yet"
{
  const els = {};
  const doc = { getElementById: id => els[id] || (els[id] = { id, innerHTML: '' }) };
  const reports = [];
  const loaders = [grab(v, 'function loadEstimateWidget('), grab(v, 'function loadVendorBillSummary('), grab(v, 'function loadVendorTimeTracking('), grab(v, 'function loadVendorReceipts(')].join('\n');
  const helpers = 'var _loadRetry = {}, _loadReported = {};\n' + grab(v, 'function showLoadFailed(') + '\n' + grab(v, 'function retryLoad(') + '\n' + grab(v, 'function sheetsBusy(');
  let calls = 0; let mode = 'busy';
  const apiFake = (...a) => { calls++; return Promise.resolve(mode === 'busy' ? BUSY : (String(a[1] || a[0]).indexOf('/estimates') > -1 ? [{ ID: 'E1', Status: 'Pending', Line_Items: [] }] : [])); };
  const g = new Function('document', 'window', 'session', 'api', 'esc', 't', 'fetch', 'WORKER', 'SECRET', 'console', 'renderEstimateWidget', 'renderVendorTimeSection', 'renderVendorReceipts',
    helpers + '\n' + loaders + '\nreturn { loadEstimateWidget, loadVendorBillSummary, loadVendorTimeTracking, loadVendorReceipts, retryLoad };')(
    doc, { session: { vendor_id: '7' } }, { vendor_id: '7' }, apiFake, s => String(s), s => s, (u, o) => { reports.push({ u, b: JSON.parse(o.body) }); return Promise.resolve({}); }, 'https://w', 'tok', console,
    (w, i) => { els['est-wrap-' + i].innerHTML = 'RENDERED-ESTIMATE'; }, () => {}, () => {});
  els['est-wrap-0'] = { innerHTML: 'Loading…' }; els['bill-summary-0'] = { innerHTML: '' }; els['time-wrap-0'] = { innerHTML: '' }; els['receipt-wrap-0'] = { innerHTML: '' };
  els['bill-badge-0'] = { innerHTML: '' }; els['bill-btn-0'] = { textContent: '' };
  g.loadEstimateWidget('WO-1', 0); g.loadVendorBillSummary('WO-1', 0); g.loadVendorTimeTracking('WO-1', 0); g.loadVendorReceipts('WO-1', 0);
  await tick(); await tick(); await tick();
  t('estimate failure shows Retry', /Retry/.test(els['est-wrap-0'].innerHTML) && /Could not load/.test(els['est-wrap-0'].innerHTML));
  t('estimate failure NEVER says "No estimate submitted yet" / offers Create Estimate', !/No estimate submitted|Create Estimate/.test(els['est-wrap-0'].innerHTML));
  t('invoice-status failure warns before submitting (no silent blank)', /invoice status/.test(els['bill-summary-0'].innerHTML) && /Retry/.test(els['bill-summary-0'].innerHTML));
  t('time failure shows Retry (not an empty list)', /Retry/.test(els['time-wrap-0'].innerHTML));
  t('receipt failure shows Retry (not an empty list)', /Retry/.test(els['receipt-wrap-0'].innerHTML));
  t('busy wording shown for quota errors', /busy/.test(els['est-wrap-0'].innerHTML));
  t('failure reported to the ledger (once per kind)', reports.length === 4 && reports.every(r => /failure\/report$/.test(r.u) && r.b.system === 'vendor'));
  mode = 'ok';
  g.retryLoad('est-wrap-0'); await tick(); await tick();
  t('Retry reloads and renders the real estimate', els['est-wrap-0'].innerHTML === 'RENDERED-ESTIMATE');
}

// ---------- index.html (admin Hub) ----------
{
  const src = 'var _getCache = {}; var GET_CACHE_MS = 3000;\n' + grab(h, 'function api(method, path, body, timeoutMs)');
  const build = (fetchImpl) => {
    const delays = [];
    const api = new Function('fetch', 'setTimeout', 'WORKER', 'AUTH_TOKEN', 'AbortController', 'Date', src + '\nreturn api;')(
      fetchImpl, (fn, ms) => { delays.push(ms); fn(); }, 'https://w', 'tok', undefined, Date);
    return { api, delays };
  };
  let n = 0;
  let m = build(async () => ({ json: async () => (++n < 3 ? BUSY : [{ ID: 'E1' }]) }));
  const r = await m.api('GET', '/estimates?wo_id=WO-9');
  t('Hub GET retried on quota error then succeeded', Array.isArray(r) && n === 3 && m.delays.join(',') === '3000,6000');
  n = 0; m = build(async () => ({ json: async () => { n++; return BUSY; } }));
  const r2 = await m.api('GET', '/estimates?wo_id=WO-10');
  t('Hub GET gives up after 4 attempts and returns the error object', n === 4 && /Quota/.test(r2.error));
  n = 0; m = build(async () => ({ json: async () => { n++; return BUSY; } }));
  await m.api('POST', '/estimate/approve', { wo_id: 'WO-1' });
  t('Hub POST is never re-sent', n === 1);
  n = 0; m = build(async () => ({ json: async () => { n++; return { error: 'Unauthorized' }; } }));
  let threw = false; try { await m.api('GET', '/x'); } catch (e) { threw = e.message === 'Unauthorized'; }
  t('Unauthorized still throws immediately (no retry)', threw && n === 1);
  const rf = grab(h, 'function refreshHubEstimateView(');
  t('Hub estimate error has a Retry button, is logged and reported', /Retry/.test(rf) && /logError\('Load estimate/.test(rf) && /\/failure\/report/.test(rf));
}

// ---------- Hub login must not depend on a Google Sheets read (Oct 19 2026) ----------
{
  const w = fs.readFileSync('worker.js', 'utf8');
  const dl = grab(h, 'function doLogin(');
  t('manual login probes /model-registry, not the Sheets-backed /config', /api\('GET','\/model-registry'/.test(dl) && !/api\('GET','\/config'/.test(dl));
  const auto = h.slice(h.indexOf("var stored = localStorage.getItem(SECRET_KEY);"), h.indexOf("var stored = localStorage.getItem(SECRET_KEY);") + 700);
  t('auto-login with the saved code probes /model-registry too', /api\('GET','\/model-registry'/.test(auto) && !/api\('GET','\/config'/.test(auto));
  t('the probe path is behind the access-code gate (not a public path)', !/PUBLIC_PATHS = \[[^\]]*'\/model-registry'/.test(w));
  t('the probe path is answered in memory (no Sheets read)', /path === '\/model-registry'\)\s+return json\(modelRegistryInfo\(\)\)/.test(w) && !/fetchTab|sheetsRequest|getConfig|fetchConfig/.test(grab(w, 'function modelRegistryInfo(')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
