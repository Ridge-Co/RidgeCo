# CURRENT.md BECOMES A SHORT INDEX — Nov 17 2026 — PR into main, head `docs/current-md-index-nov17` (cut from main tip), merged: no

## CURRENT
**Status: docs only (no worker.js, no HTML, no BUILD_VERSION). Opened by a chat session at Brett's request (skill and token streamlining, Nov 17 2026).**

**Why:** `context/CURRENT.md` was 446,182 bytes (3,697 lines). It stopped changing on Oct 21 2026, when PRs moved to one note each in `context/notes/`, but CLAUDE.md still told every session to read it first ("Read ALL files in /context/, starting with CURRENT.md"). A GH Broker read of it now fails on size, and sessions that do read it burn Brett's usage on history.

**Changed:**
1. The old log is frozen, unchanged, on branch `archive/current-md-history` at main commit `9a424c8a2520dec3d05d5eb90c9df088287bdea2` (and stays in main's git history). Nothing deleted.
2. New `context/CURRENT.md` (about 4 KB): how to load context, the standing rules in short form with links to their owners (branch policy, no silent failures, no cron, never leak cost or markup, GATED classes, UI checks, credentials, one note per PR), the ALWAYS-LOAD set, and where the archive and private context are. Its first line carries a date, so `scripts/doc_audit.py`'s first-run fallback still parses it.
3. CLAUDE.md "load context" step 1: read CURRENT.md, then the recent notes (about two weeks), grep older notes and never read the archive branch's copy whole; other context files follow the ALWAYS-LOAD set and SESSION_EFFICIENCY_PROTOCOL_v1.0. The section heading is unchanged (test/ui-check.test.mjs checks its position).
4. `context/notes/README.md` rule 2 and its opening note match.

**Behaviour change to check:** FEATURE_LOG.md (about 888 KB) is now listed as "grep for the rules touching your code" instead of "always load". At that size it was never fully loadable anyway.

**Verified:** full unit suite (`node --test test/*.test.mjs`) on this branch; `scripts/doc_audit.py`'s CURRENT.md fallback reads the new first line. **Not verified:** how a fresh repo session behaves with the new step 1 (first nightly run after merge will show it).

## Pre-build gate
Shapes: `doc` (plus `any` and the standing parameters). Brett asked for this in chat; the open questions were settled by defaults.
- B27 Where else will he look for it: the brett-context chat skill also says "read CURRENT.md first"; a matching skill edit is proposed separately in the same session, after this PR.
- B31 Settings, not constants: N/A (no numbers).
- C1 No texts: N/A. C2 No cron: nothing scheduled. C3 Nothing fails silently: the archive is grep-able and named in CURRENT.md, CLAUDE.md and the notes README, so no rule is lost silently. C6/C7: no owner data, no cost data added; the never-leak rule is restated, not weakened.
- C8 Branch first, PR into main, Brett merges: yes; BUILD_VERSION untouched; this note is the one notes file.
- C9 GATED: no (docs only, no money, PII, auth or schema).
- C12 Existing data: history moved, not rewritten.
- C13 Manual steps for Brett: merge the PR. Nothing else.
- C14: nothing for Brett to check by hand.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261117-current-md-index]** `context/CURRENT.md` is a short index, not a log. Regression rules:
1. Never append build entries to CURRENT.md; status goes in a `context/notes/` file.
2. Never read the archived log (branch `archive/current-md-history`) whole; grep it.
3. Keep CURRENT.md's first line dated (scripts/doc_audit.py first-run fallback).
4. If a standing rule changes, update its owner file and the one-line summary in CURRENT.md together.
