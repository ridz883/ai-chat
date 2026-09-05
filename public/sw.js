const CACHE_NAME = 'rzchat-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Biarkan network-first agar API chat tidak tersangkut cache
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
