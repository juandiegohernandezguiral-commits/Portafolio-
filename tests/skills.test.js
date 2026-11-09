/* Prueba el mapa de habilidades (js/24-skills.js).

   Lo que se protege aquí es una sola cosa, y es la razón de que esta vista
   exista en vez de ser una lista: que el aviso de «nivel sin nada detrás»
   acierte.

   Si fallara hacia el lado permisivo, la vista se convierte en una lista de
   cosas que crees saber — exactamente el número creíble y falso que el resto
   del panel evita. Si fallara hacia el lado estricto, te regaña por estar
   empezando algo, que es cuando menos ayuda. */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = path.join(__dirname, '..', 'js');
// Se cargan los tres de verdad y en su orden real: 24 usa tieneEtiqueta() del
// 22 y proyMinutos() del 23. Simularlos probaría copias, no el código.
const FUENTES = ['22-study.js', '23-projects.js', '24-skills.js'];

const noop = () => {};
const sandbox = {
  store: { get: (k, d) => d, set: noop },
  saveAll: noop, touch: r => { r.updatedAt = Date.now(); return r; },
  tombstone: noop, toast: noop, uid: () => 'id' + Math.random().toString(36).slice(2, 8),
  escapeHtml: s => String(s), statTile: () => '', emptyState: () => '', showView: noop,
  relativeTime: () => 'hace un rato',
  projects: [], tasks: [], sessions: [], notes: [], skills: [],
  studySubjects: [], studyItems: [], notesUi: {}, commitNoteEdits: noop,
  createNote: () => null, integrations: { sync: { url: '', token: '' } },
  fetch: () => Promise.reject(new Error('sin red')),
  console, setTimeout, clearTimeout, alert: noop, confirm: () => true,
  Intl, URL, navigator: {}, requestAnimationFrame: noop, performance: { now: () => 0 },
  document: { getElementById: () => null, addEventListener: noop, querySelectorAll: () => [],
              createElement: () => ({ getContext: () => ({ drawImage: noop }) }) },
  window: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
FUENTES.forEach(f => {
  const ruta = path.join(dir, f);
  vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });
});

const { skillTag, skillEvidencia, skillSinRespaldo, skillNivel, skillFmtHoras } = sandbox;
const EXIGE = vm.runInContext('SKILL_NIVEL_EXIGE_PRUEBA', sandbox);
const NIVELES = vm.runInContext('SKILL_NIVELES', sandbox);

let pasadas = 0, falladas = 0;
function ok(n, c, extra) {
  if (c) { pasadas++; return; }
  falladas++;
  console.error('  ✗ ' + n + (extra ? '\n      ' + extra : ''));
}
function igual(n, a, b) { ok(n, a === b, `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`); }
function grupo(n) { console.log('\n' + n); }

function limpiar() {
  sandbox.projects.length = 0;
  sandbox.notes.length = 0;
  sandbox.sessions.length = 0;
  sandbox.skills.length = 0;
}

grupo('Niveles');
{
  igual('hay seis, de 0 a 5', NIVELES.length, 6);
  igual('el 0 es la lista de deseos', skillNivel(0).label, 'Quiero aprenderlo');
  igual('el 5 es el tope', skillNivel(5).n, 5);
  // Un nivel fuera de rango no puede romper la vista ni pintar fuera de la fila.
  igual('un nivel absurdo se recorta por arriba', skillNivel(99).n, 5);
  igual('y por abajo', skillNivel(-4).n, 0);
  igual('sin nivel, cero', skillNivel(undefined).n, 0);

  igual('formato de horas corto', skillFmtHoras(45), '45 min');
  igual('y en horas', skillFmtHoras(185), '3 h');
  igual('cero no se muestra', skillFmtHoras(0), null);
}

