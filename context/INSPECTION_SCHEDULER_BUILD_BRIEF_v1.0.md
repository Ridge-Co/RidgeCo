# Inspection Scheduler — Build Brief v1.0
**B-226** | Created Aug 18, 2026 | Status: APPROVED FOR PHASE 1

---

## 0. The problem (Brett's words, condensed)

Two inspection lines of business, same underlying scheduling problem:

1. **New PM customer — annual inspections.** Rental portfolio of single-family and
   multifamily properties. Multifamily = multiple tenants per site who each need their
   own slot inside one site visit, so Brett isn't making 4 trips to a 4-unit building.
   Batching keeps both the customer's cost and Brett's time down. The hard part: some
   fraction of tenants in a building won't schedule in the first pass, and Brett needs a
   system that keeps chasing them without him doing the texting, then tells him when to
   pull the trigger on a partial-fill visit or push the date.
2. **AMSCRE (existing undocumented gig income, #527 in the Gemini archive).** One-off
   commercial-property inspections assigned by AMS (amscre.com) on behalf of lenders
   (Alpha Realty / Velocity Commercial Capital). $50/inspection, ~2/week, arrive
   unpredictably. Brett's actual problem here is geography: he'd take more of these if he
   could reliably cluster 5-8 into one drive to Frederick/Bel Air, but AMS doles them out
   one at a time and he can't "turn the spigot on" for a region without risking
   overcommitting or under-filling a route. Today this is entirely manual and it's
   costing him volume.

Both need: (a) Brett defines when he's available, (b) the system does tenant/borrower
outreach so Brett is never the one texting, (c) it's proximity-aware so nearby jobs get
suggested as a combined trip, (d) for the multi-tenant case specifically, multiple slots
must be sellable against one site-visit window.

## 1. Decisions locked in (this session)

| # | Question | Decision |
|---|---|---|
| A | Where does this live | **Inside the existing Ridge Co Hub stack** — same Worker, same Sheet (RidgeCo Main), same Twilio number. New customer, not a new system. |
| B | Calendly-backbone repo | **Researched and rejected as infra.** Cal.com (Next.js+Postgres+Docker) and Easy!Appointments (PHP+MySQL) can't run on Cloudflare Workers and would mean a second server + database outside the one-Worker/one-Sheet rule, with no Cowork-session way to keep it running. **Building natively instead**, following the exact pattern already proven by Trash Service (B-205): a new standalone page + its own Worker endpoints + self-provisioning Sheet tabs, all in the same repo. |
| C | Brett's availability | **Off-limits/blackout model on the Hub**, not a Google Calendar sync (v1). Brett sets default recurring open hours (e.g. Mon-Thu 9-3) plus blackout rules — both one-off dates and recurring patterns ("nothing after 3pm Fridays," "nothing on holidays"). Multi-select blackout dates in one action. Calendar-sync can be a v2 if the manual model gets tedious. |
| D | Proximity | **Zip code, not geocoded lat/lng/drive-time.** Group and filter properties/jobs by zip for v1 — "close enough" per Brett. No new Maps API dependency, no new cost. |
| E | Outreach style | **Hybrid.** First contact is a self-serve link (Calendly-style: pick an open slot, done). If the tenant/borrower texts back instead of clicking, or wants to change something, the system replies — simple logistics (different slot, same window) handled automatically; anything else escalates to Brett with the tenant's message + a suggested reply he can send or edit. |
| F | Stuck/partial-fill handling | **Auto-nudge, then ask Brett by SMS.** System keeps re-texting non-responders on its own. Once a window is stuck (deadline approaching, still short of full) OR fully filled, Brett gets a text: fully filled = FYI/auto-confirmed; partial = "2 of 4 confirmed for [property] [window] — reply GO to lock it in as-is" plus a link to reschedule/cancel the whole window. |
| G | Scope | **Build both lines (rental-customer batching + AMSCRE routing) — same engine, two intake paths.** Sequenced into phases below rather than one shot, per the Session Efficiency Protocol's phase-boundary rule; each phase ships and is checkable on its own. |
| H | Data onboarding | **Brett onboards the new customer's properties/units/tenants himself** through the Hub UI once Phase 1 ships (no import needed from Claude). |

## 2. Architecture — mirrors Trash Service (B-205), not a new stack

New standalone page(s), same repo, same auto-deploy:

- **`inspect.html`** — Brett's admin/ops screen (mh_auth-gated, same login as the rest of
  the Hub). Onboard customers/properties/units/tenants for this line of business,
  set availability + blackout rules, pick a target week + properties to run outreach
  for, watch fill-status live, approve/lock or reschedule, manage the AMSCRE pending
  queue.
