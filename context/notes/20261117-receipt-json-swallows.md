# RECEIPT RECONCILER: REPORT FOUR SWALLOWED JSON READS — 2026-11-17 — PR (to open) into main, head `fix/receipt-json-swallows-nov17` (cut from main tip 382e515), merged: no (GATED: touches receipt confirm/auto-confirm and the QuickBooks email path, so Brett merges)

## CURRENT
- Four `.json().catch(() => ({}))` swallows added by PRs #575/#576 in the receipt reconciler now call `receiptJsonFail(env, where, err)`. It reports one P1 row (`source: receipt`, `where` names the call site) and returns `{}`, the same value the old catch returned. Success paths are unchanged.
  - `receipt.queue.add`: the Receipt_Recon_Queue row write (addedJson).
  - `receipt.auto.confirm`: the auto-confirm call (cj).
  - `receipt.cards.save`: the card-label Config save loop (j).
  - `receipt.rule.add`: the Receipt_Rules create (added).
- Why: `silent-failure-lint` counted these four as new silent handlers, so main's lint check (489 vs baseline 485) was red. The baseline is not raised. After this change `worker.js` is back to 485 and the total stays 664.
- `test/receipt-json-report.test.mjs` (new, 3 checks): extracts the real helper and checks it returns `{}`, reports once at P1, and passes the original error through.
- Local: lint pass; receipt and work-order test files all pass (`test/*receipt*` and `test/wo-*`), plus tripwires and pre-build gate.
- Unblocks PR #579 (Phase 0, rebased on current main): its CI lint check will match the 485 baseline.
- Not verified here: staging. These are read-path swallows, so a failure now shows as a ledger row. The live check is to watch Needs Attention for a `receipt` P1 row after the next receipt scan.

## Pre-build gate
Shapes: `write message` (receipt rows and a QuickBooks email on auto-confirm). Gated because it sits on the money path.
- C3 Nothing fails silently: Y. This is the fix itself: each of the four swallows now reports.
- C4 Verify the write, then the side effect: Y, unchanged. Auto-confirm still runs only when the queue row came back with an id.
- C5 Fail-open or fail-closed: unchanged. Each call returns `{}` as before, so the flow continues exactly as it did.
- C8 Branch from main, PR into main, Brett merges: Y.
- C9 GATED class (money/QuickBooks path): Y. Waits for Brett's merge.
- D7 QuickBooks no double post: n/a. No new post; the auto-confirm path is untouched apart from the report.
- D1 Sheets read quota: n/a. The report is a write, and only on failure.
- B1-B33 (customer-facing items): n/a. No text, page, or customer-visible output changes.
- Known gap: none for this change.
Companion actions included: the new test; this note.

## Late requests
(none yet)

## FEATURE_LOG
**[FL-20261117-receipt-json-report]** Four receipt-reconciler `.json().catch(() => ({}))` swallows now call `receiptJsonFail`, which reports P1 once per call and returns `{}` as before. Lint count back to the 485 baseline. Test: `test/receipt-json-report.test.mjs`.
