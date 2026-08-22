# UI Button/Touch-Target QA Checklist

**Rule:** Check every new or edited on-screen button against this before calling a UI change done.
Added Aug 22, 2026 after Brett hit the same class of bug repeatedly across multiple tools (Trash
Service "Add photos," then found live in `wo.html`, `scope-creator.html`, and the Hub's shared
WO photo-upload buttons too — see FEATURE_LOG rules 132 and 134). His own words: **"buttons should
be easy to use, not require exact precision and not cause any sort of duplicate action or a
situation where pressing one button accidentally presses two buttons."** Three separate failure
modes, three separate checks below — a button can pass one and still fail another.

## 1. Full-box tap, not just the visible text

**Never wrap a hidden (`display:none` / `.hide`) file input in a `<label>` and rely on label-click
delegation to open the picker.** That pattern is used all over the web and looks fine in a desktop
browser, but on real phones (confirmed on Brett's) it only reliably registers a tap on the label's
own text/icon glyphs, not its full padded visual box — the exact "must press a precise area" bug.

- ✅ **Correct pattern:** a real `<button type="button">` with `onclick="document.getElementById('the-input-id').click()"`, plus the file `<input>` as a **sibling** element (never a child of the button/label), hidden via `display:none`. A real button's entire padding box is always a valid tap target on every browser — no label-association ambiguity possible.
- Applies to every photo/receipt/document upload button, not just Trash Service.
- Grep before shipping: `grep -n '<label[^>]*>[^<]*<input type="file"' *.html` should return nothing.

## 2. Real touch-target size

- Minimum tappable box **≈36–44px tall** (Apple/Google guidance is 44×44pt / 48×48dp). A button can
  keep a visually compact look with small padding — add `min-height` so the invisible tappable box
  is bigger than the visible one, rather than inflating the visual design.
- Icon-only buttons (📷, 🎤, ×) are the easiest to get wrong — check these specifically.

## 3. Adjacent buttons don't overlap under a real thumb

- Any row of side-by-side buttons (Before/After/Problem, extra-charge amount buttons, etc.) needs
  **≥8px gap** between them, more if the buttons are small. A 5–6px gap plus a big thumb is exactly
  how "pressing one button accidentally presses two" happens.
- Watch `flex-wrap` rows on narrow phone widths specifically — that's where buttons end up closest
  together and most likely to be mis-tapped.

## 4. No duplicate action on a double-tap / fast re-tap

- Any button that starts a network write (POST, especially money — invoice, bill, payment) **must
  synchronously disable itself as the very first line of its click handler**, before any `await` or
  `.then()`. JS is single-threaded, so a `btn.disabled = true` on the first line makes a second tap
  in the same instant a no-op — the second click event never even fires the handler again once the
  button is disabled.
- The codebase already has a shared guard for this — reuse it instead of hand-rolling a new one:
  **`claimSubmit(key, btn, busyLabel)`** in `vendor.html` (`_inflight`-keyed lock + auto disable/
  restore). Port the same shape into a file if it doesn't have it yet, rather than inventing a new
  pattern per file.
- Restore the button (re-enable + restore text) in **both** the success and the error/catch path —
  a button stuck disabled after a failed request is its own bug (can't retry without a refresh).

## How this got missed before

The label-wraps-hidden-input pattern was copy/pasted across `trash.html`, `wo.html` (×4),
`scope-creator.html` (×2), and the shared WO-photo-button builder reused by `index.html`,
`tenant.html`, `owner.html`, and `vendor.html` — one bug, seven places, because nobody had written
down "don't do this" anywhere a future build would see it. That's what this file is for. When
adding a NEW upload button anywhere in this repo, start from the fixed pattern in one of the files
above (all fixed Aug 22, FEATURE_LOG rules 132/134) — don't write a new label-wraps-input from
scratch.
