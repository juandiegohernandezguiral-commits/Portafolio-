/* 06-integrations.js - Centro de tareas: Trello, Microsoft Graph (Outlook /
   To Do), Notion via proxy serverless y suscripcion a notificaciones push. */

/* ============ AGENDA HUB — Trello / Outlook / Notion + push notifications ============
   Fase 2: Trello y Microsoft Graph (Outlook / To Do) hacen llamadas reales a sus APIs directo
   desde el navegador usando las credenciales guardadas en localStorage (jdh_integrations).
   Fase 3: Notion ya es una integración real también, pero vía un proxy serverless (no puede
   llamarse directo desde el navegador sin exponer el token de Notion) — ver /netlify/functions.
   El mismo proxy expone además el registro de suscripciones push y el endpoint de sincronización
   ligera de Trello/Outlook que usa el cron para poder notificar también sobre esas fuentes
   (ver docs/architecture.md → "Backend serverless"). */

const integrationsDefault = {
  trello: { apiKey: '', token: '', boardId: '', verified: false },
  microsoft: { clientId: '', verified: false },
  notion: { proxyUrl: '', verified: false }, // proxyUrl also hosts /push/subscribe and /sync/external-summary
  push: { vapidPublicKey: '' },
};
let integrations = store.get('integrations', integrationsDefault);
// Backfill in case a saved object predates one of the keys (e.g. `verified` added in Fase 2,
// `push` and `notion.verified` added in Fase 3)
integrations = {
  ...integrationsDefault,
  ...integrations,
  trello: { ...integrationsDefault.trello, ...integrations.trello },
  microsoft: { ...integrationsDefault.microsoft, ...integrations.microsoft },
  notion: { ...integrationsDefault.notion, ...integrations.notion },
  push: { ...integrationsDefault.push, ...integrations.push },
};
function saveIntegrations() { store.set('integrations', integrations); }

function isTrelloConnected() { return !!(integrations.trello.apiKey && integrations.trello.token && integrations.trello.boardId); }
function isMicrosoftConnected() { return !!(integrations.microsoft.clientId); }
function isNotionConnected() { return !!(integrations.notion.proxyUrl); }

// Runtime (non-persisted) state of the last fetch per source, used to render the tile + combine
// results in the big summary tile. `status`: 'idle' | 'loading' | 'ready' | 'error'.
const hubState = {
  trello: { status: 'idle', items: [], error: null },
  outlook: { status: 'idle', items: [], error: null },
  notion: { status: 'idle', items: [], error: null },
};

function sourceEmptyState(key, connectedMsg, disconnectedMsg) {
  const connected = { trello: isTrelloConnected(), microsoft: isMicrosoftConnected(), notion: isNotionConnected() }[key];
  if (!connected) {
    return `
      <div class="text-center py-6">
        <p class="text-neutral-500 text-xs leading-relaxed mb-3">${disconnectedMsg}</p>
        <button type="button" class="meta-label !text-accent" data-open-integrations="${key}">Conectar →</button>
      </div>`;
  }
  return `
    <div class="text-center py-6">
      <div class="w-8 h-8 mx-auto mb-2 rounded-full bg-accent/10 flex items-center justify-center">
        <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>
      </div>
      <p class="text-neutral-500 text-xs leading-relaxed">${connectedMsg}</p>
    </div>`;
}
function sourceLoadingState() {
  return `<div class="flex items-center justify-center py-8"><span class="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin"></span></div>`;
}
function sourceErrorState(msg) {
  return `
    <div class="text-center py-6">
      <div class="w-8 h-8 mx-auto mb-2 rounded-full bg-red-500/10 flex items-center justify-center">
        <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
      </div>
      <p class="text-red-500 text-xs leading-relaxed">${msg}</p>
    </div>`;
}
function formatDue(d) {
  if (!d) return '';
  const datePart = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  const timePart = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}
