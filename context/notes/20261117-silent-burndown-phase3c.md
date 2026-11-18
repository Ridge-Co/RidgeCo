# Silent-failure burn-down, Phase 3c: proposal signing, QuickBooks id links, receipt duplicate checks

## Pre-build gate
- Shapes touched: `write` (links between our rows and QuickBooks ids, photo moves), `read` (tabs behind the signed-proposals page and duplicate checks), `parse` (stored schedule, items, selections and evidence cells, signature and milestone add answers), `sms` (the signed-proposal text).
- GATED: money paths (proposal signing and milestones, QuickBooks customer and vendor ids, duplicate guards). Brett merges. Claude does not self-merge.
- No new endpoint, sheet or column. Behaviour is unchanged for every caller: the signature, milestone, bill or receipt that saved is never failed because a side step failed. Each side step that fails is now reported.

## What changed
- `scopeProposalSign`: unreadable proposal items (P1), unreadable signature and milestone answers (P1), the admin and vendor "proposal signed" text failing (P0, the signature stays saved). `ensureColumns` sites get `silent-ok`.
- `scopeParsePaymentSchedule` now takes `env` (all four callers pass it): an unreadable schedule is reported at P1 before the default split is used.
- `scopeProposalSignedList`: Scopes read (P1), Properties and Vendors reads (P2), milestones read (P1, the page would fall back to the old deposit and final layout), receipts read and corrupt Selections cells (P2).
- `qbFindOrCreateCustomer` and `qbFindOrCreateVendor`: a found or newly created QuickBooks id that fails to be saved on the owner or vendor row is reported at P1 (the next send could create another). `qbLookupExisting`: a failed lookup that leads to a create is P1; the cached-list pass has a `silent-ok` because it falls through to the direct query.
- `moveVendorBillToNewWO` (photo that fails to move, P1), `processDepositPaidSweep` (milestones tab, P1), `receiptIntake` (vendor defaults P2, new id P1), `findRecentDuplicate` (fail-open duplicate guard, P1).
- Receipt duplicate checks: `receiptCheckDuplicatesOne` (Receipts read P1, suggestion parse P2), `qbInvoiceLineDuplicates`, `receiptReconCheckDuplicatesBulk`, `receiptDuplicateAuditBuildIndex`, `receiptDuplicateAuditFlags`, and the five JSON cells in `listReceiptReconQueue`.
- Two existing tests got fakes for the new reporting calls: `dupe-guard` and `receipt-accuracy-wiring`.

## Tests
`test/money-proposals-qb-link-failure-reports.test.mjs` (26 source checks). Full suite run locally before the push.

## Still to do
Payables, the remaining money-path `ensureColumns` sites and anything left over in worker.js go to Phase 9. Next up: Phase 5 (auth, session, PIN; read by hand), then 7b, the Phase 6 remainder, 8 and 9.

Silent-failure check: baseline decreases only (worker.js 343 -> 309, total 519 -> 485); no new silent handlers.
