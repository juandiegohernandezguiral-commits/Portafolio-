# Architecture

## File layout

`index.html` holds only markup. Styles live in `css/styles.css` and behaviour in `js/*.js`.
There is still **no build step and no package manager** for the frontend — the JS files are
plain classic `<script src>` tags loaded in order at the end of `<body>`, *not* ES modules.
That matters: they all share one global scope, exactly as when everything lived in a single
inline `<script>`. A function defined in `05-dashboard.js` is directly callable from
`09-palette.js`, no imports involved.

**Load order is the dependency graph.** Each file may use anything defined in a lower-numbered
one:

| File | Responsibility |
|---|---|
| `js/01-base.js` | PIN constant, theme toggle, loader, service worker registration |
| `js/02-effects.js` | Custom cursor, audio player widget, flow-field canvas |
| `js/03-hero.js` | Scroll-expansion hero, video guards, Lenis, GSAP/ScrollTrigger setups |
| `js/04-ui.js` | Magnetic buttons, contact form |
| `js/05-dashboard.js` | PIN gate, view routing, CRUD, backup. Defines `store`, `uid`, `escapeHtml`, `touch`, `tombstone`, `saveAll` |
| `js/06-integrations.js` | Trello / Microsoft Graph / Notion, push subscription. Defines `integrations`, `hubState` |
| `js/07-sync.js` | Cloud sync + file auto-backup. Defines `onDataChanged`, `syncNow`, `isSyncConfigured` |
| `js/08-productivity.js` | "Hoy" view, due dates, recurring tasks, quick capture. Defines `parseDue`, `spawnNextOccurrence`, `quickAddTask` |
| `js/09-palette.js` | Command palette (Ctrl+K), global search, `toast()` |
| `js/10-markdown.js` | Markdown renderer written in-house. Defines `renderMarkdown`, `extractTags`, `extractWikiLinks`, `markdownToPlain` |
| `js/11-notes.js` | Notes as a knowledge system: index, backlinks, tags, editor, autosave. Defines `renderNotes` (replacing the old one), `notesIndex`, `createNote`, `commitNoteEdits` |
| `js/12-graph.js` | Knowledge graph (canvas force simulation). Defines `openGraph` |
| `js/13-habits.js` | Habits, streaks, year heatmap. Defines `renderHabits`, `currentStreak`, `habitLogIndex` |
| `js/14-focus.js` | Focus timer (pomodoro) + time logging. Defines `startFocus`, `openFocusPicker`, `minutesFocusedOn` |
| `js/15-insights.js` | Metrics view: aggregations + hand-generated SVG charts. Defines `renderInsights` |
| `js/16-rules.js` | Automation rules engine + notice inbox. Defines `runRules`, `RULE_TYPES`, `noticesBlock` |
| `js/17-templates.js` | Note/project templates + placeholders. Defines `applyTemplatePlaceholders`, `useNoteTemplate` |
| `js/18-review.js` | Guided weekly review. Defines `openReview`, `reviewPromptBlock` |
| `js/99-init.js` | Dashboard seed + migrations, nav highlight, `#hoy` PWA shortcut. Must load last |

Two consequences worth remembering when editing:

- **Adding a file means adding a `<script>` tag** to `index.html` in the right position. Nothing
  discovers files automatically.
- **Lower-numbered files calling into higher-numbered ones** (e.g. `saveAll()` calling
  `onDataChanged()` from `07-sync.js`) is fine *at runtime* — everything is parsed before the
  user can click anything — but those calls are guarded with `typeof fn === 'function'` so the
  dashboard keeps working if a later file is missing or throws while parsing.

## Tests

- `node tests/merge.test.js` — the sync merge logic (last-write-wins per record, tombstones,
  TTL pruning), loaded into a sandboxed VM with stubbed browser globals. The one piece where a
  bug means silent data loss.
- `node tests/markdown.test.js` — the in-house markdown renderer. Roughly a third of the cases
  are about escaping, because `renderMarkdown()`'s output goes straight into `innerHTML`: the
  invariant is that nothing the user types can arrive as live HTML. Run it after touching
  `js/10-markdown.js`.

Both are plain `node` scripts with no dependencies and no test runner.

