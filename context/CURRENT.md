# WHERE THINGS STAND — Aug 22, 2026

## 📋 Wishlist/devlog reconciliation + Brett's 5 fresh items — 3 shipped, 2 already done, 2 open questions.
Brett asked to surface the Ridge Co Hub wishlist/improvement backlog, strip anything already shipped, add 5 fresh items he'd just hit, and start on the priority ones. Reconciled against BACKLOG.md + FEATURE_LOG + this file rather than re-describing from memory (truth-mode). Full writeup + the reconciled list went to Brett directly; short version:
- **Already done, not rebuilt:** (1) select-multiple on Review Bills — live since rule 98 (Aug 10). (2) Turnover trigger (repairs+cleaning+paint as 3 connected WOs, B-100) — shipped rule 104 (Aug 18), still flagged `🔴 Needs Brett's confirm` there and never confirmed since. Told Brett rather than silently re-building these — asked him to do the rule 104 live-verify instead.
- **Shipped this session:** voice-to-text auto-restart-through-pauses (FEATURE_LOG rule 131, all 4 mic-enabled files); Trash Service "Add photos" precise-tap-only bug (rule 132); Trash Service service-date picker + This week/Last week tabs + batch send + mark-skipped (rule 133). See FEATURE_LOG for full detail and Brett's live-verify checklist — none of the four have had a first live pass yet.
- **Added to BACKLOG.md as open items (not built this session):** B-227 (repo-wide sweep of the same label-wraps-hidden-file-input tap-target bug — found in `wo.html`×3, `scope-creator.html`×2, and the shared `inputAttrs` helper used by index/tenant/owner/vendor — rule 132 only fixed Trash Service, the one Brett named), B-228 (Brett's "add it to a checklist project" ask — **open question**, see below).
- **🔴 Open question for Brett — asked in plain text, not the question widget (per his standing instruction, doesn't work on mobile):** "checklist project" — did you mean a ClickUp list (this session has ClickUp tools connected), or the Hub's own Wishlist/Dev Log checklist mechanism (rule 37, already in BACKLOG.md's reconciliation ritual)? Logged as B-228 either way so it's not lost; will file it into whichever you mean once you say.
- **B-100's BACKLOG.md Quick-Index row was stale** (still showed 🟠 open despite rule 104 shipping it Aug 18) — corrected to reflect shipped-pending-verify, per the reconciliation ritual's own rule ("never mark Done what FEATURE_LOG can't confirm" — this one FEATURE_LOG DOES confirm as shipped, just not yet Brett-verified, so it's marked accordingly, not silently closed).

# WHERE THINGS STAND — Aug 21, 2026

## ✅ SHIPPED — Bulk Importer: fixed a multi-line CSV cell shredding a real tenant into a phantom property + added CSV file upload. FEATURE_LOG rule 130.
Brett re-tested rule 129's fix with the exact same CSV and correctly caught that the numbers still didn't add up: "1 new property, 7 new units" for a 2-address paste that should show 0 new properties. Traced it by running the real parser against his exact paste: his CSV has a Phone cell with two numbers on two lines inside one quoted field (`"609-608-5080\n443-333-7107"`, valid CSV) — the old `parseDelimited()` split the raw paste on every newline BEFORE checking quote state, so this one row got shredded into two garbage rows. Gabriel Bellone & Faith Dean's real name/email got stranded in a phantom brand-new "property," and the real 2R unit was left with a nameless tenant. Fixed at the root: `parseDelimited()` now tokenizes the whole raw paste in one pass, quote-state carried across newlines. Also added `firstPhone()` (worker.js) so a correctly-parsed multi-number phone cell doesn't get concatenated into 20-digit garbage by `normalizePhone` — applied everywhere a bulk-import phone reaches it (hub tenant, hub owner, inspection-scheduler tenant). **Also shipped Brett's own suggestion from this conversation:** a real "Choose CSV file…" upload button next to the paste box, reading straight into the same fixed parser — a second, more reliable input path alongside paste. New `test/bulk-import-csv-parse.test.mjs` (14 assertions against the real extracted parser, not a reimplementation). `node --check` clean, full suite re-run clean (same 2 pre-existing unrelated failures), rule 129's own test still 11/11. Worker `2026-08-21.9`. **🔴 Needs Brett's live pass** — re-paste (or upload as a .csv) the same CSV and confirm 0 new properties / 2 matched, 6 new units / 6 matched (only 3F/3R new), and that 2R shows Gabriel Bellone & Faith Dean as the tenant with the first phone number stored — not a blank-name tenant plus a garbage new property. Then Confirm and check the Hub.

## ✅ SHIPPED — Bulk Importer "St vs Saint" address bug fixed. FEATURE_LOG rule 129.
Brett's first live check of rule 122 found exactly what he suspected: 931 St Paul St already existed (6 units already on file), but the importer proposed 13 brand-new units instead of recognizing them. Root cause confirmed via the sheet-write history in `context/sheet-ops/` before touching any code: Property 70's address is on file as "931 **Saint** Paul St" (spelled out), while the pasted CSV said "931 **St.** Paul St." (abbreviated) — the importer's address normalizer only stripped punctuation, never reconciled that "St" can mean either "Street" or "Saint." Brett confirmed the on-file spelling via the Hub, then flagged this will keep coming up (Saint Paul is a common street/neighborhood name locally). Fixed at the root: added `saint: 'st'` to the existing `QB_ADDR_WORDS` dictionary (already used for QuickBooks address matching, already folds Street/Ave/Rd/Blvd/N-S-E-W) instead of writing a second normalizer — one line, benefits every consumer of that dictionary. Both `hubBulkImport` and `inspBulkImport` had their own weaker local normalizer; both now just alias the shared one (single source of truth, PAT-001). Also added a visible "✓ matched via St/Saint/Street normalization" banner to the preview (`properties_matched_via_address_normalization`) so a fuzzy match is never silent — Brett gets a one-glance pasted-vs-matched-address check before confirming. New `test/bulk-import-address.test.mjs` (11 assertions). `node --check` clean, full suite re-run: same 2 pre-existing unrelated failures (`pricing-model`, `scope-core`), `qb-address.test.mjs` still 19/19. Landed via `git rebase` on top of rules 127-128 (Gladden un-gated/editable proposal text, standalone-pricing disclaimer) — renumbered from 127 to 129 to avoid colliding, one BUILD_VERSION conflict (`.6` vs `.7`, resolved to `.8`), no route/function collisions. Worker `2026-08-21.8`. **🔴 Needs Brett's live pass** — re-paste the same 931 St. Paul St. + 1305 N Calvert St. CSV into Bulk Importer and confirm 931 St Paul now shows as MATCHED (green banner) with 6 units matched / 2 new (3F, 3R only), and 1305 N Calvert shows as matched too (its address already lined up) with all 4 units new since none were ever entered — then Confirm and check the Hub.

## 📜 New standing disclaimer on standalone/cherry-picked pricing — now on every proposal. FEATURE_LOG rule 128.
Brett wants it permanently clear: cherry-picked items already cost more than their combined-job share
(the tapering-trip-charge model built earlier this session), AND even that higher standalone number
is only a best-efforts estimate — the combined price is what actually absorbs the small unknowns of
mixing larger and smaller tasks, a lone item doesn't get that cushion. Added the confirmed disclaimer
to Gladden's live proposal, to `scopeProposal()`'s doc template (every future Scope proposal), and to
`generateEstimateText()`'s doc template (the older WO-based estimate path, still live) — three places
so "every proposal we make" is actually covered regardless of which generator built it. Kept separate
from the older 15%+$150 Estimate Integrity Clause (different scenario — dropping items from an
already-versioned WO estimate). Documented as **LOCKED policy** in `billing-model.md` (private repo)
so it's the standing reference. Worker `2026-08-21.7`.

## 🔓 Gladden un-gated + proposal text is now editable in the tool. FEATURE_LOG rule 127.
Brett: "add the prices to the items on the page itself so we can fix it going forward and i can
have full access to the link... i should be able to paste the text into the bottom proposal
section... i don't want to send the link unless i can edit something in it if needed." Populated
real per-item vendor costs on scope id=1 (Eddie's actual $3,600 quote, matched item-by-item — every
one reproduces the already-quoted price at the 1.375x flat markup) via `/scope/update`'s
`line_items` path only — confirmed live that `Proposal_Text`/`Status`/`Estimate_Amount` didn't
move. `itemsFullyPriced()` is now true, owner-billing was already satisfied, so the proposal
section is un-greyed. Also swapped the read-only proposal-text `<pre>` for an editable `<textarea>`
+ **Save** button, so Brett can edit/paste the proposal text directly going forward instead of
needing an API call each time. Worker `2026-08-21.6`. **🔴 Do not tap "Generate proposal" on
Gladden** — it recomputes through the new per-item engine and would overwrite the $4,950
combined/standalone text with a recomputed $5,175 (per rule 125); edit the text box directly
instead. **Verify (Brett):** open Gladden in Scope Creator, confirm the section is unlocked, the
text box shows the existing proposal, Save works, and Get Shareable Link still returns the same
link.

## ✅ SHIPPED — Owner ↔ Property linking gap fixed. FEATURE_LOG rule 126.
Brett: "can't add owner to property or property to owner for new owner jeannie... not sure if this
is a bug." Checked first whether this was a regression from today's other sessions — it wasn't:
`git log --all` on index.html shows an Owner field on the Edit Property modal never existed at any
point in history. The Add Owner modal's own help text has always promised "go to Properties → Edit
each property to link them to this owner" — a promise the Edit Property modal never actually kept.
Fixed both directions: Edit Property modal now has an Owner select (saves via the already-generic
`POST /property/update`), and the Owners list gets a "+ Property" quick-link button. Tenant-to-property
linking checked separately and already works fine (Add/Edit Tenant), untouched. `node --check` clean
on worker.js + all 5 inline `<script>` blocks, full suite 32/34 (same 2 pre-existing unrelated
failures, nothing new). Worker `2026-08-21.5`, pushed (rebased clean onto rule 125's concurrent push).
**🔴 Needs Brett's first live pass** — see FEATURE_LOG rule 126 for the exact check (try linking
jeannie's property from either side).

## 🔧 FIXED — Gladden's live customer link was actively broken ($0.00, blank, signable). FEATURE_LOG rule 125.
Brett: "I may have had an old one running on that, and there's also the esign... check to make sure
the esign is done." Checking that surfaced something worse than the greyed-out button he'd reported:
the customer's ALREADY-SENT shareable link for scope id=1 (Gladden) was live-broken right now — rule
123's rewrite made `scope-proposal.html` render only `Proposal_Items_JSON` with no fallback, so a
scope priced before that rewrite (Gladden's 14 items have no `variants`) was serving a blank scope of
work, a **$0.00 total**, and a working sign form. Live-curled the real link to confirm before touching
anything. Fixed additively — `render()` now falls back to the exact pre-rewrite flat-text renderer
(restored from `de121b8`) whenever an item array is empty; any scope with real per-item data renders
exactly as before, untouched. Verified against Gladden's live payload: correct $4,950/$2,475 and the
full combined-vs-standalone breakdown, byte for byte. **Deliberately did NOT run Gladden through the
new per-item pricing engine** — simulated it first against Eddie's real vendor costs and it computes
$5,175, not $4,950 (the $50-per-item minimum markup applies once per item, not once per job); forcing
fake vendor costs to hit $4,950 would also mis-price Eddie's real prorated vendor bill under rule 124's
QB booking. Brett's call: keep this one as a flat-text proposal outside the new engine ("we are
supposed to send the original amount... I want both on the proposal"). **E-sign itself: still shipped
+ unit-tested, still NOT field-verified** — live-checked `Scope_Signatures`, zero rows, nobody has
signed anything yet; needs Brett's first live pass same as rule 123 already flagged. Worker
`2026-08-21.5`. **Verify (Brett): reopen Gladden's existing link (same URL) and confirm it now shows
the real proposal instead of a blank $0 page.**

## ✅ SHIPPED — Scope proposal → QuickBooks booking, Phase 2. FEATURE_LOG rule 124.
Brett, same session as the `ac1470a` recovery right below: "give me the instructions to start the
quickbooks invoice from signature workflow/code. I want that for my current proposal at gladden."
Built and pushed `POST /scope-proposal/book` (`scopeProposalBook`, worker.js) — preview-first,
admin-gated, idempotent, same safety pattern as the old B-076 `proposalBook()` (untouched): creates
a QuickBooks customer invoice for the signed row's DEPOSIT, persists its id before touching the bill,
then creates a vendor bill prorated to the SAME share of the vendor's cost as the deposit is of the
subtotal (not the vendor's full cost — new pure helper `scopeSigVendorBillAmount`). Trade for the QB
item/account routing picked by majority vote across the signed items (`scopeSigTrade`, new). UI:
extended `signed-proposals.html` (already the Hub's "Signed proposals → QB" tool) to load and book
BOTH the old and new signature systems from one screen instead of building a second page. New
`test/scope-book.test.mjs` (11 assertions on the two new pure helpers). `node --check` clean, full
suite re-run: same 2 pre-existing unrelated failures (`pricing-model`, `scope-core`), nothing new.
Worker `2026-08-21.4`. **Brett: this is real money — see FEATURE_LOG rule 124 for the exact live-test
checklist before trusting Confirm on the actual Gladden proposal.** Note what this phase does NOT do:
no second step yet to invoice/bill the remaining balance once a job is actually complete — only the
deposit side books today.

## ✅ RESOLVED — `ac1470a` recovered after all. Brett found the patch. FEATURE_LOG rule 123.
The "unrecoverable" call right below was correct as far as this checkout went — but Brett had the
patch on his end (this session's `git cat-file`/`git log --all` checks only ever prove a commit
isn't in a checkout that was reclaimed, never that no export of it exists anywhere). Uploaded
`0001ScopeproposalsperitemRepairReplacestyleoption.patch`, applied clean against current `main` with
**zero conflicts** (untouched by everything else that landed today), `node --check` clean, full
suite re-run clean (same 2 pre-existing failures, nothing new — including the new
`test/scope-variants.test.mjs`'s 13 no-leak assertions). Pushed. See FEATURE_LOG rule 123 for the
full feature writeup, the one cross-patch interaction worth knowing about (hand-edited proposals via
today's other `scope/update` change won't populate the new item-picker view), and the live-test
checklist — this one involves a real signature, so it's worth Brett's own careful first pass before
relying on it for an actual customer.

## 🔴 "resume ridgeco" hit an unrecoverable commit — Phase 1 e-sign/repair-replace/owner-gate work is lost, not pushed (Aug 21, later Cowork/mobile session).
Brett resumed with "Phase 1 (per-item Repair/Replace pricing, owner gate, e-sign) is committed locally
as `ac1470a` but never got pushed because this session couldn't reach `Ridge-Co/RidgeCo`. Push it,
then continue to Phase 2." **Verified `ac1470a` does not exist anywhere reachable**: not an object in
a fresh clone of `Ridge-Co/RidgeCo` (`git cat-file -t ac1470a` → not found), not in `git log --all`,
no active/resumable Claude session holds it (`ListAgents` → none reachable), and no patch file was
uploaded with this message (the `ridgecoaug20changesresolved.patch` recovery pattern used earlier
today for the tenant-WO-toggle work — see the entry right below — does not apply here; nothing was
attached this time). The container that held that local commit was reclaimed when its session ended,
same root cause as the patch-recovery case, but this time there's no export to replay. **Nothing in
FEATURE_LOG/BACKLOG/SESSION_STATE documents this Phase 1 as ever built or checkpointed** — the closest
tracked threads are B-126 (owner marked-up-estimate approval gate), B-194 (repair-vs-replace asset
register, referenced from B-223), and FEATURE_LOG rule 116 (Aug 18, "NEXT SESSION — real e-sign +
Fairfax-template proposal," still open, still waiting on Brett to supply the Fairfax template file) —
none show a "built" entry, so this looks like a session that built real work, committed it locally,
and ended (ran out of turns / was closed) before push or session-close logging happened. **Asked Brett
in plain text (no AskUserQuestion widget — mobile) whether he can export/upload a patch from that
prior session the same way as the Aug 20 recovery, or wants it rebuilt from spec.** Did not proceed to
Phase 2 (QuickBooks deposit invoice + prorated vendor bill) since it would build on Phase 1 code that
doesn't exist in this checkout.

## 📥 Second uploaded Aug 20 patch: shared Bulk Importer, recovered + pushed. FEATURE_LOG rule 122.
Same story as the tenant-WO-toggle patch below — Brett asked to review everything that didn't get
pushed in the last 72h, which surfaced a **second** orphaned patch from the same Aug 20 session
(`011yNE8vGUgdQ2DLUa8jQ1tS`): a shared Bulk Importer for Properties/Units/Tenants (`bulk-importer.html`
+ `POST /bulk-import`), reusing the Inspection Scheduler's importer engine so one tool covers both.
Went through two rounds of `BUILD_VERSION` conflicts — the patch's own `.1` vs. main's `.3` from the
earlier tenant-WO-toggle merge, then a rebase onto a concurrent session's B-227 Phase 3 push (which
had already claimed FEATURE_LOG rule 121) reconflicted the same line — landed at `2026-08-21.2`, this
entry logged as rule 122 to avoid the collision. `node --check` clean, full suite re-run clean (same 2
pre-existing failures). **🔴 Needs Brett's first live pass** — see FEATURE_LOG rule 122 for the exact check.

Also applied a small **live data fix** from the same session: a follow-up sheet-op
(`context/sheet-ops/pending.json`, auto-runs via GitHub Action on push) blanking the stray duplicate
Tenant row 98's First_Name/Phone (James / 20 E Eager St) — row 98 was retired (Active=FALSE) back on
Aug 12 but still carried James's phone number, so the old Contacts sync kept resyncing it as a
"Former Tenant" duplicate. Never hard-deletes, per house rule; row stays, just blanked. **This one
actually writes to the live Google Sheet on push** — flagging clearly since it's not app code Brett
can review in a diff first the way the two code patches were.

## 🔀 Uploaded Aug 20 patch applied + pushed live (Aug 21, Cowork/mobile session, commit `edc5f21`).
Brett uploaded `ridgecoaug20changesresolved.patch` — the tenant WO submit toggle, owner edit modal,
and mobile/nav sweep (rules 118–120 below) from session `011yNE8vGUgdQ2DLUa8jQ1tS`, which had never
actually been pushed to `main`. Verified the patch's base matched current `main` exactly for every
app file (worker.js's BUILD_VERSION hunk went cleanly from `.2`→`.3`, confirming nothing else had
touched those files since); only `context/CURRENT.md` conflicted, because this file itself had moved
on (today's earlier venture-web entry). Resolved by keeping both dated sections in order (this Aug 21
section, then the patch's own Aug 20 section right below). Applied clean via `git apply --3way`,
`node --check` clean on worker.js + the new test file, full suite re-run: `tenant-wo-toggle` 15/15,
same 2 pre-existing unrelated failures (`pricing-model`, `scope-core`) as before — nothing newly
broken. Pushed to `origin/main` (`c320948..edc5f21`). **The three shipped items below (rules 118–120)
still need Brett's first live pass** — see their own verify notes.

**🔴 Also: two fresh classic PATs were pasted into this chat to load context** (Ridge Co org token +
brett332 token) — per the standing CREDENTIALS_MAP rule, rotate both (revoke + reissue) once this
session closes, same as the prior BRETT_GH_PAT paste flagged just below.

## 🕸️ Venture Web + skills review + two BACKLOG skills delivered (Aug 21, Cowork/mobile session).
Brett brought a transcript of a Matt Wolfe video reviewing 9 external Claude Code/Codex skills
(GStack, Stop Slop, Graphify, Understand Anything, Last 30 Days, Anthropic's Front-End Design, the
Taste skill, Remotion, HyperFrames) and asked which were worth having. Reviewed each against what
Brett already runs: 5 of 9 lost to a skill he already has tuned to his stack specifically (Stop Slop
→ `humanize-text`; GStack's review/QA role → `ridgeco-validate`; Understand Anything → `ridgeco-map`);
3 are genuinely useful but situational, not worth installing as standing skills (Last 30 Days,
Front-End Design/Taste, Remotion/HyperFrames); 1 was a real gap. Built **`venture-web`** for that
gap — an interactive cross-venture connection graph (mobile-first HTML, published as an Artifact)
mined from `business_map.md`/`theme_map.md` in `brett332/data`, surfacing 9 "bridge" connections
across ventures that don't show up working one venture at a time (e.g. BarrelCo and Winchester
Hauling independently built near-identical Facebook Marketplace bot logic; the Fluid Truck
bankruptcy claim has no single owner, split across Fleet & Vehicles and Finance). **Delivered as
`venture-web.skill`, Brett saved it** (first attempt failed — `description` field was over the
1024-char limit and silently broke "Save skill"; fixed and redelivered).

Brett then asked what else had been built in past sessions but never installed. Checked the record
(BACKLOG/CAPTURE_INBOX/CURRENT.md session log) rather than relying on memory: `brett-flow`,
`ridgeco-map`, `brett-amplify`, `ridgeco-validate` were all already delivered-and-saved historically
— nothing was actually pending. Found one loose end instead: a stale, superseded draft of the
brett-context skill sitting at `brett332/data/skill/brettcontextSKILLFIXED.md` (pre-dates the
light-load/session-efficiency version currently installed). **Deleted it from the private repo**
(the currently-installed brett-context skill itself lives in Brett's account, not this repo, and
was untouched). Also surfaced two never-built BACKLOG ideas (B-031, B-017) and built both on request:

- **B-031 → `ridgeco-scope.skill`** — scope intake from typed/dictated/photographed notes into a
  clean itemized scope, no invented line items, questions asked instead of assumed. Deliberately
  **does not compute or state pricing** — that's scoped down from the original ask because
  scope-creator.html already applies markup server-side (`calcTieredEstimate`) per the Aug 10 hard
  rule (rule 73), which postdates this backlog item. Flags multi-trade/descope situations for the
  existing cherry-pick upcharge language but reads the live numbers at proposal time rather than
  memorizing them into the skill.
- **B-017 → `brett-skillsmith.skill`** — a meta-skill for building future Brett-specific skills
  consistently: checks for overlap with what Brett already has before building (the same discipline
  used in the 9-skills review above), follows house SKILL.md conventions, checks the description
  length before packaging (see the venture-web bug above), and logs each build here + in BACKLOG so
  this exact "what haven't I installed" question stays answerable from the repo alone next time.
  Note: **B-177 "Flows"** (the bigger in-app event-trigger automation engine) is the larger thing
  B-017 originally pointed toward and remains separate/open — this skill covers the literal
  "reusable Cowork skill for building skills" ask, not Flows.

**Update (same session):** `ridgeco-scope.skill` failed "Save skill" on first delivery — a second,
different bug from venture-web's: `<address>`/`<item>`/`<question>`-style angle-bracket placeholders
in the template/output-format sections read as XML tags to the save validator and reject the whole
file. Fixed by switching every placeholder to square brackets (`[address]`, `[item]`, etc.) — this
applies to any text in the file, including prose that merely *mentions* the angle-bracket shape as an
example. Both `.skill` files rebuilt clean (verified: `grep -noE '<[^<>]{1,60}>'` returns nothing in
either) and redelivered. `brett-skillsmith` now checks for this alongside the description-length
check, so a future skill build catches both before Brett ever sees a save error.

**🔴 Needs Brett:** tap **Save skill** on the redelivered `ridgeco-scope.skill` and
`brett-skillsmith.skill` (neither confirmed saved yet — do not mark BACKLOG/this row "saved" until
confirmed, same as `venture-web` wasn't marked done until its second delivery actually worked).
Also: Brett pasted `BRETT_GH_PAT` into this chat to load context (his documented workflow) — per the
standing CREDENTIALS_MAP rule, rotate it (revoke + reissue) after this session closes.

# WHERE THINGS STAND — Aug 20, 2026

## 🔴 SECURITY — rotate your GitHub token. It was pasted into this chat in plain text.
Not a code issue — a housekeeping one. A classic GitHub personal access token was pasted directly into this session's chat to authenticate the git push. It was used only in-session (never written to any file in the repo) but it now exists in this conversation's history, which is enough reason to treat it as burned: go to GitHub → Settings → Developer settings → Personal access tokens and revoke/regenerate it next time you're at a computer. This isn't urgent-tonight urgent, but don't leave the old one live indefinitely.

## 🔓 Tenant work-order submit toggle (owner overrides property) SHIPPED (Aug 20, Worker `2026-08-20.3`, new `tenant-wo-access.html`, live). FEATURE_LOG rule 118. 🔴 Needs Brett's first live pass.
One page, two levels, owner always wins when it applies. Off everywhere by default — no tenant anywhere can submit a work order until you turn it on at the owner or property level. **Verify (Brett):** open Tenant Work Order Access from the Hub's 🧰 TOOLS, confirm everything shows OFF to start, turn one property ON and confirm a tenant there can now submit from the online request page, then set an owner-level Block scoped to that property and confirm it overrides the property back to blocked.

## ✏️ Owners are now editable from the Hub SHIPPED (Aug 20, live). FEATURE_LOG rule 119.
Owners was the one contact type in the Hub you couldn't actually edit — its Edit button was a placeholder. Real edit modal now, same as Vendors/Tenants/Properties. **Verify (Brett):** Owners list → Edit on any owner → change something → Save → reload and confirm it stuck.

## 📱 Mobile fix for owner/property pages + every day-to-day page, plus a "back to Hub" nav on every tool SHIPPED (Aug 20, live). FEATURE_LOG rule 120. 🔴 Needs Brett's phone check.
Found the real cause of "can't see the whole screen": the Hub's data tables (Owners/Vendors/Tenants/etc.) were being clipped off-screen instead of letting you scroll sideways to see every column, and the owner/vendor page headers didn't wrap on a narrow screen. Both fixed, plus the same overflow guard applied across tenant/owner-submit/submit pages defensively. Separately, every one of your 23 standalone tool pages (Trash, Command Center, Receipt Reconciler, Inspection Scheduler, etc.) now has a thin bar at the top with a link back to the Hub and a dropdown to jump straight to any other tool — so you don't have to back out through the browser when you're bouncing between tools. **Verify (Brett):** on your phone, check the Owners/Vendors/Tenants tables in the Hub scroll properly now, open owner.html and vendor.html and confirm the header looks right, and open any tool from Dev Log → 🧰 TOOLS and confirm the new nav bar at the top works.

---

# WHERE THINGS STAND — Aug 18, 2026 (end of day)

## 📋 Open Item Report — admin test-send override added SHIPPED (Aug 18, not yet usable). FEATURE_LOG rule 117. 🔴 Still needs Brett's Gmail OAuth setup before any send works.
Brett asked to test on Goldszmidt but have the email land in his own inbox (`brett@bmoremanagement.com`) instead of the real billing contact, so he can preview it before any customer sees one. `ar-report-admin.html` now has a "Test email" field above the customer list — fill it in and "Send now" pulls that customer's real, live report (real balance, real invoices, real pay link) but sends it to the test address instead, skipping the eligibility check so you can preview any customer on demand regardless of whether they'd normally qualify. Leave the field blank for a normal real send. Both the confirm-dialog and the log entry (`AR_Report_Log`, `Trigger: manual-test`) are clearly marked as a test so it never gets confused with a real send. Walked Brett through the Gmail OAuth setup needed to unblock this (Google Cloud project, Gmail API, OAuth consent screen published, Desktop OAuth client, refresh token via OAuth Playground, four Cloudflare Worker secrets — `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/SENDER`) — not yet completed on his end. **This is still blocked on the exact same prerequisite as the report itself (rule 111): nothing sends — test or real — until Brett finishes the Gmail OAuth setup.** **Verify (Brett) once Gmail is set up:** open `ar-report-admin.html`, put `brett@bmoremanagement.com` in the Test email field, tap "Send now" on Goldszmidt's card, confirm the email arrives in your own inbox with the real Goldszmidt balance/invoices and a working link.

## 🖊️ NEXT SESSION — proposal with e-sign + Fairfax template. Brett needs to bring the Fairfax proposal file.
Closing item for the day. Brett wants the proposal generator to actually look professional (not plain rendered text) using **"the Fairfax proposal"** as the template, plus real **e-signature** capture. FEATURE_LOG rule 116 has the full brief. Searched this repo + session uploads for anything Fairfax-related — nothing found, Brett has it on his end. **First thing next session: get that file from Brett** (upload it), then match its layout for `scope-proposal.html` and scope the e-sign path — Documenso (self-hosted, github.com/documenso/documenso) was floated but not yet evaluated against this stack (Worker + GitHub Pages, no Postgres/Next.js host today), vs. a simpler typed-name+timestamp+IP click-to-sign if that's actually enough for a contractor proposal. Ask Brett which he wants before building.

## 🔗 Customer-facing proposal link SHIPPED (Aug 18, Worker `2026-08-18.9` + new `scope-proposal.html`, live). FEATURE_LOG rule 114. 🔴 Needs Brett's first real send.
Public no-login link for a generated proposal — `scope-creator.html` → "🔗 Get shareable link" → `scope-proposal.html?t=...`, same signed-token pattern as the WO share link and AR report link. Response is strictly `{ok, address, title, proposal_text, status}` — no vendor/email/cost/markup, verified live. **Verify (Brett):** on an approved scope with a generated proposal, tap "Get shareable link," open the link in a private/incognito window, confirm it reads clean and professional enough to send as-is (cosmetic polish + e-sign is next session's work, rule 116).

## ✅ Local-storage security scare — investigated, confirmed NOT a leak (Aug 18). FEATURE_LOG rule 115.
Brett saw vendor name/email/pricing when he "inspected" the proposal link page and (understandably) assumed the page was leaking it. Real cause: the Hub/vendor/tenant portals and the proposal page share one browser origin, so his browser's own leftover admin/vendor/tenant session data showed up in DevTools' Local Storage panel — not anything the proposal page fetched or displayed. `scope-proposal.html` has zero `localStorage` code (grepped clean); confirmed via incognito window (empty storage, clean render). No leak to real customers. Full explanation + the one open follow-up (Brett's admin token has no logout/expiry) in FEATURE_LOG rule 115.

## 🔍 Inspection Scheduler — blackout date ranges/times + bulk property/unit import SHIPPED (Aug 18, Worker `2026-08-18.8` + `inspect.html`, live). FEATURE_LOG rule 113. B-226. 🔴 Needs Brett's first live pass.
Follow-up to Phase 1 (rule 110) based on Brett's direct feedback after confirming that stuck: "add ability to bulk add dates in a batch and date ranges as well as time ranges (in the blackout dates bulk add)... need to be able to select from existing properties/tenants/units. i don't want to onboard hundreds of units manually." Blackouts: the one-off date builder now supports a From/To date range (stored as one row, not one per day), a paste-a-batch-of-dates textarea, and Start/End time fields that apply to the whole save — so "block Dec 24–26, all day" or "block just the 31st, 1pm–5pm" are both one action. Bulk import: new "Bulk import properties/units" screen — paste rows from a spreadsheet (Address/Zip/Unit_Label/Tenant/Phone), preview the counts before committing, confirm to import in safe-sized batches; matches existing properties by address and skips duplicate units, so re-pasting an overlapping list never creates doubles. Built specifically to not blow through the Google Sheets API quota on hundreds of rows (same lesson as rule 99's quota incident) — reads the existing data once, writes in at most 2 batched calls regardless of row count. Also fixed the underlying "can't find one property among hundreds" problem: properties/units now load in one batched call instead of one-per-property, each property's unit list is collapsed by default (tap to expand), and there's a search box to filter by address or zip. **Verify (Brett):** open Inspection Scheduler, paste a small test batch of 2-3 addresses (include one multifamily with 2 units) into Bulk import, confirm the preview counts look right, confirm, then refresh and use the search box to find one of them. Separately, add a one-off blackout with a date range and a time window and confirm it saves and displays correctly.

## 🔧 Fixed real cause of "Hub loads very slowly, no work orders" — timeouts now actually cancel the request SHIPPED (Aug 18, live). FEATURE_LOG rule 112. 🔴 Needs Brett's confirm.
Rule 106's 20s timeout wasn't enough — Brett reported it was STILL slow, work orders never loading, even though scope-creator (same Worker) worked fine. Found the real bug: the old timeout only stopped the app from WAITING on a stuck request, it never actually cancelled it — so a stalled load could sit there quietly using up one of the browser's few connections to the Worker right when the backup 8-requests-at-once fallback tried to fire, starving it too. Now a timeout uses a real cancel (AbortController) that frees the connection immediately. Also added a same-page way to check (via `/health`) whether the pricing config actually got saved — checked it just now and confirmed **Brett's pricing config has not been saved yet anywhere** (not a bug, still needs the paste-in step from rule 109/111). **Verify (Brett): open the Hub and confirm work orders load promptly now; if it's ever slow again, it should fail cleanly with a Retry message within about 20-40 seconds instead of hanging.**

## 📋 Weekly Open Item Report — SHIPPED, DORMANT (Aug 18, GitHub Pages + Worker, not yet deployed live). FEATURE_LOG rule 111. 🔴 Needs Brett's Gmail OAuth setup before anything can send.
Built the full weekly/on-demand open-item report Brett asked for: rolls sub-customers up to the parent (Goldszmidt-style — several properties, one owner, one combined total), eligible once $75+ open OR the oldest invoice has been open >10 days, opt-in list so nobody's auto-emailed by default, and a customer-facing link (`ar-report.html`, no login, token-gated the same proven way the Shareable Work Order link works) with a Pay Now per invoice. Admin side is `ar-report-admin.html` (Hub → Dev Log → 🧰 TOOLS → 📋 Open Item Report) — preview-first "Send now" per customer, plus the weekly-auto-send checkbox. Full design in `context/AR_REPORT_BUILD_BRIEF_v1.0.md`. **Nothing sends yet — three things first:** (1) 🔴 Brett sets up the Gmail OAuth client + refresh token for `ridgecomaintenance@gmail.com` (~15 min at a computer) and adds `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/SENDER` as Cloudflare Worker secrets — until then any send attempt fails loud with a clear "Gmail not configured" error, nothing silently no-ops; (2) a live check of whether QuickBooks exposes its own `InvoiceLink` field on Brett's account (affects whether Pay Now is instant-redirect or falls back to "check your email"); (3) Brett opts in the first customer (recommend Goldszmidt, the example that prompted this) via `ar-report-admin.html` and tries one manual "Send now" before turning on the weekly cron (`Config.ar_report_enabled=TRUE`). **Verify (Brett) once Gmail is set up:** open `ar-report-admin.html`, confirm Goldszmidt shows as one rolled-up group (not split by property), tap "Send now," confirm the email arrives and the link opens `ar-report.html` with the right invoices and a working Pay Now.

## 🆕 Inspection Scheduler Phase 1 SHIPPED — new venture line, data model + admin onboarding (Aug 18, Worker `2026-08-18.4` + new `inspect.html`, live). FEATURE_LOG rule 110. B-226. 🔴 Needs Brett's first live pass.
New standalone page for a brand-new PM customer's annual rental-property inspections (SFH + multifamily, batched per-tenant slots) plus a shared engine for the AMSCRE gig-inspection income (#527). Researched Cal.com/Easy!Appointments as a free "Calendly backbone," rejected both (can't run on Cloudflare Workers, would need a second server+database) — built natively instead, same one-Worker/one-Sheet stack, mirroring Trash Service's architecture exactly (5 self-provisioning `Insp_*` tabs, 14 new `/insp/*` endpoints, all behind the existing WORKER_SECRET). Full design: `context/INSPECTION_SCHEDULER_BUILD_BRIEF_v1.0.md`. Phase 1 = data model + Brett's own onboarding UI only, no outreach/SMS yet: add customers (rental-portfolio vs AMSCRE), add properties (zip, single/multifamily, per-unit visit duration, sortable by zip), add units per property with tenant name/phone, set default weekly availability hours, and build blackouts three ways — multi-date one-offs added in a single save, recurring weekly (e.g. "nothing after 3pm Fridays"), or recurring annual (e.g. Christmas). Reachable from Hub → Dev Log → 🧰 TOOLS → 🔍 Inspection Scheduler. This build ran alongside a very active concurrent session (rules 107-109 below) — merged via rebase three times as the other session kept landing commits mid-merge; `BUILD_VERSION` bumped once more to `2026-08-18.4` to cover all of it, re-verified clean post-merge each time. **Verify (Brett):** open it, log in with your usual Hub code, add a test customer, add a multifamily property with 2 units, add one weekly availability rule and one blackout date, refresh and confirm it all stuck (proves the 5 new tabs provisioned correctly on the live sheet). **Next: Phase 2** — the actual slot-computation engine, outreach SMS, and the public no-login booking page tenants/borrowers tap.

## 🔧 Pricing engine extended for Brett's real markup model — code SHIPPED, config NOT YET SET (Aug 18, live). FEATURE_LOG rule 109. 🔴 Needs Brett to paste the config in.
Brett gave his real numbers: 35% markup up to $1,000 (never less than $50), 30% from $1,001–$2,000, 25% above $2,001, an $85 admin fee only on jobs $3,000+, and 5% processing added on top of everything, never broken out as its own line. The old pricing formula couldn't express a per-tier dollar floor or a conditional admin fee, so extended it (both the Worker and the Hub's mirror, kept in sync) to support both without changing anything for configs that don't use them. Hand-verified the math against 6 sample amounts. **This is a code change only — nothing is live pricing-wise until Brett actually saves the config.** The exact JSON to paste in (Cloudflare Worker secret `PRICING_CONFIG` is the recommended spot — keeps it off the shared Sheet):
```
{"tiers":[[1000,0.35,50],[2000,0.30,0],[null,0.25,0]],"adminFee":85,"adminFeeThreshold":3000,"cardFeeMult":1.05,"roundTo":5}
```
**Verify (Brett): after saving that, re-try "Generate proposal from scope + estimate" and confirm the total looks right for a job you can do the math on by hand (e.g. a $3,500 job should land at $4,685).**

## 🔧 scope-creator "Generate proposal" fixed — always crashed on a missing pricing arg SHIPPED (Aug 18, live). FEATURE_LOG rule 108. 🔴 Needs Brett's confirm.
Brett hit "Cannot read properties of null (reading 'finalPrice')" every time on scope-creator.html's "Generate proposal from scope + estimate" — this was never a regression, the server function was calling its own pricing-math helper with a missing argument so it could never have worked. Fixed to fetch the pricing config first and pass it through, same pattern used correctly elsewhere in the file. **Verify (Brett): on scope-creator.html, with an approved scope + saved vendor estimate, tap "Generate proposal from scope + estimate" and confirm a real proposal with a total and deposit shows up.**

## ⚠️ PROCESS BUG FOUND — BUILD_VERSION never bumped all day, so no client could self-detect today's fixes SHIPPED (Aug 18, live). FEATURE_LOG rule 107. 🔴 Needs Brett's confirm.
Brett said rule 106's fix looked "exactly the same" — turns out the real problem was one level up: `BUILD_VERSION` in worker.js (the thing every client polls to know a new deploy exists) never got bumped across ANY of today's frontend fixes (101/102/103/105/106), even though bumping it on every such deploy is a documented rule in the file itself. That means already-open tabs and GitHub-Pages-cached page loads had zero signal that anything had shipped — Brett's phone could easily have been stuck on JS from hours ago the whole time I was confirming things looked "live" from my own fresh fetch. Bumped it now (`2026-08-18.1`), confirmed live. **Verify (Brett): give the Hub up to ~60 seconds, or switch away from the Chrome tab and back — it should either auto-refresh itself or show "Update ready — tap to refresh." After that, work orders should load normally.** Going forward, every deploy that touches any of the 4 HTML files or worker.js bumps this — it's the only thing that lets an already-open device find out.

## 🔧 Hub data load hardened — 20s timeouts, no more infinite spinner SHIPPED (Aug 18, live). FEATURE_LOG rule 106. 🔴 Needs Brett's confirm.
After login was fixed (rule 105), Brett reported getting in fine but then the Work Orders list sat on "Loading..." for a full minute, nothing ever appearing — even after his wifi issue was resolved. Same underlying shape as the login bug: the main data fetch (`/hub-bootstrap`) had no timeout at all, so a stalled mobile connection could hang the promise indefinitely with the spinner never getting a reason to clear. Fixed: wrapped the load in a 20s timeout that falls through to a per-tab fallback (also now individually timed), and if everything still fails, swapped the spinner for a plain "Couldn't load data — check your connection" message with a tappable Retry link. **Verify (Brett): open the Hub and confirm work orders load normally; if a load ever stalls again, confirm you see a clear message + Retry link within ~20 seconds instead of a spinner that never resolves.**

## 🔧 Hub login hardened — visible feedback + fixed stale-cache race SHIPPED (Aug 18, live). FEATURE_LOG rule 105. 🔴 Needs Brett's confirm.
After rule 103's fix, Brett ran a clean controlled test (tap Enter once, wait 5s, no refreshing) and it still did "nothing" — a second, separate bug from the head-redirect regression. Found two real bugs in `doLogin()`: zero visual feedback between tap and outcome (any slow request or unexpected error looked identical to "the tap didn't register"), and the login could be silently answered by a stale cached `/config` response from the always-running auto-login-on-load check (3s de-dup cache keyed by path only, not by which access code was used). Fixed: "Checking…" shows the instant Enter is tapped, the cache is cleared before login's own request so it's always fresh, and the whole thing is wrapped with a try/catch + 8s timeout — so it will now ALWAYS show specific text (success, "Incorrect access code," a timeout warning, or a JS error) instead of ever going silent. **Verify (Brett): open the Hub fresh, type your access code, tap Enter once, and tell me exactly what text shows up.**

## ✅ Turnover trigger (B-100) + expanded WO bulk actions bar SHIPPED (Aug 18, live). FEATURE_LOG rule 104. 🔴 Needs Brett's confirm.
Brett asked for 3 things: (1) select-multiple on Review Bills — turned out already live from rule 98, no work needed. (2) A turnover trigger: standard turnover repairs + cleaning + paint as 3 connected work orders. Built so Repairs + Paint open immediately in parallel (lead time to line up vendors before a last-minute turnover), Cleaning is created On Hold and auto-releases once both finish OR the day before a target move-in date, whichever comes first. Two ways to start it: "🔄 Start Turnover" button (new, on Unit Detail) and "📅 Schedule Move-Out" (new, per tenant — books a FUTURE move-out date and starts the turnover now for lead time, WITHOUT deactivating the tenant the way the destructive red "Move Out" button does — they keep their PIN/portal until the real day). Idempotent per unit. (3) Expanded the Work Orders "☑ Bulk Edit" bar — it only did bulk status before; added Reassign, Priority, and two tenant toggles (Show/Hide the WO, notify on/off), each a loop over the same already-tested single-item endpoints. Bulk Cancel specifically got the "double protection" Brett asked for — a checkbox AND typing the word CANCEL, not a plain confirm() — since it's the one destructive bulk action. New `test/turnover.test.mjs` (30 assertions), full suite 27/29 (same 2 pre-existing unrelated failures). **Verify (Brett):** Start Turnover on a unit with a target move-in date, confirm Repairs+Paint are open and Cleaning is On Hold with a reason; mark Repairs+Paint Complete and confirm Cleaning auto-releases; try Schedule Move-Out on an active tenant and confirm they're NOT logged out/deactivated; on Work Orders try the expanded bulk bar including bulk Cancel's checkbox+typed-word gate.
## ⚠️ REGRESSION FIXED — rule 101 broke the Hub login; fixed same day SHIPPED (Aug 18, GitHub Pages only). FEATURE_LOG rule 103. 🔴 Needs Brett's confirm.
Rule 101 (earlier today) put a synchronous "always re-fetch the whole page" redirect at the very top of index.html/vendor.html's `<head>` — meant to guarantee freshness, but on a flaky mobile connection it could stall mid-download and leave the login screen visible with its own script (further down the file) never finished loading — button taps did nothing, no error, exactly what Brett hit. Fixed: removed the synchronous head redirect from both files; the staleness check now runs at the END of `<body>` (after the page already loaded and works), comparing against a `localStorage`-persisted last-known version — only reloads when a real new deploy is detected, never blocks or risks the initial load. Applied to all 4 files. **Verify (Brett): open the Hub, type your access code, tap Enter — should log in normally now, including right after switching apps.**

## ✅ Voice-to-text on every text block (Hub + all 3 portals) + vendor Description justified/larger SHIPPED (Aug 18, GitHub Pages only — no Worker change). FEATURE_LOG rule 102.
Brett: voice-to-text on any description/text block, Hub + every portal, "now and going forward"; vendor Description text was right-aligned, needed justified + bigger. Added a self-attaching 🎤 button to every `<textarea>` in index.html/vendor.html/tenant.html/owner.html — covers everything on load AND anything a modal/JS renders later (MutationObserver), so new fields don't need separate wiring. Feature-detected (Web Speech API — Chrome/Android; silently absent on iOS Safari, never blocks typing). Fixed vendor.html's Issue/Description value specifically (was sharing the generic right-aligned `.detail-val` class with short fields like address/phone) → `text-align:justify;font-size:13px`, that class left alone everywhere else. **Verify (Brett):** open any portal, tap a textarea, confirm the mic icon shows and dictation appends text; open a vendor WO with a multi-line Description and confirm it's justified + a touch larger.

## ✅ Hub + vendor site now force a hard refresh every time they're opened SHIPPED (Aug 18, GitHub Pages only — no Worker change). FEATURE_LOG rule 101.
Brett: "still don't have access to the site" + wants both sites to force-refresh on every open, flagged urgent/recurring. Likely explanation: GitHub Pages sets no cache-control headers, so a browser can serve a fully-cached `index.html`/`vendor.html` forever with zero network check — "no access" was plausibly a stale cached page, not an auth failure. Fixed in both files: a synchronous cache-busting redirect fires on every fresh open (before anything else parses, preserves all existing query params like `?page=`/`?wo=`), a `pageshow` guard forces a real reload if mobile's back-forward cache restores a stale in-memory copy, and both pages now poll `/version` and reload/banner immediately on foreground-return (not just every 60s) — the Hub never had this live-poll at all before; vendor.html had a softer version (B-093) that's now also open-time-forced. `node --check` clean on every inline script in both files. **Verify (Brett):** open the Hub and vendor portal fresh — should load normally (URL will show a harmless `?_hr=...` param). Next deploy after this one, confirm an already-open tab picks up the update within a few seconds of switching back to it.

# WHERE THINGS STAND — Aug 17, 2026

## ✅ Access-code visibility fixed — 828 S Charles St's electronic code now shows on its WO SHIPPED (Aug 17, Worker `2026-08-17.7`, live). FEATURE_LOG rule 100. 🔴 Needs one tap from Brett.
Brett's report: the electronic door code for 828 S Charles St wasn't showing on its work order in the Hub at all, and he wants to be able to mark ANY access code — lock code, lockbox code, electronic code, whatever type — as viewable only by him, regardless of type. Two real bugs: (1) the Hub's access-code widget only recognized codes literally typed `Lockbox`, and separately the lookup logic only recognized a handful of old-style type names — a code saved under the current naming (front-door code, unit door code, etc.) fell through invisible in the Hub, not just mislabeled; both are fixed, every active code now shows, correctly labeled by type. (2) Added a real per-code visibility control — a dropdown right on each code in the work order's "ACCESS CODES (live)" section, Auto or **Brett Only**. Set to Brett Only, that one code is hidden from every vendor/tenant/owner/shared-link view no matter its type, EXCEPT it still shows on a work order assigned to your own in-house record — exactly what you asked for. **🔴 One tap needed from you:** the code fix makes 828 S Charles St's electronic code visible now, but marking it "Brett Only" specifically is your call — open that WO in the Hub and set it via the new dropdown. **Verify (Brett):** open 828 S Charles St's work order and confirm the electronic code now shows; set it to Brett Only and confirm it disappears from that WO's vendor view (unless the vendor assigned is your own in-house record).

## ✅ Sheets quota error fixed — Hub keeps up during back-to-back work order updates SHIPPED (Aug 17, Worker `2026-08-17.7`, live). FEATURE_LOG rule 99.
Brett hit "Quota exceeded — Read requests per minute per user" working through work orders one after another, and correctly pushed back that he wasn't moving fast — he wasn't; every screen was firing several reads at once and the whole app (Hub, vendor, tenant, owner) shares one Google account's read quota. Fixed at the source, not by asking you to slow down: failed reads now automatically retry instead of erroring on screen, a page's several tab-reads are now bundled into one request instead of many, the login token is reused instead of re-minted every time, and repeat reads of the same data within a few seconds are served from a short cache instead of hitting Google again. **Verify (Brett):** work through several work orders back-to-back the way you were when this hit — it shouldn't error, and if it's ever still momentarily busy it should recover on its own instead of showing the red error box.

## ✅ Review Bills — select multiple bills and approve together SHIPPED (Aug 17, Worker `2026-08-17.7`, live). FEATURE_LOG rule 98.
Brett: "need to select multiple items for review bills, not one at a time then refresh after each one." Added a **"☑ Select multiple"** toggle on Review Bills — check the bills you want, a bar at the top shows how many and the running total, tap **"Approve selected"** and they all move to "approved, awaiting QuickBooks" in one shot instead of one at a time. Approved cards now also fade out of the list immediately either way (single or bulk), so there's no more manual refresh to see that an approval actually went through. Bills priced below your cost are skipped in a batch and flagged — those still need your one-at-a-time "you'd lose money, approve anyway?" confirmation, same as always. This does not send anything to QuickBooks itself — it only clears bills for review; sending to QuickBooks is still the separate, one-at-a-time-confirmed step it's always been, untouched. **Verify (Brett):** on Review Bills, tap "Select multiple," check 2-3 priced bills, tap "Approve selected," confirm the total matches what you expected, and confirm the cards clear without needing to refresh.

## ✅ WO edit "Save Changes" grid-limit error fixed SHIPPED (Aug 17, Worker `2026-08-17.6`, live). FEATURE_LOG rule 97.
Brett hit `Range (Work_Orders!AO1) exceeds grid limits. Max rows: 998, max columns: 40` trying to save an edited work order. The Work_Orders Google Sheet's grid is physically capped at 40 columns — separate from how many named fields the code uses — and the checklist save was the first write to ever land on column 41, which fails outright rather than growing the sheet. `ensureColumns` (used everywhere a new field gets written for the first time) now checks the sheet's real grid width first and grows it with headroom before writing a new header, so this can't recur on Work_Orders or any other tab. **Verify (Brett):** reopen WO-1133 (or whichever WO errored), edit it again, and confirm Save Changes goes through clean.

## ✅ "Fix email" button added directly to Send & Track SHIPPED (Aug 17, Worker `2026-08-17.5`, live). FEATURE_LOG rule 96.
Brett pointed out the Send & Track board still showed "no email" on 3 trash invoices after rule 95 shipped — correctly. Rule 95 fixed the underlying CODE (new trash invoices get an email; the backfill tools now verify their writes instead of lying about success) but that fix is not retroactive — an invoice already sitting in QuickBooks with a blank BillEmail stays blank until something actually goes and sets it, and that "something" was a separate page (`qb-invoice-email-backfill.html`) nobody had re-run yet. That's on me for not making that next-step obvious enough the first time. Fixed properly now: every "no email" row on the Send & Track board (`INVOICES → SEND & TRACK` / the screen in the screenshot) gets a **"Fix email"** button right next to the grayed-out Send button — tap it and it resolves the address from that invoice's QuickBooks customer (or the owner above it) and stamps it on, same verified-write logic as rule 95, then the row updates itself. No separate tool, no admin token to paste anywhere else. **Verify (Brett):** on Send & Track, tap "Fix email" on 151 W Lanvale St #1652 / 115 W 29th St #1651 / 153 W Lanvale St #1654 — each should either pick up an email and let you Send, or tell you plainly why it can't (no email anywhere up the QuickBooks chain, or "Bill with parent" blocking it).

## ✅ QB email backfill tools now verify writes + trash description cleaned up + button contrast sweep SHIPPED (Aug 17, Worker `2026-08-17.4`, live). FEATURE_LOG rule 95. 🔴 Needs one QuickBooks-side check.
Brett's follow-up: forcing the parent's email onto specific properties (billing through Phoenix Estate Rentals) kept "not sticking" no matter how many times he ran it, and trash invoices generally weren't reaching QuickBooks / seemed to route to the owner. Root cause found: **`qb-email-backfill.html`'s "Force" reported success even when QuickBooks silently ignored the write** — which happens on a customer with **"Bill with parent" turned on in QuickBooks**, where QuickBooks routes invoice emails to the parent no matter what's set on that customer's own email field. Both backfill tools (`qb-email-backfill.html` and `qb-invoice-email-backfill.html`) now double-check the email QuickBooks actually saved before calling it a success, and the preview now shows a **"bills via parent"** badge on any affected customer so this is visible up front. **🔴 Check this first:** re-open `qb-email-backfill.html`, preview again, and see if 1106 N Bond St / 1110 N Dukeland St now show that badge — if so, the actual fix is unchecking "Bill with parent" on those two in QuickBooks (Customer → Edit), not another Force click. Also: re-run `qb-invoice-email-backfill.html` for the 3 stuck trash invoices (115 W 29th St #1651, 151 W Lanvale St #1652, 153 W Lanvale St #1654) now that it verifies its own writes too. Separately shipped: trash invoice line descriptions are now just **"Trash Service"** (address and date dropped, per your request); and a button-contrast sweep fixed black-text-on-blue/green/red buttons across both QB tools, the QB Mapping "Link" buttons, the Send & Track chips, and the tenant/owner portals' green (and owner's blue) buttons — all now white text, matching the existing house rule.

## ✅ Trash-service invoices now carry a send-to email SHIPPED (Aug 17, Worker `2026-08-17.3`, live). FEATURE_LOG rule 94. 🔴 May need a one-time QuickBooks backfill.
Brett's report: trash-service invoices "not making it to QuickBooks," erroring about a missing email even though the properties have one in QuickBooks. Cause: `trashInvoice` never set `BillEmail` on the invoice it posts — QuickBooks does NOT copy a customer's saved email onto an API-created invoice (this is the exact bug rule 60 already fixed for the main Hub invoicing flow months ago; the newer trash-service billing path just never got the same fix). Now `trashInvoice` reads the QuickBooks customer's email right before posting and stamps `BillEmail`, with the same "never let an email problem block the invoice" retry the main flow uses, and the same warning shown up front in Preview, before Send. **🔴 If any trash invoices already posted to QuickBooks with no send-to email, those specific ones need a one-time fix — the existing `qb-invoice-email-backfill.html` tool (📧 Fill missing QuickBooks emails / backfill tool) queries QuickBooks directly, so it'll pick these up too; run it once.** **Verify (Brett):** preview an unbilled trash property/week — no "no email" warning if that QB customer has one; send an invoice and check it in QuickBooks for a filled Customer Email field.

## ✅ Tenant portal hides pre-move-in work orders SHIPPED (Aug 17, Worker `2026-08-17.2`, live). FEATURE_LOG rule 93.
Brett's request: "remove tenant from work order so they are not notified of background work orders that predate them" — example, Matt at 151 W Lanvale St Apt 2 seeing a turnover-cleaning WO opened right around his move-in. Found the SMS gate (`isTenantNotifiable`) already skipped pre-move-in WOs but the tenant PORTAL'S own work-order list (`tenantWorkorders`) never applied that same check — so a tenant wouldn't be texted about a background WO but could still see it by opening the portal. Fixed by sharing one date-check helper (`isBackgroundWO`) between both, so they can't drift apart again. **This is automatic — no admin action, applies to every existing and future WO on next portal load.** Also relabeled the Hub's existing "Show to Tenant" toggle (WO detail → Tenant Access Settings) to name the actual tenant ("Show to Matt") and added a "🚫 Auto-hidden from [name]" note there when the new date rule is why a WO isn't showing, so the manual override Brett asked for is both already there and now legible. **Verify (Brett):** open Matt's portal (or whichever tenant/WO fits) and confirm the turnover-cleaning WO is gone from his list; open that WO in the Hub and confirm the "Show to Matt" label + auto-hidden banner appear.

## ✅ Vendor bug-report fixes SHIPPED (Aug 17, Worker `2026-08-17.1`, live). FEATURE_LOG rule 92. 🔴 One item needs Brett's tap, not code.
Brett reported vendors can't upload photos, can't scroll/album-view photos (only Drive's own back-and-forth single-file viewer, split across separate before/after/report/receipt lists), can't upload their invoice, and the Hub drops typed invoice charge/memo text if he clicks away from the WO before hitting Save draft. Also two live incidents: **Oscar couldn't upload photos for a Philadelphia Rd job**, **Eddie couldn't access photos for a Gladden Ave job**. Root-caused and fixed all five (public repo commit `a29561d`):
1. **In-app swipeable photo lightbox** (index.html + vendor.html) — photos were plain `<a target=_blank>` link chips, no gallery component existed anywhere in either file. Now real thumbnails (`_rcWoItems`/`rcOpenLightbox`), swipe/arrow-key through the WO's FULL photo+video set as one album regardless of which type section you tapped into. Videos play inline; PDFs/pre-fix rows without a `Drive_File_ID` fall back to the old link-out chip.
2. **Photo/video upload retry** (`_uploadOneFile` in both files) — the upload PUTs bytes straight from the phone/browser to Google Drive with **zero retry**; one dropped packet on a flaky job-site connection silently failed the whole photo. Now auto-retries up to 3x (fresh upload session each try, short backoff) + a manual Retry tap if all 3 fail. **This is the leading explanation for Oscar's Philadelphia Rd failure** — not confirmed against Worker logs (no log access from Cowork), but architecturally it's the only path in the whole photo/upload system with no error recovery.
3. **Vendor invoice FILE upload** (vendor.html bill modal + worker.js `addVendorBill`) — vendors had a text box for their invoice *number* but no way to attach the actual document; only receipts had an upload control. Added one (routes to the private `_Internal — Vendor Bills` folder, never customer-shared, same as receipts) and surfaced the file link on the Hub's Review Bills card (`irBillContext`/`vendorInvLine`) — Brett couldn't see it even if a vendor had one.
4. **Invoice-field autosave** (index.html `invBuilderHtml`) — Customer Charge / Invoice Memo only wrote on an explicit "💾 Save draft" tap; `saveDraftInvoice` existed but nothing called it automatically. Now both fields autosave `onblur`, which fires before a click elsewhere completes — covers "accidentally clicked away."
5. **Tenant + owner portal vendor contact** (worker.js `enrichWO`) — tenant.html and owner.html both had a "Technician"/"Vendor" row already wired to `wo.vendor_name`, but `enrichWO` **never resolved `Vendor_ID` to an actual name for any non-vendor view** — always rendered blank. Now resolves name+phone+trade when a vendor directory is passed in; tenants get all three (to coordinate access), owners get name+trade only (phone withheld on purpose — keeps the vendor relationship mediated through Brett, not owners going around him to negotiate).

**🔴 Eddie's Gladden Ave "can't access photos" is very likely NOT a new bug — it's the still-unactioned Aug-8 photo-sharing backfill.** FEATURE_LOG rule 56 (Aug 8) made new uploads anyone-with-link readable, but pre-fix media stayed private to the service account, and the one-tap backfill (**Hub → Dev Log → 🖼 Fix photo/video sharing → Share them all**) has never been run — every mention of it in this file and FEATURE_LOG still reads "one tap left for Brett." No tool available to any Cowork session can grant Drive sharing or click that button; this needs Brett's tap in the live Hub. If Gladden Ave's photos predate Aug 8, this is almost certainly it.

**Verify (Brett):** open a WO with photos on the Hub or vendor portal → tap a thumbnail → confirm it opens full-screen and swipes to the next one instead of bouncing to Drive. Submit a vendor bill with an invoice file attached → confirm it shows on the Review Bills card. Type something in a WO's invoice memo, click a different WO without saving → reopen the first WO → confirm the text is still there. Open a tenant login for a WO with a vendor assigned → confirm Technician name + phone show. Then run 🖼 Fix photo/video sharing for Eddie's issue.

## ✅ Scope Creator workflow SHIPPED (Aug 13, `2026-08-13.4`, live). FEATURE_LOG rule 90. 🔴 Not yet run against live Sheets.
The estimating workflow Brett asked for, end to end (B-030/031/076). A new **📝 Scope Creator** button on the Hub home + 🧰 TOOLS opens `scope-creator.html`. Flow: pick/add a property/unit → add notes by **typing, voice (Web Speech), an uploaded handwriting photo (OCR), or a file picked from the handwriting scan Drive folder** → **Organize into a Scope of Work** (AI turns messy notes into itemized work, no prices) → edit by hand OR by **command** ("remove the plumbing section, another vendor will do it") → **split** part of the job into its own scope for a different vendor → **Approve** → **Create Work Order** (Type `estimate`, Status **`Estimate Requested`**, unassigned, line items in the description + checklist, staged before-photos re-keyed onto the WO) → **capture the vendor's estimate** on the scope (editable after, for when the vendor proposes a different solution) → **Generate the customer proposal** from scope + estimate. New `Scopes` sheet tab + 13 `/scope/*` endpoints (admin-gated); OCR reuses the Receipt-Reconciler Claude-vision path; the WO/photo/property-add plumbing is all reused. **Money guard:** the proposal applies markup **server-side** (`calcTieredEstimate`) and emits **only the final customer price + deposit** — no cost/markup ever reaches the client or the proposal (Aug-10 hard rule; enforced by a no-leak unit test). Verified: `node --check` clean, `test/scope-core.test.mjs` 13 assertions, full suite 26/26 green, client grepped clean. **First live check for Brett:** run one scope through create→organize→approve→Create WO (confirm it appears as "Estimate Requested" with the checklist + photos), then add an estimate and Generate Proposal (confirm the customer total shows and no cost leaks). **Pick-from-scan-folder** needs the `maintenance-hub-sheets@…` service account shared on the handwriting Drive folder (same manual step as the Receipt Reconciler); typing/voice/photo-upload work without it.

## ⚡ NEW STANDING RULE — Session Efficiency Protocol v1.0 (LOCKED Aug 13) — ✅ ALWAYS-LOAD
Brett was hitting his daily/5-hour/weekly limits. Fix = **load light, delegate heavy reads to
subagents, break at phase boundaries.** Read `SESSION_EFFICIENCY_PROTOCOL_v1.0.md` — it now governs
session loading and **supersedes brett-context Step 2's "read every file."** Highlights: (1) LIGHT LOAD
default — minimal always-set only, everything else task-scoped/on-demand; grep BACKLOG/CAPTURE, never
full-read. (2) Delegate mechanical reads/searches to cheap subagents (Brett's "automate the model" for
sessions — he trades ~30–60s latency for big burn savings). (3) **Checkpoint-and-resume:** at ~15–20
turns or a phase boundary, STOP → save `SESSION_STATE.md` → tell Brett to open a new chat with
`resume ridgeco`. (4) Classify the task before loading (brett-flow Step 0). (5) Brett habits: PAT +
`load context` + ask in ONE message is correct (don't split); front-load the whole task; new chat per
new issue; prefix quick lookups (`quick:`). This is the SESSIONS meter; **B-127 is the separate APP
API meter** — don't conflate.

## ✅ Hub UX pass — 6 items shipped (Aug 13, `2026-08-13.3`, live). FEATURE_LOG rules 86–89.
One Cowork session, all pushed to `main` (Pages + Worker auto-deploy): **(86)** readable buttons + semantic color convention (white text on all colored buttons; green reserved for approve/confirm/authorize only; red for void/delete; de-greened the TOOLS launcher) + invoice-builder mobile-overflow fix. **(87)** add photos/receipts at WO creation (reuses the Before/After/Receipt component) + sticky Edit/Status bar on the WO detail. **(88)** vendor **accept-gate**: lockbox code + tenant contact are withheld (server-side, `enrichWO` `vendorView`) and the dispatch SMS no longer carries them — they unlock only after the vendor Accepts (portal or SMS `YES`), which now fires a tenant "accepted" SMS. **(89)** optional per-WO **itemized checklist** (`Work_Orders.Checklist`, new `POST /wo/checklist`): vendor checks items off, an unchecked item needs a reason (Not applicable/Separate WO/Needs estimate/Couldn't access/Needs parts), and **Complete is gated** until all items are resolved. All headless-verified (parse/render/gate); **none run against live Sheets yet** — first real WO through each is the check. Behavior change to respect: the assignment SMS deliberately omits lockbox/tenant now (that's the gate) — don't "restore" it.

## ✅ Receipt Reconciler Phase 2 SHIPPED — daily Drive scan + confirm-first UI (Aug 13, `2026-08-13.1`, live). 🔴 One manual step still needed to actually run.
Closes the loop opened by Phase 1 (rule 84) per Brett's explicit "queue up phase 2" instruction. Full pipeline is built, deployed, and unit-tested (`test/receipt-suggest-core.test.mjs`, 11 assertions; full suite green, 25 files): a daily sweep (riding the 11:00 UTC digest cron) of the real **"Receipts and Invoices"** Drive folder → one cheap OCR call per new file (now also extracting line items + card last-4) → the zero-AI matching engine → a `Receipt_Recon_Queue` row Brett reviews on the new **`receipt-reconciler.html`** page (linked from 🧰 TOOLS) and taps **Confirm** (posts the real `Receipts` row via the same `addReceipt()` every other entry path uses) or **Skip**. Nothing bills itself. FEATURE_LOG rule 85 has the full breakdown.

**🔴 BLOCKING: the Worker's runtime service account (`maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com`) is not shared on the "Receipts and Invoices" folder (or its "PAYABLES Inbox" parent) — checked live via `get_file_permissions`, only brett@/info@/the domain are on it.** That means `receiptReconScan`'s Drive listing call returns 0 results — always — until this is fixed. No tool available to any Claude session can grant Drive sharing; this is a **2-minute manual step for Brett**: open the "PAYABLES Inbox" folder in Drive → Share → paste `maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com` → Editor → Send. Once shared, the next daily cron run (or a manual "Scan now" tap on the new page) will pick up everything currently sitting in the folder.

**Also left in that folder from testing:** `recon_smoke_test.png` — an obviously-fake test receipt image (labelled "SMOKE TEST — SAFE TO DELETE" right in the image) used to probe the sharing issue above. Safe to delete any time; it'll otherwise queue itself once sharing is fixed.

**Small addition while in there:** `receiptSuggestCore` (the phase-1 decision engine) is now a single pure function shared by both the interactive endpoint and the new bulk scan — was two near-duplicate code paths before. The customer-card exclusion list can now also live in a Config sheet row (`receipt_customer_cards`), not just the Cloudflare secret `RECEIPT_CUSTOMER_CARDS` — same open pending item as before (Brett hasn't set either yet; the Jennifer/Goldszmidt Visa `7442` was the flagged candidate).

## ✅ Payflow trio + back half of the Aug 12 session — reconciled and closed out
The three-part payflow build (Send & Track invoices / pay vendor bills / in-house reconcile exclusion — rules 80–82) shipped and has been live since Aug 12. In the second half of that session: all fresh Alex Busey vendor invoices were entered and reconciled against Brett's own overlapping labor (new WOs created where his time had never been captured); a full-year purchase audit across brett@ and info@ Gmail found and reconciled ~45+ receipts across ~13 properties (3 new work orders, one new customer+property — Cohado/Paulo Gregory linked to the existing QB customer 341, not duplicated); and the 2930 St Paul St question was closed via Brett's uploaded QB transaction-history CSV (continuous invoicing confirmed, no gap). WO-1048 (151 W Lanvale Apt 1) is already status **Invoiced** — its two attached receipts ($179.40 + $83.90) will NOT auto-appear on a new customer invoice; Brett may want to reprice/re-send that WO if he intends to actually bill for them.

**Still open from Aug 12, unchanged:** (a) set Cloudflare secret `PAY_AUTH_CODE` before using bill-pay (a made-up passphrase, NOT the QuickBooks login); (b) **rotate the classic GitHub PAT and the Hub admin token** both pasted into chat this session/last — still exposed.



## ✅ Payflow trio: Send & Track + Pay vendor bills + reconcile excludes in-house (Aug 12, built + tested + validated; NOT yet pushed/live)
Three things Brett asked for in one session, all built against the live code, all with tests, all
ridgeco-validate PASS (bill-pay PASS-WITH-NOTES, 2 🟡 hardening only). **Held together per Brett; ready to push.** FEATURE_LOG rules 80–82.
1. **Invoice Send & Track (rule 81)** — the fix for "invoices I created but never sent just sit, and QB can't filter them." `qbSendInvoice` only ever CREATED the invoice in QB (never emailed it), so every Hub invoice sat as EmailStatus `NeedToSend`. New read-only `GET /ar/invoices` classifies every invoice **not_sent → sent → overdue (days_overdue) → paid**; a "📤 Send & Track" board at the top of **Review Bills** lists the not-sent pile first with one-tap **Send** (reuses `/ar/remind`, preview-first → confirm → QB emails it). "Viewed" is intentionally omitted — QB doesn't expose it via API; Brett only needs Sent/Paid/Overdue.
2. **Pay vendor bills from the Hub (rule 80, B-217A)** — Who-to-Pay rows in `PAY THE VENDOR` get checkboxes + a bank-account picker; **preview-first** (live balance re-fetch, skips paid) → confirm → **passphrase** (verified server-side vs Cloudflare secret `PAY_AUTH_CODE`, lock-out after 5 bad tries) → one `BillPayment` per vendor. **DORMANT until Brett sets `PAY_AUTH_CODE`** (real pay returns 503 until then). First live pay = a supervised single-bill tap.
3. **Reconcile excludes in-house (rule 82)** — you-as-vendor / pass-through jobs have no payable (the customer's payment settles it), so they're kept OFF the Vendor Reconciliation list and its money totals (with a muted "N in-house jobs" line). SAFETY: a row with a real open QB bill is never hidden.

**Brett's go-live list:** (a) set Cloudflare secret `PAY_AUTH_CODE` before using bill-pay; (b) confirm your own vendor record is flagged In-house (or that pass-through jobs carry `QB_In_House`) so reconcile hides them; (c) **rotate the classic PAT** you pasted into chat (still exposed — revoke + reissue).

# WHERE THINGS STAND — Aug 11, 2026

## ✅ WO Room/Area field + bedroom-level keys — SHIPPED (Aug 11, Worker `2026-08-11.1`; index.html + vendor.html + `Work_Orders.Room`)
Brett wanted to route vendors to a specific **room** inside a unit (e.g. "change the lock on Bedroom 2") **without** creating another QuickBooks billing layer — because Apt 1 at 151 W Lanvale is being sublet as rooms by the tenant. Solution = rooms are a **label dimension, not a Unit** (a new Unit would spawn a QB sub-customer). Two parts, both live-verified against the production Sheet:
1. **Bedroom-level keys** — interior-door locks live as `Keys` rows under the parent unit, room in `Lockbox_Location`. Wrote the first one: **151 W Lanvale (Property 5) · Apt 1 (Unit 8) · "Bedroom Door" · Key_Code A4 · Location "Bedroom 3"** (Keys ID 68, single row). Already surfaces to the assigned vendor via `getWOLockboxes`.
2. **`Room` column on `Work_Orders`** + optional **Room / Area** box on the New-WO and Edit-WO forms (auto-suggests rooms already on file for the property), shown on the WO detail modal, the **vendor SMS** job line, and the vendor.html job card. **Owner/tenant portals never render it** (grep-verified) — the owner's bill stays a single Apt-1 line, so it's internal/vendor-only, no deception, no QB layer. FEATURE_LOG rule 77.

Also fixed a latent `sheet-ops` bug (rule 78): `add_column_header` used `values.update`, which won't widen a sheet's grid — so adding the `Room` column to `Work_Orders` (already at its 39-col grid edge) failed silently and left `pending.json` un-archived. `run_ops.py` now `appendDimension`-expands the grid first. **Ops lesson:** a lingering `pending.json` = the run failed mid-way; verify the live sheet and re-queue only the un-applied ops (never blindly re-run an `append_row`).

**Note (Aug 11):** the classic GitHub PAT Brett pasted into the Cowork chat to load context is exposed in that conversation — rotate it (revoke + reissue) per the CREDENTIALS_MAP "never store the token" rule.

# WHERE THINGS STAND — Aug 10, 2026

## 🔒 HARD RULE — NEVER LEAK COST / MARKUP (LOCKED Aug 10, 2026 — after a live breach)
**Brett's cost, ANY vendor/contractor cost, markup, margin, or the math that derives a price is STRICTLY CONFIDENTIAL.** It must **NEVER** appear on any customer-facing or externally-shared/hostable artifact — not in visible text, not in a footnote, not in an HTML comment, not in JavaScript, not in a filename or metadata, and **NEVER committed to the public `Ridge-Co/RidgeCo` repo (code OR context files).** Customer/vendor-facing documents show **only the final price for that audience** — never "show your work," never the breakdown. Confidential pricing lives ONLY in private stores (Cloudflare secret env, the private Google Sheet, or the private `brett332/data` repo). **Before delivering, hosting, pushing, or sending ANYTHING a customer / vendor / the public could see, grep it for cost / markup / margin / vendor-cost / base and confirm none is present.** Applies to proposals, estimates, invoices, emails, listings, PDFs, HTML, and all code/comments. **A violation is a CRITICAL failure — Brett's #1 non-negotiable.** (Incident: a proposal's on-screen banner + HTML comment carried the base cost + markup, and the same numbers were pushed into the public `worker.js`; the customer screenshotted the markup. Remediation: markup moved to the private env `PROPOSAL_CONFIG`; all documents scrubbed; this rule locked. See FEATURE_LOG rule 73.)

## ✅ Proposals de-dup + Stuck-WO detector (Aug 10, Worker `2026-08-09.14`)
Two builds. (1) **De-dup:** proposals.html now flags a proposal that's already in the build queue or
already shipped ("✅ already built" / "⏳ in build queue", dimmed + non-selectable) instead of
re-offering it — fixes the "why is a built item back as a checkbox" confusion. `opsQueueRead?all=1`
backs it. (2) **Greenlit #2 shipped — stuck-WO detector:** read-only `GET /stale-wos?days=N` +
a red "⏰ Stuck open work" Command Center card for open jobs sitting past N days. Both SAFE/read-only.
FEATURE_LOG rules 70–71. Also fixed the stale-cache button bug (rule 69, `.13`) — proposals +
Command Center now auto-refresh on new deploys.

## ✅ Action Center + Dev Log reconcile mechanism + tools cleanup — SHIPPED (Aug 10; worker.js /wishlist/status only, rest frontend)
Three things Brett asked for in one session (FEATURE_LOG rules 73–75):
1. **Action Center** (`action-center.html`, NEW) — on-demand tracked work: **who to pay** (`/qb/payables` PAY-THE-VENDOR), **invoices to process** (`/qb/ready` + submitted vendor bills), **overdue invoices** (`/ar/aging`, opens each in QuickBooks), **receipts to file** (`/receipt-queue`). Each item = a plain prompt ("owner paid ✓ · $460 due vendor") + a button that opens the right gated tool ready to act. **No money-write, no new Worker endpoint** — actions deep-link into existing flows (respects BUILD_ORDER/AUTONOMY). Reachable from **both** the Command Center (a card) and the Hub → Dev Log → 🧰 TOOLS. Needed a small `?page=<id>` deep-link handler in index.html so it lands on the exact Hub screen.
2. **Dev Log reconcile mechanism** — the Hub Wishlist now carries a per-item **Status** (Active / In progress / ✓ Done / ✗ N-A) with buttons + a filter + "Clear Done / N-A" archive (backed by `POST /wishlist/status`). Plus a documented **Reconciliation mechanism** block at the top of BACKLOG.md (repeatable session-close pass + a first Aug-10 pass verifying what FEATURE_LOG confirms shipped).
3. **Tools cleanup** — the flat Dev Log DATA TOOLS + TOOL PAGES are now one 🧰 TOOLS area, sub-grouped: On-demand & dashboards / Money & QuickBooks / Data hygiene / Diagnostics.

**Verify (Brett, on the live Hub after this deploys):** (a) Dev Log → 🧰 TOOLS → **Action Center** opens; check "Pay these vendors" matches what you actually owe, tap **Pay →** lands on Who-to-Pay; tap an **overdue** invoice → opens in QuickBooks. (b) Command Center now shows an **Action Center** card near the top. (c) Dev Log → Wishlist: mark one item **✓ Done**, refresh, confirm the status sticks and the filter counts move. **Not yet eyeballed live by Brett.** Adversarial money-review passed (one fail-silent bug caught + fixed pre-push). NOTE: `listVendorBills`/`listReceiptQueue` swallow errors to `[]`, so those two Action-Center cards can't fully "fail loud" if Sheets is down — small follow-up in those handlers.

## ✅ FIRST GREENLIT-QUEUE BUILD SHIPPED — Optimizer review now runs Mon + Wed (Aug 10, Worker `2026-08-09.12`)
The greenlit→build loop produced its first shipped item. Read the live queue via the new `OPS_QUEUE_TOKEN`
(read-only), took the top *buildable* item — **ID-1 "Increase Weekly Review Run Frequency"** — and shipped it.
The Optimizer's weekly telemetry review fired only Mondays; it now also runs Wednesday (`0 12 * * 3`), halving
max issue-detection lag (7d → ~3.5d). Two-line change (wrangler cron + `scheduled()` branch), SAFE-class,
no money/PII/auth. FEATURE_LOG rule 68. **Note:** the queue item is still marked `greenlit` — mark ID-1 **Done**
on proposals.html (status write needs the admin secret, which this session doesn't hold). Literal top queue item
(ID-6 "Expand job volume") was skipped as a build: it's a strategic audit ("wire 3 of your manual tasks"), not a
code spec — needs Brett's input, not a push.

## ✅ Hub UX: Review Bills filtering + reachable WO Edit + editable WO Source — SHIPPED (Aug 10, index.html only)
Three frontend fixes Brett asked for, pushed to `main` (GitHub Pages auto-deploys; **no worker.js change**). See FEATURE_LOG rule 67.
- **Review Bills now filters/searches** by Vendor, Property, Owner, **Type** (Manual/Tenant/Owner/Recurring), Trade + a free-text box, with a live "Showing X of Y" count and Clear. Filters by hiding cards (preserves `_irBills[i]` indexing that `irClearFromQueue` + the `'ir'+i` billing panels depend on) — do not refactor into a re-render.
- **WO detail modal** has an **✏️ Edit** button in the header (no more scrolling to the bottom); bottom Edit kept.
- **Edit WO** has a new **Source** dropdown saving to `Work_Orders.Type` via `/wo/admin-update`.
Not yet eyeballed on the live Hub by Brett — first check: open Review Bills, try each filter; open a WO → header Edit → change Source → save → confirm it sticks + shows in the audit trail.

# WHERE THINGS STAND — Aug 9, 2026

## 🔒 Read-only `OPS_QUEUE_TOKEN` for the Prepare agent — SHIPPED, DORMANT (Aug 9, Worker `2026-08-09.9`)
Closing the greenlit→build loop (Brett's Q1:C + Q3:B). New narrow token in the auth gate, accepted
**only for `GET /ops-queue`** (read-only; the write path still needs the admin secret). Same
inert-until-env-set pattern as `TRASH_NUDGE_TOKEN`. **To turn on:** set Cloudflare env
`OPS_QUEUE_TOKEN` = a random string, then the Tue/Fri **Optimizer Prepare agent** gets that value in
its scheduled-task prompt so it can read the greenlit queue and draft build-ready briefs headless —
never deploying (Rung 0–1). Deploy is a no-op until the env var exists. FEATURE_LOG rule 66.

## ✅ Optimizer greenlit-workflow build — SHIPPED (Aug 9, Worker `2026-08-09.8`)
Built and verified in a prior Cowork session, but that session's git proxy lost push authorization
for `Ridge-Co/RidgeCo` mid-way ("repository not in this session's authorized repository set"), so it
was committed locally only (commit `720a09f`) and delivered as a `.patch`. Finished in a follow-up
session: the patch 3-way-applied cleanly on top of current `main`. Base kept moving during the finish
(a concurrent session shipped vendor-reconcile live-QB transactions + B-217 bill-pay design and had
itself already taken `2026-08-09.7`), so this build was merged on top and bumped to **`2026-08-09.8`**
— not the `.5` the stale-base patch named. Pushed to `main`, Cloudflare + Pages auto-deployed, and the
auth-boundary smoke test passed.

**What the build does (the fix for "you keep handing me half-built tools"):** the proposals →
greenlit → build flow was a read-once dead end — you could select a proposal, then it vanished
into a "greenlit" bucket you couldn't open, copy, or act on (and headless Claude can't read it
either, no worker secret). Now:
- **proposals.html** renders greenlit items **in full** (problem/action/impact/chips), with a
  per-item **📋 Copy build brief** + **Copy all** (markdown into a modal you paste into a Claude
  session — this bridges the worker-secret wall: the item comes to Claude), plus **status buttons**
  (Building / Done / Drop → `POST /ops-queue-update`) so the queue stays live, and a **thin-data
  banner** when a review ran on <20 rows.
- **worker.js** — `OPS_QUEUE_COLS` gains `Problem` (the WHY survives approval); `opsApprove`
  stores it; new admin-gated `opsQueueUpdate` (SAFE class); `computeTelemetryMetrics.byJob`
  enriched with per-type `success_rate`+`avg_latency_ms`; thin-data guard in `runWeeklyReview`.
- **command-center.html** Optimizer card — **per-job-type health table** + **zero-activity-day**
  flag ("⚠ no jobs logged today").
- Verify gate done: `node --check` clean; adversarial review caught + fixed a CRITICAL (dead
  status buttons — `onclick` double-quote collision, now `h(jsq(id))`). Live smoke test PASSED on
  `2026-08-09.8`: `/version`=.8; `POST /ops-queue-update` and `POST /admin/share-attachments` both
  401 unauthed; `GET /ops-queue` + `/ops-telemetry` respond (401, gated + deployed); `/health` 200.
  The authed 200 data-read is untested (admin secret lives only in Brett's browser — not faked).

**The durable principle this build enforces (how we work now):** *every "store" ships with its
"act" in the same build.* Storable data isn't done until it moves into a workflow — if the
workflow isn't built, it's named in the plan up front, never discovered later.

## One place for tool pages + QB-email backfill fixed (Aug 9)
Two things shipped (Worker `2026-08-09.1`):

**1. 🔗 TOOL PAGES launcher.** Brett's standing preference is now standard: every standalone admin page launches from **Hub → Dev Log → 🔗 TOOL PAGES**, never a remembered URL. Seeded with **📧 Fill missing QuickBooks emails**, **📊 Command Center**, **🗑 Trash Service billing**. Each opens in a new tab already logged in (same origin shares `mh_auth`). Convention = FEATURE_LOG rule 57; any new tool page adds its button here in the same commit.

**2. QB email backfill had two real bugs (FEATURE_LOG rule 58), both fixed.** (a) The "Too many subrequests" wall Brett hit — apply does 2 QB calls per row in one Worker invocation and blew Cloudflare's subrequest cap, so repeated tries never stuck. The page now writes in **chunks of 8**. (b) A property that already has a **stale/wrong** email was silently invisible (this is why **153 W Lanvale** never showed) — the tool only ever filled blanks and dropped anything with an email. Now there's an **"Already has an email — not changed"** section; tick a row and **Force the parent's email** to overwrite it with the owner/property email (opt-in, preview-shows-the-source, confirm-gated). Default behavior still never overwrites.

**Then (`2026-08-09.2`) — the Hub≠QuickBooks disconnect (FEATURE_LOG rule 59).** 153 W Lanvale landed in **Skipped** even though the Hub shows goldszmidtproperties@gmail.com. That email is in the Hub's Sheets (`Owners.Billing_Email`), but the QuickBooks **Goldszmidt owner** customer is **blank**, so the backfill (QB-only) has nothing to copy down. Added a filterable **"Every QuickBooks customer — the real email on file"** panel (reads straight from QB, prints "(blank in QuickBooks)" when QB genuinely has nothing) + a **type-an-email-and-Set** control for any row (`{apply:true, email, ids}` — validated, overwrites, chunked, confirm-gated).

**Vendor reconciliation (`2026-08-09.5`, FEATURE_LOG rule 62).** New read-only 💵 Vendor reconciliation page (Dev Log → 🔗 TOOL PAGES). Pick any vendor → every bill joined to live QuickBooks: what's still owed the vendor, whether the owner has paid us, ages, and a status per row. **COLLECTED — pay vendor** = you were paid but the vendor wasn't (settle those); Waiting on owner = owner hasn't paid; No/Linked-not-found vendor bill = the payable isn't (properly) in QB. For **Allen George / Kevin Rd**: open it, pick Allen George, and the Kevin Rd row's status + age answers whether it's stuck on the owner or an unrecorded bill. Batched QB reads, never writes/sends.

**Then (`2026-08-09.3`) — the ACTUAL fix for the pasting (FEATURE_LOG rule 60).** 153 W Lanvale HAS its email in QuickBooks, yet Brett still had to paste it into every invoice. Root cause was never the customer record — it's that `qbSendInvoice` created invoices with **no BillEmail**, and QuickBooks doesn't auto-copy the customer's email onto an API-made invoice. Now the invoice carries `BillEmail` = owner's billing email (fallback: owner's QB customer email), with guards so a bad/over-long address can never block the invoice (retry-without-email + warn). From now on, invoices Brett sends through the Hub arrive in QuickBooks with the send-to already filled — no more pasting. (Backfilling customer emails is still worth doing for tidy records + the auto-send flow, but it was not the thing causing the pasting.) Known follow-up: `/trash/invoice` still needs the same BillEmail line.

**How Brett fixes 153 W Lanvale now:** open 📧 Fill missing QuickBooks emails → **Preview**. Scroll to **"Every QuickBooks customer"**, filter **Goldszmidt** — the owner row will read **(blank in QuickBooks)**, which is the real problem. Either: tick the **owner** row, type goldszmidtproperties@gmail.com, **Set**, then **Preview** again and the Lanvale properties/units flow down automatically as blanks-to-fill; OR just filter **Lanvale**, tick those rows, type the email, and **Set** them directly.

## Vendor photo/video access fixed (Aug 8) — one backfill tap left for Brett

Vendors couldn't open job photos/videos in the portal — they hit a Google sign-in wall.
Root cause: uploaded WO media was private to the service account and only ever shared on a
QB invoice send. Now every job photo/video is shared **anyone-with-link at upload** (both
upload paths); vendor cost docs (receipt/bill/invoice) stay private. Deployed `2026-08-08.1`.
**One tap left for Brett:** Hub → Dev Log → **🖼 Fix photo/video sharing** → it shows a count,
then **Share them all** to backfill media uploaded before the fix. (I can't run it from Cowork —
it needs the admin token, which only lives in your browser.) See FEATURE_LOG rule 56.

## Trash Service shipped — needs first live send + push nudge (Aug 7)

New one-tap recurring billing for the twice-weekly $40 trash service (B-205). Page:
`ridge-co.github.io/RidgeCo/trash.html` (Hub `mh_auth` code). Worker `2026-08-07.6`.
Tap a property → before/after photos → optional $20-increment extra → Save logs the visit;
one weekly QB invoice per property, **preview-first**, photos attached. In-app "Needs
attention" nudge is live. **Two things left for Brett:**
1. **First real invoice send** — add the 3 properties (115 W 29th; 151 & 153 W Lanvale) via
   the page's "+ Add a property" (pick the existing QB customer + item), log a visit, then
   Preview & send ONE invoice and check it in QuickBooks. Never run against live QB yet.
2. **Phone push nudge** — set Cloudflare env `TRASH_NUDGE_TOKEN` (any random string), tell
   Claude the value, and it'll create the scheduled task that polls `/trash/unbilled` and
   pushes. The endpoint gate is already deployed (inert until the env var exists).
   See FEATURE_LOG rules 50–53.

## Cleaning-vendor invoicing — DONE + reconciled (Aug 6–7)

The Andrea + Michelle cleaning invoices are all in production QuickBooks and reconciled.
Deployed Worker is `2026-08-07.3`.

- **Deploys work from Cowork now.** GitHub push-to-`main` → Cloudflare Workers Builds. The old
  "three stranded commits / apply the patch" warning is retired — writes to `Ridge-Co/RidgeCo`
  succeed from this session. (Seven deploys landed Aug 6–7.)
- **13 customer invoices** to Goldszmidt (8 Andrea + 5 Michelle) posted, all verified. Andrea's
  seven over-threshold invoices were then **rescaled at Brett's direction** (pricing basis kept
  in private config, not here) → Andrea customer total **$1,980.27**; Michelle 5 × $288.75 =
  $1,443.75. #31 stayed $168. (Customer totals are final prices — the markup/fee math is private.)
- **Duplicate-bill lesson:** the push double-created Andrea's #24/#30/#31 vendor bills — they
  were already in QB (#0024/#0013/#0030). Brett deleted the 3 dupes; their Hub refs were scrubbed
  (`/qb/clear-ir-bill`). See FEATURE_LOG rule 45 — query existing QB bills before a vendor-bill batch.
- **New QB write-back endpoints** (FEATURE_LOG 46–48): `/qb/record-paid-bill` (paid bill w/ no
  customer invoice — Andrea #0020), `/qb/clear-ir-bill`, `/qb/reprice-invoice`. Cleaning trade now
  books to the real Service item **43** ("Cleaning Service"), not the category item 22 (rule 44).
- **Andrea AP open balance = $1,241.34** (#0024 $460 partial + #0013 $110 + #0030 $671.34).
  Reconciliation sheet delivered to Brett. Michelle square.
- **Left for Brett:** confirm the $344.80 bank payment sits on Andrea #0024 (leaves $460 open).

## Do these first, in this order

0. **Set per-customer hourly rates (Aug 5, shipped).** Hub → Owners: the new **Rate $/hr**
   box. Type **75** for Goldszmidt, Phoenix, and Casey Properties; leave everyone else blank
   (= the $85 default). The `Owners.Hourly_Rate` column is added automatically by the queued
   sheet-op on this push — give the GitHub Action a minute before the box will save. Then log
   one hub time entry and confirm the invoice reads "N hrs × $rate" (rule 40–41).
1. **Sheet: add `Payment_Terms` to the Vendors tab.** Blank = due on receipt (the default,
   and right for most). Put "Net 7" / "Net 10" / "Net 30" on the few vendors who really have
   terms. Nothing breaks if it stays empty.
2. **Sheet: two Owners rows share the same ID** (the Goldszmidt pair). Give one a unique ID
   or the convert/merge tools can't touch them — every lookup by that ID finds whichever
   comes first.
3. **Hub → Dev Log → 🔧 Update old trade names.** Existing rows say "Electric"; every form
   now writes "Electrical". Money was never wrong (the worker aliases on read) but the trade
   FILTERS compare raw strings, so filtering by Electrical finds none of the history.
4. **Hub → Dev Log → 🏠 Check units naming moved-out tenants.** Live backlog; each one is a
   former tenant's number that was reaching vendors.
5. **Convert Adrian and Amanda to owner users** (Dev Log → Find duplicate owners → "Make ID X
   a second login"). Do this AFTER fixing the shared ID above.

## Verified working
- **Time billed as hours × rate, per customer, with a service charge (Aug 5, pushed — commit `ab99b18`).** QB labor line now reads "N hrs × $rate" not "1 × $total" (rule 40); per-customer rate resolved server-side from `Owners.Hourly_Rate`, default $85, set in Hub → Owners (rule 41); turning logged time into a bill asks about the first-half-hour service charge (rule 42). 15-assertion `test/invoice-hours.test.mjs` + full suite green + adversarial review passed. **Not yet run against live QB** — do the one-bill check in step 0 above.
- QuickBooks entity mapping, sub-customers per property/unit, invoice + bill send
- Billing panel on both the work order and Review Bills, from one implementation
- Bill entry from the Hub for any vendor
- Invoice repair for anything already sent
- **Owner-level billing is now announced, not silent** (Aug 5). Sending an invoice for a
  property with no QuickBooks sub-customer lands it on the owner's top-level ledger. That
  never fixed itself — nothing in the send path creates a property sub-customer — and nothing
  said so. The preview, the confirm response and batch send now all say where it is actually
  landing, and offer a "Create it now" button. The invoice itself was always correct; only
  the nesting was wrong.
- **Logged hours can become the bill** (Aug 5). This closes the hole Brett hit as his own
  vendor: everything downstream (pricing, approve, send to QuickBooks) is gated on a
  `Vendor_Bills` row, and when he is the vendor there was nobody to submit one — so "Log
  Time" recorded hours that could never reach an invoice. "No bill submitted yet" is no longer
  a dead end; it offers **"Turn these hours into a bill"**, which fills the Hub bill form from
  the logged time. The entry IDs ride along on `/vendor-bill/add`, and once the bill saves
  those entries are stamped with `Bill_ID` so the same hour cannot also be charged on top as
  $75 supervision. Voiding a bill releases its hours again.

## Not yet verified against live data
Everything from Aug 4 shipped on my own checks — the independent reviewer was interrupted
partway through the last three pushes. Treat the payables screen and the withdraw button as
"test one before trusting the batch".

The two Aug 5 features have **65 passing assertions** (`test/bill-to-note.test.mjs` 17,
`test/time-to-bill.test.mjs` 48) run against the real functions pulled out of `worker.js` and
`index.html`, including a fake-sheet harness — but **zero live runs**, because they were never
deployed. First real use should be one work order, checked end to end, before trusting it.

**The one to watch:** double-billing. The whole design rests on `Bill_ID` on `Time_Entries`
correctly marking an hour as spent. Log an hour, turn it into a bill, then confirm that hour
is greyed out as "already billed as labour" and does NOT appear in the supervision picker.

## Still owed
- **Notes system** — timestamped contact log, per-note sharing, vendors post-only. Specced
  and agreed, not built. This is the biggest outstanding item.
- **Tiered vs itemized disagree on oversight jobs.** Tiered has the flat coordination fee built
  in AND adds the logged hour, so it charges supervision twice (the two modes produce different
  customer totals). Needs a decision, not a fix. (Specific pricing constants are private.)
- **Materials markup is asymmetric between the two modes.** One marks materials up and adds the
  card fee; the other passes them at cost + the card fee. Both defensible; pick one. (Math private.)
- **Bills already in QuickBooks still say Net 30.** Only new sends get the terms.

---

# Current Context Files — Ridge Co / Brett AI

These are the authoritative context files. As of July 21, 2026 the `brett-context` loader is **two-tier**
(for token efficiency without loss — see the ✅ ALWAYS / ⏳ ON-DEMAND column):

- **✅ ALWAYS-LOAD** the small governing set every session — these keep Claude correct and are cheap.
- **⏳ ON-DEMAND** the big files only when a task needs them (grep the topic/ID first). BACKLOG and
  CAPTURE_INBOX each carry a **Quick Index block at the top** that IS always-loadable; read the map,
  open a full entry only when needed. Guardrail: before any build/debug, keep FEATURE_LOG loaded and
  grep BACKLOG+CAPTURE for the venture/topic so you never act on partial context.

| File | Version | Load | Description |
|---|---|---|---|
| Brett_Context_Document_v1.12.md | v1.12 | ✅ ALWAYS | Brett's ventures, stack, Ridge Co details, full PAT library (PAT-001 through PAT-032 — adds PAT-031 route+instrument, PAT-032 continuous review), Session 5 log |
| Brett_Cowork_Best_Practices_v1.4.md | **v1.4** | ✅ ALWAYS | Session workflow, common mistakes, how to work with Brett. **v1.4 (Aug 8): ⭐ standing rule — NEVER use the `AskUserQuestion` clickable widget on mobile (`<env>` `Client: mobile app`); it hangs. Ask lettered A/B/C options in plain text instead. Widget OK on desktop/laptop.** |
| SESSION_EFFICIENCY_PROTOCOL_v1.0.md | **v1.0 LOCKED** | ✅ ALWAYS | **How to spend tokens — lowers Brett's session burn (daily/5-hr/weekly limits) with no quality loss.** LIGHT-LOAD default (supersedes brett-context "read every file"); delegate heavy reads to cheap subagents; checkpoint-and-resume (`resume ridgeco`); classify-before-load; Brett's own habit fixes. Governs session LOADING; B-127 governs the app's API bill (separate meter). Locked Aug 13. |
| CREDENTIALS_MAP.md | v1.3 | ✅ ALWAYS | Every service, auth method, secret location, access status. QB CONNECTED (prod); deploy pipeline reality. **v1.3: two-service-accounts correction (Worker runtime = maintenance-hub-498819, NOT brett-os-sheets) + Worker var list + STAGING=1 warning** |
| VENTURES.md | v1.0 | ✅ ALWAYS | Every venture — current state, stack, Claude access level, automation gaps |
| FEATURE_LOG.md | **v1.28** | ✅ ALWAYS | What's working — check before every code change to prevent regressions. **v1.28 (Aug 11): rules 77–78 — WO Room/Area field (room-level vendor routing as a label dimension, no QB layer) + bedroom-level keys; `sheet-ops add_column_header` now auto-widens the grid (a lingering `pending.json` means the run failed mid-way — re-queue only un-applied ops).** **v1.13 (Aug 6–7): rules 44–49 — Cleaning books to Service item 43 not the category (44); query existing QB bills before a vendor-bill batch, the dup-bill lesson (45); new `/qb/record-paid-bill`, `/qb/clear-ir-bill`, `/qb/reprice-invoice` (46–48); Cowork deploys the Worker now, urllib-403 + Sheets-quota gotchas (49).** v1.11 (Aug 4–5): rules 35–39 — one trade list, a former tenant's phone does not travel, `ensureColumns` before writing a new column (rule 37, the silent-no-op that keeps recurring), sending an invoice creates the OWNER not the property (38), logged time is a record not a charge — the invoice is built from a BILL (39).** v1.10 (Aug 3): billing consolidated onto the work order (one pricing surface); duplicate-submission guards; rules 19-23 — silent no-ops from a wrong route AND a wrong column, vendor.html api() serialization (receipts/time entries had never worked), never infer 'sent to QuickBooks' from an absent row, multi-vendor bills per WO, dedupe must fail open.** v1.7: daily digest shipped. v1.6: rule 18 — the July 21 non-prod-branch-build → production deploy incident. Keep Cloudflare non-prod branch builds OFF until reconfigured to `wrangler versions upload`. |
| BACKLOG.md | v1.23 | ⏳ index always, detail on-demand | Master backlog across all ventures. Quick Index block at top (always-load); full entries on demand. |
| CAPTURE_INBOX.md | v1.22 | ⏳ index always, detail on-demand | Brett's brain-dump inbox — CAP items. Quick Index block at top (always-load); full entries on demand. |
| HANDWRITING_KEY.md | v1.10 | ⏳ ON-DEMAND | Reference for reading Brett's handwritten-note photos (load only for handwriting tasks). Seeded vocab + confirmed live reads from Scan_2019/2020/2030/2032/2104/2105_1/2105_2/2105/1338 + Scanned_202607211020/1341. |
| HUB_UX_DESIGN_FOUNDATION_v1.1.md | v1.1 LOCKED | ⏳ ON-DEMAND (UI/overhaul) | The UX + Design Foundation — usability audit (per role) + component/UX conventions + Status SSOT + visual tokens + how it sequences into the overhaul. The yardstick every UI/feature build measures against. Decisions locked July 21. |
| CODEMAP.md | v1.0 | ⏳ ON-DEMAND (build/debug) | BrettOS code map — ≈120 Worker endpoints (handler→Sheet tab→auth), helper/chokepoint index, index.html + vendor.html screen maps, and a Sheet-tab reverse index. Load for any Ridge Co build/debug or "where does X live" task instead of reading worker.js/index.html in full. Maintained by the `ridgeco-map` skill; refresh after structural code changes. |
| MODEL_ROUTING_BUILD_BRIEF_v1.0.md | v1.0 | ⏳ ON-DEMAND (AI-routing build) | Execution contract for the secure DIY multi-model router (B-127). Cheap-by-default + escalate; Gemini+Claude direct-from-Worker (no gateway); telemetry-logged. Governs all AI calls per PAT-031. |
| TELEMETRY_SPINE_BUILD_BRIEF_v1.0.md | v1.0 | ⏳ ON-DEMAND (telemetry/Optimizer build) | Execution contract for B-128, the telemetry spine that unblocks the whole Optimizer. `Ops_Telemetry` tab + `logTelemetry` chokepoint + secret-gated `POST /telemetry/log` so **Cowork sessions/skills** log too (dual-source, Brett's Aug-7 call). Ships BEFORE B-127; `routeAI` reuses the helper. Verifier writes `Success` (never the handler's own optimism); fail-loud guards FEATURE_LOG rules 19/37. Folds in 2 loop-engineering hardening adds: **H1** un-gameable-verifier rule, **H2** Optimizer "stuck-pattern" Review step. |
| SECOND_BRAIN_QUERY_BUILD_BRIEF_v1.0.md | **v1.2** | ⏳ ON-DEMAND (second-brain build) | Execution contract for B-133, the **multi-role Ask agent** (seed of Brett's vendor/owner/tenant/driver assistant). PIN-gated `ask.html` (EN/ES) + `POST /ask` (direct Worker call, not a Cowork session). **P0 = identity-scoped authorization.** v1 roles = admin/vendor/owner/tenant (**driver deferred**); each scoped to its allow-set; codes/pay/PII released only to the authorized person; tenant gets only tenant-shareable codes; audit every sensitive answer. FACT (scoped Sheets) / SEMANTIC (Audience-filtered Brain, **LOCKED default**, seeded now) / CAPTURE; read+capture only. `Drop_Locations` = empty seam (low-pri). Ties B-127 router, B-134 self-writing brain, B-055 lock-codes, owner/tenant portals, CAP-028 #2. |
| CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0.md | v1.0 | ⏳ ON-DEMAND (strategy/optimizer) | "The Optimizer" — supervisory continuous-improvement layer (Instrument→Review→Research→Propose→Decide→Measure). Watches telemetry, proposes a ranked **Top-10** by impact + a carry-forward **Bench**, researches fitting new skills/tools. Governs per PAT-032. B-128..B-132. |
| OPTIMIZER_ROUND_LOG.md | Round 0 | ⏳ ON-DEMAND (optimizer rounds) | Live ranked Top-10 + persistent Bench (carry-forward, re-scored each round). Round 0 (July 22) = judgment-based pre-telemetry first pass; chosen = model routing + receipt pipeline + daily digest. Data-backed from Round 1 once telemetry ships. |
| SERVICE_DELIVERY_WAVE0_BUILD_BRIEF_v1.0.md | v1.0 | ⏳ ON-DEMAND (Wave-0 comms build) | **Execution contract for B-156** — tenant WO-lifecycle notifications (Received→Assigned→Scheduled→On Hold→Complete, EN/ES), the first build off the Service-Delivery research. Grounded in live handlers (`createWorkOrder`/`assignVendor`/`scheduleWO`/`updateStatus`), reuses the `sendSMS` chokepoint + `Notification_Queue` + Status-SSOT renter mask. In-Hub timeline ships now; SMS queued dormant until Twilio (B-136). Seeds the Flows engine (B-177). Sequences B-157..B-162. |
| SERVICE_DELIVERY_ROADMAP_v1.0.md | v1.0 | ⏳ ON-DEMAND (service-delivery work) | **Prioritized master list of all 224 service-delivery ideas** (8-stream research + 12-product competitor teardown), scored impact-vs-effort into 6 waves — **Wave 0 = Communication, leads everything**. Each SD-### maps to a B-item (B-156..B-202 graduated July 24). Companion deliverables: `RidgeCo_Service_Delivery_Playbook` (report) + `RidgeCo_Service_Delivery_Idea_Matrix.xlsx` (matrix + teardown + ranked tabs). |
| AUTONOMY_GUARDRAILS_v1.0.md | v1.0 LOCKED | ✅ ALWAYS (any background/overnight agent) | **The lane that makes overnight self-improvement safe.** The autonomy ladder (Rung 0 Propose → 1 Prepare → 2 Auto-ship earned/narrow → 3 Gated/never), the SAFE-vs-GATED risk classification (money/QB/PII/auth/deploy = never autonomous), the overnight loop (Scout proposes → Brett greenlights → Rung-1 Prepare agent drafts+validates but NEVER deploys → morning one-tap gate → PAT session ships), the kill switch (`Config.autonomy_enabled`), and why headless agents can't deploy (no PAT/secret = the hand-off IS the guardrail). Governs per BUILD_ORDER B-140s. Locked Aug 7. |
| BUILD_ORDER_v1.0.md | v1.0 LOCKED | ⏳ ON-DEMAND (Command Center / autonomy work) | **LOCKED build order (July 23)** for the Command Center (B-151) + quality layer (B-144..150) + autonomy substrate (B-140..143, B-152) + priority engine (B-153). Governing rule: nothing that writes / touches money-customer-auth / deploys hand-edited worker.js goes live until the Phase-1 preview lane + validator exist; read-only display ships first. Phase 0 (read-only `command-center.html`) shipped. Next = Phase 1 preview lane (B-140). |

## PRIVATE / SENSITIVE CONTEXT (NOT in this public repo)

Some context is too sensitive for this **public** repo (personal finances, competitive strategy). It lives in Google Drive and must be read via the **Drive connector** (as `info@bmoremanagement.com`) at the start of any session where it's relevant. This is the durable pointer:

| Doc | Drive file ID | Covers |
|---|---|---|
| Brett_Vision_and_CHEP_Private_v1.1 | `1KFI6l4qtZft3kbKaXxLfbwBeYGxV86UmpqENGRD3xl8` | Brett's founding vision/motivation + Winchester Hauling / CHEP pallet-recycling plan, mined from his ChatGPT export. Contains personal figures + competitive strategy — **keep out of the public repo.** |

To read it: Drive connector → `read_file_content(fileId)`. Parent folder: "Brett AI Context" (`1iFFIwzUN4EKhJEgfCAqlUdkt8cyMNClX`). Note: the Drive connector may be unavailable in headless/scheduled runs — that's fine, this brief isn't needed for automated tasks.

## How to update these files

When a new version is needed (new PAT, new project details, etc.):
1. Create the new versioned file (e.g., Brett_Context_Document_v1.9.md)
2. Update this CURRENT.md table to point to the new version
3. Push both files to GitHub
4. The old versioned file stays in /context/ as history — do not delete

## Version history

| Version | Date | Change |
|---|---|---|
| Autonomy Guardrails locked (AUTONOMY_GUARDRAILS_v1.0) | Aug 7, 2026 | The keystone for "improve while I sleep." Brett wants overnight agents constantly upgrading the system with only occasional check-ins; the blocker he correctly named is guardrails so nothing breaks. Locked the **autonomy ladder** (0 Propose / 1 Prepare / 2 Auto-ship earned+narrow / 3 Gated-never), the **SAFE vs GATED** classification (money/QB, tenant/owner/vendor PII, auth/secrets, column/schema changes, sensitive deploys, real customer sends = NEVER autonomous), and the **overnight loop**: Scout proposes → Brett greenlights → a Rung-1 **Prepare agent** drafts the full change + runs `test-verified-builds` + `ridgeco-validate` but **never deploys** → morning one-tap gate → a PAT/interactive session applies+ships. Key insight: headless agents have no PAT/secret (verified — no platform secret store), so they *can't* deploy — the hand-off to a gated session IS the safety guardrail, not a bug to fix. Default posture Rung 0+1; Rung 2 auto-ship stays off per-class until the validator earns it. Kill switch = `Config.autonomy_enabled`. Next: build the Rung-1 Prepare overnight agent. |
| Telemetry spine brief graduated (TELEMETRY_SPINE_BUILD_BRIEF_v1.0, BACKLOG B-128) | Aug 7, 2026 | Reviewed Ray Fu's "bilevel loop" short → traced to Karpathy `autoresearch` / loop-engineering. Finding: Brett already has the inner loop (brett-flow + test-verified-builds + ridgeco-validate) and the outer loop **designed** (The Optimizer), but the outer loop has **no data to run on** — `Ops_Telemetry` was never built, so Optimizer Round 0 was judgment-ranked. Graduated **B-128** into an execution contract. **Brett's scope calls (Aug 7):** instrument **both** Worker/AI calls AND Cowork skills/processes (dual-source, one tab); fold in **2 hardening adds** — H1 (verifier reads acceptance criteria + live state only, never the builder's self-report; `Success` is verifier-written) and H2 (Optimizer Review gains a "where's an agent looping on the same failed pattern?" step, detectable from `Success`+`Human_Corrected`+`Job_Type` — maps to Brett's #1 trust-killer). Ships before B-127; `routeAI` reuses the `logTelemetry` chokepoint. No new secret/provider. Not yet built — brief is ready to hand to a build session. |
| CURRENT.md + FEATURE_LOG v1.11 (rules 38–39) | Aug 5, 2026 | **Two fixes, both about something being silently true.** (1) An invoice for a property with no QuickBooks sub-customer lands on the OWNER's top-level ledger and never self-corrects — now stated in the preview, the confirm response and batch send, with a "Create it now" button (`qbBillToNote`, 17 assertions). (2) **Logged hours can now BE the bill.** Everything downstream is gated on a `Vendor_Bills` row, so when Brett is his own vendor "Log Time" recorded hours that reached nothing — the dead-end "No bill submitted yet" now offers "Turn these hours into a bill", entry IDs ride along on `/vendor-bill/add`, and saved entries are stamped `Bill_ID` so an hour cannot be charged twice (once as labour, once as $75 supervision). Voiding a bill frees its hours. New: `parseIdList`, `linkTimeEntriesToBill`; `listTimeEntries` annotates `Billed_Bill_ID` (`null` = could not read, `''` = definitely free — the distinction is what stops a failed read reading as "safe to charge again"). 48 assertions incl. a fake-sheet harness. **Not deployed** — see the ⚠️ block at the top of this file. |
| Context v1.8 | July 16, 2026 | PAT-026 added, full Ridge Co Session 1 details |
| Best Practices v1.3 | July 16, 2026 | Section 11 (PAT-026 version naming) added |
| CREDENTIALS_MAP v1.0 | July 17, 2026 | Initial credentials map — Sheets, GitHub, Cloudflare, QB, Drive |
| VENTURES v1.0 | July 17, 2026 | Initial ventures overview — Ridge Co, BrettOS, BarrelCo, Cabin, Winchester Hauling |
| PAT-029 | July 17, 2026 | Claude self-sufficiency mandate — execute without asking Brett for manual steps |
| Capture Inbox v1.0 | July 18, 2026 | Capture layer created — CAP-001..008 (vans/Kingbee, receipts automation, Turo, cash-flow north star, compliance, registration, entity) |
| CREDENTIALS_MAP v1.1 | July 18, 2026 | GitHub token reality clarified — push needs Brett's pasted classic PAT; never store token in this public repo |
| HANDWRITING_KEY v1.1 | July 19, 2026 | Seeded known vocabulary (vendors, sites, entities, fleet/Turo terms, shorthand); confirmed live-capture learning approach (no calibration sheet) |
| HANDWRITING_KEY v1.2 + CAPTURE_INBOX v1.1 + BACKLOG v1.3 | July 19, 2026 | First live captures: Scan_2019 (plumber/handyman sourcing) → CAP-012 + B-034/035/036; Scan_2020 (content-funnel plan) → CAP-013 (parked). Logged confirmed reads (Marvin, Al Stratti, Rob Whitley, Oscar Culver=56 S Culver St job, Cesar floor (amount private)) + capital-M/strike-through/Name+Street glyph patterns. |
| HANDWRITING_KEY v1.3 + CAPTURE_INBOX v1.2 + BACKLOG v1.4 | July 19, 2026 | Batch 2 corrections: Culver job → Cesar (Mon follow-up) + Gibbons jobs (B-037); floor-pay relabeled to 807 N Calvert St bakery install (not Culver, B-036). Journey/FI/A.S.Q. content → CAP-013. Handwriting-only reads logged (Scan_2030 FB yard-sale groups, Scan_2032 pay Cesar/Potomac Edison/toilet/floor, Scan_2032_1 ledger (amounts private) / Oscar 3014, making-not-nailing). |
| HANDWRITING_KEY v1.4 + CAPTURE_INBOX v1.3 + BACKLOG v1.5 | July 19, 2026 | Scan_2104 (TOPS legal-pad master to-do list) → CAP-014, fully classified; active items → B-038..B-050 (MD taxes, LLC renewal 1864 Kerns School Rd, tenant updates, invoice batch Bakery/153#2/2930 detector, Sergio pay, QB 1st-hour $75 billing, etc.). Glyph reads: U-Haul↔HALL, detector↔deduct. New people: Gina/William/Julie/Jenn/Jen/Mark/Amanda; vendor Sergio. Scans 2-4 of this batch still pending (one at a time). |
| HANDWRITING_KEY v1.5 + CAPTURE_INBOX v1.4 + BACKLOG v1.6 | July 19, 2026 | Scan_2105_1 ("Fix What Bugs Me") → CAP-015 capture-system vision; features → B-051..B-054 (daily digest, voice→sheet, multi-step tags, context/location-aware surfacing). Confirmed "tags" not "flags". Scans 3-4 still pending. |
| HANDWRITING_KEY v1.6 + CAPTURE_INBOX v1.5 + BACKLOG v1.7 | July 19, 2026 | Scan_2105_2 (lock-code note) → CAP-016 parcel-locker category (shareable-with-tenant) + tasks B-055 (feature) / B-056..B-058 (batteries 3014&2930, install @115, record changes 3014#3/#1, 1214#3). "capture vs do" design principle → CAP-015 (ties to CAP-010 Equipment Registry). Scan 4 still pending. |
| Context Document v1.9 | July 19, 2026 | Session 2 log row added (handwriting-training system + 7-note capture batch). v1.8 stays in /context as history. |
| HANDWRITING_KEY v1.7 + CAPTURE_INBOX v1.6 + BACKLOG v1.8 | July 19, 2026 | Scan_2105 (mixed list) → CAP-017 + B-059..B-072. Highlights: Ray (NJ) holds a van, $5k behind → weekly EZ-Pass→invoice automation (CAP-001 sub-thread, B-065/066); Federal St job off-Hub (B-068); Vanity FB lead 🔴 (B-071); Fait Ave/St owner payment+leaks (B-069/070); trade/repair standards + opportunistic-task engine (B-072, track-don't-gate rec). Corrections: Knock/Fait/Vanity/Ray's tolls/box co Re Spoon/Federal. **Handwriting-training batch complete (7 notes, Scans 2019–2105).** |
| CAPTURE_INBOX v1.8 + BACKLOG v1.10 | July 19, 2026 | Resolved CAP-018 item 8 — parents in Waynesboro VA store/sell planters+barrels to FB buyers locally (free secondary market); future AI-coordinated fulfillment → B-083 (UX for non-tech-savvy mother). |
| CAPTURE_INBOX v1.9 (+ private Drive doc) | July 19, 2026 | Ingested Brett's ChatGPT export (174 convos) → founding-vision + Winchester Hauling/CHEP synthesis. Stored in PRIVATE Google Doc (Brett_Vision_and_CHEP_Private_v1.1, id 1KFI6l4qtZft3kbKaXxLfbwBeYGxV86UmpqENGRD3xl8) — see PRIVATE CONTEXT pointer. CAP-019 logs it. CHEP now authorized per Brett. |
| HANDWRITING_KEY v1.8 + CAPTURE_INBOX v1.7 + BACKLOG v1.9 | July 19, 2026 | Scan_1338 (AI/automation vision list) → CAP-018 + B-073..B-082: properties onboarding site, lead-finder Chrome extension, Hub UI → Fairfax estimate look, estimate-acceptance workflow, preventive-maintenance package, BarrelCo inventory (Community Forklift), retail-outlet tracker, FB Marketplace/listing automation (rebuild "Nerdy Panda"), non-botty lead capture, Cesar mirror site. Open ❓: parents' roles. |
| Receipts pipeline design (CAP-002/020/021) | July 19, 2026 | Designed the receipt automation: intake = PAYABLES Inbox>Receipts and Invoices; filing = Vendors shared drive (0AIt2A2J2j6aFUk9PVA). Make.com dead (receipts stuck since 2025) → rebuild on QB API. Confirm-first queue w/ 3 categories (customer WO / owned-property e.g. 1864 Kerns STR / BMore business expense), hand-written-marking-first + learned vendor-defaults (Advance Auto→BMore). Builds B-084..B-089; toll-forwarding automation (GiddyUp/Kingbee by plate/VIN, EZ-Pass exception) CAP-020/B-087; HSA future CAP-021/B-089. |
| FEATURE_LOG v1.4 — Work_Orders schema corrected | July 21, 2026 | **Correction to the July 19 entry below.** There is no `WO_ID` column on Work_Orders. The real key is `ID` at **index 1**; index 0 is `Vendor_Needs_Access` (blank/"auto"). The July 19 "WO_ID matching" fix looked up a column that returns `-1` and fell back to `r[0]`, so vendor/status writes returned `success:true` and silently changed nothing, and `createWorkOrder` found no numbers and restarted every new WO at **WO-1001**. Both fixed by resolving the key column by header name (`idColIndex()` / `findWO()`). Also fixed: `w.WO_ID === id` matched the *first* WO whenever the id was omitted (`undefined === undefined`) — 9 call sites. Missing `Receipts` and `WO_Audit` tabs created. Rule 6 rewritten. |
| brett-flow skill + with/without eval | July 21, 2026 | Built the **brett-flow** methodology skill (build/debug/efficiency; augments brett-context). Eval: ~95% less context read at equal answer quality. Two skills now: brett-context (WHO/WHAT) + brett-flow (HOW). |
| Context Document v1.10 + PAT-030 | July 21, 2026 | **PAT-030** (task-scoped lean loading) added; Session 3 log row. v1.9 stays in /context as history. |
| HUB_UX_DESIGN_FOUNDATION v1.1 (LOCKED) | July 21, 2026 | v1.1 decisions locked: proportional font (retire Courier New); tenant portal = create-issue + full view of own WO updates + own photos/videos, **no billing**; owner = billing view (amounts + invoice link) + **marked-up-estimate approval** (after Brett's markup, not raw vendor est → **B-126**); vendor Spanish = **P0**; **Fairfax look locked** + slight-gray background, high-contrast "pop" text, reduced whitespace. Prior: design-foundation pass ahead of the overhaul. Per-role usability audit of index/vendor/tenant/owner (via subagents, grounded in live code) → one spec: principles, component/UX conventions, **Status SSOT** (canonical lifecycle incl. payment tail; `Scheduled`=event not status), visual tokens (calibrate to 4518 Fairfax, applied last), per-role fix backlog, and phase sequencing (usability leads, cosmetic skin last). Key findings: status defined ~22 ways; 3 competing invoice paths (one sends a different number than typed); 5 button systems + phantom CSS; tenant portal has no create-issue flow + broken uploads; owner has no billing view; vendor Spanish ~95% dead. Ties B-075/B-102, Phase 0.2. |
| HANDWRITING_KEY v1.10 + CAPTURE_INBOX v1.22 + BACKLOG v1.23 (2-note pre-overhaul capture) | July 21, 2026 | Processed Scanned_202607211020 + …1341 → **CAP-027/028** + **B-104..B-123** (STR cleaner scheduling + Cabin dashboard app, long-term lease mgmt, dispatch tool w/ 3014-washer pilot, vendor equipment tracking + schedule prefs [feeds Phase-1 B-093/094], WO-as-site/PDF sharing, property-DB intake, inspector app for "Phoenix"❓, websites+SEO, FB overhaul/group, background-agents directive). 4518 Fairfax lockbox code stored PRIVATELY (property-maintenance.md). ❓ open: 928 street=Calvert?, referral name spellings, "Phoenix". |
| BACKLOG v1.21→v1.22 + CAPTURE_INBOX v1.21 (big-build planning) | July 21, 2026 | Pulled ALL wishlist (RidgeCo Main Wishlist tab = 76 + BrettOS task app) via Drive; added **B-093..B-102** + CAP-026; **escalated B-092** (BrettOS sync HTTP 401 from July 20 secret rotation); mapped Hub architecture; locked July 22 build decisions (quick-wins→security[phone-only]→cron→notifications[hold-til-8am]; UI=Phase4). |
| Two-tier loading + Quick Index (BACKLOG v1.20 + CAPTURE_INBOX v1.20 + CURRENT.md) | July 21, 2026 | **Efficiency without loss.** brett-context loader made two-tier: ✅ always-load the small governing set (Context Doc, Best Practices, CREDENTIALS_MAP, VENTURES, FEATURE_LOG, private 00_INDEX) + the new **Quick Index** blocks at the top of BACKLOG & CAPTURE; ⏳ lazy-load full BACKLOG/CAPTURE detail, HANDWRITING_KEY, and venture briefs only when a task needs them (grep first). Guardrail: keep FEATURE_LOG loaded + grep BACKLOG+CAPTURE before any build/debug. Measured (brett-flow eval): ~95% less context read at equal answer quality. Pairs with the `brett-flow` skill. |
| CREDENTIALS_MAP v1.2 + FEATURE_LOG v1.1 (engineering session) | July 19, 2026 | **BIG DAY.** (1) Fixed the silently-broken Cloudflare deploy — Worker hadn't auto-deployed in days; wired Workers Builds + `wrangler.toml` (keep_vars). (2) Hub fixes now LIVE: void re-render, **WO_ID matching** (status-not-saving root cause), bill→Complete automation. (3) **QuickBooks CONNECTED (production)** — realm 9130355695406136 (Saint Thomas Ventures LLC DBA Ridge Co); created 10 trade income accts + 12 items; `QB_TRADE_MAP` locked in worker.js. (4) Confirmed status lifecycle (…Invoiced→Pending Payment→Paid by Customer→Paid) + payment model 1+2 (worklist+deep-links+webhook auto-flip, overpay guard). Next (July 20): Send-to-QuickBooks invoice/bill/payment build (preview-first). |
| ridgeco-map + brett-amplify skills (Session 4) | July 21, 2026 | Built two custom skills after researching 4 community tools (Graphify/Headroom/Omniroute/Brainstorming — all skipped as ill-fit; ideas adapted instead). **ridgeco-map** generates/maintains CODEMAP.md; **brett-amplify** is the idea-amplifier ideation layer. Delivered as .skill files, Brett saved both. |
| CODEMAP.md v1.0 + CURRENT.md (loader wiring) | July 21, 2026 | Generated `context/CODEMAP.md` (full endpoint/helper/screen/tab-reverse index) via ridgeco-map + subagent fan-out; pushed. Added to CURRENT.md as ⏳ on-demand for build/debug. Surfaced 3 doc drifts: vendor PIN is 8-char not 4-digit (PAT-016 stale — matters for B-093 security build); /sms-inbound is PUBLIC; route names un-hyphenated. |
| Context Document v1.11 | July 21, 2026 | Session 4 log row (skills + CODEMAP). v1.10 stays in /context as history. |
| FEATURE_LOG v1.5 | July 21, 2026 | Vendor PIN row corrected to 8-char; rule 17 added (/sms-inbound public; CODEMAP is the route/tab index of record). |
| Second Brain — phone query surface (SECOND_BRAIN_QUERY_BUILD_BRIEF_v1.0, BACKLOG v1.25, CAPTURE v1.23) | July 22, 2026 | Reviewed the "SimpleBrain / Karpathy + Cowork" video → mapped it onto Brett's existing two-repo brain (he's ~70% there). Amplified: brain = router between deterministic (Sheets/Worker) + semantic (briefs) layers; best inbox = his own sessions (self-writing). **Decisions locked:** first human surface = phone; direct Worker call (not a Cowork session); scope = read+capture only; one surface does ask+capture; freshness tags from day 1; **transport v1 = Hub "Ask" screen** (Twilio down, SMS → B-136); chose full-v1 (semantic + Brain tab). New briefs/items: **B-133** (phone Ask surface, this brief), **B-134** (self-writing brain / nightly Brain-index = CAP-024), **B-135** (LEARNED.md valet-memory), **B-136** (SMS door, blocked). CAP-028 #2 graduated. |
| Model Routing + The Optimizer (Context v1.12, BACKLOG v1.24) | July 22, 2026 | Reviewed Headroom (compression) + OmniRoute (gateway) → both rejected for fit/security; chose secure DIY router. Added `MODEL_ROUTING_BUILD_BRIEF_v1.0` (B-127) + `CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0` ("The Optimizer", B-128..B-132). New **PAT-031** (route+instrument+measure+reuse by default) + **PAT-032** (continuous review). Session 5 log row. v1.11 stays in /context as history. |
| Service-Delivery research → 224 ideas + roadmap (BACKLOG v1.34) | July 24, 2026 | Ran 8-stream best-practice research + a 12-product competitor teardown (Lula, Latchel, Property Meld, UpKeep, Limble, MaintainX, Fiix, Buildium, AppFolio, Propertyware, DoorLoop, Rent Manager) → **224 scored ideas** (70 already-building / 148 net-new / 6 tweak). Deliverables: report + Idea Matrix xlsx + `SERVICE_DELIVERY_ROADMAP_v1.0.md`. Graduated all into BACKLOG as **B-156..B-202** across 6 impact-vs-effort waves — **Wave 0 = Communication (Brett's directive, leads everything)**. Nothing discarded; every SD-ID maps to a B-item. |
| Router decisions locked + Optimizer Top-10/Bench (Round 0) | July 22, 2026 | Locked router policy: **Gemini+Claude only**; **cheapest-that-passes** default, **Claude forced for customer/money-facing**. Upgraded Optimizer proposal spec from Top-3 → **Top-10 ranked by impact rubric** + persistent **Bench** (carry-forward, re-scored each round) per Brett. Added `OPTIMIZER_ROUND_LOG.md` with Round 0 ranking (chosen: model routing, receipt pipeline, daily digest). Updated PAT-032 wording. |
