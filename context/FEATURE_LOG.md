# BrettOS Feature Log — What Works, Don't Break It
**Version:** v1.29 | **Last Updated:** August 11, 2026

**79. Deliveries — Phase 0 of the Appliance & Materials Delivery System shipped (Aug 11, `2026-08-11.2`, B-218).** New standalone page `deliveries.html` (Hub `mh_auth`; launches from Dev Log → 🧰 TOOLS → 🚚 Deliveries) + a self-provisioning `Deliveries` tab + three Worker routes. The delivery **record** is the spine: order#/store/item+make-model/dims, property/unit/tenant, delivery address, expected date+window, on-site contact (default tenant) + backup, notes, linked WO(s), status. Endpoints (all secret-gated, SAFE class — no Twilio, no money, no customer send): **`GET /deliveries`** = `deliveriesList` (ensures the tab, returns every active delivery enriched with property `Address` / unit `Unit_Label` / tenant name+phone + today's ET date so the page buckets Today / Upcoming / Past-date / Needs-a-date / Done); **`POST /delivery/add`** = `deliveryAdd` (if no WO is linked and a property is known, **auto-creates the install WO** via `createWorkOrder` — trade `Appliance`, type `delivery` — and links it back, honoring "a delivery always has a work order"); **`POST /delivery/update`** = generic `updateRow(env,'Deliveries',id,fields)`. Tab self-provisions via `ensureDeliveryTab` (mirrors `ensureTrashTabs`: `:batchUpdate` addSheet + `ensureColumns(DELIVERY_HEADERS)`); **Deliveries.ID is at column 0** (like the Trash tabs, unlike Work_Orders). The page's **"Relay to tenant"** button composes a plain delivery text and opens an `sms:` prefill (draft-first — no auto-send; the Twilio path is Phase 3/B-221). Create-from-a-WO works via URL prefill `deliveries.html?wo_id=&property_id=&unit_id=&tenant_id=` (opens the form pre-linked so no duplicate WO is made). Purely additive — two new routes + new functions + new file + one launcher button; no existing handler touched. Both files `node --check` clean. **REMAINING (small):** a "Create delivery" button on the in-Hub WO detail modal (the deep-link already works; the button is a follow-up to avoid a risky edit to the 5.9k-line index.html at session end). **Verify (Brett):** Dev Log → 🧰 TOOLS → 🚚 Deliveries → + New delivery → pick a property (address auto-fills, tenant auto-selects) → Save → confirm a WO-#### is created and the row shows under Today/Upcoming; open Edit → change Status → Save → confirm it sticks; tap Relay to tenant → confirm the SMS app opens prefilled to the tenant.

**78. `sheet-ops` `add_column_header` now auto-widens the grid before writing (Aug 11, `context/sheet-ops/run_ops.py`).** Root-caused a silent partial failure: a two-op pending.json (append a Keys row + add a `Room` column to `Work_Orders`) applied op1 but left `pending.json` un-archived and never added the column. Cause: `Work_Orders` sat at exactly its 39-column grid edge, and `add_column_header` used `values.update` to write the header at column 40 — `values.update` does NOT auto-expand a sheet's grid, so it 400'd with "exceeds grid limits", `run_ops` exited non-zero, and the archive step was skipped. (Roomier tabs like Owners/Vendors always had spare grid width, which masked this for months.) Fix: before the header write, `add_column_header` reads the tab's `gridProperties.columnCount` and, when the new column index would be out of bounds, issues a `batchUpdate.appendDimension` to add the needed COLUMNS first. Idempotent + only expands when necessary. LESSON: a partial sheet-op leaves `pending.json` in place (archive runs only on full success) — treat a lingering `pending.json` as "the run FAILED mid-way," verify the live sheet, and re-queue **only the un-applied ops** (never blindly re-run an already-applied `append_row`, or you duplicate the row).

**77. Work-order Room / Area field — room-level routing without a QuickBooks/billing layer (Aug 11, `2026-08-11.1`; worker.js + index.html + vendor.html + `Work_Orders.Room` column).** Lets a WO be tagged to a specific room/area (e.g. "Bedroom 2") so vendors get room-level dispatch **without** modeling rooms as Units (a new Unit = a new QB sub-customer = an extra billing layer Brett explicitly did not want). Rooms are a **label dimension**, not an entity: (a) interior-door locks live as `Keys` rows under the parent unit with the room in `Lockbox_Location` (e.g. Apt-1 "Bedroom Door" key, code A4, location "Bedroom 3"), which already surface to the assigned vendor via `getWOLockboxes`; (b) the new optional `Room` column on `Work_Orders`. `createWorkOrder` persists `body.room`; `adminUpdateWO` saves it through the generic `updateRow` (no whitelist change needed); `enrichWO`'s `...wo` spread carries `Room` into the vendor payload automatically. Surfaced on: the admin New-WO + Edit-WO forms (`wo-room` / `ewo-room`, with a `<datalist>` auto-suggesting rooms already on file for the property from key locations), the WO detail modal, the **vendor** SMS job line (`New job: <trade> at <addr> Unit <label> (<room>)…`) and the vendor.html job card (address line + a bold "Room / Area" detail row). **Owner/tenant portals do NOT render `Room`** (grep-verified) so it stays internal/vendor-only — the owner's bill is unchanged (still one Apt-1 line). Also tightened: the vendor access line now prints the key's real label (e.g. "Unit Apt 1 — Bedroom Door (Bedroom 3): A4") instead of a hardcoded "Lockbox". Verified live: `Work_Orders.Room` present (col 40), Keys row 68 (A4/Bedroom 3/Apt 1) single & correct, `node --check` clean, cost/markup grep clean, worker `/version`=`2026-08-11.1`.
**76. 🔒 CONFIDENTIALITY BREACH → LOCKED RULE: never leak cost/markup (Aug 10).** A roofing proposal was built with the contractor's base cost + Brett's markup embedded in an on-screen (screen-only) banner AND an HTML comment, and the same base/markup numbers were placed in `PROPOSAL_REGISTRY` inside **worker.js and pushed to the PUBLIC repo**. The customer opened the file and **screenshotted the markup** — a violation of Brett's #1 non-negotiable. **Remediation (done):** (a) stripped all base/markup from the proposal so the customer file shows ONLY the final price, re-hosted clean; (b) moved every dollar amount + routing OUT of public `worker.js` into the private Cloudflare env `PROPOSAL_CONFIG` (JSON) read by `proposalRegistry(env)` — unset ⇒ feature dormant; (c) scrubbed owner/vendor identities from the public repo; (d) locked the HARD RULE at the top of CURRENT.md. **Standing rule:** cost / markup / margin / vendor-cost NEVER appears on any customer- or vendor-facing or hostable/public artifact (visible text, comment, JS, filename, metadata, or the public repo) — only the final price for that audience; **grep every outbound / hosted / pushed artifact for cost/markup/base before it ships.** **Residual:** the numbers still exist in **git history** (pre-fix commits); purging needs a coordinated history rewrite + force-push, deferred (risky with concurrent sessions + the live deploy).

