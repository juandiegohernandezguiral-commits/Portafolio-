/* 11-notes.js — las notas como sistema de conocimiento, no como lista.

   Lo que cambia respecto a la versión anterior (una rejilla de tarjetas de texto
   plano):
     · Markdown real, con vista previa en vivo (js/10-markdown.js)
     · Enlaces [[Nota]] entre notas, con retroenlaces calculados automáticamente
     · Etiquetas #tag extraídas del propio texto, no un campo aparte que hay que
       mantener a mano
     · Nota diaria: una nota por día, creada al vuelo
     · Autoguardado — en un segundo cerebro, perder lo que acabas de escribir
       porque no pulsaste "Guardar" es inaceptable

   Los títulos son la identidad a efectos de enlace: [[Algo]] resuelve por
   título, no por id. Si hay dos notas con el mismo título gana la más
   recientemente modificada, y la lista avisa del choque. */

/* ============ ESTADO DE LA VISTA ============ */

const notesUi = {
  selectedId: null,
  query: '',
  tagFilter: null,
  showArchived: false,
  mode: store.get('notesMode', 'split'), // 'write' | 'split' | 'preview'
};

/* ============ ÍNDICE ============
   Se recalcula cuando cambian las notas. Barato (decenas o cientos de notas),
   así que no se intenta mantener incrementalmente: menos estado que sincronizar
   es menos sitios donde quedar desfasado. */

let notesIndexCache = null;

function invalidateNotesIndex() { notesIndexCache = null; }

function notesIndex() {
  if (notesIndexCache) return notesIndexCache;

  const byTitle = new Map();     // título en minúsculas -> nota
  const duplicates = new Set();
  const tagCounts = new Map();
  const outLinks = new Map();    // id de nota -> Set de títulos enlazados
  const backLinks = new Map();   // id de nota -> Set de ids que la enlazan

  notes.forEach(n => {
    const key = (n.title || '').trim().toLowerCase();
    if (!key) return;
    const existing = byTitle.get(key);
    if (existing) {
      duplicates.add(key);
      // Gana la más reciente, para que un enlace apunte a lo que estás usando.
      if ((n.updatedAt || 0) > (existing.updatedAt || 0)) byTitle.set(key, n);
    } else {
      byTitle.set(key, n);
    }
  });

  notes.forEach(n => {
    extractTags(n.content).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1));
    const links = extractWikiLinks(n.content);
    outLinks.set(n.id, new Set(links));
    links.forEach(title => {
      const target = byTitle.get(title.trim().toLowerCase());
      if (!target || target.id === n.id) return;
      if (!backLinks.has(target.id)) backLinks.set(target.id, new Set());
      backLinks.get(target.id).add(n.id);
    });
  });

  notesIndexCache = { byTitle, duplicates, tagCounts, outLinks, backLinks };
  return notesIndexCache;
}

function findNoteByTitle(title) {
  return notesIndex().byTitle.get(String(title || '').trim().toLowerCase()) || null;
}
function noteTitleExists(title) { return !!findNoteByTitle(title); }

/* ============ CRUD ============ */

function createNote({ title = '', content = '', daily = null, open = true } = {}) {
  const note = touch({
    id: uid(),
    title: title || 'Nota sin título',
    content,
    daily,
    pinned: false,
    archived: false,
    createdAt: Date.now(),
  });
  notes.unshift(note);
  invalidateNotesIndex();
  saveAll();
  if (open) { notesUi.selectedId = note.id; }
  return note;
}

const DAILY_FALLBACK_TEMPLATE = `# {{fechaLarga}}\n\n## Qué pasó hoy\n\n\n## Ideas\n\n\n## Para mañana\n\n- [ ] \n`;

/**
 * Devuelve la nota de hoy, creándola si no existe. NO navega ni cambia de vista:
 * eso lo hace openDailyNote(). Se separan porque la regla automática
 * "crear la nota diaria" (js/16-rules.js) tiene que poder crearla sin
 * secuestrar la navegación del usuario.
 */
