# Continuous-Improvement Strategy — "The Optimizer" v1.0

**Status:** Strategy locked July 22, 2026. Governs all future builds via **PAT-031 + PAT-032**.
**Read `brett-context` + `brett-flow` first.** Builds tracked as B-128..B-132. Pairs with `MODEL_ROUTING_BUILD_BRIEF_v1.0`.

---

## 1. The vision (in Brett's words)

Not just efficiency. A **supervisory layer that watches everything we run, on real data, and proactively comes to Brett and says: "I can do this job better/faster if we do X — here's the payoff, the effort, and the risk."** It reviews existing skills and processes for effectiveness *and* improvement, researches new skills/tools/patterns others are using and filters for what fits us, and brings **new** things to the table — new processes, new business lines, and resource-combining moves (e.g. the Work Order engine becoming the payment rail for pallet drivers). This is the "valet, not a remote control" model (#257) made real: it thinks ahead, it doesn't wait to be asked.

Guardrails baked in from the start (from Brett's own operating manual):
- **Data-backed, not vibes.** Every proposal cites real telemetry/observation, not a guess.
- **Top-10 ranked by impact, not a firehose.** Highest-impact first; each row scannable with a single concrete next action (personal-mindset: structure + next action, no cheerleading). Brett chooses which to build this round; the rest go to the Bench.
- **Nothing gets thrown away — the Bench carries forward.** Items that make the Top-10 but aren't chosen this round persist and are **re-scored every round**. A #7 today can become #1 later as the business changes, effort drops, or a dependency ships. (Brett's explicit directive.)
- **Brett decides, Optimizer proposes.** Nothing self-executes past a human gate.
- **Payoff must be measured after the fact** — did the change actually help? (Anti-"checker theater.")
- **Simplest viable path first**; honest "don't build this yet" is a valid output.

### Impact rubric (how the Top-10 is ranked)
**Impact is ranked highest-first.** Impact = the larger of **time/effort saved** or **cost saved** — but **effectiveness improvements cannot be ignored** and are scored alongside. Each candidate is rated H/M/L on three dimensions, then ranked by overall impact:
- **Time/Effort saved** — how much manual work it removes. **Recurring savers outrank one-time savers** (they compound).
- **Cost saved / recovered** — direct dollars: lower spend, recovered receivables, captured deductions, new revenue enabled.
- **Effectiveness** — fewer errors, better decisions, better customer/vendor experience, less risk. A money- or customer-facing accuracy gain counts here even if it saves no time.

**Effort** is shown next to each item but is NOT the ranking axis — it's the *selection* factor. Among high-impact items, low-effort ones get chosen first this round; high-impact/high-effort ones stay ranked high on the Bench until their effort drops or their payoff is urgent. Ranking answers "how much is this worth?"; effort answers "do we do it now or next round?"

The live ranked list + Bench lives in `OPTIMIZER_ROUND_LOG.md` (updated every round).

## 2. The core loop (a proactive/goal loop — see the Loops discussion)

**Instrument → Review → Research → Propose → Decide → Measure → (repeat)**

1. **Instrument.** Every skill, process, and Worker job emits a small telemetry record (model used, tokens, cost, latency, success/fail, escalations, human-corrections). Lives in `Ops_Telemetry` (from the Model Routing build) plus lightweight process logs. *This is the "real data" the whole thing runs on — nothing else works without it, so it ships first.*
2. **Review** (scheduled agent, e.g. weekly). Reads telemetry + BACKLOG + current skills and asks: what's slow, expensive, or error-prone? Where did the cheap model escalate a lot (routing mis-tiered)? Which process still has manual steps? Which two systems share a mechanism and could be merged?
3. **Research** (Scout agent). Scans for new skills/tools/models/patterns others use (web + skill/plugin registries + model releases), and **filters against Brett's constraints** (mobile/Cowork, single-file, own-the-Worker, $20/mo cap, security-first). Proposes only what actually fits — the same job we just did by hand for Headroom/OmniRoute, now automated.
4. **Propose.** Delivers the **ranked Top-10** to Brett (impact rubric above): each row = *"Do X → impact (time/$/effectiveness), effort, risk, next action."* Uses `brett-amplify` framing for "what this unlocks next." Brett picks which to build this round; unchosen items drop to the **Bench** in `OPTIMIZER_ROUND_LOG.md`.
5. **Decide.** Brett approves → graduates to a `brett-flow` build. Existing things improved = versioned; new things = a build brief. Chosen items leave the Top-10; the Bench back-fills the freed slots next round.
6. **Measure.** After a change ships, telemetry proves whether the payoff materialized. Closes the loop and **re-scores the whole Bench** — rankings shift as the business changes, so the next round's Top-10 is freshly ordered, not stale.

## 3. Components to build

- **Telemetry spine** (B-128) — `Ops_Telemetry` + process logging; the prerequisite for everything. Small.
- **Reviewer agent** (B-129) — scheduled task (create_trigger / Worker cron) that reads telemetry → ranked improvement proposals. Runs on the CHEAP tier by default; escalates only the synthesis. Medium.
- **Scout agent** (B-130) — researches new skills/tools/models, filters for fit, proposes. Medium.
- **Reuse-Radar** (B-131) — scans the system for shared mechanisms and names combine-opportunities before we build the same thing twice. Ongoing. (Worked example below.)

## 4. Governance — how EVERY future build inherits this

Two new mandatory patterns (added to the Context Document):

- **PAT-031 (Route + Instrument by default).** Every build routes AI work by tier (cheap-by-default + escalation, per the Model Routing brief), logs telemetry, and **declares its own success metric**. No build ships without a way to measure whether it works. Reuse-first: every build must state *what existing mechanism it reuses*.
- **PAT-032 (Continuous review).** Every skill/process is reviewed on a cadence for effectiveness **and** improvement. The Optimizer proposes; Brett disposes. `brett-flow` session-close gains a step: log the job's telemetry + note any improvement the Optimizer should look at.

## 5. Worked example — the reuse pattern (why the Optimizer earns its keep)

**The Work Order engine is a generic rail:** `job → do work → verify → invoice → pay → communicate status`. Winchester Hauling driver payments are the *same rail with roles flipped*:

- Driver = a **vendor** who delivers pallets. Each delivery = a **work order / job**.
- Verified pallet count = the **"work done"** (the CV/"monitor-don't-do" count from #257; discrepancies escalate to human review — same escalation pattern as the router).
- Generate a **payable/invoice** to the driver → **pay electronically** → **communicate** confirmation + running total via **SMS** (Twilio; the `sendSMS` chokepoint already exists, and Twilio skills are available for the driver-facing thread).
- Driver interactions become a **data source**: reliability/volume signal feeds **recruitment**, pricing feedback tunes rates, and friction points feed **system improvement** — which loops right back into the Optimizer.

The point: we don't build a separate "driver payment app." We **extend the WO engine** and the Optimizer's job is to spot exactly these reuse moves across all ventures (BarrelCo consignment payouts, Cabin cleaner scheduling, fleet holder-billing) so one well-built mechanism pays off many times. Tracked as **B-132** (driver-payment system on the WO engine).

## 6. Phasing (respect the time/cost box)

- **Phase 0 — now:** Model Routing (B-127) with telemetry baked in. Small, high-leverage, unblocks the data.
- **Phase 1:** Reviewer agent (B-129) on a weekly schedule → first real data-backed proposals.
- **Phase 2:** Scout agent (B-130) → automated new-skill/tool research.
- **Phase 3:** Reuse-Radar (B-131) + payoff-measurement close-loop; first reuse build = driver payments (B-132).

## 7. Honest scope note

The full Optimizer is a program, not a weekend — but it's **incremental and each phase stands alone.** Phase 0 saves money immediately even if we never build the rest. Every later phase is a small scheduled agent reading data that already exists. No big-bang build, no dependency cliff.
