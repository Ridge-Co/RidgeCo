# Allow-List Simplification — Build Brief v1.0

**Status:** ✅ Shipped Sep 24, 2026 — all three changes below complete, verified live, and merged.

**Completion summary:**
- **Change 1** (gh-broker redundant path arrays removed) — direct-committed to `brett332/gh-broker`
  `main`. Verified live: `hub_test_get`/`hub_prod_get` on previously-blocked paths now return the
  Hub's own real response instead of a client-side "not allow-listed" rejection.
- **Changes 2 & 3** (HUB_TEST_TOKEN broadened on staging; HUB_PROD_RO_TOKEN inverted to an 8-path
  deny-list — see Change 3 below for the exact excluded paths) — shipped as PR #55
  (`Ridge-Co/RidgeCo`, sha `f1e23456bbab060d28e827e85a9af207f99ae835`), left open for Brett's own
  review and merge per PAT-033/`AUTONOMY_GUARDRAILS_v1.0` (never auto-merged); Brett merged it
  himself ("go with pr 54 and pr 55"). `node --check` clean; verified live against both staging and
  production post-merge.

Full detail also logged in `FEATURE_LOG.md` ([FL-20260924-1815-as]). The original scoping brief
below remains accurate as historical context for how these changes were investigated and decided.

**Origin:** Brett's ask, verbatim (Sep 23, 2026): "I need a comprehensive list of all the allow
list items you need. I'm tired of running into this and creating a limited scope token for each
little thing that needs to be done... I either need like a CSV import for these tokens so we can
set 50 of them at once in all the necessary repos or workers, or I need a single token that will
do pretty much everything that's needed."

**Investigated finding (do not re-derive — this was already confirmed by reading the actual code
in both repos, Sep 23 2026):** the "50 tokens" framing doesn't match reality. There are **~13
real secrets total** across both repos/workers, and that number has been stable for months. The
actual recurring pain — documented as 5+ separate incidents in `context/CURRENT.md` over the
last month alone — is that **`brett332/gh-broker`'s `src/index.ts` keeps a second, redundant,
client-side copy of 4 of those tokens' path allow-lists**, and that copy drifts out of sync with
`Ridge-Co/RidgeCo`'s `worker.js`, which is the real, authoritative, server-side enforcement point.
gh-broker's own code comments already say this plainly: its copy provides **zero actual security**
— it only produces a friendlier early error. When it goes stale, a request the Hub would have
accepted gets rejected client-side with "path not allow-listed" instead of ever reaching the Hub.

A bulk CSV-secret-import mechanism would solve nothing — there's no secret-provisioning gap here.
The fix is architectural: stop maintaining the redundant copy, and where a real, deliberate scope
broadening make sense, do that instead of an ever-growing explicit array.

---

## Why this needs a human in the loop, not a background build

Every one of the three changes below touches code inside or immediately adjacent to
`worker.js`'s auth gate. Anthropic's own safety classifier blocks agentic sessions from making
auth/security-relevant edits autonomously, even read-only-feeling ones like "delete this
redundant client-side check." That's correct behavior, not a bug to route around. **Build this
turn-by-turn with Brett actively approving each diff**, not as a single unattended subagent
build. Change 1 is safe enough to move quickly through; Changes 2 and 3 should get a real
line-by-line read-through with Brett before anything is committed, since they're genuine scope
broadenings on a token that can reach production.

---

## Change 1 — Remove gh-broker's redundant client-side path arrays (LOW RISK)

**File:** `brett332/gh-broker` → `src/index.ts`
**Ships as:** direct commit to `main` (auto-deploys). This does not touch `worker.js` or change
any actual security boundary — `worker.js` remains the sole real enforcement point throughout.

**What to do:** `src/index.ts` currently defines several tools — `hub_test_get`, `hub_test_post`,
`hub_prod_get`, `hub_prod_post`, and `hub_prod_qb_query` (if present) — each of which, before this
change, checks the requested path against its own hardcoded array (its own copy of
`HUB_TEST_READ_PATHS` / `HUB_TEST_WRITE_PATHS` / `HUB_PROD_RO_READ_PATHS` /
`HUB_PROD_WRITE_PATHS` / `HUB_PROD_QB_RO_PATHS`) and refuses locally with "path not allow-listed"
if it isn't in the array — before the request is even sent to the Hub.

