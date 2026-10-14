# OWNER TENANT ROSTER (importer / updater) — Build Brief v1.0 — Oct 14, 2026

Ridge-Co/RidgeCo PR #290 (base `main`, head `feat/owner-tenant-roster-oct14b`, cut from main tip ff8bc5e), NOT merged (Brett merges). Staging test-only PRs #291 and #292 (base `staging`, `staging-test-only: true`) are merged and are NOT the path to main. Replaces closed PR #287 / #288 (went dirty when #286 merged). BUILD_VERSION `2026-10-14.17-owner-tenant-roster-slices`.

## Why
Brett, Oct 14 2026: Amanda Ireland (Phoenix Estates, Owner_ID 1) sent a new tenant list with no move-in dates. The bulk importer writes blank `Move_In_Date`, and a blank date switches off the only protection a new tenant has from the previous tenant's work orders (`isBackgroundWO` hides and never texts a WO created before `Move_In_Date`). Brett wants the date problem impossible to repeat, on a screen the owner can use herself.

## What was built
- **Owner portal TENANTS tab** (`owner.html` + shared `tenant-roster.js`): CSV upload and manual per-unit entry. `tenant-roster-admin.html` is the same panel with an owner picker, for Brett.
- **Worker** (owner-scoped; admin passes `owner_id`): `GET /owner/tenant-roster`, `POST /owner/tenant-roster/preview` (writes nothing), `POST /owner/tenant-roster/apply`. All in `ROLE_SCOPES.owner`. Pure planner `rosterPlan` decides everything, so preview and apply cannot disagree.
- **Rules (Brett's answers Q4–Q7):** an arriving tenant needs a move-in date; a departing tenant needs a move-out date; unchanged tenants are not touched; a new move-in must be on/after the previous tenant's move-out; the whole file is refused if any row is wrong. A future move-out keeps the tenant active until that day, then `rosterFlipDueMoveOuts` flips them inside the existing `daily_turnover` scheduler job (no cron, no new job row). No turnover work orders are created; Brett is told and approves them himself.
- **Hard-wired defaults, no owner switch:** departing tenant → Active FALSE, PIN cleared, SMS_Enabled FALSE, unit pointer cleared. Arriving tenant → linked to NO work order, so they only ever see / get texted about work created on/after the move-in day (Eastern-day compare). Nobody (tenant or owner) is texted or emailed by this tool; one admin text to Brett per batch.
- **Consent flow (Q6):** upload checkbox "tenants agreed to maintenance texts". Unticked → `SMS_Enabled` FALSE, `SMS_Consent` `pending`. Ticked → `SMS_Enabled` TRUE, `SMS_Consent` `attested`. `Welcome_Sent` stays blank either way so the person shows in Brett's "not yet welcomed" list (badges "⏳ consent pending · SMS off" / "✓ owner says agreed · no welcome yet" in `index.html`). Brett's hand-sent welcome passes `allowPendingConsent` through the SMS gate, then sets `SMS_Enabled` TRUE and `SMS_Consent` `welcome_sent`. `SMS_OptOut` (the tenant's own STOP) is never touched.
- **Name fixes** amend only the name parts that differ; they never blank a field or duplicate a record.
- **Date required everywhere (Q7, "go live for all"):** `/tenant/add` (every admin/importer page), `/tenant/update` (cannot clear a move-in), the bulk importer (rows without a date are refused and listed), owner self-onboarding (new move-in date field), admin Move In form (no default date, required).
- **Related fixes:** `smsGateDecision` refuses any tenant who has moved out (incl. queued and quiet-hours releases; `tenantForQueuedText` prefers the current row); `isBackgroundWO` and `isTenantCurrent` now compare Eastern calendar days (a 9pm-ET WO on Sep 30 no longer counts as Oct 1); `addTenantToWO` refuses a WO created before move-in (409 `wo_predates_move_in`) and no longer swallows its lookup error; `welcomeSend` write is checked.
- **Call-cap slicing (found on staging):** Cloudflare allows ~50 outbound calls per request on this plan. `apply` counts real Sheets calls (`__sheetsFetchCount`) and does only the rows that fit, answering `{partial:true, remaining:N}`; the page re-sends the same file with the batch id until nothing remains. Safe to repeat because the plan is recomputed and finished rows plan as `unchanged` / `already_done`. The heads-up text is sent only by the last slice and totals the earlier slices from `Roster_Imports`. The daily flip uses the same budget and defers leftovers to the next run (telemetry notes `deferred_to_next_run`).

## New sheet columns / tab
Tenants: `SMS_Consent`, `Roster_Source`, `Roster_Batch`, `Roster_Pending_Flip` (plus `SMS_Enabled`, `Welcome_Sent`, `Welcome_Sent_Date`, `Onboarding_Source`, ensured on first use). New audit tab `Roster_Imports`.

## Tests
`test/tenant-roster.test.mjs` (66 assertions on the real functions). Full suite passes (`for f in test/*.test.mjs; do node $f; done`). Staging (build .17, TEST- owner 11, properties 69 and 88) verified: preview; refusal without dates; refusal of a new move-in earlier than the old tenant's move-out; move-out; arrival (SMS off, pending); name-fix (amend only); resume after partial (`already_done`); 6-arrival apply in one call (22 sub-requests); a 20-arrival batch that saved 11, answered `partial:true, remaining:9` (29 sub-requests), and a re-send of the same file with the returned batch id that saved the other 9 and marked the first 11 `unchanged` (no duplicates); a future move-out (tenant stays current, date booked). NOT exercised live (unit tests only): the daily flip of a due future move-out (cannot advance the clock), the `/tenant/add` and `/tenant/update` no-date refusal (the staging test token refuses non-TEST writes before they reach the guard), the moved-out SMS gate, and the `attested` flag on consent:true batches (no targeted single-tenant read endpoint exists; do not dump `/tenants`). Check these on prod after the cutover with a read of the new rows.

## Amanda's cutover (run AFTER Brett merges #290)
Run via `tenant-roster-admin.html` (owner = Phoenix Estates, #1). Not the bulk importer.
1. Add the 4 missing properties first (739 N Central Ave, 2005 E Lafayette, 3015 Frisby St., 3805 Harlem Ave): Phoenix / Owner 1, Baltimore, single-family, no units, no QuickBooks customers.
2. Move out IDs 59, 48, 49, 40 with move-out 2026-09-30; deactivate blank placeholder ID 56.
3. Name fix only for Cheryl Wagstaff (116), Dion Thomas (72), Alicia Suggs-Kane (73): same phones.
4. Add the 12 new tenants with move-in 2026-10-01; consent box unticked unless Brett says otherwise.
5. HOLD Jenelle Floyd (3805 Harlem Ave, 443-990-6662) until Amanda confirms she is the same person as Jonelle Floyd (ID 92, 1217 W Mulberry St, P48). If the same, move ID 92 out instead of duplicating.
6. Leave the other 31 Phoenix properties untouched.
The prod write token is additive-only and cannot move tenants out, so Brett (or Claude in Chrome with Brett's login) runs the admin page. No credential is ever pasted.

## Regression rules
- A tenant row must never be created without a real `Move_In_Date` (one rule, `tenantDatesError`, used by every path).
- Never add a Cloudflare cron or GH Actions schedule for the flip; it rides `daily_turnover`.
- Any new loop of Sheets writes must respect the ~50-calls-per-request cap (`__sheetsFetchCount` + `ROSTER_*` budget) and report deferred rows loudly.
- The moved-out check in `smsGateDecision` is the last line of defence; do not remove it when changing the toggles.
