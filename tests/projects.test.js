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
// 22 se carga tambien porque 23 reutiliza su subjectSlug(). Stubearlo aqui
// probaria una copia, no el codigo real — y el dia que las dos se separaran,
// la prueba seguiria en verde mientras los apuntes dejan de aparecer.
const SRC_STUDY = path.join(__dirname, '..', 'js', '22-study.js');

const noop = () => {};
const sandbox = {
  store: { get: (k, d) => d, set: noop },
  saveAll: noop, touch: r => { r.updatedAt = Date.now(); return r; },
  tombstone: noop, toast: noop, uid: () => 'id' + Math.random().toString(36).slice(2, 8),
  escapeHtml: s => String(s), statTile: () => '', showView: noop,
  projects: [], tasks: [], sessions: [], notes: [],
  studySubjects: [], studyItems: [],
  notesUi: {}, commitNoteEdits: noop, relativeTime: () => 'hace un rato',
  integrations: { sync: { url: '', token: '' } },
  fetch: () => Promise.reject(new Error('sin red')),
  navigator: {}, requestAnimationFrame: noop, performance: { now: () => 0 },
  createNote: ({ title = '', content = '' } = {}) => {
    const n = { id: 'n' + (sandbox.notes.length + 1), title, content, archived: false, updatedAt: Date.now() };
    sandbox.notes.unshift(n);
    return n;
  },
  console, setTimeout, clearTimeout, alert: noop,
  // proyReetiquetar() pregunta antes de reescribir notas; en pruebas se acepta.
  confirm: () => true,
  Intl, document: { getElementById: () => null, addEventListener: noop, querySelectorAll: () => [] },
  window: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC_STUDY, 'utf8'), sandbox, { filename: SRC_STUDY });
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

const { proyProgreso, proyDormido, proyDiasQuieto, proyUltimaActividad,
        migrateProjects, proyPortada, proyFmtMinutos, proyMinutos,
        proyFecha, proyHitos, proyTag, notasDeProyecto, proyCrearNota,
        proyReetiquetar, tieneEtiqueta, notasDeMateria,
        proyTema, proyIconoSvg } = sandbox;
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

grupo('Apuntes enganchados al proyecto');
{
  sandbox.projects.length = 0;
  sandbox.notes.length = 0;

  const p = { id: 'pa', name: 'Agencia de IA', type: 'negocio', status: 'activo',
              stages: [], createdAt: hace(60), updatedAt: hace(2) };
  const otro = { id: 'pb', name: 'Reventas de Amazon', type: 'negocio', status: 'activo',
                 stages: [], createdAt: hace(60), updatedAt: hace(2) };
  sandbox.projects.push(p, otro);

  igual('la etiqueta sale del nombre', proyTag(p), 'agencia-de-ia');
  igual('sin tildes ni mayusculas', proyTag({ name: 'Estudio de Inglés' }), 'estudio-de-ingles');
  igual('un proyecto sin nombre no da etiqueta', proyTag({}), '');

  sandbox.notes.push(
    { id: 'n1', title: 'Ideas', content: '#agencia-de-ia\nAutomatizar.', archived: false, updatedAt: hace(1) },
    /* Esta es la que importa: la etiqueta va en el CUERPO, que en una nota se
       llama `content` y no `body`. Buscar en `body` no lanza ningun error —
       devuelve cero apuntes siempre, que parece que no has escrito nada. Ya
       paso una vez en Estudio. */
    { id: 'n2', title: 'Precios', content: 'Mire tres. #agencia-de-ia', archived: false, updatedAt: hace(3) },
    { id: 'n3', title: 'Nmap', content: '#ciberseguridad', archived: false, updatedAt: hace(1) },
    { id: 'n4', title: 'Mercado', content: 'Leche, pan.', archived: false, updatedAt: hace(1) },
    { id: 'n5', title: 'Viejo', content: '#agencia-de-ia', archived: true, updatedAt: hace(1) });

  const ns = notasDeProyecto(p);
  igual('encuentra los suyos', ns.length, 2);
  ok('tambien si la etiqueta va a mitad del texto', ns.some(n => n.id === 'n2'));
  ok('ignora los de otro proyecto', !ns.some(n => n.id === 'n3'));
  ok('ignora los que no llevan etiqueta', !ns.some(n => n.id === 'n4'));
  ok('ignora los archivados', !ns.some(n => n.id === 'n5'));
  igual('el mas reciente primero', ns[0].id, 'n1');
  igual('un proyecto sin apuntes da lista vacia', notasDeProyecto(otro).length, 0);

  // La etiqueta tambien cuenta si esta en el titulo.
  sandbox.notes.push({ id: 'n6', title: 'Reunion #reventas-de-amazon', content: '', archived: false, updatedAt: hace(1) });
  igual('la encuentra en el titulo', notasDeProyecto(otro).length, 1);

  /* Crear desde la ficha tiene que dejar la nota ENGANCHADA, no solo creada.
     Si el apunte nace sin la etiqueta correcta, el usuario escribe dentro y
     luego no lo encuentra desde el proyecto. */
  const antes = sandbox.notes.length;
  proyCrearNota(otro);
  igual('crea una nota', sandbox.notes.length, antes + 1);
  igual('y el proyecto ya la encuentra', notasDeProyecto(otro).length, 2);

  /* Renombrar desengancha: no hay interfaz para renombrar hoy, pero si se
     añade, hay que reetiquetar en la misma operacion. Esta asercion deja el
     comportamiento escrito para que el cambio sea deliberado. */
  p.name = 'Agencia IA';
  igual('renombrar cambia la etiqueta', proyTag(p), 'agencia-ia');
  igual('y por tanto pierde sus apuntes', notasDeProyecto(p).length, 0);
}

