/* ============================================================================
   HERRAMIENTAS DEL NEGOCIO — cola de confirmación, zonas, precios y validación
   ============================================================================

   Carga DESPUÉS de js/19-dropship.js y reutiliza de allí: BENCHMARKS,
   ORDER_STATUS, PRODUCT_STAGES, deliveryRate, unitEconomics, observedCpa,
   productById, cop, pct, statTile, rateBar, emptyState, dropUi, renderDropship.

   DE DÓNDE SALEN LOS NÚMEROS
   Nada de lo que hay aquí es una cifra elegida a ojo. La estructura de costos,
   los umbrales y las plantillas vienen de fuentes publicadas sobre contra
   entrega en Colombia, y están anotadas en cada constante. El detalle y los
   enlaces están en docs/dashboard.md, sección "Fuentes del módulo de negocio".

   Lo que sí es tuyo y no del mercado: las tasas que el panel mide en TUS
   pedidos. Donde haya datos propios suficientes se prefieren a cualquier
   referencia externa, y donde no los haya se dice que no los hay en vez de
   rellenar con un promedio ajeno.
   ============================================================================ */

/* ============ 4x1000 Y OTRAS CONSTANTES DE COSTO ============ */

/* Gravamen a los movimientos financieros: 4 por mil sobre el dinero que mueves.
   Se aplica al recaudo, no a la venta facturada, porque es un impuesto sobre la
   transacción bancaria. */
const GMF_PCT = 0.4;

/* Mínimo de pedidos RESUELTOS para que una zona merezca una conclusión.
   Es más alto que el umbral de 5 que usa confirmacionBanner() en 19, y a
   propósito: allí se compara una sola cosa (confirmado contra no confirmado),
   aquí se comparan decenas de ciudades a la vez. Cuantas más comparaciones,
   más probable es que alguna salga extrema por puro azar, así que el corte
   tiene que ser más exigente para no acabar excluyendo una ciudad buena por
   dos devoluciones de mala suerte. */
const MUESTRA_MINIMA_ZONA = 8;

/* Diferencia en puntos frente a TU PROPIA tasa global para que una zona se
   considere mala o buena de verdad. Compararse con la tasa propia y no con un
   número absoluto es lo correcto: si tu operación entrega al 60%, una ciudad al
   62% no es un problema de esa ciudad. */
const DELTA_ZONA = 10;

/* Intentos de contacto sin respuesta tras los cuales no se despacha. Regla
   tomada tal cual de la práctica documentada en COD: lo que no contesta después
   de dos intentos no sale de bodega, porque el flete de ida y de vuelta cuesta
   más que el pedido que no iba a recibirse. */
const MAX_INTENTOS_CONFIRMACION = 2;

/* ============ NORMALIZACIÓN DE CIUDADES ============ */

/**
 * Deja el nombre de una ciudad en una forma comparable: sin acentos, en
 * minúsculas, sin puntuación y sin espacios de sobra.
 *
 * Hace falta porque el campo es texto libre: "Medellín", "medellin" y "MEDELLIN"
 * son la misma ciudad y sin esto serían tres filas distintas, cada una con una
 * muestra demasiado pequeña para decir nada. La `ñ` se descompone en n + tilde
 * y la tilde se va con el resto de los acentos, así que "Peñol" cae en "penol"
 * de forma consistente.
 */
