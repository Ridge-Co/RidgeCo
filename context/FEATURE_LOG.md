# BrettOS Feature Log — What Works, Don't Break It
**Version:** v1.11 | **Last Updated:** August 4, 2026

## QUICKBOOKS — THE WHOLE PIPELINE (shipped Aug 3–4, 2026)

### Entity mapping (rules 24–27)
**24. Look before creating.** `qbFindOrCreateCustomer`/`Vendor` never actually looked — they
checked one stored column and created. Now they query QuickBooks first. Only an
*unambiguous exact* name match auto-links; a suffix-only match ("Goldszmidt Properties" vs
"…LLC") is a SUGGESTION. An owner running several LLCs under one family name is normal, and
"Smith Inc" / "Smith Properties LLC" normalise identically.

**25. Never guess between candidates.** When more than one QuickBooks record matches equally
well, nothing is chosen — it says so and lists them. The old code took whichever QuickBooks
returned first, which is not stable between calls.

**26. Owners are top-level; properties and units nest under them.** Property → sub-customer
of the owner; unit → sub-customer of the property. Invoices bill the most specific level
that's linked. Address matching is scoped to the owner's own sub-tree — "100 Main St" under
one owner is a different building from the same address under another.

**27. Owner suggestions only consider top-level customers.** Matching an owner against the
whole list offered it its own buildings as candidates.

**38. Sending an invoice creates the OWNER in QuickBooks, never the property.** So an
unlinked owner *does* settle itself on first invoice — and an unlinked property does NOT.
It quietly falls back to owner-level billing on that invoice and on every one after it,
which is exactly the undifferentiated ledger rule 26 exists to prevent. `qbBillToNote` says
so on the preview's bill-to line, in the confirm response, and in a batch send (where there
is no preview at all), with a "Create it now" button when the owner is linked and the
property isn't. Sub-customers are still only ever created on request — the button IS the
request. (Aug 4, 2026.)

### Money (rules 28–31)
**28. Brett's hours are a WAGE, not a cost.** Added AFTER the markup so they're never marked
up; they DO carry the 5% processing fee. A job he does himself is worth its full ticket —
profit no longer subtracts labour that never left the business. `Own_Wage` and `Profit`
are recorded separately on Invoice_Review.

**29. In-house vendors raise no QuickBooks bill.** Flag on the vendor record. No payable
against a person the business doesn't owe. Status still reaches `sent`, not `partial`.

**30. Materials bought outside the vendor's bill were invisible.** Receipts logged against a
job never reached the panel, the cost basis, the markup, the 5%, or the invoice lines. Now
ticked per receipt, and a receipt is billable exactly ONCE — `/receipts-billed` checks the
sheet, not what happens to be open.

**31. Approval is reversible until it reaches QuickBooks.** Approving used to lock the price
in with no way back; re-approving silently returned the first approval. Withdrawing refuses
once a QuickBooks invoice or bill exists, including a partial send.

### Documents (rules 32–34)
**32. The work description belongs on the LINE ITEM,** not in the note under the total.

**33. Bill numbers: the vendor's own, else the work order number.** Never truncated — a
cut-off invoice number looks authoritative and reconciles against nothing. Retry on a
rejected number ONLY when QuickBooks blames the number; any other failure might mean the
bill already exists, and retrying would double-bill.

**34. Vendor bill terms come from the Vendors sheet.** `Payment_Terms` / `Terms` — blank
means due on receipt, "Net 7"/"Net 10"/"Net 30" set a real term. Sets the Terms FIELD, not
just a date, so the bill doesn't read Net 30 next to a same-day due date.

### Trades (rule 35)
**35. ONE trade list.** There were EIGHT hardcoded lists across five files and they had all
drifted — the form offered "Electric" while the QuickBooks map is keyed "Electrical", so
every electrical job booked to General repairs. `resolveTrade` aliases old spellings.
test/trade-map.test.mjs fails if any select grows its own list again.

