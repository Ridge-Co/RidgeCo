---
name: writing-plans
description: Use when a RidgeCo change has several steps or touches more than one file and the requirements are settled (after pre-build-grill), before touching code. Writes a short task-by-task plan with exact files, names, values and the test that proves each task, so a build session can follow it without guessing. Not needed for a one-file fix.
---

# Writing plans

Adapted from obra/superpowers (MIT), trimmed for RidgeCo. Write the plan for a builder who has not seen this conversation. Assume they write good code once they know the exact interface and the exact test. What they cannot know is what you decided: which files, which names, which values, which tests. Write those down. Small tasks, nothing extra, test first.

## Where it goes
The PR note in `context/notes/` for a small plan, or `context/<NAME>_BUILD_BRIEF_v1.0.md` plus the matching Continuous Improvement project doc for a build brief.

## Before the tasks
- **Scope check.** If the work is really several independent pieces, write one plan per piece. Each plan produces something that works and can be tested by itself. One phase = one branch = one PR.
- **Map the files.** List what will be created or changed and what each is for. Follow the repo's patterns (one `worker.js`, static pages, no build step, no new folders). Big files are edited with `commit_patch`, never re-sent whole.

## Header (every plan starts with this)
```
# <Feature> plan
Goal: <one sentence>
Approach: <two or three sentences>
Brief: <path to the brief or note this plan implements>
Standing rules: <the ones that bite here, copied exactly: branch from main, staging first, no cron, nothing fails silently, BUILD_VERSION untouched, one notes file, DESIGN.md for any screen>
Review focus: <up to five inputs or failures the brief implies but no task tests yet, most likely first; each one then gets a test in the task that owns that code>
```

## Each task
A task is the smallest piece that has its own test and that a reviewer could accept or reject by itself.
```
### Task N: <name>
Files: create <path>; change <path> (<function or section>); test <path>
Uses: <what it needs from earlier tasks: exact names>
Gives: <what later tasks rely on: exact function names, parameters, return shape>
- [ ] Write the failing test: <test name and what it asserts, with the brief's exact values>
- [ ] Run it and see it fail: <command> -> <expected failure>
- [ ] Implement <exact signature> in <file>. <One line on the approach only where the signature and test leave a real choice>
- [ ] Run it and see it pass: <command>
- [ ] Commit
```
A step is finished when the builder can write exactly one reasonable thing from it. No step says "handle edge cases", "add validation" or "TBD". No step contains a whole function body the signature and test already determine.

## Check your own plan
1. **Coverage:** every requirement in the brief has a task. Add a task for any that does not.
2. **Steps:** each one decides something, and none is a transcript of the code.
3. **Names:** a function called one thing in task 3 is called the same thing in task 7.
4. **Review focus:** each line there has a test in some task.
5. **Length:** a plan several times longer than its brief has written the program instead of planning it.
6. **RidgeCo:** the last tasks are always: full suite (`node --test test/*.test.mjs`), `ridgeco-ui-review` if a screen changed, the PR note with `## Pre-build gate`, and `verification-before-completion`.

## Hand off
Show Brett the plan and ask whether it captures what he wants before building. Scheduled run with nobody there: build from it, and say in the PR that the plan was not reviewed.
