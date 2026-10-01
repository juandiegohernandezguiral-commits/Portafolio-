/* 05-dashboard.js - panel privado: PIN, navegacion de vistas, CRUD de tareas,
   eventos, proyectos y notas, y export/import/wipe de datos.
   Define store, uid y escapeHtml, usados por los scripts posteriores. */

/* ============ DASHBOARD PIN ============ */
const dashboard = document.getElementById('dashboard');
const pinScreen = document.getElementById('pin-screen');
const dashContent = document.getElementById('dash-content');
const pinDots = document.querySelectorAll('.pin-dot');
let pinInput = '';

function openDashboard() {
  console.log('Opening dashboard');
  dashboard.classList.remove('hidden');
  pinScreen.classList.remove('hidden');
  dashContent.classList.add('hidden');
  pinInput = '';
  updateDots();
  if (lenis) lenis.stop();
  document.body.style.overflow = 'hidden';
}
function closeDashboard() {
  dashboard.classList.add('hidden');
  pinInput = '';
  if (lenis) lenis.start();
  document.body.style.overflow = '';
}
function updateDots() {
  pinDots.forEach((d, i) => { d.classList.toggle('filled', i < pinInput.length); d.classList.remove('error'); });
}
function checkPin() {
  if (pinInput === ACCESS_PIN) {
    pinScreen.classList.add('hidden');
    dashContent.classList.remove('hidden');
    dashContent.classList.add('flex');
    initDashboard();
  } else {
    pinDots.forEach(d => d.classList.add('error'));
    setTimeout(() => { pinInput = ''; updateDots(); }, 600);
  }
}

document.getElementById('open-dash').addEventListener('click', e => { e.preventDefault(); openDashboard(); });
document.getElementById('close-pin').addEventListener('click', e => { e.preventDefault(); closeDashboard(); });
document.getElementById('dash-logout').addEventListener('click', e => { e.preventDefault(); closeDashboard(); });

document.querySelectorAll('#keypad .key').forEach(k => {
  k.className = 'key surface rounded-xl py-4 font-display font-bold text-xl hover:bg-accent/10 hover:border-accent transition';
  k.addEventListener('click', () => {
    if (k.dataset.action === 'del') pinInput = pinInput.slice(0, -1);
    else if (pinInput.length < 4) pinInput += k.textContent.trim();
    updateDots();
    if (pinInput.length === 4) setTimeout(checkPin, 200);
  });
});

document.addEventListener('keydown', e => {
  // Alt+P abre el panel (no entra en conflicto con shortcuts del navegador)
  if (e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    openDashboard();
    return;
  }
  if (e.key === 'Escape' && !dashboard.classList.contains('hidden')) {
    closeDashboard();
    return;
  }
  if (!pinScreen.classList.contains('hidden') && !dashboard.classList.contains('hidden')) {
    if (/^[0-9]$/.test(e.key) && pinInput.length < 4) { pinInput += e.key; updateDots(); if (pinInput.length === 4) setTimeout(checkPin, 200); }
    else if (e.key === 'Backspace') { pinInput = pinInput.slice(0, -1); updateDots(); }
  }
});

/* ============ DASHBOARD DATA ============ */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('jdh_'+k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('jdh_'+k, JSON.stringify(v)); },
};
let tasks = store.get('tasks', []); let events = store.get('events', []);
let projects = store.get('projects', []); let notes = store.get('notes', []);
let habits = store.get('habits', []); let habitLog = store.get('habitLog', []);
let sessions = store.get('sessions', []);
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

