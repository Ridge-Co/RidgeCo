# Autonomy Guardrails — v1.0

**Status:** Locked Aug 7, 2026. Governs every background / scheduled / overnight agent that acts on
BrettOS. Read `brett-context` + `brett-flow` first. Pairs with `BUILD_ORDER_v1.0` (autonomy substrate
B-140s), `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0` (the Optimizer), and the two verifier skills
(`test-verified-builds`, `ridgeco-validate`). **Nothing in this file may be loosened by an agent — only
Brett changes it.**

## Why this exists (the two burns)
The Hub has broken twice, both from unverified change hitting production: (1) a status write that
returned `success:true` and silently changed nothing (FEATURE_LOG rule 6/19), and (2) a non-prod branch
build that deployed to production and 403'd the live Hub (rule 18). An agent writing + deploying code
unattended, overnight, to a system that moves QuickBooks money and holds tenant PII is how those become
routine. This file is the lane that makes overnight self-improvement safe.

## The autonomy ladder — what an agent may do WITHOUT Brett
| Rung | Action | Autonomous? | Conditions |
|---|---|---|---|
| **0 — Propose** | research, rank, surface opportunities; read-only reads | ✅ yes | The Scout/Reviewer live here. No writes of any kind. |
| **1 — Prepare** | write the complete change to a working copy, run `test-verified-builds` + `ridgeco-validate`, leave a tested+validated change-set + report | ✅ yes (overnight) | **NEVER deploys.** Output is a ready-to-ship diff/full-file + a passing validator report + the exact acceptance criteria checked. Stops at the deploy gate. **"Tested" means verified against `https://maintenance-hub-staging.brett-2f8.workers.dev` (the separate staging Worker service, own Sheet, QB/SMS/Gmail stubbed — see CREDENTIALS_MAP.md "Staging sandbox" and the staging deploy gate, Sept 2026), never against production** — any change touching `worker.js`, `index.html`, `vendor.html`, or `wo.html` lands on a branch, gets smoke-verified on the staging URL, and only then merges to `main` (which is what actually deploys to prod). |
| **2 — Auto-ship (earned, narrow)** | apply + deploy a change | ⚠️ only for the SAFE class below, only after the validator has passed ≥5 real Rung-1 cycles for that class, with auto-rollback on smoke-fail | Whitelisted safe class ONLY. Logs telemetry. Any smoke-test fail → auto-revert + alert Brett. |
| **3 — Gated** | anything in the GATED list below | ❌ never autonomous | Always Brett's explicit hand, in a PAT-equipped/interactive session. |

Default posture today: **Rung 0 + Rung 1 only.** Rung 2 stays off until Brett turns it on per-class.

## Risk classification — what is SAFE vs GATED
**GATED (Rung 3 — never autonomous, ever):**
- Any QuickBooks call, invoice, bill, payment, or anything that moves money.
- Any write to tenant / owner / vendor PII (phone, email, name, PIN, ID) or lock/access codes.
- Any change to auth, `WORKER_SECRET`/secrets, role scopes, or the auth gate.
- Deleting, renaming, or reordering columns on a live Sheet tab; schema changes to existing tabs.
- Deploying hand-edited money-, customer-, or auth-facing worker.js/index.html/vendor.html code.
- Anything touching CHEP / Winchester financials or the private data repo.
- Sending SMS/email to a real customer/owner/tenant (drafts are fine; sending is gated).

**SAFE class (eligible for Rung 2 once earned):**
- Additive, read-only Worker endpoints that touch no money/PII/auth.
- Internal Dev-Log / admin tools that only Brett (admin secret) can reach.
- New, isolated Sheet tabs the agent creates (like `Ops_Telemetry`) — never edits to existing tabs.
- Copy / text / label changes with no logic change.
- Telemetry, logging, and internal reporting.
Everything not explicitly SAFE is treated as GATED until Brett classifies it.

## The overnight loop (how "improve while I sleep" actually runs)
1. **Scout/Reviewer (Rung 0)** propose + rank → the ranked list + bench (already built).
2. **Brett greenlights** items (or pre-approves a class). Only greenlit items enter the build queue.
3. **Prepare agent (Rung 1, overnight)** takes the top greenlit item, writes the complete change to a
   working copy, runs `test-verified-builds` (runnable checks against the deployed Worker) +
   `ridgeco-validate` (built-vs-brief), and produces: the change-set, the validator verdict, the
   acceptance criteria it checked, and any gaps. **It does not push or deploy.**
4. **Morning gate.** Brett reviews the ready change (one-tap). On approval, a **PAT-equipped /
   interactive session applies + deploys** — this is where the token lives, and the human gate and the
   auth gate are deliberately the same gate. For the SAFE class at Rung 2, this step may auto-run.
5. **Feedback to the backlog.** Every cycle updates `OPTIMIZER_ROUND_LOG` (bench, re-scored) and adjusts
   `BACKLOG` priorities. Shipped items → Completed; new problems found → new items. The loop informs the
   priorities; it does not silently reorder them past Brett.

## Why headless agents can't deploy (and why that's the point)
Scheduled/overnight sessions run in an ephemeral container with **no GitHub PAT and no `WORKER_SECRET`**
(verified Aug 7 — no platform secret store). So a headless agent literally cannot push or deploy. That
means Rung 1 is the ceiling for a purely autonomous run by construction: it prepares, it hands off, a
gated session ships. The auth limitation and the safety requirement point to the same design — do not
try to "fix" it by planting a token in a headless run; the hand-off IS the guardrail.

## Hard rules (non-negotiable)
- **No autonomous change ships without a passing `ridgeco-validate` AND `test-verified-builds` report.**
- **`Success`/verified status is written by the verifier from live state, never by the builder's own claim** (FEATURE_LOG 51).
- **Kill switch:** a `Config` flag `autonomy_enabled` (default the conservative posture). Agents check it; when off, Rung 1+ stops at propose-only.
- **No silent scope creep:** an agent that hits a GATED boundary mid-task STOPS and surfaces it — it does not route around the gate.
- **Log every autonomous action to `Ops_Telemetry`** so the Reviewer can see what the loop did.

## Sequencing (honest)
Ship order, highest-leverage first: (1) this policy [DONE]; (2) the Rung-1 Prepare overnight agent
(prepares + validates, never deploys) — the real "improve while I sleep" engine; (3) turn on Rung 2
auto-ship for ONE narrow safe class only after the validator has earned it. Do not skip to (3).
