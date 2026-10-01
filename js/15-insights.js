/* 15-insights.js — métricas: qué dicen tus datos sobre ti.

   Hasta aquí el panel registraba (tareas, hábitos, sesiones). Esto lo lee en
   agregado, que es la única escala a la que la constancia y la dispersión se
   ven. Sin librerías de gráficas: SVG generado, igual que el mapa de calor.

   Reglas de visualización aplicadas (y por qué, para no deshacerlas sin querer):
     · UN eje por gráfica. Nunca dos escalas en el mismo marco.
     · Serie única → color de marca, sin leyenda: el título ya dice qué es.
     · Varias categorías (proyectos) → paleta categórica de orden FIJO, nunca
       ciclada, y validada para daltonismo. En claro, tres de sus tonos quedan
       por debajo de 3:1 contra el blanco, así que esas barras llevan etiqueta
       directa visible — la identidad nunca depende sólo del color.
     · Extremos de las barras redondeados 4px y ancladas a la línea base.
     · Hover con tooltip en toda marca.
     · Rejilla y ejes recesivos; los números van en tinta de texto, no en el
       color de la serie. */

/* NO hay paleta categórica aquí, y es deliberado.
   Las cuatro gráficas miden UNA sola cosa cada una (tareas, minutos, minutos,
   porcentaje) repartida entre categorías nominales: proyectos, hábitos, días.
   Nominal + una medida = todas las barras del MISMO color.

   Pintar cada proyecto de un tono distinto parece más rico, pero gasta el canal
   de identidad reescribiendo lo que la longitud de la barra ya dice, y además
   insinúa una pertenencia a serie que no existe — el nombre está en la etiqueta
   de al lado. Una paleta de ocho tonos sólo haría falta si hubiera varias
   series dentro del mismo marco, y no es el caso.

   Los colores se resuelven en JS y no por CSS porque van incrustados en el SVG
   generado (ver el MutationObserver del final, que lo repinta al cambiar tema). */
function vizIsDark() { return document.documentElement.classList.contains('dark'); }
function vizInk() {
  return vizIsDark()
    ? { muted: '#8a8a90', grid: 'rgba(255,255,255,0.07)', axis: 'rgba(255,255,255,0.15)', accent: '#3987e5' }
    : { muted: '#8e8e95', grid: 'rgba(0,0,0,0.06)',       axis: 'rgba(0,0,0,0.14)',       accent: '#2667ff' };
}

/* ============ AGREGACIONES ============ */

/** Lunes de la semana a la que pertenece una fecha. */
function startOfWeek(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay();
  out.setDate(out.getDate() - (day === 0 ? 6 : day - 1)); // lunes como primer día
  return out;
}

/** Tareas completadas por semana, las últimas `weeks` semanas. */
function tasksDoneByWeek(weeks = 12) {
  const buckets = [];
  const cursor = startOfWeek(new Date());
  cursor.setDate(cursor.getDate() - (weeks - 1) * 7);
  for (let i = 0; i < weeks; i++) {
    buckets.push({ start: new Date(cursor), label: `${cursor.getDate()}/${cursor.getMonth() + 1}`, value: 0 });
    cursor.setDate(cursor.getDate() + 7);
  }
  tasks.forEach(t => {
    if (t.status !== 'done') return;
    // completedAt es el sello real; updatedAt es el respaldo para las tareas
    // anteriores a que ese campo existiera.
    const when = t.completedAt || t.updatedAt;
    if (!when) return;
    const ws = startOfWeek(new Date(when)).getTime();
    const bucket = buckets.find(b => b.start.getTime() === ws);
    if (bucket) bucket.value++;
  });
  return buckets;
}

