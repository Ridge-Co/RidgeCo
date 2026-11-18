# Vendor portal home list, Phase 1a of the UI/UX overhaul — Nov 18 2026 — head `feat/vendor-home-1a`, cut from main
## CURRENT
Brett asked (Nov 18) to find out which of the Nov 11 UI/UX overhaul proposals shipped and build the rest. Only Phase 0 shipped (#554 kit, #555 portal fixes). This PR is Phase 1a: the vendor home list. It is OFF by default, so nothing changes for any vendor until the switch is turned on.

What it does when on (`?newlayout=1`, a stored session flag, or the later Worker flag):
- Three tabs, To do / Waiting to be paid / Paid, with counts, from ONE load (`/vendor-workorders?...include_closed=true` plus `/vendor-bills`) instead of one request per tab and six per card.
- Each job card gets one big button for the next step: Accept job, Pick a day, Start job, Mark complete, Resume job, Send invoice, See what is needed. New jobs also get Decline.
- Taps that can text a tenant or owner (accept, start, complete, resume) wait behind a 5-second "Sending… Undo" bar. If the page is hidden the tap runs at once. Undo sends nothing.
- A failed save shows "Not saved, tap to retry", is kept on the device (12 hours), survives a reload, and is never re-sent on its own.
- Mark complete still refuses while the checklist has open items, checked BEFORE the Undo bar, and opens the job at the checklist.
- Reuses the existing guarded functions (`submitStatus`, `acceptWO`, `openBillModal`, `checklistGate`, `claimSubmit`). No Worker change, no new payload.
- `VendorHome.tap('WO-1298','start')` is the entry point a later voice or push action can call.
- Also fixes main: after #563/#607 main failed `test/silent-failure-lint.test.mjs` (1 new silent catch in vendor-job-order.js, 3 over baseline in vendor.html). Added same-line `// silent-ok:` reasons. #607 was merged on earlier CI for the same sha without a fresh run.

Checked: 12 new tests; full suite 398/398; ui-check PASS and baseline tightened (file inputs in a label 2 -> 0); real Chrome at 412px with mocked Worker: tabs and counts, one button per card, 44px buttons, no sideways scroll, Undo sends nothing, failed save kept and retried once, old layout untouched when off.

Not checked: the real phone, a native Spanish speaker, the real Worker (do on staging with a TEST vendor).

## FEATURE_LOG
**[FL-20261118-vendor-home-1a]** Vendor home list. Regression rules: (1) the new layout is OFF unless `VendorHome.enabled`; off means vendor.html behaves as before; (2) every notifying tap goes through the Undo bar and the guarded page function, `vendor-home.js` posts nothing itself; (3) Mark complete checks the checklist before the bar; (4) a failed tap is stored and shown, never auto-resent; (5) new vendor-readable text needs Spanish in `vendor-i18n.js` (scanned by `test/vendor-spanish.test.mjs`). Tests: `node --test test/vendor-home.test.mjs test/vendor-spanish.test.mjs`.
Known gaps (later phases): cancelled and declined jobs are not listed in the new layout; no header Menu/Help/language switch; no separate job screen (1b); no 3-step invoice (1c); Undo does not survive a page refresh (only failed taps do); Worker switch (`new_layout` on the vendor login response) not built, needs Brett's yes because it touches login.

## Silent-failure check
Failed saves are shown on the button and kept on the device. A tap that does nothing on purpose (Undo, checklist) is a distinct `SKIP` result so it is never shown as a failed save. The two catches in `vendor-home.js` carry `// silent-ok:` reasons. Storage that cannot be read means a failed tap is simply not remembered after reload; the button itself still showed the failure.

## Pre-build gate
Shapes: `ui` `list` `write` `message` `role`.
- Y: B5 undo (5-second bar for notifying taps; texts cannot be unsent once sent, said in the bar); C-items on mobile (44px targets, DESIGN.md sizes, no raw hex); Spanish for all new text.
- N: B1-B4 (no records created or reordered here); a job screen, 3-step invoice, header help/language (Phases 1b-1d).
- Brett's choices this session: start at 1a; switch via a Config key in the Sheet; 5-second Sending… Undo bar for taps that text tenants/owners.
Companion actions included: failed-save retry, Spanish strings, tests, rollback by switch.

## Late requests
(none yet)
