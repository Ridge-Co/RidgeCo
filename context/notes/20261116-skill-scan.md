# Skill scan gate (Nov 16 2026)

Source: Brett asked Nov 16 to review the 12 repos from a video list; NVIDIA SkillSpector (item 1) was the one that fits an existing gap.
Gap: every third-party skill is read in full by hand (see PR #552 / `context/THIRD_PARTY_SKILLS.md`). Nothing checks skills that sessions add later, including the overnight runner.

## What this adds
- `scripts/skill-scan.sh`: runs SkillSpector (static mode, no model calls, no keys) on `.claude/skills`. Exit 0 = nothing new beyond the reviewed baseline, 1 = new findings, 2 = scanner could not run.
- `.github/workflows/skill-scan.yml`: runs it on pull requests that touch `.claude/skills`. `pull_request` only, read-only, pinned to SkillSpector commit a09091e (scanner 2.12.0).
- `.github/skillspector-baseline.yaml`: the 7 findings reviewed on the 10 skills in PR #552 (5 are the phrase "not limited to" in license text, 1 is the word "Permissions:" in a UI-states bullet, 1 is the phrase "Add a task for" matched as persistence). None is an instruction.

## Tested (locally, same script)
- Clean skills with baseline: exit 0, "No new findings".
- A planted skill (download-and-run line, reads credential files, sends them out, "ignore previous instructions"): exit 1, 6 findings, 5 HIGH.
- No `.claude/skills` folder: visible notice, exit 0. No scanner installed: error, exit 2.
- Every run first scans two throwaway samples (one bad, one plain) and fails if the scanner stops telling them apart.

## Not verified
- The GitHub workflow itself has not run yet. This PR touches the workflow file, so it triggers itself; on main today there is no `.claude/skills` folder (PR #552 adds it), so the run proves the self-test and the install, not a scan of real skills. First real scan = first PR that changes a skill after #552 merges.
- SkillSpector on raw upstream `impeccable` skill files (before our trimming): 50 findings, many HIGH (instruction-style wording, a hooks reference, referenced files it could not inspect). So it is noisy: a triage aid that points to where to read, never a pass/fail replacement for reading a skill. LLM mode was not used.

## Things to know
- Workflow files changed on main make `Sync staging to main` fail loudly until a session commits them to staging (see BRANCH_POLICY). PR #552 adds one too; do both at once.
- Review a finding, then add it to the baseline with the command printed in the failure message. A skill whose text changes may need its baseline entries refreshed (fingerprints follow the text).
- SkillSpector looks up known-bug data (OSV.dev) over the network; it has no telemetry of its own on its README page.
