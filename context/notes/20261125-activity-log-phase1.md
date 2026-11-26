# Activity Log Phase 0 + Phase 1 (queue #283) — Nov 25 2026 — head `feat/activity-log-283`, base main

## CURRENT
**Status: built and unit-tested offline (full suite 294 files, all pass); NOT run on staging; NOT merged. Waiting for Brett.** The queue row said it must ship in-session with Brett present (router seam, Durable Object migration, scheduler job), so the nightly runner opened the PR and stopped.

**Built (Phase 1):** one new tab `Activity_Log` (17 columns from the plan) and one recorder. Every non-GET request that finishes leaves ONE metadata-only event: who (role / id / how they got in), the action, which record (id only), field NAMES only, ok / refused / error. The hook sits in the `export default` wrapper after the response exists, runs in `ctx.waitUntil`, reads only `res.status`, and never throws. Events wait in a new SQLite-kind Durable Object `ActivityBuffer`; the scheduler job `activity_flush` (every 14 min) writes them in ONE batched append, READS BACK the rows it just wrote (only that range), and only then clears the buffer.
- worker.js: new block before the `export default` wrapper; one added line after `__meterIdentify`; one added line after the POST body is parsed; one SCHED_JOBS entry; one plain-English preflight line.
- wrangler.toml: binding `ACTIVITY_BUFFER` + migration `v2` (v1 untouched, crons still `[]`).
- HubScheduler.gs: one JOBS row (`activity_flush`, after `queue_sync` to match SCHED_JOBS order).
- Tests: new `test/activity-log.test.mjs` (49 checks). Updated because a new job exists: `test/scheduler.test.mjs` (job lists / counts, 26 -> 27) and `test/no-cron-anywhere.test.mjs` (JOBS rows 36 -> 37).
- A missing `ACTIVITY_BUFFER` binding never writes to the failure ledger from a request (that would add ledger rows to every request); the flush job files the P2 ("not bound") within 14 minutes.

**Phase 0 answers (from live code Nov 25 2026, plus the live /read-meter):**
1. *Single seam:* the `export default` wrapper runs once per request. 401s and 404s that return inside the core still reach it. `OPTIONS` returns early inside the core (line ~190) before auth; the recorder skips OPTIONS and GET/HEAD anyway.
2. *Actor identity:* Brett = the admin secret (`WORKER_SECRET`; `queueActorOf` already treats it as Brett). A Claude session uses a narrow token (`HUB_PROD_WRITE_TOKEN`, `HUB_PROD_RO_TOKEN`, `HUB_TEST_TOKEN`, `OPS_QUEUE_TOKEN`, `SCOUT_QUEUE_TOKEN`, `INTAKE_TOKEN`), so they ARE distinguishable (`activityViaFromToken` returns a label only). The scheduler token lives in Config, not env, so `/cron/run` is tagged by its path. Not distinguishable: a Claude session holding the admin secret itself; policy says sessions never hold it. No auth change needed, so no STOP.
3. *`logWOAudit` coverage:* NOT ANSWERED (not re-grepped route by route in this run). Phase 1 does not depend on it.
4. *`Ops_Telemetry` header and write volume:* NOT ANSWERED (no read route for it on the read-only token this run).
5. *Does the GH Broker record Hub calls:* NOT ANSWERED. `Ridge-Co/gh-broker` returned 404 to the broker's own list call (repo name or access differs).
6. *Voice capture / Tasks sync / Gemini archive state:* NOT ANSWERED (informational for Phase 2 only).
7. *Sheets headroom (live /read-meter, 30 min):* 118 reads, peak 41 in one minute (a cron tick), quota 60/min, 0 x 429. Normal minutes are 1-4 reads. The flush adds about 3 reads per 14 minutes (tab check, column check, read-back of only the new rows), roughly 0.2 a minute. That is more than the brief's "one read-back" (A9) because `ensureTab` and `ensureColumns` also read.
*Which requests count:* every non-GET/HEAD/OPTIONS request except `/failure/report`, `/telemetry/log`, `/cron/sweep`, `/ops-queue/risk-check`, `/read-meter` and any other `/cron/*` except `/cron/run`.

