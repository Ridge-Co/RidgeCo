# Task Linking + One-Off→System Surfacing — Build Brief v1.0

**Status:** design captured Sep 24 2026 from a live design conversation (Claude.ai Project session, not Cowork). Nothing built yet. Closes the long-open loop between B-091 (reconcile BrettOS Sheet), the Notes system (data layer shipped, UI never built), B-230 (small-item task system w/ connection-crawling), and B-151 Command Center.

## Why (Brett's own framing, Sep 24)
Brett has three things happening that currently don't talk to each other:
1. **Daily recurring chores** (process receipts, enter his own labor) — routine, not tied to any one build.
2. **One-off asks that surface mid-session** (e.g. "contact Cesar and Juana separately about vendor-portal usage") — often the seed of a systemic fix, but currently vanish into chat history once the session ends.
3. **Infrastructure being built** (the vendor-messaging system, the status-model rework, etc.) — once shipped, it could often just *execute* a pending one-off instead of Brett doing it by hand. Nothing today closes that loop — a system ships, and the one-off it was meant to solve sits forgotten.

Concrete example already on record: CAP-036 #19 (talk to Cesar/Juana about Invoices-not-Estimates) is explicitly tied to CAP-036 #16 (status-model rework that would auto-catch this). The tie exists in CAPTURE_INBOX.md today — but nothing surfaces "#16 shipped → want me to send that message now?" when #16 actually ships.

## What already exists — do not rebuild these
- **BrettOS Tasks Sheet** (`1X2oYjDfnGzJWDI84e1t4p7cbt9iWxq5qbPmNFI9auuA`) — Brett's real, already-used task app (Tasks/Projects/WBM/Ventures/Patterns/Dev Log/Logs/Entities/Contacts tabs). **Brett's decision (Sep 24): this stays the canonical task home** — not the Hub, not a new sheet. CAPTURE_INBOX.md/BACKLOG.md keep feeding it as deep-context (closes B-091, open since July).
- **Notes system** (`context/NOTES_SYSTEM_BUILD_BRIEF_v1.0.md`) — data layer shipped Aug 11 (`Notes` tab, nullable FK columns: Property_ID/Unit_ID/WO_ID/Owner_ID/Vendor_ID/Tenant_ID). Hub UI never built. **This is the FK schema to reuse** (see below) — don't invent a second one.
- **Command Center** (`command-center.html`, B-151) — Phase-0 read-only slice live. Full mockup (Today tab, Needs-You approval queue, Did-For-You log, priority engine B-153) designed, not wired.
- **B-230** — "small-item task system with connection-crawling," Brett's own Aug 22 ask, never built. Its unanswered design questions are largely resolved by this brief (see below).

## Decisions locked (Brett, Sep 24)

### 1. Canonical home = BrettOS Sheet, surfaced everywhere
Task data stays in the BrettOS Sheet. **New requirement:** a live link/card in both Dev Log (Hub) and Command Center so the data is visible wherever Brett already looks — not a second copy, a synced view. Mechanism: a thin Worker endpoint (`GET /brettos-tasks-summary` or similar) that reads the Sheet directly (same Google Sheets API access pattern already used for RidgeCo Main) and renders a card — counts by status/venture, and a deep-link to open the real Sheet for anything beyond a glance. Command Center's card is the "what's open" summary; Dev Log's link is the quick-jump for Brett mid-session.

### 2. Linking model — structured FKs, tags as a *secondary* field, not a stage
**Direct answer, no hedging:** use structured FKs as the primary link — never "loose tags now, promote to FKs later." That promotion step is a second pass Brett will not reliably come back and do; it's exactly the kind of janitorial task that's the subject of this whole conversation. A tag ("Cesar") that should have been a real link just becomes another thing to reconcile later — the same disconnect Brett is trying to fix. The capture-time cost of picking a real link instead of typing a name is close to zero, because Brett is virtually always looking at a specific property/vendor/WO/tenant when the task originates.

**Correction (Sep 24, after reading the live BrettOS Sheet) — the FK mechanism is NOT six new Property_ID/Unit_ID/WO_ID/Owner_ID/Vendor_ID/Tenant_ID columns on Tasks, reusing the Notes schema.** That was this brief's first draft and it was wrong — it would have duplicated a registry that already exists. The live Sheet already has an **`Entities` tab** (`Entity_ID, Entity_Type, Display_Name, Aliases, Source_Hub, Source_ID, Venture, Deep_Link_Hash, Last_Synced`) that a nightly integration sync populates from `maintenance_hub` — as of Sep 24 it holds 83 rows, all `Entity_Type: property`, `ENT-18908`..`ENT-18990`, each carrying the RidgeCo numeric `Source_ID` and a `Deep_Link_Hash` like `#property/69`. This is already the FK bridge Brett needs — it's just (a) not yet exposed on Tasks and (b) not yet populated with `vendor`/`tenant`/`work_order`/`owner` entity types, only `property`.

**Revised design:** Tasks gets one new column, **`Linked_Entities`** (comma-separated `ENT-#####` ids), referencing the existing Entities tab — not six parallel FK columns. `AI_Tags` already exists on the Tasks tab and already serves the free-text-tag need; no new `Tags` column is needed.

**Shipped Sep 24:** `Linked_Entities` column added to the Tasks tab (additive, `sheet-ops` op, no existing data touched).

