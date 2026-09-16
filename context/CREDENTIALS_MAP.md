# BrettOS Credentials Map
**Version:** v1.5 | **Last Updated:** Sep 16, 2026
**Rule:** This file maps every service Claude may need to interact with, where credentials are stored, and current access status. Update this file whenever a new service is connected or credentials change. Never store actual secret values here — only the map.

---

## GOOGLE SHEETS

**Purpose:** Primary database for all BrettOS ventures
**Auth method:** Service account (server-to-server, no user login required)

> ⚠️ **THERE ARE TWO SERVICE ACCOUNTS — they are NOT the same, and using the wrong one is a silent "caller does not have permission" error. Confirmed July 21, 2026 during the B-103 staging build.**
>
> | Mechanism | Service account (share NEW sheets with this) | GCP project | Where its key lives |
> |---|---|---|---|
> | **Cloudflare Worker RUNTIME** — every live read/write the Worker does (all `/…` endpoints, `/intake`, Drive uploads) | **`maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com`** | `maintenance-hub-498819` | Cloudflare env `GOOGLE_SA_EMAIL` + `GOOGLE_SA_KEY` (the Worker signs its JWT with `iss = GOOGLE_SA_EMAIL`, worker.js ~L2279) |
> | **GitHub Actions sheet-ops** — column adds / bulk writes via `context/sheet-ops/pending.json` → `run_ops.py` | `brett-os-sheets@brettos-502323.iam.gserviceaccount.com` | `brettos-502323` | GitHub Actions org secret `GOOGLE_SA_KEY` (Ridge-Co org) |
>
> **Rule of thumb:** if the **Worker** needs to read/write a sheet at runtime, share it with the **maintenance-hub-498819** account. If a **sheet-op** (pending.json) needs to touch it, share it with the **brettos-502323** account. When unsure, share the sheet with **both** as Editor.

**Expiry:** Service account keys do not expire unless manually rotated
**Access status:** ✅ Active
**Requirement (PAT-027):** Every new Google Sheet must be shared as Editor with the correct service account(s) above **before** any Worker read or sheet-op will succeed. The old single-account guidance ("brett-os-sheets only") was incomplete and caused the B-103 staging permission error.

### Known Sheets
| Sheet Name | Sheet ID | Shared? |
|---|---|---|
| RidgeCo Main | `1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4` | ✅ Yes |

---

## GITHUB

**Purpose:** Code hosting, auto-deploy, context storage, GitHub Actions automation

**Auth method (current, as of Sep 16, 2026): GH Broker.** A custom MCP connector (`brett332/gh-broker`, a Cloudflare Worker) mints short-lived GitHub App installation tokens server-side — no PAT, no git clone, no session ever holds or pastes a credential. Exposes 8 tools: `read_file`, `list_directory`, `create_branch`, `commit_file`, `delete_file`, `create_pull_request`, `get_pull_request`, `merge_pull_request`. Two separate GitHub App installs behind one Worker: `GH_INSTALLATION_ID_RIDGECO` covers all `Ridge-Co/*` repos, `GH_INSTALLATION_ID_BRETT332` covers all `brett332/*` repos — a new repo under either owner works immediately with no config change. A repo under a third owner needs a new GitHub App install plus one added line in `installationIdFor()` (`brett332/gh-broker/src/index.ts`). **This replaces the git-over-HTTPS/pasted-PAT approach entirely** — the PAT fallback below is a secondary path only, not the default anymore.

**Where GH Broker's own credentials live:** `GH_APP_ID`, `GH_PRIVATE_KEY`, `GH_INSTALLATION_ID_RIDGECO`, `GH_INSTALLATION_ID_BRETT332`, `BROKER_KEY` — all Cloudflare Worker env vars on the `gh-broker` Worker, plus the connector's own auth config. Never in a repo, never in chat.

