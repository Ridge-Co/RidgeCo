# Continuous-Improvement Strategy — "The Optimizer" v1.1 addendum

**Status:** `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0.md` stays locked and unchanged — this is an addendum, not a replacement. Locked Sep 17, 2026. Adds a 4th lens and a standing queue-integrity check. Tracked as **B-238**.

Read v1.0 first (`Instrument → Review → Research → Propose → Decide → Measure`, the Top-10/Bench rubric, "Brett decides, Optimizer proposes"). This doc only covers what changed.

---

## Why this exists

The three lenses running today — the Reviewer (Worker cron, telemetry-only, reactive), Scout (outward, does a tool/skill/model fit our stack?), Reuse-Radar (inward, do we already have X and Y — what if X used Y?) — never look at the product itself. Nothing proposes a UI, functionality, feature, or usability improvement Brett hasn't already named, independent of telemetry or reuse. Separately, nothing ever re-checks an item already sitting `greenlit`/`building` in `Ops_Build_Queue` — a proposal's premise can go stale (shipped a different way, blocker cleared, superseded by newer work) and nobody notices until Brett stumbles on it.

## 4th lens — Product/UX Opportunity

**Not a new scheduled task.** Folded into the existing **Scout & Reuse-Radar** Cowork task (Mon/Thu 8am ET, `trig_01CphCdHS4...`) as a third angle alongside the two it already runs:

1. Outward (Scout, existing) — does a tool/skill/model fit our stack better than what we use?
2. Inward (Reuse-Radar, existing) — where do we already have X and already have Y — what if X used Y?
3. **Product (new)** — looking at the real screens (`index.html`/`vendor.html`/`wo.html`/`owner.html`), `HUB_UX_DESIGN_FOUNDATION_v1.1.md`, and what comparable tools do (`SERVICE_DELIVERY_ROADMAP_v1.0.md`'s 224 already-scored ideas + its competitor teardown) — what UI, functionality, feature, or usability gap exists that Brett hasn't named?

**Grounding rule** (mirrors the Reviewer's "ground every item in the metrics," adapted for a lens with no telemetry to point to): every item must cite something concrete — the specific screen/flow it improves, a specific line in `HUB_UX_DESIGN_FOUNDATION` it satisfies or violates, or a specific gap against a named `SERVICE_DELIVERY_ROADMAP` idea that hasn't graduated. No generic filler ("add dark mode"-style items with nothing real behind them).

**Dedup rule**: before proposing, check whether the idea already exists as a B-item or an already-scored roadmap idea. If it does, don't re-propose it fresh — re-score it on the Bench if it's real and un-chosen, or skip it if it already shipped. Same convention Round 1 already used for its own dedup list.

**Output**: same Top-10/Bench format in `OPTIMIZER_ROUND_LOG.md`, same impact rubric (T/$/E), tagged alongside the existing Outward/Inward/Both markers (e.g. **Product**).

## Queue integrity — standing self-check on `Ops_Build_Queue`

Before ranking new proposals, every Scout & Reuse-Radar run now first re-checks every row with `Status = greenlit` or `building` against what's actually true right now (recent `FEATURE_LOG.md` entries, `CURRENT.md`, and the live repo for anything code-specific), and sorts each into:

- **Clearly superseded** — the exact thing it proposed already shipped (a `FEATURE_LOG` rule covers the same endpoint/screen/job), or its stated blocker/premise has flipped in a way that makes the item moot as written (not just "easier now" — actually moot). → **auto-set `Status = dropped`**, with `Drop_Reason` filled in with the specific evidence (rule #, commit, or fact that superseded it) and `Superseded_By` if there's a specific B-item/rule it maps to. Surfaced as a short list in the round's summary so Brett sees what dropped and why, without hunting for it.
- **Ambiguous** — premise changed (a blocker cleared, so effort/rank should move) but the item is still real and undone; or it's a partial overlap with newer work; or there's no clear evidence either way. → **flag it in the round summary, do not touch its `Status`.** Brett decides.
- **Still accurate** — no action, no mention. Only the deltas are worth Brett's attention.

This reuses the existing SAFE-class write path — `opsQueueUpdate`'s status write already touches no money/PII/auth, so auto-dropping a superseded internal backlog row needed no new permission, just a place to put the reason so it's traceable later instead of a silent disappearance.

**Schema** (shipped Sep 17, `Ops_Build_Queue`, additive via `ensureColumns`): `Drop_Reason`, `Superseded_By`. `opsQueueUpdate` takes optional `reason`/`superseded_by` fields.

## Still open — not something a chat session can do

The Scout & Reuse-Radar task's own stored trigger prompt isn't a repo file — no read/edit access to it from a Cowork chat session. If its prompt already defers to this strategy doc, it picks up v1.1 on its own next run. If it hardcodes its own lens list instead, it needs a manual update — paste its current wording into a session and it'll say exactly what to change.
