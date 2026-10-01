/* 14-focus.js — temporizador de enfoque (pomodoro) que deja rastro.

   El valor no está en el temporizador, que es trivial, sino en lo que queda
   después: cada sesión terminada se guarda en `sessions` con la tarea o el
   proyecto al que se dedicó. Eso convierte "siento que le dedico mucho tiempo a
   X" en un dato, y alimenta las métricas (js/15-insights.js).

   Decisión importante: el estado del temporizador se persiste como una MARCA DE
   TIEMPO de inicio, no como un contador que se decrementa. Un contador se
   detiene si el navegador suspende la pestaña (móvil con la pantalla apagada,
   portátil que hiberna) y setInterval deja de dispararse con precisión. Una
   marca de inicio siempre se puede comparar con el reloj actual, así que la
   cuenta es correcta aunque el intervalo se haya saltado mil ticks. */

const FOCUS_DEFAULTS = { focus: 25, short: 5, long: 15, roundsBeforeLong: 4 };

const focusState = {
  // 'idle' | 'running' | 'paused'
  status: 'idle',
  kind: 'focus',          // 'focus' | 'short' | 'long'
  startedAt: null,        // ms
  // Acumulado antes de la pausa actual, para que pausar no falsee la duración.
  elapsedBeforePause: 0,
  durationMin: FOCUS_DEFAULTS.focus,
  taskId: null,
  projectId: null,
  label: '',
  round: 0,
  tick: null,
};

function focusSettings() {
  return { ...FOCUS_DEFAULTS, ...(store.get('focusSettings', {}) || {}) };
}

function persistFocusState() {
  store.set('focusRun', focusState.status === 'idle' ? null : {
    status: focusState.status,
    kind: focusState.kind,
    startedAt: focusState.startedAt,
    elapsedBeforePause: focusState.elapsedBeforePause,
    durationMin: focusState.durationMin,
    taskId: focusState.taskId,
    projectId: focusState.projectId,
    label: focusState.label,
    round: focusState.round,
  });
}

function restoreFocusState() {
  const saved = store.get('focusRun', null);
  if (!saved || !saved.status || saved.status === 'idle') return;
  Object.assign(focusState, saved, { tick: null });
  if (focusState.status === 'running') startFocusTick();
  renderFocusWidget();
}

/** Milisegundos transcurridos de la sesión actual, pausas descontadas. */
function focusElapsedMs() {
  if (focusState.status === 'idle') return 0;
  const since = focusState.status === 'running' && focusState.startedAt
    ? Date.now() - focusState.startedAt
    : 0;
  return focusState.elapsedBeforePause + since;
}

function focusRemainingMs() {
  return Math.max(0, focusState.durationMin * 60000 - focusElapsedMs());
}

function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startFocusTick() {
  clearInterval(focusState.tick);
  focusState.tick = setInterval(() => {
    renderFocusWidget();
    if (focusRemainingMs() <= 0) completeFocusSession();
  }, 500);
}

function startFocus({ kind = 'focus', taskId = null, projectId = null, label = '' } = {}) {
  const settings = focusSettings();
  focusState.status = 'running';
  focusState.kind = kind;
  focusState.durationMin = settings[kind] || settings.focus;
  focusState.startedAt = Date.now();
  focusState.elapsedBeforePause = 0;
  focusState.taskId = taskId;
  focusState.projectId = projectId;
  focusState.label = label || (taskId ? (tasks.find(t => t.id === taskId)?.title || '') : '');
  persistFocusState();
  startFocusTick();
  renderFocusWidget();
}

function pauseFocus() {
  if (focusState.status !== 'running') return;
  focusState.elapsedBeforePause = focusElapsedMs();
  focusState.startedAt = null;
  focusState.status = 'paused';
  clearInterval(focusState.tick);
  persistFocusState();
  renderFocusWidget();
}

function resumeFocus() {
  if (focusState.status !== 'paused') return;
  focusState.startedAt = Date.now();
  focusState.status = 'running';
  persistFocusState();
  startFocusTick();
  renderFocusWidget();
}

