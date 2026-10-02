# Private dashboard (`#dashboard`)

A hidden full-screen overlay accessible via the footer "Panel privado" button or `Alt+P`. Protected by a 4-digit PIN — see [Customization](customization.md) for the constant. All data persists to `localStorage`.

## Command palette (`Ctrl+K` / `Cmd+K`)
Defined in `js/09-palette.js`. Only binds while the dashboard is unlocked — hijacking the
browser shortcut on the public site would cost something and give nothing back. Mixes commands
(navigate, create, sync, export, toggle theme) with live search across tasks, events, projects
and notes. Note bodies are searchable but not shown in the row label.

Prefixes: `+ texto` creates a task immediately; `? texto` searches data only, skipping commands.

Ranking (`scoreMatch`) is deliberately simpler than real fuzzy matching: exact > prefix >
substring > subsequence, with shorter haystacks winning ties. For a few hundred items that's
enough, and it guarantees typing a full word ranks the literal match first.

## Views
- **Hoy** — the default view on unlock, and the reason the panel is worth opening daily.
  Three blocks (vencidas / para hoy / en progreso) merging local tasks and events with whatever
  Trello, Outlook and Notion returned. Because external items come from `hubState` — runtime
  state, not persisted — they're only present if the Centro de tareas has been loaded this
  session; when a connected source hasn't loaded, the view says so instead of quietly showing
  an incomplete list. Includes a quick-capture field (`quickAddTask`) that parses a small
  syntax: `!alta` / `!media` / `!baja` for priority, `hoy` / `mañana` for a due date.
- **Overview** — summary stats pulled from all other modules
- **Agenda** — two tabs, switched with `showAgendaTab()`:
  - **Calendario** — original events view; events stored as `jdh_events`
  - **Centro de tareas** — bento-grid hub aggregating Trello, Outlook/To Do and Notion (see below)
- **Tasks (Kanban)** — drag-and-drop 3-column board; data at `jdh_tasks`. Tasks carry an
  optional `due` (datetime-local string) and `repeat`
  (`none` | `daily` | `weekly` | `biweekly` | `monthly`). Dropping a recurring task into
  *Completadas* calls `spawnNextOccurrence()`, which creates the next one — advancing the date
  repeatedly until it lands in the future, so a daily task ignored for two weeks doesn't spawn
  an already-overdue successor. The `spawnedNext` flag prevents a second spawn if the same card
  is dragged out of and back into *done*.
- **Hábitos** (`js/13-habits.js`) — habits with streaks and a 52-week heatmap. Cadence is
  `daily`, `weekdays` or `custom` (specific weekdays).

  `habitLog` is a **separate collection**, not an array inside each habit, specifically so the
  sync merge can resolve per entry: ticking one habit on the phone and a different one on the
  laptop on the same day merges cleanly. Nested inside the habit, one device's tick would
  overwrite the other's.

  **`currentStreak()` does not break the streak when today is unticked.** It starts counting
  from yesterday if today is scheduled but not yet done — the day isn't over, and resetting a
  200-day streak at 00:01 for something there's still time to do would be punishing the user for
  the clock. Days the habit isn't scheduled are skipped, not counted as misses.

  The heatmap is generated SVG (one `<rect>` per day, ~370 of them) rather than canvas, so each
  cell gets a native `<title>` tooltip with no hit-testing code. Past days can be ticked
  retroactively by clicking a cell; future days can't. Colours come from CSS variables
  (`--heat-done`, `--heat-empty`, `--heat-off`) so dark mode resolves itself even though the
  markup is built as a string in JS. `--heat-empty` (missed) and `--heat-off` (not scheduled)
  are deliberately well separated: that's the difference between "you failed" and "didn't
  apply", and at similar tones a weekdays-only habit looks full of gaps that aren't gaps.
- **Focus timer** (`js/14-focus.js`) — floating pomodoro widget, bottom-left (the audio player
  owns bottom-right), at `z-index: 65` so it sits above the dashboard overlay (`z-60`) but below
  modals (`z-70`) and the palette (`z-90`).

  **State is persisted as a start timestamp, not a decrementing counter.** A counter stops
  being accurate the moment the browser throttles or suspends the tab — phone screen off,
  laptop asleep — because `setInterval` stops firing on schedule. A timestamp can always be
  compared against the clock, so the remaining time is right no matter how many ticks were
  skipped.

  Finished sessions are appended to `sessions` with the linked `taskId`/`projectId`, which is
  what turns "I feel like I spend a lot of time on X" into a number. Each session stores `day`
  as a **local** date key alongside the ISO `startedAt`: deriving the day from
  `startedAt.slice(0,10)` would give the UTC date, and in Colombia (UTC−5) anything after 19:00
  would be counted on the following day — precisely during the hours most work happens.

  Breaks are never auto-started; chaining rounds without asking is the fastest way to make the
  timer stop reflecting what you actually did.
