# STR Cleaning Scheduler — Milam Ridge — Build Brief v1.0 (Oct 14, 2026)

Status (Oct 14 2026, 2:50 pm ET): **LIVE on prod in test mode** (build `2026-10-14.21-str-next-guest-note`). Scheduler ON, Texts ON, Cleaning test mode ON, calendar sync OFF (not built), Mon/Wed/Fri email OFF. Everything ships OFF by default. Brett's rule: test mode first.
Owner request (Oct 13–14, 2026): keep every Milam Ridge (1864 Kerns School Rd, Springfield WV) turnover covered for the next
30+ days, by texting a preferred cleaner queue one at a time, with Brett told loudly when coverage is at risk.

## What it does

1. **Reads** the guest bookings feed (Uplisting iCal / Google calendar, the same `STR_GUARD_BOOKING_SOURCES` the inspection guard uses)
   and builds **turnovers**: a *checkout* clean after every checkout, plus a *pre-arrival* clean the day before the next guest when the gap
   to the next booking is longer than `STR_PREARRIVAL_GAP_DAYS` (default 3; 0 turns pre-arrival cleans off). Lookahead 35 days.
2. **Offers** each open turnover to the cleaners in the pool, in Priority order (Gina → Kayla → Rachel), **one at a time**. A cleaner is
   skipped when inactive, no phone, texts opted out, marked **out** for that date, or already declined / didn't answer that turnover.
   Nobody is asked about more than `STR_MAX_PENDING_PER_CLEANER` (2) turnovers at once, nearest date first.
3. **Reply windows** (Brett, Oct 14): overnight (next 8 AM ET, at least 10 h away) when more than 5 days out; 4 hours inside 5 days;
   2 hours inside 3 days. Offers only go out 8 AM–9 PM ET. An offer that expires is *not* withdrawn: the cleaner can still accept
   until someone else has the slot.
4. **Cleaner link page** (`cleaner.html?k=TOKEN`, no login): pending offers with Take it / Pass buttons, the schedule of all upcoming
   turnovers (covered / needs a cleaner), per-date **Available as backup / Out** marks (changeable any time), Cancel for dates they hold,
   an "Add to calendar" (.ics) link. Supplies / checklists / recurring tasks / guest-condition report are shown as "coming soon".
5. **Accept** assigns the turnover (re-read to detect a simultaneous grab), texts + emails the cleaner a confirmation with a calendar
   invite, and sends the **slot-filled** message to every other cleaner who was asked and didn't get it (polite, direct, asks them to be the
   backup; parked until 8 AM if it would land outside the window).
6. **Cleaning calendar** ("TURNOVER COVERAGE MILAM RIDGE", `STR_GUARD_CLEANING_CAL`): all-day **"<Name> Cleaning"** for assigned turnovers and a
   red **7 AM–7 PM "BOOKING NOT COVERED FOR CLEANING"** block on uncovered turnovers within `STR_RED_BLOCK_DAYS` (14). Events the Hub writes carry
   `ridgecoStr` extended properties, so it only ever edits its own events; a "Kayla Cleaning" Brett types by hand counts as coverage.
   The existing inspection guard ignores the red block (`inspStrCleaningKind` now skips "not covered / uncovered / backup").
7. **Brett alerts** (SMS + email + admin banner + the red calendar block), table-driven in `STR_Alerts`:
   - turnover **uncovered inside `STR_ALERT_DAYS` (5)** days: sent immediately, repeats every 6 h (3 h inside 2 days) until covered or acked,
     re-sent at once when the queue is exhausted or it becomes urgent; a "Good news: covered" message follows;
   - **cleaner cancels** an assigned turnover: immediate, with the backup picture (who is marked available / out);
   - **availability change** within `STR_MARK_ALERT_DAYS` (5) of a turnover: immediate, flags "NO BACKUP AVAILABLE";
   - system failures (feed unreadable, calendar write failed, text failed, feed returned zero stays, stuck offer): telemetry row `Success=FALSE` + throttled SMS/email.
   Brett's SMS holds until 7 AM–10 PM ET unless the turnover is 1 day out or closer.
