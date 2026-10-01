/* 09-palette.js — paleta de comandos (Ctrl+K) y búsqueda global.

   El panel tenía seis vistas y ninguna forma de buscar: para encontrar una nota
   había que abrir Notas y leer. Esto resuelve las dos cosas con una sola
   interfaz: escribes, y la lista mezcla comandos ("ir a Proyectos", "sincronizar
   ahora") con resultados reales de tus tareas, eventos, proyectos y notas.

   Prefijos:
     +  texto   → crea una tarea directamente (misma sintaxis que la captura
                  rápida: !alta, hoy, mañana)
     ?  texto   → fuerza sólo búsqueda, sin comandos */

const paletteEl = () => document.getElementById('palette');
const paletteInput = () => document.getElementById('palette-input');
const paletteResults = () => document.getElementById('palette-results');

let paletteOpen = false;
let paletteIndex = 0;
let paletteItems = [];

/* ============ NOTIFICACIONES EFÍMERAS ============ */

function toast(message, { type = 'info' } = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  const tone = type === 'error' ? 'border-red-500/50 text-red-400' : 'border-accent/50 text-white';
  el.className = `toast ${tone}`;
  el.textContent = message;
  host.appendChild(el);
  // Doble requestAnimationFrame: el primero deja que el nodo se pinte en su
  // estado inicial, el segundo aplica la clase que dispara la transición de
  // entrada. Sin esto el navegador colapsa ambos estados y no hay animación.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
  setTimeout(() => {
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 3200);
}

/* ============ PUNTUACIÓN DE COINCIDENCIAS ============
   No es fuzzy matching completo (no hace falta para unos cientos de items): se
   premia el prefijo por encima de la subcadena, y la subcadena por encima de la
   subsecuencia de caracteres. Suficiente para que escribir "prt" encuentre
   "Portafolio" pero "Portafolio" siempre gane a un match casual. */
function scoreMatch(haystack, needle) {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 1000;
  if (h.startsWith(n)) return 500 - h.length;
  const idx = h.indexOf(n);
  if (idx !== -1) return 300 - idx - h.length * 0.01;
  // subsecuencia: todos los caracteres en orden, no necesariamente contiguos
  let hi = 0;
  for (const ch of n) {
    hi = h.indexOf(ch, hi);
    if (hi === -1) return 0;
    hi++;
  }
  return 50 - h.length * 0.01;
}

/* ============ COMANDOS ============ */

function paletteCommands() {
  const cmds = [
    { label: 'Ir a Hoy',        hint: 'vista',   icon: '◎', run: () => showView('today') },
    { label: 'Ir a Resumen',    hint: 'vista',   icon: '◱', run: () => showView('overview') },
    { label: 'Ir a Agenda',     hint: 'vista',   icon: '▤', run: () => showView('agenda') },
    { label: 'Ir a Tareas',     hint: 'vista',   icon: '✓', run: () => showView('tasks') },
    { label: 'Ir a Hábitos',    hint: 'vista',   icon: '◈', run: () => showView('habits') },
    { label: 'Ir a Proyectos',  hint: 'vista',   icon: '▧', run: () => showView('projects') },
    { label: 'Ir a Notas',      hint: 'vista',   icon: '✎', run: () => showView('notes') },
    { label: 'Ir a Automatización', hint: 'vista', icon: '⚡', run: () => showView('auto') },
    { label: 'Ir a Métricas',   hint: 'vista',   icon: '▥', run: () => showView('insights') },
    { label: 'Ir a Datos & Backup', hint: 'vista', icon: '▦', run: () => showView('data') },

    { label: 'Nueva tarea',    hint: 'crear', icon: '+', run: () => openModal('task-modal') },
    { label: 'Nuevo proyecto', hint: 'crear', icon: '+', run: () => openModal('project-modal') },
    { label: 'Nueva nota',     hint: 'crear', icon: '+', run: () => {
      createNote({});
      showView('notes');
      requestAnimationFrame(() => document.getElementById('note-title')?.select());
    } },
    { label: 'Nota diaria de hoy', hint: 'crear', icon: '◎', run: () => openDailyNote() },
    { label: 'Ver el grafo de conocimiento', hint: 'notas', icon: '⬡', run: () => openGraph() },

    { label: 'Hacer la revisión semanal', hint: 'acción', icon: '◈', run: () => openReview() },
    { label: 'Nota desde plantilla', hint: 'crear', icon: '▤', run: () => { showView('notes'); openNoteTemplatePicker(); } },
    { label: 'Ejecutar las reglas ahora', hint: 'acción', icon: '⚡', run: () => runRules({ interactive: true }) },
    { label: 'Iniciar sesión de enfoque', hint: 'acción', icon: '◷', run: () => openFocusPicker() },
    { label: 'Nuevo hábito', hint: 'crear', icon: '+', run: () => { showView('habits'); document.getElementById('add-habit-btn')?.click(); } },
    { label: 'Sincronizar ahora', hint: 'acción', icon: '↻', run: () => syncNow({ interactive: true }) },
    { label: 'Descargar backup',  hint: 'acción', icon: '↓', run: () => document.getElementById('export-btn')?.click() },
    { label: 'Conectar cuentas',  hint: 'acción', icon: '⚯', run: () => openIntegrationsModal() },
    { label: 'Cambiar tema claro/oscuro', hint: 'acción', icon: '◐', run: () => document.getElementById('theme-toggle')?.click() },
    { label: 'Cerrar el panel', hint: 'acción', icon: '⎋', run: () => closeDashboard() },
  ];
  return cmds.map(c => ({ ...c, type: 'command' }));
}

function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  // El modal de tarea lleva un selector de proyecto que se rellena al abrirlo
  // (ver fillProjectSelect en js/05-dashboard.js). Sin esto, abrirlo desde la
  // paleta mostraría la lista vacía mientras que el botón "+ Nueva" sí la
  // rellena — la misma pantalla comportándose de dos maneras según cómo llegues.
  if (id === 'task-modal' && typeof fillProjectSelect === 'function') fillProjectSelect();
  m.classList.remove('hidden');
  m.classList.add('flex');
}

