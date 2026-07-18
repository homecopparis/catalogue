/* Service Worker HOME COP PARIS
   Stratégies :
   - index.html (navigations)   : network-first (jamais de version périmée), fallback cache hors-ligne
   - data.cats/min.json         : network-first, fallback cache
   - statiques (logo, icônes)   : cache-first
   - images Flickr              : cache-first plafonné à 400 entrées
*/
var VERSION = 'hcp-v2';
var STATIC_CACHE = VERSION + '-static';
var DATA_CACHE = VERSION + '-data';
/* cache images STABLE : n'est plus purgé aux montées de version (les URLs Flickr sont immuables) */
var IMG_CACHE = 'hcp-img-stable2';
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
  var KEEP = [STATIC_CACHE, DATA_CACHE, IMG_CACHE];
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (KEEP.indexOf(k) === -1) return caches.delete(k);
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
      /* Requête CORS vérifiable (Flickr envoie Access-Control-Allow-Origin:*) :
         on ne met JAMAIS en cache un échec — un raté reste retentable. */
      return fetch(new Request(req.url, { mode: 'cors' })).then(function (res) {
        if (res && res.ok) {
          c.put(req, res.clone());
          if (limit) trimCache(cacheName, limit);
        }
        return res;
      }).catch(function () { return fetch(req); });
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
