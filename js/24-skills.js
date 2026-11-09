/* ============================================================================
   HABILIDADES — "¿qué sé hacer, y qué me falta?"
   ============================================================================

   Rellena la sub-pestaña «Desarrollo de Software» de Estudio reemplazando el
   renderDev() de js/22-study.js, igual que 23-projects.js reemplaza a
   renderProjects(). Está en un archivo aparte y NO dentro del 22 por una razón
   concreta de orden de carga: necesita proyMinutos() y notasDeProyecto(), que
   viven en el 23 y por tanto cargan después del 22.

   POR QUÉ NO ES LO MISMO QUE PROYECTOS

   Proyectos mide ESFUERZOS: en qué estás metido, cuánto has avanzado, qué
   dejaste quieto. Esta vista mide CAPACIDADES: qué sabes hacer de verdad. Son
   cosas distintas — puedes haber terminado tres proyectos y seguir sin dominar
   lo que usaste, y puedes dominar algo sin tener ningún proyecto abierto con
   ello ahora mismo.

   EL NIVEL LO PONES TÚ; LA EVIDENCIA NO

   Nadie puede medir automáticamente si sabes JavaScript, así que el nivel es
   una autoevaluación y no hay forma de evitarlo. Lo que sí se mide es la
   EVIDENCIA: proyectos enlazados, apuntes escritos y horas de enfoque reales.

   Y ahí está lo único que esta vista hace que una lista no haría: avisar
   cuando el nivel que te pusiste no tiene nada detrás. Decir «practicando
   React» con cero proyectos, cero apuntes y cero horas es exactamente el tipo
   de número creíble y falso que el resto del panel evita — el mismo problema
   que el progreso por etapas en Proyectos o el CPA en Dropshipping.
   ============================================================================ */

/* Nivel 0 es la lista de deseos: lo que quieres aprender pero no has
   empezado. Va en la misma colección y no en otra aparte porque pasar de
   "quiero" a "empezando" es la transición que importa, y entre dos listas
   separadas eso significaría borrar de una y crear en otra. */
const SKILL_NIVELES = [
  { n: 0, label: 'Quiero aprenderlo', corto: 'Por empezar', color: '#71717a' },
  { n: 1, label: 'Empezando',         corto: 'Empezando',   color: '#f59e0b' },
  { n: 2, label: 'Fundamentos',       corto: 'Fundamentos', color: '#eab308' },
  { n: 3, label: 'Practicando',       corto: 'Practicando', color: '#2667ff' },
  { n: 4, label: 'Lo uso en serio',   corto: 'En serio',    color: '#22c55e' },
  { n: 5, label: 'Podría enseñarlo',  corto: 'Lo enseño',   color: '#a855f7' },
];

/* A partir de este nivel se espera ver algo detrás. Por debajo no: estar
   empezando algo y no tener todavía ni un proyecto ni un apunte es lo normal,
   y avisar ahí sería ruido en el momento en que menos ayuda. */
const SKILL_NIVEL_EXIGE_PRUEBA = 3;

const skillUi = { editando: null };

function skillNivel(n) {
  return SKILL_NIVELES[Math.max(0, Math.min(5, Number(n) || 0))];
}

/** Etiqueta con la que un apunte queda enganchado a esta habilidad.
 *  Se reutiliza subjectSlug() por lo mismo que en Proyectos: dos generadores
 *  de slugs acabarían separándose y los apuntes dejarían de aparecer sin dar
 *  ningún error. */
function skillTag(s) {
  if (typeof subjectSlug !== 'function') return '';
  return subjectSlug(s && s.name);
}

/**
 * Evidencia real detrás de una habilidad.
 *
 * Las horas sólo cuentan si vienen de un proyecto ENLAZADO: el tiempo de
 * enfoque se registra contra proyectos, no contra habilidades, así que sin
 * enlace no hay forma honesta de atribuirlo.
 */
function skillEvidencia(s) {
  const ids = Array.isArray(s.projectIds) ? s.projectIds : [];
  const proys = (typeof projects !== 'undefined' ? projects : []).filter(p => ids.includes(p.id));

  const tag = skillTag(s);
  const apuntes = (tag && typeof notes !== 'undefined' && typeof tieneEtiqueta === 'function')
    ? notes.filter(n => !n.archived && tieneEtiqueta((n.title || '') + ' ' + (n.content || ''), tag))
    : [];

  const minutos = typeof proyMinutos === 'function'
    ? proys.reduce((m, p) => m + proyMinutos(p), 0) : 0;

  return {
    proyectos: proys,
    apuntes,
    minutos,
    terminados: proys.filter(p => p.status === 'terminado').length,
    total: proys.length + apuntes.length + (minutos > 0 ? 1 : 0),
  };
}

/** Una habilidad cuyo nivel declarado no tiene nada detrás. */
function skillSinRespaldo(s) {
  if ((Number(s.level) || 0) < SKILL_NIVEL_EXIGE_PRUEBA) return false;
  return skillEvidencia(s).total === 0;
}

