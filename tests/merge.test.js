/* Prueba la lÃ³gica de fusiÃ³n de js/07-sync.js cargÃ¡ndola en un sandbox con los
   globals del navegador y de los scripts anteriores simulados. Es la pieza donde
   un error se traduce en pÃ©rdida silenciosa de datos, asÃ­ que se verifica de
   verdad en vez de sÃ³lo revisarla a ojo. */
const fs = require('fs');
const vm = require('vm');

const SRC = require('path').join(__dirname, '..', 'js', '07-sync.js');

const noop = () => {};
const fakeEl = { classList: { contains: () => false, add: noop, remove: noop, toggle: noop }, innerHTML: '', addEventListener: noop };

const sandbox = {
  // --- globals de los scripts anteriores ---
  store: { get: (k, d) => d, set: noop },
  saveAll: noop,
  escapeHtml: s => String(s),
  buildBackupPayload: () => ({}),
  integrations: { sync: { url: '', token: '', enabled: false }, notion: { proxyUrl: '' } },
  saveIntegrations: noop,
  TOMBSTONE_TTL_DAYS: 60,
  tasks: [], events: [], projects: [], notes: [], tombstones: [],
  // --- globals del navegador ---
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  indexedDB: { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) },
  navigator: { onLine: true },
  localStorage: { setItem: noop, getItem: () => null },
  fetch: () => Promise.reject(new Error('sin red en el test')),
  document: {
    getElementById: () => null,
    addEventListener: noop,
    querySelectorAll: () => [],
    visibilityState: 'hidden',
  },
  window: { addEventListener: noop, showSaveFilePicker: undefined },
  requestAnimationFrame: noop,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

const {
  mergeCollections, mergeTombstones, applyTombstones, mergeRemoteIntoLocal,
} = sandbox;

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FALLA ${name}${detail ? ' â†’ ' + detail : ''}`); }
}

const NOW = Date.now();
const ago = mins => NOW - mins * 60000;

console.log('\nmergeCollections');
{
  const local = [{ id: 'a', title: 'solo local', updatedAt: ago(10) }];
  const remote = [{ id: 'b', title: 'solo remoto', updatedAt: ago(10) }];
  const out = mergeCollections(local, remote);
  check('un registro que sÃ³lo existe en local sobrevive', out.some(r => r.id === 'a'));
  check('un registro que sÃ³lo existe en remoto sobrevive', out.some(r => r.id === 'b'));
  check('no duplica', out.length === 2, `length=${out.length}`);
}
{
  const local = [{ id: 'a', title: 'viejo', updatedAt: ago(60) }];
  const remote = [{ id: 'a', title: 'nuevo', updatedAt: ago(5) }];
  check('gana la version remota si es mas reciente',
    mergeCollections(local, remote)[0].title === 'nuevo');
  check('gana la version local si es mas reciente',
    mergeCollections(remote.map(r => ({ ...r, updatedAt: ago(1) })), local)[0].title === 'nuevo');
}
{
  // Un registro sin updatedAt (dato pre-migraciÃ³n que se colara) no debe ganarle
  // a uno sellado; se trata como el mas antiguo posible.
  const local = [{ id: 'a', title: 'sin sellar' }];
  const remote = [{ id: 'a', title: 'sellado', updatedAt: ago(100) }];
  check('un registro sin updatedAt no pisa a uno sellado',
    mergeCollections(local, remote)[0].title === 'sellado');
}

console.log('\nmergeTombstones');
{
  const out = mergeTombstones(
    [{ kind: 'tasks', id: 'x', at: ago(30) }],
    [{ kind: 'tasks', id: 'x', at: ago(5) }]
  );
  check('deduplica por kind:id', out.length === 1, `length=${out.length}`);
  check('conserva el borrado mas reciente', out[0].at === ago(5));
}
{
  const viejo = NOW - 61 * 86400000;   // 61 dias: por encima del TTL de 60
  const out = mergeTombstones([{ kind: 'tasks', id: 'z', at: viejo }], []);
  check('descarta tombstones mas viejos que el TTL', out.length === 0, `length=${out.length}`);
}

console.log('\napplyTombstones');
{
  const cols = { tasks: [{ id: 'a', updatedAt: ago(60) }, { id: 'b', updatedAt: ago(60) }] };
  applyTombstones(cols, [{ kind: 'tasks', id: 'a', at: ago(10) }]);
  check('elimina el registro borrado', !cols.tasks.some(r => r.id === 'a'));
  check('no toca los demas', cols.tasks.some(r => r.id === 'b'));
}
{
  // Escenario clave: se borro en el celular, pero luego se siguio editando en el
  // portatil. La edicion posterior debe ganar.
  const cols = { tasks: [{ id: 'a', updatedAt: ago(2) }] };
  applyTombstones(cols, [{ kind: 'tasks', id: 'a', at: ago(30) }]);
  check('un registro editado DESPUES del borrado sobrevive', cols.tasks.length === 1);
}
{
  const cols = { tasks: [{ id: 'a', updatedAt: ago(30) }] };
  applyTombstones(cols, [{ kind: 'noExiste', id: 'a', at: ago(1) }]);
  check('un tombstone de una coleccion desconocida no rompe nada', cols.tasks.length === 1);
}

console.log('\nmergeRemoteIntoLocal (integracion)');
{
  sandbox.tasks = [
    { id: 't1', title: 'local reciente', updatedAt: ago(1) },
    { id: 't2', title: 'se borro en el otro dispositivo', updatedAt: ago(90) },
    { id: 't4', title: 'solo local', updatedAt: ago(5) },
  ];
  sandbox.events = []; sandbox.projects = []; sandbox.notes = [];
  sandbox.tombstones = [];

  mergeRemoteIntoLocal({
    tasks: [
      { id: 't1', title: 'remoto viejo', updatedAt: ago(50) },
      { id: 't2', title: 'se borro en el otro dispositivo', updatedAt: ago(90) },
      { id: 't3', title: 'solo remoto', updatedAt: ago(3) },
    ],
    events: [], projects: [], notes: [],
    tombstones: [{ kind: 'tasks', id: 't2', at: ago(20) }],
  });

  const ids = sandbox.tasks.map(t => t.id).sort();
  check('conserva lo que solo estaba en local (t4)', ids.includes('t4'));
  check('incorpora lo que solo estaba en remoto (t3)', ids.includes('t3'));
  check('propaga el borrado remoto (t2 fuera)', !ids.includes('t2'), `ids=${ids}`);
  check('la version local mas reciente gana (t1)',
    sandbox.tasks.find(t => t.id === 't1').title === 'local reciente');
  check('el tombstone queda registrado en local', sandbox.tombstones.length === 1);
  check('resultado final con 3 tareas', sandbox.tasks.length === 3, `length=${sandbox.tasks.length}`);
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
