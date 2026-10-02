// ============================================================================
// Scheduled function — corre cada 30 minutos (cron abajo, hora UTC).
//
// Qué hace, en orden:
//   1. Consulta las tareas de Notion en vivo (credenciales server-side, ver
//      _lib/notion.js) y filtra las que vencen dentro de PUSH_DUE_SOON_HOURS.
//   2. Lee el último resumen ligero de Trello/Outlook que el cliente sincronizó
//      (ver sync-external-summary.js) — SOLO si no está desactualizado (ver
//      STALE_SUMMARY_HOURS), para no notificar con datos viejos. Esta es la
//      solución elegida a la limitación de que Trello/Outlook no tienen
//      credenciales disponibles server-side (ver comentario largo en
//      sync-external-summary.js y docs/architecture.md).
//   3. Para cada tarea candidata que aún no se haya notificado (registro en
//      Netlify Blobs, clave 'notified-tasks'), envía un push real vía
//      web-push usando las VAPID keys (privada solo desde env var) y la
//      suscripción guardada (clave 'push-subscription').
//   4. Marca cada tarea notificada para no repetir el aviso en la próxima
//      corrida, y poda registros viejos para que ese store no crezca sin fin.
// ============================================================================

const webpush = require('web-push');
/* La periodicidad NO se declara aquí sino en netlify.toml, bajo
   [functions."scheduled-check-deadlines"]. Antes se usaba el helper schedule()
   de @netlify/functions, pero eso obligaba a arrastrar esa dependencia entera
   (cuyas versiones actuales exigen Node >= 22.12) sólo para envolver el
   handler. Declararlo en la configuración elimina la dependencia y además deja
   el cron a la vista junto al resto del despliegue, en vez de enterrado al
   final de este archivo. */
const { fetchNotionTasks } = require('./_lib/notion');
const { agendaStore } = require('./_lib/store');

const DUE_SOON_HOURS = Number(process.env.PUSH_DUE_SOON_HOURS || 24);
const STALE_SUMMARY_HOURS = 6; // más allá de esto, se ignora el resumen de Trello/Outlook en esta corrida

function isDueSoon(dueIso) {
  if (!dueIso) return false;
  const dueMs = new Date(dueIso).getTime();
  if (Number.isNaN(dueMs)) return false;
  const hoursUntilDue = (dueMs - Date.now()) / (1000 * 60 * 60);
  return hoursUntilDue <= DUE_SOON_HOURS; // incluye tareas ya vencidas (horas negativas)
}

async function collectCandidates(store) {
  const candidates = [];

  try {
    const notionTasks = await fetchNotionTasks();
    notionTasks
      .filter(t => !t.completed && isDueSoon(t.due))
      .forEach(t => candidates.push({ id: `notion:${t.id}`, title: t.title, due: t.due, source: 'Notion', url: t.url }));
  } catch (err) {
    console.error('[scheduled-check-deadlines] fallo consultando Notion:', err);
  }

  try {
    const summary = await store.get('external-summary', { type: 'json' });
    if (summary && summary.updatedAt) {
      const ageHours = (Date.now() - new Date(summary.updatedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours <= STALE_SUMMARY_HOURS) {
        (summary.items || [])
          .filter(it => isDueSoon(it.due))
          .forEach(it => candidates.push({
            id: `${it.source}:${it.id}`,
            title: it.title,
            due: it.due,
            source: it.source === 'outlook' ? 'Outlook' : 'Trello',
          }));
      } else {
        console.log('[scheduled-check-deadlines] resumen de Trello/Outlook desactualizado, se omite esta corrida.');
      }
    }
  } catch (err) {
    console.error('[scheduled-check-deadlines] fallo leyendo external-summary:', err);
  }

  return candidates;
}

async function run() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[scheduled-check-deadlines] faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, se omite esta corrida.');
    return;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const store = agendaStore();
  const subscription = await store.get('push-subscription', { type: 'json' });
  if (!subscription) {
    console.log('[scheduled-check-deadlines] sin suscripción push registrada todavía, se omite esta corrida.');
    return;
  }

  const notified = (await store.get('notified-tasks', { type: 'json' })) || {};
  const candidates = await collectCandidates(store);
  const toNotify = candidates.filter(c => !notified[c.id]);

  for (const task of toNotify) {
    const payload = JSON.stringify({
      title: `Tarea por vencer — ${task.source}`,
      body: task.title,
      url: task.url || '/',
      tag: task.id,
    });
    try {
      await webpush.sendNotification(subscription, payload);
      notified[task.id] = new Date().toISOString();
    } catch (err) {
      console.error(`[scheduled-check-deadlines] push falló para ${task.id}:`, err.statusCode || err.message);
      // 404/410 → la suscripción ya no es válida (navegador desinstalado, permiso revocado,
      // etc.). Se borra para que las siguientes corridas no sigan reintentando en vano.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await store.delete('push-subscription');
        break;
      }
    }
  }

  // Poda entradas de más de 30 días para que 'notified-tasks' no crezca sin límite.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [id, when] of Object.entries(notified)) {
    if (new Date(when).getTime() < cutoff) delete notified[id];
  }
  await store.setJSON('notified-tasks', notified);

  console.log(`[scheduled-check-deadlines] ${candidates.length} candidata(s) revisada(s), ${toNotify.length} notificada(s).`);
}

// Invocada por Netlify según el cron de netlify.toml (cada 30 min, en UTC).
module.exports.handler = async () => {
  await run();
  return { statusCode: 200 };
};
