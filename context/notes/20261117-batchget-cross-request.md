# BATCHGET CROSS-REQUEST 500s - Nov 17, 2026 - PR into main, head `fix/batchget-cross-request-nov17`, merged: no

## CURRENT
**Found by:** scheduled failure-fixer run. Ledger rows F-1794868510255-gvl8 (/hub-bootstrap 500), F-1794868508691-7iq3, F-1794588790624-r8hm (/vendor-workorders 500), F-1794581637195-ljf6 reopened Nov 16 21:10-22:35Z after being marked fixed on Nov 14. Their Fixed_In says PR #549, which is the QuickBooks token fix and did not cover this path.

**Root cause:** the Nov 13 fallback lives only in `sheetsRequest` (single-tab joiners). `fetchTabs` shares one `values:batchGet` between concurrent callers through `__batchInflight`; a joiner whose leader's request ended first gets "promise created by a request that has since ended" and the page 500s. `hubBootstrap` and the vendor list both use `fetchTabs`.

**Fix (worker.js):** `fetchTabs` now has `__readOwn`; a joiner that gets that exact error redoes its own batchGet. Any other error is thrown as before (no swallowing, no retry loop).
**Test:** `test/fetchtabs-cross-request.test.mjs` (5 checks on the real fetchTabs source).
**NOT verified:** the real Cloudflare error cannot be forced in a test, so it is proven against a fake that throws that message. The author session's shell was blocked, so the test result comes from CI only.
**Silent-failure check:** no new catch swallows; a second failure on the own read is rethrown (tested).

## Pre-build gate
Shapes: `endpoint`. Read path only: no money, QuickBooks, texts, login or personal data change. Easy to undo by reverting.
