# 2026-11-18 silent-burndown-phase7c-gates (reads that decide something now report)

## CURRENT
Phase 7c, first batch (gate reads), of the silent-failure burn-down (`claude/silent-failure-burndown-status-nov18.md`). worker.js 264 -> 246 (lint 440 -> 422). Every fallback and every fail-open / fail-closed direction is unchanged; what changes is that a failed read or write now reaches the failure ledger.

- **P1, a decision was made on empty data:** `woBulkVoid` (Vendor_Bills read: the vendor-bill leg of the "has money" check could not run), `findLockedVendorBillForWOs` (Invoice_Review read: the reassign lock ran on no review rows), `maxPriceGateResponse` (Estimates read: the ceiling silently fell back to the max price; that gap was found in 7b), `getVendorLoanBalance` (a real read failure returned a 0 balance; a missing tab is still just "no loans"), `setWoMaxPrice` (audit row), and the checklist: `parseChecklistItems` now goes through `parseJsonCell`, so a corrupt checklist (which read as "nothing unresolved" at the Complete / bill gate, and would be overwritten by a vendor's share-link save) is reported with the WO id. `env` is threaded through `checklistUnresolvedItems` and `mergeVendorChecklist`.
- **P2, display or side data:** vendor language lookups in the checklist and max price gates, `saveChecklist` audit row, `depositApprove` Properties / Units reads (address text for the QuickBooks bill; falls back to the WO's own address), the receipt reconcile read of Receipts.
- **silent-ok with a real reason:** the five `hubTestWriteAllowed` reads (a failed read makes the staging test-write guard refuse, the safe side), the `estimate_retranslate` telemetry row, and `scopeDepositInvoiceId`'s `paymentMilestonesTab` call (the Payment_Milestones read right after fails loudly if the tab is missing).

NOT done here (still silent): the invoice "Work completed" block and its preview warnings (`workDoneFromChecklist`, `workDoneBlock`, `workDoneWarnings`) call `parseChecklistItems` without `env`, so a corrupt checklist there still just prints no work-done lines. The gate and the save already report the same corrupt cell. Phase 7c second batch.

Tests: new `test/json-cells-gate-failure-reports.test.mjs` (20 checks); `wo-max-price` gained a `softFail` stub and now asserts the Estimates failure is reported P1 with the WO id; `invoice-work-done` got a `parseJsonCell` fake. Full suite 284 files, 0 failed.

## Pre-build gate
Shapes: `no new surface` (reports go to the existing failure ledger). Defaults taken: C1-C17; no cron; branch from main, PR into main; BUILD_VERSION untouched.
GATED: touches the max price gate, loan balance, deposit approval and the checklist completion gate, so it waits for Brett's "merge". No fallback value, gate decision, text or QuickBooks call changes. Easy to undo (revert the PR).
Silent-failure check: 18 swallowed handlers removed, none added, worker.js baseline 264 -> 246, decreases only; each decision-bearing read reports at P1 and keeps its old fallback.

## Late requests
None.

## FEATURE_LOG
Rule: a read that decides whether an action is allowed (bulk void money check, reassign lock, max price ceiling, loan balance, checklist gate) reports a failure at P1 and keeps its old fallback; a guard that fails closed on purpose carries a `silent-ok` saying so. The baseline only goes down from worker.js 246.