/* ---- Registro de colecciones ----
   Antes, la lista de colecciones estaba repetida literalmente en saveAll(), en
   el payload de backup, en la fusión del sync, en el import y en la validación
   del backend. Añadir una coleccion nueva significaba acordarse de los cinco
   sitios, y olvidarse de uno se manifiesta como datos que no se sincronizan o
   no se respaldan — en silencio.

   Ahora la lista vive aquí y todo lo demás la recorre. Los accesores existen
   porque las colecciones son variables `let` sueltas (reasignadas al fusionar o
   importar), y no se pueden meter en un objeto sin reescribir los cientos de
   `tasks.push(...)` repartidos por el proyecto. Un switch explícito es más
   aburrido que elegante, pero no tiene magia que pueda fallar. */
const DATA_COLLECTIONS = ['tasks', 'events', 'projects', 'notes', 'habits', 'habitLog', 'sessions'];

function getCollection(name) {
  switch (name) {
    case 'tasks': return tasks;
    case 'events': return events;
    case 'projects': return projects;
    case 'notes': return notes;
    case 'habits': return habits;
    case 'habitLog': return habitLog;
    case 'sessions': return sessions;
    default: return null;
  }
}

function setCollection(name, value) {
  const list = Array.isArray(value) ? value : [];
  switch (name) {
    case 'tasks': tasks = list; break;
    case 'events': events = list; break;
    case 'projects': projects = list; break;
    case 'notes': notes = list; break;
    case 'habits': habits = list; break;
    case 'habitLog': habitLog = list; break;
    case 'sessions': sessions = list; break;
  }
}

function collectionsSnapshot() {
  const out = {};
  DATA_COLLECTIONS.forEach(name => { out[name] = getCollection(name); });
  return out;
}

/* ---- Metadatos para sincronización (ver js/07-sync.js) ----
   Sincronizar entre dos dispositivos necesita dos cosas que el modelo original no tenía:

   1. `updatedAt` en cada registro — para resolver conflictos por "el último que escribió gana"
      a nivel de registro individual, en vez de que un dispositivo pise el estado completo del
      otro.
   2. Tombstones (lápidas) — un borrado es la ausencia de un registro, y la ausencia no se puede
      distinguir de "este dispositivo todavía no lo conoce". Sin dejar rastro del borrado, cada
      sincronización resucitaría lo que borraste en el otro dispositivo. Un tombstone es el
      registro explícito de "esto se borró en tal momento".

   `touch()` sella un registro al crearlo o modificarlo; `tombstone()` anota un borrado. */
const TOMBSTONE_TTL_DAYS = 60;
let tombstones = store.get('tombstones', []);

function touch(rec) { rec.updatedAt = Date.now(); return rec; }
function tombstone(kind, id) {
  tombstones = tombstones.filter(t => !(t.kind === kind && t.id === id));
  tombstones.push({ kind, id, at: Date.now() });
}
function pruneTombstones() {
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  tombstones = tombstones.filter(t => t.at >= cutoff);
}

/* Registros creados antes de que existiera `updatedAt` (todo lo anterior a esta versión) no
   tienen con qué compararse en un merge. Se les sella una sola vez, prefiriendo `createdAt`
   cuando existe para no inventar que son más recientes de lo que son. */
function migrateTimestamps() {
  let changed = false;
  DATA_COLLECTIONS.forEach(name => {
    (getCollection(name) || []).forEach(rec => {
      if (typeof rec.updatedAt !== 'number') { rec.updatedAt = rec.createdAt || Date.now(); changed = true; }
    });
  });
  if (changed) saveAll();
}

function saveAll() {
  pruneTombstones();
  DATA_COLLECTIONS.forEach(name => store.set(name, getCollection(name)));
  store.set('tombstones', tombstones);
  // Avisa a los módulos posteriores (sync en la nube, auto-backup a archivo, paleta de
  // comandos) que los datos cambiaron. Se consultan con `typeof` porque 05-dashboard.js
  // carga antes que ellos y debe seguir funcionando si alguno no está presente.
  if (typeof onDataChanged === 'function') onDataChanged();
}

let activeView = 'overview';

