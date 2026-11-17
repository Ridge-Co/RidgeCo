# 2026-11-17 receipt-recon-stale-property (follow-up to receipt-recon-accuracy, PR 575)

## CURRENT
Live read-only check after PR 575 reached production: pending row #116 (928 N Calvert St 3R) still carried the inactive duplicate Properties ID 2 in its stored Suggestion snapshot, so the page kept pre-selecting it. Fix (receipt-reconciler.html only): `resolveActivePropertyId` maps an inactive suggested property to the active property with the same address (ID 11), or blank if none. No Worker change, no data change. Test: `test/receipt-reconciler-accuracy-ui.test.mjs`.

## Pre-build gate
Shapes: `ui`. Small follow-up bug fix, no new feature surface; all defaults from the parent note apply (no new questions needed). Companion actions: none. Silent-failure check: no catch added; an inactive property with no active twin shows blank (visible), never a guess.

## Late requests
(none)

## FEATURE_LOG
Rule: a stored suggestion pointing at an inactive property is never pre-selected; the active twin by address is used instead.
