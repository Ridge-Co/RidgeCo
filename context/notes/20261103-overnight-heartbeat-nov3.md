# Overnight heartbeat: one morning report of what ran, failed or never ran (Nov 3, 2026)
Branch feat/overnight-heartbeat-nov3 (cut from main tip a41fe4f). Risk class: SAFE (read-only report; one email; one Config key; no money, PII, auth, schema or customer-facing text).

## What it is
A new DAILY scheduler job `overnight_heartbeat` at 06:45 ET (Apps Script clock, NO CRON) plus `GET /heartbeat/latest`.
It builds ONE plain report: every Hub scheduler job as ok / failed / overdue / never ran / paused / new / seeded / off, the Apps Script clock age, the home-PC overnight runner (`brett332/data` `home/status.json`: done / missed a night / stuck / unreadable) and the open Needs Attention counts.
Delivery: an email to Config `admin_email` (default Brett), never a text (standing rule R-1), plus Config `heartbeat_last` (JSON incl. a plain-text copy) that `GET /heartbeat/latest` returns. The read-only prod token reaches that route (it is a GET, not in HUB_PROD_RO_EXCLUDE_PATHS), so a build session can read it at the start with `hub_prod_get`.

## Rules (do not break)
1. No texts, ever, from this job. R-1 stands.
2. A thing that cannot be checked is reported as UNKNOWN in the report itself and is never counted as healthy. Home runner unreadable = level `attention` + one P2 Needs Attention row (`heartbeat_home_runner`).
3. Email failure, an email with no confirmation, a Config save failure, unreadable Config or corrupt scheduler state FAIL the job (named in `errors[]`), so /cron/status and the Apps Script watcher show it.
4. `retry: false`: once an email may have gone out the job is never retried the same day (`no_retry` also set).
5. `heartbeat_quiet_when_ok = TRUE` (Config, opt in) skips the email on a clean night; a problem or a could-not-check always emails.
6. Not in SCHED_STAGING_SAFE_JOBS: staging never emails a heartbeat.
7. The home runner is judged by `finished` (done), `started` (running longer than 8 h = stuck) and a 30 h limit (missed a night). Change HB_HOME_* constants, not the logic.

## Needs a human (Brett only; a session cannot set Cloudflare secrets)
The Worker has no way to read the private `brett332/data` repo until the secret `GITHUB_READ_TOKEN` (fine-grained, read-only, contents on `brett332/data` only) is set on the production Worker. Until then the report says "Home PC runner: UNKNOWN - the Hub has no GITHUB_READ_TOKEN secret" every morning. That is the intended loud fallback, not a bug. (The same secret also lifts GitHub's 403 for the ops-queue sync, B-20261013-1130-qc.) The Apps Script JOBS table needs the new row pasted in (it is in apps-script/hub-scheduler/HubScheduler.gs); until then the Hub-side job still has its default 06:45 slot.

## Tests
New `test/overnight-heartbeat.test.mjs` (55 assertions): home verdicts (done, missed, stuck, running, no finish time, other state, unreadable), job verdicts from real /cron/status shapes, report levels, rendering and HTML escaping, the GitHub fetch (no token = no request), the job (clean night, unreadable home, email failure, unconfirmed email, save failure, Config unreadable, state corrupt, quiet mode, quiet mode with a problem, Needs Attention unreadable, P2 row failing), the endpoint (fresh, stale, none, corrupt, 503) and wiring. Mutation-checked: loosening the 30 h limit or dropping the email-confirmation check fails tests.
Updated for the new registry entry: `test/scheduler.test.mjs` (order, first-tick seeding lists, counts 12 -> 13, 25 -> 26 jobs), `test/no-cron-anywhere.test.mjs` (34 -> 35 JOBS rows).
Full suite `node --test test/*.test.mjs`: 328 of 328 pass.

## Not verified
Not run on staging or production yet. The real GitHub read, the real Gmail send and the Config write are exercised only through fakes here.

## Silent-failure check
Every failure path above is returned in `errors[]`, shown in the report, or filed as a ledger row. No empty catch. Nothing is sent by SMS.
