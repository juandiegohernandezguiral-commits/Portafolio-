// ============================================================================
// Almacenamiento persistente compartido (Netlify Blobs) — app de un solo
// usuario, así que no hace falta ninguna partición por usuario/sesión: un único
// store con un puñado de claves fijas es suficiente.
//
// Claves usadas en este store ('jdh-agenda'):
//   'push-subscription'  → el objeto PushSubscription del navegador (JSON)
//   'notified-tasks'      → { [taskId]: isoTimestamp } — evita notificar dos
//                            veces la misma tarea (ver scheduled-check-deadlines.js)
//   'external-summary'    → { items: [...], updatedAt } — resumen ligero de
//                            Trello/Outlook enviado por el cliente (ver
//                            sync-external-summary.js)
// ============================================================================

const { getStore } = require('@netlify/blobs');

// getStore() detecta automáticamente el site ID y un token con alcance
// limitado cuando se ejecuta dentro del runtime de Netlify Functions (tanto en
// invocaciones HTTP normales como en las programadas por cron). Si alguna vez
// necesitas correr esto localmente contra Blobs reales (fuera de `netlify dev`,
// que ya lo resuelve solo), puedes forzar el modo manual así:
//   getStore({ name: 'jdh-agenda', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN })
/* Netlify normalmente inyecta la configuración de Blobs en NETLIFY_BLOBS_CONTEXT
   y getStore('nombre') funciona sin más. En este sitio esa variable NO llega
   (comprobado: hasBlobsContext=false con hasSiteId=true y Node 24), y ni cambiar
   el empaquetador ni actualizar el SDK lo resolvió — es algo del sitio, no del
   código.

   Así que se usa el modo manual que documenta el propio error de la librería:
   pasarle siteID y token a mano. El siteID lo da Netlify solo (SITE_ID es una
   de sus variables de sólo lectura); el token es un Personal Access Token.

   La variable se llama BLOBS_TOKEN y NO NETLIFY_API_TOKEN: el panel de Netlify
   no deja crear variables con el prefijo NETLIFY_, reservado para las suyas, y
   el intento se pierde en silencio — la variable sencillamente no aparece en la
   lista. Se sigue aceptando el nombre antiguo por si alguien ya lo tenía
   puesto en otro entorno. */

function agendaStore() {
  // Se intenta primero el modo automático: si algún día Netlify empieza a
  // inyectar el contexto, esto sigue funcionando sin tocar nada y el token
  // deja de usarse solo.
  if (process.env.NETLIFY_BLOBS_CONTEXT) return getStore('jdh-agenda');

  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return getStore({ name: 'jdh-agenda', siteID, token });

  // Sin ninguna de las dos vías: que falle aquí con el error de la librería,
  // que isBlobsConfigError() reconoce y convierte en un 503 explicado.
  return getStore('jdh-agenda');
}

/**
 * Netlify inyecta la configuración de Blobs en la variable NETLIFY_BLOBS_CONTEXT
 * en tiempo de ejecución. Si falta, getStore() lanza MissingBlobsEnvironmentError
 * y, sin tratarlo, la función responde un 502 con el stack entero — ilegible
 * para quien lo sufre y además filtrando rutas internas.
 *
 * Esto convierte ese caso en un error explicado, y de paso informa de lo único
 * que permite distinguir "Blobs no está disponible en este sitio" de "la versión
 * del SDK no entiende el entorno": si la variable llegó o no.
 */
function isBlobsConfigError(err) {
  return !!err && (err.name === 'MissingBlobsEnvironmentError' ||
    /not been configured to use Netlify Blobs/i.test(err.message || ''));
}

function blobsDiagnostics() {
  return {
    hasBlobsContext: !!process.env.NETLIFY_BLOBS_CONTEXT,
    hasSiteId: !!(process.env.SITE_ID || process.env.NETLIFY_SITE_ID),
    hasApiToken: !!(process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN),
    nodeVersion: process.version,
  };
}

module.exports = { agendaStore, isBlobsConfigError, blobsDiagnostics };
