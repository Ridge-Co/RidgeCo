# FIELD INSPECTION (Z-Inspector-style) — Build Brief v1.0 — Oct 15 2026

Built same day for Brett's inspection of 122 S Gilmor St (Premier Property Management WO 43945-1, pre-1978). Pages: `field-inspect.html` (phone, admin) and `inspection-report.html` (public, branded, print-to-PDF). Worker block: `FI-BLOCK-START … FI-BLOCK-END` at the end of `worker.js`. Launcher: Dev Log -> "Field Inspection".

## Decisions (Brett, Oct 15)
Phone-first; SFH; periodic inspections; pick a Hub property or add new on the spot; standard areas + add bedrooms/bathrooms; Exterior Front/Side(L)/Side(R)/Rear with sides excludable (rowhomes); trade + severity + overall condition (area can be "Nothing to do"); tenant-action category; work-order conversion is a FLAG only (not default, not built); report = his branding, PDF (browser print), optional email, static link; branding defaults to his company with other companies addable (Premier) and switchable without rebuilding the inspection; Claude for AI (cheaper models later).
NOT today: templates (per type / per property), carry-forward of prior issues (resolved/worse/no change, move-in vs move-out), real WO conversion, annotated photos, cheaper-model routing.

## Data (Google Sheets, self-provisioned by `fiEnsureTabs`; NO CRON)
- `FI_Inspections`: one row per inspection. The whole inspection is ONE JSON doc split across `Data_1..Data_8` (45k chars each, ASCII-escaped so a chunk can never split a character) so every save is a single atomic row write. Header cols: Status (draft|published), Brand_ID, Report_Token (random, public link), Rev (optimistic concurrency), Doc_Hash, counts.
- `FI_Photos` (Drive file per photo, private), `FI_Brands` (logo stored as <=42k-char data URI in the row; default brand seeded "Ridge Co" #1d4ed8), `FI_Email_Log`.

## Endpoints (all admin-gated by omission from PUBLIC_PATHS unless noted)
GET `/fi/list`, `/fi/inspection?id=`; POST `/fi/save` (id, base_rev, doc, meta, force?), `/fi/publish`, `/fi/structure` (AI: dictation -> issues), `/fi/summarize` (AI trade narrative), `/fi/brand/save`, `/fi/email-report` (preview-first); POST `/fi/photo?inspection_id=&photo_id=` (raw image body, before JSON parse, like /upload-photo). PUBLIC (self-verify Report_Token): GET `/fi/report?r=`, `/fi/photo/view?r=&p=`. Unpublished report is returned only to an admin header.

## Silent-failure checklist (each is a test in `test/fi-field-inspection.test.mjs` + browser check)
1. Every write is read back from an UNCACHED Sheets read and compared (Rev, hash, full bytes). Mismatch -> 500 `verify_failed`, row rolled back, phone keeps its copy. Never `ok:true` on an unverified write.
2. Stale base_rev -> 409 `stale` (nothing overwritten); phone shows a Resolve dialog (load server / force overwrite).
3. Oversized doc -> 413 (never truncated). Invalid doc -> 400 with reasons.
4. Photos: Drive byte count compared to bytes sent; row read back; idempotent on photo_id; unsaved inspection -> 409 (phone retries after save). Publish blocked while any referenced photo is not on the server.
5. AI: failure / non-JSON / wrong shape -> 502 with a message; dictation text is kept. Customer-facing jobs pin to the Claude tier (routeAI customerFacing). AI output enters the doc only when the inspector taps Add (issues) or Approve (summary); stale or unapproved summary never reaches the report.
6. Editing a published report's content un-publishes it (customer link says "being updated"); brand/client meta changes do not.
7. Publish gates: block = pending photos, unprocessed dictation, no overall condition, no areas; warn (explicit ack) = areas not inspected, stale/unapproved summary.
8. Email: preview first, requires published, staging stub reported honestly (`staged:true`), every send logged.
9. Phone: IndexedDB offline store; sync bar always shows real state (Saved vN / Saving / Offline / Not saved: reason + Retry / N photos waiting); beforeunload guard; background sync never steals focus (safeRender); double-tap guard (claim()).
10. Staging token: `hubTestWriteAllowed` only allows TEST- inspection ids / TEST- brands (never default); photo route guarded the same way.
11. UI QA: 390px no horizontal scroll (checked on home/areas/new/review/report), 44px targets, photo = button + hidden input (no `capture=`), 16px inputs.

## Tests
`node test/fi-field-inspection.test.mjs` (108 assertions, real FI code over in-memory Sheets/Drive/AI/Gmail fake `test/_fi-world.mjs`); `node test/manual-verify-field-inspection-ui.mjs` (15 Playwright checks, 390px phone, mocked Worker = the real FI code); `test-login-coverage` covers the two new pages.

## Known limits / next
No PDF generation on the Worker — "Download PDF" opens the report with print dialog (Save as PDF). Emails carry the link, not an attachment, and send from the fixed Ridge Co Gmail sender. "Add new property" is saved with the inspection only, NOT written to the Hub Properties tab (decision needed). Next phases: templates, carry-forward comparison, WO conversion, cheaper models.

<!-- pages redeploy retry Oct 15 2026 -->
