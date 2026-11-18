# 2026-11-18 silent-burndown-phase7c-reads (tab reads that fall back to an empty list now report)

## CURRENT
Phase 7c, second batch (read fallbacks), of the silent-failure burn-down (`claude/silent-failure-burndown-status-nov18.md`). worker.js 246 -> 233 (lint 422 -> 409). Every fallback value is unchanged; what changes is that a failed read now reaches the failure ledger.

- **P1, a write or a repair ran on empty data:** `backfillReceiptAttachments` (an unreadable Attachments tab hides the already-linked list, so a rerun with `apply` could add duplicate gallery rows), `arReportSetOptIn` (an unreadable opt-in tab hides the owner's existing row, so a second row could be added), `qbApprovedReceipts` (the invoice repair path rebuilt its lines without the approved receipts; the total check catches it but the cause was invisible), and `proposalRegistry` (a corrupt `PROPOSAL_CONFIG` secret made every proposal read as unknown; reported once per isolate, not on every call).
- **P2, display or admin reads:** `backfillScopeWOVendor` (Scopes, Work_Orders), `backfillReceiptAttachments` (Receipts), `receiptsImageCheck` (Receipts, Receipt_Recon_Queue), `scopeProposalPhotos` (the proposal page shows no photos).
- **silent-ok with a real reason:** the three `fetchConfig(env).catch(() => ({}))` lines in `receiptCustomerCards`, `receiptReconSkipBeforeCutoff` and `scopeDriveList`. `fetchConfig` swallows its own errors and never throws, so the catch is a spare that cannot fire.

NOT done here (still silent, next batch): `recurTargets` (a corrupt Targets cell on a recurring template reads as "no targets"; five callers need `env` threaded first), `fetchConfig` itself (cannot report a Sheets outage through Sheets; needs a `silent-ok`), the `res.json().catch(() => ({}))` family on money and email sends, and the telemetry sweep.

Tests: new `test/read-fallbacks-failure-reports.test.mjs` (18 checks, source checks plus runs of the real `qbApprovedReceipts`, `scopeProposalPhotos` and `proposalRegistry`). No other test needed a change. Full suite 282 files, 0 failed before the new test was added.

## Pre-build gate
Shapes: `no new surface` (reports go to the existing failure ledger). Defaults taken: C1-C17; no cron; branch from main, PR into main; BUILD_VERSION untouched.
GATED: touches the QuickBooks invoice repair read and the owner AR report opt-in, so it waits for Brett's "merge". No fallback value, gate decision, text or QuickBooks call changes. Easy to undo (revert the PR).
Silent-failure check: 13 swallowed handlers removed, none added, worker.js baseline 246 -> 233, decreases only; the reads that feed a write or a repair report at P1 and keep their old fallback.

## Late requests
None.

## FEATURE_LOG
Rule: a tab read that feeds a write (backfill dedupe, opt-in upsert) or a repair reports a failure at P1 and keeps its old fallback; a catch that cannot fire carries a `silent-ok` saying so. The baseline only goes down from worker.js 233.
