# Silent-failure burn-down, Phase 5: auth, session, PIN

## Pre-build gate
- Shapes touched: `read` and `write` (PIN lockout sheet, payment log, owner invites, vendor access list), `parse` (session token, pricing config), `sms` (admin text on a vendor access request).
- GATED: auth, sessions and payments. Brett merges. Claude does not self-merge.
- No new endpoint, sheet or column. Sign-in behaviour is unchanged for every caller. Each handler was read by hand for fail-open behaviour.

## What changed
- `checkPinLockout` (P0): when the lockout sheet cannot be read, the attempt is still let through (unchanged) but it now reports. This is a fail-open path: while Sheets is down, wrong PINs are not limited.
- `recordPinFailure` (P0): a wrong PIN that cannot be counted now reports. Same fail-open effect.
- `clearPinLockout` (P1): a failed reset after a correct sign-in now reports (old failures could lock someone out later).
- `verifySessionToken`: an undecodable token already fails closed (signed out). Marked silent-ok with that reason, no behaviour change.
- `getPricingConfig` (P1): a corrupt PRICING_CONFIG or sheet value now reports instead of quietly switching pricing suggestions off.
- `payAuthLog` (P0): a failed payment-log write now reports and still returns false for its caller.
- `ownerOnboardSubmit` (P1): a failed invite release or a failed "mark used" now reports (a link could stay stuck, or be submitted twice). `ownerOnboardInviteCreate` id read-back (P2).
- `vendorRequestPropertyAccess` (P0): admin text failure reports (request stays saved). `vendorAccessRequestApprove` (P1): approved access not added to the vendor list reports.
- Gmail: reconnect time save (P2) reports. Unreadable replies and id tokens are silent-ok because they already fall to a loud failure page or error.
- `scopeProposalLinkToken` and vendor-onboarding telemetry: silent-ok with reasons.

## Decision for Brett
The PIN lockout fails open on purpose today (a Sheets blip must not lock every tenant out). Now that it reports, you will see when that happens. Failing closed instead is a separate change if you want it.

## Tests
`test/auth-session-pin-failure-reports.test.mjs` (17 source checks). Full suite run locally before the push.

## Still to do
Phase 7b, the Phase 6 remainder, Phase 8 (pages), Phase 9 (leftovers, payables, remaining `ensureColumns` sites).

Silent-failure check: baseline decreases only (worker.js 309 -> 292, total 485 -> 468); no new silent handlers.
