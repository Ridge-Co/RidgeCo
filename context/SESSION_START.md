# Session Starter — Instructions for Claude

## PASTE THIS AT THE START OF EVERY COWORK SESSION:

---

Load my Brett AI context before doing anything else.
Clone https://github.com/Ridge-Co/RidgeCo and read every file in the /context/ folder,
starting with CURRENT.md to confirm which versions are active.
Do not start any task until you confirm you have read the context files.

---

## What Claude does with this instruction

1. Clones ridge-co/RidgeCo (public repo — no token needed for read)
2. Reads /context/CURRENT.md to find the active file versions
3. Reads Brett_Context_Document_vX.X.md — full project context, PAT library, stack rules
4. Reads Brett_Cowork_Best_Practices_vX.X.md — session workflow and rules
5. Confirms back to Brett: "Context loaded. [version numbers]. Ready."
6. Then proceeds with the session task

## Why GitHub and not Google Drive

Google Drive applies an AI-content restriction to some files that blocks Claude from reading them.
GitHub has no such restriction — Claude can always read repo files.
All context updates are pushed here. Drive copies are for human reference only.

## Quick opener (shortest version)

"Load Brett context from ridge-co/RidgeCo/context/ then [your task]."
