/* Service Worker HOME COP PARIS
   Stratégies :
   - index.html (navigations)   : network-first (jamais de version périmée), fallback cache hors-ligne
   - data.cats/min.json         : network-first, fallback cache
   - statiques (logo, icônes)   : cache-first
   - images Flickr              : cache-first plafonné à 400 entrées
*/
var VERSION = 'hcp-v1';
var STATIC_CACHE = VERSION + '-static';
var DATA_CACHE = VERSION + '-data';
var IMG_CACHE = VERSION + '-img';
var IMG_LIMIT = 400;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function (c) {
      return c.addAll(['/', 'logo.svg', 'favicon.svg', 'manifest.webmanifest',
        'icons/icon-192.png', 'icons/icon-512.png']);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(VERSION) !== 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimCache(name, max) {
  caches.open(name).then(function (c) {
    c.keys().then(function (keys) {
      if (keys.length > max) c.delete(keys[0]).then(function () { trimCache(name, max); });
    });
  });
}

function networkFirst(req, cacheName) {
  return caches.open(cacheName).then(function (c) {
    return fetch(req).then(function (res) {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(function () {
      return c.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('/');
        throw new Error('offline');
      });
    });
  });
}

function cacheFirst(req, cacheName, limit) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          c.put(req, res.clone());
          if (limit) trimCache(cacheName, limit);
        }
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* Navigations (index.html) : network-first */
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, STATIC_CACHE));
    return;
  }
  /* Données catalogue : network-first */
  if (url.origin === location.origin && /data(\.min|\.cats)?\.json$/.test(url.pathname)) {
    e.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }
  /* Images Flickr : cache-first plafonné */
  if (url.hostname === 'live.staticflickr.com') {
    e.respondWith(cacheFirst(req, IMG_CACHE, IMG_LIMIT));
    return;
  }
  /* Statiques même origine (logos, icônes, covers) : cache-first */
  if (url.origin === location.origin && /\.(png|svg|jpg|jpeg|webp|ico)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  /* Le reste (Supabase, CDN...) : réseau direct */
});
