---
name: verification-before-completion
description: Use EVERY time before saying work is done, fixed, passing, merged, deployed or ready, and before committing, opening a PR or writing a build report. Run the command that proves the claim, read its full output, and only then make the claim with the evidence. Applies to all RidgeCo work, scheduled runs included.
---

# Verification before completion

Adapted from obra/superpowers (MIT), trimmed for RidgeCo.

**The rule: no claim of success without fresh evidence.** If you have not run the check in this session, after the last change, you cannot say it passes.

## The gate
Before any statement that something works:
1. **Name it:** what command or look proves this claim?
2. **Run it:** the whole thing, fresh.
3. **Read it:** the full output, the exit code, the count of failures.
4. **Compare:** does the output confirm the claim? If not, say what the real state is, with the evidence.
5. **Only then** make the claim, with the evidence beside it.

## What counts in this repo
| Claim | Needs | Not enough |
|---|---|---|
| Tests pass | `node --test test/*.test.mjs` output, 0 failing, run after the last edit | an earlier run, one test file, "should pass" |
| `worker.js` is fine | `node --check worker.js` exit 0 | "it is a small change" |
| The screen is right | `node scripts/ui-check.mjs <pages>` RESULT: PASS, and you opened the 412 and 1366 screenshots | the script passing without looking; looking at desktop only |
| The bug is fixed | the original symptom tested and gone, plus a test that failed before the fix | the code changed |
| It is on staging / live | `GET /version` or the deployed source shows your change | the push succeeded |
| The write landed | the row re-read and the value there | `success: true` |
| The PR is open against main | `get_pull_request` shows the number and base | the create call returned |
| The requirements are met | the brief re-read, line by line, each one checked | the tests pass |
| Another agent finished | its diff read and its checks re-run | its own report |

## Say what was not verified
Every PR and build report has two lists: **verified** (with the command and result) and **not verified** (with the reason: no real phone, staging stubs QuickBooks and SMS, a part did not run). A check that printed NOT RUN is reported as not run. Never write that something was tested when it was not.

## Stop if you notice
- the words "should", "probably", "seems to"
- "Done!" or "Fixed!" before the check ran
- about to commit, open a PR or report without a fresh run
- relying on part of a check, or on another agent's word
- "just this once"

| Excuse | Reality |
|---|---|
| "I am confident" | Confidence is not evidence. |
| "The part I ran passed" | A partial check proves the part. |
| "It worked before my last edit" | Then it is unproven now. |
| "Different wording, so the rule does not apply" | Any wording that implies success is a claim. |
