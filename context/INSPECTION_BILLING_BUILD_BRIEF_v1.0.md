# INSPECTION BILLING (Premier) — BUILD BRIEF v1.0
**Built Oct 22, 2026** · branch `feat/insp-billing-premier-oct22` · BUILD_VERSION `2026-10-22.02-insp-billing`
**Status:** built, tested on staging, **NOT merged to `main`** (Brett's go/no-go). Nothing has been created in real QuickBooks and nothing has been emailed to Premier.
FEATURE_LOG: see the rule entry "Inspection billing (Premier)" · Quality Bar scored: Worker Endpoint + Money Change + Hub Screen.

## 1. What Brett asked for
Inspection billing for **Premier Property Management Investment, LLC** is hands-off. The **Complete tap** on an approved inspection booking is the trigger and the confirmation. One tap:
- **Invoice A (ours):** a normal QuickBooks invoice in QuickBooks' own format (no custom invoice number). The QuickBooks customer is found-or-created on first use (look before create). QuickBooks' own PDF is fetched and emailed to Premier.
- **Invoice B (owner-facing):** a PDF in Premier's specimen layout. Issuer = Premier (its phone and email lines), "Bill to" = the service address only, number = Premier's WO number + a 4-digit suffix, amount = our total + Premier's markup. **Held until Premier's markup is on file.**
- **AppFolio:** once Premier gives its Smart Bill Entry address, our invoice (A) goes to that inbox alone.
- No manual invoice-number lookups. Premier is a separate customer from the "Granger" placeholder.

## 2. Locked decisions
- One Premier WO = one inspection visit = one booking (a second live booking on the same WO is refused, 409 `wo_in_use`).
- Rate card: unit 1 $95, unit 2 $85, units 3 and 4 $75 each, unit 5 and up $65 each. Net 15.
- **Zero access** (no unit inspected): $85. Tenant no-shows are not billed. Each visit resets to $95. **No charge** books nothing.
- Preview first: Complete shows the plan; nothing is created until the confirm tap (`confirm:true`).
- Money is integer cents. Markup math lives in one pure function (`insbMarkup`).

## 3. Endpoints (all in the `INSB-BLOCK` of `worker.js`)
| Route | Purpose |
|---|---|
| GET `/insp/billing/queue` | Approved bookings whose start has passed and are not completed, plus held owner invoices, plus Premier-type customers. Drives the "Needs billing" card. |
| POST `/insp/billing/preview` | Plan only, writes nothing: tiers, blockers, recipients, QuickBooks customer state. |
| POST `/insp/billing/complete` | `{id, kind: inspected\|zero_access\|no_charge, units, confirm:true}`. Resumable, idempotent (QB `requestid`, row lock, stamp checks). |
| POST `/insp/billing/release-owner` | Build and send a HELD owner invoice once its blocker is fixed (`preview:true` to look first). |
| POST `/insp/billing/customer-config` | Save Billing_Mode, Owner_Invoice, Bill_To_*, Bill_Email_To/Cc, AppFolio_Email, InvB_Phone/Email, Markup_Pct (validated, ensured, read back). Returns the held owner invoices the change released. |
| POST `/insp/billing/set-wo` | Fix the WO number on an unbilled booking. |
| GET `/insp/billing/pdf?id=&which=a\|b` | The PDF for a manual AppFolio upload. |
Also: `/insp-book/info` returns `require_wo`; `/insp-book/request` requires and normalizes `wo_number` for `Billing_Mode=wo` customers and stores `WO_Number`.
Pages: `inspect.html` ("Needs billing" card, **Complete & bill** sheet, Billing section in the customer edit modal), `inspect-book.html` (Work order number field).

## 4. Data
New columns (additive, `ensureColumns`): `Insp_Customers`: Billing_Mode, Owner_Invoice, QBO_Customer_ID, Bill_To_Name, Bill_To_Address, Bill_Email_To, Bill_Email_Cc, AppFolio_Email, Markup_Pct, InvB_Phone, InvB_Email. `Insp_Bookings`: WO_Number, Completed_At, Completion_Kind, Units_Billed, Invoice_Base_Cents, Invoice_Status, QB_Invoice_ID, QB_Invoice_Number, Invoice_Emailed_At/To, InvB_Number, InvB_Markup_Pct, InvB_Cents, InvB_Status, InvB_Emailed_At, Billing_Lock, Billing_Log.

## 5. Failure handling (nothing fails silently)
Every failure is a Telemetry row (Success=FALSE, booking id) which also files a failure-ledger event, returned in the response, and shown in the UI. Severity (set Oct 22 from the staging run): money-path failures `insp_billing_money` = **P0**, config/WO writes `insp_billing_write` = P1, reads/previews P2. A failed write never triggers an email. A held owner invoice is visible on the card. If the QuickBooks "Property Inspection" item cannot be created (no income account found) it stops with a clear message and creates nothing; it never guesses an item id.

## 6. Tests
`test/insp-billing.test.mjs` 266 checks (rate tiers, markup, WO normalization, PDF layout via `pdftotext`, whole Complete flow against fakes, every failure forced: QB refusal, PDF failure, email failure, stamp failure after creation, lock, resume, severity classes). `failure-ledger` 121/0, `bug-class-tripwires` 8/8 (`btoa(` baseline unchanged).

## 7. Staging results (Oct 22, Intuit SANDBOX, emails stubbed)
PASS: config validation; WO required and duplicate refused; approve; preview tiers and blockers; confirm guard (400 without confirm); QB customer find-or-create (linked on customer 3); **Complete 1 unit** (invoice 1040, $95.00, QB PDF fetched 15 KB, email stubbed, owner held); **repeat tap** (same invoice, nothing re-sent); markup 20 released the held owner invoice ($114.00); **5 units** $395.00 / owner $474.00; **zero access** $85.00 / owner $102.00; **no charge** booked nothing; set-wo refused on a billed booking and on a duplicate WO, accepted on an unbilled one; **forced QuickBooks failure** (bad customer id) filed as P0, nothing emailed, lock cleared, and the same booking billed cleanly after the id was restored. UI at 390 and 412 wide (mocked Worker): no sideways scroll, buttons 41-46 px. Owner PDF rendered and checked against the specimen layout.
**Found and fixed on staging:** (1) the sandbox has no General item (id 40), the code guessed an item id and QuickBooks refused (loud, nothing sent) — now creates its own "Property Inspection" item from a real income account or stops. (2) billing failures filed as P2 — now P0/P1/P2 as above.
**NOT verifiable on staging:** a real email delivery (stubbed), the real QuickBooks company (sandbox only, by design), PDF bytes through the broker (checked locally from the same code). Failure events reach the Failures (Needs Attention) tab when the ledger roll-up runs, not instantly.

## 7b. Go-live checklist (after Brett merges to `main`)
1. Poll prod `/version` for `2026-10-22.02-insp-billing`.
2. Insp_Customers row for Premier: Billing_Mode=`wo`, Owner_Invoice=TRUE, Bill_To_Name=Premier Property Management Investment, LLC, Bill_To_Address=400 W. Franklin Street #400, Baltimore, MD 21201, Bill_Email_To=josiah.speed@ppmillc.com, Bill_Email_Cc=starr.byrd@ppmillc.com, office@ppmillc.com.
3. **Still unknown (pending from Premier):** InvB_Phone, InvB_Email, Markup_Pct, AppFolio_Email (Smart Bill Entry address). Until Markup is set the owner invoice stays held; until AppFolio is set our invoice goes to Josiah.
4. Set WO `43945-1` on the real Gilmor booking (booking 2, 122 S Gilmor St, 1 unit, $95) only when Brett confirms it belongs to that job. Complete it through the new flow only on Brett's say-so (first real QuickBooks invoice and first real email).
5. The old Gmail draft (invoice # 43945-1-6131) is stale: do not send as is.

## 8. Not built (backlog)
Automatic reminder when a held owner invoice has waited too long; AppFolio inbox confirmation (we cannot see delivery inside AppFolio); a "reissue" action for a wrong amount after billing (today: fix in QuickBooks by hand, then note it).
