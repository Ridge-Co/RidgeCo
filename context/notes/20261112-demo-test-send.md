# Demo "send me a test" button: one real-wording text on the prospect's own phone (Nov 12 2026) — PR into main (staging twin listed in the PR), head `feat/demo-test-send-nov12`, merged: no

Phase 3b of the demo owner portal + demo tenant portal (design: Continuous Improvement project doc `claude/demo-owner-portal-design-nov10.md`). Phases 1, 2a, 2b, 3a are live. This is the last phase.

## CURRENT
What is built:
- **Shared wordings.** `SMS_MSG` (pure, next to `smsShort`) now builds the seven texts the button can send. The seven real send sites (owner request received, tenant request received, tenant assigned, tenant scheduled, tenant completed, owner scheduled, owner complete) call it instead of holding the words inline, so the test text IS the real copy and cannot drift. Wording is character-for-character the old wording (golden strings in the test).
- **`GET /demo/test-status` and `POST /demo/test-send {event}`** (`demoTestStatus`, `demoTestSend`). Owner events: `received`, `scheduled`, `complete`. Tenant events: `received`, `assigned`, `scheduled`, `completed`. Texts only; no email. Both routes are in `ROLE_SCOPES.owner` / `.tenant` and refuse everything that is not a DEMO prospect session (real owner/tenant, admin, no token: 403/401; vendor: not in scope, 401).
- **Everything comes from the session.** The body carries only `event`; who, which slot and which phone come from the verified session and the slot's own row (`Is_Demo`, `Demo_Prospect`, matching `Demo_Slot`). Ids/numbers/slot smuggled in the body are ignored. `demoTenantWriteDenied` lets only this one extra path through.
- **Send path.** `smsGatedSend` with `redirectTo` = the prospect's own normalised phone, `bypassQuietHours`, `allowRepeat`, the sample work order `WO-D<slot><nn>` (owner: 01/03/07; tenant: 01/01/03/06), message prefixed `DEMO: ` and ending with a STOP line (the tenant "received" text already carries the tenant STOP note). The assigned text uses a fictional vendor (`Sample Home Services`, (410) 555-0142). The Phase 1 guard (`sendSMSRaw`) then enforces the cap: SMS 2 per test, owner row and tenant row counted separately, counted and read back BEFORE the send.
- **Plain-words outcomes** (`code` + `message`): `sent`, `limit_reached` ("Test limit reached: you have used all 2 of your test texts."), `opted_out` (Twilio 21610, or the tenant row's `SMS_OptOut`), `no_phone`, `no_sample_data`, `held` (guard), `switched_off` (global texting off), `failed` ("did not go through; it may still count toward your test limit": the count is taken before the send, never after). Every attempt writes a `demo_test_send` Ops_Telemetry row (slot, role, event, outcome; no phone number).
- **UI.** `owner.html` and `tenant.html`: `demoBanner(on)` now also builds a panel under the DEMO strip (so only demo logins ever see it): a pick-list of that role's events, "Text me this", a consent line ("By tapping the button you agree to receive up to N demo texts at the number you gave us. Reply STOP to stop. Message and data rates may apply."), "Texts used: n of 2", and "Test limit reached" with the button disabled at the cap. The browser sends only the event name.

Tests: `test/demo-test-send.test.mjs` (64 checks) drives the real worker over a fake sheet, fake Twilio and fake Gmail: the seven wordings equal the old templates; owner 2 texts then limit; tenant counted separately; all seven events fire once each with the right wording; every text of the whole run went only to Ann's or Bo's own phone (never Brett, admin, a real owner/tenant/vendor); Brett's number appears in nothing sent; no email; two active slots stay isolated; real owner/tenant/vendor/admin/no-token refused; unknown event 400; smuggled ids ignored; a demo tenant naming a real tenant/property reaches nobody and a write to a real property is still 403; Twilio STOP and Twilio down give the plain messages and the count is taken before the send; after a reset the old logins are dead (401) and the next prospect in the slot starts at 0 and only their phone is texted; both pages build the panel only from `demoBanner`, carry the consent line and compile. Mutation-checked: aiming the send at another number fails four checks; removing the route's own limit pre-check still holds the cap through the guard. Five older tests that read the old inline wording or rebuild the worker in a sandbox were updated to the shared builders (`tenant-stop-note`, `proposal-netting-instant-fee`, `wo-duplicate`, `demo-hub-screen`, `owner-write-scope`).

NOT verified: nothing has run on the real production sheet or the real Twilio account, and nobody has seen the panel on a phone. First proof = Brett clears and re-adds himself, opens the demo owner portal, taps each event once, and confirms the text arrives on his phone (the cap is 2 per test, so reset before the tenant check if needed).

## Pre-build gate
Shapes: `write` (demo rows' counter only) `route` (2, demo sessions only) `sms` (to the prospect's own number only). No cron, no email, no new table.
- B-items (edit/list/sort/photos): N/A (a button, a pick-list and a counter).
- C5 fail-open vs fail-closed: fails closed. A guard that cannot read the registry, a cap that cannot be read back, a missing phone, a missing sample work order, or any exception means nothing is sent and the person is told in plain words.
- C9 GATED class: yes (messaging + prospect PII). Explicit yes from Brett required; not self-merged.
- C12 existing data: only the slot's own owner/tenant counter and Message_Queue/log rows for sample work orders are written. Real rows are asserted untouched. Real handlers' wording is unchanged (golden strings), only moved into `SMS_MSG`.
- C2 no cron: honoured.
- Scopes: the demo tenant allow-list and both role scopes grow by exactly these paths; `owner-write-scope` classifies `/demo/test-send` as session-bound.
Silent-failure check: every outcome has a code, a message and a telemetry row; the count is read back after the send and shown.

## Known gaps
- Real copy oddity, unchanged on purpose: the tenant "assigned" text formats the vendor phone as `((410) 555-0142)` (double parentheses) because the phone arrives already formatted. The demo shows the real copy, so it shows this too. Worth a separate small fix.
- A sample work order in status New / Assigned may be picked up by scheduler jobs that text about stale work orders; any such text naming a demo work order or fake address is blocked by the Phase 1 guard and logged as `demo_send_blocked`. Watch the first real run.
- The owner "job scheduled" and "job complete" tests use sample work orders on properties/units that are not the demo tenant's own unit (cosmetic).
- Photo upload by the demo tenant stays refused (it would write to real Drive).
- Email is not part of the button (texts only, by Brett's decision); the email cap (5) stays enforced by the guard for any other path.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261112-demo-test-send]** Demo "send me a test" text. `SMS_MSG` builds the seven demo-covered wordings for both the real handlers and the button; `demoTestStatus` / `demoTestSend` (`GET /demo/test-status`, `POST /demo/test-send {event}`) send ONE real-wording text per tap to the prospect's own phone via `smsGatedSend` (`redirectTo`), capped at 2 per test by the Phase 1 guard. Regression rules: (1) never read a phone, slot or id from the request body: take them from the session and the slot's row; (2) a text's wording change goes in `SMS_MSG`, never inline, or the test button drifts from the real copy; (3) the route must refuse any session that is not a demo prospect; (4) the count is taken before the send; (5) keep the panel built only from `demoBanner`.
