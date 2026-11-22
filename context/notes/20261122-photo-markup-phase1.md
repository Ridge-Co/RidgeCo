# Photo markup, Phase 1 (queue #163, Nov 22 2026)

Tenants can circle, arrow, draw or label a photo before sending a new request. The untouched original always uploads first; the marked copy follows as a second photo paired to it. Phase 1 of 3 (tenant request flow only).

## Pre-build gate
Shapes: `photo` `ui` `endpoint` `write` `role`. Scheduled run, nobody to ask, so every item took its default; the brief's three questions were taken as: build in-house (yes), Phase 1 tenants first (yes), owners no.

Items that are N (known gaps):
- B1 Edit after create: N. A marked copy cannot be re-edited after the request is sent (Phase 2 adds Mark up on photos already on a work order).
- B3 Move between sections / parents: n/a for a photo; the marked copy is its own attachment on the same WO.
- B5 Undo / restore: partly. Undo / Clear inside the tool, "Use original" before sending. After sending there is no delete of the marked copy beyond the existing photo delete.
- B9 Who hears about it: n/a, no message is sent by this feature.
- Photos already on a work order (vendor portal + Hub lightbox, `GET /attachment/bytes`): N. That is Phase 2 of 3 and needs the access-control endpoint; not started.
- Pencil badge next to a pair in photo lists: N. The marked copy is named `marked-<original name>.jpg` so the pair reads clearly in any list; the Attachments row carries `Marked_From` (the original's Drive file id, not an Attachments ID, because `/upload-photo` returns the Drive id).
- Spanish: the tool carries EN and ES strings and takes `lang`; the tenant portal has no Spanish layer, so it passes `en`.
- Phase 3 (marked copy first in the vendor job link): N.
- Real-device check (Android + iPhone finger drawing): N. Only a headless browser could be used in this run.

Defaults taken: one colour toggle (red / yellow); JPEG at the photo's own size, long side capped 2560 px, quality 0.9; 6 photos per request as before.

Companion actions included: original-first upload and unchanged original bytes; a failed marked copy never fails the request and is shown to the tenant; two former swallowing catches in `handlePhotoUploadClean` now log to Ops_Telemetry and return `warnings`; `Marked_From` added with `ensureColumns` (never `ensureTab`); no cron; no third-party script or network call; 44px targets; double-tap guard on Done; drawing kept if saving fails.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261122-photo-markup-p1]** Photo markup Phase 1. Regression rules:
1. **The original is never altered.** `srFiles` keeps the chosen File; the marked JPEG lives in `srMarks`. Markup always opens from the original.
2. **Original uploads first**, then the marked copy with `marked_from` = the original's Drive file id. A marked-copy failure is reported and does not fail the request.
3. **`photo-markup.js` has no external URL, no network call and no eval** (`test/photo-markup.test.mjs`).
4. **`/upload-photo` accepts only a plain id shape for `marked_from`**; anything else is ignored with a warning.
