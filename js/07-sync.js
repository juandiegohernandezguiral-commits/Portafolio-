/* 07-sync.js — durabilidad de los datos del panel. Dos mecanismos independientes:

   A) SYNC EN LA NUBE (requiere desplegar el backend de /netlify/functions)
      Fusiona los datos de este navegador con el snapshot remoto, para que el
      portátil y el celular vean lo mismo y para que un borrado de caché no sea
      una pérdida definitiva.

   B) AUTO-BACKUP A UN ARCHIVO (no requiere backend alguno)
      Usa la File System Access API: eliges una vez un .json (idealmente dentro
      de tu carpeta de OneDrive/Drive) y el panel lo reescribe solo en cada
      cambio. Protege contra el escenario que la nube no cubre gratis: que el
      backend no esté desplegado.

   Las dos son complementarias y se pueden usar por separado. Ambas se disparan
   desde `onDataChanged()`, que saveAll() invoca tras cada escritura local. */

/* ============ REGISTRO DE CAMBIOS ============
   saveAll() (js/05-dashboard.js) llama a onDataChanged() tras cada escritura.
   Se resuelve con una lista de suscriptores en vez de una sola función para que
   los módulos que cargan después (paleta de comandos, vista Hoy) puedan
   engancharse sin tener que editar este archivo. */
const dataChangeHandlers = [];
function onDataChanged() {
  dataChangeHandlers.forEach(h => {
    try { h(); } catch (err) { console.warn('[data-change] un suscriptor falló:', err); }
  });
}

/* ============================================================================
   A) SYNC EN LA NUBE
   ========================================================================== */

/* El backend del sync es el mismo que el proxy de Notion, así que si ya pegaste
   esa URL no hace falta repetirla: `sync.url` sólo se usa si está rellena. */
function syncBaseUrl() {
  const explicit = (integrations.sync?.url || '').trim();
  const fallback = (integrations.notion?.proxyUrl || '').trim();
  return (explicit || fallback).replace(/\/$/, '');
}
function syncToken() { return (integrations.sync?.token || '').trim(); }
function isSyncConfigured() { return !!(syncBaseUrl() && syncToken() && integrations.sync?.enabled); }

const syncState = {
  status: 'idle',      // 'idle' | 'syncing' | 'ok' | 'error' | 'offline'
  error: null,
  lastSyncAt: store.get('syncLastAt', null),
  rev: store.get('syncRev', 0),
  dirty: store.get('syncDirty', false),
};

function persistSyncMeta() {
  store.set('syncRev', syncState.rev);
  store.set('syncLastAt', syncState.lastSyncAt);
  store.set('syncDirty', syncState.dirty);
}

function syncHeaders(extra) {
  return { 'X-Sync-Token': syncToken(), ...(extra || {}) };
}

/* ---- Fusión ----
   Regla por registro: gana el `updatedAt` más alto. Regla de borrado: un
   tombstone elimina el registro salvo que el registro se haya editado DESPUÉS
   del borrado (`updatedAt > tombstone.at`), caso en que la edición gana y el
   registro sobrevive — es lo que uno espera si borra algo en el celular y luego
   lo sigue editando en el portátil.

   No intenta fusionar campo a campo dentro de un mismo registro: para un panel
   de una sola persona, dos ediciones simultáneas del mismo item son raras y el
   coste de equivocarse es bajo, mientras que una fusión a nivel de campo sería
   mucho más código y mucho más difícil de razonar. */
function mergeCollections(localList, remoteList) {
  const byId = new Map();
  const consider = rec => {
    if (!rec || typeof rec.id !== 'string') return;
    const stamp = typeof rec.updatedAt === 'number' ? rec.updatedAt : 0;
    const existing = byId.get(rec.id);
    if (!existing || stamp > (existing.updatedAt || 0)) byId.set(rec.id, rec);
  };
  (localList || []).forEach(consider);
  (remoteList || []).forEach(consider);
  return [...byId.values()];
}

