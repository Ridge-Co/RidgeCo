# FIELD INSPECTION: ATTACH ORIGINALS FROM THE DRIVE "FULL SIZE" FOLDERS — Nov 2, 2026 — head `feat/fi-attach-drive-originals`, merged: no
## CURRENT
🟡 Worker route built and tested offline (50 tests); staging twin next. NOT merged: it adds a path to `HUB_PROD_WRITE_PATHS` (widens what a session can write on production), so Brett merges it. Follows #480 and #482.

**Why (Brett, Nov 2 17:44 ET).** The phone "attach originals" flow was slow, so he put each draft inspection's originals in a folder named "Full size" under that property's Drive folder, and asked for the attaching to be done in the background. The files are already in Drive, so the server can link them instead of the phone re-uploading each one.

**What changed (`worker.js`, FI block only).** `POST /admin/fi-originals-bridge` `{action, inspection_id}`:
- `scan`: finds the folder(s) named "Full size" (any case, stray spaces) next to the inspection's own Drive folder; lists the image files (id, size, capture time, pixels) and the inspection's photos with `has_orig`. Writes nothing.
- `fetch` `{kind:'orig'|'std', ids}`: base64 bytes (about 5 MB per call, 25 ids max) of Full-size files or of the stored ~1600 px copies, so a matcher can compare them. Anything it cannot return is NAMED (`missing`, `deferred`, `too_big`, `failed`) and fails `ok`.
- `attach` `{pairs:[{photo_id,file_id}]}` (12 max): COPIES the Drive file into the inspection folder as `<photo_id>_original.<ext>` (server-side copy, no bytes through the Worker, so deleting the Full size folder later breaks nothing), then writes the four `Orig_*` cells in one batch and reads them back. A same-named leftover copy of the same size is reused; a different size is a `name_conflict`. Never replaces an existing original (re-checked right before the write, so an original that the phone attaches mid-request wins), never deletes or moves anything.
- Only files directly inside a "Full size" folder beside the inspection folder can be read or attached. Staging: TEST- inspections only. No Worker cron, no Sheets-heavy loops (about 4 reads per call).

**Tests.** `test/fi-attach-drive-originals.test.mjs` (50): scan / fetch / attach happy path, idempotence, report `photo_full`, every refusal and failure typed, telemetry row, verify_failed, mid-request race, wiring, no swallowing catch, nothing deleted or moved. `_fi-world.mjs` gained `fiOrigBridge`, `/values:batchUpdate` and a one-column range read. FI suites all green.
**Checklist (BRANCH_POLICY).** PR into `main` from `feat/fi-attach-drive-originals`; staging twin = same branch into `staging`; `BUILD_VERSION` untouched.

## FEATURE_LOG
**[FL-20261102-fi-attach-drive-originals]** (1) The bridge is additive only: it never overwrites an `Orig_*` cell, never deletes or moves a Drive file, and always re-reads the cells it wrote. (2) It attaches a COPY inside the inspection folder, never a link to the Full size folder, so the link survives the folder being tidied. (3) `fetch` exists only so a matcher can compare pictures; keep it limited to Full-size files and the inspection's own stored copies. (4) Matching still uses the tested fingerprint rule (mutual best, within 48 bits, 16-bit gap); anything not certain is LISTED for Brett, never guessed.
**Silent-failure check:** every Drive/Sheets error is thrown (fiRoute logs telemetry and answers a typed 500) or returned per file/pair; nothing is skipped quietly; attach re-reads the cells it wrote and reports `verify_failed`; per-pair failures also write one `fi_originals_attach_error` telemetry row and fail the response.
