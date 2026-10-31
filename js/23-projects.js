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

const proyUi = {
  filtro: store.get('proyFiltro', 'todos'),
  vista: store.get('proyVista', 'grid'),   // 'grid' | 'lista'
  busca: '',                               // no se guarda: es de esta sesion
  notasAbiertas: new Set(),                // que fichas tienen los apuntes desplegados
};

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

/* ============ APUNTES ============ */

/**
 * Etiqueta con la que un apunte de Mi cerebro queda enganchado a este proyecto.
 *
 * Se reutiliza subjectSlug() de js/22-study.js (que carga antes) en vez de
 * escribir otro generador: dos copias acabarian separandose, y el dia que una
 * produjera "agencia-ia" y la otra "agencia-de-ia", los apuntes dejarian de
 * aparecer SIN dar ningun error — solo una lista vacia que parece que no has
 * escrito nada. El nombre dice "subject" por donde nacio, pero es un
 * generador de slugs normal y corriente.
 *
 * OJO al efecto buscado: un proyecto y una materia que se llamen igual
 * comparten etiqueta, asi que el apunte sale en los dos sitios. Eso es
 * deseable — si el apunte es de ciberseguridad, lo es para la materia y para
 * el proyecto — pero conviene saberlo.
 *
 * LIMITACION CONOCIDA: la etiqueta sale del NOMBRE, asi que renombrar un
 * proyecto desengancha todos sus apuntes de golpe y en silencio. Hoy no
 * muerde porque no hay forma de renombrar un proyecto en la interfaz. Quien
 * añada esa opcion tiene que reetiquetar los apuntes en la misma operacion
 * (buscar '#' + tag viejo en notes y sustituirlo), o preguntar al usuario:
 * perder los apuntes de un proyecto por cambiarle una palabra al nombre seria
 * el peor momento posible para descubrir esto.
 */
function proyTag(p) {
  if (typeof subjectSlug !== 'function') return '';
  return subjectSlug(p && p.name);
}

/** Apuntes de Mi cerebro etiquetados con este proyecto.
 *
 *  El cuerpo de una nota esta en `content`, NO en `body`. Buscar en `body` no
 *  lanza nada: devuelve cero apuntes siempre. Ya paso una vez en Estudio. */
