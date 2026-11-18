# QuickBooks receipt BATCH + reverse-after-send — 2026-11-17 — PRs into staging and main, head `fix/qb-batch-and-reverse-nov17` (cut from main tip 0198b977), merged to main: no
## CURRENT
Built (Brett's Nov 17 answers): receipt emails to QuickBooks are no longer sent at confirm / attach / reassign. They wait in ONE daily batch sent by `schedRunDailyReceiptsPost`
(time = that job's `at` in the HubScheduler.gs JOBS table / schedule override; there is no second clock). The sender pages: at most 5 per call (cap 8, Cloudflare subrequest budget), the job returns
`partial:true` and the scheduler resumes it every 5 minutes until nothing is left; nothing is dropped. `sendReceiptsToQBEmail` only sends with `release:true` (job, `/receipts/send-to-qb-email`,
`/receipts/qb-batch/send-now`); any other caller (e.g. a fixed-price attach) just leaves the row in the batch.
Receipts columns (ensureColumns, rule 174: the sender refuses to run if they cannot be ensured): QB_Batch_Status (blank/ready, held, sending, failed, sent), QB_Batch_Sent_Date, QB_Reversed_Date,
QB_Email_Subject, QB_Batch_Error, QB_Delete_Confirmed, QB_Delete_Confirmed_Date. Blank status = ready (every older unsent row was already waiting for the daily sweep).
Double-send fix: 'sending' + date + subject are written and checked BEFORE the email; the sent flag after. A claimed row is never re-sent by itself (list shows "Stuck sending": Release or "It did go out").
Every failure goes to the failure ledger (P1) AND the response/job error AND the review list.
Reverse after send: `voidConfirmedReceiptForQueueRow` / reassign no longer refuse a sent receipt; Hub side voided as before, QB_Email_Sent history kept, QB_Reversed_Date set, answer carries `qb_delete_needed`
{vendor, amount, receipt_date, hub_receipt_number, email_subject, qb_email_sent_date}. Page shows the red "Delete this in QuickBooks by hand" box with "I deleted it in QuickBooks" (POST /receipts/qb-batch/delete-done);
unticked ones stay in the Waiting list panel. A re-confirm writes a NEW Receipts row, so resend works. Only a receipt in 'sending' is refused.
New endpoints: GET /receipts/qb-batch, POST /receipts/qb-batch/action {receipt_id, action: hold|release|mark_sent}, /receipts/qb-batch/send-now, /receipts/qb-batch/delete-done.
Also: gmailSendEmailWithAttachment now follows the staging stub policy (it would have really sent on staging).
Audit of Receipts readers: all ignore Active=FALSE except `portalEvidenceFromRecords` (counts a vendor-role receipt as evidence the vendor used the portal; left as is on purpose).
## FEATURE_LOG
**[FL-20261117-qb-batch-reverse]** Daily QuickBooks receipt batch (hold / reverse / send now), reverse-after-send with qb_delete_needed, double-send guard. Regression rules: (1) nothing emails a receipt to QuickBooks except
sendReceiptsToQBEmail with release:true; (2) the 'sending' claim is written and verified before the email and a claimed row is never re-sent automatically; (3) a failed send is never swallowed (ledger + answer + screen);
(4) a reversed-after-send receipt keeps QB_Email_Sent and gets QB_Reversed_Date, and a re-confirm must create a NEW Receipts row. Tests: test/qb-batch-and-reverse.test.mjs (67), receipt-expense-path, receipt-recon-reassign-refund-search, receipt-attach-only.

## Pre-build gate
Shapes: `automation` + `money record` (any, plus the standing parameters). Brett's six answers of Nov 17 2026 (batch once a day, review list with Hold / Reverse / Send now, reverse after send, invoices untouched, double-send fix, Active audit) settled the open questions.
- B31 Settings, not constants: the send time is the existing scheduler schedule for `daily_receipts_post` (HubScheduler.gs JOBS `at`), NOT a second Config key (two clocks would disagree). The per-call cap (5, max 8) is a constant tied to the Cloudflare subrequest limit; paging makes the daily volume unlimited, so it is not a setting.
- C1 No texts: none sent. C2 No cron: reuses the existing `daily_receipts_post` job; no new job, no new trigger.
- C3 Nothing fails silently: every failed claim / send / flag write / missing image goes to the failure ledger, the endpoint answer, the daily job result and the review list ("Send failed", "Stuck sending").
- C8 Branch first, PR into staging (test-only) then PR into main, Brett merges; BUILD_VERSION untouched; this is the one notes file.
- C9 GATED: yes, in the sense that it changes how QuickBooks-bound money records move and adds 7 Receipts columns; approved by Brett's written answers. It never writes to QuickBooks (email only; deleting there stays Brett's hand, tracked by the tick box).
- C12 Existing data: rows written before this build have a blank QB_Batch_Status and count as ready, so the existing unsent backlog is simply the first batch. No migration, nothing rewritten.
- C13 Manual steps for Brett: merge the main PR when satisfied; after merge, the first daily run sends the whole waiting backlog in slices of 5; tap "Send batch now" if he wants it earlier. If he wants a different daily time, change `at` for `daily_receipts_post` in the HubScheduler.gs JOBS table.
- C14 Check by hand: open Receipt Reconciler > "Waiting to send to QuickBooks".

## Late requests
Brett's Nov 17 20:06 answers: (1) the first daily send of the whole backlog is fine; (2) the daily QuickBooks send is 12:00 AM (midnight) America/New_York: `daily_receipts_post` `at: '00:00'` in the HubScheduler.gs JOBS table and the Worker registry default (Brett must paste HubScheduler.gs into the Apps Script project and Save; the Apps Script time zone is already America/New_York); (3) voided receipts keep counting as portal evidence in `portalEvidenceFromRecords` (left unchanged on purpose); (4) a customer-card receipt cannot be confirmed without a work order: `receiptReconConfirm` refuses it with 409 code `customer_card_needs_wo` (page, bulk and auto-rule callers all hit it), the card shows a greyed-out Confirm with the reason; attach-only and fixed-price paths are unchanged.
