/* ============================================================================
   ESTUDIO — Universidad (ITM) y Desarrollo de Software
   ============================================================================

   Dos subpestañas. La de Universidad es la que tiene contenido: qué hay que
   hacer, qué parciales vienen, cómo van las notas y dónde están los apuntes.

   DE DÓNDE SALEN LAS COSAS
   Hay tres caminos de entrada y los tres acaban en `studyItems`:
     1. El Campus Virtual del ITM, por el calendario iCal de Moodle. Automático.
     2. Foto o voz, interpretadas por IA. Semiautomático: la IA rellena el
        formulario y tú confirmas.
     3. A mano, que siempre tiene que seguir existiendo.

   Un item es una unidad de evaluación: empieza como pendiente, pasa a entregado
   y termina con nota. No se separan "tareas" de "notas" en dos colecciones
   porque son el mismo objeto en dos momentos de su vida, y separarlos obligaría
   a escribir el parcial dos veces.
   ============================================================================ */

/* Escala colombiana: 0.0 a 5.0, se aprueba con 3.0. Están aquí arriba y no
   enterradas en un `if` porque si algún día cambia la reglamentación, o si esto
   se usa para otra universidad, es lo único que habría que tocar. */
const NOTA_MAX = 5.0;
const NOTA_APRUEBA = 3.0;

const STUDY_KINDS = {
  tarea:      { label: 'Tarea',      icon: '✎', peso: 'media' },
  parcial:    { label: 'Parcial',    icon: '◆', peso: 'alta'  },
  quiz:       { label: 'Quiz',       icon: '○', peso: 'baja'  },
  proyecto:   { label: 'Proyecto',   icon: '▣', peso: 'alta'  },
  exposicion: { label: 'Exposición', icon: '▲', peso: 'media' },
  otro:       { label: 'Otro',       icon: '•', peso: 'baja'  },
};

/* Los parciales y proyectos se destacan aparte: son los que no se pueden
   recuperar si se te pasan. */
const KINDS_IMPORTANTES = ['parcial', 'proyecto'];

const studyUi = {
  tab: store.get('studyTab', 'uni'),
  filtroMateria: 'todas',
};

/* ============ AYUDAS ============ */

function subjectById(id) { return studySubjects.find(s => s.id === id) || null; }

