# Notes System — Build Brief v1.0

**Status:** Data layer SHIPPED Aug 11, 2026 (via sheet-op — the `Notes` tab exists + seeded with note #1). Hub UI + Worker endpoints = NOT built; this brief is the reviewable "act" half. Gated per AUTONOMY_GUARDRAILS (customer-facing Hub deploy → Brett's reviewed gate; do not hot-deploy).

## Why
"Notes system — timestamped contact log, per-note sharing, vendors post-only" has been the biggest outstanding item (CURRENT.md "Still owed"). Brett's Aug 11 ask made the requirement concrete: **a note must be cross-referenceable to a property AND/OR a unit AND/OR a work order (and by extension the owner), whether or not it ties to a WO.** First real record = the 931 St Paul DHCD rodent citation + inspector contact (Notes tab #1). Generalizes B-154 (one-tap contact-log events on a WO).

## Data layer (DONE)
New isolated tab **`Notes`** on RidgeCo Main (`1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4`). ID at col 0 (nextSafeId-compatible). Columns:

`ID, Date, Category, Subject, Body, Property_ID, Property_Address, Unit_ID, Unit_Label, WO_ID, Owner_ID, Vendor_ID, Tenant_ID, Contact_Name, Contact_Phone, Contact_Email, Follow_Up_Date, Status, Author_Role, Shared_With, Source, Created_Date, Active`

Cross-reference = the nullable FK columns (Property_ID / Unit_ID / WO_ID / Owner_ID / Vendor_ID / Tenant_ID). Any subset may be set. `Shared_With` (comma list: owner,tenant,vendor) + `Author_Role` carry the agreed per-note sharing + vendor-post-only policy. `Follow_Up_Date` powers deadline surfacing (e.g., the Aug 31 citation deadline).

## To build (the act — reviewable, gated deploy)
Worker (worker.js), all secret-gated, additive (SAFE endpoint shape but a customer-data Hub deploy → reviewed):
- `GET /notes?property_id=&unit_id=&wo_id=&owner_id=&vendor_id=&tenant_id=&status=` → `fetchTab('Notes')` filtered by whichever FKs are passed (AND-match). Read.
- `POST /note/add` → `addRow('Notes', …)`; stamps Created_Date, Active=TRUE, auto ID. Respects `Author_Role`/`Shared_With`.
- `POST /note/update` → `updateRow('Notes', …)` (status close, edit body, add follow-up). Soft-delete via Active=FALSE.
- Reverse index: add `Notes` row to CODEMAP §5 + the endpoint tables; refresh via ridgeco-map.

index.html (admin Hub):
- **Notes panel** on **Property detail**, **Unit detail**, and **WO detail** — each calls `/notes` with its own id and shows the timestamped log; "+ Add note" writes back with the right FK prefilled. A note added on a unit auto-carries its Property_ID.
- **Cross-reference view**: from any note, its chips (Property / Unit / WO / Owner) deep-link to those screens (reuse the `?page=` deep-link handler).
- **Follow-ups**: notes with a `Follow_Up_Date` ≤ soon surface on the Command Center (e.g., "⏰ 931 St Paul citation — correct by Aug 31").

vendor.html / portals (later, per agreed spec): vendors **post-only** (can add a note to a WO they're on, cannot read others); owner/tenant see only notes whose `Shared_With` includes their role.

## Verify gate (before any push)
`test-verified-builds` (smoke `/notes` filters + `/note/add` read-back) + `ridgeco-validate` (built-vs-this-brief). Money/PII-adjacent (notes can hold contact info) → mandatory reviewed gate; no autonomous deploy.

## Acceptance criteria
1. `GET /notes?property_id=70` returns note #1. `GET /notes?wo_id=WO-1100` returns it too. `GET /notes?unit_id=45` returns it.
2. Adding a note on the 931 St Paul property screen persists and reappears on refresh, cross-referenced to the property.
3. A note tied to a unit also resolves under its property.
4. The Aug 31 citation follow-up surfaces on the Command Center before the deadline.
5. No cost/markup ever rendered (HARD RULE); portals honor Shared_With.