function renderTaskItems(items, emptyMsg) {
  if (!items.length) {
    return `<div class="text-center py-6"><p class="text-neutral-500 text-xs leading-relaxed">${emptyMsg}</p></div>`;
  }
  const now = Date.now();
  return `
    <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
      ${items.slice(0, 8).map(it => {
        const overdue = it.due && it.due.getTime() < now;
        return `
        <div class="flex items-start gap-2 p-2.5 rounded-lg surface-soft">
          <span class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${overdue ? 'bg-red-500' : 'bg-accent'}"></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">${escapeHtml(it.title || 'Sin título')}</p>
            ${it.due ? `<p class="meta-label ${overdue ? 'text-red-500' : 'text-neutral-500'}">${formatDue(it.due)}${overdue ? ' · vencida' : ''}</p>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ---- Trello: fetch directo, sin backend (key + token en query params, solo lectura) ---- */
async function fetchTrelloCards() {
  const { apiKey, token, boardId } = integrations.trello;
  const url = `https://api.trello.com/1/boards/${encodeURIComponent(boardId)}/cards`
    + `?key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&fields=name,due,idList&filter=open`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Trello API respondió ${res.status}`);
  const cards = await res.json();
  return cards
    .map(c => ({ id: c.id, title: c.name, due: c.due ? new Date(c.due) : null }))
    .sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
}

async function renderTrelloTasks() {
  const el = document.getElementById('trello-tasks-list');
  if (!el) return;
  if (!isTrelloConnected()) {
    hubState.trello = { status: 'idle', items: [], error: null };
    el.innerHTML = sourceEmptyState('trello', '', 'Conecta tu tablero de Trello para ver tus tarjetas aquí.');
    renderAgendaSummary();
    return;
  }
  hubState.trello.status = 'loading';
  el.innerHTML = sourceLoadingState();
  try {
    const items = await fetchTrelloCards();
    hubState.trello = { status: 'ready', items, error: null };
    if (!integrations.trello.verified) { integrations.trello.verified = true; saveIntegrations(); }
    renderIntegrationsStatus();
    el.innerHTML = renderTaskItems(items, 'No tienes tarjetas pendientes en este tablero.');
  } catch (err) {
    console.warn('[trello] fetch failed:', err);
    hubState.trello = { status: 'error', items: [], error: err };
    el.innerHTML = sourceErrorState('No se pudo conectar con Trello. Revisa tu API key, token e ID de tablero.');
  }
  renderAgendaSummary();
}

/* ---- Microsoft Graph (Outlook / To Do) vía MSAL.js — aplicación pública (SPA), sin backend ----
   El usuario debe registrar su propia app en https://portal.azure.com → App registrations:
     - Tipo de plataforma: "Single-page application (SPA)"
     - Redirect URI: el origin EXACTO donde sirvas este sitio (ej. https://tudominio.com o
       http://localhost:8080 en desarrollo). MSAL usa window.location.origin dinámicamente, así
       que hay que registrar cada origen que se use (local + producción) en el portal de Azure.
     - Cuentas admitidas: "Cuentas en cualquier directorio organizativo y cuentas Microsoft
       personales" (multi-tenant + personal), para no limitar a un solo tenant.
     - Permisos de API (delegados, consentimiento del propio usuario): Tasks.Read, Calendars.Read
   El Client ID resultante se pega en el modal "Conectar cuentas" → Microsoft. */
const MSAL_SCOPES = ['Tasks.Read', 'Calendars.Read'];
let msalInstance = null;
let msalReadyPromise = null;
function getMsalInstance() {
  if (!window.msal || !integrations.microsoft.clientId) return null;
  if (!msalInstance || msalInstance.__clientId !== integrations.microsoft.clientId) {
    msalInstance = new msal.PublicClientApplication({
      auth: {
        clientId: integrations.microsoft.clientId,
        authority: 'https://login.microsoftonline.com/common',
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    msalInstance.__clientId = integrations.microsoft.clientId;
    msalReadyPromise = msalInstance.initialize ? msalInstance.initialize() : Promise.resolve();
  }
  return msalInstance;
}
async function ensureMsalReady() {
  const instance = getMsalInstance();
  if (!instance) return null;
  await msalReadyPromise;
  return instance;
}

async function connectMicrosoft() {
  const instance = await ensureMsalReady();
  if (!instance) { alert('No se pudo cargar la librería de Microsoft (MSAL). Revisa tu conexión a internet.'); return; }
  try {
    const result = await instance.loginPopup({ scopes: MSAL_SCOPES });
    instance.setActiveAccount(result.account);
    integrations.microsoft.verified = true;
    saveIntegrations();
    renderIntegrationsStatus();
    renderOutlookTasks();
  } catch (err) {
    console.warn('[microsoft] login failed:', err);
    alert('No se pudo iniciar sesión con Microsoft. Revisa el Client ID configurado en "Conectar cuentas".');
  }
}

async function fetchOutlookItems(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const [listsRes, eventsRes] = await Promise.all([
    fetch('https://graph.microsoft.com/v1.0/me/todo/lists', { headers }),
    fetch('https://graph.microsoft.com/v1.0/me/events?$select=subject,start&$orderby=start/dateTime&$top=15', { headers }),
  ]);
  if (!listsRes.ok) throw new Error(`Graph /todo/lists respondió ${listsRes.status}`);
  if (!eventsRes.ok) throw new Error(`Graph /events respondió ${eventsRes.status}`);
  const listsData = await listsRes.json();
  const eventsData = await eventsRes.json();

  let taskItems = [];
  const lists = listsData.value || [];
  const defaultList = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
  if (defaultList) {
    const tasksRes = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${defaultList.id}/tasks?$top=25`, { headers });
    if (tasksRes.ok) {
      const tasksData = await tasksRes.json();
      taskItems = (tasksData.value || [])
        .filter(t => t.status !== 'completed')
        .map(t => ({ id: t.id, title: t.title, due: t.dueDateTime?.dateTime ? new Date(t.dueDateTime.dateTime + 'Z') : null }));
    }
  }
  const nowMs = Date.now();
  const eventItems = (eventsData.value || [])
    .map(e => ({ id: e.id, title: e.subject, due: e.start?.dateTime ? new Date(e.start.dateTime + 'Z') : null }))
    .filter(e => !e.due || e.due.getTime() >= nowMs - 60 * 60 * 1000);

  return [...taskItems, ...eventItems].sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
}

