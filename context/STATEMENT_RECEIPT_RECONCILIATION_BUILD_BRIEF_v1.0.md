# Statement + Bulk-Receipt Reconciliation — build brief v1.0 (Sep 24 2026)

Captures Brett's Sep 24 design conversation (voice memo + clarifying-question answers). **Not yet
built.** Start the next session with **"resume ridgeco statement reconciliation"** or point
directly at this file.

## Context: this sits next to the existing Receipt Reconciler, not apart from it

Everything below extends the existing Receipt Reconciler (`Receipt_Recon_Queue`, `Receipts`,
`receiptReconScan`, the confirm/skip/duplicate/bulk-action flows) rather than building a parallel
system. It also depends directly on the still-open
`RECEIPT_RECONCILER_DUP_REFUND_BULK_BUILD_BRIEF_v1.0.md` (Sep 22) — in particular Part 0's
intake-time duplicate cross-check (amount + description + date matching, not image matching) is
the exact same matching engine this brief needs for statement line items. **Build Part 0 of that
brief first if it isn't already shipped by the time this is picked up** — don't build a second,
divergent matching engine.

## Why this exists (Brett, Sep 24 voice memo)

Brett wants to drop bulk statements (Home Depot, Lowe's, a credit card, a future Ace Hardware
vendor account) into the Hub and have every line item checked against what's already captured in
`Receipts`/billed-to-a-customer. Anything not already accounted for gets flagged for his review —
he decides whether it's billable, and if so goes and gets the actual receipt (from the vendor's
site, an email, wherever) to attach, same as today's confirm-and-bill flow. He also wants to be
able to bulk-drop a month of actual receipt files (not just statements) and have those
cross-checked the same way. Duplicate protection is critical — he does not want to double-charge
a customer. Eventually (explicitly Phase 2/3, NOT this brief) he wants bank/general-card
statements reconciled too, feeding QuickBooks' own bank-reconciliation — but *not* for ordinary
non-job expenses QuickBooks already handles fine on its own.

## Phase 1 scope (this brief) — statement + bulk-receipt reconciliation

**In scope:**
- Manual upload only, for now. Brett uploads a PDF or CSV/Excel export himself — no vendor email
  intake and no vendor portal in this phase (see Backlog item below for those).
- **Build one generic statement importer**, not a vendor-specific one. Different vendors will hand
  Brett different formats (PDF vs CSV) — the importer needs a parsing layer that can take either
  and normalize to a common line-item shape (date, amount, description, vendor-side
  reference/PO/invoice number if present), so adding Ace Hardware or a new card later is a config
  change, not a new build. PDF parsing reuses whatever the app already uses for receipt OCR
  (`receiptExtract`/vision call) rather than inventing a second document-parsing path — confirm
  the real function name before building (PAT-024).
- **Matching key: amount + description + date** (+ vendor invoice/PO reference when the statement
  has one — see the PO/invoice-number section below). **Never image matching** — a statement line
  item never looks like the receipt photo, so this must reuse the same fuzzy-match logic Part 0 of
  the Sep 22 duplicate-refund-bulk brief already specs (store/description rough match + exact
  amount + date), not a new algorithm.
- Every line item on an uploaded statement gets checked against `Receipts` (already billed/
  captured) and against already-dispositioned `Receipt_Recon_Queue` rows, exactly like Part 0's
  intake-time guard. A matched line item needs no action. An unmatched line item is inserted into
  the **same `Receipt_Recon_Queue` used today** — not a separate screen — with a new source tag so
  Brett can tell "this came from a statement line, no receipt image yet" apart from a normally
  scanned receipt.
- **Bulk receipt-file drop** (e.g., a month of downloaded Home Depot receipt PDFs/images, dropped
  in at once) is the same reconciliation problem at larger scale — feed each file through the
  existing per-receipt intake/OCR/dedup path, batched, respecting whatever Cloudflare subrequest
  cap the existing scan/share-attachments endpoints already work around (reuse that pattern, don't
  invent a new batching scheme).
- Flagged/unmatched items stay in the **same Receipt Reconciler queue** Brett already works out of
  daily — one habit, same actions (confirm/skip/expense/duplicate/attach-only), not a second tool
  to check.

**Explicitly out of scope for Phase 1** (Brett's own answer): mixed-use card logic (deciding which
line items on a Capital One-style statement are job-relevant vs. personal/general spend). That's
Phase 2/3, and even then the goal is never to duplicate QuickBooks' own bank reconciliation for
ordinary non-job expenses — only to surface the job-relevant lines. Design for that is explicitly
deferred; don't build speculative mixed-card filtering now.

## Foundational fix needed for matching: vendor invoice/PO number handling

Came up directly in the design conversation because it's the matching key for statement line
items, and Brett flagged a real, current gap while discussing it — **fix this regardless of when
Phase 1 above gets built, it's valuable on its own:**

- **Today:** Vendor_Bills has no captured field for the vendor's own invoice number. When a bill is
  pushed to QuickBooks, the work order number is used as the bill's reference/number
  (`DocNumber`/Bill No.) — but that doesn't match the vendor's own invoice numbering at all, so
  there's no easy way to cross-reference "this QB bill = that Home Depot/vendor invoice."