### Tenants (rule 36)
**36. A former tenant's phone number does not travel.** Move-out never cleared
`Units.Tenant_ID`, and work orders keep theirs by design — so the vendor portal served a
departed tenant's name and a tap-to-call link on every load. `isTenantCurrent` is the single
predicate; three near-copies is why one was never applied. The NAME survives everywhere; the
number stops.

### Sheets (rule 37)
**37. `ensureColumns` before writing a new column.** `updateRow`/`addRow` map by header — a
write to a column that doesn't exist reports success and stores nothing. New headers are
placed past the WIDEST row, so a blank-header column with live data underneath is stepped
over rather than written on top of.

---

## WHO DO I NEED TO PAY (shipped Aug 4, 2026)
`/qb/payables` reads both balances from QuickBooks per job and states where it sits. The one
that matters is **PAY THE VENDOR** — the owner has paid, the vendor hasn't. `/qb/sync-payments`
writes `Customer_Paid` / `Vendor_Paid` / `Payable_State` back to Invoice_Review. On demand,
not on page load: it's one API call per invoice and one per bill.

---

## BILLING — ONE SURFACE (index.html + worker.js, shipped Aug 3, 2026)

**The work order is the billing home.** Vendor bill → both suggested prices → approve →
preview → send to QuickBooks, all in the WO detail panel. Review Bills is the queue that
opens the right work order. There is now ONE pricing surface; do not add a second.

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| WO Invoice Builder — full billing flow | ✅ Shipped | `invPricing` / `invRenderSuggestions` / `invLoadStatus` / `invBillThisJob`. Both formulas shown side by side (tiered via `calcTieredEstimate`; itemized = MAX($75,$35×hrs)+Brett time+travel+5%). Brett always sets the final number. | Aug 3, 2026 (code + offline tests; runtime pending) |
| Bill picker on multi-bill WOs | ✅ Shipped | A WO can carry bills from 2 vendors. `_invPreferBill` carries the chosen bill from the Review Bills card; picker chips switch. Prevents billing one vendor and stranding the other. | Aug 3, 2026 |
| QuickBooks status band | ✅ Shipped | unapproved / approved-at-$X / partial / in-QuickBooks-with-both-ids / **reviewed_no_row**. "In QuickBooks" is ONLY claimed with the QB ids in hand. | Aug 3, 2026 |
| `GET /qb/ready?all=1&wo_id=` | ✅ Shipped | Returns rows at any status, optionally per-WO, so the Hub reads a bill's real QB position instead of inferring it from an empty queue. Paramless calls behave exactly as before. | Aug 3, 2026 |
| `POST /invoice-review/approve` | ✅ Fixed | Returns the REAL Invoice_Review row id (was `'IR-'+Date.now()`, which addRow overwrites — so approve could never chain into send). Also idempotent per Bill_ID. | Aug 3, 2026 |
| Review Bills — job context | ✅ Shipped | Cards join Work_Orders for Description/Trade/Priority/tenant/address + "Full work order ↗". Vendor_Bills only stores WO_ID + Vendor_Name; its Job_Type/Notes are empty in practice. | Aug 3, 2026 |
| Review Bills — "Already handled — clear from queue" | ✅ Shipped | For bills settled outside the Hub (paid direct in QB). Flips Vendor_Bills.Status to `reviewed`, writes NO Invoice_Review row. Gated to WOs with exactly one queued bill. | Aug 3, 2026 |

---

