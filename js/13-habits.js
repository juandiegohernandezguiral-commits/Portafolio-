/* 13-habits.js — hábitos con rachas y mapa de calor anual.

   Un segundo cerebro no sólo guarda lo que piensas: también registra lo que
   haces, porque la constancia sólo se ve en agregado. Un día suelto no dice
   nada; doscientos días pintados en una cuadrícula, sí.

   Modelo:
     habits   [{ id, name, emoji, cadence, days[], archived, createdAt, updatedAt }]
     habitLog [{ id, habitId, date:'YYYY-MM-DD', updatedAt }]

   El registro es una colección aparte y no un array dentro del hábito a
   propósito: la fusión del sync trabaja a nivel de registro, así que marcar un
   hábito en el celular y otro distinto en el portátil el mismo día se resuelve
   solo. Si el registro viviera dentro del hábito, una de las dos marcas
   pisaría a la otra. */

const CADENCES = {
  daily:    { label: 'Todos los días', scheduled: () => true },
  weekdays: { label: 'Entre semana',   scheduled: d => d.getDay() >= 1 && d.getDay() <= 5 },
  custom:   { label: 'Días concretos', scheduled: (d, h) => (h.days || []).includes(d.getDay()) },
};

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/* `dateKey` y `keyToDate` viven en js/08-productivity.js, que es el módulo que ya
   posee las utilidades de fecha y carga antes que este. Estaban aquí al
   principio, pero 08 las necesitaba para la vista Hoy y depender hacia adelante
   sólo funciona dentro de funciones, nunca en código de nivel superior. */

function isScheduled(habit, date) {
  const cadence = CADENCES[habit.cadence] || CADENCES.daily;
  return cadence.scheduled(date, habit);
}

/** Índice rápido habitId -> Set de fechas hechas. */
function habitLogIndex() {
  const map = new Map();
  habitLog.forEach(entry => {
    if (!map.has(entry.habitId)) map.set(entry.habitId, new Set());
    map.get(entry.habitId).add(entry.date);
  });
  return map;
}

function isHabitDone(habitId, key, index) {
  const idx = index || habitLogIndex();
  return !!(idx.get(habitId) && idx.get(habitId).has(key));
}

function toggleHabit(habitId, key) {
  const existing = habitLog.find(e => e.habitId === habitId && e.date === key);
  if (existing) {
    tombstone('habitLog', existing.id);
    habitLog = habitLog.filter(e => e.id !== existing.id);
  } else {
    habitLog.push(touch({ id: uid(), habitId, date: key, createdAt: Date.now() }));
  }
  saveAll();
}

/**
 * Racha actual: días programados consecutivos cumplidos, hacia atrás.
 *
 * Detalle que importa: si hoy toca y todavía no está marcado, la racha NO se
 * rompe — el día no ha terminado. Se empieza a contar desde ayer. Romperla a
 * las 00:01 sería castigar por no haber hecho aún algo que da tiempo a hacer.
 */
