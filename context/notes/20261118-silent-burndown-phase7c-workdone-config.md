# 2026-11-18 silent-burndown-phase7c-workdone-config (invoice work-done path, recurring targets, Config read)

## CURRENT
Phase 7c, third batch, of the silent-failure burn-down (`claude/silent-failure-burndown-status-nov18.md`). worker.js 233 -> 231 (lint 409 -> 407). Every fallback value is unchanged; a corrupt cell or a failed read now reaches the failure ledger.

- **Invoice "Work completed" path (closes the gap named in the gates note):** `workDoneFromChecklist`, `workDoneBlock`, `workDoneWarnings` and `buildLaborDescription` now take `env` (and the WO id), so a corrupt checklist reports at P1 where the customer invoice text and the preview warnings are built, not only at the Complete gate and the share-link save. The lint could not see this one (the parse was already through `parseJsonCell`, just with no `env`, so nothing was reported). Callers: `buildInvoiceLines`, `scopeWorkDoneForInvoice`, the invoice preview.
- **P1, `recurTargets`:** a corrupt Targets cell on a recurring template read as "no targets", so the template quietly posted nothing. Now `parseJsonCell` at P1 with the template id; a blank cell is still not a failure. All 5 callers pass `env` (scheduler preflight, `processRecurringWorkOrders`, `recurPostNow`, `recurLinkTemplate`, the test-write guard).
- **P1, `fetchConfig`:** a failed Config read returned `{}`, so every setting (cutoffs, switches, scan folder) read as unset. Now reported at P1, at most once per isolate per 5 minutes (during a Sheets outage every call fails and the report is itself a Sheets write). It still returns `{}`.

NOT done here (still silent, next batches): the `assignVendor`, `woVoid`, `addTimeEntry`, `woTriageSet`, `woSharedRead`, `triageWorkOrder`, `createWorkOrder`, `woSplit` and `woCombine` rollback handlers, the `res.json().catch(() => ({}))` family on sends, and the telemetry sweep.

Tests: new `test/workdone-config-failure-reports.test.mjs` (18 checks, source checks plus runs of the real work-done helpers and `fetchConfig`); `recurring-wo.test.mjs` got a `parseJsonCell` fake and 3 new checks. Full suite 286 files, 0 failed.

## Pre-build gate
Shapes: `no new surface` (reports go to the existing failure ledger). Defaults taken: C1-C17; no cron; branch from main, PR into main; BUILD_VERSION untouched.
GATED: touches the customer invoice text path, the recurring scheduler and the Config read every request uses, so it waits for Brett's "merge". No invoice text, scheduler decision or fallback value changes. Easy to undo (revert the PR).
Silent-failure check: 2 swallowed handlers removed, none added, worker.js baseline 233 -> 231, decreases only; the work-done path now reports a corrupt checklist and keeps its old output.

## Late requests
None.

## FEATURE_LOG
Rule: a Config read failure and a corrupt recurring Targets cell report at P1 and keep their old fallback; the Config report is throttled to once per 5 minutes per isolate. The baseline only goes down from worker.js 231.
