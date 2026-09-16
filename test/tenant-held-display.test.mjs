// Tenant-facing display for owner-managed ("held") work orders (Sep 16 2026) — a WO an owner
// has claimed as their own (Managed_By='Owner') stays visible to the tenant (per Brett: hiding
// it entirely creates an anxiety-inducing blind spot), grayed out, with the description still
// shown and the owner's own contact info in place of Ridge Co's note box.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../tenant.html', import.meta.url), 'utf8');
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── worker.js: tenantWorkorders resolves the contact note, setOwnerHeldContactNote sets it ──
{
  const twBody = grabAsync('tenantWorkorders');
  ok(twBody.includes("'Owners'"), 'tenantWorkorders now fetches Owners (needed to resolve the held-contact note), not just Properties/Units/Tenants/Keys/Vendors');
  ok(twBody.includes("wo.Managed_By !== 'Owner'"), 'the owner-contact resolution only runs for WOs actually marked Managed_By=Owner, not every WO');
  ok(twBody.includes('owner.Held_Contact_Note'), 'a per-owner custom note is used when one is on file');
  ok(twBody.includes('owner.Phone'), 'falls back to the owner\'s own name+phone when no custom note has been set yet, rather than showing nothing');
}
{
  const setterBody = grabAsync('setOwnerHeldContactNote');
  ok(setterBody.includes("ensureColumns(env, 'Owners', ['Held_Contact_Note']"), 'the new Owners column is ensured before the write, matching the ensureColumns-then-updateRow convention used by setOwnerTenantWOToggle');
}
{
  ok(src.includes("path === '/owner/held-contact-note'"), 'the setter is actually wired into the router');
}

// ── tenant.html: card-level graying + badge, detail-level banner + note-box replacement ──
{
  ok(html.includes("wo.Managed_By === 'Owner'") , 'held state is checked directly off the WO record');
  ok(html.includes('owner-managed'), 'a distinct CSS class is applied to held cards for the grayed-out treatment');
  ok(html.includes('Handled by your landlord'), 'the collapsed card itself carries a visible label, not just an opacity change a tenant could miss');
}
{
  const buildDetailFn = html.slice(html.indexOf('function buildDetail'), html.indexOf('function renderDescription'));
  ok(buildDetailFn.indexOf('HANDLED BY YOUR PROPERTY OWNER') < buildDetailFn.indexOf('DESCRIPTION'), 'the held banner renders before the description, so it\'s the first thing seen on expand');
  ok(buildDetailFn.includes("renderDescription(wo.Description"), 'the description itself is still rendered unconditionally for a held WO -- not suppressed just because Ridge Co isn\'t handling it');
  ok(buildDetailFn.includes('owner_managed_contact'), 'the resolved owner contact text is actually used in the detail view');
  ok(buildDetailFn.indexOf("openNote(") > buildDetailFn.indexOf('isHeld ?'), 'the "+ ADD INFORMATION" button (which would notify Brett) only appears in the non-held branch');
}

console.log(`tenant-held-display: ${n}/${n} passing`);
