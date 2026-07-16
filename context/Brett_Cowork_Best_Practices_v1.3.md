# Cowork Session Best Practices — Brett's Guide
*Last updated: July 2026 v1.3 | Reference at the start of every session*

---

## SECTION 1: HOW TO START EVERY SESSION

Always open with context. Claude doesn't carry memory between conversations. Begin each session by stating:

- Which project or venture you're working on
- What was last accomplished (reference the Session Log in the relevant spec doc)
- What you want to accomplish today

Example opening:

"We're continuing BrettOS Phase 2. Last session we completed the Worker and basic capture. Today: build the AI Batch Processor. Reference BrettOS_Master_Spec.md in Drive."

Also say: "Load my Brett AI Context from Google Drive before we start."

---

## SECTION 2: HOW TO GIVE INSTRUCTIONS

### 2.1 Always State Your Stack Constraints

- "Use Cloudflare Worker — deployed via GitHub repo ridge-co/RidgeCo, auto-deploys on push to main"
- "Single index.html on GitHub Pages"
- "Google Sheets via service account brett-os-sheets@brettos-502323.iam.gserviceaccount.com"
- "Mobile-first — Samsung Galaxy S23 Ultra is primary device"

### 2.2 Use Multiple-Choice, Not Open Questions

Per PAT-012: ask for lettered options. If the AI asks something open-ended, redirect: "Give me 3 options, lettered A/B/C."

### 2.3 One Deliverable at a Time

Break sessions into: Plan → Build → Review → Document. One clear output per request.

### 2.4 Reference Your Patterns

Before any new build: "Apply BrettOS seed patterns PAT-001 through PAT-026."

---

## SECTION 3: COMMON MISTAKES TO AVOID

| Mistake | What Goes Wrong | Prevention |
|---|---|---|
| Not mentioning Worker editing rule | AI suggests Wrangler or manual paste | Always say "push to GitHub ridge-co/RidgeCo" |
| Skipping mobile requirements | Desktop-only UI | Say "test on Android Chrome / S23 Ultra" |
| Not specifying single index.html | Multi-file structure | Say "single index.html — no subfolders" |
| Open-ended clarification requests | Long back-and-forth | Ask for lettered options or "make your best call" |
| Starting a build without a spec | Scope creep | Create or reference spec before writing code |
| Forgetting Dev Log tab | Missing built-in wishlist | PAT-008 — mention it explicitly |
| Not loading context at session start | AI works blind | Always load Brett AI Context from Drive first |
| Accepting partial code snippets | Can't find where to paste | Require complete file delivery every time |
| Claude assuming instead of asking | Wrong output, wasted time | PAT-025 — Claude must ask before starting if anything is vague |
| Drive docs without version numbers | Can't tell which is current | PAT-026 — always include version in filename |

---

## SECTION 4: BUILD SESSION SEQUENCE

1. Load context — reference spec doc, state current phase
2. **Ask clarifying questions** — resolve any ambiguity before starting (PAT-025)
3. Confirm the single deliverable
4. State constraints — stack rules, mobile-first, push to GitHub not paste
5. **Pre-build verification** — Claude reads all relevant files before writing any code (PAT-024)
6. Review output — test on S23 Ultra before approving
7. **Post-build verification** — Claude confirms all changes are correct and complete
8. Update spec — add row to Session Log
9. Capture Dev Log items that surfaced during session

---

## SECTION 5: NON-BUILD TASKS

### Research
"Do deep research on [topic]. Cite sources. Give me a summary first, then details on request."

### Drafting
Provide audience, tone, purpose upfront.
- Tenant/vendor comms: "Professional but direct. Maryland property management context."
- BarrelCo listings: "Buyer-focused, highlight use cases."

### Analysis
Specify format: "Give me a table" / "Bullet points, max 5" / "One paragraph."

For decisions: "Give me pros/cons then a recommendation."

### WBM/Task Capture
"Here are [N] WBMs — tag, classify, suggest next actions. Don't ask questions — make your best call and flag anything uncertain."

---

## SECTION 6: CONTEXT SHORTCUTS

| Phrase | What It Means |
|---|---|
| "Ridge Co context" | Property maintenance, Baltimore, vendors/tenants, Maintenance Hub |
| "BarrelCo context" | Barrel & planter resale, SKU system, eBay/Craigslist |
| "Cabin context" | WV Cabin STR, Springfield WV, Airbnb/VRBO, Uplisting |
| "BrettOS context" | Cross-venture intelligence layer, GitHub Pages + Worker + Sheets |
| "Winchester Hauling context" | CHEP/PECO pallet recycling, driver portal, automated payments |
| "Apply Section 0" | Apply all Brett Build Standards from BrettOS_Master_Spec |

