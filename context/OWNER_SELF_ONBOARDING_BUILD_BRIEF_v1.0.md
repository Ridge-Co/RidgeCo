# Owner Self-Serve Onboarding — Build Brief v1.0 (Sep 26, 2026)

**Status:** built + verified on `maintenance-hub-staging` (build `2026-09-26.1-owner-self-onboarding`); PR to `main` open for Brett's go/no-go. Not live in production until merged.

## What Brett asked for
A link he can send a new owner so they enter everything he needs to bill them and service their tenants, landing in the Sheet/Hub with no manual entry. Also: an owner billing-address field in the Hub; commercial property type + sub-types; and a fix for Add Property fields persisting from one property to the next.

## How it works
1. Hub → Owners → **📨 Owner Onboarding Link** creates a single-use invite (optionally pre-filled with name/phone/email, good for 7/14/30 days). Copy the link and send it.
2. Owner opens `owner-onboard.html?t=TOKEN` (3 steps, mobile-first): **About you + billing + PIN** → **Properties + units** → **Review + SMS permission + submit**.
3. On submit the Worker writes Owners / Properties / Units / Tenants / Keys, marks the invite `used`, and texts `admin_phone` (Brett) a summary. Anything needing a look (owned-by-other address, "provide later" units, no SMS consent, partial failure) sets **Needs review** on the invite; the Onboarding Link modal lists each warning.

## Field rules (as Brett specified)
- **Owner:** first + last name; **must choose** "use my name" or "I have a business name" (business name required if chosen); contact phone; billing email; billing address (street, city, state, ZIP); PIN.
- **PIN:** the platform-wide format (3 letters + 5 digits — owner login, the PIN sweep and the daily selftest all enforce it), not a trivial run (11111 / 12345 / AAA), unique across Owners/Owner_Users/Vendors/Tenants, live rules checklist + availability check + "Suggest" button.
- **Property:** address, city, type, unit count. House/rowhome = 1 (locked); multi = required, 2+; condo = required, 1+; **commercial** (new) = required, plus sub-type retail / mixed use / industrial / office. Same rules now apply to the Hub's own Add Property and Edit Property.
- **Units:** for multi/condo/commercial the owner lists only the unit(s) they want serviced (never forced to list all). Each unit is **occupied** (tenant first name + phone required; last name/email optional), **vacant**, or **"I will provide this later"**. Vacant requires a choice: **lockbox** (code required, location optional) or **no lockbox** (access note required). At least one unit across the submission must be occupied or vacant — "later" alone isn't enough.
- **SMS permission:** unchecked-by-default checkbox with STOP/HELP/"not a condition" language and links to bmoremanagement.com/sms-terms and /sms-privacy. Stored on the owner with timestamp, IP (when the edge provides it) and copy version. Optional by design (consent can't be required for service); unchecked ⇒ owner `SMS_Enabled=FALSE`.

## Where the data lands
- **Owners:** First/Last, Company (business name or blank), Phone, Email + Billing_Email (billing email), Billing_Name (business or full name — QuickBooks uses it first), Billing_Address/City/State/Zip/Phone, PIN, SMS_Enabled + SMS_Consent/_Date/_IP/_Version, Onboarding_Source=`self_serve_link`. QuickBooks customer sync runs best-effort via the existing `addOwnerWithQBSync`.
- **Properties:** Address, City, Market (inferred from city, else `Other`), Type, **Commercial_Subtype** (new), Unit_Count, Owner_ID, `SMS_Enabled=FALSE`, Onboarding_Source. Vacant + no lockbox notes go to `Access_Notes` (vendor-visible).
- **Units** (multi/condo/commercial only; house/rowhome get none, same as existing single-family data), **Tenants** (`SMS_Enabled=FALSE`; unit's Tenant_ID linked), **Keys** (`Unit-Lockbox` / `Building-Lockbox`, `Possession_Status=Have It`, note "provided by owner — not yet verified").
- **Owner_Invites** (new tab): token, status, expiry, prefill, per-token PIN-check counter, outcome summary, Needs_Review.

## Safety design
- Every public endpoint needs a valid, unexpired, unrevoked, **single-use** token (144 random bits). Submit claims the invite (`pending → processing → used`) before writing, so a double-tap/replay can't create two owners; a fixable validation/PIN/phone problem never burns the link; a failure before the owner row exists releases it.
- `check-pin` is capped at 25 calls per token (no PIN enumeration). `/owner-onboard/invites` (contains live links) is on the **production read-only token's deny-list**.
- An address that already exists is **never duplicated**: unowned → linked to the new owner; owned by someone else → skipped (no units/tenants added) and flagged for review.
- A phone number that already belongs to an active owner is refused with a friendly message (no second account).
- New properties and tenants start with SMS **off** (same rollout rule as every property).
- All text is control-character-stripped and length-capped; Sheets writes use `RAW`.

## Hub changes
Owner **Billing** section in Add/Edit Owner; Owners page **Owner Onboarding Link** modal (create / copy / list / revoke, with review flags); Add/Edit Property gain Commercial + sub-type; Add Property resets every field on open (the persistence bug — the modal never cleared its inputs); editing an owner-onboarded property never silently shrinks its owner-reported Unit_Count (the auto-count would otherwise drop it to the number of listed units).

## Verification
- `test/owner-onboarding.test.mjs` — 86 assertions (validation, PIN rule, invite state, wiring).
- `test/manual-verify-owner-onboard-ui.mjs` — 52 real-browser checks at 390px (mocked Worker).
- `test/manual-verify-hub-owner-property-ui.mjs` — 54 real-browser checks against the shipped `index.html`; confirmed the reopen test FAILS on the pre-fix file and passes on the fix.
- Live on `maintenance-hub-staging`: invite create/list/revoke rules; prefill; PIN taken/weak/available; invalid submit → 422 without burning the link; full submit (business billing, multi with vacant-lockbox + later + tenant units, rowhome, commercial, house) read back from Owners/Properties/Units/Tenants/Keys; replay → 403; duplicate phone → 409; owned-by-other address skipped and flagged.
- Pre-existing, unrelated failures on `main` (unchanged): `test/bill-to-note.test.mjs` (2), `test/receipt-attach-only.test.mjs`.

## Set PIN backfill (added later Sep 26)
Owners page → tick owners (or **Select owners with no PIN**) → **🔑 Set PIN for Selected**. Editable preview with phone-based suggestions, live rule checks, per-owner saved/refused status, optional "Text these PINs". Endpoints `/owner/pin-suggest` (no writes) and `/owner/set-pins` (validated, unique across logins, per-row results, TEST-only on staging token). Tests: `owner-pin-backfill` (36), `manual-verify-owner-set-pin-ui` (33). Live on staging (owner 25): suggest, set + read-back, weak PIN refused, duplicate PIN refused, non-TEST owner 403.

## Not exercised live (named plainly)
- The "unowned existing property → link" path (the staging test token can't edit non-TEST rows, so it would have left a real staging property linked to a test owner) — it is a single `updateRow(Properties, id, {Owner_ID})`, the same write `linkUnlinkedProperty` already uses.
- QuickBooks customer creation and the admin SMS are stubbed on staging. `SMS_Consent_IP` is blank on staging (calls arrive through a service binding with no client IP); a real browser hit on production carries `CF-Connecting-IP`.

## Decisions to revisit
- SMS consent is optional/unchecked (compliance-safe); make it required only if you decide consent may be a condition of onboarding.
- Single-family/rowhome tenants have no Units row (matches how the rest of the portfolio stores them).
- Unlisted units of a multi are not created; Unit_Count holds the total. Add the rest later via Edit Property → Units.
