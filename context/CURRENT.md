# CURRENT — short index (rebuilt Nov 17, 2026). Read this, not the history.

This file used to be a 446 KB running log. Since Oct 21 2026 every PR writes its own note in `context/notes/` instead, so the
log stopped changing but every session still had to read all of it. The full history is kept on
branch `archive/current-md-history` (frozen at main commit `9a424c8`), file `context/CURRENT.md`. **Never read it whole: grep it for the topic, rule number or PR number you need:**
`git clone --depth 1 -b archive/current-md-history https://github.com/Ridge-Co/RidgeCo /tmp/cur-hist` then grep `/tmp/cur-hist/context/CURRENT.md`. Where the archive and a note disagree, the note wins (it is newer).

## How to load context (token-lean; SESSION_EFFICIENCY_PROTOCOL_v1.0 governs)
1. This file.
2. `context/notes/`: list it, read the newest notes first (about the last two weeks), and grep older notes for your topic.
   Notes are the live status of every PR since Oct 21 2026.
3. The ALWAYS-LOAD set below. Everything else on demand: grep first, open a full file only when the task needs it.
4. Build or design work: `context/PRE_BUILD_GATE_v1.0.md` before any code (mandatory, enforced by `test/pre-build-gate.test.mjs`).

## Standing rules (the short form; each links to its owner)
- **Branch policy (Sep 28 2026):** `main` is the truth, `staging` a disposable copy. Cut every branch from the current `main`
  tip; every feature PR targets `main`; staging checks use a second, test-only PR. Full rules: `context/BRANCH_POLICY_v1.0.md`.
- **Nothing ever fails silently (Oct 1 2026):** see CLAUDE.md and `context/NO_SILENT_FAILURES_PROGRAM_v1.0.md`.
- **No cron anywhere:** scheduled work is a Hub scheduler job (CLAUDE.md).
- **Never leak cost or markup (Aug 10 2026, after a live breach):** Brett's cost, any vendor cost, markup, margin or the math
  behind a price never appears on anything customer-facing or in this public repo, in any form (text, comment, JS, filename).
  Full rule: archive branch, grep "NEVER LEAK COST".
- **GATED:** money, QuickBooks, personal data, logins and customer texts are never merged or run without Brett
  (`context/AUTONOMY_GUARDRAILS_v1.0.md`).
- **UI:** `DESIGN.md`, `scripts/ui-check.mjs`, `context/UI_QA_CHECKLIST.md` for every new or changed button or page.
- **Credentials:** never ask for or use a pasted token; the real map is `brett332/data/CREDENTIALS_MAP.md` (private).
- **One note per PR:** a PR adds `context/notes/YYYYMMDD-slug.md` with `## CURRENT`, `## Pre-build gate`, `## Late requests`
  and `## FEATURE_LOG`, and does not edit this file or `FEATURE_LOG.md` (`context/notes/README.md`).

## ALWAYS-LOAD set (small, governing)
| File | Why |
|---|---|
| `context/notes/` (recent) | Live status of open and recent work |
| `SESSION_EFFICIENCY_PROTOCOL_v1.0.md` | How to spend tokens: light load, delegate heavy reads |
| `Brett_Context_Document_v1.12.md` | Ventures, stack, PAT library |
| `Brett_Cowork_Best_Practices_v1.4.md` | How to work with Brett |
| `VENTURES.md` | Every venture's state |
| `AUTONOMY_GUARDRAILS_v1.0.md` | Any background or overnight agent |
| `BACKLOG.md`, `CAPTURE_INBOX.md` | Quick Index block at the top only; grep for detail |
| `FEATURE_LOG.md` | Grep for the rules touching the code you change before any build or fix; do not read whole |

On demand: `CODEMAP.md` (build/debug), `HUB_UX_DESIGN_FOUNDATION_v1.1.md` (UI), `QUALITY_BAR_v1.0.md` (Worker/Hub/money
builds and ridgeco-validate), build briefs (`*_BUILD_BRIEF_*.md`) for their own build, `HANDWRITING_KEY.md` (handwriting only).
The full context-file table with versions is at the end of the archived log (grep "Current Context Files").

## Private context (not in this public repo)
Personal and competitive material lives in Google Drive ("Brett AI Context" folder) and `brett332/data`. Read it through the
Drive or GH Broker connectors only when the task needs it.
