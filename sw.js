// CCFACO Management System service worker
// Only caches the app shell (HTML/JS/icons) so the app opens instantly and
// works offline. It NEVER caches Supabase requests — sales/products/members
// data always comes fresh from the network so nothing goes stale or gets
// double-sold while offline.
const CACHE_NAME = 'ccfaco-pos-shell-v1';
const SHELL_FILES = [
  './index.html',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Supabase (or any cross-origin) API calls — always live.
  if (url.origin !== self.location.origin) return;

  // App shell: try the network first (so updates show up), fall back to cache
  // when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