function showView(name) {
  activeView = name;
  document.querySelectorAll('.dash-view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== name));
  document.querySelectorAll('.dash-nav').forEach(n => {
    const active = n.dataset.view === name;
    n.classList.toggle('bg-accent/10', active);
    n.classList.toggle('text-accent', active);
  });
  if (name === 'overview') renderOverview();
  if (name === 'today' && typeof renderToday === 'function') renderToday();
  if (name === 'agenda') { renderEvents(); showAgendaTab(localStorage.getItem('jdh_agendaTab') || 'calendar'); }
  if (name === 'tasks') renderTasks();
  if (name === 'habits' && typeof renderHabits === 'function') renderHabits();
  if (name === 'projects') renderProjects();
  if (name === 'notes') renderNotes();
  if (name === 'data') renderDataView();
  if (name === 'insights' && typeof renderInsights === 'function') renderInsights();
  // El widget de enfoque se oculta fuera del panel, así que hay que repintarlo
  // cada vez que cambia la vista.
  if (typeof renderFocusWidget === 'function') renderFocusWidget();
}

/* Vuelve a pintar la vista actual sin cambiar de vista. La usa el sync tras
   fusionar datos remotos, para que lo que se ve en pantalla no quede desfasado
   respecto a lo que acaba de llegar del otro dispositivo.

   A diferencia de showView(), no toca el Centro de tareas: ese hace peticiones
   reales a Trello/Graph/Notion y no hay razón para repetirlas sólo porque
   cambiaron datos locales. */
function refreshActiveView() {
  switch (activeView) {
    case 'overview': renderOverview(); break;
    case 'today': if (typeof renderToday === 'function') renderToday(); break;
    case 'agenda': renderEvents(); break;
    case 'tasks': renderTasks(); break;
    case 'habits': if (typeof renderHabits === 'function') renderHabits(); break;
    case 'projects': renderProjects(); break;
    case 'notes': renderNotes(); break;
    case 'data': renderDataView(); break;
    case 'insights': if (typeof renderInsights === 'function') renderInsights(); break;
  }
}

/* ============ DATA BACKUP / EXPORT / IMPORT / WIPE ============ */
function renderDataView() {
  const blob = JSON.stringify(collectionsSnapshot());
  const bytes = new Blob([blob]).size;
  const sizeKB = (bytes / 1024).toFixed(2);
  const sizeEl = document.getElementById('storage-size');
  if (sizeEl) sizeEl.textContent = sizeKB + ' KB';

  const lastBackup = localStorage.getItem('jdh_lastBackup');
  const lastEl = document.getElementById('last-backup');
  const statusEl = document.getElementById('backup-status');
  if (lastEl) {
    if (lastBackup) {
      const d = new Date(lastBackup);
      lastEl.textContent = d.toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
      const daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (statusEl) {
        if (daysAgo === 0) { statusEl.textContent = 'Hace unas horas ✓'; statusEl.className = 'text-xs mt-1 text-green-600 dark:text-green-400'; }
        else if (daysAgo < 7) { statusEl.textContent = `Hace ${daysAgo} día${daysAgo>1?'s':''} ✓`; statusEl.className = 'text-xs mt-1 text-green-600 dark:text-green-400'; }
        else if (daysAgo < 30) { statusEl.textContent = `Hace ${daysAgo} días — exporta pronto`; statusEl.className = 'text-xs mt-1 text-yellow-600 dark:text-yellow-400'; }
        else { statusEl.textContent = `Hace ${daysAgo} días — ¡expórtalo ya!`; statusEl.className = 'text-xs mt-1 text-red-500'; }
      }
    } else {
      lastEl.textContent = 'Nunca';
      if (statusEl) { statusEl.textContent = 'Recuerda exportar'; statusEl.className = 'text-xs mt-1 text-yellow-600 dark:text-yellow-400'; }
    }
  }

  const totalEl = document.getElementById('total-items');
  if (totalEl) {
    const total = DATA_COLLECTIONS.reduce((n, name) => n + (getCollection(name) || []).length, 0);
    totalEl.textContent = total + ' items';
  }

  if (typeof renderSyncStatus === 'function') renderSyncStatus();
}

/* Payload canónico de backup. Lo comparten la descarga manual, el auto-backup a archivo
   (js/07-sync.js) y el push al backend, para que los tres formatos no divergan.
   version 2 = incluye `updatedAt` por registro y tombstones; version 1 = formato anterior. */
function buildBackupPayload() {
  const counts = {};
  DATA_COLLECTIONS.forEach(name => { counts[name] = (getCollection(name) || []).length; });
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    owner: 'Juan Diego Hernández',
    counts,
    data: { ...collectionsSnapshot(), tombstones },
  };
}

