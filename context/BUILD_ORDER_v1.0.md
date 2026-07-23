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
1. **Preview/staging lane (B-140)** — the ONE step needing careful Cloudflare config (`wrangler versions upload` → preview URL). Until it exists, no hand-edited `worker.js` goes to prod casually. *Likely needs Brett's Cloudflare dashboard for ~2 settings — the July-21 outage proves doing this wrong is dangerous; do it as its own careful step.*
2. **Smoke-test harness (B-141)** — a script that curls the live read endpoints and asserts they respond correctly → feeds the panel's **Health** tab (the machine stand-in for Brett tapping the app).
3. **ridgeco-validate wired into brett-flow (B-142)** — built-vs-brief gate (skill already delivered). Mandatory for money/customer/auth.
4. **Quality Bar / Definition-of-Done rubric (B-144)** — what "good" means per change-class; what the validator + reviewer score against.

## Phase 2 — Wire the panel to real everything
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
