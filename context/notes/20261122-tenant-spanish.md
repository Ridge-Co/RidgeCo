# Tenant portal Spanish layer + EN/ES toggle (queue #105) — Nov 22 2026 — PR -> main, head `feat/tenant-spanish` (cut from main tip 02f94e7), merged: no

## CURRENT
**Status: built and tested with mocked data in a browser; not tried on staging or with a real tenant. Tenant-facing page, so no session merges it: it waits for Brett (and the Spanish wording needs his or a native speaker's review).**

- New `tenant-i18n.js`: exact-match Spanish dictionary (`TENANT_ES`), own global names, MutationObserver for text drawn later, alert/confirm/prompt wrapper. Opt-in: English is the default; the choice is kept in this browser's localStorage under `ridgeco_tenant_lang` (no Tenants column, no schema change). A blocked storage write is logged to the console and the tab keeps working.
- `tenant.html`: loads the layer; an EN | ES toggle on the login card and in the dashboard header (44px buttons).
- Display only: names, addresses, notes, work-order text and stored status values are never changed (only exact dictionary matches translate).
- `vendor.html`: NOT changed. The brief asked for a vendor toggle, but main already has one (`loginLangToggle`, Nov 16 2026), so that part was already done.
- Tests: `test/tenant-i18n.test.mjs` (7 checks, including "every visible static string in tenant.html has a Spanish entry", so a new English label fails CI), `test/manual-verify-tenant-i18n-ui.mjs` (5 browser checks, mocked API).
- Known gaps: dynamic phrases with a variable part (for example "Submitted Thu, Oct 1, 2026 · WO-1") stay English; owner.html not included (brief said follow-up).

## Pre-build gate
Shapes: `ui` `list`. Scheduled blitz run, nobody to ask: defaults taken. The brief's open questions: (1) no auto-switch from the browser language (opt-in); (2) owner.html left as a follow-up; (3) Spanish strings flagged for Brett's review in the PR.
Items that are N (known gaps):
- Dynamic phrases with variable parts: N (listed above).
- Tenant language stored on the server (so texts and emails follow it): N on purpose (schema change, gated).
- owner.html: N (follow-up).
Standing parameters: C1 n/a; C2 no job; C3 failures logged (storage); C4 n/a (no writes to the Hub); C5 fail to English; C6 n/a (no spend shown); C7 no personal data touched; C8 branch, PR to main, Brett merges; C9 tenant-facing, left for Brett; C10 reuses the vendor-i18n engine pattern; C11 English is the safe blank; C12 no data touched; C17 n/a.
Companion actions included: persistence across reload and logout/login, toggle before login, toggle in header, storage-blocked fallback.

## Late requests
None yet.