**Writes:** `commit_file` commits directly to a branch (default `main`), auto-creating that branch from `base` (default `main`) if it doesn't exist yet — auto-resolves the file's current `sha` server-side too, so no separate read-before-write is needed. `create_pull_request` opens a PR instead when a review step is wanted; `get_pull_request` checks state/mergeability/CI status; `merge_pull_request` merges it. `delete_file` removes a file. Every handler returns a clean error instead of crashing — a failure here is never a credentials problem, it's always a specific, readable message.

> **⛔ Never use the built-in `github` MCP tool or the `add_repo` tool for `Ridge-Co/*` or `brett332/*` repos — GH Broker is the only path for these, always.** Confirmed Sep 16, 2026: `add_repo` hard-refuses to mix repos from different owners into one session ("cross-tier adds are not supported in v1") — a Claude Code Remote platform limit with no setting to disable. GH Broker is not subject to this restriction at all — it already reads/writes across `Ridge-Co/RidgeCo`, `brett332/data`, and `brett332/gh-broker` in the same session with zero friction. The built-in `github` tool + `add_repo` is reserved for a repo GH Broker doesn't cover (a third owner with no GitHub App install yet) — reaching for it on a `Ridge-Co`/`brett332` repo is always the wrong move and will hit this wall.

**Known gap (Sep 16, 2026):** an MCP session caches the tool list from the Worker's `tools/list` response at connect time. If a tool (e.g. `merge_pull_request`) is added to the Worker's `TOOLS` array after a session's connector last attached, that session stays stuck seeing only the older tool set until the connector is disconnected/reconnected in **Settings → Connectors**. Confirmed live 2026-09-16 twice: once for `list_directory`, again for `create_branch`/`delete_file`/`get_pull_request`/`merge_pull_request`. Not a broker bug — expected after any Worker deploy that changes the tool surface. A fresh session started after the deploy always sees the current tool list with no action needed; only a session that was already connected before the deploy needs the manual reconnect.

**Fallback — classic PAT via git Basic-auth.** Only when GH Broker itself is down, AND only when Brett explicitly hands over a PAT in-session and directs it be used for that purpose. **Standing rule: never solicit a pasted PAT to route around a blocked operation, and never use one pasted unprompted.** When Brett does authorize one, use it via git Basic-auth (not Bearer) — confirmed working from a Cowork chat session 2026-09-02 despite the proxy blocking plain unauthenticated pushes:
```
TOKEN="<brett's pasted classic PAT>"
AUTH=$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')
git -c http.extraHeader="Authorization: Basic ${AUTH}" push origin HEAD:main
```
Never store the token in any file, never commit it, never print/echo its value. Worth rotating this token periodically given how many times it's been pasted into chat historically.

**Last-resort fallback — no PAT, GH Broker down.** Use the patch/paste-ready-file recovery playbook (`ridgeco-git-push-proxy-bug.md`): export local commits as a patch, verify against a fresh anonymous clone of current `origin/main`, deliver a self-contained paste-ready reconstruction file for Brett to run himself via claude.ai/code's repo picker.

**CRITICAL:** `Ridge-Co/RidgeCo` is PUBLIC. Never write any token, key, or `BROKER_KEY` value into any file in that repo, or commit it.

**Access status:** ✅ GH Broker = primary path, full CRUD + branch/PR lifecycle, no PAT needed per session (confirmed working 2026-09-16). PAT-via-Basic-auth and the patch-file playbook remain as fallbacks only.

**Auto-deploy:** ✅ LIVE (unchanged since July 19, 2026). Fixed by adding `wrangler.toml` (with `keep_vars = true` so deploys never wipe dashboard secrets) and connecting **Cloudflare → maintenance-hub → Settings → Build → Git repository** = `Ridge-Co/RidgeCo`, branch `main`, deploy cmd `npx wrangler deploy`. Every push to main now auto-builds + deploys the Worker. (`.html` frontend deploys separately via GitHub Pages.) The `gh-broker` Worker itself auto-deploys the same way from `brett332/gh-broker`, branch `main` — confirmed redeploying within ~20s of a push.

