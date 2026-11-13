# Demo sample data: 8 sample work orders, photos and a fictional receipt per demo slot, rebuilt after every reset (Nov 12 2026) — PR into main (staging twin listed in the PR), head `feat/demo-seed-data-nov12`, merged: no

Phase 3a of the demo owner portal + demo tenant portal (design: Continuous Improvement project doc `claude/demo-owner-portal-design-nov10.md`). Phases 1, 2a, 2b are live. Phase 3b (the "send me a test" button) is the next PR.

## CURRENT
What is built:
- `demoSeedRows(slot, now)` (pure) + `demoSeedSlot(env, n)` (writes, reads back). 8 sample work orders per slot, ids `WO-D<slot><nn>` (e.g. WO-D101), on the slot's own fake properties/units: New (a request the demo tenant "made"), Assigned (urgent HVAC), Accepted with a scheduled date and window, In Progress, On Hold, and three Complete jobs. Dates are relative to the hand-out time. The demo tenant owns two jobs (one open, one complete); the other six belong to nobody.
- Safety shape of every sample row: `Is_Demo = TRUE`, `Vendor_ID` blank (nothing can text a vendor), `Tenant_Notify_Created/Updates = FALSE`, `Owner_Notify_Override = 'off'`, `Owner_Notified = FALSE` (nothing about them queues a message).
- 7 Attachments rows (ids `DA<slot><nn>`) on the three completed jobs: before/after photos and 2 receipts. `Drive_File_ID` is blank and `Drive_URL` points at plain SVG pictures committed in this repo under `demo/` (`photo-before.svg`, `photo-after.svg`, `receipt-sample.svg`), served from `https://ridge-co.github.io/RidgeCo/demo/`. Every picture is marked SAMPLE; the receipt says it is a fictional store and not a real transaction.
- Wiring: `demoAddProspect` seeds right after the pre-hand-out wipe and BEFORE the contact is set; if the seed fails the add is refused and nothing is assigned. `demoResetSlot` rebuilds the sample data after the wipe; a failed rebuild is safe (the slot is already idle) but loud (`demo_slot_seed` failure row in Ops_Telemetry and `seeded:false, seed_error` in the reset response); the next add re-wipes and reseeds.
- Guard tweak: `demoRefersToDemo` now matches `WO-D101`-style references in message text (the regex allows the D).

Tests: `test/demo-seed.test.mjs` (34 checks) drives the real worker over a fake sheet (shared harness `test/_demo-world.mjs`, not itself a test): seed shape and safety flags, ids unique across slots, mixed statuses, assets exist and are marked SAMPLE, add seeds 8+7, real work order/attachment untouched, owner portal lists all 8 and the finished job returns before/after/receipt pictures, tenant sees only its own jobs, admin WO list hides them, the prospect's own request and an edit are gone after a reset and the sample data is rebuilt (no duplicates on re-add), two slots stay separate, a failing seed refuses the add and assigns no contact. `test/demo-slots.test.mjs` / `demo-hub-screen.test.mjs`: their fake Attachments tab now has the real `File_Type` / `Drive_URL` columns, and two "slot is empty" assertions now say "nothing the prospect made is left".

NOT verified: nothing has run against the real production sheet and nobody has seen the SVGs render in the portal on a phone. First proof = Brett clears and re-adds himself, then opens the demo owner portal.

## Pre-build gate
Shapes: `write` (demo rows only) `seed` `static-assets`. No new route, no cron, no message.
- B-items (edit/list/sort/photos): photos = the three SVGs, shown through the existing attachment list; edit N/A (reset rebuilds).
- C5 fail-open vs fail-closed: fails closed. A seed that cannot be written refuses the hand-out; a seed that cannot be rebuilt after a reset leaves the slot idle and reports it.
- C9 GATED class: yes (demo PII lifecycle: add/reset paths). Explicit yes from Brett required; not self-merged.
- C12 existing data: only demo rows (`WO-D*`, `DA*`) are written or deleted; real rows are asserted untouched. `Work_Orders.Is_Demo` column is added if missing.
- C2 no cron: honoured.
Silent-failure check: every seed step is read back; failures throw plain-words errors and write Ops_Telemetry.

## Known gaps
- Phase 3b: "send me a test" button + consent line + counters in the owner and tenant portals.
- A sample work order in status New / Assigned may be picked up by scheduler jobs that text about stale work orders; any such text that names a demo work order or fake address is blocked by the Phase 1 guard and logged as `demo_send_blocked`. Watch the first real run.
- Photo upload by the demo tenant stays refused (it would write to real Drive).

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261112-demo-seed-data]** Demo sample data. `demoSeedRows`/`demoSeedSlot` write 8 sample work orders (ids `WO-D<slot><nn>`) and 7 attachments per slot, on hand-out and after every reset. Regression rules: (1) every sample row must stay `Is_Demo = TRUE`, vendor-less, and notify-off; (2) a new demo slot step that deletes by property must be followed by `demoSeedSlot`; (3) sample pictures live in `demo/` and must say SAMPLE; (4) never point a sample attachment at a real Drive file.
