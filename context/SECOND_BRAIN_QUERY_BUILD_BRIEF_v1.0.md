# Second Brain — Phone Query Surface — Build Brief v1.0 (B-133)

**For:** the Claude Code session that builds this. **Read `brett-context` + `brett-flow` + `CODEMAP.md` first (PAT-024).**
This is the execution contract for the FIRST human surface of the Second Brain (CAP-028 #2): a place Brett can ask his brain a question from his phone and get an answer, plus drop a capture — all through one screen, answered by a lightweight Worker call (never a full Cowork session).

Sits on top of two other builds it does **not** wait for:
- **B-127 Model Routing** (`MODEL_ROUTING_BUILD_BRIEF_v1.0`) — the `routeAI` chokepoint. If built, `/ask` routes through it. If not yet, `/ask` ships with a minimal inline adapter (Claude-direct, the Batch AI Processor #10 pattern) and is swapped to `routeAI` later.
- **B-134 Self-writing brain** — the nightly agent that fills the `Brain` tab and syncs the `Capture` tab back to the repo. `/ask` reads whatever is in `Brain`; on day 1 that may be thin, so v1 also answers from the **live structured tabs** (Work_Orders, Properties, Tenants, Owners, Vendors) which are already rich.

---

## Decisions locked (Brett, July 22)

- **First human surface = the phone.** Confirmed.
- **Architecture = direct Worker call, NOT a Cowork session per question.** Non-negotiable — this is the same reason B-124 went daily-not-hourly (full-session polls too costly). The query is a single `/ask` request answered inside the Worker.
- **Transport v1 = a mobile "Ask" screen inside the Hub (index.html).** Twilio is **down / not approved** (setup fix pending), so SMS cannot be v1. The Ask screen needs no Twilio and no new secret — it rides the Hub's existing admin auth.
- **SMS is a SECOND front door, added later** (B-136) once Twilio is fixed. Because `/ask` is transport-agnostic, SMS becomes "another caller of the same endpoint" — no rework.
- **Scope v1 = READ + CAPTURE only.** It answers questions and appends a capture. It does **NOT** write to structured records (WOs, money, PINs). Structured/command writes are a later phase behind a confirm-flow (protects the #535 rule: LLM never writes the money layer unattended).
- **One surface does BOTH ask and capture.** A classifier decides; a `note:` prefix force-captures.
- **Cheap-by-default model routing.** Classify + fact-phrasing on the CHEAP tier; escalate to Claude only for judgment answers (straight B-127 policy).
- **Freshness rides along from day 1.** Every `Brain` chunk carries source + date + confidence so an answer can say "(from a scan, unverified)."

---

## Architecture (one request, three verbs)

```
Phone (Hub "Ask" screen)  ──POST /ask {q}──►  Worker
                                               │
                              1. classify(q) → FACT | SEMANTIC | CAPTURE
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
- **`POST /ask`** — body `{ q, mode? }`. Behind **WORKER_SECRET** (it's an admin Hub call; the Hub's `api()` at ≈210 already injects `X-Auth-Token: SECRET`). **Do NOT add to `PUBLIC_PATHS`.** Add the `path === '/ask'` branch to the if-chain in the `fetch` handler (secret gate at ≈38 already covers it).

### Core handler `handleAsk(env, body)`
1. `classifyQuery(env, q)` → `FACT | SEMANTIC | CAPTURE`. Cheap-tier model, strict-JSON `{intent, entities:{property?,person?,venture?}, wants_detail}`. `note:`/`capture:` prefix short-circuits to CAPTURE with no model call.
2. **FACT** → resolve entities against live tabs with `fetchTab` (≈1689, header-mapped rows): Work_Orders (col1=`ID`, resolve via `findWO`/`idColIndex`, never `r[0]` — FL rule 6), Properties, Tenants, Owners, Vendors. Filter in code (address normalize — reuse `normalizeAddr` if the intake build landed it, else simple N↔North/St↔Street). Hand the filtered rows to the model to phrase a ≤2-sentence answer. Never invent a fact not in the rows.
3. **SEMANTIC** → `retrieveBrain(env, q)` = top-k keyword/tag match over the `Brain` tab (v1 is deterministic contains/score; vector search is a v2 note). Feed top chunks + q to the REASON tier for a judgment answer. Each returned chunk carries `Source, Updated, Confidence` → surface as a source tag.
4. **CAPTURE** → `addRow(env, 'Capture', {...})` (≈1761 auto-assigns ID/Active/timestamps). No model call beyond the classify. Return an ack ("Captured ✓ — filed to inbox").
5. `routeAI(env, {type:'brain_query', tier, prompt, schema})` if B-127 exists; **else** inline `callClaude` (reuse Batch AI Processor #10). Log one `Ops_Telemetry` row either way (`job_type=brain_query`, `Human_Corrected` back-fillable).
6. Return `{ answer, more_available:bool, sources:[{label,updated,confidence}] }`. Keep `answer` short; put overflow behind `more_available` so the SMS door later can send "reply MORE".

### Helpers to add
`classifyQuery(env,q)` · `retrieveBrain(env,q)` (keyword/tag score over Brain tab) · `phraseFactAnswer(env,q,rows)` · `askTelemetry(env,row)` (thin wrapper on `addRow('Ops_Telemetry',…)`). Reuse `fetchTab`/`getSheet`/`addRow`/`fetchConfig`. No new auth code.

### Guards
- **Read + capture only** — `handleAsk` has no path that writes Work_Orders/Owners/Vendors/QB. Enforced by construction.
- **Cost guard:** cap tokens per `/ask`; one escalation bump max (B-127 rule). Optional daily call cap in Config (`ask_daily_cap`).
- **No business data to untrusted providers** (PAT-031) — routeAI already guarantees this; inline fallback calls Anthropic direct only.

---

## Sheet changes (via `context/sheet-ops/pending.json`)

- **New tab `Brain`** — the semantic index the phone reads (filled nightly by B-134):
  `ID, Chunk, Source, Source_Ref, Venture, Tags, Confidence, Updated, Active`
  (`Source` = e.g. "scan"/"session"/"brief"/"email"; `Confidence` = high/med/unverified; `Chunk` = a self-contained fact or note ≤ ~500 chars.)
- **New tab `Capture`** — phone/other captures land here; B-134 syncs to the repo `CAPTURE_INBOX.md` nightly (this IS CAP-024 "surface captures in a Sheet"):
  `ID, Received, Source, Raw, Parsed_Tag, Venture_Guess, Status, Filed_CAP, Active`
- **Reuse `Ops_Telemetry`** (from B-127) for `/ask` logging; if B-127 hasn't created it yet, create it here.
- Config keys: `ask_daily_cap` (optional), `ask_enabled`.
- Share any NEW tab's sheet with the service account **`brett-os-sheets@brettos-502323.iam.gserviceaccount.com`** (Editor) per PAT-027. (Reminder: Worker RUNTIME account is `maintenance-hub-498819`, but the Sheet is shared to the `brett-os-sheets` service account — CREDENTIALS_MAP v1.3.)

---

## Hub UI (index.html — 5898 lines; reuse `showPage`/`navigateTo`/`api()`)

New **"🧠 Ask"** page:
- Add a `.page` div + nav entry; wire into `showPage` (≈1014) / `navigateTo` (≈842).
- One big text input + **Ask** button + a **Capture** toggle (or the `note:` prefix). Mobile-first: full-width, big tap targets, keyboard-mic friendly (native dictation is how Brett "voices" it in v1 — no transcription build).
- Calls `POST /ask` via `api()` (auto-injects the secret). Renders the short answer, a **More** expander when `more_available`, and small source chips (`Source · Updated · Confidence`).
- Recent Q&A/captures list under the box (reads `Capture` + a lightweight `/ask` history if worth it; optional in v1).

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

## Build order
A) `Brain` + `Capture` tabs (sheet-ops) + `/ask` handler with FACT path + `Ops_Telemetry` log → curl-test against staging sheet.
B) Hub "Ask" screen → Chrome-test on a phone viewport.
C) CAPTURE path + `note:` prefix.
D) SEMANTIC path + one-time `Brain` seed from briefs.
E) Swap inline model call → `routeAI` once B-127 lands. → update FEATURE_LOG + BACKLOG (B-133) + push.

## Verify before "done" (brett-flow)
curl `/ask` (FACT, SEMANTIC, CAPTURE) against the **staging** preview + staging sheet; Chrome-test the Ask screen at phone width; confirm no FEATURE_LOG "✅ Working" row regressed; confirm `/ask` is behind WORKER_SECRET (not in PUBLIC_PATHS). Then log + push.

## Open questions for Brett (PAT-025)
1. **Seed the `Brain` now** from existing briefs so semantic answers work at launch (recommended), or let B-134 build it over nights?
2. **Reuse the existing admin login** for the Ask screen (recommended — zero setup), or a lighter phone-only PIN so you don't full-login on mobile?
3. Ever a **second asker** (Cesar/a cleaner) — if "soon," I'll design an `Ask_Users` role table now; if "just me," WORKER_SECRET is enough for v1.

---

## Roadmap this unlocks (not v1)
- **B-136 SMS door** — once Twilio's fixed, `/sms-inbound`-style route calls `handleAsk`; caller-ID whitelist = auth. Adds "reply MORE" + dictated voice notes (MMS→transcribe finishes B-052).
- **B-134 self-writing brain** — nightly agent fills `Brain`, syncs `Capture`→repo, tags freshness. Turns "effortless growth" real.
- **B-135 LEARNED.md** — every correction becomes a `Brain` chunk (Source=learned) → the valet remembers "shirts need light starch" (#257).
- **Proactive** — same `Brain` + `Capture` powers the daily digest (B-051) and location-aware surfacing (B-054).
- **Writes v2** — command mode ("mark B-056 done", "create WO at 3014") behind a confirm step.
