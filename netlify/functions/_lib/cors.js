// ============================================================================
// CORS compartido.
//
// Desde que el portafolio y estas funciones se sirven desde el MISMO sitio de
// Netlify (ver netlify.toml), el navegador ya no hace peticiones entre orígenes
// y estas cabeceras dejaron de ser imprescindibles. Se mantienen porque no
// cuestan nada y hacen que los endpoints sigan funcionando si algún día el
// panel se sirve desde otro dominio o desde localhost durante el desarrollo —
// que es justo cuando su ausencia daría un "Failed to fetch" sin explicación.
//
// '*' es intencional: es una API de solo un usuario sin cookies/sesión ni
// datos sensibles expuestos vía CORS (el token de Notion nunca sale de aquí).
// Si prefieres restringirlo a tu dominio exacto, cambia ALLOW_ORIGIN abajo.
// ============================================================================

const ALLOW_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // X-Sync-Token: lo usa data-sync.js para autenticar el sync de datos del panel.
  // Sin declararlo aquí el navegador rechazaría la petición en el preflight.
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Token',
};

function withCors(response) {
  return { ...response, headers: { ...CORS_HEADERS, ...(response.headers || {}) } };
}

function handlePreflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return withCors({ statusCode: 204, body: '' });
  }
  return null;
}

module.exports = { CORS_HEADERS, withCors, handlePreflight };
