# Ridge Co / BrettOS — Claude Instructions

> **This file auto-loads at the start of every Claude Code session (and is read in Cowork).**
> You do NOT need to be told to "load context" — read this, then load the rest below, before
> touching any code.

## Who / how
Brett runs BMore Management (Ridge Co + fleet + Cabin STR + BarrelCo + Winchester Hauling).
Mobile-first (Samsung Galaxy S23 Ultra, Android Chrome). Brett does NOT paste code — Claude
pushes to GitHub. Deliver complete files, never snippets. Scannable, direct, next concrete
action — no cheerleading. When corrected, change approach; never restate a refuted plan.

## MANDATORY: load context before writing code
1. Read ALL files in `/context/`, starting with `/context/CURRENT.md` (it names the active
   versions of the Context Document, Best Practices, CREDENTIALS_MAP, VENTURES, FEATURE_LOG,
   BACKLOG, CAPTURE_INBOX, HANDWRITING_KEY). Read every file it lists. **Exception:**
   `CREDENTIALS_MAP.md` itself now lives in `brett332/data/CREDENTIALS_MAP.md` (private repo,
   moved Sep 16, 2026) — `context/CREDENTIALS_MAP.md` here is just a redirect stub.
2. **Business / private context** lives in the private repo `brett332/data` (business briefs,
   the `productivity/CLAUDE.md` decoder, Gemini archive, CREDENTIALS_MAP.md) and loads via the
   `brett-context` skill, which reads it through **GH Broker** (`read_file`/`list_directory`
   against `brett332/data`) — no PAT, no clone, no credential ever pasted into a session. If GH
   Broker is down, the PAT fallback protocol lives in `brett332/data/CREDENTIALS_MAP.md`
   (GITHUB section): only when Brett explicitly hands over a token for that purpose, never
   solicited, and rotate it afterward. On a normal day this path should never be needed.
3. Do not write code or make changes until context is loaded and confirmed.

## MANDATORY: "update context" means BOTH stores, every time (Sep 24, 2026)

When Brett says "update context" (or anything equivalent — end of session, wrapping up, log this),
that means updating **both** of the following, not just one:
1. **This repo's `context/` files** (and `brett332/data/business-context/` for cross-venture
   topics) — `FEATURE_LOG.md` (numbered/tagged rule entry), `CURRENT.md` (status section), the
   relevant `*_BUILD_BRIEF_v1.0.md` if one exists or is warranted, `SESSION_STATE.md` checkpoint.
   Use `commit_patch` (old_str/new_str) for the large files (`FEATURE_LOG.md`, `CURRENT.md`) —
   never try to round-trip their full content through `commit_file`.
2. **The claude.ai Project "Continuous Improvement"** (`Projects` tool, `project_write`) — the
   matching doc there, if one exists for this topic.

