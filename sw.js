// LAPPEV — Service worker
// Stratégie "réseau d'abord" : on prend toujours la dernière version en ligne,
// et on se replie sur le cache quand il n'y a pas de réseau (chantier hors ligne).
// Les tuiles de carte et la recherche d'adresse (autres sites) ne passent pas par ici.

importScripts('./version.js');

const CACHE = `lappev-${self.LAPPEV_VERSION}-${self.LAPPEV_BUILD}`;
const NETWORK_TIMEOUT = 4000;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.js',
  './icon-192.png',
  './icon-512.png',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/db.js',
  './js/model.js',
  './js/geo.js',
  './js/uimode.js',
  './js/viewport.js',
  './js/screens/library.js',
  './js/screens/client.js',
  './js/symbols.js',
  './js/render.js',
  './js/editkit.js',
  './js/exchange.js',
  './js/print.js',
  './js/screens/editor.js',
  './js/screens/reading.js',
  './js/screens/metre.js',
  './js/screens/interventions.js',
  './js/screens/share.js',
  './js/screens/map.js',
  './js/screens/settings.js',
  './js/screens/help.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        // On ne supprime que les caches LAPPEV (d'autres applis peuvent partager le même domaine github.io)
        keys.filter(k => k.startsWith('lappev') && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: self.LAPPEV_VERSION, build: self.LAPPEV_BUILD });
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tuiles IGN, géocodage : réseau direct, jamais en cache
  event.respondWith(networkFirst(req, url));
});

function cacheKey(url) {
  return url.origin + url.pathname;
}

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  const network = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
    .then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(cacheKey(url), res.clone());
      return res;
    });

  try {
    return await withTimeout(network, NETWORK_TIMEOUT);
  } catch (e) {
    const cached = await cache.match(cacheKey(url), { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match(new URL('./index.html', self.location).href) : null);
    if (cached) return cached;
    return network; // pas de cache : on attend le réseau malgré tout
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
