// ============================================================================
// Buzón de pedidos — POST /orders/intake  ·  GET /orders/intake
//
// Sirve para que un sistema externo (en este caso Sofia, el chatbot de WhatsApp
// que corre en el portátil) deje pedidos sin que haya que escribirlos a mano en
// el panel.
//
// POR QUÉ UN BUZÓN APARTE Y NO ESCRIBIR EN EL SNAPSHOT DEL SYNC
// La vía obvia sería meter el pedido directamente en 'user-data', donde vive
// todo lo demás. No se hace, y el motivo es una carrera real: ese snapshot usa
// concurrencia optimista con un `rev` que el navegador lee antes de escribir. Si
// el backend lo modificara por su cuenta entre el pull y el push del panel, o
// bien el push del panel se rechazaría con un 409, o bien — peor — sobrescribiría
// el pedido recién llegado y se perdería sin que nadie lo notara.
//
// Con un buzón separado no hay nada que coordinar: aquí sólo se añade, el panel
// sólo lee, y la fusión ocurre en el cliente con la misma lógica por `id` que ya
// usa para todo lo demás. Un pedido no puede perderse por una escritura cruzada
// porque las dos partes nunca escriben la misma clave.
//
// IDEMPOTENCIA
// Sofia corre en un portátil con la conexión que haya. Si un POST se corta
// después de llegar pero antes de que ella vea la respuesta, va a reintentar — y
// un pedido duplicado en contra entrega significa despachar dos veces. Por eso
// `externalId` es obligatorio: es la llave con la que este endpoint reconoce un
// pedido que ya vio. Reintentar es seguro y responde 200 con `duplicate: true`.
//
// El `id` del registro se DERIVA del externalId (hash), no se genera al azar.
// Así, si el mismo pedido entrara dos veces por caminos distintos, los dos
// registros tendrían el mismo id y la fusión del cliente los colapsaría en uno
// en vez de dejar dos pedidos gemelos.
//
// Variables de entorno: SYNC_TOKEN (el mismo del resto del panel).
// ============================================================================

const crypto = require('crypto');
const { agendaStore, isBlobsConfigError, blobsDiagnostics } = require('./_lib/store');
const { withCors, handlePreflight } = require('./_lib/cors');
const { requireSyncToken } = require('./_lib/auth');

const INBOX_KEY = 'orders-inbox';

// Los pedidos entregados se quedan en el panel; en el buzón sólo hacen bulto.
// 30 días es de sobra para que cualquier dispositivo haya sincronizado.
const TTL_DIAS = 30;

// Tope defensivo: si el buzón crece más que esto es que el panel lleva mucho sin
// sincronizar o que algo está escribiendo en bucle. Se conservan los más
// recientes, que son los accionables.
const MAX_ITEMS = 500;

const MAX_BODY_BYTES = 256 * 1024;

const ESTADOS = ['nuevo', 'confirmado', 'despachado', 'entregado', 'devuelto', 'cancelado'];
const ORIGENES = ['meta', 'tiktok', 'organico', 'otro'];

function json(statusCode, payload) {
  return withCors({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** id estable a partir del externalId: mismo pedido, mismo id, siempre. */
function idDesdeExternal(externalId) {
  return 'sof' + crypto.createHash('sha256').update(String(externalId)).digest('hex').slice(0, 12);
}

function limpiar(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max || 200);
}

/**
 * Valida y normaliza lo que llega. Devuelve { error } o { pedido }.
 *
 * Se es estricto con `externalId` y permisivo con el resto a propósito: sin
 * externalId no hay idempotencia y ese es el único campo cuya ausencia puede
 * causar un daño real (despachar dos veces). Que falte la ciudad sólo significa
 * que ese pedido no entra en el mapa de zonas hasta que se complete a mano.
 */
function validar(body) {
  const externalId = limpiar(body.externalId, 120);
  if (!externalId) {
    return { error: 'missing_external_id', message: 'externalId es obligatorio: es lo que evita que un reintento duplique el pedido.' };
  }

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) {
    return { error: 'invalid_price', message: 'price debe ser un número >= 0, en pesos.' };
  }

  const status = ESTADOS.includes(body.status) ? body.status : 'nuevo';

  return {
    pedido: {
      id: idDesdeExternal(externalId),
      externalId,
      source: ORIGENES.includes(body.source) ? body.source : 'otro',
      // De dónde salió el registro. Sirve para distinguir en el panel lo que
      // entró solo de lo que se escribió a mano.
      origin: 'intake',
      customer: limpiar(body.customer, 120),
      phone: limpiar(body.phone, 40),
      city: limpiar(body.city, 80),
      address: limpiar(body.address, 300),
      productId: limpiar(body.productId, 40),
      // El nombre del producto viaja aparte porque Sofia no conoce los ids del
      // panel. Se usa para emparejarlo en el cliente, que sí los conoce.
      productName: limpiar(body.productName, 160),
      qty: Math.max(1, Math.round(Number(body.qty) || 1)),
      price: Math.round(price),
      carrier: limpiar(body.carrier, 60),
      notes: limpiar(body.notes, 500),
      status,
      confirmed: status === 'confirmado' || body.confirmed === true,
      createdAt: Number.isFinite(Number(body.createdAt)) ? Number(body.createdAt) : Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function podar(items) {
  const corte = Date.now() - TTL_DIAS * 86400000;
  return items
    .filter(o => (o.updatedAt || o.createdAt || 0) >= corte)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_ITEMS);
}

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const unauthorized = requireSyncToken(event);
  if (unauthorized) return withCors(unauthorized);

  let store;
  try {
    store = agendaStore();
  } catch (err) {
    if (isBlobsConfigError(err)) {
      return json(503, {
        error: 'blobs_not_configured',
        message: 'El almacenamiento no está disponible en este sitio.',
        diagnostics: blobsDiagnostics(),
      });
    }
    return json(500, { error: 'store_unavailable', message: err.message });
  }

  // ---- El panel lee el buzón ----
  if (event.httpMethod === 'GET') {
    try {
      const buzon = (await store.get(INBOX_KEY, { type: 'json' })) || { items: [], updatedAt: null };
      return json(200, { items: buzon.items || [], updatedAt: buzon.updatedAt || null });
    } catch (err) {
      console.error('[orders-intake] lectura falló', err);
      return json(500, { error: 'store_read_failed', message: err.message });
    }
  }

  // ---- Sofia deja un pedido ----
  if (event.httpMethod === 'POST') {
    if ((event.body || '').length > MAX_BODY_BYTES) {
      return json(413, { error: 'body_too_large' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'invalid_json', message: 'El cuerpo no es JSON válido.' });
    }

    const v = validar(body);
    if (v.error) return json(400, v);

    try {
      const buzon = (await store.get(INBOX_KEY, { type: 'json' })) || { items: [], updatedAt: null };
      const items = Array.isArray(buzon.items) ? buzon.items : [];

      const yaEsta = items.find(o => o.externalId === v.pedido.externalId);
      if (yaEsta) {
        // Reintento de algo que ya entró. No es un error: es exactamente lo que
        // la idempotencia existe para absorber.
        return json(200, { ok: true, duplicate: true, id: yaEsta.id });
      }

      const next = podar([v.pedido, ...items]);
      await store.setJSON(INBOX_KEY, { items: next, updatedAt: new Date().toISOString() });

      return json(201, { ok: true, duplicate: false, id: v.pedido.id, pending: next.length });
    } catch (err) {
      console.error('[orders-intake] escritura falló', err);
      return json(500, { error: 'store_write_failed', message: err.message });
    }
  }

  return json(405, { error: 'method_not_allowed' });
};
