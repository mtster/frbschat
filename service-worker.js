// service-worker.js
// Robust push + caching service worker for Protocol Chat
// - Parses incoming push payloads and shows notifications
// - If push has no payload, falls back to fetching the latest message from Firebase RTDB
// - Posts a message to open clients so the app can show a subtle toast
// - Handles notification click & subscriptionchange

const CACHE_NAME = 'protocol-cache-v1';
const ASSETS = [
  '/', '/index.html', '/app.js', '/style.css', '/manifest.json',
  '/logo-192.png', '/logo-512.png'
];

// IMPORTANT: Update this value only if your Firebase DB URL is different.
// This is used only as a fallback when push payload is missing.
const FIREBASE_DB_URL = 'https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app';

// Install: cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      try {
        return cache.addAll(ASSETS);
      } catch (e) {
        // If a resource is missing, still proceed without failing install
        return Promise.resolve();
      }
    })
  );
  self.skipWaiting();
});

// Activate: claim clients and remove old caches
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
});

// Simple cache-first fetch handler (navigation: network first with cache fallback)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only handle GETs here

  // Navigation requests: try network then cache fallback (helps offline PWA)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResp = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, networkResp.clone());
        return networkResp;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const fallback = await cache.match('/index.html');
        return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // For other GET requests: return cache-first
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});

// Utility: broadcast a message to all window clients
async function broadcastMessage(obj) {
  try {
    const all = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const c of all) {
      c.postMessage(obj);
    }
  } catch (e) {
    // ignore
  }
}

// Helper: fetch latest message from Firebase RTDB (fallback when push has no payload)
async function fetchLatestMessageFromFirebase() {
  try {
    const url = FIREBASE_DB_URL.replace(/\/$/, '') + '/protocol-messages.json?orderBy="$key"&limitToLast=1';
    const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json) return null;
    const keys = Object.keys(json);
    if (!keys.length) return null;
    const last = json[keys[0]];
    // Normalize shape to { user, message }
    return {
      user: last.user || last.nickname || last.name || 'Unknown',
      message: last.message || last.text || last.msg || ''
    };
  } catch (e) {
    return null;
  }
}

// Push event: show notification; fall back to fetching latest message if payload absent
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = null;

    // Try parsing JSON payload (most reliable)
    try {
      if (event.data && event.data.size) {
        payload = event.data.json();
      }
    } catch (e) {
      // if parsing fails, ignore and fall back below
      payload = null;
    }

    // If payload missing, attempt to fetch latest message from Firebase as a fallback
    if (!payload) {
      const latest = await fetchLatestMessageFromFirebase();
      if (latest) {
        payload = { user: latest.user, message: latest.message };
      } else {
        payload = { message: 'New message' };
      }
    }

    // Build notification title/body
    const title = (payload && (payload.title || payload.user)) ? (payload.title || payload.user) : 'Protocol Chat';
    const body = (payload && (payload.body || payload.message || payload.data)) ? (payload.body || payload.message || payload.data) : 'New message';

    const options = {
      body,
      icon: '/logo-192.png',
      badge: '/logo-192.png',
      tag: 'protocol-chat',
      renotify: true,
      data: { payload },
      // Use actions if you want (left commented as optional)
      // actions: [{action: 'open', title: 'Open'}]
    };

    // Inform open pages (so they can show UI toast) — non-blocking
    broadcastMessage({ type: 'push-received', payload: { title, body } });

    // Show the notification
    return self.registration.showNotification(title, options);
  })());
});

// Notification click handler: focus or open client
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    try {
      const all = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const c of all) {
        if ('focus' in c) {
          await c.focus();
          return;
        }
      }
      if (clients.openWindow) {
        await clients.openWindow('/');
      }
    } catch (e) {
      // ignore
    }
  })());
});

// Optional: notificationclose (no-op but here for completeness)
self.addEventListener('notificationclose', (event) => {
  // Could be used to send analytics or update server state if desired
});

// When a push subscription changes (browser rotates keys or similar), notify clients to re-subscribe
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    // Let open clients know they should re-subscribe (show a UI prompt)
    await broadcastMessage({ type: 'subscription-change' });
    // Attempt to re-subscribe automatically if possible (best-effort)
    try {
      const applicationServerKey = null; // cannot access VAPID here; client should handle re-subscribe with its key
      const swReg = self.registration;
      // If app needs to auto re-subscribe, the client should listen for 'subscription-change' and call subscribe()
    } catch (e) {
      // ignore
    }
  })());
});
