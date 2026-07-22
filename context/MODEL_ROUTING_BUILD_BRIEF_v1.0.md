# Model Routing Layer — Build Brief v1.0 (B-127)

**For:** the Claude Code session that builds this. **Read `brett-context` + `brett-flow` first (PAT-024).**
This is the execution contract for the secure, self-owned multi-model router. It replaces the idea of installing a third-party gateway (OmniRoute) or compression tool (Headroom). Governs every future AI call in the system per **PAT-031**.

---

## Why we build this (and why NOT a gateway)

Goal: expand AI usage a lot **without** expanding cost — by sending each AI job to the *right-tier* model (cheap by default, Claude only when the job earns it), instead of running everything on an expensive model.

We do **not** use OmniRoute / a hosted AI gateway, because a gateway is a proxy that sits in the middle of every request and its "free model" tiers route your data to third parties who may train on it. Brett's data (QuickBooks figures, CHEP remittances, EIDL/loan numbers, tenant PII) must not pass through a middleman — especially given the existing CHEP business-email-compromise exposure (#177). We also skip **Headroom** (a local context-compression tool): the win it promises (not re-reading giant files/JSON) we already get from `brett-flow` task-scoped loading + `CODEMAP.md`.

**The secure pattern:** call each provider's API **directly from our own Cloudflare Worker**, each key stored as a Worker secret. Data flows only between our Worker and providers we already trust (Google/Gemini — where the business already lives — and Anthropic). No new party, no proxy, every rule auditable and owned by us.

## Decisions locked (Brett, July 22)

