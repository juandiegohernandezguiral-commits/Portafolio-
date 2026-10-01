/* 10-markdown.js — renderizador de Markdown propio.

   ¿Por qué no una librería? El proyecto no tiene build step y ya depende de
   cuatro CDN. Añadir marked/markdown-it serían ~50 KB más de terceros, un
   punto de fallo más offline, y traerían un montón de sintaxis que nunca se va
   a escribir en una nota personal. Esto cubre lo que sí se usa, en ~200 líneas
   que se pueden leer enteras.

   Extensiones propias del segundo cerebro:
     [[Nota]]        enlace a otra nota por título
     [[Nota|texto]]  enlace con texto alternativo
     #etiqueta       etiqueta, clicable para filtrar

   SEGURIDAD: la entrada se escapa ENTERA antes de cualquier otra cosa. Todo lo
   que sale de aquí va a innerHTML, así que la regla es que ningún carácter del
   usuario pueda llegar como HTML activo. Se escapa primero y después se
   insertan las etiquetas propias; nunca al revés. */

function mdEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* Extrae las etiquetas (#tag) de un texto crudo, ignorando las que estén dentro
   de bloques o spans de código — ahí un # casi siempre es un comentario o un
   color hexadecimal, no una etiqueta. */
function extractTags(src) {
  const withoutCode = String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
  const found = new Set();
  for (const m of withoutCode.matchAll(/(^|[\s(])#([\p{L}\d][\p{L}\d_/-]*)/gu)) {
    found.add(m[2].toLowerCase());
  }
  return [...found];
}

/* Extrae los títulos enlazados con [[...]], también ignorando el código. */
function extractWikiLinks(src) {
  const withoutCode = String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
  const found = new Set();
  for (const m of withoutCode.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const title = m[1].trim();
    if (title) found.add(title);
  }
  return [...found];
}

/* ---- Procesado de línea (inline) ----
   Los spans de código se extraen primero y se sustituyen por un marcador, para
   que un `**` dentro de `código` no acabe convertido en negrita.

   El marcador usa U+E000/U+E001, de la zona de uso privado de Unicode: no tienen
   representación en ninguna fuente ni significado en markdown, así que no
   pueden aparecer en el texto del usuario ni colisionar con las expresiones
   regulares de abajo. Se escriben como secuencias de escape y no como bytes
   literales: un NUL crudo dentro del fuente sobrevive mal a editores, servidores
   y minificadores. */
const MD_OPEN = '\uE000';
const MD_CLOSE = '\uE001';
function mdInline(text, opts) {
  const codeSpans = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `${MD_OPEN}${codeSpans.length - 1}${MD_CLOSE}`;
  });

  // Enlaces wiki: [[Título]] o [[Título|texto visible]]
  out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, rawTitle, rawLabel) => {
    const title = rawTitle.trim();
    const label = (rawLabel || title).trim();
    const exists = opts && typeof opts.noteExists === 'function' ? opts.noteExists(title) : true;
    // El título va en un atributo data-*, ya escapado por el escape global del
    // principio; se re-escapan las comillas por si acaso.
    const attr = title.replace(/"/g, '&quot;');
    return `<a href="#" class="wikilink${exists ? '' : ' is-missing'}" data-wikilink="${attr}"` +
           `${exists ? '' : ' title="Esta nota todavía no existe — clic para crearla"'}>${label}</a>`;
  });

  // Enlaces markdown normales. Sólo http(s) y mailto: evita javascript: y data:,
  // que serían ejecutables al hacer clic.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    if (!/^(https?:\/\/|mailto:|#)/i.test(href)) return match;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // URLs sueltas que no estén ya dentro de un href
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  // Etiquetas
  out = out.replace(/(^|[\s(])#([\p{L}\d][\p{L}\d_/-]*)/gu,
    (_, pre, tag) => `${pre}<a href="#" class="md-tag" data-tag="${tag.toLowerCase()}">#${tag}</a>`);

  // Énfasis. El negrita va antes que la cursiva para que ** no se lea como dos *.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  out = out.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  // Devuelve los spans de código a su sitio
  out = out.replace(new RegExp(MD_OPEN + '(\\d+)' + MD_CLOSE, 'g'), (_, i) => `<code>${codeSpans[+i]}</code>`);
  return out;
}

/**
 * Convierte Markdown a HTML.
 * @param {string} src   texto en markdown (sin escapar)
 * @param {object} opts  { noteExists(title) => boolean }
 */
function renderMarkdown(src, opts = {}) {
  if (!src) return '';
  // Escape global primero: a partir de aquí nada del usuario puede ser HTML.
  const lines = mdEscape(src).replace(/\r\n/g, '\n').split('\n');

  const html = [];
  let i = 0;
  // Pilas de listas abiertas, para poder anidar ul/ol correctamente.
  let listStack = [];

  const closeLists = (toDepth = 0) => {
    while (listStack.length > toDepth) html.push(`</${listStack.pop()}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código cercado
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      closeLists();
      const lang = fence[1] || '';
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // salta el cierre
      html.push(`<pre class="md-pre"${lang ? ` data-lang="${lang}"` : ''}><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    // Línea en blanco: cierra listas y no produce nada
    if (!line.trim()) { closeLists(); i++; continue; }

    // Separador horizontal
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeLists();
      html.push('<hr class="md-hr" />');
      i++; continue;
    }

    // Encabezados
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level} class="md-h md-h${level}">${mdInline(heading[2], opts)}</h${level}>`);
      i++; continue;
    }

    // Cita
    if (/^\s*&gt;\s?/.test(line)) {
      closeLists();
      const body = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i++;
      }
      html.push(`<blockquote class="md-quote">${mdInline(body.join(' '), opts)}</blockquote>`);
      continue;
    }

    // Elemento de lista (con o sin casilla)
    const item = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (item) {
      const indent = Math.floor(item[1].length / 2);
      const ordered = /\d/.test(item[2]);
      const tag = ordered ? 'ol' : 'ul';
      const depth = indent + 1;

      if (depth > listStack.length) {
        while (listStack.length < depth) {
          html.push(`<${tag} class="md-list">`);
          listStack.push(tag);
        }
      } else {
        closeLists(depth);
        // Cambió el tipo de lista al mismo nivel (viñetas → numerada)
        if (listStack[depth - 1] !== tag) {
          html.push(`</${listStack.pop()}>`);
          html.push(`<${tag} class="md-list">`);
          listStack.push(tag);
        }
      }

      // Casilla de tarea: - [ ] / - [x]
      const task = item[3].match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        html.push(
          `<li class="md-task${done ? ' is-done' : ''}">` +
          `<span class="md-check${done ? ' is-done' : ''}">${done ? '✓' : ''}</span>` +
          `<span>${mdInline(task[2], opts)}</span></li>`
        );
      } else {
        html.push(`<li>${mdInline(item[3], opts)}</li>`);
      }
      i++; continue;
    }

    // Párrafo: junta líneas consecutivas que no empiecen otro bloque
    closeLists();
    const para = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      para.push(lines[i]); i++;
    }
    html.push(`<p class="md-p">${mdInline(para.join(' '), opts)}</p>`);
  }

  closeLists();
  return html.join('\n');
}

/** Primeras `max` palabras del texto, sin sintaxis markdown — para los previews. */
function markdownToPlain(src, max = 160) {
  const plain = String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, t, l) => l || t)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~=>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? plain.slice(0, max).trimEnd() + '…' : plain;
}

// Exporta para el test en node (tests/markdown.test.js); en el navegador no hace nada.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMarkdown, extractTags, extractWikiLinks, markdownToPlain, mdEscape };
}
