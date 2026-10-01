/* 16-rules.js — reglas automáticas: el panel vigilando por ti.

   POR QUÉ REGLAS CON TIPO Y NO UN CONSTRUCTOR GENÉRICO
   Un "si <campo> <operador> <valor> entonces <acción>" genérico suena más
   potente, pero para una sola persona es mucha interfaz para algo que se
   configura una vez y luego se olvida. Aquí cada regla es de un TIPO concreto
   con dos o tres parámetros: se entiende de un vistazo qué hace y no hay forma
   de construir una combinación sin sentido.

   QUÉ PUEDE Y QUÉ NO PUEDE HACER UNA REGLA
   Las que MUTAN se limitan a cambios reversibles (prioridad, estado). Las que
   implicarían borrar sólo AVISAN. En un segundo cerebro el peor fallo posible
   es perder datos, y una automatización que borra sola mientras no estás
   mirando es exactamente esa forma de perderlos.

   IDEMPOTENCIA
   Las reglas que mutan lo son por construcción: el cambio hace que la condición
   deje de cumplirse (subir a prioridad alta hace que "no es alta" sea falso).
   Las que avisan necesitan memoria explícita, porque la condición sigue siendo
   cierta mañana: se deduplican por regla + entidad + día. */

/* Los avisos son LOCALES de este dispositivo, no van en el sync: son la
   bandeja de "esto me lo dijo el panel", y verla duplicada en dos aparatos
   sería ruido, no información. */
const RULE_NOTICE_CAP = 50;
let ruleNotices = store.get('ruleNotices', []);
let ruleSeen = store.get('ruleSeen', {});

function saveRuleState() {
  store.set('ruleNotices', ruleNotices.slice(0, RULE_NOTICE_CAP));
  store.set('ruleSeen', ruleSeen);
}

function pushNotice(key, text, jumpTo) {
  if (ruleSeen[key]) return false;
  ruleSeen[key] = Date.now();
  ruleNotices.unshift({ id: uid(), key, text, jumpTo: jumpTo || null, at: Date.now(), read: false });
  ruleNotices = ruleNotices.slice(0, RULE_NOTICE_CAP);
  return true;
}

/** Limpia las marcas de deduplicación de días pasados. */
function pruneRuleSeen() {
  const cutoff = Date.now() - 14 * 86400000;
  Object.keys(ruleSeen).forEach(k => { if (ruleSeen[k] < cutoff) delete ruleSeen[k]; });
}

const todayStamp = () => dateKey(new Date());

/* ============ CATÁLOGO DE TIPOS ============ */

