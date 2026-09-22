# Receipt Mail → Hub (v1.0, Sep 22 2026)

Gets emailed purchase receipts (Home Depot, Lowe's, Amazon, anything Brett approves) into the
Drive folder the Receipt Reconciler already scans, so they get OCR'd, matched to a work order
and billed the same way a scanned paper receipt is.

- **Code:** `apps-script/receipt-mail-to-hub/ReceiptMailToHub.gs` + `appsscript.json` (Google Apps Script, runs in Gmail's account, not in the Worker)
- **Offline test:** `node apps-script/receipt-mail-to-hub/test/receipt-mail-to-hub.test.mjs` (51 checks, fakes Gmail/Drive/Sheets across two mailboxes)
- **Worker side:** `receiptReconScan` batch cap (FEATURE_LOG `[FL-20260922-1900-rm]`)
- **Target folder:** "Receipts and Invoices" `1-sf6pQN2DD3qj5cPZavy1k0DOfH4U20n` (same as `RECEIPT_RECON_FOLDER_ID_DEFAULT`)

## Why it's built this way (Brett's requirements)

1. **No AI in retrieval.** Emails are selected by Gmail filters and plain sender + subject rules. The only AI step is the Hub's existing receipt OCR, which runs after the file lands in the folder.
2. **Filters, not scheduled searches.** Each approved rule is a real Gmail filter that labels mail `Receipts/To Hub` as it arrives. The 10-minute job reads that label only; it never searches the inbox. (The one exception: when a rule is first approved, a single search back to `Backfill_Since` labels its past emails once.)
3. **Off Cloudflare cron.** Runs on Apps Script triggers (Google's scheduler). Nothing new was added to `wrangler.toml`. The only Worker change caps how many new files one scan call handles, because a backfill can drop dozens of files at once.
4. **Self-extending, with approval.** Every Monday the script lists receipt-looking senders that aren't covered yet. Brett sets each to Approved or Denied in the sheet. An approved rule gets its filter and backfill within 10 minutes. A denied one is never proposed again.
5. **Documented + testable.** This file, the test harness, and a Log tab recording every email handled.

## How it flows

```
Email arrives ──► Gmail filter (per approved rule) ──► label "Receipts/To Hub"
   (or Brett adds that label by hand, e.g. a vendor forwarding an order)
                                   │
                  every 10 min: processQueue()  (Apps Script, per mailbox)
                                   │  saves PDF/photo attachment, or renders the email body to PDF
                                   ▼
      Drive "Receipts and Invoices"  (file: 2026-09-10_HomeDepot_<msgid>.pdf, description links to the email)
                                   │  thread relabeled "Receipts/Sent to Hub"; row in the Log tab
                                   ▼
      Hub Receipt Reconciler: daily cron (5 files) or the Scan button (8 per tap) → OCR → suggested WO
                                   ▼
      Brett taps Confirm → Receipts row → Invoice_Review / QuickBooks (unchanged, confirm-first)
```

## Pieces

| Piece | What it does |
|---|---|
| Sheet **"Receipt Mail → Hub Rules"** | Shared by all installs. Tabs: **Rules** (Rule_ID, Status Approved/Pending/Denied, From, Subject_Contains, Store, …), **Config**, **Log**. |
| `setup()` | Run once per mailbox: creates or finds the sheet, creates labels and triggers, syncs filters and backfill, and runs a 90-day discovery. |
| `processQueue()` every 10 min | Syncs rules to filters, then works the `To Hub` label: up to `Max_Per_Run` emails per run, with a 4.5-minute time guard. |
| `weeklyDiscovery()` Mon 7am (each mailbox) | Finds candidate senders from the last `Discovery_Days` and adds them as Pending. Grouped by sender + subject pattern, with numbers, order #s and quoted product names stripped. |
| `weeklyDigest()` Mon 8am (Notify_Email's mailbox only) | One email listing everything Pending, plus the week's saved and error counts. |

**Rule matching** follows Gmail filter semantics. `From` can be a full address or a domain (`lowes.com` matches `do-not-reply@notifications.lowes.com`). Every word of `Subject_Contains` must appear in the subject, and blank means any subject.

**Hand-tagged threads** (no rule matches): only the newest email in the thread that has an attachment is sent. If none has one, the newest email is rendered instead. Older emails in the thread are logged as `skipped`, so re-tagging doesn't create duplicates.

**Duplicate protection:**
1. The Log is keyed on both the Gmail message ID and the RFC `Message-ID` header. That header is the same when one email reaches both brett@ and info@, so only one file is made.
2. The script won't create a Drive file whose name already exists.
3. The Hub's own `Source_File_ID` dedup.
4. The Reconciler's on-demand duplicate checker. Run it on backfilled receipts that may have been entered by hand before.

**Errors:** a failed save stays queued and retries on the next run. After 3 failures the email moves to `Receipts/Hub Error` and shows in the Monday email.

**What gets saved:** PDF attachments and images of at least `Min_Image_KB`, which skips logos and signature images. HEIC and TIFF are skipped because the Hub OCR accepts only jpeg, png, gif and webp. If there's no usable attachment, the HTML body is rendered to PDF with a From/Date/Subject/Mailbox header on top.

## Seeded rules

- **R1** `HomeDepot@order.homedepot.com` / "Electronic Receipt". Approved. Verified: carries `eReceipt.pdf`.
- **R2** `HomeDepotReceipt@homedepot.com` / "Electronic Receipt". Approved. The older sender.

Lowe's and Amazon are **not** pre-approved, on purpose. Each order sends several email kinds, and some have no prices. Lowe's "Your Order is Ready for Pick Up" lists items and quantities only; Amazon's "Ordered:" emails have no tax line. They come through the first discovery run as Pending, so Brett approves the kind that's the real receipt. He can shorten Subject_Contains first, e.g. "Order Confirmation".

## Setup (per mailbox, brett@ first)

1. script.google.com (signed in as that mailbox) → New project, named "Receipt Mail → Hub". Paste `ReceiptMailToHub.gs` over `Code.gs`.
2. Project Settings (gear) → tick **Show "appsscript.json" manifest file**. Back in Editor, paste `appsscript.json` over it → Save. This enables the Gmail API advanced service and the scopes, including `gmail.settings.basic`, which filter creation needs.
3. Function dropdown → `setup` → Run → approve permissions. The execution log prints the sheet URL and counts.
4. Repeat 1–3 signed in as **info@**. Setup finds the shared sheet (brett@'s setup shared it with info@) and does **not** install a second Monday email.

The Drive folder is already shared with both brett@ and info@ as organizer (verified Sep 22).

## Config tab

`Drive_Folder_ID`, `Backfill_Since` (yyyy/mm/dd, default 2026/07/01), `Notify_Email`, `Share_With`, `Max_Per_Run` (25), `Discovery_Days` (8), `Min_Image_KB` (30).

## Troubleshooting

- **Nothing moving:** check the Log tab, and Apps Script → Executions for errors. Check that the label `Receipts/To Hub` has threads.
- **Rule approved but no filter:** it's created on the next 10-minute run. Check Gmail Settings → Filters. A 403 "insufficient permission" means the manifest from step 2 wasn't pasted.
- **Files in the folder but not in the Reconciler:** the daily cron takes 5 per day. Tap **Scan** on the Reconciler page; each tap takes 8 and says how many are still waiting.
- **Stop everything in one mailbox:** Apps Script → Triggers → delete. Filters stay, and emails just pile up under `Receipts/To Hub`.

## Claude's access to info@ (Brett's question, Sep 22)

The Gmail connector is one OAuth grant for one Google account. Being the Workspace owner doesn't let brett@'s grant read info@. Gmail delegation doesn't either: it's UI-only and not exposed to the API. None of this matters to the pipeline above, which runs inside each mailbox. To let a Claude session see and act on info@ mail with no limits, the options are:

1. **Recommended: Admin console routing.** Admin console → Apps → Google Workspace → Gmail → Routing → add a rule for `info@` with "Also deliver to" `brett@bmoremanagement.com`. Every new info@ email then also lands in brett@. Add a brett@ filter `deliveredto:info@bmoremanagement.com` → label `info@` (skip inbox if wanted). Add info@ under brett@ Settings → Accounts → **Send mail as**, so replies can go out as info@. Limitation: routing only affects mail from now on. The info@ install of this script covers the July 1+ backfill.
2. **Switch the connector** to info@ for a session. Only one account at a time.
3. **Service account + domain-wide delegation.** The Worker's existing `maintenance-hub-sheets@…` account could be granted Gmail scopes for info@. It's powerful, but it's a real security surface, so it's not recommended for this.
