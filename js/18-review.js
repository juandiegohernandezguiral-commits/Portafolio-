/* 18-review.js — revisión semanal guiada.

   Las métricas (js/15-insights.js) te enseñan los números. Esto te hace pasar
   por ellos y DECIDIR: qué cerraste, qué se quedó atascado, qué haces con lo
   vencido. La diferencia entre un panel que registra y uno que te obliga a
   pensar una vez por semana.

   Es un flujo de cinco pasos y termina creando una nota con el resumen
   congelado — los números de esa semana quedan escritos, porque dentro de un
   mes las métricas en vivo ya no podrán reconstruir qué veías hoy.

   Decisión: la revisión NO modifica nada por su cuenta. Propone acciones sobre
   lo vencido (reprogramar a hoy, o darlo por hecho) y tú las pulsas. Un repaso
   que cambia cosas mientras lo lees deja de ser un repaso. */

const reviewState = {
  open: false,
  step: 0,
  answers: { logros: '', obstaculos: '', proxima: '' },
  // Se congela al abrir para que los números no cambien bajo los pies mientras
  // se contesta (y porque los pasos 2 y 3 sí accionan sobre tareas).
  snapshot: null,
};

const REVIEW_STEPS = ['Lo que lograste', 'Lo que quedó', 'Constancia', 'Proyectos', 'Cierre'];

/** Lunes 00:00 de la semana actual. */
function reviewWeekStart() { return startOfWeek(new Date()); }

function buildReviewSnapshot() {
  const weekStart = reviewWeekStart();
  const weekStartMs = weekStart.getTime();

  const done = tasks.filter(t => t.status === 'done' && (t.completedAt || t.updatedAt || 0) >= weekStartMs);
  const weekSessions = sessions.filter(s => s.kind === 'focus' && new Date(s.startedAt).getTime() >= weekStartMs);
  const minutes = weekSessions.reduce((n, s) => n + (s.minutes || 0), 0);

  const overdue = tasks
    .filter(t => t.status !== 'done' && t.due && isOverdue(parseDue(t.due)))
    .sort((a, b) => parseDue(a.due) - parseDue(b.due));

  const stalled = tasks.filter(t => t.status === 'doing' && (t.updatedAt || 0) < Date.now() - 7 * 86400000);

  const idx = typeof habitLogIndex === 'function' ? habitLogIndex() : null;
  const habitRows = habits.filter(h => !h.archived).map(h => ({
    name: h.name,
    rate: habitRate(h, 7, idx),
    streak: currentStreak(h, idx),
  })).sort((a, b) => b.rate - a.rate);

  const projectRows = projects.map(p => {
    const stagesDone = p.stages.filter(s => s.done).length;
    const linked = tasks.filter(t => t.projectId === p.id);
    const mins = sessions
      .filter(s => s.kind === 'focus' && s.projectId === p.id && new Date(s.startedAt).getTime() >= weekStartMs)
      .reduce((n, s) => n + (s.minutes || 0), 0);
    return {
      name: p.name,
      progress: Math.round((stagesDone / p.stages.length) * 100),
      openTasks: linked.filter(t => t.status !== 'done').length,
      minutes: mins,
      deadline: p.deadline,
    };
  }).sort((a, b) => b.minutes - a.minutes);

  return {
    weekStart,
    weekNumber: isoWeekNumber(new Date()),
    done, doneCount: done.length,
    minutes, sessionCount: weekSessions.length,
    overdue, stalled,
    habitRows, projectRows,
    notesCreated: notes.filter(n => (n.createdAt || 0) >= weekStartMs).length,
  };
}

/* ============ PASOS ============ */

