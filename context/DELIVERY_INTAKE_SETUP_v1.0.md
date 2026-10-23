# Delivery Intake - setup (script version 1.1.0, Oct 23 2026)

**Install the identical script in each mailbox.** The same file, the same settings, every mailbox that might receive store emails (info@, brett@, and later a RidgeCo Gmail). Nothing in the file says which mailbox it is; Google tells it. If a delivery email reaches two of your mailboxes, each copy sees it, and the Hub and the calendar make sure it is counted once.

What it does: every minute, each copy finds new Home Depot / Lowe's / Ace / Walmart delivery emails in its own mailbox, sends each to the Hub, and keeps the shared Google Calendar up to date. The Hub creates or updates the Delivery, links the property and work order, and texts Brett. The script emails you only when something goes wrong.

- Code: `apps-script/delivery-intake/DeliveryIntake.gs` + `appsscript.json`
- Test: `node apps-script/delivery-intake/test/delivery-intake.test.mjs`
- Hub side: `POST /intake/delivery-email` (separate PR)

Nothing runs until you do the steps below. Merging the PR only stores the files in GitHub.

## The settings block (the SAME in every mailbox)

Three Script Properties. Copy these three lines, fill in the token once, and use the same values in each mailbox:

```
INTAKE_TOKEN=<paste the token from showToken() in the Buildium Intake project>
CALENDAR_ID=brett@bmoremanagement.com
ALERT_EMAIL=brett@bmoremanagement.com
```