**NOT verified:** staging (nothing was deployed anywhere); the 12-route end-to-end check (A2); latency on vs off (A6); a real flush against the live sheet; that Cloudflare accepts the v2 migration on deploy. Unit tests cover the pure row builder, token labels, the buffer class (fake storage), the flush (fake Sheets: success, failed append, silent non-landing, ack failure, missing binding, kill switch) and source wiring.

**Needs a human (after merge):** (1) paste the `activity_flush` row into the Apps Script JOBS table (until then the Hub runs it on its default slot); (2) confirm the Cloudflare deploy accepted migration v2, then `/cron/status` shows `activity_flush` ran ok; (3) prod smoke: one real Brett action = one row after the next flush. Better still: do the staging test-only PR first with Brett present (branch policy item 4).

## Pre-build gate
Shapes: `write` `job` `record` `endpoint`. Nobody was available to ask (scheduled run), so every item took its default or the safer option.

Items that are N or only partly done (known gaps):
- A3 route-coverage test: N. Unlisted routes are still recorded as `post:/path` (ids folded to `:id`), so nothing is lost, but there is no test that fails when a new route lacks a readable name. 1 of 2 parts done.
- A2 end-to-end on 12 routes and A6 latency on/off: N. Needs staging (`hub_test_*`) in a session with Brett; not run here.
- A9 "zero extra reads": partly. About 3 reads per flush (see Phase 0 Q7).
- B31 Settings, not constants: partly. The kill switch is a Config flag (`activity_log_enabled`, checked at flush so there are zero Sheets reads per request); the 5,000-event buffer cap and the 14-minute flush are constants.
- B27 Where else will he look: N. No screen reads this tab yet (Phase 2+).
- B1 / B5 / B16 / B17: n/a (a log is append-only; nothing to edit, undo, bulk-edit or dedupe).
- Request_Text, Method, Session_Id columns are created but left blank (Phase 2 per the brief).
- Phase 0 questions 3, 4, 5, 6 unanswered (see above).

Defaults taken: record the action, never any value; kill switch default ON (log); unknown routes recorded with a generic name; flush discards rows when the kill switch is FALSE and says so in the job result.
Standing parameters: C2 no cron (SCHED_JOBS + JOBS row); C3 every failure goes to the failure ledger (P2, at most one per 30 min) and into the job result, and the three observation-only catches report instead of swallowing; C4 rows are read back before the buffer is cleared and the side effect (buffer clear) never fires after a failed write; C5 fail-open for the user (the hook can never block or change a response); C6/C7 no owner spend, no PINs, tokens, phones, emails, names or message text ever stored (tested with sentinels); C9 GATED-adjacent: touches the router and adds a DO migration, so left open for Brett; C11 new tab, blank means harmless; C12 no existing tab or column changed; C13 manual steps listed above; C17 `ensureTab` only on this NEW tab, `ensureColumns` on every flush.
Companion actions included: kill switch; dropped-event counter reported by the flush; missing-binding P2; read-back before clear.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261125-activity-log]** Activity Log Phase 1. 1. **Observation only:** the hook reads `res.status`, never the body, never awaits before returning, and never throws; any fault is a P2 (max one per 30 min). 2. **Metadata only:** ids and field NAMES, never values; `activityLooksLikeId` refuses emails and 10+ digit numbers. 3. **Buffer then batch:** `ActivityBuffer` (SQLite DO, cap 5,000, dropped counter) -> `activity_flush` one append -> read back only the new rows -> ack. No ack on any failure. 4. **`/cron/run` is `Source=scheduler`, `Actor_Role=scheduler`, never `brett`.** 5. **wrangler migration v1 is never edited;** new classes get a new tag. 6. **No role scope or public path lists `Activity_Log`.** 7. **A new scheduler job needs its name added to the lists in `test/scheduler.test.mjs`, the row count in `test/no-cron-anywhere.test.mjs`, and a preflight line.**
Tests: `test/activity-log.test.mjs`.
