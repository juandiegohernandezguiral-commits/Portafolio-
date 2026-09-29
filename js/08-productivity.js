/* 08-productivity.js — lo que hace que el panel se use a diario en vez de sólo
   almacenar cosas:

     · Vista "Hoy": una sola pantalla con lo vencido, lo de hoy y lo en curso,
       juntando tus datos locales con lo que venga de Trello/Outlook/Notion.
     · Fechas de vencimiento en las tareas del kanban.
     · Tareas recurrentes: al completar una, se genera su próxima ocurrencia.
     · Captura rápida: una línea para meter una tarea sin abrir el modal. */

/* ============ FECHAS ============ */

/** Interpreta el campo `due` de una tarea (formato datetime-local o date). */
function parseDue(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfTomorrow() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

function isOverdue(date) { return !!date && date.getTime() < Date.now(); }
function isToday(date) {
  if (!date) return false;
  return date.getTime() >= startOfToday().getTime() && date.getTime() < startOfTomorrow().getTime();
}

/** "vencida hace 2 h" / "en 3 h" / "mañana" — más útil que una fecha absoluta. */
function humanizeDue(date) {
  if (!date) return '';
  const diffMs = date.getTime() - Date.now();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  const late = diffMs < 0;
  let magnitude;
  if (absMin < 60) magnitude = `${absMin} min`;
  else if (absMin < 60 * 24) magnitude = `${Math.round(absMin / 60)} h`;
  else magnitude = `${Math.round(absMin / (60 * 24))} día${Math.round(absMin / (60 * 24)) > 1 ? 's' : ''}`;
  return late ? `vencida hace ${magnitude}` : `en ${magnitude}`;
}

/* ============ TAREAS RECURRENTES ============ */

const REPEAT_LABELS = { none: '', daily: 'Diaria', weekly: 'Semanal', biweekly: 'Cada 2 semanas', monthly: 'Mensual' };

function advanceDate(date, repeat) {
  const next = new Date(date.getTime());
  switch (repeat) {
    case 'daily':    next.setDate(next.getDate() + 1); break;
    case 'weekly':   next.setDate(next.getDate() + 7); break;
    case 'biweekly': next.setDate(next.getDate() + 14); break;
    // setMonth se encarga del desborde (31 de enero + 1 mes → 3 de marzo en años
    // no bisiestos). Es el comportamiento nativo y para un panel personal es
    // preferible a inventar reglas de "último día del mes".
    case 'monthly':  next.setMonth(next.getMonth() + 1); break;
    default: return null;
  }
  return next;
}

/**
 * Crea la siguiente ocurrencia de una tarea recurrente que se acaba de completar.
 * La llama el drop del kanban y el toggle de la vista Hoy (ver js/05-dashboard.js).
 *
 * Si la tarea llevaba mucho vencida, se adelanta la fecha repetidamente hasta que
 * caiga en el futuro — así una tarea diaria que no tocaste en dos semanas no genera
 * una ocurrencia que ya nace vencida.
 */
function spawnNextOccurrence(doneTask) {
  const repeat = doneTask.repeat || 'none';
  if (repeat === 'none' || !REPEAT_LABELS[repeat]) return;

  // Evita duplicados si la tarea se mueve a "done" dos veces (arrastrar, deshacer,
  // volver a arrastrar): se marca la que ya generó su relevo.
  if (doneTask.spawnedNext) return;

  let base = parseDue(doneTask.due) || new Date();
  let next = advanceDate(base, repeat);
  if (!next) return;
  let guard = 0;
  while (next.getTime() < Date.now() && guard++ < 400) {
    const advanced = advanceDate(next, repeat);
    if (!advanced) break;
    next = advanced;
  }

  // Formato datetime-local (YYYY-MM-DDTHH:mm) en hora local, que es lo que el
  // input espera. toISOString() daría UTC y desplazaría la hora.
  const pad = n => String(n).padStart(2, '0');
  const dueStr = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;

  doneTask.spawnedNext = true;
  tasks.push(touch({
    id: uid(),
    title: doneTask.title,
    desc: doneTask.desc || '',
    priority: doneTask.priority || 'med',
    status: 'todo',
    repeat,
    due: dueStr,
    createdAt: Date.now(),
  }));
}

/* ============ VISTA "HOY" ============ */

/** Junta tareas locales y externas en una sola lista con forma común. */
function collectTodayItems() {
  const overdue = [];
  const today = [];
  const doing = [];

  tasks.forEach(t => {
    if (t.status === 'done') return;
    const due = parseDue(t.due);
    const entry = { kind: 'task', id: t.id, title: t.title, due, priority: t.priority, repeat: t.repeat, source: 'Panel' };
    if (isOverdue(due)) overdue.push(entry);
    else if (isToday(due)) today.push(entry);
    else if (t.status === 'doing') doing.push(entry);
  });

  events.forEach(e => {
    const due = parseDue(e.date);
    const entry = { kind: 'event', id: e.id, title: e.title, due, source: 'Agenda' };
    if (isOverdue(due)) return;             // un evento pasado no es pendiente
    if (isToday(due)) today.push(entry);
  });

  /* Lo externo se lee de hubState, que es el resultado del último fetch a
     Trello/Graph/Notion. Si el Centro de tareas no se ha abierto en esta sesión
     estará vacío — se muestra un aviso en vez de fingir que no hay nada. */
  const externalSources = [
    ['trello', 'Trello'], ['outlook', 'Outlook'], ['notion', 'Notion'],
  ];
  externalSources.forEach(([key, name]) => {
    const state = typeof hubState !== 'undefined' ? hubState[key] : null;
    if (!state || state.status !== 'ready') return;
    state.items.forEach(it => {
      const entry = { kind: 'external', id: it.id, title: it.title, due: it.due, source: name };
      if (isOverdue(it.due)) overdue.push(entry);
      else if (isToday(it.due)) today.push(entry);
    });
  });

  const byDue = (a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity);
  return { overdue: overdue.sort(byDue), today: today.sort(byDue), doing: doing.sort(byDue) };
}

const SOURCE_COLORS = { Panel: '#2667ff', Agenda: '#2667ff', Trello: '#0052CC', Outlook: '#0078D4', Notion: '#525252' };

function todayItemHtml(item, { danger = false } = {}) {
  const canComplete = item.kind === 'task';
  return `
    <div class="flex items-center gap-3 p-3.5 rounded-xl surface-soft">
      ${canComplete
        ? `<button type="button" data-today-done="${item.id}" title="Marcar como completada"
             class="w-5 h-5 rounded-full border-2 ${danger ? 'border-red-500' : 'border-accent'} hover:bg-accent/20 transition shrink-0"></button>`
        : `<span class="w-2 h-2 rounded-full shrink-0" style="background:${SOURCE_COLORS[item.source] || '#2667ff'}"></span>`}
      <div class="min-w-0 flex-1">
        <p class="font-semibold text-sm truncate">${escapeHtml(item.title || 'Sin título')}</p>
        <p class="meta-label ${danger ? 'text-red-500' : 'text-neutral-500'}">
          ${item.source}${item.due ? ' · ' + humanizeDue(item.due) : ''}${item.repeat && item.repeat !== 'none' ? ' · ' + REPEAT_LABELS[item.repeat] : ''}
        </p>
      </div>
      ${item.priority === 'high' ? '<span class="meta-label text-red-500 shrink-0">Alta</span>' : ''}
    </div>`;
}

function todayBlock(title, items, opts) {
  if (!items.length) return '';
  return `
    <div class="surface rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-display font-bold flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${opts.dot}"></span> ${title}
        </h3>
        <span class="meta-label text-neutral-500">${items.length}</span>
      </div>
      <div class="space-y-2">${items.map(i => todayItemHtml(i, opts)).join('')}</div>
    </div>`;
}

function renderToday() {
  const box = document.getElementById('today-list');
  if (!box) return;

  const dateEl = document.getElementById('today-heading-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  const { overdue, today, doing } = collectTodayItems();
  const total = overdue.length + today.length + doing.length;

  const countEl = document.getElementById('today-count');
  if (countEl) countEl.textContent = total === 0 ? 'Nada pendiente' : `${total} pendiente${total > 1 ? 's' : ''}`;

  const hubUnloaded = typeof hubState !== 'undefined'
    && ['trello', 'outlook', 'notion'].some(k => {
      const connected = { trello: isTrelloConnected(), outlook: isMicrosoftConnected(), notion: isNotionConnected() }[k];
      return connected && hubState[k].status !== 'ready';
    });

  if (total === 0) {
    box.innerHTML = `
      <div class="surface rounded-2xl p-12 text-center">
        <div class="w-12 h-12 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <p class="font-display font-bold text-lg mb-1">Día despejado</p>
        <p class="text-neutral-500 text-sm">Nada vencido ni programado para hoy.</p>
      </div>`;
  } else {
    box.innerHTML = [
      todayBlock('Vencidas', overdue, { dot: 'bg-red-500', danger: true }),
      todayBlock('Para hoy', today, { dot: 'bg-accent' }),
      todayBlock('En progreso', doing, { dot: 'bg-amber-500' }),
    ].filter(Boolean).join('');
  }

  if (hubUnloaded) {
    box.insertAdjacentHTML('beforeend', `
      <div class="surface rounded-2xl p-4 flex items-center gap-3" style="border-left:3px solid #f59e0b;">
        <p class="text-neutral-500 text-xs flex-1">Tienes fuentes externas conectadas que aún no se han cargado en esta sesión, así que puede faltar algo aquí.</p>
        <button type="button" data-jump="agenda" class="meta-label !text-accent shrink-0">Cargar →</button>
      </div>`);
  }
}

/* Completar desde la vista Hoy. Delegado en document porque la lista se
   regenera entera en cada render. */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-today-done]');
  if (!btn) return;
  const task = tasks.find(t => t.id === btn.dataset.todayDone);
  if (!task) return;
  task.status = 'done';
  touch(task);
  spawnNextOccurrence(task);
  saveAll();
  renderToday();
});

