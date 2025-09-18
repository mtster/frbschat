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
  event.waitUntil((async () => {
    let payload = null;
    try {
      if (event.data && event.data.size) {
        payload = event.data.json();
      } else {
        // no payload — fallback: fetch latest message from your Firebase Realtime DB REST endpoint
        // NOTE: replace DB URL if different; this endpoint returns JSON of messages
        const resp = await fetch('https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app/protocol-messages.json?orderBy="timestamp"&limitToLast=1');
        if (resp.ok) {
          const data = await resp.json();
          const keys = Object.keys(data || {});
          if (keys.length) {
            const last = data[keys[keys.length - 1]];
            payload = { user: last.user, message: last.message };
          }
        }
      }
    } catch (e) {
      console.error('push handler fetch error', e);
    }

    const title = (payload && payload.user) ? payload.user : 'Protocol Chat';
    const body = (payload && payload.message) ? payload.message : 'New message';
    return self.registration.showNotification(title, {
      body,
      icon: '/logo-192.png',
      tag: 'protocol-chat',
      renotify: true
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    for (const client of list) {
      if (client.url === '/' && 'focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow('/');
  }));
});

// optional: handle subscription change (re-subscribe flow)
self.addEventListener('pushsubscriptionchange', (event) => {
  // some browsers may emit this — best practice is to re-subscribe and send to server.
  event.waitUntil((async () => {
    try {
      const reg = await self.registration;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
      // POST to your /subscribe endpoint to update KV (best-effort)
      await fetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
    } catch (e) {
      console.warn('pushsubscriptionchange handler failed', e);
    }
  })());
});
