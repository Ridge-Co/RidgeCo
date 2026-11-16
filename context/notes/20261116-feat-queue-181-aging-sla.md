# Aging buckets + SLA targets (queue #181) — 2026-11-16 — PR #558 into main, head `feat/queue-181-aging-sla` (cut from main tip 4408379), merged: no

## CURRENT
Built and tested, NOT merged, NOT deployed, NOT run against the real Hub. `command-center.html` only: a new "Aging and targets" card after the stuck-work card. Buckets 0-2 / 3-7 / 8-14 / 15+ days of open work (`WOStatus.sets.OPEN_WORK`), a "N past target" list against placeholder per-priority targets (`SLA_DAYS` urgent 1, high 3, normal 7, low 14, one line), On Hold never past target, unreadable dates and blank priorities counted and shown. No new request, no write, no `worker.js`, no Sheet change. Risk class: queue field GATED, brief and guardrail reading SAFE (static admin page, read-only); Brett merges either way.
- Verified: `test/command-center-aging.test.mjs` 42/42 (real `agingModel`); wo-status-ssot 180/180; rc-ui 385 checks; full suite 352/352; headless-browser run with mocked Worker data at 412 and 1366; `scripts/ui-check.mjs` PASS (no count worse than baseline).
- NOT verified: real `/workorders` data (no admin token), staging, a real phone, the Impeccable detector (not installed).
- Open decision for Brett: confirm the placeholder targets. Optional follow-up: move them to the Hub Config tab.
- Checklist (BRANCH_POLICY): PR #558 -> base `main`; head cut from main tip; no staging twin PR (no worker change, nothing to stage-test); not merged; BUILD_VERSION untouched; one note.

## Pre-build gate
Shapes: `page` `report` (read-only card, no record, no write, no photo, no endpoint).
- B1/B3/B5/B15/B17/B21: N (nothing stored). B24/B25: admin page, needs the admin token as before. B26 Spanish: n/a (admin only, no vendor or tenant text). B27 where else: owner view not part of this item. B28 states: loading is the page's own spinner, empty and error-with-retry added. B32 phone width: tested at 412. B33 touch targets 44px: tested.
- B31 settings: `SLA_DAYS` is one line, placeholders shown on screen.
- C1 quiet: no sends. C2: no cron. C3: Silent-failure check below. C4: n/a. C5: error box with Retry, never a blank gap. C6: no owner surface, no money field. C7: no PII added (WO id, trade, address label, age). C8: Y. C9: see PR. C10: reuses `WOStatus.sets.OPEN_WORK`, rc-ui parts, existing `addr()` and `h()`. C11: deploy is the page only, GitHub Pages. C12: no data touched. C13: Brett steps: read the card, confirm targets. C14: n/a. C15: no AI, no SMS, zero new requests. C16: none. C17: no tab or column touched.
- D1 reads per use: 0 extra.
Companion actions included: "no date" and "no priority" counts so nothing is silently dropped; wiring tests that the new code makes no network call and has no hand-written status array.

## FEATURE_LOG
**[FL-20261116-q181-aging-sla]** Aging buckets + SLA targets on the Command Center (queue #181). Page-only, read-only. Rules: (1) the card uses the work orders the page already loaded, never a new request; (2) population is `WOStatus.sets.OPEN_WORK`, no hand-written status list; (3) `SLA_DAYS` are placeholders until Brett confirms; (4) On Hold is never past target; (5) unreadable dates and blank priorities are shown as counts, never dropped. Tests: `test/command-center-aging.test.mjs`.

## Silent-failure check
Unreadable created dates are counted in a visible note, blank priorities are counted in a visible note. A bug in the card shows an error box with Retry; if rc-ui did not load, a plain red message shows; the rest of the page keeps rendering.

## Late requests
None yet.
