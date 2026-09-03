# Scope Proposal → Automatic Invoice Lifecycle — Build Brief v1.0

Status: **brief only, nothing implemented.** Captured Sep 2 2026, same session as rules 142
(manual price override) and 143 (final-balance booking) and CAP-034 (one-page consolidation).
This is a bigger, higher-risk build than either of those — it's the first place in this codebase
where a QuickBooks invoice gets created/edited/voided **without a human clicking Confirm on that
specific action**. Write-up first, code second, same as `STAGING_DEPLOY_GATE_BUILD_BRIEF_v1.0.md`
and `EMAIL_INTAKE_BUILD_BRIEF_v1.0.md` did for their own money/infra-adjacent builds.

## What Brett asked for (verbatim, Sep 2 2026)
"I want to add generating the invoice and taking the customer directly to the invoice once they
have signed. this will require generating the invoice and pushing to QB without manual
intervention (bypass any of my rules about this because we are generating an invoice and not
paying an invoice). the invoice can be created when the estimate is created. but then we need to
be able to change that invoice if the estimate changes (negotiation before signature) and
void/delete it if the job is canceled or customer refuses etc. I want an end to end system so that
once we send an estimate if the customer signs they go directly to payment. if it's too complex to
redirect them to the invoice link we can display the payment link on the screen on the next page
with instructions to pay the deposit invoice to start work/scheduling."

## Autonomy note — this is Brett's call, not a bypass of anything Anthropic-side
`AUTONOMY_GUARDRAILS_v1.0` currently treats every QuickBooks write as Rung 3 — gated, never
autonomous, always a specific human click on that specific action (see rule 123/143's whole
preview→confirm pattern). Brett is explicitly carving out ONE exception to his own rule: creating,
updating, and voiding an invoice may happen automatically; **paying** one (and everything else
Rung 3 already covers — vendor bills, `/qb/pay-bills`, combined-invoice sends) stays exactly as
gated as it is today. This brief treats that carve-out as settled — it's Brett amending his own
guardrails doc for his own business, not a request to relax anything Anthropic-imposed. The actual
`AUTONOMY_GUARDRAILS_v1.0.md` file should get a short explicit addendum recording this the same
session code actually ships, so a future session doesn't need to re-litigate it or, worse, assume
it also covers vendor-bill/payment writes (it doesn't).

## What's technically true about QuickBooks Online's API here (verified this session, not assumed)
- **No real "draft" invoice state.** Every invoice created via the Accounting API is a live,
  real transaction the moment `POST invoice` succeeds — same as every invoice this codebase
  already creates. There's no QBO-side "not real yet" flag.
- **Creating an invoice does NOT email the customer.** Sending is a separate, explicit operation
  (`POST invoice/{id}/send`) — this codebase already knows this distinction (see the whole
  `EmailStatus: 'NeedToSend'` bug documented elsewhere this session's memory: an invoice existing
  in QuickBooks and an invoice actually being sent are two different facts). So an invoice can
  exist, silently, before the customer ever sees a link — which is exactly the "create it when the
  estimate is created" behavior Brett wants, with no premature customer-facing side effect.
- **Editing:** QBO uses **sparse update** — same `POST invoice` endpoint, but the body carries the
  invoice's `Id` and current `SyncToken` (optimistic-locking version number) plus only the fields
  that changed; QuickBooks applies the delta and returns a new `SyncToken`. Every write after the
  first MUST carry the latest `SyncToken` or QuickBooks rejects it — the Hub will need to persist
  `SyncToken` alongside `Invoice_ID` and re-fetch it if a write is ever rejected as stale (e.g. if
  Brett hand-edited the same invoice directly in QuickBooks in between).
- **Voiding:** QBO has a real `Void` operation purpose-built for exactly Brett's "customer refuses
  / job canceled" case — it zeroes the invoice out but keeps it in the ledger/audit trail (as
  opposed to a hard delete, which QuickBooks generally only allows same-day on a transaction
  nothing else references, and which erases the record rather than marking it voided). **Void is
  the right default here**, not delete — it matches how Brett already treats bookkeeping elsewhere
  in this codebase (e.g. the receipt-reconciler's "keep confirmed duplicates forever, no
  auto-purge" decision from this same session, and the standing "QuickBooks 'viewed' status is
  unreliable, trust EmailStatus" learning — Brett's pattern is consistently to keep the real record
  and layer clearer status on top of it, not delete history).
