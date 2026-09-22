# Production Write Token Build Brief — v1.0

**Status:** Built, staged as two PRs, pending Brett's secret setup + merge (Sep 22, 2026):
- [Ridge-Co/RidgeCo — feat/hub-prod-write-token](https://github.com/Ridge-Co/RidgeCo/compare/main...feat/hub-prod-write-token) — `HUB_PROD_WRITE_TOKEN` auth-gate addition (POST-only, allow-listed to one path).
- [brett332/gh-broker — feat/hub-prod-post](https://github.com/brett332/gh-broker/compare/main...feat/hub-prod-post) — `hub_prod_post` tool on the existing connector.

**To finish (Brett only — none of this can be done from a session):**
1. Generate a random secret value for `HUB_PROD_WRITE_TOKEN` — a DIFFERENT value from
   `HUB_PROD_RO_TOKEN` and every other token. Treat it with the same care as `WORKER_SECRET` itself:
   it can write to production, even though only to one narrow, reviewed path.
2. Set it as a Cloudflare secret on **`maintenance-hub`** (production).
3. Set the SAME value as a secret on the `gh-broker` Worker. `HUB_PROD_URL` and the `HUB_PROD`
   service binding already exist (set up for `HUB_PROD_RO_TOKEN`) — nothing new needed there.
4. Review both PRs — this one changes the auth gate, so it deserves an actual read, not a rubber
   stamp — and merge (or ask Claude to merge once satisfied — `merge_pull_request` is available).
5. Ask Claude to refresh the GH Broker connector's tool list (`RefreshMcpTools`) so `hub_prod_post`
   becomes callable.

Once that's done, any session can run `hub_prod_post('/admin/backfill-scope-wo-vendor', {})` against
LIVE PRODUCTION with zero standing access to `WORKER_SECRET` — and the same pattern extends to future
paths by adding them to two allow-lists (see "Adding a new path" below), each time reviewed by Brett.

**Governs:** how sessions perform a specific, pre-reviewed, narrow production write — starting with
the one-time scope→WO `Vendor_ID` backfill needed to fix vendor Cesar's zero-work-orders bug — without
ever holding `WORKER_SECRET`. Direct follow-on to `PROD_READONLY_TOKEN_BUILD_BRIEF_v1.0.md`, which
explicitly scoped writes out as "a separate, much more carefully gated brief." This is that brief.
Read `AUTONOMY_GUARDRAILS_v1.0.md` first — this is an auth-gate change (Rung-3 lock: staged as a PR,
never autonomously merged), and unlike the read-only token, it grants real write capability, so it
gets the more conservative posture throughout: a single starting path, no auto-expanding allow-list,
and every future addition treated as its own reviewable change.

## Problem
On Sep 22, 2026, the vendor Vendor_ID sync fix (PR #26) shipped a production fix plus a one-time
backfill endpoint (`POST /admin/backfill-scope-wo-vendor`) to repair existing Work_Orders rows whose
`Vendor_ID` was never set. Running it requires a production write — and no safe credential path
existed to do that from a session: `hub_test_post` only ever reaches staging, and `hub_prod_get` is
structurally GET-only. The only route was Brett pasting the real `WORKER_SECRET` into chat, which is
exactly the thing this repo's own standing convention (and Claude's own policy) refuses, because a
credential pasted to route around a blocked action is treated as a secret that must be rotated, not
used. That refusal is correct, but it left a real gap: Claude had verified, tested, and shipped a safe
one-time fix that nothing could then run. This brief closes that gap the right way — not by relaxing
the refusal, but by giving future sessions a credential narrow enough that using it isn't a judgment
call.

**Why GH Broker's existing GitHub access doesn't already cover this:** GH Broker's broad
`Ridge-Co/*`/`brett332/*` repo read/write is a *source-code* credential — a GitHub App installation
token, scoped by GitHub's own permission model to the Contents/Pulls/Git-Data APIs on those repos. It
lets Claude read, edit, and commit `worker.js`, open PRs, merge them. None of that reaches the Hub's
*live runtime* — the actual Cloudflare Worker execution, its Google Sheets-backed data, or its
`X-Auth-Token`-gated API. Those are governed entirely by the Hub's own, completely separate auth model
(`WORKER_SECRET` and the narrow tokens in its cascade), which lives in Cloudflare secrets that GitHub
access has no path to. Editing and merging code that defines `POST /admin/backfill-scope-wo-vendor` is
a different act from being allowed to call it — the same way editing a login form's source doesn't log
you in. `hub_test_get`/`hub_test_post`/`hub_prod_get` exist precisely because GH Broker's GitHub scope
was never going to bridge that gap; each is its own dedicated forwarding tool holding its own Hub
credential server-side. `hub_prod_post`, built here, is the missing write-capable member of that
family — not an extension of GH Broker's GitHub access, but a new, independent credential broker
using GH Broker's Worker as its home only because it's already a trusted, narrow-tool-per-secret
pattern.

## Goals
1. A session can run a specific, pre-reviewed, allow-listed production write without ever holding
   `WORKER_SECRET`.
2. Structurally incapable of reaching anything beyond that allow-list — not by convention, by
   construction (POST-only method check; path allow-list checked in both the Hub's own server-side
   gate AND `gh-broker`'s client-side tool, so a leaked token is still bounded even if one layer were
   ever bypassed).
3. Zero change to `WORKER_SECRET` itself, `HUB_PROD_RO_TOKEN`, or any other token already in the
   auth-gate cascade — purely additive, same verification discipline as the read-only token (a fresh
   diff-check confirming only additive lines changed).
4. Conservative by default: starts with exactly one path. No mechanism auto-expands it — every future
   addition is a deliberate, reviewed, two-repo change (Hub allow-list + broker allow-list), never a
   config flip.

## Non-goals
- Not a general-purpose production write credential. This is not `WORKER_SECRET` with a smaller
  name — it is closer in spirit to `PROPOSAL_SIGN_TOKEN` or `SCOUT_QUEUE_TOKEN`: one job, one path,
  reviewed once per addition.
- Not for anything touching money, QuickBooks, SMS/Twilio, vendor/tenant/owner PII writes, or
  auth/session/role fields. Any future candidate path touching those stays on `WORKER_SECRET` only,
  full stop — this brief's allow-list is reserved for narrow, idempotent, additive-only utility
  writes in the same class as the backfill endpoint that motivated it.
- Not a replacement for `hub_test_post` — staging read+write testing against `TEST-` fixtures remains
  the right tool for anything exploratory or iterative. This token is for running one specific,
  already-tested production action, not for developing against production.
- Not removing the need for Brett's review on each new allow-listed path. Unlike `HUB_PROD_RO_TOKEN`
  (where "convention going forward" invites a one-line addition per new read-only endpoint because
  the method check alone bounds the blast radius), a write path has no such structural ceiling — each
  addition gets its own look.

## Design

### 1. New scoped Hub token: `HUB_PROD_WRITE_TOKEN`
Same cascade position and inert-until-set pattern as every other narrow token, checked in `worker.js`
just after `HUB_PROD_RO_TOKEN`, before the fallthrough to `WORKER_SECRET`/session-token auth. Distinct
env var and distinct secret value from `HUB_PROD_RO_TOKEN` — never shared, so a leak of one token
never implicates the other, and the Hub's own gate is checking method + path + token identity all
three, not inferring write capability from a read token.

**Allow-listed (write):** `POST /admin/backfill-scope-wo-vendor` only. This endpoint is idempotent
(re-running it is a no-op for rows already backfilled — `scopeBackfillEligible` only ever fills a
currently-blank `Vendor_ID`, never overwrites one that's already set) and additive-only (touches
exactly one field, on rows already identified as eligible by the existing Scope↔WO link — no new rows
created, nothing deleted).

**Never allow-listed under this token:** everything else, by construction — the path check alone rules
out every other write handler, and the method check rules out every GET.

### Adding a new path (future)
Two-repo, two-PR change, same posture as this brief's own rollout — never a one-line addition:
1. Confirm the candidate endpoint is idempotent and additive-only (same bar as above) and touches
   none of the excluded categories in Non-goals.
2. Add it to `HUB_PROD_WRITE_PATHS` in `worker.js` (Hub repo) — PR, reviewed, not auto-merged (Rung-3).
3. Add it to `HUB_PROD_WRITE_PATHS` in `gh-broker/src/index.ts` and update `hub_prod_post`'s tool
   description to name it — PR, reviewed.
4. Both PRs merged before the path actually works end to end (the Hub's own allow-list is the real
   gate; the broker's is a client-side second layer, so either one missing the path means it's
   refused).

### 2. Delivery: extend `gh-broker`, don't stand up a new Worker
Same rationale as `HUB_PROD_RO_TOKEN`: one more Cloudflare secret on an already-trusted Worker, not a
new connector. `HUB_PROD_URL` and the `HUB_PROD` service binding already exist from that build — this
adds only the new secret (`HUB_PROD_WRITE_TOKEN`), the new allow-list, and the new
`hub_prod_post(path, body)` tool, which mirrors `hub_test_post`'s shape exactly (forwards via the
`HUB_PROD` Service Binding — never a raw `fetch()`, for the same Cloudflare-1042 cross-`*.workers.dev`
reason every other Hub-forwarding tool uses one — with `X-Auth-Token: HUB_PROD_WRITE_TOKEN`).

### 3. Verification already run (pre-merge, by a fresh subagent with no memory of writing the code)
- `gh-broker/src/index.ts` on branch `feat/hub-prod-post`: full diff vs `main` is four additive hunks
  (`Env` field, `hubProdPost` function + `HUB_PROD_WRITE_PATHS` const, `TOOLS` entry, `callTool` case)
  — zero deletions/modifications to existing code; `hub_prod_post`'s name matches its `TOOLS` entry
  and `callTool` case exactly, mirroring `hub_prod_get`'s already-verified pattern.
- `worker.js` on branch `feat/hub-prod-write-token`: single additive hunk immediately after the
  `HUB_PROD_RO_TOKEN` check; the new `_prodWriteOk` check requires all four conditions (secret set,
  token matches, method is POST, path in `HUB_PROD_WRITE_PATHS`); the combining `if` gained
  `!_prodWriteOk` alongside all 8 pre-existing narrow-token conditions (including `_prodRoOk`), none
  dropped or altered; correctly scoped inside the existing
  `if (!PUBLIC_PATHS.includes(path)) { if (_tok !== env.WORKER_SECRET) { ... } }` block, before the
  `401` fallback.

## Acceptance criteria
- [ ] A session with only the `gh-broker` connector (no pasted secret) runs
      `hub_prod_post('/admin/backfill-scope-wo-vendor', {})` against production and gets a real
      backfill result back (count of rows updated).
- [ ] Re-running the same call is a no-op (0 rows updated) — confirms idempotency in practice, not
      just by code inspection.
- [ ] The same token, sent as a GET, or against any non-allow-listed path (including
      `/admin/backfill-scope-wo-vendor`'s own read-adjacent neighbors), is rejected — falls through to
      the normal `WORKER_SECRET`/session-token check, which then 401s it.
- [ ] `HUB_PROD_RO_TOKEN`-, `WORKER_SECRET`-, and session-token-authenticated requests are completely
      unaffected — same behavior as before this change, on every existing path.
- [ ] `CODEMAP.md` and `FEATURE_LOG.md` updated with a new rule entry once shipped.

## Rollout
1. ~~Add `HUB_PROD_WRITE_TOKEN` check to `worker.js`~~ — done, staged on `feat/hub-prod-write-token`,
   auth-adjacent so it goes through a PR rather than autonomous-merge per `AUTONOMY_GUARDRAILS_v1.0`.
2. ~~Extend `gh-broker` with the new tool + secret + allow-list~~ — done, staged on `feat/hub-prod-post`.
3. Brett generates `HUB_PROD_WRITE_TOKEN` and sets it as a secret on both `maintenance-hub`
   (production) and `gh-broker` — the one manual step that can't be scripted from here.
4. Brett reviews and merges both PRs.
5. Refresh the GH Broker connector's tool list so `hub_prod_post` becomes callable.
6. Run `hub_prod_post('/admin/backfill-scope-wo-vendor', {})` once to close out the original Cesar
   Vendor_ID gap, and confirm his jobs now show up in both his portal and the admin vendor filter.

## Open questions for Brett
1. OK with a second, prod-scoped, WRITE-capable credential living in `gh-broker`'s secret store,
   alongside `HUB_TEST_TOKEN` and `HUB_PROD_RO_TOKEN`? It's structurally narrow (one path today,
   idempotent, additive-only, no money/SMS/QB/auth), but it's a strictly bigger step than the
   read-only token was, and worth a deliberate yes rather than an assumed one.
2. Is `/admin/backfill-scope-wo-vendor` the right — and only — path to start with, or is there
   another narrow, already-built, idempotent utility write worth including in the same PR?
3. Comfortable with the "no auto-expanding allow-list" posture (every new path is its own two-repo
   PR, forever), or would you rather set a lighter-weight bar for additions once this first one has
   proven out in practice?
