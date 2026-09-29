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
- `sw.js` — service worker registered from the main `<script>` block on `window.load`; its `push` listener renders real notifications sent by the [backend serverless](#backend-serverless-netlify-functions) (no offline caching strategy — that's out of scope)
- `icon.svg` — placeholder app icon (reuses the inline favicon's "J" mark) referenced by both the manifest and `<link rel="apple-touch-icon">`

## Backend serverless (Netlify Functions)
A small, separate backend under `/netlify/` — deployed as its **own Netlify site** (not the
portfolio itself, which stays a static, no-build-step deploy elsewhere, e.g. Hostinger). It
exists because two things can't happen safely in the browser: calling the Notion API (would
expose the integration token) and sending real Web Push notifications (needs the private VAPID
key + `web-push`, a Node library). Single-user app — no multi-tenant concerns anywhere here.

**Why Netlify Functions over Cloudflare Workers**: both offer free scheduled/cron triggers and
free key-value storage, which is all this needs infrastructure-wise. The deciding factor is the
`web-push` npm package, which relies on Node's built-in `crypto` module — that runs natively and
reliably on Netlify Functions (a real Node.js/Lambda-style runtime), whereas on Cloudflare
Workers it would depend on the `nodejs_compat` compatibility flag's crypto shim, which is a
newer/less battle-tested path for exactly the crypto operations `web-push` needs (ECDH, JWT
signing for VAPID). For a personal, low-traffic, single-user tool, the simpler and more
predictable option wins.

Files (see `netlify.toml` at the repo root for full comments on env vars and deploy steps):
- `netlify/functions/_lib/notion.js` — Notion API client (token/database ID from env vars only).
  Queries `POST /v1/data_sources/{data_source_id}/query` with `Notion-Version: 2025-09-03`
  (Notion's "data sources" model) — **verify this is still current** against
  [developers.notion.com](https://developers.notion.com) before deploying; only this file needs
  updating if it changed. Property names (title/date/checkbox-status-select) are auto-detected by
  type, or can be pinned via `NOTION_PROP_NAME`/`NOTION_PROP_DUE`/`NOTION_PROP_DONE` env vars.
- `netlify/functions/_lib/store.js` — thin wrapper around Netlify Blobs (`getStore('jdh-agenda')`)
  for persistence between invocations (functions have no memory of their own).
- `netlify/functions/_lib/cors.js` — shared CORS headers + OPTIONS preflight handling, needed
  because the portfolio (client) and this backend live on different origins.
- `netlify/functions/notion-tasks.js` — `GET /notion/tasks` (via redirect in `netlify.toml`).
  No client credentials required. Returns `{ items: [{ id, title, due, completed }] }`, open
  tasks only, sorted by due date. Consumed by `renderNotionTasks()` in `index.html`.
- `netlify/functions/push-subscribe.js` — `POST /push/subscribe`. Stores the browser's
  `PushSubscription` object (from `pushManager.subscribe()`) in Blobs — single fixed key, since
  this is a single-user/single-subscription app.
- `netlify/functions/sync-external-summary.js` — `POST /sync/external-summary`. See "Known
  limitation" below.
- `netlify/functions/scheduled-check-deadlines.js` — cron, every 30 min (`*/30 * * * *`, UTC),
  via `@netlify/functions`'s `schedule()` helper. Queries Notion live, reads the last synced
  Trello/Outlook summary (if fresh), finds tasks due within `PUSH_DUE_SOON_HOURS` (default 24)
  not already notified (tracked in Blobs under `notified-tasks`, pruned after 30 days), and sends
  each via `web-push` using the VAPID keys. Drops the stored subscription on a 404/410 response
  (no longer valid).

**Known limitation — Trello/Outlook in the cron**: their credentials only ever live in the
browser (Phase 2 design, to avoid extra infra), so this backend has no way to query them
directly server-side. Fix implemented: every time the dashboard renders the combined "Próximas
tareas" tile with real Trello/Outlook data, it also POSTs a trimmed, non-sensitive summary (id,
title, due date, source — never credentials) to `/sync/external-summary`
(`syncExternalSummaryToBackend()` in `index.html`, throttled to once per 5 min). The cron reads
that summary alongside live Notion data, but only if it's fresh (≤ 6h old) — if the dashboard
hasn't been opened in a while, Trello/Outlook are silently skipped for that run rather than
notifying on stale data.

**Push payload contract** (cron → `sw.js`'s `push` listener): `{ title, body, url, tag }`, where
`tag` is `"<source>:<id>"` (e.g. `notion:abc123`) so the browser can dedupe/replace notifications
per task.

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