This repo's `context/`/`business-context/` system is the long-standing, authoritative one (predates
Claude Projects, per Brett). The Claude Project is a second surface Brett also reads/works from —
he wants the two kept in exact sync, not one deprecated in favor of the other. Don't update one and
skip the other because it seems redundant; that's exactly the drift Brett flagged and had corrected
on Sep 24, 2026 (a Claude Project doc had gone stale relative to this repo's real state). If a topic
only has a home in one of the two stores, create the missing counterpart rather than leaving it
one-sided — see `context/SESSION_STATE.md`'s Sep 24 checkpoint for a concrete backlog of docs still
needing this treatment.

## Workflow: PLAN first, then implement
- Scope and design BEFORE editing. Get to the root of what Brett actually wants — surface the
  real goal, constraints, and the smallest change that achieves it — then confirm the plan.
- Typical split: **plan in Cowork (conversational), implement in Claude Code (repo + tests).**
- PAT-024 (verify before build) + PAT-025 (ask clarifying questions first) are mandatory.

## Stack (non-negotiable)
- Frontend: single `index.html` + `vendor.html` on GitHub Pages. No subfolders, no build tools.
- Backend: `worker.js` — Cloudflare Worker, auto-deploys on push to `main`. **Never Wrangler CLI.**
- Database: Google Sheets via service account `brett-os-sheets@brettos-502323.iam.gserviceaccount.com`.
- Repo: `Ridge-Co/RidgeCo`. Sheet ID: `1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4`.
- Worker URL (prod): `https://maintenance-hub.brett-2f8.workers.dev`.
- Worker URL (staging): `https://maintenance-hub-staging.brett-2f8.workers.dev` — separate Cloudflare
  Worker service, own Sheet, own dashboard vars. QB writes/SMS/Gmail send are stubbed there
  (`isStaging()` in worker.js). See PAT-033 below.
- QuickBooks: connected at the Worker level (prod, realm 9130355695406136). The cloud/session
  cannot reach Intuit directly — all QB work goes through Worker endpoints.

## MANDATORY: branch-first + staging-verify (PAT-033)
Any change touching `worker.js`, `index.html`, `vendor.html`, or `wo.html` lands on a branch —
never a direct push to `main`. Verify on the staging Worker (`?api=staging` on the frontend,
curl the staging URL directly for the backend) BEFORE merging to `main`, which is what actually
triggers the production deploy. Not optional, not feature-specific — this is what closed the gap
after the Sept 1, 2026 incident (a push straight to `main`, tested against production only after
the fact). The "Staging sandbox" credentials note lives in `brett332/data/CREDENTIALS_MAP.md`
(moved off this public repo Sep 16).

**Sep 23, 2026 update — staging is now self-serve, Brett's gate moved to the main-merge only.**
`maintenance-hub-staging`'s Cloudflare Build deploys from the `staging` git branch (not `main`,
not the feature branch itself), and `HUB_TEST_TOKEN`/`hub_test_get`/`hub_test_post` (via GH
Broker) give credential-free read+write access to it. Brett's own words: *"push everything to
staging now that we have this safe staging mechanism... find problems during testing on the
staging branch and fix them and come back to me with either problems that need to be resolved
that you cannot resolve yourself, or you can tell me that things are tested and ready and we can
push to main."* So, going forward:
- **Push the feature branch into `staging` yourself, no confirmation needed** — open a PR with
  `base: staging`, `head: <feature branch>` and merge it immediately (`create_pull_request` +
  `merge_pull_request` via GH Broker). This is the step that used to wait on Brett manually
  syncing `staging`; it no longer does.
- **Test on staging and iterate autonomously.** Run `test-verified-builds` against
  `maintenance-hub-staging` (`hub_test_get`/`hub_test_post`, plus Playwright against
  `?api=staging` for UI). If something fails, fix it on the feature branch, re-merge into
  `staging`, and retest — loop until green, same as any other self-test loop. Don't stop to ask
  permission for any of this.
- **Only pause and surface to Brett when:** (a) something is broken that can't be resolved without
  his input (a real decision, a missing credential, an ambiguous requirement), or (b) the build is
  fully tested and green on staging and ready for his go/no-go on merging into `main` — the step
  that actually reaches production. That merge-to-`main` decision is still always his call, per
  PAT-033's original intent; everything before it (branch → staging → test → fix → retest) is not.

**Confirmed Sep 23, 2026 — do NOT assume staging auto-deploys on push, and check this yourself,
never by asking Brett to look at the Cloudflare dashboard.** A direct push to `staging` (via GH
Broker) does NOT reliably show up live within minutes — a push sat undeployed for 2+ minutes in
this session's own test. `main` and `gh-broker` both auto-deploy on push (confirmed separately);
`maintenance-hub-staging` does not reliably, at least not quickly.

**How to check it yourself (the `mcp__Cloudflare_Developer_Platform__*` tools, available in every
session — Brett has never had to open the dashboard for this and shouldn't be asked to):**
1. `workers_get_worker_code(scriptName: "maintenance-hub-staging")` — pulls the ACTUAL deployed
   source directly from Cloudflare's API (the ground truth, not `hub_test_get('/health')`'s
   `build_version`, which is just as reliable but slower to grep through). Grep it for
   `BUILD_VERSION =` and compare against the `staging` branch's own current value. This is the
   right first move whenever a staging test isn't showing an expected change — before assuming
   the code push failed, before asking Brett anything.
