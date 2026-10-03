// ============================================================================
// POST /study/parse — interpreta una foto o un texto y saca la tarea
//
// Le llega una foto del cuaderno o del tablero, o el texto de un dictado, y
// devuelve lo que haya entendido: qué es, de qué materia, para cuándo y cuánto
// vale. NO guarda nada: el panel usa la respuesta para rellenar el formulario y
// que el usuario confirme. Una IA escribiendo directo en los datos se equivoca
// en silencio; así, si entendió mal la fecha, se ve antes de guardar.
//
// La API key vive aquí como variable de entorno y nunca llega al navegador: con
// ella se puede gastar dinero de la cuenta, así que no puede estar en el cliente
// de un sitio público.
//
// SOBRE LA LATENCIA
// Las funciones de Netlify cortan a los 10 segundos. Por eso se pide esfuerzo
// bajo: esto es una extracción corta y acotada, no un problema de razonamiento,
// y el esfuerzo alto sólo añadiría segundos sin mejorar el resultado. Si alguna
// vez se queda corto, lo que hay que subir es el esfuerzo, no el modelo.
//
// Variables de entorno: ANTHROPIC_API_KEY, y SYNC_TOKEN para la autenticación.
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const { withCors, handlePreflight } = require('./_lib/cors');
const { requireSyncToken } = require('./_lib/auth');

const MODELO = 'claude-opus-5';
const MAX_BODY_BYTES = 6 * 1024 * 1024;   // una foto de móvil cabe de sobra
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/* Todos los campos son obligatorios y de tipo simple a propósito. Las salidas
   estructuradas no admiten cualquier JSON Schema, y un `null` o un `anyOf` mal
   puesto hace fallar la petición entera. Con cadena vacía y cero como "no sé",
   el esquema es trivial y el cliente decide qué hacer con los huecos. */
const ESQUEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'Qué hay que hacer, concreto y en una línea.' },
          kind:    { type: 'string', enum: ['tarea', 'parcial', 'quiz', 'proyecto', 'exposicion', 'otro'] },
          subject: { type: 'string', description: 'Materia. Vacío si no se puede saber.' },
          dueISO:  { type: 'string', description: 'Fecha y hora en ISO 8601. Vacío si no se menciona.' },
          weight:  { type: 'number', description: 'Peso en la nota, 0 a 100. Cero si no se menciona.' },
          notes:   { type: 'string', description: 'Detalles útiles: páginas, formato, con quién. Vacío si no hay.' },
          confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
        required: ['title', 'kind', 'subject', 'dueISO', 'weight', 'notes', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function json(statusCode, payload) {
  return withCors({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function instrucciones({ hoy, materias }) {
  return `Eres el asistente de un estudiante de primer semestre de Tecnología en Desarrollo de Software del ITM (Instituto Tecnológico Metropolitano, Medellín, Colombia). Extraes tareas y evaluaciones de fotos de cuadernos, fotos de tableros y mensajes dictados en voz.

HOY ES ${hoy} (zona horaria de Colombia, UTC-5).

${materias.length
  ? `Las materias que el estudiante tiene registradas son:\n${materias.map(m => `- ${m}`).join('\n')}\n\nCuando reconozcas una de estas, usa su nombre EXACTO tal como aparece arriba. Si lo que lees es una abreviatura o un apodo ("cálculo", "progra", "inglés"), resuélvelo a la materia de la lista que corresponda.`
  : 'El estudiante todavía no tiene materias registradas, así que escribe el nombre de la materia tal como lo veas.'}

REGLAS

Fechas. Resuelve siempre a una fecha concreta contando desde hoy. "El viernes" es el próximo viernes; "mañana" es el día siguiente; "en dos semanas" se suma. Si sólo se menciona un día sin hora, usa las 23:59, que es cuando suelen cerrar las entregas. Si no hay ninguna pista de fecha, deja dueISO vacío — no te la inventes.

Varias tareas. Una foto de una página de cuaderno puede tener varias cosas distintas. Devuélvelas por separado, una por entrada. Si es una sola, devuelve una sola.

Qué NO es una tarea. En una foto de cuaderno hay apuntes, fórmulas, ejemplos y dibujos. Nada de eso es una tarea. Extrae sólo lo que el estudiante tiene que HACER o ENTREGAR. Si la imagen no contiene ninguna tarea, devuelve la lista vacía.

Confianza. Marca "baja" cuando la letra no se lee bien, cuando la fecha es ambigua o cuando dudas de la materia. El estudiante va a revisar lo que devuelvas, y saber de qué dudas le ahorra tiempo. No disimules la duda: es más útil un "baja" honesto que un dato inventado con seguridad.

Escribe en español de Colombia, en segunda persona y sin rodeos.`;
}

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const unauthorized = requireSyncToken(event);
  if (unauthorized) return withCors(unauthorized);

  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, {
      error: 'ai_not_configured',
      message: 'Falta ANTHROPIC_API_KEY en las variables de entorno de Netlify.',
    });
  }
  if ((event.body || '').length > MAX_BODY_BYTES) {
    return json(413, { error: 'body_too_large', message: 'La imagen es demasiado grande. Hazla más pequeña e inténtalo otra vez.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid_json' }); }

  const texto = String(body.text || '').trim().slice(0, 4000);
  const imagen = body.image || null;     // { mediaType, data } en base64
  if (!texto && !imagen) {
    return json(400, { error: 'empty', message: 'Manda una foto o un texto.' });
  }
  if (imagen && !TIPOS_IMAGEN.includes(imagen.mediaType)) {
    return json(400, { error: 'bad_image_type', message: 'Formato de imagen no soportado. Usa JPG, PNG o WebP.' });
  }

  const materias = Array.isArray(body.subjects)
    ? body.subjects.map(s => String(s).slice(0, 120)).slice(0, 40) : [];
  const hoy = new Date(Date.now() - 5 * 3600000)   // Colombia, UTC-5
    .toISOString().slice(0, 16).replace('T', ' ');

  const contenido = [];
  if (imagen) {
    contenido.push({
      type: 'image',
      source: { type: 'base64', media_type: imagen.mediaType, data: imagen.data },
    });
  }
  contenido.push({
    type: 'text',
    text: texto
      ? (imagen ? `Además de la foto, el estudiante dice: ${texto}` : texto)
      : 'Extrae las tareas o evaluaciones que aparezcan en esta imagen.',
  });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: MODELO,
      max_tokens: 4096,
      system: instrucciones({ hoy, materias }),
      thinking: { type: 'adaptive' },
      // Esfuerzo bajo: extracción corta y acotada, y la función tiene 10
      // segundos antes de que Netlify la corte.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ESQUEMA },
      },
      messages: [{ role: 'user', content: contenido }],
    });

    if (res.stop_reason === 'refusal') {
      return json(422, {
        error: 'refused',
        message: 'El modelo no pudo procesar esta imagen. Prueba con otra foto o escribe la tarea a mano.',
      });
    }

    const bloque = (res.content || []).find(b => b.type === 'text');
    if (!bloque) return json(502, { error: 'empty_response', message: 'El modelo no devolvió nada.' });

    let datos;
    try { datos = JSON.parse(bloque.text); }
    catch { return json(502, { error: 'bad_json', message: 'La respuesta del modelo no vino en el formato esperado.' }); }

    return json(200, {
      items: Array.isArray(datos.items) ? datos.items : [],
      usage: {
        input: res.usage?.input_tokens ?? null,
        output: res.usage?.output_tokens ?? null,
      },
    });
  } catch (err) {
    console.error('[study-parse]', err);
    if (err.status === 401) {
      return json(503, { error: 'ai_auth', message: 'La ANTHROPIC_API_KEY no es válida.' });
    }
    if (err.status === 429) {
      return json(429, { error: 'ai_rate_limit', message: 'Demasiadas peticiones seguidas. Espera un momento.' });
    }
    return json(502, { error: 'ai_failed', message: err.message });
  }
};
