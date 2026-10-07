# Inspection Booking (Calendly-style) — Build Brief v1.0 — Oct 7, 2026

Extends B-226 Phase 1 (inspection scheduling). PR #183 → `main` (staging test PRs #181/#182). BUILD_VERSION `2026-10-07.2-insp-booking`.

## Goal
Third-party managers (AMS CRE etc.) book inspection slots themselves inside big time blocks Brett opens. Brett knows immediately, approves each booking, and his Google Calendar both blocks slots and receives the bookings. Free, runs on the existing Cloudflare Worker + Sheet (Calendly/Cal.com clones can't run on Workers).

## Flow
1. Brett: inspect.html → Open blocks → create customer (partner) → add date/time blocks → "Get link" (per-customer random `Book_Token`; rotatable).
2. Partner: `inspect-book.html?k=<token>` → address + units (+ buildings) → "Find available times" → picks a time → name/phone/email/notes → request.
3. Worker: geocodes address, computes duration, reads Brett's main Google Calendar, subtracts busy events + blackouts + existing bookings, applies real drive-time buffers (Google Routes) to/from neighbouring events, returns only times that fit.
4. On request: re-validates the slot (race-safe → `slot_taken`), writes a TENTATIVE calendar event, texts (Twilio, if enabled) + emails Brett an approval link (`inspect-book.html?a=…`, HMAC token, explicit Approve/Decline buttons so link previews can't trigger it).
5. Approve → event confirmed, partner notified. Decline/cancel → event removed, slot re-opens, partner notified. Partner can cancel with the manage link (`?m=…`).

## Rules
- Duration: `inspDurationMin(units, buildings)` = 30 base + 20/building + 30/unit with economies of scale: 1u 40m, 2u 75m, 3u 110m, 4u 140m, 6u/2bldg 220m (3 units is 110, not 120 — deliberate). 15-minute start grid.
- Buffer: real Routes drive minutes × 1.25 + 5 park; default 30 min if no neighbour location; haversine estimate (flagged in UI + alert) if Routes fails.
- Horizon 60 days, min notice 120 min, max 60 units.
- Pending bookings HOLD their slot (tentative calendar event) until decided.
- Nothing fails silently: calendar read failure aborts availability (`calendar_unavailable`); notify results stored in `Notify_Log` (sms/email sent/skipped/staged/failed); drive fallback flagged; alerts via `inspAlert`.

## Data
New Sheet tabs (auto-created): `Insp_Open_Blocks`, `Insp_Bookings`. `Insp_Customers` gains `Book_Token`.
Public (token-gated) endpoints: `/insp-book/{info,slots,request,status,cancel,approval,decide}`. Admin: `/insp/open-blocks`, `/insp/bookings`, `/insp/calendar-test`, `/insp/open-block/{add,update}`, `/insp/booking/{decide,cancel}`, `/insp/customer/book-link`.

## One-time setup (Brett)
1. Enable **Google Calendar API** in GCP project `maintenance-hub-498819`.
2. Share the calendar (default `brett@bmoremanagement.com`, override Config `INSP_CALENDAR_ID`) with `maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com` → "Make changes to events".
3. Enable **Routes API** on the Maps key (else drive times are flagged estimates). Staging's Maps key is currently rejected (REQUEST_DENIED); production's is unverified until the check button runs.
4. Config `admin_phone` (+ `TWILIO_ENABLED=TRUE` to send texts); optional `INSP_NOTIFY_EMAIL`.
5. After merge: inspect.html → Open blocks → "Check" then "Check + test write".

## Staging behaviour
Calendar calls are stubbed on staging unless Config `INSP_CALENDAR_STAGING_MODE=LIVE`. SMS/email stubbed. Addresses beginning `TEST` use a labeled geocode stub on staging only.

## Tests
`test/insp-booking.test.mjs` (62 assertions: duration, ET/DST, blackouts, slot engine with drive buffers, events→busy, wiring). Staging E2E run Oct 7 (see PR #183).

## Key pickup (added Oct 7, PR #185)
- Per customer: `Insp_Customers.Key_Address` + `Key_Pickup_Min` (set in inspect.html → "2b. Key pickup"; endpoint `/insp/customer/key-pickup`; address geocoded at save; 0 minutes = off). Josiah / AMS CRE: 400 W Franklin St, Baltimore, MD 21201, 30 min.
- Rule: any slot earlier than that customer's earliest ACTIVE booking that day needs a virtual pickup interval [start − min, start] that fits in the open block, avoids blackouts and calendar busy time (drive time office → neighbouring stop). So a 10:00 block offers 10:30 first. Book 12:00 first → pickup 11:30–12:00, 10:30–11:00 still bookable. Book 11:00 → it becomes first, pickup 10:30–11:00, 10:30 slot disappears.
- Calendar: one reconciled event per customer per day tagged `extendedProperties.private.ridgecoInspKey = <customerId>_<date>` (`inspReconcileKeyPickup`); re-planned after request, approve, decline, cancel; excluded from busy computation. Results logged in `Notify_Log` (`key_pickup: …`); failure/conflict → `inspAlert`. `Insp_Bookings.Key_Pickup` records the planned window at booking time (history, not live).
- Assumption: the 30 minutes includes travel from the office to the first property.

## Booking cutoff (added Oct 7, PR #185)
- `Insp_Open_Blocks.Book_By_Hours` (blank = Config `INSP_DEFAULT_BOOK_BY_HOURS`, default 48; 0 = open until the start) and `Book_By` (exact Eastern `YYYY-MM-DDTHH:MM`, single date; wins over hours). Unparseable → block treated as closed (fails closed).
- Closed blocks produce no slots. Partners see `open_days` with "book by …" on `/insp-book/info`, per-day on inspect-book.html, and `closes_label` per slot. Admin list returns `Closes_At/Closes_Label/Is_Closed`; adding a block that is already closed returns `already_closed` and the UI warns (set hours to 0 or an exact close time).

## Partner calendar entry + My bookings (added Oct 7, PR #185, BUILD_VERSION 2026-10-07.4-insp-calendar-mine)
- Brett's own calendar: tentative event on request, confirmed on approve, removed on decline/cancel (unchanged). Google will not let the service account invite outside guests, so the partner gets their OWN entry:
  - Approval email carries an `.ics` (METHOD:REQUEST, inline `text/calendar` part + `invite.ics` attachment; organizer = the Gmail sender); cancelling an APPROVED booking sends a METHOD:CANCEL (same UID `insp-<ID>@ridgeco`, SEQUENCE 1). Pending→declined sends no calendar file. If the invite email fails it falls back to the plain email and logs `partner email invite FAILED …`.
  - Manage page (`?m=`) and the "Your upcoming bookings" list show "Add to Google Calendar" + a downloadable `.ics` (`GET /insp-book/ics?t=<Manage_Token>`, approved bookings only).
- Partner is now messaged (SMS + email) when the request lands (`Notify_Log`: `partner …` lines), with the manage link.
- Main link (`?k=`) now lists that customer's upcoming pending/approved bookings with Cancel (`GET /insp-book/mine?k=`). Anyone holding the customer link can see/cancel that customer's bookings (single-customer link by design).
- Staging never sends real invite mail (stubbed like all staging Gmail); the MIME is unit-tested. First real-Gmail check = Brett books with his own email on prod.

## Calendar conflict guard (added Oct 7, PR #188, BUILD_VERSION 2026-10-07.5-insp-conflict-guard)
- Availability is read LIVE from the calendar on every slots request (no cache), and re-checked at request time; a time Brett adds later simply disappears the next time the partner searches. A results screen left open is only a snapshot.
- Race window (Brett adds an event in the second between the availability read and the hold being written): after the hold is written the calendar is re-read (`inspFindConflicts`). Overlap → the hold is deleted and the partner gets 409 `slot_taken` with fresh slots; a verify-read failure cancels the hold + alerts.
- Approve re-checks live too: overlap → 409 `conflict` naming the other item; approval page shows a red banner + "Approve anyway"; admin tab confirms (`override:true`). A failed check blocks approval with an alert.
- Only hard time overlap counts (no drive buffer; free/declined/cancelled events and key-pickup blocks ignored). Titles of Brett's events are Brett-only.
- Staging stubs the calendar, so these paths are unit-tested (`inspConflictsFrom`) and need one real check on prod: create a pending booking, put an event over it, open the approval link → red banner.

## STR cleaning-coverage guard (added Oct 7, BUILD_VERSION 2026-10-07.6-insp-str-cleaning-guard)
- Why: Brett's cabin (Milam Ridge, Springfield WV) needs a turnover clean after every checkout and before the next guest. With no cleaner he drives 3h out, cleans, 3h back = the whole day, so he cannot be in Baltimore for an inspection.
- Rule: a checkout whose window (checkout day → the day the next guest arrives, arrival-day cleans are fine) has no cleaner on the cleaning calendar CLOSES that whole checkout day to inspection booking. Covered = an event that day titled "<name> Cleaning" (Gina/Kayla/Rachel/…). NOT covered = "Brett Cleaning", "N/A", "Available", "Not Available", or nothing. It reopens by itself when a cleaner appears.
- Inputs (read-only, never written): bookings feed(s) — Config `STR_GUARD_BOOKING_SOURCES` (https iCal link, e.g. the Uplisting feed — imported/subscribed Google calendars cannot be shared, so the Worker reads the feed directly — or a Google calendar id shared with the service account); an event's END date is the checkout day (11 AM). Cleaning calendar — Config `STR_GUARD_CLEANING_CAL` (Google calendar id shared with the service account, "See all event details"). Optional `STR_GUARD_ENABLED` (FALSE = off), `STR_GUARD_PROPERTY_LABEL`. Dormant until both inputs are set. Set from the admin page card "2c" (also shows every upcoming checkout ✅/⛔ and any read error).
- Where it bites: `inspAvailability` → `closedDates` → `inspComputeSlots` skips the block; the partner open-days list hides the day; a real booking request re-reads coverage LIVE (60 s memo otherwise); approve and the approval page add a `no_cleaner` conflict (409 `conflict`, "Approve anyway" override); opening a block warns BEFORE saving (admin confirm) and returns `str_warnings`; the block list shows ⛔.
- Alerts: the */15 cron runs `inspStrGuardTick`. Text + email to Brett ONCE per change: an inspection (pending/approved) on an uncovered day (⚠ — get a cleaner or cancel; re-alerts when the booking gets inside 72h and 24h), an open block that just got closed, and a "good news — reopened" message when a cleaner is added. State = Config `STR_GUARD_NOTIFIED`. Existing bookings are never auto-cancelled.
- Failure behavior (no silent failures): if the feed/cleaning calendar can't be read, slot requests fail closed ("temporarily unavailable") and Brett is alerted (30-min throttle); the tick alerts; approval proceeds but alerts. Admin card shows the error.
- Staging: calendar-ID reads are stubbed (like the main calendar); the feed URL path and Google path are NOT exercised there. Staging-only Config `STR_GUARD_FIXTURE` (JSON `{stays:[{start,end,guest}],cleaning:[{date,title}]}`) drives the rules end to end. `POST /insp/str-guard/run {dry:true}` previews the alert without sending.
- Endpoints (admin): `GET /insp/str-guard/status[?dates=a,b]`, `POST /insp/str-guard/config`, `POST /insp/str-guard/run`.
- Tests: `insp-booking` 150 assertions (real Oct data: Oct 13 closed, Oct 9/11/18/20 covered), staging E2E Oct 7 (close → alert once → approve warning → cleaner added → reopened + resolved message).

## Known gaps / follow-ups
- No reminder or auto-expiry for pending bookings (`Reminded_At` column reserved; would use the */15 cron).
- Only one calendar read per availability request (no caching).
- Real Calendar/Maps/SMS paths can only be exercised after the one-time setup, on production.