**72. Stuck-open-WO card is now browsable + tappable (Aug 10, `2026-08-10.3`).** Extends rule 71. The red ⏰ Stuck open work card showed only the first 8 with a dead "+ N more" note; Brett has ~43 stuck. Now it shows 8, then a **"+ N more — tap to show all"** button that reveals the rest (rendered hidden in `#stale-more`, one-tap expand, no re-fetch), and **every row is a link** into the Hub: `index.html?wo=<ID>` (target=_blank), which `maybeOpenWOFromURL`→`openWODetail` pops to that WO's detail modal (same origin shares `mh_auth`, so it opens logged-in). WO id passed is `w.ID` ("WO-1042"), which is exactly what `openWODetail` matches. Verified headless: 8 shown → tap → all 43 shown, button hides, first row `href=index.html?wo=WO-1000`, URGENT chip renders, 0 JS errors. (The ~43 count itself is a data-hygiene signal — lots of WOs never closed — worth a separate cleanup pass.)

**75. Dev Log TOOLS regrouped — one 🧰 TOOLS area, sub-grouped by purpose (Aug 10, index.html only).** Extends rule 57. The old flat DATA TOOLS (10 buttons) + 🔗 TOOL PAGES (5) are now one **🧰 TOOLS** block with four labeled sub-groups: **✅ On-demand work & dashboards** (Action Center, Command Center, Proposals), **💵 Money & QuickBooks** (Vendor reconciliation, Fill missing QB emails, Fix unsent invoice emails, Fix invoices already in QB, Signed proposals → QB, Trash billing), **🧹 Data hygiene** (Fix PINs+Phones, Check moved-out tenants, Update trade names, Find dup properties/owners, Reformat sheets, Fix photo/video sharing), **🔎 Diagnostics** (Run Ops Review, Log test telemetry). Every prior handler/onclick preserved (adversarially diffed — no regression), including the upstream-added `signed-proposals.html` button (relocated into Money & QuickBooks); `findRepairableInvoices` just changed group. `#admin-tool-result` (where the in-Hub fix buttons print) moved to the bottom of the block — position doesn't affect it (getElementById). CONVENTION (rule 57) still holds: new tool page → add its button to the right sub-group in the same commit.

**74. Wishlist is now a status-tracked Dev Log — items don't rot as "open" (Aug 10, index.html + worker.js `2026-08-10.2`).** Each Wishlist item carries a lifecycle **Status** — `Active / In progress / Done / Not applicable` — set by one-tap buttons (▶ Start · ✓ Done · ✗ N-A · ↩ Active), with a status filter (counts per state) and a **Clear Done / N-A** archive that leaves open items alone (replaces the old blunt "Clear Wishlist" that nuked everything). Backend: `POST /wishlist/status {id,status}` → `setWishlistStatus` — whitelists status against the 4 allowed values, and **calls `ensureColumns(env,'Wishlist',['Status'])` BEFORE `updateRow`** (rule 37: without the column, updateRow returns `{success:true,message:'No matching fields'}` — a false success). `addWishlistItem` also ensures the column and stamps `Status:'Active'` on new rows. Gated exactly like its `/wishlist/add` sibling (admin `WORKER_SECRET`; not in any role scope). Internal list — no money/PII/auth. Known low-risk edge (accepted): if `ensureColumns` transiently throws AND the column doesn't exist yet, the write silently no-ops but toasts success — same false-success class the repo watches, but add() also ensures the column so probability is low. NOTE this pairs with the BACKLOG **Reconciliation mechanism** block (Aug 10): the Hub is where Brett marks items; the repo BACKLOG is the durable record, reconciled at session close.

**73. Action Center — on-demand money/paperwork work, deep-linking into the gated tools (Aug 10, NEW `action-center.html` + `?page=` deep-link in index.html + link from command-center.html).** One page that answers "what needs me right now, money-wise" by reading FOUR existing READ-ONLY feeds and rendering each as an item with a prompt + a button into the right tool: **💸 Pay these vendors** = `/qb/payables?days=365` rows where `state==='PAY THE VENDOR'` (owner paid you in full, vendor unpaid) → Hub **Who to Pay** page; **🧾 Invoices to process** = `/qb/ready` (approved, send to QB) + `/vendor-bills?status=submitted` (bills to review) → Hub **Send to QB** / **Review Bills**; **⏳ Overdue invoices** = `/ar/aging` invoices with `age_days>0` → open the invoice directly in QuickBooks (`app.qbo.intuit.com/app/invoice?txnId=`); **📥 Receipts to file** = `/receipt-queue`. **No new Worker endpoint and NO money-write** — every "action" is a deep-link into an already-gated flow (respects BUILD_ORDER + AUTONOMY: read-only display first). Reachable from **both** places per Brett: Command Center (a card, above "Where things stand") and Hub → Dev Log → 🧰 TOOLS. New **`?page=<id>` deep-link** added to `maybeOpenWOFromURL` (index.html) so the Action Center lands on the exact Hub screen (payables/qb-send/invoice-review); guarded by `getElementById('page-'+pg)`, runs after loadAll(), independent of the existing `?wo=`. Same auth/version-poll/STAGING bootstrap as command-center.html. Adversarial review (money-facing) passed; the one HIGH it caught — a false-green "nothing to invoice" when `/qb/ready` is down because `listVendorBills` swallows errors (rule-16 class) — was fixed to fail loud (`readyErr||billsErr`). `h()`-escaped throughout; `txnId` via `encodeURIComponent`. Follow-up (LOW): `listVendorBills`/`listReceiptQueue` still swallow errors to `[]`, so those two cards can't fully fail-loud — fix belongs in those handlers.

