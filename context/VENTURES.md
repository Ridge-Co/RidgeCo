# BrettOS Ventures Overview
**Version:** v1.0 | **Last Updated:** July 2026
**Rule:** Load at session start. This file defines every active venture, its current state, tools, Claude's access level, and what remains manual. Update after each session that changes a venture's status.

---

## VENTURE 1: RIDGE CO

**Type:** Property maintenance company, Baltimore MD
**Status:** Active — primary development focus
**QB company:** Ridge Co (production QBO account)

### What it does
Manages work orders, vendors, and billing for Baltimore-area rental properties. Vendors complete jobs, submit invoices, Brett reviews and approves, invoices go to customers via QuickBooks.

### Stack
| Layer | Tool | Claude Access |
|---|---|---|
| Frontend | GitHub Pages — `index.html`, `vendor.html` | ✅ Push via GitHub |
| Backend API | Cloudflare Worker (`maintenance-hub.brett-2f8.workers.dev`) | ✅ Push via GitHub (auto-deploys) |
| Database | Google Sheets (RidgeCo Main sheet) | ✅ Via GitHub Actions sheet-ops |
| Invoicing | QuickBooks Online | ⏳ Pending production OAuth approval |

### Google Sheet Tabs (known)
| Tab | Purpose |
|---|---|
| Vendors | Vendor list — ID, name, contact, Hourly_Rate |
| Vendor_Bills | Bills submitted by vendors — status, amounts, job type |
| Work_Orders | Work orders — property, status, assigned vendor |
| Invoice_Review | Approved bills ready for QB invoicing — created July 2026 |
| Properties | Property list |
| Tenants | Tenant list |

### Known Vendors
| ID | Name | Rate |
|---|---|---|
| 2 | Alex Busey | $35/hr |
| 4 | Oscar Padilla | $50/hr |

### Active Worker Endpoints (Session 1)
- `GET /vendor-bills` — list bills, supports `?status=` filter
- `POST /invoice-review/approve` — approve a bill, write to Invoice_Review tab
- Various work order, vendor, property endpoints

### What's manual (needs future automation)
- QuickBooks invoice creation (unblocked once QB OAuth approved)
- QuickBooks bill recording
- Payment tracking

### Current development priority
Session 2 objectives TBD — Invoice Review screen functional, QB sync next.

---

## VENTURE 2: BRETTOS

**Type:** Cross-venture intelligence layer / internal OS
**Status:** Active — infrastructure layer for all ventures
**Description:** The GitHub repo, Cloudflare Worker, Google Sheets system, and context documents are BrettOS. It's not a separate product — it's the operating layer everything else runs on.

### Stack
Same as Ridge Co — they share the same repo and worker.

---

## VENTURE 3: BARRELCO

**Type:** Barrel and planter resale
**Status:** Active (operational level unknown)
**Platforms:** eBay, Craigslist
**Description:** Buys and resells barrels and planters. Has a SKU system.

### Claude's current access
| Layer | Status |
|---|---|
| eBay API | ❌ Not connected |
| Craigslist | ❌ No API available |
| Sheet (if any) | ❓ Unknown — no sheet shared yet |

### What's needed to automate
- eBay Developer account + API token for listing management
- Google Sheet for SKU/inventory tracking (share with service account)

---

## VENTURE 4: CABIN (WV STR)

**Type:** Short-term rental — Springfield, WV
**Status:** Active (operational)
**Platforms:** Airbnb, VRBO, managed via Uplisting

### Claude's current access
| Layer | Status |
|---|---|
| Uplisting API | ❌ Not connected |
| Airbnb API | ❌ Not available (Airbnb has no public API) |
| VRBO API | ❌ Not available publicly |
| Sheet (if any) | ❓ Unknown — no sheet shared yet |

### What's needed to automate
- Uplisting API token (check developer.uplisting.io)
- Google Sheet for booking tracking if desired

---

## VENTURE 5: WINCHESTER HAULING

**Type:** CHEP/PECO pallet recycling
**Status:** Active (operational level unknown)
**Description:** Driver portal, automated payments for pallet pickup/dropoff routes.

### Claude's current access
| Layer | Status |
|---|---|
| Driver portal | ❓ Unknown stack |
| Payment system | ❓ Unknown |
| Sheet (if any) | ❓ Unknown — no sheet shared yet |

### What's needed to automate
- Clarify current stack and what exists
- Share any relevant sheets with service account

---

## ADDING A NEW VENTURE

When a new venture starts, add a section here with:
1. Type and status
2. Stack (what tools/platforms)
3. Claude's current access level per layer
4. What's needed to fully automate
5. Any relevant sheet IDs, API endpoints, or credentials map entries

This ensures every new session has immediate context on how the venture fits into Brett's overall operation.

---

## BRETT'S OVERALL OBJECTIVES

- **Short term:** Ridge Co fully automated — QB invoicing, vendor payments, work order tracking, no manual data entry
- **Medium term:** All ventures on the BrettOS intelligence layer — one place to see everything
- **Long term:** Autonomous operations — Claude handles routine tasks on schedule, Brett handles decisions and relationships only
- **Non-negotiable:** Brett makes decisions. Claude executes. Once Brett says "do it," Claude has everything needed to carry it out without asking Brett to perform manual steps.
