# Vendor Standalone Billing + Self-Serve Work Orders — Build Brief v1.0
**Status:** design brief, not yet built. Written from Brett's Sep 24 2026 voice/text description +
clarifying-question answers. Grounded in a fresh read of `worker.js`/`vendor.html`/`index.html`
(see `CODEMAP.md` reverse index for the exact schema/handlers this brief modifies).

## 1. The problem

Two distinct gaps in how vendors interact with the Hub, both raised by Brett in the same
conversation:

**A. Standalone billing (no Work Order).** Sierra Taylor does small recurring things at
1864 Kerns School Rd (tenant treats/sweets, little one-off tasks) that don't rise to the level of
a Work Order — Brett's own words: "we don't need work orders where there's no work being done...
it's a service or material being provided." Today `Vendor_Bills` can only be created against an
existing `Work_Orders.ID` (comment at worker.js:14237: *"A brand-new Vendor_Bills row targets an
existing Work_Orders row (never creates one)"*), and `vendor.html`'s bill modal is only ever opened
from inside a WO's own detail view (`_billWOId` always set from `openBillModal(woId, ...)`). Sierra
needs a way to submit a bill with **no WO at all**, on her own schedule, and have it land in the
same Review Bills queue Brett already works from.

**B. Self-serve Work Order creation.** Separately, some vendors (Alan George doing landscaping) can
be trusted to create their *own* Work Order when Brett calls them and says "go do X" before Brett
has had time to enter it himself — vendor writes the description, is auto-assigned as themselves
(never another vendor), submits it, and it flows into the **normal** WO → assign → bill →
Review Bills pipeline unchanged. This is a different capability from (A): it still produces a real
WO, it just lets the vendor originate it instead of Brett. Eddie Smith should **not** get this
today (he communicates with Brett and Brett enters the WO), but might later if volume outpaces
Brett's own data entry.

These are independent, per-vendor, opt-in permissions — not a single "trusted vendor" flag. Sierra
gets (A) but likely not (B) (no evidence she creates her own jobs); Alan George gets (B) but not
necessarily (A). Both are set with a checkbox on the Vendors page (matching the existing
`In_House` inline-checkbox pattern, worker.js `POST /qb/vendor-in-house` + index.html:3396), each
individually toggleable, plus a bulk-select action for adding several vendors to either permission
at once (reusing the Vendors-page checkbox-selection UI already built for bulk messaging, FL
rules 184-185).

## 2. New Vendors columns

Added via `ensureColumns(env,'Vendors',[...])`, same lazy-provision pattern as `In_House` and the
onboarding columns:

| Column | Type | Meaning |
|---|---|---|
| `Can_Bill_No_WO` | `'TRUE'/'FALSE'` | Sierra-style: can submit a standalone bill with no WO |
| `Can_Create_Own_WO` | `'TRUE'/'FALSE'` | Alan-George-style: can create their own WO, auto-assigned to self |
| `Billing_Property_Access` | comma-separated `Property_ID` list | Properties this vendor can bill against *without* asking (e.g. Sierra → `1864 Kerns School Rd`'s ID) |

Both booleans render as inline checkboxes in the Vendors table (copy `toggleVendorInHouse` →
`toggleVendorCanBillNoWO(id,on)` / `toggleVendorCanCreateOwnWO(id,on)`, each its own narrow
`POST /vendor/set-permission {id, field, value}` or two dedicated endpoints — either is fine,
dedicated is simpler to allow-list). `Billing_Property_Access` gets a small multi-select property
picker in the Edit Vendor modal (reuses the existing Trades checkbox-grid pattern) rather than a
free-text field.

**Bulk action:** the Vendors page's existing bulk-checkbox selection gets two new bulk buttons —
"Enable No-WO Billing for selected" / "Enable Self-Serve WO for selected" — so Brett can flip
several vendors at once, per his ask.

## 3. Standalone billing flow (Sierra's case)

### 3a. Vendor portal entry point
A **persistent "Submit Bill" button**, always visible in `vendor.html`'s main nav (not just inside
a WO), shown only when `session.vendor.Can_Bill_No_WO === 'TRUE'` (vendor session/lookup needs to
carry this flag — today `openBillModal` only receives `woId`/`vendorName`, so the vendor session
payload gains `can_bill_no_wo`/`can_create_own_wo`/`billing_property_access` fields at login,
same place `vendor-by-pin` already returns the vendor row).

### 3b. The no-WO bill modal
New `openStandaloneBillModal()`, separate from `_openBillModalReal` (which stays WO-anchored,
completely unchanged for the existing "respond to a WO with an invoice" flow — Sierra keeps that
too, since Brett said she should act like any other vendor for actual work orders). Fields:

- **Property**: dropdown of `Billing_Property_Access` properties. If Sierra wants to bill against
  a property *not* on her list, a "Request access to another property" link opens a small
  form (pick property from the full active-properties list + optional note) → `POST
  /vendor/request-property-access`. That fires an SMS to Brett's admin phone (reusing `sendSMS`,
  same chokepoint everything else uses) with the vendor name, requested property, and a link
  straight to a new small admin approval view (`GET /vendor-access-requests` /
  `POST /vendor-access-requests/approve {id, scope: 'once'|'ongoing', decision}`). "Once" bills the
  one pending item and doesn't touch `Billing_Property_Access`; "ongoing" also appends the
  property to her standing list. This mirrors the existing estimate-approval and vendor-nudge
  SMS+link pattern already used elsewhere — no new SMS chokepoint needed.
