# Current Context Files — Ridge Co / Brett AI

These are the authoritative context files. As of July 21, 2026 the `brett-context` loader is **two-tier**
(for token efficiency without loss — see the ✅ ALWAYS / ⏳ ON-DEMAND column):

- **✅ ALWAYS-LOAD** the small governing set every session — these keep Claude correct and are cheap.
- **⏳ ON-DEMAND** the big files only when a task needs them (grep the topic/ID first). BACKLOG and
  CAPTURE_INBOX each carry a **Quick Index block at the top** that IS always-loadable; read the map,
  open a full entry only when needed. Guardrail: before any build/debug, keep FEATURE_LOG loaded and
  grep BACKLOG+CAPTURE for the venture/topic so you never act on partial context.

| File | Version | Load | Description |
|---|---|---|---|
| Brett_Context_Document_v1.11.md | v1.11 | ✅ ALWAYS | Brett's ventures, stack, Ridge Co details, full PAT library (PAT-001 through PAT-030), Session 4 log |
| Brett_Cowork_Best_Practices_v1.3.md | v1.3 | ✅ ALWAYS | Session workflow, common mistakes, how to work with Brett |
| CREDENTIALS_MAP.md | v1.2 | ✅ ALWAYS | Every service, auth method, secret location, access status. QB CONNECTED (prod); deploy pipeline reality |
| VENTURES.md | v1.0 | ✅ ALWAYS | Every venture — current state, stack, Claude access level, automation gaps |
| FEATURE_LOG.md | v1.5 | ✅ ALWAYS | What's working — check before every code change to prevent regressions |
| BACKLOG.md | v1.23 | ⏳ index always, detail on-demand | Master backlog across all ventures. Quick Index block at top (always-load); full entries on demand. |
| CAPTURE_INBOX.md | v1.22 | ⏳ index always, detail on-demand | Brett's brain-dump inbox — CAP items. Quick Index block at top (always-load); full entries on demand. |
| HANDWRITING_KEY.md | v1.10 | ⏳ ON-DEMAND | Reference for reading Brett's handwritten-note photos (load only for handwriting tasks). Seeded vocab + confirmed live reads from Scan_2019/2020/2030/2032/2104/2105_1/2105_2/2105/1338 + Scanned_202607211020/1341. |
| CODEMAP.md | v1.0 | ⏳ ON-DEMAND (build/debug) | BrettOS code map — ≈120 Worker endpoints (handler→Sheet tab→auth), helper/chokepoint index, index.html + vendor.html screen maps, and a Sheet-tab reverse index. Load for any Ridge Co build/debug or "where does X live" task instead of reading worker.js/index.html in full. Maintained by the `ridgeco-map` skill; refresh after structural code changes. |

## PRIVATE / SENSITIVE CONTEXT (NOT in this public repo)

Some context is too sensitive for this **public** repo (personal finances, competitive strategy). It lives in Google Drive and must be read via the **Drive connector** (as `info@bmoremanagement.com`) at the start of any session where it's relevant. This is the durable pointer:

| Doc | Drive file ID | Covers |
|---|---|---|
| Brett_Vision_and_CHEP_Private_v1.1 | `1KFI6l4qtZft3kbKaXxLfbwBeYGxV86UmpqENGRD3xl8` | Brett's founding vision/motivation + Winchester Hauling / CHEP pallet-recycling plan, mined from his ChatGPT export. Contains personal figures + competitive strategy — **keep out of the public repo.** |

To read it: Drive connector → `read_file_content(fileId)`. Parent folder: "Brett AI Context" (`1iFFIwzUN4EKhJEgfCAqlUdkt8cyMNClX`). Note: the Drive connector may be unavailable in headless/scheduled runs — that's fine, this brief isn't needed for automated tasks.

## How to update these files

When a new version is needed (new PAT, new project details, etc.):
1. Create the new versioned file (e.g., Brett_Context_Document_v1.9.md)
2. Update this CURRENT.md table to point to the new version
3. Push both files to GitHub
4. The old versioned file stays in /context/ as history — do not delete

## Version history

