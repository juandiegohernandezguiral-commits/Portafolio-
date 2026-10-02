/* 19-dropship.js — el negocio: pedidos COD, unit economics y campañas.

   Tres pestañas dentro de la vista "Dropshipping":

     Pedidos    el ciclo completo de un pedido contra entrega y, sobre todo, la
                TASA DE ENTREGA EFECTIVA desglosada por producto, transportadora
                y ciudad.
     Productos  calculadora de margen real + embudo de validación.
     Campañas   gasto y resultados de Meta y TikTok, con CPA contra margen.

   POR QUÉ LA TASA DE ENTREGA ES LA PIEZA CENTRAL
   En contra entrega el pedido no es una venta: es una promesa de venta. Vendes
   100 y entregas 65. Si calculas el margen sobre los 100, el número que ves no
   existe. Todo lo que hay aquí parte de separar pedidos RESUELTOS (entregado o
   devuelto) de los que aún están en el aire, y de no contar como ingreso nada
   que no se haya entregado.

   El dinero se maneja en PESOS ENTEROS, nunca con decimales flotantes. Los COP
   no tienen centavos en la práctica, y sumar cientos de valores con coma flotante
   acumula error que luego aparece como descuadres de unos pocos pesos imposibles
   de explicar. */

/* ============ REFERENCIAS DEL MERCADO COLOMBIANO ============
   Los umbrales de este archivo NO son inventados: salen de datos publicados
   sobre dropshipping contra entrega en Colombia (ver docs/dashboard.md para las
   fuentes). Se guardan juntos y con su origen para que se puedan discutir y
   actualizar, en vez de quedar escondidos como números mágicos dentro de un if.

   Son REFERENCIAS DEL MERCADO, no leyes. Sirven para responder "¿cómo voy
   frente a los demás?", no para decidir por ti: un nicho concreto puede
   funcionar perfectamente fuera de estos rangos. */
const BENCHMARKS = {
  // Tasa de entrega. Promedio reportado 72-78%; con confirmación telefónica
  // previa 65-78%, y sin confirmar cae a 50-60%. Por experiencia: principiante
  // 65-75%, intermedio 75-85%, operación escalada 70-80%.
  entrega: { critico: 65, normal: 72, bueno: 85, promedioMin: 72, promedioMax: 78 },
  // Margen neto recomendado tras envío, comisiones y publicidad.
  margenMinimoPct: 40,
  // Ganancia neta por pedido típica en COD Colombia.
  gananciaPorPedido: { min: 25000, max: 45000 },
  // Rango de precio donde el contra entrega funciona mejor.
  precioDulce: { min: 50000, max: 200000 },
};

const ORDER_STATUS = {
  nuevo:       { label: 'Nuevo',       tone: 'neutral', resolved: false },
  confirmado:  { label: 'Confirmado',  tone: 'accent',  resolved: false },
  despachado:  { label: 'Despachado',  tone: 'amber',   resolved: false },
  entregado:   { label: 'Entregado',   tone: 'green',   resolved: true  },
  devuelto:    { label: 'Devuelto',    tone: 'red',     resolved: true  },
  cancelado:   { label: 'Cancelado',   tone: 'neutral', resolved: false },
};

const PRODUCT_STAGES = {
  investigacion: { label: 'Investigación', hint: 'Lo estoy mirando' },
  validacion:    { label: 'Validación',    hint: 'Proveedor y números cuadran' },
  test:          { label: 'Test',          hint: 'Pautando con presupuesto corto' },
  escala:        { label: 'Escala',        hint: 'Funciona, subiendo presupuesto' },
  descartado:    { label: 'Descartado',    hint: 'Muerto, con su razón' },
};

const PLATFORMS = { meta: 'Meta', tiktok: 'TikTok', organico: 'Orgánico', otro: 'Otro' };

const dropUi = {
  tab: store.get('dropTab', 'pedidos'),
  orderFilter: 'todos',
  productFilter: 'todos',
  rangeDays: 30,
};

/* ============ FORMATO ============ */

/** Pesos colombianos, sin decimales. Intl mete el símbolo y los separadores. */
function cop(n) {
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
}
function pct(n) { return (Math.round((Number(n) || 0) * 10) / 10) + '%'; }

/* ============ CÁLCULOS DE NEGOCIO ============ */

function productById(id) { return shopProducts.find(p => p.id === id) || null; }

function ordersInRange(days) {
  if (!days) return orders;
  const since = Date.now() - days * 86400000;
  return orders.filter(o => (o.createdAt || 0) >= since);
}

/**
 * Tasa de entrega efectiva: entregados sobre pedidos RESUELTOS.
 *
 * Los que siguen en tránsito se excluyen a propósito. Incluirlos como "no
 * entregados" hundiría la tasa cada vez que despachas un lote nuevo, y contarlos
 * como entregados la inflaría. Un pedido sin resolver sencillamente todavía no
 * sabe qué va a ser.
 *
 * Los cancelados tampoco cuentan: nunca llegaron a salir, así que no dicen nada
 * sobre si la transportadora entrega o si el cliente recibe.
 */
function deliveryRate(list) {
  const resueltos = list.filter(o => ORDER_STATUS[o.status]?.resolved);
  if (!resueltos.length) return { rate: null, delivered: 0, returned: 0, resolved: 0 };
  const delivered = resueltos.filter(o => o.status === 'entregado').length;
  return {
    rate: (delivered / resueltos.length) * 100,
    delivered,
    returned: resueltos.length - delivered,
    resolved: resueltos.length,
  };
}

/** Agrupa pedidos por un campo y calcula la tasa de cada grupo. */
function deliveryBy(list, key, resolveLabel) {
  const grupos = new Map();
  list.forEach(o => {
    const k = o[key] || '(sin dato)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(o);
  });
  return [...grupos.entries()]
    .map(([k, items]) => ({ key: k, label: resolveLabel ? resolveLabel(k) : k, ...deliveryRate(items), total: items.length }))
    .filter(g => g.resolved > 0)
    .sort((a, b) => b.resolved - a.resolved);
}

/**
 * Margen real por pedido ENTREGADO.
 *
 * Esta es la cuenta que separa un negocio que gana de uno que parece ganar.
 * Para conseguir 1 entrega con una tasa de devolución r hacen falta 1/(1-r)
 * pedidos, y la publicidad se paga por TODOS ellos, entregados o no. Además
 * cada devolución se come el flete de ida y el de vuelta.
 *
 *   pedidos necesarios por entrega      = 1 / (1 - r)
 *   publicidad por entrega              = cpa / (1 - r)
 *   devoluciones por entrega            = r / (1 - r)
 *   coste de esas devoluciones          = (r / (1-r)) * (fleteIda + fleteVuelta)
 *
 *   margen = precio - costo - comision - fleteIda
 *            - cpa/(1-r)
 *            - (r/(1-r)) * (fleteIda + fleteVuelta)
 *
 * El producto devuelto vuelve al inventario, así que su costo no se pierde —
 * sí los fletes.
 */