- **Routing is a policy WE write, not magic.** A small classifier + a rules table Brett controls. Default cheap, escalate on need.
- **Cheap-by-default + automatic escalation.** The cheap model runs first; if it returns low confidence or malformed output, the router kicks the same job up to a stronger model. This is the "monitor → escalate only ambiguous cases" philosophy (#257) applied to model choice.
- **Every routed job logs telemetry** (feeds the Optimizer — see `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0`). No build ships without a way to measure it (**PAT-031**).
- **Providers v1 (LOCKED):** Google Gemini (cheap tier) + Anthropic Claude (reasoning tier). Only two. Others only if a real need appears; never "free" third-party tiers for business data.
- **Default policy (LOCKED, Brett July 22): cheapest-that-passes** for every job by default. **Force the REASON/HIGH tier (Claude) for anything customer-facing or money-facing**, regardless of how simple the job looks — tag those jobs `customer_facing` or `money_facing` and the router pins them to Claude even if the cheap model would have "passed." Cost is not the deciding factor when a customer sees it or money moves.

---

## Router design

### Model registry (config-driven, editable in one place)
A `MODEL_REGISTRY` map in worker.js (or a `Model_Registry` Config block) listing each model with: provider, endpoint, key-env-name, tier, relative cost, strengths, max output. Editing the table re-points routing — no code surgery (matches how Brett iterates gems with surgical diffs).

### Routing tiers (starting policy — tune from telemetry)
| Tier | Use for | Default model |
|---|---|---|
| **CHEAP** | bulk / structured / low-judgment: transcribe a note, extract receipt fields, tag a task, summarize one email, first-pass parse | Gemini Flash |
| **REASON** | subjective / stakes / customer- or money-facing: draft a marked-up estimate, reconcile an ambiguous QB entry, tenant-facing message, final classification | Claude Sonnet |
| **HARD** | rare, hardest reasoning / multi-step synthesis | Claude Opus |

**Policy rule (LOCKED):** default = **cheapest-that-passes** (start CHEAP, escalate only on validation fail). **Override:** any job tagged `customer_facing` or `money_facing` is pinned to REASON (Claude) up front — never served by the cheap tier even if it would pass. Money and customers get the best model by default; everything else earns its way up.

### Core function
`routeAI(env, job)` where `job = { type, tier?, prompt, input, schema?, maxTokens? }`:
1. Resolve tier — explicit `job.tier`, else look up `job.type` in a `JOB_ROUTES` table (e.g. `receipt_parse → CHEAP`, `estimate_markup → REASON`).
2. Call the tier's model via its provider adapter.
3. **Validate** the result (schema check / confidence check / non-empty).
4. **Escalate** on failure: if CHEAP fails validation → retry once at REASON. Cap escalation at one bump to avoid runaway cost.
5. **Log telemetry** (see schema below) regardless of outcome.
6. Return `{ result, model_used, escalated, tokens, ms }`.

### Provider adapters (small, isolated)
- `callGemini(env, model, prompt, opts)` → `fetch` to Gemini `generateContent`, key = `env.GEMINI_API_KEY`. Strict-JSON prompt when `schema` given.
- `callClaude(env, model, prompt, opts)` → existing Anthropic call pattern (the Batch AI Processor #10 already does this — **reuse**, don't reinvent).
Both return a normalized `{ text, tokens_in, tokens_out }` so `routeAI` is provider-agnostic.

### Telemetry (the data the Optimizer runs on)
Append one row per routed job to a new Sheet tab **`Ops_Telemetry`** (or batch to Cache then flush):
`ID, Timestamp, Job_Type, Tier_Requested, Model_Used, Escalated, Tokens_In, Tokens_Out, Est_Cost, Latency_ms, Success, Confidence, Human_Corrected, Notes`
`Human_Corrected` is back-filled when Brett edits a result in the Hub — that's the strongest signal that a routing rule is mis-tiered.

---

## Worker integration (reuse — see CODEMAP.md / brett-flow)
- Wrap existing AI calls (batch note parser, any future receipt/intake parse) to go **through `routeAI`** instead of calling Claude directly. Single chokepoint, like `sendSMS` is for SMS.
- Reuse `fetchConfig`/`setConfigKey` for the registry + routes; `addRow(env,'Ops_Telemetry',...)` for logging; existing try/catch + JSON-error conventions (PAT-011/014).
- Store `GEMINI_API_KEY` as a Cloudflare Worker secret (`keep_vars` so it survives deploys). Add to `CREDENTIALS_MAP.md`.

## Prerequisites (flag to Brett before build — PAT-029)
- Gemini API key (Brett has one — used heavily; located per #483). Add as Worker secret.
- Create `Ops_Telemetry` tab; share the sheet with the service account (PAT-027) if new.
- Confirm current cheap Gemini model id + Claude model ids via **current docs** (PAT-028) at build time — model names change.

## Cost & complexity (honest)
- **Complexity: LOW.** It extends the existing Batch AI Processor pattern — a second provider adapter + a router + a log write. Realistic first working version within Brett's ~2-hour setup ceiling.
- **Running cost:** well under the $20/mo cap. Gemini Flash is cheap; high-volume parsing moves off Claude, Claude only touches the judgment slice.
- **Caveat:** "best model" = the policy we write; revisit the routing table every few months as models change (a small table edit, not a rebuild).

## Success metrics (must be measurable — PAT-031)
- ≥70% of AI jobs served by the CHEAP tier without escalation.
- Escalation rate < 15% (higher = a rule is mis-tiered → Optimizer flags it).
- Measured $/month AI spend flat or down while total AI job count rises.
- No business-data job ever routed to an untrusted provider.

## Build order
A) `routeAI` + Gemini adapter + registry/routes config + `Ops_Telemetry` logging → test on the note-parse path.
B) Wrap the existing Claude calls to go through `routeAI`; add the escalation path.
C) Back-fill `Human_Corrected` from Hub edits. → update FEATURE_LOG + BACKLOG (B-127) + push.

## Decisions resolved (Brett, July 22) — no open questions; ready to build
1. **Policy:** cheapest-that-passes by default; highest-quality (Claude) forced for anything customer-facing or money-facing. ✅
2. **Providers:** Gemini + Claude only. ✅
