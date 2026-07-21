# Brett AI Context Document
**Version:** v1.11 | **Last Updated:** July 21, 2026
**Rule:** Load this at the start of every session before doing any work.

---

## SECTION 1: WHO BRETT IS

Brett runs multiple ventures from Baltimore, MD. Primary device: Samsung Galaxy S23 Ultra (Android Chrome). All systems are mobile-first. Brett does NOT manually paste code — Claude pushes changes directly to GitHub.

**Ventures:**
- **Ridge Co** — Property maintenance, Baltimore-area rentals. Vendors, tenants, work orders.
- **BrettOS** — Cross-venture intelligence layer. GitHub Pages + Cloudflare Worker + Google Sheets.
- **BarrelCo** — Barrel & planter resale. SKU system. eBay/Craigslist.
- **Cabin** — WV Cabin STR (Springfield, WV). Airbnb/VRBO. Managed via Uplisting.
- **Winchester Hauling** — CHEP/PECO pallet recycling. Driver portal. Automated payments.

---

## SECTION 2: STACK CONSTRAINTS (NON-NEGOTIABLE)

- **Frontend:** Single `index.html` on GitHub Pages. No subfolders, no build tools.
- **Backend:** Cloudflare Worker — deployed via GitHub repo `ridge-co/RidgeCo` (auto-deploys on push to main). Never suggest Wrangler CLI.
- **Database:** Google Sheets via service account `brett-os-sheets@brettos-502323.iam.gserviceaccount.com`
- **Drive access:** Claude connects as `info@bmoremanagement.com`
- **GitHub repo:** `ridge-co/RidgeCo` (not `brett332/RidgeCo`)
- **Mobile-first:** Samsung Galaxy S23 Ultra / Android Chrome

---

## SECTION 3: HOW BRETT WORKS WITH CLAUDE

1. Brett does not paste code manually. Claude pushes to GitHub via git.
2. Brett needs complete files — never partial snippets or "paste this at line X."
3. Brett gives voice-to-text input — interpret charitably.
4. Always ask clarifying questions before starting (PAT-025).
5. Read all relevant files before writing any code (PAT-024).
6. Use AskUserQuestion with multiple-choice options.

---

## SECTION 4: RIDGE CO — PROJECT DETAILS

**Maintenance Hub** (`index.html`) — admin portal. Work orders, vendors, tenants.
**Vendor Portal** (`vendor.html`) — vendor app for submitting bills and timesheets.
**Worker** (`worker.js`) — Cloudflare Worker, all API endpoints.

**Key Google Sheet:** `1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4`
Tabs: Work_Orders, Vendors, Tenants, Units, Properties, Vendor_Bills, Materials, Returns, WO_Notes, WO_Templates, SMS_Logs, Cache, Wishlist, Invoice_Review

**Active Vendors:**
| Vendor | ID | Hourly_Rate |
|---|---|---|
| Alex Mix | V-001 | $35 |
| Oscar Padilla | V-002 | $50 |
| Cesar Gomez | V-003 | TBD |
| Eddie Smith | V-004 | TBD |
| Alan George (Mook) | V-005 | TBD |

**Vendor Bill Markup Formula (Session 1):**
`vendor_labor + brett_time + travel + markup + processing_fee = CUSTOMER_TOTAL`

**Invoice Review Flow:**
1. GET `/vendor-bills?status=submitted` — Brett reviews submitted bills
2. Brett sets markup, Brett time, travel, processing fee
3. POST `/invoice-review/approve` — saves reviewed bill + appends to Invoice_Review log
4. Session 2 (future): QB Invoice + QB Bill created from Invoice_Review rows

**Session 1 Worker endpoints added:**
- `GET /vendor-bills?status=submitted` — status-only filter
- `POST /invoice-review/approve` — approve with markup fields

---

## SECTION 5: GOOGLE DRIVE FILE MANAGEMENT

Claude uses Drive MCP as `info@bmoremanagement.com`.
**Limitation:** No rename, move, or delete. New versions = new files.

**Naming rule (PAT-026):** All docs must include version number in filename (e.g., `Brett_Context_Document_v1.8`).

