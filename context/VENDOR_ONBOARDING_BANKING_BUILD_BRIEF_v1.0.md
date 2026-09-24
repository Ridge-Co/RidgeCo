# Vendor Onboarding + Banking Info — Build Brief v1.0

**Status:** Design locked with Brett (Sep 23, 2026) via clarifying questions. **NOT BUILT YET.**
GATED per `AUTONOMY_GUARDRAILS_v1.0` — touches vendor PII, banking data, and QuickBooks money
mechanics. Nothing here ships without Brett's own reviewed/interactive session at the deploy step,
and the banking-capture piece specifically needs his live walkthrough before any real vendor uses it.

## 1. The ask

Brett is adding new vendors regularly and can't pay them without banking info already on file —
today that info doesn't get collected until he goes looking for it after the fact. He wants:
1. A vendor-onboarding flow that collects what's missing, specifically so he can pay a vendor
   without a manual round-trip to ask for it later.
2. Required now: phone, billing email, billing address (street), tax ID (EIN or SSN, typed) +
   an uploaded copy of that tax ID document, and bank routing + account number.
3. Can come later (tracked, not blocking): EIN/tax-ID form upload if not already covered above,
   and a certificate of insurance.
4. A way to find vendors **already** in QuickBooks/the Hub with this info missing, not just new ones.

## 2. Critical constraint found during research — changes what's possible for banking specifically

QuickBooks' standard Accounting API (what `qbFindOrCreateVendor`/`qbApi` already use) has **no
writable field for a vendor's bank routing/account number.** That data only lives inside
QuickBooks' Bill Pay product (powered by Melio), and Melio's own security model requires the
**vendor themselves** (or an authorized user, by hand, inside Melio's UI) to enter it — it is not
exposed for third-party API writes, by design, since it's regulated payment-instrument data.

So "collect it in the portal, push it into QuickBooks automatically" is possible for every field
in this brief **except** the bank routing/account number. For that one field, there will always be
one manual step: someone with QuickBooks Bill Pay access types it into QuickBooks' own vendor
bank-setup screen. This brief is designed to make that the ONLY manual step, and to remove the
number from every other system the moment that step is confirmed done.

## 3. Design (locked)

### 3a. Banking data flow — capture once, verify once, keep it nowhere else
1. Vendor enters routing + account number in the vendor portal (HTTPS, same as any other portal
   field — no new transport risk beyond what already exists).
2. The Worker **never writes the plaintext to a Sheet tab.** It encrypts it server-side (AES-GCM,
   key held only as a new Cloudflare secret, never in a repo or Sheet) and writes the ciphertext to
   a single file in a new, tightly-scoped Drive folder (`Vendor_Banking_Pending/`) that only the
   existing service account can reach — nothing shared, no Hub UI ever renders it back out.
3. Vendors row gets `Bank_Info_Status = 'submitted_pending_qb_entry'` + a pointer (Drive file ID) —
   no bank digits in the Sheet, ever, not even masked.
4. A new **admin-only** "Banking submissions awaiting QuickBooks entry" list (Hub, admin-secret
   gated) shows vendors in that status. Brett (or whoever has QuickBooks Bill Pay access) opens the
   one ciphertext file via a narrow admin-only decrypt endpoint, types the number into QuickBooks
   Bill Pay's own vendor setup once, then taps **"Mark entered in QuickBooks"** in the Hub.
5. That tap does two things atomically: flips `Bank_Info_Status` to `verified_in_quickbooks` (+ a
   date), and **deletes the Drive ciphertext file** via the Worker's own Drive REST access (this is
   a real delete capability the Worker's service account has — different from the Claude-session
   Drive connector's read-only/no-delete limitation noted elsewhere in this repo's docs).
6. End state: the number lives in exactly one place — QuickBooks Bill Pay/Melio's own vault — and
   the Hub only ever holds a status + date, matching the existing "no bank/ACH data in the
   Hub/Sheet" boundary from `HYBRID_VENDOR_PAYMENTS_BUILD_BRIEF_v1.0` rather than breaking it.

This is Rung-3 GATED end to end (`AUTONOMY_GUARDRAILS_v1.0`) — the encrypt/store/admin-review/
delete pipeline needs Brett's own live walkthrough with a real test vendor before any real vendor's
number goes through it.

### 3b. Everything else in the required-now list — pushes to QuickBooks for real, automatically
Billing email, billing address, tax ID (EIN/SSN typed value) all map to real writable QuickBooks
Vendor fields (`PrimaryEmailAddr`, `BillAddr`, `TaxIdentifier`) via the existing
`qbFindOrCreateVendor` path — no manual step needed, these sync on save like any other vendor
field update does today.

