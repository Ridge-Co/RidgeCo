# BrettOS Feature Log — What Works, Don't Break It
**Version:** v1.1 | **Last Updated:** July 19, 2026
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
| Cloudflare auto-deploy (Workers Builds) | ✅ Live July 19 | Push to main → build+deploy. `wrangler.toml` keep_vars=true protects secrets. WAS broken (never connected). | July 19, 2026 |

---

## GOOGLE SHEET (RidgeCo Main)

| Tab | Status | Notes | Last Verified |
|---|---|---|---|
| Vendors | ✅ Working | Hourly_Rate column added July 17, 2026 | July 17, 2026 |
| Vendor_Bills | ✅ Working | | July 2026 |
| Work_Orders | ✅ Working | | July 2026 |
| Invoice_Review | ✅ Working | Created July 17, 2026 with 19-column header | July 17, 2026 |
| Properties | ✅ Working | | July 2026 |

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

---

## HOW TO UPDATE THIS LOG

When a feature is added, fixed, or verified: add/update its row immediately.
When something breaks and is fixed: add a regression rule at the bottom so it never breaks the same way again.
