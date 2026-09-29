# Private dashboard (`#dashboard`)

A hidden full-screen overlay accessible via the footer "Panel privado" button or `Alt+P`. Protected by a 4-digit PIN — see [Customization](customization.md) for the constant. All data persists to `localStorage`.

## Views
- **Overview** — summary stats pulled from all other modules
- **Agenda** — two tabs, switched with `showAgendaTab()`:
  - **Calendario** — original events view; events stored as `jdh_events`
  - **Centro de tareas** — bento-grid hub aggregating Trello, Outlook/To Do and Notion (see below)
- **Tasks (Kanban)** — drag-and-drop 3-column board; data at `jdh_tasks`
- **Projects** — project tracker with 5-stage pipeline; data at `jdh_projects`
- **Notes** — freeform notes grid; data at `jdh_notes`
- **Data & Backup** — export/import all data as a single JSON file; wipe option

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
| `jdh_integrations` | Trello/Microsoft/Notion/push connection settings (see above) |
| `jdh_agendaTab` | Last active Agenda tab (`'calendar'` or `'hub'`) |
