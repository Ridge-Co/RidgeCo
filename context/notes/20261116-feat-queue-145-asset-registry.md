# Asset registry Phase 1 (queue #145) — 2026-11-16 — PR #556 into main, head `feat/queue-145-asset-registry` (cut from main tip 4408379), merged: no

## CURRENT
Phase 1 of 2 is built and tested, NOT merged, NOT deployed, NOT run against any live Sheet. Admin-only endpoints in `worker.js`: `POST /assets/read-nameplate` (reads a photo with the field-inspection vision prompt, proposes only, writes nothing), `POST /assets/save` (validates property/unit, duplicate check, adds one row to the NEW tab `Asset_Registry`, reads it back before saying ok), `GET /assets/list`. Risk class SAFE (new isolated tab, admin secret only, no money/PII/auth/allow-list change). Brett merges.
- Verified: `node --check worker.js`; `test/asset-registry.test.mjs` 64/64 against an in-memory Sheets fake using the real asset block and the real field-inspection normalizer; full suite 352/352 on the branch (baseline main run 350/351, `recurring-wo.test.mjs` failed there and passed on the branch run: flaky or date-dependent, not investigated).
- NOT verified: any live call (no WORKER_SECRET in the unattended run); real photo reading quality; the real 401/403 for no-secret and role tokens (covered by source tripwires only); staging writes (the staging test token was deliberately not given write access to the new routes, that would widen an auth allow-list = GATED).
- Remaining (Phase 2, needs Brett: touches tenant/vendor flows): Hub screen (photo + confirm), tenant create-issue photo field, WO-completion prompt, warranty banner (#249). Phase 1 of 2.
- Checklist (BRANCH_POLICY): PR #556 -> base `main` (verify with `get_pull_request`); head `feat/queue-145-asset-registry` cut from main tip 4408379; no staging twin PR was opened for this PR (see above); not merged; staging not verified; no temp/nudge commits.

## Pre-build gate
Shapes: `record` `endpoint` `photo` `write` (+ always-on standing parameters).
- B1 edit after create: N. No update/void endpoint in Phase 1 (Active column exists; a Hub screen with edit is Phase 2).
- B3 move between parents: N (Phase 2). B5 undo/restore: N (no delete or void path yet; Active=FALSE by hand hides a row). B15 history: N (only Confirmed_By / Confirmed_At / Source stamped).
- B17 duplicates: Y (409 on same unit+kind+normalized serial, or same brand+model when no serial; `allow_duplicate:true` overrides).
- B21 photos: N for storing the photo. Read-nameplate does not keep the image (no Drive write); `Photo_Drive_File_ID` column exists for Phase 2.
- B24 who sees which file / B25 role matrix: admin only, nothing for tenant/owner/vendor (not in any role scope). B26 Spanish: n/a (no vendor or tenant string). B27 where else: Phase 2 (property/unit pages, warranty banner). B28, B32, B33: n/a (no UI).
- B31 settings: the 4.5 MB photo cap is a constant, same as fiReadLabel.
- C1 quiet: failures go to Ops_Telemetry (`asset_registry`), no text. C2: no cron. C3: Silent-failure check below. C4: Y, row read back before ok:true, no side effect exists. C5: duplicate check on read-nameplate fails OPEN (returns the reading with `duplicate_check:'failed'`), save fails CLOSED (any error is a typed non-ok). C6: n/a, no owner surface. C7: Y, no PII column or read. C8: Y (branch, PR into main, BUILD_VERSION untouched, one note). C9: SAFE, see PR. C10: reuses fiReadLabel prompt/normalizer, routeAI, addRow, ensureTab/ensureColumns, logTelemetry. C11: deploy changes nothing by itself (no screen, tab created on first save). C12: no existing rows. C13: Brett steps: none needed. C14: n/a. C15: one AI call (REASON tier, 600 max tokens) per photo read, no SMS. C16: no data repair. C17: new tab uses ensureTab (tab is new and isolated) then ensureColumns; no live tab touched.
- D1 reads per use: read-nameplate at most 1 (Asset_Registry, only when a property is given); save about 4-5 (Properties, Units, Asset_Registry for ensureTab, duplicate check, read-back); list 1. D2: if the quota blocks the confirming re-read after a good write, the route returns the Hub's calm 429 although the row exists; a retry gets the duplicate 409, so no double write. D4: 4.5 MB cap, typed 413.
Companion actions included: telemetry on every call; duplicate warning; read-back verification; tripwire test that the three paths stay admin-only.

## FEATURE_LOG
**[FL-20261116-q145-asset-registry]** Asset registry Phase 1 (queue #145). New isolated tab `Asset_Registry` (headers in `ASSET_HEADERS`, warranty columns present and empty for #249). Three admin-only routes (`/assets/read-nameplate`, `/assets/save`, `/assets/list`), omitted from `PUBLIC_PATHS`, `ROLE_SCOPES`, `HUB_PROD_WRITE_PATHS`, `HUB_TEST_WRITE_PATHS` on purpose: do not add them without Brett. Rules: (1) read-nameplate never writes; (2) save answers ok only after a read-back of the stored row matches; (3) the label prompt text must stay identical to `fiReadLabel` (test); (4) never store or return tenant/owner/vendor name, phone, email, PIN or code in this tab; (5) `ensureTab` only for `ASSET_TAB`, later columns go through `ensureColumns`. Tests: `test/asset-registry.test.mjs`.

## Silent-failure check
Bad input 4xx with message; AI credit pause 503 `ai_credit_paused`; AI failure or bad output 502; row not accepted 502 `not_saved`; row not confirmed 502 `not_confirmed`; any thrown error 500 `internal` + Ops_Telemetry row (`Success FALSE`); a failed fetch is never turned into an empty list; telemetry failure never breaks a call.

## Late requests
None yet.
