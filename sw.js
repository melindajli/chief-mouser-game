// LARRY service worker: network-first with cache fallback, so players always
// get the newest build when online and keep playing offline. Successful
// responses (including opaque cross-origin ones like the Google Fonts files)
// refresh the cache on every load — no version bump needed per deploy.
const CACHE = 'larry-v2';
const ASSETS = ['.', 'index.html', 'style.css', 'game.js', 'sheets.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || Response.error())
    )
  );
});
