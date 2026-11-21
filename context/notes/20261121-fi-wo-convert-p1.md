# Convert inspection findings into work orders, Phase 1 of 4 (queue #261) — Nov 21 2026 — PR into main, head `feat/fi-wo-convert-p1` (cut from main tip 010fcd4), merged: no

## CURRENT
**Status: built and tested, waiting for Brett. GATED (writes real `Work_Orders` rows, adds the `Source_Ref` column, assigns vendors, changes the saved inspection shape), so no session merges it.**

Phase 1 of 4 (Phase 2 edit after creation, Phase 3 learning and suggestions, Phase 4 links in the Hub are NOT built).

**Built:**
1. Review screen: the "conversion comes in a later update" line is gone; a "Create work orders" button opens a new Work orders builder (`field-inspect.html`, view `wo`). Nothing is created until he confirms; saving or publishing an inspection never creates a work order.
2. Three arrange buttons that only draw draft groups: "All on one work order", "Related items together" (same trade in the same unit/section together, every other item alone), "I'll pick" (empty). Replaces drafts only after a confirm; already-created groups are never touched.
3. Group cards: editable title, vendor picker (optional), items with "Add to... / Move..." (existing groups first, "New work order" last, "Take off its work order"), multi-select, remove a draft group. Arrangement is saved in `doc.wo_groups` (ids only) on every change, so it survives leaving and other devices. Tenant-action items and excluded areas sit in a "Not converting" tray and can still be moved in by hand; flagged (`is.wo`) items are listed first.
4. `POST /fi/wo/plan` (writes nothing): `{arrange}` returns draft groups; without it returns the exact work orders (trade, priority, checklist lines, vendor name, photo count, warnings). `POST /fi/wo/create` makes them, one request per work order from the page. `GET /fi/wo/vendors` returns id, name and trade of active vendors only.
5. Each work order: type `inspection`, description = group title + "(from inspection <date>)", one checklist line per item ("Area: title - fix", access-code text replaced), trade mapped to the Hub list, priority high when any item is urgent or high, tenant_visible and both tenant notify flags FALSE, Owner_Notify_Override `off`, `Source_Ref` = `fi:<inspection>:<group key>`. Vendor (when chosen) goes through `assignVendor` with `notify:false` and `notify_tenant:false`. Up to 6 photos per work order are attached by the same Drive file the inspection already holds (original when there is one).
6. Safe to retry: a group whose `Source_Ref` already exists is reused, never recreated; after the write a fresh read checks the `Source_Ref` landed; the numbers are written back to the items (`is.wo_id`, `is.wo_group`) and groups through `fiSave`. These fields are stripped from `fiPublicDocKey` (saving them does not un-publish a report) and from `fiScrubDocForReport` (the customer's report never shows a number, group or vendor).

**Tests:** new `test/fi-wo-convert.test.mjs` (66 checks, real FI block against the in-memory fake). `test/manual-verify-fi-wo-convert-ui.mjs` (8 browser walk-throughs at 390 and 1366 px, shots in /tmp when FI_SHOTS is set). Updated `test/_fi-world.mjs` (stand-ins for createWorkOrder, assignVendor, logAttachment, updateWOFields) and one regex in `test/fi-urgent-send.test.mjs` (the staging gate line now also names the two new paths). `scripts/ui-check.mjs field-inspect.html`: PASS, nothing worse than baseline. Full suite `node --test test/*.test.mjs`: 405 pass, 0 fail.

**NOT verified:** the real `createWorkOrder`, `assignVendor`, `logAttachment` and Sheets column creation were only run through stand-ins (their own code has its own tests); not run on the S23; no staging check was done; Spanish vendor portal display of the new checklist lines has no test (see gate B26); number of Google calls per work order with 6 photos was not measured (see D3).

**Needs a human:** merge after a look on the phone; nothing to paste, no secret, no JOBS row.

## Pre-build gate
Shapes: `record` `list` `ui` `endpoint` `write` `photo` (no `message`, `money`, `job` or `external`: conversion sends nothing and touches no money). Nobody was available to ask (scheduled run); every item took its default or the safer option; the open QUESTIONS in the brief took their recommended defaults (same trade + same unit means related; no texts at all; items become checklist lines; tenant-action items start in the tray; customer report never shows a work order).

Items that are N (known gaps):
- B1 Edit after create: partly. Drafts are fully editable; a created work order's grouping is not (Phase 2). Everything else on a created work order is edited in the Hub as usual.
- B3 Move between parents: Y for drafts and for items between drafts; moving an item between created work orders is Phase 2.
- B4 Reorder by hand: N. Order follows the report; no drag.
- B5 Undo: partly. A draft group can be removed and its items return; creating a work order cannot be undone from this screen (cancel it in the Hub). No text can be involved.
- B15 History: partly. `Source_Ref` and the inspection's `wo_id` link both ways; failures write `Ops_Telemetry`; no separate change log tab.
- B20 Voice dictation: N. The title box is a plain input; the phone keyboard microphone works.
- B26 Spanish: N. Checklist lines are English; the vendor portal's Spanish display path was not exercised by a test.
- B27 Where else will he look: N. The Hub work order detail does not yet say "From inspection" (Phase 4).
- B28 Long lists: partly. 60 groups and 60 items per group are the caps; no search or filter.
- B31 Settings, not constants: N. 6 photos per work order and 60 groups are constants.
- D3 About 50 outbound calls per request: partly. Create runs one work order per request from the page, and photos are capped at 6, but the real call count with six photos was not measured.

Decisions taken (the brief's QUESTIONS and the choices it left): related = same trade in the same unit or section; no text, email or push to anyone, vendor assigned quietly; one checklist line per item; tenant-action items not converted unless moved in; customer report never shows a work order. Photos are attached by the Drive file the inspection already holds and, like every work order photo, get the anyone-with-link share (`logAttachment`); Brett may want these inspection photos kept private, which would be a one-line change. A work order whose title matches another made in the last 60 seconds is reported as failed (the Hub's duplicate guard), not changed.

Companion actions included: preview of the exact output before anything is made (B19); "No texts" stated before and after (B13); duplicate and double-tap protection (B17: button disabled, claim guard, Source_Ref reuse, group titles forced different); bulk select-and-move (B16); loading, empty, error and retry states (B32); phone first at 390 px with 44 px targets (B33); warn-don't-block for items already on a work order, missing photos, inactive vendor, multi-unit groups (B18); photos: missing or unfinished uploads warned (B22); C1 nothing texts Brett; C2 no cron; C3 every failure shown on screen and written to `Ops_Telemetry`; C4 write re-read (Source_Ref and the inspection save are verified); C6 no owner-facing view; C7 access-code text replaced in checklist lines; C9 GATED; C11 blank `wo_groups` means nothing changes; C12 no backfill; C17 `ensureColumns` for `Source_Ref`, never `ensureTab`; D1 reads once per tab per request; D13 the public report scrub.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261121-fi-wo-convert-p1]** Inspection findings to work orders, Phase 1. Regression rules:
1. **Conversion is never automatic.** Only `/fi/wo/create` makes a work order, only after the preview; saving or publishing never does.
2. **Nothing is sent.** `createWorkOrder` is called with tenant_visible, tenant_notify_created, tenant_notify_updates all false and owner_notify_override `off`; `assignVendor` only with `notify:false, notify_tenant:false`. A test asserts zero texts, emails and pushes.
3. **`wo_id`, `wo_group` and `wo_groups` are phone-only fields:** keep them out of `fiPublicDocKey` (or every conversion un-publishes the report) and out of `fiScrubDocForReport` (or the customer sees a work order number).
4. **`Source_Ref` (`fi:<inspection id>:<group key>`) is the idempotency key.** Create reuses an existing one; never create without checking it. Group titles must differ, or the Hub's 60-second duplicate guard swallows the second work order.
5. **One work order per request** from the page (call budget). The server loop is sequential, never parallel (WO number append race, rule 219).
6. Validator accepts the new fields; the doc size cap still applies, so `wo_groups` holds ids only.
Tests: `test/fi-wo-convert.test.mjs`, `test/manual-verify-fi-wo-convert-ui.mjs`.
