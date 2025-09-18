// service-worker.js - caching + push handling for Protocol Chat
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
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await clients.claim();
    // cleanup old caches (if any)
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
});

// Basic cache-first fetch handler for assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // only handle GET requests
  if (event.request.method !== 'GET') return;
  // For navigation requests, try network first then cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
        return response;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('/index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // For other requests, use cache-first
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});

// Helper to send message to all clients (visual debug)
async function broadcastMessage(obj) {
  const all = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of all) {
    client.postMessage(obj);
  }
}

// Push event handler
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = null;
    try {
      if (event.data && event.data.size) {
        payload = event.data.json();
      }
    } catch (e) {
      // ignore parse errors
    }

    // If no payload was sent with the push, fetch the latest message from Firebase REST API
    if (!payload) {
      try {
        const resp = await fetch(FIREBASE_DB_URL + '/protocol-messages.json?orderBy="$key"&limitToLast=1');
        if (resp.ok) {
          const json = await resp.json();
          if (json) {
            // Firebase returns an object keyed by push id
            const keys = Object.keys(json);
            if (keys.length) {
              const last = json[keys[0]];
              payload = { user: last.user, message: last.message || last.text || '' };
            }
          }
        }
      } catch (err) {
        // ignore
      }
    }

    const title = (payload && (payload.user || payload.title)) ? (payload.user || payload.title) : 'Protocol Chat';
    const body = (payload && (payload.message || payload.data)) ? (payload.message || payload.data) : 'New message';
    const options = {
      body,
      icon: '/logo-192.png',
      badge: '/logo-192.png',
      tag: 'protocol-chat',
      renotify: true,
      data: { payload }
    };

    await broadcastMessage({ type: 'push-received', payload });
    return self.registration.showNotification(title, options);
  })());
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