**Brett AI Context folder ID:** `1iFFIwzUN4EKhJEgfCAqlUdkt8cyMNClX`

**Current live files (July 2026):**
| File | Status |
|---|---|
| Brett_Context_Document_v1.8 | CURRENT (this file) |
| Brett_Cowork_Best_Practices_v1.3 | CURRENT |
| RidgeCo_Markup_Formula_v1.0 | KEEP |
| Master_DevLog | KEEP |

**Brett must manually delete these old versions:**
- `Brett_Context_Document` (ID: 1a7E5Li2qk5oy6qC6A2Ie9tF1CZjskhfJDzwDcB4nNHE) — old v1.7
- `Brett_Context_Document` (ID: 1JuEZmH-go3RPW_HC9alImsRICJoT9_cqwMcTlBECThQ) — old v1.6
- `Brett_Context_Document_v1.5` (ID: 1FifvFUdPJGkYBFlNQPawIQ-3DJDQH6Cr4Tm2p6Swenc)
- `Brett_Cowork_Best_Practices` (ID: 1tVDkHyvOuYGTH8Ybsftkej8_xYvBHYRvPd7OKeQWRhQ) — old v1.2
- `Brett_Cowork_Best_Practices` (ID: 1E57giGYs2FGXz3_FROoH0pFf9FZ_vC7rzEnr3pfCssA) — old v1.1
- `Brett_Cowork_Best_Practices` (ID: 1cL3yb5mXj_uf1ZAanObsm3zNvR0WsqleQZfLglAIshE) — old v1.0
- `OLD_VERSIONS — DELETE THESE` (ID: 1i5-ri5QA3Qrem86ywq9RP_8vMNAc4Y3g067BFSAZy_0)

---

## SECTION 6: PATTERN LIBRARY (PAT-001 through PAT-030)

**PAT-001: Single Source of Truth** — One index.html, one Worker, one Sheet. No logic duplication.

**PAT-002: Mobile-First Always** — Default to S23 Ultra / Android Chrome for all UI decisions.

**PAT-003: Complete File Delivery** — Never partial snippets. Full file every time.

**PAT-004: No Wrangler** — Worker deployed via GitHub auto-deploy or dashboard only.

**PAT-005: Sheet as Database** — Google Sheets is the only database. No KV, no D1.

**PAT-006: Active Flag** — Deletion = set Active to FALSE. Never hard delete rows.

**PAT-007: ID Convention** — WO- (work orders), V- (vendors), T- (tenants), U- (units), P- (properties), VB- (vendor bills), IR- (invoice review).

**PAT-008: Dev Log Tab** — Every project sheet has a Dev Log/Wishlist tab. Surface it at session end.

**PAT-009: SMS Notifications** — Twilio SMS for key events. Phone in E.164 format (+1XXXXXXXXXX).

**PAT-010: CORS Headers** — All Worker responses include Access-Control-Allow-Origin: *.

**PAT-011: Error Responses** — All errors return JSON `{ error: "message" }` with appropriate HTTP status.

**PAT-012: Multiple Choice First** — Always provide lettered options (A/B/C) when asking Brett a question.

**PAT-013: Session Log** — Every session ends with a summary row in the spec doc's Session Log.

**PAT-014: Try/Catch Everything** — All Worker functions wrapped in try/catch. Missing tabs return [] not 500.

**PAT-015: Vendor Portal Separation** — vendor.html is separate. No admin data exposed to vendors.

**PAT-016: PIN Authentication** — Vendors: 4-digit PIN. Tenants: phone number. No passwords.

**PAT-017: Searchable Dropdowns** — All vendor/tenant selection uses type-to-search dropdowns.

**PAT-018: Status Workflow** — Work orders: open → in_progress → completed → closed. Vendor bills: submitted → reviewed → invoiced.

**PAT-019: Timestamp Convention** — Dates as YYYY-MM-DD strings. Times as HH:MM if needed.

**PAT-020: Language Support** — Vendor portal supports English and Spanish. Preference in Vendors tab.

**PAT-021: Rate Fallback** — If Hourly_Rate missing or 0, show "⚠ Rate not set." Never silently default.

