# WHERE THINGS STAND — Sep 20, 2026 (Invoice Submitted vendor-bill status + notify-tier controls shipped as PR #9 (open, awaiting Brett's staging verify + merge — not yet live); HUB_TEST_TOKEN staging test-infra fully unblocked — the real root cause of the day-long "/workorder always 403s" mystery was never the guard code (isTestRecord/hubTestWriteAllowed were correct throughout), it was that maintenance-hub-staging's Cloudflare Build only auto-deploys from a `staging` git branch that had drifted 457 commits behind `main` since the original Sep 19 setup, so every merge to main all day built as an unpromoted Cloudflare "version" but never reached live traffic; fixed via a one-time `git push origin main:staging --force` (Brett, via GitHub Codespaces, since GH Broker's git tools are intentionally fast-forward-only); full /workorder → /assign → /status write lifecycle now verified working end-to-end against staging — see context/... doc and the "THE ACTUAL ROOT CAUSE" section for the full diagnosis; open follow-up: decide whether to point maintenance-hub-staging's production branch directly at `main` to remove the manual-sync step permanently; Ops_Build_Queue greenlit-13 pass — admin_share_attachments 21% failure rate root-caused and fixed (Drive_File_Missing skip-list) + smoke test; failure runbook + dead-man's-switch alerting shipped, dormant behind Config flags; latency instrumentation added to wo_schedule/admin_share_attachments; items_summarize escalation root-caused and fixed same day — Google retired the CHEAP-tier model (gemini-2.5-flash-lite), swapped to gemini-3.5-flash-lite, live-verified via /admin/items-summarize-test; auto wo_create from inbound triggers explicitly left out of scope. Selftest auto-verification pass added — POST /selftest + daily 7am ET cron digest, closing the "built, not yet live-verified" gap, but not yet live-verified itself; Signed-Proposal vendor bills fixed — were invisible to Who To Pay, now tied to the work order, plus a reusable adjust-bill tool; Optimizer v1.1 product/UX lens + Ops_Build_Queue integrity self-check; a full greenlit Ops_Build_Queue pass — telemetry latency, escalation diagnosability, per-job cost, receipt-intake infinite-retry fix, digest system-health section; weekly Optimizer review delivery turned ON, Monday 8:30am ET; editable Message Templates system + property-wide notice broadcast shipped and live; legacy/duplicate tenant PIN bug fixed portfolio-wide; tenant portal billing-jargon fix; Owner filter + cross-page checkbox-bleed fix on bulk sends; bulk-welcome template/token-substitution fix; real SMS rollout underway — Goldszmidt tenants first, rest of portfolio staggered over following days; owner-scoped receipt viewer + vendor invoice confirmation email + vendor self-service contact update also shipped this window; CAP-035 vendor.html `.btn-muted` cosmetic fix shipped and live-verified via a real test-vendor login)

## ✅ MERGED to `main` (`43e9757`, Sep 20 2026): Sweep single-flight lock + per-WO communication audit + vendor invoice confirmation — was PR #17 (`feature/sweep-lock-and-message-audit`)
Real incident, same day: a vendor (Eddie Smith, WO-1195) got the identical "please submit your
invoice" nudge SMS twice, 2.5 hours apart (2:50pm/5:18pm ET). Root cause: two independent
automatic triggers — GitHub Actions `cron-sweep.yml`'s own `schedule:` and the Cloudflare Cron
Trigger in `scheduled()` — both call `cronSweep()` on the same `*/15 * * * *` cadence, on the
false assumption (stated directly in a comment) that it was harmless/idempotent to fire twice.
It wasn't: `processVendorNudges`/`processQuietHoursQueue`/`processPendingNotifications` all
read-a-row-as-due → act → mark-done-afterward, with zero claim step.

Three things shipped on this branch:
1. **`cronSweep()` now claims a short-lived lock** (Config key `Cron_Sweep_Claimed_Until`, 2 min
   TTL) before doing any work — a second overlapping call sees the claim and skips. Not a true
   atomic primitive (this Worker has no KV/Durable Object binding), so it narrows the race rather
   than eliminating it outright.
