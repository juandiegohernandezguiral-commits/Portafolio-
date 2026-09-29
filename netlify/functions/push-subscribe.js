// ============================================================================
// POST /push/subscribe  (redirect en netlify.toml → /.netlify/functions/push-subscribe)
//
// El cliente manda aquí el objeto PushSubscription que devuelve
// pushManager.subscribe() (ver el handler de #enable-notifications-btn en
// index.html). Se guarda en Netlify Blobs para que el cron
// (scheduled-check-deadlines.js) pueda usarlo entre invocaciones — nada de
// esto vive en memoria, por diseño (las funciones serverless no persisten
// estado entre ejecuciones).
//
// App de un solo usuario: una única suscripción activa a la vez es
// suficiente. Si en el futuro se usa desde varios dispositivos/navegadores,
// cambia la clave fija 'push-subscription' por una derivada de
// subscription.endpoint para soportar varias en paralelo.
// ============================================================================

const { agendaStore } = require('./_lib/store');
const { withCors, handlePreflight } = require('./_lib/cors');

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return withCors({ statusCode: 405, body: 'Method not allowed' });
  }

  let subscription;
  try {
    subscription = JSON.parse(event.body || '{}');
  } catch {
    return withCors({ statusCode: 400, body: 'Invalid JSON' });
  }
  if (!subscription || !subscription.endpoint) {
    return withCors({ statusCode: 400, body: 'Missing subscription.endpoint' });
  }

  try {
    const store = agendaStore();
    await store.setJSON('push-subscription', subscription);
    return withCors({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
  } catch (err) {
    console.error('[push-subscribe]', err);
    return withCors({
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'store_write_failed', message: err.message }),
    });
  }
};
