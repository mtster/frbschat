self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  clients.claim();
});

// Offline cache (optional)
self.addEventListener("fetch", e => {
  // passthrough for now
});

// Handle push
self.addEventListener("push", e => {
  let data = {};
  try {
    data = e.data.json();
  } catch {
    data = { title: "New Message", body: "You have a new message" };
  }

  e.waitUntil(
    self.registration.showNotification(data.title || "Protocol Chat", {
      body: data.body || "",
      tag: data.tag || "chat",
      icon: "/logo-192.png",
      badge: "/logo-192.png"
    })
  );
});
