# Pre-build design gate: the checklist that is asked BEFORE code (Nov 3, 2026)
Branch feat/pre-build-gate-nov3 (cut from main tip a41fe4f). Risk class: SAFE (documentation, one test, one CLAUDE.md rule; no runtime code).

## What it is
`context/PRE_BUILD_GATE_v1.0.md`: 64 items mined from ~345 FEATURE_LOG / notes entries, each with a Y/N/n-a question, the feature shapes it applies to, a DEFAULT answer learned from Brett's past decisions, and its evidence. Three groups: 33 companion actions (edit, move between sections, reorder, undo, reschedule dependents, who is told, photos...), 17 standing parameters (R-1 no texts, no cron, nothing fails silently...), 14 integration traps (Sheets quota, ~50 calls per request, QuickBooks double post, Apps Script JOBS row, secrets...).
CLAUDE.md gets a MANDATORY rule to run it before code. It is the design-time twin of QUALITY_BAR_v1.0.md (post-build); 6 items overlap and are marked `QB`.

## Rules (do not break)
1. Ask Brett only where the default is unknown, in ONE batch. The default column is how question counts fall over time.
2. An item needs real evidence. No aspirational items.
3. Notes dated 20261104 or later MUST have a `## Pre-build gate` heading (test enforces).
4. `## Late requests` in a note feeds the next version of this file.

## Evidence the gate would have mattered
Dogfood on PR #507 (overnight heartbeat), which had passed every test, raised three gaps: no report history (B15), not shown on Needs Attention/Decision Inbox (B27), thresholds hard-coded (B31). Recorded in the gate file.

## Tests
New `test/pre-build-gate.test.mjs`: every item parses with question/shapes/default/evidence, ids unique, all groups present, C1-C17 present, CLAUDE.md wired, and later notes carry the heading.

## Known limits
Counts of late-request classes are "at least" (about 60 of ~345 entries read in full). No entry shows Brett asking for calendar-to-Hub auto-reschedule; B7/B8 cover the Hub-to-calendar direction and the "dependents when the source moves" question. The Continuous Improvement project docs were not mined. Defaults are inferred from past decisions and should be corrected whenever Brett says otherwise.

## Pre-build gate
This PR is the gate itself, so: shapes = none (documentation + test). Standing parameters checked: C3 (no code path to fail), C8 (branch first, PR into main, Brett merges), C13 (no manual steps), C9 (not a gated class).

## Silent-failure check
No runtime code. The test fails loudly if the file loses an item field, if CLAUDE.md drops the rule, or if a later note omits the heading.
