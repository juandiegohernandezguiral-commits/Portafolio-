/* ============================================================================
   CALENDARIO — todo lo que tiene fecha, en un solo sitio
   ============================================================================

   Reemplaza el renderEvents() de js/05-dashboard.js, que pintaba una lista
   plana de `events` ordenada por fecha. Eso no era un calendario y, sobre
   todo, sólo mostraba los eventos: las tareas con vencimiento, las entregas
   del ITM, las fechas de los proyectos y los hábitos del día vivían cada uno
   en su vista y no se cruzaban nunca.

   Ese cruce es el motivo de que esta vista exista. Saber que el martes tienes
   un parcial NO sirve de nada si en otra pestaña hay una entrega de proyecto
   el mismo martes y en una tercera tres tareas vencidas. El valor no está en
   ver un mes bonito, está en ver los choques antes de que ocurran.

   CARGA LA ÚLTIMA porque lee de casi todos los módulos: proyFecha() del 23,
   los studyItems del 22, los hábitos del 13.
   ============================================================================ */

const CAL_FUENTES = {
  evento:   { label: 'Eventos',   color: '#2667ff', icono: '●' },
  tarea:    { label: 'Tareas',    color: '#f59e0b', icono: '☑' },
  estudio:  { label: 'ITM',       color: '#a855f7', icono: '▣' },
  proyecto: { label: 'Proyectos', color: '#22c55e', icono: '◆' },
  habito:   { label: 'Hábitos',   color: '#06b6d4', icono: '◇' },
};

const calUi = {
  mes: null,                                   // Date del primer día del mes visible
  diaSel: null,                                // 'YYYY-MM-DD' del día abierto
  ocultas: new Set(store.get('calOcultas', [])),
};

/* ---- fechas: clave local, nunca UTC ----
   Toda la vista trabaja con claves 'YYYY-MM-DD' en hora LOCAL. Derivarlas con
   toISOString().slice(0,10) daría el día en UTC, y en Colombia (UTC−5) todo lo
   de después de las 19:00 aparecería en la casilla del día siguiente — justo
   las horas en las que uno planifica el día. Es el mismo fallo que ya mordió
   en el calendario del ITM y en las entregas de Proyectos. */
