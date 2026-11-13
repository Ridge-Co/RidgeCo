# Problems badge hidden on tenant, vendor and owner pages (Nov 12 2026) — PR into main (staging twin listed in the PR), head `fix/hide-problems-badge-customer-pages-nov12` (cut from main tip 107d4c1), merged: no

Brett (Nov 12): the red "⚠ N problems" badge showed at the bottom of the owner portal while he was demoing it. He wants it on the Hub only, not on the customer pages, because a customer or prospect looking at those screens would see it.

## CURRENT
The badge is painted by `failure-reporter.js` only when an admin token (`mh_auth`) is saved on the device, so real customers never saw it; it showed on Brett's own phone/browser. Fix: new `CUSTOMER_PAGE` test (`tenant`, `vendor`, `owner`, with or without `.html`) added to the existing early return, so on those pages the badge is not painted and `/failures/open` is not even requested. Failure REPORTING (section 1: uncaught errors, failed API calls, `hubReportFailure`) is untouched and still reaches the ledger, so Brett still sees every problem on the Hub (Needs Attention / failures.html and the badge on Hub pages). Other customer-facing pages (owner-submit, submit, rsvp, ar-report, vendor-setup, owner-setup, owner-onboard, customer, inspect-book) are NOT changed; they keep the badge on Brett's own device.
Test `test/failure-badge-customer-pages.test.mjs` (13 checks): fails on old code for customer paths, passes now; Hub pages still request the badge; `hubReportFailure` on the owner page still reports. Reporter tests 3/3 files pass.
NOT verified: not looked at on a live phone; Brett reloads the owner portal on his device after merge (a cached copy of failure-reporter.js may need one extra refresh).

## Pre-build gate
Shapes: `ui` (client script). No server, data, message or cron change; not GATED. Fail-open/closed: reporting stays on; only the on-screen badge is skipped. Silent-failure check: nothing is silenced, failures are still written to the ledger and shown on the Hub.

## Known gaps
The separate friendly "something didn't work" toast still appears to anyone on a customer page when a failure is reported; not changed (not asked).

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261112-badge-hidden-customer-pages]** `failure-reporter.js` never paints the admin problems badge on tenant/vendor/owner pages (`CUSTOMER_PAGE`), reporting unchanged. Regression rule: any new customer-facing page that Brett may demo should be added to `CUSTOMER_PAGE`; never silence reporting itself. Test `test/failure-badge-customer-pages.test.mjs`.
