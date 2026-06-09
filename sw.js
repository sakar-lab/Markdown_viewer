const CACHE_VERSION = 'v20';
const CACHE_NAME = `math-notes-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './live-editor.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.startsWith('math-notes-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return undefined;
        })
      )
    )
  );

  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const cloned = response.clone();

          if (response.ok && response.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cloned);
            });
          }

          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => {
            if (cached) {
              return cached;
            }
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return undefined;
          })
        )
    );
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
