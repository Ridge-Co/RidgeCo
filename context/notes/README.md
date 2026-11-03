# context/notes: one note file per PR (Oct 21 2026)

**Why:** every PR used to add its entry to the TOP of `context/CURRENT.md` and the END of `context/FEATURE_LOG.md`. Two open PRs
therefore always conflicted on those two files, and a session had to re-cut its branch by hand. Now a PR adds ONE new file here and
does not touch the two big files. A new file can never conflict with anyone else's.

## Rules
1. **A PR adds `context/notes/YYYYMMDD-<branch-slug>.md` and does NOT edit `CURRENT.md` or `FEATURE_LOG.md`.** (The big files stay as the
   history up to Oct 21 2026; a later tidy-up PR may fold notes into them. Nobody else should.)
2. **"Load context first" includes this folder:** read `CURRENT.md`, then every file in `context/notes/` (newest first). Notes are the
   newest status; where a note and `CURRENT.md` disagree, the note wins.
3. A note is edited only by the PR that created it (so it stays conflict-free). To change status later (merged, verified, superseded),
   do it in a NEW PR's note that says "supersedes note X" or by editing the old note in that later PR; never both at once.
4. `scripts/doc_audit.py` counts each note as one documentation entry, so the nightly "undocumented commit" audit still works.

## Format
```
# <TITLE> — <date> — PR #<n> into <base>, head `<branch>` (cut from main tip <sha>), merged: yes/no
## CURRENT
What is built/tested, counts, what is NOT verified and why (staging yes/no at which version), what is left open.
Checklist from context/BRANCH_POLICY_v1.0.md (PR number AND base, head branch, staging twin listed separately).
## FEATURE_LOG
**[FL-YYYYMMDD-<slug>]** <what it is, regression rules, tests>. (Same content you would have appended to FEATURE_LOG.md.)
```
Use `commit_file` for the note (it is a new, small file). Never `commit_patch` the big files again unless you are the tidy-up PR.
