# SESSION_STATE — checkpoint hand-off

**Read this on any `resume ridgeco` (light load first, then this file, then continue from "Next step").**

## Last checkpoint: Aug 20, 2026 (part 2) — B-227 Phase 3 built, validated, PUSHED. Live testing is the only remaining step — DO NOT REBUILD.

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