const RULE_TYPES = {
  'escalate-overdue': {
    label: 'Subir prioridad de lo vencido',
    description: 'Una tarea que lleva demasiado vencida pasa a prioridad alta.',
    mutates: true,
    params: [{ key: 'hours', label: 'Vencida hace más de (horas)', type: 'number', def: 24, min: 1, max: 720 }],
    run(rule) {
      const limit = Date.now() - (rule.params.hours || 24) * 3600000;
      let changed = 0;
      tasks.forEach(t => {
        if (t.status === 'done' || t.priority === 'high' || !t.due) return;
        const due = parseDue(t.due);
        if (!due || due.getTime() > limit) return;
        t.priority = 'high';
        touch(t);
        changed++;
      });
      return { changed, notices: changed ? [{ key: `${rule.id}:bulk:${todayStamp()}`, text: `${changed} tarea${changed > 1 ? 's' : ''} vencida${changed > 1 ? 's' : ''} pasó a prioridad alta.`, jumpTo: 'tasks' }] : [] };
    },
  },

  'stalled-doing': {
    label: 'Rescatar tareas estancadas',
    description: 'Avisa de lo que lleva demasiado tiempo en "En progreso" sin tocarse.',
    mutates: false,
    params: [{ key: 'days', label: 'Sin cambios desde hace (días)', type: 'number', def: 7, min: 1, max: 90 }],
    run(rule) {
      const limit = Date.now() - (rule.params.days || 7) * 86400000;
      const notices = [];
      tasks.forEach(t => {
        if (t.status !== 'doing') return;
        if ((t.updatedAt || 0) > limit) return;
        notices.push({
          key: `${rule.id}:${t.id}:${todayStamp()}`,
          text: `"${t.title}" lleva ${Math.round((Date.now() - (t.updatedAt || 0)) / 86400000)} días en progreso sin cambios.`,
          jumpTo: 'tasks',
        });
      });
      return { changed: 0, notices };
    },
  },

  'deadline-soon': {
    label: 'Entregas que se acercan',
    description: 'Avisa de proyectos cuya fecha de entrega está cerca y aún no están terminados.',
    mutates: false,
    params: [{ key: 'days', label: 'Avisar con (días) de antelación', type: 'number', def: 7, min: 1, max: 120 }],
    run(rule) {
      const horizon = Date.now() + (rule.params.days || 7) * 86400000;
      const notices = [];
      projects.forEach(p => {
        if (!p.deadline) return;
        const when = new Date(p.deadline).getTime();
        if (isNaN(when) || when > horizon) return;
        const done = p.stages.filter(s => s.done).length;
        if (done === p.stages.length) return;    // ya terminado, no hay nada que avisar
        const daysLeft = Math.ceil((when - Date.now()) / 86400000);
        notices.push({
          key: `${rule.id}:${p.id}:${todayStamp()}`,
          text: daysLeft < 0
            ? `"${p.name}" pasó su fecha de entrega hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) > 1 ? 's' : ''} y sigue al ${Math.round(done / p.stages.length * 100)}%.`
            : `"${p.name}" entrega en ${daysLeft} día${daysLeft !== 1 ? 's' : ''} y va al ${Math.round(done / p.stages.length * 100)}%.`,
          jumpTo: 'projects',
        });
      });
      return { changed: 0, notices };
    },
  },

  'streak-at-risk': {
    label: 'Racha en riesgo',
    description: 'Si llevas una racha buena y hoy aún no marcas el hábito, te lo recuerda al final del día.',
    mutates: false,
    params: [
      { key: 'minStreak', label: 'Racha mínima para avisar (días)', type: 'number', def: 3, min: 1, max: 365 },
      { key: 'afterHour', label: 'Avisar a partir de la hora', type: 'number', def: 18, min: 0, max: 23 },
    ],
    run(rule) {
      if (new Date().getHours() < (rule.params.afterHour ?? 18)) return { changed: 0, notices: [] };
      const idx = habitLogIndex();
      const key = todayStamp();
      const notices = [];
      habits.forEach(h => {
        if (h.archived || !isScheduled(h, new Date())) return;
        if (isHabitDone(h.id, key, idx)) return;
        const streak = currentStreak(h, idx);
        if (streak < (rule.params.minStreak || 3)) return;
        notices.push({
          key: `${rule.id}:${h.id}:${key}`,
          text: `Llevas ${streak} días con "${h.name}" y hoy aún no lo marcas.`,
          jumpTo: 'habits',
        });
      });
      return { changed: 0, notices };
    },
  },

  'untracked-high': {
    label: 'Prioridad alta sin fecha',
    description: 'Avisa de tareas importantes que no tienen vencimiento, para que no se queden flotando.',
    mutates: false,
    params: [],
    run(rule) {
      const notices = [];
      tasks.forEach(t => {
        if (t.status === 'done' || t.priority !== 'high' || t.due) return;
        notices.push({
          key: `${rule.id}:${t.id}:${todayStamp()}`,
          text: `"${t.title}" es prioridad alta pero no tiene fecha de vencimiento.`,
          jumpTo: 'tasks',
        });
      });
      return { changed: 0, notices };
    },
  },

  'daily-note': {
    label: 'Crear la nota diaria',
    description: 'Al abrir el panel, crea la nota de hoy si todavía no existe (usa tu plantilla diaria si tienes una).',
    mutates: true,
    params: [],
    run(rule) {
      const stamp = todayStamp();
      if (notes.some(n => n.daily === stamp)) return { changed: 0, notices: [] };
      // `false` = no abrirla ni cambiar de vista: una regla no debe secuestrar
      // la navegación por su cuenta.
      ensureDailyNote({ focus: false });
      return { changed: 1, notices: [{ key: `${rule.id}:${stamp}`, text: 'Nota diaria de hoy creada.', jumpTo: 'notes' }] };
    },
  },
};

/* ============ MOTOR ============ */

let rulesRunning = false;

/**
 * Evalúa todas las reglas activas.
 * `interactive` muestra un resumen aunque no haya pasado nada — para el botón
 * "Ejecutar ahora", donde el silencio se confundiría con que no funciona.
 */
