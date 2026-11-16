# UI PHASE 0, PART A: shared rc-ui kit — 2026-11-16 — PR #554 into main, head `feat/ui-phase0-rc-ui` (cut from main tip 04a64dd), merged: no

## CURRENT
New files only: `rc-ui.css`, `rc-ui.js`, `rc-ui-demo.html`, `test/rc-ui.test.mjs`, `test/manual-verify-rc-ui.mjs`. No existing page loads them except the demo, so merging this changes nothing anyone sees. Implements DESIGN.md: `--rc-*` tokens, `.rc-btn`, `.rc-chip` (one status map plus a role argument), `.rc-field`, `.rc-sheet`, `rcToast`/`rcConfirm`/`rcAsk` (promises), empty/loading/error states with retry, the "Thu, Nov 12" date helper, one config object (brand, logo, Worker address), and layout helpers at 700/1100.
Cache safety: version is pinned in three places (`RC_UI_VERSION`, `--rc-ui-version`, `?v=` on each tag), enforced by a test, and the page shows a visible warning if a shared file fails to load.
Verified: `node --check`; `test/rc-ui.test.mjs` 377 checks; `test/manual-verify-rc-ui.mjs` 23 real-browser checks all PASS; full suite `node --test test/*.test.mjs` 350 tests, 350 pass; ui-check on the demo page PASS (static counts all zero, detector no findings, no sideways scroll at 412/1366/1920); demo screenshots at 412 and 1366 opened and looked at.
Not verified: a real phone; screen-reader behaviour.
Checklist (BRANCH_POLICY): PR #554 base main; head `feat/ui-phase0-rc-ui`; no staging twin (no worker change); BUILD_VERSION, CURRENT.md, FEATURE_LOG.md untouched.

## Pre-build gate
Interface only. No money math, QuickBooks, login, PIN, SMS or visibility change. `worker.js` untouched. Silent-failure check: every unknown status, missing asset or bad call is reported (RC.report / visible banner), none swallowed; no empty catch (test enforced).

## FEATURE_LOG
**[FL-20261116-rc-ui-kit]** Shared UI kit `rc-ui.css` + `rc-ui.js` (version pinned `1`). Regression rules: the chip status map must cover every status in `wo-status.js` (test); tokens must equal DESIGN.md (test); no raw hex/off-scale sizes in the CSS (test); the three version strings must match (test). Tests: `test/rc-ui.test.mjs`.
