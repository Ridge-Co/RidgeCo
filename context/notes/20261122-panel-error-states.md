# Panel error states (queue #112 slice 1) — Nov 22 2026 — PR -> main, head `feat/panel-error-states` (cut from main tip 02f94e7), merged: no

## CURRENT
**Status: built and tested with a mocked API in a browser; NOT yet verified on staging or production. It changes vendor.html (a vendor-facing page), so no session merges it: it waits for Brett.**

Slice 1 of #112 (the brief's own bounded first slice). Front-end only; worker.js untouched; no sheet change.
- vendor.html `loadVendorTaskAlerts`: the "Needs your attention" banner used to stay blank when the read failed, so a vendor with an open request from Brett saw none. It now uses `apiList()` (401 signs out, a non-list answer is an error) and shows the existing "Could not load ... Retry" box (`showLoadFailed`, which also reports to the failure ledger once per page load).
- vendor.html `loadVendorAddons`: a failed read or `{success:false}` used to look like "no add-ons submitted" (risk: the vendor sends the same extra work twice). Each eligible job card now shows the same Retry box; 401 signs out.
- index.html `openWODetail`: the admin audit-trail panel said "Unavailable" with no retry. It now says "Couldn't load history. Retry", and a non-list answer counts as a failure (empty list still says "No changes recorded yet.").
- vendor-i18n.js: two Spanish strings for the new messages.
- Test: `test/manual-verify-panel-error-states-ui.mjs` (9 checks, mocked API, 412px phone).
- Not done (the rest of #112): the other ~18 empty `catch` sites in index.html, other portals, a shared script.
- BUILD_VERSION not edited (frozen base).

## Pre-build gate
Shapes: `ui` `list`. Scheduled run, nobody to ask: every item took its default.
- N on purpose: an automatic retry timer. The Oct 19 Sheets read-quota work forbids extra reads; Retry is a tap only.
- C3 nothing fails silent: Y, this build is that rule. C4: n/a (reads only, no writes, no side effects). C5: failure shown, never hidden (fail-closed display). C6: n/a (no spend shown). C9: SAFE class (display only) but vendor-facing, so left for Brett to merge. C10: reuses `showLoadFailed`, `retryLoad`, `apiList`. C11/C12: blank/empty list still renders as before; no data touched. C17: n/a (no columns).
- Overridden from the brief: no BUILD_VERSION edit (branch policy: frozen base).
Companion actions included: retry (user tap only), failure-ledger report (existing helper), EN/ES strings, 401 handled as sign-out not as an error loop.

## Late requests
None yet.
