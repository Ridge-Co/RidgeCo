# Owner page Tenants tab would not load: a GET was sent with a body (Nov 12 2026) — PR into main (staging twin listed in the PR), head `fix/owner-tenants-tab-get-body-nov12` (cut from main tip 107d4c1), merged: no

Found by Brett on the first demo login (Nov 12): the owner portal Tenants tab showed "Could not load your properties: Failed to execute 'fetch' on 'Window': Request with GET/HEAD method cannot have body". It is NOT demo-specific: `tenant-roster.js` calls `call('GET', path, null)` and owner.html's `api()` turned the null into a request body ("null"); browsers refuse a body on a GET, so the Tenants tab never loaded for any owner (added in the owner tenant-roster feature; every other owner call passes no body on a GET).

## CURRENT
Fix: owner.html `api('GET'|'POST', path, body)` only attaches a body when it is not undefined/null and the method is not GET. One line. Test `test/owner-api-get-no-body.test.mjs` (4 checks) runs the real `api()` against a fetch that throws on a GET with a body like the browser does: fails on old owner.html, passes now; POST still carries its JSON body. Full suite 343/343.
NOT verified: not clicked through on the live owner page; Brett reloads the owner portal and opens the Tenants tab after merge.

## Pre-build gate
Shapes: `ui` (client-side helper only). No server, data, message or cron change. Fail-closed/open: N/A. Not GATED. Silent-failure check: the original error was already shown to the user (banner); nothing swallowed.

## Known gaps
tenant.html / vendor.html / index.html `api()` helpers were not changed; the same null-body-on-GET pattern is not known there (tenant-roster is only mounted on owner.html and the Hub, whose helper already handled it).

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261112-owner-api-get-no-body]** owner.html `api()` never sends a body on a GET (null/undefined body ignored). Regression rule: a shared UI module that calls `call('GET', path, null)` must work with every page's `api()`; test `test/owner-api-get-no-body.test.mjs`.