function skillFmtHoras(m) {
  if (!m) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h`;
}

/** Los cinco puntos del nivel. */
function skillPuntos(nivel) {
  const col = skillNivel(nivel).color;
  return `<span class="skill-puntos" aria-hidden="true">${
    [1, 2, 3, 4, 5].map(i => `<i style="${i <= nivel ? 'background:' + col : ''}"></i>`).join('')
  }</span>`;
}

/* ============ VISTA ============ */

function renderDev() {
  const box = document.getElementById('study-panel');
  if (!box) return;

  const orden = [...skills].sort((a, b) => (b.level || 0) - (a.level || 0)
    || (a.name || '').localeCompare(b.name || ''));
  const activas = orden.filter(s => (s.level || 0) > 0);
  const deseadas = orden.filter(s => (s.level || 0) === 0);
  const flojas = activas.filter(skillSinRespaldo);
  const minutosTotales = activas.reduce((m, s) => m + skillEvidencia(s).minutos, 0);

  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Habilidades', String(activas.length), 'en construcción o ya tuyas')}
      ${statTile('Sólidas', String(activas.filter(s => (s.level || 0) >= 4).length),
        'las usas en serio', activas.some(s => (s.level || 0) >= 4) ? 'text-green-600 dark:text-green-400' : '')}
      ${statTile('Horas medidas', skillFmtHoras(minutosTotales) || '—', 'con el temporizador')}
      ${statTile('Quieres aprender', String(deseadas.length), 'aún sin empezar')}
    </div>

    ${flojas.length ? `
      <div class="surface rounded-2xl p-6 mb-6" style="border-left:3px solid #f59e0b;">
        <h3 class="font-display font-bold mb-1">${flojas.length} habilidad${flojas.length > 1 ? 'es' : ''} sin nada detrás</h3>
        <p class="text-neutral-500 text-sm leading-relaxed mb-4 max-w-2xl">
          Te pusiste ${flojas.length > 1 ? 'estos niveles' : 'este nivel'} pero no hay ningún proyecto
          enlazado, ningún apunte ni horas medidas. El nivel lo pones tú y está bien que así sea —
          pero sin nada que lo respalde es una opinión, no una habilidad. Enlázale un proyecto,
          escribe apuntes, o bájale el nivel.
        </p>
        <div class="flex gap-2 flex-wrap">
          ${flojas.map(s => `
            <button type="button" data-skill-editar="${s.id}"
              class="surface-soft rounded-xl px-3.5 py-2 hover:border-accent transition text-left">
              <div class="text-sm font-semibold">${escapeHtml(s.name)}</div>
              <div class="meta-label text-amber-500">${skillNivel(s.level).label}</div>
            </button>`).join('')}
        </div>
      </div>` : ''}

    <div class="flex items-center gap-3 flex-wrap mb-5">
      <button type="button" data-skill-nueva
        class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[11px] uppercase tracking-[0.25em]">+ Habilidad</button>
      <p class="text-neutral-500 text-xs">El nivel lo pones tú. La evidencia sale de tus proyectos, apuntes y horas.</p>
    </div>

    ${activas.length ? `<div class="space-y-2 mb-6">${activas.map(skillFila).join('')}</div>` : `
      <div class="surface rounded-2xl p-10 text-center mb-6">
        <p class="font-display font-bold text-lg mb-1">Sin habilidades todavía</p>
        <p class="text-neutral-500 text-sm max-w-lg mx-auto leading-relaxed">
          Apunta lo que estás aprendiendo — un lenguaje, una herramienta, un área. Enlázale los
          proyectos donde lo usas y etiqueta tus apuntes con su nombre, y esta vista te dice
          cuánto hay de verdad detrás de cada una.
        </p>
      </div>`}

    ${deseadas.length ? `
      <div class="surface rounded-2xl p-6">
        <h3 class="font-display font-bold text-sm mb-1">Lo que quieres aprender</h3>
        <p class="text-neutral-500 text-xs mb-4">Súbelas a «Empezando» el día que les metas la primera hora.</p>
        <div class="flex gap-2 flex-wrap">
          ${deseadas.map(s => `
            <button type="button" data-skill-editar="${s.id}"
              class="surface-soft rounded-xl px-3.5 py-2 hover:border-accent transition mono text-xs">
              ${escapeHtml(s.name)}
            </button>`).join('')}
        </div>
      </div>` : ''}`;
}

