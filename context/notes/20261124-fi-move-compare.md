# QUEUE #117 PHASE 1: move-in vs move-out comparison in Field Inspection — Nov 24 2026 — head `feat/queue-117-move-compare`, base `main`, cut from main tip 02f94e7

## CURRENT
**Status: Phase 1 of 3 built, tested locally, waiting for Brett. Phase 1 is read-only (it writes nothing), but the row is classed GATED, so no session merges it.**

- PR -> `main` opened by the nightly build runner (the number is on queue row #117). Head `feat/queue-117-move-compare`, cut from main tip 02f94e7. BUILD_VERSION untouched.
- Not merged to main. No staging test-only PR was opened by the nightly run; see the PR body for what was and was not verified.

**What exists already (verified in code Nov 24):** the Field Inspection app already has Move-in and Move-out types, photos, issues with a "flag for work order" mark, and the report. The review screen still says "conversion comes in a later update". That conversion is Phase 2 (not built here).

**Built (Phase 1 of 3; remaining: Phase 2 flagged issues -> work orders, Phase 3 "new since move-in" labels and turn list):**
- worker.js: `GET /fi/compare?move_in=<id>&move_out=<id>` (admin, read-only). Checks the first is a Move-in and the second a Move-out of the same property (and the same unit when both name one), pairs areas by normalized name, returns each side's photos (with the date each was taken), condition and issues, plus both inspections' own report tokens so the page can show their photos. Areas on one side only come back as "only in move-in / only in move-out". Pure helpers `fiAreaKey`, `fiCompareSide`, `fiCompareDocs`. One FI_Photos read for all photo dates; no per-photo reads.
- field-inspect.html: on a Move-out inspection, a "Compare with move-in" card. It lists earlier Move-in inspections for the same address (suggested = the latest one on or before the move-out date). New screen: area picker, move-in photos and move-out photos side by side (stacked on a phone, two columns from 700 px), tap a photo for the big view, issues under each side.
- Tests: `test/fi-compare.test.mjs`.

**Defaults taken (no one to ask):** (1) Only Move-in vs Move-out pairs are allowed (the server refuses anything else). (2) Photos load the same way the report does (the inspection's report token), so no new photo-access path was added. (3) Compare needs the inspection saved to the server first; offline it says so. (4) The "tenant-caused?" toggle and the work order conversion are NOT in this phase.

## Pre-build gate
Shapes: `list` `ui` `endpoint` `photo` `role`. Nobody was available to ask (scheduled run), so every item took its default or the safer option.

Items that are N (known gaps):
- B1 Edit after create: n/a, nothing is created.
- B4 Reorder by hand: N. The order is the move-out's walk-through order, then move-in-only areas.
- B9 / B11 / B12 / B13 Messages: n/a, nothing is sent to anyone.
- B15 History: n/a, read-only.
- B16 Bulk: n/a.
- B20 Voice dictation: n/a, no typing on this screen.
- B21 Photos add / original / permanence: N for originals. The compare shows the standard (fast) copy; the existing report link carries the full-size original. No photo is added, moved or removed.
- B22 Photos missing or doubled: partly. An area with no photos says "No photos in this area"; a photo that fails to load says "Photo could not be loaded". No duplicate check across the two inspections.
- B23 Photos in print and PDF: N. The compare is a screen, not a printed report.
- B24 Who may see which file: Y by reuse. Admin only; photos go through the existing token-checked `/fi/photo/view` (Drive stays private).
- B26 Spanish: N. Admin only, English only (brief).
- B27 Where else will he look: N. Only on the Move-out inspection screen.
- B28 Long lists: partly. The area picker is a dropdown; the candidate list is the move-ins for that address only.
- B31 Settings, not constants: n/a.

Overridden from the brief: none.

Companion actions included: loading, empty ("No move-in inspection on file for this address"; "Not inspected at move-in/out"; "No photos in this area") and retry-able error states; phone first (412 px stacked, 44 px targets, 16 px picker); C1 no texts; C2 no cron; C3 silent-failure line in the PR (a route error is logged by the existing `fiRoute` wrapper, the page shows the error with Retry, a missing photo is marked on screen); C4 n/a (no writes); C5 fails closed (a wrong pair is refused with a plain reason); C6 owners see nothing (admin only, no money); C7 private data stays private (admin only; photos only via the token route); C8 branch first, PR into main, Brett merges; C9 GATED row, never auto-merged; C10 reuses the report-token photo route and `fiFindInspection`; C11 blank = old behaviour (the card only shows on Move-out inspections); C12 no backfill; C17 n/a (no new columns); D1 two tab reads plus one photo read per compare; D4 no new large data held.

## Late requests