/** Slug estable de una materia, para la etiqueta de sus apuntes. */
function subjectSlug(nombre) {
  return (nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Fecha de un item como objeto Date, o null. */
function itemDue(it) {
  if (!it.due) return null;
  const d = new Date(it.due);
  return isNaN(d.getTime()) ? null : d;
}

/** Días que faltan (negativo si ya pasó). null si no tiene fecha. */
function diasPara(it) {
  const d = itemDue(it);
  if (!d) return null;
  // Se compara a medianoche para que "hoy" sea 0 todo el día y no 0.3.
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  return Math.round((dd - hoy) / 86400000);
}

function estaPendiente(it) { return !it.done && it.grade == null; }

/** Texto humano de cuándo es. Es lo primero que se lee en cada fila. */
function cuando(it) {
  const n = diasPara(it);
  if (n === null) return { txt: 'Sin fecha', tono: 'text-neutral-400' };
  if (n < -1) return { txt: `Hace ${Math.abs(n)} días`, tono: 'text-red-500' };
  if (n === -1) return { txt: 'Ayer', tono: 'text-red-500' };
  if (n === 0) return { txt: 'Hoy', tono: 'text-red-500' };
  if (n === 1) return { txt: 'Mañana', tono: 'text-amber-500' };
  if (n <= 3) return { txt: `En ${n} días`, tono: 'text-amber-500' };
  if (n <= 7) return { txt: `En ${n} días`, tono: 'text-neutral-500' };
  return { txt: new Date(it.due).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), tono: 'text-neutral-500' };
}

/**
 * Cómo va una materia.
 *
 *   acumulado  = Σ(peso × nota) / 100      ← lo que ya tienes asegurado sobre 5
 *   necesita   = (3.0×100 − Σ(peso × nota)) / pesoPendiente
 *
 * `necesita` es la pregunta que de verdad se hace un estudiante a mitad de
 * semestre: "¿con cuánto paso?". Sale de despejar la nota final de la suma
 * ponderada, y por eso es exacta en vez de una regla de tres aproximada.
 */
function subjectStats(subjectId) {
  const items = studyItems.filter(i => i.subjectId === subjectId);
  const conNota = items.filter(i => i.grade != null && Number(i.weight) > 0);

  const pesoCalificado = conNota.reduce((n, i) => n + Number(i.weight), 0);
  const puntos = conNota.reduce((n, i) => n + Number(i.weight) * Number(i.grade), 0);
  const pesoPendiente = Math.max(0, 100 - pesoCalificado);

  const promedio = pesoCalificado > 0 ? puntos / pesoCalificado : null;
  const acumulado = puntos / 100;

  let necesita = null, veredicto = null;
  if (pesoCalificado > 0) {
    if (pesoPendiente <= 0) {
      // Ya está todo calificado: no hay nada que "necesitar".
      veredicto = acumulado >= NOTA_APRUEBA ? 'aprobada' : 'perdida';
    } else {
      necesita = (NOTA_APRUEBA * 100 - puntos) / pesoPendiente;
      if (necesita <= 0) veredicto = 'asegurada';          // ya pasó pase lo que pase
      else if (necesita > NOTA_MAX) veredicto = 'imposible'; // no alcanza ni con 5.0
      else veredicto = 'en-juego';
    }
  }

  return {
    items, pendientes: items.filter(estaPendiente),
    pesoCalificado, pesoPendiente, promedio, acumulado, necesita, veredicto,
    sinPeso: items.filter(i => i.grade != null && !(Number(i.weight) > 0)).length,
  };
}

/** Apuntes de Mi cerebro que llevan la etiqueta de esta materia.
 *
 *  El campo del cuerpo se llama `content`, no `body` — es el nombre que usa
 *  js/11-notes.js. Buscar en `body` no fallaba con un error: devolvía siempre
 *  cero apuntes, que es peor porque parece que simplemente no has escrito nada. */
function notasDeMateria(sub) {
  const tag = subjectSlug(sub.name);
  if (!tag || typeof notes === 'undefined') return [];
  return notes.filter(n => {
    if (n.archived) return false;
    const txt = ((n.title || '') + ' ' + (n.content || '')).toLowerCase();
    return txt.includes('#' + tag);
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Abre una nota en la vista de Notas. No existe un `openNote()` global: el
 *  patrón del proyecto es fijar notesUi.selectedId y cambiar de vista, que es
 *  lo que hacen el grafo y la paleta de comandos. */
function irANota(id) {
  if (typeof notesUi === 'undefined') return;
  if (typeof commitNoteEdits === 'function') commitNoteEdits();
  notesUi.selectedId = id;
  notesUi.showArchived = false;
  notesUi.tagFilter = null;
  showView('notes');
}

/* ============ VISTA ============ */

function renderStudy() {
  document.querySelectorAll('.study-tab-btn').forEach(b => {
    const activo = b.dataset.studyTab === studyUi.tab;
    b.classList.toggle('bg-accent', activo);
    b.classList.toggle('text-white', activo);
    b.classList.toggle('text-neutral-500', !activo);
    b.setAttribute('aria-selected', activo ? 'true' : 'false');
  });

  const sub = document.getElementById('study-sub');
  if (sub) {
    sub.textContent = studyUi.tab === 'uni'
      ? 'Tecnología en Desarrollo de Software — ITM. Lo que hay que entregar, lo que viene y cómo van las notas.'
      : 'Lo que aprendes por fuera de la universidad: cursos, proyectos y lo que quieres dominar.';
  }

  if (studyUi.tab === 'uni') renderUniversidad();
  else renderDev();
}

function showStudyTab(tab) {
  studyUi.tab = tab;
  store.set('studyTab', tab);
  renderStudy();
}

/* ============ UNIVERSIDAD ============ */

function renderUniversidad() {
  const box = document.getElementById('study-panel');
  if (!box) return;

  const pendientes = studyItems.filter(estaPendiente)
    .sort((a, b) => {
      const da = itemDue(a), db = itemDue(b);
      if (!da && !db) return 0;
      if (!da) return 1;               // lo que no tiene fecha, al final
      if (!db) return -1;
      return da - db;
    });

  const vencidas = pendientes.filter(i => (diasPara(i) ?? 99) < 0);
  const estaSemana = pendientes.filter(i => { const n = diasPara(i); return n !== null && n >= 0 && n <= 7; });
  const parciales = pendientes.filter(i => KINDS_IMPORTANTES.includes(i.kind))
    .slice(0, 6);

  // Promedio del semestre ponderado por créditos: una materia de 4 créditos
  // pesa el doble que una de 2 en el promedio, que es como lo calcula la U.
  let creditos = 0, puntosCred = 0;
  studySubjects.forEach(s => {
    const st = subjectStats(s.id);
    if (st.promedio === null) return;
    const c = Number(s.credits) || 1;
    creditos += c;
    puntosCred += c * st.promedio;
  });
  const promedioSemestre = creditos > 0 ? puntosCred / creditos : null;

  const enRiesgo = studySubjects.filter(s => {
    const st = subjectStats(s.id);
    return st.veredicto === 'en-juego' && st.necesita > NOTA_APRUEBA;
  });

  box.innerHTML = `
    ${moodleBanner()}

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Por hacer', String(pendientes.length),
        vencidas.length ? `${vencidas.length} ya vencida${vencidas.length > 1 ? 's' : ''}` : 'nada vencido',
        vencidas.length ? 'text-red-500' : '')}
      ${statTile('Esta semana', String(estaSemana.length), 'en los próximos 7 días')}
      ${statTile('Promedio', promedioSemestre === null ? '—' : promedioSemestre.toFixed(2),
        creditos ? `ponderado por ${creditos} créditos` : 'sin notas todavía',
        promedioSemestre === null ? '' : promedioSemestre >= NOTA_APRUEBA ? 'text-green-600 dark:text-green-400' : 'text-red-500')}
      ${statTile('Materias', String(studySubjects.length),
        enRiesgo.length ? `${enRiesgo.length} apretada${enRiesgo.length > 1 ? 's' : ''}` : 'ninguna en riesgo',
        enRiesgo.length ? 'text-amber-500' : '')}
    </div>

    <div class="flex items-center gap-2 flex-wrap mb-6">
      <button type="button" id="capture-btn"
        class="px-5 py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em] inline-flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        Foto o voz
      </button>
      <button type="button" id="new-study-item-btn" class="px-4 py-2.5 rounded-xl surface hover:border-accent mono text-[10px] uppercase tracking-[0.15em] transition">+ A mano</button>
      <button type="button" id="new-subject-btn" class="px-4 py-2.5 rounded-xl surface hover:border-accent mono text-[10px] uppercase tracking-[0.15em] transition">+ Materia</button>
    </div>

    ${!studySubjects.length && !studyItems.length ? `
      <div class="surface rounded-2xl p-10 text-center mb-6">
        <p class="font-display font-bold text-lg mb-2">Empieza por tus materias</p>
        <p class="text-neutral-500 text-sm max-w-lg mx-auto leading-relaxed">
          Registra las materias del semestre y todo lo demás cuelga de ahí: lo que entra del Campus
          Virtual se engancha solo, las notas calculan tu promedio, y los apuntes de Mi cerebro
          aparecen al lado de cada una.
        </p>
      </div>` : ''}

    ${parciales.length ? `
      <div class="surface rounded-2xl p-6 mb-6" style="border-left:3px solid #f59e0b;">
        <div class="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
          <h3 class="font-display font-bold">Lo que no se puede dejar pasar</h3>
          <span class="meta-label text-neutral-500">parciales y proyectos</span>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${parciales.map(it => {
            const s = subjectById(it.subjectId);
            const c = cuando(it);
            return `
              <button type="button" data-study-edit="${it.id}" class="surface-soft rounded-xl p-4 text-left hover:border-accent transition">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="meta-label ${c.tono}">${c.txt}</span>
                  <span class="mono text-[10px] text-neutral-400">${STUDY_KINDS[it.kind]?.label || it.kind}</span>
                </div>
                <div class="font-semibold text-sm leading-snug mb-1">${escapeHtml(it.title)}</div>
                <div class="meta-label text-neutral-500 truncate">${escapeHtml(s ? s.name : 'Sin materia')}${it.weight ? ` · ${it.weight}%` : ''}</div>
              </button>`;
          }).join('')}
        </div>
      </div>` : ''}

    <div class="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
      <div class="surface rounded-2xl overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-6 py-4 border-b border-neutral-200 dark:border-white/5 flex-wrap">
          <div>
            <h3 class="font-display font-bold">Qué tengo que hacer</h3>
            <p class="meta-label text-neutral-500 mt-0.5">${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}, lo más urgente arriba</p>
          </div>
          ${studySubjects.length > 1 ? `
            <select id="study-filtro" class="surface-soft rounded-xl px-3 py-2 text-xs focus:border-accent focus:outline-none">
              <option value="todas">Todas las materias</option>
              ${studySubjects.map(s => `<option value="${s.id}" ${studyUi.filtroMateria === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>` : ''}
        </div>
        ${renderPendientes(pendientes)}
      </div>

      <div class="space-y-4">
        ${renderMaterias()}
      </div>
    </div>`;
}

function renderPendientes(lista) {
  const vis = studyUi.filtroMateria === 'todas'
    ? lista : lista.filter(i => i.subjectId === studyUi.filtroMateria);

  if (!vis.length) {
    return `<div class="p-10 text-center">
      <p class="text-neutral-500 text-sm max-w-md mx-auto leading-relaxed">
        ${lista.length ? 'Nada pendiente en esta materia.' : 'No tienes nada pendiente. Si acabas de empezar, conecta el Campus Virtual o sube algo con una foto.'}
      </p>
    </div>`;
  }

  return `<div class="divide-y divide-neutral-100 dark:divide-white/5">
    ${vis.map(it => {
      const s = subjectById(it.subjectId);
      const c = cuando(it);
      const k = STUDY_KINDS[it.kind] || STUDY_KINDS.otro;
      return `
        <div class="flex items-center gap-4 px-6 py-3.5 hover:bg-accent/[0.03] group">
          <button type="button" data-study-done="${it.id}" aria-label="Marcar como hecho"
            class="w-5 h-5 rounded-full border-2 border-neutral-300 dark:border-white/20 hover:border-accent hover:bg-accent/10 transition shrink-0"></button>
          <div class="min-w-0 flex-1 cursor-pointer" data-study-edit="${it.id}">
            <div class="font-medium text-sm truncate">${escapeHtml(it.title)}</div>
            <div class="meta-label text-neutral-500 truncate">
              ${escapeHtml(s ? s.name : 'Sin materia')} · ${k.label}${it.weight ? ` · ${it.weight}%` : ''}${it.source === 'moodle' ? ' · del ITM' : ''}
            </div>
          </div>
          <span class="meta-label shrink-0 ${c.tono}">${c.txt}</span>
          <button type="button" data-study-delete="${it.id}" aria-label="Borrar"
            class="w-8 h-8 rounded-lg text-neutral-300 dark:text-neutral-600 hover:text-red-500 hover:bg-red-500/10 transition shrink-0 opacity-0 group-hover:opacity-100">✕</button>
        </div>`;
    }).join('')}
  </div>`;
}

function renderMaterias() {
  if (!studySubjects.length) {
    return `<div class="surface rounded-2xl p-6 text-center">
      <p class="text-neutral-500 text-sm leading-relaxed">Sin materias todavía. Añádelas y aquí verás cómo va cada una.</p>
    </div>`;
  }

  return studySubjects.map(s => {
    const st = subjectStats(s.id);
    const apuntes = notasDeMateria(s);
    const tag = subjectSlug(s.name);

    const tono = {
      asegurada: '#22c55e', aprobada: '#22c55e',
      'en-juego': st.necesita > NOTA_APRUEBA ? '#f59e0b' : '#2667ff',
      imposible: '#ef4444', perdida: '#ef4444',
    }[st.veredicto] || '#737373';

    return `
      <div class="surface rounded-2xl p-5" style="border-left:3px solid ${tono};">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <h4 class="font-display font-bold leading-tight truncate">${escapeHtml(s.name)}</h4>
            <p class="meta-label text-neutral-500 mt-0.5 truncate">
              ${s.teacher ? escapeHtml(s.teacher) : 'Sin profesor'}${s.credits ? ` · ${s.credits} cr` : ''}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" data-subject-edit="${s.id}" aria-label="Editar materia"
              class="w-8 h-8 rounded-lg text-neutral-400 hover:text-accent hover:bg-accent/10 transition">✎</button>
            <button type="button" data-subject-delete="${s.id}" aria-label="Borrar materia"
              class="w-8 h-8 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
          </div>
        </div>

        ${st.promedio !== null ? `
          <div class="flex items-end gap-4 mb-3">
            <div>
              <div class="meta-label text-neutral-500 mb-0.5">Promedio</div>
              <div class="display text-2xl ${st.promedio >= NOTA_APRUEBA ? '' : 'text-red-500'}">${st.promedio.toFixed(2)}</div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="meta-label text-neutral-500 mb-1">${st.pesoCalificado}% calificado</div>
              <div class="h-1.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
                <div class="h-full rounded-full" style="width:${Math.min(st.pesoCalificado, 100)}%;background:${tono}"></div>
              </div>
            </div>
          </div>
          ${renderVeredicto(st)}
        ` : `
          <p class="text-neutral-500 text-xs leading-relaxed mb-3">
            Sin notas todavía. Cuando registres la nota y el peso de una evaluación, aquí aparece tu
            promedio y cuánto necesitas en lo que falta.
          </p>`}

        ${st.sinPeso ? `
          <p class="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mb-3">
            ${st.sinPeso} nota${st.sinPeso > 1 ? 's' : ''} sin peso asignado: no entra${st.sinPeso > 1 ? 'n' : ''} en el cálculo.
          </p>` : ''}

        <div class="pt-3 border-t border-neutral-100 dark:border-white/5">
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="meta-label text-neutral-500">Apuntes</span>
            <span class="mono text-[10px] text-neutral-400">#${tag}</span>
          </div>
          ${apuntes.length ? `
            <div class="space-y-1">
              ${apuntes.slice(0, 4).map(n => `
                <button type="button" data-open-note="${n.id}" class="block w-full text-left text-xs truncate hover:text-accent transition">
                  ${escapeHtml(n.title || 'Sin título')}
                </button>`).join('')}
              ${apuntes.length > 4 ? `<p class="meta-label text-neutral-400 pt-1">y ${apuntes.length - 4} más</p>` : ''}
            </div>`
            : `<p class="text-neutral-500 text-[11px] leading-relaxed">
                 Ninguno todavía. Etiqueta una nota con <span class="mono">#${tag}</span> y aparecerá aquí.
               </p>`}
          <button type="button" data-new-note-subject="${s.id}" class="meta-label !text-accent mt-2">+ Nota de esta materia</button>
        </div>
      </div>`;
  }).join('');
}

/** La frase que responde "¿paso o no paso?". */
function renderVeredicto(st) {
  if (st.veredicto === 'asegurada') {
    return `<p class="text-xs leading-relaxed text-green-600 dark:text-green-400">
      Ya la tienes: con ${st.acumulado.toFixed(2)} acumulado pasas aunque saques 0.0 en todo lo que falta.
    </p>`;
  }
  if (st.veredicto === 'aprobada') {
    return `<p class="text-xs leading-relaxed text-green-600 dark:text-green-400">Aprobada con ${st.acumulado.toFixed(2)}.</p>`;
  }
  if (st.veredicto === 'perdida') {
    return `<p class="text-xs leading-relaxed text-red-500">Cerrada en ${st.acumulado.toFixed(2)}, por debajo de ${NOTA_APRUEBA.toFixed(1)}.</p>`;
  }
  if (st.veredicto === 'imposible') {
    return `<p class="text-xs leading-relaxed text-red-500">
      Harían falta ${st.necesita.toFixed(2)} en el ${st.pesoPendiente}% que queda, y el máximo es ${NOTA_MAX.toFixed(1)}.
      Con esta distribución de pesos ya no alcanza.
    </p>`;
  }
  if (st.veredicto === 'en-juego') {
    const apretado = st.necesita > NOTA_APRUEBA;
    return `<p class="text-xs leading-relaxed ${apretado ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500'}">
      Necesitas <strong>${st.necesita.toFixed(2)}</strong> en el ${st.pesoPendiente}% que falta para pasar con ${NOTA_APRUEBA.toFixed(1)}.
      ${apretado ? 'Está apretado.' : ''}
    </p>`;
  }
  return '';
}

/* ============ DESARROLLO DE SOFTWARE ============ */

function renderDev() {
  const box = document.getElementById('study-panel');
  if (!box) return;
  box.innerHTML = `
    <div class="surface rounded-2xl p-10 text-center">
      <div class="w-12 h-12 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="1.5"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>
      </div>
      <p class="font-display font-bold text-lg mb-1">Aún sin construir</p>
      <p class="text-neutral-500 text-sm max-w-lg mx-auto leading-relaxed">
        Esta pestaña es para lo que aprendes por fuera de la universidad: cursos, documentación,
        proyectos propios y lo que quieres llegar a dominar. Dijimos de centrarnos primero en
        Universidad, así que esto queda listo para cuando quieras definir qué va aquí.
      </p>
    </div>`;
}

/* ============================================================================
   CAMPUS VIRTUAL DEL ITM (Moodle, por calendario iCal)
   ============================================================================

   Soporta VARIOS feeds porque el ITM tiene más de un Moodle: el Campus Virtual
   y el del DCEB son instalaciones distintas, cada una con su propia URL.

   La URL se saca una vez desde dentro de Moodle (Calendario → Exportar
   calendario → Obtener URL). Lleva el token del usuario, así que no hay que
   guardar la contraseña del ITM en ninguna parte ni pasar por el SSO.
   ============================================================================ */

const moodleState = { status: 'idle', error: null, lastSync: store.get('moodleLastSync', null) };

function moodleFeeds() {
  const m = (typeof integrations !== 'undefined' && integrations.moodle) || {};
  return Array.isArray(m.feeds) ? m.feeds : [];
}

function guardarFeeds(feeds) {
  if (typeof integrations === 'undefined') return;
  integrations.moodle = Object.assign({}, integrations.moodle, { feeds });
  if (typeof saveIntegrations === 'function') saveIntegrations();
}

function studyBaseUrl() {
  return ((integrations?.sync?.url || integrations?.notion?.proxyUrl || '') + '').trim().replace(/\/$/, '');
}
function isStudyBackendReady() { return !!(studyBaseUrl() && (integrations?.sync?.token || '').trim()); }

/** Engancha el nombre del curso de Moodle con una materia del panel. */
function materiaPorCurso(curso) {
  if (!curso) return null;
  const n = subjectSlug(curso);
  if (!n) return null;
  return studySubjects.find(s => subjectSlug(s.alias || '') === n)
      || studySubjects.find(s => subjectSlug(s.name) === n)
      || studySubjects.find(s => {
           const sn = subjectSlug(s.name);
           return sn && (n.includes(sn) || sn.includes(n));
         })
      || null;
}

/**
 * Trae los calendarios y los fusiona.
 *
 * REGLA QUE NO SE ROMPE: lo que viene del ITM puede actualizar el título y la
 * fecha, pero NUNCA toca la nota, el peso, si ya lo marcaste como hecho ni la
 * materia que le asignaste. Si el profesor mueve la entrega, quieres enterarte;
 * si sincronizar borrara el 4.5 que ya te habían puesto, el panel sería una
 * trampa. Por eso los campos del usuario se preservan explícitamente.
 */
async function syncMoodle({ interactive = false } = {}) {
  if (!isStudyBackendReady()) {
    if (interactive) alert('Primero configura la URL del backend y el SYNC_TOKEN en "Conectar cuentas" → Sincronización.');
    return false;
  }
  const feeds = moodleFeeds().filter(f => f.url);
  if (!feeds.length) {
    if (interactive) alert('Todavía no has añadido ningún calendario. Pulsa "Calendarios" para pegar la URL que te da Moodle.');
    return false;
  }

  moodleState.status = 'loading';
  moodleState.error = null;
  renderStudy();

  let nuevos = 0, actualizados = 0;
  const errores = [];

  for (const feed of feeds) {
    try {
      const res = await fetch(`${studyBaseUrl()}/study/ical?url=${encodeURIComponent(feed.url)}`, {
        headers: { 'X-Sync-Token': (integrations.sync.token || '').trim() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `El servidor respondió ${res.status}`);

      (data.items || []).forEach(it => {
        const ext = `${feed.id}:${it.externalId}`;
        const existente = studyItems.find(x => x.externalId === ext);

        if (existente) {
          // Sólo lo que es del profesor. Lo tuyo se queda como está.
          let cambio = false;
          if (existente.title !== it.title) { existente.title = it.title; cambio = true; }
          const dueLocal = it.due ? isoALocal(it.due) : '';
          if (dueLocal && existente.due !== dueLocal) { existente.due = dueLocal; cambio = true; }
          if (cambio) { touch(existente); actualizados++; }
          return;
        }

        const materia = materiaPorCurso(it.course);
        studyItems.push(touch({
          id: uid(),
          externalId: ext,
          source: 'moodle',
          origen: feed.label || 'ITM',
          title: it.title,
          subjectId: materia ? materia.id : '',
          course: it.course || '',
          kind: it.kind || 'tarea',
          due: it.due ? isoALocal(it.due) : '',
          weight: 0,
          grade: null,
          done: false,
          notes: it.notes || '',
          createdAt: Date.now(),
        }));
        nuevos++;
      });
    } catch (err) {
      errores.push(`${feed.label || feed.id}: ${err.message}`);
    }
  }

  if (nuevos || actualizados) saveAll();
  moodleState.status = errores.length ? 'error' : 'ok';
  moodleState.error = errores.join(' · ') || null;
  moodleState.lastSync = new Date().toISOString();
  store.set('moodleLastSync', moodleState.lastSync);
  renderStudy();

  if (errores.length && interactive) alert('Algunos calendarios fallaron:\n\n' + errores.join('\n'));
  else if (nuevos || actualizados) toast(`ITM: ${nuevos} nuevo${nuevos === 1 ? '' : 's'}, ${actualizados} actualizado${actualizados === 1 ? '' : 's'}`);
  else if (interactive) toast('Nada nuevo en el Campus Virtual');
  return !errores.length;
}

/** ISO → el formato que espera <input type="datetime-local"> (hora local). */
function isoALocal(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function moodleBanner() {
  const feeds = moodleFeeds();

  if (!isStudyBackendReady()) {
    return `<div class="surface rounded-2xl px-6 py-4 mb-6 flex items-center gap-4 flex-wrap">
      <div class="flex-1 min-w-[240px]">
        <h3 class="font-display font-bold text-sm">Campus Virtual del ITM</h3>
        <p class="text-neutral-500 text-xs mt-0.5 leading-relaxed">
          Las tareas del ITM pueden entrar solas por el calendario de Moodle. Hace falta tener
          configurado el backend en "Conectar cuentas" → Sincronización.
        </p>
      </div>
      <button type="button" data-open-integrations="sync" class="meta-label !text-accent shrink-0">Configurar →</button>
    </div>`;
  }

  if (!feeds.length) {
    return `<div class="surface rounded-2xl px-6 py-5 mb-6" style="border-left:3px solid #2667ff;">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="flex-1 min-w-[260px]">
          <h3 class="font-display font-bold mb-1">Conecta el Campus Virtual</h3>
          <p class="text-neutral-500 text-sm leading-relaxed">
            Entra a <span class="mono">cvirtual.itm.edu.co</span> → Calendario → <strong>Exportar
            calendario</strong> → elige "Todos los eventos" y "Próximos 60 días" → <strong>Obtener
            URL del calendario</strong>. Pega aquí esa URL y las entregas aparecerán solas.
            Repite con el Moodle del DCEB.
          </p>
          <p class="text-neutral-500 text-xs mt-2 leading-relaxed">
            Esa URL lleva tu token dentro, así que no hace falta guardar tu contraseña del ITM.
            Trátala como una contraseña: quien la tenga puede ver tu calendario.
          </p>
        </div>
        <button type="button" id="moodle-feeds-btn" class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em] shrink-0">+ Calendario</button>
      </div>
    </div>`;
  }

  const estados = {
    idle: ['bg-neutral-400', 'text-neutral-500', moodleState.lastSync ? `Última vez ${relativeTime(moodleState.lastSync)}` : 'Sin sincronizar todavía'],
    loading: ['bg-accent animate-pulse', 'text-accent', 'Consultando el ITM…'],
    ok: ['bg-accent', 'text-accent', `Sincronizado ${relativeTime(moodleState.lastSync)}`],
    error: ['bg-red-500', 'text-red-500', moodleState.error || 'Error'],
  };
  const [dot, txt, msg] = estados[moodleState.status] || estados.idle;

  return `<div class="surface rounded-2xl px-6 py-4 mb-6 flex items-center gap-4 flex-wrap">
    <span class="w-1.5 h-1.5 rounded-full ${dot} shrink-0"></span>
    <div class="flex-1 min-w-[200px]">
      <h3 class="font-display font-bold text-sm">Campus Virtual del ITM</h3>
      <p class="meta-label ${txt} mt-0.5">${escapeHtml(msg)} · ${feeds.length} calendario${feeds.length > 1 ? 's' : ''}</p>
    </div>
    <button type="button" id="moodle-feeds-btn" class="px-3 py-2 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.15em] shrink-0">Calendarios</button>
    <button type="button" id="moodle-sync-btn" ${moodleState.status === 'loading' ? 'disabled' : ''}
      class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em] shrink-0 ${moodleState.status === 'loading' ? 'opacity-50' : ''}">
      ↻ Traer del ITM
    </button>
  </div>`;
}

/* ============================================================================
   CAPTURA POR FOTO Y POR VOZ
   ============================================================================

   El audio NO se sube a ningún sitio. Chrome transcribe en el propio navegador
   con SpeechRecognition, que entiende español de Colombia, y lo que viaja es el
   texto ya transcrito. Sale gratis, es instantáneo y la grabación no sale del
   dispositivo.

   La foto sí viaja, pero reducida antes: una foto de móvil son varios MB y en
   base64 crece un tercio más. A 1600px de lado largo el texto de un cuaderno se
   sigue leyendo perfectamente, la petición es mucho más rápida y cuesta menos.

   Nada de esto guarda por su cuenta: todo termina en el formulario normal para
   que lo revises.
   ============================================================================ */

const captureState = { imagen: null, escuchando: false, reco: null, pendientes: [] };

/* ============================================================================
   INTÉRPRETE LOCAL — texto dictado o escrito, sin API
   ============================================================================

   Devuelve exactamente la misma forma que el modelo, así que el resto del flujo
   (revisar en el formulario, lista de casillas si hay varias) no distingue de
   dónde salió cada tarea.

   Esto NO pretende competir con un modelo. Un modelo entiende cualquier frase;
   esto entiende las formas en que de verdad se dicta una tarea. La diferencia
   importa menos de lo que parece porque de todas maneras revisas antes de
   guardar: un fallo del intérprete se ve y se corrige en el formulario, no se
   cuela a los datos.

   A cambio es instantáneo, gratis, funciona sin internet y nada sale del
   equipo. Para la foto sí hace falta un modelo de verdad — leer letra
   manuscrita no se resuelve con reglas.
   ============================================================================ */

/* Mapa de acentos 1:1 en vez de normalize('NFD'). La diferencia es crítica
   aquí: NFD descompone 'á' en dos caracteres y CAMBIA LA LONGITUD, con lo que
   los índices dejan de coincidir con el texto original y recortar por posición
   devuelve basura. Sustituyendo carácter por carácter, las posiciones se
   mantienen alineadas y se puede detectar sobre la versión sin acentos pero
   cortar sobre la original. */
const ACENTOS = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
                  'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U', 'Ñ': 'N' };
function aplanar(s) { return String(s || '').replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, c => ACENTOS[c]); }

const DIAS_SEMANA = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
                agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

const NUM_PALABRA = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

function conHora(d, h, m) { const x = new Date(d); x.setHours(h, m, 0, 0); return x; }

/** Hora dicha en la frase, o null. Devuelve [hora, minuto]. */
function buscarHora(low) {
  const m = /\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|de\s+la\s+(?:manana|tarde|noche))?/.exec(low);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const suf = m[3] || '';
  if (/pm|tarde|noche/.test(suf) && h < 12) h += 12;
  if (/am|manana/.test(suf) && h === 12) h = 0;
  // "a las 3" sin sufijo, en contexto de clase, casi siempre son las 15:00.
  if (!suf && h >= 1 && h <= 7) h += 12;
  return [Math.min(h, 23), min];
}

/**
 * Encuentra una expresión de fecha y la resuelve.
 * Devuelve { ini, fin, fecha } con los índices sobre el texto aplanado.
 *
 * Las reglas van de MÁS a MENOS específica: "15 de marzo" tiene que ganarle a
 * "el 15", y "pasado mañana" a "mañana", o la primera coincidencia se queda con
 * media expresión y la fecha sale mal.
 */
function buscarFecha(low, ahora) {
  const hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
  const hora = buscarHora(low);
  const sellar = d => hora ? conHora(d, hora[0], hora[1]) : conHora(d, 23, 59);

  let m;

  // 15 de marzo [de 2026]
  m = /\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/.exec(low);
  if (m && MESES[m[2]] !== undefined) {
    const anio = m[3] ? Number(m[3]) : hoy.getFullYear();
    let d = new Date(anio, MESES[m[2]], Number(m[1]));
    // Sin año explícito y ya pasó: se asume el año que viene.
    if (!m[3] && d < hoy) d = new Date(anio + 1, MESES[m[2]], Number(m[1]));
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  // 15/03 o 15-03-2026
  m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(low);
  if (m) {
    let anio = m[3] ? Number(m[3]) : hoy.getFullYear();
    if (anio < 100) anio += 2000;
    let d = new Date(anio, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && d < hoy) d = new Date(anio + 1, Number(m[2]) - 1, Number(m[1]));
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  // pasado mañana — antes que "mañana", que es subcadena suya
  m = /\bpasado\s+manana\b/.exec(low);
  if (m) {
    const d = new Date(hoy); d.setDate(d.getDate() + 2);
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  m = /\bmanana\b/.exec(low);
  if (m) {
    const d = new Date(hoy); d.setDate(d.getDate() + 1);
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  m = /\bhoy\b/.exec(low);
  if (m) return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(hoy) };

  // en 3 días / en dos semanas
  m = /\ben\s+(\d+|un|una|dos|tres|cuatro|cinco|seis)\s+(dias?|semanas?)\b/.exec(low);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (NUM_PALABRA[m[1]] || 1);
    const d = new Date(hoy);
    d.setDate(d.getDate() + n * (/semana/.test(m[2]) ? 7 : 1));
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  // la otra semana / la próxima semana
  m = /\bla\s+(otra|proxima|siguiente)\s+semana\b/.exec(low);
  if (m) {
    const d = new Date(hoy); d.setDate(d.getDate() + 7);
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  /* Día de la semana. Siempre se resuelve al PRÓXIMO, nunca a hoy: si hoy es
     viernes y dictas "el viernes", te refieres al de la semana que viene — el
     de hoy ya habría pasado. Resolver a hoy pondría la entrega como vencida en
     el mismo momento de crearla. */
  m = /\b(?:el\s+|este\s+|el\s+proximo\s+|proximo\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(low);
  if (m) {
    const objetivo = DIAS_SEMANA[m[1]];
    const d = new Date(hoy);
    let delta = (objetivo - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() + delta);
    return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
  }

  // el 15 (día del mes). Va de último: es la más ambigua.
  m = /\bel\s+(\d{1,2})\b(?!\s*%)/.exec(low);
  if (m) {
    const dia = Number(m[1]);
    if (dia >= 1 && dia <= 31) {
      let d = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
      if (d < hoy) d = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia);
      return { ini: m.index, fin: m.index + m[0].length, fecha: sellar(d) };
    }
  }

  return null;
}

/** Peso en la nota. */
function buscarPeso(low) {
  const m = /\b(\d{1,3})\s*(?:%|por\s*ciento)/.exec(low);
  if (!m) return null;
  const n = Number(m[1]);
  if (n <= 0 || n > 100) return null;
  // Se come también el "vale el" / "equivale al" de delante, que si no queda
  // colgando en el título.
  let ini = m.index;
  const antes = low.slice(Math.max(0, m.index - 24), m.index);
  const pre = /(?:que\s+)?(?:vale|equivale|cuenta)\s+(?:el\s+|al\s+|un\s+)?$/.exec(antes);
  if (pre) ini = m.index - pre[0].length;
  return { ini, fin: m.index + m[0].length, peso: n };
}

/** Materia mencionada, contra las que el usuario tiene registradas. */
function buscarMateria(low, materias) {
  let mejor = null;
  materias.forEach(nombre => {
    const n = aplanar(nombre).toLowerCase().trim();
    if (!n) return;
    // Primero el nombre completo; si no, la palabra más larga ("cálculo" de
    // "Cálculo Diferencial"), que es como se nombra en el habla.
    let idx = low.indexOf(n);
    let usado = n;
    if (idx < 0) {
      const palabras = n.split(/\s+/).filter(p => p.length >= 5).sort((a, b) => b.length - a.length);
      for (const p of palabras) {
        const i = low.indexOf(p);
        if (i >= 0) { idx = i; usado = p; break; }
      }
    }
    if (idx < 0) return;
    /* Se absorbe la preposición de delante. Sin esto, quitar "cálculo" de
       "taller de cálculo" deja "taller de" con la preposición colgando y sin
       nada detrás, que es justo lo que no se quiere leer en un título. */
    let ini = idx;
    const pre = /\s+de(?:l)?(?:\s+la|\s+los|\s+las)?\s+$/.exec(low.slice(0, idx));
    if (pre) ini = idx - pre[0].length;
    if (!mejor || usado.length > mejor.usado.length) {
      mejor = { nombre, ini, fin: idx + usado.length, usado };
    }
  });
  return mejor;
}

const KIND_PISTAS = [
  [/\bproyecto\b|\bentrega\s+final\b/, 'proyecto'],
  [/\bexposicion\b|\bsustentacion\b|\bpresentacion\b/, 'exposicion'],
  [/\bquiz\b|\bprueba\s+corta\b|\bcuestionario\b/, 'quiz'],
  [/\bparcial(?:es)?\b|\bexamen\b|\b(?:evaluacion|prueba)\s+final\b/, 'parcial'],
  [/\btaller\b|\btarea\b|\blaboratorio\b|\bentrega\b|\binforme\b|\bactividad\b/, 'tarea'],
];

/** Limpia lo que queda tras quitar fecha, peso y materia. */
function limpiarTexto(s) {
  let t = s.replace(/\s{2,}/g, ' ')
           .replace(/\s+([,.;])/g, '$1')
           .replace(/^[\s,;.:]+|[\s,;.:]+$/g, '')
           .trim();

  /* Muletillas con las que empieza casi todo dictado.
     La `i` es imprescindible y faltaba: la frase empieza en mayúscula, así que
     "Para el viernes…" no casaba con "para\s+" y el "Para" se quedaba pegado
     delante del título. */
  const lead = /^(?:y\s+|ademas\s+|tambien\s+|para\s+|que\s+|el\s+|la\s+|los\s+|las\s+|hay\s+que\s+|hay\s+|tengo\s+que\s+|tengo\s+|toca\s+|debo\s+|me\s+dejaron\s+|nos\s+dejaron\s+|dejaron\s+|pusieron\s+|tenemos\s+|de\s+)/i;
  let antes;
  do { antes = t; t = t.replace(lead, '').trim(); } while (t !== antes && t.length > 3);

  /* Preposiciones que quedan huérfanas al recortar un trozo del medio o del
     final ("taller de" + nada detrás). Se limpian aquí además de absorberlas al
     cortar, porque pueden quedar colgando por más de un camino. */
  t = t.replace(/\s+de(?:l)?(?:\s+la|\s+los|\s+las)?\s*([,;.])/gi, '$1')
       .replace(/\s+de(?:l)?(?:\s+la|\s+los|\s+las)?\s*$/i, '')
       .replace(/\s{2,}/g, ' ')
       .replace(/\s+([,.;])/g, '$1')
       .replace(/^[\s,;.:]+|[\s,;.:]+$/g, '')
       .trim();

  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Parte un dictado largo en frases, que suelen ser una tarea cada una. */
function partirFrases(texto) {
  return texto
    .split(/[.;\n]+/)
    // "... y el martes parcial de progra": al dictar se encadena con "y" en vez
    // de puntuar, así que también se corta ahí cuando sigue algo temporal.
    .flatMap(p => p.split(/\s+y\s+(?=(?:el|la|para|este|proximo|manana|hoy|pasado|en)\b)/i))
    .map(p => p.trim())
    .filter(p => p.length >= 8);
}

/**
 * Punto de entrada. Devuelve la misma forma que el modelo:
 * { title, kind, subject, dueISO, weight, notes, confidence }
 */
function parsearLocal(texto, materias, ahora) {
  const base = ahora ? new Date(ahora) : new Date();
  const lista = Array.isArray(materias) ? materias : [];
  const salida = [];

  partirFrases(String(texto || '')).forEach(frase => {
    const plano = aplanar(frase);
    const low = plano.toLowerCase();

    const f = buscarFecha(low, base);
    const p = buscarPeso(low);
    const mat = buscarMateria(low, lista);

    let kind = 'tarea';
    for (const [re, k] of KIND_PISTAS) if (re.test(low)) { kind = k; break; }

    /* Se recortan los trozos ya consumidos para que no se repitan en el título.
       De atrás hacia adelante: cortar de delante primero desplazaría todos los
       índices siguientes y se acabaría cortando por donde no es. */
    const cortes = [f, p, mat].filter(Boolean).sort((a, b) => b.ini - a.ini);
    let resto = frase;
    cortes.forEach(c => { resto = resto.slice(0, c.ini) + ' ' + resto.slice(c.fin); });

    const title = limpiarTexto(resto) || limpiarTexto(frase);
    if (!title) return;

    // La confianza es honesta: cuanto menos se reconoció, más hay que revisar.
    const aciertos = (f ? 1 : 0) + (mat ? 1 : 0);
    salida.push({
      title,
      kind,
      subject: mat ? mat.nombre : '',
      dueISO: f ? f.fecha.toISOString() : '',
      weight: p ? p.peso : 0,
      notes: '',
      confidence: aciertos === 2 ? 'alta' : aciertos === 1 ? 'media' : 'baja',
    });
  });

  return salida;
}

/** Reduce y recomprime una imagen antes de mandarla. */
function prepararImagen(file, maxLado = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      // JPEG al 85%: para texto manuscrito la diferencia con el 100% no se ve y
      // el archivo baja a menos de la mitad.
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

function captureStatus(html, tono) {
  const box = document.getElementById('capture-status');
  if (!box) return;
  box.classList.remove('hidden');
  box.className = 'rounded-xl p-4 mb-4';
  box.style.cssText = tono ? `border-left:3px solid ${tono};background:${tono}10` : '';
  box.innerHTML = html;
}

function toggleDictado() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const label = document.getElementById('capture-voice-label');
  const hint = document.getElementById('capture-voice-hint');

  if (!SR) {
    if (hint) hint.textContent = 'Tu navegador no lo soporta; escríbelo abajo';
    return;
  }

  if (captureState.escuchando) {
    captureState.reco?.stop();
    return;
  }

  const reco = new SR();
  reco.lang = 'es-CO';
  reco.interimResults = true;
  reco.continuous = true;
  captureState.reco = reco;

  const area = document.getElementById('capture-text');
  const base = (area?.value || '').trim();

  reco.onstart = () => {
    captureState.escuchando = true;
    if (label) label.textContent = 'Escuchando…';
    if (hint) hint.textContent = 'Toca otra vez para parar';
  };
  reco.onresult = ev => {
    let txt = '';
    for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
    if (area) area.value = (base ? base + ' ' : '') + txt;
  };
  reco.onerror = ev => {
    if (hint) hint.textContent = ev.error === 'not-allowed'
      ? 'Permiso de micrófono denegado' : 'No se pudo escuchar: ' + ev.error;
  };
  reco.onend = () => {
    captureState.escuchando = false;
    if (label) label.textContent = 'Dictar';
    if (hint) hint.textContent = 'Habla y se transcribe solo';
  };

  try { reco.start(); } catch { /* ya estaba arrancando */ }
}

async function interpretarCaptura() {
  const texto = (document.getElementById('capture-text')?.value || '').trim();
  if (!texto && !captureState.imagen) {
    captureStatus('<p class="text-sm">Toma una foto, dicta algo o escríbelo.</p>', '#f59e0b');
    return;
  }

  if (captureState.escuchando) captureState.reco?.stop();

  /* SIN FOTO = SIN RED. El texto se interpreta aquí mismo: es instantáneo, no
     cuesta nada, funciona sin internet y no sale del equipo. Sólo la foto
     necesita un modelo, porque leer letra manuscrita no se hace con reglas. */
  if (!captureState.imagen) {
    const items = parsearLocal(texto, studySubjects.map(s => s.name));
    if (!items.length) {
      captureStatus(`<p class="text-sm">No pude sacar nada de ahí. Prueba algo como
        "para el viernes hay taller de cálculo, vale el 15%".</p>`, '#f59e0b');
      return;
    }
    if (items.length === 1) { rellenarConItem(items[0]); return; }
    mostrarVarios(items);
    return;
  }

  if (!isStudyBackendReady()) {
    alert('Para interpretar una foto hace falta el backend configurado en "Conectar cuentas" → Sincronización. El dictado sí funciona sin nada de eso.');
    return;
  }

  captureStatus('<p class="text-sm">Leyendo la foto…</p>', '#2667ff');

  try {
    const res = await fetch(`${studyBaseUrl()}/study/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Token': (integrations.sync.token || '').trim() },
      body: JSON.stringify({
        text: texto,
        image: captureState.imagen ? { mediaType: captureState.imagen.mediaType, data: captureState.imagen.data } : null,
        subjects: studySubjects.map(s => s.name),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `El servidor respondió ${res.status}`);

    const items = data.items || [];
    if (!items.length) {
      captureStatus(`<p class="text-sm">No encontré ninguna tarea ahí. Si es una foto de apuntes
        sin nada que entregar, es lo esperado. Prueba a decir en voz qué hay que hacer.</p>`, '#f59e0b');
      return;
    }

    if (items.length === 1) { rellenarConItem(items[0]); return; }
    mostrarVarios(items);
  } catch (err) {
    // Que falle la foto no debería dejarte parado: el dictado no depende de
    // nada de esto y hace el mismo trabajo para lo que puedes decir en voz.
    captureStatus(`
      <p class="text-sm text-red-500 mb-2">No se pudo leer la foto: ${escapeHtml(err.message)}</p>
      <p class="text-xs text-neutral-500 leading-relaxed">
        El <strong>dictado sigue funcionando</strong> — ese no pasa por ningún servidor. Toca
        "Dictar" o escribe abajo lo que hay que hacer y dale a Interpretar.
      </p>`, '#ef4444');
  }
}

/** Pasa lo que entendió la IA al formulario normal, para revisarlo. */
function rellenarConItem(it) {
  closeStudyModals();
  openStudyModal('study-item-modal', form => {
    fillSubjectSelect(form.subjectId);
    form.title.value = it.title || '';
    form.kind.value = STUDY_KINDS[it.kind] ? it.kind : 'tarea';
    form.weight.value = Number(it.weight) > 0 ? it.weight : '';
    form.notes.value = it.notes || '';
    if (it.dueISO) {
      const d = new Date(it.dueISO);
      if (!isNaN(d.getTime())) form.due.value = isoALocal(d.toISOString());
    }
    const m = it.subject ? materiaPorCurso(it.subject) : null;
    if (m) form.subjectId.value = m.id;

    const sub = document.getElementById('study-item-sub');
    if (sub) {
      const aviso = it.confidence === 'baja'
        ? ' La IA no estaba segura de esto, revísalo bien.'
        : it.confidence === 'media' ? ' Revisa la fecha y la materia.' : '';
      sub.textContent = `Esto entendió la IA.${aviso}${!m && it.subject ? ` Dijo "${it.subject}", que no coincide con ninguna materia tuya.` : ''}`;
    }
  });
}

/** Varias tareas de una sola foto: se revisan en lista antes de crearlas. */
function mostrarVarios(items) {
  captureState.pendientes = items;
  captureStatus(`
    <p class="text-sm font-semibold mb-3">Encontré ${items.length} cosas. Desmarca lo que no quieras:</p>
    <div class="space-y-2 mb-3">
      ${items.map((it, i) => {
        const m = it.subject ? materiaPorCurso(it.subject) : null;
        const f = it.dueISO ? new Date(it.dueISO) : null;
        return `
          <label class="flex items-start gap-3 surface-soft rounded-xl p-3 cursor-pointer">
            <input type="checkbox" data-cap-item="${i}" checked class="mt-0.5 w-4 h-4 accent-[#2667ff] shrink-0" />
            <span class="min-w-0 flex-1">
              <span class="font-medium text-sm block truncate">${escapeHtml(it.title)}</span>
              <span class="meta-label text-neutral-500 block truncate">
                ${escapeHtml(m ? m.name : (it.subject || 'Sin materia'))}
                · ${STUDY_KINDS[it.kind]?.label || it.kind}
                ${f && !isNaN(f.getTime()) ? ' · ' + f.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : ''}
                ${it.confidence === 'baja' ? ' · dudosa' : ''}
              </span>
            </span>
          </label>`;
      }).join('')}
    </div>
    <button type="button" id="capture-add-all"
      class="w-full py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em]">Añadir las marcadas</button>
  `, '#2667ff');
}

/* ============ FORMULARIOS Y EVENTOS ============ */

function openStudyModal(id, prepare) {
  const m = document.getElementById(id);
  if (!m) return;
  const form = m.querySelector('form');
  if (form) { form.reset(); delete form.dataset.editing; }
  if (prepare) prepare(form);
  m.classList.remove('hidden');
  m.classList.add('flex');
  requestAnimationFrame(() => m.querySelector('input,select,textarea')?.focus());
}

function closeStudyModals() {
  ['subject-modal', 'study-item-modal', 'capture-modal', 'moodle-feeds-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  });
}

function fillSubjectSelect(sel, valor) {
  if (!sel) return;
  sel.innerHTML = '<option value="">Sin materia</option>' +
    studySubjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (valor) sel.value = valor;
}

document.querySelectorAll('.study-tab-btn').forEach(b =>
  b.addEventListener('click', () => showStudyTab(b.dataset.studyTab)));

/** Pinta la lista de calendarios dentro de su modal. */
function renderFeedsList() {
  const box = document.getElementById('moodle-feeds-list');
  if (!box) return;
  const feeds = moodleFeeds();
  if (!feeds.length) {
    box.innerHTML = `<p class="text-neutral-500 text-sm text-center py-3">Ningún calendario todavía.</p>`;
    return;
  }
  box.innerHTML = feeds.map(f => `
    <div class="surface-soft rounded-xl px-4 py-3 flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-sm truncate">${escapeHtml(f.label || 'Sin nombre')}</div>
        <div class="mono text-[10px] text-neutral-400 truncate">${escapeHtml(new URL(f.url).hostname)}</div>
      </div>
      <button type="button" data-feed-delete="${f.id}" aria-label="Quitar calendario"
        class="w-8 h-8 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition shrink-0">✕</button>
    </div>`).join('');
}

document.addEventListener('click', e => {
  if (e.target.closest('#capture-btn')) {
    captureState.imagen = null;
    openStudyModal('capture-modal', () => {
      const t = document.getElementById('capture-text'); if (t) t.value = '';
      const s = document.getElementById('capture-status'); if (s) s.classList.add('hidden');
    });
    return;
  }
  if (e.target.closest('#capture-voice')) { toggleDictado(); return; }
  if (e.target.closest('#capture-send')) { interpretarCaptura(); return; }

  if (e.target.closest('#capture-add-all')) {
    const marcados = [...document.querySelectorAll('[data-cap-item]')]
      .filter(c => c.checked).map(c => captureState.pendientes[Number(c.dataset.capItem)]);
    if (!marcados.length) { closeStudyModals(); return; }
    marcados.forEach(it => {
      const m = it.subject ? materiaPorCurso(it.subject) : null;
      const d = it.dueISO ? new Date(it.dueISO) : null;
      studyItems.push(touch({
        id: uid(), createdAt: Date.now(), source: 'ia', done: false,
        title: it.title || 'Sin título',
        subjectId: m ? m.id : '',
        kind: STUDY_KINDS[it.kind] ? it.kind : 'tarea',
        due: d && !isNaN(d.getTime()) ? isoALocal(d.toISOString()) : '',
        weight: Number(it.weight) > 0 ? Number(it.weight) : 0,
        grade: null,
        notes: it.notes || '',
      }));
    });
    saveAll(); closeStudyModals(); renderStudy();
    toast(`${marcados.length} añadida${marcados.length > 1 ? 's' : ''}`);
    return;
  }

  if (e.target.closest('#moodle-sync-btn')) { syncMoodle({ interactive: true }); return; }

  if (e.target.closest('#moodle-feeds-btn')) {
    openStudyModal('moodle-feeds-modal', () => renderFeedsList());
    return;
  }

  const delF = e.target.closest('[data-feed-delete]');
  if (delF) {
    const feeds = moodleFeeds();
    const f = feeds.find(x => x.id === delF.dataset.feedDelete);
    if (!f || !confirm(`¿Quitar "${f.label}"?\n\nLos pendientes que ya entraron se quedan; sólo deja de consultarse.`)) return;
    guardarFeeds(feeds.filter(x => x.id !== f.id));
    renderFeedsList(); renderStudy(); toast('Calendario quitado');
    return;
  }

  if (e.target.closest('#new-subject-btn')) { openStudyModal('subject-modal'); return; }

  const edS = e.target.closest('[data-subject-edit]');
  if (edS) {
    const s = subjectById(edS.dataset.subjectEdit);
    if (!s) return;
    openStudyModal('subject-modal', form => {
      form.dataset.editing = s.id;
      ['name', 'teacher', 'credits', 'alias'].forEach(k => { if (form[k]) form[k].value = s[k] ?? ''; });
    });
    return;
  }

  const delS = e.target.closest('[data-subject-delete]');
  if (delS) {
    const s = subjectById(delS.dataset.subjectDelete);
    if (!s) return;
    const n = studyItems.filter(i => i.subjectId === s.id).length;
    if (!confirm(`¿Borrar "${s.name}"?${n ? `\n\nTiene ${n} pendiente${n > 1 ? 's' : ''} asociado${n > 1 ? 's' : ''}; se quedan sin materia pero no se borran.` : ''}`)) return;
    tombstone('studySubjects', s.id);
    studySubjects = studySubjects.filter(x => x.id !== s.id);
    saveAll(); renderStudy(); toast('Materia borrada');
    return;
  }

  if (e.target.closest('#new-study-item-btn')) {
    openStudyModal('study-item-modal', form => fillSubjectSelect(form.subjectId));
    return;
  }

  const edI = e.target.closest('[data-study-edit]');
  if (edI) {
    const it = studyItems.find(x => x.id === edI.dataset.studyEdit);
    if (!it) return;
    openStudyModal('study-item-modal', form => {
      form.dataset.editing = it.id;
      form.title.value = it.title || '';
      form.kind.value = it.kind || 'tarea';
      form.due.value = it.due || '';
      form.weight.value = it.weight ?? '';
      form.grade.value = it.grade ?? '';
      form.notes.value = it.notes || '';
      fillSubjectSelect(form.subjectId, it.subjectId);
    });
    return;
  }

  const doneI = e.target.closest('[data-study-done]');
  if (doneI) {
    const it = studyItems.find(x => x.id === doneI.dataset.studyDone);
    if (!it) return;
    it.done = true;
    it.doneAt = Date.now();
    touch(it); saveAll(); renderStudy();
    toast('Hecho' + (Number(it.weight) > 0 ? ' — acuérdate de poner la nota cuando te la den' : ''));
    return;
  }

  const delI = e.target.closest('[data-study-delete]');
  if (delI) {
    const it = studyItems.find(x => x.id === delI.dataset.studyDelete);
    if (!it || !confirm(`¿Borrar "${it.title}"?`)) return;
    tombstone('studyItems', it.id);
    studyItems = studyItems.filter(x => x.id !== it.id);
    saveAll(); renderStudy(); toast('Borrado');
    return;
  }

  const openN = e.target.closest('[data-open-note]');
  if (openN) { irANota(openN.dataset.openNote); return; }

  const newN = e.target.closest('[data-new-note-subject]');
  if (newN) {
    const s = subjectById(newN.dataset.newNoteSubject);
    if (!s || typeof createNote !== 'function') return;
    // createNote recibe un OBJETO, no argumentos sueltos, y el cuerpo se llama
    // `content`. La nota nace ya etiquetada: esa etiqueta es justo lo que la
    // engancha a la materia en el panel de la izquierda.
    const n = createNote({
      title: `${s.name} — apuntes`,
      content: `#${subjectSlug(s.name)}\n\n`,
    });
    if (n) irANota(n.id);
    return;
  }
});

document.addEventListener('change', e => {
  const f = e.target.closest('#study-filtro');
  if (f) { studyUi.filtroMateria = f.value; renderStudy(); return; }

  const foto = e.target.closest('#capture-photo');
  if (foto && foto.files?.[0]) {
    const file = foto.files[0];
    captureStatus('<p class="text-sm">Preparando la foto…</p>', '#2667ff');
    prepararImagen(file)
      .then(img => {
        captureState.imagen = img;
        const kb = Math.round(img.data.length * 0.75 / 1024);
        captureStatus(`
          <div class="flex items-center gap-3">
            <img src="${img.preview}" alt="" class="w-16 h-16 object-cover rounded-lg shrink-0" />
            <div class="min-w-0">
              <p class="text-sm font-semibold">Foto lista</p>
              <p class="text-neutral-500 text-xs">${kb} KB · pulsa Interpretar</p>
            </div>
          </div>`, '#22c55e');
      })
      .catch(err => captureStatus(`<p class="text-sm text-red-500">${escapeHtml(err.message)}</p>`, '#ef4444'));
  }
});

document.getElementById('subject-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const datos = {
    name: (fd.get('name') || '').trim(),
    teacher: (fd.get('teacher') || '').trim(),
    credits: Number(fd.get('credits')) || 0,
    alias: (fd.get('alias') || '').trim(),
  };
  const ed = form.dataset.editing ? subjectById(form.dataset.editing) : null;
  if (ed) Object.assign(ed, datos), touch(ed);
  else studySubjects.push(touch({ id: uid(), createdAt: Date.now(), ...datos }));
  saveAll(); closeStudyModals(); renderStudy();
  toast(ed ? 'Materia actualizada' : 'Materia añadida');
});

document.getElementById('study-item-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const rawGrade = (fd.get('grade') || '').toString().trim();
  const datos = {
    title: (fd.get('title') || '').trim(),
    subjectId: fd.get('subjectId') || '',
    kind: fd.get('kind') || 'tarea',
    due: fd.get('due') || '',
    weight: Number(fd.get('weight')) || 0,
    // null y no 0: una nota de 0.0 es un dato real y distinto de "sin calificar".
    grade: rawGrade === '' ? null : Math.min(NOTA_MAX, Math.max(0, Number(rawGrade))),
    notes: (fd.get('notes') || '').trim(),
  };
  const ed = form.dataset.editing ? studyItems.find(x => x.id === form.dataset.editing) : null;
  if (ed) Object.assign(ed, datos), touch(ed);
  else studyItems.push(touch({ id: uid(), createdAt: Date.now(), done: false, source: 'manual', ...datos }));
  saveAll(); closeStudyModals(); renderStudy();
  toast(ed ? 'Actualizado' : 'Añadido');
});

document.getElementById('moodle-feed-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const url = (fd.get('url') || '').trim();
  try {
    const u = new URL(url);
    if (!u.searchParams.get('authtoken')) {
      alert('Esa URL no lleva authtoken.\n\nAsegúrate de copiar la que sale al pulsar "Obtener URL del calendario", no la de la página del calendario.');
      return;
    }
  } catch {
    alert('No parece una URL válida.');
    return;
  }
  guardarFeeds([...moodleFeeds(), { id: uid(), label: (fd.get('label') || 'ITM').trim(), url }]);
  e.target.reset();
  renderFeedsList(); renderStudy(); toast('Calendario añadido');
});

document.addEventListener('click', e => {
  if (e.target.closest('[data-close-modal]')) closeStudyModals();
});
