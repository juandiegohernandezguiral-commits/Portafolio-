/* 17-templates.js — plantillas de notas y de proyectos.

   Lo que de verdad frena a escribir una nota no es escribirla: es la hoja en
   blanco. Una plantilla convierte "tengo que pensar cómo estructurar esto" en
   "sólo tengo que rellenarlo".

   Dos clases:
     note     → título + cuerpo markdown. Una de ellas puede marcarse como la
                plantilla DIARIA, que es la que usa la nota de cada día.
     project  → nombre + etapas propias + tareas que se crean con el proyecto.

   Los marcadores se sustituyen al instanciar, nunca se guardan resueltos: una
   plantilla con la fecha ya puesta deja de ser una plantilla. */

const TEMPLATE_PLACEHOLDERS = [
  ['{{fecha}}',       d => dateKey(d)],
  ['{{fechaLarga}}',  d => d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
  ['{{dia}}',         d => d.toLocaleDateString('es-CO', { weekday: 'long' })],
  ['{{mes}}',         d => d.toLocaleDateString('es-CO', { month: 'long' })],
  ['{{anio}}',        d => String(d.getFullYear())],
  ['{{semana}}',      d => String(isoWeekNumber(d))],
  ['{{hora}}',        d => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })],
];

/** Número de semana ISO-8601 (la semana 1 es la que contiene el primer jueves). */
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Jueves de esta semana: ancla el cálculo sin depender del día de inicio.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function applyTemplatePlaceholders(text, when = new Date()) {
  let out = String(text || '');
  TEMPLATE_PLACEHOLDERS.forEach(([token, resolve]) => {
    out = out.split(token).join(resolve(when));
  });
  return out;
}

/** Cuerpo de la plantilla marcada como diaria, o null si no hay ninguna. */
function dailyTemplateBody() {
  const tpl = templates.find(t => t.kind === 'note' && t.isDaily);
  return tpl ? tpl.body : null;
}

/* ============ PLANTILLAS DE SERIE ============
   Se siembran una sola vez. No son ejemplos de juguete: son las tres que de
   verdad se usan en un panel personal, para que la función sirva desde el
   primer día en vez de pedir que la configures antes de poder probarla. */

const STARTER_TEMPLATES = [
  {
    kind: 'note', name: 'Nota diaria', isDaily: true,
    titlePattern: '{{fecha}}',
    body: `# {{fechaLarga}}\n\n## Qué pasó hoy\n\n\n## Ideas sueltas\n\n\n## Para mañana\n\n- [ ] \n`,
  },
  {
    kind: 'note', name: 'Notas de reunión', isDaily: false,
    titlePattern: 'Reunión — {{fecha}}',
    body: `# Reunión {{fechaLarga}}\n\n**Con:** \n**Tema:** \n\n## Puntos tratados\n\n- \n\n## Decisiones\n\n- \n\n## Me comprometo a\n\n- [ ] \n`,
  },
  {
    kind: 'project', name: 'Proyecto de cliente',
    namePattern: 'Cliente — ',
    stages: ['Brief', 'Propuesta', 'Diseño', 'Desarrollo', 'Entrega'],
    tasks: [
      { title: 'Reunión inicial y brief', priority: 'high' },
      { title: 'Enviar propuesta y presupuesto', priority: 'high' },
      { title: 'Primera revisión con el cliente', priority: 'med' },
      { title: 'Entrega final y cierre', priority: 'med' },
    ],
  },
];

function seedTemplatesOnce() {
  if (localStorage.getItem('jdh_templatesSeeded')) return;
  STARTER_TEMPLATES.forEach(t => templates.push(touch({ id: uid(), createdAt: Date.now(), ...t })));
  localStorage.setItem('jdh_templatesSeeded', '1');
  saveAll();
}

/* ============ INSTANCIAR ============ */

function useNoteTemplate(templateId) {
  const tpl = templates.find(t => t.id === templateId && t.kind === 'note');
  if (!tpl) return null;
  const now = new Date();
  const note = createNote({
    title: applyTemplatePlaceholders(tpl.titlePattern || tpl.name, now),
    content: applyTemplatePlaceholders(tpl.body, now),
    open: false,
  });
  notesUi.selectedId = note.id;
  notesUi.tagFilter = null;
  notesUi.showArchived = false;
  showView('notes');
  requestAnimationFrame(() => document.getElementById('note-title')?.select());
  toast(`Nota creada desde "${tpl.name}"`);
  return note;
}

