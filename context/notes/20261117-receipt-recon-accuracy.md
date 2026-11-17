# 2026-11-17 receipt-recon-accuracy (brief written, build not started)

CURRENT: Brett listed 10 Receipt Reconciler problems on Nov 17. All traced to causes in live code/data and all design questions answered. Brief: `context/RECEIPT_RECONCILER_ACCURACY_BUILD_BRIEF_v1.0.md`. Resume with `resume ridgeco receipt accuracy`.

Key find: Properties ID 2 (inactive, no units, no WOs) duplicates ID 11 `928 N Calvert St`; `matchReceiptProperty` picks the first on ties, so receipts land on the empty twin. Vendor Invoice Inbox (Kayla/K&C) is design only, not built.

FEATURE_LOG rule entry: to be added when the build ships.
