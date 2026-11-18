# 2026-11-18 silent-burndown-phase7b-money (JSON.parse fallbacks on money cells, GATED)

## CURRENT
Phase 7b, GATED money half, of the silent-failure burn-down (`claude/silent-failure-burndown-handover-phases-6-9-nov17.md`, status `claude/silent-failure-burndown-status-nov18.md`). worker.js 276 -> 264. 12 swallowed `JSON.parse` fallbacks on the cells that hold money, each read by hand. Every fallback value is unchanged; what changes is that an unreadable cell is now reported at P1 (it used to look like "no items" or a zero total).

- **Scope line items** (`scopeParseItems`, 11 callers, now take `env`): an unreadable list reads as "Scope has no line items" and could block an approval or a proposal. Reported with the scope id.
- **Proposal page and signing** (`scopeProposalView` items and signed selections, `scopeSigResolveParties` selections): the customer-facing page keeps its output; the problem now reaches the ledger.
- **Owner approval cards** (`ownerApprovalTotal`, `ownerApprovalCards`): an unreadable list still shows "Open to see price"; now reported.
- **Add-ons** (`addonParseItems` 4 callers, `addonList` estimate lines).
- **Estimate subtotal** (`estimateSubtotalOf`, `woMaxCeiling`): an unreadable estimate totals 0, so the vendor billing ceiling falls back to the max price. That is a decision made on empty data, so it is P1.
- **Estimate text and re-translate** (`generateEstimateText`, `retranslateEstimate`). `generateEstimateText` also swallowed a failed Estimates read inside the same try; that now reports through `softFail`.
- **Receipts on a vendor bill** (`buildInvoiceLines` 5 callers, `qbAttachReceipts`): unreadable receipts used to mean no materials line and no attachments, silently.

Found while here, NOT changed (not a `JSON.parse`, the lint does not see it): `maxPriceGateResponse` has `try { ceiling = woMaxCeiling(wo, await fetchTab(env, 'Estimates')) } catch (_) { ceiling = max; }`, so a failed Estimates read silently lowers the billing ceiling. Belongs to Phase 7c with the other gate reads.

Tests that load worker.js functions into a fake world (9 files) got a global `parseJsonCell` fake.

## Pre-build gate
Shapes: `no new surface` (no endpoint, sheet, tab, column, text, page or screen; reports go to the existing failure ledger). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main; BUILD_VERSION untouched.
GATED: touches the code paths for scope proposals, estimates, vendor billing and QuickBooks invoice lines, so it waits for Brett's "merge". No fallback value, total, line, text or QuickBooks call changes. Easy to undo (revert the PR).
Silent-failure check: 12 swallowed JSON.parse handlers removed, none added, worker.js baseline 276 -> 264, decreases only. `test/json-cells-money-failure-reports.test.mjs` (36 checks) covers P1 severity for each cell, env passed to every caller, the type checks kept, and runs the real parsers: an unreadable cell keeps its fallback and reports once with its record id.

## Late requests
None.

## FEATURE_LOG
Rule: a money cell (line items, proposal items, selections, estimate lines, receipts on a bill) is read with `parseJsonCell` at P1 and the caller passes `env`. The baseline only goes down from worker.js 264.
