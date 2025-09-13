const CACHE_NAME = 'protocol-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/logo-192.png',
  '/logo-512.png',
  '/style.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ----------------------------
// Web Push Support
// ----------------------------
self.addEventListener('push', event => {
  const data = event.data.json() || {};
  const { user, message } = data;

  event.waitUntil(
    self.registration.showNotification(user || 'Protocol Chat', {
      body: message || 'New message',
      icon: '/logo-192.png'
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