## DUPLICATE-SUBMISSION GUARDS (vendor.html + worker.js, shipped Aug 3, 2026)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| `claimSubmit()` latch | ✅ Shipped | Shared in-flight guard on receipt / time / estimate submits + button disable + input clear on success. `submitEstimate` had NO guard — WO-1052/1012/1062 each had two identical estimates ~1s apart. | Aug 3, 2026 |
| Bill modal guard | ✅ Fixed | Held until `closeBillModal()` instead of released 2s early while the modal sat open and populated. | Aug 3, 2026 |
| `findRecentDuplicate()` backstop | ✅ Shipped | Server-side, on estimates/receipts/time/bills. **Fails OPEN** — an undateable or unreadable row never blocks a write. 30 offline tests in `test/dupe-guard.test.mjs`. | Aug 3, 2026 |
| `addRow` id allocation | ✅ Fixed | Resolves the ID column by header name (rule 6), `reduce` not `Math.max(...)`. Fixes the Attachments ID collisions. | Aug 3, 2026 |
| vendor.html `api()` serialization | ✅ Fixed | **`/receipt/add`, `/receipt/delete`, `/time-entry/add`, `/time-entry/delete` had never worked** — see rule 19. | Aug 3, 2026 |

**Rule:** Before changing ANY file, check this log. If a feature is marked ✅ Working, verify it still works after your change. If you must touch something that affects a working feature, note it here BEFORE committing.

---

## DAILY DIGEST (worker.js — B-051, shipped July 22, 2026)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| `GET /daily-digest` | ✅ Working (deployed) | Auth-gated. Read-only morning digest built from Work_Orders + Vendor_Bills + Properties/Vendors/Tenants by real column names. `?deliver=1` triggers delivery (else preview JSON). Verified against live sheet July 22 (40 open WOs, 3 overdue, 4 vendor bills $501, pulse 64/80/6). | July 22, 2026 |
| `scheduled()` cron | ✅ Live, DORMANT | wrangler `crons=["0 11 * * *"]` = 7am EDT / 6am EST. Builds digest daily; **sends nothing** until Config `digest_enabled=TRUE`. Safe by design. | July 22, 2026 |
| Delivery layer | ⏳ Dormant (by design) | SMS via existing `sendSMS` — needs `TWILIO_FROM` + Twilio send live + Config `digest_sms_enabled=TRUE` + `digest_sms_to`. Email = `deliverDigestEmail` STUB, pick a provider later (`EMAIL_API_KEY`/`EMAIL_FROM`). **Do not "fix" the stub as if broken — it's intentionally off.** | July 22, 2026 |
| Config keys | Reference | `digest_enabled`, `digest_sms_enabled`, `digest_sms_to`, `digest_email_enabled`, `digest_email_to`. All absent/blank = fully dormant. | July 22, 2026 |

