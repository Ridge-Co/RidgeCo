# BrettOS — Quality Bar / Definition-of-Done Rubric (B-144)
**Status:** DEFINE — v1.0, built Aug 23, 2026
**Governs:** what `ridgeco-validate` and the future quality-reviewer (B-146) score against.
**Per BUILD_ORDER_v1.0 Phase 1, step 4** — foundational, unblocks B-127/B-211 deployment once
paired with the Phase-1 substrate (preview lane + validator).

## Why this exists

"It works" has never been the bar here — FEATURE_LOG is full of changes that returned
`success:true` and silently changed nothing (rule 6: WO writes hit the wrong column for
weeks), or shipped a correct backend with a frontend that sent the wrong field name, or a
button that looked fine on desktop and required pixel-precision on a real phone (rules 132/134).
`ridgeco-validate` already checks **promised vs. delivered** against a brief. This rubric is
the missing piece underneath that: **what "good" means independent of any one brief**, so a
brief that forgets to mention "use the auth helper" doesn't mean skipping it passes review.

Every item below is a **binary pass/fail check**, not a style opinion — each one exists because
a documented bug or rule violated it. If a criterion doesn't have a real failure behind it, it
doesn't belong in this rubric (keeps it enforceable, not aspirational).

Three change-classes. A single change can span more than one (e.g. a money-write Worker
endpoint scores against BOTH the Worker Endpoint bar and the Money Change bar).

---

## 1. Worker Endpoint bar

Applies to any new or edited route in `worker.js`.

