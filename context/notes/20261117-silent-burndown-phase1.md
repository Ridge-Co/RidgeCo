# 2026-11-17 silent-burndown-phase1 (benign sweep: 41 handlers get a real `silent-ok` reason, no behaviour change)

## CURRENT
Phase 1 of the silent-failure burn-down (`claude/silent-failure-burndown-handoff-nov17.md`). Each handler below was read in context; the change is ONE trailing line comment `// silent-ok: <reason>` on the handler's own line. No code, no behaviour change. Baseline 722 -> 681 (worker.js 516 -> 505, failure-reporter.js 8 -> 0, index.html 61 -> 59, vendor.html 29 -> 23, tenant.html 12 -> 10, owner.html 7 -> 5, wo.html 7 -> 4, fix-check.html 4 -> 2, failures.html 4 -> 3; inspect-book.html, rc-related.js, rc-ui.js and sw.js to 0).

What got a reason (41):
- **Browser storage on non-auth keys (20):** page-version / etag markers (`LAST_KEY`, `PAGE_ETAG_KEY`), language choice, the staging-API switch, last-manage-link, the reporter's badge cache. Storage blocked or full means the value is not remembered; the page works.
- **Success-path ops telemetry in worker (11):** `wo_create`, `wo_assign`, `wo_status`, `wo_schedule`, `wo_bulk_void`, `wo_combine`, `wo_split`, `turnover_start`, `turnover_release` (x2), `weekly_review`, `fi_transcribe`. One `logTelemetry` call inside the try, nothing else; a logging miss must not fail the request.
- **Reporting code that cannot report itself (10):** `failure-reporter.js` (7), `rc-ui.js`, `rc-related.js`, `sw.js` (notification URL falls back to the site root). Rule 11 (never loop).

Deliberately NOT done here (left for their own phases, so this PR touches no money, texts, scheduler or auth code):
- Any storage line for a login session or admin token (`SESS_KEY`, `AUTH_KEY`, `mh_auth`) and the session-restore lines that also call `onLoginSuccess`: Phase 5 (GATED).
- Telemetry on failure paths and in money, QuickBooks, send, scheduler and door paths (`fee_credit_apply_failed`, `proposal_*`, `vendor_paid_text_failed`, `wo_share_send`, `dead_man_switch`, `message_template_refresh_failed`, scheduler "unhandled error"): that row can be the only record of a real failure, so they get a real report in Phases 2, 3 and 4.
- Audit rows (`logWOAudit`) for Priority, Max_Price and SMS changes (decision table exception: these get a report, not a reason).
- Multi-line forms and console.error-only fallbacks: read by hand in the phase for their area.
The plan's estimate of about 140 was a keyword count; reading each one, 41 are safely benign today.

## Pre-build gate
Shapes: `record list` (comments only; no endpoint, sheet, UI or behaviour change). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main; BUILD_VERSION untouched.
SAFE under R-2: no money, QuickBooks, personal data, login, customer text or schema is touched; the only edit is a trailing line comment, easy to undo (revert the PR).
Silent-failure check: nothing newly caught or swallowed; 41 existing handlers now carry a reviewable reason and the lint total falls 722 -> 681 with `git diff scripts/silent-failure-baseline.json` showing decreases only. A script check parsed every changed file's script blocks before and after: no new syntax errors.

## Late requests
None.

## FEATURE_LOG
Rule: the baseline only goes down from 681 (worker.js 505). A `silent-ok` reason must be real, and never goes on a write, a send, a money path or an auth session.
