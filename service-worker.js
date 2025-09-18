// service-worker.js - robust push handler (no caching changes here)

self.addEventListener('install', (ev) => {
  self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(self.clients.claim());
});

self.addEventListener('push', (ev) => {
  ev.waitUntil((async () => {
    let payload = null;
    try {
      if (ev.data && ev.data.size) {
        payload = ev.data.json();
      }
    } catch (e) {
      // parse error -> fallback below
    }

    // default notification if no payload
    let title = 'Protocol Chat';
    let body = 'New message';
    let tag = 'protocol-chat';

    if (payload) {
      // Expect payload shape: { title, body, data }
      title = payload.title || (payload.user ? payload.user : title);
      body = payload.body || payload.message || payload.data || body;
      tag = payload.tag || tag;
    }

    // Broadcast to clients (so PWA can show a short toast)
    try {
      const all = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const c of all) {
        c.postMessage({ type: 'push-received', payload: { title, body } });
      }
    } catch (e) {
      // ignore
    }

    const options = {
      body,
      tag,
      icon: '/logo-192.png',
      badge: '/logo-192.png',
      renotify: true,
      data: payload || {}
    };

    return self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  ev.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow('/');
  })());
});
