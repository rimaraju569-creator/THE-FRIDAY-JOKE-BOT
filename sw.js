// Friday - The Joke Bot - Service Worker
// Offline caching, background sync, and push notifications

const CACHE_NAME = 'friday-cache-v1';
const RUNTIME_CACHE = 'friday-runtime-v1';
const JOKES_CACHE = 'friday-jokes-v1';
const WEATHER_CACHE = 'friday-weather-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './privacy-policy.html',
  './terms-of-service.html'
];

// ---------- Install: cache app shell ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ---------- Activate: clean up old caches ----------
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE, JOKES_CACHE, WEATHER_CACHE];
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !currentCaches.includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------- Fetch: route by request type ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Weather API — network only (data must be fresh)
  if (url.hostname.includes('open-meteo.com')) {
    event.respondWith(networkOnly(request, WEATHER_CACHE));
    return;
  }

  // Jokes / API-like data — stale-while-revalidate
  if (url.pathname.includes('joke')) {
    event.respondWith(staleWhileRevalidate(request, JOKES_CACHE));
    return;
  }

  // HTML pages — network-first, fall back to cache/offline shell
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets (images, css, js, fonts) — cache-first
  if (['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default — try cache, then network
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// ---------- Strategies ----------
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || caches.match('./index.html');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkOnly(request, cacheName) {
  try {
    const response = await fetch(request);
    // Keep a short-lived copy in case of brief offline blips
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ---------- Background Sync ----------
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-jokes') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'sw-sync', tag: 'sync-jokes' }));
      })
    );
  }
});

// ---------- Push Notifications ----------
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Friday';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: data.url || './index.html'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// ---------- Message bridge ----------
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
  }
});
