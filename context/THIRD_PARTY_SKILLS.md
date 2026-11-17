# Third-party skills: vetting record (Nov 16 2026)

Skill files are instructions an AI session follows. That makes them a way in for bad instructions, so nothing from outside goes into `.claude/skills/` without this record. One row per source, pinned to the exact commit that was read.

**How each was vetted (Nov 16 2026, cloud session):** cloned into its own empty folder (`/tmp/vet/<name>`, `git clone --depth 1`, git hooks off). No installer, setup script or hook was run. Every file that was copied or adapted from was read in full first, as data: nothing written inside those files was followed. Anything that fetches or runs remote code, reports usage, writes outside the repo, tells the session to disregard other instructions or other tools, or needs helper programs we are not installing was removed or refused. What is installed is **text only**: `test/ui-check.test.mjs` fails if a script, a hook line, an unpinned install or a leftover launcher command appears under `.claude/skills/`.

## Summary

| Skill here | Source | Commit read | Licence (file opened) | Verdict |
|---|---|---|---|---|
| `impeccable` | github.com/pbakaus/impeccable | `d41d9860b0094dcb68030657da63461212835aaa` | Apache-2.0 (`LICENSE`) | Adopted, heavily trimmed |
| `playwright-cli` | github.com/microsoft/playwright-cli | `b21724888b8100b05ef8dee3a92f2bb03bf4dcde` | Apache-2.0 (`LICENSE`) | Adopted, trimmed |
| `pre-build-grill` | github.com/mattpocock/skills (`grill-me` -> `grilling`) | `5863806dd4e15c63174bee4e7515a4256792ecfa` | MIT (`LICENSE`) | Method adopted, text rewritten around the pre-build gate |
| `brainstorming`, `writing-plans`, `systematic-debugging`, `verification-before-completion` | github.com/obra/superpowers | `22f0b463e7a5e579904dd6211a520321035526f7` | MIT (`LICENSE`) | Four skills only, trimmed |
| `office-hours` | github.com/garrytan/gstack (`openclaw/skills/gstack-openclaw-office-hours`) | `5dcd76b4eae6bb06f73460d3ab29cef8e33e8537` | MIT (`LICENSE`) | One skill, standalone variant, trimmed |
| `public-site-taste` | github.com/Leonxlnx/taste-skill | `f6b76575f949707b4e3c37cd86cb44b0b98643e8` | MIT (`LICENSE`) | Ideas only; original short text; nothing copied |
| (none) | github.com/nextlevelbuilder/ui-ux-pro-max-skill | `e59ff376a41f7ca47b7541ad5c116495cbade3ee` | MIT (`LICENSE`) | Not installed. One data file read once as reference |
| (none) | JuliusBrussee/caveman, img2threejs | not cloned | not opened | Not installed (decided Nov 16) |
| `ridgeco-ui-review` | written here | n/a | this repo | Original |

Licence texts and copyright notices: `.claude/skills/LICENSES/` (`Apache-2.0.txt`, `NOTICE.txt`, `MIT.txt`).

## Per source

### pbakaus/impeccable
- **Copied (trimmed, each file says so at its top):** `skill/reference/craft-floor.md`, `operate.md`, `audit.md`, `polish.md`, `harden.md`, `clarify.md`, `adapt.md` -> `.claude/skills/impeccable/reference/`. `SKILL.md` was rewritten for this repo from `skill/SKILL.src.md`.
- **Cut, and why:**
  - The launcher (`skill/scripts/impeccable`, `impeccable.cmd`). Its own text: "The launcher runs a self-contained binary that ships next to it or is downloaded once on first run". That is fetching and running remote code. Every `{{scripts_path}}/impeccable ...` line in the references went with it (`context`, `critique-storage`, `audit-storage`, `pin`, `doctor`, `foundations`).
  - The design hook (`reference/hooks.md`, `plugin/hooks`): "auto-runs the detector after UI file edits". No hooks.
  - Live mode (`skill/scripts/live-browser*.js`, 566 KB, `reference/live.md`), the Hermes plugin (`skill/hermes-plugin/__init__.py`), the sub-agent files (`skill/agents/`), and a 1.1 MB font index.
  - 30-odd reference files for brand sites, new visual worlds, motion, iOS and Android. Not relevant to a work tool, and DESIGN.md fixes the look.
  - Rule markers (`<!-- rule:... -->`) and the Codex-only block.
