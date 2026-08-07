# Telemetry Spine — Build Brief v1.0 (B-128)

**For:** the Claude Code session that builds this. **Read `brett-context` + `brett-flow` first (PAT-024).**
This is the execution contract for the **telemetry spine** — the `Ops_Telemetry` tab plus a single
logging chokepoint, on both the Worker side and the Cowork side. It is the **prerequisite for
everything in `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0` ("The Optimizer")**: the outer loop is fully
designed and locked but has **no real data to run on** until this ships. Governs measurement per
**PAT-031** (every build declares + logs its own success metric) and **PAT-032** (continuous review).

---

## Why we build this (the honest version)

The "bilevel loop" idea Brett reviewed (Karpathy's `autoresearch` / loop-engineering) reduces to
three parts: a **verifier**, persistent **state**, and a **stop condition** — and its core discipline
is *"a loop only earns its cost when the work is measurable."* Brett already has the verifier layer
(`test-verified-builds`, `ridgeco-validate`, `brett-flow`) and the outer-loop **design** (The
Optimizer). The one missing piece is the **measurable state** the outer loop reads. Round 0 of the
Optimizer was explicitly ranked on judgment, not data (`OPTIMIZER_ROUND_LOG.md`), *because this tab
does not exist yet.* This brief closes that gap and nothing more — no new loop, no new agent. It
turns the designed outer loop from a blueprint into something that can actually run.

**Scope decision (Brett, Aug 7): instrument BOTH the Worker/AI calls AND the Cowork skills/processes.**
One tab, two feeders. The Optimizer needs both to see the whole system, not just the Worker slice.

## What ships (v1)

1. **`Ops_Telemetry` Sheet tab** — one canonical schema, dual-source (Worker rows + Cowork rows).
2. **`logTelemetry(env, rec)`** — the single Worker-side logging chokepoint (mirrors how `sendSMS`
   is the single SMS chokepoint). Every Worker job that wants to be measured calls this one helper.
3. **`POST /telemetry/log`** — a `WORKER_SECRET`-gated endpoint so **Cowork sessions and skills** can
   emit one telemetry row over HTTP at session close (there is no cron and no local dev server — Cowork
   already reaches the deployed Worker over HTTP, same path `test-verified-builds` uses).
4. **Two hardening adds** (from the loop-engineering takeaways) — sections H1 + H2 below.

This spine ships **before** the Model Routing router (B-127). When B-127 lands, `routeAI` simply calls
the `logTelemetry` helper that already exists — no rework. B-128 does not depend on B-127.

---

## Data model

### New tab `Ops_Telemetry` — canonical header (create with `addRow`'s auto-create; `ensureColumns` on every write)

```
ID, Timestamp, Source, Session_Id, Job_Type, Skill_Or_Endpoint, Tier_Requested,
Model_Used, Escalated, Tokens_In, Tokens_Out, Est_Cost, Latency_ms, Success,
Confidence, Human_Corrected, Notes
```

This extends the schema in `MODEL_ROUTING_BUILD_BRIEF_v1.0` with three columns so one tab covers both
feeders: **`Source`** (`worker` | `cowork` | `skill`), **`Session_Id`** (Cowork session id or Worker
request id — lets the Optimizer group a multi-step job), **`Skill_Or_Endpoint`** (which skill ran, or
which Worker route). Everything else is unchanged from the router brief so the two builds stay aligned.

Field notes:
- **`Success`** — hard boolean the verifier writes, never the worker's own optimism. `TRUE` only when
  a downstream check passed (schema valid / row landed / test green). This is the "verifier, not
  self-agreement" rule made concrete.
- **`Human_Corrected`** — back-filled `TRUE` when Brett edits that result in the Hub. The single
  strongest mis-tiering / stuck-pattern signal (see H2). Blank in v1 for Cowork rows; Worker Hub-edit
  back-fill is Phase C, best-effort.
- **`Est_Cost`** — Worker computes it from `Tokens × MODEL_REGISTRY` rate (when B-127 exists). Blank
  is allowed for Cowork rows where cost is unknown — **blank, never a fake number.**
- **`Confidence`** — the cheap model's self-reported / validator confidence, when available; blank OK.

### Reuse (do NOT reinvent — see `CODEMAP.md`)
- **`addRow(env,'Ops_Telemetry',rec)`** — generic append, auto-ID, clean 404 on missing tab (~L1761).
- **`ensureColumns`** before every write — **FEATURE_LOG rule 37**: a write to a header that doesn't
  exist reports `success:true` and stores nothing. The logger must call `ensureColumns` first.
- **`fetchConfig`/`setConfigKey`** (~L1694–1706) if any telemetry toggle needs to live in `Config`.

---

## Worker build

### `logTelemetry(env, rec)` — the chokepoint
- Fills defaults (`ID` auto, `Timestamp` now, `Source` defaults `worker`), `ensureColumns`, `addRow`.
- **Fails loud, never silently.** Returns a landed-or-throw result using the
  `woUpdateLanded`-style guard (**FEATURE_LOG rule 19**: a wrong route AND a wrong column both return
  `success:true`; `addRow` can report success while touching nothing). A telemetry write that did not
  land must surface, not vanish — otherwise the Optimizer runs on holes and doesn't know it.
- Wrap-in points for v1 (cheap, high-signal): `GET /daily-digest`, the batch note/receipt parse path,
  and `/telemetry/log` itself. Add more endpoints opportunistically; do not boil the ocean.

### `POST /telemetry/log` — the Cowork feeder
- **Auth:** `WORKER_SECRET` (secret tier), same gate as the other write endpoints. Reject missing/bad
  secret with a clean `401` (auth-boundary test below).
- Body = a partial telemetry record (`Source:'cowork'|'skill'`, `Session_Id`, `Skill_Or_Endpoint`,
  `Job_Type`, `Success`, `Notes`, optional `Tokens_*`/`Latency_ms`). Server stamps `ID`/`Timestamp`.
- Calls the same `logTelemetry` helper — one write path, one place to change.

### Cowork side (how skills actually emit)
- `brett-flow` session-close already carries a PAT-032 step ("log the job's telemetry"). Give it a
  concrete target: one `POST /telemetry/log` per session (and optionally per skill run) with
  `Source:'skill'`, the skill name in `Skill_Or_Endpoint`, `Success` = did the verify gate pass,
  and a one-line `Notes`. Keep it to a single append — **no per-token accounting from Cowork in v1.**

### Volume / quota (honest)
- v1 = **direct append per event.** Simple, and current volumes are far under Sheets quota. FEATURE_LOG
  rule 49 flags the Sheets-quota gotcha — if Worker AI volume climbs after B-127, add a **batch-to-Cache
  → periodic flush** (the `queueNotification`/`Notification_Queue` pattern is the precedent). Note it,
  don't pre-build it.

---

## H1 — Hardening add: the un-gameable verifier (skill-doc rule, not code)

The loop-engineering lesson: *the grader must not be able to see or reuse the maker's self-report, or
it just agrees with itself.* Codify it in the two verifier skills so it can't drift:

- **`test-verified-builds` + `ridgeco-validate`:** add a one-line standing rule — *the verifier reads
  the brief's acceptance criteria and **live state only** (deployed-Worker responses, actual Sheet
  read-backs). It never reads, trusts, or restates the builder agent's "done"/"success" claim.*