async function renderOutlookTasks() {
  const el = document.getElementById('outlook-tasks-list');
  if (!el) return;
  if (!isMicrosoftConnected()) {
    hubState.outlook = { status: 'idle', items: [], error: null };
    el.innerHTML = sourceEmptyState('microsoft', '', 'Conecta tu cuenta de Microsoft para ver tus tareas y eventos aquí.');
    renderAgendaSummary();
    return;
  }
  const instance = await ensureMsalReady();
  if (!instance) {
    el.innerHTML = sourceErrorState('No se pudo cargar la librería de Microsoft (MSAL.js). Revisa tu conexión a internet.');
    renderAgendaSummary();
    return;
  }
  const account = instance.getActiveAccount() || instance.getAllAccounts()[0];
  if (!account) {
    // Sin sesión iniciada todavía: nunca disparar el popup solo — requiere clic explícito del usuario.
    el.innerHTML = `
      <div class="text-center py-6">
        <p class="text-neutral-500 text-xs leading-relaxed mb-3">Client ID guardado. Conecta tu cuenta para ver tus tareas y eventos.</p>
        <button type="button" id="ms-connect-btn" class="px-4 py-2 rounded-full bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Conectar con Microsoft</button>
      </div>`;
    document.getElementById('ms-connect-btn')?.addEventListener('click', connectMicrosoft);
    renderAgendaSummary();
    return;
  }
  hubState.outlook.status = 'loading';
  el.innerHTML = sourceLoadingState();
  let token;
  try {
    const tokenRes = await instance.acquireTokenSilent({ scopes: MSAL_SCOPES, account });
    token = tokenRes.accessToken;
  } catch (err) {
    console.warn('[outlook] silent token acquisition failed:', err);
    hubState.outlook = { status: 'error', items: [], error: err };
    el.innerHTML = `
      <div class="text-center py-6">
        <p class="text-neutral-500 text-xs leading-relaxed mb-3">Tu sesión de Microsoft expiró o necesita confirmación.</p>
        <button type="button" id="ms-reconnect-btn" class="px-4 py-2 rounded-full bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Reconectar</button>
      </div>`;
    document.getElementById('ms-reconnect-btn')?.addEventListener('click', connectMicrosoft);
    renderAgendaSummary();
    return;
  }
  try {
    const items = await fetchOutlookItems(token);
    hubState.outlook = { status: 'ready', items, error: null };
    if (!integrations.microsoft.verified) { integrations.microsoft.verified = true; saveIntegrations(); }
    renderIntegrationsStatus();
    el.innerHTML = renderTaskItems(items, 'No tienes tareas ni eventos próximos.');
  } catch (err) {
    console.warn('[outlook] Graph fetch failed:', err);
    hubState.outlook = { status: 'error', items: [], error: err };
    el.innerHTML = sourceErrorState('No se pudo obtener tus datos de Microsoft Graph. Verifica los permisos concedidos.');
  }
  renderAgendaSummary();
}

