# Appliance & Materials Delivery System — Build Brief v1.0

**Venture:** Ridge Co / Maintenance Hub · **Date:** Aug 11, 2026 · **Origin:** Brett's Aug-11 brain-dump (two same-day deliveries to two apartments; single-contact bottleneck).
**Read `brett-context` + `brett-flow` first (PAT-024). Cross-referenced against BACKLOG v1.34 + FEATURE_LOG v1.13.**

### Decisions locked (Brett, Aug 11)
- **Dedicated deliveries phone number** (not the shared tenant line). Reasoning: isolates the routing logic (every call/text to it is delivery-related by definition — no "what kind of call is this" branch on the critical path), keeps a clean voice greeting/webhook, and separates delivery/vendor traffic from transactional tenant-notification reputation. Marginal cost ~$1–2/mo; the one-time A2P 10DLC + voice-trust registration is largely **shared** by adding the number under the existing Ridge Co brand.
- **Email watcher inbox = `info@bmoremanagement.com`** for now (where Home Depot order/delivery mail lands today). A Ridge Co address is coming; leave a config seam so the watched inbox can be swapped without code changes.
- **Calendar layer is IN** (folds B-204): a calendar **entry** on Brett's own calendar (no invite), **invites** to the tenant + the backup (Brett or a delegate), and the **owner optional / awareness**. Events auto-update when the store narrows the window.
- **En-route "stops away" touchpoint is IN** — see §8.5.

