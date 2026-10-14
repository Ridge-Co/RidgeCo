# STR Cleaning Scheduler — Milam Ridge — Build Brief v1.0 (Oct 14, 2026)

Status: built on branch `feat/str-cleaning-scheduler`, **everything OFF by default**. Brett's rule: test mode first.
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
| `STR_CAL_WRITE_ENABLED` | FALSE | Hub writes the cleaning calendar. FALSE = plan only. Needs the service account to have "Make changes to events" on that calendar. |
| `STR_DIGEST_ENABLED` | FALSE | Mon/Wed/Fri cleaning email. |
| `STR_ALERT_DAYS` 5 · `STR_LOOKAHEAD_DAYS` 35 · `STR_RED_BLOCK_DAYS` 14 · `STR_REPLY_4H_DAYS` 5 · `STR_REPLY_2H_DAYS` 3 · `STR_ALERT_REPEAT_HOURS` 6 · `STR_MARK_ALERT_DAYS` 5 · `STR_PREARRIVAL_GAP_DAYS` 3 · `STR_MAX_PENDING_PER_CLEANER` 2 | | tuning |

Rollout order: (1) add cleaners on the board (creates Vendors rows: Trade "Short-Term Rental Cleaner", Service_Area "Milam Ridge"); (2) "Run now (preview)";
(3) `STR_ENGINE_ENABLED` TRUE with SMS off → alerts + board only; (4) `STR_SMS_ENABLED` TRUE while `TWILIO_TEST_MODE` is TRUE → every cleaner text goes to Brett's phone
with the real link, so he can tap Take it as "Gina"; (5) `STR_CAL_WRITE_ENABLED`; (6) `STR_DIGEST_ENABLED` and turn off the Make.com email; (7) `TWILIO_TEST_MODE` FALSE.

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

## Live staging test (Oct 14 2026)
Passed on `maintenance-hub-staging`: tab self-provisioning, TEST- cleaner create (3), cleaner page, marks (persisted, logged), admin assign (text blocked loudly when Twilio is globally OFF, email stub ok), cleaner cancel (urgent + not-covered alerts with backup picture, offer row marked cancelled), dry tick, twilio-off pause (loud, telemetry row), both pages at 412 and 1280 with no horizontal scroll.
NOT live-tested: the round-robin offer loop itself (offer, decline, expire, accept, filled text), because staging has Twilio switched OFF globally and the test token is not allowed to switch it on. It is covered by 117 offline tests. First real check after merge: turn the switches on in the documented order with Twilio test mode ON (texts go to Brett's phone only).
Known limit: Google Sheets read quota is per minute for the whole Hub. The public cleaner page now reuses the ~6s tab cache so a burst of link opens cannot burn it.

## Roadmap — logged, NOT built (room is reserved; the cleaner page already has a "coming soon" strip)

Scheduling was by far the priority. From Brett's Oct 14 message, to build later on the same token page and the same `STR_*` sheet family:
1. **Supplies requests** — dropdown seeded from Gina's past texts + custom items; request goes to Brett (and a shopping list).
2. **Checklists** — per-turnover cleaning checklist templates.
3. **Recurring tasks** with reset-on-done (e.g. monthly fridge clean), shown on the page and in the digest email.
4. **Seam battery triggers** — lock battery below ~35–37% creates a "change batteries" task, with a stay-length rule so it isn't scheduled mid-stay.
5. **Deep-clean rotation** — kitchen → bathrooms → bedrooms, one per turnover window.
6. **5-star guest-condition report** (1 absolutely terrible … 5 excellent) with a short checklist and photos, **internal only**.
7. **Make.com migration**: retire the 3x weekly email once `STR_DIGEST_ENABLED` has run clean for a week.
Open questions with defaults used: Gina = Regina Seville; Sierra is not in the pool (add her with "in queue" off to get the email only); a cleaner pre-marked "available" is **not** auto-assigned
(marks mean backup only); alert threshold 5 days (Brett said both 7 and 5 — 5 stuck, configurable); Uplisting calendar blocking is out of scope.

## Files

`worker.js` (STR-BLOCK-BEGIN … END), `cleaner.html`, `str-cleaning.html`, `test/str-cleaning.test.mjs`, `apps-script/hub-scheduler/HubScheduler.gs` (4 rows),
`test/scheduler.test.mjs` + `test/no-cron-anywhere.test.mjs` (job counts), gh-broker `HUB_TEST_*_PATHS`.
Cleaner phone numbers are **not** in this public repo: they are entered through the admin page (or seeded once with `hub_prod_post /str/admin/cleaner/save`).
