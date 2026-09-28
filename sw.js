/* Service Worker HOME COP PARIS
   Stratégies :
   - index.html (navigations)   : network-first (jamais de version périmée), fallback cache hors-ligne
   - data.cats/min.json         : network-first, fallback cache (réécrit seulement si l'ETag a changé)
   - images (Flickr, covers, logos) : NON interceptées → cache HTTP du navigateur.

   v3 (28/09/2026) : le SW ne touche plus aux images. L'ancien cache « cache-first »
   des images Flickr n'apportait rien (Flickr sert ses images avec max-age = 1 an,
   le cache HTTP du navigateur les garde déjà) mais ajoutait une couche fragile :
   re-téléchargement en CORS, cache qui grossissait sans limite (le plafond de 400
   ne tenait pas : 855 entrées après une courte visite), et une lecture Cache Storage
   par image. Au rechargement, des images pouvaient rester noires. Le cache
   hcp-img-stable2 est supprimé à l'activation.
*/
var VERSION = 'hcp-v3';
var STATIC_CACHE = VERSION + '-static';
var DATA_CACHE = VERSION + '-data';

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function (c) {
      return c.addAll(['/', 'logo.svg', 'favicon.svg', 'manifest.webmanifest',
        'icons/icon-192.png', 'icons/icon-512.png']);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  /* Supprime tout ce qui n'est pas de cette version, dont l'ancien cache images
     (hcp-img-stable2) et les covers/logos mis en cache par la v2. */
  var KEEP = [STATIC_CACHE, DATA_CACHE];
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (KEEP.indexOf(k) === -1) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Même contenu = même ETag : inutile de réécrire 6 Mo de data.min.json à chaque visite. */
function putIfChanged(c, req, res) {
  var etag = res.headers.get('etag');
  if (!etag) return c.put(req, res);
  return c.match(req).then(function (old) {
    if (old && old.headers.get('etag') === etag) return;
    return c.put(req, res);
  });
}

function networkFirst(req, cacheName) {
  return caches.open(cacheName).then(function (c) {
    return fetch(req).then(function (res) {
      if (res && res.ok) putIfChanged(c, req, res.clone()).catch(function () {});
      return res;
    }).catch(function () {
      return c.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('/').then(function (home) {
          if (home) return home;
          throw new Error('offline');
        });
        throw new Error('offline');
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
  /* Tout le reste (images Flickr, covers, logos, Supabase, CDN…) : pas d'interception,
     le navigateur gère directement avec son cache HTTP. */
});
