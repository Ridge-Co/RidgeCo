# Scope Proposal → Automatic Invoice Lifecycle — Build Brief v1.0

Status: **brief only, nothing implemented.** Captured Sep 2 2026, same session as rules 142
(manual price override) and 143 (final-balance booking) and CAP-034 (one-page consolidation).
This is a bigger, higher-risk build than either of those — it's the first place in this codebase
where a QuickBooks invoice gets created/edited/voided **without a human clicking Confirm on that
specific action**. Write-up first, code second, same as `STAGING_DEPLOY_GATE_BUILD_BRIEF_v1.0.md`
and `EMAIL_INTAKE_BUILD_BRIEF_v1.0.md` did for their own money/infra-adjacent builds.

## Decisions locked (Brett, Sep 2 2026 follow-up)
1. **Draft invoice DOES get the customer's email attached from creation** — not held back until
   signing. Doesn't cause an early send (QuickBooks only emails on an explicit send action), just
   means the invoice looks fully attached to a customer from the moment it exists rather than
   "still being drafted."
2. **`scopeProposalBook` (rule 123's deposit-booking button) becomes fully redundant** once this
   ships — the draft invoice created at estimate time already IS the deposit invoice by the time
   signing happens. `signed-proposals.html`'s deposit-side UI goes away entirely (not simplified,
   removed) once this build is live and verified.
