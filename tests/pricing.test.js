/* Prueba la aritmética de dinero de js/20-dropship-tools.js (y el unitEconomics
   de js/19-dropship.js), cargando los dos en un sandbox con los globals del
   navegador simulados.

   Por qué esto tiene prueba y otras cosas no: aquí un error no se ve. Un margen
   mal calculado no lanza una excepción ni rompe la pantalla — sale un número
   verosímil, se toma una decisión de precio con él y se pierde plata durante
   semanas sin saber por qué. Ya pasó una vez en este módulo: observedCpa
   devolvía 0 en vez de null cuando no había gasto registrado, la publicidad
   desaparecía de la cuenta y un producto con 34% de margen real se mostraba con
   52%. De ahí la prueba del final sobre ese caso concreto. */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC19 = path.join(__dirname, '..', 'js', '19-dropship.js');
const SRC20 = path.join(__dirname, '..', 'js', '20-dropship-tools.js');

const noop = () => {};

const sandbox = {
  // --- globals de los scripts anteriores ---
  store: { get: (k, d) => d, set: noop },
  saveAll: noop,
  touch: r => r,
  tombstone: noop,
  toast: noop,
  uid: () => 'id' + Math.random().toString(36).slice(2, 8),
  escapeHtml: s => String(s),
  dateKey: d => new Date(d).toISOString().slice(0, 10),
  relativeTime: () => 'hace un rato',
  integrations: { sync: { url: '', token: '' }, notion: { proxyUrl: '' } },
  orders: [], shopProducts: [], campaigns: [], priceScenarios: [],
  // --- globals del navegador ---
  console,
  setTimeout, clearTimeout,
  navigator: {},
  alert: noop,
  confirm: () => true,
  Intl,
  document: {
    getElementById: () => null,
    addEventListener: noop,
    querySelectorAll: () => [],
  },
  window: {},
  requestAnimationFrame: noop,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC19, 'utf8'), sandbox, { filename: SRC19 });
vm.runInContext(fs.readFileSync(SRC20, 'utf8'), sandbox, { filename: SRC20 });

/* Las declaraciones `function` de un script sí quedan como propiedades del
   contexto, así que se pueden sacar del sandbox directamente. Las `const` NO
   —viven en el ámbito léxico del script, no en el objeto global—, así que las
   constantes hay que evaluarlas dentro del contexto. Leerla de ahí en vez de
   copiar el 0.4 aquí mantiene la prueba atada al valor real del módulo. */
const {
  calcEconomics, solvePrice, maxCpa, maxReturnRate, precioPsicologico,
  normalizeCity, resolveCity, waPhone, scoreProduct, unitEconomics, observedCpa,
} = sandbox;
const GMF_PCT = vm.runInContext('GMF_PCT', sandbox);

/* ---- arnés mínimo ---- */
let pasadas = 0, falladas = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; return; }
  falladas++;
  console.error('  ✗ ' + nombre + (extra ? '\n      ' + extra : ''));
}
function cerca(nombre, a, b, tol) {
  const t = tol === undefined ? 0.01 : tol;
  ok(nombre, Math.abs(a - b) <= t, `esperaba ${b}, obtuve ${a}`);
}
function grupo(n) { console.log('\n' + n); }

/* ============ BASE: un escenario calculado a mano ============
   price 100.000 · cost 20.000 · flete 10.000 ida y vuelta · CPA 15.000
   devolución 20% · sin recaudo, sin empaque, sin 4x1000, sin impuestos

   r = 0.20  →  intentos = 1/0.8 = 1.25   devoluciones = 0.2/0.8 = 0.25
   fletes de ida      10.000 × 1.25 = 12.500
   publicidad         15.000 × 1.25 = 18.750
   fletes de vuelta   10.000 × 0.25 =  2.500
   fijos = 20.000 + 12.500 + 18.750 + 2.500 = 53.750
   margen = 100.000 − 53.750 = 46.250                                        */
const BASE = {
  price: 100000, cost: 20000, packaging: 0, shipOut: 10000, shipBack: 10000,
  codFixed: 0, codPct: 0, cpa: 15000, cpaPerDelivery: false,
  returnRate: 20, spoilPct: 0, confirmCost: 0, gmf: false, taxPct: 0,
  targetMarginPct: 40,
};

