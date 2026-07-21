# BrettOS Feature Log — What Works, Don't Break It
**Version:** v1.8 | **Last Updated:** July 21, 2026
**Rule:** Before changing ANY file, check this log. If a feature is marked ✅ Working, verify it still works after your change. If you must touch something that affects a working feature, note it here BEFORE committing.

---

## VENDOR PORTAL (vendor.html)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| PIN login (vendor auth) | ✅ Working | Vendors enter name + **8-char PIN** (3 alpha + 5 digit, e.g. `ABC12345`) via `/vendor-by-pin` — NOT 4-digit. PAT-016 says 4-digit (stale doc); confirmed via CODEMAP July 21. | July 21, 2026 |
| Work order list with filters | ✅ Working | Filter by trade, priority, sort options | July 2026 |
| Photo upload — BEFORE/AFTER/REPORT | ✅ Working | `capture` attr removed — gallery bulk + camera both work | July 17, 2026 |
| Photo upload — bulk from gallery | ✅ Working | `multiple` attr present, no `capture` restriction | July 17, 2026 |
| Photo upload — single camera shot | ✅ Working | Mobile browser shows camera option in picker | July 17, 2026 |
| Receipt upload | ✅ Working | Accepts image/* + PDF | July 2026 |
| Video upload | ✅ Working | Accepted in BEFORE/AFTER/REPORT types | July 2026 |
| Vendor bill submission | ✅ Working | Submits to Vendor_Bills sheet via worker | July 2026 |
| Time tracking entries | ✅ Working | Start/end time per day | July 2026 |
| Material/expense entries | ✅ Working | Amount, date, store fields | July 2026 |
| Estimate builder | ✅ Working | Line items with totals | July 2026 |
| Searchable vendor dropdown | ✅ Working | Fixed July 2026 (PAT-021) | July 2026 |
| WO status updates | ✅ Working | Vendor can update WO status | July 2026 |

---

## MAIN PORTAL (index.html)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| Work order list | ✅ Working | | July 2026 |
| Invoice Review screen | ✅ Working | Added Session 1 — lists pending vendor bills | July 2026 |
| Vendor management | ✅ Working | | July 2026 |
| Property management | ✅ Working | | July 2026 |

---

## CLOUDFLARE WORKER (worker.js)

| Endpoint | Status | Notes | Last Verified |
|---|---|---|---|
| `GET /vendor-bills` | ✅ Working | Supports `?status=` filter (added Session 1) | July 2026 |
| `POST /invoice-review/approve` | ✅ Working | Added Session 1 — approves bill, writes Invoice_Review row | July 2026 |
| `GET /work-orders` | ✅ Working | | July 2026 |
| `GET /vendors` | ✅ Working | | July 2026 |
| `GET /properties` | ✅ Working | | July 2026 |
| `POST /upload-photo` | ✅ Working | Routes to Drive upload | July 2026 |
| Drive folder creation per WO | ✅ Working | | July 2026 |
| WO status/field writes (`/status`, `/workorder/update`, `/wo/admin-update`, assign) | ✅ Fixed July 21 | Match the **`ID`** column resolved by header name (`idColIndex()`). There is no `WO_ID` column — the July 19 fix looked one up, got `-1`, and fell back to `r[0]` (the blank `Vendor_Needs_Access` column), so writes returned `success:true` and changed nothing. See rule 6. | July 21, 2026 |
| `POST /workorder` (create) | ✅ Fixed July 21 | Next WO number read from the `ID` column by header name. Previously read `r[0]` (blank), found no numbers, and restarted at **WO-1001** on every create. Verified live: next create returned WO-1057. | July 21, 2026 |
| `GET /wo-audit` · `logWOAudit` | 🟡 Fixed July 21 | `WO_Audit` tab never existed; `logWOAudit` swallows all errors so writes silently no-opped, and `getWOAudit` had no catch → 500. Tab created via sheet-op; read now returns `[]` on failure. | July 21, 2026 |
| Bill entered → WO auto-set to Complete | ✅ Working | `addVendorBill` wraps `/vendor-bill/add` | July 19, 2026 |
| `GET /qb/test` · `/qb/accounts` · `/qb/setup-trades` | ✅ Working | QuickBooks production CONNECTED; OAuth refresh-token flow; created trade accounts+items | July 19, 2026 |
| `POST /qb/send-invoice` · `GET /qb/ready` | 🟡 Shipped July 20 — pending live verify | Preview-first: creates QB Invoice (customer) + Bill (vendor) from an Invoice_Review row. Find-or-create customer (`Owners.QBO_Customer_ID`) + vendor (`Vendors.QBO_Vendor_ID`). Labor summary line + per-receipt material lines (sum === Customer_Total). Refresh-token persisted to Config. Idempotent. Flips WO→Invoiced. CustomerMemo job-photo link (folder shared anyone-with-link). Receipts: ALL → Invoice (IncludeOnSend); reimburse-only → Bill. Attachments best-effort/non-fatal. Behind WORKER_SECRET (NOT public). | July 20, 2026 |
| WO Invoice Builder → `📤 Send to QuickBooks` | ✅ Working | Replaces the retired "Send to Make → QBO" button (posted to `/invoice-webhook`, a route that never existed → 404). Resolves the WO's pending `Invoice_Review` row via `/qb/ready` and opens the preview-first modal; no approved bill → points at Review Bills. | July 20, 2026 |
| `GET /receipts` · `POST /receipt/add` · `/receipt/delete` | ✅ Fixed July 20 | The `Receipts` tab never existed. `listReceipts`' try/catch returned `200 []` so reads looked healthy while every write 500'd. Tab created via sheet-op (ID first — `updateRow` matches `r[0]`). | July 20, 2026 |
| Vendor receipt routing → internal folder | 🟡 Shipped July 20 | `handlePhotoUploadClean` routes file_type receipt/bill/invoice to `_Internal — Vendor Bills` (sibling, NOT shared); job photos stay in the customer WO folder that gets shared on the invoice. | July 20, 2026 |
| `POST /intake` (email → WO, B-103 Phase A) | 🟡 Built July 21 — **staging branch only, never run against a real email** | Source-router (`detectSource`) → `parseBuildium` → dedupe → resolve Owner/Property/Unit/Tenant → `createWorkOrder` → `ingestFiles` (S3→Drive) → `onIntakeCreated` (admin SMS = the auto-assign seam). Behind its own `INTAKE_TOKEN` (WORKER_SECRET also accepted). Always returns HTTP 200 with `status`: created/duplicate/needs_review/skipped/unsupported. 141 offline tests pass (`node test/intake.test.mjs` + `test/intake.integration.test.mjs`) against a **synthetic** email built to the documented format — a real Buildium `.eml` has NOT been parsed yet. | Not verified live |
| Staging sandbox mode (worker.js) | 🟡 Built July 21 — unverified | `staging-*` hostname or `STAGING=1` → all Sheets calls use `STAGING_SHEET_ID` and `sendSMS` becomes log-only. **Fails closed:** staging detected with no `STAGING_SHEET_ID` returns 503 rather than falling back to the live sheet. Needed because Cloudflare preview deploys share production secrets. | Not verified live |
| `getWOFolder` (shared Drive folder resolver) | 🟡 Refactored July 21 | Extracted verbatim from `handlePhotoUploadClean` so vendor upload and email intake can't drift on folder layout or the receipt-privacy rule (rule 13). Photo upload behavior unchanged. `createUploadSession` keeps its own copy (different semantics — accepts a caller-supplied folder_id). | Not re-verified on mobile |
| `Work_Orders.Entry_Notes` + `POST /wo/append-entry-note` (B-104 pass 1) | 🟡 Built July 21 — staging, needs the column + live verify | Append-only, attributed (`[ts — author]`) access/scheduling notes via shared `appendWOField()`. Intake auto-appends as `[Owner/Buildium]`. Vendor access view shows the property default **and** the WO note joined, flattened for the assign SMS, still gated by `Vendor_Needs_Access`. Stripped from tenant + owner payloads by the `WO_NOTE_VISIBILITY` allowlist — which also closed a pre-existing `access_notes` leak to owners. See rules 18–20. **Columns not yet created:** `context/sheet-ops/staged_B104_notes_model.json` (needs the staging sheet id) — one sheet-op now covers all five fields. | Not verified live |
| Role-scoped WO notes model (B-104 v2.0) | 🟡 Built July 21 — staging, needs the columns + live verify | Five fields: `Entry_Notes` (admin+vendor), `Owner_Notes` (admin+vendor+owner), `Vendor_Admin_Notes` (admin+vendor thread), `Admin_Notes` (admin only), `Hold_Reason` (everyone). Enforced by the `WO_NOTE_VISIBILITY` allowlist in `enrichWO` — see rule 18. New: `POST /workorder/vendor-note` (scoped: vendor must own the WO), `GET /owner-export` (WO-PDF payload built through `ownerExportWO()`). `/wo/add-note` now routes by author role. `enrichWO` resolves `vendor_name`/`vendor_phone` for the first time — owner.html:647 and tenant.html:379 had been rendering an always-empty `vendor_name`. Owner gets name only; tenant now gets name **and** phone (v2.0 change). 69 visibility tests (`node test/visibility.test.mjs`). | Not verified live |
| Legacy `Notes` leak to owner + tenant portals | ✅ Closed July 21 | `owner.html` (~659) and `tenant.html` (~391) rendered `wo.Notes` verbatim — the same field the admin form calls "Internal notes…". Render blocks removed; Worker strips `Notes` from all non-admin payloads. Content preserved, not migrated (rule 20). **Live until this merges to main.** | Not verified live |
| Cloudflare auto-deploy (Workers Builds) | ✅ Live July 19 | Push to main → build+deploy. `wrangler.toml` keep_vars=true protects secrets. WAS broken (never connected). | July 19, 2026 |

---

## GOOGLE SHEET (RidgeCo Main)

| Tab | Status | Notes | Last Verified |
|---|---|---|---|
| Vendors | ✅ Working | Hourly_Rate column added July 17, 2026 | July 17, 2026 |
| Vendor_Bills | ✅ Working | | July 2026 |
| Work_Orders | ✅ Working | **Schema gotcha:** col 0 = `Vendor_Needs_Access` (blank/"auto"), col 1 = **`ID`** (holds `WO-1057`…). No `WO_ID` column. Resolve by header name — see rule 6. | July 21, 2026 |
| WO_Audit | 🟡 Created July 21 | `ID, WO_ID, Changed_By, Changed_By_Role, Field, Old_Value, New_Value, Timestamp, Notes` — matches the `newRow` map in `logWOAudit`. | July 21, 2026 |
| Receipts | ✅ Created July 20 | `ID, WO_ID, Amount, Description, Store, Date, Added_By, Added_By_ID, Role, Created_Date, Active` | July 20, 2026 |
| Invoice_Review | ✅ Working | Created July 17, 2026 with 19-column header. QB_Invoice_ID/QB_Bill_ID/QB_Invoice_Status written by `/qb/send-invoice` | July 20, 2026 |
| Properties | ✅ Working | | July 2026 |
| Vendors — `QBO_Vendor_ID` | 🟡 Added July 20 | For QB vendor find-or-create persistence (via sheet-op) | July 20, 2026 |
| Owners — `QBO_Customer_ID` | ✅ Working | Ensured July 20 (sheet-op); QB customer link | July 20, 2026 |

---

## REGRESSION RULES

1. **Before any vendor.html change:** Check photo upload, PIN login, and bill submission still work
2. **Before any worker.js change:** Check all GET endpoints return data, POST /invoice-review/approve still works
3. **Before any sheet structure change:** Verify worker.js column references still match
4. **Never add `capture="environment"` or `capture="camera"` to file inputs** — this breaks bulk gallery upload on mobile (fixed July 17, 2026)
5. **Never change the Vendor_Bills or Invoice_Review column order** without updating worker.js references simultaneously
6. **WO matching — there is NO `WO_ID` column on Work_Orders.** The real key is the **`ID`** column, and it is **not at index 0** — column 0 is `Vendor_Needs_Access` (blank, or `"auto"` on new rows); `ID` sits at **index 1**. Always resolve the key column **by header name** (`idColIndex()` / `findWO()`), never `r[0]` and never `headers.indexOf('WO_ID')` (that returns `-1`). Two failure modes this caused, both silent: (a) matching `r[0]` compared against a blank column, so vendor/status writes returned `success:true` and changed nothing; (b) `w.WO_ID === body.wo_id` is `undefined === undefined` when the caller omits the id, which **matched the first WO in the sheet** and operated on the wrong record. The July 19 "match on WO_ID" note was wrong about the schema — corrected July 20, 2026.
7. **Cloudflare deploy:** `wrangler.toml` must keep **`keep_vars = true`** — without it a deploy can wipe the dashboard env vars/secrets (QB, Google SA, Twilio, WORKER_SECRET). (Wired July 19, 2026.)
8. **QB refresh token rotates** — don't treat the static `QB_REFRESH_TOKEN` env as permanent; the write flow persists the rotated token. `invalid_grant` = re-auth.
9. **Void re-render:** the "duplicate + void killed both" bill bug was one bill rendered twice; void now does a full `loadAll()+openWODetail()` refresh, not fragile DOM removal. (Fixed July 19, 2026.)
10. **QB send is preview-first + idempotent:** `/qb/send-invoice` must never create a second QB invoice/bill when `QB_Invoice_ID`/`QB_Bill_ID` are already set. `preview_only` must make ZERO writes/Intuit calls. (July 20, 2026.)
11. **Invoice line invariant:** `buildInvoiceLines` = one labor summary line + one line per receipt (+ truck stock); lines MUST sum to `Customer_Total` (labor = Customer_Total − materials).
12. **Two cost bases:** `Invoice_Review.Vendor_Cost` = vendor payable = labor + truck + **reimburse-only** receipts (= the QB Bill amount). Brett Net uses ALL materials. On-account receipts bill the customer but never the vendor.
13. **Receipt folder privacy:** vendor receipts must NOT land in the customer WO photo folder (shared anyone-with-link on invoice send). Keep receipt/bill/invoice uploads routed to `_Internal — Vendor Bills`.
14. **QB Attachable is best-effort:** an attach failure must only warn, never block invoice/bill creation. Receipts attach to the customer Invoice (all) + vendor Bill (reimburse-only). Verify the multipart `/upload` format vs current Intuit docs if it regresses.
15. **Never build WO detail with `innerHTML +=`.** `detail-body` is assembled in five passes; `+=` re-parses the container and destroys every existing child node, so async loaders (`loadWOMaterials`, `loadVendorBillForInvoice`) resolve into *detached* elements and the visible ones sit on "Loading…" forever. Use `insertAdjacentHTML('beforeend', …)`, which appends in place. (Fixed July 20, 2026.)
16. **Intake must never auto-create a Property or an Owner on a partial match.** `/intake` builds records from untrusted email. An exact normalized address match reuses the property; a *partial* match (same house number, different street spelling) returns `needs_review` — it must NEVER create, because a duplicate property silently splits a building's WO history in two. Owners are never created at all (they're billing entities feeding `/qb/send-invoice`); an unmatched owner blocks property creation. Units and Tenants may be created on a genuine no-match — those are cheap to fix. (July 21, 2026.)
17. **The staging sandbox must fail closed.** Cloudflare preview deploys **share production secrets**, so staging-vs-live is enforced in code, not by environment. If staging is detected (`staging-` hostname or `STAGING=1`) and `STAGING_SHEET_ID` is missing, the Worker returns 503 — it must never fall back to `SHEET_ID`, or a preview build writes to the live sheet. `sendSMS` is the single Twilio chokepoint and is log-only in staging; any future SMS path must go through it. (July 21, 2026.)
18. **`WO_NOTE_VISIBILITY` in worker.js is the ONLY place note visibility is decided (B-104 v2.0).** `enrichWO` starts from `{...wo}`, so every Work_Orders column is exposed to every role by default — the matrix is therefore an **allowlist**: any field in `WO_NOTE_FIELDS` not listed for a role is deleted before the payload leaves the Worker. A new note column is private until you list it, which is the safe direction to fail. Adding a note column is a visibility decision, not a schema change. Enforce server-side only — never rely on a portal to hide a field, and never add a per-portal exception instead of editing the matrix. Roles: admin=all · vendor=Entry/Owner/Vendor_Admin/Hold · owner=Owner_Notes+Hold_Reason · tenant=Hold_Reason. (July 21, 2026.)
19. **`Entry_Notes`, `Owner_Notes` and `Vendor_Admin_Notes` are APPEND-ONLY.** Multi-source by design — Brett's "lockbox is red" and Buildium's "call 24h ahead" must both survive on the same WO. Always go through `appendWOField()` (read → append `[ts — author]` line → write). A plain `updateWOFields({Entry_Notes: …})` silently destroys every earlier line — `updateStatus` did exactly that to `Notes` (`fields.Notes = statusNote`) and wiped the whole history on every status change. Vendor access display merges the property default **and** the WO note (`[Access_Notes, Entry_Notes]`), never one-or-the-other — a WO note must never hide the standing property default. (July 21, 2026.)
20. **`Work_Orders.Notes` is a frozen admin-only archive — never write to it again.** Until B-104 v2.0 it was a single shared column rendered verbatim on BOTH the owner and tenant portals while the admin form labelled it "Internal notes…", so admin/vendor commentary was live on customer surfaces. Those render blocks are removed and the Worker strips `Notes` from every non-admin payload. Its contents are deliberately NOT migrated — they blend owner posts with admin notes and cannot be split safely; Brett reclassifies by hand. New writes go to the role-scoped field: owner→`Owner_Notes`, vendor/admin thread→`Vendor_Admin_Notes`, admin-private→`Admin_Notes`, customer-facing→`Hold_Reason`. (July 21, 2026.)
20b. **`Hold_Reason` is the ONLY note type that may reach an owner or tenant.** It must be written from an explicit, plain-language reason — never silently populated from an internal status note. If a note is being SMS'd to the owner it is customer-facing by definition and belongs here too. (July 21, 2026.)
21. **A read endpoint returning `[]` is not proof its tab exists.** PAT-014 try/catch on reads masked the missing `Receipts` tab for weeks — only writes surfaced it. When a tab is suspect, probe a *write* path (`updateRow` with a bogus id 404s before writing anything). Reads swallow; writes tell the truth.
22. **/sms-inbound is a PUBLIC endpoint** (in `PUBLIC_PATHS` — must stay public for the Twilio webhook). Treat it as an untrusted entry point in the B-093 per-user auth build; don't assume every route is behind WORKER_SECRET. The authoritative route/handler/Sheet-tab index is now **`context/CODEMAP.md`** (maintained by the `ridgeco-map` skill) — consult it before hunting through worker.js/index.html, and refresh it after structural changes. **`/intake` is a second untrusted entry point** — same treatment.
23. **`WORKER_SECRET` is hardcoded in `owner.html`, `tenant.html` and `vendor.html`,** so every gated route is effectively readable by any portal user. This is the known "Plan B" hole, but note what it costs: the bulk read `/workorders` returns RAW rows, bypassing the `WO_NOTE_VISIBILITY` allowlist entirely, so any private note column is one request away. `worker.js` ships an **optional `ADMIN_TOKEN` tier** — when that env var is set, the bulk reads that expose notes or cross-record PII (`/workorders`, `/tenants`, `/owners`, `/keys`, `/smslog`, …) require it instead. It is a **no-op while `ADMIN_TOKEN` is unset**. Verified no customer portal calls any of those paths. Enable it before relying on note privacy in production. (July 21, 2026.)
24. **Never interpolate untrusted text into an HTML attribute without escaping quotes.** `index.html`'s `linkify()` escaped `&amp; &lt; &gt;` but not `"`/`'`, then spliced the match into `href="$1"` — and its URL pattern `[^\s]+` swallows quotes. Once B-103 began writing email-derived text into `Description` (rendered via `linkify`), that was **stored XSS in the admin Hub**, where `AUTH_TOKEN` lives in `localStorage`. Use `esc()` for plain text; `linkify` now escapes quotes before matching. (July 21, 2026.)
25. **Private note content must never enter `WO_Audit`.** The audit trail is rendered in the owner portal and `/wo-audit` has no per-record authorization, so anything stored there is effectively public to portal users. `logWOAudit` redacts `Old_Value`/`New_Value`/`Notes` for every private note field at the WRITE chokepoint — the fact of a change is recorded, never the text. Redacting on write (not on read) means it holds no matter which reader is added later. `Hold_Reason` is deliberately exempt. (July 21, 2026.)

---

## HOW TO UPDATE THIS LOG

When a feature is added, fixed, or verified: add/update its row immediately.
When something breaks and is fixed: add a regression rule at the bottom so it never breaks the same way again.