function unitEconomics(p, { cpa = null, returnRate = null } = {}) {
  const price = Number(p.price) || 0;
  const cost = Number(p.cost) || 0;
  const fee = Number(p.fee) || 0;
  const shipOut = Number(p.shipOut) || 0;
  const shipBack = Number(p.shipBack) || 0;

  const r = Math.min(Math.max((returnRate ?? effectiveReturnRate(p)) / 100, 0), 0.95);
  const ad = cpa ?? (Number(p.targetCpa) || 0);

  const brutoPorEntrega = price - cost - fee - shipOut;
  const publicidadPorEntrega = r < 1 ? ad / (1 - r) : Infinity;
  const costeDevoluciones = r < 1 ? (r / (1 - r)) * (shipOut + shipBack) : Infinity;
  const margen = brutoPorEntrega - publicidadPorEntrega - costeDevoluciones;

  return {
    price, cost, fee, shipOut, shipBack,
    returnRate: r * 100,
    cpa: ad,
    brutoPorEntrega,
    publicidadPorEntrega,
    costeDevoluciones,
    margen,
    // CPA máximo que todavía deja el margen en cero: el techo real de la puja.
    cpaMaximo: (brutoPorEntrega - costeDevoluciones) * (1 - r),
    margenPct: price > 0 ? (margen / price) * 100 : 0,
  };
}

/** Devolución observada del producto; si no hay datos resueltos, 0. */
function effectiveReturnRate(p) {
  if (typeof p.returnRateOverride === 'number') return p.returnRateOverride;
  const d = deliveryRate(orders.filter(o => o.productId === p.id));
  return d.rate === null ? 0 : 100 - d.rate;
}

/** CPA observado de un producto: gasto en campañas suyas / pedidos generados.
 *
 *  Devuelve null si NO hay gasto registrado, y esto importa mucho más de lo que
 *  parece. Antes bastaba con que hubiera pedidos para devolver 0/pedidos = 0, y
 *  un CPA de cero hace que todo producto se vea rentable: la publicidad, que
 *  suele ser el mayor costo variable, desaparecía de la cuenta. Un producto con
 *  34% de margen real aparecía con 52%.
 *
 *  Cero nunca es una observación válida aquí: significa "no hay datos", y en ese
 *  caso quien decide es el CPA objetivo que tú fijaste, no un optimismo
 *  accidental. */
function observedCpa(productId) {
  const gasto = campaigns.filter(c => c.productId === productId)
    .reduce((n, c) => n + (Number(c.spend) || 0), 0);
  const pedidos = orders.filter(o => o.productId === productId && o.status !== 'cancelado').length;
  if (gasto <= 0 || pedidos <= 0) return null;
  return gasto / pedidos;
}

/** Ingresos y margen de los pedidos entregados en el rango. */
function revenueSummary(list) {
  let ingresos = 0, margen = 0, unidades = 0;
  list.filter(o => o.status === 'entregado').forEach(o => {
    const p = productById(o.productId);
    const qty = Number(o.qty) || 1;
    const venta = Number(o.price) || (p ? (Number(p.price) || 0) * qty : 0);
    ingresos += venta;
    unidades += qty;
    if (p) {
      // Margen bruto del pedido: sin prorratear publicidad, que se resta aparte
      // a nivel de periodo porque el gasto es del periodo, no del pedido.
      margen += venta - ((Number(p.cost) || 0) + (Number(p.fee) || 0) + (Number(p.shipOut) || 0)) * qty;
    }
  });
  return { ingresos, margenBruto: margen, unidades };
}

function spendInRange(days) {
  if (!days) return campaigns.reduce((n, c) => n + (Number(c.spend) || 0), 0);
  const since = dateKey(new Date(Date.now() - days * 86400000));
  return campaigns.filter(c => (c.date || '') >= since).reduce((n, c) => n + (Number(c.spend) || 0), 0);
}

/* ============ UI: PIEZAS COMPARTIDAS ============ */

const TONE_CLASS = {
  neutral: 'bg-neutral-100 dark:bg-white/10 text-neutral-500',
  accent:  'bg-accent/15 text-accent',
  amber:   'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
  green:   'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400',
  red:     'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
};

function statTile(label, value, sub, tone) {
  return `
    <div class="surface rounded-2xl p-5">
      <div class="meta-label text-neutral-500 mb-2">${escapeHtml(label)}</div>
      <div class="display text-3xl ${tone || ''}">${value}</div>
      ${sub ? `<div class="text-xs text-neutral-500 mt-1">${sub}</div>` : ''}
    </div>`;
}

/** Barra de tasa de entrega. El color comunica riesgo, no decora, y los cortes
 *  son los de BENCHMARKS (datos del mercado colombiano), no cifras elegidas a
 *  ojo. */
function rateBar(rate) {
  if (rate === null) return '<span class="text-neutral-500 text-xs">sin datos</span>';
  const b = BENCHMARKS.entrega;
  const color = rate >= b.bueno ? 'bg-green-500' : rate >= b.normal ? 'bg-accent' : rate >= b.critico ? 'bg-amber-500' : 'bg-red-500';
  const texto = rate >= b.bueno ? 'text-green-600 dark:text-green-400' : rate >= b.normal ? 'text-accent' : rate >= b.critico ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';
  return `
    <div class="flex items-center gap-3 min-w-[160px]">
      <div class="flex-1 h-2 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
        <div class="h-full rounded-full ${color}" style="width:${Math.max(rate, 2)}%"></div>
      </div>
      <span class="mono text-xs font-semibold ${texto} w-12 text-right">${pct(rate)}</span>
    </div>`;
}

function emptyState(titulo, texto, botonTexto, botonAttr) {
  return `
    <div class="surface rounded-2xl p-12 text-center">
      <div class="w-12 h-12 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2667ff" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
      </div>
      <p class="font-display font-bold text-lg mb-1">${escapeHtml(titulo)}</p>
      <p class="text-neutral-500 text-sm max-w-md mx-auto mb-5">${escapeHtml(texto)}</p>
      ${botonTexto ? `<button type="button" ${botonAttr} class="px-5 py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">${escapeHtml(botonTexto)}</button>` : ''}
    </div>`;
}

