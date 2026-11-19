# QUEUE #116 Phase 1 of 5: guided request with emergency catch — Nov 19 2026 — PR pending into main, head `feat/queue-116-guided-intake` (cut from main tip d32d130), merged: no

## CURRENT
**Status: built by the nightly runner; waiting for Brett. GATED (customer-facing tenant pages, a text to Brett, new Work_Orders columns), so no session merges it.** Phase 1 of 5 (4 of 5 remain: AI follow-up, intake inbox + public page, texting door, photo help).

- PR number and base are written in the PR itself; verify with `get_pull_request` before quoting them.
- Head `feat/queue-116-guided-intake`, cut from main tip d32d13023ed39b3bdcd5448fc1644510d4ba9aa3.
- Staging twin (test-only, NOT the path to main): see the PR body for its number and the staging version it was checked at.
- BUILD_VERSION untouched. No temp or nudge commits on staging.

**What it does:** the tenant request forms (`submit.html` and the Submit box in `tenant.html`) can run a short guided flow: one emergency question first (eight one-tap emergencies or "None of these"), then the kind of problem, up to four follow-ups (each skippable), a Brett-approved self-check where one applies (breaker, GFCI reset, disposal reset, thermostat batteries), then the description, photos and Send. English and Spanish with a visible toggle. A tapped emergency files at once as an urgent work order and shows a red safety screen with a call button. The **server** decides emergency again from the answers and from words in the description, so the alert never depends on the page. After the row is written and read back, Brett gets one text (type `admin_intake_emergency`, ignores quiet hours, one SMS piece, plain ASCII, short link) plus a push. The 14-minute work sweep sends ONE second text if the work order is still New and unopened after `intake_emergency_recheck_min` (default 10). Opening an emergency work order in the Hub acknowledges it (stops the second text).

**Built:**
1. `intake-flow.js` (new, shared): emergency list, question bank, self-checks, English/Spanish strings, `buildSummary`, the step screen. The pages pass it a `file(body)` function.
2. `worker.js`: `intakeClean`, `intakeDecide`, `intakeAlertText`, `intakeAfterCreate`, `processIntakeEmergencyRecheck` (inside `schedRunSweepWork`), `intakeAck`, `intakeDeflected`; createWorkOrder reads `intake` only while Config `intake_guided_enabled` is TRUE; additive columns `Intake_Channel, Intake_Answers, Intake_Summary, Intake_Emergency, Intake_Alert_State` via `ensureColumns` (list is `GUIDED_INTAKE_COLS`; `INTAKE_COLS` already belongs to the Buildium intake tab); routes `POST /intake/ack` (admin) and `POST /intake/deflected` (tenant); `tenant-by-pin` and `tenant-session-refresh` return `intake_guided`, `emergency_phone` (Config `admin_phone`, only while the flow is on), `language`.
3. `index.html`: Intake block on the work order (answers in plain lines, EMERGENCY chip, "Alert text sent <time>" or "ALERT NOT DELIVERED"), emergency chip on cards, emergencies sort above every tier (`triRank`), opening one calls `/intake/ack`.
4. Tests: `test/intake-guided.test.mjs`, `test/intake-flow-i18n.test.mjs`, plus lines in `tenant-submit-request.test.mjs`.

**Brett's manual steps after merge:** (1) add Config row `intake_guided_enabled` = TRUE when ready (it is absent today = OFF); (2) on his phone, review the emergency list and the four self-checks; (3) optional Config rows: `intake_emergency_words` (comma list), `intake_emergency_recheck_min` (default 10). Nothing to paste into Apps Script (the recheck rides the existing sweep).

**Rollback:** delete the Config row or set it to FALSE: both forms return to today's single form at once. The added columns are harmless when unused.

## Pre-build gate
Shapes: `ui` `record` `message` `endpoint` `write` `photo` `job`. Nobody was available to ask (scheduled run), so every item took its default or the safer option; the brief's eight questions took their recommended defaults (listed in the PR).

Items that are N (known gaps):
- B1 Edit after create: N. The Intake block is read-only; the description and priority stay editable through the existing Edit work order screen.
- B5 Undo: N for the alert (a text cannot be unsent). A work order filed by mistake is voided with the existing restorable Void.
- B13 Hold visibility: N. The alert ignores quiet hours; if Twilio is off or refuses it, the work order says ALERT NOT DELIVERED afterwards instead of warning beforehand.
- B15 History: partly. `Intake_Alert_State` keeps sent / failed / second text / opened with times in one cell; no separate log tab.
- B20 Voice dictation: N. The phone keyboard microphone works in the description box.
- B22 Photo gaps: N (unchanged from today).
- B27 Where else will he look: partly. Cards, list order and the work order show it; the Command Center and Needs Attention tiles do not (the failure ledger does, for a failed alert).
- B30 Delivered / first used: partly. "Sent" is Twilio accepting the text; there is no delivery receipt check.
- B31 Settings, not constants: partly. Switch, word list and recheck minutes are Config; the 6-hour recheck window and the four-question cap are constants.
- D9 Staging stubs SMS: yes. On staging the alert text is logged only; the first live emergency text is the one Brett's own test (see manual steps).
- D10 Scheduled job: none added; the recheck rides `sweep_work`, so no JOBS row to paste.

Defaults taken from the brief's questions: emergency list = the eight in the brief; call number = Config `admin_phone`; alert = one text now (any hour) + push + one text after 10 minutes if unopened; owner not texted about an emergency; self-checks allowed for the four approved ones only, never for an emergency, "Still broken" always files; "urgent" chosen by a tenant still alerts nobody; Phase 3 to 4 not started.

Companion actions included: duplicate guard (the existing 60-second signature guard still runs; Send disables on first tap); Spanish for every tenant-facing line, English summary for Brett; phone first (412px, 44px targets, 16px inputs, no popups); loading / sent / error-with-Retry states keeping the answers; failed photo upload still files the request and says so; C1 no extra texts for Hub failures (failures go to the ledger); C2 no cron; C3 silent-failure line in the PR; C4 write re-read before any text; C5 fail-closed (an unconfirmed emergency row sends no text and files a P0 failure); C6 nothing financial shown; C8 branch flow; C9 GATED; C11 switch starts OFF, blank columns mean the old behaviour; C12 no backfill; C15 cost 0 AI, 1 text per emergency (2 at most); C17 ensureColumns.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261119-queue-116-p1]** Guided request with emergency catch (Phase 1 of 5). Regression rules:
1. **The server decides "emergency"** (`intakeDecide`): a tenant's tap, or a word from Config `intake_emergency_words` (fixed default when blank, whole words only). Never trust the page.
2. **Row first, text second.** `intakeAfterCreate` re-reads the row; if it does not read back as an emergency NO text goes out and a P0 failure is filed.
3. **The emergency text is the only new message that ignores quiet hours** (`admin_intake_emergency`); one SMS piece, plain ASCII (`intakeAlertText`).
4. **The recheck rides `schedRunSweepWork`.** No new job, no cron. A second text that cannot be sent makes the sweep job fail.
5. **Switch off = today.** `createWorkOrder` ignores `intake` unless `intake_guided_enabled` is TRUE; both pages keep the old form if the flag is off, `intake-flow.js` is missing, or mounting throws (reported through `hubReportFailure`).
6. **`INTAKE_COLS` already exists** for the Buildium intake tab; this feature's list is `GUIDED_INTAKE_COLS`. Do not reuse the short name.
Tests: `test/intake-guided.test.mjs`, `test/intake-flow-i18n.test.mjs`.