function skillFila(s) {
  const nivel = skillNivel(s.level);
  const ev = skillEvidencia(s);
  const tag = skillTag(s);
  const floja = skillSinRespaldo(s);

  const piezas = [];
  if (ev.proyectos.length) piezas.push(`${ev.proyectos.length} proyecto${ev.proyectos.length > 1 ? 's' : ''}`);
  if (ev.apuntes.length) piezas.push(`${ev.apuntes.length} apunte${ev.apuntes.length > 1 ? 's' : ''}`);
  if (ev.minutos) piezas.push(skillFmtHoras(ev.minutos));

  return `
    <div class="surface rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap ${floja ? 'border-l-2 border-l-amber-500' : ''}">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="font-display font-bold">${escapeHtml(s.name)}</span>
          ${skillPuntos(s.level)}
          <span class="meta-label" style="color:${nivel.color}">${nivel.corto}</span>
        </div>
        <div class="meta-label text-neutral-500 mt-1">
          ${piezas.length ? piezas.join(' · ')
            : `<span class="${floja ? 'text-amber-500' : ''}">sin evidencia · etiqueta apuntes con <span class="mono">#${tag}</span></span>`}
        </div>
      </div>
      <div class="flex gap-1.5 shrink-0">
        <button type="button" data-skill-sube="${s.id}" title="Subir nivel"
          class="w-8 h-8 rounded-lg surface-soft text-neutral-500 hover:text-accent transition">▲</button>
        <button type="button" data-skill-editar="${s.id}" title="Editar"
          class="w-8 h-8 rounded-lg surface-soft text-neutral-500 hover:text-accent transition">✎</button>
      </div>
    </div>`;
}

/* ============ MODAL ============ */

function abrirModalSkill(s) {
  const modal = document.getElementById('skill-modal');
  const form = document.getElementById('skill-form');
  if (!modal || !form) return;

  skillUi.editando = s ? s.id : null;
  form.reset();

  // La lista de proyectos se arma cada vez: pudo cambiar desde la última.
  const caja = document.getElementById('skill-proyectos');
  if (caja) {
    const ids = s && Array.isArray(s.projectIds) ? s.projectIds : [];
    caja.innerHTML = projects.length
      ? projects.map(p => `
          <label class="flex items-center gap-2.5 py-1.5 cursor-pointer">
            <input type="checkbox" name="proyecto" value="${p.id}" ${ids.includes(p.id) ? 'checked' : ''}
              class="accent-[#2667ff]" />
            <span class="text-sm truncate">${escapeHtml(p.name)}</span>
          </label>`).join('')
      : `<p class="text-neutral-500 text-xs leading-relaxed">
           No tienes proyectos todavía. Crea uno en Proyectos y podrás enlazarlo aquí para que
           sus horas cuenten como evidencia.
         </p>`;
  }

  if (s) {
    form.name.value = s.name || '';
    form.level.value = String(s.level || 0);
  }
  const borrar = document.getElementById('skill-borrar');
  if (borrar) borrar.classList.toggle('hidden', !s);
  const titulo = modal.querySelector('h3');
  if (titulo) titulo.textContent = s ? 'Editar habilidad' : 'Nueva habilidad';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  form.name.focus();
}

function cerrarModalSkill() {
  const modal = document.getElementById('skill-modal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
  skillUi.editando = null;
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  if (e.target.closest('[data-skill-nueva]')) { abrirModalSkill(null); return; }

  const ed = e.target.closest('[data-skill-editar]');
  if (ed) {
    const s = skills.find(x => x.id === ed.dataset.skillEditar);
    if (s) abrirModalSkill(s);
    return;
  }

  /* Subir de nivel con un clic. Es el gesto más frecuente con diferencia —
     una habilidad sube de nivel muchas más veces de las que se edita — y
     obligar a abrir un modal para eso haría que no se actualizara nunca. */
  const sube = e.target.closest('[data-skill-sube]');
  if (sube) {
    const s = skills.find(x => x.id === sube.dataset.skillSube);
    if (!s) return;
    const antes = Number(s.level) || 0;
    if (antes >= 5) { toast(`${s.name} ya está al máximo`); return; }
    s.level = antes + 1;
    touch(s); saveAll(); renderStudy();
    toast(`${s.name}: ${skillNivel(s.level).label.toLowerCase()}`);
    return;
  }

  if (e.target.closest('#skill-modal [data-close-modal]')) { skillUi.editando = null; return; }

  const bor = e.target.closest('#skill-borrar');
  if (bor) {
    const s = skills.find(x => x.id === skillUi.editando);
    if (!s) return;
    /* Los apuntes etiquetados NO se tocan: viven en Mi cerebro y son tuyos.
       Borrar la habilidad sólo quita la ficha que los agrupaba. */
    if (!confirm(`¿Borrar la habilidad "${s.name}"?\n\nTus apuntes y proyectos se quedan como están.`)) return;
    tombstone('skills', s.id);
    skills = skills.filter(x => x.id !== s.id);
    saveAll(); cerrarModalSkill(); renderStudy();
    toast('Habilidad borrada');
    return;
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('#skill-form');
  if (!form) return;
  e.preventDefault();

  const fd = new FormData(form);
  const nombre = (fd.get('name') || '').trim();
  if (!nombre) return;
  const nivel = Math.max(0, Math.min(5, Number(fd.get('level')) || 0));
  const proyectos = fd.getAll('proyecto');

  if (skillUi.editando) {
    const s = skills.find(x => x.id === skillUi.editando);
    if (s) {
      s.name = nombre;
      s.level = nivel;
      s.projectIds = proyectos;
      touch(s);
    }
  } else {
    skills.push(touch({
      id: uid(), name: nombre, level: nivel, projectIds: proyectos, createdAt: Date.now(),
    }));
  }

  saveAll();
  cerrarModalSkill();
  renderStudy();
});
