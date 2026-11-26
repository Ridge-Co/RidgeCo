// Offline tests for the Activity Log, Phase 1 (queue #283). Extracts the REAL functions from worker.js; fake Sheets / buffer below.
// Run: node test/activity-log.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
function body(name, kind) {                                  // kind: 'async function ' | 'function ' | 'class '
  const sig = (kind === 'class' ? 'export class ' : kind === 'async' ? 'async function ' : 'function ') + name;
  const start = src.indexOf(sig); if (start < 0) throw new Error(name + ' not found');
  let i = src.indexOf('{', src.indexOf(kind === 'class' ? name : ')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i).replace(/^export /, '');
}
const consts = (n) => { const m = new RegExp('^const ' + n + ' = .*$', 'm').exec(src); if (!m) throw new Error(n + ' const not found'); return m[0]; };
let LASTGET = '', TABS, FAILS, BUF, FAIL_APPEND, BIND = true, CFG = {}, ACKFAIL = false, NOLAND = false;
const stubObj = { fetch: async (u, o) => {
  const p = new URL(u).pathname;
  if (p === '/push') { BUF.push(JSON.parse(o.body)); return { ok: true, status: 200 }; }
  if (p === '/take') return { ok: true, status: 200, json: async () => ({ keys: BUF.map((r, i) => 'r:' + i), rows: BUF.slice(), dropped: 0 }) };
  if (p === '/ack') { if (ACKFAIL) return { ok: false, status: 500 }; const j = JSON.parse(o.body); BUF = BUF.filter((r, i) => !j.keys.includes('r:' + i)); return { ok: true, status: 200 }; }
  return { ok: false, status: 404 };
} };
const sheetsRequest = async (env, method, path, b) => {
  if (method === 'POST' && /:append/.test(path)) { if (FAIL_APPEND) throw new Error('Sheets 500'); const first = TABS.Activity_Log.length + 1; if (!NOLAND) TABS.Activity_Log.push(...b.values.map(v => v.slice())); LASTGET = ''; return { updates: { updatedRange: 'Activity_Log!A' + first + ':Q' + (first + b.values.length - 1), updatedRows: b.values.length } }; }
  if (method === 'GET') { LASTGET = path; const m = /A(\d+)%3AQ(\d+)$|A(\d+):Q(\d+)$/.exec(path); if (!m) return { values: TABS.Activity_Log.map(r => r.slice()) }; const a = +(m[1] || m[3]), z = +(m[2] || m[4]); return { values: TABS.Activity_Log.slice(a - 1, z).map(r => r.slice()) }; }
  throw new Error('unhandled ' + method + ' ' + path);
};
const ensureTab = async () => {}, ensureColumns = async () => {};
const fetchConfig = async () => CFG;
const reportFailure = async (env, f) => { FAILS.push(f); return { ok: true }; };
const prog = [consts('ACTIVITY_TAB'), consts('ACTIVITY_COLS'), 'const ACTIVITY_BUFFER_CAP = 5000;', 'const ACTIVITY_TAKE = 200;', 'const __actReq = new WeakMap();', "const __act = { faults: 0, lastFaultAt: 0, lastFault: '', pushes: 0 };", consts('ACTIVITY_ACTIONS'), consts('ACTIVITY_SKIP_EXACT'), consts('ACTIVITY_ID_KEYS'),
  body('__actEq'), body('activityViaFromToken'), body('activityNormalizePath'), body('activityLooksLikeId'), body('activityEntityFrom'), body('activityRowFor'), body('__activityFault', 'async'), body('__activityStub'), body('activityBufferPush', 'async'), body('schedRunActivityFlush', 'async')].join('\n');
const mk = new Function('sheetsRequest', 'ensureTab', 'ensureColumns', 'fetchConfig', 'reportFailure', 'console', prog + '\nreturn { activityRowFor, activityViaFromToken, activityEntityFrom, activityNormalizePath, activityBufferPush, schedRunActivityFlush, __actReq, __act, ACTIVITY_COLS };');
const A = mk(sheetsRequest, ensureTab, ensureColumns, fetchConfig, reportFailure, { error() {} });
const envWith = () => ({ WORKER_SECRET: 'S3CRET-ADMIN', HUB_PROD_WRITE_TOKEN: 'W-TOKEN-1', HUB_PROD_RO_TOKEN: 'R-TOKEN-2', HUB_TEST_TOKEN: 'T-TOKEN-3', ACTIVITY_BUFFER: BIND ? { idFromName: () => 'x', get: () => stubObj } : undefined });
const reset = () => { A.__act.lastFaultAt = 0; TABS = { Activity_Log: [A.ACTIVITY_COLS.slice()] }; FAILS = []; BUF = []; FAIL_APPEND = false; BIND = true; CFG = {}; ACKFAIL = false; NOLAND = false; };

console.log('\nwhich requests count');
reset();
const base = { path: '/status', status: 200, now: 1e12 };
ok(A.activityRowFor({ ...base, method: 'GET' }) === null, 'GET is never recorded');
ok(A.activityRowFor({ ...base, method: 'OPTIONS' }) === null, 'OPTIONS is never recorded');
ok(A.activityRowFor({ ...base, method: 'POST', path: '/failure/report' }) === null, 'failure reports are not recorded (no loops)');
ok(A.activityRowFor({ ...base, method: 'POST', path: '/cron/sweep' }) === null, '/cron internals other than /cron/run are skipped');
ok(A.activityRowFor({ ...base, method: 'POST', via: 'admin' }) !== null, 'a POST by the admin is recorded');

console.log('\nwho, source, outcome');
let r = A.activityRowFor({ ...base, method: 'POST', via: 'admin', bodyKeys: ['wo_id', 'status'], entity: { type: 'work_order', id: 'WO-9' } });
ok(r.Actor_Role === 'brett' && r.Source === 'hub_ui' && r.Action === 'wo_status_change' && r.Entity_ID === 'WO-9' && r.Outcome === 'ok', 'admin status change -> brett / hub_ui / wo_status_change / WO-9 / ok');
ok(r.Fields_Changed === 'wo_id|status', 'field NAMES only');
r = A.activityRowFor({ ...base, method: 'POST', role: 'vendor', id: 'V-12' });
ok(r.Actor_Role === 'vendor' && r.Actor_ID === 'V-12' && r.Source === 'portal', 'vendor session -> vendor / V-12 / portal');
r = A.activityRowFor({ ...base, method: 'POST', via: 'prod_write', path: '/ops-queue-stage' });
ok(r.Actor_Role === 'prod_write' && r.Source === 'claude_session' && r.Action === 'queue_stage', 'narrow broker token -> claude_session');
r = A.activityRowFor({ ...base, method: 'POST', via: 'admin', path: '/cron/run' });
ok(r.Actor_Role === 'scheduler' && r.Source === 'scheduler' && r.Actor_Role !== 'brett', 'A4: /cron/run is never brett');
r = A.activityRowFor({ ...base, method: 'POST', status: 401 });
ok(r.Outcome === 'refused' && r.Actor_Role === '' && r.Source === 'unauthenticated', '401 -> refused, no actor');
ok(A.activityRowFor({ ...base, method: 'POST', status: 403, via: 'admin' }).Outcome === 'refused', '403 -> refused');
ok(A.activityRowFor({ ...base, method: 'POST', status: 404, via: 'admin' }).Outcome === 'refused', '404 -> refused');
ok(A.activityRowFor({ ...base, method: 'POST', status: 500, via: 'admin' }).Outcome === 'error', '500 -> error');
r = A.activityRowFor({ ...base, method: 'POST', via: 'admin', path: '/some/new/route/WO-1234' });
ok(r.Action === 'post:/some/new/route/:id', 'unknown route keeps a readable name, ID folded to :id (' + r.Action + ')');

console.log('\ntoken labels');
const e = envWith();
ok(A.activityViaFromToken(e, 'S3CRET-ADMIN') === 'admin', 'admin secret -> admin');
ok(A.activityViaFromToken(e, 'W-TOKEN-1') === 'prod_write' && A.activityViaFromToken(e, 'R-TOKEN-2') === 'prod_ro' && A.activityViaFromToken(e, 'T-TOKEN-3') === 'hub_test', 'narrow tokens are told apart from Brett');
ok(A.activityViaFromToken(e, 'nope') === '' && A.activityViaFromToken(e, '') === '' && A.activityViaFromToken({}, 'x') === '', 'unknown / empty token -> no label');

console.log('\nA5 no values leak');
const SENT = ['SENTINEL-PIN-4821', 'tenant@example.com', '410-555-0199', 'Jane Q Tenant', 'Please call me back about the leak'];
const ent = A.activityEntityFrom({ tenant_id: 'T-7', message: SENT[4], phone: SENT[2], email: SENT[1], name: SENT[3], pin: SENT[0] }, new URLSearchParams(''));
r = A.activityRowFor({ ...base, method: 'POST', via: 'admin', bodyKeys: ['tenant_id', 'message', 'phone', 'email', 'name', 'pin', 'bad key with spaces; DROP'], entity: ent });
const dump = JSON.stringify(r);
ok(SENT.every(s => !dump.includes(s)), 'none of the sentinel values (pin, email, phone, name, message) appear in the row');
ok(ent.id === 'T-7' && ent.type === 'tenant', 'entity is the id only');
ok(!r.Fields_Changed.includes('bad key'), 'odd key names are dropped');
ok(A.activityEntityFrom({ id: 'a@b.com' }, null).id === '' && A.activityEntityFrom({ id: '4105550199' }, null).id === '', 'an email or a phone number is never taken as an id');
ok(A.activityEntityFrom({}, new URLSearchParams('wo_id=WO-5')).id === 'WO-5', 'entity from the URL query');

console.log('\nflush: lands, reads back, then clears');
reset();
const env = envWith();
for (let i = 0; i < 3; i++) await A.activityBufferPush(env, A.activityRowFor({ ...base, method: 'POST', via: 'admin', entity: { type: 'work_order', id: 'WO-' + i } }));
ok(BUF.length === 3, '3 events buffered');
let fr = await A.schedRunActivityFlush(env);
ok(fr.ok && fr.detail.flushed === 3 && TABS.Activity_Log.length === 4 && BUF.length === 0, 'A7: 3 rows in the tab, buffer cleared');
ok(/Activity_Log!A2/.test(decodeURIComponent(LASTGET)) || LASTGET === '', 'read-back asked for just the new rows, not the whole tab');
ok(TABS.Activity_Log.slice(1).every(row => /^ACT-/.test(row[0]) && row[A.ACTIVITY_COLS.indexOf('Action')] === 'wo_status_change'), 'each row has an ID and its action');

console.log('\nflush failure keeps rows, files P2, next run lands them');
reset(); const env2 = envWith();
await A.activityBufferPush(env2, A.activityRowFor({ ...base, method: 'POST', via: 'admin' }));
FAIL_APPEND = true;
fr = await A.schedRunActivityFlush(env2);
ok(fr.ok === false && BUF.length === 1 && FAILS.length === 1 && FAILS[0].severity === 'P2', 'failed append: not ok, row kept, one P2 filed');
FAIL_APPEND = false;
fr = await A.schedRunActivityFlush(env2);
ok(fr.ok && BUF.length === 0 && TABS.Activity_Log.length === 2, 'next good flush lands the retained row');

console.log('\nread-back guards a silent "success"');
reset(); const env3 = envWith();
await A.activityBufferPush(env3, A.activityRowFor({ ...base, method: 'POST', via: 'admin' }));
NOLAND = true;
fr = await A.schedRunActivityFlush(env3);
ok(fr.ok === false && BUF.length === 1 && /did not land/.test(JSON.stringify(fr.errors)), 'append said ok but nothing landed: rows kept, error reported');

console.log('\nbuffer will not clear');
reset(); const env4 = envWith();
await A.activityBufferPush(env4, A.activityRowFor({ ...base, method: 'POST', via: 'admin' }));
ACKFAIL = true;
fr = await A.schedRunActivityFlush(env4);
ok(fr.ok === false && /may be written twice/.test(JSON.stringify(fr.errors)), 'rows landed but ack failed: reported loudly');

console.log('\nA8 missing binding');
reset(); BIND = false; const env5 = envWith();
await A.activityBufferPush(env5, A.activityRowFor({ ...base, method: 'POST', via: 'admin' }));
ok(FAILS.length === 0, 'push without binding: no throw and no failure-ledger write from a request');
fr = await A.schedRunActivityFlush(env5);
ok(fr.ok === false && /not bound/.test(JSON.stringify(fr.errors)) && FAILS.length === 1 && FAILS[0].severity === 'P2', 'flush without binding reports it and files one P2');
fr = await A.schedRunActivityFlush(env5);
ok(FAILS.length === 1, 'a second flush inside 30 minutes does not file another');

console.log('\nkill switch');
reset(); CFG = { activity_log_enabled: 'FALSE' }; const env6 = envWith();
await A.activityBufferPush(env6, A.activityRowFor({ ...base, method: 'POST', via: 'admin' }));
fr = await A.schedRunActivityFlush(env6);
ok(fr.detail.kill_switch === true && TABS.Activity_Log.length === 1 && BUF.length === 0, 'activity_log_enabled=FALSE: nothing written, buffer emptied, result says so');

console.log('\nActivityBuffer (the Durable Object): cap, take without delete, ack');
{
  const store = new Map();
  const storage = { get: async k => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async ks => { for (const k of [].concat(ks)) store.delete(k); },
    list: async ({ prefix, limit }) => { const out = new Map(); for (const k of [...store.keys()].sort()) if (k.startsWith(prefix)) { out.set(k, store.get(k)); if (limit && out.size >= limit) break; } return out; } };
  const DOcls = new Function('ACTIVITY_BUFFER_CAP', 'ACTIVITY_TAKE', 'Response', 'URL', 'safeJson', body('ActivityBuffer', 'class') + '\nreturn ActivityBuffer;')(5, 200, Response, URL, async (rq) => { try { return { ok: true, body: await rq.json() }; } catch (e) { return { ok: false, body: {} }; } });
  const d = new DOcls({ storage }, {});
  const call = (m, path, b) => d.fetch(new Request('https://activity.internal' + path, { method: m, body: b ? JSON.stringify(b) : undefined }));
  for (let i = 0; i < 8; i++) await call('POST', '/push', { n: i });
  let t = await (await call('GET', '/take?limit=200')).json();
  ok(t.rows.length === 5 && t.rows[0].n === 3 && t.dropped === 3, 'cap 5: oldest 3 dropped and counted (rows ' + t.rows.map(r => r.n).join(',') + ', dropped ' + t.dropped + ')');
  t = await (await call('GET', '/take?limit=2')).json();
  ok(t.rows.length === 2, 'take honours the limit');
  await call('GET', '/take?limit=200');
  ok((await (await call('GET', '/take?limit=200')).json()).rows.length === 5, 'take does not delete');
  await call('POST', '/ack', { keys: t.keys, reset_dropped: true });
  const t2 = await (await call('GET', '/take?limit=200')).json();
  ok(t2.rows.length === 3 && t2.dropped === 0, 'ack deletes exactly those keys and resets the dropped counter');
  ok((await call('POST', '/ack', { keys: ['meta:seq'] }).then(() => store.has('meta:seq'))), 'ack cannot delete the meta keys');
  ok((await call('GET', '/nope')).status === 404, 'unknown path -> 404');
}

console.log('\nwiring in worker.js (source checks)');
ok(/\{ name: 'activity_flush',\s+kind: 'interval'/.test(src), 'job registered in SCHED_JOBS');
const gs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script/hub-scheduler/HubScheduler.gs'), 'utf8');
ok(/name: 'activity_flush',\s+run: 'hub'/.test(gs), 'matching row in the Apps Script JOBS table');
const toml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.toml'), 'utf8');
ok(/name = "ACTIVITY_BUFFER"/.test(toml) && /tag = "v2"\s*\nnew_sqlite_classes = \["ActivityBuffer"\]/.test(toml) && /tag = "v1"\s*\nnew_sqlite_classes = \["ReadMeterStore"\]/.test(toml), 'wrangler: binding + migration v2 added, v1 untouched');
ok(/^crons = \[\]/m.test(toml), 'crons stays empty');
const wrapper = src.slice(src.indexOf('export default {'), src.indexOf('export default {') + 3500);
ok(/ctx\.waitUntil\(activityBufferPush\(env, _row\)\)/.test(wrapper) && !/await activityBufferPush/.test(wrapper) && !/res\.(clone|text|json)\(/.test(wrapper.slice(0, wrapper.indexOf('async scheduled'))), 'hook runs in waitUntil and never reads the response body');
ok(/export class ActivityBuffer/.test(src), 'ActivityBuffer is exported (Cloudflare needs it)');
const gate = src.slice(src.indexOf('const PUBLIC_PATHS'), src.indexOf('const PUBLIC_PATHS') + 200);
ok(!/Activity_Log|activity/i.test(gate), 'PUBLIC_PATHS untouched');
ok(!/Activity_Log/.test(src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('const ROLE_SCOPES') + 6000)), 'Activity_Log is in no ROLE_SCOPES entry');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
