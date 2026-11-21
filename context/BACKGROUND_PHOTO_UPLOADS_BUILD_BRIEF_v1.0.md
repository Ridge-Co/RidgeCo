# BACKGROUND PHOTO UPLOADS: BUILD BRIEF v1.0 (Nov 21 2026)

Status: **approved by Brett Nov 21 2026** (decisions below). Planning depth: **Deep** (7 pages, new data, gate in front of vendor invoicing).
Builder: **Sonnet** (`claude-sonnet-5-5`) per phase. Reviewer: **strong model** (Opus/Fable) reads the diff and this brief after every phase (`ridgeco-validate`). Self-contained: a fresh session needs nothing from the chat that produced it.

## 1. Problem (Brett's words, condensed)
"When I pick photos, the upload starts, but if I tap Next/Save/Close or move to another screen, the file is lost and never attaches. It happens in several places (work orders, trash jobs). Today I have to sit on the page until every photo finishes."

Wanted: pick any number of photos, keep working (Save, Next, Close, another screen), and the photos keep uploading in the background and attach to the right record. If one fails, a warning says exactly which record (with a link) and which photo, shown to whoever uploaded it (a vendor on the vendor portal, Brett on the Hub). **The warning stays open until the photo is replaced or someone actively says it is not needed (with a reason). Until then the vendor cannot invoice that job.** Cancel or Void of the work order clears it.

## 2. Decisions (Brett, Nov 21 2026; do not re-ask)
| # | Decision |
|---|---|
| D1 | All 7 upload pages: `vendor.html`, `trash.html`, `index.html` (Hub WOs), `tenant.html`, `owner.html`, `scope-creator.html`, `receipt-reconciler.html`. Order: vendor, trash, Hub WO, then the rest. |
| D2 | Sending a customer invoice (Hub WO invoice, trash Send) **waits** while that record's photos are still uploading ("Waiting for 2 photos…"), so nothing goes out missing them. |
| D3 | A vendor's failed photo shows on the vendor portal **and** on Brett's Hub. |
| D4 | Warnings show as a banner **and** on the record itself, next to its photos. |
| D5 | **A failed-photo warning stays open** until (a) a replacement uploads, or (b) someone taps "Not needed" and gives a reason. Auto-clears when the WO is Cancelled or Voided (reopens if un-voided / reinstated). |
| D6 | **The vendor cannot submit a bill for a WO** while that WO has an open warning on a file that vendor uploaded, or uploads of theirs still pending. Enforced **server-side**, explained on screen with the fix buttons. |
| D7 | No texts for any of this (standing rule R-1). Ledger rows are P2. |
| D8 | PR #623 (merged Nov 21) made trash Save wait for uploads. Phase 4 replaces that lock with "safe to leave". Keep 623's Add-photos-from-preview. |

Default applied without asking (Brett may override): the D6 rule also applies to **Brett's own customer invoice** for that WO / trash visit. Same resolve buttons, so a missing receipt or before/after photo can't slip out on an invoice either. For the customer invoice, **any** uploader's open issue or pending upload on that record blocks it. For a vendor bill, only that vendor's own issues and pending uploads block it (D6).

**Canonical `file_type` values:** `photo, before, after, receipt, report, video, document`. Map each page's existing values onto these in Phase 0; add a new value only with the strong reviewer's OK.