- **The direct-to-payment redirect Brett wants is a real, documented QBO feature**, not something
  that needs a workaround: fetching the invoice with `?include=invoiceLink` (minor version 36+;
  this codebase is already on 73 everywhere) returns `Invoice.InvoiceLink` — a
  `connect.intuit.com/portal/app/CommerceNetwork/...` URL that opens QuickBooks' own hosted
  payment page for that specific invoice, **no QuickBooks login required**, the same URL a
  customer gets when QuickBooks emails them an invoice normally. This means the "redirect them
  straight to payment" version is fully achievable — no need to fall back to the "display the link
  with instructions" version as a compromise, though that fallback is still worth building as a
  defensive path (see below) in case the `invoiceLink` fetch ever fails.

## Proposed lifecycle (draft — needs Brett's confirmation on the open questions before this
becomes the actual implementation plan)

```
scope created → line items priced (incl. rule 142 overrides) → PROPOSAL GENERATED
                                                                        │
                                                          (1) DRAFT INVOICE CREATED
                                                          deposit amount, no BillEmail yet
                                                          Invoice_ID + SyncToken saved on Scopes
                                                                        │
                    pricing edited before signing ──► (2) SPARSE-UPDATE the same invoice
                    (still the SAME QBO invoice — never a second one)
                                                                        │
                                              ┌─────────────────────────┴─────────────────────────┐
                                       customer SIGNS                                    job CANCELED /
                                              │                                        customer REFUSES
                                  (3) fetch invoiceLink,                                       │
                                  return to scope-proposal.html,                    (4) VOID the invoice
                                  redirect/display "pay to start" screen             (Scopes.Status → cancelled)
```

- **(1) Creation trigger** — Brett's own words: "the invoice can be created when the estimate is
  created." Cleanest read: fire this inside the EXISTING `/scope/proposal` handler
  (`scopeProposal()`, worker.js), right after `scopeItemsPricing` computes `priced.deposit` — same
  moment `Proposal_Items_JSON`/`Proposal_Text` already get written. One new helper,
  `scopeDraftInvoiceUpsert(env, s, priced)`, called from there.
- **New Scopes columns** (additive, `ensureColumns`, rule 37 pattern): `Draft_Invoice_ID`,
  `Draft_Invoice_SyncToken`, `Draft_Invoice_Number`. Lives on **Scopes**, not `Scope_Signatures` —
  a signature record doesn't exist yet at this point in the lifecycle (it's only created at the
  moment of signing), so the draft invoice has to be tracked on the record that DOES exist that
  early, which is the Scope itself.
- **(2) Edit trigger** — every subsequent `/scope/proposal` regeneration (Brett changes an item, a
  price override, adds/removes a line) reuses the SAME upsert helper: if `Draft_Invoice_ID` is
  already set, sparse-update it instead of creating a second invoice. This is the piece that
  answers "we need to be able to change that invoice if the estimate changes" directly.
- **(3) Sign trigger** — `scopeProposalSign()` (already exists, worker.js) gets one addition after
  it writes the `Scope_Signatures` row: fetch the draft invoice with `?include=invoiceLink`,
  return `invoice_link` in the sign response. `scope-proposal.html`'s post-sign confirmation screen
  redirects to it (or, if the fetch fails for any reason, falls back to displaying the link as
  text with "pay this deposit invoice to start work/scheduling" — Brett's own explicitly-named
  fallback). **This does NOT replace `scopeProposalBook`** (rule 123/deposit booking) — the
  deposit invoice from step (1) already IS the thing `scopeProposalBook` currently creates; once
  this ships, `scopeProposalBook`'s job shrinks to "confirm/finalize the already-existing draft
  invoice, mark it booked" rather than creating a brand new one. Needs a real look at whether
  `scopeProposalBook` gets simplified or left as an idempotent no-op safety net — open question
  below.
