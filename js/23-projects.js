/* ============================================================================
   PROYECTOS — "¿en qué estoy metido y qué está muerto?"
   ============================================================================

   Reemplaza el renderProjects() de js/05-dashboard.js, igual que js/11-notes.js
   reemplaza al renderNotes() original.

   LA PREGUNTA QUE RESPONDE
   Cada vista del panel contesta una sola cosa: Hoy → "¿qué hago ahora?",
   Dropshipping → "¿gano o pierdo?", Estudio → "¿con cuánto paso?". Esta
   contesta "¿en qué estoy metido, y qué dejé morir sin darme cuenta?".

   Abandonar proyectos es normal. Lo que no es normal es no enterarse: tener
   seis cosas abiertas de las que cuatro llevan meses quietas se siente como
   estar ocupado, y en realidad es lo contrario.

   TRES COSAS QUE ARREGLA DEL DISEÑO ANTERIOR

   1. El progreso mentía. Se calculaba como "etapas marcadas ÷ total", así que
      marcar «Desarrollo» cuando llevas el 10% pintaba un 60%. Es la misma clase
      de fallo que el CPA que devolvía cero en Dropshipping: un número creíble y
      falso. Ahora, cuando hay tareas enlazadas, el progreso sale de ellas — un
      dato que no se puede inflar sin cerrar trabajo de verdad.

   2. Las etapas eran una cascada fija (Planificación → Diseño → Desarrollo →
      Pruebas → Entrega) heredada del trabajo por encargo. No encaja con un
      negocio que nunca «entrega» ni con estudiar un idioma. Ahora cada tipo de
      proyecto trae sus propias etapas.

   3. No había estado. Un proyecto abandonado hace tres meses se veía idéntico a
      uno trabajado ayer.
   ============================================================================ */

/* Días sin ninguna señal de vida tras los cuales un proyecto activo se marca
   como dormido. Tres semanas es suficiente para no castigar una semana de
   parciales o unas vacaciones, y poco para que un abandono no pase un mes
   entero disfrazado de proyecto en marcha. */
const PROY_DIAS_DORMIDO = 21;

const PROY_TIPOS = {
  negocio: {
    label: 'Negocio',
    color: '#22c55e',
    etapas: ['Idea', 'Validación', 'Primeros ingresos', 'Escalando'],
    hint: 'Algo que busca generar dinero',
  },
  aprendizaje: {
    label: 'Aprendizaje',
    color: '#a855f7',
    etapas: ['Fundamentos', 'Práctica', 'Proyecto real', 'Dominado'],
    hint: 'Una habilidad que estás construyendo',
  },
  software: {
    label: 'Software',
    color: '#2667ff',
    etapas: ['Planificación', 'Desarrollo', 'Pruebas', 'Publicado'],
    hint: 'Algo que se programa y se despliega',
  },
  personal: {
    label: 'Personal',
    color: '#f59e0b',
    etapas: ['Idea', 'En marcha', 'Terminado'],
    hint: 'Lo que no cabe en las otras tres',
  },
};

const PROY_ESTADOS = {
  activo:     { label: 'Activo',     color: '#2667ff', orden: 0 },
  pausa:      { label: 'En pausa',   color: '#f59e0b', orden: 1 },
  terminado:  { label: 'Terminado',  color: '#22c55e', orden: 2 },
  abandonado: { label: 'Abandonado', color: '#71717a', orden: 3 },
};

const proyUi = { filtro: store.get('proyFiltro', 'todos') };

/* ============ MIGRACIÓN ============ */

/**
 * Pone tipo y estado a los proyectos que vienen del diseño anterior.
 *
 * Las etapas viejas NO se tocan. Reemplazarlas por la plantilla del tipo
 * borraría lo que el usuario ya hubiera marcado, y perder trabajo registrado
 * para que la estructura quede bonita es mal negocio. Conviven: un proyecto
 * viejo conserva sus cinco etapas y los nuevos nacen con las de su tipo.
 */