- Concretely for this build: `Success` in `Ops_Telemetry` is only ever written from a downstream check
  (schema valid, row read back, test green) — **never** from the handler reporting its own success.
- These are edits to skill files Brett owns; the brief specifies the exact rule text, Brett saves the
  skills. No worker.js change.

## H2 — Hardening add: the Optimizer "stuck-pattern" Review step (strategy-doc rule)

The bilevel outer loop's real move is *breaking a loop that keeps returning to the same failed pattern.*
Map it onto Brett's **#1 trust-killer** (an agent restating a refuted plan with a fresh apology):

- Add to `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0` **Review step (§2.2)** one question: *"Where is a build
  or agent looping on the same failed pattern? If so, change strategy — don't retry the same approach."*
- This is **detectable from the telemetry this brief ships**: repeated `Success=FALSE` on the same
  `Job_Type`, or a spike in `Human_Corrected` for one `Skill_Or_Endpoint`, = a stuck pattern the outer
  loop should flag and re-route, not re-run. No new field needed; it falls out of `Success` +
  `Human_Corrected` + `Job_Type`.
- Edit to the strategy doc; no code. Ship alongside so the spine and the rule that reads it land together.

---

## Acceptance criteria (the verify gate — `test-verified-builds` at brett-flow step 5.5)

