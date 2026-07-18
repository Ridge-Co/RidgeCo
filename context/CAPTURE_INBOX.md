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

### CAP-001 — Cargo van fleet (NEW thread — not in prior context)
- Raw: Many inbound emails about cargo vans; a thread with a contact about them. Goal: get the vans OFF the Kingbee platform onto long-term leases (a lease plan already exists). One van is trapped in Austin, TX under a mechanic's lien.
- Type: project (multiple)
- Status: new
- Sub-items:
  1. Formalize the Kingbee → long-term-lease transition plan (Brett has a plan; Claude hasn't seen it)
  2. Resolve the Austin, TX mechanic's lien and free the trapped van
  3. Establish fleet baseline: count, location/status per van, Kingbee cost vs. lease target
  4. Pull the van email thread(s) to reconstruct the full situation
- Links: possible NEW venture (6th) or a Winchester Hauling sub-operation
- ❓ Which venture do the vans belong to — Winchester Hauling (haul pallets), a standalone fleet/leasing operation, or Ridge Co support?
- ❓ How many vans total, and what is Kingbee costing per van per month right now?

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

## GRADUATED (moved to BACKLOG or a plan)
*(none yet)*

## PARKED / KILLED
*(none yet)*

---

## HOW TO UPDATE
- New dump → add CAP item(s), link and flag NEW vs. planned, log any open questions.
- When an item becomes real work → move to BACKLOG.md, mark it `graduated` here with the new ID.
- Never delete a captured item — mark it `killed` or `parked` with the reason so the thinking is preserved.
