# Ridge Co — Email → Work Order Intake — Build Plan v1.0

**Date:** July 21, 2026 · **Venture:** Ridge Co (Maintenance Hub) · **Status:** Plan for review, pre-build
**Decisions locked (this session):** source-agnostic engine · Buildium parser + manual-list AI parser both in v1 · create-and-notify-you (no vendor SMS in v1) with an auto-assign seam left open · flexibility for future senders (AppFolio, etc.).

---

## 1. What it does (target behavior)

When a maintenance email lands in your inbox, the system automatically:

1. **Detects the source** (Buildium vs. a hand-typed list vs. future AppFolio) and routes it to the right parser.
2. **Extracts the job**: description, location, tenant, entry/pet notes, priority, and the **customer's reference WO number** (e.g. Buildium `838106-1`).
3. **Finds or creates** the Owner (customer), Property, Unit, and Tenant in your Hub — no duplicates.
4. **Pulls every photo/video** attached to the job and files them in that WO's Drive folder.
5. **Creates the work order** as status `New`, stamped with the customer's ref number for two-way tracking, and **texts you** that a new one arrived.
6. **You triage** (assign the vendor). Auto-assign is designed-in for later, not switched on now.

**Two confidence lanes:**
- **Structured Buildium email** → high confidence → WO created straight through + you're notified.
- **Hand-typed list (Mark) or anything ambiguous** → lands in a **Review queue** in the Hub; you confirm the parsed fields with one tap, then it creates the WO(s). Nothing fuzzy auto-creates a duplicate property/tenant.

---

## 2. Architecture — one engine, pluggable parsers

```
Gmail (brett@bmoremanagement.com)
   │  ① Apps Script poller (every ~5 min) — the ONLY piece that touches Gmail
   ▼
POST /intake   → Cloudflare Worker (worker.js)   [transport-agnostic: a cron or push
   │                                               could feed this same endpoint later]
   ├─ ② detectSource(sender/subject) ──► routes to a parser module
   │      • parseBuildium(html)         (deterministic, high-confidence)   ← v1
   │      • parseManualList(text)       (AI-assisted, → Review queue)      ← v1
   │      • parseAppfolio(html)         (stub; drops in when samples exist)
   │
   ├─ ③ resolve(): find-or-create Owner → Property → Unit → Tenant
   ├─ ④ ingestFiles(): fetch each file URL → upload to the WO's Drive folder
   ├─ ⑤ createWorkOrder() + Owner_WO_Ref  (reuses existing function)
   └─ ⑥ onIntakeCreated() hook  → v1: SMS you.  ← auto-assign plugs in HERE later
```

**Why Apps Script for ingest:** the Worker can't read Gmail without OAuth/domain-delegation that isn't set up; Apps Script reads Gmail natively and runs free on a 5-min timer. It stays "dumb" — it just forwards the raw email to the Worker. **All parsing/logic lives in worker.js** (git-versioned, testable by curl, single source of truth per PAT-001). This is also what gives you the flexibility you asked for: adding AppFolio later = one new parser module + one line in the source-router, zero changes to ingest, resolver, files, or notify.

---

## 3. The Buildium format (verified against your real emails)

Sender `donotreply@managebuilding.com`, subject `Phoenix Estate Rentals, LLC: Work order 838106`. Every one carries the same parseable blocks:

| Field | Where in the email | Maps to |
|---|---|---|
| Ref # `838106-1` | subject + `Work order #838106-1:` | `Owner_WO_Ref` (already exists) |
| Description | title after the colon + "Job description / Tenant notes" | `Description` |
| Location `1110 North Dukeland Street - 1`, `Baltimore, MD 21216` | "Location" block | Property address + Unit (`1`) + City/State/Zip |
| Tenant `Ian Rogers`, `(240) 288-0886`, `ianrogers933@gmail.com` | "Entry contacts" | Tenant find-or-create |
| Pets / entry `Pets: Yes — Cat` | "Entry details/notes" | WO `Notes` + access hint |
| Owner `Phoenix Estate Rentals, LLC` | header + footer | Owner find-or-create |
| Files (S3 links) | "Files" section | Fetch → Drive (images **and** video, e.g. `.MOV`) |

