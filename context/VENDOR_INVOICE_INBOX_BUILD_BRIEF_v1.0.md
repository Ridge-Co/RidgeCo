# Vendor Invoice Inbox — Build Brief v1.0

**Status:** DESIGN ONLY (Sep 26 2026). Nothing built. Brett's answers to all design questions are in Section 2; three small items are still open (Section 11).
**GATED (Rung 3):** posts to QuickBooks (bills, bill payments, expenses) and touches payment status. Never autonomous. Needs an interactive session, full `test-verified-builds` loop, `ridgeco-validate`, preview-first, and Brett's own review/merge of the PR (AUTONOMY_GUARDRAILS_v1.0 / PAT-033).
**Do not start until:** PR #44 (receipt-recon reassign/refund/search + expense routing) and PR #60 (statement importer) are merged or consciously sequenced. This build reuses the receipt-recon expense-to-QB path and the Receipt_Recon_Queue conventions, and will conflict otherwise.
**Related:** `RECEIPT_MAIL_TO_HUB_v1.0.md` (the mail pipeline this extends), `HYBRID_VENDOR_PAYMENTS_BUILD_BRIEF_v1.0.md` (Vendor_Type, `/qb/pay-bills`), `STATEMENT_RECEIPT_RECONCILIATION_BUILD_BRIEF_v1.0.md` (vendor upload portal / per-vendor inbound email ideas — this supersedes the per-vendor email idea, see Section 4).

---

## 1. The ask, restated

Some vendors bill through their own systems (Square, Stripe, Venmo, a PDF by email). Making them use the Hub's work-order billing would slow them down and they won't adopt it. Brett wants:

1. Their invoice emails to land in the Hub automatically and become **bills in QuickBooks**, with no change on the vendor's side.
2. When Brett pays (outside the Hub: Square/Stripe pay link, Venmo, etc.), the **payment confirmation email marks the bill paid** and records the payment in QuickBooks — one step, no re-entry.
3. For registered direct-bill vendors, the bill is **auto-created and pre-approved** (skips the normal WO approval step). For anything else, a **queue** where Brett decides.
4. A **workflow + page** so nothing is overlooked: the queue lives on the **Who To Pay** page with a **badge** (no text/email digest for now; later).
5. Every dollar spent must reach QuickBooks for reconciliation, **even when there's no vendor to pay** — so a queue card can also just record an **expense**.
6. Works for **both mailboxes (brett@ and info@)** and for **any invoice or receipt**, not just cleaners. Not only for RidgeCo work.

Motivating cases:
- **K&C Cleaning** (contact Kayla) — Square invoices, cleaning at 1864 Kerns School Rd. Invoice #000040, $160, dated Aug 31, five reminder emails, paid Sep 25 with the debit card ending 2326.
- **Regina Saville (Gina)** — paid by Venmo for cleaning at 1864 Kerns School Rd. Venmo emails "You paid Regina Saville $X" with a note like "Cleaning 1864 Kerns School Rd 09/24/2026 2 hrs plus $50 flat rate".

---

## 2. Decisions (all from Brett, Sep 26 2026)

