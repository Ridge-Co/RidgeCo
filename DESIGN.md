# RidgeCo design standard (DESIGN.md)

**Version 1, Nov 16 2026.** Applies to every page in this repo: the Hub (`index.html`), the vendor, tenant and owner portals, and every tool page. Public marketing pages (cabin site, BarrelCo, landing pages) are the one exception: see the `public-site-taste` skill.

This file does not invent a look. It writes the locked standard (`context/HUB_UX_DESIGN_FOUNDATION_v1.1.md`, Brett, July 21 2026) and the Nov 11 UI plan as exact rules, using the values the pages already use. Where today's pages differ from a rule below, the page is the debt, not the rule.

**How to use it:** read it before changing any `.html` or `.css` file, then follow the `ridgeco-ui-review` skill. `node scripts/ui-check.mjs <pages>` checks the measurable parts and fails a change that makes a page worse.

**How to change it:** a PR that edits this file, says what changed and why at the bottom, and has Brett's OK. Bump the version.

**Shared parts:** the plan is one shared stylesheet and script (`rc-ui.css`, `rc-ui.js`, UI plan Phase 0). They are not built yet. Until they are, each page keeps its own `:root` block: use the token names below in it, and do not add a new raw color, size, radius or shadow.

## 1. The seven rules every screen follows
1. **Phone first.** 412px wide (Samsung S23 Ultra) is the design target. Bigger screens must be used, not just tolerated.
2. **One task, fewest taps.** Each common task has one obvious path.
3. **One part per idea.** One button family, one chip, one field, one sheet, one toast. Reuse; never make a second version.
4. **Confirm what cannot be undone; undo the rest.** See section 12.
5. **Each person sees their own job, in their own words.** A tenant never sees money or billing words. A Spanish-speaking vendor never hits English.
6. **Readable and tappable is the usability.** Sizes, contrast and tap targets below are not optional.
7. **Looks follow structure.** Fix how the screen is organized first, then apply the tokens.

## 2. Color tokens
Use the token, never the hex, in markup and scripts. Light theme only; there is no dark theme.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--bg` | `#eceef1` | page background (slight gray) | |
| `--surface` | `#ffffff` | cards, sheets, inputs | |
| `--surface2` | `#f3f5f8` | toolbars, table headers, quiet panels | |
| `--border` | `#dce0e6` | card and input borders, dividers | decoration only, never the only cue |
| `--text` | `#1b1f24` | all main text | 14.2:1 on bg, 16.6:1 on surface |
| `--muted` | `#5c6672` | secondary text, hints | 5.0:1 on bg, 5.8:1 on surface |
| `--accent` | `#1d4ed8` | primary button, links, current selection, focus ring | 6.7:1 on surface, white on it 6.7:1 |
| `--success` | `#166534` | done, paid, saved (pages call it `--accent2` today) | white on it 7.1:1 |
| `--warn` | `#b45309` | needs attention, on hold (solid fills, borders) | white on it 5.0:1 |
| `--warn-text` | `#8a4b00` | warning text on a tint | 6.2:1 on warn tint |
| `--danger` | `#b42318` | errors, destructive actions, urgent | 6.6:1 on surface, white on it 6.6:1 |
| `--purple` | `#6d28d9` | billing stages (Hub only) | white on it 7.1:1 |
| `--info-bg` | `#e8f0fb` | blue tint | accent on it 5.8:1 |
| `--success-bg` | `#eaf6ee` | green tint | success on it 6.4:1 |
| `--warn-bg` | `#fdf2e2` | amber tint | warn-text on it 6.2:1 |
| `--danger-bg` | `#fdecea` | red tint | danger on it 5.8:1 |
| `--purple-bg` | `#f1ebfd` | purple tint (the one value not in the pages yet) | purple on it 6.1:1 |

- Text and chips must reach **4.5:1 contrast minimum** (3:1 for text 24px and up). The numbers above are computed; a new pairing must be computed too.
- `#66707c` (the `--muted` in `tenant.html`, `owner.html`, `index.html` today) is 4.3:1 on the page background and fails. Move to `#5c6672` when you touch those pages.
- The accent is for the main action, links and the current selection. It is not decoration.
- Never gray text on a colored tint: use that tint's own text color.

