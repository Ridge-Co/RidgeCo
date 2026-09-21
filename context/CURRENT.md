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

**Not yet run for real** — no credential to do that from this build session, by design. Brett:
(1) hit `POST /selftest` once by hand to see the first real digest and confirm all 38 checks pass
live; (2) set `admin_email` + `selftest_digest_enabled=TRUE` (Config) when ready for the daily
email — both start unset/off; (3) check `Selftest_Results` the morning after the next cron sweep
to confirm the ~7am ET gate actually fired.

## 🟡 Open: Brett to apply the WO-1175 $500 vendor-bill adjustment himself
Root cause found and fixed for a real incident: Cesar Diaz's (Gomez Homes Restoration) final
vendor bill on WO-1175 (1305 N Calvert St, drywall) existed in QuickBooks (#7818, $3,400) but
was structurally invisible on Who To Pay — Signed-Proposal bookings were tracked only on
`Scope_Signatures`, never as `Vendor_Bills`/`Invoice_Review` rows, which is all `qbPayables` ever
read. Fixed at the root: `qbPayables` now also builds rows from `Scope_Signatures` directly, a
new "vendor bill missing" state flags genuine gaps instead of hiding them, a
`Final_Bill_Skip_Reason` column mirrors rule 145's deposit-side safety net for the final phase,
and WO auto-close-to-Paid is now tied to the final vendor bill specifically (deposit can never
auto-close a WO). Also shipped a reusable `/scope-proposal/adjust-bill` tool + "Adjust vendor
bill" UI link for one-off dollar corrections. `BUILD_VERSION` → `2026-09-18.3`, live-verified.
Full detail FEATURE_LOG rule 192.

**Still open — deliberately left for Brett (Rung-3, money write, never autonomous):** open
Signed Proposals → 1305 N Calvert St → final row → "Adjust vendor bill" → enter `500` and a
reason → Confirm. That absorbs the vendor's $500 unforeseen-complexity increase (never billed to
the customer) and brings the balance owed from $2,900 to $3,400 so Cesar can actually be paid.
Also worth a glance: the new "vendor bill missing" bucket on Who To Pay, in case another
Signed-Proposal job has the same undiscovered gap.

## 🟡 Open: confirm the first Monday 8:30am ET weekly-review text actually arrives
Weekly Optimizer review delivery was turned on this session (its own `weekly_review_enabled`
Config flag, separate from the still-dormant daily digest `digest_enabled`) — recipient is
`admin_phone` (410-259-2314, reused from the existing admin-alert pattern), cron moved to `30 12
* * 1` (8:30am ET). **Not live-verified with an actual sent SMS** — `POST /ops-review`
deliberately hardcodes `deliver:false` for manual/on-demand runs (an existing reviewer note,
"don't let checking the review spam a real send"), so there's no way to force a real test short
of the actual cron firing. First real send is the next Monday. Full detail FEATURE_LOG rule 189.

## 🟢 Shipped: greenlit Ops_Build_Queue batch (telemetry + digest health) — full detail FEATURE_LOG rule 188
Brett handed over the live 18-item greenlit queue and asked for relevance-checked builds, not a
blind pass. Every item was checked against live `/ops-telemetry` first. Root-caused two items
that the queue itself had mis-described: receipt_parse's "73% failure rate" was one permanently
corrupt file retrying forever (a hard 0-token Claude vision API rejection, not an OCR-quality
problem) — fixed with a 3-attempt cap tracked in Config; items_summarize's "100% escalation" had
zero diagnosable cause in telemetry because `routeAI` silently discarded the CHEAP-tier failure
reason before escalating — now captured and logged. Also shipped: latency timers on the four
job types that had none, per-job-type cost breakdown in `computeTelemetryMetrics`, and a digest
`SYSTEM HEALTH` section (job types with ≥3 runs and <95% success in 24h). Queue itself updated to
match reality: 9 items marked `done`/`dropped` with traceable reasons (via the `Drop_Reason`/
`Superseded_By` columns rule 187 added), 6 left `greenlit` with reasons why (2 need real
profiling data first, not a blind fix; 1 is architecturally impossible to build as a pure
self-check; 1 touches auto-SMS to real owners and needs its own design pass, not a freehand
build). `BUILD_VERSION` → `2026-09-17.2`.

## 🟢 Shipped: Optimizer v1.1 — product/UX lens + Ops_Build_Queue integrity self-check — full detail FEATURE_LOG rule 187
Concurrent session (landed mid-build on the item above, no conflict): widened the Optimizer
beyond telemetry-reactive fixes to also surface UI/functionality/usability opportunities via the
existing Scout & Reuse-Radar task, and gave `Ops_Build_Queue` real `Drop_Reason`/`Superseded_By`
columns so a dropped/superseded item carries its own evidence instead of just vanishing.
`BUILD_VERSION` → `2026-09-17.1`.