function mergeTombstones(localList, remoteList) {
  const byKey = new Map();
  [...(localList || []), ...(remoteList || [])].forEach(t => {
    if (!t || !t.id || !t.kind) return;
    const key = `${t.kind}:${t.id}`;
    const existing = byKey.get(key);
    if (!existing || (t.at || 0) > (existing.at || 0)) byKey.set(key, t);
  });
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  return [...byKey.values()].filter(t => (t.at || 0) >= cutoff);
}

function applyTombstones(collections, tombs) {
  tombs.forEach(t => {
    const list = collections[t.kind];
    if (!Array.isArray(list)) return;
    collections[t.kind] = list.filter(rec => {
      if (rec.id !== t.id) return true;
      return (rec.updatedAt || 0) > (t.at || 0); // editado después del borrado → sobrevive
    });
  });
}

/** Fusiona el snapshot remoto sobre el estado local en memoria y lo persiste.
 *  Recorre DATA_COLLECTIONS (js/05-dashboard.js) en vez de una lista propia: así
 *  una colección nueva se sincroniza sola, sin que haya que acordarse de este
 *  archivo. */
function mergeRemoteIntoLocal(remoteData) {
  const merged = {};
  DATA_COLLECTIONS.forEach(name => {
    merged[name] = mergeCollections(getCollection(name), remoteData[name]);
  });
  const mergedTombs = mergeTombstones(tombstones, remoteData.tombstones);
  applyTombstones(merged, mergedTombs);

  DATA_COLLECTIONS.forEach(name => setCollection(name, merged[name]));
  tombstones = mergedTombs;
}

function currentSnapshotData() {
  return { ...collectionsSnapshot(), tombstones };
}

/**
 * Ciclo completo: pull → fusionar → push. Reintenta si otro dispositivo escribió
 * entremedias (409), volviendo a fusionar sobre el estado que devuelve el server.
 */
async function syncNow({ interactive = false } = {}) {
  if (!isSyncConfigured()) {
    if (interactive) alert('Configura la URL del backend y el token en "Conectar cuentas" → Sincronización, y activa el sync.');
    return false;
  }
  if (syncState.status === 'syncing') return false;
  if (!navigator.onLine) {
    syncState.status = 'offline';
    syncState.error = 'Sin conexión';
    renderSyncStatus();
    return false;
  }

  const base = syncBaseUrl();
  syncState.status = 'syncing';
  syncState.error = null;
  renderSyncStatus();

  try {
    // 1) Traer el estado remoto.
    const pullRes = await fetch(`${base}/data/pull`, { headers: syncHeaders() });
    if (!pullRes.ok) throw new Error(await describeSyncError(pullRes));
    let remote = await pullRes.json();

    // 2) Fusionar y guardar en local. Se guarda antes de empujar para que, si el
    //    push falla, no se pierda lo que ya se trajo de la nube.
    mergeRemoteIntoLocal(remote.data || {});
    saveAllWithoutSync();

    // 3) Empujar el resultado, reintentando si alguien más escribió entremedias.
    let baseRev = remote.rev || 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const pushRes = await fetch(`${base}/data/push`, {
        method: 'POST',
        headers: syncHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ baseRev, data: currentSnapshotData() }),
      });

      if (pushRes.ok) {
        const result = await pushRes.json();
        syncState.rev = result.rev;
        syncState.lastSyncAt = new Date().toISOString();
        syncState.dirty = false;
        syncState.status = 'ok';
        persistSyncMeta();
        renderSyncStatus();
        if (typeof refreshActiveView === 'function') refreshActiveView();
        return true;
      }

      if (pushRes.status === 409) {
        // Otro dispositivo se adelantó: fusionar su versión y reintentar.
        const conflict = await pushRes.json();
        mergeRemoteIntoLocal(conflict.data || {});
        saveAllWithoutSync();
        baseRev = conflict.rev;
        continue;
      }

      throw new Error(await describeSyncError(pushRes));
    }
    throw new Error('El servidor sigue en conflicto tras 3 intentos. Prueba de nuevo en un momento.');
  } catch (err) {
    console.warn('[sync] falló:', err);
    syncState.status = 'error';
    syncState.error = err.message || String(err);
    syncState.dirty = true;
    persistSyncMeta();
    renderSyncStatus();
    if (interactive) alert('No se pudo sincronizar: ' + syncState.error);
    return false;
  }
}

