// currentTenantForDispatch — fixed to fall back to Property_ID for whole-property (no-Unit)
// work orders, mirroring the fallback enrichWO already used for the WO-detail display. Found
// live (Sep 2026, WO-1196/Ziggy Stardust/123 Test St): the old version only ever checked
// Unit.Tenant_ID or WO.Tenant_ID directly, so tenant SMS silently never fired for ANY
// whole-property WO — Tenant_SMS_Sent stayed FALSE even on an otherwise-successful assign.
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
const { currentTenantForDispatch } = new Function(
  grab('isTenantCurrent') + '\n' + grab('currentTenantForDispatch') +
  '\nreturn { currentTenantForDispatch };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const ziggy = { ID: '82', First_Name: 'Ziggy', Last_Name: 'Stardust', Phone: '14439617927', Property_ID: '65', Unit_ID: '', Active: 'TRUE' };
const movedOutZiggy = { ...ziggy, ID: '83', Move_Out_Date: '2020-01-01' };
const unitTenant = { ID: '10', Property_ID: '65', Unit_ID: '7', Active: 'TRUE', Phone: '4435551234' };
const tenants = [ziggy, unitTenant];

// ---- Whole-property WO (no Unit_ID, no Tenant_ID) — the actual bug ----
{
  const wo = { ID: 'WO-1196', Property_ID: '65', Unit_ID: '', Tenant_ID: '' };
  const t = currentTenantForDispatch(tenants, undefined, wo);
  ok(t && t.ID === '82', 'whole-property WO with blank Unit_ID/Tenant_ID finds the property\'s whole-property tenant (the fix)');
}
// ---- A moved-out whole-property tenant must NOT be found this way ----
{
  const wo = { ID: 'WO-2', Property_ID: '65', Unit_ID: '', Tenant_ID: '' };
  const t = currentTenantForDispatch([movedOutZiggy], undefined, wo);
  ok(t === null, 'a moved-out whole-property tenant is never returned via the fallback');
}
// ---- A property with a real Unit_ID on the WO must NOT use the whole-property fallback ----
{
  const wo = { ID: 'WO-3', Property_ID: '65', Unit_ID: '7', Tenant_ID: '' };
  const unit = { ID: '7', Property_ID: '65', Tenant_ID: '10' };
  const t = currentTenantForDispatch(tenants, unit, wo);
  ok(t && t.ID === '10', 'a WO with a real unit still resolves via Unit.Tenant_ID, not the whole-property fallback');
}
// ---- Direct WO.Tenant_ID still takes priority when present ----
{
  const wo = { ID: 'WO-4', Property_ID: '65', Unit_ID: '', Tenant_ID: '82' };
  const t = currentTenantForDispatch(tenants, undefined, wo);
  ok(t && t.ID === '82', 'a direct WO.Tenant_ID still resolves normally (unchanged behavior)');
}
// ---- No tenant at all for the property — must return null, never throw ----
{
  const wo = { ID: 'WO-5', Property_ID: '999', Unit_ID: '', Tenant_ID: '' };
  const t = currentTenantForDispatch(tenants, undefined, wo);
  ok(t === null, 'no matching tenant at the property returns null cleanly');
}
// ---- A WO with a Unit_ID that matches no real Unit (unit undefined) still falls back correctly ----
{
  const wo = { ID: 'WO-6', Property_ID: '65', Unit_ID: 'nonexistent-unit', Tenant_ID: '' };
  const t = currentTenantForDispatch(tenants, undefined, wo);
  // unit is undefined here (caller's lookup found nothing), but wo.Unit_ID is non-blank —
  // the fallback only triggers when wo itself has no Unit_ID, so this should NOT fall back
  // to the whole-property match (a WO that names a unit shouldn't silently reassign to a
  // different tenant elsewhere on the property).
  ok(t === null, 'a WO naming a (missing) Unit_ID does not fall through to the whole-property tenant');
}

console.log(`tenant-dispatch-whole-property: ${n}/${n} passing`);