- **Brett's decision:**
  1. Capture the vendor's own invoice number on `Vendor_Bills` (new field) whenever the vendor
     provides one — same as capturing any other invoice number, applies to every vendor, not just
     materials suppliers.
  2. **When a vendor invoice number is present, use it as the QuickBooks vendor bill's number**
     (`DocNumber` or equivalent — confirm the current QBO Bill API field per PAT-028, don't assume
     from training data). **When absent, default to the work order number**, exactly as today.
  3. This is vendor-bill-side only. The **owner-facing side is unaffected** — owners continue to
     see only Ridge Co's own invoice number (from the QuickBooks Invoice, not the Bill); never the
     vendor's bill number.
  4. **PO number, separately:** Brett is moving away from labeling receipts/purchases by property
     only and toward labeling them by **work order number** going forward — i.e. the WO number
     effectively functions as the PO Ridge Co gives out for a job. No PO field needs to be
     invented for Ridge Co's own side; the existing WO number already serves that role once
     vendors/purchases reference it consistently. Capture the vendor's own invoice/order number
     (from option 3 in the earlier clarifying question) as its own field — don't conflate it with
     a Ridge-Co-issued PO.
- **This feeds Phase 1's matching directly:** once a statement line item or vendor bill reliably
  carries the vendor's own invoice number, that becomes the strongest match key (stronger than
  amount+description+date alone) for tying a statement line to an already-processed receipt/bill.
- Build as its own small, low-risk PR (additive Vendor_Bills column + one QB-push field change) —
  doesn't block Phase 1's importer work and can ship independently. Money-adjacent (writes to
  QuickBooks bill records) so per `AUTONOMY_GUARDRAILS_v1.0` this stages as a PR for Brett's own
  review/merge, not an autonomous ship.

## Explicitly deferred to a later phase (do not build now)

- **Phase 2/3 — bank/general-card statement reconciliation feeding QuickBooks' own bank rec.**
  Explicitly not this brief. Design question Brett flagged but left open: on a mixed-use card,
  how to surface only job-relevant lines without redoing QuickBooks' own reconciliation work for
  everything else. Revisit once Phase 1 is live and its matching engine has real mileage.
- **Vendor statement/receipt intake automation** (see Backlog item below) — email intake and a
  vendor-facing upload portal are a real, wanted feature but a separate build, not Phase 1.

## Backlog item captured (not building yet)

**Vendor self-serve upload portal + per-vendor inbound email.** Raised as a "let's explore this"
idea while discussing statement intake, not an immediate ask — captured to `context/BACKLOG.md` as
a new backlog entry (see repo) rather than built here. Summary of the idea for whoever picks it up:

- A vendor-facing page (likely an extension of `vendor.html`, PIN-gated like the rest of the
  portal) where a vendor can upload invoices, receipts, or statements that are **not tied to a
  work order on their end** — e.g. a materials-only vendor whose purchase is ready for pickup at
  their store, with no labor/WO on their side at all. The vendor just submits what they have;
  Ridge Co matches it to a work order **on our end**, using whatever PO/reference/destination info
  the vendor did include (this is the same matching engine as Phase 1 above, just fed from a
  vendor upload instead of a Brett-uploaded statement).
- Multiple intake paths worth supporting, not just the portal: a vendor could (a) upload directly
  through the portal, (b) email a PDF or CSV to a Ridge-Co-controlled inbound address, ideally
  **one dedicated address per vendor** so incoming mail is auto-tagged to that vendor without
  parsing sender identity — same filter-based, no-AI-retrieval intake pattern already used for
  Home Depot e-receipts (`RECEIPT_MAIL_TO_HUB_v1.0.md`), just extended to be per-vendor and to
  also accept CSV/statement attachments, not only single receipts.
- Any of these — portal upload, per-vendor email, or Brett's own manual upload from Phase 1 above
  — should land in the same queue and go through the same matching/reconciliation engine. Design
  the Phase 1 importer with this in mind (a clean intake→normalize→match pipeline with pluggable
  sources) so this doesn't require a rebuild later, even though it isn't being built now.

## Suggested build order

1. Confirm Part 0 of `RECEIPT_RECONCILER_DUP_REFUND_BULK_BUILD_BRIEF_v1.0.md` (intake-time
   duplicate cross-check) is shipped and live — this brief's matching reuses it directly. If not
   shipped yet, build/ship that first.
2. Vendor invoice-number capture + QB bill-number fix (small, independent, ships on its own).
3. Generic statement importer (PDF + CSV normalization → common line-item shape).
4. Statement line-item matching against `Receipts`/`Receipt_Recon_Queue`, landing unmatched lines
   in the existing queue with a new source tag.
5. Bulk receipt-file drop (batched through the existing per-receipt intake/dedup path).
6. Leave Phase 2/3 (bank/mixed-card reconciliation) and the vendor upload portal backlog item
   alone until Brett prioritizes them.

## Notes for whoever builds this

- Don't invent a second document-parsing/OCR path for PDFs — reuse `receiptExtract` (or whatever
  the live function is actually named; confirm first, PAT-024).
- Don't invent a second dedup/fuzzy-match algorithm — reuse Part 0's amount+description+date logic
  from the Sep 22 brief once it exists.
- Confirm the real current QBO Bill field for the bill number/reference before building the fix
  above — search current QuickBooks Online API docs (PAT-028), don't assume `DocNumber` is right
  without checking.
- Keep `test-verified-builds`'s mandatory self-test loop: generate tests from these acceptance
  criteria, run them, loop fix→retest until green, before any of this is ever reported done to
  Brett.
