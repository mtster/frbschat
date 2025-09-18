// service-worker.js - Cache + Push handling
// IMPORTANT: set FIREBASE_DB_URL to your project's Realtime Database URL (no trailing slash), e.g.:
// const FIREBASE_DB_URL = 'https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_DB_URL = 'https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app'; // <-- REPLACE THIS with your actual DB URL

const CACHE_NAME = 'protocol-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/style.css',
  '/logo-192.png',
  '/logo-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        // cache same-origin assets from ASSETS
        try {
          const url = new URL(req.url);
          if (url.origin === location.origin && ASSETS.includes(url.pathname)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
        } catch (e) {}
        return response;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

// Push event - show notification. If payload is missing, fetch latest message from Firebase RTDB.
self.addEventListener('push', function(event) {
  event.waitUntil((async () => {
    let payload = null;
    try {
      if (event.data) {
        const text = event.data.text();
        try { payload = JSON.parse(text); } catch (e) { payload = { text }; }
      }
    } catch (e) {
      payload = null;
    }

    let title = 'Protocol';
    let body = 'New message';
    let data = { url: '/' };

    if (payload && (payload.title || payload.body || payload.user || payload.text)) {
      title = payload.title || payload.user || title;
      body = payload.body || payload.text || body;
      data = payload.data || data;
    } else {
      // Fetch latest message from Firebase RTDB via REST API (public or with read rules)
      try {
        // use orderBy="$key"&limitToLast=1 to get the most recent item
        const res = await fetch(`${FIREBASE_DB_URL}/protocol-messages.json?orderBy="$key"&limitToLast=1`);
        if (res && res.ok) {
          const json = await res.json();
          if (json) {
            let last = null;
            for (const k in json) { last = json[k]; break; }
            if (last) {
              title = last.user || title;
              // try different possible message field names
              body = last.message || last.text || last.textContent || body;
              data = { url: '/' };
            }
          }
        } else {
          // try alternative URL pattern (some RTDB instances use different host)
        }
      } catch (e) {
        // ignore fetch errors
      }
    }

    const opts = {
      body: body,
      tag: 'protocol-chat',
      renotify: true,
      data: data,
      badge: '/logo-192.png',
      icon: '/logo-192.png'
    };
    return self.registration.showNotification(title, opts);
  })());
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if (c.url === '/' && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow('/');
  })());
});
