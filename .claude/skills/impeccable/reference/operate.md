# Work-tool screens ("Operate" mode)

<!-- From pbakaus/impeccable skill/reference/operate.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: rule markers removed; brand-surface comparisons shortened. -->

When design SERVES the product: app screens, admin dashboards, settings, data tables, tools, signed-in pages, anything where the person is in a task. Every RidgeCo Hub and portal screen is this kind.

## The test

Familiarity is a feature here. The test is whether someone who uses tools like this can trust the screen at once, or must pause at every slightly-off part.

The failure is not flatness, it is strangeness without purpose: over-decorated buttons, mismatched form controls, needless motion, display fonts where labels should be, invented controls for standard tasks. The bar is earned familiarity.

## Typography

- **One family is right.** A well-tuned sans carries headings, buttons, labels, body and data.
- **Fixed scale, not fluid.** Clamp-sized headings do not serve a tool. (`DESIGN.md` fixes the scale.)
- **Tight ratio between steps** (about 1.125 to 1.2). There are many type elements on a tool screen; exaggerated contrast is noise.
- **Line length still applies to prose** (65 to 75 characters). Data and compact rows can run denser.

## Color

Restrained by default.

- A full set of state colors: hover, focus, active, disabled, selected, loading, error, warning, success, info. Standardize these.
- The accent color is for primary actions, the current selection and state indicators only, not decoration.
- A second neutral layer for toolbars and panels, slightly off the content surface.

## Layout

- Responsive behavior is structural (collapse the side panel, turn the table into cards, change the column count at a breakpoint), not fluid type.

## Components

Every interactive part has: default, hover, focus, active, disabled, loading, error. Do not ship with half of these.

- Skeleton or in-place loading states, not a spinner in the middle of the content.
- Empty states that teach the screen and offer the next action, not "nothing here".
- The same button shape, the same form controls and the same icon style across the product.
- Overlays escape their container. A dropdown inside an `overflow: hidden` or `overflow: auto` parent gets clipped; use `<dialog>`, the popover API or `position: fixed`.

## Motion

- 150 to 250 ms on most transitions. People are in flow.
- Motion conveys state: a change, feedback, loading, a reveal. Nothing else.
- No page-load choreography.

## Not on a work tool

- Decorative motion that does not convey state.
- Inconsistent parts across screens. If the Save button looks different in two places, one is wrong.
- Display fonts in labels, buttons or data.
- Reinvented standard controls (custom scrollbars, odd form controls, non-standard dialogs).
- Heavy or fully saturated color on inactive states.
- A modal as the first thought. Try inline and step-by-step options first.

## Allowed on a work tool

- System fonts.
- Standard navigation: top bar, side nav, tabs, breadcrumbs.
- Density: tables with many rows, panels with many labels, when people need it.
- Consistency over surprise.
