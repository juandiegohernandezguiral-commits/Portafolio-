/* Prueba el intérprete local de dictados (parsearLocal en js/22-study.js).

   Mismo motivo que las otras: un fallo aquí no lanza nada. Si "el viernes" se
   resuelve al viernes que ya pasó, la tarea nace vencida; si se come media
   frase, el título queda sin sentido. Nada de eso da error — simplemente
   acabas con una entrega mal puesta.

   La fecha base está FIJA (jueves 15 de enero de 2026) para que las pruebas no
   cambien de resultado según el día en que se ejecuten. */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'js', '22-study.js');

const noop = () => {};
const sandbox = {
  store: { get: (k, d) => d, set: noop },
  saveAll: noop, touch: r => r, tombstone: noop, toast: noop,
  uid: () => 'id' + Math.random().toString(36).slice(2, 8),
  escapeHtml: s => String(s),
  showView: noop, renderDropship: noop,
  relativeTime: () => 'hace un rato',
  statTile: () => '', emptyState: () => '',
  integrations: { sync: { url: '', token: '' } },
  studySubjects: [], studyItems: [], notes: [],
  notesUi: {}, createNote: () => null, commitNoteEdits: noop,
  console, setTimeout, clearTimeout, alert: noop, confirm: () => true,
  Intl, URL, navigator: {}, fetch: () => Promise.reject(new Error('sin red')),
  document: { getElementById: () => null, addEventListener: noop, querySelectorAll: () => [], createElement: () => ({ getContext: () => ({ drawImage: noop }) }) },
  window: {}, requestAnimationFrame: noop, performance: { now: () => 0 },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

const { parsearLocal, aplanar, buscarHora, limpiarTexto, partirFrases } = sandbox;

// Jueves 15 de enero de 2026, 10:00 de la mañana.
const BASE = new Date(2026, 0, 15, 10, 0, 0);
const MATERIAS = ['Cálculo Diferencial', 'Programación I', 'Inglés I', 'Álgebra Lineal'];

let pasadas = 0, falladas = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; return; }
  falladas++;
  console.error('  ✗ ' + nombre + (extra ? '\n      ' + extra : ''));
}
function igual(nombre, a, b) { ok(nombre, a === b, `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`); }
function grupo(n) { console.log('\n' + n); }

