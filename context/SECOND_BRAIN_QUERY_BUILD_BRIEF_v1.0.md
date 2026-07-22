# Second Brain — Multi-Role Ask Agent — Build Brief v1.1 (B-133)

**For:** the Claude Code session that builds this. **Read `brett-context` + `brett-flow` + `CODEMAP.md` first (PAT-024).**
**v1.1 (July 22) — MAJOR pivot:** Brett confirmed this is the seed of a **multi-role assistant for vendors and drivers**, not just his personal query surface. Real target questions: vendor "what's the lockbox code for X / when do I get paid?"; driver "where else can I take these pallets since location A is full? / what's the gate code for location B?". This makes **identity-scoped authorization the P0 spine** (below). Also locked v1.1: **phone-only PIN** auth (not the admin login); **seed the Brain now** from existing briefs. Where anything below conflicts with this banner, the banner wins.

This is the execution contract for the FIRST human surface of the Second Brain (CAP-028 #2): a place Brett — and, PIN-scoped, his vendors and drivers — can ask a question from a phone and get an answer, plus drop a capture — all through one screen, answered by a lightweight Worker call (never a full Cowork session).

Sits on top of two other builds it does **not** wait for:
- **B-127 Model Routing** (`MODEL_ROUTING_BUILD_BRIEF_v1.0`) — the `routeAI` chokepoint. If built, `/ask` routes through it. If not yet, `/ask` ships with a minimal inline adapter (Claude-direct, the Batch AI Processor #10 pattern) and is swapped to `routeAI` later.
- **B-134 Self-writing brain** — the nightly agent that fills the `Brain` tab and syncs the `Capture` tab back to the repo. `/ask` reads whatever is in `Brain`; day 1 the Brain is **seeded now** from existing briefs (v1.1 decision), and v1 also answers from the **live structured tabs** (Work_Orders, Properties, Tenants, Owners, Vendors) which are already rich.

---

## THE P0 SPINE — identity-scoped authorization (v1.1)

Because this hands **lockbox codes, gate codes, and pay info to third parties**, *who is asking* must gate *what is returned* — at the row level. This is built FIRST; every retrieval path is scoped through it.

**Auth = phone-only PIN (reuse existing infra).** `/ask` is NOT behind `WORKER_SECRET` (that's admin-only). It authenticates by **PIN**, exactly like `/vendor-by-pin` / `/tenant-by-pin` / `/owner-by-pin` already do, with the existing brute-force lockout (`checkPinLockout`/`recordPinFailure`/`clearPinLockout` ≈230/247/272, `PIN_Lockout` tab). One surface for everyone; the PIN resolves to a person + role.

**Roles v1 (confirm #2):** `admin` (Brett — full brain) · `vendor` (Vendors tab, 8-char PIN) · `driver` (Winchester system, B-132). `owner`/`tenant` are trivial later adds (PINs already exist).

**Scoping rules (enforced in the Worker, before the model ever sees data):**
| Role | Can ask about | Hard-blocked from |
|---|---|---|
| admin (Brett) | everything | — |
| vendor | their own assigned WOs; **access/lockbox codes only for properties on an active assigned WO**; their own bill/pay status; general trade info | other vendors' WOs, any owner PII/billing, properties they're not on |
| driver | CHEP/Winchester drop-network (where to take pallets, capacity/status); **gate codes only for sites on their route/assignment**; their own pay | Ridge Co property data, other drivers' pay |

- **Resolve identity → build an allow-set of WO/property/site IDs for that person → filter every FACT lookup to that set.** A code lookup that isn't in the allow-set returns "not authorized for that location," never the code.
- **`Audience` tag on every Brain chunk + a `visibility` on sensitive rows** — a chunk/answer is only returned if the asker's role/identity is in its audience. Lockbox/gate codes are audience = assigned-only.
- **Audit EVERY sensitive answer** → `Ask_Audit` tab (who asked, role, question, what was returned, allowed?). Non-negotiable for codes going to third parties.
- **Localize to Spanish** for vendor/driver (vendor Spanish = P0 per HUB_UX_DESIGN_FOUNDATION). Detect from PIN's language pref or the question language.

---

## Decisions locked (Brett, July 22)

- **First human surface = the phone.** Confirmed.
- **Architecture = direct Worker call, NOT a Cowork session per question.** Non-negotiable — this is the same reason B-124 went daily-not-hourly (full-session polls too costly). The query is a single `/ask` request answered inside the Worker.
- **Transport v1 = a standalone PIN-gated mobile "Ask" page** (`ask.html`, EN/ES — modeled on vendor.html, NOT inside the admin Hub, since vendors/drivers use it too). Twilio is **down / not approved** (setup fix pending), so SMS cannot be v1. No Twilio needed — auth is the phone-only PIN.
- **SMS is a SECOND front door, added later** (B-136) once Twilio is fixed. Because `/ask` is transport-agnostic, SMS becomes "another caller of the same endpoint" — no rework.
- **Scope v1 = READ + CAPTURE only.** It answers questions and appends a capture. It does **NOT** write to structured records (WOs, money, PINs). Structured/command writes are a later phase behind a confirm-flow (protects the #535 rule: LLM never writes the money layer unattended).
- **One surface does BOTH ask and capture.** A classifier decides; a `note:` prefix force-captures.
- **Cheap-by-default model routing.** Classify + fact-phrasing on the CHEAP tier; escalate to Claude only for judgment answers (straight B-127 policy).
- **Freshness rides along from day 1.** Every `Brain` chunk carries source + date + confidence so an answer can say "(from a scan, unverified)."

---

## Architecture (one request, three verbs)

```
Phone (ask.html, PIN)  ──POST /ask {pin,q}──►  Worker
                                               │
                              0. resolveAsker(pin) → {role, allowSet, lang}   ◄── P0 auth+scope
                                               │
                              1. classify(q) → FACT | SEMANTIC | CAPTURE
                                 (all retrieval scoped to allowSet / Audience)
                                               │
        ┌──────────────────────┬───────────────┴───────────────┐
     FACT                   SEMANTIC                         CAPTURE
   live Sheets            Brain tab (top-k               append row to
   (fetchTab, filter)     keyword/tag match)             Capture tab
        │                      │                              │
        └─── model phrases ────┘                         (no model call
             a short answer                               needed; ack only)
                                               │
                              log Ops_Telemetry (job_type=brain_query)
                                               │
                              return {answer, more?, sources[]}
```

---

## Worker changes (reuse — see CODEMAP.md; do NOT reinvent)

### New endpoint
- **`POST /ask`** — body `{ pin, q, mode? }`. Authenticated by **PIN, not WORKER_SECRET** (v1.1). Add `/ask` to `PUBLIC_PATHS` so it bypasses the secret gate at ≈38, then **immediately** resolve+validate the PIN (reuse the `*-by-pin` lookup + `checkPinLockout`) and derive `{person, role, allowSet}` before any data access. Reject/lockout on bad PIN. (This mirrors how `/sms-inbound` and the `*-by-pin` routes are public-but-self-authenticating.)

### Core handler `handleAsk(env, body)`
0. **Auth+scope FIRST** — `resolveAsker(env, pin)` → `{person, role, lang, allowSet}` (allowSet = the WO/property/site ids this person may see; admin = unrestricted). Bad PIN → lockout + generic reject. Everything below runs *inside* this scope.
1. `classifyQuery(env, q, role)` → `FACT | SEMANTIC | CAPTURE`. Cheap-tier model, strict-JSON `{intent, entities:{property?,person?,site?,venture?}, wants_detail}`. `note:`/`capture:` prefix short-circuits to CAPTURE with no model call.
2. **FACT** → resolve entities against live tabs with `fetchTab` (≈1689): Work_Orders (col1=`ID`, resolve via `findWO`/`idColIndex`, never `r[0]` — FL rule 6), Properties, Tenants, Owners, Vendors, Keys/lock-codes (B-055), `Drop_Locations`. **Filter to `allowSet` BEFORE phrasing** — a code/pay/site not in the allow-set returns "not authorized for that location," never the value. Address normalize (reuse `normalizeAddr` if present). Hand only the authorized rows to the model to phrase a ≤2-sentence answer (localized to `lang`). Never invent a fact not in the rows.
3. **SEMANTIC** → `retrieveBrain(env, q, role)` = top-k keyword/tag match over the `Brain` tab **filtered by `Audience`** (chunk visible to this role/person only). Feed top chunks + q to the REASON tier for a judgment answer (localized). Each chunk carries `Source, Updated, Confidence` → surface as a source tag.
4. **CAPTURE** → `addRow(env, 'Capture', {person, role, ...})` (≈1761 auto-assigns ID/Active/timestamps). No model call beyond classify. Ack ("Captured ✓").
5. `routeAI(env, {type:'brain_query', tier, prompt, schema})` if B-127 exists; **else** inline `callClaude` (reuse Batch AI Processor #10). Log `Ops_Telemetry` (`job_type=brain_query`).
6. **`Ask_Audit` write for any sensitive intent** (code/pay/PII): who asked, role, question, returned summary, allowed y/n.
7. Return `{ answer, more_available, sources[] }`. Keep `answer` short; overflow behind `more_available` (the SMS door later sends "reply MORE").

### Helpers to add
`resolveAsker(env,pin)` (→ role + allowSet; reuse `*-by-pin` + `checkPinLockout`) · `scopeFilter(rows, allowSet, role)` · `classifyQuery(env,q,role)` · `retrieveBrain(env,q,role)` (Audience-filtered) · `phraseFactAnswer(env,q,rows,lang)` · `askTelemetry` / `askAudit` (thin `addRow` wrappers). Reuse `fetchTab`/`getSheet`/`addRow`/`fetchConfig` + the existing PIN/lockout helpers.

### Guards
- **Authorization is enforced in code, before the model sees data** — the model never receives a row outside `allowSet`; it cannot leak what it never got. This is the #1 correctness property to test.
- **Read + capture only** — `handleAsk` has no path that writes Work_Orders/Owners/Vendors/QB. Enforced by construction.
- **Rate-limit + lockout per PIN** (reuse `PIN_Lockout`) — third-party endpoint, so brute-force + abuse guards are P0. Optional `ask_daily_cap` per person.
- **No business data to untrusted providers** (PAT-031) — routeAI guarantees; inline fallback calls Anthropic direct only.

---

## Sheet changes (via `context/sheet-ops/pending.json`)

- **New tab `Brain`** — the semantic index the phone reads (seeded now, kept fresh by B-134):
  `ID, Chunk, Source, Source_Ref, Venture, Tags, Audience, Confidence, Updated, Active`
  (`Source` = "scan"/"session"/"brief"/"email"; `Audience` = who may see it: `admin` / `vendor` / `driver` / `all` (+ optional scope key like a property/site id); `Confidence` = high/med/unverified; `Chunk` = a self-contained fact/note ≤ ~500 chars.)
- **New tab `Ask_Users`** — the role map: `ID, Person_Ref (vendor/tenant/owner/driver id or "admin"), Role, PIN_Ref, Lang, Active`. (PINs themselves stay on the existing Vendors/Owners/Tenants/driver tabs — this just maps a PIN's owner → role + language. Brett = one `admin` row.)
- **New tab `Ask_Audit`** — every sensitive answer: `ID, Timestamp, Person_Ref, Role, Question, Intent, Returned_Summary, Allowed, Notes`.
- **New tab `Drop_Locations`** (Winchester/CHEP pallet network — powers the driver "where else can I take these"): `ID, Site_Name, Address, Type, Status (open/full/closed), Capacity_Note, Gate_Code_Ref, Hours, Updated, Active`. **⚠ Needs source data — see open question #1.** Gate codes stored per-site and released only to a driver assigned to that site.
- **New tab `Capture`** — phone/other captures land here; B-134 syncs to the repo `CAPTURE_INBOX.md` nightly (this IS CAP-024 "surface captures in a Sheet"):
  `ID, Received, Source, Raw, Parsed_Tag, Venture_Guess, Status, Filed_CAP, Active`
- **Reuse `Ops_Telemetry`** (from B-127) for `/ask` logging; if B-127 hasn't created it yet, create it here.
- Config keys: `ask_daily_cap` (optional), `ask_enabled`.
- Share any NEW tab's sheet with the service account **`brett-os-sheets@brettos-502323.iam.gserviceaccount.com`** (Editor) per PAT-027. (Reminder: Worker RUNTIME account is `maintenance-hub-498819`, but the Sheet is shared to the `brett-os-sheets` service account — CREDENTIALS_MAP v1.3.)

---

## Front-end — standalone `ask.html` (model on vendor.html; EN/ES)

A separate PIN-gated mobile page (NOT the admin Hub — vendors/drivers use it):
- **PIN gate first** (reuse vendor.html's PIN-entry + lockout UX). On success the server returns `{role, lang}`; the page adapts labels + language (ES for vendor/driver).
- One big text input + **Ask** button + a **Capture** toggle (or `note:` prefix). Mobile-first: full-width, big tap targets, keyboard-mic friendly (native dictation = "voice" in v1, no transcription build).
- Calls `POST /ask` with `{pin, q}`. Renders the short answer, a **More** expander when `more_available`, and small source chips (`Source · Updated · Confidence`). Role-appropriate empty states (a vendor sees "ask about your jobs, codes, or pay").
- Brett's `admin` PIN unlocks the full brain + the capture list; vendor/driver views are scoped and get no capture list in v1.
- (A thin "🧠 Ask" panel can ALSO be added inside index.html later for desktop admin use — not required for v1.)

---

## What v1 can answer on day 1 (be honest with Brett)

- **FACT answers work immediately** — the structured tabs are already populated: "what's open at 3014", "who's the owner at Fait Ave and what's still owed", "which WOs are unassigned". This alone is daily value.
- **SEMANTIC answers are only as good as the `Brain` tab**, which B-134 fills. Until B-134 runs a few nights (or a one-time seed from the existing briefs), judgment questions ("what's my subcontracting script", "how do I handle a lockout") will be thin. **Recommended:** a one-time seed of `Brain` from the existing venture briefs + PAT library so semantic answers work on launch, then B-134 keeps it fresh.

---

## Cost & complexity (honest)
- **Complexity: LOW–MED.** One endpoint, one classifier, two retrieval paths, one new screen. Within Brett's ~2-hour ceiling if B-127's adapter or the #10 Claude call is reused.
- **Running cost:** well under $20/mo. Most `/ask` traffic is FACT (cheap tier / no model for capture); Claude only touches judgment answers.

## Success metrics (PAT-031)
- Brett actually asks it from his phone in the field (usage > 0/week).
- ≥70% of `/ask` jobs served by CHEAP tier without escalation.
- Zero structured-record writes from `/ask` (read+capture only) — audited.
- FACT answers verifiably match the Sheet (spot-check 10).

## Build order (auth spine FIRST)
A) **Auth+scope:** `Ask_Users` + `Ask_Audit` tabs + `resolveAsker`/`scopeFilter` + PIN lockout reuse → unit-test the allow-set matrix (vendor can't see another vendor's WO/code/pay; driver can't see Ridge Co).
B) `Brain` (seed now) + `Capture` + `Drop_Locations` tabs + `/ask` handler FACT path (scoped) + `Ops_Telemetry`/`Ask_Audit` logging → curl-test each role against staging.
C) `ask.html` PIN-gated page (EN/ES) → Chrome-test at phone width, per role.
D) CAPTURE path + `note:` prefix.
E) SEMANTIC path (Audience-filtered) over the seeded Brain.
F) Swap inline model → `routeAI` once B-127 lands. → update FEATURE_LOG + BACKLOG (B-133) + push.

## Verify before "done" (brett-flow)
**Authorization matrix is the headline test:** curl `/ask` as admin/vendor/driver against **staging** and prove each role gets ONLY its allow-set (attempt an out-of-scope lockbox/gate/pay lookup → must return "not authorized," never the value); confirm `Ask_Audit` logged it. Then: classify FACT/SEMANTIC/CAPTURE correctly; Chrome-test `ask.html` per role at phone width incl. Spanish; bad-PIN lockout works; no FEATURE_LOG "✅ Working" row regressed. Then log + push.

## Open questions for Brett (PAT-025)
1. **Pallet drop-network data** — does a list of CHEP/Winchester drop sites (with open/full status + gate codes) exist anywhere yet, or is assembling `Drop_Locations` part of this build? The driver "where else can I take these" question can't work without it.
2. **v1 roles = admin + vendor + driver** (recommended), or add owner + tenant from day one? (Their PINs already exist, so it's a small addition either way.)
3. **Brain seeded now** = confirmed (v1.1). Anything you want deliberately EXCLUDED from the vendor/driver-visible Brain (e.g. finances, owner PII, competitive/CHEP-sensitive notes)? Default: everything sensitive is `Audience=admin` unless tagged otherwise.

---

## Roadmap this unlocks (not v1)
- **B-136 SMS door** — once Twilio's fixed, `/sms-inbound`-style route calls `handleAsk`; caller-ID whitelist = auth. Adds "reply MORE" + dictated voice notes (MMS→transcribe finishes B-052).
- **B-134 self-writing brain** — nightly agent fills `Brain`, syncs `Capture`→repo, tags freshness. Turns "effortless growth" real.
- **B-135 LEARNED.md** — every correction becomes a `Brain` chunk (Source=learned) → the valet remembers "shirts need light starch" (#257).
- **Proactive** — same `Brain` + `Capture` powers the daily digest (B-051) and location-aware surfacing (B-054).
- **Writes v2** — command mode ("mark B-056 done", "create WO at 3014") behind a confirm step.
- **This IS the vendor/driver agent** — v1.1 makes B-133 the foundation Brett named: a PIN-scoped assistant vendors and drivers self-serve (codes, pay, dispatch, "where do these pallets go"). Ties the vendor portal (vendor.html), Winchester driver-payment (B-132), lock-code registry (B-055), auto-dispatch (B-113/B-114). Each new capability = a new intent + scope rule on the same engine.
