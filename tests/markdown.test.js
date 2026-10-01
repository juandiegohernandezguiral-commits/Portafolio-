/* Pruebas del renderizador de markdown propio (js/10-markdown.js).
   Corre con: node tests/markdown.test.js

   El foco está en dos cosas: que la sintaxis que de verdad se escribe en una
   nota salga bien, y que NADA del usuario pueda llegar al innerHTML como HTML
   activo. Lo segundo importa más: el resultado de renderMarkdown se inyecta
   directamente en el DOM. */

const path = require('path');
const { renderMarkdown, extractTags, extractWikiLinks, markdownToPlain } =
  require(path.join(__dirname, '..', 'js', '10-markdown.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FALLA ${name}${detail ? '\n          ' + detail : ''}`); }
}
function has(html, fragment, name) { check(name, html.includes(fragment), `esperaba encontrar: ${fragment}\n          en: ${html}`); }
function hasNot(html, fragment, name) { check(name, !html.includes(fragment), `NO esperaba: ${fragment}\n          en: ${html}`); }

console.log('\nSeguridad (lo mas importante)');
{
  const h = renderMarkdown('<script>alert(1)</script>');
  hasNot(h, '<script>', 'una etiqueta script se escapa');
  has(h, '&lt;script&gt;', 'la etiqueta escapada sigue siendo legible');
}
{
  const h = renderMarkdown('<img src=x onerror="alert(1)">');
  hasNot(h, '<img', 'una etiqueta img se escapa');
  // Ojo: la cadena "onerror=" SI aparece en la salida, pero como texto escapado
  // dentro de un parrafo, que es inerte. Lo que hay que comprobar no es que el
  // texto desaparezca, sino que no quede ningun '<' ni '"' del usuario sin
  // escapar, que es lo unico que lo convertiria en un atributo de verdad.
  has(h, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', 'el payload queda como texto inerte');
  const userAngleBrackets = h.replace(/<\/?(p|h[1-6]|ul|ol|li|a|code|pre|em|strong|del|mark|blockquote|hr|span)\b[^>]*>/g, '');
  hasNot(userAngleBrackets, '<', 'no queda ningun < del usuario sin escapar');
}
{
  // Un enlace markdown con esquema javascript: no debe producir un <a> clicable.
  const h = renderMarkdown('[pulsa](javascript:alert(1))');
  hasNot(h, 'href="javascript:', 'se rechaza el esquema javascript:');
  const d = renderMarkdown('[pulsa](data:text/html,<script>alert(1)</script>)');
  hasNot(d, 'href="data:', 'se rechaza el esquema data:');
}
{
  const h = renderMarkdown('[ok](https://ejemplo.com)');
  has(h, 'href="https://ejemplo.com"', 'se acepta https');
  has(h, 'rel="noopener noreferrer"', 'los enlaces externos llevan rel seguro');
}
{
  // Comillas dentro del titulo de un wikilink no deben romper el atributo.
  const h = renderMarkdown('[[Nota "rara"]]');
  hasNot(h, 'data-wikilink="Nota "rara""', 'las comillas del titulo no rompen el atributo');
}

console.log('\nBloques');
{
  const h = renderMarkdown('# Titulo\n## Sub');
  has(h, '<h1 class="md-h md-h1">Titulo</h1>', 'encabezado nivel 1');
  has(h, '<h2 class="md-h md-h2">Sub</h2>', 'encabezado nivel 2');
}
{
  const h = renderMarkdown('- uno\n- dos');
  has(h, '<ul class="md-list">', 'lista con vinetas');
  check('dos elementos', (h.match(/<li>/g) || []).length === 2);
}
{
  const h = renderMarkdown('1. uno\n2. dos');
  has(h, '<ol class="md-list">', 'lista numerada');
}
{
  const h = renderMarkdown('- [ ] pendiente\n- [x] hecha');
  has(h, 'md-task', 'casillas de tarea');
  has(h, 'md-task is-done', 'la casilla marcada se distingue');
}
{
  const h = renderMarkdown('> una cita');
  has(h, '<blockquote class="md-quote">una cita</blockquote>', 'cita');
}
{
  const h = renderMarkdown('```js\nconst x = 1;\n```');
  has(h, '<pre class="md-pre" data-lang="js">', 'bloque de codigo con lenguaje');
  has(h, 'const x = 1;', 'el contenido del bloque se conserva');
}
{
  const h = renderMarkdown('---');
  has(h, '<hr class="md-hr" />', 'separador horizontal');
}
{
  const h = renderMarkdown('linea uno\nlinea dos\n\notro parrafo');
  check('las lineas contiguas forman un parrafo', (h.match(/<p class="md-p">/g) || []).length === 2, h);
}

console.log('\nInline');
{
  const h = renderMarkdown('**fuerte** y *suave* y ~~tachado~~ y ==resaltado==');
  has(h, '<strong>fuerte</strong>', 'negrita');
  has(h, '<em>suave</em>', 'cursiva');
  has(h, '<del>tachado</del>', 'tachado');
  has(h, '<mark>resaltado</mark>', 'resaltado');
}
{
  // El caso que justifica el centinela: markdown dentro de codigo no se procesa.
  const h = renderMarkdown('usa `**esto**` tal cual');
  has(h, '<code>**esto**</code>', 'el markdown dentro de codigo no se interpreta');
  hasNot(h, '<code><strong>', 'no se cuela negrita dentro del codigo');
}
{
  const h = renderMarkdown('mira `#ffffff` y tambien #real');
  hasNot(h, 'data-tag="ffffff"', 'un color hex dentro de codigo no es etiqueta');
  has(h, 'data-tag="real"', 'una etiqueta de verdad si se detecta');
}
{
  const h = renderMarkdown('ver [[Otra nota]]', { noteExists: () => true });
  has(h, 'data-wikilink="Otra nota"', 'enlace wiki');
  hasNot(h, 'is-missing', 'una nota existente no se marca como ausente');
  const m = renderMarkdown('ver [[Fantasma]]', { noteExists: () => false });
  has(m, 'is-missing', 'una nota inexistente se marca');
}
{
  const h = renderMarkdown('[[Nota|texto visible]]', { noteExists: () => true });
  has(h, '>texto visible</a>', 'el wikilink con alias muestra el alias');
  has(h, 'data-wikilink="Nota"', 'pero enlaza al titulo real');
}

console.log('\nExtraccion');
{
  const tags = extractTags('tengo #uno y #dos pero `#tres` no, ni ```\n#cuatro\n``` tampoco');
  check('extrae las etiquetas de fuera del codigo', tags.includes('uno') && tags.includes('dos'), tags.join(','));
  check('ignora las de dentro del codigo', !tags.includes('tres') && !tags.includes('cuatro'), tags.join(','));
}
{
  const tags = extractTags('#Mayus y #mayus');
  check('las etiquetas se normalizan a minuscula y no duplican', tags.length === 1 && tags[0] === 'mayus', tags.join(','));
}
{
  const links = extractWikiLinks('ver [[Una]] y [[Otra|alias]] y `[[NoEsta]]`');
  check('extrae los titulos enlazados', links.includes('Una') && links.includes('Otra'), links.join(','));
  check('usa el titulo, no el alias', !links.includes('alias'), links.join(','));
  check('ignora los de dentro del codigo', !links.includes('NoEsta'), links.join(','));
}
{
  const plain = markdownToPlain('# Hola\n\nesto es **markdown** con [[enlace]] y `codigo`');
  hasNot(plain, '#', 'el preview quita la sintaxis de encabezado');
  hasNot(plain, '**', 'el preview quita los asteriscos');
  has(plain, 'enlace', 'el preview conserva el texto del enlace');
}
{
  const plain = markdownToPlain('a'.repeat(300), 50);
  check('el preview se trunca a la longitud pedida', plain.length <= 51, `length=${plain.length}`);
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