Remove that local array-membership check from each tool. Just forward the request to the Hub
using the same token it already sends, and return the Hub's real response (success or the Hub's
own 401/403/404) back to the caller unchanged. Do not touch:
- which token each tool sends (`HUB_TEST_TOKEN`, `HUB_PROD_RO_TOKEN`, `HUB_PROD_WRITE_TOKEN`, etc.)
- any HTTP-method restriction that's structurally part of the tool itself (e.g. `hub_prod_get`
  should still only ever be able to issue a GET — that's fine to keep, it's not the redundant part)
- any other tool or code path

Update each tool's description string if it currently references "allow-listed paths," so it
still accurately describes what the tool does (the Hub's own server-side check still applies —
just say that instead).

**Before committing:** confirm this repo's typecheck (check `package.json` for a `tsc --noEmit`
or `build`/`typecheck` script) is clean, or if nothing's runnable, re-read the full diff carefully.

**Verify live after deploy:** call each affected tool against a path that IS allowed on the Hub
(should now succeed where it may have failed before) and one that ISN'T (should get the Hub's own
401/403, not a client-side "not allow-listed" message).

---

## Change 2 — Broaden `HUB_TEST_TOKEN` (staging) (MEDIUM RISK — read the safety net first)

**File:** `Ridge-Co/RidgeCo` → `worker.js`
**Ships as:** a branch + PR against `main`. **Do not merge without Brett's own review** — this is
an auth-gate change on the code that (eventually) governs production too, even though this
specific token is staging-only.

**Background:** `HUB_TEST_TOKEN` only works when `isStaging(env, url)` is true (checks
`env.STAGING==='1'` or a "staging" hostname) — it can never reach production regardless of
anything else. It's currently allow-listed to an explicit ~15-path GET array
(`HUB_TEST_READ_PATHS`) and ~25-path POST array (`HUB_TEST_WRITE_PATHS`). Every POST made with
this token additionally passes through `hubTestWriteAllowed(env, path, body)`, a SEPARATE,
independent function that verifies the actual record being written is `TEST-`-prefixed/marked —
this is the real safety net for writes, not the path array.

**Step 1 — verify before changing anything:** read `hubTestWriteAllowed`'s full implementation.
Confirm it **default-denies** — i.e. a path/case it doesn't explicitly recognize returns
`{ok:false}` (or equivalent falsy), not a silent allow. This is the single most important check
in this whole brief. If it does NOT default-deny safely, **do not broaden the POST side** — leave
`HUB_TEST_WRITE_PATHS` exactly as it is, do only the GET-side broadening below, and say so plainly
in the PR description.

