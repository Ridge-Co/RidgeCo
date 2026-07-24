# Service Delivery — Wave 0 (Communication) Build Brief

**Version:** v1.0 | **Created:** July 24, 2026 | **Owner:** Brett
**Backlog:** B-156 (this slice) → B-157..B-162 (rest of Wave 0). Roadmap: `SERVICE_DELIVERY_ROADMAP_v1.0`.
**Governs:** the first build off the 224-idea Service-Delivery research. **Communication leads everything (Brett directive).**

> **Why this first:** the research's single highest-leverage, lowest-cost finding is that *proactive status communication* is what kills tenant anxiety and repeat "did anyone hear me?" calls — and it's Brett's own founding example ("notify the tenant the moment we receive the work order and who it's assigned to"). This brief builds the **tenant work-order lifecycle notification set (B-156)** as the first slice, on infrastructure that already exists.

---

## 1. Scope

**In scope (B-156, this build):** fire a tenant-facing message on every canonical work-order lifecycle transition — **Received → Assigned (naming the tech) → Scheduled → On Hold → Complete** — in EN/ES, logged, rendered in the tenant view, and queued for SMS send.

**Explicitly deferred to later Wave 0 items (sequence at §9):** post-close survey + review loop (B-157), two-way texting + day-of "en route" reminders (B-158), SLA-breach heads-up (B-159), AI-drafted vendor/owner comms (B-160), vendor invoice nudges (B-161), dedicated line (B-162).

**Out of scope entirely here:** the generalized event-automation "Flows" engine (B-177) — this brief hand-wires five events; B-177 later abstracts them into a config-driven table. We build the seed, not the engine.

---

## 2. Current state — what already fires (verified against CODEMAP, July 24)

This is a **thin enrichment layer over code that already exists**, not a greenfield build. Grounding:

| Event | Handler (worker.js) | Today | Gap to close |
|---|---|---|---|
| WO created | `createWorkOrder` — POST /workorder ≈636 (writes Work_Orders, reads Tenants) | **No tenant "received" message** | **Add** the received-ack (SD-001) |
| Vendor assigned | `assignVendor` — POST /assign ≈675 (**already SMSes vendor+tenant**; reads Vendors/Tenants/Units/Properties/Keys) | Tenant is texted, but message **doesn't name the tech / set the expectation** | **Enrich** copy: name tech + "expect them to reach out" (SD-002/003) |
| Scheduled | `scheduleWO` — POST /schedule ≈1520; modal has a `notify` checkbox | Sets date; tenant scheduled-message not standardized | **Standardize** a tenant scheduled message |
| Status change | `updateStatus` — POST /status ≈717 (audits + notifies) | Notifies, but no clean tenant copy for **On Hold** / **Complete** | **Add** tenant On-Hold (+reason) + Complete messages |

