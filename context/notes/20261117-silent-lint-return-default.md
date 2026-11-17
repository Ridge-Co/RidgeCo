# 2026-11-17 silent-lint-return-default (lint now catches `catch { return null / [] / false }`)

## CURRENT
Brett approved (Nov 17, Q3 of the burn-down handover). `scripts/silent-failure-lint.mjs` has a fifth pattern, "return-default catch": a catch whose only statement is `return`, `return null|undefined|false|true|0|''|[]|{}` (comments before it do not hide it). A catch that reports first, returns an error object or returns a computed value is not flagged. `// silent-ok: <3+ words>` exempts it as before.
The baseline went UP ONCE, on purpose, because the lint now sees handlers it was blind to: total 664 -> 722 (worker.js 485 -> 516, index.html 52 -> 61, vendor.html 26 -> 29, command-center.html 9 -> 13, tenant.html 10 -> 12, plus smaller files and two files that had no baseline: building-info.html 1, push-client.js 2). No code changed behaviour. These get burned down by the phases of the burn-down plan (benign ones marked silent-ok in Phase 1, the rest converted to softFail / softNote). Never raise the baseline again.
Tests: `test/silent-failure-lint.test.mjs` (11 new fixture checks).

## Pre-build gate
Shapes: `record list` (tooling only, no endpoint, no sheet, no UI). Defaults taken: C1-C17 standing parameters; no cron; branch from main, PR into main.
SAFE under R-2: a lint script, its baseline and a test; no money, QuickBooks, personal data, login, customer text or schema. Easy to undo (revert the PR).
Silent-failure check: forced by fixtures. A catch that only returns a default is flagged; the same catch with a report, an error object, a computed value or a real silent-ok reason is not.

## Late requests
None.

## FEATURE_LOG
Rule: `scripts/silent-failure-lint.mjs` counts return-default catches; the baseline only goes down from 722 (worker.js 516).
