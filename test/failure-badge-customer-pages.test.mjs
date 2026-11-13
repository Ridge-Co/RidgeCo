// Nov 12 2026 (Brett): the red "N problems" badge must not appear on the tenant, vendor and owner pages, even on a device holding his admin token
// (it showed on his phone while he demoed the owner portal). It must still appear on Hub pages, and failures on customer pages must still be REPORTED.
// Runs the REAL failure-reporter.js in a fake browser.
import fs from 'fs';
const code = fs.readFileSync(new URL('../failure-reporter.js', import.meta.url), 'utf8');
let pass = 0, fail = 0; const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
async function world(pathname) {
  const reports = [], fetched = [], timers = [], appended = [];
  const doc = { visibilityState: 'visible', readyState: 'complete', body: { appendChild: (el) => appended.push(el) }, createElement: () => ({ style: {}, setAttribute() {}, remove() {} }), getElementById: () => null, addEventListener() {} };
  const win = { location: { search: '', pathname }, addEventListener() {} };
  win.fetch = async (url, init) => {
    url = String(url); fetched.push(url);
    if (/\/failure\/report/.test(url)) { reports.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    if (/\/failures\/open/.test(url)) return { ok: true, status: 200, json: async () => ({ count: 6, worst: 'P1', failures: [{}, {}, {}, {}, {}, {}] }) };
    if (/\/version/.test(url)) return { ok: true, status: 200 };
    throw new TypeError('Load failed');
  };
  const run = new Function('window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'console', 'URLSearchParams', code);
  const quiet = { error() {}, warn() {}, log() {} };
  run(win, doc, { language: 'en', onLine: true }, win.location, { getItem: (k) => k === 'mh_auth' ? 'ADMINTOKEN' : '' }, { getItem: () => null, setItem() {} }, (f, ms) => { timers.push(f); return timers.length; }, () => 0, () => {}, quiet, URLSearchParams);
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  return { win, fetched, reports, appended, timers };
}
for (const p of ['/RidgeCo/owner.html', '/RidgeCo/tenant.html', '/RidgeCo/vendor.html', '/owner', '/tenant', '/vendor/', '/owner.html']) {
  const w = await world(p);
  t(p + ': no problems badge and the open-failures list is not even requested', !w.appended.some(e => e && e.id === 'hub-fail-badge') && !w.fetched.some(u => /\/failures\/open/.test(u)));
}
for (const p of ['/RidgeCo/index.html', '/RidgeCo/wo.html', '/RidgeCo/owner-onboard.html', '/RidgeCo/owner-setup.html', '/RidgeCo/tenant-roster-admin.html']) {
  const w = await world(p);
  t(p + ': the badge is still requested on Hub pages', w.fetched.some(u => /\/failures\/open/.test(u)));
}
{ // customer pages still REPORT failures (only the badge is hidden)
  const w = await world('/RidgeCo/owner.html');
  await w.win.fetch('https://maintenance-hub.brett-2f8.workers.dev/owner-properties').catch(() => {});
  for (const f of w.timers.splice(0)) f(); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
  t('owner page: window.hubReportFailure still reports to the ledger', (w.win.hubReportFailure('test', 'boom'), true) && w.reports.some(r => /boom/.test(r.message)));
}
console.log(`failure-badge-customer-pages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
