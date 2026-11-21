# Background photo uploads: build brief written (Nov 21 2026)

## CURRENT
Docs only. Adds `context/BACKGROUND_PHOTO_UPLOADS_BUILD_BRIEF_v1.0.md`, approved by Brett Nov 21 2026: photos keep
uploading in the background on all 7 upload pages, and failed-photo warnings stay open until the photo is replaced or
marked not needed with a reason. Open warnings block that vendor's bill for the WO. Cancel/Void clears them. To be
built in a later session: Sonnet builds each phase, and a strong model reviews each phase's diff. A fresh-context
Sonnet reader tested the brief before it was approved, and its findings are folded in (draft binding for records that
don't exist yet, attach-only retries, other upload routes, extra tests 15-21). No code in this PR.

## Pre-build gate
Shapes: `photo` `write` `message` `money` (gate only) `ui` `job`. The gate is walked in the brief (§2 decisions, §8 known gaps).
- B5 Undo: Y. Un-void reopens a warning. Deleting a wrongly attached photo: N (known gap).
- B9 notify: no texts (R-1). Hub banner plus portal banner plus on-record display.
Companion actions included: Spanish vendor text; Phase 2 backfill of already-failed rows; a 6 h never-arrived watcher.

## Late requests
- Brett: warnings must stay active until replaced or actively dismissed with a reason, and must block vendor invoicing (folded into D5/D6).

## FEATURE_LOG
- FL-20261121-bg-uploads-brief: build brief for background photo uploads + persistent upload warnings + invoice gate (not built yet).