document.getElementById('export-btn')?.addEventListener('click', () => {
  const payload = buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0,10);
  a.download = `jdh-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  localStorage.setItem('jdh_lastBackup', new Date().toISOString());
  renderDataView();
});

document.getElementById('import-btn')?.addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      // Soporta tanto el formato nuevo (envuelto en {data:...}) como uno plano
      const d = parsed.data || parsed;
      if (!d || (typeof d !== 'object')) throw new Error('Formato no válido');
      if (!confirm('Esto sobrescribirá tus datos actuales. ¿Continuar?')) return;
      // Las colecciones ausentes quedan vacías, que es lo correcto al restaurar
      // un backup de una versión anterior (formato 1 no traía tombstones;
      // formato 2 no traía hábitos ni sesiones).
      DATA_COLLECTIONS.forEach(name => setCollection(name, d[name]));
      tombstones = Array.isArray(d.tombstones) ? d.tombstones : [];
      migrateTimestamps();
      saveAll();
      const total = DATA_COLLECTIONS.reduce((n, name) => n + getCollection(name).length, 0);
      alert('✓ Datos restaurados: ' + total + ' items.');
      showView('overview');
    } catch (err) {
      alert('Archivo no válido: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('wipe-btn')?.addEventListener('click', () => {
  if (!confirm('⚠ Esto borrará TODOS tus datos del navegador. ¿Estás seguro?')) return;
  if (!confirm('Última confirmación: este paso es irreversible (a menos que tengas un backup). ¿Continuar?')) return;

  /* Con sync en la nube activo hay que decidir algo que antes no existía: ¿el borrado es sólo
     de este navegador, o también de la copia remota? Propagarlo silenciosamente sería un
     footgun — alguien que quiere "empezar limpio en este equipo" perdería también el respaldo
     que tiene en la nube. Así que se pregunta explícitamente, y sólo se generan tombstones
     (que es lo que hace viajar un borrado) si lo confirma. */
  let propagate = false;
  if (typeof isSyncConfigured === 'function' && isSyncConfigured()) {
    propagate = confirm(
      'Tienes sync en la nube activo.\n\n' +
      'OK = borrar también la copia en la nube (y por lo tanto en tus otros dispositivos).\n' +
      'Cancelar = borrar sólo en este navegador; la próxima sincronización lo restaurará desde la nube.'
    );
  }
  if (propagate) {
    DATA_COLLECTIONS.forEach(name => getCollection(name).forEach(rec => tombstone(name, rec.id)));
  }
  DATA_COLLECTIONS.forEach(name => setCollection(name, []));
  saveAll();
  localStorage.removeItem('jdh_seeded');
  alert(propagate ? 'Datos borrados aquí y en la nube.' : 'Datos borrados de este navegador.');
  showView('overview');
});
document.querySelectorAll('.dash-nav').forEach(n => n.addEventListener('click', () => showView(n.dataset.view)));
/* Delegado en document, no enlazado elemento a elemento: algunos botones
   [data-jump] se generan con innerHTML después de este punto (p. ej. el aviso de
   fuentes sin cargar de la vista Hoy), y un querySelectorAll de una sola pasada
   no los alcanzaría. */
document.addEventListener('click', e => {
  const jump = e.target.closest('[data-jump]');
  if (jump) showView(jump.dataset.jump);
});
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderOverview() {
  document.getElementById('stat-tasks').textContent = tasks.filter(t => t.status === 'todo').length;
  document.getElementById('stat-progress').textContent = tasks.filter(t => t.status === 'doing').length;
  document.getElementById('stat-projects').textContent = projects.length;
  document.getElementById('stat-notes').textContent = notes.length;
  const now = new Date();
  document.getElementById('today-date').textContent = now.toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const upcoming = events.filter(e => new Date(e.date) > now).sort((a,b) => new Date(a.date) - new Date(b.date)).slice(0, 4);
  document.getElementById('overview-events').innerHTML = upcoming.length ? upcoming.map(e => `
    <div class="flex items-center gap-3 p-3 rounded-xl surface-soft">
      <div class="w-10 h-10 rounded-lg bg-accent/10 border border-accent/30 flex flex-col items-center justify-center mono text-[10px] text-accent">
        <span class="font-bold">${new Date(e.date).getDate()}</span>
        <span>${new Date(e.date).toLocaleDateString('es-CO',{month:'short'}).toUpperCase()}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-sm truncate">${escapeHtml(e.title)}</div>
        <div class="text-neutral-500 text-xs">${new Date(e.date).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>`).join('') : '<div class="text-neutral-500 text-sm">Sin eventos próximos.</div>';
  const urgent = tasks.filter(t => t.status !== 'done' && (t.priority === 'high' || t.status === 'doing')).slice(0, 4);
  document.getElementById('overview-tasks').innerHTML = urgent.length ? urgent.map(t => `
    <div class="flex items-center gap-3 p-3 rounded-xl surface-soft">
      <span class="w-2 h-2 rounded-full ${t.priority === 'high' ? 'bg-red-500' : 'bg-accent'}"></span>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-sm truncate">${escapeHtml(t.title)}</div>
        <div class="text-neutral-500 text-xs mono uppercase">${t.status === 'doing' ? 'en progreso' : 'pendiente'}</div>
      </div>
    </div>`).join('') : '<div class="text-neutral-500 text-sm">Nada urgente.</div>';
}

document.getElementById('event-form').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  events.push(touch({ id: uid(), title: fd.get('title'), date: fd.get('date'), createdAt: Date.now() }));
  saveAll(); e.target.reset(); renderEvents();
});
function renderEvents() {
  const sorted = [...events].sort((a,b) => new Date(a.date) - new Date(b.date));
  document.getElementById('events-list').innerHTML = sorted.length ? sorted.map(e => `
    <div class="flex items-center gap-4 p-4 rounded-xl surface-soft">
      <div class="w-12 h-12 rounded-xl bg-accent/10 border border-accent/30 flex flex-col items-center justify-center mono text-xs text-accent">
        <span class="font-bold">${new Date(e.date).getDate()}</span>
        <span class="text-[9px]">${new Date(e.date).toLocaleDateString('es-CO',{month:'short'}).toUpperCase()}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold">${escapeHtml(e.title)}</div>
        <div class="text-neutral-500 text-xs">${new Date(e.date).toLocaleString('es-CO', { dateStyle:'medium', timeStyle:'short' })}</div>
      </div>
      <button data-del-event="${e.id}" type="button" class="text-neutral-400 hover:text-red-500 text-sm">✕</button>
    </div>`).join('') : '<div class="text-neutral-500">No hay eventos.</div>';
  document.querySelectorAll('[data-del-event]').forEach(b => b.addEventListener('click', () => {
    tombstone('events', b.dataset.delEvent);
    events = events.filter(e => e.id !== b.dataset.delEvent); saveAll(); renderEvents();
  }));
}

const taskModal = document.getElementById('task-modal');
document.getElementById('add-task-btn').addEventListener('click', () => { taskModal.classList.remove('hidden'); taskModal.classList.add('flex'); });
document.getElementById('task-form').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  tasks.push(touch({ id: uid(), title: fd.get('title'), desc: fd.get('desc'), priority: fd.get('priority'), status: fd.get('status'), repeat: fd.get('repeat') || 'none', due: fd.get('due') || '', createdAt: Date.now() }));
  saveAll(); e.target.reset();
  taskModal.classList.add('hidden'); taskModal.classList.remove('flex');
  renderTasks();
});
/* Chips de vencimiento y recurrencia de una tarjeta del kanban. Las utilidades de
   fecha viven en js/08-productivity.js, que carga después de este archivo; se
   consultan con typeof porque estas funciones sólo corren tras un clic del
   usuario, cuando todos los scripts ya están cargados, pero así el kanban sigue
   pintándose aunque ese módulo falte. */
function taskDueChip(t) {
  if (!t.due || typeof parseDue !== 'function') return '';
  const due = parseDue(t.due);
  if (!due) return '';
  const late = t.status !== 'done' && isOverdue(due);
  const label = t.status === 'done'
    ? due.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
    : humanizeDue(due);
  return `<span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
    late ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-neutral-100 dark:bg-white/10 text-neutral-500'
  }">${escapeHtml(label)}</span>`;
}

