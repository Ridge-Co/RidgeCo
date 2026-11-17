# 2026-11-17 silent-burndown-phase6 (ensureColumns: one central ledger report instead of 67 silent call sites)

## CURRENT
Phase 6 of the silent-failure burn-down (`claude/silent-failure-burndown-handoff-nov17.md`). Baseline 664 -> 639 (worker.js 488 -> 463).

**The fix is in one place.** `ensureColumns` already wrote a Telemetry row on every failure (rule 174), but nothing reached the failure ledger (Needs Attention), and 67 call sites swallow its throw. It now also reports a real failure to the ledger at P1 (`where` = `ensureColumns:<tab>`, `ref` = tab, the columns in the context), once per tab per isolate. The quota-busy case stays the calm P2 Telemetry row with no P1 (queue 216). The Telemetry tab never reports about itself (recursion guard). `reportFailure` writes through `ensureTab`, never back through `ensureColumns`, and has its own per-minute cap, so this cannot loop or flood. The original error is still thrown, so no caller changes behaviour.

**25 call sites** got `// silent-ok: ensureColumns reports its own failure to the ledger` (this is now true): createWorkOrder (2), addonWithdraw, woVoid, woBulkVoid, woCombine, updateStatus, retranslateEstimate, flagEstimate, setApprovalStage (2), backfillApprovalStage (2), logWOAuditMany, ownerUpdateWO, adminUpdateWO, logAttachment, addWishlistItem, setWishlistStatus, arReportLinkToken, arReportRevoke, woShareBuild, woShareRevoke, propertyUpdate (2).

Deliberately NOT touched (the central report already covers a failed column check there, but the handlers are money, text, QuickBooks, proposal or auth paths and get read by hand in their own GATED phase): addVendorBill (6), editVendorBillReceipts, sendVendorInvoiceConfirmationEmail, sendReceiptsToQBEmail, qbSendStandaloneInvoice, qbMapEntity, addEstimateVersion, woPushToScope, scopeToWO, scopeEstimate, scopeProposalSign/Send/LinkToken, addTimeEntry, approveInvoiceReview(+Bulk), vendorSetInstantPay, payAuthLog.

Also not in this PR: the ~119 non-`ensureColumns` write swallows. By hand most are telemetry or audit rows on a money, text or door path, so they belong to Phases 2 and 3. The few that are not (for example `strCalCheckLog`, `shiftTelemetry`, `deliveryTelemetry`) need a one-by-one read; that read is the remaining part of Phase 6.

## Pre-build gate
Shapes: `record list` (one reporting line in a shared function plus comments; no endpoint, sheet, column or screen). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main; BUILD_VERSION untouched.
SAFE under R-2: no money, QuickBooks, personal data, login, customer text or schema is changed. The only new behaviour is one extra ledger row when a header check really fails; callers get the same throw as before. Easy to undo (revert the PR).
Silent-failure check: 25 swallowed handlers now carry a true reason, none added, baseline decreases only. `test/ensure-columns-report.test.mjs` (11 checks) runs the real function: a real failure reports once per tab at P1 and still throws, quota-busy stays calm, the Telemetry tab does not report itself, a failing ledger never changes what the caller sees, and a failure is not memoized.

## Late requests
None.

## FEATURE_LOG
Rule: the baseline only goes down from 639 (worker.js 463). A new `ensureColumns` call site needs no catch of its own to be visible; do not add `silent-ok` to one outside the safe list above without reading it.