One Buildium email = exactly one WO (three issues at one address = three separate emails — confirmed). No lists ever appear in Buildium mail; lists only appear in the hand-typed emails.

---

## 4. Code changes (grounded in current worker.js)

### 4.1 New Worker endpoints (behind auth)
- `POST /intake` — accepts a forwarded email `{ sender, subject, date, message_id, html, plaintext }`; runs detect → parse → (create | queue). Add to the POST router (~line 98 area) alongside `/workorder`.
- `POST /intake/approve` — takes a reviewed queue item `{ queue_id, confirmed:{owner_id?,property_id?,unit_id?,tenant_id?, fields...} }`, runs resolve+create for it, marks the queue row `created`. Powers the Review screen's Approve button.
- (Optional) `GET /intake-queue` — list pending items for the Hub screen (or reuse `getSheet('Intake_Queue')`).

### 4.2 New functions in worker.js
- `detectSource(sender, subject)` → `'buildium' | 'manual' | 'appfolio' | 'unknown'` (simple sender map; easy to extend).
- `parseBuildium(html)` → normalized item(s) via section/regex extraction. High confidence.
- `parseManualList(text, env)` → calls an LLM to split free text into discrete items → **all go to the queue** (never auto-create).
- `resolveOwner / resolveProperty / resolveUnit / resolveTenant` → each does `fetchTab` + normalized match, else `addRow(...)` (which already auto-assigns numeric IDs and, for Tenants, auto-generates the phone-based PIN). Ambiguous match ⇒ **do not create**, flag for the queue.
- `normalizeAddr(s)` → lowercases, expands directionals (N↔North), street types (St↔Street, Ave↔Avenue, Rd↔Road), strips punctuation + unit suffix. Seeded/tested against your current Properties list to avoid dupes.
- `ingestFiles(env, woId, propAddr, urls)` → for each URL: `fetch → arrayBuffer → uploadFileToDrive(...)` into the WO folder, then `addRow('Attachments', …)` + set `Drive_Folder_URL/ID`. Best-effort per file (a failed file only warns — same pattern as QB attach). Refactor the folder lookup out of `handlePhotoUploadClean` into a shared `getWOFolder()` so both paths use it.
- `onIntakeCreated(env, wo)` → v1: `sendSMS(env, config.admin_phone, summary)`. **This is the auto-assign seam** — later it calls a `pickVendor()` + `assignVendor()` and nothing else changes.
- Reuse as-is: `createWorkOrder` (already takes `property_id, unit_id, tenant_id, description, priority, owner_wo_ref, wo_contact_name, wo_contact_phone, notes` and auto-links tenants).