function runRules({ interactive = false } = {}) {
  // Sin esta guarda: una regla muta → saveAll → onDataChanged → runRules → muta…
  if (rulesRunning) return { changed: 0, newNotices: 0 };
  rulesRunning = true;

  let changed = 0;
  let newNotices = 0;
  pruneRuleSeen();

  try {
    rules.forEach(rule => {
      if (!rule.enabled) return;
      const type = RULE_TYPES[rule.type];
      if (!type) return;      // regla de un tipo que ya no existe: se ignora
      let result;
      try {
        result = type.run(rule) || { changed: 0, notices: [] };
      } catch (err) {
        console.warn(`[rules] la regla "${rule.name || rule.type}" falló:`, err);
        return;
      }
      changed += result.changed || 0;
      (result.notices || []).forEach(n => { if (pushNotice(n.key, n.text, n.jumpTo)) newNotices++; });
      if (result.changed || (result.notices || []).length) {
        rule.lastRunAt = Date.now();
        rule.runCount = (rule.runCount || 0) + (result.changed || 0);
        touch(rule);
      }
    });

    saveRuleState();
    if (changed) saveAll();
  } finally {
    rulesRunning = false;
  }

  if (changed || newNotices) {
    if (typeof refreshActiveView === 'function') refreshActiveView();
    renderNoticeBadge();
    if (newNotices) toast(`${newNotices} aviso${newNotices > 1 ? 's' : ''} nuevo${newNotices > 1 ? 's' : ''} de tus reglas`);
  } else if (interactive) {
    toast('Reglas ejecutadas: nada que reportar');
  }
  return { changed, newNotices };
}

/* Disparadores. Igual que el sync, con rebote: una ráfaga de cambios no debe
   provocar una evaluación por cada uno. */
let rulesTimer = null;
function scheduleRules() {
  if (rulesRunning) return;
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(() => runRules(), 3000);
}
if (typeof dataChangeHandlers !== 'undefined') dataChangeHandlers.push(scheduleRules);

setInterval(() => {
  if (isDashboardOpen() && document.visibilityState === 'visible') runRules();
}, 10 * 60 * 1000);

/* ============ BANDEJA DE AVISOS ============ */

function unreadNotices() { return ruleNotices.filter(n => !n.read); }

