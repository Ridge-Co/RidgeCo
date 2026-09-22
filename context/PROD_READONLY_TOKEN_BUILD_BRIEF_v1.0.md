# Production Read-Only Token Build Brief — v1.0

**Status:** Built, staged as two PRs, pending Brett's secret setup + merge (Sep 22, 2026):
- [Ridge-Co/RidgeCo#20](https://github.com/Ridge-Co/RidgeCo/pull/20) — `HUB_PROD_RO_TOKEN` auth-gate addition (GET-only, allow-listed).
- [brett332/gh-broker#4](https://github.com/brett332/gh-broker/pull/4) — `hub_prod_get` tool on the existing connector.

**To finish (Brett only — none of this can be done from a session):**
1. Generate a random secret value for `HUB_PROD_RO_TOKEN` (any long random string — treat with the
   same care as `WORKER_SECRET` itself, since it reaches production, even though it can only read).
2. Set it as a Cloudflare secret on **`maintenance-hub`** (production) — this is the one difference
   from the `HUB_TEST_TOKEN` pattern, which is staging-only; this token is deliberately prod-only.
3. Set the SAME value as a secret on the `gh-broker` Worker, plus `HUB_PROD_URL` (a plain var — already
   defaulted to `https://maintenance-hub.brett-2f8.workers.dev` in `wrangler.jsonc`) and the
   `HUB_PROD` service binding (already added to `wrangler.jsonc` — Cloudflare picks it up on next deploy,
   no dashboard step needed for the binding itself, only for the secret).
4. Review and merge both PRs (or ask Claude to merge once satisfied — `merge_pull_request` is available).
5. Ask Claude to refresh the GH Broker connector's tool list (`RefreshMcpTools`) so `hub_prod_get`
   becomes callable.

Once that's done, any session can run `hub_prod_get('/vendor-performance')` (or any allow-listed path)
against LIVE PRODUCTION, read-only, with zero standing access to `WORKER_SECRET`.

**Governs:** how sessions verify a just-shipped, read-only production admin endpoint's acceptance
criteria without ever holding `WORKER_SECRET`. Companion to `TEST_INFRASTRUCTURE_BUILD_BRIEF_v1.0.md`
(which solved the same problem for staging read+write); this closes the one case that one doesn't
reach — a change that's already merged to production and needs a live pass before being reported done.
Read `AUTONOMY_GUARDRAILS_v1.0.md` first — this brief adds a narrow, additive, GET-only credential
alongside `WORKER_SECRET`; it does not loosen, replace, or touch the admin gate's existing checks
(`WORKER_SECRET` still works exactly as it does today, unmodified), consistent with that file's Rung-3
lock on "any change to auth... or the auth gate" — the change here is staged as a PR, not autonomously
merged, exactly as `HUB_TEST_TOKEN` was.

## Problem
On Sep 21-22, 2026, the B-012 Vendor Performance dashboard build shipped a new production endpoint
(`GET /vendor-performance`) and needed a live pass to confirm its 6 acceptance criteria. The only
existing test path, `hub_test_get`, forwards exclusively to `maintenance-hub-staging` (a Service
Binding to a *different* Worker, running whatever code was last manually synced there — not
necessarily the code that was just merged to `main` and auto-deployed to production). There was no
tool that could reach the real, just-deployed production endpoint without a live `WORKER_SECRET` —
so the session had to ask Brett to paste it, repeatedly, mid-session, which is exactly the standing
house convention flags for rotation every time it happens, and exactly the friction Brett asked to
have eliminated ("I want you to fucking test it" / "never asking me for passwords that you already
have"). This brief closes that specific gap: **read-only verification of PRODUCTION**, not staging.

## Goals
1. Any session can run GET-only smoke/acceptance checks against production endpoints without ever
   holding `WORKER_SECRET`.
2. Structurally incapable of writing anything — not by convention, by construction (GET-only method
   check; no POST/PUT/DELETE handler in `worker.js` is reachable via a GET request regardless of path).
3. Zero change to `WORKER_SECRET` itself, its rotation, existing session-token auth, or any other
   narrow token already in the auth-gate cascade (`CONTACTS_SYNC_TOKEN`, `TRASH_NUDGE_TOKEN`,
   `OPS_QUEUE_TOKEN`, `SCOUT_QUEUE_TOKEN`, `PROPOSAL_SIGN_TOKEN`, `CRON_SWEEP_TOKEN`, `HUB_TEST_TOKEN`)
   — purely additive, verified by a fresh subagent diff-check to be the only lines changed in each file.

## Non-goals
- Not a write path of any kind. If a future build needs a staging-style write+read-back smoke test
  against *production* specifically, that's a separate, much more carefully gated brief — this one
  only ever reaches `GET`.
- Not a replacement for `hub_test_get`/`hub_test_post` — staging read+write testing against `TEST-`
  fixtures remains the primary path for anything that writes. This is for the read-only confirmation
  pass on what's already live.
- Not touching the Playwright/headless-browser UI verification approach (separate, already proven —
  see `test-verified-builds` skill) — this is API-level only.

## Design

### 1. New scoped Hub token: `HUB_PROD_RO_TOKEN`
Follows the exact pattern already established by `HUB_TEST_TOKEN` (which itself followed
`OPS_QUEUE_TOKEN`/`CONTACTS_SYNC_TOKEN`): a brand-new, independent env var, inert until set, checked
in `worker.js`'s auth-gate cascade before falling through to `WORKER_SECRET`. Two differences from
`HUB_TEST_TOKEN`: (a) it is NOT staging-gated — the whole point is reaching production — and (b) it is
GET-only with no record-level write guard needed, since it can never reach a write handler at all.

**Allow-listed (read-only):** `GET /health, /version, /vendors, /owners, /tenants, /properties,
/units, /workorders, /vendor-bills, /invoices, /vendor-performance` — mirrors `HUB_TEST_READ_PATHS`
plus the newly-shipped `/vendor-performance` endpoint. **Convention going forward:** any future build
that ships a new read-only admin/reporting endpoint intended for self-test verification should add its
path to `HUB_PROD_RO_READ_PATHS` in the same PR that builds it — this is a one-line addition, not a
separate Brett-gated step, since the token stays GET-only and allow-listed either way.

**Never allow-listed under this token:** anything not `GET`, by construction — the method check alone
rules out every write path, QB/payment/invoice endpoints, `/admin/*`, `/config` writes, auth/role
endpoints, and PIN-login flows.

### 2. Delivery: extend `gh-broker`, don't stand up a new Worker
Same rationale as `HUB_TEST_TOKEN`: `gh-broker` already holds `HUB_TEST_TOKEN` server-side for staging
exactly this way — adding a second, prod-scoped, read-only sibling token costs one more Cloudflare
secret and a Service Binding, not a new connector.

New `gh-broker` secret: `HUB_PROD_RO_TOKEN` (must match the value set on production `maintenance-hub`).
New `gh-broker` var: `HUB_PROD_URL` (already added to `wrangler.jsonc`, defaulted to the known
production URL from `CREDENTIALS_MAP.md`). New `gh-broker` binding: `HUB_PROD` → service
`maintenance-hub` (already added to `wrangler.jsonc` — Service Binding, not a raw `fetch()`, for the
same Cloudflare-1042 cross-`*.workers.dev` reason `HUB_STAGING` uses one).
New `gh-broker` tool: `hub_prod_get(path)` — forwards to `HUB_PROD` with `X-Auth-Token:
HUB_PROD_RO_TOKEN`, allow-list enforced client-side too as a second layer, mirroring `hub_test_get`.

### 3. Verification already run (pre-merge, by a fresh subagent with no memory of writing the code)
- `gh-broker/src/index.ts` on branch `feat/hub-prod-readonly-token`: `tsc --noEmit` clean; full diff
  vs `main` is 4 hunks, every line a pure addition, zero deletions/modifications; new `hub_prod_get`
  function name matches its `TOOLS` entry and `callTool` case exactly.
- `worker.js` on the same branch: `node --check` clean on the full 1,179,144-byte file; full diff vs
  `main` is exactly one hunk (+2 lines net after the cosmetic comment pass, or +11 lines including the
  explanatory comment); the new `_prodRoOk` check requires all four conditions (secret set, token
  matches, method is GET, path allow-listed); the combining `if` gained `!_prodRoOk` alongside all 7
  pre-existing narrow-token conditions, none dropped or altered; correctly scoped inside the existing
  `if (!PUBLIC_PATHS.includes(path)) { if (_tok !== env.WORKER_SECRET) { ... } }` block, before the
  `401` fallback — not a duplicate, not a scope break.

## Acceptance criteria
- [ ] A session with only the `gh-broker` connector (no pasted secret) runs `hub_prod_get('/vendor-
      performance')` (or any allow-listed path) against production and gets real, current data back.
- [ ] The same token, sent as a POST or against a non-allow-listed path, is rejected (falls through
      to the normal `WORKER_SECRET`/session-token check, which then 401s it).
- [ ] `WORKER_SECRET`-authenticated requests are completely unaffected — same behavior as before this
      change, on every existing path.
- [ ] `CODEMAP.md` and `FEATURE_LOG.md` updated with a new rule entry once shipped.

## Rollout
1. ~~Add `HUB_PROD_RO_TOKEN` check to `worker.js`~~ — done, staged on `feat/hub-prod-readonly-token`,
   additive, auth-adjacent so it goes through a PR rather than autonomous-merge per
   `AUTONOMY_GUARDRAILS_v1.0` (same posture as `HUB_TEST_TOKEN`'s rollout).
2. ~~Extend `gh-broker` with the new tool + secret + binding~~ — done, staged on the matching branch.
3. Brett generates `HUB_PROD_RO_TOKEN` and sets it as a secret on both `maintenance-hub` (production)
   and `gh-broker` — the one manual step that can't be scripted from here.
4. Brett reviews and merges both PRs.
5. Refresh the GH Broker connector's tool list so `hub_prod_get` becomes callable.

## Open questions for Brett
1. OK with a second, prod-scoped copy of a Hub-reaching credential living in `gh-broker`'s secret
   store, alongside `HUB_TEST_TOKEN`? (It's strictly narrower than `WORKER_SECRET` — GET-only,
   11 allow-listed paths, no write path exists for it to reach — but it's still a new standing
   credential, which is itself a decision worth confirming rather than assuming.)
2. Is the initial 11-path allow-list right, or should anything be added/removed before merge?
