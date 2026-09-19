# Documentation Audit Log

Append-only run history for `scripts/doc_audit.py`, run nightly by
`.github/workflows/doc-audit.yml`. Exists so a night the workflow silently doesn't
fire is itself visible — a gap in this file's own run sequence, not just an
invisible missed check. See the workflow file and script for the full mechanism
and its known limitations (it's a keyword-clustering heuristic against
FEATURE_LOG.md, not a certainty check — flagged commits need a real look, never
an auto-filed entry).


## Run: 2026-09-15 16:45 UTC
Since: 2026-09-15 (source: CURRENT.md header (first run — no audit history yet))
Checked commits: 17 (excluding merges/doc-audit itself)
No gaps flagged.

## Run: 2026-09-16 17:26 UTC
Since: 2026-09-15 (source: this script's own last recorded run)
Checked commits: 32 (excluding merges/doc-audit itself)
No gaps flagged.

## Run: 2026-09-17 17:25 UTC
Since: 2026-09-16 (source: this script's own last recorded run)
Checked commits: 232 (excluding merges/doc-audit itself)
**6 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `1da1d33` (2026-09-17 13:52) OPTIMIZER_ROUND_LOG.md: note the v1.1 addendum in the governing header — best single-entry match: 40%
- `c9bf6db` (2026-09-17 00:54) Fix garbled merge in CURRENT.md from the previous patch (dangling duplicate sentence fragment) — best single-entry match: 44%
- `34a4220` (2026-09-17 00:41) Bump BUILD_VERSION for bulk-welcome template consistency fix — best single-entry match: 40%
- `7690c84` (2026-09-16 21:45) Bump BUILD_VERSION to 2026-09-16.4 (deploy marker for the held-WO owner-contact resolution) — best single-entry match: 43%
- `2f4f36a` (2026-09-16 18:45) docs: v1.5 -- document the add_repo cross-tier wall and the standing rule to avoid it — best single-entry match: 38%
- `08c5698` (2026-09-16 18:42) docs: sync CLAUDE.md's private-context load instructions with CREDENTIALS_MAP.md v1.4 (applies PR #5) — best single-entry match: 44%

## Run: 2026-09-18 16:54 UTC
Since: 2026-09-17 (source: this script's own last recorded run)
Checked commits: 93 (excluding merges/doc-audit itself)
**4 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `7b027ba` (2026-09-17 18:18) WO Templates: add hidden tmpl-id + title/save-button ids for edit-mode reuse — best single-entry match: 25%
- `1da1d33` (2026-09-17 13:52) OPTIMIZER_ROUND_LOG.md: note the v1.1 addendum in the governing header — best single-entry match: 40%
- `c9bf6db` (2026-09-17 00:54) Fix garbled merge in CURRENT.md from the previous patch (dangling duplicate sentence fragment) — best single-entry match: 44%
- `34a4220` (2026-09-17 00:41) Bump BUILD_VERSION for bulk-welcome template consistency fix — best single-entry match: 40%

## Run: 2026-09-19 16:11 UTC
Since: 2026-09-18 (source: this script's own last recorded run)
Checked commits: 99 (excluding merges/doc-audit itself)
**4 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `cfc98f0` (2026-09-19 16:05) One-time cleanup: de-identify the duplicate fixture set the ID-comparison bug created — best single-entry match: 38%
- `9d4fb7a` (2026-09-19 13:48) Add HUB_TEST_TOKEN helpers: isTestRecord, hubTestWriteAllowed, seedTestFixtures — best single-entry match: 20%
- `bcfe74f` (2026-09-19 13:46) Declare _viaHubTestToken (outer-scope flag for the new staging test-token gate) — best single-entry match: 43%
- `e87d218` (2026-09-18 20:25) Fix backlog id B-141 -> B-240 in OPS_QUEUE_STATUSES comment — best single-entry match: 33%
