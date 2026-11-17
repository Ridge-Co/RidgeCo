# Receipt Reconciler accuracy build: brief v1.0 (Nov 17 2026)

**Status:** DESIGN COMPLETE, all questions answered by Brett Nov 17 2026. Nothing built yet.
**Start with:** `resume ridgeco receipt accuracy`. Load context light, read this file, then the code areas named below.
**GATED (Rung 3 adjacent):** receipts flow to QuickBooks. Build on a feature branch, staging test, `ridgeco-validate`, Brett merges ("merge N"). Rules auto-confirm is reversible only until the QB receipts sweep sends it.
**Branch:** `feature/receipt-recon-accuracy` (this brief is its first commit).
**Do not hardcode card numbers or any card last-4 in the repo (public).** Cards live in Config via the new Cards panel.

## 1. What Brett reported (Nov 17 2026, 2:17pm)
1. Property not found well from the receipt.
2. Does not check whether a Home Depot / Lowe's purchase was on a customer card or his own card.
3. Misses obvious duplicates (screenshot: two Home Depot $43.23 rows dated 2026-09-24, one dropped in Drive manually, one via email scan; the page said "Checked: no matching entries").
4. 928 N Calvert St: no units shown, and the address is listed twice.
5. Alex Busey invoices come in as receipts.
6. $34.95 Home Depot, 10/02/2026, 928 N Calvert St: no open work orders found.
7. Refund-to-purchase matching is weak (Brett: may not be reasonable to fix).
8. Units not offered when the system suggests BMore business expense.
9. Cannot apply a receipt to a property once BMore business expense is suggested.
10. Wants an ALWAYS selector (e.g. Google LLC workspace subscription = always business expense).

## 2. Root causes (verified against live code and live prod data, read-only)
- **Duplicate property (items 1, 4, 6, 8):** prod Properties has ID 2 `928 N Calvert St` (Active=FALSE, Unit_Count 8, ZERO units, ZERO work orders) and ID 11 `928 N Calvert St` (Active, 8 units 27-34, 16 WOs). `matchReceiptProperty` (worker.js ~3490) uses `sc > bestScore` so the first property wins ties: ID 2. Receipts land on the empty inactive twin, so no units, no WOs. The $34.95 on 10/02 almost certainly belongs to WO-1220 (In Progress, Apt 2R id 32, opened 2026-09-23). Brett confirmed: 1220 yes. The property picker also lists inactive properties, so 928 N Calvert shows twice.
- **Property match input (item 1):** only the PO / handwritten line is compared to street addresses. No unit suggestion at all. No ranked guesses on failure. A bare number in a PO is never tried as a work order id.
- **Card check (item 2):** only `receiptCustomerCards` (Config `receipt_customer_cards` / env `RECEIPT_CUSTOMER_CARDS`). There is no list of Brett's own cards, and no "unknown card" or "card not read" state.
- **Duplicates (item 3):** `receiptReconFindRescanMatches` needs exact amount + exact date + exact normalized store, and SKIPS rows whose status is `pending`. `receiptReconScan` fetches `existing` once before its loop, so rows added earlier in the same scan are never compared. `receiptCheckDuplicatesOne` (the Check duplicates button) checks Receipts, QB bills/expenses/invoice lines, but never other Receipt_Recon_Queue rows. The vendor's own receipt/invoice number is not used.
- **Vendor invoices (item 5):** nothing classifies a vendor's own invoice as not-a-receipt.
- **Business expense card (items 8, 9):** `rowCard` in receipt-reconciler.html renders only property (optional) + amount/store/date/description + Confirm-as-business for category `company`. No unit, no WO, no way back to billable. `receiptSuggestCore` returns `company` before resolving any property.
- **No rules (item 10).**

