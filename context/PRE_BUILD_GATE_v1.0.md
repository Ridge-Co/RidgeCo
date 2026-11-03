# PRE-BUILD DESIGN GATE v1.0 (Nov 3, 2026)

**Why:** builds keep landing at ~60-70% because the *late requests* are predictable ("let me move it between sections", "reschedule when the source changes", "tell the owner too", "show it where I already look"). An audit of ~345 FEATURE_LOG / notes entries found the same five classes again and again:
1. fix / move / reorder / relink something already built (19 entries)
2. who else is told, in what words, how often, at what cost (15)
3. money carry-through: deposit -> interim -> final -> fee/credit -> edit (13)
4. photo handling (13)
5. "show it where I already look / same mechanism / same wording" (13)

This gate is asked **BEFORE any code, at the design step**. It is the design-time twin of `QUALITY_BAR_v1.0.md` (which scores finished work). It does not replace it: items also covered there are marked `QB`.

**Goal:** a build lands ~85% complete first time, and Brett is asked FEWER questions every month. Both come from one rule: *every item has a default answer learned from his past decisions, so the session asks him only where the default is genuinely unknown.*

## How to run it (mandatory, before writing code)
1. **Tag the feature's shape.** Pick all that apply: `record` `list` `schedule` `message` `money` `doc` `photo` `ui` `endpoint` `job` `external` `role` `write`. (`any` items and the Standing Parameters always apply.)
2. **Walk every item whose shape matches**, plus all Standing Parameters (C1-C17) and any `any` item. For each: write **Y** (in this build), **N** (explicitly out; goes under *Known gaps* in the PR note), or **n/a** (one line why).
3. **Pre-answer from the default column.** Only items where the default does not fit or is unknown become questions for Brett. Ask them in ONE batch (preferably AskUserQuestion). Do not ask what the default already settles.
4. **Put the result in the PR note** (`context/notes/YYYYMMDD-<slug>.md`) under a `## Pre-build gate` heading: shapes, then one line per item that was **N** or that Brett overrode, then `Companion actions included:` (list). Notes dated 20261104 or later without that heading fail `test/pre-build-gate.test.mjs`.
5. **After the build, close the loop.** Under `## Late requests` list anything Brett asked for after the first delivery. Each one becomes either a new gate item (a PR to this file) or a changed default. That is how the gate compounds.

## Standing parameters (always applied; defaults are Brett's standing rules)
Items C1-C17 below. These are almost never questions - they are constraints. Only raise one if the design *conflicts* with it.

## The items
Columns: **ID - check (answer Y / N / n-a)** | shapes | default if Brett is not asked | evidence (FEATURE_LOG rule, FL tag, or note name).


### Group 1 - Companion actions (triggered by the shape of the feature)

- **B1 Edit after create** - Once one of these exists, can Brett fix any field from a Hub screen (not by editing the sheet), including the fields he did not think of today?  
  *shapes:* `record` | *default:* Y - every field editable from the Hub.  
  *evidence:* rule 119 (Edit fired "Edit owners via Sheet for now"); rule 126 (Owner field on Edit Property "never existed at any point"); rule 171; FL-20261027-sc1.
- **B2 Correct after it was sent or signed** - If it has already gone to the customer or been signed, is there a billing-only correction (reason required, original value kept, nothing re-sent) so he never has to regenerate and re-send for signature?  
  *shapes:* `doc money` | *default:* Y for anything already sent or signed: billing-only correction with reason, original kept, nothing re-sent.  
  *evidence:* note milestone-amount-edit-deposit-relink (only edit path was regenerate = re-sends for signature; fix adds Original_Customer_Amount, Amount_Edit_Reason, Amount_Edited_By); rule 142.
- **B3 Move between sections / parents** - Can an item be moved to a different section, work order, property or area while keeping its ID, photos, marks and sent/flag state?  
  *shapes:* `record list` | *default:* Y - keep the ID so photos, marks and sent flags survive.  
  *evidence:* note fi-full-size-photos (moveIssueInDoc keeps same id so roll-up and send marks survive); rule 138; rule 171 (tenant unit reassignment); note property-toggles (merge re-points 26 reference columns).
- **B4 Reorder by hand** - Does this list need a hand-set order (finger drag on a phone), and does that order carry into the report, PDF or customer view?  
  *shapes:* `list` | *default:* Y if shown to a customer: finger-drag on phone; order carries into the PDF.  
  *evidence:* FL Oct 19 FIELD INSPECTION ("arrows were wonky", rebuilt as drag handle); FL-20261001-1530-wc ("subtasks/drag-reorder later"); FL-20261005-1620-irsort (sort dropdown).