- Scope now: 1–2 vendors, but built generically so adding more is configuration.
- K&C Cleaning and Regina Saville are **separate cleaners**. Both cleaning for 1864 Kerns School Rd.
- Registered direct-bill vendors: **auto-create the bill, already paid if a "paid" email is the trigger**. Unregistered senders: **queue for Brett to confirm**.
- Registered vendors **skip the normal approval step** and go straight to payable.
- QuickBooks coding for 1864 Kerns School Rd cleaning: existing **"Cleaning" expense account**; **billable** to QB customer **"1864 Kerns School Road, LLC"**.
- **Payment account:** the debit card ending **2326** is the M&T rental account ending **6287**. That is the **default payment account going forward**, even when paid by debit card. Brett expects to pay by credit cards later too, so there must be a **mechanism that searches for / determines the right QB account** (Section 7).
- **Venmo:** Venmo receipts feed the **same mark-paid path** and **also create the bill in QuickBooks**, same property, marked paid **through the 6287 account** (that's the funding account for his Venmo payments).
- K&C invoice #000040 is **not in QuickBooks yet** — create it and bring the books up to date (Section 10).
- Queue card options: **the card must offer "Record as expense"** so that a paid receipt with no vendor payable still gets into QuickBooks. Ignoring is only for non-financial mail (Section 5).
- Notification: **badge only** on Who To Pay. No texts, no daily email (later).
- Location: **Who To Pay** page.
- Aliases/filters: **no per-vendor alias, no per-vendor filter.** One broad intake plus classification in the Hub (Section 4). Brett may still add aliases by hand.

---

## 3. What already exists (reuse, do not rebuild)

From the Sep 26 review of `RECEIPT_MAIL_TO_HUB_v1.0.md`, `HYBRID_VENDOR_PAYMENTS_BUILD_BRIEF_v1.0.md`, `CODEMAP.md` (stale — July 21; treat as an index only) and the memory of shipped work:

- **Apps Script mail pipeline** (`apps-script/receipt-mail-to-hub/ReceiptMailToHub.gs`, installed in brett@ and info@): Rules sheet (Approved/Pending/Denied), Gmail filters + labels, 10-minute `processQueue()`, Monday `weeklyDiscovery()`, Log tab, dedup by Gmail message ID **and** RFC `Message-ID` (so an email reaching both mailboxes is handled once), Drive drop into "Receipts and Invoices".
- **Gmail advanced service + `gmail.settings.basic`** already enabled in the manifest, so filters and headers (including `Authentication-Results`) are available to the script.
- **Vendor invoice number → QuickBooks bill DocNumber** already shipped (`Vendor_Bills.Vendor_Invoice_No`, `qbBillDocNumber()`).
- **Receipt Reconciler** queue (`Receipt_Recon_Queue`), duplicate/rescan cross-check, "expense to Ridge Co / 1864 Kerns School Rd" routing to QuickBooks (PR #44).
- **QuickBooks helpers:** `qbApi`, `qbAccessToken`, `qbFindOrCreateVendor`, `qbFindOrCreateCustomer`, `qbUploadAttachable`/`qbAttachReceipts`, `QB_TRADE_MAP`.
- **`/qb/pay-bills`** (`qbPayBills`): real QB BillPayment, preview-first, passphrase-gated by `PAY_AUTH_CODE`, **dormant (503) until Brett sets that secret**. **This build must NOT depend on it** — see Section 8.
- **Who To Pay** page: has collapsible sections, search/filter, and an "unknown"-state bills reconciliation. New section goes here.
- **Pattern for narrow secrets** (`SCOUT_QUEUE_TOKEN`, `HUB_PROD_WRITE_TOKEN`): only needed if we choose the POST route in Section 4; the recommended route needs none.

---

## 4. Architecture

```
Gmail (brett@ and info@)
   │  ONE set of broad rules (platform senders), not one per vendor:
   │    - Stripe:   invoice+...@stripe.com   ("Your receipt from…", "Invoice from…")
   │    - Square:   messenger@messaging.squareup.com ("You have an invoice waiting", "Your invoice was updated", "You paid an invoice!")
   │    - Venmo:    venmo@venmo.com ("You paid …")
   │    - Generic:  senders approved via the existing Monday discovery (PDF invoices, other platforms)
   ▼
Apps Script (extends ReceiptMailToHub): for each matched email writes ONE small record file
   { mailbox, message_id, rfc_message_id, from, to, date, subject, authentication_results,
     text_body, html_links[], attachments[Drive ids] }  →  Drive folder "Invoice Inbox"
   (attachments/PDFs saved alongside; email body kept as text — no PDF-rendering for structured platform mail)
   ▼
Hub Worker: new  POST /invoice-inbox/scan   (also fired when Who To Pay loads; cheap, deterministic parsing, AI only for unknown/PDF)
   - reads new record files, parses with per-platform parsers (Stripe / Square / Venmo) or AI extraction for PDFs (reuse receipt OCR/statementExtract),
   - identifies platform + vendor key, classifies (Section 5),
   - registered vendor → auto-create bill/payment (Section 6/8), else → Invoice_Inbox queue row
   ▼
Who To Pay page: "Invoice Inbox" section + badge (count of items needing a decision)
```

**Why Drive-drop and not a POST from Apps Script:** it needs no new secret and no new public Worker surface, matches how receipts already flow, and stays off Cloudflare cron. (If Brett later wants instant processing, a narrow-token POST following the `SCOUT_QUEUE_TOKEN` pattern is the upgrade.)

**Why one broad intake and not per-vendor aliases/filters:** Square sends *every* seller's invoices from the same address (`messenger@messaging.squareup.com`), so a per-sender filter can't identify K&C — the vendor name is only in the body. Stripe's sender embeds a per-vendor `acct_…` ID, Venmo's payee name is in the body. So the Hub classifies; Gmail just delivers candidates. This also removes any need to create aliases programmatically (which would require an admin-level Google credential — deliberately not done).

**Vendor identity keys (registered on the vendor):**

| Platform | Key | Where it comes from |
|---|---|---|
| Stripe | `acct_…` id | sender address `invoice+statements+acct_XXXX@stripe.com` |
| Square | merchant business name (normalized) | "K&C Cleaning" in subject/body ("paid invoice #000040 from K&C Cleaning") |
| Venmo | payee display name | "You paid Regina Saville" |
| Generic PDF | sender address/domain | as approved in Rules |

Square and Venmo keys are weaker (a display name can be faked), so: require SPF/DKIM pass, and flag amounts far above that vendor's history (Section 9). Brett clicks Pay himself and sees the merchant on the platform's page.

---

## 5. Classification + the queue

For each new inbound record, in order:

1. **Registered direct-bill vendor** (platform + key match, auth passed) → automatic path (Section 6).
2. **Known WO vendor** (matches an existing Vendors row that is not direct-bill) → queue card with suggested open work orders for that vendor.
3. **Unknown** → queue card.

**Queue card (Who To Pay → Invoice Inbox)** shows: platform, merchant/payee, subject, invoice #/transaction id, amount, invoice date, due date, pay link (if any), payment status seen (invoice vs paid), suggested property (from note text or vendor default), the mailbox it came to, and a link to the email.

**Actions on the card:**

1. **Register as direct-bill vendor** — pick/create the Vendor; set platform key, default property, QB expense account, billable customer, pre-approved flag. **Registering also confirms this first item**, and the card previews the exact QB entry that will be posted. Future emails from that key are automatic.
2. **Attach to work order** — pick a WO (suggestions from vendor's open WOs). Enters the normal Vendor_Bills / Review Bills flow.
3. **Record as expense** — creates the QuickBooks expense (or bill+payment if unpaid) with account, class/customer/property, payment account, and the email/PDF attached. For spend with no payable vendor. Supports "remember this merchant" so next time is one tap (or auto, if Brett opts the merchant in).
4. **Dismiss (non-financial mail only)** — for marketing/notification mail that isn't an invoice or receipt. Never used for something that represents money spent. Dismiss can be "this email" or "this sender". (Brett: "this means I've spent money, I need to capture it.")

Cards are never auto-dismissed; the badge counts undecided cards.

---

## 6. Automatic path for a registered vendor

- **Invoice email (unpaid)** → create a QuickBooks **Bill**, pre-approved, appears under Who To Pay as ready to pay with a **Pay** button opening the vendor's pay link (allow-listed domains only: squareup.com, stripe.com / invoice.stripe.com, venmo.com; anything else is not shown as a link).
- **Reminder emails** for the same invoice → no new bill (dedup on vendor key + invoice number); optionally bump a "last reminded" note.
- **"Invoice updated" email** → if the bill is still unpaid, update the amount/due date and flag the change on the card; if already paid, flag a mismatch for Brett, never silently change a paid bill.
- **Payment confirmation email** ("You paid an invoice!", Stripe receipt, Venmo "You paid…") → mark the bill paid and record the QB **BillPayment** from the mapped payment account (Section 7). If no bill exists yet (vendor never emailed the invoice, e.g. Venmo, or only texted), **create the bill and mark it paid in one step**.
- **Never mark paid** if amount, vendor key, or invoice/transaction id don't match the bill; flag instead.

**QuickBooks coding (1864 Kerns School Rd cleaning):** Vendor find-or-create; expense account **"Cleaning"**; line **billable** with customer **"1864 Kerns School Road, LLC"** (`BillableStatus=Billable`, `CustomerRef`); no markup; bill number (DocNumber) = vendor's invoice number, or for Venmo the Venmo transaction id (`VENMO-<id>`); email/PDF attached via `qbAttachReceipts` (best-effort). Property linkage in Hub = 1864 Kerns School Rd (vendor default, overridden by property named in a Venmo note).

---

## 7. Payment account mapping (the "which QB account" mechanism)

New tab **`Payment_Accounts`**: `ID, Match_Type (card_last4 | venmo | ach | other), Match_Value, QB_Account_ID, Label, Is_Default, Active`.

- Seed: `card_last4 = 2326` → M&T rental account …6287; `venmo` → same; **default = the …6287 account**.
- Resolution order when recording a payment: exact `Match_Type/Match_Value` from the email (e.g. "Paid with Visa 2326") → default account.
- **Unknown card last four** (e.g. a future credit card): the card on the queue asks once **"Which QuickBooks account is this?"** with a **search box over the QB accounts list** (`qbListAccounts`), saves the mapping, and remembers it. Credit-card accounts post as expense-on-card rather than bank BillPayment — the posting function must branch on the QB account type (Bank vs Credit Card).
- The last four digits are stored (not full numbers). Never store full card numbers.

---

## 8. Recording payments without moving money

- The Hub **only records** payments made elsewhere. It never initiates a payment for these vendors.
- Add a **new record-only route** (e.g. `POST /invoice-inbox/record-payment`) that posts a QB `BillPayment` (or Purchase/expense for card accounts) for an already-made payment. It must be hard-separated from `/qb/pay-bills` (which stays passphrase-gated and dormant): different route, no code path that can call a payment rail. Verify with a test that the route cannot invoke anything outside QB record creation.
- Everything QB-posting is **preview-first**, idempotent (keyed on vendor key + invoice/transaction id, stored on the Invoice_Inbox row and as the QB DocNumber/PrivateNote), and audit-logged.

---

## 9. Guardrails (front-end QC)

- **Only registered keys get automation.** Registration is an explicit Brett action.
- **Authentication:** require SPF/DKIM pass in `Authentication-Results`; otherwise force to the queue.
- **Identity by key, not display name** (Stripe acct id; Square/Venmo names normalized + auth check). Different merchant, same platform → queue.
- **Amount sanity:** flag (queue, don't auto-post) a registered vendor's invoice more than **25% above** the max of their last 5 bills (default; configurable) or first-ever amount above a set ceiling. **Default assumption — Brett can change.**
- **Idempotency:** the same invoice appearing as invoice + 5 reminders + updated + paid email = one bill, one payment. A re-scan can never double-post.
- **Duplicate-vs-QB guard:** before creating a bill, look up an existing QB Bill with the same vendor + DocNumber; if found, link instead of create (this also protects the backfill).
- **Links:** allow-listed domains only; never fetch or follow email links server-side.
- **Both mailboxes:** dedup on RFC Message-ID so an email that reaches brett@ and info@ is one record.
- **No AI in retrieval:** Gmail rules select; AI is used only for extraction from PDFs/unstructured mail after the file lands (same requirement as RECEIPT_MAIL_TO_HUB).
- **Sensitive data:** no bank/routing numbers or full card numbers anywhere in Sheets/Drive records; strip them from stored email text.

---

## 9b. Special case — Venmo notes with loan repayments

Regina's Venmo notes often include "less $10 loan repayment" (and sometimes "plus $50 flat rate", "new balance $270"). The cash sent is net of the repayment, so booking only the cash understates cleaning expense and leaves the loan balance wrong. Proposed handling (**pending Brett's answer, Section 11 Q1**): parse the note; post **Cleaning expense at the gross amount** and a **reduction of the loan receivable** for the repayment, so cash out = gross − repayment. Until answered, Venmo items with "loan"/"less" in the note go to the queue rather than auto-post.

---

## 10. Backfill + first live run

1. **K&C Cleaning #000040 — $160.00, invoice date Aug 31, due Sep 15, paid Sep 25 by card 2326** → create as a **paid** Bill (Cleaning, billable to 1864 Kerns School Road, LLC, paid from the …6287 account). This is the first run and the first acceptance test after the feature is built; it is **not** posted by hand or outside the feature (no existing Hub route posts a property-level, non-WO bill).
2. **Regina Saville Venmo payments** (Aug 6 – Sep 25, roughly ten payments for 1864 Kerns School Rd cleaning) → produce a **dry-run list** for Brett's approval before anything posts (whether to backfill is Section 11 Q2). Also check QuickBooks for any already entered.
3. Backfill window and existing-in-QB check use the same duplicate guard as Section 9.

---

## 11. Still open (Brett)

1. **Loan repayments on Regina's Venmo notes** — book gross Cleaning expense + reduction of a loan-receivable account? Is there an existing QB account for the loan to Regina, and what is its name?
2. **Backfill Regina's past Venmo payments** (Aug 6 onward)? Default proposed: dry-run list first, post only what Brett approves.
3. **Dismiss is kept for non-financial mail only** — confirm that's what you meant by wanting the expense option instead of ignoring.

---

## 12. Phases

1. **Foundation (additive):** `Invoice_Inbox` tab; vendor columns (`Direct_Bill`, `Bill_Platform`, `Bill_Platform_Key`, `Default_Property_ID`, `Default_QB_Expense_Account_ID`, `Bill_Customer_ID`, `Pre_Approved`) via `ensureColumns` (check first whether Vendor_Type from the HYBRID brief already exists and reuse); `Payment_Accounts` tab + seed. Nothing live changes.
2. **Intake:** extend the Apps Script (Invoice rules + record-file drop to "Invoice Inbox" folder), offline test harness like `receipt-mail-to-hub.test.mjs`. Install in brett@ and info@.
3. **Parsers + classifier + queue:** Stripe/Square/Venmo parsers, generic PDF via existing OCR, `POST /invoice-inbox/scan`, queue rows, Who To Pay section + badge, the four card actions with previews.
4. **QuickBooks posting:** bill create, record-payment route, expense route (reuse PR #44 expense path), attachment, payment-account resolution, duplicate guard, backfill run.
5. **Later (not now):** daily digest by email/text; upload portal for vendors without email; Venmo/Zelle/Cash App parsers; auto-opt-in of "remembered" expense merchants.

---

## 13. Verify-before-build (PAT-024) — I did NOT read worker.js/index.html for this brief

CODEMAP is dated July 21. Before coding, open the live code and confirm:

- Who To Pay page renderer, its data source, and where a new section + badge can go without disturbing the "unknown"-state reconciliation.
- The existing receipt→QuickBooks **expense** routing (PR #44): function names, what it posts (Purchase vs Bill), how it picks accounts/customers/classes.
- Whether `Vendor_Type` / `Payment_Method` columns from the HYBRID brief exist on Vendors / Vendor_Bills.
- QB Bill creation helpers that don't depend on an `Invoice_Review` row (today's Bill creation is inside `qbSendInvoice`, tied to a WO).
- Whether `PAY_AUTH_CODE` / `/qb/pay-bills` status has changed.
- `GmailMessage` header access for `Authentication-Results` in the installed Apps Script (advanced Gmail service is enabled).
- Actual email HTML for each platform (Stripe invoice email and receipt, Square invoice/updated/reminder/paid, Venmo paid) — use the real emails as test fixtures: K&C #000040 series in brett@ (Aug 31, Sep 16/18/20/22/23 reminders, Sep 25 paid), Stripe receipt format (`Your receipt from … #…`), and the Venmo "You paid Regina Saville" set.

---

## 14. Acceptance tests (write first; all must pass before Brett sees it)

Pure/offline (fixtures from real emails):
1. Square: invoice, "updated", 5 reminders, and "paid" for #000040 → exactly **one** bill and **one** payment; final state paid $160.00; DocNumber `000040`.
2. Square "updated" with a changed amount on an unpaid bill → bill updated + flagged; on a paid bill → flagged, not changed.
3. Stripe receipt from an unregistered `acct_` → queue card, nothing posted; after registering → same email becomes a paid bill; second registered receipt with no prior invoice → bill+payment created in one step.
4. Venmo "You paid Regina Saville" with property named in the note → bill for 1864 Kerns School Rd, DocNumber from Venmo transaction id, paid from …6287; note containing "loan repayment" → queue (until Q1 answered).
5. Payment account resolution: "Visa 2326" → …6287; unknown last-4 → queue asks for account, then remembers.
6. Amount sanity: registered vendor invoice >25% above last-5 max → queue; within range → auto.
7. Auth: email failing SPF/DKIM → queue, never automation.
8. Same email delivered to both mailboxes → one record.
9. Idempotency: run the scan 3× on the same files → no additional QB writes.
10. Duplicate-vs-QB: existing QB Bill with same vendor+DocNumber → linked, not duplicated.
11. Link handling: only allow-listed domains rendered as Pay links.
12. Record-payment route cannot call `/qb/pay-bills` or any payment rail (static/behavioural test).
13. No full card/bank numbers persisted in any Sheet/Drive record.

UI (Playwright against staging):
14. Badge count equals undecided cards; clears when each is decided; Who To Pay's existing sections unchanged.
15. All four card actions work, including register-with-preview and record-as-expense; registering shows the exact QB entry first.
16. Pay button opens the vendor link; after a paid email is scanned the bill shows paid without a page reload issue.

Live (Brett-supervised, first run only):
17. Backfill K&C #000040 as paid; confirm in QuickBooks (Cleaning account, billable customer 1864 Kerns School Road, LLC, paid from …6287, attachment present).
