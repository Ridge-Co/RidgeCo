---
name: pre-build-grill
description: Use at the start of ANY new RidgeCo feature or behavior change, before writing code or a plan, and whenever Brett says "grill me" or asks to pressure-test an idea. Runs the pre-build gate (context/PRE_BUILD_GATE_v1.0.md), answers what the defaults already settle, and asks every still-open question in ONE batch with a recommended answer for each. Skip only when the brief already answers the questions.
---

# Pre-build grill

Adapted from the `grilling` skill in mattpocock/skills (MIT), folded into RidgeCo's pre-build gate. Purpose: the build lands about 85% right the first time, and Brett is asked fewer questions every month.

## Rules
1. **Facts are your job, decisions are Brett's.** Never ask Brett something you can look up in the repo, the context files, the sheet, staging or a tool. Look it up first.
2. **Defaults before questions.** Brett's past decisions are written down as defaults in `context/PRE_BUILD_GATE_v1.0.md`. A question the default already settles is not asked.
3. **One batch.** Ask everything that is still open in a single message, numbered. Not one at a time, not a drip across the build.
4. **Every question carries your recommended answer**, worded so that "yes" accepts it.
5. **Nobody there to answer** (scheduled or overnight run): do not wait. Use the recommended answers, and list each one under "Decisions I made" in the PR so Brett can overrule it.

## Steps
1. **Say the goal back** in two or three plain sentences: what is wanted, who it is for, and why. If the why is unknown and cannot be found, that is question 1.
2. **Read the gate file** and tag the feature's shapes (`record` `list` `schedule` `message` `money` `doc` `photo` `ui` `endpoint` `job` `external` `role` `write`).
3. **Walk every matching item**, plus the standing parameters C1 to C17 and every `any` item. Mark each Y (in this build), N (left out on purpose) or n/a. Fill each from its default where the default fits.
4. **Add the questions the gate does not have**: walk the design as a tree. Each decision opens the decisions that hang off it. The ones whose prerequisites are settled are askable now; one that depends on an answer you do not have yet waits for a second round. Aim for one round; allow a second only when the first answers open new branches.
5. **Touches a screen?** Add from `DESIGN.md`: who uses it and on what device, the one main action, what the empty, loading and error states say, and whether it needs Spanish.
6. **Ask the batch** in this form (use the question tool when the session has one):

```
Q1. <short title>: <the question, with the choices if there are any>
    Recommended: <your answer, and the one-line reason>
Q2. ...
```

7. **Stop and wait** for the answers when Brett is there. Then repeat steps 4 and 6 only for questions his answers opened.
8. **Write it down.** In the PR note (`context/notes/YYYYMMDD-<slug>.md`) under `## Pre-build gate`: the shapes, one line per item that was N or that Brett overrode, and `Companion actions included:`. After delivery, anything Brett still asks for goes under `## Late requests` and becomes a new gate item or a changed default.

## Done when
Every branch has an answer from Brett, from a written default, or from a recommended answer recorded as a decision. Nothing is silently assumed. Then go to `writing-plans` (several steps) or straight to the build (small change).

## Do not
- Ask what a default, the brief, or the code already answers.
- Ask in words what needs to be seen. "One long form or three steps?" is answered by showing both, not by asking.
- Start building while a money, privacy, login or customer-text question is open. Those wait for Brett (gate item C9).
