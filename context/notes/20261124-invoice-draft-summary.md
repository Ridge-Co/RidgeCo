# QUEUE #266: AI-drafted plain-English work summary on owner invoices — Nov 24 2026 — head `feat/queue-266-invoice-draft-summary`, base `main`, cut from main tip 02f94e7

## CURRENT
**Status: built, tested locally, waiting for Brett. GATED row (customer-facing invoice words), so no session merges it.**

- PR -> `main` opened by the nightly build runner (the number is on queue row #266). Head `feat/queue-266-invoice-draft-summary`, cut from main tip 02f94e7. BUILD_VERSION untouched.
- Not merged to main. No staging test-only PR was opened by the nightly run; see the PR body for what was and was not verified.

**Why:** the Nov 2 work-done list and the Oct 23 "generic text" warning already cover most invoices. The one gap left: a vendor-bill invoice where the bill has no Invoice Description, no time entry on it says anything, and the work order has no checklist. The owner then reads only the generic work order text (invoice 1767). This adds a button that drafts 1 to 3 plain sentences for Brett to edit and approve.

**Built:**
- worker.js: pure `invoiceSummaryNeeded`, `invoiceSummaryInputs`, `invoiceSummaryClean`; admin-only `POST /invoice/draft-summary {ir_id}` (writes nothing, at most one `routeAI` call, type `invoice_summary`, pinned to REASON because the owner reads it) and `POST /invoice/draft-summary/use {ir_id, text, draft?}` (verified write onto `Vendor_Bills.Invoice_Description`, never overwrites an existing description, refuses access details). The send preview answer gains `can_draft_summary`.
- index.html: under the preview warnings a "Draft a summary" button, an editable 16 px box, "Use this on the invoice" and "Discard". "Use this" reloads the preview so Brett sees the exact final line. The Send button is never gated on this box.
- Staging write guard: `/invoice/draft-summary/use` only on a TEST- work order's bill.
- Tests: `test/invoice-draft-summary.test.mjs` (pure helpers, the IO with sheet and AI faked, wiring).

**Defaults taken (no one to ask):** (1) The Nov 2 "no AI rewording" decision is kept for the checklist lines; the AI only drafts where nothing else exists, and only on a tap. (2) Work order Notes are NOT read: they mix vendor, admin and owner notes in one cell with no reliable author split, so the AI sees only the sanitized work order description, trade, completion date and the vendor's truck-materials text. (3) "Thin" input (a one-line description and nothing else) makes no AI call and opens an empty box for typing. (4) Interim/deposit invoices, scope-proposal invoices and standalone invoices are out of scope.

## Pre-build gate
Shapes: `ui` `endpoint` `write` `doc`. Nobody was available to ask (scheduled run), so every item took its default or the safer option.

Items that are N (known gaps):
- B2 Correct after sent: N. Only an unsent invoice is changed. A description on an invoice already in QuickBooks is not touched (the preview of a sent invoice offers no draft).
- B14 Edit before send: Y (the box is editable). B19 Preview the real output: Y (reload shows the final line).
- B15 History and reason: partly. One Ops_Telemetry row per use (bill id, characters, edited yes/no, typed by hand); no separate history tab.
- B16 Bulk: N. One invoice at a time. The combined-invoice preview does not show the button.
- B20 Voice dictation: N as a button. The phone keyboard microphone works in the 16 px box.
- B26 Spanish: N. English only, because the owner invoice is English; Spanish vendor text on the bill is translated by the existing pre-pass, not by this feature.
- B27 Where else will he look: N. The button exists on the send-to-QuickBooks preview only.
- B31 Settings, not constants: N. The 400-character cap, the 600-character save limit and the "thin" rule are constants.
- B13 Will it actually send: n/a, nothing is texted or emailed. D9: the AI call and the QuickBooks send cannot be proven on staging.

Overridden from the brief: none. The brief's "vendor-visible work order notes" input was left out (see Defaults taken 2).

Companion actions included: edit before use (editable box); discard; double-tap guard (buttons disable while saving); loading, empty-input and retry-able error states; phone first (412 px, 44 px targets, 16 px text); C1 no texts; C2 no cron; C3 silent-failure line in the PR, a failed AI call or a failed save is logged to Ops_Telemetry with Success=FALSE and shown in the box; C4 verified write via `updateRowVerified`, nothing downstream fires on a failed write; C5 fails open on the AI (sending an invoice is never blocked) and closed on the write; C6 owners never see what they spend: the AI inputs carry no amounts, vendor name or cost, and a draft containing a price or phone number is thrown away; C7 access details are sanitized before the AI and re-checked after; C9 GATED (customer-facing invoice words), never auto-merged; C10 reuses `routeAI`, `buildLaborDescription` and `/vendor-bill`'s own column; C11 blank means the old behaviour, nothing changes until a tap; C12 no backfill; C15 one cheap-input AI call per tap, none for thin input; C17 `ensureColumns` on `Vendor_Bills.Invoice_Description` (never `ensureTab`); D1 two tab reads per draft, three per save.

## Late requests
