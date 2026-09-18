# WO → Scope Proposal Conversion — Build Brief v1.0
Sep 18, 2026

## What this is

A new **forward** conversion direction: a Work Order's approved vendor `Estimate` can now be
converted (or appended) into a `Scope`, so the job can go through the full e-signed / materials-
markup / multi-milestone Scope Proposal billing path instead of a single-shot WO invoice.

The **reverse** direction, `POST /scope/to-wo` (Scope → WO), already existed before this build
and was left completely untouched.

This is delivered as a branch + pull request into `main`. It was **not** committed directly to
main and has **not** been merged — that is Brett's call. No live call was made against the
deployed Worker or against live Google Sheet / QuickBooks data at any point while building this.

## The new endpoint

```
POST /wo/push-to-scope
Body:  { wo_id, estimate_id, apply?: false }
```

- Admin-only. Zero `ROLE_SCOPES` entries — reachable only via `X-Auth-Token: WORKER_SECRET`.
- `apply` defaults to `false` (preview-first, matching the existing `moveVendorBillToNewWO`
  precedent in this codebase). Call once with `apply:false` to see what would happen; call again
  with `apply:true` to actually do it.
- Calling it twice with `apply:true` on the same already-converted `estimate_id` is a safe no-op
  — it reports the existing Scope rather than converting a second time.

### Response shape (illustrative)

```json
{
  "ok": true,
  "apply": true,
  "wo_id": "WO-1204",
  "estimate_id": "37",
  "scope_id": "S-118",
  "created_new_scope": false,
  "items_added": 4,
  "scope_creator_url": "https://ridge-co.github.io/RidgeCo/scope-creator.html?scope_id=S-118"
}
```

## Rule 1 — Estimate gating

Exactly one `Estimates` row for the given `wo_id` must already be `Status:'Approved'` before
anything happens.

