# 2026-11-18 silent-burndown-phase7b-safe (JSON.parse fallbacks on config cells, notes and outside text)

## CURRENT
Phase 7b, SAFE half, of the silent-failure burn-down (`claude/silent-failure-burndown-handover-phases-6-9-nov17.md`). Baseline 468 -> 452 (worker.js 292 -> 276). 16 swallowed `JSON.parse` fallbacks, each read by hand.

- **Now reported through `parseJsonCell` (behaviour kept: same fallback, blank stays quiet):** `receiptCardLabelsFromCfg` (P2, now takes `env`), `scopeGet` and `scopeIngest` source refs (P2, with an array guard), `triageSla` (P2, now takes `env`), `vendorWorkorders` and `woSharedRead` trade access defaults (P1, they decide what a vendor may see), `processRecurringWorkOrders` skip memory (P1), `backfillItemsSummary` Items (P2, was a comment only), `inspStrConfig` STR guard fixture (P2, was console only).
- **Found wrong:** `triageSla` carried a comment saying `triageWorkOrder` reports a bad value. It only reports the keywords. A bad SLA setting was silent; it now reports.
- **Reported without changing the parse:** `approveReceiptQueue` learning a vendor default. It keeps the strict `JSON.parse` on purpose: using the fallback there would overwrite a corrupt map with a one-entry map. The catch now calls `softFail` (P2).
- **`silent-ok` with a real reason (6):** `scopeParseJSON` (callers tell the user the model answer was unreadable, or keep the original wording), `routeAIValid` (a non-JSON answer IS the validity result; routeAI records it and escalates), `hubTestWriteAllowed` pricing_config (an unreadable value is refused, so this fails closed), `fiExtractJson` x2 and `fiLdNodes` (text from models and outside web pages).
- **Tests that load worker.js functions into a fake world** (`wo-triage`, `fewer-sheets-reads`, `str-cleaning`) got a `parseJsonCell` fake.

Deliberately NOT in this PR:
- **The money cells (12 handlers) are the GATED second half of 7b:** `scopeParseItems`, `scopeProposalView` x2, `scopeSigResolveParties`, `ownerApprovalTotal`, `addonParseItems`, `addonList`, `estimateSubtotalOf`, `retranslateEstimate`, `generateEstimateText`, `buildInvoiceLines`, `qbAttachReceipts`.
- **`parseChecklistItems`:** a corrupt checklist reads as "no unresolved items", so it feeds the checklist gate. It is a pure helper with four callers; it goes with `checklistGateResponse` in Phase 7c.

## Pre-build gate
Shapes: `no new surface` (no endpoint, sheet, tab, column, text, page or screen; reports go to the existing failure ledger). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main; BUILD_VERSION untouched.
SAFE under R-2: reporting only; no money, QuickBooks, personal data, login or customer text is read differently. Every fallback value is unchanged. Easy to undo (revert the PR).
Silent-failure check: 16 swallowed JSON.parse handlers removed or given a real reason, none added, baseline decreases only (468 -> 452). `test/json-cells-safe-failure-reports.test.mjs` (27 checks) covers severities, kept behaviour, the silent-ok reasons, and runs the real `receiptCardLabelsFromCfg` and `triageSla` to show an unreadable cell keeps its fallback and reports once.

## Late requests
None.

## FEATURE_LOG
Rule: the baseline only goes down from 468 (worker.js 292). A helper that parses a config cell takes `env` so a corrupt value can be reported; pass it from the caller.
