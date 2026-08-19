# Hybrid / Materials-Service Vendor Payments — Build Brief v1.0

**Status:** PLANNED, not started. Written Aug 19, 2026 from a full code-grounded investigation
(worker.js + index.html + vendor.html + FEATURE_LOG + BACKLOG). Nothing below has been built yet.
**Trigger:** Brett picked up keys from a locksmith (materials + a bit of labor), will pick up locks
tomorrow. This locksmith needs to be paid directly (like a labor vendor, via the business account —
"ACH" in Brett's words) while still billing the customer as materials, alongside — not instead of —
the actual labor vendor on the job.
**GATED:** Per `AUTONOMY_GUARDRAILS_v1.0.md`, everything here (QuickBooks Bills/invoices/payments,
vendor PII, schema changes to existing Sheet tabs) is Rung 3 — never autonomous. Must run in an
interactive, PAT-equipped session with Brett's own hand at the deploy step. That's fine — this is
exactly that kind of session.

---

## 1. The ask, restated

Brett wants the Hub to cleanly support a **vendor who is materials-plus-a-bit-of-service**, not
purely labor and not purely a store — e.g. a locksmith who sells him physical keys/locks (materials)
but might also do a bit of labor. This vendor:
- gets billed to the customer as **materials** (marked up, same as any material), and
- gets **paid directly by Ridge Co**, like a labor vendor (invoice number, our own accounts payable,
  paid from the business account) — **not** reimbursed through the assigned labor vendor's bill, and
  **not** a credit-card purchase like Home Depot.

This needs to work **alongside** the WO's actual assigned labor vendor (or Brett himself), on the
**same** work order, landing on **one** customer invoice — not two.

Restated as the three materials-accounting patterns Brett described:
1. **Reimburse the labor vendor** for materials they fronted with their own money.
2. **Pay a hybrid vendor** (materials + some service, like this locksmith) directly, in addition to
   the actual labor vendor on the job.
3. **Pay a credit card** for a store purchase (Home Depot/Lowe's-style — we already paid at checkout).

Plus a second, related pattern: **two labor "vendors" on one job** — Brett himself (hourly, oversight/
walk-through — company policy: no payable ever created for Brett, he's `In_House`) **and** a real
second vendor (e.g. Eddie Smith) who does the actual work, invoices the company, and may also submit
materials receipts of his own.

---

## 2. What the code actually does today (verified by reading worker.js/index.html/vendor.html directly
— not assumed from docs; CODEMAP.md is stale, well behind the live file)

### Already fully solved, zero new code needed
- **Job type 1 (Brett does it on the business account, no vendor bill)** — the old "No vendor bill to
  invoice yet" block is gone (B-224, shipped Aug 12). An invoice can post from materials + time alone.
- **Store/credit-card materials purchase (Home Depot pattern)** — a receipt tagged `pay:'account'`
  goes on the customer invoice, marked up, and **never** creates a vendor Bill/payable. Nothing to pay
  later — it's already spent. This is Brett's pattern 3, fully working today.
- **Reimbursing a labor vendor for materials they fronted (pattern 1)** — a receipt tagged
  `pay:'reimburse'` inside that vendor's own bill rolls into their one Vendor_Bills row/QB Bill. Fully
  working today.
- **Brett + a second labor vendor on one job (the Eddie scenario)** — Brett's `In_House` flag on his
  own Vendor record already makes `qbSendInvoice` skip creating a Bill/payable for his hours
  (worker.js ~8828: `if (vendorInHouse && vendorCost > 0) { warn: 'No vendor bill created — in-house' }`).
  Eddie is just the WO's normally-assigned vendor with his own ordinary Vendor_Bills row. **No gap
  here — this already works exactly as Brett's stated policy requires.**
- **Entering a vendor's bill on Brett's own behalf** — there's already a THIRD entry path beyond the
  vendor portal and "Bill my hours": **"✍ Enter a bill by hand"** (`hubBillHtml`/`hubBillSubmit`,
  index.html ~4487–4844, posts to `POST /vendor-bill/add`). Verified in the code:
  - The vendor picker is a **free dropdown over every active vendor** (`state.vendors`), not locked to
    the WO's assigned vendor — it just pre-selects/labels the assigned one. Brett can pick ANY vendor,
    including a brand-new one he just created, and submit an invoice number + amount on their behalf.
  - It supports the same `pay: 'account' | 'reimburse'` per-receipt-line toggle as the vendor portal.
  - It supports a free-text `Vendor_Invoice_No` field.
  - `addVendorBill` (worker.js 2099–2161) has **no block** against a second Vendor_Bills row from a
    *different* vendor on the same WO — its only dedupe guard is same-vendor/same-day/same-amount.
  - **Gap in this path:** no invoice-FILE upload control (vendor portal has one, hand-entry doesn't —
    small, cheap fix).
- **Paying a vendor bill electronically from the business account** — `POST /qb/pay-bills` /
  `qbPayBills` (worker.js 7911–8019) is a real, already-built QuickBooks `BillPayment` write. Preview-
  first, gated by a second-factor passphrase checked server-side against the Cloudflare secret
  `PAY_AUTH_CODE` (see `payment-auth-interim.md`), idempotent, rate-limited. **It posts as `PayType:
  'Check'` against a QuickBooks bank account (`CheckPayment.BankAccountRef`) — this is QuickBooks'
  own bank-account payment mechanism, not a distinct "ACH" PayType.** No routing/account numbers are
  or should be stored anywhere in the Hub/Sheet — that boundary is intentional and already correct;
  actual bank/ACH mechanics live entirely inside QuickBooks against the vendor's `QBO_Vendor_ID`.
  **This endpoint is built but dormant (`503`) until Brett sets the `PAY_AUTH_CODE` Cloudflare secret**
  — open since Aug 17, flagged again in SESSION_STATE.md, still not done as of this writing.
  This one mechanism already covers paying a labor vendor AND (once Phase 3 below ships) a hybrid
  materials-vendor identically — no new payment code needed, just get it turned on.
- **Vendor payables already stay correctly separated per vendor** even on a shared WO — each approved
  Invoice_Review row independently resolves its own `Vendor_ID` → its own QuickBooks Bill (worker.js
  ~8828–8838). So once a hybrid vendor's bill is reviewed/approved, its payable is already correct and
  independently payable via `/qb/pay-bills` today.

### The real, confirmed gap
**`qbSendInvoice`/`buildInvoiceLines` operate on exactly ONE `Invoice_Review` row at a time** — looked
up strictly by `id`/`bill_id` (worker.js ~8532: `irRows.find(r => (body.id && r.ID===body.id) ||
(body.bill_id && r.Bill_ID===body.bill_id))`). It never queries sibling rows sharing the same `WO_ID`.

**Confirmed by tracing the full pipeline:** if a WO has two separate Vendor_Bills rows (e.g. Eddie's
labor bill and the locksmith's materials bill), each gets its own `Invoice_Review` row
(`approveInvoiceReview` only dedupes a bill against *itself*, worker.js 2245–2261), each shows as its
own separate line on the "Send to QB" queue (`qbReadyQueue`, no WO_ID grouping), and sending both today
would post **TWO separate QuickBooks customer invoices for the same job** — not the one combined
invoice Brett wants. `listBilledReceipts` (worker.js 931–947) is aware of the double-billing *risk*
this creates for shared materials receipts (its comment names the exact scenario) but only greys out
already-claimed receipts in the UI — it doesn't merge or block anything.

**This is the one piece that actually needs new code.**

### Also missing (smaller, not blocking)
- No `Vendor_Type` field on Vendors at all today — nothing distinguishes a locksmith from a plumber
  from a hypothetical "Home Depot" vendor record. Vendors only carry `Hourly_Rate` as payment-related
  data; no payment-method or mailing/remit-to address field exists on the Vendor record (any such
  detail Brett wants captured for invoicing purposes would need a new `Payment_Address` column, pushed
  into the QuickBooks Vendor's `BillAddr` on find-or-create — actual bank/ACH details stay QB-only,
  never in the Sheet, per the existing security boundary).
- No linkage today between "customer invoice shows Paid in QuickBooks" and "this vendor's Bill is now
  ready to release" — Brett's stated cash-flow policy (pay vendors for materials the moment the
  customer pays) isn't surfaced anywhere; `/qb/pay-bills` exists but nothing filters its worklist by
  customer-payment status yet. Needs `qbSyncPayments` checked/extended to confirm it tracks customer
  Invoice paid status (it already tracks vendor Bill paid status → `Invoice_Review.Vendor_Paid`).

### Related, already-tracked backlog (don't duplicate — extend)
- **B-183** — "Multi-vendor per work order — One WO worked by multiple vendors... centralized tracking
  + a single owner invoice." This IS Brett's ask. Not built.
- **B-096** / **B-223** — the heavier "split WO into parent/child work orders" epic B-183 was originally
  tied to. **Recommendation: don't build the full split-WO epic to solve this.** Brett's actual need —
  two Vendor_Bills rows on ONE (not split) WO, consolidated into one customer invoice — is a much
  lighter, narrower slice of B-183 that doesn't require WO-splitting machinery at all. Scope Phase 3
  below as that narrow slice, not the full parent/child rebuild.

---

## 3. What Brett can already do RIGHT NOW, with zero new code, for the actual keys/locks job

1. Add the locksmith as a new Vendor record (Hub → Vendors → Add) — name, phone, trade label. No
   ACH/bank fields to fill in; that detail belongs in QuickBooks only, once/if a QB Bill for them
   exists (created automatically the first time their bill is approved and sent).
2. Open the WO, tap **"✍ Enter a bill by hand,"** pick the locksmith from the vendor dropdown (not
   the assigned labor vendor), enter their invoice number and amount, mark materials `pay:` however
   fits (`account` if Brett already paid them out of pocket/card at pickup, otherwise it's genuinely a
   payable — likely just leave it as the default bill amount, not a per-receipt reimburse toggle, since
   this is the vendor's OWN invoice, not a receipt riding on someone else's bill).
3. **Caveat, confirmed above:** sending BOTH this bill and the labor vendor's bill through Send-to-QB
   today will currently produce **two separate QuickBacks customer invoices** for the same job, not
   one. Until Phase 3 ships, Brett should either (a) accept two invoices for this one job, or (b) hold
   the locksmith's bill and fold its cost into the labor vendor's invoice by hand for now.

---

## 4. Proposed build sequence

**Phase 1 — Vendor_Type + Payment_Address (additive, low-risk).**
Add `Vendor_Type` (`labor` default / `materials_store` / `materials_hybrid`) and `Payment_Address` to
Vendors; add `Payment_Method` (`reimburse_via_labor_bill` default / `separate_vendor_billpay` /
`credit_card_no_bill`) to Vendor_Bills. All `ensureColumns`-style additive, existing rows default to
today's behavior — nothing live changes. Update the Add/Edit Vendor form.

**Phase 2 — Small "Enter a bill by hand" upgrades.**
Add the missing invoice-file upload (parity with the vendor portal path), default `Payment_Method`
from the picked vendor's `Vendor_Type`, and label/filter the vendor dropdown by type so a
`materials_store` "vendor" (if Brett ever adds Home Depot as one, for reporting) can't accidentally be
picked into a real payable flow.

**Phase 3 — THE core piece: one customer invoice from multiple vendor bills on one WO.**
Teach `qbSendInvoice`/`buildInvoiceLines` to gather every approved `Invoice_Review` row sharing a
`WO_ID` and combine them into ONE QuickBooks customer Invoice (materials + labor lines from every
vendor on the job, marked up per the existing private billing rules — unchanged), while still posting
one separate QB Bill per distinct vendor (already correct today) so each vendor — the labor vendor,
the hybrid materials vendor — stays independently payable via the existing `/qb/pay-bills`. This is
money-posting code: needs its own focused session, full `test-verified-builds` + `ridgeco-validate`
pass, preview-first, and Brett's own supervised first live send before it's trusted.

**Phase 4 — "Pay when the customer pays" surfacing.**
Verify/extend `qbSyncPayments` to track customer-Invoice-paid status per WO (it already tracks vendor-
Bill-paid status). Add a "Ready to Pay" flag to the Who-to-Pay / pay-bills screen: a vendor Bill
(labor OR hybrid-materials) surfaces as ready the moment its linked customer Invoice shows Paid in
QuickBooks. No new payment mechanism — same `/qb/pay-bills`, same passphrase gate, just better-timed
so Brett's tap is fast instead of something he has to remember to go looking for.

**Phase 5 (optional, low priority) — Named `materials_store` vendor profiles** (Home Depot, Lowe's)
purely for receipt reporting/reconciliation clarity. No functional payment change — card purchases are
already fully settled at time of purchase; this is bookkeeping polish only.

---

## 5. Open questions for Brett (answer inline, plain text — no widget needed)

**Q1 — Is literal ACH required, or is QuickBooks' existing bank-account BillPayment ("Check" PayType)
close enough?**
(A) Fine as-is — it's an electronic payment out of our account either way, ship it.
(B) I actually need true ACH via QuickBooks' own ACH/Bill Pay feature — needs its own research pass
before Phase 3/4.

**Q2 — Does a hybrid vendor like this locksmith need their own vendor.html PIN portal login, or will
Brett always hand-enter their invoices himself?**
(A) I'll always enter it myself via "Enter a bill by hand" — no portal needed for this vendor class.
(B) Some of these vendors should get normal portal access like a labor vendor.

**Q3 — On the customer invoice once Phase 3 ships, should each vendor's line(s) be itemized
separately (e.g. "Labor — Eddie Smith" / "Materials — keys & locks") or rolled into the existing
generic labor/materials line structure with no vendor names shown (matches today's no-address,
no-vendor-name-shown philosophy elsewhere)?**
(A) Keep it generic like today — no vendor names on the customer-facing invoice.
(B) Itemize by vendor/description so the customer sees what each line covers.

**Q4 — Sequencing: ship Phase 1+2 (Vendor_Type + hand-bill upgrades) this week so the locksmith can be
logged properly right now, with Phase 3 (invoice consolidation) as its own later focused session — or
hold off entering this bill at all until Phase 3 is done, so it's never split across two invoices?**
(A) Ship Phase 1+2 now — I'll live with two invoices for THIS one job if it comes to that.
(B) Hold — don't want this bill entered until the full combined-invoice flow exists.

**Q5 — The Cloudflare secret `PAY_AUTH_CODE` (needed before ANY vendor bill-pay — old pattern or new —
can actually run) has been open since Aug 17. Set it yet?**
(A) I'll set it before we build further.
(B) Not yet — walk me through it next session.

---

## 6. How to resume

New chat → say `resume ridgeco` (or just paste this file's contents) → `brett-context` loads this
brief automatically since it now lives in `context/`. Bring answers to Q1–Q5 above; Phase 1 can start
immediately once Q1/Q2 are answered (they shape the Vendor_Type enum and whether portal access needs
building too).

**Also still open, unrelated to this brief, carried from the last session:** rotate the classic GitHub
PAT — flagged as pasted into chat again, third-plus time across sessions now.
