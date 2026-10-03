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
  // A player's profile (age, height, college, draft, experience). Optional: the page works without it.
  athlete: (lg, id) => get(`${WEB}/${P(lg)}/athletes/${id}`, 8000).catch((e) => { if (!proxyUrl) throw e; return get(`${proxyUrl}/?u=${encodeURIComponent(`${WEB}/${P(lg)}/athletes/${id}`)}`, 8000); }),
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

// ---------- freely licensed player photos ----------
// Wikipedia's lead photo for a player, used only when Wikimedia Commons lists it under a
// free licence (Creative Commons or public domain) and we can credit the photographer.
const SPORT_WORDS = { nba: /basketball/i, nfl: /football/i, mlb: /baseball/i };
const WIKI_SUFFIX = { nba: ['basketball'], nfl: ['American football'], mlb: ['baseball'] };
const FREE_LICENCE = /^(cc[ -]?(0|by)|public domain|pd\b)/i;
const text = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function pickWikiPhoto(summary, league) {
  if (!summary || summary.type !== 'standard' || !summary.originalimage?.source) return null;
  if (!SPORT_WORDS[league]?.test(`${summary.description || ''} ${summary.extract || ''}`)) return null; // someone else with the same name
  const file = decodeURIComponent(summary.originalimage.source.split('/').pop() || '');
  if (!file || /\.svg$/i.test(file)) return null;
  return { file, src: summary.thumbnail?.source?.replace(/\/\d+px-/, '/640px-') || summary.originalimage.source, page: summary.content_urls?.mobile?.page || summary.content_urls?.desktop?.page || '' };
}
export function pickLicence(meta) {
  const p = Object.values(meta?.query?.pages || {})[0];
  const x = p?.imageinfo?.[0]?.extmetadata;
  if (!x) return null;
  const licence = text(x.LicenseShortName?.value);
  if (!FREE_LICENCE.test(licence) || /fair use|non-free/i.test(text(x.UsageTerms?.value) + licence)) return null;
  return { licence, artist: text(x.Artist?.value).slice(0, 60) || 'Unknown author', url: p.imageinfo[0].descriptionurl || '' };
}
export async function wikiPhoto(name, league) {
  const titles = [name, ...(WIKI_SUFFIX[league] || []).map((sfx) => `${name} (${sfx})`)];
  for (const title of titles) {
    try {
      const sum = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, 8000);
      const ph = pickWikiPhoto(sum, league);
      if (!ph) continue;
      const meta = await get(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + ph.file)}&prop=imageinfo&iiprop=extmetadata%7Curl&format=json&origin=*`, 8000);
      const lic = pickLicence(meta);
      if (!lic) return null; // found him, but the photo isn't free to reuse
      return { src: ph.src, page: lic.url || ph.page, artist: lic.artist, licence: lic.licence };
    } catch { /* try the next title */ }
  }
  return null;
}
