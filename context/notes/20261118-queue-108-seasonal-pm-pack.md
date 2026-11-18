# Queue #108 Phase 1: seasonal PM starter pack on the recurring-WO engine - Nov 18 2026 - PR (see below), head `feat/queue-108-seasonal-pm-pack`

## CURRENT
**Status: built, unit-tested, UI checked at 412 / 1366; staging dry run and Brett's merge pending. GATED (writes new rows to the live `WO_Templates` tab; once Brett switches a template on, the engine posts real WOs and texts the default vendor), so no session merges it.** Cut from main tip a9d31b3.

**Phase 1 of 2.** One new admin route, `POST /wo-template/seed-seasonal {dry_run}` (dry run is the default; only an explicit `false` writes). It adds five yearly templates ("PM - Winterization", "PM - HVAC pre-season service", "PM - Dryer vent cleaning", "PM - Water heater flush", "PM - Smoke / CO detector batteries"), every one OFF, no property, no vendor, no tenant notice, no max price, global. Skips any name that already has an Active template (case and spacing ignored). A real run re-reads the tab and confirms every new row landed OFF with no targets; failures come back by name and are logged (`seasonal_pack_seed`). Hub: Templates tab gets "Add seasonal starter pack" (preview first, then "Add these templates"), the empty state mentions it, the template list now shows a Load-failed message with Retry instead of the empty message, row buttons are 44px, and an OFF template with a schedule and no property shows "Starter - not switched on yet".

**Not built (Phase 2 of 2):** `recurLinkTemplateBulk` and the "link all of an owner's properties" picker (one write of the `Targets` cell). Also not built: Spanish copy of the five descriptions (the brief says verify first whether the vendor portal shows template text untranslated; not checkable from this run), the optional sixth spring template (Q3 default: no).

**Tests:** `test/seasonal-pm-pack.test.mjs` (69 checks): real worker.js functions with a fake sheet; dates for all five (HVAC Apr 1 / Oct 1 alternating, leap-year 2028); lead days; no late posting; dry run writes nothing; real run adds only missing names; second run adds none; hand-made duplicate untouched; one failed write named and logged while the other four land; a write that claims success but is missing is caught by the re-read; a row that lands with recurrence ON is reported; unreadable tab is a 500 that says nothing was added; route admin-only (not public, not on the prod write list, not in ROLE_SCOPES); staging token dry-run only; static checks on the screen. `node scripts/ui-check.mjs index.html`: PASS (no counts worse than baseline); my own shots of both new views at 412 and 1366: no sideways scroll, every new button 44px.

**NOT verified:** the real seed on a live sheet (staging token is refused on the real run by design, so only the dry run can be run there); production `GET /wo-templates` (the brief asks the build to list existing names first; the runner's read-only prod token could not do this, so the dry run on first tap lists exactly what is already there and skips it); the Post Now / vendor text path after Brett switches one on (existing, unchanged engine); Spanish text in the vendor portal.

**Needs a human (after merge):** (a) Hub -> Templates -> "Add seasonal starter pack" -> Add. (b) Open "PM - Winterization", link properties, pick the vendor (or none), set a max price if wanted, tick the recurrence box, Save. (c) Nov 1 2026 has passed, so tap **Post Now** on Winterization to create this season's jobs today. (d) Same for the other four whenever ready; they do nothing until switched on.

## Pre-build gate
Shapes: `endpoint` `list` `ui` `write` `job`(none new). Nobody was available to ask (scheduled run), so every item took its default or the safer option.

Items that are N or partial (known gaps):
- B4/B16 Bulk-link many properties: N (Phase 2 of 2).
- B31 Settings, not constants: N. The pack (names, dates, wording, 14 lead days) is a constant in worker.js; every field is editable per template afterwards in the existing template screen.
- D9 Staging can't prove external systems: partly. The real seed can only be run by the admin secret, never by the staging token, so only the dry run is proven on staging.
- B27 Where else will he look: the seeded rows appear in the existing New-WO "From Template" picker (global templates). Expected; the "PM - " prefix keeps them apart from the built-in "Dryer Vent Cleaning".
- Spanish: N for the five descriptions (see above).

Defaults taken: Q1 five templates and dates as listed; Q2 winterization seeded for next year and Post Now this year; Q3 no sixth spring template. Existing rows untouched, no backfill (C12). No new sheet column (C17: all columns already in `RECUR_TEMPLATE_COLS`, ensured by `recurEnsureCols` on a real run only, never on a dry run). Reads: 1 read per dry run; real run = 1 read + `addRow`'s own read per row + 1 confirm read (D1).

Companion actions included: undo (the existing Del button sets `Active=FALSE`; nothing hard-deleted); double-tap guard on the add button; empty, loading, error with Retry and all-already-there states; no silent partial (failures named on screen and logged); C2 no cron and no new scheduler job (reuses `recurring_wos`); C3 failures returned and logged, writes re-read; C4 re-read after write; C6 owners never told and never see cost (owner notifications stay off, templates carry no price); C7 descriptions carry no codes, prices or names; C9 GATED; C11 everything starts OFF; C15 zero texts and zero AI calls at seed; C8 branch, test-only staging twin, `BUILD_VERSION` untouched.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261118-queue-108-seasonal-pack]** Seasonal PM starter pack (queue #108 Phase 1). Regression rules:
1. **Seeded templates are always OFF with no property, vendor, tenant notice or max price** (`recurPackRow`); the real run re-reads and fails any row that came back otherwise. Never prefill a vendor or switch one on from code.
2. **`dry_run` defaults to true**; only the boolean `false` writes. The staging test token may only call it with `dry_run:true`. The route is never in `PUBLIC_PATHS`, `HUB_PROD_WRITE_PATHS` or `ROLE_SCOPES`.
3. **First due dates stay in the future** (the engine drops occurrences older than `RECUR_LOOKBACK_DAYS`). A pack entry with a past `Start_Date` would silently mean "next cycle"; the test fails it.
4. Editing a template's Start_Date to a different month moves its season (the interval is counted from that month).
Tests: `test/seasonal-pm-pack.test.mjs`.