### 4.3 Sheet changes (via `context/sheet-ops/pending.json`)
- **Work_Orders** — add `Source` (`email-buildium` / `email-manual`) and `Intake_Message_ID` (traceability + dedupe). `Owner_WO_Ref`, `WO_Contact_Name/Phone`, `Notes` already exist.
- **New tab `Intake_Queue`** — `ID, Received_Date, Source, Sender, Subject, Message_ID, Owner_Ref, Raw_Excerpt, Parsed_JSON, Property_Guess, Unit_Guess, Tenant_Guess, Confidence, Status, Created_WO_ID, Notes, Active`. (Structured items skip this; manual + low-confidence items land here.)
- **Config** — `intake_admin_phone` (or reuse `admin_phone`), `intake_enabled` on/off switch.
- *(Reminder: any brand-new sheet must be shared with `brett-os-sheets@brettos-502323.iam.gserviceaccount.com` as Editor — PAT-027 — but Intake_Queue is a new tab in the existing RidgeCo Main sheet, so it's already shared.)*

### 4.4 Hub UI (index.html) — Review screen
New "📥 Intake" screen listing `Intake_Queue` pending items. Each card shows the parsed fields (editable), Property/Unit/Tenant **guesses as searchable dropdowns** (reuse the existing dropdown component), any photos, and **Approve** (→ `/intake/approve`) or **Reject**. This is where the hand-typed lists become confirmed WOs.

### 4.5 Ingest — Apps Script (delivered complete; you authorize once)
Bound to your Workspace mailbox, 5-min time trigger. Query: `(from:donotreply@managebuilding.com OR from:phoenixestatesmaryland@gmail.com) -label:RidgeCo/Processed newer_than:30d`. For each new message → POST raw email to `/intake` with the auth header → on success, apply label `RidgeCo/Processed`. Two-layer dedupe (Gmail label **and** the Owner_WO_Ref check in the Worker) means an email can never create two WOs.

---

## 5. Idempotency & de-duplication
- **Structured:** before create, check `Work_Orders` for an existing `Owner_WO_Ref` — skip if present.
- **All sources:** Apps Script labels processed mail so it's never re-sent.
- **Property/Unit/Tenant:** exact-or-normalized match reused; only a genuine no-match creates a new record; a *partial* match routes to Review rather than risking a duplicate.

---

## 6. Build order (v1 = Phases A–C)

- **Phase A — Engine + Buildium (ship first, validate on real mail):** `/intake`, `detectSource`, `parseBuildium`, resolver, `ingestFiles`, `createWorkOrder` wiring, `onIntakeCreated` = notify-you, sheet columns, Apps Script poller. Test against the 10+ real Buildium emails already in your inbox.
- **Phase B — Review queue:** `Intake_Queue` tab, Hub Intake screen, `/intake/approve`.
- **Phase C — Manual-list AI parser:** `parseManualList` → queue. (Depends on B.)
- **Phase D — Auto-assign (future):** fill the `onIntakeCreated` seam with vendor selection + SMS. No engine/parser changes.
- **AppFolio (future):** add `parseAppfolio` when you have sample emails.

Each phase ships only after a smoke test (curl the endpoint / tap-path on the S23) and a FEATURE_LOG regression check — nothing goes live untested (brett-flow).

---

## 7. Open items that need your call before/at build

1. **Photo source (technical risk to verify first):** Buildium serves files as Amazon S3 links in the email body, not as attachments. I'll curl one at build to confirm they're publicly fetchable by the Worker. If they need a Buildium login, we adjust (e.g., pull via the Buildium API or skip photos for that source) — flagging now so it's not a surprise.
2. **Manual-list AI parser needs an LLM key:** to split Mark's free-text lists the Worker calls an LLM (I'd use Anthropic). That's a new Worker secret + a tiny per-email cost (fractions of a cent). OK to add, or prefer a no-AI heuristic split (you still confirm everything in the queue anyway)?
3. **Dedicated intake token:** recommend a separate `INTAKE_TOKEN` env var rather than reusing `WORKER_SECRET`, so rotating the shared secret in the upcoming security build doesn't break intake (and vice-versa). Good hygiene; you'd add one Cloudflare var.
4. **One unavoidable manual step:** Apps Script must be authorized once under your Google account (Google requires user consent — it can't be done from here). I deliver the complete script; you paste it into script.google.com, hit Authorize, and set the token. ~2 minutes, one time.
5. **Trade field:** leave `Trade` blank for you to set on triage (recommended), or show a keyword-based guess ("toilet"→Plumbing) in the queue for one-tap accept?

---

## 8. What's reused vs. new (so you can size it)
**Reused, untouched:** `createWorkOrder`, `addRow` (IDs + tenant PIN), `uploadFileToDrive`/`findOrCreateFolder`, `sendSMS`, `Attachments` logging, searchable dropdowns, `Owner_WO_Ref`/contact columns.
**New:** `/intake` + `/intake/approve` endpoints, source-router, Buildium parser, manual parser, resolver + address normalizer, `ingestFiles`, `Intake_Queue` tab, Hub Intake screen, the Apps Script poller.

---

*Prepared for Brett — Ridge Co. Nothing has been built or pushed yet; this is the plan to green-light.*
