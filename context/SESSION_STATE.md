# SESSION_STATE — checkpoint hand-off

**Read this on any `resume ridgeco` (light load first, then this file, then continue from "Next step").**

## Checkpoint: Oct 19, 2026 (evening) — vendor Paid tab, estimate skip-text, padded fee, fee credits, credit-aware reprice/Who To Pay, sweep built on `feat/estimate-skip-sms-vendor-paid-tab-oct19`
**State:** code + tests + docs done; next: staging verification (staging PR), Brett's go/no-go on the `main` PR. Details: FEATURE_LOG "VENDOR PORTAL PAID TAB ...".

## Earlier checkpoint: Oct 19, 2026 — proposal netting + instant-pay fee + property/unit texts built on `feat/proposal-netting-instant-fee-oct19`
**State:** code, UI (Review Bills preview, Who To Pay text button, Vendors Instant pay checkbox), 83 tests and context docs done. Next: staging verification, then Brett's go/no-go to merge the `main` PR. Details: FEATURE_LOG "PROPOSAL NETTING + INSTANT-PAY FEE", CURRENT.md top block, Continuous Improvement Project doc `claude/final-billing-after-deposit-netting-instant-fee-oct19.md`.

## Last checkpoint: Sep 26, 2026 (~18:20 ET) — BrettOS Tasks Manager quick-link shipped (PR #76 → staging, PR #77 → main)

**What happened:** Session's main work was on the separate `brett332/BrettOS` Apps Script project
(Google Tasks ↔ BrettOS Tasks Sheet sync) — multi-list auto-categorization, a learned-rule review
web page, and a `clasp` + GitHub Actions auto-deploy pipeline (same shape as this repo's own
Cloudflare Workers Builds). Full detail lives in the claude.ai "Continuous Improvement" Project's
`task-capture-tasks-sheet-sync.md`, not here, since it's bound to a different Sheet/Worker than
this repo. The one piece that touches THIS repo: two "🗒️ Tasks Manager" buttons added to
`index.html` (Dashboard/Command Center + Dev Log tools group), linking to the deployed web app so
Brett can reach it without a bookmark. UI-only, no `worker.js` change — PR #76 (staging) and PR #77
(main) both merged same session, no interim staging-only period needed. Live-verified by fetching
`https://ridge-co.github.io/RidgeCo/` directly and confirming both button strings are present.
FEATURE_LOG rule 198 (`[FL-20260926-2210-tm]`).

**Next step:** Brett is going to organize/update his task list (existing + new items) in a
new session next — likely BACKLOG.md and/or the BrettOS Tasks Sheet itself, not yet scoped.

## Previous checkpoint: Sep 24, 2026 — Allow-list simplification shipped (PR #55); property/unit linking discoverability + duplicate-check shipped (PR #57)

**What happened:** Closed out `ALLOWLIST_SIMPLIFICATION_BUILD_BRIEF_v1.0.md` (all 3 changes: gh-broker
redundant arrays removed direct-to-main; `HUB_TEST_TOKEN` broadened on staging; `HUB_PROD_RO_TOKEN`
inverted to an 8-path deny-list) — PR #55 merged by Brett ("go with pr 54 and pr 55"), verified live
on staging and prod. Then built and shipped `PROPERTY_UNIT_LINK_AND_DUPE_CHECK_BUILD_BRIEF_v1.0.md`
(new brief, no prior scoping doc) from a fresh ask: QB Mapping discoverability (Dev Log link + Owner
row 🔗 button + filter box), a link-vs-create stopgap on Add Property (lists unlinked properties),
and a `findSimilarProperties`/`findSimilarUnits` duplicate check with a 409+`force:true` soft-block
on `/property/add` and `/unit/add` — PR #57 merged by Brett ("MERGE PR 57"). Full detail in both
build briefs and `FEATURE_LOG.md` ([FL-20260924-1815-as], [FL-20260924-1900-pu]).