## External dependencies (CDN, no local copies)
- **Tailwind CSS** — configured inline via `tailwind.config`; dark mode uses the `class` strategy
- **GSAP 3 + ScrollTrigger** — scroll-driven animations
- **Lenis** — smooth scroll
- **@azure/msal-browser** — loaded in `<head>` next to the other CDN scripts, exposes a global
  `msal`; used only by the private dashboard's Outlook/To Do integration (see
  [Dashboard](dashboard.md)) as a public client (SPA), no client secret

## PWA shell
- `manifest.json` — name, icons, `display: standalone`, theme/background colors, plus a
  `shortcuts` entry pointing at `/index.html#hoy` (long-press the installed icon on Android).
  `js/99-init.js` handles that hash by opening the PIN screen directly — it saves a tap, it does
  **not** bypass the PIN.
- `icon-192.png` / `icon-512.png` — app icons (`purpose: any`, rounded corners baked in).
  `icon-maskable-512.png` is the Android-adaptive variant: full-bleed background with the "J"
  inside the central safe circle, because the OS crops up to 20% per side. `icon.svg` is kept
  last in the manifest as a fallback. iOS ignores the manifest for the home-screen icon and
  can't read SVG, so `<link rel="apple-touch-icon">` points at the 192 PNG.
- `sw.js` — service worker registered from `js/01-base.js` on `window.load`. Two jobs:

  **Push** — its `push` listener renders notifications sent by the
  [backend serverless](#backend-serverless-netlify-functions).

  **Offline caching** (added in Fase 4). Strategy per request type:

  | Request | Strategy | Why |
  |---|---|---|
  | Navigation (HTML) | network-first, fall back to cached `index.html` | Offline navigation to any path lands in the app, which is single-page anyway |
  | Same-origin `.js` / `.css` | network-first | Prevents version skew — cache-first here could pair a fresh `index.html` with stale JS, a bug that shows up once and never reproduces |

  **`networkFirst` must fetch with `cache: 'no-cache'`, and that is not optional.** A plain
  `fetch(request)` is resolved against the browser's *HTTP* cache and can return a stale copy
  without ever contacting the server (`transferSize: 0`). That silently turns "network-first"
  into "cache-first" and reintroduces exactly the version skew the strategy exists to prevent —
  this was observed in practice: a changed `styles.css` kept serving the previous build until
  the fetch was forced to revalidate. `'no-cache'` issues a conditional request, so an unchanged
  file costs a `304` with no body.
  | Same-origin images / manifest | stale-while-revalidate | Effectively immutable |
  | `intro.mp4` | not intercepted | 12 MB would dominate a phone's storage quota to cache a hero nobody watches offline |
  | CDN libs + Google Fonts | stale-while-revalidate | Versioned URLs, so a stale copy is still a correct copy. Opaque responses (`type === 'opaque'`, status 0) are cached too — that's normal for cross-origin scripts |
  | `/data/*`, `/notion/*`, `/push/*`, `/sync/*`, Trello, Graph | never cached | Live or authenticated data; a stale task list is worse than no task list, because it looks current |

  **Bump `SW_VERSION` whenever a shell file changes** — that constant names the caches, so
  changing it is what evicts the old ones on `activate`. `SHELL_ASSETS` is also a hardcoded
  list: adding a JS file means adding it there too, or it won't be available offline.

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
- `netlify/functions/_lib/auth.js` — shared-token check for the endpoints that serve or accept
  personal data. **Fails closed**: if `SYNC_TOKEN` isn't set it rejects everything with 503,
  rather than treating "unconfigured" as "open". Compares SHA-256 digests with
  `timingSafeEqual` so neither the token's content nor its length leaks through response timing.
- `netlify/functions/data-sync.js` — `GET /data/pull` and `POST /data/push`. The store for the
  dashboard's own data (tasks, events, projects, notes), which is what makes the panel usable
  from more than one device. The server is a **dumb versioned store**: every snapshot carries an
  integer `rev`, and a push must declare the `baseRev` it was built on. Mismatch → `409` with the
  current state attached, so the client can re-merge and retry.

  The merge deliberately lives client-side (`js/07-sync.js`), not here: that's where the rules
  are (highest `updatedAt` wins per record, tombstones delete), and implementing them in two
  places would mean maintaining them in two places. Each write archives the revision it
  replaces, keeping the last 10 under `user-data-history` — cheap insurance against a client
  with corrupt or empty data overwriting the cloud.
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
