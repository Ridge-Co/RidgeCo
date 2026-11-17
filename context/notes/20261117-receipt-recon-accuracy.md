# 2026-11-17 receipt-recon-accuracy (phase 1 built; wiring + UI not started)

## CURRENT
Brett listed 10 Receipt Reconciler problems on Nov 17 (plus an 11th at 2:42pm: a manual way to mark any receipt as a customer-card purchase). All traced to causes in live code/data; all design questions answered. Brief: `context/RECEIPT_RECONCILER_ACCURACY_BUILD_BRIEF_v1.0.md`. Resume with `resume ridgeco receipt accuracy`.

**Phase 1 (done, pushed on `feature/receipt-recon-accuracy`):** pure functions in worker.js, all unit-tested (`test/receipt-accuracy.test.mjs`, 93 assertions; helper `test/_receipt-engine.mjs`):
`matchReceiptCandidates` / `matchReceiptProperty` (skip inactive, tie prefers property with units/WOs), `receiptUnitHint`, `receiptWORef` (explicit / bare / ambiguous), `receiptPropertyHint`, `rankReceiptWOs` (+ closed within 30 days), `receiptCardStatus`, `receiptCardLast4Strict`, `receiptIsVendorInvoice`, `receiptDupSignals`, `receiptRuleDecision`, and `receiptSuggestCore` (new optional 6th arg `ctx = {units, myCards, vendorInvoiceNames}`; old callers behave as before).

**Phase 2 (not started):** wire the above into `receiptSuggest`, `receiptReconScan` (new extract keys, `existing` push, rules, vendor-invoice skip), `receiptReconFindRescanMatches` (+/-3 days, pending included; update `receipt-recon-rescan-guard.test.mjs`), `receiptCheckDuplicatesOne`, `listReceiptReconQueue`; endpoints `/receipt-recon/cards`, `/receipt-recon/rules*`, `/receipt-recon/mark-customer-card`; `Receipt_Rules` tab; allow-lists (worker.js `HUB_TEST_*` and gh-broker `src/index.ts`). **Phase 3:** receipt-reconciler.html (pickers, Cards panel, Rules, Auto-handled with Undo, duplicate banner, customer-card button), staging Playwright, live read-only check, ridgeco-validate, PR.

Key find: Properties ID 2 (inactive, no units, no WOs) duplicates ID 11 `928 N Calvert St`; the old matcher picked the first on ties. Vendor Invoice Inbox (Kayla/K&C) is design only, not built.

## Pre-build gate
Shapes: `record list message money ui endpoint write external`.
Defaults taken (no new questions needed): B1/B5 (every card field editable, undo restores), B15 history (Notes line + existing receipt audit), B17 duplicates (flag only, never auto-skip), B18 warn-don't-block (flags only; the one exception is Brett's own Q6 auto-confirm rule and the restorable vendor-invoice skip), B27 (same filter/sort as the existing queue), B28 (Auto-handled list is a collapsed group, last 14 days), B32 (loading/empty/error states on every new panel), B33 (390px, 44px taps, 16px inputs), C1-C17 standing parameters (no cron; ensureColumns before first write; new Config keys start empty = harmless; branch -> staging twin PR -> main PR, Brett merges).
GATED (C9): receipts flow to QuickBooks, new sheet tab `Receipt_Rules`, widens the write allow-list. Brett merges; money path reuses `receiptReconConfirm`, nothing new posts to QuickBooks.
N (known gaps): refund-to-purchase matching left as is (Q10); Vendor Invoice Inbox is a separate build; B16 bulk apply for rules is not in this build; B19/B26 n/a (admin-only, no customer-facing output, nothing vendor-facing).
Companion actions included: Cards panel, Rules list with deactivate (no hard delete), Auto-handled list with Undo, Mark-as-customer-card button, vendor-invoice name list in Config.
Silent-failure check: a failed Config/Rules read shows an error banner on the page and the row falls back to manual (never auto-confirms); an auto-confirm that fails leaves the row pending with a Notes line.
Fail mode (C5): if the rules or cards lists cannot be read, fail CLOSED (no auto-confirm, card status shown as unknown).

## Late requests
- Nov 17 2:42pm: a manual way to mark a receipt as a customer-card purchase when the reconciler misses it. Plan: a button on every pending row, "This was on a customer's card", which sets the row to the existing excluded customer_paid category (not billable), optionally records the last-4 on the customer list, and is undone with the existing Move back to Pending. Stored as `Manual_Customer_Card=TRUE` (added with ensureColumns), applied in the queue list handler like `Manual_Refund`.

## FEATURE_LOG
Rule entry to be added when the build ships.