function migrateProjects() {
  /* OJO: aqui NO se llama a touch(). Parece un olvido y no lo es — touch()
     pone updatedAt a ahora mismo, y proyUltimaActividad() lo usa para decidir
     si un proyecto esta dormido. Tocarlos aqui marcaria TODOS los proyectos
     como recien activos la primera vez que se abre la vista, justo cuando mas
     interesa ver cuales llevan meses quietos.

     Que no se sincronice no importa: la migracion es idempotente y
     determinista, asi que cada dispositivo llega al mismo resultado por su
     cuenta. */
  let cambio = false;
  projects.forEach(p => {
    // 'software' es lo más cercano a la cascada original, que era de encargo.
    if (!p.type) { p.type = 'software'; cambio = true; }
    if (!p.status) { p.status = 'activo'; cambio = true; }
    if (!Array.isArray(p.stages)) {
      p.stages = (PROY_TIPOS[p.type] || PROY_TIPOS.personal).etapas.map(n => ({ name: n, done: false }));
      cambio = true;
    }
  });
  if (cambio) saveAll();
}

/* ============ ACTIVIDAD REAL ============ */

/**
 * Última señal de vida del proyecto, en milisegundos.
 *
 * Mira lo que de verdad cuesta esfuerzo, no lo que se puede teclear en un
 * segundo: una tarea cerrada, una sesión de enfoque registrada. También cuenta
 * `updatedAt` del propio proyecto, que cubre marcar una etapa o editar la
 * ficha — menos esfuerzo, pero sigue siendo tocarlo.
 */
function proyUltimaActividad(p) {
  let t = p.updatedAt || p.createdAt || 0;

  if (typeof tasks !== 'undefined') {
    tasks.forEach(x => {
      if (x.projectId !== p.id) return;
      if (x.completedAt && x.completedAt > t) t = x.completedAt;
      else if (x.updatedAt && x.updatedAt > t) t = x.updatedAt;
    });
  }

  if (typeof sessions !== 'undefined') {
    sessions.forEach(s => {
      if (s.projectId !== p.id) return;
      const ms = s.createdAt || (s.startedAt ? Date.parse(s.startedAt) : 0);
      if (ms > t) t = ms;
    });
  }

  return t;
}

function proyDiasQuieto(p) {
  const t = proyUltimaActividad(p);
  if (!t) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/** Un proyecto activo que lleva demasiado sin señales. */
function proyDormido(p) {
  if (p.status !== 'activo') return false;
  const d = proyDiasQuieto(p);
  return d !== null && d >= PROY_DIAS_DORMIDO;
}

/* ============ PROGRESO HONESTO ============ */

/**
 * Progreso del proyecto, diciendo SIEMPRE de dónde sale el número.
 *
 * Con tareas enlazadas manda el conteo de tareas cerradas: es trabajo real y no
 * se puede inflar sin hacerlo. Sin tareas se cae a las etapas, pero la interfaz
 * lo etiqueta como «por etapas» para que se lea como lo que es — una
 * autoevaluación, no una medición.
 */
function proyProgreso(p) {
  const propias = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.projectId === p.id);
  if (propias.length) {
    const hechas = propias.filter(t => t.status === 'done').length;
    return {
      pct: Math.round((hechas / propias.length) * 100),
      fuente: 'tareas',
      detalle: `${hechas} de ${propias.length} tareas`,
      tareas: propias,
    };
  }
  const et = Array.isArray(p.stages) ? p.stages : [];
  const hechas = et.filter(s => s.done).length;
  return {
    pct: et.length ? Math.round((hechas / et.length) * 100) : 0,
    fuente: 'etapas',
    detalle: `${hechas} de ${et.length} etapas`,
    tareas: [],
  };
}

function proyMinutos(p) {
  if (typeof sessions === 'undefined') return 0;
  return sessions
    .filter(s => s.kind === 'focus' && s.projectId === p.id)
    .reduce((n, s) => n + (s.minutes || 0), 0);
}

/** Portada generada del nombre: cada proyecto se distingue de un vistazo sin
 *  tener que subir una imagen. Determinista — el mismo nombre da el mismo
 *  degradado siempre, así que no cambia de color al recargar. */
