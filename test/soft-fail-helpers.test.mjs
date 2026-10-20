// Fault-injection tests for the Phase C "never swallow" helpers (Oct 20 2026): softNote, failFlushPending, softFail, parseJsonCell, fetchTabSoft, safeJson, tryWrite.
// Extracts the REAL functions from worker.js and forces each failure.  Run: node test/soft-fail-helpers.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function grab(name, kind = 'function') {
  const sig = (kind === 'async' ? 'async function ' : 'function ') + name + '(';
  const start = src.indexOf(sig); if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = .*;$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };
let APPENDS, SHEETS_FAIL, REPORTS, TAB_FAIL, REPORT_OK;
const sheetsRequest = async (env, method, path, body) => { if (SHEETS_FAIL) throw new Error('Sheets 429 quota'); APPENDS.push({ path, body }); return {}; };
const reportFailure = async (env, f) => { REPORTS.push(f); return { ok: REPORT_OK, id: 'x' }; };
const fetchTab = async (env, tab) => { if (TAB_FAIL) throw new Error('Sheets read failed for ' + tab); return [{ ID: '1' }]; };
const failEnsureTabs = async () => {};
const failSeverity = (where, message, sev) => sev || 'P2';
const failTrim = (s, n) => String(s).slice(0, n);
const pieces = [constLine('FAIL_EVENTS_TAB'), constLine('FAIL_EVENT_COLS'), constLine('FAIL_PENDING_MAX'), 'const _failPending = [];', grab('failBuildEvent'), grab('softNote'), grab('failFlushPending', 'async'), grab('softFail', 'async'),
  grab('parseJsonCell'), grab('fetchTabSoft', 'async'), grab('safeJson', 'async'), grab('tryWrite', 'async')].join('\n');
const W = new Function('sheetsRequest', 'reportFailure', 'fetchTab', 'failEnsureTabs', 'failSeverity', 'failTrim', pieces + '\nreturn { softNote, failFlushPending, softFail, parseJsonCell, fetchTabSoft, safeJson, tryWrite, pending: _failPending };')(sheetsRequest, reportFailure, fetchTab, failEnsureTabs, failSeverity, failTrim);
const reset = () => { APPENDS = []; SHEETS_FAIL = false; REPORTS = []; TAB_FAIL = false; REPORT_OK = true; W.pending.length = 0; };
console.error = () => {};
const env = {};

console.log('parseJsonCell');
reset();
ok(JSON.stringify(W.parseJsonCell('[1,2]', [], 'x')) === '[1,2]' && W.pending.length === 0, 'valid JSON is parsed, nothing noted');
ok(JSON.stringify(W.parseJsonCell('', [], 'x')) === '[]' && JSON.stringify(W.parseJsonCell(undefined, {}, 'x')) === '{}' && JSON.stringify(W.parseJsonCell('  ', 5, 'x')) === '5' && W.pending.length === 0, 'an empty cell is a legitimate empty value: fallback, nothing noted');
ok(JSON.stringify(W.parseJsonCell('{not json', [], 'Selections_JSON')) === '[]' && W.pending.length === 1 && W.pending[0].Where === 'json_cell_corrupt:Selections_JSON' && W.pending[0].Severity === 'P2', 'a corrupt cell returns the fallback AND queues a P2 naming the cell');
W.parseJsonCell('{not json', [], 'Selections_JSON'); ok(W.pending.length === 1, 'the same corruption twice in one request is queued once');
ok(W.parseJsonCell({ a: 1 }, null, 'x').a === 1, 'an already-parsed object passes through');