/* ============ PESTAÑA: PEDIDOS ============ */

function renderPedidos() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  const lista = ordersInRange(dropUi.rangeDays);
  const d = deliveryRate(lista);
  const rev = revenueSummary(lista);
  const gasto = spendInRange(dropUi.rangeDays);
  const enTransito = lista.filter(o => ['confirmado', 'despachado'].includes(o.status)).length;

  if (!orders.length) {
    box.innerHTML = emptyState(
      'Sin pedidos registrados',
      'Registra cada pedido que te llega por WhatsApp. Con unos pocos ya podrás ver tu tasa de entrega real por producto, transportadora y ciudad — que es el número que decide si ganas o pierdes en contra entrega.',
      '+ Registrar el primer pedido', 'id="new-order-btn"');
    return;
  }

  const porProducto = deliveryBy(lista, 'productId', id => productById(id)?.name || '(sin producto)');
  const porTransportadora = deliveryBy(lista, 'carrier');
  const porCiudad = deliveryBy(lista, 'city');

  const tablaTasas = (titulo, filas, nota) => `
    <div class="surface rounded-2xl p-6">
      <div class="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h3 class="font-display font-bold">${titulo}</h3>
        <span class="meta-label text-neutral-500">${nota}</span>
      </div>
      ${filas.length ? `
        <div class="space-y-3">
          ${filas.slice(0, 8).map(f => `
            <div class="flex items-center gap-4 flex-wrap">
              <span class="text-sm font-medium flex-1 min-w-[120px] truncate">${escapeHtml(f.label)}</span>
              <span class="meta-label text-neutral-500 shrink-0">${f.delivered}/${f.resolved}</span>
              ${rateBar(f.rate)}
            </div>`).join('')}
        </div>`
        : '<p class="text-neutral-500 text-sm">Todavía no hay pedidos resueltos (entregados o devueltos) en este rango.</p>'}
    </div>`;

  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Tasa de entrega', d.rate === null ? '—' : pct(d.rate),
        d.rate === null ? 'sin pedidos resueltos' : `${d.delivered} entregados · ${d.returned} devueltos`,
        d.rate === null ? '' : d.rate >= 80 ? 'text-green-600 dark:text-green-400' : d.rate >= 65 ? 'text-amber-500' : 'text-red-500')}
      ${statTile('Ingresos entregados', cop(rev.ingresos), `${rev.unidades} unidades`)}
      ${statTile('Margen bruto', cop(rev.margenBruto), 'antes de publicidad')}
      ${statTile('Margen tras pauta', cop(rev.margenBruto - gasto),
        `${cop(gasto)} de pauta`, (rev.margenBruto - gasto) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500')}
    </div>

    ${enTransito ? `
      <div class="surface rounded-2xl px-6 py-4 mb-4 flex items-center gap-3 flex-wrap" style="border-left:3px solid #f59e0b;">
        <span class="text-sm flex-1">Tienes <strong>${enTransito}</strong> pedido${enTransito > 1 ? 's' : ''} en tránsito. No cuentan en la tasa de entrega hasta que se resuelvan.</span>
      </div>` : ''}

    ${benchmarkBanner(d.rate)}
    ${confirmacionBanner(lista)}

    <div class="grid lg:grid-cols-3 gap-4 mb-6">
      ${tablaTasas('Por producto', porProducto, 'entregados / resueltos')}
      ${tablaTasas('Por transportadora', porTransportadora, 'entregados / resueltos')}
      ${tablaTasas('Por ciudad', porCiudad, 'entregados / resueltos')}
    </div>

    <div class="surface rounded-2xl overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-6 py-4 border-b border-neutral-200 dark:border-white/5 flex-wrap">
        <h3 class="font-display font-bold">Pedidos</h3>
        <div class="flex items-center gap-2 flex-wrap">
          ${['todos', ...Object.keys(ORDER_STATUS)].map(s => `
            <button type="button" data-order-filter="${s}"
              class="px-3 py-1.5 rounded-full text-[10px] font-bold mono uppercase tracking-[0.12em] transition ${
                dropUi.orderFilter === s ? 'bg-accent text-white' : 'surface-soft text-neutral-500 hover:text-accent'}">
              ${s === 'todos' ? 'Todos' : ORDER_STATUS[s].label}</button>`).join('')}
          <button type="button" id="new-order-btn" class="px-4 py-1.5 rounded-full bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.12em]">+ Pedido</button>
        </div>
      </div>
      <!-- overflow-x-auto: en movil la tabla no debe romper el ancho de la pagina -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left border-b border-neutral-200 dark:border-white/5">
              ${['Cliente', 'Producto', 'Ciudad', 'Transportadora', 'Valor', 'Estado', ''].map(h =>
                `<th class="px-4 py-3 meta-label text-neutral-500 font-normal whitespace-nowrap">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${renderOrderRows()}</tbody>
        </table>
      </div>
    </div>`;
}

/** Sitúa tu tasa frente a la del mercado. Compararse con uno mismo no dice si
 *  el número es bueno; compararse con el promedio del sector, sí. */
function benchmarkBanner(rate) {
  if (rate === null) return '';
  const b = BENCHMARKS.entrega;
  let tono, texto;
  if (rate >= b.bueno) {
    tono = '#22c55e';
    texto = `Tu <strong>${pct(rate)}</strong> está por encima del promedio del mercado colombiano (${b.promedioMin}–${b.promedioMax}%). Es nivel de operación madura.`;
  } else if (rate >= b.normal) {
    tono = '#2667ff';
    texto = `Tu <strong>${pct(rate)}</strong> está dentro del promedio del mercado colombiano (${b.promedioMin}–${b.promedioMax}%).`;
  } else if (rate >= b.critico) {
    tono = '#f59e0b';
    texto = `Tu <strong>${pct(rate)}</strong> está por debajo del promedio (${b.promedioMin}–${b.promedioMax}%). Es el rango típico de quien empieza — se sube confirmando por teléfono antes de despachar.`;
  } else {
    tono = '#ef4444';
    texto = `Tu <strong>${pct(rate)}</strong> está muy por debajo del promedio (${b.promedioMin}–${b.promedioMax}%). Despachar sin confirmar suele dejar la tasa entre 50 y 60%; revisa ese paso antes de subir presupuesto.`;
  }
  return `<div class="surface rounded-2xl px-6 py-4 mb-4" style="border-left:3px solid ${tono};">
    <p class="text-sm leading-relaxed">${texto}</p>
  </div>`;
}

/** Compara la tasa de los pedidos confirmados contra los que salieron sin
 *  confirmar. Se mide en TUS datos en vez de repetir la cifra del sector: lo que
 *  importa es si en tu operación concreta confirmar cambia algo. */
function confirmacionBanner(lista) {
  const resueltos = lista.filter(o => ORDER_STATUS[o.status]?.resolved);
  const conf = deliveryRate(resueltos.filter(o => o.confirmed));
  const sin = deliveryRate(resueltos.filter(o => !o.confirmed));

  // Hace falta una muestra mínima por lado: con tres pedidos cualquier
  // diferencia es ruido y presentarla como hallazgo sería engañarse.
  if (conf.resolved < 5 || sin.resolved < 5) {
    return `<div class="surface rounded-2xl px-6 py-4 mb-6">
      <p class="text-sm text-neutral-500 leading-relaxed">
        <strong class="text-neutral-700 dark:text-neutral-300">Confirmación telefónica.</strong>
        Es la palanca más citada para subir la entrega en contra entrega: confirmar antes de
        despachar reduce las devoluciones entre un 40% y un 60%. Marca los pedidos como
        <em>Confirmado</em> antes de <em>Despachado</em> y aquí verás si en tu operación
        funciona igual. ${conf.resolved + sin.resolved > 0 ? `Llevas ${conf.resolved} confirmados y ${sin.resolved} sin confirmar resueltos; hacen falta al menos 5 de cada uno.` : ''}
      </p>
    </div>`;
  }

  const diff = conf.rate - sin.rate;
  const tono = diff > 5 ? '#22c55e' : diff < -5 ? '#ef4444' : '#2667ff';
  return `<div class="surface rounded-2xl px-6 py-4 mb-6" style="border-left:3px solid ${tono};">
    <div class="flex items-center gap-6 flex-wrap">
      <div>
        <div class="meta-label text-neutral-500 mb-1">Confirmados</div>
        <div class="display text-2xl">${pct(conf.rate)}</div>
        <div class="text-xs text-neutral-500">${conf.delivered}/${conf.resolved}</div>
      </div>
      <div>
        <div class="meta-label text-neutral-500 mb-1">Sin confirmar</div>
        <div class="display text-2xl">${pct(sin.rate)}</div>
        <div class="text-xs text-neutral-500">${sin.delivered}/${sin.resolved}</div>
      </div>
      <p class="text-sm flex-1 min-w-[240px] leading-relaxed">
        ${diff > 5
          ? `Confirmar te sube la entrega <strong>${pct(diff)}</strong>. Es el dato de tu propia operación, no una regla general: vale la pena confirmar todo.`
          : diff < -5
          ? `Tus confirmados entregan <strong>${pct(Math.abs(diff))}</strong> menos, que es lo contrario de lo esperado. Probablemente estés marcando como confirmados pedidos que en realidad no lo están.`
          : `Apenas <strong>${pct(Math.abs(diff))}</strong> de diferencia. En tu operación confirmar todavía no está cambiando el resultado.`}
      </p>
    </div>
  </div>`;
}

function renderOrderRows() {
  const lista = orders
    .filter(o => dropUi.orderFilter === 'todos' || o.status === dropUi.orderFilter)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 60);

  if (!lista.length) {
    return `<tr><td colspan="7" class="px-4 py-10 text-center text-neutral-500 text-sm">Ningún pedido con este filtro.</td></tr>`;
  }

  return lista.map(o => {
    const p = productById(o.productId);
    const st = ORDER_STATUS[o.status] || ORDER_STATUS.nuevo;
    return `
      <tr class="border-b border-neutral-100 dark:border-white/5 hover:bg-accent/[0.03]">
        <td class="px-4 py-3">
          <div class="font-medium truncate max-w-[160px]">${escapeHtml(o.customer || 'Sin nombre')}</div>
          ${o.phone ? `<div class="meta-label text-neutral-400">${escapeHtml(o.phone)}</div>` : ''}
        </td>
        <td class="px-4 py-3 truncate max-w-[150px]">${escapeHtml(p ? p.name : '—')}</td>
        <td class="px-4 py-3 whitespace-nowrap">${escapeHtml(o.city || '—')}</td>
        <td class="px-4 py-3 whitespace-nowrap">${escapeHtml(o.carrier || '—')}</td>
        <td class="px-4 py-3 mono whitespace-nowrap">${cop(o.price)}</td>
        <td class="px-4 py-3">
          <select data-order-status="${o.id}" class="px-2.5 py-1 rounded-full text-[10px] font-bold mono uppercase tracking-[0.12em] border-0 ${TONE_CLASS[st.tone]}">
            ${Object.entries(ORDER_STATUS).map(([k, v]) =>
              `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </td>
        <td class="px-4 py-3 text-right">
          <button type="button" data-order-delete="${o.id}" aria-label="Borrar pedido"
            class="w-8 h-8 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
        </td>
      </tr>`;
  }).join('');
}

/* ============ PESTAÑA: PRODUCTOS ============ */

function renderProductos() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  if (!shopProducts.length) {
    box.innerHTML = emptyState(
      'Sin productos',
      'Añade un producto con sus costos y el panel te dirá el margen real por entrega y hasta cuánto puedes pagar por pedido antes de empezar a perder plata.',
      '+ Añadir producto', 'id="new-product-btn"');
    return;
  }

  // Embudo de validación: cuántos productos hay en cada etapa.
  const etapas = Object.entries(PRODUCT_STAGES).map(([k, v]) => ({
    key: k, ...v, items: shopProducts.filter(p => (p.stage || 'investigacion') === k),
  }));
  const maxEtapa = Math.max(...etapas.map(e => e.items.length), 1);

  const visibles = dropUi.productFilter === 'todos'
    ? shopProducts
    : shopProducts.filter(p => (p.stage || 'investigacion') === dropUi.productFilter);

  box.innerHTML = `
    <div class="surface rounded-2xl p-6 mb-6">
      <div class="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h3 class="font-display font-bold">Embudo de validación</h3>
        <button type="button" id="new-product-btn" class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.2em]">+ Producto</button>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        ${etapas.map(e => `
          <button type="button" data-product-filter="${e.key}"
            class="text-left p-4 rounded-xl border transition ${dropUi.productFilter === e.key ? 'bg-accent/10 border-accent/50' : 'surface-soft hover:border-accent'}">
            <div class="display text-2xl ${e.items.length ? 'text-accent' : 'text-neutral-400'}">${e.items.length}</div>
            <div class="font-semibold text-xs mt-1">${e.label}</div>
            <div class="h-1 rounded-full bg-neutral-200 dark:bg-white/10 mt-2 overflow-hidden">
              <div class="h-full bg-accent/60" style="width:${(e.items.length / maxEtapa) * 100}%"></div>
            </div>
            <div class="text-neutral-500 text-[10px] mt-1.5">${e.hint}</div>
          </button>`).join('')}
      </div>
      ${dropUi.productFilter !== 'todos'
        ? `<button type="button" data-product-filter="todos" class="meta-label !text-accent mt-4">← Ver todos</button>` : ''}
    </div>

    <div class="space-y-4">
      ${visibles.map(p => renderProductCard(p)).join('') ||
        '<div class="surface rounded-2xl p-10 text-center text-neutral-500 text-sm">Ningún producto en esta etapa.</div>'}
    </div>`;
}

/** Avisos de un producto contra las referencias del mercado (BENCHMARKS). */
function productWarnings(p, e) {
  const avisos = [];

  if (e.margen <= 0) {
    avisos.push({ tono: '#ef4444', texto:
      `Pierdes ${cop(Math.abs(e.margen))} por entrega. Baja el CPA, sube el precio o mejora la tasa de entrega.` });
  } else {
    if (e.margenPct < BENCHMARKS.margenMinimoPct) {
      avisos.push({ tono: '#f59e0b', texto:
        `Margen del ${pct(e.margenPct)}. Para contra entrega se recomienda al menos ${BENCHMARKS.margenMinimoPct}% neto, porque cualquier subida del CPA o de las devoluciones se come lo que queda.` });
    }
    const g = BENCHMARKS.gananciaPorPedido;
    if (e.margen < g.min) {
      avisos.push({ tono: '#f59e0b', texto:
        `Ganas ${cop(e.margen)} por pedido. Lo típico en COD Colombia es entre ${cop(g.min)} y ${cop(g.max)}; por debajo cuesta mucho que el volumen compense.` });
    }
  }

  const pr = BENCHMARKS.precioDulce;
  if (e.price > 0 && e.price < pr.min) {
    avisos.push({ tono: '#f59e0b', texto:
      `Precio de ${cop(e.price)}. El contra entrega funciona mejor entre ${cop(pr.min)} y ${cop(pr.max)}: por debajo, el flete y la publicidad pesan demasiado sobre el ticket.` });
  } else if (e.price > pr.max) {
    avisos.push({ tono: '#2667ff', texto:
      `Precio de ${cop(e.price)}, por encima del rango habitual de contra entrega (hasta ${cop(pr.max)}). Se puede vender, pero suele costar más que el cliente acepte pagar al recibir.` });
  }

  if (!avisos.length) return '';
  return avisos.map(a => `
    <div class="rounded-xl p-4" style="border-left:3px solid ${a.tono};background:${a.tono}10">
      <p class="text-xs leading-relaxed" style="color:${a.tono}">${a.texto}</p>
    </div>`).join('');
}

function renderProductCard(p) {
  const cpaObs = observedCpa(p.id);
  const e = unitEconomics(p, { cpa: cpaObs ?? undefined });
  const devoluciones = deliveryRate(orders.filter(o => o.productId === p.id));
  const viable = e.margen > 0;

  const fila = (etiqueta, valor, negativo) => `
    <div class="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-white/5 last:border-0">
      <span class="text-neutral-500 text-xs">${etiqueta}</span>
      <span class="mono text-xs ${negativo ? 'text-red-500' : ''}">${negativo ? '−' : ''}${cop(Math.abs(valor))}</span>
    </div>`;

  return `
    <div class="surface rounded-2xl p-6">
      <div class="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <h3 class="font-display font-bold text-xl truncate">${escapeHtml(p.name)}</h3>
            <span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent/15 text-accent">${PRODUCT_STAGES[p.stage || 'investigacion'].label}</span>
          </div>
          <p class="meta-label text-neutral-500">
            Precio ${cop(p.price)} · devolución ${devoluciones.rate === null ? 'sin datos' : pct(100 - devoluciones.rate)}
            ${cpaObs !== null ? ` · CPA real ${cop(cpaObs)}` : ' · CPA estimado'}
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <select data-product-stage="${p.id}" aria-label="Etapa del producto"
            class="surface-soft rounded-lg px-3 py-2 text-xs focus:border-accent focus:outline-none">
            ${Object.entries(PRODUCT_STAGES).map(([k, v]) =>
              `<option value="${k}" ${(p.stage || 'investigacion') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <button type="button" data-product-edit="${p.id}" class="px-3 py-2 rounded-lg surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.15em]">Editar</button>
          <button type="button" data-product-delete="${p.id}" aria-label="Borrar producto"
            class="w-9 h-9 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
        </div>
      </div>

      <div class="grid md:grid-cols-[1fr_280px] gap-6">
        <div>
          <div class="meta-label text-neutral-500 mb-2">Desglose por pedido entregado</div>
          ${fila('Precio de venta', e.price)}
          ${fila('Costo del producto', e.cost, true)}
          ${fila('Comisión', e.fee, true)}
          ${fila('Flete de ida', e.shipOut, true)}
          ${fila(`Publicidad &nbsp;<span class="text-neutral-400">(CPA ${cop(e.cpa)} ÷ ${pct(100 - e.returnRate)} de entrega)</span>`, e.publicidadPorEntrega, true)}
          ${fila(`Fletes de devoluciones &nbsp;<span class="text-neutral-400">(${pct(e.returnRate)} devuelve)</span>`, e.costeDevoluciones, true)}
          <div class="flex items-center justify-between pt-3 mt-1">
            <span class="font-display font-bold">Margen real</span>
            <span class="display text-2xl ${viable ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">${cop(e.margen)}</span>
          </div>
        </div>

        <div class="space-y-3">
          <div class="surface-soft rounded-xl p-4">
            <div class="meta-label text-neutral-500 mb-1">CPA máximo</div>
            <div class="display text-2xl ${e.cpaMaximo > 0 ? '' : 'text-red-500'}">${cop(e.cpaMaximo)}</div>
            <p class="text-neutral-500 text-[11px] mt-1.5 leading-relaxed">Por encima de esto cada pedido te cuesta plata, aunque la campaña se vea bien.</p>
          </div>
          <div class="surface-soft rounded-xl p-4">
            <div class="meta-label text-neutral-500 mb-1">Margen sobre venta</div>
            <div class="display text-2xl ${viable ? '' : 'text-red-500'}">${pct(e.margenPct)}</div>
          </div>
          ${productWarnings(p, e)}
        </div>
      </div>
      ${p.killReason ? `<p class="text-neutral-500 text-xs mt-4 pt-4 border-t border-neutral-100 dark:border-white/5"><strong>Por qué se descartó:</strong> ${escapeHtml(p.killReason)}</p>` : ''}
    </div>`;
}

/* ============ PESTAÑA: CAMPAÑAS ============ */

function renderCampanas() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  const gasto = spendInRange(dropUi.rangeDays);
  const pedidosRango = ordersInRange(dropUi.rangeDays).filter(o => o.status !== 'cancelado');
  const cpaGlobal = pedidosRango.length ? gasto / pedidosRango.length : null;
  const rev = revenueSummary(ordersInRange(dropUi.rangeDays));
  const roas = gasto > 0 ? rev.ingresos / gasto : null;

  const porPlataforma = Object.keys(PLATFORMS).map(k => {
    const items = campaigns.filter(c => c.platform === k);
    return { key: k, label: PLATFORMS[k], spend: items.reduce((n, c) => n + (Number(c.spend) || 0), 0), count: items.length };
  }).filter(x => x.count > 0);

  box.innerHTML = `
    ${metaSyncBanner()}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Gasto en pauta', cop(gasto), `últimos ${dropUi.rangeDays} días`)}
      ${statTile('CPA global', cpaGlobal === null ? '—' : cop(cpaGlobal), `${pedidosRango.length} pedidos`)}
      ${statTile('ROAS', roas === null ? '—' : (Math.round(roas * 100) / 100) + 'x', 'sobre entregado, no sobre pedido')}
      ${statTile('Margen tras pauta', cop(rev.margenBruto - gasto), '', (rev.margenBruto - gasto) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500')}
    </div>

    <div class="surface rounded-2xl p-6 mb-6" style="border-left:3px solid #2667ff;">
      <h3 class="font-display font-bold mb-2">Por qué el ROAS aquí no es el de Meta</h3>
      <p class="text-neutral-500 text-sm leading-relaxed">
        Meta calcula el retorno sobre los pedidos que entran. Este panel lo calcula sobre lo que
        realmente <strong>entregaste y cobraste</strong>. En contra entrega la diferencia entre ambos
        es justo lo que se devuelve, y es la razón por la que una campaña puede verse rentable en Meta
        y estar perdiendo plata en tu bolsillo.
      </p>
    </div>

    ${porPlataforma.length ? `
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${porPlataforma.map(p => statTile(p.label, cop(p.spend), `${p.count} registro${p.count > 1 ? 's' : ''}`)).join('')}
      </div>` : ''}

    <div class="surface rounded-2xl overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-6 py-4 border-b border-neutral-200 dark:border-white/5 flex-wrap">
        <div>
          <h3 class="font-display font-bold">Registro de campañas</h3>
          <p class="meta-label text-neutral-500 mt-0.5">Gasto diario por campaña y plataforma</p>
        </div>
        <button type="button" id="new-campaign-btn" class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em]">+ Registro</button>
      </div>
      ${campaigns.length ? `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left border-b border-neutral-200 dark:border-white/5">
                ${['Fecha', 'Campaña', 'Plataforma', 'Producto', 'Gasto', 'Resultados', 'CPA', ''].map(h =>
                  `<th class="px-4 py-3 meta-label text-neutral-500 font-normal whitespace-nowrap">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${campaigns.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60).map(c => {
                const res = Number(c.results) || 0;
                const cpa = res > 0 ? (Number(c.spend) || 0) / res : null;
                const prod = productById(c.productId);
                return `
                  <tr class="border-b border-neutral-100 dark:border-white/5 hover:bg-accent/[0.03]">
                    <td class="px-4 py-3 mono text-xs whitespace-nowrap">${escapeHtml(c.date || '—')}</td>
                    <td class="px-4 py-3 truncate max-w-[200px]">${escapeHtml(c.name || '—')}</td>
                    <td class="px-4 py-3"><span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent/15 text-accent">${PLATFORMS[c.platform] || c.platform}</span></td>
                    <td class="px-4 py-3 truncate max-w-[140px]">${escapeHtml(prod ? prod.name : '—')}</td>
                    <td class="px-4 py-3 mono whitespace-nowrap">${cop(c.spend)}</td>
                    <td class="px-4 py-3 mono">${res || '—'}</td>
                    <td class="px-4 py-3 mono whitespace-nowrap">${cpa === null ? '—' : cop(cpa)}</td>
                    <td class="px-4 py-3 text-right">
                      <button type="button" data-campaign-delete="${c.id}" aria-label="Borrar registro"
                        class="w-8 h-8 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`
        : `<div class="p-10 text-center">
             <p class="text-neutral-500 text-sm max-w-md mx-auto">Sin registros todavía. Anota el gasto y los resultados de cada campaña para que el panel cruce tu CPA real contra el margen de cada producto.</p>
           </div>`}
    </div>`;
}

/* ============ VISTA ============ */

function renderDropship() {
  document.querySelectorAll('.drop-tab-btn').forEach(b => {
    const activo = b.dataset.dropTab === dropUi.tab;
    b.classList.toggle('bg-accent', activo);
    b.classList.toggle('text-white', activo);
    b.classList.toggle('text-neutral-500', !activo);
    b.setAttribute('aria-selected', activo ? 'true' : 'false');
  });

  const sel = document.getElementById('drop-range');
  if (sel) sel.value = String(dropUi.rangeDays);

  if (dropUi.tab === 'pedidos') renderPedidos();
  else if (dropUi.tab === 'productos') renderProductos();
  else renderCampanas();
}

function showDropTab(tab) {
  dropUi.tab = tab;
  store.set('dropTab', tab);
  renderDropship();
}

/* ============ FORMULARIOS ============
   Los <select> de producto se rellenan al ABRIR el modal, no una vez al cargar:
   un producto creado en esta misma sesión tiene que aparecer sin recargar. */

function fillSelect(sel, items, valueKey, labelKey, placeholder) {
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(i => `<option value="${i[valueKey]}">${escapeHtml(i[labelKey])}</option>`).join('');
  sel.value = actual;
}

function openDropModal(id, prepare) {
  const m = document.getElementById(id);
  if (!m) return;
  const form = m.querySelector('form');
  if (form) { form.reset(); delete form.dataset.editing; }
  if (prepare) prepare(form);
  m.classList.remove('hidden');
  m.classList.add('flex');
  // Foco en el primer campo: el modal se abre para escribir, no para mirarlo.
  requestAnimationFrame(() => m.querySelector('input,select')?.focus());
}

function closeDropModals() {
  ['order-modal', 'product-modal', 'campaign-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  });
}

/* ---- Pedidos ---- */

document.addEventListener('click', e => {
  if (e.target.closest('#new-order-btn')) {
    openDropModal('order-modal', form => {
      fillSelect(form.productId, shopProducts, 'id', 'name', 'Elige un producto');
      // Prellena el precio al elegir producto: lo normal es vender al precio
      // de lista, y escribirlo cada vez es fricción que lleva a no registrar.
      form.productId.onchange = () => {
        const p = productById(form.productId.value);
        if (p && !form.price.value) form.price.value = p.price || '';
      };
    });
    return;
  }

  const delOrder = e.target.closest('[data-order-delete]');
  if (delOrder) {
    const o = orders.find(x => x.id === delOrder.dataset.orderDelete);
    if (!o || !confirm(`¿Borrar el pedido de ${o.customer || 'sin nombre'}?`)) return;
    tombstone('orders', o.id);
    orders = orders.filter(x => x.id !== o.id);
    saveAll(); renderDropship(); toast('Pedido borrado');
    return;
  }

  const filtro = e.target.closest('[data-order-filter]');
  if (filtro) { dropUi.orderFilter = filtro.dataset.orderFilter; renderDropship(); return; }

  const pf = e.target.closest('[data-product-filter]');
  if (pf) { dropUi.productFilter = pf.dataset.productFilter; renderDropship(); return; }

  if (e.target.closest('#new-product-btn')) { openDropModal('product-modal'); return; }

  const editProd = e.target.closest('[data-product-edit]');
  if (editProd) {
    const p = productById(editProd.dataset.productEdit);
    if (!p) return;
    openDropModal('product-modal', form => {
      form.dataset.editing = p.id;
      ['name', 'price', 'cost', 'fee', 'shipOut', 'shipBack', 'targetCpa', 'supplier', 'link', 'killReason'].forEach(k => {
        if (form[k]) form[k].value = p[k] ?? '';
      });
      form.stage.value = p.stage || 'investigacion';
    });
    return;
  }

  const delProd = e.target.closest('[data-product-delete]');
  if (delProd) {
    const p = productById(delProd.dataset.productDelete);
    if (!p) return;
    const vinculados = orders.filter(o => o.productId === p.id).length;
    const aviso = vinculados
      ? `\n\nTiene ${vinculados} pedido${vinculados > 1 ? 's' : ''} asociado${vinculados > 1 ? 's' : ''}; se quedarán sin producto pero no se borran.`
      : '';
    if (!confirm(`¿Borrar "${p.name}"?${aviso}`)) return;
    tombstone('shopProducts', p.id);
    shopProducts = shopProducts.filter(x => x.id !== p.id);
    saveAll(); renderDropship(); toast('Producto borrado');
    return;
  }

  if (e.target.closest('#new-campaign-btn')) {
    openDropModal('campaign-modal', form => {
      fillSelect(form.productId, shopProducts, 'id', 'name', 'Sin producto');
      form.date.value = dateKey(new Date());
    });
    return;
  }

  const delCamp = e.target.closest('[data-campaign-delete]');
  if (delCamp) {
    const c = campaigns.find(x => x.id === delCamp.dataset.campaignDelete);
    if (!c || !confirm(`¿Borrar el registro de "${c.name}"?`)) return;
    tombstone('campaigns', c.id);
    campaigns = campaigns.filter(x => x.id !== c.id);
    saveAll(); renderDropship(); toast('Registro borrado');
  }
});

/* Cambios de estado y etapa desde los <select> de las tablas. */
document.addEventListener('change', e => {
  const st = e.target.closest('[data-order-status]');
  if (st) {
    const o = orders.find(x => x.id === st.dataset.orderStatus);
    if (!o) return;
    o.status = st.value;
    // Sella cuándo se resolvió: sirve para medir cuánto tarda la transportadora.
    if (ORDER_STATUS[o.status]?.resolved) o.resolvedAt = Date.now();
    else delete o.resolvedAt;
    /* `confirmed` es una marca permanente, no el estado actual. El estado avanza
       (confirmado → despachado → entregado) y se pierde el rastro de por dónde
       pasó; esta bandera recuerda que SÍ hubo confirmación, que es lo que luego
       permite comparar la tasa de entrega de lo confirmado contra lo que salió
       sin confirmar. */
    if (o.status === 'confirmado') o.confirmed = true;
    touch(o); saveAll(); renderDropship();
    return;
  }

  const stage = e.target.closest('[data-product-stage]');
  if (stage) {
    const p = productById(stage.dataset.productStage);
    if (!p) return;
    p.stage = stage.value;
    touch(p); saveAll(); renderDropship();
    return;
  }

  const rango = e.target.closest('#drop-range');
  if (rango) { dropUi.rangeDays = Number(rango.value) || 30; renderDropship(); }
});

document.getElementById('order-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  orders.push(touch({
    id: uid(),
    customer: (fd.get('customer') || '').trim(),
    phone: (fd.get('phone') || '').trim(),
    city: (fd.get('city') || '').trim(),
    productId: fd.get('productId') || '',
    qty: Number(fd.get('qty')) || 1,
    price: Number(fd.get('price')) || 0,
    carrier: (fd.get('carrier') || '').trim(),
    source: fd.get('source') || 'meta',
    status: fd.get('status') || 'nuevo',
    confirmed: (fd.get('status') || 'nuevo') === 'confirmado',
    notes: (fd.get('notes') || '').trim(),
    createdAt: Date.now(),
  }));
  saveAll(); closeDropModals(); renderDropship(); toast('Pedido registrado');
});

document.getElementById('product-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const editando = form.dataset.editing ? productById(form.dataset.editing) : null;
  const datos = {
    name: (fd.get('name') || '').trim(),
    stage: fd.get('stage') || 'investigacion',
    price: Number(fd.get('price')) || 0,
    cost: Number(fd.get('cost')) || 0,
    fee: Number(fd.get('fee')) || 0,
    shipOut: Number(fd.get('shipOut')) || 0,
    shipBack: Number(fd.get('shipBack')) || 0,
    targetCpa: Number(fd.get('targetCpa')) || 0,
    supplier: (fd.get('supplier') || '').trim(),
    link: (fd.get('link') || '').trim(),
    killReason: (fd.get('killReason') || '').trim(),
  };
  if (editando) Object.assign(editando, datos), touch(editando);
  else shopProducts.push(touch({ id: uid(), createdAt: Date.now(), ...datos }));
  saveAll(); closeDropModals(); renderDropship();
  toast(editando ? 'Producto actualizado' : 'Producto añadido');
});

document.getElementById('campaign-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  campaigns.push(touch({
    id: uid(),
    date: fd.get('date') || dateKey(new Date()),
    name: (fd.get('name') || '').trim(),
    platform: fd.get('platform') || 'meta',
    productId: fd.get('productId') || '',
    spend: Number(fd.get('spend')) || 0,
    results: Number(fd.get('results')) || 0,
    createdAt: Date.now(),
  }));
  saveAll(); closeDropModals(); renderDropship(); toast('Registro añadido');
});

document.querySelectorAll('.drop-tab-btn').forEach(b =>
  b.addEventListener('click', () => showDropTab(b.dataset.dropTab)));

/* ============ META ADS EN VIVO ============
   El token de Meta nunca llega al navegador: la petición va al backend propio
   (/meta/campaigns), que lo guarda como variable de entorno y devuelve sólo las
   métricas. Mismo patrón que el proxy de Notion, y protegido con el mismo
   SYNC_TOKEN porque esto revela cuánto gastas en publicidad. */

const metaState = { status: 'idle', error: null, lastSync: store.get('metaLastSync', null) };

function metaBaseUrl() {
  return ((integrations.sync?.url || integrations.notion?.proxyUrl || '') + '').trim().replace(/\/$/, '');
}
function isMetaConfigured() { return !!(metaBaseUrl() && (integrations.sync?.token || '').trim()); }

const PRESET_POR_RANGO = { 7: 'last_7d', 30: 'last_30d', 90: 'last_90d', 0: 'last_90d' };

/**
 * Trae las campañas de Meta y las vuelca en `campaigns`.
 *
 * Se hace UPSERT por `externalId` + fecha de corte, no se añaden filas nuevas en
 * cada sincronización: si no, sincronizar dos veces el mismo día duplicaría el
 * gasto y todos los CPA saldrían a la mitad. Los registros escritos a mano no se
 * tocan — sólo se actualizan los que vinieron de Meta.
 */
async function syncMetaCampaigns({ interactive = false } = {}) {
  if (!isMetaConfigured()) {
    if (interactive) alert('Primero configura la URL del backend y el SYNC_TOKEN en "Conectar cuentas" → Sincronización.');
    return false;
  }
  metaState.status = 'loading';
  metaState.error = null;
  renderDropship();

  const preset = PRESET_POR_RANGO[dropUi.rangeDays] || 'last_30d';
  try {
    const res = await fetch(`${metaBaseUrl()}/meta/campaigns?preset=${preset}`, {
      headers: { 'X-Sync-Token': (integrations.sync.token || '').trim() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `El servidor respondió ${res.status}`);

    const corte = dateKey(new Date());
    let nuevos = 0, actualizados = 0;

    (data.items || []).forEach(item => {
      const existente = campaigns.find(c => c.externalId === item.externalId && c.date === corte);
      if (existente) {
        Object.assign(existente, {
          name: item.name, spend: item.spend, results: item.results,
          impressions: item.impressions, clicks: item.clicks, ctr: item.ctr,
        });
        touch(existente);
        actualizados++;
      } else {
        campaigns.push(touch({
          id: uid(), externalId: item.externalId, source: 'meta-api',
          date: corte, name: item.name, platform: 'meta',
          // El producto se asocia a mano: Meta no sabe cuál de tus productos es
          // cada campaña, y adivinarlo por el nombre fallaría en silencio.
          productId: '',
          spend: item.spend, results: item.results,
          impressions: item.impressions, clicks: item.clicks, ctr: item.ctr,
          createdAt: Date.now(),
        }));
        nuevos++;
      }
    });

    saveAll();
    metaState.status = 'ok';
    metaState.lastSync = new Date().toISOString();
    store.set('metaLastSync', metaState.lastSync);
    renderDropship();
    toast(`Meta sincronizado: ${nuevos} nuevas, ${actualizados} actualizadas`);
    return true;
  } catch (err) {
    console.warn('[meta] sincronización falló:', err);
    metaState.status = 'error';
    metaState.error = err.message;
    renderDropship();
    if (interactive) alert('No se pudo traer Meta: ' + err.message);
    return false;
  }
}

function metaSyncBanner() {
  if (!isMetaConfigured()) {
    return `<div class="surface rounded-2xl px-6 py-4 mb-6 flex items-center gap-4 flex-wrap">
      <div class="flex-1 min-w-[240px]">
        <h3 class="font-display font-bold text-sm">Meta Ads en vivo</h3>
        <p class="text-neutral-500 text-xs mt-0.5">Necesita el backend configurado y las variables META_ACCESS_TOKEN y META_AD_ACCOUNT_ID en Netlify.</p>
      </div>
      <button type="button" data-open-integrations="sync" class="meta-label !text-accent shrink-0">Configurar →</button>
    </div>`;
  }
  const estados = {
    idle: ['bg-neutral-400', 'text-neutral-500', metaState.lastSync ? `Última vez ${relativeTime(metaState.lastSync)}` : 'Sin sincronizar todavía'],
    loading: ['bg-accent animate-pulse', 'text-accent', 'Trayendo campañas…'],
    ok: ['bg-accent', 'text-accent', `Sincronizado ${relativeTime(metaState.lastSync)}`],
    error: ['bg-red-500', 'text-red-500', metaState.error || 'Error'],
  };
  const [dot, txt, msg] = estados[metaState.status] || estados.idle;
  return `<div class="surface rounded-2xl px-6 py-4 mb-6 flex items-center gap-4 flex-wrap">
    <span class="w-1.5 h-1.5 rounded-full ${dot} shrink-0"></span>
    <div class="flex-1 min-w-[200px]">
      <h3 class="font-display font-bold text-sm">Meta Ads en vivo</h3>
      <p class="meta-label ${txt} mt-0.5">${escapeHtml(msg)}</p>
    </div>
    <button type="button" id="meta-sync-btn" ${metaState.status === 'loading' ? 'disabled' : ''}
      class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em] shrink-0 ${metaState.status === 'loading' ? 'opacity-50' : ''}">
      ↻ Traer de Meta
    </button>
  </div>`;
}

document.addEventListener('click', e => {
  if (e.target.closest('#meta-sync-btn')) syncMetaCampaigns({ interactive: true });
});