function reviewStepHtml(step) {
  const s = reviewState.snapshot;
  const fmt = typeof formatMinutes === 'function' ? formatMinutes : v => v + 'm';

  if (step === 0) {
    return `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div class="surface-soft rounded-xl p-4"><div class="meta-label text-neutral-500 mb-1">Completadas</div><div class="display text-3xl text-accent">${s.doneCount}</div></div>
        <div class="surface-soft rounded-xl p-4"><div class="meta-label text-neutral-500 mb-1">Enfocado</div><div class="display text-3xl">${escapeHtml(fmt(s.minutes))}</div></div>
        <div class="surface-soft rounded-xl p-4"><div class="meta-label text-neutral-500 mb-1">Sesiones</div><div class="display text-3xl">${s.sessionCount}</div></div>
        <div class="surface-soft rounded-xl p-4"><div class="meta-label text-neutral-500 mb-1">Notas nuevas</div><div class="display text-3xl">${s.notesCreated}</div></div>
      </div>
      ${s.done.length ? `
        <div class="mb-5">
          <div class="meta-label text-neutral-500 mb-2">Lo que cerraste</div>
          <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            ${s.done.slice(0, 20).map(t => `
              <div class="flex items-center gap-2.5 text-sm">
                <span class="text-accent shrink-0">✓</span><span class="truncate">${escapeHtml(t.title)}</span>
              </div>`).join('')}
            ${s.done.length > 20 ? `<p class="meta-label text-neutral-500">y ${s.done.length - 20} más</p>` : ''}
          </div>
        </div>` : '<p class="text-neutral-500 text-sm mb-5">Esta semana no cerraste ninguna tarea. No siempre es un problema — a veces la semana fue de otra cosa.</p>'}
      <label class="block">
        <span class="meta-label text-neutral-500 block mb-2">¿De qué te sientes satisfecho?</span>
        <textarea data-review-field="logros" rows="3" class="w-full surface-soft rounded-xl px-4 py-3 focus:border-accent focus:outline-none resize-none text-sm">${escapeHtml(reviewState.answers.logros)}</textarea>
      </label>`;
  }

  if (step === 1) {
    const rows = [...s.overdue, ...s.stalled.filter(t => !s.overdue.includes(t))];
    return `
      ${rows.length ? `
        <p class="text-neutral-500 text-sm mb-4">Decide una por una. Nada cambia si no pulsas.</p>
        <div class="space-y-2 max-h-72 overflow-y-auto pr-1 mb-5">
          ${rows.map(t => {
            const due = parseDue(t.due);
            return `
            <div class="flex items-center gap-3 p-3 rounded-xl surface-soft" data-review-row="${t.id}">
              <span class="w-1.5 h-1.5 rounded-full shrink-0 ${due && isOverdue(due) ? 'bg-red-500' : 'bg-amber-500'}"></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium truncate">${escapeHtml(t.title)}</p>
                <p class="meta-label ${due && isOverdue(due) ? 'text-red-500' : 'text-neutral-500'}">${due ? humanizeDue(due) : 'estancada en progreso'}</p>
              </div>
              <button type="button" data-review-action="today|${t.id}" class="meta-label !text-accent shrink-0 px-2">Para hoy</button>
              <button type="button" data-review-action="done|${t.id}" class="meta-label !text-accent shrink-0 px-2">Hecha</button>
            </div>`;
          }).join('')}
        </div>` : '<p class="text-neutral-500 text-sm mb-5">No tienes nada vencido ni estancado. Semana limpia.</p>'}
      <label class="block">
        <span class="meta-label text-neutral-500 block mb-2">¿Qué te lo impidió?</span>
        <textarea data-review-field="obstaculos" rows="3" class="w-full surface-soft rounded-xl px-4 py-3 focus:border-accent focus:outline-none resize-none text-sm">${escapeHtml(reviewState.answers.obstaculos)}</textarea>
      </label>`;
  }

  if (step === 2) {
    return s.habitRows.length ? `
      <div class="space-y-3">
        ${s.habitRows.map(h => `
          <div class="flex items-center gap-4">
            <div class="w-40 shrink-0 truncate text-sm font-medium">${escapeHtml(h.name)}</div>
            <div class="flex-1 h-2.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
              <div class="h-full rounded-full bg-accent" style="width:${h.rate}%"></div>
            </div>
            <div class="w-24 shrink-0 text-right">
              <span class="mono text-sm font-semibold">${h.rate}%</span>
              <span class="meta-label text-neutral-500 ml-1">${h.streak}d</span>
            </div>
          </div>`).join('')}
      </div>
      <p class="text-neutral-500 text-xs mt-5">Porcentaje de días cumplidos de los últimos 7 y racha actual.</p>`
      : '<p class="text-neutral-500 text-sm">No tienes hábitos activos. Si quieres medir constancia, créalos en la vista Hábitos.</p>';
  }

  if (step === 3) {
    return s.projectRows.length ? `
      <div class="space-y-2">
        ${s.projectRows.map(p => `
          <div class="flex items-center gap-4 p-3 rounded-xl surface-soft">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold truncate">${escapeHtml(p.name)}</p>
              <p class="meta-label text-neutral-500">${p.openTasks} abiertas${p.deadline ? ` · entrega ${new Date(p.deadline).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : ''}</p>
            </div>
            <div class="text-right shrink-0">
              <div class="mono text-sm font-semibold">${p.progress}%</div>
              <div class="meta-label ${p.minutes ? 'text-accent' : 'text-neutral-500'}">${p.minutes ? escapeHtml(fmt(p.minutes)) : 'sin tiempo'}</div>
            </div>
          </div>`).join('')}
      </div>
      <p class="text-neutral-500 text-xs mt-5">Un proyecto con 0 minutos esta semana no está avanzando, por mucho progreso acumulado que muestre.</p>`
      : '<p class="text-neutral-500 text-sm">Sin proyectos registrados.</p>';
  }

  // Paso final
  return `
    <label class="block mb-5">
      <span class="meta-label text-neutral-500 block mb-2">¿Cuál es la prioridad de la semana que entra?</span>
      <textarea data-review-field="proxima" rows="4" class="w-full surface-soft rounded-xl px-4 py-3 focus:border-accent focus:outline-none resize-none text-sm">${escapeHtml(reviewState.answers.proxima)}</textarea>
    </label>
    <div class="surface-soft rounded-xl p-4">
      <p class="text-sm">Al terminar se crea una nota <span class="mono text-accent">Revisión semana ${s.weekNumber}</span> con estos números congelados y tus respuestas.</p>
      <p class="text-neutral-500 text-xs mt-2">Los números quedan escritos porque dentro de un mes las métricas en vivo ya no podrán reconstruir qué veías hoy.</p>
    </div>`;
}

function renderReview() {
  const overlay = document.getElementById('review-overlay');
  if (!overlay || !reviewState.open) return;
  const s = reviewState.snapshot;

  document.getElementById('review-step-title').textContent = REVIEW_STEPS[reviewState.step];
  document.getElementById('review-step-count').textContent = `Paso ${reviewState.step + 1} de ${REVIEW_STEPS.length}`;
  document.getElementById('review-week').textContent =
    `Semana ${s.weekNumber} · desde el ${s.weekStart.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}`;

  document.getElementById('review-progress').innerHTML = REVIEW_STEPS.map((_, i) =>
    `<span class="review-dot ${i === reviewState.step ? 'is-active' : ''} ${i < reviewState.step ? 'is-done' : ''}"></span>`).join('');

  document.getElementById('review-body').innerHTML = reviewStepHtml(reviewState.step);

  document.getElementById('review-back').classList.toggle('invisible', reviewState.step === 0);
  document.getElementById('review-next').textContent =
    reviewState.step === REVIEW_STEPS.length - 1 ? 'Guardar revisión' : 'Siguiente';
}

/* ============ ABRIR / CERRAR / GUARDAR ============ */

function openReview() {
  reviewState.open = true;
  reviewState.step = 0;
  reviewState.answers = { logros: '', obstaculos: '', proxima: '' };
  reviewState.snapshot = buildReviewSnapshot();
  document.getElementById('review-overlay')?.classList.remove('hidden');
  renderReview();
}

function closeReview() {
  reviewState.open = false;
  document.getElementById('review-overlay')?.classList.add('hidden');
}

/** Captura lo escrito antes de cambiar de paso (el HTML se regenera entero). */
function captureReviewAnswers() {
  document.querySelectorAll('[data-review-field]').forEach(el => {
    reviewState.answers[el.dataset.reviewField] = el.value;
  });
}

function saveReview() {
  captureReviewAnswers();
  const s = reviewState.snapshot;
  const fmt = typeof formatMinutes === 'function' ? formatMinutes : v => v + 'm';
  const a = reviewState.answers;

  const body = [
    `# Revisión semana ${s.weekNumber}`,
    ``,
    `Desde el ${s.weekStart.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })} · generada el ${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}`,
    ``,
    `## Números`,
    ``,
    `- Tareas completadas: **${s.doneCount}**`,
    `- Tiempo enfocado: **${fmt(s.minutes)}** en ${s.sessionCount} sesiones`,
    `- Notas nuevas: **${s.notesCreated}**`,
    `- Pendiente al cerrar: **${s.overdue.length}** vencidas, **${s.stalled.length}** estancadas`,
    ``,
    s.habitRows.length ? `## Hábitos\n\n${s.habitRows.map(h => `- ${h.name}: ${h.rate}% esta semana, racha de ${h.streak} días`).join('\n')}\n` : '',
    s.projectRows.length ? `## Proyectos\n\n${s.projectRows.map(p => `- ${p.name}: ${p.progress}% · ${p.openTasks} abiertas · ${p.minutes ? fmt(p.minutes) : 'sin tiempo'} esta semana`).join('\n')}\n` : '',
    `## Satisfecho de`,
    ``,
    a.logros.trim() || '_(sin respuesta)_',
    ``,
    `## Qué me lo impidió`,
    ``,
    a.obstaculos.trim() || '_(sin respuesta)_',
    ``,
    `## Prioridad de la semana que entra`,
    ``,
    a.proxima.trim() || '_(sin respuesta)_',
    ``,
    `#revision`,
  ].filter(x => x !== '').join('\n');

  const note = createNote({ title: `Revisión semana ${s.weekNumber}`, content: body, open: false });
  store.set('lastReviewAt', new Date().toISOString());
  store.set('lastReviewWeek', s.weekNumber);

  closeReview();
  notesUi.selectedId = note.id;
  notesUi.tagFilter = null;
  showView('notes');
  toast('Revisión guardada como nota');
}