## 3. What exists today (verified Nov 21 on main `07514fa`)
- Every page uploads the same way: `POST /create-upload-session` (Worker returns a Drive resumable URL plus the record's folder), then the **phone PUTs the bytes straight to Drive**. The upload lives in page JavaScript, so leaving the page or reloading kills it.
- How a finished file is attached differs by page:
  - `vendor.html` `_uploadOneFile()` (~line 2456): after the PUT, `POST /log-attachment` per file (server-side, keyed by `wo_id`). It already retries 3 times and counts `_activeUploads`. A file is lost only if the page goes away before the PUT finishes.
  - `trash.html` `pickPhotos()`: ids sit in the page's `pendingPhotos` and are sent with `/trash/log-visit`. Anything finishing after Save was dropped (patched by #623 with a Save lock).
  - `index.html` (~18045), `tenant.html` (~943), `owner.html` (~1375), `scope-creator.html` (~1126), `receipt-reconciler.html` (~427): **Phase 0 maps each one.**
- **Pattern to copy: `field-inspect.html`.** IndexedDB `rc_field_inspect` (~line 194: `idbOpen/dbPut/dbGet/dbAll/dbDel`, in-memory fallback when IDB is unavailable), and a photo pump (~line 621: `pumpPhotos`, `sendPhoto`, classes `busy | transient | unsaved | fatal`, backoff 5/10/20/40/60 s, `PHOTO_MAX_TRIES = 10`, `reportPhoto()` → `window.hubReportFailure`). It survives reloads and resumes on the next page open. Lift this; don't reinvent it.
- Failure ledger: `failure-reporter.js` (`POST /failure/report`), `failures.html`, `/failure/update`.
- Scheduled work runs as a **Hub scheduler job** (never cron; CLAUDE.md).

## 4. Honest limits (put these in the help text, plainly)
- A phone browser cannot upload while it is fully closed. Queued photos wait **on the phone** and continue the next time any Ridge Co page on the **same site address** opens. The queue is per site address: Hub and portals on different domains each resume only their own.
- iPhone Safari can delete a site's stored data after ~7 days without a visit, unless the portal is saved to the home screen. The pending-intent check (Phase 2) catches this: the server knows the photo never arrived.
- If the phone cannot store a file (full, private mode), fall back to today's behaviour **loudly**: "This phone can't hold the photo; stay on this page until it finishes."

## 5. Build phases

### Phase 0: Map (read-only, Haiku or Sonnet). No code.
For each of the 7 pages, fill a table in `context/notes/<date>-bg-uploads-phase0.md`:
upload function and line, attach call (endpoint, idempotent or not), record type and id, file types used (photo/before/after/receipt/report/video), which user action loses a file today (reproduce it on staging), and any step that needs the file **before** it can continue (e.g. receipt OCR). Also list every server path that creates a **vendor bill tied to a WO** and every path that **sends a customer invoice** (Hub WO invoice, trash). Those are the gate points.
Also list every **other upload route** in `worker.js` and the page that uses it, at least `/wo/shared/upload-session` + `/wo/shared/log-attachment` (shared-WO links), `/fix/upload-session` + `/fix/log-attachment`, and `/upload-photo`. Mark each one in scope (moves onto the queue in Phase 4) or out of scope with a reason. A route left unlisted is a gap.
For each page also record **how it proves who the user is** (the token header it sends) and **whether the record exists before the photo is picked** (an existing WO: yes; a trash visit, a new tenant request or a new receipt: no). That last answer decides whether the page uses draft binding (Phase 1).
**Done when:** all 7 rows are filled with line refs, plus the gate-point list and the other-routes list. The strong reviewer signs off on the map before Phase 1.

### Phase 1: Shared queue `rc-upload-queue.js` + server intents
Client (`rc-upload-queue.js`, included by each page; follow `push-client.js` / `tenant-roster.js` style):
- `RCUpload.enqueue(files, ctx)`, where ctx = `{record_type, record_id, file_type, uploader_role, uploader_id, label}`. It writes every file's blob to IndexedDB `rc_upload_queue` **first** and resolves only once all are stored. That is the "safe to leave" moment. Row: `{id (uuid), ctx…, file_name, mime, size, blob, state: pending|uploading|done|failed, tries, err, created_at, intent_id}`.
- On enqueue, `POST /upload/intent` per row (idempotent on `client_row_id`) so the server knows a file is coming.
- `RCUpload.pump()` runs on load of every page that includes the script and after each enqueue. It does one file at a time: create-upload-session, PUT to Drive, then `POST /upload/attach {client_row_id, intent_id, file_id, file_url, …}`. It uses field-inspect's backoff and failure classes. A file is marked `failed` only on a fatal answer or after 10 tries. **One try counter per row covers session + PUT + attach.** If the PUT succeeded but attach failed, store the Drive `file_id` on the row and retry **only the attach**; never upload the bytes again. Done rows drop their blob.
- In Phase 1 a terminal failure goes to `window.hubReportFailure` and stays visible as `failed` in the bar. Phase 2 adds `POST /upload/issue`, and on first load after Phase 2 ships, the client posts an issue for every row already `failed` (idempotent per intent), so nothing failed before Phase 2 is missed.
- **Draft binding (for records that don't exist yet when the photo is picked, e.g. a trash visit, a new tenant request, a new receipt):** the page makes a `draft_id` (uuid) when the sheet opens and enqueues with `{record_type, draft_id}` and no `record_id`. `/upload/attach` for a draft stores the `file_id` on the intent with status `uploaded_unbound` and attaches nothing yet. The record's own save call (for trash, `/trash/log-visit`) sends `draft_id`. The server then binds every intent with that `draft_id` to the saved record: it appends the already-uploaded files once, and later attaches go straight to the record. Binding uses the record id **after** save, so editing the date before Save can't misplace files. A draft never saved (sheet cancelled) → its intents are dropped after 24 h and its Drive files are left alone (no deletes). No issue opens for them, because nobody wanted them saved.
- Phase 1 server routing covers only **vendor WO** and **trash** (the first two pages). Each other page's routing is added in its Phase 4 PR, using the Phase 0 map.
- `RCUpload.status(record_type, record_id)` gives pending/failed counts for a record, for the D2 wait and page badges.
- A small bottom bar on every page: "3 photos uploading · safe to leave this page" / "1 photo failed · see warning". Use `rc-ui.css` styles and the DESIGN.md rules. Mobile-first.
- `beforeunload` prompts **only** while a blob is still being written to IndexedDB (a fraction of a second), never during the upload itself.
- No IndexedDB: in-memory queue plus the loud stay-on-page warning (§4).
Server (`worker.js`):
- New tab `Upload_Intents`: `ID, Client_Row_ID, Record_Type, Record_ID, File_Name, File_Type, Size, Uploader_Role, Uploader_ID, Status (pending|done|failed), File_ID, Created_At, Done_At, Issue_ID`. It self-provisions, like `ensureTrashTabs`.
- `POST /upload/intent` creates or returns an intent (idempotent).
- `POST /upload/attach` attaches to the record **idempotently** (the same `client_row_id` or Drive file id twice adds nothing) and marks the intent done. It routes by record type: WO → the existing `/log-attachment` logic; trash visit → append to `Trash_Visits.Photo_File_IDs` for that visit (the visit is identified by id, or by property + date); scope / receipt / tenant / owner → whatever Phase 0 found.
- `Upload_Intents` also gets `Draft_ID` and the status value `uploaded_unbound`.
- Auth: the same token headers each page already sends (Phase 0 lists them). The server checks them the same way that page's existing endpoints do. A vendor can only create or attach intents for WOs assigned to them; a tenant or owner only for their own records. Brett's Hub token can do any.
**Done when** the tests in §6 for Phase 1 pass, and on staging: pick 3 photos on a test WO, tap Save immediately, open another page, come back. All 3 are attached exactly once.

### Phase 2: Warnings (`Upload_Issues`) and the lifecycle (D3, D4, D5)
- New tab `Upload_Issues`: `ID, Intent_ID, Record_Type, Record_ID, Record_Label, File_Name, File_Type, Uploader_Role, Uploader_ID, Error, Opened_At, Status (open|replaced|not_needed|auto_closed), Resolution_Reason, Resolved_By, Resolved_At, Replacement_Intent_ID`.
- An issue opens when (a) the client reports a terminal failure (`POST /upload/issue`, idempotent per intent), or (b) a new Hub scheduler job `upload_intent_watch` finds an intent still `pending` after 6 hours. Error text: "Never finished uploading from the phone (phone off, browser closed for good, or browser data cleared)."
- Each open issue also files one P2 failure-ledger row, closed when the issue closes.
- Resolve:
  - **Replace**: the warning's "Upload replacement" button enqueues with `replaces_issue_id`. A successful attach closes the issue as `replaced`.
  - **Not needed**: requires a reason from a list ("Duplicate / already uploaded", "Wrong photo", "Not needed for this job", "Other"), and "Other" requires at least 5 characters of text. Who and when are recorded. Vendors resolve issues on their own uploads. Tenants and owners resolve their own. Brett resolves any.
  - **Auto-close**: the WO goes Cancelled or Void → `auto_closed`. Un-void or reinstate → reopened. Any other record that has a cancel or void state does the same (Phase 0 lists them).
- Show:
  - Hub `index.html`: a "Photo upload problems" banner listing each open issue (WO number as a link, property, file name, type, who uploaded it, error, age). It also appears on Needs Attention.
  - WO detail and the trash visit/preview: the issue inline next to the photos, with Replace / Not needed buttons.
  - Vendor portal: a banner at the top plus a notice on the job card.
  - Tenant/owner portals: on that request.
  - Words name the specific job and file. Spanish via `vendor-i18n.js` for vendors (Sonnet writes the Spanish; the strong reviewer checks it).
**Done when** the Phase 2 tests pass and on staging: force one upload to fail, see it on the Hub and on the vendor portal with the right WO link and file name, mark it Not needed with a reason → it clears on both; void the WO → it clears; un-void → it returns.

### Phase 3: Gates (D2, D6, plus the default in §2). **GATED: Brett approves the main merge.**
- **Vendor bill:** every server path from Phase 0 that creates a vendor bill for a WO refuses with HTTP 409 `{blocked:'upload_issues', open_issues:[…], pending_uploads:n}` while that WO has open issues on files from that vendor, or that vendor's intents are still pending. The vendor portal shows why and offers Replace / Not needed right there. Pending ones say: "2 photos are still uploading from your phone. Open the portal on that phone to finish."
- **Customer invoice (Hub WO invoice + trash Send):** waits while the record has pending uploads ("Waiting for 2 photos…"), and refuses on open issues for that record with the same resolve buttons. The trash batch "Send all" skips blocked properties and lists them.
- The money math and the QuickBooks payload are unchanged. This phase only adds a refusal in front of them.
**Done when** the Phase 3 tests pass and on staging: a vendor with an open issue gets 409 and the explanation; after Not needed the bill submits; Brett's trash Send waits, then sends.

### Phase 4: Move every page onto the queue (D1 order) and remove the old paths
vendor → trash (replace #623's Save lock with "safe to leave"; `/trash/log-visit` no longer carries photo ids for new uploads, but keeps accepting them for old pages) → Hub WO → tenant → owner → scope-creator → receipt-reconciler (receipt OCR waits for its own file to land; it shows "reading once the upload finishes").
Each page gets: the bottom bar, per-record pending/failed badges, and the warnings from Phase 2. One PR per page or per pair, each with its own note.

## 6. Acceptance tests (the builder writes these first; all must pass before review)
Use the fake-DOM pattern from `test/trash-add-photos.test.mjs` (it runs the real page script) and extract Worker functions the way `test/trash.test.mjs` does.
1. The queue survives a "reload": enqueue 3, drop the page context, start a new one on the same fake IDB, pump → 3 attaches, each exactly once.
2. `enqueue()` resolves only after every blob is stored, so leaving the page right after it never loses a file.
3. Retry classes: transient keeps the row pending with growing backoff; fatal marks it failed and reports it once; after 10 transient failures the row is failed.
4. `/upload/attach` is idempotent: the same client_row_id twice → one attachment, one done intent.
5. A vendor cannot attach to a WO not assigned to them (403).
6. The intent watcher opens an issue for a 6-hour-old pending intent, and only once.
7. Not needed without a reason → refused. "Other" with fewer than 5 characters → refused. With a reason → closed, reason recorded.
8. Replacement attach closes the issue as replaced.
9. WO Void → auto_closed. Un-void → open again.
10. Vendor bill paths: 409 with an open issue, 409 with a pending intent, OK after the issue is resolved. Another vendor's or a tenant's issue does not block this vendor.
11. Trash Send and Hub WO invoice: wait while pending, refuse on an open issue, send after it is resolved. The batch skips blocked ones and names them.
12. No IndexedDB → loud stay-on-page warning, nothing silently dropped. Same when an IndexedDB write fails (quota/full phone; simulate a rejecting put).
13. Banner and record views show the WO number link, file name and uploader. Vendor text exists in Spanish.
14. Attach fails after a good PUT → retry sends only `/upload/attach` with the stored file_id (no second create-upload-session or PUT).
15. Draft binding: 2 files uploaded before Save + 1 after, date edited before Save → all 3 on the saved visit, once each. A cancelled draft attaches nothing and opens no issue.
16. D3: one vendor-uploaded failure appears in **both** the Hub's open-issue list and the vendor portal's list.
17. D5: WO set to Cancelled → `auto_closed`; reinstated → open again (same as Void, test 9).
18. D7: no issue path calls any SMS/Twilio function (stub them and assert zero calls across tests 6–17).
19. Gate scope: a customer invoice is blocked by a tenant's open issue on that record; a vendor bill is not blocked by it.
20. Phase 2 backfill: rows already `failed` before Phase 2 each post exactly one issue on first load.
21. `scripts/ui-check.mjs` passes on every page touched. The full `test/` suite stays green. `test/pre-build-gate.test.mjs` passes (each PR note has `## Pre-build gate`).
Staging checks (Playwright, `test-verified-builds`): the scenarios under each phase's "Done when". `maintenance-hub-staging` does not auto-deploy reliably, so confirm with `/version` or the deployed source before testing (CLAUDE.md).

## 7. How to run this build (cheap builder, high quality)
1. Strong model (session lead) reads this brief, `CLAUDE.md`, `context/BRANCH_POLICY_v1.0.md`, `context/PRE_BUILD_GATE_v1.0.md`, and `field-inspect.html` §§194–720.
2. Per phase: launch a **Sonnet** subagent with a contract: objective = that phase; files allowed; tests §6 for that phase written **first**; budget ~60 turns; done = tests green plus the staging scenario.
3. Gate 1 (deterministic): full test suite, ui-check, `node --check worker.js`, silent-failure lint.
4. Gate 2: **strong model reviews the diff against this brief** (`ridgeco-validate`), never the worker's own summary. The cheap model never signs off alone.
5. Retry cap: 2 Sonnet retries with the failing output attached, then the strong model fixes it, then Brett.
6. Branch from current `main`, one PR per phase (Phase 4: per page), PR targets `main`, staging via the test-only PR (BRANCH_POLICY). Phases 0–2 and 4 may self-merge under R-2 **only** if they touch no money path. Phase 3, and any PR that touches invoice/bill code, is **GATED: Brett says merge**.
7. Report line per phase: model used, retries, which gate caught what, minutes.
Escalate (stop, one sentence to Brett, replan) if: a page's attach path can't be made idempotent; a gate point exists that Phase 0 missed; scope grows past these 7 pages; or anything touches QuickBooks payloads.

## 8. Known gaps (out of scope; say so in the notes)
- Deleting a photo that was attached by mistake (separate ask).
- Uploading while the browser is fully closed (§4, not possible on the web).
- Field Inspection keeps its own queue; it is not migrated here.
