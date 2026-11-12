# Demo slots backend: add prospect, 10-day clock from first login, convert, expire (Nov 11 2026) — PR into main (staging twin listed in the PR), head `feat/demo-slots-backend-nov11` (cut from main tip f3a6c7a), merged: no

Phase 2a of the demo owner portal + demo tenant portal (design: Continuous Improvement project doc `claude/demo-owner-portal-design-nov10.md`). Phase 1 (the send guard, #530) is already live. This PR adds the data model and the admin actions. It still has NO Hub screen (Phase 2b) and NO test-notification button, fake work orders, photos or receipt (Phase 3); the admin routes can be driven with the admin token.

## CURRENT
Brett's decisions (Nov 10/11): a pool of demo slots (default 3); the prospect logs in as owner or tenant with her first name + one shared PIN; the 10 days start at her FIRST login; on convert or expiry the slot's name/contact is cleared and what she created is wiped; convert goes through the normal QuickBooks path; a prospect who never logs in is cleared after 30 days (default, unless Brett objects).

What is built (worker.js, one block after the Phase 1 guard, plus small hooks):
- Slots: `DEMO_SLOT_COUNT` = 3. A slot = owner `DO<n>` + tenant `DT<n>` + 3 fictional properties (`DP<n>A..C`, Tenant_WO_Toggle ON so the demo tenant can try the request form) + 6 units, all flagged `Is_Demo` / `Demo_Slot`. Same fictional data in every slot. Created on first use (`demoEnsureSlot`, idempotent). An idle slot has `Active = FALSE` and no PIN, so nobody can log into it.
- Columns (added with `ensureColumns`, never `ensureTab`): `Is_Demo, Demo_Slot, Demo_Prospect, Demo_First_Login, Demo_Expires, Demo_Added, Demo_SMS_Count, Demo_Email_Count, Demo_Converted_Owner_ID` on Owners, Tenants, Properties, Units (plus `Tenant_WO_Toggle` on Properties).
- Admin routes (admin token only; in no role scope): `GET /demo/slots`, `POST /demo/add` (name, phone, email, optional slot), `POST /demo/reset` (slot), `POST /demo/convert` (slot), `POST /demo/sweep`.
- Add: needs a first name, a valid US phone and a valid email (the demo texts and emails only these). Refuses a phone/email already in another slot. Picks the next free slot, wipes any leftover in it, generates one PIN (3 letters + 5 digits, checked against every active Owners/Owner_Users/Vendors/Tenants PIN), writes owner + tenant, reads both back. If the second write fails the slot is cleared and the error says so. Returns the PIN to the admin. Sends nothing.
- Clock: the first login of the slot (owner or tenant) stamps `Demo_First_Login` and `Demo_Expires` = +10 days on BOTH rows; the other side reuses it. If the clock cannot be written the login is refused with a retry message (503); it is never let through un-clocked. After expiry login says "This demo has ended" (403).
- Sessions: a demo login token carries `demo:<slot>`. Every request with such a token re-checks the slot (row exists, prospect set, not expired); a cleared or expired slot kills the session at once (401, `session_invalid`). If the check cannot read the sheet the request is refused (fail closed). Real sessions have no such claim and are untouched.
- Demo owner login now also checks the first name (the existing owner login only checked the PIN); demo owners only.
- Demo tenant writes: a demo tenant session may only `POST /workorder` on its own slot's properties/units and `POST /wo/add-note` on a work order of its own slot; every other write path is refused 403 with a `demo_write_denied` telemetry row. (Owner writes are already scoped by #529 and every demo owner owns only its slot's properties.)
- Reset (`demoResetSlot`): clears name/contact/PIN/clock/counters on owner AND tenant FIRST (so nothing can reach her again), then deletes work orders on the slot's properties and their attachments (capped at 200 rows, re-checks the rows right before deleting, reads back that exactly those rows are gone and nothing else). Failures throw a plain error and write a telemetry row; the contact is already cleared by then.
- Sweep (`demoSweep`): clears a slot whose time is up, or whose prospect never logged in within 30 days of being added, or whose added date is unreadable. Never stops at the first failure; throws one error listing every slot it could not clear. Runs as the step `demo_sweep` inside the existing `sweep_checks` scheduler job (every 14 minutes), so there is no new cron and no new SCHED_JOBS entry; a failure shows as a scheduler error, not silence. Also run by Add (so expired slots free up) and by `POST /demo/sweep`.
- Convert (`demoConvert`): creates a NEW real owner from the prospect's name/contact with its own PIN, links it to the slot (`Demo_Converted_Owner_ID`), then creates/links the QuickBooks customer (`qbFindOrCreateCustomer`) and checks `QBO_Customer_ID` on the owner row. The slot is cleared ONLY after both succeed. If QuickBooks fails the prospect stays in the slot, the error names the real owner, and pressing Convert again reuses that owner (no duplicate). Demo rows are never turned into real rows.
- Selftest: no change needed. The owner and tenant of a slot share the prospect's phone, so the existing "same phone, same PIN" tolerance applies; a real user colliding with a demo PIN is still flagged (tested).

