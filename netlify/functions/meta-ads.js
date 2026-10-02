// ============================================================================
// GET /meta/campaigns  (redirect en netlify.toml → /.netlify/functions/meta-ads)
//
// Trae campañas de Meta Ads con su gasto y resultados, para el Centro de
// campañas del panel (js/19-dropship.js).
//
// POR QUÉ UN PROXY Y NO LLAMAR A META DESDE EL NAVEGADOR
// El access token de Meta da acceso de lectura a toda la cuenta publicitaria.
// En el navegador sería visible para cualquiera que abra las herramientas de
// desarrollo, y el sitio es público. Vive aquí como variable de entorno y nunca
// sale del servidor — mismo patrón que el proxy de Notion.
//
// Protegido con el mismo SYNC_TOKEN que el resto de datos personales: esto
// expone cuánto gastas en publicidad, que no es información para cualquiera.
//
// Variables de entorno:
//   META_ACCESS_TOKEN  — token de acceso de Meta con permiso ads_read
//   META_AD_ACCOUNT_ID — id numérico de la cuenta, sin el prefijo "act_"
// ============================================================================

const { withCors, handlePreflight } = require('./_lib/cors');
const { requireSyncToken } = require('./_lib/auth');

// Se fija la versión de la API a propósito: Meta rompe compatibilidad entre
// versiones y dejar que el endpoint apunte a "la última" convierte un despliegue
// que funcionaba en uno que falla sin que nadie haya tocado nada.
const GRAPH_VERSION = 'v21.0';

function json(statusCode, payload) {
  return withCors({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Extrae el número de resultados de la estructura `actions` de Meta.
 *  Para Click-to-WhatsApp la acción relevante no es una compra sino el inicio
 *  de conversación, que es exactamente el "pedido" en este modelo de negocio. */
function extractResults(actions) {
  if (!Array.isArray(actions)) return 0;
  const prioridades = [
    'onsite_conversion.total_messaging_connection',
    'onsite_conversion.messaging_conversation_started_7d',
    'offsite_conversion.fb_pixel_purchase',
    'purchase',
    'lead',
  ];
  for (const tipo of prioridades) {
    const encontrado = actions.find(a => a.action_type === tipo);
    if (encontrado) return Number(encontrado.value) || 0;
  }
  return 0;
}

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const unauthorized = requireSyncToken(event);
  if (unauthorized) return withCors(unauthorized);

  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

  const token = process.env.META_ACCESS_TOKEN;
  const accountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!token || !accountId) {
    return json(503, {
      error: 'meta_not_configured',
      message: 'Faltan META_ACCESS_TOKEN y/o META_AD_ACCOUNT_ID en las variables de entorno de Netlify.',
      diagnostics: { hasToken: !!token, hasAccountId: !!accountId },
    });
  }

  const preset = (event.queryStringParameters || {}).preset || 'last_30d';
  // Lista blanca: el valor llega del cliente y se interpola en una URL. Aunque
  // Meta rechazaría un valor inválido, validar aquí evita construir peticiones
  // con lo que sea que llegue.
  const presetsValidos = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'];
  if (!presetsValidos.includes(preset)) {
    return json(400, { error: 'invalid_preset', message: `preset debe ser uno de: ${presetsValidos.join(', ')}` });
  }

  const campos = ['campaign_id', 'campaign_name', 'spend', 'impressions', 'clicks', 'ctr', 'actions'].join(',');
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/act_${encodeURIComponent(accountId)}/insights`
    + `?level=campaign&date_preset=${preset}&limit=100`
    + `&fields=${campos}`
    + `&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.error) {
      // El mensaje de Meta se devuelve tal cual porque suele ser accionable
      // ("token expirado", "falta permiso ads_read"). El token nunca viaja.
      console.error('[meta-ads] Graph API respondió error', data.error);
      return json(502, {
        error: 'meta_api_error',
        message: data.error?.message || `Graph API respondió ${res.status}`,
        code: data.error?.code ?? null,
      });
    }

    const items = (data.data || []).map(row => ({
      externalId: row.campaign_id,
      name: row.campaign_name,
      spend: Math.round(Number(row.spend) || 0),
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      ctr: Number(row.ctr) || 0,
      results: extractResults(row.actions),
    }));

    return json(200, { items, preset, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[meta-ads]', err);
    return json(502, { error: 'meta_fetch_failed', message: err.message });
  }
};