## 3. Type
- **One family:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (`--font`). A fixed-width font (`--font-mono`) only for codes and raw logs.
- **Scale: 13 / 15 / 17 / 20 / 24 px.** Nothing else.

| Size | Use |
|---|---|
| 13px | secondary text, hints, chips, table meta. The smallest size on a portal. |
| 15px | body text on portals, buttons, list rows |
| 17px | card titles, the address on a job card, section headings |
| 20px | screen title |
| 24px | the one big number or page title |

- **Body is 15px on portals.** Nothing under 13px on portals (vendor, tenant, owner, customer pages). On the desktop Hub and Brett's tool pages, 12px is allowed for dense table cells only; on a phone the Hub follows the portal minimum.
- **Inputs, selects and textareas are 16px** everywhere (smaller makes Android zoom the page on focus).
- Weights: 400 body, 600 labels and buttons, 700 titles. Line height 1.45 for text, 1.2 for titles.
- Section labels are 13px, sentence case, weight 600. **No grey all-caps labels**, no wide letter-spacing.
- Dates shown to people read "Thu, Nov 12", never `2026-11-12`.

## 4. Spacing, radius, shadow
- **Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 px.** No other paddings, margins or gaps. Tight inside a group, generous between groups.
- **One radius: 8px** (`--radius`) for cards, buttons, inputs, sheets and chips. A fully round shape is allowed only for avatars and count dots.
- **One shadow:** `--shadow: 0 1px 2px rgba(16,23,32,.08), 0 1px 8px rgba(16,23,32,.04)` for cards and sheets. A card has a border or the shadow, not a heavy version of both.

## 5. Layout and breakpoints
| Name | Width | Layout |
|---|---|---|
| Phone | under 700px | one column, full-width parts, the main action within thumb reach |
| Tablet | 700 to 1100px | two columns, or list plus detail |
| Desktop | over 1100px | several columns or a board, plus a detail pane where it helps |

- **Pages must use the screen.** Never a fixed phone column in the middle of a monitor. A page-level `max-width` under 900px needs a wider rule at 700px and at 1100px.
- Write the phone layout first, then add `@media (min-width: 700px)` and `@media (min-width: 1100px)`.
- **No sideways scroll** at 412, 1366 or 1920. A wide table sits in its own `overflow-x:auto` wrapper and becomes stacked cards on a phone.
- Prose lines stop at about 75 characters; data, lists and boards use the width.
- Do not block zoom: no `maximum-scale=1`, no `user-scalable=no`.
- Related pages link to each other from the blue top bar (`rc-related.js`, see CLAUDE.md).

## 6. Buttons
One family, `.rc-btn`, in four kinds and one large size. Real `<button>` elements.

| Kind | Looks like | Use |
|---|---|---|
| primary | `--accent` fill, white text | the one main action on the screen. Exactly one. |
| secondary | `--surface` fill, `--border` border, `--text` text | other actions |
| ghost | no fill, `--accent` text | low-key actions, Cancel, links that act |
| danger | `--danger` fill, white text | delete, void, cancel a job |
| big | full width, **52px tall**, 17px text | the one main action per screen on a phone (a primary or, rarely, a danger) |

- 44px tall minimum, 15px text, weight 600, 8px radius, 16px side padding, 8px between neighbours.
- States: hover, focus (2px `--accent` ring, 2px offset), pressed, disabled (50% opacity, not clickable), busy (label changes to what is happening, button disabled).
- The label says what happens: "Send invoice", not "Submit" or "OK".
- A button that saves disables itself on the first line of its handler and comes back on success and on failure. Reuse `claimSubmit(key, btn, busyLabel)`.
- File pickers: a real button plus a sibling hidden `<input type="file">`. Never a `<label>` wrapped around the input. Never `capture=` on the input.

