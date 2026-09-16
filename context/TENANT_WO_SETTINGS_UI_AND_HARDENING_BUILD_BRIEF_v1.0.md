# Tenant-WO Settings UI + Session Hardening — Build Brief v1.0
**Captured:** Sep 16, 2026, end of the same-day session that shipped the 3-part owner-managed-WO
access-control build (`Managed_By` toggle, tenant-submit-request, held-WO tenant display — see
FEATURE_LOG `[FL-20260916-1950-m4]` / `[FL-20260916-2135-r4]` / `[FL-20260916-2145-w2]` and
CURRENT.md's "all 3 parts shipped" section for full context on what's already live).

**Why this is a separate brief, not just left in that session's own docs:** both items below were
identified and explicitly deferred mid-build to keep that session's scope disciplined — this hands
them to a fresh session with everything already researched, so nothing gets re-discovered (or
worse, silently forgotten the way the Aug 20 tenant-submission backend was until today).

Two independent pieces. Either can be built first; neither depends on the other.

---

## Part A — Harden the tenant-submission session-identity check

### The gap, precisely
`POST /workorder`'s tenant gate (worker.js, router, ≈line 289-293):
```js
if (path === '/workorder') {
  if (callerRole === 'tenant') {
    const _allowed = await resolveTenantSubmitAccess(env, body.property_id, body.unit_id);
    if (!_allowed) return json({ error: '...', tenant_wo_disabled: true }, 403);
  }
  return await createWorkOrder(env, body);
}
```
This confirms the *property* allows tenant submission. It does **not** confirm the calling tenant's
session actually belongs to that property/unit/tenant_id — `body.property_id`, `body.unit_id`, and
`body.tenant_id` are all self-reported by the client. A tenant with a valid, currently-logged-in
session token could submit a WO tagged to a different property or a different tenant_id than their
own (e.g. spam another property's queue, or misattribute a request).

**This is pre-existing** — part of the Aug 20 2026 build, not introduced by today's session. Narrow
real-world risk today (tenant-submit is only live for one owner, Goldszmidt), but worth closing
before wider rollout.

### The fix
The session's verified identity is available at auth-gate time but currently only partially
hoisted out to where the route dispatch runs:

```js
let callerRole = null;          // worker.js ≈line 46 — already hoisted, already used at the gate
```
```js
callerRole = _session.role;     // worker.js ≈line 146 — set inside the auth block
```
```js
if (callerRole === 'tenant') {  // worker.js ≈line 291 — the /workorder gate itself
```

Mirror this exact pattern for the tenant's own verified ID:
1. Add `let callerSessionId = null;` right next to the existing `let callerRole = null;` (≈line 46).
2. Add `callerSessionId = _session.id;` right next to `callerRole = _session.role;` (≈line 146).
3. In the `/workorder` gate, once `callerRole === 'tenant'` is confirmed, look up the real Tenant
   record for `callerSessionId` and verify it actually matches `body.property_id`/`body.unit_id` —
   same shape as the check `ownerUpdateWO` already does for `owner_id`
   (`if (!prop || String(prop.Owner_ID) !== String(body.owner_id)) return json({ error: 'Unauthorized' }, 403);`).

**Cleaner alternative, worth considering instead of just cross-checking:** for a tenant-role call,
don't trust `body.tenant_id` at all — overwrite it with `callerSessionId` before calling
`createWorkOrder`, and derive `property_id`/`unit_id` from the tenant's own real record rather than
trusting the client's copy of them. This removes the spoofing vector entirely rather than just
detecting it, and it's a smaller code change (one field overwrite vs. a full cross-check + 403
path). Recommend this approach unless there's a real reason the client-sent property_id/unit_id
needs to be independently trusted (there doesn't appear to be one — `tenant.html`'s `session`
object is exactly this same data, already server-issued at login).

### Scope boundaries
- Backend-only. `tenant.html` already only ever sends the logged-in tenant's own session fields —
  no frontend change needed either way.
- Scope strictly to `callerRole === 'tenant'`. Do not touch the `type:'owner'` path (`owner.html`'s
  own submit-request flow, already working, already trusted at the `ROLE_SCOPES.owner` level) or
  the admin/scope-estimate callers of `createWorkOrder`.

### Testing
- Extend `test/tenant-submit-request.test.mjs` (or add a new file) with a structural assertion that
  the gate resolves the tenant/property/unit match off the verified session id, not just off
  `body.property_id`/`body.unit_id` in isolation.
- Live check once deployed: log in to `tenant.html` as a real tenant, use browser dev tools to
  replay the `/workorder` POST with a different `property_id`, confirm it's rejected.

---

## Part B — Hub (index.html) UI for the tenant-WO settings + held-WO admin control

### What already exists — confirmed today, don't rebuild any of it
| Piece | Where | Status |
|---|---|---|
| Owner→property→unit permission hierarchy, resolved server-side | `resolveTenantWOAccess` / `resolveTenantSubmitAccess`, worker.js ≈3170-3192 | Built Aug 20, live |
| One-shot settings-page data source — every owner + every property, with resolved effective state per property and per unit | `GET /tenant-wo-settings` → `tenantWOSettingsSummary`, worker.js ≈3215 | Built Aug 20, **never consumed by any page** |
| Set an owner's toggle (+ optional property scoping) | `POST /owner/tenant-wo-toggle` → `setOwnerTenantWOToggle` | Built Aug 20, live (used directly via API today for Goldszmidt) |
| Set a property's toggle (+ optional unit scoping) | `POST /property/tenant-wo-toggle` → `setPropertyTenantWOToggle` | Built Aug 20, live, unused by any Hub page |
| Set the per-owner held-WO contact note | `POST /owner/held-contact-note` → `setOwnerHeldContactNote` | Built today, live, unused by any Hub page |
| Set `Work_Orders.Managed_By` from the **admin** side | `POST /wo/admin-update` → `adminUpdateWO` | **Already works with zero backend change** — `adminUpdateWO` takes arbitrary `body.fields`, no allow-list (unlike the owner-side path, which is deliberately restricted to `OWNER_EDITABLE_FIELDS`). Confirmed by reading the function directly today. The only missing piece is a UI affordance — Brett currently has no way to see or set `Managed_By` from his own Hub, only via the `owner.html` toggle (owner-initiated) or a raw API call. |

