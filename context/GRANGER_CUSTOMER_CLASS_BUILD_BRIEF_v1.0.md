# GRANGER CUSTOMER CLASS — SMS/email work-order intake, expected-price estimates, auto deposit, call screening
**Version:** v1.0 (design) · **Date:** Oct 13, 2026 · **Status:** DESIGN — nothing built yet · **Owner decisions:** Brett (Oct 13 chat)
**Placeholder name:** "Granger" = a new property-management company (many owners, one billing customer). Real name, phones, emails, addresses are filled in later; the build ships as a skeleton with those fields blank.

## 0. What already exists (verified in the repo at main `22f91ee`, BUILD_VERSION 2026-10-13.7)
- `POST /intake/email` + `intakeEmail()` + `Intake_Queue` (PR #215, merged): parse → strict property match → `createWorkOrder` → read-back → admin SMS → park anything uncertain. Buildium-specific parser/sender check (`intakeSenderOk`); Granger needs its own sender profile.
- `POST /sms-inbound` + `handleInboundSMS()`: **vendor YES/NO replies only**. Anything from a non-vendor number gets "could not find your vendor record". It is the only inbound-SMS code; the Twilio webhook for the current number is one-way by registration.
- `sendSMS` (global kill switch `TWILIO_ENABLED`, quiet-hours) and `smsGatedSend` (gated templated sends). All SMS goes through these.
- QuickBooks: `qbCreateSubCustomer` already nests Property under Owner (parent = owner's `QBO_Customer_ID`). So: **Granger = one Owners row (the QB parent); every address = a Properties row = a QB sub-customer.** No new QB model needed.
- Pricing: `calcTieredEstimate(rawCost, pc)`; live config = tiers `[[1000,0.35,50],[2000,0.30,0],[null,0.25,0]]`, `adminFee 85` (applies at cost ≥ `adminFeeThreshold` 3000), `cardFeeMult 1.05`, `roundTo 5`. Default deposit = `finalPrice / 2`.
- Estimates: `Estimates` tab (versions), `addEstimateVersion`, `approveEstimate` (Brett approves a vendor estimate, vendor is texted), `setApprovalStage`, vendor Spanish→English (`desc_en`).
- Invoice UI: **pass-through is the DEFAULT mode** (`_invMode[k] || 'passthrough'`, index.html ~8923). That is the exact trap Brett wants closed for this customer.
- Scheduler: Apps Script only. **No cron, ever.**

## 1. Decisions locked (Brett, Oct 13)
1. Customer class ("Granger class") is a **reusable profile/template**, attached per customer; other customers unaffected. Edit the profile once, all customers on it change.
2. One QB customer (the PM company), one sub-customer per address. Capture the customer's own WO/PO/reference number on the WO and **print it on the invoice**.
3. Allowlisted phone numbers and email senders only. Unknown number texting an address → **create the property immediately, flag it "needs review", SMS Brett**.
4. Brett assigns vendors for now (Hub suggests; routing/recommended-vendor comes later).
5. **Expected-price flow:** Brett sets an expected price E per job (typed; no price database yet, but we log every E/V/final so averages can be built later). Customer approves E by texting APPROVED from an allowlisted number. Vendor gets a lower **vendor guide price** (never E), told it is a baseline, not a cap — they must justify going above it with a good description.
6. Vendor submits price V → Hub computes M = tiered(V). Rules:
   - **M ≤ E → send the customer E** (no extra approval; they already approved E). Customer-facing price stays E, vendor payable stays V. Deposit is based on E. The spread is margin.
   - **M above E, within tolerance → send an "updated price M" text; customer must reply APPROVED again.**
   - **M above E by more than tolerance → HOLD, text Brett with the vendor's reason** (not a hard stop; Brett one-taps: send as is / send revised / ask vendor). Vendor must give a reason (required field) before it can even enter this state.
   - No price cap otherwise.
7. Markup profile: existing tiers 35/30/25, $50 minimum, 5% card-fee multiplier, **$85 admin fee removed** (profile `adminFee: 0`). **Pass-through is never allowed** for this class (guarded server-side, not just hidden).
8. Texts go out as **Riley**, introducing as Brett's assistant. Customer approves with the word **APPROVED**.
9. If a deposit is required: on APPROVED, **create the deposit invoice automatically, email it, and text "we've sent you the invoice for the deposit on [address]"** — no Review Bills step. Brett's explicit authorization for this class: given Oct 13 (pending his final confirm of the wording in §6).
10. Intake chat answers this customer **after 8pm too**. Vendor texts keep quiet hours.
11. Vendor Spanish → AI English scope may go to the customer for now.
12. One new 410 number, SMS + voice. Not two. (Reasons: campaign is per use case not per number; Hub identifies senders by phone; a second number only when vendor traffic needs separating or a second customer line.)
13. W-9 + COI: calendar reminder Wed Oct 14 9:00am (done).

## 2. Data model (all additive; `ensureColumns`, never `ensureTab` on a live sheet)
- **New tab `Customer_Profiles`**: `ID, Name, Class, Pricing_Mode ('tiered_only'), Admin_Fee_Override (0), Block_Pass_Through (TRUE), Expected_Price_Required (TRUE), Estimate_Tolerance_Pct (10), Estimate_Tolerance_Min_Dollars (100), Auto_Send_Final (TRUE), Auto_Deposit_Invoice (TRUE), Deposit_Pct (50), After_Hours_Replies (TRUE), Approve_Word ('APPROVED'), Active`.
- **Owners** + `Customer_Profile_ID`. Allowlist lives in a separate **`Customer_Contacts`** tab: `ID, Owner_ID, Name, Phone, Email, Can_Approve, Active` — so Brett can add/remove one person without editing a list.
- **Work_Orders** + `Customer_Ref` (their WO/PO #), `Expected_Price`, `Vendor_Guide_Price`, `Customer_Price`, `Pricing_Basis`, `Source` (already exists), `Needs_Review`, `Intake_Channel` ('sms'|'email'|'call').
- **Estimates** + `Vendor_Price`, `Marked_Up_Price`, `Expected_Price`, `Outcome` ('within_expected'|'updated_needs_approval'|'held'), `Over_Reason`.
- **New tab `Customer_Approvals`**: `ID, WO_ID, Estimate_ID, Estimate_Version, Phone, Message_SID, Inbound_Text, Matched_At, Deposit_Invoice_ID` — **idempotency key = Estimate_ID + Version**, so a double APPROVED cannot make two invoices.
- **New tab `Price_History`**: `ID, WO_ID, Task_Type (free text), Expected, Vendor_Guide, Vendor_Price, Marked_Up, Customer_Price, Date` — the seed for the average/minimum price database. Capture only now.
- **New tabs `Call_Log` / `Call_Blocklist`** (phase 3).

## 3. Pricing algorithm (pure functions, unit-tested; mirror in index.html like `calcTieredEstimate`)
```
profilePC = {...livePC, adminFee: 0}                    // $85 removed for this class
M  = calcTieredEstimate(V, profilePC).finalPrice
vendorGuide(E) = max V (step $5) such that M(V) <= E    // Hub SUGGESTS; Brett may type lower
if M <= E:               customerPrice = E ; send "confirmed"
elif M <= E*(1+tol) or (M-E) <= tolMinDollars:   customerPrice = M ; send "updated", needs APPROVED
else:                    HOLD -> SMS Brett with Over_Reason
deposit = customerPrice * Deposit_Pct/100 (only when deposit flagged on WO)
vendorPayable = V   // never changes because customerPrice changed
```
Worked with live tiers (admin 0, ×1.05, round up to $5; verified by running the formula):
| E (told customer) | V (vendor) | M = tiered(V) | Outcome | Customer price | Deposit @50% |
|---|---|---|---|---|---|
| 400 | 250 | 355 | within | **400** | 200 |
| 400 | 300 | 430 | +7.5%, updated, re-approve | 430 | 215 |
| 400 | 400 | 570 | +42%, HOLD + reason | — | — |
| 4000 | 2500 | **3285** (Brett's 3,500 was illustrative) | within | **4000** | 2000 |

`vendorGuide(400)` = 280 (V=285 gives 405). Brett said "say $250" — Hub suggests 280 as the ceiling; he types whatever he wants.

**Wording rule:** the customer text must state the quoted price as the job price ("$4,000 for ..."), never "up to" or "estimate", because we bill E even when the vendor comes in lower. Honest and consistent with what they approved.

## 4. Guardrails (the "never silent, never double, never leak" list)
- Sender must be in `Customer_Contacts` (Can_Approve for APPROVED). Unknown sender: reply with a polite generic line, log, SMS Brett. **An allowlisted customer number can never be blocked** (allowlist check runs before blocklist).
- APPROVED must match exactly one outstanding estimate for that sender; ambiguous → one clarifying question, no action.
- Deposit invoice is created once per Estimate_ID+Version (read the `Customer_Approvals` row first; QB create only if absent; write the row after). Failed QB call → SMS Brett, row marked failed, never retried blindly.
- Server-side pass-through block: for a profile with `Block_Pass_Through`, `approveInvoiceReview` / `qbSendInvoice` refuse any customer charge below the tiered price for the bill's cost (admin override requires an explicit flag + audit row).
- Vendor never sees E, M, or customer price. Customer never sees V. Vendor→customer messages containing `$` or price words are held (phase 4).
- Prompt-injection: intake chat is a **parser with a fixed tool surface** (create WO draft, ask a question, flag). It never takes instructions from message text, never reveals other customers' data, never changes prices.
- Every path writes `Ops_Telemetry` + a queue/log row; every failure SMS's Brett (rule: nothing fails silently).
- Replies from Riley to this customer after 8pm are allowed; all vendor/tenant texts keep quiet hours.

## 5. Phases
**Phase 1 — before the first job (no campaign needed except where noted)**
1. `Customer_Profiles` + `Customer_Contacts` + Owner "Granger" skeleton (blank phones/emails).
2. Email intake: Granger sender profile on `/intake/email` (parser = generic: address, description, their ref number; ambiguous → park).
3. Inbound SMS from allowlisted numbers: log, match, text Brett instantly, create a **draft WO needing review** (no AI yet). Unknown number + address → auto-create property flagged.
4. Expected-price field + vendor guide price on dispatch; vendor price entry; the §3 pricing function; outcome routing.
5. Pass-through block + default mode `tiered` for the class; print customer ref on invoice.
6. Customer-facing estimate/confirmation by **email** until the campaign clears.

**Phase 2 — once the two-way campaign is approved**
7. AI intake chat (asks one question at a time: address, unit, issue, access, urgency), Riley persona, after-hours enabled.
8. Customer estimate/confirmation texts, APPROVED handling, auto deposit invoice + confirmation text (QB invoice with `EmailStatus: NeedToSend`).

**Phase 3 — calls**
9. Voicemail + alert; menu (1 emergency, 2 rental inquiries, 3 leave a message); emergency ring-through; allowlist/blocklist screening; repeat-caller escalation.
10. Live AI voice agent only as the fallback.

**Phase 4:** vendor↔customer job-thread relay with `$` scrubbing; recommended vendor / auto-routing; price database from `Price_History`.

## 6. Autonomy-guardrail addendum (needs Brett's explicit OK before Phase 2 ships)
Draft wording: *"For customers whose profile has `Auto_Deposit_Invoice=TRUE`, the Hub may, without per-item review, (a) create and email one deposit invoice per customer-approved estimate version, and (b) text the customer that it was sent. It may not apply payment, void, or edit any invoice. Any failure pauses the action and texts Brett."* This is a narrower slice of B-236.

## 7. Calls: cost and screening (researched Oct 13)
- Twilio ConversationRelay is **$0.07/min**; inbound local voice ~$0.0085/min; speech/TTS and the LLM are billed on top (sources: twilio.com conversational-AI pricing; superdupr.com Twilio 2026 pricing). My estimate: **~$0.09–0.15/min all-in, so a 3-minute AI call ≈ $0.30–0.45; 100 such calls/month ≈ $30–45.** A paid answering center bills per call or per minute whether or not the caller needed a human, which is the leak Brett described.
- Cheapest path first: IVR/voicemail/SMS-link flows cost ~ the inbound minute only.
- Screening: Twilio Lookup gives line type and SMS-pumping risk (paid per request); it has **no spam-caller score**. So screening is **allowlist-first + our own blocklist**: known numbers (customer, vendors, tenants, owners) always pass; unknown callers go through the menu; solicitation phrases in the voicemail transcript ("roofing", "preferred vendor", "bid") flag the number and Brett taps BLOCK; blocked numbers hear a short message and never ring/alert. Leasing callers get the website link by text and the call ends. Repeat unknown callers (3+ in 24h without resolution) escalate to Brett / the AI agent.
- **Maryland is an all-party-consent state for recording**: greeting must disclose recording, or we keep transcripts only.
- Emergency words (gas, fire, flood, no heat) → ring Brett first; gas/fire: caller is told to call 911 as well.

## 8. Test plan (all on staging with `TEST-` records; nothing touches prod data)
Unit: pricing function table above incl. rounding/min-markup edges; guide inverse; tolerance edges; pass-through guard; idempotency. Staging API: allowlisted vs unknown sender; duplicate APPROVED; ambiguous APPROVED; deposit invoice failure path (QB sandbox stub); property auto-create + dup check; email intake dedupe. UI: Playwright on the expected-price dialog, vendor price entry, held-estimate card. Adversarial `ridgeco-validate` pass before any PR; money + customer-send paths ship as PRs for Brett's merge.

## 9. Still open (defaults in brackets; none block Phase 1)
- Tolerance for "slightly over E" [10% or $100, editable per profile].
- Customer deposit = 50% of the customer price; vendor deposit, if any, stays on the vendor's V [confirm].
- When the Granger real name/phones/emails/addresses arrive: fill the skeleton.
- Whether the invoice line shows the approved dollar basis, or just the job description [description only].