- **Projects** — project tracker with 5-stage pipeline; data at `jdh_projects`. Tasks carry an
  optional `projectId`, and each project card rolls up what hangs off it: tasks done vs total,
  minutes actually focused on it (from `sessions`), and its open tasks with a one-click focus
  button. A task pointing at a deleted project just omits the chip rather than rendering
  `undefined`.
- **Notes ("Mi cerebro")** — the knowledge system, `js/11-notes.js`. Data still at `jdh_notes`,
  now with `pinned`, `archived` and `daily` (migrated by `migrateNotes()`).

  Three panes: note list (search + tag filter), editor, and a context sidebar with tags,
  backlinks and unresolved links.

  - **Markdown** via the in-house renderer (`js/10-markdown.js`), with a write / split / preview
    toggle persisted at `jdh_notesMode`.
  - **`[[Wikilinks]]`** connect notes. Typing `[[` opens an autocomplete; picking a title that
    doesn't exist yet creates the note. Links to non-existent notes render in amber as an
    invitation, not an error. **Links resolve by title, not id** — if two notes share a title the
    most recently updated one wins, and the list flags the clash with a `dup` badge.
  - **Backlinks** are derived, never stored: `notesIndex()` rebuilds the whole index (titles,
    tags, out-links, back-links) whenever notes change. With a few hundred notes that's cheap,
    and keeping no incremental state means there's nothing to fall out of sync.
  - **`#tags`** are extracted from the body, not a separate field to maintain. Tags inside code
    spans or fences are ignored, so `#2667ff` in a snippet isn't a tag.
  - **Daily note** — one note per day, titled `YYYY-MM-DD` with a `daily` field, created on
    demand from the button or the palette.
  - **Autosave** 700 ms after you stop typing, plus `Ctrl+S` and `beforeunload`. In a second
    brain, losing a paragraph because you didn't press Save is not acceptable. Editing only the
    body re-renders the sidebar rather than the whole view, so the textarea never loses focus
    mid-sentence.
- **Graph** (`js/12-graph.js`) — overlay showing notes as nodes and `[[links]]` as edges, laid
  out by a hand-written force simulation on canvas (repulsion + springs + centre gravity; no d3).
  Node size and opacity scale with degree; unconnected notes render muted, which is itself the
  useful signal. Clicking a node opens that note. The repulsion loop is O(n²) — fine for
  hundreds of notes; past a few thousand it would need Barnes-Hut.
- **Dropshipping** (`js/19-dropship.js`) — the business. Three tabs: Pedidos, Productos, Campañas.
  Collections: `orders`, `shopProducts` (named so to avoid colliding with the unrelated
  `projects`), `campaigns`.

  **Delivery rate is computed over *resolved* orders only** — delivered ÷ (delivered + returned).
  In-transit orders are excluded deliberately: counting them as failures would tank the rate every
  time a batch ships, and counting them as successes would inflate it. An unresolved order simply
  doesn't know what it is yet. Cancelled orders are excluded too — they never shipped, so they say
  nothing about whether the carrier delivers.

  **Unit economics** (`unitEconomics`) is the piece worth protecting. Reaching one delivery at a
  return rate `r` takes `1/(1-r)` orders, and ads are paid on *all* of them:

  ```
  margen = precio − costo − comisión − fleteIda
           − cpa/(1−r)                        ← publicidad de los que se devuelven
           − (r/(1−r)) × (fleteIda + fleteVuelta)
  ```

  The returned product itself comes back to stock, so its cost isn't lost — the freight is. The
  card also surfaces `cpaMaximo`, the bid ceiling at which margin hits zero; above it each order
  loses money even while the campaign looks healthy in Ads Manager.

  Return rate per product is **observed from the orders**, not typed in, unless
  `returnRateOverride` is set. Same for CPA: `observedCpa()` divides campaign spend by orders
  generated, falling back to the product's `targetCpa`.

  Money is handled in **whole pesos**. COP has no cents in practice, and accumulating floats
  across hundreds of rows produces few-peso discrepancies that are impossible to explain.
