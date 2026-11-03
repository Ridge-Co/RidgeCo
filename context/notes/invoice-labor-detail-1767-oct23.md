# Invoice detail: opt-in notes copy + one line per billable visit (Oct 23, 2026)
Build 2026-10-23.05-invoice-visit-lines-use-notes. Branch fix/invoice-labor-detail-oct23. Staging PR #442, main PR #443. (Proposed FEATURE_LOG rule 230; renumber at merge if 229 collides.)

## Trigger
Invoice 1767 (WO-1169, $638.75) went to the owner (Jamuna Yalamanchili) with almost no detail. Brett's hub time entries kept what was done only in private Notes; the invoice builder reads only Invoice_Description.

## Rules (do not break)
1. Notes are NEVER copied to an invoice automatically. Private Notes can hold internal remarks. `laborEntryText()` reads Invoice_Description only.
2. Opt-in copy: admin-only `POST /time-entry/use-notes` ({wo_id, optional ids}) copies Notes into Invoice_Description for billable, active, role=hub entries that have notes and no description. Never overwrites an existing description. Idempotent. Read-back verified (`updateRowVerified`); per-entry failure = 500 + FALSE telemetry; telemetry failure surfaces as a warning. Deliberately NOT in the ROLE_SCOPES vendor allowlist; IS in `_WO_KEYED`.
3. UI: banner "Use notes as invoice descriptions" on WO Time Tracking plus a per-entry button. Nothing copies until tapped. The QuickBooks preview warns when billable entries still have notes but no description.
4. Per-visit lines: `hubVisitLaborLines()` is used by `buildInvoiceLines` only when there is no vendor bill and the hub entries' Billable_Amount sum equals laborAmt to the cent. Otherwise fall back to the single combined labor line, so totals can never change. Each line: trade, date, description, hours x rate (Qty=hours, UnitPrice=rate when hours x rate equals the amount, else Qty 1).
5. Log Time (Hub) blocks billable entries with no Invoice Description.
6. Repair tool (`qbRepairable`/`qbRepairInvoice`) shows the new description; still refuses paid invoices and requires rebuilt lines to equal the total.

## Known limits
Hub entries with no Start_DateTime print no date. Combined-invoice path and addon children do not split. No edit/undo UI yet for the copied wording.

## Tests
test/invoice-wo1169-detail.test.mjs (21). Real WO-1169 figures: lines 170 / 85 / 85 / 106.25, materials 192.50, total 638.75. Suite: 197 files, 248 pass, 0 fail.

## Follow-through for invoice 1767 (Brett, Rung 3)
1. After main deploys: WO-1169 Time Tracking > "Use notes as invoice descriptions" (copies entries 46, 47, 52, 58).
2. Hub > Dev Log > "Fix Invoices Already in QuickBooks" for 1767: preview shows 4 visit lines + 4 materials lines; Confirm (refuses if paid).
3. Resend from QuickBooks, then send the Gmail reply draft to the owner.
