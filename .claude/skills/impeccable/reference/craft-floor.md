# Craft floor

<!-- From pbakaus/impeccable skill/reference/craft-floor.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: rule markers, brand-site items (display faces, illustration, photo masks) and the Codex-only block removed. -->

Read this after the direction is settled, just before any UI edit, and build without announcing the checklist. `DESIGN.md` overrides anything here except a line marked as a ban.

## Verify

Each of these is a check on the built result, not an intention. Run them together in one look at the render, not as separate screenshot trips.

- **Contrast:** body and placeholder text at least 4.5:1, large text at least 3:1. On colored surfaces tint secondary text from that hue or the foreground; never gray.
- **Depth:** shadows carry an offset and a soft blur. A zero-offset colored halo is decoration.
- **Spacing:** tight groups, generous separation, more space above a heading than below it. Read the computed values.
- **Type:** prose lines 65 to 75 characters, obvious scale and weight steps. Run the real copy at every breakpoint and fix what overflows.
- **Motion:** state changes only, quick, and never the same entrance on every section.
- **States:** hover, disabled, loading, error, empty. Plus real content, working controls, responsive layout, keyboard focus.
- **Browser surfaces:** the parts you did not draw still carry the design: text selection, the caret, focus rings, underline offset, numerals in tables. Theme them from the tokens.
- **Copy:** the product's own language. Controls name their action; errors name the problem and the recovery.
- **Coverage:** every requirement in the brief present and findable within seconds.

## Refuse

These are the lazy defaults. Reaching for one means you were not deciding; rewrite the element, do not soften it.

- Same-size cards of icon plus heading plus text as the page structure. Cards are the lazy container; nested cards are always wrong.
- The hero-metric template: big number, small label, supporting stats, accent.
- A small kicker label above a heading. This one is a ban. The heading carries its own weight.
- Section numbers (01 / 02 / 03) unless the order itself is information.
- A modal for a task that needs neither interruption nor protected focus.
- Gradient text. Emphasis comes from weight or size.
- Glass and blur as decoration.
- A colored `border-left` or `border-right` above 1px on cards, list items, callouts or alerts.
- Hard offset shadows with no blur.
- Sparklines, progress rings and soft-shadowed rounded rectangles standing in for content.
- Monospace as a costume for "technical" rather than for codes, data or measurement.
- Emoji or Unicode glyphs standing in for an icon system. (RidgeCo note: many existing buttons use emoji. Do not add more; do not strip the old ones as a side effect.)

The floor holds the mechanics; it never picks the direction. `DESIGN.md` does that.
