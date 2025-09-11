const CACHE_NAME = 'protocol-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  // add icons
  '/logo-192.png',
  '/logo-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Try network first for API requests, fall back to cache
  if (req.url.includes('/macros/s/')) { // heuristic for apps script domain
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // For other requests: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(req, res.clone());
        return res;
      });
    })).catch(() => caches.match('/index.html'))
  );
});