/** Guarda la sesión si merece la pena y deja el temporizador listo para otra. */
function logFocusSession({ completed }) {
  const minutes = Math.round(focusElapsedMs() / 60000);
  // Menos de un minuto no es una sesión, es un clic sin querer.
  if (focusState.kind === 'focus' && minutes >= 1) {
    const startedDate = new Date(Date.now() - focusElapsedMs());
    sessions.push(touch({
      id: uid(),
      kind: 'focus',
      minutes,
      completed: !!completed,
      taskId: focusState.taskId,
      projectId: focusState.projectId,
      label: focusState.label,
      startedAt: startedDate.toISOString(),
      /* `day` es la fecha LOCAL, y es un campo aparte a propósito. Derivarla de
         startedAt con .slice(0,10) daría el día en UTC: en Colombia (UTC-5) una
         sesión de las 20:00 se contaría como del día siguiente, y los totales
         diarios saldrían descuadrados justo en las horas en que más se trabaja. */
      day: dateKey(startedDate),
      createdAt: Date.now(),
    }));
    saveAll();
  }
  return minutes;
}

function completeFocusSession() {
  clearInterval(focusState.tick);
  const wasFocus = focusState.kind === 'focus';
  const minutes = logFocusSession({ completed: true });

  if (wasFocus) {
    focusState.round++;
    const settings = focusSettings();
    const nextKind = focusState.round % settings.roundsBeforeLong === 0 ? 'long' : 'short';
    notifyFocus('Sesión terminada', `${minutes} min de enfoque. Toca descansar.`);
    toast(`Sesión guardada: ${minutes} min`);
    // El descanso no arranca solo: encadenar sin preguntar es la forma más
    // rápida de que el temporizador deje de reflejar lo que de verdad haces.
    focusState.status = 'idle';
    focusState.kind = nextKind;
    focusState.elapsedBeforePause = 0;
    focusState.startedAt = null;
  } else {
    notifyFocus('Descanso terminado', 'Vuelve cuando quieras.');
    focusState.status = 'idle';
    focusState.kind = 'focus';
    focusState.elapsedBeforePause = 0;
    focusState.startedAt = null;
  }
  persistFocusState();
  renderFocusWidget();
  if (activeView === 'today' && typeof renderToday === 'function') renderToday();
}

function stopFocus() {
  if (focusState.status === 'idle') return;
  const minutes = logFocusSession({ completed: false });
  clearInterval(focusState.tick);
  focusState.status = 'idle';
  focusState.startedAt = null;
  focusState.elapsedBeforePause = 0;
  focusState.taskId = null;
  focusState.projectId = null;
  focusState.label = '';
  persistFocusState();
  renderFocusWidget();
  if (minutes >= 1) toast(`Sesión guardada: ${minutes} min`);
}

/* Notificación del sistema si ya hay permiso. No se pide aquí: pedir permiso a
   mitad de una sesión de concentración es exactamente lo contrario de lo que
   este módulo intenta conseguir. El permiso se concede desde el Centro de
   tareas, con un clic explícito. */
function notifyFocus(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'icon-192.png', tag: 'jdh-focus' });
    }
  } catch (err) {
    console.warn('[focus] no se pudo notificar:', err);
  }
}

/* ============ WIDGET FLOTANTE ============
   Abajo a la izquierda: el reproductor de audio ya ocupa la derecha. */

const KIND_LABEL = { focus: 'Enfoque', short: 'Descanso', long: 'Descanso largo' };