**Net effect: this is a pure frontend build.** Every endpoint it needs already exists and is
already correct — confirmed by reading each one, not assumed.

### What's needed
1. **A settings view** listing every owner (name, current toggle ON/OFF/blank, scoped property
   IDs if any) and every property (address, resolved effective state, whether that's inherited
   from the owner or an explicit override, per-unit breakdown) — sourced entirely from
   `GET /tenant-wo-settings` in one call, matching the shape `tenantWOSettingsSummary` already
   returns (`{ owners: [...], properties: [...] }`, each property row already carries
   `whole_property_enabled` and a `units[]` array with per-unit `enabled`).
2. **Inline editing** on both lists — toggle ON/OFF, edit the scoped-IDs list — calling
   `POST /owner/tenant-wo-toggle` / `POST /property/tenant-wo-toggle` respectively.
3. **A held-contact-note field**, editable per owner — either folded into the same settings view
   or added to the existing Owner edit modal — calling `POST /owner/held-contact-note`.
4. **`Managed_By` visibility + control on the admin WO detail modal** (`openWODetail`) — a small
   addition mirroring the pattern already built in `owner.html` today (current state + a toggle
   button), calling the existing `/wo/admin-update` with `fields: { Managed_By: 'Owner'|'RidgeCo' }`.
   This lets Brett flag a WO as owner-managed on his own initiative, not only reactively when an
   owner does it themselves via their own portal.

### Open design questions — confirm with Brett before building, don't guess
1. **Standalone page/tab, or folded into the existing Owners and Properties pages?** index.html is
   large (12,000+ lines as of today) with an established pattern for lazy-loaded pages (Review
   Bills, Send to QB). A dedicated "Tenant Portal Settings" page matching that pattern is the
   likely right shape given the amount of content (two full lists + per-unit drill-down), but
   confirm rather than assume.
2. **Should the admin-side `Managed_By` toggle prompt a confirm dialog the same way `owner.html`'s
   does** ("Ridge Co won't assign a vendor while it's set this way...")? Recommend yes, for
   consistency, but confirm.
3. **Any additional safeguard wanted when an admin (not the owner) sets `Managed_By`** — e.g.
   should Brett flagging a WO as owner-managed himself notify the owner, the way a tenant
   submission auto-notifies the owner? Not built today in either direction; worth asking whether
   it's wanted here too, or whether admin-initiated is meant to stay a quiet internal flag.

### Suggested build order
1. Reconnaissance first: read the existing Owners page and Properties page rendering functions in
   index.html to find the established row/modal/edit patterns before writing anything new —
   matches this project's own verify-before-build convention, and index.html is large enough that
   guessing at its structure risks a real mistake in the highest-traffic file in the codebase.
2. Settings view (owner + property lists, inline toggles, held-contact-note field) — the bulk of
   the new surface area, but pure UI against already-correct, already-tested endpoints.
3. `Managed_By` on the WO detail modal — small, isolated, no backend change.

### Testing
- Structural tests matching this project's established convention (grab the relevant render/save
  function's source, assert on key strings/behavior) — see
  `test/tenant-held-display.test.mjs` or `test/managed-by.test.mjs` from today's session for the
  exact style to match.
- `node --check` on every index.html inline `<script>` block touched.
- Full suite (`node --test test/*.test.mjs`) — should stay at whatever the count is when this
  session starts (76 as of this writing) plus whatever new test files this build adds, zero
  regressions.
- Live pass: open the new settings view, confirm it matches the actual live Goldszmidt-ON /
  everyone-else-OFF state; flip a toggle and confirm `GET /tenant-wo-settings` reflects it; set
  `Managed_By` from the admin modal and confirm `owner.html` shows the same state back.

---

## Standing notes for whichever session picks this up
- **The PAT pasted into chat during today's session (prefix `ghp_DORX...`) should be
  treated as compromised/rotated by now** — it was used 5+ times across this one session
  specifically because it was pasted into chat, which is itself the standing reason it needs
  rotating. Do not reuse it and never write its full value into any file, commit, or doc — this
  brief deliberately doesn't repeat it beyond the prefix. For anything requiring a push beyond what
  GH Broker's `commit_file` can handle directly (full-file pushes over roughly 100-200KB —
  `worker.js` is ~990KB and needs the diff-and-patch approach, or a fresh PAT if Brett provides and
  directs one), fall back to the patch-file hand-off via claude.ai/code, or ask Brett directly
  rather than assuming a stale token still works.
- **`origin/main` moves fast** — at least 3 other concurrent/background sessions touched
  `CURRENT.md`/`BACKLOG.md`/`FEATURE_LOG.md` during today's single session alone. Always
  `git fetch origin main` and re-verify a diff applies clean immediately before pushing, not just
  once at the start of the session.
- Today's session left `worker.js` at `BUILD_VERSION '2026-09-16.4'` — confirm the live `/version`
  matches before assuming your own starting state is current.
