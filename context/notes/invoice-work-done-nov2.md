# Invoices say what work was done (Nov 2 2026)

Trigger: QuickBooks invoice 1774 (WO-1253, Final milestone, $830) showed no work description, and the WO description held access codes that leaked onto the invoice.

Brett's decisions (Nov 2 20:48 ET):
1. Checklist items with a vendor reason code (na / separate / estimate / access / parts) are LEFT OFF the invoice and flagged in the send preview. Never claim resolved falsely.
2. Deposit / interim milestone invoices stay as they are; only the FINAL lists the work done.
3. Access-code-looking text never goes on a customer line (safeguard on top of Brett fixing WO-1253's data).
4. Repair: any recent invoice, including scope-proposal invoices. Preview, then Brett confirms the QuickBooks write.
5. Vendors must tick every checklist item (or give a reason code) before marking Complete OR submitting an invoice. Error shown in their language (en/es). Enforced server-side too.
6. Hub-only "Mark all resolved" button; vendors do not get it.
7. Wording is past tense ("Reattached siding using adhesive"); "- resolved" is the fallback.

Where it lives (worker.js):
- Helpers before buildLaborDescription: clPastTense, looksLikeAccessDetail, sanitizeCustomerText, parseChecklistItems, checklistItemPastTense, workDoneFromChecklist, workDoneBlock, workDoneWarnings, scopeSafeTitle, scopeWorkDoneForInvoice.
- buildLaborDescription: typed text, then "Work completed:" list, else code-safe WO text. Preview warnings via workDoneWarnings in the invoice preview.
- Scope proposal: bill-milestones lists the work only when the picked milestones are the last pending round; the final-balance path always lists it; Scope.Title is sanitized on every path and at push-to-scope.
- Gate: checklistGateResponse in updateStatus (vendor role, Complete / Pending Invoice) and addVendorBill (anything not Entered_By hub). 409 with code checklist_incomplete, message in the vendor's language.
- Share link: /wo/shared/checklist (view-token gated, ticks and reasons only, cannot add or rename items); wo.html shows the checklist.
- Repair: GET /qb/repairable-scope?days=N and POST /qb/repair-scope-invoice {invoice_id, apply, allow_paid}. Description-only; amounts untouched; refuses if lines do not sum to the invoice total; read back after the write; a paid invoice needs a second explicit OK. Not on the broker write allow-list.
- Hub (index.html): Mark all resolved on the WO checklist; repair tool has a 7/30/90 day look-back and a scope-proposal section.

Not done on purpose: no AI rewording (deterministic verb map, fails open to "- resolved"); if the Work_Orders read fails when a vendor submits a bill, the gate fails open (never blocks billing on a Sheets hiccup).

Tests: test/invoice-work-done.test.mjs.
