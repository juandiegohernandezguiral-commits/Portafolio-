# Architecture

Everything lives in `index.html` — HTML structure, a `<style>` block, and a single `<script>` block at the bottom. Styles and scripts are co-located with the markup, not in separate files.

## External dependencies (CDN, no local copies)
- **Tailwind CSS** — configured inline via `tailwind.config`; dark mode uses the `class` strategy
- **GSAP 3 + ScrollTrigger** — scroll-driven animations
- **Lenis** — smooth scroll
- **@azure/msal-browser** — loaded in `<head>` next to the other CDN scripts, exposes a global
  `msal`; used only by the private dashboard's Outlook/To Do integration (see
  [Dashboard](dashboard.md)) as a public client (SPA), no client secret

## PWA shell
- `manifest.json` — name, icons, `display: standalone`, theme/background colors; linked from `<head>` via `<link rel="manifest">`
- `sw.js` — service worker registered from the main `<script>` block on `window.load`; has `push` and `notificationclick` listeners stubbed for a later phase (no offline caching strategy yet)
- `icon.svg` — placeholder app icon (reuses the inline favicon's "J" mark) referenced by both the manifest and `<link rel="apple-touch-icon">`

## Page sections (in order)
1. **Scroll-expansion hero** — `#intro-section`: video (`intro.mp4`) expands from a card to fullscreen via GSAP ScrollTrigger; title uses `mix-blend-mode: difference`
2. **About** — `#about`: stat counters with `data-counter`, animated on scroll
3. **Stack** — `#stack`: sticky horizontal carousel of tech/tool cards (`.stack-it`), scroll-driven via GSAP. `setupStackReveal()` reads the card count dynamically from the DOM (`document.querySelectorAll('.stack-it')`) — no hardcoded totals, so cards can be added or removed freely
4. **Work** — `#work`: horizontal drag/scroll carousel of project cards (`#h-scroll-track`)
5. **Manifesto** — standalone typography section
6. **Services** — `#services`: reveal-row items with hover-triggered preview images
7. **Process** — 4-step grid
8. **Contact** — `#contact`: email link + contact form (no backend — `#form-msg` is a placeholder status element)
9. **Footer** — large display text + "Panel privado" button (opens the [private dashboard](dashboard.md))

## Ambient effects
- **Flow field** (`#flow-canvas`): full-page fixed canvas, particle simulation reacts to mouse; colors swap on theme change via MutationObserver
- **Custom cursor**: `#cursor` (ring) + `#cursor-dot` (dot); hidden on touch devices; scales on hover via `.cursor-hover`
- **Audio player** (`#audio-player`): floating widget, bottom-right — see [Customization](customization.md) for the source and [Dashboard](dashboard.md) for its prefs key
- **Loader**: countdown animation from 00→100 over ~1.4s
