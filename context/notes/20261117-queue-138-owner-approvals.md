# Queue #138 Phase 1 (part 1): owner Approvals tab — 2026-11-17 — PR #565 into main, head `feat/queue-138-owner-approvals` (cut from main tip 23e5ce7), merged: no
## CURRENT
- PR #565 -> main (base main, verified with the PR response). Head `feat/queue-138-owner-approvals`, cut from main tip 23e5ce704d3ee6b3b6f52b85a8bdeb57d2953345. No staging test-only PR exists. Not merged: GATED, Brett merges.
- Built: GET /owner/approvals, POST /owner/approval/respond (decline / question), resend clears the answer, owner.html Approvals tab, scope-creator.html owner-answer line. Behind Config `owner_approvals_enabled` (blank = OFF).
- Tests: new test/owner-approvals.test.mjs (38 checks); owner-allowlist and owner-write-scope tripwires updated. Full suite 356/356 on the branch before the last small edits (main alone 355/355). ui-check owner.html + scope-creator.html PASS (nothing worse than baseline).
- NOT verified: staging (the staging token cannot sign in as an owner or set Config), a real phone text (fake Twilio only), the scope-creator line with a real declined estimate.
- Left open in Phase 1: Decline button on scope-proposal.html (public link-token endpoint), Hub tile "Waiting on owners (N)" in index.html, demo owner sample card. Phases 2 to 4 not started.
- Owner work-order leak fix (brief item 7) was already shipped Nov 16 (OWNER_WO_VIEW_FIELDS); nothing redone.
## FEATURE_LOG
**[FL-20261117-owner-approvals]** Owner portal "Approvals" tab (queue #138 Phase 1). Rules: owner identity comes from the session only; a decline/question is written with updateRowVerified BEFORE Brett is texted; a failed write sends no text and tells the owner "Not saved, try again."; a refused text leaves the saved answer and a FAILED Ops_Telemetry row (owner_approval_alert_failed); the card price is the proposal's own customer total (same arithmetic as scopeProposalView), never Estimate_Amount; no sums across jobs anywhere on owner screens; the Scopes columns Owner_Response / _At / _By / _Text are created by ensureColumns and cleared by a resend. Tests: test/owner-approvals.test.mjs, test/owner-allowlist.test.mjs, test/owner-write-scope.test.mjs.

## Pre-build gate
Run AFTER the build (Nov 17 2026, at Brett's request: the nightly runner built this before the gate was required), against the actual diff. Shapes: `record` `list` `ui` `endpoint` `message` `role` `write` (plus the standing parameters). Open items below did not shape the build and are not done yet.
Y (already in the build): B9 only Brett is texted; B11 one plain-ASCII SMS piece; B12 quiet hours via smsGatedSend; B15 a history row in Ops_Telemetry per answer; B17 double-tap guard; B25 owner identity from the session only (admin may look via ?owner_id); B32 loading, empty ("Nothing is waiting on you") and retry states; B33 ui-check passed; C3/C4 saved and read back before the text, a failed text leaves a FAILED telemetry row; C6 only each estimate's own price, no sums; C10 reuses smsGatedSend and the emailed sign link; C11 Config owner_approvals_enabled blank = OFF; C12 existing rows read as waiting; C15 one SMS per answer, no AI; C17 ensureColumns before the write; D13 same link token and revision as the emailed proposal.
N (companion actions not yet done):
- B5 Undo: the owner cannot take back a decline or question; only Brett's resend clears it. Acceptable for Phase 1; the card could say so.
- B20 Voice: no mic button on the decline / question box (the phone keyboard mic works).
- B27 Where else: the Hub tile "Waiting on owners (N)" and the Decline button on scope-proposal.html are not built (see CURRENT).
- B31 Settings: the 90-day window and the 2-minute double-tap window are constants.
- D2 Quota-blocked read-back: if the save lands but the read-back is quota-blocked, the owner sees "Not saved, try again"; a same-text retry within 2 minutes then returns "duplicate" and Brett is never texted (the Hub line in scope-creator still shows the answer). FIXED Nov 17: new column `Owner_Response_Alerted` is set once Brett's text goes out (and cleared by a resend); a same-answer retry within 2 minutes with no alert mark skips the save and sends the text; with the mark it is a plain duplicate. Test added (owner-approvals 41/41, full suite 356/356).
- D9: staging cannot prove the owner sign-in or the text. First live use: Brett turns the Config key on and tries it as the demo owner.
- C9 GATED: yes (owner-facing, new owner write endpoint, new Scopes columns). Brett merges.
- C13 Manual steps for Brett: merge; set Config `owner_approvals_enabled` = TRUE when ready.

## Late requests
None yet.