### Still open
- Tenant delivery texts auto-send vs draft-first to start (§9 #2). · Dimension tolerance + which appliance types are critical (§9 #4).

---

## 1. The problem, stated plainly

When an appliance is ordered from Home Depot (or any store), the order takes **one** contact — almost always Brett. Consequences:

1. **The tenant is blind.** Confirmations, scheduled-date and narrowed-window notices all go to Brett. The tenant only hears anything if Brett manually looks up the order, figures out which property it's for, and relays it by text. (This is literally what happened Aug 11: two 5am confirmations, two different properties, both delivering the same day — Brett had to decode the order numbers and hand-text each tenant.)
2. **The delivery-day call goes to the wrong person.** The driver calls when they're en route / outside — always from an unknown number, always to Brett, who's usually mid-task and can't answer → **missed deliveries** (this has happened multiple times).
3. **You can't just hand the store a number per delivery.** With one shared number the store dials, you don't inherently know whether "the driver at the door" is for Apartment A or Apartment B.

**Brett's core insight (correct):** give every store the **one Ridge Co line**, and put a routing brain behind it that knows which delivery is active, front-ends the driver with an AI agent that already has all the context, and connects them to the right person (tenant first, then Brett/assignee, then backup) — invisibly to the store. Plus an **email watcher** that front-loads every order so all of this runs without Brett's intervention once the order is placed.

---

## 2. Reality check before anything gets built (truth-mode)

- **Twilio is not live yet.** Tenant notifications today go out through the manual send-queue / Google Voice (B-137), **not** an automated Twilio number. The `/sms-inbound` webhook (public, coded) and the `sendSMS` chokepoint (~line 1627) are built and waiting; the number, voice config, and messaging config are not. **Standing up Twilio is Step 0** of the call-routing half of this. It's already a backlog blocker (B-136) and doing it unblocks a large slice of the roadmap at once (see §7). The `twilio-developer-kit` plugin is installed and has skills for exactly this (account setup, voice ConversationRelay, Studio flows, messaging webhooks, TaskRouter).
- **This whole feature is a GATED class** under AUTONOMY_GUARDRAILS: it touches tenant/owner PII and customer/vendor-facing comms. Auto-composed, Brett-gated sends until trusted; the **data + routing** half (Phase 0–2) is SAFE and ships first with no customer sends at all.
- **Split the build so value lands before Twilio.** Phase 0 alone (delivery record + Hub screen + one-tap tenant relay) kills the "decode the order number and hand-text the tenant" pain — no Twilio required.

---

## 3. The spine: a Delivery record (new entity)

A first-class **Delivery** object, standalone in the Hub **and** creatable from a WO. This is what the email watcher writes to, what the phone brain reads, and what fans out notifications.

**New tab `Deliveries`** (columns):

| Field | Purpose |
|---|---|
| `ID` | numeric key (addRow auto-assigns, col 0 pattern) |
| `Order_Number` / `Confirmation_Number` | the store's reference(s); multiple allowed |
| `Store` | Home Depot / Lowe's / vendor / supply house |
| `Item_Type` | refrigerator / range / washer / dryer / dishwasher / materials |
| `New_Make_Model` | for appliances — drives the dimension check (§6) |
| `New_Dims_WxHxD` | resolved from model spec (or manual) |
| `Property_ID` / `Unit_ID` / `Tenant_ID` | who/where; resolved by delivery-address match |
| `Delivery_Address` | as the store has it (the disambiguation key on inbound calls) |
| `Expected_Date` | scheduled day |
| `Expected_Window` | narrowed window when known (e.g. 11a–3p) |
| `Onsite_Contact` | **defaults to the tenant**; override to Brett / assignee / vendor |
| `Backup_Contact` | fallback in the cascade |
| `Delivery_Notes` | floor, stairs, gate/access code, "call before", leave-where |
| `Linked_WO_IDs` | the related WO(s) — see §5 |
| `Status` | Ordered → Scheduled → Window-Set → En-Route → **Approaching** (stops-away, §8.5) → Arrived → Delivered → (Exception/Rescheduled) |
| `Source` | email-watcher / manual / from-WO |
| `Message_ID` | idempotency for the email watcher |
| `Active` |  |

**Hub screen "🚚 Deliveries"** (standalone tool page off Dev Log → 🧰 TOOLS, per FEATURE_LOG rule 57; also a button on the WO detail modal):
- List today's / upcoming deliveries with property, window, on-site contact, status.
- **"Today's deliveries" Command-Center card** — the fix for the 5am pain: every delivery for today, its window, who's meeting it, and a one-tap **"Relay to tenant"** (composes the tenant-appropriate text; draft-first until trusted) so Brett never hand-decodes an order number again.
- Create/edit a delivery; **"Create delivery" from a WO** pre-fills property/unit/tenant.

---

## 4. The routing brain — one number, right party, invisibly (Phase 3–4, needs Twilio)

The hard part Brett named: *with one shared number, which apartment is this call for?* Solved without a number-per-delivery:

**Disambiguation ladder (inbound call to the Ridge Co line):**
- **0 deliveries active today** → AI agent takes a message + alerts Brett (or treats as a normal tenant/dispatch call).
- **1 delivery active** → route directly, no questions.
- **2+ active** → the AI agent asks the one thing a driver always knows: **"What's the delivery address (or order number)?"** → match to the `Deliveries` record → route.
- **Caller-ID learning** — cache the numbers stores/drivers call from and any number on the advance confirmation text, to pre-match on repeat.

**Once matched, the AI voice agent (Twilio Voice + ConversationRelay) can:**
1. **Answer the driver's questions from the record** — what floor, where to leave it, gate/access code (scoped-shareable, B-055 model), is someone meeting them. Most "call on arrival" calls end here without ringing a human.
2. **Bridge to the on-site contact** — if the tenant is meeting the delivery, connect the driver straight to the tenant.
3. **Cascade** — no answer → assignee (Brett or a delegate) → backup. Configurable per delivery.

The store only ever knows: *"call this number when you arrive."* Everything above is invisible to them.

**Inbound SMS on the same number** (the `/sms-inbound` webhook, already public + coded):
- Parse store **confirmations / scheduled-date / narrowed-window / reschedule** texts → update the `Deliveries` record → auto-relay a tenant-appropriate version. This is the SMS twin of the email watcher.

---

## 5. Related / sub work orders + combine-or-split invoicing (B-096 + B-183)

Brett's fridge example: you service the appliance (labor + maybe parts, **Vendor A**), decide to replace it, order it, and a **different Vendor B** does the on-site delivery/install. Same tenant outcome ("a working refrigerator"), two work streams.

**Model it as a parent goal with child WOs:**
- **Parent** = the tenant's problem ("refrigerator not cooling — 153 W Lanvale #2").
- **Child A** = diagnostic/service WO (Vendor A, labor/parts).
- **Child B** = delivery/install WO (Vendor B on-site), auto-linked to the Delivery record.
- **A Delivery always has a WO** — creating a delivery with no linked WO auto-creates the install WO (Brett's "it needs to work the other way around").

**Invoicing — support both, Brett's explicit ask:**
- **One combined invoice** (all children roll up to the owner under the parent goal), **or**
- **Two separate invoices** (service billed separately from the appliance+install).
- Choice is per-parent at send time. Ties B-190 (invoice quality) + B-126 (owner approval of the marked-up appliance purchase).

*Note: B-096 (split WO + dependencies) and B-183 (multi-vendor per WO) are the existing backlog seams this graduates — build them here rather than as a separate effort.*

---

## 6. Wrong-size guard — the dimension safety check

When a new appliance is entered on a delivery, **compare its dimensions to the appliance being replaced.** If W/H/D differ beyond a tolerance, **flag for confirmation before the order is treated as final** — both directions:
- Don't silently order a **20" range to replace a 30"** (probably a mistake).
- Don't silently order a **30" to replace a 20"** (won't fit) — *unless intentional*, in which case one tap confirms.

**How it gets the numbers:**
- **Outgoing appliance** — nameplate make/model captured at the diagnostic visit (photo → OCR), graduating the **asset registry (B-170)** and CAP-010 equipment registry. Make nameplate capture a required step on the service WO.
- **New appliance** — model → dimension lookup (manufacturer spec sheet / cached spec table / AI lookup **with human confirm** — per the playbook, treat any AI-sourced spec as a first guess to verify, §6 of the repair playbook).
- **Tolerance** — default flag on >1" width delta for width-critical types (ranges 20/24/30/36; fridge width **and** depth; stacked-laundry alcoves). Configurable. Dimension-critical types listed in Config.

This is a confirm-gate, never a hard block (Brett may be replacing on purpose).

---

## 7. Email watcher — front-load everything (Phase 1)

Extend the **B-103 email-intake engine** (already specced, `EMAIL_INTAKE_BUILD_BRIEF_v1.0`) with an **appliance-order parser** as a pluggable source module (same pattern as the Buildium parser):
- Watches a purchases inbox for **order confirmations, ship/delivery-scheduled emails, narrowed-window emails, reschedule/cancel notices.**
- Extracts order #, item + make/model, **delivery address**, date/window → creates/updates the `Deliveries` record → resolves + links the property/unit/tenant/WO by delivery-address match (reuse `normalizeAddr`, queue on ambiguous match — never dup-create).
- Idempotent on `Order_Number` + `Message_ID`; label processed mail (`RidgeCo/Processed`).
- Reuses `INTAKE_TOKEN`, `createWorkOrder`, `addRow`, `resolve*` helpers, `onIntakeCreated`.

**Open decision — which inbox** (see §9): a dedicated Ridge Co purchases address used at checkout is cleanest; a forwarding rule from Brett's inbox is the fast start.

---

## 8. Notification fan-out — the actual point

On every delivery event (ordered · scheduled · window-set · en-route · arrived · delivered · exception/reschedule), notify **all relevant parties** in their language + channel (reuse B-093 notification engine / B-137 send-queue / B-156 Wave-0 tenant comms):
- **Tenant** (default on-site contact) — SMS/email, EN/ES.
- **Brett / assignee** and **backup**.
- **Owner** — awareness by default (informed, not "please attend").
- **Google Calendar invite per delivery (B-204)** — this is the *same idea already queued and it literally originated from this exact Aug-7 fridge+washer scenario.* Tenant + access-holder + owner(awareness) as guests; when the store narrows the window, updating the event auto-notifies everyone. Fold it in here.
- **Confirmation-of-receipt loop** — after the window, auto-ask the tenant "did it arrive / any damage?" → closes the delivery, or opens a damage-claim WO (ties B-190 claim-doc package).

### 8.5 En-route "stops away" touchpoint (Brett's Aug-11 add) — a new touchpoint we didn't know we had

Some stores send a **live en-route notice** on delivery day — an SMS and/or an email with a tracking link ("the delivery is **2 stops away**"). This is the single highest-value moment to reach the tenant, and **most systems never capture it.** When it's present, use it fully:
- **Immediate SMS to the tenant / related parties** — "Your delivery is close — about 2 stops away." This is **in addition to** the earlier delivery-window notice, not a replacement.
- **Optional auto-call to the tenant** if the tenant is the delivery's **primary on-site contact** — a heads-up so they're at the door (config-gated per delivery; respects quiet-hours + guardrails).
- **Calendar update** — bump the event to "arriving soon."

**How it's captured:** the store's en-route SMS lands on the dedicated deliveries number (`/sms-inbound` parse) and/or the en-route email lands at the watched inbox — parse the "N stops away" / ETA / tracking-link signal → fire the touchpoint. **Not every store sends this**, so it's a *best-effort enrichment*: when the signal exists we act on it; when it doesn't, the window notice + arrival call still cover the tenant. New `Status` value **`Approaching`** sits between `En-Route` and `Arrived`.

### 8.6 Delivery-exception handling — the "it won't install" protocol (as-needed, NOT broadcast)

The recurring failure: the appliance arrives but **can't be installed** — a site issue (plumbing, a doorway, an old shutoff) blocks it, and the delivery crew won't fix anything; their only offer is to **take it back**. Returning it means a reorder and another week without a working appliance, when often we could have just sent our own vendor.

**This guidance is delivered ONLY when a tenant contacts us reporting a delivery problem** — it must **not** appear in the routine window/en-route/arrival notifications (Brett's explicit call). It's a canned protocol the AI agent / Brett gives on that inbound contact, stored in Config so it stays consistent.

**Triage the moment a tenant reports a problem (agent asks, or Brett decides):**

1. **Can the appliance physically get *into* the unit/building at all?**
   - **No** → **return & reorder.** It cannot be left on the curb, in a hallway, or **anywhere blocking fire egress** — hard safety line. Alert Brett/assignee, reopen the order.
2. **If it fits through the building — is it the *right size* for the space?**
   - **Wrong size by a large margin** (won't fit / can't be adapted — e.g. **~4"+ off**) → **return & reorder.** (Ideally already caught by the §6 dimension check *before* it ever ships.)
   - **Right size, or a *minor* obstruction we can fix** (just needs a door removed, a shutoff swapped, a minor plumbing fix) → **keep-and-fix (default):**
     - Instruct the tenant to ask the delivery company to **leave the appliance on-site**, then contact us.
     - We **dispatch one of our own vendors** to resolve the underlying issue and complete the install — this spawns a **child WO** under the delivery's parent goal (per §5 / B-223), routed to the right trade (e.g. plumbing).

**Net:** the default is *keep it and we finish the job*; return-and-reorder is the exception, reserved for **(a) wrong size by a large margin** and **(b) can't get it inside at all** — with the fire-egress / no-curb-dumping rule as a non-negotiable. Ties the dimension check (§6, catches most size cases up front), related/sub-WOs (§5, the fix becomes a child WO), and the notification fan-out (§8, tenant + Brett + backup alerted on any exception).

---

## 9. Decisions

1. ✅ **Watcher inbox = `info@bmoremanagement.com`** (Ridge Co address to swap in later via config).
2. ⏳ **Tenant delivery texts** — (A) auto-send once Twilio + templates are trusted, (B) draft-first, you tap send [recommended to start]. *Open.*
3. ✅ **Dedicated deliveries number** (locked — see top of brief).
4. ⏳ **Dimension tolerance + which types are critical** — default >1" width on ranges/fridges/stacked-laundry; confirm or adjust. *Open.*

---

## 10. Phasing (buildable, not boil-the-ocean)

| Phase | What | Twilio? | Risk |
|---|---|---|---|
| **0** | `Deliveries` tab + Hub screen + "Today's deliveries" card + one-tap tenant relay (draft-first) + create-from-WO / auto-create-WO | No | SAFE |
| **1** | Email watcher (appliance-order parser on B-103 engine) → auto-populate + link | No | SAFE |
| **2** | Dimension safety check + nameplate OCR capture (B-170 asset registry) | No | SAFE |
| **3** | **Stand up Twilio** → inbound SMS parse (confirm/window/reschedule) + outbound tenant/owner/Brett notifications + calendar invites (B-204) | **Yes — Step 0** | GATED (customer sends) |
| **4** | AI voice routing agent (ConversationRelay): answer → disambiguate → answer driver Qs / bridge / cascade | Yes | GATED |
| **5** | Related-WO combine/split invoicing + owner approval (B-126) + asset-lifecycle log (B-194 repair-vs-replace) + receipt→QB (B-216) + damage-claim loop | No | GATED (money) |

---

## 11. Backlog cross-reference — what this graduates or reuses

**This brief is tracked as the B-218..B-223 cluster** (added to BACKLOG Aug 11): B-218 delivery record + Hub screen · B-219 appliance-order email watcher · B-220 dimension safety check + nameplate · B-221 dedicated Twilio deliveries line + routing brain + AI voice agent · B-222 notification fan-out + calendar invites + en-route touchpoint · B-223 related/sub WO + combine/split invoicing.


**Directly folds in:** B-204 (calendar invite on scheduling — same origin scenario), B-170 (asset registry + nameplate OCR — powers the dimension check), B-096 (split WO + dependencies), B-183 (multi-vendor per WO), B-103 (email intake engine — the watcher's base), B-136/B-137 (Twilio / send-queue), B-156 (Wave-0 tenant comms), B-055 (scoped-shareable access codes for the driver).

**Reuses / ties:** B-176 (vendor↔tenant direct scheduling — the delivery line is one instance of the general middleman fix), B-158 (two-way texting — driver/tenant can text the line), B-138 (contact channel map — per-contact channel + language), B-133 (multi-role Ask agent — the AI delivery agent is a role-scoped "delivery" instance: answers a driver's property questions, nothing sensitive), B-126 / B-190 / B-179 (owner approval + invoice quality + NTE thresholds for the big-ticket appliance purchase), B-194 (asset lifecycle / repair-vs-replace register — the replace decision is captured here), B-216 (receipt→QB — the order confirmation is the receipt), B-181 (same-trip dispatch — a vendor already on-site can be the on-site contact), B-169/B-171 (asset telemetry — a replacement is a lifecycle event).

**Net-new improvements surfaced (amplify):**
- **Disambiguation ladder** (0/1/2+ active) as the concrete answer to "which apartment is this call for" — no number-per-delivery needed.
- **"Today's deliveries" morning card** that does the exact lookup-and-relay Brett did by hand at 5am.
- **Fallback cascade** tenant → assignee → backup, configurable per delivery.
- **Confirmation-of-receipt + damage-claim loop** after the window.
- **En-route "stops away" touchpoint** (§8.5) — capture the store's live en-route signal when present → immediate tenant SMS + optional auto-call. A touchpoint most systems never grab.
- **Delivery-exception protocol** (§8.6) — as-needed "leave it on-site, we'll finish it" default that turns a would-be return into a same-appliance install via our own vendor; return-and-reorder only for large-margin wrong-size or can't-get-it-inside, with a hard no-egress-blocking rule.
- **Reschedule handling** from inbound SMS/email parse (stores reschedule constantly) → re-notify all + update calendar.
- **Store-account learning** (typical windows, which numbers they call from) to improve matching over time.

---

## 12. Code seams to reuse (don't reinvent)

- `createWorkOrder` (~636), `addRow` (~1761, auto-ID + phone-PIN), `fetchTab` (~1689), `updateRow` (~1775), `updateWOFields` (~1794), `fetchConfig` (~1699), `setConfigKey` (~1706).
- `sendSMS(env,to,msg)` (~1627, single chokepoint) + `logSMS`; `/sms-inbound` (public, in `PUBLIC_PATHS`) for the Twilio webhook.
- `normalizeAddr` + resolve helpers from the B-103 brief for address matching (queue on ambiguous, never dup-create).
- Drive `findOrCreateFolder` / `uploadFileToDrive` for nameplate photos.
- WO key gotcha (FEATURE_LOG rule 6): resolve by `ID` header name (`findWO`/`idColIndex`), never `r[0]`, never `WO_ID`.
- `ensureColumns` before writing any new column (rule 37 — the recurring silent no-op).
- New tab writes go through `context/sheet-ops/pending.json` against the STAGING sheet during dev.

---

*Build brief only — no code shipped. Next step is Brett's answers to §9 and a go on Phase 0.*
