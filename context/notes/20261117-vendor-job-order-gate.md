# Job order of operations: complete first, then bill; real On Hold reason and date — Nov 17 2026 — head `feat/vendor-job-order-nov17`, stacked on `fix/vendor-spanish-complete-nov16` (PR #563)
## CURRENT
Brett asked (Nov 17) that the vendor portal and the Hub enforce the order: mark the job Complete, then enter the bill. A bill needs a description, at least 1 AFTER photo, and a receipt picture for every receipt paid back. The "what is missing" notice is bold red. On Hold needs a reason and an expected-back date, and the Hub uses the same picker.

Built:
- New `vendor-job-order.js` (shared rules, tested directly): hold reasons, `checkHold`, `holdText`, `missingForBill`. Loaded by `vendor.html` and `index.html`.
- Vendor portal: opening the bill screen on a job that is not Complete offers "Mark complete" first; a red "To get paid, you still need:" panel updates live; Submit refuses until the list is empty; after Complete a gentle "Send your invoice now? / Later" nudge; a Complete job with no bill shows a red "Send your invoice" box on its card; On Hold opens a picker (5 reasons, details, date chips, date box) in place of a free-text prompt. All new text has Spanish in `vendor-i18n.js`.
- Hub: `hubHoldDialog` replaces both `prompt()` hold asks (single and bulk); `hubHoldBadge` shows a red flag on a hold whose expected-back date has passed; `hubBillNeeds` gates `hubBillSubmit` with the same red list and a "Mark complete now" button.
- Hold text format (no new field): `<reason> — <detail> — expected back YYYY-MM-DD`, sent in the existing `hold_reason`.
- Tests: `test/vendor-job-order.test.mjs` (behavior plus source pins on both pages); `test/vendor-spanish.test.mjs` also scans `vendor-job-order.js`.

Not done on purpose (needs a Worker change Brett approves separately; worker.js not changed): server-side enforcement of the same rules, an expected-back date field, the "tell the tenant" message with presets (default off), overdue-hold flag to Brett outside the Hub detail view, tenant-side hold reason display.

Unverified here: the real phone, a native Spanish speaker, whether the Worker accepts `hold_reason` from the vendor role (to be checked on staging with a TEST work order).

Branch policy checklist: real PR targets `fix/vendor-spanish-complete-nov16` (re-point to main once #563 merges); Brett decides the merge; staging twin carries `staging-test-only: true` and is listed separately; no temp commits on staging.
## FEATURE_LOG
**[FL-20261117-job-order-gate]** Complete-first billing gate and hold picker. Regression rules: (1) a bill needs Complete job, description >= `MIN_DESC` characters, 1 after photo, and a receipt image per reimbursed receipt, in both `vendor.html` and `index.html`, from `vendor-job-order.js` only; (2) an unreadable photo list never blocks a bill (fails open) and the Worker is the real enforcement once built; (3) a hold always carries a reason and a future date, and stores `— expected back YYYY-MM-DD` at the end; (4) new vendor-readable text needs a Spanish entry. Tests: `node --test test/vendor-job-order.test.mjs test/vendor-spanish.test.mjs`.

## Silent-failure check
A missing `WOStatus` or an unreadable attachment list lets the bill through rather than blocking a real invoice, and the Worker check (separate PR) stays the backstop; this is stated in the regression rules, not hidden. A hold picker that failed to load shows an error toast in the Hub and does nothing in the portal's old path is replaced, so there is no silent path to a hold without a reason.

## Pre-build gate
- Read first: CURRENT.md standing rules, notes README, the status SSOT test (no hand-written status arrays: used `WOStatus.inSet`).
- Reuse: existing bill modal, `submitStatus`, `/status` with `hold_reason`, `/attachments`; no new library, no new Worker field.
- Smallest change: one shared JS file, hooks in existing functions, no restyle.
- Not done on purpose: no Worker change in this PR.