- **Line items** (repeatable, reusing the existing receipt-row UI/JS almost verbatim): each row =
  description + amount + **Payment source** control — defaults to **"I paid, reimburse me"**
  (maps to today's `pay:'reimburse'`) but can be switched to **"Charged to Brett's/company
  card"** (`pay:'account'`) — same two-state field the current receipt rows already have, just
  surfaced with clearer, unmistakable labels per Brett's ask (not a subtle icon toggle — explicit
  radio/label text on each row) since he called this "very clear and unmistakable." Optional
  receipt photo per row, reusing `create-upload-session`/`log-attachment`.
- **Bill-to** (per bill, not per line — Brett's "per-bill choice" answer): a single toggle —
  **"Bill the property owner"** (flows through the normal customer-invoice pipeline, e.g. tenant
  treats that are a chargeable extra) vs **"Ridge Co's own cost"** (books as a Ridge Co
  expense/vendor bill only, no customer invoice — e.g. sweets Brett is footing himself). This one
  flag on the bill (not per-item) keeps the QB-side logic simple; if a future case genuinely needs
  split billing within one submission, Sierra just submits two bills.

### 3c. Backend: `POST /vendor-bill/add-standalone` (new endpoint, distinct from the existing
`/vendor-bill/add` which stays WO-anchored and untouched)
- Requires: `vendor_id`, `property_id` (must be in `Billing_Property_Access` or have an approved
  access grant — server-side re-check, never trust the client), at least one line item, `bill_to`
  (`'owner'|'ridgeco'`).
- Writes a `Vendor_Bills` row with **`WO_ID` blank** (already tolerated — `addVendorBill`'s
  auto-complete step is a no-op when `woKey` is falsy) plus **new columns**:
  `Property_ID`, `Bill_To` (`owner`/`ridgeco`), `Standalone` (`'TRUE'`) — `Property_ID` is the
  missing piece the whole downstream pipeline needs (see §5), since today Property_ID only ever
  arrives via `wo.Property_ID`.
- Receipts/line items go into the existing `Receipts_JSON` field, so the per-item reimburse/
  company-card pay mode and photo attachment work exactly like today's receipt rows — no new
  line-item storage format needed.
- Same duplicate-guard idea as today's dedup check, keyed on vendor+property+total+day.

