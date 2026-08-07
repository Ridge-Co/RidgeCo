# Optimizer Round Log

The live, persistent home of the Optimizer's ranked Top-10 and the carry-forward **Bench**.
Governed by `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0` + PAT-032. Updated every round.

**How to read this:** Impact is ranked highest-first (time/effort saved OR cost saved; effectiveness never ignored — see the rubric in the strategy doc). Effort is the *selection* factor, not the ranking axis. **Chosen** items graduate to a build. **Not chosen** items drop to the Bench and are **re-scored next round** — nothing is discarded; a lower rank now can rise to #1 later.

Impact tags per row: **T** = time/effort saved · **$** = cost saved/recovered/new revenue · **E** = effectiveness (accuracy, risk, experience). H/M/L each. Recurring savers outrank one-time.

---

## ROUND 0 — July 22, 2026 (pre-telemetry: judgment-based first pass)

> Honest caveat: telemetry (`Ops_Telemetry`) isn't live yet, so this round is ranked on context + backlog judgment, not measured data. Once the router + telemetry ship (Phase 0), Round 1 onward is data-backed and this ranking will move.

| # | Candidate (backlog id) | Impact (T/$/E) | Effort | Why it ranks here |
|---|---|---|---|---|
| 1 | **Model routing layer** (B-127) | $ H · T M · E M | Low | Cuts AI cost on *everything* and unblocks all telemetry. Foundational — every later item is measured because this exists. **Already selected (Phase 0).** |
| 2 | **Receipt intake pipeline rebuild** (B-084/085/086) | T H · $ H · E H | Med | Receipts stuck since 2025 (Make.com dead). Bleeding on three fronts: manual entry, lost tax deductions, broken reconciliation. Recurring + money-facing. |
| 3 | **Email → Work Order intake** (B-103) | T H · E M | Med | Auto-creates WOs from Buildium + manual customer emails. Kills recurring manual data entry on core business volume. Brief already written. |
| 4 | **QuickBooks Send-to-QB flow** (B-015/001/002) | T H · E H · $ M | Med | Invoice + bill + payment automation. Money-facing accuracy + big recurring time save on the billing loop. |
| 5 | **EZ-Pass toll → auto-invoice + vehicle-notice router** (B-066/087) | $ H · T M | Med | Ray is $5k behind on van tolls right now; direct cost recovery + stops an ongoing weekly leak. Narrow but real dollars. |
| 6 | **Daily digest of next steps + wins** (B-051) | T M · E H | Low | High personal leverage for Brett's ADHD workflow — keeps the whole operation moving. Very low effort for outsized focus/effectiveness gain. |
| 7 | **Voice-to-sheet single-input capture** (B-052) | T H · E M | Med | Brett's #1 stated want (#257): one input node that fans out. Compounds — every future capture gets cheaper/faster. |
| 8 | **Optimizer Reviewer agent** (B-129) | T M · $ M · E H | Med | The meta-item: compounds by finding future savings automatically. Ranks mid now only because it needs telemetry first; rises once data exists. |
| 9 | **Cabin STR dashboard + cleaner scheduling** (B-105/104) | T H · E M | Med-High | Remote-management time save (Brett hosts 3 hrs away). High impact for Cabin specifically; effort keeps it from being chosen this round. |
| 10 | **Driver payments on the WO engine** (B-132) | $ M-now/H-later · T M | Med | Reuse win (WO rail → Winchester drivers). Medium impact today, high as CHEP volume scales — a classic Bench climber. |

### Chosen this round (highest impact + effort that fits now)
- **#1 Model routing (B-127)** — Phase 0, in flight. Unblocks telemetry.
- **#2 Receipt pipeline (B-084/085/086)** — highest non-foundational impact; money + time + deductions.
- **#6 Daily digest (B-051)** — cheap, immediate daily leverage; low effort makes it a free win alongside the bigger builds.

