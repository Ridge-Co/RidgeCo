# Vendor Invoice Confirmation Email — Build Brief v1.0

Status: **built and deployed** (`BUILD_VERSION 2026-09-16.13`), soft-launched to Alex Busey only
via `Config.VENDOR_INVOICE_EMAIL_TEST_VENDOR_IDS`. Full detail: FEATURE_LOG rule 179. Awaiting
Brett's first live pass (a real bill submission for Alex Busey) before widening. Captured
2026-09-16 from Brett's voice memo, decisions locked same day, built same day. Backlog ID
**B-20260916-1930-k7** `[vendor-invoices] [gmail-email]`.

## The ask (condensed)

When a vendor submits an invoice/bill through the Hub, automatically email them a copy of
everything they just submitted — job description, WO number, their own invoice number, a copy
of their invoice file, a copy of any receipts they marked as their own money (not company-card),
and timestamp(s) — with a note that it's been received and the 14-day payment-window reminder,
clock starting the next business day. Goal: written proof so vendors who don't want to
double-enter their own bookkeeping (his example: Alex Busey) trust the portal and submit faster.
A second, separate "your invoice has been paid" email was named but is out of scope here (§7).

## Trigger point (confirmed against live code)

`addVendorBill()` (worker.js ~4354) is the one chokepoint both vendor-facing submission paths
funnel through — `vendor.html`'s PIN-portal Submit Bill, and `wo.html`'s no-login share-link via
`woSharedBill()` (~9486). Fire the send right after `addRow(env, 'Vendor_Bills', body)` succeeds,
same non-blocking try/catch pattern the existing "move WO to Complete" automation already uses —
a Gmail failure must never fail or slow the vendor's own Submit tap.

## §1 — LOCKED: QuickBooks stays "due on receipt"; 14 days is a separate, communicated policy

Brett's call: Vendor bills in QuickBooks should keep showing due immediately (`Payment_Terms`
blank / "due on receipt", unchanged from today — FEATURE_LOG rule 34, `vendorTermDays()`
worker.js ~12328) so his own AP/cash-position views always treat a bill as payable whenever he
has cash. The 14-day window is a courtesy communicated to the vendor only, tracked independently
— it never touches `Payment_Terms` or the QuickBooks due date. No conflict: the vendor never
sees the QuickBooks due date, only what this email tells them, so the two numbers serving two
different audiences is intentional, not a bug.

## §2 — LOCKED: business days skip weekends AND recognized holidays; email states the actual date

New pure function needed (nothing like it exists today, checked): `nextBusinessDay(date, holidays)`.
Formula: `clock_start = nextBusinessDay(submission_date)`; `due_date = clock_start + 14 calendar
days`. The email states the due date plainly, and — only when a weekend/holiday actually shifted
the start — adds one line explaining why, e.g.: *"Since Friday Sep 4 is a Friday, your 14-day
window begins Tuesday Sep 8 (Monday Sep 7 is Labor Day), and payment is expected by Tuesday
Sep 22."* A plain weekday submission just states the due date, no extra reasoning needed.

Holiday list: recommend a `Config` key (same Key/Value tab already used for other settings),
e.g. `US_HOLIDAYS_2026 = 2026-01-01,2026-01-19,...`, seeded with the standard 11 federal
holidays and updated once a year — far less error-prone than computing floating-date holidays
(3rd Monday of January, last Monday of May, etc.) in code, and Brett can edit the list any time
without a push if he wants to drop/add a date his own business doesn't observe.

## §3 — LOCKED: real time-of-day on the timestamp

`Vendor_Bills.Created_Date` is date-only today. Add `Submitted_At` (full ISO timestamp),
written alongside `Created_Date` at bill-creation time via the same lazy `ensureColumns` pattern
already used for every other field on this tab (`Vendor_Invoice_No`, `Vendor_Invoice_Date`,
etc.) — additive, no schema break. Email states it in the vendor's local time, e.g. "Submitted
Tuesday Sep 16 at 2:14 PM."

## §4 — LOCKED: Spanish vendors get the email in Spanish

