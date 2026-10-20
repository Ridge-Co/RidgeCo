// Phase C batch "pb" (Oct 20 2026): swallowed errors in the Hub PAGES, test tools and Apps Script files.
// 1. Static: the lint finds ZERO offenders left in this batch's files.
// 2. Fault injection: the REAL function text is lifted out of vendor.html / tenant.html / trash.html / proposal page / vendor-setup.html /
//    test-login.js / the .gs files into a fake world with a FAILING fetch / api / storage, and we assert the failure is
//    (a) reported (window.hubReportFailure or the existing alert path) and (b) visible on screen where a person was looking,
//    and (c) the happy path reports nothing.
// Run: node test/cpb-page-silent-failures.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { countRepo, mask } from '../scripts/silent-failure-lint.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok ' + m); } else { fail++; console.log('  FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
const read = (p) => readFileSync(join(root, p), 'utf8');

export const FILES = ['vendor.html', 'tenant.html', 'shop/index.html', 'wo.html', 'test-login.js', 'vendor-setup.html', 'trash.html', 'tenant-wo-access.html',
  'proposal-3101gibbons-8fk3q2.html', 'deliveries.html', 'submit.html', 'message-queue.html', 'inspection-report.html', 'inspect.html', 'inspect-book.html',
  'customer.html', 'building-info.html', 'scripts/smoke-staging.mjs', 'apps-script/receipt-mail-to-hub/ReceiptMailToHub.gs', 'apps-script/buildium-intake/BuildiumIntake.gs'];

// ── 1. static ──
{
  const left = countRepo(root, FILES).offenders;
  ok(left.length === 0, 'no silent-failure offenders left in the pb files', left.map(o => o.file + ':' + o.line));
}

// ── helpers: lift real function text out of a page ──
function inlineJs(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m, out = [];
  while ((m = re.exec(html))) { if (/\bsrc\s*=/.test(m[1])) continue; out.push(m[2]); }
  return out.join('\n;\n');
}
function grabFn(js, masked, name) {
  const sig = 'function ' + name + '(';
  const start = js.indexOf(sig); if (start < 0) throw new Error('missing function ' + name);
  const open = masked.indexOf('{', masked.indexOf(')', start));
  let d = 0, i = open;
  for (; i < masked.length; i++) { if (masked[i] === '{') d++; else if (masked[i] === '}') { d--; if (!d) { i++; break; } } }
  return js.slice(start, i);
}
function page(file) { const js = inlineJs(read(file)); const masked = mask(js).masked; return { js, fn: (n) => grabFn(js, masked, n) }; }
const tick = () => new Promise(r => setTimeout(r, 0));
function fakeDom() {
  const els = {};
  const get = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', style: {}, disabled: false, appendChild() {}, removeAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  return { els, document: { getElementById: get, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) } };
}
function build(params, body, ret) {
  return new Function(...Object.keys(params), body + '\nreturn {' + ret + '};')(...Object.values(params));
}

