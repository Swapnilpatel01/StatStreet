// Optional CORS proxy for StatStreet — deploy free on Cloudflare Workers.
// Only needed if your browser blocks ESPN's feeds (the app's "Test connection"
// button in Account will tell you). It forwards GET requests to ESPN's public
// API hosts only, adds CORS headers, and caches responses briefly.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker
// → Edit code → paste this file → Deploy. Copy the *.workers.dev URL into
// StatStreet → Account → Data connection → Save.

const ALLOWED_HOSTS = new Set([
  'site.api.espn.com',
  'site.web.api.espn.com',
  'content.core.api.espn.com',
  'now.core.api.espn.com',
]);

// Optional: lock the proxy to your own app's address (e.g. 'https://you.github.io').
// Leave empty to allow any origin.
const ALLOWED_ORIGIN = '';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('u');
    let url;
    try { url = new URL(target); } catch { return new Response('Missing or bad ?u= parameter', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: cors });
    }

    // Live scoreboards/summaries change often; everything else can be cached longer.
    const live = /scoreboard|summary/.test(url.pathname);
    const ttl = live ? 20 : 300;

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      const upstream = await fetch(url.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 StatStreet', Accept: 'application/json' },
        cf: { cacheTtl: ttl, cacheEverything: true },
      });
      res = new Response(upstream.body, upstream);
      res.headers.set('Cache-Control', `public, max-age=${ttl}`);
      if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
