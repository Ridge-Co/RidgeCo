# Current Context Files — Ridge Co / Brett AI

These are the authoritative files Claude must read at the start of every session.
Read ALL files before doing any work.

| File | Version | Description |
|---|---|---|
| Brett_Context_Document_v1.8.md | v1.8 | Brett's ventures, stack, Ridge Co details, full PAT library (PAT-001 through PAT-029) |
| Brett_Cowork_Best_Practices_v1.3.md | v1.3 | Session workflow, common mistakes, how to work with Brett |
| CREDENTIALS_MAP.md | v1.0 | Every service, auth method, secret location, access status |
| VENTURES.md | v1.0 | Every venture — current state, stack, Claude access level, automation gaps |
| FEATURE_LOG.md | v1.0 | What's working — check before every code change to prevent regressions |
| BACKLOG.md | v1.0 | Master backlog across all ventures — priorities, in progress, completed |

## How to update these files

When a new version is needed (new PAT, new project details, etc.):
1. Create the new versioned file (e.g., Brett_Context_Document_v1.9.md)
2. Update this CURRENT.md table to point to the new version
3. Push both files to GitHub
4. The old versioned file stays in /context/ as history — do not delete

## Version history

| Version | Date | Change |
|---|---|---|
| Context v1.8 | July 16, 2026 | PAT-026 added, full Ridge Co Session 1 details |
| Best Practices v1.3 | July 16, 2026 | Section 11 (PAT-026 version naming) added |
| CREDENTIALS_MAP v1.0 | July 17, 2026 | Initial credentials map — Sheets, GitHub, Cloudflare, QB, Drive |
| VENTURES v1.0 | July 17, 2026 | Initial ventures overview — Ridge Co, BrettOS, BarrelCo, Cabin, Winchester Hauling |
| PAT-029 | July 17, 2026 | Claude self-sufficiency mandate — execute without asking Brett for manual steps |
