# BANK RECONCILIATION + FEE TRACKING — PLANNING BRIEF v1.0

Date: Oct 14, 2026. Status: PLANNING ONLY. Nothing here is built, and nothing here should be built until Brett says go. This is a capture of decisions and open questions so a future session starts from them instead of re-deriving them.

This is a SEPARATE project from the Cesar instant-pay fee feature (`VENDOR_INSTANT_PAY_FEE_BUILD_BRIEF_v1.1.md`). Brett (Oct 14): they are "two separate items that just happen to overlap because we're dealing with money in the same accounts." Do not merge them. The only hand-off between them is the vendor fee-credit ledger defined in the instant-pay brief (section 7): this project will eventually feed it; until then Brett posts credits by hand.

## 1. What Brett wants

1. Know every fee he pays: the Hub should calculate them. His words: "any fee that I'm paying calculated except for Cesar's fees, which are a wash." That includes card-processing fees on customer payments and any other transaction fees QuickBooks charges him. Methods that cost nothing simply have no fee to show.
2. Cesar's instant-payment fees are treated as fully recovered (padded into the price, deducted from his bill). They are excluded from "my fees." If a statement shows fees as one combined line, subtract the instant fees the Hub expects (from its own deduction records) to isolate his other fees. Brett does not think they are combined.
3. When Brett provides bank statements, reconcile fees at that time. For Cesar, any overcharge goes into his credit ledger and is returned on his next bill(s) until fully recovered (mechanics in the instant-pay brief, section 7).
4. This becomes part of a larger bank reconciliation workflow, planned now, built later.

## 2. Decisions so far (Brett, Oct 14)

- Account: statements are probably for the account ending 6287 (Brett is not certain). Treat as provisional; confirm on the first statement and record the confirmed account(s) in Config.
- Fee scope: all fees Brett actually pays, minus Cesar's instant-pay fees.
- Posting back to QuickBooks: Brett believes QuickBooks records these fees automatically. Unverified. If it does, nothing needs posting. Finding out is the FIRST task of this project, before any write is designed (see section 4).
- Home: extend the existing generic statement importer (Ridge-Co/RidgeCo PR #60, `POST /receipt-recon/import-statement`, `statementLineMatch`, Receipt_Recon_Queue; design in `STATEMENT_RECEIPT_RECONCILIATION_BUILD_BRIEF_v1.0.md`) as its next phase, adding a "fee" line type. No new one-off importer. Anything needing his attention lands in the same Receipt Reconciler queue he already works.
- Keep the earlier boundary: do NOT duplicate QuickBooks' own bank reconciliation for ordinary non-job spend. Only job-relevant items and fee items are surfaced. The goal is to feed QuickBooks' reconciliation, not replace it.
- Reconciliation happens when Brett supplies a statement (PDF or CSV, uploaded by him). No automation fetches statements. No cron.

## 3. Proposed shape (to confirm before building)

- Fee ledger: one row per fee: date, amount, fee type (card, ACH, instant deposit, other), source (statement line, or estimate), linked payment/invoice/work order when identifiable, status (`estimated` or `reconciled`).
- Estimates: for customer payments made by card, the Hub can compute an expected fee from the card rate and mark it `estimated` until a statement confirms the real figure. The card rate is NOT known (see section 5). Intuit's public pricing page lists no rates; Brett may also qualify for discounted rates. So estimates need the real rate from the first statement or from his QuickBooks account, and must never be shown as final.
- Per-fee recovery check: did the customer price already cover this fee? Relevant pricing history: Sep 23 removed the old 5% card-fee multiplier from tiered pricing, and receipt-based materials jobs now fold a 5% materials fee into labor. The report should show fees not covered by pricing, because that is the money actually leaking.
- Reconciliation output per statement: total fees found, fees matched to known payments, fees unmatched, expected Cesar instant fees (subtracted), and the Cesar variance (deducted vs actual), with a one-tap action to post any overcharge into his credit ledger. Brett confirms each post.
- Silent failures are not allowed: a statement line the importer cannot classify is shown, never dropped.

## 4. First tasks when this project starts (discovery, read-only)

1. Take ONE real card-paid customer invoice, its QuickBooks Payment record, its deposit, and the matching bank statement lines. Determine how QuickBooks posts the fee (separate expense line vs netted from the deposit) and whether it appears itemized on the statement. This answers "does QuickBooks post it automatically" and "are fees combined."
2. Read the actual card rate and any other fee types off that statement and Brett's QuickBooks Payments account.
3. Confirm whether the statement itemizes Cesar's instant-payment fees separately.
4. Only after 1 to 3: decide whether any posting back to QuickBooks is needed. If it is, every QuickBooks write is preview-then-confirm, never autonomous (AUTONOMY_GUARDRAILS rung 3).

## 5. Open questions (genuinely undetermined)

- Which account(s) and what statement format/frequency (monthly PDF? CSV export?).
- Card rate and any other fee types on his QuickBooks Payments account (unknown to Brett; to be read off the first statement).
- Whether fees are itemized or combined on the statement (Brett thinks itemized).
- Whether QuickBooks posts fees itself (Brett thinks yes).
- Which customer payment methods actually occur in practice (card, ACH, check, cash, Zelle/Venmo/Cash App), and which of them carry a fee.
- Whether the first statement should be treated as a backfill covering months of history. Brett has a backlog of unreconciled months; decide how far back this project goes.

## 6. Out of scope for now

Building anything in this brief. Fetching statements automatically. Reconciling personal or general spend. Replacing QuickBooks' bank reconciliation. Next-day payment fees (parked in the instant-pay brief).

## 7. Standing rules that apply when it is built

- Nothing fails silently (Oct 1): every error is logged to Ops_Telemetry and surfaced.
- No cron anywhere. Any schedule runs from the Apps Script Hub scheduler.
- Money writes are PRs for Brett's merge; QuickBooks writes are preview-then-confirm.
- Never ask Brett to paste a token to test; test on staging with TEST- fixtures.
- Quality control at design time: acceptance tests written from real statement samples before code.
