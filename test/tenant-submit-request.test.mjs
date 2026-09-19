// Tenant "Submit a Request" UI (Sep 16 2026) — wires tenant.html up to a tenant-work-order-
// submission system that already existed server-side (built Aug 20 2026: resolveTenantWOAccess,
// the /workorder gate, the owner/property toggle endpoints) but was never linked from anywhere.
// This covers the frontend wiring only; the backend resolver/gate itself is unchanged.
//
// Session-identity hardening (Sep 16 2026, TENANT_WO_SETTINGS_UI_AND_HARDENING_BUILD_BRIEF_v1.0
// Part A): the /workorder tenant gate used to trust body.property_id/unit_id/tenant_id as sent
// by the client. Added below: the gate now resolves the tenant's REAL record from their own
// verified session id and overwrites those three fields before anything else runs, so a valid
// tenant session can't be used to submit a WO tagged to a different property/unit/tenant.
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../tenant.html', import.meta.url), 'utf8');
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

{
  ok(html.includes("data.can_submit_wo ? '' : 'none'"), 'the new-request button visibility is driven by the server-resolved can_submit_wo flag from /tenant-by-pin, not a client-side guess');
  ok(html.includes("document.getElementById('newRequestBtn').style.display = 'none'"), 'the button is explicitly hidden again on logout, so a second tenant sharing the device never sees a stale state');
}
{
  const submitFn = html.slice(html.indexOf('function submitNewRequest'));
  ok(submitFn.includes("type: 'tenant'"), 'submissions are tagged type:tenant, which is what the existing server-side gate and the owner_job_received auto-notify both key off');
  ok(submitFn.includes('session.property_id') && submitFn.includes('session.unit_id') && submitFn.includes('session.tenant_id'), 'the request is always submitted against the logged-in tenant\'s OWN property/unit/tenant id from their session, never a client-editable field');
  ok(submitFn.includes("api('/workorder'"), 'reuses the existing /workorder endpoint rather than introducing a parallel submission path');
}
{
  ok(html.includes('id="modalSubmitRequest"'), 'a submit-request modal exists');
  ok(html.includes("res.error"), 'a server-side rejection (e.g. the toggle turned off mid-session) surfaces the real error text to the tenant, not a generic failure');
}

{
  ok(wsrc.includes('let callerSessionId = null;'), 'the verified session id is hoisted out to route-dispatch scope, mirroring the existing callerRole pattern');
  ok(wsrc.includes('callerSessionId = _session.id;'), 'callerSessionId is set from the verified session payload, not from anything client-supplied');
}
{
  const gate = grab(wsrc, "if (path === '/workorder') {");
  ok(gate.includes("callerRole === 'tenant'"), "the gate still branches on the verified role, not a client-supplied one");
  const tenantBranch = gate.slice(gate.indexOf("callerRole === 'tenant'"));
  ok(tenantBranch.indexOf("t.ID === callerSessionId") < tenantBranch.indexOf('resolveTenantSubmitAccess('),
    'the tenant record is looked up by the SESSION id before the access check runs, not by anything the client sent');
  ok(tenantBranch.indexOf('body.tenant_id   = _tenant.ID') < tenantBranch.indexOf('resolveTenantSubmitAccess('),
    'body.tenant_id is overwritten from the resolved tenant record before createWorkOrder ever sees it');
  ok(tenantBranch.indexOf('body.property_id = _tenant.Property_ID') < tenantBranch.indexOf('resolveTenantSubmitAccess('),
    'body.property_id is overwritten from the resolved tenant record before the access check, so a spoofed property_id can never even reach resolveTenantSubmitAccess');
  ok(tenantBranch.indexOf('body.unit_id     = _tenant.Unit_ID') < tenantBranch.indexOf('resolveTenantSubmitAccess('),
    'body.unit_id is overwritten the same way as property_id/tenant_id');
  ok(tenantBranch.includes('if (!_tenant) return json('), 'a session id that no longer matches an active tenant is rejected outright, not silently allowed through with blank fields');
}
{
  // Non-tenant callers (admin secret, owner sessions creating a WO on a tenant's behalf) must
  // be completely unaffected — this hardening is scoped strictly to callerRole === 'tenant'.
  const gate = grab(wsrc, "if (path === '/workorder') {");
  const beforeTenantBranch = gate.slice(0, gate.indexOf("if (callerRole === 'tenant')"));
  ok(!beforeTenantBranch.includes('createWorkOrder(env, body)'), 'createWorkOrder is only ever invoked once, after the (conditional) tenant branch — not duplicated per-role');
  // Sep 19 2026 (Ops_Build_Queue #14): the dispatch now routes through callWithFailureAlert so
  // an exception gets logged + optionally alerted — createWorkOrder(env, body) itself is still
  // called with the caller's own (possibly tenant-overwritten) body, untouched by the wrapper.
  ok(gate.includes("callWithFailureAlert(env, 'wo_create', '/workorder', () => createWorkOrder(env, body));"),
    'admin/owner callers still fall straight through to createWorkOrder (now wrapped for failure alerting) with their own body untouched');
}

console.log(`tenant-submit-request: ${n}/${n} passing`);
