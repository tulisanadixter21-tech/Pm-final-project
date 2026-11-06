/* =========================================================
   sw.js - Offline-first Service Worker (PWA)
   Caches the entire application shell and local vendor assets
   so the app operates without internet after first load.
   ========================================================= */
'use strict';

const CACHE_NAME = 'food-business-ims-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/css/style.css',
  './assets/images/foods/classic-burger.jpg',
  './assets/images/foods/fries-large.jpg',
  './assets/images/foods/iced-tea.jpg',
  './assets/images/foods/cheese-pizza-slice.jpg',
  './assets/images/foods/chocolate-cake.jpg',
  './assets/images/foods/chicken-sandwich.jpg',
  './assets/images/foods/spaghetti.jpg',
  './assets/images/foods/fried-chicken.jpg',
  './assets/images/foods/milk-tea.jpg',
  './assets/images/foods/pancakes.jpg',
  './assets/images/foods/placeholder-food.svg',
  './assets/images/ingredients/burger-buns.jpg',
  './assets/images/ingredients/beef-patties.jpg',
  './assets/images/ingredients/raw-chicken-cutlets.jpg',
  './assets/images/ingredients/pizza-dough.jpg',
  './assets/images/ingredients/mozzarella-cheese.jpg',
  './assets/images/ingredients/fresh-potatoes.jpg',
  './assets/images/ingredients/cooking-oil.jpg',
  './assets/images/ingredients/all-purpose-flour.jpg',
  './assets/images/ingredients/chocolate-frosting.jpg',
  './assets/images/ingredients/fresh-milk.jpg',
  './assets/images/ingredients/coffee-beans.jpg',
  './assets/images/ingredients/takeout-packaging.jpg',
  './assets/images/ingredients/placeholder-ingredient.svg',
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

  // Network-first for static assets, falling back to cache when offline
  event.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
