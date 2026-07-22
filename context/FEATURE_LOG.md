# BrettOS Feature Log — What Works, Don't Break It
**Version:** v1.8 | **Last Updated:** July 22, 2026
**Rule:** Before changing ANY file, check this log. If a feature is marked ✅ Working, verify it still works after your change. If you must touch something that affects a working feature, note it here BEFORE committing.

---

## DAILY DIGEST (worker.js — B-051, shipped July 22, 2026)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| `GET /daily-digest` | ✅ Working (deployed) | Auth-gated. Read-only morning digest built from Work_Orders + Vendor_Bills + Properties/Vendors/Tenants by real column names. `?deliver=1` triggers delivery (else preview JSON). Verified against live sheet July 22 (40 open WOs, 3 overdue, 4 vendor bills $501, pulse 64/80/6). | July 22, 2026 |
| `scheduled()` cron | ✅ Live, DORMANT | wrangler `crons=["0 11 * * *"]` = 7am EDT / 6am EST. Builds digest daily; **sends nothing** until Config `digest_enabled=TRUE`. Safe by design. | July 22, 2026 |
| Delivery layer | ⏳ Dormant (by design) | SMS via existing `sendSMS` — needs `TWILIO_FROM` + Twilio send live + Config `digest_sms_enabled=TRUE` + `digest_sms_to`. Email = `deliverDigestEmail` STUB, pick a provider later (`EMAIL_API_KEY`/`EMAIL_FROM`). **Do not "fix" the stub as if broken — it's intentionally off.** | July 22, 2026 |
| Config keys | Reference | `digest_enabled`, `digest_sms_enabled`, `digest_sms_to`, `digest_email_enabled`, `digest_email_to`. All absent/blank = fully dormant. | July 22, 2026 |

**To turn delivery ON (Brett, after Twilio send is live):** set `TWILIO_FROM`, then in Config set `digest_enabled=TRUE`, `digest_sms_enabled=TRUE`, `digest_sms_to=<your #>`. Nothing else changes.
**Known gaps (v2):** digest pulls only Sheet data — captures/backlog (GitHub) and receivables (e.g. Ray's tolls) not included yet; Invoices tab is empty so "Money" reads Vendor_Bills.

---

## RECEIPT PIPELINE (worker.js — B-084/085 first slice, shipped July 22, 2026)

Own-purchase receipts ONLY (business / owned-property / personal-HSA). **WO/vendor receipts are a SEPARATE existing vendor-portal flow — do not merge them into this.**

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| `POST /receipt-intake` | ✅ Deployed | `{file_id\|file_url\|image_b64(+mime), source}` → Claude-vision extract (vendor/date/total/handwritten) → 4-bucket classify → best-effort WO/property auto-link → `Receipts_Queue` (pending). Money-facing ⇒ claude-sonnet-4-6 (PAT-031). **Vision accuracy not yet confirmed on a live receipt** — that's the first activation test. | syntax only, July 22 |
| `POST /receipt-scan` (+ daily cron) | ✅ Deployed, self-provisioning | First run creates a `Receipts_Inbox` Drive folder under `DRIVE_PROPERTIES_ROOT` and writes `receipts_inbox_folder_id` to Config; later runs pull new drops into the queue. Runs in the 11:00-UTC `scheduled()` handler. Read + queue only. | syntax only, July 22 |
| `GET /receipt-queue` | ✅ Deployed | `?status=pending\|filed\|all`. Lists queue rows for the review screen (Hub UI = next step). | syntax only, July 22 |
| `POST /receipt-queue/approve` | ✅ Deployed | `{id, corrections?}` → files the receipt into the Vendors Drive folder (`receipts_dest_folder_id` or `DRIVE_VENDORS_ROOT`), marks `filed`, and **learns vendor→category** into Config `receipt_vendor_defaults`. No QuickBooks. | syntax only, July 22 |
| `Receipts_Queue` tab | ✅ Auto-created | `ensureTab()` self-creates it (ID,Source,Source_File_ID,…,Category,Handwritten_Note,Suggested_WO_ID,Suggested_Property_ID,Confidence,Status,Filed_File_URL,…). No manual sheet-ops. | July 22 |

**Config keys:** `receipts_inbox_folder_id` (auto-set), `receipts_dest_folder_id` (defaults to Vendors drive), `receipt_vendor_defaults` (learned JSON map).
**Deferred (next steps):** Gmail intake from info@ + brett@ (needs a mail-access collector feeding `/receipt-intake` — Worker has no Gmail scope); a Hub review screen consuming `/receipt-queue`; QuickBooks posting (explicitly out of this slice). **Vision extraction accuracy still needs a real-receipt test.**

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
16. **A read endpoint returning `[]` is not proof its tab exists.** PAT-014 try/catch on reads masked the missing `Receipts` tab for weeks — only writes surfaced it. When a tab is suspect, probe a *write* path (`updateRow` with a bogus id 404s before writing anything). Reads swallow; writes tell the truth.
17. **/sms-inbound is a PUBLIC endpoint** (in `PUBLIC_PATHS` — must stay public for the Twilio webhook). Treat it as an untrusted entry point in the B-093 per-user auth build; don't assume every route is behind WORKER_SECRET. The authoritative route/handler/Sheet-tab index is now **`context/CODEMAP.md`** (maintained by the `ridgeco-map` skill) — consult it before hunting through worker.js/index.html, and refresh it after structural changes.
18. **Cloudflare "Builds for non-production branches" can deploy straight to PRODUCTION — the non-prod deploy command MUST be `npx wrangler versions upload`, never `npx wrangler deploy`.** 🔴 **July 21, 2026 production incident.** Enabling non-production branch builds for the `staging` sandbox (B-103) caused every push to `staging` to run the production **`wrangler deploy`** command, silently overwriting the LIVE Worker with unmerged staging code. When the admin-token security gate (part of the unmerged notes-model/security work) landed on production, it **403'd every bulk read** (`{"error":"This endpoint requires the admin token"}`) and the live Hub showed **0 work orders / 0 properties** — which *looked* like blanked/lost data but was **not**: all 343 WOs + every tab were 100% intact in the sheet the whole time. It was purely the wrong code version answering. **Fixed by force-redeploying `main`** (rollback commit `3cf9a96`). Prevention: (a) non-prod branch deploy command = `wrangler versions upload` (→ a *preview* URL), NEVER `wrangler deploy`; (b) if unsure, keep "Builds for non-production branches" **OFF** — that is its current required state until reconfigured; (c) the `staging-` hostname sandbox mode (worker.js ~L45) only isolates data on a *preview* URL — it does nothing if staging code reaches the production URL. **Diagnostic key:** Hub reads its shared token from `localStorage['mh_auth']`; a **401** = token mismatch (wrong `mh_auth`), a **403 "requires the admin token"** = production is running the unmerged new code (redeploy `main`). The current shared secret is hardcoded in every portal `.html` (the exact security flaw B-093 exists to fix).

---

## HOW TO UPDATE THIS LOG

When a feature is added, fixed, or verified: add/update its row immediately.
When something breaks and is fixed: add a regression rule at the bottom so it never breaks the same way again.
