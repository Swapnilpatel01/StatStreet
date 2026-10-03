// Network layer for ESPN's public JSON endpoints.
// Tries a direct request first; if the browser blocks it (CORS) and you've set
// up the optional proxy in Settings, it retries through the proxy.

import { LEAGUES } from './scoring.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const V2 = 'https://site.api.espn.com/apis/v2/sports';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';

let proxyUrl = '';
let preferProxy = false;
let articleSrc = null;
export const netStats = { ok: 0, failed: 0, proxied: 0, lastError: '' };

export function setProxy(url) {
  proxyUrl = (url || '').trim().replace(/\/+$/, '');
  preferProxy = false;
}

async function get(url, timeout = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJSON(url) {
  const viaProxy = () => get(`${proxyUrl}/?u=${encodeURIComponent(url)}`);
  try {
    const data = (preferProxy && proxyUrl) ? await viaProxy() : await get(url);
    netStats.ok++;
    if (preferProxy) netStats.proxied++;
    return data;
  } catch (e) {
    if (proxyUrl && !preferProxy) {
      try {
        const data = await viaProxy();
        preferProxy = true; // direct is blocked on this device; stop trying it
        netStats.ok++; netStats.proxied++;
        return data;
      } catch (e2) { e = e2; }
    }
    netStats.failed++;
    netStats.lastError = `${e.name === 'AbortError' ? 'Timed out' : e.message} — ${url.replace(/^https:\/\//, '').slice(0, 80)}`;
    throw e;
  }
}

const P = (league) => LEAGUES[league].path;

export const api = {
  standings: (lg, season) => fetchJSON(`${V2}/${P(lg)}/standings${season ? `?season=${season}` : ''}`),
  scoreboard: (lg, yyyymmdd) => fetchJSON(`${SITE}/${P(lg)}/scoreboard${yyyymmdd ? `?dates=${yyyymmdd}&limit=100` : ''}`),
  summary: (lg, eventId) => fetchJSON(`${SITE}/${P(lg)}/summary?event=${eventId}`),
  news: (lg) => fetchJSON(`${SITE}/${P(lg)}/news?limit=50`),
  // One story's full text. ESPN serves it from a few places; use the first that answers.
  // All sources are asked at once and the first with text wins; the one that worked is
  // asked alone next time.
  article: async (lg, id) => {
    const urls = [`${SITE}/${P(lg)}/news/${id}`, `https://content.core.api.espn.com/v1/sports/news/${id}`, `https://now.core.api.espn.com/v1/sports/news/${id}`];
    const one = async (i) => {
      const j = await get(urls[i], 7000).catch((e) => { if (!proxyUrl) throw e; return get(`${proxyUrl}/?u=${encodeURIComponent(urls[i])}`, 7000); });
      const h = j?.headlines?.[0] || (j?.story ? j : null);
      if (!h?.story) throw new Error('No story text');
      articleSrc = i;
      return h;
    };
    if (articleSrc != null) { try { return await one(articleSrc); } catch { articleSrc = null; } }
    return Promise.any(urls.map((_, i) => one(i)));
  },
  injuries: (lg) => fetchJSON(`${SITE}/${P(lg)}/injuries`),
  seasonStats: (lg, { season, category, page = 1, limit = 200 } = {}) => {
    const q = new URLSearchParams({ seasontype: '2', limit: String(limit), page: String(page), isqualified: 'false' });
    if (season) q.set('season', season);
    if (category) q.set('category', category);
    return fetchJSON(`${WEB}/${P(lg)}/statistics/byathlete?${q}`);
  },
};

// Categories to request per league so every position is covered.
export const SEASON_CATEGORIES = {
  nba: [null],
  nfl: ['offense:passing', 'offense:rushing', 'offense:receiving', 'defense:defensive', 'specialTeams:kicking'],
  mlb: ['batting', 'pitching'],
};