grupo('Etiquetas — donde empieza y acaba una');
{
  /* Este grupo nace de un fallo que estuvo ahi desde el principio y que
     ninguna prueba veia, porque todas usaban etiquetas que no se parecian
     entre si.

     El filtro original era `texto.includes('#' + tag)`, y eso se traga
     cualquier etiqueta que EMPIECE igual: la materia «Cálculo» contaba como
     suyos los apuntes de #calculo-avanzado, y el proyecto «Agencia IA» los de
     #agencia-ia-vieja. Apuntes de otra cosa apareciendo donde no deben, sin
     ningun error.

     El arreglo tampoco podia usar `\b`: en una etiqueta con guiones, `ia\b` SI
     casa dentro de `ia-vieja`, porque para el motor de regex el guion ya es un
     limite de palabra. Hay que exigir que lo siguiente no sea letra, numero ni
     guion. */
  ok('la etiqueta exacta casa', tieneEtiqueta('mira esto #calculo bien', 'calculo'));
  ok('al final del texto tambien', tieneEtiqueta('nota #calculo', 'calculo'));
  ok('seguida de puntuacion', tieneEtiqueta('#calculo, y mas', 'calculo'));
  ok('seguida de salto de linea', tieneEtiqueta('#calculo\nsigue', 'calculo'));
  ok('sin distinguir mayusculas', tieneEtiqueta('#CALCULO', 'calculo'));

  ok('NO casa una etiqueta mas larga', !tieneEtiqueta('#calculo-avanzado', 'calculo'));
  ok('NO casa con guion detras', !tieneEtiqueta('#agencia-ia-vieja', 'agencia-ia'));
  ok('NO casa pegada a mas letras', !tieneEtiqueta('#calculos', 'calculo'));
  ok('sin etiqueta, falso', !tieneEtiqueta('texto cualquiera', 'calculo'));
  ok('tag vacio, falso', !tieneEtiqueta('#algo', ''));

  // Y el mismo comparador protege a Estudio, que tenia el fallo identico.
  sandbox.studySubjects.length = 0;
  sandbox.notes.length = 0;
  sandbox.notes.push(
    { id: 'c1', title: 'Derivadas', content: '#calculo', archived: false, updatedAt: hace(1) },
    { id: 'c2', title: 'Otra', content: '#calculo-avanzado', archived: false, updatedAt: hace(1) });
  const deCalculo = notasDeMateria({ name: 'Cálculo' });
  igual('la materia solo ve lo suyo', deCalculo.length, 1);
  igual('y es el apunte correcto', deCalculo[0].id, 'c1');
}

grupo('Renombrar — los apuntes se mueven con el proyecto');
{
  /* Renombrar es lo que convierte la limitacion anotada en un fallo real: la
     etiqueta sale del nombre, asi que sin reetiquetar, cambiar «Agencia de IA»
     por «Agencia IA» desengancha todos sus apuntes en silencio. */
  sandbox.notes.length = 0;
  sandbox.notes.push(
    { id: 'r1', title: 'Ideas', content: '#agencia-de-ia\nAutomatizar.', archived: false, updatedAt: hace(1) },
    { id: 'r2', title: 'Precios #agencia-de-ia', content: 'Tres.', archived: false, updatedAt: hace(2) },
    // La trampa: empieza igual pero es OTRA etiqueta.
    { id: 'r3', title: 'Vieja', content: '#agencia-de-ia-vieja no tocar', archived: false, updatedAt: hace(3) },
    { id: 'r4', title: 'Ajena', content: '#otra-cosa', archived: false, updatedAt: hace(4) });

  const movidos = proyReetiquetar('agencia-de-ia', 'agencia-ia');
  igual('mueve solo los dos suyos', movidos, 2);
  igual('en el cuerpo', sandbox.notes.find(n => n.id === 'r1').content, '#agencia-ia\nAutomatizar.');
  igual('y en el titulo', sandbox.notes.find(n => n.id === 'r2').title, 'Precios #agencia-ia');
  igual('NO toca la que solo empieza igual',
    sandbox.notes.find(n => n.id === 'r3').content, '#agencia-de-ia-vieja no tocar');
  igual('ni la ajena', sandbox.notes.find(n => n.id === 'r4').content, '#otra-cosa');

  igual('sin apuntes que mover, cero', proyReetiquetar('no-existe', 'tampoco'), 0);
  igual('mismo nombre, no hace nada', proyReetiquetar('agencia-ia', 'agencia-ia'), 0);
}

