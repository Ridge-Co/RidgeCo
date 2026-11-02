# Delivery Intake - setup (script version 1.2.0, Oct 23 2026)

**Install the identical script in each mailbox.** The same file in every mailbox that might receive store emails (info@, brett@, and later a RidgeCo Gmail). Nothing in the file says which mailbox it is; Google tells it. **No password, no token, no calendar sharing.**

What it does: every minute each copy finds new Home Depot / Lowe's / Ace / Walmart delivery emails in its own mailbox and sends each to the Hub. The Hub creates or updates the Delivery, links the property and work order, texts Brett, and **writes the Google Calendar itself** (the script never touches the calendar). The script emails you only when something goes wrong.

- Code: `apps-script/delivery-intake/DeliveryIntake.gs` + `appsscript.json`
- Test: `node apps-script/delivery-intake/test/delivery-intake.test.mjs`
- Hub side: `POST /intake/delivery-email` (separate PR)

Nothing runs until you do the steps below. Merging the PR only stores the files in GitHub.

## Install in one mailbox (about 3 minutes, Chrome on the Chromebook). Do it BEFORE you order.

Emails that arrived before you run Setup are never imported.

1. Sign in to Chrome as that mailbox. Go to **script.google.com** -> **New project**. Click **Untitled project** and rename it **Delivery Intake**.
2. **Paste the file.** Click **Code.gs**, **Ctrl+A**, **Delete**, paste the whole of `DeliveryIntake.gs`, **Ctrl+S**.
3. **Paste the manifest.** Gear **Project Settings** -> tick **Show "appsscript.json" manifest file in editor** -> back to **Editor** -> click **appsscript.json**, **Ctrl+A**, **Delete**, paste `appsscript.json`, **Ctrl+S**.
4. **Run setup.** Pick **setup** in the function dropdown, click **Run**. Google asks for permission: **Review permissions** -> choose the mailbox -> **Advanced** -> **Go to Delivery Intake (unsafe)** -> **Allow**. ("Unsafe" only means Google has not reviewed your own private script.) The log ends with `Setup done` and a line `Hub sign-in OK: Google vouches for <this mailbox>`.
5. **Run status.** It must say `Hub sign-in: OK. Google identity token obtained for <this mailbox>` and `Trigger: OK (1)`. Write down the **Script version** (`1.2.0`) and the **Config fingerprint**.
6. **Tell the Hub this mailbox is allowed** (once per mailbox, see below). Then run **dryRunLatest** if you have an old store email: it shows what the Hub would do and creates nothing.

There is nothing to type in: no Script Properties are needed. Optional ones, only if you want them (same value in every mailbox):