**PAT-022: Markup Transparency** — Invoice Review shows full breakdown: vendor cost, Brett time, travel, markup %, processing fee, customer total.

**PAT-023: QB Integration Placeholder** — Invoice_Review sheet has QB_Invoice_ID, QB_Bill_ID, QB_Invoice_Status for Session 2.

**PAT-024: VERIFY BEFORE BUILD — MANDATORY**
Applies to every session, agent, and workflow without exception.

Before writing any code, Claude must:
1. Read all relevant files in their current state
2. Understand full structure — existing functions, variable names, routes
3. Identify exactly where changes go
4. Confirm no conflicts before writing a single line

After making changes, Claude must:
1. Review every changed section for correctness
2. Verify clean integration with surrounding code
3. Confirm nothing was accidentally removed
4. Deliver the complete file — never partial snippets

Brett cannot easily locate insertion points in large files. Complete file delivery is non-negotiable.
Any agent or workflow created for Brett must include this rule explicitly.

**PAT-025: ALWAYS ASK CLARIFYING QUESTIONS — MANDATORY**
Applies to every session, agent, and workflow without exception.

Before starting any task, Claude must clarify:
- Anything vague or underspecified
- Anything where two reasonable interpretations exist
- Anything where the wrong assumption would cause rework
- Access/credential requirements, scope, priority

How: Use AskUserQuestion with multiple-choice options. Max 4 questions at once.
Do NOT assume and proceed when the answer would materially change the output.
Any agent or workflow created for Brett must include this rule explicitly.

**PAT-026: VERSION NAMING CONVENTION — MANDATORY**
All Drive documents must include the version number in the filename.

Format: `DocumentName_vX.Y` (e.g., `Brett_Context_Document_v1.8`)

Rules:
- Every new version = new file with incremented version number in filename AND document header
- Old version filename should have "DELETE" noted — but since Drive MCP can't rename, add to deletion list and inform Brett
- Never create a Drive doc without a version number in the filename
- This applies to all sessions and all projects

**PAT-029: CLAUDE SELF-SUFFICIENCY MANDATE**
Once Brett says "do it," Claude must have — or immediately acquire — everything needed to carry out the task without asking Brett to perform manual steps. Claude's job is to remove Brett from the execution path entirely. This means:
- Credentials and tokens must be pre-mapped in CREDENTIALS_MAP.md
- Sheet access must be pre-established (service account shared)
- Worker changes go via GitHub push — never ask Brett to paste code
- Any missing access is Claude's problem to solve or clearly flag BEFORE starting work, not mid-task
- Brett makes decisions. Claude executes. The moment a decision is made, Claude takes it to completion.
This does NOT override Brett's involvement in decision-making. It only applies to execution after a decision is made.

**PAT-028: USE CURRENT DOCUMENTATION FOR ALL EXTERNAL SERVICES — MANDATORY**
Before working with any external app, site, API, or service (QuickBooks, GitHub, Intuit, Cloudflare, Google, etc.), Claude must search for and reference the most current official documentation. Do not rely on training data alone — processes, endpoints, field names, and requirements change. This applies to: API setup flows, OAuth procedures, webhook formats, form field requirements, secret management, and any multi-step external process. Always get ahead of the current state of the platform before advising Brett on steps.

**PAT-027: NEW GOOGLE SHEET SHARING — MANDATORY REMINDER**
Any time a new Google Sheet is created for use with the BrettOS system, Claude must immediately remind Brett to share it with the service account:
`brett-os-sheets@brettos-502323.iam.gserviceaccount.com` (Editor access)
Without this, GitHub Actions sheet-ops will fail silently. This reminder must appear before any sheet operations are queued.

---

**PAT-030: TASK-SCOPED LEAN CONTEXT LOADING — MANDATORY**
Load only what the task needs, not everything. The `brett-context` loader is **two-tier** (as of July 21, 2026):
- **Always-load** the small governing set: this doc, Best Practices, CREDENTIALS_MAP, VENTURES, FEATURE_LOG, the private `00_INDEX.md`, and the **Quick Index** blocks at the top of BACKLOG + CAPTURE_INBOX.
- **Lazy-load** full BACKLOG/CAPTURE entries, HANDWRITING_KEY, and venture briefs only when the task touches them (grep the ID/topic first).

