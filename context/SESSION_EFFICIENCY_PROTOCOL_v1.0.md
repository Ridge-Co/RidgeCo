# Session Efficiency Protocol v1.0 — LOCKED Aug 13, 2026 (Aug 22 addendum: Rule 2 tie-in + new Rule 7)

**✅ ALWAYS-LOAD.** The standing rules that keep Brett's Cowork **session burn** (daily / 5-hour /
weekly limits) low **without losing quality**. This is the "how to spend tokens" layer; `brett-flow`
is the "how to do the work" layer; `brett-context` is the "who/what" layer. When any of them conflict
on *loading*, this doc wins. It never overrides a PAT or a correctness rule.

**Why this exists (Brett, Aug 13):** Brett was hitting his subscription limits regularly. Root cause
is not "chats too long" by itself — it's **heavy context × many turns**. Every turn re-processes the
whole conversation plus everything loaded. A full brett-context load is 100k+ tokens *before the first
word*; run that across a 25-turn chat and the 5-hour limit is gone. The fix is: **load light, delegate
heavy reads, and break at phase boundaries — not at random.**

---

## Rule 1 — LIGHT LOAD IS THE DEFAULT (supersedes brett-context Step 2's "read every file")

On session start, **classify the task first** (Rule 4), then load only what that task needs.

- **Minimal always-set (read every session, small + cheap):** `CURRENT.md`, `Brett_Context_Document`
  (PATs + stack), `Brett_Cowork_Best_Practices`, this file, `CREDENTIALS_MAP`, `VENTURES`,
  `FEATURE_LOG`, and the private `00_INDEX.md`. **Grep-only**, never full-read: `BACKLOG` and
  `CAPTURE_INBOX` (read their top Quick-Index block; open a full entry only when the task cites it).
- **Everything else is on-demand and task-scoped.** Read the ONE venture brief in play — not all ten.
  Touch `HANDWRITING_KEY` only for handwriting photos, the repair playbook only for a physical
  diagnosis, `business_map` / `theme_map` / the Gemini archive only to trace a specific `(#N)` citation,
  a build brief (MODEL_ROUTING, TELEMETRY, etc.) only when building that thing.
- **Never full-read a big file to grab one fact.** Grep it, or send a subagent (Rule 2).

> This is the single biggest lever. It cuts the fixed per-session cost ~50–70% on most tasks.

## Rule 2 — DELEGATE HEAVY / MECHANICAL WORK TO CHEAPER SUBAGENTS (Brett's "automate the model")

When a task needs a lot of reading, searching, or grunt work, **spawn a subagent** to do it in its own
context and return only the conclusion — the 17KB read happens off the main thread; you get back ~15
lines. Use the cheapest agent/model that fits the job:

