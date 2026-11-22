# Queue #262 uptime watcher covers the Hub /version and the four portal pages — Nov 22 2026 — head `feat/queue-262-uptime-pages` (cut from main tip 02f94e7)

## CURRENT
PR number and base are in the PR itself (PR -> `main`). Not merged by the runner: it adds an HTML comment to the four customer-facing pages (index, vendor, tenant, owner), so Brett merges. BUILD_VERSION and CURRENT.md untouched.

Built (Phase 1 of the brief only): `PROBES` in `apps-script/hub-scheduler/HubScheduler.gs` gains optional `path`, `expect`, `kind` and five rows: `hub-version` (Hub `/version`, must contain `"version_id"`) and `page-hub`, `page-vendor`, `page-tenant`, `page-owner` (GitHub Pages, must contain the page's own name text). `probeWorkers_` now says DOWN (no answer, HTTP 0, 5xx, 404 or a redirect on a page) or "answers but its content is wrong" (200 without the expected text). Two misses in a row still needed, 6 h repeat, "back up" email, P1 ledger row `worker_probe:<name>`. A probe with no time left in the tick is skipped and logged, never counted as a failure. Each page has a comment next to its `<title>` saying a probe reads that text.
Phase 2 (5-minute checks or an outside paid monitor): not built. Needs a spend decision; default is to skip it. No new timer, trigger or cron.
Needs Brett after merge: paste the updated `HubScheduler.gs` into script.google.com (the usual manual step). Until he does, nothing changes.
Verified: `apps-script/hub-scheduler/test/hub-scheduler.test.mjs` 350 / 350 (new checks: each page really contains its expected text; page 404, 500, thrown fetch, 301, wrong content, `/version` junk; one miss no alert, two misses one email; recovery once; ledger report once; original four rows unchanged; time guard). NOT verified: a real run inside Apps Script against the live pages, and that GitHub Pages answers the plain-text title to UrlFetchApp exactly as in the fake; the first live tick will show it (a false alarm would say which text was missing).

## Pre-build gate
Shapes: `job` `external` `message` (admin email only). No ui, record, money or role change.
Items that are N or n/a:
- C13 Smallest manual step list: the one paste above. Cannot be avoided: the Apps Script lives in Brett's Google account.
- D10 Scheduled job = two places: no new job row; the existing 15-minute tick is reused.
- B9 Who hears about it: Brett only (existing alert email + P1 ledger row). Tenants, owners and vendors are told nothing.
- B26 Spanish: n/a, admin only.
- B31 Settings, not constants: N. The two-misses rule and the 6 h repeat stay constants, as before.
- Phase 2, 5-minute checks / outside paid monitor: N (spend decision, default skip).
Defaults taken: Question 1 (15-minute checks are enough) and Question 2 (skip UptimeRobot). C1 no texts for Hub failures: email and ledger only. C2 no cron: none added. C3/C4/C5: a failed or skipped probe is logged and visible; an unreadable body counts as failed, not up (fail-closed). C6/C7: nothing private is read; pages are public. C9: SAFE (read-only GETs of public pages, internal alerting). C15 cost: 5 extra GETs per tick, no texts, no AI.
Companion actions included: "back up" email; throttled ledger row; test that reads each real HTML file so a later UI edit cannot silently break a probe; time guard for the 6-minute Apps Script limit.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261122-262-uptime-pages]** Rules: 1. A page row in `PROBES` must have `expect`, and the same text must stay in that page next to a comment that says so (test reads the real files). 2. A 3xx or 404 on a page row is down. 3. A skipped probe never counts as a failure. 4. Never move the scheduler tick to 5 minutes to get faster page checks (it would triple Hub dispatch calls).