Guardrail that keeps it lossless: keep FEATURE_LOG loaded and grep BACKLOG+CAPTURE for the venture/topic before any build/debug, so you never act on partial context. The **`brett-flow`** skill carries the full method (mode dispatch, subagent read-recipes, build/debug flows, session close). Measured July 21: ~95% less context read at equal answer quality. Match effort to task — skip the ceremony on trivial lookups.

**Claude's skills (as of July 21):** `brett-context` (loads WHO/WHAT, two-tier) + `brett-flow` (governs HOW: build, debug, efficiency) + `ridgeco-map` (maintains context/CODEMAP.md — the code index) + `brett-amplify` (idea-amplifier ideation layer). brett-flow/ridgeco-map/brett-amplify augment, never replace, brett-context.

---

## SECTION 7: SESSION LOG

| Session | Date | Key Deliverables |
|---|---|---|
| Session 0 | July 2026 | Initial context doc, Ridge Co Maintenance Hub foundation |
| Session 1 | July 16, 2026 | Invoice Review screen, vendor reassignment searchable dropdowns, vendor.html rate fix (PAT-021), worker.js Invoice Review endpoints, index.html + vendor.html pushed to GitHub, PAT-024/025/026 added |
| Session 2 | July 19, 2026 | Handwriting-training system built: seeded HANDWRITING_KEY + live-capture confirm-and-log loop (grew v1.0→v1.7). Parsed 7 handwritten notes (Scans 2019–2105) → CAP-012 through CAP-017; graduated to-dos/features to BACKLOG B-034 through B-072 across ventures. Highlights: Cesar Mon follow-ups (56 S Culver St + Gibbons), Ray (NJ) $5k van-toll receivable → EZ-Pass→invoice automation (CAP-001 sub-thread), Federal St off-Hub invoicing gap, urgent Vanity FB lead, parcel-locker lock-code category, trade/repair standards + opportunistic-task engine (track-don't-gate rec), content-creation plan (CAP-013/015). Glyph patterns logged: U-Haul↔HALL, detector↔deduct, capital-M↔"AA", Name+Street shorthand. |
| Session 3 | July 21, 2026 | **Efficiency + planning day.** (1) Built the **brett-flow** skill (build/debug/efficiency methodology; augments brett-context) + ran a with/without eval (~95% less context read, equal quality). (2) Made context loading **two-tier** (PAT-030): Quick Index blocks atop BACKLOG+CAPTURE, updated the brett-context loader. (3) Planned the **Ridge Co big build**: pulled all wishlist items (RidgeCo Main Wishlist tab = 76 items + BrettOS task app), mapped the Hub architecture (single sendSMS chokepoint; no cron; no email path; status lists duplicated ~7x; no recurring/split), added **B-093..B-102**, produced a phased build plan. Diagnosed the BrettOS sync **HTTP 401** (July 20 secret-rotation regression, B-092). Locked build decisions: quick-wins → security (phone-only login) → status SSOT → Cron → Phase 1 notifications (hold-SMS-til-8am, email deferred); UI redesign = Phase 4. |
| Session 4 | July 21, 2026 | **Skills + code map.** Researched 4 community tools (Graphify/Headroom/Omniroute/Brainstorming) → skipped all as ill-fit for the single-file/mobile/Cowork stack; adapted the useful ideas into two custom skills instead. Built **ridgeco-map** (generates/maintains context/CODEMAP.md) + **brett-amplify** (idea-amplifier ideation layer, per Brett's "supercharge my own ideas" directive); delivered as .skill files, Brett saved both. Ran ridgeco-map → generated + pushed **CODEMAP.md v1.0** (≈120 endpoints, helpers, Hub+vendor screens, Sheet-tab reverse index) via subagent fan-out. Map surfaced 3 doc drifts: vendor PIN is 8-char not 4-digit (PAT-016 stale — flag for B-093 security build), /sms-inbound is PUBLIC, route names un-hyphenated. |

---

*v1.11 — July 21, 2026 | Load at the start of every session*
