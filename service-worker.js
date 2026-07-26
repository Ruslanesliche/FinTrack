const CACHE_NAME = "fintrack-static-v1.2.6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./css/variables.css?v=1.2.6",
  "./css/style.css?v=1.2.6",
  "./css/components.css?v=1.2.6",
  "./css/mobile.css?v=1.2.6",
  "./css/animations.css?v=1.2.6",
  "./app.bundle.js?v=1.2.6",
  "./js/app.js?v=1.2.6",
  "./js/auth.js",
  "./js/email.js",
  "./js/password.js",
  "./js/router.js",
  "./js/storage.js",
  "./js/transactions.js",
  "./js/categories.js",
  "./js/budgets.js",
  "./js/goals.js",
  "./js/debts.js",
  "./js/analytics.js",
  "./js/settings.js",
  "./js/sync.js",
  "./js/backup.js",
  "./js/notifications.js",
  "./js/utils.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/maskable-icon-192.png",
  "./assets/icons/maskable-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("fintrack-static-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.method !== "GET") return;
  const isNavigation = event.request.mode === "navigate";
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(async () => (await caches.match("./index.html")) || caches.match("./offline.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok || response.type === "opaque") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
