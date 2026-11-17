// Offline tests for the soft-failure helpers (silent-failure burn-down, Phase 0, Nov 17 2026).
// Extracts the REAL code between SOFT-FAILURE-HELPERS-BEGIN/END out of worker.js and runs it with a fake reportFailure and fetchTab,
// so the test cannot drift from what ships. Run: node test/soft-failure-helpers.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const bi = src.indexOf('// ═══ SOFT-FAILURE-HELPERS-BEGIN'), be = src.indexOf('// ═══ SOFT-FAILURE-HELPERS-END');
if (bi < 0 || be < bi) throw new Error('soft-failure block markers missing');
const block = src.slice(bi, be);

// ── fake world ──
let REPORTED, REPORT_THROWS, FETCH_CALLS, FETCH_ERR, FETCH_ROWS;
const reportFailure = async (env, f) => { if (REPORT_THROWS) throw new Error('ledger down'); REPORTED.push(f); return { ok: true, id: 'X' }; };
const fetchTab = async (env, tab, opts) => { FETCH_CALLS.push({ tab, opts }); if (FETCH_ERR) throw FETCH_ERR; return FETCH_ROWS; };
const H = new Function('reportFailure', 'fetchTab', block + '\nreturn { softSeenOnce, softItem, softReport, softFail, softNote, softFlush, fetchTabSoft, parseJsonCell, tryWrite, safeJson };')(reportFailure, fetchTab);
const reset = () => { REPORTED = []; REPORT_THROWS = false; FETCH_CALLS = []; FETCH_ERR = null; FETCH_ROWS = [{ ID: '1' }]; };
const req = () => ({});

console.log('softFail');
reset();
{
  const r = await H.softFail('env', 'where.a', new Error('boom'), { severity: 'P0', ref: 'R1' });
  ok(r.ok === false && r.error === 'boom' && r.reported === true, 'failure returns ok:false with the message and reports');
  ok(REPORTED.length === 1 && REPORTED[0].where === 'where.a' && REPORTED[0].severity === 'P0' && REPORTED[0].ref === 'R1', 'report carries where, severity and ref');
}
reset();
{
  const q = req();
  for (let i = 0; i < 10; i++) await H.softFail('env', 'same.where', new Error('x' + i), { req: q });
  ok(REPORTED.length === 1, '10 failures in one request at the same where make ONE report');
  await H.softFail('env', 'other.where', new Error('y'), { req: q });
  ok(REPORTED.length === 2, 'a different where in the same request is reported too');
  const q2 = req();
  await H.softFail('env', 'same.where', new Error('z'), { req: q2 });
  ok(REPORTED.length === 3, 'a new request reports the same where again');
}
reset();
{
  REPORT_THROWS = true;
  let threw = false, r;
  try { r = await H.softFail('env', 'w', new Error('e')); } catch (e) { threw = true; }
  ok(!threw && r.ok === false, 'reportFailure throwing never escapes softFail');
}

console.log('softNote and softFlush');
reset();
{
  const q = req();
  H.softNote('env', 'cfg.missing', 'Config key missing', { req: q });
  ok(REPORTED.length === 0, 'softNote with a req only queues (nothing sent yet)');
  H.softNote('env', 'cfg.missing', 'Config key missing again', { req: q });
  const n = await H.softFlush('env', q);
  ok(n === 1 && REPORTED.length === 1 && REPORTED[0].severity === 'P2', 'softFlush sends the queued note once (deduped per where, default P2)');
  ok((await H.softFlush('env', q)) === 0, 'a second flush sends nothing');
}
reset();
{
  H.softNote('env', 'no.req', 'no request object');
  await new Promise(r => setTimeout(r, 0));
  ok(REPORTED.length === 1, 'softNote with no req reports immediately');
}

