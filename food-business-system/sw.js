/* =========================================================
   sw.js - Offline-first Service Worker (PWA)
   Caches the entire application shell and local vendor assets
   so the app operates without internet after first load.
   ========================================================= */
'use strict';

const CACHE_NAME = 'food-business-ims-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/css/style.css',
  './assets/vendor/bootstrap/bootstrap.min.css',
  './assets/vendor/bootstrap/bootstrap.bundle.min.js',
  './assets/vendor/bootstrap-icons/bootstrap-icons.min.css',
  './assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
  './assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
  './assets/vendor/chartjs/chart.umd.min.js',
  './assets/js/utilities.js',
  './assets/js/storage.js',
  './assets/js/database.js',
  './assets/js/data.js',
  './assets/js/auth.js',
  './assets/js/dashboard.js',
  './assets/js/products.js',
  './assets/js/inventory.js',
  './assets/js/sales.js',
  './assets/js/customers.js',
  './assets/js/suppliers.js',
  './assets/js/reports.js',
  './assets/js/users.js',
  './assets/js/settings.js',
  './assets/js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // Navigation requests fall back to the cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for static assets, with background update when online
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
