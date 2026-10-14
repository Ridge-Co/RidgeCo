# VENDOR INSTANT-PAY FEE: PAD + DEDUCTION — BUILD BRIEF v1.0

Date: Oct 14, 2026. Status: DESIGN LOCKED by Brett (every question answered). Not built.
Money-adjacent (QuickBooks bills, vendor payments, customer pricing) -> ships as a PR for Brett's own merge, never auto-merged (AUTONOMY_GUARDRAILS rung 3; PAT-033). QuickBooks writes on existing bills are preview-then-confirm, never autonomous.

## 1. What Brett wants, in his words

Cesar Diaz (vendor 3, QBO vendor 77) always wants instant payment. QuickBooks charges Brett for that. Brett does not want to eat the fee, and does not want Cesar to eat it either. So: the fee is padded into the job price up front (so the customer pays it through the normal markup), the vendor bill carries the pad as a positive line AND the same amount as a negative "deduction" line, so Cesar nets exactly what he quoted and Brett is made whole. Brett then sends only the net amount, so QuickBooks' fee is charged on that amount.

Examples from Brett: a $500 job becomes a $510 bill with a $10 deduction, and Brett pays $500. A $1,250 estimate becomes $1,262.50 with a $12.50 deduction, and Brett pays $1,250.00.

## 2. Fee schedule (store in Config, never hard-code)

QuickBooks Bill Pay "Instant Payments": 1% of the payment amount, $10 minimum, $100 maximum. Same on Basic/Premium/Elite per Intuit's published pricing (checked Oct 14, 2026). Config keys: `instant_fee_rate` (0.01), `instant_fee_min` (10), `instant_fee_max` (100). A rate change must need a Config edit only, not a deploy.

Next-day ("Faster ACH", about $10 flat, one Intuit page shows $8.50): NOT built. See section 9.

## 3. The two formulas (verified by running them, Oct 14)

All amounts rounded half-up to cents, then clamped to [min, max].

PADDED jobs (new estimates/bills, the normal case from now on):
- `pad = clamp(round(net * rate), min, max)` where `net` = what the vendor quoted/nets for THAT payment
- vendor bill = net + pad; deduction = pad; Brett sends `net`
- QuickBooks' fee is then rate x net, so it equals the pad exactly (0 variance in all tested values)

LEGACY / unpadded bills (already priced to the customer; no pad is possible):
- `deduction = clamp(round(bill / (1 + rate)), min, max)` (the 101 divisor at 1%); Brett sends `bill - deduction`
- Tested sweep $10-$20,000: worst gap vs QuickBooks' real fee = $0.01

Verified table (net -> pad / bill / send):
- 100 -> 10.00 / 110.00 / 100.00
- 500 -> 10.00 / 510.00 / 500.00
- 1,000 -> 10.00 / 1,010.00 / 1,000.00
- 1,010 -> 10.10 / 1,020.10 / 1,010.00
- 1,250 -> 12.50 / 1,262.50 / 1,250.00
- 5,000 -> 50.00 / 5,050.00 / 5,000.00
- 10,000 -> 100.00 / 10,100.00 / 10,000.00
- 12,000 -> 100.00 / 12,100.00 / 12,000.00 (cap)

Legacy table (bill -> deduction / send): 150 -> 10.00 / 140.00; 400 -> 10.00 / 390.00; 750 -> 10.00 / 740.00; 1,160 -> 11.49 / 1,148.51; 1,250 -> 12.38 / 1,237.62; 12,000 -> 100.00 / 11,900.00.

These go in as unit tests on one pure function each (`instantFeePad`, `instantFeeLegacyDeduction`).

## 4. Where the pad applies

- Applies only when the vendor's `Instant_Pay` default is TRUE (Cesar's record defaults to TRUE) and the Review Bills toggle is on.
- Regular WO with an estimate: one payment, one pad, added to the estimate before markup. The customer price rises by pad x markup and shows NO separate line.
- Scope / milestone jobs (deposit + final): each payment event gets its own pad on its own net, minimum $10 each. A $1,250 job split 50/50 pads $10 + $10 = $20, not $12.50. Brett knows and accepts this. Use the real payment schedule (Payment_Milestones / Scope_Signatures vendor-pay flags), not an assumed 50/50.
- Jobs with no estimate: the pad is added when the bill is entered (a $500 charge becomes $510 before markup, with a $10 deduction).
- Cesar's view: his estimate and bill show his amount plus a fee-recovery line (+pad), then a deduction line (-pad), netting to his quoted amount.
- Line wording (EN): "Instant/next-day payment processing fee recovery". ES for Cesar: "Recuperación de cargo por procesamiento de pago instantáneo/al día siguiente" (Brett may edit).
- The customer never sees any of these lines. The pad is folded into the vendor cost before markup (check `calcTieredEstimate`, `buildInvoiceLines`, `scopeItemsPricing`; confirm no interaction with the Sep 23 receipt-job 5% fold-into-labor rule).

