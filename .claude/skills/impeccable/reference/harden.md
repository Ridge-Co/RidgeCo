# Harden: real data, real failures

<!-- From pbakaus/impeccable skill/reference/harden.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: framework code samples, right-to-left and Arabic-script sections, and generic server-side advice removed. -->

A screen that only works with perfect data is not ready. Harden it against the inputs, errors, languages and connections real people bring.

## Test with

1. **Extreme input:** very long text (names, addresses, descriptions), very short or empty text, accents and emoji, large numbers, many items, no items.
2. **Errors:** no signal, slow, timeout; 400, 401, 403, 404, 429, 500; validation errors; two actions at once.
3. **Translation:** Spanish runs about 30% longer than English. Dates, numbers and money in the right format.

## Text overflow

```css
.truncate   { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wrap       { overflow-wrap: break-word; }
.flex-item  { min-width: 0; }   /* lets a flex or grid child shrink instead of pushing the page wide */
```

- Leave a 30 to 40% space budget for translated text. No fixed widths on text containers; let padding size the button.
- Inputs are 16px or larger on a phone (smaller makes the phone zoom the page on focus).
- Test at 200% zoom.
- Write whole translatable sentences, not fragments glued together. Use `Intl.DateTimeFormat` and `Intl.NumberFormat` for dates and money.

## Errors

- **Load failures:** say what failed, offer Retry, never show an empty list in place of a failed load.
- **Form errors:** next to the field, specific, say how to fix it, keep what the person typed.
- **By status:** 400 show what to correct; 401 back to sign-in; 403 say they lack permission; 404 say it was not found; 429 say to wait; 500 say it is our side and offer Retry.

## Edge cases

- **Empty:** no items, no search results, nothing yet. Say which, and offer the next action.
- **Loading:** first load, load more, refresh. Say what is loading.
- **Large lists:** paging, search or filters. Never render thousands of rows at once.
- **Two at once:** disable the button on the first tap (in this repo: `claimSubmit`), re-enable it on success AND on failure.
- **Interrupted gestures** (custom sliders, drag surfaces): a second finger, a scroll that cancels the drag, a release outside the control, the window losing focus. After each, the next tap or drag must work without a reload.
- **Permissions:** cannot view, cannot edit, read-only. Say why.

## Accessibility that survives

- Everything works from the keyboard, in a logical order; focus moves into a sheet and back out.
- Changes are announced (live regions); controls have names.
- Never rely on color alone.

## Slow connections

- Show the page frame at once and fill it in; show what is saved, saving and not saved.
- Debounce search-as-you-type; cancel requests that no longer matter.

## Verify

- a 100-character name and a one-character name
- emoji in every text field
- signal off, and throttled
- a list of 1,000
- Submit tapped ten times fast
- every error state forced
- everything removed, to see the empty states

For gestures, say what produced the evidence (emulated viewport, synthesized touch, a real phone) and name what stayed untested.

**Do not:** assume perfect input, leave an error as "Error occurred", forget no-signal, use fixed widths for text, or block the whole screen because one panel failed.
