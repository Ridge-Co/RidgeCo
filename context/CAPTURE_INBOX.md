# BrettOS Capture Inbox
**Version:** v1.8 | **Last Updated:** July 19, 2026
**Rule:** This is Brett's zero-friction brain-dump inbox. Brett captures thoughts in any form (typed, pasted, voice, photo of handwriting, forwarded email). Claude parses every dump into structured items here, links them to existing plans/backlog, extracts hidden sub-projects, and flags open questions. Items "graduate" to BACKLOG.md or a business plan once they become real work.

---

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
  6. **Ray (NJ) — private-party van**: a former friend in NJ holds one of Brett's cargo vans off-platform, never pays on time/in full — **$5k behind** on the bill/tolls. Automate weekly EZ-Pass toll pull → auto-invoice Ray. (See CAP-017, B-065/B-066.)
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