| # | Check | Pass condition | Fails because of |
|---|---|---|---|
| 1 | **Auth-tagged** | Route is either in `PUBLIC_PATHS` deliberately (and that's obviously correct for its data sensitivity), or protected by the top-gate `WORKER_SECRET` check / a role-scoped session token (`verifySessionToken`/`makeSessionToken`). No route reachable without an explicit auth decision. | An unauthenticated route silently exposing tenant/owner/vendor/money data. |
| 2 | **Resolves by header name, never by column index** | Any Sheet read/write resolves the target column via `idColIndex(headers)` / `headers.indexOf('X')`, never a hardcoded `r[0]`, `r[3]`, etc. | Rule 6 — WO status/field writes matched the wrong column for weeks, returned `success:true`, changed nothing. `Work_Orders` col 0 is `Vendor_Needs_Access`, not `ID` — a hardcoded index is silently wrong. |
| 3 | **New/renamed columns are `ensureColumns`'d before write** | Any write to a column that might not exist yet on a live tab calls `ensureColumns(env, tab, [...])` before `updateRow`/`addRow`. | Rule 37 — `ensureTab` only writes headers to an EMPTY tab; a pre-existing tab with a drifted header silently drops the field, `updateRow` reports `{success:true,message:'No matching fields'}` — a false success. |
| 4 | **Standard error shape** | Every response — success or failure — is `json({...}, status)` from the shared `json()` helper. Failures return `{ ok: false, error: <string> }` (plus any endpoint-specific fields the caller expects, e.g. `warnings`, `billed`), never a bare throw or an inconsistent shape. | A caller that only checks `ok` and gets a different failure shape mishandles the error silently. |
| 5 | **Telemetry-logged (where the endpoint does real work)** | Endpoints that call an LLM, do a scan/sweep, or represent a job type call `logTelemetry(env, {...})` with at minimum `Job_Type`/`Skill_Or_Endpoint`/`Success`/`Latency_ms`. Trivial CRUD reads are exempt. | This is the only cost/health visibility BrettOS has (`Ops_Telemetry` → B-129 Optimizer, B-147 quality KPIs). An unlogged job type is invisible spend or invisible failure. |
| 6 | **No N+1 Sheet/QB reads** | A loop over N records does ONE batched read (`fetchTabs`, `qbFetchByIds`'s `WHERE Id IN (...)`) rather than N sequential single-record calls. | Documented perf rot: "8-9 unbatched single-tab reads... the app being slow," `qbFetchByIds` was built specifically to replace one-GET-per-bill. |
| 7 | **Idempotent, or explicitly marked as not** | A write endpoint that could plausibly be double-submitted (retry, double-tap, re-run) either (a) is naturally idempotent (re-running produces the same end state — e.g. "set status to X"), (b) checks an idempotency key / existing-record guard before creating a duplicate (the `idempotency_key` + already-fully-paid pattern at the payment path, or "reuse an existing same-numbered bill... rather than double-posting"), or (c) is commented as a manual-only, human-supervised action where duplication is caught by a human before it matters. Silent, uncommented non-idempotency on an automatable path is a fail. | The exact double-post class hit twice by hand before the idempotency guard existed. |
| 8 | **`node --check worker.js` clean** | Runs clean before commit — every existing build in FEATURE_LOG verifies this. | Syntax errors auto-deploy straight to the live money system on push (rule 18 — one bad push already blanked the live Hub). |

## 2. Hub Screen bar

Applies to any new or edited screen/section in `index.html`, `vendor.html`, `tenant.html`,
`owner.html`, or any new tool page.

| # | Check | Pass condition | Fails because of |
|---|---|---|---|
| 1 | **Status SSOT** | Any WO status displayed reads from the canonical `Status` field via the shared status-chip pattern (`STATUS_STYLE` lookup in `index.html`), not a locally-invented label or a re-derived state. | HUB_UX_DESIGN_FOUNDATION finding: status was defined ~22 different ways across the app before the SSOT existed. |
| 2 | **One button system** | Buttons follow the existing shared button classes/patterns already in the file being edited — no new one-off button style invented for a single screen. | HUB_UX_DESIGN_FOUNDATION finding: 5 competing button systems + phantom CSS before the audit. |
| 3 | **Real touch targets, per UI_QA_CHECKLIST** | File-picker buttons are a real `<button>` + sibling hidden `<input>`, never a `<label>` wrapping a hidden input. Tappable box ≥36–44px tall. Adjacent buttons ≥8px apart. Any button starting a network write disables itself synchronously as the first line of its click handler (reuse `claimSubmit(key, btn, busyLabel)`), re-enabling on both success and error paths. | UI_QA_CHECKLIST rules 132/134 — the same label-wraps-input bug shipped in 7 places before this was written down; "pressing one button accidentally presses two." |
| 4 | **EN/ES parity, where the surface is vendor- or tenant-facing** | Any new customer/vendor-facing copy has both an English and Spanish path (or explicitly routes through the existing `translateText`/Claude translation call), not English-only left as a TODO. | Vendor Spanish flagged ~95% dead in the design-foundation audit; vendor Spanish is P0 per the locked July 21 decisions. |
| 5 | **Loading / empty / error states, not just the happy path** | Every list/panel that fetches data shows a `.loading` spinner state while fetching, an explicit empty-state message (not a blank div) when the fetch succeeds with zero rows, and a clear retry-able error state — never left silently stuck on "Loading..." forever. | Hardened Aug 18 after a case where the WO list sat on "Loading..." indefinitely on a real failure; the existing pattern (`No work orders match your filters. Clear filters`) is the bar to match. |
| 6 | **No horizontal scroll at 390px** | New tables/cards render without `scrollWidth > clientWidth` at a 390px mobile viewport (verify via a headless-Chromium screenshot, per the vendor-reconcile.html rebuild precedent) — mobile-first is a hard rule, not a nice-to-have. | vendor-reconcile.html's first cut was a wide desktop table that forced horizontal scroll on mobile — "a real miss," rebuilt as stacked cards. |

## 3. Money Change bar

Applies to any change touching QuickBooks (invoices/bills/payments), receipts, or anything
that moves a dollar figure. **Always ALSO scores against the Worker Endpoint bar above** —
this is additive, not a replacement.

| # | Check | Pass condition | Fails because of |
|---|---|---|---|
| 1 | **Penny-correct** | Dollar amounts are computed and compared with explicit tolerance handling (the codebase's own convention: `billBal > 0.005`, not `> 0`, to avoid floating-point false-positives), and any markup/proration math is traceable to a single source value, not re-derived in two places that can drift. | — |
| 2 | **No double-post** | Every money-write path either has an idempotency guard (see Worker Endpoint #7) or explicitly reuses an existing same-numbered bill/invoice rather than creating a new one on retry (the `qbSendInvoice`/bill-reuse pattern). Payment paths require the second-factor + idempotency-key check already established at the live payment path. | "This is the exact class of double-post we hit twice by hand today" (worker.js comment at the invoice-write path). |
| 3 | **Reconciles to QB — amounts are never silently changed, only flagged** | A reconcile/link operation that finds a mismatch between the Hub's recorded amount and QuickBooks' live amount **surfaces the mismatch for a human to resolve** — it never auto-corrects a dollar figure on either side. | `qbMatchBillsToHub`: "amount mismatches are flagged, never changed — linking never edits a dollar figure." |
| 4 | **Correct customer/vendor resolution before any QB write** | A QB invoice/bill is never created against a fallback/guessed customer or vendor — if the owner/vendor can't be confidently resolved, the endpoint refuses the write and returns a clear error rather than posting to the wrong entity. | `json({ ok:false, error:'Owner not resolved for ... refusing to create a QuickBooks invoice on a fallback customer' })` — an existing, deliberate refusal pattern this bar formalizes. |
| 5 | **In-house / pass-through jobs correctly excluded** | Any "who's owed what" view never treats a REAL open QuickBooks bill as in-house (no payable) — a mislabelled flag can never hide genuine money owed. This is a tested safety invariant elsewhere in the codebase (`reconcile-inhouse.test.mjs`) and any new money-summary view must preserve it. | Deliberate safety invariant: "a row with a REAL open QuickBooks bill is NEVER treated as in-house." |
| 6 | **Preview-first for anything customer-facing** | A money-write that a customer/vendor will see (an invoice send, a reminder, a reconcile action) shows a preview and requires an explicit confirm tap before firing — never fires straight from a scan/sweep with no human gate. | Established pattern across every money-adjacent build in FEATURE_LOG (AR report, receipt reconciler, vendor reconcile) — "preview-first, per-row checkboxes." |
| 7 | **Test coverage for the money-math itself** | The core calculation (proration, rollup, reconciliation status classification) is factored into a pure, testable function with its own `test/*.test.mjs` file — not buried inline in the HTTP handler where it can't be unit-tested in isolation. | Established convention: `receiptSuggestCore`, `buildArReportGroups`, `qbReconcileStatus`, `qbMatchBillsToHub` are all pure functions extracted specifically so the money logic has direct test coverage. |

---

## How this is used

- **`ridgeco-validate`** adds a line to its output: which bar(s) the change is scored against,
  and a pass/fail per criterion (not just the brief's acceptance criteria). A 🔴 on any Money
  Change bar item is a hard block, same severity as a missed acceptance criterion.
- **B-146 (quality-reviewer agent)**, when built, uses these same tables as its correctness/
  security/data-integrity lenses rather than inventing new ones.
- **B-149 (house-style consistency checks)** is the automatable subset of this rubric —
  greppable checks (auth helper used, header-name resolution, standard error shape) become
  literal lint rules; the judgment-based checks (penny-correct math, correct customer
  resolution) stay a review-time read.
- **B-150 (quality-gate policy)** sets the merge threshold by blast radius: Money Change bar
  failures are never auto-mergeable regardless of score; Worker Endpoint / Hub Screen bar
  failures below a set count may be eligible for auto-merge on low-blast-radius internal
  tooling once the autonomy ladder (B-143) earns that in.

## Out of scope for v1.0 (don't guess — revisit when the need is concrete)

- Numeric scoring/weighting across criteria (right now every item is binary; B-150 may want
  a score threshold later, but no such threshold is defined yet).
- Non-Worker/non-Hub/non-money change classes (e.g. a pure documentation change, a Cowork
  skill) — those aren't scored against this rubric at all; use `brett-skillsmith`'s own
  conventions for skills.