**Step 2 — if the default-deny is confirmed safe:**
- GET: remove `HUB_TEST_READ_PATHS`'s role in the gate; grant this token GET access to any path,
  still fully gated by `isStaging()`. Staging data isn't production data, and per `worker.js`'s
  own `isStaging()` comment, money/SMS/QuickBooks/Gmail side effects are already stubbed out
  entirely on staging regardless of what's configured — so even a GET handler with a side effect
  (see Change 3's note on `/notifications/pending`) can't actually message anyone or move money
  from staging.
- POST: only remove `HUB_TEST_WRITE_PATHS`'s role in the gate if Step 1 confirmed safe
  default-deny. `hubTestWriteAllowed` then becomes the sole gate for writes, exactly as it
  already is today for every currently-allow-listed path — this just stops ALSO requiring the
  path to appear in a separately-maintained array first.

**Do not touch:** `isStaging()` itself, `hubTestWriteAllowed`'s actual logic, any other token's
array, `WORKER_SECRET`'s full-access behavior.

---

## Change 3 — Broaden `HUB_PROD_RO_TOKEN` (production reads) (HIGHER RISK — reaches prod)

**File:** `Ridge-Co/RidgeCo` → `worker.js`
**Ships as:** the same branch + PR as Change 2 (or its own PR — reviewer's call), same merge rule:
Brett reviews and merges, never auto-merged.

**Background:** `HUB_PROD_RO_TOKEN` is GET-only and reaches production. Currently allow-listed to
an explicit ~12-path array (`HUB_PROD_RO_READ_PATHS`: `/health,/version,/vendors,/owners,/tenants,
/properties,/units,/workorders,/vendor-bills,/invoices,/vendor-performance,
/admin/receipt-duplicate-audit/flags`). This is the one token in the whole cascade actually built
*because* Brett had to paste `WORKER_SECRET` mid-session once (the exact failure mode this whole
brief is trying to prevent from recurring) — so get this one right.

**What to do:** scan every `GET` route in `worker.js`'s router (the full `if (path === '/xyz')
return await someHandler(...)` list under `request.method === 'GET'`). For each one, confirm it's
a pure read with no side effect (no SMS send, no email send, no Sheets write, no QuickBooks call,
no notification trigger) by actually reading the handler function, not guessing from its name.

**Known suspect, verify explicitly:** `/notifications/pending` calls `processPendingNotifications`
— a prior investigation flagged this as possibly having a side effect. Read it and confirm one way
or the other before deciding whether it's excluded.

Build an explicit **EXCLUDE list** of any confirmed-side-effecting GET routes (comment each one
with why), then grant `HUB_PROD_RO_TOKEN` access to every *other* GET route — i.e. invert from an
allow-list to a deny-list, but only for the genuinely side-effecting ones. **If you're not fully
confident a route is side-effect-free, leave it excluded** — err narrow, not broad.

**Do not touch:** `HUB_PROD_WRITE_TOKEN`'s array, `HUB_PROD_QB_RO_TOKEN`'s array, or anything about
how POST/write handlers are gated — this change is GET-surface only, which is what makes it safe
by construction (a GET request can never match a write handler no matter how broad its own
allow-list gets).

---

## PR requirements for Changes 2 & 3

- Branch name suggestion: `feature/broaden-test-and-prod-ro-tokens`
- Run `node --check worker.js` against the actual committed branch content (read it back, don't
  just trust the local edit) before opening the PR — this repo's own convention.
- PR description must state: what changed, why (link back to the repeated allow-list-gap
  incidents in `context/CURRENT.md`), what was verified, the full EXCLUDE list from Change 3 with
  reasoning for each entry, and whether Change 2's POST-side broadening happened or was skipped
  (and why, per Step 1 above).
- **Left open for Brett's own review and merge — never auto-merged.** Same policy as every other
  auth-gate change in this repo (PAT-033 / `AUTONOMY_GUARDRAILS_v1.0`).

---

## Acceptance criteria (what "done" looks like)

1. Change 1 live on gh-broker's `main`, confirmed via a real `hub_test_get`/`hub_prod_get` call
   against a path that's allowed on the Hub but wasn't in gh-broker's old array (should now work).
2. PR open on `Ridge-Co/RidgeCo` for Changes 2 & 3, `node --check` clean, EXCLUDE list documented,
   Step 1's default-deny finding stated explicitly.
3. Brett reviews and merges that PR himself when ready.
4. After merge: re-run the specific incidents logged in `context/CURRENT.md` (the receipt-recon
   family gap, the WO Combine/Split gap, the vendor-onboarding gap) and confirm each now succeeds
   through gh-broker with no allow-list edit needed — proving the fix actually closes the loop
   rather than just moving the gap somewhere else.
5. Going forward: a brand-new endpoint reachable by GET on staging or by GET (non-side-effecting)
   on production needs **zero code change here at all** to become usable through GH Broker.

---

## What NOT to do

- Do not create a single "does everything" token (effectively reissuing `WORKER_SECRET` to
  sessions) — this was evaluated and explicitly rejected: it would remove the bounded blast
  radius that's the entire reason this token cascade exists. If Brett wants to revisit that
  tradeoff, that's his call to make explicitly, not something to build by default.
- Do not touch `HUB_PROD_WRITE_TOKEN` or `HUB_PROD_QB_RO_TOKEN`'s arrays — those stay narrow and
  hand-reviewed per entry, which is the one place this friction is actually earning its keep
  (production writes and QuickBooks access).
- Do not attempt to push Changes 2/3 through as an unattended background build — go turn-by-turn
  with Brett watching the diff.
