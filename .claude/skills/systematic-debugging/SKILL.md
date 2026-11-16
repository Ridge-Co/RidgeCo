---
name: systematic-debugging
description: Use for any RidgeCo bug, failing test, wrong number, failure-ledger row or unexpected behavior, BEFORE proposing or writing a fix. Find the root cause first (read the error, reproduce, check what changed, trace the data), test one idea at a time, then fix the cause with a test. Use it most when the fix looks obvious or the pressure is on.
---

# Systematic debugging

Adapted from obra/superpowers (MIT), trimmed for RidgeCo.

**The rule: no fix until the root cause is found.** A fix for the symptom is a failure, even when it makes the symptom go away. If you have not done phase 1, you may not propose a fix.

## Phase 1: find the root cause
1. **Read the error, all of it.** The message, the stack, the line, the failure-ledger row, the Ops_Telemetry row. They often say exactly what is wrong.
2. **Reproduce it.** Exact steps, every time. Cannot reproduce: gather more evidence, do not guess.
3. **Check what changed.** Recent commits and PRs, the deploy time against `GET /version`, a Config key, a sheet header.
4. **Find where it breaks.** The Hub is a chain: page -> Worker route -> Sheets / QuickBooks / Twilio / Drive. At each link, look at what goes in and what comes out (staging with `hub_test_get` / `hub_test_post`, the deployed source with `workers_get_worker_code`, the sheet with `sheets_read`). Run once to see WHERE it breaks, then look only there.
5. **Trace the bad value back.** Where did it come from? What called this with it? Keep going up until you reach the source. Fix at the source.

Check these yourself. Do not ask Brett to look at a dashboard you can read with a tool (CLAUDE.md).

## Phase 2: compare with something that works
Find similar code in this repo that works. Read it completely. List every difference between the working and the broken case, however small. Do not decide in advance that a difference cannot matter.

## Phase 3: one idea, one test
1. Write it down: "I think X is the cause because Y."
2. Make the smallest change that tests it. One variable.
3. Wrong? Form a new idea. Do not stack a second fix on top of the first.
4. If you do not understand something, say "I do not understand X". Do not pretend.

## Phase 4: fix the cause
1. **Write the failing test first** (`test/<name>.test.mjs`), the simplest thing that reproduces the bug.
2. **One fix**, at the root cause. No "while I am here" changes.
3. **Verify:** the new test passes, the full suite passes, the original symptom is gone (see `verification-before-completion`).
4. **Nothing fails silently.** If the bug hid behind a swallowed error, the fix also makes that failure loud (telemetry row plus a visible message), per CLAUDE.md.
5. **Fix did not work?** Fewer than three tries: back to phase 1 with what you learned. **Three failed fixes: stop.** That pattern means the design is wrong, not the fix. Tell Brett what you tried and what it showed before trying a fourth.

## Stop and go back to phase 1 if you catch yourself thinking
- "Quick fix now, look into it later"
- "Just try changing X and see"
- "It is probably X"
- "I do not fully understand it but this might work"
- "One more try" (after two)
- or when each fix uncovers a new problem somewhere else

| Excuse | Reality |
|---|---|
| "It is simple, no need for the process" | Simple bugs have root causes too, and the process is quick on them. |
| "No time" | Guess-and-check is slower. |
| "I will write the test after" | A fix without a test does not stay fixed. |
| "Several fixes at once saves time" | Then you cannot tell which one worked. |

## When there really is no root cause in our code
If the cause is outside (Google quota, an Intuit outage, the network): say what you checked, add the right handling (retry, clear message), and make sure it is logged so the next one is visible. Most "no root cause" findings are an unfinished phase 1.
