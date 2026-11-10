/* Prueba la recolección del calendario (js/25-calendar.js).

   Dos cosas que, si fallan, no lanzan nada:

   1. La CLAVE DE DÍA. Si se derivara en UTC, en Colombia (UTC−5) todo lo de
      después de las 19:00 caería en la casilla del día siguiente — justo las
      horas en que uno planifica el día. Ya mordió dos veces en este proyecto:
      en el calendario del ITM y en las entregas de Proyectos.

   2. Que las CINCO fuentes lleguen. El valor de la vista es cruzarlas: ver que
      el mismo día hay un parcial, una entrega y tres tareas. Si una deja de
      aparecer, la vista sigue viéndose perfecta y miente por omisión. */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = path.join(__dirname, '..', 'js');
// Se cargan de verdad porque 25 usa proyFecha() del 23 e isHabitDone() del 13.
const FUENTES = ['13-habits.js', '22-study.js', '23-projects.js', '25-calendar.js'];

const noop = () => {};
const sandbox = {
  store: { get: (k, d) => d, set: noop },
  saveAll: noop, touch: r => { r.updatedAt = Date.now(); return r; },
  tombstone: noop, toast: noop, uid: () => 'id' + Math.random().toString(36).slice(2, 8),
  escapeHtml: s => String(s), statTile: () => '', emptyState: () => '', showView: noop,
  relativeTime: () => 'hace un rato', dateKey: null,
  events: [], tasks: [], sessions: [], notes: [], projects: [],
  habits: [], habitLog: [], studySubjects: [], studyItems: [], skills: [],
  notesUi: {}, commitNoteEdits: noop, createNote: () => null,
  integrations: { sync: { url: '', token: '' } },
  fetch: () => Promise.reject(new Error('sin red')),
  console, setTimeout, clearTimeout, alert: noop, confirm: () => true,
  Intl, URL, navigator: {}, requestAnimationFrame: noop, performance: { now: () => 0 },
  document: { getElementById: () => null, addEventListener: noop, querySelectorAll: () => [],
              createElement: () => ({ getContext: () => ({ drawImage: noop }) }) },
  window: {}, localStorage: { getItem: () => null, setItem: noop },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
FUENTES.forEach(f => {
  const ruta = path.join(dir, f);
  vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });
});

const { calClave, calItems, calHabitoToca } = sandbox;

let pasadas = 0, falladas = 0;
function ok(n, c, extra) {
  if (c) { pasadas++; return; }
  falladas++;
  console.error('  ✗ ' + n + (extra ? '\n      ' + extra : ''));
}
function igual(n, a, b) { ok(n, a === b, `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`); }
function grupo(n) { console.log('\n' + n); }

function limpiar() {
  ['events', 'tasks', 'projects', 'habits', 'habitLog', 'studyItems', 'studySubjects']
    .forEach(k => { sandbox[k].length = 0; });
}

grupo('La clave de día es LOCAL, nunca UTC');
{
  igual('mediodía', calClave(new Date(2026, 10, 6, 12, 0)), '2026-11-06');

  /* El caso que importa: las 23:00 del 6. En UTC eso ya es el 7, así que
     toISOString().slice(0,10) lo pondría en la casilla equivocada — y es
     exactamente la hora a la que se revisa "qué tengo mañana". */
  igual('las 23:00 siguen siendo el mismo día', calClave(new Date(2026, 10, 6, 23, 0)), '2026-11-06');
  igual('y las 00:30 también', calClave(new Date(2026, 10, 6, 0, 30)), '2026-11-06');

  igual('rellena con cero el mes', calClave(new Date(2026, 0, 5, 10, 0)), '2026-01-05');
  igual('fin de año', calClave(new Date(2026, 11, 31, 20, 0)), '2026-12-31');
  ok('basura da null', calClave('no es fecha') === null);
  ok('nada da null', calClave(null) === null);
}

grupo('Las cinco fuentes llegan al mismo día');
{
  limpiar();
  const D = '2026-11-06';
  sandbox.events.push({ id: 'e1', title: 'Reunión', date: D + 'T15:00' });
  sandbox.tasks.push({ id: 't1', title: 'Landing', status: 'doing', due: D + 'T18:00' });
  sandbox.studySubjects.push({ id: 'm1', name: 'Informática' });
  sandbox.studyItems.push({ id: 's1', title: 'Excel', subjectId: 'm1', kind: 'tarea', due: D + 'T23:59', done: false });
  sandbox.projects.push({ id: 'p1', name: 'Agencia', type: 'negocio', status: 'activo', stages: [], deadline: D });
  sandbox.habits.push({ id: 'h1', name: 'Leer', cadence: 'daily' });

  const items = calItems(D, D);
  const fuentes = new Set(items.map(i => i.fuente));
  igual('llegan las cinco', fuentes.size, 5);
  ['evento', 'tarea', 'estudio', 'proyecto', 'habito'].forEach(f =>
    ok(`llega "${f}"`, fuentes.has(f)));

  // Ordenadas por hora: lo que tiene hora antes que lo que no.
  igual('el evento de las 15:00 va antes que la tarea de las 18:00',
    items.findIndex(i => i.fuente === 'evento') < items.findIndex(i => i.titulo === 'Landing'), true);
  // Los hábitos no tienen hora: van al final del día.
  igual('el hábito va el último', items[items.length - 1].fuente, 'habito');

  // La materia viaja como subtítulo: "Excel" sin más no dice de qué clase es.
  const est = items.find(i => i.fuente === 'estudio');
  igual('el item del ITM lleva su materia', est.sub, 'Informática');
}