grupo('calcEconomics — contra una cuenta hecha a mano');
{
  const e = calcEconomics(BASE);
  cerca('intentos por entrega', e.intentos, 1.25);
  cerca('devoluciones por entrega', e.devoluciones, 0.25);
  cerca('fletes de ida amortizados', e.fleteTotal, 12500);
  cerca('publicidad amortizada', e.adTotal, 18750);
  cerca('fletes de devolución', e.fletesVuelta, 2500);
  cerca('costos fijos por entrega', e.fijos, 53750);
  cerca('margen', e.margen, 46250);
  cerca('margen %', e.margenPct, 46.25);
}

grupo('calcEconomics — el desglose suma exactamente el margen');
{
  // Esta es la propiedad que hace auditable la pantalla: si las filas que se
  // muestran no suman el total que se muestra, el desglose miente.
  const casos = [
    BASE,
    { ...BASE, gmf: true, taxPct: 5, codPct: 3, codFixed: 2500, packaging: 1200, confirmCost: 300, spoilPct: 15 },
    { ...BASE, returnRate: 0 },
    { ...BASE, returnRate: 60, cpaPerDelivery: true },
    { ...BASE, price: 45000, cpa: 30000 },
  ];
  casos.forEach((c, i) => {
    const e = calcEconomics(c);
    const suma = e.price
      - e.cost - e.codFixed - e.codVar - e.gmfCost - e.taxCost
      - e.fleteTotal - e.empaqueTotal - e.confirmTotal
      - e.adTotal - e.fletesVuelta - e.merma;
    cerca(`caso ${i + 1}: filas suman el margen`, suma, e.margen, 0.000001);
  });
}

grupo('calcEconomics — cada costo entra donde debe');
{
  // El empaque se paga en CADA intento, no sólo en la entrega.
  const sin = calcEconomics({ ...BASE, packaging: 0 });
  const con = calcEconomics({ ...BASE, packaging: 1000 });
  cerca('empaque se multiplica por los intentos', sin.margen - con.margen, 1250);

  // El 4x1000 se calcula sobre el precio.
  const conGmf = calcEconomics({ ...BASE, gmf: true });
  cerca('4x1000 sobre el precio', sin.margen - conGmf.margen, 100000 * GMF_PCT / 100);

  // La merma sólo aplica a lo devuelto.
  const conMerma = calcEconomics({ ...BASE, spoilPct: 50 });
  cerca('merma = costo × % × devoluciones', sin.margen - conMerma.margen, 20000 * 0.5 * 0.25);

  // El producto devuelto vuelve al inventario: su costo NO se pierde dos veces.
  const r0 = calcEconomics({ ...BASE, returnRate: 0, cpa: 0, shipOut: 0, shipBack: 0 });
  cerca('sin devoluciones el costo se cobra una vez', r0.margen, 100000 - 20000);
}

grupo('cpaPerDelivery — el interruptor que evita inflar el margen');
{
  const porPedido = calcEconomics({ ...BASE, cpaPerDelivery: false });
  const porEntrega = calcEconomics({ ...BASE, cpaPerDelivery: true });
  cerca('por pedido amortiza el CPA', porPedido.adTotal, 18750);
  cerca('por entrega lo deja tal cual', porEntrega.adTotal, 15000);
  ok('marcarlo mal hace parecer el margen mayor', porEntrega.margen > porPedido.margen,
    `${porEntrega.margen} vs ${porPedido.margen}`);
}

