# BRANCH POLICY v1.0 — `main` is the truth, `staging` is a disposable copy (Sep 28, 2026)

Why this exists: `staging` and `main` kept drifting apart (duplicate content with different SHAs, dirty merges).
Root causes were mis-based PRs (base = `staging`), features that reached only one of the two branches, temp/"nudge"
commits directly on `staging`, hand-made main<->staging merge commits, and CURRENT.md saying "PR to main open" when
the PR base was actually `staging`. Parallel Claude sessions are fine — those five habits are what break things.

## The rules
1. `main` is the single source of truth. Every feature/fix reaches production ONLY through a PR whose base is `main`.
2. `staging` is a disposable test copy = `main` (+ optionally ONE in-flight branch merged on top for verification).
   Nothing is ever merged back from staging. After every push to `main`, the `Sync staging to main` workflow
   force-resets `staging` to `main` and lists anything it dropped (old tip is also kept as a `staging-before-reset-*` tag).
3. Never base a PR on `staging`. Never commit directly to `staging` (no TEMP / "Nudge staging" / verification commits).
   Never merge `main` into `staging` (or the reverse) by hand. Never open a PR with head `staging`.
4. Feature branches: named `feat/*`, `fix/*` or `hotfix/*`, always cut from the CURRENT `main` tip.

## Per-feature flow
1. Cut the branch from the current `main` tip (`create_branch` with `from: main`).
2. Build + commit on that branch.
3. Open the PR -> `main` (this is the real PR; the CURRENT.md entry points at it).
4. To verify on staging: open a SECOND PR from the SAME branch into `staging`, and put this exact line in its body:
   `staging-test-only: true`. Merge that PR (test-only; staging is only a test copy). It is never how a change reaches main.
   (A test-only PR merged within the last 72h counts as explained staging content for the drift check.)
5. Test on staging (confirm the deploy landed: `BUILD_VERSION` in the deployed worker matches).
6. Brett merges the PR -> `main`. `Sync staging to main` then resets staging automatically. Nobody touches staging after that.

## When a branch goes dirty (conflicts / "not mergeable")
Do not content-patch the old branch — that does not fix mergeability. Cut a FRESH branch off the current `main` tip,
re-apply the real change (cherry-pick or re-do the patch), open a new PR -> `main`, close the old PR. The guard warns
when a PR head is more than 20 commits behind main.

## Parallel sessions
- Each session works on its own branch cut from `main`. Sessions never share a branch and never build on each other's
  unmerged branches; if B needs A's change, wait for A to merge, then cut from the new `main`.
- Before starting: check staging == main (last `Drift check` / `Sync staging to main` run is green, or do a throwaway
  compare of the two tips). If staging differs and no test-only PR is open, run `Sync staging to main` first.
- If a session is told "use staging", that means the test-only PR flow above — not a PR based on staging.

## What the automation enforces
- `sync-staging.yml`: push to main / manual -> force-reset staging = main, summary lists dropped commits. Hourly run only
  CHECKS, never rewrites. If main changed `.github/workflows/*`, GITHUB_TOKEN cannot push it: the run fails loudly and opens
  the issue "staging reset blocked: workflow files changed" (fix: have a Claude session commit those workflow files to
  staging through GH Broker, or add repo secret `STAGING_SYNC_TOKEN`).
- `staging-guard.yml` (every PR): head `staging`/`main` fails; base `staging` needs head `feat/*|fix/*|hotfix/*` AND
  `staging-test-only: true` in the body; PRs to main fail if they contain commits matching
  `\bTEMP\b|Nudge staging|stg-sync|Resync` (case-insensitive); warns if >20 commits behind main.
- `drift-check.yml` (daily): staging content != main and no test-only PR explains it -> issue "staging drift detected".

## CURRENT.md entry checklist (every session that opens a PR)
- [ ] States the PR number AND its base branch explicitly ("PR #N -> main"). Any "PR to main" claim must be verified with `get_pull_request`.
- [ ] States the head branch and that it was cut from main tip <sha>.
- [ ] If a staging test-only PR exists, lists it separately as "test-only, not the path to main".
- [ ] Says whether it is merged, and whether staging was verified at which BUILD_VERSION.
- [ ] No mention of temp/nudge commits on staging (there should be none).
