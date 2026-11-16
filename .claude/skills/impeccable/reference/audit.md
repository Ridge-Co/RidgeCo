# Audit: measurable quality checks

<!-- From pbakaus/impeccable skill/reference/audit.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: scoring bands, right-to-left and desktop-app sections, performance items for frameworks, and every launcher / report-storage command removed. The detector is run by scripts/ui-check.mjs. -->

A code-level audit, not a design critique. Check what is measurable in the implementation. Document issues; fix them in the pass that follows.

## 1. Accessibility

- **Contrast:** text under 4.5:1, or under 3:1 for large text.
- **Missing names and roles:** interactive elements without a label, role or state.
- **Keyboard:** missing focus indicators, illogical tab order, keyboard traps.
- **Real HTML:** heading levels in order, landmarks, a `<button>` for a button (not a `<div>` with a click handler).
- **Images:** missing or useless alt text.
- **Forms:** inputs without labels, vague errors, required fields not marked.
- **Motion:** respects `prefers-reduced-motion` without removing useful feedback.

## 2. Performance

- Reading and writing layout in a loop.
- Animating layout properties, or unbounded blur and shadow effects that drop frames.
- Images without lazy loading; oversized assets.
- Everything fetched up front when it could load on open (RidgeCo: each fetch costs Google Sheets reads from a shared 60-per-minute budget).

## 3. Theming

- **Hard-coded colors** instead of tokens.
- Wrong or mixed tokens.
- (RidgeCo has no dark theme. Do not add one.)

## 4. Responsive

- **Fixed widths** that break on a phone, or a phone-width column left alone on a monitor.
- **Touch targets** under 44x44px.
- **Broken touch interaction:** custom sliders or drag surfaces that fail under touch, swallow page scroll, or stay stuck after an interrupted gesture. A resized viewport proves layout, not the gesture: say what produced the evidence and what stayed untested.
- **Sideways scroll** on a narrow screen.
- **Text scaling:** layouts that break when text size is increased.
- **Missing breakpoints:** no tablet or desktop layout.

## 5. Implementation integrity

Run the detector (through `scripts/ui-check.mjs`) and verify each finding in context. Look for repeated shortcuts, drift from `DESIGN.md`, misleading or decorative content. Keep detector findings separate from visual judgment and call out false positives.

## Report

For each issue:
- **[P0 to P3] name.** P0 blocks the task. P1 is a major difficulty or a contrast / tap-size failure. P2 is an annoyance with a workaround. P3 is polish.
- **Where:** file, section, line.
- **Category:** accessibility, performance, theming, responsive, integrity.
- **Impact:** how it affects the person using it.
- **Fix:** specific and actionable.

Then: recurring patterns ("hard-coded colors in 15 places"), and what is working well and should be kept.

Keep P3s few: a long tail of small issues buries the ones that matter. Do not report an issue without its impact, do not make everything P0, and do not report a detector finding you have not checked.
