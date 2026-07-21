# BrettOS Capture Inbox
**Version:** v1.22 | **Last Updated:** July 21, 2026
**Rule:** This is Brett's zero-friction brain-dump inbox. Brett captures thoughts in any form (typed, pasted, voice, photo of handwriting, forwarded email). Claude parses every dump into structured items here, links them to existing plans/backlog, extracts hidden sub-projects, and flags open questions. Items "graduate" to BACKLOG.md or a business plan once they become real work.

---

<!-- QUICK-INDEX:START — always-loadable map; full entries below; grep an ID to jump to detail -->
## Quick Index
_Compact map of every capture item. Read THIS map on load (two-tier loading); open a full entry below only when a task needs it — grep the ID._

- CAP-001 — Cargo van fleet / Kingbee exit (NEW venture — likely a 6th lane under BMore Management)
- CAP-002 — Materials-receipt automation (Ridge Co — part NEW, part planned)
- CAP-003 — Turo vehicle rentals (NEW lane — surfaced from calendar reminders)
- CAP-004 — Entity note: BMore Management is the parent (INFO)
- CAP-005 — Compliance-notice auto-forward automation (vehicles — NEW, high value)
- CAP-006 — Vehicle registration & renewal tracker (NEW)
- CAP-007 — CASH-FLOW CRUNCH (STRATEGIC NORTH STAR — read before prioritizing anything)
- CAP-008 — Entity structure + active GL insurance switch (INFO + near-term to-do)
- CAP-009 — Fleet/vehicle filing model (DECISION — apply everywhere)
- CAP-010 — Database-integrated repair gems + tenant self-help system (PLAN)
- CAP-011 — RidgeCo Hub "one ring" punch list (WO-1053 session, July 18)
- CAP-012 — Plumber / handyman sourcing (Ridge Co — NEW, active)
- CAP-013 — Content-creation venture / marketing funnel (NEW lane — PARKED, long-term)
- CAP-014 — Master operational to-do brain-dump (Ridge Co + admin — mostly NEW, active)
- CAP-015 — Capture / assistant system vision — "Fix What Bugs Me" (BrettOS — NEW, active)
- CAP-016 — Lock-code registry: parcel-locker category + tasks (Ridge Co Hub — feature + tasks)
- CAP-017 — Mixed brain-dump: fleet receivable, jobs, BarrelCo, standards vision (multi-venture)
- CAP-018 — AI/automation vision: onboarding, lead-gen, BarrelCo listings, Cesar mirror (multi-venture)
- CAP-019 — ChatGPT export ingested → founding vision + Winchester Hauling/CHEP brief (stored PRIVATELY)
- CAP-020 — Vehicle toll / violation forwarding automation (Turo→GiddyUp, vans→Kingbee — NEW)
- CAP-021 — HSA receipt automation (FUTURE — personal)
- CAP-022 — Vehicle RECALL forwarding + unified vehicle-notice router (NEW)
- CAP-023 — BarrelCo leads database (retail-outlet leads — NEW, activates B-079)
- CAP-024 — Surface captures/tasks in a BrettOS Sheet (accessible + bulk-actionable — NEW)
- CAP-025 — Reconcile with the REAL BrettOS task app (sheet 1X2oYjD) — IMPORTANT
- CAP-026 — Ridge Co big-build planning + full wishlist consolidation (Ridge Co — planning)
- CAP-027 — Pre-overhaul brain-dump, note 1 (Scanned_202607211020): STR cleaner scheduling, long-term leases, dispatch tool, property tasks, websites+SEO (multi-venture — NEW) → B-104..B-115, B-119..B-122
- CAP-028 — Pre-overhaul brain-dump, note 2 (Scanned_202607211341): WO-as-site/PDF sharing, Second Brain, vendor-text mining, property DB, inspector app, STR dashboard app, background agents, vendor equipment + schedule prefs (multi-venture — NEW) → B-113..B-123
<!-- QUICK-INDEX:END -->


## HOW IT WORKS

