// Queue #53 Phase 1 of 4 (Nov 22 2026): the weekly pay run is READ-ONLY. Extracts the REAL payRun* functions from worker.js and
// renderPayRun/payRunMoney from index.html (same extract-the-real-function convention as who-to-pay-clearing.test.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
const here = dirname(fileURLToPath(import.meta.url));
const wsrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');
const isrc = readFileSync(join(here, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL: ' + msg); } assert.ok(cond, msg); }
function braced(src, start) { let i = src.indexOf('{', start), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } } return src.slice(start, i); }
const fn = (src, name, isAsync) => { const m = (isAsync ? 'async function ' : 'function ') + name + '('; const s = src.indexOf(m); if (s < 0) throw new Error(name + ' missing'); return braced(src, s); };

const pure = [fn(wsrc, 'payRunAmount'), fn(wsrc, 'payRunReason'), fn(wsrc, 'payRunBuild')].join('\n');
const { payRunBuild } = new Function(pure + '\nreturn { payRunBuild };')();
const R = o => Object.assign({ wo_id: 'WO-1', ir_id: '1', vendor_id: 'V1', vendor_name: 'Acme', vendor_cost: 100, vendor_balance: null, state: 'PAY THE VENDOR', customer_clear_status: 'cleared', bill_id: 'B1' }, o);

// ready / not ready, every reason
let out = payRunBuild([
  R({}),
  R({ ir_id: '2', vendor_balance: 50.1 }),
  R({ ir_id: '3', customer_clear_status: 'clearing', customer_clears_on: '2026-11-25' }),
  R({ ir_id: '4', customer_clear_status: 'unknown' }),
  R({ ir_id: '5', state: 'possible duplicate' }),
  R({ ir_id: '6', state: 'waiting on the owner' }),
  R({ ir_id: '7', state: 'owner paid in part' }),
  R({ ir_id: '8', state: 'vendor bill missing' }),
  R({ ir_id: '9', state: 'unknown' }),
  R({ ir_id: '10', state: 'vendor paid' }),
  R({ ir_id: '11', state: 'nothing to pay' }),
]);
ok(out.ready.length === 1 && out.ready[0].count === 2, 'only the two cleared bills are ready, grouped under one vendor');
ok(out.ready[0].total === 150.1 && out.grand_total === 150.1, 'vendor total and grand total equal the sum of the ready bills (balance used when present)');
const why = id => (out.not_ready.find(b => b.ir_id === id) || {}).reason || '';
ok(/funds not cleared until 2026-11-25/.test(why('3')), 'paid but not cleared -> not ready with the clear date');
ok(/date unavailable/.test(why('4')), 'unknown clearing -> not ready, check QuickBooks (never treated as cleared)');
ok(/possible duplicate/.test(why('5')), 'possible duplicate -> not ready');
ok(/customer has not paid/.test(why('6')), 'customer unpaid -> not ready');
ok(/only part/.test(why('7')), 'part-paid -> not ready');
ok(/bill missing/.test(why('8')), 'vendor bill missing -> not ready');
ok(/could not tell/.test(why('9')), 'unknown state -> not ready');
ok(!out.not_ready.some(b => ['10', '11'].includes(b.ir_id)) && out.not_ready_count === 7, 'paid / nothing-to-pay rows are not part of a pay run at all');

// to the cent, no float drift
out = payRunBuild([R({ vendor_cost: 0.1 }), R({ ir_id: '2', vendor_cost: 0.2 }), R({ ir_id: '3', vendor_id: 'V2', vendor_name: 'Zed', vendor_cost: 1000.07 })]);
ok(out.grand_total === 1000.37 && out.ready[0].vendor === 'Zed' && out.ready[1].total === 0.3, 'totals are exact to the cent; biggest vendor first');
ok(payRunBuild(null).ready.length === 0 && payRunBuild([]).grand_total === 0, 'empty / non-list input does not throw');

