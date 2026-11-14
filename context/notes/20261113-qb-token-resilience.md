# QUICKBOOKS "TOKEN EXPIRED / RECONNECT" FALSE ALARMS — Nov 13, 2026 — PR into main, head `fix/qb-token-resilience-nov13` (cut from main tip 4936702), merged: no

## CURRENT
**Ask (Brett, Nov 13 evening):** the Hub told him three times, in three places, that QuickBooks needed to be refreshed, although he had used it that morning and afternoon. "Dig in and find the cause. Solve it."

**Evidence (production failure ledger, read-only):** 8:22-8:28 PM ET (01:22-01:28Z): `/qb/send-invoice` 500, trash invoice 500, `/ar/invoices` 500, `/qb/accounts` 500, and one P0 "QB refresh token expired or revoked". One minute later `GET /qb/test` returned the Ridge Co company, so the QuickBooks login was fine. At 01:26:33Z, one minute BEFORE the P0, the ledger shows "This promise was created by a request that has since ended" and an HTTP 500 from `/config`: the Config read was failing.

**Root cause (two links):**
1. `qbAccessToken` read the saved refresh token with `fetchConfig`, which returns `{}` on ANY error. So a failed Config read looked like "no saved token" and the code silently fell back to `env.QB_REFRESH_TOKEN`, the deploy-time seed that Intuit rotated away long ago. Intuit answered `invalid_grant`, which the Hub reported as "expired or revoked, reconnect QuickBooks". Reproduced on the old code: Config read fails -> Intuit called with `STALE-SEED` -> that exact message.
2. What made the Config read fail: `sheetsRequest` shares one in-flight Google read between concurrent callers. If the request that started the read ends first, Cloudflare refuses to settle the promise in the joining request ("promise created by a request that has since ended"). The same error hit the vendor pages at 9:53 and 11:53 AM today (`/vendor-workorders` 500).
Aggravating: every `qbAccessToken` call (about 100 call sites) did a fresh Intuit refresh, so every call rotated the refresh token, and the new token was saved in a `catch(e){}` that hid a failed save.

**Fix (worker.js):**
- `qbAccessToken` rewritten: a failed Config read is never "no token" (clear "Google Sheets hiccup, not a lost QuickBooks connection" error, no P0 trigger words); the env seed is used only when Config was read fine and has no value; the access token is cached per isolate for ~55 min as a plain value (not a Promise); concurrent cold callers in one isolate wait for one refresh by polling; `invalid_grant` is reported only after the freshest Config token was tried too; a rotated refresh token is saved with a FRESH read-back, retried once, kept in memory, and a failed save writes Ops_Telemetry `qb_refresh_token_not_saved` and files a P1 ledger row.
- `qbApi`: a 401 drops the cached token and, when qbApi fetched the token itself, retries once with a fresh one.
- `sheetsRequest`: a joined read that dies with the cross-request error is redone as the caller's own read instead of failing.
**Tests:** `test/qb-token-resilience.test.mjs`, 24 checks on the real source (unreadable Config, seed rules, Config-first, save + read-back, caching, 6 concurrent callers = 1 refresh, rotated-by-another-request recheck, truly revoked, Intuit 503, failed save recovery, 401 handling, joined-read fallback). Full unit suite: 295 files, 0 failing (3m38s).
**NOT verified:** a real Intuit refresh from staging/prod after deploy; the cross-request error cannot be forced in a test Worker, so the joined-read fallback is proven only against a fake that throws that exact message.
**Silent-failure check:** every catch in the new code reports (rethrown with a plain message, or telemetry + ledger row). No `catch {}` left in the QB token path. `fetchConfig` itself still returns `{}` on error for its OTHER callers (not changed here; see Known gaps).

## Pre-build gate
Shapes: `endpoint` `external` `write` `job`.
- C-standing (money/QuickBooks): no QuickBooks write path changed; only how the login token is obtained. Rung-3 actions untouched.
- N: a "Reconnect QuickBooks" button (`/qb/connect`, `/qb/callback` are still reserved but unbuilt). Not needed for this cause; offered as a separate build.
- N: fixing `fetchConfig` returning `{}` on error for its other callers (auth config reads etc.). Larger blast radius, needs its own audit.
Companion actions included: failure-ledger row + telemetry on a failed token save; tests.

## Known gaps / next
- `fetchConfig` swallow remains for non-QB callers.
- Another isolate can still refresh at the same moment as this one (separate isolates do not share memory); the fresh-Config recheck on `invalid_grant` covers the common case.
- A real "Reconnect QuickBooks" button is still not built.

## Late requests
(none yet)