function taskRepeatChip(t) {
  if (!t.repeat || t.repeat === 'none' || typeof REPEAT_LABELS === 'undefined') return '';
  const label = REPEAT_LABELS[t.repeat];
  if (!label) return '';
  return `<span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-500">↻ ${label}</span>`;
}

function renderTasks() {
  ['todo','doing','done'].forEach(status => {
    const list = document.querySelector(`.kanban-list[data-status="${status}"]`);
    const filtered = tasks.filter(t => t.status === status);
    document.querySelector(`[data-count="${status}"]`).textContent = filtered.length;
    list.innerHTML = filtered.map(t => `
      <div draggable="true" data-task-id="${t.id}" class="kanban-card p-3 rounded-xl surface-soft hover:border-accent transition">
        <div class="flex items-start justify-between gap-2 mb-1">
          <div class="font-semibold text-sm">${escapeHtml(t.title)}</div>
          <button data-del-task="${t.id}" type="button" class="text-neutral-400 hover:text-red-500 text-xs shrink-0">✕</button>
        </div>
        ${t.desc ? `<div class="text-neutral-500 text-xs leading-relaxed">${escapeHtml(t.desc)}</div>` : ''}
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
            t.priority === 'high' ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400' :
            t.priority === 'med' ? 'bg-accent/15 text-accent' : 'bg-neutral-100 dark:bg-white/10 text-neutral-500'
          }">${t.priority === 'high' ? 'Alta' : t.priority === 'med' ? 'Media' : 'Baja'}</span>
          ${taskDueChip(t)}
          ${taskRepeatChip(t)}
        </div>
      </div>`).join('');
  });
  document.querySelectorAll('[data-del-task]').forEach(b => b.addEventListener('click', () => {
    tombstone('tasks', b.dataset.delTask);
    tasks = tasks.filter(t => t.id !== b.dataset.delTask); saveAll(); renderTasks();
  }));
  document.querySelectorAll('.kanban-card').forEach(c => {
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.taskId); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
  });
  document.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const t = tasks.find(t => t.id === id);
      if (t && t.status !== col.dataset.status) {
        t.status = col.dataset.status;
        touch(t);
        // Al completar una tarea recurrente se genera automáticamente su próxima
        // ocurrencia (ver spawnNextOccurrence en js/08-productivity.js).
        if (t.status === 'done' && typeof spawnNextOccurrence === 'function') spawnNextOccurrence(t);
        saveAll(); renderTasks();
      }
    });
  });
}