**Shared plumbing that already exists (reuse, don't rebuild):**
- `sendSMS` ≈1629 — **THE single SMS chokepoint.** Wrap-point for quiet-hours / opt-out / test-mode (the B-093 wrap lands here). Every tenant message goes through it.
- `queueNotification` / `processPendingNotifications` + **`Notification_Queue`** tab ≈1543/1552 — deferred-send queue, drained by `GET /notifications/pending`. **No cron flushes it yet** (B-093 Phase 0.3) — see §6 channel policy.
- `logSMS` → **`SMS_Logs`** ≈1640 — every send is logged.
- **Status SSOT §4** (`HUB_UX_DESIGN_FOUNDATION_v1.1`) — canonical lifecycle + `label(status, role)` with the **renter mask** (tenant sees "Complete," never "Pending Invoice / Invoiced / Paid"). **All tenant copy must render stage text through this**, so billing jargon can never leak (the design foundation flags that it currently does).
- `/wo/set-tenant-visibility` + WO `Tenant_Visible` flag — respect it; no messages for tenant-hidden WOs.
- WO key column = **`ID` at index 1** (never `r[0]` — FL rule 6); resolve via `findWO`/`idColIndex`.

---

## 3. The design — one dispatcher, five hooks

Add a single function and call it from the four handlers above:

```
notifyTenant(woId, event, ctx)
  event ∈ { received, assigned, scheduled, on_hold, complete }
  1. Guard: WO Tenant_Visible !== false; tenant exists; not already sent for this (woId,event) → idempotent
  2. Resolve tenant: first name, Phone, Lang (EN/ES)
  3. Build message from TEMPLATE[event][lang], interpolating {first,issue,unit,tech,date,window,reason}
     - stage words ALWAYS via SSOT label(status,'renter') — never raw status
  4. Log → SMS_Logs (channel='tenant', event, woId)  ← always, even when send is dormant
  5. Send → sendSMS(phone,msg)  ← inherits quiet-hours / opt-out / test-mode / queue
  6. Append → tenant timeline entry (WO_Audit or Tenant_Messages) for the in-Hub view
```

This **event→message map IS the seed of the Flows engine (B-177)** — when B-177 lands, `TEMPLATE` + the hook list become config rows instead of code.

### Tenant message templates (draft — casual Ridge Co voice, per Brett's "don't overstate the size" preference)

| Event | EN (SMS ≤160 where possible) |
|---|---|
| received | "Hi {first}, it's Ridge Co — we got your request about {issue} at {unit}. We'll get someone on it and follow up shortly. Nothing else you need to do. 👍" |
| assigned | "Update on your {issue} request: {tech} is handling it and will reach out to set up a time. Expect a call or text from them soon. — Ridge Co" |
| scheduled | "Your {issue} repair is set for {date} ({window}). {tech} plans to be out then — reply here if that time doesn't work. — Ridge Co" |
| on_hold | "Quick update on your {issue} repair — it's on hold: {reason}. We'll message you the moment it's moving again. — Ridge Co" |
| complete | "Good news {first} — your {issue} repair at {unit} is done. If anything isn't right, just reply and we'll take care of it. — Ridge Co" |

*(ES mirror strings maintained alongside; reuse the existing `translateToEnglish` binding's reverse or keep a static ES table — decision §7.)*
**In Progress** and **day-of "en route"** are intentionally **OFF by default** (noise); "en route" needs a vendor "on my way" trigger → B-158.

---

## 4. Data model

| Tab | Field | Action |
|---|---|---|
| **Tenants** | `Phone` | exists (PIN). Reuse. |
| **Tenants** | `Lang` (EN/ES) | add if missing; default EN |
| **Tenants** | `SMS_OptOut` (bool) | **add** — set by inbound STOP + manual |
| **Work_Orders** | `Tenant_Visible` | exists (`/wo/set-tenant-visibility`). Respect. |
| **Work_Orders** | `Issue_Summary` | short tenant-safe label for {issue}; derive from description if absent |
| **Work_Orders** | `Scheduled_Date`, `Scheduled_Window` | from `scheduleWO`; reuse |
| **SMS_Logs** | `Channel`, `Event`, `WO_ID` | tag tenant messages (add cols if absent) |
| **Config** | `notify.tenant.<event>` on/off; `notify.tenant.enabled`; test-mode/admin-mute (reuse B-093 flags) | per-event kill switches |

No new tab strictly required — the in-Hub tenant timeline can read `SMS_Logs` (channel='tenant') + `WO_Audit`. (A dedicated `Tenant_Messages` tab is optional polish.)

---

## 5. Channel policy (honest v1 given Twilio is dormant)

Twilio/SMS delivery is **blocked (B-136)** and B-093 holds SMS in quiet hours. So v1 ships **real value without waiting on Twilio**:

1. **In-Hub tenant timeline — LIVE NOW.** Every event writes a timeline entry the tenant sees in their WO view. This alone delivers the "someone heard me / here's who's coming" experience for any tenant who opens the portal.
2. **SMS — built, logged, QUEUED, dormant.** `notifyTenant` calls `sendSMS`; with Twilio off it logs + queues (no-op send) and flips live the day Twilio is enabled — zero rework. This mirrors B-093's "engine now, delivery when Twilio's up."
3. **Email to tenants — NOT in v1** (we hold phones, not reliably emails). Revisit if tenant emails get captured. ❓ confirm §7.

Quiet-hours (8pm–8am ET hold-til-8am), test-mode, and admin-mute all come **free** by routing through `sendSMS` once the B-093 wrap is in place; this brief must not bypass the chokepoint.

---

## 6. Decisions to lock (recommended default → ❓ = needs Brett)

1. **Event set** = Received, Assigned, Scheduled, On Hold, Complete; In-Progress + En-route OFF by default. → recommend **yes**. ❓ add In-Progress?
2. **Channels v1** = in-Hub timeline (live) + queued SMS (dormant); **no tenant email**. → recommend **yes**. ❓ confirm.
3. **Copy/tone** = casual Ridge Co voice above. ❓ **approve or tweak the 5 templates.**
4. **ES strings** = static maintained table (safer than live-translating each send). → recommend **yes**. ❓ confirm.
5. **Opt-out** = inbound **STOP** keyword (via existing `/sms-inbound` ≈1604) sets `SMS_OptOut`; in-Hub timeline still shows (not a send). → recommend **yes**.
6. **Received-ack timing** = fire immediately on `createWorkOrder`, even before assignment. → recommend **yes** (this is the 0-to-1 moment).

---

## 7. Acceptance criteria (for `ridgeco-validate` — this touches customer-facing comms, so validation is mandatory)

- [ ] Each of the 5 events fires **exactly one** tenant message (idempotent on re-save; no dup on repeated `/status`).
- [ ] `assigned` message **names the assigned tech**; `scheduled` includes date + window; `on_hold` includes the reason.
- [ ] **No billing terms** ever appear in tenant copy — all stage words via `label(status,'renter')`; Pending Invoice/Invoiced/Paid never reach a tenant.
- [ ] Respects `Tenant_Visible=false` (no message), `SMS_OptOut` (no send, timeline only), test-mode + admin-mute + quiet-hours (via `sendSMS`).
- [ ] Tenant with **no phone** → in-Hub timeline entry written, **no error thrown**.
- [ ] EN + ES both render correctly from tenant `Lang`.
- [ ] Every event logged to `SMS_Logs` with channel='tenant' + event + WO_ID.
- [ ] `complete` event exposes a clean **seam for B-157** (survey trigger) — a single call site, not yet wired.
- [ ] All WO lookups by header (`findWO`/`idColIndex`), never `r[0]` (FL rule 6).
- [ ] Built on a **staging branch + test sheet**; no `wrangler versions upload` prod deploy until green (FL rule 18 / BUILD_ORDER preview lane).

---

## 8. Build steps

1. **Staging first** — branch + test sheet (never the live Hub; FL rule 18).
2. Add `Tenants.Lang`, `Tenants.SMS_OptOut`, `Work_Orders.Issue_Summary`, `SMS_Logs.Channel/Event/WO_ID` if absent (sheet-ops).
3. Write `notifyTenant(woId,event,ctx)` + the `TEMPLATE` EN/ES tables; route through `sendSMS`.
4. Hook it into `createWorkOrder` (636), `assignVendor` (675 — replace the ad-hoc tenant SMS), `scheduleWO` (1520), `updateStatus` (717 → on_hold/complete).
5. Render the tenant timeline in the WO view (reads SMS_Logs channel='tenant' + WO_Audit). Ties the B-006 tenant-portal overhaul but ships standalone.
6. Idempotency guard (a `(woId,event)` sent-ledger — a column on SMS_Logs check, or a small set).
7. **Verify** against §7 → run `ridgeco-validate` (mandatory: customer-facing) → smoke test on the test sheet → then merge.

---

## 9. Wave 0 sequence after this

**B-156 (this)** → **B-157** survey-on-complete + low-score alert + review invite (wires the §7 complete seam) → **B-158** two-way replies (route via `/sms-inbound`) + day-of "en route" (needs vendor "on my way" trigger) → **B-159** SLA-breach heads-up (needs the B-169 SLA timer) → **B-160** AI-drafted vendor packet + owner summary (reuse router B-127) → **B-161** vendor invoice/status nudges → **B-162** dedicated local line. Each reuses `notifyTenant`'s pattern; together they become the input list for the **Flows engine (B-177)**.

**Dependency note:** everything that *sends SMS* is gated on **Twilio (B-136)**; everything that *shows in-Hub* ships now. Build order therefore front-loads the in-Hub timeline so value lands before Twilio.
