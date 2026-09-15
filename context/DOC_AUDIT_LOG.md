# Documentation Audit Log

Append-only run history for `scripts/doc_audit.py`, run nightly by
`.github/workflows/doc-audit.yml`. Exists so a night the workflow silently doesn't
fire is itself visible — a gap in this file's own run sequence, not just an
invisible missed check. See the workflow file and script for the full mechanism
and its known limitations (it's a keyword-clustering heuristic against
FEATURE_LOG.md, not a certainty check — flagged commits need a real look, never
an auto-filed entry).

