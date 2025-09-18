// service-worker.js - caching + push handling (fetches latest message from Firebase if push payload missing)
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

// Update this DB URL to match your Firebase Realtime Database (same as firebase-config.js)
const FIREBASE_DB_URL = 'https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Simple cache-first strategy for assets
self.addEventListener('fetch', event => {
  const req = event.request;
  // respond with cache for navigation and assets
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        // optionally cache responses for same-origin assets
        try {
          const url = new URL(req.url);
          if (url.origin === location.origin && ASSETS.includes(url.pathname)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
        } catch (e) {}
        return response;
      }).catch(() => {
        // fallback to index.html for navigation requests
        if (req.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

// Push event - we don't require payload encryption. The service worker will fetch the latest message from Firebase RTDB
self.addEventListener('push', function(event) {
  event.waitUntil((async () => {
    let payload = null;
    try {
      if (event.data) {
        const text = event.data.text();
        try { payload = JSON.parse(text); } catch(e) { payload = { text }; }
      }
    } catch (e) {
      payload = null;
    }

    let title = 'Protocol';
    let body = 'New message';
    let data = { url: '/' };

    if (payload && (payload.title || payload.body)) {
      title = payload.title || title;
      body = payload.body || body;
      data = payload.data || data;
    } else {
      // Fetch latest message from Firebase RTDB via REST API
      try {
        const res = await fetch(`${FIREBASE_DB_URL}/protocol-messages.json?orderBy="$key"&limitToLast=1`);
        if (res && res.ok) {
          const json = await res.json();
          if (json) {
            // json is an object with a single key => message
            let last = null;
            for (const k in json) { last = json[k]; break; }
            if (last) {
              title = last.user || 'Protocol';
              body = last.text || 'New message';
              data = { url: '/' };
            }
          }
        }
      } catch (e) {
        // ignore
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
