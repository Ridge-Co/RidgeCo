# Retrigger the production build for PR #513 — Nov 3 2026 — notes-only PR into main, head `chore/retrigger-prod-build-513`, merged: no
## CURRENT
**Why:** PR #513 (Premier QB-only switch) merged to main at 01:00Z (commit 4bd61c6), but Cloudflare never started a production build for it. Evidence: `GET /version` on prod still showed `deployed_at` 2026-11-04T00:45:23Z (the #511 deploy) 30+ minutes later; the deployed `maintenance-hub` source had `insbBackfillWo` but not `inspBookingWoInput`; Brett's Cloudflare Deployments page listed #511 as the newest deploy with nothing for #513; his Builds settings are fine (production branch main, builds enabled, watch paths `*`). So the push event was missed, not a config problem.
**This PR:** adds only this note (no code). Any new commit on main starts a production build that deploys the whole of main, including #513.
**To verify after merge:** `hub_prod_get /version` shows a new `deployed_at`, and the deployed source contains `inspBookingWoInput`. Until then Premier's QB-only switch must not be ticked.
**NOT done:** nothing is switched on for Premier; no QuickBooks record created, no email sent.
Silent-failure check: notes-only, no code path touched; the missed build was found by comparing prod /version and deployed source to the merge time, not by assuming.
## FEATURE_LOG
**[FL-20261103-prod-build-missed-check]** After merging to main, confirm the production deploy by `GET /version` `deployed_at` (and a string only the change adds in the deployed source); a green GitHub check does not prove the Cloudflare build ran. If it did not, push a notes-only commit to main to retrigger it. Staging has the same lag/miss behavior.
