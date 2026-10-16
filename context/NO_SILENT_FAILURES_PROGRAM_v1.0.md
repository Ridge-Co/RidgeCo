# No-silent-failures program: design (Oct 16 2026)

Brett's rule (Oct 16 2026, extends Oct 1 rule in `claude/silent-failure-audit-plan.md`): nothing, anywhere (Ridge Co, BarrelCo, every Worker, page, Apps Script, workflow, link), may fail without (1) being logged, (2) telling him, and (3) leaving a persistent on-screen message he can see. Failures should also reach Claude sessions automatically so they become part of the next build. Applies to new and old code. Build a skill if needed.

## Where we are (measured Oct 16)
- Plumbing exists but is dormant: `alertAdminOnFailure`, `callWithFailureAlert`, dead-man switch. Config `failure_alert_enabled` and `dead_man_switch_enabled` are off (Hub Settings has toggles; `/admin/set-alert-flags`).
- Code: worker.js has about 335 empty catches, 247 more "non-fatal" or `_` catches, 37 swallowing `.catch(()=>...)`; the 50 HTML pages have 86 empty catches; 3 in Apps Script. Not all are bugs (some are benign probes), but none are visible.
- Ops_Telemetry (Aug 7 to now, 1,092 rows): 208 failures nobody was told about. Last 14 days: scheduler_job 106 (deposit_paid ok:false 97, mostly Oct 13 to 14), door_watchdog 12, deposit_sweep_not_found 12, Sheets read-quota errors (wo_status 7, unhandled_500 2), selftest 37/39 three times.
- LIVE NOW: Anthropic API credit balance exhausted since Oct 15 ~4 PM ET. 19 failures: receipt_parse, invoice_parse, fi_read_label, receipt_recon_scan. No alert was sent. `/health` also shows scheduler job `daily_receipts` overdue.
- Eight Workers (maintenance-hub, staging, gh-broker, str-automation, barrel-co, brett-os, pinterest-sync, listing-forge) and 12 repos have no shared failure reporting at all.

## Five ways things fail silently (the design covers each)
1. Swallowed errors (empty catch, `.catch(()=>null)`, "best-effort").
2. Success reported without proof (`ok:true` with no read-back). Example: Skip always said ok.
3. Absence: a job or worker simply stops running (nobody notices a missing event).
4. Failures that are logged but nobody reads (Ops_Telemetry today).
5. External dependency exhaustion or expiry (API credits, Twilio balance, QuickBooks token, Sheets quota, certificates).

## Design

### 1. One failure ledger (Hub sheet)
- `Failure_Events`: append-only, one row per failure, written with no read first (cheap, and Sheets read quota is itself a top failure cause). Columns: Timestamp, System, Source, Where, Ref, Severity, Message, Context.
- `Failures`: the deduplicated ledger, built from events by the 15-minute sweep. Columns: ID, Fingerprint (system + where + error class), Severity (P0/P1/P2), System, Where, Message, First_Seen, Last_Seen, Count, Status (open, acknowledged, fixed, wontfix), Notified_At, Fixed_In, Notes. A fixed item that recurs reopens itself.
- If Sheets itself is down, the reporter falls back in order: Gmail to Brett, then console log. The reporter can never throw and never be silent about its own failure.