grupo('solvePrice — ida y vuelta');
{
  const pBreakeven = solvePrice(BASE, 0);
  cerca('precio de equilibrio', pBreakeven, 53750);
  cerca('al precio de equilibrio el margen es cero',
    calcEconomics({ ...BASE, price: pBreakeven }).margen, 0, 0.000001);

  [10, 25, 40, 60].forEach(m => {
    const p = solvePrice(BASE, m);
    const e = calcEconomics({ ...BASE, price: p });
    cerca(`margen objetivo ${m}% se cumple`, e.margenPct, m, 0.0001);
  });

  // Con porcentajes sobre el precio la cosa deja de ser trivial: subir el
  // precio sube también esos costos, así que el precio tiene que subir más.
  const conPct = { ...BASE, gmf: true, taxPct: 5, codPct: 3 };
  const p = solvePrice(conPct, 40);
  cerca('con costos porcentuales el objetivo también se cumple',
    calcEconomics({ ...conPct, price: p }).margenPct, 40, 0.0001);
  ok('y exige un precio mayor que sin ellos', p > solvePrice(BASE, 40),
    `${p} vs ${solvePrice(BASE, 40)}`);
}

grupo('solvePrice — el caso sin solución');
{
  // 50% de recaudo + 45% de impuestos + 40% de margen = 135% del precio.
  // No hay precio que lo cumpla, y devolver un número aquí sería el peor fallo
  // posible: un precio enorme que parece la respuesta.
  ok('devuelve null cuando los porcentajes pasan del 100%',
    solvePrice({ ...BASE, codPct: 50, taxPct: 45 }, 40) === null);
  ok('devuelve null justo en el límite',
    solvePrice({ ...BASE, codPct: 60, taxPct: 40 }, 0) === null);
  ok('sigue resolviendo cuando queda margen de sobra',
    typeof solvePrice({ ...BASE, codPct: 10, taxPct: 5 }, 20) === 'number');
}

grupo('maxCpa — ida y vuelta');
{
  const techo = maxCpa(BASE);
  cerca('CPA máximo', techo, 52000);
  cerca('pagando el techo exacto el margen es cero',
    calcEconomics({ ...BASE, cpa: techo }).margen, 0, 0.000001);

  const techoPorEntrega = maxCpa({ ...BASE, cpaPerDelivery: true });
  cerca('con CPA por entrega el techo es mayor', techoPorEntrega, 65000);
  cerca('y también deja el margen en cero',
    calcEconomics({ ...BASE, cpaPerDelivery: true, cpa: techoPorEntrega }).margen, 0, 0.000001);

  ok('nunca devuelve un techo negativo',
    maxCpa({ ...BASE, price: 10000 }) === 0, String(maxCpa({ ...BASE, price: 10000 })));
}

grupo('maxReturnRate — bisección');
{
  const rTecho = maxReturnRate(BASE);
  ok('encuentra un techo', rTecho !== null && rTecho > 20, String(rTecho));
  cerca('en el techo el margen es cero',
    calcEconomics({ ...BASE, returnRate: rTecho }).margen, 0, 1);
  ok('justo por encima del techo ya se pierde',
    calcEconomics({ ...BASE, returnRate: rTecho + 1 }).margen < 0);
  ok('justo por debajo todavía se gana',
    calcEconomics({ ...BASE, returnRate: Math.max(0, rTecho - 1) }).margen > 0);

  // Si ni con cero devoluciones gana, el problema no son las devoluciones.
  ok('null cuando pierde incluso sin devoluciones',
    maxReturnRate({ ...BASE, price: 30000 }) === null);
  // Un producto con margen enorme aguanta cualquier cosa.
  cerca('tope en 95 cuando aguanta todo',
    maxReturnRate({ ...BASE, price: 900000 }), 95, 0.0001);
}

grupo('precioPsicologico');
{
  ok('redondea hacia arriba al siguiente 900', precioPsicologico(87413) === 87900,
    String(precioPsicologico(87413)));
  ok('deja intacto lo que ya termina en 900', precioPsicologico(87900) === 87900,
    String(precioPsicologico(87900)));
  ok('sube de verdad cuando se pasa', precioPsicologico(88000) === 88900,
    String(precioPsicologico(88000)));
  ok('nunca baja el precio', precioPsicologico(53750) >= 53750,
    String(precioPsicologico(53750)));
  ok('no devuelve algo absurdo con valores diminutos', precioPsicologico(10) === 900,
    String(precioPsicologico(10)));
  ok('cero y basura dan cero', precioPsicologico(0) === 0 && precioPsicologico(NaN) === 0);
}