// ── 2a. vendor.html ──
const V = page('vendor.html');
{
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const mk = (over = {}) => {
    const dom = fakeDom(); const reports = [], fetches = [];
    const params = Object.assign({
      document: dom.document, esc, WORKER: 'https://w.test', SECRET: 'tok', LANG: 'en', session: { vendor_id: 'V1' },
      window: { hubReportFailure: (...a) => reports.push(a), _wos: [{ ID: 'WO-1' }], _addons: {} },
      fetch: async (u, o) => { fetches.push({ u, o }); return { ok: true }; },
      console: { error() {}, log() {} }, awEligible: () => true, renderVendorAddons() {}, loadWorkOrders() {},
      api: async () => { throw new Error('HTTP 500 boom-secret-detail'); },
      ES: null,
    }, over);
    return { dom, reports, fetches, params };
  };
  const esSrc = V.js.slice(V.js.indexOf('var ES = {'), V.js.indexOf('\n};', V.js.indexOf('var ES = {')) + 3);

  // loadVendorTaskAlerts failing: banner shows a friendly message with Retry, ledger gets the detail, vendor never sees raw text
  for (const lang of ['en', 'es']) {
    const w = mk({ LANG: lang });
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadVendorTaskAlerts') + V.fn('renderVendorTaskAlerts') + 'var VTR_TYPE_LABELS_VENDOR={};';
    const api = build(w.params, body, 'loadVendorTaskAlerts');
    api.loadVendorTaskAlerts(); await tick(); await tick();
    const html = w.dom.els.vtrBanner && w.dom.els.vtrBanner.innerHTML;
    ok(/Could not load|No se pudo cargar/.test(html || '') && (lang === 'en' ? /Could not load/.test(html) : /No se pudo cargar/.test(html)), 'vendor task-alert load failure is shown on screen (' + lang + ')', html);
    ok(!/boom-secret-detail/.test(html || ''), 'vendor never sees the raw error text (' + lang + ')');
    ok(w.fetches.length === 1 && /failure\/report/.test(w.fetches[0].u) && /boom-secret-detail/.test(w.fetches[0].o.body), 'failure detail goes to the ledger (' + lang + ')');
  }
  {
    const w = mk({ api: async () => [] });
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadVendorTaskAlerts') + V.fn('renderVendorTaskAlerts') + 'var VTR_TYPE_LABELS_VENDOR={};';
    build(w.params, body, 'loadVendorTaskAlerts').loadVendorTaskAlerts(); await tick(); await tick();
    ok(w.fetches.length === 0 && w.reports.length === 0, 'happy path (no alerts) reports nothing');
  }

  // loadVendorAddons failing
  {
    const w = mk({ api: async () => { throw new Error('addon-boom'); } });
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadVendorAddons');
    build(w.params, body, 'loadVendorAddons').loadVendorAddons(); await tick(); await tick();
    ok(/Could not load/.test(w.dom.els['addon-wrap-0'].innerHTML) && !/addon-boom/.test(w.dom.els['addon-wrap-0'].innerHTML), 'addon load failure is visible on the card, without raw error');
    ok(w.fetches.some(f => /addon-boom/.test(f.o.body)), 'addon load failure reaches the ledger');
  }
  {
    const w = mk({ api: async () => ({ success: true, items: [] }) });
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadVendorAddons');
    build(w.params, body, 'loadVendorAddons').loadVendorAddons(); await tick(); await tick();
    ok(w.fetches.length === 0 && !w.dom.els['addon-wrap-0'], 'addon happy path reports/draws nothing');
  }

  // loadPortalAttachments failing
  {
    const w = mk({ api: async () => { throw new Error('att-boom'); }, INTERNAL_FILE_TYPES: [], _rcWoItems: {} });
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadPortalAttachments');
    build(w.params, body, 'loadPortalAttachments').loadPortalAttachments('WO-9', { before: true }); await tick(); await tick();
    ok(w.fetches.filter(f => /failure\/report/.test(f.u) && /att-boom/.test(f.o.body)).length === 1 && w.fetches.some(f => /"ref":"WO-9"/.test(f.o.body)) && w.reports.length === 0, 'attachment load failure is reported ONCE (the showLoadFailed POST with the WO ref, not also hubReportFailure)');
    ok(/Could not load/.test(w.dom.els['wo-uploads-WO-9'] ? w.dom.els['wo-uploads-WO-9'].innerHTML : '') || /Could not load/.test(w.dom.els['uploads-before-WO-9'] ? w.dom.els['uploads-before-WO-9'].innerHTML : ''), 'attachment load failure is visible to the vendor');
  }
  // Oct 20 review: an error OBJECT answer is a failure, never a silent return; one failed add-on request = one error box
  {
    const w = mk({ api: async () => ({ error: 'Sheets read failed' }), INTERNAL_FILE_TYPES: [], _rcWoItems: {} });
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadPortalAttachments');
    build(w.params, body, 'loadPortalAttachments').loadPortalAttachments('WO-7', { before: true }); await tick(); await tick();
    const box = (w.dom.els['wo-uploads-WO-7'] || w.dom.els['uploads-before-WO-7'] || {}).innerHTML || '';
    ok(/Could not load/.test(box) && w.fetches.filter(f => /failure\/report/.test(f.u) && /Sheets read failed/.test(f.o.body)).length === 1, '/attachments answering {error} shows the failure box and reports once');
  }
  {
    const w = mk({ api: async () => ({ success: false, error: 'addons-denied' }) });
    w.params.window._wos = [{ ID: 'WO-1' }, { ID: 'WO-2' }, { ID: 'WO-3' }];
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadVendorAddons');
    build(w.params, body, 'loadVendorAddons').loadVendorAddons(); await tick(); await tick();
    const boxes = [0, 1, 2].filter(i => w.dom.els['addon-wrap-' + i] && /Could not load/.test(w.dom.els['addon-wrap-' + i].innerHTML));
    ok(boxes.length === 1 && boxes[0] === 0, '/wo/additional-work answering {success:false}: exactly ONE error box for three cards', boxes);
    ok(w.fetches.filter(f => /failure\/report/.test(f.u)).length === 1, '...and one ledger report');
  }
  {
    const w = mk({ api: async () => { throw new Error('addons-down'); } });
    w.params.window._wos = [{ ID: 'WO-1' }, { ID: 'WO-2' }];
    const body = esSrc + '\n var _loadRetry = {}, _loadReported = {};\n' + V.fn('sheetsBusy') + V.fn('t') + V.fn('showLoadFailed') + V.fn('loadVendorAddons');
    build(w.params, body, 'loadVendorAddons').loadVendorAddons(); await tick(); await tick();
    ok(/Could not load/.test(w.dom.els['addon-wrap-0'].innerHTML) && !(w.dom.els['addon-wrap-1'] && /Could not load/.test(w.dom.els['addon-wrap-1'].innerHTML)), 'a network failure also shows one box only');
  }

  // restoreVendorSession
  {
    const run = (storage, onLogin) => {
      const reports = [];
      const body = V.fn('restoreVendorSession');
      const f = build({ localStorage: storage, SESS_KEY: 'k', onLoginSuccess: onLogin, window: { hubReportFailure: (...a) => reports.push(a) } }, body, 'restoreVendorSession');
      f.restoreVendorSession(); return reports;
    };
    let logged = 0;
    ok(run({ getItem() { throw new Error('blocked'); } }, () => logged++).length === 0 && logged === 0, 'blocked storage is benign: no report, no login');
    ok(run({ getItem: () => JSON.stringify({ token: 't' }) }, () => { logged++; }).length === 0 && logged === 1, 'valid saved session logs in, reports nothing');
    const r = run({ getItem: () => JSON.stringify({ token: 't' }) }, () => { throw new Error('dash crashed'); });
    ok(r.length === 1 && r[0][0] === 'vendor:restoreSession', 'a crash while restoring the session is reported (was silent)');
    ok(run({ getItem: () => '{not json' }, () => {}).length === 1, 'a corrupt saved session is reported');
  }

  // background poll helper
  {
    const reports = [];
    const w = build({ navigator: { onLine: true }, document: { hidden: false }, window: { hubReportFailure: (...a) => reports.push(a) } }, 'var _bgFails = {};\n' + V.fn('bgOk') + V.fn('bgFailure'), 'bgOk,bgFailure');
    for (let i = 0; i < 4; i++) w.bgFailure('x', new Error('e'));
    ok(reports.length === 0, 'four failed polls in a row are not reported (normal on a weak signal)');
    w.bgFailure('x', new Error('e')); w.bgFailure('x', new Error('e'));
    ok(reports.length === 1 && /failing repeatedly/.test(reports[0][0]), 'the fifth consecutive failure is reported exactly once');
    w.bgOk('x'); for (let i = 0; i < 4; i++) w.bgFailure('x', new Error('e'));
    ok(reports.length === 1, 'a success resets the streak');
  }
  // Oct 20 review: ordinary network conditions never count toward the 5-in-a-row report
  for (const [label, nav, doc, err] of [['offline', { onLine: false }, { hidden: false }, new Error('e')], ['hidden tab', { onLine: true }, { hidden: true }, new Error('e')],
    ['AbortError', { onLine: true }, { hidden: false }, Object.assign(new Error('a'), { name: 'AbortError' })], ['TimeoutError', { onLine: true }, { hidden: false }, Object.assign(new Error('t'), { name: 'TimeoutError' })]]) {
    const reports = [];
    const w = build({ navigator: nav, document: doc, window: { hubReportFailure: (...a) => reports.push(a) } }, 'var _bgFails = {};\n' + V.fn('bgOk') + V.fn('bgFailure'), 'bgOk,bgFailure');
    for (let i = 0; i < 12; i++) w.bgFailure('x', err);
    ok(reports.length === 0, 'vendor poll: 12 misses while ' + label + ' are not reported');
  }

  // awAddFiles preview failure
  {
    const reports = [];
    const body = V.fn('awAddFiles');
    const state = { items: [{ files: [] }], busy: false, missing: [] };
    const f = build({ _aw: state, URL: { createObjectURL() { throw new Error('no blob url'); } }, window: { hubReportFailure: (...a) => reports.push(a) }, awRender() {}, awUpdateSubmit() {}, document: fakeDom().document }, body, 'awAddFiles');
    try { f.awAddFiles(0, { files: [{ name: 'a.jpg' }], value: '' }); } catch (e) { /* later lines may need more fakes; only the catch matters */ }
    ok(reports.length === 1 && reports[0][0] === 'vendor:awAddFiles preview', 'photo preview failure is reported');
  }

  // source-level pins for sites too entangled to extract
  const logFn = V.fn('_uploadOneFile');
  ok(/logP\.then\(function\(r\) \{\s*if \(r && \(r\.success === false \|\| r\.error\)\) throw/.test(logFn) && /vendor:logAttachment/.test(logFn) && /Uploaded, but not attached to the job/.test(logFn), 'log-attachment failure is reported AND the card tells the vendor');
  ok(V.js.includes("'Uploaded, but not attached to the job. Please tell Ridge Co.':"), 'Spanish string exists for the log-attachment warning');
  ok(/vendor:saveChecklist/.test(V.js) && /vendor:nearbyWOs/.test(V.js) && /vendor:billReceiptsJson/.test(V.js), 'checklist save / nearby / bill-receipts catches report');
}

// ── 2b. tenant.html ──
const T = page('tenant.html');
{
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const mkT = () => { const dom = fakeDom(); const reports = []; return { dom, reports, win: { hubReportFailure: (...a) => reports.push(a) } }; };
  // showWOLoadError
  {
    const w = mkT();
    const f = build({ document: w.dom.document, esc, window: w.win, console: { error() {} } }, T.fn('showWOLoadError'), 'showWOLoadError');
    f.showWOLoadError(Object.assign(new Error('TypeError: Failed to fetch https://secret.example/x'), {}));
    const html = w.dom.els.woList.innerHTML;
    ok(w.reports.length === 1 && w.reports[0][0] === 'tenant:loadWOs', 'tenant work-order load failure is reported');
    ok(/couldn.t load your work orders/i.test(html) && /TRY AGAIN/.test(html) && !/secret\.example/.test(html), 'tenant sees a friendly retry message, never raw error text');
    const w2 = mkT();
    build({ document: w2.dom.document, esc, window: w2.win, console: { error() {} } }, T.fn('showWOLoadError'), 'showWOLoadError').showWOLoadError(Object.assign(new Error('Unauthorized'), { http_status: 401 }));
    ok(w2.reports.length === 0 && /SIGN IN AGAIN/.test(w2.dom.els.woList.innerHTML), 'an expired session is NOT a failure report (normal), tenant is sent to sign in');
  }
  // restoreTenantSession IIFE
  {
    const start = T.js.indexOf('(function restoreTenantSession(){'); const end = T.js.indexOf('})();', start) + 5;
    const iife = T.js.slice(start, end);
    const run = (storage, onLogin) => { const reports = []; new Function('localStorage', 'SESS_KEY', 'onLoginSuccess', 'window', iife)(storage, 'k', onLogin, { hubReportFailure: (...a) => reports.push(a) }); return reports; };
    let n = 0;
    ok(run({ getItem() { throw new Error('blocked'); } }, () => n++).length === 0 && n === 0, 'tenant: blocked storage is benign');
    ok(run({ getItem: () => JSON.stringify({ token: 't' }) }, () => n++).length === 0 && n === 1, 'tenant: valid saved session logs in, nothing reported');
    ok(run({ getItem: () => JSON.stringify({ token: 't' }) }, () => { throw new Error('dash crashed'); }).length === 1, 'tenant: crash while restoring the session is reported');
  }
  // uploadTenantPhoto
  {
    const reports = [];
    const mkUp = (fetchImpl) => build({ fetch: fetchImpl, WORKER: 'https://w', SECRET: 's', FormData: class { append() {} }, window: { hubReportFailure: (...a) => reports.push(a) } }, T.fn('uploadTenantPhoto'), 'uploadTenantPhoto');
    const bad = await mkUp(async () => { throw new Error('offline'); }).uploadTenantPhoto({}, 'WO-5', 'report');
    ok(bad === false && reports.length === 1 && reports[0][2].ref === 'WO-5', 'tenant photo upload network failure still resolves false for the caller AND is reported');
    reports.length = 0;
    const good = await mkUp(async () => ({ ok: true, json: async () => ({ success: true }) })).uploadTenantPhoto({}, 'WO-5');
    ok(good === true && reports.length === 0, 'tenant photo upload happy path reports nothing');
  }
  // bgFailure
  {
    const reports = [];
    const w = build({ navigator: { onLine: true }, document: { hidden: false }, window: { hubReportFailure: (...a) => reports.push(a) } }, 'var _bgFails = {};\n' + T.fn('bgOk') + T.fn('bgFailure'), 'bgOk,bgFailure');
    for (let i = 0; i < 5; i++) w.bgFailure('tenant:sessionRefresh', new Error('x'));
    ok(reports.length === 1, 'tenant poll reported once after 5 consecutive failures');
  }
}

// ── 2c. trash.html loadNudge ──
{
  const P = page('trash.html'); const dom = fakeDom(); const reports = [];
  const mk = (api) => build({ api, document: dom.document, esc: (s) => String(s), window: { hubReportFailure: (...a) => reports.push(a) } }, P.fn('loadErrorNote') + P.fn('loadNudge'), 'loadNudge');
  await mk(async () => { throw new Error('nudge-boom'); }).loadNudge();
  ok(reports.length === 1 && /Could not load the Needs attention list/.test(dom.els.nudge.innerHTML), 'trash page: failed Needs-attention load is reported and says so on screen (not an empty box)');
  reports.length = 0; dom.els.nudge.textContent = 'x';
  await mk(async () => ({ items: [] })).loadNudge();
  ok(reports.length === 0 && dom.els.nudge.textContent === '', 'trash page: happy path (nothing to flag) reports nothing');
}

// ── 2d. proposal page: signature that cannot be delivered ──
{
  const html = read('proposal-3101gibbons-8fk3q2.html');
  ok(html.includes('<script src="failure-reporter.js"></script>'), 'proposal page now loads failure-reporter.js');
  ok(/\.then\(function\(r\)\{ if\(!r\.ok\) throw new Error\('sign endpoint HTTP '\+r\.status\); \}\)\.catch\(signNotSent\)/.test(html), 'a non-2xx answer from /proposal/sign is treated as a failure');
  const P = page('proposal-3101gibbons-8fk3q2.html');
  const start = P.js.indexOf('function signNotSent(e){'); let i = P.js.indexOf('{', start), d = 0; const m = mask(P.js).masked;
  for (; i < m.length; i++) { if (m[i] === '{') d++; else if (m[i] === '}') { d--; if (!d) { i++; break; } } }
  const fnText = P.js.slice(start, i);
  const reports = [], appended = [];
  const doneEl = { appendChild: (n) => appended.push(n) };
  const doc = { getElementById: (id) => id === 'done' ? doneEl : null, createElement: () => ({ style: {}, setAttribute() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; } }) };
  const f = new Function('document', 'window', fnText + '\nreturn signNotSent;')(doc, { hubReportFailure: (...a) => reports.push(a) });
  f(new Error('HTTP 500')); f(new Error('again'));
  ok(reports.length === 2 && reports[0][0] === 'proposal-sign', 'signing failure is reported');
}

// ── 2e. vendor-setup.html vCard parse ──
{
  const P = page('vendor-setup.html'); const reports = [];
  const f = build({ window: { hubReportFailure: (...a) => reports.push(a) } }, P.fn('parseVCardText'), 'parseVCardText');
  const out = f.parseVCardText({ toString() { throw new Error('unreadable card'); } });
  ok(reports.length === 1 && out && out.first_name === '', 'vCard parse failure is reported and the caller still gets the empty form fields');
  reports.length = 0;
  const good = f.parseVCardText('BEGIN:VCARD\nN:Doe;Jo;;;\nTEL:410-555-0100\nEND:VCARD');
  ok(reports.length === 0 && good.first_name === 'Jo' && good.phone === '410-555-0100', 'vCard happy path parses and reports nothing');
}

// ── 2f. test-login.js: a swallowed error in the test tool is recorded ──
{
  const src = read('test-login.js'); const errs = [];
  const win = {};
  const ctx = vm.createContext({ URLSearchParams, window: win, location: { search: '?testmode=1' }, sessionStorage: { setItem() { throw new Error('storage denied'); }, getItem() { throw new Error('storage denied'); } }, console: { error: (...a) => errs.push(a.join(' ')), log() {}, warn() {} }, document: {}, XMLHttpRequest: undefined, Storage: { prototype: {} } });
  try { vm.runInContext(src, ctx); } catch (e) { /* shim may need more browser objects; only the recorded error matters */ }
  ok(Array.isArray(win.__testLoginErrors) && win.__testLoginErrors.some(m => /FAIL testmode flag: storage denied/.test(m)), 'test-login.js records a swallowed testmode-flag failure in window.__testLoginErrors', win.__testLoginErrors);
  ok(errs.some(m => /\[test-login\] FAIL/.test(m)), 'and prints a visible FAIL line to the console');
}

// ── 2g. smoke-staging.mjs: non-JSON body must print a FAIL and exit 1 ──
{
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not json</html>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(root, 'scripts/smoke-staging.mjs'), 'http://127.0.0.1:' + port], { stdio: ['ignore', 'pipe', 'pipe'] });
    let s = ''; p.stdout.on('data', d => s += d); p.stderr.on('data', d => s += d); p.on('close', code => resolve({ code, s }));
  });
  server.close();
  ok(/FAIL \/health returned a non-JSON body/.test(out.s) && out.code === 1, 'smoke test prints an explicit FAIL for a non-JSON body and exits 1', out);
}