function notasDeProyecto(p) {
  const tag = proyTag(p);
  if (!tag || typeof notes === 'undefined') return [];
  /* tieneEtiqueta() y no includes(): este ultimo se traga cualquier etiqueta
     que empiece igual, y #agencia-ia-vieja acababa contando como apunte del
     proyecto «Agencia IA». Ver js/22-study.js, donde vive el comparador. */
  return notes.filter(n => {
    if (n.archived) return false;
    return tieneEtiqueta((n.title || '') + ' ' + (n.content || ''), tag);
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Abre un apunte en la vista de Notas.
 *
 *  No hay un openNote() global: el patron del proyecto es fijar
 *  notesUi.selectedId y cambiar de vista, que es lo que hacen el grafo y la
 *  paleta de comandos. commitNoteEdits() primero, o se pierde lo que estuviera
 *  a medio escribir en el editor. */
function proyIrANota(id) {
  if (typeof notesUi === 'undefined') return;
  if (typeof commitNoteEdits === 'function') commitNoteEdits();
  notesUi.selectedId = id;
  notesUi.showArchived = false;
  notesUi.tagFilter = null;
  showView('notes');
}

/** Crea un apunte YA etiquetado y lo abre.
 *
 *  Existe para que no haya que acordarse de la etiqueta: tener que recordar
 *  escribir #agencia-de-ia es justo la friccion que hace que nadie use esto.
 *  La etiqueta va en el cuerpo, no en el titulo, para que el titulo quede
 *  limpio al listarlo. */
function proyCrearNota(p) {
  if (typeof createNote !== 'function') return;
  const tag = proyTag(p);
  const nota = createNote({
    title: 'Apunte de ' + p.name,
    content: '#' + tag + '\n\n',
  });
  if (nota) proyIrANota(nota.id);
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

/**
 * Convierte una fecha guardada en el panel a un Date en hora LOCAL.
 *
 * Hace falta porque `new Date('2026-11-05')` NO da el 5 de noviembre aquí: el
 * estándar manda interpretar las cadenas de sólo fecha como medianoche UTC, que
 * en Colombia (UTC−5) son las 19:00 del día 4. El resultado es que toda entrega
 * se mostraba un día antes de lo que escribiste — un fallo que no lanza nada y
 * sólo se ve comparando la ficha con lo que tecleaste.
 *
 * Se fija a MEDIODÍA, no a medianoche, por lo mismo que en el calendario del
 * ITM: a las 00:00 una entrega "del 5" aparece vencida durante todo el día 5, y
 * además el mediodía sobrevive a cualquier salto de horario.
 *
 * Los `due` de las tareas vienen de un <input datetime-local> ("2026-11-05T14:30"),
 * que el estándar sí interpreta como hora local, así que esos pasan tal cual.
 */
function proyFecha(valor) {
  if (!valor) return null;
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  const d = soloFecha
    ? new Date(+soloFecha[1], +soloFecha[2] - 1, +soloFecha[3], 12, 0, 0)
    : new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

function proyFmtMinutos(m) {
  if (!m) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/* ============ VISTA ============ */

/** Hitos que vienen: la fecha de entrega del proyecto y las de sus tareas
 *  abiertas, en una sola lista ordenada. Mezclarlas es el punto — lo que te
 *  cae encima la semana que viene no distingue entre un tipo y otro. */
function proyHitos(limite) {
  const out = [];

  projects.forEach(p => {
    if (p.status === 'terminado' || p.status === 'abandonado') return;
    const d = proyFecha(p.deadline);
    if (d) out.push({ ms: d.getTime(), titulo: p.name, sub: 'Entrega del proyecto', proy: p, fuerte: true });
  });

  (typeof tasks !== 'undefined' ? tasks : []).forEach(t => {
    if (t.status === 'done' || !t.due || !t.projectId) return;
    const p = projects.find(x => x.id === t.projectId);
    if (!p || p.status === 'terminado' || p.status === 'abandonado') return;
    const d = proyFecha(t.due);
    if (d) out.push({ ms: d.getTime(), titulo: t.title, sub: p.name, proy: p, fuerte: false });
  });

  return out.sort((a, b) => a.ms - b.ms).slice(0, limite || 6);
}

/** Mini calendario del mes en curso, con un punto en los días que tienen hito. */
function proyCalendario() {
  const hoy = new Date();
  const anio = hoy.getFullYear(), mes = hoy.getMonth();
  const dias = new Date(anio, mes + 1, 0).getDate();
  // getDay() da 0=domingo; aquí la semana empieza en lunes.
  const hueco = (new Date(anio, mes, 1).getDay() + 6) % 7;

  const conHito = new Set();
  proyHitos(60).forEach(h => {
    const d = new Date(h.ms);
    if (d.getFullYear() === anio && d.getMonth() === mes) conHito.add(d.getDate());
  });

  let celdas = '';
  for (let i = 0; i < hueco; i++) celdas += '<div></div>';
  for (let d = 1; d <= dias; d++) {
    const esHoy = d === hoy.getDate();
    celdas += '<div class="proy-cal-dia ' + (esHoy ? 'hoy' : 'text-neutral-500') +
              (conHito.has(d) ? ' tiene' : '') + '">' + d + '</div>';
  }

  return `
    <div class="surface rounded-2xl p-4">
      <div class="flex items-baseline justify-between mb-3">
        <h3 class="font-display font-bold text-sm capitalize">${hoy.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</h3>
        <span class="meta-label text-neutral-500">${conHito.size} con entrega</span>
      </div>
      <div class="proy-cal mb-1">
        ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<div class="text-center meta-label text-neutral-500 text-[9px]">${d}</div>`).join('')}
      </div>
      <div class="proy-cal">${celdas}</div>
    </div>`;
}

/** Panel lateral: resumen, calendario, hitos y lo que más avanza. */
function renderProyAside() {
  const caja = document.getElementById('proy-aside');
  if (!caja) return;

  const porEstado = e => projects.filter(p => (p.status || 'activo') === e);
  const total = projects.length || 1;
  const pct = n => Math.round((n / total) * 100);

  const mini = (etiqueta, n, color) => `
    <div class="surface-soft rounded-xl p-3">
      <div class="meta-label text-neutral-500">${etiqueta}</div>
      <div class="flex items-baseline justify-between gap-2 mt-1">
        <span class="font-display font-bold text-2xl">${n}</span>
        <span class="mono text-[10px] text-neutral-500">${projects.length ? pct(n) + '%' : '—'}</span>
      </div>
      <div class="h-1 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden mt-2">
        <div class="h-full rounded-full" style="width:${pct(n)}%;background:${color}"></div>
      </div>
    </div>`;

  const hitos = proyHitos(5);
  const ahora = Date.now();

  /* Lo que más avanza es la cara amable de la vista: el aviso de arriba señala
     lo que va mal, esto recuerda lo que va bien. Sin algo así, abrir Proyectos
     sería siempre una regañina. */
  const destacados = porEstado('activo')
    .map(p => ({ p, prog: proyProgreso(p) }))
    .filter(x => x.prog.pct > 0)
    .sort((a, b) => b.prog.pct - a.prog.pct)
    .slice(0, 3);

  caja.innerHTML = `
    <div class="surface rounded-2xl p-4">
      <h3 class="font-display font-bold text-sm mb-3">Resumen general</h3>
      <div class="grid grid-cols-2 gap-2.5">
        ${mini('Activos', porEstado('activo').length, '#2667ff')}
        ${mini('Terminados', porEstado('terminado').length, '#22c55e')}
        ${mini('En pausa', porEstado('pausa').length, '#f59e0b')}
        ${mini('Abandonados', porEstado('abandonado').length, '#71717a')}
      </div>
    </div>

    ${proyCalendario()}

    <div class="surface rounded-2xl p-4">
      <h3 class="font-display font-bold text-sm mb-3">Próximos hitos</h3>
      ${hitos.length ? `<div class="space-y-2.5">${hitos.map(h => {
        const dias = Math.ceil((h.ms - ahora) / 86400000);
        const tono = dias < 0 ? 'text-red-500' : dias <= 3 ? 'text-amber-500' : 'text-neutral-500';
        const cuando = dias < 0 ? Math.abs(dias) + ' d tarde' : dias === 0 ? 'hoy' : 'en ' + dias + ' d';
        return `
          <div class="flex items-start gap-2.5">
            <span class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
              style="background:${(PROY_TIPOS[h.proy.type] || PROY_TIPOS.personal).color}"></span>
            <div class="min-w-0 flex-1">
              <div class="text-xs truncate ${h.fuerte ? 'font-semibold' : ''}">${escapeHtml(h.titulo)}</div>
              <div class="meta-label text-neutral-500 truncate">${escapeHtml(h.sub)}</div>
            </div>
            <span class="meta-label ${tono} shrink-0">${cuando}</span>
          </div>`;
      }).join('')}</div>`
        : `<p class="text-neutral-500 text-xs leading-relaxed">
             Nada con fecha. Ponle una entrega a un proyecto, o una fecha a sus tareas,
             y lo que venga aparece aquí.
           </p>`}
    </div>

    ${destacados.length ? `
      <div class="surface rounded-2xl p-4">
        <h3 class="font-display font-bold text-sm mb-3">Lo que más avanza</h3>
        <div class="space-y-3">
          ${destacados.map(({ p, prog }) => `
            <div>
              <div class="flex items-baseline justify-between gap-2 mb-1.5">
                <span class="text-xs font-semibold truncate">${escapeHtml(p.name)}</span>
                <span class="mono text-[10px] text-accent shrink-0">${prog.pct}%</span>
              </div>
              <div class="h-1 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
                <div class="h-full rounded-full" style="width:${prog.pct}%;background:${(PROY_TIPOS[p.type] || PROY_TIPOS.personal).color}"></div>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
}

function renderProjects() {
  const box = document.getElementById('projects-list');
  if (!box) return;

  migrateProjects();

  const porEstado = e => projects.filter(p => (p.status || 'activo') === e);
  const dormidos = projects.filter(proyDormido);

  // Resumen de una línea dentro de la banda superior.
  const hs = document.getElementById('proy-hero-stat');
  if (hs) {
    hs.innerHTML = projects.length ? `
      <div class="flex gap-6">
        <div><div class="font-display font-bold text-3xl text-white">${porEstado('activo').length}</div>
             <div class="meta-label text-white/50">activos</div></div>
        <div><div class="font-display font-bold text-3xl ${dormidos.length ? 'text-amber-400' : 'text-white'}">${dormidos.length}</div>
             <div class="meta-label text-white/50">sin mover</div></div>
        <div><div class="font-display font-bold text-3xl text-white">${proyFmtMinutos(projects.reduce((n, p) => n + proyMinutos(p), 0)) || '—'}</div>
             <div class="meta-label text-white/50">dedicadas</div></div>
      </div>` : '';
  }

  const q = proyUi.busca.trim().toLowerCase();
  const visibles = (proyUi.filtro === 'todos'
    ? projects.slice()
    : proyUi.filtro === 'dormidos'
      ? dormidos
      : porEstado(proyUi.filtro)
  ).filter(p => !q || (p.name + ' ' + (p.desc || '') + ' ' + (p.client || '')).toLowerCase().includes(q)
  ).sort((a, b) => {
    const ea = PROY_ESTADOS[a.status || 'activo'].orden;
    const eb = PROY_ESTADOS[b.status || 'activo'].orden;
    if (ea !== eb) return ea - eb;                           // activos primero
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
    ${dormidos.length ? `
      <div class="surface rounded-2xl p-5 mb-4" style="border-left:3px solid #f59e0b;">
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

    <div class="flex items-center gap-2 flex-wrap mb-4">
      <!-- Los filtros vacíos se ocultan para no llenar la barra de ceros, pero el
           seleccionado se muestra siempre: si no, al vaciarse desaparecería su
           propio botón y no habría forma de ver por qué la lista salió en blanco. -->
      ${filtros.filter(([k, , n]) => n > 0 || proyUi.filtro === k).map(([k, l, n]) => `
        <button type="button" data-proy-filtro="${k}"
          class="px-3.5 py-2 rounded-xl text-[10px] font-bold mono uppercase tracking-[0.12em] transition ${
            proyUi.filtro === k ? 'bg-accent text-white' : 'surface-soft text-neutral-500 hover:text-accent'}">
          ${l} <span class="opacity-60">${n}</span>
        </button>`).join('')}

      <div class="flex-1"></div>

      ${projects.length > 3 ? `
        <input id="proy-busca" type="search" placeholder="Buscar…" value="${escapeHtml(proyUi.busca)}"
          class="surface-soft rounded-xl px-3 py-2 text-xs w-36 focus:w-48 focus:border-accent focus:outline-none transition-all" />` : ''}

      <div class="flex gap-1">
        ${[['grid', '▦'], ['lista', '☰']].map(([v, ic]) => `
          <button type="button" data-proy-vista="${v}" aria-label="Vista ${v}"
            class="w-8 h-8 rounded-lg grid place-items-center text-xs transition ${
              proyUi.vista === v ? 'bg-accent text-white' : 'surface-soft text-neutral-500 hover:text-accent'}">${ic}</button>`).join('')}
      </div>
    </div>

    ${visibles.length
      ? `<div class="${proyUi.vista === 'lista' ? 'proy-lista' : 'proy-grid'}">${visibles.map(renderProyCard).join('')}</div>`
      : `<div class="surface rounded-2xl p-12 text-center">
           <p class="font-display font-bold text-lg mb-1">${
             q ? 'Nada coincide con eso' : projects.length ? 'Nada con este filtro' : 'Sin proyectos todavía'}</p>
           <p class="text-neutral-500 text-sm max-w-md mx-auto leading-relaxed">
             ${q ? 'Prueba con otra palabra.'
                 : projects.length ? 'Prueba con otro filtro.'
                 : 'Un proyecto es cualquier cosa en la que estés metido más de una semana: un negocio, una habilidad que estás construyendo, algo que programas. Las tareas y las sesiones de enfoque que le enlaces alimentan su progreso.'}
           </p>
         </div>`}`;

  renderProyAside();
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
    const d = proyFecha(p.deadline);
    if (d) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const dd = new Date(d); dd.setHours(0, 0, 0, 0);
      const n = Math.round((dd - hoy) / 86400000);
      venc = n < 0 ? { txt: 'Venció hace ' + Math.abs(n) + ' d', tono: 'text-red-500' }
           : n === 0 ? { txt: 'Vence hoy', tono: 'text-red-500' }
           : n <= 7 ? { txt: 'En ' + n + ' días', tono: 'text-amber-500' }
           : { txt: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), tono: 'text-neutral-500' };
    }
  }

  return `
    <div class="surface rounded-2xl overflow-hidden proy-card ${cerrado ? 'opacity-60' : ''}">
      <div class="proy-portada h-20 relative" style="background:${proyPortada(p)}">
        <div class="absolute top-3 left-3 flex items-center gap-1.5">
          <span class="mono text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg"
            style="background:${tipo.color}26;color:${tipo.color}">${tipo.label}</span>
          ${dormido ? '<span class="mono text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg bg-amber-500/20 text-amber-500">Sin movimiento</span>' : ''}
        </div>
        <div class="absolute top-3 right-3 flex items-center gap-1">
          <select data-proy-estado-sel="${p.id}" aria-label="Estado del proyecto"
            class="surface rounded-lg px-2 py-1 text-[10px] mono focus:border-accent focus:outline-none">
            ${Object.entries(PROY_ESTADOS).map(([k, v]) =>
              `<option value="${k}" ${(p.status || 'activo') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <button type="button" data-edit-project="${p.id}" aria-label="Editar proyecto" title="Editar"
            class="w-7 h-7 rounded-lg text-neutral-400 hover:text-accent hover:bg-accent/10 transition">✎</button>
          <button type="button" data-del-project="${p.id}" aria-label="Borrar proyecto"
            class="w-7 h-7 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
        </div>
      </div>

      <div class="proy-cuerpo p-5 flex-1 flex flex-col">
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
             pegados y se leían como una sola frase sin sentido. -->
        <div class="flex items-center gap-4 flex-wrap mt-4 pt-3 border-t border-neutral-100 dark:border-white/5">
          ${venc ? `<span class="meta-label ${venc.tono}">⚑ ${venc.txt}</span>` : ''}
          ${mins ? `<span class="meta-label text-neutral-500">◷ ${proyFmtMinutos(mins)} dedicadas</span>` : ''}
          ${quieto !== null && !cerrado
            ? `<span class="meta-label ${dormido ? 'text-amber-500' : 'text-neutral-500'}">${
                quieto === 0 ? '● activo hoy' : '● visto hace ' + quieto + ' d'}</span>` : ''}
        </div>

        ${proyBloqueNotas(p)}

        <div class="proy-etapas flex gap-1.5 mt-3">
          ${(p.stages || []).map((s, i) => `
            <button type="button" data-toggle-stage="${p.id}:${i}" title="${escapeHtml(s.name)}"
              class="flex-1 py-1.5 rounded-lg text-[9px] mono uppercase tracking-wider truncate px-1 transition ${
                s.done ? 'text-white' : 'surface-soft text-neutral-500 hover:text-accent'}"
              style="${s.done ? 'background:' + tipo.color : ''}">${escapeHtml(s.name)}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

/** Fila de apuntes de la ficha, desplegable.
 *
 *  Va plegada por defecto porque la ficha ya esta cargada de informacion; lo
 *  que importa de un vistazo es CUANTOS hay, no cuales. */
function proyBloqueNotas(p) {
  const tag = proyTag(p);
  if (!tag) return '';
  const ns = notasDeProyecto(p);
  const abierta = proyUi.notasAbiertas.has(p.id);

  return `
    <div class="mt-3 pt-3 border-t border-neutral-100 dark:border-white/5">
      <div class="flex items-center gap-2">
        <button type="button" data-proy-notas="${p.id}"
          class="meta-label ${ns.length ? 'text-accent' : 'text-neutral-500'} hover:text-accent transition flex items-center gap-1">
          <span>${abierta ? '▾' : '▸'}</span>
          ${ns.length ? ns.length + ' apunte' + (ns.length > 1 ? 's' : '') : 'Sin apuntes'}
        </button>
        <div class="flex-1"></div>
        <button type="button" data-proy-nueva-nota="${p.id}"
          class="meta-label text-neutral-500 hover:text-accent transition">+ apunte</button>
      </div>

      ${abierta ? `
        <div class="mt-2.5 space-y-1.5">
          ${ns.length ? ns.slice(0, 6).map(n => `
            <button type="button" data-proy-abrir-nota="${n.id}"
              class="w-full text-left surface-soft rounded-lg px-3 py-2 hover:border-accent transition">
              <div class="text-xs truncate">${escapeHtml(n.title || 'Sin título')}</div>
              <div class="meta-label text-neutral-500">${typeof relativeTime === 'function' ? relativeTime(n.updatedAt) : ''}</div>
            </button>`).join('')
            : `<p class="text-[11px] text-neutral-500 leading-relaxed">
                 Etiqueta cualquier nota con <span class="mono text-neutral-400">#${tag}</span>
                 y aparece aquí. O pulsa «+ apunte» y se crea ya etiquetada.
               </p>`}
          ${ns.length > 6 ? `<div class="meta-label text-neutral-500 px-1">y ${ns.length - 6} más</div>` : ''}
        </div>` : ''}
    </div>`;
}

/* ============ CREAR Y EDITAR ============ */

/** Proyecto que se esta editando, o null si el modal esta creando uno nuevo. */
let proyEditando = null;

function proyModal() { return document.getElementById('project-modal'); }

/** Abre el modal. Sin argumento crea; con un proyecto, lo edita. */
function abrirModalProyecto(p) {
  const modal = proyModal();
  const form = document.getElementById('project-form');
  if (!modal || !form) return;

  proyEditando = p ? p.id : null;
  form.reset();

  if (p) {
    form.name.value = p.name || '';
    form.type.value = p.type || 'personal';
    form.client.value = p.client || '';
    form.desc.value = p.desc || '';
    form.deadline.value = p.deadline || '';
  }

  const titulo = modal.querySelector('h3');
  if (titulo) titulo.textContent = p ? 'Editar proyecto' : 'Nuevo proyecto';
  const enviar = form.querySelector('button[type=submit]');
  if (enviar) enviar.textContent = p ? 'Guardar' : 'Crear';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  form.name.focus();
}

function cerrarModalProyecto() {
  const modal = proyModal();
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
  proyEditando = null;
}

/**
 * Reetiqueta los apuntes cuando un proyecto cambia de nombre.
 *
 * Esto es la deuda que dejo anotada el commit anterior y que editar hace
 * vencer: la etiqueta sale del nombre, asi que renombrar "Agencia de IA" a
 * "Agencia IA" convierte #agencia-de-ia en #agencia-ia y TODOS los apuntes
 * dejan de aparecer. En silencio, sin error, y lo descubririas semanas despues
 * buscando algo que escribiste.
 *
 * Se PREGUNTA en vez de hacerlo solo porque reescribir el contenido de las
 * notas del usuario no es una consecuencia obvia de corregirle una palabra al
 * nombre de un proyecto. Pero se avisa de lo que pasa si dice que no.
 */
function proyReetiquetar(tagViejo, tagNuevo) {
  if (!tagViejo || !tagNuevo || tagViejo === tagNuevo) return 0;
  if (typeof notes === 'undefined') return 0;

  const afectadas = notes.filter(n => tieneEtiqueta((n.title || '') + ' ' + (n.content || ''), tagViejo));
  if (!afectadas.length) return 0;

  const seguir = confirm(
    afectadas.length + ' apunte' + (afectadas.length > 1 ? 's están etiquetados' : ' está etiquetado') +
    ' con #' + tagViejo + '.\n\n¿Reetiquetar' + (afectadas.length > 1 ? 'los' : 'lo') + ' como #' + tagNuevo + '?\n\n' +
    'Si dices que no, dejará' + (afectadas.length > 1 ? 'n' : '') + ' de aparecer en este proyecto.');
  if (!seguir) return 0;

  /* El mismo limite que tieneEtiqueta, en global: `\b` NO servia porque en una
     etiqueta con guiones casa dentro de #agencia-de-ia-vieja y la renombraba
     tambien. Lo cazo la prueba justo con ese caso. */
  const re = new RegExp(etiquetaRegex(tagViejo).source, 'gi');
  afectadas.forEach(n => {
    if (n.title) n.title = n.title.replace(re, '#' + tagNuevo);
    if (n.content) n.content = n.content.replace(re, '#' + tagNuevo);
    touch(n);
  });
  if (typeof invalidateNotesIndex === 'function') invalidateNotesIndex();
  return afectadas.length;
}

/**
 * Decide las etapas cuando cambia el tipo del proyecto.
 *
 * Si no hay ninguna marcada, se cambian sin preguntar: no se pierde nada. Si
 * hay trabajo registrado encima, se pregunta — tirar lo que ya marcaste para
 * que la estructura quede ordenada es mal negocio, y es justo la razon por la
 * que migrateProjects() tampoco toca las etapas viejas.
 *
 * Devuelve {etapas, tipo}: si el usuario dice que no, se revierte tambien el
 * tipo, porque un proyecto de "negocio" con las etapas de "aprendizaje" seria
 * incoherente de leer.
 */
function proyEtapasAlCambiarTipo(p, tipoNuevo) {
  const plantilla = (PROY_TIPOS[tipoNuevo] || PROY_TIPOS.personal).etapas;
  const marcadas = (p.stages || []).filter(s => s.done).length;

  if (!marcadas) {
    return { etapas: plantilla.map(n => ({ name: n, done: false })), tipo: tipoNuevo };
  }

  const ok = confirm(
    'Cambiar el tipo reemplaza las etapas por las de «' + (PROY_TIPOS[tipoNuevo] || PROY_TIPOS.personal).label + '».\n\n' +
    'Perderías ' + marcadas + ' etapa' + (marcadas > 1 ? 's marcadas' : ' marcada') + '.\n\n¿Seguir?');

  return ok
    ? { etapas: plantilla.map(n => ({ name: n, done: false })), tipo: tipoNuevo }
    : { etapas: p.stages, tipo: p.type };
}

document.addEventListener('submit', e => {
  const form = e.target.closest('#project-form');
  if (!form) return;
  e.preventDefault();

  const fd = new FormData(form);
  const nombre = (fd.get('name') || '').trim();
  if (!nombre) return;
  const tipoPedido = fd.get('type') || 'personal';

  if (proyEditando) {
    const p = projects.find(x => x.id === proyEditando);
    if (!p) { cerrarModalProyecto(); return; }

    // El nombre primero: si cambia, hay que ofrecer mover los apuntes ANTES de
    // tocarlo, porque la etiqueta vieja se calcula del nombre viejo.
    let movidos = 0;
    if (nombre !== p.name) {
      movidos = proyReetiquetar(proyTag(p), proyTag({ name: nombre }));
    }

    let etapas = p.stages, tipo = p.type;
    if (tipoPedido !== p.type) {
      const r = proyEtapasAlCambiarTipo(p, tipoPedido);
      etapas = r.etapas; tipo = r.tipo;
    }

    p.name = nombre;
    p.type = tipo;
    p.stages = etapas;
    p.client = fd.get('client') || '';
    p.desc = fd.get('desc') || '';
    p.deadline = fd.get('deadline') || '';
    touch(p);
    saveAll();
    cerrarModalProyecto();
    renderProjects();
    toast(movidos ? 'Guardado · ' + movidos + ' apunte' + (movidos > 1 ? 's movidos' : ' movido') : 'Proyecto guardado');
    return;
  }

  /* Alta. Las etapas salen del TIPO, no de una lista fija: un negocio no tiene
     las mismas fases que una habilidad que estas aprendiendo. STAGES (de
     05-dashboard.js) queda de reserva por si PROY_TIPOS no estuviera. */
  const plantilla = (typeof PROY_TIPOS !== 'undefined' && PROY_TIPOS[tipoPedido])
    ? PROY_TIPOS[tipoPedido].etapas
    : (typeof STAGES !== 'undefined' ? STAGES : ['Idea', 'En marcha', 'Terminado']);

  projects.push(touch({
    id: uid(),
    name: nombre,
    type: tipoPedido,
    status: 'activo',
    client: fd.get('client') || '',
    desc: fd.get('desc') || '',
    deadline: fd.get('deadline') || '',
    stages: plantilla.map(n => ({ name: n, done: false })),
    createdAt: Date.now(),
  }));
  saveAll();
  cerrarModalProyecto();
  renderProjects();
});

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const f = e.target.closest('[data-proy-filtro]');
  if (f) {
    proyUi.filtro = f.dataset.proyFiltro;
    store.set('proyFiltro', proyUi.filtro);
    renderProjects();
    return;
  }

  const v = e.target.closest('[data-proy-vista]');
  if (v) {
    proyUi.vista = v.dataset.proyVista;
    store.set('proyVista', proyUi.vista);
    renderProjects();
    return;
  }

  /* Las acciones de la banda llevan a sitios que EXISTEN. Un botón decorativo
     que no va a ninguna parte es peor que no tenerlo: se prueba una vez, no
     pasa nada, y a partir de ahí se desconfía de toda la fila. */
  const ac = e.target.closest('[data-proy-accion]');
  if (ac) {
    const a = ac.dataset.proyAccion;
    if (a === 'enfoque' && typeof openFocusPicker === 'function') openFocusPicker();
    else if (a === 'tareas') showView('tasks');
    else if (a === 'metricas') showView('insights');
    return;
  }

  if (e.target.closest('#add-project-btn')) { abrirModalProyecto(null); return; }

  const ed = e.target.closest('[data-edit-project]');
  if (ed) {
    const p = projects.find(x => x.id === ed.dataset.editProject);
    if (p) abrirModalProyecto(p);
    return;
  }

  // Cerrar con Cancelar o la X deja el modal en modo "crear" para la proxima.
  if (e.target.closest('#project-modal [data-close-modal]')) { proyEditando = null; return; }

  const tn = e.target.closest('[data-proy-notas]');
  if (tn) {
    const id = tn.dataset.proyNotas;
    if (proyUi.notasAbiertas.has(id)) proyUi.notasAbiertas.delete(id);
    else proyUi.notasAbiertas.add(id);
    renderProjects();
    return;
  }

  const nn = e.target.closest('[data-proy-nueva-nota]');
  if (nn) {
    const p = projects.find(x => x.id === nn.dataset.proyNuevaNota);
    if (p) proyCrearNota(p);
    return;
  }

  const an = e.target.closest('[data-proy-abrir-nota]');
  if (an) { proyIrANota(an.dataset.proyAbrirNota); return; }

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
    const aviso = n ? '\n\nTiene ' + n + ' tarea' + (n > 1 ? 's' : '') + ' enlazada' + (n > 1 ? 's' : '') +
                      '; se quedan sin proyecto pero no se borran.' : '';
    if (!confirm('¿Borrar "' + p.name + '"?' + aviso)) return;
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
    toast(p.name + ': ' + PROY_ESTADOS[estado].label.toLowerCase());
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

/* La búsqueda repinta en cada tecla, así que hay que devolver el foco y el
   cursor al campo: sin esto, escribir la segunda letra sería imposible. */
document.addEventListener('input', e => {
  const b = e.target.closest('#proy-busca');
  if (!b) return;
  proyUi.busca = b.value;
  renderProjects();
  const nuevo = document.getElementById('proy-busca');
  if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
});
