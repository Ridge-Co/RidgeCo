// Fault-injection test for the Phase 7 read conversions (silent-failure burn-down, Nov 17 2026): Deliveries, Trash and Inspection list reads.
// Runs the REAL functions out of the Worker source with fakes. A failing Sheets read must be reported once, never throw, never change the response shape
// the pages rely on (bare arrays stay arrays), and a tab that does not exist yet must stay quiet.
// Run: node test/reads-soft-failure.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return src.slice(i, j); };
const helpers = slice('// ═══ SOFT-FAILURE-HELPERS-BEGIN', '// ═══ SOFT-FAILURE-HELPERS-END');
const fnText = name => { const i = src.indexOf('async function ' + name + '('); if (i < 0) throw new Error('function missing: ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
const NAMES = ['deliveriesList', 'trashListProperties', 'trashWeek', 'trashUnbilled', 'inspCustomersList', 'inspPropertiesList', 'inspUnitsList', 'inspAvailabilityGet'];

let REPORTED, BAD, MISSING, ROWS;
const world = {
  reportFailure: async (env, f) => { REPORTED.push(f); return { ok: true }; },
  fetchTab: async (env, tab) => {
    if (MISSING.includes(tab)) throw new Error('Unable to parse range: ' + tab + '!A1:ZZ');
    if (BAD.includes(tab)) throw new Error(tab + ' read failed');
    return ROWS[tab] || [];
  },
  isMissingTabError: e => /Unable to parse range/i.test((e && e.message) || ''),
  json: (body, status) => ({ body, status: status || 200 }),
  ensureDeliveryTab: async () => {},
  trashWeekKey: d => d || '2026-11-16', trashIsSkipped: () => false, trashPastDeadline: () => true,
};
const names = Object.keys(world);
const code = helpers + '\n' + NAMES.map(fnText).join('\n') + '\nreturn { ' + NAMES.join(', ') + ' };';
const F = new Function(...names, code)(...names.map(n => world[n]));
const reset = () => { REPORTED = []; BAD = []; MISSING = []; ROWS = {}; };
const url = q => ({ searchParams: new URLSearchParams(q || '') });

console.log('deliveriesList');
reset(); ROWS.Deliveries = [{ ID: '1', Status: 'Ordered', Property_ID: 'p1' }]; ROWS.Properties = [{ ID: 'p1', Address: '1 Main' }];
{
  const r = await F.deliveriesList({}, url());
  ok(r.body.count === 1 && r.body.warnings.length === 0 && REPORTED.length === 0, 'healthy: same data, empty warnings, no report');
}
reset(); ROWS.Deliveries = [{ ID: '1', Status: 'Ordered', Property_ID: 'p1' }]; BAD = ['Properties', 'Tenants'];
{
  const r = await F.deliveriesList({}, url());
  ok(r.body.count === 1 && r.body.deliveries[0].property_address === '', 'still returns the deliveries it could read');
  ok(r.body.warnings.length === 2 && r.body.warnings[0].includes('Properties'), 'each unreadable tab is a warning on the response');
  ok(REPORTED.length === 2 && REPORTED.every(x => x.severity === 'P2' && x.where.startsWith('deliveries:read:')), 'each unreadable tab is reported once');
}
console.log('trashWeek');
reset(); BAD = ['Trash_Visits'];
{
  const r = await F.trashWeek({}, url());
  ok(Array.isArray(r.body.properties) && r.body.warnings.length === 1 && REPORTED.length === 1, 'failed read: warning + one report, response shape kept');
}
reset(); MISSING = ['Trash_Properties', 'Trash_Visits', 'Trash_Skips'];
{
  const r = await F.trashWeek({}, url());
  ok(r.body.warnings.length === 0 && REPORTED.length === 0, 'tabs that do not exist yet stay quiet (not a failure)');
}
console.log('trashUnbilled (powers the push nudge)');
reset(); BAD = ['Trash_Properties'];
{
  const r = await F.trashUnbilled({}, url());
  ok(r.body.count === 0 && r.body.warnings.length === 1, 'an unreadable tab is not shown as a silent "nothing needs attention"');
  ok(REPORTED.length === 1 && REPORTED[0].severity === 'P1' && REPORTED[0].ref === 'Trash_Properties', 'reported at P1 naming the tab');
}
console.log('bare-array handlers keep their shape');
reset(); BAD = ['Trash_Properties', 'Insp_Customers', 'Insp_Properties', 'Insp_Units'];
{
  const a = await F.trashListProperties({}), b = await F.inspCustomersList({}), c = await F.inspPropertiesList({}, url('customer_id=1')), d = await F.inspUnitsList({}, url());
  ok([a, b, c, d].every(x => Array.isArray(x.body) && x.body.length === 0 && x.status === 200), 'failed reads still return an empty array with status 200');
  ok(REPORTED.length === 4 && REPORTED.every(x => x.severity === 'P2'), 'but every failure is reported');
}
reset(); MISSING = ['Insp_Customers', 'Insp_Units'];
{
  const b = await F.inspCustomersList({}), d = await F.inspUnitsList({}, url());
  ok(Array.isArray(b.body) && Array.isArray(d.body) && REPORTED.length === 0, 'tabs created on first add stay quiet when missing');
}
console.log('inspAvailabilityGet');
reset(); BAD = ['Insp_Blackouts']; ROWS.Insp_Availability_Rules = [{ ID: '1', Active: 'TRUE' }];
{
  const r = await F.inspAvailabilityGet({});
  ok(r.body.rules.length === 1 && r.body.blackouts.length === 0 && r.body.warnings.length === 1 && REPORTED.length === 1, 'rules still load; the failed blackouts read is warned and reported');
}
console.log('one report per request, and a failing ledger changes nothing');
reset(); BAD = ['Properties', 'Units', 'Tenants', 'Deliveries'];
{
  const r = await F.deliveriesList({}, url());
  ok(r.body.warnings.length === 4 && REPORTED.length === 4, 'four different tabs = four reports (deduped by tab, not by request)');
}
reset(); BAD = ['Trash_Visits'];
{
  world.reportFailure = async () => { throw new Error('ledger down'); };
  const G = new Function(...names, code)(...names.map(n => world[n]));
  let threw = false, r; try { r = await G.trashWeek({}, url()); } catch (e) { threw = true; }
  ok(!threw && r.body.warnings.length === 1, 'a ledger that is down never breaks the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