function calClave(d) {
  if (!d) return null;
  const f = d instanceof Date ? d : new Date(d);
  if (isNaN(f.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${p(f.getMonth() + 1)}-${p(f.getDate())}`;
}

function calHoy() { return calClave(new Date()); }

/** Convierte un valor guardado a Date local. Reutiliza proyFecha() cuando
 *  está, que ya resuelve el caso de las cadenas de sólo fecha. */
function calFecha(v) {
  if (typeof proyFecha === 'function') return proyFecha(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ---- recolección ---- */

/**
 * Todo lo que cae en un rango de fechas, de todas las fuentes.
 *
 * Devuelve objetos uniformes para que la vista no tenga que saber de dónde
 * viene cada cosa: { clave, hora, titulo, fuente, color, hecho, ref }.
 */
function calItems(desde, hasta) {
  const out = [];
  const dentro = d => d && d >= desde && d <= hasta;
  const push = (fecha, o) => {
    const k = calClave(fecha);
    if (!dentro(k)) return;
    out.push(Object.assign({ clave: k, hora: fecha.getHours() * 60 + fecha.getMinutes() }, o));
  };

  (typeof events !== 'undefined' ? events : []).forEach(e => {
    const d = calFecha(e.date);
    if (d) push(d, { titulo: e.title, fuente: 'evento', hecho: false, ref: { tipo: 'evento', id: e.id } });
  });

  (typeof tasks !== 'undefined' ? tasks : []).forEach(t => {
    if (!t.due) return;
    const d = calFecha(t.due);
    if (d) push(d, { titulo: t.title, fuente: 'tarea', hecho: t.status === 'done', ref: { tipo: 'tarea', id: t.id } });
  });

  (typeof studyItems !== 'undefined' ? studyItems : []).forEach(it => {
    if (!it.due) return;
    const d = calFecha(it.due);
    if (!d) return;
    const materia = (typeof subjectById === 'function' && subjectById(it.subjectId)) || null;
    push(d, {
      titulo: it.title, fuente: 'estudio', hecho: !!it.done,
      sub: materia ? materia.name : (it.kind || ''),
      ref: { tipo: 'estudio', id: it.id },
    });
  });

  (typeof projects !== 'undefined' ? projects : []).forEach(p => {
    if (!p.deadline || p.status === 'terminado' || p.status === 'abandonado') return;
    const d = calFecha(p.deadline);
    if (d) push(d, { titulo: 'Entrega: ' + p.name, fuente: 'proyecto', hecho: false, ref: { tipo: 'proyecto', id: p.id } });
  });

  /* Los hábitos no tienen fecha guardada: se derivan de su cadencia. Se
     generan sólo para el rango visible — generarlos "para siempre" sería
     infinito, y guardarlos como registros los convertiría en datos que hay que
     sincronizar y limpiar. */
  /* Se calcula una sola vez: recorrer habitLog entero por cada dia de cada
     habito seria cuadratico sin ninguna razon. */
  const idxHabitos = typeof habitLogIndex === 'function' ? habitLogIndex() : null;
  (typeof habits !== 'undefined' ? habits : []).forEach(h => {
    const d0 = new Date(desde + 'T12:00:00');
    const d1 = new Date(hasta + 'T12:00:00');
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
      if (!calHabitoToca(h, d)) continue;
      const k = calClave(d);
      /* isHabitDone() y no leer habitLog a mano: el campo se llama `date`, no
         `day`, y habitLogIndex() devuelve un Map de Sets, no un objeto plano.
         La primera version se inventó las dos cosas y habría dado SIEMPRE «no
         hecho», sin lanzar ningún error — se vería como hábitos que nunca se
         marcan aunque los marques en su propia vista. */
      const hecho = typeof isHabitDone === 'function' ? isHabitDone(h.id, k, idxHabitos) : false;
      out.push({ clave: k, hora: 24 * 60 + 1, titulo: h.name, fuente: 'habito', hecho,
                 ref: { tipo: 'habito', id: h.id, dia: k } });
    }
  });

  return out.sort((a, b) => a.clave.localeCompare(b.clave) || a.hora - b.hora);
}

/** ¿Toca este hábito en esta fecha? Replica la cadencia de js/13-habits.js. */
function calHabitoToca(h, d) {
  const dow = d.getDay();
  if (h.cadence === 'weekdays') return dow >= 1 && dow <= 5;
  if (h.cadence === 'custom') return Array.isArray(h.days) && h.days.includes(dow);
  return true;   // 'daily' y cualquier cosa que no se reconozca
}

function calVisible(it) { return !calUi.ocultas.has(it.fuente); }

/* ---- vista ---- */

function calMesActual() {
  if (!calUi.mes) {
    const h = new Date();
    calUi.mes = new Date(h.getFullYear(), h.getMonth(), 1);
  }
  return calUi.mes;
}

function renderEvents() {
  const caja = document.getElementById('events-list');
  if (!caja) return;

  const mes = calMesActual();
  const anio = mes.getFullYear(), m = mes.getMonth();
  const dias = new Date(anio, m + 1, 0).getDate();
  // La semana empieza en lunes; getDay() da 0=domingo.
  const hueco = (new Date(anio, m, 1).getDay() + 6) % 7;

  const primero = calClave(new Date(anio, m, 1));
  const ultimo = calClave(new Date(anio, m, dias));
  const todos = calItems(primero, ultimo);
  const items = todos.filter(calVisible);

  const porDia = new Map();
  items.forEach(it => {
    if (!porDia.has(it.clave)) porDia.set(it.clave, []);
    porDia.get(it.clave).push(it);
  });

  const hoy = calHoy();
  if (!calUi.diaSel || !calUi.diaSel.startsWith(`${anio}-`)) {
    calUi.diaSel = (hoy >= primero && hoy <= ultimo) ? hoy : primero;
  }

  // ---- celdas ----
  let celdas = '';
  for (let i = 0; i < hueco; i++) celdas += '<div class="cal-dia cal-vacio"></div>';
  for (let d = 1; d <= dias; d++) {
    const k = calClave(new Date(anio, m, d));
    const delDia = porDia.get(k) || [];
    const pendientes = delDia.filter(x => !x.hecho);
    const esHoy = k === hoy;
    const sel = k === calUi.diaSel;
    const pasado = k < hoy;

    celdas += `
      <button type="button" data-cal-dia="${k}"
        class="cal-dia ${esHoy ? 'es-hoy' : ''} ${sel ? 'es-sel' : ''} ${pasado ? 'es-pasado' : ''}">
        <span class="cal-num">${d}</span>
        <span class="cal-marcas">
          ${delDia.slice(0, 4).map(x => `<i style="background:${CAL_FUENTES[x.fuente].color};${x.hecho ? 'opacity:.3' : ''}"></i>`).join('')}
          ${delDia.length > 4 ? `<i class="cal-mas">+</i>` : ''}
        </span>
        ${pendientes.length >= 3 ? `<span class="cal-carga" title="${pendientes.length} cosas pendientes"></span>` : ''}
      </button>`;
  }

  const delSel = (porDia.get(calUi.diaSel) || []);
  const fechaSel = new Date(calUi.diaSel + 'T12:00:00');

  caja.innerHTML = `
    <div class="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
      <div class="min-w-0">
        <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div class="flex items-center gap-2">
            <button type="button" data-cal-mover="-1" aria-label="Mes anterior"
              class="w-8 h-8 rounded-lg surface-soft hover:border-accent transition">‹</button>
            <h3 class="font-display font-bold text-lg capitalize min-w-[9rem] text-center">
              ${mes.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
            </h3>
            <button type="button" data-cal-mover="1" aria-label="Mes siguiente"
              class="w-8 h-8 rounded-lg surface-soft hover:border-accent transition">›</button>
            <button type="button" data-cal-hoy
              class="ml-1 px-3 py-1.5 rounded-lg surface-soft hover:border-accent transition mono text-[10px] uppercase tracking-[0.1em]">Hoy</button>
          </div>
          <div class="flex gap-1.5 flex-wrap">
            ${Object.entries(CAL_FUENTES).map(([k, f]) => {
              const n = todos.filter(x => x.fuente === k).length;
              const off = calUi.ocultas.has(k);
              return `
                <button type="button" data-cal-fuente="${k}" title="${f.label}"
                  class="px-2.5 py-1.5 rounded-lg mono text-[10px] uppercase tracking-[0.08em] transition surface-soft ${off ? 'opacity-40' : ''}"
                  style="${off ? '' : 'color:' + f.color}">
                  ${f.label} ${n ? `<span class="opacity-60">${n}</span>` : ''}
                </button>`;
            }).join('')}
          </div>
        </div>

        <div class="cal-cabecera">
          ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
            .map(d => `<span>${d}</span>`).join('')}
        </div>
        <div class="cal-rejilla">${celdas}</div>
      </div>

      <aside class="surface rounded-2xl p-5">
        <div class="mb-4">
          <div class="meta-label text-neutral-500">${calUi.diaSel === hoy ? 'Hoy' : fechaSel.toLocaleDateString('es-CO', { weekday: 'long' })}</div>
          <h3 class="font-display font-bold text-xl capitalize">
            ${fechaSel.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
          </h3>
        </div>

        <form data-cal-alta class="flex gap-2 mb-4">
          <input name="titulo" placeholder="Añadir algo este día" autocomplete="off"
            class="flex-1 min-w-0 surface-soft rounded-xl px-3 py-2.5 text-sm focus:border-accent focus:outline-none" />
          <button type="submit" class="px-3 py-2.5 rounded-xl bg-accent text-white mono text-[10px] uppercase tracking-[0.1em] shrink-0">+</button>
        </form>

        ${delSel.length ? `<div class="space-y-1.5">${delSel.map(calFilaItem).join('')}</div>` : `
          <p class="text-neutral-500 text-xs leading-relaxed">
            Nada este día. Escribe arriba para añadir un evento, o ponle fecha a una tarea
            desde Tareas y aparece aquí.
          </p>`}

        ${delSel.filter(x => !x.hecho).length >= 4 ? `
          <p class="text-amber-500 text-[11px] leading-relaxed mt-4 pt-3 border-t border-neutral-100 dark:border-white/5">
            ${delSel.filter(x => !x.hecho).length} cosas pendientes este día. Si no caben,
            mejor mover algo ahora que descubrirlo esa mañana.
          </p>` : ''}
      </aside>
    </div>`;
}

function calFilaItem(it) {
  const f = CAL_FUENTES[it.fuente];
  const marcable = it.fuente === 'tarea' || it.fuente === 'estudio' || it.fuente === 'habito';
  const hora = it.hora < 24 * 60
    ? `${String(Math.floor(it.hora / 60)).padStart(2, '0')}:${String(it.hora % 60).padStart(2, '0')}`
    : '';

  return `
    <div class="surface-soft rounded-xl px-3 py-2.5 flex items-center gap-2.5 ${it.hecho ? 'opacity-50' : ''}">
      ${marcable
        ? `<button type="button" data-cal-check="${it.ref.tipo}:${it.ref.id}${it.ref.dia ? ':' + it.ref.dia : ''}"
             aria-label="Marcar"
             class="w-4 h-4 rounded-full border shrink-0 transition ${it.hecho ? 'border-transparent' : 'border-neutral-400 hover:border-accent'}"
             style="${it.hecho ? 'background:' + f.color : ''}"></button>`
        : `<span class="w-2 h-2 rounded-full shrink-0" style="background:${f.color}"></span>`}
      <button type="button" data-cal-ir="${it.ref.tipo}:${it.ref.id}" class="min-w-0 flex-1 text-left">
        <div class="text-xs truncate ${it.hecho ? 'line-through' : ''}">${escapeHtml(it.titulo)}</div>
        <div class="meta-label text-neutral-500 truncate">
          ${hora ? hora + ' · ' : ''}${escapeHtml(it.sub || f.label)}
        </div>
      </button>
      ${it.ref.tipo === 'evento'
        ? `<button type="button" data-cal-borrar="${it.ref.id}" aria-label="Borrar evento"
             class="meta-label text-neutral-500 hover:text-red-500 transition shrink-0">✕</button>` : ''}
    </div>`;
}

/* ---- eventos ---- */

document.addEventListener('click', e => {
  const mov = e.target.closest('[data-cal-mover]');
  if (mov) {
    const m = calMesActual();
    calUi.mes = new Date(m.getFullYear(), m.getMonth() + Number(mov.dataset.calMover), 1);
    calUi.diaSel = null;
    renderEvents();
    return;
  }

  if (e.target.closest('[data-cal-hoy]')) {
    const h = new Date();
    calUi.mes = new Date(h.getFullYear(), h.getMonth(), 1);
    calUi.diaSel = calHoy();
    renderEvents();
    return;
  }

  const dia = e.target.closest('[data-cal-dia]');
  if (dia) { calUi.diaSel = dia.dataset.calDia; renderEvents(); return; }

  const fte = e.target.closest('[data-cal-fuente]');
  if (fte) {
    const k = fte.dataset.calFuente;
    if (calUi.ocultas.has(k)) calUi.ocultas.delete(k); else calUi.ocultas.add(k);
    store.set('calOcultas', [...calUi.ocultas]);
    renderEvents();
    return;
  }

  /* Marcar como hecho desde el calendario. Es la mitad de "organizar el día":
     si sólo se pudiera mirar, habría que ir a otra vista para tachar cada
     cosa, y entonces no se usa para planificar. */
  const chk = e.target.closest('[data-cal-check]');
  if (chk) {
    const [tipo, id, dia2] = chk.dataset.calCheck.split(':');
    if (tipo === 'tarea') {
      const t = tasks.find(x => x.id === id);
      if (!t) return;
      t.status = t.status === 'done' ? 'todo' : 'done';
      if (typeof markTaskCompletion === 'function') markTaskCompletion(t);
      touch(t);
    } else if (tipo === 'estudio') {
      const it = studyItems.find(x => x.id === id);
      if (!it) return;
      it.done = !it.done;
      touch(it);
    } else if (tipo === 'habito' && typeof toggleHabit === 'function') {
      toggleHabit(id, dia2);
    }
    saveAll(); renderEvents();
    return;
  }

  const borrar = e.target.closest('[data-cal-borrar]');
  if (borrar) {
    const ev = events.find(x => x.id === borrar.dataset.calBorrar);
    if (!ev) return;
    if (!confirm(`¿Borrar "${ev.title}"?`)) return;
    tombstone('events', ev.id);
    events = events.filter(x => x.id !== ev.id);
    saveAll(); renderEvents();
    return;
  }

  /* Ir al origen. El calendario muestra cosas que VIVEN en otras vistas, así
     que tiene que poder llevarte allí: editar una tarea desde aquí sería
     duplicar media interfaz de Tareas. */
  const ir = e.target.closest('[data-cal-ir]');
  if (ir) {
    const [tipo, id] = ir.dataset.calIr.split(':');
    if (tipo === 'tarea') { showView('tasks'); if (typeof flashHighlight === 'function') flashHighlight(`[data-task-id="${id}"]`); }
    else if (tipo === 'estudio') { showView('study'); if (typeof showStudyTab === 'function') showStudyTab('uni'); }
    else if (tipo === 'proyecto') {
      if (typeof proyUi !== 'undefined') proyUi.abierto = id;
      showView('projects');
    } else if (tipo === 'habito') showView('habits');
    return;
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-cal-alta]');
  if (!form) return;
  e.preventDefault();
  const titulo = (form.titulo.value || '').trim();
  if (!titulo) return;

  /* Se crea a las 9:00 del día seleccionado y no a medianoche: un evento a las
     00:00 se lee como "ayer por la noche" y además sale el primero de la lista
     por encima de cosas que sí tienen hora. */
  events.push(touch({
    id: uid(), title: titulo,
    date: `${calUi.diaSel}T09:00`,
    createdAt: Date.now(),
  }));
  saveAll();
  renderEvents();
  const nuevo = document.querySelector('[data-cal-alta] [name=titulo]');
  if (nuevo) nuevo.focus();
});
