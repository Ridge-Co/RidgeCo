# BrettOS Ventures Overview
**Version:** v1.1 | **Last Updated:** November 9, 2026 (v1.0 was July 2026)
**Rule:** Load at session start. This file defines every venture, its REAL current status, tools, Claude's access level, and what remains manual. Update after each session that changes a venture's status.

## READ THIS FIRST — how to use this file (added Nov 9, 2026)

Every venture below has a **Status** using this vocabulary. Never infer that a venture is operating, staffed or generating work from its name or from a stack description.

| Status | Meaning |
|---|---|
| ACTIVE | Operating regularly; revenue or work happens weekly or monthly |
| SPORADIC | Real activity, but only occasionally, by Brett alone, as time allows |
| BUILDING | Being set up; not yet producing regular work |
| IDEA | Exploring; nothing operating |
| PAUSED | Ran before, stopped |

Rules for any assistant, agent or scheduled job (Claude, Gemini, the Scout) that reads this file:
1. A venture's status here beats anything inferred from a chat, a repo, a stack description or an earlier snapshot.
2. Do not recommend "economies of scale", "backhaul", "fleet pooling" or similar between ventures unless every venture involved is ACTIVE or the recommendation is explicitly about getting a SPORADIC/BUILDING venture started.
3. If a recommendation depends on a venture's status and this file does not state it, say so. Do not guess.
4. Things listed under "Not a venture" below are not businesses and must not be treated as revenue lines.

---

## VENTURE 1: RIDGE CO

**Type:** Property maintenance company, Baltimore MD
**Status:** ACTIVE — primary development focus
**QB company:** Ridge Co (production QBO account)

### What it does
Manages work orders, vendors, and billing for Baltimore-area rental properties. Vendors complete jobs, submit invoices, Brett reviews and approves, invoices go to customers via QuickBooks.

### Stack
| Layer | Tool | Claude Access |
|---|---|---|
| Frontend | GitHub Pages — `index.html`, `vendor.html` | ✅ Push via GitHub |
| Backend API | Cloudflare Worker (`maintenance-hub.brett-2f8.workers.dev`) | ✅ Push via GitHub (auto-deploys) |
| Database | Google Sheets (RidgeCo Main sheet) | ✅ Via GitHub Actions sheet-ops |
| Invoicing | QuickBooks Online | ⏳ Pending production OAuth approval (as of July 2026; see CURRENT.md / notes for the live state) |

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
| 2 | Alex Busey | (rate private) |
| 4 | Oscar Padilla | (rate private) |

### Active Worker Endpoints (Session 1)
- `GET /vendor-bills` — list bills, supports `?status=` filter
- `POST /invoice-review/approve` — approve a bill, write to Invoice_Review tab
- Various work order, vendor, property endpoints

### What's manual (needs future automation)
- QuickBooks invoice creation (unblocked once QB OAuth approved)
- QuickBooks bill recording
- Payment tracking

### Current development priority
See `context/CURRENT.md` and `context/notes/` for the live state. (The July 2026 line "Session 2 objectives TBD" is out of date.)

---

## VENTURE 2: BRETTOS

**Type:** Cross-venture intelligence layer / internal OS
**Status:** ACTIVE — infrastructure layer for all ventures
**Description:** The GitHub repo, Cloudflare Worker, Google Sheets system, and context documents are BrettOS. It's not a separate product — it's the operating layer everything else runs on.

### Stack
Same as Ridge Co — they share the same repo and worker.

---

## VENTURE 3: BARRELCO

**Type:** Barrel and planter resale
**Status:** ACTIVE (operational level: Brett sells in the Baltimore, Waynesboro VA and Winchester VA markets; stock-building for planter season is in progress)
**Platforms:** eBay, Craigslist, Facebook Marketplace
**Description:** Buys and resells barrels and planters. Has a SKU system.

### Claude's current access
| Layer | Status |
|---|---|
| eBay API | ❌ Not connected |
| Craigslist | ❌ No API available |
| Sheet (if any) | ❓ Unknown — see the BarrelCo notes for current tools |

### What's needed to automate
- eBay Developer account + API token for listing management
- Google Sheet for SKU/inventory tracking (share with service account)

---

## VENTURE 4: CABIN (WV STR)

**Type:** Short-term rental — Springfield, WV
**Status:** ACTIVE (operational)
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
**Status:** SPORADIC — corrected by Brett, Nov 9, 2026 (the July 2026 entry said "Active" and was wrong)

### What is actually true (Brett's own words, Nov 9, 2026)
- Right now it is **only Brett**, whenever he has time. There are **zero drivers**.
- The one thing it does today: Brett runs roughly **one 45-pallet load every 3 months to keep the CHEP account active**.
- **The blocker:** he is trying to recruit drivers in the Baltimore area to bring him pallets, so a network produces a constant flow without Brett loading pallets all day. No drivers yet.
- **The goal:** scale to processing pallets at large volume — real revenue, real jobs, real net income beyond one load a quarter.
- A driver portal and automated driver payments were designed (the B-132 reuse idea: work-order engine → driver payments → recruitment loop). They are **not in use**, because there are no drivers.

### Implications for any assistant
- Do not describe Winchester Hauling as an operating hauling business, and do not assume trucks, drivers, routes or regular pallet runs.
- Do not recommend backhaul, fleet pooling or route coordination as if trucks were already running. Ideas are welcome only if they help **recruit drivers or create pallet supply**.

### Claude's current access
| Layer | Status |
|---|---|
| Driver portal | ❓ Designed, not in use |
| Payment system | ❓ Designed, not in use |
| Sheet (if any) | ❓ Unknown — no sheet shared yet |

### What's needed to move forward
- Recruit the first Baltimore-area drivers
- Then: decide whether the driver portal and automated payments get built or adapted

---

## VENTURE 6: HANDYMAN BUSINESS

**Type:** Baltimore-area handyman services, run alongside Ridge Co
**Status:** ACTIVE

---

## NOT A VENTURE (do not treat as revenue lines)

- **Junk hauling:** done as needed, basically for friends or Ridge Co handyman customers (Brett, Nov 9, 2026). It is not a regular business and not a revenue line.
- **Fleet / "Kingbee":** Brett's own small vehicle fleet falls under a broader relationship with a fleet manager, used for vendor leverage on vehicle maintenance. Do not read it as evidence of hauling operations.

---

## ADDING A NEW VENTURE

When a new venture starts, add a section here with:
1. Type and **Status** (use the vocabulary at the top)
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
