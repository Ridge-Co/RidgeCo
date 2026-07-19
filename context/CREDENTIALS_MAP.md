# BrettOS Credentials Map
**Version:** v1.2 | **Last Updated:** July 19, 2026
**Rule:** This file maps every service Claude may need to interact with, where credentials are stored, and current access status. Update this file whenever a new service is connected or credentials change. Never store actual secret values here — only the map.

---

## GOOGLE SHEETS

**Purpose:** Primary database for all BrettOS ventures
**Auth method:** Service account (server-to-server, no user login required)
**Service account:** `brett-os-sheets@brettos-502323.iam.gserviceaccount.com`
**GCP project:** `brettos-502323`
**Secret location:** GitHub Actions org-level secret `GOOGLE_SA_KEY` (Ridge-Co org) — covers all org repos automatically. Also added to individual personal repos.
**How Claude writes to sheets:** Push `context/sheet-ops/pending.json` to the repo → GitHub Actions triggers `run_ops.py` → sheet updated automatically
**Expiry:** Service account keys do not expire unless manually rotated
**Access status:** ✅ Active
**Requirement:** Every new Google Sheet must be shared with the service account email as Editor before ops will work (PAT-027)

### Known Sheets
| Sheet Name | Sheet ID | Shared? |
|---|---|---|
| RidgeCo Main | `1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4` | ✅ Yes |

---

## GITHUB

**Purpose:** Code hosting, auto-deploy, context storage, GitHub Actions automation
**Auth method:** Personal Access Token (PAT) with `repo` scope
**Token location:** NOT reliably present in the session environment. As of July 18, 2026 the cloud session only exposes read-only proxy-injected placeholder tokens — read (clone/fetch of the public repo) works automatically, but **push requires a real token pasted by Brett**. Brett keeps a classic `repo`-scope PAT (no expiration). If pushes fail with "could not read Username" or "Invalid username or token," ask Brett to paste it, then `git remote set-url origin https://<token>@github.com/Ridge-Co/RidgeCo.git`.
**CRITICAL:** This repo is PUBLIC. Never write the token value into any file here or commit it. Use it only in-session (git remote URL / one-off push).
**Org:** Ridge-Co (covers all org repos with one token)
**Personal repos:** Same token covers personal repos under brett332
**Expiry:** Brett's current classic token has NO expiration — rotate periodically for hygiene.
**Access status:** ⚠️ Read = automatic. WRITE = requires Brett's pasted classic PAT each session until a persistent mechanism (session secret / OAuth connector) exists. GitHub's remote MCP OAuth isn't supported by custom connectors yet, so no clean connector path today.
**Auto-deploy:** ✅ NOW LIVE (July 19, 2026). It was SILENTLY BROKEN — the Worker was never connected to Git and hadn't deployed in ~4 days (Build tab showed "Connect", last deploy manual). Fixed by adding `wrangler.toml` (with `keep_vars = true` so deploys never wipe dashboard secrets) and connecting **Cloudflare → maintenance-hub → Settings → Build → Git repository** = `Ridge-Co/RidgeCo`, branch `main`, deploy cmd `npx wrangler deploy`. Every push to main now auto-builds + deploys the Worker. (`.html` frontend deploys separately via GitHub Pages.)

### Known Repos
| Repo | Purpose | Auto-deploy? |
|---|---|---|
| `ridge-co/RidgeCo` | Main BrettOS repo — Worker, frontend, context | ✅ Cloudflare Worker + GitHub Pages |

---

## CLOUDFLARE WORKER

**Purpose:** Backend API for all BrettOS frontends
**Worker name:** `maintenance-hub` (or similar — verify in Cloudflare dashboard)
**Live URL:** `https://maintenance-hub.brett-2f8.workers.dev`
**Auth method:** Deploy via GitHub push — no direct Cloudflare API access needed
**Worker secrets:** Set in Cloudflare dashboard → Workers → Settings → Variables. Claude cannot set these directly — Brett must add via dashboard.
**Known worker secrets:** `SHEET_ID`, `GOOGLE_SA_KEY` (or similar — verify in dashboard)
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
