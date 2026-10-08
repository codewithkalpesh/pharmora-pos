// Pharmora POS - Safe Service Worker
const CACHE_NAME = 'pharmora-pos-shell-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL: Financial & backend API calls are strictly NETWORK-ONLY
  // Never simulate or queue financial writes (Sales, Purchases, Cashbook, Closing) offline
  if (url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return 503 service unavailable with JSON warning for API calls when offline
        if (url.pathname.startsWith('/api')) {
          return new Response(
            JSON.stringify({
              success: false,
              message: 'Offline: Financial and account operations require an active internet connection.',
              error: 'Offline: Financial and account operations require an active internet connection.',
              offline: true,
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
        throw new Error('Network offline');
      })
    );
    return;
  }

  // Static assets and app shell navigation: Stale-While-Revalidate or Cache-First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
