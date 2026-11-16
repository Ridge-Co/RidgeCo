# Repeat-failure units Phase 1 (queue #250) — 2026-11-16 — PR #557 into main, head `feat/queue-250-repeat-units` (cut from main tip 4408379), merged: no

## CURRENT
Phase 1 of 2 is built and tested, NOT merged, NOT deployed, NOT run against live data. Read-only: `GET /repeat-units?days=90&min=3` (admin secret only) and a `▶ REPEAT-FAILURE UNITS` block in the daily digest, shown only when a unit is flagged or the check errored. A unit is flagged at 3 or more real WOs in 90 days, or 2 or more of the same trade. Pure function `repeatFailureUnits` in `worker.js`, no I/O. Risk class SAFE (additive, read-only, no money/PII/auth/schema). Brett merges.
- Verified: `node --check worker.js`; `test/repeat-units.test.mjs` 67/67 against the real functions; selftest 109/109; wo-status-ssot 180/180; full suite 352/352 on the branch.
- NOT verified: any live call (no WORKER_SECRET in the unattended run); real 401/403 for no-secret and role tokens (source tripwires only); output on real work orders; single-family houses with no unit are never flagged (known gap).
- Remaining (Phase 2): owner view (customer-facing wording, needs Brett), per-asset flags once the registry (#145, PR #556) is merged. Phase 1 of 2.
- Checklist (BRANCH_POLICY): PR #557 -> base `main`; head cut from main tip; no staging twin PR; not merged; BUILD_VERSION untouched; one note.

## Pre-build gate
Shapes: `endpoint` `report` (read-only, no record, no write, no photo).
- B1 edit/B3 move/B5 undo/B15 history/B17 duplicates/B21 photos: N (nothing stored). B24/B25: admin only, in no role scope (a test pins it). B26 Spanish: n/a, admin text only. B27 where else: owner view is Phase 2. B28, B32, B33: n/a (no UI).
- B31 settings: window 90, min 3, same-trade 2, top 5 are constants; the endpoint clamps its params.
- C1 quiet: no sends added; the digest already exists. C2: no cron. C3: Silent-failure check below. C4: n/a, nothing written. C5: fails LOUD (error line in the digest, thrown error in the endpoint), never an empty all-clear. C6: no owner surface. C7: output has unit label, WO ids, counts, trades, dates only (tested). C8: Y (branch, PR into main, one note). C9: SAFE, see PR. C10: reuses buildDigest's Work_Orders read, WOStatus.sets, isHiddenBidCopy. C11: deploy only adds a digest section when something is flagged. C12: reads existing rows, changes none. C13: Brett steps: none. C14: n/a. C15: no AI, no SMS, no extra Sheets read in the digest, one read for the endpoint. C16: none. C17: no tab or column touched.
- D1 reads per use: digest 0 extra, endpoint 1.
Companion actions included: self-test entry for the endpoint; tripwire that the block has no write call.

## FEATURE_LOG
**[FL-20261116-q250-repeat-units]** Repeat-failure units Phase 1 (queue #250). `repeatFailureUnits(wos, opts)` is a pure function; `/repeat-units` is admin-only by omission from every allow-list. Rules: (1) read-only, never write; (2) never output tenant/owner/vendor name, phone, email, code, notes or money; (3) statuses come from `WOStatus.sets`, no hand-written list; (4) the digest text is byte-identical when nothing is flagged; (5) a failure shows in the digest and never breaks it. Tests: `test/repeat-units.test.mjs`.

## Silent-failure check
Failure in the digest block prints "Could not check repeat-failure units: ..." and the rest of the digest still goes out. A failed Work_Orders read in the endpoint is a thrown typed error (quota gets the calm 429), never an empty list. The nightly self-test covers the endpoint.

## Late requests
None yet.
