// Oct 14 2026: daily_qb_sync could never finish inside one scheduler call (one Sheets read+write PER payable row, ~108 rows).
// Now: ONE verified batch write for the stored copy + resumable time-slices for the per-row side effects and the sweep.
// The real functions are cut out of worker.js and run against in-memory fakes with an injected clock.
import fs from 'fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
const code = [
  "const QB_SYNC_SLICE_MS = 30 * 1000; const QB_SYNC_MIN_LOOP_MS = 12 * 1000; const QB_SYNC_LOG_KEEP = 20; const QB_SYNC_PROGRESS_KEY = 'qb_sync_progress';",
  grab(wsrc, 'function qbSyncRowKey('), grab(wsrc, 'async function qbSyncWriteInvoiceReview('), grab(wsrc, 'async function qbSyncPayments('),
  grab(wsrc, 'async function schedRunDailyQbSync('), grab(wsrc, 'async function qbSyncReadProgress('), grab(wsrc, 'async function qbSyncWriteProgress('),
  grab(wsrc, 'async function logAndCollectError('), grab(wsrc, 'function idColIndex('), grab(wsrc, 'function col('),
  grab(wsrc, 'function schedErrText('), grab(wsrc, 'async function schedUnwrap('), grab(wsrc, 'function schedFindRow('), grab(wsrc, 'function schedCell('),
].join('\n');

const IR_HEAD = ['ID', 'WO_ID', 'Customer_Paid', 'Vendor_Paid', 'Payable_State', 'Payment_Checked'];
function build(opts) {
  opts = opts || {};
  const clockRef = { v: 1000 };
  const sheets = { Invoice_Review: [IR_HEAD.slice()], Config: [['Key', 'Value']] };
  for (let i = 1; i <= (opts.irRows == null ? 6 : opts.irRows); i++) sheets.Invoice_Review.push(['IR' + i, 'WO-' + i, '', '', '', '']);
  const calls = [], telemetry = [], transitions = [], sweeps = [], woUpdates = [], audits = [];
  const rows = opts.rows || [];
  const env = {};
  const stubs = {
    invalidateTabCache: () => {},
    sheetsRequest: async (e, method, path, body) => {
      calls.push(method + ' ' + path);
      if (opts.sheetFail && opts.sheetFail(method, path)) throw new Error('Sheets API error: injected');
      let m;
      if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) return { values: sheets[decodeURIComponent(m[1])].map(r => r.slice()) };
      if (method === 'POST' && path === '/values:batchUpdate') {
        if (opts.dropWrites) return {};
        for (const d of body.data) {
          const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
          const c = mm[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, r = +mm[2] - 1;
          while (sheets[tab].length <= r) sheets[tab].push([]); while (sheets[tab][r].length <= c) sheets[tab][r].push('');
          sheets[tab][r][c] = d.values[0][0];
        }
        return {};
      }
      if (method === 'POST' && /:append/.test(path)) { sheets.Config.push(body.values[0].slice()); return {}; }
      throw new Error('unexpected sheets call ' + method + ' ' + path);
    },
    ensureColumns: async () => {},
    qbPayables: async () => { clockRef.v += (opts.payablesMs || 0); return { clone() { return this; }, async json() { return opts.payablesFail ? { ok: false, error: 'QB down' } : { ok: true, count: rows.length, rows, owed_now: 0, owed_total: 0, warnings: [] }; } }; },
    fetchTab: async (e, tab) => tab === 'Scope_Signatures' ? [1, 2, 3, 4, 5].map(n => ({ ID: String(n), Scope_ID: String(n) })) : (opts.workorders || []), WOStatus: { sets: { CLOSED_FINAL: ['Paid', 'Closed'] } },
    findWO: (list, id) => list.find(w => w.ID === id),
    updateWOFields: async (e, id, f) => { woUpdates.push({ id, f }); }, logWOAudit: async (...a) => { if (opts.auditFails) throw new Error('audit sheet down'); audits.push(a); },
    scopeDepositPaidTransition: async (e, scopeId) => { transitions.push(scopeId); clockRef.v += (opts.transitionMs || 20); if (opts.transitionFails && opts.transitionFails(scopeId)) throw new Error('transition boom'); return {}; },
    fetchConfig: async () => ({}), ESTIMATE_SMS_DEFAULT_SINCE: '2026-09-29T00:00:00.000Z',
    processDepositPaidSweep: async () => { sweeps.push(1); if (opts.sweepFails && opts.sweepFails()) throw new Error('sweep boom'); return { ok: true }; },
    json: (b, s) => ({ status: s || 200, clone() { return this; }, async json() { return b; }, body: b }),
    logTelemetry: async (e, rec) => { telemetry.push(rec); },
    schedReadConfigRows: async () => sheets.Config.map(r => r.slice()),
    schedEtParts: () => ({ date: '2026-10-14' }),
  };
  const names = Object.keys(stubs);
  const lib = new Function(...names, code + '\nreturn { qbSyncPayments, schedRunDailyQbSync, qbSyncWriteInvoiceReview, qbSyncRowKey, qbSyncReadProgress, qbSyncWriteProgress };')(...names.map(n => stubs[n]));
  return Object.assign(lib, { sheets, calls, telemetry, transitions, sweeps, woUpdates, audits, env, clock: () => clockRef.v, clockRef });
}
const irRow = (n, o) => Object.assign({ ir_id: 'IR' + n, wo_id: 'WO-' + n, customer_paid: true, vendor_paid: false, state: 'waiting on the owner' }, o || {});
const sigRow = (n, o) => Object.assign({ source: 'scope_signature', signature_id: String(n), phase: 'deposit', wo_id: 'WO-S' + n, customer_paid: true, vendor_paid: false, ir_id: '' }, o || {});
const body = async (res) => (await res.clone().json());