## 4. Self-serve WO flow (Alan George's case)

### 4a. Vendor portal entry point
A second nav item, **"Create a Job"** (or similar), shown only when
`session.vendor.Can_Create_Own_WO === 'TRUE'`. Opens a cut-down New-WO form: property picker
(scoped the same way — his own `Billing_Property_Access`-style list, or simply "any active
property" if Brett wants no restriction here; **flagged as an open question below**), a
description field, and nothing else — no vendor-assignment picker, since the vendor is always
auto-assigned to themselves.

**Mandatory "who authorized this" attestation (Brett's Sep 24 follow-up, applies to every
`Can_Create_Own_WO` vendor, not just Alan).** The form cannot submit without a required
`Approval_Source` choice, plus a note:
- **Owner requested it** — the property owner asked for this directly.
- **Brett requested it** — Brett called/texted and asked for it, before entering the WO himself.
- **Other** — free-text required (Brett's own examples: the vendor noticed it needed doing and is
  attaching photos for Brett to review after the fact; or an in-person conversation with no text
  trail — the vendor just says so, e.g. "discussed in person 9/24, no text record").
This is the *only* substitute for Brett originating the WO himself — a self-serve WO is never
created with no stated reason. `Approval_Source` (`'owner'|'brett'|'other'`) and `Approval_Note`
(text; required when `'other'`, optional but encouraged otherwise — e.g. "owner Jennifer called
me directly 9/24") are stamped straight onto the new `Work_Orders` row and rendered prominently
(not buried) on the WO card/detail wherever `Created_By_Vendor` shows, so Brett sees the
justification in the same glance as the flag itself.

### 4b. Backend: `POST /workorder/self-serve` (new, thin wrapper around the existing
`createWorkOrder`)
- Calls the existing `createWorkOrder` internals with `Vendor_ID` forced to the calling vendor's
  own id (server-side, never trust a client-supplied vendor id — closes the same class of gap the
  Sep 16 tenant-submission hardening fixed for tenants).
- Requires `Approval_Source` (+ `Approval_Note` when `Approval_Source==='other'`) in the request
  body — 400 without it. Both are hardened server-side same as everything else here (never trust
  a client to have honestly filled a required field client-side only).
- New `Created_By_Vendor: 'TRUE'`, `Approval_Source`, `Approval_Note` columns stamped on the WO so
  it's visibly flagged wherever WOs render (a small badge + the approval line in
  `renderWOPage`/`openWODetail`) — this is the mechanism for "goes to me for approval": rather
  than a hard status gate that blocks the vendor from working, it's a **visible flag + mandatory
  justification Brett reviews**, consistent with how every vendor bill already requires his
  explicit approval in Review Bills before money moves. (Resolves open question #1 below — no
  hard gate; the attestation requirement is the safeguard.)
- From there the WO is a completely normal WO: Alan assigns himself (already true), adds his own
  description, eventually submits his invoice through the **existing, unmodified**
  `/vendor-bill/add` (WO-anchored) path — same Review Bills queue, same QB pipeline, zero new
  logic needed on the money side.

## 5. Downstream: Review Bills + QuickBooks (the part that needs real code changes)

Confirmed by reading `approveInvoiceReview`/`qbSendInvoice`: today the **entire** Property→Owner→
QB-Customer resolution chain runs off `wo.Property_ID` — there is no path that doesn't go through
a WO. Specifically:
```js
if (!customer_total || (!bill_id && !wo_id)) return json({error:'customer_total and a bill_id or wo_id are required'},400); // approveInvoiceReview
const wo = findWO(wos, ir.WO_ID) || {};
const prop = props.find(p => p.ID === wo.Property_ID) || {};   // qbSendInvoice
const owner = owners.find(o => o.ID === prop.Owner_ID) || null;
```
This has to change for a standalone bill to reach QuickBooks. The template already exists in the
codebase: `scopeSigResolveParties()` resolves owner/billTo straight from a `Property_ID` with zero
WO involvement (used by the Scope Proposal signing flow). Plan:

- `approveInvoiceReview` accepts a bill whose `Vendor_Bills.Standalone==='TRUE'` with **no**
  `wo_id`, keyed on `bill_id` alone (the existing code path already allows `bill_id` without
  `wo_id` in the OR-check above — just needs the downstream resolution fixed, not the validation).
- `qbSendInvoice` gets a branch: if the underlying bill is `Standalone`, resolve
  `prop = properties.find(p => p.ID === bill.Property_ID)` directly (mirroring
  `scopeSigResolveParties`) instead of going through `wo`.
  - If `Bill_To==='owner'`: build a real customer invoice against that property's owner exactly
    like today, just skip the WO-derived job-description text (use the bill's own line-item
    descriptions instead, e.g. "Sierra Taylor — tenant treats, 9/24").
  - If `Bill_To==='ridgeco'`: skip invoice creation entirely, only create the QB **Bill** (vendor
    payable) — this is the same no-customer-invoice shape the existing "one-tap expense" receipts
    path already uses for Ridge-Co-only costs, so the QB-Bill-only code isn't new, just needs to
    be reachable from this new bill type too.
- `renderIRCard` (Review Bills UI) gets a `Standalone` branch: instead of `state.workorders.find(...)`
  (which returns nothing and silently blanks the card today), show the property address (via
  `Property_ID`), a "Standalone bill — no WO" badge, and the `Bill_To` choice, so Brett isn't
  looking at a context-free card.

## 6. Precedent already in the codebase (why this is buildable, not a rewrite)

- `addReceipt()` already supports a bare `property_id` with no `wo_id` — "a receipt no longer has
  to be tied to a work order" (worker.js ~1738) — the one-tap-expense flow is the existing no-WO
  money precedent this design extends into `Vendor_Bills`.
- `addVendorBill`'s WO-auto-complete step is already a no-op when `wo_id` is blank — nothing to
  guard against there.
- `Vendors.In_House`'s inline-checkbox + dedicated-endpoint pattern is the exact template for the
  two new boolean flags.
- `scopeSigResolveParties()` is the exact template for resolving Owner directly from `Property_ID`
  with no WO — this is the one piece of real new logic (a resolver branch in `qbSendInvoice`),
  everything else is additive columns + a new vendor-portal entry point + a thin wrapper endpoint.

## 7. Open questions before this gets built

1. ~~**Hard gate vs. visible flag on self-serve WOs.**~~ **Resolved Sep 24** — no hard gate. Every
   self-serve WO must carry a mandatory `Approval_Source` (owner / Brett / other-with-required-note)
   attestation, shown prominently alongside the `Created_By_Vendor` flag (§4a/4b). This is the
   safeguard in place of a blocking status.
2. **Self-serve WO property scope.** Should a self-serve-WO vendor (Alan George) be limited to a
   property allow-list the same way `Billing_Property_Access` limits Sierra's billing, or can he
   create a WO at any active property? Landscaping-at-any-property vs. billing-at-one-property may
   reasonably differ.
3. **Access-request approval surface.** Proposed as a small new admin view + SMS link (§3b),
   consistent with existing approval-via-SMS-link patterns. If Brett would rather this just be a
   new row on an existing page (e.g. folded into Dev Log or a Vendors sub-tab) rather than a new
   standalone view, say so.
4. **Naming.** Working names used above: "Can_Bill_No_WO", "Can_Create_Own_WO", "Submit Bill",
   "Create a Job", "Standalone bill". Cosmetic only — easy to change before or during the build.

Once these are settled (or Brett says "your call" on any of them), this is ready to hand to a
build session as a normal branch+PR per `AUTONOMY_GUARDRAILS_v1.0` (money/QuickBooks-adjacent →
staged PR for Brett's own review, not auto-merged).