function useProjectTemplate(templateId) {
  const tpl = templates.find(t => t.id === templateId && t.kind === 'project');
  if (!tpl) return null;
  const now = new Date();

  const project = touch({
    id: uid(),
    name: applyTemplatePlaceholders(tpl.namePattern || tpl.name, now),
    client: '', desc: '', deadline: '',
    stages: (tpl.stages && tpl.stages.length ? tpl.stages : STAGES).map(s => ({ name: s, done: false })),
    createdAt: Date.now(),
  });
  projects.push(project);

  // Las tareas se crean ya vinculadas al proyecto: una plantilla que te deja
  // enlazarlas a mano después no ahorra el trabajo que decía ahorrar.
  (tpl.tasks || []).forEach(t => {
    tasks.push(touch({
      id: uid(),
      title: applyTemplatePlaceholders(t.title, now),
      desc: '', priority: t.priority || 'med', status: 'todo',
      repeat: 'none', due: '', projectId: project.id,
      createdAt: Date.now(),
    }));
  });

  saveAll();
  showView('projects');
  toast(`Proyecto creado desde "${tpl.name}" con ${(tpl.tasks || []).length} tareas`);
  return project;
}

/* ============ UI ============ */

function renderTemplates() {
  const box = document.getElementById('templates-list');
  if (!box) return;

  const notesTpl = templates.filter(t => t.kind === 'note');
  const projTpl = templates.filter(t => t.kind === 'project');

  const card = t => `
    <div class="surface rounded-2xl p-5">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="min-w-0">
          <h3 class="font-display font-bold truncate">${escapeHtml(t.name)}</h3>
          <p class="meta-label text-neutral-500 mt-0.5">
            ${t.kind === 'note' ? 'nota' : 'proyecto'}${t.isDaily ? ' · se usa para la nota diaria' : ''}
            ${t.kind === 'project' ? ` · ${(t.stages || []).length} etapas · ${(t.tasks || []).length} tareas` : ''}
          </p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" data-tpl-edit="${t.id}" class="meta-label !text-accent px-2 py-1">Editar</button>
          <button type="button" data-tpl-delete="${t.id}" class="text-neutral-400 hover:text-red-500 text-sm px-1">✕</button>
        </div>
      </div>
      <pre class="tpl-preview">${escapeHtml(
        t.kind === 'note'
          ? (t.body || '').split('\n').slice(0, 5).join('\n')
          : (t.tasks || []).map(x => '· ' + x.title).join('\n') || '(sin tareas)'
      )}</pre>
      <button type="button" data-tpl-use="${t.id}" class="w-full mt-3 py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">Usar</button>
    </div>`;

  box.innerHTML = `
    <div class="mb-4">
      <div class="meta-label text-neutral-500 mb-3">Notas</div>
      <div class="grid md:grid-cols-2 gap-4">
        ${notesTpl.map(card).join('') || '<p class="text-neutral-500 text-sm">Sin plantillas de nota.</p>'}
      </div>
    </div>
    <div>
      <div class="meta-label text-neutral-500 mb-3">Proyectos</div>
      <div class="grid md:grid-cols-2 gap-4">
        ${projTpl.map(card).join('') || '<p class="text-neutral-500 text-sm">Sin plantillas de proyecto.</p>'}
      </div>
    </div>`;
}

function openTemplateEditor(templateId) {
  const tpl = templates.find(t => t.id === templateId);
  const modal = document.getElementById('template-modal');
  if (!modal) return;
  const form = document.getElementById('template-form');

  form.reset();
  form.dataset.editing = tpl ? tpl.id : '';
  form.kind.value = tpl ? tpl.kind : 'note';
  form.name.value = tpl ? tpl.name : '';
  form.titlePattern.value = tpl ? (tpl.kind === 'note' ? tpl.titlePattern || '' : tpl.namePattern || '') : '';
  form.body.value = tpl ? (tpl.kind === 'note' ? tpl.body || '' : (tpl.tasks || []).map(t => t.title).join('\n')) : '';
  form.isDaily.checked = !!(tpl && tpl.isDaily);
  form.stages.value = tpl && tpl.kind === 'project' ? (tpl.stages || []).join(', ') : '';

  document.getElementById('template-modal-title').textContent = tpl ? 'Editar plantilla' : 'Nueva plantilla';
  syncTemplateFormKind();
  modal.classList.remove('hidden'); modal.classList.add('flex');
}