3. **No SyncToken-staleness handling needed** — Brett confirmed there's no workflow where he'd
   hand-edit the same invoice directly in QuickBooks before signing ("if the system works
   correctly there would be no need"). Simplifies the implementation: no re-fetch-on-conflict
   logic required, just persist and reuse the SyncToken normally.
4. **Final-balance invoicing (rule 143) stays a manual "job done" trigger, NOT automated** — but
   Brett wants it **better organized**, specifically: a view on the Hub showing jobs where the
   deposit has been paid (not just invoiced — actually paid), prompting review of which open jobs
   are ready for their final invoice. Rule 143's current button (buried in `signed-proposals.html`,
   only visible per-row once you're already looking at that specific signature) doesn't surface
   this proactively — it requires already knowing to go look. See **new section below**.
5. **Customer-facing decline button — confirmed, build it.** See **new section below**.
6. **AUTONOMY_GUARDRAILS_v1.0 addendum wording** — Brett wants to read it before it's added.
   Drafted below, not yet applied to the actual file.

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

## New: "Deposit paid — ready for final invoice" queue (answers decision #4 above)
Rule 143 built the ABILITY to book a final invoice but not a way to know WHICH jobs are ready for
one — Brett has to already be looking at a specific signed-proposal row to see the button. What's
needed instead is a proactive list, most naturally a new section on whatever page ends up owning
the booked-proposal view (today `signed-proposals.html`; after CAP-034's consolidation, wherever
that lands):
- **Filter condition:** deposit invoice's QuickBooks payment status is actually **Paid** (not
  merely "invoiced, sitting open") — this needs a real QB payment-status check, the same kind of
  check `qbPayables`/`GET /qb/payables` already does elsewhere in this codebase (see
  `ridgeco-who-to-pay-unknown-no-vendor.md`'s notes on how that state gets read), not just "does
  `QB_Invoice_ID` exist." A deposit invoice that's been sent but not yet paid should NOT appear
  here — the whole point is surfacing jobs Brett can actually invoice the rest of, i.e. the
  customer has already put money down.
- **AND no final invoice booked yet** (`QB_Final_Invoice_ID` blank on that `Scope_Signatures` row
  — this field already exists from rule 143).
- Renders as its own labeled section/card list — "💰 Deposit paid, ready for final invoice (N)" —
  each row jumping straight to the existing rule-143 "Job done — invoice final balance"
  preview/confirm flow, not a new booking mechanism, just a better on-ramp to the one that
  already works.
- Open detail for the future build session: does this need a poll/refresh against QuickBooks
  payment status (cost-metered, same on-demand-not-automatic convention `QUALITY_BAR_v1.0.md`
  row 9 already established for the receipt-duplicate-checker), or can it piggyback on data the
  Hub already has cached from elsewhere? Needs a look at what's actually available before this
  gets scoped further — not answered here.

## New: customer-facing decline button (answers decision #5 above)
A new button on `scope-proposal.html` itself, alongside the existing sign flow — the customer's
own explicit "no thanks" instead of relying on Brett noticing and canceling on their behalf.
- **New endpoint** `POST /scope-proposal/decline` — PUBLIC, token-gated with the SAME link token
  `scopeProposalView`/`scopeProposalSign` already use (identical auth pattern to
  `scopeProposalLinkAuth`, no new token type needed).
- Voids `Scopes.Draft_Invoice_ID` if one exists (the whole reason this needs to exist server-side
  and not just be a "close the tab" no-op — an unattended-created invoice needs an unattended-safe
  way to get cleaned up when the answer is no).
- Sets `Scopes.Status = 'declined'` (distinct from Brett-initiated `'cancelled'` from the
  `/scope/cancel` endpoint below — same outcome, different origin, worth keeping visible for
  Brett's own pattern-spotting later: how often do customers actually decline vs. how often does
  Brett cancel for some other reason).
- Idempotent — re-declining an already-declined (or already-signed — can't decline after signing)
  scope returns the existing state rather than erroring or double-voiding.
- `scope-proposal.html` UI: a plain, low-emphasis "This isn't something I want to move forward
  with" link/button near the sign flow, not styled to compete with Confirm/Sign — same
  "confirm you understand this is permanent" pattern this codebase already uses for the
  `end_conversation`-style irreversible actions elsewhere (a simple "are you sure" before it
  actually calls the endpoint).

## Draft AUTONOMY_GUARDRAILS_v1.0.md addendum (Brett to read/approve before this is applied)
Proposed text, to be added as its own clearly-scoped subsection of that file once Brett confirms
the wording says exactly what he means:

> **Amendment (Sep 2 2026) — scope proposal invoice lifecycle, narrow carve-out.**
> For scope proposals specifically (`Scopes`/`Scope_Signatures`, the e-sign system from rule 123
> onward), Brett has authorized the Hub to CREATE, EDIT (sparse-update), and VOID a customer
> deposit invoice in QuickBooks **without a per-action human confirmation** — this is the one
> exception to the Rung-3 "every QuickBooks write is gated" rule elsewhere in this document.
> **This carve-out covers invoice existence only — never payment.** `/qb/pay-bills`, vendor bills,
> combined-invoice sends, and every other QuickBooks write path in this codebase remain exactly
> as gated as they were before this amendment. A future session should not read this as license
> to relax gating anywhere else without Brett saying so explicitly for that specific path, the
> same way he did here.

## Open questions still unresolved
1. **Does `scope-proposal.html` need any visible indication, pre-signature, that a real
   QuickBooks invoice already exists** (even though nothing's been sent)? Or should the
   customer-facing page look identical to how it looks today until the moment they sign — the
   invoice existing is purely a backend fact until then? Leaning toward the latter (nothing
   customer-visible changes until sign), but not explicitly said by Brett either way.
2. **Exact wording/placement of the decline button's confirmation step** — a real "are you sure"
   modal, or a lighter single-tap-with-toast-undo pattern? Minor, can be decided at build time
   rather than blocking the brief.

## Explicitly out of scope for this build
- Anything about `/qb/pay-bills`, vendor bills, or combined-invoice sends — all of that stays
  exactly as gated as `AUTONOMY_GUARDRAILS_v1.0` already has it.
- Automating the final-balance invoice itself (rule 143's booking action) — confirmed staying
  manual (decision #4 above); only the surfacing/discovery of which jobs are ready for it is new
  scope here.
- The one-page consolidation (CAP-034) — related surface, separate design pass, shouldn't be
  bundled into this build; do this brief's build first since it changes what signed-proposals.html
  even needs to do (its deposit-booking half goes away entirely per decision #2 above), then
  revisit CAP-034 once both rule 142/143 AND this are live and verified.

## Next step
Two things still block starting the actual build:
1. Brett confirms decision #1 (BillEmail attached from creation — recommended, awaiting his OK)
   and reads/approves the `AUTONOMY_GUARDRAILS_v1.0.md` addendum wording above (decision #6).
2. Once both are confirmed, a future session implements: the new `Scopes` columns,
   `scopeDraftInvoiceUpsert`, the `/scope/proposal` and `scopeProposalSign` wiring, the new
   `/scope/cancel` (Brett-initiated) and `/scope-proposal/decline` (customer-initiated) endpoints,
   the "deposit paid — ready for final invoice" queue, the `scope-proposal.html` redirect +
   fallback screen + decline button, removal of `scopeProposalBook`'s deposit-creation role from
   `signed-proposals.html`, and the actual `AUTONOMY_GUARDRAILS_v1.0.md` file edit — with the same
   preview-first discipline as everything else in this codebase for the pieces that stay manual
   (cancel, final-invoice booking), and full `test-verified-builds`/`ridgeco-validate` treatment
   before anything touches `main` given this is the first-ever unattended QuickBooks write path
   in the Hub.