/** Semanas transcurridas desde la última revisión, o null si nunca se hizo. */
function weeksSinceReview() {
  const last = store.get('lastReviewAt', null);
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / (7 * 86400000));
}

/** Tarjeta para la vista Hoy: invita a revisar si toca. */
function reviewPromptBlock() {
  const weeks = weeksSinceReview();
  const isWeekend = [0, 6].includes(new Date().getDay());
  // Se ofrece si nunca se hizo, si ha pasado una semana, o en fin de semana —
  // que es cuando una revisión semanal tiene sentido. Fuera de eso no estorba.
  if (weeks !== null && weeks < 1 && !isWeekend) return '';
  if (weeks === 0 && isWeekend) return '';

  return `
    <div class="surface rounded-2xl p-6 flex items-center gap-4 flex-wrap">
      <div class="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="font-display font-bold">Revisión semanal</h3>
        <p class="text-neutral-500 text-sm">${weeks === null ? 'Nunca has hecho una. Son cinco pasos.' : `Han pasado ${weeks} semana${weeks !== 1 ? 's' : ''} desde la última.`}</p>
      </div>
      <button type="button" id="review-start-btn" class="px-5 py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em] shrink-0">Empezar</button>
    </div>`;
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  if (e.target.closest('#review-start-btn')) { openReview(); return; }
  if (e.target.closest('#review-close')) { closeReview(); return; }

  if (e.target.closest('#review-back')) {
    captureReviewAnswers();
    reviewState.step = Math.max(0, reviewState.step - 1);
    renderReview();
    return;
  }

  if (e.target.closest('#review-next')) {
    captureReviewAnswers();
    if (reviewState.step === REVIEW_STEPS.length - 1) saveReview();
    else { reviewState.step++; renderReview(); }
    return;
  }

  const action = e.target.closest('[data-review-action]');
  if (action) {
    const [what, id] = action.dataset.reviewAction.split('|');
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    if (what === 'today') {
      const d = new Date(); d.setHours(18, 0, 0, 0);
      const pad = n => String(n).padStart(2, '0');
      t.due = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
      t.status = t.status === 'done' ? 'todo' : t.status;
    } else {
      t.status = 'done';
      markTaskCompletion(t);
      if (typeof spawnNextOccurrence === 'function') spawnNextOccurrence(t);
    }
    touch(t);
    saveAll();
    // Se quita la fila del paso en vez de repintar todo: repintar perdería el
    // texto que se esté escribiendo en el textarea de abajo.
    action.closest('[data-review-row]')?.remove();
    toast(what === 'today' ? 'Reprogramada para hoy' : 'Marcada como hecha');
  }
});

document.addEventListener('keydown', e => {
  if (reviewState.open && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('¿Salir de la revisión? Lo que hayas escrito se pierde.')) closeReview();
  }
}, true);
