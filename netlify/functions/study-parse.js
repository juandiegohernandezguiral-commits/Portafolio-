// ============================================================================
// POST /study/parse — interpreta una foto o un texto y saca la tarea
//
// Le llega una foto del cuaderno o del tablero, o el texto de un dictado, y
// devuelve lo que haya entendido: qué es, de qué materia, para cuándo y cuánto
// vale. NO guarda nada: el panel usa la respuesta para rellenar el formulario y
// que el usuario confirme. Una IA escribiendo directo en los datos se equivoca
// en silencio; así, si entendió mal la fecha, se ve antes de guardar.
//
// POR QUÉ GEMINI Y NO OTRO
// Porque tiene plan gratuito y esto lo usa un estudiante. La contrapartida está
// en los propios términos de Google para el plan sin pagar: el contenido que se
// envía se usa para mejorar sus productos y «human reviewers may read, annotate,
// and process your API input and output». Hay una excepción para la UE, Suiza y
// Reino Unido que aquí NO aplica (Colombia). Se eligió con eso sobre la mesa.
//
// Consecuencia práctica: esto NO es el sitio para mandar nada sensible. Fotos de
// apuntes de clase, sí. Documentos personales, no.
//
// SOBRE LA LATENCIA
// Las funciones de Netlify cortan a los 10 segundos. Si el modelo por defecto se
// queda corto, la salida es cambiar GEMINI_MODEL por uno más rápido
// (gemini-2.5-flash-lite) antes que tocar nada del código.
//
// Variables de entorno:
//   GEMINI_API_KEY  — obligatoria. Se saca gratis en aistudio.google.com
//   GEMINI_MODEL    — opcional, para probar otro modelo sin tocar el código
//   SYNC_TOKEN      — la autenticación del resto del panel
// ============================================================================

const { GoogleGenAI, Type } = require('@google/genai');
const { withCors, handlePreflight } = require('./_lib/cors');
const { requireSyncToken } = require('./_lib/auth');

const MODELO = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const MAX_BODY_BYTES = 6 * 1024 * 1024;   // una foto de móvil cabe de sobra
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

/* Todos los campos son obligatorios y de tipo simple a propósito. Con cadena
   vacía y cero como "no sé", el esquema es trivial y es el cliente quien decide
   qué hacer con los huecos — en vez de depender de que el modelo acierte a
   omitir un campo opcional. */
const ESQUEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title:      { type: Type.STRING, description: 'Qué hay que hacer, concreto y en una línea.' },
          kind:       { type: Type.STRING, enum: ['tarea', 'parcial', 'quiz', 'proyecto', 'exposicion', 'otro'] },
          subject:    { type: Type.STRING, description: 'Materia. Cadena vacía si no se puede saber.' },
          dueISO:     { type: Type.STRING, description: 'Fecha y hora en ISO 8601. Cadena vacía si no se menciona.' },
          weight:     { type: Type.NUMBER, description: 'Peso en la nota, de 0 a 100. Cero si no se menciona.' },
          notes:      { type: Type.STRING, description: 'Detalles útiles: páginas, formato, con quién. Vacío si no hay.' },
          confidence: { type: Type.STRING, enum: ['alta', 'media', 'baja'] },
        },
        required: ['title', 'kind', 'subject', 'dueISO', 'weight', 'notes', 'confidence'],
      },
    },
  },
  required: ['items'],
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

HOY ES ${hoy} (hora de Colombia, UTC-5).

${materias.length
  ? `Las materias que el estudiante tiene registradas son:\n${materias.map(m => `- ${m}`).join('\n')}\n\nCuando reconozcas una de estas, usa su nombre EXACTO tal como aparece arriba. Si lo que lees es una abreviatura o un apodo ("cálculo", "progra", "inglés"), resuélvelo a la materia de la lista que corresponda.`
  : 'El estudiante todavía no tiene materias registradas, así que escribe el nombre de la materia tal como lo veas.'}

REGLAS

Fechas. Resuelve siempre a una fecha concreta contando desde hoy. "El viernes" es el próximo viernes; "mañana" es el día siguiente; "en dos semanas" se suma. Si sólo se menciona un día sin hora, usa las 23:59, que es cuando suelen cerrar las entregas. Si no hay ninguna pista de fecha, deja dueISO como cadena vacía — no te la inventes.

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

  if (!process.env.GEMINI_API_KEY) {
    return json(503, {
      error: 'ai_not_configured',
      message: 'Falta GEMINI_API_KEY en las variables de entorno de Netlify. Se saca gratis en aistudio.google.com.',
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

  // El orden importa: la imagen primero y la instrucción después, que es como
  // la documentan los ejemplos de Gemini para entrada multimodal.
  const contenido = [];
  if (imagen) {
    contenido.push({ inlineData: { mimeType: imagen.mediaType, data: imagen.data } });
  }
  contenido.push({
    text: texto
      ? (imagen ? `Además de la foto, el estudiante dice: ${texto}` : texto)
      : 'Extrae las tareas o evaluaciones que aparezcan en esta imagen.',
  });

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await ai.models.generateContent({
      model: MODELO,
      contents: contenido,
      config: {
        systemInstruction: instrucciones({ hoy, materias }),
        responseMimeType: 'application/json',
        responseJsonSchema: ESQUEMA,
      },
    });

    const salida = res.text;
    if (!salida) {
      // Pasa cuando los filtros de seguridad bloquean la respuesta: no hay texto
      // pero tampoco una excepción, así que hay que mirarlo a mano.
      return json(422, {
        error: 'empty_response',
        message: 'El modelo no devolvió nada. Prueba con otra foto o escribe la tarea a mano.',
        finishReason: res.candidates?.[0]?.finishReason ?? null,
      });
    }

    let datos;
    try { datos = JSON.parse(salida); }
    catch { return json(502, { error: 'bad_json', message: 'La respuesta del modelo no vino en el formato esperado.' }); }

    return json(200, {
      items: Array.isArray(datos.items) ? datos.items : [],
      model: MODELO,
      usage: {
        input: res.usageMetadata?.promptTokenCount ?? null,
        output: res.usageMetadata?.candidatesTokenCount ?? null,
      },
    });
  } catch (err) {
    console.error('[study-parse]', err);
    const msg = String(err?.message || '');

    if (/API key not valid|API_KEY_INVALID|401/i.test(msg)) {
      return json(503, { error: 'ai_auth', message: 'La GEMINI_API_KEY no es válida.' });
    }
    // 429 en el plan gratuito es lo más probable que se encuentre a diario.
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      return json(429, {
        error: 'ai_rate_limit',
        message: 'Se agotó la cuota gratuita de Gemini por ahora. Espera un rato o escribe la tarea a mano.',
      });
    }
    if (/404|NOT_FOUND|not found/i.test(msg)) {
      return json(502, {
        error: 'ai_model',
        message: `El modelo "${MODELO}" no está disponible para tu clave. Cambia GEMINI_MODEL en Netlify (prueba gemini-2.5-flash).`,
      });
    }
    return json(502, { error: 'ai_failed', message: msg || 'Falló la llamada al modelo.' });
  }
};
