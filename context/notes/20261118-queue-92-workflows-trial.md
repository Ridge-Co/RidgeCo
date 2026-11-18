# Queue #92 Phase 1 of 3: Workflows trial on staging (receipt scan as a Cloudflare Workflow) - Nov 18 2026 - PR (see below), head `feat/queue-92-workflows-trial`

## CURRENT
**Status: built and unit-tested; staging check and Brett's merge pending. GATED (it changes `wrangler.toml`: new `main`, new `[[workflows]]` binding, and adds routes to the Hub), so no session merges it.** Cut from main tip a9d31b3.

Brett moved #92 to queued by hand on Nov 17 (overrides the plan's WAIT verdict); his chat review said the `cloudflare:workers` import problem is not a blocker and should live in a separate entry file. Built exactly that.

**Phase 1 of 3 (the staging-only trial).** What exists now:
- `src/workflow-trial.js`: the flow, three restart-safe steps (`preflight` -> `scan` -> `finish`). `scan` calls the Hub's own `POST /receipt-recon/scan {max:5}` through the Hub's own fetch handler, so the existing receipt-scan code runs unchanged. No `cloudflare:workers` import, so node tests load it.
- `src/workflows-entry.js`: the only file that imports `cloudflare:workers`. Re-exports worker.js's default handler and `ReadMeterStore` unchanged, adds `ReceiptScanTrialWorkflow`. `wrangler.toml` `main` now points here.
- `wrangler.toml`: `main = "src/workflows-entry.js"` and `[[workflows]] name="receipt-scan-trial" binding="RECEIPT_SCAN_TRIAL"`. `crons = []` untouched.
- `worker.js` (+58 lines, additive): `POST /workflow-trial/start`, `POST /workflow-trial/report`, `GET /workflow-trial/status?id=`. All admin-only (in no ROLE_SCOPES list) and all answer 403 on production. `/workflow-trial/start` is also allowed for `HUB_TEST_TOKEN` (`hubTestWriteAllowed`) so a session can start a run on staging.
- Each step reports to `Ops_Telemetry` (`Job_Type` `workflow_trial_preflight|finish|failed`, `Latency_ms` = wall time of the scan step). A final failure is a `Success=FALSE` row, which `logTelemetry` also files in the failure ledger (Needs Attention).
- `force_fail_once` start switch: the `scan` step fails on attempt 1 on purpose, to prove the run resumes at step 2 and does not re-run step 1.

**Remaining (2 of 3 and 3 of 3, not built):** move one flow in production behind a switch that starts OFF; put `judge()` in front of the consequential step. Also not in Phase 1: a scheduler job that starts a run every few hours (the brief's one-week measurement needs repeated runs; for now a run is started by hand with the start route, see "Needs a human").

**Tests:** `test/workflow-trial.test.mjs` (46 checks): fake Workflows runtime with cached steps, retries and `ctx.attempt`; forced failure resumes at step 2; replaying a finished run writes nothing new; permanent failure reports `failed` and ends errored; a refused report is retried then surfaced; the real route handlers cut out of worker.js (403 on production, missing binding 503 + failure row, create/status errors shown, failed telemetry write answers 500); wiring checks on `wrangler.toml` and the entry file.

**NOT verified:** that the Workflow actually deploys and runs on Cloudflare (nothing in this session can run Cloudflare's runtime; only the test-only staging PR can show it); CPU per step against the 10 ms Free limit (code cannot measure its own CPU; wall ms is recorded, read CPU on the Cloudflare Workflows page); that production and staging can both deploy from this file (see risk 1 in the PR).

**Needs a human:** (1) merge the PR; (2) after the staging deploy, start a run: `POST /workflow-trial/start` on staging (add `{"force_fail_once":true}` once), read `GET /workflow-trial/status?id=`; (3) after a week, write the keep/drop result under "Late requests" or a new note.

## Pre-build gate
Shapes: `endpoint` `job` `external` `write`. Nobody was available to ask (scheduled run), so every item took its default or the safer option.

Items that are N or partial (known gaps):
- B31 Settings, not constants: N. The retry limit (2), the 30-second delay, the 2-minute step timeout and the `max:5` scan size are constants in `src/workflow-trial.js`. This is a trial; they become settings only if the trial is kept.
- D10 Scheduled job = two places: N. No scheduler job in Phase 1 (a run is started by the start route). If kept, a `workflow_trial` SCHED_JOBS entry and a JOBS row come with Phase 2.
- D9 Staging can't prove external systems: partly. The receipt scan reads Drive and may call AI on staging's own data; the Workflows runtime itself can only be proven on the real staging deploy, not in node.
- D1 Sheets read quota: the scan step costs exactly what one scheduler `receipt_recon_scan` costs (it is that code); the start/report/status routes add at most one Ops_Telemetry append per step (3 per run). No extra reads.
- B27 Where else will he look: N. A failed run reaches Needs Attention through the failure ledger; there is no new page and no trial dashboard.
- C13 Manual steps for Brett: listed under "Needs a human" above.

Defaults taken: staging-only (production answers 403); a start switch is a boolean only (`true`); `workflow-trial/report` is not exposed to `HUB_TEST_TOKEN`; no new Sheet tab or column (C17 n/a); nothing sent to anyone (C15: 0 texts, 0 emails; the scan's own AI cost is what the scheduler already incurs).

Companion actions included: undo/rollback (delete the `[[workflows]]` block and set `main` back to `worker.js`; the scheduler path was never removed); failure visibility (C3: every step throws on failure so Workflows retries it, the final failure writes a failure-ledger row, the double-failure case is logged loudly); idempotence (a finished step is never re-run; the scan itself dedupes by file, and a report is one telemetry row); C2 no cron; C4 report failure answers 500 so the step retries; C5 fail-closed (any doubt = the run errors and says so); C8 branch first, main PR + test-only staging twin, `BUILD_VERSION` untouched; C9 GATED (wrangler config); C11 trial starts only when asked, never on its own; C17 n/a.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261118-queue-92-workflows-trial]** Workflows trial (queue #92 Phase 1 of 3). Regression rules:
1. **`src/workflow-trial.js` must never import `cloudflare:workers`**; only `src/workflows-entry.js` may (node cannot load that module and every test loads Hub code in node).
2. **`wrangler.toml` `main` is `src/workflows-entry.js`**; the entry re-exports worker.js's default handler and `ReadMeterStore` unchanged. A new named export from worker.js that Cloudflare needs (a Durable Object, a Workflow) must be re-exported there too.
3. **`/workflow-trial/*` is admin-only and answers 403 on production.** Do not add them to any ROLE_SCOPES list or to `HUB_PROD_WRITE_PATHS`.
4. **Every step failure throws** (so Workflows retries the step); the final failure is reported to `/workflow-trial/report` (a `Success=FALSE` telemetry row = failure-ledger row). Never swallow it.
5. **No cron.** A run starts only from `POST /workflow-trial/start`.
Tests: `test/workflow-trial.test.mjs`.
