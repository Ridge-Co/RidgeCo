# Rung-2 Auto-Ship (SAFE class only) — Build Brief v1.0

**Status:** design locked Sep 17, 2026 — decisions below are Brett's own. Nothing in this brief is
built yet (except the one schema field noted in §1, shipped same day). Tracked as **B-239**.
Extends `AUTONOMY_GUARDRAILS_v1.0` (that file stays locked/unchanged — this brief works entirely
inside the Rung-2 lane it already reserved) and `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.1`. Read both
first.

## What Brett asked
"I would like to simplify the optimizer workflow. I would like to approve the items/batches and
have them go into production automatically end of day."

## Decisions locked (Brett, Sep 17)
- **Scope: SAFE class only.** Money/QB, PII, auth/secrets, schema changes, and customer sends stay
  exactly as gated as they are today — those items still need Brett's own hand in a PAT-equipped
  session regardless of how enthusiastically they're greenlit. This is the narrow slice
  `AUTONOMY_GUARDRAILS_v1.0` already reserved for Rung 2; nothing about the GATED list changes.
- **Batches run at end of day.** If one item in a batch fails its smoke test, **hold that item
  only** — everything else that passed still ships. No whole-batch rollback on a single failure.

## The recommended architecture
The open question flagged when this was first scoped: is GH Broker (or any GitHub credential)
reachable from a *headless/scheduled* Cowork session, as opposed to the interactive session that's
confirmed it works from? Rather than build on that unconfirmed fact, route the SHIP step through
the same place B-129 (Weekly Reviewer) already lives: **a Worker cron**, which has real,
proven, secret-backed access (Sheets, `ANTHROPIC_API_KEY`) with zero dependency on Cowork session
infrastructure. Concretely:

- **Prepare (Rung 1) stays exactly what it is today** — the "Optimizer Prepare" Cowork scheduled
  task. Writing/debugging a real multi-file code change needs actual agentic reasoning and tool
  use, which a bare Worker API call can't do. Only *where it saves its output* changes (§1).
- **Ship (the new Rung-2 step) becomes a new Worker cron** ("Optimizer Ship," end-of-day) that
  reads what Prepare already finished, judges it, pushes it, watches it, and rolls it back if it
  fails — entirely inside the Worker, the same trusted place `runWeeklyReview`/`judge()`/the
  digest already run.

This is a real design choice, not the only option — the alternative (a headless Cowork session +
GH Broker) is faster to build IF GH Broker turns out to be headless-reachable, but this brief
recommends not betting the whole feature on an unconfirmed fact when a proven pattern already
exists in this exact codebase.

## What has to exist that doesn't yet

1. **A place for Prepare's finished output to land.** Today it's a "paste-ready reconstruction
   file" handed to Brett via SendUserFile — that hand-off IS the manual step this request wants
   gone. Needs new fields on `Ops_Build_Queue`: `Patch_Content` (or, if a diff is too big for a
   Sheets cell — cells cap around 50k characters and a real `worker.js` patch can exceed that — a
   Drive file ID pointer instead, same pattern already used for scans/receipts elsewhere in this
   codebase), `Prepare_Report` (the `test-verified-builds` + `ridgeco-validate` output),
   `Prepare_Status` (`not_started`/`preparing`/`ready`/`failed`). **Not built.**
2. **`Risk_Class` on `Ops_Build_Queue`** (`SAFE`/`GATED`) — the literal field `judge()` already
   hard-requires as `riskClass` (worker.js, `judge()` — anything other than the exact string
   `'SAFE'` is refused structurally, before an LLM ever sees it). Whichever lens proposed the item
   (Reviewer/Scout/Reuse-Radar/Product) needs to set it; unset defaults to `GATED`, matching
   `AUTONOMY_GUARDRAILS_v1.0`'s own rule ("everything not explicitly SAFE is treated as GATED").
   **✅ Shipped same day** — `OPS_QUEUE_COLS` + `opsApprove` both updated, `node --check` +
   full suite clean, `BUILD_VERSION 2026-09-17.4`. Greenlighting an item never sets or changes its
   Risk_Class — only the proposing lens (or Brett by hand) may.
3. **The staging deploy gate merged.** Already built (`claude/staging-deploy-gate-8nttsk` /
   `staging`, per `STAGING_DEPLOY_GATE_BUILD_BRIEF_v1.0.md`) — stubs QuickBooks/SMS/Gmail writes so
   a change can be smoke-tested on `maintenance-hub-staging` (already live, confirmed Aug 22)
   without touching real money or real messages. Sitting unmerged. Needed so a SAFE-class change
   gets verified on staging BEFORE it ever reaches `main`. **Not merged.**
4. **A smoke-test harness (B-141).** Nothing today curls the live endpoints and asserts they still
   work after a deploy — this decides pass/fail on both the staging check and the post-prod-deploy
   check. **Not built.**
5. **A GitHub push path for the Worker cron itself.** Either (a) the Ship cron calls GH Broker's
   own Worker-to-Worker API (not the MCP wrapper), if one exists, reusing the credential Brett
   already trusts — needs confirming GH Broker actually exposes that; or (b) `maintenance-hub` gets
   its own narrowly-scoped deploy credential as a Worker secret, independent of GH Broker. **Open
   question for the build session — check GH Broker's own source/routes before assuming either
   way; don't guess.**
6. **Rollback.** Ship snapshots the pre-change file content before pushing; on a failed
   post-deploy smoke test it pushes that snapshot back (a real, automatic revert — not a manual
   rule-18-style force-redeploy) and alerts Brett. This is the literal mechanism the "two burns"
   section of `AUTONOMY_GUARDRAILS_v1.0` exists to make unnecessary to do by hand again. **Not
   built** (this is B-148, "canary rollout + automated rollback," currently unbuilt).
7. **`judge()` wired to this real call site.** It's built, tested, and fails closed — but nothing
   autonomous has ever actually called it. This Ship cron is that first real call site.
8. **End-of-day digest section.** Mostly infrastructure that already exists (Gmail send is live,
   `weekly_review_enabled` just proved the delivery path works end-to-end) — needs a new section:
   what shipped, what got held back (smoke-fail, that item only), what was skipped as GATED and
   still needs Brett's own hand.

## Sequencing
1. `Risk_Class` field — done (§1 above).
2. Merge the staging deploy gate — unblocks real staging verification, independently useful even
   before auto-ship exists at all.
3. Smoke-test harness (B-141) — needed by both the staging-verify and prod-verify steps.
4. Resolve + build the Worker's own GitHub push path (§1 item 5).
5. The Ship cron itself: read greenlit + `Risk_Class=SAFE` + `Prepare_Status=ready` items →
   `judge()` → push to a branch → deploy-verify on staging → push to `main` → smoke-test prod →
   roll back that one item on failure (per Brett's call) → log + digest.
6. Turn it on for a genuinely narrow first slice before trusting it with anything larger — Brett's
   own sequencing rule in `AUTONOMY_GUARDRAILS_v1.0` already says this explicitly ("turn on Rung 2
   auto-ship for ONE narrow safe class only after the validator has earned it. Do not skip to
   (3)."). Recommend starting with copy/label/internal-tooling changes only — the narrowest SAFE
   examples the guardrails doc already names — before widening the class.

## Explicitly out of scope for this brief
Anything in the GATED list (money/QB, PII, auth/secrets, schema changes, customer sends) — those
stay exactly as manual as they are today, per Brett's own decision above. This brief does not touch
`AUTONOMY_GUARDRAILS_v1.0` itself.
