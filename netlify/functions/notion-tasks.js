// ============================================================================
// GET /notion/tasks  (redirect en netlify.toml → /.netlify/functions/notion-tasks)
//
// El cliente (index.html → renderNotionTasks()) llama a este endpoint sin
// mandar ninguna credencial. Este archivo usa NOTION_TOKEN / NOTION_DATABASE_ID
// (o NOTION_DATA_SOURCE_ID) desde variables de entorno para consultar Notion
// server-side, y devuelve una lista simplificada de tareas abiertas.
// ============================================================================

const { fetchNotionTasks } = require('./_lib/notion');
const { withCors, handlePreflight } = require('./_lib/cors');

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'GET') {
    return withCors({ statusCode: 405, body: 'Method not allowed' });
  }

  try {
    const tasks = await fetchNotionTasks();
    const items = tasks
      .filter(t => !t.completed)
      .sort((a, b) => {
        const aTime = a.due ? new Date(a.due).getTime() : Infinity;
        const bTime = b.due ? new Date(b.due).getTime() : Infinity;
        return aTime - bTime;
      })
      .map(t => ({ id: t.id, title: t.title, due: t.due, completed: t.completed }));

    return withCors({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  } catch (err) {
    console.error('[notion-tasks]', err);
    return withCors({
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'notion_fetch_failed', message: err.message }),
    });
  }
};