grupo('normalizeCity / resolveCity');
{
  ok('acentos fuera', normalizeCity('Medellín') === 'medellin', normalizeCity('Medellín'));
  ok('mayúsculas fuera', normalizeCity('MEDELLIN') === 'medellin');
  ok('espacios de sobra fuera', normalizeCity('  Santa   Marta  ') === 'santa marta',
    normalizeCity('  Santa   Marta  '));
  ok('la ñ se resuelve', normalizeCity('Peñol') === 'penol', normalizeCity('Peñol'));
  ok('puntuación fuera', normalizeCity('Bogotá, D.C.') === 'bogota d c', normalizeCity('Bogotá, D.C.'));

  // Las tres grafías que de verdad escribe la gente tienen que caer en una.
  const variantes = ['Medellín', 'medellin', 'MEDELLIN', ' Medellin '];
  const claves = new Set(variantes.map(v => resolveCity(v).key));
  ok('las variantes de Medellín son una sola zona', claves.size === 1, [...claves].join(', '));

  ok('alias con departamento pegado', resolveCity('Bogota DC').key === 'bogota',
    resolveCity('Bogota DC').key);
  ok('departamento correcto', resolveCity('Itagüí').dep === 'Antioquia',
    resolveCity('Itagüí').dep);
  ok('nombre bonito de vuelta', resolveCity('medellin').label === 'Medellín');

  // Lo desconocido NO se adivina: se queda aparte en vez de caer en otra ciudad.
  const raro = resolveCity('Pueblo Que No Existe');
  ok('ciudad desconocida conserva su nombre', raro.label === 'Pueblo Que No Existe', raro.label);
  ok('ciudad desconocida queda sin clasificar', raro.dep === 'Sin clasificar', raro.dep);
  ok('vacío no revienta', resolveCity('').label === 'Sin ciudad');
  ok('undefined no revienta', resolveCity(undefined).dep === 'Sin clasificar');
}

grupo('waPhone');
{
  ok('celular colombiano de 10 dígitos', waPhone('3001234567') === '573001234567',
    String(waPhone('3001234567')));
  ok('con espacios y guiones', waPhone('300 123-4567') === '573001234567',
    String(waPhone('300 123-4567')));
  ok('ya con indicativo', waPhone('573001234567') === '573001234567');
  ok('con + delante', waPhone('+57 300 123 4567') === '573001234567',
    String(waPhone('+57 300 123 4567')));
  ok('con 0 delante del indicativo', waPhone('0573001234567') === '573001234567',
    String(waPhone('0573001234567')));
  // Un fijo no tiene WhatsApp: hay que decirlo, no construir un número a medias.
  ok('fijo de 7 dígitos da null', waPhone('2345678') === null, String(waPhone('2345678')));
  ok('vacío da null', waPhone('') === null);
  ok('undefined da null', waPhone(undefined) === null);
  ok('texto sin dígitos da null', waPhone('no tiene') === null);
}