**Also this session:** discovered the Claude Project "Continuous Improvement" (claude.ai) had been
running a parallel, drifting copy of some of these same docs (e.g. its own
`ridgeco-allowlist-simplification-build-brief.md`) — the repo's `context/` + `brett332/data/
business-context/` system here is the long-standing authoritative one (predates Claude Projects).
Brett wants the two kept in exact sync going forward; a full reconciliation pass across all ~30
Claude Project docs against this repo is in progress (see Next step).

**Next step:** Continue reconciling the Claude Project docs against `context/` and
`brett332/data/business-context/`. Known concrete gaps found so far, not yet fixed:
- `business-context/cabin-str.md` is stale — missing the RemoteLock "Edgestate" finding and the
  Airbnb-phone-masking root cause/fix work.
- `business-context/cleaning-vendor-push-RESUME.md` is marked "✅ COMPLETED... do NOT re-run" but a
  Sep 4 follow-up found a real unresolved $110 false-paid bill, an unresolved $1,131.34 entry, and
  $810 never pushed to QuickBooks — needs updating so it isn't read as fully closed.
- Several project-only design docs were never promoted to a repo build brief: owner-portal PM-lite,
  landlord-managed-WO/SaaS monetization, material returns policy, vendor expedited-pay. Candidates
  for new `context/*_BUILD_BRIEF_v1.0.md` files if Brett wants them formalized here.
- `zapier-make-automation-audit.md` (Project doc) has no repo home yet; candidate:
  `business-context/zapier-make-inventory.md` once the audit itself is finalized.

## Prior checkpoint: Sep 16, 2026 — 1109 Battery Ave unit/tenant fix closed out; FEATURE_LOG/CURRENT.md too large to update from a chat session

**What happened:** Brett asked (chat session, not Cowork) to pull up the 1109 Battery Ave fix from
FEATURE_LOG rule 171 (Sep 14 — Property Structure management feature built, but the actual Battery
Ave record itself left pending two answers). Brett supplied both: unit labels "Apt 1"/"Apt 2",
existing tenant Reagan (ID 102) is in Apt 2. Fixed live via the already-shipped `/unit/add` +
`/tenant/update` endpoints (no code changes) — created Unit 55 (Apt 1, Property 84, vacant) and
Unit 56 (Apt 2, `Tenant_ID:102`), set Reagan's `Unit_ID` to 56. Verified live via `/units`/`/tenants`
after the write. Also re-confirmed live in `index.html` (matches `BUILD_VERSION 2026-09-16.1`) that
rule 171's feature (Edit Property → Units section; Edit Tenant → Unit dropdown) is fully wired —
Brett can do this himself in the Hub for any future property, no session needed.

**🔴 Real gap surfaced this session, worth acting on: `FEATURE_LOG.md` (476KB) and `CURRENT.md`
(211KB) are now too large to fully rewrite through a chat session's GitHub write path** (`GH Broker`'s
`commit_file` only does whole-file replace, no patch/diff — reproducing either file's full existing
content plus a new entry exceeds what a single chat turn can output). This is why rule 171's "still
pending" line in `FEATURE_LOG.md` was NOT corrected to reflect this fix, and no new FEATURE_LOG/
CURRENT.md entry was added for it — only this file (small enough to round-trip) got updated. **Not
a one-off** — this will keep happening for any future chat-session context update as both files keep
growing. Worth deciding: (a) a periodic archive/rotation (e.g. move entries older than N months into
a dated `FEATURE_LOG_ARCHIVE_2026H1.md`, matching a roll-old-entries-into-a-summary pattern), or
(b) route all future FEATURE_LOG/CURRENT.md edits through an actual Claude Code session (local git,
not a chat-turn tool call) rather than a Cowork/chat session, since Claude Code isn't bottlenecked by
a single-turn output limit the way this session was.

**Next step:** Someone with a proper git session (Claude Code, or Brett's own PAT via the documented
Basic-auth method if he chooses to provide one) should: (1) correct rule 171 in `FEATURE_LOG.md` —
the "Battery Ave record itself is still pending..." sentence is now stale, and (2) add a short
CURRENT.md status line pointing at it. Low priority / no rush — the underlying Sheet data is already
correct and live either way; this is purely a documentation-trail gap.

---

## Last checkpoint: Aug 22, 2026 — B-140 confirmed, B-141 done, B-127 built but NOT pushed. Next: B-211, WITH Brett.

**Next step:** Brett is opening this fresh session specifically to build **B-211** (`judge()` write-gate)
**with** him — the backlog explicitly flags it "GATED-adjacent — build with Brett," not a solo build.
Read `AUTONOMY_GUARDRAILS_v1.0.md` first (defines what `judge()` gates — the Rung-1→Rung-2 autonomy
ladder step) before proposing a design. Don't just start writing code — this one's meant to be a
conversation about the design first.

**🔴 Before touching B-127 again, check `grep -n "routeAI" worker.js`.** It was built and tested last
session (`test/model-routing.test.mjs`, 17/17) but the session ended before a push happened — no
`BRETT_GH_PAT` in that session's env. If `routeAI` is missing from `worker.js` on `main`, it needs
either (a) Brett's PAT pasted so a push can happen, or (b) a rebuild from the description in
`CURRENT.md`'s Aug 22 "B-127 built + tested" entry + `BACKLOG.md`'s B-127 row. **Do not re-build blind
without checking first** — if it's already on `main`, redoing it wastes a session.

**Also confirmed this session (no action needed, just don't re-verify from scratch):** B-140 (staging
Worker) is live and reading its own sheet. B-141 (smoke harness) is done — `scripts/smoke-staging.mjs`,
10/10 passing.

---

## Prior checkpoint: Aug 20, 2026 (part 2) — B-227 Phase 3 built, validated, PUSHED. Live testing is the only remaining step — DO NOT REBUILD.

**If you are reading this at the start of a new session: this work is DONE and PUSHED (commit visible in
`git log` on `main` as the "B-227 Phase 3" commit, `worker.js` has `qbSendCombinedInvoice` and
`qbGroupOpenRows` in it, `BUILD_VERSION` is `2026-08-20.4` or later). Confirm that with a quick
`grep -n "qbSendCombinedInvoice" worker.js` before assuming ANYTHING here still needs building. The
only actual remaining step is Brett's live Preview & Send test (see below) — not more code.**

Phase 1 (below) is pushed — commit `b2c390f`, `2026-08-20.1`, live. Same session, continued straight
into **Phase 3 — the actual combined-invoice gap** since Brett said "let's do the invoice, it's
blocking" after Phase 1 landed.

**Built, tested, ridgeco-validated, and PUSHED (`2026-08-20.4`):** `qbSendInvoice` now combines every
not-yet-invoiced approved `Invoice_Review` row sharing a WO_ID into ONE QuickBooks customer Invoice,
still one QB Bill per distinct vendor. New pure helper `qbGroupOpenRows(irRows, ir)`; new
`qbSendCombinedInvoice` (only reached when the group has >1 row — the ordinary single-vendor job, ~95%
of jobs, falls through to the completely untouched original single-row code, zero behavior change
there). `qbReadyQueue` surfaces `combines_with`; index.html shows a "🔗 Combining N vendor bills"
banner + one bill block per vendor in preview. Full details, including the ridgeco-validate pass that
caught and fixed a real duplicate-Bill-on-retry bug before push: **FEATURE_LOG rule 121 — read this
before touching Phase 3/4 again, do not re-derive it from scratch.**

**Reconciliation note (why the version jumped .2 → .4 and the rule number is 121 not 118):** between
building this and pushing it, an unrelated session (Aug 21, tenant work-order submit toggle, FEATURE_LOG
rules 118-120) pushed to `main` first. Rebased cleanly — the only real collision was the `BUILD_VERSION`
line (trivial, resolved to `.4`) and the FEATURE_LOG rule number (their rule 118 was already taken, so
this work is numbered 121 instead). No code-logic conflicts at all — the two changes touch completely
different regions of `worker.js`. This is exactly the kind of thing to check for on every push from now
on: **before pushing, always `git fetch` + diff against `origin/main` first**, don't assume it hasn't
moved.

**Brett still needs to run a live Preview & Send test before trusting Confirm on a real job** (preview
is read-only, zero writes — the code being live/pushed does NOT mean any QuickBooks write has happened)
— pick a real WO with two open vendor bills, tap Preview & Send on either one, confirm the combined
banner shows both vendors correctly and the total is the sum of both, before ever tapping Confirm on a
real job. This is money-posting code (Rung 3, `AUTONOMY_GUARDRAILS_v1.0.md`) — his own eyes on a live
preview is the gate, not just the validator pass, and not just the code being deployed.

### Next step (when Brett returns / continues, Phase 3)
1. **Check state first** (see the bolded note at the top of this section) — this is likely already done.
2. Get Brett to run the live Preview & Send test above (needs a real WO with 2+ open vendor bills — the
   locksmith job itself, once its bill is entered, is the natural test case).
3. Non-blocking follow-ups flagged by the validator, not yet built: a concurrent-send lock (two sibling
   sends truly simultaneous), and the pre-existing receipt-re-attach-on-retry quirk (not new, just newly
   reachable via the combined path).
4. THEN Brett can actually enter the locksmith's bill via "Enter a bill by hand" (per Q4) without it
   splitting across two QuickBooks invoices.
5. Decide on email-to-invoice (new scope, 117b) — build it, defer it, or drop it. Still open.

## Earlier checkpoint, same day: Aug 20, 2026 (part 1) — B-227 Phase 1 built (schema)

### Where B-227 stands (full context: `context/HYBRID_VENDOR_PAYMENTS_BUILD_BRIEF_v1.0.md`, FEATURE_LOG 117/117b)
Brett answered the brief's 5 open questions this session: **Q1=A** (QuickBooks' existing bank-account
BillPayment is fine, no true-ACH research needed) · **Q2=hand-enter, but also give some hybrid vendors
real portal access + wants scan/email-to-invoice support** (expands past the original A/B — see below)
· **Q3=A** (customer invoice stays generic, no vendor names shown) · **Q4=B — hold: don't enter the
locksmith's bill until Phase 3 (combined invoice) exists**, don't want it split across two QuickBooks
invoices · **Q5=B** (`PAY_AUTH_CODE` still not set, walk-through deferred to a future session).

**Built + tested this session (`2026-08-20.1`, NOT YET PUSHED — awaiting Brett's go):** Phase 1 —
additive `Vendors.Vendor_Type` (labor default/materials_hybrid/materials_store) + `Vendors.Payment_Address`
+ `Vendor_Bills.Payment_Method`, all `ensureColumns`-gated (existing rows untouched), Add/Edit Vendor
forms updated, "Enter a bill by hand" gets a HOW THIS GETS PAID selector that auto-defaults from vendor
type. `node --check` clean, all 5 index.html inline scripts syntax-clean, test suite 28/30 (same 2
pre-existing unrelated failures as Aug 17 — `pricing-model`, `scope-core`). No money-posting code touched.

**Q2 investigation (FEATURE_LOG 117b), so the next session doesn't re-derive it:**
- Portal access for a hybrid vendor — already close to free. Any Vendor with a Phone auto-gets a PIN on
  create; portal login isn't gated by vendor type today. Just needs Brett to decide which vendors get one.
- "Scan to invoice" — **already fully built.** vendor.html already uploads `Invoice_File_URL`/`Invoice_File_ID`
  on a portal bill submission; index.html already renders it as a "view file ↗" link. Confirmed in code,
  not assumed.
- "Email to invoice" — **genuinely new, no ingestion pipeline exists anywhere in this codebase.** Needs
  its own design pass (Cloudflare Email Routing → Worker endpoint → draft Vendor_Bills row for review,
  vs. a third-party inbound-parse service) before any code. Not started.

**Per Q4, Phase 3 (`qbSendInvoice`/`buildInvoiceLines` combining every approved Invoice_Review row
sharing a WO_ID into ONE customer invoice) is now the actual critical-path item** — it's what's really
blocking the locksmith job, not the schema work. This is money-posting code: needs its own focused
trace of `qbSendInvoice`/`buildInvoiceLines` (worker.js ~8532+), full `test-verified-builds` +
`ridgeco-validate` pass, preview-first, and Brett's own supervised first live send before it's trusted.
Do NOT start Phase 3 without re-reading this note and the brief's Section 4 first.

### Next step (when Brett returns / continues)
1. Confirm the Phase 1 diff (summarized in chat) and push — Brett's explicit go required (GATED: schema
   change to a live Vendor/Vendor_Bills tab, per `AUTONOMY_GUARDRAILS_v1.0.md`).
2. Decide on email-to-invoice (new scope, 117b) — build it, defer it, or drop it.
3. Start Phase 3 — the combined-invoice build — as its own focused pass. This is the one that actually
   unblocks entering the locksmith's bill per Q4.

## Earlier checkpoint: Aug 17, 2026 — Review Bills bulk-approve, Sheets quota fix, access-code visibility

### What this session did (DONE + pushed to `Ridge-Co/RidgeCo`, commit `823b2d3`; Worker deploy `2026-08-17.7` pending Cloudflare auto-build off this push)
Three shipped changes from Brett's own three asks this session, FEATURE_LOG rules 98–100:

1. **Rule 98 — Review Bills bulk-approve.** "need to select multiple items for review bills, not one at
   a time then refresh after each one." Added a "☑ Select multiple" toggle + sticky selection bar
   (count + running $ total) + "Approve selected," sending one batch to new
   `POST /invoice-review/approve-bulk` (one read + one batched write of Vendor_Bills/Invoice_Review
   regardless of batch size, cap 50) instead of N single approvals. Extracted the single-card approve's
   validation/pricing math into `invBuildApprovalPayload` so single and bulk share identical money math.
   Approved cards now fade out of the list immediately (both paths) — the direct fix for "doesn't leave
   the queue until I refresh." Bulk deliberately does NOT touch QuickBooks — Send-to-QB stays the
   existing one-at-a-time, preview-first, confirmed step.
2. **Rule 99 — Sheets API quota fix.** Brett hit "Quota exceeded — Read requests per minute per user"
   updating WOs back-to-back; root cause is every screen firing several serial reads while the whole app
   (admin/vendor/tenant/owner/crons) shares ONE service account's 60-reads/minute bucket. Fixed at the
   source: `sheetsRequest` retries 429 (any method) and 5xx (GET only, never POST — avoids a double-
   write) with backoff; `fetchTabs` batches many tabs into one `batchGet`; `getAccessToken` caches its
   hour-long token; new `GET /hub-bootstrap` loads the Hub's 8 core tabs in one call (index.html's
   `loadAll()` uses it, old 8-call path kept as automatic fallback); short in-isolate cache absorbs
   duplicate reads within a burst. Front-end `api()` also got its own 3s GET de-dup cache.
3. **Rule 100 — per-code access visibility + broadened type map.** 828 S Charles St's electronic door
   code wasn't showing on its WO at all — `getWOLockboxes`'s TYPE_MAP only covered legacy Key_Type
   strings (current-vocabulary codes fell through unlabeled) AND the admin widget separately filtered on
   the literal string `'Lockbox'` only. Both fixed: broadened TYPE_MAP, widget now renders every active
   code by type. Added `Keys.Visibility` (blank=Auto / `Brett Only`) with a per-code dropdown in the
   WO-detail widget (`setKeyVisibility`); `enrichWO` filters `Brett Only` codes out of every
   vendor/tenant/owner/shared-link view unconditionally, EXCEPT when the assigned vendor is Brett's own
   in-house record. **Brett still needs to tap the new dropdown himself** to actually mark 828 S Charles
   St's code Brett Only — this session fixed visibility (bug) but can't set that one Sheets row's value
   without Sheets write access from Cowork.

**Verified every step:** `node --check worker.js` clean, both `index.html` inline `<script>` blocks
syntax-clean (Python extraction), full test suite 26/28 (2 new test files —
`access-code-visibility.test.mjs`, `invoice-review-bulk.test.mjs` — both green; `read-layer.test.mjs` and
`invoice-no-bill.test.mjs` updated for the refactor, both green; the 2 failures — `pricing-model`,
`scope-core` — are pre-existing/unrelated, confirmed via `git stash` against unmodified `main`). Grepped
the full diff for cost/markup/margin leakage before push (hard rule) — clean; the only matches are
existing Review Bills admin-only UI text (internal authenticated page), not new leaks. Full manual
`git diff` read-through of both worker.js and index.html completed before commit.

### Open / Brett's to-do (things to physically check/click)
- **Verify rule 98**: on Review Bills, tap "Select multiple," check 2-3 priced bills, tap "Approve
  selected," confirm the total matches, confirm cards clear without a manual refresh.
- **Verify rule 99**: work through several WOs back-to-back like when the quota error hit — should not
  error; if still momentarily busy, should retry/recover instead of showing the red error box.
- **Verify rule 100**: open 828 S Charles St's WO, confirm the electronic code now shows in "ACCESS
  CODES (live)." **Then set it to "Brett Only" via the new dropdown** — this is the one part that needed
  Brett's own tap, not just a bug fix.
- **Rotate the classic GitHub PAT** — pasted into chat again at the start of this session (third+ time
  flagged across sessions now); worth actually doing.

### Carried forward, unchanged, NOT touched this session (from the earlier Aug 17 checkpoint / Aug 13)
- **B-127** (DIY multi-model router) — specced (`MODEL_ROUTING_BUILD_BRIEF_v1.0`), not built. Top-level
  priority for its own focused session per the Aug 13 checkpoint.
- Set Cloudflare secret **`PAY_AUTH_CODE`** before bill-pay works live (rule 80/B-217A is dormant without
  it — returns 503).
- Share the **"PAYABLES Inbox" Drive folder** with `maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com`
  (Editor) — Receipt Reconciler's scan returns 0 results until this is done; 2-minute manual step, no
  tool can grant Drive sharing remotely.
- Set **`receipt_customer_cards`** (Cloudflare secret or Config sheet row) — Jennifer/Goldszmidt Visa
  `7442` was the flagged candidate.
- B-203 corrected finding: `processMoveOut` already clears `Units.Tenant_ID` — BACKLOG.md's description
  of this is stale and hasn't been corrected in the file yet. Real remaining gap: no UI to
  reactivate/transfer an existing tenant record without creating a duplicate.
- B-217 (vendor bill-pay write path) — flagged as needing its own focused build/review; not started.
- Dormant `WO_Tenants` link table (`/wo-tenants`, `/wo-tenant/add`, `/wo-tenant/remove`) — pre-dates
  recent sessions, confirmed dead code (nothing in any frontend calls it, `tenantWorkorders` doesn't
  consult it). Left as-is; flagged so a future session doesn't assume it's load-bearing.
- **🔴 Eddie/Gladden Ave photo access** (from the earlier Aug 17 checkpoint, rule 92) — still needs
  Brett's tap on "Share them all" (Hub → Dev Log → 🖼 Fix photo/video sharing); not code-fixable from
  Cowork.

### Next step (when Brett returns)
No pending build mid-flight. When Brett's back: confirm the 3 verify-items above landed clean (a quick
"how'd it go" is enough — don't re-verify code that's already tested and pushed), then either pick up
**B-127** (its own focused session) or take whatever new ask he brings, classified under the Session
Efficiency Protocol as usual.

## Checkpoint Oct 14 2026 — Owner tenant roster + Amanda Ireland (Phoenix) cutover
**UPDATE (evening): PR #304 MERGED (51d9c89), prod build .22 live, Phoenix cutover DONE (batch RB-20261014-H3FD: properties 89-92 added, 4 old tenants + placeholder moved out, 3 name fixes, 12 new tenants IDs 125-136 with SMS off / consent pending). Open: verify daily flip, /tenant/add no-date refusal, moved-out SMS gate, `attested` flag (BACKLOG B-241); Brett sends consent/welcome texts by hand.**
PR #304 -> main (head `feat/owner-tenant-roster-oct14c`, cut from main 0f5e6fe; main synced in via #302/#306). Staging copy #305 merged; BUILD_VERSION `2026-10-14.22-owner-tenant-roster-slices` verified on staging. The branch had to be re-cut three times (#287 -> #290 -> #304) because main kept moving; the fast fix for a lone BUILD_VERSION conflict was: patch the branch line to main's value, merge main into the branch with a PR (base = branch, head = main), then re-bump. Staging found the ~50-calls-per-request cap, so apply saves in slices and the page resumes. Brief: `context/OWNER_TENANT_ROSTER_BUILD_BRIEF_v1.0.md`; FEATURE_LOG rule 216; BACKLOG B-241. Project doc: `claude/ridgeco-owner-tenant-roster-oct14.md` (Continuous Improvement). Brett (Oct 14): merge, add the 4 properties, run the cutover himself-via-Claude; Jenelle and Jonelle Floyd are sisters (Jenelle is a new tenant at 3805 Harlem Ave, ID 92 untouched).

## Checkpoint Oct 14 2026 — STR cleaning scheduler
Branch `feat/str-cleaning-scheduler` (rebased on main twice; staging is reset to main on every main push, so a staging test can be wiped mid-run). Built and offline-tested. Live-tested on staging except the offer loop. Open decision for Brett: let the staging test token switch `TWILIO_ENABLED` on (an edit to the test guard; blocked in-session as a security widening) so the offer loop can be live-tested, or accept first live check on prod with Twilio test mode ON. Brett's setup list: enter the 3 cleaners (phones, emails) on the board, share the cleaning calendar with the service account (Make changes to events), re-paste the Apps Script JOBS table, then flip switches in brief order.

### Oct 14 2026 (afternoon) — STR scheduler on prod, test-mode PR
- Pages + Worker `.14` live. Cleaners added on prod through the board (Vendors 19-21, Trade "Short-Term Rental Cleaner", Service_Area "Milam Ridge"); Gina's email is the one the Make digest uses; Kayla has no email on file; Rachel is Rachel Twigg. Phones/emails are NOT recorded here (public repo).
- Preview on prod: 10 turnovers, 7 already on the calendar, 3 uncovered, nothing sent.
- Prod `TWILIO_TEST_MODE` is FALSE, so turning on cleaner texts would have texted real cleaners. Built `STR_SMS_TEST_MODE` (PR #285, staging-verified) as the cleaning-only safety. NEXT: Brett's go on the main PR, then turn Scheduler + Texts ON (test mode stays ON), tap the test links, then build the calendar sync on the existing calendar (Apps Script as Brett; Google blocks the service account).

### Oct 14 2026 (2:50 pm ET) — live in test mode, three fixes shipped
- Scheduler + Texts turned ON (test mode ON). No texts at first: the daily self-test (`sweep_checks`) hung every tick and starved `str_cleaning`. Brett switched `sweep_checks` off in the Apps Script JOBS table by hand (the permission system blocks me from editing the live script), I shipped the dispatcher + sliced self-test fix (PRs #295/#298, rule 214) and the canary fixture/trigger fix (#297); Brett switched `sweep_checks` back on and its first slice finished OK.
- First tick made 7 turnovers `ext_covered` (already on the calendar), then offers went to Gina; the tick was being cut off mid-write, so PRs #299/#300/#301 (rule 215) added a per-tick time budget with visible deferral and the "(subject to change with new bookings)" next-guest wording. Prod build `2026-10-14.21-str-next-guest-note`.
- Brett's phone tests passed: Nov 8 accepted -> covered via offer; Nov 11/12 pre-arrival declined -> Kayla asked; Nov 15 still to be offered.
- Open: scopes 4 and 6 (WO-1180/WO-1183) need deposit invoices or an exclusion decision (`sweep_work` fails every tick until then); duplicate STR_Log ID race (cosmetic); calendar sync, Mon/Wed/Fri digest and going live are still ahead. `sweep_checks` self-test should write its first `Selftest_Results` row after its slices finish (check `selftest_progress` Config row).
- Note: `main` now requires the `guard` status check, so context commits go through a PR (branch `context/...`), not a direct `commit_patch` to main.

## Checkpoint - Oct 14 2026 (3:30 pm ET) scheduler: daily/weekly first, scopes 4/6 skipped
- Brett: "skip the scopes four and six ... do the daily, weekly runs first", then "Merge to main". Live on prod: `.23-sched-daily-first` (PR #310) and `.24-sched-no-repick` (PR #311).
- Config `DEPOSIT_SWEEP_SKIP_SCOPES` = `4,6` added on the prod Config sheet (row 43). Remove the row/value to alarm on them again.
- First catch-up (19:03 UTC): daily_digest, daily_receipts, daily_receipts_post, daily_turnover ran OK. `daily_qb_sync` timed out and stayed "running"; found it would be re-picked every call, fixed in #311.
- OPEN: `daily_qb_sync` needs time-slicing to ever finish (see FEATURE_LOG 216). `sms_delivery_check`, `review_wed`, `hub_impr_daily`, `str_digest_wed` had not run yet at 19:30 UTC; check next ticks.
- Cleaning scheduler unchanged: ON, test mode ON, calendar sync not built, Mon/Wed/Fri email OFF.

## Checkpoint - Oct 14 2026 (5:10 pm ET) daily_qb_sync fix live
- Brett: "build the fix", then "merge it". Live on prod: `.25-qb-sync-sliced` (PR #316; staging PR #315). FEATURE_LOG rule 217.
- `daily_qb_sync` had used its 3 tries for Oct 14 before the deploy, so it shows overdue ("started N min ago and never finished") until its first run on the new code, Oct 15 after 07:00 ET. Check `/cron/status`; the job result carries `detail.qb_sync.timings_ms` (payables / write / rows / sweep) and slice number.
- If it ever stays partial: Config row `qb_sync_progress` holds today's progress (delete the row to restart the day). 13th slice in a day = loud failure.
- `hub_impr_daily` went OK at 21:01 UTC (the GitHub 403 was transient). Overdue list now only `daily_qb_sync`.
- Still open: STR_Log duplicate ID race (cosmetic), calendar sync, Mon/Wed/Fri digest, going live (Cleaning test mode OFF - Brett's approval only), first `Selftest_Results` row check.

## Checkpoint - Oct 14 2026 (8:45 pm ET) daily_qb_sync finished
- Brett: "clear the tries, do a run now, and close this out". Cleared `attempts` for daily_qb_sync in Scheduler_State (Config row 36, one cell, verified), the next tick ran it on `.25-qb-sync-sliced`.
- Result: COMPLETE in exactly 12 slices (the daily cap) at 00:31 UTC; 108 stored rows written + verified, 0 failed, 46 WOs auto-closed Invoiced -> Paid (backlog from the job never completing since the cron move; each has a WO audit row), deposit-paid sweep ran. `/cron/status` overdue list is EMPTY.
- Why so slow: about 4 WO closes per slice (each close = paced Sheets reads + write), and the 30 s slice includes the QuickBooks payables read. Tomorrow's run should be 1-2 slices. If a backlog ever returns: raise `QB_SYNC_SLICE_MS` or batch the WO status writes (not built).
- Progress row `qb_sync_progress` (Config row 45) holds Oct 14's finished pass; a new ET day starts fresh automatically.