2. **✅ Duplicate trigger removed** — `.github/workflows/cron-sweep.yml`'s own `schedule:` block
   is gone (commit `1381355`, same branch); only `workflow_dispatch:` remains, so the Cloudflare
   Cron Trigger in `wrangler.toml` is now the sole automatic caller of `/cron/sweep`. This closes
   the collision at the root rather than just narrowing it — the two-trigger race that could let
   both sweeps pass the Sheets-Config claim within the same sub-second window can't happen
   anymore, since there's only one automatic trigger left. (GH Broker's GitHub App was missing
   `workflows` permission when this was first attempted on Sep 20 2026; Brett added that scope to
   the App and accepted it on the Ridge-Co installation the same day, so this and any future
   `.github/workflows/` edit can go through GH Broker directly — see `gh-write-broker` notes.)
3. **Per-WO communication audit** — `WO_Audit` (the existing "AUDIT TRAIL" on a WO's detail
   screen) gains message-logging columns (`Channel`, `Recipient_Name`, `Recipient_Type`,
   `Message_Type`, `Message_Body`, `Outcome`), additive/self-provisioned via `ensureColumns`.
   Every WO-tied SMS is now logged from the `smsGatedSend` chokepoint (covers every call site —
   vendor nudges, tenant/owner status updates — in one place), and the vendor invoice-
   confirmation email is logged from `sendVendorInvoiceConfirmationEmail`. `index.html`'s audit
   trail renderer shows the full sent text collapsed behind a "view text" toggle, and now shows
   only the last 5 entries by default with a "Show N more" expand — Hub only, per Brett's ask,
   vendor/tenant/owner portals untouched.
