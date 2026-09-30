# Vendor "Additional Work" Proposals — Build Brief v1.0 (Sep 30, 2026)

Status: DESIGN LOCKED with Brett's answers (Sep 30). Not yet built. Branch: `feat/vendor-additional-work` (cut from `main`; PR target is `main`, per BRANCH_POLICY).

## 1. The ask (Brett, Sep 30)
While on a NON-estimate work order (a job to be done, e.g. clearing a disposal), a vendor often finds other problems (a leak under the cabinet) or the tenant mentions something. The vendor needs to propose that extra work quickly: a list of items, each with a description and its own photos, plus a quick amount. It must arrive as a regular estimate, kept SEPARATE from the original job's estimate section. Brett then either quick-approves (go ahead now) or sends it through the normal proposal system, or just informs the owner of a problem they did not know about. If the parent WO is itself a request-for-estimate, extra items simply go into that existing estimate (no add-on flow).

## 2. Decisions (Brett's answers)
1. One decision per submission for now. Keep the data shape item-based so per-item approval can be added later.
2. An approved add-on rolls into the PARENT job's customer invoice.
3. Quick approve = go ahead now; vendor gets the standard approval text. The vendor MUST include an amount so Brett knows what he is approving.
4. A third admin action: notify the owner of the problem (information only, with photos, no price).
5. Available to EVERY vendor (no per-vendor flag).
6. Lump-sum amount per submission for now (not per-item pricing).
7. At least one photo required per item.
8. Available on any open job (not only on-site/in-progress).

Defaults assumed by this brief (not yet confirmed by Brett; flag in PR):
- D1. The vendor invoices the add-on on the child job like any job; the CUSTOMER invoice is combined with the parent's via the existing combined-invoice path.
- D2. Owner info-only notice is previewed and sent on Brett's tap (never automatic), through the gated SMS chokepoint plus email with a photo link.
- D3. A declined add-on is never shown to the owner.

## 3. Data model
- New column `Parent_WO_ID` on `Work_Orders` (ensureColumns). An add-on = a CHILD work order: `Type = 'addon'`, `Parent_WO_ID = <parent id>`, assigned to the submitting vendor, carrying one normal `Estimates` row (Status Pending).
- Items are stored in the child's estimate `Line_Items` JSON as one entry per item `{desc, desc_en, photo_count?}` with the lump sum on the first line OR as a single `amount` on a summary line (implement so `Subtotal` = the lump sum and items remain individually readable; decide during build, keep `addEstimateVersion` validation happy: it needs `line_items[{desc, amount}]`).
- Photos: upload against the CHILD wo_id (natural separation). Add `Addon_Item` column to `Attachments` (ensureColumns) and pass it through `logAttachment`'s fixed row object. Use `file_type` 'before' or 'photo' (shared, customer-safe; NOT receipt/bill/invoice).
- Child WO must not leak notifications: create with `tenant_notify_created:false`, `tenant_visible:false`, `owner_notify_override:'off'`.

