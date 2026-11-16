---
name: impeccable
description: Design review rules for RidgeCo screens. Use on any change to an .html or .css file in this repo (Hub, vendor, tenant and owner portals, tool pages) to audit, polish, harden, reword or adapt a screen to phone, tablet and desktop, and to read the design detector's findings. It works inside DESIGN.md and never picks a new look. Not for backend-only work.
---

# Impeccable (RidgeCo cut)

Adapted from pbakaus/impeccable (Apache-2.0, see `../LICENSES/`), heavily trimmed. Changes from the original are listed in `context/THIRD_PARTY_SKILLS.md`. `ridgeco-ui-review` is the step-by-step routine; this skill is the judgment behind it.

## Principles
- **Finish the job.** No hedging and no half-built states: the screen is complete, except material Brett must supply.
- **This is a work tool.** Every RidgeCo screen is one where the person came to get a job done. Ambition shows as precision and restraint. Patterns people already know earn their place. The tool should disappear into the task.
- **Refinement preserves.** Keep the look, the behavior, the wording and everything outside the scope of the change. `DESIGN.md` decides the look. If you think the standard itself is wrong, say so in the PR; do not quietly redesign.
- **Verify by looking** at the rendered result at the sizes it ships at (412, 1366, 1920). Batch the checks: fix everything one look shows before looking again.
- **A detector result is evidence of a defect, not proof of quality.** A clean scan does not replace looking.

## How to use it
1. Read `DESIGN.md`.
2. Pick the reference that matches the job and read it:

| Job | Read |
|---|---|
| Any UI edit, including a small one (read just before editing) | [reference/craft-floor.md](reference/craft-floor.md) |
| Deciding how a work screen should behave | [reference/operate.md](reference/operate.md) |
| Measurable checks: accessibility, responsive, theming | [reference/audit.md](reference/audit.md) |
| Final pass before a PR | [reference/polish.md](reference/polish.md) |
| Long text, errors, empty and slow states, Spanish, double-taps | [reference/harden.md](reference/harden.md) |
| Labels, buttons, error and empty-state wording | [reference/clarify.md](reference/clarify.md) |
| Making a phone screen use a tablet or monitor (or the reverse) | [reference/adapt.md](reference/adapt.md) |

3. Run `node scripts/ui-check.mjs <pages>`. It runs the detector for you when it is installed, and compares against the baseline so old debt does not fail your change.

## The detector
The detector is the `impeccable` npm package: a small launcher plus a compiled program for the machine it runs on. It reads HTML and CSS and reports things like tiny text, low contrast and wide letter-spacing.

- Install (pinned, no install scripts, never saved into the repo): `npm install --no-save --ignore-scripts impeccable@4.9.2`
- `scripts/ui-check.mjs` finds it at `node_modules/.bin/impeccable` and runs `impeccable detect --json --no-config <page>` with usage reporting switched off (`DO_NOT_TRACK=1`, `IMPECCABLE_NO_TELEMETRY=1`) and from a folder outside the repo.
- Exit codes: 0 no findings, 2 findings, 1 a page could not be scanned.
- Where `DESIGN.md` and the detector disagree, `DESIGN.md` wins. Say so in the PR.

Do NOT run any other part of that package here: not `install`, `update`, `link`, `hooks`, `live`, `context`, `telemetry on`, or anything that signs in. Those were left out on purpose (they add edit hooks, download programs, or talk to the author's servers).
