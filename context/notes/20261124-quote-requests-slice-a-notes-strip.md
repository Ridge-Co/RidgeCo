# Queue #231 slice (a): internal notes stripped from external views - Nov 24 2026 - PR to main, head `feat/quote-requests-slice-a` (cut from main tip e2654e9)

## CURRENT
**Status: built, unit-tested, waiting for Brett. GATED row (vendor-facing data and the first slice of a quote feature), so no session merges it.**

Phase 1 of 4 of #231 is split. This PR is slice (a) of Phase 1 only: the data-leak fix the brief calls "gap 1". Gap 2 (a vendor posting an estimate on a job that is not theirs) is already on main (`vendorWriteScopeDenied`, `test/vendor-write-scope.test.mjs`). Remaining after this: the quote mode itself (request, vendor card, Quotes panel, award, texts, switch `quote_requests_enabled`) = "Phase 1 slice (b)", then Phases 2-4. Row #231 goes back to `queued` with that note.

What changed: `enrichWO` now runs every vendor, tenant and shared-link view through the new pure `stripInternalNotes`. `Admin_Notes` and `Owner_Notes` are removed from all of them. Owner views are deliberately left to the owner allow-list (`ownerPick`): the admin secret previewing the owner route keeps the whole row, which `test/owner-allowlist.test.mjs` pins. For a vendor who has not accepted the job (`accessGated`) `Entry_Notes`, `WO_Contact_Name` and the tenant name are removed too (brief question 3 default). `Vendor_Admin_Notes` (written for vendors) stays. Nothing in vendor.html, tenant.html, owner.html or wo.html reads the removed fields; the tenant name has an empty fallback.

## Pre-build gate
Shapes: `record` `role` `ui-data` (no screen edited). Nobody to ask (scheduled run): every item took its default.
Items that are N: B27 where else will he look: N (no new view; this removes data). B31 settings not constants: N (nothing tunable). D-items for scheduler, secrets, texting: not applicable to this slice.
Defaults taken: brief question 3 (tenant name hidden until awarded/accepted). Questions 1, 2, 4-8 belong to slice (b) and were not needed.
Companion actions included: test against the real function (not a copy); the money wall (`stripExternalMoney`) still runs last; the admin path is unchanged (tested).
Known gap: a vendor who accepted a job still sees Entry_Notes on a bid copy that came from the source job; slice (b) makes quote-mode copies not carry them at all.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261124-notes-strip]** `stripInternalNotes` (worker.js, beside `enrichWO`): Admin_Notes and Owner_Notes never leave in a vendor, tenant or shared-link view; an un-accepted vendor also loses Entry_Notes and the tenant name. Regression rules: (1) any new internal-only Work_Orders column must be added to this function, because `enrichWO` spreads every column; (2) `Vendor_Admin_Notes` is the only notes field written for vendors; (3) the admin Hub reads Work_Orders directly and is untouched. Test: `test/vendor-internal-notes-strip.test.mjs`.