Tests: `test/demo-slots.test.mjs` (98 checks) over a fake Sheets/Twilio/Gmail/QuickBooks: fixture shape and unique IDs, add (validation, duplicates, 3 slots, 4th refused, PINs unique), clock from first login (not from add day; owner or tenant first; second login does not restart it), session death at expiry/reset, slot isolation for owner and tenant writes, demo tenant write allow/deny, sweep (expired, never-logged-in, idempotent, other slots untouched), freed slot handed out clean, convert (QuickBooks down then retry, no duplicate owner, QB id saved, slot cleared), failure paths (Address that does not save, half-way add, clock write fails, session check fails, sweep fails, delete cap), real rows byte-identical, nothing texted or emailed. `test/scheduler.test.mjs` stub list gets `demoSweep`. Full suite 341/341.

NOT verified: not run against the real production sheet (Properties.Address may be formula-backed on prod; if so `POST /demo/add` fails with "did not save as written" instead of handing out a broken slot). The first real proof is a slot add using Brett's own phone after merge.

## Pre-build gate
Shapes: `write` `endpoint` `external` (QuickBooks, convert only) `message`-adjacent (reads Phase 1 guard).
- B-items about screens (edit after create, list, sort, photos): N here, the Hub screen is Phase 2b. `GET /demo/slots` is the list the screen will use.
- C5 fail-open vs fail-closed: fail CLOSED everywhere (clock, session check, wipe, convert). Nothing proceeds on an unverified state.
- C9 GATED class: yes (login, PIN, PII, QuickBooks). Explicit yes from Brett required; not self-merged.
- C12 existing data: no real row is changed (a test compares them byte for byte). New columns are blank for real rows.
- C17 columns: `ensureColumns` for the demo columns on four tabs; `addRow`'s numeric IDs are not used for demo rows (fixed IDs `DO1`, `DT1`, `DP1A`, `DU1A1`, ...), the existing numeric-ID max ignores them.
- C2 no cron: honoured; the sweep rides `sweep_checks`.
Companion actions: telemetry for every add, first login, reset, convert and every failure; admin list shows counters and state.

## Known gaps
- Phase 2b: Hub Owners page (Add demo prospect / Convert / Clear), DEMO banner, sweep filters so demo rows stay out of digests, reports and lists. Until then a demo row can appear in admin lists (no text can reach anyone: Phase 1 guard).
- Phase 3: test-notification button with consent line and per-test limits, seeded work orders, photos, fictional receipt, repopulate-on-reset (reset currently leaves only the properties and units, so a fresh slot has no work orders).
- Tenant/vendor session write scope outside the demo (same class as #529) is still a separate follow-up.
- The demo owner portal's own write paths are scoped by #529; demo tenant write paths beyond `/workorder` and `/wo/add-note` (photo upload) are refused until Phase 3 adds and tests them.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261111-demo-slots-backend]** Demo slots (pool of 3): `demoAddProspect`, `demoLoginGate` (clock starts at first login, both rows), `demoSessionDenied` (demo sessions die at reset/expiry), `demoTenantWriteDenied`, `demoResetSlot` (clear contact first, then wipe), `demoSweep` (step `demo_sweep` in `sweep_checks`, no cron), `demoConvert` (slot cleared only after the real owner AND the QuickBooks customer are verified). Regression rules: (1) a demo row is only ever created by `demoEnsureSlot` and only flagged `Is_Demo`; never turn a demo row into a real one, convert makes a new owner. (2) Reset clears contact before it deletes anything. (3) Any new demo-session write path must be added to `demoTenantWriteDenied` with a test. (4) Demo failures throw or return 4xx/5xx with plain words and log telemetry; never swallow.
