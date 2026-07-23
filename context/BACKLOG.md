# BrettOS Master Backlog
**Version:** v1.28 | **Last Updated:** July 23, 2026
**Rule:** This is the single source of truth for everything to build, fix, or automate across all ventures. Update after every session. When Brett says "do it," the item moves to In Progress. When done, it moves to Completed with the date.

Priority levels: 🔴 Urgent | 🟠 High | 🟡 Medium | 🟢 Low | ⏳ Blocked (waiting on something)

---

<!-- QUICK-INDEX:START — always-loadable map; full entries below; grep an ID to jump to detail -->
## Quick Index
_Compact map of every open backlog item. Read THIS map on load (two-tier loading); open a full entry below only when a task needs it — grep the ID._

**IN PROGRESS**
- B-015 · QuickBooks Send-to-QuickBooks flow (invoice + bill + payment)
**RIDGE CO — WORK ORDER MANAGEMENT**
- B-001 · QB invoice creation from approved Invoice_Review rows
- B-002 · QB bill recording when vendor bill approved
- B-003 · Work order creation from index.html
- B-004 · Vendor assignment + reassignment from index.html
- B-005 · Payment tracking — record when customer pays
- B-006 · Tenant portal — report issues, view WO status
- B-007 · Automated vendor payment via QuickBooks
- B-008 · Email/SMS notifications — vendor gets WO assigned
- B-009 · Email/SMS notifications — Brett gets bill submitted for review
- B-010 · WO completion photos auto-organized in Drive
- B-011 · Invoice PDF generation for customers
- B-012 · Vendor performance dashboard
- B-055 · Lock-code registry — add "parcel locker" category (shareable-with-tenant
- B-072 · Trade/repair standards + recurring-opportunistic task engine
- B-073 · Properties onboarding site for customers (add properties; CSV import)
- B-075 · Upgrade Hub UI to match the 4518 Fairfax Rd estimate look
- B-077 · Preventive-maintenance package
- B-082 · Cesar mirror site — tracks his own jobs separately but includes Brett's
- B-084 · Hub "Receipts to file" queue — OCR + classify + seeded WO/property picke — 🟡 ENGINE SHIPPED July 22 (/receipt-intake, /receipt-scan, /receipt-queue, approve+file; Receipts_Queue tab). NEXT: Hub review screen + Gmail intake + real-receipt vision test. See FEATURE_LOG v1.8
- B-085 · Rebuild receipt intake pipeline — retire the stalled Make.com scenario — 🟡 first slice SHIPPED July 22 (own-purchase receipts; Drive intake + confirm-first queue; QB posting deferred)
- B-086 · Reconcile receipts stuck in "WO Receipt Inbox" (Aug–Dec 2025)
- B-088 · Add 1864 Kerns School Rd (owned STR) to the WO system as a property
**RIDGE CO — OPERATIONS / TO-DO**
- B-034 · Source a reliable plumber/handyman subcontractor
- B-035 · Follow up with Cesar (Mon) on the 56 S Culver St job
- B-036 · Confirm $300 extra to Cesar (V-003) for 807 N Calvert St bakery floor pr
- B-037 · Follow up with Cesar (Mon) on the Gibbons jobs
- B-038 · MD taxes payment plan — set up
- B-039 · LLC renewal + annual report
- B-042 · Update tenant records — William (3014 #3), Julie (115 #2), 2930 1R, 115 
- B-043 · Invoice batch still owed — Bakery + 153 #2 + 2930 detector
- B-044 · Capture WO labor time from messages (Jenn + Mark/Amanda)
- B-045 · Work orders — 151 Apt 2 & 3 turns
- B-046 · WO 115 Apt 2 — troubleshoot invoice
- B-047 · Invoice Ashburton — diagnose + troubleshoot (2 hrs)
- B-048 · WO 153 #2 — HVAC leak, add time
- B-049 · Pay Sergio — bills entered, needs paid
- B-050 · QB billing method — how to bill the 1st hour without looking like paddin
- B-056 · Change parcel-locker batteries — 3014 & 2930
- B-057 · Install new parcel locker @ 115
- B-058 · Record lock-code changes — 3014 #3, 3014 #1, 1214 #3
- B-060 · Confirm Oscar can do inspections
- B-061 · Moving boxes — liquor store + box-recycling co (Spoon referral)
- B-062 · Get invoices from Mook (V-005)
- B-064 · Automate FedEx → FedEx store routing
- B-065 · Collect from Ray (NJ) — $5k behind on cargo-van tolls/bill
- B-066 · Automate weekly EZ-Pass toll pull → auto-invoice Ray
- B-067 · Re-itemize Cesar estimates into checklists; Cesar = major, Oscar = minor
- B-068 · Create invoices for Federal St job (off-Hub)
- B-069 · FU Fait Ave/St owner — collect payment + confirm no more leaks
- B-070 · Fait Ave/St — replace 3rd-floor pop-up assemblies
- B-071 · FU Vanity repair lead (FB) — time-sensitive
- B-087 · Unified vehicle-notice router (tolls, violations, recalls, MVA/registrat
- B-090 · Fleet Vehicle roster sheet — VIN/plate → current holder (Kingbee/GiddyUp
**RIDGE CO — ESTIMATING**
- B-030 · Estimating template system — reusable proposal generator
- B-031 · Estimating skill/agent — scope intake, photo review, line item generatio
- B-032 · Proposal PDF export — one-click PDF with hyperlinks from HTML proposal
- B-076 · Estimate-acceptance workflow — accept-all-in-section or cherry-pick w/ r
**BRETTOS INFRASTRUCTURE**
- B-013 · Scheduled context update — auto-push session log after each session
- B-014 · QB refresh token auto-renewal monitoring
- B-016 · Multi-venture dashboard — one page, all ventures status
- B-017 · Agent builder — create reusable agents for common tasks
- B-018 · Automated session log append after every Cowork session
- B-033 · Best Practices doc update — no AI-obvious filenames, no PDF header/foote
- B-051 · Daily digest of next steps + small wins — ✅ SHIPPED July 22 (GET /daily-digest + 7am cron; delivery dormant until Twilio; see FEATURE_LOG v1.7)
- B-052 · Voice interface → spreadsheet (voice-to-sheet capture)
- B-053 · Multi-step tags + categorization of captures
- B-054 · Context/location-aware task surfacing
- B-059 · Link tasks → projects (capture layer)
- B-091 · Reconcile with the REAL BrettOS task app (sheet 1X2oYjD) — append net-ne
- B-092 · Fix BrettOS integration sync error (Cloudflare 1042)
- B-074 · Lead-finder Chrome extension — scan FB posts needing repairs/lawn care, 
- B-081 · Lead capture that doesn't look bot/scammy/salesy
- B-089 · HSA receipt automation (future, personal) — upload receipts to HSA for r
**BARRELCO**
- B-019 · Google Sheet for SKU/inventory tracking
- B-020 · eBay API integration — auto-list new SKUs
- B-021 · Pricing tracker — compare sold prices to listed prices
- B-041 · FB Listings — post/refresh Facebook listings
- B-063 · Cancel Vendoo + any other paid FB apps
- B-078 · Inventory tracking — Community Forklift + outlets, integrated w/ their s
- B-079 · Retail-outlet tracker for leads (barrels + related products) + gather re
- B-080 · FB Marketplace / listing automation — respond to messages, capture off-F
- B-083 · AI-coordinated Waynesboro VA fulfillment — parents ↔ FB Marketplace buye
**CABIN (WV STR)**
- B-022 · Uplisting API connection — booking sync
- B-023 · Booking dashboard — occupancy, revenue, upcoming guests
- B-024 · Automated guest messaging via Uplisting
- B-025 · Expense tracking for cabin maintenance
- B-040 · Cabin shopping list from Gina (★)
**WINCHESTER HAULING**
- B-026 · Clarify current stack — what exists, what's manual
- B-027 · Driver portal — route assignment, pickup confirmation
- B-028 · Automated driver payment
- B-029 · CHEP/PECO reconciliation — pallets in vs out
**BRETTOS — EFFICIENCY & OPTIMIZATION (July 22 — see MODEL_ROUTING + CONTINUOUS_IMPROVEMENT briefs)**
- B-127 · Model-routing layer — secure DIY multi-model router in Worker (cheap-by-default + escalate; Gemini+Claude direct; PAT-031). Brief: `MODEL_ROUTING_BUILD_BRIEF_v1.0`
- B-128 · Job telemetry spine — `Ops_Telemetry` tab + logging (prerequisite for the Optimizer)
- B-129 · Optimizer: weekly Reviewer agent — reads telemetry → ranked improvement proposals (payoff/effort/risk/next-action)
- B-130 · Optimizer: Scout agent — research new skills/tools/models, filter for stack-fit, propose
- B-131 · Optimizer: Reuse-Radar — spot shared mechanisms across ventures before rebuilding
- B-132 · Winchester driver-payment system on the WO engine — verify pallet count → invoice → pay → SMS → recruitment signal (reuse of B-003/007/028/029)
**BRETTOS — SECOND BRAIN (July 22 — see SECOND_BRAIN_QUERY_BUILD_BRIEF_v1.0; CAP-028 #2 / CAP-015 / CAP-024)**
- B-133 · 🟠 Second Brain — **multi-role Ask agent** (v1.2): PIN-gated `ask.html` (EN/ES) + `POST /ask` (direct Worker call, NOT a Cowork session). **P0 = identity-scoped authorization.** v1 roles = **admin + vendor + owner + tenant** (driver designed-for but DEFERRED, low-pri). Each asker scoped to its allow-set (vendor: own WOs + assigned-property codes + own pay; owner: own properties/WOs/billing; tenant: own unit + WO status + tenant-shareable codes only). FACT (scoped Sheets) / SEMANTIC (Audience-filtered Brain, **LOCKED default**) / CAPTURE. Read+capture only; audit every sensitive answer. Seed Brain now. `Drop_Locations` = empty seam (low-pri bolt-on). Seed of Brett's vendor/driver/owner/tenant assistant (ties vendor.html, owner/tenant portals, B-055, B-132). Brief: `SECOND_BRAIN_QUERY_BUILD_BRIEF_v1.2`.
- B-134 · 🟠 Self-writing brain — nightly agent fills the `Brain` tab (chunks + freshness tags) and syncs the `Capture` tab → repo `CAPTURE_INBOX.md`. Makes "effortless growth" real; is CAP-024. The ingestion loop the phone reads. Ties B-124 (scan agent), B-103 (intake engine), B-123 (background agents).
- B-135 · 🟡 LEARNED.md valet-memory — every Brett correction becomes a `Brain` chunk (Source=learned) so the assistant retains nuance/exceptions (#257 "shirts need light starch"). Generalizes the HANDWRITING_KEY live-learning pattern to all domains.
- B-136 · 🟡 ⏳ SMS door for the brain — once Twilio is fixed, an inbound route calls the same `handleAsk`; caller-ID whitelist = auth; adds "reply MORE" + dictated MMS voice notes (finishes B-052). Blocked on Twilio setup fix.
- B-137 · 🟠 **Near-term notification stopgap (pre-Twilio)** — split delivery by recipient: **email auto-sends** (owners + email-capable tenants, via Gmail connector) NOW; **SMS = a Hub "Send Queue"** where the system composes each message (recipient + text + language) and Brett **one-taps to send from the number they already know** (`sms:` prefill for personal-number contacts; copy+open-thread for GV). AI does 100% of composing; Brett is the send button. **GV auto-send RULED OUT (verified July 22): no Google Voice send API; email-reply only works replying to inbound; 3rd-party email→SMS = paid middleman (skip).** Clean bridge to Twilio: same queue + templates flip to auto-send later. Ties B-093 (channel-tiering), B-133 (two-way owner/vendor lane).
- B-138 · 🟠 **Contact channel map** — add per-contact fields on Vendors/Tenants/Owners: `Brett_Number_Known` (personal / google_voice), `Preferred_Channel` (sms/email), `Lang`. Prerequisite for B-137 (which link to generate + who needs the intro) AND for Twilio later + the B-133 language pref. Known: **Mark & Amanda = GV; Jennifer & Adrian = personal;** rest = Brett fills in.
- B-139 · 🟡 **Vendor "Ridge Co line" intro** — one-time staggered message introducing the GV number as Brett's Ridge Co/dispatch line (NOT "reach me for most things" — framed as the job line so it stays honest when the assistant later sends codes/pay from it). EN + **ES (P0)** drafts done (July 22). **Only personal-number contacts get it** (Mark/Amanda already on GV). Send individually/staggered (GV daily limits + anti-spam). Gated on B-138.
**BRETTOS — AUTONOMY SUBSTRATE (July 23 — the safe path to autonomous multi-section builds; see CAP-029)**
- B-140 · 🟠 **Staging/preview Worker lane (autonomy prerequisite #1 — ISOLATION).** A genuinely isolated preview target so autonomous/risky code NEVER runs on the live Hub. Fix is the July 21 lesson (FEATURE_LOG rule 18): non-prod deploy command = `wrangler versions upload` → *preview URL*, never `wrangler deploy`. Until this exists, "Builds for non-production branches" stays OFF and no agent merges unattended. This is the gate everything else on the ladder sits behind.
- B-141 · 🟠 **Smoke-test harness (autonomy prerequisite #2 — SELF-VERIFICATION).** A script that curls every critical endpoint (list from CODEMAP) and asserts the expected JSON — the machine's stand-in for "Brett taps the app." Encode FEATURE_LOG regression rules as assertions where possible. Without this an agent literally cannot know it broke something. Runs against the B-140 preview lane.
- B-142 · 🟠 **ridgeco-validate skill (autonomy prerequisite #3 — REVIEW GATE).** Adversarial built-vs-brief validator; the missing 7th "software-factory" role. Reports gaps by severity, fixes nothing; mandatory for money/customer/auth. ✅ **DELIVERED July 23 (this session) as `ridgeco-validate.skill`** — save it. Wire into brett-flow as the step-5.5 gate.
- B-143 · 🟡 **Autonomy ladder (the governing strategy doc).** Blast-radius-gated staging: autonomy is EARNED per-section by rails (isolation + smoke + validator), never granted globally. Money/QB/customer-comms/auth stay human-gated by design. Ties B-127 router ("force Claude for money-facing" → extend to "force human"), B-129 Optimizer (validator verdicts = telemetry), CAP-029.
**BRETTOS — QUALITY LAYER (July 23 — the "not-broken is a FLOOR, quality is the CEILING" upgrade; see CAP-029)**
_The 5 verbs: DEFINE what good is → TEST for it positively → REVIEW against it → MEASURE it in prod → CALIBRATE the bar._
- B-144 · 🟠 **Quality Bar / Definition-of-Done rubric (DEFINE — the missing quality parameter).** Per change-class checklists of what "good" means beyond "it works": Worker endpoint (idempotent, auth-tagged, telemetry-logged, standard error shape, no N+1 sheet reads, WO-by-header-name); Hub screen (Status SSOT, one button system, mobile tap targets, EN/ES parity, loading/empty/error states); money change (penny-correct, no double-post, reconciles to QB). This is what ridgeco-validate and the reviewer score against. Foundational — build first.
- B-145 · 🟠 **Golden-path scenario tests + seeded fixture dataset (TEST positively).** Smoke = "endpoint answers 200"; golden = "create WO → assign → bill → approve → QB posts correct amount → status flips to Paid." End-to-end business-outcome assertions on the B-140 preview lane, run against a SEEDED test Sheet/tenant so autonomous runs never touch real records (also closes the "single live DB" blocker). 
- B-146 · 🟠 **Quality-reviewer agent (REVIEW — second lens beyond ridgeco-validate).** Validator = "matches the brief"; reviewer = "is it GOOD" — a multi-lens panel (correctness / security / SSOT-consistency / mobile-UX / i18n / data-integrity), higher effort for money/customer code. Adopts the "software-factory" security-reviewer + accessibility-reviewer roles as rubric lenses.
- B-147 · 🟡 **Quality KPIs into the Optimizer (MEASURE — quality you can't see isn't quality).** Post-deploy signals: error rate + p95 latency per endpoint, QB reconciliation drift, **Brett-corrections-per-feature**, vendor task-completion rate, EN/ES coverage %. Feed B-128 telemetry spine → B-129 Optimizer so a feature that ships clean but creates support pain SHOWS UP. Ties PAT-032.
- B-148 · 🟡 **Canary rollout + automated rollback (MEASURE/safety).** Even after gates pass: deploy behind a flag / to a canary slice, watch the B-147 KPIs for N hours, auto-rollback on threshold breach. Automates the rule-18 manual `main` force-redeploy. Reversibility = a quality property.
- B-149 · 🟡 **House-style consistency checks (REVIEW — the no-framework linter).** Encode conventions as checks since there's no framework: every endpoint uses the auth helper, resolves WO by header name (rule-6 bug), uses QB_TRADE_MAP, returns the standard error shape, conforms to Status SSOT. Directly attacks the UX-audit rot (status defined ~22 ways, 5 button systems).
- B-150 · 🟡 **Quality-gate policy + Brett spot-check sampling (CALIBRATE — the teeth).** Merge thresholds by blast radius (money = 100% rubric + human; internal tooling = auto-merge at ≥Nq score). Plus 1-in-N Brett spot-review even of auto-merged work so the bar stays calibrated to his taste and agents don't drift. Ties the autonomy ladder (B-143).
**RIDGE CO — BIG BUILD QUEUE (planned July 22, 2026)**
- B-093 · Notification engine v2 — quiet-hours + channel routing + test/admin mute
- B-094 · WO-create vendor SMS opt-out checkbox (default OFF 8pm–8am ET)
- B-095 · Tenant + owner after-hours silent mode — email instead of SMS 8pm–8am ET
- B-096 · Split work order + dependencies
- B-097 · Vendor-triggered recurring WO w/ smart clock-reset
- B-098 · Recurring WO from template + seasonal windows
- B-099 · Template-from-vendor trigger → mark-complete + QB, no SMS
- B-100 · Pre-triggered / dependency WOs (turnover cleaner)
- B-101 · Estimate approval with start-date + deadline
- B-102 · Hub UI redesign to the Fairfax-estimate design standard
- B-103 · Email → Work Order intake engine (Buildium + manual lists) — auto-create WOs from customer emails
**JULY 21 CAPTURES (from Scanned_202607211020 + …1341 → CAP-027/028)**
- B-104 · STR cleaner scheduling system (cleaner self-serve availability + SMS + calendar sync) [Cabin]
- B-105 · Cabin STR Dashboard & Alerts app (turns, shopping list, hot tub, lock battery, reviews, docs…) [Cabin]
- B-106 · Long-term lease management + self-inspection requirement [Ridge Co]
- B-107 · Post-repair tenant feedback capture [Ridge Co]
- B-108 · Bulk-share all Drive folders (with owner-info privacy scoping) [Ridge Co/BrettOS]
- B-109 · 928 N Calvert St water heater — contact manufacturer for warranty [Ridge Co task]
- B-110 · Refer Charles Barnett → Tom Bialek @ Ecowise (energy upgrades) [Ridge Co task]
- B-111 · Add 4518 Fairfax as property + record Apt 1 lockbox code (stored privately) [Ridge Co task]
- B-112 · New-property checklist + intake form → properties database [Ridge Co] (ties B-073)
- B-113 · AI dispatch tool (troubleshoot summary + model info → WO → vendor); pilot 3014 washer [Ridge Co]
- B-114 · Vendor text-message mining → surface info gaps for WO system [Ridge Co]
- B-115 · Vendor tools & equipment tracking → auto-dispatch/assignment input [Ridge Co]
- B-116 · Vendor availability & schedule prefs (blackout hours/vacations; defer assignment SMS to next avail day) [Ridge Co] (extends B-093/B-094)
- B-117 · WO as shareable HTML + PDF + owner Drive download, owner-privacy scoped [Ridge Co]
- B-118 · Z-Inspector app + inspection template for Phoenix Real Estate (client Mark) → tie into Ridge Co
- B-119 · Ridge Co website + SEO
- B-120 · Winchester Hauling website + SEO
- B-121 · Ridge Co Facebook profile overhaul
- B-122 · BarrelCo — create own Facebook group for barrels (ties B-080)
- B-123 · Scheduled background agents that act on Brett's to-dos overnight/off-peak (analyze + build) [BrettOS]
- B-124 · Scan Intake Agent — DAILY 12am poll of the handwriting Drive folder → OCR + handwriting-key learning + auto-file CAP/BACKLOG + auto-create entities (property/tenant/owner/WO + lockbox), tagged+reported [BrettOS] (first instance of B-123; reuses B-103 intake engine)
- B-125 · Hub quick-command bar — voice/text NL input ("create new property 123 Main St Baltimore MD lockbox 1234") → parse → execute entity action (new property/WO, new/update lockbox·key·access code) [Ridge Co Hub]
- B-126 · Owner portal billing + marked-up-estimate approval — amounts + invoice link + approve/decline the POST-markup estimate (after Brett reviews, never raw vendor est) [Ridge Co Hub] (from Design Foundation v1.1; builds on B-030/B-101/Invoice_Review)
<!-- QUICK-INDEX:END -->


## IN PROGRESS

| ID | Venture | Item | Blocker |
|---|---|---|---|
| B-015 | Ridge Co | QuickBooks Send-to-QuickBooks flow (invoice + bill + payment) | 🟡 INVOICE+BILL SHIPPED July 20 (pending Brett live-verify) — `/qb/send-invoice` preview-first: creates QB Invoice + Bill from Invoice_Review; find-or-create customer/vendor; custom final price + quick-picks; per-receipt reimburse/on-account classification (vendor payable excludes on-account); labor summary + per-receipt material lines; CustomerMemo job-photo link; receipt attachments (all→Invoice, reimburse→Bill); refresh-token persistence; WO→Invoiced. **Remaining (Phase 2):** payments (Payment + BillPayment, QB_Payment_ID col), overpay guard, vendor-pay worklist, payment webhooks (auto status-back). |

---

## RIDGE CO — WORK ORDER MANAGEMENT

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-001 | ✅ | QB invoice creation from approved Invoice_Review rows | SHIPPED July 20 via `/qb/send-invoice` (preview-first). Pending Brett live-verify. |
| B-002 | ✅ | QB bill recording when vendor bill approved | SHIPPED July 20 via `/qb/send-invoice` (creates the vendor Bill alongside the invoice). Pending live-verify. |
| B-003 | 🟠 | Work order creation from index.html | Full form — property, trade, vendor assignment, priority |
| B-004 | 🟠 | Vendor assignment + reassignment from index.html | Dropdown + history |
| B-005 | 🟠 | Payment tracking — record when customer pays | Link QB payment status back to sheet |
| B-006 | 🟡 | Tenant portal — report issues, view WO status | Separate page or section |
| B-007 | 🟡 | Automated vendor payment via QuickBooks | Once QB API live: schedule vendor payment when customer pays |
| B-008 | 🟡 | Email/SMS notifications — vendor gets WO assigned | Twilio or similar |
| B-009 | 🟡 | Email/SMS notifications — Brett gets bill submitted for review | |
| B-010 | 🟢 | WO completion photos auto-organized in Drive | Subfolder structure now live — verify old WOs if needed |
| B-011 | 🟢 | Invoice PDF generation for customers | QB handles this once API live |
| B-012 | 🟢 | Vendor performance dashboard | On-time rate, average job cost, photo compliance |
| B-055 | 🟠 | Lock-code registry — add "parcel locker" category (shareable-with-tenant) | Distinct from lockboxes/door codes; parcel-locker codes can be shared with tenants (situational), others cannot. ⚠ No dedicated lock-code tab in known schema — confirm exists or build. From CAP-016. |
| B-072 | 🟠 | Trade/repair standards + recurring-opportunistic task engine | If/then by trade for multi-unit; time-based surfacing (e.g. 5.25 of a 6-mo cycle); opportunistic tasks done when already on-site; auto-attach to WOs at that property. Rec: track-don't-gate pay; tiny safety subset requires check or "N/A+reason"; require data-capture not repair; optionally incentivize. Ties CAP-010. From CAP-017. |
| B-073 | 🟠 | Properties onboarding site for customers (add properties; CSV import) | Multiple inputs / CSV. From CAP-018. |
| B-075 | 🟡 | Upgrade Hub UI to match the 4518 Fairfax Rd estimate look | Brett's UI baseline. From CAP-018. |
| B-077 | 🟡 | Preventive-maintenance package | Ties B-072 standards engine + CAP-010. From CAP-018. |
| B-082 | 🟠 | Cesar mirror site — tracks his own jobs separately but includes Brett's | Vendor-portal extension. Ties CAP-010. From CAP-018. |
| B-084 | 🟠 | Hub "Receipts to file" queue — OCR + classify + seeded WO/property picker → post (preview-first) | Confirm-first. 3 categories: customer WO-materials (billable), owned-property expense (e.g. 1864 Kerns STR), business expense ("BMore"). Read hand-written property/WO/"BMore" first → else learned vendor-default (seed: Advance Auto→BMore) → else ask. Customer-charge check; no double-billing. All → QB + filed to Vendors drive. From CAP-002. |
| B-085 | 🟠 | Rebuild receipt intake pipeline — retire the stalled Make.com scenario | Diagnosed July 19: "WO Receipt Inbox" (id 1BpJXcOlW98…) has 10+ receipts stuck since Aug–Dec 2025; Make.com watch→email→move is dead. Replace with Hub pipeline (B-084): QB posting via the connected API + Apps Script file moves. From CAP-002. |
| B-086 | 🟡 | Reconcile receipts stuck in "WO Receipt Inbox" (Aug–Dec 2025) | 10+ PDFs never processed; confirm which already reached QuickBooks, record/attach the rest, then file by vendor. From CAP-002. |
| B-088 | 🟡 | Add 1864 Kerns School Rd (owned STR) to the WO system as a property | For expense tracking; its STR expenses usually have no WO but should apply to the property. From CAP-002. |

---

## RIDGE CO — OPERATIONS / TO-DO
*(Operational to-dos captured from Brett's notes — not builds. Source: CAP-012, CAP-014.)*

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-034 | 🟠 | Source a reliable plumber/handyman subcontractor | Leads dead-ended: Marvin Calderon, Al Stratti (plumber), Rob Whitley (plumber). Action: ask existing contacts for handyman referrals. |
| B-035 | 🟠 | Follow up with Cesar (Mon) on the 56 S Culver St job | Cesar got the Culver job (V-003). Written note read "Oscar Culver," but it went to Cesar. |
| B-036 | 🟢 | Confirm $300 extra to Cesar (V-003) for 807 N Calvert St bakery floor prep is booked in QB | Legit per Brett — floor repairs were needed before the install (807 N Calvert St bakery, NOT Culver). Owed, not an overpay. |
| B-037 | 🟠 | Follow up with Cesar (Mon) on the Gibbons jobs | Captured from Scan_2032 session, July 19. |
| B-038 | 🟠 | MD taxes payment plan — set up | From CAP-014. |
| B-039 | 🟠 | LLC renewal + annual report | Entity address on note: 1864 Kerns School Rd. From CAP-014. |
| B-042 | 🟡 | Update tenant records — William (3014 #3), Julie (115 #2), 2930 1R, 115 #1 | All marked "?" — verify then update Tenants tab. From CAP-014. |
| B-043 | 🟠 | Invoice batch still owed — Bakery + 153 #2 + 2930 detector | Note said "151 #2" but it's **153 #2**. "Sunday invoices." From CAP-014. |
| B-044 | 🟡 | Capture WO labor time from messages (Jenn + Mark/Amanda) | Recover billable time buried in message threads. From CAP-014. |
| B-045 | 🟡 | Work orders — 151 Apt 2 & 3 turns | From CAP-014. |
| B-046 | 🟡 | WO 115 Apt 2 — troubleshoot invoice | From CAP-014. |
| B-047 | 🟡 | Invoice Ashburton — diagnose + troubleshoot (2 hrs) | See B-050 for the 1st-hour billing question. From CAP-014. |
| B-048 | 🟡 | WO 153 #2 — HVAC leak, add time | From CAP-014. |
| B-049 | 🟠 | Pay Sergio — bills entered, needs paid | Sergio = vendor. From CAP-014. |
| B-050 | 🟡 | QB billing method — how to bill the 1st hour without looking like padding | Brett's model: $75 service charge covers the 1st hour, then $75 each additional hour. Ties to QB invoicing (B-001/B-015). From CAP-014. |
| B-056 | 🟡 | Change parcel-locker batteries — 3014 & 2930 | From CAP-016. |
| B-057 | 🟡 | Install new parcel locker @ 115 | From CAP-016. |
| B-058 | 🟡 | Record lock-code changes — 3014 #3, 3014 #1, 1214 #3 | From CAP-016. |
| B-060 | 🟢 | Confirm Oscar can do inspections | From CAP-017. |
| B-061 | 🟢 | Moving boxes — liquor store + box-recycling co (Spoon referral) | Personal (Brett is moving). From CAP-017. |
| B-062 | 🟡 | Get invoices from Mook (V-005) | From CAP-017. |
| B-064 | 🟡 | Automate FedEx → FedEx store routing | From CAP-017. |
| B-065 | 🟠 | Collect from Ray (NJ) — $5k behind on cargo-van tolls/bill | Ray holds one of Brett's vans off-platform, never pays in full. Cash-flow (CAP-001/CAP-007). From CAP-017. |
| B-066 | 🟡 | Automate weekly EZ-Pass toll pull → auto-invoice Ray | Pull toll data weekly, generate + send invoice. From CAP-017. |
| B-067 | 🟡 | Re-itemize Cesar estimates into checklists; Cesar = major, Oscar = minor | Ties estimating B-030/031. From CAP-017. |
| B-068 | 🟠 | Create invoices for Federal St job (off-Hub) | ⚠ Job not in Maintenance Hub. From CAP-017. |
| B-069 | 🟠 | FU Fait Ave/St owner — collect payment + confirm no more leaks | From CAP-017. |
| B-070 | 🟢 | Fait Ave/St — replace 3rd-floor pop-up assemblies | Low priority; combine with other work unless owner wants sooner. From CAP-017. |
| B-071 | 🔴 | FU Vanity repair lead (FB) — time-sensitive | High priority; FB lead likely cooling, follow up ASAP. From CAP-017. |
| B-087 | 🟡 | Unified vehicle-notice router (tolls, violations, recalls, MVA/registration) — route by VIN/plate | Look up Holder in Fleet roster (B-090) → send + 5-day follow-up until confirmed; dedup vs already-sent; file under Vendors/manager. **Holder→email:** KingBee tolls=tolls@kingbee-vans.com, KingBee recalls/other=hive.network@kingbee-vans.com; Giddyup=info@giddyuprentals.com; Ray Lewis=accounting@lewisdrums.com + rlewis@lewisdrums.com; **LIEN (AUP135)=route to Brett**. NJ-van TOLLS = EZ-Pass exception. **MVA/registration notices: forward ONLY for KingBee vans; GiddyUp/Ray Lewis/LIEN → Brett resolves (no forward).** SEND MODE: drafts-for-review default + templated cover note stating the ask; auto-send later. Apps Script/Worker. From CAP-020/022, CAP-005. |
| B-090 | 🟠 | Fleet Vehicle roster sheet — VIN/plate → current holder (Kingbee/GiddyUp/Ray Lewis) | Backbone for the vehicle-notice router (B-087) + compliance/registration (CAP-005/006). Sheet `11HVkmGOKhTveAXGajs0_pTOkPaZk6HXxZmx1h2wz_nY` READ July 19 — has VIN, plate (MD Tag #), Holder (KingBee/LIEN/Ray Lewis/Giddyup). 8 vans + 2 Turo. Service account SHARED July 19 — **unblocked.** Remaining: normalize Holder values; holder→email map lives in router config (B-087). Ready to wire. From CAP-022. |

---

## RIDGE CO — ESTIMATING

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-030 | 🟠 | Estimating template system — reusable proposal generator | Intake form (Sheet or structured input) → auto-generated HTML proposal. Base design on 4518 Fairfax Rd v1.1 as reference. ~2hr build session. |
| B-031 | 🟠 | Estimating skill/agent — scope intake, photo review, line item generation | Replace Gemini workflow. Ask questions, stick to provided scope, no invented items, build memory of Brett's pricing patterns. |
| B-032 | 🟡 | Proposal PDF export — one-click PDF with hyperlinks from HTML proposal | Chromium headless print-to-PDF. Links to Drive photos must survive. |
| B-076 | 🟠 | Estimate-acceptance workflow — accept-all-in-section or cherry-pick w/ running total | Ties B-030/B-032. From CAP-018. |

---

## BRETTOS INFRASTRUCTURE

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-013 | 🟠 | Scheduled context update — auto-push session log after each session | GitHub Actions or Cowork scheduled task. Recurring reminder now set. |
| B-014 | 🟠 | QB refresh token auto-renewal monitoring | Alert Brett 2 weeks before 100-day expiry |
| B-016 | 🟡 | Multi-venture dashboard — one page, all ventures status | BrettOS homepage |
| B-017 | 🟡 | Agent builder — create reusable agents for common tasks | Cowork skill |
| B-018 | 🟢 | Automated session log append after every Cowork session | Claude writes session summary to BACKLOG + SESSION_LOG |
| B-033 | 🟡 | Best Practices doc update — no AI-obvious filenames, no PDF header/footer rule | Add as Section 14 to Brett_Cowork_Best_Practices_v1.3 → v1.4 |
| B-051 | 🟠 | Daily digest of next steps + small wins | Attach new entries to major projects; leave space for more entries (FU's, invoices). From CAP-015. |
| B-052 | 🟠 | Voice interface → spreadsheet (voice-to-sheet capture) | From CAP-015. |
| B-053 | 🟡 | Multi-step tags + categorization of captures | From CAP-015. |
| B-054 | 🟡 | Context/location-aware task surfacing | Suggest on-the-way / nearby / same-context tasks (@ Home Depot, waiting in line). Form-factor: phone-first vs desktop. From CAP-015. |
| B-059 | 🟡 | Link tasks → projects (capture layer) | Reinforces CAP-015 "attach entries to major projects." From CAP-017. |
| B-091 | 🟠 | Reconcile with the REAL BrettOS task app (sheet 1X2oYjD) — append net-new only, dedup | The BrettOS Tasks sheet already exists + holds ~25 of our items (bulk-pasted July 14). Append ONLY net-new (via sheet-ops); BrettOS sheet = canonical task home, repo = deep notes feeding it. From CAP-024/CAP-025. |
| B-092 | 🟠 | Fix BrettOS integration sync error (Cloudflare 1042) | maintenance_hub + barrelco syncs into BrettOS failing every 6h since July 14 (Integration Logs). From CAP-025. |
| B-074 | 🟡 | Lead-finder Chrome extension — scan FB posts needing repairs/lawn care, respond, exclude "I need it today" | From CAP-018. |
| B-081 | 🟡 | Lead capture that doesn't look bot/scammy/salesy | Cross-cuts B-074/B-080. From CAP-018. |
| B-089 | 🟢 | HSA receipt automation (future, personal) — upload receipts to HSA for reimbursement | Mirrors CAP-002 pipeline; receipts folder in personal Drive; provider upload may need browser automation. From CAP-021. |
| B-140 | 🟠 | **Staging/preview Worker lane** — autonomy prerequisite #1 (isolation) | `wrangler versions upload` → preview URL, never `deploy`. Fixes FEATURE_LOG rule 18. Gate for all autonomous/risky code. From CAP-029. |
| B-141 | 🟠 | **Smoke-test harness** — autonomy prerequisite #2 (self-verification) | curl-assert every critical endpoint from CODEMAP + FEATURE_LOG rules as assertions; runs against B-140 preview. Machine stand-in for Brett's tap-test. From CAP-029. |
| B-142 | 🟠 | **ridgeco-validate skill** — autonomy prerequisite #3 (review gate) | Adversarial built-vs-brief validator; fixes nothing; mandatory for money/customer/auth. ✅ DELIVERED July 23 as `ridgeco-validate.skill`. Wire into brett-flow step 5.5. From CAP-029. |
| B-143 | 🟡 | **Autonomy ladder** — governing strategy doc | Blast-radius-gated: autonomy earned per-section by rails, never global; money/QB/customer/auth stay human-gated. Ties B-127/B-129. From CAP-029. |
| B-144 | 🟠 | **Quality Bar / Definition-of-Done rubric** — DEFINE (the quality parameter) | Per change-class "what good is" checklists; what validator+reviewer score against. Build first. From CAP-029. |
| B-145 | 🟠 | **Golden-path scenario tests + seeded fixtures** — TEST positively | End-to-end business-outcome assertions on B-140 preview against a test Sheet/tenant; also closes single-live-DB blocker. From CAP-029. |
| B-146 | 🟠 | **Quality-reviewer agent** — REVIEW (2nd lens beyond ridgeco-validate) | Multi-lens panel: correctness/security/SSOT/mobile/i18n/data-integrity. From CAP-029. |
| B-147 | 🟡 | **Quality KPIs into the Optimizer** — MEASURE | error rate, p95, QB drift, Brett-corrections/feature, EN/ES coverage → B-128/B-129. From CAP-029. |
| B-148 | 🟡 | **Canary rollout + automated rollback** — MEASURE/safety | flag/canary, watch KPIs N hrs, auto-rollback on breach; automates rule-18 rollback. From CAP-029. |
| B-149 | 🟡 | **House-style consistency checks** — REVIEW (no-framework linter) | auth helper, WO-by-header, QB_TRADE_MAP, standard error shape, Status SSOT. From CAP-029. |
| B-150 | 🟡 | **Quality-gate policy + Brett spot-checks** — CALIBRATE | merge thresholds by blast radius + 1-in-N human spot-review of auto-merged work. Ties B-143. From CAP-029. |

---

## BARRELCO

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-019 | 🟡 | Google Sheet for SKU/inventory tracking | Share with service account when created |
| B-020 | 🟢 | eBay API integration — auto-list new SKUs | Needs eBay Developer token |
| B-021 | 🟢 | Pricing tracker — compare sold prices to listed prices | |
| B-041 | 🟡 | FB Listings — post/refresh Facebook listings | From CAP-014 / Scan_2104. |
| B-063 | 🟡 | Cancel Vendoo + any other paid FB apps | Cost-cut (crosslisting app). From CAP-017. |
| B-078 | 🟡 | Inventory tracking — Community Forklift + outlets, integrated w/ their sales statements; min levels + restock | Ties B-019. From CAP-018. |
| B-079 | 🟡 | Retail-outlet tracker for leads (barrels + related products) + gather restock contact info | From CAP-018. |
| B-080 | 🟠 | FB Marketplace / listing automation — respond to messages, capture off-FB contacts, renew/delete/repost listings, contact prior interested buyers; rebuild a better "Nerdy Panda" | From CAP-018. |
| B-083 | 🟢 | AI-coordinated Waynesboro VA fulfillment — parents ↔ FB Marketplace buyer | Parents store limited planters/barrels in Waynesboro VA + complete local sales (free secondary market). Future. UX for mother: non-tech-savvy, patient, repeat-friendly. From CAP-018. |

---

## CABIN (WV STR)

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-022 | 🟡 | Uplisting API connection — booking sync | Check developer.uplisting.io |
| B-023 | 🟡 | Booking dashboard — occupancy, revenue, upcoming guests | |
| B-024 | 🟢 | Automated guest messaging via Uplisting | |
| B-025 | 🟢 | Expense tracking for cabin maintenance | |
| B-040 | 🟢 | Cabin shopping list from Gina (★) | From CAP-014 / Scan_2104. |

---

## WINCHESTER HAULING

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-026 | 🟠 | Clarify current stack — what exists, what's manual | Need session with Brett |
| B-027 | 🟡 | Driver portal — route assignment, pickup confirmation | |
| B-028 | 🟡 | Automated driver payment | QB or ACH |
| B-029 | 🟢 | CHEP/PECO reconciliation — pallets in vs out | |

---

## RIDGE CO — BIG BUILD QUEUE (planned July 22, 2026)
*Sequenced plan + testing strategy live in the July 21 build-plan doc. Consolidates the RidgeCo Main "Wishlist" tab (76 items) + these new asks. Priority: Ridge Co. Nothing ships without a test.*

**Locked decisions (July 21):** tomorrow = quick wins → security fix (per-user auth; **phone-only tenant login**) + fix the live 401 sync outage (B-092) → status-enum SSOT → Cron infra → Phase 1 notifications (**hold-SMS-til-8am**, email deferred). UI redesign = **Phase 4** (after engine stable).

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-093 | 🟠 | Notification engine v2 — quiet-hours + hold-til-8am + test/admin mute + **channel-tiering** | Wrap the single `sendSMS` chokepoint (worker.js:1627): preference check, 8pm–8am ET quiet hours = **HOLD SMS til 8am via the notification queue + Cron**; test-mode + admin-mute (2hr auto-resume via Config flag). **Owner channel policy (Brett, July 22):** owner **SMS/push = milestones ONLY — Scheduled, Complete, On Hold (+reason)**; all other detail → **email** (re-enables the email channel for owners specifically; it stays deferred elsewhere). **Owner SMS is two-way** — an owner can reply with requirements → route the inbound to the WO notes + a Capture, and it IS the owner lane of the Ask agent (B-133). Milestones map to the Status SSOT (Scheduled=event; Complete; On Hold w/ reason; owner label mask applies). Generalizable pattern: status→SMS, detail→email, per role. Foundation for B-094/B-095. New asks + Wishlist #8/#32. |
| B-094 | 🟠 | WO-create vendor SMS opt-out checkbox (default OFF 8pm–8am ET) | Checkbox on new-WO/assign form; default off during quiet hours; suppresses the vendor-assign SMS (worker.js:703). Sits on B-093. |
| B-095 | 🟠 | Tenant + owner after-hours silent mode (hold SMS til 8am) | Same 8pm–8am ET quiet window; HOLD the SMS until 8am next-day via the notification queue + Cron. **Owner channel policy (July 22, see B-093):** owners get SMS for milestones only (Scheduled/Complete/On Hold+reason), detail via email, two-way replies routed to WO notes + B-133 owner lane. Sits on B-093. |
| B-096 | 🟠 | Split work order + dependencies | Parent/child WOs from one request; dependency chains (cleaner after painter). Greenfield (no split today). Wishlist #16. |
| B-097 | 🟠 | Vendor-triggered recurring WO w/ smart clock-reset | Vendor triggers next occurrence to attach a bill; reset the recurrence clock only if actual is close to schedule (13d on a 14d cycle = no reset; weekly on a biweekly = reset). Ties B-098. |
| B-098 | 🟠 | Recurring WO from template + seasonal windows | Template carries a default schedule (editable on template AND instance); recurs only between start/end dates (growing season; fall leaf cleanup). Needs Cron + recurrence model. Wishlist #33. |
| B-099 | 🟠 | Template-from-vendor trigger → mark-complete + QB, no SMS | Create WO from a template tied to a vendor on receipt of their bill (e.g. fire-extinguisher service); default Complete, suppress SMS, push to QB. |
| B-100 | 🟠 | Pre-triggered / dependency WOs (turnover cleaner) | Schedule a WO in advance tied to a move-out date and/or another WO; notify the assignee when the dependency (painter) completes; earliest-start = move-out. Wishlist #13/#63. |
| B-101 | 🟠 | Estimate approval with start-date + deadline | Approve estimate but earliest-start = +N days; add to calendar; vendor notice carries earliest-start + deadline disclaimer. Builds on approveEstimate (worker.js:1064). |
| B-102 | 🟡 | Hub UI redesign to the Fairfax-estimate design standard | Codify the 4518 Fairfax estimate look as the Hub design system (minimum standard, then elevate). Design-led track; do AFTER functional stability. Wishlist #23/#30/#57/#70/#75/#76. |
| B-103 | 🟠 | Email → Work Order intake engine (Buildium + manual lists) | Source-agnostic intake engine + pluggable parsers. Apps Script poller forwards new maintenance emails → new `POST /intake` in worker.js → detect source → parse → find-or-create Owner/Property/Unit/Tenant → pull photos (S3→Drive) → `createWorkOrder` with `Owner_WO_Ref` → notify admin (`onIntakeCreated` = auto-assign seam). v1 = engine + **Buildium parser** (deterministic, high-confidence, auto-create) + **manual-list AI parser** (Mark's free-text lists → new `Intake_Queue` tab + Hub review screen → `/intake/approve`). Keyword trade-guess (easily overridable). Dedicated `INTAKE_TOKEN`. Build on a **staging branch + test sheet** (see EMAIL_INTAKE_BUILD_BRIEF). Decisions locked July 21. Full plan: `RidgeCo_Email_Intake_Build_Plan_v1.0` + `context/EMAIL_INTAKE_BUILD_BRIEF_v1.0.md`. Phase D (auto-assign) + AppFolio parser = future. |

**Also — escalate B-092 (integration sync):** since the July 20 `WORKER_SECRET` rotation the BrettOS sync into maintenance_hub + barrelco is now **HTTP 401 Unauthorized** (was error 1042) — the sync caller still uses the OLD secret. Urgent quick-fix; ties the security work (Phase 0). Barrelco also throws an `atob()` base64 error (separate).


## JULY 21 CAPTURES (from Scanned_202607211020 + …1341 → CAP-027/028)

| ID | Pri | Item | Notes |
|---|---|---|---|
| B-104 | 🟡 | STR cleaner scheduling system (Cabin) | Site for cleaners to see the schedule + pick dates / mark availability; push SMS for last-minute bookings + approaching uncovered dates; sync Brett's calendar. First "describe current process." Feeds B-105. From CAP-027. |
| B-105 | 🟡 | Cabin STR Dashboard & Alerts app | Single app: upcoming uncovered turns, shopping list, list of automations, reviews needed, doc links (keep-up-to-date), hot tub status, lock battery status, maintenance scheduling, guest feedback. Parent for B-104. From CAP-028. |
| B-106 | 🟡 | Long-term lease management + self-inspection requirement (Ridge Co) | System to manage long-term (non-STR) leases; includes a self-inspection requirement. From CAP-027. |
| B-107 | 🟡 | Post-repair tenant feedback capture | Collect tenant feedback after repair services complete. Ties B-006 tenant portal. From CAP-027. |
| B-108 | 🟡 | Bulk-share all Drive folders | One action to share all WO/property Drive folders — scoped so owners only see what they need (ties B-117 + FEATURE_LOG privacy rule 13). From CAP-027. |
| B-109 | 🟠 | 928 N Calvert St water heater — warranty | Contact the water-heater manufacturer for warranty (unit 928). Street = **Calvert** confirmed July 21 (matches 807 N Calvert; Culver = 56 S Culver, different property). Ops task. From CAP-027. |
| B-110 | 🟢 | Refer Charles Barnett → Tom Bialek @ Ecowise | Referral for rental-property energy-savings upgrades. Names confirmed July 21 (Bialek, Ecowise). Networking task. From CAP-027. |
| B-111 | 🟠 | Add 4518 Fairfax property + Apt 1 lockbox code | Create 4518 Fairfax as a property in the Hub; record the Apt 1 unit-door lockbox code (**code stored privately in the data repo, kept out of this public file**). Ties B-055 lock-code registry. From CAP-027. |
| B-112 | 🟡 | New-property checklist + intake form → properties DB | Turn Brett's new-property checklist + info-gathering form into a structured intake that builds the properties database. Ties B-073 onboarding site. From CAP-028. |
| B-113 | 🟠 | AI dispatch tool (troubleshoot + model info → WO → vendor) | Summarize troubleshooting and gather appliance make/model BEFORE creating the WO + dispatching to the vendor (e.g. washing machine). **Pilot on the 3014 washer.** Ties CAP-010 repair gems/Equipment Registry + B-072. From CAP-027/028. |
| B-114 | 🟡 | Vendor text-message mining → info-gap surfacing | Pull vendor text threads to surface information gaps the WO system should capture; feed the dispatch/info-gathering flow. Ties B-044, B-113. From CAP-028. |
| B-115 | 🟡 | Vendor tools & equipment tracking | Track what tools/equipment each vendor has, for use as an auto-dispatch/assignment input. Ties CAP-010 + B-113. From CAP-028. |
| B-116 | 🟠 | Vendor availability & schedule preferences | Per-vendor: no weekends / no evenings / etc; block notifications during set hours + vacations; option to block all except part notifications; **defer assignment SMS to the next available day after a block**. **Directly extends the Phase-1 notification build (B-093/B-094)** — fold in there. From CAP-028. |
| B-117 | 🟡 | WO as shareable HTML + PDF + owner Drive download | Render work orders as an HTML site sendable as links or PDFs; downloadable into a Google Drive folder — WITHOUT exposing other-owner info. Ties B-011, B-032, privacy rule 13. From CAP-028. |
| B-118 | 🟡 | Z-Inspector app + inspection template (Phoenix Real Estate) | Build the **Z-Inspector app** + an inspection template for **Phoenix Real Estate** and tie into Ridge Co. Phoenix = client **Mark**'s company (Mark + assistant **Amanda** both have **owner** access on the Hub portal). From CAP-028. |
| B-119 | 🟡 | Ridge Co website + SEO | Public marketing site with SEO. From CAP-027. |
| B-120 | 🟡 | Winchester Hauling website + SEO | Public marketing site with SEO. From CAP-027. |
| B-121 | 🟢 | Ridge Co Facebook profile overhaul | Revamp the Ridge Co FB business profile. From CAP-027. |
| B-122 | 🟢 | BarrelCo — own Facebook group for barrels | Create Brett's own FB group for barrel sales (vs relying on existing yard-sale groups). Ties B-080, CAP-018. From CAP-027. |
| B-123 | 🟡 | Scheduled background agents on to-dos | Separate agents that run in the background on a schedule (overnight / off-peak) to act on Brett's to-do items — analyze + build. Operating directive, not just a feature; ties the "autonomous ops" goal + CAP-015 + "Second Brain" (CAP-028 #2). From CAP-028. |
| B-124 | 🟠 | **Scan Intake Agent** (first B-123 instance) | **Cadence: DAILY 12:00am ET** (changed from hourly July 21 — hourly full-session polls too costly; midnight run "gets things ready for the next day"). **Write behavior: auto-create live records, tagged "Unverified — from scan", and report each (Brett's choice July 21).** Scheduled task polling the handwriting Drive folder (`1iXjjwsnPKF_GtlR8gesxS9uJppO4xntZ`) for NEW scans (diff vs a processed-file ledger — connector can't move/rename, so track by file ID; a `Processed` subfolder exists but is manual-only). For each new scan: OCR → append handwriting-key improvements → split into (a) **ideas/tasks** → CAP/BACKLOG (today's manual flow, automated), and (b) **structured entity actions** → find-or-create **Property / Tenant / Owner / Work Order + lockbox code** via worker routes (`/property/add`, `/tenant/add`, `/owner/add`, `/workorder`, `/key/add`+`/key/update`). New WO w/ missing property → create the property first, tag ownership + tenant. Goal: a property record exists so Brett can attach WO photos/inspections on a site visit. **Reuses the B-103 source-agnostic `/intake` engine** as the "handwriting parser" (don't duplicate find-or-create). **Open blockers:** (1) headless credential availability — a scheduled fresh session may lack the Drive connector + the write path (WORKER_SECRET for worker calls; GitHub PAT for repo/sheet-ops); first fire self-tests + reports. (2) write-behavior decision (auto-create-tagged vs review-queue). From CAP-028 #7; ties B-123, B-103, B-055. |
| B-125 | 🟠 | **Hub quick-command bar** (voice/text → action) | A command box on the Hub dashboard (index.html) that takes **voice (Web Speech API on Android Chrome) or typed** free text and just executes: "create new property 123 Main St Baltimore MD with lockbox code 1234", "new work order at 928 N Calvert — no hot water", "update lockbox 1214 #3 to 4471", "new key/access code …". New `POST /command` worker route → LLM parse (worker already has an AI binding via `generateEstimateText`/`translateToEnglish`) → structured `{action, entity, fields}` → route to existing handlers (`/property/add`, `/workorder`, `/key/add`, `/key/update`, `/tenant/add`, `/owner/add`). New WO w/ missing property → create property first. Additive build (new route + new dashboard panel); reuses current WORKER_SECRET (will inherit Phase-0 auth later). Key/code updates are history-logged (`updateKeyWithHistory`) so "just do" is safe; creates are soft-deletable (Active flag). Shares the parse→action core with B-124 + B-103. From July 21 ask. |
| B-126 | 🟠 | **Owner billing + marked-up-estimate approval** | Owner portal (owner.html) currently has NO billing view at all. Add: **amounts + invoice link** per WO, and **estimate approval** — but the approvable estimate is the **marked-up, Brett-reviewed version** (Invoice_Review / customer-facing), **never the raw vendor estimate**. Flow: vendor estimate → Brett review + markup → surfaced to owner → owner approve/decline (feeds start-date + WO). Builds on B-030 (estimate template), B-101 (estimate approval + start-date), Invoice_Review markup. From Design Foundation v1.1 (decision #3, July 21). |

---

## COMPLETED

| ID | Venture | Item | Completed |
|---|---|---|---|
| — | Ridge Co | Vendor portal (vendor.html) — PIN login, WO list, photo upload, bill submission | July 2026 |
| — | Ridge Co | Invoice Review screen in index.html | July 16, 2026 |
| — | Ridge Co | worker.js `/vendor-bills` status filter | July 16, 2026 |
| — | Ridge Co | worker.js `POST /invoice-review/approve` endpoint | July 16, 2026 |
| — | Ridge Co | Vendors tab — Hourly_Rate column, Alex=$35, Oscar=$50 | July 17, 2026 |
| — | Ridge Co | Invoice_Review tab created with 19-column header | July 17, 2026 |
| — | Ridge Co | Photo upload fix — gallery + bulk + camera all work (removed capture attr from vendor.html) | July 17, 2026 |
| — | Ridge Co | 4518 Fairfax Rd Apt 1 proposal v1.0 — 45 items, 3 packages, photo links, lead paint compliance | July 17, 2026 |
| — | Ridge Co | 4518 Fairfax Rd Apt 1 proposal v1.1 — Option 0 Expedited Interior Turn ($3,950), painting -15%, permissive cherry-pick, payment terms | July 17, 2026 |
| — | Ridge Co | Proposal PDF — Ridge_Co_Proposal_4518_Fairfax_Rd.pdf — clean filename, no header/footer, dead links removed | July 17, 2026 |
| — | Ridge Co | Gallery upload fix in index.html (index.html buildPhotoSection also had capture=environment — now removed) | July 17, 2026 |
| — | Ridge Co | Duplicate photo section fix — photo-section-WO-ID guard prevents double injection | July 17, 2026 |
| — | Ridge Co | Void button for vendor bills — Void sets Active=FALSE, re-renders bill list instantly | July 17, 2026 |
| — | Ridge Co | Sheets API quota fix — 60s TTL cache on loadHubEstimateView, splits render/fetch logic | July 17, 2026 |
| — | Ridge Co | Vendor change persisting — optimistic state update in submitAssign after successful API response | July 17, 2026 |
| — | Ridge Co | Drive subfolder structure — Before Photos / After+Receipts / _Internal Vendor Bills (separate from customer view) | July 17, 2026 |
| — | BrettOS | GitHub context system (CURRENT.md, CLAUDE.md, context docs) | July 16, 2026 |
| — | BrettOS | brett-context Cowork skill | July 16, 2026 |
| — | BrettOS | GitHub Actions sheet-ops pipeline | July 17, 2026 |
| — | BrettOS | CREDENTIALS_MAP.md + VENTURES.md + BACKLOG.md + FEATURE_LOG.md | July 17, 2026 |
| — | BrettOS | QB API app created, compliance submitted (Intuit review pending) | July 17, 2026 |
| — | BrettOS | PAT-027, PAT-028, PAT-029 added to Brett_Context_Document | July 17, 2026 |
| — | BrettOS | privacy-policy.html + eula.html created for Intuit compliance | July 17, 2026 |
| — | BrettOS | GitHub Actions archive step 403 error fixed | July 17, 2026 |
| — | BrettOS | Estimating workflow: Gemini issues documented, Ridge Co proposal design established | July 17, 2026 |
| — | BrettOS | Recurring 4-hour backlog check scheduled (trig_01JwivD2P6SEnAwPJqgurEXF) | July 17, 2026 |

---

## HOW TO USE THIS BACKLOG

- **Brett says "do it"** → Claude moves item to In Progress, executes, moves to Completed
- **New idea comes up** → Claude adds it to backlog immediately with a priority
- **Something breaks** → Claude adds it to FEATURE_LOG regression rules after fixing
- **Session ends** → Claude updates Completed section with what was done