**Capture surface (Brett's side — must stay frictionless):**
- Dump into the Claude app in any form — type it, paste a Google Keep note, send a voice note, or **snap a photo of handwritten paper**. Capture and parsing happen in one step.
- No structure required. Ramble. One thought can contain five projects — that's Claude's job to untangle.

**Parse layer (Claude's side):**
- Every dump becomes one or more CAP items using the schema below.
- Claude links each item to existing backlog IDs or plans, and flags NEW work.
- Claude surfaces clarifying questions inline (`❓`) rather than blocking the capture.
- Handwriting readings get logged to `HANDWRITING_KEY.md` so OCR + context improve over time.

**Item schema:**
```
### CAP-### — <short title> (<venture> — NEW / links to <ID>)
- Raw: what Brett actually said/wrote
- Type: idea | bug | wishlist | project | task | decision-needed | info
- Status: new | linked | in-plan | graduated | killed | parked
- Sub-items: discrete work extracted from the dump
- Links: BACKLOG IDs / plan references
- ❓ Open questions for Brett
```

---

## ACTIVE ITEMS

### CAP-001 — Cargo van fleet / Kingbee exit (NEW venture — likely a 6th lane under BMore Management)
- Raw: Wants the vans OFF the Kingbee platform onto long-term leases (lease plan exists). One van trapped in Austin, TX under a mechanic's lien.
- Findings (from Gmail thread review, July 18):
  - Fleet = Ram ProMaster cargo vans (VINs 3C6LRVDG…), owned by Brett, monetized on Kingbee's "Hive Network" platform (Kingbee Rentals LLC; 1099 issued via Stripe for 2025). Passive fleet-income model — Kingbee rents them out, Brett receives monthly distributions per a Vehicle Management Agreement (VMA), net of costs/repairs.
  - Exit deal in motion: emailed **Paulo (cohadoconnect@gmail.com)** on Jul 17 — "Cargo Van and Other Vehicle Lease-To-Own Opportunity," with a spreadsheet + high-level program. THIS is the lease plan.
  - Pattern: Brett is *constantly* contesting Kingbee charges. Open/recent disputes:
    - **Fluid Truck Restitution (Feb):** Kingbee claims a $11,037 restitution balance from the Fluid estate under VMA Section 7. Brett disputes — one van pulled for mileage (only 75k), another under mechanic's lien; neither was "on platform in rentable condition."
    - **Mechanic's lien van (the Austin, TX one):** under lien for an accident repair never paid to the mechanic. Needs resolution to free/decommission.
    - **Repair-charge disputes (May, VIN P5531):** billed for damage that should be renter/wear-and-tear.
    - **Renewal issue (Apr, P4037):** DMV renewal denied — unpaid violations / flag fee.
    - **Insurance scare (Jun):** alleged coverage lapse (resolved, no real lapse) but needed documentation for Maryland MVA.
    - **Decommissioning (Jan):** requested status/location of all vans; started decommission of VIN …0444. Kingbee sent a full status table Jan 13 — pull it for the roster.
- Type: project (multiple)
- Status: new
- Sub-items:
  1. Review & pressure-test the Kingbee→lease-to-own program (the Paulo spreadsheet/plan)
  2. Resolve the mechanic's lien and free the trapped van
  3. Dispute/resolve the $11,037 Fluid restitution claim (read VMA Section 7)
  4. Fleet baseline: full roster — VIN, location, status, on/off platform, decommission status
  5. Reconcile Kingbee monthly "Hive Network Reporting" statements (many unread PDFs) → real net income per van
  6. **Ray Lewis (NJ) — private-party van**: a former friend in NJ holds one of Brett's cargo vans off-platform, never pays on time/in full — **$5k behind** on the bill/tolls. Automate weekly EZ-Pass toll pull → auto-invoice Ray Lewis. Recalls/vehicle notices for this van go to Ray Lewis directly (tolls = EZ-Pass). Ray Lewis = **Lewis Drums** (accounting@lewisdrums.com, rlewis@lewisdrums.com). His van = **AUP134** (VIN 3C6LRVDG3NE133610). (See CAP-017, B-065/B-066.)
  - **FLEET ROSTER SOURCED (July 19, sheet `11HVkmGOKhTveAXGajs0_pTOkPaZk6HXxZmx1h2wz_nY`):** 8 cargo vans + 2 Turo cars. Holders — **KingBee ×6** (P1142, P6180, P1624, P5531, P4037, P4057), **LIEN ×1** (AUP135, Austin — mechanic's-lien van, Brett to resolve), **Ray Lewis ×1** (AUP134, NJ, flagged DEC1.2 recommend-decommission), **Giddyup ×2** (ST01 Chevy Tahoe, ST02 Toyota Tacoma). Cross-refs: P5531=repair-charge dispute, P4037=DMV renewal issue, P4057 (…0444)=decommission-started, AUP135=Austin lien, AUP134=Ray's NJ van. Plates in "MD Tag #" (2FH90xx). This is the router's source of truth (B-087/B-090).
- Links: NEW venture candidate — "BMore Fleet" (parent entity: BMore Management)
- ❓ Full exit (sell/lease-to-own ALL vans) or keep some on-platform while transitioning?
- ❓ How many vans total right now, and how many already decommissioned?
- Added July 18 (voice dump):
  - The insurance issue is actively **restricting Brett's ability to register the vans** — not cosmetic.
  - MD constraint: Maryland requires **fleets of ≤10 vehicles to be managed IN PERSON at the MVA** (no online/email fleet management). Resolving registration/insurance flags likely means Brett physically going to the MVA, probably paying a fine there, then **billing that cost back to Kingbee** (their mismanagement/lack of urgency caused it — unless it's genuinely Brett's action/inaction, then it's on him).
  - Documentation discipline: Kingbee says "it's fine," but Brett always demands written proof — that's how he learned the insurance problem is still unresolved despite their assurances. Rule: **nothing is resolved without written documentation.**
  - Persistence rule: track each notice/fine **until resolved in writing**, even if the van later comes off the Kingbee platform — a fine can still stem from Kingbee's action/inaction while it was on-platform.

### CAP-002 — Materials-receipt automation (Ridge Co — part NEW, part planned)
- Raw: Wants to scan a receipt (or grab it from email), auto-match it to the property + open work order, file it to the WO folder, and never touch it again after the initial scan. Then feed it to QuickBooks as an expense, match materials to jobs, and — when a full invoice payment lands — trigger an end-of-week batch payment to the credit card those purchases sat on, to keep card balances in check.
- Type: project (pipeline)
- Status: new
- Sub-items:
  1. Capture: receipt scan OR pull from email → extract line item *(NEW)*
  2. Match PO/Job name → property in DB → open work order at that property *(NEW matching logic)*
  3. Auto-file to that WO's Drive folder *(builds on existing subfolder structure — working)*
  4. Hands-off close: once labor is entered for the completed job, receipt is already attached; Brett never touches it again *(NEW — core behavior)*
  5. Feed to QuickBooks as an expense *(ties to B-002 QB bill recording)*
  6. Match materials → jobs; on full invoice payment, trigger end-of-week batch payment to the associated credit card *(NEW — card-balance control)*
- Links: BACKLOG B-001, B-002, B-005, B-007
- ❓ Which credit card(s) are used for materials, and does the "batch payment" need to actually execute a payment or just stage/notify?
- Added July 19 (Brett's current process + the missing step):
  - Current flow: (1) scan receipt via phone app → straight into a Google Drive folder; (2) that Drive folder is *supposed* to auto-email the receipt to QuickBooks for reconciliation — **NEEDS VERIFICATION** (Brett unsure it's firing); (3) rename the file + file it under the vendor (Home Depot, Lowe's, etc.).
  - NEW step to add: **check whether the charge has already been posted to the relevant customer**, and if NOT, **post it to the relevant work order** (so it flows into the customer's invoice). Must avoid double-posting.
  - Enabler: **QuickBooks is now CONNECTED (prod, July 19)** — the posting side is buildable (ties B-015).
  - Constraint: **Drive MCP can't rename/move/delete** — automated rename + file-to-vendor must run via Google Apps Script or GitHub Actions, not the Drive connector.
  - DIAGNOSIS (July 19, via Drive inspection): the intake folder is **"WO Receipt Inbox"** (id `1BpJXcOlW98Qdq0nZf-sBa40-3vQ8Lzwc`). It holds **10+ receipts stuck from Aug–Dec 2025** (latest: Waverly Ace Hardware, Dec 8 2025), none moved to a "processed" subfolder or filed by vendor → confirms Brett's **Make.com** scenario (watch folder → batch-email to QB → move to "processed") **is dead/stalled.** The "email trigger" was actually this Make.com scenario, not a QB feature. **Recommendation: retire Make.com** — now that the QB API is connected, do QB posting + file moves inside the Hub pipeline (B-084) via API + Apps Script. The stuck 2025 receipts may never have reached QB → reconcile (B-086).
  - RESOLVED (matching design, July 19): **confirm-first matching.** OCR pulls vendor/date/total/line-items + any property/PO/WO markings. System narrows candidates — WO# present → exact match; only property present → that property's OPEN work orders; nothing → best guesses (vendor+date+amount vs. open WOs). Brett always taps to confirm/correct (he moves fast and tags inconsistently; PO may carry the property but not the WO#). Surfaces as a **Hub "Receipts to file" queue** (one tap per receipt) → posts to WO **preview-first**, with the customer-charge check to prevent double-billing. Builds: **B-084** (queue + WO posting), **B-085** (retire Make.com / API pipeline).
  - Folders (corrected July 19): **INTAKE = PAYABLES Inbox > "Receipts and Invoices"** (created, id `1-sf6pQN2DD3qj5cPZavy1k0DOfH4U20n`) — scan here. **FILING = the "Vendors" shared drive** (root `0AIt2A2J2j6aFUk9PVA`) > per-vendor subfolders (Home Depot, Penske, Giddyup, … + "No Vendor" catch-all). **Do NOT file into PAYABLES Inbox subfolders** — those were legacy manual sorting.
  - Classification branch (important): each receipt is either (a) **property/WO materials** (billable to a customer) or (b) a **business expense** (overhead). Home Depot was historically always WO-related; other vendors could be either. The confirm queue must let Brett pick the category; only customer WO-materials run the customer-charge + WO-post path; ALL go to QB + get filed by vendor in the Vendors drive.
  - Classification refinement (July 19) — **THREE categories**, not two:
    (a) **Customer WO materials** — billable to a customer, posts to the WO.
    (b) **Owned-property expense** — Brett's own properties/STRs (e.g. **1864 Kerns School Rd** STR, the WV Cabin) — apply to the property for tracking, NOT billable to a customer; often no WO.
    (c) **Internal business expense** — BMore Management (or another entity) overhead, no property. Brett shorthands these **"BMore"** (or a business name) on the receipt.
  - Read order per receipt: **(1) look for a hand-written property / WO# / "BMore" on the receipt first** → route to that; **(2) else use the learned vendor-default** (below); **(3) else ask** in the queue. Home Depot/Lowe's are NOT auto-property — a "BMore" note makes them a business expense.
  - LEARN — **vendor → default-category map**, refined as Brett confirms receipts. Seed: **Advance Auto Parts → BMore business expense** (default, NO further confirmation unless a property/WO is hand-written). Over time, tag other repeat vendors' obvious defaults so they auto-classify.
  - Owned property setup: **add 1864 Kerns School Rd (STR) to the WO system as a property** for tracking, even though its expenses usually have no WO → B-088.
  - Historical / no-WO receipts (Brett will cut-paste the old WO Receipt Inbox files into the new intake): no WO to attach → verify they were charged to a customer somewhere; if not, record appropriately; then rename + push to QB for reconciliation + file by vendor. (Confirmed good, July 19.)

---

### CAP-003 — Turo vehicle rentals (NEW lane — surfaced from calendar reminders)
- Raw: Recurring self-reminders show a **Chevy Tahoe** and **Toyota Tacoma** on Turo. Financing not on autopay — note reads Toyota ≈ $726/mo, Chevy ≈ $1,084/mo.
- Type: info / venture
- Status: new
- Findings (July 18 voice dump): Two rental cars (Chevy Tahoe, Toyota Tacoma) on Turo, **managed by a third party in Colorado**. Vehicles appear **registered in South Dakota** (confirm — see CAP-006). Same core problem as the vans: **revenue doesn't cover the payments.** Goal: move them off Turo onto **long-term lease-to-own** so payments come in directly and cover the bank loan.
- Type: venture / offload target
- Status: new
- ❓ Confirm which vehicles are SD-registered vs MD (are the Turo cars the SD ones, and the cargo vans the MD/MVA ones?).
- Manager (corrected July 18): current Turo manager = **GiddyUp** (Colorado). **Arslan / "TuroDone4You"** was the FIRST manager — folded almost immediately; treat as defunct (old Drive folder is historical only).
- ❓ Exit path from GiddyUp → long-term lease-to-own; and which entity owns the Turo cars (Global North, or another)?

### CAP-004 — Entity note: BMore Management is the parent (INFO)
- Raw: Signature block confirms BMore Management (Brett Lambert, "Chief More Manager," 410-777-8651, PO Box 39692 Baltimore, www.BMoreManagement.com) as the umbrella over the ventures. Ridge Co, the van fleet, and Turo all appear to sit under it.
- Type: info
- Status: new
- ❓ Confirm the entity structure so plans map to the right legal/financial buckets.

### CAP-005 — Compliance-notice auto-forward automation (vehicles — NEW, high value)
- Raw: Brett gets compliance/insurance/registration notices showing a van is out of compliance. He always saves the docs, but manually forwarding them to the responsible party (Kingbee) is tedious. Wants: capture the incoming notice → identify the vehicle → auto-forward to the right party → track until resolved in writing → nudge Brett ("is this handled?") if it stalls.
- Type: project (automation)
- Status: new
- Links: CAP-001; mirrors the CAP-002 pattern (capture → match → route → close loop)
- ❓ Standard recipients per notice type (Kingbee Hive Network? insurer? MVA?)?

### CAP-006 — Vehicle registration & renewal tracker (NEW)
- Raw: Needs, per vehicle: registration jurisdiction, last-renewed date, expiry date — so nothing lapses. Cargo vans = Maryland (in-person MVA). Turo cars = likely South Dakota. Believes registrations are current but isn't sure.
- Type: project (tracker)
- Status: new
- ❓ Confirm jurisdiction + last-renewed/expiry per vehicle (I can hunt renewal confirmations in the inbox).

### CAP-007 — CASH-FLOW CRUNCH (STRATEGIC NORTH STAR — read before prioritizing anything)
- Raw: The single biggest source of stress. Money flow: the cargo vans + Turo cars cost more in monthly payments than they earn → the shortfall lands on credit cards → **thousands/month in card interest alone** → compounding negative cash flow.
- The fix: convert vans + Turo cars from short-term platforms (Kingbee/Turo) to **long-term lease-to-own** so each vehicle self-funds its payment and stops bleeding; then aim freed cash + Ridge Co revenue at **paying down the credit cards** to kill the interest drag.
- Reprioritization implication: not just "grow Ridge Co." It's grow Ridge Co revenue **while** stopping the vehicle/credit-card bleed **in parallel** — two lanes, because the bleed compounds daily whether or not Brett can get to it.
- Type: strategy / constraint
- Status: active — governs all planning
- ❓ Numbers to make it real: total monthly vehicle payments, total card balances + blended rate, current monthly interest paid.

### CAP-008 — Entity structure + active GL insurance switch (INFO + near-term to-do)
- Findings: **Saint Thomas Ventures LLC** = the handyman/Ridge Co operating entity (carries the general-liability insurance). **BMore Management** = parent/brand. Business address **4709 Harford Rd Ste 43, Baltimore MD 21214**; PO Box 39692; USPS change-of-address filed July 17.
- Active to-do: switching GL insurance to **Luray Insurance (Stephanie)** — better policy, lower premium; monthly billing requires **automatic EFT**; docs sent to sign via **Formstack**. Needs Brett to sign + set up EFT.
- Type: info + task
- Status: new
- ❓ Confirm the full entity map (Ridge Co = Saint Thomas Ventures LLC? vans/Turo under which entity?).

### CAP-009 — Fleet/vehicle filing model (DECISION — apply everywhere)
- Decision (July 18): File vehicle assets by **OWNER at the top level** — cargo vans under **Global North Inc**; the current management company is a **VENDOR** with its own folder for manager-relevant items (**Kingbee** for the vans, **GiddyUp** for the Turo cars). Prior managers (**Fluid / FluidTruck**, **Arslan / TuroDone4You**) are historical/defunct folders, kept for reference only.
- Why: managers change (Fluid→Kingbee; Arslan→GiddyUp) but the owner is stable, so owner-based filing never orphans history on a manager switch.
- Type: decision / routing rule
- Status: active — feeds the document-routing map (CAP-005) and the routing build.

### CAP-010 — Database-integrated repair gems + tenant self-help system (PLAN)
- Vision: both repair gems tie into a per-unit **Equipment Registry + Repair History** so they cross-reference prior work.
  - Tech gem (Brett): "I'm at 2930 St Paul Apt 3 on the dryer — did we work on this?" → gem checks history (e.g., we did Apt 2 washer, not Apt 3), requests the data-plate photo if model unknown, records the model, troubleshoots, then outputs a summary for BOTH the invoice and the DB (so next time we know what we did).
  - Tenant gem: uses known model + history to guide safe self-help over chat/SMS; if an appliance has been serviced repeatedly, flags it to Brett as a replacement candidate instead of looping the tenant; captures the model and drafts a work order on escalation.
- Requires (NEW backlog): (1) per-unit **Equipment Registry** (appliance, make/model/serial, install date) + **Repair History** log in the Maintenance Hub; (2) a Hub endpoint the gems can query by unit+appliance and write back to; (3) the **tenant chat/SMS self-help channel**.
- Behavior requirement: gems diagnose like a veteran tech — rank suspects, test the fast/fatal ones first (e.g., ohm the compressor before chasing the whole system), but never condemn an expensive part before the killing test is confirmed. (Root of Brett's HVAC frustration.)
- Type: plan (spans Ridge Co + gem redesign)
- Status: new — Brett to add more detail; gem instruction drafts v1 delivered (Tech + Tenant).

### CAP-011 — RidgeCo Hub "one ring" punch list (WO-1053 session, July 18)
- Principle (Brett): the Hub is the single control surface — Brett must be able to do everything vendors/tenants/customers can, and more. Fill any gap found.
- WO-1053 findings (from live sheet): **bill is SAFE** — Vendor_Bills row **ID 5 ($225, Active TRUE)** is the live bill; row ID 2 ($225) was the duplicate, correctly voided (Active FALSE). Void worked; the Hub display failed to redraw the survivor. WO-1053 Drive folder is correctly parented under **"151 W Lanvale St"**, and its 3 photos are correctly tagged WO-1053 in Attachments — so the "2930 St Paul photos" is NOT a routing/DB error (needs image-content check to close out).
- FIXED (pushed July 18): void handler re-render was fragile DOM surgery → replaced with reliable `loadAll()+openWODetail()` refresh (mirrors quickStatusChange).
- OPEN Hub items to build next:
  1. **Admin bill entry** UI in Hub → POST `/vendor-bill/add` (backend already exists).
  2. **Undo / view+restore voided bills** → POST `/vendor-bill/update {Active:'TRUE'}` (backend exists). Covers the "undo" ask.
  3. **Dedupe** duplicate bill display + prevent vendor double-submit at source.
  4. **Internal vendor-instructions field** (visible to vendor, NOT on the bill) — separate from on-bill Notes. Needs a Work_Orders column + Hub input + vendor.html display.
  5. **Status updates by admin not persisting** — needs Brett to say which screen/control he uses (there are several `/status` callers).
  6. Confirm WO-1053 photo content (open the 3 tagged images).
- Type: bug fixes + features (Ridge Co)
- Status: 1 fixed; rest queued.

### CAP-012 — Plumber / handyman sourcing (Ridge Co — NEW, active)
- Raw (handwritten note, Scan_2019, July 18): a list of trade leads, most crossed off.
  - ~~Marvin Calderon — Plumbing, Ashburton — Handyman?~~ (crossed off)
  - ~~Al Stratti — Plumber?~~ (crossed off)
  - ~~Rob Whitley — Plumbing~~ (crossed off)
  - Ask for handyman referrals
  - Oscar Culver → follow up with Oscar on the job at **56 S Culver St**
  - $300 extra to Cesar for floor?
- Type: task (Ridge Co operations)
- Status: new — leads dead-ended; active follow-ups remain
- Sub-items:
  1. Source a reliable plumber/handyman sub — the three named leads (Marvin Calderon, Al Stratti, Rob Whitley) are crossed off / didn't pan out → **B-034**
  2. Ask existing contacts for handyman referrals → part of B-034
  3. **56 S Culver St job → Cesar got it** (V-003). Follow up with **Cesar on Monday** re: Culver → **B-035**. (The written note read "Oscar Culver," but the job ultimately went to Cesar.)
  4. Confirm the **$300 extra paid to Cesar** (V-003) is booked in QB — it's for **floor prep on the 807 N Calvert St (bakery) install, NOT Culver** → **B-036**. Brett's read: legit — floor repairs were necessary before the install, so the extra $300 is owed, not an overpay.
  5. Follow up with **Cesar on Monday** on the **Gibbons** jobs → **B-037**
- Links: BACKLOG B-034, B-035, B-036, B-037
- Handwriting note: "Oscar Culver" is Name+Street shorthand (Culver = street), not a surname; the Culver job went to Cesar. The Cesar payment math (Scan_2032) and ledger (Scan_2032_1 bottom) are handwriting-only — not tracked as to-dos. Logged to HANDWRITING_KEY.

### CAP-013 — Content-creation venture / marketing funnel (NEW lane — PARKED, long-term)
- Raw (handwritten note, Scan_2020, July 18): Brett's long-term plan to start content creation "once back on his feet" with more organization/automation across the businesses.
  - Create content to sell products/services → (a) ad revenue from subscribers, (b) sales of product/service
  - Content must add value / solve a problem
  - Content → Pinterest posts → blogs / videos
  - Facebook posts → blogs (link to my product) / videos
  - 5-step plan: (1) Find niche (2) What am I going to sell to them (3) Build website + funnels (4) Create content to drive traffic to funnels (5) Build email list + continue to add value
- Type: idea / venture
- Status: **parked** — explicitly long-term; not active until the vehicle/cash-flow bleed (CAP-007) is under control and the businesses are more automated
- ❓ Which product/service does this sell — BarrelCo, a new digital product, or Ridge Co lead-gen? (Brett to specify when it activates.)
- Links: strategically downstream of CAP-007 (cash-flow north star)
- Added July 19 (Scan_2032_1 — the story/"why" behind the content):
  - Core narrative: "What is the journey I am on that I would like to share?" → the path to **financial, location, and time independence** (FI + freedom of location + time freedom).
  - Pillars: get **debt-free** (credit cards, consumer/car loans, mortgage); build **significant excess cash flow from multiple streams** (youtube, ST rental, the online work/business doc); **tie in creative self-expression**.
  - Content format idea — **"Side quests" = A.S.Q. (Answer a Specific Question)**: short how-to content on small things (making things, fixing things, trailer-to-office conversion) — anything not directly tied to the main goal.

### CAP-014 — Master operational to-do brain-dump (Ridge Co + admin — mostly NEW, active)
- Raw (handwritten TOPS legal-pad list, Scan_2104, July 18): Brett's running task list. Classified below — crossed-off = done; "no task" = FYI.
- Type: task list (operational)
- Status: new — active items graduated to BACKLOG B-038..B-050
- Items:
  1. MD Taxes payment plan → **B-038**
  2. LLC renewal + annual report (**1864 Kerns School Rd**) → **B-039**
  3. ★ Cabin shopping list from **Gina** → **B-040** (Cabin)
  4. ~~Amazon Gift Card — fetch email~~ (done)
  5. FB Listings → **B-041** (BarrelCo)
  6. ~~Pay Oscar invoices~~ (done)
  7. ~~Pay Alex invoices~~ (done)
  8. Update Tenants: **William 3014 #3**, **Julie 115 #2**, **2930 1R**, **115 #1** (all marked "?") → **B-042**
  9. FU Ashburton St ESTIMATE (Cesar) — correct, **no task needed** (FYI)
  10. Sunday invoices still owed: **Bakery** + **153 #2** (written "151 #2" but it's 153 #2) + **2930 detector** → **B-043**
  11. ~~U-Haul — did I do 2 reservations?~~ (resolved)
  12. ~~U-Haul van reservation~~ (resolved)
  13. 56 Culver work order — correct, **no follow-up needed** (FYI; Cesar has the job per B-035)
  14. Capture WO labor time from messages w/ **Jenn + Mark/Amanda** → **B-044**
  15. "WO created for Ashburton?" — yes, **not needed** (FYI)
  16. ~~2930 Apt 3 — list of repairs from Jen~~ (struck)
  17. Work orders for **151 — Apt 2 & 3 turns** → **B-045**
  18. **WO 115 Apt 2** — troubleshoot invoice → **B-046**
  19. **Invoice Ashburton** — diagnose + troubleshoot (2 hrs) → **B-047**; open QB question: how to bill the **1st hour** — Brett's model is a **$75 service charge covering the 1st hour, then $75 each additional hour** — so it doesn't read as padding → **B-050**
  20. **WO 153 #2** — HVAC leak, add time → **B-048**
  21. **Sergio** bills — entered, **needs paid** → **B-049**
- Links: BACKLOG B-038..B-050
- Handwriting notes logged: "U-Haul" read like "HALL"; "detector" read like "deduct"; Kerns (not Kean); new names Gina / William / Julie / Jenn / Jen / Mark / Amanda / Sergio.

### CAP-015 — Capture / assistant system vision — "Fix What Bugs Me" (BrettOS — NEW, active)
- Raw (handwritten legal-pad note, Scan_2105_1, July 18): feature wishlist for the capture/assistant layer we're building. Through-line = **context-aware surfacing**.
- Type: project / wishlist (BrettOS capture layer)
- Status: new — concrete features graduated to BACKLOG B-051..B-054
- Vision items:
  - **Daily printout/digest of next steps with small wins**; attach new entries to major projects if applicable; leave space for more entries (FU's, invoices, etc.) → **B-051**
  - **Voice interface → spreadsheet** (voice-to-sheet capture) → **B-052**
  - **Multi-step tags + categorize** captures → **B-053**
  - **Context/location-aware surfacing**: tell the assistant what I'm doing and it hands me other tasks on the way / nearby / in the same context (waiting in line, @ Home Depot, etc.) → **B-054**
  - Form-factor question threaded throughout: can it be done on my phone (easily?), only on desktop, location-specific, out & about? — design input for the capture UX.
- Links: BACKLOG B-051..B-054; related to CAP-011 (Hub "one ring" principle)
- Design principle — **"capture vs. do"** (surfaced July 19, Scan_2105_2): separate (a) capturing reference data on-site — lock type/code, HVAC filter size, appliance make/model/serial — from (b) acting on it — order the part, create the WO. Capture must be instant; "do" is an optional follow-on. Ties to CAP-010 (Equipment Registry = the "capture" half; part-ordering / WO creation = the "do" half).

### CAP-016 — Lock-code registry: parcel-locker category + tasks (Ridge Co Hub — feature + tasks)
- Raw (handwritten note, Scan_2105_2, July 18): "New lock code category: parcel locker / change batteries 3014 & 2930 / install @ 115 / record lock changes 3014 #3, #1, 1214 #3 / BrettOS capture vs do."
- Type: feature + operational tasks
- Status: new — feature + tasks graduated to BACKLOG B-055..B-058
- Feature: the lock-code registry **exists or should** — add a **"parcel locker" category**, distinct from lockboxes / door codes / etc. Key difference: **parcel-locker codes can be shared with tenants** (situational), unlike other codes — so the category needs a shareable-with-tenant flag/visibility rule → **B-055**. ⚠ No dedicated lock-code tab in the known sheet schema — confirm it exists or build it.
- Tasks:
  - Change **parcel-locker batteries** at **3014 & 2930** → **B-056**
  - Install a **new parcel locker @ 115** → **B-057**
  - Record recent **lock-code changes**: 3014 #3, 3014 #1, 1214 #3 → **B-058**
- Design note "capture vs. do" → recorded on CAP-015 above; relates to CAP-010 (Equipment Registry).
- Links: BACKLOG B-055..B-058; CAP-010, CAP-011, CAP-015

### CAP-017 — Mixed brain-dump: fleet receivable, jobs, BarrelCo, standards vision (multi-venture)
- Raw (handwritten legal-pad list, Scan_2105, July 18). Classified below; readings corrected by Brett July 19.
- Type: task list + features (multi-venture)
- Status: new — active items graduated to BACKLOG B-059..B-072
- Items:
  1. **Link tasks → projects** (capture layer) → **B-059** (reinforces CAP-015 "attach entries to major projects")
  2. ~~FU Kelly Knock re Barre St / Cesar @ Barre St~~ — **canceled job** (FYI)
  3. **Oscar can do inspections?** — explore/confirm → **B-060**
  4. **Moving boxes** — from a liquor store + the box-recycling company **Spoon** (friend) referred (cheap moving-box packages); Brett is **moving** → **B-061** (personal)
  5. **Invoices from Mook** (V-005) → **B-062**
  6. **Cancel Vendoo** + any other paid FB apps → **B-063** (BarrelCo cost-cut)
  7. ~~Klarna — purchase to pay for mechanic~~ — **personal truck, DONE** (FYI)
  8. **Automate FedEx → FedEx store routing** → **B-064**
  9. **Ray (NJ) — cargo-van toll billing** *(NEW, cash-flow)*: Ray holds one of Brett's vans, **$5k behind**, never pays in full. Automate weekly EZ-Pass toll pull → auto-invoice. → **B-065** (collect the $5k) + **B-066** (weekly EZ-Pass→invoice automation). Links CAP-001, CAP-007.
  10. **Cesar estimates** — re-itemize into checklists; reduce Cesar to **major items only**, do smaller items with **Oscar** → **B-067** (ties estimating B-030/031)
  11. ~~Mook — introduce to Maintenance Hub~~ — **DONE** (FYI)
  12. **Invoice Federal St job** — this job is **NOT in the Hub**; invoices must be created manually → **B-068** (⚠ Hub gap: off-Hub job)
  13. **FU Fait Ave/St** (owner): collect **payment** + confirm **no more leaks**; also **pop-up assemblies on the 3rd floor need replacing** (low priority, combine with other work unless owner wants sooner) → **B-069** (payment + leak check), **B-070** (3rd-floor pop-up assemblies, low)
  14. **FU Vanity repair FB lead** — got a lead off FB, forgot to follow up; likely gone but **HIGH priority** → **B-071**
  15. ~~"What Bugs Me" list as project for AI~~ — struck, not important (already CAP-015)
  16. **Standards for trades + repairs / recurring-opportunistic task engine** → **B-072** (design note below; ties CAP-010)
- Design note (B-072) — Brett's ask: not just preventive maintenance, but **low-priority recurring/opportunistic tasks** that only get done when someone's already on-site for another job; track them, auto-surface when due/upcoming (e.g. month 5.25 of a 6-month cycle), auto-attach to any WO at that property. Open question: make completion **required for vendor payment**? Brett leans no (counterproductive; gaming/disputes). **Claude's recommendation:** track-don't-gate by default; carve out a tiny **safety subset** (smoke/CO detector present + install date, water shutoff located) requiring a check or explicit "N/A + reason"; require **data capture, not the repair** (feeds Equipment Registry — "capture vs do"); optionally **incentivize** (bonus / preferred dispatch) rather than withhold pay.
- Links: BACKLOG B-059..B-072; CAP-001, CAP-007, CAP-010, CAP-015

### CAP-018 — AI/automation vision: onboarding, lead-gen, BarrelCo listings, Cesar mirror (multi-venture)
- Raw (handwritten legal-pad note, Scan_1338, July 19). Forward-looking feature/vision list. Confirmed with Brett.
- Type: project / wishlist (multi-venture)
- Status: new — builds graduated to BACKLOG B-073..B-082
- Items:
  1. **Properties onboarding site** for customers — add properties; capable of multiple inputs / **CSV import** → **B-073**
  2. **Lead-finder Chrome extension** — scan recent (FB) posts needing repairs/lawn care etc., respond, **exclude "I need it today"** desperate posts → **B-074**
  3. **Upgrade Hub UI** to match the **4518 Fairfax Rd estimate** look (Brett's UI baseline) → **B-075**
  4. **Estimate-acceptance workflow** — checklist to accept all items in a section OR cherry-pick, with a **running total** → **B-076** (ties estimating B-030/032)
  5. **Preventive-maintenance package** → **B-077** (ties B-072 standards engine, CAP-010)
  6. **BarrelCo inventory tracking** — Community Forklift + other outlets, integrated with their sales statements (email? weekly/monthly?); **set min inventory levels + restock** → **B-078** (ties B-019)
  7. **Retail-outlet tracker for leads** — barrels + related products; gather restock contact info → **B-079**
  8. **Parents / Waynesboro VA fulfillment** (resolved July 19): Brett's parents live in **Waynesboro, VA** and store a limited amount of planters/barrels; they **meet FB Marketplace buyers there to complete sales** — a free secondary market for Brett (who's in Baltimore, MD). Future: **AI coordinates the handoff between the parents and the buyer** → **B-083**. UX constraint: **mother is the main helper — not tech-savvy, unsure of herself, re-asks previously-covered questions** — so any tool for her must be dead-simple, patient, and repeat-friendly.
  9. **FB Marketplace / listing automation** — AI responds to FB Marketplace messages, captures **off-FB contact info** (or tracks interested buyers) to re-reach when restocks land; AI **renew/delete/repost listings** while contacting prior interested buyers so no lost sales; rebuild a better version of the **"Nerdy Panda"** crosslisting app (was great, had limitations) → **B-080**
  10. **Lead capture that doesn't look bot / scammy / salesy** → **B-081**
  11. **Cesar mirror site** — Cesar tracks his own jobs separately from Brett's, but includes Brett's → **B-082** (ties CAP-010)
- Links: BACKLOG B-073..B-082; CAP-010 (Cesar mirror / equipment), CAP-013/015 (content/capture), B-019/030/032
- Parents' role resolved (item 8) → B-083 (future AI-coordinated Waynesboro VA fulfillment)

### CAP-019 — ChatGPT export ingested → founding vision + Winchester Hauling/CHEP brief (stored PRIVATELY)
- Raw (July 19): Brett shared his full ChatGPT data export (174 conversations). Goal: mine his founding vision + early CHEP pallet-recycling planning — his words as intent, ChatGPT's answers NOT as gospel.
- Type: info / context ingestion
- Status: done — synthesized brief stored in a **private Google Doc** (too sensitive for this public repo). See the "PRIVATE / SENSITIVE CONTEXT" pointer in CURRENT.md.
- Notes: covers Brett's vision (debt payoff → hands-off AI-run businesses → freedom to build creative repurposed-material STRs; pallet business = the financial backbone) and Winchester Hauling's CHEP plan. Per Brett, CHEP return-vendor authorization is now obtained. Full economics/strategy + a "claims to verify" list live only in the private doc.
- ❓ Overlap expected with the forthcoming (overdue) Gemini data export — reconcile when it arrives.
- Links: private doc `Brett_Vision_and_CHEP_Private_v1.1` (Drive); relates to CAP-007 (cash-flow), CAP-013 (content/creative), VENTURES (Winchester Hauling)

### CAP-020 — Vehicle toll / violation forwarding automation (Turo→GiddyUp, vans→Kingbee — NEW)
- Raw (July 19): Tolls (also speeding tickets, parking charges) for the rental cars AND cargo vans arrive **by mail** → Brett scans to PDF. He forwards each to the responsible manager — **GiddyUp (Turo cars)** or **Kingbee (cargo vans)** — routing by **plate number and/or VIN**. He does not pay them directly.
- **EXCEPTION — the one NJ van (Ray's):** its tolls hit Brett's **EZ-Pass account** (shared with his personal vehicle + Dana's Jeep), so they're auto-paid, NOT forwarded (ties Ray / B-066: Brett pays, then bills Ray).
- Type: automation
- Status: new → B-087
- GiddyUp workflow: forward to **info@giddyuprentals.com** immediately, then **flag follow-up every 5 days until a confirmation email is received** (a typed "received and/or paid" note = done; they're low-tech).
- SEND MODE (July 19): default to **drafts Brett reviews + sends** (connector can only draft anyway; keeps Brett in control of what goes to third parties). Each forward includes a **short templated cover note** stating what we're asking them to do (e.g. "Please pay this toll for VIN…, reply to confirm") — which also gives Brett a record of what's expected. Can graduate to fully auto-send (via Apps Script) per party once trusted.
- Dedup / delay handling: notices are mailed, so there's often a lag between the charge and GiddyUp's processing/payment → **cross-reference each incoming toll/ticket/parking charge against recent ones already sent + confirmed**; if it matches one already handled, **save the file but do NOT re-send.**
- Filing: under the manager's Vendors-drive folder — Giddyup (id `1p-d4CxVgSDaL9nzo0V822cb7aOOavqlv`); Kingbee (confirm/create folder).
- Constraint: Gmail connector can only DRAFT → auto-send + the 5-day follow-up loop run via Apps Script / the Worker.
- Kingbee forwarding (found in Gmail July 19): **tolls@kingbee-vans.com** (tolls team; general contact hive.network@kingbee-vans.com — they hand payment to processor "Car IQ"). Same send + follow-up-until-confirmed pattern as GiddyUp.
- ❓ Remaining: a plate/VIN → vehicle → manager lookup (small table) to auto-route.
- Links: CAP-003 (Turo/GiddyUp), CAP-001 (Kingbee, Ray/B-066); BACKLOG B-087

### CAP-021 — HSA receipt automation (FUTURE — personal)
- Raw (July 19): Same pipeline pattern for Brett's **personal HSA expenses** — auto-upload receipts to his HSA account (if possible) so he can submit for reimbursement once uploaded + categorized. He has a dedicated folder in his **personal Drive** (not the business shared drives).
- Type: project (future)
- Status: parked/future → B-089
- Notes: HSA-provider upload may need browser automation or manual (varies by provider — confirm the provider + whether it has an API/portal). Personal-Drive access differs from the business Drive connector.
- Links: mirrors CAP-002 receipt pipeline; BACKLOG B-089

### CAP-022 — Vehicle RECALL forwarding + unified vehicle-notice router (NEW)
- Raw (July 19): Same setup as tolls (CAP-020) but for **recalls** — scanned recall notices routed to whoever has the vehicle: **Kingbee** (cargo vans on-platform), **GiddyUp** (Turo cars), or **Ray Lewis** (the NJ van he holds). Intake: **Inbox > Fleet Vehicles > Recalls** (Brett creating now).
- Difference vs tolls: for the **NJ van**, tolls ride Brett's EZ-Pass (auto-pay), but **recalls go to Ray Lewis** (he physically has the van).
- Type: automation
- Status: new → B-087 (broadened)
- CONVERGENCE (design): tolls (CAP-020), recalls (CAP-022), and compliance/insurance/registration notices (CAP-005/006) are the **same machinery** → a **unified vehicle-notice router**: identify vehicle by VIN/plate → look up current holder/manager in the **Fleet Vehicle roster** → route (send + 5-day follow-up until confirmed) → dedup vs already-sent → file under the manager's Vendors folder. Per-notice quirks (NJ-van toll = EZ-Pass exception) layer on top.
- **MVA / registration / insurance notices** (intake **Inbox > Fleet Vehicles > MVA Notices**, Brett creating): same router, SPECIAL rule — **forward to KingBee for KingBee-held vans** (they manage registration/insurance), but for **GiddyUp cars, Ray Lewis's van, and LIEN → do NOT forward; Brett resolves those himself** (file + flag for Brett). Refines CAP-005.
- Dependency: the **Fleet Vehicle roster sheet** (VIN/plate → current holder Kingbee/GiddyUp/Ray Lewis, make/model, on/off platform). Brett has a sheet; needs holders updated + shared with the service account → B-090.
- Links: CAP-020 (tolls), CAP-005/006 (compliance/registration), CAP-001 (fleet); BACKLOG B-087, B-090

### CAP-023 — BarrelCo leads database (retail-outlet leads — NEW, activates B-079)
- Raw (July 19): Brett wants to save BarrelCo leads (retail locations to follow up with) into a database — a **sheet + input method**. Has business cards to upload NOW (clear the desk); will add more over time; wants bulk-add later.
- Type: project (BarrelCo) → B-079
- Plan: (1) NOW — Brett uploads business-card photos → Claude OCRs → creates/populates a **BarrelCo Leads** sheet (share w/ service account per PAT-027). (2) Ongoing input — options: Google Form (mobile, auto-appends), a Hub "Leads" screen (build), or keep sending cards to Claude. (3) Columns: Business, Contact, Title, Phone, Email, Address, Location type, Product interest, Source, Status, Next action, Date added, Notes.
- Expanded July 19 — **four lead types**, each with an Inbox capture folder + a sheet:
  - **Barrel Leads** (Inbox > Barrel Leads) — BarrelCo retail-outlet leads.
  - **Vendor Leads** (Inbox > Vendor Leads) — potential Ridge Co vendors/subs.
  - **CHEP Locations** (Inbox > CHEP Leads > CHEP Locations) — CHEP recycling **supplier** leads (properties/businesses that generate pallets).
  - **CHEP Vendors** (Inbox > CHEP Vendors) — CHEP **driver** leads (haulers).
  - Plan: create the 4 as tabs in the BrettOS sheet (or standalone) via **sheet-ops**; input = upload business cards → OCR → append rows; later a Form/Hub screen. Business cards to upload NOW.
- Links: CAP-018 (retail-outlet tracker), CAP-001/Winchester (CHEP), BACKLOG B-079

### CAP-024 — Surface captures/tasks in a BrettOS Sheet (accessible + bulk-actionable — NEW)
- Raw (July 19): Brett wants the captured items/backlog tracked in a **BrettOS spreadsheet he can open anytime** (not only Claude's GitHub markdown), so he can (a) see them as tasks without talking to Claude, (b) update status as he goes, (c) ask Claude to **bulk-categorize / act on sets** of them — Claude then processes or asks for more info.
- Current state (answering Brett's Q): captures live in the **GitHub repo** (CAPTURE_INBOX.md + BACKLOG.md) — Claude's source of truth, loaded every session (nothing lost) — but NOT yet in a sheet Brett can open/work directly.
- Plan (proposed): a **BrettOS Tasks sheet** (ID | Title | Venture | Category | Status | Priority | Next action | Links | Updated), seeded from CAP-001..023 + B-001..091, that Brett opens/edits and Claude syncs with the repo. Bulk workflow: Brett tags/asks → Claude reads the sheet, processes or requests info. Eventually surface in the Hub (ties CAP-015 / B-051 / B-059).
- ❓ Decision: Sheet now / Hub screen / both; pick a single source of truth to avoid drift.
- Type: project (BrettOS core) → B-091
- Links: CAP-015 (capture vision), B-051/B-059; BACKLOG B-091

### CAP-025 — Reconcile with the REAL BrettOS task app (sheet 1X2oYjD) — IMPORTANT
- Discovery (July 19): the "BrettOS sheet" Brett pointed to (`1X2oYjDfnGzJWDI84e1t4p7cbt9iWxq5qbPmNFI9auuA`) is his **real working task app** — tabs: Tasks (BTOS-2026-###), Projects (BTOS-PRJ-###), WBM (brain-dump inbox), Ventures, Patterns (its OWN PAT-001..018 = system-design, NOT our Context-Doc PATs), Dev Log/Wishlist (DL-###), Logs, Integration Logs, Entities, Contacts. Has a web UI + the sheet-ops write path.
- **Heavy overlap:** it ALREADY holds ~25 of the operational tasks I re-captured from the handwriting scans (Brett bulk-pasted them July 14) → my BACKLOG duplicates his task app. DON'T double-add. Examples: MD taxes (BTOS-001≈B-038), LLC/1864 Kerns (002≈B-039), cabin/Gina (003≈B-040), FB listings (004≈B-041), Sunday invoices (006≈B-043), 151 turns (010≈B-045), WO115 (011≈B-046), Ashburton invoice (012≈B-047), WO153 HVAC (013≈B-048), Oscar inspections (017≈B-060), boxes/Spoon (018≈B-061), Mook invoices (019≈B-062), cancel Vendoo (020≈B-063), Cesar re-itemize (022≈B-067), Federal St (023≈B-068), Fait Ave (024≈B-069, owner = **Jon**), vanity FB (025≈B-071).
- **Canonical venture codes:** ridge_co, barrel_co, cabin (= WV Cabin "**Milam Ridge**"), personal, cargo_vans, rental_cars, pallets.
- **Items in BrettOS I was MISSING (now in context):** Projects — **QuickBooks Cleanup** (PRJ-003: 2 yrs missing txns, reconnect banks, reconcile), **Milam Ridge Direct booking site** (PRJ-004), Roadside Stand (PRJ-001), Move Unistrut to Cabin (PRJ-002). Cabin tasks — house-rules/Truvi-vs-Superhog/pet-fee audits (BTOS-026..030). WBM raw — QB logo still "BMore" → change to RidgeCo (WBM-009); 3014 N Calvert door stoppers 2nd-floor + check 1st (WBM-010). **Klarna $961.20 mechanic** (BTOS-021) — I'd noted Klarna "done/personal truck"; RECONCILE.
- **LIVE BUG:** Integration Logs show maintenance_hub + barrelco sync FAILING every 6h since July 14 ("error code: 1042", Cloudflare). → B-092.
- ARCHITECTURE: the **BrettOS sheet = canonical task home**; our GitHub CAPTURE_INBOX/BACKLOG = deep design/context notes that FEED it (net-new only). This realizes CAP-024/B-091 — the sheet already exists.
- Append path: **sheet-ops** (`context/sheet-ops/pending.json` → GitHub Action runs run_ops.py via the service account) appends rows / creates tabs on ANY sheet by ID, incl. this one. Self-sufficient.
- Links: CAP-024/B-091, CAP-023 (lead sheets), BACKLOG B-092

### CAP-026 — Ridge Co big-build planning + full wishlist consolidation (Ridge Co — planning)
- Raw (July 21): Brett wants a huge Ridge Co build; pull ALL wishlist items from the sheets, tidy them, do the scheduled security fix. Gave 8 new asks.
- Type: project (planning)
- Status: in-plan → graduated to B-093..B-102
- Pulled (Drive connector): RidgeCo Main `Wishlist` tab = **76 items** + BrettOS Tasks app (BTOS/WBM/DL tabs). Consolidated into the July 21 build-plan doc, grouped by subsystem → phase.
- Architecture mapped (subagent, grounded in code): single `sendSMS` chokepoint (worker.js:1627); **NO cron anywhere**; **NO email path** (Tenants have no email column); WO status values duplicated ~7 places; `WO_Templates` tab exists but prefill-only (no server-side instantiation); **no recurring/split logic**; estimate flow via `approveEstimate` (worker.js:1064); `Notification_Queue` tab + `Send_After` exists but is never flushed (no cron).
- New asks → **B-093** notification engine v2 / quiet-hours, **B-094** vendor SMS opt-out checkbox, **B-095** tenant/owner hold-SMS-til-8am, **B-096** split+dependencies, **B-097** vendor-triggered recurring + smart clock-reset, **B-098** recurring-from-template + seasonal windows, **B-099** template-from-vendor trigger, **B-100** pre-triggered/dependency WOs, **B-101** estimate approval + start-date, **B-102** Fairfax UI redesign.
- **LIVE BUG diagnosed:** BrettOS sync into maintenance_hub + barrelco = **HTTP 401 Unauthorized** since the July 20 `WORKER_SECRET` rotation (sync caller still uses old secret) → **B-092** escalated; barrelco also throws an `atob()` base64 error. Fix folded into the Phase-0 security work.
- **Locked decisions (July 21):** tomorrow = quick wins → security fix (**phone-only** tenant login) + fix the 401 → status-enum SSOT → Cron infra → Phase 1 notifications (**hold-SMS-til-8am**, email channel deferred). UI redesign = **Phase 4** (after engine stable).
- Links: BACKLOG B-092..B-102; private `property-maintenance.md`; July 21 build-plan doc; ties CAP-011 (Hub "one ring"), CAP-025 (BrettOS task app).

### CAP-027 — Pre-overhaul brain-dump, note 1 (Scanned_202607211020, July 21) (multi-venture — NEW)
- Raw (handwritten legal pad, read off photo): a mix of new ideas + concrete tasks Brett wants captured before the Ridge Co overhaul. Line by line:
  1. **"STR – Cleaner Scheduling System"** — describe current scheduling process; a site for cleaners to see the schedule + pick dates / indicate availability; push SMS for last-minute bookings + approaching uncovered dates; update Brett's calendar. → **B-104** (feeds the STR dashboard app, B-105/CAP-028).
  2. **"System for managing long-term leases"** + "self inspection requirement". → **B-106**.
  3. **"Tenant feedback from repair services."** → **B-107** (ties B-006 tenant portal).
  4. **"Bulk sharing of all Drive folders."** → **B-108** (ties the owner-privacy concern in CAP-028 #1).
  5. **"FB group creation for barrels → create my own group."** (BarrelCo) → **B-122** (ties B-080 FB automation, CAP-018).
  6. **"928 N Calvert St water heater(s) — contact manufacturer for warranty."** (unit 928; ❓ confirm street = Calvert) → **B-109**.
  7. **"Refer Charles Barnett to Tom Binkell at Ecowize for rental property upgrades for energy savings."** ❓ all three names spelling-unconfirmed → **B-110**.
  8. **"4518 Fairfax — create property; Lockbox [code] on Apt 1 unit door."** Actual lock code = handwritten on the page, stored PRIVATELY (data repo), kept out of this public file. → **B-111** (ties B-055 lock-code registry; 4518 Fairfax = the UI baseline property B-075/B-102).
  9. **"Dispatch tool that summarizes troubleshooting + gathers model info before sending into work order + dispatching to vendor"** (example: washing machine); **"do this for 3014 washer"** as the pilot. → **B-113** (ties CAP-010 repair gems/Equipment Registry, B-072).
  10. **"Ridge Co website w/ SEO"** → **B-119**; **"Winchester Hauling website w/ SEO"** → **B-120**; **"Ridge Co FB profile overhaul"** → **B-121**.
- Type: mostly NEW (mix of feature ideas + ops tasks)
- Status: parsed → graduated to B-104..B-122 (see per-line above)
- ❓ Open: street name on #6 (Calvert vs Culver); referral name spellings on #7.
- Links: BACKLOG B-104..B-122; CAP-028 (companion note); CAP-010 (equipment/dispatch), CAP-018 (FB/lead automation), B-055/B-073/B-075.

### CAP-028 — Pre-overhaul brain-dump, note 2 (Scanned_202607211341, July 21) (multi-venture — NEW)
- Raw (handwritten legal pad, read off photo):
  1. **"Work orders as HTML site in Ridge Co so they can be sent as links or PDFs; better sharing + ability to download into a Google Drive folder — but WITHOUT sharing info on owners that they don't need."** → **B-117** (ties B-011 invoice PDF, B-032 proposal PDF, FEATURE_LOG privacy rule 13).
  2. **"Second Brain."** — BrettOS capture/knowledge vision. → recorded here; extends CAP-015 (capture system) + CAP-024 (surface captures in a Sheet). Also fuels **B-123**.
  3. **"Download vendor text messages to surface information gaps to close with the WO system + info gathering."** → **B-114** (ties B-044 capture WO time from messages, B-113 dispatch tool).
  4. **"Find my new-property checklist + info-gathering form → create a database for properties."** → **B-112** (ties B-073 properties onboarding site + CAP-027 #2).
  5. **"Build a 2-inspector app + create inspection template for Phoenix → tie into Ridge Co."** ❓ "Phoenix" = property/partner/company unclear. → **B-118**.
  6. **"STR App for Cabin — Dashboard & Alerts":** upcoming uncovered turns · shopping list · list of automations · reviews needed · links to documents for keeping up to date · hot tub status · lock battery status · maintenance scheduling · guest feedback. → **B-105** (parent; B-104 cleaner-scheduling feeds it).
  7. **"Need Claude to start acting on the items on my to-dos. Need separate agents to run in the background on a schedule (overnight + efficient off-peak) — analyze + build."** → **B-123** (autonomous background agents; ties the long-term "autonomous ops" goal + CAP-015).
  8. **"Vendor tools + equipment tracking for use in auto-dispatch + assignment."** → **B-115** (ties CAP-010 Equipment Registry, B-113).
  9. **"Vendor schedule options — no weekends / no evenings / etc; let them block notifications during certain hours and vacations; option to block all except part notifications; send assignment notifications the next available day after a block."** → **B-116** (directly extends the Phase-1 notification build B-093/B-094).
- Type: mostly NEW (feature ideas + one operating directive, #7)
- Status: parsed → graduated to B-105, B-112..B-118, B-123 (see per-line)
- ❓ Open: "Phoenix" meaning (#5).
- Note for the big build: **#9 is directly relevant to Phase 1 notifications** (B-093/B-094) and **#7 (background agents) is an operating directive**, not just a feature — surface both when the overhaul starts.
- Links: BACKLOG B-105/B-112..B-118/B-123; CAP-027 (companion note); CAP-010, CAP-015, CAP-024; B-006/B-044/B-073/B-093/B-094.

<!-- QUEUE-SYNC-INSERT (synced captures land above this line) -->

---

## GRADUATED (moved to BACKLOG or a plan)
*(none yet)*

## PARKED / KILLED
*(none yet)*

---

## HOW TO UPDATE
- New dump → add CAP item(s), link and flag NEW vs. planned, log any open questions.
- When an item becomes real work → move to BACKLOG.md, mark it `graduated` here with the new ID.
- Never delete a captured item — mark it `killed` or `parked` with the reason so the thinking is preserved.
