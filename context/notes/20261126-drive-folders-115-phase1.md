# Drive folders, standard names and a stable property folder (queue #115, Phase 1 of 3) — Nov 26 2026 — PR #652 into main, head `feat/drive-folders-std-names-115` (cut from main tip e2654e9), merged: no
## CURRENT
Built by the nightly build runner. Phase 1 only (1 of 3 phases): new uploads through `createUploadSession` get a standard Drive file name and go to ONE stored folder per property; the written convention is `context/DRIVE_FOLDER_CONVENTION_v1.0.md`; the property detail has an "Open Drive folder" button. Phase 2 (receipts filed to the job folder as shortcuts) and Phase 3 (check report + gated backfill) are NOT built. `handlePhotoUploadClean` (`POST /upload-photo`, the older path) is also not changed yet.
Not verified: a real upload to Drive on staging (this runner has no Drive access and cannot drive the portals). The upload path is used by five pages, so the PR stays open for Brett. Test-only staging twin PR: none opened.

## Pre-build gate
Shapes: `write` `external` (Drive) `endpoint` `ui`. Nobody was available to ask; every question in the brief took its recommended default.

Items that are N (known gaps):
- B15 History: partly. Fallbacks, stale ids and unsaved ids each write an Ops_Telemetry row; no separate history.
- B21 Photos: original name kept on the row; old files never renamed (Q3 default). Permanence unchanged.
- B24 Who may see which file: unchanged; receipts, bills, invoices and tax docs never shared (rule 13).
- B27 Where else will he look: N. The Drive folder link is on the property detail only.
- B31 Settings, not constants: N. The name format is a constant.
- D1/D3 Sheets and Drive call budget: one cached Work_Orders + Properties read per upload (the brief asks for the cached read); one Drive files.get replaces one name search; a later file of a batch that carries the WO folder id skips the property folder altogether.
- D9 Staging cannot prove shared-drive behaviour: first live upload is the test.
- C16 Live-data repair: none in this phase (no backfill, no renames, no moves).

Defaults taken: Q1 (receipts as shortcuts) and Q2 (vendor receipts stay where they go today) are Phase 2 questions, not touched. Q3: old files keep their names.

Companion actions included: fail-open fallback to today's behaviour (C5), telemetry on every fallback (C3), verified write of the stored id (C4), additive columns by name via `ensureColumns` (C17), no cron, no money, no texting, no AI.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261126-drive-folders-115-p1]** Standard Drive names and one stored folder per property (queue #115 Phase 1). Regression rules:
1. New uploads through `createUploadSession` are named by `driveStdFileName`; `file_name` in the response and `Attachments.File_Name` stay the ORIGINAL name; `Attachments.Drive_Name` holds the Drive name. Fix Check passes `keep_name` and keeps its own name.
2. The property folder is `drivePropertyFolder`: stored `Properties.Drive_Folder_ID` first (verified), else the Properties-tab address, else the spelling an older upload used, else create. It must never fail an upload: unresolvable property = old behaviour + one `drive_folder_fallback` row; a failed id save is logged and ignored.
3. `body.folder_id` is still honoured; bills and invoices still go to `_Internal — Vendor Bills/<WO id>` and are never shared.
4. Old files are not renamed or moved. Phase 2 and 3 are separate PRs.
