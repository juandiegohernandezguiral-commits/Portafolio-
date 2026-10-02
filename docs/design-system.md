# Design system

All custom CSS lives in `css/styles.css` (loaded from `<head>`, after the Tailwind CDN
script so it can override Tailwind's defaults). Tailwind utility classes stay inline in the
markup — only what Tailwind can't express goes in the stylesheet.

- Accent color: `#2667ff`, defined as `--accent` CSS var and the `accent` Tailwind color extension
- Dark mode: toggled by adding/removing `.dark` on `<html>`; persisted to `localStorage` key `theme`
- Typography: Inter Tight (display/headings), Inter (body), JetBrains Mono (labels/code)
- Reusable surface classes: `.surface` (card background, border), `.surface-soft` (subtle background) — both adapt to dark mode
- Command palette: `.palette-row` / `.palette-row.is-active` (the active row gets an accent
  inset bar, not just a background tint, so it stays legible in both themes)
- `.toast` — ephemeral confirmations, bottom-center; always dark regardless of theme, since it
  floats over arbitrary content
- `.flash-target` — brief accent ring used when the palette jumps to a specific item

When editing: preserve existing Tailwind and custom classes (`.surface`, `.display`, `.mono`, `.meta-label`, etc.), and verify changes in both light and dark mode.

**Dark-mode specificity trap** — this bit four state classes before it was caught. `html.dark .x`
has specificity (0,2,1); a state class like `.x.is-on` only has (0,2,0), so **the dark base rule
silently beats the active state** and the toggle/chip/checkbox never looks "on" in dark mode. The
fix used here is to scope the dark base with `:not(.is-on)` rather than duplicating the state rule
per theme — the accent state is the same colour in both themes and should be declared once.
Applies to `.switch`, `.habit-check`, `.tag-chip` and `.review-dot`. When adding any new
`html.dark .foo` base rule, check whether `.foo` has state variants.

**Pointer**: the site uses the system cursor. It previously shipped a custom one (`body
{ cursor: none }` plus a ring and dot following the mouse); that was removed. Because
Tailwind's reset leaves `<button>` on the arrow pointer — which went unnoticed while the real
cursor was hidden — `styles.css` now sets `cursor: pointer` on buttons, `[role="button"]`,
`label[for]` and `summary`. Non-button clickables (`.palette-row`, `.note-row`, `.heat-cell`,
`.day-pick`) carry their own rule; give any new one the same treatment.
