// ============================================================================
// GET  /data/pull   → devuelve el snapshot remoto  { rev, updatedAt, data }
// POST /data/push   → guarda un snapshot nuevo     { baseRev, data }
// GET  /data/pull?history=1 → lista las revisiones guardadas (para recuperar)
//
// (redirects definidos en netlify.toml → /.netlify/functions/data-sync)
//
// Este endpoint es el que hace que el panel deje de vivir sólo en el
// localStorage de un navegador: permite compartir tareas/eventos/proyectos/notas
// entre el portátil y el celular, y sobrevivir a un borrado de caché.
//
// --- Modelo de concurrencia ---
// El servidor es un almacén versionado "tonto": no fusiona nada. Cada snapshot
// tiene un `rev` entero que se incrementa en cada escritura. Para escribir, el
// cliente manda el `baseRev` sobre el que construyó su versión:
//
//   - baseRev === rev actual  → se acepta, rev pasa a rev+1
//   - baseRev !== rev actual  → 409 Conflict, y se devuelve el estado actual
//                               completo para que el cliente vuelva a fusionar
//                               y reintente (ver mergeSnapshots en js/08-sync.js)
//
// La fusión vive en el cliente a propósito: es ahí donde están las reglas de
// negocio (último `updatedAt` gana por registro, los tombstones borran), y
// duplicarlas aquí sería mantener la misma lógica en dos sitios.
//
// --- Historial ---
// Cada escritura archiva la revisión anterior. Se conservan las últimas
// HISTORY_LIMIT, que es una red de seguridad barata contra el peor escenario
// real: un cliente con datos corruptos o vacíos que sobrescribe la nube.
// ============================================================================

const { agendaStore } = require('./_lib/store');
const { withCors, handlePreflight } = require('./_lib/cors');
const { requireSyncToken } = require('./_lib/auth');

const DATA_KEY = 'user-data';
const HISTORY_KEY = 'user-data-history';
const HISTORY_LIMIT = 10;

// Netlify Functions acepta cuerpos de hasta ~6 MB; se corta bastante antes para
// que un bug del cliente no llene el almacenamiento con basura.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/* Debe coincidir con DATA_COLLECTIONS en js/05-dashboard.js. El servidor no
   interpreta el contenido de los registros, pero sí valida que las colecciones
   que espera sean arrays — si el cliente manda una coleccion nueva que aqui no
   figure, se guarda igual (ver el push mas abajo, que copia body.data entero),
   asi que un cliente mas nuevo no se rompe contra un backend mas viejo. */
const COLLECTIONS = ['tasks', 'events', 'projects', 'notes', 'habits', 'habitLog', 'sessions'];

const EMPTY_SNAPSHOT = {
  rev: 0,
  updatedAt: null,
  data: COLLECTIONS.reduce((acc, k) => { acc[k] = []; return acc; }, { tombstones: [] }),
};

function json(statusCode, payload) {
  return withCors({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Valida la forma de `data` sin opinar sobre el contenido de cada registro.
 *
 *  Valida lo que VIENE, no exige que vengan todas: un cliente de una version
 *  anterior no manda `habits` ni `sessions`, y rechazar su push por eso le
 *  dejaria el sync roto sin motivo. Lo que si se comprueba de toda coleccion
 *  presente es que sea un array de objetos con id, porque sin id la fusion del
 *  cliente no puede emparejar registros. */
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data debe ser un objeto';

  for (const [key, value] of Object.entries(data)) {
    if (key === 'tombstones') {
      if (!Array.isArray(value)) return 'data.tombstones debe ser un array';
      continue;
    }
    if (!Array.isArray(value)) return `data.${key} debe ser un array`;
    for (const rec of value) {
      if (!rec || typeof rec !== 'object') return `data.${key} contiene un registro que no es objeto`;
      if (typeof rec.id !== 'string' || !rec.id) return `data.${key} contiene un registro sin id`;
    }
  }
  return null;
}

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const unauthorized = requireSyncToken(event);
  if (unauthorized) return withCors(unauthorized);

  const store = agendaStore();

  // ---------------------------------------------------------------- PULL ----
  if (event.httpMethod === 'GET') {
    try {
      if ((event.queryStringParameters || {}).history === '1') {
        const history = (await store.get(HISTORY_KEY, { type: 'json' })) || [];
        return json(200, {
          revisions: history.map(h => ({
            rev: h.rev,
            updatedAt: h.updatedAt,
            counts: COLLECTIONS.reduce((acc, k) => {
              acc[k] = (h.data && h.data[k] ? h.data[k].length : 0);
              return acc;
            }, {}),
          })),
        });
      }
      const snapshot = (await store.get(DATA_KEY, { type: 'json' })) || EMPTY_SNAPSHOT;
      return json(200, snapshot);
    } catch (err) {
      console.error('[data-sync] pull failed', err);
      return json(500, { error: 'store_read_failed', message: err.message });
    }
  }

  // ---------------------------------------------------------------- PUSH ----
  if (event.httpMethod === 'POST') {
    const raw = event.body || '';
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return json(413, { error: 'payload_too_large', message: 'El snapshot supera los 2 MB.' });
    }

    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(400, { error: 'invalid_json' });
    }

    const problem = validateData(body.data);
    if (problem) return json(400, { error: 'invalid_data', message: problem });

    if (!Number.isInteger(body.baseRev) || body.baseRev < 0) {
      return json(400, { error: 'invalid_base_rev', message: 'baseRev debe ser un entero >= 0.' });
    }

    try {
      const current = (await store.get(DATA_KEY, { type: 'json' })) || EMPTY_SNAPSHOT;

      if (current.rev !== body.baseRev) {
        // Otro dispositivo escribió mientras este preparaba su versión. Se
        // devuelve el estado actual entero para que pueda fusionar y reintentar.
        return json(409, {
          error: 'conflict',
          message: `El servidor está en rev ${current.rev}, no en ${body.baseRev}.`,
          rev: current.rev,
          updatedAt: current.updatedAt,
          data: current.data,
        });
      }

      // Se guarda `data` tal cual (ya validado) en vez de copiar campo a campo:
      // una lista explicita descartaria en silencio cualquier coleccion que el
      // cliente conozca y este backend todavia no, que es justo el caso de un
      // despliegue a medio actualizar.
      const next = {
        rev: current.rev + 1,
        updatedAt: new Date().toISOString(),
        data: { ...body.data, tombstones: body.data.tombstones || [] },
      };

      // Archiva la revisión que se está reemplazando (no la nueva), que es la
      // que sirve para deshacer una sobrescritura mala.
      if (current.rev > 0) {
        const history = (await store.get(HISTORY_KEY, { type: 'json' })) || [];
        history.unshift(current);
        await store.setJSON(HISTORY_KEY, history.slice(0, HISTORY_LIMIT));
      }

      await store.setJSON(DATA_KEY, next);
      return json(200, { rev: next.rev, updatedAt: next.updatedAt });
    } catch (err) {
      console.error('[data-sync] push failed', err);
      return json(500, { error: 'store_write_failed', message: err.message });
    }
  }

  return json(405, { error: 'method_not_allowed' });
};
