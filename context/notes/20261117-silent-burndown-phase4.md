# 2026-11-17 silent-burndown-phase4 (scheduler and job handlers: the daily digest, health, the STR guard tick)

## CURRENT
Phase 4 of the silent-failure burn-down (`claude/silent-failure-burndown-handoff-nov17.md`). Baseline 681 -> 664 (worker.js 505 -> 488). Each handler was read in context.

Converted to reported failures:
- **Daily digest (`buildDigest`):** the five Sheets reads (Work_Orders, Vendor_Bills, Properties, Vendors, Tenants) no longer fall back to an empty list in silence. A failed read is reported once (P1) and the digest now carries a `warnings` list; the text Brett reads shows a SYSTEM HEALTH line "Could not read X (numbers below may be incomplete)". Before, an unreadable Vendor_Bills tab produced "No vendor bills awaiting review", which looked like good news.
- **Digest health alerts and stuck-receipts check:** a failed telemetry read or Config read is reported and shown. A corrupt `receipt_intake_failures` cell goes through `parseJsonCell` (reported once, falls back to none).
- **`inspStrGuardTick`:** a corrupt `STR_GUARD_NOTIFIED` cell used to be treated as empty with a console line, which can make the tick send guard notices again. It is now reported at P0 (behaviour unchanged). A failed prune write of that cell is reported (P1) and returned as `prune_error`.
- **`health` endpoint:** the config-presence checks reported a bare `false` when Config could not be read. They now add to a `warnings` list on the response. Plain environment-variable reads cannot throw, so their empty try/catch wrappers were removed.

Given a `silent-ok` reason (3): the deposit-sweep telemetry write (the error is rethrown and recorded by `schedStep`), the rejected-schedule telemetry write (the 400 response carries the message), and the digest's own success telemetry row.

Deliberately NOT in this PR (decided by reading, not by keyword):
- `vendorPaidJobs`, `scopeParsePaymentSchedule`, `processDepositPaidSweep` (money) go to Phase 3.
- `doorWatchdogCron` (door and texts) and `checkDeadManSwitch` (alerts) go to Phase 2.

## Pre-build gate
Shapes: `record list` (reporting added to existing handlers; no new endpoint, sheet, tab, column or screen). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main; BUILD_VERSION untouched.
SAFE under R-2: the digest and health paths read data and build text. Nothing here sends a customer text, touches money, QuickBooks, personal data, login or a schema. The one send-adjacent handler (`inspStrGuardTick`) only gains a report; its send logic is untouched, and a reporting failure cannot throw (helpers never throw). Easy to undo (revert the PR).
Silent-failure check: 17 swallowed handlers removed or reported, 3 given a real reason, none added. Reads add no extra Sheets call (`fetchTabSoft` wraps the existing `fetchTab`); reports are deduped once per digest run, so a Sheets outage cannot flood the ledger. Fault-injection test `test/digest-soft-failure.test.mjs` (13 checks) fails the reads, the telemetry, and the Config and asserts a report, a warning in the text, and that the digest still returns.

## Late requests
None.

## FEATURE_LOG
Rule: the baseline only goes down from 664 (worker.js 488). The digest must never say "all clear" when a read failed.