### Bench (carry-forward — re-scored Round 1)
#3 Email→WO · #4 QB Send flow · #5 Toll auto-invoice · #7 Voice-to-sheet · #8 Reviewer agent · #9 Cabin dashboard · #10 Driver payments
Plus below-the-line watchlist (didn't make Top-10 this round, still tracked): Vendor performance dashboard (B-012), Notification engine v2 (B-093), FB Marketplace/listing automation (B-080), Lead-finder Chrome extension (B-074), Preventive-maintenance package (B-077), Estimating skill/agent (B-031).

### Movement notes (for Round 1)
- Once telemetry is live, **#8 Reviewer agent** likely jumps — it's the thing that generates future rounds.
- **#4 QB Send flow** and **#3 Email→WO** are near-tied with #2; if #2 ships fast, one of them is the obvious next pick.
- **#10 Driver payments** should be watched against CHEP volume — a real uptick there moves it up sharply.

---

## DECISION LOCKED — July 24, 2026: token-relief plan (build-time vs run-time)

**Correction to earlier framing.** The model router (B-127) offloads **run-time** AI (the Worker's own calls, e.g. receipt vision) from Claude → Gemini. Run-time already bills to the Worker's API key, **separate from Brett's Claude subscription weekly limit.** So the router is a runtime *cost* play — it does **NOT** relieve the weekly limit that caps how many builds Brett can do. Do not rank/pitch B-127 as the weekly-limit fix.

**What actually relieves the weekly limit (build-time = Claude subscription):** in priority order —
1. **Decouple background builds onto API / pay-as-you-go billing** (not the subscription), so build *volume* stops hitting the weekly cap. Config/plan decision, not code. **← do first, biggest relief.**
2. **Gemini build-time subcontractor** — offload the token-heavy build sub-tasks (research, big reads, first drafts) to Gemini so Claude only spends on orchestration + code edits. Small build. **← do second.**
3. **brett-flow lean loading** — already active (~95% fewer tokens/build).

**Router (B-127):** stays queued for run-time savings as automations scale — NOT the weekly-limit fix.

---

## ROUND 1 — Aug 7, 2026 (first Scout+Reuse-Radar scan; in-session, PAT-filed)

> First run of the two-lens Optimizer opportunity engine (outward web research + inward Reuse-Radar), fanned to 2 research subagents + inward analysis. Telemetry is now live (B-128) but near-empty, so ranking is context-informed, not yet data-heavy — that sharpens as `Ops_Telemetry` fills. Ranking below is Claude's honest impact call, authorship-blind.

| # | Opportunity | Lens | Tag | Impact | Effort | Notes |
|---|---|---|---|---|---|---|
| 1 | **Email delivery path** — Cloudflare Email Routing `send_email` binding (free, verified-recipient only) for self-digests NOW; Resend (100/day free, custom domain) for customer-facing later; Cloudflare Email Service binding = own-the-Worker long-term (paid beta) | Outward | FIXES EXISTING | T H · E H | S | Digest + weekly Reviewer are stubbed (`deliverDigestEmail` no-ops). This is what makes "check in once in a while" real — the loop can't reach Brett without it. **MailChannels dead (EOL 2024); SendGrid free tier killed.** → B-205 |
| 2 | **Independent verifier write-gate (`judge()`)** — cheap-model LLM-as-judge returns `{verdict,confidence,reason}` before any consequential write; fails closed → escalate | Outward | BIG GAIN | E H · T M | M | The mechanism that lets autonomy graduate from Rung-1 (prepare) to Rung-2 (auto-ship) safely. Direct fix for both past burns. Ties AUTONOMY_GUARDRAILS. → B-206 |
| 3 | **WO-lifecycle telemetry** — instrument create/assign/status/schedule | Inward | FIXES EXISTING ✅ SHIPPED | E H · T M | S | **Done Aug 7 (`2026-08-07.6`).** Feeds B-129 so the Reviewer stops being data-starved. Metadata-only, best-effort, validator-passed. |
| 4 | **Calendar invite on WO scheduling** (B-204) — verified path: single-user **OAuth refresh token** (NOT service account — SA can't invite attendees), `events.insert/patch` + `sendUpdates:"all"` | Inward | BIG GAIN | E H · T M | M | GATED (customer-facing send) → greenlit build with Brett, not autonomous. Research resolved the exact API path + the SA gotcha. |
| 5 | **Golden-set regression gate on deploy** — 20–50 cases re-run vs the deployed Worker on push; pairs with `test-verified-builds` | Outward | BIG GAIN | E H | M | Catches silent quality regressions before the live Hub. The Rung-2 safety earn-in. → B-207 |
| 6 | **Cloudflare Queues (free since Feb 2026) + D1** — durable state/queue for the overnight Prepare agent + telemetry (Sheets is slow/rate-limited) | Outward | BIG GAIN | T M · E M | M | Infra that makes the overnight loop restart-safe. 10k ops/day free. → B-208 |
| 7 | **Overnight Rung-1 Prepare agent** — the engine: drafts + validates a greenlit item nightly, never deploys | Both | BIG GAIN | T H · E H | M | Brett's core ask. Unblocked now that AUTONOMY_GUARDRAILS is locked; needs a delivery channel (#1) to surface its output. → B-209 |

**Dedup — already on the roadmap, not re-proposed:** multi-model cost router = **B-127**; agentic memory / self-writing context in a Sheet tab = **B-134/B-135**; parallel read-only subagents + context compaction = already in **brett-flow / agent-parallelism** (2026 refinement: enforce the isolated-context + condensed-return contract — minor skill tweak).

**Honest priority call (Claude, truth-mode):** the sequence that makes "improve while I sleep, I just look in" real is **#1 email delivery (small) → #7 overnight Prepare agent (the engine) → #2 verifier write-gate (graduates to auto-ship)**. Delivery first because a loop that can't reach Brett makes him go hunt for its output — the opposite of "look in once in a while." Do NOT stand up auto-ship (#2/Rung-2) before the golden-set gate (#5) earns it.

### Bench (carry-forward — re-score next round)
Receipt OCR→QuickBooks (ties B-084, human-approve gate) · context-compaction refinement for long cron sessions · SMS: **fix Twilio** rather than email-to-SMS gateways (carrier gateways are shutting down + fail silently — disqualifying for alerts) · Round-0 bench still live (Email→WO B-103, QB Send flow, Toll auto-invoice, Voice-to-sheet, Cabin dashboard, Driver payments).
