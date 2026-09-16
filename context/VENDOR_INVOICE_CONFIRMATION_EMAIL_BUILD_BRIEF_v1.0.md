# Vendor Invoice Confirmation Email — Build Brief v1.0

Status: **scope only, nothing built.** Captured 2026-09-16 from Brett's voice memo. Backlog ID
**B-20260916-1930-k7** `[vendor-invoices] [gmail-email]`.

## The ask (Brett's own words, condensed)

When a vendor submits an invoice/bill through the Hub, automatically email them a copy of
everything they just submitted — job description, WO number, their own invoice number, a copy
of their invoice file, a copy of any receipts they marked as their own money (not company-card),
and the timestamp(s) involved — with a note that it's been received and a reminder of the
14-day standard payment window, which starts the business day after submission (Friday
submission → clock starts Monday). Goal: written proof of what was submitted, so vendors who
don't want to double-enter their own bookkeeping (his example: Alex Busey, who wasn't confident
his own submissions were actually saving) get confidence in the portal and submit faster. A
second, separate automated email — "your invoice has been paid" — was named as a want but not
detailed; scoped as a follow-on, not part of this build (see §7).

## Trigger point (confirmed against live code)

`addVendorBill()` (worker.js ~4354) is the single chokepoint both vendor-facing submission paths
already funnel through:
- `vendor.html`'s PIN-portal "Submit Bill" → `POST /vendor-bill/add` → `addVendorBill` directly.
- `wo.html`'s no-login share-link flow → `woSharedBill()` (~9486) → `addVendorBill` at its end.

Fire the send from inside `addVendorBill`, right after `addRow(env, 'Vendor_Bills', body)`
succeeds — same place the existing "move WO to Complete" automation already lives, and the same
non-blocking pattern: wrap in try/catch, never let a Gmail failure fail or slow the vendor's own
Submit tap.

## Recipient

`Vendors.Email` for the bill's `Vendor_ID` (both submission paths already guarantee `Vendor_ID`
is set on the row). **Open question:** some vendors have no email on file (communicate by text
only) — recommend a silent skip + a lightweight log line (e.g. `ensureColumnsInner`'s own
telemetry-on-failure pattern, or just a console/Ops_Telemetry event) rather than surfacing an
error, so this never blocks the bill itself.

## Email contents → data sources (grounded in the live schema, not guessed)