/** Minutos enfocados por día, los últimos `days` días. */
function focusByDay(days = 30) {
  const buckets = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    buckets.push({ key: dateKey(cursor), label: `${cursor.getDate()}/${cursor.getMonth() + 1}`, value: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  const byKey = new Map(buckets.map(b => [b.key, b]));
  sessions.forEach(s => {
    if (s.kind !== 'focus') return;
    const bucket = byKey.get(sessionDay(s));
    if (bucket) bucket.value += s.minutes || 0;
  });
  return buckets;
}

/** Minutos por proyecto en los últimos `days` días, de mayor a menor. */
function focusByProject(days = 90) {
  const since = Date.now() - days * 86400000;
  const totals = minutesByProject(since);
  const rows = [];
  totals.forEach((minutes, key) => {
    if (!minutes) return;
    const project = projects.find(p => p.id === key);
    rows.push({ id: key, label: project ? project.name : 'Sin proyecto', value: minutes });
  });
  return rows.sort((a, b) => b.value - a.value);
}

/* ============ GRÁFICAS ============ */

function vizEmpty(message) {
  return `<div class="py-12 text-center text-neutral-500 text-sm">${escapeHtml(message)}</div>`;
}

/**
 * Barras verticales, serie única. `width` llega medido del contenedor: generar
 * el SVG a los píxeles reales evita escalar el texto con viewBox, que es lo que
 * hace que las etiquetas salgan gigantes en pantallas anchas.
 */
function barChart(buckets, { width, height = 170, format = v => v, everyNthLabel = 1 }) {
  if (!buckets.some(b => b.value > 0)) return vizEmpty('Todavía no hay datos que mostrar aquí.');

  const ink = vizInk();
  const padL = 34, padR = 6, padB = 20, padT = 10;
  const plotW = Math.max(width - padL - padR, 40);
  const plotH = height - padT - padB;
  const max = Math.max(...buckets.map(b => b.value), 1);
  // Techo "redondo" para que las marcas del eje sean números legibles.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step || 1;

  const slot = plotW / buckets.length;
  const barW = Math.max(Math.min(slot - 4, 28), 3);

  const gridLines = [0, 0.5, 1].map(f => {
    const y = padT + plotH * (1 - f);
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="${f === 0 ? ink.axis : ink.grid}" stroke-width="1" />
            <text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="viz-tick">${format(Math.round(top * f))}</text>`;
  }).join('');

  const bars = buckets.map((b, i) => {
    const h = top > 0 ? (b.value / top) * plotH : 0;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + plotH - h;
    const label = i % everyNthLabel === 0 || i === buckets.length - 1
      ? `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="viz-tick">${b.label}</text>`
      : '';
    // Altura mínima de 2px en los valores > 0: una barra de 0.3px es invisible y
    // "poco" se confundiría con "nada".
    const drawH = b.value > 0 ? Math.max(h, 2) : 0;
    return `${label}
      <rect x="${x}" y="${padT + plotH - drawH}" width="${barW}" height="${drawH}" rx="${Math.min(4, barW / 2)}"
            fill="${ink.accent}" class="viz-bar"
            data-viz-tip="${escapeHtml(b.label)} · ${escapeHtml(String(format(b.value)))}"></rect>`;
  }).join('');

  return `<svg width="${width}" height="${height}" class="viz-svg" role="img">${gridLines}${bars}</svg>`;
}

/** Barras horizontales por categoría nominal, con etiqueta y valor directos. */
function hBarChart(rows, { width, format = v => v, emptyMessage = 'Todavía no hay datos.' }) {
  if (!rows.length) return vizEmpty(emptyMessage);

  const ink = vizInk();
  const max = Math.max(...rows.map(r => r.value), 1);
  const ROW_H = 34, BAR_H = 10;
  const labelW = Math.min(Math.max(width * 0.3, 90), 200);
  const valueW = 58;
  const plotW = Math.max(width - labelW - valueW - 12, 40);

  /* Tope de diez filas y el resto agrupado en "Otros": no es un límite de
     colores (son todos iguales), sino de lectura — una lista de treinta barras
     deja de ser una gráfica y pasa a ser una tabla mal hecha. */
  const shown = rows.slice(0, 10);
  const rest = rows.slice(10);
  if (rest.length) {
    shown.push({ id: '__otros__', label: `Otros (${rest.length})`, value: rest.reduce((n, r) => n + r.value, 0) });
  }

  const height = shown.length * ROW_H + 8;

  const bars = shown.map((r, i) => {
    const y = i * ROW_H + 10;
    const w = Math.max((r.value / max) * plotW, 3);
    // "Otros" no es una categoría real, es un resto: va en gris para que no
    // compita visualmente con las que sí se pueden accionar.
    const color = r.id === '__otros__' ? ink.muted : ink.accent;
    return `
      <text x="0" y="${y + BAR_H}" class="viz-row-label">${escapeHtml(r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label)}</text>
      <rect x="${labelW}" y="${y + 1}" width="${w}" height="${BAR_H}" rx="4" fill="${color}" class="viz-bar"
            data-viz-tip="${escapeHtml(r.label)} · ${escapeHtml(String(format(r.value)))}"></rect>
      <text x="${labelW + w + 8}" y="${y + BAR_H}" class="viz-row-value">${escapeHtml(String(format(r.value)))}</text>`;
  }).join('');

  return `<svg width="${width}" height="${height}" class="viz-svg" role="img">${bars}</svg>`;
}

/* ============ FICHAS DE CIFRA ============ */

function statTile(label, value, unit, sub) {
  return `
    <div class="surface rounded-2xl p-5">
      <div class="meta-label text-neutral-500 mb-2">${escapeHtml(label)}</div>
      <div class="display text-4xl">${escapeHtml(String(value))}${unit ? `<span class="text-lg text-neutral-500 ml-0.5">${escapeHtml(unit)}</span>` : ''}</div>
      ${sub ? `<div class="text-xs text-neutral-500 mt-1">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function formatMinutes(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ============ VISTA ============ */

function renderInsights() {
  const root = document.getElementById('insights-root');
  if (!root) return;

  // Ancho real del contenedor: las gráficas se generan a píxeles, no escaladas.
  const width = Math.max(root.clientWidth || 720, 320);

  // --- Fichas ---
  const weekStart = startOfWeek(new Date()).getTime();
  const doneThisWeek = tasks.filter(t => t.status === 'done' && (t.completedAt || t.updatedAt || 0) >= weekStart).length;
  const minutesThisWeek = sessions
    .filter(s => s.kind === 'focus' && new Date(s.startedAt).getTime() >= weekStart)
    .reduce((n, s) => n + (s.minutes || 0), 0);

  const logIdx = typeof habitLogIndex === 'function' ? habitLogIndex() : null;
  const activeHabits = habits.filter(h => !h.archived);
  const topStreak = logIdx && activeHabits.length
    ? Math.max(...activeHabits.map(h => currentStreak(h, logIdx)))
    : 0;
  const openTasks = tasks.filter(t => t.status !== 'done').length;

  const tiles = [
    statTile('Enfocado esta semana', formatMinutes(minutesThisWeek), '', `${sessions.filter(s => new Date(s.startedAt).getTime() >= weekStart).length} sesiones`),
    statTile('Completadas esta semana', doneThisWeek, '', `${openTasks} abiertas ahora`),
    statTile('Mejor racha activa', topStreak, topStreak === 1 ? 'día' : 'días', activeHabits.length ? `${activeHabits.length} hábitos` : 'sin hábitos'),
    statTile('Notas', notes.filter(n => !n.archived).length, '', `${notes.filter(n => n.daily).length} diarias`),
  ].join('');

  // --- Hábitos: constancia a 30 días ---
  const habitRows = activeHabits
    .map(h => ({ id: h.id, label: h.name, value: habitRate(h, 30, logIdx) }))
    .sort((a, b) => b.value - a.value);

  const chartCard = (title, hint, body) => `
    <div class="surface rounded-2xl p-6">
      <div class="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h3 class="font-display font-bold">${escapeHtml(title)}</h3>
        <span class="meta-label text-neutral-500">${escapeHtml(hint)}</span>
      </div>
      ${body}
    </div>`;

  root.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">${tiles}</div>
    <div class="space-y-4">
      ${chartCard('Tareas completadas por semana', 'últimas 12 semanas',
        barChart(tasksDoneByWeek(12), { width: width - 48, everyNthLabel: 2 }))}
      ${chartCard('Minutos enfocados por día', 'últimos 30 días',
        barChart(focusByDay(30), { width: width - 48, everyNthLabel: 5, format: v => v }))}
      ${chartCard('Tiempo por proyecto', 'últimos 90 días',
        hBarChart(focusByProject(90), {
          width: width - 48, format: formatMinutes,
          emptyMessage: 'Aún no has registrado tiempo en ningún proyecto. Inicia una sesión de enfoque sobre una tarea que pertenezca a uno.',
        }))}
      ${chartCard('Constancia de hábitos', 'cumplimiento a 30 días',
        hBarChart(habitRows, {
          width: width - 48, format: v => v + '%',
          emptyMessage: 'Sin hábitos activos todavía.',
        }))}
    </div>`;
}

/* ============ TOOLTIP ============
   Una sola capa compartida en vez de un nodo por marca: con 30 barras diarias y
   12 semanales serían decenas de nodos permanentes en el DOM para algo que sólo
   se ve de uno en uno. */

let vizTipEl = null;

function ensureVizTip() {
  if (vizTipEl && document.body.contains(vizTipEl)) return vizTipEl;
  vizTipEl = document.createElement('div');
  vizTipEl.className = 'viz-tip';
  document.body.appendChild(vizTipEl);
  return vizTipEl;
}

document.addEventListener('mouseover', e => {
  const mark = e.target.closest('[data-viz-tip]');
  if (!mark) return;
  const tip = ensureVizTip();
  tip.textContent = mark.dataset.vizTip;
  tip.classList.add('visible');
  const r = mark.getBoundingClientRect();
  tip.style.left = `${r.left + r.width / 2}px`;
  tip.style.top = `${r.top - 8}px`;
});

document.addEventListener('mouseout', e => {
  if (e.target.closest('[data-viz-tip]') && vizTipEl) vizTipEl.classList.remove('visible');
});

/* Las gráficas se generan al ancho medido, así que un cambio de tamaño las deja
   desajustadas hasta que se repintan. */
let vizResizeTimer = null;
window.addEventListener('resize', () => {
  if (activeView !== 'insights') return;
  clearTimeout(vizResizeTimer);
  vizResizeTimer = setTimeout(renderInsights, 180);
});

/* El tema cambia los colores de las gráficas, que están embebidos en el SVG
   generado — hay que volver a generarlo, no basta con el CSS. */
new MutationObserver(() => {
  if (activeView === 'insights') renderInsights();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
