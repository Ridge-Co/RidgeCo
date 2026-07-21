# BrettOS Feature Log — What Works, Don't Break It
**Version:** v1.3 | **Last Updated:** July 20, 2026
**Rule:** Before changing ANY file, check this log. If a feature is marked ✅ Working, verify it still works after your change. If you must touch something that affects a working feature, note it here BEFORE committing.

---

## VENDOR PORTAL (vendor.html)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| PIN login (vendor auth) | ✅ Working | Vendors enter name + PIN to access their WOs | July 2026 |
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
| WO status/field writes (`/status`, `/workorder/update`, `/wo/admin-update`, assign) | ✅ Fixed July 19 | Now match on **WO_ID** (ID fallback). Newer WOs have a blank ID column, so writes were silently no-matching → status-not-saving + vendor-persist bug. | July 19, 2026 |
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
| Work_Orders | ✅ Working | | July 2026 |
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
6. **WO matching:** Work_Orders rows have a **blank ID column** — the real key is `WO_ID`. All WO-update functions match `WO_ID` (ID fallback). Do NOT revert to ID-only or writes silently fail on newer WOs. (Fixed July 19, 2026.)
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

---

## HOW TO UPDATE THIS LOG

When a feature is added, fixed, or verified: add/update its row immediately.
When something breaks and is fixed: add a regression rule at the bottom so it never breaks the same way again.
