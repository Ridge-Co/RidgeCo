# Vendor fast-pay, Phase 1 of 4, part a: this week's pay run list (queue #53) — Nov 22 2026 — PR -> main, head `feat/vendor-pay-run-phase1` (cut from main tip 02f94e7), merged: no

## CURRENT
**Status: built and unit/browser-tested with mocked data; NOT verified against real QuickBooks or on staging. GATED (brief class: any QuickBooks call, vendor money), so no session merges it: it waits for Brett.**

What shipped (read-only; nothing in QuickBooks, no text, no email, no money moves):
- `payRunBuild(rows)` in worker.js: pure. Ready = state PAY THE VENDOR + `customer_clear_status` cleared (the rule `/qb/payables` already computes, holiday list included). Everything else open is "not ready" with one plain reason (funds not cleared until a date, payment date unavailable, possible duplicate, customer unpaid, part-paid, vendor bill missing, could not tell). Paid / nothing-to-pay rows are left out. Totals exact to the cent; vendors sorted biggest first.
- `GET /qb/pay-run` (`payRunGet`): admin only, same gate as `/qb/payables` (not public, not role-scoped, not in `HUB_PROD_WRITE_PATHS`). Calls `qbPayables` once (gate item C10). A failed QuickBooks read is `ok:false` + an error + an Ops_Telemetry row, never an empty list.
- Who To Pay page: a "This week's pay run" button and panel (tap only, so the page does not read QuickBooks a second time on every open). Loading, empty, error + Try again, per-vendor cards with the existing "open bill in QB" link, "Not ready (N) and why" folded.

Phase 1 of 4: **part a of 2 done.** Part b not built: the Monday scheduler job `pay_run_weekly` and its one email to Brett, behind `pay_run_enabled`. Reason: adding a SCHED_JOBS row means updating several tests that pin the exact job list, the seeded-job lists and the JOBS table, and Brett pastes the Apps Script row; that is its own small PR. Remaining after this: Phase 1b, Phase 2 (close the loop), Phase 3 (promise to vendors, GATED), Phase 4 (bank details, GATED).
Step 0 of the brief (read Intuit's BillPayment docs; confirm the Bill Pay tier and ACH limit) was NOT done: this session cannot read Intuit's developer pages or Brett's QuickBooks. It does not change this slice; it decides Phases 2-4.

## Pre-build gate
Shapes: `list` `money` `ui` `endpoint` (`job` is Phase 1b). Scheduled run, nobody to ask: every item took its default; the brief's QUESTIONS 1-8 took their recommended defaults (pay only after the customer's money cleared; Monday list; Brett pays in QuickBooks Bill Pay; the Hub pay button stays off; instant pay stays a per-vendor exception).
Items that are N (known gaps):
- Monday email and `pay_run_enabled` switch: N (Phase 1b).
- B-items for history / "mark as paid outside QuickBooks" / status chips: N (Phase 2).
- Vendor-facing promise and settings screen (pay day, rule): N (Phase 3).
- Settings, not constants: the rule is fixed in code (cleared funds only) for now, default Q1.
- Brief step 0 checks: N (no access to Intuit docs or the account).
Standing parameters: C1 no texts (none sent); C2 no cron (no job added); C3 failures are logged and shown (see the PR's silent-failure line); C4 n/a (no write); C5 fail-closed (an unreadable QuickBooks is an error, unknown clearing is "not ready"); C6 owners never see this (admin page only); C7 vendor names and amounts only to the admin; C8 branch, PR to main, Brett merges; C9 GATED; C10 reuses `qbPayables` and `qbBillLink`; C11 safe blank: panel is hidden until tapped; C12 no data changed; C17 n/a (no columns).
Companion actions included: retry on error, loading and empty states, the existing QuickBooks deep link per bill, escaping of vendor names, 44px tap targets, a warning count carried through from the payables read.

## Late requests
None yet.