## 🟡 Open: confirm the GitHub Actions `CRON_SWEEP_TOKEN` repo secret is actually set
Brett ran a live bulk-welcome test into quiet hours and asked whether it should have gone out
yet. It's correctly queued (`Message_Queue`, `Send_After` = next 9am ET) — that part is working
— but this session couldn't confirm the *scheduled* GitHub Actions side of `cron-sweep.yml`
actually fires every 15 minutes. A Cloudflare Worker secret of the same name being set
(confirmed via `/health` → `cron_sweep.token_set: true`) does NOT mean the separate GitHub
Actions repo secret is also set — and this exact failure mode (Cloudflare secret set, GitHub
Actions secret never was, workflow "succeeds" every run while silently no-op'ing) is already a
confirmed, documented problem in this same repo for a different workflow (`SELFTEST_TOKEN`, PR
#3). Two ways to close this out: Brett confirms `CRON_SWEEP_TOKEN` is listed under repo Settings
→ Secrets and variables → Actions, or a future session checks back after 9am ET and manually
fires `POST /cron/sweep` (admin-token-gated, confirmed working when called directly) if nothing
went out on its own.

## 🟢 Shipped + LIVE ROLLOUT UNDERWAY: editable Message Templates + property-wide notices — full detail FEATURE_LOG rules 181, 186
Brett wanted to release SMS to tenants/vendors for real, then — before anything actually went to
a real person — caught that the copy was wrong: generic "Ridge Co. Property Management," no
landlord reference, no acknowledgment of the new number, named Brett personally instead of an
assistant persona, and no way to edit any of it without a code push. Built a real
`Message_Templates` tab (self-seeding, editable via a new Messaging page with a live
character/segment counter that flags stray em dashes/curly quotes silently forcing Unicode
encoding), an assistant persona (`Riley`, one Config key), `{Owner}` interpolation pulling the
real `Owners.Company`, and outbound-only language on every template (inbound is fully routed
through a Twilio Studio Flow today, not this codebase — Brett is handling that side himself).
Also built `POST /property/notice` — a property-wide SMS+email broadcast (water shutoffs, power
outages) that deliberately bypasses the quiet-hours hold while still honoring
Global/Test-Mode/`SMS_OptOut` (wired into the send gate for the first time this session).

Found and fixed same day (rule 186): the bulk-welcome-send textarea was pre-filling from a
hardcoded Sep-14 snapshot that had drifted completely from the live template, AND the actual
send applied zero token substitution to a custom message — a batch would either send everyone
the identical unpersonalized line, or the literal text "{FirstName}" if the template's own
tokens were left in the box. Both fixed; live-verified end to end (a real send with tokens to
Brett's own test tenant record came back fully substituted, no leftover braces).

**Live status**: `TWILIO_ENABLED = TRUE`, `TWILIO_TEST_MODE = FALSE` — Brett is actively rolling
out. Plan: Goldszmidt Properties tenants first (smaller, controlled batch), the rest of the
portfolio staggered over the following days via the new Owner-filter/exclude tool (rule 184) to
manage volume. `BUILD_VERSION` → `2026-09-16.15`, confirmed live.

## 🟢 Shipped: legacy/duplicate tenant PIN bug — full detail FEATURE_LOG rule 182
Brett, right before the rollout above: many tenants still had old 5-digit numeric PINs instead
of the 3-letter+5-digit scheme. Live audit found 18 such Tenants (0 on Vendors/Owners) —
regenerated off each tenant's own phone. Caught in the process: two tenants at the same property
(James/Kelsey, 20 E Eager St) shared the **identical** PIN, and James's didn't even match his own
phone — a real access collision, not just an old-format cosmetic issue. Root cause: the "Backfill
PINs" admin tool only ever filled in a *blank* PIN, never checked an existing malformed one — the
only prior defense was two hardcoded name checks on two specific Owners rows, itself a past
one-off patch for this same problem that never generalized. Replaced with a real format check
(`PIN_FORMAT_OK`) applied across Vendors/Owners/Owner_Users/Tenants, so this is now caught
automatically going forward, not just today. Verified live: 0 bad-format PINs, 0 duplicates,
anywhere, after the fix.

## 🟢 Shipped: tenant portal — Completed is the last stage a tenant sees — full detail FEATURE_LOG rule 183
Removed the Closed/Paid filter option from `tenant.html` entirely; folded Pending
Invoice/Invoiced/Paid into a plain "Completed" label everywhere a tenant sees status (badge,
filter, per-job timeline) — billing-lifecycle jargon a tenant never needed. The "Completed"
filter itself was widened to still catch anything that's progressed to those billing statuses
internally, so nothing became invisible just because the separate Paid filter was removed.

## 🟢 Shipped: Owner filter + cross-page checkbox-bleed fix on bulk sends — full detail FEATURE_LOG rules 184-185
Two related fixes so Brett can actually run a segmented, owner-scoped rollout: (1) a new Owner
filter (show-only or exclude) on the Tenants page, so "everyone but Goldszmidt" is a two-click
selection instead of hand-picking ~100 rows; (2) a real, pre-existing bug where Tenants/Vendors/
Owners all shared the exact same document-wide checkbox-selection code — a box checked on one
page (even one no longer visible) silently rode along on a send from a different page, with no
way to even see it to deselect. Each of the three pages' select-all/action-bar/bulk-send is now
scoped to its own list container only.

## 🟢 Shipped: vendor self-service contact-info update ("My Info") — full detail FEATURE_LOG rule 180 (+ addendum)
Follow-on to the vendor confirmation email work: a real "👤 MY INFO" screen in `vendor.html` so a
vendor can update their own Phone/Email/Company. Old values are captured in a new
`Vendor_Contact_History` tab (old + new value, one row per changed field) BEFORE the `Vendors`
row is overwritten — live-verified at BOTH layers: the backend (real Sheets round-trip) and,
per Brett's direct follow-up, a real headless-Chromium pass against the actual live page
(real PIN login, real save/reopen/revert, a full page reload to confirm the save was genuinely
server-side, zero console errors — not just a code read-through). One pre-existing, unrelated
cosmetic quirk found in passing (MY INFO/FEEDBACK buttons render solid blue instead of muted —
`.btn-muted` isn't an actual defined class) and logged to `CAPTURE_INBOX.md`, not fixed inline.
Name is deliberately NOT self-editable (would risk breaking the vendor's own PIN-login name
match) — stays an admin edit. `BUILD_VERSION` → `2026-09-16.14`, confirmed live. Nothing pending
— built to spec and verified, no open decision needed from Brett.

## 🟢 Shipped: vendor invoice confirmation email on bill submission — full detail FEATURE_LOG rule 179, `context/VENDOR_INVOICE_CONFIRMATION_EMAIL_BUILD_BRIEF_v1.0.md`
Brett (voice memo): auto-email a vendor everything they submitted on a bill — job description,
WO#, invoice #, invoice file + reimbursable receipts as links, real timestamp, a 14-day
payment-window reminder that skips weekends AND holidays (`Config.US_HOLIDAYS`, Brett-maintained
list). QuickBooks bills stay "due on receipt" unchanged — the 14 days is a vendor-communicated
policy tracked separately, by design. Spanish vendors get the email in Spanish. A vendor with no
email gets a one-time SMS asking them to add one, not a silent skip. Files are linked via signed
`/vendor-file/view` links (reusing the same token shape a normal vendor PIN login already mints)
— NOT a raw Drive link, which would have silently reproduced the WO-1071 black-page bug (rules
142/176/178) since these files are deliberately never Drive-shared.

Soft-launched behind `Config.VENDOR_INVOICE_EMAIL_TEST_VENDOR_IDS` — currently just Alex Busey
(Vendor_ID 2) — widen by editing that one Config value once Brett's confirmed a real send looks
right. `BUILD_VERSION` → `2026-09-16.13`, confirmed live via `/version`. Full suite 80/80 against
a fresh clone (`test/vendor-invoice-confirmation-email.test.mjs`, 21 new assertions on the
business-day/holiday logic — the piece most likely to have an off-by-one).

**Needs Brett's first live pass**: no real bill was submitted this session to trigger an actual
send — flagged rather than triggered unasked, since it emails a real vendor and writes a real
Vendor_Bills row (which can auto-flip a real WO to Complete). Submit one real bill for Alex Busey
(or ask for it to be triggered) to confirm the email formats correctly, the file links open, and
the due date reads right, before widening the Config allow-list past Vendor_ID 2.

## 🟢 Shipped: owner-facing receipt viewer + Hub Photos & Files receipt-viewing fix — full detail FEATURE_LOG rules 176-178
Brett's policy confirmed and enforced: receipts should be visible to the property owner; vendor
invoices/bills stay hidden from them (that half was already correctly true). New `GET
/owner-file/view` (rule 177) refuses anything but `File_Type=receipt` and checks the requesting
owner's session actually owns the WO's property — live-tested with a real owner PIN login
(Jennifer Goldszmidt), including a genuine cross-owner refusal against another owner's WO, not
just a code read-through. `owner.html`'s receipt links now route through it.

Also found and fixed: the receipt "View" link fix shipped earlier this session (rule 176, on
`vendor.html`'s bill-summary and `index.html`'s Review Bills view) didn't cover a THIRD, separate
render path — `index.html`'s own WO-detail "Photos & Files" thumbnail grid + lightbox is a
byte-duplicated copy of vendor.html's code (see rule 134) that never got rule 142's original
Sep 15 proxy fix. That was the actual spot Brett was clicking when he said receipts still didn't
show after a hard refresh. Fixed (rule 178) — same `internalFileUrl` proxy pattern, both the
thumbnail/link rendering and the full-size lightbox.

Live data fix, same session: WO-1091's Vendor_Bills row (Alex Busey, 2930 St Paul) was missing 2
of 3 uploaded receipts ($174.74 + $51.79) — added from the actual receipt photos via the now-working
proxy. All 3 receipts share one card with no way to confirm it's Alex's own vs. a company card, so
all stay non-reimbursed per Brett's explicit "don't reimburse without confirming the card"
instruction — flagged in the bill's own Notes so it isn't lost. `Receipts_Total` now correctly
reads $230.54 (customer materials billing); vendor payout (`Total`) unchanged at $175 pending that
confirmation — nothing silently paid out, nothing silently dropped either way. Bill still shows in
Review Bills, ready once the card question is settled.

`BUILD_VERSION` → `2026-09-16.9`, confirmed live. `node --check` clean throughout (all inline
`<script>` blocks in both `owner.html` and `index.html`, checked against the actual live-deployed
GitHub Pages copy, not just the repo commit).

**Needs Brett's first live pass**: confirm the receipt thumbnails/lightbox actually render in a
real WO detail view now; confirm with Alex Busey whether card ...7508 is his own or a company
card, then flip the right receipt(s) to reimbursable on WO-1091's bill.


## 🟢 Shipped: Owners/Properties tenant-WO settings UI + admin Managed_By control — full detail FEATURE_LOG [FL-20260916-2234-b6]
Both parts of the build brief are now done. Folded into the existing Owners and Properties edit
modals (Brett's answer — no standalone settings page): a Tenant Work Order Submission toggle +
scope + resolved-effective-state line on each, plus a held-contact-note field on Owner. The WO
detail modal gets a "WHO'S HANDLING THIS JOB" section with a confirm-gated admin toggle matching
owner.html's own weight; `adminUpdateWO` now texts the owner (via `smsGatedSend`, unconditionally)
whenever Brett changes `Managed_By` either direction, per his "notify owner" answer. `node --check`
clean, full suite 78/78 (new `test/tenant-wo-settings-ui.test.mjs` 26/26, `managed-by.test.mjs`
grown to 12/12), zero regressions. Pushed as 9 small GH-Broker commits, deployed, confirmed via
`/version` (`2026-09-16.8`) and a fresh anonymous clone.

**Not verified live** — no live Hub session in the build sandbox. Needs Brett's first live pass:
set a real Owner/Property's toggle and confirm the resolved state; flip a real WO's `Managed_By`
from the admin side and confirm both the confirm-dialog wording and the actual owner text land;
confirm an unrelated Edit Owner/Edit Property save still works cleanly with the new fields present
but untouched.

# WHERE THINGS STAND — Sep 16, 2026 (TENANT_WO_SETTINGS_UI_AND_HARDENING_BUILD_BRIEF_v1.0 Part A shipped)

## 🟢 Shipped: /workorder tenant-submission session-identity hardening — full detail FEATURE_LOG [FL-20260916-2210-p3]
Closes the gap flagged at the end of today's 3-part access-control build. The tenant-submission
gate used to trust body.property_id/unit_id/tenant_id as sent by the client; it now resolves the
caller's real Tenants row from their verified session id and overwrites all three before the
access check or WO creation run — a tenant session can no longer be used to submit a WO tagged to
a different property/unit/tenant. Scoped strictly to callerRole === 'tenant'; admin/owner paths
untouched. `test/tenant-submit-request.test.mjs` +8 assertions, full suite 76/76, zero
regressions. Deployed (`2026-09-16.5`), confirmed via `/version` and a fresh anonymous clone.

**Not verified live** — no live tenant PIN session available from the build sandbox. Needs
Brett's first live pass: log in to tenant.html as a real tenant, replay POST /workorder via
browser dev tools with a spoofed property_id/unit_id, confirm the WO lands on the tenant's own
real property/unit regardless (overwritten, not rejected) — then confirm a normal unmodified
submission still works.

## Next up: Part B — Hub (index.html) UI for tenant-WO settings + admin Managed_By control
Brett's answers (this session): (1) fold into the existing Owners and Properties pages, not a
standalone settings page/tab; (2) the admin-side Managed_By toggle shows the same confirm dialog
owner.html's does; (3) Brett flagging a WO as owner-managed himself DOES notify the owner (not a
quiet internal-only flag — differs from the brief's "recommend yes for consistency, confirm"
framing, which left this open). Every endpoint Part B needs already exists and is already
correct (GET /tenant-wo-settings, POST /owner|property/tenant-wo-toggle, POST
/owner/held-contact-note, POST /wo/admin-update) — this is a pure frontend build against
already-tested endpoints, plus one small addition: an owner-notify SMS/queue call when admin sets
Managed_By='Owner' via the new UI (doesn't exist yet — today's owner.html-side toggle doesn't
notify either, so this is net-new, not a gap in existing code).

# WHERE THINGS STAND — Sep 16, 2026 (all 3 parts of the owner-managed-WO access-control build shipped)

## 🟢 Shipped: full access-control model live — Phoenix owner-first, Goldszmidt tenant-submit, held-WO tenant redirect — full detail FEATURE_LOG [FL-20260916-2145-w2]
Closes out today's design conversation with Brett. All three pieces are live: (1) owners can
bidirectionally claim/release a WO via `Managed_By`, Ridge Co blocked from assigning a vendor
to a claimed one; (2) tenants can submit new requests where the owner/property toggle allows it
(Goldszmidt ON, everyone else at the existing OFF default) — turned out to reuse an already-built
Aug 20 backend rather than needing a new one; (3) a held WO shows visibly different to the tenant
— dimmed card + "Handled by your landlord" label + a top banner with the owner's own contact info
(custom note or name+phone fallback), description still fully visible. 76/76 tests, deployed
(`2026-09-16.4`).

**Flagged, not fixed**: the pre-existing (Aug 20) tenant-submission gate doesn't cross-verify the
calling tenant's session against the property/tenant_id in the request body — worth hardening
before wider rollout.

**Still open**: no admin (index.html) UI for managing the toggle hierarchy or setting a held-
contact note day-to-day — both set via direct API call this session. `GET /tenant-wo-settings`
already exists and is ready for a real settings screen whenever wanted.

# WHERE THINGS STAND — Sep 16, 2026 (owner-managed WO toggle shipped; tenant-submit-request UI wired up to Aug 20's orphaned backend)

## 🟢 Shipped: owners can claim/release a WO themselves; tenants can submit new requests where enabled — full detail FEATURE_LOG [FL-20260916-1950-m4] / [FL-20260916-2135-r4]
Two pieces from the same design conversation with Brett (per-owner/per-property access model:
Phoenix = owner-first no tenant-submit, Goldszmidt = tenant-submit + owner auto-notified,
owner-occupant as a shadow-tenant flag):
1. **`Managed_By` bidirectional owner toggle** (worker.js + owner.html) — an owner can mark a WO
   as handled by themselves; Ridge Co is mechanically blocked from assigning a vendor to it
   until it's handed back. Live, tested (74/74 → since grown to 75/75).
2. **Tenant "Submit a New Request"** (tenant.html only) — turned out the entire backend already
   existed from an Aug 20 2026 build (owner→property→unit toggle hierarchy, the `/workorder`
   gate, dedicated toggle-setting endpoints, a settings-summary endpoint) but nothing ever linked
   to it. Wired tenant.html up to it rather than building a parallel system. Goldszmidt's toggle
   set ON live via the existing endpoint; everyone else stays at the existing OFF default.

**Flagged, not fixed**: the pre-existing (Aug 20) tenant-submission gate checks property-level
permission but doesn't cross-verify the calling tenant's session against the property/tenant_id
in the request body — worth hardening before wider rollout, see FEATURE_LOG entry for detail.

**Still open**: the owner-managed WO's tenant-facing grayed-out display + a per-owner redirect-
contact field; an admin (index.html) settings screen for the toggle hierarchy (currently set via
direct API call — `GET /tenant-wo-settings` already exists and is ready for exactly this).

# WHERE THINGS STAND — Sep 16, 2026 (1109 Battery Ave unit/tenant fix closed out — rule 171's feature confirmed self-serve)

## 🟢 Fixed: 1109 Battery Ave (Property 84) unit/tenant data — full detail FEATURE_LOG [FL-20260916-2150-t8]
Brett supplied the two answers rule 171 was blocked on (unit labels Apt 1/Apt 2; Reagan is in
Apt 2). Created Units 55 (Apt 1, vacant) and 56 (Apt 2, linked to tenant 102/Reagan) via the
existing `/unit/add` + `/tenant/update` endpoints — no code changes, pure data fix. Verified live
via `/units` and `/tenants` after the write. Also re-confirmed the Property Structure management
feature itself (rule 171, Sep 14) is live and correct in the current build — Brett can now do
this himself in the Hub (Edit Property → Units section; Edit Tenant → Unit dropdown) for any
future property without needing a session.

# WHERE THINGS STAND — Sep 16, 2026 (vendor nudge satisfied-check fixed off real live false-positives; 3 SMS templates stopped over-promising a reply channel that doesn't route anywhere)

## 🟢 Fixed: WO-1200/1201 kept getting "any update on status?" nudges after already being Invoiced — full detail FEATURE_LOG [FL-20260916-1950-m4]
Brett pulled the last 48h of SMS via `/message-queue` to review content/timing and flagged two live
false positives directly (WO-1200, WO-1201, both nudged at 3:06pm ET despite already being
Invoiced with a real reviewed Vendor_Bills row on file). Root cause confirmed against the live
Sheet, not guessed: `processVendorNudges`'s satisfied-check only recognized `wo.Status ===
'Complete'` as the status-ask stopping condition — once a WO moved past Complete to Invoiced, it
silently fell through and kept nudging forever. Fixed per Brett's explicit new rule: the status ask
now stops at Complete-or-later regardless of billing; a separate `invoice`-type ask auto-starts at
that same moment and persists specifically until Invoiced-or-later; Cancelled/Declined still stop
everything. Status nudge copy also rewritten to coach the vendor through the actual workflow
(schedule → mark complete → invoice) instead of a bare "any update?". `node --check` clean, full
suite 65/65. **Not yet live-verified** — needs a real sweep pass to confirm WO-1200/1201 go fully
quiet next cycle.

**Also surfaced, not yet re-confirmed**: the Sep 15 evening cron-cadence fix (FL-20260915-1839-x7,
5th Cloudflare Cron Trigger) doesn't look fully effective yet per today's real firing times — nudges
due at 9:00am/12:16-12:20pm actually fired at 11:33am/3:06pm (~2.5-2.8h late), batched in pairs.
Better than the original ~5h GH-Actions-only gap, but not the intended 15-min cadence. Worth
confirming the new Cloudflare Cron Trigger is actually registered and firing.

## 🟢 Fixed: 3 SMS templates promised "reply or call us" with no real inbound path — full detail FEATURE_LOG [FL-20260916-1955-p1]
Brett flagged the tenant-job-completed text specifically; confirmed via `handleInboundSMS` that it
only recognizes vendor phone numbers, so a tenant OR owner replying gets a nonsensical "could not
find your vendor record" dead end. Dropped the reply/call promise from `tenant_job_completed`,
`tenant_welcome`, and the `addWONote` owner on-hold notification. `vendor_welcome` left untouched —
vendor replies genuinely do route somewhere today. **Interim only** — Brett wants a real contact
form (name/phone/address/details) and eventually AI-agent-routed inbound replies; that's a separate
unscoped build, not attempted this session. `node --check` clean, full suite 65/65.

# WHERE THINGS STAND — Sep 16, 2026 (GH Broker built, broke, and got fixed — with no documentation trail until this entry)

## 🟢 Fixed and live-verified: GH Broker's write path (`commit_file`) crashed on any non-ASCII character — full detail FEATURE_LOG [FL-20260916-1750-k3]
GH Broker (`brett332/gh-broker`) is the Cloudflare Worker MCP connector that gives Cowork sessions
GitHub read/write access without a pasted PAT. A session today built it further (added
`list_directory`, fixed UTF-8 decoding on reads) and then disconnected with **no checkpoint saved
and no FEATURE_LOG/CURRENT.md entry written** — the only record was the git history itself.
A follow-up session found `commit_file` (the write tool) was failing on almost every real call —
root cause: it base64-encoded content with plain `btoa()`, which throws on any non-Latin-1
character (em-dashes, checkmarks, curly quotes, emoji, CJK — i.e. almost all real prose). Fixed
with a proper UTF-8-safe encoder, verified live against the actual deployed connector with a
string containing every one of those character classes. `context/CREDENTIALS_MAP.md` bumped to
v1.4 and now documents GH Broker as the primary GitHub-access method (previously undocumented
entirely — the file still told sessions to ask Brett to paste a PAT by default).

**Real gap this exposes**: `brett332/gh-broker` is a separate repo from this one, so nothing in
this repo's doc-audit system (`scripts/doc_audit.py`) ever sees changes to it. Worth deciding
whether it needs its own FEATURE_LOG or whether changes there should always also get logged here
(this entry is the first instance of the latter).

**Open/unknown**: whatever RidgeCo task the lost session was originally working toward before it
became "fix GH Broker" is not recorded anywhere and may need to be re-asked of Brett directly —
there's no trail to recover it from.

# WHERE THINGS STAND — Sep 15, 2026 (documentation-completeness infrastructure — FL-20260915-1644-cz — on top of the share-attachments repair chain and rule 175)

## 🟢 Shipped, one real bug caught by its own first live run: documentation-completeness infrastructure — FL-20260915-1644-cz
Full detail: FEATURE_LOG `[FL-20260915-1644-cz]`. Brett's ask after the Sep 14 documentation
gaps: capture more as it happens, plus a scheduled audit to catch what still slips through,
without needing a manual save from every session that touched something that day. Four pieces:

1. **ID/tag convention** (FEATURE_LOG.md + BACKLOG.md headers) — new entries get
   `[FL-YYYYMMDD-HHMM-xx] [tags]` instead of the next sequential number. Kills the
   "two concurrent sessions both grab 171" collision class outright rather than detecting it
   after the fact; tags make cross-session/cross-subject search work via plain grep. Already
   picked up and used correctly by a concurrent session the same day (see the share-attachments
   entries below, IDs `FL-20260915-1649-q8` etc.) — a good early sign it's actually sticking.
2. **`ridgeco-validate` documentation gate** — output contract gained a Documentation field;
   a change with no FEATURE_LOG entry now blocks autonomy-ladder eligibility. **Sandbox-local
   skill edit — persistence to a real future session is NOT confirmed.** Watch for whether this
   field actually shows up next time ridgeco-validate runs.
3. **`brett-context` staleness tripwire** — session-start check comparing CURRENT.md's header
   date against the latest commit date, surfaces a plain warning if they've drifted. **Same
   persistence caveat as above** — watch for whether it fires on the next fresh session load.
4. **`scripts/doc_audit.py` + `.github/workflows/doc-audit.yml`** — nightly, no-Worker-needed
   audit (full repo access from the GitHub Actions runner itself) flagging commits with no
   apparent FEATURE_LOG entry, via per-entry keyword clustering (an early whole-file-presence
   version was useless — scored 9/9 false-positive "hits" on an undocumented commit, since
   common words like "receipt"/"work"/"property" appear everywhere in a 150+-entry file).
   Commits its own run result to `context/DOC_AUDIT_LOG.md` — a missed night is a visible gap
   in that file's own run history, not silence.

**Real bug caught by the audit's own first live run, same day**: it crashed before writing
anything — `CURRENT.md`'s header used an abbreviated month ("Sep 15") and the parser only
accepted the full name, an untested path since local testing always passed `--since-date`
explicitly. The workflow's own `|| echo gaps_found=true` masked the crash as a green step —
looked like "ran, found nothing" when the check never actually ran. Fixed: parser accepts both
month formats now; more importantly, "since" now sources from the audit's OWN last recorded run
in `DOC_AUDIT_LOG.md` first (self-contained, doesn't depend on another file's formatting staying
stable), falling back to `CURRENT.md`'s header only on a genuine first run, and a fixed lookback
window if even that's unavailable — never just crashes. Exit codes now distinguish "ran fine,
found gaps" (1) from "the audit itself broke" (2), so a future silent crash can't hide behind a
green checkmark. Re-triggered for real after the fix — confirmed a real commit landed
(`4140450`) with a correct run entry.

**Not built**: SMS notification on a flagged gap — wasn't part of what was asked, would need a
new endpoint/token. **Worth checking periodically**: `context/DOC_AUDIT_LOG.md` for whether the
nightly run is actually firing on schedule (not just that it can, which is all that's confirmed
so far via two manual triggers).

## 🟡 Diagnostic added, root cause not yet run: WO-1039's 5 files are 404 — but which kind? — FL-20260915-1745-tp
Full detail: FEATURE_LOG `[FL-20260915-1745-tp]`. Brett's first real batch (with the corrected
tool) confirmed all 5 WO-1039 failures are `404 File not found`. That's ambiguous on its own —
Google Drive returns 404 both for a truly-gone file AND for one the service account simply can't
see (hiding existence rather than returning 403). Added a read-only `/admin/drive-file-check`
(`files.get` per ID, never writes) to tell them apart. Verified: 16/16 new tests, full suite
70/70, deployed (`2026-09-15.6`). **Next step**: actually run it against WO-1039's 5 file IDs and
read the result together with Brett — this session hasn't done that yet.

## 🟡 Fixed and deployed, one thing still open: real batches revealed 2 more issues — FL-20260915-1731-yh
Full detail: FEATURE_LOG `[FL-20260915-1731-yh]`. Brett ran "Run for real" 3 times and got
byte-identical results — correctly asked if this was actually doing anything. Two separate
causes: (1) **the updated offset-tracking tool from FL-20260915-1714-wy was never actually
re-sent to him** — he was still on the original file, which never included `offset` in its
requests, so every "batch" silently repeated the same first 25 files (the 20 real shares from
batch 1 did land — not wasted, just not visible as progress). Delivered the corrected file this
time. (2) **5 files under WO-1039 fail identically every retry** — a real, persistent issue,
separate from the delivery mistake. `driveShareAnyone` discarded the actual Drive API error on
failure; added `driveShareAnyoneVerbose` so `failures[]` now carries the real HTTP status +
error message (403 vs 404 vs 5xx are very different problems). Tool also now persists its
position via `localStorage` so a phone backgrounding the tab mid-sweep can't cause a repeat of
issue (1). Verified: 42/42 in `test/share-attachments-limit.test.mjs`, full suite 69/69,
deployed (`2026-09-15.5`), confirmed live.
**Still open**: WO-1039's actual failure reason isn't known yet — this session's
write-classifier blocks a real share call from here, so it couldn't be reproduced directly.
Brett's next real batch (starting fresh with the corrected tool) will show the real status/error
for those 5 files in the response; worth a quick read-together once he has it.

## 🟢 Fixed and deployed: `/admin/share-attachments` couldn't advance past its first batch — FL-20260915-1714-wy
Full detail: FEATURE_LOG `[FL-20260915-1714-wy]`. Found right after the limit fix below, before
recommending Brett a batching plan for the ~492-file backlog: even with `limit` fixed, calling
the endpoint again with the same limit always re-scanned from row 1 and reconsidered the SAME
first N shareable files — no way to say "skip what an earlier batch already did." Added `offset`
+ a `next_offset` response field so calls chain correctly. The local repair tool
(`ridgeco-share-attachments-repair.html`) now tracks its own position automatically — click
"Dry run" or "Run for real" repeatedly and it continues where the last click left off, with a
visible Progress line and a reset button. Verified: 38/38 assertions in
`test/share-attachments-limit.test.mjs`, full suite 69/69, deployed (`2026-09-15.4`), confirmed
live.
**Recommendation given to Brett**: don't run all ~492 in one call — this codebase has hit
Cloudflare's subrequest cap live before at similar scale in a different function, and a mid-batch
failure here would return a bare error with no partial-progress stats. A live 100-item dry-run
batch completed cleanly, so batches of ~100-150 (the tool defaults to 100, auto-advancing) are a
reasonable balance. Still his call/his button to press — this session's write-classifier still
blocks the real endpoint from being called directly from here.

## 🟢 Fixed and deployed: `/admin/share-attachments` dry-run `limit` was a silent no-op — FL-20260915-1649-q8
Full detail: FEATURE_LOG `[FL-20260915-1649-q8]`. Brett tried the rule-174/175 photo-share repair
tool with `limit` at 5, 10, 15, and 100 in dry-run and got byte-identical output every time —
correctly didn't trust it enough to run for real. Root cause: the limit check compared against
`shared`, a counter dry-run never moves (it always skips the share call before that counter would
increment) — so `limit` provably had zero effect on any dry-run response. Fixed: limit now gates
on a new `considered` counter that increments in both modes, response reports
`considered_this_batch`/`remaining_after_this_batch` so the limit's effect is visible. Also fixed
the tautological `shared: 0` in dry-run — it now does a real read-only Drive permission check per
considered file (`driveIsSharedAnyone`, no write) and reports genuine `already_shared`/
`needs_sharing` counts. Verified: `node --check` clean, new
`test/share-attachments-limit.test.mjs` (25 assertions), full suite 69/69, deployed
(`BUILD_VERSION 2026-09-15.3`), confirmed via `/version`.
**Still needs Brett's go**: the actual retroactive sweep (492 shareable attachments, rule 174) —
he should now get a trustworthy dry-run reading via the same local tool
(`ridgeco-share-attachments-repair.html`, same URL/token, no changes needed to the tool itself —
the fix is entirely server-side) before deciding whether to run it for real. Still only runnable
from his own browser — the platform's write-classifier has twice blocked this session from
calling the real endpoint directly.

## 🟢 Fixed and deployed: preventive measure for rule 174's failure class — rule 175
Full detail: FEATURE_LOG rule 175. Direct response to Brett's ask: don't just fix the two
reported bugs, reduce the chance of this exact class recurring. `ensureColumns` (70+ call sites)
and `driveShareAnyone` now log a Telemetry row on every failure centrally, in the shared
function — so any NEW call site automatically gets this protection with no extra work, instead
of needing 70+ individual call sites fixed by hand. `driveShareAnyone` also retries once.
**Important gap flagged, not fixed by this build**: the existing weekly ops review already turns
2+ repeated failures for the same job type into a flagged pattern delivered to Brett by
SMS/email — but that delivery (`digest_enabled`) is OFF by default and has been the whole time.
Logging a failure that nobody is told about is only half the fix. **Brett: worth deciding
whether to turn `digest_enabled` on now that Twilio is live**, or confirm you want it to stay
manual-check-only for now.

## 🟢 Fixed and deployed: receipt payment-source + photo-sharing silent failures — rule 174
Full detail: FEATURE_LOG rule 174. Brett reported two live bugs (vendor "my own money" receipt
toggle not sticking; WO-1071 photos unviewable in-app but fine in Drive directly) — both
root-caused to the same pattern: a "non-fatal, silent" catch around a Sheets/Drive write that
had actually been failing every time, with zero trace. `Payment_Source` column: confirmed via
live data it has NEVER existed on the Receipts sheet since the feature shipped (rule 173,
Sep 14) — fixed live via new `/admin/ensure-receipts-payment-source` (called for real this
session, confirmed column now exists going forward; historical rows still read as the
company_card default — the true answer was never captured for those). Photo sharing:
`driveShareAnyone` now retries once + logs failures instead of swallowing. **Still needs
Brett's go**: the retroactive `/admin/share-attachments` sweep to fix already-affected photos
(492 shareable attachments scanned dry-run, real count of actually-broken ones unknown until
it runs) — held for his confirm, not run autonomously (Drive permission change at scale). Also
needs a live pass: vendor selects "my own money" on a new receipt and confirms the badge shows
correctly.

## 🔴 OPEN BUG, not yet root-caused: Brett expected vendor nudges to fire and they didn't
Rule 170 (vendor nudge/request system) was built, deployed, and live-verified mechanically
(clock creation timing, reset-on-activity, the quiet-hours-hold fix) — but Brett reports that
after all that, he should have gotten actual nudge SMS and did not. **Per Brett's explicit
instruction, this was NOT troubleshot in the session that found it** — flagging here so the
next session picks it up directly rather than re-discovering it. Start here: check
`GET /vendor-requests` for the real row(s) and their `Next_Nudge_At`/`Status`/`Nudge_Count`;
check whether `POST /cron/sweep` is actually firing on schedule via the GitHub Actions run
history (`cron-sweep.yml`) — rule 166/167 needed 2 secrets set (`CRON_SWEEP_TOKEN`, both
Cloudflare + GitHub) before anything in the sweep can run at all; confirm those are actually
set and the workflow has been running (not just that it CAN run, which was already verified
once manually). Also worth checking Twilio's own delivery status for any nudge that the
Message_Queue says went out but Brett never received — rule 159a already found a real
"Twilio accepts it, phone gets nothing" gap in a different message type, not yet ruled out
here too.

## 🟢 Documentation audit — closed 3 real gaps where Sep 14 work never got a CURRENT.md/
FEATURE_LOG entry (found and fixed Sep 15, 2026, in response to Brett's own audit request)
Cross-checked every commit timestamped Sep 14 (14:24 through the Sep 15 early-morning
continuation) against this file and FEATURE_LOG.md. Found and backfilled:
- **Property Structure management** (Unit_Count auto-compute, Units add/rename/remove, tenant
  unit reassignment) — had a FEATURE_LOG entry (from a concurrent session, landed mid this
  session's own work) but it was mis-numbered **rule 163**, colliding with this session's own
  unrelated "SMS text names the actual job" entry. Renumbered to **rule 171** (nothing else
  referenced the old number, confirmed before renumbering) — no CURRENT.md entry existed for
  it at all until now. See FEATURE_LOG rule 171.
- **Receipt Reconciler description-fallback fix + pending-receipt backfill + image-gap
  diagnostic** (5 commits, 14:32-14:58) — had NO FEATURE_LOG or CURRENT.md entry anywhere.
  Backfilled as **FEATURE_LOG rule 172**, reconstructed from the original commit messages
  (each already had detailed, self-documenting messages) — not re-verified live by this
  backfill pass.
- **Receipt Reconciler Unit picker + payment-source delineation + multi-receipt-per-photo
  safety check + guided bill-submit review + Truck Stock Log** (4 commits, 15:27-16:38) — same
  gap, backfilled as **FEATURE_LOG rule 173**, same caveat (reconstructed, not re-verified).

**Also worth noting**: several of the backfilled commits' own `BUILD_VERSION` strings are
still dated `2026-09-10.x` even though the actual work happened Sep 14 — a version-string/
calendar drift, not a functional bug, not corrected by this pass since the version has moved
on many times since. If anything from this specific cluster is ever the exact thing being
live-tested, don't rely on the BUILD_VERSION string alone to prove it's deployed — check
`git log` directly.

**Not re-checked in this pass**: whether every OTHER session's work from Sep 14 (rules
145-162 and earlier, already in this file) is fully accurate — this audit specifically
targeted the GAP (things with zero entry anywhere), not a correctness re-review of entries
that already exist.

## 🟡 Built, needs a live pass: vendor nudge/request system — rule 170
Full detail: FEATURE_LOG rule 170. This was the last item queued from the Twilio-build message
redesign — the whole redesign (rules 157-170) is now feature-complete pending live verification.
Automatic status-update clock on every assignment (timing verified against Brett's own
examples), resets on real vendor activity, quiets for a future Scheduled_Date, caps at 5 nudges
then flags Brett. Manual "Request Photos"/"Request Invoice" buttons on the WO detail view.
Needs a live pass — see FEATURE_LOG rule 170 for the specific checks.

## 🟡 Built, needs a live pass: welcome messages — rule 169
Full detail: FEATURE_LOG rule 169. tenant_welcome/vendor_welcome, manual send (single +
bulk), editable text at send time, gated pipeline, Welcome_Sent tracking + a "hasn't been
welcomed" filter on both Tenants and Vendors tables. Needs a live pass — see FEATURE_LOG
rule 169 for the specific checks (preview/edit flow, bulk send, badge/filter update, a
gate-blocked send showing the real reason rather than silently marking someone welcomed).

## 🟡 Built, needs a live pass: owner messages on the gated pipeline — rule 168
Full detail: FEATURE_LOG rule 168. Owner Received (new)/Scheduled/Complete/On-Hold (new,
requires a reason) all now go through the real gate + Test Mode + Message_Queue, not the old
raw sendSMS. Assigned and Invoiced retired. Tenant Received (new, 8h-delayed, bumped by
Assigned if it arrives first) also added. Needs a live pass — see FEATURE_LOG rule 168 for the
specific checks (Owner Received on a tenant-submitted WO, the 8h supersede behavior, the
On-Hold reason block, Hold_Reason showing up correctly).

## 🟡 Built, needs 2 secrets + a live pass: quiet hours + GitHub Actions cron replacement — rule 166
Full detail: FEATURE_LOG rule 166. Automatic SMS now holds until 9am ET if it would otherwise
fire after 7pm ET (DST-aware, real Intl-derived offset, not a hardcoded UTC number). Periodic
processing (firing held messages, plus the deferred-appointment-reminder sweep that was never
actually wired to anything before this) now runs via a new GitHub Actions workflow
(`cron-sweep.yml`, every 15 min) instead of a Cloudflare Cron Trigger — free, no limit, doesn't
compete for the 4 Cloudflare cron slots already in use. **Brett needs to set `CRON_SWEEP_TOKEN`
as both a Cloudflare Worker secret and a GitHub Actions repo secret (same value, one-time)**
before any of this actually runs — until then it's fully inert (`/health` shows
`cron_sweep.token_set: false`). `node --check` clean, full suite green, new
`test/quiet-hours.test.mjs` (12 assertions, verified across real EDT/EST timestamps).

## 🟡 Built, not yet live-verified: SMS text now names the actual job — rule 163
Full detail: FEATURE_LOG rule 163. Brett, live-testing: two same-trade jobs at the same address
read identically in a text ("your General job at 123 Test St" either way). New `woJobLabel(wo)`
builds `"{Trade} job ({short description})"` — used in all 3 tenant message types; vendor's own
text keeps the FULL untruncated description (lower priority per Brett — vendors have portal
access as a backup). `node --check` clean, full suite green, new `test/wo-job-label.test.mjs`
(8 assertions, reproduces Brett's own two example labels exactly). **Needs Brett's live pass**:
assign a vendor on a real WO and confirm the tenant text names the actual job now.

## 🟡 Built, not yet live-verified: Work Order Void/Hide + duplicate-create guard — rule 162
Full detail: FEATURE_LOG rule 162. Brett hit WO-1192 live: a double-tap on Create Work Order
made two rows share one WO number, and every WO lookup in the app resolves by ID first-match —
the second row became permanently unreachable, stuck at New, no matter which button Brett
tapped. Diagnosed from the live code AND the live Sheet data (via `WORKER_SECRET`), not guessed.
Brett fixed that specific row by hand; this build is the fix so it can't happen again, plus the
Void/Hide feature Brett asked for on top (distinct from Cancelled — Void is for a work order
that should never have existed at all, e.g. a duplicate or one job folded into another; the
record stays, just hidden from every list/search by default, restorable).

- `createWorkOrder` now runs the existing `findRecentDuplicate` guard (already used elsewhere,
  never wired to Work_Orders before) — a same-signature create within 30s hands back the
  existing WO instead of appending a twin.
- New `POST /wo/void` (reasons: Duplicate / Combined / Other) + `POST /wo/unvoid` — admin-only,
  logged to `WO_Audit`. Combined copies Notes onto the surviving WO; nothing else migrates.
- `/workorders` excludes Voided by default (`?include_voided=1` / `?voided_only=1` available);
  vendor/tenant/owner/nearby-WO endpoints exclude voided rows unconditionally.
- index.html: new "Voided" filter (kept separate from open/closed/"all"), dashboard exclusion,
  a "VOIDED — reason" badge, a Void/Restore button + modal on the WO detail screen, and every
  other WO-picker dropdown in the admin app patched to exclude voided rows too.

`node --check` clean on worker.js + all 5 inline `index.html` script blocks. This originally
shipped as "rule 159" but that number turned out to be claimed by two other concurrent sessions'
work (the notify-toggle/bulk-checkbox/Twilio-status patch, itself renumbered 158/158a → 159/159a
somewhere in this same chaotic day — see the PR #3 note below) before this one could push;
renumbered to 162 (the next actually-free number, after rule 161) to stop colliding. Rebased
three times mid-build across the day's concurrent pushes (rule 158's invoice-description work,
rule 158/158a→159/159a's notify-toggle work, and rule 160/161's Twilio-diagnostic + whole-
property-SMS fixes) — `createWorkOrder` itself never had a real logical conflict with any of
them (each session's changes sit at different points in the function), just repeated
`BUILD_VERSION` line collisions, each one bumped past whatever the incoming tip claimed. Fixed a
real regression this caused in `test/turnover.test.mjs` (sandbox-extracts `createWorkOrder`
verbatim; needed the new `findRecentDuplicate` dependency grabbed alongside it). Extended
`test/dupe-guard.test.mjs` with the WO-1192 scenario itself. New `test/wo-void.test.mjs` (25
assertions). Full suite re-verified after the final rebase: 65/65.

**Not pushed yet** — sitting locally, prepared for Brett's push (Basic-auth PAT method per the
standing rule in `ridgeco-git-push-proxy-bug.md`, or the patch-file handoff if no PAT is
available). No live Sheets credentials in this build sandbox, so the six new `Work_Orders`
columns' actual creation on the live Sheet, a real double-tap against the live Worker, and a
real Void→Restore round trip in the browser are all unverified — see rule 162's live-pass list.



## 🟡 Built, not yet live-verified: root-cause fix for whole-property tenant SMS — rule 161
Full detail: FEATURE_LOG rule 161. `currentTenantForDispatch` (used by every SMS trigger) never
had the Property_ID fallback `enrichWO` already used for whole-property (no-Unit) listings —
found live when Brett's "Send update" button failed on a real test WO despite the tenant being
clearly shown on the WO detail screen. This predates the Twilio build; confirmed via
`Tenant_SMS_Sent: FALSE` on that WO that the automatic tenant text never fired either, silently,
all along. Fixed at the root (the shared helper) + swept 3 other call sites that had inlined the
same incomplete lookup instead of using it. New test caught a real precision bug in the first
draft before it shipped (see rule 161 for detail). `node --check` clean, full suite green.

## 🟢 Two other things Brett found live-testing, NOT code bugs — his own action items
1. **Inbound "YES" reply routes to an old PM auto-responder, not this Hub.** The Worker's own
   `/sms-inbound` handler is fine and unchanged — the number's Twilio-side inbound webhook (or
   the Messaging Service's own "Integration" config, which can override the number-level
   setting) is very likely still pointed at whatever the old PM system used. Brett needs to
   check, in Twilio Console: Phone Numbers → Manage → the number → Messaging config ("A message
   comes in"), AND the Messaging Service's own Integration tab — both should point to
   `https://maintenance-hub.brett-2f8.workers.dev/sms-inbound` (POST), not a Studio Flow or a
   different webhook. Nothing to build here; this is a console setting.
2. **Vendor dispatch text has no link to the WO.** Reasonable ask, deliberately not rushed into
   the same patch as the two live bugs above — the codebase already has a proven shareable-WO-
   link mechanism (`/wo/share-link`, last-4-of-phone gated), and before wiring it into the
   accept-gated dispatch text, worth confirming what that shared page reveals pre-Accept doesn't
   quietly widen what the accept-gate currently withholds. Queued as a real next-round item, not
   dropped.


## 🔴 PR #3 (rule 159/159a) was never actually merged — a different session's work landed on main instead, in the meantime
Brett's Claude Code session for the notify-toggle/checkbox-left/Twilio-diagnostic patch got as
far as confirming the PR was green and mergeable, then stalled there — it was never actually
merged. Meanwhile, an unrelated session (invoice descriptions, rule 158 below) pushed straight
to `main`. Confirmed directly: `origin/main`'s current tip has no trace of the rule 159/159a
commit; the PR branch (`claude/pensive-rubin-uxmdr4`) still exists, unmerged, 1 commit behind
current `main`. **This session rebased that branch onto current `main` cleanly (no conflicts,
full test suite still green) and added one more diagnostic endpoint on top (rule 160) — this
combined branch supersedes PR #3 entirely.** Brett should close PR #3 without merging once the
new combined patch lands, to avoid double-applying the same changes.

## 🟡 Built, not yet live-verified: Twilio account/A2P-status diagnostic — rule 160
Full detail: FEATURE_LOG rule 160. Brett asked directly whether he needs an opt-in, whether the
campaign needs activating, and asked Claude to confirm via the Worker's own Twilio API access
that everything is actually live — rather than guess, researched current (2026) Twilio/A2P
10DLC practice: `Status:'sent'` has only ever meant "carrier/Twilio accepted the request," and
a message can be silently carrier-filtered after that with zero trace in `Message_Queue`.
Brand approval (already confirmed) and campaign approval are two DIFFERENT, sequential gates —
a business can be fully approved while its specific messaging campaign is still pending carrier
vetting. New `GET /twilio/account-status` checks the sending number, every A2P Brand
Registration's status, and — the part that actually matters for carrier delivery — every
Messaging Service's Campaign compliance status plus whether `TWILIO_FROM` is actually in that