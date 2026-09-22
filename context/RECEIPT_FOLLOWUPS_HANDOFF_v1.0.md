# Receipt follow-ups: handoff (v1.0, Sep 22 2026)

Start the next session with: **"resume ridgeco receipt follow-ups"**. Load context light (brett-context), then read this file and nothing else up front.

## Where things stand (all merged + live-verified Sep 22)

| PR | What | Live |
|---|---|---|
| #21 | Receipt Mail → Hub (Apps Script, `apps-script/receipt-mail-to-hub/`) + `receiptReconScan` batch cap | `2026-09-22.2` |
| #23 | One-tap expense (Ridge Co / 1864 Kerns School Rd / picked property) → QuickBooks immediately; unreadable files stop retrying | `2026-09-22.3` |
| #24 | Reconciler actions update in place (no scroll-to-top); receipt-date cutoff `receipt_recon_min_date` (default 2026-07-01); ↩ Move back to Pending | `2026-09-22.4` |

- The Apps Script is installed and running in **brett@** (project "Receipt Mail to Hub", `1YVL1sbAE…`) and **info@** (`1jvtvXed0…`). They share the sheet "Receipt Mail → Hub Rules" (`1nGAlu3RqTQVwLad3QxDsK8oSbC9Qcr9WWScT_GFnMzA`).
- The first info@ run pulled **21 Home Depot e-receipts** (Jul 7 → Sep 15) into the Reconciler.
- The cutoff cleanup ran: 9 pre-Jul-1 scanned receipts moved to Skipped. Pending = 35; the oldest is 2026-07-04.
- Full detail: FEATURE_LOG `[FL-20260922-1900-rm]`, `[FL-20260922-1545-ex]`, `[FL-20260922-1620-ip]`, and `context/RECEIPT_MAIL_TO_HUB_v1.0.md`.

## Task 1: QuickBooks line-item duplicate audit for OLDER receipts (highest priority)

**What Brett found:** a receipt amount that matched a line item on an older invoice, meaning the same receipt was billed twice. He caught a couple and believes there are several more.

**Why the current check misses them:** `receiptCheckDuplicatesOne` (worker.js, the "Check duplicates" button) has three limits.
1. It only runs on rows still in `Receipt_Recon_Queue`, never on receipts already confirmed into `Receipts`.
2. Its invoice-line layer opens only the **5** invoices closest in date (`DUPLICATE_CHECK_MAX_INVOICE_OPENS`), within ±45 days (`qbInvoiceCandidatesByDate`). A duplicate on the 6th invoice, or on one further away in time, is never seen.
3. It matches a line only when the amount equals the receipt total exactly.

**Build: a read-only audit that writes nothing to QuickBooks.**
- For every active `Receipts` row with an Amount, find QuickBooks invoice lines whose amount equals that receipt's Amount, across all invoices. Flag a receipt when:
  - its amount appears on **2+ invoice lines**, or
  - it appears on an invoice for a **different WO/customer** than the receipt's own WO.
- Report each flag with: receipt (store/date/amount/WO), the matching invoice #(s), customer, invoice date, line description, and whether that invoice is paid.
- **Verify first:** the code comment says list queries don't reliably carry `Line`. Check with one live `SELECT * FROM Invoice` whether `Line` comes back, because that decides one bulk pull vs per-invoice opens.
- Mind the Cloudflare subrequest cap (it has failed live at ~25 subrequests before). Page the work (offset/next, like `/admin/share-attachments`) or pull the invoice list once and match in memory.
- **UI:** an "Audit older receipts" view in the Reconciler (or Who To Pay) that lists the flags, with a way to mark each "real duplicate" or "not a duplicate".
- **Fixing** a real duplicate in QuickBooks (credit memo / invoice repair) is Rung-3 money work. It stays Brett's tap, never automatic.
- Also raise `DUPLICATE_CHECK_MAX_INVOICE_OPENS` or remove it, if the bulk pull makes that cheap.

**Clarifying questions to ask Brett before building** (he said to ask during design):
- How far back should the audit go: all invoices, or since a date?
- Does a line at the receipt amount **plus markup** count? The current check is exact-amount only.
- Should a flagged pair also match the store or description, or is amount alone enough to show it for review?

## Task 2: Home Depot RETURN receipts read as purchases

- The Aug 24 file `2026-08-24_HomeDepot_85eb0166.pdf` is a return: TOTAL −$111.18, "REFUND-CUSTOMER COPY", "ORIG REC:" lines. OCR queued it as **+$111.18**. **Brett was told to Skip it; check whether it's still pending.**
- Fix in `receiptExtract` / `receiptSuggestCore`:
  - Detect a return: a negative TOTAL, "REFUND", or "ORIG REC" on an HD receipt.
  - Set category `refund`. The Reconciler already treats that as Skip-only (`excluded` in `rowCard`).
  - Never pass the amount to `addReceipt` as a positive number.
- Test with that real file.

## Task 3: Apps Script sender-approval noise

- The first discovery added about **190 Pending sender rows** across both mailboxes: GitHub alerts, McDonald's, work-order notices, newsletters, personal receipts. Only about 10 are real supply vendors (Lowe's, Harbor Freight, SupplyHouse, Micro Center, Advance Auto, RepairClinic, USA Fleet Supply, Technical Hot & Cold, Sherwin/Ferguson if present).
- In `apps-script/receipt-mail-to-hub/ReceiptMailToHub.gs` `discover_`, tighten it:
  - Require a receipt-strength subject (receipt / order confirmation / invoice from a store) **or** a PDF attachment.
  - Add a Config `Ignore_Domains` list (github.com, anthropic.com, google.com, managebuilding.com, appfolio.us, localnewsbreak.com, mcdonalds.com…).
  - Group by sender domain.
- Clean the current Rules sheet: set obvious junk to Denied, and leave the supply vendors Pending for Brett to approve. **Ask Brett before bulk-denying**, since it's his list.
- **Redeploy:** paste the updated .gs into both Apps Script projects from Brett's Chrome (Claude in Chrome works, and he's signed into both accounts). Load it from the raw GitHub branch URL into the Monaco model (`monaco.editor.getModels()[0].pushEditOperations`), Ctrl+S, and verify the SHA-1 matches. No re-authorization is needed unless `appsscript.json` scopes change.
- Keep `apps-script/receipt-mail-to-hub/test/receipt-mail-to-hub.test.mjs` green (51 checks) and extend it for the new filters.

## How this session worked (keep doing it)

- Branch + PR through GH Broker. Patch big files with `commit_patch`, then compare each pushed `content_sha` against local `git hash-object` before calling it done.
- Tests before showing Brett anything:
  - pure tests that extract the real function from worker.js
  - a headless Playwright check at 390px with mocked Worker routes (see `test/manual-verify-receipt-inplace-ui.mjs`)
  - the full suite on a fresh clone of the branch
- Live checks go through the Reconciler page already signed in within Brett's Chrome (its own `post()`/`get()`). **Never ask Brett for a pasted secret.**
- Brett merges by saying "merge N". After merging, poll `/version` for the new `BUILD_VERSION`.
