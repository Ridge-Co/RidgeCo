// Tenant work-order submission toggle: OWNER level overrides PROPERTY level, each level can be
// scoped to specific properties/units, and the default with nothing set anywhere is OFF (per
// Brett's explicit "off by default" answer). Runs the real function out of worker.js so the
// test can't drift from what ships.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const { resolveTenantWOAccess } = new Function(
  grab(wsrc, 'function resolveTenantWOAccess(') + '\nreturn { resolveTenantWOAccess };')();

// ── No property at all → always false ──
t('no property → false', resolveTenantWOAccess(null, null, 'u1') === false);

// ── Nothing set anywhere → OFF by default (Brett's explicit choice) ──
{
  const prop = { ID: 'p1' };
  t('nothing set anywhere → OFF by default', resolveTenantWOAccess(prop, null, 'u1') === false);
  t('nothing set anywhere, no owner at all → OFF by default', resolveTenantWOAccess(prop, undefined, '') === false);
}

// ── Owner-level ON, blank property scope → applies to ALL of that owner's properties ──
{
  const prop = { ID: 'p1' };
  const owner = { Tenant_WO_Toggle: 'ON', Tenant_WO_Property_IDs: '' };
  t('owner ON, blank scope → applies to every property', resolveTenantWOAccess(prop, owner, 'u1') === true);
}

// ── Owner-level OFF, scoped to specific property IDs → only affects those ──
{
  const owner = { Tenant_WO_Toggle: 'OFF', Tenant_WO_Property_IDs: 'p1, p2' };
  const propInScope = { ID: 'p1' };
  const propOutOfScope = { ID: 'p3', Tenant_WO_Toggle: 'ON', Tenant_WO_Unit_IDs: '' };
  t('owner OFF scoped to p1/p2 → blocks p1', resolveTenantWOAccess(propInScope, owner, 'u1') === false);
  t('owner override does not touch a property outside its scope → falls through to property level', resolveTenantWOAccess(propOutOfScope, owner, 'u1') === true);
}

// ── Owner override for a property NOT in its scoped list falls through to property-level ──
{
  const owner = { Tenant_WO_Toggle: 'ON', Tenant_WO_Property_IDs: 'p1' };
  const propOutOfScope = { ID: 'p9', Tenant_WO_Toggle: 'OFF', Tenant_WO_Unit_IDs: '' };
  t('owner ON scoped to p1 only, p9 falls through to its own OFF', resolveTenantWOAccess(propOutOfScope, owner, 'u1') === false);
  const propOutOfScopeNoSetting = { ID: 'p9' };
  t('owner ON scoped to p1 only, p9 has no property setting → OFF by default', resolveTenantWOAccess(propOutOfScopeNoSetting, owner, 'u1') === false);
}

// ── Property-level ON/OFF with blank unit scope → applies to all units ──
{
  const propOn = { ID: 'p1', Tenant_WO_Toggle: 'ON', Tenant_WO_Unit_IDs: '' };
  const propOff = { ID: 'p2', Tenant_WO_Toggle: 'OFF', Tenant_WO_Unit_IDs: '' };
  t('property ON, blank unit scope → true for any unit', resolveTenantWOAccess(propOn, null, 'u-anything') === true);
  t('property OFF, blank unit scope → false for any unit', resolveTenantWOAccess(propOff, null, 'u-anything') === false);
}

// ── Property-level scoped to specific unit IDs → a unit NOT in that list falls through to OFF ──
{
  const prop = { ID: 'p1', Tenant_WO_Toggle: 'ON', Tenant_WO_Unit_IDs: 'u1, u2' };
  t('property ON scoped to u1/u2 → true for u1', resolveTenantWOAccess(prop, null, 'u1') === true);
  t('property ON scoped to u1/u2 → false for u9 (not in scope, default OFF)', resolveTenantWOAccess(prop, null, 'u9') === false);
  t('property ON scoped to u1/u2 → false when no unit id given at all', resolveTenantWOAccess(prop, null, '') === false);
}

// ── Full hierarchy: owner override wins over property setting when both apply to this property ──
{
  const owner = { Tenant_WO_Toggle: 'OFF', Tenant_WO_Property_IDs: '' }; // blocks ALL owner's properties
  const prop = { ID: 'p1', Tenant_WO_Toggle: 'ON', Tenant_WO_Unit_IDs: '' }; // property itself says ON
  t('owner-level OFF (unscoped) overrides a property that is itself set to ON', resolveTenantWOAccess(prop, owner, 'u1') === false);
}
{
  const owner = { Tenant_WO_Toggle: 'ON', Tenant_WO_Property_IDs: '' }; // allows ALL owner's properties
  const prop = { ID: 'p1', Tenant_WO_Toggle: 'OFF', Tenant_WO_Unit_IDs: '' }; // property itself says OFF
  t('owner-level ON (unscoped) overrides a property that is itself set to OFF', resolveTenantWOAccess(prop, owner, 'u1') === true);
}

console.log(`tenant-wo-toggle: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
