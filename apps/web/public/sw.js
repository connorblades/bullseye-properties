/*
 * Bullseye Platform service worker.
 *
 * Deliberately minimal: it exists to satisfy PWA installability and to give a
 * branded offline fallback for navigations. It does NOT cache dynamic or
 * authenticated responses, so it can never serve stale account data - every
 * real request goes to the network; only when a page navigation fails offline
 * do we fall back to /offline.html.
 */
const CACHE = 'bse-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle top-level navigations; everything else is network-only.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
