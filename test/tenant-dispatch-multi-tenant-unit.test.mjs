// CAP-036 #21 — a unit with more than one active tenant (roommates) was only ever notifying
// ONE of them for work-order SMS (reassignment, completion, scheduled, etc), because
// currentTenantForDispatch followed Units.Tenant_ID — a single FK that can only ever name one
// occupant — instead of asking the Tenants table for every active tenant actually linked to
// that unit. Real case: 115 W 29th St Apt 3 (Unit_ID 3) has Lance Serafica (ID 103) and Emily
// Marquez (ID 118) both active with Unit_ID:'3'/Property_ID:'3', but Units row 3's own
// Tenant_ID column only ever pointed at Emily (118) — so Lance never got a text. Apt 2 (Julie
// Feldman ID 80 / Alanna McLaughlin ID 119) shows the identical pattern.
//
// tenantsForDispatch is the fix: it scans Tenants directly by Unit_ID (ignoring the single
// Units.Tenant_ID pointer entirely when a real WO.Unit_ID is present) and returns every active
// match. currentTenantForDispatch is left untouched (byte-identical to before this fix) so
// every existing single-tenant caller and test keeps working unchanged — see
// tenant-dispatch-whole-property.test.mjs and tenant-privacy.test.mjs.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { tenantsForDispatch, currentTenantForDispatch } = new Function(
  grab('isTenantCurrent') + '\n' + grab('tenantsForDispatch') + '\n' + grab('currentTenantForDispatch') +
  '\nreturn { tenantsForDispatch, currentTenantForDispatch };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// Real production shape (IDs/names match the live Tenants/Units sheets, Sep 24 2026).
const lance = { ID: '103', First_Name: 'Lance', Last_Name: 'Serafica', Phone: '+12012204510', Unit_ID: '3', Property_ID: '3', Active: 'TRUE' };
const emily = { ID: '118', First_Name: 'Emily', Last_Name: 'Marquez', Phone: '+12018208670', Unit_ID: '3', Property_ID: '3', Active: 'TRUE' };
const julie = { ID: '80', First_Name: 'Julie', Last_Name: 'Feldman', Phone: '+14439863974', Unit_ID: '2', Property_ID: '3', Active: 'TRUE' };
const alanna = { ID: '119', First_Name: 'Alanna', Last_Name: 'McLaughlin', Phone: '+16109059003', Unit_ID: '2', Property_ID: '3', Active: 'TRUE' };
const kareem = { ID: '74', First_Name: 'Kareem', Unit_ID: '1', Property_ID: '3', Active: 'TRUE', Phone: '+14102371630' };
const movedOutRoommate = { ID: '999', First_Name: 'Gone', Unit_ID: '3', Property_ID: '3', Active: 'TRUE', Move_Out_Date: '2020-01-01', Phone: '+15550001111' };
const tenants = [lance, emily, julie, alanna, kareem, movedOutRoommate];

// Units.Tenant_ID (the old single pointer) names only ONE of the two roommates on each unit —
// exactly the real broken data shape. It must no longer matter at all when wo.Unit_ID is set.
const unit3 = { ID: '3', Property_ID: '3', Unit_Label: 'Apt 3', Tenant_ID: '118' }; // points at Emily only
const unit2 = { ID: '2', Property_ID: '3', Unit_Label: 'Apt 2', Tenant_ID: '119' }; // points at Alanna only

{
  const wo = { ID: 'WO-9001', Unit_ID: '3', Property_ID: '3', Tenant_ID: '' };
  const all = tenantsForDispatch(tenants, unit3, wo);
  const ids = all.map(t => t.ID).sort();
  ok(ids.length === 2 && ids[0] === '103' && ids[1] === '118', `Apt 3 fans out to BOTH Lance and Emily (got ${JSON.stringify(ids)}) — the bug this fixes`);
}
{
  const wo = { ID: 'WO-9002', Unit_ID: '2', Property_ID: '3', Tenant_ID: '' };
  const all = tenantsForDispatch(tenants, unit2, wo);
  const ids = all.map(t => t.ID).sort();
  ok(ids.length === 2 && ids[0] === '119' && ids[1] === '80', `Apt 2 fans out to BOTH Julie and Alanna (got ${JSON.stringify(ids)})`);
}
{
  // A single-tenant unit is unaffected — still exactly one recipient.
  const wo = { ID: 'WO-9003', Unit_ID: '1', Property_ID: '3', Tenant_ID: '' };
  const unit1 = { ID: '1', Property_ID: '3', Tenant_ID: '74' };
  const all = tenantsForDispatch(tenants, unit1, wo);
  ok(all.length === 1 && all[0].ID === '74', 'a unit with only one active tenant still returns exactly that one tenant');
}
{
  // A moved-out roommate must never be included in the fan-out.
  const wo = { ID: 'WO-9004', Unit_ID: '3', Property_ID: '3', Tenant_ID: '' };
  const all = tenantsForDispatch(tenants, unit3, wo);
  ok(!all.some(t => t.ID === '999'), 'a moved-out tenant sharing the unit is excluded from the fan-out');
}
{
  // Back-compat: currentTenantForDispatch (still used by any single-tenant-only caller) is
  // UNCHANGED — it still follows the legacy Units.Tenant_ID pointer exactly as before this
  // fix. It is intentionally NOT rebuilt on tenantsForDispatch, so every existing test that
  // extracts it standalone (tenant-privacy.test.mjs, tenant-dispatch-whole-property.test.mjs)
  // keeps passing unmodified. This assertion just proves it still resolves via the pointer.
  const wo = { ID: 'WO-9005', Unit_ID: '3', Property_ID: '3', Tenant_ID: '' };
  const t = currentTenantForDispatch(tenants, unit3, wo);
  ok(t && t.ID === '118', 'currentTenantForDispatch still resolves via the legacy Units.Tenant_ID pointer, unchanged');
}
{
  // Whole-property (no-Unit) fallback is untouched by this fix — still returns the array form
  // (one match) for a normal single whole-property tenant.
  const wholePropTenant = { ID: '31', First_Name: 'Alexis', Property_ID: '14', Unit_ID: '', Active: 'TRUE', Phone: '+12025918383' };
  const wo = { ID: 'WO-9006', Property_ID: '14', Unit_ID: '', Tenant_ID: '' };
  const all = tenantsForDispatch([wholePropTenant], undefined, wo);
  ok(all.length === 1 && all[0].ID === '31', 'whole-property (no-Unit) WOs still resolve via the existing Property_ID fallback');
}

console.log(`tenant-dispatch-multi-tenant-unit: ${n}/${n} passing`);
