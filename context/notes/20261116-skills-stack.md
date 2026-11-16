# DESIGN + PROCESS SKILLS STACK — Nov 16, 2026 — PR #552 into main, head `feat/skills-stack-nov16` (cut from main tip e5c949a), merged: no

(PR #550 was the same branch opened with a placeholder description. GH Broker has no way to edit a PR description, so #550 was closed and #552 opened with the full one.)

## CURRENT
**Ask (Brett, Nov 16, master plan section 4 and 5 phase 1b):** install a vetted set of design and process skills where builds actually run (this repo), so every build that touches a screen follows one design standard and checks its own work in a browser, without depending on a model remembering.

**What is in the PR (no page, no `worker.js`, no sheet touched):**
- `DESIGN.md` v1 at the repo root: the locked standard (`HUB_UX_DESIGN_FOUNDATION_v1.1`) written as exact rules, from the values the pages use today. Ends with "Common mistakes we keep making".
- `.claude/skills/` (text only): `ridgeco-ui-review` (original, ties the rest together), `pre-build-grill`, `brainstorming`, `writing-plans`, `systematic-debugging`, `verification-before-completion`, `office-hours`, `impeccable` (+7 reference files), `playwright-cli`, `public-site-taste`. Licence texts in `.claude/skills/LICENSES/`.
- `scripts/ui-check.mjs` + `scripts/ui-check-baseline.json` + `scripts/ui-check-mocks.json`: one command per changed page: static checks, the Impeccable detector when installed, screenshots at 412 / 1366 / 1920 with mocked Worker calls. Ratchet: fails only when a number gets worse than today's.
- `.github/workflows/ui-check.yml`: runs it on pull requests that touch `.html` or `.css`. `pull_request` trigger only.
- `CLAUDE.md`: a 14-line "UI and process skills (always)" block near the top. Nothing existing was removed or reworded.
- `context/THIRD_PARTY_SKILLS.md`: source, commit, licence, what was copied, what was cut and why, and how to update a skill.
- `test/ui-check.test.mjs`: 87 checks.

**Baseline recorded today (58 pages):** 1,591 places with text under the minimum (757 in `index.html`, 280 in `vendor.html`), 214 browser pop-up calls, 3 label-wrapped file inputs, 37 page columns with no desktop rule, 11 chips that cannot wrap, 0 pages that block zoom, 0 pages with sideways scroll at 412 / 1366 / 1920 (with made-up data on the first screen only).

**Verified (cloud session, on the pushed branch, fresh clone):** `node --check scripts/ui-check.mjs` clean. Full unit suite `node --test test/*.test.mjs`: 349 tests in 250 files, 0 failing (3m44s). `node scripts/ui-check.mjs --all`: static RAN, detector RAN (impeccable 4.9.2), screenshots RAN, 58 pages ok, RESULT: PASS. Same for `proposals.html vendor.html` (summary in the PR). Negative test: a copy of `proposals.html` with a 9px rule, an `alert(`, a no-wrap chip and a 2400px-wide block failed on all four, as it should. Screenshots of `vendor.html` at 412 and `proposals.html` at 1366 were opened and looked at (they show the known problems: spaced-capitals search box, 560px column on a wide screen).

**NOT verified:** the `UI check` workflow has never run on GitHub (this PR touches no `.html` or `.css`, so it does not trigger itself; its first real run is the next PR that changes a page). `playwright-cli` did not start in the cloud session (needs its own browser download and a no-sandbox config); the skill says so and points to the repo's Playwright harness, which does work. No real phone. Staging not used (nothing here deploys). The skills were not tried in a separate fresh session to see whether their descriptions trigger.

**Silent-failure check:** `ui-check.mjs` prints RAN or NOT RUN for each of its three parts and never treats a part that did not run as a pass (`--require-shots` / `--require-detector` make that a failure in CI). The one `catch` that does not report is the localStorage seed inside the test browser, commented; every other catch puts the failure in the summary. No Worker or page code changed.

Branch checklist: PR #551 -> main (verify with `get_pull_request`); head `feat/skills-stack-nov16`, cut from main tip e5c949a; no staging test-only PR (nothing to deploy or test there); not merged; `BUILD_VERSION` untouched; no commits on staging.

## FEATURE_LOG
**[FL-20261116-skills-stack]** Design standard + skills + UI ratchet. Rules (do not break):
1. `DESIGN.md` is the design standard for every page except public marketing pages. Changing it needs a PR that says what changed and Brett's OK.
2. Any change to an `.html` / `.css` file follows `.claude/skills/ridgeco-ui-review` and runs `node scripts/ui-check.mjs <pages>`. A page fails only when a count gets WORSE than `scripts/ui-check-baseline.json`; a page not in the baseline (new) is held to zero.
3. Never raise a number in the baseline to get a pass. Lowering it (after a real improvement) is done with the `--update-baseline` command the script prints. A raise needs Brett's OK and a line in the PR.
4. `.claude/skills/` holds text only. No scripts, hooks, installers or unpinned installs (`test/ui-check.test.mjs` fails otherwise). An outside skill is added or updated only through `context/THIRD_PARTY_SKILLS.md` (re-vet at a new pinned commit).
5. The detector is `impeccable@4.9.2`, pinned in `scripts/ui-check.mjs` (`DETECTOR_VERSION`) and in `ui-check.yml`. Change both together and re-record the baseline in the same PR. `ui-check.mjs` never downloads it; it only uses a copy already installed.
6. `ui-check.yml` stays `pull_request` only: no schedule, no cron, no push or manual trigger (tests enforce it), read-only token.
7. `public-site-taste` is for public marketing pages only and must keep the sentence saying it is not for the Hub or the portals (test enforces it).
8. `scripts/ui-check-mocks.json` holds made-up data only. No real name, phone, address or code.
Tests: `test/ui-check.test.mjs` (87 checks: each static check both ways, the ratchet, baseline shape, DESIGN.md content, the CLAUDE.md block and its length, every skill's name and description, the text-only rule, the workflow's trigger).

## Pre-build gate
Shapes: `doc` `ui` (tooling and documents only; no record, message, money, endpoint or job).
- C2 (no cron): Y. The workflow is `pull_request` only; `test/no-cron-anywhere.test.mjs` and `test/ui-check.test.mjs` both check it.
- C3 (nothing fails silently): Y, see the Silent-failure check line above.
- C7 (private data): Y. Mock data is made up; no personal data added to the public repo.
- C8 (branch first, Brett merges): Y. No staging twin because nothing here deploys or changes a page.
- C9 (gated class): not gated (no money, PII, auth, schema or customer text). Still left for Brett to merge, as the brief said.
- C13 (Brett's manual steps): one optional: save the three chat skills from the build report as account skills. Nothing is needed for the repo side.
- B33 / B32 / B26 (phone first, states, Spanish): these are now written into `DESIGN.md` and the `ridgeco-ui-review` checklist rather than applied to a screen here.
- N: `rc-ui.css` / `rc-ui.js` shared parts (UI plan Phase 0). `DESIGN.md` names them; they are a separate build.
- N: fixing any of the existing debt the baseline counts. This PR only stops it growing.
- N: running the whole-repo ratchet inside the unit suite. It runs in its own workflow on changed pages only, so a page nobody touched cannot turn `main` red.
Companion actions included: vetting record with update steps; licence files; unit tests; baseline for all 58 pages; made-up mock data for screenshots.

## Known gaps / next
- The workflow's first real run is unproven (see NOT verified).
- Default screenshots show the first screen only. A change inside a sheet, a tab or an expanded card needs its own capture (the skill says how).
- Static checks read px sizes only (not rem / em) and cannot see sizes set from script variables.
- `DESIGN.md` choices to confirm: one radius of 8px (the Hub uses 6px today), `--muted` `#5c6672`, the status chip map, one new tint `--purple-bg`.
- The CLAUDE.md "Stack" section still says "single index.html + vendor.html"; not touched (out of scope, existing rule).

## Late requests
(none yet)