/* ---- Notion: vía proxy serverless propio (el token de Notion nunca llega al navegador) ----
   El cliente solo conoce la URL base del proxy (integrations.notion.proxyUrl), guardada en
   "Conectar cuentas". El proxy real vive en /netlify/functions/notion-tasks.js — ver
   docs/architecture.md para el contrato completo. */
async function fetchNotionTasks() {
  const proxyUrl = integrations.notion.proxyUrl.replace(/\/$/, '');
  const res = await fetch(`${proxyUrl}/notion/tasks`);
  if (!res.ok) throw new Error(`Proxy de Notion respondió ${res.status}`);
  const data = await res.json();
  return (data.items || [])
    .map(it => ({ id: it.id, title: it.title, due: it.due ? new Date(it.due) : null }))
    .sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
}

async function renderNotionTasks() {
  const el = document.getElementById('notion-tasks-list');
  if (!el) return;
  if (!isNotionConnected()) {
    hubState.notion = { status: 'idle', items: [], error: null };
    el.innerHTML = sourceEmptyState('notion', '', 'Configura el endpoint del proxy para ver tus páginas de Notion aquí.');
    renderAgendaSummary();
    return;
  }
  hubState.notion.status = 'loading';
  el.innerHTML = sourceLoadingState();
  try {
    const items = await fetchNotionTasks();
    hubState.notion = { status: 'ready', items, error: null };
    if (!integrations.notion.verified) { integrations.notion.verified = true; saveIntegrations(); }
    renderIntegrationsStatus();
    el.innerHTML = renderTaskItems(items, 'No tienes páginas pendientes en esta base de datos.');
  } catch (err) {
    console.warn('[notion] fetch failed:', err);
    hubState.notion = { status: 'error', items: [], error: err };
    el.innerHTML = sourceErrorState('No se pudo conectar con el proxy de Notion. Revisa la URL configurada y que la función esté desplegada.');
  }
  renderAgendaSummary();
}

/* ---- Sincronización ligera de Trello/Outlook hacia el backend (para el cron de push) ----
   Trello/Outlook solo tienen credenciales en el navegador (Fase 2, por diseño, para no requerir
   infraestructura extra). El backend serverless nunca puede llamarlos directamente. Como
   solución pragmática, cada vez que el dashboard combina resultados reales aquí, le manda al
   proxy un resumen mínimo (id, título, fecha de vencimiento, fuente — nunca credenciales) para
   que el cron pueda incluir vencimientos de Trello/Outlook en sus notificaciones push, además
   de Notion (que sí consulta en vivo desde el servidor). Ver /netlify/functions/sync-external-
   summary.js. Es best-effort: si falla, no rompe la UI; si el proxy no está configurado, no se
   intenta. Se limita a una vez cada 5 minutos para no saturar el backend en cada render. */
