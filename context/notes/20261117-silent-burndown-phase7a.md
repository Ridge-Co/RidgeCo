# 2026-11-17 silent-burndown-phase7a (reads: Deliveries, Trash and Inspection lists report unreadable tabs)

## CURRENT
Phase 7, batch A, of the silent-failure burn-down (`claude/silent-failure-burndown-handoff-nov17.md`). Baseline 639 -> 623 (worker.js 463 -> 447). 16 swallowed Sheets reads now report.

- **Deliveries (`deliveriesList`, 4 reads):** a failed read of Deliveries, Properties, Units or Tenants is reported once (P2) and returned in a new `warnings` list. Before, a failed Properties read showed deliveries with blank addresses and nothing said why.
- **Trash (`trashWeek`, `trashUnbilled`, `trashListProperties`, 7 reads):** same, with `warnings`. `trashUnbilled` powers the push nudge and reports at P1: an unreadable tab used to look like "nothing needs attention".
- **Inspection lists (`inspCustomersList`, `inspPropertiesList`, `inspUnitsList`, `inspAvailabilityGet`, 5 reads):** reported; `inspAvailabilityGet` also returns `warnings`.
- **Shape is kept.** `trashListProperties`, `inspCustomersList`, `inspPropertiesList` and `inspUnitsList` return a bare array that the pages depend on, so they report to the ledger only. Adding `warnings` to the pages that show it is Phase 8.
- **New `optional` flag on `fetchTabSoft`:** for tabs created on first use (the Trash and Insp tabs). A missing tab is an empty list, not a failure; any other error is still reported. Without it these handlers would file a problem on every fresh environment.

Deliberately NOT in this PR (read by hand, belong elsewhere): reads inside money, QuickBooks, text or auth handlers (vendorPaidJobs, sendVendorInvoiceConfirmationEmail, addEstimateVersion, depositApprove, sendReceiptsToQBEmail, scopeProposalSignedList: Phases 2 and 3); `hubTestWriteAllowed` (the write allow-list is GATED); the Receipt Reconciler reads (receiptReconScan, receiptReconSearch, receiptScan: Phase 3 with the reconciler); config reads that decide whether a text goes out (getAdminSmsRecipient, processEstimateReminders: Phase 2). The 58 `JSON.parse` catches are the rest of Phase 7 (batch B).

## Pre-build gate
Shapes: `record list` (existing list endpoints gain an additive `warnings` field and a ledger report; no new endpoint, sheet, tab or column). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main; BUILD_VERSION untouched.
SAFE under R-2: read-only handlers; no money, QuickBooks, personal data, login, customer text or schema. The responses only gain a field; arrays stay arrays. Easy to undo (revert the PR).
Silent-failure check: 16 swallowed reads removed, none added, baseline decreases only. Reads add no extra Sheets call (`fetchTabSoft` wraps the existing `fetchTab`); reports dedupe per tab per request. `test/reads-soft-failure.test.mjs` (14 checks) runs the real functions: a failed read warns and reports once, arrays keep their shape and status, a missing optional tab stays quiet, and a ledger that is down never breaks the page.

## Late requests
None.

## FEATURE_LOG
Rule: the baseline only goes down from 623 (worker.js 447). A tab created on first use is read with `optional: true`; a core tab is not.
