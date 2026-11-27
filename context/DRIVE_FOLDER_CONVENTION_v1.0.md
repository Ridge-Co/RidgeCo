# Drive folder convention v1.0 (queue #115, Nov 26 2026)

This is the layout that already exists for job uploads, written down so nothing has to move and a future build (claim package, owner folders) can rely on it. Everything stays on Google Drive.

```
<Properties root>/                                           (env DRIVE_PROPERTIES_ROOT, a shared drive)
  <Property address exactly as on the Properties tab>/       <- id stored on Properties.Drive_Folder_ID (url on Drive_Folder_URL)
    <WO id>/                                                 <- id stored on Work_Orders.Drive_Folder_ID (customer-facing)
      Before Photos/
      After + Receipts/
      (reports and other files sit directly in the WO folder)
    _Internal — Vendor Bills/                                <- private, never shared anyone-with-link
      <WO id>/        vendor bills and invoices (Phase 2 adds shortcuts to Ridge Co purchase receipts here)
      _No WO/         (Phase 2) receipts tied to the property but no work order
```

## File name for a NEW upload
`<YYYY-MM-DD>_WO-<id>_<type>_<HHMMSS>-<4 random>.<ext>`  e.g. `2026-11-16_WO-1234_before_141502-k3f9.jpg`
- Eastern time. `type` is one of before, after, receipt, invoice, bill, report, photo, video, other. No WO id: `<date>_upload_<type>_...`.
- Built by `driveStdFileName` in `worker.js`. It never contains an address, tenant, owner or vendor name.
- The pages keep listing the ORIGINAL name (`Attachments.File_Name`); the standard name is saved beside it in `Attachments.Drive_Name`.
- Fix Check photos keep their own `FixCheck-<id>-...` name (`keep_name`), because that name is how the check finds them.
- Old files are never renamed or moved.

## Property folder rule
`drivePropertyFolder` uses the id stored on the property. First use looks for a folder named by the Properties-tab address, then for the spelling an older upload used, and only then creates one; the id is then stored. A stale or trashed id is re-found by address. If no property can be resolved (no WO, WO without a property, property with no address) the upload falls back to the old behaviour (the address text the page sent) and writes one `drive_folder_fallback` telemetry row.

## Privacy
Receipts, bills, invoices and tax documents are never shared anyone-with-link (FEATURE_LOG rule 13; `NON_SHARE_FILE_TYPES`).

## Not done yet (queue #115)
Phase 1 covers `createUploadSession` (every portal and the shared link). Still to do: the older `handlePhotoUploadClean` path (`POST /upload-photo`), Phase 2 (reconciled receipts filed into the job folder as shortcuts), Phase 3 (folder check report and gated backfill).
