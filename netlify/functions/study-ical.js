// ============================================================================
// GET /study/ical?url=...  — trae y traduce un calendario de Moodle
//
// El Campus Virtual del ITM (cvirtual.itm.edu.co) y el otro Moodle del DCEB
// publican, para cada usuario, una URL privada de calendario en formato iCal.
// Se genera una sola vez desde dentro de Moodle (Calendario → Exportar
// calendario) y lleva el token del usuario dentro, así que:
//
//   - NO hace falta guardar la contraseña del ITM en ningún sitio
//   - NO hay que pasar por el SSO de Office 365 en cada consulta
//   - es de sólo lectura: con esa URL no se puede hacer nada más
//
// POR QUÉ ESTO VIVE EN EL SERVIDOR Y NO EN EL NAVEGADOR
// Moodle no manda cabeceras CORS en ese endpoint, así que un fetch desde la
// página sería bloqueado por el navegador antes de llegar a leer nada. El
// backend no tiene esa restricción. De paso, la URL con el token no queda a la
// vista en la pestaña de red del navegador de cualquiera que mire.
// ============================================================================

const { withCors, handlePreflight } = require('./_lib/cors');
const { requireSyncToken } = require('./_lib/auth');

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function json(statusCode, payload) {
  return withCors({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/* Rangos de red que NUNCA deben alcanzarse desde aqui.
   Este endpoint hace que el SERVIDOR pida una URL que viene de fuera, y eso es
   un SSRF de manual: sin esta lista, una URL como
   https://169.254.169.254/calendar/?authtoken=x haria que el backend
   consultara el servicio de metadatos de la nube y devolviera el resultado.
   Tambien valdria para escanear la red interna del proveedor.

   Exigir el token del panel ya limita quien puede intentarlo, pero eso es una
   puerta, no un muro: si el token se filtra alguna vez, esto es lo que impide
   que el fallo pase de "leen mi calendario" a "leen credenciales del servidor". */
const HOSTS_PROHIBIDOS = [
  /^localhost$/i,
  /^127\./,                       // bucle local
  /^0\./,
  /^10\./,                        // privada clase A
  /^192\.168\./,                  // privada clase C
  /^172\.(1[6-9]|2\d|3[01])\./,   // privada clase B
  /^169\.254\./,                  // enlace local Y metadatos de la nube
  /^\[?::1\]?$/,                  // bucle local IPv6
  /^\[?f[cd]/i,                   // IPv6 privada (fc00::/7)
  /\.local$/i, /\.internal$/i,
];

/**
 * Valida la URL de un calendario de Moodle antes de que el servidor la pida.
 *
 * Dos clases de comprobacion, y conviene no confundirlas:
 *   - Las de FORMA (https, /calendar/, authtoken) existen para que un error de
 *     tecleo no acabe en una peticion a un sitio cualquiera.
 *   - Las de DESTINO (abajo) existen para que ni siquiera una URL bien formada
 *     pueda apuntar a la red interna del servidor.
 */
function urlValida(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'No es una URL válida.'; }
  if (u.protocol !== 'https:') return 'La URL tiene que ser https.';

  const host = (u.hostname || '').toLowerCase();
  if (HOSTS_PROHIBIDOS.some(re => re.test(host))) {
    return 'Esa dirección apunta a una red interna y no se puede consultar.';
  }
  // Un host sin punto no es un dominio publico: es un nombre de la red local.
  if (!host.includes('.')) {
    return 'Esa dirección no es un dominio público.';
  }
  // Credenciales embebidas (https://user:pass@host) son señal de URL manipulada.
  if (u.username || u.password) {
    return 'La URL no debe llevar usuario ni contraseña dentro.';
  }

  if (!u.pathname.includes('/calendar/')) {
    return 'No parece un calendario de Moodle: la ruta debería contener /calendar/.';
  }
  if (!u.searchParams.get('authtoken')) {
    return 'Falta el authtoken. Copia la URL completa que te da Moodle en "Exportar calendario".';
  }
  return null;
}

/**
 * Deshace el plegado de líneas de iCal.
 *
 * RFC 5545 parte cualquier línea de más de 75 octetos y continúa la siguiente
 * empezando por un espacio o un tabulador. Sin deshacer eso, el título de una
 * tarea larga llega cortado por la mitad y la fecha de un evento puede quedar
 * partida en dos líneas que no parsean.
 */
function desplegar(texto) {
  return texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** Deshace los escapes de texto de iCal. */
function desescapar(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Convierte una fecha iCal a ISO.
 *
 * Tres formas posibles: con Z (UTC), sin Z (hora local del calendario) y sólo
 * fecha (evento de día completo). Las de sólo fecha se fijan a mediodía y no a
 * medianoche a propósito: una entrega "del 15" puesta a las 00:00 aparece como
 * vencida durante todo el día 15, que es justo el día que tienes para hacerla.
 */
function fechaISO(valor, params) {
  const v = String(valor || '').trim();
  const soloFecha = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (soloFecha || (params || '').includes('VALUE=DATE')) {
    const m = soloFecha || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0)).toISOString();
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  // Sin Z: Moodle la da en la zona del servidor. Para el ITM eso es Colombia
  // (UTC−5), que no tiene horario de verano, así que la conversión es fija.
  return new Date(Date.UTC(+y, +mo - 1, +d, +h + 5, +mi, +s)).toISOString();
}

/* Qué clase de evaluación es, deducido del título. Moodle no lo dice: para él
   todo es "un evento de curso". Se acierta la mayoría de las veces y el panel
   deja corregirlo a mano, que es mejor que no clasificar nada. */
/* EL ORDEN IMPORTA: se va de lo más específico a lo más genérico y gana la
   primera que acierte. Al revés se clasifica mal — "Proyecto final" salía como
   parcial porque la regla de parcial llevaba un `\bfinal\b` suelto y se
   evaluaba antes. Ese `final` suelto también se quitó: "entrega final",
   "exposición final" y "proyecto final" no son parciales, y las formas que sí
   lo son («examen final», «evaluación final») ya están cubiertas aparte. */
const PISTAS = [
  [/\bproyecto\b|\bentrega\s+final\b/i, 'proyecto'],
  [/\bexposici[oó]n\b|\bsustentaci[oó]n\b|\bpresentaci[oó]n\b/i, 'exposicion'],
  [/\bquiz\b|\bprueba\s+corta\b|\bcuestionario\b/i, 'quiz'],
  [/\bparcial(es)?\b|\bexamen\b|\b(evaluaci[oó]n|prueba)\s+final\b/i, 'parcial'],
  [/\btarea\b|\btaller\b|\bentrega\b|\bactividad\b|\blaboratorio\b/i, 'tarea'],
];

function clasificar(titulo) {
  for (const [re, kind] of PISTAS) if (re.test(titulo)) return kind;
  return 'tarea';
}

/** Limpia el relleno con el que Moodle adorna los títulos.
 *
 *  Los PREFIJOS son los que de verdad aparecen en el ITM y no estaban
 *  contemplados: Moodle antepone "Vencimiento de", "Se abre", "Se cierra" según
 *  el tipo de evento. Dejarlos convierte una lista de tareas en una lista que
 *  empieza toda igual, donde hay que leer hasta la mitad de cada línea para
 *  saber de qué va. El sufijo "pendiente" es el mismo caso por detrás. */
function limpiarTitulo(s) {
  return String(s || '')
    // Prefijos (van primero: el resto opera sobre el texto ya destapado)
    .replace(/^\s*(?:vencimiento|cierre|apertura|entrega)\s+de(?:l)?\s+/i, '')
    .replace(/^\s*se\s+(?:cierra|abre|entrega)\s+/i, '')
    .replace(/^\s*(?:opens|closes|due)\s*:?\s*/i, '')
    // Sufijos
    .replace(/\s*\((.*?)\)\s*$/, '')                        // "(Nombre del curso)" al final
    .replace(/\s+(debe|deben)\s+entregarse\s*$/i, '')       // "X debe entregarse"
    .replace(/\s+is\s+due\s*$/i, '')
    .replace(/\s+se\s+cierra\s*$/i, '')
    .replace(/\s+pendiente\s*$/i, '')
    .replace(/^\s*«|»\s*$/g, '')
    .trim();
}

function parsearICal(texto) {
  const lineas = desplegar(texto).split('\n');
  const eventos = [];
  let actual = null;

  for (const linea of lineas) {
    if (linea === 'BEGIN:VEVENT') { actual = {}; continue; }
    if (linea === 'END:VEVENT') {
      if (actual && actual.uid) eventos.push(actual);
      actual = null;
      continue;
    }
    if (!actual) continue;

    const corte = linea.indexOf(':');
    if (corte < 0) continue;
    const izq = linea.slice(0, corte);
    const valor = linea.slice(corte + 1);
    const [nombre, ...params] = izq.split(';');
    const p = params.join(';');

    switch (nombre.toUpperCase()) {
      case 'UID': actual.uid = valor.trim(); break;
      case 'SUMMARY': actual.summary = desescapar(valor); break;
      case 'DESCRIPTION': actual.description = desescapar(valor); break;
      case 'DTSTART': actual.start = fechaISO(valor, p); break;
      case 'DTEND': actual.end = fechaISO(valor, p); break;
      case 'CATEGORIES': actual.category = desescapar(valor); break;
      case 'LAST-MODIFIED': actual.modified = fechaISO(valor, p); break;
    }
  }

  return eventos.map(e => {
    const bruto = e.summary || 'Sin título';
    // El curso viene en CATEGORIES, y si no, entre paréntesis al final del título.
    const curso = e.category || (/\((.*?)\)\s*$/.exec(bruto) || [])[1] || '';
    return {
      externalId: e.uid,
      title: limpiarTitulo(bruto) || bruto,
      rawTitle: bruto,
      course: curso.trim(),
      due: e.start || e.end || null,
      kind: clasificar(bruto),
      notes: (e.description || '').slice(0, 600),
    };
  }).filter(x => x.externalId && x.due);
}

/* Se exponen las piezas de parseo para poder probarlas sin red ni Netlify. El
   plegado de líneas y las fechas son justo donde un fallo no lanza ningún error:
   deja el título cortado o la entrega en otro día, y eso no se nota hasta que
   llegas tarde. Ver tests/ical.test.js. */
exports._internals = { desplegar, desescapar, fechaISO, clasificar, limpiarTitulo, parsearICal, urlValida };

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const unauthorized = requireSyncToken(event);
  if (unauthorized) return withCors(unauthorized);

  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = (event.queryStringParameters || {}).url || '';
  if (!url) return json(400, { error: 'missing_url', message: 'Falta el parámetro url.' });

  const problema = urlValida(url);
  if (problema) return json(400, { error: 'invalid_url', message: problema });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    /* Las redirecciones se siguen A MANO, validando cada salto.
       Con redirect:'follow' la comprobacion de host de urlValida() no sirve de
       nada: basta un dominio publico que responda 302 hacia 169.254.169.254
       para que fetch lo siga por su cuenta y el servidor acabe pidiendo
       justo la direccion que se acababa de prohibir. Validar solo la primera
       URL es validar la puerta y dejar la ventana abierta. */
    let res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    let saltos = 0;
    while (res.status >= 300 && res.status < 400 && saltos < 3) {
      const destino = res.headers.get('location');
      if (!destino) break;
      const absoluto = new URL(destino, url).toString();
      const malo = urlValida(absoluto);
      if (malo) {
        return json(400, { error: 'redirect_no_permitido',
          message: 'El calendario redirige a una dirección que no se puede seguir: ' + malo });
      }
      saltos++;
      res = await fetch(absoluto, { signal: ctrl.signal, redirect: 'manual' });
    }
    if (res.status >= 300 && res.status < 400) {
      return json(400, { error: 'demasiadas_redirecciones',
        message: 'El calendario redirige demasiadas veces.' });
    }
    const texto = await res.text();

    if (!res.ok) {
      return json(502, { error: 'moodle_error', message: `Moodle respondió ${res.status}.` });
    }
    if (texto.length > MAX_BYTES) {
      return json(413, { error: 'feed_too_large', message: 'El calendario es demasiado grande.' });
    }
    // Moodle contesta 200 con este texto plano cuando el token ya no sirve, así
    // que hay que mirarlo a mano: un 200 aquí no significa que haya ido bien.
    if (/invalid authentication/i.test(texto.slice(0, 400))) {
      return json(401, {
        error: 'moodle_auth',
        message: 'Moodle rechazó el token: la URL caducó o cambió. Vuelve a exportarla desde el Campus Virtual.',
      });
    }
    if (!/BEGIN:VCALENDAR/i.test(texto)) {
      return json(502, { error: 'not_ical', message: 'Lo que devolvió esa URL no es un calendario iCal.' });
    }

    const items = parsearICal(texto);
    return json(200, { items, count: items.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err.name === 'AbortError') {
      return json(504, { error: 'timeout', message: 'Moodle tardó demasiado en responder.' });
    }
    console.error('[study-ical]', err);
    return json(502, { error: 'fetch_failed', message: err.message });
  } finally {
    clearTimeout(t);
  }
};