2. `workers_list()` / `workers_get_worker(scriptName: ...)` for basic metadata (a recent
   `modified_on` timestamp does NOT mean the code content actually changed — confirmed the two can
   disagree; always verify with `workers_get_worker_code`, don't infer from the timestamp alone).
3. If step 1 shows the deployed code is genuinely stale relative to the `staging` branch, that is
   now a confirmed, narrow finding — not a hunch — and only THEN is it worth telling Brett, and
   only naming the specific unresolved piece: no tool in this session can see Cloudflare's own
   Build logs or trigger a manual redeploy, so if a re-push doesn't resolve it, that specific
   capability gap (build visibility / manual trigger) is what to ask him about — never "can you
   check Cloudflare for me" as a first move when steps 1-2 haven't been tried.

Brett's own words on this (Sep 23, 2026): *"You've come to me several times today to check the
Cloudflare dashboard, but you can check it yourself... I don't want you coming to me with these
issues unless you have already checked, and know why the issue is happening, and cannot resolve
it without my direct intervention."* Treat that as the standing bar for anything infrastructure-
shaped, not staging-specific — diagnose with the tools already in the session before naming an
issue to Brett, and when it does need him, name the exact narrow gap, not the whole symptom.

## Regression rules — DON'T break working features (full log in /context/FEATURE_LOG.md)
- **A silent `catch(e){}`/`catch(_){}` around a Sheets/Drive write is a real blind spot, not a
  safe default** (rule 174, Sep 15 2026): `Payment_Source` never actually got created on the
  live Receipts sheet for weeks — every write silently dropped it, every read silently defaulted
  wrong, and nothing anywhere recorded the failure, because `ensureColumns`'s own call site
  swallowed the error "since the core fields still land." `ensureColumns` and `driveShareAnyone`
  now log a Telemetry row on every failure centrally (in the shared function, not at each of the
  70+ call sites) and `driveShareAnyone` retries once — so a NEW call site automatically gets
  this protection for free, no extra work needed at the call site itself. Before adding a
  `try { await ensureColumns(...) } catch { /* non-fatal */ }` anywhere, know that the failure is
  now logged either way — the swallow only needs to protect the REQUEST from failing, not hide
  the failure from ever being seen. Same logic applies to any other "best-effort, non-fatal"
  write going forward: prefer logging centrally over swallowing at the call site.
- **The weekly ops review (`runWeeklyReview`) already turns 2+ repeated Telemetry failures for
  the same `Job_Type` into a flagged "stuck pattern"** fed to an LLM proposal and (once
  `digest_enabled` is TRUE) delivered to Brett by SMS/email — but delivery is DORMANT by default
  until he turns it on. A logged failure with nobody reading the log is only half a fix; if a
  new silent-failure class turns up again, check whether `digest_enabled` ever got flipped on.
- **WO writes match on `WO_ID`** (ID fallback). Newer Work_Orders rows have a blank ID column;
  ID-only matching silently no-matches → status-not-saving. Do not revert to ID-only.
- **`wrangler.toml` must keep `keep_vars = true`** — without it a deploy wipes dashboard
  secrets (QB, Google SA, Twilio, WORKER_SECRET).
- **Never add `capture="environment"`/`capture="camera"`** to file inputs — breaks mobile
  bulk gallery upload.
- **QB refresh token rotates** — don't treat `QB_REFRESH_TOKEN` env as permanent; `invalid_grant` = re-auth.
- Never change `Vendor_Bills` / `Invoice_Review` column order without updating `worker.js` refs.
- Void re-render uses a full `loadAll()+openWODetail()` refresh, not fragile DOM removal.

## Security note (in progress)
`worker.js` currently gates the whole API with one shared secret that ships to the browser —
bulk read endpoints can leak PII. "Plan B" = per-user auth (session tokens, per-role scoping).
Don't widen this surface; scope new read endpoints to the caller.

## Rules quick-ref
PAT-003 complete files · PAT-004 no Wrangler · PAT-024 verify before build · PAT-025 ask first ·
PAT-026 version numbers in doc filenames · PAT-027 share new Sheets with the service account ·
PAT-028 check current docs for external services · PAT-029 execute self-sufficiently once Brett decides.