### 3c. Portal gating — soft-block at the one place blocking already makes sense
Per Brett's own read of the tradeoff: don't block work-order visibility or progress (open jobs,
status updates, scheduling, photos, time entries all stay fully available — never gate work). Gate
**bill submission** specifically, since that's the one action that's already meaningless without
this info (Brett can't pay a bill for a vendor with no billing/tax/bank info on file anyway).

- Tapping **Submit Bill** first checks the vendor's required-field completeness.
- If incomplete: instead of the bill modal, show a one-time "Complete your info" form inline —
  phone (prefilled), billing email, billing address, tax ID + document upload, bank routing/account
  (goes through the 3a pipeline). Submitting it unblocks the bill modal immediately in the same tap
  — no separate approval wait for the non-banking fields; banking shows as "submitted, pending" but
  doesn't re-block this specific bill from being entered (only from being *paid*, which was already
  true before this feature existed).
- EIN/tax-ID document upload and certificate of insurance are NOT required to unblock billing — a
  small dismissible banner reminds the vendor once, and an admin view shows who's outstanding.
- New vendors: no separate first-login gate. First bill submission is the natural forcing function,
  and it lines up with how Brett actually experiences the problem today (chasing bills, not chasing
  logins).

### 3d. Existing vendors with gaps — both a report and a proactive nudge
- New **admin report** (Hub, admin-gated): every active vendor missing any required field, cross-
  checked against both the Sheet AND the live QuickBooks vendor record (a field can exist in one and
  not the other today) — Brett's own request from `HYBRID_VENDOR_PAYMENTS_BUILD_BRIEF_v1.0`'s
  Vendor_Type gap-analysis idea, now generalized to this fuller field set.
- One-time **automatic SMS/email** to every vendor with a gap, same nudge pattern as the existing
  vendor-invoice-confirmation and welcome-message chokepoints (`smsGatedSend`) — asks them to log
  into the portal, which then surfaces the same "Complete your info" form directly (not gated behind
  a bill submission for this one entry point, since there's no bill to attach it to yet).
- De-duped so a vendor doesn't get nudged repeatedly every sweep — one nudge, then it only re-fires
  if the gap is still open after N days (reuse the existing vendor-nudge cadence/cap pattern from
  `Vendor_Requests`, rather than inventing a new one).

## 4. New schema (additive only — ensureColumns pattern, existing rows unaffected)

**Vendors tab, new columns:**
`Billing_Email`, `Billing_Address`, `Tax_ID` (typed value, EIN or SSN), `Tax_ID_Document_URL`,
`Insurance_Cert_URL`, `Insurance_Expiry`, `Bank_Info_Status` (`not_started` default /
`submitted_pending_qb_entry` / `verified_in_quickbooks`), `Bank_Info_Submitted_Date`,
`Bank_Info_Verified_Date`, `Bank_Info_Drive_Pointer` (Drive file ID, cleared on verify),
`Onboarding_Nudge_Sent_Date`.

**New Drive folder:** `Vendor_Banking_Pending/` — service-account-only, no share links ever
generated for it (unlike every other Drive folder this codebase uses, which are share-anyone by
design for portal display — this one deliberately never gets `driveShareAnyone` called on it).

**New Cloudflare secret:** `VENDOR_BANK_ENCRYPTION_KEY` (AES-GCM key, generated once, never in
any repo/Sheet/chat — set directly on the Worker like `PAY_AUTH_CODE`).

## 5. Build sequence

**Phase 1 (SAFE-adjacent, still ships via a reviewed session per PII-touching rule) —** schema
additions, billing-email/address/tax-ID fields wired into `qbFindOrCreateVendor`, the "Complete
your info" form gated on Submit Bill, admin gap report. No banking/encryption code yet — ships
first so Brett gets value (and stops the info-gap problem for everything except banking) fastest.

**Phase 2 (GATED, needs Brett's live walkthrough before real use) —** the banking encrypt/store/
admin-review/QuickBooks-manual-entry/delete pipeline described in 3a, plus the "Mark entered in
QuickBooks" admin action and its Drive-delete step.

**Phase 3 —** existing-vendor gap sweep + one-time nudge SMS/email, reusing the vendor-nudge cadence
pattern.

## 6. Open item for Brett before Phase 2 starts

Who besides Brett has (or should have) access to the admin "Banking submissions awaiting
QuickBooks entry" screen and the decrypt action — this is the one screen in the whole build that
can see a real bank/routing number, even briefly, so it should be scoped as narrowly as he wants
before Phase 2 is written.
