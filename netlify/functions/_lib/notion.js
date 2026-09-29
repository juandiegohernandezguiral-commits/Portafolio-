// ============================================================================
// Cliente de la API de Notion — usado por notion-tasks.js (endpoint client-facing)
// y por scheduled-check-deadlines.js (cron de notificaciones push).
//
// El token y el ID de base de datos viven SOLO en variables de entorno de esta
// función (NOTION_TOKEN, NOTION_DATABASE_ID / NOTION_DATA_SOURCE_ID) — nunca en
// código fuente ni llegan al navegador. Ver netlify.toml para la lista completa.
//
// NOTA sobre la versión de API vigente (léeme antes de desplegar):
// Según mi conocimiento (entrenado hasta enero 2026), Notion introdujo un
// modelo de "data sources" donde una base de datos puede contener varias
// fuentes de datos, y el endpoint de consulta pasó de
//   POST /v1/databases/{database_id}/query
// a
//   POST /v1/data_sources/{data_source_id}/query
// con el header `Notion-Version: 2025-09-03`. Escribí este archivo asumiendo
// que ese sigue siendo el endpoint vigente, pero NO tengo forma de confirmarlo
// para la fecha en la que despliegues esto (2026 en adelante). Antes de
// desplegar, verifica en https://developers.notion.com/reference/post-data-
// source-query que el endpoint/versión no haya cambiado de nuevo — si cambió,
// solo hay que tocar este archivo (NOTION_VERSION y las dos URLs de abajo).
// ============================================================================

const NOTION_VERSION = '2025-09-03';
const NOTION_API_BASE = 'https://api.notion.com/v1';

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// Resuelve el data_source_id a usar. Prioriza NOTION_DATA_SOURCE_ID (evita una
// llamada extra). Si solo tienes el ID clásico de la base de datos (el que
// aparece en la URL de Notion), usa NOTION_DATABASE_ID y este helper pide a
// Notion la lista de data sources de esa base y toma el primero — suficiente
// para el caso típico de una base de datos personal con un solo data source.
async function resolveDataSourceId(token) {
  const explicit = process.env.NOTION_DATA_SOURCE_ID;
  if (explicit) return explicit;

  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error('Falta NOTION_DATA_SOURCE_ID o NOTION_DATABASE_ID en las variables de entorno.');
  }
  const res = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, { headers: notionHeaders(token) });
  if (!res.ok) throw new Error(`Notion GET /databases/${databaseId} respondió ${res.status}`);
  const data = await res.json();
  const dataSourceId = data.data_sources && data.data_sources[0] && data.data_sources[0].id;
  if (!dataSourceId) throw new Error('No se encontró ningún data source en esa base de datos de Notion.');
  return dataSourceId;
}

// Busca una propiedad por nombre exacto (si se configuró vía env var) o, si no,
// por tipo (la primera propiedad de ese tipo que encuentre). Así funciona con
// bases de datos en español, inglés o cualquier nombre custom sin configurar nada,
// pero permite ser explícito si hay ambigüedad (p. ej. dos campos de tipo date).
function pickProp(properties, envName, type) {
  if (envName && properties[envName]) return properties[envName];
  return Object.values(properties).find(p => p.type === type) || null;
}

function extractTask(page) {
  const props = page.properties || {};

  const nameProp = pickProp(props, process.env.NOTION_PROP_NAME, 'title');
  const title = ((nameProp && nameProp.title) || []).map(t => t.plain_text).join('') || 'Sin título';

  const dueProp = pickProp(props, process.env.NOTION_PROP_DUE, 'date');
  const due = (dueProp && dueProp.date && dueProp.date.start) || null;

  const doneEnvName = process.env.NOTION_PROP_DONE;
  const doneProp = pickProp(props, doneEnvName, 'checkbox')
    || pickProp(props, doneEnvName, 'status')
    || pickProp(props, doneEnvName, 'select');
  let completed = false;
  if (doneProp) {
    if (doneProp.type === 'checkbox') completed = !!doneProp.checkbox;
    else if (doneProp.type === 'status') completed = /done|complet|listo|hecho/i.test((doneProp.status && doneProp.status.name) || '');
    else if (doneProp.type === 'select') completed = /done|complet|listo|hecho/i.test((doneProp.select && doneProp.select.name) || '');
  }

  return { id: page.id, title, due, completed, url: page.url };
}

// Consulta todas las páginas (no archivadas) del data source configurado y las
// devuelve simplificadas. La usan tanto el endpoint /notion/tasks (cara al
// cliente) como el chequeo de vencimientos del cron.
async function fetchNotionTasks() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('Falta NOTION_TOKEN en las variables de entorno.');
  const dataSourceId = await resolveDataSourceId(token);

  const res = await fetch(`${NOTION_API_BASE}/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!res.ok) throw new Error(`Notion POST /data_sources/${dataSourceId}/query respondió ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(extractTask);
}

module.exports = { fetchNotionTasks };