function normalizeCity(raw) {
  return (raw || '')
    // Bloque de diacriticos combinantes U+0300..U+036F, que es lo que NFD
    // deja suelto al descomponer. Va en escapes \u y no como caracteres
    // literales: son invisibles en el editor y un guardado con otra
    // codificacion los convierte en basura sin que nadie lo note.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Ciudad canónica → nombre bonito y departamento.
   Son los municipios que concentran el volumen de contra entrega en Colombia.
   No pretende ser el DIVIPOLA completo: lo que no esté aquí no se adivina, se
   queda con su propio nombre y departamento "Sin clasificar". Preferir eso a un
   emparejamiento aproximado es deliberado — meter Cartagena del Chairá
   (Caquetá) dentro de Cartagena (Bolívar) ensuciaría justo el dato que esta
   pestaña existe para limpiar. */
const CIUDADES = {
  'bogota': ['Bogotá D.C.', 'Bogotá D.C.'],
  'soacha': ['Soacha', 'Cundinamarca'],
  'zipaquira': ['Zipaquirá', 'Cundinamarca'],
  'facatativa': ['Facatativá', 'Cundinamarca'],
  'fusagasuga': ['Fusagasugá', 'Cundinamarca'],
  'chia': ['Chía', 'Cundinamarca'],
  'mosquera': ['Mosquera', 'Cundinamarca'],
  'madrid': ['Madrid', 'Cundinamarca'],
  'funza': ['Funza', 'Cundinamarca'],
  'girardot': ['Girardot', 'Cundinamarca'],
  'medellin': ['Medellín', 'Antioquia'],
  'bello': ['Bello', 'Antioquia'],
  'itagui': ['Itagüí', 'Antioquia'],
  'envigado': ['Envigado', 'Antioquia'],
  'sabaneta': ['Sabaneta', 'Antioquia'],
  'la estrella': ['La Estrella', 'Antioquia'],
  'caldas': ['Caldas', 'Antioquia'],
  'copacabana': ['Copacabana', 'Antioquia'],
  'rionegro': ['Rionegro', 'Antioquia'],
  'apartado': ['Apartadó', 'Antioquia'],
  'turbo': ['Turbo', 'Antioquia'],
  'caucasia': ['Caucasia', 'Antioquia'],
  'cali': ['Cali', 'Valle del Cauca'],
  'palmira': ['Palmira', 'Valle del Cauca'],
  'buenaventura': ['Buenaventura', 'Valle del Cauca'],
  'tulua': ['Tuluá', 'Valle del Cauca'],
  'cartago': ['Cartago', 'Valle del Cauca'],
  'jamundi': ['Jamundí', 'Valle del Cauca'],
  'yumbo': ['Yumbo', 'Valle del Cauca'],
  'buga': ['Buga', 'Valle del Cauca'],
  'barranquilla': ['Barranquilla', 'Atlántico'],
  'soledad': ['Soledad', 'Atlántico'],
  'malambo': ['Malambo', 'Atlántico'],
  'cartagena': ['Cartagena', 'Bolívar'],
  'magangue': ['Magangué', 'Bolívar'],
  'turbaco': ['Turbaco', 'Bolívar'],
  'santa marta': ['Santa Marta', 'Magdalena'],
  'cienaga': ['Ciénaga', 'Magdalena'],
  'fundacion': ['Fundación', 'Magdalena'],
  'el banco': ['El Banco', 'Magdalena'],
  'cucuta': ['Cúcuta', 'Norte de Santander'],
  'ocana': ['Ocaña', 'Norte de Santander'],
  'pamplona': ['Pamplona', 'Norte de Santander'],
  'bucaramanga': ['Bucaramanga', 'Santander'],
  'floridablanca': ['Floridablanca', 'Santander'],
  'giron': ['Girón', 'Santander'],
  'piedecuesta': ['Piedecuesta', 'Santander'],
  'barrancabermeja': ['Barrancabermeja', 'Santander'],
  'pereira': ['Pereira', 'Risaralda'],
  'dosquebradas': ['Dosquebradas', 'Risaralda'],
  'manizales': ['Manizales', 'Caldas'],
  'la dorada': ['La Dorada', 'Caldas'],
  'armenia': ['Armenia', 'Quindío'],
  'ibague': ['Ibagué', 'Tolima'],
  'espinal': ['Espinal', 'Tolima'],
  'neiva': ['Neiva', 'Huila'],
  'pitalito': ['Pitalito', 'Huila'],
  'garzon': ['Garzón', 'Huila'],
  'villavicencio': ['Villavicencio', 'Meta'],
  'acacias': ['Acacías', 'Meta'],
  'pasto': ['Pasto', 'Nariño'],
  'ipiales': ['Ipiales', 'Nariño'],
  'tumaco': ['Tumaco', 'Nariño'],
  'popayan': ['Popayán', 'Cauca'],
  'monteria': ['Montería', 'Córdoba'],
  'sahagun': ['Sahagún', 'Córdoba'],
  'lorica': ['Lorica', 'Córdoba'],
  'sincelejo': ['Sincelejo', 'Sucre'],
  'valledupar': ['Valledupar', 'Cesar'],
  'aguachica': ['Aguachica', 'Cesar'],
  'riohacha': ['Riohacha', 'La Guajira'],
  'maicao': ['Maicao', 'La Guajira'],
  'tunja': ['Tunja', 'Boyacá'],
  'duitama': ['Duitama', 'Boyacá'],
  'sogamoso': ['Sogamoso', 'Boyacá'],
  'yopal': ['Yopal', 'Casanare'],
  'florencia': ['Florencia', 'Caquetá'],
  'quibdo': ['Quibdó', 'Chocó'],
  'arauca': ['Arauca', 'Arauca'],
  'mocoa': ['Mocoa', 'Putumayo'],
  'leticia': ['Leticia', 'Amazonas'],
  'san andres': ['San Andrés', 'San Andrés y Providencia'],
};

/* Variantes que la gente escribe de verdad. Mapean a la clave canónica. */
const ALIAS_CIUDADES = {
  'bogota dc': 'bogota',
  'bogota d c': 'bogota',
  'bogota distrito capital': 'bogota',
  'santafe de bogota': 'bogota',
  'santiago de cali': 'cali',
  'cartagena de indias': 'cartagena',
  'santa marta dtch': 'santa marta',
  'san jose de cucuta': 'cucuta',
  'villa del rosario': 'cucuta',
  'san juan de pasto': 'pasto',
  'medellin antioquia': 'medellin',
  'barranquilla atlantico': 'barranquilla',
};

/** Convierte lo que el usuario escribió en { key, label, dep }. */
function resolveCity(raw) {
  const norm = normalizeCity(raw);
  if (!norm) return { key: '', label: 'Sin ciudad', dep: 'Sin clasificar' };
  const key = ALIAS_CIUDADES[norm] || norm;
  const hit = CIUDADES[key];
  if (hit) return { key, label: hit[0], dep: hit[1] };
  // Desconocida: se respeta tal como la escribió, con mayúscula inicial por palabra.
  return {
    key,
    label: key.replace(/\b[a-z]/g, c => c.toUpperCase()),
    dep: 'Sin clasificar',
  };
}

/* ============ TELÉFONOS Y WHATSAPP ============ */

/**
 * Deja un teléfono en el formato que espera wa.me: sólo dígitos, con indicativo
 * de país y sin el `+`.
 *
 * Devuelve null cuando no se puede construir un número válido — típicamente un
 * fijo de 7 dígitos sin indicativo. Es importante que devuelva null y no un
 * número a medias: wa.me con un número inválido abre WhatsApp con un error
 * confuso, y es mejor decir en el panel que falta el celular.
 */
function waPhone(raw) {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return null;
  // Celular colombiano: 10 dígitos empezando por 3.
  if (d.length === 10 && d[0] === '3') return '57' + d;
  // Ya viene con indicativo de Colombia.
  if (d.length === 12 && d.startsWith('57')) return d;
  if (d.length === 13 && d.startsWith('057')) return d.slice(1);
  // Otro país ya completo: se respeta sin tocarlo.
  if (d.length >= 11) return d;
  return null;
}

/**
 * Mensaje de confirmación.
 *
 * El texto no es improvisado: sigue la plantilla que recomiendan las guías de
 * COD en Colombia — nombra el producto, dice el total EN VOZ ALTA, recuerda que
 * se paga en efectivo al recibir, y cierra con una pregunta cerrada que obliga a
 * una respuesta corta. Decir el precio aquí es la parte que más devoluciones
 * evita: el "no sabía que costaba tanto" en la puerta se convierte en un "no"
 * por WhatsApp, que es gratis.
 *
 * Después pide los tres datos de dirección que más fallan. Cuatro de cada diez
 * clientes que confirman terminan corrigiendo algo de su dirección, así que
 * preguntarlo no es trámite: es la mitad del valor de la llamada.
 */
function confirmMessage(o) {
  const p = productById(o.productId);
  const nombre = (o.customer || '').trim().split(/\s+/)[0] || '';
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  const producto = p ? p.name : 'tu pedido';
  const total = cop(o.price);
  return `${saludo}, te escribo para confirmar tu pedido.

📦 ${producto}
💵 Total: ${total} — lo pagas en efectivo al recibir

¿Te lo despachamos hoy?

Para que llegue sin problemas, confírmame por favor:
• Dirección exacta con barrio
• Un punto de referencia cercano
• Horario en que haya alguien para recibir`;
}

/** Antigüedad en formato corto, pensada para una cola de trabajo. */
function agoShort(ms) {
  if (!ms) return '—';
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

/* ============================================================================
   PESTAÑA: CONFIRMAR
   ============================================================================ */

/** Pedidos que esperan confirmación. Es la cola de trabajo de la pestaña. */
function pendingConfirmations() {
  return orders
    .filter(o => o.status === 'nuevo' && !o.confirmed)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* Temperatura del pedido. Los cortes vienen de la recomendación de contactar
   "en minutos, mientras el cliente todavía está caliente": la intención de
   compra se enfría rápido y un pedido de ayer ya es otra conversación. */
function temperatura(ms) {
  const min = (Date.now() - (ms || 0)) / 60000;
  if (min <= 30) return { label: 'Caliente', color: '#22c55e', nota: 'Acabó de escribir. Es el mejor momento.' };
  if (min <= 240) return { label: 'Templado', color: '#f59e0b', nota: 'Todavía se acuerda del anuncio.' };
  if (min <= 1440) return { label: 'Frío', color: '#f97316', nota: 'Ya pasaron horas; hay que recordarle qué pidió.' };
  return { label: 'Helado', color: '#ef4444', nota: 'Más de un día. Confirma sí o sí antes de despachar.' };
}

function renderConfirmacion() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  const cola = pendingConfirmations();
  const resueltos = orders.filter(o => ORDER_STATUS[o.status]?.resolved);
  const conf = deliveryRate(resueltos.filter(o => o.confirmed));
  const sin = deliveryRate(resueltos.filter(o => !o.confirmed));
  const valorEnCola = cola.reduce((n, o) => n + (Number(o.price) || 0), 0);
  const bloqueados = cola.filter(o => (o.confirmAttempts || 0) >= MAX_INTENTOS_CONFIRMACION);

  if (!orders.length) {
    box.innerHTML = emptyState(
      'Sin pedidos que confirmar',
      'Cuando registres pedidos aparecerán aquí en orden de llegada, con el mensaje listo para enviar por WhatsApp. Confirmar antes de despachar es la única palanca que sube la entrega sin gastar un peso más en pauta.',
      '+ Registrar un pedido', 'id="new-order-btn"');
    return;
  }

  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Por confirmar', String(cola.length),
        cola.length ? 'esperando tu mensaje' : 'cola limpia',
        cola.length ? 'text-amber-500' : 'text-green-600 dark:text-green-400')}
      ${statTile('Valor en la cola', cop(valorEnCola), 'pedidos sin confirmar')}
      ${statTile('Entrega confirmados', conf.resolved >= 5 ? pct(conf.rate) : '—',
        conf.resolved >= 5 ? `${conf.delivered}/${conf.resolved} resueltos` : `${conf.resolved} resueltos, faltan ${Math.max(0, 5 - conf.resolved)}`)}
      ${statTile('Entrega sin confirmar', sin.resolved >= 5 ? pct(sin.rate) : '—',
        sin.resolved >= 5 ? `${sin.delivered}/${sin.resolved} resueltos` : `${sin.resolved} resueltos, faltan ${Math.max(0, 5 - sin.resolved)}`,
        sin.resolved >= 5 && conf.resolved >= 5 && sin.rate < conf.rate ? 'text-red-500' : '')}
    </div>

    ${bloqueados.length ? `
      <div class="surface rounded-2xl px-6 py-4 mb-4" style="border-left:3px solid #ef4444;">
        <p class="text-sm leading-relaxed">
          <strong>${bloqueados.length} pedido${bloqueados.length > 1 ? 's' : ''} con ${MAX_INTENTOS_CONFIRMACION} intentos sin respuesta.</strong>
          La regla que siguen los que viven de esto es simple: lo que no contesta después de dos
          intentos no sale de bodega. Despacharlo cuesta el flete de ida más el de vuelta, y casi
          siempre vuelve. Mejor cancelarlo o intentar a otra hora del día.
        </p>
      </div>` : ''}

    <div class="surface rounded-2xl px-6 py-5 mb-6" style="border-left:3px solid #2667ff;">
      <h3 class="font-display font-bold mb-2">Cómo usar esta cola</h3>
      <p class="text-neutral-500 text-sm leading-relaxed">
        Abre el WhatsApp del pedido más reciente primero: la intención de compra se enfría en
        minutos, no en días. El mensaje ya viene con el producto, el total y la aclaración de que
        paga al recibir — decir el precio por escrito es justo lo que convierte un "no sabía que
        costaba tanto" en la puerta, que te cuesta dos fletes, en un "no" por chat, que es gratis.
        Pide siempre barrio, punto de referencia y horario: cuatro de cada diez clientes corrigen
        algo de su dirección cuando se les pregunta.
      </p>
    </div>

    ${cola.length ? `
      <div class="space-y-3">
        ${cola.map(o => renderConfirmCard(o)).join('')}
      </div>`
      : `<div class="surface rounded-2xl p-12 text-center">
           <div class="display text-3xl text-green-600 dark:text-green-400 mb-2">Cola limpia</div>
           <p class="text-neutral-500 text-sm max-w-md mx-auto">No tienes pedidos pendientes de confirmar.
           Los nuevos aparecerán aquí automáticamente en cuanto los registres.</p>
         </div>`}`;
}

function renderConfirmCard(o) {
  const p = productById(o.productId);
  const t = temperatura(o.createdAt);
  const telefono = waPhone(o.phone);
  const intentos = o.confirmAttempts || 0;
  const bloqueado = intentos >= MAX_INTENTOS_CONFIRMACION;
  const ciudad = resolveCity(o.city);
  const enlace = telefono
    ? `https://wa.me/${telefono}?text=${encodeURIComponent(confirmMessage(o))}`
    : null;

  return `
    <div class="surface rounded-2xl p-5" style="border-left:3px solid ${t.color};">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <h3 class="font-display font-bold truncate">${escapeHtml(o.customer || 'Sin nombre')}</h3>
            <span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
              style="background:${t.color}1a;color:${t.color}">${t.label} · ${agoShort(o.createdAt)}</span>
            ${intentos ? `<span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
              bloqueado ? 'bg-red-500/15 text-red-500' : 'bg-neutral-100 dark:bg-white/10 text-neutral-500'}">${intentos} intento${intentos > 1 ? 's' : ''}</span>` : ''}
          </div>
          <p class="text-sm text-neutral-500">
            ${escapeHtml(p ? p.name : 'Sin producto')} ·
            <span class="mono text-neutral-700 dark:text-neutral-300">${cop(o.price)}</span> ·
            ${escapeHtml(ciudad.label)}
          </p>
          <p class="text-neutral-500 text-xs mt-1">
            ${o.phone ? `<span class="mono">${escapeHtml(o.phone)}</span>` : '<span class="text-red-500">Sin teléfono</span>'}
            ${o.lastAttemptAt ? ` · último intento hace ${agoShort(o.lastAttemptAt)}` : ''}
          </p>
        </div>

        <div class="flex items-center gap-2 flex-wrap shrink-0">
          ${enlace
            ? `<a href="${enlace}" target="_blank" rel="noopener" data-wa-order="${o.id}"
                 class="px-4 py-2 rounded-xl bg-[#25D366] text-white font-bold mono text-[10px] uppercase tracking-[0.15em] inline-flex items-center gap-2 hover:opacity-90 transition">
                 <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.1-.7.1l-.6.8c-.1.2-.3.2-.6.1-.9-.4-1.7-.9-2.3-1.7-.4-.5-.8-1-1.1-1.6-.1-.2-.1-.4.1-.5l.7-.6c.2-.2.2-.4.1-.7l-.9-2c-.1-.3-.4-.5-.7-.4-.6.1-1.2.4-1.6.9-.5.6-.7 1.4-.6 2.1.2 1.6 1 3.1 2 4.3 1.2 1.6 2.9 2.7 4.8 3.2.8.2 1.6.2 2.3-.2.5-.3.9-.8 1.1-1.4.1-.3-.1-.6-.4-.7l.4.1zM12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
                 WhatsApp
               </a>`
            : `<span class="px-4 py-2 rounded-xl surface-soft text-neutral-400 mono text-[10px] uppercase tracking-[0.15em]">Falta celular</span>`}
          <button type="button" data-copy-confirm="${o.id}" title="Copiar el mensaje"
            class="px-3 py-2 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.15em] transition">Copiar</button>
          <button type="button" data-confirm-order="${o.id}"
            class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em] transition">✓ Confirmado</button>
          <button type="button" data-noanswer-order="${o.id}" title="Registrar un intento sin respuesta"
            class="px-3 py-2 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.15em] transition">Sin respuesta</button>
          <button type="button" data-cancel-order="${o.id}" aria-label="Cancelar pedido"
            class="w-9 h-9 rounded-xl text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition">✕</button>
        </div>
      </div>

      ${bloqueado
        ? `<p class="text-xs mt-3 pt-3 border-t border-neutral-100 dark:border-white/5 text-red-500 leading-relaxed">
             Ya van ${intentos} intentos sin respuesta. No lo despaches: intenta a una hora distinta del día
             y, si sigue sin contestar, cancélalo. Despachar a quien no confirma es pagar dos fletes para
             recuperar el producto.
           </p>`
        : `<p class="text-xs mt-3 pt-3 border-t border-neutral-100 dark:border-white/5 text-neutral-500">${t.nota}</p>`}
    </div>`;
}

/* ============================================================================
   PESTAÑA: ZONAS
   ============================================================================ */

/** Días que tardó un pedido en resolverse. null si falta alguna de las dos marcas. */
function diasEnTransito(o) {
  if (!o.createdAt || !o.resolvedAt) return null;
  const d = (o.resolvedAt - o.createdAt) / 86400000;
  return d >= 0 ? d : null;
}

/** Lo que costaron los fletes de las devoluciones de una lista de pedidos. */
function costoDevoluciones(list) {
  return list.filter(o => o.status === 'devuelto').reduce((n, o) => {
    const p = productById(o.productId);
    if (!p) return n;
    return n + (Number(p.shipOut) || 0) + (Number(p.shipBack) || 0);
  }, 0);
}

/** Agrupa pedidos por ciudad canónica y calcula todo lo que interesa de la zona. */
function zoneStats(list) {
  const grupos = new Map();
  list.forEach(o => {
    const c = resolveCity(o.city);
    if (!grupos.has(c.key)) grupos.set(c.key, { ...c, items: [] });
    grupos.get(c.key).items.push(o);
  });

  return [...grupos.values()].map(g => {
    const d = deliveryRate(g.items);
    const dias = g.items.map(diasEnTransito).filter(x => x !== null);
    return {
      ...g,
      ...d,
      total: g.items.length,
      valor: g.items.reduce((n, o) => n + (Number(o.price) || 0), 0),
      perdido: costoDevoluciones(g.items),
      diasProm: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null,
      suficiente: d.resolved >= MUESTRA_MINIMA_ZONA,
    };
  }).sort((a, b) => b.resolved - a.resolved || b.total - a.total);
}

/** La mejor transportadora de una zona, cuando hay con qué comparar. */
function mejorTransportadora(items) {
  const grupos = new Map();
  items.forEach(o => {
    const k = (o.carrier || '').trim() || '(sin dato)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(o);
  });
  const conDatos = [...grupos.entries()]
    .map(([k, v]) => ({ carrier: k, ...deliveryRate(v) }))
    .filter(x => x.resolved >= 4 && x.carrier !== '(sin dato)')
    .sort((a, b) => b.rate - a.rate);
  // Con una sola transportadora no hay comparación que hacer.
  return conDatos.length >= 2 ? conDatos : null;
}

function renderZonas() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  const lista = ordersInRange(dropUi.rangeDays);
  if (!lista.length) {
    box.innerHTML = emptyState(
      'Sin pedidos en este rango',
      'Las zonas se calculan con los pedidos que ya registraste. En contra entrega la tasa de rechazo por zona geográfica es una de las métricas que más plata mueve: hay ciudades que entregan al 85% y otras al 50%, y la diferencia se arregla excluyéndolas de la segmentación.',
      '+ Registrar un pedido', 'id="new-order-btn"');
    return;
  }

  const global = deliveryRate(lista);
  const zonas = zoneStats(lista);
  const conMuestra = zonas.filter(z => z.suficiente);
  const sinMuestra = zonas.filter(z => !z.suficiente);

  // Las malas y las buenas se juzgan contra TU tasa global, no contra un número fijo.
  const malas = global.rate === null ? [] : conMuestra.filter(z => z.rate <= global.rate - DELTA_ZONA);
  const buenas = global.rate === null ? [] : conMuestra.filter(z => z.rate >= global.rate + DELTA_ZONA);

  // Departamentos: agrupar sube el tamaño de muestra y a veces el patrón sólo
  // se ve ahí (tres municipios de la costa, cada uno con 4 pedidos, no dicen
  // nada por separado y mucho juntos).
  const porDep = new Map();
  zonas.forEach(z => {
    if (!porDep.has(z.dep)) porDep.set(z.dep, { dep: z.dep, delivered: 0, resolved: 0, total: 0, perdido: 0 });
    const d = porDep.get(z.dep);
    d.delivered += z.delivered; d.resolved += z.resolved; d.total += z.total; d.perdido += z.perdido;
  });
  const departamentos = [...porDep.values()]
    .map(d => ({ ...d, rate: d.resolved ? (d.delivered / d.resolved) * 100 : null }))
    .filter(d => d.resolved > 0)
    .sort((a, b) => b.resolved - a.resolved);

  const perdidoTotal = zonas.reduce((n, z) => n + z.perdido, 0);
  const diasTodos = lista.map(diasEnTransito).filter(x => x !== null);
  const diasProm = diasTodos.length ? diasTodos.reduce((a, b) => a + b, 0) / diasTodos.length : null;

  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Tasa global', global.rate === null ? '—' : pct(global.rate),
        `${global.delivered}/${global.resolved} resueltos`)}
      ${statTile('Ciudades con muestra', String(conMuestra.length),
        `de ${zonas.length} con pedidos`)}
      ${statTile('Días en tránsito', diasProm === null ? '—' : (Math.round(diasProm * 10) / 10) + ' d',
        'de registro a resolución')}
      ${statTile('Fletes perdidos', cop(perdidoTotal), 'ida + vuelta de devoluciones', perdidoTotal > 0 ? 'text-red-500' : '')}
    </div>

    ${renderZonasAccion(malas, buenas, global)}

    <div class="surface rounded-2xl overflow-hidden mb-6">
      <div class="px-6 py-4 border-b border-neutral-200 dark:border-white/5">
        <h3 class="font-display font-bold">Por ciudad</h3>
        <p class="meta-label text-neutral-500 mt-0.5">Hace falta ${MUESTRA_MINIMA_ZONA} pedidos resueltos para sacar conclusiones</p>
      </div>
      ${conMuestra.length ? `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left border-b border-neutral-200 dark:border-white/5">
                ${['Ciudad', 'Departamento', 'Entrega', 'Resueltos', 'Días', 'Fletes perdidos', 'vs. tu global'].map(h =>
                  `<th class="px-4 py-3 meta-label text-neutral-500 font-normal whitespace-nowrap">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${conMuestra.map(z => {
                const delta = global.rate === null ? null : z.rate - global.rate;
                return `
                  <tr class="border-b border-neutral-100 dark:border-white/5 hover:bg-accent/[0.03]">
                    <td class="px-4 py-3 font-medium whitespace-nowrap">${escapeHtml(z.label)}</td>
                    <td class="px-4 py-3 text-neutral-500 whitespace-nowrap">${escapeHtml(z.dep)}</td>
                    <td class="px-4 py-3">${rateBar(z.rate)}</td>
                    <td class="px-4 py-3 mono text-xs">${z.delivered}/${z.resolved}</td>
                    <td class="px-4 py-3 mono text-xs">${z.diasProm === null ? '—' : (Math.round(z.diasProm * 10) / 10)}</td>
                    <td class="px-4 py-3 mono text-xs ${z.perdido > 0 ? 'text-red-500' : 'text-neutral-400'}">${z.perdido ? cop(z.perdido) : '—'}</td>
                    <td class="px-4 py-3 mono text-xs ${delta === null ? '' : delta > 0 ? 'text-green-600 dark:text-green-400' : delta < 0 ? 'text-red-500' : ''}">
                      ${delta === null ? '—' : (delta > 0 ? '+' : '') + pct(delta)}
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`
        : `<div class="p-10 text-center">
             <p class="text-neutral-500 text-sm max-w-lg mx-auto leading-relaxed">
               Ninguna ciudad llega todavía a ${MUESTRA_MINIMA_ZONA} pedidos resueltos. Es a propósito que el panel
               no muestre nada aún: con cuatro o cinco pedidos, dos devoluciones de mala suerte hacen que una
               ciudad perfectamente normal parezca un desastre, y excluirla de la pauta por eso te costaría ventas.
             </p>
           </div>`}
      ${sinMuestra.length ? `
        <div class="px-6 py-4 border-t border-neutral-200 dark:border-white/5">
          <p class="meta-label text-neutral-500 mb-2">Todavía sin muestra suficiente</p>
          <div class="flex flex-wrap gap-1.5">
            ${sinMuestra.map(z => `
              <span class="mono text-[10px] px-2 py-1 rounded-lg surface-soft text-neutral-500">
                ${escapeHtml(z.label)} <span class="text-neutral-400">${z.resolved}/${MUESTRA_MINIMA_ZONA}</span>
              </span>`).join('')}
          </div>
        </div>` : ''}
    </div>

    ${departamentos.length > 1 ? `
      <div class="surface rounded-2xl p-6 mb-6">
        <div class="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
          <h3 class="font-display font-bold">Por departamento</h3>
          <span class="meta-label text-neutral-500">agrupar sube la muestra</span>
        </div>
        <div class="space-y-3">
          ${departamentos.map(d => `
            <div class="flex items-center gap-4 flex-wrap">
              <span class="text-sm font-medium flex-1 min-w-[140px] truncate">${escapeHtml(d.dep)}</span>
              <span class="meta-label text-neutral-500 shrink-0">${d.delivered}/${d.resolved}</span>
              ${rateBar(d.rate)}
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${renderCarrierPorZona(conMuestra, lista)}`;
}

/** Lo que hay que hacer con lo que dice la tabla. Sin esto son números bonitos. */
function renderZonasAccion(malas, buenas, global) {
  if (global.rate === null) return '';
  if (!malas.length && !buenas.length) {
    return `<div class="surface rounded-2xl px-6 py-4 mb-6" style="border-left:3px solid #2667ff;">
      <p class="text-sm leading-relaxed">
        Ninguna ciudad con muestra suficiente se despega más de ${DELTA_ZONA} puntos de tu tasa global
        (<strong>${pct(global.rate)}</strong>). Es una buena noticia: significa que tu problema de entrega,
        si lo hay, no es geográfico y no vas a arreglarlo excluyendo zonas. Mira la confirmación y la
        transportadora.
      </p>
    </div>`;
  }

  return `
    <div class="grid lg:grid-cols-2 gap-4 mb-6">
      ${malas.length ? `
        <div class="surface rounded-2xl p-6" style="border-left:3px solid #ef4444;">
          <h3 class="font-display font-bold mb-1">Considera excluir de la pauta</h3>
          <p class="text-neutral-500 text-xs mb-4 leading-relaxed">
            Entregan ${DELTA_ZONA} puntos o más por debajo de tu ${pct(global.rate)} global, con muestra
            suficiente. Excluirlas en la segmentación de Meta sube tu tasa sin tocar nada más; si no quieres
            perder el mercado, pide anticipo del flete allí.
          </p>
          <div class="space-y-2">
            ${malas.map(z => `
              <div class="flex items-center justify-between gap-3 py-2 border-b border-neutral-100 dark:border-white/5 last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium truncate">${escapeHtml(z.label)}</div>
                  <div class="meta-label text-neutral-500">${escapeHtml(z.dep)} · ${z.delivered}/${z.resolved}${z.perdido ? ` · ${cop(z.perdido)} en fletes` : ''}</div>
                </div>
                <span class="mono text-sm font-semibold text-red-500 shrink-0">${pct(z.rate)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

      ${buenas.length ? `
        <div class="surface rounded-2xl p-6" style="border-left:3px solid #22c55e;">
          <h3 class="font-display font-bold mb-1">Donde más conviene empujar</h3>
          <p class="text-neutral-500 text-xs mb-4 leading-relaxed">
            Entregan ${DELTA_ZONA} puntos o más por encima de tu global. El mismo peso de pauta puesto aquí
            rinde más porque se devuelve menos: vale la pena una campaña segmentada sólo a estas zonas.
          </p>
          <div class="space-y-2">
            ${buenas.map(z => `
              <div class="flex items-center justify-between gap-3 py-2 border-b border-neutral-100 dark:border-white/5 last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium truncate">${escapeHtml(z.label)}</div>
                  <div class="meta-label text-neutral-500">${escapeHtml(z.dep)} · ${z.delivered}/${z.resolved}</div>
                </div>
                <span class="mono text-sm font-semibold text-green-600 dark:text-green-400 shrink-0">${pct(z.rate)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

/** Qué transportadora funciona mejor en cada zona. */
function renderCarrierPorZona(zonas, lista) {
  const filas = zonas.map(z => {
    const items = lista.filter(o => resolveCity(o.city).key === z.key);
    const comp = mejorTransportadora(items);
    return comp ? { zona: z, comp } : null;
  }).filter(Boolean);

  if (!filas.length) {
    return `<div class="surface rounded-2xl p-6">
      <h3 class="font-display font-bold mb-2">Transportadora por zona</h3>
      <p class="text-neutral-500 text-sm leading-relaxed max-w-2xl">
        Todavía no hay ninguna ciudad donde hayas usado dos transportadoras distintas con al menos 4 pedidos
        resueltos cada una. Es la comparación más útil de esta pestaña, porque la mejor transportadora
        <em>cambia según la zona</em>: la que gana en Bogotá puede ser la peor en la costa. Para tenerla,
        alterna transportadora en una misma ciudad durante un par de semanas.
      </p>
    </div>`;
  }

  return `
    <div class="surface rounded-2xl p-6">
      <div class="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h3 class="font-display font-bold">Transportadora por zona</h3>
        <span class="meta-label text-neutral-500">mínimo 4 resueltos por transportadora</span>
      </div>
      <div class="space-y-5">
        ${filas.map(f => `
          <div>
            <div class="flex items-baseline gap-2 mb-2 flex-wrap">
              <span class="font-semibold text-sm">${escapeHtml(f.zona.label)}</span>
              <span class="meta-label text-neutral-500">${escapeHtml(f.zona.dep)}</span>
            </div>
            <div class="space-y-2 pl-1">
              ${f.comp.map((c, i) => `
                <div class="flex items-center gap-4 flex-wrap">
                  <span class="text-xs flex-1 min-w-[120px] truncate ${i === 0 ? 'font-semibold' : 'text-neutral-500'}">
                    ${i === 0 ? '★ ' : ''}${escapeHtml(c.carrier)}
                  </span>
                  <span class="meta-label text-neutral-500 shrink-0">${c.delivered}/${c.resolved}</span>
                  ${rateBar(c.rate)}
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ============================================================================
   PESTAÑA: CALCULADORA DE PRECIOS
   ============================================================================

   EL MODELO
   Todo se expresa por PEDIDO ENTREGADO, que es la única unidad que paga. Con una
   tasa de devolución r hacen falta 1/(1-r) pedidos para conseguir una entrega, y
   hay tres clases de costo que se comportan distinto:

     a) Los que pagas por cada INTENTO, entregue o no — flete de ida, empaque,
        confirmación y, si tu CPA es por pedido recibido, la publicidad. Se
        multiplican por 1/(1-r).
     b) Los que pagas sólo cuando algo se DEVUELVE — flete de vuelta y la parte
        del producto que vuelve invendible. Se multiplican por r/(1-r).
     c) Los que pagas sólo cuando se ENTREGA — el producto, el recaudo, el 4x1000
        y la provisión de impuestos. Se pagan una vez.

   El producto devuelto vuelve al inventario, así que su costo no se pierde; lo
   que se pierde son los fletes. La excepción es la merma: una parte vuelve con el
   empaque roto y no se puede volver a vender.

   Separar lo que depende del precio de lo que no es lo que permite despejar el
   precio en una línea en vez de tantear. Si K son los costos fijos por entrega y
   v la suma de los porcentajes que se calculan sobre el precio:

       margen(P) = P·(1 − v) − K
       para un margen objetivo m (fracción del precio):
       P·(1 − v) − K = m·P   →   P = K / (1 − v − m)
   ============================================================================ */

const CALC_DEFAULTS = {
  name: '',
  productId: '',
  price: 89900,
  cost: 28000,
  packaging: 1200,
  shipOut: 12000,
  shipBack: 12000,
  codFixed: 2500,
  codPct: 0,
  cpa: 20000,
  cpaPerDelivery: false,
  returnRate: 25,
  spoilPct: 10,
  confirmCost: 300,
  gmf: true,
  taxPct: 0,
  targetMarginPct: 40,
};

const calcState = Object.assign({}, CALC_DEFAULTS, store.get('calcState', {}));

function calcNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback || 0);
}

/**
 * Desglose completo por pedido entregado, al precio que venga en `inputs.price`.
 *
 * Las filas que devuelve suman EXACTAMENTE el margen, a propósito: un desglose
 * que no cuadra con su total es peor que no tener desglose, porque invita a
 * confiar en un número que no se puede auditar.
 */
function calcEconomics(inputs) {
  const i = inputs;
  const price = calcNum(i.price);
  const cost = calcNum(i.cost);
  const r = Math.min(Math.max(calcNum(i.returnRate) / 100, 0), 0.95);

  const intentos = 1 / (1 - r);
  const devoluciones = r / (1 - r);

  // (a) por intento
  const fleteTotal = calcNum(i.shipOut) * intentos;
  const empaqueTotal = calcNum(i.packaging) * intentos;
  const confirmTotal = calcNum(i.confirmCost) * intentos;
  const adTotal = i.cpaPerDelivery ? calcNum(i.cpa) : calcNum(i.cpa) * intentos;

  // (b) sólo devoluciones
  const fletesVuelta = calcNum(i.shipBack) * devoluciones;
  const merma = cost * (calcNum(i.spoilPct) / 100) * devoluciones;

  // (c) sólo entregas — los porcentuales dependen del precio
  const codFixed = calcNum(i.codFixed);
  const pctVar = (calcNum(i.codPct) + (i.gmf ? GMF_PCT : 0) + calcNum(i.taxPct)) / 100;
  const codVar = price * (calcNum(i.codPct) / 100);
  const gmfCost = price * ((i.gmf ? GMF_PCT : 0) / 100);
  const taxCost = price * (calcNum(i.taxPct) / 100);

  // K: todo lo que NO se mueve si cambia el precio.
  const fijos = cost + codFixed + fleteTotal + empaqueTotal + confirmTotal + adTotal + fletesVuelta + merma;
  const margen = price * (1 - pctVar) - fijos;

  return {
    price, cost, r, intentos, devoluciones,
    fleteTotal, empaqueTotal, confirmTotal, adTotal, fletesVuelta, merma,
    codFixed, codVar, gmfCost, taxCost,
    fijos, pctVar, margen,
    margenPct: price > 0 ? (margen / price) * 100 : 0,
    // Lo que entra en caja antes de publicidad y devoluciones: útil para ver si
    // el problema es el producto o es la pauta.
    brutoPorEntrega: price - cost - codFixed - codVar - gmfCost - taxCost - calcNum(i.shipOut),
  };
}

/** Precio que deja exactamente el margen objetivo. null si no existe. */
function solvePrice(inputs, marginPct) {
  const e = calcEconomics(Object.assign({}, inputs, { price: 0 }));
  const m = calcNum(marginPct) / 100;
  const denom = 1 - e.pctVar - m;
  // Si los porcentajes sobre el precio más el margen pedido llegan al 100%, no
  // hay precio que funcione: subir el precio sube los costos en la misma
  // proporción y nunca alcanzas. Hay que bajar el margen objetivo o los
  // porcentajes, no seguir subiendo el precio.
  if (denom <= 0.0001) return null;
  return e.fijos / denom;
}

/** CPA máximo que todavía deja el margen en cero, al precio dado. */
function maxCpa(inputs) {
  const e = calcEconomics(inputs);
  const sinAd = e.fijos - e.adTotal;
  const techo = e.price * (1 - e.pctVar) - sinAd;
  if (techo <= 0) return 0;
  return inputs.cpaPerDelivery ? techo : techo / e.intentos;
}

/**
 * Tasa de devolución máxima que el precio aguanta antes de perder plata.
 *
 * Se resuelve por bisección y no con una fórmula porque r aparece en tres sitios
 * a la vez (1/(1-r) y r/(1-r) multiplicando costos distintos) y despejarla a
 * mano da una expresión que nadie podría revisar. El margen es monótono
 * decreciente en r — todos los términos que dependen de r sólo crecen — así que
 * la bisección converge siempre al único cruce por cero.
 */
function maxReturnRate(inputs) {
  const margenEn = r => calcEconomics(Object.assign({}, inputs, { returnRate: r })).margen;
  if (margenEn(0) <= 0) return null;   // ni sin devoluciones gana
  if (margenEn(95) > 0) return 95;     // aguanta cualquier cosa
  let lo = 0, hi = 95;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (margenEn(mid) > 0) lo = mid; else hi = mid;
  }
  return lo;
}

/** Redondea hacia arriba al siguiente precio que termina en 900. */
function precioPsicologico(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(900, Math.ceil((n - 900) / 1000) * 1000 + 900);
}

function renderCalculadora() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  const inp = (name, label, extra, hint) => `
    <label class="block">
      <span class="meta-label text-neutral-500 block mb-1.5 px-1">${label}</span>
      <input name="${name}" type="number" inputmode="numeric" value="${calcState[name]}" ${extra || ''}
        class="w-full surface-soft rounded-xl px-3 py-2.5 text-sm mono focus:border-accent focus:outline-none" />
      ${hint ? `<span class="text-neutral-500 text-[10px] block mt-1 px-1 leading-snug">${hint}</span>` : ''}
    </label>`;

  box.innerHTML = `
    <div class="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
      <form id="calc-form" class="surface rounded-2xl p-6 space-y-5 lg:sticky lg:top-6">
        <div>
          <h3 class="font-display font-bold mb-1">Costos del producto</h3>
          <p class="text-neutral-500 text-xs leading-relaxed">Cambia cualquier número y el resultado se recalcula al instante.</p>
        </div>

        <label class="block">
          <span class="meta-label text-neutral-500 block mb-1.5 px-1">Cargar desde un producto</span>
          <select name="productId" class="w-full surface-soft rounded-xl px-3 py-2.5 text-sm focus:border-accent focus:outline-none">
            <option value="">— manual —</option>
            ${shopProducts.map(p => `<option value="${p.id}" ${calcState.productId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </label>

        <div class="space-y-3">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-accent">Producto</p>
          ${inp('price', 'Precio de venta', 'min="0"', 'El que vas a cobrar. Abajo verás cuál <em>deberías</em> cobrar.')}
          ${inp('cost', 'Costo del producto', 'min="0"')}
          ${inp('packaging', 'Empaque y etiqueta', 'min="0"', 'Se paga en cada despacho, también en los que se devuelven.')}
        </div>

        <div class="space-y-3">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-accent">Logística</p>
          ${inp('shipOut', 'Flete de ida', 'min="0"')}
          ${inp('shipBack', 'Flete de devolución', 'min="0"')}
          ${inp('codFixed', 'Recaudo (fijo por pedido)', 'min="0"', 'Lo que te cobra la transportadora por recoger el efectivo.')}
          ${inp('codPct', 'Recaudo (% del recaudo)', 'min="0" max="100" step="0.1"', 'Déjalo en 0 si te cobran tarifa fija. Si es porcentaje, lo típico va de 3% a 5%.')}
        </div>

        <div class="space-y-3">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-accent">Publicidad</p>
          ${inp('cpa', 'CPA', 'min="0"')}
          <label class="flex items-start gap-3 px-1 cursor-pointer">
            <input type="checkbox" name="cpaPerDelivery" ${calcState.cpaPerDelivery ? 'checked' : ''}
              class="mt-0.5 w-4 h-4 accent-[#2667ff] shrink-0" />
            <span class="text-xs leading-snug">
              <strong>Este CPA ya es por entrega</strong>
              <span class="text-neutral-500 block mt-0.5">
                Déjalo sin marcar si es el CPA que te muestra Meta — ese se paga por cada pedido que
                entra, entregado o no, y el panel lo divide entre tu tasa de entrega. Marcarlo cuando
                no toca es el error que hace que todo parezca rentable.
              </span>
            </span>
          </label>
        </div>

        <div class="space-y-3">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-accent">Devoluciones</p>
          ${inp('returnRate', 'Tasa de devolución (%)', 'min="0" max="95" step="0.1"', 'El promedio del mercado colombiano está entre 15% y 30%.')}
          ${inp('spoilPct', 'De lo devuelto, % invendible', 'min="0" max="100" step="1"', 'Lo que vuelve con el empaque roto o el producto dañado y ya no se puede revender.')}
        </div>

        <div class="space-y-3">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-accent">Operación e impuestos</p>
          ${inp('confirmCost', 'Costo de confirmar un pedido', 'min="0"', 'Minutos, WhatsApp Business o tu tiempo valorado. Se paga aunque luego no compre.')}
          <label class="flex items-center gap-3 px-1 cursor-pointer">
            <input type="checkbox" name="gmf" ${calcState.gmf ? 'checked' : ''} class="w-4 h-4 accent-[#2667ff] shrink-0" />
            <span class="text-xs">Cobrar el 4x1000 <span class="text-neutral-500">(${GMF_PCT}% del recaudo)</span></span>
          </label>
          ${inp('taxPct', 'Provisión de impuestos (%)', 'min="0" max="100" step="0.1"', 'Para apartar lo de renta e ICA y no gastarte plata que no es tuya.')}
        </div>

        <div class="space-y-3 pt-2 border-t border-neutral-200 dark:border-white/5">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-accent">Objetivo</p>
          ${inp('targetMarginPct', 'Margen neto que quieres (%)', 'min="0" max="95" step="1"', `En COD se recomienda al menos ${BENCHMARKS.margenMinimoPct}%.`)}
        </div>

        <div class="pt-2 border-t border-neutral-200 dark:border-white/5 space-y-2">
          <label class="block">
            <span class="meta-label text-neutral-500 block mb-1.5 px-1">Nombre del escenario</span>
            <input name="name" value="${escapeHtml(calcState.name)}" placeholder="Cinturón a 89.900"
              class="w-full surface-soft rounded-xl px-3 py-2.5 text-sm focus:border-accent focus:outline-none" />
          </label>
          <div class="flex gap-2">
            <button type="button" id="calc-save" class="flex-1 py-2.5 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em]">Guardar escenario</button>
            <button type="button" id="calc-reset" class="px-4 py-2.5 rounded-xl surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.15em]">Reiniciar</button>
          </div>
        </div>
      </form>

      <!-- min-w-0 no es decorativo: por defecto un hijo de grid tiene
           min-width:auto y se niega a encogerse por debajo del ancho de su
           contenido. Como aquí dentro hay cifras grandes en una sola línea, la
           columna crecía más allá de su carril y empujaba la página a scroll
           horizontal, recortando los números por la derecha. -->
      <div id="calc-results" class="min-w-0"></div>
    </div>`;

  renderCalcResults();
}

/* Sólo se redibuja esta mitad en cada tecla. Volver a pintar el formulario
   entero haría que el input perdiera el foco a mitad de un número. */
function renderCalcResults() {
  const box = document.getElementById('calc-results');
  if (!box) return;

  const e = calcEconomics(calcState);
  const pMin = solvePrice(calcState, 0);
  const pObj = solvePrice(calcState, calcState.targetMarginPct);
  const cpaTecho = maxCpa(calcState);
  const rTecho = maxReturnRate(calcState);
  const viable = e.margen > 0;

  const fila = (etiqueta, valor, negativo, nota) => `
    <div class="flex items-center justify-between gap-3 py-2 border-b border-neutral-100 dark:border-white/5 last:border-0">
      <span class="text-neutral-500 text-xs min-w-0">${etiqueta}${nota ? ` <span class="text-neutral-400">${nota}</span>` : ''}</span>
      <span class="mono text-xs shrink-0 ${negativo ? 'text-red-500' : ''}">${negativo ? '−' : ''}${cop(Math.abs(valor))}</span>
    </div>`;

  box.innerHTML = `
    ${pObj === null ? `
      <div class="surface rounded-2xl px-6 py-5 mb-4" style="border-left:3px solid #ef4444;">
        <h3 class="font-display font-bold mb-2">No hay precio que funcione</h3>
        <p class="text-sm leading-relaxed">
          Los costos que se calculan como porcentaje del precio (recaudo ${calcState.codPct}%, 4x1000 e
          impuestos ${calcState.taxPct}%) más el margen que pides (${calcState.targetMarginPct}%) suman
          ${pct((e.pctVar * 100) + Number(calcState.targetMarginPct))} del precio. Subir el precio también
          sube esos costos, así que nunca alcanzas. Baja el margen objetivo o alguno de esos porcentajes.
        </p>
      </div>` : ''}

    <!-- Dos columnas y no cuatro: aquí el formulario se come 360px fijos, así que
         la columna de resultados es bastante más estrecha que el ancho completo
         de las otras pestañas. Con cuatro fichas en fila las cifras grandes no
         caben y se recortan por la derecha en vez de envolver. -->
    <div class="grid grid-cols-2 gap-4 mb-4">
      ${statTile('Margen por entrega', cop(e.margen),
        `a ${cop(e.price)} de venta`,
        viable ? 'text-green-600 dark:text-green-400' : 'text-red-500')}
      ${statTile('Margen sobre venta', pct(e.margenPct), '',
        e.margenPct >= BENCHMARKS.margenMinimoPct ? 'text-green-600 dark:text-green-400' : viable ? 'text-amber-500' : 'text-red-500')}
      ${statTile('Precio mínimo', pMin === null ? '—' : cop(precioPsicologico(pMin)), 'donde no ganas ni pierdes')}
      ${statTile('Precio recomendado', pObj === null ? '—' : cop(precioPsicologico(pObj)), `para ${calcState.targetMarginPct}% de margen`, 'text-accent')}
    </div>

    <div class="surface rounded-2xl p-6 mb-4">
      <div class="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h3 class="font-display font-bold">Desglose por pedido entregado</h3>
        <span class="meta-label text-neutral-500">
          ${(Math.round(e.intentos * 100) / 100)} pedidos por cada entrega
        </span>
      </div>
      ${fila('Precio de venta', e.price)}
      ${fila('Costo del producto', e.cost, true)}
      ${fila('Recaudo fijo', e.codFixed, true)}
      ${calcState.codPct > 0 ? fila('Recaudo variable', e.codVar, true, `(${calcState.codPct}% del recaudo)`) : ''}
      ${calcState.gmf ? fila('4x1000', e.gmfCost, true, `(${GMF_PCT}% del recaudo)`) : ''}
      ${calcState.taxPct > 0 ? fila('Provisión de impuestos', e.taxCost, true, `(${calcState.taxPct}%)`) : ''}
      ${fila('Fletes de ida', e.fleteTotal, true, `(${cop(calcState.shipOut)} × ${Math.round(e.intentos * 100) / 100} intentos)`)}
      ${calcState.packaging > 0 ? fila('Empaque', e.empaqueTotal, true, `(× ${Math.round(e.intentos * 100) / 100} intentos)`) : ''}
      ${calcState.confirmCost > 0 ? fila('Confirmación', e.confirmTotal, true, `(× ${Math.round(e.intentos * 100) / 100} intentos)`) : ''}
      ${fila('Publicidad', e.adTotal, true, calcState.cpaPerDelivery
        ? '(CPA ya por entrega)'
        : `(CPA ${cop(calcState.cpa)} ÷ ${pct(100 - Number(calcState.returnRate))} de entrega)`)}
      ${fila('Fletes de devolución', e.fletesVuelta, true, `(${Math.round(e.devoluciones * 100) / 100} devoluciones por entrega)`)}
      ${calcState.spoilPct > 0 ? fila('Producto invendible', e.merma, true, `(${calcState.spoilPct}% de lo devuelto)`) : ''}
      <div class="flex items-center justify-between pt-4 mt-1">
        <span class="font-display font-bold">Margen real</span>
        <span class="display text-2xl ${viable ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">${cop(e.margen)}</span>
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-4 mb-4">
      <div class="surface rounded-2xl p-6">
        <div class="meta-label text-neutral-500 mb-1">CPA máximo</div>
        <div class="display text-3xl ${cpaTecho > 0 ? '' : 'text-red-500'}">${cop(cpaTecho)}</div>
        <p class="text-neutral-500 text-xs mt-2 leading-relaxed">
          A ${cop(e.price)} de venta, este es el techo real de tu puja${calcState.cpaPerDelivery ? ' por entrega' : ' por pedido recibido'}.
          Por encima, cada venta te cuesta plata aunque la campaña se vea bien en Meta.
          ${Number(calcState.cpa) > 0 && cpaTecho > 0
            ? `Ahora mismo pagas ${cop(calcState.cpa)}, un ${pct((Number(calcState.cpa) / cpaTecho) * 100)} del techo.`
            : ''}
        </p>
      </div>
      <div class="surface rounded-2xl p-6">
        <div class="meta-label text-neutral-500 mb-1">Devolución máxima tolerable</div>
        <div class="display text-3xl ${rTecho === null ? 'text-red-500' : ''}">${rTecho === null ? '—' : pct(rTecho)}</div>
        <p class="text-neutral-500 text-xs mt-2 leading-relaxed">
          ${rTecho === null
            ? 'A este precio pierdes incluso sin ninguna devolución. El problema no son las devoluciones: es el precio o los costos.'
            : `Si tu devolución pasa de ${pct(rTecho)} dejas de ganar. Vas por ${pct(Number(calcState.returnRate))}, así que tienes
               ${pct(rTecho - Number(calcState.returnRate))} de colchón.`}
        </p>
      </div>
    </div>

    ${renderSensibilidad()}
    ${renderEscenarios()}`;
}

/**
 * Cuán frágil es el margen.
 *
 * Un solo número tranquiliza de más: dice que ganas, no si dejas de ganar porque
 * el CPA subió un 25% — que es lo que pasa en cuanto se satura el producto. La
 * tabla mueve las dos variables que de verdad se mueven solas y deja ver si el
 * margen tiene colchón o vive al borde.
 */
function renderSensibilidad() {
  const rBase = Number(calcState.returnRate) || 0;
  const cpaBase = Number(calcState.cpa) || 0;
  const rs = [Math.max(0, rBase - 10), rBase, Math.min(95, rBase + 10)];
  const cpas = [cpaBase * 0.75, cpaBase, cpaBase * 1.25];

  return `
    <div class="surface rounded-2xl p-6 mb-4">
      <div class="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
        <h3 class="font-display font-bold">Qué pasa si las cosas se mueven</h3>
        <span class="meta-label text-neutral-500">margen por entrega a ${cop(calcState.price)}</span>
      </div>
      <p class="text-neutral-500 text-xs mb-4 leading-relaxed max-w-2xl">
        Las dos columnas que se mueven solas son estas: el CPA sube cuando el producto se satura y la
        devolución sube cuando creces hacia zonas nuevas. Si en esta tabla hay rojo cerca del centro,
        tu margen no tiene colchón.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left border-b border-neutral-200 dark:border-white/5">
              <th class="px-3 py-2 meta-label text-neutral-500 font-normal">Devolución \\ CPA</th>
              ${cpas.map((c, i) => `<th class="px-3 py-2 meta-label font-normal whitespace-nowrap ${i === 1 ? 'text-accent' : 'text-neutral-500'}">
                ${cop(c)}${i === 0 ? ' (−25%)' : i === 2 ? ' (+25%)' : ''}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rs.map((r, ri) => `
              <tr class="border-b border-neutral-100 dark:border-white/5 last:border-0">
                <td class="px-3 py-2 mono text-xs whitespace-nowrap ${ri === 1 ? 'text-accent font-semibold' : 'text-neutral-500'}">${pct(r)}</td>
                ${cpas.map(c => {
                  const m = calcEconomics(Object.assign({}, calcState, { returnRate: r, cpa: c })).margen;
                  return `<td class="px-3 py-2 mono text-xs whitespace-nowrap ${
                    m <= 0 ? 'text-red-500 font-semibold' : m < BENCHMARKS.gananciaPorPedido.min ? 'text-amber-500' : 'text-green-600 dark:text-green-400'
                  }">${cop(m)}</td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="text-neutral-500 text-[11px] mt-3 leading-relaxed">
        Verde: por encima de ${cop(BENCHMARKS.gananciaPorPedido.min)} por pedido, que es el piso habitual en COD Colombia.
        Ámbar: ganas, pero poco. Rojo: pierdes.
      </p>
    </div>`;
}

function renderEscenarios() {
  if (!priceScenarios.length) {
    return `<div class="surface rounded-2xl p-6">
      <h3 class="font-display font-bold mb-2">Escenarios guardados</h3>
      <p class="text-neutral-500 text-sm leading-relaxed max-w-2xl">
        Ponle nombre a la combinación de arriba y guárdala. Sirve para comparar lado a lado el mismo
        producto a tres precios distintos, o el mismo precio con dos proveedores, sin volver a teclear
        todo cada vez.
      </p>
    </div>`;
  }

  return `
    <div class="surface rounded-2xl overflow-hidden">
      <div class="px-6 py-4 border-b border-neutral-200 dark:border-white/5">
        <h3 class="font-display font-bold">Escenarios guardados</h3>
        <p class="meta-label text-neutral-500 mt-0.5">${priceScenarios.length} guardado${priceScenarios.length > 1 ? 's' : ''}</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left border-b border-neutral-200 dark:border-white/5">
              ${['Escenario', 'Precio', 'CPA', 'Devolución', 'Margen', '% ', ''].map(h =>
                `<th class="px-4 py-3 meta-label text-neutral-500 font-normal whitespace-nowrap">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${priceScenarios.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(s => {
              const e = calcEconomics(s.inputs || {});
              const prod = s.inputs?.productId ? productById(s.inputs.productId) : null;
              return `
                <tr class="border-b border-neutral-100 dark:border-white/5 hover:bg-accent/[0.03]">
                  <td class="px-4 py-3">
                    <div class="font-medium truncate max-w-[200px]">${escapeHtml(s.name || 'Sin nombre')}</div>
                    ${prod ? `<div class="meta-label text-neutral-400">${escapeHtml(prod.name)}</div>` : ''}
                  </td>
                  <td class="px-4 py-3 mono text-xs whitespace-nowrap">${cop(e.price)}</td>
                  <td class="px-4 py-3 mono text-xs whitespace-nowrap">${cop(s.inputs?.cpa)}</td>
                  <td class="px-4 py-3 mono text-xs whitespace-nowrap">${pct(Number(s.inputs?.returnRate) || 0)}</td>
                  <td class="px-4 py-3 mono text-xs whitespace-nowrap ${e.margen > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">${cop(e.margen)}</td>
                  <td class="px-4 py-3 mono text-xs whitespace-nowrap">${pct(e.margenPct)}</td>
                  <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button type="button" data-scenario-load="${s.id}" class="px-2.5 py-1.5 rounded-lg surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.1em]">Cargar</button>
                    ${s.inputs?.productId ? `<button type="button" data-scenario-apply="${s.id}" class="px-2.5 py-1.5 rounded-lg surface-soft hover:border-accent mono text-[10px] uppercase tracking-[0.1em] ml-1">Aplicar</button>` : ''}
                    <button type="button" data-scenario-delete="${s.id}" aria-label="Borrar escenario"
                      class="w-8 h-8 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition ml-1">✕</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="px-6 py-4 text-neutral-500 text-[11px] leading-relaxed border-t border-neutral-200 dark:border-white/5">
        <strong>Aplicar</strong> escribe el precio y los costos del escenario sobre el producto, para que la
        pestaña Productos y el scorecard trabajen con esos números. El modelo del producto es más simple que
        el de aquí: el empaque y la confirmación se suman dentro de "comisión" ya multiplicados por los
        intentos de este escenario, así que el margen coincide a la tasa de devolución guardada y se separa
        un poco si luego la cambias.
      </p>
    </div>`;
}

/* ============================================================================
   PESTAÑA: SCORECARD
   ============================================================================

   Un puntaje ponderado más dos bloqueadores que lo anulan.

   La separación importa: un producto que es réplica de una marca o que necesita
   registro INVIMA y no lo tiene no es "un 72 sobre 100", es un no. Promediarlo
   con el resto de criterios escondería justo lo que puede cerrarte la cuenta
   publicitaria o traerte un problema legal, y un promedio alto en lo demás no
   compensa nada de eso.

   Los criterios económicos no se preguntan: salen de los costos del producto.
   Los manuales son los que el panel no puede saber solo.
   ============================================================================ */

const SCORE_MANUAL = {
  gancho: {
    label: 'Resuelve un problema o engancha',
    weight: 15,
    valores: { fuerte: 1, medio: 0.5, debil: 0 },
    textos: {
      fuerte: 'Se entiende en 3 segundos de video',
      medio: 'Hay que explicarlo',
      debil: 'Es un producto más',
    },
  },
  peso: {
    label: 'Peso y fragilidad',
    weight: 15,
    valores: { bueno: 1, medio: 0.6, malo: 0 },
    textos: {
      bueno: 'Liviano y resistente',
      medio: 'Mediano, aguanta',
      malo: 'Pesado, voluminoso o frágil',
    },
  },
  demanda: {
    label: 'Demanda verificada',
    weight: 15,
    valores: { tres: 1, una: 0.5, ninguna: 0 },
    textos: {
      tres: 'Verificada en tres fuentes',
      una: 'Verificada a medias',
      ninguna: 'Sin verificar',
    },
  },
  proveedor: {
    label: 'Proveedor y despacho',
    weight: 10,
    valores: { nacional: 1, lento: 0.6, importado: 0.25, ninguno: 0 },
    textos: {
      nacional: 'Nacional con stock',
      lento: 'Nacional con demoras',
      importado: 'Importado, semanas',
      ninguno: 'Sin proveedor confirmado',
    },
  },
  saturacion: {
    label: 'Saturación en pauta',
    weight: 5,
    valores: { baja: 1, media: 0.5, alta: 0.15 },
    textos: {
      baja: 'Poca competencia',
      media: 'Varios anunciantes',
      alta: 'Muy saturado',
    },
  },
};

/** Puntaje completo de un producto: económico + manual + bloqueadores. */
function scoreProduct(p) {
  const s = p.score || null;
  const criterios = [];

  // --- Económicos: se calculan, no se preguntan ---
  const tieneNumeros = (Number(p.price) || 0) > 0 && (Number(p.cost) || 0) > 0;
  const cpaObs = observedCpa(p.id);
  const e = unitEconomics(p, { cpa: cpaObs ?? undefined });

  if (tieneNumeros) {
    const mp = e.margenPct;
    criterios.push({
      key: 'margen', label: 'Margen neto', weight: 20,
      valor: mp >= BENCHMARKS.margenMinimoPct ? 1 : mp >= 30 ? 0.6 : mp >= 20 ? 0.3 : mp > 0 ? 0.1 : 0,
      detalle: `${pct(mp)} — se recomienda ${BENCHMARKS.margenMinimoPct}% o más`,
    });

    const pr = BENCHMARKS.precioDulce;
    const precio = Number(p.price) || 0;
    criterios.push({
      key: 'precio', label: 'Precio en el rango de COD', weight: 10,
      valor: precio >= pr.min && precio <= pr.max ? 1
        : (precio >= pr.min * 0.7 && precio < pr.min) || (precio > pr.max && precio <= pr.max * 1.4) ? 0.5 : 0.15,
      detalle: `${cop(precio)} — el rango que mejor funciona es ${cop(pr.min)}–${cop(pr.max)}`,
    });

    const g = BENCHMARKS.gananciaPorPedido;
    criterios.push({
      key: 'ganancia', label: 'Ganancia por pedido', weight: 10,
      valor: e.margen >= g.max ? 1 : e.margen >= g.min ? 0.75 : e.margen >= 15000 ? 0.4 : e.margen > 0 ? 0.15 : 0,
      detalle: `${cop(e.margen)} — lo típico es ${cop(g.min)}–${cop(g.max)}`,
    });
  }

  // --- Manuales ---
  Object.entries(SCORE_MANUAL).forEach(([key, def]) => {
    const elegido = s ? s[key] : null;
    if (!elegido || !(elegido in def.valores)) return;   // sin responder: no cuenta
    criterios.push({
      key, label: def.label, weight: def.weight,
      valor: def.valores[elegido],
      detalle: def.textos[elegido],
    });
  });

  /* Los criterios sin responder se excluyen del numerador Y del denominador. Es
     la única forma honesta: contarlos como cero castigaría por no haber
     respondido todavía, y contarlos como uno inflaría el puntaje de un producto
     sin evaluar. Lo que se muestra es el puntaje de lo que SÍ se sabe, junto con
     cuánto peso queda sin evaluar. */
  const pesoEvaluado = criterios.reduce((n, c) => n + c.weight, 0);
  const puntos = criterios.reduce((n, c) => n + c.weight * c.valor, 0);
  const score = pesoEvaluado > 0 ? (puntos / pesoEvaluado) * 100 : null;

  // --- Bloqueadores ---
  const bloqueadores = [];
  if (s?.invima === 'sin-registro') {
    bloqueadores.push('Necesita registro INVIMA y no lo tiene. Meta rechaza estos anuncios y la venta es ilegal en Colombia.');
  }
  if (s?.marca === 'replica') {
    bloqueadores.push('Es réplica de una marca. Riesgo de denuncia por propiedad intelectual y de que te cierren la cuenta publicitaria.');
  }

  /* Peso mínimo evaluado para que el panel se atreva a dar un veredicto.
     Sin esto, un producto con los costos puestos y el cuestionario en blanco
     sacaba "100 — Lanzar": los 40 puntos económicos salían perfectos y eran el
     único peso evaluado, así que el porcentaje era 100 sobre 40. El número no
     estaba mal calculado, pero la etiqueta decía "lanza esto" sobre un producto
     del que no se sabe ni si hay proveedor. */
  const MIN_PESO_VEREDICTO = 60;

  let veredicto;
  if (bloqueadores.length) veredicto = { label: 'No lanzar', tono: '#ef4444' };
  else if (score === null) veredicto = { label: 'Sin evaluar', tono: '#737373' };
  else if (pesoEvaluado < MIN_PESO_VEREDICTO) veredicto = { label: 'Evaluación incompleta', tono: '#737373' };
  else if (score >= 75) veredicto = { label: 'Lanzar', tono: '#22c55e' };
  else if (score >= 60) veredicto = { label: 'Lanzar con cuidado', tono: '#2667ff' };
  else if (score >= 45) veredicto = { label: 'Dudoso', tono: '#f59e0b' };
  else veredicto = { label: 'No lanzar', tono: '#ef4444' };

  return { score, criterios, bloqueadores, veredicto, pesoEvaluado, pesoSinEvaluar: 100 - pesoEvaluado, tieneNumeros, respondido: !!s };
}

function renderScorecard() {
  const box = document.getElementById('drop-panel');
  if (!box) return;

  if (!shopProducts.length) {
    box.innerHTML = emptyState(
      'Sin productos para evaluar',
      'El scorecard puntúa un producto antes de que gastes el primer peso en pauta: margen, precio, peso, demanda, proveedor y saturación, más los dos bloqueadores legales que arruinan una cuenta publicitaria. Añade un producto para evaluarlo.',
      '+ Añadir producto', 'id="new-product-btn"');
    return;
  }

  const evaluados = shopProducts.map(p => ({ p, r: scoreProduct(p) }));
  const ordenados = evaluados.slice().sort((a, b) => {
    // Los bloqueados al final: no importa qué puntaje saquen.
    if (a.r.bloqueadores.length !== b.r.bloqueadores.length) return a.r.bloqueadores.length - b.r.bloqueadores.length;
    return (b.r.score ?? -1) - (a.r.score ?? -1);
  });

  // Se cuenta por veredicto y no por puntaje: el veredicto ya exige que haya
  // peso suficiente evaluado, el puntaje suelto no.
  const listos = evaluados.filter(x => x.r.veredicto.label === 'Lanzar').length;
  const bloqueados = evaluados.filter(x => x.r.bloqueadores.length).length;
  const sinEvaluar = evaluados.filter(x => !x.r.respondido).length;

  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statTile('Productos', String(shopProducts.length), 'en el pipeline')}
      ${statTile('Listos para lanzar', String(listos), '75 puntos o más', listos ? 'text-green-600 dark:text-green-400' : '')}
      ${statTile('Bloqueados', String(bloqueados), 'INVIMA o marca', bloqueados ? 'text-red-500' : '')}
      ${statTile('Sin evaluar', String(sinEvaluar), 'les falta el cuestionario', sinEvaluar ? 'text-amber-500' : '')}
    </div>

    <div class="surface rounded-2xl px-6 py-5 mb-6" style="border-left:3px solid #2667ff;">
      <h3 class="font-display font-bold mb-2">Cómo se calcula</h3>
      <p class="text-neutral-500 text-sm leading-relaxed">
        Cuarenta de los cien puntos los saca el panel solo de los costos que ya registraste: margen neto,
        precio dentro del rango que funciona en contra entrega y ganancia por pedido. Los otros sesenta
        salen del cuestionario — gancho, peso, demanda verificada, proveedor y saturación. Lo que no hayas
        respondido no cuenta ni a favor ni en contra: el puntaje se calcula sobre el peso evaluado y el
        panel te dice cuánto falta. Aparte van dos bloqueadores que <em>anulan</em> el puntaje en vez de
        promediarse, porque un producto con problema de INVIMA o una réplica de marca no es un producto
        mediano: es uno que no deberías pautar.
      </p>
    </div>

    <div class="space-y-4">
      ${ordenados.map(({ p, r }) => renderScoreCard(p, r)).join('')}
    </div>`;
}

function renderScoreCard(p, r) {
  const anillo = r.score === null ? 0 : r.score;
  const color = r.bloqueadores.length ? '#ef4444' : r.veredicto.tono;

  return `
    <div class="surface rounded-2xl p-6" style="border-left:3px solid ${color};">
      <div class="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div class="flex items-center gap-5 min-w-0">
          <!-- Anillo de progreso en SVG: el puntaje se lee de un golpe sin tener
               que comparar numeros entre tarjetas. -->
          <div class="relative w-16 h-16 shrink-0">
            <svg width="64" height="64" viewBox="0 0 64 64" class="-rotate-90">
              <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="6" class="text-neutral-200 dark:text-white/10"/>
              <circle cx="32" cy="32" r="27" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
                stroke-dasharray="${(anillo / 100) * 169.6} 169.6"/>
            </svg>
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="display text-lg">${r.score === null ? '—' : Math.round(r.score)}</span>
            </div>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <h3 class="font-display font-bold text-xl truncate">${escapeHtml(p.name)}</h3>
              <span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                style="background:${color}1a;color:${color}">${r.veredicto.label}</span>
              <span class="mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent/15 text-accent">${(PRODUCT_STAGES[p.stage] || PRODUCT_STAGES.investigacion).label}</span>
            </div>
            <p class="meta-label text-neutral-500">
              ${r.pesoSinEvaluar > 0
                ? `Evaluado el ${r.pesoEvaluado}% del peso · faltan ${r.pesoSinEvaluar} puntos por responder`
                : 'Evaluado por completo'}
            </p>
          </div>
        </div>
        <button type="button" data-score-edit="${p.id}"
          class="px-4 py-2 rounded-xl bg-accent text-white font-bold mono text-[10px] uppercase tracking-[0.15em] shrink-0">
          ${r.respondido ? 'Editar evaluación' : 'Evaluar'}
        </button>
      </div>

      ${r.bloqueadores.length ? `
        <div class="rounded-xl p-4 mb-4" style="border-left:3px solid #ef4444;background:#ef444410">
          <p class="mono text-[10px] uppercase tracking-[0.15em] text-red-500 mb-2">Bloqueado</p>
          ${r.bloqueadores.map(b => `<p class="text-xs text-red-500 leading-relaxed">${escapeHtml(b)}</p>`).join('')}
          <p class="text-xs text-red-500 leading-relaxed mt-2 opacity-80">
            El puntaje de ${r.score === null ? '—' : Math.round(r.score)} no cambia esto. Resuelve el bloqueador o descarta el producto.
          </p>
        </div>` : ''}

      ${!r.tieneNumeros ? `
        <div class="rounded-xl p-4 mb-4" style="border-left:3px solid #f59e0b;background:#f59e0b10">
          <p class="text-xs leading-relaxed" style="color:#f59e0b">
            Faltan el precio y el costo del producto, así que los 40 puntos económicos no se pueden calcular.
            Edítalo en la pestaña Productos o usa la calculadora y aplica el escenario.
          </p>
        </div>` : ''}

      ${r.criterios.length ? `
        <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1">
          ${r.criterios.map(c => {
            const tono = c.valor >= 0.8 ? '#22c55e' : c.valor >= 0.5 ? '#f59e0b' : '#ef4444';
            return `
              <div class="flex items-center gap-3 py-2 border-b border-neutral-100 dark:border-white/5">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${tono}"></span>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-medium truncate">${escapeHtml(c.label)}</div>
                  <div class="text-[11px] text-neutral-500 truncate">${c.detalle}</div>
                </div>
                <span class="mono text-[11px] text-neutral-500 shrink-0">${Math.round(c.weight * c.valor)}/${c.weight}</span>
              </div>`;
          }).join('')}
        </div>` : ''}

      ${p.score?.notes ? `<p class="text-neutral-500 text-xs mt-4 pt-4 border-t border-neutral-100 dark:border-white/5">${escapeHtml(p.score.notes)}</p>` : ''}
    </div>`;
}

/* ============================================================================
   EVENTOS
   ============================================================================ */

document.addEventListener('click', e => {
  /* ---- Cola de confirmación ---- */

  // Abrir WhatsApp cuenta como intento. No se hace preventDefault: el <a> abre
  // la pestaña por su cuenta, que es más fiable que window.open frente a los
  // bloqueadores de pop-ups.
  const wa = e.target.closest('[data-wa-order]');
  if (wa) {
    const o = orders.find(x => x.id === wa.dataset.waOrder);
    if (o) {
      o.confirmAttempts = (o.confirmAttempts || 0) + 1;
      o.lastAttemptAt = Date.now();
      touch(o); saveAll();
      if (dropUi.tab === 'confirmar') renderDropship();
    }
    return;
  }

  const copy = e.target.closest('[data-copy-confirm]');
  if (copy) {
    const o = orders.find(x => x.id === copy.dataset.copyConfirm);
    if (!o) return;
    navigator.clipboard?.writeText(confirmMessage(o))
      .then(() => toast('Mensaje copiado'))
      .catch(() => alert(confirmMessage(o)));
    return;
  }

  const ok = e.target.closest('[data-confirm-order]');
  if (ok) {
    const o = orders.find(x => x.id === ok.dataset.confirmOrder);
    if (!o) return;
    o.status = 'confirmado';
    o.confirmed = true;
    o.confirmedAt = Date.now();
    delete o.resolvedAt;
    touch(o); saveAll(); renderDropship();
    toast(`${o.customer || 'Pedido'} confirmado`);
    return;
  }

  const no = e.target.closest('[data-noanswer-order]');
  if (no) {
    const o = orders.find(x => x.id === no.dataset.noanswerOrder);
    if (!o) return;
    o.confirmAttempts = (o.confirmAttempts || 0) + 1;
    o.lastAttemptAt = Date.now();
    touch(o); saveAll(); renderDropship();
    const n = o.confirmAttempts;
    toast(n >= MAX_INTENTOS_CONFIRMACION ? `${n} intentos: no lo despaches` : `Intento ${n} registrado`);
    return;
  }

  const cancel = e.target.closest('[data-cancel-order]');
  if (cancel) {
    const o = orders.find(x => x.id === cancel.dataset.cancelOrder);
    if (!o || !confirm(`¿Cancelar el pedido de ${o.customer || 'sin nombre'}?\n\nSe queda registrado como cancelado, no se borra.`)) return;
    o.status = 'cancelado';
    touch(o); saveAll(); renderDropship(); toast('Pedido cancelado');
    return;
  }

  /* ---- Calculadora ---- */

  if (e.target.closest('#calc-save')) {
    const nombre = (calcState.name || '').trim();
    if (!nombre) { alert('Ponle un nombre al escenario para poder distinguirlo después.'); return; }
    priceScenarios.push(touch({
      id: uid(),
      name: nombre,
      inputs: Object.assign({}, calcState),
      createdAt: Date.now(),
    }));
    saveAll(); renderCalcResults(); toast('Escenario guardado');
    return;
  }

  if (e.target.closest('#calc-reset')) {
    if (!confirm('¿Volver a los valores de ejemplo?')) return;
    Object.assign(calcState, CALC_DEFAULTS);
    store.set('calcState', calcState);
    renderCalculadora();
    return;
  }

  const load = e.target.closest('[data-scenario-load]');
  if (load) {
    const s = priceScenarios.find(x => x.id === load.dataset.scenarioLoad);
    if (!s) return;
    Object.assign(calcState, CALC_DEFAULTS, s.inputs || {}, { name: s.name || '' });
    store.set('calcState', calcState);
    renderCalculadora();
    toast(`Escenario "${s.name}" cargado`);
    return;
  }

  const apply = e.target.closest('[data-scenario-apply]');
  if (apply) {
    const s = priceScenarios.find(x => x.id === apply.dataset.scenarioApply);
    if (!s) return;
    const p = productById(s.inputs?.productId);
    if (!p) { alert('El producto de este escenario ya no existe.'); return; }
    const i = s.inputs;
    const e2 = calcEconomics(i);
    /* El modelo del producto tiene un solo campo de comisión y la cobra una vez
       por entrega, mientras que empaque y confirmación se pagan en cada intento.
       Multiplicarlos por los intentos ANTES de meterlos en `fee` hace que el
       margen de la tarjeta del producto coincida con el de la calculadora a esta
       tasa de devolución, en vez de quedar optimista por lo que se paga en los
       pedidos que no llegaron. */
    const feeEquivalente = calcNum(i.codFixed)
      + (calcNum(i.packaging) + calcNum(i.confirmCost)) * e2.intentos
      + e2.codVar + e2.gmfCost + e2.taxCost;
    if (!confirm(`¿Escribir los números de "${s.name}" sobre "${p.name}"?\n\nPrecio ${cop(e2.price)} · costo ${cop(i.cost)} · comisión equivalente ${cop(feeEquivalente)}`)) return;
    Object.assign(p, {
      price: Math.round(calcNum(i.price)),
      cost: Math.round(calcNum(i.cost)),
      shipOut: Math.round(calcNum(i.shipOut)),
      shipBack: Math.round(calcNum(i.shipBack)),
      fee: Math.round(feeEquivalente),
      targetCpa: Math.round(calcNum(i.cpa)),
      returnRateOverride: calcNum(i.returnRate),
    });
    touch(p); saveAll(); renderCalcResults();
    toast(`"${p.name}" actualizado`);
    return;
  }

  const delSc = e.target.closest('[data-scenario-delete]');
  if (delSc) {
    const s = priceScenarios.find(x => x.id === delSc.dataset.scenarioDelete);
    if (!s || !confirm(`¿Borrar el escenario "${s.name}"?`)) return;
    tombstone('priceScenarios', s.id);
    priceScenarios = priceScenarios.filter(x => x.id !== s.id);
    saveAll(); renderCalcResults(); toast('Escenario borrado');
    return;
  }

  /* ---- Scorecard ---- */

  const sc = e.target.closest('[data-score-edit]');
  if (sc) {
    const p = productById(sc.dataset.scoreEdit);
    if (!p) return;
    openDropModal('score-modal', form => {
      form.dataset.editing = p.id;
      const s = p.score || {};
      ['gancho', 'peso', 'demanda', 'proveedor', 'saturacion', 'invima', 'marca'].forEach(k => {
        if (form[k] && s[k]) form[k].value = s[k];
      });
      if (form.notes) form.notes.value = s.notes || '';
      const sub = document.getElementById('score-modal-sub');
      if (sub) sub.textContent = `${p.name} — responde lo que el panel no puede calcular. El margen y el precio los saca de los costos que ya registraste.`;
    });
  }
});

/* La calculadora se recalcula en cada tecla, pero sólo redibuja los resultados:
   volver a pintar el formulario haría perder el foco a media cifra. */
document.addEventListener('input', e => {
  const form = e.target.closest('#calc-form');
  if (!form) return;
  const el = e.target;
  if (!el.name) return;

  if (el.type === 'checkbox') calcState[el.name] = el.checked;
  else if (el.name === 'name') calcState.name = el.value;
  else if (el.name === 'productId') return;   // lo maneja `change`
  else calcState[el.name] = el.value === '' ? 0 : Number(el.value);

  store.set('calcState', calcState);
  renderCalcResults();
});

document.addEventListener('change', e => {
  const sel = e.target.closest('#calc-form [name="productId"]');
  if (!sel) return;
  calcState.productId = sel.value;
  const p = productById(sel.value);
  if (p) {
    // Trae del producto lo que el producto sabe y deja intacto el resto: el
    // empaque, la confirmación y los impuestos no viven en su modelo.
    const cpaObs = observedCpa(p.id);
    const dev = deliveryRate(orders.filter(o => o.productId === p.id));
    Object.assign(calcState, {
      name: calcState.name || p.name,
      price: Number(p.price) || 0,
      cost: Number(p.cost) || 0,
      shipOut: Number(p.shipOut) || 0,
      shipBack: Number(p.shipBack) || 0,
      codFixed: Number(p.fee) || 0,
      cpa: Math.round(cpaObs ?? (Number(p.targetCpa) || 0)),
      // La devolución medida en tus propios pedidos manda sobre el valor que
      // hubiera en el formulario; si no hay datos resueltos se deja el actual.
      returnRate: dev.rate === null ? calcState.returnRate : Math.round((100 - dev.rate) * 10) / 10,
    });
  }
  store.set('calcState', calcState);
  renderCalculadora();
});

document.getElementById('score-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const p = form.dataset.editing ? productById(form.dataset.editing) : null;
  if (!p) { closeDropModals(); return; }
  const fd = new FormData(form);
  p.score = {
    gancho: fd.get('gancho') || 'medio',
    peso: fd.get('peso') || 'medio',
    demanda: fd.get('demanda') || 'ninguna',
    proveedor: fd.get('proveedor') || 'ninguno',
    saturacion: fd.get('saturacion') || 'media',
    invima: fd.get('invima') || 'no-aplica',
    marca: fd.get('marca') || 'original',
    notes: (fd.get('notes') || '').trim(),
    updatedAt: Date.now(),
  };
  touch(p); saveAll(); closeDropModals(); renderDropship();
  const r = scoreProduct(p);
  toast(r.bloqueadores.length
    ? `${p.name}: bloqueado, no lo pautes`
    : `${p.name}: ${Math.round(r.score)}/100 — ${r.veredicto.label}`);
});