console.log('fetchTabSoft');
reset();
{
  const r = await H.fetchTabSoft('env', 'Vendor_Bills', { where: 'buildDigest.bills', req: req(), severity: 'P1' });
  ok(r.error === null && r.rows.length === 1, 'success returns the rows and no error');
  ok(REPORTED.length === 0, 'success reports nothing');
  ok(FETCH_CALLS.length === 1, 'fetchTabSoft makes exactly one fetchTab call (no extra Sheets read)');
}
reset();
{
  FETCH_ERR = new Error('Sheets 503');
  const q = req();
  const a = await H.fetchTabSoft('env', 'Vendor_Bills', { where: 'digest.bills', req: q });
  const b = await H.fetchTabSoft('env', 'Vendor_Bills', { where: 'digest.bills', req: q });
  ok(a.rows.length === 0 && a.error === 'Sheets 503', 'failed read gives rows [] and the error, not a silent empty list');
  ok(b.rows.length === 0 && REPORTED.length === 1 && REPORTED[0].severity === 'P2', 'two failed reads in one request report once, at P2 by default');
  ok(FETCH_CALLS.length === 2, 'each failed read still tries the read once (no retry storm)');
}

console.log('parseJsonCell');
reset();
{
  const q = req();
  ok(H.parseJsonCell('', { d: 1 }, { env: 'env', where: 'lines', req: q }) && REPORTED.length === 0, 'blank cell gives the fallback and reports nothing');
  ok(H.parseJsonCell(undefined, 'fb', { req: q }) === 'fb', 'undefined cell gives the fallback');
  ok(H.parseJsonCell('[1,2]', 'fb', { req: q }).length === 2, 'valid JSON is parsed');
  const v = H.parseJsonCell('{bad json', 'fb', { env: 'env', where: 'lines', ref: 'Bill.Lines', req: q });
  ok(v === 'fb', 'corrupt cell gives the fallback');
  ok(REPORTED.length === 0, 'corrupt cell is queued, not sent, until flush');
  await H.softFlush('env', q);
  ok(REPORTED.length === 1 && REPORTED[0].ref === 'Bill.Lines', 'corrupt cell is reported once on flush');
  H.parseJsonCell('{bad', 'fb', { env: 'env', where: 'lines', ref: 'Bill.Lines', req: q });
  await H.softFlush('env', q);
  ok(REPORTED.length === 1, 'the same corrupt cell twice in one request is reported once');
}

console.log('tryWrite');
reset();
{
  const ok1 = await H.tryWrite('env', async () => 42, { where: 'w.ok' });
  ok(ok1.ok === true && ok1.value === 42 && ok1.error === null && REPORTED.length === 0, 'successful write returns ok:true and reports nothing');
  const bad = await H.tryWrite('env', async () => { throw new Error('row locked'); }, { where: 'w.bad', ref: 'WO-1' });
  ok(bad.ok === false && bad.error === 'row locked', 'failed write returns ok:false with the error');
  ok(REPORTED.length === 1 && REPORTED[0].severity === 'P1' && REPORTED[0].ref === 'WO-1', 'failed write is reported at P1 by default');
}

console.log('safeJson');
{
  const good = await H.safeJson({ json: async () => ({ a: 1 }) });
  ok(good.ok === true && good.body.a === 1 && good.error === null, 'valid body returns ok:true and the body');
  const bad = await H.safeJson({ json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  ok(bad.ok === false && bad.body && Object.keys(bad.body).length === 0, 'empty or bad body returns ok:false and body {}');
  ok(bad.error.includes('Unexpected end'), 'bad body carries the error text');
}
reset();
{
  await H.safeJson({ json: async () => { throw new SyntaxError('bad'); } }, { env: 'env', where: 'req.body', req: req() });
  ok(REPORTED.length === 1 && REPORTED[0].where === 'req.body', 'bad body is reported when where and env are given');
  await H.safeJson({ json: async () => { throw new SyntaxError('bad'); } });
  ok(REPORTED.length === 1, 'bad body is NOT reported without where and env');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
