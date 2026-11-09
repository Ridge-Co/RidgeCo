# Pre-build gate test: cutoff moved to 20261110 (Nov 9 2026)

## What happened
PR #508 (pre-build design gate) was merged on Nov 9 after its checks last ran on Nov 3. Its test requires every PR note dated 20261104 or later to carry a "## Pre-build gate" section. Six notes dated 20261105 to 20261109 were already on main before the gate existed, so the Unit tests failed on main right after the merge (run 279, sha 7a5f815) and would have failed every open PR.

## Fix
The test now only checks notes dated 20261110 or later, i.e. notes written after the gate went live. No other change to the gate, CLAUDE.md or the gate document.

## Lesson
Before merging any PR whose checks are older than the latest merge to main, update the branch from main and re-run the checks first. This was skipped for #508 and caught on #501.

## Verification
node test/pre-build-gate.test.mjs passes on this branch (CI Unit tests).
