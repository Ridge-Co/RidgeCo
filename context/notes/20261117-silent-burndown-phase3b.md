# Silent-failure burn-down, Phase 3b: QuickBooks send family and receipt reconciler

## Pre-build gate
- Shapes touched: `write` (invoice, bill and receipt stamps around a record that already saved), `read` (queue, settings, property and work order reads that decide what a receipt or invoice shows), `parse` (stored receipt and suggestion cells, add-receipt answers).
- GATED: money paths (QuickBooks invoice send and undo, receipt forwarding to QuickBooks, receipt add). Brett merges. Claude does not self-merge.
- No new endpoint, sheet or column. Behaviour is unchanged for every caller except one deliberate stop: `receiptReconScan` now stops with a plain error when the receipt queue cannot be read (it used to carry on with an empty list and re-add every Drive file as a new row).

## What changed
- `qbSendInvoice` and `qbSendCombinedInvoice`: unreadable bill receipts (P1), the send-to lookup (P1), a job that fails to be marked Invoiced after the invoice posted (P1), the duplicate-number check and loan preview (P2). Telemetry inside an already-reported error gets a reasoned `silent-ok`.
- `qbSendStandaloneInvoice`, `qbRepairInvoice`, `qbPayBills`, `qbUndoSend`: unreadable receipts (P1), loan-ledger reversal that failed (P1, a missing ledger tab is still not reported), photo share, repair flag and audit rows (P2).
- Receipt reconciler (`addReceipt`, `receiptReconScan`, `receiptReconConfirm`, `receiptReconRefundCandidates`, `receiptReconRefundReverse`, `receiptReconReassign`, `receiptReconSearch`): unreadable add answers (P1, the receipt may have saved), new id, queue read, settings read, suggestion and item parses (P2), property and work order reads (P2).
- `editVendorBillReceipts`, `approveInvoiceReview`, `sendReceiptsToQBEmail`: dupe check and unreadable new id (P1), attachment that could not be downloaded (P1, forwarded without the image), settings, queue, property and work order reads.
- `ensureColumns` call sites get `silent-ok` (it reports its own failure).
- Two existing tests adjusted for the new reporting calls: `receipt-expense-path` (harness gets `softFail` and `fetchTabSoft`) and `recon-scan-config-error` (source window widened).

## Tests
`test/money-receipts-qb-failure-reports.test.mjs` (30 source checks). Full suite run locally before the push.

## Still to do in Phase 3
`listReceiptReconQueue` parses, payables, `scopeParsePaymentSchedule`, `processDepositPaidSweep`, `scopeProposalSignedList`, `scopeProposalSign`, `receiptIntake`, duplicate audit functions, `moveVendorBillToNewWO`, the `qbFindOrCreate*` family and the remaining money-path `ensureColumns` sites.

Silent-failure check: baseline decreases only (worker.js 382 -> 343, total 558 -> 519); no new silent handlers.
