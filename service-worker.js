const CACHE_NAME = 'protocol-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/logo-192.png',
  '/logo-512.png'
];

// ----------------------------
// ⚡ Cache / PWA logic
// ----------------------------
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

  // Network-first for APIs
  if (req.url.includes('/macros/s/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for other requests
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(req, res.clone());
        return res;
      });
    })).catch(() => caches.match('/index.html'))
  );
});

// ----------------------------
// 🔔 Firebase Messaging Support
// ----------------------------

// Import Firebase scripts (compat version required in service worker)
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Initialize Firebase app
firebase.initializeApp({
  apiKey: "AIzaSyA-FwUy8WLXiYtT46F0f59gr461cEI_zmo",
  authDomain: "protocol-chat-b6120.firebaseapp.com",
  projectId: "protocol-chat-b6120",
  storageBucket: "protocol-chat-b6120.appspot.com",
  messagingSenderId: "969101904718",
  appId: "1:969101904718:web:8dcd0bc8690649235cec1f"
});

// Get messaging instance
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  // payload.data contains your custom fields: user, message
  const { user, message } = payload.data || {};
  self.registration.showNotification(user || "Protocol Chat", {
    body: message || "New message",
    icon: '/logo-192.png'
  });
});
