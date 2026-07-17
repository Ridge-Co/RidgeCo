# BrettOS Credentials Map
**Version:** v1.0 | **Last Updated:** July 2026
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
**Token location:** Stored in Claude's session environment — used for git push
**Org:** Ridge-Co (covers all org repos with one token)
**Personal repos:** Same token covers personal repos under brett332
**Expiry:** Check `github.com/settings/tokens` — rotate when expired, update Claude's session token
**Access status:** ✅ Active
**Auto-deploy:** Push to `main` branch of `ridge-co/RidgeCo` → Cloudflare Worker deploys automatically via wrangler

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
**Auth method:** OAuth2 with refresh token (100-day expiry, auto-renews on use)
**Intuit Developer App:** BrettOS Automation (AppID: 33b9e4af...)
**Workspace:** BrettOS
**Development Client ID:** `AB0B9BKsX7xlilodTJILzynggrllfGMxD7RI2AKCRndT1TSWgF`
**Production credentials:** ⏳ Pending Intuit review (submitted July 17, 2026)
**Secret location (once approved):** Will be stored as GitHub Actions secrets:
  - `QB_CLIENT_ID`
  - `QB_CLIENT_SECRET`
  - `QB_REFRESH_TOKEN`
  - `QB_REALM_ID` (company ID)
**Redirect URI configured:** `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl`
**Access status:** ⏳ Pending production approval — development credentials active
**Next step:** When Intuit approves, run OAuth2 Playground flow to get production refresh token, store as GitHub secrets

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