| Version | Date | Change |
|---|---|---|
| Context v1.8 | July 16, 2026 | PAT-026 added, full Ridge Co Session 1 details |
| Best Practices v1.3 | July 16, 2026 | Section 11 (PAT-026 version naming) added |
| CREDENTIALS_MAP v1.0 | July 17, 2026 | Initial credentials map — Sheets, GitHub, Cloudflare, QB, Drive |
| VENTURES v1.0 | July 17, 2026 | Initial ventures overview — Ridge Co, BrettOS, BarrelCo, Cabin, Winchester Hauling |
| PAT-029 | July 17, 2026 | Claude self-sufficiency mandate — execute without asking Brett for manual steps |
| Capture Inbox v1.0 | July 18, 2026 | Capture layer created — CAP-001..008 (vans/Kingbee, receipts automation, Turo, cash-flow north star, compliance, registration, entity) |
| CREDENTIALS_MAP v1.1 | July 18, 2026 | GitHub token reality clarified — push needs Brett's pasted classic PAT; never store token in this public repo |
| HANDWRITING_KEY v1.1 | July 19, 2026 | Seeded known vocabulary (vendors, sites, entities, fleet/Turo terms, shorthand); confirmed live-capture learning approach (no calibration sheet) |
| HANDWRITING_KEY v1.2 + CAPTURE_INBOX v1.1 + BACKLOG v1.3 | July 19, 2026 | First live captures: Scan_2019 (plumber/handyman sourcing) → CAP-012 + B-034/035/036; Scan_2020 (content-funnel plan) → CAP-013 (parked). Logged confirmed reads (Marvin, Al Stratti, Rob Whitley, Oscar Culver=56 S Culver St job, Cesar $300 floor) + capital-M/strike-through/Name+Street glyph patterns. |
| HANDWRITING_KEY v1.3 + CAPTURE_INBOX v1.2 + BACKLOG v1.4 | July 19, 2026 | Batch 2 corrections: Culver job → Cesar (Mon follow-up) + Gibbons jobs (B-037); $300 floor relabeled to 807 N Calvert St bakery install (not Culver, B-036). Journey/FI/A.S.Q. content → CAP-013. Handwriting-only reads logged (Scan_2030 FB yard-sale groups, Scan_2032 pay Cesar/Potomac Edison/toilet/floor, Scan_2032_1 ledger 170 / Oscar 450 3014, making-not-nailing). |
| HANDWRITING_KEY v1.4 + CAPTURE_INBOX v1.3 + BACKLOG v1.5 | July 19, 2026 | Scan_2104 (TOPS legal-pad master to-do list) → CAP-014, fully classified; active items → B-038..B-050 (MD taxes, LLC renewal 1864 Kerns School Rd, tenant updates, invoice batch Bakery/153#2/2930 detector, Sergio pay, QB 1st-hour $75 billing, etc.). Glyph reads: U-Haul↔HALL, detector↔deduct. New people: Gina/William/Julie/Jenn/Jen/Mark/Amanda; vendor Sergio. Scans 2-4 of this batch still pending (one at a time). |
| HANDWRITING_KEY v1.5 + CAPTURE_INBOX v1.4 + BACKLOG v1.6 | July 19, 2026 | Scan_2105_1 ("Fix What Bugs Me") → CAP-015 capture-system vision; features → B-051..B-054 (daily digest, voice→sheet, multi-step tags, context/location-aware surfacing). Confirmed "tags" not "flags". Scans 3-4 still pending. |
| HANDWRITING_KEY v1.6 + CAPTURE_INBOX v1.5 + BACKLOG v1.7 | July 19, 2026 | Scan_2105_2 (lock-code note) → CAP-016 parcel-locker category (shareable-with-tenant) + tasks B-055 (feature) / B-056..B-058 (batteries 3014&2930, install @115, record changes 3014#3/#1, 1214#3). "capture vs do" design principle → CAP-015 (ties to CAP-010 Equipment Registry). Scan 4 still pending. |
| Context Document v1.9 | July 19, 2026 | Session 2 log row added (handwriting-training system + 7-note capture batch). v1.8 stays in /context as history. |
| HANDWRITING_KEY v1.7 + CAPTURE_INBOX v1.6 + BACKLOG v1.8 | July 19, 2026 | Scan_2105 (mixed list) → CAP-017 + B-059..B-072. Highlights: Ray (NJ) holds a van, $5k behind → weekly EZ-Pass→invoice automation (CAP-001 sub-thread, B-065/066); Federal St job off-Hub (B-068); Vanity FB lead 🔴 (B-071); Fait Ave/St owner payment+leaks (B-069/070); trade/repair standards + opportunistic-task engine (B-072, track-don't-gate rec). Corrections: Knock/Fait/Vanity/Ray's tolls/box co Re Spoon/Federal. **Handwriting-training batch complete (7 notes, Scans 2019–2105).** |
| CAPTURE_INBOX v1.8 + BACKLOG v1.10 | July 19, 2026 | Resolved CAP-018 item 8 — parents in Waynesboro VA store/sell planters+barrels to FB buyers locally (free secondary market); future AI-coordinated fulfillment → B-083 (UX for non-tech-savvy mother). |
| CAPTURE_INBOX v1.9 (+ private Drive doc) | July 19, 2026 | Ingested Brett's ChatGPT export (174 convos) → founding-vision + Winchester Hauling/CHEP synthesis. Stored in PRIVATE Google Doc (Brett_Vision_and_CHEP_Private_v1.1, id 1KFI6l4qtZft3kbKaXxLfbwBeYGxV86UmpqENGRD3xl8) — see PRIVATE CONTEXT pointer. CAP-019 logs it. CHEP now authorized per Brett. |
| HANDWRITING_KEY v1.8 + CAPTURE_INBOX v1.7 + BACKLOG v1.9 | July 19, 2026 | Scan_1338 (AI/automation vision list) → CAP-018 + B-073..B-082: properties onboarding site, lead-finder Chrome extension, Hub UI → Fairfax estimate look, estimate-acceptance workflow, preventive-maintenance package, BarrelCo inventory (Community Forklift), retail-outlet tracker, FB Marketplace/listing automation (rebuild "Nerdy Panda"), non-botty lead capture, Cesar mirror site. Open ❓: parents' roles. |
| Receipts pipeline design (CAP-002/020/021) | July 19, 2026 | Designed the receipt automation: intake = PAYABLES Inbox>Receipts and Invoices; filing = Vendors shared drive (0AIt2A2J2j6aFUk9PVA). Make.com dead (receipts stuck since 2025) → rebuild on QB API. Confirm-first queue w/ 3 categories (customer WO / owned-property e.g. 1864 Kerns STR / BMore business expense), hand-written-marking-first + learned vendor-defaults (Advance Auto→BMore). Builds B-084..B-089; toll-forwarding automation (GiddyUp/Kingbee by plate/VIN, EZ-Pass exception) CAP-020/B-087; HSA future CAP-021/B-089. |
| FEATURE_LOG v1.4 — Work_Orders schema corrected | July 21, 2026 | **Correction to the July 19 entry below.** There is no `WO_ID` column on Work_Orders. The real key is `ID` at **index 1**; index 0 is `Vendor_Needs_Access` (blank/"auto"). The July 19 "WO_ID matching" fix looked up a column that returns `-1` and fell back to `r[0]`, so vendor/status writes returned `success:true` and silently changed nothing, and `createWorkOrder` found no numbers and restarted every new WO at **WO-1001**. Both fixed by resolving the key column by header name (`idColIndex()` / `findWO()`). Also fixed: `w.WO_ID === id` matched the *first* WO whenever the id was omitted (`undefined === undefined`) — 9 call sites. Missing `Receipts` and `WO_Audit` tabs created. Rule 6 rewritten. |
| brett-flow skill + with/without eval | July 21, 2026 | Built the **brett-flow** methodology skill (build/debug/efficiency; augments brett-context). Eval: ~95% less context read at equal answer quality. Two skills now: brett-context (WHO/WHAT) + brett-flow (HOW). |
| Context Document v1.10 + PAT-030 | July 21, 2026 | **PAT-030** (task-scoped lean loading) added; Session 3 log row. v1.9 stays in /context as history. |
| HANDWRITING_KEY v1.10 + CAPTURE_INBOX v1.22 + BACKLOG v1.23 (2-note pre-overhaul capture) | July 21, 2026 | Processed Scanned_202607211020 + …1341 → **CAP-027/028** + **B-104..B-123** (STR cleaner scheduling + Cabin dashboard app, long-term lease mgmt, dispatch tool w/ 3014-washer pilot, vendor equipment tracking + schedule prefs [feeds Phase-1 B-093/094], WO-as-site/PDF sharing, property-DB intake, inspector app for "Phoenix"❓, websites+SEO, FB overhaul/group, background-agents directive). 4518 Fairfax lockbox code stored PRIVATELY (property-maintenance.md). ❓ open: 928 street=Calvert?, referral name spellings, "Phoenix". |
| BACKLOG v1.21→v1.22 + CAPTURE_INBOX v1.21 (big-build planning) | July 21, 2026 | Pulled ALL wishlist (RidgeCo Main Wishlist tab = 76 + BrettOS task app) via Drive; added **B-093..B-102** + CAP-026; **escalated B-092** (BrettOS sync HTTP 401 from July 20 secret rotation); mapped Hub architecture; locked July 22 build decisions (quick-wins→security[phone-only]→cron→notifications[hold-til-8am]; UI=Phase4). |
| Two-tier loading + Quick Index (BACKLOG v1.20 + CAPTURE_INBOX v1.20 + CURRENT.md) | July 21, 2026 | **Efficiency without loss.** brett-context loader made two-tier: ✅ always-load the small governing set (Context Doc, Best Practices, CREDENTIALS_MAP, VENTURES, FEATURE_LOG, private 00_INDEX) + the new **Quick Index** blocks at the top of BACKLOG & CAPTURE; ⏳ lazy-load full BACKLOG/CAPTURE detail, HANDWRITING_KEY, and venture briefs only when a task needs them (grep first). Guardrail: keep FEATURE_LOG loaded + grep BACKLOG+CAPTURE before any build/debug. Measured (brett-flow eval): ~95% less context read at equal answer quality. Pairs with the `brett-flow` skill. |
| CREDENTIALS_MAP v1.2 + FEATURE_LOG v1.1 (engineering session) | July 19, 2026 | **BIG DAY.** (1) Fixed the silently-broken Cloudflare deploy — Worker hadn't auto-deployed in days; wired Workers Builds + `wrangler.toml` (keep_vars). (2) Hub fixes now LIVE: void re-render, **WO_ID matching** (status-not-saving root cause), bill→Complete automation. (3) **QuickBooks CONNECTED (production)** — realm 9130355695406136 (Saint Thomas Ventures LLC DBA Ridge Co); created 10 trade income accts + 12 items; `QB_TRADE_MAP` locked in worker.js. (4) Confirmed status lifecycle (…Invoiced→Pending Payment→Paid by Customer→Paid) + payment model 1+2 (worklist+deep-links+webhook auto-flip, overpay guard). Next (July 20): Send-to-QuickBooks invoice/bill/payment build (preview-first). |
| ridgeco-map + brett-amplify skills (Session 4) | July 21, 2026 | Built two custom skills after researching 4 community tools (Graphify/Headroom/Omniroute/Brainstorming — all skipped as ill-fit; ideas adapted instead). **ridgeco-map** generates/maintains CODEMAP.md; **brett-amplify** is the idea-amplifier ideation layer. Delivered as .skill files, Brett saved both. |
| CODEMAP.md v1.0 + CURRENT.md (loader wiring) | July 21, 2026 | Generated `context/CODEMAP.md` (full endpoint/helper/screen/tab-reverse index) via ridgeco-map + subagent fan-out; pushed. Added to CURRENT.md as ⏳ on-demand for build/debug. Surfaced 3 doc drifts: vendor PIN is 8-char not 4-digit (PAT-016 stale — matters for B-093 security build); /sms-inbound is PUBLIC; route names un-hyphenated. |
| Context Document v1.11 | July 21, 2026 | Session 4 log row (skills + CODEMAP). v1.10 stays in /context as history. |
| FEATURE_LOG v1.5 | July 21, 2026 | Vendor PIN row corrected to 8-char; rule 17 added (/sms-inbound public; CODEMAP is the route/tab index of record). |
