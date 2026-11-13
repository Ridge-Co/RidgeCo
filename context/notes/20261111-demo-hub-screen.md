# Demo Hub screen: add / clear / convert demo prospects, DEMO banner, demo rows hidden (Nov 11 2026) — PR into main (staging twin listed in the PR), head `feat/demo-hub-screen-nov11` (cut from main tip 47a80ac), merged: no

Phase 2b of the demo owner portal + demo tenant portal (design: Continuous Improvement project doc `claude/demo-owner-portal-design-nov10.md`). Phase 1 (send guard #530) and Phase 2a (slots backend #534) are live. This PR adds the Hub screen that drives the Phase 2a routes, the DEMO banner in the owner and tenant portals, and keeps demo rows out of real lists. Phase 3 (test-notification button, seeded work orders, photos, receipt) is still not built.

## CURRENT
What is built:
- Hub, Owners page: button `🎭 Demo Prospects` opens a modal with the slot cards (state, prospect name/phone/email, PIN, added, first login, expires), an Add form (first name, phone, email), and per-slot Clear / Convert buttons. Nothing is pre-filled (the repo is public: no real phone or email is in any HTML); the admin types the prospect's contact. Errors show in the modal and as a toast. Clear and Convert ask `confirm()` first. All of it calls the Phase 2a admin routes (`GET /demo/slots`, `POST /demo/add|reset|convert`); no new route.
- Banner: owner.html and tenant.html show a DEMO bar and prefix the header line with "DEMO · " when the login response carries `demo: true` (owner login and tenant login add it only for `Is_Demo` rows); the banner is cleared on logout. Real logins never get the flag.
- Hiding: `demoIsDemoRow` / `demoHide` (Is_Demo flag, or the fixed ID shapes `DO<n>`, `DT<n>`, `DP<n>A`, `DU<n>A<k>`, or a Property_ID of a demo property) applied to: `hubBootstrap` (properties, units, tenants, work orders, owners), `getWorkOrdersList` (admin Work Orders page), `portalAccessList`, and `buildDigest` (work orders, properties, tenants). The existing additional-work Draft filter is unchanged and still wraps first.
- Message sweep is deliberately NOT filtered: a hidden recipient would raise "recipient not found" alarms; the Phase 1 guard already skips demo recipients quietly.

Tests: `test/demo-hub-screen.test.mjs` (36 checks): helper shapes, bootstrap/WO list/portal-access/digest exclude demo rows while real rows stay, login `demo` flag only for demo logins, no real phone/email in the HTML, banner and modal wiring, escaping. `test/manual-verify-demo-hub-ui.mjs` (18 Playwright checks, NOT in CI; run `node test/manual-verify-demo-hub-ui.mjs /tmp/shots`). `test/wo-void.test.mjs` harness now also extracts the demo helpers because `getWorkOrdersList` calls `demoHide`. Full suite 342/342 locally.

NOT verified: nothing has run against the real production sheet. First proof = Brett adds himself from Owners → 🎭 Demo Prospects after merge (Properties.Address may be formula-backed on prod; if so Add fails loudly with "did not save as written").

## Pre-build gate
Shapes: `ui` `read-filter` `login-response` (adds a boolean) — no new write path, no new route, no cron, no message.
- B-items (edit/list/sort/photos): list = the slot cards; edit after create N/A (clear and re-add); photos are Phase 3.
- C5 fail-open vs fail-closed: the hiding filters fail open on purpose (an unrecognised row is shown, never dropped); real rows are never hidden because a demo row can only match the demo ID shapes or an explicit Is_Demo flag. The Add/Clear/Convert actions keep Phase 2a's fail-closed behaviour.
- C9 GATED class: yes (touches login responses and demo PII display). Explicit yes from Brett required; not self-merged.
- C12 existing data: no data written by this PR beyond what Phase 2a routes already do.
- C2 no cron: honoured.
Silent-failure check: every Hub action surfaces the server's error text in the modal and a toast; nothing is swallowed.

## Known gaps
- Other admin list endpoints and scheduled jobs (selftest owner checks, QuickBooks sync, recurring work orders, estimate reminders) are not individually filtered; they are not known to touch demo rows, and the first real slot add is the check. Watch the first real run.
- Phase 3: test-notification button with consent line and per-test limits, seeded work orders, photos, fictional receipt, repopulate-on-reset.
- Tenant/vendor session write scope outside the demo (same class as #529) is a separate follow-up.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261111-demo-hub-screen]** Demo Hub screen + DEMO banner + demo-row hiding. `demoIsDemoRow`/`demoHide` filter demo rows out of `hubBootstrap`, `getWorkOrdersList`, `portalAccessList`, `buildDigest`; owner/tenant login responses carry `demo: true` only for demo rows; owner.html/tenant.html show the banner. Regression rules: (1) a new admin list of owners/tenants/properties/units/work orders that real users see must pass its rows through `demoHide`; keep `demoHide` OUTSIDE the existing Draft filter expression `filtered.filter(r => String(r.Addon_Status || '') !== 'Draft')` (an existing test matches that text). (2) Never hide by anything but the demo markers. (3) No real phone/email in any HTML; the admin types prospect contact. (4) Do not filter the message sweep; the Phase 1 guard skips demo recipients. Tests: `test/demo-hub-screen.test.mjs` (+ manual Playwright script).
