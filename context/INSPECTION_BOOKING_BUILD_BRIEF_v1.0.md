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

## Known gaps / follow-ups
- No reminder or auto-expiry for pending bookings (`Reminded_At` column reserved; would use the */15 cron).
- Only one calendar read per availability request (no caching).
- Real Calendar/Maps/SMS paths can only be exercised after the one-time setup, on production.
