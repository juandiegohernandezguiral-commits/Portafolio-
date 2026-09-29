/*
 * Service worker — Juan Diego Hernández portfolio
 * Fase 1: registro básico del worker (sin estrategia de caché offline).
 * Fase 3: el backend serverless (/netlify/functions/scheduled-check-deadlines.js) envía pushes
 * reales vía VAPID cuando una tarea de Notion (y, si el resumen ligero está fresco, de Trello/
 * Outlook) está por vencer. El registro de la suscripción ocurre desde el botón "Activar
 * notificaciones" del panel privado (index.html → Agenda → Centro de tareas).
 *
 * Payload esperado en cada push (ver docs/architecture.md): { title, body, url, tag }.
 */

const SW_VERSION = 'jdh-sw-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'Panel privado';
  const options = {
    body: data.body || 'Tienes una actualización en tu agenda.',
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: data.tag || undefined, // agrupa/reemplaza notificaciones de la misma tarea (id de Notion/Trello/Outlook)
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
