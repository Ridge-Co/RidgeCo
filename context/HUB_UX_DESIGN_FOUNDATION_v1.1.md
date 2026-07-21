# Ridge Co Hub — UX + Design Foundation
**Version:** v1.1 (decisions locked July 21, 2026)
**Owner:** Brett | **Applies to:** index.html (admin Hub), vendor.html, tenant.html, owner.html, customer.html, worker.js status logic
**Related:** B-075 / B-102 (UI), Phase 0.2 status SSOT, the whole overhaul. Grounded in a per-role code audit of the live files (July 21).

---

## 0. What this is and how to use it

This is the **yardstick** the overhaul builds against. It exists to get **both** things Brett asked for — *easier to use* AND *better looking* — without trading one for the other.

The core idea: **usability is structural, cosmetics are a skin.** Usability comes from *how screens are organized and how many taps a task takes*; looks come from *color/type/spacing applied on top*. So the order is fixed:

1. **Fix the structure first** (this doc's conventions + the status SSOT) — done as part of the functional overhaul, not after it.
2. **Build every new feature to these conventions** as the overhaul proceeds, so usability is baked in.
3. **Apply the visual skin last** (theme-factory + the 4518 Fairfax look) — cheap and fast once the structure is right.

If we do this in order, the cosmetic pass never has to be sacrificed for usability. If we skip it and skin at the end, we'd be forced to choose — which is exactly what Brett wanted to avoid.

**Status:** Locked v1.1 — this is the standard the overhaul references. The five open decisions were resolved by Brett on July 21 (see §8).

---

## 1. Principles (the 7 rules every screen follows)

1. **Mobile-first, Samsung S23 Ultra.** ~412px width is the design target, not an afterthought. Desktop is the bonus.
2. **One task, fewest taps.** Every common task has one obvious path. No hunting, no modal-on-modal for a 3-checkbox step.
3. **One component per concept.** A status chip, a button, a login, an `api()` call, a status list — each is defined ONCE and reused. Today each exists 3–22 times and they've drifted. This is the single biggest source of both bugs and ugliness.
4. **Confirm the irreversible; undo the rest.** Money/state-changing actions (approve bill, send to QB, mark paid, cancel, overwrite a code) get a confirm or an undo. Reversible actions just give instant feedback. Apply this consistently — today it's random.
5. **Per-role clarity.** Vendor, tenant, owner, and admin each see only what their job needs, in their language. A renter should never see "Pending Invoice"; a Spanish-speaking vendor should never hit an English wall.
6. **Accessible = usable.** ≥44px tap targets, ≥16px input font (prevents Android zoom-on-focus), no `maximum-scale=1.0`, real empty/loading/error states, working i18n. These aren't "nice to have" — they ARE the usability win.
7. **Looks follow structure.** Visual tokens (§5) get applied to an already-clean structure. Don't skin the mess.

---

## 2. Current-state truth (what the audit found)

The Hub and portals work, but they're held together by **duplication that has silently drifted**. The headline problems, ranked by how much they hurt daily use:

| # | Problem | Evidence | Hits |
|---|---------|----------|------|
| 1 | **WO status defined ~22 different ways** across 5 files — 6+ conflicting "open" sets, a phantom `Scheduled` status that never fires, casing mismatches, missing payment states | worker.js:29/749/1569, index:1170/1446, vendor:407, tenant:211, owner:411/556 | Everyone — wrong counts, dead notifications, mis-colored chips |
| 2 | **Three competing invoice/QB paths**, one of which *sends a different number than you typed* | index WO-detail Invoice Builder (≈1282) vs Log Invoice (≈1583) vs Review Bills→QB; `sendWOToQuickBooks` ≈3770 ignores the typed charge | Brett — actively misleading, risk of wrong invoice |
| 3 | **5 button systems + phantom CSS classes that render unstyled** (`btn-sm/green/muted` used, never defined); inline-styled one-off buttons | index:22-27/215/4518/4761 | Every screen — the #1 "looks inconsistent" cause |
| 4 | **Status shown 2 different ways with colliding colors** (several statuses are the same green); no chip at all on Review Bills / Send-to-QB | index badge CSS:57-63; plain-text status:4439/4753 | Everyone — can't tell states apart at a glance |
| 5 | **Tap targets everywhere <44px**; modal ✕ ~19px; base input 13px triggers Android zoom; tables 8–9 cols overflow the phone with no scroll wrapper | index:91/22/34, tables:1976/2018 | Everyone on a phone |
| 6 | **Key/lockbox management is the worst flow** — 3 stacked native `prompt()`s, can't reassign or delete, orphaned type handler | index:5228-5239/5400 | Brett |
| 7 | **Irreversible actions with no confirm/undo** (Approve Bill, Mark Paid, batch Send-all-to-QB behind one native confirm, key overwrite) while trivial ones DO confirm | index:4669/2094/4847 | Brett — inconsistent safety |

**Per-role headlines:**

- **Admin (Brett).** Create-WO takes ~6 taps and stacks a second modal for 3 defaulted checkboxes. Reassigning a vendor forces loading the whole heavy WO-detail mega-modal (~12 async panels). Owners have no Edit (a toast says "edit via Sheet"). PINs shown in plaintext.
- **Vendor.** Spanish is ~95% dead — the ES dictionary exists but only 2 elements are wired, so a Spanish vendor hits English everywhere including login errors, with no EN/ES toggle. Status update is a confusing 2-step (tap highlights, second tap saves) — vendors think "Complete" saved when it didn't. The full scheduling modal is built but **unreachable** (no button calls it). No camera capture on photo upload. A vendor with an unset rate is stuck and can't self-serve.
- **Tenant.** **No way to report an issue at all** — the portal's whole purpose is missing; it can only comment on existing WOs. Photo upload is **broken** by an `api()` argument-signature bug. No error handling on the main load (permanent silent "Loading…"). Billing jargon (Invoiced/Paid) leaks to renters.
- **Owner (clients like Mark @ Phoenix).** **No billing view or approval at all** — only status badges, no amounts or invoices. "Email/Both" notification channels are selectable but silently don't work. Notification tiers reference the phantom `Scheduled` status. Owners can edit the vendor's scheduled date and toggle tenant visibility with one unconfirmed tap.

**Cross-portal:** all three portals actually share the same login mechanism (first name + 8-char PIN) but implement it 3 different ways with different validation and copy; `api()` has 3 divergent versions (the tenant one is broken); status display is fragmented per portal; navigation differs for no reason. **These are begging to be shared components.**

> Note vs the plan: Phase-0 security already decided **tenant login → phone-only**. Current state is PIN; the overhaul changes it. The shared login component (below) is where that lands.

---

## 3. UX conventions (the standard to build to)

This is the component + interaction library. Build each **once**, reuse everywhere.

### 3.1 Shared components (one canonical each)
- **Status chip.** One component, fed by the Status SSOT (§4). Distinct color per lifecycle stage (no two the same). Used on EVERY surface incl. Review Bills and Send-to-QB. Label text comes from the SSOT's role-aware label (renter sees "Complete," not "Pending Invoice").
- **Button.** One `.btn` family with variants: `primary` (the one commit action per screen), `secondary`, `ghost`, `danger`. Retire `btn-sm/green/muted` and every inline-styled button. Exactly one `primary` per screen = the obvious next action.
- **Card & list.** One card pattern (used for WOs, properties, units) and one table→card responsive pattern for dense lists (Vendors/Tenants/Owners/Invoices). Tables wrap in `overflow-x:auto` and collapse to stacked cards under 600px. No third hand-rolled table (kill the Keys one).
- **Form + modal.** One modal shell (one z-index scale with real layering), one form-field pattern. **No native `prompt()`/`confirm()` chains** — replace with proper modal forms (esp. key editing).
- **Empty / loading / error.** Every async panel shows a real spinner while loading, a distinct error state with retry (never conflate "no data" with "fetch failed"), and empty states that offer the next action ("Add property") instead of "try refreshing."
- **Toast + confirm.** One toast for success/undo; one confirm dialog for irreversible actions. See the safety matrix (§3.4).
- **Login.** One shared login component across vendor/tenant/owner: same fields, same validation, same lockout UX, same error strings, same clear format hint. (Phase-0 auth swaps tenant→phone here.)
- **i18n.** One shared EN/ES layer with a visible in-app toggle, used by all portals. Every user-facing string routes through it — including validation errors and status labels.
- **`api()`.** One shared helper (adopt the dual-signature version) so upload code works identically everywhere. Fixes the tenant upload bug for free.

### 3.2 Navigation model
- **Admin:** keep page nav, but make the primary action per page obvious and reachable with a thumb; nav buttons ≥44px and not pushed off-screen. Reduce the WO-detail mega-modal — load panels lazily on demand, not all ~12 up front.
- **Portals (vendor/tenant/owner):** one shared shell — a simple top tab bar + card list. Same pattern for all three so behavior and code stop drifting.

### 3.3 Touch & viewport rules (non-negotiable)
- Min tap target **44×44px** (buttons, nav, ✕, icon actions, delete glyphs).
- Input font **≥16px** (stops Android focus-zoom).
- Remove `maximum-scale=1.0` everywhere (let users pinch-zoom).
- No hover-only affordances — every hover state needs a `:active`/`:focus` touch equivalent; no `title=` tooltips as the only label.
- No page-level horizontal scroll on a 412px screen.

### 3.4 Safety matrix (confirm vs undo vs instant)
| Action type | Treatment |
|---|---|
| Money / QB / mark-paid / send-invoice (incl. **batch**) | **Preview + explicit confirm**, warnings shown ABOVE the commit button. Batch lists each item + total. |
| Cancel WO, move-out tenant, overwrite a lock/access code | **Confirm** (code changes are history-logged, so a quick confirm is enough). |
| Approve bill | **Undo toast** (or confirm) + instant "moved to Send to QB" feedback. |
| Status change, add note, reversible edits | **Instant + toast.** No modal friction. |
| The command bar (B-125) | Instant execute + clear result readout (creates soft-deletable, code updates history-logged). |

---

## 4. Work-Order Status SSOT (Phase 0.2 — build this first)

One module (worker.js + a mirror the front-ends import) is the single source for status values, labels, colors, ordering, transitions, and who-can-set. **Keep the stored/machine value = the exact Title-Case string** already in `Work_Orders.Status` (≈30 call sites compare against it literally; changing to snake_case is a breaking multi-file + sheet migration for no user benefit).

**Canonical lifecycle:**

| # | Value (stored) | Label | Who sets | → transitions |
|---|---|---|---|---|
| 0 | New | New / Request received | system, admin | Assigned, Cancelled |
| 1 | Assigned | Technician assigned | admin/system | Accepted, Declined, On Hold, Cancelled |
| 2 | Accepted | Technician confirmed | vendor (SMS YES / portal) | In Progress, On Hold, Cancelled |
| 3 | In Progress | Work in progress | vendor, admin, system | On Hold, Complete, Cancelled |
| 4 | On Hold | On hold | vendor, admin | In Progress, Complete, Cancelled |
| 5 | Complete | Work complete | vendor, admin, system (on bill entry) | Pending Invoice, Invoiced |
| 6 | Pending Invoice | Complete — billing pending *(owners see "Complete")* | admin/system | Invoiced |
| 7 | Invoiced | Invoice sent | system (QB), admin | Pending Payment |
| 8 | **Pending Payment** *(NEW)* | Awaiting customer payment | system (QB), admin | Paid by Customer, Paid |
| 9 | **Paid by Customer** *(NEW)* | Customer paid (landing/partial) | system (QB webhook), admin | Paid |
| 10 | Paid | Paid / Closed | system (auto-flip), admin | *(terminal)* |
| — | Declined | Declined by vendor | vendor (SMS NO) | Assigned (reassign) |
| — | Cancelled | Cancelled | admin | *(terminal)* |

**Module exposes:** `isOpen()` (New…On Hold), `isActive()` (New…Pending Invoice), `isClosed()` (Paid, Cancelled), `order` (the 0–10 sort), `vendorSettable` (Accepted/In Progress/On Hold/Complete), `label(status, role)` (role-aware, incl. the owner mask Pending Invoice→Complete), `color(status)`, `canTransition(from,to)`.

**Decisions baked in:**
- Add the payment tail (`Pending Payment`, `Paid by Customer`) from the designed lifecycle — build with the QB webhook auto-flip + overpay guard so they don't become orphans.
- **`Scheduled` is NOT a status** — it's a date/event. Remove it from notify logic; fire the "scheduled" owner notification off the `/schedule` action. (Today the owner "Scheduled" SMS never fires.)

**Risks to respect (from the audit):** exact-string coupling; the PUBLIC `/sms-inbound` YES/NO path must stay wired to the SSOT constants (untrusted webhook, no secret); keep status writes on the `findWO`/`idColIndex` path (FL rule 6); DON'T merge the separate Vendor_Bills / Invoice_Review / Estimate enums into this; unifying the open/closed sets WILL change dashboard counts across portals — expected, not a bug; ship a single badge-class map so nothing renders unstyled.

---

## 5. Visual tokens (the skin — applied LAST, via theme-factory)

Structure this now so the cosmetic pass is a variable swap, not a rewrite. **The 4518 Fairfax Rd proposal look is LOCKED as the visual target (Brett, July 21)** — calibrate exact values against it in the cosmetic phase, with two locked adjustments below.

**Locked visual direction (July 21):**
- **Tighter whitespace.** The Fairfax proposal reads a bit airy — reduce the white space so screens feel denser/more efficient (esp. admin lists on desktop; comfortable 44px targets still hold on mobile).
- **Slight-gray background, high-contrast text.** Move OFF the current dark `Courier New` portal look to a **light theme with a slight gray background** (surfaces/cards sit just above it) and **text that pops** — near-black body text on the gray, strong contrast (passes WCAG AA). Not stark white, not dark.
- **Proportional font.** Replace `Courier New` monospace on the portals with a clean **proportional** font (Fairfax-calibrated).

- **Color roles (not raw hex scattered in markup):** `--bg` (slight gray), `--surface` (near-white cards), `--text` (near-black, high contrast), `--text-muted`, `--primary`, `--danger`, `--success`, plus one distinct hue per status stage. Every status color and button color references a role token.
- **Type scale:** 5 steps, base ≥16px for inputs. One **proportional** font family across Hub + all portals (retire `Courier New`).
- **Spacing scale:** 4/8/12/16/24/32. Kill one-off inline paddings.
- **Radius + elevation:** one radius token, one shadow scale for cards/modals.
- **Density:** comfortable default (44px controls), with an optional compact mode for admin tables on desktop.

This is where `theme-factory` + `design:ux-copy` (button/label wording) + `design:accessibility-review` (contrast/tap-size check) do their work — on top of the clean structure, not instead of it.

---

## 6. Per-role fix backlog (folds into the overhaul)

Highest-leverage fixes, grouped. Most are **both** usability and consistency wins because they replace duplication with one component.

**Foundation (do first — everything else sits on these):**
- Status SSOT (§4) — Phase 0.2. Effort L.
- Shared component library (§3.1): button, status chip, card/table, modal/form, empty/loading/error, toast/confirm, login, i18n, `api()`. Effort L, but pays back across every screen.
- Touch/viewport rules (§3.3) applied globally. Effort S–M, huge visible impact.

**Admin (Brett):** collapse the 3 invoice paths to one (fix the "sends a different number" trap) · replace key management with one modal (add reassign + deactivate) · confirm/undo on Approve Bill, Mark Paid, batch QB · inline the New-WO safety toggles (drop the stacked modal) · lazy-load WO-detail panels · Owners get a real Edit · mask PINs.

**Vendor:** wire Spanish across the whole UI + EN/ES toggle · one-tap status save (kill the confusing 2-step) · wire or delete the dead scheduling modal · add camera capture to photo upload · lazy-load card widgets · let a vendor see/flag an unset rate.

**Tenant (scope locked July 21):** **build the create-issue flow** (the missing core) · give tenants **full view of their open WO updates + their own photos/videos** (before/after they submitted) · **NEVER expose billing** — no amounts, no invoice states, no Invoiced/Paid jargon anywhere in the tenant view · fix the `api()` bug so uploads work · add error/timeout/retry on load · i18n (EN/ES). *(Refines B-006.)*

**Owner (scope locked July 21):** **build a billing view** — **amounts + invoice link** — AND **estimate approval**. Critical gate: the estimate an owner approves is the **marked-up estimate produced AFTER Brett reviews it and adds markup** (the Invoice_Review / customer-facing version), **never the raw vendor estimate**. So the flow is vendor estimate → Brett review + markup → *then* surfaced to owner for approve/decline. *(New requirement → B-126; builds on the estimate/markup flow B-030/B-101 and Invoice_Review.)* Also: reconcile the 3 priority lists to one · fix/hide non-working email channel + phantom "Scheduled" tier · confirm on visibility/scheduled-date toggles · unify list-vs-detail status label source.

---

## 7. How this sequences into the overhaul (usability leads)

- **Phase 0 (foundation):** Status SSOT (0.2, already planned) + the shared component library + global touch/viewport rules. This is the usability spine; ship it before feature work so every later screen inherits it.
- **Phases 1–3 (features):** every feature (notifications, WO engine, estimates, the intake/command engine B-103/B-124/B-125) is built to §3 conventions and the SSOT. Per-role fixes (§6) fold into the phase that already touches that surface — e.g. vendor status-save + Spanish land with the notification phase; the tenant create-issue flow lands with the WO engine.
- **Phase 4 (cosmetic skin):** apply the visual tokens (§5) calibrated to the Fairfax look via theme-factory; run design:accessibility-review as the checkpoint. By now it's a variable swap on a clean, already-usable structure — fast, and nothing gets sacrificed.

Net: usability is delivered *throughout* Phases 0–3 (so even if the cosmetic Phase 4 slipped, you'd already have the easier-to-use Hub Brett prioritized), and the good looks come essentially for free at the end.

---

## 8. Locked decisions (Brett, July 21)

1. **Font:** replace the `Courier New` monospace with a cleaner **proportional** font (cosmetic pass). ✅
2. **Tenant create-issue flow:** **build it.** Tenants get **full view of their open WO updates + their own photos/videos**, but **no billing info** whatsoever. ✅ *(→ B-006 refined)*
3. **Owner billing:** **amounts + invoice link + estimate approval** — where the approvable estimate is the **marked-up version after Brett's review**, NOT the raw vendor estimate. ✅ *(→ B-126)*
4. **Vendor Spanish:** **critical** — full i18n layer + EN/ES toggle is P0 for the portal work. ✅
5. **Fairfax look:** **locked** as the visual target, with two adjustments — **reduce whitespace** and use a **slight-gray background with high-contrast ("pop") text** (see §5). ✅

All five are reflected above (§5 tokens, §6 per-role). This doc is now the locked standard for the overhaul.

---
*v1.1 — locked standard. Update in place if a convention changes; note it here.*
