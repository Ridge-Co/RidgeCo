# SILENT-FAILURE BURN-DOWN PHASE 0 — helpers and tests — 2026-11-17 — PR (to open) into main, head `phase0/silent-burndown-helpers-nov17` (cut from main tip 8163ed1), merged: no

## CURRENT
- Adds seven call-site helpers next to `reportFailure` in worker.js: `softSeenOnce`, `softItem`, `softReport`, `softFail`, `softNote`, `softFlush`, `fetchTabSoft`, `parseJsonCell`, `tryWrite`, `safeJson`. Block is marked `SOFT-FAILURE-HELPERS-BEGIN/END`.
- Rules the helpers enforce: never throw; one report per request per `where` (pass the same `req` object); no extra Sheets read (`fetchTabSoft` is one `fetchTab` call); `softNote` and `parseJsonCell` queue and need `await softFlush(env, req)` before the response returns.
- No existing handler is changed. Silent-failure baseline is unchanged at 664 (lint: pass, 664 known, none new).
- `test/soft-failure-helpers.test.mjs`: 31 checks, all pass. It extracts the real block from worker.js and runs it against a fake `reportFailure` and `fetchTab`.
- `test/bug-class-tripwires.test.mjs`: bare `await request.json()` baseline raised 2 -> 3, for `safeJson`'s own try-wrapped read. This is the only test edit.
- Not verified here: `node --check worker.js` was refused by a local privacy hook on this machine, so CI's unit-tests workflow is the syntax check. Full local suite: all files pass except `session-identity.test.mjs`, which also times out on untouched main (pre-existing, not from this PR).
- Deferred: the optional lint extension for `catch { return null / [] / false }` (handover section 5, decision 3). Not done here because it raises the baseline and Brett has not answered that question yet.
- Still open: the two skill cards (`no-silent-failures` section 3 and `test-verified-builds` step 1b) must list these exact signatures. Proposed via propose_skills; Brett must save them.

## Pre-build gate
Shapes: `always` (helper code only; no endpoint, message, money, or schema change).
- C3 Nothing fails silently: Y. Every failure path in the helpers reports, or returns a value the caller can see.
- C8 Branch first, PR into main, Brett merges: Y. Branch from main tip 8163ed1; no staging twin needed because nothing runs in production yet.
- C2 No cron: Y. None added.
- C10 Reuse the one pipeline: Y. Reports go through the existing `reportFailure`.
- C11 Safe starting position: Y. Helpers are unused until a later phase calls them, so deploy changes no behaviour.
- D1 Sheets read quota: Y. `fetchTabSoft` adds zero reads (test checks this).
- D2/D5/D6/D7/D8/D9/D10/D11/D12/D13/D14: n/a. No send, money, QuickBooks, schema, scheduler job, credential, or outside system is touched.
- B1-B33 (record/list/message/photo/ui items): n/a. Internal helpers, no user-facing change.
- Known gap: the helpers are not yet called anywhere. Phase 1 onward wires them.
Companion actions included: test for the tripwire baseline (the one required change); this note.

## Late requests
(none yet)

## FEATURE_LOG
**[FL-20261117-soft-failure-helpers]** Adds soft-failure helpers (`softFail`, `softNote`, `softFlush`, `fetchTabSoft`, `parseJsonCell`, `tryWrite`, `safeJson`) beside `reportFailure` in worker.js. Rules: never throw; once per request per where; no extra Sheets read; queued reports need `softFlush`. Tests: `test/soft-failure-helpers.test.mjs` (31 checks, fault-injected reportFailure failure, dedupe, fetchTab call count, blank vs corrupt JSON). Tripwire `bare await request.json()` baseline 2 -> 3 (safeJson). Silent-failure baseline unchanged at 664.