function proyPortada(p) {
  let h = 0;
  for (let i = 0; i < p.name.length; i++) h = (h * 31 + p.name.charCodeAt(i)) >>> 0;
  const base = (PROY_TIPOS[p.type] || PROY_TIPOS.personal).color;
  const ang = h % 360;
  return `linear-gradient(135deg, ${base}33 0%, ${base}11 45%, hsl(${ang} 70% 45% / .22) 100%)`;
}

function proyFmtMinutos(m) {
  if (!m) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/* ============ VISTA ============ */

function renderProjects() {
  const box = document.getElementById('projects-list');
  if (!box) return;

  migrateProjects();

  const porEstado = e => projects.filter(p => (p.status || 'activo') === e);
  const dormidos = projects.filter(proyDormido);

  const visibles = (proyUi.filtro === 'todos'
    ? projects.slice()
    : proyUi.filtro === 'dormidos'
      ? dormidos
      : porEstado(proyUi.filtro)
  ).sort((a, b) => {
    const ea = PROY_ESTADOS[a.status || 'activo'].orden;
    const eb = PROY_ESTADOS[b.status || 'activo'].orden;
    if (ea !== eb) return ea - eb;                      // activos primero
    return proyUltimaActividad(b) - proyUltimaActividad(a);  // y lo más vivo arriba
  });

  const filtros = [
    ['todos', 'Todos', projects.length],
    ['activo', 'Activos', porEstado('activo').length],
    ['pausa', 'En pausa', porEstado('pausa').length],
    ['terminado', 'Terminados', porEstado('terminado').length],
    ['abandonado', 'Abandonados', porEstado('abandonado').length],
  ];
  if (dormidos.length) filtros.splice(2, 0, ['dormidos', 'Sin movimiento', dormidos.length]);

  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Activos', String(porEstado('activo').length),
        dormidos.length ? `${dormidos.length} sin movimiento` : 'todos con actividad',
        dormidos.length ? 'text-amber-500' : '')}
      ${statTile('Terminados', String(porEstado('terminado').length), 'cerrados de verdad',
        porEstado('terminado').length ? 'text-green-600 dark:text-green-400' : '')}
      ${statTile('En pausa', String(porEstado('pausa').length), 'parados a propósito')}
      ${statTile('Horas invertidas', proyFmtMinutos(projects.reduce((n, p) => n + proyMinutos(p), 0)) || '—',
        'medidas con el temporizador')}
    </div>

    ${dormidos.length ? `
      <div class="surface rounded-2xl p-6 mb-6" style="border-left:3px solid #f59e0b;">
        <h3 class="font-display font-bold mb-1">${dormidos.length} proyecto${dormidos.length > 1 ? 's' : ''} sin señales de vida</h3>
        <p class="text-neutral-500 text-sm leading-relaxed mb-4 max-w-2xl">
          Siguen marcados como activos pero llevan más de ${PROY_DIAS_DORMIDO} días sin una tarea
          cerrada ni una sesión de enfoque. Dejarlos así hace que parezca que tienes más cosas en
          marcha de las que realmente tienes. Decide: ¿lo retomas, lo pausas, o lo cierras?
        </p>
        <div class="space-y-2">
          ${dormidos.map(p => `
            <div class="surface-soft rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
              <div class="min-w-0 flex-1">
                <div class="font-semibold text-sm truncate">${escapeHtml(p.name)}</div>
                <div class="meta-label text-neutral-500">${proyDiasQuieto(p)} días quieto</div>
              </div>
              <div class="flex gap-1.5 shrink-0">
                <button type="button" data-proy-estado="${p.id}:pausa"
                  class="px-3 py-1.5 rounded-lg surface hover:border-accent mono text-[10px] uppercase tracking-[0.1em]">Pausar</button>
                <button type="button" data-proy-estado="${p.id}:abandonado"
                  class="px-3 py-1.5 rounded-lg surface hover:border-red-500 hover:text-red-500 mono text-[10px] uppercase tracking-[0.1em]">Abandonar</button>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}

    <div class="flex items-center gap-2 flex-wrap mb-5">
      <!-- Se ocultan los filtros vacíos para no llenar la barra de ceros, pero
           el que esté seleccionado se muestra siempre: si no, al vaciarse
           desaparecería su propio botón y no habría forma de ver por qué la
           lista salió en blanco. -->
      ${filtros.filter(([k, , n]) => n > 0 || proyUi.filtro === k).map(([k, l, n]) => `
        <button type="button" data-proy-filtro="${k}"
          class="px-3.5 py-2 rounded-xl text-[10px] font-bold mono uppercase tracking-[0.12em] transition ${
            proyUi.filtro === k ? 'bg-accent text-white' : 'surface-soft text-neutral-500 hover:text-accent'}">
          ${l} <span class="opacity-60">${n}</span>
        </button>`).join('')}
    </div>

    ${visibles.length
      ? `<div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4">${visibles.map(renderProyCard).join('')}</div>`
      : `<div class="surface rounded-2xl p-12 text-center">
           <p class="font-display font-bold text-lg mb-1">${projects.length ? 'Nada con este filtro' : 'Sin proyectos todavía'}</p>
           <p class="text-neutral-500 text-sm max-w-md mx-auto leading-relaxed">
             ${projects.length
               ? 'Prueba con otro filtro.'
               : 'Un proyecto es cualquier cosa en la que estés metido más de una semana: un negocio, una habilidad que estás construyendo, algo que programas. Las tareas y las sesiones de enfoque que le enlaces alimentan su progreso.'}
           </p>
         </div>`}`;
}

function renderProyCard(p) {
  const tipo = PROY_TIPOS[p.type] || PROY_TIPOS.personal;
  const est = PROY_ESTADOS[p.status || 'activo'];
  const prog = proyProgreso(p);
  const mins = proyMinutos(p);
  const quieto = proyDiasQuieto(p);
  const dormido = proyDormido(p);
  const cerrado = p.status === 'terminado' || p.status === 'abandonado';

  // Vencimiento: sólo tiene sentido avisar en lo que sigue vivo.
  let venc = null;
  if (p.deadline && !cerrado) {
    const d = new Date(p.deadline);
    if (!isNaN(d.getTime())) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const dd = new Date(d); dd.setHours(0, 0, 0, 0);
      const n = Math.round((dd - hoy) / 86400000);
      venc = n < 0 ? { txt: `Venció hace ${Math.abs(n)} d`, tono: 'text-red-500' }
           : n === 0 ? { txt: 'Vence hoy', tono: 'text-red-500' }
           : n <= 7 ? { txt: `En ${n} días`, tono: 'text-amber-500' }
           : { txt: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), tono: 'text-neutral-500' };
    }
  }

  return `
    <div class="surface rounded-2xl overflow-hidden flex flex-col ${cerrado ? 'opacity-60' : ''}">
      <div class="h-20 relative" style="background:${proyPortada(p)}">
        <div class="absolute top-3 left-3 flex items-center gap-1.5">
          <span class="mono text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg backdrop-blur"
            style="background:${tipo.color}26;color:${tipo.color}">${tipo.label}</span>
          ${dormido ? `<span class="mono text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg bg-amber-500/20 text-amber-500">Sin movimiento</span>` : ''}
        </div>
        <div class="absolute top-3 right-3 flex items-center gap-1">
          <select data-proy-estado-sel="${p.id}" aria-label="Estado del proyecto"
            class="surface rounded-lg px-2 py-1 text-[10px] mono focus:border-accent focus:outline-none">
            ${Object.entries(PROY_ESTADOS).map(([k, v]) =>
              `<option value="${k}" ${(p.status || 'activo') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <button type="button" data-del-project="${p.id}" aria-label="Borrar proyecto"
            class="w-7 h-7 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
        </div>
      </div>

      <div class="p-5 flex-1 flex flex-col">
        <h3 class="font-display font-bold text-lg leading-tight truncate">${escapeHtml(p.name)}</h3>
        ${p.client ? `<div class="meta-label text-neutral-500 mt-0.5 truncate">para ${escapeHtml(p.client)}</div>` : ''}
        ${p.desc ? `<p class="text-neutral-500 text-xs mt-2 leading-relaxed line-clamp-2">${escapeHtml(p.desc)}</p>` : ''}

        <div class="mt-4">
          <div class="flex items-baseline justify-between mb-1.5 gap-2">
            <span class="meta-label text-neutral-500">${prog.detalle}</span>
            <span class="mono text-xs font-semibold" style="color:${est.color}">${prog.pct}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
            <div class="h-full rounded-full transition-all" style="width:${prog.pct}%;background:${est.color}"></div>
          </div>
          ${prog.fuente === 'etapas'
            ? `<p class="text-[10px] text-neutral-400 mt-1.5 leading-snug">
                 Calculado por etapas — lo que tú marcas. Enlázale tareas y pasa a medirse con trabajo cerrado.
               </p>` : ''}
        </div>

        <!-- Cada dato con su etiqueta: sin ellas "1 h 35 min" y "hoy" quedaban
             pegados y se leian como una sola frase sin sentido. -->
        <div class="flex items-center gap-4 flex-wrap mt-4 pt-3 border-t border-neutral-100 dark:border-white/5">
          ${venc ? `<span class="meta-label ${venc.tono}">⚑ ${venc.txt}</span>` : ''}
          ${mins ? `<span class="meta-label text-neutral-500">◷ ${proyFmtMinutos(mins)} dedicadas</span>` : ''}
          ${quieto !== null && !cerrado
            ? `<span class="meta-label ${dormido ? 'text-amber-500' : 'text-neutral-500'}">${
                quieto === 0 ? '● activo hoy' : `● visto hace ${quieto} d`}</span>` : ''}
        </div>

        <div class="flex gap-1.5 mt-3">
          ${(p.stages || []).map((s, i) => `
            <button type="button" data-toggle-stage="${p.id}:${i}" title="${escapeHtml(s.name)}"
              class="flex-1 py-1.5 rounded-lg text-[9px] mono uppercase tracking-wider truncate px-1 transition ${
                s.done ? 'text-white' : 'surface-soft text-neutral-500 hover:text-accent'}"
              style="${s.done ? `background:${tipo.color}` : ''}">${escapeHtml(s.name)}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const f = e.target.closest('[data-proy-filtro]');
  if (f) {
    proyUi.filtro = f.dataset.proyFiltro;
    store.set('proyFiltro', proyUi.filtro);
    renderProjects();
    return;
  }

  /* Etapas y borrado.
     Van aquí y por delegación a propósito: antes sus manejadores se enganchaban
     elemento por elemento DENTRO del renderProjects() de 05-dashboard.js, y al
     reemplazar esa función se quedaron sin dueño — los botones seguían
     pintándose pero no hacían nada, sin ningún error en consola. */
  const et = e.target.closest('[data-toggle-stage]');
  if (et) {
    const [pid, idx] = et.dataset.toggleStage.split(':');
    const p = projects.find(x => x.id === pid);
    if (!p || !p.stages || !p.stages[+idx]) return;
    p.stages[+idx].done = !p.stages[+idx].done;
    touch(p); saveAll(); renderProjects();
    return;
  }

  const del = e.target.closest('[data-del-project]');
  if (del) {
    const p = projects.find(x => x.id === del.dataset.delProject);
    if (!p) return;
    const n = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.projectId === p.id).length;
    const aviso = n ? `\n\nTiene ${n} tarea${n > 1 ? 's' : ''} enlazada${n > 1 ? 's' : ''}; se quedan sin proyecto pero no se borran.` : '';
    if (!confirm(`¿Borrar "${p.name}"?${aviso}`)) return;
    tombstone('projects', p.id);
    projects = projects.filter(x => x.id !== p.id);
    saveAll(); renderProjects(); toast('Proyecto borrado');
    return;
  }

  const btn = e.target.closest('[data-proy-estado]');
  if (btn) {
    const [id, estado] = btn.dataset.proyEstado.split(':');
    const p = projects.find(x => x.id === id);
    if (!p) return;
    p.status = estado;
    touch(p); saveAll(); renderProjects();
    toast(`${p.name}: ${PROY_ESTADOS[estado].label.toLowerCase()}`);
  }
});

document.addEventListener('change', e => {
  const sel = e.target.closest('[data-proy-estado-sel]');
  if (!sel) return;
  const p = projects.find(x => x.id === sel.dataset.proyEstadoSel);
  if (!p) return;
  p.status = sel.value;
  touch(p); saveAll(); renderProjects();
});