### Known Repos
| Repo | Purpose | Auto-deploy? |
|---|---|---|
| `Ridge-Co/RidgeCo` | Main BrettOS repo — Worker, frontend, context | ✅ Cloudflare Worker + GitHub Pages |
| `brett332/gh-broker` | GH Broker itself — the MCP connector Worker that provides GitHub read/write to every session | ✅ Cloudflare Worker |
| `brett332/data` | Private business context repo (per-venture briefs, Gemini archive) | — |

---

## CLOUDFLARE WORKER

**Purpose:** Backend API for all BrettOS frontends
**Worker name:** `maintenance-hub` (or similar — verify in Cloudflare dashboard)
**Live URL:** `https://maintenance-hub.brett-2f8.workers.dev`
**Auth method:** Deploy via GitHub push — no direct Cloudflare API access needed
**Worker secrets:** Set in Cloudflare dashboard → Workers → maintenance-hub → Settings → Variables and secrets. Global to the Worker (shared across the production deployment AND all preview/branch deployments — there is NO dashboard way to scope a var to preview-only; confirmed July 21, 2026). Claude cannot set these — Brett adds via dashboard.
**Runtime service account:** `GOOGLE_SA_EMAIL` = `maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com` (see the TWO-service-accounts table under GOOGLE SHEETS). This is the identity the Worker uses for **both** Sheets and Drive.
**Known worker vars/secrets (verified July 21, 2026):** `SHEET_ID`, `STAGING_SHEET_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY`, `DRIVE_PROPERTIES_ROOT`, `DRIVE_VENDORS_ROOT`, `KEY_REGISTRY_SHEET_ID`, `WORKER_SECRET`, `INTAKE_TOKEN`, `TWILIO_SID`, `TWILIO_AUTH`, `TWILIO_FROM`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REALM_ID`, `QB_REFRESH_TOKEN`, `CONTACTS_SYNC_TOKEN`.
**`CONTACTS_SYNC_TOKEN` (added Aug 6, 2026):** dedicated narrow-scope secret for the Google Contacts sync (Apps Script under brett@bmoremanagement.com). Worker accepts it for **exactly two things** (auth gate ~L49): (1) **GET** on `/tenants`, `/owners`, `/vendors`, `/properties`, `/units`, and (2) **POST `/contact/augment`** — an augment-ONLY write that fills blank fields from an allow-list (`Email` only), never overwrites, never touches phone/ID, never creates rows, logs to `Contact_Augment_Log`. Nothing else — every other path/method 401s. Fully inert unless the env var is set. Independent of `WORKER_SECRET` — rotate/revoke alone without affecting portals or admin. Same value stored in the Apps Script Script Property `WORKER_SECRET`. Auth-boundary + augment guarantees smoke-tested live Aug 6 (reads 200; other writes/paths/no-token 401; overwrite refused with read-back; Phone/ID rejected from augment). **Do NOT set `STAGING=1`** as a global var — it would flip production into staging mode (reads `STAGING_SHEET_ID`, breaks the live Hub). Staging is auto-detected from the `staging-` preview hostname instead (worker.js ~L45).
**Staging sandbox (B-103):** the `staging` branch deploys to `https://staging-maintenance-hub.brett-2f8.workers.dev`; the Worker detects that hostname and swaps `SHEET_ID`→`STAGING_SHEET_ID` and suppresses SMS. Staging sheet `16PCD3tIDatZLhMeHdbeYC-4R4BVNCcZ26iBY90H6dFY` must be shared with the runtime SA above.
**Expiry:** N/A — deploy is always current with repo main branch
**Access status:** ✅ Active (via GitHub push)

---

## QUICKBOOKS ONLINE

