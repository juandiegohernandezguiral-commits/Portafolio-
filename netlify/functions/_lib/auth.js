// ============================================================================
// Autenticación por token compartido para los endpoints que leen o escriben los
// datos personales del panel (data-sync.js).
//
// Los demás endpoints de este backend no necesitan token: notion-tasks.js sólo
// expone tareas ya públicas para su dueño y no acepta escrituras, y
// push-subscribe.js sólo acepta un objeto PushSubscription (que no es secreto).
// El sync SÍ lo necesita: sirve el contenido completo de tareas, notas y
// proyectos, y acepta sobrescribirlo.
//
// Decisión importante: si SYNC_TOKEN no está configurado, esto FALLA CERRADO
// (rechaza todo). La alternativa — "sin token configurado, permitir todo" —
// convertiría un despliegue a medio configurar en un endpoint público con los
// datos personales dentro, que es exactamente el peor caso posible.
//
// El token se genera con, por ejemplo:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
// y se configura como variable de entorno SYNC_TOKEN en Netlify. La misma cadena
// se pega en el panel → "Conectar cuentas" → Sincronización.
// ============================================================================

const crypto = require('crypto');

// Comparación en tiempo constante: un `===` normal aborta en el primer byte que
// difiere, lo que filtra información sobre el token a quien mida los tiempos.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual exige longitudes iguales, y la propia diferencia de longitud
  // ya es observable, así que se compara el hash de cada lado: longitud fija.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Devuelve null si la petición está autorizada, o un objeto de respuesta
 * (statusCode + body) listo para devolver si no lo está.
 */
function requireSyncToken(event) {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) {
    console.error('[auth] SYNC_TOKEN no está configurado — se rechaza la petición (fail closed)');
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'sync_not_configured',
        message: 'El backend no tiene SYNC_TOKEN configurado. Añádelo en las variables de entorno de Netlify.',
      }),
    };
  }

  const headers = event.headers || {};
  // Netlify normaliza los nombres de cabecera a minúsculas, pero no se pierde
  // nada por aceptar ambas formas.
  const provided = headers['x-sync-token'] || headers['X-Sync-Token'] || '';
  if (!provided || !safeEqual(provided, expected)) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', message: 'Token de sincronización inválido o ausente.' }),
    };
  }
  return null;
}

module.exports = { requireSyncToken };