- **`inspect-book.html`** — public, no-login booking page reached via a unique token link
  (`?t=<token>`, same idea as the vendor/tenant PIN pattern but single-purpose and
  scoped to exactly one booking). Shows the open slots for that tenant's/borrower's
  window, lets them pick one, or leaves a note if they want to discuss.
- **New `worker.js` endpoints**, namespaced `/insp/...`, all secret-gated except the two
  the public booking page needs (`GET /insp/book`, `POST /insp/book/confirm`,
  `POST /insp/book/note` — token-authenticated instead of WORKER_SECRET, same pattern
  `/sms-inbound` already uses for its own public-but-narrow exposure).
- **Self-provisioning Sheet tabs** (`ensureInspTabs`, same pattern as `ensureTrashTabs` —
  `:batchUpdate` addSheet + ensureColumns) — no manual sheet-ops step, no separate
  service-account share (same RidgeCo Main sheet, already shared with
  `maintenance-hub-sheets@maintenance-hub-498819`).
- **Reuses, doesn't duplicate:** `sendSMS`/`logSMS` chokepoint, `addRow`/`updateRow`/
  `fetchTab` primitives, the PIN-lockout pattern's token-generation idea, `/sms-inbound`'s
  inbound-webhook shape, and (per PAT-031) the model-router pattern already used for
  `generateEstimateText`/`translateToEnglish` for the AI-drafted reply step.

### Data model (new tabs, prefix `Insp_`)

| Tab | Purpose | Key columns |
|---|---|---|
| `Insp_Customers` | The inspection-only customer(s) — this new one, later AMSCRE as a synthetic "customer" | ID, Name, Line (`rental`\|`amscre`), Contact, Active |
| `Insp_Properties` | Sites to inspect | ID, Customer_ID, Address, Zip, Type (`single_family`\|`multifamily`), Unit_Count, Visit_Duration_Min (default per unit), Active |
| `Insp_Units` | One row per unit (SFH = exactly one synthetic unit) | ID, Property_ID, Label, Tenant_Name, Tenant_Phone, Active |
| `Insp_Availability_Rules` | Brett's default recurring open hours | ID, Day_Of_Week, Start_Time, End_Time, Active |
| `Insp_Blackouts` | One-off + recurring blocked time | ID, Date (nullable if recurring), Recur_Rule (e.g. `weekly:FRI:15:00-23:59`, `holiday:2026-12-25`), Start_Time, End_Time, Reason, Active |
| `Insp_Windows` | One inspection visit-block per property per cycle (the "batch") | ID, Property_ID, Target_Date, Start_Time, End_Time, Slot_Duration_Min, Status (`collecting`\|`ready_partial`\|`locked`\|`completed`\|`cancelled`), Zip, Created_Date |
| `Insp_Bookings` | One row per unit's slot inside a window | ID, Window_ID, Unit_ID, Token, Status (`invited`\|`viewed`\|`confirmed`\|`needs_discussion`\|`declined`\|`no_response`), Slot_Start, Slot_End, Last_Contact_Date, Contact_Count, Last_Reply_Text |
| `Insp_Amscre_Jobs` | One-off AMSCRE assignments | ID, Address, Zip, Borrower_Name, Borrower_Phone, Received_Date, Status (`pending_cluster`\|`released`\|`invited`\|`confirmed`\|`completed`\|`expired_solo`), Cluster_Hold_Until, Confirmed_Slot, Token |

All tabs get `ensureColumns`-safe headers (no 40-col grid surprises — apply the July 21
`appendDimension` lesson from rule 78 up front). SMS traffic logs to the existing
`SMS_Logs` tab tagged `Source=INSPECT`, not a new log tab — no need to duplicate PAT-001.

## 3. Flow — rental customer (multi-tenant batching)

1. Brett onboards the customer + properties + units + tenants in `inspect.html` (Phase 1).
2. Brett sets/edits default availability + blackout rules once, edits anytime (Phase 1).
3. Brett picks a target week and one or more properties (filterable/sortable by zip so
   nearby ones are obvious to group) → **Start Outreach** (Phase 2).
4. System computes each property's open slots (default hours − blackouts − already-taken
   slots, sliced by `Visit_Duration_Min`) and creates an `Insp_Windows` row +
   `Insp_Bookings` rows (one per unit, status `invited`) with a unique token each.
5. System texts each tenant a link to `inspect-book.html?t=...` showing only their
   property's open slots for that window (Phase 2).