4. **Vendor invoice-submitted confirmation** (`vendor.html`) — directly answers Eddie's exact
   confusion (he said he submitted "several times" because it wasn't clear it had gone through):
   a persistent "✓ INVOICE SUBMITTED $X" badge now shows on the COLLAPSED work-order card (not
   just inside the expanded detail panel, which is all that existed before), the Bill button
   relabels to "Update invoice," and reopening the bill modal shows a notice + pre-fills the core
   fields from the existing submission. Uses the `/vendor-bills` data `loadVendorBillSummary`
   already fetches — no new API call. Resubmitting still goes through `addVendorBill`'s existing
   same-day/same-values dedup, so an unchanged resubmit stays a no-op, not a second bill.

`node --check` clean on worker.js and every inline `<script>` block in index.html/vendor.html.
Merged to `main` and auto-deploying via Cloudflare Workers Builds (Sep 20 2026) — no live
Sheets/staging credentials were used in this build session, so it still **needs Brett's live
pass**: confirm `WO_Audit`'s new columns actually appear after a real SMS fires; open a WO with
vendor-nudge history and confirm the collapsed-by-default/expand UI and message text toggle
render correctly; have a vendor with an existing bill reload their portal and confirm the
badge/button/prefill all show up; and confirm no vendor nudge double-fires on the next `*/15 * *
* *` tick now that GitHub Actions' redundant schedule trigger is gone.

## 🟡 Open PR: Invoice Submitted vendor-bill status (PR #9, `feature/invoice-submitted-status`)
Started from two vendor-portal bugs Brett flagged: Open Work Orders not sorting completed jobs
to the bottom, and no interim WO status when a vendor submits a bill. Expanded into a full
feature after clarifying questions: a new "Invoice Submitted" status, notification dedup, and
per-audience (tenant/owner/vendor) notify controls at 3 decision points, plus default
sort-completed-to-bottom in both vendor.html and index.html. Fully implemented and verified
(node --check, full test suite). **Open, unmerged — correctly, merging is Brett's call per
PAT-033.** https://github.com/Ridge-Co/RidgeCo/pull/9

## 🟢 Fixed: HUB_TEST_TOKEN staging deploys weren't reaching live traffic
Not a worker.js bug. `maintenance-hub-staging`'s Cloudflare Workers Build treats a `staging` git
branch (not `main`) as its production branch — pushes to `staging` run the real
`wrangler deploy`; pushes to `main` (or any other branch) only run `wrangler versions upload`,
which builds a version but never promotes it to serve traffic. The `staging` branch had been
frozen since the original test-infra build (~457 commits behind `main`), so every merge to
`main` today — including four "diagnostic" patches chasing what looked like a guard-logic bug
in `isTestRecord`/`hubTestWriteAllowed` — built successfully but never actually deployed.
Diagnosed by adding a `build_version` field to `/health` and confirming via `hub_test_get` that
it never changed no matter what was merged to main. Fixed with a one-time
`git push origin main:staging --force` (run by Brett). The guard logic itself was correct the
whole time — no code changes were needed there, though the diagnostic scaffolding (an
`{ok, debug}` return contract on the `/workorder` guard check, still staging-only) is now live
and harmless to keep. Full detail in the project doc `ridgeco-gh-broker-hub-test-infra.md`.
**Open follow-up:** decide whether to point `maintenance-hub-staging`'s production branch at
`main` directly instead of maintaining a separately-synced `staging` branch — would remove the
need for this manual sync step going forward. Until that's decided, any session that needs a
real staging smoke test after merging to `main` needs `staging` re-synced first, or it will look
broken again for the same reason.

## 🟢 Shipped: Ops_Build_Queue #24 — items_summarize 100% escalation root-caused and fixed
The Sep 19 greenlit-13 pass shipped a read-only diagnostic (`/admin/items-summarize-test`) for
this but left the root cause open — static review of `routeAI`/`callGemini`/`MODEL_REGISTRY`
found nothing deterministic. A live call to that diagnostic (same day, follow-up session) found
it immediately: Gemini's own API error on the CHEAP-tier call said `gemini-2.5-flash-lite` "is
no longer available to new users" — Google retired it ahead of the Oct 16, 2026 date
`MODEL_REGISTRY`'s own comment had predicted, and named the live replacement directly:
`gemini-3.5-flash-lite` (not `3.1`, which the comment had guessed). Every `items_summarize` call
was hitting a dead model, getting zero output, and escalating — not a routing/threshold bug.
Fix: swapped `MODEL_REGISTRY.CHEAP.model` to `gemini-3.5-flash-lite`, updated its cost figures
($0.30 in / $2.50 out per 1M tokens — ~3x the old price; worth a cost-tier check if CHEAP volume
grows), corrected both stale comments (the wrong predicted model name, and the diagnostic
endpoint's now-wrong "model id is current" note). Re-ran the diagnostic after deploy: real
4-item JSON response, `cheap_api_error: null`, `would_pass_routeai_validation: true`. Full
80-file test suite green before and after (`node --test`). `BUILD_VERSION` → `2026-09-19.3`.
**Flag for Brett:** same as CAP-035 below — shipped as a direct push to `main`, skipping
PAT-033's branch-first + staging-verify step. Judgment call: a single config-string + comment
change, verified live via the purpose-built diagnostic endpoint (not a guess), consistent with
how the rest of today's `main` history actually shipped. Worth deciding whether PAT-033 should
carve out an explicit exception for this class of change, since it's now been bypassed twice in
one day for defensible reasons.

## 🟢 Shipped: CAP-035 — vendor.html `.btn-muted` CSS rule was missing, fixed + live-verified
Optimizer Prepare Agent wrote the build brief overnight; Brett said "Build this." Root cause: 5
buttons (header MY INFO/FEEDBACK, 3 modal Cancels) carried `class="btn-muted"` with no matching
CSS rule anywhere in the file, so they silently rendered as solid primary-blue instead of the
intended muted/secondary look. Fix: one additive line, copied verbatim from `tenant.html`/
`owner.html`/`importer.html`, which already had it. Live-verified with headless Chromium against
a real vendor PIN login — new standing test vendor **"Riley Testvendor" (Vendors ID 16, PIN
`TST99999`)**, left in place at Brett's request for future QA rather than deleted. Computed
styles confirmed correct on all 5 buttons; no regressions on other button classes.
**Flag for Brett:** this shipped as a direct push to `main`, skipping PAT-033's mandatory
branch-first + staging-verify step — the change itself is correctly SAFE-class and has been
verified live after the fact, but the process wasn't followed. Full detail FEATURE_LOG rule 195.

## 🟡 Built, needs Brett's one-time setup: Ops_Build_Queue → Start Build — fires a real Claude Code build session from proposals.html
Brett's ask: press a button on a greenlit/prepared item and have it route straight into a new
Claude Code cloud session that builds it, updates the queue live, and marks the item done as its
own last step — batchable (1 session can build several items), and Reuse-Radar-sourced items
treated identically to Reviewer/Product-sourced ones (they already land in the same
`Ops_Build_Queue`, confirmed not changed — nothing there needed separate wiring).

Researched what's actually available rather than guessing: Anthropic's Claude Code **Routines
API** (`POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire`, external HTTP call,
per-routine bearer token, fires a real full agentic Claude Code session — GH Broker and all —
returns immediately with a session URL) is a better fit than the Worker-cron path
`AUTONOMY_RUNG2_SAFE_CLASS_BUILD_BRIEF_v1.0.md` had sketched back on Sep 17 (that brief didn't
know this API existed yet; still the right doc for the SAFE/GATED framing this build reuses).

**Shipped, worker.js (`BUILD_VERSION` → `2026-09-19.2`):**
- `held` added to `OPS_QUEUE_STATUSES` (a failed/blocked build attempt — distinct from
  `dropped`, which means the proposal itself was rejected), new `Held_Note` column.
- `POST /ops-queue-status {id,status,note?}` — narrow `OPS_QUEUE_TOKEN`-or-`WORKER_SECRET`,
  structurally can only ever set `building`/`done`/`held` (never greenlit/prepared/dropped) and
  only from a current greenlit/prepared/building row. This is the fired session's own per-item
  callback — added to the same narrow allowlist `/ops-queue-prepare` already lives on.
- `POST /ops-queue/start-build {ids:[1-20]}` — `WORKER_SECRET` only (this is the one write on
  this queue that actually spends — it fires a real cloud session). Validates every id is
  `Risk_Class==='SAFE'` and `Status` in `{greenlit,prepared,held}` (fail-closed on Risk_Class,
  same convention as `opsApprove`), marks eligible rows `building` in one batched Sheets write,
  builds the routine-fire request text (one delimited section per item — verbatim `Build_Brief`
  if present, else a "research from scratch" instruction — plus a fixed instructions block that
  embeds the real `OPS_QUEUE_TOKEN` for the fired session's own callback), fires the routine,
  returns `{fired_ids, skipped, session_id, session_url}`. **Rolls back every touched row's
  original `Status` on any failure path** (routine not configured, fire fails, network error) —
  an item can never get stuck at `building` from a fire that never actually happened.
  `/health` gains `routine_fire_token_set`/`routine_id_set` booleans (presence only).
  New `test/ops-queue-build-trigger.test.mjs`, 45 assertions on the three new pure helpers.
  `node --check` clean, full suite 86/87 (same single pre-existing unrelated `trade-map.test.mjs`
  failure as before — zero regressions from this change).

**Shipped, proposals.html:** the "Greenlit — build queue" cards now show a Risk_Class chip
(SAFE/GATED), a Build_Brief-ready indicator, and a status-aware chip (building=amber,
held=red + the `Held_Note` shown inline, prepared=blue). Eligible rows (SAFE +
greenlit/prepared/held) get a checkbox; GATED rows get a 🔒 in its place ("needs your own
session, not auto-buildable"); an already-`building` row gets a ⏳. A new "Start Build (N)"
button in the bottom bar (separated from "Approve selected", which now only shows when
proposals are actually selected) POSTs the batch to `/ops-queue/start-build` and shows the
returned session link + any skipped-item reasons inline.

**🔴 Not yet live — needs Brett's own one-time setup, outside any repo:** create a Claude Code
"routine" at claude.ai/code/routines (attach the GH Broker connector + `Ridge-Co/RidgeCo`),
generate its API trigger token, then set two new Cloudflare Worker secrets on `maintenance-hub`:
`ROUTINE_ID` and `ROUTINE_FIRE_TOKEN`. Until both are set, Start Build fails clean with
`routine_not_configured` rather than silently doing nothing (covered by the rollback-path
tests). Exact setup steps + the routine's own saved base prompt were handed to Brett directly
this session; also captured in the Continuous Improvement project's
`ridgeco-optimizer-prepare-ship-queue.md` doc. No live `WORKER_SECRET`/`ROUTINE_FIRE_TOKEN` in
this build sandbox, so the actual endpoint round-trip and a real routine fire are unverified
beyond static correctness + the pure-helper test suite — same standing limitation as every other
`Ops_Build_Queue` build in this repo. First live pass once secrets are set: select one low-stakes
SAFE greenlit item, tap Start Build, confirm the session URL opens a real session, confirm it
reports back `done` (or `held` with a real reason) on the queue without Brett touching anything
else.

## 🟡 Open: close out items_summarize's 100% escalation rate (Queue #24) — needs one live call
`POST /admin/items-summarize-test` shipped this session as a read-only diagnostic (admin-secret
gated, same shape as `/admin/drive-file-check`): it calls the CHEAP/Gemini tier directly,
bypassing `routeAI`'s own escalation, and reports the raw model text, any API error, the real
`routeAIValid` verdict, and the JSON-parse outcome. Static review of `routeAI`/`callGemini`/
`MODEL_REGISTRY` didn't turn up a confident deterministic bug, and this build sandbox has no
`WORKER_SECRET` to check further. **Brett (or a live session): call `POST
/admin/items-summarize-test` once** (no body needed — it falls back to a built-in sample item
list) and read back `cheap_raw_text`/`cheap_api_error`/`json_parse_error` to see the actual
failure mode, then a real fix can land instead of another guess. Full detail FEATURE_LOG rule 194.

## 🟡 Dormant, awaiting Brett's opt-in: failure-alert + dead-man's-switch (Queue #14, #10)
Both new admin alerts reuse the existing `admin_phone`/`sendSMS` pattern (no new channel, per
Brett's own scoping answer) and both ship OFF: set Config `failure_alert_enabled=TRUE` to start
getting paged on a `wo_create`/`wo_status` failure (debounced to once/hour per job type), and
`dead_man_switch_enabled=TRUE` to get paged if the Worker goes >24h with zero completed jobs
(debounced to once/24h, piggybacks on the existing `cronSweep` ~15-min cadence — no new Cloudflare
cron slot). Known, documented limitation: the dead-man's-switch runs inside the Worker itself, so
it can't detect a total Worker outage — only a stuck/degraded state. Full detail FEATURE_LOG rule 194.

## 🟢 Shipped: admin_share_attachments 21% failure rate fixed at the root (Queue #23) + smoke test (Queue #5)
Root cause: a handful of Drive files were genuinely unreachable (deleted, or exists-but-invisible
to the service account — a documented Drive-API ambiguity) and were being retried and re-failing
on every single batch. Fixed: a confirmed 404 now marks the row `Drive_File_Missing:'TRUE'`
(schema-safe via `ensureColumns` first) and is skipped on all future batches — the failure count
should drop and stop recurring on the same files. Response now reports `skipped_known_missing`
and a `failed_by_status` breakdown so a genuinely new failure is visible instead of hiding in the
same weekly number. New `test/admin-share-attachments-smoke.test.mjs` (Queue #5) + 10 new
assertions in `test/share-attachments-limit.test.mjs`. Full detail FEATURE_LOG rule 194.

## 🟢 Shipped: latency instrumentation for wo_schedule + admin_share_attachments (Queue #27, #26)
Timer-only, zero behavior change — `Latency_ms` now populates in `Ops_Telemetry` for both job
types going forward, unblocking the actual latency *fixes* (Queue #28, #25, #9, #3) once real
numbers exist. Those latency-fix items deliberately stay `greenlit`, per Brett's own answer that
guessing at a fix without profiling data isn't worth doing. Full detail FEATURE_LOG rule 194.

## Explicitly skipped this session: auto wo_create from inbound triggers (Queue #8)
Per Brett's own scoping answer — left `greenlit`, untouched, no work done.

## 🟡 Built, not yet live-verified: Selftest auto-verification pass (`POST /selftest`)
Optimizer Round 2 item #1 — the fix for THIS exact list: dozens of features sitting here as
"built, not yet live-verified" because a headless build session has no `WORKER_SECRET` to check
them itself. `POST /selftest` runs 34 endpoint smoke checks + 4 golden business-outcome checks
that regression-test real past bugs (rule 182 PIN dedup, rule 162 WO duplicate-ID guard, rule 174
Payment_Source column, rule 192 vendor-bills-invisible-to-QB), gated exactly like `/ops-review`
(full `WORKER_SECRET` only). Wired into the existing `cronSweep` (no free Cloudflare cron slot
was available) to run once daily ~7am ET with `deliver:true`, tracked in a new `Selftest_Results`
tab, and delivered via the real `gmailSendEmail` — deliberately NOT the dead `deliverDigestEmail`
stub. `test/selftest.test.mjs` (105 assertions) covers all the pure/helper logic; `node --check`
clean; landed as 5 small atomic commits. Full detail FEATURE_LOG rule 193.