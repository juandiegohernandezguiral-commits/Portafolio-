/* Prueba la lógica de la vista Proyectos (js/23-projects.js).

   Lo que se protege aquí es la honestidad de dos números:

   - El PROGRESO. La versión anterior lo calculaba como «etapas marcadas ÷
     total», así que marcar «Desarrollo» al 10% pintaba un 60%. Nadie ve ese
     error: es un número creíble.
   - El ABANDONO. Si la detección falla hacia el lado permisivo, un proyecto
     muerto se queda meses disfrazado de activo, que es justo lo que esta vista
     existe para evitar. */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'js', '23-projects.js');

const noop = () => {};
const sandbox = {
  store: { get: (k, d) => d, set: noop },
  saveAll: noop, touch: r => { r.updatedAt = Date.now(); return r; },
  tombstone: noop, toast: noop, uid: () => 'id' + Math.random().toString(36).slice(2, 8),
  escapeHtml: s => String(s), statTile: () => '', showView: noop,
  projects: [], tasks: [], sessions: [],
  console, setTimeout, clearTimeout, alert: noop, confirm: () => true,
  Intl, document: { getElementById: () => null, addEventListener: noop, querySelectorAll: () => [] },
  window: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

const { proyProgreso, proyDormido, proyDiasQuieto, proyUltimaActividad,
        migrateProjects, proyPortada, proyFmtMinutos, proyMinutos,
        proyFecha, proyHitos } = sandbox;
const TIPOS = vm.runInContext('PROY_TIPOS', sandbox);
const DIAS_DORMIDO = vm.runInContext('PROY_DIAS_DORMIDO', sandbox);

const D = 86400000;
const hace = d => Date.now() - d * D;

let pasadas = 0, falladas = 0;
function ok(n, c, extra) {
  if (c) { pasadas++; return; }
  falladas++;
  console.error('  ✗ ' + n + (extra ? '\n      ' + extra : ''));
}
function igual(n, a, b) { ok(n, a === b, `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`); }
function grupo(n) { console.log('\n' + n); }

/** Proyecto de prueba. `dias` = hace cuánto se tocó por última vez. */
function proy(over) {
  const p = Object.assign({
    id: 'p1', name: 'Prueba', type: 'negocio', status: 'activo',
    stages: TIPOS.negocio.etapas.map(n => ({ name: n, done: false })),
    createdAt: hace(120), updatedAt: hace(over && over.dias != null ? over.dias : 1),
  }, over);
  delete p.dias;
  return p;
}

grupo('Progreso — de dónde sale el número');
{
  sandbox.tasks.length = 0;
  const p = proy({ stages: [{ name: 'a', done: true }, { name: 'b', done: false },
                            { name: 'c', done: false }, { name: 'd', done: false }] });

  // Sin tareas: se cae a etapas, y lo DICE.
  let r = proyProgreso(p);
  igual('sin tareas usa etapas', r.fuente, 'etapas');
  igual('y calcula bien', r.pct, 25);
  igual('con su detalle', r.detalle, '1 de 4 etapas');

  /* Con tareas manda el trabajo cerrado, NO las etapas. Este es el caso que
     arregla la mentira: cuatro etapas marcadas (100%) pero sólo una de cuatro
     tareas hecha. El número honesto es 25, no 100. */
  p.stages.forEach(s => { s.done = true; });
  sandbox.tasks.push(
    { id: 't1', projectId: 'p1', status: 'done' },
    { id: 't2', projectId: 'p1', status: 'doing' },
    { id: 't3', projectId: 'p1', status: 'todo' },
    { id: 't4', projectId: 'p1', status: 'todo' });
  r = proyProgreso(p);
  igual('con tareas manda el trabajo cerrado', r.fuente, 'tareas');
  igual('aunque las etapas digan 100%', r.pct, 25);

  // Las tareas de OTRO proyecto no cuentan.
  sandbox.tasks.push({ id: 't9', projectId: 'otro', status: 'done' });
  igual('ignora tareas ajenas', proyProgreso(p).pct, 25);

  sandbox.tasks.length = 0;
  igual('un proyecto vacío da 0', proyProgreso(proy({ stages: [] })).pct, 0);
}

grupo('Abandono — qué cuenta como señal de vida');
{
  sandbox.tasks.length = 0;
  sandbox.sessions.length = 0;

  ok('un proyecto tocado ayer está vivo', !proyDormido(proy({ dias: 1 })));
  ok(`justo en el umbral (${DIAS_DORMIDO} d) ya es dormido`, proyDormido(proy({ dias: DIAS_DORMIDO })));
  ok('un día antes todavía no', !proyDormido(proy({ dias: DIAS_DORMIDO - 1 })));

  /* Lo importante: una TAREA CERRADA reciente resucita un proyecto cuya ficha
     lleva meses sin tocarse. Trabajar en algo sin editar su ficha es el caso
     normal, y marcarlo como abandonado sería el peor falso positivo. */
  const viejo = proy({ id: 'pv', dias: 90 });
  sandbox.projects.length = 0;
  sandbox.projects.push(viejo);
  ok('sin actividad, dormido', proyDormido(viejo));

  sandbox.tasks.push({ id: 't1', projectId: 'pv', status: 'done', completedAt: hace(2) });
  ok('una tarea cerrada hace 2 días lo revive', !proyDormido(viejo));
  igual('y los días quietos lo reflejan', proyDiasQuieto(viejo), 2);

  // Una sesión de enfoque cuenta igual.
  sandbox.tasks.length = 0;
  ok('sin la tarea, vuelve a estar dormido', proyDormido(viejo));
  sandbox.sessions.push({ id: 's1', kind: 'focus', projectId: 'pv', minutes: 60, createdAt: hace(3) });
  ok('una sesión de enfoque también lo revive', !proyDormido(viejo));
  sandbox.sessions.length = 0;

  /* Pausar o cerrar un proyecto NO es olvidarlo: es una decisión. Marcar como
     dormido algo que pausaste a propósito sería regañarte por haber decidido. */
  ['pausa', 'terminado', 'abandonado'].forEach(st => {
    ok(`un proyecto en "${st}" nunca sale como dormido`, !proyDormido(proy({ dias: 365, status: st })));
  });
}

grupo('Migración desde el diseño anterior');
{
  sandbox.projects.length = 0;
  const antiguo = {
    id: 'viejo', name: 'De antes', createdAt: hace(200), updatedAt: hace(200),
    stages: [{ name: 'Planificación', done: true }, { name: 'Diseño', done: true },
             { name: 'Desarrollo', done: false }],
  };
  sandbox.projects.push(antiguo);
  migrateProjects();

  igual('le pone un tipo', antiguo.type, 'software');
  igual('y lo deja activo', antiguo.status, 'activo');
  // Las etapas viejas se CONSERVAN: reemplazarlas por la plantilla del tipo
  // borraría lo que el usuario ya había marcado.
  igual('conserva sus etapas', antiguo.stages.length, 3);
  igual('y lo que estaba marcado sigue marcado', antiguo.stages.filter(s => s.done).length, 2);

  /* La migración NO llama a touch(). Si lo hiciera, todos los proyectos
     parecerían recién activos la primera vez que se abre la vista — justo
     cuando más interesa ver cuáles llevan meses quietos. */
  ok('no resucita un proyecto viejo al migrarlo', proyDormido(antiguo), String(proyDiasQuieto(antiguo)));

  const roto = { id: 'r', name: 'Sin etapas', createdAt: hace(5), updatedAt: hace(5) };
  sandbox.projects.push(roto);
  migrateProjects();
  ok('a uno sin etapas le pone las de su tipo', Array.isArray(roto.stages) && roto.stages.length > 0);
  // Correr la migración otra vez no debe cambiar nada.
  const antesTipo = roto.type, antesEtapas = roto.stages.length;
  migrateProjects();
  ok('es idempotente', roto.type === antesTipo && roto.stages.length === antesEtapas);
}

grupo('Fechas — el dia que escribiste, no el de antes');
{
  /* Este grupo existe por un fallo real que llego hasta la pantalla: la ficha
     de un proyecto con entrega el 2026-11-05 mostraba "4 de nov".

     La causa es que el estandar manda interpretar las cadenas de SOLO FECHA
     como medianoche UTC. En Colombia (UTC-5) eso son las 19:00 del dia
     anterior, asi que getDate() devolvia 4. Toda entrega aparecia un dia
     antes, y el punto del mini calendario caia en la casilla equivocada.
     No lanza ningun error: solo se ve comparando la ficha con lo que tecleaste. */
  const d = proyFecha('2026-11-05');
  igual('una fecha sola NO se corre al dia anterior', d.getDate(), 5);
  igual('y conserva el mes', d.getMonth() + 1, 11);
  // Mediodia y no medianoche, por lo mismo que en el calendario del ITM: a las
  // 00:00 una entrega "del 5" sale vencida durante todo el dia 5.
  igual('se fija a mediodia', d.getHours(), 12);

  // Fin de mes es donde el desfase se nota mas: cambiaba de mes, no solo de dia.
  const f = proyFecha('2026-11-01');
  igual('el primero de mes sigue en su mes', f.getMonth() + 1, 11);
  igual('y es dia 1', f.getDate(), 1);

  // Las tareas usan <input datetime-local>, que el estandar SI lee como local.
  const t = proyFecha('2026-11-05T14:30');
  igual('con hora, el dia se respeta', t.getDate(), 5);
  igual('y la hora tambien', t.getHours(), 14);

  ok('basura da null', proyFecha('no-es-fecha') === null);
  ok('vacio da null', proyFecha('') === null);
  ok('null da null', proyFecha(null) === null);

  /* Y el mismo desfase llegaba a los hitos del panel lateral: una entrega del
     1 de noviembre se contaba en octubre. */
  sandbox.projects.length = 0;
  sandbox.tasks.length = 0;
  sandbox.projects.push({ id: 'ph', name: 'Con entrega', type: 'negocio', status: 'activo',
    stages: [], deadline: '2026-11-01', createdAt: hace(10), updatedAt: hace(1) });
  const hs = proyHitos(5);
  igual('el hito se crea', hs.length, 1);
  igual('y cae en noviembre, no en octubre', new Date(hs[0].ms).getMonth() + 1, 11);
  igual('en el dia correcto', new Date(hs[0].ms).getDate(), 1);
}

grupo('Detalles');
{
  igual('formato de minutos corto', proyFmtMinutos(45), '45 min');
  igual('con horas', proyFmtMinutos(125), '2 h 5 min');
  igual('horas exactas sin minutos', proyFmtMinutos(120), '2 h');
  igual('cero no se muestra', proyFmtMinutos(0), null);

  // La portada es determinista: no puede cambiar de color al recargar.
  const a = proyPortada({ name: 'Agencia de IA', type: 'negocio' });
  const b = proyPortada({ name: 'Agencia de IA', type: 'negocio' });
  igual('la portada es estable', a, b);
  ok('y distintos nombres dan portadas distintas',
    a !== proyPortada({ name: 'Reventas de Amazon', type: 'negocio' }));

  sandbox.sessions.length = 0;
  sandbox.sessions.push(
    { kind: 'focus', projectId: 'p1', minutes: 30 },
    { kind: 'focus', projectId: 'p1', minutes: 45 },
    { kind: 'focus', projectId: 'otro', minutes: 999 });
  igual('suma sólo los minutos de su proyecto', proyMinutos({ id: 'p1' }), 75);

  // Los cuatro tipos traen etapas; si alguna quedara vacía, su barra de
  // progreso dividiría por cero.
  Object.entries(TIPOS).forEach(([k, t]) => {
    ok(`el tipo "${k}" trae etapas`, Array.isArray(t.etapas) && t.etapas.length >= 3);
  });
}

console.log('\n' + pasadas + ' pasadas, ' + falladas + ' falladas');
process.exit(falladas ? 1 : 0);