---

## SECTION 7: END EVERY SESSION

- "Summarize what was built and what's next"
- Update Session Log in the relevant spec doc
- Capture Dev Log items
- Note open questions or pending decisions
- Update Brett_Context_Document in Drive if significant new info (create new versioned file per PAT-026)

---

## SECTION 8: BEST PRACTICES (FROM AI PRODUCTIVITY COMMUNITY)

1. Treat the AI as a senior collaborator — give enough context for it to push back and improve your idea
2. Paste, don't describe — share actual document content, not paraphrases
3. Iterate in small steps — one change at a time is easier to verify
4. Ask for reasoning — "Explain why you made that choice" catches mistakes early
5. Set the constraint first — "You must use X" is faster than correcting after
6. Use structured output — "Return as JSON" or "Return as a table"
7. Separate planning from execution — confirm the plan, then build
8. Capture corrections as permanent rules — every redirect becomes a documented standard (your PAT-XXX system)

---

## SECTION 9: VERIFY BEFORE BUILD (PAT-024) — MANDATORY

This rule applies to every session, every agent, and every workflow without exception.

**Before writing any code or making any changes, Claude must:**

1. Read all relevant files in their current state (index.html, vendor.html, Worker JS, etc.)
2. Understand the full structure — existing functions, variable names, existing routes
3. Identify exactly where changes go and what they touch
4. Confirm no conflicts with existing code before writing a single line

**After making changes, Claude must:**

1. Review every changed section and confirm it is syntactically correct
2. Verify the change integrates cleanly with the surrounding code
3. Confirm nothing was accidentally removed or overwritten
4. Deliver the complete file — never partial snippets or "paste this here" instructions

**Why this matters for Brett specifically:**

Brett cannot easily locate insertion points in large files. Partial code additions create confusion and errors. Complete file delivery is non-negotiable. If Claude cannot verify something is correct, it says so before delivering — not after Brett has already pasted it.

**This rule applies to:**
- All Cowork sessions
- All agents spawned during sessions
- All automated workflows
- All future sessions, regardless of which project

Any agent or workflow definition created for Brett must include this rule explicitly.

---

## SECTION 10: ALWAYS ASK CLARIFYING QUESTIONS (PAT-025) — MANDATORY

This rule applies to every session, every agent, and every workflow without exception.

**Before starting any task, Claude must ask Brett questions to clarify:**

- Anything that is vague or underspecified
- Anything where two reasonable interpretations exist
- Anything where the wrong assumption would cause significant rework
- Access or credential requirements (e.g., "Which account has edit access to this sheet?")
- Scope ("Does this apply to all work orders or just open ones?")
- Priority ("Should I do X first or Y first?")

**How to ask:**

Use the AskUserQuestion tool with multiple-choice options wherever possible — this keeps clarification fast and low-friction for Brett. Don't ask open-ended questions when a few clear options will do.

**What NOT to do:**

- Do not assume and proceed when the answer would materially change the output
- Do not ask unnecessary questions when the context is already clear
- Do not ask more than 4 questions at once — group and prioritize

**This rule applies to:**
- All Cowork sessions
- All agents spawned during sessions
- All automated workflows and scheduled tasks
- All future sessions, regardless of which project

Any agent or workflow definition created for Brett must include this rule explicitly.

---

## SECTION 11: VERSION NAMING CONVENTION (PAT-026) — MANDATORY

This rule applies to all Drive document creation in all sessions.

**All Drive documents must include the version number in the filename.**

Format: `DocumentName_vX.Y` (e.g., `Brett_Context_Document_v1.8`, `Brett_Cowork_Best_Practices_v1.3`)

**Rules:**
- Every new version = new file with incremented version number in both the filename AND the document header
- Old versions should have "DELETE" added to their name — since Drive MCP cannot rename files, Claude must add them to the deletion list and inform Brett which files to manually delete
- Never create a Drive document without a version number in the filename
- When creating any Drive doc, always confirm the correct version number before creating

**Why this matters:**
Drive MCP has no rename or delete capability. Without version numbers in filenames, it's impossible to tell which file is current. Brett was accidentally deleting the wrong versions because filenames were identical.

**This rule applies to:**
- All Cowork sessions
- All Drive documents across all projects
- All future sessions, regardless of which project

---

*Reference at the start of every session | v1.3 — July 2026*
