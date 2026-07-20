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
   BACKLOG, CAPTURE_INBOX, HANDWRITING_KEY). Read every file it lists.
2. **Business / private context** lives in the private repo `brett332/data` (business briefs,
   the `productivity/CLAUDE.md` decoder, Gemini archive) and loads via the `brett-context`
   skill. That clone needs a classic PAT in `BRETT_GH_PAT` (repo scope). If it's unset in a
   Code session, the code context here still works — just flag that private context is missing.
3. Do not write code or make changes until context is loaded and confirmed.

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
- Worker URL: `https://maintenance-hub.brett-2f8.workers.dev`.
- QuickBooks: connected at the Worker level (prod, realm 9130355695406136). The cloud/session
  cannot reach Intuit directly — all QB work goes through Worker endpoints.

## Regression rules — DON'T break working features (full log in /context/FEATURE_LOG.md)
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