- **B5 Undo / restore, and "delete" means hide** - If he taps this by mistake or changes his mind, can it be undone, does undo reverse everything downstream (invoice lines, milestones; texts cannot be unsent), and is "delete" really a restorable Void that keeps the record (different from Cancelled)?  
  *shapes:* `write` | *default:* Y - "delete" means restorable Void; texts cannot be unsent, say so.  
  *evidence:* rule 162 (Void is restorable); FL Oct 19 netting ("Undo reverses all of it"); note insp-invoiced-wo-number (mark-paid undo); CAPTURE_INBOX CAPTURE_INBOX "Undo / view+restore voided bills"; note property-toggles (duplicate is restorable, "nothing deleted"); rule 162 (Cancelled = real job called off; Void = should never have existed).
- **B6 Reopen / extend a finished thing** - Can a closed, expired or finished one be reopened or extended later, and who is told when it is?  
  *shapes:* `schedule record` | *default:* Ask. Default Y for booking blocks and offers.  
  *evidence:* FL-20261014-1800-rop (Brett: reopen tomorrow after the partner booked, tell the partner, extend with presets); note appointment-shift ("Apply anyway" override recorded in Change_Note).
- **B7 Dependents when the source moves** - List everything that hangs off this (calendar event, key pickup, cleaning, tenant notice, vendor bill, invoice). When the source is rescheduled or cancelled, does each dependent move automatically, get proposed to a person, or just get flagged?  
  *shapes:* `schedule` | *default:* List every dependent; default = propose to a person, never silently move.  
  *evidence:* note appointment-shift (adapter registry; inspections proposed, own WOs move, deliveries locked, vendors "not built yet"); FL-20261007-1700-ikp (key pickup re-planned on request/approve/decline/cancel); rule 232 (move patches calendar event, cancel deletes it); rule 211 (booking missing from feed cancels only after 2 misses).
- **B8 Calendar-write rules** - Does it write to a Google Calendar? If so: does it only touch events the Hub created, keep a stable ID so a change replaces rather than duplicates, and avoid asking Brett to share anything with edit rights?  
  *shapes:* `schedule` | *default:* Only touch events the Hub created; stable ID; delegation, never edit-share.  
  *evidence:* CM "Never ask Brett to share a calendar with edit rights; use delegation"; note appointment-shift (same UID, SEQUENCE only goes up); rule 211 (only events with ridgecoStr); FL-20261007-1700-ikp (.ics UID insp-<ID>@ridgeco).
- **B9 Who hears about it (the notify matrix)** - For each person (tenant, owner, vendor, partner customer, cleaner, Brett) do they hear about this: yes, no, or optional? Can each be switched off separately per property or customer?  
  *shapes:* `message` | *default:* Default: Brett only. Tenants/owners/vendors NOT notified unless he says; each separately switchable per property.  
  *evidence:* note property-toggles (one SMS_Enabled covered tenants AND owners; Brett needed them separate); rule 168; B-20261023-1200-sv (vendor should get the same SMS the tenant gets on a shift); note appointment-shift (Notify_Tenants default FALSE).
- **B10 Quiet / after-the-fact mode** - Can Brett record this after the job already happened, or enter it for a job arranged by phone, without texting or emailing anyone?  
  *shapes:* `message record` | *default:* Y - a quiet "record only" path for anything that can text someone.  
  *evidence:* rule 159 (Towson Appliance: text "actively confusing"); FL Oct 19 estimate "Do NOT text the vendor" (skip_vendor_sms); FL-20260930-1030-af; rule 231 Oct 26 "deposit after the fact".
- **B11 Message words, length and cost** - Does each text name the specific job/item, fit in ONE or at most two SMS pieces in plain ASCII, and use a short link instead of a long one?  
  *shapes:* `message` | *default:* One SMS piece, plain ASCII, names the specific job, short link.  
  *evidence:* rule 163 (two same-trade jobs at one address read identically); FL-20261023-d16 rule 6 (templates must stay 2 pieces, GSM-7; a test checks all); rule 232 addendum 2 (terse text + stateless short link).
- **B12 Message timing** - Is each message urgent (goes now) or batchable and subject to quiet hours (hold 7pm-9am ET; cleaners 8am-9pm)? What does "urgent" mean for this one?  
  *shapes:* `message` | *default:* Urgent (same-day schedule) goes now; everything else obeys quiet hours.  
  *evidence:* rule 166; B-20261023-0302-mb (urgency by content: same-day schedule is urgent); rule 225 (STR_Outbox parks texts outside window).