let lastExternalSyncAt = 0;
async function syncExternalSummaryToBackend(combinedItems) {
  const proxyUrl = (integrations.notion.proxyUrl || '').trim();
  if (!proxyUrl) return;
  const now = Date.now();
  if (now - lastExternalSyncAt < 5 * 60 * 1000) return;
  lastExternalSyncAt = now;
  const items = combinedItems
    .filter(it => it.sourceName === 'Trello' || it.sourceName === 'Outlook')
    .slice(0, 50)
    .map(it => ({ id: it.id, title: it.title, due: it.due ? it.due.toISOString() : null, source: it.sourceName.toLowerCase() }));
  try {
    await fetch(`${proxyUrl.replace(/\/$/, '')}/sync/external-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  } catch (err) {
    console.warn('[sync] external summary sync failed (non-blocking):', err);
  }
}

function renderAgendaSummary() {
  const el = document.getElementById('agenda-hub-summary');
  if (!el) return;
  const sources = [
    { key: 'trello', name: 'Trello', color: '#0052CC', connected: isTrelloConnected() },
    { key: 'microsoft', name: 'Outlook', color: '#0078D4', connected: isMicrosoftConnected() },
    { key: 'notion', name: 'Notion', color: '#525252', connected: isNotionConnected() },
  ];
  const connected = sources.filter(s => s.connected);
  if (!connected.length) {
    el.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center py-6">
        <div class="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center mb-4">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="1.5"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <p class="text-neutral-500 text-sm max-w-xs mb-4">Conecta Trello, Outlook o Notion para ver aquí todas tus tareas combinadas, en un solo lugar.</p>
        <button type="button" data-open-integrations class="px-5 py-2.5 rounded-full bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Conectar cuentas</button>
      </div>`;
    return;
  }

  // Combina resultados reales de Trello + Outlook + Notion.
  const combined = [];
  if (isTrelloConnected()) hubState.trello.items.forEach(it => combined.push({ ...it, sourceName: 'Trello', color: '#0052CC' }));
  if (isMicrosoftConnected()) hubState.outlook.items.forEach(it => combined.push({ ...it, sourceName: 'Outlook', color: '#0078D4' }));
  if (isNotionConnected()) hubState.notion.items.forEach(it => combined.push({ ...it, sourceName: 'Notion', color: '#525252' }));
  combined.sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));

  // Envío best-effort al backend (no bloqueante) de un resumen ligero de Trello/Outlook, para
  // que el cron de notificaciones push pueda cubrir esas fuentes además de Notion (ver
  // docs/architecture.md → "Limitación conocida" en la sección del backend serverless).
  syncExternalSummaryToBackend(combined);

  const anyLoading = (isTrelloConnected() && hubState.trello.status === 'loading') || (isMicrosoftConnected() && hubState.outlook.status === 'loading') || (isNotionConnected() && hubState.notion.status === 'loading');
  if (!combined.length && anyLoading) { el.innerHTML = sourceLoadingState(); return; }

  const anyError = (isTrelloConnected() && hubState.trello.status === 'error') || (isMicrosoftConnected() && hubState.outlook.status === 'error') || (isNotionConnected() && hubState.notion.status === 'error');
  const errorNote = anyError ? `<p class="meta-label text-red-500 mb-2">Una o más fuentes no pudieron sincronizarse — revisa su tile para más detalle.</p>` : '';

  if (!combined.length) {
    el.innerHTML = `${errorNote}<div class="text-center py-6 text-neutral-500 text-sm">No tienes tareas ni eventos próximos.</div>`;
    return;
  }

  const now = Date.now();
  el.innerHTML = `${errorNote}
    <div class="space-y-2">
      ${combined.slice(0, 10).map(it => {
        const overdue = it.due && it.due.getTime() < now;
        return `
        <div class="flex items-center gap-3 p-3 rounded-xl surface-soft">
          <span class="w-2 h-2 rounded-full shrink-0" style="background:${it.color}"></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold truncate">${escapeHtml(it.title || 'Sin título')}</p>
            <p class="meta-label text-neutral-400">${it.sourceName}${it.due ? ' · ' + formatDue(it.due) : ''}</p>
          </div>
          ${overdue ? '<span class="meta-label text-red-500 shrink-0">Vencida</span>' : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function renderIntegrationsStatus() {
  const map = {
    trello: { connected: isTrelloConnected(), verified: !!integrations.trello.verified },
    microsoft: { connected: isMicrosoftConnected(), verified: !!integrations.microsoft.verified },
    notion: { connected: isNotionConnected(), verified: !!integrations.notion.verified },
  };
  Object.entries(map).forEach(([key, { connected, verified }]) => {
    document.querySelectorAll(`[data-status-pill="${key}"]`).forEach(el => {
      el.classList.remove('text-accent', 'text-neutral-500', 'text-amber-500');
      if (!connected) {
        el.textContent = 'No conectado';
        el.classList.add('text-neutral-500');
      } else if (verified) {
        el.textContent = 'Conectado ✓';
        el.classList.add('text-accent');
      } else {
        el.textContent = 'Guardado, sin verificar';
        el.classList.add('text-amber-500');
      }
    });
  });
  const connectedCount = Object.values(map).filter(m => m.connected).length;
  const countEl = document.getElementById('agenda-sources-count');
  if (countEl) countEl.textContent = `${connectedCount}/3 conectadas`;
  const dotEl = document.getElementById('agenda-sources-dot');
  if (dotEl) dotEl.classList.toggle('bg-accent', connectedCount > 0);
  if (dotEl) dotEl.classList.toggle('bg-neutral-400', connectedCount === 0);
}

function renderIntegrationsForm() {
  const tf = document.getElementById('trello-form');
  if (tf) { tf.apiKey.value = integrations.trello.apiKey; tf.token.value = integrations.trello.token; tf.boardId.value = integrations.trello.boardId; }
  const mf = document.getElementById('microsoft-form');
  if (mf) { mf.clientId.value = integrations.microsoft.clientId; }
  const nf = document.getElementById('notion-form');
  if (nf) { nf.proxyUrl.value = integrations.notion.proxyUrl; }
  const pf = document.getElementById('push-form');
  if (pf) { pf.vapidPublicKey.value = integrations.push.vapidPublicKey; }
}

function renderNotifStatus() {
  const label = document.getElementById('notif-status-label');
  const btn = document.getElementById('enable-notifications-btn');
  if (!label || !btn) return;
  if (!('Notification' in window)) {
    label.textContent = 'No soportadas en este navegador';
    label.className = 'text-neutral-500 text-xs mb-3';
    btn.disabled = true; btn.classList.add('opacity-40', 'cursor-not-allowed');
    return;
  }
  const perm = Notification.permission;
  btn.disabled = false; btn.classList.remove('opacity-40', 'opacity-60', 'cursor-not-allowed');
  if (perm === 'granted') {
    label.textContent = 'Activadas ✓'; label.className = 'text-accent text-xs mb-3';
    btn.textContent = 'Activadas'; btn.disabled = true; btn.classList.add('opacity-60');
  } else if (perm === 'denied') {
    label.textContent = 'Bloqueadas por el navegador'; label.className = 'text-red-500 text-xs mb-3';
    btn.textContent = 'Bloqueadas'; btn.disabled = true; btn.classList.add('opacity-40', 'cursor-not-allowed');
  } else {
    label.textContent = 'No activadas'; label.className = 'text-neutral-500 text-xs mb-3';
    btn.textContent = 'Activar';
  }
}

function renderAgendaHub() {
  renderIntegrationsStatus();
  renderIntegrationsForm();
  renderTrelloTasks();
  renderOutlookTasks();
  renderNotionTasks();
  renderAgendaSummary();
  renderNotifStatus();
}

function showAgendaTab(name) {
  document.querySelectorAll('[data-agenda-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.agendaPanel !== name));
  document.querySelectorAll('.agenda-tab-btn').forEach(b => {
    const active = b.dataset.agendaTab === name;
    b.classList.toggle('bg-accent', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('text-neutral-500', !active);
  });
  if (name === 'hub') renderAgendaHub();
  localStorage.setItem('jdh_agendaTab', name);
}
document.querySelectorAll('.agenda-tab-btn').forEach(b => b.addEventListener('click', () => showAgendaTab(b.dataset.agendaTab)));

const integrationsModal = document.getElementById('integrations-modal');
function openIntegrationsModal(focusKey) {
  renderIntegrationsForm();
  renderIntegrationsStatus();
  integrationsModal.classList.remove('hidden'); integrationsModal.classList.add('flex');
  if (focusKey) {
    const section = integrationsModal.querySelector(`[data-integration-section="${focusKey}"]`);
    section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
document.getElementById('open-integrations-btn')?.addEventListener('click', () => openIntegrationsModal());
document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-open-integrations]');
  if (trigger) openIntegrationsModal(trigger.dataset.openIntegrations || null);
});

document.getElementById('trello-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  // Nuevas credenciales pegadas por el usuario: se marcan como "sin verificar" hasta el próximo fetch exitoso.
  integrations.trello = { apiKey: (fd.get('apiKey') || '').trim(), token: (fd.get('token') || '').trim(), boardId: (fd.get('boardId') || '').trim(), verified: false };
  hubState.trello = { status: 'idle', items: [], error: null };
  saveIntegrations(); renderAgendaHub();
});
document.getElementById('microsoft-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const newClientId = (fd.get('clientId') || '').trim();
  if (newClientId !== integrations.microsoft.clientId) { msalInstance = null; msalReadyPromise = null; }
  integrations.microsoft = { clientId: newClientId, verified: false };
  hubState.outlook = { status: 'idle', items: [], error: null };
  saveIntegrations(); renderAgendaHub();
});
document.getElementById('notion-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  integrations.notion = { proxyUrl: (fd.get('proxyUrl') || '').trim(), verified: false };
  hubState.notion = { status: 'idle', items: [], error: null };
  saveIntegrations(); renderAgendaHub();
});
document.getElementById('push-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  integrations.push = { vapidPublicKey: (fd.get('vapidPublicKey') || '').trim() };
  saveIntegrations(); renderAgendaHub();
});
const disconnectLabels = { trello: 'Trello', microsoft: 'Microsoft', notion: 'Notion', push: 'la clave VAPID de notificaciones push' };
document.querySelectorAll('[data-disconnect]').forEach(b => b.addEventListener('click', async () => {
  const key = b.dataset.disconnect;
  if (!confirm(`¿Desconectar ${disconnectLabels[key] || key}? Se borrará lo guardado en este navegador.`)) return;
  if (key === 'microsoft' && msalInstance) {
    // Limpia la cuenta cacheada por MSAL para que el próximo fetch pida reconexión explícita.
    try {
      const accounts = msalInstance.getAllAccounts();
      for (const acc of accounts) { await msalInstance.getTokenCache().removeAccount(acc); }
      msalInstance.setActiveAccount(null);
    } catch (err) { console.warn('[microsoft] cleanup on disconnect failed:', err); }
    msalInstance = null; msalReadyPromise = null;
  }
  if (key === 'trello') hubState.trello = { status: 'idle', items: [], error: null };
  if (key === 'microsoft') hubState.outlook = { status: 'idle', items: [], error: null };
  if (key === 'notion') hubState.notion = { status: 'idle', items: [], error: null };
  integrations[key] = { ...integrationsDefault[key] };
  saveIntegrations();
  renderAgendaHub();
}));

