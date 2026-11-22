# Queue #132 emergency guidance on the request forms — Nov 22 2026 — head `feat/queue-132-emergency-guide` (cut from main tip 02f94e7)

## CURRENT
PR number and base are in the PR itself (PR -> `main`). Not merged by the runner: it changes tenant-facing pages, so Brett merges. BUILD_VERSION and CURRENT.md untouched.

Built: an always-visible "Is this an emergency? / ¿Es una emergencia?" box (911 first, what counts as Urgent, what to do while you wait) above the urgency select on `tenant.html` (Submit a request modal) and `submit.html` (public intake). English then Spanish in each paragraph. Static markup only: no JS, no payload change, options unchanged.
Not built (needs Brett, GATED): an "emergency" priority that alerts Brett (new priority value through POST /workorder, notify tiers, an SMS), and the classifier flag (#142). Existing "Urgent" stays the only escalation path.
Skipped on purpose: `owner-submit.html`. It is the owner's form, not the tenant's; tenant safety steps do not belong there.
Wording is the brief's draft; Brett should read the Spanish.

## Pre-build gate
Shapes: `ui` (static copy on two forms). No record, message, money, endpoint, job or write.
Items that are N or n/a:
- B20 Voice dictation: n/a. No free-text box added.
- B26 Spanish: Y. Stacked EN / ES (no language toggle on these pages). Spanish is a first draft.
- B32 Empty, loading, error: n/a. Static text.
- B33 Phone first: Y. 13px minimum text, no new inputs or buttons, no fixed widths. Looked at at 412 and 1366.
- Emergency phone number to print: N. None supplied, and the brief says never invent one. Left out.
- "Urgent notifies right away at any hour": N. Not promised; the modal's existing "notified as soon as you submit" is the only promise.
- Alert Brett on emergency / new priority value: N (GATED, see CURRENT).
Defaults taken: C1-C17 apply as written. C2 no cron: none added. C3: no code path that can fail. C6 and C7: nothing about money or access codes. C8: branch, PR into main, Brett merges. C9: SAFE class (copy change, customer-facing page so not self-merged). C11/C12/C17: no data, columns or switches.
Companion actions included: Spanish mirror; markup-pin test that checks the guide is above the select and the options are unchanged.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261122-132-emergency-guide]** Rules: 1. The guide stays ABOVE the urgency select on `tenant.html` and `submit.html` (test/emergency-guide.test.mjs). 2. Never print a phone number in it unless Brett supplies one. 3. It promises nothing about response time beyond the modal's existing line.
