# Trash service: add photos from the invoice preview, Save waits for uploads (Nov 21 2026)

## CURRENT
Brett tapped Save on a trash visit before the photos finished uploading. The visit saved with
no photos, and the invoice preview then offered only Close (which changed nothing) or Send
(which sends without photos). Nothing was in QuickBooks yet: preview writes nothing, so there
was no bad invoice to delete. The real gap was that a logged visit could not be fixed.

Shipped in this PR (`trash.html`, plus one read-only field in `worker.js`):
- **Save waits for uploads.** The Save button shows "Uploading N photos..." and stays locked
  until every photo finishes or fails. `saveVisit()` also refuses while uploads are running.
- **Invoice preview: "Photos by visit".** Each visit is listed with its photo count (or "no photos")
  and a "📷 Add photos" button, plus "Nothing has been sent yet. Back keeps everything as is."
- **Add photos** opens the visit sheet with the date locked to that visit and the extra-charge
  picker hidden. It uses the existing `/trash/log-visit` merge (same property + same date adds the
  photos to that visit), so it can never create a second billable visit or change the total.
  Save or Cancel goes straight back to the same preview, which shows the new photo count.
- The invoice sheet's **Close** button now says **Back**.
- Worker: `/trash/invoice` preview now returns `id` and `photos` (count) per visit. Read-only, and the send path is unchanged.

Tests: `test/trash-add-photos.test.mjs` (33 checks; runs the real page script on a fake DOM;
fails on the old page). Full suite green locally. `scripts/ui-check.mjs trash.html` PASS.

## Pre-build gate
Shapes: `ui` `photo` `write` (`money` adjacent: invoice preview only; the QuickBooks send path is untouched).
- B1 Edit after create: Y for photos on a logged visit. Editing a visit's date or extra charge after logging: N (known gap, not asked for).
- B5 Undo: N. Removing a wrongly added photo from a visit is not built (known gap).
- Photo handling: Y. Uploads must finish before saving; a failed upload shows ⚠ on its chip and does not block saving the rest.
- B9 notify: n/a, nothing is texted or emailed.
Companion actions included: Cancel returns to the preview; the batch "Send all" preview still warns and sends as before.

## Late requests
(none yet)

## FEATURE_LOG
- FL-20261121-trash-addphotos: trash invoice preview lists per-visit photo counts with Add photos (merges into the same visit, date locked, no extras); Save visit is locked while photos upload; invoice sheet Close renamed Back.