// 1. one batch write, verified
{
  const X = build({ rows: [irRow(1), irRow(2, { customer_paid: false, state: 'PAY THE VENDOR' }), irRow(3, { customer_paid: null, vendor_paid: null, state: 'nothing to pay' }), sigRow(1)] });
  const b = await body(await X.qbSyncPayments(X.env, {}));
  const ir = X.sheets.Invoice_Review;
  t('batch: stored copy written for every invoice row', ir[1][2] === 'TRUE' && ir[1][3] === 'FALSE' && ir[1][4] === 'waiting on the owner' && ir[2][2] === 'FALSE' && ir[2][4] === 'PAY THE VENDOR' && ir[3][2] === '' && ir[3][3] === '' && !!ir[1][5], ir);
  t('batch: rows not in the payables list are untouched', ir[4][4] === '' && ir[5][4] === '' && ir[6][4] === '');
  t('batch: ONE batchUpdate for all rows (was one read + one write per row)', X.calls.filter(c => c === 'POST /values:batchUpdate').length === 1 && X.calls.length <= 4, X.calls);
  t('batch: result counts + no errors', b.ok && b.written === 3 && b.failed === 0 && b.errors.length === 0 && b.partial === false && Array.isArray(b.rows) && b.rows.length === 4, b);
  t('batch: the Signed-Proposal row is not written to Invoice_Review, but its deposit transition ran', X.transitions.join() === '1' && X.sheets.Invoice_Review.length === 7);
  t('one-pass: sweep ran once', X.sweeps.length === 1 && b.deposit_sweep && b.deposit_sweep.ok === true);
}
// 2. failures are loud: write that does not land, row not found, whole batch failing
{
  const X = build({ rows: [irRow(1), irRow(2)], dropWrites: true });
  const b = await body(await X.qbSyncPayments(X.env, {}));
  t('a batchUpdate that "succeeds" but changes nothing is a FAILURE (verified by re-read)', b.failed === 2 && b.written === 0 && b.errors.length === 2 && /did not land/.test(b.errors[0].error), b);
  t('...and is logged to Ops_Telemetry with record ids', X.telemetry.filter(r => r.Job_Type === 'qb_sync_write_invoice_review' && r.Success === 'FALSE').length === 2 && /IR1/.test(X.telemetry[0].Notes));
}
{
  const X = build({ rows: [irRow(1), irRow(99, { wo_id: 'WO-99' }), irRow(2, { ir_id: '' })] });
  const b = await body(await X.qbSyncPayments(X.env, {}));
  t('a payable row with no Invoice_Review row / no ir_id is reported, the others still written', b.written === 1 && b.failed === 2 && b.errors.some(e => /not found/.test(e.error)) && b.errors.some(e => /no ir_id/.test(e.error)) && X.sheets.Invoice_Review[1][4] === 'waiting on the owner', b);
}
{
  const X = build({ rows: [irRow(1), irRow(2)], sheetFail: (m, p) => m === 'POST' });
  const b = await body(await X.qbSyncPayments(X.env, {}));
  t('the whole batch write throwing is reported + logged (never swallowed), the sweep still runs', b.failed === 2 && b.errors.length === 1 && /batch write/.test(b.errors[0].ref) && X.telemetry.some(r => r.Job_Type === 'qb_sync_write_invoice_review') && X.sweeps.length === 1, b);
}
{
  const X = build({ payablesFail: true });
  const res = await X.qbSyncPayments(X.env, {}, { state: { done: [] } });
  const b = await body(res);
  t('payables read failing is returned as ok:false (not an empty "success")', b.ok === false && /QB down/.test(b.error));
}
// 3. side effects: WO auto-close, audit failure is loud
{
  const X = build({ rows: [irRow(1, { vendor_paid: true }), irRow(2, { vendor_paid: true })], workorders: [{ ID: 'WO-1', Status: 'Complete' }, { ID: 'WO-2', Status: 'Paid' }], auditFails: true });
  const b = await body(await X.qbSyncPayments(X.env, {}));
  t('WO auto-close: closes the open one, leaves the already-Paid one', X.woUpdates.length === 1 && X.woUpdates[0].id === 'WO-1' && b.closed === 1, b);
  t('WO auto-close: an audit row that did not save is reported (was an empty catch)', b.errors.some(e => e.stage === 'qb_sync_wo_audit'), b.errors);
}
// 4. slicing
const sigRows = () => [irRow(1), irRow(2), sigRow(1), sigRow(2), sigRow(3), sigRow(4), sigRow(5)];
{
  const X = build({ rows: sigRows(), transitionMs: 20 });
  const st = { done: [], totals: undefined };
  const r1 = await body(await X.qbSyncPayments(X.env, {}, { state: st, sliceMs: 50, now: X.clock }));
  t('slice 1: stops before the next row when the slice is spent, partial, no sweep yet', r1.partial === true && X.sweeps.length === 0 && !st.loop_done && X.transitions.length === 3 && st.ir_done === true, { r1, tr: X.transitions });
  t('slice 1: progress remembers which rows are done', st.done.length === 2 + 3 && st.done.includes('sig:1:deposit:') && st.done.includes('ir:IR1'), st.done);
  t('slice 1: does not return the big rows list', r1.rows === undefined);
  const writesAfter1 = X.calls.filter(c => c === 'POST /values:batchUpdate').length;
  const r2 = await body(await X.qbSyncPayments(X.env, {}, { state: st, sliceMs: 50, now: X.clock }));
  t('slice 2: resumes - finishes the remaining rows, runs the sweep exactly once, not partial', r2.partial === false && st.loop_done && st.sweep_done && X.sweeps.length === 1 && X.transitions.length === 5 && new Set(X.transitions).size === 5, { r2, tr: X.transitions });
  t('slice 2: the stored-copy batch write is NOT repeated', X.calls.filter(c => c === 'POST /values:batchUpdate').length === writesAfter1);
  t('slices accumulate their totals', r2.written === 2 && r2.checked === 7, r2);
}
{
  // sweep stage alone: after the rows are done the next slice skips the QuickBooks read entirely
  const X = build({ rows: sigRows(), transitionMs: 0, sweepFails: (() => { let n = 0; return () => n++ === 0; })() });
  const st = { done: [] };
  const r1 = await body(await X.qbSyncPayments(X.env, {}, { state: st, sliceMs: 1000, now: X.clock }));
  t('a sweep that throws is reported, the pass is not marked finished', r1.errors.some(e => e.stage === 'qb_sync_deposit_sweep') && st.loop_done === true && !st.sweep_done && r1.partial === true, r1);
  let payablesCalls = 0; const origCalls = X.calls.length;
  const r2 = await body(await X.qbSyncPayments(X.env, {}, { state: st, sliceMs: 1000, now: X.clock }));
  t('retry slice runs ONLY the sweep (no QuickBooks read, no row side effects repeated)', r2.partial === false && st.sweep_done === true && X.sweeps.length === 2 && X.transitions.length === 5 && X.calls.length === origCalls, { r2, calls: X.calls.slice(origCalls) });
}
// 5. the job wrapper: progress across ticks, done once per day
{
  const X = build({ rows: sigRows(), transitionMs: 20 });
  let saved = null;
  const progress = { read: async () => (saved ? JSON.parse(saved) : null), write: async (p) => { saved = JSON.stringify(p); } };
  const o = { today: '2026-10-14', sliceMs: 50, now: X.clock, progress };
  const j1 = await X.schedRunDailyQbSync(X.env, null, o);
  t('job tick 1: ok + partial (the dispatcher will resume it), progress saved', j1.ok === true && j1.partial === true && JSON.parse(saved).complete === false && JSON.parse(saved).done.length === 5, j1);
  const j2 = await X.schedRunDailyQbSync(X.env, null, o);
  const p2 = JSON.parse(saved);
  t('job tick 2: finishes - NOT partial, marked complete with a finish time', j2.ok === true && !j2.partial && p2.complete === true && !!p2.finished && p2.sweep_done === true, { j2, p2 });
  const j3 = await X.schedRunDailyQbSync(X.env, null, o);
  t('job tick 3 (same day): nothing to do, nothing re-run', j3.ok === true && /already finished/.test(j3.detail.skipped) && X.sweeps.length === 1 && X.transitions.length === 5, j3);
  const j4 = await X.schedRunDailyQbSync(X.env, null, Object.assign({}, o, { today: '2026-10-15' }));
  t('next ET day starts a fresh pass (slice 1 of the new day, nothing carried over)', j4.ok === true && JSON.parse(saved).date === '2026-10-15' && JSON.parse(saved).slices === 1 && JSON.parse(saved).complete === false && JSON.parse(saved).done.length > 0, j4);
}
{
  // an error during a slice fails that tick loudly; the retry completes without redoing finished work
  const X = build({ rows: [irRow(1), sigRow(1), sigRow(2)], transitionMs: 0, transitionFails: (id) => id === '1' });
  let saved = null;
  const progress = { read: async () => (saved ? JSON.parse(saved) : null), write: async (p) => { saved = JSON.stringify(p); } };
  const o = { today: '2026-10-14', sliceMs: 1000, now: X.clock, progress };
  const j1 = await X.schedRunDailyQbSync(X.env, null, o);
  t('job: a row error fails the tick (ok:false, error text, telemetry) and the day is NOT marked complete', j1.ok === false && j1.errors.some(e => /qb_sync_payments/.test(e.step) && /transition boom/.test(e.error)) && JSON.parse(saved).complete === false && X.telemetry.some(r => r.Job_Type === 'daily_qb_sync_payments' && r.Success === 'FALSE'), j1);
  const before = X.transitions.length;
  const j2 = await X.schedRunDailyQbSync(X.env, null, o);
  t('job: the retry only has bookkeeping left, completes, and re-runs no side effects', j2.ok === true && JSON.parse(saved).complete === true && X.transitions.length === before, { j2, before, after: X.transitions.length });
}
{
  // progress store failures are job failures, never a silent restart
  const X = build({ rows: [irRow(1)] });
  const bad = await X.schedRunDailyQbSync(X.env, null, { today: '2026-10-14', progress: { read: async () => { throw new Error('Config unreadable'); }, write: async () => {} } });
  t('progress read failing = job failure and nothing runs', bad.ok === false && /Config unreadable/.test(JSON.stringify(bad.errors)) && X.sweeps.length === 0 && X.calls.length === 0, bad);
  const bad2 = await X.schedRunDailyQbSync(X.env, null, { today: '2026-10-14', progress: { read: async () => null, write: async () => { throw new Error('write did not land'); } } });
  t('progress write failing = job failure (the pass may repeat, and it says so)', bad2.ok === false && /could not save progress/.test(JSON.stringify(bad2.errors)) && /may run again/.test(JSON.stringify(bad2.errors)), bad2);
}
{
  // the real Config progress row: written, verified by re-read, read back; corrupt JSON is loud
  const X = build({ rows: [irRow(1)] });
  const o = { today: '2026-10-14', now: X.clock };
  const j = await X.schedRunDailyQbSync(X.env, null, o);
  const cfg = Object.fromEntries(X.sheets.Config.filter(r => r[0]).map(r => [r[0], r[1]]));
  t('real Config row qb_sync_progress holds the finished pass', j.ok === true && JSON.parse(cfg.qb_sync_progress).complete === true, { j, cfg });
  const j2 = await X.schedRunDailyQbSync(X.env, null, o);
  t('...and a second call the same day is a no-op', j2.ok === true && /already finished/.test(j2.detail.skipped));
  X.sheets.Config.find(r => r[0] === 'qb_sync_progress')[1] = '{not json';
  const j3 = await X.schedRunDailyQbSync(X.env, null, o);
  t('corrupt progress row is a loud failure that says how to reset it', j3.ok === false && /not valid JSON/.test(JSON.stringify(j3.errors)) && /delete that row/.test(JSON.stringify(j3.errors)), j3);
}
// 6. tripwires on the real source
{
  const qbs = grab(wsrc, 'async function qbSyncPayments(');
  t('no swallowing catch left in qbSyncPayments / the batch writer', !/catch\s*\(\w*\)\s*\{\s*\}/.test(qbs) && !/catch\s*\(_\)/.test(qbs) && !/catch\s*\(\w*\)\s*\{\s*\}/.test(grab(wsrc, 'async function qbSyncWriteInvoiceReview(')));
  t('qbSyncPayments no longer does a per-row updateRow of Invoice_Review', !qbs.includes("updateRow(env, 'Invoice_Review'"));
  t('daily_qb_sync is still a daily job in the registry', /name: 'daily_qb_sync',\s+kind: 'daily',\s+at: '07:00'/.test(wsrc));
}
console.log(`qb-sync-sliced: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