const projModal = document.getElementById('project-modal');
document.getElementById('add-project-btn').addEventListener('click', () => { projModal.classList.remove('hidden'); projModal.classList.add('flex'); });
const STAGES = ['Planificación', 'Diseño', 'Desarrollo', 'Pruebas', 'Entrega'];
document.getElementById('project-form').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  projects.push(touch({ id: uid(), name: fd.get('name'), client: fd.get('client') || '', desc: fd.get('desc') || '', deadline: fd.get('deadline') || '', stages: STAGES.map(s => ({ name: s, done: false })), createdAt: Date.now() }));
  saveAll(); e.target.reset();
  projModal.classList.add('hidden'); projModal.classList.remove('flex');
  renderProjects();
});
function renderProjects() {
  const box = document.getElementById('projects-list');
  box.innerHTML = projects.length ? projects.map(p => {
    const completed = p.stages.filter(s => s.done).length;
    const progress = Math.round((completed / p.stages.length) * 100);
    return `
      <div class="surface rounded-2xl p-6">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 class="font-display font-bold text-xl">${escapeHtml(p.name)}</h3>
            ${p.client ? `<div class="text-neutral-500 text-sm mono">para ${escapeHtml(p.client)}</div>` : ''}
            ${p.desc ? `<p class="text-neutral-600 dark:text-neutral-400 text-sm mt-2 max-w-2xl">${escapeHtml(p.desc)}</p>` : ''}
            ${p.deadline ? `<div class="text-accent text-xs mono mt-2">▸ Entrega: ${new Date(p.deadline).toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})}</div>` : ''}
          </div>
          <button type="button" data-del-project="${p.id}" class="text-neutral-400 hover:text-red-500">✕</button>
        </div>
        <div class="mb-3">
          <div class="flex items-center justify-between mb-2"><span class="meta-label text-neutral-500">Progreso</span><span class="mono text-xs text-accent">${progress}%</span></div>
          <div class="h-1.5 rounded-full bg-neutral-200 dark:bg-white/5 overflow-hidden"><div class="h-full bg-accent transition-all" style="width:${progress}%"></div></div>
        </div>
        <div class="grid grid-cols-5 gap-2 mt-4">
          ${p.stages.map((s, i) => `
            <button type="button" data-toggle-stage="${p.id}:${i}" class="p-3 rounded-xl border ${s.done ? 'bg-accent/10 border-accent/50' : 'surface-soft hover:border-neutral-400'} transition text-left">
              <div class="mono text-[10px] text-neutral-500 mb-1">/0${i+1}</div>
              <div class="font-semibold text-xs ${s.done ? 'text-accent' : ''}">${s.name}</div>
              <div class="mt-2 text-[10px] ${s.done ? 'text-accent' : 'text-neutral-500'}">${s.done ? '✓ Hecho' : 'Pendiente'}</div>
            </button>`).join('')}
        </div>
      </div>`;
  }).join('') : '<div class="surface rounded-2xl p-12 text-center text-neutral-500">Sin proyectos aún.</div>';
  box.querySelectorAll('[data-del-project]').forEach(b => b.addEventListener('click', () => {
    tombstone('projects', b.dataset.delProject);
    projects = projects.filter(p => p.id !== b.dataset.delProject); saveAll(); renderProjects();
  }));
  box.querySelectorAll('[data-toggle-stage]').forEach(b => b.addEventListener('click', () => {
    const [pid, idx] = b.dataset.toggleStage.split(':');
    const p = projects.find(p => p.id === pid);
    if (p) { p.stages[+idx].done = !p.stages[+idx].done; touch(p); saveAll(); renderProjects(); }
  }));
}

/* Las notas ya no se gestionan aquí: tienen su propio sistema con markdown,
   enlaces [[...]], retroenlaces y autoguardado en js/11-notes.js, que define su
   propio renderNotes(). Este archivo sólo las declara (`let notes`) y las
   persiste en saveAll(). */

document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => {
  ['task-modal','project-modal','integrations-modal','habit-modal','focus-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  });
}));