**72. Proposal e-sign → QuickBooks (B-076, `2026-08-10.1`).** Customer signs the HTML roofing proposal → Brett one-taps in the Hub to create the QB customer invoice + vendor bill. THREE endpoints: `POST /proposal/sign` (customer-reachable, gated by narrow `PROPOSAL_SIGN_TOKEN`, inert-until-env-set like TRASH_NUDGE — appends to the auto-provisioned `Proposal_Signatures` tab, touches NO money/QB); `GET /proposal/signatures` + `POST /proposal/book` (both admin `WORKER_SECRET` only). `proposal/book` is **preview-first** (`preview_only:true` writes nothing) and **idempotent** — it persists `QB_Invoice_ID` immediately after the invoice POST, BEFORE the bill, so a retry can't double-create; the bill is wrapped so its failure can't lose the invoice. **Money is server-authoritative** via the PRIVATE `PROPOSAL_CONFIG` env — amounts are NEVER in this public repo (see rule 76); client sends only proposal_id+option+signer, never dollars. Invoice = first payment; vendor bill = full base cost; both book to Roofing (QB item 36 / expense 246). Owner resolved via property→owner; **refuses to bill a fallback "Customer"** if the owner doesn't resolve. Hub page `signed-proposals.html` (TOOL PAGES → 🖊). **NOT yet run against live QB** — first booking is Brett's supervised tap (couldn't authed-test from Cowork; no admin secret). To activate online auto-submit: set Cloudflare env `PROPOSAL_SIGN_TOKEN` to match the token baked in the owner proposal HTML. First live proposal = `RC-ROOF-3101GIB-01` (owner + vendor resolved server-side; identities kept out of this public repo). **Follow-up:** signed-proposals.html lacks the B-093 version-poll auto-refresh (rule 69); milestone-based vendor bills (currently one full bill); move `PROPOSAL_CONFIG` to a private Sheet tab for self-serve new proposals.

**71. Stuck-open-WO detector — greenlit #2 "wo_status polling" (Aug 10, `2026-08-09.14`).** Surfaces open work that's gone quiet before it breaches an SLA. New READ-ONLY admin endpoint `GET /stale-wos?days=N` (default 4): returns Work_Orders in an ACTIVE status (`New/Assigned/Accepted/In Progress` — `On Hold` excluded as a deliberate pause) whose age since `Created_Date` ≥ N days, sorted oldest-first, each with a WO label + `age_days` + priority. SAFE class: read-only, no writes, returns only the same WO summary the daily digest already shows (no money/PII). Command Center renders a red **⏰ Stuck open work** card (best-effort — omitted if the call fails, never trips sample mode) that appears only when count>0, above the Optimizer card. This is the read/alert half of the "polling" idea; delivery-to-phone waits on Twilio (B-136). Mark greenlit ID-7 done once eyeballed.

**70. proposals.html de-dups against the build queue — no re-approving something already built (Aug 10, `2026-08-09.14`).** The weekly review regenerates proposals from telemetry each run and didn't know which had already shipped, so a built item (e.g. "Increase Weekly Review Run Frequency") re-appeared as a fresh, approvable checkbox — confusing, and a double-approve risk. `opsQueueRead` gained `?all=1` (returns every row incl. `done`/`dropped`, capped 200; same read-only data, so the `OPS_QUEUE_TOKEN` may read it). proposals.html now fetches `?all=1`, builds a normalized title→status map, and per proposal: `done` → dimmed "✅ already built" (no checkbox), `greenlit`/`building` → dimmed "⏳ in build queue" (no checkbox), `dropped` → still approvable but tagged "✕ previously dropped". A footnote counts how many were hidden. Greenlit-queue cards still render active-only. Verified headless: matched proposals non-selectable, active-only cards, correct chips, no errors.

**69. proposals.html + command-center.html now self-refresh on new deploys (B-093) — fixes "can't click anything but checkboxes" (Aug 10, `2026-08-09.13`).** Root cause of Brett's report: he was viewing a **stale cached** proposals.html from BEFORE the greenlit build (rule 61) — that older version rendered greenlit items as plain `<div class="q">` rows with NO buttons, so only the proposal checkboxes were interactive. The live code was fine (verified: mouse + touch/iPhone-emulation taps all fire, live page byte-identical to repo, no JS errors) — the page was just old, and GitHub Pages serves HTML `cache-control: max-age=600`. Neither of these two tool pages had the B-093 version-poll auto-refresh that the portals (submit/owner/customer/tenant/vendor/wo) already use. Added it to both: poll `GET /version` every 60s, and when `BUILD_VERSION` changes, reload onto the new code (idle → auto-reload; mid-entry / open modal or sheet → non-destructive "Update ready — tap to refresh" banner). Command Center got it too because it's the nav hub — a stale copy hides links added later (e.g. → proposals). NB: this heals FUTURE staleness; a currently-stale tab still needs one manual hard-refresh to pick up the page that contains the poller. Nav was already wired (Hub 🔗 TOOL PAGES → 📊 Command Center → "Open full proposals →"; proposals has "← Command Center") — it was invisible only because the cached copies predated those links.

**68. Optimizer Reviewer runs TWICE weekly — Mon + Wed (Aug 10, `2026-08-09.12`).** First build off the greenlit queue (item ID-1 "Increase Weekly Review Run Frequency", BIG GAIN/S). The weekly telemetry review (`runWeeklyReview`, B-129) fired only Mondays via the Cloudflare cron `0 12 * * 1`; added a mid-week run `0 12 * * 3` (Wed 12:00 UTC / 8am ET) so max issue-detection lag drops from 7 days to ~3.5. Two-line change: `wrangler.toml` `[triggers].crons` gains `"0 12 * * 3"`, and the Worker `scheduled()` branch became `if (cron === '0 12 * * 1' || cron === '0 12 * * 3')`. Runs inside the Worker (full env — no headless-secret issue); each run reads Ops_Telemetry, ranks a proposal, logs to Ops_Review_Log, and delivers only if `digest_enabled=TRUE` (still dormant, so no new alerts spam — it logs). SAFE-class, additive, no money/PII/auth. The proposal's A/B "compare timeliness over 2 weeks" is an observation for the Optimizer/Brett, not part of the build. First live Wed fire: next Wednesday 12:00 UTC.

**67. Review Bills filtering + WO Edit is reachable from the header + WO Source is editable (Aug 10, index.html only — no Worker change).** Three Hub UX fixes Brett asked for, all frontend. (a) **Review Bills now filters** by a free-text search box (vendor / WO# / address / owner / type / trade / description / owner-ref / notes) PLUS five dropdowns — Vendor, Property, Owner, **Type** (Manual/Tenant/Owner/Recurring), Trade — built from the bills actually in the queue, with a live "Showing X of Y" count + Clear. **Load-bearing implementation detail:** it filters by toggling each card's `display` (`irApplyFilters` sets `#ir-card-<i>.style.display`), NOT by re-rendering the list — because `irClearFromQueue(i)` reads `_irBills[i]` and each card's billing panel is mounted as `'ir'+i`. Re-indexing a filtered array would silently point clear-from-queue and the invoice panels at the wrong bill. Do not "optimize" this into a re-render. `irBillContext(b)` resolves each bill → WO → Property → Owner; `loadInvoiceReview` now also tops up `state.owners` (it already topped up workorders/properties/units/vendors) so owner labels resolve. (b) **WO detail modal has an ✏️ Edit button in the header** (`#detail-edit-btn`, wired in `openWODetail`) so Edit no longer means scrolling to the bottom; the bottom Edit button stays too. (c) **Edit WO gained a Source dropdown** (`#ewo-type` → Manual/Tenant Request/Owner Request/Recurring-Preventive) that loads `wo.Type` and saves to `Work_Orders.Type` via the existing `/wo/admin-update` (arbitrary-field writer + audit log; the `Type` column already exists — createWorkOrder + the Review Bills chip use it). Inline JS syntax-checked clean (2 script blocks, 0 errors). No money/QB/auth/Worker surface touched.

**57. Standalone admin/tool pages are launched from ONE place — Hub → Dev Log → 🔗 TOOL PAGES — never from a remembered URL.** Brett's standing preference: he does not want to hunt for tool links. Every standalone HTML admin page (not an in-Hub function) gets a launcher **button** in the `🔗 TOOL PAGES` group in `index.html` (page-devlog, right under DATA TOOLS). The buttons are plain `window.open('<page>.html','_blank')`. Because every tool page lives on the same GitHub Pages origin (`ridge-co.github.io/RidgeCo/`) and reads the admin token from `localStorage.mh_auth`, opening from a logged-in Hub carries the login over — the page opens ready to use, no re-paste. Seeded Aug 9 with `qb-email-backfill.html` (📧 Fill missing QuickBooks emails — copies each blank sub-customer's email down from its owner/property, preview-first, gated `POST /qb/backfill-emails`), `command-center.html` (📊), and `trash.html` (🗑). **CONVENTION — do this every time:** ship a new standalone tool page → add its button to `🔗 TOOL PAGES` in the same commit. The 🔗 TOOL PAGES launcher is frontend-only (GitHub Pages); no Worker change.

**58. The QuickBooks email backfill had TWO bugs, both fixed Aug 9.** (a) **Subrequest cap:** apply does 2 QB calls per customer (SyncToken read + sparse write) in ONE Worker invocation; a large "Apply selected" blew Cloudflare's per-invocation subrequest cap and every row past the budget failed with "Too many subrequests by single Worker invocation" — so repeated tries never stuck. Fix: the page (`qb-email-backfill.html`) now sends ids in **chunks of `CHUNK=8`** via `applyIds()`, one `POST /qb/backfill-emails` per chunk, results aggregated; a thrown chunk fails only its own slice, the rest continue. No Worker change needed for this part. (b) **Silently-dropped rows:** the planner `qbResolveEmailBackfill` used to `continue` past any sub-customer that already had an email, so a property with a **stale/wrong** email was invisible ("why doesn't 153 W Lanvale show up"). It now returns a third bucket **`already`** {id,name,current_email,owner_email,source_id,source_name}; `toSet`/`skipped` semantics unchanged. The page shows an **"Already has an email — not changed"** section with a per-row, opt-in **Force the parent's email** overwrite (`{apply:true, force:true, ids:[...]}` — bypasses the never-overwrite guard ONLY for explicitly-ticked rows; default/no-force behavior is unchanged and still never overwrites). The "Will copy from" column names the exact ancestor whose email would be written (a property→its owner, a unit→its property). Adversarially reviewed: the never-overwrite-without-opt-in invariant is enforced twice (cand map is toSet-only unless force; per-id live race-guard skips non-overwrite rows that already have an address). Worker `BUILD_VERSION` bumped; 19-assertion `test/qb-email-backfill.test.mjs` green + full suite green.

**64. Reconcile-link: stamp the matching QuickBooks bill onto unlinked Hub rows (Aug 9, `2026-08-09.8`).** The "no bill in the Hub" rows almost always DO have a bill in QuickBooks (entered directly, matched by WO number) — this links them so the Hub reflects QB (paid ones read "Vendor paid" and drop off; only the genuinely-open one, e.g. Allen's Kevin Rd, stays). `POST /qb/link-vendor-bills` (admin-gated, **Hub-write only** — updates `Vendor_Bills.QB_Bill_ID`, NO QB write, NO money). Pure matcher `qbMatchBillsToHub` (16-assertion `test/vendor-reconcile.test.mjs`): matches QB bill DocNumber "WO-1052" → Hub `WO_ID` on **digits only**; ONLY unlinked rows; a WO with >1 QB bill is **ambiguous** (never auto-linked); one QB bill is claimed by only one Hub row (no double-link); reports Hub-rows-with-no-QB-bill and QB-bills-with-no-Hub-row; **amount mismatches are flagged, never changed** (linking never edits a dollar figure — Allen's Kevin/Eager rows read Hub $185 vs QB $100, surfaced for Brett to resolve). Preview-first, per-row checkboxes, 50/apply cap. Page: "Reconcile — link QuickBooks bills to the Hub" section on `vendor-reconcile.html`; mobile-verified (390px, no h-scroll). **Allen George reconciled live:** QB has 7 bills — 6 paid ($900), 1 open (WO-1064 Kevin Rd $100); 3 payments total $900; WO-1053 $225 is a QB-only bill (no Hub row). Confirmed Brett's expectation exactly.

**63. Live QuickBooks transaction pull per vendor — bypasses the QB mobile-app limitation (Aug 9, `2026-08-09.7`).** Brett can't pull vendor transaction reports (or pay bills) from the QB mobile app. Since the Worker already holds an authed QB OAuth connection, the reconcile view now pulls the vendor's FULL live QuickBooks history via the API — no CSV export, no mobile app. `qbVendorReconcile` gained a `qb` block (when the vendor has a `QBO_Vendor_ID`): all **Bills** (`select … from Bill where VendorRef=…`), **BillPayments** (`select * from BillPayment where VendorRef=…` — `*` so the `Line`/`LinkedTxn` come back, showing which bills each payment applied to), and direct **checks/expenses** (`select … from Purchase where EntityRef=…`). Each source fetched tolerantly via `qbVendorTransactions` (one failing query — e.g. Purchase not filterable in this realm — degrades to empty + a `sources` flag, never sinks the reconciliation). The page's new "Straight from QuickBooks" section shows totals (open / paid-via-billpayment / paid-via-check / **bills-not-in-Hub**) + card lists; a QB bill with no matching Hub `Vendor_Bills` row is tagged **not in Hub** (red) — those reconcile the "no bill in the Hub" work orders (usually already paid). Read-only. Mobile verified (390px headless screenshot, no h-scroll). **Still gated / not built:** (1) paying bills from the Hub = a QuickBooks BillPayment WRITE (pattern exists at `qbRecordPaidBill`) — money-write, needs preview-first + explicit per-bill confirm before build; (2) "clear reconciled" Hub-side updates. CSV upload is unnecessary given the live pull (offer only as fallback).

**62. Vendor reconciliation view — read-only, filter by vendor (Aug 9, `2026-08-09.5`).** Answers "has this vendor been paid for everything we collected on, what's stuck on an owner, and how old is it." `POST /qb/vendor-reconcile` (admin-gated, READ-ONLY): with no vendor it returns the vendor directory (+ which have bills) for the filter dropdown; with a vendor it takes that vendor's `Vendor_Bills` rows and joins each to the LIVE QuickBooks **Bill** (`QB_Bill_ID` → Balance = still owed the vendor) and **Invoice** (`QB_Invoice_ID` → Balance = still owed by the owner), returning per-row status + ages + summary (owed-to-vendor, collected-but-unpaid, oldest-open). QB reads are batched via `qbFetchByIds` (one `WHERE Id IN (...)` query per 25 ids — not one GET per bill). Status classifier `qbReconcileStatus` (pure, 8-assertion `test/vendor-reconcile.test.mjs`): **COLLECTED — pay vendor** (owner paid us, vendor still owed = the actionable one), Waiting on owner, Vendor paid, No vendor bill in QuickBooks, and **Linked bill not found in QuickBooks** (a `QB_Bill_ID` the sheet has but QB doesn't return — kept distinct so a deleted/typo'd id with a paid invoice can NEVER falsely read "pay vendor"; this was a review catch). Page `vendor-reconcile.html` (💵 Vendor reconciliation in 🔗 TOOL PAGES) — dropdown of vendors, summary cards, per-bill table. Name-matching only auto-resolves an UNAMBIGUOUS contains-match (else returns the choices). Reviewed; the one High (false "pay vendor" on an unresolved bill link) is fixed. Note: `qbAccessToken` may persist a rotated OAuth refresh token to Config — the only write this path can cause, and it's auth housekeeping, not business data. **UI redo `2026-08-09.6`:** first cut was a wide desktop TABLE that forced horizontal scroll on mobile and showed only a WO number (violated the mobile-first rule — a real miss). Rebuilt as **stacked cards** (no h-scroll — verified at 390px with a headless-Chromium screenshot: scrollWidth==clientWidth). Each card now shows the **property address + unit**, the **trade + job description** (joined from Work_Orders/Properties/Units on WO_ID in the endpoint), status, owed-vendor / owner-owes / age, and an **Open WO →** link to `index.html?wo=<id>` — a new guarded deep-link hook in index.html (`maybeOpenWOFromURL`, runs after `loadAll()` resolves on init) that opens that WO's detail modal.

**61. One-time backfill for the BACKLOG of unsent invoices missing a send-to email (Aug 9, `2026-08-09.4`).** Rule 60 fixes NEW invoices; this fixes the ones already sitting in QuickBooks with a blank BillEmail (the ones Brett had to paste into). Endpoint `POST /qb/backfill-invoice-emails` (admin-gated): scans up to 1000 recent invoices, and for each with a **blank** BillEmail resolves the send-to by climbing the QB customer tree from the invoice's `CustomerRef` to the nearest ancestor with an email (`qbNearestCustomerEmail`, pure + tested). Preview-first (to_set / skipped / already); **never overwrites** an invoice that already has an email; **never sends** — Brett still sends from QuickBooks. Page `qb-invoice-email-backfill.html` (🧾 Fix unsent invoice emails in 🔗 TOOL PAGES), chunked in 8s; server-side hard cap of **25 ids per apply** as a subrequest backstop (returns `remaining`). Reviewed — no critical; never-overwrite + never-send double-guarded. Caveats surfaced to Brett: (a) invoices whose customer AND owner are blank in QB land in **Skipped** — run 📧 Fill missing QuickBooks emails first; (b) the preview's "← source" column shows WHERE each email came from — eyeball it, because a unit sub-customer whose `PrimaryEmailAddr` was hand-set to a **tenant** would carry that tenant address; (c) only the newest 1000 invoices are scanned (matches ar-aging; fine at Brett's scale). Depends on customers having emails in QB — so the customer backfill + this invoice backfill are a two-step pass for owners like Goldszmidt whose QB owner email is blank.

**60. THE REAL "I keep pasting the email" root cause: Hub-created invoices never set BillEmail (Aug 9, `2026-08-09.3`).** The email-backfill work (rules 57–59) fixes the CUSTOMER records, but Brett's actual pain — "153 shows a valid email yet I still paste it into every invoice" — is a different bug: `qbSendInvoice` built `invoicePayload` with `Line/TxnDate/PrivateNote/CustomerMemo/CustomerRef` but **no `BillEmail`**. QuickBooks does NOT auto-copy a customer's `PrimaryEmailAddr` onto an API-created invoice, so every invoice posted with a blank send-to and had to be typed by hand — even when the customer had an email. This is ALSO why the auto-send/AR-remind flow (which skips invoices with no `BillEmail`) couldn't send them. Fix: before the invoice POST, set `invoicePayload.BillEmail = {Address: email}` where email = `owner.Billing_Email || owner.Email`, falling back to the **owner's** QB customer `PrimaryEmailAddr` (never the billed sub-customer's — that could be a stray tenant address that then gets auto-emailed the pay link). Guards: only attach a ≤100-char well-formed address; if QuickBooks still rejects the POST **with** BillEmail, retry once **without** it so a bad email can NEVER block invoicing (warn either way). Preview now shows the same `Billing_Email || Email`. Purely additive to the send path — amounts/lines/CustomerRef/DocNumber untouched. Adversarially reviewed (no critical; the two Medium findings — QB-reject-blocks-invoice and sub-customer-fallback-mis-send — are both fixed here). Full suite green. Nesting note: adding unit sub-customers under a property created blank-email units (fixed by the backfill), but the pasting persisted on the property too because of THIS invoice-level gap — the property kept its email; the invoice just never carried it. NOTE: `/trash/invoice` (`2026-08-07`) still omits BillEmail — same one-line fix pending there.

**59. The email you see in the Hub is NOT proof it's in QuickBooks — the backfill now shows QuickBooks ground truth + lets you type-and-set any row (Aug 9, `2026-08-09.2`).** Brett hit this: 153 W Lanvale (Goldszmidt property) landed in **Skipped** even though the Hub shows `goldszmidtproperties@gmail.com` next to it. Cause: that email lives in the Hub/Sheets `Owners.Billing_Email`, but the QuickBooks **owner** customer has **no** `PrimaryEmailAddr`, so the backfill (which reads QuickBooks only) has nothing to copy down → skipped, no checkbox. Two additions: (a) preview now returns **`all_customers`** = every QB customer with the email read straight from QuickBooks (owners + properties + units), rendered in a filterable **"Every QuickBooks customer — the real email on file"** panel that prints **"(blank in QuickBooks)"** when QB truly has nothing — the answer to "how do I know which ones actually carry an email in QB." (b) An **explicit-set** mode: `POST /qb/backfill-emails {apply:true, email:"x@y.com", ids:[...]}` writes that exact address onto the chosen ids (validated, overwrites by design, chunked, confirm-gated). Fixes a skipped property directly, OR set it on the **owner** row then re-preview to cascade down via the normal inherit path. Explicit mode is a separate branch — it does not touch the inherit/force logic. The Hub→QuickBooks email disconnect (Sheets has it, QB doesn't) is the root lesson: **QB is its own store; a Hub email is not pushed to QB unless something writes it there.**

**56. Job photos/videos are made anyone-with-link readable AT UPLOAD, so vendors can view them without a Google login.** Uploaded WO media is owned by the Sheets service account; nothing made it link-viewable except a QB invoice send (which shares the WO folder for the customer memo). So a vendor opening a photo/video chip in the portal hit Google's sign-in / request-access wall — it was NEVER an issue of the vendor paying Google or their email being "in the system" (Drive files aren't shared per-email at all; they were simply private). Fix (`2026-08-08.1`): `driveShareAnyone(role:reader,type:anyone)` now runs at upload in BOTH paths — `handlePhotoUploadClean` (gated on `!isInternal`) and `logAttachment` (the vendor-portal resumable path, gated on `file_type ∉ NON_SHARE_FILE_TYPES`). **Vendor cost docs stay private:** `NON_SHARE_FILE_TYPES=['receipt','bill','invoice']` — never shared (preserves FEATURE_LOG rule 13; the `_Internal — Vendor Bills` folder is untouched). Backfill for pre-fix media = secret-gated `POST /admin/share-attachments` (`{dry_run?,limit?}` → `{scanned,shareable,shared,skipped_internal,skipped_no_id,failed,failures}`; idempotent — re-sharing a public file is harmless; skips `Active=FALSE` + the 3 cost types), surfaced as **Hub → Dev Log → 🖼 Fix photo/video sharing** (dry-run count → "Share them all"). Privacy note: this is the same "anyone-with-link" posture the invoice photo link already uses.

**55. The Optimizer loop's output reaches Brett via the BrettOS Command Center (pull), not push.** Scheduled-task push notifications don't surface on mobile yet, so background-agent output was landing in invisible sessions ("nothing popped up"). Fix: `command-center.html` now has an **Optimizer card** that pulls **read-only** `GET /ops-review-log?limit=N` (latest weekly-review rows) + `GET /ops-telemetry?days=7` and renders the review + telemetry. Both are admin-gated (WORKER_SECRET), read-only (no spend/write). The card fetch is best-effort + concurrent — it can NEVER trip the Command Center into sample mode or gate first paint; all dynamic text escaped via `h()`. **Delivery model of record:** the **Worker-cron Reviewer writes → Command Center reads** (reliable, mobile-friendly). **Scout & Prepare are Cowork sessions** with no secret/PAT and no reliable push — they surface **in-session** ("ask in chat: what've you got"), NOT via notification. Don't rebuild on push notifications until that surface works on mobile. Deployed `2026-08-07.12`.

**52. The weekly Optimizer Reviewer (B-129) runs as a WORKER CRON, not a Cowork task.** A fresh
scheduled Cowork session has no `WORKER_SECRET` and no `BRETT_GH_PAT` (verified Aug 7 — headless env
has only the permissionless GitHub tokens), so it can't read authed telemetry or the private repo.
The Worker cron can — it has Sheets + `ANTHROPIC_API_KEY` in env. Cron `"0 12 * * 1"` (Mon 12:00 UTC)
→ `scheduled()` branches on `event.cron` → `runWeeklyReview`: reads 7d of `Ops_Telemetry` → metrics +
stuck-pattern flags (H2) → `claude-sonnet-4-6` ranked proposal (best-effort; skipped under 5 rows) →
`Ops_Review_Log` tab → delivers ONLY if `digest_enabled=TRUE` (email still a stub, SMS needs Twilio,
so dormant today). **Do not** route `/ops-review` as GET (it spends + writes — it's `POST`, admin-gated)
and manual runs never deliver (only the cron delivers). On-demand: **Hub → Dev Log → 🔎 Run Ops Review**
(and 📊 Log test telemetry row to verify B-128 in one tap). The daily digest cron now also logs a
telemetry heartbeat row, so `Ops_Telemetry` self-creates every morning at 7am ET.

## TELEMETRY SPINE — Ops_Telemetry (B-128, shipped Aug 7, 2026)

**50. Telemetry is logged through ONE chokepoint, `logTelemetry(env, rec)`, and it self-provisions.**
The measurable state the Optimizer reads (`CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0` +
`TELEMETRY_SPINE_BUILD_BRIEF_v1.0`). One tab `Ops_Telemetry` (17 cols), two feeders: Worker jobs call
`logTelemetry` directly; Cowork sessions/skills `POST /telemetry/log` (WORKER_SECRET-gated by the top
auth gate — it's not in `PUBLIC_PATHS` and no role scope allows it). Self-provisions via `ensureTab`;
calls `ensureColumns` on **every** write (rule 37 — `ensureTab` only writes a header to an *empty* tab,
so a drifted header would silently drop fields). **When B-127's `routeAI` lands it MUST call this same
`logTelemetry`** — one write path, never two. Don't rename it (cross-brief callers resolve by this name).

**51. Two load-bearing telemetry rules — do not loosen.** (a) **Best-effort for host endpoints:** a
telemetry write must NEVER break the job it measures. `digestResponse` wraps the whole `logTelemetry`
call in `try/catch(_){}` — the digest is the product, the row is a side-effect. (b) **Fail-loud on the
endpoint + landed-guard:** `logTelemetry` throws unless `addRow` returns a real `{success:true,id}`
(rule 19 — a write can "succeed" without landing a row), so `POST /telemetry/log` 500s on a broken pipe
instead of the Optimizer reading a silent hole. (c) **`Success` is written by the verifier/caller from
the REAL outcome, never a handler's own optimism** — the "verifier, not self-agreement" rule (H1). The
same rule binds the verifier skills: `test-verified-builds` / `ridgeco-validate` judge against the
brief's acceptance criteria + live state (deployed-Worker responses, actual Sheet read-backs) and
**never** read or restate the builder agent's "done"/"success" claim.

## TIME BILLING — hours × rate, per customer, service charge (shipped Aug 5, 2026)

**40. The QuickBooks labor line shows hours × rate, not "1 × $total".** `buildInvoiceLines`
was sending every labor line as `Qty:1, UnitPrice:laborAmt`, so a 2h/$150 job read as
$150/hr to the customer. It now splits into `Qty:hours, UnitPrice:Rate` — but ONLY when the
bill's `Bill_Type==='hourly'` AND its stored `Rate × Hours` reconciles with `laborAmt` to the
cent. **Do not loosen that gate.** On a marked-up vendor bill `laborAmt` (= Customer_Total −
materials) carries markup + on-site + the 5% fee, so hours × the vendor rate will not tie out
and it MUST fall back to the single combined line — deriving a rate from `laborAmt/hours`
would print a fabricated $/hr and expose the markup. `Amount` is always `laborAmt`, so the
invoice total is preserved either way. Pinned by `test/invoice-hours.test.mjs`.

**41. Brett's own time bills at a per-customer rate, resolved on the server.** New
`Owners.Hourly_Rate` column (blank = the $85 default; a number pins that customer, e.g. $75
for Goldszmidt / Phoenix / Casey Properties). `resolveHubHourlyRate()` resolves it
WO→Property→Owner when a `role:'hub'` time entry is saved with no explicit rate; the Hub owner
setup sets it (add-owner field + inline box on the owners list, via `/owner/update`).
`HUB_HOURLY_RATE` client constant is now 85 and is a display fallback only. **The
tiered/itemized markup's separate $75 on-site coordination rate is deliberately NOT this
rate — leave it unless Brett asks.** Vendor time entries keep their own rate.

**42. Half-hour service charge on turning logged time into a bill.** `hubBillUseLoggedTime`
asks once per job whether the pulled hours already include the first-half-hour service charge;
"no" adds 0.5h at the same rate (flows through hours × rate to the invoice). Hourly path only;
does NOT stack with the tiered pricing's built-in $75. Applied once per job, not per entry.

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

**39. Logged time is a record, not a charge — the invoice is built from a BILL.** Hours
logged on a job reached nothing on their own, and every downstream step (price, approve,
send) is gated on a `Vendor_Bills` row. When Brett is the vendor there is nobody left to
submit one, so "Log Time" looked broken when it was working exactly as built. The hours can
now BE the bill: `hubBillUseLoggedTime` fills the Hub bill form from them (hours × rate when
every entry shares a rate, flat when they don't — never a blended rate that matches no
entry), and `/vendor-bill/add` takes `time_entry_ids`, strips them off the row, and stamps
`Bill_ID` onto those entries after the bill exists. **Order matters:** bill first, link
second — hours marked spent against a bill that was never created is unrecoverable, hours
left free is not. `/time-entries` then reports `Billed_Bill_ID` so the billing panel stops
offering them on top as supervision. Only a LIVE bill consumes hours: voiding one releases
them, and an unreadable bill list reports `null` (≠ `''`) so "don't know" never reads as
"safe to charge again" — rule 16 applied to time. (Aug 5, 2026.)

**43. Every receipt on a job can reach the invoice, and cost pass-through is the default
price.** (Numbered after the Aug-5 time-billing rules 40–42, which landed concurrently.)
Two gaps closed on the invoice builder. (a) The own-materials picker
(`loadInvoiceMaterials`) excluded any `Role=vendor` receipt on the theory it arrives on the
vendor's bill — but an in-house vendor's bill is built from logged TIME (rule 39) and carries
no receipt, so the receipt reached no invoice line and had to be typed by hand. Now ALL active
receipts on the job show; vendor-logged ones stay UNTICKED by default (one tap to add, tagged
"vendor-logged") so a receipt that IS on a 3rd-party bill's `Receipts_JSON` isn't double-billed
silently — the `/receipts-billed` already-invoiced guard is unchanged. Known residual: no hard
programmatic block if the same physical receipt sits in BOTH the Receipts tab and a bill's
`Receipts_JSON` (non-silent — unticked + warning). (b) **Pass-through pricing is now the
pre-selected default:** labor + materials at cost, no markup, no $75 admin, 5% card fee an
OPTIONAL toggle (default OFF) — the right starting point for hourly customers (rate + materials,
no surcharge). Tiered and Itemized unchanged, one tap away. The approve split
(`invBillThisJob`) is mode-aware (`_invMode`/`_invPass5`, cleared in the Review-Bills reset) so
a no-surcharge pass-through reports fee `0` and markup `0` instead of inventing a phantom 5%
split. `pricing-model.test.mjs` +8 assertions (29 total). (Aug 5, 2026.)

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
| Google Contacts sync — read token + augment write-back | ✅ Shipped (deployed) | `CONTACTS_SYNC_TOKEN` (own secret, not `WORKER_SECRET`): GET on `/tenants /owners /vendors /properties /units` + POST `/contact/augment` ONLY. `augmentContact` fills BLANK fields from an allow-list (`Email` only) — never overwrites, never phone/ID, never creates rows, `ensureColumns` first, logs to self-creating `Contact_Augment_Log`. `preview:true` writes nothing. Engine = Apps Script under brett@bmoremanagement.com (one-way Hub→Contacts + augment-only back). Auth gate ~L49; handler after `updateRow`. Live smoke-tested: overwrite refused w/ read-back, Phone/ID rejected, other writes 401. | Aug 6, 2026 |
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

## CLEANING-VENDOR RECONCILIATION + QB WRITE-BACK ENDPOINTS (Aug 6–7, 2026)

**44. "Cleaning" books to the QB Service item 43 ("Cleaning Service"), NOT item 22.** Item 22 named "Cleaning" is a QuickBooks *category*, which QBO rejects on an invoice line ("QBO 2500 — an item in this transaction is set up as a category instead of a product or service"). `qbSetupTrades` now honors an optional `itemName` on a `QB_TRADES` entry, so the sellable Service item is created as "Cleaning Service" (id 43 → Cleaning Income 295); `QB_TRADE_MAP.Cleaning.item = 43`. Vendor bills were unaffected — bills reference the expense *account* (282) directly, not an item.

**45. Before creating vendor bills in QB, query for EXISTING bills — the invoice may already be entered.** The Aug 6 cleaning push assumed Andrea's #24/#30/#31 were un-entered and created them; they were already in QB (bills #0024/#0013/#0030), so it double-posted **$1,590.97** of payables (later deleted). Read-verify confirmed the vendors/customers *existed* but never queried their open *bills*. For any vendor-bill batch, `select … from Bill where VendorRef = …` first. (The customer invoices and Michelle's #9908–9912 were genuinely new — those were correct.)

**46. `POST /qb/record-paid-bill`** (secret) — records an already-paid vendor bill (+ optional Bill Payment that clears it) directly in QB, for an invoice paid outside the Hub with NO customer invoice (which `/qb/send-invoice` cannot post — it requires a customer total). Body: `{vendor_qbo_id, amount, expense_account_id, pay_account_id?, doc_number?, txn_date?, pay_date?, memo?}`. Idempotent: reuses a same-`DocNumber` bill on that vendor and won't re-pay a zero-balance bill. (Andrea #0020 → bill 7538 + payment 7539; MandT Rental Trust 6287 = acct 155, Cleaning expense = 282.)

**47. `POST /qb/clear-ir-bill`** (secret) — clears `QB_Bill_ID`/`QB_Bill_Number` on an Invoice_Review row whose vendor bill was later deleted in QB, leaving the customer invoice id/number/status intact. Body: `{ir_id}`. Used after deleting the 3 duplicate Andrea bills (IR 10/11/14 → WO-1102/1103/1107) so the Hub stopped showing phantom payables.

**48. `POST /qb/reprice-invoice`** (secret) — changes the dollar amount of an ALREADY-SENT customer invoice (unlike `/qb/repair-invoice`, which preserves the total and only fixes wording — it hard-refuses a total change). Rewrites the single sales line to a new amount, preserving its item/income account + description, and writes the new `Customer_Total`/`Markup`/`Processing_Fee` back to Invoice_Review. **Refuses a paid or multi-line invoice.** Body: `{ir_id, new_total, new_markup?, new_fee?}`. Used to rescale the 7 Andrea customer invoices over $200 to a $35 markup + 5% (new Andrea customer total $1,980.27).

**49. Cowork can now deploy the Worker (GitHub push-to-`main` → Cloudflare Workers Builds).** Verified across seven deploys Aug 6–7 (`2026-08-06.3` → `2026-08-07.3`). The "three stranded commits / apply this patch" warning that used to head CURRENT.md is obsolete — writes to `Ridge-Co/RidgeCo` succeed from this session. Two operational gotchas: Cloudflare's edge 403s a `Python-urllib` user-agent (scripted Worker calls must send a normal `User-Agent`), and the Sheets API has a per-minute read quota (space out large Hub batches or they fail mid-run).

## TRASH SERVICE — one-tap recurring flat-rate billing (B-205, trash.html + worker.js, shipped Aug 7, 2026, `2026-08-07.6`)

New standalone mobile page `trash.html` (Pages: `ridge-co.github.io/RidgeCo/trash.html`; shares the Hub's `mh_auth` code) for Brett's twice-weekly flat-rate ($40) trash-straightening service at side-by-side rentals (115 W 29th; 151/153 W Lanvale split). **Not yet run against live QB — Brett does the first real send himself off a preview.**

**50. Two-layer model: a Trash_Visits row is PROOF, the QB invoice is MONEY.** Each trip is logged as one `Trash_Visits` row (photos + date + optional extra) — this is what the nudge watches and what proves he went. Billing is **one QuickBooks invoice per property per WEEK**, assembled from that week's visits: a 2×/week property (115) rolls both $40 visits into one $80 invoice; a 1×/week target (151 or 153) bills its single visit. `trashWeekKey` is **Monday-anchored, UTC-noon date-only** — a Sunday belongs to the week just ending. Two self-provisioning tabs (`Trash_Properties`, `Trash_Visits`) with **ID at column 0** (unlike Work_Orders); `ensureTrashTabs` creates tab+headers on first write via `:batchUpdate` addSheet + `ensureColumns`, so prod and staging each provision themselves.

**51. Endpoints (all secret-gated): `GET /trash/properties|week|unbilled|qb-customers|qb-items`, `POST /trash/property/add|property/update|log-visit|invoice`.** `POST /trash/invoice` is **preview-first** (FL rule 10): `preview_only:true` returns the exact lines + total + warnings with ZERO writes; confirm posts the QB Invoice (`CustomerRef` + `SalesItemLineDetail` per visit + one extra line per extra), attaches before/after photos as Attachables, and stamps the visits billed. QB customer + item are chosen once per property from existing QB records (`/trash/qb-customers`, `/trash/qb-items`) — **no find-or-create, so no duplicate customers**. Item fallback when unset = General item `40`.

**52. Extra charges: $20 minimum in $20 increments, one tap.** The visit sheet's extra row (+$20/+$40/+$60/Custom, default None) adds an `Extra_Amount` + `Extra_Reason` to that visit; it becomes its own invoice line ("Extra — <reason> (<date>)"). Logging the same property+date twice **merges** (photos append, extras add) instead of duplicating the visit.

**53. REGRESSION — stamp visits billed IMMEDIATELY after the QB POST, before the photo-attach loop.** `trashInvoice` filters `toBill = weekVisits.filter(v => !v.QB_Invoice_ID)`, so if the invoice posted but the visits weren't stamped (crash/Sheets blip mid-attach), a re-send would create a **duplicate invoice**. Fixed: stamp all billed visits right after `invoiceId` is confirmed (photos are best-effort and run after); if any stamp fails, return `ok:false` + `invoice_created:true` with a loud "DO NOT resend" so a retry can't double-post. The `|| default` zero-conflation trap (treating an explicit `0` as missing) was caught by tests in `Base_Rate` and `Grace_Days` and fixed to `=== '' || == null` checks. 22 assertions in `test/trash.test.mjs`; full suite green; adversarial review passed.

**54. Round 2 (Aug 7, `2026-08-07.9`): editable properties, single photo button, shared generic item, and it does NOT touch the work-order/payables system.** (a) Properties are now editable — `trash.html` "Manage properties" lists each with its **mapped QB customer + item shown** (so a mis-assignment like "928 → 153" is visible), an Edit modal (`POST /trash/property/update`), and Remove (soft-delete `Active=FALSE`). (b) One "Add photos" button (before/after distinction dropped). (c) `trashDefaultItem` find-or-creates ONE shared **"Trash Service"** QB Service item (IncomeAccountRef 198), used whenever a property has no item of its own, so every property bills an identical charge with **no address in the Product/Service column** (the address lives only on the customer); resolved+created only on real send, never in preview. (d) **Architecture note:** the trash flow creates a QuickBooks **customer invoice only** — NO work order, NO `Vendor_Bills` row, NO `Invoice_Review` row — so it never appears on the "who to pay"/payables page. That's correct for "Brett does it, customer pays the company, Brett's already paid." The "another vendor does the trash → track a payable to pay them" case is **not built** (future: mark a visit as vendor-performed → create a vendor bill).

**Nudge (partial):** the in-app "Needs attention" banner (missed/unbilled visits, current + prior week with a per-property deadline+grace so a day-late trip doesn't false-alarm) is LIVE on the page. The **phone push** is wired but dormant: `GET /trash/unbilled` accepts a narrow read-only `TRASH_NUDGE_TOKEN` (inert unless the Cloudflare env var is set, same pattern as `CONTACTS_SYNC_TOKEN`) so a scheduled task can poll it without the admin secret — set the env var + create the scheduled task to turn it on.

## OPTIMIZER GREENLIT WORKFLOW — proposals become actionable builds (Aug 9, 2026, `2026-08-09.8`, commit `720a09f`, SHIPPED)

**61. The greenlit queue is a workflow now, not a read-once bucket.** Approving a proposal used to store it and strand it — `proposals.html` showed only Title+Tag for greenlit items, with no way to re-read, copy, or act, and headless Claude can't read the authed queue (no worker secret). Now greenlit items render in **full** (Rank/Problem/→action/Impact/chips). The bridge across the secret wall: **📋 Copy build brief** (per-item) and **Copy all** render clean markdown into a modal (`navigator.clipboard` + manual-select fallback) that Brett pastes into a Claude session — the item comes to Claude instead of Claude reaching for the secret. `OPS_QUEUE_COLS` gained **`Problem`** so the WHY survives `opsApprove` (a brief without its problem statement is half a brief).

**62. `POST /ops-queue-update {id,status}` — greenlit → building → done | dropped** (admin-gated, SAFE class: touches only `Ops_Build_Queue.Status`, no money/PII/auth). Reuses `updateRow` (matches by header name, returns `{success:true}`). `opsQueueRead` already filters out `done`/`dropped`, so the active list is always the live backlog. Status buttons on `proposals.html` drive it. **REGRESSION caught by adversarial review before push:** the buttons were built as `onclick="setStatus('+jsq(x.ID)+',...)"` — `jsq` emits double quotes inside a double-quoted attribute, so every click threw `SyntaxError` and the write path was 100% dead (the exact silent-no-op pattern). Fixed with `h(jsq(x.ID))` (escapes `"`→`&quot;`). Rule: any sheet value injected into an inline `on*` handler must be `h()`-escaped.

**63. Per-job-type health + zero-activity-day flag on the Command Center Optimizer card.** `computeTelemetryMetrics.byJob` now carries per-type `success_rate` + `avg_latency_ms` (accumulators built in the loop, derived after, private `_`-fields deleted before return; global metrics unchanged). The card renders a **BY JOB TYPE (7d)** table (n / success / latency / fixed, red when success<80% or ≥2 fails) and a **⚠ no jobs logged today** flag (computed from `opt.tel.rows` by local date — a silent telemetry pipe usually means broken, not quiet).

**64. Thin-data honesty guard on the Reviewer.** When a weekly review runs on `<20` telemetry rows (`THIN_DATA_MIN`), `runWeeklyReview` prepends a loud "⚠ DIRECTIONAL ONLY — thin data" banner to the proposal and returns `thin_data:true`; `proposals.html` shows the same banner from `Total_Jobs<20`. Exists because Round 1 proposals were generated from ~9 mostly-synthetic rows and looked more confident than they were — say the confidence out loud.

**65. PRINCIPLE (how we work): every "store" ships with its "act" in the same build.** Storable data is not "done" when it's stored — it's done when it can move into a workflow. If the workflow to act on the data isn't built, that gap is named in the plan up front, never discovered later by Brett. This rule exists because too many tools shipped ~60% (capture built, use skipped). Planning mode must check "how does this data get acted on?" before a build starts.

**66. Narrow read-only `OPS_QUEUE_TOKEN` — the headless Prepare agent can read the greenlit queue itself (Aug 9, `2026-08-09.9`).** Closes the greenlit→build bridge from the other side: the manual Copy-brief (rule 61) carries an item to a *human-run* session, but the Tue/Fri **Optimizer Prepare agent** is headless and (by autonomy design) has no admin secret, so it couldn't read the authed queue at all. Added a fourth narrow token to the auth gate — same inert-until-env-set pattern as `TRASH_NUDGE_TOKEN` / `CONTACTS_SYNC_TOKEN` — accepted **ONLY for `GET /ops-queue`** (the greenlit backlog: Title/Problem/Rank/Impact/first-step, no money, no PII). It is **read-only**: the write path (`POST /ops-queue-update`, status lifecycle) still requires the full admin `WORKER_SECRET`, and the token can deploy nothing. Fully dormant until the Cloudflare env var `OPS_QUEUE_TOKEN` is set, so the deploy itself is a no-op until Brett turns it on. The token value lives only in the Prepare agent's scheduled-task prompt (server-side) — never in this repo. This is the deliberate, bounded expansion of headless-agent reach that keeps the autonomy loop at Rung 0–1 (propose + prepare, never deploy).

## HOW TO UPDATE THIS LOG

When a feature is added, fixed, or verified: add/update its row immediately.
When something breaks and is fixed: add a regression rule at the bottom so it never breaks the same way again.