## 7. Status chips
One part, `.rc-chip`, 13px, weight 600, 4px by 8px padding, 8px radius. Chips wrap or end with an ellipsis; never `white-space:nowrap` with nothing to stop it. Color and label come from **one map** keyed by status, with the person's role as an argument. The status names come from `wo-status.js` (`WOStatus`); never write a status list by hand.

| Status | Chip | Tenant and owner see |
|---|---|---|
| New, Estimate Requested | accent text on `--info-bg` | "Request received" |
| Assigned | warn-text on `--warn-bg` | "Technician assigned" |
| Accepted | white on `--accent` | "Technician confirmed" |
| In Progress | white on `--success` | "Work in progress" |
| On Hold | white on `--warn` | "On hold" |
| Complete | success text on `--success-bg` | "Complete" |
| Pending Invoice | purple on `--purple-bg` | "Complete" (never the billing word) |
| Invoiced | white on `--purple` | owner: "Invoice sent". Tenant: "Complete" |
| Paid | `--text` on `--surface2` with a border | owner: "Paid". Tenant: "Complete" |
| Declined | danger text on `--danger-bg` | not shown |
| Cancelled | `--muted` on `--surface2` with a border | "Cancelled" |

Priority uses the same tints: urgent danger, high warn, normal success, low info. Every pair above is 4.5:1 or better. The old pale green on pale green (`#86efac`, `#6ee7b7` on `#eaf6ee`, about 1.3:1) is banned.

## 8. Fields
`.rc-field`: **label above** the input (13px, weight 600, tied to the input with `for` / `id`), then the **16px input** (44px tall, `--border`, 8px radius, 12px padding), then an optional **hint** (13px, `--muted`), then the **error** (13px, `--danger`, says what is wrong and how to fix it, shown next to the field and announced).
- A placeholder is an example, never the label.
- Mark optional fields "(optional)"; do not star the required ones.
- Keep what the person typed when a save fails.
- Free-text boxes Brett fills on his phone take voice dictation.
- Styles for one special input (the PIN box) are scoped to that input, never to every `input`.

## 9. Sheets and dialogs
`.rc-sheet`: slides up from the bottom on a phone, a centered dialog (560px wide at most) on tablet and desktop. One z-index scale. A title that says what it is for, a close button (44px), the main action at the bottom. Focus moves into it and returns on close; the phone's back button closes it.
- **No browser `alert`, `confirm` or `prompt`.** Use `rcToast()` for a message, `rcConfirm()` for a yes/no, `rcAsk()` for a typed answer. (The money and authorization prompts in the Hub stay as they are until Brett reviews them.)
- Never a sheet on top of a sheet. If a step needs three checkboxes, put them in the first sheet.
- Not everything is a sheet: prefer showing it in place.

## 10. Empty, loading and error states
Every list and panel that loads data has all three, and they look different from each other.
- **Loading** (`.rc-loading`): says what is loading.
- **Empty** (`.rc-empty`): says there is nothing yet and offers the next action ("Add a property").
- **Error** (`.rc-error`): says what failed in plain words and has a **Retry** button. A failed load never looks like an empty list (the existing `showLoadFailed` pattern).
- A failed save says "Not saved" on the thing itself and keeps the old value. Nothing fails silently (CLAUDE.md).

## 11. Touch
- **44px tap targets** on touch, both directions, including icon buttons and the close X. 8px or more between neighbours.
- Nothing works only on hover. No `title=` tooltip as the only label.
- One-handed: the main action sits low on a phone screen.

## 12. Confirm, undo or instant
| Action | Treatment |
|---|---|
| Money, QuickBooks, mark paid, send an invoice (single or batch) | preview, then an explicit confirm; warnings above the button; a batch lists each item and the total |
| Cancel a job, move a tenant out, overwrite a lock or access code | confirm |
| Approve a bill | undo toast, plus feedback saying where it went |
| Status change, note, anything reversible | instant, with a toast |
| A status change that texts someone | a short confirm, or a visible "Sending... Undo" bar. Never a fake Undo after the text has gone |