function renderNoticeBadge() {
  const badge = document.getElementById('notice-badge');
  if (!badge) return;
  const count = unreadNotices().length;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function markNoticesRead() {
  ruleNotices.forEach(n => { n.read = true; });
  saveRuleState();
  renderNoticeBadge();
}

/** Bloque de avisos para la vista Hoy. */
function noticesBlock() {
  const unread = unreadNotices();
  if (!unread.length) return '';
  return `
    <div class="surface rounded-2xl p-6" style="border-left:3px solid #f59e0b;">
      <div class="flex items-center justify-between mb-4 gap-3">
        <h3 class="font-display font-bold flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-amber-500"></span> Avisos
        </h3>
        <button type="button" id="notices-clear-btn" class="meta-label !text-accent">Marcar leídos</button>
      </div>
      <div class="space-y-2">
        ${unread.slice(0, 6).map(n => `
          <div class="flex items-start gap-3 p-3 rounded-xl surface-soft">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
            <p class="text-sm flex-1">${escapeHtml(n.text)}</p>
            ${n.jumpTo ? `<button type="button" data-jump="${n.jumpTo}" class="meta-label !text-accent shrink-0">Ver →</button>` : ''}
          </div>`).join('')}
        ${unread.length > 6 ? `<p class="meta-label text-neutral-500 pt-1">y ${unread.length - 6} más</p>` : ''}
      </div>
    </div>`;
}

/* ============ UI DE CONFIGURACIÓN ============ */

function defaultParams(type) {
  const out = {};
  (RULE_TYPES[type]?.params || []).forEach(p => { out[p.key] = p.def; });
  return out;
}

function addRule(type) {
  if (!RULE_TYPES[type]) return;
  rules.push(touch({
    id: uid(),
    type,
    name: RULE_TYPES[type].label,
    enabled: true,
    params: defaultParams(type),
    runCount: 0,
    lastRunAt: null,
    createdAt: Date.now(),
  }));
  saveAll();
  renderRules();
  runRules({ interactive: true });
}

function renderRules() {
  const box = document.getElementById('rules-list');
  if (!box) return;

  const available = Object.entries(RULE_TYPES)
    .filter(([type]) => !rules.some(r => r.type === type));

  box.innerHTML = `
    ${rules.length ? rules.map(r => {
      const type = RULE_TYPES[r.type];
      if (!type) return '';
      return `
        <div class="surface rounded-2xl p-5">
          <div class="flex items-start gap-4 mb-3">
            <button type="button" data-rule-toggle="${r.id}" class="switch ${r.enabled ? 'is-on' : ''} shrink-0" title="${r.enabled ? 'Desactivar' : 'Activar'}">
              <span class="switch-knob"></span>
            </button>
            <div class="min-w-0 flex-1">
              <h3 class="font-display font-bold">${escapeHtml(type.label)}</h3>
              <p class="text-neutral-500 text-sm mt-0.5">${escapeHtml(type.description)}</p>
              <p class="meta-label text-neutral-400 mt-1.5">
                ${type.mutates ? 'modifica datos' : 'sólo avisa'}${r.runCount ? ` · ${r.runCount} cambios aplicados` : ''}
              </p>
            </div>
            <button type="button" data-rule-delete="${r.id}" class="text-neutral-400 hover:text-red-500 text-sm shrink-0">✕</button>
          </div>
          ${type.params.length ? `
            <div class="grid sm:grid-cols-2 gap-3 pt-3 border-t border-neutral-200 dark:border-white/5">
              ${type.params.map(p => `
                <label class="block">
                  <span class="meta-label text-neutral-500 block mb-1.5">${escapeHtml(p.label)}</span>
                  <input type="number" min="${p.min}" max="${p.max}" value="${r.params[p.key] ?? p.def}"
                         data-rule-param="${r.id}|${p.key}"
                         class="w-full surface-soft rounded-xl px-4 py-2.5 focus:border-accent focus:outline-none" />
                </label>`).join('')}
            </div>` : ''}
        </div>`;
    }).join('') : '<div class="surface rounded-2xl p-10 text-center text-neutral-500 text-sm">Sin reglas todavía. Añade una de las de abajo.</div>'}

    ${available.length ? `
      <div class="surface rounded-2xl p-5">
        <div class="meta-label text-neutral-500 mb-3">Añadir regla</div>
        <div class="grid sm:grid-cols-2 gap-2">
          ${available.map(([type, def]) => `
            <button type="button" data-rule-add="${type}" class="text-left p-3 rounded-xl surface-soft hover:border-accent transition">
              <div class="font-semibold text-sm">${escapeHtml(def.label)}</div>
              <div class="text-neutral-500 text-xs mt-0.5">${escapeHtml(def.description)}</div>
            </button>`).join('')}
        </div>
      </div>` : ''}`;
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const toggle = e.target.closest('[data-rule-toggle]');
  if (toggle) {
    const r = rules.find(x => x.id === toggle.dataset.ruleToggle);
    if (!r) return;
    r.enabled = !r.enabled;
    touch(r); saveAll(); renderRules();
    if (r.enabled) runRules();
    return;
  }

  const add = e.target.closest('[data-rule-add]');
  if (add) { addRule(add.dataset.ruleAdd); return; }

  const del = e.target.closest('[data-rule-delete]');
  if (del) {
    const r = rules.find(x => x.id === del.dataset.ruleDelete);
    if (!r) return;
    if (!confirm(`¿Quitar la regla "${RULE_TYPES[r.type]?.label || r.type}"?`)) return;
    tombstone('rules', r.id);
    rules = rules.filter(x => x.id !== r.id);
    saveAll(); renderRules();
    return;
  }

  if (e.target.closest('#notices-clear-btn')) {
    markNoticesRead();
    if (typeof renderToday === 'function' && activeView === 'today') renderToday();
    return;
  }

  if (e.target.closest('#rules-run-btn')) runRules({ interactive: true });
});

/* Pestañas Reglas / Plantillas dentro de la vista Automatización. Mismo patrón
   que las pestañas de Agenda (showAgendaTab en js/06-integrations.js). */
function showAutoTab(name) {
  document.querySelectorAll('[data-auto-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.autoPanel !== name));
  document.querySelectorAll('.auto-tab-btn').forEach(b => {
    const active = b.dataset.autoTab === name;
    b.classList.toggle('bg-accent', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('text-neutral-500', !active);
  });
  if (name === 'templates' && typeof renderTemplates === 'function') renderTemplates();
  else renderRules();
  store.set('autoTab', name);
}
document.querySelectorAll('.auto-tab-btn').forEach(b =>
  b.addEventListener('click', () => showAutoTab(b.dataset.autoTab)));

document.addEventListener('change', e => {
  const param = e.target.closest('[data-rule-param]');
  if (!param) return;
  const [ruleId, key] = param.dataset.ruleParam.split('|');
  const r = rules.find(x => x.id === ruleId);
  if (!r) return;
  const def = RULE_TYPES[r.type].params.find(p => p.key === key);
  // Se acota al rango declarado: un valor fuera de rango escrito a mano haría
  // que la regla se comportara de forma que su propia descripción no explica.
  const value = Math.min(Math.max(Number(param.value) || def.def, def.min), def.max);
  param.value = value;
  r.params[key] = value;
  touch(r); saveAll();
  runRules();
});
