# BrettOS Master Backlog
**Version:** v1.20 | **Last Updated:** July 21, 2026
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
- B-084 · Hub "Receipts to file" queue — OCR + classify + seeded WO/property picke
- B-085 · Rebuild receipt intake pipeline — retire the stalled Make.com scenario
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
- B-051 · Daily digest of next steps + small wins
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