/** Fecha local legible, para comparar sin pelearse con UTC. */
function fecha(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function uno(txt) { return parsearLocal(txt, MATERIAS, BASE)[0]; }

grupo('aplanar — los índices tienen que seguir cuadrando');
{
  // Es la razón de no usar normalize('NFD'): ahí 'á' pasa a ocupar 2 caracteres
  // y cualquier corte por posición se desplaza.
  igual('quita acentos', aplanar('Cálculo Diferencial'), 'Calculo Diferencial');
  igual('la ñ también', aplanar('mañana'), 'manana');
  igual('conserva la longitud', aplanar('áéíóúñ').length, 6);
  igual('no toca lo que ya es ascii', aplanar('taller 1'), 'taller 1');
}

grupo('Fechas relativas');
{
  igual('hoy', fecha(uno('hoy hay quiz de inglés').dueISO), '2026-01-15 23:59');
  igual('mañana', fecha(uno('mañana entrego el taller').dueISO), '2026-01-16 23:59');
  igual('pasado mañana gana sobre mañana',
    fecha(uno('pasado mañana entrego el taller').dueISO), '2026-01-17 23:59');
  igual('en 3 días', fecha(uno('en 3 días hay taller').dueISO), '2026-01-18 23:59');
  igual('en dos semanas', fecha(uno('en dos semanas el parcial').dueISO), '2026-01-29 23:59');
  igual('la otra semana', fecha(uno('la otra semana hay taller').dueISO), '2026-01-22 23:59');
}

grupo('Días de la semana');
{
  // Base: jueves 15.
  igual('viernes = el día siguiente', fecha(uno('el viernes hay taller').dueISO), '2026-01-16 23:59');
  igual('lunes = el de la semana que viene', fecha(uno('el lunes hay quiz').dueISO), '2026-01-19 23:59');
  igual('miércoles con tilde', fecha(uno('el miércoles entrego').dueISO), '2026-01-21 23:59');

  /* El caso que importa: hoy es jueves y dicen "el jueves". Tiene que ser el de
     la semana que viene, no hoy — si se resolviera a hoy, la tarea nacería
     vencida esta misma tarde. */
  igual('el mismo día de hoy salta a la semana siguiente',
    fecha(uno('el jueves hay parcial').dueISO), '2026-01-22 23:59');
}

grupo('Fechas absolutas');
{
  igual('15 de marzo', fecha(uno('el 15 de marzo hay parcial').dueISO), '2026-03-15 23:59');
  igual('con año explícito', fecha(uno('el 3 de febrero de 2027 entrego').dueISO), '2027-02-03 23:59');
  // 10 de enero ya pasó respecto al 15: se asume el año siguiente.
  igual('un mes ya pasado salta de año',
    fecha(uno('el 10 de enero entrego el informe').dueISO), '2027-01-10 23:59');
  igual('formato 20/03', fecha(uno('el 20/03 hay taller').dueISO), '2026-03-20 23:59');
  igual('día suelto del mes', fecha(uno('el 28 entrego el proyecto').dueISO), '2026-01-28 23:59');
  igual('día suelto ya pasado salta de mes',
    fecha(uno('el 5 entrego el informe').dueISO), '2026-02-05 23:59');
}

grupo('Horas');
{
  igual('a las 3 se asume de la tarde', fecha(uno('mañana a las 3 el parcial').dueISO), '2026-01-16 15:00');
  igual('a las 10 se respeta', fecha(uno('mañana a las 10 el parcial').dueISO), '2026-01-16 10:00');
  igual('con pm explícito', fecha(uno('mañana a las 7 pm el quiz').dueISO), '2026-01-16 19:00');
  igual('de la mañana', fecha(uno('mañana a las 8 de la mañana el quiz').dueISO), '2026-01-16 08:00');
  igual('con minutos', fecha(uno('mañana a las 14:30 el parcial').dueISO), '2026-01-16 14:30');
  // Sin hora, 23:59: a las 00:00 una entrega "del viernes" sale vencida todo el viernes.
  igual('sin hora, al final del día', fecha(uno('el viernes entrego').dueISO), '2026-01-16 23:59');
}

grupo('Tipo de evaluación');
{
  igual('taller es tarea', uno('el viernes hay taller').kind, 'tarea');
  igual('parcial', uno('el viernes hay parcial').kind, 'parcial');
  igual('quiz', uno('el viernes hay quiz').kind, 'quiz');
  igual('proyecto', uno('el viernes entrego el proyecto').kind, 'proyecto');
  igual('exposición', uno('el viernes es la exposición').kind, 'exposicion');
  // Precedencia: "proyecto final" no puede salir parcial.
  igual('proyecto final sigue siendo proyecto',
    uno('el viernes entrego el proyecto final').kind, 'proyecto');
  igual('por defecto, tarea', uno('el viernes hay algo raro').kind, 'tarea');
}

grupo('Materia');
{
  igual('nombre completo', uno('el viernes hay taller de cálculo diferencial').subject, 'Cálculo Diferencial');
  igual('sin tilde también', uno('el viernes hay taller de calculo diferencial').subject, 'Cálculo Diferencial');
  // Así se habla de verdad: nadie dice el nombre completo.
  igual('sólo la palabra larga', uno('el viernes hay taller de cálculo').subject, 'Cálculo Diferencial');
  igual('programación', uno('el martes parcial de programación').subject, 'Programación I');
  igual('álgebra', uno('el martes quiz de álgebra').subject, 'Álgebra Lineal');
  igual('si no la nombra, vacío', uno('el viernes hay taller').subject, '');
}

grupo('Peso');
{
  igual('vale el 15%', uno('el viernes taller, vale el 15%').weight, 15);
  igual('con "por ciento"', uno('el viernes taller que vale 20 por ciento').weight, 20);
  igual('porcentaje suelto', uno('el viernes taller 30%').weight, 30);
  igual('sin peso, cero', uno('el viernes hay taller').weight, 0);
  igual('un 150% se ignora por absurdo', uno('el viernes taller 150%').weight, 0);
}

grupo('Título — lo consumido no se repite');
{
  const a = uno('Para el viernes hay taller de cálculo diferencial, los puntos 1 al 12, vale el 15%');
  ok('no deja la fecha dentro', !/viernes/i.test(a.title), a.title);
  ok('no deja el peso dentro', !/15\s*%/.test(a.title), a.title);
  ok('no deja "vale el" colgando', !/vale\s+el/i.test(a.title), a.title);
  ok('conserva lo que importa', /puntos 1 al 12/i.test(a.title), a.title);
  ok('empieza en mayúscula', /^[A-ZÁÉÍÓÚÑ]/.test(a.title), a.title);

  /* Estas comprobaciones existen porque la primera version pasaba todas las de
     arriba y aun asi devolvia "Para hay taller de, los puntos 1 al 12": las
     pruebas miraban AUSENCIAS ("no deja la fecha dentro") y ninguna miraba que
     la frase se leyera bien. Dos fallos se colaron por ahi — la muletilla en
     mayuscula no casaba con un regex sin la bandera `i`, y al recortar la
     materia del medio quedaba la preposicion colgando. */
  igual('titulo completo, sin restos',
    uno('Para el viernes hay taller de cálculo, los puntos 1 al 12 del capítulo 3, vale el 15%').title,
    'Taller, los puntos 1 al 12 del capítulo 3');
  igual('sin preposicion colgando al final',
    uno('el martes tenemos parcial de programación').title, 'Parcial');
  /* "Para" se va por ser muletilla, pero "entrego" NO: es contenido y quitarlo
     perderia informacion. La expectativa de este caso estaba mal escrita la
     primera vez ("Informe"), no el codigo. */
  igual('la mayuscula inicial no bloquea la muletilla',
    uno('Para el viernes entrego el informe').title, 'Entrego el informe');
  igual('"del" tambien se absorbe',
    uno('el viernes hay quiz del inglés').title, 'Quiz');

  igual('quita la muletilla inicial',
    limpiarTexto('tengo que entregar el informe'), 'Entregar el informe');
  igual('quita "hay que"', limpiarTexto('hay que leer el capítulo 4'), 'Leer el capítulo 4');
  igual('no se come una palabra de verdad', limpiarTexto('laboratorio 3'), 'Laboratorio 3');
}

grupo('Varias tareas en un dictado');
{
  const items = parsearLocal(
    'Para el viernes hay taller de cálculo, vale el 15%. Y el martes tenemos parcial de programación.',
    MATERIAS, BASE);
  igual('saca dos', items.length, 2);
  igual('la primera es el taller', items[0].kind, 'tarea');
  igual('con su materia', items[0].subject, 'Cálculo Diferencial');
  igual('y su peso', items[0].weight, 15);
  igual('la segunda es el parcial', items[1].kind, 'parcial');
  igual('con la suya', items[1].subject, 'Programación I');
  igual('y su fecha', fecha(items[1].dueISO), '2026-01-20 23:59');

  // Al dictar no se puntúa: se encadena con "y".
  const sinPunto = parsearLocal(
    'mañana entrego el informe de inglés y el viernes hay quiz de álgebra', MATERIAS, BASE);
  igual('corta en "y" cuando sigue algo temporal', sinPunto.length, 2);
  igual('primera fecha', fecha(sinPunto[0].dueISO), '2026-01-16 23:59');
  igual('segunda fecha', fecha(sinPunto[1].dueISO), '2026-01-16 23:59');

  ok('una frase suelta muy corta no genera nada',
    parsearLocal('ok', MATERIAS, BASE).length === 0);
}

grupo('Confianza — honesta sobre lo que no supo');
{
  igual('fecha + materia = alta',
    uno('el viernes hay taller de cálculo').confidence, 'alta');
  igual('sólo fecha = media', uno('el viernes hay taller').confidence, 'media');
  igual('sólo materia = media', uno('hay taller de cálculo').confidence, 'media');
  igual('ninguna de las dos = baja', uno('hay que entregar algo').confidence, 'baja');
}

grupo('Casos límite');
{
  ok('texto vacío no revienta', parsearLocal('', MATERIAS, BASE).length === 0);
  ok('undefined no revienta', parsearLocal(undefined, MATERIAS, BASE).length === 0);
  ok('sin materias registradas sigue funcionando', parsearLocal('el viernes hay taller', [], BASE).length === 1);
  ok('materias undefined no revienta', parsearLocal('el viernes hay taller', undefined, BASE).length === 1);
  const sinFecha = uno('hay que leer el capítulo 4 de cálculo');
  igual('sin fecha, dueISO vacío', sinFecha.dueISO, '');
  ok('pero el título sale igual', sinFecha.title.length > 0, sinFecha.title);
}

/* ============================================================================
   FUSION DEL CALENDARIO DEL ITM (syncMoodle)
   ============================================================================
   Esta parte existe porque yo habia AFIRMADO en los docs que "refrescar nunca
   pisa tus notas" sin haberlo comprobado nunca: solo estaba probado el parser
   del servidor, no la fusion en el cliente. Una afirmacion asi, si es falsa,
   borra una nota real la primera vez que se pulsa el boton.

   Se simula la respuesta del backend; no se toca el ITM. */
async function pruebasSync() {
  grupo('Calendario del ITM - primera sincronizacion');

  sandbox.studySubjects.length = 0;
  sandbox.studyItems.length = 0;
  sandbox.studySubjects.push(
    { id: 'm0', name: 'Calculo Diferencial', credits: 4 },
    // Como se llama el curso en Moodle, que casi nunca coincide con el nombre corto.
    { id: 'm1', name: 'Programacion I', alias: 'PROGRAMACION I - GRUPO 02', credits: 4 });

  sandbox.integrations.sync = { url: 'https://falso.test', token: 't' };
  sandbox.integrations.moodle = { feeds: [{ id: 'f1', label: 'Campus Virtual', url: 'https://x/calendar/export_execute.php?authtoken=x' }] };

  let feed = [
    { externalId: 'uid-1', title: 'Taller 1',  course: 'Calculo Diferencial',        due: '2026-11-20T04:59:00.000Z', kind: 'tarea',   notes: '' },
    { externalId: 'uid-2', title: 'Parcial 1', course: 'PROGRAMACION I - GRUPO 02',  due: '2026-11-25T12:00:00.000Z', kind: 'parcial', notes: '' },
    { externalId: 'uid-3', title: 'Quiz',      course: 'Materia Desconocida',        due: '2026-11-22T12:00:00.000Z', kind: 'quiz',    notes: '' },
  ];
  sandbox.fetch = async () => ({ ok: true, json: async () => ({ items: feed }) });

  await sandbox.syncMoodle();
  const items = sandbox.studyItems;

  igual('crea los tres', items.length, 3);
  igual('engancha por nombre de materia', items.find(i => i.title === 'Taller 1').subjectId, 'm0');
  igual('engancha por el alias de Moodle', items.find(i => i.title === 'Parcial 1').subjectId, 'm1');
  igual('lo que no reconoce queda sin materia, no inventada',
    items.find(i => i.title === 'Quiz').subjectId, '');
  igual('el externalId lleva prefijo del feed', items[0].externalId, 'f1:uid-1');
  igual('queda marcado como venido del ITM', items[0].source, 'moodle');

  grupo('Refrescar - no duplica y NO pisa lo tuyo');

  await sandbox.syncMoodle();
  igual('sincronizar dos veces no duplica', sandbox.studyItems.length, 3);

  // El usuario pone su nota, su peso y lo marca entregado.
  const taller = sandbox.studyItems.find(i => i.externalId === 'f1:uid-1');
  taller.grade = 4.5;
  taller.weight = 20;
  taller.done = true;
  taller.subjectId = 'm1';          // lo reasigna a mano

  // El profesor mueve la entrega y le cambia el nombre.
  feed = feed.map(e => e.externalId === 'uid-1'
    ? Object.assign({}, e, { title: 'Taller 1 (corregido)', due: '2026-11-27T04:59:00.000Z' }) : e);
  await sandbox.syncMoodle();

  const tras = sandbox.studyItems.find(i => i.externalId === 'f1:uid-1');
  igual('la nota sobrevive', tras.grade, 4.5);
  igual('el peso sobrevive', tras.weight, 20);
  igual('el "entregado" sobrevive', tras.done, true);
  igual('la materia que reasignaste sobrevive', tras.subjectId, 'm1');
  igual('pero el titulo nuevo del profe si entra', tras.title, 'Taller 1 (corregido)');
  /* `due` se guarda en hora LOCAL para el <input datetime-local>, no en UTC. El
     feed manda 2026-11-27T04:59Z, que en Colombia (UTC-5) es el 26 a las 23:59.
     La primera version de esta asercion comparaba contra la fecha UTC y fallaba
     teniendo el codigo razon. */
  ok('y la fecha nueva tambien, convertida a hora local',
    tras.due.startsWith('2026-11-26T23:59'), tras.due);
  ok('y es distinta de la que tenia', tras.due !== '2026-11-19T23:59', tras.due);

  grupo('Varios Moodle a la vez');

  sandbox.integrations.moodle = { feeds: [
    { id: 'f1', label: 'Campus Virtual', url: 'https://x/calendar/export_execute.php?authtoken=x' },
    { id: 'f2', label: 'DCEB',           url: 'https://y/calendar/export_execute.php?authtoken=y' },
  ]};
  sandbox.studyItems.length = 0;
  feed = [{ externalId: 'uid-1', title: 'Taller 1', course: 'Calculo Diferencial', due: '2026-11-20T04:59:00.000Z', kind: 'tarea', notes: '' }];
  await sandbox.syncMoodle();

  /* El MISMO uid en dos Moodle distintos son dos tareas distintas. Sin el
     prefijo del feed, el segundo calendario pisaria al primero y perderias la
     mitad de tus entregas sin ningun error a la vista. */
  igual('el mismo uid en dos feeds no colisiona', sandbox.studyItems.length, 2);
  ok('cada uno con su prefijo',
    sandbox.studyItems.some(i => i.externalId === 'f1:uid-1') &&
    sandbox.studyItems.some(i => i.externalId === 'f2:uid-1'),
    sandbox.studyItems.map(i => i.externalId).join(', '));

  grupo('Un feed caido no tumba al otro');

  sandbox.studyItems.length = 0;
  let n = 0;
  sandbox.fetch = async () => {
    n++;
    if (n === 1) return { ok: false, json: async () => ({ message: 'token caducado' }) };
    return { ok: true, json: async () => ({ items: feed }) };
  };
  await sandbox.syncMoodle();
  igual('el segundo feed si entra', sandbox.studyItems.length, 1);
  /* moodleState es un `const` del script: NO queda como propiedad del contexto
     (solo las `function` y las `var`). Hay que evaluarlo dentro. Es la tercera
     vez que esto muerde en este proyecto; esta anotado en CLAUDE.md. */
  const estado = vm.runInContext('moodleState', sandbox);
  ok('y el error del primero se reporta', /token caducado/.test(estado.error || ''),
    String(estado.error));
}

pruebasSync().then(() => {
  console.log('\n' + pasadas + ' pasadas, ' + falladas + ' falladas');
  process.exit(falladas ? 1 : 0);
}).catch(err => {
  console.error('\nLa prueba de sincronizacion revento:', err);
  process.exit(1);
});