console.log('\nsoftNote / failFlushPending');
reset(); W.softNote('w1', new Error('boom'), 'P1', { ref: 'WO-1' });
ok(W.pending.length === 1 && W.pending[0].Severity === 'P1' && /boom/.test(W.pending[0].Message) && /queued/.test(W.pending[0].Context), 'softNote queues a ledger event with the severity and context');
let fl = await W.failFlushPending(env);
ok(fl.ok && fl.flushed === 1 && APPENDS.length === 1 && W.pending.length === 0 && APPENDS[0].body.values[0][4] === 'w1', 'flush writes the queued event to Failure_Events and empties the queue');
reset(); W.softNote('w2', 'again'); SHEETS_FAIL = true; fl = await W.failFlushPending(env);
ok(!fl.ok && W.pending.length === 1, 'if the ledger cannot be written, the event stays queued for the next flush (not lost) and the failure is returned');
fl = await W.failFlushPending(env); ok(!fl.ok && /backing off/.test(fl.error || ''), 'right after a failed flush the next one backs off (no extra failing appends per request during an outage)');
W.failFlushPending._until = 0; SHEETS_FAIL = false; fl = await W.failFlushPending(env); ok(fl.ok && W.pending.length === 0, '...and once the back-off passes the next flush writes it');
reset(); W.softNote._seen = new Map(); W.softNote('persist', 'same cell'); W.pending.length = 0; W.softNote('persist', 'same cell');
ok(W.pending.length === 0, 'a persistently bad cell is queued once per 10 minutes, not on every request');
W.softNote._seen = new Map(); W.softNote('persist', 'a different message'); ok(W.pending.length === 1, '...but a different problem still goes through');
reset(); for (let i = 0; i < 80; i++) W.softNote('flood' + i, 'm' + i);
ok(W.pending.length === 50, 'the queue is capped (a storm cannot grow memory without bound)');
ok(W.softNote(undefined, undefined) !== undefined && true, 'softNote with garbage arguments does not throw');

console.log('\nsoftFail / tryWrite');
reset(); const sf = await W.softFail(env, 'ensure_columns', new Error('quota'), 'P1');
ok(sf.ok === false && /quota/.test(sf.error) && REPORTS.length === 1 && REPORTS[0].where === 'ensure_columns' && REPORTS[0].severity === 'P1', 'softFail writes to the ledger now and tells the caller it failed');
reset(); REPORT_OK = false; const sf2 = await W.softFail(env, 'x', 'plain string'); ok(sf2.ok === false && sf2.reported === false, 'if even the ledger write fails, the caller is told reported:false');
reset(); let tw = await W.tryWrite(env, 'update_wo', async () => { throw new Error('Sheets 503'); });
ok(tw.ok === false && REPORTS[0].where === 'update_wo' && REPORTS[0].severity === 'P1', 'tryWrite: a failing write is reported (P1) and returned as ok:false, never swallowed');
tw = await W.tryWrite(env, 'update_wo', async () => 42); ok(tw.ok === true && tw.value === 42 && REPORTS.length === 1, 'tryWrite: success returns the value, reports nothing');

console.log('\nfetchTabSoft / safeJson');
reset(); TAB_FAIL = true; const rows = await W.fetchTabSoft(env, 'Vendors', 'vendor_list');
ok(Array.isArray(rows) && rows.length === 0 && REPORTS[0].where === 'tab_read_failed:vendor_list' && REPORTS[0].severity === 'P2', 'a failed tab read still returns [] for old callers but is reported');
TAB_FAIL = false; ok((await W.fetchTabSoft(env, 'Vendors', 'vendor_list')).length === 1 && REPORTS.length === 1, 'a healthy read is untouched');
reset(); const bad = { status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } };
const sj = await W.safeJson(bad, { fallback: true }, 'qb_create');
ok(sj.fallback === true && W.pending.length === 1 && W.pending[0].Where === 'response_not_json:qb_create', 'a non-JSON response body returns the fallback and is noted');
ok((await W.safeJson({ json: async () => ({ a: 1 }) }, null, 'x')).a === 1 && W.pending.length === 1, 'a good body passes through');

console.log('\nwiring');
ok(/_failPending\.length && ctx && typeof ctx\.waitUntil === 'function'\) ctx\.waitUntil\(failFlushPending\(env\)\)/.test(src), 'the request wrapper flushes queued failures after the response (waitUntil), so softNote works in sync code');

console.log(`\nsoft-fail-helpers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
