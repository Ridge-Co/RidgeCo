# Polish: the final pass

<!-- From pbakaus/impeccable skill/reference/polish.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: native-app notes and every launcher / critique-storage command removed. -->

Polish is refinement, never a hidden redesign. Keep the look, the content, the behavior and everything outside the scope. If the concept itself is wrong, say so and recommend a redesign instead of smuggling one in.

A detector result is evidence of a defect, not proof of quality. Look at the rendered screen and the real path through it.

## 1. Establish the system

Read `DESIGN.md`, the tokens, the shared parts and the neighboring screens. Classify each drift before fixing it:

- **missing token:** the system needs a reusable value;
- **one-off:** an existing shared part should replace it;
- **mismatch:** the flow or hierarchy differs from comparable screens;
- **local defect:** simply incomplete or inconsistent.

Fix the cause at the narrowest correct level.

## 2. Gather the evidence

Use the feature yourself at phone and desktop sizes. Find out:

- whether the path is functionally complete;
- known constraints or deliberately unfinished work;
- the states, text lengths, roles and input methods people will really meet.

## 3. Triage, in this order

1. broken or blocked tasks, data loss, misleading state, unreachable paths;
2. missing loading, empty, error, success, disabled and no-permission states;
3. flow, hierarchy, responsive and design-system drift;
4. visual and motion inconsistencies;
5. code cleanup.

Do not perfect one corner while the rest sits below the same bar.

## 4. Polish the whole path

**Flow and hierarchy**
- Match the neighboring screens' wording, save behavior and patterns.
- Make the main task and the current state obvious without making everything equally loud.
- Arrival, empty and recovery paths connect instead of behaving as separate screens.

**Layout and type**
- Align to the spacing scale; fix what looks misaligned as well as what measures misaligned.
- Group related content tightly and separate groups generously.
- Same role, same type style. Test wrapping, longer Spanish text and zoom.
- Verify every supported width, not only the screenshot in front of you.

**Color and icons**
- Tokens with stable meanings.
- Check text, control and focus contrast in every state.
- One icon style, one size, optically aligned.

**Interaction and state**
- Every control has default, hover, focus, active, disabled, loading, error and success behavior as applicable.
- Visible keyboard focus, logical tab order, labels, 44px touch targets.
- Do not add animation to make the polish visible.
- Check long, missing, slow, offline and no-permission content.

**Content and code**
- Consistent terms, capitalization and punctuation. Ask before changing a factual claim.
- Remove debug output, dead code and styles your change orphaned.
- Replace one-offs with shared parts where the system owns the pattern.
- Promote a value to a token only when it is really reused.

## 5. Verify and finish

Walk the whole path again with mouse, keyboard and touch. Check:

- phone, in-between and wide layouts;
- loading, empty, error, success, disabled, long-content and missing-content states;
- zoom, contrast, focus and screen-reader names;
- console errors and layout jumps;
- agreement with `DESIGN.md`, the neighboring screens and the scope you were given.

Finish with a read of your own diff: remove accidental churn, orphaned code and temporary files.
