# Adapt: phone, tablet, desktop

<!-- From pbakaus/impeccable skill/reference/adapt.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: print, email and native-app sections, responsive-image markup and generic breakpoint numbers removed. RidgeCo's breakpoints are in DESIGN.md. -->

Adapt an existing screen to another size or device. The trap is treating adaptation as scaling. The job is rethinking the experience for the new context.

## Assess

1. **Where it came from:** what was it designed for, and what did that assume (big screen, mouse, fast connection)?
2. **Where it is going:** device, input (touch, mouse, keyboard), screen size and orientation, connection, and how it is used (a quick look on a job site, or focused work at a desk).
3. **What breaks:** what will not fit, what will not work (hover on touch, tiny targets), what is out of place (a desktop table on a phone, a phone column on a monitor).

## Desktop to phone

- One column; stacked, full-width parts.
- Touch targets 44x44px, with space between them; nothing that depends on hover.
- Bottom sheets instead of dropdowns; the main controls within thumb reach.
- Show less at once: the main content first, the rest behind a tab or a collapsed section.
- Text 16px or larger for anything typed into.
- Simple navigation, a sticky header for context, a back path.

## Tablet

- Two columns, not one and not three.
- List plus detail side by side.
- Works with touch and with a pointer.

## Phone to desktop

- Use the width: several columns, a visible side panel, more than one panel at once.
- Cap line length for prose, but do not leave the page as a thin strip.
- Show more up front (less hiding behind taps); tables with more columns.
- Hover states as an extra, keyboard shortcuts, multi-select where it helps.

## Techniques

- **Grid and flexbox** so the layout reflows by itself.
- **`clamp()`** for sizes that move between a minimum and a maximum.
- **Mobile first:** base styles for the phone, `min-width` media queries to add complexity.
- **Content-driven breakpoints:** start narrow, widen until it looks wrong, break there.
- **Tables become cards** on a phone (`display: block` and a `data-label` on each cell).
- **`<details>` / `<summary>`** for content that can collapse on a phone.

### Detect the input, not only the screen

A laptop can have a touch screen and a tablet a keyboard.

```css
@media (pointer: coarse) { .button { padding: 12px 20px; } }   /* touch */
@media (hover: hover)    { .card:hover .card-surface { transform: translateY(-2px); } }
```

Never rely on hover for function. Touch users cannot hover.

### Safe areas

Phones have notches and home indicators:

```css
.footer { padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
```

## Verify

- Different widths, portrait and landscape.
- Touch, mouse and keyboard.
- Very small (320px) and very large screens.
- A slow connection.
- **Custom controls** (sliders, drag surfaces): tap it, then drag it with the target input; the drag must finish, not just start. A swipe across it along the page's scroll direction must scroll the page.
- Emulation is a useful first pass but misses real touch, real performance and the browser's own bars. Say what produced the evidence (emulated viewport, synthesized touch, a real phone) and name what stayed untested. A real phone you cannot reach is a reported gap, not a blocker.

**Do not:** hide core functions on a phone; use a different structure on each size; forget landscape; assume a desktop is a fast machine; ignore touch on a desktop.
