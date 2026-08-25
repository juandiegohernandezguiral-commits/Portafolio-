# Design system

- Accent color: `#2667ff`, defined as `--accent` CSS var and the `accent` Tailwind color extension
- Dark mode: toggled by adding/removing `.dark` on `<html>`; persisted to `localStorage` key `theme`
- Typography: Inter Tight (display/headings), Inter (body), JetBrains Mono (labels/code)
- Reusable surface classes: `.surface` (card background, border), `.surface-soft` (subtle background) — both adapt to dark mode

When editing: preserve existing Tailwind and custom classes (`.surface`, `.display`, `.mono`, `.meta-label`, etc.), and verify changes in both light and dark mode.