- **0 approved estimates** → clear `400`, no guessing.
- **2+ approved estimates** → clear `400`, no guessing which one is correct. (This matters live:
  WO-1186, 1429 E Federal St, Property_ID 58, vendor Allen George/Vendor_ID 6, has two real
  *pending, unapproved* Estimates — v1 and v2, both $500 — at the time of this build. Neither was
  approved, converted, or touched by this task. Which one is correct is Brett's decision.)

## Rule 2 — Estimate cleanup on conversion

Once converted, the source `Estimates` row's `Status` flips to a new value: `'Converted'`. Two
new fields record the conversion:

- `Estimates.Converted_Scope_ID`
- `Estimates.Converted_Date`

Both are additive (`ensureColumns`-guarded) — no existing `Estimates` data or reads are affected.

## Rule 3 — Reuse the existing Scope link, never duplicate

`woPushToScope` checks `Work_Orders.Scope_ID` first:

- **If already set** — the estimate's line items are mapped (`scopeItemsFromEstimate`) and
  **appended** onto that existing Scope's `Line_Items`. Hand-added items on the Scope are never
  clobbered. Calling the endpoint again is safe (see the no-op behavior above, plus the append —
  not replace — semantics generally).
- **If not set** — a new `Scopes` row is created, with `WO_ID` / `Property_ID` / `Unit_ID` copied
  straight from the Work Order, and `Work_Orders.Scope_ID` is set to point at the new Scope.

## Rule 4 — Deep link

`scope-creator.html` now handles two query params on page load, via a new `handleDeepLink()`
function called from `boot()`:

- `?scope_id=<id>` — opens that Scope directly.
- `?wo_id=<id>` — resolves to that WO's linked Scope (`Work_Orders.Scope_ID`) and opens it.

This is what the new "Open in Scope Creator →" link (see index.html section below) points at.

## Rule 5 — Vendor-pay per milestone

`Payment_Milestones` gains a new boolean column: **`Vendor_Paid_At_This_Milestone`**, defaulting
to `TRUE` — this exactly preserves today's implicit "the vendor always gets paid at every
milestone" behavior for every existing row and every milestone that doesn't opt out.

When a milestone is flagged `FALSE`:
- The vendor is **not** billed for that milestone.
- That milestone's vendor share **rolls forward** onto the next milestone (in bill order) that
  IS flagged `TRUE`. If there is no such later milestone (a trailing run of all-`FALSE`
  milestones with nothing left to roll onto), a deliberate fallback applies rather than an error
  — **flagged below as an open question for Brett to confirm.**

The pure rollover math lives in `scopeVendorPayableSchedule(milestones)` and is covered by
`test/vendor-pay-rollover.test.mjs`:
- all-`TRUE` (regression — matches today's behavior exactly)
- skip the deposit milestone → its share rolls to the final
- two consecutive skips
- skip → paid → skip → paid (non-cascading — a paid milestone doesn't "absorb" a skip two rows
  earlier that already rolled forward)
- a degenerate trailing all-skip run (nothing left to roll onto)
- order-independence
- empty milestone array

## Rule 6 — Calc mode per milestone

`Payment_Milestones` gains two more new columns:

- **`Calc_Mode`** — `'percent'` (default) or `'flat'`.
- **`Flat_Customer_Amount`** — only meaningful when `Calc_Mode` is `'flat'`.

`'percent'` is exactly today's existing behavior, unchanged. `'flat'` means the CUSTOMER-facing
invoiced amount for that milestone is **exactly** `Flat_Customer_Amount`, as typed — no
proration, no rounding surprises. Vendor-side proration (what the vendor is owed for that
milestone) is **completely unaffected** by which calc mode the customer side is using; the two
are independent.

## Rule 7 — WO writeback on every milestone bill

The function that actually fires a milestone bill is `scopeProposalBillMilestones` (`POST
/scope-proposal/bill-milestones`) — this is the real, current, rule-156 milestone-billing
system. (Two other, older scope-billing code paths exist in this file and were **deliberately
left untouched**: the original `proposalBook()` from B-076, and the fixed 2-stage
`scopeProposalBook`/`scopeProposalBookFinal` deposit/final system used for signatures that
predate the milestone system.)

After successfully creating the customer invoice (and the vendor bill, if applicable), it now
also updates the linked `Work_Orders` row (via `Scopes.WO_ID`):

- **`Work_Orders.Customer_Charge`** — incremented/set to the running total billed so far (a new,
  additive `Work_Orders` column).
- **`Work_Orders.Notes`** — one new timestamped line is appended, e.g.:
  `[Sep 18, 3:42 PM] Scope Proposal billed — Deposit — $500.00 invoiced (INV-1042); vendor paid
  $350.00 this round.`

**Final-milestone handling extends, never fights, the existing rule-143 pattern.** The "final"
milestone is whichever bill leaves nothing else pending for that signature — not necessarily the
one labeled `trigger:'completion'`, since Brett can bill milestones out of label order. On that
true final bill, this writeback deliberately does **not** overwrite `Work_Orders.Status` — exactly
mirroring `scopeProposalBookFinal`'s own existing, deliberate choice not to guess/overwrite a more
specific WO status the job may already be in. On an INTERIM bill (something still pending
afterward), the existing pre-this-build behavior is unchanged: `Status` is forced to `'Invoiced'`.

## Rule 8 — Endpoint recap

```
POST /wo/push-to-scope
{ wo_id, estimate_id, apply?: false }
```
Admin-only (zero `ROLE_SCOPES` entries). Preview-first via `apply:false` (default);
`apply:true` performs the conversion atomically-as-possible.

## Rule 9 — index.html

A new button on the WO detail view: **"📋 Push estimate to Scope Proposal"** — visible whenever
the WO is not voided and has at least one `Estimates` row.

- If no `Approved` estimate exists yet, clicking shows a clear message rather than doing nothing.
- If exactly one exists, the flow is: preview → confirm → apply, then an
  **"Open in Scope Creator →"** link appears, using the new `?scope_id=`/`?wo_id=` deep link.

New frontend function: `openPushToScopeUI(woId)`.

## Verification performed

- **Syntax**: `node --check worker.js` clean. All 5 extracted `<script>` blocks in `index.html`
  and the 1 extracted `<script>` block in `scope-creator.html` also pass `node --check` clean.
- **Tests**: two new files, `test/wo-push-to-scope.test.mjs` (38 assertions) and
  `test/vendor-pay-rollover.test.mjs` (32 assertions), plus the full pre-existing suite of 74
  files, all re-fetched fresh from the live repo along with every file-level dependency they
  `fs.readFileSync` directly (`index.html`, `tenant.html`, `signed-proposals.html`,
  `bulk-importer.html`, `submit.html`, `owner-submit.html`, `owner.html`, `vendor.html`) so the
  run reflects the exact shipped logic, not a partial or stale subset.
  **Real result: `node --test test/*.test.mjs` → 83/83 subtests passing, 0 failures.**
- **No live calls.** Nothing in this build called the deployed Worker or touched live Google
  Sheet / QuickBooks data. WO-1186's two pending unapproved estimates were identified and
  deliberately left untouched, per Brett's explicit instruction.
- **Untouched, on purpose**: `/wo/deposit-approve` / `/wo/deposit-clear` (`depositApprove` /
  `depositClear`) — a separate, simpler, Hub-tracked-only vendor-deposit feature. Not read for
  modification, not modified.

## Open questions for Brett

1. **No Payment Schedule editor UI yet for the two new per-milestone fields.**
   `scope-creator.html`'s Payment Schedule editor doesn't yet expose a way to set
   `vendor_paid:false` or `calc_mode:'flat'` per milestone from the UI — both are fully
   functional server-side (via `POST /scope-proposal/save`'s existing milestone-array shape and
   the billing function above), but today can only be set by a direct API call, not clicked into
   existence in the editor. Worth a follow-up UI pass if this is meant to be Brett's own everyday
   tool rather than something built for him ad hoc.
2. **Degenerate trailing-all-skip rollover fallback.** If every remaining milestone from some
   point onward is `Vendor_Paid_At_This_Milestone:false`, there's nothing left to roll a skipped
   vendor share onto. `scopeVendorPayableSchedule` has a deliberate fallback for this rather than
   throwing (covered by its own test case) — worth Brett explicitly confirming that's the
   behavior he wants, since it's an edge case that's easy to construct by mistake (e.g. marking
   the very last milestone `false`) and easy to not notice silently doing the "wrong" thing.

## Files changed

- `worker.js` — `BUILD_VERSION` → `2026-09-18.5` (main had already moved to `2026-09-18.4` from
  concurrent work — selftest + Signed-Proposal vendor-bill fix — by the time this branch was
  built); new `scopeItemsFromEstimate`,
  `scopeVendorPayableSchedule`, `woPushToScope`; extended `scopeValidatePaymentSchedule`,
  `scopeComputeMilestoneAmounts`, `PAYMENT_MILESTONES_HEADERS`, `scopeProposalSign`,
  `scopeProposalBillMilestones`; new route `POST /wo/push-to-scope`.
- `index.html` — new `pushToScopeBlock` inside `renderHubEstimateView`; new
  `openPushToScopeUI(woId)`.
- `scope-creator.html` — new `handleDeepLink()`, called from `boot()`.
- `test/wo-push-to-scope.test.mjs` — new.
- `test/vendor-pay-rollover.test.mjs` — new.
- `context/FEATURE_LOG.md` — new rule 194.
- `context/CURRENT.md` — new top "WHERE THINGS STAND" entry.