`Vendor.Language === 'es'` already exists and already drives one-directional translation
elsewhere (`woSharedBill` translates a Spanish vendor's own Notes/Invoice_Description to English,
for Brett's benefit). This is the reverse: build the email in English, then run it through the
same `translateText(env, text, 'English', 'Spanish')` call already proven in this codebase
before sending, when `vendor.Language === 'es'`. Dollar amounts/dates/WO numbers should pass
through untouched — worth a quick spot-check on the first real Spanish send that translateText
doesn't mangle numeric tokens, same as any new use of an existing function.

## §5 — LOCKED: vendor with no email on file gets asked for one, not silently skipped

No self-service "edit my profile" endpoint exists for the vendor role today (checked
`ROLE_SCOPES.vendor` — nothing like it). Recommended mechanism: when `addVendorBill` finds a
blank `Vendors.Email`, send the vendor a one-time SMS via the existing `sendSMS` chokepoint —
"we don't have an email on file for you — add one in your portal so we can send you invoice
confirmations" — linking to a **new, small** one-field "add your email" screen in `vendor.html`
(PIN-gated, same as the rest of that portal), posting to a **new** vendor-scoped endpoint (e.g.
`/vendor/set-email`, added to `ROLE_SCOPES.vendor`). Deliberately NOT free-text SMS-reply
parsing (fragile — a typo'd or oddly-worded reply is hard to trust as an email address); a real
form field is more robust. Once the address exists, future bills from that vendor get the
confirmation email as normal — this SMS nudge only fires while `Email` stays blank, not on every
future bill.

## §6 — CORRECTED: send a link through the existing private-file proxy, not a raw Drive link

Brett asked for a Google Drive link instead of raw attachments — right instinct (avoids Gmail's
25MB cap entirely), but a literal `drive.google.com` link will 404/deny for the vendor. This
project already hit and fixed this exact failure mode once: invoice/bill/receipt files are
deliberately never made Drive-shareable ("anyone with the link") for privacy (FEATURE_LOG rule
13 — keeps vendor cost data unlinkable to outsiders), and that's exactly what caused the WO-1071
"black page" bug on the photo side (`ridgeco-payment-source-photo-share-fix.md`) — fixed there by
building `/vendor-file/view`, a Worker-side proxy that streams the file using the Hub's own
Drive access token instead of relying on the file being publicly link-shared. Pasting a bare
Drive link into this email would silently reproduce that same bug for invoices/receipts.

**Correct approach, reusing what already exists:** `/vendor-file/view?wo_id=&file_id=&t=` already
accepts a signed session token via `?t=` for direct-navigation use (no login prompt) — same
mechanism `wo.html`'s share links already use (`makeSessionToken({scope:'wo-share-link', wo,
rev}, env.WORKER_SECRET, TTL)` / `woShareAuth`, worker.js ~9219). Mint a similarly-scoped,
signed token per bill (e.g. `{scope:'vendor-bill-file', wo_id, vendor_id}`), long-lived enough
that the vendor can still open their own record well after payment clears for their own
bookkeeping (recommend ~90 days), and extend `/vendor-file/view`'s auth check to accept this
scope alongside whatever it already accepts. The email then has one clickable link per file
(invoice + each reimbursable receipt) that opens directly, no login, no raw attachment, no
Drive-sharing exposure — gets Brett exactly what he asked for (a link, not a blob) without
reopening a bug this project already paid to fix once. This replaces the earlier draft's plan to
extend `gmailSendEmailWithAttachment` for multiple files — no longer needed, since nothing is
attached inline anymore.

## Email contents → data sources

| What | Source |
|---|---|
| Job description | `Work_Orders.Description` for the bill's `WO_ID` |
| WO number + property | `WO_ID`; `Work_Orders.Property_ID` → `Properties.Address` |
| Their invoice number / date | `Vendor_Bills.Vendor_Invoice_No` / `Vendor_Invoice_Date` |
| Amount | `Vendor_Bills.Total` |
| Invoice file link | `Vendor_Bills.Invoice_File_ID` → signed `/vendor-file/view` link (§6) |
| Receipts payable to them | `Vendor_Bills.Receipts_JSON`, filter `pay !== 'account'` (same flag `qbAttachReceipts` already uses to decide which receipts back the vendor's own QuickBooks bill) → signed `/vendor-file/view` link per file (§6) |
| Timestamp | `Submitted_At` (§3) |
| Due date + reasoning | `nextBusinessDay()` + holiday Config list (§2) |

## §7 — Explicitly out of scope for this build

The "your invoice has been paid" follow-up. Natural triggers already in the codebase:
`qbPayBills` (real payment execution, Rung 3, Brett-confirmed every time) or `qbSyncPayments`
(periodic reconciliation). Given this project's own history of QuickBooks showing "paid" when
money never actually moved (Andreas Cleaning false-paid audit, `andreas-cleaning-invoices.md`),
this should fire off confirmed real payment, not a bare status flip — its own short design pass
once this build ships and Brett's tested it live. Not detailed further here.

## §8 — LOCKED: soft launch scoped to Alex Busey only

Recommend a `Config` allow-list (`VENDOR_INVOICE_EMAIL_TEST_VENDOR_IDS`, comma-separated Vendor
IDs) rather than a blanket on/off flag, so it's precisely scoped to Alex Busey's `Vendor_ID`
during testing and widened later by editing that one Config value — no second push needed to
turn it on for everyone once it's proven.

## Build/verify plan

New pieces: `nextBusinessDay()` (pure, testable), a holiday Config list, `Submitted_At` field
(additive `ensureColumns`), a signed file-view token scoped to a bill's attachments, a small
vendor "add your email" screen + endpoint, the email template (English + Spanish via
`translateText`). No QuickBooks or payment writes anywhere in this build. `node --check`, full
test suite (add real assertions for `nextBusinessDay` around weekend/holiday edges — that's the
one piece of new logic most likely to have an off-by-one), then a real live test send to Alex
Busey before widening the Config allow-list.
