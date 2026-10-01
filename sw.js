/*
 * Service worker — portafolio de Juan Diego Hernández
 *
 * Fase 1: registro básico del worker.
 * Fase 3: notificaciones push reales enviadas por el backend serverless
 *         (/netlify/functions/scheduled-check-deadlines.js) vía VAPID.
 * Fase 4: caché offline. Hasta ahora el worker no cacheaba nada, así que la PWA
 *         instalada en el celular no abría sin señal — justo cuando un panel de
 *         tareas es más útil. Ahora el shell de la app se sirve desde caché y
 *         los datos siguen viniendo del localStorage, que ya funciona offline.
 *
 * Al cambiar cualquier archivo del shell hay que subir SW_VERSION: es lo que
 * invalida la caché anterior y fuerza a los clientes a recoger la nueva.
 */

const SW_VERSION = 'jdh-sw-v3';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

/* El shell: lo mínimo para que la app arranque sin red. Deliberadamente NO
   incluye intro.mp4 (12 MB) ni dinero-bg.jpg (2 MB) — precargar eso gastaría
   casi toda la cuota de almacenamiento del navegador en móvil para adornar un
   hero que offline no importa. Se dejan a la estrategia de runtime. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/01-base.js',
  './js/02-effects.js',
  './js/03-hero.js',
  './js/04-ui.js',
  './js/05-dashboard.js',
  './js/06-integrations.js',
  './js/07-sync.js',
  './js/08-productivity.js',
  './js/09-palette.js',
  './js/10-markdown.js',
  './js/11-notes.js',
  './js/12-graph.js',
  './js/13-habits.js',
  './js/14-focus.js',
  './js/15-insights.js',
  './js/99-init.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

/* Orígenes de terceros que vale la pena cachear: las librerías y las fuentes son
   inmutables (llevan versión en la URL), así que cache-first es seguro y hace
   que la segunda carga sea instantánea. */
const CACHEABLE_ORIGINS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* Nunca cachear: son datos vivos o peticiones autenticadas. Servir una versión
   antigua de la lista de tareas sería peor que no mostrar nada, porque daría por
   buena información caducada sin avisar. */
const NEVER_CACHE_PATTERNS = [
  '/data/pull', '/data/push',
  '/notion/tasks', '/push/subscribe', '/sync/external-summary',
  '/.netlify/functions/',
  'api.trello.com',
  'graph.microsoft.com',
  'login.microsoftonline.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll es atómico: si un solo archivo falla, no se instala nada. Se
      // añaden de uno en uno para que un asset ausente (p. ej. tras renombrar)
      // no deje la PWA entera sin caché.
      .then((cache) => Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] no se pudo precachear', url, err))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => !name.startsWith(SW_VERSION))
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function shouldNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((pattern) => url.includes(pattern));
}

/** Red primero, caché como red de seguridad. Para el HTML y para el JS/CSS propios.
 *
 *  `cache: 'no-cache'` NO es redundante: sin él, `fetch(request)` se resuelve
 *  contra la caché HTTP del navegador y puede devolver una copia vieja sin
 *  tocar el servidor (transferSize 0). Es decir, "red primero" leería de caché
 *  — justo el desfase de versiones que esta estrategia existe para evitar.
 *  Con 'no-cache' siempre se hace una petición condicional: si el archivo no
 *  cambió el servidor responde 304 y no se transfiere cuerpo, así que el coste
 *  es mínimo y la corrección es total.
 *
 *  Se pasa la URL en vez del Request original porque construir un Request a
 *  partir de otro con mode 'navigate' lanza una excepción, y aquí sólo se
 *  manejan GET de recursos propios. */
async function networkFirst(request) {
  try {
    const response = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Una navegación offline a cualquier ruta cae en el index cacheado: la app
    // es de una sola página, así que desde ahí se puede seguir trabajando.
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    throw err;
  }
}

/** Caché primero, y se revalida en segundo plano para la próxima visita. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      // Las respuestas opacas (cross-origin sin CORS) tienen status 0 pero son
      // válidas para servir scripts y fuentes, así que también se guardan.
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await networkPromise;
  if (fresh) return fresh;
  throw new Error('sin red y sin copia en caché: ' + request.url);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Sólo GET: un POST no se puede reproducir desde caché con seguridad.
  if (request.method !== 'GET') return;

  const url = request.url;
  if (shouldNeverCache(url)) return;                  // pasa directo a la red

  const sameOrigin = new URL(url).origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (sameOrigin) {
    // El vídeo del hero se queda fuera: 12 MB en la caché de un móvil no
    // compensan, y offline el hero no es lo que se viene a usar.
    if (url.endsWith('.mp4')) return;

    /* El CSS y el JS propios van por red primero, no por caché primero.
       Con stale-while-revalidate el HTML (que sí es network-first) podría
       llegar nuevo mientras el JS se sirve todavía de la caché anterior, y esa
       mezcla de versiones es justo el tipo de fallo que aparece una vez y no
       se reproduce. Son ~90 KB en total: pedirlos a la red cuando hay red
       cuesta poco, y la caché sigue cubriendo el caso offline. */
    if (url.endsWith('.js') || url.endsWith('.css')) {
      event.respondWith(networkFirst(request));
      return;
    }

    // Imágenes, iconos y el manifest: inmutables en la práctica.
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  if (CACHEABLE_ORIGINS.some((origin) => url.startsWith(origin))) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
  // Cualquier otro origen: sin interceptar, comportamiento normal del navegador.
});

/* ============ NOTIFICACIONES PUSH ============
   Payload esperado en cada push (ver docs/architecture.md): { title, body, url, tag } */

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'Panel privado';
  const options = {
    body: data.body || 'Tienes una actualización en tu agenda.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
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