## 3. Decisions (Brett, Nov 17 2026)
| # | Decision |
|---|---|
| Q1 cards | Mine: Home Depot ends 1661 (treated as his own card, confirm if wrong), Lowe's 7508, rental debit 2326, Cap One 0930, Amex 1004, Chase Ink 4157, Elan 2317. Customer: Goldszmidt 7442. More of his cards to be added later through the UI. Unknown last-4 = warn, never guess. Customer card stays non-billable. |
| Q2 duplicates | Flag only, never auto-skip. Same amount, date within 3 days, fuzzy store, OR same vendor receipt/invoice number + amount. Compare against Receipts AND every queue row (pending too, and rows from the same scan). The screenshot pair is the first acceptance fixture. |
| Q3 vendor invoices | Yes. Alex Busey and K&C Cleaning (Kayla) invoices must not be receipts. They belong in Who To Pay. NOTE: the Vendor Invoice Inbox that would capture Kayla's emailed Square invoices is DESIGN ONLY (`VENDOR_INVOICE_INBOX_BUILD_BRIEF_v1.0.md`), NOT built. This build only keeps vendor invoices OUT of the receipt queue; routing them into Who To Pay is the Invoice Inbox build. One active K&C invoice is sitting in Brett's email now (1864 Kerns School Rd, direct to him). |
| Q4 | BMore business expense stays a suggestion; the card must always let him change it (property, unit, WO). He confirmed WO-1220 for the $34.95. |
| Q5 | Rules can be "always business expense" OR "always this property" (e.g. Apple Valley Waste at 1864 Kerns School Rd). |
| Q6 | Rules auto-confirm with no tap, plus an "Auto-handled" list with Undo. Rule never auto-applies on a customer card, refund, duplicate flag, amount outside the rule's range, or receipt before the cutoff. |
| Q7 | Read PO text AND work order numbers. "po 1220" may be WO-1220 or 1220 Anywhere St: flag ambiguity, show both, never silently pick. |
| Q8 | Matcher and pickers ignore inactive properties. Do NOT edit/delete the ID 2 row (Brett's data). |
| Q9 | WO list also shows closed WOs within **30 days** of the receipt date, tagged closed. |
| Q10 | Leave refund-to-purchase matching as is. |

## 4. Spec

### 4a. Property, unit, work-order resolution (worker.js, PURE, unit-testable)
- `matchReceiptProperty` keeps its return shape `{property, score}` but: skip `Active==='FALSE'`; on a score tie prefer the property that has units and/or work orders (pass optional `units`/`workorders`), then lowest ID. Add `matchReceiptCandidates(texts, properties, units, workorders)` returning top 3 `{property, score}`.
- Feed it ALL receipt text, not only the PO: `po_reference`, `handwritten_note`, and two new extract keys `ship_to_address` and `job_name` (add to the `receiptExtract` prompt, ~line 26099, and carry through `receiptReconScan`). Keep the old `po` behavior as the highest-weight text.
- Unit hint: parse `apt|unit|#` + token (`3R`, `2F`, `Bsmt`, `Carriage House`) and bare tokens after the street address, normalize against `units` at the matched property (Unit_Label). Return `suggestion.unit = {id,label,source}` or null.
- WO reference parse: explicit (`WO-1220`, `WO 1220`, `work order 1220`) beats address. Bare 4-digit tokens 1000-9999 matching an existing Work_Orders ID get `wo_ref.confidence='ambiguous'` when the same number also is the house number of any active property; list both candidates. Disambiguate by hint only: WO open window contains the receipt date, then item-keyword score. Never auto-resolve an ambiguous one; set flag `po_ambiguous`.
- Always compute `suggestion.property_hint` (property + unit + WO candidates) BEFORE the company / customer-card early returns, so a BMore-flagged receipt still carries candidates for the UI.
- `rankReceiptWOs`: also return closed WOs (status not in ACTIVE) whose Completed_Date is within 30 days before the receipt date, tagged `closed_recent:true`, ranked below open ones. Invoiced/Paid keep the existing `wo_already_invoiced` flag.

### 4b. Cards
- Config keys: `receipt_my_cards` (comma last-4s), `receipt_customer_cards` (existing), `receipt_card_labels` (JSON `{last4:label}`).
- `receiptSuggestCore` gains `myCards`. `suggestion.card_status` = `mine | customer | unknown | not_read`. customer => category `customer_paid` as today (excluded) but add an "Attach image only" action. unknown => flag `card_unknown`; not_read => flag `card_not_read`. A customer-card receipt whose PO says bmore => flag `card_conflict`.
- Endpoints: `GET /receipt-recon/cards`, `POST /receipt-recon/cards` `{last4, owner:'mine'|'customer'|'remove', label}`. Validate last4 is exactly 4 digits. Store only last 4.
- UI: small "Cards" panel on the Reconciler page; an unknown-card warning on the row with one-tap "This is my card" / "Customer's card".
- Seeding: after deploy, enter the Brett cards through the new panel (or one authenticated POST). They are NOT committed to the repo.

### 4c. Duplicates
- New pure `receiptDupSignals(candidate, pool)` (amount to the cent; date within +/-3 days; `_rcNorm` store after stripping `the|inc|llc|store #|number` noise; OR equal non-empty vendor invoice/receipt number + amount). Pool = Receipts + ALL Receipt_Recon_Queue rows except itself (any status, including pending).
- Use it in: `receiptReconFindRescanMatches` (drop the `pending` skip, relax exact date to +/-3 with distinct reason text), `receiptReconScan` (push each new row into the local `existing` array so same-scan twins are seen), `receiptCheckDuplicatesOne` (new signal `other_queue_row`), and the queue list handler so the page can show a banner "Possible duplicate of #N" on both twins with a one-tap Mark duplicate. Flag only.

### 4d. Vendor invoices out of the receipt queue
- Config `receipt_vendor_invoice_names` (editable list, normalized contains-match against the extracted vendor, seeded with alex busey, k&c cleaning, kayla, regina saville). Match => category `vendor_invoice`, action `exclude`, row written with Status `skipped` and Notes "Vendor invoice: belongs in Who To Pay, not receipts", restorable with the existing Move back to Pending. Never touches Vendor_Bills.
- UI pill + a link to Who To Pay.

### 4e. Rules ("Always")
- New tab `Receipt_Rules` via `ensureTab` on a NEW tab only (then `ensureColumns` for any later addition): `ID, Match_Vendor, Min_Amount, Max_Amount, Action (business|property), Property_ID, Unit_ID, Description, Auto, Active, Created_Date, Hits, Last_Hit_Date`.
- Endpoints: `GET /receipt-recon/rules`, `POST /receipt-recon/rules` (add/update), `POST /receipt-recon/rules/deactivate`. No hard delete.
- Apply in `receiptReconScan` after the suggestion: first matching active rule wins. If `Auto=TRUE` and none of the Q6 guards trip, call the existing confirm path for no-WO expense (reuse `receiptReconConfirm` internals with `no_wo:true`; business => category `company`, property => property_id), Status `confirmed`, Notes start with `🤖 Auto-handled by rule #N`. Otherwise just pre-select it on the card.
- UI: checkbox on the card "Always do this for <vendor>" with Business expense / This property; a Rules list on the page (edit, deactivate); an "Auto-handled" list (last 14 days) with Undo using the existing `receiptReconUndo`.
- A rule must never read card numbers or amounts beyond Min/Max.

### 4f. Business-expense card (receipt-reconciler.html)
- For category `company` pending rows, render property / unit / WO pickers (populated from `property_hint`) plus a "Bill this to a customer instead" toggle that switches the card to the normal billable layout (override stored client-side per row id, re-render in place; no full reload). Business expense remains the default suggestion.
- WO select: add optgroup "Closed in the last 30 days" (client has all WOs in `allWOs`).
- Property picker: hide `Active==='FALSE'`.
- Follow DESIGN.md and the `ridgeco-ui-review` skill (412 and 1366 screenshots, `node scripts/ui-check.mjs receipt-reconciler.html`).

## 5. Acceptance tests (write FIRST, new files under test/, extract-from-worker.js style like `receipt-suggest-core.test.mjs`)
1. Properties `[ID2 inactive 928 N Calvert St, ID11 active 928 N Calvert St with units]`, PO `928 n calvert apt 2R`: resolves to ID 11 and unit 30 (Apt 2R). Inactive never returned.
2. Receipt $34.95 / 2026-10-02 / PO `1220`: candidates include WO-1220 (open at that date) AND any property with house number 1220, `po_ambiguous` set, nothing auto-picked. PO `WO-1220`: explicit, property 11, unit 32.
3. Unit parsing: `Apt 3R`, `#2F`, `unit B`, `Carriage House`, `bsmt` against 928 N Calvert and 807 N Calvert units.
4. Cards: mine/customer/unknown/not_read; customer card + `bmore` PO => `card_conflict`; customer card => still excluded; last4 validation rejects 5 digits and letters.
5. Duplicates: the screenshot pair (Home Depot, 43.23, 2026-09-24, both pending, items formatted differently) flag each other; same-scan twin flagged; +/-3 days flagged, +4 not; different amount not; same invoice number + amount flagged; fuzzy store `The Home Depot #1234` vs `Home Depot`.
6. Vendor invoice name list: `Alex Busey`, `K&C Cleaning` => `vendor_invoice` skipped with note; `Home Depot` unaffected; Config list editable.
7. Rules: Google LLC always-business auto-confirms; same rule does NOT auto-confirm on a customer card, a refund, a duplicate flag, an amount outside range, or pre-cutoff; Apple Valley Waste always-property posts expense to the property with no WO; Undo works; deactivated rule never applies.
8. 30-day closed-WO window: closed 29 days before shows, 31 does not, Invoiced/Paid keep `wo_already_invoiced`.
9. Regression: existing `receipt-*.test.mjs` all still pass; `node --check` worker.js and every inline script in receipt-reconciler.html.
10. Staging (Playwright, mocked Worker routes like `manual-verify-receipt-inplace-ui.mjs`, 412 and 1366): business card shows pickers and toggle works in place; Cards panel add/remove; Rules panel; duplicate banner on both twins; no horizontal overflow.
11. Live read-only check (prod, `hub_prod_get`): run the new property matcher over the real Properties/Units/Work_Orders for the 928 N Calvert case. Add every new `/receipt-recon/*` path to BOTH allow-lists in the same PR (worker.js `HUB_TEST_*` lists and gh-broker `src/index.ts`) or `hub_test_post` 403s.

## 6. Guardrails
- Never edit or delete Properties row ID 2 or any Brett data. No QuickBooks writes except through the existing receipt-to-QB path.
- Flags inform; they never skip, delete or bill on their own, EXCEPT rules with `Auto=TRUE` (Brett's explicit Q6 yes) and the vendor-invoice auto-skip (restorable).
- No Cloudflare cron. Use `ensureColumns` before writing new columns. New Config keys via the existing `setConfigKey`.
- Bump `BUILD_VERSION`; add one note file `context/notes/20261117-receipt-recon-accuracy.md` (do NOT edit CURRENT.md or FEATURE_LOG.md).
- Never ask Brett for a pasted secret. Money-adjacent: Brett merges.

## 7. After merge (Brett-visible)
1. Add the 8 cards in the Cards panel (or Claude does it in his signed-in Chrome with his go-ahead).
2. Re-run Check duplicates on the pending queue; mark the $43.23 twin.
3. Create the Google LLC (always business) and Apple Valley Waste (always 1864 Kerns School Rd) rules.
4. Next build: Vendor Invoice Inbox (Kayla/K&C and Alex invoices into Who To Pay).
