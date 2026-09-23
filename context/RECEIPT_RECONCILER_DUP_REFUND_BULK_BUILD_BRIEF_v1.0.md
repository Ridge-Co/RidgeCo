# Receipt Reconciler: duplicate-image confirm, refund handling, bulk actions — build brief v1.0 (Sep 22 2026)

Captures Brett's Sep 22 evening ask plus his answers to the design questions raised before building. Not yet built. Start the next session with **"resume ridgeco receipt follow-ups"** or point directly at this file.

## Context: this sits on top of PR #27

`context/RECEIPT_FOLLOWUPS_HANDOFF_v1.0.md` already describes an open, unmerged PR (**#27**, branch `receipt-duplicate-audit`) for a read-only QuickBooks line-item duplicate audit — Brett finding receipt amounts already billed as invoice line items on older invoices. That PR needs a rebase onto `main` (it predates PR #25 `/wo/combine` and PR #26 `HUB_PROD_WRITE_TOKEN`/`_prodWriteOk`) before anything below is added to it. Everything in this brief either extends that PR or is closely related — **build all of this as one pass on that branch, don't start a second parallel duplicate-audit feature.**

Brett's answers to PR #27's own open questions (from the handoff doc), now settled:
- **Audit range:** all invoices, ever — no date floor.
- **Markup match:** exact amount only, no markup-adjusted matching.
- **Match strictness:** require the store/description to roughly line up too, not amount alone — cuts noise.

## Part 0 — URGENT: intake-time cross-check against already-processed receipts (real duplicates happening now)

**Sep 22, 8:05pm, Brett live-testing:** found a $56.04 Home Depot receipt sitting in the Pending queue that he knows he already processed — and nothing on the card indicates it was already scanned/handled. Root cause almost certainly the Receipt Mail → Hub email pull (PR #21, `receiptReconScan`): it's adding rows from info@/brett@ into `Receipt_Recon_Queue` with no check against receipts that are already sitting in `Receipts` (confirmed/expensed) or already-dispositioned rows in the recon queue itself (Skipped/Duplicate). A receipt processed by hand, or confirmed before the mailbox scan ever ran, can still get pulled back in fresh next scan and look indistinguishable from a brand-new Pending item.

This is a live, active duplicate-creation risk — Brett is actively expensing/confirming receipts while unprocessed lookalikes keep reappearing in the same queue. **Treat this as higher priority than Parts 1-5 below** — it's the front door those parts are trying to catch problems behind; fixing intake stops new duplicates from being created in the first place, which matters more than better tools for finding ones that already got through.

**Decision/design:**
- Before `receiptReconScan` (or whatever inserts a new Pending row from an emailed/scanned receipt) writes a row, cross-check it against:
  1. Already-confirmed `Receipts` rows (store + amount + date, and file/attachment identity if the email attachment can be fingerprinted — e.g. a hash of the PDF/image bytes, or the Gmail message ID if that's already tracked anywhere) — the $56.04 HD example is exactly this case.
  2. Already-dispositioned `Receipt_Recon_Queue` rows (Skipped, Duplicate, or the new "attached only" status from Part 2) — a receipt Brett already decided about shouldn't resurface as if it were new.
- On a match, don't silently drop it (a false match could hide a real second purchase at the same store for the same amount) — instead land it in the queue already flagged, e.g. "⚠️ Possible re-scan — matches an already-processed receipt from <date>" with a link/reference to the existing row, so Brett sees the flag the instant he looks at the card rather than discovering it by memory.
- Every row in the Pending queue (not just flagged ones) should show **when/how it entered the queue** (e.g. "via email scan, Sep 22" vs. "already confirmed") so Brett has a fast visual cross-check even for rows the automated match misses.
- Investigate whether the Apps Script / `receiptReconScan` already tracks a stable identifier per source email (Gmail message ID) that could be used to hard-block true re-adds of the exact same email — if so, that's a cheap first-layer guard on top of the amount/date/store fuzzy check above.

**Do this part first**, before Parts 1-5 — confirm the real cause (read `receiptReconScan` and the Apps Script live, don't guess) and ship the intake guard, then come back to the rest of this brief.

## Part 1 — Duplicate flag must confirm the image is actually attached, not just the amount

Today, when a receipt is flagged as a possible duplicate (by amount, via `receiptCheckDuplicatesOne` or the new PR #27 audit), Brett has no fast way to tell whether the receipt IMAGE is actually attached anywhere yet — only that an amount matches. He needs that distinguished before deciding anything.

**Decision: check the `Receipts` row's own attachment field** (not a separate scan of the WO's Photos & Files) to answer "is this image already attached." Use whatever field `Receipts` already stores its file reference in (`File_Url` / `Drive_File_Id` or equivalent — confirm the real column name against the live sheet before building, per PAT-024).

Build:
- On the duplicate-flag card/view (both the existing `receiptCheckDuplicatesOne` UI and the new PR #27 audit view), show whether the flagged receipt's own image field is populated — a clear "✅ Image attached" / "⚠️ No image attached" indicator next to each flagged duplicate.
- When **not attached**, offer an **"Attach image only"** action (see Part 2) as an alternative to Confirm/Skip.

## Part 2 — "Attach image only" action (no billing change)

**Decision: keep a tracked row.** Attaching the image should NOT create or change any customer-facing bill, invoice, or `Vendor_Bills` entry — but it should still leave a `Receipts` row, marked with a new status/flag (e.g. `Attach_Status: 'attached_only'` or reuse an existing enum if one already fits) so:
- it shows up in the Reconciler's own history/filters instead of vanishing,
- it's never re-surfaced as "still needs image" or re-suggested for billing later,
- there's an audit trail of what was attached and when, separate from what was billed.

Build:
- New endpoint (name TBD, e.g. `POST /receipt/attach-only`) that takes a receipt id + WO id, writes the file reference onto the matched WO (however the existing Confirm flow already attaches images — reuse that piece), and sets the Receipts row's status to the new "attached, not billed" state. It must NOT touch `Vendor_Bills`, `Invoice_Review`, or trigger any customer invoice line — confirm this by reading `receiptConfirmMatch`/`receiptAddToWO` (or whatever the real confirm-and-bill function is called) and reusing only its file-attach half, not its billing half.
- Reconciler UI: on a flagged-duplicate-with-no-image card, an "Attach image only, don't bill" button next to the normal Confirm/Skip.

## Part 3 — Refund detection and handling

Supersedes/expands Task 2 in the handoff doc (Home Depot returns OCR'ing as positive charges — e.g. the still-open Aug 24 `2026-08-24_HomeDepot_85eb0166.pdf`, TOTAL −$111.18, "REFUND-CUSTOMER COPY", "ORIG REC:").

**Decisions:**
- **Auto-suggest a match, never auto-cancel billing.** When a receipt looks like a refund, try to match it to an earlier purchase receipt already in the system (same store, overlapping items, plausible date range using the "ORIG REC" reference when OCR can read it). Present the suggested pairing to Brett for confirm — the system never silently reverses or removes a prior bill on its own.
- **Full match → still Brett's tap**, but the UI should make "this refund fully matches that purchase, all items returned" a one-tap confirm that then reverses/credits the original billed amount (Rung-3 money write — never automatic).
- **No full match (partial refund, or no confident original found) → post as a standalone negative expense.** Reuse the existing one-tap expense flow (Ridge Co / 1864 Kerns School Rd / picked property → QuickBooks, no WO) built in PR #23, but allow a negative amount so it posts as money back rather than money spent. This keeps it "saved and processed" per Brett's ask without it ever touching a customer's bill.

Build:
1. Detection (worker.js `receiptExtract`/`receiptSuggestCore`): a negative TOTAL, or "REFUND"/"RETURN"/"ORIG REC" language on the receipt, sets a new `refund: true` / category `refund` flag. Never pass a refund amount to `addReceipt`/billing as a positive charge.
2. Matching: given a refund, search existing `Receipts` (and/or matched WOs' billed materials) for a same-store, same/overlapping-item, plausible-date-range original purchase. Surface the best candidate(s) with enough detail (store, date, amount, items if OCR captured them) for Brett to eyeball in one glance.
3. UI: a refund gets its own card treatment in the Reconciler — a "🔄 REFUND" badge, the suggested original purchase (if any) with a "This matches — reverse the billed amount" confirm, and, separately, a "No match / partial — post as expense" path that opens the existing expense flow pre-filled with the negative amount.
4. `excluded` in `rowCard` (already treats `refund` as skip-only per the original Task 2 note) needs updating so a refund is never silently skip-only anymore — it now has real actions (match-and-reverse, or post-negative-expense), not just Skip.

Test with the real Aug 24 file once built — it's the one already sitting in the queue.

## Part 4 — Bulk actions on the Reconciler (checkboxes + bulk menu)

Brett wants to select multiple pending receipts at once and apply one action to all of them, the same pattern already used for bulk sends elsewhere in the Hub (Tenants/Vendors/Owners bulk-select, rules 184-185 — reuse that scoping fix, don't reintroduce the cross-page checkbox-bleed bug it fixed).

**Decision — bulk-actions menu covers exactly these four:**
1. **Mark as duplicate** — bulk-flag selected receipts as duplicates (same status the single-receipt "Check duplicates" flow uses).
2. **Expense to Ridge Co / 1864 Kerns School Rd** — bulk-post selected receipts through the existing one-tap expense flow (PR #23) to whichever of the two Brett picks for the batch (one property choice applies to the whole selection, not per-row).
3. **Move back to Pending** — bulk-undo (reuses the existing single-row ↩ from PR #24).
4. **Skip** — bulk-mark selected as Skipped.

Build:
- Checkboxes on each Reconciler row/card, scoped to the Reconciler's own list container only (per the rule 184-185 pattern — a checkbox from another page/view must never ride along).
- A bulk-actions bar that appears once ≥1 row is selected, with the four actions above; "Expense to Ridge Co / 1864" opens a small picker (which of the two) before applying to the batch.
- Server side: either one new batched endpoint per action, or a single `POST /receipt-recon/bulk-action {ids:[...], action, ...params}` dispatching to the existing single-row handlers in a loop with a combined result (`{succeeded:[...], failed:[...]}`) — prefer the single dispatch endpoint, it's less surface area and matches the existing `/wo/combine`-style batched-write pattern.
- Respect the Cloudflare subrequest cap — if a selection is large, cap the batch size per call (same pattern as `/admin/share-attachments`' `limit`/`offset`) rather than looping unbounded in one request.

## Part 5 — WO picker needs a link + open/close dates, so Brett can sanity-check receipt date vs. WO date

Brett's ask (Sep 22, 7:57pm): when he's matching a receipt to a work order — in the WO picker used by the Reconciler's Confirm flow, and really any place a receipt gets matched to a WO — he currently can't see when that WO was opened/closed. He wants to eyeball whether the receipt date makes sense next to the WO's own dates, so he doesn't attach a receipt dated after a WO closed, or before it ever opened.

Build:
- On the WO picker (wherever a receipt is matched to a work order — the Reconciler's Confirm modal is the primary one, but sweep for any other picker used for the same purpose, e.g. Part 2's new "Attach image only" flow above should reuse the same enriched picker), show each candidate WO's:
  - a clickable link to open that WO's own detail view (reuse whatever WO deep-link the app already uses elsewhere, e.g. the pattern `/wo/share-link` or the admin WO-detail URL — don't invent a new link scheme),
  - its **opened date** (`Created`/`Date_Created` or equivalent) and, if closed/completed, its **closed date** (`Completed_Date`/`Status`-transition date) — confirm the real column names against the live sheet rather than assuming.
- When the receipt's own date falls outside the WO's open→close window (or is before the WO's open date, or well after its close date), show a visible warning inline in the picker row — e.g. "⚠️ Receipt is dated after this WO closed" / "⚠️ Receipt predates this WO" — so Brett catches a bad match before confirming, not after. This is a warning only, never a block — Brett may have a legitimate reason (late-filed receipt, backdated WO) and keeps the final call.
- This is read-only/display-only work — no new write path, so it's low-risk and can be built early; consider pulling it forward in the build order (it directly de-risks Part 1/Part 2's "attach to the right WO" decision).

## Suggested build order

1. Rebase PR #27 onto `main` first (blocking everything else — it owns the auth-gate/router lines everything below will also touch).
2. Part 5 (WO picker: links + dates + mismatch warning) — read-only, no new write path, and it directly informs every other part's "which WO is this" decision, so do it right after the rebase.
3. Part 1 (image-attached indicator) — smallest, and both Part 1 and Part 2 read from the same `Receipts` attachment field, so do them together.
4. Part 2 (attach-only action).
5. Part 4 (bulk actions) — self-contained, doesn't depend on refund work.
6. Part 3 (refund detection + matching) — the most open-ended piece (OCR + fuzzy matching), do it last so the simpler wins ship first.

## Notes for whoever builds this

- Confirm the real `Receipts` column name for the image/file reference before writing Part 1 — don't assume `File_Url`.
- Confirm the real `Work_Orders` column names for created/opened date and completed/closed date before writing Part 5 — don't assume `Created`/`Completed_Date`.
- Don't guess `receiptConfirmMatch`'s exact billing side-effects for Part 2 — read it live first (PAT-024) and split attach-vs-bill cleanly.
- Refund reversal (Part 3, full-match case) is a real customer-invoice money write — Rung-3, Brett's tap only, never autonomous, same guardrail as every other QuickBooks credit/adjustment in this repo.
- Keep `test-verified-builds`' mandatory loop: generate tests from these acceptance criteria, run them, loop fix→retest until green, before this is ever reported done to Brett.
