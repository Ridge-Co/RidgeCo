# BrettOS Capture Inbox
**Version:** v1.0 | **Last Updated:** July 18, 2026
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
- ❓ Who is the Colorado third-party manager, and what's the exit path from that arrangement?

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
