# Silent-failure burn-down, Phase 3a: vendor bills, estimates, push-to-scope, vendor-paid jobs

## Pre-build gate
- Shapes touched: `write` (bill, estimate and Scope records and the stamps around them) and `read` (tabs that decide what a payment text names).
- GATED: money paths (vendor bills, estimates, Scope conversion, "your payment was sent" text). Brett merges. Claude does not self-merge.
- No new endpoint, sheet or column. Behaviour is unchanged for every caller: the saved bill, estimate or Scope is never failed because a side step failed. What changes is that each side step that fails is now reported to the failure ledger.

## What changed
- `addVendorBill`: hours that fail to link to a saved bill (P1, they could be billed again), the same for a re-submitted duplicate, the Work Order that fails to move to Complete (P1), a vendor that cannot be matched to QuickBooks (P1). Six `ensureColumns` calls get a `silent-ok` (it reports its own failure). The confirmation email reports its own failure at P0 (Phase 2).
- `addEstimateVersion`: unreadable max price (P1, the over-max check was skipped), stale `Current_Estimate` (P1), failed approval-stage update (P1), failed vendor-language lookup and translations (P2).
- `woPushToScope`: estimate not marked Converted (P1, it could be pushed twice and duplicate the items), corrupt estimate lines (P1, no longer mistaken for an empty estimate), translation and Source_Refs (P2).
- `vendorPaidJobs`: the Vendor_Bills, Invoice_Review, Payment_Milestones and Scopes reads now report instead of silently returning nothing (a paid bill is still listed as "Bill <number>", never dropped).
- `test/time-to-bill.test.mjs`: one source check updated to the new reporting call.

## Tests
`test/money-bills-failure-reports.test.mjs` (13 checks).

## Still to do in Phase 3
Receipt reconciler, payables, `scopeParsePaymentSchedule`, `processDepositPaidSweep`, QB invoice creators with `billEmail`, `qbSendInvoice` family, `qbUndoSend`, `scopeProposalSignedList`, the admin text in `addEstimateVersion`, and the money-path `ensureColumns` sites.

Silent-failure check: baseline decreases only (worker.js 402 -> 382, total 578 -> 558); no new silent handlers.