- `ALERT_EMAIL`: where failure emails go. Default: the mailbox the script runs in.
- `SENDER_DOMAINS`: comma list. Default `homedepot.com,lowes.com,acehardware.com,walmart.com` (keep in step with the Hub's `Delivery_Sender_Domains`).

To set them in one go, add a temporary function, run it, then delete it: `function runOnce() { setConfig('ALERT_EMAIL=you@example.org'); }`. If a line is wrong it saves nothing and says which line.

## How the script signs in (no secret)

Every call to the Hub carries `Authorization: Bearer <identity token>`. That token is a short-lived, Google-signed proof that "this script is running as <mailbox>" (`ScriptApp.getIdentityToken()`, which is why the manifest has the `openid` permission). The Hub checks Google's signature and then checks that the mailbox's email is on **its own list**: the Hub Config key **`Delivery_Mailboxes`**. If it is on the list, the email is accepted; if not, the Hub answers 401/403.

- The token is requested fresh on every run, lasts about an hour, and is never stored, logged or emailed. `status` shows only the mailbox address and the expiry.
- Nobody has to copy a token anywhere, so there is nothing to leak, rotate or paste. Authority comes from "who owns the mailbox", and you control it from one place (the Hub's list).
- Optional and unused by default: if someone sets an `INTAKE_TOKEN` Script Property, it is also sent as the `X-Auth-Token` header. It is never required and `setConfig` will not store it.

## Adding a future mailbox (for example the RidgeCo Gmail)

1. Sign in as that account and follow "Install in one mailbox": paste the same `DeliveryIntake.gs`, paste `appsscript.json`, run **setup**, run **status**.
2. Add that mailbox's address to the Hub's **`Delivery_Mailboxes`** list. This is the only change anywhere else.
3. Script version and Config fingerprint must match the other copies. Nothing else changes: the Hub already ignores copies of an email it has seen.

## Are the copies identical? (compare after every change)

Run **status** in each mailbox. Two values must be the same everywhere:

- **Script version** (`1.2.0`): the code.
- **Config fingerprint** (8 letters/numbers): the shared settings (alert address, sender domains). With no optional settings it is the same everywhere automatically.

**When you change the code, paste the SAME file into every mailbox and compare SCRIPT_VERSION.** Open each Delivery Intake project, **Ctrl+A**, paste the new `DeliveryIntake.gs`, **Ctrl+S**, run **status**. A code-only change needs no new setup. If `appsscript.json` changes (the PR says so), paste that too and run **setup** again; Google asks you to approve again.

**Upgrading from 1.1.0 (or 1.0):** the permissions changed (calendar removed, `openid` added). In each mailbox paste both files, run **setup**, approve, run **status**. The old token, calendar and event-tracking Script Properties are ignored and can be deleted (Project Settings -> Script Properties). The calendar is now written only by the Hub, so first make sure the Hub's calendar writer is live, otherwise deliveries will have no calendar events in between.

## How duplicates are handled (plain language)

If the same delivery email lands in two mailboxes you want ONE of everything: one record, one text to you, one request to the tenant, one calendar event.

- Every email carries a hidden ID that is the same in every mailbox it reaches (the "Message-ID"). Each copy sends it to the Hub together with the mailbox's own private ID. The first copy to arrive does the work. When the second asks, the Hub answers "I already have that" and the script quietly marks the email done: no alert.
- The Hub also notices the same order and the same details arriving under a different ID (a re-sent or forwarded copy) and treats it the same way, so you are not texted twice.
- **The calendar cannot be doubled by the scripts any more**, because they do not write to it. Only the Hub writes the calendar, one writer, one event per order.

## What you will see

Gmail labels on the store emails (each mailbox has its own): **Delivery/Sent to Hub** (taken, including "the Hub already had it"), **Delivery/Needs Attention** (see the email the script sent you), **Delivery/Ignored** (the Hub says it is not about a delivery, e.g. marketing; no alert).

The normal delivery texts and the calendar event come from the Hub. The script's own emails are failure-only. The subject ends with the mailbox that sent it, so you can tell which copy has the problem:

| Email subject | What it means | What to do |
|---|---|---|
| Delivery watcher is not set up | Setup was never run. Nothing is imported. Repeats hourly. | Run **setup** (step 4). |
| Delivery watcher cannot sign in to the Hub | Google gave the script no identity token ("identity token unavailable"). Nothing is imported; the emails wait. Repeats hourly. | Run **setup** again and approve the permissions (including `openid`), then **status**. |
| Delivery email NOT imported | The Hub did not take an email. `HTTP 401/403` means the Hub refused this mailbox: its address is probably not in the Hub's `Delivery_Mailboxes` list. Retried every minute, reminder hourly. | For 401/403 add the address named in the email to `Delivery_Mailboxes` (tell Claude). Otherwise tell Claude. |
| Delivery email needs your attention | The Hub saved it but parked it as Needs Review, could not text you, could not match the property, or **could not update the Google Calendar** (the email says why; the Hub alerts too). | Open Hub > Deliveries, fix the row. For a calendar failure add the event by hand and tell Claude. |
| ALERT_EMAIL is not a valid address | `ALERT_EMAIL` is set but is not an email. Daily until fixed. | Fix or delete the property. |
| Delivery watcher script error | Something unexpected (for example a Google quota). Retries next minute. | If it keeps coming, tell Claude. |

## Turning it off

Run **removeTrigger** in that mailbox. Run **setup** again to turn it back on (it does not move the "only emails after this" date).

## Things that can go wrong (and how the script copes)

- **Same email, two mailboxes, same minute:** covered above (Hub dedupe).
- **Store email filed under Promotions:** a second search catches only the unmistakable ones (subjects like "your order", "stops away", "out for delivery"). Other Promotions mail is not seen.
- **Google's 9 KB limit per stored setting:** the script keeps its lists short and trims the oldest entries automatically. Nothing needs cleaning up. Old failure notices that get squeezed out are counted and the next email says how many.
- **Permissions:** the first run needs your approval (step 4). If a future version needs a new permission, this doc and the PR say so, and you must run **setup** and approve again in EVERY mailbox; until you do, that copy stops (and, for the identity token, emails you "cannot sign in"). Check the Executions list (left bar) if a copy seems quiet; **status** shows the last run time.
- **Emails sent to you by yourself:** a forward from your own address does not come from the store, so it is ignored. Use a Gmail filter/auto-forward (which keeps the store as the sender), not a manual forward.
- **A copy that is not installed or is switched off** just means the other copies carry on; mail is only imported where the script runs.
- **Not yet proven live.** Apps Script only runs inside Google; the logic is covered by an offline test with fake Gmail, Hub and identity token. Two things only a live run can prove: that `getIdentityToken()` returns a token inside the **time-driven trigger** (not just when you click Run), and that the Hub accepts it. Check both after setup: **status** (editor), then a few minutes later the **Executions** list should show `processDeliveryEmails` completing with no "cannot sign in" email.
- A 1-minute trigger uses a few seconds of Google's daily trigger-time allowance per run, shared with the other scripts in the same mailbox.
