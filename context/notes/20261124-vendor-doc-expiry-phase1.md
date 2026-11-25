# Queue #113 Phase 1: vendor insurance + license dates - record it, see it, warn on it - Nov 24 2026 - PR to main, head `feat/vendor-doc-expiry-p1` (cut from main tip e2654e9)

## CURRENT
**Status: built, unit-tested, screenshots checked at 412 and 1366 (mock data), waiting for Brett. Touches the admin Hub only (index.html, worker.js); no portal page. Phase 1 is partly built: see "Not built".**

What is built (brief Phase 1, steps 1, 2, 4, 5):
- `vendorDocStatus` (pure): ok / expiring (inside 30 days) / expired / missing per document; an unreadable date is a warning, never fine; blank = quiet "No insurance on file".
- Edit Vendor box: new "Insurance and license" group (insurance expiry + link, license number / expiry / link, workers' comp waiver tick + date + link). Saves through `/vendor/update`; a change to any of these is logged (old -> new) in Ops_Telemetry, Job_Type `vendor_doc_change`. New Vendors columns added by `ensureColumns` (additive).
- Assign box: yellow line above the button ("Warning: Joe's Plumbing - insurance expired Oct 3 2026. You can still assign."), grey line when nothing is on file. `/assign` also returns `doc_warnings` / `doc_notes` and writes one WO history line (Field `Vendor_Docs`). Never blocks.
- Morning digest: new "VENDOR DOCUMENTS" section: one line per active vendor with an expired / expiring / unreadable document, plus ONE count line for vendors with nothing on file (listing every vendor on day one would bury the real ones; the brief said list "missing" too: default taken, see below).

## Not built (N of M)
Phase 1 step 3 (Vendor Onboarding page columns + filter) and the warning in the New Work Order and Edit Work Order vendor dropdowns; the history line for automatic assignments (recurring work orders, duplicates): only the `/assign` route writes it. Phase 2 (vendor portal banner, `vendor_doc_expiry` scheduler job, reminders, texts, email to Brett) and Phase 3 (calendar, vendor upload, waiver form). Nothing here sends any message.

## Pre-build gate
Shapes: `record` `ui` `endpoint` `write` `role`. Nobody to ask (scheduled run): every item took its default.
Items that are N: B27 where else will he look: partly (Hub Edit Vendor, Assign and the digest only; no vendor-facing banner until Phase 2). B31 settings not constants: N (30-day window is a constant). D10 scheduler job: not applicable (no job in Phase 1). Waiver form (brief question 1): Brett has not supplied the Maryland form, so no download link.
Defaults taken: brief question 2 (a waiver does not replace liability insurance), question 3 (missing = quiet grey line, only expired / expiring / unreadable are yellow), digest lists missing as one count line. Warn, never block (Brett Oct 14).
Companion actions included: change log for edits (B15), verified save path unchanged (`updateRow`), failures of the check or the log are returned in the answer and filed (`softFail`), never hidden; a failed check never undoes the assignment or the save.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261124-vendor-doc-expiry-p1]** Vendors tab gains `License_Number, License_Expiry, License_Doc_URL, WC_Waiver_On_File, WC_Waiver_Doc_URL, WC_Waiver_Date, Doc_Reminder_SMS` (reuses `Insurance_Cert_URL` and `Insurance_Expiry`; do not add a second certificate-link column). Regression rules: (1) an expired or missing document only WARNS; nothing in `assignVendorWithDocCheck` may return 4xx or stop the assignment; (2) `assignVendor` itself is untouched on purpose (other tests run it alone); the check lives in the `/assign` route wrapper; (3) the browser's `vendorDocWarningLines` repeats the rule of `vendorDocStatus` for display only: change both together; (4) no message is sent by any of this. Tests: `test/vendor-doc-expiry.test.mjs`; `test/digest-soft-failure.test.mjs` stubs the new digest helper.