/** Convierte una respuesta de error del backend en un mensaje legible. */
async function describeSyncError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || body.error || '';
  } catch { /* respuesta sin JSON */ }
  if (res.status === 401) return 'Token de sincronización inválido. Revísalo en "Conectar cuentas".';
  if (res.status === 503) return detail || 'El backend no tiene SYNC_TOKEN configurado.';
  return `El servidor respondió ${res.status}${detail ? ': ' + detail : ''}`;
}

/* Guardar sin volver a disparar el ciclo de sync — si no, fusionar provocaría
   otra sincronización, que fusionaría, que provocaría otra... */
let suppressSyncTrigger = false;
function saveAllWithoutSync() {
  suppressSyncTrigger = true;
  try { saveAll(); } finally { suppressSyncTrigger = false; }
}

/* ---- Disparadores automáticos ---- */
let syncDebounceTimer = null;
function scheduleSync() {
  if (suppressSyncTrigger || !isSyncConfigured()) return;
  clearTimeout(syncDebounceTimer);
  // 2.5 s: suficiente para agrupar una ráfaga de cambios (arrastrar varias
  // tarjetas del kanban seguidas) sin que se sienta que "no ha guardado".
  syncDebounceTimer = setTimeout(() => syncNow(), 2500);
}
dataChangeHandlers.push(scheduleSync);

// Al volver la conexión, si quedó algo sin empujar, se empuja.
window.addEventListener('online', () => { if (syncState.dirty) syncNow(); });
window.addEventListener('offline', () => { syncState.status = 'offline'; renderSyncStatus(); });

// Al volver a la pestaña puede haber cambios hechos en el celular.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isDashboardOpen()) syncNow();
});

// Mientras el panel esté abierto y visible, refresco periódico.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  if (isDashboardOpen() && document.visibilityState === 'visible') syncNow();
}, SYNC_INTERVAL_MS);

function isDashboardOpen() {
  const dash = document.getElementById('dashboard');
  const content = document.getElementById('dash-content');
  return !!(dash && !dash.classList.contains('hidden') && content && !content.classList.contains('hidden'));
}

/* ============================================================================
   B) AUTO-BACKUP A UN ARCHIVO LOCAL (File System Access API)

   `showSaveFilePicker()` devuelve un FileSystemFileHandle con permiso de
   escritura persistente. El handle no es serializable a JSON, pero sí es
   estructurado-clonable, así que se guarda en IndexedDB (no en localStorage)
   para sobrevivir recargas sin volver a preguntar.

   Soporte: Chrome y Edge de escritorio. Firefox y Safari no lo implementan; en
   esos navegadores la tarjeta se muestra como no disponible y el export manual
   sigue siendo el camino.
   ========================================================================== */

const FS_DB_NAME = 'jdh-fs';
const FS_STORE_NAME = 'handles';
const FS_HANDLE_KEY = 'backupFile';

function supportsFileBackup() { return typeof window.showSaveFilePicker === 'function'; }

function fsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FS_STORE_NAME)) req.result.createObjectStore(FS_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBackupHandle(handle) {
  const db = await fsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    tx.objectStore(FS_STORE_NAME).put(handle, FS_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadBackupHandle() {
  try {
    const db = await fsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FS_STORE_NAME, 'readonly');
      const req = tx.objectStore(FS_STORE_NAME).get(FS_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[auto-backup] no se pudo leer el handle guardado:', err);
    return null;
  }
}

async function clearBackupHandle() {
  const db = await fsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    tx.objectStore(FS_STORE_NAME).delete(FS_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const autoBackupState = {
  handle: null,
  name: store.get('autoBackupName', ''),
  // 'unsupported' | 'off' | 'ready' | 'needs-permission' | 'writing' | 'error'
  status: supportsFileBackup() ? 'off' : 'unsupported',
  lastWriteAt: store.get('autoBackupAt', null),
  error: null,
};

/** Pide al usuario elegir/crear el archivo de backup. Requiere gesto de usuario. */
async function chooseBackupFile() {
  if (!supportsFileBackup()) {
    alert('Este navegador no permite escribir archivos directamente. Funciona en Chrome y Edge de escritorio; en los demás usa "Descargar backup".');
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'jdh-panel-backup.json',
      types: [{ description: 'Backup del panel (JSON)', accept: { 'application/json': ['.json'] } }],
    });
    autoBackupState.handle = handle;
    autoBackupState.name = handle.name;
    autoBackupState.status = 'ready';
    autoBackupState.error = null;
    store.set('autoBackupName', handle.name);
    await saveBackupHandle(handle);
    await writeAutoBackup();          // escribe ya, para que el archivo no quede vacío
  } catch (err) {
    if (err.name === 'AbortError') return; // el usuario canceló el diálogo
    console.warn('[auto-backup] no se pudo elegir el archivo:', err);
    autoBackupState.status = 'error';
    autoBackupState.error = err.message;
    renderSyncStatus();
  }
}

async function disableAutoBackup() {
  autoBackupState.handle = null;
  autoBackupState.name = '';
  autoBackupState.status = supportsFileBackup() ? 'off' : 'unsupported';
  autoBackupState.lastWriteAt = null;
  store.set('autoBackupName', '');
  store.set('autoBackupAt', null);
  try { await clearBackupHandle(); } catch (err) { console.warn('[auto-backup] limpieza:', err); }
  renderSyncStatus();
}

async function writeAutoBackup() {
  const handle = autoBackupState.handle;
  if (!handle) return false;

  // El permiso de escritura puede haberse revocado entre sesiones. queryPermission
  // no requiere gesto de usuario; requestPermission sí, así que aquí sólo se
  // consulta y, si falta, se pide al usuario que lo reautorice con un clic.
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      autoBackupState.status = 'needs-permission';
      renderSyncStatus();
      return false;
    }
  } catch (err) {
    console.warn('[auto-backup] no se pudo consultar el permiso:', err);
    autoBackupState.status = 'needs-permission';
    renderSyncStatus();
    return false;
  }

  autoBackupState.status = 'writing';
  renderSyncStatus();
  try {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(buildBackupPayload(), null, 2));
    await writable.close();
    autoBackupState.status = 'ready';
    autoBackupState.error = null;
    autoBackupState.lastWriteAt = new Date().toISOString();
    store.set('autoBackupAt', autoBackupState.lastWriteAt);
    // Cuenta como backup real a efectos del aviso de "último backup".
    localStorage.setItem('jdh_lastBackup', autoBackupState.lastWriteAt);
    renderSyncStatus();
    return true;
  } catch (err) {
    console.warn('[auto-backup] escritura falló:', err);
    autoBackupState.status = 'error';
    autoBackupState.error = err.message;
    renderSyncStatus();
    return false;
  }
}

/** Reautoriza el permiso de escritura (necesita venir de un clic del usuario). */
async function reauthorizeAutoBackup() {
  if (!autoBackupState.handle) return;
  try {
    const perm = await autoBackupState.handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { autoBackupState.status = 'ready'; await writeAutoBackup(); }
    else renderSyncStatus();
  } catch (err) {
    console.warn('[auto-backup] reautorización falló:', err);
  }
}