grupo('Evidencia — lo único que no te inventas');
{
  limpiar();
  sandbox.projects.push(
    { id: 'p1', name: 'Agencia de IA', type: 'negocio', status: 'activo', stages: [] },
    { id: 'p2', name: 'Ciberseguridad', type: 'aprendizaje', status: 'terminado', stages: [] },
    { id: 'p3', name: 'Ajeno', type: 'personal', status: 'activo', stages: [] });
  sandbox.sessions.push(
    { kind: 'focus', projectId: 'p1', minutes: 120 },
    { kind: 'focus', projectId: 'p2', minutes: 60 },
    { kind: 'focus', projectId: 'p3', minutes: 999 },
    // Un descanso no es tiempo aprendido.
    { kind: 'break', projectId: 'p1', minutes: 30 });
  sandbox.notes.push(
    { id: 'n1', title: 'Promesas', content: '#javascript async', archived: false },
    { id: 'n2', title: 'Fetch #javascript', content: '', archived: false },
    { id: 'n3', title: 'Archivada', content: '#javascript', archived: true },
    // Empieza igual pero es OTRA etiqueta; el mismo caso que ya mordió en
    // Proyectos y en Estudio.
    { id: 'n4', title: 'Otra', content: '#javascript-avanzado', archived: false },
    { id: 'n5', title: 'Nada que ver', content: '#python', archived: false });

  const js = { id: 'k1', name: 'JavaScript', level: 3, projectIds: ['p1', 'p2'] };
  const ev = skillEvidencia(js);

  igual('la etiqueta sale del nombre', skillTag(js), 'javascript');
  igual('cuenta sus proyectos', ev.proyectos.length, 2);
  igual('y los terminados aparte', ev.terminados, 1);
  igual('cuenta sus apuntes', ev.apuntes.length, 2);
  ok('ignora los archivados', !ev.apuntes.some(n => n.id === 'n3'));
  ok('ignora una etiqueta que sólo empieza igual', !ev.apuntes.some(n => n.id === 'n4'));
  ok('ignora los de otra habilidad', !ev.apuntes.some(n => n.id === 'n5'));

  /* Las horas vienen de los proyectos ENLAZADOS. El temporizador registra
     contra proyectos, no contra habilidades, así que sin enlace no hay forma
     honesta de atribuir ese tiempo a nada. */
  igual('suma las horas de sus proyectos', ev.minutos, 180);
  ok('no cuela las de un proyecto no enlazado', ev.minutos !== 1179);

  const vacia = skillEvidencia({ id: 'k9', name: 'Rust', level: 1, projectIds: [] });
  igual('una habilidad sin nada da cero', vacia.total, 0);
  igual('sin proyectos', vacia.proyectos.length, 0);
  igual('sin minutos', vacia.minutos, 0);

  // projectIds ausente no puede reventar: los registros viejos no lo tienen.
  const sinCampo = skillEvidencia({ id: 'k8', name: 'Go', level: 2 });
  igual('sin projectIds no revienta', sinCampo.proyectos.length, 0);
}

grupo('El aviso de "nivel sin nada detrás"');
{
  limpiar();
  sandbox.projects.push({ id: 'p1', name: 'Algo', type: 'personal', status: 'activo', stages: [] });
  sandbox.sessions.push({ kind: 'focus', projectId: 'p1', minutes: 90 });

  /* Por debajo del umbral NO se avisa: estar empezando algo y no tener aún ni
     un apunte es lo normal, y regañar ahí sería ruido justo cuando menos
     ayuda. */
  for (let n = 0; n < EXIGE; n++) {
    ok(`nivel ${n} sin evidencia no se señala`,
      !skillSinRespaldo({ id: 'x', name: 'Nueva', level: n, projectIds: [] }));
  }

  // Desde el umbral sí.
  for (let n = EXIGE; n <= 5; n++) {
    ok(`nivel ${n} sin evidencia SÍ se señala`,
      skillSinRespaldo({ id: 'x', name: 'Nueva', level: n, projectIds: [] }));
  }

  // Y cualquiera de las tres pruebas basta para quitarlo.
  ok('un proyecto enlazado lo respalda',
    !skillSinRespaldo({ id: 'x', name: 'Nueva', level: 5, projectIds: ['p1'] }));

  sandbox.notes.push({ id: 'n1', title: 'Apunte', content: '#nueva', archived: false });
  ok('un apunte etiquetado también lo respalda',
    !skillSinRespaldo({ id: 'x', name: 'Nueva', level: 5, projectIds: [] }));

  // Un apunte archivado no cuenta: lo archivaste por algo.
  sandbox.notes.length = 0;
  sandbox.notes.push({ id: 'n2', title: 'Vieja', content: '#nueva', archived: true });
  ok('un apunte archivado NO lo respalda',
    skillSinRespaldo({ id: 'x', name: 'Nueva', level: 5, projectIds: [] }));
}

console.log('\n' + pasadas + ' pasadas, ' + falladas + ' falladas');
process.exit(falladas ? 1 : 0);