**Still open, not yet built:** the Entities sync currently only brings in `property` rows. Extending it to also sync `vendor`/`tenant`/`work_order`/`owner` records (same `Entity_Type`/`Source_ID`/`Deep_Link_Hash` shape, just more source queries against `maintenance_hub`) is a prerequisite before `Linked_Entities` can point at anything but a property — this lives wherever the existing nightly sync job runs (its code was not located in this pass; the Sep 24 session only confirmed its *output*, the Entities tab and Integration_Logs' "Synced N properties" rows). A future session needs to find that sync's source (likely an Apps Script or Cloud Function, not in `Ridge-Co/RidgeCo`) before extending it.

### 3. Proactive escalation — every relevant time, per-instance execution
When new infrastructure ships that could execute a pending one-off, Claude proactively offers to run it — every time it's relevant, not just once. **Execution itself is never automatic**, even after the offer is accepted once: Brett reviews and approves per instance ("I may be comfortable with the response you're providing to whomever it is... I just want to be able to give you a command to do it"). This is the existing AUTONOMY_GUARDRAILS SAFE/GATED posture applied at the task level: any comms/action touching a vendor/tenant/owner is drafted and offered, Brett gives an explicit per-instance go, nothing auto-sends on a blanket toggle. No new mechanism needed here — this is the same shape as B-137 (Send Queue: AI composes, Brett taps send) and the existing GATED-class rule for customer/vendor comms. What's new is *closing the loop*: the offer has to actually fire when the matching infra ships, which requires the connection-crawling pass below.

### 4. B-230's connection-crawling — now scoped
This is the mechanism that makes #3 possible. Design questions B-230 left open are answered here:
- **Matching method:** keyword/venture/FK-tag matching (cheap, sufficient at this corpus size) — not embeddings. Revisit only if false-negative rate becomes a real problem.
- **Auto-tag vs. suggest-only:** suggest-only. A found connection surfaces in the Command Center's "Needs You" queue as a proposed link/action, never silently applied.
- **Trigger cadence:** piggyback the existing Optimizer Scout/Reuse-Radar Mon/Thu pass (already scans for cross-venture/shared-mechanism connections) — add a new lens: "does a just-shipped feature match an open task/CAP item's description?" Also fire ad hoc, inline, whenever Claude is working a session and notices the match live (the Cesar/Juana example) — don't wait for the scheduled pass when the connection is obvious in the moment.

## What this unlocks, concretely
- A task like "talk to Cesar about Invoices vs Estimates" sits in the BrettOS Sheet tagged Vendor_ID=Cesar, Type=personal-todo, linked to CAP-036#16 (or its eventual B-number) as a dependency.
- When #16 (status-model rework) ships, the connection-crawling pass — or Claude noticing it live in a session — flags: "This closes the reason you were nudging Cesar by hand. Want me to draft the SMS/note now that the system will auto-catch reoccurrences?"
- Brett reviews the draft, taps send (or says "send it") — nothing auto-fires.
- The Sheet task gets marked done, with a note pointing at what closed it.

## Build order
1. Add `Venture` + FK columns (mirroring Notes) + `Tags` to the BrettOS Sheet's Tasks tab, if not already shaped close to this (confirm actual current columns before adding — do not assume, per PAT-024).
2. **Staged Sep 24 2026, PR pending Brett's review** (`feature/brettos-tasks-summary`): `GET /brettos-tasks-summary` Worker endpoint (read-only, reuses the runtime service-account Sheets access via a NEW `env.BRETTOS_TASKS_SHEET_ID` var — same pattern as `env.KEY_REGISTRY_SHEET_ID`, deliberately NOT `env.SHEET_ID`) + a Command Center card + a Dev Log nav link to the raw Sheet. **Not yet live-verified**: the build session had no credential to call the deployed endpoint, and — more importantly — it's unconfirmed whether the BrettOS Tasks Sheet has actually been shared as Viewer/Editor with the runtime SA (`maintenance-hub-sheets@maintenance-hub-498819...`); `CREDENTIALS_MAP.md`'s "Known Sheets" table lists only RidgeCo Main as confirmed-shared. If it hasn't been shared, the endpoint 500s with a clear Google permission error rather than failing silently — Brett needs to either confirm sharing already happened or share it (Editor, safest — matches the "when unsure, share with both" rule) before this can go live. See the PR description for the full verification status.
3. Wire the Notes Hub UI (already fully spec'd, just never built) so Property/Unit/WO detail views show linked notes/tasks together — this is what makes "everything tied to this vendor" actually visible.
4. Extend the Scout/Reuse-Radar pass with the new "shipped-feature ↔ open task" lens; wire its findings into Command Center's Needs-You queue.
5. Only then: revisit whether the inline "notice it live in-session" behavior needs anything beyond Claude just doing it (it likely doesn't — it's a behavior change, not a build).

## Explicitly deferred / not decided here
- Whether the FK/Tags schema on the BrettOS Sheet needs new tabs or fits in the existing Tasks tab — needs a read of the live sheet's current columns first.
- Whether the inspection-scheduling calendar-suggestion use case (property-manager customer, weekly inspection communicated in advance, calendar-aware but never auto-sent) is its own build or falls out of #3 once the Sheet+Command Center linkage exists. Brett's answer leaned toward "close to always-offer, but let me trigger per instance" — treat as the same mechanism as #3, not a separate one.
