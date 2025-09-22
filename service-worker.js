// service-worker.js - caching + push handling for Protocol Chat
// --- OneSignal integration: import the OneSignal SW so pushes from OneSignal are handled ---
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

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

const FIREBASE_DB_URL = 'https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      try {
        if ('focus' in client) return client.focus();
      } catch (e) {}
    }
    if (clients.openWindow) return clients.openWindow('/');
  })());
});
