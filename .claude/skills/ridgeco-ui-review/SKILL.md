---
name: ridgeco-ui-review
description: Use for ANY change to an .html or .css file in the RidgeCo repo (the Hub index.html, vendor, tenant and owner portals, tool pages), and when asked to review, check or improve how a RidgeCo screen looks or works. Runs the design standard (DESIGN.md), the ui-check script, before and after screenshots at 412 and 1366, and a short usability checklist, then attaches the result to the PR. Not for public marketing pages (use public-site-taste) or backend-only changes.
---

# RidgeCo UI review

The bar, in Brett's words: the screen is **helpful, informative, not overly complex, organized and easy to navigate**. If a step below would make the review itself complicated, do the simple version and say so.

Do the steps in order. Do not skip one because the change is small.

## 1. Read the standard
Read `DESIGN.md` at the repo root, all of it. It is short. `context/UI_QA_CHECKLIST.md` has the button rules it refers to.

## 2. List the screens you will touch, and who uses each
Write the list down before editing. For each screen name the person and where they are:
- **Vendor** (`vendor.html`, `wo.html`, `vendor-setup.html`): on a phone, often in a basement with a weak signal, gloves on, may read Spanish.
- **Tenant** (`tenant.html`, `submit.html`, `fix-check.html`, `rsvp.html`): on a phone, not technical, never sees money or billing words.
- **Owner** (`owner.html`, `owner-*.html`, customer pages): phone or laptop, wants to know what is happening, when, and who.
- **Brett** (`index.html` and tool pages): Samsung S23 Ultra and a Chromebook. Phone must work; a monitor must be used, not wasted.

## 3. Before screenshots
`node scripts/ui-check.mjs --out ui-check-out/before <pages>` and keep the folder. Look at the 412 and 1366 images so you know what you are changing.

## 4. Make the change with shared parts
Use the tokens and parts in `DESIGN.md` (and `rc-ui.css` / `rc-ui.js` once they exist). No new button style, chip color, font size, radius or shadow. No `alert`, `confirm` or `prompt`. Every vendor and tenant string goes through the translation layer. Keep existing guards wired exactly as they are (`claimSubmit`, load-failed retry boxes, checklist and price checks).

## 5. Run the check
`node scripts/ui-check.mjs --out ui-check-out/after <pages>`
- It must end `RESULT: PASS`. Fix anything marked WORSE. Never raise a baseline number to get a pass.
- Each part prints RAN or NOT RUN. If screenshots or the detector did not run, say so in the PR. Do not write that they passed.
- If your change made a number better, run the `--update-baseline` command it prints and commit `scripts/ui-check-baseline.json`.

## 6. Look at the after screenshots
Open the images at **412** and **1366** for every page touched, and **1920** for Hub and tool pages. Compare with the before images. A screenshot you did not open is not a check.
The default screenshots show the first screen with made-up data. If your change is inside a sheet, a tab or an expanded card, drive the page there (see the `playwright-cli` skill, or copy a `test/manual-verify-*-ui.mjs` file) and capture that state too.

## 7. Walk the checklist on each screen
Answer each with yes, no, or does not apply, plus one line of evidence:
1. **One main action.** Is there exactly one big primary button, and is it the thing this person most likely came to do?
2. **Where am I?** Does the screen say what it is and what it is about (which job, which property) without scrolling?
3. **What do I do next?** Would a first-time user know the next step without help?
4. **Loading, empty, error.** Seen all three? Does the error have a Retry and say what failed? A failed load must never look like "nothing here".
5. **Spanish.** Vendor and tenant screens: switch to Spanish. Any English left? Does longer text still fit?
6. **Double-tap.** Tap each button that saves twice, fast. One save only? Button comes back after a failure?
7. **Back button.** Does the phone's back button close the sheet or return to the list, not leave the portal?
8. **Fits the screen.** No sideways scroll at 412. At 1366 and 1920 the page uses the width (no thin phone column in the middle of a monitor).
9. **Readable and tappable.** Nothing under the minimum text size, tap targets 44px, 8px between neighbours, contrast 4.5:1.
10. **Plain words.** Sentence case, no jargon, no grey all-caps labels, buttons say what they do.

## 8. Fix what fails, then repeat 5 to 7
If something cannot be fixed inside this change, list it under "Known gaps" in the PR. Do not hide it.

## 9. Attach to the PR
Add a section **UI review** to the PR body with:
- the screens touched and who uses each
- the `ui-check` summary (the table and the RESULT line), pasted
- what you saw in the 412 and 1366 screenshots, before and after, in two or three plain sentences per screen (cloud sessions cannot upload images to a PR through GH Broker, so describe them; in CI the images are in the "ui-check-screenshots" download on the PR's checks page)
- the ten checklist answers
- what was not checked and why (for example: no real phone, staging not used)

Then follow `verification-before-completion` before saying the work is done.