- `INTAKE_TOKEN`: the same token the Buildium project already uses. No change in Cloudflare.
- `CALENDAR_ID`: the ONE calendar every mailbox writes to (the calendar you actually look at). Same value everywhere.
- `ALERT_EMAIL`: where the failure emails go. Same value everywhere. If it is missing, failure emails go to the mailbox the script runs in, and you get a daily reminder to set it.
- Optional: `SENDER_DOMAINS` (comma list; default `homedepot.com,lowes.com,acehardware.com,walmart.com`; keep in step with the Hub's `Delivery_Sender_Domains`). If you set it, set it the same in every mailbox.

## Install in one mailbox (about 5 minutes, Chrome on the Chromebook). Do it BEFORE you order.

Emails that arrived before you run Setup are never imported.

1. Sign in to Chrome as that mailbox. Go to **script.google.com**. Click **New project** (top left). Click **Untitled project** at the top and rename it **Delivery Intake**.
2. In the left list click **Code.gs**. Press **Ctrl+A**, **Delete**, then paste the whole contents of `DeliveryIntake.gs`. Press **Ctrl+S**.
3. In the left bar click the gear **Project Settings**. Tick **Show "appsscript.json" manifest file in editor**. Click **Editor** (the `< >` icon), click **appsscript.json**, **Ctrl+A**, **Delete**, paste the contents of `appsscript.json`, **Ctrl+S**.
4. Enter the settings block. Easiest: gear **Project Settings** -> scroll to **Script Properties** -> **Edit script properties** -> **Add script property**, once for each of the three lines above (Property = the part before `=`, Value = the part after) -> **Save script properties**.
   - Faster alternative, one paste: in the Editor add a temporary function at the bottom of Code.gs, fill in the real token, pick `runOnce` in the function dropdown and click **Run**. Then **delete the temporary function** so the token is not left in the code:
     ```
     function runOnce() {
       setConfig(`INTAKE_TOKEN=PASTE_TOKEN_HERE
     CALENDAR_ID=brett@bmoremanagement.com
     ALERT_EMAIL=brett@bmoremanagement.com`);
     }
     ```
     If any line is wrong it saves nothing and tells you which line.
   - To get the token: in a second tab, signed in as brett@, open the **Buildium Intake** project, pick **showToken** in the function dropdown, **Run**, and copy the long `INTAKE_TOKEN` value from the **Execution log**.
5. Click **Editor**, pick **setup** in the function dropdown, click **Run**. Google asks for permission: **Review permissions** -> choose the mailbox -> **Advanced** -> **Go to Delivery Intake (unsafe)** -> **Allow**. ("Unsafe" only means Google has not reviewed your own private script.) The Execution log ends with `Setup done`.
6. Make sure this mailbox can edit the shared calendar (next section), then run **testCalendar**. The log must say `CALENDAR OK`.
7. Run **status**. Write down the **Script version** and the **Config fingerprint** it prints.

## The shared calendar (every mailbox except the calendar's owner needs this once)

The calendar named in `CALENDAR_ID` (brett@'s) must be shared with each other mailbox with permission to make changes:

1. In brett@'s Google Calendar, hover the calendar under **My calendars** -> three dots -> **Settings and sharing** -> **Share with specific people or groups** -> **Add people and groups** -> the other mailbox (info@, the RidgeCo Gmail) -> permission **Make changes to events** -> **Send**.
2. In the OTHER mailbox's Google Calendar, accept it if there is an invitation. If it does not appear under **Other calendars**, click **+** next to **Other calendars** -> **Subscribe to calendar** -> type the calendar's address. (Apps Script can only use a calendar that is in the mailbox's own calendar list.)
3. Back in that mailbox's Delivery Intake project run **testCalendar**. `CALENDAR OK` means it works. If it says the calendar was not found, step 2 is not done.

## Are the copies identical? (compare after every change)

Run **status** in each mailbox. The log shows two values that must be the same everywhere:

- **Script version** (for example `1.1.0`): the code.
- **Config fingerprint** (8 letters/numbers, for example `3fa9c1d2`): the shared settings (calendar, alert address, sender domains). It does not reveal the token. To compare tokens, **showToken** shows the last 4 characters.

**When you change one, paste the same file into the others and compare SCRIPT_VERSION.** Concretely: when the code changes, open each mailbox's Delivery Intake project, **Ctrl+A**, paste the new `DeliveryIntake.gs`, **Ctrl+S**, run **status**, and check the Script version matches the others. You do not need to run setup again for a code-only change (the trigger and settings stay). If the change also touches `appsscript.json` (it says so in the PR), paste that too and run **setup** once more; Google will ask you to approve again.

## Adding a future mailbox (for example the RidgeCo Gmail)

1. Follow "Install in one mailbox" in that account, with the same three settings.
2. Share the calendar with that account (see above) and run **testCalendar**.
3. Run **status**; Script version and Config fingerprint must match the others.
4. Nothing else changes: the Hub accepts any mailbox, and it already knows how to ignore copies of an email it has seen.

## How duplicates are handled (plain language)

If the same delivery email lands in two mailboxes, you want ONE of everything: one record, one text to you, one request to the tenant, one calendar event. Here is how:

- Every email carries a hidden ID that is the same in every mailbox it reaches (the "Message-ID"). Each copy sends that ID to the Hub along with the mailbox's own private ID. The first copy to arrive does the work. When the second one asks, the Hub answers "I already have that" and the script just quietly marks the email done: no alert, no calendar change.
- The Hub also notices the same order and the same details arriving under a different ID (for example a re-sent or forwarded copy) and treats it the same way, so you are not texted twice.
- The calendar is protected separately, in case two copies run at the very same second. Each event is stamped with the order's key. Before adding or changing an event, a copy looks on the calendar for that key and updates the existing event if there is one; it only creates a new one if none exists. If two copies somehow create one each at the same instant, the next look finds both, keeps the same one in both copies (the lowest event ID), and deletes the extra. If the extra cannot be deleted you get an email saying so; delete the duplicate by hand.
- A cancel finds the event by key too, even if the other mailbox is the one that created or moved it.

## What you will see

Gmail labels on the store emails (each mailbox has its own): **Delivery/Sent to Hub** (taken, including "the Hub already had it"), **Delivery/Needs Attention** (see the email the script sent you), **Delivery/Ignored** (the Hub says it is not about a delivery, e.g. marketing; no alert).

Calendar event: title `Delivery: <item> (<order #>)`, location = delivery address, description `Tenant asked to be present if able; otherwise Brett receives. Driver calls Brett. Order <#>, WO <id>.` plus a small `[delivery-key:...]` line (please leave it; it is how every copy finds the event again). A window makes a timed event; no window makes an all-day event. A reschedule moves the same event; a cancel deletes it.

The normal delivery texts come from the Hub. The script's own emails are failure-only. The subject ends with the mailbox that sent it, so you can tell which copy has the problem:

| Email subject | What it means | What to do |
|---|---|---|
| Delivery watcher is not set up | Token or Setup missing. Nothing is being imported. Repeats hourly. | Step 4 or 5 above. |
| ALERT_EMAIL is not set | The failure address is missing. Daily until fixed. | Add `ALERT_EMAIL` (step 4). |
| Delivery email NOT imported | The Hub did not take an email (down, or `HTTP 401/403` = wrong token). Retried every minute, reminder hourly. | For 401/403 re-copy the token. Otherwise tell Claude. |
| Delivery email needs your attention | The Hub saved it but parked it as Needs Review, or could not text you, or could not match the property. | Open Hub > Deliveries, fix the row. |
| Delivery NOT added to the calendar | The Hub saved the delivery; the calendar write failed. The email has the event details. | Add it by hand, then run **testCalendar** (usually the calendar is not shared with this mailbox yet). |
| Delivery calendar needs a quick look | Two events for one order could not be merged. | Delete the duplicate by hand. |
| Delivery watcher script error | Something unexpected (for example a Google quota). Retries next minute. | If it keeps coming, tell Claude. |

## Turning it off

Run **removeTrigger** in that mailbox. Run **setup** again to turn it back on (it does not move the "only emails after this" date).

## Things that can go wrong (and how the script copes)

- **Same email, two mailboxes, same minute:** covered above (Hub dedupe plus the calendar key check).
- **Store email filed under Promotions:** a second search catches only the unmistakable ones (subjects like "your order", "stops away", "out for delivery"). Other Promotions mail is not seen.
- **Google's 9 KB limit per stored setting:** the script keeps its lists short and trims the oldest entries automatically. Nothing needs cleaning up. Old failure notices that get squeezed out are counted and the next email says how many.
- **Permissions:** the first run needs your approval (step 5). If a future version needs a new permission, this doc and the PR say so, and you must run **setup** and approve again in EVERY mailbox; until you do, that copy stops with an authorization error. Google also emails the mailbox owner about triggers that keep failing. Check the Executions list (left bar) if a copy seems quiet; **status** shows the last run time.
- **Emails sent to you by yourself:** a forward from your own address does not come from the store, so it is ignored. Use a Gmail filter/auto-forward (which keeps the store as the sender), not a manual forward.
- **A copy that is not installed or is switched off** just means the other copies carry on; the mail is only imported where the script runs.
- **The script has not been run live** (Apps Script only runs inside Google); the logic is covered by an offline test with fake Gmail, Calendar and Hub, not by a live run. Run **testCalendar** and **dryRunLatest** once in each mailbox.
- A 1-minute trigger uses a few seconds of Google's daily trigger-time allowance per run, shared with the other scripts in the same mailbox.
- The calendar event wording is fixed in the script; the Hub's `calendar.description` is not used.
