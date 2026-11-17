# Vendor portal Spanish, finished and guarded — Nov 16 2026 — PR #563 into main, head `fix/vendor-spanish-complete-nov16` (cut from main tip 23e5ce7), merged: no
## CURRENT
Staging twin (test-only, not the path to main): PR #564 into staging, same branch.

Brett asked (Nov 16, again) for the vendor portal Spanish to be fixed everywhere. Cause: `vendor-i18n.js` swaps exact English strings, nothing checked it, so each new English sentence stayed English for Spanish vendors. Fixed:
- About 75 dictionary entries and 14 rules in `vendor-i18n.js` (messages, buttons, progress text, checklist, truck-stock question, server errors a vendor can see, the failure toast).
- `vendor.html`: `t()` falls back to the shared dictionary; "Unit" and month names translated; the login screen follows the saved choice, else the phone's language, with English / Español buttons; after sign-in the vendor's profile language wins and the page redraws once if the login screen was in the other language. Language saved in localStorage key `rc_vendor_lang`.
- New test `test/vendor-spanish.test.mjs` (+ `test/vendor-spanish-allow.json`): runs in the existing Unit tests check; fails on any English-looking text in vendor.html that the translator leaves English. Negative control: 2 of 3 tests fail on the old files. The allow list may only hold code/internal strings.

Verified: runtime crawl of the exact branch files against the staging Worker as the Spanish test vendor (all flows, injected abort/401/500/quota errors), 4 login-language scenarios, screenshots at 412 and 1366. Not verified: a real phone; a native Spanish speaker has not read the wording.

Open (Worker, separate PR): server error text is English unless the Worker sends Spanish (ask: `error_es` on every vendor-facing error); English work-order descriptions show in English when no translation is stored; the translator once saved an AI refusal sentence as a vendor note (skip one-word system values); `POST /vendor-bill/add` with no amounts returned success on staging.

Branch policy checklist: PR #563 base main (verified with get_pull_request below); head cut from main tip 23e5ce7; staging twin PR #564 listed separately; no temp commits on staging.
## FEATURE_LOG
**[FL-20261116-vendor-spanish-complete]** Vendor portal Spanish completeness. Regression rules: (1) any new English text in `vendor.html` needs Spanish in `vendor-i18n.js` ES_EXTRA / ES_RULES or the Unit tests check goes red; (2) never add a vendor-readable string to `test/vendor-spanish-allow.json`; (3) `t()` falls back to `esT()`; (4) the vendor's profile language beats the login-screen language after sign-in. Tests: `node --test test/vendor-spanish.test.mjs`.

## Silent-failure check
Nothing here swallows an error: a blocked localStorage logs `language choice not stored` / `session not stored before redraw` to the console and the page keeps working in the device language. A string the translator does not know stays English (visible, not hidden) and the new test catches it before it ships. Server errors that are not in the dictionary still show in English: listed above as open, not hidden.

## Pre-build gate
- Read first: CURRENT.md standing rules, BRANCH_POLICY, notes README, DESIGN.md login-screen rules (44px tap targets).
- Reuse: the existing translator (`esT`, ES_EXTRA, ES_RULES, MutationObserver); no new library.
- Smallest change: dictionary additions, one `t()` line, two "Unit" spots, two date spots, one small login block; no restyle.
- Not done on purpose: no Worker change in this PR (Worker not changed, cannot be tested from this repo's page tests).
