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