## 4. Gotchas found in code review (must handle)
- `createWorkOrder` builds the row from a FIXED object map: any column not named is silently blank. Add `Parent_WO_ID: body.parent_wo_id||''` (near `Created_By_Vendor`/`Recurring_Template_ID`, ~line 6126) AND call ensureColumns first. Same trap in `logAttachment` for `Addon_Item`.
- `POST /estimate` has NO per-WO vendor authorization (a vendor token could post to any wo_id). The new endpoint must check `WO.Vendor_ID === session vendor`.
- New route needs: a `ROLE_SCOPES.vendor` entry (~16946), the staging/test allow-lists (`HUB_TEST_READ_PATHS`/`HUB_TEST_WRITE_PATHS` + `hubTestWriteAllowed`) and the matching gh-broker allow-list, per test-verified-builds Step 0a.
- WO ID generation is race-prone (max+1). Reuse `claimWOSignature` / `findRecentDuplicate`; include `Type 'addon'` and the parent id in the signature so it cannot collide with the parent.
- `approveEstimate` only sets `Approval_Stage` and texts the vendor; it does NOT change WO Status. The child needs a status convention: create as assigned (like `workorderSelfServe` + `assignVendor(..., notify:false)`), Status `New`; vendor portal shows it as a normal job after approval.
- `/vendor-workorders` may hide or mis-serialize child WOs: verify the approved child appears in the vendor's portal, and that a pending child shows as "awaiting approval", not as workable.
- Invoice rollup (riskiest part): `qbGroupOpenRows` groups Active, un-invoiced Invoice_Review rows with the SAME WO_ID. Extend it to also include rows whose WO has `Parent_WO_ID === ir.WO_ID`. `qbSendCombinedInvoice` uses one `wo` (parent) for trade/description and labels lines with each row's own WO_ID: relabel child lines as "Additional work — WO <parent>". Check the `already`/voided paths in `qbSendInvoice` and the Invoice Review card (`renderIRCard`). Money-adjacent: stays a staged PR for Brett's own merge (AUTONOMY_GUARDRAILS).
- Do NOT put new admin UI inside the `addBtn` block in `openWODetail` (PR #63 territory). Inject a separate "Additional work" section via the `setTimeout` loader list, like `vtrSection`/`loadHubEstimateView`.
- Vendor-portal i18n: add `data-i18n` + `ES` dictionary entries for new labels; wrap dynamic strings in `t()`. Vendor SMS is auto-translated server-side; item text is stored with `desc_en` via `estimateEnglishFields`.

## 5. Flows
Vendor (vendor.html): on an open job card, below the ESTIMATE block, button "Found something else?" (hidden on WOs whose Type is `estimate`; for those, route to the existing estimate editor). Modal (copy `openOneOffJobModal` pattern): items (description + required photos each, add/remove item), one lump-sum amount (required, > 0), optional "tenant mentioned it" toggle, submit with `claimSubmit` double-tap guard. Submit → `POST /wo/additional-work` → creates child WO, assigns vendor, adds estimate v1, uploads photos against child, SMS to Brett via existing `admin_estimate_new` template (Kind = "Additional work"). Vendor can edit/withdraw until Brett acts (Needs Info/Decline banners reuse the estimate widget on the child).

Admin (index.html): parent WO detail shows an "Additional work" section (badge with count of pending) listing children: photos, description, amount, tenant-mentioned flag, status, with buttons:
- Approve (go ahead now) → `POST /estimate/approve {wo_id: child}` (vendor text, no dollar amounts).
- Approve & send to proposal → `/wo/push-to-scope` with `approve_first:true` on the child.
- Notify owner (information only) → preview, then gated SMS + email with photo link, no price.
- Needs Info / Decline → existing endpoints keyed on the child wo_id.
The child opened directly in `openWODetail` also gets the standard estimate panel automatically.

## 6. Out of scope (v1)
Per-item pricing/approval (shape allows it later), materials/receipt lines on the estimate, a vendor-facing customer proposal, automatic owner notice.

## 7. Test plan (test-verified-builds; adversarial `ridgeco-validate` before push)
- Unit/structural: new `test/vendor-additional-work.test.mjs` (validation: amount > 0, ≥1 photo per item, vendor owns parent, parent not `estimate` type, parent open; Parent_WO_ID actually persisted; Addon_Item persisted; child notification flags all off; signature collision).
- Staging via `hub_test_*` against TEST- fixtures: submit add-on → child exists with estimate v1 Pending → approve → vendor text queued → combined invoice preview includes parent + child lines with correct labels and total → decline path hides from owner → owner-notice preview contains photo link and no price.
- Playwright at 390px: vendor modal, required-photo enforcement, admin section, Spanish vendor.
- Regression: combined-invoice, invoice-review-bulk, pending-info, wo-combine/split, estimate tests.

## 8. Ship status
Design only. Build goes to branch `feat/vendor-additional-work`, PR to `main`, NOT merged by Claude (money-adjacent invoice change).
