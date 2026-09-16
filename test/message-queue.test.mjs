// TWILIO_SMS_BUILD_BRIEF_v1.0 — the gating core. Pulls the REAL pure helpers out of
// worker.js (same extraction pattern as test/scope-book.test.mjs): smsGateDecision (the
// Global/Property/Customer/Tenant/Vendor decision logic), smsToggleOn (the "blank cell reads
// as ON, only 'FALSE' reads as OFF" convention every SMS_Enabled column relies on), and
// formatPhoneDisplay (the vendor phone shown inside a tenant_job_assigned text).
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
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing ' + name);
  const j = src.indexOf(';\n', i);
  return src.slice(i, j + 1);
}
const { smsGateDecision, smsToggleOn, formatPhoneDisplay } = new Function(
  grab('formatPhoneDisplay') + '\n' + grabConst('smsToggleOn') + '\n' + grab('smsGateDecision') +
  '\nreturn { smsGateDecision, smsToggleOn, formatPhoneDisplay };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- smsToggleOn: blank/missing reads as ON, only literal 'FALSE' reads as OFF ----
{
  ok(smsToggleOn(undefined) === true, 'missing cell defaults ON');
  ok(smsToggleOn('') === true, 'blank cell defaults ON');
  ok(smsToggleOn(null) === true, 'null defaults ON');
  ok(smsToggleOn('TRUE') === true, 'explicit TRUE is ON');
  ok(smsToggleOn('FALSE') === false, 'explicit FALSE is OFF');
  ok(smsToggleOn('false') === false, 'lowercase false is still OFF (case-insensitive)');
}

// ---- smsGateDecision: TENANT messages need Global AND Property AND Customer AND Tenant ----
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === true, 'tenant: all four gates open -> sendOk true');
  ok(r.gateSnapshot === 'all gates open', 'tenant: snapshot reads all gates open');
}
{
  const r = smsGateDecision({ global:false, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === false, 'tenant: Global off alone blocks the send');
  ok(r.gateSnapshot === 'Global OFF', 'tenant: snapshot names Global OFF');
}
{
  const r = smsGateDecision({ global:true, propertyOn:false, ownerOn:true, tenantOn:true, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === false, 'tenant: Property off alone blocks the send even with everything else on');
  ok(r.gateSnapshot === 'Property OFF', 'tenant: snapshot names Property OFF specifically');
}
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:false, tenantOn:true, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === false, 'tenant: Customer(owner) off alone blocks the send');
  ok(r.gateSnapshot === 'Customer OFF', 'tenant: snapshot names Customer OFF (not "Owner")');
}
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:false, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === false, 'tenant: Tenant off alone blocks the send');
  ok(r.gateSnapshot === 'Tenant OFF', 'tenant: snapshot names Tenant OFF');
}
{
  const r = smsGateDecision({ global:false, propertyOn:false, ownerOn:false, tenantOn:false, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === false, 'tenant: every gate off -> blocked');
  ok(r.gateSnapshot === 'Global OFF, Property OFF, Customer OFF, Tenant OFF', 'tenant: snapshot lists every failed gate, in order');
}
{
  // Vendor-only toggles must NEVER affect a tenant send — tenant does not nest under vendor.
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:false, kind:'tenant' });
  ok(r.sendOk === true, 'tenant send is unaffected by an unrelated vendorOn=false');
}

// ---- smsGateDecision: VENDOR messages need only Global AND Vendor — no Property/Customer nesting ----
{
  const r = smsGateDecision({ global:true, propertyOn:false, ownerOn:false, tenantOn:false, vendorOn:true, kind:'vendor' });
  ok(r.sendOk === true, 'vendor send ignores Property/Customer/Tenant entirely (per the brief: vendor does not nest under property)');
}
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:false, kind:'vendor' });
  ok(r.sendOk === false, 'vendor: Vendor off alone blocks the send');
  ok(r.gateSnapshot === 'Vendor OFF', 'vendor: snapshot names Vendor OFF');
}
{
  const r = smsGateDecision({ global:false, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:false, kind:'vendor' });
  ok(r.gateSnapshot === 'Global OFF, Vendor OFF', 'vendor: snapshot lists Global then Vendor when both are off');
}

// ---- smsGateDecision: OWNER messages (Sep 14 2026) need Global AND Property AND Customer — no Tenant layer ----
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:false, vendorOn:false, kind:'owner' });
  ok(r.sendOk === true, 'owner send ignores Tenant entirely — same shape as vendor not nesting under property, just one layer up');
}
{
  const r = smsGateDecision({ global:true, propertyOn:false, ownerOn:true, tenantOn:false, vendorOn:false, kind:'owner' });
  ok(r.sendOk === false && r.gateSnapshot === 'Property OFF', 'owner: Property off alone blocks the send');
}
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:false, tenantOn:false, vendorOn:false, kind:'owner' });
  ok(r.sendOk === false && r.gateSnapshot === 'Customer OFF', 'owner: Customer (the owner\'s own SMS_Enabled) off alone blocks the send');
}
{
  const r = smsGateDecision({ global:false, propertyOn:false, ownerOn:false, tenantOn:false, vendorOn:false, kind:'owner' });
  ok(r.gateSnapshot === 'Global OFF, Property OFF, Customer OFF', 'owner: snapshot lists all three failing gates in order');
}

// ---- smsGateDecision: SMS_OptOut (Sep 16 2026) — a real opt-out blocks even when every
// toggle is otherwise ON. Wired in alongside the property-notice bulk feature, which is
// exactly the case where "urgent" must not mean "ignore an explicit opt-out." ----
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:true, tenantOptOut:true, kind:'tenant' });
  ok(r.sendOk === false, 'tenant: opted out blocks the send even with every toggle ON');
  ok(r.gateSnapshot === 'Tenant opted out', 'tenant: snapshot names the opt-out specifically');
}
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:true, tenantOptOut:false, kind:'tenant' });
  ok(r.sendOk === true, 'tenant: explicit opt-out FALSE still sends normally');
}
{
  const r = smsGateDecision({ global:true, vendorOn:true, vendorOptOut:true, kind:'vendor' });
  ok(r.sendOk === false && r.gateSnapshot === 'Vendor opted out', 'vendor: opted out blocks the send, named specifically');
}
{
  const r = smsGateDecision({ global:true, propertyOn:true, ownerOn:true, tenantOn:true, vendorOn:true, kind:'tenant' });
  ok(r.sendOk === true, 'tenant: omitting tenantOptOut entirely (older call sites) still defaults to not-opted-out');
}

// ---- formatPhoneDisplay: readable (xxx) xxx-xxxx for a tenant_job_assigned message ----
{
  ok(formatPhoneDisplay('4439617927') === '(443) 961-7927', 'bare 10-digit formats correctly');
  ok(formatPhoneDisplay('14439617927') === '(443) 961-7927', 'leading-1 11-digit strips the 1 and formats correctly');
  ok(formatPhoneDisplay('+14439617927') === '(443) 961-7927', 'E.164 form formats correctly');
  ok(formatPhoneDisplay('') === '', 'blank input returns blank, never throws');
  ok(formatPhoneDisplay(null) === '', 'null input returns blank, never throws');
}

console.log(`message-queue: ${n}/${n} passing`);
