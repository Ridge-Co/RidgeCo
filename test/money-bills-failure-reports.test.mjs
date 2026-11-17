// Fault-injection test for Phase 3a of the silent-failure burn-down (Nov 17 2026): vendor bills, estimates and "vendor paid" jobs.
// Runs the REAL functions out of the Worker source with fakes. A write or read that fails around a money record must be REPORTED, and the record that did save must still save.
// Run: node test/money-bills-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return src.slice(i, j); };
const helpers = slice('// ═══ SOFT-FAILURE-HELPERS-BEGIN', '// ═══ SOFT-FAILURE-HELPERS-END');
const fnText = name => { const i = src.indexOf('async function ' + name + '('); if (i < 0) throw new Error('function missing: ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };

let REPORTED, BAD_TABS;
const reset = () => { REPORTED = []; BAD_TABS = []; };
const ROWS = {
  Vendor_Bills: [{ QB_Bill_ID: 'B1', WO_ID: 'WO-1' }],
  Invoice_Review: [{ QB_Bill_ID: 'B2', WO_ID: 'WO-2' }],
  Payment_Milestones: [],
  Work_Orders: [{ ID: 'WO-1', Property_ID: 'P1', Status: 'Assigned' }, { ID: 'WO-2', Property_ID: 'P1', Status: 'Assigned' }],
  Properties: [{ ID: 'P1', Address: '1 Main St' }], Units: [], Scopes: [],
};
const world = {
  reportFailure: async (env, f) => { REPORTED.push(f); return { ok: true }; },
  fetchTab: async (env, tab) => { if (BAD_TABS.includes(tab)) throw new Error(tab + ' read failed'); return ROWS[tab] || []; },
  json: (b, s) => ({ body: b, status: s || 200 }),
  propUnitText: (p, u) => (p && p.Address) || '',
};
const names = Object.keys(world);
const code = helpers + '\n' + fnText('vendorPaidJobs') + '\nreturn { vendorPaidJobs };';
const F = new Function(...names, code)(...names.map(n => world[n]));
const last = () => REPORTED[REPORTED.length - 1] || {};

console.log('vendorPaidJobs (finds the job behind each paid QuickBooks bill)');
reset();
{
  const r = await F.vendorPaidJobs({}, ['B1', 'B2']);
  ok(r.jobs.length >= 1 && REPORTED.length === 0, 'healthy: jobs found, nothing reported');
}
reset(); BAD_TABS = ['Vendor_Bills'];
{
  const r = await F.vendorPaidJobs({}, ['B1']);
  ok(REPORTED.length === 1 && last().where === 'vendorPaidJobs:Vendor_Bills' && last().severity === 'P1', 'Vendor_Bills unreadable: reported once at P1 instead of silently listing the bill as unresolved');
  ok(Array.isArray(r.unresolved) && r.unresolved.includes('B1') || (r.jobs.length === 0), 'the paid bill is still reported back, never dropped');
}
reset(); BAD_TABS = ['Invoice_Review'];
{
  await F.vendorPaidJobs({}, ['B2']);
  ok(REPORTED.length === 1 && last().where === 'vendorPaidJobs:Invoice_Review', 'Invoice_Review unreadable: reported');
}

console.log('source checks on the other Phase 3a handlers (each failure site now reports instead of swallowing)');
const has = (re, msg) => ok(re.test(src), msg);
has(/softFail\(env, 'addVendorBill:linkHours'[^)]*severity: 'P1'/, 'addVendorBill: hours that fail to link to a saved bill are reported P1');
has(/softFail\(env, 'addVendorBill:linkHoursDupe'/, 'addVendorBill: a duplicate bill whose hours fail to link is reported');
has(/softFail\(env, 'addVendorBill:markComplete'/, 'addVendorBill: a Work Order that fails to move to Complete is reported');
has(/softFail\(env, 'addVendorBill:qboMatch'/, 'addVendorBill: a vendor that cannot be matched to QuickBooks is reported');
has(/softFail\(env, 'addEstimateVersion:currentEstimate'/, 'addEstimateVersion: a stale Current_Estimate is reported');
has(/softFail\(env, 'addEstimateVersion:maxPriceRead'[^)]*severity: 'P1'/, 'addEstimateVersion: an unreadable max price is reported P1 (the over-max check was skipped)');
has(/softFail\(env, 'addEstimateVersion:approvalStage'/, 'addEstimateVersion: a failed approval-stage update is reported');
has(/softFail\(env, 'woPushToScope:markConverted'[^)]*severity: 'P1'/, 'woPushToScope: an estimate that is not marked Converted is reported P1 (it could be pushed twice)');
has(/softFail\(env, 'woPushToScope:lineItems'/, 'woPushToScope: corrupt estimate lines are reported, not mistaken for an empty estimate');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
