# Monthly owner summary email, Phase 1 — Nov 22 2026 — queue #122 — PR into main (number in the PR title "queue #122"), head `feat/owner-summary-q122` (cut from main tip 02f94e7), merged: no

## Pre-build gate
Shapes: `record` `list` `ui` `endpoint` `message` `write` `external` `role`. Nobody to ask (scheduled run); every item took its default or the safer option. Defaults taken from the brief: no photos in v1 (link to the portal), no owner gets it until switched on, drafts cover the previous calendar month.

Items that are N (known gaps):
- Phase 2 (scheduler job that builds drafts on day 3) and Phase 3 (AI wording): N. Built: Phase 1 of 3. B12 timing and D10 (JOBS row in two places): n/a until Phase 2.
- "Waiting on you" section listing approval items: N. v1 only says approvals and photos are in the owner portal (a link). Listing them needs reuse of `ownerApprovals`; amounts may not appear in the email anyway.
- B2 Correct after it was sent: N. A sent email cannot be unsent; the Send button says so. Sent blocks a second send forever.
- B15 History: partly. Each row keeps Built_At, Edited_At, Sent_At and Send_Result; no per-edit history.
- B16 Bulk send: N. Build is bulk (20 owners per call); Send / Skip are one draft at a time on purpose.
- B27 Where else will he look: N. No digest line or Needs Attention badge for "N drafts ready" until Phase 2; a failed send does land on Needs Attention (reportFailure, P1).
- B28 Long lists: N. The screen lists one month at a time, no search.
- B30 Did they get it: N. No open or delivery tracking.
- B31 Settings not constants: partly. Test address is Config `Owner_Summary_Test_To` (falls back to `STR_CAL_IMPERSONATE`, which already holds Brett's own address); the 20-owner slice is a constant.
- B26 Spanish: n/a, owners are English only (brief).
- D9 Staging cannot prove Gmail: N. Staging holds the email (stub), so the draft shows Failed there; real delivery is not verified.
- Race: two simultaneous Send calls could both read Draft before either writes Sent. The button disables before any await and Sent is written and read back first, so only a deliberate double call from two devices at the same instant could do it.

Companion actions included: B1 edit before send (subject and body, scrubbed); B9 owner hears only after Brett presses Send, each owner has their own switch (default OFF); B10 not applicable (nothing is recorded after the fact); B13 hold visibility (To: line on screen, staging banner, a held or failed email turns the draft Failed with the reason and can be retried); B14 edit before send; B17 duplicates (second build never overwrites a Draft, Sent or Skipped row); B18 warn don't block (owners with no email or nothing to report are listed with the reason); B19 preview of the real output (the iframe shows the exact stored HTML) plus a test send to Brett; B29 every line carries the work order number and says what was done; B32 loading, empty and error states with Try again; B33 phone first (412 px, 44 px targets, 16 px inputs); C1 no texts; C2 no cron; C3 silent-failure line in the PR; C4 the Sent mark is written and read back before the email goes out, row writes are verified; C5 fail closed (a failed scrub or failed write means nothing is sent); C6 no dollar sign, spend, cost, total, average, YTD or time-to-complete wording, enforced by `ownerSummaryScrub` on build, edit, test and send; C7 no lockbox or door codes, no internal note fields; C9 GATED; C11 blank switch = OFF; C12 no backfill; C17 `ensureColumns` for the `Owners.Monthly_Summary` column and the new `Owner_Summaries` tab; D1 one batch read of Owners / Properties / Work_Orders per build; D3 slices of 20 owners; D14 months and dates in Eastern time.

## Late requests
None yet.

## CURRENT
Status: built, tested offline, waiting for Brett. GATED (sends email to real owners, adds a column to Owners), so no session merges it. Not run on staging (see D9); not verified against the live sheet.
- Worker: block `OWNER SUMMARY` in worker.js; routes `GET /owner-summary/list?month=`, `POST /owner-summary/build | save | send | skip | test-send` (admin only; none on an owner-session path). New tab `Owner_Summaries` (ID, Owner_ID, Month, Status Draft/Sent/Skipped/Failed, To_Email, Subject, Body_Html, Counts_Json, Built_At, Edited_At, Sent_At, Send_Result). New `Owners.Monthly_Summary` column (blank = OFF).
- Hub screen: Owners page > "Monthly summaries" opens the Owner summaries modal (month, Build drafts, list, preview you can edit, Send me a test, Send to owner, Skip; Send and Skip need two taps). Edit Owner has the "Monthly summary email" switch.
- The summary code never reads Max_Price or any cost column; `test/wo-max-price.test.mjs` still passes.
- Needs a human: (1) merge; (2) switch the owners you want on in Edit Owner; (3) press Build drafts, read each, test-send one to yourself, then Send.
- Tests: `test/owner-summary.test.mjs` (57 checks).

## FEATURE_LOG
**[FL-20261122-owner-summary]** Monthly owner summary email, Phase 1 (drafts built on demand, Brett sends each one). Regression rules: 1. Nothing is sent without Send on that draft; there is no scheduled send. 2. Owners never see spend: `ownerSummaryScrub` runs on build, edit, test and send, and a draft that fails it is Failed and unsendable. 3. The Sent mark is written and read back BEFORE the email goes out; a failed or held email turns the row Failed (never Sent) and goes to Needs Attention. 4. The summary code must not name Max_Price (test/wo-max-price.test.mjs scans owner functions). 5. Month and date logic is Eastern time. 6. `Monthly_Summary` blank means OFF. Phase 2 (scheduler job `owner_summary` that only builds) and Phase 3 (AI wording via routeAI customerFacing) are still to do. Tests: `test/owner-summary.test.mjs`.
