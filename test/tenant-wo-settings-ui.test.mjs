// Tenant WO settings UI + admin Managed_By control (Part B,
// TENANT_WO_SETTINGS_UI_AND_HARDENING_BUILD_BRIEF_v1.0, Sep 16 2026). Per Brett's answers this
// session: folded into the existing Owners/Properties edit modals (no standalone settings
// page); the admin-side Managed_By toggle shows the same confirm-dialog weight owner.html's
// does; Brett flagging a WO as owner-managed notifies the owner (covered on the worker.js side
// by test/managed-by.test.mjs — this file covers the index.html frontend only).
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function grabFn(name) {
  const sig = 'function ' + name + '(';
  const start = html.indexOf(sig);
  if (start < 0) throw new Error('missing ' + name);
  const open = html.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (!depth) break; } }
  return html.slice(start, i + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── Every endpoint this build needs already exists and is already correct (confirmed by
// reading each one directly in the build brief) — this is a pure frontend build, so these
// tests check that the frontend actually calls them, not that they work.

// ── Edit Owner modal ──
{
  ok(html.includes('id="eo-two-toggle"'), 'the owner-level tenant-WO toggle select exists in the Edit Owner modal');
  ok(html.includes('id="eo-two-propids"'), 'the owner-level scoped-property-IDs field exists');
  ok(html.includes('id="eo-held-note"'), 'the held-contact-note field exists in the same modal, per folding it in rather than a standalone page');
}
{
  const fn = grabFn('openEditOwnerModal');
  ok(fn.includes("o.Tenant_WO_Toggle==='ON'||o.Tenant_WO_Toggle==='OFF' ? o.Tenant_WO_Toggle : ''"), 'the toggle is populated from the real Owner row, defaulting to blank (not-set) rather than guessing ON/OFF');
  ok(fn.includes('o.Tenant_WO_Property_IDs'), 'scoped property IDs are populated from the real Owner row');
  ok(fn.includes('o.Held_Contact_Note'), 'the held-contact note is populated from the real Owner row');
  ok(fn.includes('loadTenantWOSettings(true)'), 'opening the modal refreshes the resolved-effective-state cache rather than showing a stale read');
}
{
  const fn = grabFn('submitEditOwner');
  ok(fn.includes("api('POST','/owner/update'"), 'the base owner fields still save through the existing generic endpoint');
  ok(fn.includes("api('POST','/owner/tenant-wo-toggle'"), 'the toggle saves through its OWN dedicated endpoint (which ensureColumns first), not folded into the generic /owner/update fields');
  ok(fn.includes("api('POST','/owner/held-contact-note'"), 'the held-contact note saves through its own dedicated endpoint too');
  ok(fn.includes('Promise.all(['), 'all three saves fire together on one Save click, not three separate buttons');
}

// ── Edit Property modal ──
{
  ok(html.includes('id="ep-two-toggle"'), 'the property-level tenant-WO toggle select exists in the Edit Property modal');
  ok(html.includes('id="ep-two-units-scope"'), 'a unit-scoping area exists for multi/condo properties');
}
{
  const fn = grabFn('epTypeChanged');
  ok(fn.includes("document.getElementById('ep-two-units-scope').style.display = isMulti ? 'block' : 'none'"),
    'the unit-scoping area shows/hides together with the existing Units section — single-family properties never see a unit picker they have no units for');
}
{
  const fn = grabFn('openEditPropertyModal');
  ok(fn.includes("p.Tenant_WO_Toggle==='ON'||p.Tenant_WO_Toggle==='OFF' ? p.Tenant_WO_Toggle : ''"), 'the property toggle is populated from the real Property row');
  ok(fn.includes('renderEpTwoUnitsScope'), 'the unit-scoping checkboxes are rendered from the real Property row on open');
}
{
  const fn = grabFn('submitEditProperty');
  ok(fn.includes("api('POST','/property/update'"), 'the base property fields still save through the existing endpoint');
  ok(fn.includes("api('POST','/property/tenant-wo-toggle'"), 'the toggle saves through its own dedicated endpoint — propertyUpdate\'s own ensureColumns only covers Source_* fields, not this one');
  ok(fn.includes('.ep-two-unit-check:checked'), 'the scoped unit list is read from the actually-checked boxes, not assumed');
}

// ── WO detail — admin Managed_By control ──
{
  const fn = grabFn('openWODetail');
  ok(fn.includes("WHO\\'S HANDLING THIS JOB"), 'the WO detail modal shows a dedicated section for who is handling the job, mirroring owner.html\'s own wording');
  ok(fn.includes('adminToggleManagedBy'), 'a control to change it is wired in');
  ok(fn.includes("wo.Managed_By === 'Owner'"), 'the section branches on the real Managed_By value, not a guess');
}
{
  const fn = grabFn('adminToggleManagedBy');
  ok(fn.includes('confirm('), 'per Brett\'s answer, the admin-side toggle shows a confirm dialog matching the weight of owner.html\'s own toggleManagedBy');
  ok(fn.includes('will get a text'), 'the confirm message itself sets the expectation that the owner will be notified, matching Brett\'s "notify owner" answer, rather than that being a silent side effect');
  ok(fn.includes("api('POST','/wo/admin-update'"), 'the change goes through the existing generic admin-update endpoint (backend validation/notify logic covered separately in managed-by.test.mjs)');
  ok(fn.includes('fields: { Managed_By: newVal }'), 'only Managed_By is sent — this control never touches any other WO field');
}

console.log(`tenant-wo-settings-ui: ${n}/${n} passing`);
