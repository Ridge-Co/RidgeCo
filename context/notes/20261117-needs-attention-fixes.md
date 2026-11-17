# Needs Attention fixes: cross-request promise, SMS check email, queue sync GitHub 403 (Nov 17 2026) — head `fix/needs-attention-nov17` (cut from main), merged: no

## CURRENT
**Status: written and opened as a PR; NOT run locally (the build session had no usable shell), so the GitHub Unit tests check is the first real run. GATED: it changes what the SMS delivery check does when its email is held back (email-adjacent), so Brett merges.**

Ledger rows covered (Needs Attention, Nov 17 2026):
- F-1794619593801-52rc, F-1794588790624-r8hm, F-1794581637195-ljf6 (cross-request promise / `/vendor-workorders` 500) and F-1794868510255-gvl8 (`/hub-bootstrap` 500; its last-seen time is one second after the 52rc row's, so it is the same request). Cause: PR #549 retried the error only in `sheetsRequest` (single tab). `fetchTabs` shares one batch promise between requests and a joiner of an ended leader had no retry. Fix: joiner does its own read (`__isCrossRequestPromiseError`, one place). Test: `test/fetchtabs-cross-request.test.mjs`.
- F-1794744137851-q3be (`send_email: email send returned no confirmation`) and F-1794744130410-ffrw (clean SMS summary filed as P0). One cause: the demo safety guard held the clean-day summary email back (`demo_blocked`), the check counted "no confirmation" as a job failure. The cause itself was removed Nov 16 (D-20: demo record deleted). Fix: a demo-guard hold on a CLEAN-day email is a warning, the job stays green; a held-back ALERT email is still a failure; other no-confirmation failures now carry the sender's reason. Tests: new block in `test/sms-delivery-check.test.mjs`.
- F-1794918668628-m9oi (queue_sync GitHub 403, P0). Cause: the 15-minute tick already treated 403/429 as `rate_limited`, but the strict daily run (`hub_impr_daily`, 07:30 ET) did not and filed a P0 every morning. Fix: every mode treats it as `rate_limited`; if GitHub refuses EVERY lookup in a pass, ONE calm P2 (`queue_sync_github_blocked`) says so and names the fix. Test: `test/queue-sync-github-403.test.mjs`.

Needs a human: set a read-only GitHub token as the Worker secret `GITHUB_READ_TOKEN` in Cloudflare (code already uses it; never paste it into chat). That removes the rate limit at the source.

NOT done: F-1792537353924-mans (read-quota pressure; `/failures/open` is the top spender and should be cached; separate PR) and the ledger rows are not marked fixed (only after merge and deploy).

## Pre-build gate
Shapes: `job` `external` `endpoint`. Unattended fix of existing behaviour, no new screen: B-items about screens are N. C9 GATED: yes (email-adjacent). C3 silent-failure: every path still surfaces (warning text, P2 row, or job error). C12 no data changes.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261117-needs-attention-fixes]** Regression rules: (1) every shared-read joiner (single tab AND batch) must recover from the cross-request promise error through `__isCrossRequestPromiseError`; a new shared promise map needs the same. (2) A demo-guard hold on a clean SMS-check email is a warning; on an alert email it is a failure. (3) GitHub 403/429 in the queue sync is `rate_limited` in every mode; "every lookup refused" files one P2, never a P0. Tests: `test/fetchtabs-cross-request.test.mjs`, `test/queue-sync-github-403.test.mjs`, `test/sms-delivery-check.test.mjs`.
