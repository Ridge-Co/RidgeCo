# Current Context Files — Ridge Co / Brett AI

These are the authoritative files Claude must read at the start of every session.
Read ALL files before doing any work.

| File | Version | Description |
|---|---|---|
| Brett_Context_Document_v1.9.md | v1.9 | Brett's ventures, stack, Ridge Co details, full PAT library (PAT-001 through PAT-029), Session 2 log |
| Brett_Cowork_Best_Practices_v1.3.md | v1.3 | Session workflow, common mistakes, how to work with Brett |
| CREDENTIALS_MAP.md | v1.2 | Every service, auth method, secret location, access status. QB CONNECTED (prod); deploy pipeline reality |
| VENTURES.md | v1.0 | Every venture — current state, stack, Claude access level, automation gaps |
| FEATURE_LOG.md | v1.1 | What's working — check before every code change to prevent regressions |
| BACKLOG.md | v1.13 | Master backlog across all ventures — priorities, in progress, completed |
| CAPTURE_INBOX.md | v1.13 | Brett's zero-friction brain-dump inbox — CAP items, links to backlog, open questions. Read every session. |
| HANDWRITING_KEY.md | v1.8 | Reference for reading Brett's handwritten-note photos; grows over time. Seeded vocab + confirmed live reads from Scan_2019/2020/2030/2032/2104/2105_1/2105_2/2105/1338. |

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
| CREDENTIALS_MAP v1.2 + FEATURE_LOG v1.1 (engineering session) | July 19, 2026 | **BIG DAY.** (1) Fixed the silently-broken Cloudflare deploy — Worker hadn't auto-deployed in days; wired Workers Builds + `wrangler.toml` (keep_vars). (2) Hub fixes now LIVE: void re-render, **WO_ID matching** (status-not-saving root cause), bill→Complete automation. (3) **QuickBooks CONNECTED (production)** — realm 9130355695406136 (Saint Thomas Ventures LLC DBA Ridge Co); created 10 trade income accts + 12 items; `QB_TRADE_MAP` locked in worker.js. (4) Confirmed status lifecycle (…Invoiced→Pending Payment→Paid by Customer→Paid) + payment model 1+2 (worklist+deep-links+webhook auto-flip, overpay guard). Next (July 20): Send-to-QuickBooks invoice/bill/payment build (preview-first). |
