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

## Pre-build gate
Run AFTER the build (Nov 17 2026, at Brett's request; this PR was opened before the gate was enforced on every build), against the actual diff. Shapes: `job` `external` (plus the standing parameters). Open items below did not shape the build and are not done yet.
- D11 Secrets / access: Y. No secrets or keys; `permissions: contents: read`; scanner pinned to one commit.
- C2 No cron: Y. `pull_request` only.
- C3 Nothing fails silently: mostly Y (a self-test proves the scanner still flags a bad sample; no scanner = exit 2). FIXED Nov 17: the scanner's output now goes to `skill-scan-out/skillspector.log`; anything other than "exit 1 with a report" is reported as "scanner error" with the log tail and exit 2 (SkillSpector's codes checked at the pinned commit: 1 + report = findings, 2 + no report = error). Tested three ways: clean skills (0), a planted bad skill (1), a simulated crash (2, "scanner error").
- C5 Fail-closed on purpose: Y. A broken scanner blocks (exit 2); no skills folder passes with a visible notice.
- C8 Branch / PR / merge: Y, BUILD_VERSION untouched. N: no staging twin, and the new workflow file needs the staging sync step (see "Things to know").
- C9 GATED: no (CI config only; no money, PII, auth or schema).
- C11 Safe start: Y. Runs only on PRs that touch skills.
- C13 Manual steps for Brett: merge; then the staging workflow-file sync per BRANCH_POLICY.
- C15 Cost: no AI calls; free GitHub Actions minutes on a public repo.
- B27 Where else: FIXED Nov 17. `context/THIRD_PARTY_SKILLS.md` step 8 now says every skill PR is scanned and how to treat a finding.
- B31 Settings: the pinned commit is deliberately a constant (changing it means re-vetting).
- D10 Scheduled job: N/A (CI, not a Hub job).

## Late requests
None yet.