| What Brett asked for | Source |
|---|---|
| Job description | `Work_Orders.Description` for the bill's `WO_ID` |
| Work order number + property context | `WO_ID`; `Work_Orders.Property_ID` → `Properties.Address` |
| Their invoice number | `Vendor_Bills.Vendor_Invoice_No` |
| Invoice date (if they entered one) | `Vendor_Bills.Vendor_Invoice_Date` |
| Amount | `Vendor_Bills.Total` |
| Copy of their invoice file | `Vendor_Bills.Invoice_File_ID` → Drive download → attach |
| Copy of receipts payable to them | Parse `Vendor_Bills.Receipts_JSON`, filter `pay !== 'account'` (the exact flag `qbAttachReceipts` already uses to decide which receipts back the vendor's own QuickBooks Bill vs. the customer invoice only) → Drive download each `.url` → attach |
| Timestamp(s) | See §5 — `Created_Date` today is date-only |
| "We've received it" + 14-day window | New copy, see §4 |

## §4 — The 14-day / "next business day" clock

No business-day helper exists anywhere in the codebase today (checked). New pure function
needed: `nextBusinessDay(date)` (Sat/Sun aware) → `due_date = nextBusinessDay(submission_date) +
14 calendar days`.

**Load-bearing open question:** `Vendors.Payment_Terms` / `Terms` already exists and already
drives the REAL QuickBooks bill due date today (FEATURE_LOG rule 34, `vendorTermDays()` /
`vendorTermLabel()`, worker.js ~12328) — blank means "due on receipt," "Net 7/10/30" sets a real
QuickBooks term. If this email states "14 days" independent of that field, a vendor who already
has a `Payment_Terms` value set gets two different official numbers from the same company — the
exact confusion this feature exists to prevent. Two options:
- **(a)** Email-only communicated policy, doesn't touch `Payment_Terms` at all. Simple, but can
  disagree with whatever QuickBooks says for any vendor with a term already set.
- **(b) [recommended]** 14 days becomes the new default when `Payment_Terms` is blank
  (replacing "due on receipt"), with the existing per-vendor override still fully respected —
  so the email and the actual QuickBooks due date always agree. This is a real behavior change
  to existing bill-due-date logic, not just new email copy — flagging clearly rather than
  deciding it silently.

Secondary question: weekends-only for "business day," or also skip recognized US holidays?
Recommend weekends-only for v1 (matches exactly what Brett described; revisit only if a holiday
actually causes a mismatch complaint).

## §5 — Timestamp precision

`Vendor_Bills.Created_Date` is written as a bare `YYYY-MM-DD` (matching the rest of the sheet's
business-date convention) — sufficient for the due-date math above, which only needs the
calendar day. But "timestamps such as when they uploaded it" reads like it wants real proof —
"Tuesday Sep 16 at 2:14 PM" carries more reassurance than a bare date. If that's the intent,
needs one small additive field, e.g. `Submitted_At` (full ISO timestamp), written alongside
`Created_Date` via the same lazy `ensureColumns` pattern every other field on this tab already
uses. Cheap either way — just needs a decision before building.

## §6 — Sending multiple attachments

`gmailSendEmailWithAttachment` (worker.js ~8842) already exists, is proven in production (the
Receipts→QuickBooks forwarding email), and is staging-aware — but takes exactly ONE attachment.
This email needs several (invoice file + N receipts). Recommend extending it to accept an array
and build one multipart/mixed MIME message with one part per file (same technique it already
uses, just looped) rather than sending multiple emails.

Each attachment: download via `getAccessToken` + `driveDownload` (mime type comes back from
Drive itself, no new storage needed) — same calls `qbAttachReceipts` (~13375) already makes for
the QuickBooks side. Per-file try/catch, non-fatal, matching that function's own convention — a
broken file should drop out of the email, never block the whole send.

**Open question:** Gmail's hard cap is 25MB per message. A vendor with several receipt photos
could plausibly approach that. Recommend a safe threshold (~20MB combined) — past it, drop
attachments and say "see your submission in the portal for copies" in the body instead of
silently truncating or failing the whole send.

## §7 — Explicitly out of scope for this build

**The "your invoice has been paid" follow-up email** Brett named in passing. Natural trigger
points already in the codebase: `qbPayBills` (real payment execution, Rung 3, Brett-confirmed
every time) or `qbSyncPayments` (periodic reconciliation off QuickBooks balance). Given this
project's own history of bills showing "paid" in QuickBooks when money never actually moved
(Andreas Cleaning false-paid audit, `andreas-cleaning-invoices.md`), this should fire off
*confirmed real payment*, not a bare status flip — worth its own short design pass once this
build ships and Brett's done a live pass on it, same ship-verify-then-extend sequencing this
project already follows elsewhere. Not detailed further here.

## Other things worth deciding before this becomes code

- Should the email go out in the vendor's own language when `Vendor.Language === 'es'`? The
  wo.html share-link path already translates a Spanish vendor's Notes/Invoice_Description to
  English (for Brett's benefit) — this would be the reverse, for the vendor's own copy.
- Ship behind a `Config` flag (`VENDOR_INVOICE_EMAIL_ENABLED`, same Key/Value tab already used
  for other settings) so it can go live, get verified against one real submission, and be
  switched on for everyone without a second push. Given Alex Busey is the vendor who prompted
  this, he'd be a natural first real test.

## Build/verify plan (once the above is locked)

No QuickBooks or payment writes — pure read + Gmail send, plus a couple of additive
`ensureColumns` fields at most. Lower autonomy rung than most of this project's recent work,
but still: `node --check`, full test suite, a live test send before it's live for every vendor
automatically (per Brett's own front-loaded-QC preference — catch it before it ships, not after).
