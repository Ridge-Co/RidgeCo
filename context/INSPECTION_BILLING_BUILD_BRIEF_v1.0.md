# INSPECTION BILLING (Premier) — BUILD BRIEF v1.0
**Built Oct 22, 2026** · branch `feat/insp-billing-premier-oct22` · BUILD_VERSION `2026-10-22.03-insp-billing` · staging PR #418 (merged into `staging`)
**Status:** built, independently reviewed, review fixes applied, tested on staging, **NOT merged to `main`** (Brett's go/no-go). Nothing has been created in real QuickBooks and nothing has been emailed to Premier.
FEATURE_LOG: rule 228 "Inspection billing (Premier)" · Quality Bar scored: Worker Endpoint + Money Change + Hub Screen.

## 1. What Brett asked for
Inspection billing for **Premier Property Management Investment, LLC** is hands-off. The **Complete tap** on an approved inspection booking is the trigger and the confirmation. One tap:
- **Invoice A (ours):** a normal QuickBooks invoice in QuickBooks' own format (no custom invoice number). The QuickBooks customer is found-or-created on first use (look before create). QuickBooks' own PDF is fetched and emailed to Premier.
- **Invoice B (owner-facing):** a PDF in Premier's specimen layout. Issuer = Premier (its phone and email lines), "Bill to" = the service address only, number = Premier's WO number + a 4-digit suffix, amount = our total + Premier's markup. **Held until Premier's markup is on file.**
- **AppFolio:** once Premier gives its Smart Bill Entry address, our invoice (A) goes to that inbox alone. The owner invoice (B) never goes to the AppFolio inbox.
- No manual invoice-number lookups. Premier is a separate customer from the "Granger" placeholder.

## 2. Locked decisions
- One Premier WO = one inspection visit = one booking (a second live booking on the same WO is refused, 409 `wo_in_use`; a billed booking keeps its WO taken even if later cancelled).
- Rate card: unit 1 $95, unit 2 $85, units 3 and 4 $75 each, unit 5 and up $65 each. Net 15.
- **Zero access** (no unit inspected): $85. Tenant no-shows are not billed. Each visit resets to $95. **No charge** books nothing.
- Preview first: Complete shows the plan; nothing is created until the confirm tap (`confirm:true`).
- Money is integer cents. Markup math lives in one pure function (`insbMarkup`); markup must be a plain number string (`^\d{1,3}(\.\d{1,2})?$`), anything else is refused.

## 3. Endpoints (all in the `INSB-BLOCK` of `worker.js`)
| Route | Purpose |
|---|---|
| GET `/insp/billing/queue` | Approved bookings whose start has passed and are not completed, plus held / unsent / stuck invoices, plus Premier-type customers. Flags: `owner_held`, `owner_unsent`, `owner_hold`, `invoice_hold`, `needs_attention`. |
| POST `/insp/billing/preview` | Plan only, writes nothing: tiers, blockers, recipients, QuickBooks customer state. |
| POST `/insp/billing/complete` | `{id, kind: inspected\|zero_access\|no_charge, units, confirm:true, expected_cents, force_resend?}`. Resumable and idempotent. `expected_cents` is the amount the screen showed; a different current amount refuses with `amount_changed` and bills nothing. |
| POST `/insp/billing/release-owner` | Send a HELD / unsent owner invoice. Without `confirm` it only previews. Needs `confirm:true` AND `expected_cents`. `force:true` only after a person checked that an unconfirmed send never arrived. |
| POST `/insp/billing/customer-config` | Save Billing_Mode, Owner_Invoice, Bill_To_*, Bill_Email_To/Cc, AppFolio_Email, InvB_Phone/Email, Markup_Pct (validated, ensured, read back). Returns the held owner invoices the change now allows (it does NOT send them). |
| POST `/insp/billing/set-wo` | Fix the WO number on an unbilled booking (refused once billing has started, even before an invoice id exists). |
| GET `/insp/billing/pdf?id=&which=a\|b` | The PDF for a manual AppFolio upload. |
Also: `/insp-book/info` returns `require_wo`; `/insp-book/request` requires and normalizes `wo_number` for `Billing_Mode=wo` customers. `/insp/customer/update` (the plain editor) refuses billing fields with 400 `use_billing_config` and logs it, so the validated route cannot be bypassed.
Pages: `inspect.html` ("Needs billing" card, **Complete & bill** sheet, Billing section in the customer edit modal), `inspect-book.html` (Work order number field).

## 4. Data
New columns (additive, `ensureColumns`): `Insp_Customers`: Billing_Mode, Owner_Invoice, QBO_Customer_ID, Bill_To_Name, Bill_To_Address, Bill_Email_To, Bill_Email_Cc, AppFolio_Email, Markup_Pct, InvB_Phone, InvB_Email. `Insp_Bookings`: WO_Number, Completed_At, Completion_Kind, Units_Billed, Invoice_Base_Cents, Invoice_Status, QB_Invoice_ID, QB_Invoice_Number, Invoice_Emailed_At/To, InvB_Number, InvB_Markup_Pct, InvB_Cents, InvB_Status, InvB_Emailed_At, Billing_Lock, Billing_Log.

## 5. Safety design (added by the independent review, build .03)
Sheets has no compare-and-set, so the lock is check-then-set, hardened with a settle delay, a re-read, token checks and a "claim before send".
- **Never double-send.** Before every Gmail call the row is stamped `sending|<lockToken>|<time>` (verified by re-read). Only a DEFINITE refusal from Gmail (4xx) puts the status back. Anything unclear (timeout, 5xx, network drop, a failed stamp after sending) leaves `sending`; a plain retry is refused with `stage:'unconfirmed'`. A person confirms the email never arrived and taps **I checked - send it** (`force_resend` / `force`).
- **Never double-create in QuickBooks.** `creating|<requestid>|<date>` is written BEFORE the POST. A retry reuses the same requestid and date and first looks for the invoice in QuickBooks: found = adopted (no second POST); more than one = `qb_duplicate`; lookup unreadable = `qb_unconfirmed` (never posts blind).
- **Total mismatch.** If QuickBooks' total differs from ours, the row is stamped `review|total X vs Y`, nothing is emailed, a P0 `qb_total_mismatch` failure is filed. A person checks and taps **I checked - send it**.
- **Stale screen.** Complete takes `expected_cents`; release takes `confirm` + `expected_cents`. If the amount changed since the screen loaded, nothing is billed or sent and the page re-previews.
- **Unlock only if still ours** (lock token checked), and the final read-back is wrapped so a failed read cannot turn a success into a silent one.

## 6. Failure handling (nothing fails silently)
Every failure is a Telemetry row (Success=FALSE, booking id) which also files a failure-ledger event, is returned in the response, and shows in the UI. Severity: money-path failures `insp_billing_money` = **P0**, config/WO writes `insp_billing_write` = P1, reads/previews `insp_billing` = P2. **An unknown failure stage defaults to P0** (`insbJobType`), so a new stage can never quietly rank low. A failed write never triggers an email. A held or stuck invoice is visible on the card with a button for the next step. If the QuickBooks "Property Inspection" item cannot be created (no income account found) it stops with a clear message; it never guesses an item id.

## 7. Tests
`test/insp-billing.test.mjs` **367 checks**: rate tiers, markup (strict parsing), WO normalization, PDF layout via `pdftotext` (including a 30-character WO fitting the margin), whole Complete flow against fakes, every failure forced: QuickBooks refusal, QuickBooks timeout after create (adopt on retry), lookup failure, duplicates, total mismatch, PDF failure, Gmail 4xx / 5xx / network drop, stamp failure after send, claim failure, lost lock, stale amounts, plan blockers, recipients (AppFolio address also in the people list), set-wo / WO-in-use, severity of every stage. `failure-ledger` 121/0, `bug-class-tripwires` 8/8 (`btoa(` baseline 14 unchanged). Playwright (mocked Worker) at 390 wide: no sideways scroll, buttons at least 41 px, all hold-state dialogs.

## 8. Staging results (Oct 22, build .03 verified deployed, Intuit SANDBOX, emails stubbed)
PASS on `maintenance-hub-staging` (TEST- records only):
- Complete without `confirm` refused (400). Stale `expected_cents` refused (409 `amount_changed`, nothing billed).
- **1 unit**: invoice 1044, $95.00, QuickBooks PDF fetched, owner invoice $114.00 (20%). **Repeat tap**: same invoice, `steps: []`, nothing re-sent.
- **3 units**: $255.00 (95+85+75), owner $306.00.
- **Zero access**: $85.00, owner $102.00.
- **Owner invoice held** (markup blank): our invoice 1046 still went out, owner `held_no_markup`; release refused (`still_held`) until markup set; after markup 20 the preview showed $114.00; release without `expected_cents` refused (400); wrong `expected_cents` refused (409); correct one sent ONLY the owner invoice (B).
- `set-wo` refused on a billed booking; a new request on a billed WO refused (`wo_in_use`).
- **Forced QuickBooks refusal** (bad customer id): 502, `invoice_created:false`, row stayed clean (no stuck `creating`), nothing emailed, **P0** `insp_billing_money` failure filed. Restored the id and retried: invoice 1048 created once, emailed once.
- Failure ledger: no failure rows from any happy path.
**Not verifiable on staging:** a real email delivery (stubbed), the real QuickBooks company (sandbox only, by design), `/insp/customer/update` (not on the staging write allow-list; covered by unit tests). The Sheets read quota (per minute, shared) caused a few loud 403/500s during bursts; each was loud, wrote nothing, and passed on retry.
**Found and fixed along the way:** (1) the sandbox has no General item (id 40) — code now creates its own "Property Inspection" item from a real income account or stops; (2) billing failures first filed as P2 — now P0/P1/P2 as above, unknown defaults to P0; (3) the independent review's double-send, QuickBooks double-create, stale-amount and stuck-state gaps (section 5).

## 9. Go-live checklist (after Brett merges to `main`)
1. Poll prod `/version` for `2026-10-22.03-insp-billing`.
2. Insp_Customers row for Premier: Billing_Mode=`wo`, Owner_Invoice=TRUE, Bill_To_Name=Premier Property Management Investment, LLC, Bill_To_Address=400 W. Franklin Street #400, Baltimore, MD 21201, Bill_Email_To=josiah.speed@ppmillc.com, Bill_Email_Cc=starr.byrd@ppmillc.com, office@ppmillc.com.
3. **Still unknown (pending from Premier):** InvB_Phone, InvB_Email, Markup_Pct, AppFolio_Email (Smart Bill Entry address). Until Markup is set the owner invoice stays held; until AppFolio is set our invoice goes to Josiah.
4. Set WO `43945-1` on the real Gilmor booking (booking 2, 122 S Gilmor St, 1 unit, $95) only when Brett confirms it belongs to that job. Complete it through the new flow only on Brett's say-so (first real QuickBooks invoice and first real email).
5. The old Gmail draft (invoice # 43945-1-6131) is stale: do not send as is.
6. Draft (not send) a request to Josiah for the Smart Bill Entry address and the markup.

## 10. Not built (backlog)
Automatic reminder when a held owner invoice has waited too long; AppFolio inbox confirmation (we cannot see delivery inside AppFolio); a "reissue" action for a wrong amount after billing (today: fix in QuickBooks by hand, then note it); an atomic lock (Sheets cannot compare-and-set; the settle delay plus claim-before-send is the mitigation).
