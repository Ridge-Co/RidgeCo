// Oct 20 2026 review fixes (page side): trash.html load_errors, receipt-reconciler audit warnings, tenant load-error guard, poller guards, scope-creator log-attachment.
// Lifts the REAL function text out of the pages into a fake DOM.   Run: node test/c1-review-pages.test.mjs
import { readFileSync } from 'node:fs';
import { grabFn, pageScript, ROOT, makeOk } from './cpa-helpers.mjs';
import { join } from 'node:path';
const T = makeOk(); const ok = T.ok;
const tick = () => new Promise(r => setTimeout(r, 0));

// ── a small fake DOM that understands children, textContent, innerHTML ──
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attrs = {}; this.className = ''; this._text = ''; this._html = ''; this.id = ''; }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._text = ''; }
  text() { return this._text + ' ' + this._html + ' ' + this.children.map(c => c.text()).join(' | '); }
  find(fn) { if (fn(this)) return this; for (const c of this.children) { const r = c.find(fn); if (r) return r; } return null; }
}
const mkDoc = () => { const els = {}; return { els, document: { getElementById: (id) => (els[id] = els[id] || Object.assign(new El('div'), { id })), createElement: (t) => new El(t) } }; };

// ═════════ trash.html ═════════
console.log('trash.html');
{
  const src = ['loadErrorNote', 'loadNudge', 'loadWeek'].map(n => grabFn('trash.html', n)).join('\n');
  const mk = (api) => {
    const d = mkDoc(); const reports = [];
    const f = new Function('api', 'document', 'window', 'esc', 'money', 'renderBatchBar', 'curWeekKey', 'weekListCache', 'selectedForBatch', 'addDaysStr', 'mondayOf', 'todayStr',
      src + '\nreturn { loadNudge, loadWeek };');
    const X = f(api, d.document, { hubReportFailure: (...a) => reports.push(a) }, (s) => String(s == null ? '' : s).replace(/</g, '&lt;'), (n) => '$' + n, () => {}, {}, {}, {}, (s) => s, (s) => s, () => '2026-10-19');
    return { X, d, reports };
  };
  let w = mk(async () => ({ items: [], load_errors: ['Trash_Visits read failed: quota'] }));
  await w.X.loadNudge();
  let note = w.d.els.nudge.find(c => c.className === 'load-err');
  ok(note && note.attrs.role === 'alert' && /Trash_Visits read failed: quota/.test(note.text()) && /not "nothing to do"/.test(note.text()), 'nudge: load_errors alone (no items) shows a red persistent note, not an empty box');
  ok(!w.d.els.nudge.find(c => c.className === 'banner'), '...and no empty "Needs attention" banner');
  w = mk(async () => ({ items: [{ type: 'load_error', message: 'Could not read visits <b>x</b>' }, { type: 'unbilled', message: 'Bldg 1 not billed' }] }));
  await w.X.loadNudge();
  const lis = []; w.d.els.nudge.find(c => { if (c.tag === 'li') lis.push(c); return false; });
  ok(lis.length === 2 && lis[0].style.color === 'var(--danger)' && lis[0].textContent === 'Could not read visits <b>x</b>' && lis[1].style.color === undefined, "nudge: an item of type 'load_error' is a red line set via textContent; a normal item is not red");
  w = mk(async () => ({ items: [{ message: 'plain' }] })); await w.X.loadNudge();
  ok(!w.d.els.nudge.find(c => c.className === 'load-err'), 'nudge: no load_errors, no red note');
  w = mk(async () => ({ week: '2026-10-19', properties: [], load_errors: ['Trash_Skips read failed'] }));
  await w.X.loadWeek(0);
  note = w.d.els.week.find(c => c.className === 'load-err');
  ok(note && /Trash_Skips read failed/.test(note.text()) && !/Nothing on file/.test(w.d.els.week.text()), 'week: empty list + load_errors shows the red note instead of "Nothing on file"');
  w = mk(async () => ({ week: '2026-10-19', properties: [{ property_id: 'p1', label: 'Bldg 1', logged: 1, expected: 2, total: 0 }], load_errors: ['Trash_Skips read failed'] }));
  await w.X.loadWeek(0);
  ok(w.d.els.week.children[0] && w.d.els.week.children[0].className === 'load-err' && /Bldg 1/.test(w.d.els.week.text()), 'week: with rows, the red note sits above the list');
  w = mk(async () => ({ week: '2026-10-19', properties: [] })); await w.X.loadWeek(0);
  ok(/Nothing on file/.test(w.d.els.week.text()) && !w.d.els.week.find(c => c.className === 'load-err'), 'week: genuinely empty still says so');
  w = mk(async () => { throw new Error('week-boom'); }); await w.X.loadWeek(0);
  ok(w.reports.length === 1 && w.d.els.week.find(c => c.className === 'load-err') && /week-boom/.test(w.d.els.week.text()), 'week: a failed request is reported and shown (it had no catch at all)');
}