/* ============ RESULTADOS DE DATOS ============ */

function paletteDataItems() {
  const out = [];
  const statusLabel = { todo: 'por hacer', doing: 'en progreso', done: 'completada' };

  tasks.forEach(t => out.push({
    type: 'task', icon: '✓',
    label: t.title,
    hint: `tarea · ${statusLabel[t.status] || t.status}`,
    haystack: `${t.title} ${t.desc || ''}`,
    run: () => { showView('tasks'); flashHighlight(`[data-task-id="${t.id}"]`); },
  }));

  events.forEach(e => out.push({
    type: 'event', icon: '▤',
    label: e.title,
    hint: `evento · ${new Date(e.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`,
    haystack: e.title,
    run: () => { showView('agenda'); showAgendaTab('calendar'); },
  }));

  projects.forEach(p => out.push({
    type: 'project', icon: '▧',
    label: p.name,
    hint: `proyecto${p.client ? ' · ' + p.client : ''}`,
    haystack: `${p.name} ${p.client || ''} ${p.desc || ''}`,
    run: () => showView('projects'),
  }));

  notes.forEach(n => out.push({
    type: 'note', icon: n.daily ? '◎' : '✎',
    label: n.title,
    // El cuerpo de la nota entra en el haystack pero no en la etiqueta: buscar
    // dentro del texto es justo lo que faltaba, pero mostrarlo entero rompería
    // la lista. El preview va sin sintaxis markdown.
    hint: (n.archived ? 'archivada · ' : 'nota · ') + markdownToPlain(n.content, 60),
    haystack: `${n.title} ${n.content || ''}`,
    run: () => {
      commitNoteEdits();
      notesUi.selectedId = n.id;
      notesUi.showArchived = !!n.archived;
      notesUi.tagFilter = null;
      showView('notes');
    },
  }));

  return out;
}

/** Resalta brevemente un elemento tras navegar hacia él. */
function flashHighlight(selector) {
  // El render de la vista es sincrónico, pero se espera un frame para que el
  // elemento exista en el DOM antes de buscarlo.
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash-target');
    setTimeout(() => el.classList.remove('flash-target'), 1600);
  });
}

/* ============ RENDER ============ */

