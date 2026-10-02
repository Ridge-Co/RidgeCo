// qbSyncPayments batching (Oct 2 2026). ROOT CAUSE it pins: the sync did 2+ subrequests PER payable row (updateRow = full-sheet
// GET + write) plus 3+ per WO closure, so ~100 rows blew Cloudflare's per-invocation subrequest cap and every later write --
// including WO -> Paid -- failed; ~47 paid work orders sat on "Invoiced". The cost must now be constant, not O(rows).
// Extracts the REAL qbSyncPayments from worker.js and runs it against an in-memory Sheets fake that COUNTS subrequests and
// enforces a hard cap like Cloudflare does.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const colL = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const src = ['async function qbSyncPayments(', 'async function logAndCollectError('].map(s => grab(wsrc, s)).join('\n');

function world({ n = 110, cap = 40, stale = true, failBatch = false } = {}) {
  const w = { calls: 0, telemetry: [], audit: [], cap };
  const irH = ['ID', 'WO_ID', 'Customer_Paid', 'Vendor_Paid', 'Payable_State', 'Payment_Checked'];
  const woH = ['ID', 'Status'];
  w.ir = [irH]; w.wo = [woH]; const rows = [];
  for (let i = 1; i <= n; i++) {
    const id = 'WO-' + (1000 + i);
    w.ir.push([String(i), id, stale ? 'FALSE' : 'TRUE', stale ? 'FALSE' : 'TRUE', stale ? 'waiting on the owner' : 'vendor paid', '']);
    w.wo.push([id, 'Invoiced']);
    rows.push({ ir_id: String(i), wo_id: id, customer_paid: true, vendor_paid: true, state: 'vendor paid', bill_id: 'B' + i, vendor_ref: id });
  }
  // dup row for same WO (WO-1097 case) + a not-yet-paid row + a scope-signature deposit row (must NOT close) + already Paid WO
  rows.push({ ir_id: '1', wo_id: 'WO-1001', customer_paid: true, vendor_paid: true, state: 'vendor paid', bill_id: 'B1' });
  w.ir.push([String(n + 1), 'WO-5000', 'TRUE', 'FALSE', 'PAY THE VENDOR', '']); w.wo.push(['WO-5000', 'Invoiced']);
  rows.push({ ir_id: String(n + 1), wo_id: 'WO-5000', customer_paid: true, vendor_paid: false, state: 'PAY THE VENDOR', bill_id: 'X' });
  w.wo.push(['WO-6000', 'Invoiced']);
  rows.push({ source: 'scope_signature', phase: 'deposit', ir_id: '', wo_id: 'WO-6000', customer_paid: false, vendor_paid: true, state: 'vendor paid' });
  w.wo.push(['WO-7000', 'Paid']); w.ir.push([String(n + 2), 'WO-7000', 'TRUE', 'TRUE', 'vendor paid', '']);
  rows.push({ ir_id: String(n + 2), wo_id: 'WO-7000', customer_paid: true, vendor_paid: true, state: 'vendor paid', bill_id: 'P' });
  const tab = nm => nm === 'Invoice_Review' ? w.ir : nm === 'Work_Orders' ? w.wo : null;
  const ctx = {
    qbPayables: async () => ({ clone() { return { json: async () => ({ ok: true, count: rows.length, rows, owed_now: 1, owed_total: 5, warnings: [] }) }; } }),
    ensureColumns: async () => {},
    fetchTab: async (e, nm) => { w.calls++; if (w.calls > w.cap) throw new Error('Too many subrequests by single Worker invocation.'); const v = tab(nm); const [h, ...r] = v; return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); },
    findWO: (list, id) => list.find(x => x.ID === id),
    sheetsRequest: async (e, m, path, body) => {
      w.calls++; if (w.calls > w.cap) throw new Error('Too many subrequests by single Worker invocation.');
      if (m === 'GET') { const nm = path.split('/').pop(); return { values: tab(nm).map(r => r.slice()) }; }
      if (failBatch) throw new Error('sheets 500');
      for (const u of body.data) { const [sh, cell] = u.range.split('!'); const mm = cell.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of mm[1]) c = c * 26 + ch.charCodeAt(0) - 64; tab(sh)[Number(mm[2]) - 1][c - 1] = u.values[0][0]; }
      return {};
    },
    idColIndex: h => h.indexOf('ID'), col: colL,
    logWOAuditMany: async (e, ents) => { w.calls++; w.audit.push(...ents); },
    logTelemetry: async (e, rec) => { w.calls++; w.telemetry.push(rec); },
    scopeDepositPaidTransition: async () => ({}), fetchConfig: async () => ({}), ESTIMATE_SMS_DEFAULT_SINCE: 'x',
    processDepositPaidSweep: async () => ({ ok: true }), json: b => b,
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, src + '\nreturn qbSyncPayments;')(...names.map(k => ctx[k]));
  return { w, run: () => fn({}, {}) };
}

