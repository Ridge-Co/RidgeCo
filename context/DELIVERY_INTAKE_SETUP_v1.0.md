# Delivery Intake - setup (v1.0, Oct 23 2026)

What it is: a small Google Apps Script that lives in the mailbox that receives store emails (info@bmoremanagement.com most likely; brett@ too if store mail ever lands there). Every minute it finds new Home Depot / Lowe's / Ace / Walmart delivery emails, sends each one to the Hub, and puts the delivery on the Google Calendar. The Hub creates or updates the Delivery, links the property and work order, and texts Brett. The script emails Brett only when something goes wrong.

- Code: `apps-script/delivery-intake/DeliveryIntake.gs` + `appsscript.json`
- Test: `node apps-script/delivery-intake/test/delivery-intake.test.mjs`
- Hub side: `POST /intake/delivery-email` (separate PR)

Nothing runs until you do the steps below. Merging the PR only stores the files in GitHub.

## Before you order: do this once (about 5 minutes, Chrome on the Chromebook)

Do it BEFORE you place the order. Emails that arrived before you run Setup are never imported.

1. Sign in to Chrome as the mailbox that gets the store emails (info@). Go to **script.google.com**. Click **New project** (top left). Click **Untitled project** at the top and rename it **Delivery Intake**.
2. In the left list click **Code.gs**. Press **Ctrl+A**, press **Delete**, then paste the whole contents of `DeliveryIntake.gs`. Press **Ctrl+S**.
3. In the left bar click the gear **Project Settings**. Tick **Show "appsscript.json" manifest file in editor**. Click **Editor** (the `< >` icon) in the left bar, click **appsscript.json**, **Ctrl+A**, **Delete**, paste the contents of `appsscript.json`, **Ctrl+S**.
4. Add the token (no change in Cloudflare needed, it is the same token the Buildium project already uses):
   - In a second tab, signed in as brett@, open the existing **Buildium Intake** project, pick **showToken** in the function dropdown (top bar), click **Run**. In **Execution log** at the bottom, select the long `INTAKE_TOKEN` value and press **Ctrl+C**.
   - Back in Delivery Intake: gear **Project Settings** -> scroll to **Script Properties** -> **Edit script properties** -> **Add script property**. Property = `INTAKE_TOKEN`, Value = paste -> **Save script properties**.
5. Click **Editor**, pick **setup** in the function dropdown, click **Run**. Google asks for permission: **Review permissions** -> choose the mailbox -> **Advanced** -> **Go to Delivery Intake (unsafe)** -> **Allow**. ("Unsafe" only means Google has not reviewed your own private script.) The Execution log ends with `Setup done`.

That is all that is required.

## Optional checks (recommended)

- **testCalendar** -> Run: creates then deletes a throwaway event. Log says `CALENDAR OK` or tells you what is wrong.
- **dryRunLatest** -> Run: shows what the Hub would do with the newest store email in the last 60 days. Creates and sends nothing.
- **status** -> Run: one-glance health (trigger count must be 1, token present, last run, counts).

## Putting events on brett@'s calendar instead of info@'s

By default events go on the calendar of the mailbox the script runs in. To use brett@'s calendar: in brett@'s Google Calendar, hover the calendar under **My calendars** -> three dots -> **Settings and sharing** -> **Share with specific people or groups** -> **Add people and groups** -> info@bmoremanagement.com -> permission **Make changes to events** -> **Send**. Then in Delivery Intake: **Project Settings** -> **Script Properties** -> add `CALENDAR_ID` = `brett@bmoremanagement.com`, and run **testCalendar**.

If the script is installed in both mailboxes, point both at the same calendar. The Hub recognises the same email arriving twice (by its Message-ID), so only the first mailbox adds the event.

## What you will see

Gmail labels on the store emails: **Delivery/Sent to Hub** (taken), **Delivery/Needs Attention** (see the email the script sent you), **Delivery/Ignored** (the Hub says it is not about a delivery, e.g. marketing; no alert).

Calendar event: title `Delivery: <item> (<order #>)`, location = delivery address, description `Tenant asked to be present if able; otherwise Brett receives. Driver calls Brett. Order <#>, WO <id>.` A window makes a timed event; no window makes an all-day event. A reschedule moves the same event; a cancel deletes it.

The normal delivery texts (order found, date/window set or changed, en route / stops away, delivered, cancelled, unreadable) come from the Hub. The script's own emails are failure-only:

| Email subject | What it means | What to do |
|---|---|---|
| Delivery watcher is not set up | Token or Setup missing. Nothing is being imported. Repeats hourly. | Step 4 or step 5 above. |
| Delivery email NOT imported | The Hub did not take an email (down, or `HTTP 401/403` = wrong token). Retried every minute, reminder hourly. | For 401/403 re-copy the token (step 4). Otherwise tell Claude. |
| Delivery email needs your attention | The Hub saved it but parked it as Needs Review, or could not text you, or could not match the property. | Open Hub > Deliveries, fix the row. |
| Delivery NOT added to the calendar | The Hub saved the delivery; the calendar write failed. The email has the event details. | Add it by hand, then run **testCalendar**. |
| Delivery watcher script error | Something unexpected (for example a Google quota). Retries next minute. | If it keeps coming, tell Claude. |

## Turning it off

Run **removeTrigger**. Run **setup** again to turn it back on (it does not move the "only emails after this" date).

## Settings (Script Properties, all optional)

`CALENDAR_ID` (default `primary`), `SENDER_DOMAINS` (comma list; default `homedepot.com,lowes.com,acehardware.com,walmart.com`; keep it in step with the Hub's `Delivery_Sender_Domains` Config key, or the Hub answers 400 for a domain it does not accept and you get a "NOT imported" email).

## Known limits

- This script has not been run live (Apps Script only runs inside Google); the logic is covered by an offline test with fake Gmail, Calendar and Hub, not by a live run. Run **dryRunLatest** and **testCalendar** once.
- Gmail may file a real order email under Promotions; a second search catches only the unmistakable ones (subject like "your order", "stops away", "out for delivery"). Anything else in Promotions is not seen.
- Only emails that arrive after the first Setup are imported. A forwarded email comes from your own address, not the store, so it is ignored.
- A 1-minute trigger uses a few seconds of Google's daily trigger-time allowance per run, shared with the other scripts in the same mailbox.
- The calendar event wording is fixed in the script; the Hub's `calendar.description` is not used.
