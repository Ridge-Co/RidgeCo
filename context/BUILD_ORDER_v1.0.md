# BrettOS — LOCKED BUILD ORDER v1.0
**Locked:** July 23, 2026 (Brett said "lock the build order and build it")
**Governs:** the Command Center (B-151) + quality layer (B-144..150) + autonomy substrate (B-140..143, B-152) + priority engine (B-153).

## The one governing rule
**Nothing that writes data, touches money/customer/auth, or deploys a hand-edited `worker.js` goes live until the Phase-1 substrate (preview lane + validator) exists.** Read-only *display* is exempt — it cannot break anything — so it ships first. This is why the order below leads with a read-only slice and gates every write/deploy behind the rails.

Blast-radius reminder (from CAP-029): a new `.html` file = near-zero risk (GitHub Pages serves it, never touches the Worker). A `worker.js` edit = auto-deploys to the LIVE money system on push (FEATURE_LOG rule 18 — one bad push already blanked the live Hub). So the order is deliberately: HTML-only first, Worker/write later behind a preview lane.

---

## Phase 0 — Read-only Command Center v1 (NOW — safe, shipping this session)
- **What:** `command-center.html` — a real page on **live Ridge Co data**, calling EXISTING read-only endpoints (`GET /workorders`, `/invoices`, `/vendor-bills`, `/config`). No `worker.js` change. Read-only → cannot write, cannot touch money.
- **Shows:** Today view — open work ranked by who's-waiting; Health; the venture/next-step frame. Non-RidgeCo ventures shown from a manual list until their data is wired (Phase 2).
- **Buttons that would WRITE (Approve / Send-back / real Rollback) are shown but disabled** ("turns on at safe-launch") — they need Phase 1.
- **Gate:** none (read-only). Brett eyeballs the live data as the smoke test.

## Phase 1 — The substrate (gates everything with a write/deploy risk)
1. **Preview/staging lane (B-140).**
   > ⚠️ **REALITY CHECK (July 23, verified against live code):** Two facts kill the "just flip non-prod branch builds on the prod Worker" approach:
   > (a) **Worker secrets are GLOBAL** — a preview shares production's `SHEET_ID`, so it would read/WRITE the real sheet (CREDENTIALS_MAP L57, confirmed).
   > (b) **The `staging-` hostname data-isolation code does NOT exist in `worker.js`** — grepped July 23: no `staging`, `STAGING_SHEET_ID`, or hostname check anywhere. It was in the unmerged work rolled back after the July-21 outage. `STAGING_SHEET_ID` is a dead dashboard var (no code reads it). So there is currently **no** mechanism keeping a preview off live data.
   > **DECISION:** do NOT re-enable non-prod branch builds on the production Worker (that's the July-21 landmine). Instead build a **SEPARATE Worker service** (`maintenance-hub-staging`) from the `staging` branch, with its OWN `SHEET_ID` secret = a copy/test sheet. Separate service + separate sheet = true isolation, **no `worker.js` change**, production Build settings untouched (zero repeat-of-July-21 risk). Also point its QB vars at the Intuit sandbox or leave QB off so test invoices never hit the real books. `staging` branch created + pushed July 23. Setup is a Cloudflare dashboard task (Git-connection isn't API-scriptable) — drive it with the Cloudflare connector so it's not done blind.
2. **Smoke-test harness (B-141)** — a script that curls the live read endpoints and asserts they respond correctly → feeds the panel's **Health** tab (the machine stand-in for Brett tapping the app).
3. **ridgeco-validate wired into brett-flow (B-142)** — built-vs-brief gate (skill already delivered). Mandatory for money/customer/auth.
4. **Quality Bar / Definition-of-Done rubric (B-144)** — what "good" means per change-class; what the validator + reviewer score against.

## Phase 2 — Wire the panel to real everything
- **ARCHITECTURE (Brett, July 23):** the Command Center is the **BrettOS layer**, not a Ridge Co feature — it sits ABOVE the ventures. It is the realization of **B-016** (multi-venture dashboard = BrettOS homepage). Currently hosted in the Ridge-Co/RidgeCo repo + reading only `maintenance-hub` purely as a pragmatic interim (that's where live data + Pages hosting already existed). **Proper home = BrettOS**, federating each venture's own Worker: Ridge Co ← `maintenance-hub`, BarrelCo ← `barrel-co`, plus `brett-os` / `round-bar-e796`. When federated, the "Other ventures (manual)" card goes live. Interim location does NOT limit function; move/rehost is a Phase-2 task, not urgent.
- **Health tab** ← smoke-harness results (Phase 1.2).
- **Priority engine (B-153)** — who's-waiting + deadline + $ ranking, per-venture #1 next step, "Stalled & costing you." Needs a data source for non-RidgeCo ventures (BrettOS Sheet / backlog sync — B-091/B-134).
- **Multi-venture live data** — folds in B-016 (multi-venture dashboard) + B-051 (daily digest).

## Phase 3 — Make the buttons DO things (each gated)
- **Approve / Send-back execute** — needs preview lane (B-140) + validator (B-142) + golden-path tests (B-145).
- **Real one-tap Rollback** — needs the preview/versioning lane (B-140) to point prod back to a known-good version.
- **Quality reviewer (B-146), KPIs→Optimizer (B-147), canary+auto-rollback (B-148), house-style checks (B-149), gate policy + spot-checks (B-150).**

## Phase 4 — Earn autonomy per-section
- **Money-path sandbox (B-152)** — mock QB by default + Intuit QB Sandbox company + hard "sandbox mode" flag. Scope: money/customer only.
- **Autonomy ladder (B-143)** + auto-merge thresholds. **Money / QB / customer / auth stay human-gated by design — possibly forever.**

---

## Standing directive
The Command Center is a **living surface** (Brett, July 23): refined whenever new insight/opportunity surfaces, not just on data events. Owned by the Optimizer loop (B-129, PAT-032).