- **(4) Cancel trigger** — needs a NEW action entirely; nothing in the current Scopes status enum
  represents "customer declined" or "job canceled" at all (confirmed — grepped the live code, no
  such status exists anywhere). Proposed: a new `POST /scope/cancel` endpoint, admin-gated
  (canceling is still Brett's call, not automatic), that Voids `Draft_Invoice_ID` if set and sets
  `Scopes.Status = 'cancelled'`. This is the one piece of the lifecycle that stays a manual click —
  matches Brett's own phrasing ("void/delete it if the job is canceled **or customer refuses**")
  which is Brett learning that outcome and acting on it, not something the system detects on its
  own.

## Open questions — need Brett's answers before this gets built
1. **Does the draft invoice get a `BillEmail` set from the start**, or only once signed? Setting
   it early doesn't cause an auto-send (confirmed above), but it does mean the invoice already has
   a real customer attached from the moment it's created — worth confirming that's fine rather
   than something to withhold until signing.
2. **What happens to `scopeProposalBook` (rule 123)?** Once step (1)/(2) exist, has it become
   fully redundant (the draft invoice already IS the deposit invoice) or does it stay as the
   explicit "confirm this is really final" click before a proposal counts as booked? Leaning
   toward: keep it, but change its job from "create" to "verify + mark Booked" — needs Brett's
   call, not guessed.
3. **Multi-edit safety**: if Brett regenerates the proposal several times before the customer
   signs, each regeneration is a sparse update carrying the latest `SyncToken` — fine as long as
   nothing else touches that invoice in between. Is there any workflow where Brett might also
   hand-edit the same invoice directly in QuickBooks before signing? If so the Hub needs to
   re-fetch `SyncToken` on a rejected write rather than assuming its stored copy is current.
4. **Final-balance invoice (rule 143)** — should IT also get created as a draft automatically (at
   $0 or unset until the job's actually done), or does it stay the fully manual
   "Job done → invoice final balance" click that rule 143 just built? Nothing in Brett's message
   asked for automating the final half — this brief assumes rule 143 stays manual as-is unless
   told otherwise.
5. **What exactly triggers "customer refuses"** in Brett's own workflow — does he always know
   this by some explicit signal (a call, a text, a link that visibly expired without signing), or
   does this need a customer-facing "decline" action on `scope-proposal.html` itself (a button the
   customer can click, distinct from Brett noticing and canceling it himself)? The brief above
   only covers Brett-initiated cancellation; a customer-initiated decline would need its own
   (PUBLIC, token-gated like `scopeProposalSign`) endpoint.
6. **AUTONOMY_GUARDRAILS_v1.0.md addendum wording** — this brief proposes the carve-out language
   above; worth Brett reading and confirming it says exactly what he means (invoice
   create/update/void only, nothing about payment) before it goes in as a standing rule for every
   future session.

## Explicitly out of scope for this build
- Anything about `/qb/pay-bills`, vendor bills, or combined-invoice sends — all of that stays
  exactly as gated as `AUTONOMY_GUARDRAILS_v1.0` already has it.
- The final-balance invoice (rule 143) automation — see open question 4.
- The one-page consolidation (CAP-034) — related surface, separate design pass, shouldn't be
  bundled into this build; do this brief's build first since it changes what signed-proposals.html
  even needs to do, then revisit CAP-034 once both rule 142/143 AND this are live and verified.

## Next step
Brett answers the open questions above (can be quick — most are single-choice), then a future
session implements: the new Scopes columns, `scopeDraftInvoiceUpsert`, the `/scope/proposal` and
`scopeProposalSign` wiring, the new `/scope/cancel` endpoint, the `scope-proposal.html` redirect +
fallback screen, and the `AUTONOMY_GUARDRAILS_v1.0.md` addendum — with the same preview-first
discipline as everything else in this codebase for the pieces that stay manual (cancel), and full
`test-verified-builds`/`ridgeco-validate` treatment before anything touches `main` given this is
the first-ever unattended QuickBooks write path in the Hub.
