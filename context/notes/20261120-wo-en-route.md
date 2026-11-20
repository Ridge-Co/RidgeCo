# 20261120 wo-en-route: queue #131 Phase 1 of 3, one-tap "On my way" (PR into main, head `feat/wo-en-route`, cut from main tip 010fcd4)

## CURRENT
**Status: built, tested offline, waiting for Brett. GATED (it texts real tenants), so no session merges it.** Phase 1 of 3 done: the one-tap "On my way" button. Phase 2 (day-before reminder, a Hub scheduler job) and Phase 3 (technician name in the schedule text) are NOT built.

- New route `POST /wo/en-route {wo_id, dry_run?}` (`woEnRoute`, worker.js). Admin, or the vendor the work order is assigned to (`vendorWriteScopeDenied` proves it and puts the session's vendor id in the body; another vendor gets 403).
- No second sender: it stamps `En_Route_Sent_At` (additive column via ensureColumns), re-reads it, then calls `scheduleWO` with today + "Within 1 hour" + notify_tenant, so the text goes through `smsGatedSend` exactly like the Schedule box. `scheduleWO` now takes `skip_owner` (the owner is NOT sent a second "scheduled" text) and returns `tenant_results` (one line per tenant: sent, or why not).
- A second tap inside 60 minutes sends nothing and says how many minutes ago. Closed, paid, cancelled, void jobs are refused. A failed stamp write sends nothing and files a failure.
- Buttons: vendor portal job card (inline "Send this text to: <names>" with the exact words, then Send / Cancel; no browser pop-up) and Hub work-order detail (browser confirm, same as that screen's other actions). Spanish strings for the vendor side in vendor-i18n.js.

## Pre-build gate
Shapes: `message` `ui` `endpoint` `role` `write` (the day-before reminder in Phase 2 would add `schedule` `job`). Nobody was available to ask (scheduled run), so every item took its default or the safer option.

Items that are N (known gaps):
- B13 Will it send? Partly. The screen shows the exact text and who would get it, and says so if tenant texts are off for the job. It does NOT yet say before the tap that quiet hours, an opt-out or the property switch will hold it (the brief named `GET /sms/gate-preview`); the real outcome is shown after the send. Follow-up.
- B14 Edit before send: N. Exact text shown, not editable (fixed template).
- B10 Quiet / record-only path: N (the existing Schedule box covers recording a visit without texting).
- B26 Spanish: partly. Vendor-facing labels are Spanish. The tenant text is English (tenant portal has no Spanish layer yet) and a "not sent because ..." reason from the Worker is English.
- B27 Where else will he look: N. Buttons are on the vendor card and the Hub work-order detail only.
- B30 Did they get it and use it: N beyond the existing text log.
- B31 Settings, not constants: N. The 60-minute repeat guard is a constant (`EN_ROUTE_REPEAT_MIN`).
- B1 Edit after create: n/a (nothing created; the stamp is bookkeeping).
- D-16 cost: one text per tap, at most one per job per hour; identical text is also refused for 10 minutes by the sender.

Defaults taken: B9 tenant only (owner skipped on purpose), B11 existing "Within 1 hour" template (one piece, already tested), B12 goes now through the gate (quiet hours still honoured), C11 nothing changes until someone taps, C12 old rows have a blank stamp = never sent.

Companion actions included: double-tap guard (button disabled before any await, plus the server stamp), repeat guard with minutes, closed-job refusal, vendor ownership check, per-tenant outcome shown, verified write before the text, failure rows (`wo_en_route_claim`, `wo_en_route_send`), phone-first 44px button and 44px Send / Cancel.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261120-wo-en-route]** One-tap "On my way" (queue #131 Phase 1). Regression rules:
1. **`/wo/en-route` never calls a sender itself.** It calls `scheduleWO` (within-hour path), which uses `smsGatedSend`. `test/wo-en-route.test.mjs` fails if `woEnRoute` mentions smsGatedSend / sendSMS / twilio.
2. **The owner "scheduled" text must not fire from en-route** (`skip_owner`).
3. **Stamp first, re-read, then text.** A failed stamp write means no text.
4. **Vendor identity comes from the session** (`/wo/en-route` is in `VENDOR_WO_WRITE_PATHS`, so `vendorWriteScopeDenied` sets `vendor_id` and refuses other vendors).
Tests: `test/wo-en-route.test.mjs` (14 checks); `test/vendor-write-scope.test.mjs` extended.
