# Duplicate-request warning, Phase 1 (queue #63, Nov 22 2026)

When a tenant files a request that looks like one already open on their unit (same trade and similar wording), the tenant portal shows the open request and offers "Add to this request" or "No, this is a different problem". Nothing is ever blocked or dropped. Ships OFF. Phase 1 of 3 (tenant portal, `tenant.html` only).

## Pre-build gate
Shapes: `record` `endpoint` `ui` `role` `write` `photo`. Scheduled blitz run, nobody to ask, so every item took its default. The brief's three questions were taken as: open work orders only (`wo_similar_closed_days` not built, so always open only); reuse the existing tenant-note text to Brett and do not text the vendor; panel in English and Spanish by the phone's language.

Items that are N (known gaps):
- Hub "New WO" check, WO detail "Possible duplicate of WO-x" chip with Combine and "Not a duplicate", owner portal and `owner-submit.html`: N. Phase 2 of 3.
- `submit.html` (the older standalone tenant page): N. Same panel is a copy of this one; left for Phase 2 so the two doors can be changed together.
- Machine intake (Buildium email, tenant text): N. Phase 3, rides with #109.
- B1 Edit after create: n/a, `Possible_Dup_Of` is a label written once; the "Not a duplicate" dismiss is in Phase 2.
- B9 Who hears about it: tenant note on the existing WO texts Brett through the existing add-note alert; the vendor is not told (default).
- B31 Settings, not constants: partly. Thresholds and the on/off switch are Config (`wo_similar_enabled`, `wo_similar_threshold`, `wo_similar_other_trade_threshold`); the 3-second timeout, 3 matches and the open-status list are constants. `wo_similar_closed_days` is not built.
- Calibration against real Work_Orders history (brief step 2): N. Defaults 0.45 / 0.70 were taken from the brief without running them over production data in this run. Because the feature ships OFF, Brett should look at real matches before turning it on.
- Real-device check on the S23: N. Headless browser only.
- Staging check with a TEST- tenant: N. Not run.

Companion actions included: ships OFF (blank Config = every screen and endpoint as before); fail open with the miss reported (`hubReportFailure`), request always filed; session-derived property/unit, ids from the page ignored; only `tenantCanSeeWO` work orders can come back, status shown as a tenant label, no notes, vendor, price or phone; a telemetry row per real check; double-tap guard (Submit disabled before the first await, panel buttons disabled while working); 60-second exact guard untouched and still first; `Possible_Dup_Of` via `ensureColumns` only when a value is sent; no cron; one batched Sheets read per check (+ one Config read).

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261122-wo-similar-p1]** Possible-duplicate warning, Phase 1. Regression rules:
1. **Warn only, never block.** Every path ends in a new WO or a note on an existing one, and the screen says which.
2. **Fail open.** A broken or slow (over 3 s) check files the request as before and reports the miss.
3. **Ships OFF.** `woSimilarCheck` answers `{enabled:false}` until Config `wo_similar_enabled` is TRUE; nothing is logged while off.
4. **Session identity.** Property and unit come from the signed tenant session; the page's ids are ignored. Only WOs `tenantCanSeeWO` allows can match.
5. **Bid-group copies and add-on work never match**; recurring jobs match only on the same trade.
6. **Tests:** `test/wo-similar.test.mjs`; `test/dupe-guard.test.mjs` and `test/wo-duplicate-race.test.mjs` must stay green untouched.
