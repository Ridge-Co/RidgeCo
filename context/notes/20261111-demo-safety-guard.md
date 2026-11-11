# Demo safety guard: no demo text or email can reach a real person (Nov 11 2026) — PR #(see PR) into main, head `feat/demo-safety-guard-nov11` (cut from main tip 2d0c652), merged: no

Phase 1 of the demo owner portal + demo tenant portal (design: Continuous Improvement project doc `claude/demo-owner-portal-design-nov10.md`). This PR ships ONLY the safety net. It adds no demo data, no slots, no logins and no UI, so on its own it changes nothing for real customers. It does have to be live before anything demo exists.

## CURRENT
Brett's rule (Nov 10): the demo must never text or email a real tenant, vendor, Brett, or a random number. The only real contact anywhere is the prospect's own phone/email, with 2 texts and 5 emails per test (the owner test and the tenant test are counted separately).

What is built (worker.js, one guard block placed before `PORTAL_TAB_BY_TYPE`; hooks at the transport choke points):
- `sendSMSRaw` (the only Twilio Messages POST) asks `demoGuardSend` first. A blocked text is logged to SMS_Logs as `blocked_demo`, returns `demo_blocked`, and Twilio is never called.
- All five Gmail send spots ask `demoGuardEmail` first: `gmailSendEmail`, `gmailSendEmailWithAttachment`, `gmailSendEmailMulti`, `inspSendPartnerEmail` (calendar-invite path), `insbSendMail` (this one THROWS so an invoice mail can never silently vanish). Delegating calls pass `_demoChecked` so one email is counted once.
- `pushSendOne` refuses demo recipients (push is not used in the demo).
- The registry comes from sheet rows flagged `Is_Demo`. Rows flagged `Demo_Prospect`=TRUE hold the one reachable contact; every other demo-row phone/email is "fake" and is never sent to.
- A message is "demo" when it carries a demo WO id (ctx.wo_id, a `WO-####` / `WO#` / `WO ####` in the text, a WO on a demo property) or a demo property address. Demo messages may only go to the prospect, inside the cap and before the `Demo_Expires` date. Anything else is blocked, including a text to Brett about a demo WO.
- Counters `Demo_SMS_Count` / `Demo_Email_Count` live on the owner row and the tenant row, so the two tests are separate. `recipientType` tags the tenant/owner call sites; if an untagged send hits a prospect, the entry closest to its cap is charged (conservative).
- Expiry: `Demo_Expires` blank = login clock not started; an unparseable value counts as expired.
- Fails closed: if the registry cannot be read, the message is held back and the reason is logged. Only a text to Brett's own number is exempt from that.
- Every block is recorded: Ops_Telemetry `demo_send_blocked` (phone numbers masked, none in Notes) and SMS_Logs `blocked_demo`. A queue send that hits a block ends as `skipped` / `blocked_demo`, never a P0 alert.
- With no `Is_Demo` rows anywhere the guard is a no-op, so production behaves exactly as before today.

Tests: `test/demo-guard.test.mjs` (45 checks) drives the real worker over a fake Sheets/Twilio/Gmail: decision table, owner test 2 texts then "test limit" with Twilio called exactly twice, tenant test counted separately, fake-number demo tenant never texted, text to Brett about a demo WO blocked while a real-WO alert still goes out, tenant emails capped at 5, second prospect keeps a full allowance, expired login refused, telemetry rows present, and static tripwires (every Gmail send path guarded, exactly one Twilio POST, no swallowing catch in the guard). Six existing isolated-harness tests got a one-line stub for the new function (`_d16-support`, `wo-split`, `wo-combine`, `wo-duplicate`, `insp-billing`) plus a wider regex window in `insp-booking`; their assertions are unchanged.

NOT verified: nothing here has been run on staging, which stubs all SMS/Gmail/push anyway; real texts only exist in production, so the production proof is the unit tests plus the first slot test in Phase 2 using Brett's own phone. Class C (GATED: real customer text path, PII). Needs Brett's explicit yes to merge.

Checklist (BRANCH_POLICY): PR into `main`, head `feat/demo-safety-guard-nov11`; staging twin PR listed separately; BUILD_VERSION not touched.

## Pre-build gate
Shapes: `message` `external` `write` `endpoint`.
- B-items about screens (edit after create, list, sort, photos): N, no UI in this PR (Phase 2/3).
- C5 fail-open vs fail-closed: fail CLOSED for demo traffic, on purpose (Brett's hard rule). Exception: a text to Brett's own number is not held back by a registry read failure.
- C9 GATED class: yes (real customer text path, PII). Explicit yes from Brett required; not self-merged.
- C12 existing data: no rows are changed; no backfill. With no `Is_Demo` rows the guard does nothing.
- C17 columns: the guard only reads `Is_Demo`, `Demo_Prospect`, `Demo_Slot`, `Demo_Expires`, `Demo_SMS_Count`, `Demo_Email_Count` by header name; a missing column reads as blank. The columns are added by Phase 2 through `ensureColumns` (never `ensureTab` on live sheets). The counter is bumped with `updateRowVerified` and read back BEFORE the send, so a failed bump blocks the send (fail closed).
- C2 no cron: n/a here; the expiry sweep in Phase 2 is a SCHED_JOBS entry plus an Apps Script row.
Companion actions included: block log in telemetry and SMS_Logs, calm `skipped` queue outcome, loud failure for invoice mail, static tripwire tests so a future new send path cannot bypass the guard unnoticed.

## Known gaps
- Phase 2 (demo slots pool of 3, "add demo prospect" and "convert to real owner" in the Hub, 10-day clock from first login, shared-PIN exemption, wipe on convert/expiry, DEMO banner) and Phase 3 (test-notification button with consent line, fake data/photos/fictional receipt) are separate PRs.
- Tenant and vendor session write scope has the same kind of gap #529 closed for owners; separate follow-up.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261111-demo-safety-guard]** Transport-level demo safety guard (`demoGuardSend`, `demoGuardEmail`, `pushSendOne` refusal). Regression rules: (1) every outbound text goes through `sendSMSRaw`, and every Gmail send function calls `demoGuardEmail`; a new send path must do the same (tripwire tests enforce it). (2) A demo-tagged message may only reach a `Demo_Prospect` contact, inside 2 texts / 5 emails per test, owner and tenant counted separately, before `Demo_Expires`. (3) The guard fails closed. (4) A demo block is `skipped` / `blocked_demo`, never a P0. (5) `insbSendMail` throws on a block so invoice mail never disappears silently. Tests: `test/demo-guard.test.mjs`.