**Purpose:** Invoice creation, bill recording, vendor sync for Ridge Co
**Auth method:** OAuth2 refresh token. **The refresh token ROTATES** — worker.js treats env `QB_REFRESH_TOKEN` as the initial seed; persistence of the rotated token (to a QB_Config store) ships with the write flow. If QB endpoints 400 with `invalid_grant`, re-auth.
**Intuit Developer App:** BrettOS Automation
**Company:** Saint Thomas Ventures LLC DBA Ridge Co.  **Realm/Company ID:** `9130355695406136`
**Secret location:** **Cloudflare Worker env (NOT GitHub)** — `QB_CLIENT_ID`, `QB_REALM_ID` (plaintext); `QB_CLIENT_SECRET`, `QB_REFRESH_TOKEN` (encrypted). The Worker calls Intuit directly; the cloud session CANNOT reach Intuit, so all QB work runs through Worker endpoints.
**Endpoints (worker.js):** `GET /qb/test` (company name), `GET /qb/accounts` (chart of accounts), `GET /qb/setup-trades` (idempotent — created 10 trade income sub-accounts under "Services" + 12 service items). Listed in `PUBLIC_PATHS` (bypass WORKER_SECRET so browser/Intuit reach them) — lock down/remove the diagnostic ones (test/accounts) after the build.
**Trade→account map:** hardcoded as `QB_TRADE_MAP` in worker.js (12 trades → item id / income acct / expense acct). Invoices reference the item; vendor bills reference the expense account directly.
**Access status:** ✅ **CONNECTED — PRODUCTION** (July 19, 2026). Assessment questionnaire cleared ("no further action required") because it's a single-company self-use app.
**Next step (July 20):** Send-to-QuickBooks flow — invoice + bill creation (PREVIEW-FIRST), customer/vendor find-or-create, vendor-pay worklist with overpay guard, payment webhooks for auto status-back. Unblocks B-001/B-002/B-015.

---

## GOOGLE DRIVE

**Purpose:** Human-readable document storage (not AI context — use GitHub for that)
**Auth method:** Claude connects via Drive MCP as `info@bmoremanagement.com`
**Limitations:** Read + create only. Cannot rename, move, or delete existing files.
**Brett AI Context folder ID:** `1iFFIwzUN4EKhJEgfCAqlUdkt8cyMNClX`
**Access status:** ✅ Active (read/create only)
**Note:** AI context lives in GitHub, not Drive. Drive is for human-facing docs only.

---

## GMAIL / GOOGLE WORKSPACE

**Auth method:** Gmail MCP connected as `info@bmoremanagement.com`
**Access status:** ✅ Active (via MCP)
**Capabilities:** Read, search, draft, label threads

**RidgeCo ops email — `ridgecomaintenance@gmail.com` (created Aug 7, 2026).** The operational address
for all Ridge Co activity (kept separate from `brett@bmoremanagement.com` on purpose). Receive + manual
send work today with no setup. **Automated sending** is planned via the **Gmail API (OAuth refresh
token)** called directly from the Worker — **no domain, no ESP middleman** (fits security-first: it's
Google, where the business already lives). Requires a one-time OAuth client + refresh token for this
account, stored as Worker secrets (`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` /
`GMAIL_SENDER`). **Never store the token here — Worker secrets only.** Free-Gmail send cap ≈500/day.
Scope internal-first (digest / weekly review / agent output → Brett's inbox); owner/tenant/vendor +
owner/tenant/vendor sends via this Gmail stay MANUAL until Brett enables. **Hive / CHEP fleet-and-van comms stay on `brett@bmoremanagement.com`** (Brett's directive, Aug 7) — do NOT route them through the RidgeCo Gmail. Build tracked as B-210.

---

## GOOGLE CALENDAR

**Auth method:** Google Calendar MCP connected as `info@bmoremanagement.com`
**Access status:** ✅ Active (via MCP)

---

## UPLISTING (Cabin STR)

**Purpose:** Airbnb/VRBO channel manager for WV Cabin
**Auth method:** Unknown — not yet connected
**Access status:** ❌ Not connected
**Next step:** When needed, check Uplisting API docs and connect

---

## EBAY / CRAIGSLIST (BarrelCo)

**Purpose:** Listing management for barrel/planter resale
**Auth method:** Not yet connected
**Access status:** ❌ Not connected

---

## ADDING A NEW SERVICE

When Brett connects a new service, update this file with:
1. Service name and purpose
2. Auth method (API key / OAuth2 / service account)
3. Where the secret is stored (GitHub secret name, or MCP connection)
4. Expiry/rotation schedule
5. Access status

Then push this file to GitHub so it's available in every future session.