grupo('Qué se excluye, y por qué');
{
  limpiar();
  const D = '2026-11-06';
  // Un proyecto cerrado no es una entrega que te vaya a caer encima.
  sandbox.projects.push(
    { id: 'p1', name: 'Vivo', type: 'negocio', status: 'activo', stages: [], deadline: D },
    { id: 'p2', name: 'Terminado', type: 'negocio', status: 'terminado', stages: [], deadline: D },
    { id: 'p3', name: 'Abandonado', type: 'negocio', status: 'abandonado', stages: [], deadline: D });
  const proys = calItems(D, D).filter(i => i.fuente === 'proyecto');
  igual('sólo el proyecto vivo', proys.length, 1);
  ok('y es el correcto', proys[0].titulo.includes('Vivo'));

  // Una tarea sin fecha no puede aparecer en ningún día.
  limpiar();
  sandbox.tasks.push({ id: 't1', title: 'Sin fecha', status: 'todo', due: '' });
  igual('sin fecha no entra', calItems(D, D).length, 0);

  // Lo hecho SÍ aparece, marcado: tacharlo es parte de ver el día.
  limpiar();
  sandbox.tasks.push({ id: 't1', title: 'Hecha', status: 'done', due: D + 'T10:00' });
  const hechas = calItems(D, D);
  igual('lo hecho sigue apareciendo', hechas.length, 1);
  igual('pero marcado como hecho', hechas[0].hecho, true);

  // Fuera del rango pedido no entra nada.
  limpiar();
  sandbox.events.push({ id: 'e1', title: 'Otro mes', date: '2026-12-15T10:00' });
  igual('fuera del rango no entra', calItems('2026-11-01', '2026-11-30').length, 0);
}

grupo('Cadencia de los hábitos');
{
  // 2026-11-06 es viernes; 2026-11-07 sábado; 2026-11-09 lunes.
  const vie = new Date(2026, 10, 6);
  const sab = new Date(2026, 10, 7);
  const dom = new Date(2026, 10, 8);

  ok('"daily" toca todos los días', calHabitoToca({ cadence: 'daily' }, sab));
  ok('"weekdays" toca el viernes', calHabitoToca({ cadence: 'weekdays' }, vie));
  ok('"weekdays" NO toca el sábado', !calHabitoToca({ cadence: 'weekdays' }, sab));
  ok('"weekdays" NO toca el domingo', !calHabitoToca({ cadence: 'weekdays' }, dom));

  // 'custom' usa los índices de getDay(): 0=domingo, 5=viernes.
  ok('"custom" respeta sus días', calHabitoToca({ cadence: 'custom', days: [5] }, vie));
  ok('"custom" ignora los demás', !calHabitoToca({ cadence: 'custom', days: [5] }, sab));
  ok('"custom" sin lista no toca nunca', !calHabitoToca({ cadence: 'custom' }, vie));

  /* Una cadencia que no se reconoce cae en "todos los días" a propósito: un
     hábito que desaparece del calendario se olvida, y eso es peor que uno que
     aparece algún día de más. */
  ok('una cadencia desconocida no lo hace desaparecer', calHabitoToca({ cadence: 'rarísima' }, sab));

  // Y el estado de hecho sale del registro real, con el campo `date`.
  limpiar();
  sandbox.habits.push({ id: 'h1', name: 'Leer', cadence: 'daily' });
  sandbox.habitLog.push({ id: 'l1', habitId: 'h1', date: '2026-11-06' });
  const dias = calItems('2026-11-06', '2026-11-07');
  igual('dos días, dos instancias', dias.length, 2);
  igual('el que está registrado sale hecho', dias.find(d => d.clave === '2026-11-06').hecho, true);
  igual('el otro no', dias.find(d => d.clave === '2026-11-07').hecho, false);
}

console.log('\n' + pasadas + ' pasadas, ' + falladas + ' falladas');
process.exit(falladas ? 1 : 0);