A "done" claim is only valid when **all** of these are proven against the **deployed** Worker:

1. **Tab + schema:** `Ops_Telemetry` exists with the exact 17-column header above (read it back).
2. **Worker write lands:** call an instrumented path (e.g. `GET /daily-digest`), then **read the tab
   back** and confirm a new row appeared with the right columns populated (before/after row count).
   This is the rule-37/rule-19 guard — proving the write *landed*, not that it *returned success*.
3. **Cowork feeder lands:** `POST /telemetry/log` with a valid `WORKER_SECRET` and a sample body →
   read back the row; `Source='cowork'`/`'skill'`, `Session_Id`/`Skill_Or_Endpoint` present.
4. **Auth boundary:** `POST /telemetry/log` **without** the secret → `401`, no row written (read back
   to confirm zero new rows).
5. **Fail-loud:** simulate a bad write (missing header pre-`ensureColumns`) → the logger surfaces an
   error, does **not** report a phantom success.
6. **H1/H2 doc rules present:** the verifier-skill rule text (H1) and the Optimizer Review question
   (H2) are written into their files.

Then **`ridgeco-validate`** (recommended — this adds a secret-gated write endpoint + a new tab):
built-vs-brief gap report, no fixes. Only after both pass does this ship.

## Success metrics (PAT-031 — measurable, or it didn't happen)
- After launch, **every** instrumented Worker job and **every** Cowork session close writes exactly
  one `Ops_Telemetry` row (spot-check a day's rows vs. sessions run — no silent gaps).
- The Optimizer's next round (Round 1) is ranked on **read telemetry, not judgment** — the stated
  trigger for retiring the `OPTIMIZER_ROUND_LOG.md` "judgment-based" caveat.
- Zero phantom-success writes (criterion 5 holds in production).

## Build order
- **A)** Create `Ops_Telemetry` + `logTelemetry` helper → wire into `GET /daily-digest` → verify a row
  lands (criteria 1–2, 5).
- **B)** `POST /telemetry/log` (secret-gated) + Cowork session-close hook in `brett-flow` → verify
  Cowork rows + auth boundary (criteria 3–4).
- **C)** H1 + H2 doc rules; `Human_Corrected` Hub-edit back-fill (best-effort) → update FEATURE_LOG +
  BACKLOG (B-128) + push.

## Prerequisites (flag before build — PAT-029)
- No new secret needed (reuses `WORKER_SECRET`). No new provider. No Gemini key required (that's B-127).
- Confirm the service account can write a new tab on the Hub sheet (PAT-027) — it already writes others.
- If B-127 ships first, its `routeAI` telemetry write **must** call this same `logTelemetry` helper —
  one write path, not two.

## Cost & complexity (honest)
- **Complexity: LOW.** One tab, one helper, one secret-gated endpoint, two doc edits. Extends existing
  `addRow`/`ensureColumns`/auth patterns — no new infrastructure. Comfortably inside Brett's ~2-hour
  ceiling.
- **Running cost:** effectively zero (Sheet appends). Watch quota only if AI volume climbs post-B-127.
- **What it does NOT do:** it does not build the Reviewer/Scout agents (B-129/B-130) — those are the
  next phase and are what *read* this data. This brief only lays the rail they run on.
```
