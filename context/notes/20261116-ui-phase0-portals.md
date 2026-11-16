# UI PHASE 0, PART B: portal fixes — 2026-11-16 — PR #555 into main, head `feat/ui-phase0-portals` (cut from PR A's branch `feat/ui-phase0-rc-ui`, which was cut from main tip 04a64dd), merged: no. DO NOT MERGE until Brett checks it on his phone. Merge #554 first.

## CURRENT
Customer-facing, interface only. Touches `vendor.html`, `tenant.html`, `owner.html`, `fix-check.html`, `push-client.js`. Loads rc-ui in the three portals; vendor PIN-box input rule scoped to `.login-card`; pale-green In Progress (and tenant/owner Complete/Paid) made readable; body 15px with a `<style id="rc-phase0">` floor so nothing renders under 13px and labels are 13px sentence case; bell (push-client `RC_PUSH_MOUNT` option, floating default kept) and tenant Feedback moved into the header; vendor extra-work photo pickers and fix-check picker are real buttons with sibling hidden inputs; tenant dates use `RC.date`.
Verified: inline scripts `node --check`; full suite 350/350 pass, no test changed; ui-check PASS on vendor/tenant/owner/fix-check (label_file_input fixed; detector tiny-text now 0); screenshots at 412/1366 opened and looked at.
Not verified: a real phone; real sign-in against the live Worker (mocked data only); screen readers.
Known gaps: source literals under 13px remain (static small_font count unchanged); typed-in-capitals strings stay capitals; vendor Paid-tab date left (a test pins its format); no new vendor strings so no Spanish entries.
Checklist (BRANCH_POLICY): PR #555 base main; head `feat/ui-phase0-portals`; no staging twin (no worker change); BUILD_VERSION, CURRENT.md, FEATURE_LOG.md untouched.

## Pre-build gate
No money, QuickBooks, login, PIN handling, SMS or visibility change; `worker.js` untouched; request payloads untouched. Existing guards (wo-status guard, version poll, mobile-input-font, mobile-tap-targets, pinned manifest + push-client tag) stay in place. Silent-failure check: date helper falls back to the old formatter, bell falls back to floating, missing rc-ui shows a red banner; no catch added.

## FEATURE_LOG
**[FL-20261116-portal-phase0]** Portals load rc-ui; `<style id="rc-phase0">` floor; `RC_PUSH_MOUNT` option in push-client.js (bell inside header when a page sets it, floating otherwise); vendor `input{}` PIN styling lives under `.login-card`; file pickers are button + sibling hidden input. Regression rules: keep the pinned `<link rel="manifest"…><script src="push-client.js" defer></script></head>` tag string; never re-add the global PIN styling to `input`; no new `capture=`.