## 5. Review Bills toggle

- Per bill, default from the vendor record. If Brett switches instant OFF at Review Bills, the Hub removes BOTH the pad line and the deduction line from the vendor bill (otherwise Cesar would pocket the pad). The customer-side pad stays; Brett keeps it. Surface that plainly in the preview before he confirms.
- Show Brett the exact amount to send ("Send $1,250.00 instant") on the Who To Pay card and in the send-to-QuickBooks preview. This is the number he has been unable to compute.

## 6. Vendor bill lines in QuickBooks

At approve + send-to-QB the Hub builds the vendor Bill with: work line(s) incl. pad line, then a negative deduction line. Bill total = net. Reuse the negative-line mechanism designed for back-charges (context: Oct 11 back-charge brief, `vendor-backcharge-on-bills`): build ONE "bill modifier" mechanism with types `backcharge` (typed in) and `instant_fee` (calculated), so they do not conflict and both can appear on one bill. Never silently reduce the total; the negative line is visible to the vendor.

## 7. Fee variance (silent, one-directional, no threshold)

- After a payment, compare QuickBooks' actual fee to the deduction taken.
- If the deduction was MORE than the actual fee (Cesar overpaid): record the difference in a per-vendor `Instant_Fee_Credit` ledger. On Cesar's NEXT bill, reduce the deduction by exactly that credit (never below $0; leftover carries). No $5 threshold (Brett: "that's a human trick we don't need here"). Mark the line description so Cesar can see it ("includes $x credit from prior payment").
- If QuickBooks charged MORE than the deduction (Brett absorbs): ignore it, let it go. Do not track.
- Apply a credit only AFTER the new QB bill id comes back (same pattern as the vendor loan ledger), so a failed send retried can never double-credit.
- Combined payments (several bills in one payment) are not special-cased: per-bill $10 minimums add up to more than one combined fee, and this variance credit returns the difference on the next bill.
- OPEN TECHNICAL ITEM (not verified): where the actual fee comes from. The Accounting API's BillPayment object likely does not expose it. First check whether the fee shows as a bank-feed/Purchase/Expense line queryable via `/qb/...`; if no source exists, fall back to comparing the deduction against the schedule formula and log "actual fee unverifiable". This must never fail silently: log to Ops_Telemetry and surface on Who To Pay.

## 8. Existing open Cesar bills (backfill)

Bills priced before this feature cannot be padded; they get the LEGACY deduction only, as preview-then-confirm, one at a time, Brett clicks Confirm on each: 7925 / WO-1205 ($1,250 -> -$12.38, send $1,237.62; Brett is doing this one by hand today), 7923 / WO-1202 ($750), 7927 / WO-1045 ($400), 7948 ($1,160), 7950 / WO-1236 ($150). Bills 7925's customer total was already set at $1,695 on Oct 5. Do not touch paid bills.

## 9. Parked / future (flag, do not build)

Brett pays next-day when instant is unavailable, which depends on time of day. The build assumes instant. Leave a clearly named TODO + Config hook (`vendor_fee_mode`: instant | next_day) so this can change if he ever stops paying instantly or pays next-day. Per-estimate override from the Sep 18 expedited-pay design is not required by today's decisions.

## 10. Standing rules this build must meet

- Nothing fails silently (Oct 1 standing rule): every catch logs to Ops_Telemetry and surfaces to Brett.
- No cron anywhere. Nothing here needs a clock.
- Never ask Brett for a pasted token to test; use hub_test_* on staging with TEST- rows.
- Quality control at design time: unit tests for both formulas and clamp edges ($10 floor below $1,010, $100 cap at/above $10,000), rounding, pad + deduction net to zero, toggle-off removes both, credit applied once, failed QB send applies no credit.
- Update FEATURE_LOG (new numbered rule), CURRENT.md, BACKLOG.md; staging test-only PR per BRANCH_POLICY; feature PR targets `main`.
- Acceptance check on staging: a TEST vendor bill of $500 shows lines +10 / -10, total $500; a $1,250 shows 12.50; toggle off shows neither.

## 11. Source facts

Pricing: Intuit Bill Pay page (quickbooks.intuit.com/accountants/products-solutions/bill-pay/) and Firm of the Future's Faster ACH/Instant explainer, both checked Oct 14, 2026: Instant = 1% of payment, $10 min, $100 max. Brett should still glance at the fee QuickBooks shows on his first real payment.
