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

**Custom cursor caveat**: `body { cursor: none }` plus the `#cursor` ring means any new
overlay needs to think about the pointer. The palette opts back into a normal cursor
(`#palette, #palette * { cursor: default }`) because a 28px ring over a dense keyboard-driven
list is noise. Do the same for any future dialog that's primarily keyboard-operated.
