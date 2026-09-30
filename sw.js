// Service worker: caches the app shell so StatStreet opens instantly and works
// offline (with the last prices it saw). Live data always goes to the network.

const VERSION = 'statstreet-v5';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // The page itself: network first, so a new version shows up on the next open.
  if (url.origin === location.origin && (e.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html'))) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  // Other same-origin app files: serve from cache, refresh in the background.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(e.request, { ignoreSearch: true });
        const fresh = fetch(e.request).then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      }),
    );
    return;
  }

  // Player headshots and team logos: cache-first, they rarely change.
  // Capped so the cache can't grow without limit on the phone.
  if (url.hostname === 'a.espncdn.com') {
    e.respondWith(
      caches.open(`${VERSION}-img`).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res.ok || res.type === 'opaque') {
            await cache.put(e.request, res.clone());
            if (++puts % 40 === 0) trim(cache, 500);
          }
          return res;
        } catch {
          return new Response('', { status: 504 });
        }
      }),
    );
  }
  // Everything else (ESPN JSON feeds) goes straight to the network.
});

let puts = 0;
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
