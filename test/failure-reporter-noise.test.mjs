// Oct 21 2026 - browser failure noise ("network error calling /tenant-workorders: Load failed" etc. on Needs Attention).
// Runs the REAL failure-reporter.js in a fake browser. A one-off failed request must NOT be reported when the tab was hidden/leaving or when the Hub
// answers a check right afterwards; it MUST be reported (and reach POST /failure/report, i.e. the failure ledger) when the Hub itself is unreachable.
// Run: node test/failure-reporter-noise.test.mjs
import fs from 'fs';
const code = fs.readFileSync(new URL('../failure-reporter.js', import.meta.url), 'utf8');
let pass = 0, fail = 0; const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

function world(opts) {
  opts = opts || {};
  const reports = [], listeners = {}, timers = [];
  const doc = { visibilityState: opts.hidden ? 'hidden' : 'visible', readyState: 'complete', body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, remove() {} }), getElementById: () => null,
    addEventListener: (n, f) => { (listeners['d:' + n] = listeners['d:' + n] || []).push(f); } };
  const win = { location: { search: '', pathname: '/tenant.html' }, addEventListener: (n, f) => { (listeners['w:' + n] = listeners['w:' + n] || []).push(f); } };
  const net = { hubUp: opts.hubUp !== false, appFails: opts.appFails !== false };
  win.fetch = async (url, init) => {
    url = String(url);
    if (/\/failure\/report/.test(url)) { reports.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }
    if (/\/version/.test(url)) { if (!net.hubUp) throw new TypeError('Load failed'); return { ok: true, status: 200 }; }
    if (net.appFails) throw new TypeError('Load failed');
    return { ok: true, status: 200 };
  };
  const fakeSetTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  const run = new Function('window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'console', 'URLSearchParams', code);
  const quiet = { error() {}, warn() {}, log() {} };
  run(win, doc, { language: 'en', onLine: true }, win.location, { getItem: () => '' }, { getItem: () => null, setItem() {} }, fakeSetTimeout, () => 0, () => {}, quiet, URLSearchParams);
  return { win, doc, reports, listeners, net, timers, fire: async () => { for (const tm of timers.splice(0)) { tm.f(); } await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); } };
}
const HUB = 'https://maintenance-hub.brett-2f8.workers.dev';
const sink = (p) => p.catch(() => {});

{ // 1. one request fails, the Hub is fine -> not reported
  const w = world({ hubUp: true });
  await sink(w.win.fetch(HUB + '/tenant-workorders'));
  await w.fire();
  t('one failed request while the Hub answers a check is NOT reported', w.reports.length === 0);
}
{ // 2. the Hub is really down -> reported with the wording the ledger already uses, plus the check result
  const w = world({ hubUp: false });
  await sink(w.win.fetch(HUB + '/tenant-workorders'));
  await w.fire();
  t('the Hub unreachable: the failure IS reported to /failure/report', w.reports.length === 1 && /network error calling \/tenant-workorders/.test(w.reports[0].message) && /did not answer a check/.test(w.reports[0].message));
  t('... as a browser-source report (same ledger fingerprint family as before)', w.reports[0].source === 'browser' && /^page:tenant\.html api \/tenant-workorders/.test(w.reports[0].where));
}
{ // 3. the tab was hidden (phone locked / backgrounded) -> not reported even though the Hub is down
  const w = world({ hubUp: false, hidden: true });
  await sink(w.win.fetch(HUB + '/vendor-workorders'));
  await w.fire();
  t('a request that failed while the tab was hidden is NOT reported', w.reports.length === 0);
}
{ // 4. page is leaving
  const w = world({ hubUp: false });
  const p = sink(w.win.fetch(HUB + '/str/c/page'));
  for (const f of w.listeners['w:pagehide'] || []) f();
  await p; await w.fire();
  t('a request cut off by the page leaving is NOT reported', w.reports.length === 0);
}
{ // 5. 5xx still reported straight away (unchanged behaviour)
  t('the HTTP 5xx path is still reported immediately', /r\.status >= 500\) \{ if \(report\('api ' \+ path, 'HTTP '/.test(code));
}
{ // 6. the check never loops through the wrapper
  const w = world({ hubUp: false });
  await sink(w.win.fetch(HUB + '/tenant-workorders'));
  await w.fire();
  t('only one report despite the extra check request (no loop)', w.reports.length === 1);
}
console.log(`failure-reporter-noise: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
