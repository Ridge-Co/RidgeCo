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

## Round 2 (Oct 15 2026, after Brett's first field use) — BUILD_VERSION `2026-10-15.02-field-inspection-update`
Brett inspected 122 S Gilmor before the app existed to him: photos in wrong areas, notes as separate disjointed voice recordings. Added:
- **Areas in walk-through order** (flat list, ▲▼ reorder mode, "Auto-order" = outside -> ground floor -> basement/systems -> upstairs -> attic -> detectors; `walkKey` in field-inspect.html). Report follows doc order.
- **Photo Select mode** per area: bulk **Move to another area** or **Remove**; viewer has prev/next + Move/Remove. Removal detaches from issues/equipment and purges orphaned blobs from phone IndexedDB (Drive copy stays).
- **Equipment & model info** per area (`area.equipment[]`: furnace incl. filter_size, boiler, A/C, heat pump, water heater, appliances; server `FI_EQUIP_KINDS` is the source of truth, a unit test asserts the phone list matches). **Read label from photo** = `POST /fi/read-label` (Claude vision on an already-uploaded photo; fills blank fields only, shows differences). Report has an "Equipment & model information" section.
- **Brand capture**: manual Website/Phone/Email/Address (new FI_Brands columns) or `POST /fi/brand/scrape` (cursory: name, tagline, theme/CSS colors, logo candidates, phone/email/address; SSRF-guarded: https/http only, public hostnames, manual redirects re-validated, size/time caps). Nothing saved until the inspector applies + saves. Brand save keeps any field the caller omits.
- **Voice notes**: phone uploads audio -> raw-body `POST /fi/transcribe` (Gemini audio, <=14 MB; m4a retried as aac) -> `doc.voice_notes[]` (transcripts, never in the public report) -> `POST /fi/route` (Claude: issues/equipment/conditions per area, `unassigned` + `new_areas`, nothing dropped) -> review screen (change area, edit, Add selected). Unplaced items must be placed/dismissed first. `POST /fi/transcribe/json` (admin/test: drive_file_id or small base64).
- **Issue types database**: tab `FI_Issue_Types` (seeded once with 64 common rental issue types; grows: types typed in the editor or accepted from AI are added as `learned`; `Uses` counts). Endpoints GET `/fi/issue-types`, POST `/fi/issue-types/save`, `/fi/issue-types/touch`. Issue editor has a type picker (area-relevant types first) that fills trade/severity/likely cause/fix; issues store `issue_type`.
- Staging token limits (hubTestWriteAllowed): scrape/route/transcribe-json allowed (no writes); read-label + raw transcribe only for TEST- inspections; issue-type writes only TEST- names.
- Tests: `test/fi-round2.test.mjs` (141) + 8 new Playwright checks (23 total).
- Known limit: no in-app recording yet (Gemini audio does not list webm); recordings come from the phone's recorder via the file picker. Transcription of Brett's 12 recordings (Drive folder 1hVg7nkggLvVstQEx3ieInFBkUr90pjpg, ~14 MB m4a) must run through the app/server, not the Claude sandbox (files private, no Gemini key in sandbox).

<!-- pages redeploy retry Oct 15 2026 -->

### Round 2 staging verification (Oct 15, 2026)
- Verified on staging: `/fi/issue-types` seeds 64 types; `/fi/issue-types/save` and `/touch` (touch body is `{items:[{name}]}`, names must start TEST-); `/fi/brand/scrape` on a real site; `/fi/route` places kitchen/bath/hallway items in the right areas; `/fi/transcribe/json` accepts `audio/mp4` (m4a) directly.
- The worker's Google account CANNOT open Brett's private Drive folder (`drive_no_access`). Recordings must be uploaded through the app (Voice notes > Add recordings).
- Found and fixed: Gemini invented a full plausible inspection transcript from a pure 440 Hz tone. The transcription prompt now says NEVER make up content and to output `[no speech]` for tones/noise; staging now returns 422 `no_speech` for the same clip. Transcripts are still shown to the human before routing; never auto-accept.
- Found and fixed: brand scrape left `&#x27;` undecoded in the tagline and used the `\` title separator wrongly ("Home \ Anthropic").
- Still unverified live: label reading on a real photo (`/fi/read-label`), real speech transcription quality.

## Round 3 (Oct 15 2026) — BUILD_VERSION `2026-10-15.03-field-inspection-owners`
Brett's asks: Hub-style property picker with type-to-search over properties AND units, "Add a new property" near the top and bottom, owner on every inspection ("on behalf of", company name not person), new properties write to the Hub Properties tab together with an owner (the property manager can be the owner), and inspection photos filed the way he files work orders: one folder per property, then one per inspection.
- **Directory**: `GET /fi/directory` -> slim PIN-free `{properties, units, owners}` (active only; a property whose owner is missing/deactivated comes back with `owner_id:''` so the phone asks for one). Owner name = `Company`, else "First Last" (`fiOwnerName`). Phone caches it in localStorage `fi_dir`; search is tokenised (every typed word must match address/city/owner, or a unit label), `street`->`st` etc. Multi-unit property -> asks "Which unit?".
- **Add property + owner**: `POST /fi/property/create {address, city, type, unit_labels, owner:{id}|{company,first,last,phone,email}, force}`. Creates the owner via `addOwnerWithQBSync` (`Onboarding_Source:'field_inspection'`), the property via `addRow` (`Owner_ID` set, `Onboarding_Source:'field_inspection'`, SMS off), units via `unitAddWithDupeCheck`; reads everything back. Errors are explicit: `duplicate_property` (409, matches), `owner_exists` (409, normalised-name match: use it instead of making a duplicate), `owner_not_saved`, `property_not_saved` (says whether the owner WAS saved; the phone pre-selects it so a retry cannot create a second one), `unit_not_saved`. State/zip are label-only (the Hub keeps street + city).
- **Owner on the inspection**: `doc.owner {id,name,source:hub|typed}` + sheet columns `Owner_ID`, `Owner_Name` (appended after Data_8; always join Data_1..8 by name, never "everything after Data_1"). Publishing is BLOCKED without an owner (`owner_missing`); the public report shows "On behalf of <owner>" and strips owner/property/unit ids.
- **Phone**: Property & owner card on the inspection (change owner, "Add to the Hub" for old not-in-Hub properties like 122 S Gilmor, Drive folder link, "Organize photos in Drive"). The default brand stays Ridge Co; a brand with no logo shows a nudge to add it (no Ridge Co logo file exists in the repo/Drive reachable by the worker; Brett uploads it once under Brands).
- **Drive folders**: `Properties root / <street> / Inspection MMDDYYYY` (`Inspection MMDDYYYY (2)` for a second one the same day), found-or-created (oldest match wins), remembered on the row (`Drive_Folder_ID`, `Drive_Folder_URL`, written with single-cell PUTs so Rev/Data are never touched), verified by read-back. A deleted folder is re-created once. `POST /fi/folder/organize {inspection_id, limit}` moves round-2 photos (which went to `Field Inspections/<address> — <id>`) into it, 20 per slice (one listing call tells which are already there, so every run progresses), each move read back.
- Staging token: `/fi/folder/organize` only for TEST- inspections; `/fi/property/create` only for a `TEST-` address owned by a TEST- owner (existing TEST- owner id, or a new owner whose company starts TEST-).
- Tests: `test/fi-round3.test.mjs` (67), existing suites updated (fixtures need an owner to publish), Playwright 31 total at 390px.
- Deferred: archive the original audio into the inspection folder; write Owner_ID back onto existing unowned Hub properties when an owner is chosen on an inspection.
