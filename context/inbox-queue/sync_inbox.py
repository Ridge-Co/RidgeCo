"""
Inbox Queue Sync — autonomous, tokenless context writes.

Runs in GitHub Actions on a schedule. Uses the BrettOS service account (read-only
Drive scope) to read capture files that Claude dropped into the BrettOS_Inbox_Queue
Drive folder from ANY session (no pasted GitHub token needed), folds new ones into
context/CAPTURE_INBOX.md, and records processed file IDs so nothing is ingested twice.
The workflow then commits the result with the built-in GITHUB_TOKEN.

    Claude -> Drive (account OAuth) -> this script (service account, read-only) -> repo commit (Actions token)

No human and no pasted token anywhere in the autonomous path.

One-time setup required (see context/inbox-queue/README.md):
  1. Share the BrettOS_Inbox_Queue Drive folder with the service account (Viewer).
  2. Enable the Google Drive API on GCP project brettos-502323.
"""
import io
import json
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

QUEUE_FOLDER_ID = "13Pc3nsJQWd7yu4gz7963evBvQEjT7pg7"  # BrettOS_Inbox_Queue
INBOX_PATH = "context/CAPTURE_INBOX.md"
PROCESSED_PATH = "context/inbox-queue/processed.json"
INSERT_MARKER = "<!-- QUEUE-SYNC-INSERT (synced captures land above this line) -->"

# ── Auth (read-only Drive) ──────────────────────────────────────────────────────
sa_key = json.loads(os.environ["GOOGLE_SA_KEY"])
creds = service_account.Credentials.from_service_account_info(
    sa_key, scopes=["https://www.googleapis.com/auth/drive.readonly"]
)
drive = build("drive", "v3", credentials=creds, cache_discovery=False)

# ── Load processed ledger ───────────────────────────────────────────────────────
try:
    with open(PROCESSED_PATH) as f:
        processed = set(json.load(f).get("processed_file_ids", []))
except FileNotFoundError:
    processed = set()

# ── List capture files in the queue folder ──────────────────────────────────────
query = (
    f"'{QUEUE_FOLDER_ID}' in parents and trashed = false "
    f"and mimeType != 'application/vnd.google-apps.folder'"
)
files = []
page_token = None
while True:
    resp = (
        drive.files()
        .list(
            q=query,
            spaces="drive",
            fields="nextPageToken, files(id, name, createdTime)",
            orderBy="createdTime",
            pageToken=page_token,
        )
        .execute()
    )
    files.extend(resp.get("files", []))
    page_token = resp.get("nextPageToken")
    if not page_token:
        break

new_files = [
    f for f in files if f["id"] not in processed and f["name"].startswith("capture-")
]

if not new_files:
    print("No new captures in queue. Nothing to sync.")
    sys.exit(0)


def download_text(file_id):
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, drive.files().get_media(fileId=file_id))
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue().decode("utf-8", errors="replace")


with open(INBOX_PATH, encoding="utf-8") as f:
    inbox = f.read()

if INSERT_MARKER not in inbox:
    print(f"ERROR: insert marker not found in {INBOX_PATH}", file=sys.stderr)
    sys.exit(1)

blocks = []
for f in new_files:
    body = download_text(f["id"]).strip()
    provenance = f"\n<!-- synced from queue: {f['name']} ({f['id']}) @ {f['createdTime']} -->\n"
    blocks.append(provenance + body + "\n")
    processed.add(f["id"])

insertion = "".join(blocks) + "\n"
inbox = inbox.replace(INSERT_MARKER, insertion + INSERT_MARKER, 1)

with open(INBOX_PATH, "w", encoding="utf-8") as f:
    f.write(inbox)

os.makedirs(os.path.dirname(PROCESSED_PATH), exist_ok=True)
with open(PROCESSED_PATH, "w", encoding="utf-8") as f:
    json.dump({"processed_file_ids": sorted(processed)}, f, indent=2)

print(f"Synced {len(new_files)} new capture(s):")
for f in new_files:
    print(f"  + {f['name']} ({f['id']})")
