// Fault-injection test for the central ensureColumns report (silent-failure burn-down Phase 6, Nov 17 2026).
// Runs the REAL ensureColumns out of the Worker source with fakes. A real header-check failure must reach the failure ledger once per tab,
// the quota-busy case must stay calm, the throw must still reach the caller, and the Telemetry tab must never report about itself.
// Run: node test/ensure-columns-report.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return src.slice(i, j); };
const helpers = slice('// ═══ SOFT-FAILURE-HELPERS-BEGIN', '// ═══ SOFT-FAILURE-HELPERS-END');
const ec = slice('const COLS_OK_MS', 'async function ensureColumnsInner');

let REPORTED, TELEM, INNER_ERR, BUSY, INNER_CALLS;
const world = {
  reportFailure: async (env, f) => { REPORTED.push(f); return { ok: true }; },
  fetchTab: async () => [],
  logTelemetry: async (env, row) => { TELEM.push(row); },
  ensureColumnsInner: async () => { INNER_CALLS++; if (INNER_ERR) throw INNER_ERR; },
  sheetsQuotaBusyError: () => BUSY,
  TELEMETRY_TAB: 'Ops_Telemetry',
};
const names = Object.keys(world);
const E = new Function(...names, helpers + '\n' + ec + '\nreturn { ensureColumns, __colsOk };')(...names.map(n => world[n]));
const reset = () => { REPORTED = []; TELEM = []; INNER_ERR = null; BUSY = false; INNER_CALLS = 0; E.__colsOk.clear(); };
const run = async (tab, cols) => { try { await E.ensureColumns({}, tab, cols || ['A']); return null; } catch (e) { return e; } };

console.log('success path');
reset();
{
  const e = await run('Work_Orders');
  ok(e === null && REPORTED.length === 0 && TELEM.length === 0, 'no report and no telemetry when the columns are fine');
}
console.log('real failure');
reset(); INNER_ERR = new Error('Google Sheets 500');
{
  const e = await run('Scopes', ['Link_Rev', 'Estimate_Notes_Orig']);
  ok(e === INNER_ERR, 'the original error is still thrown to the caller');
  ok(TELEM.length === 1 && TELEM[0].Job_Type === 'ensure_columns_failed', 'the Telemetry row still goes out');
  ok(REPORTED.length === 1 && REPORTED[0].where === 'ensureColumns:Scopes' && REPORTED[0].severity === 'P1' && REPORTED[0].ref === 'Scopes', 'one P1 ledger report names the tab');
  ok(String(REPORTED[0].context).includes('Link_Rev'), 'the report says which columns were being ensured');
  await run('Scopes', ['Link_Rev']); await run('Scopes', ['X']);
  ok(REPORTED.length === 1 && TELEM.length === 3, 'repeat failures on the same tab report once (Telemetry still logs each)');
  await run('Vendors');
  ok(REPORTED.length === 2 && REPORTED[1].where === 'ensureColumns:Vendors', 'a different tab is reported on its own');
}
console.log('quota busy stays calm');
reset(); INNER_ERR = new Error('429 quota'); BUSY = true;
{
  const e = await run('Properties');
  ok(e === INNER_ERR && REPORTED.length === 0 && TELEM[0].Job_Type === 'sheets_quota_busy', 'busy: still throws, calm P2 telemetry row, NO P1 ledger report');
}
console.log('telemetry tab never reports about itself');
reset(); INNER_ERR = new Error('boom');
{
  const e = await run('Ops_Telemetry');
  ok(e === INNER_ERR && REPORTED.length === 0 && TELEM.length === 0, 'no telemetry row and no report (recursion guard)');
}
console.log('a failing report never changes the outcome');
reset(); INNER_ERR = new Error('boom');
{
  world.reportFailure = async () => { throw new Error('ledger down'); };
  const E2 = new Function(...names, helpers + '\n' + ec + '\nreturn { ensureColumns };')(...names.map(n => world[n]));
  let thrown = null; try { await E2.ensureColumns({}, 'Owners', ['A']); } catch (e) { thrown = e; }
  ok(thrown === INNER_ERR, 'the caller still gets the original error, not the ledger error');
}
console.log('a failure is not memoized');
reset(); INNER_ERR = new Error('boom'); await run('Units'); INNER_ERR = null;
{
  const e = await run('Units');
  ok(e === null && INNER_CALLS === 2, 'after a failure the next call really retries');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