/** Muestra sólo los campos que aplican a la clase elegida. */
function syncTemplateFormKind() {
  const form = document.getElementById('template-form');
  if (!form) return;
  const isNote = form.kind.value === 'note';
  document.getElementById('tpl-note-fields')?.classList.toggle('hidden', !isNote);
  document.getElementById('tpl-project-fields')?.classList.toggle('hidden', isNote);
  document.getElementById('tpl-body-label').textContent = isNote ? 'Cuerpo (markdown)' : 'Tareas iniciales (una por línea)';
  form.titlePattern.placeholder = isNote ? 'Título, admite {{fecha}}' : 'Prefijo del nombre del proyecto';
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const use = e.target.closest('[data-tpl-use]');
  if (use) {
    const tpl = templates.find(t => t.id === use.dataset.tplUse);
    if (!tpl) return;
    if (tpl.kind === 'note') useNoteTemplate(tpl.id); else useProjectTemplate(tpl.id);
    return;
  }

  const edit = e.target.closest('[data-tpl-edit]');
  if (edit) { openTemplateEditor(edit.dataset.tplEdit); return; }

  const del = e.target.closest('[data-tpl-delete]');
  if (del) {
    const tpl = templates.find(t => t.id === del.dataset.tplDelete);
    if (!tpl) return;
    if (!confirm(`¿Borrar la plantilla "${tpl.name}"? Las notas y proyectos ya creados con ella no se tocan.`)) return;
    tombstone('templates', tpl.id);
    templates = templates.filter(t => t.id !== tpl.id);
    saveAll(); renderTemplates();
    toast('Plantilla borrada');
    return;
  }

  if (e.target.closest('#new-template-btn')) openTemplateEditor(null);
});

document.getElementById('template-form')?.addEventListener('change', e => {
  if (e.target.name === 'kind') syncTemplateFormKind();
});

document.getElementById('template-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const kind = fd.get('kind');
  const name = (fd.get('name') || '').trim();
  if (!name) return;

  const editingId = form.dataset.editing;
  const existing = editingId ? templates.find(t => t.id === editingId) : null;

  const base = existing || touch({ id: uid(), createdAt: Date.now() });
  base.kind = kind;
  base.name = name;

  if (kind === 'note') {
    base.titlePattern = (fd.get('titlePattern') || '').trim() || name;
    base.body = fd.get('body') || '';
    base.isDaily = fd.get('isDaily') === 'on';
    // Sólo una plantilla puede ser la diaria: dos "la diaria" es un estado
    // ambiguo y ensureDailyNote tendría que elegir arbitrariamente.
    if (base.isDaily) {
      templates.forEach(t => { if (t !== base && t.isDaily) { t.isDaily = false; touch(t); } });
    }
    delete base.stages; delete base.tasks; delete base.namePattern;
  } else {
    base.namePattern = (fd.get('titlePattern') || '').trim() || name;
    base.stages = (fd.get('stages') || '').split(',').map(s => s.trim()).filter(Boolean);
    base.tasks = (fd.get('body') || '').split('\n').map(l => l.trim()).filter(Boolean)
      .map(title => ({ title, priority: 'med' }));
    base.isDaily = false;
    delete base.body; delete base.titlePattern;
  }

  touch(base);
  if (!existing) templates.push(base);
  saveAll();

  const modal = document.getElementById('template-modal');
  modal.classList.add('hidden'); modal.classList.remove('flex');
  renderTemplates();
  toast(existing ? 'Plantilla actualizada' : 'Plantilla creada');
});

/** Menú rápido de plantillas de nota, desde la vista de Notas. */
function openNoteTemplatePicker() {
  const notesTpl = templates.filter(t => t.kind === 'note');
  if (!notesTpl.length) { showView('auto'); toast('Crea primero una plantilla'); return; }
  const m = document.getElementById('tpl-picker-modal');
  const list = document.getElementById('tpl-picker-list');
  list.innerHTML = notesTpl.map(t => `
    <button type="button" data-tpl-use="${t.id}" class="palette-row w-full text-left px-4 py-3 text-sm">
      <span class="font-semibold">${escapeHtml(t.name)}</span>
      <span class="block meta-label text-neutral-500">${escapeHtml(markdownToPlain(t.body, 60))}</span>
    </button>`).join('');
  m.classList.remove('hidden'); m.classList.add('flex');
}

document.getElementById('tpl-from-btn')?.addEventListener('click', openNoteTemplatePicker);
document.getElementById('tpl-picker-modal')?.addEventListener('click', e => {
  // Cierra al pulsar el fondo o al elegir una plantilla
  if (e.target.id === 'tpl-picker-modal' || e.target.closest('[data-tpl-use]')) {
    e.currentTarget.classList.add('hidden');
    e.currentTarget.classList.remove('flex');
  }
});
