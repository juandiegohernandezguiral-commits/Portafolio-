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
function agendaStore() {
  return getStore('jdh-agenda');
}

module.exports = { agendaStore };