// ── 2h. Apps Script ──
function loadGs(file, globals) {
  const ctx = vm.createContext(Object.assign({ Logger: { log() {} }, console }, globals));
  vm.runInContext(read(file), ctx);
  return ctx;
}
{
  // ReceiptMailToHub.gs
  const mail = [], propsStore = {};
  const props = { getProperty: (k) => propsStore[k] === undefined ? null : propsStore[k], setProperty: (k, v) => { propsStore[k] = v; }, deleteProperty: (k) => { delete propsStore[k]; }, getKeys: () => Object.keys(propsStore) };
  let removeBehaviour = () => {}; const removed = [];
  const ctx = loadGs('apps-script/receipt-mail-to-hub/ReceiptMailToHub.gs', {
    PropertiesService: { getScriptProperties: () => props },
    MailApp: { sendEmail: (m) => { if (ctx_mailFail) throw new Error('mail quota'); mail.push(m); } },
    Gmail: { Users: { Settings: { Filters: { remove: (u, id) => { removeBehaviour(id); removed.push(id); } } } } },
  });
  let ctx_mailFail = false;

  const res = { removed: 0, failures: [] };
  ctx.removeFilter_('F1', res, 'rule R1');
  ok(res.removed === 1 && res.failures.length === 0, 'gs: removing a filter that exists counts as removed');
  removeBehaviour = () => { throw new Error('Requested entity was not found. 404'); };
  const res2 = { removed: 0, failures: [] }; ctx.removeFilter_('F2', res2, 'rule R2');
  ok(res2.removed === 0 && res2.failures.length === 0, 'gs: a filter that is already gone is not a failure');
  removeBehaviour = () => { throw new Error('Backend Error 503'); };
  const res3 = { removed: 0, failures: [] }; ctx.removeFilter_('F3', res3, 'rule R3');
  ok(res3.failures.length === 1 && /F3/.test(res3.failures[0]) && /503/.test(res3.failures[0]), 'gs: a real filter-removal failure is recorded in result.failures (was swallowed)');

  // syncRules_ end to end for the "rule no longer approved" branch
  propsStore['filter:R9'] = JSON.stringify({ id: 'F9', sig: 's' });
  ctx.readRules_ = () => []; ctx.gmailLabelId_ = () => 'L1';
  const sync = ctx.syncRules_({}, {}, 'me@x');
  ok(sync.failures.length === 1 && /F9/.test(sync.failures[0]) && sync.removed === 0, 'gs: syncRules_ surfaces a failed removal of a stale filter');
  ok(propsStore['filter:R9'] !== undefined, 'gs: syncRules_ KEEPS the saved record when the removal failed (so the next run reports it again)');
  propsStore['filter:R8'] = '{corrupt';
  const sync2 = ctx.syncRules_({}, {}, 'me@x');
  ok(sync2.failures.some(f => /unreadable/.test(f)), 'gs: a corrupt saved filter record is reported, not swallowed');

  // alertBrett_
  ctx_mailFail = false;
  const sent1 = ctx.alertBrett_({ Notify_Email: 'b@x.test' }, 'Gmail filter cleanup failed', 'detail A');
  const sent2 = ctx.alertBrett_({ Notify_Email: 'b@x.test' }, 'Gmail filter cleanup failed', 'detail A');
  ok(sent1 === true && sent2 === false && mail.length === 1 && mail[0].to === 'b@x.test', 'gs: alert email goes to Notify_Email once per 6 hours (no flood)');
  ctx_mailFail = true;
  let threw = false; try { ctx.alertBrett_({ Notify_Email: 'b@x.test' }, 'Other problem', 'd'); } catch (e) { threw = /could not send its alert/.test(String(e && e.message || e)); }
  ok(threw, 'gs: if even the alert email fails the run fails loudly (Apps Script emails the trigger failure)');
}
{
  // BuildiumIntake.gs
  const bad = { getResponseCode: () => 200, getContentText: () => '<html>gateway</html>' };
  const good = { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, created: true, wo_id: 'WO-1', sms_sent: true, telemetry_ok: true }) };
  let next = bad;
  const ctx = loadGs('apps-script/buildium-intake/BuildiumIntake.gs', { UrlFetchApp: { fetch: () => next } });
  const m = { getSubject: () => 'Phoenix: Work order 12', getPlainBody: () => 'b', getFrom: () => 'x@managebuilding.com', getId: () => 'm1', getDate: () => new Date('2026-10-01T00:00:00Z') };
  const r = ctx.send_(m, 'tok', false);
  ok(r.ok === false && /HTTP 200/.test(r.raw), 'gs buildium: a 200 with a non-JSON body is returned as ok:false (so the caller emails Brett)');
  next = good; const r2 = ctx.send_(m, 'tok', false);
  ok(r2.ok === true && r2.attention === false, 'gs buildium: happy path unchanged');
}

// ── 3. converted (non-benign) sites really call the reporter ──
{
  const must = [['wo.html', /wo:versionCheck failing repeatedly/], ['submit.html', /submit:versionCheck failing repeatedly/], ['customer.html', /customer:versionCheck failing repeatedly/],
    ['tenant-wo-access.html', /tenant-wo-access:versionCheck failing repeatedly/], ['shop/index.html', /shop:placeOrder request/], ['shop/index.html', /shop:placeOrder'/],
    ['tenant.html', /tenant:uploadPhoto/], ['vendor.html', /vendor:restoreSession/], ['test-login.js', /tlFail\('portal session mint'/], ['test-login.js', /tlFail\('fetch rewrite/]];
  for (const [f, re] of must) ok(re.test(read(f)), f + ' reports ' + re);
  ok(/<script src="\.\.\/failure-reporter\.js"><\/script>/.test(read('shop/index.html')), 'public shop page now loads failure-reporter.js');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