- **B13 Will it actually send? (hold visibility)** - If a switch, opt-out, quiet hours or test mode will hold the message, does the screen say so BEFORE he taps Send, and show the real outcome after?  
  *shapes:* `message ui` | *default:* Y - screen says before Send if it will be held.  
  *evidence:* note property-toggles item 5 (proposal screen promised an owner text smsGateDecision would block; added GET /sms/gate-preview); FL-20261014-1800-rop (per-recipient "NOT SENT").
- **B14 Edit before send** - Is the exact text/email shown and editable before it goes, with a preview that writes nothing?  
  *shapes:* `message` | *default:* Y - exact text shown and editable before it goes.  
  *evidence:* rule 225 (edit-before-send texts); note appointment-shift (one editable partner email); note fi-urgent (preview-first).
- **B15 History and reason** - For each change, do we keep who, when, old value, new value and a reason, and can Brett see it in the Hub?  
  *shapes:* `record` | *default:* Y for money, contact info, schedule, status: who/when/old/new/reason.  
  *evidence:* rule 180 (Vendor_Contact_History: "saves the old contact info for reference"); note milestone-amount-edit-deposit-relink (audit columns + Ops_Telemetry); FL-20261014-1800-rop (Reopen_Log); note appointment-shift (override recorded in Change_Note).
- **B16 Bulk** - Will he ever do this to many at once? If so: select several, "apply to all", or paste a block, with a preview and a leave-out checklist per row?  
  *shapes:* `list` | *default:* Y if the list can reach 5+ rows: preview and per-row leave-out.  
  *evidence:* rules 98, 139, 104, 122; note property-toggles ("apply to all of this customer's properties"); rule 225 (bulk swap, cap 40); FL-20261001-1530-wc (paste a block).
- **B17 Duplicates** - What happens if the same thing is entered twice (double-tap, same address spelled two ways, same photo uploaded twice)? Is it caught, warned about, and mergeable?  
  *shapes:* `record` | *default:* Y - warn on a likely duplicate, offer merge, block double-tap.  
  *evidence:* rule 162 (WO-1192 double-tap made two rows with the same ID); rule 129 (St/Saint/Street); note property-toggles (411 W 23rd vs 411 West 23rd); note fi-duplicate-check-print-badge; FL-20261013-1130-qu (queue dedupe); rule 232 (dedupe by Message-ID and order number).
- **B18 Warn, don't block** - Is each check a warning Brett can ignore or a hard gate? Default is warning unless it protects money, privacy or sends something wrong to a customer.  
  *shapes:* `any` | *default:* Warning, not a block - unless it protects money, privacy or a wrong customer send.  
  *evidence:* note fi-areas-no-photo-marker ("i may not add photos"); note fi-duplicate-check ("Both are warnings only; nothing blocks publishing"); rule 156 (Maryland deposit cap warning "his explicit call"); FL Oct 29 FI review (blocked on "No owner chosen" and unfixable dictation).
