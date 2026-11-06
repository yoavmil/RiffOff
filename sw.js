// RiffOff service worker: makes the app installable and keeps the UI shell
// available offline.
//
// Audio files are deliberately NOT intercepted. Safari on iOS requests media
// with HTTP Range headers and fails playback if a service worker answers with a
// plain 200 response, so audio always goes straight to the network/HTTP cache.
// songs.json and library.json are network-first so playlist/config edits show up
// on the next refresh. The cloud library is cross-origin and is never intercepted.

const CACHE = 'riffoff-shell-v4';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', './manifest.webmanifest', './icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
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
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/audio/') || req.headers.has('range')) return;

  const networkFirst =
    req.mode === 'navigate' || url.pathname.endsWith('/songs.json') || url.pathname.endsWith('/library.json');

  if (networkFirst) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        // Each design is its own page, so cache navigations per URL.
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
    return;
  }

  // Hashed build assets and icons: cache-first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
