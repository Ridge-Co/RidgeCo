# Continuous-Improvement Strategy — "The Optimizer" v1.2 addendum

**Status:** v1.0 and v1.1 stay locked and unchanged — this is a further addendum. Locked Sep 20, 2026. Tracked as **B-241**. Ships as **PR #14** (`optimizer-v1-2-scout-queue-write` → `main`).

Read v1.0 and v1.1 first (`Instrument → Review → Research → Propose → Decide → Measure`, the Top-10/Bench rubric, the 4th Product/UX lens + queue-integrity self-check). This doc only covers what changed since v1.1.

---

## Why this exists

Two threads converged in the same Sep 20, 2026 session:

1. **v1.1's Product/UX lens + queue-integrity check had never actually run.** v1.1 (B-238, locked Sep 17) folded a 3rd lens and a standing queue-integrity self-check into the Scout & Reuse-Radar Cowork task. v1.1's own "Still open" section flagged that nobody could confirm whether the task's stored trigger prompt deferred to the strategy doc or hardcoded its own lens list, since a Cowork chat session has no read/edit access to a trigger's own stored prompt. Checked directly this session (via the trigger's scheduling API, not a repo file): it hardcoded its own 3-lens list. **Confirmed stale** — the Product/UX lens and the queue-integrity check had never actually run on a real Mon/Thu firing. Fixed by editing the stored prompt directly.
2. **Brett's own Sep 20 ask**, same session: more best-practice/competitor-driven research, fewer marginal ideas and more forward-thinking ones (while still keeping the quick wins), raise the item cap from "up to 10" to "up to 20," and — the important part — stop making the output a chat message Brett has to manually turn into queue rows himself. Land it as real backlog items.

## The 4 lenses, now actually wired in

1. **Outward (Scout)** — does a tool/skill/model fit our stack better than what we use? Now includes **named-competitor research**: AppFolio, Buildium, Rentvine, Propertyware, Yardi Breeze, TenantCloud on the property-management side; Jobber, Housecall Pro, ServiceTitan on the field-service/vendor-dispatch side.
2. **Inward (Reuse-Radar)** — where do we already have X and already have Y — what if X used Y? Unchanged from v1.0/v1.1.
3. **Product/UX** — the v1.1 lens (real screens, `HUB_UX_DESIGN_FOUNDATION`, `SERVICE_DELIVERY_ROADMAP`'s already-scored ideas). Substance unchanged; this addendum's real news is that it's now actually running.
4. **Queue Integrity** — the v1.1 standing self-check (re-verify `greenlit`/`building` rows against reality, auto-drop clearly-superseded ones with a logged reason, flag ambiguous ones for Brett). Substance unchanged; likewise now actually running.

This doc doesn't restate the trigger's full wording — see the live trigger prompt itself for the verbatim text.

## Cap change — up to 20, for this task only

v1.0's rubric language ("Top-10... not a firehose") is **superseded for the Scout & Reuse-Radar task specifically, on this one point** — both the Monday and Thursday runs now rank up to 20 items instead of 10. No other lens or task in v1.0/v1.1 changes; this is not a general loosening of the rubric.

## Constraint-filter change — stack shape is a preference now, spend discipline stays a real gate

v1.0/v1.1 treated "doesn't fit the single-`worker.js`/Sheets shape" as a hard filter — an idea that failed it was discarded before Brett ever saw it. As of this addendum, **shape-fit is a strong preference, not a disqualifier**: an idea that doesn't cleanly fit the stack gets proposed anyway, adapted where possible, rather than silently dropped. What stays a real, enforced constraint is **spend**: any idea with a genuine dollar cost must set `requires_spend: true` with a `spend_note` explaining the cost, and the prompt asks for a free/cheap workaround alongside it whenever one exists. Cost no longer silently kills an idea before Brett sees it — but it also can't hide inside a proposal that looks free.

## New tag — `FUTURE DIRECTION`

For ideas that resurface a feature Brett has previously and deliberately deferred (rent collection, ACH, tenant screening, full accounting) with fresh competitive context behind the resurfacing — e.g., a named competitor now bundles it, priced a specific way, and here's what building an equivalent would actually take here. Tagged separately from an ordinary new proposal so Brett can tell "a past no worth revisiting" apart from "an idea nobody's raised before."

## New write path — findings land as real backlog rows

**`POST /ops-queue/scout-submit`** (`opsQueueScoutSubmit`), gated by a new narrow secret `env.SCOUT_QUEUE_TOKEN` read from the `X-Auth-Token` header — same convention as the existing `OPS_QUEUE_TOKEN`, not the full admin `WORKER_SECRET`.

Body: `{round, summary, review_ts, items: [{rank, title, lens, tag, effort, problem, action, impact, requires_spend, spend_note, workaround}]}`, capped at 20 items per call. Each item inserts a row into `Ops_Build_Queue` with `Status: 'proposed'`, `Approved_By: 'scout-reuse-radar'`, `Risk_Class: ''` (blank — set later, never by the scout itself). Also best-effort logs a one-row round summary to the existing `Ops_Review_Log` tab (`Trigger: 'scout_reuse_radar'`) — a failure there doesn't fail the submit.

**`Ops_Build_Queue` schema, additive:**
- New status value `'proposed'`, sitting before `greenlit` in the lifecycle: `proposed → greenlit → prepared → building → done`, or `dropped`/`held` at various points.
- New columns: `Lens` (Outward/Inward/Product), `Requires_Spend` (TRUE/FALSE), `Spend_Note`, `Workaround`.
- `opsQueueUpdate` gains an optional `risk_class` field, so `proposals.html`'s new "Approve → Greenlit" action on a `proposed` row can set `Risk_Class` at the moment of promotion. Before that promotion, a scout-submitted row structurally has no risk class and cannot be picked up by anything that requires one (e.g. any future auto-build path).

**`proposals.html`** gained a new "Proposed — from Scout & Reuse-Radar (needs your review)" section, with Approve→Greenlit / Drop actions, separate from the existing greenlit/building cards.

**`OPTIMIZER_ROUND_LOG.md` is now a historical/legacy artifact — Round 0/1 only.** It was always meant to be updated by hand each round, and that manual step never reliably happened (v1.1 itself caught a missing Round 2 that had clearly run). Going forward, `Ops_Build_Queue` (via the rows `scout-submit` inserts) and `Ops_Review_Log` (via its summary row) are the durable source of truth for round history — nobody needs to hand-update `OPTIMIZER_ROUND_LOG.md` again.

Tested in `test/ops-queue-scout-submit.test.mjs` — 57/57 assertions. Full repo suite: 88 files, 87 pass, 1 pre-existing unrelated failure (`trade-map.test.mjs`, fails identically on unmodified `main` — not caused by this change).

## AUTONOMY_GUARDRAILS classification note

`SCOUT_QUEUE_TOKEN` is a new narrow write credential, and it did not cleanly fit the existing SAFE list's literal "new isolated tab only" carve-out — `Ops_Build_Queue` is an existing, shared tab, not a fresh isolated one; the safety here comes from column/status discipline instead of tab isolation. Brett explicitly reviewed and signed off on classifying this write path SAFE, in a chat session on Sep 20, 2026, on these specific grounds:

- **Insert-only** — `scout-submit` only appends rows; there is no update or delete path behind this token.
- **`Status` is hardcoded server-side to `'proposed'`** — the token structurally cannot ever write `greenlit`, `building`, or `done`. A row it creates cannot become buildable without a separate, later action through a separate credential (`opsQueueUpdate`'s `WORKER_SECRET`-gated status/risk-class write), taken by Brett or a reviewer.
- **No money, PII, or auth surface is touched.**
- **Capped** at 20 items per call.
- **Never builds or deploys anything** — the only effect is a row someone still has to look at and promote.

This entry is the record that closes that specific gap in the SAFE list's wording, for this one case. It is **not a general loosening of AUTONOMY_GUARDRAILS**, and it is **not an edit to `AUTONOMY_GUARDRAILS_v1.0.md` itself** — that file stays locked; only Brett changes it, per its own rule.

## Already live — independent of the PR

The Scout & Reuse-Radar task's own stored trigger prompt (not a repo file) was rewritten directly via its scheduling API in this same Sep 20 session. The 4-lens list, named competitors, the 20-item cap, the softened shape-filter, the `FUTURE DIRECTION` tag, and the new Step 6 call to `/ops-queue/scout-submit` are all **live now** — none of it waits on this PR merging. What does wait on the PR (and on one Worker secret) is whether Step 6's call actually succeeds.

## Still needed from Brett

1. **Set the `SCOUT_QUEUE_TOKEN` Cloudflare Worker secret** — the endpoint is deployed-but-inert without it, same pattern as `OPS_QUEUE_TOKEN`/`TRASH_NUDGE_TOKEN`. Until it's set, Step 6's write will fail closed.
2. **Merge PR #14** (`optimizer-v1-2-scout-queue-write` → `main`) — worker.js/proposals.html changes above are built and tested but not live until this merges.

Until both of these happen, the trigger runs with its new prompt (competitor research, 20 items, `FUTURE DIRECTION` tag, softer shape-filter) but the queue-write step will fail — the round's findings still need to reach Brett as a chat message in the meantime, same as before this addendum.
