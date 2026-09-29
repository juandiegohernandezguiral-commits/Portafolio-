// ============================================================================
// POST /sync/external-summary  (redirect en netlify.toml → /.netlify/functions/sync-external-summary)
//
// Solución pragmática a una limitación conocida: Trello y Microsoft Graph
// (Outlook/To Do) solo tienen credenciales en el navegador del usuario (Fase 2,
// por diseño — minimiza infraestructura). Este backend no puede llamarlos
// directamente. En vez de dejar el cron ciego a esas dos fuentes, el cliente
// (index.html → syncExternalSummaryToBackend(), llamado desde
// renderAgendaSummary() cada vez que el dashboard combina resultados reales)
// manda aquí un resumen MÍNIMO y no sensible (id, título, fecha de
// vencimiento, fuente) — nunca credenciales ni tokens.
//
// El cron (scheduled-check-deadlines.js) lee este resumen junto con los datos
// de Notion (que sí consulta en vivo) para poder notificar también sobre
// vencimientos de Trello/Outlook. Es inherentemente best-effort: si el
// dashboard no se abre en un rato, este resumen queda desactualizado y el cron
// lo descarta pasado un umbral (ver STALE_SUMMARY_HOURS en el cron) en vez de
// notificar con datos viejos.
// ============================================================================

const { agendaStore } = require('./_lib/store');
const { withCors, handlePreflight } = require('./_lib/cors');

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return withCors({ statusCode: 405, body: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return withCors({ statusCode: 400, body: 'Invalid JSON' });
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.slice(0, 50).map(it => ({
    id: String(it.id || ''),
    title: String(it.title || 'Sin título').slice(0, 200),
    due: it.due || null,
    source: it.source === 'outlook' ? 'outlook' : 'trello',
  })).filter(it => it.id);

  try {
    const store = agendaStore();
    await store.setJSON('external-summary', { items, updatedAt: new Date().toISOString() });
    return withCors({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, count: items.length }),
    });
  } catch (err) {
    console.error('[sync-external-summary]', err);
    return withCors({
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'store_write_failed', message: err.message }),
    });
  }
};