## 13. Wording
- Plain words, sentence case, short. No jargon, no internal names, no codes as the main message.
- One thing, one name, everywhere.
- Buttons are a verb and an object. Errors say what failed and what to do.
- **Every vendor and tenant string is translatable:** it goes through `t()` and has a Spanish entry in the same commit. Whole sentences with placeholders, not glued fragments. Leave room for text 30% longer.
- Tenants never see amounts, invoices or billing statuses. Owners never see what they spend in total with Ridge Co (estimate and approval screens show their amounts).
- No door, key or lockbox codes, vendor costs or internal notes on a screen meant for someone else.

## 14. Built to be re-branded
The Hub will be offered to other contractors and owners. So: the **brand name, the logo and the Worker address come only from tokens or one config object** (`rc-ui.js`, once built; until then the page's single `WORKER` constant). Do not type "Ridge Co", a logo path or a `workers.dev` address into new markup or new strings. Colors come from the tokens in section 2, so a brand is a token swap.

## 15. Real HTML
- A button is a `<button>`, a link is an `<a>`. No clickable `<div>`.
- Every input has a label tied to it. Icon-only buttons have an `aria-label`.
- Headings go in order. Images have alt text (empty for decoration).
- Focus is always visible.

## Common mistakes we keep making
Each of these has shipped more than once. Check for them by name.
1. **A `<label>` wrapped around a hidden file input.** On real phones only the text opens the picker. Shipped in seven places before it was written down (`context/UI_QA_CHECKLIST.md` rule 1). 3 are left today.
2. **A button that fires twice** on a double-tap because it was not disabled on the first line of its handler, or that stays dead after a failed save.
3. **Buttons too small or too close:** under 44px, or with a 5px gap, so one thumb presses two.
4. **Tiny text.** 1,591 places are under the minimum today (757 in `index.html`, 280 in `vendor.html`). Do not add another.
5. **Grey all-caps labels with wide letter-spacing.** Use 13px sentence case.
6. **A phone column on a monitor.** `proposals.html` is 560px wide on a 1920px screen; 37 pages have a page column with no wider rule.
7. **A chip that cannot wrap,** so a long value runs off the card (`proposals.html` Effort).
8. **Browser pop-ups.** 214 `alert` / `confirm` / `prompt` calls today, including four `prompt`s in a row to add one contact.
9. **Unreadable status colors:** pale green on pale green for "In Progress" and "Complete".
10. **A style meant for one input applied to all of them** (the PIN box rule made the vendor search box spaced capitals).
11. **"Loading..." forever, or an empty list, when the load actually failed.**
12. **English-only strings on a vendor or tenant screen.**
13. **A new one-off button or color** instead of the shared one. This is the single biggest cause of both bugs and ugliness.
14. **A status list written by hand** instead of `WOStatus`.
15. **Floating buttons over content** (the bell, the Feedback pill) that cover the controls underneath.
16. **Checked on a desktop only.** Look at 412 first.
17. **Billing words shown to a tenant** (Invoiced, Paid, Pending Invoice).
18. **Everything loaded up front** for every row, which is slow on a phone and burns the shared Google Sheets read budget.

## How it is enforced
`node scripts/ui-check.mjs <pages>` counts, per page: text under the minimum, browser pop-up calls, label-wrapped file inputs, narrow page columns with no desktop rule, chips that cannot wrap, and a viewport that blocks zoom. It runs the Impeccable detector when installed, and takes screenshots at 412, 1366 and 1920, failing on sideways scroll. Today's counts are recorded in `scripts/ui-check-baseline.json`; a change fails only when it makes a number worse, and a page that is not in the baseline (a new page) must be clean. The "UI check" workflow runs the same command on every pull request that touches an `.html` or `.css` file. What a script cannot judge (one main action, where am I, what next, Spanish, the back button) is the checklist in the `ridgeco-ui-review` skill.

## Changes
- v1, Nov 16 2026: first version. Choices made while writing it (one radius of 8px, `--muted` `#5c6672`, the chip map, `--purple-bg`) are listed in the PR that added this file for Brett to confirm or change.