function currentStreak(habit, index) {
  const idx = index || habitLogIndex();
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  if (isScheduled(habit, cursor) && !isHabitDone(habit.id, dateKey(cursor), idx)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  // Tope de 2 años: evita un bucle infinito si algo va mal con las fechas.
  for (let guard = 0; guard < 730; guard++) {
    if (!isScheduled(habit, cursor)) { cursor.setDate(cursor.getDate() - 1); continue; }
    if (!isHabitDone(habit.id, dateKey(cursor), idx)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Racha más larga alcanzada nunca, recorriendo el registro desde la creación. */
function bestStreak(habit, index) {
  const idx = index || habitLogIndex();
  const done = idx.get(habit.id);
  if (!done || !done.size) return 0;

  const start = [...done].sort()[0];
  const cursor = keyToDate(start);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let best = 0, run = 0;
  for (let guard = 0; guard < 3700 && cursor <= today; guard++) {
    if (isScheduled(habit, cursor)) {
      if (done.has(dateKey(cursor))) { run++; best = Math.max(best, run); }
      else run = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return best;
}

/** Porcentaje de cumplimiento en los últimos `days` días programados. */
function habitRate(habit, days, index) {
  const idx = index || habitLogIndex();
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let scheduled = 0, completed = 0;
  for (let i = 0; i < days; i++) {
    if (isScheduled(habit, cursor)) {
      scheduled++;
      if (isHabitDone(habit.id, dateKey(cursor), idx)) completed++;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return scheduled ? Math.round((completed / scheduled) * 100) : 0;
}

/* ============ MAPA DE CALOR ============
   SVG generado a mano: una columna por semana, una celda por día, al estilo del
   grafico de contribuciones de GitHub. Se dibuja con SVG y no con canvas porque
   son ~370 rectangulos estaticos, y asi cada celda puede llevar su propio
   tooltip nativo sin tener que calcular colisiones del raton. */
function habitHeatmap(habit, index) {
  const idx = index || habitLogIndex();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Arranca 52 semanas atrás, alineado al domingo para que las filas cuadren.
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());

  const CELL = 11, GAP = 3;
  const weeks = Math.ceil((today - start) / (7 * 86400000)) + 1;
  const width = weeks * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  const cells = [];
  const cursor = new Date(start);
  const monthLabels = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      if (cursor > today) break;
      const key = dateKey(cursor);
      const scheduled = isScheduled(habit, cursor);
      const done = isHabitDone(habit.id, key, idx);
      const x = w * (CELL + GAP);
      const y = d * (CELL + GAP);

      let fill = 'var(--heat-empty)';
      if (done) fill = 'var(--heat-done)';
      else if (!scheduled) fill = 'var(--heat-off)';

      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}" ` +
        `data-habit-day="${habit.id}|${key}" class="heat-cell${scheduled ? '' : ' is-off'}">` +
        `<title>${key}${scheduled ? (done ? ' · hecho' : ' · pendiente') : ' · no toca'}</title></rect>`
      );

      if (cursor.getMonth() !== lastMonth && cursor.getDate() <= 7) {
        lastMonth = cursor.getMonth();
        monthLabels.push(`<text x="${x}" y="-5" class="heat-label">${cursor.toLocaleDateString('es-CO', { month: 'short' })}</text>`);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return `<svg viewBox="0 -14 ${width} ${height + 14}" width="${width}" height="${height + 14}" class="heatmap">
    ${monthLabels.join('')}${cells.join('')}
  </svg>`;
}

/* ============ VISTA ============ */

function renderHabits() {
  const box = document.getElementById('habits-list');
  if (!box) return;

  const idx = habitLogIndex();
  const active = habits.filter(h => !h.archived);
  const todayKey = dateKey(new Date());

  const statsEl = document.getElementById('habits-headline');
  if (statsEl) {
    const dueToday = active.filter(h => isScheduled(h, new Date()));
    const doneToday = dueToday.filter(h => isHabitDone(h.id, todayKey, idx));
    statsEl.textContent = dueToday.length === 0
      ? 'Hoy no toca ninguno'
      : `${doneToday.length} de ${dueToday.length} hoy`;
  }

  if (!active.length) {
    box.innerHTML = `
      <div class="surface rounded-2xl p-12 text-center">
        <div class="w-12 h-12 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="1.5"><path d="M12 2v20M2 12h20"/></svg>
        </div>
        <p class="font-display font-bold text-lg mb-1">Sin hábitos todavía</p>
        <p class="text-neutral-500 text-sm max-w-sm mx-auto">Añade uno y márcalo cada día. La cuadrícula de abajo se irá llenando y la racha se cuenta sola.</p>
      </div>`;
    return;
  }

  box.innerHTML = active.map(h => {
    const done = isHabitDone(h.id, todayKey, idx);
    const dueToday = isScheduled(h, new Date());
    const streak = currentStreak(h, idx);
    const best = bestStreak(h, idx);
    const rate = habitRate(h, 30, idx);

    return `
      <div class="surface rounded-2xl p-5">
        <div class="flex items-start gap-4 mb-4 flex-wrap">
          <button type="button" data-habit-toggle="${h.id}" ${dueToday ? '' : 'disabled'}
            class="habit-check ${done ? 'is-done' : ''} ${dueToday ? '' : 'is-off'} shrink-0"
            title="${dueToday ? (done ? 'Marcado hoy — pulsa para deshacer' : 'Marcar como hecho hoy') : 'Hoy no toca este hábito'}">
            ${done ? '✓' : (h.emoji || '')}
          </button>

          <div class="min-w-0 flex-1">
            <h3 class="font-display font-bold text-lg truncate">${escapeHtml(h.name)}</h3>
            <p class="meta-label text-neutral-500">${(CADENCES[h.cadence] || CADENCES.daily).label}${
              h.cadence === 'custom' ? ' · ' + (h.days || []).map(d => DAY_LETTERS[d]).join(' ') : ''
            }</p>
          </div>

          <div class="flex items-center gap-5 shrink-0">
            <div class="text-center">
              <div class="display text-2xl ${streak > 0 ? 'text-accent' : 'text-neutral-400'}">${streak}</div>
              <div class="meta-label text-neutral-500">racha</div>
            </div>
            <div class="text-center">
              <div class="display text-2xl">${best}</div>
              <div class="meta-label text-neutral-500">mejor</div>
            </div>
            <div class="text-center">
              <div class="display text-2xl">${rate}<span class="text-sm">%</span></div>
              <div class="meta-label text-neutral-500">30 días</div>
            </div>
            <button type="button" data-habit-menu="${h.id}" class="text-neutral-400 hover:text-red-500 text-sm self-start">✕</button>
          </div>
        </div>
        <div class="overflow-x-auto pb-1">${habitHeatmap(h, idx)}</div>
      </div>`;
  }).join('');
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const toggle = e.target.closest('[data-habit-toggle]');
  if (toggle && !toggle.disabled) {
    toggleHabit(toggle.dataset.habitToggle, dateKey(new Date()));
    renderHabits();
    if (typeof renderToday === 'function' && activeView === 'today') renderToday();
    return;
  }

  // Marcar/desmarcar un día pasado desde el mapa de calor: la vida real no
  // siempre deja registrar en el momento.
  const cell = e.target.closest('[data-habit-day]');
  if (cell) {
    const [habitId, key] = cell.dataset.habitDay.split('|');
    const habit = habits.find(h => h.id === habitId);
    if (!habit || !isScheduled(habit, keyToDate(key))) return;
    if (keyToDate(key) > new Date()) return;      // el futuro no se marca
    toggleHabit(habitId, key);
    renderHabits();
    return;
  }

  const del = e.target.closest('[data-habit-menu]');
  if (del) {
    const habit = habits.find(h => h.id === del.dataset.habitMenu);
    if (!habit) return;
    if (!confirm(`¿Borrar el hábito "${habit.name}"? También se borra su historial.`)) return;
    tombstone('habits', habit.id);
    habitLog.filter(e2 => e2.habitId === habit.id).forEach(e2 => tombstone('habitLog', e2.id));
    habits = habits.filter(h => h.id !== habit.id);
    habitLog = habitLog.filter(e2 => e2.habitId !== habit.id);
    saveAll();
    renderHabits();
    toast('Hábito borrado');
  }
});

document.getElementById('add-habit-btn')?.addEventListener('click', () => {
  const m = document.getElementById('habit-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
  m.querySelector('input[name="name"]')?.focus();
});

document.getElementById('habit-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const cadence = fd.get('cadence') || 'daily';
  const days = fd.getAll('days').map(Number);

  if (cadence === 'custom' && !days.length) {
    alert('Elige al menos un día de la semana, o cambia la frecuencia.');
    return;
  }

  habits.push(touch({
    id: uid(),
    name: (fd.get('name') || '').trim() || 'Hábito',
    emoji: (fd.get('emoji') || '').trim().slice(0, 2),
    cadence,
    days,
    archived: false,
    createdAt: Date.now(),
  }));
  saveAll();
  e.target.reset();
  const m = document.getElementById('habit-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  renderHabits();
  toast('Hábito añadido');
});

// Mostrar u ocultar el selector de días según la frecuencia elegida
document.getElementById('habit-form')?.addEventListener('change', e => {
  if (e.target.name !== 'cadence') return;
  document.getElementById('habit-days-row')?.classList.toggle('hidden', e.target.value !== 'custom');
});