grupo('Portada deducida del nombre');
{
  const ico = nombre => proyTema({ name: nombre, type: 'personal' }).icono;

  // Los proyectos reales que motivaron esto.
  igual('Agencia de IA', ico('Agencia de IA'), 'circuito');
  igual('Reventas de Amazon', ico('Reventas de Amazon'), 'carrito');
  igual('Estudio de Inglés', ico('Estudio de Inglés'), 'idioma');
  igual('Ciberseguridad', ico('Ciberseguridad'), 'escudo');

  /* FALSOS POSITIVOS. La primera version casaba con un solo limite por
     delante (\bclave) y eso metia la clave dentro de palabras que no tienen
     nada que ver. Yo ademas habia escrito un comentario afirmando que `\b`
     impedia justo esto — era falso, y la comprobacion lo demostro:
     \bweb SI casa dentro de 'webinar'. */
  ok('"web" no se cuela en "Webinar de ventas"', ico('Webinar de ventas') !== 'codigo');
  ok('"venta" no se cuela en "Ventanas de la casa"', ico('Ventanas de la casa') !== 'carrito');
  ok('"ai" no se cuela en "Aire acondicionado"', ico('Aire acondicionado') !== 'circuito');
  ok('"bot" no se cuela en "Botella de agua"', ico('Botella de agua') !== 'circuito');
  ok('"ia" no se cuela en "Reunión familiar"', ico('Reunión familiar') !== 'circuito');

  // Y las que SI tienen que casar, que es la otra mitad del problema: un
  // limite por detras habria roto todas estas.
  igual('"automatiza" coge "automatización"', ico('Automatización de pedidos'), 'circuito');
  igual('"segur" coge "seguridad"', ico('Seguridad informática'), 'escudo');
  igual('"invers" coge "inversiones"', ico('Inversiones a largo plazo'), 'moneda');
  igual('"conten" coge "contenido"', ico('Contenido para TikTok'), 'play');

  // Palabra exacta en mayusculas y rodeada de texto.
  igual('IA suelta', ico('Mi proyecto de IA'), 'circuito');
  igual('web como palabra', ico('Portafolio Web'), 'codigo');
  igual('UX como palabra', ico('Rediseño UX'), 'pincel');

  /* Los acentos no pueden decidir la portada: se aplana el nombre antes de
     comparar, igual que hace el parser de dictados. */
  igual('con tilde', ico('Diseño de marca'), 'pincel');
  igual('sin tilde', ico('Diseno de marca'), 'pincel');

  // Lo que no reconoce tiene que seguir dando portada, no romperse.
  igual('nombre sin tema', ico('Algo rarísimo'), 'chispa');
  igual('nombre vacío', ico(''), 'chispa');

  /* Determinista: el mismo nombre da siempre la misma portada. Si cambiara al
     recargar, cada visita mostraria colores distintos y pareceria un fallo. */
  const a = proyPortada({ name: 'Agencia de IA', type: 'negocio' });
  igual('la portada es estable entre llamadas', a, proyPortada({ name: 'Agencia de IA', type: 'negocio' }));
  ok('y dos nombres distintos no dan la misma',
    a !== proyPortada({ name: 'Reventas de Amazon', type: 'negocio' }));

  // El SVG tiene que salir bien formado: va directo a innerHTML.
  const svg = proyIconoSvg({ name: 'Ciberseguridad', type: 'aprendizaje' }, 40);
  ok('el icono es un <svg> con su trazado', /^<svg[\s\S]+<path d="[^"]+"\/><\/svg>$/.test(svg.trim()), svg.slice(0, 60));

  // Todos los temas declaran un icono que existe de verdad: si faltara, la
  // ficha pintaria un <path> vacio y no se veria nada.
  const TEMAS = vm.runInContext('PROY_TEMAS', sandbox);
  const ICONOS = vm.runInContext('PROY_ICONOS', sandbox);
  TEMAS.forEach(t => ok('el tema "' + t.icono + '" tiene trazado', !!ICONOS[t.icono]));
  ok('el icono de reserva existe', !!ICONOS.chispa);
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