function ensureDailyNote({ focus = false } = {}) {
  const today = new Date();
  const stamp = dateKey(today);

  let note = notes.find(n => n.daily === stamp);
  if (!note) {
    // Si hay una plantilla diaria configurada se usa; si no, la de serie.
    const tpl = typeof dailyTemplateBody === 'function' ? dailyTemplateBody() : null;
    const body = tpl || DAILY_FALLBACK_TEMPLATE;
    note = createNote({
      title: stamp,
      daily: stamp,
      // El módulo de plantillas carga después que éste; si faltara, la nota se
      // crea igual con los marcadores sin sustituir en vez de romperse.
      content: typeof applyTemplatePlaceholders === 'function'
        ? applyTemplatePlaceholders(body, today)
        : body,
      open: false,
    });
  }
  if (focus) notesUi.selectedId = note.id;
  return note;
}

/** Abre (o crea) la nota del día de hoy y salta a ella. */
function openDailyNote() {
  const note = ensureDailyNote({ focus: true });
  notesUi.selectedId = note.id;
  notesUi.showArchived = false;
  showView('notes');
  // Deja el cursor listo para escribir, que es el punto de una nota diaria.
  requestAnimationFrame(() => document.getElementById('note-body')?.focus());
}

function deleteNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  if (!confirm(`¿Borrar la nota "${note.title}"? No se puede deshacer.`)) return;
  tombstone('notes', id);
  notes = notes.filter(n => n.id !== id);
  if (notesUi.selectedId === id) notesUi.selectedId = null;
  invalidateNotesIndex();
  saveAll();
  renderNotes();
  toast('Nota borrada');
}

/* ============ AUTOGUARDADO ============ */

let noteSaveTimer = null;
let noteDirty = false;

function markNoteDirty() {
  noteDirty = true;
  const badge = document.getElementById('note-save-state');
  if (badge) { badge.textContent = 'escribiendo…'; badge.className = 'meta-label text-neutral-500'; }
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(commitNoteEdits, 700);
}

/** Vuelca lo que hay en el editor al modelo. Idempotente. */
function commitNoteEdits() {
  clearTimeout(noteSaveTimer);
  if (!noteDirty) return;
  const note = notes.find(n => n.id === notesUi.selectedId);
  const titleEl = document.getElementById('note-title');
  const bodyEl = document.getElementById('note-body');
  if (!note || !titleEl || !bodyEl) { noteDirty = false; return; }

  const newTitle = titleEl.value.trim() || 'Nota sin título';
  const titleChanged = newTitle !== note.title;

  note.title = newTitle;
  note.content = bodyEl.value;
  touch(note);
  noteDirty = false;

  invalidateNotesIndex();
  saveAll();

  const badge = document.getElementById('note-save-state');
  if (badge) { badge.textContent = 'guardado ✓'; badge.className = 'meta-label text-accent'; }

  // Renderizar entero al cambiar el título mantiene coherentes la lista y los
  // retroenlaces; al cambiar sólo el cuerpo basta con repintar el panel lateral,
  // que es lo que evita que el textarea pierda el foco mientras escribes.
  if (titleChanged) renderNotes();
  else { renderNotePreview(); renderNoteMeta(); renderNoteList(); }
}

/* ============ LISTA ============ */