function renderFocusWidget() {
  const el = document.getElementById('focus-widget');
  if (!el) return;

  if (focusState.status === 'idle' && !isDashboardOpen()) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  if (focusState.status === 'idle') {
    el.innerHTML = `
      <button type="button" id="focus-start-btn" class="focus-fab" title="Iniciar sesión de enfoque">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      </button>`;
    return;
  }

  const remaining = focusRemainingMs();
  const total = focusState.durationMin * 60000;
  const progress = total > 0 ? 1 - remaining / total : 0;
  const circumference = 2 * Math.PI * 26;

  el.innerHTML = `
    <div class="focus-panel">
      <div class="relative shrink-0" style="width:60px;height:60px">
        <svg width="60" height="60" viewBox="0 0 60 60" class="-rotate-90">
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4" />
          <circle cx="30" cy="30" r="26" fill="none" stroke="${focusState.kind === 'focus' ? '#2667ff' : '#22c55e'}"
                  stroke-width="4" stroke-linecap="round"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${circumference * (1 - progress)}" />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center mono text-[11px] font-bold">${formatClock(remaining)}</div>
      </div>

      <div class="min-w-0 flex-1">
        <div class="meta-label ${focusState.kind === 'focus' ? 'text-accent' : 'text-green-400'}">${KIND_LABEL[focusState.kind]}${focusState.status === 'paused' ? ' · en pausa' : ''}</div>
        <div class="text-sm font-semibold truncate">${escapeHtml(focusState.label || 'Sin asignar')}</div>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button type="button" data-focus-action="${focusState.status === 'running' ? 'pause' : 'resume'}" class="focus-btn" title="${focusState.status === 'running' ? 'Pausar' : 'Reanudar'}">
          ${focusState.status === 'running'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l11 7-11 7z"/></svg>'}
        </button>
        <button type="button" data-focus-action="stop" class="focus-btn" title="Terminar y guardar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        </button>
      </div>
    </div>`;
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const action = e.target.closest('[data-focus-action]');
  if (action) {
    const a = action.dataset.focusAction;
    if (a === 'pause') pauseFocus();
    if (a === 'resume') resumeFocus();
    if (a === 'stop') {
      if (focusState.kind === 'focus' && focusElapsedMs() > 60000 &&
          !confirm('¿Terminar la sesión ahora? Se guardará el tiempo que llevas.')) return;
      stopFocus();
    }
    return;
  }

  if (e.target.closest('#focus-start-btn')) { openFocusPicker(); return; }

  const startFor = e.target.closest('[data-focus-task]');
  if (startFor) {
    const task = tasks.find(t => t.id === startFor.dataset.focusTask);
    if (!task) return;
    startFocus({ taskId: task.id, projectId: task.projectId || null, label: task.title });
    toast(`Enfoque iniciado: ${task.title}`);
  }
});

/** Elige a qué dedicar la sesión. Reutiliza la paleta, que ya sabe buscar. */
function openFocusPicker() {
  const pending = tasks.filter(t => t.status !== 'done');
  if (!pending.length) {
    startFocus({ label: 'Enfoque libre' });
    toast('Enfoque libre iniciado');
    return;
  }
  const m = document.getElementById('focus-modal');
  if (!m) { startFocus({ label: 'Enfoque libre' }); return; }
  const list = document.getElementById('focus-task-list');
  list.innerHTML =
    `<button type="button" data-focus-pick="" class="palette-row w-full text-left px-4 py-3 text-sm">
       <span class="font-semibold">Enfoque libre</span>
       <span class="block meta-label text-neutral-500">sin asignar a ninguna tarea</span>
     </button>` +
    pending.slice(0, 40).map(t => `
      <button type="button" data-focus-pick="${t.id}" class="palette-row w-full text-left px-4 py-3 text-sm">
        <span class="font-semibold">${escapeHtml(t.title)}</span>
        <span class="block meta-label text-neutral-500">${t.status === 'doing' ? 'en progreso' : 'por hacer'}</span>
      </button>`).join('');
  m.classList.remove('hidden'); m.classList.add('flex');
}

document.addEventListener('click', e => {
  const pick = e.target.closest('[data-focus-pick]');
  if (!pick) return;
  const m = document.getElementById('focus-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  const id = pick.dataset.focusPick;
  if (!id) { startFocus({ label: 'Enfoque libre' }); toast('Enfoque libre iniciado'); return; }
  const task = tasks.find(t => t.id === id);
  startFocus({ taskId: id, projectId: task?.projectId || null, label: task?.title || '' });
  toast(`Enfoque iniciado: ${task?.title || ''}`);
});

document.getElementById('focus-modal')?.addEventListener('click', e => {
  if (e.target.id === 'focus-modal') {
    e.currentTarget.classList.add('hidden');
    e.currentTarget.classList.remove('flex');
  }
});

/* ---- Consultas que usan las métricas y la vista Hoy ---- */

/** Día local de una sesión, con respaldo para registros anteriores a `day`. */
function sessionDay(s) {
  return s.day || (s.startedAt ? dateKey(new Date(s.startedAt)) : null);
}

function minutesFocusedOn(dateKeyStr) {
  return sessions
    .filter(s => s.kind === 'focus' && sessionDay(s) === dateKeyStr)
    .reduce((n, s) => n + (s.minutes || 0), 0);
}

function minutesByProject(sinceMs) {
  const out = new Map();
  sessions.forEach(s => {
    if (s.kind !== 'focus') return;
    if (sinceMs && new Date(s.startedAt).getTime() < sinceMs) return;
    const key = s.projectId || '__sin_proyecto__';
    out.set(key, (out.get(key) || 0) + (s.minutes || 0));
  });
  return out;
}

restoreFocusState();
