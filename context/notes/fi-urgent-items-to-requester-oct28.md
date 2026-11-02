# Field inspection: urgent items to the requester ahead of the report (Oct 28, 2026)
Branch feat/fi-urgent-send-oct28, PR #463. (Proposed FEATURE_LOG rule; renumber at merge if it collides.)

## What Brett asked for
Email the booking requester (e.g. Josiah) about urgent findings (major safety issues) ahead of the inspection report. Brett types one issue per line plus photos and taps which items each photo belongs to. Items are created in the report if missing. Reverse flow: a per-item "Send to <requester>" toggle, a banner listing unsent flagged items, one email per property, sent from the inspection page independent of finishing. Email is default; optional text only inside 9am-4pm Eastern (email only outside, nothing queued). Sent items are marked in the app only; the public report never mentions them. Every email is copied to brett@bmoremanagement.com.

## Rules (do not break)
1. `POST /fi/urgent-send` is preview-first. Items come from the saved inspection, never from the request. The rev must match. Invalid item ids return 400 `bad_items`.
2. Idempotency: `send_key` plus a content hash; log id `ug_<send_key>_<hash of sorted item ids>`. A `sending:<nonce>` claim row is written then re-read (first row wins); a loser gets 409 `in_progress` and its row becomes `duplicate-blocked`.
3. Up to 6 photos are pulled from Drive and attached by `gmailSendEmailMulti` (attachment extension follows mime).
4. Text goes through `sendSMS` only inside 9am-4pm America/New_York and only after the email succeeded. The text body is a pointer to the email (street only).
5. `flag_send` and `sent` are phone-only. `fiScrubDocForReport` deletes them from the public report; `fiOnlyPhoneMarksChanged` keeps a published report published when only those marks change.
6. Staging write gate allows only `TEST-` inspection ids; staging stubs Gmail and SMS.

## Known limits
Trade is a keyword guess (default General). No per-item server-side "sent" record, so a lost response plus closing and reopening the sheet could double-email (Brett is copied on every email). Real photo attachment is untestable on staging. A backdrop tap discards typed text. A deleted-photo id gives a permanent "not finished uploading".

## Tests
test/fi-urgent-send.test.mjs (85 assertions), test/manual-verify-fi-urgent-ui.mjs (11 Playwright scenarios at 390px, no manual blur), guard and route wiring in test/fi-field-inspection.test.mjs, btoa tripwire baseline 14 to 15. Independent review found three issues (tap swallowed by blur re-render, send_key not bound to items, non-atomic idempotency); all fixed with tests.
