# SILENT-FAILURE LINT (the missing script the skills call) — Nov 17 2026 — PR into main, head `feat/silent-failure-lint-nov17` (cut from main tip b8c476a), merged: no

## CURRENT
**Status: built and tested. Tooling only (no worker.js / HTML change, BUILD_VERSION untouched).**

**Why:** the `no-silent-failures`, `test-verified-builds` and `ridgeco-validate` skills tell every build to run `node scripts/silent-failure-lint.mjs` ("the ratchet"), but the file never existed: it was planned in `context/NO_SILENT_FAILURES_PROGRAM_v1.0.md` section 7 (phase B) and never built. Every build was told to run a check that could not run. Built it as planned instead of deleting the references, because the rule it enforces is one of Brett's standing rules and 25 `// silent-ok:` markers already in the code were written for it.

**Built:**
1. `scripts/silent-failure-lint.mjs`: counts swallowing handlers in every root `*.js` / `*.html` file: empty catch, comment-only catch, log-only catch, and swallowing promise `.catch(() => {} / null / [] / false ...)`. A line with `// silent-ok: <3+ word reason>` is exempt; a shorter reason is itself a finding. Exit 0 pass, 1 new silent handler (lists every one in that file with line numbers), 2 the lint itself broke (missing baseline etc.; never a quiet pass). `--update` rewrites the baseline.
2. `scripts/silent-failure-baseline.json`: today's counts, 664 handlers in 35 files (worker.js 485, index.html 52, vendor.html 26, ...). This is the old debt the program's phase C burns down; the ratchet only stops it growing.
3. `test/silent-failure-lint.test.mjs` (23 checks): the detector on fixtures (flags the four kinds, ignores catches that report, rethrow, or log AND return an error; silent-ok needs a real reason; a handler matched by two patterns counts once), the ratchet on a throwaway folder (more = fail with file:line, new file = fail, fewer = pass + "lock it in", missing baseline = exit 2), and the real repo against the baseline. It runs in the normal unit-test CI, so every PR is checked.

**Verified:** full suite 358/358 locally; samples of flagged lines in index.html, vendor.html and tenant.html checked by hand (all real swallowed errors, mostly localStorage and fire-and-forget fetches).
**Not verified:** none beyond the above; no live system involved.

## Pre-build gate
Shapes: `job` (a CI check). Brett asked for "the best possible way" to fix the missing-script reference; defaults settled the rest.
- C2 No cron: runs inside the existing unit-test workflow (pull_request / push), no schedule.
- C3 Nothing fails silently: a broken lint (missing or bad baseline, a crash) exits 2 with a message; a new silent handler names the file and line.
- C5 Fail-closed on purpose: a new silent handler blocks the PR's unit-test check; old debt is tolerated by the baseline (warn-don't-block for old code, block for new: B18).
- C8 Branch from main, PR into main; BUILD_VERSION untouched; this note is the one notes file.
- C9 GATED: no (tooling and tests only).
- C11 Safe start: the baseline equals today's counts, so merging changes nothing for open PRs that add no new silent handler.
- C13 Manual steps for Brett: none.
- C15 Cost: no AI, no network.
- B27 Where else: the three skills already name this exact command; the PR template already has the "Silent-failure check" line. No edits needed there.
- B31 Settings: the 3-word minimum for a silent-ok reason matches the skills' wording; kept as a constant on purpose.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261117-silent-failure-lint]** Silent-failure ratchet. Regression rules:
1. Never raise a number in `scripts/silent-failure-baseline.json` to turn a red check green; report the failure or mark it `// silent-ok:` with a real reason.
2. When a PR removes silent handlers, run `node scripts/silent-failure-lint.mjs --update` in the same PR to lock the lower count in.
3. A new root `*.js` / `*.html` file starts at baseline 0.
Tests: `test/silent-failure-lint.test.mjs`.