// ═════════ receipt-reconciler.html ═════════
console.log('receipt-reconciler.html');
{
  const src = grabFn('receipt-reconciler.html', 'runFullAudit');
  const run = async (buildResponses, scanResponses) => {
    const prog = new El('div'); const log = [];
    Object.defineProperty(prog, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; log.push(v); } });
    const btn = new El('button');
    const document = { getElementById: (id) => id === 'audit-progress' ? prog : id === 'audit-run-btn' ? btn : null };
    let bi = 0, si = 0;
    const post = async (path) => path.endsWith('build-index') ? buildResponses[bi++] : scanResponses[si++];
    const fn = new Function('post', 'document', 'loadQueue', 'var auditRunning = false, auditStatusFilter = "";\n' + src + '\nreturn runFullAudit;')(post, document, async () => {});
    await fn();
    return { prog, log };
  };
  const scanOk = [{ total_receipts: 5, scanned_this_batch: 5, flagged_new: 1, done: true }];
  let r = await run([{ total_invoices: 4, opened_this_batch: 4, done: true, list_query_carried_line: true }], scanOk);
  ok(/^✅ Done — 4 invoices indexed/.test(r.prog.textContent) && !/WARNING/.test(r.prog.textContent) && !r.prog.style.color, 'clean run: plain Done message, no warning, not red');
  r = await run([{ total_invoices: 10, opened_this_batch: 7, open_failures: 3, failed_invoice_ids: ['1764', '1765', '1790'], failure_warning: '3 invoice(s) could not be opened...', done: true }], scanOk);
  ok(/WARNING: 3 invoice\(s\) could not be opened, so duplicate flags may be missing: 1764, 1765, 1790/.test(r.prog.textContent) && /^⚠ Done — 7 invoices indexed/.test(r.prog.textContent), 'open_failures + failed_invoice_ids appear in the Done message', r.prog.textContent);
  ok(r.prog.style.color === '#c0392b', '...in red');
  ok(r.log.slice(0, -1).some(l => /Indexing invoices: 7 \/ 10….*WARNING: 3 invoice/.test(l)) , 'the warning is also in the live progress line (setProg)');
  r = await run([{ total_invoices: 2, opened_this_batch: 1, done: false, next_offset: 1, clear_warning: 'Old cache rows could not be cleared (quota)', open_failures: 1, failed_invoice_ids: ['9'] },
                 { total_invoices: 2, opened_this_batch: 1, done: true, open_failures: 1, failed_invoice_ids: ['9', '10'] }], scanOk);
  ok(/Old cache rows could not be cleared \(quota\)/.test(r.prog.textContent) && /2 invoice\(s\) could not be opened.*: 9, 10/.test(r.prog.textContent), 'clear_warning is shown and failures add up across batches with unique ids', r.prog.textContent);
  r = await run([{ total_invoices: 1, opened_this_batch: 1, done: true, warning: 'something plain' }], scanOk);
  ok(/WARNING: something plain/.test(r.prog.textContent), 'a plain `warning` field is shown too');
  ok(!/prog2?\.innerHTML|setProg.*innerHTML/.test(src), 'progress text is set with textContent only (no innerHTML with server strings)');
}

// ═════════ tenant.html showWOLoadError ═════════
console.log('tenant.html');
{
  const src = grabFn('tenant.html', 'showWOLoadError');
  const run = (err, online) => {
    const reports = []; const list = new El('div');
    const f = new Function('document', 'window', 'navigator', 'esc', 'console', src + '\nreturn showWOLoadError;');
    f({ getElementById: (id) => id === 'woList' ? list : new El('x') }, { hubReportFailure: (...a) => reports.push(a) }, { onLine: online }, (s) => String(s), { error() {} })(err);
    return { reports, list };
  };
  let r = run(new Error('boom'), true); ok(r.reports.length === 1 && /couldn't load/.test(r.list.innerHTML), 'a real failure is reported and shown');
  r = run(new Error('boom'), false); ok(r.reports.length === 0 && /couldn't load/.test(r.list.innerHTML), 'offline: still shown to the tenant, not reported');
  r = run(Object.assign(new Error('t'), { name: 'TimeoutError' }), true); ok(r.reports.length === 0 && /timed out/.test(r.list.innerHTML), 'TimeoutError: shown as a timeout, not reported');
  r = run(Object.assign(new Error('t'), { name: 'AbortError' }), true); ok(r.reports.length === 0, 'AbortError: not reported');
}

// ═════════ poller counters ═════════
console.log('pollers');
for (const f of ['customer.html', 'submit.html', 'tenant-wo-access.html']) {
  const js = pageScript(f);
  ok(/navigator\.onLine !== false && !document\.hidden && \+\+fails === 5/.test(js), f + ': a miss counts only when online and the tab is visible');
}
ok(/navigator\.onLine!==false&&!document\.hidden&&\+\+fails===5/.test(pageScript('wo.html')), 'wo.html: a miss counts only when online and the tab is visible');
for (const f of ['tenant.html', 'vendor.html']) {
  const fn = grabFn(f, 'bgFailure');
  ok(/navigator\.onLine === false \|\| document\.hidden/.test(fn) && /AbortError/.test(fn) && /TimeoutError/.test(fn), f + ': bgFailure ignores offline / hidden / aborted / timed-out');
}

// ═════════ scope-creator.html log-attachment ═════════
console.log('scope-creator.html');
{
  const js = pageScript('scope-creator.html');
  const i = js.indexOf("post('/log-attachment'"); const seg = js.slice(i, js.indexOf('\n', i));
  ok(/\.then\(function\(lr\)\{ if \(lr && \(lr\.error \|\| lr\.success === false\)\) throw/.test(seg) && /\.catch\(function\(e2\)/.test(seg) && /not linked to the scope/.test(seg), 'a resolved {error} from /log-attachment goes down the same visible "not linked" path as a network error');
}

// ═════════ vendor.html: no double report ═════════
console.log('vendor.html');
{
  const fn = grabFn('vendor.html', 'loadPortalAttachments');
  ok(!/hubReportFailure/.test(fn) && /showLoadFailed\(/.test(fn) && !/if \(!Array\.isArray\(items\)\) return;/.test(fn), 'loadPortalAttachments: one report path (showLoadFailed), no silent non-array return');
}
T.done('c1-review-pages');