- **Automatización** (`js/16-rules.js`, `js/17-templates.js`) — two tabs.

  **Reglas.** Typed rules, not a generic `when <field> <op> <value>` builder: for one person a
  generic builder is a lot of UI for something configured once, and it allows constructing
  combinations that mean nothing. Six types ship (`escalate-overdue`, `stalled-doing`,
  `deadline-soon`, `streak-at-risk`, `untracked-high`, `daily-note`), each with two or three
  numeric parameters clamped to a declared range.

  **Rules that mutate are limited to reversible changes** (priority, status). Anything that
  would delete only reports. Losing data is the worst possible failure for a second brain, and
  an automation deleting things while you aren't looking is exactly how it happens.

  **Idempotence** works differently per kind. Mutating rules are idempotent by construction —
  the change makes the condition stop matching. Notice-producing rules need explicit memory,
  because the condition is still true tomorrow: they dedupe on `rule + entity + day` in
  `jdh_ruleSeen`. `runRules()` also holds a `rulesRunning` flag, because a rule mutating →
  `saveAll` → `onDataChanged` → `runRules` would otherwise loop forever.

  Notices land in a **device-local** inbox (`jdh_ruleNotices`, capped at 50), surfaced at the top
  of *Hoy* and as a badge on the nav. Deliberately not synced: it's the "the panel told me this"
  tray, and seeing it duplicated on two devices is noise, not information.

  **Plantillas.** `note` (title pattern + markdown body) and `project` (name pattern + stages +
  tasks created already linked to the project). Placeholders — `{{fecha}}`, `{{fechaLarga}}`,
  `{{dia}}`, `{{mes}}`, `{{anio}}`, `{{semana}}`, `{{hora}}` — are resolved **at instantiation,
  never stored resolved**: a template with the date already filled in has stopped being a
  template. Exactly one note template may be flagged `isDaily`; `ensureDailyNote()` uses it, and
  saving a second one clears the first, since two "the daily one" is an ambiguous state.
  Three starter templates are seeded once so the feature works on day one.
- **Revisión semanal** (`js/18-review.js`) — five guided steps (achievements, what's left,
  habits, projects, closing) reachable from *Hoy*, the palette, or `openReview()`.

  **It changes nothing on its own.** Step 2 lists overdue and stalled tasks and *offers* "Para
  hoy" / "Hecha"; you press them. A review that mutates while you read it stops being a review.

  The snapshot is frozen when the overlay opens, so numbers don't shift under you while you
  answer and while step 2 acts on tasks. Finishing writes a note `Revisión semana N` with the
  numbers **baked in as text** — in a month the live metrics can no longer reconstruct what you
  were looking at today. `jdh_lastReviewAt` drives the prompt card in *Hoy*, which appears when
  a week has passed or on weekends.