**To turn delivery ON (Brett, after Twilio send is live):** set `TWILIO_FROM`, then in Config set `digest_enabled=TRUE`, `digest_sms_enabled=TRUE`, `digest_sms_to=<your #>`. Nothing else changes.
**Known gaps (v2):** digest pulls only Sheet data — captures/backlog (GitHub) and receivables (e.g. Ray's tolls) not included yet; Invoices tab is empty so "Money" reads Vendor_Bills.

---

## COMMAND CENTER (command-center.html — B-151 Phase 0, shipped July 23, 2026)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| `command-center.html` | ✅ Shipped (READ-ONLY) | New static page on GitHub Pages. **Does NOT touch worker.js — zero Worker/deploy risk.** Reads live `/workorders`, `/invoices`, `/vendor-bills?status=submitted`, `/vendors`, `/properties`, `/units` with header `X-Auth-Token` from `localStorage['mh_auth']` (same as index.html). Ranks open WOs by who's-waiting (NEEDS_BRETT: New/Declined/On Hold/Complete/Pending Invoice) + Priority + age; counts need-your-OK / waiting / aging-7d+; vendor-bill review queue; money-owed from unpaid invoices; "Other ventures" manual card. | July 23, 2026 (code-verified vs live schema; runtime eyeball pending Brett) |
| Sample fallback | ✅ By design | No token / Hub unreachable → clearly-labeled **SAMPLE** data so the page never blanks. Badge shows LIVE vs SAMPLE. | July 23, 2026 |
| Approve / Rollback buttons | ⛔ Present but DISABLED (by design) | Read-only until BUILD_ORDER Phase 1/3 (preview lane + validator + versioning). Rollback shows a "not armed yet" note. **Do not wire these to write actions until the substrate exists.** | July 23, 2026 |

**Note:** Invoices tab is currently empty (see digest note) → "Money owed" may read empty until invoices exist; degrades gracefully. Phase 2 can switch the feed to the existing `/daily-digest` aggregate.

---

## RECEIPT PIPELINE (worker.js — B-084/085 first slice, shipped July 22, 2026)

Own-purchase receipts ONLY (business / owned-property / personal-HSA). **WO/vendor receipts are a SEPARATE existing vendor-portal flow — do not merge them into this.**

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| `POST /receipt-intake` | ✅ Deployed + VERIFIED | `{file_id\|file_url\|image_b64(+mime), source}` → Claude-vision extract (vendor/date/total/handwritten_note/**po_reference**) → 4-bucket classify → best-effort WO/property auto-link → `Receipts_Queue` (pending). Money-facing ⇒ claude-sonnet-4-6 (PAT-031). **Verified July 22 on 2 real Lowe's receipts:** read printed data + hand-written "Washer work order" + the printed "LBA/PO:" line (BMORE / property "1214 n calvert apt 3") and bucketed both correctly. | July 22, 2026 |
| `POST /receipt-scan` (+ daily cron) | ✅ Deployed, self-provisioning | First run creates a `Receipts_Inbox` Drive folder under `DRIVE_PROPERTIES_ROOT` and writes `receipts_inbox_folder_id` to Config; later runs pull new drops into the queue. Runs in the 11:00-UTC `scheduled()` handler. Read + queue only. | syntax only, July 22 |
| `GET /receipt-queue` | ✅ Deployed | `?status=pending\|filed\|all`. Lists queue rows for the review screen (Hub UI = next step). | syntax only, July 22 |
| `POST /receipt-queue/approve` | ✅ Deployed | `{id, corrections?}` → files the receipt into the Vendors Drive folder (`receipts_dest_folder_id` or `DRIVE_VENDORS_ROOT`), marks `filed`, and **learns vendor→category** into Config `receipt_vendor_defaults`. No QuickBooks. | syntax only, July 22 |
| `Receipts_Queue` tab | ✅ Auto-created | `ensureTab()` self-creates it (ID,Source,Source_File_ID,…,Category,Handwritten_Note,Suggested_WO_ID,Suggested_Property_ID,Confidence,Status,Filed_File_URL,…). No manual sheet-ops. | July 22 |

**Config keys:** `receipts_inbox_folder_id` (auto-set), `receipts_dest_folder_id` (defaults to Vendors drive), `receipt_vendor_defaults` (learned JSON map).
**Vision extraction VERIFIED** on 2 real Lowe's receipts July 22 (handwritten note + printed LBA/PO line both captured; `po_reference` field added so either/both/neither parse correctly).
**Deferred (next steps):** Gmail intake from info@ + brett@ (needs a mail-access collector feeding `/receipt-intake` — Worker has no Gmail scope); a Hub review screen consuming `/receipt-queue`; QuickBooks posting (explicitly out of this slice).

---

## VENDOR PORTAL (vendor.html)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| PIN login (vendor auth) | ✅ Working | Vendors enter name + **8-char PIN** (3 alpha + 5 digit, e.g. `ABC12345`) via `/vendor-by-pin` — NOT 4-digit. PAT-016 says 4-digit (stale doc); confirmed via CODEMAP July 21. | July 21, 2026 |
| Work order list with filters | ✅ Working | Filter by trade, priority, sort options | July 2026 |
| Photo upload — BEFORE/AFTER/REPORT | ✅ Working | `capture` attr removed — gallery bulk + camera both work | July 17, 2026 |
| Photo upload — bulk from gallery | ✅ Working | `multiple` attr present, no `capture` restriction | July 17, 2026 |
| Photo upload — single camera shot | ✅ Working | Mobile browser shows camera option in picker | July 17, 2026 |
| Receipt upload | ✅ Working | Accepts image/* + PDF | July 2026 |
| Video upload | ✅ Working | Accepted in BEFORE/AFTER/REPORT types | July 2026 |
| Vendor bill submission | ✅ Working | Submits to Vendor_Bills sheet via worker | July 2026 |
| Time tracking entries | ✅ Working | Start/end time per day | July 2026 |
| Material/expense entries | ✅ Working | Amount, date, store fields | July 2026 |
| Estimate builder | ✅ Working | Line items with totals | July 2026 |
| Searchable vendor dropdown | ✅ Working | Fixed July 2026 (PAT-021) | July 2026 |
| WO status updates | ✅ Working | Vendor can update WO status | July 2026 |

---

## MAIN PORTAL (index.html)

| Feature | Status | Notes | Last Verified |
|---|---|---|---|
| Work order list | ✅ Working | | July 2026 |
| Invoice Review screen | ✅ Working | Added Session 1 — lists pending vendor bills | July 2026 |
| Vendor management | ✅ Working | | July 2026 |
| Property management | ✅ Working | | July 2026 |

---

## CLOUDFLARE WORKER (worker.js)

| Endpoint | Status | Notes | Last Verified |
|---|---|---|---|
| `GET /vendor-bills` | ✅ Working | Supports `?status=` filter (added Session 1) | July 2026 |
| `POST /invoice-review/approve` | ✅ Working | Added Session 1 — approves bill, writes Invoice_Review row | July 2026 |
| `GET /work-orders` | ✅ Working | | July 2026 |
| `GET /vendors` | ✅ Working | | July 2026 |
| `GET /properties` | ✅ Working | | July 2026 |
| `POST /upload-photo` | ✅ Working | Routes to Drive upload | July 2026 |
| Drive folder creation per WO | ✅ Working | | July 2026 |
| WO status/field writes (`/status`, `/workorder/update`, `/wo/admin-update`, assign) | ✅ Fixed July 21 | Match the **`ID`** column resolved by header name (`idColIndex()`). There is no `WO_ID` column — the July 19 fix looked one up, got `-1`, and fell back to `r[0]` (the blank `Vendor_Needs_Access` column), so writes returned `success:true` and changed nothing. See rule 6. | July 21, 2026 |
| `POST /workorder` (create) | ✅ Fixed July 21 | Next WO number read from the `ID` column by header name. Previously read `r[0]` (blank), found no numbers, and restarted at **WO-1001** on every create. Verified live: next create returned WO-1057. | July 21, 2026 |
| `GET /wo-audit` · `logWOAudit` | 🟡 Fixed July 21 | `WO_Audit` tab never existed; `logWOAudit` swallows all errors so writes silently no-opped, and `getWOAudit` had no catch → 500. Tab created via sheet-op; read now returns `[]` on failure. | July 21, 2026 |
| Bill entered → WO auto-set to Complete | ✅ Working | `addVendorBill` wraps `/vendor-bill/add` | July 19, 2026 |
| `GET /qb/test` · `/qb/accounts` · `/qb/setup-trades` | ✅ Working | QuickBooks production CONNECTED; OAuth refresh-token flow; created trade accounts+items | July 19, 2026 |
| `POST /qb/send-invoice` · `GET /qb/ready` | 🟡 Shipped July 20 — pending live verify | Preview-first: creates QB Invoice (customer) + Bill (vendor) from an Invoice_Review row. Find-or-create customer (`Owners.QBO_Customer_ID`) + vendor (`Vendors.QBO_Vendor_ID`). Labor summary line + per-receipt material lines (sum === Customer_Total). Refresh-token persisted to Config. Idempotent. Flips WO→Invoiced. CustomerMemo job-photo link (folder shared anyone-with-link). Receipts: ALL → Invoice (IncludeOnSend); reimburse-only → Bill. Attachments best-effort/non-fatal. Behind WORKER_SECRET (NOT public). | July 20, 2026 |
| WO Invoice Builder → `📤 Send to QuickBooks` | ✅ Working | Replaces the retired "Send to Make → QBO" button (posted to `/invoice-webhook`, a route that never existed → 404). Resolves the WO's pending `Invoice_Review` row via `/qb/ready` and opens the preview-first modal; no approved bill → points at Review Bills. | July 20, 2026 |
| `GET /receipts` · `POST /receipt/add` · `/receipt/delete` | ✅ Fixed July 20 | The `Receipts` tab never existed. `listReceipts`' try/catch returned `200 []` so reads looked healthy while every write 500'd. Tab created via sheet-op (ID first — `updateRow` matches `r[0]`). | July 20, 2026 |
| Vendor receipt routing → internal folder | 🟡 Shipped July 20 | `handlePhotoUploadClean` routes file_type receipt/bill/invoice to `_Internal — Vendor Bills` (sibling, NOT shared); job photos stay in the customer WO folder that gets shared on the invoice. | July 20, 2026 |
| Cloudflare auto-deploy (Workers Builds) | ✅ Live July 19 | Push to main → build+deploy. `wrangler.toml` keep_vars=true protects secrets. WAS broken (never connected). | July 19, 2026 |

---

## GOOGLE SHEET (RidgeCo Main)

| Tab | Status | Notes | Last Verified |
|---|---|---|---|
| Vendors | ✅ Working | Hourly_Rate column added July 17, 2026 | July 17, 2026 |
| Vendor_Bills | ✅ Working | | July 2026 |
| Work_Orders | ✅ Working | **Schema gotcha:** col 0 = `Vendor_Needs_Access` (blank/"auto"), col 1 = **`ID`** (holds `WO-1057`…). No `WO_ID` column. Resolve by header name — see rule 6. | July 21, 2026 |
| WO_Audit | 🟡 Created July 21 | `ID, WO_ID, Changed_By, Changed_By_Role, Field, Old_Value, New_Value, Timestamp, Notes` — matches the `newRow` map in `logWOAudit`. | July 21, 2026 |
| Receipts | ✅ Created July 20 | `ID, WO_ID, Amount, Description, Store, Date, Added_By, Added_By_ID, Role, Created_Date, Active` | July 20, 2026 |
| Invoice_Review | ✅ Working | Created July 17, 2026 with 19-column header. QB_Invoice_ID/QB_Bill_ID/QB_Invoice_Status written by `/qb/send-invoice` | July 20, 2026 |
| Properties | ✅ Working | | July 2026 |
| Vendors — `QBO_Vendor_ID` | 🟡 Added July 20 | For QB vendor find-or-create persistence (via sheet-op) | July 20, 2026 |
| Owners — `QBO_Customer_ID` | ✅ Working | Ensured July 20 (sheet-op); QB customer link | July 20, 2026 |

---

## REGRESSION RULES

1. **Before any vendor.html change:** Check photo upload, PIN login, and bill submission still work
2. **Before any worker.js change:** Check all GET endpoints return data, POST /invoice-review/approve still works
3. **Before any sheet structure change:** Verify worker.js column references still match
4. **Never add `capture="environment"` or `capture="camera"` to file inputs** — this breaks bulk gallery upload on mobile (fixed July 17, 2026)
5. **Never change the Vendor_Bills or Invoice_Review column order** without updating worker.js references simultaneously
6. **WO matching — there is NO `WO_ID` column on Work_Orders.** The real key is the **`ID`** column, and it is **not at index 0** — column 0 is `Vendor_Needs_Access` (blank, or `"auto"` on new rows); `ID` sits at **index 1**. Always resolve the key column **by header name** (`idColIndex()` / `findWO()`), never `r[0]` and never `headers.indexOf('WO_ID')` (that returns `-1`). Two failure modes this caused, both silent: (a) matching `r[0]` compared against a blank column, so vendor/status writes returned `success:true` and changed nothing; (b) `w.WO_ID === body.wo_id` is `undefined === undefined` when the caller omits the id, which **matched the first WO in the sheet** and operated on the wrong record. The July 19 "match on WO_ID" note was wrong about the schema — corrected July 20, 2026.
7. **Cloudflare deploy:** `wrangler.toml` must keep **`keep_vars = true`** — without it a deploy can wipe the dashboard env vars/secrets (QB, Google SA, Twilio, WORKER_SECRET). (Wired July 19, 2026.)
8. **QB refresh token rotates** — don't treat the static `QB_REFRESH_TOKEN` env as permanent; the write flow persists the rotated token. `invalid_grant` = re-auth.
9. **Void re-render:** the "duplicate + void killed both" bill bug was one bill rendered twice; void now does a full `loadAll()+openWODetail()` refresh, not fragile DOM removal. (Fixed July 19, 2026.)
10. **QB send is preview-first + idempotent:** `/qb/send-invoice` must never create a second QB invoice/bill when `QB_Invoice_ID`/`QB_Bill_ID` are already set. `preview_only` must make ZERO writes/Intuit calls. (July 20, 2026.)
11. **Invoice line invariant:** `buildInvoiceLines` = one labor summary line + one line per receipt (+ truck stock); lines MUST sum to `Customer_Total` (labor = Customer_Total − materials).
12. **Two cost bases:** `Invoice_Review.Vendor_Cost` = vendor payable = labor + truck + **reimburse-only** receipts (= the QB Bill amount). Brett Net uses ALL materials. On-account receipts bill the customer but never the vendor.
13. **Receipt folder privacy:** vendor receipts must NOT land in the customer WO photo folder (shared anyone-with-link on invoice send). Keep receipt/bill/invoice uploads routed to `_Internal — Vendor Bills`.
14. **QB Attachable is best-effort:** an attach failure must only warn, never block invoice/bill creation. Receipts attach to the customer Invoice (all) + vendor Bill (reimburse-only). Verify the multipart `/upload` format vs current Intuit docs if it regresses.
15. **Never build WO detail with `innerHTML +=`.** `detail-body` is assembled in five passes; `+=` re-parses the container and destroys every existing child node, so async loaders (`loadWOMaterials`, `loadVendorBillForInvoice`) resolve into *detached* elements and the visible ones sit on "Loading…" forever. Use `insertAdjacentHTML('beforeend', …)`, which appends in place. (Fixed July 20, 2026.)
16. **A read endpoint returning `[]` is not proof its tab exists.** PAT-014 try/catch on reads masked the missing `Receipts` tab for weeks — only writes surfaced it. When a tab is suspect, probe a *write* path (`updateRow` with a bogus id 404s before writing anything). Reads swallow; writes tell the truth.
17. **/sms-inbound is a PUBLIC endpoint** (in `PUBLIC_PATHS` — must stay public for the Twilio webhook). Treat it as an untrusted entry point in the B-093 per-user auth build; don't assume every route is behind WORKER_SECRET. The authoritative route/handler/Sheet-tab index is now **`context/CODEMAP.md`** (maintained by the `ridgeco-map` skill) — consult it before hunting through worker.js/index.html, and refresh it after structural changes.
18. **Cloudflare "Builds for non-production branches" can deploy straight to PRODUCTION — the non-prod deploy command MUST be `npx wrangler versions upload`, never `npx wrangler deploy`.** 🔴 **July 21, 2026 production incident.** Enabling non-production branch builds for the `staging` sandbox (B-103) caused every push to `staging` to run the production **`wrangler deploy`** command, silently overwriting the LIVE Worker with unmerged staging code. When the admin-token security gate (part of the unmerged notes-model/security work) landed on production, it **403'd every bulk read** (`{"error":"This endpoint requires the admin token"}`) and the live Hub showed **0 work orders / 0 properties** — which *looked* like blanked/lost data but was **not**: all 343 WOs + every tab were 100% intact in the sheet the whole time. It was purely the wrong code version answering. **Fixed by force-redeploying `main`** (rollback commit `3cf9a96`). Prevention: (a) non-prod branch deploy command = `wrangler versions upload` (→ a *preview* URL), NEVER `wrangler deploy`; (b) if unsure, keep "Builds for non-production branches" **OFF** — that is its current required state until reconfigured; (c) the `staging-` hostname sandbox mode (worker.js ~L45) only isolates data on a *preview* URL — it does nothing if staging code reaches the production URL. **Diagnostic key:** Hub reads its shared token from `localStorage['mh_auth']`; a **401** = token mismatch (wrong `mh_auth`), a **403 "requires the admin token"** = production is running the unmerged new code (redeploy `main`). The current shared secret is hardcoded in every portal `.html` (the exact security flaw B-093 exists to fix).

---

19. **A wrong ROUTE and a wrong COLUMN both return success — check for each separately.** Two silent-no-op classes bit us the same day. (a) `index.html`'s `api()` resolves on any HTTP status, so posting to a route that does not exist (`/update-wo` — the real one is `/workorder/update`) returned a 404 that read as a normal response: "💾 Save draft" reported "✓ Saved" and saved nothing, every time, and the customer invoice memo was discarded on its way to QuickBooks. (b) `updateRow` returns `{success:true, message:'No matching fields'}` when NONE of the fields match a header — a write that touched nothing. Use `woUpdateLanded(r)` (`r.success && r.message !== 'No matching fields'`) rather than bare `r.success`. Verified Aug 3: `Customer_Charge` (index 34) and `Invoice_Memo` (index 35) DO exist on Work_Orders.
20. **`vendor.html`'s `api()` has two calling styles and only one used to serialise.** `api('POST', path, body)` stringifies; `api(path, {method, body:{…}})` handed `fetch` a raw object, which becomes the literal text `"[object Object]"` as `text/plain`, so the Worker's `request.json()` threw and the call 500'd. That silently killed **every receipt and time-entry write from the vendor portal since it shipped** — which is why the `Receipts` tab was empty. Fixed inside `api()` so both styles work. When a tab is mysteriously empty, suspect the client serialisation before the handler.
21. **Never infer "already sent to QuickBooks" from an absent row.** `/qb/ready` hides sent rows, so "not in the queue" was being read as "already invoiced" — and it disabled the only button that could bill the job. A bill marked `reviewed` with no Invoice_Review row behind it is NOT approved: nothing was queued and no invoice exists (the `reviewed_no_row` state). Claim "in QuickBooks" only when `QB_Invoice_ID` and `QB_Bill_ID` are both in hand. This is rule 16 applied to money.
22. **A work order can carry bills from more than one vendor, and each needs its own invoice.** Anything that picks "the bill" for a WO must carry a specific `Bill_ID`, never just take the newest — and "Mark Reviewed" writes no Invoice_Review row, so it retires a bill from the queue WITHOUT invoicing the customer or paying the vendor. Do not offer it as a way to clear a bill you actually intend to bill.
23. **The duplicate-submission backstop must fail OPEN.** `findRecentDuplicate` returns null on any error, and skips rows whose `Created_Date` will not parse. An early version treated an undateable row as a match at any age, which silently swallowed real submissions behind a success message. Losing a vendor's work is strictly worse than the duplicate row it prevents.

## HOW TO UPDATE THIS LOG

When a feature is added, fixed, or verified: add/update its row immediately.
When something breaks and is fixed: add a regression rule at the bottom so it never breaks the same way again.
