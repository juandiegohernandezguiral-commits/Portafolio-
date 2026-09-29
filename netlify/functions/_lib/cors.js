// ============================================================================
// CORS compartido: el portafolio (index.html) se sirve desde un origen
// distinto al de este backend (p. ej. Hostinger vs. Netlify), así que toda
// respuesta necesita cabeceras CORS, y las peticiones con Content-Type: JSON
// disparan un preflight OPTIONS que hay que responder explícitamente.
//
// '*' es intencional: es una API de solo un usuario sin cookies/sesión ni
// datos sensibles expuestos vía CORS (el token de Notion nunca sale de aquí).
// Si prefieres restringirlo a tu dominio exacto, cambia ALLOW_ORIGIN abajo.
// ============================================================================

const ALLOW_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
