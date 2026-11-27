# Renters-insurance record (queue #136) — Nov 26 2026 — PR #651 into main, head `feat/tenant-renters-insurance-136` (cut from main tip e2654e9), merged: no
## CURRENT
Built by the nightly build runner (nobody to ask; every open question took its default). Phase 1 is the whole brief (1 of 1). A record only: carrier, expiry, optional policy reference and a certificate file on each tenant, admin-only. No requirement, no reminder, nothing texted or emailed (Brett's note on #136 overrides the row's First_Step).
Not verified: staging with TEST- rows, and a real certificate upload/view against Drive (this runner cannot drive the staging Hub UI). Stays open for Brett: the change touches tenant personal data, so the runner never merges it. Test-only staging twin PR: none opened.

## Pre-build gate
Shapes: `record` `ui` `endpoint` `write` `external` (Drive file). Nobody was available to ask, so every item took its default or the safer option.

Items that are N (known gaps):
- B2 Correct after it was sent or signed: n/a, nothing is sent or signed.
- B4 Reorder by hand: N, not a list.
- B9 Who hears about it: nobody, by design (Brett: "Do not remind tenant").
- B15 History: partly. Every change writes an Ops_Telemetry row `tenant_insurance_change` (old -> new carrier and expiry, "policy ref changed", certificate added or removed; who and when are also on the tenant row). The policy reference itself is never logged. No separate history tab.
- B20 Voice dictation: N. Phone keyboard microphone works in the text boxes.
- B21 Photos: one certificate per tenant; a new upload replaces the link, the old Drive file stays (permanence). Remove clears the link only.
- B26 Spanish: N. Admin-only screen.
- B27 Where else will he look: N. Tenants page tag and filter only; not on Command Center or Needs Attention.
- B31 Settings, not constants: N for the 10 MB cap. The reserved Config keys `Renters_Ins_Required` and `Renters_Ins_Reminders_Enabled` are documented but read by nothing.

Defaults taken: no backfill (blank = none on file); no "no insurance" tag (noise); expiry is date-only and compared as a plain date string; certificate types are JPG, PNG, WebP, HEIC and PDF only; max 10 MB; private folder `_Internal — Tenant Insurance` under the properties root, never shared anyone-with-link.

Companion actions included: edit after create (B1); remove and restore (B5: link cleared, file kept); filter on the Tenants page (B28); loading, error and success states on every call (B32); phone first, 16px inputs, real button plus hidden sibling file input, no `capture=` (B33); C2 no cron; C3 every failure logs and returns; C4 writes use `updateRowVerified` (read-back); C6 nothing money; C7 admin-only, absent from `enrichWO`, `tenantSessionFields`, `ownerRosterList`; C11 blank-safe; C17 `ensureColumns`, never `ensureTab`.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261126-tenant-renters-insurance-136]** Renters-insurance record on Tenants (queue #136). Regression rules:
1. Six additive Tenants columns (`TENANT_INSURANCE_COLS`) added with `ensureColumns`; blank on every existing tenant.
2. Only `Renters_Ins_Carrier`, `_Expiry`, `_Policy_Ref` are caller-editable (through `/tenant/update`); `_Cert_File_ID`, `_Updated_At`, `_Updated_By` are server-stamped and refused from a caller.
3. `/tenant/insurance-cert` (POST upload / remove, GET view) is admin-only: in no `ROLE_SCOPES` list and not public; the viewer returns 404 to any role session. Files are never shared anyone-with-link.
4. These columns must never appear in a vendor, tenant or owner response. Do not add them to `enrichWO`, `tenantSessionFields` or `ownerRosterList`; `test/tenant-insurance.test.mjs` pins it.
5. A requirement or reminder is a later, separate row. Nothing may text or email a tenant about insurance without one.