/* ============ CAPTURA RÁPIDA ============
   Una tarea nueva debería costar una línea de texto, no abrir un modal y elegir
   prioridad y estado. Acepta una sintaxis mínima al final del texto:
     !alta / !media / !baja   → prioridad
     hoy / mañana             → vencimiento
   Todo lo demás es el título. */
function quickAddTask(rawText) {
  let text = String(rawText || '').trim();
  if (!text) return null;

  let priority = 'med';
  text = text.replace(/\s*!(alta|high)\b/i, () => { priority = 'high'; return ''; })
             .replace(/\s*!(media|med)\b/i, () => { priority = 'med'; return ''; })
             .replace(/\s*!(baja|low)\b/i, () => { priority = 'low'; return ''; });

  let due = '';
  const pad = n => String(n).padStart(2, '0');
  const asDueString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  text = text.replace(/\s*\b(hoy|today)\b/i, () => {
    const d = new Date(); d.setHours(18, 0, 0, 0); due = asDueString(d); return '';
  }).replace(/\s*\b(mañana|manana|tomorrow)\b/i, () => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); due = asDueString(d); return '';
  });

  const title = text.trim();
  if (!title) return null;

  const task = touch({
    id: uid(), title, desc: '', priority, status: 'todo',
    repeat: 'none', due, createdAt: Date.now(),
  });
  tasks.push(task);
  saveAll();
  return task;
}

document.getElementById('quick-add-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const input = e.target.querySelector('input[name="text"]');
  const created = quickAddTask(input.value);
  if (!created) return;
  input.value = '';
  refreshActiveView();
  if (typeof toast === 'function') toast(`Tarea añadida: ${created.title}`);
});
