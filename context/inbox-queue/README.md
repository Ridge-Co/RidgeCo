# Inbox Queue — Autonomous Context Autopilot

This is how Claude writes to the shared context **without a pasted GitHub token** —
so captures land in the repo even from scheduled/while-you-sleep sessions.

## The loop

```
Claude (any session)                 GitHub Actions (scheduled)
   │ writes a capture file               │ reads queue with the service account
   │ to the Drive queue folder  ───────▶ │ (read-only), appends to CAPTURE_INBOX.md,
   │ via Google Drive (account OAuth)    │ commits with the built-in GITHUB_TOKEN
```

No human and no personal token anywhere in the autonomous path. The only credentials
used are ones that are already always-on: the account's Google OAuth (Claude→Drive)
and GitHub Actions' own token (Actions→repo).

## Pieces

- **Drive queue folder:** `BrettOS_Inbox_Queue` (ID `13Pc3nsJQWd7yu4gz7963evBvQEjT7pg7`), inside the Brett AI Context folder.
- **`sync_inbox.py`:** reads new capture files from the folder, folds them into `../CAPTURE_INBOX.md` above the `QUEUE-SYNC-INSERT` marker, records their file IDs in `processed.json`.
- **`.github/workflows/context-sync.yml`:** runs the script every ~30 min (and on manual dispatch), then commits.
- **`processed.json`:** ledger of already-ingested Drive file IDs (prevents double-ingest). Read-only Drive access is enough because we track state here, not in Drive.

## How Claude writes a capture (the convention)

Create a file in the queue folder named `capture-YYYYMMDD-HHMMSS-slug.md`, containing
one or more CAP items in the standard inbox format. The sync will pick it up on its
next run. Interactive sessions with a pasted token can still push directly for speed;
this path is the fallback that always works.

## One-time setup (required before the loop runs)

1. **Share the queue folder with the service account:** share `BrettOS_Inbox_Queue`
   (or the parent Brett AI Context folder) with
   `brett-os-sheets@brettos-502323.iam.gserviceaccount.com` as **Viewer**.
2. **Enable the Google Drive API** on GCP project `brettos-502323` (the service
   account already uses the Sheets API; Drive must be enabled too).

Once both are done, the next scheduled run (or a manual "Run workflow") will sync.