function buildPaletteItems(query) {
  const raw = query.trim();

  // "+ texto" → crear tarea directamente
  if (raw.startsWith('+')) {
    const text = raw.slice(1).trim();
    if (!text) {
      return [{ type: 'hint', icon: '+', label: 'Escribe el título de la tarea', hint: 'ej: llamar al cliente !alta mañana', run: null }];
    }
    return [{
      type: 'create', icon: '+',
      label: `Crear tarea: ${text}`,
      hint: 'admite !alta · !media · !baja · hoy · mañana',
      run: () => {
        const created = quickAddTask(text);
        if (created) { refreshActiveView(); toast(`Tarea añadida: ${created.title}`); }
      },
    }];
  }

  const searchOnly = raw.startsWith('?');
  const needle = (searchOnly ? raw.slice(1) : raw).trim();

  const pool = searchOnly ? paletteDataItems() : [...paletteCommands(), ...paletteDataItems()];

  const scored = pool
    .map(item => ({ item, score: scoreMatch(item.haystack || item.label, needle) }))
    .filter(x => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Empate: los comandos primero, son más rápidos de reconocer.
      return (a.item.type === 'command' ? 0 : 1) - (b.item.type === 'command' ? 0 : 1);
    })
    .slice(0, 40)
    .map(x => x.item);

  return scored;
}

const TYPE_TONE = {
  command: 'text-accent',
  create: 'text-accent',
  task: 'text-neutral-400',
  event: 'text-neutral-400',
  project: 'text-neutral-400',
  note: 'text-neutral-400',
  hint: 'text-neutral-500',
};

function renderPalette() {
  const box = paletteResults();
  if (!box) return;
  if (!paletteItems.length) {
    box.innerHTML = `<div class="px-5 py-8 text-center text-neutral-500 text-sm">Sin resultados.</div>`;
    return;
  }
  box.innerHTML = paletteItems.map((item, i) => `
    <button type="button" data-palette-index="${i}"
      class="palette-row w-full flex items-center gap-3 px-5 py-3 text-left ${i === paletteIndex ? 'is-active' : ''}">
      <span class="mono text-sm w-5 text-center shrink-0 ${TYPE_TONE[item.type] || 'text-neutral-400'}">${item.icon || '·'}</span>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold truncate">${escapeHtml(item.label)}</span>
        ${item.hint ? `<span class="block meta-label text-neutral-500 truncate">${escapeHtml(item.hint)}</span>` : ''}
      </span>
      ${i === paletteIndex ? '<span class="meta-label text-neutral-500 shrink-0">↵</span>' : ''}
    </button>`).join('');

  const active = box.querySelector('.is-active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function updatePalette() {
  paletteItems = buildPaletteItems(paletteInput().value);
  paletteIndex = 0;
  renderPalette();
}

/* ============ ABRIR / CERRAR ============ */

function openPalette() {
  const el = paletteEl();
  if (!el) return;
  paletteOpen = true;
  el.classList.remove('hidden');
  el.classList.add('flex');
  const input = paletteInput();
  input.value = '';
  updatePalette();
  input.focus();
}

function closePalette() {
  const el = paletteEl();
  if (!el) return;
  paletteOpen = false;
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function runPaletteItem(item) {
  if (!item || !item.run) return;
  closePalette();
  item.run();
}

/* ============ ATAJOS ============ */

document.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();

  // Ctrl/Cmd+K abre la paleta. Sólo dentro del panel desbloqueado: en el sitio
  // público no hay nada que buscar, y secuestrar el atajo del navegador sin dar
  // nada a cambio sería peor que no tenerlo.
  if ((e.ctrlKey || e.metaKey) && key === 'k') {
    if (!isDashboardOpen()) return;
    e.preventDefault();
    paletteOpen ? closePalette() : openPalette();
    return;
  }

  if (!paletteOpen) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();   // que no lo consuma también el handler que cierra el panel
    closePalette();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (paletteItems.length) { paletteIndex = (paletteIndex + 1) % paletteItems.length; renderPalette(); }
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (paletteItems.length) { paletteIndex = (paletteIndex - 1 + paletteItems.length) % paletteItems.length; renderPalette(); }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    runPaletteItem(paletteItems[paletteIndex]);
  }
}, true);   // fase de captura: así Escape llega aquí antes que al handler del panel

document.getElementById('palette-input')?.addEventListener('input', updatePalette);

document.getElementById('palette-results')?.addEventListener('click', e => {
  const row = e.target.closest('[data-palette-index]');
  if (!row) return;
  runPaletteItem(paletteItems[+row.dataset.paletteIndex]);
});

// Clic en el fondo cierra
paletteEl()?.addEventListener('mousedown', e => {
  if (e.target === paletteEl()) closePalette();
});

document.getElementById('palette-open-btn')?.addEventListener('click', openPalette);