### 2. Loud-by-default helpers (one per runtime)
- Worker: `reportFailure(env, {system, where, ref, err, severity})`, `verifiedWrite()` (write, re-read, compare), `guardAppendedIds()` (done, PR #335), `safe(env, where, fn, fallback)` as the replacement for `catch {}`.
- Pages: one shared `failure-reporter.js` included by every page: `window.onerror`, `unhandledrejection`, a fetch wrapper that reports non-OK or network errors. Users see a friendly "That didn't save, we have been notified" message, never a blank screen.
- Apps Script: `reportFailure_()` posting to the same endpoint; every trigger gets a failure-notification email as a second path.
- Other Workers and repos (BarrelCo and the rest): same endpoint with a low-privilege ingestion key (can only append events; rate limited). GitHub Actions: a final `if: failure()` step posts the run.
- Severity default by area: SMS, money, QuickBooks, auth, scheduler, billing/credits = P0; sheet writes and data integrity = P1; parsing, UI loaders, read paths = P2. Overridable per call.

### 3. Telling Brett
- P0: SMS and push immediately, any hour, repeated at most every 6 hours while the count rises.
- P1: one 8 AM digest (text plus email).
- P2: badge and ledger only, plus a weekly digest.
- Uses the existing alert plumbing once the two Config flags are on.

### 4. Persistent on-screen message
- Red "N problems" badge in the Hub header on every admin page (polls `/failures/open`, cached 60 s).
- "Needs Attention" page: grouped by system and severity, count, first/last seen, message, Acknowledge / Mark fixed / Won't fix. A "Copy for Claude" button produces a paste-ready brief (what, where, when, count, sample error, likely file).
- Non-admin portals: friendly user message plus silent report (see above).

### 5. Absence and truth checks
- Heartbeats: each scheduled job records last_ok; overdue becomes a failure. Today only `/health` shows overdue and nobody looks.
- Independent watcher in Apps Script (different infrastructure from Cloudflare): every 15 minutes it checks `/health` on every Worker, the ledger, heartbeats and GitHub Actions. If the Hub itself is down, it emails and texts directly.
- Daily invariants ("should-have-happened"): duplicate IDs per tab, Message_Queue rows pending too long or sent but still pending, assigned WOs with no text, vendor bills with no QB bill, stuck offers, Twilio balance low, QuickBooks token near expiry. Each failed invariant is a ledger item. This catches failures nobody thought to instrument.

### 6. Getting failures into Claude sessions
- Skill `no-silent-failures` (below): at the start of any build the session reads open failures (`/failures/open`, allow-listed for the read-only token), lists those in the area being touched, and folds the fixes into the build.
- P0 and P1 items still open after 24 hours auto-create an item in the existing Ops_Build_Queue so queue-driven sessions pick them up.
- `context/OPEN_FAILURES.md` kept fresh by the existing context-sync workflow so any session that loads context sees the list.

### 7. Stopping new silent failures
- CI lint gate (`scripts/silent-failure-lint.mjs`, wired like `bug-class-tripwires`): ratchet baselines per file so counts only go down; no empty or log-only catch, no swallowing `.catch` in changed code; a genuinely benign case needs a `// silent-ok: reason` comment, listed in the PR report.
- PR template line "Silent-failure check"; `test-verified-builds` gains a required fault-injection step (force the failure, prove it appears in the ledger and badge); `ridgeco-validate` fails on new silent paths.

### 8. Cleaning up old code
- Mechanical pass: a codemod converts every swallowing catch to `reportFailure(... severity by area ...)` using the enclosing function name; dedup and P2 default keep it from becoming noise. Benign ones get `silent-ok` after review.
- Human-reviewed passes by area, P0 first: SMS and email, money and QuickBooks, scheduler, auth, sheet writes, frontend loaders, Apps Script, then the other repos.
- Any function touched for any reason gets converted at the same time (the skill enforces this).

## Phases
- A1 Foundation (worker, additive): tabs, `reportFailure`, endpoints, sweep rollup, heartbeat wrapper, classification, alert policy, tests. Dormant behind the existing flags until Brett flips them.
- A2 UI: header badge, Needs Attention page, `failure-reporter.js` on all pages.
- A3 Watcher and invariants: Apps Script jobs, Worker health probes, GitHub Actions hook, dependency checks (Twilio balance, QuickBooks token, API-credit errors classified as P0 "billing" with exact instructions).
- B Gate and skill: lint, ratchet, PR template, skill, validator updates.
- C Burn-down of old code by area, one themed PR each.
- D Other systems: BarrelCo, gh-broker, str-automation, brett-os, pinterest-sync, listing-forge, Make/Zapier error notifications.

## Decisions (recommended default in brackets)
1. Alert policy P0 immediate SMS+push any hour, P1 8 AM digest, P2 badge and weekly [yes].
2. Brett turns on `failure_alert_enabled` and `dead_man_switch_enabled` in Hub Settings now [yes].
3. Friendly message plus silent report on tenant, vendor and owner pages [yes].
4. Ledger lives in the Hub sheet (`Failure_Events`, `Failures`) [yes].
5. P0 and P1 unfixed after 24 h auto-queued in Ops_Build_Queue [yes].
6. One themed PR per area; Brett merges SMS and money PRs [yes].