- **B19 Preview the real output first** - Before anything customer-facing is generated or sent (PDF, report, invoice, email), can he preview exactly what the customer will see?  
  *shapes:* `doc message` | *default:* Y - preview exactly what the customer sees.  
  *evidence:* FL Oct 29 FI review ("preview the PDF before anything generates"); FL-20261013-1500-ao ("WHAT YOUR CUSTOMER WILL SEE" preview); rule 117 (test-send to Brett's own inbox).
- **B20 Voice dictation** - Do the free-text boxes accept voice (and what turns dictation into structured items)?  
  *shapes:* `ui` | *default:* Y on any free-text box he fills on his phone.  
  *evidence:* rule 102 (voice-to-text on every text block); FL Oct 29 FI review (dictation left over blocked publish).
- **B21 Photos: add, original, permanence** - How many photos per item, can he add or attach more later from his phone gallery in bulk, are full-size originals kept, and do the links keep working indefinitely?  
  *shapes:* `photo` | *default:* Keep full-size originals, add more later, links permanent.  
  *evidence:* note fi-full-size-photos ("they need as much detail as possible", links "indefinitely"; phone shrank to 1600px before upload); note fi-match-originals ("Re-uploading ... is a major setback"); note fi-attach-drive-originals.
- **B22 Photos: what's missing or doubled** - Can he see at a glance which items have no photo and which photos are duplicates (warning only)?  
  *shapes:* `photo list` | *default:* Y - warn only.  
  *evidence:* note fi-areas-no-photo-marker; note fi-duplicate-check-print-badge.
- **B23 Photos: print and PDF** - Does it print/save as PDF correctly: every photo loaded, thumbnails clickable to full size, no Hub failure badge on the printout?  
  *shapes:* `photo doc` | *default:* Y - all photos load, thumbnails open full size, no Hub badge on print.  
  *evidence:* note fi-full-size-photos ("Photo could not be loaded" in PDFs of Gilmor); note fi-duplicate-check-print-badge (N problems badge never prints).
- **B24 Photos: who may see which file** - Which file types are visible to which role (owners see receipts but never vendor bills; receipts never Drive-shared; tenants never get cost docs)?  
  *shapes:* `photo role` | *default:* Owners see receipts, never vendor bills; tenants never see cost docs.  
  *evidence:* rule 13 (receipt folder privacy); rules 176-178 ("visible to me and the respective vendor but not the owner"); FL-20261014-0640-ats (ATTACHMENT_COST_DOC_TYPES).
- **B25 Role matrix** - For each role (admin, owner, tenant, vendor, partner link, anonymous link) what can they see and do here, and what must they NOT see? Does it take identity from the signed session, never from the page?  
  *shapes:* `endpoint` | *default:* Identity from the signed session only; list each role's can-see / cannot-see.  
  *evidence:* FL-20261014-1300-sid (role endpoints trusted the id the page sent); FL-20261014-0640-ats (any signed-in token could list any job's photos); note appointment-shift (public tokened page self-verifies); note insp-invoiced-wo-number (never put booking contact/notes on the public report).
- **B26 Spanish** `QB` - Is anything vendor-facing (text, email, error message, checklist gate, AI output) also in Spanish, and does Brett get the English version of what a Spanish vendor wrote or received?  
  *shapes:* `message ui` | *default:* Y for anything vendor-facing; Brett sees the English.  
  *evidence:* rule 179 (Spanish vendors get the email in Spanish); FL-20261013-1500-ao (Message Queue "English:" box); note invoice-work-done-nov2 (checklist gate error "shown in their language (en/es)"). [QB-overlap: Hub Screen bar #4]
- **B27 Where else will he look for it?** - Which other pages, lists, reports, PDFs, invoices, dashboard tiles or top-bar chips should show this, with the same filters/search/sort as the page he already knows?  
  *shapes:* `any` | *default:* Ask - name every other page, list, PDF, invoice, tile that should show it; reuse the existing filter/sort.  
  *evidence:* rule 154 ("full filter/search parity with Work Orders"); FL-20261005-1545-st ("exactly the same mechanism"); CM rc-related rule; note fi-areas-no-photo-marker.
- **B28 Long lists: search, filter, sort, collapse** - Will this list pass one screen? If so, search, filter, sort, and a collapsed group for done/paid/cancelled items?  
  *shapes:* `list` | *default:* Y - search, filter, sort, collapsed "Closed out".  
  *evidence:* rule 67; rule 154; rule 208 (collapsed "Closed out (N)"); FL Oct 19 vendor Paid tab; rule 227.
- **B29 Customer-facing documents say what was done and carry a reference** - If it produces an invoice, report or email for a customer, does it list the work completed in plain past tense and carry the WO/reference number? Is private text kept off it (internal notes, access codes)?  
  *shapes:* `doc money` | *default:* Y - plain past-tense work done plus the WO/reference number; no private notes or codes.  
  *evidence:* rule 158 (Sep 14); note invoice-labor-detail-1767-oct23; note invoice-work-done-nov2 (decisions 1-7; access-code-looking text never on a customer line); note insp-invoiced-wo-number ("so there is always a reference").
- **B30 Did they get it and use it?** - Do we track sent / delivered / first-used for anything sent to a person (welcome text, PIN, link), and flag when it was not used?  
  *shapes:* `message` | *default:* Y for anything sent to a person: sent / delivered / first used, flag when unused.  
  *evidence:* FL-20261022-1800-pat (welcome sent, PIN sent, first login, amber 14d / red 30d); rule 216 (Welcome_Sent left blank so "not yet welcomed" list shows them).
- **B31 Settings, not constants** - Is any number likely to change (pay per job, hours before a reminder, thresholds, rates) a visible setting rather than hard-coded?  
  *shapes:* `any` | *default:* Any number that may change is a Config setting, not a constant.  
  *evidence:* note insp-invoiced-wo-number ("start at $40 per inspection ... keep it a setting"); note appointment-shift (INSP_SHIFT_REMIND_HOURS); FL Oct 19 (instant_fee_rate/min/max in Config).
- **B32 Empty, loading and error states [QB-overlap: Hub Screen bar #5]** `QB` - Does each list show Loading, a real empty message, and a retry-able error, and never treat a failed fetch as "no items"?  
  *shapes:* `ui` | *default:* Y - loading, empty and retry-able error; a failed fetch is never "no items".  
  *evidence:* FL-20261009-1200-sfx rules 4-5 (never coerce non-array to []); QB Hub Screen #5.
- **B33 Phone first [QB-overlap: Hub Screen bar #3, #6]** `QB` - Is it usable one-handed at 390px: no sideways scroll, 44px taps, 16px inputs, no label-wrapped file input?  
  *shapes:* `ui` | *default:* Y - 390px, 44px taps, 16px inputs, no sideways scroll.  
  *evidence:* note mobile-tap-targets-oct29; FL-20261009-1200-sfx (16px or Android zooms); UI_QA_CHECKLIST; FL rule 120.

### Group 2 - Brett's standing parameters (always applied)

- **C1 No texts for Hub failures (R-1)** - If this fails or can't read something, does it log/report and retry quietly rather than texting Brett, except when it truly cannot self-heal (and then only after a grace period)?  
  *shapes:* `always` | *default:* Report and retry quietly; text Brett only if it truly cannot self-heal, after a grace period.  
  *evidence:* note overnight-heartbeat-nov3 rule 1 ("R-1 stands"); FL Oct 20 CABIN CLEANING GUARD ("contradicts his rule that Hub/scheduling failures are not texted unless they truly cannot self-heal", 45-min grace); FL Oct 21 feed 504; note quota-calm-oct29.
- **C2 No cron anywhere** - If anything must run on a schedule, is it a SCHED_JOBS entry plus a row in the Apps Script JOBS table, and never a Cloudflare cron, wrangler crons entry or GitHub schedule?  
  *shapes:* `always` | *default:* SCHED_JOBS entry + Apps Script JOBS row. Never a cron.  
  *evidence:* CM "NO CRON ANYWHERE (Brett, Oct 12)"; test/no-cron-anywhere (count bumped in notes heartbeat and appointment-shift); rule 166 history (cron cap).
- **C3 Nothing fails silently** - For every step that can fail (lookup empty, write didn't land, send refused), where does the failure show up for Brett (telemetry row, banner, Needs Attention), and can the PR say so in one "Silent-failure check" line?  
  *shapes:* `always` | *default:* Name where every failure shows up; PR gets a "Silent-failure check" line.  
  *evidence:* CM "Nothing ever fails silently (Brett, Oct 1)" rules 1-7; every note carries a Silent-failure check line.
- **C4 Verify the write, then the side effect** - After any write that matters, do we re-read it, and does no text/email/QuickBooks call fire if the write failed?  
  *shapes:* `always` | *default:* Re-read after the write; no side effect if the write failed.  
  *evidence:* CM rule 3; note appointment-shift ("nothing downstream goes out after a failed write"); FL rule 19 (success:true with nothing changed).
- **C5 Pick fail-open or fail-closed on purpose** - If the check itself cannot run (Sheets busy, feed down), should it block, allow, or say UNKNOWN? Which is safe for THIS feature?  
  *shapes:* `always` | *default:* Choose block / allow / UNKNOWN on purpose and write it down.  
  *evidence:* fail OPEN: rule 23 (dup guard), note invoice-work-done-nov2 (gate never blocks billing on a Sheets hiccup); fail CLOSED: FL-20261007-1930-strg (guard), rule 212 (invalid redirect never texts real cleaner); UNKNOWN: note overnight-heartbeat-nov3 rule 2.
- **C6 Owners never see what they spend with Brett** - Does any owner-facing screen, text, email or report show monthly/YTD spend, cost per WO or totals? (Estimate and approval screens always show amounts.)  
  *shapes:* `always` | *default:* No spend, cost-per-WO or totals on any owner-facing surface.  
  *evidence:* FL-20261013-1130-qu QUEUE_STANDING_RULES (injected into EVERY build brief).
- **C7 Private data stays private** - Are door/key/lockbox codes, vendor cost, and internal notes kept off vendor-facing, owner-facing and customer-line text? Is any phone/email/name being committed to the public repo?  
  *shapes:* `always` | *default:* No codes, vendor cost or internal notes on vendor/owner/customer text; no personal data in the public repo.  
  *evidence:* note property-toggles (codes hidden until tapped, never vendor-facing); note invoice-work-done-nov2 #3; rule 211 item 6 (cleaner phones entered on the board, never committed); rule 158 (private Notes vs customer Invoice_Description).
- **C8 Branch first, PR into main, Brett merges** - Is the plan: feature branch -> staging twin PR (test-only) -> main PR that Brett merges, BUILD_VERSION untouched, one context/notes file, nothing pushed to main?  
  *shapes:* `always` | *default:* Branch from main, staging twin PR, main PR, Brett merges, BUILD_VERSION untouched, one notes file.  
  *evidence:* CM PAT-033; BRANCH_POLICY_v1.0; note stop-shared-line-collisions (BUILD_VERSION frozen, guard fails PRs that edit it).
- **C9 Is this a GATED class?** - Does it touch money/QuickBooks, PII, auth/roles, sheet schema, a real customer text, or widen the production write allow-list? If so it waits for Brett's explicit go and is never auto-merged.  
  *shapes:* `always` | *default:* Money, PII, auth, schema, real customer text or write allow-list = GATED: waits for Brett's explicit go.  
  *evidence:* AG "GATED (Rung 3)"; note fi-attach-drive-originals ("adds a path to HUB_PROD_WRITE_PATHS, so Brett merges"); note broker-failure-update-recut ("Auth-adjacent: Brett's merge call").
- **C10 Reuse the one existing pipeline** - Does it use the existing sender, gate, ID resolver, invoice path and status list instead of building a second one?  
  *shapes:* `always` | *default:* Use the existing sender, gate, ID resolver, invoice path, status list.  
  *evidence:* FL-20261023-d16 rule 1 ("Never add a second path to Twilio"); note appointment-shift ("the shift block never builds its own SMS sender"); FL-20261014-0900-inv ("ONE way to invoice"); FL-20261014-1100-sts (status SSOT); note overnight/read-meter ("Do not add a second Twilio balance call").
- **C11 Safe starting position, safe blank** - Does a brand-new switch start OFF (or in the harmless position), and does a blank cell on existing rows mean the harmless thing so deploying changes nothing by itself?  
  *shapes:* `always` | *default:* New switch starts OFF; blank on old rows means harmless; deploy changes nothing by itself.  
  *evidence:* rule 211 (all four STR switches default OFF); rule 212 (STR_SMS_TEST_MODE blank = TRUE); note property-toggles (blank = ON so nothing flips; 512-combination back-compat test); rule 156 (old signatures backward-compatible).
- **C12 Existing data** - What happens to rows that already exist (backfill, grandfather, leave alone), and does the backfill refuse to overwrite anything?  
  *shapes:* `always` | *default:* Backfill never overwrites; say what happens to existing rows.  
  *evidence:* FL-20261022-1800-pat rule 5 (backfill never overwrites), rule 4 (history unknowable, labelled unconfirmed); rule 156.
- **C13 Smallest manual step list for Brett** - After merge, what exactly must Brett do (paste a JOBS row, set a Cloudflare secret, flip a Config key, review on his S23)? Is that list written in plain words and as short as possible?  
  *shapes:* `always` | *default:* List Brett's manual steps in plain words, as few as possible.  
  *evidence:* note overnight-heartbeat-nov3 "Needs a human"; note appointment-shift "After this merges and deploys: (1)(2)(3)"; note mobile-tap-targets "Brett to check on the S23 Ultra before merge".
- **C14 Don't ask Brett what a tool can check** - Is there anything in the plan where Brett would be asked to look at a dashboard, share a calendar, or paste a token that the session could check or avoid itself?  
  *shapes:* `always` | *default:* Never ask Brett to check or paste what the session can check itself.  
  *evidence:* CM Sep 23 ("you can check it yourself"); CM calendar delegation rule; CM PAT fallback only "when Brett explicitly hands over a token ... rotate it afterward".
- **C15 Cost: SMS and AI** - What does one run cost in texts and AI calls, and is there a cap (one nudge per person per WO per 72h, identical text refused for 10 min, deterministic wording instead of an LLM where possible)?  
  *shapes:* `always` | *default:* State SMS + AI cost per run and the cap; prefer deterministic wording to an LLM.  
  *evidence:* FL-20261023-d16 rules 1-7; note invoice-work-done-nov2 ("no AI rewording; deterministic verb map"); FL-20261009-1200-sfx #89 (prompt-cache plumbing, ~$0 until a large prefix exists).
- **C16 Live-data repairs are their own gated step** - If the build also requires fixing existing production data, is it a separate dry-run -> read every step -> real run -> read-only verify, run only after his go?  
  *shapes:* `always` | *default:* Data repairs are a separate gated step: dry-run, read, real run, read-only verify, after his go.  
  *evidence:* CURRENT.md "PREMIER REPAIR ENDPOINT" (dry run, then real run, then hub_prod_get); FL-20261021-1500-fld ("Data repairs done on prod (re-read first, verified after)"); note insp-invoiced-wo-number ("WO 43945-1 is not completed or billed without his explicit word").
- **C17 Header-name columns and ensureColumns [QB-overlap: Worker #2, #3]** `QB` - Does it add or rename sheet columns? If so are they resolved by header name and created additively with ensureColumns (never ensureTab) before first write?  
  *shapes:* `always` | *default:* Header-name columns, ensureColumns before first write (QB).  
  *evidence:* FL "REGRESSION RULES" 6 and 37; QB Worker bar #2-#3; note property-toggles (columns created on first change).

### Group 3 - Integration traps

- **D1 Sheets read quota (60 reads/min, shared by everyone)** - How many Sheets reads does ONE use of this cost (including page-load bursts, loops over rows, verification re-reads, photo views)? Can it be one batchGet, cached or coalesced?  
  *shapes:* `endpoint` | *default:* Count reads per use; aim for one batchGet or cache.  
  *evidence:* FL Oct 19 SHEETS READ QUOTA BURST (~12N reads for N cards); note fi-full-size-photos (278 reads for a 139-photo report; fixed to 2); FL Oct 20 guard (3 tab reads -> 1); note second-sheets-identity (doubles budget; writes stay on main account).
- **D2 Verification re-read can hit the quota** - If the write landed but the confirming re-read is blocked by quota, does it say "saved, not confirmed" and retry later, rather than "FAILED" or a second write?  
  *shapes:* `endpoint` | *default:* If the confirm re-read is quota-blocked say "saved, not confirmed" and retry; never a second write.  
  *evidence:* note str-verify-soft-oct29 (Brett saw "It did NOT go through" for a swap that had); note quota-calm-oct29 (read quota = calm P2, write quota stays loud).
- **D3 About 50 outbound calls per request** - Can this touch more than ~40 rows or files in one request? If so, does it do a slice, report "partial, remaining", and resume without duplicating?  
  *shapes:* `job list` | *default:* Slice under ~40 rows/files per request; return partial + remaining.  
  *evidence:* rule 216 rule 6 (Cloudflare ~50 subrequests; apply returns {partial, remaining}); rule 225 (handlers under ~48); note fi-attach-drive-originals (12 pairs per call).
- **D4 Worker memory and file size** - Does it move files or photos through the Worker? What is the maximum size, and what is said when a file is too big?  
  *shapes:* `photo` | *default:* State the max file size and what is said when too big.  
  *evidence:* note fi-full-size-photos (30 MB cap because 2 copies in memory = 60 of 128 MB; typed 413/415 refusals); note fi-attach-drive-originals (server-side Drive copy, no bytes through Worker).
- **D5 Twilio rules** - Does every text go through the one gated sender (opt-out, quiet hours, test mode, +1 only, short, first-text STOP line), and what happens on a permanent Twilio error (final, never retried)?  
  *shapes:* `message` | *default:* One gated sender only; permanent Twilio error is final, never retried.  
  *evidence:* FL-20261023-d16 rules 1-3; rule 232 addendum 2 (withTenantStopNote); rule 212 (redirectTo fails closed).
- **D6 A failed status save must not cause a resend** - Is the "this was sent" mark written so that a failed save can never cause the same text to go again, and could two REAL messages have identical wording within 10 minutes (delivery moved Y/X/Y) so they need allowRepeat plus their own once-per-event key?  
  *shapes:* `message` | *default:* Mark sent so a failed status save can never cause a resend.  
  *evidence:* FL-20261023-d16 rule 2 (row born `sending`, only `pending` released); rule 228 (lost text: sent text left "pending"); FL-20261022-1800-pat rule 1 (recorded "sent" only when Twilio accepted); rule 232 addendum (D-16 10-minute guard would have swallowed a real second tenant text).
- **D7 QuickBooks: no double post, and paid bills can't be deleted** `QB` - If this creates an invoice/bill, is the QB id saved before the next step, does a retry reuse it, and what is the path when QuickBooks refuses to delete a paid bill (relink, not delete)?  
  *shapes:* `money` | *default:* Save the QB id before the next step; retry reuses it; paid bill = relink, not delete.  
  *evidence:* rule 124 (persist invoice id before attempting bill); note milestone-amount-edit-deposit-relink (qbDeleteBillSafe refuses a paid bill, so "Link existing bill"); QB Money #2 [QB-overlap].
- **D8 QuickBooks deposit / fee / credit interplay** - Does a deposit, instant-pay fee, fee credit or earlier milestone already exist on this job, and does the new bill net it automatically? What if two sends happen at once?  
  *shapes:* `money` | *default:* Net any existing deposit, fee or credit automatically; guard simultaneous sends.  
  *evidence:* FL Oct 19 PROPOSAL NETTING (invoice 1764 billed the FULL job after a paid deposit); rule 231 Oct 26 known gaps (no lock for simultaneous sends, unused deposit not carried forward, one deposit per WO); FL Oct 19 fee credit "recorded USED only after the QuickBooks bill id comes back".
- **D9 Staging can't prove QuickBooks, SMS, Gmail, calendars** - Which parts of this are stubbed on staging, and who runs the first live use (with a preview step) and how is it verified read-only afterwards?  
  *shapes:* `any` | *default:* List what staging stubs (QB, SMS, Gmail, calendar) and who runs the first live use with a preview.  
  *evidence:* note milestone-amount-edit-deposit-relink ("money routes cannot run on staging ... first live use is the real test"); note fi-urgent ("Real photo attachment is untestable on staging"); FL-20261007-1930-strg (real iCal fetch not verified).
- **D10 Scheduled job = two places** - Does it need a timer? Then it needs a Hub SCHED_JOBS entry AND a row in the Apps Script JOBS table that Brett must paste. What happens in the meantime?  
  *shapes:* `job` | *default:* SCHED_JOBS entry AND a pasted Apps Script JOBS row; say what happens before the paste.  
  *evidence:* CM NO CRON; note appointment-shift (insp_shift_reminders); note overnight-heartbeat-nov3 ("Hub-side job still has its default slot"); FL-20261023-d16 (one JOBS row).
- **D11 GitHub / secret access** - Does it read or write a private repo or need a Cloudflare secret (e.g. GITHUB_READ_TOKEN)? Only Brett can set Cloudflare secrets; no pasted credentials; read-only fine-grained token where possible.  
  *shapes:* `external` | *default:* Only Brett sets Cloudflare secrets; read-only fine-grained token; no pasted credentials.  
  *evidence:* note overnight-heartbeat-nov3 ("a session cannot set Cloudflare secrets"; Home runner UNKNOWN until set); FL-20261013-1130-qu (GitHub 403 for the Worker's shared address); CM (GH Broker, no PAT).
- **D12 Outside system with no API** - Is any step in another company's system (AppFolio, store portals)? Then what is the "needs manual entry" flag and who sees it?  
  *shapes:* `external` | *default:* Use a "needs manual entry" flag and say who sees it.  
  *evidence:* note insp-invoiced-wo-number ("AppFolio (no API) ... later, accept + submit automated with a needs-manual-entry flag").
- **D13 Public or tokened link pages** - Does it add a public/tokened URL? What does it reveal, does it verify the token itself, and what shows after it expires or is revoked?  
  *shapes:* `endpoint` | *default:* Say what the link reveals, verify the token itself, define the expired state.  
  *evidence:* note appointment-shift (inspect-change.html in PUBLIC_PATHS, self-verifying); FL-20261013-1500-ao (no vendor_cost in customer payload); CM security note ("scope new read endpoints to the caller").
- **D14 Time zones and the clock** - Are dates compared as Eastern calendar days (DST included), and do tests for anything that sends pin the clock to mid-day?  
  *shapes:* `schedule` | *default:* Eastern calendar days incl. DST; tests that send pin the clock to mid-day.  
  *evidence:* FL-20261014-1210-tst (tests failed at 8:13am ET because quiet hours held the text; _midday-clock.mjs); rule 166 (nyOffsetMinutes); note appointment-shift (DST fall-back Nov 1 2026).

## Dogfood: the gate run on the overnight heartbeat (PR #507), after the fact
Items that would have been raised before coding, and what happened:
- **B15 History:** only the latest report is kept (`heartbeat_last`). No history to see a trend. -> Known gap, add a daily row to a tab if Brett wants trends.
- **B27 Where else will he look:** the report is an email and an endpoint only; it is not on the Needs Attention page or the Decision Inbox. -> Known gap.
- **B31 Settings, not constants:** the 30 h / 8 h home-runner limits and the 06:45 time are constants in code. -> Known gap (time is editable in the JOBS table).
- **B9 / C1 / C2 / C3 / C10 / C11 / C13 / D10 / D11:** satisfied (email only, no text, no cron, loud failures, reuses the existing sender and ledger, quiet opt-in OFF by default, manual steps listed, JOBS row, secret named).
That is three real gaps in a build that had passed every test, which is the point of asking at design time.

## Maintaining this file
- Add an item only with real evidence (a rule, FL tag or note). No aspirational items.
- A default changes only when Brett says so; record the date and the PR in the evidence.
- Keep each item to one question a non-coder can answer Y / N / n-a.