- **Mechanical read / search / fact-extraction** → `Explore` or a cheap-model subagent. ("Read
  fleet-vehicles.md, return only the VIN→plate→holder table.")
- **Reasoning / review / drafting that must be right** → keep on the main (strong) model, or a
  `general-purpose` / `engineering:code-review` subagent.
- **This is seamless by design:** Brett does not pick the model. Claude routes by task weight. Brett
  trades ~30–60s of latency for a large drop in main-thread burn — his stated preference.
- **Skip the subagent for Rule 4's "Quick answer" mode (added Aug 22).** A subagent only nets savings
  because it keeps a big raw read out of the main thread across *many future turns* — it pays its own
  fixed overhead (its own system prompt + tools + memory copies) up front. For a one-shot lookup where
  the answer ends the ask, there are no future turns to recoup that overhead on, so grep/read inline
  instead (Rule 4 already says this — "Quick answer → nothing beyond always-set, grep the one fact").
  Every other mode (Build/Debug/Research/Capture/Draft) correctly assumes real turns remain, so keep
  delegating there. Don't try to predict "is this session ending soon" as a general judgment call —
  guessing wrong that direction (skip delegating, then the session runs long anyway) is far more
  expensive than guessing wrong the other way (delegate, session ends, small fixed overhead wasted).
  Rule 4's mode classification already draws this line; this just makes the connection explicit.

## Rule 3 — CHECKPOINT-AND-RESUME (the "prompt me to start a new chat" mechanism)

Long chats get expensive because history compounds. Self-monitor context weight. **At a checkpoint —
roughly every ~15–20 substantive turns, or at any natural phase boundary in a multi-phase build — STOP
and offer the handoff**, in this exact shape:

> 🔴 **CHECKPOINT.** We're getting heavy. I've saved state to `context/SESSION_STATE.md`
> (or a CAP entry). **Open a NEW chat and paste:** `resume ridgeco` + your next ask. The new chat
> loads only that handoff (~2–3k tokens), not this whole transcript.

- The handoff note = where we are, what's done, the exact next step, and any file/line the next phase
  touches. Keep it to ~2–3k tokens.
- **The resume code word is `resume ridgeco`.** For a specific multi-phase build, use
  `resume <thing>` (e.g. `resume b127`) and name the state file in the checkpoint.
- **Nuance that matters:** do NOT churn to a new chat *mid-task*. Within one continuous chat, repeated
  context is cached and cheap to re-read; a brand-new chat re-pays the full load. Break at **phase
  boundaries**, not randomly. Fewer, cleaner breaks beat many small ones.

## Rule 4 — CLASSIFY BEFORE LOADING (the front-end "read the prompt, pick the approach" step)

Before loading anything beyond the minimal always-set, read Brett's first message and classify it
(this is `brett-flow` Step 0 — run it every time):

| Mode | Looks like | Load beyond always-set |
|---|---|---|
| **Quick answer** | "quick: what's the QB realm ID?" | Nothing — grep the one fact. |
| **Build** | "add X to the Hub", "change worker.js" | The file(s) you'll edit + the one venture brief. |
| **Debug** | a stack trace, "invoice 500s" | FEATURE_LOG regression rows + the failing file. |
| **Research** | "compare X", "current docs for Y" | Web + subagents; little of the repo. |
| **Capture** | photo of a note, brain-dump | CAPTURE + BACKLOG (grep) + HANDWRITING_KEY if handwritten. |
| **Draft/comms** | tenant/vendor letter, estimate | personal-mindset (voice) + venture brief + my-writing-style. |

Brett may prefix a one-word hint (`quick:`, `build:`, `debug:`) — honor it. If he doesn't, classify
from the message. Either way, **a one-line lookup must not pull in 100k of context.**

## Rule 5 — BRETT'S OWN HABITS THAT SAVE THE MOST (behavioral, no quality cost)

1. **PAT + `load context` + the ask in ONE message is correct** — keep doing it. Order inside the
   message is irrelevant to tokens; splitting into two messages is slightly *worse* (an extra
   round-trip). No change needed.
2. **Front-load the whole task.** Dribbling ("do X" … "now Y" … "also Z") re-processes the chat each
   turn. State all known asks in the first message → fewer, cheaper turns.
3. **Start a NEW chat per new issue** — don't tangent into a related-but-separate problem inside a
   chat that's already heavy. Checkpoint the current one first (Rule 3).
4. **Prefix quick lookups** so Claude skips the heavy load (Rule 4).
5. **Rotate the PAT** Brett keeps pasting into chat (standing CREDENTIALS_MAP rule — the pasted token
   is exposed in the transcript).

## Rule 6 — MEASURE IT (so we know it worked)

The B-128 telemetry spine can log Cowork sessions (`POST /telemetry/log`, dual-source). Once
`brett-flow` session-close posts a row per session, track average tokens/session before vs. after this
protocol. Target: **materially lower tokens/session with no drop in "done-and-correct" rate.** If a
mode is still heavy, tighten its row in Rule 4.

## Rule 7 — SCHEDULED TASKS: COST = TOKENS-PER-FIRE × FIRES-PER-DAY, NOT CACHE TTL (added Aug 22)

Every `create_trigger` scheduled task starts a **fresh session on each fire** — it is never a resumed
conversation. That changes the math from a normal chat: there is no warm cache to hit *or* miss between
fires (a fresh session has nothing to hit yet), so the lever isn't "does this fire often enough to stay
inside the cache window" — it's simply **how much context each fresh fire loads, times how many times a
day it fires.** Two things follow:

- **Keep fresh-fire prompts lean on purpose.** Most of Brett's scheduled tasks already do this right —
  the Inspection Watchers and invoice-intake watchers inline everything they need in the prompt itself
  and explicitly skip the `brett-context` skill (a scheduled session has no PAT anyway). Anything that
  DOES invoke `brett-context` on every fire should only do so if it truly needs the full picture; this
  protocol's own light-load rules (1 and 4) apply to a scheduled fire exactly as they do to Brett typing
  in chat.
- **Audit cadence against actual need, not habit.** A task firing every 30 minutes around the clock costs
  2x what an hourly one does with zero code changes — pure fire-count. Aug 22 pass found two worth
  trimming: **"Inspection Watcher (:30)"** duplicated **"Inspection Watcher (:00)"** at a 30-min offset
  (24 fresh sessions/day combined for a task where hourly latency is plainly fine) — disabled the `:30`
  one, halving it to 12/day with no coverage loss. **"BrettOS Context Update Reminder"** fired every 4
  hours (6x/day) invoking `brett-context` each time — cut to 3x/day (mid-morning / afternoon / evening
  ET) since same-day work doesn't need overnight checking. Re-run this check whenever a new scheduled
  task is added or one's prompt changes.

**Aug 22 addendum, for the record:** this session also confirmed the connectors used to check for
"deferred" tool-loading (a `/context`-equivalent doesn't exist for Brett in Cowork — the closest visible
signal is the tool list itself showing `deferred` entries) and found an unused ClickUp connector, whose
Cabin-relevant content was captured to CAPTURE_INBOX.md (CAP-031) before disconnect rather than lost.

---

### Relationship to B-127 (separate meter — do not confuse)
This protocol governs **Brett's Cowork session limits** (the daily/5-hour/weekly caps he hits).
**B-127** (`MODEL_ROUTING_BUILD_BRIEF_v1.0`) governs the **app's runtime AI API bill** (Worker calls:
receipt parse, note extract, comms drafts) — cheap Gemini by default, escalate to Claude, customer/
money-facing pinned to Claude. Both are "automate the model by efficiency"; they operate on different
budgets. This protocol = sessions. B-127 = the app.
