# Work Order Notes & Visibility Model v1.0 (B-127, was B-104)

**Decided by Brett, July 21, 2026.** Build on the `staging` branch alongside B-103 (intake populates several of these fields). **Nothing here may leak a private note to an owner or tenant — treat the visibility matrix as a hard contract, not a guideline.**

---

## The two guarantees that matter most
1. **Admin (Brett) sees EVERYTHING, always** — every field, every note, every work order. No note type is ever hidden from admin.
2. **No private note ever reaches an owner/tenant surface** — not the owner portal, tenant portal, owner/tenant SMS, the QB invoice, or a work-order PDF sent to an owner.

---

## Field types on a Work Order

| Field | What it's for | Write | Read |
|---|---|---|---|
| **Entry_Notes** | Access + scheduling ("lockbox is red", "call owner 24h ahead"). **APPEND-ONLY, multi-source** — never overwrite; each source's text is kept and attributed. Populated by admin AND auto-appended from Buildium's owner/tenant entry info (B-103). | Admin; auto-append from intake | Admin, Vendor |
| **Vendor_Thread** | The shared private channel. Both admin and vendor write to it; every line is stamped `[timestamp — author]`. This is where admin leaves private instructions to the vendor ("don't quote price to the tenant") AND where the vendor leaves notes back ("replaced flapper, needs fill valve"). | Admin, Vendor | Admin (always), Vendor |
| **Admin_Notes** | Admin-only private scratch (markup thoughts, reminders). This is the existing "Internal notes" box — it becomes strictly admin-only. | Admin | Admin ONLY |
| **Hold_Reason** | Plain-language reason a WO is on hold, written to be safe for tenant/owner eyes ("waiting on a part, ETA Friday"). Surfaced whenever the WO is in an on-hold state. NOT a private note — this one IS owner/tenant-facing on purpose. | Admin (or vendor via thread → admin promotes) | Admin, Vendor, Owner, Tenant |

**Migration note:** intake (B-103) currently writes entry/pet info into `Notes`. Re-point it to **`Entry_Notes`** (append, attributed `[Owner/Buildium]`). Keep the job `Description` clean — problem + tenant notes only.

---

## Visibility matrix (hard contract)

| Item | Admin | Vendor | Owner | Tenant |
|---|:--:|:--:|:--:|:--:|
| Job description / problem | ✓ | ✓ | ✓ | ✓ |
| Status + schedule / schedule status | ✓ | ✓ | ✓ | ✓ |
| **Hold_Reason** | ✓ | ✓ | ✓ | ✓ |
| Vendor name | ✓ | ✓ | ✗ | ✓ |
| Vendor phone | ✓ | ✓ | ✗ | ✓ |
| Tenant name + phone | ✓ | ✓ | ✗ | n/a |
| **Entry_Notes** | ✓ | ✓ | ✗ | ✗ |
| **Vendor_Thread** | ✓ | ✓ | ✗ | ✗ |
| **Admin_Notes** | ✓ | ✗ | ✗ | ✗ |
| Vendor cost / markup / financials | ✓ | ✗ | final invoice only | ✗ |

> **⚠️ OPEN ASSUMPTION (confirm before shipping):** Owner is set to **NOT** see the vendor's name/phone — protects Brett's GC position + markup (owner can't go around him to the sub). Flip only if Brett says so.

**Tenant** now sees the assigned vendor's **name + phone**, schedule/status, and the hold reason (changed from the old behavior where tenant vendor-phone was stripped). **Owner** sees status/schedule + hold reason only — no vendor identity, no notes, no financials until the final marked-up invoice.

---

## Implementation checklist (worker.js + portals)

**Schema (sheet-op against STAGING sheet first):** add `Entry_Notes`, `Vendor_Thread`, `Hold_Reason` columns to `Work_Orders`. Repurpose existing `Notes` → `Admin_Notes` (or keep `Notes` as the admin-only field and just relabel in the UI). Additive columns only — no existing index shifts (FEATURE_LOG rule 6: match WO by the `ID` header, never `r[0]`).

**Append semantics:** reuse the `appendWONotes` pattern (worker.js ~666: `[ts — author] text`) for BOTH `Entry_Notes` and `Vendor_Thread` — read current value, append a new attributed line, write back. Never overwrite.

**Endpoints:**
- Vendor adds to the thread: `POST /workorder/vendor-note` (role=vendor) → appends to `Vendor_Thread`, attributed to the vendor.
- Admin note endpoints: allow admin to append to `Entry_Notes`, `Vendor_Thread`, and set `Admin_Notes` / `Hold_Reason`.
- Status update: when moving to an on-hold state, capture/require `Hold_Reason`.

**View enforcement (the leak-prevention layer — do this in `enrichWO`, server-side, never client-side hiding):**
- `vendorWorkorders`/vendor view: include `Entry_Notes`, `Vendor_Thread`, `Hold_Reason`, tenant contact. **Exclude** `Admin_Notes`, all financials/markup.
- `tenantWorkorders`/tenantView: include status/schedule, vendor name+phone, `Hold_Reason`. **Exclude** `Entry_Notes`, `Vendor_Thread`, `Admin_Notes`, owner input, financials. (Change current `tenantView` which strips vendor phone — now show it.)
- `ownerWorkorders`/ownerView: include status/schedule, `Hold_Reason`. **Exclude** vendor name/phone (per assumption), `Entry_Notes`, `Vendor_Thread`, `Admin_Notes`, vendor cost/markup (`Invoice_ID` already stripped).
- **WO PDF / any owner export:** build strictly from the owner-view field set — job description, status, schedule, hold reason. Never include any notes field. Add a regression test asserting the PDF/owner payload contains none of `Entry_Notes`/`Vendor_Thread`/`Admin_Notes`.

**Server-side is the source of truth:** every exclusion happens in the enrich/serialize layer on the Worker, so a private note is never sent to the browser in the first place — never rely on the frontend to hide it.

---

## Ties to B-103
Intake's entry-info routing (the "Contact and scheduling information" parser fix) lands in **`Entry_Notes`**, appended and attributed `[Owner/Buildium]`. So build B-127's `Entry_Notes` field first, then point the B-103 parser at it. The Buildium section-header leak fix (add the missing headers to `BUILDIUM_LABELS`) ships in the same pass.
