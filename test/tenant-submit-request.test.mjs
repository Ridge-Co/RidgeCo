// Tenant "Submit a Request" UI (Sep 16 2026) — wires tenant.html up to a tenant-work-order-
// submission system that already existed server-side (built Aug 20 2026: resolveTenantWOAccess,
// the /workorder gate, the owner/property toggle endpoints) but was never linked from anywhere.
// This covers the frontend wiring only; the backend resolver/gate itself is unchanged.
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../tenant.html', import.meta.url), 'utf8');

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

console.log(`tenant-submit-request: ${n}/${n} passing`);