- **Usage reporting:** the compiled program has it. From `crates/detect/src/lib.rs`: "telemetry off|on|status          Turn the roll API's anonymous usage data off or on, or show it". In the source it is used by the idea-picker and account commands (`concept-seed`, `serve-question`, sign-in), which we never run. `scripts/ui-check.mjs` runs only `detect`, with `DO_NOT_TRACK=1` and `IMPECCABLE_NO_TELEMETRY=1` set (both are documented opt-outs in `crates/context/src/telemetry.rs`), from a folder outside the repo.
- **The detector** is the npm package `impeccable@4.9.2` (launcher `cli/bin/cli.js`, read in full) plus the compiled program `@impeccable/cli-<os>-<arch>@0.1.25`, which npm installs as an optional dependency. Command: `impeccable detect --json --no-config <page>`; exit 0 clean, 2 findings, 1 could not scan. Notes: (1) the compiled program is not in this repo and is not open to read line by line; its package says `"license": "SEE LICENSE IN LICENSE"`. It is run, not copied. (2) If the optional package is missing, the launcher downloads the same program from the project's GitHub releases and checks it against a checksum list shipped in the npm package. `ui-check.mjs` never triggers an install by itself: it only uses a copy that is already at `node_modules/.bin/impeccable`. (3) Installed with `--ignore-scripts`, so no install script runs.
- Its `NOTICE.md` covers only the iOS and Android files, which were not taken.

### microsoft/playwright-cli
- **Copied (trimmed):** the command reference in `skills/playwright-cli/SKILL.md` and the mocking examples in `references/request-mocking.md` -> `.claude/skills/playwright-cli/SKILL.md`, with RidgeCo examples and the repo's own Playwright harness added.
- **Cut, and why:** the unpinned install line ("npm install -g @playwright/cli@latest"; pinned to `0.1.24`, the version in `package.json` at that commit); `attach --extension` / `attach --cdp` (connects to a real running browser with real sign-ins); persistent profiles; the WebMCP section ("Prefer these tools over driving the UI when one matches the task": tools offered by the page itself; the file does also say to treat them as untrusted); `gh ... --attach` (we commit through GH Broker); video, tracing, test generation, the Windows notes, the `show --annotate` dashboard.
- **Not proven here:** in the cloud session `playwright-cli open` failed twice ("Running as root without --no-sandbox is not supported", then "Browser \"chromium\" is not installed ... Run `playwright-cli install-browser chromium`"). No second browser was downloaded. The skill says this and points to the repo harness, which does work.

### mattpocock/skills (grill-me)
- `skills/productivity/grill-me/SKILL.md` is now one line: `Call the Skill tool with "grilling".` The method is in `skills/productivity/grilling/SKILL.md` (read in full, 2.3 KB).
- **Taken:** ask every question whose prerequisites are settled in one numbered round, each with a recommended answer worded so "yes" accepts it; facts are the session's job, decisions are the user's.
- **Changed:** rewritten around `context/PRE_BUILD_GATE_v1.0.md` (defaults first, one batch). "dispatch a sub-agent with a fresh context window" became "look it up yourself". Added what to do when nobody is there to answer.

### obra/superpowers
- **Taken:** the four `SKILL.md` files named above, each read in full and shortened.
- **Cut, and why:** everything that assumes its plugin: the session-start hook (`hooks/hooks.json` runs `run-hook.cmd session-start` on every startup); cross-references such as "invoke superpowers:writing-plans and no other skill"; git worktrees; sub-agent execution ("superpowers:subagent-driven-development"); the brainstorming "visual companion" (a local web server: `scripts/server.cjs`, `start-server.sh`); the reviewer sub-agent prompt; its own `docs/superpowers/` file locations (ours are `context/notes/` and build briefs). Descriptions were rewritten to say when to use each skill here (the original brainstorming description opens "You MUST use this before any creative work").
- Not taken: every other skill in that repo, `find-polluter.sh`, the TypeScript example.