6. Tenant self-books → `Insp_Bookings.Status = confirmed`, that slot removed from the
   open pool. Tenant replies instead of clicking → inbound SMS handler resolves phone →
   token, tries to parse a plain scheduling reply ("Tues works," "can we do 10 instead"),
   auto-rebooks if it maps cleanly to an open slot, otherwise flags
   `needs_discussion` + notifies Brett with the message + a drafted reply he can approve
   or edit (Phase 4).
7. Auto-nudge non-responders on a schedule (e.g. +48h, +24h-before-deadline) up to a cap
   (Phase 3).
8. When the window is either full or hits its decision deadline, text Brett: full =
   auto-confirmed FYI; partial = "GO to lock it in as-is" + a reschedule/cancel link
   (Phase 3).

## 4. Flow — AMSCRE (one-off, geo-hold, route clustering)

1. Brett adds a new AMSCRE job as it arrives (address, zip, borrower contact) — manual
   entry in `inspect.html` for v1; a future phase could reuse the B-103 email-intake
   engine to parse AMS's assignment emails automatically, same pattern already proven
   for Buildium (not in this brief's scope — flag for later, don't build speculatively).
2. New job sits `pending_cluster` in its zip. `inspect.html` shows a **pending-by-zip**
   queue: "3 pending near 21701 (Frederick)."
3. Brett either releases a zip cluster manually (**Release outreach**) once enough have
   piled up, or the job auto-releases solo after a hold window (`Cluster_Hold_Until`,
   Brett-configurable, e.g. 3 days) so nothing sits forever waiting for company.
4. On release, each borrower gets the same self-serve link + reply-capable flow as the
   rental-customer path, scheduled against Brett's general open availability (the same
   `Insp_Availability_Rules`/`Insp_Blackouts`, since it's the same calendar) rather than
   a specific property's window.
5. Same auto-nudge + Brett-approval-by-SMS loop as the rental flow (Phase 3/4 reuse, not
   a second implementation).

## 5. Phasing (checkpoint after each — Session Efficiency Protocol Rule 3)

- **Phase 1 (this session):** Sheet tabs + `ensureInspTabs`; `inspect.html` skeleton
  (mh_auth login, reuses existing pattern); CRUD screens for
  Customers/Properties/Units/Tenants; Availability Rules + Blackout editor (multi-select
  dates, recurring-rule builder for "no X after Y on weekday Z" and holiday blackouts).
  No outreach yet — this phase is data model + Brett's own onboarding tool, matches
  decision H.
- **Phase 2:** Window/slot computation engine (pure function, unit-testable like
  `calcTieredEstimate`/`buildTrashInvoiceLines`) + `Start Outreach` action + SMS send +
  `inspect-book.html` self-serve booking page + token auth.
- **Phase 3:** Auto-nudge scheduler (reuses the `GET /notifications/pending`-style
  drain-on-poll pattern already in worker.js, since there's still no cron) + Brett
  approval-by-SMS (GO / reschedule-cancel link) + AMSCRE zip-pending queue + release/
  auto-release-solo logic.
- **Phase 4:** Inbound-reply handling on top of `/sms-inbound` — auto-rebook on a clean
  match, AI-drafted reply + Brett-approve for anything ambiguous (model-router pattern,
  PAT-031, telemetry-logged).
- **Phase 5 (later, not this brief):** AMSCRE email intake automation; real
  geocoded/drive-time clustering if zip-only proves too coarse; Google Calendar sync if
  the manual availability model gets tedious.

## 6. Guardrails carried over from house rules

- PAT-001/004/005: one Worker, one Sheet, no Wrangler, no new DB.
- PAT-006: soft-delete only (Active flag), never hard-delete a row.
- PAT-010/011/014: CORS on every response, JSON error shape, try/catch everywhere,
  missing-tab → clean 404 not 500.
- PAT-024: read the real current worker.js/index.html/CODEMAP before every phase's
  first edit, not just this brief.
- PAT-031: any AI call (drafted-reply step, Phase 4) goes through the router pattern —
  cheap tier first, telemetry-logged — never a direct expensive-model call.
- Money/cost/markup rule (Aug 10 hard lock): N/A to this build — no pricing math is
  customer-facing here, but if a future phase ever shows Brett's per-inspection rate
  anywhere near a borrower/tenant-facing page, that's an instant stop per the Aug 10
  incident rule.
- Nothing here is committed with real tenant/borrower PII into this brief or any public
  doc — the brief stays structural/schema-level only.

---
*v1.0 — Aug 18, 2026. Supersedes nothing; new build. Reference `context/CODEMAP.md` §6
(Trash Service) as the closest existing analog before writing Phase 1 code.*
