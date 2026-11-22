// Public application shell only. Never cache authenticated pages, API replies,
// Supabase responses, uploads, or session cookies.
// Bump this version when releasing changes to the five cached shell assets.
const CACHE = "idrmm-offline-shell-v17";
const SHELL = ["/offline/index.html", "/offline/workspace.js", "/offline/storage.js", "/offline/styles.css", "/offline/icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("idrmm-offline-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", event => {
  if (event.data?.type === "OFFLINE_READY") event.waitUntil(caches.open(CACHE).then(async cache => {
    const entries = await Promise.all(SHELL.map(path => cache.match(path)));
    event.ports[0]?.postMessage({ ready: entries.every(Boolean) });
  }));
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(saved => saved || fetch(request)));
    return;
  }
  if (request.mode !== "navigate" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/accept-invite") || url.pathname.startsWith("/reset-password")) return;
  event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match("/offline/index.html"))));
});