// payRunGet: a failed QuickBooks read is an ERROR, never an empty list; it writes nothing and logs
const getSrc = fn(wsrc, 'payRunGet', true);
ok(!/qbPayBills|\/qb\/pay-bills|BillPayment|sendSms|sendEmail|fetch\(|appendRow|writeTab|writeCells/.test(pure + getSrc), 'pay run code has no QuickBooks write, no send, no sheet write');
const mk = (qbPayables, logs) => new Function('qbPayables', 'logAndCollectError', 'json', 'payRunBuild', getSrc + '\nreturn payRunGet;')(qbPayables,
  async (env, sink, job, ep, ref, e) => { logs.push({ job, ref, msg: String(e.message) }); sink.push({ stage: job, error: String(e.message) }); },
  (d, s = 200) => ({ ok: s < 400, status: s, json: async () => d }), payRunBuild);
let logs = [];
let r = await (await mk(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'QuickBooks refused' }) }), logs)({}, new URL('https://x/qb/pay-run'))).json();
ok(r.ok === false && /QuickBooks refused/.test(r.error) && !('ready' in r) && logs.length === 1, 'payables error -> ok:false + error text + one telemetry log, no empty ready list');
logs = [];
r = await (await mk(async () => { throw new Error('network down'); }, logs)({}, new URL('https://x/qb/pay-run'))).json();
ok(r.ok === false && /network down/.test(r.error) && logs.length === 1, 'payables throws -> ok:false, logged');
logs = [];
r = await (await mk(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, as_of: '2026-11-23', warnings: [{ stage: 'w' }], rows: [R({})] }) }), logs)({}, new URL('https://x/qb/pay-run'))).json();
ok(r.ok === true && r.grand_total === 100 && r.as_of === '2026-11-23' && r.warnings.length === 1 && logs.length === 0, 'success: ready list, as_of and warnings carried through');
logs = [];
r = await (await mk(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rows: 'nope' }) }), logs)({}, new URL('https://x/qb/pay-run'))).json();
ok(r.ok === false, 'a non-list rows answer is an error');

// route: admin-only (not public, not in any role scope, not writable by the broker token)
ok(/if \(path === '\/qb\/pay-run'\)\s+return await payRunGet\(env, url\)/.test(wsrc), 'GET /qb/pay-run is routed next to /qb/payables');
const notIn = name => { const i = wsrc.indexOf(name + ' = '); return i < 0 ? true : !braced(wsrc, i).includes('/qb/pay-run'); };
ok(['PUBLIC_PATHS', 'ROLE_SCOPES', 'HUB_PROD_WRITE_PATHS'].every(notIn) && !/'\/qb\/pay-run'/.test(wsrc.slice(wsrc.indexOf('HUB_PROD_WRITE_PATHS'), wsrc.indexOf('HUB_PROD_WRITE_PATHS') + 3000)), '/qb/pay-run is not public, role-scoped or broker-writable');
ok(!/\/qb\/pay-run/.test(wsrc.slice(wsrc.indexOf("name: 'pay_run"), wsrc.indexOf("name: 'pay_run") + 10) || ''), 'no scheduler job in this slice (the Monday email is the remaining piece of Phase 1)');

// page: renderPayRun escapes, links the bill, shows both lists; error path says so
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ui = new Function('esc', 'safeArray', 'qbBillLink', [fn(isrc, 'payRunMoney'), fn(isrc, 'renderPayRun')].join('\n') + '\nreturn { renderPayRun, payRunMoney };')(esc, v => Array.isArray(v) ? v : [], id => 'https://qb/' + id);
const host = { innerHTML: '' };
ui.renderPayRun(host, { ok: true, as_of: '2026-11-23', grand_total: 1234.5, ready_count: 1, warnings: [],
  ready: [{ vendor: '<b>Acme</b>', total: 1234.5, count: 1, bills: [{ wo_id: 'WO-1', ir_id: '1', amount: 1234.5, bill_id: 'B1', customer_clears_on: '2026-11-20' }] }],
  not_ready: [{ vendor: 'Zed', wo_id: 'WO-2', amount: 5, reason: 'customer has not paid' }] });
ok(host.innerHTML.includes('$1,234.50') && host.innerHTML.includes('https://qb/B1') && host.innerHTML.includes('Not ready (1)') && host.innerHTML.includes('customer has not paid'), 'panel shows total, QB link and the not-ready reason');
ok(!host.innerHTML.includes('<b>Acme</b>') && host.innerHTML.includes('&lt;b&gt;Acme'), 'vendor name is escaped');
ui.renderPayRun(host, { ok: true, grand_total: 0, ready_count: 0, ready: [], not_ready: [], warnings: [] });
ok(host.innerHTML.includes('Nothing is ready to pay this week.'), 'true empty says so');
const load = fn(isrc, 'loadPayRun');
ok(/Could not check QuickBooks for the pay run/.test(load) && /res\.ok !== true/.test(load) && /Try again/.test(load) && !/\.catch\(function\(\) *\{\}\)/.test(load), 'loadPayRun shows a failure with Try again and never swallows it');
ok(!/api\('POST'/.test(load + fn(isrc, 'renderPayRun')), 'the panel only reads (no POST)');
console.log(`pay-run: ${pass} passed, ${fail} failed`);
