// Needs Attention page read cache (Nov 17 2026). Ledger row F-1792537353924-mans (P2, read_meter_quota): GET /failures/open was the Hub's top
// Sheets-read spender (54 reads/hour from 30 requests) because the page polls every 60s and every poll read the Failures tab AND Config.
// These offline tests load the REAL failOpenList / failOpenCacheClear source out of worker.js and count the Sheets reads they make.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };

const listSrc = grab(wsrc, 'async function failOpenList(');
const clearSrc = grab(wsrc, 'function failOpenCacheClear(');
const updateSrc = grab(wsrc, 'async function failUpdate(');

function build(st) {
  const src = [
    "const FAIL_LEDGER_TAB = 'Failures'; const FAIL_LEDGER_COLS = ['ID', 'Severity', 'Last_Seen', 'Status'];",
    "const FAIL_OPEN = ['open', 'acknowledged'];",
    "function failSevRank(s) { return s === 'P0' ? 0 : s === 'P1' ? 1 : 2; }",
    'function failRowsToObjects(values, cols) { return values.map((v, i) => { const o = {}; cols.forEach((c, j) => { o[c] = v[j] === undefined ? "" : v[j]; }); o._row = i + 2; return o; }); }',
    'function isMissingTabError() { return false; }',
    "function configFromValues() { return { failure_alert_enabled: 'TRUE' }; }",
    'function json(o, status) { return Object.assign({ _status: status || 200 }, o); }',
    'async function sheetsRequest(env, method, path) { st.reads.push(path); if (st.readFails && path.indexOf("Failures") >= 0) throw new Error("Sheets 500"); return { values: path.indexOf("Config") >= 0 ? [] : st.ledger }; }',
    'const Date = class extends globalThis.Date { static now() { return st.now; } };',
    'let __failOpenCache = null, __failAlertsCache = null;',
    'const FAIL_OPEN_CACHE_MS = 20000, FAIL_ALERTS_CACHE_MS = 300000;',
    clearSrc, listSrc,
    'return { failOpenList, failOpenCacheClear };',
  ].join('\n');
  return new Function('st', src)(st);
}
const HDR = ['ID', 'Severity', 'Last_Seen', 'Status'];
const LEDGER = () => [HDR, ['F-1', 'P2', '2026-11-17T10:00:00Z', 'open'], ['F-2', 'P0', '2026-11-17T09:00:00Z', 'open'], ['F-3', 'P1', '2026-11-16T09:00:00Z', 'fixed']];
const mk = () => ({ reads: [], ledger: LEDGER(), now: 1000000, readFails: false });
const ledgerReads = (st) => st.reads.filter(p => p.indexOf('Failures') >= 0).length;
const configReads = (st) => st.reads.filter(p => p.indexOf('Config') >= 0).length;

console.log('failures/open read cache — offline tests\n');

// 1. THE BUG: repeated polls inside 20s must not re-read the sheet.
{
  const st = mk(), L = build(st);
  const a = await L.failOpenList({}, new URL('https://x/failures/open'));
  const b = await L.failOpenList({}, new URL('https://x/failures/open'));
  const c = await L.failOpenList({}, new URL('https://x/failures/open'));
  t('three polls in a row: one Failures read, one Config read (was 3 + 3)', ledgerReads(st) === 1 && configReads(st) === 1, st.reads);
  t('answers are still right: open rows only, worst first', a.failures.map(f => f.ID).join() === 'F-2,F-1' && a.counts.open === 2 && a.counts.P0 === 1, a);
  t('the cached answers match the fresh one', JSON.stringify(b.failures) === JSON.stringify(a.failures) && JSON.stringify(c.counts) === JSON.stringify(a.counts));
  t('alerts flag is carried through the cache', a.alerts_on === true && c.alerts_on === true);
}
// 2. The cache expires: after 20s the ledger is read again, Config stays cached (5 min).
{
  const st = mk(), L = build(st);
  await L.failOpenList({}, new URL('https://x/failures/open'));
  st.ledger = [HDR, ['F-9', 'P1', '2026-11-17T11:00:00Z', 'open']];
  st.now += 5000;
  const early = await L.failOpenList({}, new URL('https://x/failures/open'));
  t('inside 20s a ledger change is not seen yet (proves the cache is doing the work)', early.failures.map(f => f.ID).join() === 'F-2,F-1', early);
  st.now += 20000;
  const late = await L.failOpenList({}, new URL('https://x/failures/open'));
  t('after 20s the ledger is read again and the change shows', late.failures.map(f => f.ID).join() === 'F-9' && ledgerReads(st) === 2, st.reads);
  t('Config is still cached at 25s', configReads(st) === 1, st.reads);
  st.now += 300000;
  await L.failOpenList({}, new URL('https://x/failures/open'));
  t('Config is read again after 5 minutes', configReads(st) === 2, st.reads);
}
// 3. Marking a failure clears the cache so the page sees the change at once.
{
  const st = mk(), L = build(st);
  await L.failOpenList({}, new URL('https://x/failures/open'));
  st.ledger = [HDR, ['F-2', 'P0', '2026-11-17T09:00:00Z', 'fixed']];
  L.failOpenCacheClear();
  const r = await L.failOpenList({}, new URL('https://x/failures/open'));
  t('after failOpenCacheClear the next poll reads fresh', r.failures.length === 0 && r.counts.open === 0 && ledgerReads(st) === 2, r);
  t('failUpdate calls failOpenCacheClear after a saved change', /failOpenCacheClear\(\)/.test(updateSrc));
  t('failOpenCacheClear runs only after the read-back check passes', updateSrc.indexOf('failOpenCacheClear()') > updateSrc.indexOf('read-back mismatch'));
}
// 4. ?all=1 and the default share one cached read but filter differently.
{
  const st = mk(), L = build(st);
  const open = await L.failOpenList({}, new URL('https://x/failures/open'));
  const all = await L.failOpenList({}, new URL('https://x/failures/open?all=1'));
  t('?all=1 includes the fixed row from the same cached read', open.failures.length === 2 && all.failures.length === 3 && ledgerReads(st) === 1, { o: open.failures.length, a: all.failures.length });
}
// 5. A failed read is reported (503) and is never cached.
{
  const st = mk(), L = build(st); st.readFails = true;
  const bad = await L.failOpenList({}, new URL('https://x/failures/open'));
  t('a failed ledger read still returns a loud 503', bad._status === 503 && bad.ok === false, bad);
  st.readFails = false;
  const good = await L.failOpenList({}, new URL('https://x/failures/open'));
  t('and the next poll retries instead of serving the failure', good.ok === true && good.failures.length === 2, good);
}
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
