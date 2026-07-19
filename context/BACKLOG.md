# BrettOS Master Backlog
**Version:** v1.7 | **Last Updated:** July 19, 2026
**Rule:** This is the single source of truth for everything to build, fix, or automate across all ventures. Update after every session. When Brett says "do it," the item moves to In Progress. When done, it moves to Completed with the date.

Priority levels: 🔴 Urgent | 🟠 High | 🟡 Medium | 🟢 Low | ⏳ Blocked (waiting on something)

---

## IN PROGRESS

| ID | Venture | Item | Blocker |
|---|---|---|---|
| B-015 | Ridge Co | QuickBooks Online API integration — create invoices from Invoice_Review rows | ⏳ Waiting on Intuit production approval (submitted July 17, 2026) |

---

## RIDGE CO — WORK ORDER MANAGEMENT

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-001 | 🔴 | QB invoice creation from approved Invoice_Review rows | Automated: worker reads Invoice_Review, creates QB invoice via API |
| B-002 | 🔴 | QB bill recording when vendor bill approved | Record vendor bill in QB simultaneously with invoice |
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

---

## RIDGE CO — ESTIMATING

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-030 | 🟠 | Estimating template system — reusable proposal generator | Intake form (Sheet or structured input) → auto-generated HTML proposal. Base design on 4518 Fairfax Rd v1.1 as reference. ~2hr build session. |
| B-031 | 🟠 | Estimating skill/agent — scope intake, photo review, line item generation | Replace Gemini workflow. Ask questions, stick to provided scope, no invented items, build memory of Brett's pricing patterns. |
| B-032 | 🟡 | Proposal PDF export — one-click PDF with hyperlinks from HTML proposal | Chromium headless print-to-PDF. Links to Drive photos must survive. |

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

---

## BARRELCO

| ID | Priority | Item | Notes |
|---|---|---|---|
| B-019 | 🟡 | Google Sheet for SKU/inventory tracking | Share with service account when created |
| B-020 | 🟢 | eBay API integration — auto-list new SKUs | Needs eBay Developer token |
| B-021 | 🟢 | Pricing tracker — compare sold prices to listed prices | |
| B-041 | 🟡 | FB Listings — post/refresh Facebook listings | From CAP-014 / Scan_2104. |

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