let autoBackupTimer = null;
function scheduleAutoBackup() {
  if (!autoBackupState.handle) return;
  clearTimeout(autoBackupTimer);
  // 5 s, más holgado que el sync: escribir en disco es más costoso y este es un
  // respaldo, no la fuente de verdad.
  autoBackupTimer = setTimeout(() => writeAutoBackup(), 5000);
}
dataChangeHandlers.push(scheduleAutoBackup);

/** Recupera el handle guardado al arrancar (sin pedir permisos ni escribir). */
async function restoreAutoBackup() {
  if (!supportsFileBackup()) return;
  const handle = await loadBackupHandle();
  if (!handle) return;
  autoBackupState.handle = handle;
  autoBackupState.name = handle.name;
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    autoBackupState.status = perm === 'granted' ? 'ready' : 'needs-permission';
  } catch {
    autoBackupState.status = 'needs-permission';
  }
  renderSyncStatus();
}

/* ============================================================================
   UI de estado
   ========================================================================== */

function relativeTime(iso) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'hace unos segundos';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days > 1 ? 's' : ''}`;
}

const SYNC_PILL = {
  idle:    { text: 'Sync en pausa',  cls: 'text-neutral-500', dot: 'bg-neutral-400' },
  syncing: { text: 'Sincronizando…', cls: 'text-accent',      dot: 'bg-accent animate-pulse' },
  ok:      { text: 'Sincronizado',   cls: 'text-accent',      dot: 'bg-accent' },
  error:   { text: 'Error de sync',  cls: 'text-red-500',     dot: 'bg-red-500' },
  offline: { text: 'Sin conexión',   cls: 'text-amber-500',   dot: 'bg-amber-500' },
};

function renderSyncStatus() {
  // Pastilla compacta en la cabecera del panel
  const pill = document.getElementById('sync-pill');
  if (pill) {
    if (!isSyncConfigured()) {
      pill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-neutral-400"></span><span class="meta-label text-neutral-500">Sólo local</span>`;
    } else {
      const s = SYNC_PILL[syncState.status] || SYNC_PILL.idle;
      pill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${s.dot}"></span><span class="meta-label ${s.cls}">${s.text}</span>`;
    }
  }

  // Tarjeta detallada en la vista "Datos & Backup"
  const cloudEl = document.getElementById('sync-cloud-detail');
  if (cloudEl) {
    if (!syncBaseUrl() || !syncToken()) {
      cloudEl.innerHTML = `
        <p class="text-neutral-500 text-sm mb-3">Sin configurar. Tus datos viven sólo en este navegador — si limpias la caché, se van.</p>
        <button type="button" data-open-integrations="sync" class="w-full py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Configurar sync</button>`;
    } else if (!integrations.sync.enabled) {
      cloudEl.innerHTML = `
        <p class="text-neutral-500 text-sm mb-3">Configurado pero desactivado.</p>
        <button type="button" id="sync-enable-btn" class="w-full py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Activar sync</button>`;
    } else {
      const s = SYNC_PILL[syncState.status] || SYNC_PILL.idle;
      cloudEl.innerHTML = `
        <div class="flex items-center gap-2 mb-2">
          <span class="w-1.5 h-1.5 rounded-full ${s.dot}"></span>
          <span class="meta-label ${s.cls}">${s.text}</span>
        </div>
        <p class="text-neutral-500 text-sm">Revisión <span class="mono text-accent">#${syncState.rev}</span> · última vez ${relativeTime(syncState.lastSyncAt)}</p>
        ${syncState.error ? `<p class="text-red-500 text-xs mt-2">${escapeHtml(syncState.error)}</p>` : ''}
        ${syncState.dirty ? `<p class="text-amber-500 text-xs mt-2">Hay cambios locales sin subir.</p>` : ''}
        <div class="flex gap-2 mt-3">
          <button type="button" id="sync-now-data-btn" class="flex-1 py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Sincronizar ahora</button>
          <button type="button" id="sync-disable-btn" class="px-4 py-2.5 rounded-xl surface-soft hover:border-red-400 hover:text-red-500 mono text-[10px] uppercase tracking-[0.2em]">Pausar</button>
        </div>`;
    }
  }

  const fileEl = document.getElementById('sync-file-detail');
  if (fileEl) {
    const st = autoBackupState.status;
    if (st === 'unsupported') {
      fileEl.innerHTML = `<p class="text-neutral-500 text-sm">Este navegador no permite escribir archivos directamente. Funciona en Chrome y Edge de escritorio; aquí usa "Descargar backup".</p>`;
    } else if (st === 'off') {
      fileEl.innerHTML = `
        <p class="text-neutral-500 text-sm mb-3">Elige un archivo .json (por ejemplo dentro de tu carpeta de OneDrive) y el panel lo reescribirá solo en cada cambio.</p>
        <button type="button" id="autobackup-choose-btn" class="w-full py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Elegir archivo</button>`;
    } else if (st === 'needs-permission') {
      fileEl.innerHTML = `
        <p class="text-amber-500 text-sm mb-1">Permiso de escritura caducado</p>
        <p class="text-neutral-500 text-xs mb-3">El navegador revoca el acceso al cerrarlo. Un clic lo restaura para <span class="mono">${escapeHtml(autoBackupState.name)}</span>.</p>
        <button type="button" id="autobackup-reauth-btn" class="w-full py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Reautorizar</button>`;
    } else if (st === 'error') {
      fileEl.innerHTML = `
        <p class="text-red-500 text-sm mb-1">No se pudo escribir</p>
        <p class="text-neutral-500 text-xs mb-3">${escapeHtml(autoBackupState.error || '')}</p>
        <button type="button" id="autobackup-choose-btn" class="w-full py-2.5 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.2em]">Elegir otro archivo</button>`;
    } else {
      fileEl.innerHTML = `
        <div class="flex items-center gap-2 mb-2">
          <span class="w-1.5 h-1.5 rounded-full ${st === 'writing' ? 'bg-accent animate-pulse' : 'bg-accent'}"></span>
          <span class="meta-label text-accent">${st === 'writing' ? 'Escribiendo…' : 'Activo'}</span>
        </div>
        <p class="text-neutral-500 text-sm truncate" title="${escapeHtml(autoBackupState.name)}"><span class="mono">${escapeHtml(autoBackupState.name)}</span></p>
        <p class="text-neutral-500 text-xs mt-1">Última escritura ${relativeTime(autoBackupState.lastWriteAt)}</p>
        <div class="flex gap-2 mt-3">
          <button type="button" id="autobackup-write-btn" class="flex-1 py-2.5 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.2em]">Guardar ya</button>
          <button type="button" id="autobackup-off-btn" class="px-4 py-2.5 rounded-xl surface-soft hover:border-red-400 hover:text-red-500 mono text-[10px] uppercase tracking-[0.2em]">Desactivar</button>
        </div>`;
    }
  }
}

/* Los botones de las tarjetas se regeneran con innerHTML en cada render, así que
   se escuchan por delegación en document en vez de enlazarlos uno a uno. */
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  switch (t.id) {
    case 'sync-now-data-btn': syncNow({ interactive: true }); break;
    case 'sync-enable-btn':
      integrations.sync.enabled = true; saveIntegrations(); renderSyncStatus(); syncNow({ interactive: true });
      break;
    case 'sync-disable-btn':
      integrations.sync.enabled = false; saveIntegrations(); syncState.status = 'idle'; renderSyncStatus();
      break;
    case 'autobackup-choose-btn': chooseBackupFile(); break;
    case 'autobackup-reauth-btn': reauthorizeAutoBackup(); break;
    case 'autobackup-write-btn': writeAutoBackup(); break;
    case 'autobackup-off-btn':
      if (confirm('¿Desactivar el auto-backup? El archivo que ya guardaste no se borra.')) disableAutoBackup();
      break;
  }
});

restoreAutoBackup();
