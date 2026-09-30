// Data source for the hosted phone version. Hosted pages can't call ESPN
// directly, so this loads a snapshot of real ESPN data baked into the page
// (window.STATIC_SNAPSHOT) instead of fetching live.

import { gameScore } from './scoring.js';
import {
  upsertTeam, seedPlayer, repriceLeague, applyNews, applyInjuries,
} from './engine.js';

const snap = () => (typeof window !== 'undefined' ? window.STATIC_SNAPSHOT : null);

export async function syncLeague(state, league, { now = Date.now() } = {}) {
  const S = snap();
  if (!S) throw new Error('No data snapshot in this page');
  const s = (state.sync[league] ||= {});
  const fetched = Date.parse(S.fetched);
  if (s.seeded && s.snapshot >= fetched) return { finals: 0, live: 0 };

  for (const t of S.teams[league] || []) upsertTeam(state, league, t);
  for (const p of S.players[league] || []) {
    const rec = { ...p, img: '', gs: gameScore(league, p.line) };
    const a = state.assets[`${league}:p:${p.id}`];
    if (a && a.perf.ema != null && s.seeded) {
      // Newer snapshot: blend fresh season numbers into current form.
      a.perf.ema = a.perf.ema * 0.6 + rec.gs * 0.4;
      a.perf.season = { gs: rec.gs, gp: rec.gp };
    } else {
      seedPlayer(state, league, rec);
    }
  }
  repriceLeague(state, league, now);
  applyInjuries(state, league, S.injuries[league] || [], { now });
  const news = (S.news || []).filter((n) => n.league === league)
    .map((n) => ({ desc: '', img: '', ...n, published: Date.parse(n.published) }));
  applyNews(state, league, news, { now });
  repriceLeague(state, league, now);
  Object.assign(s, { seeded: true, snapshot: fetched, scoreboard: fetched, standings: fetched });
  return { finals: 0, live: 0, first: true };
}

export const hasLive = () => false;