8. **Checkout-day text** to the assigned cleaner (11 AM ET; 9 AM for pre-arrival): link + whether/when the next guest arrives. Claim-first, sent once.
9. **Email digest** Mon/Wed/Fri 8 AM ET (replaces the Make.com "3x Weekly Cleaning Email"): inline calendar table, clickable per-date links,
   covered / NOT COVERED labels, `.ics` attached with the dates the recipient holds or marked backup; copy to Brett.

## Switches (Config keys; admin page `str-cleaning.html` edits them)

| Key | Default | Meaning |
|---|---|---|
| `STR_ENGINE_ENABLED` | FALSE | Whole engine (offers, alerts, assignments). FALSE = idle; "Run now (preview)" still works. |
| `STR_SMS_ENABLED` | FALSE | Texts to cleaners. FALSE = nothing texted; the board shows who would be asked next. Still goes through `smsGatedSend` (global `TWILIO_ENABLED`, `TWILIO_TEST_MODE` → Brett's phone). |
| `STR_SMS_TEST_MODE` | **TRUE** (blank = TRUE) | Cleaning-only test mode (PR #285, Oct 14). While TRUE every cleaning text goes to Brett's test phone (`TWILIO_TEST_RECIPIENT`) as `[TEST - for <name>] ...`, whatever the global `TWILIO_TEST_MODE` says, so the scheduler can be tested live without redirecting other Hub texts. Set FALSE (board switch, red confirm) only to go live. An invalid test phone blocks the send (fails closed). |
| `STR_CAL_WRITE_ENABLED` | FALSE | Hub writes the cleaning calendar. FALSE = plan only. Needs the service account to have "Make changes to events" on that calendar. |
| `STR_DIGEST_ENABLED` | FALSE | Mon/Wed/Fri cleaning email. |
| `STR_ALERT_DAYS` 7 · `STR_LOOKAHEAD_DAYS` 35 · `STR_RED_BLOCK_DAYS` 14 · `STR_REPLY_4H_DAYS` 5 · `STR_REPLY_2H_DAYS` 3 · `STR_ALERT_REPEAT_HOURS` 6 · `STR_MARK_ALERT_DAYS` 5 · `STR_PREARRIVAL_GAP_DAYS` 3 · `STR_MAX_PENDING_PER_CLEANER` 2 | | tuning |

Rollout order: (1) add cleaners on the board (creates Vendors rows: Trade "Short-Term Rental Cleaner", Service_Area "Milam Ridge"); (2) "Run now (preview)";
(3) `STR_ENGINE_ENABLED` TRUE with SMS off → alerts + board only; (4) `STR_SMS_ENABLED` TRUE while `STR_SMS_TEST_MODE` is TRUE (the default; global `TWILIO_TEST_MODE` can stay FALSE) → every cleaner text goes to Brett's phone
with the real link, so he can tap Take it as "Gina"; (5) `STR_CAL_WRITE_ENABLED`; (6) `STR_DIGEST_ENABLED` and turn off the Make.com email; (7) `STR_SMS_TEST_MODE` FALSE (go live; the board asks for a red confirmation).

## Data (Google Sheets tabs, self-provisioned by `strEnsureTabs`)

`STR_Cleaners` (ID, Vendor_ID, Name, Nickname, Language, Link_Token, Active, Digest, Created_Date — phone/email live on the **Vendors** row),
`STR_Cleaner_Pool` (Property_Key `milam-ridge`, Cleaner_ID, Priority, Active — a future second property or area adds pool rows),
`STR_Availability` (Cleaner_ID, Property_Key, Date, Mark can|out|blank, Updated_At, Source),
`STR_Turnovers` (Task_Key `milam-ridge|checkout|2026-10-21`, Kind, Date, Win_Start/End, Next_Arrival, Guests, Status open|offering|exhausted|covered|ext_covered|cancelled, Assigned_Cleaner_ID, Assigned_Via, Missing_Count, Checkout_Text_Sent, Note),
`STR_Offers` (Task_Key, Cleaner_ID, Round, Created_At, Sent_At, Deadline_At, Status queued|pending|accepted|declined|expired|superseded|failed|cancelled, Queue_ID, Mode, Responded_At, Note),
`STR_Log` (audit), `STR_Alerts` (Alert_Key, Kind uncovered|cancel|mark|event|info, Severity, Message, Sms_Text, Send_Count, Next_Send_At, Resolved_At, Acked_At).
Vendors gains `Service_Area`.

## Safety design (NOTHING FAILS SILENTLY)

- Every Sheets write is re-read (`strSetRow` / `strAddRows`); an unchanged cell throws `write_not_landed`.
- Offer rows are **claimed `queued` before the text is sent**; a stale `queued` row alerts Brett and is never auto-resent. A duplicate claim by a concurrent run backs off.
- Booking removed from the feed is cancelled only after **two consecutive** misses; a feed with zero stays while turnovers exist cancels nothing and alerts.
- Public handlers verify the cleaner's own random token; responses never include another cleaner's phone or email. A real handler failure alerts Brett (the old inspection "Brett has been notified" text was not true; this one is).
- Calendar events are only edited if they carry `ridgecoStr`; ≤30 calendar operations per tick; failures go to `errors` + an alert.
- `str_cleaning` is a scheduler job (Apps Script clock) — **no cron**. The Apps Script `JOBS` table in `HubScheduler.gs` gained 4 rows (`str_cleaning`, `str_digest_mon/wed/fri`); until Brett re-pastes it the Hub runs them on its built-in schedule.

## API contract

Admin endpoints need the normal admin auth. Public endpoints (`/str/c/*`) are token-gated by `k`.

Public (JSON unless noted; errors `{ok:false,error,message}`; bad token → 404 `bad_link`):
- `GET /str/c/page?k=&offer=&backup=YYYY-MM-DD` → `{ok, cleaner:{name,first,language}, property, today, tasks:[{key,kind:'checkout'|'prearrival',date,label,kind_label,next_arrival,next_label,days_out,covered,covered_by,mine,can_cancel,my_mark:'can'|'out'|''}], offers:[{id,task_key,date,label,next_label,deadline,late}], backup_prompt:{date,label}|null, ics_url, coming_soon:[…]}`
- `POST /str/c/offer {k, offer_id, action:'accept'|'decline'}` → `{ok, result:'accepted'|'declined'|'filled'|'already'|'already_yours'|'cancelled', message, backup_date?, warnings?}` — `filled` means someone else has it; show `message` and a "Yes, backup / No" pair for `backup_date`.
- `POST /str/c/mark {k, marks:[{date, mark:'can'|'out'|''}]}` → `{ok, saved, notified, warnings}`; 409 `assigned` when marking out a date they hold.
- `POST /str/c/cancel {k, task_key}` → `{ok, message, days_out, warnings}`.
- `GET /str/c/ics?k=` → `text/calendar` (assigned + backup dates).

Admin:
- `GET /str/admin/state` → `{ok, build, today, settings:{engine,sms,cal_write,digest,alert_days,lookahead_days,red_block_days,reply_4h_days,reply_2h_days,alert_repeat_hours,mark_alert_days,prearrival_gap_days,max_pending_per_cleaner,twilio_enabled,twilio_test_mode,cleaning_cal_set,bookings_set,assistant,label}, feed_ok, feed_error, cleaners:[{id,vendor_id,name,nickname,phone,email,language,active,digest,sms_ok,priority,in_pool,link}], tasks:[{key,kind,date,label,days_out,next_arrival,next_label,guests,status:'new'|'open'|'offering'|'exhausted'|'covered'|'on_calendar'|'cancelled',covered,via,assigned_id,assigned_name,note,checkout_text,offers:[{id,cleaner,status,sent_at,deadline,note}],backups:{can:[],out:[],unknown:[]},uncovered_alert}], alerts:[{id,kind,severity,message,sent,last_sent,acked,created}], log:[{time,task,cleaner,event,detail}], coming_soon}`
- `POST /str/admin/cleaner/save {id?, name, nickname, phone, email, language:'en'|'es', priority, active, digest, in_pool}` → `{ok, cleaner}` (creates the Vendors row + link for a new cleaner).
- `POST /str/admin/cleaner/new-link {id}` → `{ok, cleaner}` (old link stops working).
- `POST /str/admin/config {values:{KEY:'TRUE'|n}}` → `{ok, settings}` (allow-listed keys only).
- `POST /str/admin/assign {task_key, cleaner_id}` (`''` = unassign) → `{ok, warnings, texts, email, filled}`.
- `POST /str/admin/offer-now {task_key, restart?}` → `{ok, result:{action,...}, errors, warnings}`.
- `POST /str/admin/alert/ack {id}` · `POST /str/admin/run {dry}` → `{ok, dry, errors, warnings, detail}` · `GET /str/admin/preview-messages` → `{ok, previews:[{type,text,length}]}` · `POST /str/admin/digest-run {dry}`.

Contract details the first draft left out (found by the page builders):
- `offers[].deadline` is an ISO timestamp (UTC); the page shows it in ET and hides it when `late` is true. Offers carry no `kind`; the page looks the task up in `tasks` to say "pre-arrival clean".
- `coming_soon` is an array of plain strings.
- Tasks with `status:'new'` (admin state) have no stored row yet, so `/assign` and `/offer-now` would return `not_found`; the admin page hides those actions.
- `/offer-now` supersedes any offer still pending (the cleaner currently asked loses it). `/run` and `/digest-run` return HTTP 200 with `ok:false` plus `errors[]` when something went wrong; the page shows those as results.

## Admin SWAP and BULK changes (Oct 20 2026, BUILD_VERSION `2026-10-20.15-str-swap-bulk-pending`, FEATURE_LOG rule 225)
- **Apply is STAGED and RESUMABLE (found live on staging):** one Worker call may make only ~50 subrequests (Sheets, Calendar, Twilio, Gmail), and the first single-shot apply died with "Too many subrequests". Apply now runs stages `sheets, audit, calendar, queue, send, email, alerts, finish` (`STR_SUB_LIMIT` 40; `strRoom`/`strSubUsed` count Sheets, calendar and `ctx.subX` calls). Progress is saved on the `STR_Changes` row (`Stage`, `Payload`, `State`). `POST /str/admin/change/apply` returns `status:'applying'` (with `stage`, `step`, `steps`, `message`) until done; the page keeps calling it with `{plan_id, resume:true}` and shows a Continue button if the job is interrupted. A repeat call without `resume` returns a replay (nothing is sent twice). The scheduler tick flags a job unfinished for more than 10 minutes (`change_unfinished` alert); `/str/admin/state` exposes `unfinished_changes`. Texts are lined up in `STR_Outbox` (now with a `Msg_Type` column) and sent claim-first. Any future multi-step endpoint must follow the same pattern, and the in-memory test harness needs a subrequest cost model to catch this offline.
- **Calendar writing already existed** (`strCalFetch`, `strReadCleaningCal`, `inspClassifyCalError` code `calendar_no_write_permission`); the swap adds its own delete/patch/create ops with re-read verification (max 90 ops, stops after the first permission refusal). Needs the service account maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com to have "Make changes to events" on "TURNOVER COVERAGE MILAM RIDGE" AND Config `STR_CAL_WRITE_ENABLED` = TRUE (page: Switches > Cleaning calendar).
- `POST /str/admin/change/preview {action:'swap'|'assign_range'|'mark', cleaner_id, task_keys[] | from,to | dates[], mark?, confirm_out?}` writes and sends nothing; returns `{ok, plan_id, sig, window_open, send_mode, items[], counts, recipients[{key,name,kind,dates,text,channel,can_send,reason,send_default,timing}], calendar{mode,note,manual[]}, email, warnings[], confirm}`. Errors: `bad_action`, `cleaner_required`, `cleaner_not_found`, `no_dates`, `too_many` (cap 40), `bad_range` (120 days), `feed_unreadable`.
- `POST /str/admin/change/apply` takes the same body plus `plan_id`, `sig`, `texts:{key:{send,body}}`. Returns `{ok, status:'applying'|'done'|'partial'|'failed', counts{done,skipped,failed}, items[], texts[{status sent|held|failed|not_sent}], calendar{status done|failed|not_changed, code, message, manual[]}, errors[], warnings[], summary, duplicate?}`. 409 `stale_preview`, `texts_missing`, `texts_unknown`, `text_empty`, `text_too_long`, `bad_plan`. A resume call must carry `plan_id` and `resume:true` (on staging the write guard also needs `cleaner_id` and `action` in the body).
- New tabs: `STR_Outbox` (texts held until 8 AM ET, drained by `strOutboxDrain` from `strTick`; no cron) and `STR_Changes` (one row per plan, the idempotency claim). New templates: `str_assigned_multi`, `str_swapped_backup`, `str_swapped_backup_multi`, `str_admin_marked`. `/str/admin/state` adds `parked_texts` and `unfinished_changes`.
- Backup mark Source values: `admin_swap` (previous holder after a swap) and `admin` (admin-set marks). NOT built: Uplisting date blocking (roadmap item 10) and the Phase 2 backup drip.

## Pending cleaning - ask about a date that is not booked (Oct 20 2026, BUILD_VERSION `2026-10-20.15-str-swap-bulk-pending`, FEATURE_LOG rule 226; same PR as swap/bulk, originally stacked on PR #382)
- **Flow:** Admin "Ask about a date" (date + internal note) -> `POST /str/admin/pending/preview` (nothing written; queue order, exact text, send window, warnings, `sig`) -> `POST /str/admin/pending/create {date,note,sig,text,send_now}` -> offer to the first cleaner in queue order (Gina, Kayla, Rachel), one at a time. Cleaner page shows "NOT BOOKED YET - tentative" with "Yes, I'd be available" / "No". Yes = `pending_held` + `str_pending_yes` text + immediate Brett alert. All other cleaners see the date as "Pending - not booked" with the normal Available-as-backup / Out marks; a held cleaner who cancels triggers the existing staged backup promotion.
- **Rows:** `STR_Turnovers` Kind `pending`; statuses `open, offering, exhausted, pending_held, pending_converted, pending_expired, pending_cancelled`; new columns `Pending, Pending_Note, Pending_Text, Pending_Mail, Pending_Cal, Pending_Body, Converted_To, Manual_Until`. Follow-ups use claim-first markers (`due`, `sending:ISO`, `sent:ISO`, `failed:n`, `skipped:...`).
- **Match rule:** a real `checkout` turnover on the EXACT date, currently in the feed (or protected by `Manual_Until`). Adjacent-day bookings or a prearrival on that date only alert Brett (`padj|`). Holder becomes assigned, gets `str_pending_booked` + invite; passers are not texted.
- **Routes:** `/str/admin/pending/preview|create|cancel|convert|send-now`; `cancel {task_key, preview?, notify?, text?}`; `convert {task_key}` = "Mark as booked now". `/str/admin/state` adds `pending[]`; `/str/c/page` adds `pending[]`; `/str/c/offer` and `/str/c/cancel` branch on pending keys. New templates: `str_pending_offer`, `str_pending_yes`, `str_pending_booked`, `str_pending_cancelled`.
- **Alerts:** kind `pending`, keys `pyes|`, `pnone|`, `prel|`, `pconf|`, `padj|`; quiet-hours exempt; one-shot.

## Live staging test (Oct 14 2026)
Passed on `maintenance-hub-staging`: tab self-provisioning, TEST- cleaner create (3), cleaner page, marks (persisted, logged), admin assign (text blocked loudly when Twilio is globally OFF, email stub ok), cleaner cancel (urgent + not-covered alerts with backup picture, offer row marked cancelled), dry tick, twilio-off pause (loud, telemetry row), both pages at 412 and 1280 with no horizontal scroll.
NOT live-tested: the round-robin offer loop itself (offer, decline, expire, accept, filled text), because staging has Twilio switched OFF globally and the test token is not allowed to switch it on. It is covered by 117 offline tests. First real check after merge: turn the switches on in the documented order with Twilio test mode ON (texts go to Brett's phone only).
Known limit: Google Sheets read quota is per minute for the whole Hub. The public cleaner page now reuses the ~6s tab cache so a burst of link opens cannot burn it.

## Live rollout log (Oct 14 2026)

- **Turned on** (Scheduler + Texts, test mode ON). No texts at first: the daily self-test (`sweep_checks`) hung every tick, kept its claim and returned no `more`, so the Apps Script loop stopped before `insp_guard` / `str_cleaning`. Fixed by the dispatcher change (a timed-out job releases its claim and signals `more`) and by running the self-test in slices (FEATURE_LOG 214, PRs #295/#298); the canary fixture/trigger fix is PR #297. Brett switched `sweep_checks` off and on by hand in the Apps Script JOBS table (the permission system blocks me from editing the live script).
- **First live tick:** 7 turnovers (Oct 16 – Nov 3) were already on the cleaning calendar (Gina/Kayla), so they became `ext_covered` with no offers; Nov 8, Nov 11/12 pre-arrival and Nov 15 were open.
- **Tick time budget** (FEATURE_LOG 215): cron Sheets reads are paced 2.5 s apart and every write is re-read, so one offer costs ~25 s and the tick was killed mid-write. Past 40 s the tick stops starting new coverage/offer work; past 62 s it skips the checkout-text and alert checks; everything deferred is a warning + `detail.deferred` + `detail.elapsed_ms`, and the next tick finishes it.
- **Next-guest wording:** when the next guest is more than 1 day after the clean, every text/email/calendar note/page says "(subject to change with new bookings)" (`strNextDate`); same-day and next-day stay flat.
- **Brett's phone test passed:** `[TEST - for Gina]` offer for Nov 8 -> accepted -> turnover `covered` (via offer); the Nov 11/12 pre-arrival offer -> declined -> Kayla asked at once.
- **Open:** `sweep_work` fails every tick because scopes 4 and 6 (WO-1180, WO-1183) have no deposit invoice (Brett's call: create the invoices or exclude); two near-simultaneous cleaner taps wrote two STR_Log rows with the same ID (read-max+1; cosmetic, fix queued); first `Selftest_Results` row should appear once the sliced self-test finishes; calendar sync, Mon/Wed/Fri digest and going live (test mode OFF, Brett's approval) are still ahead.

## Live rollout log (Oct 15 2026) — WENT LIVE

- **Test mode turned OFF ~4:00 pm ET** (`STR_SMS_TEST_MODE` = FALSE via the board's red confirmation, Brett's explicit request). Cleaning texts now go to the real cleaners. Brett's rule: no test messages to anyone; every text must be for a real need.
- **Friday Oct 16 verified covered by Gina** (`on_calendar`, via the hand-typed "Gina Cleaning" entry) before the switch; no offers out for it.
- **Test-era offer state reset.** The Nov 11 pre-arrival and Nov 15 checkout queues still held decline/expiry/pending rows that came from Brett's test taps (texts went to his phone only). Both were reset with the board's "Restart the queue": old offers marked `superseded` (silent, no texts to Kayla or Rachel), Gina asked first with a real text (offers 7 and 8, reply by Fri Oct 16 8 AM ET).
- **Deleted the recurring "Kayla N/A" series** (Mon-Fri) from TURNOVER COVERAGE MILAM RIDGE. Brett: those were Kayla's *base* availability and she has repeatedly taken jobs on those days, so she is always asked. "Kayla Cleaning" coverage entries, "Michele N/A" and Gina's "Gina Not Available" entries were left alone.
- **Calendar policy (Brett):** the cleaning calendar should show *actual responses* going forward ("X said not available on this date"), not base availability. Gina's "Not Available" entries are real responses she gave him and stand as if she had responded.
- Correction to earlier notes: overnight-window offer deadlines are Fri 8:00 AM ET (12:00 UTC), not noon ET.

## Backup promotion + staged backups (Brett, Oct 16 2026) — design LOCKED; Phase 1 BUILT (PR pending), Phase 2 NOT built

Internal jargon only (never in a cleaner text): **primary** = the cleaner doing the clean; **backup 1 / backup 2** = staged fallbacks. Goal: every turnover out to the 35-day horizon has one primary + two backups (the 3-person pool exactly: Gina primary -> Kayla, Rachel; Rachel stays #3 for now, Brett handles her personally because she is a neighbor).

**Phase 1 (built, branch `feat/str-backup-promotion-oct16`, BUILD_VERSION `2026-10-16.01-str-backup-promotion`)**
- New text `str_promote` (also seeded in Message_Templates): "...The {DateShort} turnover at {Property} still needs a cleaner. Can you still cover it? ..." Friendly confirm, no rank words, decline = next in line.
- `strNextCleaner`: the FIRST ask is always queue order. Once anyone has been asked and passed / cancelled / not replied, a cleaner who marked `can` (volunteered backup) for that date is asked before one who never answered (queue order inside each group). Returns `staged`.
- A staged ask is a **promotion**: sends `str_promote`, ignores the 2-pending cap, is sent immediately even outside 8 AM-9 PM (offer row Note `promotion`), and raises a `promote` alert to Brett ("HANDOFF: Kayla was asked to cover Fri, Nov 20 ... - Gina passed") that is exempt from his 7 AM-10 PM quiet hours.
- Non-staged next cleaners keep the normal offer text and the normal send-window / cap rules.

**Phase 2 (design agreed, NOT built; behind `STR_BACKUP_DRIP_ENABLED`, default FALSE, with a dry-run preview of exact texts and order before anything real is sent)**
- Backup asks go on every turnover, **closest date first** out to the 35-day horizon, **at most one backup ask per cleaner per day** (~9 AM ET default), one at a time: Gina primary -> ask Kayla; if she declines or is silent 48h (stays answerable) -> Rachel. Backup 2 is asked after backup 1 says yes. If Kayla marks 2-3 dates out at once, Rachel gets ONE grouped text for those dates.
- Catch-up is about 10-12 days from today's state; afterwards the drip only handles new bookings and changes. New booking primary requests and cancellations still go out immediately; the daily backup slot goes to the soonest date; nothing is dropped, only re-timed.
- **Combined message (Brett, Oct 16):** when a primary/promotion text is going to a cleaner and that cleaner is also due their daily backup ask, ONE text carries both ("Can you cover Oct 31? Also, could you be our backup for Nov 3?"). The page already renders an offer card plus a `backup=DATE` prompt together, so the link carries `offer=ID&backup=DATE`; each is answered separately. Works both directions, including promotions. The combined backup ask uses up that day's backup ask for that cleaner; only one backup date rides along (grouped case excepted); never the same date as the primary request; nothing urgent is ever held for it; the existing slot-filled text counts as a backup ask; backup asks sit outside the pending-offer cap.
- Interim: until Phase 2, only Phase 1 behavior exists; backups arrive through the existing slot-filled text and the page's "Available as backup" marks.

## Backlog items added Oct 15 (logged, NOT built)

See roadmap items 8-10 below.

## Roadmap — logged, NOT built (room is reserved; the cleaner page already has a "coming soon" strip)

Scheduling was by far the priority. From Brett's Oct 14 message, to build later on the same token page and the same `STR_*` sheet family:
1. **Supplies requests** — dropdown seeded from Gina's past texts + custom items; request goes to Brett (and a shopping list).
2. **Checklists** — per-turnover cleaning checklist templates.
3. **Recurring tasks** with reset-on-done (e.g. monthly fridge clean), shown on the page and in the digest email.
4. **Seam battery triggers** — lock battery below ~35–37% creates a "change batteries" task, with a stay-length rule so it isn't scheduled mid-stay.
5. **Deep-clean rotation** — kitchen → bathrooms → bedrooms, one per turnover window.
6. **5-star guest-condition report** (1 absolutely terrible … 5 excellent) with a short checklist and photos, **internal only**.
7. **Make.com migration**: retire the 3x weekly email once `STR_DIGEST_ENABLED` has run clean for a week.
8. **Calendar shows actual responses (Brett, Oct 15).** When a cleaner says she is not available for a date (marks Out on the page, or declines for that date), the Hub writes an all-day "<Name> Not Available" event to TURNOVER COVERAGE MILAM RIDGE (needs `STR_CAL_WRITE_ENABLED`; Hub-written events carry `ridgecoStr`). No base-availability entries (the Kayla N/A series was deleted Oct 15 because she regularly takes jobs on those days; she is always asked).
9. **Honor hand-typed "Gina Not Available" entries (Brett, Oct 15).** They are real dates she told Brett, so the Hub should treat them as if she had responded Out (today the Hub does not read them; admin state shows every cleaner as "hasn't said"). Brett: she can still be sent a message as a backup. Design question to confirm when building: ask her anyway as "backup only" on those dates (my reading), or skip her entirely.
10. **Day-after cleaning fallback + check-in blocking (Brett, Oct 15; needs research and a test before building).**
    - Today an uncovered checkout day is "uncovered". Add a check of the bookings feed: if the next guest arrives at least a day after checkout (e.g. checkout Monday, next arrival Tuesday), a Tuesday-morning clean still works, so nobody being available Monday does not mean the turnover is uncovered. Offer the day-after window (or ask for it) before alerting.
    - But the open gap day must not allow a single-night instant booking that lands on a day we know has no cleaning coverage. Block check-ins on that uncovered day. Research: can this be done through Uplisting (blocked dates, min-stay or check-in restrictions via API/MCP) or only with a simple calendar entry? The Uplisting feed is iCal read-only (calendar blocking was previously "out of scope"), so test with one real date before building.
Open questions with defaults used: Gina = Regina Seville; Sierra is not in the pool (add her with "in queue" off to get the email only); a cleaner pre-marked "available" is **not** auto-assigned
(marks mean backup only); alert threshold 5 days (Brett said both 7 and 5 — 5 stuck, configurable); Uplisting calendar blocking is out of scope.

## Files

`worker.js` (STR-BLOCK-BEGIN … END), `cleaner.html`, `str-cleaning.html`, `test/str-cleaning.test.mjs`, `apps-script/hub-scheduler/HubScheduler.gs` (4 rows),
`test/scheduler.test.mjs` + `test/no-cron-anywhere.test.mjs` (job counts), gh-broker `HUB_TEST_*_PATHS`.
Cleaner phone numbers are **not** in this public repo: they are entered through the admin page (or seeded once with `hub_prod_post /str/admin/cleaner/save`).
