// Service worker: caches the app shell so StatStreet opens instantly and works
// offline (with the last prices it saw). Live data always goes to the network.

const VERSION = 'statstreet-v51';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/engine.js', 'js/scoring.js', 'js/sync.js', 'js/api.js', 'js/store.js', 'js/chart.js', 'js/util.js',
  'js/bs.js', 'js/funds.js', 'js/trading.js', 'js/gestures.js', 'js/social.js', 'js/heatmap.js', 'js/sharecard.js', 'js/xp.js', 'js/career.js', 'js/contests.js', 'js/boosters.js', 'js/moments.js', 'js/extras.js', 'js/extras2.js', 'js/extras3.js', 'js/cardart.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new install never picks up a stale page.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

  // The page itself: open instantly from the cache, then check for a newer version
  // in the background. If there is one, cache it and tell the app so it can switch
  // over right away (the app reloads itself if you haven't started using it yet).
  // The app's own "is there a newer version?" check always goes to the network.
  if (url.origin === location.origin && url.searchParams.has('fresh')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  if (url.origin === location.origin && (e.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html'))) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match('index.html');
      const network = fetch(url.origin + url.pathname.replace(/[^/]*$/, '') + 'index.html', { cache: 'no-store' }).then(async (res) => {
        if (!res.ok) return null;
        const text = await res.clone().text();
        const old = cached ? await cached.clone().text() : null;
        await cache.put('index.html', res.clone());
        if (old != null && old !== text) notifyUpdate();
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || new Response('Offline', { status: 503 });
    })());
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
  if (url.hostname === 'a.espncdn.com' || url.hostname === 'upload.wikimedia.org') {
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

async function notifyUpdate() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of list) c.postMessage({ type: 'update-ready' });
}

let puts = 0;
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