{ // 110 stale rows: constant cost, everything lands, hard cap respected
  const { w, run } = world({ n: 110, cap: 40 });
  const res = await run();
  t('no errors under a 40-subrequest cap with 110+ rows', res.errors.length === 0 && res.failed === 0);
  t('subrequest count is small & constant (<=12)', w.calls <= 12);
  t('110 distinct WOs closed (dup row for WO-1001 closed once)', res.closed === 110 && new Set(res.closed_wos.map(x => x.wo_id)).size === 110);
  t('every vendor-paid WO is now Paid', w.wo.slice(1, 111).every(r => r[1] === 'Paid'));
  t('unpaid-vendor WO untouched', w.wo.find(r => r[0] === 'WO-5000')[1] === 'Invoiced');
  t('scope-signature DEPOSIT row does not close its WO', w.wo.find(r => r[0] === 'WO-6000')[1] === 'Invoiced');
  t('already-Paid WO not re-closed or re-audited', !res.closed_wos.some(x => x.wo_id === 'WO-7000') && !w.audit.some(a => a.woId === 'WO-7000'));
  t('one audit entry per closure, with from/to', w.audit.length === 110 && w.audit[0].oldValue === 'Invoiced' && w.audit[0].newValue === 'Paid' && w.audit[0].changedBy === 'system-qb');
  t('stored payable state refreshed', w.ir[1][2] === 'TRUE' && w.ir[1][3] === 'TRUE' && w.ir[1][4] === 'vendor paid' && w.ir[1][5] !== '');
  t('already-current row NOT rewritten (unchanged counted)', res.unchanged >= 1 && w.ir[w.ir.length - 1][5] === '');
}
{ // second run is a no-op
  const { w, run } = world({ n: 30, cap: 40, stale: false });
  const res = await run();
  t('re-run with nothing changed: zero IR writes', res.written === 0 && res.errors.length === 0);
}
{ // failure is loud, not silent, and says no WO was marked
  const { w, run } = world({ n: 20, cap: 40, failBatch: true });
  const res = await run();
  t('batch write failure -> failed>0, errors[] says none marked Paid, telemetry written', res.failed > 0 && res.closed === 0 && res.errors.some(e => e.stage === 'qb_sync_auto_close_wo' && /none were marked Paid/.test(e.ref)) && w.telemetry.length >= 1);
  t('WOs NOT claimed closed when write failed', w.wo.slice(1, 21).every(r => r[1] === 'Invoiced'));
}
// wiring tripwire: the per-row updateRow / updateWOFields pattern must never come back inside the sync
const body = grab(wsrc, 'async function qbSyncPayments(');
t('qbSyncPayments no longer does per-row updateRow/updateWOFields/logWOAudit', !/await updateRow\(/.test(body) && !/await updateWOFields\(/.test(body) && !/await logWOAudit\(/.test(body));
console.log(`qb-sync-batching: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
