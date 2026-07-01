// What's Buzzing — Service Worker
// Cache-first strategy for static assets; network-only for API calls.

const CACHE_NAME = "buzzing-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/favicon.svg",
  "/manifest.json",
  "/js/app.js",
  "/js/core.js",
  "/js/api.js",
  "/js/ui.js",
  "/js/utils.js",
];

// Install: precache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static assets, network-only for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.pathname.startsWith("/api/")) return;

  // Only handle GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached response immediately, update cache in background
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => null);

      return cached || fetchPromise;
    })
  );
});