document.getElementById('sync-now-btn')?.addEventListener('click', async () => {
  const anyConnected = isTrelloConnected() || isMicrosoftConnected() || isNotionConnected();
  if (!anyConnected) { alert('Conecta al menos una cuenta antes de sincronizar.'); return; }
  await Promise.all([renderTrelloTasks(), renderOutlookTasks(), renderNotionTasks()]);
  renderAgendaSummary();
  const label = document.getElementById('last-sync-label');
  if (label) label.textContent = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
});

// Convierte la VAPID public key (base64url, formato estándar de `web-push generate-vapid-keys`)
// al Uint8Array que pide pushManager.subscribe({ applicationServerKey }).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

document.getElementById('enable-notifications-btn')?.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    renderNotifStatus();
    if (perm !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const vapidPublicKey = (integrations.push.vapidPublicKey || '').trim();
    const proxyUrl = (integrations.notion.proxyUrl || '').trim();
    if (!vapidPublicKey || !proxyUrl) {
      alert('Faltan datos: configura la VAPID Public Key y la URL del proxy (backend) en "Conectar cuentas" → Notion / Notificaciones push antes de activar.');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }
    // Registra la suscripción real en el backend (Netlify Blobs, ver /netlify/functions/push-subscribe.js).
    // La suscripción no contiene credenciales de nada — solo el endpoint push del navegador.
    await fetch(`${proxyUrl.replace(/\/$/, '')}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
  } catch (err) {
    console.warn('[notifications] subscription failed:', err);
    alert('No se pudo completar la suscripción a notificaciones push. Revisa la consola para más detalle.');
  }
});
