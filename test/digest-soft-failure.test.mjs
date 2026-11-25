// Fault-injection test for buildDigest / formatDigestText (silent-failure burn-down Phase 4, Nov 17 2026).
// Runs the REAL functions out of the Worker source with fakes. A failing Sheets read must be reported once, shown in the digest, and never break it.
// Run: node test/digest-soft-failure.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return src.slice(i, j); };
const helpers = slice('// ═══ SOFT-FAILURE-HELPERS-BEGIN', '// ═══ SOFT-FAILURE-HELPERS-END');
const build = slice('async function buildDigest(env) {', '// GET /stale-wos');
const fmt = slice('function formatDigestText(d) {', 'async function deliverDigest');
const activeRows = "function activeRows(rows) { return rows.filter(r => String(r.Active||'').toUpperCase() !== 'FALSE'); }";

let REPORTED, BAD_TABS, CFG, METRICS_THROW, CFG_THROW;
const world = {
  reportFailure: async (env, f) => { REPORTED.push(f); return { ok: true }; },
  fetchTab: async (env, t) => { if (BAD_TABS.includes(t)) throw new Error(t + ' read failed'); return t === 'Work_Orders' ? [{ ID: '1', Status: 'Open', Scheduled_Date: '2000-01-01' }] : []; },
  demoHide: x => x, etTodayISO: () => '2026-11-17', daysAgoISO: () => '2026-11-13', etStamp: () => 'stamp',
  OPEN_WO_STATUSES: ['Open'], DIGEST_CLOSED: [],
  readTelemetryRows: async () => { if (METRICS_THROW) throw new Error('telemetry down'); return []; },
  computeTelemetryMetrics: () => ({ byJob: {} }),
  fetchConfig: async () => { if (CFG_THROW) throw new Error('config down'); return CFG; },
  fuDigestLines: async () => ({ lines: [], error: null }),
  vendorDocDigestLines: () => [],   // queue #113: pure helper, tested in test/vendor-doc-expiry.test.mjs
};
const names = Object.keys(world);
const F = new Function(...names, helpers + '\n' + activeRows + '\n' + build + '\n' + fmt + '\nreturn { buildDigest, formatDigestText };')(...names.map(n => world[n]));
const reset = () => { REPORTED = []; BAD_TABS = []; CFG = {}; METRICS_THROW = false; CFG_THROW = false; };

console.log('healthy digest');
reset();
{
  const d = await F.buildDigest({});
  ok(d.warnings.length === 0 && REPORTED.length === 0, 'no warnings and no reports when every read works');
  ok(d.overdue.length === 1, 'digest content is unchanged');
  ok(!F.formatDigestText(d).includes('SYSTEM HEALTH'), 'no health section when nothing is wrong');
}
console.log('a Sheets read fails');
reset(); BAD_TABS = ['Vendor_Bills', 'Tenants'];
{
  const d = await F.buildDigest({});
  ok(d.warnings.length === 2 && d.warnings[0].includes('Vendor_Bills'), 'each failed tab becomes a warning on the digest');
  ok(REPORTED.length === 2 && REPORTED.every(r => r.severity === 'P1' && r.where.startsWith('digest:read:')), 'each failed tab is reported once at P1');
  ok(d.overdue.length === 1, 'the digest still builds from the tabs that did read');
  const t = F.formatDigestText(d);
  ok(t.includes('SYSTEM HEALTH') && t.includes('Could not read Vendor_Bills') && t.includes('may be incomplete'), 'the text Brett reads says the numbers may be incomplete');
}
console.log('telemetry read fails');
reset(); METRICS_THROW = true;
{
  const d = await F.buildDigest({});
  ok(d.warnings.some(w => w.includes('job success rates')) && REPORTED.some(r => r.where === 'digest:health-alerts'), 'reported and shown, digest still returned');
}
console.log('config unreadable / corrupt');
reset(); CFG_THROW = true;
{
  const d = await F.buildDigest({});
  ok(d.warnings.some(w => w.includes('receipts')) && REPORTED.some(r => r.where === 'digest:stuck-receipts'), 'unreadable Config is reported and shown');
}
reset(); CFG = { receipt_intake_failures: '{not json' };
{
  const d = await F.buildDigest({});
  ok(REPORTED.length === 1 && REPORTED[0].where === 'digest:receipt_intake_failures', 'corrupt JSON cell is reported (queued then flushed before return)');
  ok(Array.isArray(d.stuckReceipts) && d.stuckReceipts.length === 0, 'falls back to no stuck receipts');
}
reset(); CFG = { receipt_intake_failures: '' };
{
  await F.buildDigest({});
  ok(REPORTED.length === 0, 'a blank cell is not an error');
}
console.log('every read fails: still one report per tab, never a throw');
reset(); BAD_TABS = ['Work_Orders', 'Vendor_Bills', 'Properties', 'Vendors', 'Tenants'];
{
  let threw = false, d; try { d = await F.buildDigest({}); } catch (e) { threw = true; }
  ok(!threw && d.warnings.length === 5 && REPORTED.length === 5, 'five failures, five reports, digest returned');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