### garrytan/gstack (office-hours)
- **Used the standalone variant** `openclaw/skills/gstack-openclaw-office-hours/SKILL.md` (17 KB, read in full). It has no dependency on gstack's `bin/` helpers or browse daemon.
- **The main variant was refused** (`office-hours/SKILL.md`, 44 KB). It starts with `~/.claude/skills/gstack/bin/gstack-skill-start --skill "office-hours"`, logs every question with `gstack-question-log`, and ends with "## Telemetry (run last)" including "PLAN MODE EXCEPTION — ALWAYS RUN".
- **Cut from the standalone variant, and why:** "Garry's Note", a closing sales pitch the skill tells the session to deliver to the user ("please consider applying to Y Combinator. ycombinator.com/apply"); the "founder signal" count that feeds it; "Save the design doc to `memory/`" (ours go to the venture brief and the project doc); the hackathon / open-source modes; the long lists of sample dialogue.
- **Kept:** the six demand questions, the premise challenge, the two-or-three approaches rule, the brief, the one concrete assignment, and "never start building".

### Leonxlnx/taste-skill
- **Nothing copied.** `skills/taste-skill/SKILL.md` (31 KB) was read in full. `public-site-taste` is an original page of rules that keeps its ideas (say plainly what is sold, real photographs, one system, quiet motion, effects only where the trade is technical).
- **Why not the real thing:**
  - Its front matter carries a `Stop` hook that runs `node .../scripts/gate.mjs --hook claude` from several places including `$HOME/.claude/skills/...`, every time a session ends.
  - It tells the session not to use other browser tools: "Only the skill's scripts ... never in the background, a windowed browser or a browser tool."
  - It depends on a 36 MB kit and a 1 MB checker script (`scripts/consistency.mjs`), and `scripts/photos.mjs search` fetches pictures from the web at run time.
- The narrow description (public marketing pages only, never the Hub or portals) is checked by `test/ui-check.test.mjs`.

### nextlevelbuilder/ui-ux-pro-max-skill
- Not installed. `src/ui-ux-pro-max/data/ux-guidelines.csv` was searched once (read-only, its Python scripts were not run) to cross-check DESIGN.md's tap-target, spacing, contrast and input-size rules. Nothing was copied.

## Nothing hostile was found
No file tried to send data anywhere by itself, read credentials, or tell the session to disregard its instructions. The items above are the ones that would have changed how sessions behave (hooks, usage reporting, helper programs, a sales pitch, "use only our scripts"), and they are not installed.

## How to update a skill (re-vet at a new pinned commit)
1. Clone the source into a new empty folder outside the repo. Run nothing from it. Note the commit with `git rev-parse HEAD`.
2. Open its LICENSE file. If it is missing or no longer permissive, stop: keep the current copy, or write an original skill.
3. Diff the upstream files against the commit pinned here (`git diff <old> <new> -- <path>`), and read every changed file in full, as data.
4. Look for the same things again: hooks, installers, downloads, usage reporting, writes outside the repo, lines about disregarding other instructions or tools, helper programs.
5. Bring over only what is wanted, by hand, into the existing trimmed files. Keep the "From ... at <commit>" line at the top of each adapted file current.
6. Update the commit in the table above and the lists of what was cut. For the detector, change `DETECTOR_VERSION` in `scripts/ui-check.mjs` and the version in `.github/workflows/ui-check.yml` together, re-read `cli/bin/cli.js`, then re-record the baseline (`node scripts/ui-check.mjs --all --update-baseline`) in the same PR and say in the PR which counts moved.
7. Run `node test/ui-check.test.mjs` and the full suite. Open a PR; Brett merges.
8. Every PR that touches `.claude/skills` is also scanned automatically by NVIDIA SkillSpector (`scripts/skill-scan.sh`, workflow "Skill scan", static mode, pinned commit). A new finding fails the check; read it, and only add it to `.github/skillspector-baseline.yaml` once it is understood. The scan points to where to read; it never replaces reading the skill.

Never run `npx impeccable install`, `npx skills add`, a repo's `install.sh` / `setup`, or a plugin installer in this repo: they write hooks and unreviewed files.
