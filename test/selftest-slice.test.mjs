// Daily self-test, run in slices (Oct 14 2026). The old one-shot run was cut off by the scheduler on EVERY tick, never wrote its
// result, and starved the jobs queued behind it. These tests pin: it resumes across ticks, finishes exactly once, defers the
// golden checks when there is no time, and NOTHING fails silently (progress/record/deliver/telemetry failures are surfaced).
// Run: node test/selftest-slice.test.mjs   (SRC=path/to/worker.js to test another copy)
import fs from 'fs';
const src = fs.readFileSync(process.env.SRC || new URL('../worker.js', import.meta.url), 'utf8');
function grab(name, isAsync) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return (isAsync ? 'async ' : '') + src.slice(i, j + 1);
}
const make = new Function('stubs',
  'const { selftestDeliverDigest, selftestRecordResult, logTelemetry, SELFTEST_ENDPOINT_CHECKS } = stubs;\n' +
  'const SELFTEST_SLICE_MS = 30 * 1000, SELFTEST_GOLDEN_MARGIN_MS = 12 * 1000;\n' +
  grab('schedErrText') + '\n' + grab('selftestAggregateResults') + '\n' + grab('selftestComposeDigest') + '\n' +
  grab('selftestFinish', true) + '\n' + grab('selftestRunSlice', true) + '\n' +
  'return { selftestRunSlice, selftestFinish };');

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const CHECKS = Array.from({ length: 10 }, (_, i) => ({ name: 'c' + i, path: '/c' + i }));
function rig(over) {
  over = over || {};
  const log = { delivered: 0, recorded: 0, telemetry: [], writes: [] };
  const stubs = {
    SELFTEST_ENDPOINT_CHECKS: CHECKS,
    selftestDeliverDigest: async () => { log.delivered++; if (over.deliverThrows) throw new Error('gmail down'); return { delivered: true }; },
    selftestRecordResult: async () => { log.recorded++; if (over.recordThrows) throw new Error('no Selftest_Results tab'); return true; },
    logTelemetry: async (_e, row) => { log.telemetry.push(row); if (over.telemetryThrows) throw new Error('telemetry down'); },
  };
  const S = make(stubs);
  let stored = over.initial || null, clock = 0;
  const progress = {
    read: async () => stored ? JSON.parse(stored) : null,
    write: async (p) => { if (over.writeThrows && over.writeThrows(p)) throw new Error('progress write failed'); stored = JSON.stringify(p); log.writes.push(p); },
  };
  const opts = (extra) => Object.assign({
    checks: CHECKS, progress, now: () => clock,
    runOne: async (c) => { clock += over.perCheckMs || 10000; return { name: c.name, path: c.path, status: 200, ok: over.failName !== c.name, reason: 'r' }; },
    golden: async () => { clock += 3000; return [{ name: 'g1', ok: true, reason: 'fine' }]; },
  }, extra || {});
  return { S, log, opts, tick: (extra) => { clock = 0; return S.selftestRunSlice({}, '2026-10-14', opts(extra)); }, stored: () => stored && JSON.parse(stored) };
}

// 10 checks at 10 s each, 30 s slice -> 3 per tick: ticks 1-3 partial (3,6,9), tick 4 does the last + golden + finishes
{
  const r = rig();
  const a = await r.tick(), b = await r.tick(), c = await r.tick();
  t('tick1 partial 3/10', a.partial === true && /^3\/10/.test(a.progress) && r.log.recorded === 0);
  t('tick2 partial 6/10', b.partial === true && /^6\/10/.test(b.progress));
  t('tick3 partial 9/10', c.partial === true && /^9\/10/.test(c.progress));
  t('progress persisted', r.stored().endpoint.length === 9 && r.stored().complete === false);
  const d = await r.tick();
  t('tick4 finishes', d.ok === true && d.total === 11 && d.passed === 11 && d.failed === 0 && d.errors.length === 0 && d.logged === true);
  t('digest + history + telemetry exactly once', r.log.delivered === 1 && r.log.recorded === 1 && r.log.telemetry.length === 1 && r.log.telemetry[0].Success === 'TRUE');
  t('marked complete', r.stored().complete === true && r.stored().summary.total === 11);
  const e = await r.tick();
  t('tick5 skipped, nothing re-sent', e.skipped === true && r.log.delivered === 1 && r.log.recorded === 1);
}

// a new ET day restarts from zero
{
  const r = rig({ initial: JSON.stringify({ date: '2026-10-13', endpoint: CHECKS.map(c => ({ name: c.name, ok: true })), golden: [], complete: true }) });
  const a = await r.tick();
  t('stale-day progress ignored, restarts', a.partial === true && /^3\/10/.test(a.progress));
}

// golden checks deferred when too little of the slice is left (all endpoint checks done at 28 s of 30 s)
{
  const r = rig({ perCheckMs: 10000, initial: JSON.stringify({ date: '2026-10-14', endpoint: CHECKS.slice(0, 7).map(c => ({ name: c.name, ok: true, reason: 'r' })), golden: null, complete: false }) });
  const a = await r.tick({ sliceMs: 30000 });   // 3 checks -> 30 s used, 0 left
  t('golden deferred', a.partial === true && /golden checks run on the next tick/.test(a.progress) && r.log.recorded === 0);
  t('endpoint results saved before deferral', r.stored().endpoint.length === 10 && r.stored().golden === null);
  const b = await r.tick();
  t('next tick runs golden and finishes', b.ok === true && b.total === 11 && r.log.recorded === 1);
}

// failures in the checks are counted, not hidden
{
  const r = rig({ failName: 'c4' });
  let res; for (let i = 0; i < 4; i++) res = await r.tick();
  t('a failing check is reported', res.failed === 1 && res.failures.length === 1 && r.log.telemetry[0].Success === 'FALSE');
}

// NOTHING FAILS SILENTLY
{
  const r = rig({ writeThrows: () => true });
  let threw = null; try { await r.tick(); } catch (e) { threw = e; }
  t('partial-progress write failure THROWS (job shows failed)', threw && /progress write failed/.test(threw.message));
}
{
  const r = rig({ writeThrows: (p) => p.complete === true });
  let res; for (let i = 0; i < 4; i++) res = await r.tick();
  t('cannot mark done -> surfaced in errors', res.ok === true && res.errors.some(e => e.step === 'selftest_progress' && /may run again/.test(e.error)));
}
{
  const r = rig({ recordThrows: true });
  let res; for (let i = 0; i < 4; i++) res = await r.tick();
  t('history row failure surfaced', res.logged === false && res.errors.some(e => e.step === 'selftest_record' && /did not save/.test(e.error)));
}
{
  const r = rig({ deliverThrows: true });
  let res; for (let i = 0; i < 4; i++) res = await r.tick();
  t('digest delivery failure surfaced', res.errors.some(e => e.step === 'selftest_deliver') && res.delivery && res.delivery.delivered === false);
}
{
  const r = rig({ telemetryThrows: true });
  let res; for (let i = 0; i < 4; i++) res = await r.tick();
  t('telemetry failure surfaced', res.errors.some(e => e.step === 'selftest_telemetry'));
}

// source guards: no swallowing catches in the slice code
{
  const body = grab('selftestRunSlice', true) + grab('selftestFinish', true) + grab('selftestWriteProgress', true) + grab('selftestReadProgress', true);
  t('no empty/ignored catch in slice code', !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(body) && !/\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\})?\s*\)/.test(body));
}

console.log(`selftest-slice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
