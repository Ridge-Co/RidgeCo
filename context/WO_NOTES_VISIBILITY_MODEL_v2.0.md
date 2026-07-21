# Work Order Notes & Visibility Model v2.0 (B-127, was B-104)

**Decided by Brett, July 21, 2026.** Supersedes v1.0. Build on `staging` alongside B-103. **The visibility matrix is a hard contract — a private note reaching an owner or tenant is a defect, not a cosmetic bug.**

> **v2.0 changes vs v1.0:** the old single shared "Notes" thread is REMOVED (it leaked to owner+tenant). Replaced by role-scoped fields. Added **Owner_Notes**. Owner sees vendor **name only** (assumption resolved). Legacy `Notes` content preserved admin-only.

---

## Two guarantees that override everything
1. **Admin (Brett) sees EVERYTHING, always** — every field, every note, every WO.
2. **No private note ever reaches an owner/tenant surface** — owner portal, tenant portal, owner/tenant SMS, the QB invoice, or a WO PDF sent to an owner. Enforce server-side in `enrichWO`, never by client-side hiding.

---

## The five note fields

| Field | Purpose | Who WRITES | Who SEES |
|---|---|---|---|
| **Entry_Notes** | Access + scheduling ("lockbox is red" / "call owner 24h ahead"). **APPEND-ONLY, multi-source, attributed** — never overwrite; keeps every source. Auto-appended from Buildium owner/tenant entry info (B-103), tagged `[Owner/Buildium]`. | Admin; auto from intake | Admin, Vendor |
| **Owner_Notes** | Private notes **from the owner** (their requests / context). | Owner, Admin | Admin, Vendor, **Owner (their own)** — **NOT tenant** |
| **Vendor↔Admin Notes** | The private admin↔vendor thread. Both write, each line stamped `[ts — author]`. Admin's private instructions to the vendor AND the vendor's notes back. | Admin, Vendor | Admin, Vendor only |
| **Admin_Notes** | Admin-only private scratch (markup thoughts, reminders). | Admin | Admin ONLY |
| **Hold_Reason** | Plain-language why a WO is on hold. The ONE note type that is intentionally customer-facing. | Admin | Admin, Vendor, Owner, Tenant |

---

## Visibility matrix (hard contract)

| Item | Admin | Vendor | Owner | Tenant |
|---|:--:|:--:|:--:|:--:|
| Job description / problem | ✓ | ✓ | ✓ | ✓ |
| Status + schedule | ✓ | ✓ | ✓ | ✓ |
| **Hold_Reason** | ✓ | ✓ | ✓ | ✓ |
| Vendor **name** | ✓ | ✓ | ✓ | ✓ |
| Vendor **phone** | ✓ | ✓ | ✗ | ✓ |
| Tenant name + phone | ✓ | ✓ | ✗ | n/a |
| **Entry_Notes** | ✓ | ✓ | ✗ | ✗ |
| **Owner_Notes** | ✓ | ✓ | ✓ own | ✗ |
| **Vendor↔Admin Notes** | ✓ | ✓ | ✗ | ✗ |
| **Admin_Notes** | ✓ | ✗ | ✗ | ✗ |
| Vendor cost / markup / financials | ✓ | ✗ | final invoice only | ✗ |

Owner sees the vendor's **name only, never the phone** (protects Brett's GC position). Tenant sees vendor name **and** phone (they coordinate access). Owner sees status/schedule/hold-reason + their own Owner_Notes — nothing else private.

---

## Legacy `Notes` field — migration (also closes a LIVE leak)

The current `Notes` column is rendered verbatim to owners (`owner.html`) AND tenants (`tenant.html`) today, while the admin form mislabels it "Internal notes…". So anything Brett typed there as "internal" is already visible on the live portals.

1. **Immediately stop rendering `Notes` in `owner.html` and `tenant.html`.** This closes the live exposure the moment it deploys to main.
2. **Preserve the `Notes` column as an admin-only archive** (read-only, admin view only) so history isn't lost and nothing private is re-exposed. Do NOT auto-migrate its mixed content into the new fields — it blends owner posts and admin notes and can't be split safely. Brett reclassifies manually if he wants.
3. Stop writing to `Notes` going forward; route new writes to the correct role-scoped field above (owner portal posts → `Owner_Notes`).

---

## Implementation checklist (worker.js + portals)

**Schema (sheet-op against STAGING first, then live at merge):** add `Entry_Notes`, `Owner_Notes`, `Vendor_Admin_Notes`, `Admin_Notes`, `Hold_Reason` to `Work_Orders`. Additive columns only — never shift existing indexes; match WO by the `ID` header, never `r[0]` (FEATURE_LOG rule 6).

**Append semantics:** reuse the `appendWONotes` `[ts — author]` pattern for `Entry_Notes`, `Owner_Notes`, and `Vendor_Admin_Notes` — read, append an attributed line, write back. Never overwrite. Never write a blank line.

**Endpoints (role-scoped writes):**
- Vendor → `Vendor_Admin_Notes`: `POST /workorder/vendor-note` (role=vendor).
- Owner → `Owner_Notes`: owner-portal post re-points here (was writing to `Notes`).
- Admin → any field, plus set `Admin_Notes` and `Hold_Reason`.
- Status update: moving to an on-hold state captures/requires `Hold_Reason`.

**View enforcement — do it in `enrichWO`, server-side, so private notes never leave the Worker:**
- **Vendor view:** Entry_Notes, Owner_Notes, Vendor↔Admin Notes, Hold_Reason, tenant contact, vendor self. Exclude Admin_Notes, financials.
- **Tenant view (`tenantView`):** status/schedule, vendor name **+ phone**, Hold_Reason. Exclude Entry_Notes, Owner_Notes, Vendor↔Admin Notes, Admin_Notes, legacy Notes, financials. (Change current behavior that stripped vendor phone — now show it.)
- **Owner view (`ownerView`):** status/schedule, Hold_Reason, their own Owner_Notes, vendor **name only**. Exclude vendor phone, Entry_Notes, Vendor↔Admin Notes, Admin_Notes, legacy Notes, vendor cost/markup (Invoice_ID already stripped).
- **WO PDF / any owner export:** build strictly from the owner-view field set. Add a regression test asserting no owner/tenant payload or PDF contains `Entry_Notes`, `Vendor_Admin_Notes`, or `Admin_Notes`.

**Frontend:** relabel/rework the admin Notes box into the new sections; remove the `Notes` render blocks from `owner.html` (line ~659) and `tenant.html` (line ~391).

---

## Ties to B-103
Intake's entry info lands in **`Entry_Notes`** (append, tagged `[Owner/Buildium]`). Build the fields first, then B-103's parser writes there. The Buildium header-leak fix already shipped (commit 97d4509).