grupo('scoreProduct — bloqueadores y peso evaluado');
{
  const base = {
    id: 'p1', name: 'Prueba', stage: 'test',
    price: 100000, cost: 20000, fee: 0, shipOut: 10000, shipBack: 10000,
    targetCpa: 15000, returnRateOverride: 20,
  };
  const todoBien = {
    gancho: 'fuerte', peso: 'bueno', demanda: 'tres',
    proveedor: 'nacional', saturacion: 'baja',
    invima: 'no-aplica', marca: 'original',
  };

  const perfecto = scoreProduct({ ...base, score: todoBien });
  cerca('todo al máximo da 100', perfecto.score, 100, 0.0001);
  ok('y el veredicto es lanzar', perfecto.veredicto.label === 'Lanzar', perfecto.veredicto.label);
  ok('sin bloqueadores', perfecto.bloqueadores.length === 0);
  ok('peso evaluado completo', perfecto.pesoEvaluado === 100, String(perfecto.pesoEvaluado));

  // La propiedad que más importa: un bloqueador NO se promedia, anula.
  const replica = scoreProduct({ ...base, score: { ...todoBien, marca: 'replica' } });
  cerca('el puntaje sigue siendo alto', replica.score, 100, 0.0001);
  ok('pero el veredicto es no lanzar', replica.veredicto.label === 'No lanzar', replica.veredicto.label);
  ok('y se explica por qué', replica.bloqueadores.length === 1);

  const invima = scoreProduct({ ...base, score: { ...todoBien, invima: 'sin-registro' } });
  ok('INVIMA sin registro también bloquea', invima.veredicto.label === 'No lanzar');

  const ambos = scoreProduct({ ...base, score: { ...todoBien, invima: 'sin-registro', marca: 'replica' } });
  ok('los dos bloqueadores se listan por separado', ambos.bloqueadores.length === 2);

  // Lo no respondido se excluye del numerador Y del denominador.
  const soloNumeros = scoreProduct({ ...base, score: {} });
  ok('sin cuestionario sólo pesan los 40 económicos', soloNumeros.pesoEvaluado === 40,
    String(soloNumeros.pesoEvaluado));
  ok('y queda claro cuánto falta', soloNumeros.pesoSinEvaluar === 60);
  ok('no da veredicto de lanzar sin cuestionario',
    soloNumeros.veredicto.label === 'Evaluación incompleta', soloNumeros.veredicto.label);

  // Sin precio ni costo los criterios económicos no se inventan.
  const sinNumeros = scoreProduct({ id: 'p2', name: 'Vacío', score: todoBien });
  ok('sin costos los económicos se excluyen', sinNumeros.pesoEvaluado === 60,
    String(sinNumeros.pesoEvaluado));
  ok('y se marca que faltan', sinNumeros.tieneNumeros === false);

  // Un producto malo tiene que puntuar mal.
  const malo = scoreProduct({
    ...base, price: 25000, cost: 20000,
    score: { gancho: 'debil', peso: 'malo', demanda: 'ninguna', proveedor: 'ninguno', saturacion: 'alta', invima: 'no-aplica', marca: 'original' },
  });
  ok('un producto malo no pasa de 45', malo.score < 45, String(malo.score));
  ok('y el veredicto lo dice', malo.veredicto.label === 'No lanzar', malo.veredicto.label);
}

grupo('observedCpa — la regresión del cero (bug real, ya corregido)');
{
  /* Cuando no hay gasto registrado, observedCpa tiene que devolver null y NO
     cero. Con cero, unitEconomics borraba la publicidad de la cuenta y todo
     producto se veía rentable. Esta prueba existe para que no vuelva. */
  sandbox.orders.length = 0;
  sandbox.campaigns.length = 0;
  sandbox.orders.push({ id: 'o1', productId: 'p1', status: 'nuevo' });
  ok('sin gasto registrado devuelve null', observedCpa('p1') === null, String(observedCpa('p1')));

  sandbox.campaigns.push({ id: 'c1', productId: 'p1', spend: 40000 });
  cerca('con gasto divide entre los pedidos', observedCpa('p1'), 40000);

  sandbox.orders.push({ id: 'o2', productId: 'p1', status: 'entregado' });
  cerca('y cuenta todos los pedidos no cancelados', observedCpa('p1'), 20000);

  // Un cancelado no cuenta: nunca llegó a ser un pedido real.
  sandbox.orders.push({ id: 'o3', productId: 'p1', status: 'cancelado' });
  cerca('los cancelados no diluyen el CPA', observedCpa('p1'), 20000);

  // Y el efecto que tenía el bug, comprobado de frente.
  const p = { id: 'p1', price: 100000, cost: 20000, fee: 0, shipOut: 10000, shipBack: 10000, targetCpa: 0, returnRateOverride: 20 };
  const conCpaReal = unitEconomics(p, { cpa: observedCpa('p1') });
  const conCpaCero = unitEconomics(p, { cpa: 0 });
  ok('un CPA de cero infla el margen', conCpaCero.margen > conCpaReal.margen,
    `${conCpaCero.margen} vs ${conCpaReal.margen}`);
  sandbox.orders.length = 0;
  sandbox.campaigns.length = 0;
}

console.log(`\n${pasadas} pasadas, ${falladas} falladas`);
process.exit(falladas ? 1 : 0);
