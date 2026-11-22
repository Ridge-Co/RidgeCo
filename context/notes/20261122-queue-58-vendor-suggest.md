# Queue #58 vendor suggestions in the Assign Vendor and New Work Order boxes (Phase 1 of 2) — Nov 22 2026 — head `feat/queue-58-vendor-suggest` (cut from main tip 02f94e7)

## CURRENT
PR number and base are in the PR itself (PR -> `main`). GATED (the boxes it changes send a real text on one tap): the runner does not merge it. BUILD_VERSION and CURRENT.md untouched.

Built (Phase 1): `GET /vendor-suggest?wo_id=` or `?trade=` (admin only, read only), `vendorPerfRows()` lifted out of `vendorPerformance` so the scorecard and the suggestion share one calculation (test proves the scorecard numbers are unchanged), `rankVendorsForJob()` (pure). Assign Vendor box: up to 3 suggested vendors first under "Suggested for <trade>", a "Best match" line with a plain reason, then "All vendors" as before. New Work Order box: same group when the trade changes. Nothing is pre-selected; opening either box writes and texts nothing. OFF unless Config `vendor_suggest_enabled` is TRUE. `submitAssign` now disables its button first and restores it on every path.
Not built (Phase 2 of 2, a separate PR after a week of use): photo compliance, on-time, nearby bonus, two scorecard columns. Also not built: suggestion on the Edit Work Order dropdown, any automatic assign or text.
Needs Brett after merge: set Config `vendor_suggest_enabled` to TRUE when ready (blank = OFF). Optional: `vendor_suggest_min_jobs` (default 3), `vendor_suggest_weights` (JSON, default completion 40, speed 30, price 15, workload 15).

## Pre-build gate
Shapes: `list` `ui` `endpoint` `role` (reads). No write, money, message, job or photo.
Items that are N or n/a:
- B1 Edit after create, B3, B5, B15, B17: n/a. Nothing is created or changed by this feature.
- B9 Who hears about it: nobody. Vendors and tenants never see scores or reasons.
- B16 Bulk: n/a.
- B26 Spanish: n/a, admin screen only (Brief: English).
- B31 Settings, not constants: Y for switch, minimum jobs and weights (Config). The workload cap (10 open jobs = zero credit) and the 3-suggestion cap are constants.
- B32 Empty / loading / error: Y. Loading line, "no trade" and "no vendor for trade" lines, and "Suggestions unavailable - showing all vendors." with a Retry button on the Assign box; one line on the New Work Order box (pick the trade again to retry).
- B33 Phone first: Y. No new layout; Retry button 44px tall. Checked at 412 and 1366.
- Brief Q1 (pre-select top vendor?): default taken = highlight only (a star on the first suggestion and a reason line), Brett taps once.
- Brief Q2 (price weight): default taken = 15 of 100, among vendors of the same trade, in Config.
- Phase 2 signals (photos, on time, nearby): N, next PR.
Defaults taken: C1 no texts: n/a. C2 no cron: none. C3 nothing fails silently: a failed suggestion is logged to Ops_Telemetry (Success FALSE, so it reaches Needs Attention) and shown on screen; a missing work order is a failure, not "no suggestion". C5 fail-open on purpose: assigning is never blocked by this feature. C6/C7 owners never see this; no private data. C9 GATED. C10 reuse: one shared scorecard calculation. C11 starts OFF, blank = OFF. C12 no data touched. C15 cost: one Config read plus one batched four-tab read per box opening; none when OFF beyond the Config read; no texts, no AI. C17 no columns.
Companion actions included: double-tap guard on Assign; stale-answer guard (a late reply for a box that was closed or re-opened is ignored); 4-second limit; warnings from a broken weights setting are shown in the box.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261122-58-vendor-suggest]** Rules: 1. `vendorPerformance` and `/vendor-suggest` share `vendorPerfRows`; never fork the math. 2. `/vendor-suggest` stays admin-only (not in PUBLIC_PATHS or any role list), read-only, and never selects, assigns or texts. 3. Suggestions fail open: any error leaves the vendor list working and logs a failure row. 4. `submitAssign` disables its button on its first line. 5. Phase 2 adds signals only through `vendorPerfRows` and the scorecard page together.