- **Métricas** (`js/15-insights.js`) — four stat tiles plus four charts: tasks completed per week
  (12w), focus minutes per day (30d), time per project (90d), habit consistency (30d). SVG
  generated by hand, no chart library.

  **All bars are one colour.** Each chart measures a single thing across nominal categories
  (projects, habits, days), so hue has no job: the category is already carried by its label and
  position, and painting each bar differently spends the identity channel re-encoding what bar
  length shows. A multi-hue categorical palette would only be warranted with several series in
  one frame, which none of these have. An earlier version did use eight hues here — it looked
  richer and said less.

  Charts are generated at the container's **measured pixel width** rather than scaled via
  `viewBox`, because a scaled viewBox enlarges the text with it and the tick labels end up
  oversized on wide screens. That means they must be re-rendered on resize *and* on theme
  change — the colours are baked into the generated SVG, so CSS alone can't restyle them
  (a `MutationObserver` on `<html>`'s class handles the theme case).

  Tasks store `completedAt`, set by `markTaskCompletion()`. `updatedAt` was the obvious
  shortcut but any later edit overwrites it, so a task finished in March and tweaked in
  September would count as September work and the weekly chart would be quietly wrong.
- **Data & Backup** — export/import as a single JSON file, wipe option, and the two durability
  mechanisms below.

## Durability (`js/07-sync.js`)

The dashboard used to live entirely in one browser's `localStorage`: clearing the cache lost
everything, and the phone and the laptop were separate universes. Two independent defences,
usable together or separately.

### The collection registry

`DATA_COLLECTIONS` in `js/05-dashboard.js` is the single list of what counts as user data:
`tasks`, `events`, `projects`, `notes`, `habits`, `habitLog`, `sessions`. Everything that
handles data wholesale iterates it — `saveAll()`, `buildBackupPayload()`, import, wipe, the
storage-size readout, and the sync merge in `js/07-sync.js`.

This used to be the same four names typed out in five places. Adding a collection meant
remembering all five, and missing one showed up as data that silently didn't sync or didn't get
backed up. `getCollection` / `setCollection` are plain switch statements because the
collections are loose `let` bindings reassigned on merge and import; wrapping them in an object
would mean rewriting every `tasks.push(...)` in the project.

**The backend mirrors this list** (`netlify/functions/data-sync.js`) but doesn't enforce it: it
validates whatever collections arrive and stores `data` verbatim, so a newer client pushing a
collection an older backend doesn't know about won't lose it, and an older client that omits
`habits` won't be rejected.

### Data model prerequisites
Merging two devices needs more than the raw records:
- **`updatedAt`** on every record — resolves conflicts per record instead of one device
  clobbering the other's whole state. `migrateTimestamps()` (called from `initDashboard`)
  stamps pre-existing records once, preferring `createdAt` so they don't claim to be newer
  than they are.
- **Tombstones** (`jdh_tombstones`) — a deletion is an *absence*, and an absence is
  indistinguishable from "this device hasn't seen it yet". Without a record of the delete,
  every sync would resurrect whatever you deleted elsewhere. Pruned after
  `TOMBSTONE_TTL_DAYS` (60).

Backup payloads are `version: 2` when they carry these; `version: 1` files still import.

### A) Cloud sync
Client-side merge against the [`data-sync` backend](architecture.md#backend-serverless-netlify-functions).
Cycle: pull → merge → save locally → push with `baseRev` → on `409`, re-merge against the
returned state and retry (up to 3 times). Local save happens *before* the push so a failed push
doesn't discard what was just pulled.

Merge rules, verified by `node tests/merge.test.js`:
- Highest `updatedAt` wins per record; a record with no `updatedAt` is treated as oldest.
- A tombstone removes the record **unless** the record was edited after the delete
  (`updatedAt > tombstone.at`) — deleting on the phone then continuing to edit on the laptop
  keeps the edit.
- No field-level merging inside a record. For one person, simultaneous edits of the same item
  are rare and cheap to get wrong; field-level merging would be far more code and much harder
  to reason about.

Triggers: dashboard unlock, 2.5 s debounce after any local change, tab regaining visibility,
every 5 min while open and visible, and the `online` event if a push is still pending.
Configured in "Conectar cuentas" → Sincronización; the URL falls back to `notion.proxyUrl`
since it's the same backend.

**Wipe interaction**: "Borrar todos los datos" asks a third question when sync is active —
whether the deletion should reach the cloud. Propagating it silently would mean someone
clearing one browser also destroys their backup.

### B) File auto-backup
File System Access API. You pick a `.json` once (ideally inside OneDrive/Drive) and the panel
rewrites it on every change, debounced 5 s. Needs no backend at all, which is the point: it
covers the case where the serverless side isn't deployed.

The `FileSystemFileHandle` is stored in **IndexedDB** (`jdh-fs` → `handles` → `backupFile`),
not `localStorage` — it isn't JSON-serializable but it is structured-cloneable. Write
permission is revoked when the browser closes, so on startup `restoreAutoBackup()` only
*queries* permission (no user gesture available) and surfaces a "Reautorizar" button when it
needs a click. Chrome and Edge desktop only; elsewhere the card reports it's unavailable.

### Agenda → Centro de tareas (task aggregation hub)
Bento-grid layout inside the existing "Agenda" section (not a separate top-level nav item, to
avoid a naming collision with the pre-existing calendar "Agenda" view). Tiles: a large combined
"Próximas tareas" summary, one medium tile per source (Trello / Outlook / Notion), and small
quick-action tiles (connect accounts, notifications, sync, phase status).

- **Connections** are configured from the "Conectar cuentas" modal (`#integrations-modal`),
  saved to `jdh_integrations` via the same `store` helper used elsewhere (`get`/`set` with the
  `jdh_` prefix). Shape:
  ```js
  {
    trello: { apiKey: '', token: '', boardId: '', verified: false },
    microsoft: { clientId: '', verified: false },  // Azure AD app Client ID
    notion: { proxyUrl: '', verified: false },     // Netlify Functions backend base URL (Phase 3)
    push: { vapidPublicKey: '' },                  // VAPID public key (not secret) for Web Push
    sync: { url: '', token: '', enabled: false },  // dashboard data sync (Phase 4). `url` empty
                                                   // → reuses notion.proxyUrl (same backend).
                                                   // `token` must match the backend's SYNC_TOKEN.
  }
  ```
  `verified` is set to `true` the first time a real fetch (Trello/Notion) or login (Microsoft)
  succeeds, and reset to `false` whenever the form for that source is re-submitted with new
  values or the source is disconnected.
- **Trello, Microsoft (Outlook / To Do) and Notion are all real integrations as of Phase 3.**
  Trello and Microsoft call their APIs directly from the browser using the credentials saved
  above — no backend involved for those two. **Notion goes through a small serverless proxy**
  (see [Architecture → Backend serverless](architecture.md#backend-serverless-netlify-functions))
  because its API token can't safely live in the browser; the client only ever knows the proxy's
  base URL (`notion.proxyUrl`), pasted after deploying that backend.
- **Connected/verified status**: `isTrelloConnected()` / `isMicrosoftConnected()` /
  `isNotionConnected()` check whether the required fields are non-empty ("credentials/endpoint
  saved"). `renderIntegrationsStatus()` additionally reads `integrations.<source>.verified` to
  show a precise status pill for all three sources: **"No conectado"** (nothing saved),
  **"Guardado, sin verificar"** (saved but no successful fetch/login yet — amber), or
  **"Conectado ✓"** (last fetch/login succeeded — accent color).
- **Rendering is modular per source** — `renderTrelloTasks()`, `renderOutlookTasks()` and
  `renderNotionTasks()` each render into their own `#trello-tasks-list` / `#outlook-tasks-list` /
  `#notion-tasks-list` containers, with shared state/error/loading helpers (`sourceLoadingState()`,
  `sourceErrorState()`, `renderTaskItems()`). Runtime fetch results (not persisted) live in the
  module-level `hubState.trello` / `hubState.outlook` / `hubState.notion` objects (`status`:
  `'idle' | 'loading' | 'ready' | 'error'`, plus `items`), which `renderAgendaSummary()` reads to
  build the combined "Próximas tareas" tile (all three sources merged and sorted by due date).
  `renderAgendaSummary()` also calls `syncExternalSummaryToBackend()` (best-effort, throttled to
  once per 5 min) to POST a lightweight Trello/Outlook summary to the backend, so its push cron
  can cover those sources too — see the "Known limitation" note in
  [Architecture](architecture.md#backend-serverless-netlify-functions).
  - **Trello**: `renderTrelloTasks()` calls `fetchTrelloCards()`, a direct `fetch()` to
    `https://api.trello.com/1/boards/{boardId}/cards?key=...&token=...&fields=name,due,idList&filter=open`
    (read-only, no `client.js` needed — `key`+`token` in the query string is enough). Cards are
    sorted by due date ascending. Network/auth failures are caught and shown as a distinct red
    error state (`sourceErrorState()`), separate from the "not connected" empty state.
  - **Microsoft (Outlook / To Do)**: uses `@azure/msal-browser` (loaded via CDN `<script>` in
    `<head>`, exposes a global `msal`) as a **public client (SPA), no client secret**. Connecting
    requires an explicit click on a "Conectar con Microsoft" button rendered inside the Outlook
    tile (`connectMicrosoft()` → `loginPopup()` with scopes `Tasks.Read` and `Calendars.Read`) —
    login is **never** triggered automatically on page load. On future loads, the app tries
    `acquireTokenSilent()` first; if that fails (expired/needs interaction), the tile shows a
    "Reconectar" button instead of silently popping up a login window. Once a token is obtained,
    `fetchOutlookItems()` calls Microsoft Graph: `GET /me/todo/lists` (to find the default list),
    `GET /me/todo/lists/{id}/tasks` (open tasks), and `GET /me/events` (upcoming events), merging
    and sorting both by date. `redirectUri` is set dynamically to `window.location.origin`, so it
    works both locally and in production **as long as each exact origin is registered in the Azure
    AD app** — see the setup checklist below.
  - **Notion**: `renderNotionTasks()` calls `fetchNotionTasks()`, a `fetch()` to
    `{proxyUrl}/notion/tasks` on the deployed Netlify Functions backend (no credentials sent from
    the client — the Notion token lives only as a server-side env var). Returns open
    (non-completed) pages sorted by due date; same loading/error/empty states as Trello/Outlook.
- **Push notifications**: "Activar notificaciones" button (`#enable-notifications-btn`) calls
  `Notification.requestPermission()` on explicit click (required by iOS Safari — never auto-fired
  on load). Status is read live from `Notification.permission`, not duplicated in storage. On
  grant, it registers the service worker (if needed), calls `pushManager.subscribe()` with the
  VAPID public key from `integrations.push.vapidPublicKey` (converted to a `Uint8Array` via
  `urlBase64ToUint8Array()`), and `POST`s the resulting `PushSubscription` to
  `{proxyUrl}/push/subscribe`. Requires both the VAPID public key and the proxy URL to be
  configured first (the button alerts and bails out otherwise). Actual push delivery is handled
  server-side by the `scheduled-check-deadlines.js` cron — see
  [Architecture → Backend serverless](architecture.md#backend-serverless-netlify-functions).

### Setting up the Microsoft (Azure AD) app for Outlook / To Do
The user connecting Outlook/To Do must register their own app in
[portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations:
1. **Platform**: add a **Single-page application (SPA)** platform (not "Web" — SPA is required for
   MSAL's `loginPopup`/silent token flows without a client secret).
2. **Redirect URI(s)**: the exact origin(s) the site is served from — e.g.
   `http://localhost:8080` for local dev and `https://your-production-domain.com` for production.
   MSAL uses `window.location.origin` dynamically, so no path is needed, but the origin must match
   exactly (scheme + host + port).
3. **Supported account types**: "Accounts in any organizational directory and personal Microsoft
   accounts" (multi-tenant + personal), so the site isn't locked to one Microsoft 365 tenant.
4. **API permissions** (delegated, not application): `Tasks.Read` and `Calendars.Read` from
   Microsoft Graph. These only need the signed-in user's own consent — no admin consent required.
5. Copy the **Application (client) ID** from the app's Overview page and paste it into the
   "Conectar cuentas" modal → Microsoft → Client ID field in the dashboard.

## localStorage keys
| Key | Contents |
|-----|----------|
| `theme` | `'dark'` or `'light'` |
| `jdh_tasks` | Kanban task array |
| `jdh_events` | Calendar event array |
| `jdh_projects` | Project tracker array |
| `jdh_notes` | Notes array |
| `jdh_audioPrefs` | `{minimized, shuffle, repeat}` |
| `jdh_lastBackup` | ISO timestamp of last export |
| `jdh_integrations` | Trello/Microsoft/Notion/push/sync connection settings (see above) |
| `jdh_agendaTab` | Last active Agenda tab (`'calendar'` or `'hub'`) |
| `jdh_tombstones` | `[{ kind, id, at }]` — deletion records, pruned after 60 days |
| `jdh_syncRev` | Last cloud revision this browser successfully pushed |
| `jdh_syncLastAt` | ISO timestamp of the last successful sync |
| `jdh_syncDirty` | `true` if local changes still need pushing (survives reloads) |
| `jdh_autoBackupName` | Filename of the auto-backup target, for display only |
| `jdh_autoBackupAt` | ISO timestamp of the last auto-backup write |
| `jdh_habits` | Habit definitions |
| `jdh_habitLog` | `[{ habitId, date }]` — one record per completed day |
| `jdh_sessions` | Finished focus sessions (minutes, linked task/project, local `day`) |
| `jdh_notesMode` | Last editor mode (`'write'` / `'split'` / `'preview'`) |
| `jdh_focusRun` | In-flight timer state, so a reload doesn't lose a running session |
| `jdh_focusSettings` | Pomodoro durations (focus / short / long / rounds) |
| `jdh_rules` | Automation rules (synced) |
| `jdh_templates` | Note and project templates (synced) |
| `jdh_ruleNotices` | Notice inbox — **device-local, not synced** |
| `jdh_ruleSeen` | Notice dedupe keys (`rule:entity:day`), pruned after 14 days |
| `jdh_lastReviewAt` | ISO timestamp of the last weekly review |
| `jdh_autoTab` | Last active Automatización tab |

Not in `localStorage`: the `FileSystemFileHandle` for auto-backup lives in IndexedDB
(`jdh-fs` → `handles` → `backupFile`), because handles can't be serialized to JSON.
