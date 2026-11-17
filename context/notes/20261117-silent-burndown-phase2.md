# Silent-failure burn-down, Phase 2: send paths (alerts, texts, emails)

## Pre-build gate
- Shapes touched: `message` (alerts, owner/tenant/vendor texts, emails) and `write` (the stamps that record a send).
- GATED: it touches customer-facing texts and the alarm path itself. Brett merges. Claude does not self-merge.
- No new endpoint, no new sheet, no new column. Behaviour changes are limited to: failures now reach the failure ledger (severity P0 for undelivered alarms and customer texts, P1 for lost stamps/writes, P2 for logs and translation), a refused text is no longer counted as sent, and `processEstimateReminders` sends nothing when settings cannot be read (it claims the day in Config first, so guessing "not yet" could double-send).
- Pages now get `warnings` where a send succeeded but its record did not save (`scopeProposalSend`, `addonOwnerNotice`).

## What changed
- New pure helper `sendFailure(r)`: tells a real refusal from skipped/staged/held/delivered results.
- Alarm path: `alertAdminOnFailure`, `callWithFailureAlert`, `checkDeadManSwitch`, `doorWatchdogCron`, `inspAlert`, `strSystemAlert`, `aiCreditMaybeAlert`. An undeliverable alarm is reported P0 and no longer stamps its debounce.
- Customer sends: `addonOwnerNotice`, `sendVendorInvoiceConfirmationEmail`, `woCombine`, `woSplit`, `addWONote`, `adminUpdateWO`, `ownerOnboardSubmit`, `sendTemplatedSms`, `queueNotification`, `scopeProposalSend`, `arRemind`, `arReportSend`, `smsGatedSend`, `sendCustomMessage`, and related helpers.
- Silent-failure baseline: total 623 -> 578 (worker.js 447 -> 402).

## Deferred
- QB invoice `billEmail` sites: Phase 3. Assign swallows and the `woCombine`/`woSplit` rollback message: Phase 6. `gmail*` `.json().catch(()=>null)`: Phase 9 annotation.

## Tests
`test/send-failure-reports.test.mjs` (35 checks) plus an added check in `test/door-watchdog.test.mjs`.

Silent-failure check: baseline decreases only; no new silent handlers.
