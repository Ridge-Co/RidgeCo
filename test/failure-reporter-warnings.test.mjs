// Behaviour test: a Hub write that answers 200 with `failure_warning`/`failure_warnings` puts a persistent on-screen bar (admin: the text; others: a friendly line).
// Runs the REAL failure-reporter.js in a minimal fake browser.  Run: node test/failure-reporter-warnings.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'failure-reporter.js'), 'utf8');
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function mkEl(tag) { const el = { tag, children: [], style: {}, attrs: {}, textContent: '', id: '', setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parent = this; return c; }, remove() { if (this.parent) { this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; } }, addEventListener() {} }; return el; }
function world({ admin, route, noBody, online = true }) {
  const body = mkEl('body'); const dcl = []; const store = admin ? { mh_auth: 'tok' } : {};
  const doc = { body: noBody ? null : body, readyState: 'complete', createElement: mkEl, getElementById: (id) => { const f = (n) => n.id === id ? n : n.children.map(f).find(Boolean); return f(body) || null; }, addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') dcl.push(fn); } };
  const fetchLog = [];
  const realFetch = async (url, init) => { fetchLog.push({ url, init }); const r = route(url, init); return { ok: r.status < 400, status: r.status, headers: { get: () => r.ct || 'application/json' }, clone() { return this; }, json: async () => { if (r.bad) throw new SyntaxError('bad'); return r.body; } }; };
  const win = { fetch: realFetch, addEventListener() {}, location: { search: '', pathname: '/index.html' }, localStorage: { getItem: (k) => store[k] || null }, sessionStorage: { getItem: () => null, setItem() {} } };
  win.window = win;
  const ctx = vm.createContext({ window: win, document: doc, location: win.location, navigator: { language: 'en', onLine: online }, localStorage: win.localStorage, sessionStorage: win.sessionStorage, setInterval() {}, setTimeout() {}, console: { error() {} }, URLSearchParams, JSON, Date, Promise });
  vm.runInContext(src, ctx);
  return { win, body, fetchLog, doc, dcl };
}
const HUB = 'https://maintenance-hub.brett-2f8.workers.dev';
const tick = () => new Promise(r => setImmediate(r));
let w = world({ admin: true, route: () => ({ status: 200, body: { success: true, failure_warnings: ['Invoice_Review ensureColumns failed', 'WO status not updated'] } }) });
await w.win.fetch(HUB + '/qb/send-invoice', { method: 'POST' }); await tick(); await tick();
let bar = w.body.children.find(c => c.id === 'hub-warn-bar');
ok(bar && bar.children.some(c => /Saved, but: Invoice_Review ensureColumns failed/.test(c.textContent)) && bar.children.some(c => /WO status not updated/.test(c.textContent)), 'admin: a 200 write with warnings[] shows a persistent bar naming each warning');
ok(bar && bar.attrs.role === 'alert' && bar.children[0].textContent === '×', '...with a dismiss button (persistent until dismissed, not a 7-second toast)');
w = world({ admin: false, route: () => ({ status: 200, body: { success: true, failure_warning: 'QuickBooks link carry failed for owner 12' } }) });
await w.win.fetch(HUB + '/vendor/update', { method: 'POST' }); await tick(); await tick();
bar = w.body.children.find(c => c.id === 'hub-warn-bar');
ok(bar && bar.children.length === 2 && !/QuickBooks/.test(JSON.stringify(bar.children.map(c => c.textContent))) && /follow-up/.test(bar.children[1].textContent), 'non-admin: a friendly line only, never the raw server text');
w = world({ admin: true, route: () => ({ status: 200, body: { success: true } }) });
await w.win.fetch(HUB + '/x', { method: 'POST' }); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'a clean success shows nothing');
w = world({ admin: true, route: () => ({ status: 200, body: { failure_warning: 'x' } }) });
await w.win.fetch(HUB + '/workorders'); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'GET reads are not parsed for warnings (no extra cost on big list loads)');
w = world({ admin: true, route: () => ({ status: 200, bad: true, body: null }) });
await w.win.fetch(HUB + '/x', { method: 'POST' }); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'an unparseable body does not break the page (logged to console only)');
w = world({ admin: true, route: () => ({ status: 200, ct: 'text/html', body: {} }) });
await w.win.fetch('https://example.com/other', { method: 'POST' }); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'non-Hub URLs are untouched');
// --- Oct 20 review: only the dedicated failure keys count; informational notes never nag
w = world({ admin: true, route: () => ({ status: 200, body: { success: true, warning: 'Instant-pay fee note', warnings: ['Invoice is the DEPOSIT only', 'Maryland deposit cap applied'] } }) });
await w.win.fetch(HUB + '/qb/send-invoice', { method: 'POST' }); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'old informational keys warning/warnings are IGNORED (no bar on normal success)');
w = world({ admin: true, route: () => ({ status: 200, body: { success: true, preview: true, failure_warning: 'would fail' } }) });
await w.win.fetch(HUB + '/x', { method: 'POST' }); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'preview responses are skipped');
w = world({ admin: true, route: () => ({ status: 200, body: { success: true, preview_only: true, failure_warnings: ['x'] } }) });
await w.win.fetch(HUB + '/x', { method: 'POST' }); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'preview_only responses are skipped');
w = world({ admin: true, route: () => ({ status: 200, body: { failure_warnings: ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] } }) });
await w.win.fetch(HUB + '/x', { method: 'POST' }); await tick(); await tick();
await w.win.fetch(HUB + '/y', { method: 'POST' }); await tick(); await tick();
bar = w.body.children.find(c => c.id === 'hub-warn-bar');
ok(bar && bar.children.length === 6 && bar.children.slice(1).filter(c => /: A$/.test(c.textContent)).length === 1, 'identical lines are deduped (also across calls) and the bar caps at 5 lines', bar && bar.children.map(c => c.textContent));
ok(/max-height:25vh/.test(bar.style.cssText), 'bar max-height is 25vh');
bar.children[0].onclick(); ok(!w.body.children.some(c => c.id === 'hub-warn-bar'), 'the x button dismisses the bar');
await w.win.fetch(HUB + '/z', { method: 'POST' }); await tick(); await tick();
ok(w.body.children.some(c => c.id === 'hub-warn-bar'), 'a later warning after dismissal shows a fresh bar');
w = world({ admin: true, noBody: true, route: () => ({ status: 200, body: { failure_warning: 'late' } }) });
await w.win.fetch(HUB + '/x', { method: 'POST' }); await tick(); await tick();
ok(!w.body.children.some(c => c.id === 'hub-warn-bar') && w.dcl.length === 1, 'no document.body: nothing rendered yet and a DOMContentLoaded retry is registered');
w.doc.body = w.body; w.dcl.forEach(f => f());
ok(w.body.children.some(c => c.id === 'hub-warn-bar' && c.children.some(k => /late/.test(k.textContent))), 'on DOMContentLoaded the pending warning is rendered');
const reports = (x) => x.fetchLog.filter(f => /failure\/report/.test(f.url)).length;
// hubReportFailure ignores ordinary network conditions
w = world({ admin: true, online: false, route: () => ({ status: 200, body: {} }) });
ok(w.win.hubReportFailure('x', new Error('boom')) === false && !reports(w), 'hubReportFailure: offline -> no report');
w = world({ admin: true, route: () => ({ status: 200, body: {} }) });
const ab = new Error('aborted'); ab.name = 'AbortError'; const to = new Error('t'); to.name = 'TimeoutError';
ok(w.win.hubReportFailure('x', ab) === false && w.win.hubReportFailure('x', to) === false && !reports(w), 'hubReportFailure: AbortError / TimeoutError -> no report, no toast');
ok(w.win.hubReportFailure('x', new Error('real bug')) === true && reports(w) === 1, 'hubReportFailure: a real error is still reported');
console.log(`\nfailure-reporter-warnings: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