function visibleNotes() {
  const q = notesUi.query.trim().toLowerCase();
  const tag = notesUi.tagFilter;
  return notes
    .filter(n => !!n.archived === notesUi.showArchived)
    .filter(n => !tag || extractTags(n.content).includes(tag))
    .filter(n => !q || `${n.title} ${n.content}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
}

function renderNoteList() {
  const box = document.getElementById('notes-list');
  if (!box) return;
  const list = visibleNotes();
  const { duplicates } = notesIndex();

  if (!list.length) {
    box.innerHTML = `<div class="p-6 text-center text-neutral-500 text-sm">
      ${notesUi.query || notesUi.tagFilter ? 'Nada coincide con el filtro.' : notesUi.showArchived ? 'No hay notas archivadas.' : 'Sin notas todavía.'}
    </div>`;
    return;
  }

  box.innerHTML = list.map(n => {
    const active = n.id === notesUi.selectedId;
    const dup = duplicates.has((n.title || '').trim().toLowerCase());
    return `
      <button type="button" data-note-open="${n.id}"
        class="note-row w-full text-left px-4 py-3 border-b border-neutral-200 dark:border-white/5 ${active ? 'is-active' : ''}">
        <div class="flex items-center gap-2">
          ${n.pinned ? '<span class="text-accent text-xs shrink-0">◆</span>' : ''}
          ${n.daily ? '<span class="meta-label text-accent shrink-0">diaria</span>' : ''}
          <span class="font-semibold text-sm truncate flex-1">${escapeHtml(n.title)}</span>
          ${dup ? '<span class="meta-label text-amber-500 shrink-0" title="Hay otra nota con este mismo título; los enlaces [[...]] resolverán a la más reciente">dup</span>' : ''}
        </div>
        <div class="text-neutral-500 text-xs mt-1 line-clamp-2">${escapeHtml(markdownToPlain(n.content, 90))}</div>
        <div class="meta-label text-neutral-400 mt-1.5">${relativeTime(new Date(n.updatedAt || n.createdAt).toISOString())}</div>
      </button>`;
  }).join('');
}

function renderTagFilters() {
  const box = document.getElementById('notes-tags');
  if (!box) return;
  const { tagCounts } = notesIndex();
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24);
  if (!tags.length) { box.innerHTML = ''; return; }
  box.innerHTML = tags.map(([tag, count]) => `
    <button type="button" data-tag-filter="${escapeHtml(tag)}"
      class="tag-chip ${notesUi.tagFilter === tag ? 'is-active' : ''}">#${escapeHtml(tag)}<span class="opacity-50 ml-1">${count}</span></button>`).join('');
}

/* ============ EDITOR ============ */

function renderNotePreview() {
  const el = document.getElementById('note-preview');
  if (!el) return;
  const note = notes.find(n => n.id === notesUi.selectedId);
  if (!note) { el.innerHTML = ''; return; }
  // Se lee del textarea y no del modelo para que la vista previa vaya al día
  // aunque el autoguardado todavía no haya corrido.
  const live = document.getElementById('note-body')?.value ?? note.content;
  el.innerHTML = renderMarkdown(live, { noteExists: noteTitleExists })
    || '<p class="text-neutral-500 text-sm">Nada que previsualizar todavía.</p>';
}

function renderNoteMeta() {
  const el = document.getElementById('note-meta');
  if (!el) return;
  const note = notes.find(n => n.id === notesUi.selectedId);
  if (!note) { el.innerHTML = ''; return; }

  const idx = notesIndex();
  const live = document.getElementById('note-body')?.value ?? note.content;
  const tags = extractTags(live);

  const backIds = [...(idx.backLinks.get(note.id) || [])];
  const backs = backIds.map(id => notes.find(n => n.id === id)).filter(Boolean);

  const outTitles = [...(idx.outLinks.get(note.id) || [])];
  const missing = outTitles.filter(t => !noteTitleExists(t));

  el.innerHTML = `
    ${tags.length ? `
      <div class="mb-4">
        <div class="meta-label text-neutral-500 mb-2">Etiquetas</div>
        <div class="flex flex-wrap gap-1.5">
          ${tags.map(t => `<button type="button" data-tag-filter="${escapeHtml(t)}" class="tag-chip">#${escapeHtml(t)}</button>`).join('')}
        </div>
      </div>` : ''}

    <div class="mb-4">
      <div class="meta-label text-neutral-500 mb-2">Enlaza aquí (${backs.length})</div>
      ${backs.length
        ? `<div class="space-y-1">${backs.map(b => `
            <button type="button" data-note-open="${b.id}" class="block w-full text-left text-sm text-accent hover:underline truncate">← ${escapeHtml(b.title)}</button>`).join('')}</div>`
        : '<p class="text-neutral-500 text-xs">Ninguna nota enlaza a esta todavía.</p>'}
    </div>

    ${missing.length ? `
      <div class="mb-4">
        <div class="meta-label text-amber-500 mb-2">Enlaces sin crear (${missing.length})</div>
        <div class="space-y-1">
          ${missing.map(t => `<button type="button" data-note-create="${escapeHtml(t)}" class="block w-full text-left text-sm text-amber-500 hover:underline truncate">+ ${escapeHtml(t)}</button>`).join('')}
        </div>
      </div>` : ''}

    <div class="pt-4 border-t border-neutral-200 dark:border-white/5 space-y-2">
      <button type="button" data-note-action="pin" class="w-full py-2 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.2em]">${note.pinned ? '◆ Quitar de fijadas' : '◇ Fijar arriba'}</button>
      <button type="button" data-note-action="archive" class="w-full py-2 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.2em]">${note.archived ? 'Desarchivar' : 'Archivar'}</button>
      <button type="button" data-note-action="delete" class="w-full py-2 rounded-xl surface-soft hover:border-red-400 hover:text-red-500 mono text-[10px] uppercase tracking-[0.2em]">Borrar</button>
    </div>`;
}

function renderNoteEditor() {
  const pane = document.getElementById('note-pane');
  if (!pane) return;
  const note = notes.find(n => n.id === notesUi.selectedId);

  if (!note) {
    pane.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center p-12">
        <div class="w-12 h-12 mb-4 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        </div>
        <p class="font-display font-bold text-lg mb-1">Ninguna nota abierta</p>
        <p class="text-neutral-500 text-sm max-w-xs">Elige una de la lista, o crea una nueva. Enlaza unas con otras escribiendo <span class="mono text-accent">[[Título]]</span>.</p>
      </div>`;
    return;
  }

  const modeBtn = (mode, label) =>
    `<button type="button" data-note-mode="${mode}" class="px-3 py-1.5 rounded-full text-[10px] font-bold mono uppercase tracking-[0.15em] transition ${notesUi.mode === mode ? 'bg-accent text-white' : 'text-neutral-500 hover:text-accent'}">${label}</button>`;

  pane.innerHTML = `
    <div class="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 dark:border-white/5">
      <input id="note-title" value="${escapeHtml(note.title)}"
             class="flex-1 min-w-0 bg-transparent font-display font-bold text-lg focus:outline-none" />
      <span id="note-save-state" class="meta-label text-accent shrink-0">guardado ✓</span>
      <div class="inline-flex p-1 rounded-full surface-soft shrink-0">
        ${modeBtn('write', 'Escribir')}${modeBtn('split', 'Ambos')}${modeBtn('preview', 'Ver')}
      </div>
    </div>

    <div class="flex-1 min-h-0 grid ${notesUi.mode === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'}">
      <div class="${notesUi.mode === 'preview' ? 'hidden' : ''} min-h-0 relative border-r border-neutral-200 dark:border-white/5">
        <textarea id="note-body" spellcheck="true"
          placeholder="Escribe en markdown. [[Título]] enlaza a otra nota, #etiqueta la clasifica."
          class="w-full h-full resize-none bg-transparent px-5 py-4 focus:outline-none mono text-sm leading-relaxed">${escapeHtml(note.content)}</textarea>
        <div id="wikilink-suggest" class="hidden"></div>
      </div>
      <div id="note-preview" class="${notesUi.mode === 'write' ? 'hidden' : ''} min-h-0 overflow-y-auto px-5 py-4 md-body"></div>
    </div>`;

  const body = document.getElementById('note-body');
  const title = document.getElementById('note-title');
  title.addEventListener('input', markNoteDirty);
  body.addEventListener('input', () => {
    markNoteDirty();
    if (notesUi.mode !== 'write') renderNotePreview();
    updateWikilinkSuggest();
  });
  body.addEventListener('keydown', handleEditorKeys);
  body.addEventListener('blur', () => setTimeout(hideWikilinkSuggest, 150));

  renderNotePreview();
}

/* ---- Autocompletado de [[ ----
   La sugerencia se ancla al pie del editor en vez de seguir al cursor: calcular
   la posición exacta del caret en un textarea exige clonar el contenido en un
   nodo espejo y medirlo, y es frágil con saltos de línea, scroll y zoom. Un
   panel fijo abajo se opera igual de bien con el teclado y no se desalinea
   nunca. */

let wikiSuggestItems = [];
let wikiSuggestIndex = 0;

function wikilinkQueryAtCaret() {
  const body = document.getElementById('note-body');
  if (!body) return null;
  const upToCaret = body.value.slice(0, body.selectionStart);
  const open = upToCaret.lastIndexOf('[[');
  if (open === -1) return null;
  const after = upToCaret.slice(open + 2);
  // Si ya se cerró el enlace o hay un salto de línea, no estamos escribiéndolo.
  if (after.includes(']]') || after.includes('\n')) return null;
  return { start: open, query: after };
}

function updateWikilinkSuggest() {
  const ctx = wikilinkQueryAtCaret();
  const box = document.getElementById('wikilink-suggest');
  if (!box) return;
  if (!ctx) { hideWikilinkSuggest(); return; }

  const q = ctx.query.trim().toLowerCase();
  wikiSuggestItems = notes
    .filter(n => n.id !== notesUi.selectedId && !n.archived)
    .filter(n => !q || n.title.toLowerCase().includes(q))
    .slice(0, 6);

  const canCreate = ctx.query.trim().length > 0 && !noteTitleExists(ctx.query.trim());

  if (!wikiSuggestItems.length && !canCreate) { hideWikilinkSuggest(); return; }

  wikiSuggestIndex = 0;
  box.className = 'absolute left-0 right-0 bottom-0 surface border-t shadow-2xl max-h-56 overflow-y-auto z-10';
  box.innerHTML =
    `<div class="px-4 py-2 meta-label text-neutral-500 border-b border-neutral-200 dark:border-white/5">Enlazar a… · ↑↓ y ↵ · esc cierra</div>` +
    wikiSuggestItems.map((n, i) => `
      <button type="button" data-wiki-pick="${escapeHtml(n.title)}"
        class="palette-row w-full text-left px-4 py-2.5 text-sm ${i === 0 ? 'is-active' : ''}">${escapeHtml(n.title)}</button>`).join('') +
    (canCreate ? `
      <button type="button" data-wiki-pick="${escapeHtml(ctx.query.trim())}"
        class="palette-row w-full text-left px-4 py-2.5 text-sm text-accent ${wikiSuggestItems.length === 0 ? 'is-active' : ''}">+ Crear "${escapeHtml(ctx.query.trim())}"</button>` : '');

  if (canCreate) wikiSuggestItems = [...wikiSuggestItems, { title: ctx.query.trim(), __new: true }];
}

function hideWikilinkSuggest() {
  const box = document.getElementById('wikilink-suggest');
  if (box) { box.className = 'hidden'; box.innerHTML = ''; }
  wikiSuggestItems = [];
}

function highlightWikiSuggest() {
  const box = document.getElementById('wikilink-suggest');
  if (!box) return;
  [...box.querySelectorAll('[data-wiki-pick]')].forEach((el, i) =>
    el.classList.toggle('is-active', i === wikiSuggestIndex));
}

function applyWikilink(title) {
  const body = document.getElementById('note-body');
  const ctx = wikilinkQueryAtCaret();
  if (!body || !ctx) return;
  const before = body.value.slice(0, ctx.start);
  const after = body.value.slice(body.selectionStart);
  const insert = `[[${title}]]`;
  body.value = before + insert + after;
  const caret = before.length + insert.length;
  body.setSelectionRange(caret, caret);
  hideWikilinkSuggest();
  body.focus();
  markNoteDirty();
  if (notesUi.mode !== 'write') renderNotePreview();
}

function handleEditorKeys(e) {
  const suggesting = wikiSuggestItems.length > 0;

  if (suggesting) {
    if (e.key === 'ArrowDown') { e.preventDefault(); wikiSuggestIndex = (wikiSuggestIndex + 1) % wikiSuggestItems.length; highlightWikiSuggest(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); wikiSuggestIndex = (wikiSuggestIndex - 1 + wikiSuggestItems.length) % wikiSuggestItems.length; highlightWikiSuggest(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyWikilink(wikiSuggestItems[wikiSuggestIndex].title); return; }
    if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); hideWikilinkSuggest(); return; }
  }

  // Ctrl+S fuerza el guardado. El autoguardado ya lo hace solo, pero el reflejo
  // de pulsar Ctrl+S está demasiado arraigado como para dejar que el navegador
  // abra su diálogo de "guardar página".
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    commitNoteEdits();
    toast('Nota guardada');
  }

  // Tab inserta dos espacios en vez de saltar de campo: dentro de un editor,
  // tabular es indentar.
  if (e.key === 'Tab' && !suggesting) {
    e.preventDefault();
    const el = e.target;
    const s = el.selectionStart, t = el.selectionEnd;
    el.value = el.value.slice(0, s) + '  ' + el.value.slice(t);
    el.setSelectionRange(s + 2, s + 2);
    markNoteDirty();
  }
}

/* ============ VISTA COMPLETA ============ */

function renderNotes() {
  invalidateNotesIndex();

  // Si no hay nada seleccionado, abre la primera visible — un panel vacío al
  // entrar no ayuda a nadie.
  if (!notesUi.selectedId || !notes.find(n => n.id === notesUi.selectedId)) {
    notesUi.selectedId = visibleNotes()[0]?.id || null;
  }

  const search = document.getElementById('notes-search');
  if (search && search.value !== notesUi.query) search.value = notesUi.query;

  const archBtn = document.getElementById('notes-archived-btn');
  if (archBtn) {
    archBtn.textContent = notesUi.showArchived ? 'Ver activas' : 'Ver archivadas';
    archBtn.classList.toggle('text-accent', notesUi.showArchived);
  }

  renderTagFilters();
  renderNoteList();
  renderNoteEditor();
  renderNoteMeta();
}

/* ============ EVENTOS ============ */

document.addEventListener('click', e => {
  const open = e.target.closest('[data-note-open]');
  if (open) {
    commitNoteEdits();
    notesUi.selectedId = open.dataset.noteOpen;
    renderNotes();
    return;
  }

  const create = e.target.closest('[data-note-create]');
  if (create) {
    commitNoteEdits();
    createNote({ title: create.dataset.noteCreate });
    renderNotes();
    toast(`Nota creada: ${create.dataset.noteCreate}`);
    return;
  }

  const pick = e.target.closest('[data-wiki-pick]');
  if (pick) { applyWikilink(pick.dataset.wikiPick); return; }

  const mode = e.target.closest('[data-note-mode]');
  if (mode) {
    notesUi.mode = mode.dataset.noteMode;
    store.set('notesMode', notesUi.mode);
    renderNoteEditor();
    return;
  }

  const tagBtn = e.target.closest('[data-tag-filter]');
  if (tagBtn) {
    const tag = tagBtn.dataset.tagFilter;
    notesUi.tagFilter = notesUi.tagFilter === tag ? null : tag;
    showView('notes');
    renderNotes();
    return;
  }

  // Etiqueta pulsada dentro del markdown renderizado
  const mdTag = e.target.closest('.md-tag');
  if (mdTag) {
    e.preventDefault();
    notesUi.tagFilter = mdTag.dataset.tag;
    notesUi.query = '';
    renderNotes();
    return;
  }

  // Enlace [[...]] pulsado dentro de la vista previa
  const wiki = e.target.closest('.wikilink');
  if (wiki) {
    e.preventDefault();
    const title = wiki.dataset.wikilink;
    commitNoteEdits();
    const target = findNoteByTitle(title);
    if (target) notesUi.selectedId = target.id;
    else { createNote({ title }); toast(`Nota creada: ${title}`); }
    renderNotes();
    return;
  }

  const action = e.target.closest('[data-note-action]');
  if (action) {
    const note = notes.find(n => n.id === notesUi.selectedId);
    if (!note) return;
    if (action.dataset.noteAction === 'delete') { deleteNote(note.id); return; }
    if (action.dataset.noteAction === 'pin') {
      note.pinned = !note.pinned;
      toast(note.pinned ? 'Nota fijada' : 'Nota desfijada');
    }
    if (action.dataset.noteAction === 'archive') {
      note.archived = !note.archived;
      toast(note.archived ? 'Nota archivada' : 'Nota desarchivada');
      if (note.archived) notesUi.selectedId = null;
    }
    touch(note);
    saveAll();
    renderNotes();
  }
});

document.getElementById('notes-search')?.addEventListener('input', e => {
  notesUi.query = e.target.value;
  renderNoteList();
});

document.getElementById('notes-archived-btn')?.addEventListener('click', () => {
  commitNoteEdits();
  notesUi.showArchived = !notesUi.showArchived;
  notesUi.selectedId = null;
  renderNotes();
});

document.getElementById('new-note-btn')?.addEventListener('click', () => {
  commitNoteEdits();
  createNote({});
  renderNotes();
  requestAnimationFrame(() => document.getElementById('note-title')?.select());
});

document.getElementById('daily-note-btn')?.addEventListener('click', openDailyNote);

/* Al salir de la vista de notas o cerrar el panel, se vuelca lo pendiente.
   `beforeunload` cubre el caso de cerrar la pestaña a mitad de frase. */
window.addEventListener('beforeunload', commitNoteEdits);

/* Migración: las notas anteriores no tenían estos campos. */
function migrateNotes() {
  let changed = false;
  notes.forEach(n => {
    if (n.pinned === undefined) { n.pinned = false; changed = true; }
    if (n.archived === undefined) { n.archived = false; changed = true; }
    if (n.daily === undefined) { n.daily = null; changed = true; }
  });
  if (changed) saveAll();
}
